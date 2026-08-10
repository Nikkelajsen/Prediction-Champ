# Feature: Turnering #2 (flere fodboldturneringer)

**Status: ✅ Leveret og verificeret i drift (2. august 2026)** — koden 31. juli, drift-trinnene i §3.1 samme dag, og de sidste verifikationspunkter aflæst/kørt 2. august (se §5 og næste-skridt-listen nederst). · *Filosofi: [`../PRODUCT_BOOK.md`](../PRODUCT_BOOK.md), kapitel 4 · Prioritering: [`../ROADMAP.md`](../ROADMAP.md), forudsætning for trin 5*

*Mere drejebog end klassisk spec: infrastrukturen til flere turneringer er allerede bygget. Dette dokument samler, hvad der er klar, og præcis hvad der mangler, før fx Premier League kan tændes.*

---

## 1. Begreber (vigtigt)

Jf. ordbogen i [`liga-laget-v1.md`](./liga-laget-v1.md) afsnit 2: en **turnering** er en fodboldliga fra en af datakilderne (`leagues`-tabellen — Superligaen, Premier League …). *(Rettet efter levering: siden `flere-datakilder-v1` er der to leverandører — Sportmonks **og** football-data.org; `leagues.provider` afgør hvilken.)* En **liga** er fællesskabet (`groups`) og er allerede leveret. "Flere ligaer" i daglig tale betyder her **flere turneringer**.

---

## 2. Hvad der allerede er klar (ingen ændringer nødvendige)

- **`leagues`/`seasons`/`teams` er generiske.** Intet i skemaet er bundet til Superligaen; `MainApp.jsx` indlæser alle synlige turneringer dynamisk, og hold auto-oprettes af syncen ud fra kampenes deltagere.
- **`full_season` på tværs af turneringer** (juli 2026): multivalg af turneringer ~~+ stages pr. turnering~~ (`mode_params.tournaments`), materialiseret i `competition_matches`. `custom`/`random` var allerede turnerings-løse med filter.
  **Rettet efter levering (31. juli 2026, `A20`):** fase-afgrænsning pr. turnering findes ikke længere — en sæson-konkurrence dækker hele sæsonen, og kampe, der skemalægges senere, efterfyldes af `api/_backfill.js`. `mode_params.tournaments` er nu `[{ league_id, season_id }]` uden `stages`. Feltet `mode_params.stages` består på gamle rækker som **mærkat**: findes det, efterfyldes konkurrencen aldrig. Se `DECISIONS.md`, 31. juli 2026.
- **Rundechampionship, månedschampionship og rating er turnerings-agnostiske by design:** `predictions` er én række pr. bruger pr. kamp, så hver kamp tælles én gang på tværs af alt.
- **`ratings.scope`** er forberedt til per-turnering-rating senere uden skemaændring (i dag altid `'ALL'`).
- **`loadSeasonBoard(token, leagueId)`** er fuldt parameteriseret — kun kalderen er hardkodet (se 3.2).
- **Tilføjelses-proceduren** står i DOCUMENTATION.md afsnit 10 (DB-rækker + sync-kald + cron-job).

---

## 3. Opgaver ved tilføjelse af turnering #2

### 3.1 Drift (ingen kode)

1. Indsæt række i `leagues` (`api_league_id`, `is_visible`) + sæson-række i `seasons` (jf. DOCUMENTATION.md afsnit 10). *(Rettet efter levering: kolonnelisten er siden vokset — `provider`, `live_enabled` og `is_official` kræves nu også, se afsnit 10 og `sql/multi_provider.sql`. Scotland-scriptet nedenfor er fra før dét og satte dem ikke; **rettet med `G65`, august 2026**, så det nu sætter alle fire eksplicit ved oprettelse og kun `provider` ved en gen-kørsel.)* **Turnering #2 er Scotland Premiership, `api_league_id = 501`** — se 3.4 for hele planens indhold. *(Tilføjet ved leveringen, 31. juli 2026:)* rækkerne findes som et idempotent script, [`sql/tournament_scotland_premiership.sql`](../../sql/tournament_scotland_premiership.sql) — **verificér sæsonnavnet i filens hoved først**. ~~*(Tilføjet 31. juli 2026 med A10:)* **sæt `is_visible = false`** første gang; generalprøven kræver, at turneringen findes i databasen, men ingen brugere skal se den endnu.~~ **Rettet ved leveringen samme dag: turneringen tændes med `is_visible = true` med det samme.** A10's `false` var en forsigtighedsregel; ejeren vurderede, at brugerskaren er lille nok, og at alle ved, der stadig testes. Generalprøven køres altså i åbent land. Den gamle formulering er streget over frem for slettet, fordi §3.4 og A10 fortsat siger `false` — så det fremgår, at noget blev ændret undervejs. Skal en anden turnering bruges, så verificér først, at den er i planen — `GET /v3/football/leagues?api_token=…` returnerer netop planens turneringer, og en turnering uden for den er ikke bare "ikke synlig": syncen fejler.
2. Kald `/api/sync-matches?leagueId=<uuid>` første gang (`&dryRun=true` først) — holdene oprettes automatisk. `leagueId` er **vores egen uuid** fra trin 1's verifikations-select, ikke Sportmonks' `501`. Scriptet sætter allerede `api_season_id`, så `&smSeason=` er unødvendig. **Kaldet skal autoriseres, og det kan en adresselinje ikke** — brug `curl -H "x-sync-secret: …"` eller devtools-konsollen med admin-tokenet; fremgangsmåden med begge kommandoer står i `DOCUMENTATION.md` §10. *(Tilføjet 31. juli 2026, efter at et browser-kald gav `{"error":"Ikke autoriseret"}`: guiden sagde "log ind som admin i samme browser", men sessionen ligger i `localStorage` og ikke i en cookie, så navigationen sender ingen header.)*
3. Opret ét nyt cron-job.org-job for turneringen, med `SYNC_SECRET` i `x-sync-secret`-headeren. *(Rettet efter levering, 5. august 2026 — `A11`: her stod "nye jobs skal ikke bruge `?secret=`-fallbacken". Fallbacken findes ikke længere, så headeren er ikke længere en anbefaling men det eneste, der virker.)* **Tilføj derefter jobbet i [`docs/CRON.md`](../CRON.md)** — registeret dér er kilden til, hvilke jobs der findes, og det er kun sandt, hvis det vedligeholdes. *(Tilføjet 30. juli 2026: registeret fandtes ikke, da denne spec blev skrevet.)*
4. Notifikations-jobbet dækker allerede alle turneringer i ét kald — intet nyt job dér.

### 3.2 Kode — ✅ leveret 31. juli 2026

*Tabellen er opdateret ved leveringen. To af de fire rækker var allerede lukket, før `B2` blev taget op — drejebogen var bagud med sig selv.*

| Sted | Ændring | Status |
|---|---|---|
| `src/screens/ChampionshipTab.jsx` | **Den eneste reelle hardkodning i UI'et:** Sæsonchampionship fandt turneringen via navne-regex `/superliga/i`. Erstattet af en turnerings-vælger (dropdown, samme mønster som runde-/månedsvælgeren) — `loadSeasonBoard` tog allerede `leagueId`. Én sæsonstilling pr. turnering; en samlet på tværs af turneringer er bevidst fravalgt (den rolle har månedschampionshippet/ratingen). | ✅ **Leveret.** Vælgeren vises først ved mere end én turnering. Forvalget er `pickSeasonLeague()`: brugerens eget valg (husket i `localStorage`), ellers den **ældste** turnering — `created_at` og ikke navn, fordi listen er navnesorteret, og alfabetet ellers ville sætte "Scotland Premiership" foran "Superligaen" |
| `src/lib/scoring.js` | `STAGE_LABELS` oversætter kun Superligaens stages til dansk (grundspil/mesterskabsspil/…). Tilføj den nye turnerings fasenavne; ukendte stages falder allerede pænt tilbage til råt navn. | ✅ **Leveret 31. juli 2026**, efter at navnene var aflæst hos Sportmonks — se §3.5. `1st Phase` → Grundspil, `2nd Phase` → Slutspil. Badge-reglen ser nu på det **danske** ord i stedet for at regex'e efter "regular season", så grundspillet skjules, uanset hvad turneringen kalder det på engelsk |
| `api/sync-matches.js` (linje ~63, ~122) | (a) Sæson-navn-fallbacken er hardkodet `"2026/2027"`. (b) Paginationen stopper hårdt ved side 20 — en stor turnering kan blive **stille trunkeret**. | ✅ **Var allerede lukket før `B2`.** (a) Fallbacken er væk: uden `smSeason` og uden gemt `api_season_id` fejler kaldet nu tydeligt. (b) Loftet er 60 sider, og en afbrudt paginering **kaster** i stedet for at bryde stille. *(Begge dele bor i dag i `api/_providers/sportmonks.js` — de citerede linjenumre i `sync-matches.js` peger på noget andet efter provider-udskillelsen.)* |
| `api/sync-matches.js` (holdmatch) | Holdopslag matcher på normaliserede navne (fuzzy). Verificér efter første sync, at den nye turnerings hold ikke er fejl-linket til eksisterende hold. | ✅ **Automatiseret (august 2026).** `teams` hentes med `league_id=eq.<liga>`, så den fuzzy match kun ser turneringens egne hold — fejl-link *på tværs af turneringer* kan ikke ske. Dubletter *inden for* turneringen meldes nu af `ambiguousTeamNames()` i hver kørsels resumé (`ambiguousTeams`, Admin → Drift) frem for at kræve et manuelt tjek på det rigtige tidspunkt |
| `src/lib/data/standings.js` | **Ikke forudset af drejebogen.** `loadRoundBoard`/`loadRoundsAvailable` læste *alle* kampe i en `round_key`, uanset turnering og uanset `is_visible`. Kampantallet afgør `isComplete` og dermed, om 🏆 og "er Rundens Champion" vises — en skjult turnering ville altså holde runden åben, indtil kampe, ingen kan se eller tippe, var spillet. | ✅ **Leveret.** Begge loadere filtrerer på sæsoner under de turneringer, stillingen gælder. *(Udvidet samme dag: prædikatet blev `is_official` frem for `is_visible`, da Championship fik to niveauer — se §3.6. Kampantallet følger dermed samme afgrænsning som pointene.)* |

### 3.3 Beslutninger, der udløses (fra roadmappens åbne beslutninger)

- ~~**A2 — ✅ Lukket (juli 2026):** Månedschampionshippet tæller **samlede point**, også med flere turneringer (rating dækker præcision via gennemsnit). Ingen kodeændring.~~
  **AFLØST 31. juli 2026, samme dag som turnering #2 kom i drift.** A2 blev truffet, før der fandtes to turneringer — altså om en situation, der ikke kunne afprøves. Da den blev virkelig, viste den sig at have en konsekvens, spørgsmålet ikke rummede: rundechampionship og månedschampionship måler ikke længere alle på de samme kampe, fordi hvad man tipper afgøres af, hvilke **frivillige** konkurrencer man er med i. De eneste konkurrencer, ingen selv har valgt, blev dermed afgjort af valg truffet andre steder.
  **Nyt svar — to niveauer:** `scope = 'ALL'` samler alle **officielle** turneringer og kårer *Rundens/Månedens Champion* (den store titel, som fortsat tæller samlede point og altså belønner bredde — nu som en udtalt regel); `scope = <league_id>` giver én stilling pr. turnering, hvor alle ér målt på de samme kampe, med kåringen *"Rundens/Månedens bedste i X"*. Ny kolonne `leagues.is_official` afgør, hvad der overhovedet fodrer Championship. Migrering: `sql/tournament_scope.sql`. Fuld begrundelse i [`../DECISIONS.md`](../DECISIONS.md).
- ~~**Trin 5 — global tirsdag–mandag-runde** bliver først reelt anderledes end turneringsrunder, når turnering #2 er i drift. Forbliver bevidst udskudt.~~
  **RETTET 1. august 2026.** Præmissen var forkert: der findes intet turneringsrunde-begreb i produktet, og `round_key()` har givet rundens tirsdag siden begyndelsen. Trin 5 var altså allerede leveret, da denne drejebog blev skrevet — og dét, drejebogen **selv** leverede (`scope = 'ALL'` i `sql/tournament_scope.sql`), var den sidste manglende brik. Tilbage stod kun gætte-vinduets scoping pr. turnering — **også den er lukket samme dag**, ved at fjerne vinduet helt (`B1`). Se [`../DECISIONS.md`](../DECISIONS.md).
- **A10 — ✅ Lukket (31. juli 2026):** abonnementet gater ikke længere denne drejebog. Se 3.4 nedenfor.

### 3.4 Turnering #2 er Scotland Premiership — A10, afgjort 31. juli 2026

*Tilføjet efter at drejebogen blev skrevet. Dengang stod A10 åben, og hele §3 forudsatte, at abonnementet skulle afklares først. Slutlinjens "beslut hvilken turnering (Premier League er roadmappens kandidat)" er dermed erstattet: valget er truffet, og det koster ingenting.*

**Gratis-planen indeholder fire turneringer** (verificeret på kontosiden, 31. juli 2026):

| Land | Turnering | Sportmonks-id |
|---|---|---|
| Danmark `#320` | Superliga | `271` |
| Danmark `#320` | Superliga Play-offs | `1659` |
| Skotland `#1161` | **Premiership** | **`501`** |
| Skotland `#1161` | Premiership Play-Offs | `513` |

**Turnering #2 = Scotland Premiership (`501`).** Den er rigtig nok til generalprøven på alle de måder, koden er følsom over for: egen sæson med egne runder (samme rytme som Superligaen, aug.–maj), egne holdnavne til at afprøve den fuzzy holdmatch i `sync-matches`, egne fasenavne til `STAGE_LABELS`, og — vigtigst — den gør turnerings-*antallet* til to, hvilket er den variabel, hele §3.2 og testcases 2–6 handler om. ~~Tændes med `is_visible = false`, til §3.2 er verificeret; derefter er det et frit valg, om nogen skal kunne tippe den.~~ **Rettet ved leveringen 31. juli 2026: den tændes synlig med det samme** — se §3.1, trin 1.

**To ting at være opmærksom på ved netop denne plan:**

- **Sæsonopdelingen er stages, ikke turneringer — og det gælder også Skotland.** Superligaen er én sæson med flere stages, som alle kommer med i samme kald (DOCUMENTATION.md §8), og `STAGE_LABELS` i `src/lib/scoring.js` beviser det med de navne, syncen faktisk har leveret: `Regular Season`, `Championship Round`, `Relegation Round` og endda `Conference League Play-offs – Final`. Skotland deler sig efter samme model (grundspil → mesterskabs-/nedrykningsspil), så **`501` alene dækker hele Premiership-sæsonen** — der skal ikke oprettes en `leagues`-række pr. fase. De separate `*_Play-offs`-ligaer i planen (`1659`/`513`) er op-/nedrykningsspillet mod næstbedste række, altså en anden turnering end vores sæson, og de er ikke nødvendige for `B2`.
- **Skotske fasenavne** rammer `STAGE_LABELS`-fallbacken (råt navn), indtil de oversættes. Er de de samme engelske navne som Superligaens (`Championship Round`/`Relegation Round`), er de allerede dækket. **Det er ikke verificeret** — sådan gør du (samme endpoint og include, som `sync-matches.js` faktisk læser `stage.name` fra, så svaret er præcis det, der ville stå i `matches.stage_name`):

  ```bash
  T=<token>
  # sæson-id for turneringen (501 = Scotland Premiership, 271 = Superliga)
  curl -s "https://api.sportmonks.com/v3/football/leagues/501?include=seasons&api_token=$T" \
    | jq -r '.data.seasons[] | "\(.id)\t\(.name)"'
  # de stage-navne, syncen ville gemme
  curl -s "https://api.sportmonks.com/v3/football/fixtures?filters=fixtureSeasons:<SÆSON_ID>&include=stage&per_page=50&api_token=$T" \
    | jq -r '.data[].stage.name' | sort -u
  ```

  **Timing:** tidligt i en sæson findes opdelingen ofte ikke endnu — Sportmonks har typisk kun `Regular Season`, til slutspillet er sat. Ét navn i juli er derfor ikke et tegn på, at Skotland afviger; det gælder Superligaen på samme tidspunkt. Ukendte stages falder pænt tilbage til det rå navn, så en manglende oversættelse er kosmetik, ikke en fejl.

  → **Aflæst 31. juli 2026. Skotland afviger — se §3.5.**

### 3.5 Fasenavnene: Skotland hedder ikke det samme som Superligaen (aflæst 31. juli 2026)

Antagelsen i §3.4 var, at de skotske navne måske var de samme engelske som Superligaens. Det er de ikke — og de er ikke engang de samme fra sæson til sæson i samme turnering:

| Turnering | Sæson | Stages hos Sportmonks |
|---|---|---|
| Superligaen `271` | — | `Regular Season`, `Championship Round`, `Relegation Round`, `Conference League Play-offs – Final` |
| Scotland Premiership `501` | **2026/2027** (`28275`) | **`1st Phase`** — og indtil videre kun den |
| Scotland Premiership `501` | 2025/2026 (`25598`) | `Regular Season`, **`2nd Phase`** |

**Tre ting følger af det:**

1. **`1st Phase` og `Regular Season` er begge grundspil.** Begge peger nu på "Grundspil" i `STAGE_LABELS`. At 2025/2026 brugte det ene navn og 2026/2027 det andet betyder, at kortlægningen skal kunne rumme flere engelske navne for samme fase — ikke at det ene er "rigtigt".
2. **`2nd Phase` er ét ord for hele slutspillet: "Slutspil".** Sportmonks giver *ikke* Skotland en stage pr. halvdel af opdelingen, som DBU-sæsonen får med `Championship Round`/`Relegation Round`. En oversættelse til "Mesterskabsspil" ville påstå noget, dataene ikke siger — top-6 og bund-6 ligger i samme stage.
3. **Badge-reglen kunne ikke længere være et regex på "regular season".** Den skjuler grundspils-badgen, fordi en badge på hver eneste kamp i grundspillet er ren støj. Med `1st Phase` ville hver skotsk kamp have fået et "Grundspil"-mærke. `stageBadgeLabel` slår nu navnet op **først** og skjuler alt, der oversættes til "Grundspil" — så næste turnering med et tredje navn for grundspil er dækket, i samme øjeblik den får sin linje i kortlægningen.

**Sæson-id'et er samtidig kendt:** `28275`. Det er skrevet direkte ind i `sql/tournament_scotland_premiership.sql`, så første sync ikke behøver `&smSeason=` — og Admin-knappen "Hent nu" virker fra første klik.

**Bemærk, at 2026/2027 kun har én stage endnu.** Det er forventet: opdelingen skemalægges først, når grundspillet er ved at være slut. `2nd Phase` er oversat på forhånd, fordi navnet er set i 2025/2026-sæsonen — ikke gættet.

**Rettet efter levering (31. juli 2026, `A20`):** at slutspillet kommer sent er ikke længere et vilkår, brugeren skal tage højde for. En `full_season`-konkurrence oprettet nu **efterfyldes** med `2nd Phase`-kampene, når Sportmonks skemalægger dem. Fasenavnene bruges stadig til badgen på kamprækken, men ikke længere til at afgrænse en konkurrence — fase-vælgeren er fjernet.

**Premier League koster stadig penge — og det haster ikke.** Billigste plan er **Starter €29/md** (5 selvvalgte turneringer); Growth (€99) og Pro (€249) er irrelevante ved et behov på 2–3 turneringer. Abonnementet tegnes, når nogen reelt vil tippe PL ved en sæsonstart — ikke fordi roadmappen nævner den. Appen er gratis for brugerne, så udgiften er privat (~215 kr./md), og behovet er sæsonbestemt: en opsigelse hen over sommeren er driftsmæssigt ufarlig, fordi data ligger i Supabase og `sync-live` rydder pænt op for kampe, den ikke kan hente, i stedet for at fejle.

**Add-on-fælden:** Champions League ligger i **Euro Club Tournaments, +€29/md**, altså *uden for* de 5 selvvalgte turneringer. Roadmappens trin 5 nævner PL og CL i samme sætning, men de koster ikke det samme — CL er en fordobling af regningen og tages som en selvstændig beslutning. Internationale turneringer (+€129/md) er fravalgt.

**Rate limit er ikke det, vi ville betale for:** `sync-live` bruger maks. 60 kald/time på kampdage og nul resten af tiden, `sync-matches` ~4 kald pr. kørsel pr. turnering hver 12. time. To turneringer fordobler kun det sidste tal. Fuld begrundelse i [`../DECISIONS.md`](../DECISIONS.md), 31. juli 2026.

---

### 3.6 Championship fik to niveauer — A2 afløst (31. juli 2026)

*Tilføjet efter leveringen, da turnering #2 var i drift. Drejebogen forudså rettelsen af §3.2, men ikke det spørgsmål, den rejste: **hvad en kåring betyder, når der er mere end én turnering.***

Rundechampionshippet og månedschampionshippet joinede kun `predictions` ↔ `matches`. Uden filter på turnering summerer de point for **alt**, brugeren har tippet — og hvad man tipper, afgøres af hvilke *frivillige* konkurrencer, man er meldt ind i. Med én turnering var det uproblematisk; med to måles to brugere på forskellige kampmængder (~12 kampe og et loft på 36 point mod ~6 og 18). De eneste konkurrencer, ingen selv har valgt, blev dermed afgjort af valg truffet andre steder.

**Løsningen er to niveauer**, hvor navnet bærer forskellen:

| `scope` | Hvad | Kåring |
|---|---|---|
| `'ALL'` | Alle **officielle** turneringer samlet | **Rundens / Månedens Champion** |
| `<league_id>` | Én stilling pr. officiel turnering | Rundens / Månedens **bedste i {turnering}** |

Det samlede tæller fortsat samlede point og belønner altså bredde — forskellen er, at det nu er en **udtalt** regel med et navn, ikke en skjult skævhed. Per-turnering-stillingen er den, hvor alle ér målt på de samme kampe.

**`leagues.is_official`** (ny kolonne, `sql/tournament_scope.sql`) afgør, hvad der overhovedet fodrer Championship — adskilt fra `is_visible`, med en check-constraint der gør officiel til en indsnævring af synlig. **Scotland Premiership er sat `is_official = false`:** den er en generalprøve for *flere turneringer*, ikke en turnering, nogen skal vinde titler i. Championship er dermed uændret i dag, og maskineriet står klar til den dag, en rigtig turnering #3 forfremmes.

To ting fulgte, som er værd at kende, hvis man rører ved det igen:

- **`monthly_standings` havde allerede en `scope`-kolonne**, hårdkodet til `'ALL'` og filtreret af både `career_profile.sql` og `story_engine.sql`. Den var forberedt til netop dette (samme greb som `ratings.scope`), så månedslæsningerne var dækket på forhånd. `round_standings` havde den **ikke**, og tre steder læste den ufiltreret — de ville have talt hver rundesejr dobbelt. Filtre tilføjet i samme leverance.
- **Sæsonchampionshippet beholder navnet "Sæsonens Champion"**, selvom det er pr. turnering. Navneregelen gælder, hvor to niveauer konkurrerer om samme navn; en sæson er turneringsbunden af natur, og en samlet sæsonstilling er fravalgt.

Verificeret mod PostgreSQL 16.13 med en fixture, hvor én spiller tipper begge turneringer og to kun hver sin: summen af per-turnering-rækker er lig den samlede række (både kampe og point), rundesejre partitioneres pr. niveau, en ikke-officiel turnering påvirker intet, og constraint'en afviser officiel+usynlig.

**Rettet efter leveringen (31. juli 2026):** *"Championship er dermed uændret i dag"* holdt i databasen, men ikke på skærmen. Både turneringsvælgeren og "To niveauer"-forklaringen i `ChampionshipTab.jsx` er gated på **mere end én officiel** turnering — så med præcis én officiel (Superligaen) og én uofficiel (Skotland) viste fanen ingen af delene, og de skotske kampe forsvandt ud af stillingen uden ét ord om hvorfor. Den bruger, der tipper Skotland, ser sine point tælle i konkurrencen og i ratingen, og ikke her. `scopeNote()` (samme fil, unit-testet) navngiver derfor begge sider — *"Championship afgøres af Superligaen. Scotland Premiership kan tippes og giver point i din konkurrence og i din rating, men tæller ikke med her."* — som en synlig linje på runde- og månedskortet, med hvorfor'et i InfoDot'en. Sæson-InfoDot'en siger nu tilsvarende, at den uofficielle turnering ingen sæsonstilling har. Reglen bag: et tal skal navngive sit eget omfang i den sætning, det står i (`DECISIONS.md`, 30. juli 2026). Linjen forsvinder af sig selv, den dag alle synlige turneringer er officielle.

**Navnene skiftede 4. august 2026 (navneskiftet til Leagly):** hele dette afsnit blev skrevet, da den store titel bar produktets daværende navn, og strukturen hed *rundeliga* og *månedsliga*. Titlerne hedder nu **"… Champion"**, og de to niveauer hedder **rundechampionship** og **månedschampionship** — ordet *liga* var optaget af brugernes egne grupper (liga-laget), så det pegede på to ting. **Selve reglen er uændret:** kun `scope='ALL'` bærer den store titel, per-turnering er stadig *"… bedste i {turnering}"*, og sæsonen er stadig undtagelsen. Teksten ovenfor er rettet til de nye ord, så den kan læses som gældende — det er kun navnene, der er nye, ikke to-niveau-delingen.

**Rettet igen samme dag (A17):** citatet ovenfor er den **første** udgave af sætningen. Ratingen filtrerer nu også på `is_official`, så sætningen lyder *"…kan tippes og giver point i din konkurrence, men tæller hverken i Championship eller i rating."* Ledsætningen om, at Skotland tælle**de** i ratingen, var netop det, der gjorde reglen svær at forklare — og dermed selv et af argumenterne for A17. Den gamle formulering står som citat frem for at blive slettet, fordi rækkefølgen er pointen: fejlen blev først *synlig*, da den skulle skrives ned i én sætning.

---

## 4. Forudsætning

**F1 (delt med [`karriereprofil-v1.md`](./karriereprofil-v1.md)): ✅ Lukket (juli 2026)** — kerneskemaet ligger i `sql/schema.sql` og holdes opdateret af det ugentlige workflow (`.github/workflows/schema-export.yml`, guide i `sql/README.md`).

## 5. Acceptkriterier

- Turnering #2's kampe synkroniseres komplet (antal kampe i DB = antal fixtures hos Sportmonks for sæsonen) — ingen stille trunkering.
- Ingen dublet- eller fejl-linkede hold efter første sync.
- Championship-fanen kan vise sæsonstilling for begge turneringer via vælgeren; dyb-links/eksisterende adfærd for Superligaen er uændret.
- Tip-skærmens turnerings-filter og opret-flowets multivalg viser den nye turnering uden kodeændring.
- Runde-/månedschampionship og rating tæller fortsat hver kamp én gang (ingen dobbelt-tælling ved kampe i flere konkurrencer på tværs af turneringer).
- En runde markeres som færdig, når dens kampe i **synlige** turneringer er spillet — en skjult turnering må ikke holde 🏆 tilbage. *(Tilføjet ved leveringen; se §3.2's sidste række.)*
- A2 er afgjort og logget i ROADMAP, og "Sådan virker det"-teksten matcher.

**Status 2. august 2026: alle kriterier er opfyldt.** De to første er **aflæst i drift** — 198 af 198 kampe synkroniseret (ingen stille trunkering) og ingen dublet- eller fejl-linkede hold; det ene par, kontrollen melder, er en ægte navnelighed (`Dundee` / `Dundee United`), se næste-skridt-listen nederst. A2 er afgjort og afløst (§3.6). De øvrige er brugerflade og er dækket af **testcases 2–6, som ejeren har kørt og godkendt samme dag**.

## 6. Testcases

1. Sync af turnering #2 med `dryRun=true` → forventet antal kampe, ingen skrivninger.
2. Runde med kampe i begge turneringer → rundechampionshippet viser samlede point på tværs. ~~`round_key` beregnes pr. turneringsrunde som i dag.~~ **Rettet 1. august 2026:** `round_key` er kalenderugen (tirsdag–mandag) og har altid været det — kampe fra begge turneringer i samme uge deler derfor `round_key`. Det er netop dét, testcasen beviser. Gætte-vinduet er det ene sted, der stadig scoper pr. `(season_id, round_key)`, så de to turneringers kampe kan åbne på hver sin dag i samme runde.
3. `full_season`-konkurrence med begge turneringer (multivalg) → kampe fra begge materialiseres, stilling korrekt.
4. Bruger tipper kun den ene turnering → rating (snit pr. kamp) er fair; månedschampionship følger A2-beslutningen.
5. Sæsonvælger på Championship: skift mellem turneringerne → korrekt stilling + fremdrifts-tæller pr. turnering.
6. Turnering med >20 siders fixtures (simuleret) → syncen henter alt eller fejler højlydt — aldrig stille trunkering. *(Loftet er i dag `MAX_PAGES = 60` i `api/_providers/sportmonks.js`, jf. §7.)*

---

*Næste skridt (opdateret 31. juli 2026, efter at driften var sat op): ~~Beslut hvilken turnering (Premier League er roadmappens kandidat)~~ → ~~turnering #2 er Scotland Premiership (`501`)~~ → ~~udfør 3.1–3.2 med `is_visible = false`~~ → ~~§3.2 er leveret; tilbage står §3.1~~ → **§3.1 og §3.2 er begge færdige: SQL-scriptet er kørt, og cron-jobbet er oprettet (job #5 i [`../CRON.md`](../CRON.md)). Tilbage står kun **verifikation**, ikke opsætning:*

1. ~~**Hold-dubletter** — den fuzzy holdmatch i `sync-matches` er aldrig afprøvet på skotske klubnavne.~~ **Automatiseret efter levering (august 2026):** kontrollen er ikke længere et engangs-tjek, nogen skal huske. `ambiguousTeamNames()` i `api/sync-matches.js` kører ved HVER kørsel på turneringens fulde holdliste og lægger de par, den fuzzy match ikke kan skelne, i `ambiguousTeams` i kørslens resumé — aflæses i Admin → Drift. Den fanger begge former: to rækker, der normaliserer ens, og det farligere tilfælde, hvor det ene navn ligger inde i det andet ("Rangers" i "Queen's Park Rangers"). Feltet er kun til stede, når der ER noget at kigge på. *(Rettet efter levering, 10. august 2026 — `A26`: **den egenskab holdt ikke for Scotland.** `Dundee` ligger inde i `Dundee United`, begge klubber bliver i turneringen, og feltet var derfor permanent tændt med et par, der allerede var afgjort som en ægte navnelighed. Kontrollen filtrerer nu mod `GODKENDTE_HOLDPAR` i `api/sync-matches.js`, så feltet igen kun melder det, ingen har set på; godkendte par tælles i stedet i `ambiguousKnown`, som er kvitteringen for, at filteret bider. **Det, en ny turnering skal huske, er derfor blevet ét skridt længere:** melder første kørsel et par, afgøres det, og er svaret "ægte navnelighed", skrives parret ind i listen med begrundelse og dato.)* ~~Tilbage står at åbne Drift-kortet for Scotland-jobbet én gang og se efter feltet~~ — men gør ingen det, forsvinder spørgsmålet ikke længere ud af verden, og den samme kontrol dækker automatisk Champions League, når den får sine hold ved lodtrækningen.
   **Aflæst 2. august 2026 — feltet ER der, og svaret er "ikke en dublet".** Kørslens resumé melder ét par: `Dundee` / `Dundee United`, med `why: "det ene navn ligger inde i det andet"`. Det er en **ægte navnelighed** — to virkelige klubber i samme by — og ikke et fejl-link, og det kan aflæses af selve meldingen: kontrollen kører på turneringens fulde holdliste, så optræder begge navne i den, findes begge klubber som hver sin række. Var `Dundee United` blevet knyttet til `Dundee`s række, ville kun det ene navn have stået der. `teamsCreated: 0` og tom `unmatched` bekræfter det fra den anden side: alle 198 kampe fandt begge deres hold, uden at noget nyt hold skulle oprettes.
   **Risikoen, der bliver stående, er kendt og lille:** `findByName()` prøver den præcise normaliserede match **først**, så delstrengs-reglen kun kan ramme et navn, der ikke allerede står i listen ordret. Den ville altså kræve, at en af de to klubber både mistede sit `api_team_id` og skiftede skrivemåde hos leverandøren samtidig. Prisen for kontrollen er derimod permanent: feltet står nu i **hver** Scotland-kørsel, og et felt, der altid er der, holder man op med at læse — noteret i backloggens indbakke.
2. ~~**Fasenavne** mod `STAGE_LABELS`~~ **Verificeret i koden (august 2026):** `STAGE_LABELS` i `src/lib/scoring.js` indeholder `"2nd Phase": "Slutspil"` og `"1st Phase": "Grundspil"`, altså præcis dét §4 forudsagde, og en test i `scoring.test.js` fastholder dem. Rammer et *ukendt* skotsk fasenavn stadig fallbacken, står det råt i brugerfladen — det kan kun ses mod rigtige data.
3. ~~**Kampantal** mod Sportmonks for sæsonen (acceptkriterie 1) — ingen stille trunkering.~~ **Aflæst 2. august 2026: 198 kampe, og tallet kan efterprøves uden at spørge Sportmonks.** Resuméet siger `totalFixtures: 198` og `synced: 198` — leverandøren gav 198, og alle 198 blev skrevet, så intet forsvandt undervejs i vores egen kode. At leverandøren så gav det *rigtige* antal, følger af turneringens form: Premiership har 12 hold, som møder hinanden tre gange før opdelingen = 33 runder × 6 kampe = **198**. De sidste 5 runder (30 kampe) findes ikke endnu, fordi `2nd Phase` først skemalægges, når grundspillet er ved at være slut — præcis som §3.5 beskriver. Fire sider à 50 er desuden langt fra `MAX_PAGES` (60), og en afbrudt paginering ville i dag kaste frem for at bryde stille.
4. ~~**Testcases 2–6** ovenfor.~~ **Kørt og godkendt af ejeren 2. august 2026** — de krævede alle brugerfladen mod produktionsdata og kunne derfor kun afgøres dér. Testcase 1 blev kørt ved selve opsætningen 31. juli.

**Dermed er `B2` lukket, og drejebogen er færdig.** Rækken er slettet af backloggen efter husreglen — historikken står i [`../CHANGELOG.md`](../CHANGELOG.md) og [`../DECISIONS.md`](../DECISIONS.md). Det, der bliver stående som *permanent* værn frem for som opgave, er de to kontroller, verifikationen blev lavet om til: `ambiguousTeams` i hver `sync-matches`-kørsel og `STAGE_LABELS`-testen i `scoring.test.js`. De dækker automatisk turnering #3, den dag den kommer.

*Premier League venter på efterspørgsel og €29/md (3.4). A2 er lukket og afløst (§3.6).*
