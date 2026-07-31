-- Ækvivalenstest for ratingberegningen.
--
-- Kører mod en TOM engangsdatabase (CI: postgres-service; lokalt: en midlertidig
-- klynge). Rører aldrig produktion.
--
-- HVAD DEN BEVISER
-- At recompute_ratings() i sql/rating_core.sql giver samme resultat som den
-- frosne reference i _reference_recompute.sql — altså algoritmen, som den så ud
-- før optimeringen den 30. juli 2026.
--
-- HVORFOR DEN FINDES
-- Rating var det eneste store domæne uden nogen test overhovedet, og
-- optimeringen ændrede logistikken fra numeric til double precision. Uden en
-- test er "resultatet er det samme" en påstand; med den er det en kontrol, der
-- køres ved hver pull request.
--
-- TOLERANCEN er bevidst meget snæver: rangorden, rnk og provisional skal være
-- HELT identiske, og selve tallene må afvige med højst 1e-9. Målt afvigelse er
-- ~3e-13, altså tre-fire størrelsesordener under grænsen. Bliver forskellen
-- pludselig større, er der sket noget andet end en afrunding.

\set ON_ERROR_STOP on
\timing off

-- ---------- minimalt skema ----------
-- Kun det, ratingberegningen rører. auth.uid() stubbes, fordi RLS-policyerne i
-- rating_core.sql kalder den, og der er ingen Supabase her.
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

drop table if exists predictions, matches, rating_history, ratings, profiles cascade;
create table public.profiles (id uuid primary key, display_name text, is_admin boolean default false);

\ir ../rating_core.sql

-- matches.round_key er en GENERERET kolonne i produktion og skal være det her
-- også — ellers tester vi ikke den rigtige rundeinddeling.
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  kickoff_at timestamptz not null,
  round_key date generated always as (public.round_key(kickoff_at)) stored,
  home_score int,
  away_score int
);
create table public.predictions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  pred_home int,
  pred_away int,
  primary key (user_id, match_id)
);

\ir _reference_recompute.sql

-- ---------- fixture ----------
-- Deterministisk: setseed gør kørslen reproducerbar, så en fejl kan genskabes.
-- 31 spillere svarer til den faktiske størrelse (docs/ROADMAP.md nævner "4.
-- plads af 31 spillere"); 38 runder er en hel sæson.
select setseed(0.42);

insert into profiles(id, display_name)
select ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'Spiller ' || g
from generate_series(1, 31) g;

insert into matches(kickoff_at, home_score, away_score)
select timestamptz '2025-08-05 18:00+00' + (r * interval '7 days') + (m * interval '3 hours'),
       (random() * 4)::int,
       (random() * 4)::int
from generate_series(0, 37) r, generate_series(1, 10) m;

-- Et par kampe uden resultat: de skal IGNORERES af beregningen, ikke tælle som 0.
update matches set home_score = null, away_score = null
where id in (select id from matches order by kickoff_at desc limit 7);

insert into predictions(user_id, match_id, pred_home, pred_away)
select p.id, m.id, (random() * 4)::int, (random() * 4)::int
from profiles p cross join matches m
where random() < 0.85;

-- Én spiller uden et eneste tip: må ikke dukke op i ratings.
delete from predictions where user_id = '00000000-0000-0000-0000-000000000031';

analyze;

-- ---------- kør begge udgaver ----------
select public.recompute_ratings_reference();
create temp table facit_r as select * from ratings;
create temp table facit_h as select * from rating_history;

select public.recompute_ratings();

-- ---------- sammenlign ----------
do $$
declare
  n_ratings int; n_facit int;
  n_hist int; n_facit_h int;
  raek_ok boolean; rnk_ok boolean; prov_ok boolean;
  d_rating numeric; d_delta numeric;
  tolerance constant numeric := 1e-9;
begin
  select count(*) into n_ratings from ratings;
  select count(*) into n_facit from facit_r;
  select count(*) into n_hist from rating_history;
  select count(*) into n_facit_h from facit_h;

  if n_ratings = 0 then
    raise exception 'FEJL: beregningen gav ingen rækker — fixturen virker ikke';
  end if;
  if n_ratings <> n_facit or n_hist <> n_facit_h then
    raise exception 'FEJL: forskelligt antal rækker (ratings %/%, historik %/%)',
      n_ratings, n_facit, n_hist, n_facit_h;
  end if;

  -- Spilleren uden tip må ikke være med.
  if exists (select 1 from ratings where user_id = '00000000-0000-0000-0000-000000000031') then
    raise exception 'FEJL: en spiller uden tip fik en rating';
  end if;

  select bool_and(a.user_id = b.user_id) into raek_ok
  from (select user_id, row_number() over (order by rating desc, user_id) rn from ratings) a
  join (select user_id, row_number() over (order by rating desc, user_id) rn from facit_r) b using (rn);

  select bool_and(h.rnk = g.rnk) into rnk_ok
  from rating_history h join facit_h g using (user_id, scope, round_key);

  select bool_and(r.provisional = g.provisional and r.rounds_played = g.rounds_played) into prov_ok
  from ratings r join facit_r g using (user_id, scope);

  select max(abs(r.rating - g.rating)) into d_rating from ratings r join facit_r g using (user_id, scope);
  select max(abs(h.delta - g.delta)) into d_delta from rating_history h join facit_h g using (user_id, scope, round_key);

  if not raek_ok then raise exception 'FEJL: rangordenen afviger fra referencen'; end if;
  if not rnk_ok then raise exception 'FEJL: rnk afviger i mindst én historik-række'; end if;
  if not prov_ok then raise exception 'FEJL: provisional/rounds_played afviger'; end if;
  if d_rating > tolerance then
    raise exception 'FEJL: rating afviger med % (grænse %)', d_rating, tolerance;
  end if;
  if d_delta > tolerance then
    raise exception 'FEJL: delta afviger med % (grænse %)', d_delta, tolerance;
  end if;

  raise notice 'OK: % spillere, % historik-rækker. Rangorden, rnk og provisional identiske. Max afvigelse: rating %, delta % (grænse %).',
    n_ratings, n_hist, to_char(d_rating, '9D999999EEEE'), to_char(d_delta, '9D999999EEEE'), to_char(tolerance, '9D999999EEEE');
end $$;

-- ---------- egenskaber, referencen ikke fanger ----------
-- Elo er nulsum: rundens deltaer skal summere til nul. Det er den stærkeste
-- enkeltkontrol af, at parvis-sammenligningen er symmetrisk.
do $$
declare afvigelse numeric;
begin
  select max(abs(s)) into afvigelse from (
    select round_key, sum(delta) as s from rating_history where scope = 'ALL' group by round_key
  ) x;
  if afvigelse > 1e-6 then
    raise exception 'FEJL: rundernes deltaer summerer ikke til nul (største afvigelse %)', afvigelse;
  end if;
  raise notice 'OK: Elo er nulsum i alle runder (største afvigelse %).', to_char(afvigelse, '9D999999EEEE');
end $$;

-- Alle starter på 1000, så summen af ratings skal blive 1000 × antal spillere.
do $$
declare total numeric; forventet numeric;
begin
  select sum(rating), count(*) * 1000 into total, forventet from ratings where scope = 'ALL';
  if abs(total - forventet) > 1e-6 then
    raise exception 'FEJL: samlet rating er % , forventet % — systemet er ikke nulsum', total, forventet;
  end if;
  raise notice 'OK: samlet rating er % som forventet (afvigelse %).', round(total), to_char(abs(total-forventet), '9D999999EEEE');
end $$;
