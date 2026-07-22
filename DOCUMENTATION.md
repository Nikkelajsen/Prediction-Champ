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
`profiles`	Brugerprofiler. `display_name`, `is_admin`, `created_at` (tilmelding, backfillet fra `auth.users`), `last_seen_at` (senest aktiv, sat af `touch_activity()`). `display_name` er unikt (case-insensitivt) — se afsnit 6.
`competitions`	`mode` ∈ `full_season / team / time_range / custom / random`. `league_id`/`season_id` er nullable — `custom` og `random` kan spænde over flere ligaer. `rules` (jsonb) indeholder pointregler og evt. `openDaysBefore` (rullende gætte-vindue).
`competition_participants`	Deltagere. `hidden` = brugerens egen arkivering (påvirker ikke andre deltagere).
`competition_matches`	Hvilke kampe hører til hvilken konkurrence.
`predictions`	Én forudsigelse pr. bruger pr. kamp, delt på tværs af konkurrencer.
`ratings`	Aktuel Prediction Champ Rating pr. bruger. Nøgle `(user_id, scope)`. Se afsnit 5.
`rating_history`	Rating-snapshot pr. bruger pr. runde. Kolonner: `user_id`, `scope`, `round_key`, `rating_after`, `delta` (rundens ratingændring), `round_score`, `matches_predicted`, `rnk`. Se afsnit 5.
`monthly_standings` (view)	Live-view der beregner månedsligaens stilling direkte fra `predictions` + `matches`. Se afsnit 5.
`round_standings` (view)	Live-view med rundeligaens stilling pr. `round_key` (`sql/standings_views.sql`). Se afsnit 5.
`season_standings` (view)	Live-view med sæsonchampionship-stillingen pr. `season_id` (`sql/standings_views.sql`). Se afsnit 5.
`push_subscriptions`	Web Push-abonnementer, én række pr. enhed/browser der har slået notifikationer til. RLS: kun egne rækker. Se afsnit 16.
`notification_log`	Log over sendte push-beskeder pr. bruger (`user_id`, `key`), så samme besked aldrig sendes to gange. Kun serverfunktionen læser/skriver. Se afsnit 16.
`user_activity_days`	Aktivitets-sporing til brugerstatistik: én række pr. bruger pr. aktiv dag (`user_id`, `day`, PK begge). Skrives af `touch_activity()` ved app-start. RLS slået til uden policies — læses/skrives kun via `security definer`-funktioner. Se afsnit 15.
RLS-hovedregel for `predictions` (vigtig, rettet i patch 10): man kan altid læse sine egne forudsigelser; andres kun for kampe, der er låst. Dette forhindrer snyd (at kigge andres gæt inden man selv tipper). **Låsning er runde-baseret** (jf. `sql/predictions_round_lock_policies.sql`): alle kampe i en runde — samme `(season_id, round_key)` — låser samtidig, 1 time før rundens *tidligste* kickoff (eller så snart en kamp har fået resultat). Reglen `nu >= min(kickoff) − 1t` er i SQL udtrykt null-sikkert som "der findes en kamp i runden med `kickoff_at <= now() + 1 time`". Frontenden bruger samme regel via `isLocked(match, roundLockMap)` i `src/lib/scoring.js`. Så tipper alle på samme vidensgrundlag, og ingen kan spekulere i tidlige resultater eller afslørede gæt undervejs i runden.
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
Valgfrit pr. konkurrence (afkrydsning ved oprettelse): sætter `rules.openDaysBefore` (typisk 7). Kampene i en runde åbner det angivne antal dage før **rundens første kamp** (samme runde-scope som låsningen: `(season_id, round_key)`), så hele runden åbner samlet og en kamp aldrig kan åbne efter rundelåsen. Da forudsigelser deles på tværs af konkurrencer, gælder vinduet kun, hvis alle konkurrencer en kamp indgår i har det sat — ellers ville det være muligt at omgå vinduet via en anden konkurrence.
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
Rating, månedsliga, rundeliga og sæsonchampionship bor alle i databasen (SQL) og læses af frontenden. SQL-scripterne er idempotente og kan køres igen når som helst (nye scripts ligger i `sql/`-mappen; det oprindelige skema-/rating-script bør også indsættes dér, så alt er versioneret — se afsnit 12).

Prediction Champ Rating
Et selvkorrigerende Elo-tal, der måler hvor gode ens gæt er — ikke hvor mange point man har samlet, og uafhængigt af hvor mange ligaer man er med i.
Princip: opdateres én gang pr. spillerunde (`round_key`), på tværs af alle ligaer samlet. Da `predictions` er én række pr. bruger pr. kamp, tælles hver kamp automatisk kun én gang, uanset hvor mange konkurrencer/ligaer den optræder i.
Beregning pr. runde: hver spiller får en rundescore = point / antal tippede kampe (tiebreak: flest præcise). Alle deltagere sammenlignes én mod én (multiplayer-Elo): man vinder/taber rating alt efter om man gjorde det bedre end forventet ud fra ratingforskellen. At slå en højere ratet spiller giver mere.
Parametre: alle starter på 1000. K = 32 de første 5 runder (foreløbig, markeret med `*` / "NY"-badge), derefter 24. Systemet er nulsum og selvkorrigerende — ingen inflation, ingen sæson-reset nødvendig.
`scope`: `'ALL'` = alle ligaer samlet (det eneste der bruges i dag). Kolonnen holder muligheden åben for per-liga-rating senere uden skemaændring.
Objekter i DB: tabellen `ratings` (aktuel rating), tabellen `rating_history` (snapshot pr. runde, inkl. `delta` = rundens ratingændring), funktionen `recompute_ratings()` (fuld genberegning fra bunden), samt hjælpefunktionen `pc_points(...)`.
Frontend: Rating-fanen viser rangliste + formkurve-prikker (grøn/gul/grå ud fra `delta` for de seneste 5 runder) + bevægelse ▲/▼ (seneste rundes `delta`) + "NY"-badge (foreløbig). Helper: `loadRatingHistory`.

Automatisk genberegning
Tre statement-level triggere på `matches` (`matches_recompute_ratings_ins/_upd/_del`, fra `sql/rating_trigger_optimization.sql`) kalder `recompute_ratings()` automatisk — men KUN når mindst én kamps resultat reelt er ændret, tilføjet eller fjernet (sammenlignet via transition tables). Før kaldte den gamle trigger (`matches_recompute_ratings`) den fulde genberegning ved HVER sætning på `matches`, inkl. cron-syncens upsert hvert 10.-15. minut uden ændringer. Statement-level betyder stadig én kørsel pr. sætning, også når en hel runde gemmes på én gang.
Der er også en manuel "Opdater ratings"-knap i Admin-skærmen (kun admin, nås via tandhjulet i topbjælken) som reserve.

Rundeliga
Alle brugere er automatisk med. Samlede point for én enkelt spillerunde (`round_key`), på tværs af alle ligaer, hver kamp én gang. Rangeres efter flest point (tiebreak: flest præcise); den øverste kåres som Rundens Prediction Champ, når runden er færdigspillet. Stillingen beregnes i DB-viewet `round_standings` (`sql/standings_views.sql`) og læses af `loadRoundBoard(token, roundKey)`; `loadRoundsAvailable(token)` giver de runder, der har mindst én spillet kamp (nyeste først, valgbar i en dropdown). Championship-fanen lander på den seneste runde. Kun spillede/låste kampe indgår i viewet, så RLS tillader at læse alles gæt.

Månedsliga
Alle brugere er automatisk med — ingen tilmelding. Viewet `monthly_standings` summerer hver brugers point for alle kampe i en kalendermåned (igen: hver kamp én gang). Rangeres efter flest samlede point (tiebreak: flest præcise resultater); den øverste er Månedens Prediction Champ. Stillingen nulstilles reelt den 1., fordi viewet grupperer på måned. Tidligere måneder kan vælges i en dropdown og ligger fast, da kampene er spillet. Helper: `loadMonthlyBoard`.

Sæsonchampionship
Alle brugere er automatisk med. Samlede point for alle kampe i en ligas aktuelle sæson (i praksis Superligaen), rangeret efter flest point (tiebreak: flest præcise); den øverste er Sæsonens Prediction Champ. Stillingen beregnes i DB-viewet `season_standings` (`sql/standings_views.sql`) og læses af `loadSeasonBoard(token, leagueId)`, som derudover kun henter sæsonens kampe til fremdrifts-tælleren (spillet/total). Kun spillede kampe indgår i viewet, og de er altid låste, så RLS tillader at læse alles gæt (ingen snyde-risiko). Championship-fanen finder ligaen ud fra navnet (`/superliga/i`, synlig).

Rettigheder: `ratings` og `rating_history` har RLS med læse-adgang for `authenticated`. `recompute_ratings()` er `security definer` (kører som ejer). Viewsene `monthly_standings`, `round_standings` og `season_standings` arver `predictions`/`matches`' adgang (security invoker).
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
Hjem — deadline-kort (næste rundes deadline + antal kampe der mangler tips + "Tip nu"-knap; helper `computeHomeTips`), rating-snapshot (rating, bevægelse, placering, formkurve → linker til Rating), og "Dine placeringer" (månedsliga + private ligaer, hver linker videre). Deadline-kortet er farvekodet: rødt når man mangler tips til næste runde, grønt ("Alt ok — alle tips er inde") når alt er tippet. Derunder en live-oversigt over indeværende runde (resultat/tip/point pr. kamp + samlede point), der genindlæses hvert minut mens kampene spilles (helper `computeCurrentRound`). Nederst et opt-in-kort til push-notifikationer (afsnit 16), som kan skjules og forsvinder når man er tilmeldt.
Ligaer — brugerens private konkurrencer som kort (navn, type, antal deltagere, egen placering). Opret (åbner opret-skærm), Join med kode, Arkivér/Gendan (kun afsluttede/arkiverede) og Slet (opretteren, på alle egne ligaer). Klik på et kort → Stilling.
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
Adgang: enten en admin-brugers login-token (bruges automatisk af "Hent resultater nu"), eller den delte `SYNC_SECRET`. Hemmeligheden sendes helst i headeren `x-sync-secret` (så den ikke havner i request-logs); `&secret=<SYNC_SECRET>` i query-strengen virker fortsat som fallback. Flyt gerne cron-job.org-jobbet til headeren.
Automatisk kørsel: cron-job.org kalder linket hvert 10.-15. minut (Vercels gratis cron er kun 1×/døgn, for sjældent). Ét cron-job pr. liga.
---
9. Miljøvariabler
Variabel	Formål
`SPORTMONKS_TOKEN`	API-nøgle til Sportmonks
`SUPABASE_URL`	Supabase-projektets URL
`SUPABASE_SERVICE_ROLE_KEY`	Server-side Supabase-nøgle (aldrig i frontend)
`SYNC_SECRET`	Autoriserer eksterne cron-kald til serverfunktionerne
`VAPID_PUBLIC_KEY`	Web Push: offentlig VAPID-nøgle (generér med `npx web-push generate-vapid-keys`)
`VAPID_PRIVATE_KEY`	Web Push: privat VAPID-nøgle (aldrig i frontend eller git)
`VAPID_SUBJECT`	Valgfri `mailto:`-kontaktadresse, som sendes til push-tjenesterne
Disse bruges kun af serverfunktionerne (`api/sync-matches.js` og `api/send-notifications.js`). Frontenden bruger som udgangspunkt en hårdkodet offentlig `SUPABASE_URL` + `publishable`-nøgle (i `src/lib/supabase.js`), men kan pege på en anden database via to valgfrie byggetids-variabler:
`VITE_SUPABASE_URL`	Frontend: overstyr Supabase-URL (fx staging). Udeladt = produktion
`VITE_SUPABASE_KEY`	Frontend: overstyr publishable-nøgle. Udeladt = produktion
Staging-database (anbefalet opsætning): opret et Supabase-projekt nr. 2, kør alle scripts fra `sql/` (+ det oprindelige skema-/rating-script) dérinde, og sæt `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY` i Vercel KUN for Preview-miljøet (Settings → Environment Variables → Preview). Sæt tilsvarende `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` for Preview, så også serverfunktionen rammer staging. Lokalt: kopiér `.env.example` til `.env.local`.
VIGTIGT: Uden disse variabler peger ALLE miljøer på SAMME Supabase-projekt — også Vercels preview-URL pr. branch. Data (resultater, gæt, konkurrencer) deles i så fald mellem preview og produktion: test UI/navigation frit på en preview, men undgå at taste rigtige resultater ind dér, da de rammer alle brugere.
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
`npm test` — kør testsuiten (Vitest)
Deploy: Vercel auto-deployer ved hver commit til `main`. Hver branch får desuden automatisk en preview-URL, så nye ting kan testes side om side med den live app (husk afsnit 9: samme database, medmindre Preview-miljøet peger på staging).
Arbejdsgang: udvikl på en feature-branch → åbn en pull request → merge til `main`. `main` = det, alle brugere ser. `node_modules/` og `dist/` er git-ignoreret.
Test: Vitest-suiten (`src/lib/*.test.js`) dækker den rene logik — pointberegning, runde-gruppering, runde-baseret låsning samt stillings-loaderne (med mocket database). UI og dataflow verificeres stadig manuelt (byg + klik igennem på preview). PWA-cache kan holde på en gammel version — et hard-refresh (eller geninstallation af hjemmeskærms-genvejen) tvinger den nye frem.

Tjekliste før merge
Fast tjekliste inden en branch merges til `main` (test på preview-URL, både mobil og desktop). Oprindeligt QA-listen fra migrationen til 4-fane-fladen; bevaret her som permanent regressions-tjek, da alle punkter fortsat er kernefunktioner:
- [ ] Alle konkurrencetyper kan oprettes, tilgås og arkiveres.
- [ ] Invite-links virker og lander det rigtige sted i navigationen.
- [ ] UserRoundPredictions-visningen virker fra både liga- og Championship-stillinger, og viser kun runder hvor alle kampe har resultat.
- [ ] Rullende gætte-vindue (`openDaysBefore`) opfører sig som forventet.
- [ ] Rating auto-genberegnes ved gemte resultater; admin-knappen "Opdater ratings" virker fortsat.
- [ ] Hjem-fanens deadline-kort viser korrekt antal manglende tips og skifter korrekt til grøn, når alt er tippet.
- [ ] Månedsvælgeren viser korrekte historiske måneder og kårer rigtig månedsvinder.
- [ ] PWA-installation og ikoner virker uændret.
- [ ] Admin kan stadig oprette/rette kampe og resultater.
- [ ] Ingen døde links eller efterladte referencer til fjernede skærme/kort.
---
12. Kendte begrænsninger
Superliga Playoff kan ikke synkroniseres endnu — Sportmonks har ikke oprettet 2026/27-sæsonen for den del (formentlig til foråret). Den er skjult for almindelige brugere (`is_visible = false`) men tilgængelig for admin under Kampe/Resultater.
Alle kan oprette konti uden godkendelse — fint til en lukket venneflok.
Push-notifikationer kræver opt-in pr. enhed (afsnit 16); der er ingen e-mail-påmindelser. På iOS virker push kun, når appen er føjet til hjemmeskærmen (iOS 16.4+).
Koden er opdelt i moduler (afsnit 1). Den enkelte fil er nu overskuelig (største ~240 linjer); ved yderligere vækst kan `data.js` og de største skærme deles videre op.
Rating-genberegningen er stadig en fuld genberegning fra bunden, men kører nu kun når et resultat reelt ændres (afsnit 5). Ved mange tusinde brugere bør selve beregningen laves inkrementel eller optimeres (sortér + histogram i stedet for alle-mod-alle).
Det oprindelige skema-/rating-SQL ligger ikke i repoet (kun i Supabase). Indsæt det i `sql/`-mappen, så hele databasen kan genskabes fra git — nødvendigt bl.a. for at opsætte staging.
Preview og produktion deler database, medmindre staging-variablerne er sat (afsnit 9) — selve staging-projektet skal oprettes manuelt i Supabase.
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

Juli 2026 — Dokumentation-oprydning + produktdokumenter
Den gennemførte migrationsplan (4-fane-fladen) er slettet; dens QA-tjekliste er bevaret som permanent "Tjekliste før merge" i afsnit 11. Nye produktdokumenter tilføjet under `docs/`: `docs/PRODUCT_BOOK.md` (produktfilosofi), `docs/ROADMAP.md` (status, prioritering, beslutningslog) og `docs/features/` (feature-specs, fx `story-engine-v1.md`). `CLAUDE.md` omskrevet: `DOCUMENTATION.md` er den tekniske sandhed; produktbeslutninger/nye features læser `docs/`-dokumenterne, og `docs/ROADMAP.md` opdateres, hver gang en feature leveres eller en beslutning træffes.

Juli 2026 — Push-notifikationer
Web Push med to beskedtyper: deadline-påmindelse (runder der mangler tips og låser snart — runde-baseret, som låsereglen) og runde-resultat (point + placering fra `round_standings`-viewet; vinderen kåres som Rundens Prediction Champ). Opt-in-kort på Hjem, service worker uden cache, nye tabeller `push_subscriptions` + `notification_log` (`sql/push_notifications.sql`), ny serverfunktion `api/send-notifications.js` (VAPID/web-push, dryRun, dedup, oprydning af døde abonnementer) og nyt cron-job. Se afsnit 16.

Juli 2026 — Teknisk gæld: DB-views, staging-mulighed, testsuite, smartere rating-trigger
Fire skaleringsforbedringer uden ændring i, hvad brugerne ser:
- Runde- og sæsonstilling beregnes nu i DB-views (`round_standings`/`season_standings`, `sql/standings_views.sql`) i stedet for i browseren — før hentede klienten ALLE sæsonens forudsigelser (`loadRoundBoard`/`loadSeasonBoard` i `data.js` læser nu views).
- Frontendens Supabase-config kan overstyres med `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY` (+ `.env.example`), så Vercels Preview-miljø kan pege på en staging-database (afsnit 9).
- Ny Vitest-testsuite (`npm test`): pointberegning, runde-gruppering, runde-baseret låsning og stillings-loaders med mocket database. Ubrugt import fjernet fra `scoring.js`.
- Rating-triggeren genberegner kun, når et resultat reelt ændres (`sql/rating_trigger_optimization.sql`) — før kørte fuld Elo-genberegning ved hvert cron-sync, ca. 100 gange i døgnet. Kør SQL'en i Supabase-editoren; kør også `sql/standings_views.sql` FØR denne ændring merges til main.

Juli 2026 — Runde-baseret åbningsvindue (openDaysBefore)
Opfølgning på runde-låsen: det rullende gætte-vindue (`rules.openDaysBefore`) regnes nu fra rundens *tidligste* kickoff i stedet for kampens eget. Uden dette kunne en kamp med et lille vindue åbne EFTER rundelåsen og aldrig blive tippbar (blindgyde "Åbner…" → "Låst"). Nu åbner hele runden samlet `openDaysBefore` dage før første kamp og låser 1 time før samme — vinduet er ens for alle kampe i runden. Ændret i `opensAt` i `src/screens/PredictionsScreen.jsx` og `src/lib/data.js` (begge slår rundens tidligste kickoff op via samme `roundLockKey`/lock-map som låsningen). Kun frontend — `openDaysBefore` har ingen RLS-håndhævelse. Brugertekst opdateret i HowItWorksScreen og CreateCompetitionScreen.

Juli 2026 — Runde-baseret lås (låser 1 time før rundens første kamp)
Før låste hver kamp individuelt 1 time før sit eget kickoff, så man i en runde med kampe spredt over ugen kunne se tidlige resultater (og andres nu-afslørede gæt) og justere sine egne senere gæt. Nu låser ALLE kampe i en runde samtidig — 1 time før rundens *tidligste* kickoff — så alle tipper på samme grundlag. En runde scopes på `(season_id, round_key)`. Frontend: ny `buildRoundLockMap(matches)` + `roundLockKey(m)` i `src/lib/scoring.js`; `isLocked(match, roundLockMap)` slår rundens tidligste kickoff op (falder tilbage til per-kamp hvis intet map gives). Kaldere bygger mappet fra hele kamplisten: `PredictionsScreen.jsx` (lås, "Låser om…"-nedtælling og "Alles gæt"-afsløring bliver alle runde-niveau) og `computeHomeTips` i `data.js` (Hjem-deadline). Database: ny idempotent `sql/predictions_round_lock_policies.sql` (afløser `predictions_delete_policy.sql`) med både DELETE- og SELECT-policy på runde-reglen — `nu >= min(kickoff) − 1t` udtrykt null-sikkert som "der findes en kamp i runden med `kickoff_at <= now() + 1 time`". Kør SQL'en i Supabase-editoren ("Run without RLS"); husk at droppe den gamle SELECT-policy ved dens navn og at auditere evt. INSERT/UPDATE-policy (se noter i scriptet).

Juli 2026 — Hjem: live runde-oversigt + farvet tips-status + slet egne ligaer altid
Hjem-fanens deadline-kort viser nu tips-status for næste runde med farvekode: mangler man tips, er kortet rødt (samme layout som før — nedtælling, runde, manglende kampe, "Tip nu"); er alt tippet, er kortet grønt med beskeden "Alt ok — alle tips er inde". (Før var "mangler"-kortet grønt og "alt inde"-kortet neutralt.) "Næste runde" er den tidligste runde man stadig kan tippe (`computeHomeTips`); kortet viser KUN den runde — er den fuldt tippet, er den grøn, også selvom en senere runde mangler tips (den bliver "næste runde" i tur). (Rettet efterfølgende: helperen valgte før den tidligste utippede kamp på tværs af alle runder, så en runde langt ude fejlagtigt kunne vise rødt, selvom de nærmeste runder var tippet.) Nyt kort: en live-oversigt over indeværende runde (den runde der spilles nu, eller nærmeste kommende via `currentRoundIndex`), samlet på tværs af brugerens konkurrencer. Pr. kamp vises hjemme–ude, brugerens eget tip og enten kickoff-tid (kommende), "I gang" (kickoff passeret uden resultat) eller resultat + point-pille (+3 grøn / +1 guld / 0 dæmpet). Øverst: brugerens samlede point i runden + X/Y spillet. Kortet genindlæser hvert minut (`computeCurrentRound` i `data.js`), så resultater og point opdaterer løbende efterhånden som kampene spilles (results tikker ind via sync). Klik på kortet åbner Tip landet på runden. Desuden: "Slet"-knappen på Ligaer-fanen vises nu for opretteren på alle egne ligaer (før kun på afsluttede/arkiverede). Arkivér/Gendan er uændret (kun afsluttede/arkiverede). Sletning bruger fortsat `db.del` på `competitions` (RLS: kun opretter).

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
15. Brugerstatistik & aktivitets-sporing
Admin-skærmen har en "Statistik"-underfane (kun admins) med overblik over brugerne. Al SQL ligger i `sql/user_stats.sql` (idempotent, køres i Supabase SQL-editor med "Run without RLS" — jf. afsnit 13).

Aktivitets-sporing
Der fandtes ingen aktivitets-historik i forvejen (sessioner ligger i `localStorage`, token fornys i baggrunden → `auth.users.last_sign_in_at` er upålidelig). I stedet registrerer appen selv aktivitet: ved app-start kaldes `touch_activity()` (`security definer`), som sætter `profiles.last_seen_at = now()` og upserter dagens række i `user_activity_days` (én pr. bruger pr. dag → besøgsfrekvens uden ubegrænset vækst). Frontenden kalder det via `touchActivity(token)` (`data.js`) fra `App.jsx`'s `completeAuth`, throttlet til maks. 1×/time (`localStorage`-nøgle `pc_last_ping`), best-effort så det aldrig blokerer appen. Aktivitetstal begynder derfor først at samle sig fra funktionen blev taget i brug.

Nøgletal
Hentes i ét kald via `admin_user_stats()` (`security definer` med `is_admin`-guard → `jsonb`, så den offentlige RLS-nøgle ikke eksponerer rådata). Frontend-helper: `loadUserStats(token)`; visning i `StatsPanel` (AdminScreen). Målte størrelser: total & nye (7/30 dage) fra `created_at`; aktive DAU/WAU/MAU + fastholdelse (DAU/MAU) og gns. aktive dage fra `user_activity_days`; engagement (har tippet, gns. tips/bruger, med i privat liga) fra `predictions`/`competition_participants`; konkurrencer (antal private ligaer + fordeling pr. `mode` med procent — kun brugeroprettede, ikke de virtuelle) fra `competitions`; frafald (aldrig tippet, inaktive 30+ dage); samt to søjlekurver (tilmeldinger/uge, aktive/dag). Total/nye dækker også eksisterende brugere, da `created_at` er backfillet fra `auth.users`.

Rettigheder: `user_activity_days` har RLS slået til uden policies (kun tilgængelig via de to `security definer`-funktioner). Begge funktioner er `grant execute ... to authenticated`; kun `admin_user_stats()` er admin-gated internt.
---
16. Push-notifikationer (`api/send-notifications.js`)
Web Push til brugere, der har slået notifikationer til. To slags beskeder:
- Deadline-påmindelse: runder der mangler brugerens tips og låser inden for de næste timer (standard 3, styres med `&hours=`). Runde-baseret som låsereglen (afsnit 2): en runde — samme `(season_id, round_key)` — låser 1 time før sin tidligste kickoff. Maks. én påmindelse pr. runde pr. dag pr. bruger.
- Runde-resultat: når ALLE kampe i en runde har fået resultat — rundens point + placering fra `round_standings`-viewet (samme kilde som Championship-fanen, så tallene altid matcher); vinderen får en "Rundens Prediction Champ"-besked.
Tilmelding: opt-in-kort på Hjem-fanen (kan skjules; vises ikke igen når man er tilmeldt eller har sagt nej i browseren). Frontend-helpers i `src/lib/push.js`, service worker i `public/sw.js` (bevidst UDEN fetch-handler — den cacher intet, så PWA'en aldrig hænger fast i en gammel version). På iOS kræver Web Push, at appen først er føjet til hjemmeskærmen (iOS 16.4+); kortet forklarer det selv. Ved log ud afmeldes enhedens abonnement, så en delt enhed ikke får den forrige brugers beskeder.
Data: `push_subscriptions` (abonnementer) + `notification_log` (dedup). Begge oprettes af det idempotente script `sql/push_notifications.sql` (kør med "Run without RLS", jf. afsnit 13).
Udsendelse: `web-push`-pakken (VAPID). Frontendens tilmelding henter den offentlige nøgle via `/api/send-notifications?action=vapidKey` (offentligt), så nøglen kun findes i Vercels miljøvariabler. Døde abonnementer (HTTP 404/410 fra push-tjenesten) slettes automatisk.
Kaldes med: `/api/send-notifications` med `SYNC_SECRET` i headeren `x-sync-secret` (foretrukket) eller `?secret=<SYNC_SECRET>` (fallback)
Test uden at sende noget: tilføj `&dryRun=true` (viser hvad der VILLE blive sendt)
Adgang: som sync-funktionen (admin-token eller `SYNC_SECRET` via header/query).
Automatisk kørsel: ét ekstra cron-job.org-job, der kalder linket hvert 15.-30. minut (dækker alle ligaer på én gang).
Engangsopsætning: 1) kør `sql/push_notifications.sql` i Supabase, 2) generér nøgler med `npx web-push generate-vapid-keys`, 3) sæt `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (og evt. `VAPID_SUBJECT`) i Vercel, 4) opret cron-jobbet.
---
Bed Claude om at opdatere denne fil, når der sker større ændringer.
