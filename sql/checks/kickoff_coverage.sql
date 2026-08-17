-- Kontrol: har de nært forestående kampe et rigtigt klokkeslæt? (G84)
--
-- HVORFOR DEN FINDES
-- Fra 2. til 6. august 2026 stod **alle** kampe fra de fem football-data-
-- turneringer med `kickoff_tbd = true`. Tiderne var der hos leverandøren; vi
-- kastede dem væk, fordi flaget blev sat af `status = 'SCHEDULED'`. I fire døgn
-- meldte appen "Tid ikke fastlagt" på hver eneste af dem, og låsen flyttede sig
-- til midnat på spilledagen.
--
-- Fejlen blev fundet af et menneske, der undrede sig over en SORTERING — La
-- Liga-kampene lå mellem Superligaens 16.00 og 18.00 — altså på en bivirkning
-- og ikke på symptomet. Ingen test og ingen kørende kontrol kunne have fanget
-- den, og det er ikke tilfældigt: enhedstestene i `api/sync-matches.test.js`
-- efterprøver, at flaget kommer korrekt MED i rækken, og det gjorde det. Fejlen
-- sad i, hvad flaget blev sat TIL, og den slags kan kun ses på fordelingen.
--
-- HVAD DEN PÅSTÅR
-- En kamp, der spilles inden for ti dage, har et klokkeslæt. Ikke altid for én
-- kamp — men aldrig for en hel turnering på én gang. Går alle en turnerings
-- nært forestående kampe fra "har tid" til "har ikke tid", er det en påstand om
-- vores egen aflæsning af leverandøren, ikke om terminslisten.
--
-- KENDT BLINDHED, OG DEN ER VALGT (17. august 2026). Fra `G85` til denne dato
-- talte kontrollen også `kickoff_uncertain` — den indlærte markør for "tiden er
-- sandsynligvis leverandørens gæt" — fordi Premier League, Primera División og
-- Serie A aldrig får en pladsholder fra football-data.org, men et OPDIGTET
-- klokkeslæt, som `kickoff_tbd` ikke kan se. Markøren blev fjernet igen sammen
-- med hele sit maskineri (#71, se docs/DECISIONS.md): gættet ramte netop de
-- mest bekræftede kampe. Kontrollen er dermed BEVIDST blind for en tid, der er
-- der og bare er forkert — den fejl retter sig selv via syncen, når
-- leverandøren flytter tiden.
--
-- HVORFOR 100 % OG IKKE EN ANDEL
-- En andel kræver en tærskel, og vi har ingen data at kalibrere den på — præcis
-- den slags ukalibrerede tal, `A35` står i backloggen for. 100 % er den eneste
-- tærskel, der er udledt af fejlen selv: en forkert aflæsning af leverandørens
-- markør rammer alt eller intet inden for én turnering. En kontrol, der råber
-- ved 60 %, ville til gengæld råbe på ægte terminslister.
--
-- HVORFOR MINDST TRE KAMPE
-- Én kamp uden fastsat tid er en normal tilstand (en omberammelse, en
-- cup-runde, der er trukket men ikke skemalagt). Gulvet på tre gør, at en enkelt
-- af dem ikke kan gøre kontrollen rød — og en kontrol, der ofte er rød uden
-- grund, lærer man at holde op med at læse. Er dét alligevel prisen en dag,
-- er rettelsen én linje: hæv gulvet, eller undtag turneringen.
--
-- HVORFOR `api_league_id is not null`
-- Samme afgrænsning som helbredstjekket i `job-heartbeat.yml` bruger, og af
-- samme grund: en turnering, der ikke kan synkroniseres, kan heller ikke rettes
-- af en synkronisering. Det holder også staging-simulatorens SIM-liga
-- (`sql/dev/simulate_season.sql`) ude, som pr. konstruktion ikke har et
-- leverandør-id.
--
-- HVORFOR EN TEMPORÆR VIEW OG IKKE EN MIGRERING
-- Kontrollen skal kunne ændres uden en kørsel i Supabase, og den skal kunne
-- efterprøves i CI. En temporær view lever kun i den psql-session, der lige har
-- læst filen: der installeres intet i produktionen, og filen kan derfor både
-- køres af heartbeat'en mod produktion og af `sql/tests/kickoff_coverage.sql`
-- mod en tom engangsdatabase — med den SAMME forespørgsel begge steder. Det er
-- hele pointen: en kontrol, der er skrevet ét sted og testet et andet, er to
-- kontroller (`G78`s fejltype).
--
-- Kræver en session-forbindelse (port 5432). Det har `SUPABASE_DB_URL` allerede,
-- fordi skema-eksporten bruger den til `pg_dump`.
--
-- Kør lokalt eller mod produktion:
--   psql "$SUPABASE_DB_URL" -q -At -F'|' \
--     -f sql/checks/kickoff_coverage.sql \
--     -c 'select liga, provider, kommende, uden_tid, tilstand from kickoff_coverage order by liga'

-- `or replace`, så filen kan læses to gange i samme session uden at fejle.
create or replace temporary view kickoff_coverage as
with kommende as (
  select l.name     as liga,
         l.provider as provider,
         m.kickoff_tbd
    from public.matches m
    join public.seasons s on s.id = m.season_id
    join public.leagues l on l.id = s.league_id
   -- Ikke spillet endnu: et resultat betyder, at kampen er overstået, og et
   -- klokkeslæt bagudrettet er ligegyldigt for både lås og visning.
   where m.home_score is null
     -- `current_date` og ikke `now()`, og det er ikke en detalje: en kamp uden
     -- fastsat tid bærer midnat som pladsholder, så `kickoff_at` for DAGENS
     -- kampe ligger i fortiden fra det øjeblik, klokken er over midnat UTC.
     -- Med `now()` ville kontrollen se bort fra præcis de kampe, en bruger er
     -- ved at få vist forkert.
     and m.kickoff_at >= current_date
     and m.kickoff_at <  current_date + 10
     and l.api_league_id is not null
)
select liga,
       provider,
       count(*)::int                                    as kommende,
       count(*) filter (where kickoff_tbd)::int         as uden_tid,
       case
         when count(*) < 3                              then 'for faa'
         when count(*) filter (where kickoff_tbd) = count(*) then 'ALLE UDEN TID'
         else 'ok'
       end                                              as tilstand
  from kommende
 group by liga, provider;
