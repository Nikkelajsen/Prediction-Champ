-- Test af de lokale kåringer (sql/competition_awards.sql, A22).
--
-- Kører mod en TOM engangsdatabase (CI: postgres-service; lokalt: en midlertidig
-- klynge). Rører aldrig produktion. Samme mønster som rating_equivalence.sql.
--
-- HVAD DEN BEVISER
--   1. En færdigspillet runde kåres; en runde med en manglende kamp kåres ikke.
--   2. En afsluttet kalendermåned kåres; den igangværende måned kåres ikke.
--   3. Delt førsteplads giver én række pr. vinder med shared = true.
--   4. Kun deltagere tælles med — et ikke-deltagende tip kan ikke vinde.
--   5. Uden mode_params.awards skrives intet; en fremmed kalder skriver intet.
--   6. Idempotens: andet kald giver 0 nye rækker.
--   7. service_role må kalde uden at være deltager (B10/B11-forberedelsen).
--
-- Fixture-datoerne regnes RELATIVT til now(), så testen ikke rådner: to hele
-- runder i forrige kalendermåned (afsluttet) og én halv runde i den
-- indeværende (hverken runde eller måned kan kåres).

\set ON_ERROR_STOP on
\timing off

-- ---------- minimalt skema ----------
-- auth.uid()/auth.role() stubbes med session-GUC'er, så testen kan "logge ind"
-- som forskellige brugere: set_config('test.uid', …) / ('test.role', …).
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $$;
create table if not exists auth.users (id uuid primary key);
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create table public.profiles (id uuid primary key, display_name text, is_admin boolean default false);

-- round_key() + pc_points() kommer herfra — kåringen skal bruge produktions-
-- udgaverne, ikke kopier.
\ir ../rating_core.sql

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
create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mode text not null default 'custom',
  mode_params jsonb not null default '{}'::jsonb,
  created_by uuid
);
create table public.competition_matches (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  primary key (competition_id, match_id)
);
create table public.competition_participants (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (competition_id, user_id)
);

\ir ../competition_awards.sql

-- ---------- fixture ----------
-- u1/u2/u4 er deltagere; u3 tipper, men deltager IKKE. Forrige måned: runde r0
-- (delt sejr) og r1 (u1 vinder). Indeværende måned: r2 med én kamp uden
-- resultat.
do $$
declare
  u1 uuid := '00000000-0000-0000-0000-000000000001';
  u2 uuid := '00000000-0000-0000-0000-000000000002';
  u3 uuid := '00000000-0000-0000-0000-000000000003';
  u4 uuid := '00000000-0000-0000-0000-000000000004';
  c1 uuid := '10000000-0000-0000-0000-000000000001'; -- opt-in
  c2 uuid := '10000000-0000-0000-0000-000000000002'; -- UDEN opt-in
  c3 uuid := '10000000-0000-0000-0000-000000000003'; -- opt-in, til guard/service_role-testen
  lg uuid; sn uuid;
  prev date := (date_trunc('month', now() at time zone 'Europe/Copenhagen') - interval '1 month')::date;
  -- Forankres i RUNDENS egen tirsdag frem for faste månedsdage: dag 8 og 9
  -- kunne straddle en mandag/tirsdag-grænse og splitte r0 i to runder. Ugen
  -- omkring dag 10 ligger altid helt inde i forrige måned (tirsdag ∈ dag 4–10,
  -- runden slutter senest dag 16), og tue+7 er pr. definition næste runde.
  tue date;
  m01 uuid; m02 uuid; m1 uuid; m2 uuid; m3 uuid; m4 uuid;
begin
  tue := public.round_key((prev + 10)::timestamptz);
  insert into auth.users (id) values (u1), (u2), (u3), (u4);
  insert into public.profiles (id, display_name) values
    (u1, 'Anna'), (u2, 'Bo'), (u3, 'Carla'), (u4, 'Dan');
  insert into public.leagues (name) values ('Testligaen') returning id into lg;
  insert into public.seasons (league_id, name) values (lg, '2026/27') returning id into sn;

  -- r0: begge kampe spillet (1-1 og 2-0)
  insert into public.matches (season_id, kickoff_at, home_score, away_score)
    values (sn, tue, 1, 1) returning id into m01;
  insert into public.matches (season_id, kickoff_at, home_score, away_score)
    values (sn, tue + 1, 2, 0) returning id into m02;
  -- r1 (runden efter): begge kampe spillet (2-1 og 0-0)
  insert into public.matches (season_id, kickoff_at, home_score, away_score)
    values (sn, tue + 7, 2, 1) returning id into m1;
  insert into public.matches (season_id, kickoff_at, home_score, away_score)
    values (sn, tue + 8, 0, 0) returning id into m2;
  -- r2 (indeværende måned): én spillet, én uden resultat
  insert into public.matches (season_id, kickoff_at, home_score, away_score)
    values (sn, now() + interval '1 day', 1, 0) returning id into m3;
  insert into public.matches (season_id, kickoff_at, home_score, away_score)
    values (sn, now() + interval '2 days', null, null) returning id into m4;

  insert into public.competitions (id, name, mode_params) values
    (c1, 'Med kåringer',  '{"awards": true}'),
    (c2, 'Uden kåringer', '{}'),
    (c3, 'Guard-testen',  '{"awards": true}');
  insert into public.competition_matches (competition_id, match_id)
    select c, m from (values (c1), (c2), (c3)) cs(c), unnest(array[m01, m02, m1, m2, m3, m4]) m;
  insert into public.competition_participants (competition_id, user_id) values
    (c1, u1), (c1, u2), (c1, u4),
    (c2, u1), (c2, u2),
    (c3, u1), (c3, u2);

  -- r0: u1 og u2 tipper IDENTISK (3+3 point) → delt sejr
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values
    (u1, m01, 1, 1), (u1, m02, 2, 0),
    (u2, m01, 1, 1), (u2, m02, 2, 0),
  -- r1: u1 får 3+1 = 4, u2 får 1+0 = 1 → u1 vinder alene
    (u1, m1, 2, 1), (u1, m2, 1, 1),
    (u2, m1, 1, 0), (u2, m2, 2, 1),
  -- u3 (IKKE deltager) tipper perfekt hele vejen — må aldrig optræde
    (u3, m01, 1, 1), (u3, m02, 2, 0), (u3, m1, 2, 1), (u3, m2, 0, 0);
end $$;

-- ---------- 1) uden opt-in: intet ----------
do $$
declare n int;
begin
  perform set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
  n := public.award_competition_periods('10000000-0000-0000-0000-000000000002');
  if n <> 0 then raise exception 'uden opt-in skrev % rækker', n; end if;
end $$;

-- ---------- 2) opt-in, kaldt af deltager ----------
do $$
declare n int; rk0 date; rk1 date; mk text;
begin
  perform set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
  n := public.award_competition_periods('10000000-0000-0000-0000-000000000001');
  -- r0 (2 delte) + r1 (1) + forrige måned (1) = 4 rækker
  if n <> 4 then raise exception 'forventede 4 kåringsrækker, fik %', n; end if;

  select min(round_key), max(round_key) into rk0, rk1 from public.matches where home_score is not null and kickoff_at < now() - interval '1 day';
  mk := to_char((date_trunc('month', now() at time zone 'Europe/Copenhagen') - interval '1 month'), 'YYYY-MM');

  -- r0: delt sejr, begge med shared = true og 6 point
  if (select count(*) from public.competition_awards
      where period_type = 'round' and period_key = rk0::text and shared and points = 6) <> 2
  then raise exception 'r0 skulle have to delte vindere med 6 point'; end if;

  -- r1: u1 alene, 4 point, ikke delt
  if not exists (select 1 from public.competition_awards
      where period_type = 'round' and period_key = rk1::text and not shared and points = 4
        and user_id = '00000000-0000-0000-0000-000000000001')
  then raise exception 'r1 skulle være vundet af u1 alene med 4 point'; end if;

  -- måneden: u1 alene med 6+4 = 10 point
  if not exists (select 1 from public.competition_awards
      where period_type = 'month' and period_key = mk and not shared and points = 10
        and user_id = '00000000-0000-0000-0000-000000000001')
  then raise exception 'måneden % skulle være vundet af u1 med 10 point', mk; end if;

  -- den ufærdige runde og den igangværende måned er IKKE kåret
  if exists (select 1 from public.competition_awards a
      join public.matches m on m.round_key::text = a.period_key
      where a.period_type = 'round' and m.home_score is null)
  then raise exception 'en ufærdig runde blev kåret'; end if;

  -- u3 (ikke-deltager) optræder ingen steder trods perfekte tips
  if exists (select 1 from public.competition_awards where user_id = '00000000-0000-0000-0000-000000000003')
  then raise exception 'et ikke-deltagende tip vandt en kåring'; end if;

  -- ---------- 3) idempotens ----------
  n := public.award_competition_periods('10000000-0000-0000-0000-000000000001');
  if n <> 0 then raise exception 'andet kald skrev % nye rækker', n; end if;
end $$;

-- ---------- 4) guard: en fremmed kalder skriver intet ----------
do $$
declare n int;
begin
  perform set_config('test.uid', '00000000-0000-0000-0000-000000000003', false); -- u3 er ikke deltager
  n := public.award_competition_periods('10000000-0000-0000-0000-000000000003');
  if n <> 0 then raise exception 'en fremmed kalder skrev % rækker', n; end if;
  if exists (select 1 from public.competition_awards where competition_id = '10000000-0000-0000-0000-000000000003')
  then raise exception 'guard-konkurrencen har rækker efter fremmed kald'; end if;
end $$;

-- ---------- 5) service_role må kalde uden at være deltager ----------
do $$
declare n int;
begin
  perform set_config('test.uid', '', false);
  perform set_config('test.role', 'service_role', false);
  n := public.award_competition_periods('10000000-0000-0000-0000-000000000003');
  if n < 3 then raise exception 'service_role-kaldet skrev kun % rækker', n; end if;
end $$;

select 'competition_awards: OK' as result;
