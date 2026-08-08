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
-- En færdigspillet kampdag, hvis kampe indgår i mindst én konkurrence, og som
-- ikke er sin rundes sidste kampdag, har mindst ét dagskort.
--
-- De tre forbehold er ikke slæk — de er nøjagtig de tre tilfælde, hvor motoren
-- med vilje ikke skriver noget, og de spejler ordret dens egne betingelser:
--   · `match_day_complete()`: en dag med en kamp uden resultat er ikke færdig.
--   · rundens SIDSTE kampdag udgiver kun rundekortet (`generate_daily_stories`
--     returnerer straks). Det er den samme `not exists (… match_day > …)`.
--   · en dag, hvor ingen kampe indgår i en konkurrence, har intet at lave et
--     kort ud af. Appen synkroniserer syv turneringer; konkurrencerne dækker
--     ikke dem alle.
-- Tages ét af dem ud, lyser kontrollen rødt hver uge på noget, der er rigtigt —
-- og en alarm, der altid lyser, er slukket.
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
--     -c 'select dag, kampe, kampe_i_konkurrence, kort, tilstand
--           from day_card_coverage order by dag desc'
--
-- Det er vej B, en workflow ville bruge; vej A er den, et menneske bruger.

-- `or replace`, så filen kan læses to gange i samme session uden at fejle.
create or replace temporary view day_card_coverage as
with dage as (
  select
    m.match_day                                              as dag,
    count(*)::int                                            as kampe,
    count(*) filter (where m.home_score is null
                        or m.away_score is null)::int        as uden_resultat
  from public.matches m
  where m.match_day >= current_date - 30
  group by m.match_day
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
  case
    when d.uden_resultat > 0 then 'spilles endnu'
    -- Ordret samme udtryk som den tidlige udgang i generate_daily_stories().
    -- Ændres den ene, skal den anden med — ellers lyver kontrollen om en
    -- adfærd, der er tilsigtet.
    when not exists (select 1 from public.matches m3
                      where m3.round_key = public.round_key_of_date(d.dag)
                        and m3.match_day > d.dag)            then 'rundens sidste dag'
    when not exists (select 1 from public.competition_matches cm2
                       join public.matches m4 on m4.id = cm2.match_id
                      where m4.match_day = d.dag)            then 'uden for konkurrencerne'
    when not exists (select 1 from public.stories s2
                      where s2.period = 'day' and s2.day_key = d.dag)
                                                             then 'MANGLER DAGSKORT'
    else 'ok'
  end                                                        as tilstand
from dage d;
