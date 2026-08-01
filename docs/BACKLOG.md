# Backlog — det ubyggede

Alt, der er identificeret men ikke leveret: åbne beslutninger, ubyggede
opgaver, teknisk gæld og rå ideer. Ét sted at kigge, når man vil vide, hvad der
mangler.

Oprettet 31. juli 2026. Det ubyggede lå indtil da spredt over syv steder —
ROADMAP'ens åbne beslutninger, dens prioriterede rækkefølge (hvor 6 af 7 rækker
var leverede), `DOCUMENTATION.md` §12, to feature-specs og "Bevidst ikke med i
v1" i alle syv — og rå ideer havde slet intet hjem. Spredningen drev allerede:
§12 beskrev stadig en fil-opdeling, der var leveret, og pegede på en beslutning,
der var lukket. Samme udskillelse som `CHANGELOG.md` og `DECISIONS.md` fik den
30. juli, bare den anden vej: de er de sektioner, der kun vokser bagud, og denne
er den ene, der kun peger fremad.

**Leveret hører ikke til her.** Når et punkt lukkes, **slettes rækken** —
arkivet findes allerede: beslutninger i [`DECISIONS.md`](./DECISIONS.md),
leverancer i [`CHANGELOG.md`](./CHANGELOG.md), status i
[`ROADMAP.md`](./ROADMAP.md). Netop derfor må der slettes: listen skal kunne
skimmes på et halvt minut, og intet går tabt. Undtagelsen er forkastede ideer,
som ikke arkiveres andre steder — de får en linje nederst, så den samme idé ikke
foreslås tre gange.

**ID'erne er stabile og genbruges ikke.** `A#` fortsætter beslutningsserien fra
ROADMAP (næste ledige: **A21**) — `A11` er fx også navnet på en logadvarsel i
`api/_shared.js`. `B#` ubygget · `G#` teknisk gæld · `I#` ideer. Spec-lokale
ID'er (`K2`, `F1`) beholder deres eget navn og linker til spec'en.

---

## 📥 Indbakke

Skriv én linje. Intet ID, ingen begrundelse, ingen formatering — det er hele
pointen. Ryddes ved næste session: hvert punkt får et ID og en række nedenfor,
eller en linje i "Forkastede ideer".

- `mode_params.tournaments` har aldrig været skrevet i produktion (nul rækker, 31. juli 2026) — multi-turnerings-stien er kun dækket af unit-tests, både ved oprettelsen og i `coversSeason` i `api/backfill.js`. Ufarlig indtil den første multi-turneringskonkurrence oprettes; dét er tidspunktet at kigge efter

---

## Åbne beslutninger

Spørgsmål, der er identificeret, men bevidst ikke afgjort endnu. Når en
beslutning træffes, flyttes den til [`DECISIONS.md`](./DECISIONS.md) med dato og
begrundelse, og rækken her slettes. `Afgøres` er en **udløser**, ikke en dato.

| # | Spørgsmål | Kontekst | Afgøres |
|---|---|---|---|
| A5 | **Emojis i historie-kort: til eller fra?** | Gør kortet skimbart på mobil, men mindre klassisk. **v1-default: emojis til.** **Delvist besvaret (v1.1, juli 2026):** emoji er nu et *signal* — den findes kun i højdepunkt-tieret, mens dæmpede kort er uden. Spørgsmålet er dermed reduceret til, om højdepunkterne skal beholde deres. **Datamanglen er lukket (30. juli 2026):** Analytics-fanens sektion "Story Engine-regler" viser genereret/vist/delt/afvist pr. regel, så spørgsmålet kan afgøres på tal frem for fornemmelse. **Sidste forudsætning er væk (31. juli 2026):** `story_engine.sql` er gen-kørt i produktion (den tidligere `B3`), så v1.1's 14 regler genererer nu rigtige kort. Uret på "et par runder" starter her. | Når et par runder er kørt med den nye regelstatistik i hånden. |
| A11 | **`?secret=`-fallbacken fjernes helt** (hænger sammen med teknisk gæld) | Kan først lukkes, når alle cron-jobs (ét sync-job pr. turnering + notifikations-jobbet) er bekræftet flyttet til `x-sync-secret`-headeren — ellers fejler de med 401. **Vejen er banet (30. juli 2026):** `isAuthorized()` i `api/_shared.js` logger en `[A11]`-advarsel, hver gang fallbacken bruges, så bekræftelsen kan *aflæses* i Vercels logs frem for gættes. Fremgangsmåden står i [`CRON.md`](./CRON.md). | Når loggene har været rene i en periode, der dækker alle skemaer (det langsomste er `sync-matches` hver 6. time) — senest sammen med turnering #2. |
| A14 | **Skal hele kodebasen gennemformateres med Prettier?** | `npm run format` findes, men `format:check` er bevidst ikke et CI-trin. En fuld gennemformatering ville omskrive ~6.700 linjer ved `printWidth: 140` (~14.000 ved standard 80) på tværs af alle 46 filer. Prisen er hele repoets `git blame`; gevinsten er konsistens i en kodebase med én forfatter og en i forvejen ensartet håndstil. Beslutningen er **udskudt, ikke truffet** — se [`DECISIONS.md`](./DECISIONS.md), 30. juli 2026. | Næste gang der alligevel røres bredt i frontenden — ellers aldrig. |
| A15 | **Sportmonks gratis-plan: 180 kald/time pr. entitet, eller 3.000 API-kald — hvilket tal og hvilken enhed gælder?** | `DOCUMENTATION.md` §8 (linje 240) og `features/live-resultater-v1.md` angiver begge "180 kald i timen pr. entitet", men Sportmonks' egen kontoside viser "3.000 API-kald" — uklart om det er en anden periode/enhed eller en reel uoverensstemmelse mellem dokumentation og aftale. Forbruget i dag (`sync-live` maks. 60/time på kampdage, `sync-matches` ~4 pr. kørsel pr. turnering) ligger komfortabelt under begge tal, så det er ikke driftskritisk endnu. | Når nogen har efterprøvet Sportmonks' faktiske plan-vilkår (support eller deres egen dokumentation) og kan rette det tal, der viser sig forkert. | **Uændret af de fem nye turneringer (31. juli 2026):** de kommer fra football-data.org, hvis loft er entydigt (10 kald/minut, en rate limit uden månedspulje), så de lægger nul til Sportmonks-forbruget. Spørgsmålet er stadig åbent for Superligaen og Scotland Premiership.
| A16 | **Lås på tværs af to ligaer i samme konkurrence: burde runden låse samlet én time før første kamp i konkurrencen, i stedet for pr. liga?** | Låsen er i dag scopet på `(season_id, round_key)` (`DOCUMENTATION.md` §7, linje 191/200): har en konkurrence to turneringer, der låser på forskellige tidspunkter i samme viste runde, får hver kamp sin egen deadline, og "alles gæt" bliver synligt kamp for kamp i stedet for for hele runden samlet. Hænger sammen med `B1` (global runde), men er snævrere: spørgsmålet er specifikt om tips-synlighed på tværs af ligaer i én konkurrence, ikke rundedefinitionen generelt. | Bliver relevant, når `B2` (Scotland Premiership) er i drift, og en konkurrence rent faktisk blander to turneringer i samme runde. |

## Ubygget

| # | Hvad | Hvorfor / hvad den venter på | Omfang |
|---|---|---|---|
| B2 | **Turnering #2: sæt Scotland Premiership i drift** | **Koden er leveret 31. juli 2026**, og to af drifts-trinnene er nu taget: SQL-scriptet er kørt, og cron-jobbet er oprettet (job #5 i [`CRON.md`](./CRON.md)). **Tilbage:** bekræft at første sync faktisk hentede kampe (Admin → Drift viser `sync-matches`-kørslerne), **kontrollér holdene for dubletter** — den fuzzy holdmatch er ikke afprøvet på skotske navne — verificér fasenavnene mod `STAGE_LABELS` (§4 i drejebogen forudsiger `2nd Phase` → "Slutspil"), og kør testcases 2–6 i [`features/turnering-2.md`](./features/turnering-2.md) §6. Turneringen er **synlig** (fravigelse af `A10`). Gater `B1`. | Lille (drift) |
| B8 | **Champions League henter ingen kampe** | De fire andre football-data-turneringer kom i drift 31. juli 2026; CL gjorde ikke. Mest sandsynlige årsag: sæsonen 2026/2027 er endnu ikke udgivet hos football-data.org, så `/competitions/CL/matches?season=2026` svarer tomt eller 404 — turneringen begynder først i september, og lodtrækningen til ligafasen er ikke foretaget. **Det er ikke sikkert, det er en fejl**, men det er ikke verificeret, og forskellen betyder noget: en tom sæson retter sig selv, en forkert `api_season_id` gør ikke. Cron-jobbet er oprettet (job 7, minut 17), så den første planlagte kørsel lander af sig selv i `job_runs` — aflæs den i Admin → Drift — `totalFixtures: 0` med status 200 er den ufarlige udgave, en 404/`Kunne ikke udlede et sæsonår` er den anden. Turneringen er allerede synlig og officiel, hvilket er ufarligt, så længe den ingen kampe har | Ét opslag, evt. én `update seasons set api_season_id = …` |
| B1 | **Global tirsdag–mandag-runde** | Produktbogens kapitel 4–5 beskriver den som gældende; appen regner i dag pr. turneringsrunde, hvilket med Superligaen alene reelt er det samme. Udskydes bevidst, til flere turneringer er i drift — først dér adskiller den sig. Står som trin 5 i [`ROADMAP.md`](./ROADMAP.md) og som kendt afvigelse mellem bog og app. | Mellem |
| B4 | **Privatlivspolitik og brugervilkår** | Kræves før en offentlig lancering/deling af appen; ingen af delene findes i dag. Hvad de derudover skal dække (cookies, tredjeparts-tjenester som Sportmonks/Supabase, evt. databehandleraftaler) er ikke afklaret og bør afklares som en del af opgaven. | Mellem |
| B5 | **Notifikation til ligamedlemmer, når der oprettes en ny konkurrence i deres liga** | Medlemmer opdager i dag kun en ny konkurrence ved selv at åbne ligaen. Naturlig udvidelse af push-notifikationerne (§16, `api/send-notifications.js`), som allerede har mønsteret for målrettede notifikationer. | Lille–mellem |
| B6 | **Fjern default-navn ved oprettelse af en konkurrence** | `CreateCompetitionScreen.jsx` foreslår i dag et navn, som de fleste nok bare beholder frem for at sætte noget mere sigende. Lille, isoleret UI-rettelse. | Lille |
| B9 | **Notifikation når en ny turnering bliver tilgængelig** | Naturlig udvidelse af push-notifikationerne (§16, `api/send-notifications.js`), som allerede har mønsteret for målrettede notifikationer — samme skuffe som `B5`, men trigger er en ny turnering frem for en ny konkurrence. | Lille–mellem |

## Teknisk gæld

| # | Gæld | Hvorfor den betyder noget | Omfang |
|---|---|---|---|
| G1 | **De resterende store skærmfiler** — `MainApp.jsx` ~480 linjer, `HjemTab.jsx` ~450, `CreateCompetitionScreen.jsx` ~420, `AdminScreen.jsx` ~310. | Anden halvdel af fil-opdelingen fra 30. juli 2026 (`data.js`, `PredictionsScreen.jsx` og `AnalyticsPanel.jsx` er delt). Mønstret er bevist: barrel eller ren flytning bag uændret flade, så et grønt build er beviset for, at ingen eksport er tabt. Gevinsten er ikke kosmetisk — tip-skærmens tids-logik kunne ikke testes, før den blev flyttet ud, og har nu 18 tests. | Mellem |
| G2 | **26 ESLint-advarsler fra React Compiler** (`static-components`, `set-state-in-effect`, `purity`, `immutability`). | Står som advarsel frem for fejl, fordi hvert fund kræver en gennemtænkt omskrivning, ikke en rettelse. Loftet i `package.json` (`--max-warnings 26`) gør, at tallet kan falde, men aldrig vokse ubemærket — gælden er synlig i stedet for tavs. **Falder tallet, sænkes loftet i samme ombæring.** | Mellem |
| G3 | **Frontenden læser stadig `rules`-feltet.** | `rules` er historisk: `pc_points()` hardkoder 3/1 og ignorerer det, og alle opgørelser er altid 3-1-0 (F2, juli 2026). Læsningen er død kode, der antyder en konfigurerbarhed, som ikke findes. Noteret som "separat oprydning" i [`features/karriereprofil-v1.md`](./features/karriereprofil-v1.md) §7 og aldrig planlagt siden. | Lille |
| G4 | **Preview og produktion deler database**, medmindre staging-variablerne er sat (`DOCUMENTATION.md` §9). | Selve staging-projektet skal oprettes manuelt i Supabase; indtil det sker, kan en preview-deploy skrive i produktionsdata. Vilkåret er dokumenteret, men det er en risiko, ikke en beslutning. | Lille |
| G5 | **`sql/rating_core.sql`s hoved advarer mod noget, filen ikke gør.** Kommentaren siger, at funktionskroppene indeholder CRLF og "MED VILJE" ikke må normaliseres (linje 26-30) — filen har i dag nul CR-tegn. | Enten er advarslen forældet (kroppene blev normaliseret ubemærket, uden at kommentaren blev rettet), eller også ligger CRLF kun i `prosrc` i selve databasen og forsvinder ved eksport/checkout — i så fald er advarslen korrekt for produktion, men vildledende for enhver, der læser filen i repoet. Skal afklares mod en frisk `sql/schema.sql`-eksport, før nogen stoler på hverken advarslen eller fraværet af den. | Lille |
| G6 | **`docs/CRON.md` modsiger sig selv om kadencen.** Jobtabellen (job 1, 5-10) siger "hver 12. time", mens overvågningstabellen, `job-heartbeat.yml` og `JOBS` i `src/lib/ops.js` alle siger "hver 6. time" med alarm efter 14 timer. | Alarmgrænsen er strammere end det skema, den skal overvåge — og de fem nye football-data-jobs er også lagt ind som 12-timers, så samme fejl er nu gentaget seks steder. Uden rettelse er det uklart, om jobtabellen eller overvågningen lyver, når driftsloggen skal læses. | Lille |
| G7 | **Ingen unique-constraint på `teams.api_team_id`, `seasons.api_season_id` eller `leagues.api_league_id`.** | Med to leverandører (Sportmonks og football-data.org, `A18`) er det i dag id-præfikset (`fd:`) alene, der holder deres id-rum fra hinanden — ikke databasen. En fremtidig fejl i sync-koden, der glemmer præfikset, ville kunne skrive et kollideret id uden at Postgres protesterer. | Lille |

## Ideer

Ikke besluttet, ikke prioriteret — noteret, så de ikke skal opdages forfra. En
idé bliver til en `B`- eller `A`-række, når den er værd at tage stilling til.

| # | Idé | Hvorfor den er værd at overveje | Status |
|---|---|---|---|
| I1 | **Eksport-knap i Analytics ("kopiér som CSV/JSON")** | [`features/analytics-v1.md`](./features/analytics-v1.md) siger, at SQL-editoren *er* eksport-mekanismen. Det passer for ad hoc-analyse, men ikke for "send tallene videre" — og en knap koster ingen ny afhængighed. | Ny |
| I2 | **Diagnose-historik** | Liga-diagnosen er et øjebliksbillede. Uden historik kan man ikke se, at en liga gik fra "Sund" til "Kun en del tipper" for tre uger siden. Kræver et sted at gemme snapshottet — første gang noget i Analytics ville have brug for et cron eller en tidsserie-tabel, hvilket arkitekturvalg #3 i spec'en lukkede døren for. | Afventer behov |
| I3 | **Alarm ved tilstandsskifte i en liga** | Naturlig følge af `I2`: en liga, der skifter til rød, er interessant i det øjeblik det sker, ikke næste gang nogen åbner admin. | Afhænger af `I2` |
| I4 | **Gentænk "Opret en liga" og "Deltag med kode" på Ligaer-fanen** — de fylder for meget | `LigaerTab.jsx` (linje 191–210) rendrer to permanente fuldbredde-kort øverst, uden nogen betingelse: de vises ens, uanset om man har nul ligaer eller ti, og den første `GroupCard` kommer først derefter. Til sammenligning er "Ny konkurrence"-knappen lige ovenfor gated på `groups.length > 0`. **To ting gør den værd at tage alvorligt:** (1) den spejlvendte fejl er allerede rettet én gang i samme fil — kommentaren dér forklarer, at "Ny konkurrence" lå skjult for præcis de brugere, der havde brug for den; her vises to felter permanent til præcis dem, der ikke har; (2) Onboarding v1 og `GetStartedCard` er bygget til netop "jeg har ingen liga endnu", så kortene duplikerer en opgave, der har fået sin egen løsning. Mulige veje: vis dem kun ved nul ligaer · fold begge sammen bag én knap · flyt dem til liga-siden. | Ny |
| I5 | **Del-mulighed for highlights** (Rundevinder, Ratingrekord, Ny rival, Månedsmester, Sæsonvinder m.fl.) | Naturlig forlængelse af Story Engine (§17): kortene findes allerede, men kan i dag ikke deles ud af appen. | Ny |
| I6 | **Ambassadørprogram ved oprettelse af ligaer/konkurrencer** (evt. med synligt deltagerantal) | Vækstkanal, der bygger på strukturen, der allerede findes (ligaer/konkurrencer), men ingen mekanik eller incitament er designet endnu. | Ny |
| I7 | **Finpuds invitationsflowet** | Invitationer er nøglen til nye brugere (delt konkurrence-/liga-link, §7), men er ikke selv blevet gennemgået som en samlet oplevelse. | Ny |
| I8 | **Professionel hjemmeside** (4–6 sider: forside, hvordan virker det, features, om os, kontakt, download app) | Giver troværdighed, kan deles og vises til virksomheder/brugere, og gør produktet indekserbart for Google. Ingen hjemmeside findes i dag ud over selve appen. | Ny |
| I9 | **SEO for hjemmesiden** | Afhænger af `I8` — der er ingen side at optimere, før den findes. | Afhænger af I8 |
| I10 | **Domæne og professionel e-mail** | Forudsætning for troværdighed udadtil (hjemmeside, invitationer, kontakt) — hænger sammen med `I8`. | Afhænger af I8 |
| I11 | **LinkedIn-side**, hvis der satses på indtægt via virksomheder | Betinget af en B2B-retning, der ikke er besluttet endnu. | Betinget af B2B-retning |
| I12 | **Offentlig side pr. liga** (fx `predictionhub.app/league/padel-legends`: antal sæsoner, medlemmer, mestre, statistik — ikke tips, kun historik) | Bygger videre på liga-laget (§18) som en delbar, offentlig facade for hver liga. Kræver stillingtagen til, hvad der må vises uden login. | Ny |
| I13 | **Runde- og månedsvinder kan kåres i en lokal konkurrence** — skal kunne tilvælges | I dag findes runde- og månedskåringer kun som de "virtuelle" konkurrencer på Championship-fanen, der summerer point på tværs af **officielle** turneringer. En liga, der kører sin egen konkurrence, kan ikke kåre en rundevinder internt. **Det, der skal tages stilling til, er navnene, ikke mekanikken:** stillingen findes allerede (`computeCompetitionState`), men A2's afløser gjorde "Prediction Champ" og "bedste i X" til to niveauer med hvert sit omfang, og et tredje niveau ville gøre ordet "månedsvinder" tvetydigt tredje gang. Navneregelen fra `features/turnering-2.md` §3.6 gælder: *"hvor to niveauer konkurrerer om samme navn"*. Tilvalget ("skal kunne tilvælges") løser ikke navnekollisionen — det gør den bare valgfri. **Det åbne designspørgsmål** (fra den parallelle gennemgang, `#89`): er det en ny *virtuel* visning pr. konkurrence, som rundeligaen er det globalt, eller en rigtig kåring, der gemmes et sted — og hvordan forholder den sig til de globale titler? | Ny |
| I14 | **Konkurrence-typer revurderet efter de syv turneringer** (foreslået som **Sæson**, **Favorithold** — kun udvalgte klubber på tværs af ligaer, **Weekly Mix** — automatisk ugentlig sammensætning, **Custom** — admin definerer periode/turneringer/hold/regler selv, **Quick League** — 8 tilfældige kampe, 6 runder frem, og **Quick Pick** — 8 tilfældige kampe, næste runde) | Forslaget kom, da produktet gik fra én turnering til syv, og opret-skærmen, der var designet til ét valg, stod med syv. **Gennemgangen 31. juli 2026 viste, at tre af de seks allerede findes:** Sæson = `full_season` (som siden juli kan spænde over flere turneringer via `mode_params.tournaments` — **leveret, men aldrig brugt i produktion**: opslaget 31. juli 2026 gav nul rækker med feltet, så "findes allerede" er sandt om koden og uafprøvet om virkeligheden), Custom = `custom` + `time_range`, Quick Pick = `random`. **To er parametre, ikke typer:** Quick League = `random` med et rundetal (`pickRandomMatchIds()` finder allerede `min(round_key)`), Favorithold = `team` med flere `team_ids`. Da `mode_params` er fri jsonb, kræver ingen af dem migrering eller en ændring af `competitions_mode_check`. **Den sjette er sin egen opgave** — se `I15`. Tilbage som reelt arbejde: **omdøbning** (`MODE_LABELS`/`MODE_HINTS` i `scoring.js` er den ene kilde til mode-navne; forslagets ordforråd er bedre end det interne) og **omorganisering** af opret-skærmen, så den spørger om varighed før turnering. To vilkår er værd at kende, før der prioriteres: nye typer ændrer **intet** i rating, rundeliga, månedsliga eller Championship (`_rs` i `rating_core.sql` rører aldrig `competition_matches`; `predictions` er én række pr. bruger pr. kamp), og "Custom: administratorer" modsiger, at alle medlemmer kan oprette konkurrencer. **`A20` er lukket 31. juli 2026** (efterfyldning bygget, fase-afgrænsning fjernet), så "Sæson" nu faktisk betyder hele sæsonen — omdøbningen kan dermed gennemføres uden at love noget forkert. Tilbage som gate: `A16` (lås på tværs). Brugen kan måles før noget bygges: `competition_created` bærer allerede `metadata.mode`. | Ny |
| I15 | **Weekly Mix** — en ugentlig, automatisk sammensat konkurrence | Udskilt fra `I14`, fordi den er den eneste af de seks, der kræver ny arkitektur, og fordi den ellers ville blive vejet som en tabelrække på linje med en omdøbning. Tre ting er ubesluttede: (1) **gentagelse** — enhver konkurrence skrives i dag af sin egen opretter, og RLS kræver `created_by = auth.uid()`, så et ugentligt job skal køre som `service_role`; (2) **"ugentlig"** — `round_key` *er* allerede tirsdag–mandag, så Weekly Mix ville enten være `B1` ad bagvejen eller produktets andet ugentlige tvær-turneringsbegreb ved siden af produktbogens globale spillerunde; (3) **"mest interessante kampe"** — der findes hverken odds eller tabelstilling i basen, så et automatisk udvalg bliver heuristik på klubnavne og turneringsvægt, hvilket støder på kap. 1's *"odds og avanceret analyse må aldrig overskygge det sociale formål"*. En håndkurateret "ugens kupon" leverer det meste af værdien og kræver kun (1). | Afhænger af `B1` |

## Forkastede ideer

Ideer, der er overvejet og fravalgt. Står her, fordi de ikke arkiveres andre
steder — og fordi en forkastet idé ellers bliver foreslået igen.

| Dato | Idé | Hvorfor ikke |
|---|---|---|

---

*Levende dokument. Fravalgt scope for allerede leverede features står i den
enkelte spec under "Bevidst ikke med i v1" — det er en historisk
scope-beslutning, ikke en to-do. Bliver et af de punkter en reel kandidat, får
det en `B`-række her.*
