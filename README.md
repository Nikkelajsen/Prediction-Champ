# Prediction Champ

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
npm run dev          # http://localhost:5173
```

Appen kører **uden opsætning**: `src/lib/supabase.js` har produktionens URL og
den offentlige `publishable`-nøgle som fallback. Nøglen er offentlig by design og
beskyttet af RLS.

> ⚠️ **Det betyder også, at `npm run dev` uden videre skriver i PRODUKTIONSDATA.**
> Vil du undgå det, skal du oprette et Supabase-projekt og pege dertil — se
> [`.env.example`](.env.example) og `DOCUMENTATION.md` §9. Der findes i dag ingen
> seed-SQL til en tom database, så en tom staging er ikke et brugbart alternativ
> endnu (`G4` i backloggen).

### Miljøvariabler

| Variabel | Hvor | Hvornår |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` | `.env.local` / Vercel | Kun for at pege på en anden database end produktion |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Vercel | Kræves af alt i `api/` |
| `SYNC_SECRET` | Vercel | Den delte hemmelighed, cron-jobbene kalder med |
| `SPORTMONKS_TOKEN`, `FOOTBALLDATA_TOKEN` | Vercel | Én pr. datakilde; kun den, ligaen bruger |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Vercel | Push-notifikationer (`npx web-push generate-vapid-keys`) |

Fuld tabel med formål og fald-tilbage: `DOCUMENTATION.md` §9.

## Kommandoer

```bash
npm run dev          # udviklingsserver
npm run build        # produktions-build
npm test             # Vitest (én kørsel)
npm run test:watch   # Vitest i watch
npm run coverage     # dækningsrapport
npm run lint         # ESLint (loft på antal advarsler — det må falde, aldrig vokse)
npm run format       # Prettier
```

CI (`.github/workflows/ci.yml`) kører lint + test + build ved hver pull request,
plus en SQL-ækvivalenstest for ratingberegningen mod en rigtig PostgreSQL.
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
                             │
                    React-app (Vercel)
```

| Mappe | Hvad |
|---|---|
| `src/lib/` | Data-loadere, point/runde-logik, analytics, REST-klient. Ingen React |
| `src/ui/` | Designtokens og delkomponenter |
| `src/screens/` | Én fil pr. fane/skærm + `MainApp.jsx` som skal |
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
4. **`/api/*` findes ikke i `npm run dev`.** Der er ingen Vite-proxy; brug
   `npx vercel dev`, eller test mod en preview-deploy.
5. **Vercels Hobby-plan tillader 12 serverless functions.** Hver `.js`-fil under
   `api/` uden `_`-præfiks tæller med. Rammes loftet, fejler deployet på 11
   sekunder uden byggelog — og appen kører videre på forrige version, så `main`
   og produktion er ikke det samme.

## Licens

Ingen licens angivet. Alle rettigheder forbeholdes.
