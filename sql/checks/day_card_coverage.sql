-- Kontrol: fik en færdigspillet kampdag sit dagskort? (Story Engine v3)
--
-- HVORFOR DEN FINDES
-- Story Engine v3 blev rullet ud 7. august 2026, og dens dagsmotor skrev
-- **aldrig en eneste række i produktion**. Det blev ikke opdaget af en test, en
-- alarm eller en log, men af et menneske, der undrede sig over, at rundens
-- historie på Hjem påstod noget, STILLING-skærmen modsagde. Kortet var forældet,
-- fordi dagskortet — det, der afløser det — manglede.
--
-- Fejlen kunne ikke ses nogen steder, og det er ikke tilfældigt. Historier
-- skrives inde i matches-triggeren bag en exception-guard, som er tavs, og et
-- MANGLENDE kort ser præcis ud som en rolig uge. Det er samme fejltype som `A9`
-- (juli 2026), hvor motoren aldrig havde genereret én eneste historie: begge
-- gange var symptomet stilhed, og stilhed udløser ingenting.
--
-- Instrumenteringen i `sql/rating_trigger_optimization.sql` (job `story-engine`
-- i `job_runs`) siger nu, hvad der SKETE ved hver kørsel. Denne kontrol siger,
-- om resultatet er rigtigt — og de to er ikke det samme: et spor kan mangle,
-- fordi triggeren aldrig fyrede.
--
-- HVAD DEN PÅSTÅR
-- En bruger, hvis EGNE konkurrencer er færdigspillet på en dag, der ikke er sin
-- rundes sidste kampdag, har sit dagskort — **og omvendt: ingen bruger har et
-- kort, der påstår at dække mere, end der er spillet.**
--
-- 🔴 KORNSTØRRELSEN BLEV PERSONLIG MED `A39` (august 2026). Indtil da var både
-- påstanden og dens modsætning egenskaber ved DAGEN: dagen var færdig eller ej,
-- dagen havde et kort eller ej. Efter den personlige kampdag kan en dag være
-- halvt besvaret — bruger A fik sit kort kl. 16, bruger B venter til 22 — og
-- begge dele er rigtige på samme tid. Kontrollen tæller derfor BRUGERE og
-- rapporterer stadig pr. dag: en tabel med tredive dage gange enogtyve brugere
-- er ikke en alarm, man kan skimme.
--
-- Den læser med motorens EGEN funktion (`public.user_day_scope`, `#68`) og ikke
-- med en kopi af dens forespørgsel. Det er forskellen på en kontrol og en anden
-- kontrol: spørger de to hver sit sted, kan de blive uenige, uden at nogen ser
-- det — og præcis dét var, hvad `G92` kostede.
--
-- DEN ANDEN HALVDEL KOM TIL EFTER, AT DEN FØRSTE HAVDE VÆRET BLIND (august
-- 2026). Kontrollen så kun efter et MANGLENDE kort og meldte roligt "spilles
-- endnu" om en dag, der både var uafsluttet og allerede havde fået sit kort.
-- Det var netop den tilstand, `generate_stories_catchup()` producerede, da den
-- mistede sit grace-vindue: bagstopperen kaldte dagsmotoren, som dengang ikke
-- selv spurgte `match_day_complete()`, og "Dagens facit" blev udgivet midt på
-- kampdagen med tal beregnet på en halv dag. Fejlen blev meldt af en bruger,
-- ikke af denne fil — og de to fejl har ikke samme vægt: et manglende kort er
-- et udeblevet svar, et for tidligt kort er et FORKERT svar, brugeren allerede
-- har læst. Derfor står tilstanden først i `case`-udtrykket og med versaler.
--
-- `news_value is not null` afgrænser til v3-æraen — samme æra-skel som det
-- unikke indeks `stories_day_slot_uniq` i sql/story_engine_v3.sql. Uden det
-- ville historiske v2-rækker og de kort, der blev skrevet før værnet kom,
-- holde alarmen rød for evigt, og en alarm, der ikke kan blive grøn, bliver
-- ignoreret. `>= current_date - 30` nedenfor gør det samme for tiden.
--
-- De fire forbehold er ikke slæk — de er nøjagtig de tilfælde, hvor motoren med
-- vilje ikke skriver noget, og de spejler ordret dens egne betingelser:
--   · rundens SIDSTE kampdag udgiver kun rundekortet (`generate_daily_stories`
--     returnerer straks). Det er den samme `not exists (… match_day > …)`, og
--     den er stadig GLOBAL: rundens sidste dag er et runde-begreb.
--   · en dag, hvor ingen kampe indgår i en konkurrence, har intet at lave et
--     kort ud af. Appen synkroniserer syv turneringer; konkurrencerne dækker
--     ikke dem alle.
--   · `spilles endnu`: ingen brugers EGEN dag er færdig endnu. Det er A39's
--     ærlige form for det gamle globale `match_day_complete()`-forbehold — og
--     den står bevidst LÆNGERE NEDE i stigen end før. Blev den stående øverst,
--     ville kontrollen lyse på hver eneste delvist spillede dag, og en alarm,
--     der altid lyser, er slukket.
--   · `i dag`: en dag dømmes for MANGLENDE kort først, når den er forbi.
--     Motoren skriver kortet i samme sætning som resultatet, men kontrollen kan
--     ramme mellemrummet — og efter A39 åbner det mellemrum N gange om dagen i
--     stedet for én, fordi motoren nu kaldes ved hvert slutfløjt, der gør nogens
--     dag færdig. En blinkende alarm er samme problem som en, der altid lyser.
--     Forbeholdet gælder KUN den manglende halvdel; den værre fejl — et kort,
--     der påstår for meget — dømmes stadig i nutid.
-- Tages ét af dem ud, lyser kontrollen rødt hver uge på noget, der er rigtigt.
--
-- HVORFOR `dage_uden_kort` OG IKKE EN PROCENTDEL
-- Nul er ikke en grad af noget. En dag har enten sit kort eller ikke, og en
-- manglende dag retter sig aldrig selv efter at bagstopperen har haft sin chance.
-- Der er derfor ingen tærskel at kalibrere her, modsat `kickoff_coverage`, hvor
-- 100 %-reglen var selve beslutningen.
--
-- HVORFOR `>= current_date - 30`
-- Kontrollen skal svare på "virker motoren nu", ikke "har den nogensinde svigtet".
-- Historiske huller — fx dem fra før v3 — ville ellers holde alarmen rød for
-- evigt, og en alarm, der ikke kan blive grøn, bliver ignoreret. Tredive dage
-- er valgt, fordi `job_runs` også kun gemmer tredive.
--
-- HVORFOR EN TEMPORÆR VIEW OG IKKE EN MIGRERING
-- Samme begrundelse som `kickoff_coverage.sql` og `league_admin_coverage.sql`:
-- der installeres INTET i produktionen — viewet lever kun i den psql-session,
-- der lige har læst filen — så den samme forespørgsel kan køres både mod
-- produktion og mod en tom engangsdatabase i CI. En kontrol, der er skrevet ét
-- sted og testet et andet, er to kontroller.
--
-- ---------------------------------------------------------------------------
-- SÅDAN KØRES DEN — TO VEJE, OG DE ER IKKE OMBYTTELIGE
--
-- **Vej A — Supabase SQL-editoren.** Indsæt HELE denne fil og tilføj en linje
-- til sidst:
--
--   select * from day_card_coverage order by dag desc;
--
-- Begge sætninger skal sendes i SAMME kørsel, fordi en temporær view kun lever
-- i sin egen session.
--
-- 🛑 **Editoren kan kun tage imod SQL.** `psql …` nedenfor er en
-- TERMINAL-kommando; indsat i editoren giver den
-- `42601: syntax error at or near "psql"`. Det er ikke en fejl i filen.
--
-- **Vej B — psql fra en terminal.** Kræver en session-forbindelse (port 5432),
-- som `SUPABASE_DB_URL` har:
--
--   psql "$SUPABASE_DB_URL" -q -At -F'|' \
--     -f sql/checks/day_card_coverage.sql \
--     -c 'select dag, kampe, kampe_i_konkurrence, kort, klar, mangler,
--                for_tidligt, tilstand
--           from day_card_coverage order by dag desc'
--
-- Det er vej B, en workflow ville bruge; vej A er den, et menneske bruger.

-- `or replace`, så filen kan læses to gange i samme session uden at fejle.
create or replace temporary view day_card_coverage as
with dage as (
  -- `uden_resultat` stod her indtil A39 og er væk med vilje: et GLOBALT antal
  -- åbne kampe er præcis det tal, den personlige kampdag gjorde uinteressant.
  -- Det, der betyder noget nu, er `folk.n_open` — antallet af åbne kampe i den
  -- ENKELTE brugers egne konkurrencer.
  select
    m.match_day                                              as dag,
    count(*)::int                                            as kampe
  from public.matches m
  where m.match_day >= current_date - 30
  group by m.match_day
),
-- DEN PERSONLIGE KAMPDAG PR. BRUGER, aflæst med motorens egen funktion.
-- `kort_payload` er brugerens v3-kort, hvis hun har et — hentet som payload og
-- ikke som et boolsk, fordi frysningens tal (`day_scope_matches`) skal læses ud
-- af det nedenfor.
folk as (
  select d.dag, s.user_id, s.n_matches, s.n_open,
         (select st.payload from public.stories st
           where st.period = 'day' and st.day_key = d.dag
             and st.user_id = s.user_id and st.news_value is not null) as kort_payload
  from dage d
  cross join lateral public.user_day_scope(d.dag) s
),
-- Ét pas over `folk` pr. dag frem for fem korrelerede underforespørgsler.
tal as (
  select f.dag,
         count(*) filter (where f.n_open = 0)::int                            as klar,
         count(*) filter (where f.n_open = 0 and f.kort_payload is null)::int as mangler,
         -- FOR TIDLIGT er ikke længere "kort på en uafsluttet dag". Frysningen
         -- PRODUCERER den tilstand med vilje: står kortet på 2 kampe, og har
         -- dagen siden fået 5, hvoraf 3 er åbne, er kortet frosset og
         -- fuldstændig korrekt. Den ægte fejl er et kort, der påstår at dække
         -- MINDST det, brugeren har nu, mens noget af det stadig spilles.
         count(*) filter (
           where f.n_open > 0 and f.kort_payload is not null
             and coalesce((f.kort_payload ->> 'day_scope_matches')::int, 0) >= f.n_matches
         )::int                                                               as for_tidligt
  from folk f
  group by f.dag
)
select
  d.dag,
  d.kampe,
  -- Antal af dagens kampe, der faktisk indgår i en konkurrence. Er den nul, er
  -- dagen usynlig for motoren, og et manglende kort er det rigtige svar.
  (select count(*)::int from public.competition_matches cm
     join public.matches m2 on m2.id = cm.match_id
    where m2.match_day = d.dag)                              as kampe_i_konkurrence,
  (select count(*)::int from public.stories s
    where s.period = 'day' and s.day_key = d.dag)            as kort,
  coalesce(t.klar, 0)                                        as klar,
  coalesce(t.mangler, 0)                                     as mangler,
  coalesce(t.for_tidligt, 0)                                 as for_tidligt,
  case
    -- DEN MODSATTE FEJL FØRST, fordi den er værre. Et kort, der påstår mere end
    -- der er spillet, er ikke et manglende svar — det er et FORKERT svar, som
    -- brugeren allerede har læst. Se begrundelsen for tilstanden nedenfor.
    when coalesce(t.for_tidligt, 0) > 0                      then 'KORT PÅ EN DAG, DER SPILLES'
    -- Ordret samme udtryk som den tidlige udgang i generate_daily_stories().
    -- Ændres den ene, skal den anden med — ellers lyver kontrollen om en
    -- adfærd, der er tilsigtet. Stadig global, som udgangen er det.
    when not exists (select 1 from public.matches m3
                      where m3.round_key = public.round_key_of_date(d.dag)
                        and m3.match_day > d.dag)            then 'rundens sidste dag'
    when not exists (select 1 from public.competition_matches cm2
                       join public.matches m4 on m4.id = cm2.match_id
                      where m4.match_day = d.dag)            then 'uden for konkurrencerne'
    -- A39: ikke "dagen spilles", men "ingen kan få et kort endnu".
    when coalesce(t.klar, 0) = 0                             then 'spilles endnu'
    -- Se forbehold 4 i hovedet: den manglende halvdel dømmes først, når dagen
    -- er forbi. Den værre fejl ovenfor dømmes stadig i nutid.
    when d.dag >= current_date                               then 'i dag'
    when coalesce(t.mangler, 0) > 0                          then 'MANGLER DAGSKORT'
    else 'ok'
  end                                                        as tilstand
from dage d
left join tal t on t.dag = d.dag;
