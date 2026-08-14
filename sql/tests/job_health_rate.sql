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
--      = 0 og `hour_failures` = 25 af 37. Tallene er de FAKTISKE fra
--      `G109` 14. august 2026, hvor Drift stod grøn, mens live-syncen var nede.
--   3. **De to vinduer måler hver sin form.** Samme 25 fejl er 68 % af timen og
--      1,7 % af døgnet — og det er hele grunden til, at timevinduet findes:
--      filens første udgave havde kun døgnet og ville have kaldt `G109` sundt.
--   3b. Døgnvinduet er 24 timer: kørsler ældre end det tælles ikke med.
--   4. En kørsel, der aldrig nåede at afslutte (`ok is null`), tæller som en
--      fejl — samme regel som fejlserien allerede bruger.
--   5. Et job uden kørsler i vinduet får 0 og ikke null: tavshed er
--      `last_run_at`s opgave, ikke ratens.
--   6. **`anon` kan IKKE kalde funktionen bagefter.** Tilføjet 14. august 2026,
--      efter at filens første udgave åbnede den — se nedenfor.
--
-- ⚠️ **HVORFOR PÅSTAND 6 FINDES.** Første udgave af `job_health_rate.sql`
-- gentog `grant execute … to authenticated` efter sit `drop function` (og
-- påstand 1 beviste, at det virkede) men ikke `revoke execute … from public`,
-- som forsvandt i nøjagtig samme sætning: rettigheder følger funktionen i
-- graven, og den nye fødes med PostgreSQLs default-ACL, hvor PUBLIC har
-- EXECUTE. `anon` kunne dermed nå `admin_job_health()` — imod `#56`s regel.
--
-- Fejlen blev fanget i PRODUKTIONEN af `job-heartbeat.yml`s femte kontrol
-- (`sql/checks/anon_routine_reach.sql`), ikke her, og det var ikke tilfældigt:
-- CI's vagt over den regel (`sql/tests/anon_grants_functions.sql`) måler
-- `sql/schema.sql`, altså et ØJEBLIKSBILLEDE, der eksporteres om mandagen. En
-- migrering, der åbner en funktion, er derfor usynlig for CI, indtil eksporten
-- er kørt. Påstanden hører hjemme HER, hos den migrering, der kan bryde reglen,
-- fordi det er det eneste sted, den kan være rød i en pull request.
--
-- Reglen gælder enhver fremtidig migrering, der `drop`per og gen-opretter en
-- funktion i `public`: den skal gentage BEGGE sætninger, og dens test skal
-- efterprøve begge retninger.

\set ON_ERROR_STOP on
\timing off

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table if not exists auth.users (id uuid primary key);
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  -- `anon` findes kun for påstand 6. Den får ingen grants — kan den alligevel
  -- nå funktionen, er det gennem PUBLIC, og det er præcis den vej, påstanden
  -- måler.
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
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
-- Data: G109-formen, gengivet med de FAKTISKE tal fra produktionen.
--
-- 37 kørsler af `sync-live` inden for den sidste halve time, hvoraf 25 fejlede
-- (ejerens opslag i `job_runs`, 19:48-20:20 den 14. august 2026), og den
-- NYESTE lykkedes — det er den kombination, fejlserien ikke kan se.
--
-- Plus resten af døgnets ~1.400 grønne kørsler, så de to vinduer faktisk kan
-- give forskellige svar: 25 fejl er 68 % af timen og under 2 % af døgnet.
-- ---------------------------------------------------------------------------
insert into public.job_runs (job, started_at, finished_at, ok, detail, error)
select
  'sync-live',
  now() - (i || ' minutes')::interval,
  now() - (i || ' minutes')::interval,
  -- i = 0 er den nyeste og skal lykkes. Derefter fejler 25 af de næste 36.
  not (i between 1 and 25),
  jsonb_build_object('checked', 1),
  case when i between 1 and 25 then 'Tidsgrænse: intet svar' end
from generate_series(0, 36) as i;

-- Resten af døgnet: grønne kørsler fra 2 til 23 timer siden. Uden dem ville
-- døgnvinduet være identisk med timevinduet, og testen kunne ikke skelne dem.
insert into public.job_runs (job, started_at, finished_at, ok)
select 'sync-live', now() - (i || ' minutes')::interval, now() - (i || ' minutes')::interval, true
from generate_series(120, 1380) as i;

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
  if r.hour_runs <> 37 then
    raise exception 'timevinduet skulle rumme 37 kørsler, rummede %', r.hour_runs;
  end if;
  if r.hour_failures <> 25 then
    raise exception 'timevinduet skulle have 25 fejlede kørsler, havde %', r.hour_failures;
  end if;

  -- Selve påstanden, i den form et menneske ville formulere den: kortet kan
  -- nu vise, at jobbet er nede, MENS fejlserien siger nul.
  if not (r.consecutive_failures = 0 and r.hour_failures > r.hour_runs / 2) then
    raise exception 'G109-formen kan stadig ikke aflæses af opslaget';
  end if;

  -- ---------- 3) de to vinduer måler hver sin form ----------
  -- Den påstand, filens første udgave ville være faldet på: SAMME 25 fejl er
  -- to tredjedele af timen og under 2 % af døgnet. Havde vi kun haft døgnet,
  -- ville G109 have stået som et sundt job.
  if r.day_failures <> 25 then
    raise exception 'døgnet skulle bære de samme 25 fejl, bar %', r.day_failures;
  end if;
  if r.day_runs < 1000 then
    raise exception 'døgnvinduet fangede kun % kørsler — nævneren er for lille til at skelne', r.day_runs;
  end if;
  if not (r.hour_failures::numeric / r.hour_runs > 0.5
          and r.day_failures::numeric / r.day_runs < 0.05) then
    raise exception 'vinduerne giver samme svar (% af % mod % af %) — så måler kun det ene noget',
      r.hour_failures, r.hour_runs, r.day_failures, r.day_runs;
  end if;

  -- ---------- 3b) døgnvinduet er 24 timer ----------
  select * into r from public.admin_job_health() h where h.job = 'sync-matches:a';
  if r.day_runs <> 2 or r.day_failures <> 0 then
    raise exception 'en fejl 25 timer tilbage tælles med: % kørsler, % fejl', r.day_runs, r.day_failures;
  end if;
  -- … og det 12-timers job har INGEN kørsler i timevinduet. Det er ikke en
  -- mangel: en rate på to kørsler i døgnet er en anekdote, og klienten viser
  -- rækken slet ikke.
  if r.hour_runs <> 0 then
    raise exception 'et 12-timers job havde % kørsler i timevinduet', r.hour_runs;
  end if;

  -- ---------- 4) en afbrudt kørsel er en fejl ----------
  select * into r from public.admin_job_health() h where h.job = 'afbrudt-job';
  if r.hour_runs <> 2 or r.hour_failures <> 1 then
    raise exception 'en kørsel med ok is null tælles ikke som fejl: % af %', r.hour_failures, r.hour_runs;
  end if;

  -- ---------- 5) nul kørsler er et tal, ikke en manglende måling ----------
  select * into r from public.admin_job_health() h where h.job = 'send-notifications';
  if r.day_runs is null or r.day_runs <> 0 or r.day_failures <> 0 then
    raise exception 'et job uden kørsler i vinduet svarede % / %', r.day_failures, r.day_runs;
  end if;
  -- … men det er stadig synligt som en kørsel, der ligger langt tilbage.
  if r.last_run_at is null then
    raise exception 'last_run_at forsvandt, fordi kørslen lå uden for vinduet';
  end if;
end $$;

reset role;

-- ---------- 6) `drop function` tog også revoke'en med sig ----------
--
-- ⚠️ **PÅSTANDEN SPØRGER `has_function_privilege` OG IKKE EN GRANT-TABEL** —
-- samme fælde som i `sql/checks/anon_routine_reach.sql` og
-- `sql/tests/anon_grants_functions.sql`: PUBLIC giver adgang uden at nævne
-- `anon` nogen steder, så et opslag i `information_schema.role_routine_grants`
-- ville melde "lukket" om en funktion, enhver kan kalde.
--
-- Begge retninger måles. At `anon` er lukket ude, er intet værd, hvis
-- `authenticated` blev det samtidig — det er den anden halvdel af `#56`s
-- lærestreg (trin 2 tager de tilladte med, trin 5 giver dem tilbage), og en
-- for bred revoke ville lukke driftskortet for ejeren selv.
do $$
begin
  if has_function_privilege('anon', 'public.admin_job_health()', 'EXECUTE') then
    raise exception
      'anon kan kalde admin_job_health() — migreringens `drop function` nulstillede ACL''en, og `revoke execute … from public` blev ikke gentaget (se #56 og sql/checks/anon_routine_reach.sql)';
  end if;

  if not has_function_privilege('authenticated', 'public.admin_job_health()', 'EXECUTE') then
    raise exception 'revoke ramte for bredt: authenticated kan ikke længere kalde admin_job_health(), og Admin → Drift er dermed lukket for ejeren';
  end if;
end $$;

\echo 'OK: job_health_rate.sql — fejlraten kan aflæses, også når fejlserien er nul'
