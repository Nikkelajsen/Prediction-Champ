-- SKALERINGSFORSØG for Story Engine v2's dagsmotor. Lokalt benchmark.
--
-- KØRER IKKE I CI. Den er ikke en test — den påstår ingenting og kan ikke være
-- rød. Den bygger en SYNTETISK fuld sæson og måler, hvad dagsmotoren koster,
-- når datamængden er den, produktionen har om ni måneder.
--
-- HVORFOR DEN FINDES
--
-- Målingen på produktionsdata (august 2026, `sql/story_engine_v2_measure.sql`)
-- gav 23 ms i gennemsnit — men databasen indeholdt kun **18 spillede kampe** og
-- 285 rækker i `competition_match_points`. Tallet var altså beroligende og
-- samtidig uden informationsværdi: dagsmotorens tunge del er opbygningen af
-- `_sd_pts`, som er kumulativ (`match_day <= p_day`) og derfor vokser hele
-- sæsonen igennem, mens motoren kører ~5 gange om ugen. Spørgsmålet er ikke,
-- hvad den koster nu, men hvad den koster i maj.
--
-- Det spørgsmål kan besvares uden at vente ni måneder — og uden adgang til
-- produktion.
--
-- MÅLESTOKKEN er den samme som i produktionsmålingen: `recompute_ratings()`,
-- som triggeren kører ved HVER resultatændring, mod dagsmotoren, som kun kører,
-- når en dag bliver færdig. Grænsen for at flytte dagsmotoren ud af triggeren
-- er ~1 s (docs/features/story-engine-v2.md §11).
--
-- Kørsel (kræver en tom engangsdatabase, ikke produktion):
--   createdb scaletest
--   psql -d scaletest -v ON_ERROR_STOP=1 -b -f story_engine_scale.sql

\set ON_ERROR_STOP on
\timing off

-- ---------- skema (samme stub som story_engine_daily.sql) ----------
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
  id uuid primary key default gen_random_uuid(), name text not null,
  is_official boolean not null default true);
create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade, name text);
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete cascade, name text not null);
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  home_team_id uuid references public.teams(id),
  away_team_id uuid references public.teams(id),
  kickoff_at timestamptz not null,
  round_key date generated always as (public.round_key(kickoff_at)) stored,
  home_score int, away_score int);
create table public.predictions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  pred_home int, pred_away int, primary key (user_id, match_id));
create table public.competitions (
  id uuid primary key default gen_random_uuid(), name text not null,
  mode text not null default 'custom', mode_params jsonb not null default '{}'::jsonb,
  created_by uuid);
create table public.competition_matches (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  primary key (competition_id, match_id));
create table public.competition_participants (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (competition_id, user_id));
-- `matches` er med, fordi build_round_frames() læser den til frame 1. Den findes
-- i det rigtige view (sql/tournament_scope.sql); en stub uden den ville fejle
-- inde i funktionen frem for i en måling.
create table public.round_standings (
  round_key date, scope text, user_id uuid, matches int,
  total_points int, exact_count int, outcome_count int, avg_goal_error numeric);
create table public.monthly_standings (
  month text, scope text, user_id uuid, total_points int, exact_count int,
  outcome_count int, round_wins int, avg_goal_error numeric);
create table public.season_standings (
  season_id uuid, user_id uuid, total_points int, exact_count int,
  outcome_count int, round_wins int, avg_goal_error numeric);
create table public.groups (
  id uuid primary key default gen_random_uuid(), name text not null,
  created_by uuid not null references public.profiles(id) on delete cascade);
create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (group_id, user_id));
create table public.analytics_completion_facts (
  user_id uuid, competition_id uuid, match_id uuid, round_key date, predicted boolean);

\ir ../competition_awards.sql
\ir ../story_engine_v2_day.sql
\ir ../story_engine.sql
\ir ../story_engine_v2.sql
\ir ../milestones.sql
-- #68 FØR #47: dagsmotoren kalder users_with_complete_day(), og filen bærer
-- desuden de to indekser, hele A39s ydelse hviler på — uden dem måler forsøget
-- en seq scan af competition_matches ved hvert kald og melder A39 langt dyrere,
-- end den er.
\ir ../story_engine_personal_day.sql
-- v3 SKAL indlæses efter v2 og milestones: den erstatter generate_daily_stories
-- med scorings-udgaven og tilføjer build_round_frames + apply_milestone_stories.
-- Uden linjen ville forsøget måle v2's motor og melde v3 billigere, end den er.
\ir ../story_engine_v3.sql
-- ... og story_engine.sql gen-køres, fordi runde-motoren nu kalder
-- build_round_frames() til sidst. Frames-bygningen er en del af det, en
-- rundeafslutning koster, og skal med i den værste sætning nedenfor.
\ir ../story_engine.sql

-- ---------- syntetisk fuld sæson ----------
-- Dimensionerne er valgt, så de ligner produktionen ni måneder senere:
-- seks turneringer, en sæson hver, 300 kampe pr. sæson (1800 i alt) spredt over
-- 150 kampdage, 40 spillere og syv konkurrencer.
--
-- BEVIDST PESSIMISTISK på ét punkt: hver spiller tipper HVER kamp. Det er
-- overkanten af, hvad en rigtig bruger gør, og det er meningen — forsøget skal
-- vise loftet, ikke gennemsnittet.
insert into public.leagues (name) select 'Liga ' || g from generate_series(1, 6) g;
insert into public.seasons (league_id, name) select id, '2026/27' from public.leagues;
insert into public.teams (league_id, name)
  select l.id, 'Hold ' || l.name || '-' || t from public.leagues l, generate_series(1, 20) t;

insert into public.profiles (id, display_name)
  select ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'Spiller ' || lpad(g::text, 2, '0')
  from generate_series(1, 40) g;

-- 300 kampe pr. sæson: to om dagen i 150 dage.
insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
select s.id, th.id, ta.id,
       timestamptz '2026-08-01 12:00:00+00'
         + ((g / 2) * interval '1 day') + ((g % 2) * interval '3 hours'),
       (g % 4), ((g / 3) % 3)
from public.seasons s
cross join generate_series(0, 299) g
join lateral (select id from public.teams where league_id = s.league_id
              order by name offset (g % 20) limit 1) th on true
join lateral (select id from public.teams where league_id = s.league_id
              order by name offset ((g + 7) % 20) limit 1) ta on true;

-- created_by sættes, fordi kolonnen er NOT NULL i produktion; en fixture uden
-- den ville måle noget, der ikke kan findes.
insert into public.competitions (name, mode, created_by)
  select 'Konkurrence ' || g, 'custom',
         (select id from public.profiles order by display_name offset (g - 1) limit 1)
  from generate_series(1, 7) g;

-- ~11 deltagere pr. konkurrence: fem går igen i alle (de aktive), resten fordeles.
insert into public.competition_participants (competition_id, user_id)
select c.id, p.id
from (select id, row_number() over (order by name) rn from public.competitions) c
join (select id, row_number() over (order by display_name) rn from public.profiles) p
  on (p.rn % 7) = (c.rn % 7) or p.rn <= 5;

-- Konkurrence 1 dækker alle turneringer; de øvrige hver sin.
insert into public.competition_matches (competition_id, match_id)
select c.id, m.id
from (select id, row_number() over (order by name) rn from public.competitions) c
cross join public.matches m
join public.seasons s on s.id = m.season_id
join (select id, row_number() over (order by name) rn from public.leagues) l on l.id = s.league_id
where c.rn = 1 or (l.rn % 7) = (c.rn % 7);

-- Hver spiller tipper hver kamp (loftet, ikke gennemsnittet).
insert into public.predictions (user_id, match_id, pred_home, pred_away)
select p.id, m.id,
       (abs(hashtext(p.id::text || m.id::text)) % 4),
       (abs(hashtext(m.id::text || p.id::text)) % 3)
from public.profiles p cross join public.matches m;

-- Ligaer og medlemskaber, så fællesskabs-milepælene har noget at læse.
insert into public.groups (name, created_by)
  select 'Liga-fællesskab ' || p.rn, p.id
  from (select id, row_number() over (order by display_name) rn from public.profiles) p
  where p.rn <= 5;
insert into public.group_members (group_id, user_id)
  select g.id, p.id from public.groups g cross join public.profiles p;

-- analytics_completion_facts i den grain, viewet har i produktion:
-- (bruger, konkurrence, kamp) for hver deltager i hver af konkurrencens kampe.
insert into public.analytics_completion_facts (user_id, competition_id, match_id, round_key, predicted)
select cp.user_id, cm.competition_id, m.id, m.round_key, true
from public.competition_participants cp
join public.competition_matches cm on cm.competition_id = cp.competition_id
join public.matches m on m.id = cm.match_id;

analyze;

-- ---------- måling ----------
drop table if exists _scale;
create temporary table _scale (ord int, maaling text, vaerdi text);

do $$
begin
  insert into _scale values
    (10, 'kampe (spillede)',            (select count(*) from public.matches)::text),
    (11, 'predictions',                 (select count(*) from public.predictions)::text),
    (12, 'competition_matches',         (select count(*) from public.competition_matches)::text),
    (13, 'deltager-rækker',             (select count(*) from public.competition_participants)::text),
    (14, 'competition_match_points (= _sd_pts)',
                                        (select count(*) from public.competition_match_points)::text),
    (15, 'analytics_completion_facts',  (select count(*) from public.analytics_completion_facts)::text);
end $$;

-- Dagsmotoren målt SENT i sæsonen, hvor _sd_pts er størst — det er dér, loftet
-- ligger. Tre kørsler, så tallet ikke er en tilfældig cache-tilstand.
--
-- BEMÆRK — DAGEN MÅ IKKE VÆRE RUNDENS SIDSTE. Efter v3 returnerer motoren med
-- det samme på rundens sidste kampdag (kun rundekortet taler den dag), så en
-- måling dér ville vise 0,1 ms og påstå, at dagsmotoren er gratis. Vi vælger
-- derfor den seneste kampdag, som har en kampdag efter sig i sin egen runde.
do $$
declare
  d date; v_start timestamptz; v_ms numeric; v_best numeric; i int;
begin
  select max(m.match_day) into d
  from public.matches m
  where exists (select 1 from public.matches m2
                where m2.round_key = m.round_key and m2.match_day > m.match_day);
  if d is null then
    raise exception 'skalering: ingen dag med en senere kampdag i samme runde';
  end if;

  for i in 1..3 loop
    v_start := clock_timestamp();
    perform public.generate_daily_stories(d);
    v_ms := extract(epoch from clock_timestamp() - v_start) * 1000;
    if v_best is null or v_ms < v_best then v_best := v_ms; end if;
    insert into _scale values (20 + i, 'generate_daily_stories, sen dag (' || i || '.)',
      round(v_ms, 1)::text || ' ms');
  end loop;

  -- Til sammenligning: den FØRSTE dag, hvor _sd_pts stort set er tom. Forskellen
  -- mellem de to er den kumulative vækst, altså det, målingen handler om.
  select min(match_day) into d from public.matches;
  v_start := clock_timestamp();
  perform public.generate_daily_stories(d);
  insert into _scale values (30, 'generate_daily_stories, FØRSTE dag',
    round(extract(epoch from clock_timestamp() - v_start) * 1000, 1)::text || ' ms');
end $$;

do $$
declare r date; v_start timestamptz;
begin
  select max(round_key) into r from public.matches;
  v_start := clock_timestamp();
  perform public.generate_stories(r::text);
  insert into _scale values (40, 'generate_stories (runde-motoren)',
    round(extract(epoch from clock_timestamp() - v_start) * 1000, 1)::text || ' ms');

  v_start := clock_timestamp();
  perform public.recompute_ratings();
  insert into _scale values (50, 'recompute_ratings (REFERENCEN)',
    round(extract(epoch from clock_timestamp() - v_start) * 1000, 1)::text || ' ms');

  -- Milepælene kører i SAMME trigger-sætning som resten, når en runde bliver
  -- komplet. Første kald uddeler; andet kald er det, produktionen betaler ved
  -- hver efterfølgende rundeafslutning (alt er allerede uddelt).
  v_start := clock_timestamp();
  perform public.award_milestones(null);
  insert into _scale values (60, 'award_milestones, 1. kald (uddeler)',
    round(extract(epoch from clock_timestamp() - v_start) * 1000, 1)::text || ' ms');

  v_start := clock_timestamp();
  perform public.award_milestones(null);
  insert into _scale values (61, 'award_milestones, 2. kald (normaltilfældet)',
    round(extract(epoch from clock_timestamp() - v_start) * 1000, 1)::text || ' ms');
end $$;

-- ---------- Værste sætning: rundeafslutning ----------
-- Den dag en runde bliver komplet, kører ALT i én og samme sætning inde i
-- sync-live's upsert: rating, dagens kort, rundens kort og milepælene. Det er
-- dette tal, der afgør, om noget skal ud af triggeren — ikke delene hver for sig.
do $$
declare v_start timestamptz; d date; r date;
begin
  select max(match_day) into d from public.matches;
  select max(round_key) into r from public.matches;

  -- Sådan som triggeren rent faktisk ser ud efter v2.1: rating, dagens kort og
  -- rundens kort. Milepælene er FLYTTET UD og kaldes kun af cron-jobbet.
  v_start := clock_timestamp();
  perform public.recompute_ratings();
  perform public.generate_daily_stories(d);
  perform public.generate_stories(r::text);

  insert into _scale values (70, '=== VÆRSTE TRIGGER-SÆTNING (rundeafslutning) ===',
    round(extract(epoch from clock_timestamp() - v_start) * 1000, 1)::text || ' ms');

  -- Til sammenligning: hvad den ville have kostet med milepælene indeni.
  v_start := clock_timestamp();
  perform public.recompute_ratings();
  perform public.generate_daily_stories(d);
  perform public.generate_stories(r::text);
  perform public.award_milestones(null);

  insert into _scale values (71, '(samme, hvis milepæle stod i triggeren)',
    round(extract(epoch from clock_timestamp() - v_start) * 1000, 1)::text || ' ms');
end $$;

select maaling, vaerdi from _scale order by ord;
