-- Driftskortet skal kunne se en fejlRATE, ikke kun en fejlSERIE (G115).
--
-- HVORFOR
-- 14. august 2026 fejlede `sync-live` omtrent to ud af tre minutter i en time
-- (`G109`), og Admin → Drift stod grøn med **OK** og **0 fejl i træk** hele
-- vejen igennem. Kortet løj ikke — det svarede bare på et andet spørgsmål end
-- det, der blev stillet.
--
-- `admin_job_health()` tæller fejl SIDEN SENESTE VELLYKKEDE KØRSEL. For et job,
-- der kører hvert minut og fejler to ud af tre, er den seneste kørsel grøn hver
-- tredje gang — og så er tælleren nul. Serien nulstilles af enhver succes, så et
-- job kan fejle 40 gange i timen uden nogensinde at forlade tilstanden `ok`.
-- Tælleren er præcis blind for det mønster, den skulle fange.
--
-- Det er `B8`s og `G44`s fejlklasse en tredje gang: en sund måling, der skjuler
-- en syg. Dér var det ét jobnavn, der dækkede over syv turneringer; her er det
-- én succes, der dækker over to fejl.
--
-- HVAD DER ÆNDRES
-- Fire kolonner mere: `hour_runs`/`hour_failures` (sidste time) og
-- `day_runs`/`day_failures` (sidste døgn). Rå tal og ikke en procent — nævneren
-- er selv en oplysning (`sync-live` har ~60 kørsler i timen, et kampprogram-job
-- har 2 i døgnet), og en procent uden den kan ikke aflæses. Regnestykket og
-- grænsen for, hvornår en rate gør et job `ustabil`, ligger i `src/lib/ops.js`,
-- dér hvor de øvrige tilstandsregler i forvejen bor.
--
-- HVORFOR TO VINDUER — RETTET SAMME DAG, EFTER AT DATA BLEV LÆST
-- 🔴 Første udgave af denne fil havde KUN døgnvinduet, og den ville ikke have
-- fanget den hændelse, den blev skrevet for. Ejerens opslag i `job_runs` viste
-- bagefter, at `G109` varede 33 minutter med 25 fejl ud af 37 kørsler — 68 % i
-- vinduet, men **1,7 % af et døgn**, altså langt under enhver brugbar grænse.
-- En nedetid på en kampaften er INTENS OG KORT, og et døgn fortynder præcis den
-- form til usynlighed. Det er samme fejl som den, filen retter, bare en etage
-- højere: en måling, hvis opløsning er grovere end det fænomen, den skal se.
--
-- De to vinduer dækker hver sin form, og ingen af dem dækker begge:
--
--   1 time   Den intense og korte. Et minut-job har ~60 kørsler i timen, så
--            raten er skarp og altid aktuel. `G109` ville have stået på 42 %.
--   24 timer Den langsomme blødning. `send-notifications` kører 2-4 gange i
--            timen — for få til, at timevinduet nogensinde bedømmes — men
--            48-96 gange i døgnet. Et job, der stille fejler hver femte gang
--            hele dagen, når sjældent tre fejl i træk og ville ellers være
--            usynligt begge veje.
--
-- Kampprogram-jobbene (2 kørsler i døgnet) bedømmes af ingen af dem, og det er
-- med vilje: "1 af 2" er 50 % og betyder ingenting. For dem er fejlserien i
-- forvejen hele historien, fordi hver kørsel vejer.
--
-- HVORFOR TIDSVINDUER OG IKKE "DE SIDSTE N KØRSLER"
-- Vinduet skal betyde det samme for jobs med vidt forskellig kadence, og et
-- fast antal kørsler gør det ikke: 30 kørsler er en halv time for `sync-live`
-- og en halv måned for et kampprogram-job. Et TIDSvindue er den ene form, der
-- er den samme for alle ni jobs — og som samtidig altid er aktuel. Databasen
-- kender ingen kadencer; det gør kun `docs/CRON.md` og `src/lib/ops.js`.
--
-- Opslaget er dækket af `job_runs_job_started_idx (job, started_at desc)`, som
-- allerede findes.
--
-- REKKEFØLGE OG SIKKERHED
-- ⚠️ **SKAL GEN-KØRES, hvis du kørte filens første udgave 14. august 2026.** Den
-- havde `recent_runs`/`recent_failures` over 24 timer og intet timevindue; se
-- afsnittet ovenfor. Gen-kørslen er ufarlig — filen dropper funktionen først —
-- og uden den mangler klienten sine felter og viser ingen rate.
--
-- ✅ Kan køres når som helst, før eller efter deployet, og er uafhængig af det.
-- Den gamle klient læser svaret felt for felt og ignorerer de nye nøgler;
-- den nye klient behandler dem som ukendte, hvis migreringen ikke er kørt
-- endnu, og opfører sig da nøjagtig som i dag. Ingen tabel, ingen policy,
-- ingen rettighed smalnes.
--
-- 🟢 EN GEN-KØRSEL AF `job_runs.sql` RULLER **IKKE** DETTE TILBAGE — den
-- FEJLER. Filen bærer den gamle definition som `create or replace`, og en
-- returtype kan ikke erstattes: PostgreSQL svarer `42P13 cannot change return
-- type of existing function` og stopper scriptet dér. Efterprøvet i
-- `sql/tests/job_health_rate.sql`s naboopslag og målt på PostgreSQL 16.13.
--
-- Det er den gode retning at fejle i (modsat `#37` og `#26`, som ruller `#61`
-- tavst tilbage), men det gør `job_runs.sql` til en fil, der ikke længere kan
-- gen-køres i sin helhed. Sker det, er kuren at køre DENNE fil bagefter — den
-- dropper først. Advarslen står også i toppen af `job_runs.sql`.
--
-- Idempotent (efterprøvet med to kørsler i træk).

-- `drop` før `create` og ikke `create or replace`: returtypen ændrer sig, og
-- den kan `create or replace` ikke — den svarer `42P13 cannot change return
-- type of existing function`. Rettighederne følger funktionen i graven, så
-- `grant` nedenfor er ikke pynt.
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
  with vindue as (
    -- ÉT gennemløb for begge vinduer: døgnet afgrænser rækkerne, og timen er et
    -- `filter` oven i. To separate opslag ville læse de samme rækker to gange.
    --
    -- Aliasserne hedder med vilje IKKE det samme som OUT-parametrene: plpgsql
    -- kan ikke skelne en OUT-parameter fra en kolonne med samme navn, og fejlen
    -- viser sig først, når funktionen KALDES (samme fælde som `admin_feedback()`s
    -- `id`, se docs/CHANGELOG.md).
    select
      r.job as jobnavn,
      count(*) filter (where r.started_at > now() - interval '1 hour')::integer as t_antal,
      count(*) filter (where r.started_at > now() - interval '1 hour'
                         and r.ok is distinct from true)::integer as t_fejl,
      count(*)::integer as d_antal,
      count(*) filter (where r.ok is distinct from true)::integer as d_fejl
    from public.job_runs r
    where r.started_at > now() - interval '24 hours'
    group by r.job
  ),
  seneste_ok as (
    select r.job, max(r.started_at) as ok_at
    from public.job_runs r
    where r.ok
    group by r.job
  ),
  seneste as (
    select distinct on (r.job) r.job, r.started_at, r.error, r.detail
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
    s.error,
    s.detail
  from seneste s
  left join seneste_ok o on o.job = s.job
  left join vindue v on v.jobnavn = s.job
  order by s.job;
end;
$fn$;

grant execute on function public.admin_job_health() to authenticated;

-- ---------------------------------------------------------------------------
-- Verifikation (kør som administrator i SQL-editoren, ikke "Run without RLS",
-- hvis du vil se admin-vagten svare rigtigt).
--
--   select job, consecutive_failures,
--          hour_failures || '/' || hour_runs as sidste_time,
--          day_failures  || '/' || day_runs  as sidste_doegn
--   from public.admin_job_health()
--   order by job;
--
-- Aflæsningen, rækken findes for: en linje, hvor `consecutive_failures` er 0
-- og `hour_failures` er stort, er et job, der fejler jævnligt uden nogensinde
-- at fejle to gange i træk. Det er præcis den tilstand, kortet ikke kunne vise
-- — og som `G109` stod i, mens Drift meldte OK.
-- ---------------------------------------------------------------------------
