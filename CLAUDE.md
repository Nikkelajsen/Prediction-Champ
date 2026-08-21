`DOCUMENTATION.md` er den tekniske sandhed. Den er udtømmende og lang — **læs det afsnit, opgaven kræver, ikke hele filen.** Den har indholdsfortegnelse og markdown-overskrifter, så et enkelt afsnit kan læses for sig.

## Hvor står hvad

| Skal du røre … | Læs |
|---|---|
| arkitektur, mappestruktur, hosting | `DOCUMENTATION.md` §1 |
| database-skema, tabeller, views | §2 (aktuelt skema: `sql/schema.sql`) |
| konkurrence-modes, point, tiebreakers | §3–4 |
| rating, månedschampionship, rundechampionship, championship | §5 · kode i `sql/rating_core.sql` |
| brugernavne | §6 |
| navigation, faner, layout | §7 |
| kampsynkronisering, live-resultater | §8 · `api/sync-matches.js`, `api/sync-live.js` · `docs/features/live-resultater-v1.md` |
| datakilder (Sportmonks / football-data.org), API-nøgler, kaldbudget | §8 · `api/_providers/` · `docs/features/flere-datakilder-v1.md` |
| miljøvariabler, deploy, tjekliste før merge | §9, §11 |
| billederne (installationsprompten, de to link-previews) | §11 · `scripts/screenshots/` · `scripts/build-og-image.mjs` (appens) · `scripts/build-og-image-site.mjs` + `scripts/og-image-site.html` (sitets) · `scripts/chromium.mjs` · `manifest.test.js` — **ændrer du Hjem, Tip, stillingen eller Championship, skal skærmbillederne tages om; ændrer du wordmarket eller sælgesætningen, skal begge OG-billeder bygges om** |
| staging-database (opret, peg preview på den, vedligehold) | `docs/STAGING.md` · §9 |
| testdata: en hel sæson med tips og resultater i staging | `docs/STAGING.md` trin 6b · `sql/dev/simulate_season.sql` |
| ny turnering | §10 · `docs/features/turnering-2.md` |
| kendte begrænsninger (vilkår, der ikke laves om) | §12 |
| noget der ikke er bygget, ryddet op eller besluttet endnu | `docs/BACKLOG.md` |
| en idé du vil have gemt | `docs/BACKLOG.md` — skriv én rå linje i indbakken øverst |
| en fejl, der ligner en, du har set før | §13 (fejlfindingslog) |
| brugerstatistik, aktivitet | §15 |
| push-notifikationer | §16 · `api/send-notifications.js` |
| Story Engine | §17 · `docs/features/story-engine-v3.md` (aktuel) — v1/v2-spec'erne sammesteds er historik |
| liga-laget (grupper) | §18 · `docs/features/liga-laget-v1.md` |
| karriereprofil | §19 · `docs/features/karriereprofil-v1.md` |
| milepæle | §19 · `docs/features/milepaele-v1.md` · `sql/milestones.sql` |
| onboarding | §20 · `docs/features/onboarding-v1.md` |
| invitationsflowet (link-preview, invitationskontekst før login, afsendernavn) | `docs/features/invitationsflow-v1.md` · `api/invite-preview.js` · `sql/invite_preview.sql` |
| analytics og måle-ordbogen | §21 · `docs/features/analytics-v1.md` |
| planlagte jobs (cron) | `docs/CRON.md` |
| mails: afsender, modtager, DNS, skabeloner | `docs/MAIL.md` · `docs/mail/` |
| bot-værn og e-mailbekræftelse ved oprettelse | `docs/OPRETTELSE.md` · `docs/features/opret-flow-v2.md` · `src/lib/turnstile.js` · `src/lib/data/profile.js` |
| hjemmesiden (marketing-sitet på `leagly.app`) | `site/` · `docs/features/hjemmeside-v1.md` · `docs/DOMAENE.md` |
| domæner: hvilken adresse hører til hvad, og hvad der skal flyttes med | `docs/DOMAENE.md` · `vercel.json` |
| søgemaskiner: sitemap, robots, hvorfor appen er `noindex` — **og hvorfor et `Disallow` på appen slukker invitationernes link-preview** | `docs/SEO.md` · `seo.test.js` · `public/robots.txt` · `site/robots.txt` |
| en todelt migrering, der skal følges ad med en udrulning | `docs/UDRULNING-A40.md` og `docs/UDRULNING-A43.md` (begge afsluttede — anden forekomst gjorde formen til et mønster) · `sql/invite_lookup.sql`/`sql/invite_policies.sql` · `sql/read_scope_functions.sql`/`sql/read_scope_narrow.sql` |
| backup, gendannelse efter tabt data | `docs/RESTORE.md` · §22 · `.github/workflows/data-backup.yml` |
| feedback fra brugerne | §23 · `sql/feedback.sql` · `src/screens/FeedbackCard.jsx` |
| privatliv, vilkår, kontolukning | §24 · `src/lib/legal.js` · `api/delete-account.js` · `docs/features/privatliv-og-vilkaar-v1.md` |
| fejl hos en bruger (crash, hvid skærm) | §25 · `src/lib/telemetry.js` · `sql/client_errors.sql` |
| historik over ændringer | `docs/CHANGELOG.md` |
| ældre gennemgange og aflæsninger, der citeres som belæg | `docs/reviews/` |

Ved produktbeslutninger og nye features læses desuden:
- `docs/PRODUCT_BOOK.md` — produktfilosofi (hvorfor produktet findes, og hvilke principper der beskytter dets identitet).
- `docs/ROADMAP.md` — status og prioritering: hvad er leveret, hvad er næste.
- `docs/BACKLOG.md` — alt det uafklarede: **åbne** beslutninger, ubyggede opgaver, teknisk gæld og ideer. Hører sammen med ROADMAP'en — status i den ene, det manglende i den anden. Afgjorte beslutninger ligger i `docs/DECISIONS.md`; slå kun op der, når du skal vide *hvorfor* noget blev, som det blev.
- relevant spec i `docs/features/` — fuld feature-specifikation før implementering.

## Når noget leveres

Når en feature leveres eller en beslutning træffes, opdatér **alle tre**:
- `docs/ROADMAP.md` (status og prioritering) — og skriv **beslutningen** i `docs/DECISIONS.md`, **leverancen** i `docs/CHANGELOG.md`. Hver af de to hører præcis ét sted; ROADMAP'en bar indtil `G70` (5. august 2026) en kopi af beslutningsloggen og gør det ikke længere,
- `docs/BACKLOG.md` — **slet** de rækker, leverancen lukker, og ryd indbakken, og
- den relevante spec i `docs/features/`, hvis den leverede adfærd afviger fra det, spec'en beskriver.

Det sidste punkt er lige så vigtigt som det første: en spec beskriver, hvad der var *planlagt*, og bliver forkert i det øjeblik leverancen afviger — eller senere rulles tilbage. Markér rettelser efter levering tydeligt i spec'en frem for at slette udkastet, så det fremgår, at noget blev ændret undervejs.

Backloggen er den ene fil, hvor der **slettes** frem for streges ud: arkivet findes allerede i `DECISIONS.md` og `CHANGELOG.md`, og en liste, der kun vokser, holder op med at kunne skimmes. Undtagelsen er en idé, der forkastes — den får en linje i "Forkastede ideer", fordi den ellers bliver foreslået igen.

Støder du undervejs på noget, der burde bygges, ryddes op eller besluttes, men som ligger uden for opgaven, så skriv én linje i backloggens indbakke frem for kun at nævne det i svaret. **Udvid ikke opgaven — notér den.**

## Kommandoer

- `npm run dev` — udviklingsserver · `npm run build` — produktions-build
- `npm run harness` — hele appen mod en attrap-database, uden Supabase og uden nøgler (`I24`). Til at se en skærm, der kræver data, uden at have et projekt ved hånden; `npm run screenshots` bruger den samme harness til PNG'erne i `public/screenshots/`.
- `npm test` — Vitest · `npm run lint` — ESLint · `npm run format` — Prettier
- CI (`.github/workflows/ci.yml`) kører lint + test + build ved hver pull request og ved push til `main`, plus et `sql`-job med seksogfyrre SQL-tests (bl.a. rating-ækvivalensen, alle fem overvågnings-kontroller i `sql/checks/`, aflæsningen bag `A33`/`A35` og et tjek af `docs/`' SQL-blokke) mod en rigtig PostgreSQL. **"Tjekliste før merge" i `DOCUMENTATION.md` §11 gælder stadig** — den dækker det, en maskine ikke kan se (rigtig browser, push på iOS, RLS mod produktionsdata).
- `npm run lint` har et loft på antal advarsler, så tallet kan falde, men aldrig vokse ubemærket. Falder det, sænkes loftet i `package.json` tilsvarende.
- **Venter du på CI, så brug to endpoints til hver sit — og stol ikke på ét.** GitHubs check-runs-svar kan stå `in_progress` et kvarter efter et job er færdigt; `actions_get`/`get_workflow_job` med job-id'et viser hvert trins tidsstempler, altså **hvor langt** den er, men kan selv stå frosset i minutter (`G128`), mens `get_check_run` på samme job-id er den, der beviseligt opdaterede — altså **om** den er færdig. Hele fælden står i `DOCUMENTATION.md` §13. `verify` tager typisk under et minut, `sql` halvandet; er du ude over det, er det næsten altid svaret der er gammelt — og får du det samme svar to gange, er det ikke en bekræftelse.

## Planlagte jobs

`docs/CRON.md` er registeret over de planlagte jobs. Jobbene selv kører på cron-job.org uden for repoet, så registeret er kun sandt, hvis det vedligeholdes — opretter eller ændrer du et job, så ret tabellen i samme ombæring. Kørslerne logges i `job_runs` og kan aflæses i Admin → Drift.

## SQL

Migreringerne i `sql/` køres **manuelt** i Supabase SQL-editor med "Run without RLS". De er idempotente, men flere af dem ruller tavst nyere regler tilbage, hvis de gen-køres — læs filindekset og advarslen i `sql/README.md`, før du kører noget.

**`#56` er en migrering, ikke en pull request.** Nummeret er kolonne 1 i filoversigten i [`sql/README.md`](./sql/README.md), hvor filnavnene er links — slå op dér, eller kør `grep -n "^| 56 " sql/README.md`. Numrene genbruges aldrig og omnummereres aldrig, så de er stabile navne. **Skriver du et nummer i chat eller i en commit-besked, så skriv filnavnet med** (`#56 anon_grants_functions.sql`): tallet alene kan kun slås op af en, der har repoet åbent.

`sql/schema.sql` er et **genereret** øjebliksbillede (skema-eksport-workflowen), aldrig en fil man redigerer i hånden. Den er kun en gyldig reference, når eksporten er kørt efter seneste migrering.

Ændrer du ratingberegningen, fanger `sql/tests/rating_equivalence.sql` i CI, om tallene flytter sig. Skal de flytte sig med vilje, er det den frosne reference i samme mappe, der skal opdateres — og den opdatering er så selve beslutningen.
