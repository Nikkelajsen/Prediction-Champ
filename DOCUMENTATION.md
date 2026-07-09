# Prediction Champ — Dokumentation

_Sidst opdateret: juli 2026_

Prediction Champ er en webapp, hvor venner kan konkurrere om at forudsige fodboldresultater. Denne fil dokumenterer, hvordan systemet hænger sammen, så det er nemmere at vedligeholde og udvide senere.

---

## 1. Overblik over arkitekturen

```
┌─────────────────┐        ┌──────────────────┐        ┌─────────────────┐
│   Sportmonks     │──────▶│  Vercel Function  │──────▶│    Supabase      │
│  (football data) │        │ /api/sync-matches │        │ (database + auth)│
└─────────────────┘        └──────────────────┘        └─────────────────┘
                                                                  ▲
                                                                  │
                                                          ┌──────────────┐
                                                          │  React-app    │
                                                          │ (Vercel-hosted)│
                                                          └──────────────┘
                                                                  ▲
                                                                  │
                                                            Brugere (browser)
```

- **Frontend**: React + Vite, bygget som en almindelig webapp (ikke en Claude-artifact — den kører uden for Claude's sandkasse, så den kan tale med rigtige eksterne services).
- **Hosting**: Vercel (gratis Hobby-plan). Auto-deployer hver gang der committes til GitHub.
- **Database + login**: Supabase (Postgres-database, indbygget authentication).
- **Fodbolddata**: Sportmonks API (gratis plan, dækker Superligaen).
- **Kildekode**: GitHub-repository `Nikkelajsen/Prediction-Champ`.

Der er ingen npm/Supabase SDK i brug — al kommunikation foregår via almindelige `fetch`-kald til Supabases REST-API (PostgREST) og Auth-API. Det holder projektet enkelt og afhængighedsfrit.

---

## 2. Mappestruktur

```
prediction-champ-webapp/
├── index.html
├── package.json
├── vite.config.js
├── src/
│   ├── main.jsx        (entry point)
│   └── App.jsx          (hele appen — alle komponenter i én fil)
└── api/
    └── sync-matches.js  (Vercel serverless function — kører server-side)
```

`App.jsx` er bevidst holdt som én fil for at gøre det nemt at dele/opdatere kode i denne slags trin-for-trin-forløb. Den kan splittes op i flere filer senere, hvis den vokser sig for stor til at overskue.

---

## 3. Database-skema (Supabase / Postgres)

| Tabel | Formål |
|---|---|
| `leagues` | Ligaer (Superligaen, Superliga Playoff, senere flere). Har `api_league_id` = Sportmonks' egen liga-id. |
| `seasons` | Én sæson pr. liga (fx "2026/27"). |
| `teams` | Hold, tilhører én liga. Har `api_team_id` = Sportmonks' hold-id (udfyldes automatisk af sync-funktionen). |
| `matches` | Kampe. Har `round_key` (beregnes automatisk: tirsdag t.o.m. mandag), `home_score`/`away_score`, `api_fixture_id` (Sportmonks' kamp-id, unik). |
| `profiles` | Brugerprofiler (kobler til Supabases indbyggede `auth.users`). Har `display_name` og `is_admin`. |
| `competitions` | En konkurrence: navn, `mode` (`full_season` / `team` / `time_range`), `mode_params`, `rules` (pointregler), `invite_code`. |
| `competition_participants` | Hvem deltager i hvilken konkurrence. |
| `competition_matches` | Hvilke kampe hører til hvilken konkurrence (udfyldes automatisk ved oprettelse ud fra valgt mode). |
| `predictions` | Én forudsigelse pr. bruger pr. kamp (deles på tværs af konkurrencer). |

**Row Level Security (RLS)** er slået til på alle tabeller. Hovedreglen: alle logget-ind brugere kan læse det meste (holdlister, kampe, andres forudsigelser til brug for stilling), men man kan kun skrive/redigere sine egne data (egen profil, egne forudsigelser).

Alle SQL-migrationer, vi har kørt undervejs, ligger som separate `.sql`-filer, du har fået tilsendt i denne samtale (schema, patch1-6, seed, oprydninger). De er allerede kørt — denne liste er til reference, hvis databasen nogensinde skal genskabes fra bunden.

---

## 4. Nøglebegreber

### Runde-beregning
En runde defineres som **tirsdag t.o.m. mandag**. Det beregnes automatisk ud fra en kamps `kickoff_at`-tidspunkt (en Postgres-funktion `round_key()`), så det ikke skal vedligeholdes manuelt.

### Konkurrence-modes
Når en konkurrence oprettes, vælges én af tre modes, som afgør hvilke kampe der automatisk kobles på:
- **`full_season`**: alle kampe i den valgte sæson
- **`team`**: alle kampe med ét specifikt hold (hjemme og ude)
- **`time_range`**: alle kampe i et valgt datointerval (fx 3 uger)

### Pointberegning
Hver konkurrence har sine egne `rules` (standard: 3 point for korrekt resultat, 1 point for korrekt udfald 1/X/2, 0 for forkert). Beregnes live ud fra forudsigelser + faktiske resultater — intet gemmes som "point" i databasen, det udregnes hver gang.

### Lås af forudsigelser
En forudsigelse låses automatisk **1 time før kickoff**, eller så snart kampen har fået et resultat.

### Liga-filter vs. liga-administration
- **Konkurrencer / Forudsigelser / Stilling**: viser data på tværs af alle ligaer som udgangspunkt. Et filter øverst (afkrydsning) lader dig indsnævre til én eller flere specifikke ligaer.
- **Kampe / Resultater / "Opret ny konkurrence"**: har hver deres egen liga-vælger, da de arbejder med én liga ad gangen.

### Admin-rolle
Kun brugere med `is_admin = true` i `profiles`-tabellen kan se fanerne "Kampe" og "Resultater" (manuel kamp-styring/resultatindtastning). Sættes manuelt via SQL.

---

## 5. Automatisk resultathentning (Sportmonks-sync)

`api/sync-matches.js` er en Vercel-funktion, der:
1. Finder ligaens Sportmonks-id og den ønskede sæson (matcher på navn, fx "2026/2027")
2. Henter alle kampe for den sæson (med pagination, da Sportmonks kun sender 50 ad gangen)
3. **Auto-opdager og opretter hold** ud fra kampenes deltagere — ingen manuel holdliste-vedligeholdelse
4. Udtrækker resultater **kun** når en kamp reelt er slut (`state.short_name` er `FT`, `AET` eller `FT_PEN`) — scoren hentes fra Sportmonks' `CURRENT`-felt
5. Gemmer/opdaterer kampene i Supabase (upsert på `api_fixture_id`, så intet dubleres)

**Kaldes med**: `/api/sync-matches?leagueId=<vores liga-uuid>&smSeason=2026/2027`
**Testtilstand** (skriver intet til databasen): tilføj `&dryRun=true`

### Adgang
Funktionen kræver enten:
- Et gyldigt login-token fra en admin-bruger (bruges automatisk af "Hent resultater nu"-knappen i appen), **eller**
- En hemmelig nøgle via `&secret=...` (bruges af den eksterne automatiske trigger)

### Automatisk kørsel
Da Vercels gratis plan kun tillader automatik én gang i døgnet, bruger vi **cron-job.org** (gratis ekstern tjeneste) til at kalde linket hvert 10.-15. minut. Der skal være ét cron-job pr. liga.

---

## 6. Miljøvariabler (Vercel → Settings → Environments → Production)

| Variabel | Formål |
|---|---|
| `SPORTMONKS_TOKEN` | API-nøgle til Sportmonks |
| `SUPABASE_URL` | Jeres Supabase-projekts URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Privilegeret Supabase-nøgle (kun server-side, aldrig i browseren) |
| `SYNC_SECRET` | Hemmelig nøgle så eksterne cron-kald kan autorisere sig |

---

## 7. Sådan opdaterer du koden

1. Rediger filen direkte på GitHub (blyant-ikon → redigér → commit), **eller** bed Claude om at lave ændringen og indsæt den fulde fil
2. Vercel bygger og deployer automatisk inden for 30-60 sekunder efter en commit
3. Tjek "Deployments"-fanen i Vercel, hvis noget ikke opdaterer sig som forventet

Det faste domæne `https://prediction-champ.vercel.app` peger altid på den seneste deployment — brug aldrig de midlertidige URL'er med tilfældige koder i (de kan være forældede).

---

## 8. Sådan tilføjer du en ny liga (fx Premier League)

1. Find ligaens Sportmonks-id (søg i deres dokumentation, eller spørg Claude om at slå det op)
2. Indsæt en ny række i `leagues` (navn, land, `api_league_id`)
3. Indsæt en sæson-række i `seasons` for den nye liga
4. Kald sync-funktionen med den nye ligas id — den opretter selv holdene ud fra Sportmonks' data
5. Husk at oprette et ekstra cron-job til automatisk opdatering af den nye liga

Ingen kodeændringer nødvendige — hele pointen med arkitekturen er, at nye ligaer er en dataopgave, ikke en programmeringsopgave.

---

## 9. Kendte begrænsninger / ting der kan forbedres senere

- **Superliga Playoff** kan endnu ikke synkroniseres — Sportmonks har ikke oprettet 2026/27-sæsonen for den del endnu (sker formentlig i foråret, når grundspillet er slut)
- Alle logget-ind brugere kan i dag oprette konti uden godkendelse — fint til en lukket venneflok, men værd at revurdere ved bredere lancering
- Ingen "app store"-app — det er en webapp, tilgået via browser (kan evt. "tilføjes til hjemmeskærm" som en PWA-lignende genvej)
- Ingen automatisk sletning/arkivering af meget gamle, afsluttede konkurrencer — de bliver bare liggende

---

## 10. Fejlfindingslog (ting vi har løst undervejs, til reference)

| Symptom | Årsag | Løsning |
|---|---|---|
| "Load failed" i artifact-preview | Claude-artifacts kan ikke lave eksterne netværkskald | Deploy som rigtig webapp på Vercel i stedet |
| "infinite recursion" i Supabase | To RLS-policies tjekkede hinanden cirkulært | Forenklede den ene policy til at tillade alle autentificerede |
| Kampe fra forrige sæson blandet ind | Sync brugte datointerval i stedet for præcis sæson-match | Skiftede til at matche på Sportmonks' eget sæsonnavn |
| Alle resultater var `null` | Antog forkert feltnavn ("FT") for resultater | Sportmonks bruger `description: "CURRENT"` sammen med `state.short_name` for at afgøre om kampen er slut |
| Kunne ikke joine konkurrence med kode | RLS forhindrede opslag på invitationskode, før man var medlem | Åbnede læse-adgang til `competitions` for alle autentificerede |
| Forkerte holdnavne på tværs af ligaer | Holdnavne blev slået op i forkert ligas holdliste | Forudsigelser/Stilling henter nu holdnavne direkte fra kampenes egne data |

---

_Denne fil er en øjebliksbillede-dokumentation. Bed Claude om at opdatere den, når der sker større ændringer._
