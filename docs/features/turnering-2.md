# Feature: Turnering #2 (flere fodboldturneringer)

**Status: Drejebog — skemaet er forberedt, få kodeændringer udestår** · *Filosofi: [`../PRODUCT_BOOK.md`](../PRODUCT_BOOK.md), kapitel 4 · Prioritering: [`../ROADMAP.md`](../ROADMAP.md), forudsætning for trin 5*

*Mere drejebog end klassisk spec: infrastrukturen til flere turneringer er allerede bygget. Dette dokument samler, hvad der er klar, og præcis hvad der mangler, før fx Premier League kan tændes.*

---

## 1. Begreber (vigtigt)

Jf. ordbogen i [`liga-laget-v1.md`](./liga-laget-v1.md) afsnit 2: en **turnering** er en fodboldliga fra Sportmonks (`leagues`-tabellen — Superligaen, Premier League …). En **liga** er fællesskabet (`groups`) og er allerede leveret. "Flere ligaer" i daglig tale betyder her **flere turneringer**.

---

## 2. Hvad der allerede er klar (ingen ændringer nødvendige)

- **`leagues`/`seasons`/`teams` er generiske.** Intet i skemaet er bundet til Superligaen; `MainApp.jsx` indlæser alle synlige turneringer dynamisk, og hold auto-oprettes af syncen ud fra kampenes deltagere.
- **`full_season` på tværs af turneringer** (juli 2026): multivalg af turneringer + stages pr. turnering (`mode_params.tournaments`), materialiseret i `competition_matches`. `custom`/`random` var allerede turnerings-løse med filter.
- **Rundeliga, månedsliga og rating er turnerings-agnostiske by design:** `predictions` er én række pr. bruger pr. kamp, så hver kamp tælles én gang på tværs af alt.
- **`ratings.scope`** er forberedt til per-turnering-rating senere uden skemaændring (i dag altid `'ALL'`).
- **`loadSeasonBoard(token, leagueId)`** er fuldt parameteriseret — kun kalderen er hardkodet (se 3.2).
- **Tilføjelses-proceduren** står i DOCUMENTATION.md afsnit 10 (DB-rækker + sync-kald + cron-job).

---

## 3. Opgaver ved tilføjelse af turnering #2

### 3.1 Drift (ingen kode)

1. Find turneringens Sportmonks-id og indsæt række i `leagues` (`api_league_id`, `is_visible`) + sæson-række i `seasons` (jf. DOCUMENTATION.md afsnit 10).
2. Kald `/api/sync-matches?leagueId=<uuid>&smSeason=<navn>` første gang (`&dryRun=true` først) — holdene oprettes automatisk.
3. Opret ét nyt cron-job.org-job for turneringen, med `SYNC_SECRET` i `x-sync-secret`-headeren (jf. ROADMAP-beslutningen — nye jobs skal ikke bruge `?secret=`-fallbacken).
4. Notifikations-jobbet dækker allerede alle turneringer i ét kald — intet nyt job dér.

### 3.2 Kode (små, afgrænsede ændringer)

| Sted | Ændring |
|---|---|
| `src/screens/ChampionshipTab.jsx` (linje ~19–23) | **Den eneste reelle hardkodning i UI'et:** Sæsonchampionship finder turneringen via navne-regex `/superliga/i`. Erstat med en turnerings-vælger (dropdown over synlige turneringer, samme mønster som runde-/månedsvælgeren) — `loadSeasonBoard` tager allerede `leagueId`. Én sæsonstilling pr. turnering; en samlet på tværs af turneringer er bevidst fravalgt (den rolle har månedsligaen/ratingen). |
| `src/lib/scoring.js` (linje ~57–62) | `STAGE_LABELS` oversætter kun Superligaens stages til dansk (grundspil/mesterskabsspil/…). Tilføj den nye turnerings fasenavne; ukendte stages falder allerede pænt tilbage til råt navn, så dette kan ske løbende. |
| `api/sync-matches.js` (linje ~63, ~122) | (a) Sæson-navn-fallbacken er hardkodet `"2026/2027"` — harmløs så længe `smSeason`/gemt `api_season_id` bruges, men bør fjernes eller gøres påkrævet, når flere turneringer med forskellige sæsonnavne er i drift. (b) Paginationen stopper hårdt ved side 20 — en stor turnering kan blive **stille trunkeret**; hæv loftet eller log/fejl ved afbrudt pagination. |
| `api/sync-matches.js` (holdmatch) | Holdopslag matcher på normaliserede navne (fuzzy). Verificér efter første sync, at den nye turnerings hold ikke er fejl-linket til eksisterende hold (kendt faldgrube, jf. fejlfindingsloggens holdnavne-sager). |

### 3.3 Beslutninger, der udløses (fra roadmappens åbne beslutninger)

- **A2 — ✅ Lukket (juli 2026):** Månedsligaen tæller **samlede point**, også med flere turneringer (rating dækker præcision via gennemsnit). Ingen kodeændring — `monthly_standings` og "Sådan virker det"-teksten er allerede korrekte.
- **Trin 5 — global tirsdag–mandag-runde** bliver først reelt anderledes end turneringsrunder, når turnering #2 er i drift. Forbliver bevidst udskudt; dette dokument ændrer ikke på det, men tilføjelsen af turnering #2 er dens forudsætning.

---

## 4. Forudsætning

**F1 (delt med [`karriereprofil-v1.md`](./karriereprofil-v1.md)): ✅ Lukket (juli 2026)** — kerneskemaet ligger i `sql/schema.sql` og holdes opdateret af det ugentlige workflow (`.github/workflows/schema-export.yml`, guide i `sql/README.md`).

## 5. Acceptkriterier

- Turnering #2's kampe synkroniseres komplet (antal kampe i DB = antal fixtures hos Sportmonks for sæsonen) — ingen stille trunkering.
- Ingen dublet- eller fejl-linkede hold efter første sync.
- Championship-fanen kan vise sæsonstilling for begge turneringer via vælgeren; dyb-links/eksisterende adfærd for Superligaen er uændret.
- Tip-skærmens turnerings-filter og opret-flowets multivalg viser den nye turnering uden kodeændring.
- Runde-/månedsliga og rating tæller fortsat hver kamp én gang (ingen dobbelt-tælling ved kampe i flere konkurrencer på tværs af turneringer).
- A2 er afgjort og logget i ROADMAP, og "Sådan virker det"-teksten matcher.

## 6. Testcases

1. Sync af turnering #2 med `dryRun=true` → forventet antal kampe, ingen skrivninger.
2. Runde med kampe i begge turneringer → rundeligaen viser samlede point på tværs; `round_key` beregnes pr. turneringsrunde som i dag.
3. `full_season`-konkurrence med begge turneringer (multivalg) → kampe fra begge materialiseres, stilling korrekt.
4. Bruger tipper kun den ene turnering → rating (snit pr. kamp) er fair; månedsliga følger A2-beslutningen.
5. Sæsonvælger på Championship: skift mellem turneringerne → korrekt stilling + fremdrifts-tæller pr. turnering.
6. Turnering med >20 siders fixtures (simuleret) → syncen henter alt eller fejler højlydt — aldrig stille trunkering.

---

*Næste skridt: Beslut hvilken turnering (Premier League er roadmappens kandidat) → luk A2 → udfør 3.1–3.2 → QA på preview før `is_visible = true`.*
