-- Test af driftskortets varigheder (sql/job_run_duration.sql, G114).
--
-- Kører mod en TOM engangsdatabase. Rører aldrig produktion. Samme mønster som
-- `job_health_rate.sql`, hvis migrering denne afløser.
--
-- HVAD DEN BEVISER
--   1. `admin_job_health()` afviser stadig en ikke-admin og svarer en admin —
--      vagten overlevede det `drop function`, returtypen krævede, og det samme
--      gjorde `grant execute`.
--   2. **Den, filen findes for:** `G109`s form gengivet med varigheder. Alle
--      kørsler er GRØNNE, fejlserien er nul, og raten er nul — og alligevel er
--      medianen 10 sekunder og maksimum 13. Det er den tilstand, hvor hvert
--      eneste tal i Drift sagde "ok", mens leverandøren var ved at drukne.
--   3. **Median og ikke gennemsnit.** Én kørsel på 20 sekunder blandt
--      lutter hurtige må ikke flytte det tal, der beskriver den typiske kørsel
--      — men den skal stå fuldt ud i maksimum.
--   4. **En afbrudt kørsel har INGEN varighed.** `finished_at is null` giver
--      null, ikke 0 ms. Havde den givet nul, ville den se ud som den hurtigste
--      kørsel, der nogensinde er kørt — og den er det modsatte.
--   5. De to vinduer måler hver sit: en langsom time inde i et hurtigt døgn
--      skal kunne ses i timen og ikke i døgnet.
--   6. `last_duration_ms` regnes af den seneste kørsels EGEN række og ikke af
--      vinduet — også når den ligger uden for døgnet.
--   7. **`anon` kan IKKE kalde funktionen bagefter.** Samme påstand som `#65`
--      fik efter `G119`, og af samme grund: rettigheder følger funktionen i
--      graven, og denne fil dropper den også.
--
-- ⚠️ **Filen kører BEGGE migreringer i produktionens rækkefølge (#65 så #66)**
-- og måler dermed også, at `#66` kan lægges oven på `#65` — altså at det, en
-- gendannelse ville gøre, virker.
--
-- KØR LOKALT
--   psql -d jrd -v ON_ERROR_STOP=1 -b -f sql/tests/job_run_duration.sql

\set ON_ERROR_STOP on
\timing off

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table if not exists auth.users (id uuid primary key);
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  -- `anon` findes kun for påstand 7. Den får ingen grants — kan den alligevel
  -- nå funktionen, er det gennem PUBLIC, og det er præcis den vej, påstanden
  -- måler.
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;
grant usage on schema public to authenticated;
create table public.profiles (id uuid primary key, display_name text, is_admin boolean default false);

\ir ../job_runs.sql
\ir ../job_health_rate.sql
\ir ../job_run_duration.sql

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');
insert into public.profiles (id, display_name, is_admin) values
  ('00000000-0000-0000-0000-000000000001', 'Nikolaj', true),
  ('00000000-0000-0000-0000-000000000002', 'Bo', false);

-- ---------------------------------------------------------------------------
-- Data
-- ---------------------------------------------------------------------------

-- `G109`-formen, men målt på TID i stedet for på udfald. 21 kørsler i den
-- sidste time, ALLE grønne, med varigheder 7-13 sekunder — netop det interval,
-- ejeren aflæste hos cron-job.org 14. august 2026, og som ikke kunne ses noget
-- sted i appen. Medianen lander på 10 s og maksimum på 13 s.
insert into public.job_runs (job, started_at, finished_at, ok)
select
  'sync-live',
  now() - (i || ' minutes')::interval,
  now() - (i || ' minutes')::interval + ((7000 + (i % 7) * 1000) || ' milliseconds')::interval,
  true
from generate_series(0, 20) as i;

-- Samme job, men i den ROLIGE del af døgnet: 200 kørsler à ~2 sekunder.
-- Uden dem ville de to vinduer give samme svar, og testen kunne ikke skelne dem.
insert into public.job_runs (job, started_at, finished_at, ok)
select
  'sync-live',
  now() - (i || ' minutes')::interval,
  now() - (i || ' minutes')::interval + interval '2 seconds',
  true
from generate_series(120, 319) as i;

-- ÉN kørsel på 25 sekunder for fem timer siden — altså inde i døgnet, men
-- uden for timen.
--
-- ⚠️ **Den findes, fordi testens første udgave IKKE kunne skelne de to
-- maksima.** Uden den lå den værste kørsel inde i timen, så `hour_max_ms` og
-- `day_max_ms` var det samme tal — og en mutation, der lod timens maksimum
-- måle hele døgnet, blev ikke fanget. Fundet ved at mutere migreringen og se
-- testen forblive grøn. Nu er de to forskellige, og det er selve påstanden.
insert into public.job_runs (job, started_at, finished_at, ok) values
  ('sync-live', now() - interval '5 hours', now() - interval '5 hours' + interval '25 seconds', true);

-- Et job med én meget langsom kørsel blandt lutter hurtige. Medianen skal
-- IKKE flytte sig; maksimum skal.
insert into public.job_runs (job, started_at, finished_at, ok)
select
  'skævt-job',
  now() - (i || ' minutes')::interval,
  now() - (i || ' minutes')::interval + (case when i = 5 then interval '20 seconds' else interval '1 second' end),
  true
from generate_series(1, 9) as i;

-- En kørsel, der aldrig nåede at afslutte, ved siden af to, der gjorde.
insert into public.job_runs (job, started_at, finished_at, ok) values
  ('afbrudt-job', now() - interval '5 minutes',  null,                                  null),
  ('afbrudt-job', now() - interval '6 minutes',  now() - interval '6 minutes' + interval '3 seconds', true),
  ('afbrudt-job', now() - interval '7 minutes',  now() - interval '7 minutes' + interval '5 seconds', true);

-- Et job, hvis eneste kørsel ligger UDEN FOR døgnvinduet. Vinduerne er tomme,
-- men den seneste kørsel har stadig en varighed.
insert into public.job_runs (job, started_at, finished_at, ok) values
  ('gammelt-job', now() - interval '3 days', now() - interval '3 days' + interval '4 seconds', true);

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

  -- Hvert eneste udfaldstal siger "ok" …
  if r.consecutive_failures <> 0 or r.hour_failures <> 0 or r.day_failures <> 0 then
    raise exception 'fixturen skulle være helt grøn, var % / % / %',
      r.consecutive_failures, r.hour_failures, r.day_failures;
  end if;
  -- … og alligevel er kørslerne 7-13 sekunder lange. DET er hele rækken.
  if r.hour_p50_ms not between 9500 and 10500 then
    raise exception 'timens median skulle være ~10 s, var % ms', r.hour_p50_ms;
  end if;
  if r.hour_max_ms not between 12500 and 13500 then
    raise exception 'timens maksimum skulle være ~13 s, var % ms', r.hour_max_ms;
  end if;

  -- ---------- 5) de to vinduer måler hver sit ----------
  -- Den rolige del af døgnet trækker døgnets median ned til ~2 s, mens timens
  -- bliver stående på ~10. Var de ens, målte kun det ene noget.
  if r.day_p50_ms > 4000 then
    raise exception 'døgnets median blev trukket op af den langsomme time: % ms', r.day_p50_ms;
  end if;
  if r.hour_p50_ms <= r.day_p50_ms then
    raise exception 'vinduerne giver samme svar (% mod % ms) — så måler kun det ene noget',
      r.hour_p50_ms, r.day_p50_ms;
  end if;
  -- Og maksima må heller ikke være det samme tal. Døgnets værste kørsel (25 s,
  -- fem timer tilbage) ligger UDEN FOR timen, så et timevindue, der i
  -- virkeligheden måler hele døgnet, viser sig her og ingen andre steder.
  if r.day_max_ms not between 24500 and 25500 then
    raise exception 'døgnets maksimum skulle være ~25 s, var % ms', r.day_max_ms;
  end if;
  if r.hour_max_ms >= r.day_max_ms then
    raise exception 'timens maksimum (%) måler også kørsler uden for timen (døgnets er %)',
      r.hour_max_ms, r.day_max_ms;
  end if;

  -- ---------- 3) median og ikke gennemsnit ----------
  select * into r from public.admin_job_health() h where h.job = 'skævt-job';
  -- Otte kørsler à 1 s og én à 20 s. Gennemsnittet ville være ~3,1 s og
  -- beskrive ingen af dem; medianen er 1 s og beskriver de otte.
  if r.hour_p50_ms <> 1000 then
    raise exception 'medianen blev trukket af den ene lange kørsel: % ms', r.hour_p50_ms;
  end if;
  -- … men udslaget må ikke forsvinde. Det er dét, maksimum er til for.
  if r.hour_max_ms <> 20000 then
    raise exception 'maksimum så ikke den lange kørsel: % ms', r.hour_max_ms;
  end if;

  -- ---------- 4) en afbrudt kørsel har INGEN varighed ----------
  select * into r from public.admin_job_health() h where h.job = 'afbrudt-job';
  -- Den seneste kørsel afsluttede aldrig.
  if r.last_duration_ms is not null then
    raise exception 'en kørsel uden finished_at fik varigheden % ms — null er det rigtige svar', r.last_duration_ms;
  end if;
  -- Den tælles med som en KØRSEL (og som en fejl, jf. G115) …
  if r.hour_runs <> 3 or r.hour_failures <> 1 then
    raise exception 'den afbrudte kørsel tælles ikke som en fejlet kørsel: % af %', r.hour_failures, r.hour_runs;
  end if;
  -- … men ikke som en varighed. Medianen af 3 s og 5 s er 4 s. Havde den
  -- afbrudte talt som 0 ms, ville medianen have været 3 s.
  if r.hour_p50_ms <> 4000 then
    raise exception 'den afbrudte kørsel indgik i medianen: % ms (forventet 4000)', r.hour_p50_ms;
  end if;
  if r.hour_max_ms <> 5000 then
    raise exception 'maksimum blev forkert af den afbrudte kørsel: % ms', r.hour_max_ms;
  end if;

  -- ---------- 6) den seneste kørsel regnes af sin egen række ----------
  select * into r from public.admin_job_health() h where h.job = 'gammelt-job';
  if r.day_runs <> 0 or r.day_p50_ms is not null then
    raise exception 'et job uden kørsler i døgnet fik en vinduesvarighed: % af % kørsler', r.day_p50_ms, r.day_runs;
  end if;
  -- Men den seneste kørsel HAR en varighed, også når den ligger tre dage
  -- tilbage — den er ikke udledt af vinduet.
  if r.last_duration_ms <> 4000 then
    raise exception 'last_duration_ms fandt ikke den seneste kørsel uden for vinduet: % ms', r.last_duration_ms;
  end if;

  -- ---------- 5b) G115's egne felter er UÆNDREDE ----------
  -- Migreringen udvider et opslag, den ikke må omskrive. Fejlraten er den
  -- forrige leverance, og en returtype-ændring er præcis det sted, hvor en
  -- kolonne kan komme til at pege på en anden værdi end før.
  select * into r from public.admin_job_health() h where h.job = 'sync-live';
  if r.hour_runs <> 21 or r.day_runs <> 222 then
    raise exception 'G115s tællinger flyttede sig: % i timen, % i døgnet', r.hour_runs, r.day_runs;
  end if;
end $$;

reset role;

-- ---------- 7) `drop function` tog også revoke'en med sig ----------
--
-- ⚠️ **PÅSTANDEN SPØRGER `has_function_privilege` OG IKKE EN GRANT-TABEL** —
-- samme fælde som i `sql/checks/anon_routine_reach.sql`: PUBLIC giver adgang
-- uden at nævne `anon` nogen steder, så et opslag i
-- `information_schema.role_routine_grants` ville melde "lukket" om en funktion,
-- enhver kan kalde.
--
-- Begge retninger måles. At `anon` er lukket ude, er intet værd, hvis
-- `authenticated` blev det samtidig — en for bred revoke ville lukke
-- driftskortet for ejeren selv.
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

-- ---------- idempotens ----------
-- Filen dropper først, så en gen-kørsel er ufarlig. Men rettighederne skal
-- stadig stå rigtigt bagefter — det var netop dét, `G119` viste kan gå tabt.
\ir ../job_run_duration.sql
do $$ begin
  if has_function_privilege('anon', 'public.admin_job_health()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.admin_job_health()', 'EXECUTE') then
    raise exception 'en gen-kørsel efterlod rettighederne forkert';
  end if;
end $$;

\echo 'OK: job_run_duration.sql — varigheden kan aflæses, også når hvert udfald er grønt'
