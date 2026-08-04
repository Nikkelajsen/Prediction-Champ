-- Test af Story Engine v1.2's to kåringsregler (B10) — AWARD_WEEK og AWARD_MONTH.
--
-- Kører mod en TOM engangsdatabase (CI: postgres-service; lokalt: en midlertidig
-- klynge). Rører aldrig produktion. Samme mønster som competition_awards.sql,
-- som den også bygger direkte videre på: kåringsrækkerne skrives af
-- `award_competition_periods()` og LÆSES af `generate_stories()`.
--
-- HVAD DEN BEVISER
--   1. En kåret runde giver ét AWARD_WEEK-kort pr. vinder, med prioritet 65.
--   2. Regel 70 (ROUND_WON) tier for præcis den (bruger, konkurrence, runde),
--      en kåring dækker — men bliver ved med at virke i en konkurrence UDEN
--      opt-in. Det er hele pointen med guarden: ét øjeblik, ét kort.
--   3. Delt kåring giver "delt Ugens bedste" til begge vindere.
--   4. AWARD_MONTH hører til den FØRSTE runde i en ny måned og ingen andre.
--   5. latest_story vælger månedskåringen (15) over ugekåringen (65), som igen
--      slår rundens vinder (70) — stigen holder hele vejen.
--   6. Idempotens: to kald for samme runde giver byte-identiske rækker.
--
-- HVORFOR TESTEN ER VÆRD AT HAVE: kæden går gennem tre filer og to
-- skrivetidspunkter (kåringen skrives lazy, historien genereres af en trigger),
-- og fejler den, fejler den TAVST — matches-triggeren er exception-guarded, så
-- et manglende kort ikke kan skelnes fra en stille uge.

\set ON_ERROR_STOP on
\timing off

-- ---------- minimalt skema ----------
-- Samme stub som competition_awards.sql: auth.uid()/auth.role() via
-- session-GUC'er, så testen kan skifte mellem en deltager og service_role.
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

-- round_key(), pc_points(), ratings og rating_history kommer herfra.
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

-- Stillings-viewene stubbes som TOMME tabeller. De hører til de globale regler
-- (10 MONTH_CHAMP og 80/85 SHARP), som denne test ikke handler om — og en tom
-- stilling er den reneste måde at holde dem ude af vejen på, så en fejl her
-- ikke kan forveksles med en fejl i kåringsreglerne.
create table public.round_standings (
  round_key date, scope text, user_id uuid,
  total_points int, exact_count int, outcome_count int, avg_goal_error numeric
);
create table public.monthly_standings (
  month text, scope text, user_id uuid,
  total_points int, exact_count int, outcome_count int, round_wins int, avg_goal_error numeric
);

\ir ../competition_awards.sql
-- Rækkefølgen er bindende (Story Engine v2): v2_day tilføjer matches.match_day
-- og viewet competition_match_points, som generate_stories' _se_rp læser fra;
-- v2 tilføjer stories.period, som dens periode-afgrænsede delete filtrerer på.
-- story_engine.sql skal ligge imellem, fordi den opretter selve stories-tabellen.
\ir ../story_engine_v2_day.sql
\ir ../story_engine.sql
\ir ../story_engine_v2.sql

-- ---------- fixture ----------
-- To konkurrencer på de samme kampe: c1 har tilvalgt kåringer, c2 har ikke.
-- Forrige måned: r0 (u1 og u2 tipper identisk → delt sejr) og r1 (u1 alene).
-- Denne måned: rN = den første tirsdag i måneden, én spillet kamp.
do $$
declare
  u1 uuid := '00000000-0000-0000-0000-000000000001';
  u2 uuid := '00000000-0000-0000-0000-000000000002';
  u4 uuid := '00000000-0000-0000-0000-000000000004';
  c1 uuid := '10000000-0000-0000-0000-000000000001'; -- opt-in
  c2 uuid := '10000000-0000-0000-0000-000000000002'; -- UDEN opt-in
  lg uuid; sn uuid;
  prev date := (date_trunc('month', now() at time zone 'Europe/Copenhagen') - interval '1 month')::date;
  d1 date := date_trunc('month', now() at time zone 'Europe/Copenhagen')::date;
  tue date;   -- runde i forrige måned (samme forankring som competition_awards-testen)
  tue_new date; -- første tirsdag i DENNE måned ⇒ forrige uge ligger i forrige måned
  m01 uuid; m02 uuid; m1 uuid; m2 uuid; mN uuid;
begin
  tue := public.round_key((prev + 10)::timestamptz);
  -- Første tirsdag på eller efter den 1.: så ligger tue_new − 7 pr. definition i
  -- den forrige måned, hvilket er præcis regel 15's betingelse.
  tue_new := d1 + ((2 - extract(isodow from d1)::int + 7) % 7);

  insert into auth.users (id) values (u1), (u2), (u4);
  insert into public.profiles (id, display_name) values (u1, 'Anna'), (u2, 'Bo'), (u4, 'Dan');
  insert into public.leagues (name) values ('Testligaen') returning id into lg;
  insert into public.seasons (league_id, name) values (lg, '2026/27') returning id into sn;

  insert into public.matches (season_id, kickoff_at, home_score, away_score)
    values (sn, tue, 1, 1) returning id into m01;
  insert into public.matches (season_id, kickoff_at, home_score, away_score)
    values (sn, tue + 1, 2, 0) returning id into m02;
  insert into public.matches (season_id, kickoff_at, home_score, away_score)
    values (sn, tue + 7, 2, 1) returning id into m1;
  insert into public.matches (season_id, kickoff_at, home_score, away_score)
    values (sn, tue + 8, 0, 0) returning id into m2;
  insert into public.matches (season_id, kickoff_at, home_score, away_score)
    values (sn, tue_new + 1, 3, 0) returning id into mN;

  insert into public.competitions (id, name, mode_params) values
    (c1, 'Kontorligaen', '{"awards": true}'),
    (c2, 'Familien',     '{}');
  insert into public.competition_matches (competition_id, match_id)
    select c, m from (values (c1), (c2)) cs(c), unnest(array[m01, m02, m1, m2, mN]) m;
  insert into public.competition_participants (competition_id, user_id) values
    (c1, u1), (c1, u2), (c1, u4),
    (c2, u1), (c2, u2), (c2, u4);

  -- r0: u1 og u2 tipper identisk og perfekt → 6 point hver, delt sejr
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values
    (u1, m01, 1, 1), (u1, m02, 2, 0),
    (u2, m01, 1, 1), (u2, m02, 2, 0),
  -- r1: u1 får 3+1 = 4, u2 får 1+0 = 1 → u1 vinder alene
    (u1, m1, 2, 1), (u1, m2, 1, 1),
    (u2, m1, 1, 0), (u2, m2, 2, 1),
  -- rN: u1 rammer præcist, u2 rammer udfaldet
    (u1, mN, 3, 0), (u2, mN, 2, 0);
end $$;

-- Kåringerne skrives som service_role — præcis den vej, notifikations-jobbet
-- bruger (B11), og den, der gør regel 65/15 pålidelig i drift.
do $$
declare n int;
begin
  perform set_config('test.uid', '', false);
  perform set_config('test.role', 'service_role', false);
  n := public.award_competition_periods('10000000-0000-0000-0000-000000000001');
  -- r0 (2 delte) + r1 (1) + rN (1) + forrige måned (1) = 5
  if n <> 5 then raise exception 'forventede 5 kåringsrækker, fik %', n; end if;
end $$;

-- ---------- 1) Ugens bedste: kort, prioritet og delt formulering ----------
do $$
declare
  tue date := public.round_key(((date_trunc('month', now() at time zone 'Europe/Copenhagen') - interval '1 month')::date + 10)::timestamptz);
  n int;
begin
  perform public.generate_stories(tue::text);

  select count(*) into n from public.stories
  where round_key = tue::text and rule = 'AWARD_WEEK'
    and competition_id = '10000000-0000-0000-0000-000000000001' and priority = 65;
  if n <> 2 then raise exception 'r0 skulle give to AWARD_WEEK-kort (delt sejr), fik %', n; end if;

  if not exists (select 1 from public.stories
    where round_key = tue::text and rule = 'AWARD_WEEK'
      and headline like '%delt Ugens bedste i Kontorligaen%'
      and body like '6 point%(delt med 1 anden).')
  then raise exception 'den delte kåring formuleres ikke som delt'; end if;

  -- 2) ROUND_WON tier for den konkurrence, kåringen dækker …
  if exists (select 1 from public.stories
    where round_key = tue::text and rule = 'ROUND_WON'
      and competition_id = '10000000-0000-0000-0000-000000000001')
  then raise exception 'ROUND_WON blev skrevet oven i en kåring'; end if;

  -- … men virker uændret i konkurrencen uden opt-in.
  select count(*) into n from public.stories
  where round_key = tue::text and rule = 'ROUND_WON'
    and competition_id = '10000000-0000-0000-0000-000000000002';
  if n <> 2 then raise exception 'konkurrencen uden kåringer skulle stadig have 2 ROUND_WON, fik %', n; end if;

  -- Regel 15 hører ikke til her: runden er ikke den første i sin måned.
  if exists (select 1 from public.stories where round_key = tue::text and rule = 'AWARD_MONTH')
  then raise exception 'AWARD_MONTH udløste i en runde midt i måneden'; end if;
end $$;

-- ---------- 3) Ugekåring uden deling ----------
do $$
declare
  tue date := public.round_key(((date_trunc('month', now() at time zone 'Europe/Copenhagen') - interval '1 month')::date + 10)::timestamptz) + 7;
begin
  perform public.generate_stories(tue::text);
  if not exists (select 1 from public.stories
    where round_key = tue::text and rule = 'AWARD_WEEK'
      and user_id = '00000000-0000-0000-0000-000000000001'
      and headline like '🏅 Du er Ugens bedste i Kontorligaen'
      and body like '4 point — flest af alle i Kontorligaen i runden %.')
  then raise exception 'r1 skulle give u1 et udelt AWARD_WEEK-kort'; end if;

  if exists (select 1 from public.stories where round_key = tue::text and rule = 'AWARD_WEEK'
             and user_id = '00000000-0000-0000-0000-000000000002')
  then raise exception 'u2 fik en ugekåring uden at vinde runden'; end if;
end $$;

-- ---------- 4+5) Månedens bedste i den første runde af en ny måned ----------
do $$
declare
  d1 date := date_trunc('month', now() at time zone 'Europe/Copenhagen')::date;
  tue_new date := d1 + ((2 - extract(isodow from d1)::int + 7) % 7);
  mk text := to_char((date_trunc('month', now() at time zone 'Europe/Copenhagen') - interval '1 month'), 'YYYY-MM');
  valgt text;
begin
  perform public.generate_stories(tue_new::text);

  if not exists (select 1 from public.stories
    where round_key = tue_new::text and rule = 'AWARD_MONTH' and priority = 15
      and user_id = '00000000-0000-0000-0000-000000000001'
      and headline like '👑 Du er Månedens bedste i Kontorligaen — %')
  then raise exception 'månedskåringen for % gav intet AWARD_MONTH-kort', mk; end if;

  -- Kun vinderen: u2 vandt ikke måneden.
  if exists (select 1 from public.stories where round_key = tue_new::text and rule = 'AWARD_MONTH'
             and user_id = '00000000-0000-0000-0000-000000000002')
  then raise exception 'en ikke-vinder fik en månedskåring'; end if;

  -- Stigen: u1 har både AWARD_MONTH (15), AWARD_WEEK (65) og evt. andet i
  -- samme runde — latest_story skal vælge månedskåringen.
  select rule into valgt from public.latest_story
  where round_key = tue_new::text and user_id = '00000000-0000-0000-0000-000000000001';
  if valgt is distinct from 'AWARD_MONTH'
  then raise exception 'latest_story valgte % frem for AWARD_MONTH', valgt; end if;
end $$;

-- ---------- 6) Idempotens ----------
-- Samme regel som resten af motoren: en gen-kørsel af en runde må give
-- byte-identiske rækker. Uden den kan en historie skifte tekst under
-- brugerens fødder, hver gang et resultat rettes.
do $$
declare
  tue date := public.round_key(((date_trunc('month', now() at time zone 'Europe/Copenhagen') - interval '1 month')::date + 10)::timestamptz);
  f text; e text;
begin
  select md5(string_agg(x, '|' order by x)) into f
  from (select user_id::text || rule || priority::text || headline || body as x
        from public.stories where round_key = tue::text) s;
  perform public.generate_stories(tue::text);
  select md5(string_agg(x, '|' order by x)) into e
  from (select user_id::text || rule || priority::text || headline || body as x
        from public.stories where round_key = tue::text) s;
  if f is distinct from e then raise exception 'gen-kørsel ændrede rundens historier'; end if;
end $$;

select 'story_engine_awards: OK' as result;
