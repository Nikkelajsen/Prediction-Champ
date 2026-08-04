-- Test af milepæle (sql/milestones.sql) — permanente engangs-bedrifter.
--
-- Kører mod en TOM engangsdatabase. Rører aldrig produktion.
--
-- HVAD DEN BEVISER
--   1. award_milestones() uddeler — og anden kørsel uddeler NUL. Idempotensen
--      er ikke en optimering: den er det, der gør en milepæl uigenkaldelig.
--   2. Rating-tærskler måles mod PEAK og ikke mod nuværende rating. En bruger,
--      der har været oppe på 1250 og siden er faldet til 1050, har stadig
--      opnået 1200.
--   3. FELTSTØRRELSE-GUARDEN: i et felt på fem spillere uddeles hverken
--      "top 3" eller "top 10". Uden den ville "top 3 af 3" ryge ud på dag ét,
--      og så betyder milepælen ingenting.
--   4. competition_status melder IKKE en konkurrence færdig, hvis den kan vokse
--      og dens sæson stadig har uspillede kampe. Det er den påstand, der
--      beskytter en permanent belønning mod at blive uddelt for tidligt.
--   5. Perfekt runde kræver mindst 5 kampe — fire rigtige er ikke en perfekt runde.
--   6. Liga-vækst tæller medlemmer UDEN opretteren selv.
--   7. RLS: en bruger ser kun sine egne milepæle, og ingen kan skrive i tabellen.

\set ON_ERROR_STOP on
\timing off

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
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete cascade,
  name text not null
);
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  home_team_id uuid references public.teams(id),
  away_team_id uuid references public.teams(id),
  kickoff_at timestamptz not null,
  round_key date generated always as (public.round_key(kickoff_at)) stored,
  home_score int, away_score int
);
create table public.predictions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  pred_home int, pred_away int,
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
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references public.profiles(id) on delete cascade
);
create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (group_id, user_id)
);

-- Stillings-viewene og analytics-viewet stubbes som TABELLER. De har hver deres
-- egen test; her er de inddata, og en tabel gør det muligt at ramme netop den
-- kant, hver påstand handler om.
create table public.monthly_standings (
  month text, scope text, user_id uuid,
  total_points int, exact_count int, outcome_count int, round_wins int, avg_goal_error numeric
);
create table public.season_standings (
  season_id uuid, user_id uuid,
  total_points int, exact_count int, outcome_count int, round_wins int, avg_goal_error numeric
);
create table public.analytics_completion_facts (
  user_id uuid, competition_id uuid, match_id uuid, round_key date, predicted boolean
);

\ir ../story_engine_v2_day.sql
\ir ../milestones.sql

-- ---------- fixture ----------
do $$
declare
  u1 uuid := '00000000-0000-0000-0000-000000000001';
  u2 uuid := '00000000-0000-0000-0000-000000000002';
  u3 uuid := '00000000-0000-0000-0000-000000000003';
  u4 uuid := '00000000-0000-0000-0000-000000000004';
  u5 uuid := '00000000-0000-0000-0000-000000000005';
  lg uuid; sn1 uuid; sn2 uuid; ta uuid; tb uuid;
  c1 uuid := '10000000-0000-0000-0000-000000000001'; -- custom, afsluttet
  c2 uuid := '10000000-0000-0000-0000-000000000002'; -- full_season, sæson IKKE færdig
  g1 uuid := '20000000-0000-0000-0000-000000000001';
  mid uuid; i int;
begin
  insert into public.profiles (id, display_name) values
    (u1,'Anna'), (u2,'Bo'), (u3,'Cecilie'), (u4,'David'), (u5,'Eva');

  insert into public.leagues (name) values ('Testliga') returning id into lg;
  insert into public.seasons (league_id, name) values (lg,'2025/26') returning id into sn1;
  insert into public.seasons (league_id, name) values (lg,'2026/27') returning id into sn2;
  insert into public.teams (league_id, name) values (lg,'A') returning id into ta;
  insert into public.teams (league_id, name) values (lg,'B') returning id into tb;

  -- ---- Rating ----
  -- Feltet er fem ikke-provisoriske spillere: NO1 kræver ≥5 (udløses), TOP3
  -- kræver ≥8 og TOP10 ≥10 (udløses IKKE).
  insert into public.ratings (user_id, scope, rating, rounds_played, provisional) values
    (u1,'ALL',1300,10,false), (u2,'ALL',1200,10,false), (u3,'ALL',1150,10,false),
    (u4,'ALL',1100,10,false), (u5,'ALL',1050,10,false);

  -- u5's PEAK var 1250, men den nuværende rating er 1050. Milepælene 1100 og
  -- 1200 skal alligevel udløses — en opnået bedrift kan ikke tabes igen.
  insert into public.rating_history (user_id, scope, round_key, rating_after, delta, round_score, matches_predicted, rnk)
  values (u5,'ALL','2026-01-06',1250,0,0,5,1),
         (u5,'ALL','2026-01-13',1050,0,0,5,5),
         (u1,'ALL','2026-01-06',1300,0,0,5,1);

  -- ---- Kampe: c1 (custom, afsluttet) ----
  -- Fem kampe, alle spillet. Anna rammer alle fem udfald → PERFECT_ROUND.
  -- Bo rammer fire ud af fem → INGEN perfekt runde (guarden er ≥5 kampe MED
  -- point, ikke ≥4).
  insert into public.competitions (id, name, mode, created_by) values (c1,'Afsluttet','custom',u1);
  insert into public.competition_participants (competition_id, user_id) values (c1,u1),(c1,u2),(c1,u3);
  for i in 1..5 loop
    insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
      values (sn1, ta, tb, ('2026-03-03 12:00:00+00'::timestamptz + (i || ' hours')::interval), 2, 1)
      returning id into mid;
    insert into public.competition_matches (competition_id, match_id) values (c1, mid);
    insert into public.predictions (user_id, match_id, pred_home, pred_away) values (u1, mid, 2, 1);
    insert into public.predictions (user_id, match_id, pred_home, pred_away)
      values (u2, mid, case when i = 5 then 0 else 3 end, case when i = 5 then 2 else 1 end);
    insert into public.predictions (user_id, match_id, pred_home, pred_away) values (u3, mid, 0, 3);
  end loop;

  -- ---- c2: full_season, hvis sæson IKKE er færdigspillet ----
  insert into public.competitions (id, name, mode, created_by) values (c2,'Igangværende','full_season',u2);
  insert into public.competition_participants (competition_id, user_id) values (c2,u1),(c2,u2);
  insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
    values (sn2, ta, tb, '2026-03-10 12:00:00+00', 1, 0) returning id into mid;
  insert into public.competition_matches (competition_id, match_id) values (c2, mid);
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values (u1, mid, 1, 0), (u2, mid, 0, 1);
  -- den uspillede kamp i SAMME sæson, som holder c2 åben
  insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at)
    values (sn2, ta, tb, '2026-03-17 12:00:00+00');

  -- ---- 100 tips til Bo (TIPS_100), alle forkerte, så intet andet udløses ----
  for i in 1..100 loop
    insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
      values (sn1, ta, tb, ('2026-04-01 12:00:00+00'::timestamptz + (i || ' days')::interval), 5, 0)
      returning id into mid;
    insert into public.predictions (user_id, match_id, pred_home, pred_away) values (u2, mid, 0, 4);
  end loop;

  -- ---- Fællesskab ----
  insert into public.groups (id, name, created_by) values (g1,'Annas liga',u1);
  -- seks medlemmer ud over Anna selv → LEAGUE_GREW_5, men ikke _10
  insert into public.group_members (group_id, user_id) values (g1,u1),(g1,u2),(g1,u3),(g1,u4),(g1,u5);
  insert into public.profiles (id, display_name) values
    ('00000000-0000-0000-0000-00000000000a','F'), ('00000000-0000-0000-0000-00000000000b','G');
  insert into public.group_members (group_id, user_id) values
    (g1,'00000000-0000-0000-0000-00000000000a'), (g1,'00000000-0000-0000-0000-00000000000b');

  -- ---- Runder i træk med alle tips (analytics-stub) ----
  -- Anna har 12 runder i træk med alt afgivet → ROUNDS_COMPLETE_10.
  for i in 1..12 loop
    insert into public.analytics_completion_facts (user_id, competition_id, match_id, round_key, predicted)
      values (u1, c1, gen_random_uuid(), ('2026-01-06'::date + (i * 7)), true);
  end loop;
  -- Bo har 12 runder, men brød i den femte → ingen milepæl.
  for i in 1..12 loop
    insert into public.analytics_completion_facts (user_id, competition_id, match_id, round_key, predicted)
      values (u2, c1, gen_random_uuid(), ('2026-01-06'::date + (i * 7)), i <> 5);
  end loop;
end $$;

-- ---------- 1. competition_status ----------
do $$ begin
  if not (select concluded from public.competition_status
          where competition_id = '10000000-0000-0000-0000-000000000001') then
    raise exception 'FEJL 1a: en afsluttet custom-konkurrence meldes ikke færdig';
  end if;
  if (select concluded from public.competition_status
      where competition_id = '10000000-0000-0000-0000-000000000002') then
    raise exception 'FEJL 1b: en full_season-konkurrence med uspillet sæson meldes færdig';
  end if;
end $$;

-- ---------- 2. Uddel ----------
do $$
declare v_first int; v_second int;
begin
  v_first := public.award_milestones(null);
  if v_first = 0 then
    raise exception 'FEJL 2a: ingen milepæle blev uddelt (tavs fejl?)';
  end if;
  v_second := public.award_milestones(null);
  if v_second <> 0 then
    raise exception 'FEJL 2b: anden kørsel uddelte % milepæle, forventede 0', v_second;
  end if;
end $$;

-- ---------- 3. Rating: peak, ikke nuværende ----------
do $$ begin
  -- Eva har rating 1050 nu, men peakede på 1250.
  if not exists (select 1 from public.milestones
                 where user_id = '00000000-0000-0000-0000-000000000005' and key = 'RATING_1200') then
    raise exception 'FEJL 3a: RATING_1200 måles mod nuværende rating og ikke mod peak';
  end if;
  if exists (select 1 from public.milestones
             where user_id = '00000000-0000-0000-0000-000000000005' and key = 'RATING_1300') then
    raise exception 'FEJL 3b: RATING_1300 blev uddelt uden dækning i peak';
  end if;
end $$;

-- ---------- 4. Feltstørrelse-guarden ----------
do $$ begin
  -- Fem ikke-provisoriske spillere: nr. 1 er en rigtig bedrift (guard ≥5) …
  if not exists (select 1 from public.milestones
                 where user_id = '00000000-0000-0000-0000-000000000001' and key = 'LEADERBOARD_NO1') then
    raise exception 'FEJL 4a: LEADERBOARD_NO1 udløste ikke i et felt på fem';
  end if;
  -- … men "top 3 af 5" og "top 10 af 5" er ikke.
  if exists (select 1 from public.milestones where key = 'LEADERBOARD_TOP3') then
    raise exception 'FEJL 4b: LEADERBOARD_TOP3 uddelt i et felt under 8';
  end if;
  if exists (select 1 from public.milestones where key = 'LEADERBOARD_TOP10') then
    raise exception 'FEJL 4c: LEADERBOARD_TOP10 uddelt i et felt under 10';
  end if;
end $$;

-- ---------- 5. Perfekt runde ----------
do $$ begin
  if not exists (select 1 from public.milestones
                 where user_id = '00000000-0000-0000-0000-000000000001' and key = 'PERFECT_ROUND') then
    raise exception 'FEJL 5a: fem rigtige udfald gav ingen perfekt runde';
  end if;
  if exists (select 1 from public.milestones
             where user_id = '00000000-0000-0000-0000-000000000002' and key = 'PERFECT_ROUND') then
    raise exception 'FEJL 5b: fire ud af fem gav en perfekt runde';
  end if;
  -- Anna ramte alle fem PRÆCIST (2-1), så den sjældne variant skal også findes.
  if not exists (select 1 from public.milestones
                 where user_id = '00000000-0000-0000-0000-000000000001' and key = 'PERFECT_ROUND_EXACT') then
    raise exception 'FEJL 5c: fem præcise gav ingen PERFECT_ROUND_EXACT';
  end if;
end $$;

-- ---------- 6. Konkurrence-milepæle kun for afsluttede konkurrencer ----------
do $$ begin
  if not exists (select 1 from public.milestones
                 where user_id = '00000000-0000-0000-0000-000000000001' and key = 'COMP_FIRST_WIN') then
    raise exception 'FEJL 6a: vinderen af en afsluttet konkurrence fik ingen milepæl';
  end if;
  -- c1 har tre deltagere, så hverken storsejr (≥8) eller podie (≥5) må udløses.
  if exists (select 1 from public.milestones where key in ('COMP_WIN_BIG_8','COMP_PODIUM')) then
    raise exception 'FEJL 6b: storsejr/podie uddelt i en for lille konkurrence';
  end if;
  -- Ingen milepæl må pege på den igangværende konkurrence.
  if exists (select 1 from public.milestones
             where competition_id = '10000000-0000-0000-0000-000000000002'
               and key like 'COMP\_%') then
    raise exception 'FEJL 6c: milepæl uddelt for en konkurrence, der stadig kan vokse';
  end if;
end $$;

-- ---------- 7. Præcision og fællesskab ----------
do $$ begin
  if not exists (select 1 from public.milestones
                 where user_id = '00000000-0000-0000-0000-000000000002' and key = 'TIPS_100') then
    raise exception 'FEJL 7a: 100 tips gav ingen milepæl';
  end if;
  if exists (select 1 from public.milestones where key = 'TIPS_500') then
    raise exception 'FEJL 7b: TIPS_500 uddelt for under 500 tips';
  end if;
  -- Runder i træk: Anna har 12, Bo brød i den femte.
  if not exists (select 1 from public.milestones
                 where user_id = '00000000-0000-0000-0000-000000000001' and key = 'ROUNDS_COMPLETE_10') then
    raise exception 'FEJL 7c: 12 hele runder i træk gav ingen milepæl';
  end if;
  if exists (select 1 from public.milestones
             where user_id = '00000000-0000-0000-0000-000000000002' and key = 'ROUNDS_COMPLETE_10') then
    raise exception 'FEJL 7d: en brudt stime gav alligevel milepælen';
  end if;
  -- Liga-vækst tæller UDEN opretteren: seks andre medlemmer.
  if not exists (select 1 from public.milestones
                 where user_id = '00000000-0000-0000-0000-000000000001' and key = 'LEAGUE_GREW_5') then
    raise exception 'FEJL 7e: seks medlemmer gav ingen liga-vækst-milepæl';
  end if;
  if exists (select 1 from public.milestones where key = 'LEAGUE_GREW_10') then
    raise exception 'FEJL 7f: LEAGUE_GREW_10 uddelt ved seks medlemmer';
  end if;
  if not exists (select 1 from public.milestones
                 where user_id = '00000000-0000-0000-0000-000000000001' and key = 'FIRST_LEAGUE_CREATED') then
    raise exception 'FEJL 7g: liga-opretteren fik ingen milepæl';
  end if;
end $$;

-- ---------- 8. Alle fire familier findes ----------
do $$
declare v_n int;
begin
  select count(distinct family) into v_n from public.milestones;
  if v_n <> 4 then
    raise exception 'FEJL 8: fandt % familier, forventede 4', v_n;
  end if;
end $$;

-- ---------- 9. RLS ----------
do $$ begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'milestones'
                   and policyname = 'milestones_select_own' and cmd = 'SELECT') then
    raise exception 'FEJL 9a: select-policy mangler';
  end if;
  -- Ingen skrivepolicy: award_milestones() er eneste skriver.
  if exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'milestones' and cmd <> 'SELECT') then
    raise exception 'FEJL 9b: der findes en skrivepolicy på milestones';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.milestones'::regclass) then
    raise exception 'FEJL 9c: RLS er ikke slået til';
  end if;
end $$;

-- En almindelig bruger må kun se sine egne rækker.
set role authenticated;
set session "test.uid" = '00000000-0000-0000-0000-000000000001';
do $$ begin
  if exists (select 1 from public.milestones
             where user_id <> '00000000-0000-0000-0000-000000000001') then
    raise exception 'FEJL 9d: en bruger kan se andres milepæle';
  end if;
  if not exists (select 1 from public.milestones) then
    raise exception 'FEJL 9e: en bruger kan ikke se sine egne milepæle';
  end if;
end $$;
reset role;

\echo 'milestones: alle påstande holdt'
