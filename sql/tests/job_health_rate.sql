-- Test af driftskortets fejlrate (sql/job_health_rate.sql, G115).
--
-- Kører mod en TOM engangsdatabase. Rører aldrig produktion. Samme mønster som
-- client_errors.sql.
--
-- HVAD DEN BEVISER
--   1. `admin_job_health()` afviser en ikke-admin og svarer en admin — vagten
--      overlevede det `drop function`, ændringen krævede, og det samme gjorde
--      `grant execute`.
--   2. **Den, hele filen findes for:** et job, der fejler to ud af tre
--      kørsler, men hvis SENESTE kørsel lykkedes, har `consecutive_failures`
--      = 0 og `recent_failures` = 40. Det var tilstanden 14. august 2026, hvor
--      Drift stod grøn i en time, mens live-syncen var nede.
--   3. Vinduet er 24 timer: kørsler ældre end det tælles ikke med.
--   4. En kørsel, der aldrig nåede at afslutte (`ok is null`), tæller som en
--      fejl — samme regel som fejlserien allerede bruger.
--   5. Et job uden kørsler i vinduet får 0 og ikke null: tavshed er
--      `last_run_at`s opgave, ikke ratens.

\set ON_ERROR_STOP on
\timing off

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table if not exists auth.users (id uuid primary key);
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
grant usage on schema public to authenticated;

create table public.profiles (id uuid primary key, display_name text, is_admin boolean default false);

\ir ../job_runs.sql
\ir ../job_health_rate.sql

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');
insert into public.profiles (id, display_name, is_admin) values
  ('00000000-0000-0000-0000-000000000001', 'Nikolaj', true),
  ('00000000-0000-0000-0000-000000000002', 'Bo', false);

-- ---------------------------------------------------------------------------
-- Data: G109-formen, gengivet præcist.
--
-- 60 kørsler af `sync-live` inden for den sidste time. To ud af tre fejlede,
-- og den NYESTE lykkedes — det er den kombination, fejlserien ikke kan se.
-- ---------------------------------------------------------------------------
insert into public.job_runs (job, started_at, finished_at, ok, detail, error)
select
  'sync-live',
  now() - (i || ' minutes')::interval,
  now() - (i || ' minutes')::interval,
  -- i = 0 er den nyeste og skal lykkes. Derefter fejler to ud af tre.
  (i % 3 = 0),
  jsonb_build_object('checked', 1),
  case when i % 3 = 0 then null else 'Tidsgrænse: intet svar' end
from generate_series(0, 59) as i;

-- Et kampprogram-job: to kørsler i døgnet, begge grønne, plus en gammel fejl
-- LIGE UDEN FOR vinduet. Den må ikke tælle med.
insert into public.job_runs (job, started_at, finished_at, ok, error) values
  ('sync-matches:a', now() - interval '2 hours',  now() - interval '2 hours',  true,  null),
  ('sync-matches:a', now() - interval '14 hours', now() - interval '14 hours', true,  null),
  ('sync-matches:a', now() - interval '25 hours', now() - interval '25 hours', false, 'gammel fejl');

-- Et job, hvis eneste kørsel ligger uden for vinduet: 0 kørsler målt, ikke null.
insert into public.job_runs (job, started_at, finished_at, ok) values
  ('send-notifications', now() - interval '3 days', now() - interval '3 days', true);

-- En kørsel, der aldrig nåede at afslutte (`ok is null`) — tæller som fejl.
insert into public.job_runs (job, started_at, finished_at, ok) values
  ('afbrudt-job', now() - interval '10 minutes', null, null),
  ('afbrudt-job', now() - interval '20 minutes', null, true);

-- ---------- 1) vagten ----------
select set_config('test.uid', '00000000-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
begin
  begin
    perform 1 from public.admin_job_health();
    raise exception 'en ikke-admin kunne kalde admin_job_health()';
  exception when raise_exception then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end $$;
reset role;

-- Resten som administrator, og med rollen `authenticated`: det efterprøver
-- samtidig, at `grant execute` overlevede det `drop function`, ændringen
-- krævede — uden det svarer funktionen 42501 for alle, også for en admin.
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;

do $$
declare r record;
begin
  -- ---------- 2) den, filen findes for ----------
  select * into r from public.admin_job_health() h where h.job = 'sync-live';

  if r.consecutive_failures <> 0 then
    raise exception 'fejlserien skulle være 0 (seneste kørsel lykkedes), var %', r.consecutive_failures;
  end if;
  if r.recent_runs <> 60 then
    raise exception 'vinduet skulle rumme 60 kørsler, rummede %', r.recent_runs;
  end if;
  if r.recent_failures <> 40 then
    raise exception 'vinduet skulle have 40 fejlede kørsler, havde %', r.recent_failures;
  end if;

  -- Selve påstanden, i den form et menneske ville formulere den: kortet kan
  -- nu vise, at jobbet er nede, MENS fejlserien siger nul.
  if not (r.consecutive_failures = 0 and r.recent_failures > r.recent_runs / 2) then
    raise exception 'G109-formen kan stadig ikke aflæses af opslaget';
  end if;

  -- ---------- 3) vinduet er 24 timer ----------
  select * into r from public.admin_job_health() h where h.job = 'sync-matches:a';
  if r.recent_runs <> 2 or r.recent_failures <> 0 then
    raise exception 'en fejl 25 timer tilbage tælles med: % kørsler, % fejl', r.recent_runs, r.recent_failures;
  end if;

  -- ---------- 4) en afbrudt kørsel er en fejl ----------
  select * into r from public.admin_job_health() h where h.job = 'afbrudt-job';
  if r.recent_runs <> 2 or r.recent_failures <> 1 then
    raise exception 'en kørsel med ok is null tælles ikke som fejl: % af %', r.recent_failures, r.recent_runs;
  end if;

  -- ---------- 5) nul kørsler er et tal, ikke en manglende måling ----------
  select * into r from public.admin_job_health() h where h.job = 'send-notifications';
  if r.recent_runs is null or r.recent_runs <> 0 or r.recent_failures <> 0 then
    raise exception 'et job uden kørsler i vinduet svarede % / %', r.recent_failures, r.recent_runs;
  end if;
  -- … men det er stadig synligt som en kørsel, der ligger langt tilbage.
  if r.last_run_at is null then
    raise exception 'last_run_at forsvandt, fordi kørslen lå uden for vinduet';
  end if;
end $$;

reset role;

\echo 'OK: job_health_rate.sql — fejlraten kan aflæses, også når fejlserien er nul'
