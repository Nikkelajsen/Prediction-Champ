-- Den PERSONLIGE kampdag (A39): dagskortet udgives, når modtagerens EGNE
-- konkurrencer er færdigspillet — ikke når hver eneste kamp i alle syv
-- turneringer er det.
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- 📍 `#N` er en migrering: nummeret står i kolonne 1 i filoversigten i
--    `sql/README.md`, hvor filnavnene er links. `#67` =
--    `analytics_standings_share.sql`, denne fil er `#68`.
--
-- ✅ **REN TILFØJELSE I SIG SELV — SIKKER AT KØRE NÅR SOM HELST.** Filen
-- tilføjer to indekser og to læsefunktioner, og den erstatter
-- `generate_stories_catchup()` med en udgave, der kan se den nye slags hul.
-- Ingen tabel, ingen policy, ingen rettighed smalnes, ingen række ændres.
--
-- 🔴 **MEN DEN ER TRIN 1 AF 3, OG RÆKKEFØLGEN ER BINDENDE:**
--
--     #68 (denne fil)  →  gen-kør #47 story_engine_v3.sql  →  gen-kør #5
--                                                             rating_trigger_optimization.sql
--
-- Hvert mellemtrin er en gyldig tilstand, og det er derfor, der IKKE er skrevet
-- en `docs/UDRULNING-A39.md`. Mønstret fra `UDRULNING-A40`/`A43` findes for det
-- tilfælde, hvor appen er i stykker MELLEM to trin, og den tilstand findes ikke
-- her:
--
--   · efter #68 alene:  motoren er stadig global og returnerer straks for de
--     dage, bagstopperen nu tilbyder den. Virker, spilder få kald.
--   · efter #68 + #47:  A39 er LEVERET, men via bagstopperen — altså med op til
--     15-30 minutters forsinkelse i stedet for i samme sekund, fordi triggerens
--     eget globale fortjek stadig spærrer dens vej ind. Fuldt brugbar tilstand.
--   · efter alle tre:   kortet skrives i samme sætning som resultatet.
--
-- **Frontenden røres ikke af nogen af de tre.** `loadDayCard`, `isFresh`,
-- `dismissStory` og `roundIsNewer` læser RÆKKEN og ikke tidspunktet, den blev
-- skrevet på. Et kort skrevet kl. 16 i stedet for kl. 22 ser ens ud hele vejen.
--
-- ---------------------------------------------------------------------------
-- HVAD DER VAR GALT
--
-- `generate_daily_stories()` spurgte `public.match_day_complete(p_day)`, og det
-- prædikat er GLOBALT: det kræver, at hver eneste kamp på dagen har et resultat,
-- uanset turnering og uanset konkurrence. En bruger, hvis konkurrencer kun rører
-- Superliga, og hvis sidste kamp var slut kl. 16, ventede derfor på La Ligas
-- kamp kl. 22:45 — og ved en udsat eller uindberettet kamp ventede hun for
-- evigt, mens hendes egen kampdag for længst var afgjort.
--
-- Prisen var dokumenteret som bevidst: den globale kampdag er produktets ene
-- tvær-turneringsbegreb, og et prædikat, man kan læse sig til, er mere værd end
-- et, der er mere korrekt. Den blev betalt synligt under `A38`s undersøgelse,
-- hvor det tog tid at afgøre, om stilheden var en fejl eller en ventende kamp.
--
-- ---------------------------------------------------------------------------
-- AFGRÆNSNINGEN ER ALLE DAGENS KAMPE I MINE KONKURRENCER — IKKE KUN DE TIPPEDE
--
-- Den nærliggende regel — "kortet må udgives, når den sidste kamp, brugeren har
-- TIPPET på, er slut" — er forkert, og det er værd at vide hvorfor, fordi den
-- lyder rigtigere.
--
-- Kortet påstår ikke kun noget om modtagerens egne tips. Det bærer stillingen
-- (`_sd_after`, med hele tiebreaker-stigen) og siden `G88` en mini-stilling med
-- tre rækker af konkurrencen. De tal flytter sig, når MODSTANDERNE får point.
-- En bruger, der glemte at tippe aftenkampen, ville med den regel få "du ligger
-- nr. 2" kl. 16 og en anden sandhed kl. 22 — altså præcis `A38`s fejltype, som
-- hele v3 er bygget for at undgå.
--
-- Den mindste holdbare enhed er derfor: ALLE dagens kampe i de konkurrencer, jeg
-- deltager i, har et resultat. Og den er sammenhængende hele vejen igennem —
-- er jeg klar, er `_sd_after` for netop MINE konkurrencer regnet på en færdig
-- dag, og mini-stillingen og `_sd_rival` læser kun gennem en konkurrence, jeg
-- deler med hovedpersonen, altså en af mine, altså en færdig. Intet kort kan
-- komme til at bære et halvt regnet tal.
--
-- ---------------------------------------------------------------------------
-- HVORFOR TO FUNKTIONER OG IKKE ÉN
--
-- Motoren og bagstopperen har kun brug for de brugere, hvis dag er FÆRDIG.
-- Kontrollen `sql/checks/day_card_coverage.sql` har brug for mere: den skal
-- kunne skelne "dagen spilles endnu" fra "dagen VOKSEDE, efter kortet blev
-- skrevet", og til det skal den kende både `n_matches` og `n_open` for ALLE
-- brugere. Én rå funktion plus én afledt betyder, at afgrænsningen — det
-- udtryk, hele A39 hviler på — står ét eneste sted.
--
-- 🔴 **DER ER MED VILJE INGEN `user_day_complete(uuid, date)`.** En boolsk form
-- pr. bruger ville blive kaldt N gange, og motoren kalder nu ved hvert resultat,
-- der gør nogens dag færdig — fire-fem gange på en stor lørdag frem for én. Har
-- en test brug for det boolske, skriver den
-- `exists (select 1 from public.users_with_complete_day(d) u where u.user_id = …)`,
-- så der ikke findes en anden definition at drive fra.

-- ============================================================================
-- 1. Indekser
-- ============================================================================
-- 🔴 DET FØRSTE ER IKKE PYNT, OG DET ER FILENS ENESTE YDELSESRISIKO.
-- `competition_matches` har kun sin primærnøgle `(competition_id, match_id)`
-- (`sql/schema.sql`), så opslaget den anden vej — fra en KAMP til de
-- konkurrencer, der dækker den — er en fuld scanning. Det var til at bære, da
-- dagsmotoren kørte én gang pr. kampdag. Efter A39 kører den ved hvert resultat,
-- der gør nogens dag færdig, og uden dette indeks er det dét, der vælter
-- acceptkriterie 10 i `docs/features/story-engine-v3.md`.
create index if not exists competition_matches_match_idx
  on public.competition_matches (match_id);

-- Frysningen og forliget i `generate_daily_stories()` slår begge op på
-- `(period, day_key)`, og triggeren tæller dagens kort ved hver kørsel. Uden
-- indekset er hver af dem en sekventiel scanning af `stories` — igen: én gang om
-- dagen var gratis, N gange er det ikke.
create index if not exists stories_day_idx
  on public.stories (day_key) where period = 'day';

-- ============================================================================
-- 2. Den personlige kampdag
-- ============================================================================
-- Brugerens dagsomfang: hvor mange af dagens kampe dækker hendes konkurrencer,
-- og hvor mange af dem mangler stadig et resultat.
--
-- 🔴 `distinct` ER BÆRENDE OG IKKE EN OPRYDNING. To af mine konkurrencer kan
-- dække SAMME kamp — det er hverdag, ikke en kant, og testfixturens c1 og c2 gør
-- det for hver eneste kamp. Dagens omfang er en MÆNGDE af kampe, ikke en sum af
-- rækker. Uden `distinct` ville en ny konkurrence, der dækker kampe, jeg
-- allerede havde, tælle som en dag, der VOKSEDE, og frysningen i
-- `generate_daily_stories()` ville låse et kort, der intet havde at fryse for.
--
-- ⚠️ ALLE KOLONNEREFERENCER I KROPPEN ER KVALIFICEREDE, og det er ikke stil. I
-- `language sql` med `returns table` er outputkolonnernes navne synlige inde i
-- kroppen og skygger for alt andet med samme navn. Derfor hedder de også
-- `n_matches`/`n_open` frem for det nærliggende `matches`/`open`: `matches`
-- ville skygge for tabellen `public.matches`, og fejlen ville komme som noget,
-- der ikke ligner sin årsag.
--
-- `stable` og ikke `security definer`: funktionen læser kun det, kalderen selv
-- må se, og motoren kalder den i forvejen inde fra en `security definer`-krop.
create or replace function public.user_day_scope(p_day date)
returns table (user_id uuid, n_matches int, n_open int)
language sql
stable
set search_path = public
as $fn$
  with scope as (
    select distinct
           cp.user_id                                                as u_id,
           m.id                                                      as match_id,
           (m.home_score is null or m.away_score is null)            as is_open
    from public.matches m
    join public.competition_matches cm on cm.match_id = m.id
    join public.competition_participants cp on cp.competition_id = cm.competition_id
    where m.match_day = p_day
  )
  select s.u_id,
         count(*)::int,
         count(*) filter (where s.is_open)::int
  from scope s
  group by s.u_id;
$fn$;

comment on function public.user_day_scope(date) is
  'A39: brugerens personlige kampdag. Antal af dagens kampe, som hendes konkurrencer dækker, og hvor mange af dem der mangler resultat. Afgrænsningen står KUN her.';

-- De brugere, hvis egen dag er færdig — ét opslag for alle, ikke ét pr. bruger.
-- `n_matches` følger med, fordi motoren skriver det på kortet som
-- `payload.day_scope_matches` og senere måler frysningen mod netop dét tal.
-- Kommer de to fra hver sit udtryk, kan de drive fra hinanden uden at nogen ser
-- det; her kommer de fra samme.
create or replace function public.users_with_complete_day(p_day date)
returns table (user_id uuid, n_matches int)
language sql
stable
set search_path = public
as $fn$
  select s.user_id, s.n_matches
  from public.user_day_scope(p_day) s
  where s.n_open = 0;
$fn$;

comment on function public.users_with_complete_day(date) is
  'A39: alle brugere, hvis egne konkurrencer er færdigspillet på p_day. Modtagerkredsen for dagskortet.';

-- Rettighederne følger `match_day_complete()`s: læsbare for en indlogget bruger,
-- lukkede for anon. Kontrollen i `sql/checks/` kører som ejer, motoren som
-- `service_role`.
revoke execute on function public.user_day_scope(date) from public, anon;
revoke execute on function public.users_with_complete_day(date) from public, anon;
grant execute on function public.user_day_scope(date) to authenticated, service_role;
grant execute on function public.users_with_complete_day(date) to authenticated, service_role;

-- ============================================================================
-- 3. Bagstopperen — nu pr. (bruger, dag)
-- ============================================================================
-- 🔴 **DENNE FIL OVERTAGER EJERSKABET AF `generate_stories_catchup()` FRA
-- `#38 story_engine_v2.sql`.** Funktionen kunne ikke rettes dér, fordi `#38`
-- aldrig må gen-køres: samme fil bærer v2's `generate_daily_stories()`, som
-- tavst ruller hele v3 tilbage. Se advarslen i `sql/README.md` og i `#38`s eget
-- hoved. Kroppen nedenfor er `#38`s med dagsløkken omskrevet; runde-løkken er
-- ordret uændret, inklusive dens begrundelser, fordi den er en anden sag.
--
-- ---------------------------------------------------------------------------
-- HULLET HAR SKIFTET FORM
--
-- Før A39 var hullet "dagen mangler ET kort", og det kunne løkken spørge om med
-- et enkelt `not exists` mod `stories`. Efter A39 er det "en bruger, hvis EGEN
-- dag er færdig, mangler SIT kort" — og det er en anden slags spørgsmål, fordi
-- en dag nu kan være halvt besvaret. Lod man betingelsen stå, ville en dag, hvor
-- 3 ud af 50 brugere fik kort, se færdig ud, og de 47 ville aldrig blive samlet
-- op. Det er ikke en teoretisk kant: det er nøjagtig den tilstand, A39 SELV
-- producerer hver eneste kampdag.
--
-- Løkken har derfor to klasser, og de er delt op efter pris og ikke efter
-- elegance: den billige spørges altid, den dyre kun for dage, der allerede har
-- passeret alt andet.
--
-- ---------------------------------------------------------------------------
-- ER DEN STADIG ENDELIG? — argumentet skal genopfindes, ikke arves
--
-- `G90` og `G92` efterlod løkken med et loft på 20 og to negations-betingelser,
-- og hele begrundelsen hvilede på, at en dag kunne spørges om ÉN gang. Med to
-- klasser holder det argument ikke af sig selv. Det gør det stadig, men af nye
-- grunde, og de skal stå her frem for at blive antaget:
--
-- **(i) Klasse 2 er ÆGTE selvafsluttende — en forbedring, ikke en antagelse.**
-- Kvalificerer en dag sig via klasse 2, findes der pr. konstruktion en bruger
-- `u`, hvis egen dag er færdig, og som ikke har et v3-kort. Motoren VIL skrive
-- et kort for netop `u`:
--   · `u` kan ikke være frosset — frysningen rammer kun brugere, der HAR et kort,
--   · `u` står derfor i `_sd_ready`, efter frysningen har kørt,
--   · og `_sd_ready ⊆ {brugere, der får et kort}` (dækningspåstanden, som står
--     ved forliget i `story_engine_v3.sql` og er efterprøvet led for led dér).
-- Hvert forsøg fjerner altså mindst ét `(bruger, dag)`-par fra hullet, og
-- mængden er endelig. Klasse 2 kan pr. konstruktion ikke blive stående og æde
-- loftet — modsat klasse 1.
--
-- **(ii) Klasse 1 er uændret, også i det, den ikke kan.** `G92`s tredje slags
-- dag findes stadig: en dag uden kort, hvor INGEN brugers dag er færdig. Den
-- kvalificerer sig ved hver kørsel og får et kald, der returnerer straks.
-- Argumentet er ordret `G90`s: loftet gør prisen ENDELIG frem for ubegrænset,
-- ældste først, så et rigtigt hul aldrig sulter bag en blokeret dag. Men
-- klassen er blevet MINDRE — en dag, hvor bare én konkurrence er færdigspillet,
-- forlader den ved første kørsel i stedet for at vente på den sidste turnering.
-- Det er A39s gevinst målt på bagstopperen.
--
-- **(iii) Prisen for det dyre prædikat er bundet.** `users_with_complete_day()`
-- kaldes kun for dage, der passerer de tre billige forbetingelser, allerede har
-- et v3-kort, og ligger inden for tredive dage. Hvert kald er ét indekseret pas.
create or replace function public.generate_stories_catchup(p_grace int default 2)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_today date := public.match_day(now());
  v_n int := 0;
  d date;
  r date;
begin
  for d in
    -- DE BILLIGE FORBETINGELSER FØRST, og `as materialized` er ikke stil: uden
    -- den kan planlæggeren skubbe klasse 2's prædikat ned under aggregeringen og
    -- køre `users_with_complete_day()` pr. KAMP i stedet for pr. DAG.
    with kandidater as materialized (
      select m.match_day as dag
      from public.matches m
      where m.home_score is not null and m.away_score is not null
        -- Rundens SIDSTE kampdag udgiver kun rundekortet
        -- (generate_daily_stories returnerer straks). Ordret negationen af den
        -- udgang, så de dage aldrig tilbydes. UÆNDRET af A39: rundens sidste dag
        -- er et RUNDE-begreb, og rundekortet er pr. runde og ikke pr. bruger.
        and exists (select 1 from public.matches m2
                    where m2.round_key = public.round_key_of_date(m.match_day)
                      and m2.match_day > m.match_day)
        -- En dag, hvor ingen af kampene indgår i en konkurrence, har intet at
        -- lave et kort ud af — appen synkroniserer syv turneringer, men
        -- konkurrencerne dækker ikke dem alle.
        --
        -- Betingelsen er efter A39 INDEHOLDT i klasse 2 nedenfor (ingen bruger
        -- kan være klar på en dag uden konkurrence-kampe), men den bliver
        -- stående som et BILLIGT FORFILTER, fordi den udelukker historiens golde
        -- dage, før den dyre klasse overhovedet spørges.
        and exists (select 1 from public.competition_matches cm
                    join public.matches m3 on m3.id = cm.match_id
                    where m3.match_day = m.match_day)
      group by m.match_day
    )
    select k.dag from kandidater k
    -- KLASSE 1 (uændret): dagen har slet intet kort. Den almindelige form for
    -- hul, billig at spørge om — og den, der IKKE dræner for en dag, ingen kan
    -- få et kort på. Se (ii) ovenfor.
    where not exists (select 1 from public.stories s
                      where s.period = 'day' and s.day_key = k.dag)
    -- KLASSE 2 (ny, A39): dagen HAR v3-kort, men en bruger, hvis EGEN dag er
    -- færdig, mangler sit. Det er præcis det hul, den personlige kampdag
    -- producerer: bruger A fik sit kort kl. 16, bruger B's dag blev færdig kl.
    -- 22, og ingen sætning på `matches` udløste et kald derimellem.
    --
    -- `exists (v3-kort på dagen)` afgrænser til v3-æraen — samme skel som
    -- `stories_day_slot_uniq` og som `day_card_coverage`. Uden det ville hver
    -- eneste v2-dag i historikken kvalificere sig ved den første kørsel efter
    -- udrulningen og æde loftet i dagevis.
    --
    -- `>= current_date - 30` binder arbejdet for altid: v3-æraen vokser, og
    -- "alle v3-dage" ville ellers blive et voksende pas ved hver kørsel — 32
    -- gange i døgnet. Prisen er, at et hul ældre end tredive dage aldrig lukkes,
    -- hvilket er nøjagtig samme grænse, `day_card_coverage` og `prune_job_runs`
    -- allerede har sat.
       or (k.dag >= current_date - 30
           and exists (select 1 from public.stories s3
                       where s3.period = 'day' and s3.day_key = k.dag
                         and s3.news_value is not null)
           and exists (
             select 1 from public.users_with_complete_day(k.dag) u
             where not exists (select 1 from public.stories s2
                               where s2.period = 'day' and s2.day_key = k.dag
                                 and s2.user_id = u.user_id
                                 and s2.news_value is not null)))
    order by 1
    limit 20
  loop
    perform public.generate_daily_stories(d);
    v_n := v_n + 1;
  end loop;

  -- Runder, hvis vindue er lukket (tirsdag + 7 dage) og som mangler
  -- afslutningskortet. round_key er date her og text i stories — derfor ::text.
  --
  -- LØKKEN HAR ET LOFT OG EN BETINGELSE (G90, 8. august 2026). Uden dem havde den
  -- præcis det problem, `A38` lukkede for dagsløkken: en runde, der ALDRIG kan
  -- producere en historie, mangler sit kort for evigt, kvalificerer sig derfor ved
  -- hver eneste kørsel og bliver forsøgt 48-96 gange i døgnet. Prisen var spildt
  -- arbejde og ikke forkerte data, men den var **ubegrænset**.
  --
  -- **LØKKEN ER IKKE SELVAFSLUTTENDE, og det skal stå her frem for at blive
  -- antaget.** Betingelsen nedenfor er nødvendig og ikke tilstrækkelig: en runde
  -- kan have et scoret tip og ALLIGEVEL ikke kunne give et kort — fx hvis
  -- tipperen ikke deltager i en konkurrence, der dækker kampen, og ingen global
  -- regel udløser. Den slags runde bliver stadig forsøgt ved hver kørsel.
  -- Det blev opdaget af testens påstand 17e, som først antog, at efterslæbet
  -- drænes, og det gør det ikke.
  --
  -- **Det, loftet gør, er at gøre prisen ENDELIG frem for ubegrænset**: højst 20
  -- forsøg pr. kørsel uanset hvor mange golde runder der findes, og de ældste
  -- først, så et rigtigt hul aldrig kan sulte bag dem. En ægte terminering ville
  -- kræve, at et FORSØG blev husket — altså en tabel eller en kolonne — og det er
  -- en større pris end den, der betales her.
  --
  -- **BETINGELSEN ER IKKE DEN SAMME SOM DAGSLØKKENS, og det er en fejl værd at
  -- undgå.** Dagsløkken kræver, at dagen har kampe i en KONKURRENCE. Den regel
  -- ville være forkert her: `SHARP` (80/85) og `MONTH_CHAMP` (10) læser
  -- `round_standings`/`monthly_standings`, som bygger på `predictions` og
  -- `leagues.is_official` — ikke på `competition_matches`. En runde uden
  -- konkurrence-kampe kan altså stadig give et globalt kort, og en
  -- konkurrence-betingelse ville have undertrykt det tavst.
  --
  -- Fællesnævneren for ALLE rundens regler — de globale, de konkurrence-nære og
  -- det dæmpede tier — er, at de handler om nogens POINT. Findes der ikke ét
  -- scoret tip i runden, kan ingen regel fyre, og runden kan aldrig få et kort.
  -- Det er den betingelse, der står her, og den kan ikke undertrykke noget.
  for r in
    select distinct m.round_key
    from public.matches m
    where m.round_key < v_today - 7 - p_grace
      and m.home_score is not null and m.away_score is not null
      and not exists (select 1 from public.stories s
                      where s.period = 'round' and s.round_key = m.round_key::text)
      and exists (select 1 from public.predictions pr
                  join public.matches m2 on m2.id = pr.match_id
                  where m2.round_key = m.round_key
                    and m2.home_score is not null and m2.away_score is not null
                    and pr.pred_home is not null and pr.pred_away is not null)
    order by 1
    limit 20
  loop
    perform public.generate_stories(r::text);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$fn$;

revoke execute on function public.generate_stories_catchup(int) from public, anon, authenticated;
grant execute on function public.generate_stories_catchup(int) to service_role;

-- ============================================================================
-- Verifikation
-- ============================================================================
-- 1) Begge funktioner findes, og afgrænsningen er personlig. Forvent, at tallet
--    er FORSKELLIGT fra det globale på en dag med flere turneringer:
-- select (select count(*) from public.users_with_complete_day(current_date - 1)) as klar,
--        public.match_day_complete(current_date - 1)                             as global;
--
-- 2) Indekserne er lagt. Forvent to rækker:
-- select indexname from pg_indexes
--  where schemaname = 'public'
--    and indexname in ('competition_matches_match_idx', 'stories_day_idx');
--
-- 3) Ingen bruger tælles to gange, selvom to konkurrencer dækker samme kamp.
--    Forvent 0 rækker:
-- select user_id, count(*) from public.user_day_scope(current_date - 1)
--  group by 1 having count(*) > 1;
--
-- 4) Bagstopperen dræner klasse 2. Kald to gange i træk og forvent, at det andet
--    tal er lavere — de brugere, første kald skrev kort til, kvalificerer ikke
--    dagen igen:
-- select public.generate_stories_catchup(0);
-- select public.generate_stories_catchup(0);
--
-- 5) Hvem venter stadig, og på hvad? Aflæsningen, `A39` blev bygget for at
--    kunne give — den blokerede dag er nu en egenskab ved en BRUGER:
-- select s.user_id, s.n_matches, s.n_open
--   from public.user_day_scope(current_date) s
--  where s.n_open > 0
--  order by s.n_open desc;
