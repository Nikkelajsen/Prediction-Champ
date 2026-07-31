`DOCUMENTATION.md` er den tekniske sandhed. Den er udtømmende og lang — **læs det afsnit, opgaven kræver, ikke hele filen.** Den har indholdsfortegnelse og markdown-overskrifter, så et enkelt afsnit kan læses for sig.

## Hvor står hvad

| Skal du røre … | Læs |
|---|---|
| arkitektur, mappestruktur, hosting | `DOCUMENTATION.md` §1 |
| database-skema, tabeller, views | §2 (aktuelt skema: `sql/schema.sql`) |
| konkurrence-modes, point, tiebreakers | §3–4 |
| rating, månedsliga, rundeliga, championship | §5 · kode i `sql/rating_core.sql` |
| brugernavne | §6 |
| navigation, faner, layout | §7 |
| kampsynkronisering, live-resultater | §8 · `api/sync-matches.js`, `api/sync-live.js` |
| miljøvariabler, deploy, tjekliste før merge | §9, §11 |
| ny turnering | §10 · `docs/features/turnering-2.md` |
| kendte begrænsninger og teknisk gæld | §12 |
| en fejl, der ligner en, du har set før | §13 (fejlfindingslog) |
| brugerstatistik, aktivitet | §15 |
| push-notifikationer | §16 · `api/send-notifications.js` |
| Story Engine | §17 · `docs/features/story-engine-v1.md` |
| liga-laget (grupper) | §18 · `docs/features/liga-laget-v1.md` |
| karriereprofil | §19 · `docs/features/karriereprofil-v1.md` |
| onboarding | §20 · `docs/features/onboarding-v1.md` |
| analytics og måle-ordbogen | §21 · `docs/features/analytics-v1.md` |
| planlagte jobs (cron) | `docs/CRON.md` |
| historik over ændringer | `docs/CHANGELOG.md` |

Ved produktbeslutninger og nye features læses desuden:
- `docs/PRODUCT_BOOK.md` — produktfilosofi (hvorfor produktet findes, og hvilke principper der beskytter dets identitet).
- `docs/ROADMAP.md` — status, prioritering og **åbne** beslutninger. Afgjorte beslutninger ligger i `docs/DECISIONS.md`; slå kun op der, når du skal vide *hvorfor* noget blev, som det blev.
- relevant spec i `docs/features/` — fuld feature-specifikation før implementering.

## Når noget leveres

Når en feature leveres eller en beslutning træffes, opdatér **både**:
- `docs/ROADMAP.md` (status + beslutningslog), og
- den relevante spec i `docs/features/`, hvis den leverede adfærd afviger fra det, spec'en beskriver.

Det andet punkt er lige så vigtigt som det første: en spec beskriver, hvad der var *planlagt*, og bliver forkert i det øjeblik leverancen afviger — eller senere rulles tilbage. Markér rettelser efter levering tydeligt i spec'en frem for at slette udkastet, så det fremgår, at noget blev ændret undervejs.

## Kommandoer

- `npm run dev` — udviklingsserver · `npm run build` — produktions-build
- `npm test` — Vitest · `npm run lint` — ESLint · `npm run format` — Prettier
- CI (`.github/workflows/ci.yml`) kører lint + test + build ved hver pull request og ved push til `main`, plus en SQL-ækvivalenstest for ratingberegningen mod en rigtig PostgreSQL. **"Tjekliste før merge" i `DOCUMENTATION.md` §11 gælder stadig** — den dækker det, en maskine ikke kan se (rigtig browser, push på iOS, RLS mod produktionsdata).
- `npm run lint` har et loft på antal advarsler, så tallet kan falde, men aldrig vokse ubemærket. Falder det, sænkes loftet i `package.json` tilsvarende.

## Planlagte jobs

`docs/CRON.md` er registeret over de planlagte jobs. Jobbene selv kører på cron-job.org uden for repoet, så registeret er kun sandt, hvis det vedligeholdes — opretter eller ændrer du et job, så ret tabellen i samme ombæring. Kørslerne logges i `job_runs` og kan aflæses i Admin → Drift.

## SQL

Migreringerne i `sql/` køres **manuelt** i Supabase SQL-editor med "Run without RLS". De er idempotente, men to af dem ruller tavst nyere regler tilbage, hvis de gen-køres — læs filindekset og advarslen i `sql/README.md`, før du kører noget.

`sql/schema.sql` er et **genereret** øjebliksbillede (skema-eksport-workflowen), aldrig en fil man redigerer i hånden. Den er kun en gyldig reference, når eksporten er kørt efter seneste migrering.

Ændrer du ratingberegningen, fanger `sql/tests/rating_equivalence.sql` i CI, om tallene flytter sig. Skal de flytte sig med vilje, er det den frosne reference i samme mappe, der skal opdateres — og den opdatering er så selve beslutningen.
