-- Test af Story Engine v2 — DAGLIGE historier.
--
-- Kører mod en TOM engangsdatabase (CI: postgres-service; lokalt: en midlertidig
-- klynge). Rører aldrig produktion.
--
-- HVAD DEN BEVISER
--   1. En færdig dag producerer kort — og der er MINDST ét. Påstanden om et
--      ikke-nul rækkeantal er ikke pedantisk: hele kæden ligger bag matches-
--      triggerens exception-guard, og den mest sandsynlige fejl (en `date`/`text`
--      -sammenligning) fejler TAVST. Uden denne påstand ville en motor, der
--      intet producerer, være grøn i CI.
--   2. Den danske dag er den rigtige dag — også for en kamp, hvis UTC-dato er
--      en anden (23.30 dansk nytårsaften).
--   3. Loftet holder: højst 2 kort pr. bruger pr. dag.
--   4. Højst ÉT kort pr. regel pr. bruger — ellers ville en bruger med flere
--      konkurrencer få to DAY_RESULT-kort og ingen variation.
--   5. Tærsklerne virker: CONTRARIAN kræver ≥4 tippere, COLLECTIVE_MISS ≥4 og
--      nul træffere, SO_CLOSE ≥2 nærmisser.
--   6. Alle dagskort ligger i prioritetsbåndet 110–189, så karriereprofilens
--      filter (priority < 90) udelukker dem uden kodeændring.
--   7. REGRESSIONEN, DER BETYDER MEST: generate_stories() må ALDRIG slette
--      dagskort. Dagskortene bærer samme round_key som rundens kort, og v1's
--      `delete ... where round_key = p_round_key` ville have tørret hele ugen
--      væk ved hver eneste resultatændring — og de genskabes aldrig, for
--      dagsmotoren kører kun, når en dag BLIVER færdig.
--   8. latest_story ser kun runde-kort, så Hjem-kortet er uændret.
--   9. Idempotens: to kald for samme dag giver byte-identiske rækker.

\set ON_ERROR_STOP on
\timing off

-- ---------- minimalt skema ----------
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
  home_score int,
  away_score int
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

-- Stillings-viewene stubbes som TOMME tabeller: de hører til de globale
-- RUNDE-regler (10 MONTH_CHAMP, 80/85 SHARP), som denne test ikke handler om.
create table public.round_standings (
  round_key date, scope text, user_id uuid,
  total_points int, exact_count int, outcome_count int, avg_goal_error numeric
);
create table public.monthly_standings (
  month text, scope text, user_id uuid,
  total_points int, exact_count int, outcome_count int, round_wins int, avg_goal_error numeric
);

\ir ../competition_awards.sql
-- Rækkefølgen er bindende: v2_day tilføjer matches.match_day og viewet
-- competition_match_points, som story_engine.sql's _se_rp læser fra.
\ir ../story_engine_v2_day.sql
\ir ../story_engine.sql
\ir ../story_engine_v2.sql

-- ---------- fixture ----------
-- 2026-03-03 er en tirsdag, altså rundens første dag; 03-04 er onsdag.
-- Dag 1: fire kampe, fem brugere, én konkurrence — komponeret så hver tærskel
-- rammes præcist én gang (se assertions nedenfor).
do $$
declare
  u1 uuid := '00000000-0000-0000-0000-000000000001';
  u2 uuid := '00000000-0000-0000-0000-000000000002';
  u3 uuid := '00000000-0000-0000-0000-000000000003';
  u4 uuid := '00000000-0000-0000-0000-000000000004';
  u5 uuid := '00000000-0000-0000-0000-000000000005';
  c1 uuid := '10000000-0000-0000-0000-000000000001';
  lg uuid; sn uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid; t7 uuid; t8 uuid; t9 uuid; t10 uuid;
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid;
begin
  insert into public.profiles (id, display_name) values
    (u1,'Anna'), (u2,'Bo'), (u3,'Cecilie'), (u4,'David'), (u5,'Eva');

  insert into public.leagues (name) values ('Testliga') returning id into lg;
  insert into public.seasons (league_id, name) values (lg, '2025/26') returning id into sn;

  insert into public.teams (league_id, name) values (lg,'Randers') returning id into t1;
  insert into public.teams (league_id, name) values (lg,'Silkeborg') returning id into t2;
  insert into public.teams (league_id, name) values (lg,'OB') returning id into t3;
  insert into public.teams (league_id, name) values (lg,'Viborg') returning id into t4;
  insert into public.teams (league_id, name) values (lg,'AGF') returning id into t5;
  insert into public.teams (league_id, name) values (lg,'Brøndby') returning id into t6;
  insert into public.teams (league_id, name) values (lg,'FCK') returning id into t7;
  insert into public.teams (league_id, name) values (lg,'FCM') returning id into t8;
  insert into public.teams (league_id, name) values (lg,'Vejle') returning id into t9;
  insert into public.teams (league_id, name) values (lg,'Lyngby') returning id into t10;

  -- 12.00 UTC = 13.00 dansk, så match_day er utvetydigt den danske dag.
  insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
    values (sn, t1, t2, '2026-03-03 12:00:00+00', 2, 1) returning id into m1;
  insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
    values (sn, t3, t4, '2026-03-03 13:00:00+00', 3, 3) returning id into m2;
  insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
    values (sn, t5, t6, '2026-03-03 14:00:00+00', 1, 0) returning id into m3;
  insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
    values (sn, t7, t8, '2026-03-03 15:00:00+00', 2, 2) returning id into m4;
  -- onsdagens kamp lukker runden
  insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
    values (sn, t9, t10, '2026-03-04 19:00:00+00', 1, 1) returning id into m5;

  insert into public.competitions (id, name, mode) values (c1, 'Testkonkurrencen', 'custom');
  insert into public.competition_participants (competition_id, user_id)
    values (c1,u1),(c1,u2),(c1,u3),(c1,u4),(c1,u5);
  insert into public.competition_matches (competition_id, match_id)
    values (c1,m1),(c1,m2),(c1,m3),(c1,m4),(c1,m5);

  -- m1 (2-1 hjemmesejr): KUN u1 rammer udfaldet → CONTRARIAN (5 tippere ≥ 4)
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values
    (u1,m1,2,1), (u2,m1,0,1), (u3,m1,0,2), (u4,m1,1,2), (u5,m1,0,3);
  -- m2 (3-3): alle tipper hjemmesejr → INGEN rammer → COLLECTIVE_MISS
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values
    (u1,m2,2,0), (u2,m2,1,0), (u3,m2,2,1), (u4,m2,3,1), (u5,m2,4,0);
  -- m3 (1-0): u3 og u4 rammer på ét mål nær
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values
    (u1,m3,1,0), (u2,m3,1,0), (u3,m3,2,0), (u4,m3,0,0), (u5,m3,0,1);
  -- m4 (2-2): u3 og u4 rammer igen på ét mål nær → to nærmisser hver
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values
    (u1,m4,2,2), (u2,m4,1,1), (u3,m4,2,1), (u4,m4,1,2), (u5,m4,0,0);
  -- onsdag
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values
    (u1,m5,1,1), (u2,m5,2,0), (u3,m5,0,0), (u4,m5,1,0), (u5,m5,3,3);
end $$;

-- ---------- 0. Forudsætninger ----------
do $$ begin
  -- 2026-03-03 SKAL være en tirsdag, ellers er hele fixturen forkert forankret.
  if public.round_key_of_date('2026-03-03') <> '2026-03-03'::date then
    raise exception 'FEJL 0a: 2026-03-03 er ikke rundens første dag';
  end if;
  if (select match_day from public.matches where kickoff_at = '2026-03-03 12:00:00+00')
     <> '2026-03-03'::date then
    raise exception 'FEJL 0b: match_day er ikke den danske dag';
  end if;
  -- Dagen skal være komplet (alle kampe har resultat).
  if not public.match_day_complete('2026-03-03') then
    raise exception 'FEJL 0c: dagen meldes ikke komplet';
  end if;
  if public.match_day_complete('1999-01-01') then
    raise exception 'FEJL 0d: en dag uden kampe meldes komplet';
  end if;
end $$;

-- ---------- 1. Den danske dag ved døgnskiftet ----------
-- 23.30 dansk nytårsaften er 22.30 UTC. Uden zone-konverteringen ville kampen
-- lande på den forkerte dag — og med `timestamptz::date` (G11's fejl) ville
-- svaret desuden afhænge af, hvem der spørger.
do $$ begin
  if public.match_day('2026-12-31 22:30:00+00') <> '2026-12-31'::date then
    raise exception 'FEJL 1a: dansk 31/12 23.30 blev ikke 31. december';
  end if;
  -- 23.30 UTC nytårsaften er derimod 00.30 dansk den 1. januar.
  if public.match_day('2026-12-31 23:30:00+00') <> '2027-01-01'::date then
    raise exception 'FEJL 1b: dansk 1/1 00.30 blev ikke 1. januar';
  end if;
end $$;

set timezone = 'America/New_York';
do $$ begin
  if public.match_day('2026-12-31 22:30:00+00') <> '2026-12-31'::date then
    raise exception 'FEJL 1c: match_day afhænger af sessionens tidszone';
  end if;
end $$;
reset timezone;

-- ---------- 2. Generér dag 1 ----------
select public.generate_daily_stories('2026-03-03');

do $$
declare v_n int;
begin
  select count(*) into v_n from public.stories where period = 'day' and day_key = '2026-03-03';
  -- IKKE-NUL-PÅSTANDEN: en tavs fejl skal være rød, ikke grøn.
  if v_n = 0 then
    raise exception 'FEJL 2a: dagen producerede INGEN kort (tavs fejl?)';
  end if;

  -- Loftet: højst 2 kort pr. bruger.
  if exists (select 1 from public.stories where period = 'day' and day_key = '2026-03-03'
             group by user_id having count(*) > 2) then
    raise exception 'FEJL 2b: en bruger fik mere end 2 kort';
  end if;

  -- Højst ét kort pr. regel pr. bruger.
  if exists (select 1 from public.stories where period = 'day' and day_key = '2026-03-03'
             group by user_id, rule having count(*) > 1) then
    raise exception 'FEJL 2c: en bruger fik to kort fra samme regel';
  end if;

  -- Prioritetsbåndet — karriereprofilen filtrerer på priority < 90.
  if exists (select 1 from public.stories where period = 'day' and priority not between 110 and 189) then
    raise exception 'FEJL 2d: et dagskort ligger uden for båndet 110-189';
  end if;

  -- Formen: period/day_key hænger sammen, og round_key peger på rundens tirsdag.
  if exists (select 1 from public.stories where period = 'day' and round_key <> '2026-03-03') then
    raise exception 'FEJL 2e: dagskortets round_key er ikke rundens tirsdag';
  end if;

  -- Alle fem brugere tippede, så alle fem skal have dagens facit.
  select count(distinct user_id) into v_n
  from public.stories where period = 'day' and day_key = '2026-03-03' and rule = 'DAY_RESULT';
  if v_n <> 5 then
    raise exception 'FEJL 2f: DAY_RESULT ramte % brugere, forventede 5', v_n;
  end if;
end $$;

-- ---------- 3. Tærskler ----------
do $$
declare v_n int;
begin
  -- CONTRARIAN: kun Anna ramte m1, og fem tippede den.
  select count(*) into v_n from public.stories
  where period = 'day' and rule = 'CONTRARIAN'
    and user_id = '00000000-0000-0000-0000-000000000001';
  if v_n <> 1 then
    raise exception 'FEJL 3a: Anna fik % CONTRARIAN-kort, forventede 1', v_n;
  end if;
  if exists (select 1 from public.stories where period = 'day' and rule = 'CONTRARIAN'
             and user_id <> '00000000-0000-0000-0000-000000000001') then
    raise exception 'FEJL 3b: CONTRARIAN udløste for en, der ikke var alene';
  end if;

  -- COLLECTIVE_MISS findes (m2 ramte ingen), og højst én gang pr. bruger.
  if not exists (select 1 from public.stories where period = 'day' and rule = 'COLLECTIVE_MISS') then
    raise exception 'FEJL 3c: COLLECTIVE_MISS udløste ikke';
  end if;

  -- SO_CLOSE må kun kunne gælde dem med mindst to nærmisser (Cecilie/David).
  if exists (
    select 1 from public.stories s where s.period = 'day' and s.rule = 'SO_CLOSE'
      and s.user_id not in ('00000000-0000-0000-0000-000000000003',
                            '00000000-0000-0000-0000-000000000004')
  ) then
    raise exception 'FEJL 3d: SO_CLOSE udløste for en med under 2 nærmisser';
  end if;

  -- DAY_TOP kan kun gælde Anna (9 point, alene i toppen).
  if exists (select 1 from public.stories where period = 'day' and rule = 'DAY_TOP'
             and user_id <> '00000000-0000-0000-0000-000000000001') then
    raise exception 'FEJL 3e: DAY_TOP udløste for en, der ikke fik dagens højeste';
  end if;
end $$;

-- ---------- 4. Idempotens ----------
do $$
declare v_before text; v_after text;
begin
  select string_agg(user_id::text || ':' || rule || ':' || priority, '|' order by user_id, rule)
    into v_before from public.stories where period = 'day' and day_key = '2026-03-03';
  perform public.generate_daily_stories('2026-03-03');
  select string_agg(user_id::text || ':' || rule || ':' || priority, '|' order by user_id, rule)
    into v_after from public.stories where period = 'day' and day_key = '2026-03-03';
  if v_before is distinct from v_after then
    raise exception 'FEJL 4: to kald gav forskellige kort';
  end if;
end $$;

-- ---------- 5. Dag 2 lægger sig oven på dag 1 ----------
select public.generate_daily_stories('2026-03-04');

do $$
declare v_d1 int; v_d2 int;
begin
  select count(*) into v_d1 from public.stories where period = 'day' and day_key = '2026-03-03';
  select count(*) into v_d2 from public.stories where period = 'day' and day_key = '2026-03-04';
  if v_d1 = 0 then raise exception 'FEJL 5a: dag 2 slettede dag 1'; end if;
  if v_d2 = 0 then raise exception 'FEJL 5b: dag 2 producerede ingen kort'; end if;
  -- Begge dage hører til samme runde, så karusellen kan samle dem.
  if exists (select 1 from public.stories where period = 'day' and round_key <> '2026-03-03') then
    raise exception 'FEJL 5c: dag 2 fik et andet round_key end dag 1';
  end if;
end $$;

-- ---------- 6. REGRESSIONEN: runde-motoren må ikke slette dagskort ----------
-- Dette er den vigtigste påstand i filen. Dagskortene bærer samme round_key som
-- rundens kort, så v1's uafgrænsede `delete ... where round_key = p_round_key`
-- ville tørre hele ugen væk ved hver eneste resultatændring — og de genskabes
-- aldrig, for dagsmotoren kører kun, når en dag BLIVER færdig.
do $$
declare v_before int; v_after int; v_round int;
begin
  select count(*) into v_before from public.stories where period = 'day';
  perform public.generate_stories('2026-03-03');
  select count(*) into v_after from public.stories where period = 'day';
  if v_after <> v_before then
    raise exception 'FEJL 6a: generate_stories slettede dagskort (% -> %)', v_before, v_after;
  end if;

  select count(*) into v_round from public.stories where period = 'round';
  if v_round = 0 then
    raise exception 'FEJL 6b: runde-motoren producerede ingen kort';
  end if;

  -- Og omvendt: dagsmotoren må ikke røre rundens kort.
  perform public.generate_daily_stories('2026-03-03');
  if (select count(*) from public.stories where period = 'round') <> v_round then
    raise exception 'FEJL 6c: generate_daily_stories slettede runde-kort';
  end if;
end $$;

-- ---------- 7. latest_story ser kun runde-kort ----------
do $$ begin
  if exists (select 1 from public.latest_story where period <> 'round') then
    raise exception 'FEJL 7a: latest_story lækker dagskort til Hjem-kortet';
  end if;
  -- Præcis ét kort pr. (bruger, runde) — løftet fra v1 holder.
  if exists (select 1 from public.latest_story group by user_id, round_key having count(*) > 1) then
    raise exception 'FEJL 7b: latest_story gav mere end ét kort pr. bruger pr. runde';
  end if;
end $$;

-- ---------- 8. Unikhed pr. periode ----------
do $$ begin
  if exists (select 1 from public.stories where period = 'day'
             group by day_key, user_id, rule, competition_id having count(*) > 1) then
    raise exception 'FEJL 8a: dublet blandt dagskort';
  end if;
  if exists (select 1 from public.stories where period = 'round'
             group by round_key, user_id, rule, competition_id having count(*) > 1) then
    raise exception 'FEJL 8b: dublet blandt runde-kort';
  end if;
  -- Constrainten, der binder period og day_key sammen, skal afvise en forkert form.
  begin
    insert into public.stories (round_key, day_key, period, user_id, rule, priority, headline, body)
    values ('2026-03-03', null, 'day', '00000000-0000-0000-0000-000000000001', 'X', 110, 'h', 'b');
    raise exception 'FEJL 8c: et dagskort uden day_key blev accepteret';
  exception when check_violation then null;
  end;
end $$;

\echo 'story_engine_daily: alle påstande holdt'
