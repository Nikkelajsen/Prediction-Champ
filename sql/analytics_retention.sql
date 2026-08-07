-- Loft over analytics_events (G77).
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
-- Spec: docs/features/analytics-v1.md
--
-- HVORFOR DEN FINDES
-- `analytics_events` er den eneste tabel i skemaet, der vokser med brugen og
-- aldrig ryddes. `sql/analytics_events.sql` sagde det selv, og foreskrev en
-- oprydning "i hånden med jævne mellemrum (fx en gang om året)". Det er samme
-- form som `docs/CRON.md`s beskrivelse af `prune_job_runs()` før `G43`: en
-- rydning, der står skrevet, og som ingen udfører. Dengang havde `sync-live`
-- alene lagt 525.000 rækker i `job_runs` på et år, mens teksten beskrev en
-- rydning, der ikke skete.
--
-- HVAD DEN IKKE BRYDER
-- Spec'ens arkitekturvalg #3 ("udledte KPI'er, intet nyt cron") står ved magt.
-- Der oprettes **intet nyt planlagt job**: funktionen kaldes af
-- `.github/workflows/job-heartbeat.yml`, som allerede kører hver halve time,
-- allerede har databaseadgangen, og allerede rydder `job_runs` og
-- `client_errors` på præcis denne måde. Det er ét udsagn mere i et job, der
-- findes — ikke et nyt job, ikke et nyt endpoint og ingen ny kode i nærheden af
-- rundelåsen eller Story Engine, som var dét, valget beskyttede.
--
-- HVORFOR 18 MÅNEDER
-- Tallet er ikke nyt: det stod som forslaget i `sql/analytics_events.sql`, og
-- det er valgt, fordi det dækker det længste vindue, dashboardet faktisk læser
-- — retention-matricen går til uge 52 (`admin_analytics_retention`), og et
-- år-mod-år-blik kræver, at året før stadig findes. Kortere ville gøre en
-- sektion i Analytics tom; længere ville ikke besvare et spørgsmål, nogen
-- stiller.
--
-- Enheden er MÅNEDER og ikke dage, modsat `prune_job_runs(30)` og
-- `prune_client_errors(90)`. Det er bevidst: 18 måneder er tallet, både
-- privatlivspolitikken og spec'en siger, og et `550` i en workflow ville være
-- det samme tal skrevet, så det ikke kan genkendes.
--
-- BEMÆRK, at rydningen er den ENESTE sletning af hændelser ud over
-- kontolukningen: `_anonymize_account()` (sql/account_anonymization.sql) og
-- `admin_anonymize_account()` (sql/liga_admin.sql) sletter en brugers egne
-- rækker med det samme. De to dækker hver sin ting — den ene en person, den
-- anden tiden — og ingen af dem gør den anden overflødig.

create or replace function public.prune_analytics_events(keep_months integer default 18)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n integer;
begin
  -- `greatest(1, …)` som i de to søskende: et kald med 0 eller et negativt tal
  -- ville ellers tømme hele tabellen, og en rydning må ikke kunne blive til en
  -- sletning ved en tastefejl i en workflow.
  delete from public.analytics_events
   where created_at < now() - make_interval(months => greatest(1, keep_months));
  get diagnostics n = row_count;
  return n;
end;
$fn$;

-- Samme adgang som de to andre rydninger: kun `service_role` (og dermed
-- heartbeat'ens forbindelse). En klient har ingen grund til at kunne slette
-- hændelser, og tabellen har i forvejen ingen delete-policy.
revoke execute on function public.prune_analytics_events(integer) from public, anon, authenticated;
grant execute on function public.prune_analytics_events(integer) to service_role;

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- 1) Funktionen findes. Forvent én række.
-- select proname from pg_proc where proname = 'prune_analytics_events';
--
-- 2) Hvor meget ville den fjerne lige nu? (Læser kun.)
-- select count(*) filter (where created_at < now() - interval '18 months') as ville_ryddes,
--        count(*) as i_alt, min(created_at) as aeldste
--   from public.analytics_events;
--
-- 3) Kør den. Første kørsel efter en lang periode kan fjerne mange rækker.
-- select public.prune_analytics_events(18);
