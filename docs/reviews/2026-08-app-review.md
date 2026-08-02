# Gennemgang af Prediction-Champ — app og dokumentation (august 2026)

> Ende-til-ende, evidensbaseret gennemgang bestilt 1. august 2026. Ren analyse:
> **ingen kode, dokumentation, konfiguration, data eller eksterne systemer er ændret**
> under gennemgangen — kun denne rapportfil er tilføjet.
>
> Alle fil:linje-referencer er mod repoets tilstand ved commit `7692a2f`
> (branch `claude/app-documentation-review-m9cnsx`). Hvor en påstand er
> bekræftet ved at køre projektets egne kommandoer eller ved at læse den
> nævnte linje, står det som **verificeret**.

## Indhold

1. [Resumé](#1-resumé)
2. [Metode og evidensgrundlag](#2-metode-og-evidensgrundlag)
3. [Sikkerhed og risici](#3-sikkerhed-og-risici)
4. [Uoverensstemmelser: dokumentation vs. virkelighed](#4-uoverensstemmelser-dokumentation-vs-virkelighed)
5. [Fejl, mangler og teknisk gæld](#5-fejl-mangler-og-teknisk-gæld)
6. [Testdækning](#6-testdækning)
7. [Arkitektur og kodekvalitet](#7-arkitektur-og-kodekvalitet)
8. [Performance](#8-performance)
9. [Tilgængelighed](#9-tilgængelighed)
10. [UX, DX og drift](#10-ux-dx-og-drift)
11. [Prioriteret handlingsliste](#11-prioriteret-handlingsliste)

---

## 1. Resumé

Prediction-Champ er en gennemarbejdet, usædvanligt veldokumenteret hobby-app: en
dansk fodbold-tipkonkurrence som PWA (React 18 + Vite, håndrullet PostgREST-klient
mod Supabase, fire serverless-funktioner på Vercel, al forretningslogik i Postgres).
Kodedisciplinen er høj — beslutnings-id'er i kommentarer, en backlog med bevidst
sletning-ved-lukning, en SQL-ækvivalenstest i CI, og en fejlfindingslog. Det er ikke
en app med kaos; det er en app, hvor dokumentationen er vokset hurtigere end den kan
holdes synkron, og hvor et par RLS-huller lever ubemærket under et ellers stramt
sikkerhedslag.

**De vigtigste fund, efter alvorlighed:**

| # | Alvorlighed | Fund | Reference |
|---|---|---|---|
| S1 | 🔴 Høj | Enhver indlogget bruger kan skrive kampresultater (`matches` INSERT/UPDATE åben for `authenticated`, UPDATE uden `WITH CHECK`) → point, stillinger og rating kan manipuleres. **LUKKET august 2026** (`G14`, `sql/security_hardening.sql`): skrivning er nu admin- eller `service_role`-only, og UPDATE har `with check`. | `sql/schema.sql:3642,3885,4121` |
| S2 | 🔴 Høj | `recompute_ratings()` er `SECURITY DEFINER` uden admin-tjek og givet til `anon` → uautentificeret DB-dækkende genberegning kan udløses gentagne gange. **LUKKET august 2026** (`G15`): motoren er `service_role`-only, Admin går gennem wrapperen `admin_recompute_ratings()` med `is_admin`-tjek. | `sql/rating_core.sql:261` |
| S3 | 🔴 Høj | `monthly_standings` mangler `security_invoker` og er givet til `anon` → uautentificeret læsning af per-bruger månedspoint. **LUKKET august 2026** (`G16`): viewet har `security_invoker = on` som de to andre stillings-views. | `sql/tournament_scope.sql:110,170` |
| S4 | 🟠 Mellem | Runderesultat-notifikationen læser `round_standings` uden `scope`-filter → forkert "nr. X af N" (allerede kendt som G9). | `api/send-notifications.js:196` |
| S5 | 🟠 Mellem | Claimed-but-unsent notifikationer tabes permanent ved funktions-timeout (sekventiel send-loop, ingen genforsøg). | `api/send-notifications.js:243-296` |
| D1 | 🟠 Mellem | Dokumentationen er på flere punkter faktuelt forkert: testtal, linjetal, metrik-tal, lint-loft, sync-kadence (fire forskellige svar), analytics-sektioner (fire vs. seks). | §4 |
| T1 | 🟠 Mellem | De tre rigtige HTTP-handlere (`sync-matches`, `sync-live`, `send-notifications`) og hele navigations-/auth-laget (`MainApp`, `App`, `Auth`) er uden tests. | §6 |
| Q1 | 🟡 Lav | `rules`-feltet trådes gennem hele frontenden, men `pc_points()` hardkoder 3/1/0 — en antydet konfigurerbarhed, der ikke findes (kendt som G3). | `sql/rating_core.sql:116-118` |

Sikkerhedshullerne S1–S3 var de eneste fund, der burde handles på hurtigt: de var
udnyttelige af enhver, der har den offentlige `publishable`-nøgle, som er indbygget
i den udsendte bundle (`src/lib/supabase.js:7-8`). **Alle tre er lukket i august
2026** med `sql/security_hardening.sql` og dækket af `sql/tests/security_hardening.sql`
i CI; beskrivelserne nedenfor er bevaret, som de blev skrevet, med et
LUKKET-afsnit til sidst. Resten er kvalitet, gæld og dokumentationshygiejne —
reelt, men ikke akut.

---

## 2. Metode og evidensgrundlag

Gennemgangen dækkede tre lag parallelt — frontend (`src/`), backend (`api/` + `sql/`)
og hele dokumentationskorpuset (`DOCUMENTATION.md`, `docs/`, `docs/features/`) — og
verificerede derefter de mest belastende påstande direkte mod koden.

**Kommandoer kørt (ændrer intet i repoet):**

| Kommando | Resultat |
|---|---|
| `npm ci` | Rene deps installeret (Node 22, npm 10). |
| `npm run lint` | **0 fejl, 23 advarsler** — præcis på loftet `--max-warnings 23`. Nul headroom: én ny advarsel bryder CI. |
| `npm test` (`vitest run`) | **22 testfiler, 476 cases, alle grønne**, 3,1 s. |
| `npm run build` | Grøn. Én chunk: `dist/assets/index-*.js` **412,71 kB (gzip 120,96 kB)**, ingen code-splitting. |

De tre tal (23 advarsler, 22/476 tests, 412 kB bundle) er hårde beviser og bruges i
§4 og §8. Alt markeret **verificeret** i denne rapport er læst på den citerede linje.
Fund uden den markering er observationer fra kortlægningen, som en læser selv kan
efterprøve via referencen.

**Afgrænsning:** Ingen browser-test på rigtig enhed, ingen iOS-push-test, ingen RLS-
test mod produktionsdata — de tre ting, `DOCUMENTATION.md` §11's tjekliste selv
udpeger som maskinusynlige. Sikkerhedsfundene S1–S3 er læst i SQL-kilden, ikke
demonstreret mod den kørende database (det ville kræve at røre et eksternt system).

---

## 3. Sikkerhed og risici

Sikkerhedsmodellen hviler bevidst på RLS: den håndrullede klient bygger PostgREST-
forespørgsler ved streng-sammensætning af bruger-input, og den offentlige
`publishable`-nøgle er indbygget i bundlen (`src/lib/supabase.js:7-8`, dokumenteret
og tilsigtet). Det betyder, at **RLS er den eneste barriere** — og at ethvert hul i
RLS er udnyteligt af enhver, der åbner udviklerværktøjerne. Auth-laget på
serverless-funktionerne er derimod solidt: én fælles `isAuthorized`-gate
(`api/_shared.js:139`), konstant-tids-sammenligning af hemmeligheder (`secretsMatch`,
`:119`), og admin-funktioner i SQL med `is_admin`-guard. Hullerne sidder i data-
laget, ikke i job-laget.

### 🔴 S1 — `matches` kan skrives af enhver indlogget bruger — **verificeret**

```
sql/schema.sql:3642  CREATE POLICY "insert matches" ON public.matches
                       FOR INSERT WITH CHECK ((auth.role() = 'authenticated'));
sql/schema.sql:3885  CREATE POLICY "update matches" ON public.matches
                       FOR UPDATE USING ((auth.role() = 'authenticated'));
sql/schema.sql:4121  GRANT ALL ON TABLE public.matches TO authenticated;
```

Enhver bruger med en gyldig session (dvs. enhver, der har oprettet en konto) kan sætte
`home_score`/`away_score` på en hvilken som helst kamp via et direkte PostgREST-kald.
Det tildeler point, flytter alle stillinger og udløser rating-genberegningstriggeren
(`sql/schema.sql:3265`). UPDATE-policyen har desuden **ingen `WITH CHECK`**, så der er
ikke engang en begrænsning på, hvad rækken ændres til. Disse er de ældste policies i
skemaet, og ingen migrering i `sql/` strammer dem. `DOCUMENTATION.md` §12 ("kendte
begrænsninger") nævner dem ikke.

**Anbefaling:** Skriveadgang til `matches` bør være `service_role`-only (syncen bruger
allerede service-nøglen) eller gated på `is_admin` (Admin-skærmen skriver resultater).
Klient-roller (`anon`, `authenticated`) bør kun have SELECT.

**✅ LUKKET august 2026** — `sql/security_hardening.sql` (`G14`). `is_admin`-vejen
blev valgt frem for `service_role`-only, fordi Admin-skærmen skriver med brugerens
eget token og knappen i forvejen kun vises for `profile.is_admin`; policyen
håndhæver nu i databasen, hvad brugerfladen antog. UPDATE har fået `with check`,
og INSERT/UPDATE/DELETE er revoked fra `anon`. Undersøgt i samme ombæring: `teams`,
`seasons` og `leagues` har samme brede grants, men ingen skrive-policies, så RLS
afviser dem allerede — `matches` var det eneste hul.

### 🔴 S2 — `recompute_ratings()` er en uautentificeret skrive-/CPU-forstærker — **verificeret**

```
sql/rating_core.sql:261  grant all on function public.recompute_ratings()
                           to anon, authenticated, service_role;
```

Funktionen er `SECURITY DEFINER` (`sql/rating_core.sql:165-168`) og har — modsat alle
`admin_*`-funktioner — **intet `is_admin`-tjek**. Den sletter og genopbygger hele
`ratings` og `rating_history` fra runde nul, og koster ifølge filens egne målinger op
mod ~1 s ved 150 spillere. Et uautentificeret `POST /rest/v1/rpc/recompute_ratings`
(anon-nøglen ligger i bundlen) er dermed en gratis, gentagelig DB-dækkende skrivning
plus CPU-forstærker. Til sammenligning er `prune_job_runs` korrekt `service_role`-only
(`sql/job_runs.sql:117`), og `generate_stories(text)` er dog kun givet til
`authenticated, service_role` (`sql/story_engine.sql:553`) — samme mønster, men uden
`anon`.

**Anbefaling:** Fjern `anon` (og formentlig `authenticated`) fra grant'en, eller læg et
`is_admin`-tjek ind i funktionen. Syncen kalder den via `service_role`.

**✅ LUKKET august 2026** — `sql/security_hardening.sql` (`G15`). Begge dele, men
ikke inde i motoren: `recompute_ratings()` er revoked fra `public`, `anon` og
`authenticated` og kun givet til `service_role`, mens `is_admin`-tjekket ligger i
den nye wrapper `admin_recompute_ratings()`, som Admin-skærmen kalder. Motorens krop
er urørt med vilje — den er frosset af `sql/tests/rating_equivalence.sql`, og et
adgangsproblem skal ikke koste en ændring i en funktion, hvis tal er under test.
To detaljer viste sig undervejs: revoke'en skal ramme pseudorollen `PUBLIC` (ellers
lukker den ingenting), og rating-triggeren måtte gøres `security definer`, da den
kører som skriveren og ellers ville få admins egen resultat-rettelse til at fejle.

### 🔴 S3 — `monthly_standings` lækker per-bruger-data til uautentificerede — **verificeret**

```
sql/tournament_scope.sql:110  create view public.monthly_standings as …   (uden security_invoker)
sql/tournament_scope.sql:170  grant select on public.monthly_standings to anon, authenticated, service_role;
```

Viewet oprettes **uden** `security_invoker`, hvilket betyder, at det kører med ejerens
rettigheder og omgår RLS på de underliggende `predictions`. Kombineret med `grant …
to anon` kan en uautentificeret kaldende læse per-bruger månedspoint. Kontrasten er
tydelig i samme fil: `round_standings` og `season_standings` sætter `security_invoker
= on` (`sql/tournament_scope.sql:65`) og returnerer derfor intet til `anon`. At
`monthly_standings` mangler det, ligner en forglemmelse snarere end et valg — omend
`sql/standings_tiebreakers.sql:33-37` beskriver ikke-invoker som bevidst for
performance. (`analytics_*`-viewene springer også `security_invoker` over, men er
korrekt revoked fra klient-roller — `sql/analytics_dashboard.sql:66-68` — så de er
ikke eksponeret.)

**Anbefaling:** Enten sæt `security_invoker = on` på `monthly_standings` som på de to
andre standings-views, eller revoke SELECT fra `anon`.

**✅ LUKKET august 2026** — `sql/security_hardening.sql` (`G16`). `security_invoker
= on`, så viewet nu opfører sig som de to andre. Bemærkningen om
`standings_tiebreakers.sql:33-37` holdt ikke ved nærlæsning: kommentaren dér siger,
at DEN migrering ikke rørte adgangsregler — ikke at fraværet var et performance-valg.
Ingen indlogget bruger ser andre tal, fordi viewet kun tæller kampe med resultat, og
præcis de tips er synlige for enhver authenticated bruger via `predictions_select_visible`.

### 🟠 S4 — Runderesultat-notifikation uden `scope`-filter (kendt som G9) — **verificeret**

`api/send-notifications.js:196` læser `round_standings` uden `&scope=eq.ALL`. Siden
`tournament_scope.sql` (31. juli 2026) giver viewet én række pr. `(round_key, scope,
user_id)` — `'ALL'` plus én pr. officiel turnering — optræder en bruger, der har
tippet i to turneringer, tre gange i `board`. Resultat: `board.length` er oppustet,
"du blev nr. X af N" er forkert, og `assignRanks` rangerer på tværs af scopes. Dette
er allerede korrekt diagnosticeret som **G9** i `docs/BACKLOG.md:81` (en regression,
ikke et designvalg) — det står her, fordi det er en aktiv brugervendt fejl, ikke kun
gæld.

### 🟠 S5 — Claimed-but-unsent notifikationer tabes ved timeout — **verificeret**

Idempotensen i notifikationsjobbet er ellers gennemtænkt: den *claim-before-send* mod
`notification_log` med `ignore-duplicates` (`api/send-notifications.js:243-256`) er en
ægte race-garanti. Men den uafdækkede variant er en **timeout**: send-loopet
(`:267-296`) er fuldstændig sekventielt over beskeder × abonnementer, uden
concurrency-loft, uden `AbortController`, og uden per-besked `try/finally`. Rammer
Vercel-funktionen sin vægurs-grænse midt i loopet, er hver resterende claimet række
tabt for altid — ingen senere kørsel genforsøger dem (rækken *findes* jo i
`notification_log`), og `recordRun` når heller ikke at skrive job-rækken.

### 🟠 / 🟡 Øvrige backend-risici

- **Hemmelighed i query-string (A11, kendt).** `api/_shared.js:145` accepterer
  `?secret=` som fallback; den lander i cron-/Vercel-logs. Mitigeret af et `[A11]`-
  warn (`:150-152`), og `docs/CRON.md` markerer jobs 1–3's transport som `?`
  (uverificeret). — ✅ **LUKKET 2. august 2026.** Fallbacken er fjernet: et opslag i
  `job_runs.detail` viste `header` for alle ni cron-jobs og ingen `query`, altså at
  ingen ville få 401 af fjernelsen. Transport-kolonnen i `docs/CRON.md` er udfyldt
  af samme opslag.
- **Uvalideret `leagueId` interpoleret i service-role-URL'er.** `api/sync-matches.js:76`
  (også `:84,:88`) bygger `` `/rest/v1/leagues?id=eq.${leagueId}&select=*` `` uden
  UUID-validering eller encoding. Ikke SQL-injektion (PostgREST parametriserer) og bag
  auth, men en kaldende med sync-hemmeligheden kan injicere ekstra PostgREST-parametre
  (`&limit=`, `&order=`, ekstra filtre) i en **service-role**-forespørgsel. Værdier
  afledt fra DB (`api/backfill.js:126,130,134`) er derimod betroede.
- **Ingen timeout på nogen udgående `fetch`.** `api/_shared.js:27`,
  `api/providers/sportmonks.js:121,146,174`, `api/providers/footballdata.js:87`. En
  hængende leverandør stopper hele kaldet; `sync-live` kører hvert minut, så
  overlappende hængende kald er mulige.
- **Sportmonks-token i URL query-string.** `api/providers/sportmonks.js:122,144,174`
  sender `&api_token=` i URL'en, som kan optræde i leverandørens access-logs. (Ikke i
  vores logs; football-data bruger korrekt header `X-Auth-Token`.)
- **Pre-auth 500 med env-var-navne.** `api/sync-matches.js:36-38`,
  `api/sync-live.js:58-60`, `api/send-notifications.js:80-85` afslører for en
  uautentificeret kaldende, hvilke miljøvariabler der mangler. Mindre info-lækage.

---

## 4. Uoverensstemmelser: dokumentation vs. virkelighed

Dokumentationen er stor (`DOCUMENTATION.md` er 568 linjer / 21 sektioner, plus seks
`docs/`-filer og ni feature-specs) og bliver holdt tæt på koden i ånd — men flere
konkrete tal er drevet fra hinanden. Tabellen viser påstande, der kan efterprøves;
"Faktisk" er verificeret på den citerede linje.

| Påstand | Kilde | Faktisk | Status |
|---|---|---|---|
| Testsuite = "15 filer / 351 cases" | `DOCUMENTATION.md` §11 | **22 filer / 476 cases** (`npm test`) | ❌ Forkert |
| Samme suite = "462" og senere "469" | `docs/CHANGELOG.md` (1. aug) | **476** | ❌ To forkerte tal, begge lavere |
| Metrik-ordbog = "27 metrikker" | `docs/ROADMAP.md` (Nyeste beslutninger) | **36** (`src/lib/analyticsMetrics.js`) | ❌ Forkert (§21 siger korrekt 36) |
| Lint-loft = "26 advarsler / `--max-warnings 26`" | `docs/BACKLOG.md:74` (G2) | **23** (`package.json:9`, bekræftet af `npm run lint`) | ❌ Forkert |
| "de 25 bare `eslint-disable-line` andre steder" | `src/screens/OpsPanel.jsx:125` | **24 i alt** i `src/` (23 andre + denne) | ❌ Forkert |
| Analytics = "fire dashboard-sektioner / fire RPC'er" | `DOCUMENTATION.md` §2, §11-tjekliste; `analytics-v1.md` §5 | **seks** sektionsfiler i `src/screens/analytics/` (§21 siger korrekt seks) | ❌ Modsigelse i egne docs |
| `CreateCompetitionScreen.jsx` ~420 linjer | `DOCUMENTATION.md` §12 | **356** | ❌ Forældet |
| `PredictionsScreen.jsx` 399 linjer | `DOCUMENTATION.md` §12 | **320** | ❌ Forældet |
| `AnalyticsPanel.jsx` 42 linjer | `DOCUMENTATION.md` §12 | **53** | ❌ Forældet |
| "Sidst opdateret: juli 2026" | `DOCUMENTATION.md` linje 2 | ~15 poster i selve filen er dateret august 2026 | ❌ Forældet stempel |
| PRODUCT_BOOK "Version 1.2 · 18. juli 2026" | `docs/PRODUCT_BOOK.md` | Indeholder inline-rettelser dateret 1. august 2026 | ❌ Forældet stempel |
| Changelog "fyldte 142 af denne fils 624 linjer (23 %)" | `DOCUMENTATION.md` §14 | Filen er nu 568 linjer — forholdet refererer en version, der ikke findes | ❌ Forældet |
| Sync-kadence | `DOCUMENTATION.md` §8 (`:241`) "hvert 10.-15. minut"; §8 (`:255`) "hver 6. time"; `ROADMAP.md:17` "pt. hver time"; `CRON.md:39` "hver 12. time" | **Fire forskellige svar** for samme job | ❌ Intern modsigelse |
| `schema.sql`-friskhed | `sql/README.md` (1. aug: "BAGUD"); `DOCUMENTATION.md` §12 ("friskt pr. 31. juli"); `ROADMAP.md` ("eksport fra 30. juli") | **Tre forskellige datoer** for samme fil | ❌ Intern modsigelse |
| North Star hviler på `predictions_write_lock.sql` | `DOCUMENTATION.md` §21 (`:535`) | §2 (`:85`) siger udtrykket "er siden afløst af `predictions_match_lock.sql`" | ❌ Reference ikke opdateret |
| Sportmonks-kvote "180 kald/time pr. entitet" | `DOCUMENTATION.md` §8; `live-resultater-v1.md` | Sportmonks' egen kontoside siger 3000 (dokumenteret uafklaret som **A15**) | ✅ **Afgjort 2. august 2026** — kontosiden havde ret: leverandørens eget `rate_limit` i en kørsel viser `Fixture`, 2996 tilbage efter fire kald, 3600 s vindue. Enheden (pr. entitet) var rigtig, tallet var forkert. Begge steder rettet |

**Verificeret korrekt (stikprøver):** teamfarver `C.green = #22C55E` (`src/ui/theme.js`),
K-faktorer 32/24 (`sql/rating_core.sql`), 14 story-regler (`src/lib/analytics.js`),
36 metrikker, `LEAGUE_THRESHOLDS`, push-clamp 1–24 (`api/send-notifications.js:103`),
og ingen døde filreferencer i nogen doc. Grundsubstansen holder — det er tællinger,
datostempler og kadence-tal, der driver.

**Mindre dok-nits:** `DOCUMENTATION.md` §19 har en undersektion ("Tiebreakers og
delte placeringer") uden for indholdsfortegnelsen; dobbelt `---`-separator ved linje
404–405; `docs/BACKLOG.md`'s "Forkastede ideer" er en tabeloverskrift uden rækker,
selvom dokumentets egen regel siger, at forkastede ideer skal derind.

---

## 5. Fejl, mangler og teknisk gæld

Gælden er velregistreret — 13 `G#`-rækker i `docs/BACKLOG.md` og **nul**
`TODO`/`FIXME`/`HACK`-markører i kildekoden. Følgende er de punkter, gennemgangen
bekræfter som aktive, med et par tilføjelser, backloggen ikke fanger.

**Bekræftede, allerede registrerede:**

- **G3 — `rules`-feltet er en død konfigurerbarhed.** `pc_points()` hardkoder 3/1/0 og
  tager ingen `rules`-parameter (`sql/rating_core.sql:116-118`, **verificeret**), mens
  frontenden tråder et `rules`-objekt gennem `pointsFor(pred, actual, rules)`
  (`src/lib/scoring.js:7`), `computeCompetitionState` og komponenterne. Al server-side
  opgørelse er altid 3-1-0; frontendens `rules`-læsning antyder en fleksibilitet, der
  ikke findes. `rules.openDaysBefore` er tilsvarende historisk (fjernet som B1) men
  ligger stadig i gamle rækker.
- **G9 (= S4) og G12.** G12: `sql/push_notifications.sql:29` dokumenterer nøgleformatet
  `deadline:<round_key>:<dato>`, men koden skriver `deadline:<dato>`
  (`api/send-notifications.js:170`, **verificeret**). Da nøglen *er* dedup-garantien,
  er en forkert kommentar en fælde for enhver, der regner baglæns.
- **G1 — fil-splitning tracker de forkerte filer.** G1 udpeger splitkandidater, men de
  faktisk største filer er nu `src/screens/ProfileScreen.jsx` (584 linjer) og
  `src/screens/ChampionshipTab.jsx` (515) — begge større end dem G1 nævner.

**Ikke registreret i backloggen:**

- **Ingen error boundary nogen steder** (`grep` gav 0 forekomster af
  `ErrorBoundary`/`componentDidCatch`/`getDerivedStateFromError` i `src/`,
  **verificeret**). Et render-kast i en hvilken som helst skærm blanker hele appen —
  der er ingen React-router til at isolere en rute, så der er intet sikkerhedsnet.
- **~10 exports uden nogen forbruger** — fx `LOCK_LEAD_MS`, `MODE_HINTS`
  (`src/lib/scoring.js`), `standingsRow` (`src/lib/data/standings.js`),
  `PUSH_DISMISS_KEY` (`src/ui/usePushOptIn.js`). Nogle er sandsynligvis efterladt til
  tests, der aldrig blev skrevet. Lav værdi, men støj.
- **12 modulhoveder bærer stadig boilerplaten** `// Auto-genereret modul — udtrukket
  fra den tidligere monolitiske App.jsx.` — forældet, nu at modulerne er
  selvstændige.
- **Selvmodsigende disable-tal.** `package.json` loft 23, backlog G2 siger 26,
  OpsPanel-kommentar siger "25 andre", faktisk 24 i `src/`. Fire kilder, fire tal.

---

## 6. Testdækning

**Styrken:** 22 testfiler / 476 grønne cases, med god dækning af den rene logik —
`scoring`, `standings`, `stories`, `onboarding`, `createTypes`, `ops`, `analytics`,
den håndrullede `supabase`-klient, og et 792-linjers `data.test.js`. På backend er
`_shared`, `backfill` og alle tre providers testet.

**Hullerne** er koncentreret præcis der, hvor risikoen er størst:

| Utestet | Linjer | Hvorfor det betyder noget |
|---|---|---|
| `src/screens/MainApp.jsx` | 480 | Hele navigations-tilstandsmaskinen + begge deep-link-join-flows + onboarding-gating. |
| `src/App.jsx` | 142 | Auth-bootstrap, 45-min token-refresh-loop, session-persistens. |
| `src/screens/Auth.jsx` | 139 | Signup/login/nulstilling — helt utestet. |
| `src/lib/data/competitions.js` | 245 | **Alle fem oprettelses-modes**, invite-koder, flyt-til-liga. Kun den React-frie `createTypes.js` er testet. |
| `api/sync-matches.js` | 260 | Rigtig HTTP-handler — ingen test. |
| `api/sync-live.js` | 282 | Kører hvert minut — ingen test. |
| `api/send-notifications.js` | 319 | Bærer to bekræftede bugs (G9/G12) — ingen test. |

**Strukturel begrænsning:** komponenttests bruger `renderToStaticMarkup` og asserterer
på HTML-understrenge (bevidst valg, dokumenteret i `src/ui/components.test.jsx:2-3`).
Det betyder, at **ingen test i repoet kan klikke på noget eller køre en `useEffect`** —
netop de data-loading-effects, hvor de 24 `eslint-disable-line
react-hooks/exhaustive-deps` sidder. Hook-korrekthed er dermed hverken lint-fanget
(reglerne er nedgraderet til `warn`, `eslint.config.js:51-54`) eller test-fanget.

---

## 7. Arkitektur og kodekvalitet

Appen er bevidst afhængighedsfattig: fire runtime-deps (`react`, `react-dom`,
`lucide-react`, `web-push`), ingen state-, routing-, form-, dato- eller charting-
biblioteker. Alt er håndrullet, og det er for det meste rent og velkommenteret. To
arkitekturvalg fortjener opmærksomhed:

- **Ingen router.** Navigation er to `useState` (`tab` + `screen`) i
  `src/screens/MainApp.jsx`. Deep links læses ved boot og strippes straks via
  `history.replaceState` (`src/App.jsx:104`, `src/screens/MainApp.jsx:215,239`,
  **verificeret**). Konsekvens: **ingen tilbage-knap, ingen delbare URL'er til interne
  skærme, ingen browser-historik.** For en PWA, hvor brugere forventer at kunne bruge
  telefonens tilbage-gestus, er det en reel UX-begrænsning, ikke kun en teknisk detalje.
- **Sikkerhed via streng-byggede queries.** Hver netværkskald bygger en PostgREST-
  streng ved at interpolere bruger-id'er (`id=in.(${ids})`,
  `invite_code=eq.${pendingJoinCode}`). Det er kun sikkert, fordi RLS holder — hvilket
  gør RLS-hullerne i §3 desto vigtigere. Der er ingen request-annullering, så navigering
  væk midt i et load lader `setState` lande på et afmonteret komponent (React 18 advarer
  ikke længere, men stale-render-races er mulige, fx `src/screens/BoardScreen.jsx:67,86`).

Filstørrelser er ved at blive et vedligeholdsproblem i toppen: `ProfileScreen.jsx`
(584), `ChampionshipTab.jsx` (515), `HjemTab.jsx` (450), `MainApp.jsx` (480) og
`components.jsx` (474) er alle store nok til at være svære at overskue — og de fire
skærme er alle utestede.

---

## 8. Performance

- **Synkron rating-genberegning i skrivesætningen.** Statement-level-triggeren på
  `matches` (`sql/schema.sql:3251-3265`) kalder `recompute_ratings()` synkront inde i
  den upsert, `sync-live` bruger til at færdigmelde en kamp. Ved 150 spillere er det
  ~1 s inde i hvert minut-kald. Optimeringen (transition-tables, så den kun fyrer ved
  reelle resultatændringer) er god og målt, men den fulde genberegning-fra-nul ligger
  stadig på den varme sti.
- **Sekventiel notifikations-loop** (§S5) uden concurrency — beskeder × abonnementer
  serielt. Skalerer dårligt og er kilden til timeout-datatabet.
- **Ingen `fetch`-timeouts** (§3) — en langsom leverandør forlænger hvert kald.
- **Bundle:** én chunk på 412,71 kB (gzip 120,96 kB, **verificeret**). Ikke stort for
  en app uden tunge deps, men uden code-splitting betaler førstegangsbrugeren for hele
  appen — admin-panel, analytics og karriereprofil inkluderet — på første load. For en
  mobil-først PWA er lazy-loading af Admin/Analytics en let gevinst.
- **PostgREST 1000-rækkers-cap** er korrekt håndteret via `restCount` og
  `Content-Range`-parsing (`src/lib/supabase.js`) — et reelt problem, der er løst.

---

## 9. Tilgængelighed

Bedre end typisk for en håndrullet app — 21 `aria-label`s på ikon-knapper, `PlayerName`
er en ægte `<button>` med kontekstuelt navn, og der findes en gennemtænkt kommentar om
*ikke* at bruge `<label>` på chips (`create/SeasonFields.jsx`). Men der er reelle huller:

- **`ScoreInput` har intet tilgængeligt navn** (`src/ui/components.jsx:197-206`,
  **verificeret**): en bar `<input type="number">` uden `aria-label`, `<label>` eller
  tilknytning til kamp/hold. Det er appens **mest brugte kontrol** — hver eneste
  tipindtastning — og en skærmlæser annoncerer intet om, hvilken kamp eller hvilket hold
  feltet gælder.
- **~9 klikbare `<div>`s uden `role`, `tabIndex` eller tastatur-handler** —
  `HjemTab.jsx:95,272,376`, `GroupScreen.jsx:137`, `LigaerTab.jsx:297`, plus `<Card
  onClick>` i `LigaerTab.jsx:108,161`. Det er primære navigations-affordances (åbn en
  konkurrence, åbn en liga, fold en runde ud) og de er tastatur-uopnåelige.
- **`Modal` mangler `role="dialog"`, `aria-modal`, fokusfælde og fokus-gendannelse** —
  håndterer dog `Escape`.
- **Placeholder-som-eneste-label** i `Auth.jsx`, `LigaerTab.jsx`, `OnboardingFlow.jsx`,
  `create/CustomFields.jsx`.
- **Ingen `prefers-reduced-motion`** for `.spin`-loaderen.

Samlet: 110 `onClick`-handlere mod kun 2 `role=`-attributter og 7 `<label>`-elementer i
hele `src/` — en god intention, men ujævnt gennemført.

---

## 10. UX, DX og drift

- **Ingen browser-historik / tilbage-knap** (§7) — den mest mærkbare UX-begrænsning.
- **Preview deler produktionsdatabase** (G4). Fordi `src/lib/supabase.js:7-8` har prod-
  URL som fallback, rammer ethvert preview-deploy uden egne env-vars produktionsdata.
  Kombineret med S1–S3 betyder det, at et preview-miljø er en fuldgyldig angrebsflade
  mod prod.
- **SQL-migreringer, der tavst ruller tilbage.** `sql/README.md` advarer korrekt om, at
  `standings_tiebreakers.sql`, `groups.sql` og `predictions_write_lock.sql` ved gen-
  kørsel **uden fejl** erstatter nyere definitioner med ældre (fjerner `scope`, ruller
  A8-invarianten tilbage, ruller låsen fra per-kamp til per-runde). Det er dokumenteret,
  men det er en skarp kant for enhver, der kører migreringer manuelt i Supabase.
- **CRON-registerets uverificerede transporter.** `docs/CRON.md` markerer jobs 1–3's
  hemmeligheds-transport med `?` og jobs 6–10 med `x-sync-secret *` ("antaget, ikke
  verificeret"). Registeret er kun sandt, hvis det vedligeholdes i hånden, da jobbene
  kører uden for repoet.
- **Dok-vedligeholdsbyrden er selv en risiko.** Uoverensstemmelserne i §4 opstår, fordi
  samme tal (tests, linjetal, kadence, sektioner) er skrevet ned flere steder og skal
  opdateres i takt. Det er den strukturelle årsag bag halvdelen af fundene i denne
  rapport.
- **Fejl-slugning er bevidst kontrakt** (`no-empty: allowEmptyCatch` slået til):
  `logEvent`, `touchActivity`, `ensureCompetitionAwards`, `refreshOnboarding` og
  push-disable fejler tavst. Godt for robusthed i klienten, men det betyder, at en
  nedbrudt analytics-/awards-backend er **usynlig** fra frontenden.

---

## 11. Prioriteret handlingsliste

Rækkefølgen afspejler risiko × indsats. Listen var ren anbefaling, da rapporten blev
skrevet; punkt 1–3 er siden udført og står med ✅, resten er uændret.

**Nu (sikkerhed, lav indsats, høj risiko) — ✅ udført august 2026:**

1. ✅ **S1** — Fjern INSERT/UPDATE på `matches` for `authenticated`/`anon`; læg skrivning på
   `service_role` eller `is_admin`. *(Én migrering.)* → `is_admin`-policies i
   `sql/security_hardening.sql`.
2. ✅ **S2** — Fjern `anon` fra `recompute_ratings()`-grant'en, eller læg `is_admin`-guard
   ind. *(Én linje.)* → begge dele: revoke fra `public`/`anon`/`authenticated` plus
   wrapperen `admin_recompute_ratings()`.
3. ✅ **S3** — Sæt `security_invoker = on` på `monthly_standings` (som de to andre
   standings-views), eller revoke SELECT fra `anon`. *(Én migrering.)* → invoker sat.

Alle tre er dækket af `sql/tests/security_hardening.sql`, som kører i CI og
efterprøver begge retninger: at klient-rollerne er lukket ude, og at admin,
rating-triggeren og `service_role` stadig kommer igennem.

**Snart (brugervendte fejl):**

4. **S4 / G9** — Tilføj `&scope=eq.ALL` i runderesultat-forespørgslen
   (`api/send-notifications.js:196`); samme kodeblok som G10.
5. **S5** — Gør notifikations-send'en robust mod timeout (concurrency-loft +
   `AbortController` + per-besked fejlhåndtering), så claimede rækker ikke tabes.

**Derefter (dok-sandhed — billig, høj tillidsværdi):**

6. **D1** — Ret de faktuelt forkerte tal i én ombæring: testtal (§11 + CHANGELOG),
   metrik-tal (ROADMAP), lint-loft (G2), linjetal (§12), analytics-sektioner (§2/§11),
   sync-kadence (vælg ét sandt tal), `schema.sql`-datoen (ét sted), datostemplerne på
   DOCUMENTATION/PRODUCT_BOOK. Overvej at reducere antallet af steder, hvert tal står,
   så driften stopper ved kilden.

**Løbende (gæld og robusthed):**

7. Tilføj en **error boundary** om app-roden.
8. Dæk de tre HTTP-handlere og `competitions.js`' fem modes med tests (den logik, der
   bærer point og penge-agtig korrekthed).
9. Giv **`ScoreInput` et tilgængeligt navn** og gør de klikbare `<div>`s
   tastatur-tilgængelige — små, men de rammer appens kernehandling.
10. Overvej **code-splitting** af Admin/Analytics og rydning af de ~10 døde exports +
    boilerplate-hovederne.

---

*Rapport genereret som ren analyse. Ingen kode, dokumentation, konfiguration eller data
uden for denne fil er ændret. Fund markeret "verificeret" er efterprøvet mod den
citerede kilde ved commit `7692a2f`.*
