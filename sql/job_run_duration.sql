-- Driftskortet skal kunne se en VARIGHED, ikke kun et udfald (G114).
--
-- HVORFOR
-- Dét, der afgjorde `G109` 14. august 2026, var **ikke** fejlbeskeden. Det var,
-- at de GRØNNE kørsler tog 7-13 sekunder mod en grænse på 10 — altså at
-- leverandørens svartid vandrede omkring vores eget loft. Og det tal fandtes kun
-- i cron-job.orgs egen liste. Admin → Drift viste tidspunkt, udfald, fejlrate og
-- resumé, men ikke varighed, så den samme diagnose kunne ikke stilles fra vores
-- egen skærm.
--
-- Det generelle: **en langsom leverandør ligner ikke en fejlende, før man kan se
-- fordelingen af varigheder.** En kørsel, der lykkes på 19 sekunder, og en, der
-- lykkes på 2, er det samme grønne flueben — men den første er et minut fra at
-- blive klippet over af kalderen.
--
-- HVAD DER **IKKE** ÆNDRES: TABELLEN
-- 🟢 Backloggens række foreslog "ét felt, skrevet af `recordRun`". Det er ikke
-- nødvendigt, og det ville være dårligere. `job_runs` har haft BÅDE `started_at`
-- og `finished_at` siden `#18` (juli 2026), så varigheden er allerede gemt —
-- den er bare aldrig blevet regnet ud. En kolonne ville:
--
--   · kræve en migrering af tabellen og en ændring i `api/_shared.js`,
--   · kun gælde FREMAD, så de 30 dages kørsler, `prune_job_runs` holder på,
--     ville stå tomme, og
--   · være en tredje kilde til den samme oplysning, som kunne komme ud af trit
--     med de to kolonner, den er udledt af.
--
-- Rækkens egen sætning — "umulig at rekonstruere bagud" — holdt altså ikke.
-- Denne fil rører derfor ingen tabel: den udvider kun opslaget. Følgen er, at
-- diagnosen kan stilles for hele historikken fra det sekund, filen er kørt.
--
-- HVAD DER ÆNDRES
-- Fem kolonner mere på `admin_job_health()`:
--
--   last_duration_ms   den seneste kørsels varighed. Det ene tal, man kigger på.
--   hour_p50_ms        median og maksimum i de to vinduer, `G115` allerede
--   hour_max_ms        havde. Medianen siger, hvad der er NORMALT; maksimum
--   day_p50_ms         siger, hvor tæt på kanten den værste kørsel var. `G109`
--   day_max_ms         ville have stået med p50 ≈ 10 s og max ≈ 13 s mod en
--                      grænse på 10 — hvilket er hele historien i to tal.
--
-- **Samme to vinduer og samme begrundelse som `G115`:** timen fanger den
-- intense og korte (et minut-job har ~60 kørsler i timen), døgnet den langsomme
-- blødning (`send-notifications` har for få kørsler i timen til at blive
-- bedømt). Et tredje vindue ville ikke sige noget, de to ikke gør.
--
-- **Median og ikke gennemsnit.** En enkelt kørsel, der timede ud efter 20
-- sekunder, trækker et gennemsnit så meget, at det ikke længere beskriver nogen
-- kørsel. Medianen beskriver den typiske, og maksimum står ved siden af og
-- bærer udslaget — de to sammen er fordelingen, rækken efterspørger.
--
-- 🔴 **NULL BETYDER UMÅLT OG ALDRIG NUL.** En kørsel, der aldrig nåede at
-- afslutte, har `finished_at is null` og har derfor ingen varighed — den tælles
-- allerede som en fejl af `G115`s rate og skal ikke tælle som "0 ms" her. Havde
-- vi `coalesce`t til nul, ville en afbrudt kørsel se ud som den hurtigste, der
-- nogensinde er kørt. Modsat `hour_runs`/`day_runs`, hvor nul ER et tal.
--
-- REKKEFØLGE OG SIKKERHED
-- ✅ Kan køres når som helst, før eller efter deployet, og er uafhængig af det.
-- Den gamle klient læser svaret felt for felt og ignorerer de nye nøgler; den
-- nye behandler dem som UMÅLTE, hvis migreringen ikke er kørt endnu, og viser
-- da ingen varighed — nøjagtig som i dag. Ingen tabel, ingen policy, ingen
-- rettighed smalnes, ingen række ændres.
--
-- ⚠️ **Afløser `#65 job_health_rate.sql`s definition og gør DEN umulig at
-- gen-køre i sin helhed**, af præcis samme grund som `#65` gjorde det ved `#18`:
-- returtypen ændrer sig, og `create or replace` kan ikke erstatte en returtype
-- — PostgreSQL svarer `42P13 cannot change return type of existing function` og
-- stopper scriptet dér. Det er den gode retning at fejle i (ingen tavs
-- tilbagerulning), men rækkefølgen efter en gendannelse er herefter
-- #18 → #65 → #66 → #60. Advarslen står også i toppen af `#65`.
--
-- Idempotent (efterprøvet med to kørsler i træk).

-- `drop` før `create` og ikke `create or replace`: returtypen ændrer sig.
--
-- 🔴 **RETTIGHEDERNE FØLGER FUNKTIONEN I GRAVEN — BEGGE VEJE.** Både `grant`
-- OG `revoke` nedenfor er nødvendige, og det er ikke en formalitet: `#65`s
-- første udgave gentog kun den første, fordi den var den, nogen kunne se
-- forsvandt, og `anon` fik dermed EXECUTE gennem PostgreSQLs default-ACL. Det
-- gjorde `job-heartbeat.yml` rød tyve minutter efter kørslen i produktionen
-- (`G119`). Reglen gælder enhver migrering, der dropper en funktion i `public`.
drop function if exists public.admin_job_health();

create or replace function public.admin_job_health()
returns table (
  job text,
  last_run_at timestamp with time zone,
  last_ok_at timestamp with time zone,
  consecutive_failures integer,
  hour_runs integer,
  hour_failures integer,
  day_runs integer,
  day_failures integer,
  last_duration_ms integer,
  hour_p50_ms integer,
  hour_max_ms integer,
  day_p50_ms integer,
  day_max_ms integer,
  last_error text,
  last_detail jsonb
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'forbidden';
  end if;

  return query
  with koersler as (
    -- Varigheden regnes ÉT sted og genbruges af alle fire mål. Stod udtrykket
    -- i hvert `filter`, ville de fire kunne komme ud af trit ved en rettelse —
    -- og en median, der måler noget andet end sit eget maksimum, er værre end
    -- ingen af delene.
    --
    -- `finished_at is null` giver `ms is null`, og det er med vilje: en kørsel,
    -- der aldrig afsluttede, har ingen varighed. Aggregaterne springer null
    -- over af sig selv.
    select
      r.job,
      r.ok,
      r.started_at > now() - interval '1 hour'                                as i_timen,
      (extract(epoch from (r.finished_at - r.started_at)) * 1000)::integer    as ms
    from public.job_runs r
    where r.started_at > now() - interval '24 hours'
  ),
  vindue as (
    -- ÉT gennemløb for begge vinduer: døgnet afgrænser rækkerne, og timen er et
    -- `filter` oven i. To separate opslag ville læse de samme rækker to gange.
    --
    -- Aliasserne hedder med vilje IKKE det samme som OUT-parametrene: plpgsql
    -- kan ikke skelne en OUT-parameter fra en kolonne med samme navn, og fejlen
    -- viser sig først, når funktionen KALDES (samme fælde som `admin_feedback()`s
    -- `id`, se docs/CHANGELOG.md).
    select
      k.job                                                                   as jobnavn,
      count(*) filter (where k.i_timen)::integer                              as t_antal,
      count(*) filter (where k.i_timen and k.ok is distinct from true)::integer as t_fejl,
      count(*)::integer                                                       as d_antal,
      count(*) filter (where k.ok is distinct from true)::integer             as d_fejl,
      -- `percentile_cont` er en ordered-set-aggregat og tager `filter` som
      -- enhver anden (efterprøvet mod PostgreSQL 16.13).
      --
      -- ⚠️ **Her stod `and k.ms is not null` i første udgave, og begrundelsen
      -- var forkert.** Den sagde, at en afbrudt kørsel ellers ville indgå i
      -- sorteringen som en null og flytte medianen. Det gør den ikke:
      -- ordered-set-aggregater springer null-input over af sig selv — målt mod
      -- PostgreSQL 16.13, hvor `(1000, null, 3000, 5000, null)` og
      -- `(1000, 3000, 5000)` begge giver 3000. Sætningen var altså et no-op med
      -- en forklaring, der lød rigtig, og den slags er dyrere end ingen
      -- forklaring: den næste læser tror, mekanismen findes. Fundet ved at
      -- mutere filen og se testen forblive grøn.
      --
      -- At null holdes ude af medianen er stadig en PÅSTAND, der skal vogtes —
      -- den står som påstand 4 i `sql/tests/job_run_duration.sql` og måler
      -- udfaldet frem for skrivemåden.
      (percentile_cont(0.5) within group (order by k.ms)
         filter (where k.i_timen))::integer                                   as t_p50,
      max(k.ms) filter (where k.i_timen)                                      as t_max,
      (percentile_cont(0.5) within group (order by k.ms))::integer            as d_p50,
      max(k.ms)                                                               as d_max
    from koersler k
    group by k.job
  ),
  seneste_ok as (
    select r.job, max(r.started_at) as ok_at
    from public.job_runs r
    where r.ok
    group by r.job
  ),
  seneste as (
    select distinct on (r.job) r.job, r.started_at, r.finished_at, r.error, r.detail
    from public.job_runs r
    order by r.job, r.started_at desc
  )
  select
    s.job,
    s.started_at,
    o.ok_at,
    (select count(*)::integer
       from public.job_runs f
      where f.job = s.job
        and f.ok is distinct from true
        and (o.ok_at is null or f.started_at > o.ok_at)),
    -- `coalesce` og ikke null: et job, hvis seneste kørsel er ældre end
    -- vinduet, har målt NUL kørsler i det. Det er et tal og ikke en manglende
    -- måling — tavsheden fanges af `last_run_at`.
    coalesce(v.t_antal, 0),
    coalesce(v.t_fejl, 0),
    coalesce(v.d_antal, 0),
    coalesce(v.d_fejl, 0),
    -- …og her IKKE `coalesce`. En varighed, der ikke findes, er umålt, ikke
    -- nul; se den røde blok i filens hoved. Den seneste kørsel kan ligge uden
    -- for døgnvinduet og har alligevel en varighed, så den regnes af sin egen
    -- række frem for af `vindue`.
    (extract(epoch from (s.finished_at - s.started_at)) * 1000)::integer,
    v.t_p50,
    v.t_max,
    v.d_p50,
    v.d_max,
    s.error,
    s.detail
  from seneste s
  left join seneste_ok o on o.job = s.job
  left join vindue v on v.jobnavn = s.job
  order by s.job;
end;
$fn$;

grant execute on function public.admin_job_health() to authenticated;

-- 🔴 **Og `revoke` er heller ikke pynt — den er dét, `drop function` ovenfor
-- gør nødvendigt.** `#56 anon_grants_functions.sql` lukkede `anon` ude af
-- `public` og efterlod en regel, databasen ikke kan håndhæve selv: PostgreSQLs
-- indbyggede default giver PUBLIC — og dermed `anon` — EXECUTE på hver ny
-- funktion, og den post kan ikke fjernes med `alter default privileges`. Hver
-- funktion i `public` skal derfor selv bære sin `revoke execute … from public`.
--
-- `create or replace` ARVER den eksisterende ACL; et `drop` gør ikke. Det er
-- dén forskel, `#65`s første udgave overså (`G119`) — og fejlen blev fanget af
-- `job-heartbeat.yml` i PRODUKTIONEN, ikke af CI, fordi CI's vagt over reglen
-- måler `sql/schema.sql`, altså et øjebliksbillede fra sidste mandag. Det hul
-- er lukket af `G124` i samme ombæring som denne fil.
revoke execute on function public.admin_job_health() from public;

-- ---------------------------------------------------------------------------
-- Verifikation (kør som administrator i SQL-editoren, ikke "Run without RLS",
-- hvis du vil se admin-vagten svare rigtigt).
--
--   select job,
--          last_duration_ms,
--          hour_p50_ms || ' / ' || hour_max_ms as time_median_max,
--          day_p50_ms  || ' / ' || day_max_ms  as doegn_median_max
--   from public.admin_job_health()
--   order by day_max_ms desc nulls last;
--
-- Aflæsningen, rækken findes for: en linje, hvor `hour_max_ms` nærmer sig
-- 30.000, er et job, der er ved at blive klippet over af cron-job.org — uanset
-- at hver eneste kørsel står som grøn. Det var `G109`s tilstand, og den kunne
-- ikke ses noget sted i appen.
--
-- Rækkefølgen er `day_max_ms desc`, fordi det er den ene kolonne, hvor et
-- problem, ingen har opdaget endnu, står øverst af sig selv.
-- ---------------------------------------------------------------------------
