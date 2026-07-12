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
`profiles`	Brugerprofiler. `display_name`, `is_admin`.
`competitions`	`mode` ∈ `full_season / team / time_range / custom / random`. `league_id`/`season_id` er nullable — `custom` og `random` kan spænde over flere ligaer. `rules` (jsonb) indeholder pointregler og evt. `openDaysBefore` (rullende gætte-vindue).
`competition_participants`	Deltagere. `hidden` = brugerens egen arkivering (påvirker ikke andre deltagere).
`competition_matches`	Hvilke kampe hører til hvilken konkurrence.
`predictions`	Én forudsigelse pr. bruger pr. kamp, delt på tværs af konkurrencer.
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
Rullende gætte-vindue
Valgfrit pr. konkurrence (afkrydsning ved oprettelse): sætter `rules.openDaysBefore` (typisk 7). En kamp kan først forudsiges det angivne antal dage før kickoff. Da forudsigelser deles på tværs af konkurrencer, gælder vinduet kun, hvis alle konkurrencer en kamp indgår i har det sat — ellers ville det være muligt at omgå vinduet via en anden konkurrence.
---
4. Pointsystem
+3: præcist resultat
+1: korrekt udfald (1/X/2), forkert resultat
0: forkert, eller ingen forudsigelse afgivet (bevidst valg — ingen straf for at glemme en kamp)
−1: gættede en vinder, men det modsatte hold vandt, eller gættede målforskel var mere end 5 mål forkert (aldrig ved uafgjort — hverken gættet eller faktisk resultat)
−2: begge ovenstående straffe rammer samme kamp
Tiebreaker ved pointlighed: flest præcise resultater afgør først, dernæst flest korrekte udfald.
Reglerne er faste og gælder alle konkurrencer (gemt i `rules`-feltet ved oprettelse, med sikre standardværdier for ældre konkurrencer uden feltet).
---
5. Stilling og Forudsigelser — UI-detaljer
Stilling:
Viser placering, 🎯 (antal præcise resultater), Form (point i seneste 3 runder), og ▲/▼ for placeringsændring efter seneste runde
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
Arkivér/Gendan (pr. bruger — påvirker ikke andres visning) på afsluttede konkurrencer
Skraldespand (kun synlig for opretteren) sletter konkurrencen for alle deltagere, med bekræftelse
---
6. Automatisk resultathentning (`api/sync-matches.js`)
Slår ligaens Sportmonks-id og gemte sæson-id op (eller sæson-navn første gang, og gemmer id'et)
Henter alle kampe for sæsonen med pagination
Auto-opdager og opretter hold ud fra kampenes deltagere
Udtrækker resultat kun når `state.short_name` er `FT`/`AET`/`FT_PEN` — scoren hentes fra `description: "CURRENT"`
Upserter kampene i Supabase (`api_fixture_id` er unik nøgle)
Kaldes med: `/api/sync-matches?leagueId=<uuid>&smSeason=2026/2027`
Test uden at skrive noget: tilføj `&dryRun=true`
Adgang: enten en admin-brugers login-token (bruges automatisk af "Hent resultater nu"), eller `&secret=<SYNC_SECRET>` (bruges af den eksterne cron).
Automatisk kørsel: cron-job.org kalder linket hvert 10.-15. minut (Vercels gratis cron er kun 1×/døgn, for sjældent). Ét cron-job pr. liga.
---
7. Miljøvariabler
Variabel	Formål
`SPORTMONKS_TOKEN`	API-nøgle til Sportmonks
`SUPABASE_URL`	Supabase-projektets URL
`SUPABASE_SERVICE_ROLE_KEY`	Server-side Supabase-nøgle (aldrig i frontend)
`SYNC_SECRET`	Autoriserer eksterne cron-kald til sync-funktionen
---
8. Sådan tilføjer du en ny liga
Find ligaens Sportmonks-id
Indsæt en ny række i `leagues` (+ `api_league_id`)
Indsæt en sæson-række i `seasons`
Kald sync-funktionen med den nye ligas id — den opretter selv holdene
Opret et ekstra cron-job til automatisk opdatering
Ingen kodeændringer nødvendige.
---
9. Kendte begrænsninger
Superliga Playoff kan ikke synkroniseres endnu — Sportmonks har ikke oprettet 2026/27-sæsonen for den del (formentlig til foråret). Den er skjult for almindelige brugere (`is_visible = false`) men tilgængelig for admin under Kampe/Resultater.
Alle kan oprette konti uden godkendelse — fint til en lukket venneflok.
Ingen push-notifikationer eller e-mail-påmindelser om deadlines.
`App.jsx` er stor (~1.100+ linjer) — bør splittes op i flere filer, hvis den fortsætter med at vokse.
---
10. Fejlfindingslog
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
---
Bed Claude om at opdatere denne fil, når der sker større ændringer.
