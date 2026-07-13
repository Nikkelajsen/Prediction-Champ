Prediction Champ — Dokumentation
Sidst opdateret: juli 2026
Prediction Champ er en webapp, hvor venner konkurrerer om at forudsige fodboldresultater. Denne fil dokumenterer, hvordan systemet hænger sammen.
---
1. Overblik over arkitekturen
```
┌─────────────────┐        ┌──────────────────┐        ┌─────────────────┐
│   Sportmonks     │──────▶│  Vercel Function  │──────▶│    Supabase      │
│  (football data) │        │ /api/sync-matches │        │ (database + auth)│
└─────────────────┘        └──────────────────┘        └─────────────────┘
                                                                  ▲
                                                          ┌──────────────┐
                                                          │  React-app    │
                                                          │ (Vercel-hosted)│
                                                          └──────────────┘
                                                                  ▲
                                                            Brugere (browser)
```
Frontend: React + Vite, ét stort komponentbibliotek i `src/App.jsx`, rent `fetch`-baseret mod Supabase (ingen SDK).
Hosting: Vercel (Hobby-plan). Auto-deployer ved hver commit til GitHub.
Database + login: Supabase (Postgres + Auth), tilgået via REST/PostgREST.
Fodbolddata: Sportmonks API (gratis plan).
PWA: `manifest.json` + ikoner i `public/`, så appen kan tilføjes til hjemmeskærmen som en rigtig app.
Kildekode: GitHub-repository `Nikkelajsen/Prediction-Champ`.
---
2. Database-skema
Tabel	Formål
`leagues`	Ligaer. `api_league_id` = Sportmonks' liga-id. `is_visible` styrer om ligaen vises for almindelige brugere (admin ser altid alt).
`seasons`	Sæson pr. liga. `api_season_id` gemmes automatisk af sync-funktionen første gang, så fremtidige kørsler ikke behøver navne-opslag.
`teams`	Hold. `api_team_id` = Sportmonks' hold-id, sat automatisk.
`matches`	Kampe. `round_key` (tirsdag–mandag, auto-beregnet), `home_score`/`away_score`, `api_fixture_id` (unik).
`profiles`	Brugerprofiler. `display_name`, `is_admin`. `display_name` er unikt (case-insensitivt) — se afsnit 6.
`competitions`	`mode` ∈ `full_season / team / time_range / custom / random`. `league_id`/`season_id` er nullable — `custom` og `random` kan spænde over flere ligaer. `rules` (jsonb) indeholder pointregler og evt. `openDaysBefore` (rullende gætte-vindue).
`competition_participants`	Deltagere. `hidden` = brugerens egen arkivering (påvirker ikke andre deltagere).
`competition_matches`	Hvilke kampe hører til hvilken konkurrence.
`predictions`	Én forudsigelse pr. bruger pr. kamp, delt på tværs af konkurrencer.
`ratings`	Aktuel Prediction Champ Rating pr. bruger. Nøgle `(user_id, scope)`. Se afsnit 5.
`rating_history`	Rating-snapshot pr. bruger pr. runde (ændring, rundescore, placering). Se afsnit 5.
`monthly_standings` (view)	Live-view der beregner månedsligaens stilling direkte fra `predictions` + `matches`. Se afsnit 5.
RLS-hovedregel for `predictions` (vigtig, rettet i patch 10): man kan altid læse sine egne forudsigelser; andres kun for kampe, der er låst (kickoff minus 1 time er passeret). Dette forhindrer snyd (at kigge andres gæt inden man selv tipper).
---
3. Konkurrence-modes
Mode	Beskrivelse
`full_season`	Alle kampe i den valgte ligas sæson
`team`	Alle kampe med ét specifikt hold
`time_range`	Alle kampe i et datointerval
`custom`	Håndplukkede kampe, valgt på tværs af alle synlige ligaer, med liga-filter i vælgeren
`random`	Et valgt antal tilfældige kampe fra den nærmeste kommende runde, med mulighed for at afgrænse til bestemte ligaer. Antallet begrænses automatisk til hvad der reelt er tilgængeligt
`custom` og `random` sætter `league_id`/`season_id` til `null` på konkurrencen — de er ikke bundet til én liga.
Nye konkurrencer starter altid på 0 point: for `full_season` og `team` (som trækker kampe direkte fra hele sæsonen) udelader `createCompetition` automatisk allerede afsluttede runder ved oprettelsen. Da `predictions` deles på tværs af konkurrencer, ville en ny konkurrence ellers med det samme give point for forudsigelser, man allerede havde afgivet i andre konkurrencer. Reglen: find den første spillerunde (`round_key`) hvor ikke alle kampe har resultat endnu, og medtag kun kampe fra og med den runde (helper: `filterFromNextUnfinishedRound`). Er hele sæsonen allerede spillet færdig, oprettes konkurrencen uden kampe. `custom` og `random` er upåvirket, da de i forvejen kun tilbyder kommende/ikke-spillede kampe i vælgeren; `time_range` filtrerer stadig kun på det datointerval, brugeren selv angiver.
Månedsligaen er en særlig "virtuel" konkurrence: den findes ikke som en `competitions`-række, men vises automatisk for alle brugere (se afsnit 5).
Rullende gætte-vindue
Valgfrit pr. konkurrence (afkrydsning ved oprettelse): sætter `rules.openDaysBefore` (typisk 7). En kamp kan først forudsiges det angivne antal dage før kickoff. Da forudsigelser deles på tværs af konkurrencer, gælder vinduet kun, hvis alle konkurrencer en kamp indgår i har det sat — ellers ville det være muligt at omgå vinduet via en anden konkurrence.
---
4. Pointsystem
+3: præcist resultat (vises grønt i reglerne, samme grønne familie som +1)
+1: korrekt udfald (1/X/2), forkert resultat
0: forkert, eller ingen forudsigelse afgivet (bevidst valg — ingen straf for at glemme en kamp)
−1: gættede en vinder, men det modsatte hold vandt, eller gættede målforskel var mere end 5 mål forkert (aldrig ved uafgjort — hverken gættet eller faktisk resultat)
−2: begge ovenstående straffe rammer samme kamp
Tiebreaker ved pointlighed: flest præcise resultater afgør først, dernæst flest korrekte udfald.
Reglerne er faste og gælder alle konkurrencer (gemt i `rules`-feltet ved oprettelse, med sikre standardværdier for ældre konkurrencer uden feltet).
---
5. Prediction Champ Rating, månedsliga og Global-fane
Al rating- og månedsliga-logik ligger i databasen (SQL) og læses af frontenden. SQL-scriptet er idempotent og kan køres igen når som helst.

Prediction Champ Rating
Et selvkorrigerende Elo-tal, der måler hvor gode ens gæt er — ikke hvor mange point man har samlet, og uafhængigt af hvor mange ligaer man er med i.
Princip: opdateres én gang pr. spillerunde (`round_key`), på tværs af alle ligaer samlet. Da `predictions` er én række pr. bruger pr. kamp, tælles hver kamp automatisk kun én gang, uanset hvor mange konkurrencer/ligaer den optræder i.
Beregning pr. runde: hver spiller får en rundescore = point / antal tippede kampe (tiebreak: flest præcise). Alle deltagere sammenlignes én mod én (multiplayer-Elo): man vinder/taber rating alt efter om man gjorde det bedre end forventet ud fra ratingforskellen. At slå en højere ratet spiller giver mere.
Parametre: alle starter på 1000. K = 32 de første 5 runder (foreløbig, markeret med `*`), derefter 24. Systemet er nulsum og selvkorrigerende — ingen inflation, ingen sæson-reset nødvendig.
`scope`: `'ALL'` = alle ligaer samlet (det eneste der bruges i dag). Kolonnen holder muligheden åben for per-liga-rating senere uden skemaændring.
Objekter i DB: tabellen `ratings` (aktuel rating), tabellen `rating_history` (snapshot pr. runde), funktionen `recompute_ratings()` (fuld genberegning fra bunden), samt hjælpefunktionen `pc_points(...)`.

Automatisk genberegning
En statement-level trigger (`matches_recompute_ratings`) på `matches` kalder `recompute_ratings()` automatisk, hver gang kampe ændres — altså så snart et resultat tastes ind. Statement-level betyder at den fyrer én gang pr. sætning, også når en hel runde gemmes på én gang (ikke én gang pr. kamp).
Der er også en manuel "Opdater ratings"-knap i Global-fanen (kun admin) som reserve.

Månedsliga
Alle brugere er automatisk med — ingen tilmelding. Viewet `monthly_standings` summerer hver brugers point for alle kampe i en kalendermåned (igen: hver kamp én gang). Den med flest point er Månedens Prediction Champ. Stillingen nulstilles reelt den 1., fordi viewet grupperer på måned. Tidligere måneder kan vælges i en dropdown og ligger fast, da kampene er spillet.

Global-fane (UI)
Ny fane med to undervisninger: Rating (global rangliste efter rating, med kort forklaring øverst) og Månedsliga (månedsvælger + fremhævet Månedens Prediction Champ + fuld stilling).
Månedsligaen vises desuden som et fast "Månedsliga"-kort øverst under Aktive konkurrencer hos alle brugere; et tryk fører til Global → Månedsliga. Kortet er virtuelt (ingen `competitions`-række, intet at joine).
Rating-kolonne: den enkelte brugers rating vises også ud for navnet i de almindelige konkurrence-stillinger.

Rettigheder: `ratings` og `rating_history` har RLS med læse-adgang for `authenticated`. `recompute_ratings()` er `security definer` (kører som ejer). Viewet arver `predictions`/`matches`' adgang.
---
6. Unikke brugernavne
`profiles.display_name` har et unikt, case-insensitivt indeks (`profiles_display_name_lower_idx`) — den egentlige garanti mod dubletter, også ved samtidige oprettelser.
Funktionen `username_available(name)` (kaldbar af `anon` + `authenticated`) tjekker om et navn er ledigt, før kontoen oprettes. Frontenden kalder den ved signup og blokerer med en venlig besked ("Brugernavnet er allerede taget"), så man ikke får oprettet en konto der alligevel fejler.
---
7. Stilling og Forudsigelser — UI-detaljer
Stilling:
Viser placering, Rating (Prediction Champ Rating, `*` = foreløbig), 🎯 (antal præcise resultater), Form (point i seneste 3 runder), og ▲/▼ for placeringsændring efter seneste runde
Klik på et navn åbner brugerens forudsigelser for færdigspillede runder (lander på seneste, bladr frem/tilbage). Klik på et pointtal i "Point pr. runde"-tabellen åbner samme visning landet på netop den runde
Snyde-sikring i visningen: kun runder hvor ALLE kampe har resultat vises — så man aldrig kan se gæt på uspillede kampe
"Invitér ven"-knap kopierer et join-link (`?join=kode`) direkte til udklipsholderen
"Point pr. runde"-tabel: spillere som kolonner, runder som rækker, nyeste runde øverst, kun de 3 seneste vises som standard med en "Vis alle X runder"-knap
Forudsigelser:
Standardvisning: alle kampe fra alle brugerens konkurrencer, samlet og dedupliceret pr. runde — med en dropdown til at indsnævre til én konkurrence
Starter automatisk på den runde, der indeholder i dag (eller den nærmeste kommende)
Grønt ✓ vises kort efter et gemt gæt
Nedtælling ("Låser om X t Y min") vises for kampe, der låser inden for 24 timer
"Alles gæt" foldes ud under en låst kamp og viser alle deltageres gæt + point
Konkurrencer:
Klik på et kort hopper direkte til Stilling for den konkurrence
Fast "Månedsliga"-kort øverst (alle brugere) → fører til Global → Månedsliga
Arkivér/Gendan (pr. bruger — påvirker ikke andres visning) på afsluttede konkurrencer
Skraldespand (kun synlig for opretteren) sletter konkurrencen for alle deltagere, med bekræftelse
---
8. Automatisk resultathentning (`api/sync-matches.js`)
Slår ligaens Sportmonks-id og gemte sæson-id op (eller sæson-navn første gang, og gemmer id'et)
Henter alle kampe for sæsonen med pagination
Auto-opdager og opretter hold ud fra kampenes deltagere
Udtrækker resultat kun når `state.short_name` er `FT`/`AET`/`FT_PEN` — scoren hentes fra `description: "CURRENT"`
Upserter kampene i Supabase (`api_fixture_id` er unik nøgle)
Bemærk: når sync opdaterer kampe med resultat, udløser DB-triggeren automatisk en rating-genberegning (afsnit 5)
Kaldes med: `/api/sync-matches?leagueId=<uuid>&smSeason=2026/2027`
Test uden at skrive noget: tilføj `&dryRun=true`
Adgang: enten en admin-brugers login-token (bruges automatisk af "Hent resultater nu"), eller `&secret=<SYNC_SECRET>` (bruges af den eksterne cron).
Automatisk kørsel: cron-job.org kalder linket hvert 10.-15. minut (Vercels gratis cron er kun 1×/døgn, for sjældent). Ét cron-job pr. liga.
---
9. Miljøvariabler
Variabel	Formål
`SPORTMONKS_TOKEN`	API-nøgle til Sportmonks
`SUPABASE_URL`	Supabase-projektets URL
`SUPABASE_SERVICE_ROLE_KEY`	Server-side Supabase-nøgle (aldrig i frontend)
`SYNC_SECRET`	Autoriserer eksterne cron-kald til sync-funktionen
---
10. Sådan tilføjer du en ny liga
Find ligaens Sportmonks-id
Indsæt en ny række i `leagues` (+ `api_league_id`)
Indsæt en sæson-række i `seasons`
Kald sync-funktionen med den nye ligas id — den opretter selv holdene
Opret et ekstra cron-job til automatisk opdatering
Ingen kodeændringer nødvendige.
---
11. Kendte begrænsninger
Superliga Playoff kan ikke synkroniseres endnu — Sportmonks har ikke oprettet 2026/27-sæsonen for den del (formentlig til foråret). Den er skjult for almindelige brugere (`is_visible = false`) men tilgængelig for admin under Kampe/Resultater.
Alle kan oprette konti uden godkendelse — fint til en lukket venneflok.
Ingen push-notifikationer eller e-mail-påmindelser om deadlines.
`App.jsx` er stor (~1.900 linjer) — bør splittes op i flere filer, hvis den fortsætter med at vokse.
Rating-genberegningen er en fuld genberegning fra bunden hver gang. Det er hurtigt ved venneflok-skala; ved mange tusinde brugere bør beregningen laves inkrementel eller optimeres (sortér + histogram i stedet for alle-mod-alle).
---
12. Fejlfindingslog
Symptom	Årsag	Løsning
"Load failed" i artifact-preview	Claude-artifacts kan ikke lave eksterne netværkskald	Deploy som rigtig webapp på Vercel
"infinite recursion" i Supabase	To RLS-policies refererede hinanden cirkulært	Forenklet policy
Kampe fra forrige sæson blandet ind	Sync brugte datointerval i stedet for sæson-match	Match på Sportmonks' sæsonnavn
Alle resultater var `null`	Forkert antaget feltnavn ("FT")	Sportmonks bruger `CURRENT` + `state.short_name`
Kunne ikke joine med kode	RLS blokerede opslag før medlemskab	Åbnet læse-adgang til `competitions`
Forkerte holdnavne på tværs af ligaer	Holdnavne slået op i forkert ligas liste	Forudsigelser/Stilling henter navne fra kampenes egne data
Andre viste 0 point i Stilling	To separate RLS-policies for `predictions` kombinerede ikke som forventet	Samlet til én policy med OR (patch 10)
`SyntaxError: Unexpected token '<'` i Vercel-logs	En fil var blevet korrumperet under copy-paste til GitHub	Markér alt i filen, slet, indsæt hele filen på ny
Dubletter i `teams` (med og uden `api_team_id`)	Seed-listens navne matchede ikke altid Sportmonks' navne	Oprydnings-SQL sletter ubrugte hold uden api-id (patch 9)
"unterminated dollar-quoted string" ved rating-SQL	Supabases "Run and enable RLS"-knap indsatte RLS-kode midt inde i en `$$`-funktion	Kør scriptet med "Run without RLS" — scriptet sætter selv RLS på de tabeller der skal have det
---
13. Changelog
Nyeste øverst. Ældre "patch"-numre stammer fra tidligere fejlrettelser (se afsnit 12).

Juli 2026 — Nye konkurrencer starter altid fra 0
Rettet: en ny `full_season`/`team`-konkurrence kunne før få point med det samme, hvis brugeren allerede havde afgivet forudsigelser på de samme kampe i andre konkurrencer (da `predictions` er delt på tværs af konkurrencer). `createCompetition` udelader nu allerede afsluttede runder ved oprettelse og starter i stedet fra næste ikke-afsluttede spillerunde (afsnit 3).

Juli 2026 — Rating & månedsliga
Prediction Champ Rating: selvkorrigerende Elo, én gang pr. runde, alle ligaer samlet (afsnit 5). Ny Global-fane med rating-rangliste og månedsliga.
Månedsliga: `monthly_standings`-view, alle automatisk med, Månedens Prediction Champ. Vises også som fast "Månedsliga"-kort under Aktive konkurrencer.
Rating-kolonne i konkurrence-stillinger; kort in-app beskrivelser af rating og månedsliga.
Automatisk rating-genberegning via statement-level trigger på `matches` (kører når resultater gemmes) + manuel "Opdater ratings"-knap for admin.
Klik på navn/pointtal i Stilling åbner en spillers forudsigelser for færdigspillede runder (bladr frem/tilbage); kun runder hvor alle kampe har resultat vises.
Unikke brugernavne: case-insensitivt indeks + `username_available`-tjek ved signup (afsnit 6).
+3 point vises nu grønt i reglerne (samme grønne familie som +1).

Tidligere patches (udvalgte)
Patch 10: samlet `predictions`-RLS til én policy med OR (andre viste 0 point i Stilling).
Patch 9: oprydnings-SQL fjerner dublet-hold uden `api_team_id`.
Tidligere: rullende gætte-vindue (`openDaysBefore`), håndplukkede/tilfældige konkurrence-modes, arkivering pr. bruger, join-link med kode, automatisk resultathentning via Sportmonks + ekstern cron.
---
Bed Claude om at opdatere denne fil, når der sker større ændringer.
