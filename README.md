# Leagly

Gæt resultater mod dine venner. Opret en liga, tip ugens kampe, og se hvem der
er bedst.

En mobil-først PWA i React + Vite oven på Supabase, med serverless-funktioner på
Vercel til kampsynkronisering og push-notifikationer. Ingen SDK'er — kun `fetch`.

**Live:** <https://prediction-champ.vercel.app>

---

## Kom i gang

```bash
git clone https://github.com/Nikkelajsen/Prediction-Champ.git
cd Prediction-Champ
npm install
cp .env.example .env.local   # udfyld de to VITE_SUPABASE_*-variabler
npm run dev          # http://localhost:5173
```

**`.env.local` er påkrævet fra 3. august 2026 (`G4`).** Før faldt appen tavst
tilbage på produktionens URL og den offentlige `publishable`-nøgle, så enhver
lokal udvikling skrev direkte i produktionsdata — uden at sige det. Nøglen er
offentlig by design og beskyttet af RLS, så det farlige var ikke adgangen, men
tavsheden: et halvfærdigt tip eller en test-liga er lige så virkelig for de
rigtige brugere, som hvis den var lavet i appen. `src/lib/supabase.js` kaster nu
i stedet, så valget skal træffes.

> ⚠️ **Peger du på produktion, skriver du i produktionsdata.** Det er stadig det
> eneste rigtige svar, indtil et staging-projekt findes — der er i dag ingen
> seed-SQL til en tom database — men det er nu et bevidst valg. Værdierne står i
> `DOCUMENTATION.md` §9. I et produktions-build gælder fallbacken uændret: Vercel
> sætter ikke variablerne, og dér SKAL appen pege på produktion.

### Miljøvariabler

| Variabel | Hvor | Hvornår |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` | `.env.local` / Vercel | Påkrævet i lokal udvikling siden `G4` (`npm run dev` kaster uden dem); i produktions-buildet bruges den indbyggede nøgle, hvis de udelades |
| `VITE_API_PROXY` | `.env.local` | Valgfri; videresender `/api/*` i `npm run dev` til en kørende deploy |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Vercel | Kræves af alt i `api/` |
| `SYNC_SECRET` | Vercel | Den delte hemmelighed, cron-jobbene kalder med |
| `SPORTMONKS_TOKEN`, `FOOTBALLDATA_TOKEN` | Vercel | Én pr. datakilde; kun den, ligaen bruger |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Vercel | Push-notifikationer (`npx web-push generate-vapid-keys`) |

Fuld tabel med formål og fald-tilbage: `DOCUMENTATION.md` §9.

## Kommandoer

```bash
npm run dev          # udviklingsserver
npm run dev:api      # vercel dev — /api/* lokalt
npm run build        # produktions-build
npm test             # Vitest (én kørsel)
npm run test:watch   # Vitest i watch
npm run coverage     # dækningsrapport
npm run lint         # ESLint (loft på antal advarsler — det må falde, aldrig vokse)
npm run format       # Prettier
```

CI (`.github/workflows/ci.yml`) kører lint + test + build ved hver pull request
og ved push til `main`, plus et `sql`-job med ti SQL-tests (bl.a.
rating-ækvivalensen) mod en rigtig PostgreSQL.
**Den erstatter ikke "Tjekliste før merge" i `DOCUMENTATION.md` §11**, som dækker
det, en maskine ikke kan se: rigtig browser, push på iOS, safe-area på iPhone,
RLS mod produktionsdata.

Node 22 (se `.nvmrc`).

## Sådan hænger det sammen

```
Sportmonks / football-data.org
        │
        ▼
  api/sync-matches.js ──► Supabase (Postgres + Auth + RLS)
  api/sync-live.js           ▲
  api/send-notifications.js  │
  api/delete-account.js      │   (kontolukning, B4)
                             │
                    React-app (Vercel)
```

| Mappe | Hvad |
|---|---|
| `src/lib/` | Data-loadere, point/runde-logik, analytics, REST-klient. Ingen React |
| `src/ui/` | Designtokens og delkomponenter |
| `src/screens/` | Én fil pr. fane/skærm + `MainApp.jsx` som skal; fem undermapper (`analytics/`, `championship/`, `create/`, `predictions/`, `profile/`) efter opsplitningen (`G1`) |
| `api/` | Serverless-funktioner. **Kun endpoints ligger uden `_`-præfiks** — `_shared.js`, `_backfill.js` og `_providers/` er biblioteker, som Vercel derfor ikke router |
| `sql/` | Migreringer, der køres **manuelt** i Supabase SQL-editor med "Run without RLS". **Læs `sql/README.md` først** — to af dem ruller tavst nyere regler tilbage, hvis de gen-køres |
| `docs/` | Se nedenfor |

Ingen router: navigation er `useState` i `MainApp.jsx`. Det er et bevidst valg —
se `A23` i backloggen for hvad det koster.

## Hvor står hvad

Dokumentationen er delt op efter, hvilken vej den peger:

| Fil | Hvad |
|---|---|
| [`DOCUMENTATION.md`](DOCUMENTATION.md) | **Den tekniske sandhed.** Udtømmende og lang — læs det afsnit, opgaven kræver. Har indholdsfortegnelse |
| [`docs/PRODUCT_BOOK.md`](docs/PRODUCT_BOOK.md) | Hvorfor produktet findes, og hvilke principper der beskytter dets identitet |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Status og prioritering: hvad er leveret, hvad er næste |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | Alt det uafklarede: åbne beslutninger, ubygget, teknisk gæld, ideer. **Peger kun fremad** |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Hvorfor noget blev, som det blev. Peger kun bagud |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | Hvad der er ændret hvornår |
| [`docs/CRON.md`](docs/CRON.md) | Registeret over de planlagte jobs. **Jobbene kører uden for repoet**, så filen er kun sand, hvis den vedligeholdes |
| [`docs/features/`](docs/features/) | Fuld specifikation pr. feature |
| [`CLAUDE.md`](CLAUDE.md) | Arbejdsregler for AI-agenter i repoet — ikke opsætning |

Er du ny: læs dette dokument, så `DOCUMENTATION.md` §1 (arkitektur), og slå
resten op efter behov.

## Ting, der overrasker

Fem vilkår, der har kostet tid før, og som ikke er til at gætte:

1. **Migreringerne i `sql/` køres i hånden.** Der er ingen migrations-runner. Kør
   dem med "Run without RLS", og læs advarslen i `sql/README.md` først.
2. **`sql/schema.sql` er genereret** af en workflow, aldrig redigeret. Den er kun
   en gyldig reference, hvis eksporten er kørt efter seneste migrering.
3. **Cron-jobbene bor på cron-job.org**, ikke i repoet. `docs/CRON.md` er listen,
   man holder kontoen op imod.
4. **`/api/*` findes ikke i `npm run dev` som udgangspunkt.** Brug
   `npm run dev:api` (`vercel dev`), eller sæt `VITE_API_PROXY=<url>` i
   `.env.local` for at videresende `/api/*` til en kørende deploy
   (`vite.config.js`).
5. **Vercels Hobby-plan tillader 12 serverless functions.** Hver `.js`-fil under
   `api/` uden `_`-præfiks tæller med. Rammes loftet, fejler deployet på 11
   sekunder uden byggelog — og appen kører videre på forrige version, så `main`
   og produktion er ikke det samme.

## Licens

Ingen licens angivet. Alle rettigheder forbeholdes.
