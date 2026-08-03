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

drop table if exists predictions, matches, seasons, leagues, rating_history, ratings, profiles cascade;
create table public.profiles (id uuid primary key, display_name text, is_admin boolean default false);

\ir ../rating_core.sql

-- leagues/seasons er med, fordi recompute_ratings() siden A17 (31. juli 2026)
-- kun tæller OFFICIELLE turneringer. Kun de kolonner, beregningen rører.
-- `is_official` har samme default som i produktion (sql/tournament_scope.sql),
-- så en turnering, der ikke siger andet, tæller med.
create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_official boolean not null default true
);
create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  name text
);

-- matches.round_key er en GENERERET kolonne i produktion og skal være det her
-- også — ellers tester vi ikke den rigtige rundeinddeling.
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
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

-- Én officiel turnering med én sæson — fixturen for selve ækvivalensen.
insert into leagues(id, name, is_official)
values ('11111111-1111-1111-1111-111111111111', 'Superligaen (test)', true);
insert into seasons(id, league_id, name)
values ('11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111', '2025/2026');

insert into matches(season_id, kickoff_at, home_score, away_score)
select '11111111-1111-1111-1111-111111111112',
       timestamptz '2025-08-05 18:00+00' + (r * interval '7 days') + (m * interval '3 hours'),
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

-- ---------- A17: en uofficiel turnering må ikke flytte noget ----------
-- Denne sektion findes, fordi referencen ikke længere kan bevise filteret: den
-- fik det selv den 31. juli 2026, så de to sider ville være enige om at ignorere
-- en uofficiel turnering, uanset om filteret virkede. Beviset skal derfor være
-- en tilstandsændring: gem ratings, tilføj en uofficiel turnering, genberegn, og
-- kræv at INTET har rykket sig.
create temp table foer_r as select * from ratings;
create temp table foer_h as select * from rating_history;

insert into leagues(id, name, is_official)
values ('22222222-2222-2222-2222-222222222221', 'Uofficiel turnering (test)', false);
insert into seasons(id, league_id, name)
values ('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222221', '2025/2026');

-- Kampene lægges i EKSISTERENDE round_keys (en time efter en officiel kamp), så
-- de ville blande sig i runder, der allerede har et ratingskridt. Det er den
-- farligste form for forurening — en helt ny runde ville være lettere at opdage.
insert into matches(season_id, kickoff_at, home_score, away_score)
select '22222222-2222-2222-2222-222222222222', m.kickoff_at + interval '1 hour', 2, 1
from matches m
where m.season_id = '11111111-1111-1111-1111-111111111112'
  and m.home_score is not null
order by m.kickoff_at
limit 40;

-- Kun HALVDELEN af spillerne tipper dem, og de rammer alle præcist. Talte
-- kampene med, ville de 15 få et gennemsnit, ingen af de øvrige kunne matche,
-- og hver eneste runde ville se anderledes ud. Et perfekt tip fra ALLE ville
-- derimod løfte feltet ensartet, og Elo er relativ — så det ville bevise mindre.
-- Spiller 31 har ingen andre tips: efter A17 skal vedkommende stadig stå UDEN
-- rating, selvom de nu tipper aktivt. Det er det dokumenterede vilkår.
insert into predictions(user_id, match_id, pred_home, pred_away)
select p.id, m.id, 2, 1
from profiles p cross join matches m
where m.season_id = '22222222-2222-2222-2222-222222222222'
  and p.id in (
    select ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 15) g
    union all select '00000000-0000-0000-0000-000000000031'::uuid
  );

analyze;
select public.recompute_ratings();

do $$
declare n_now int; n_foer int; n_diff int; n_hist_diff int; n_uoff int;
begin
  select count(*) into n_now from ratings;
  select count(*) into n_foer from foer_r;
  if n_now <> n_foer then
    raise exception 'FEJL: antallet af rating-rækker gik fra % til % — en uofficiel turnering slap ind', n_foer, n_now;
  end if;

  select count(*) into n_diff
  from ratings r full join foer_r f using (user_id, scope)
  where r.rating is distinct from f.rating
     or r.rounds_played is distinct from f.rounds_played
     or r.provisional is distinct from f.provisional;
  if n_diff > 0 then
    raise exception 'FEJL: % rating-rækker flyttede sig, da en uofficiel turnering blev tilføjet', n_diff;
  end if;

  select count(*) into n_hist_diff
  from rating_history h full join foer_h g using (user_id, scope, round_key)
  where h.rating_after is distinct from g.rating_after
     or h.delta is distinct from g.delta
     or h.rnk is distinct from g.rnk
     or h.matches_predicted is distinct from g.matches_predicted;
  if n_hist_diff > 0 then
    raise exception 'FEJL: % historik-rækker flyttede sig', n_hist_diff;
  end if;

  if exists (select 1 from ratings where user_id = '00000000-0000-0000-0000-000000000031') then
    raise exception 'FEJL: en spiller, der KUN tipper en uofficiel turnering, fik en rating';
  end if;

  select count(*) into n_uoff from predictions p join matches m on m.id = p.match_id
  where m.season_id = '22222222-2222-2222-2222-222222222222';
  raise notice 'OK: % præcise tips i en uofficiel turnering flyttede hverken rating eller historik, og spilleren, der kun tipper den, har ingen rating (A17).', n_uoff;
end $$;

-- ---------------------------------------------------------------------------
-- G11: round_key() er markeret IMMUTABLE og skal FAKTISK være det
-- ---------------------------------------------------------------------------
-- Kroppen brugte `ts::date`, som læser sessionens `TimeZone` — funktionen var
-- altså reelt STABLE, mens `matches.round_key` er en genereret kolonne, der
-- kræver immutabilitet. Følgen kunne kun ses, hvis en writer havde en anden
-- zone end resten: to kampe i samme uge kunne ende i hver sin runde.
--
-- Testen skifter sessionens zone og kræver det samme svar. Den er skrevet på
-- et tidspunkt INDE i vinduet, hvor de to læsninger er uenige (00.30 dansk
-- tirsdag = 22.30 UTC mandag) — uden for det ville enhver implementering bestå.
do $$
declare
  utc_svar date;
  ny_york_svar date;
  kbh_svar date;
  grænsetid timestamptz := '2026-08-10T22:30:00Z';
begin
  set local timezone = 'UTC';              utc_svar := public.round_key(grænsetid);
  set local timezone = 'America/New_York'; ny_york_svar := public.round_key(grænsetid);
  set local timezone = 'Europe/Copenhagen'; kbh_svar := public.round_key(grænsetid);
  reset timezone;

  if utc_svar is distinct from kbh_svar or ny_york_svar is distinct from kbh_svar then
    raise exception 'round_key er ikke zone-uafhængig: UTC=%, New York=%, København=%',
      utc_svar, ny_york_svar, kbh_svar;
  end if;

  -- Og svaret skal være den DANSKE læsning: 00.30 dansk tirsdag hører til den
  -- runde, der begynder samme tirsdag — ikke til ugen før.
  if kbh_svar <> date '2026-08-11' then
    raise exception 'round_key gav % for 00.30 dansk tirsdag, forventede 2026-08-11', kbh_svar;
  end if;

  raise notice 'OK: round_key() giver % i alle tre sessionszoner (G11).', kbh_svar;
end $$;
