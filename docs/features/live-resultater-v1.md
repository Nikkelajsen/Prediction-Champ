# Live-resultater v1

**Status: leveret (juli 2026).** Teknisk dokumentation: `DOCUMENTATION.md` afsnit 8. Produktfilosofi: [`../PRODUCT_BOOK.md`](../PRODUCT_BOOK.md).

---

## 1. Problemet

Under en kamp stod der blot **"I gang"** ud for kampen på Hjem-fanen. Man kunne se, at noget skete — men ikke hvad. Brugerne forlod appen for at slå stillingen op et andet sted, netop i de 90 minutter hvor spændingen er størst og deres eget tip er på spil.

## 2. Målet

Mens en kamp spilles, skal appen vise **den nuværende stilling** — og det skal være umuligt at forveksle "i gang" med "færdigspillet".

Modkravet er lige så vigtigt: **tabellerne må ikke bevæge sig, før kampen er slut.** En stilling, der giver point for et 1-0 i 12. minut og tager dem igen i 88., er ikke en stilling — den er støj. Point er en afgørelse, ikke et øjebliksbillede.

## 3. Designbeslutningen: separate kolonner

Hele appen bruger ét udtryk som betydningen "kampen er spillet færdig":

```
matches.home_score is not null
```

Det gælder pointberegningen (`pointsFor`), alle tre stillings-views (`round_standings`, `season_standings`, `monthly_standings`), rating-triggeren, låsereglen (`isLocked` + RLS-policyen) og Story Engine.

Derfor skrives live-scoren **aldrig** i `home_score`/`away_score`, men i separate kolonner (`sql/live_scores.sql`):

| Kolonne | Indhold |
|---|---|
| `live_home_score` / `live_away_score` | nuværende mål |
| `live_state` | leverandørens state (`INPLAY_1ST_HALF`, `HT`, …) — `null` = ikke i gang. *(Rettet efter levering, `flere-datakilder-v1`: kolonnen er leverandør-agnostisk og bærer også football-data.org-statusser som `IN_PLAY`/`PAUSED`, når en liga har `live_enabled = true`.)* |
| `live_minute` | spilleminut fra den tikkende periode (`null` i pauser) |
| `live_updated_at` | hvornår live-syncen sidst skrev |

Konsekvensen er, at **ingen eksisterende læse- eller skrivesti skulle ændres**:

- rating-triggeren (`sql/rating_trigger_optimization.sql`) sammenligner kun `home_score`/`away_score` i sine transition tables → live-opdateringer udløser hverken Elo-genberegning eller `generate_stories()`.
- stillings-views'ene summerer kun kampe med endeligt resultat → tabellerne står stille under kampen.
- låsningen er uændret af live-resultater (den kigger på `home_score` + kickoff). *Rettet efter levering (`A21`, 1. august 2026): låsen er nu **per kamp**, ikke runde-baseret — men live-stillingen låser fortsat ingenting, og punktet her gælder uændret.*

Alternativet — at skrive live i `home_score` og filtrere det fra alle steder — ville have krævet ændringer i tre views, en trigger, en RLS-policy og hver eneste frontend-sti. Ét forglemt sted = forkerte point. Separate kolonner gør det rigtige til standarden.

## 4. Serverfunktionen (`api/sync-live.js`)

Ét cron-job, hvert minut, alle ligaer på én gang.

1. Slår i **vores egen** database op, hvilke kampe der kan være i gang: uden endeligt resultat med kickoff i [nu − 6 t; nu + 15 min], plus alle kampe der stadig står markeret som live.
2. Er der ingen — de fleste minutter i døgnet — returneres uden at kalde Sportmonks. Det er hele grunden til, at et minut-interval er forsvarligt på en gratis plan.
3. Ellers hentes præcis de kampe: `fixtures/multi/{ids}?include=scores;state;periods`, ét kald pr. 40 kampe. *(Rettet efter levering, `flere-datakilder-v1`: trin 2–3 beskriver én-leverandør-verdenen. I dag grupperes kampene pr. `leagues.provider`, og hver leverandør spørges for sig — football-data.org henter et **datovindue** (`/matches?dateFrom=…&dateTo=…`), ikke et fixture-id-opslag. Den fulde to-leverandør-beskrivelse står i `DOCUMENTATION.md` §8.)*
4. Pr. kamp: **FT/AET/FT_PEN** → skriv endeligt resultat + ryd live-felterne · **i gang** → skriv kun live-felterne · **hverken/eller** (ikke startet, udsat, aflyst) → ryd live-felterne.
5. Alt skrives i **én** upsert, så statement-triggeren på `matches` kører netop én gang.

Uændrede skrivninger springes over, så databasen ikke bankes på hvert minut uden grund.

**Sidegevinst:** funktionen færdigmelder også kampe. Før ventede en færdigspillet kamp på næste `sync-matches`-kørsel (dengang hvert 10.-15. minut, i dag hver 12. time); nu opdaterer stillinger og rating inden for et minut efter slutfløjt. `sync-matches` bevares uændret (ét job pr. liga; kadencen er siden skruet ned til hver 12. time) og passer kampprogram, flyttede kampe og nye hold.

## 5. Brugerfladen

Én helper, `liveInfo(match)` i `src/lib/scoring.js`, oversætter kolonnerne til UI-tilstand og er det eneste sted, reglen bor. Den returnerer `null`, hvis kampen ikke er i gang — og **et endeligt resultat slår altid live**, så en kamp aldrig kan "gå tilbage" til live efter at være meldt færdig.

Tre visuelt adskilte tilstande:

| Tilstand | Visning |
|---|---|
| Færdigspillet | resultat + point-pille + dæmpet **Slut** |
| I gang | nuværende stilling (rød) + rødt, pulserende **LIVE 63′** — ingen point |
| Kommende | kickoff-tidspunkt |

- **Hjem**, "Indeværende runde": LIVE-mærket vises allerede på det **foldede** kort (`liveCount`), så man kan se at der spilles uden at folde ud. Kortet genindlæser i forvejen hvert minut.
- **Tip**: LIVE-mærket står på kampens meta-linje, den nuværende stilling i en neutral, rød-kantet ramme — bevidst **uden** den grøn/rød-farvekodning som færdige kampe har, for der er intet afgjort endnu. Skærmen genhenter kun kampene, når mindst én kamp er i live-vinduet.
- Pulsen slås fra ved `prefers-reduced-motion`.
- "Sådan virker det" har fået en **Live-resultater**-sektion, der siger det direkte: live-stillingen giver ingen point, og tabellerne opdateres først ved slutfløjt.

## 6. Bevidst udeladt i v1

- **Live i Championship-/liga-stillingerne.** De skal netop stå stille under kampen — en "hvis alt ender sådan her"-projektion er en selvstændig feature (og et selvstændigt produktspørgsmål), ikke en del af live-resultater.
- **Live-notifikationer ved mål.** Push-strategien er bevidst "få, relevante beskeder" (to typer). Målnotifikationer ville tredoble støjen.
- **Målscorere, kort, statistik.** Kræver flere Sportmonks-includes pr. kald; giver ikke mere til tippekonkurrencen.

## 7. Engangsopsætning (udførlig)

### Trin 0 — forudsætninger

Tre ting skal være på plads, **i denne rækkefølge**, før cron-jobbet giver mening:

1. **Koden skal være deployet.** `/api/sync-live` findes først, når branchen er merget til `main` (eller du bruger branchens preview-URL). Tjek det ved at åbne `https://<app>/api/sync-live` i browseren — du skal få `{"error":"Ikke autoriseret"}`. Får du Vercels 404-side, er funktionen ikke deployet endnu.
2. **Databasen skal have live-kolonnerne.** Kør `sql/live_scores.sql` i Supabase → SQL Editor → **"Run without RLS"**. Scriptet er idempotent. Gør du ikke det, fejler hver kørsel med `column "live_state" does not exist`.
3. **Du skal kende to værdier:**
   - **App-URL:** din Vercel-produktions-URL (Vercel → projektet → Domains).
   - **`SYNC_SECRET`:** Vercel → projektet → Settings → Environment Variables. Den findes allerede — det er den samme, dine `sync-matches`-jobs bruger.

### Trin 1 — test funktionen manuelt, før du automatiserer

Kør én gang fra din egen maskine med `dryRun`, så intet skrives:

```bash
curl -s -H "x-sync-secret: DIN_SYNC_SECRET" \
  "https://<app>/api/sync-live?dryRun=true"
```

Forventet svar uden kampe i gang:

```json
{"checked":0,"live":0,"finished":0,"cleared":0,"note":"Ingen kampe i tidsvinduet"}
```

Det er det **rigtige** svar uden for kamptid — det betyder, at funktionen slog op i din egen database, ikke fandt noget, og sprang Sportmonks-kaldet helt over. Gentag testen under en kamp for at se `live`-tallet stige.

> Har du ikke `curl`, virker `https://<app>/api/sync-live?dryRun=true&secret=DIN_SYNC_SECRET` i en browser. Brug kun den form til en enkelt test — hemmeligheden havner i request-logs. Cron-jobbet skal bruge headeren.

### Trin 2 — opret cron-jobbet på cron-job.org

Log ind på [cron-job.org](https://cron-job.org) → **Cronjobs** → **Create cronjob**.

| Felt | Værdi |
|---|---|
| **Title** | `Leagly — live-resultater` |
| **URL** | `https://<app>/api/sync-live` |
| **Schedule** | **Every 1 minute** — vælg "Every minute" i dropdownen, eller sæt alle felter (minut/time/dag/måned/ugedag) til "every" |
| **Request method** | `GET` |

Åbn derefter **Advanced** (eller fanen "Advanced settings"):

| Felt | Værdi |
|---|---|
| **Headers** | Tilføj én: navn `x-sync-secret`, værdi = din `SYNC_SECRET` |
| **Treat redirects as success** | fra |
| **Enable job** | til |

**Ingen query-parametre.** Funktionen finder selv de relevante kampe på tværs af alle ligaer — modsat `sync-matches`, der skal have `?leagueId=`.

Gem med **Create**.

### Trin 3 — verificér de første kørsler

Åbn jobbet → **History** / **Execution log**. Efter et par minutter skal du se:

- **Status 200** på hver kørsel.
- Svarteksten `{"checked":0,...,"note":"Ingen kampe i tidsvinduet"}` uden for kamptid.
- Under en kamp: `{"checked":3,"live":3,"finished":0,"cleared":0,"written":3}`. *(Svaret bærer i dag også `liveSuppressed` og `providers` — og `rateLimit`, når Sportmonks melder sit forbrug.)*

Den endelige test er appen: åbn Hjem-fanen under en kamp — "Indeværende runde" skal vise den nuværende stilling og et rødt **LIVE**-mærke, og tallet skal opdatere af sig selv cirka hvert minut.

### Trin 4 — skru `sync-matches` ned (anbefalet)

`sync-matches`-jobbene kørte hvert 10.-15. minut for at fange resultater hurtigt. **Den grund er væk** — `sync-live` færdigmelder nu kampe inden for et minut efter slutfløjt. Tilbage har `sync-matches` kun langsomme opgaver: nye kampe i programmet, flyttede kickoff-tider og nye hold.

~~Sæt dem til **hver 6. time**.~~ **Rettet efter levering (august 2026, `G6`):** de blev sat til **hver 12. time**, ikke hver 6., og dét er tallet, der gælder. Afvigelsen stod uopdaget, fordi overvågningen — heartbeat'en og `ops.js` — beholdt spec'ens 6 timer med alarm efter 14, altså en grænse, der var strammere end det skema, den skulle overvåge. Registeret i [`../CRON.md`](../CRON.md) er kilden til kadencen; alarmgrænsen er nu 26 timer.

Uanset tallet er pointen den samme: på Sportmonks' gratis-plan (**3.000 kald i timen pr. entitet** — her stod 180, indtil `A15` blev aflæst 2. august 2026; se [`../DECISIONS.md`](../DECISIONS.md)) falder det konstante forbrug fra ~24 kald/time til under 1, og hele budgettet er frit til live-syncens 60 kald/time på kampdage. Ren indstillingsændring hos cron-job.org — ingen kodeændring.

### Fejlfinding

| Svar | Årsag | Løsning |
|---|---|---|
| `401 {"error":"Ikke autoriseret"}` | Header mangler, er stavet forkert, eller `SYNC_SECRET` er ikke sat i Vercels **Production**-miljø | Tjek headernavnet er præcis `x-sync-secret`, og at værdien matcher Vercel-variablen |
| `500 {"error":"Serveren er ikke sat rigtigt op."}` | `SUPABASE_URL` eller `SUPABASE_SERVICE_ROLE_KEY` mangler i Vercel (svaret navngiver bevidst ikke variabler, `G38`; detaljen står i Vercels log). En manglende API-nøgle er IKKE denne fejl — den tjekkes pr. leverandør og dukker op i `providerErrors` | Sæt dem, og redeploy |
| `500 Supabase …: 42703 column "live_state" does not exist` | `sql/live_scores.sql` er ikke kørt | Kør scriptet ("Run without RLS") |
| `500 Sportmonks (live): 429` | Rate limit ramt **to gange i træk** — siden `G48` gen-forsøges et 429 én gang efter `Retry-After`, før fejlen kan nå hertil | Aflæs `rateLimit` i seneste kørsler (grænsen er 3.000/time pr. entitet); sker det stadig, så find ud af, hvad der kalder for ofte |
| `404` fra Vercel | Funktionen er ikke deployet | Merge branchen til `main`, eller peg jobbet på preview-URL'en |
| `200`, men `checked` er altid `0` under en kamp | Kampen mangler `api_fixture_id`, eller `kickoff_at` er forkert | Kør `sync-matches` for ligaen og tjek kampen i Admin |
| Kampen vises live uden minuttal | `periods`-include er ikke i dit abonnement — funktionen prøver automatisk igen uden | Ingen handling; stillingen er korrekt, kun minuttet mangler |

### Hold øje med

- **Vercel-invokationer:** 1.440 kørsler i døgnet ≈ 43.800 om måneden. Det er langt under Hobby-planens grænse i dag, men tjek Vercel → Usage efter den første måned.
- **cron-job.org's fejlnotifikationer:** slå "notify on failure" til, men vær opmærksom på, at et job, der fejler vedvarende, kan blive deaktiveret automatisk. Ser du live-stillingen fryse, så tjek jobbets status først.
