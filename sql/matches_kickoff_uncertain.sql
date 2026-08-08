-- Leagly — "klokkeslættet er ikke bekræftet" som egenskab ved kampen (G85, august 2026)
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- ============================================================================
-- PROBLEMET
-- ============================================================================
-- `matches_kickoff_tbd.sql` (#25) bygger på, at en leverandør SIGER, når et
-- klokkeslæt ikke er fastsat: Sportmonks har state TBA plus midnat-pladsholderen,
-- og football-data.org har midnat for Bundesliga. Det holder for de to.
--
-- Det holder ikke for tre af de fem turneringer, football-data.org dækker.
-- Aflæsningen 7. august 2026 — fire turneringer, 1.446 kampe, læst direkte hos
-- leverandøren (docs/reviews/football-data-kickoff-aflaesning-2026-08-07.md) —
-- viste, at Premier League, Primera División og Serie A får et OPDIGTET
-- klokkeslæt: turneringens typiske anspilstid lokalt frem til nytår, 12:00 UTC
-- sæsonen ud. Nul af de 1.140 kampe bærer midnat, og alle står `SCHEDULED`, også
-- dem med rigtige tider. Der er intet felt i svaret, der skiller de to slags ad.
--
-- Appen viser altså i dag leverandørens gæt som et fastsat klokkeslæt for hver
-- kamp fra oktober og frem i tre af Europas fem største rækker.
--
-- ============================================================================
-- HVORFOR EN NY MARKØR OG IKKE `kickoff_tbd`
-- ============================================================================
-- Fordi `kickoff_tbd` gør TRE ting, og kun den første er ønsket her:
--   1. visningen skjuler klokkeslættet,
--   2. låsen rykker fra kickoff−1t til MIDNAT PÅ SPILLEDAGEN (16 timer strengere),
--   3. deadline-påmindelsen falder helt bort (api/send-notifications.js).
--
-- Skaden i `G85` er alene displayet af FJERNE kampe. Låsen er efterprøvet
-- 8. august 2026 og er ikke i fare: `public.match_lock_at()` og `lockAtOf()` i
-- src/lib/scoring.js regner den ved HVER læsning ud fra rækkens nuværende
-- `kickoff_at`, og synkroniseringen kører hver 12. time — så når leverandøren
-- sætter den rigtige tid, følger låsen med af sig selv. En bruger, der planlægger
-- efter "12. december kl. 15", kan tage fejl, men ingen mister et tip.
--
-- Derfor er `kickoff_uncertain` DISPLAY-ONLY. Denne fil rører hverken
-- `match_lock_at()`, `match_locked()`, en eneste RLS-policy eller
-- `analytics_match_locks`. Det er hele sikkerhedsargumentet: migreringen KAN ikke
-- flytte en lås eller tage et tip fra nogen.
--
-- ============================================================================
-- REGLEN I TRE TRIN
-- ============================================================================
-- Fire formodninger er allerede prøvet af mod data og forkastet — leverandørens
-- `status`, midnat som universel regel, formen på en runde og `lastUpdated`.
-- **Prøv dem ikke igen; læs aflæsningen først.** Det, der er tilbage, er at se
-- pladsholderen på dens egen adfærd frem for på et felt:
--
-- 1. OBSERVATIONEN. Ændrer `kickoff_at` sig, gemmes den gamle værdi i
--    `kickoff_prev_at`. En tid, der flytter sig, VAR ikke fastsat — det er en
--    kendsgerning om vores egne rækker og ikke en antagelse om leverandøren.
--
-- 2. GENERALISERINGEN. Bærer MINDST TRE kampe i samme sæson et `kickoff_prev_at`
--    med samme UTC-klokkeslæt, er dét klokkeslæt en INDLÆRT PLADSHOLDER for
--    turneringen. Uden trin 2 ville reglen kun kunne svare bagudrettet om den
--    enkelte kamp, og det hjælper ingen bruger.
--
-- 3. MARKERINGEN. En ikke-spillet kamp, hvis nuværende `kickoff_at` bærer et af
--    turneringens indlærte klokkeslæt, får `kickoff_uncertain = true`. Alle andre
--    får `false` — markeringen RYDDER SIG SELV, når leverandøren sætter den
--    rigtige tid.
--
-- HVORFOR GULVET ER TRE. Det er `G84`s eget gulv og lånt med samme begrundelse:
-- én kamp, der flytter sig, er en normal tilstand (en omberammelse, en
-- tv-flytning), og en regel, der udløste på den, ville markere hele Superligaen,
-- fordi 16:00 er et ægte Superliga-klokkeslæt. Pladsholder-regimet flytter
-- derimod en hel måned ad gangen. Tallet er ikke kalibreret her; det er
-- genbrugt, netop for ikke at indføre endnu et ukalibreret tal (`A35`).
--
-- HVORFOR UTC OG IKKE LOKAL TID. Vi gemmer ingen tidszone pr. turnering, og det
-- er ikke nødvendigt: sommertidsskiftet i oktober deler blot efterårspladsholderen
-- i to indlærte værdier (PD 15:00 og 16:00 UTC er samme klokkeslæt i Madrid), som
-- læres uafhængigt af hinanden. Prisen er, at hver halvdel af sæsonen skal se
-- sine tre flytninger, før den lærer. Det er den sikre retning at fejle i.
--
-- KENDT UNDERDÆKNING. Premier Leagues december bærer TO distinkte klokkeslæt
-- (15:00 ×40 og 20:00 ×20), og reglen lærer dem hver for sig. Aflæsningen siger
-- udtrykkeligt, at årsagen til det split ikke er efterprøvet — juledagene lagt
-- tidligt af tv-hensyn er et GÆT — så underdækningen bliver stående frem for at
-- blive lukket med en formodning.
--
-- ADFÆRDSÆNDRING VED KØRSEL: INGEN. Begge kolonner starter tomme, og
-- `refresh_kickoff_uncertain()` kan ikke markere noget, før den har set tre
-- flytninger. Første kald returnerer nul, og det er ikke en fejl — det er
-- reglens kendte pris: den svarer først, når en tid har flyttet sig.

-- ============================================================================
-- 1) Kolonnerne
-- ============================================================================
-- `kickoff_prev_at` er nullable og bliver ved med at være det for en kamp, hvis
-- tid aldrig har flyttet sig. Den bærer den SENESTE tidligere værdi og ikke en
-- historik: reglen spørger kun, om der har været en flytning, og fra hvilket
-- klokkeslæt.
alter table public.matches
  add column if not exists kickoff_prev_at timestamptz;

alter table public.matches
  add column if not exists kickoff_uncertain boolean not null default false;

comment on column public.matches.kickoff_prev_at is
  'Den forrige kickoff_at, gemt af matches_remember_previous_kickoff når tiden flytter sig. Grundlaget for de indlærte pladsholder-klokkeslæt (G85).';

comment on column public.matches.kickoff_uncertain is
  'Klokkeslættet i kickoff_at er sandsynligvis leverandørens gæt — datoen er kendt. DISPLAY-ONLY: låsen og påmindelserne er upåvirkede, modsat kickoff_tbd. Sættes af refresh_kickoff_uncertain() (G85).';

-- ============================================================================
-- 2) Trin 1 — observationen
-- ============================================================================
-- En trigger og ikke JS, af to grunde: observationen skal gælde ENHVER skriver
-- (api/sync-matches' upsert, Admin → Kampe, efterfyldningen), og syncen slipper
-- for at læse sæsonens kampe tilbage før hver upsert.
--
-- `when (...)` på selve triggeren og ikke et `if` i kroppen: den ligger på
-- `matches`, hvor sync-matches skriver ~380 rækker ad gangen to gange i døgnet,
-- og næsten ingen af dem flytter sig. Med betingelsen i triggerdefinitionen
-- kaldes funktionen slet ikke for de øvrige.
create or replace function public.remember_previous_kickoff()
  returns trigger
  language plpgsql
as $fn$
begin
  new.kickoff_prev_at := old.kickoff_at;
  return new;
end;
$fn$;

drop trigger if exists matches_remember_previous_kickoff on public.matches;
create trigger matches_remember_previous_kickoff
  before update on public.matches
  for each row
  when (new.kickoff_at is distinct from old.kickoff_at)
  execute function public.remember_previous_kickoff();

-- ============================================================================
-- 3) Trin 2 og 3 — generaliseringen og markeringen
-- ============================================================================
-- Kaldes af api/sync-matches efter upserten, én gang pr. sæson pr. kørsel.
-- Returnerer antallet af kampe, hvis markør FAKTISK skiftede — ikke antallet af
-- markerede kampe. Et tal, der bliver ved med at være nul, betyder "ingen
-- ændring", og det er dét, man vil kunne aflæse i Admin → Drift.
--
-- HVORFOR DEN TÆLLER FØR DEN SKRIVER. `matches` bærer tre statement-level
-- triggere, som kalder `recompute_ratings_if_scores_changed()` — og en UPDATE,
-- der rammer nul rækker, udløser dem alligevel. Den almindelige tilstand er, at
-- intet skal skifte, så funktionen finder først målet og skriver kun, hvis der
-- er noget at skrive. `A38` gjorde det dyrt at være ligeglad med, hvad der
-- hænger på den tabel.
create or replace function public.refresh_kickoff_uncertain(p_season_id uuid)
  returns integer
  language plpgsql
as $fn$
declare
  v_n integer;
begin
  -- `drop` først: funktionen kan kaldes to gange i samme transaktion (to sæsoner
  -- i samme turnering), og `on commit drop` rydder først ved commit. Samme
  -- mønster som `_se_changed_rounds` i rating_trigger_optimization.sql.
  drop table if exists _ku_maal;
  create temporary table _ku_maal on commit drop as
  with laert as (
    -- Trin 2. `having count(*) >= 3` er gulvet, og `group by` på klokkeslættet
    -- er det, der gør, at tre flytninger fra TRE FORSKELLIGE klokkeslæt ikke
    -- lærer noget: en omberammelse her og der ser ikke ud som et regime.
    select (m.kickoff_prev_at at time zone 'UTC')::time as tid
      from public.matches m
     where m.season_id = p_season_id
       and m.kickoff_prev_at is not null
     group by 1
    having count(*) >= 3
  ),
  beregnet as (
    -- Trin 3. Bemærk at udtrykket også siger `false` — en kamp, hvis tid er
    -- blevet rettet, eller som er blevet spillet, mister sin markør her.
    -- `home_score is null` ALENE, uden `away_score`. Hele appen læser netop den
    -- ene kolonne som "kampen er spillet" (api/sync-matches.js, `_rs` i
    -- rating_core.sql, G84's kontrol), og en ekstra betingelse, der aldrig kan
    -- være uenig med den, er en gren, ingen test kan nå — `G84`s egen lære.
    select m.id,
           m.home_score is null
             and exists (
               select 1 from laert l
                where l.tid = (m.kickoff_at at time zone 'UTC')::time
             ) as vaerdi
      from public.matches m
     where m.season_id = p_season_id
  )
  select b.id, b.vaerdi
    from beregnet b
    join public.matches m on m.id = b.id
   where m.kickoff_uncertain is distinct from b.vaerdi;

  select count(*)::int into v_n from _ku_maal;
  if v_n = 0 then
    return 0;
  end if;

  update public.matches m
     set kickoff_uncertain = t.vaerdi
    from _ku_maal t
   where m.id = t.id;

  return v_n;
end;
$fn$;

-- Kun jobbet må kalde den. Den skriver i `matches`, og en almindelig bruger har
-- ingen grund til at kunne udløse en skrivning på en hel sæson.
revoke all on function public.refresh_kickoff_uncertain(uuid) from public;
revoke all on function public.refresh_kickoff_uncertain(uuid) from anon, authenticated;
grant execute on function public.refresh_kickoff_uncertain(uuid) to service_role;

-- ============================================================================
-- Verifikation — kør efter scriptet
-- ============================================================================
-- 1) Kolonnerne findes, og intet er markeret endnu (alle rækker false, alle
--    kickoff_prev_at tomme):
--
--    select kickoff_uncertain, count(*) filter (where kickoff_prev_at is not null) as har_forrige,
--           count(*) from public.matches group by 1;
--
-- 2) Triggeren står der og er betinget:
--
--    select tgname, pg_get_triggerdef(oid) from pg_trigger
--    where tgrelid = 'public.matches'::regclass and not tgisinternal;
--
-- 3) Ingen lås har flyttet sig. Tallene skal være de samme før og efter denne
--    fil — det er hele pointen med en display-only markør:
--
--    select count(*) filter (where is_locked) as laaste, count(*) as i_alt
--    from public.analytics_match_locks;
--
-- 4) Efter et par døgns synkronisering: hvad har turneringerne lært?
--
--    select l.name, (m.kickoff_prev_at at time zone 'UTC')::time as indlaert_tid, count(*)
--    from public.matches m
--    join public.seasons s on s.id = m.season_id
--    join public.leagues l on l.id = s.league_id
--    where m.kickoff_prev_at is not null
--    group by 1, 2 having count(*) >= 3 order by 1, 2;
