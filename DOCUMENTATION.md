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
Frontend: React + Vite, rent `fetch`-baseret mod Supabase (ingen SDK). Koden er opdelt i moduler under `src/`: `lib/` (`supabase.js` = REST-klient/auth, `scoring.js` = point/runde-helpers, `data.js` = alle async-loaders), `ui/` (`theme.js` = designtokens/styles, `components.jsx` = delkomponenter), og `screens/` (én fil pr. fane/skærm + `MainApp.jsx` = shell/navigation). `App.jsx` er en tynd rod, der booter session/auth. Mobil-first: 4-fane bundnavigation, maks. bredde ~430 px centreret (se afsnit 7).
Hosting: Vercel (Hobby-plan). Auto-deployer ved hver commit til GitHub (se afsnit 11).
Database + login: Supabase (Postgres + Auth), tilgået via REST/PostgREST. Frontenden bruger en offentlig `publishable`-nøgle, hårdkodet i `src/App.jsx` — det er by design (nøglen er offentlig og beskyttet af RLS).
Fodbolddata: Sportmonks API (gratis plan).
PWA: `manifest.json` + ikoner i `public/`, så appen kan tilføjes til hjemmeskærmen som en rigtig app. Manifest og ikoner følger appens mørkeblå tema (`#0C1622` + guld pokal).
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
`rating_history`	Rating-snapshot pr. bruger pr. runde. Kolonner: `user_id`, `scope`, `round_key`, `rating_after`, `delta` (rundens ratingændring), `round_score`, `matches_predicted`, `rnk`. Se afsnit 5.
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
Nye konkurrencer starter altid på 0 point: for `full_season` og `team` (som trækker kampe direkte fra hele sæsonen) udelader oprettelsen automatisk allerede afsluttede runder. Da `predictions` deles på tværs af konkurrencer, ville en ny konkurrence ellers med det samme give point for forudsigelser, man allerede havde afgivet i andre konkurrencer. Reglen: find den første spillerunde (`round_key`) hvor ikke alle kampe har resultat endnu, og medtag kun kampe fra og med den runde (helper: `filterFromNextUnfinishedRound`). Er hele sæsonen allerede spillet færdig, oprettes konkurrencen uden kampe. `custom` og `random` er upåvirket, da de i forvejen kun tilbyder kommende/ikke-spillede kampe i vælgeren; `time_range` filtrerer stadig kun på det datointerval, brugeren selv angiver.
Månedsligaen og sæsonchampionship er særlige "virtuelle" konkurrencer: de findes ikke som `competitions`-rækker, men vises automatisk for alle brugere (se afsnit 5).
Rullende gætte-vindue
Valgfrit pr. konkurrence (afkrydsning ved oprettelse): sætter `rules.openDaysBefore` (typisk 7). En kamp kan først forudsiges det angivne antal dage før kickoff. Da forudsigelser deles på tværs af konkurrencer, gælder vinduet kun, hvis alle konkurrencer en kamp indgår i har det sat — ellers ville det være muligt at omgå vinduet via en anden konkurrence.
---
4. Pointsystem
+3: præcist resultat (fx gættet 2-1, endte 2-1) — vises grønt (`#22C55E`)
+1: korrekt udfald (1/X/2), forkert resultat
0: forkert gæt, eller ingen forudsigelse afgivet
Der er INGEN minuspoint — man kan aldrig gå i minus (de gamle −1/−2 straffe er fjernet). Det handler om at samle så mange rigtige gæt som muligt.
Tiebreaker ved pointlighed: flest præcise resultater afgør først, dernæst flest korrekte udfald.
Reglerne er faste og gælder alle konkurrencer (gemt i `rules`-feltet ved oprettelse, med sikre standardværdier — `{ exact: 3, outcome: 1 }` — for ældre konkurrencer uden feltet). Frontenden beregner point i helperen `pointsFor(pred, actual, rules)`.
---
5. Prediction Champ Rating, månedsliga og sæsonchampionship
Rating og månedsliga bor i databasen (SQL) og læses af frontenden. SQL-scriptet er idempotent og kan køres igen når som helst. Sæsonchampionship beregnes i frontenden (se nedenfor).

Prediction Champ Rating
Et selvkorrigerende Elo-tal, der måler hvor gode ens gæt er — ikke hvor mange point man har samlet, og uafhængigt af hvor mange ligaer man er med i.
Princip: opdateres én gang pr. spillerunde (`round_key`), på tværs af alle ligaer samlet. Da `predictions` er én række pr. bruger pr. kamp, tælles hver kamp automatisk kun én gang, uanset hvor mange konkurrencer/ligaer den optræder i.
Beregning pr. runde: hver spiller får en rundescore = point / antal tippede kampe (tiebreak: flest præcise). Alle deltagere sammenlignes én mod én (multiplayer-Elo): man vinder/taber rating alt efter om man gjorde det bedre end forventet ud fra ratingforskellen. At slå en højere ratet spiller giver mere.
Parametre: alle starter på 1000. K = 32 de første 5 runder (foreløbig, markeret med `*` / "NY"-badge), derefter 24. Systemet er nulsum og selvkorrigerende — ingen inflation, ingen sæson-reset nødvendig.
`scope`: `'ALL'` = alle ligaer samlet (det eneste der bruges i dag). Kolonnen holder muligheden åben for per-liga-rating senere uden skemaændring.
Objekter i DB: tabellen `ratings` (aktuel rating), tabellen `rating_history` (snapshot pr. runde, inkl. `delta` = rundens ratingændring), funktionen `recompute_ratings()` (fuld genberegning fra bunden), samt hjælpefunktionen `pc_points(...)`.
Frontend: Rating-fanen viser rangliste + formkurve-prikker (grøn/gul/grå ud fra `delta` for de seneste 5 runder) + bevægelse ▲/▼ (seneste rundes `delta`) + "NY"-badge (foreløbig). Helper: `loadRatingHistory`.

Automatisk genberegning
En statement-level trigger (`matches_recompute_ratings`) på `matches` kalder `recompute_ratings()` automatisk, hver gang kampe ændres — altså så snart et resultat tastes ind. Statement-level betyder at den fyrer én gang pr. sætning, også når en hel runde gemmes på én gang (ikke én gang pr. kamp).
Der er også en manuel "Opdater ratings"-knap i Admin-skærmen (kun admin, nås via tandhjulet i topbjælken) som reserve.

Rundeliga
Alle brugere er automatisk med. Samlede point for én enkelt spillerunde (`round_key`), på tværs af alle ligaer, hver kamp én gang. Rangeres efter flest point (tiebreak: flest præcise); den øverste kåres som Rundens Prediction Champ, når runden er færdigspillet. Beregnes i frontenden (som sæsonchampionship): `loadRoundBoard(token, roundKey)` summerer point for alle spillede kampe i runden, og `loadRoundsAvailable(token)` giver de runder, der har mindst én spillet kamp (nyeste først, valgbar i en dropdown). Championship-fanen lander på den seneste runde. Kun spillede/låste kampe tæller, så RLS tillader at læse alles gæt.

Månedsliga
Alle brugere er automatisk med — ingen tilmelding. Viewet `monthly_standings` summerer hver brugers point for alle kampe i en kalendermåned (igen: hver kamp én gang). Rangeres efter flest samlede point (tiebreak: flest præcise resultater); den øverste er Månedens Prediction Champ. Stillingen nulstilles reelt den 1., fordi viewet grupperer på måned. Tidligere måneder kan vælges i en dropdown og ligger fast, da kampene er spillet. Helper: `loadMonthlyBoard`.

Sæsonchampionship
Alle brugere er automatisk med. Samlede point for alle kampe i en ligas aktuelle sæson (i praksis Superligaen), rangeret efter flest point (tiebreak: flest præcise); den øverste er Sæsonens Prediction Champ. I modsætning til månedsligaen findes der IKKE et DB-view for dette — det beregnes i frontenden af helperen `loadSeasonBoard(token, leagueId)`, som henter sæsonens kampe + gæt og summerer point pr. bruger. Kun spillede kampe tæller, og de er altid låste, så RLS tillader at læse alles gæt (ingen snyde-risiko). Championship-fanen finder ligaen ud fra navnet (`/superliga/i`, synlig). Ved venneflok-skala er klient-beregningen hurtig nok; ved mange brugere/kampe bør den flyttes til et DB-view som månedsligaen (se afsnit 12).

Rettigheder: `ratings` og `rating_history` har RLS med læse-adgang for `authenticated`. `recompute_ratings()` er `security definer` (kører som ejer). Viewet `monthly_standings` arver `predictions`/`matches`' adgang.
---
6. Unikke brugernavne
`profiles.display_name` har et unikt, case-insensitivt indeks (`profiles_display_name_lower_idx`) — den egentlige garanti mod dubletter, også ved samtidige oprettelser.
Funktionen `username_available(name)` (kaldbar af `anon` + `authenticated`) tjekker om et navn er ledigt, før kontoen oprettes. Frontenden kalder den ved signup og blokerer med en venlig besked ("Brugernavnet er allerede taget"), så man ikke får oprettet en konto der alligevel fejler.
Et brugernavn behøver ikke være ens rigtige navn; Hjem-fanen hilser med hele `display_name`.
---
7. Brugerflade og navigation
Appen er mobil-first med en bundnavigation på fire faner og en topbjælke.

Topbjælke: krone + "Prediction Champ", samt til højre: ⓘ (åbner "Sådan virker det"-siden), tandhjul (kun admin → Admin-skærmen), og log ud.

De fire faner (bundnav):
Hjem — deadline-kort (næste rundes deadline + antal kampe der mangler tips + "Tip nu"-knap; helper `computeHomeTips`), rating-snapshot (rating, bevægelse, placering, formkurve → linker til Rating), og "Dine placeringer" (månedsliga + private ligaer, hver linker videre). Har brugeren tippet alt, viser kortet en "Alle tips er inde"-tilstand.
Ligaer — brugerens private konkurrencer som kort (navn, type, antal deltagere, egen placering). Opret (åbner opret-skærm), Join med kode, Arkivér/Gendan og Slet (kun opretter). Klik på et kort → Stilling.
Championship — officielle konkurrencer, alle automatisk med: Rundeliga (rundevælger + Rundens Prediction Champ), Månedsliga (månedsvælger + Månedens Prediction Champ) og Sæsonchampionship (live stilling + Sæsonens Prediction Champ + progress).
Rating — rangliste med rating, formkurve-prikker (seneste 5 runder), bevægelse ▲/▼ og "NY"-badge. Egen række fremhæves.

Drill-in-skærme (nås fra fanerne, ikke i bundnav):
Stilling — vælg konkurrence i dropdown; viser placering, Rating (`*` = foreløbig), 🎯 (præcise resultater), Form (point i seneste 3 runder) og ▲/▼ for placeringsændring. Klik på et navn åbner brugerens forudsigelser for færdigspillede runder (bladr frem/tilbage); klik på et pointtal i "Point pr. runde"-tabellen åbner samme visning landet på netop den runde. Snyde-sikring: kun runder hvor ALLE kampe har resultat vises. "Invitér"-knap kopierer et join-link (`?join=kode`). "Point pr. runde"-tabel: spillere som kolonner, runder som rækker, nyeste øverst, kun de 3 seneste vises med en "Vis alle X runder"-knap.
Tip (forudsigelser) — dropdown til at vælge "Alle konkurrencer" eller én; kampe deduplikeres pr. runde. Starter på den runde der indeholder i dag (eller nærmeste kommende). Grønt ✓ efter et gemt gæt. Nedtælling ("Låser om X t Y min") for kampe der låser inden for 24 timer. "Alles gæt" foldes ud under en låst kamp og viser alle deltageres gæt + point.
Opret liga — hele opret-flowet (mode-valg, hold/dato/håndplukket/tilfældig, rullende vindue).

Regler/hjælp: "Sådan virker det"-siden (fra ⓘ i topbjælken) samler pointsystem, tiebreak, rating, championship/månedsliga, tips-synlighed og rullende vindue. Derudover har hver fane et kontekstuelt ⓘ med en kort forklaring.
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
Disse bruges kun af serverfunktionen (`api/sync-matches.js`). Frontenden bruger derimod en hårdkodet offentlig `SUPABASE_URL` + `publishable`-nøgle i `src/App.jsx`.
VIGTIGT: Alle miljøer peger på SAMME Supabase-projekt — også Vercels preview-URL pr. branch. Data (resultater, gæt, konkurrencer) deles derfor mellem preview og produktion. Test derfor UI/navigation frit på en preview, men undgå at taste rigtige resultater ind dér, da de rammer alle brugere.
---
10. Sådan tilføjer du en ny liga
Find ligaens Sportmonks-id
Indsæt en ny række i `leagues` (+ `api_league_id`)
Indsæt en sæson-række i `seasons`
Kald sync-funktionen med den nye ligas id — den opretter selv holdene
Opret et ekstra cron-job til automatisk opdatering
Ingen kodeændringer nødvendige.
---
11. Lokal udvikling & deploy
Krav: Node 18+ (repoet er testet med Node 22).
Kom i gang:
`npm install` — installér afhængigheder (React, Vite, lucide-react)
`npm run dev` — start udviklingsserver på http://localhost:5173
`npm run build` — byg til produktion (output i `dist/`)
`npm run preview` — se produktions-build lokalt
Deploy: Vercel auto-deployer ved hver commit til `main`. Hver branch får desuden automatisk en preview-URL, så nye ting kan testes side om side med den live app (husk afsnit 9: samme database).
Arbejdsgang: udvikl på en feature-branch → åbn en pull request → merge til `main`. `main` = det, alle brugere ser. `node_modules/` og `dist/` er git-ignoreret.
Test: der er ingen automatisk testsuite. Verificér ændringer manuelt (byg + klik igennem på preview). PWA-cache kan holde på en gammel version — et hard-refresh (eller geninstallation af hjemmeskærms-genvejen) tvinger den nye frem.
---
12. Kendte begrænsninger
Superliga Playoff kan ikke synkroniseres endnu — Sportmonks har ikke oprettet 2026/27-sæsonen for den del (formentlig til foråret). Den er skjult for almindelige brugere (`is_visible = false`) men tilgængelig for admin under Kampe/Resultater.
Alle kan oprette konti uden godkendelse — fint til en lukket venneflok.
Ingen push-notifikationer eller e-mail-påmindelser om deadlines.
Koden er opdelt i moduler (afsnit 1). Den enkelte fil er nu overskuelig (største ~240 linjer); ved yderligere vækst kan `data.js` og de største skærme deles videre op.
Sæsonchampionship beregnes i browseren (`loadSeasonBoard`), ikke som et DB-view. Ved mange brugere/kampe bør det flyttes til et `monthly_standings`-lignende view for hastighed.
Rating-genberegningen er en fuld genberegning fra bunden hver gang. Det er hurtigt ved venneflok-skala; ved mange tusinde brugere bør beregningen laves inkrementel eller optimeres (sortér + histogram i stedet for alle-mod-alle).
Preview og produktion deler database (afsnit 9) — der findes ingen separat test-database.
---
13. Fejlfindingslog
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
14. Changelog
Nyeste øverst. Ældre "patch"-numre stammer fra tidligere fejlrettelser (se afsnit 13).

Juli 2026 — Sletning af tips virker igen (persistens)
Rettet: en bruger kunne rydde sit tip i Tip-skærmen, men det dukkede op igen næste gang appen blev åbnet. To fejl: (1) frontenden tømte kun lokal state — når et scorefelt blev ryddet, returnerede `save()` uden at røre databasen. Nu sletter den den gemte række (`db.del` på `predictions`), når et tidligere fuldstændigt tip ryddes, og opdaterer `allPreds`. (2) `predictions` havde slet ingen DELETE-policy, så sletningen blev blokeret lydløst af RLS (PostgREST svarede 204 uden at slette noget). Ny idempotent policy i `sql/predictions_delete_policy.sql` tillader en bruger at slette sine egne tips, men kun for kampe der ikke er låst endnu (samme regel som `isLocked()`: intet resultat og nu < kickoff minus 1 time) — man kan altså kun slette inden runden går i gang. SQL'en skal køres én gang i Supabase-editoren ("Run without RLS").

Juli 2026 — Brugerstatistik (admin)
Ny "Statistik"-underfane i Admin-skærmen (ved siden af Kampe/Resultater), kun for admins. Viser nøgletal om brugerne: total & nye (7/30 dage), aktive DAU/WAU/MAU + fastholdelse (DAU/MAU) og gns. aktive dage, engagement (har tippet, gns. tips pr. bruger, med i privat liga) og frafald (aldrig tippet, inaktive 30+ dage), samt to søjlekurver (tilmeldinger/uge, aktive/dag). Aktivitet spores selv via et letvægts-"ping" (`touch_activity()`) ved app-start — throttlet til maks. 1×/time i frontenden (`touchActivity` i `data.js`, kaldt fra `App.jsx`'s `completeAuth`). SQL i `sql/user_stats.sql` (idempotent): tilføjer `profiles.created_at`/`last_seen_at`, tabellen `user_activity_days` (én række pr. bruger pr. aktiv dag, RLS uden policies), samt `security definer`-funktionerne `touch_activity()` (auth) og `admin_user_stats()` (admin-guard, returnerer alle nøgletal som jsonb). Frontend-helper: `loadUserStats`. Bemærk: aktivitetstal begynder først at samle sig fra funktionen tages i brug; total/nye dækker også eksisterende brugere via backfill fra `auth.users`.

Juli 2026 — Rundeliga (Rundens Prediction Champ)
Nyt kort i Championship: samlede point for én enkelt spillerunde med rundevælger, så rundens bedste kan kåres som Rundens Prediction Champ efter hver runde. Alle er automatisk med — samme princip som månedsligaen. Beregnes i frontenden (`loadRoundBoard` / `loadRoundsAvailable`, afsnit 5).

Juli 2026 — Kodeopdeling (refaktorering)
Den monolitiske `src/App.jsx` (~2.400 linjer) er delt op i fokuserede moduler under `src/lib`, `src/ui` og `src/screens` (afsnit 1). Ren struktur-ændring — ingen ændring i adfærd, UI eller data; verificeret ved gennemklik af alle skærme.

Juli 2026 — Sæsonchampionship live
Sæsonchampionship-kortet på Championship-fanen er nu en rigtig stilling (var før statisk): samlede point for hele Superliga-sæsonen, alle automatisk med, flest point vinder (tiebreak: flest præcise). Beregnes i frontenden af `loadSeasonBoard`; kun spillede/låste kampe tæller, så RLS tillader at læse alles gæt (afsnit 5).

Juli 2026 — Ny 4-fane brugerflade (mobil-first)
Navigationen er omstruktureret til fire faner i en bundnavigation — Hjem · Ligaer · Championship · Rating — i et nyt mørkeblåt design (Barlow-fonte, maks. bredde ~430 px centreret). Database, scoring, rating og al konkurrence-logik er uændret (bevaret 1:1). Se afsnit 7 for den fulde beskrivelse.
- Hjem: deadline-kort med manglende tips + "Tip nu", rating-snapshot og "Dine placeringer".
- Ligaer: private konkurrencer (opret/join/arkivér/slet). Det virtuelle Månedsliga-kort er flyttet herfra til Championship.
- Championship: månedsliga (månedsvælger + Månedens Prediction Champ) og sæsonchampionship (live).
- Rating: leaderboard med formkurve-prikker (fra `rating_history.delta`), bevægelse ▲/▼ og "NY"-badge.
- Stilling og Tip er nu drill-in-skærme; Admin (Kampe/Resultater + "Opdater ratings") nås via tandhjul i topbjælken. Ny "Sådan virker det"-side + kontekstuelle ⓘ pr. fane. Gammel Global- og Regler-fane er fjernet (indhold flyttet).
- Månedsligaen viser samlede point (matcher rangeringen), ikke gennemsnit.
- Nyt app-ikon + udfyldt `manifest.json` i det nye tema. Hjem hilser med hele brugernavnet.

Juli 2026 — Nye konkurrencer starter altid fra 0
Rettet: en ny `full_season`/`team`-konkurrence kunne før få point med det samme, hvis brugeren allerede havde afgivet forudsigelser på de samme kampe i andre konkurrencer (da `predictions` er delt på tværs af konkurrencer). Oprettelsen udelader nu allerede afsluttede runder og starter i stedet fra næste ikke-afsluttede spillerunde (afsnit 3).

Juli 2026 — Rating & månedsliga
Prediction Champ Rating: selvkorrigerende Elo, én gang pr. runde, alle ligaer samlet (afsnit 5).
Månedsliga: `monthly_standings`-view, alle automatisk med, Månedens Prediction Champ.
Rating-kolonne i konkurrence-stillinger; kort in-app beskrivelser af rating og månedsliga.
Automatisk rating-genberegning via statement-level trigger på `matches` (kører når resultater gemmes) + manuel "Opdater ratings"-knap for admin.
Klik på navn/pointtal i Stilling åbner en spillers forudsigelser for færdigspillede runder (bladr frem/tilbage); kun runder hvor alle kampe har resultat vises.
Unikke brugernavne: case-insensitivt indeks + `username_available`-tjek ved signup (afsnit 6).
Pointsystemet forenklet til +3/+1/0 uden minuspoint.

Tidligere patches (udvalgte)
Patch 10: samlet `predictions`-RLS til én policy med OR (andre viste 0 point i Stilling).
Patch 9: oprydnings-SQL fjerner dublet-hold uden `api_team_id`.
Tidligere: rullende gætte-vindue (`openDaysBefore`), håndplukkede/tilfældige konkurrence-modes, arkivering pr. bruger, join-link med kode, automatisk resultathentning via Sportmonks + ekstern cron.
---
Bed Claude om at opdatere denne fil, når der sker større ændringer.
