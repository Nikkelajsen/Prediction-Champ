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
-- To kolonner mere: `recent_runs` og `recent_failures`, opgjort over de sidste
-- 24 timer. Rå tal og ikke en procent — nævneren er selv en oplysning
-- (`sync-live` har ~1.440 kørsler i døgnet, et kampprogram-job har 2), og en
-- procent uden den kan ikke aflæses. Regnestykket og grænsen for, hvornår en
-- rate gør et job `ustabil`, ligger i `src/lib/ops.js`, dér hvor de øvrige
-- tilstandsregler i forvejen bor.
--
-- HVORFOR 24 TIMER OG IKKE "DE SIDSTE N KØRSLER"
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
-- ✅ Kan køres når som helst, før eller efter deployet, og er uafhængig af det.
-- Den gamle klient læser svaret felt for felt og ignorerer de to nye nøgler;
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
  recent_runs integer,
  recent_failures integer,
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
    -- Aliasserne hedder med vilje IKKE det samme som OUT-parametrene:
    -- plpgsql kan ikke skelne en OUT-parameter fra en kolonne med samme navn,
    -- og fejlen viser sig først, når funktionen KALDES (samme fælde som
    -- `admin_feedback()`s `id`, se docs/CHANGELOG.md).
    select
      r.job as jobnavn,
      count(*)::integer as antal,
      count(*) filter (where r.ok is distinct from true)::integer as fejlede
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
    -- vinduet, har målt NUL kørsler i det sidste døgn. Det er et tal og ikke
    -- en manglende måling — tavsheden fanges af `last_run_at`.
    coalesce(v.antal, 0),
    coalesce(v.fejlede, 0),
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
--   select job, consecutive_failures, recent_failures, recent_runs
--   from public.admin_job_health()
--   order by recent_failures desc;
--
-- Aflæsningen, rækken findes for: en linje, hvor `consecutive_failures` er 0
-- og `recent_failures` er stort, er et job, der fejler jævnligt uden nogensinde
-- at fejle to gange i træk. Det er præcis den tilstand, kortet ikke kunne vise.
-- ---------------------------------------------------------------------------
