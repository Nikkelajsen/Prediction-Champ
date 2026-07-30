# Feature: Analytics v1

**Status: ✅ Leveret (juli 2026) — `sql/analytics_events.sql` + `sql/analytics_dashboard.sql` + `src/lib/analytics.js` + `src/screens/AnalyticsPanel.jsx` (Admin → Analytics).** · *Filosofi: [`../PRODUCT_BOOK.md`](../PRODUCT_BOOK.md), kapitel 3 (fastholdelse før vækst) · Prioritering: [`../ROADMAP.md`](../ROADMAP.md)*

*Internt måle-lag til produktforbedring — ikke marketing. Skal besvare fem spørgsmål: bruger folk appen hver uge? glemmer de at tippe? hvilke ligaer er mest aktive? hvilke funktioner bruges faktisk? hvor mister vi brugere? Må aldrig påvirke brugeroplevelsen.*

---

## 1. Formål

Produktet havde indtil nu kun `admin_user_stats()` (DAU/WAU/MAU, tilmeldinger, frafald) — nyttigt, men uden en samlet North Star-metrik, uden liga-niveau-indsigt og uden funktions-niveau-brug (hvad bruges faktisk: Story Engine, karriere, rating?). Analytics v1 tilføjer et hændelseskatalog og et 4-sektions admin-dashboard, der samlet besvarer de fem spørgsmål i indledningen.

**Hvorfor internt måle-lag ikke strider mod "Stories over Statistics" (PRODUCT_BOOK kapitel 6):** det princip gælder brugerens overflade — hvad *de* ser. Man kan ikke beskytte et produkts identitet mod en metrik, man ikke måler. Dette dashboard er internt (admin-kun), ændrer intet i brugerens oplevelse, og er selv et redskab til at holde produktet tro mod "fastholdelse før vækst" (PRODUCT_BOOK kapitel 3).

**Fire arkitekturvalg, alle bevidst truffet fremfor alternativer:**

1. **Kun Postgres/Supabase — intet Google Analytics.** North Star-metrikken (Prediction Completion Rate) kræver joins mod liga-/konkurrencedata, som GA ikke kan lave; at sende brugerdata til en tredjepart for internt, ikke-markedsføringsformål har ingen gevinst, der opvejer GDPR-overheadet. Data forbliver i egen database — samme mønster som `admin_user_stats()` — og kan trækkes ud via Supabase SQL-editor eller et BI-værktøj (Metabase/Grafana) forbundet direkte til connection-stringen. Det opfylder kravet "skal kunne trækkes ud, ikke kun i appen" uden en ny leverandør.
2. **Håndrullet dashboard-stil — intet nyt chart-bibliotek.** Genbruger `StatTile`/`StatGroup`/`MiniBars` (flyttet fra `AdminScreen.jsx` til `src/ui/components.jsx`, nu delt af "Statistik" og "Analytics"). Appens eneste dependencies var `lucide-react` + `web-push` — det forbliver sådan.
3. **Udledte KPI'er, intet nyt cron.** `prediction_locked`, `story_generated` og `push_sent` logges IKKE som diskrete events (se afsnit 3) — de beregnes/genbruges fra eksisterende data. Ingen ny scheduled job, ingen ny risiko tæt på den kritiske rundelås- eller Story Engine-kode.
4. **Samlet levering.** Events-tabel, fuld instrumentering og alle 4 dashboard-sektioner er leveret i én omgang.

To yderligere præciseringer, fundet under implementeringen, som afviger fra den oprindelige rå specifikation:

- **`group_id`, ikke `league_id`.** I dette skema betyder "liga" i UI'et `public.groups` (fællesskabet), mens `league_id` allerede betyder en Sportmonks-fodboldturnering (`public.leagues`). At kalde event-kolonnen `league_id` og pege den på `groups` ville genindføre den tvetydighed, liga-laget (juli 2026) fjernede fra resten af skemaet. Kolonnen hedder `group_id`.
- **`story_generated` og `push_sent` logges ikke.** Begge findes allerede, bedre, som rigtige rækker: `story_generated` er én række i `public.stories` pr. genereret historie (`created_at`, `user_id`, `competition_id`, `rule`, `priority`); `push_sent` er én række i `public.notification_log` (`sent_at`, `key`, hvis præfiks — `deadline`/`result` — allerede fortæller typen). At logge dem som events ville enten kræve at redigere `generate_stories()` i `sql/story_engine.sql` for ingen ny information, eller duplikere `notification_log`.

---

## 2. Nordstjerne: Prediction Completion Rate

```
Afgivne tips
-------------
Mulige tips
```

Beregnes pr. bruger, pr. liga, pr. konkurrence, pr. uge og pr. måned — alle fra ét view, `public.analytics_completion_facts` (`sql/analytics_dashboard.sql`), én række pr. **muligt tip**:

1. **"Mulige tips"** = kampene i de konkurrencer, brugeren deltager i, i runder der allerede er **låst** (en ulåst runde er ikke et muligt tip — man kan ikke have misset en deadline, der ikke er indtruffet), og kun runder der låste **efter** brugeren meldte sig til konkurrencen (`lock_at >= competition_participants.joined_at`). Uden det sidste ville alle, der joiner en igangværende `full_season`-konkurrence, starte ved ~0 % og aldrig komme sig — metrikken ville måle anciennitet, ikke deltagelse.
2. **"Afgivne tips"** = at rækken findes i `predictions`. Pålideligt uden et tidsstempel-tjek: `sql/predictions_write_lock.sql` blokerer INSERT/UPDATE efter rundelåsen, og ingen serverkode skriver `predictions` (`api/send-notifications.js` læser kun) — en eksisterende række KAN ikke være skrevet efter deadline.
3. **Grain-reglen** (den letteste ting at få galt): pr. bruger/liga/uge/måned/globalt bruges `count(distinct (user_id, match_id))` — ét tip kan optræde i flere konkurrencer (delt `predictions`-tabel) og må ikke tælles dobbelt. Pr. konkurrence er almindeligt `count(*)` korrekt.

North Star-KPI'en beregnes **altid** direkte fra `predictions`/`matches` via dette view — **aldrig** fra hændelsesloggen (`analytics_events`), som er lossy by design (se afsnit 7).

---

## 3. Hændelseskataloget

Logges via én generisk klient-helper, `logEvent(token, name, { groupId, competitionId, metadata })` (`src/lib/analytics.js`).

| Kategori | Events | Kaldested |
|---|---|---|
| Account | `account_created`, `login`, `logout` | `src/App.jsx` (`completeAuth` med `source`-parameter, `handleLogout`) |
| Liga | `league_created`, `league_joined`, `league_invite_sent`, `league_invite_accepted` | `src/lib/data.js` (`createGroup`, `joinGroup`, `joinByInviteCode`), `src/screens/GroupScreen.jsx`/`BoardScreen.jsx` (`shareInvite`), `src/screens/MainApp.jsx` (`confirmGroupJoin`) |
| Konkurrence | `competition_created`, `competition_joined`, `competition_opened` | `src/lib/data.js` (`createCompetition` — alle 3 return-veje, `joinCompetition`), `src/screens/MainApp.jsx` (`openBoard`/`openPredictions`) |
| Tip | `prediction_started`, `prediction_saved`, `prediction_updated`, `prediction_submitted` | `src/screens/PredictionsScreen.jsx` (`save()`, efter vellykket upsert) |
| Navigation | `opened_home`, `opened_tip`, `opened_league`, `opened_standings`, `opened_rating`, `opened_career`, `opened_story`, `opened_championship` | `src/screens/MainApp.jsx` (`goTab`/`open*`, ét sted for al navigation) |
| Story Engine | `story_viewed`, `story_shared` | `src/screens/HjemTab.jsx` (`StoryCard` + hentnings-effekt) |
| Notifikationer | `push_opened` | `src/App.jsx` (boot-effekt, læser `?pn=`/`?rk=` fra push-linket) |

**Ikke logget — udledt i stedet (se afsnit 1):**

| Event i den rå spec | Udledes af |
|---|---|
| `prediction_locked` | `analytics_round_locks`-viewet (rundelås-udtrykket som aggregat) + Deadline Miss Rate-beregningen |
| `story_generated` | `public.stories` (én række pr. genereret historie) |
| `push_sent` | `public.notification_log` (én række pr. sendt besked, `key`-præfiks = type) |

**`opened_story` er reserveret, men udsendes ikke i v1** — der findes endnu ingen selvstændig story-drilldown (kortet lever inline på Hjem; `story_viewed` er dens impression). Navnet står i check-constrainten, så en fremtidig detaljevisning ikke kræver en ny migrering.

**Bevidst uden for kataloget** (widening ville have krævet en constraint-ændring uden en tilsvarende dashboard-gevinst): `leaveGroup`, `deleteGroup`, `leaveCompetition`, `moveCompetitionToGroup`, `openCreate`, `openHow`. Konkurrence-invite har intet eget navn — genbruger `league_invite_sent`/`league_invite_accepted` med `metadata.via` ("liga_link" / "competition_link" / "code" / "link") som diskriminator, så invite-tragten kan følges ende-til-ende for begge link-typer uden at udvide vokabularet.

---

## 4. Datamodel

`public.analytics_events` (`sql/analytics_events.sql`):

| Kolonne | Type | Note |
|---|---|---|
| `id` | `uuid` | `event_id` i den rå spec |
| `event_name` | `text` | check-constraint mod kataloget ovenfor |
| `user_id` | `uuid` | `default auth.uid()` — klienten sender den ALDRIG; `on delete cascade` |
| `group_id` | `uuid`, nullable | `on delete set null` — se afsnit 1 |
| `competition_id` | `uuid`, nullable | `on delete set null` |
| `metadata` | `jsonb` | `default '{}'::jsonb` |
| `created_at` | `timestamptz` | `default now()` — `timestamp` i den rå spec |

RLS: `enable row level security` + **kun én policy**, `for insert to authenticated with check (user_id = auth.uid())`. Ingen SELECT/UPDATE/DELETE-policy for almindelige brugere — hændelsesstrømmen er internt data, kun læsbart via de admin-gatede RPC'er nedenfor. Derfor bruger klientens insert `Prefer: return=minimal`.

Tre indekser, hver bundet til en konkret dashboard-forespørgsel: `(event_name, created_at desc)`, `(user_id, created_at)` og et **partial** indeks `(group_id, created_at desc) where group_id is not null`. Bevidst intet indeks på `competition_id` alene — ingen sektion grupperer på konkurrence for sig.

To views i `sql/analytics_dashboard.sql`, begge revoked fra klienter (kun læst inde i RPC'erne, ikke direkte):

- `analytics_round_locks` — rundelåsen (samme regel som `sql/predictions_round_lock_policies.sql`) omskrevet til et aggregat pr. `(season_id, round_key)`.
- `analytics_completion_facts` — North Star-facts, se afsnit 2.

---

## 5. Nøgletal og formler

### Dashboard — 4 sektioner (Admin → Analytics, RPC'er i parentes)

1. **Produktets sundhed** (`admin_analytics_health`): aktive brugere (7 dage), aktive ligaer, aktive konkurrencer, Prediction Completion Rate, Deadline Miss Rate, gennemførte spillerunder.
2. **Engagement** (`admin_analytics_engagement`): Story/Karriere/Rating/Liga/Tip Views, Push Notification Open Rate, gennemsnitlig sessionstid.
3. **Liga Health** (`admin_analytics_league_health`): Health Score (0-100), aktive medlemmer, seneste aktivitet — se afsnit 6.
4. **Retention** (`admin_analytics_retention`): uge 1/4/12/26/52, for brugere og for ligaer.

### Deadline Miss Rate

Enheden er **runden**, ikke kampen. En bruger "missede deadline i runde R", hvis de havde ≥1 muligt tip i R og **nul** af dem blev afgivet — 3 ud af 5 tippede kampe er ikke en miss, det måler Completion Rate. Tre tal returneres: `miss_rate` (missede / **aktive** brugere — den godkendte formel, vist som headline), `miss_rate_of_exposed` (missede / brugere der reelt **havde** en deadline — diagnostisk, forhindrer at raten falder kunstigt efterhånden som brugerbasen vokser med folk uden konkurrencer) og `round_miss_rate` (volumen i runder).

### Engagement-detaljer

- **Push Open Rate**: `sent` fra `notification_log` (claimet FØR web-push-kaldet — en fejlet levering tæller stadig som sendt, så raten er et gulv, ikke et loft), `opened` fra `push_opened`-events, splittet på type (`deadline`/`result`) via `key`-præfikset.
- **Sessionstid**: sessionisering med 30-minutters inaktivitetsgrænse. En sessions varighed er FØRSTE hændelse → SIDSTE hændelse, så en session med kun ét event måler 0 sekunder — gennemsnittet er derfor en **nedre grænse**. `avg_seconds_multi` og medianen returneres, så tallet kan læses ærligt.

### Retention — ærligheds-felt

`user_activity_days` har kun data fra den dag, `sql/user_stats.sql` blev kørt. Uge-52-retention vil derfor læse som ~0 %, indtil der findes et helt års aktivitetsdata — en **falsk** 0 %, ikke en rigtig. `admin_analytics_retention()` returnerer `activity_since`, og `AnalyticsPanel.jsx` gråtoner og skriver "Ingen data endnu" for ethvert vindue, der åbner før den dato, i stedet for at vise et selvsikkert forkert tal.

---

## 6. Health Score er en v1-heuristik

Samme situation som Story Engines tærskler før v1.1-kalibreringen (`docs/features/story-engine-v1.md` afsnit 10): vægtene nedenfor er et velbegrundet **gæt**, ikke et empirisk resultat.

| Faktor | Vægt | Beregning |
|---|---|---|
| Completion rate (North Star) | 0.35 | fra `analytics_completion_facts` for ligaens konkurrencer |
| Retention | 0.20 | andel medlemmer, ≥28 dage gamle, aktive inden for de seneste 14 dage |
| Aktivitet sidste 30 dage | 0.20 | andel medlemmer med ≥1 aktivitetsdag |
| Antal aktive medlemmer | 0.15 | `least(1, active_members_30d / 5)` — "en liga føles levende ved ~5 aktive" |
| Story views | 0.10 | `least(1, story_views_30d / (members × 2))` |

Alle tal (vægte + targets) lever som navngivne konstanter i CTE'en `k` øverst i `admin_analytics_league_health()` (`sql/analytics_dashboard.sql`) — rekalibrering er "redigér disse linjer, gen-kør filen". Modsat `sql/analytics_events.sql` (kør én gang) er `analytics_dashboard.sql` **sikker og forventet at blive gen-kørt**.

**Null-sikker renormalisering:** en nyoprettet liga har ingen medlem gammel nok til at måle retention på. At score det som 0 ville stemple enhver ny liga som døende. Manglende faktorer udelades helt, og vægtsummen renormaliseres over de faktorer, der faktisk findes; er INGEN faktor tilgængelig, er scoren `null` ("For ny" i UI'et), ikke 0.

**Scoren er kun meningsfuld som relativ rangering inden for ét snapshot** — ikke som et absolut mål. Rekalibrér når ≥10 ligaer har ≥30 dages historik (se `docs/ROADMAP.md`, åbne beslutninger).

---

## 7. Ydelseskontrakt (ikke-forhandlingsbar)

- Events logges **fire-and-forget** fra klienten: `logEvent(...)` returnerer aldrig et promise, awaites aldrig, og enhver fejl (netværk, RLS, 4xx) svælges stille — præcis som den eksisterende `touchActivity()`. Kaldes altid EFTER at det primære write er lykkedes, aldrig inde i det primære `try`.
- `analytics_events` er derfor **lossy by design** og må ALDRIG bruges til noget en bruger kan bestride. North Star-KPI'en læser altid `predictions` direkte.
- Dashboardet rammer kun aggregerede `security definer`-RPC'er (`admin_analytics_*`), aldrig rå/live-tabeller fra klienten. Ingen af de fire RPC'er kaldes andre steder end Admin → Analytics.
- Ingen ny cron, intet materialized view — begge dele fandtes ikke i forvejen i dette skema, og arkitekturvalg #3 udelukker begge dele bevidst.

---

## 8. Frontend-ændringer pr. fil

| Fil | Ændring |
|---|---|
| `src/lib/analytics.js` (ny) | `logEvent`, `logEventOnce`, `healthTone` + 4 dashboard-read-helpers |
| `src/App.jsx` | `completeAuth` får en `source`-parameter ("signup"/"signin"/"restore"); `handleLogout` logger `logout`; ny boot-effekt for `?pn=`/`?rk=` → `push_opened` |
| `src/screens/Auth.jsx` | sender `source` til `onAuthed` ved signup/signin |
| `src/lib/data.js` | `createGroup`, `joinGroup`, `joinCompetition`, `createCompetition` (alle 3 veje), `joinByInviteCode` |
| `src/screens/MainApp.jsx` | `goTab`/`open*` (ét sted for al navigation), `confirmGroupJoin` |
| `src/screens/PredictionsScreen.jsx` | `save()` — `prediction_started`/`saved`/`updated`/`submitted` |
| `src/screens/HjemTab.jsx` | `StoryCard` får `token`/`groupId`-prop; `story_viewed` (once) + `story_shared` |
| `src/screens/GroupScreen.jsx`, `BoardScreen.jsx` | `shareInvite()` → `league_invite_sent` |
| `api/send-notifications.js` | beskeder får `kind`/`roundKey`; push-URL'en bliver `/?pn=<kind>&rk=<runde>` (intet server-side event) |
| `src/ui/components.jsx` | `StatTile`/`StatGroup`/`MiniBars` flyttet fra `AdminScreen.jsx` (nu 2 forbrugere) + nye `HealthBar`/`PctGrid` |
| `src/screens/AdminScreen.jsx` | fjerde chip "Analytics", render-gren til `AnalyticsPanel` |
| `src/screens/AnalyticsPanel.jsx` (ny) | 4-sektions dashboard |

---

## 9. Udrulning

1. Kør `sql/analytics_events.sql` i Supabase ("Run without RLS"). Verificér: tabellen findes, præcis én policy, en almindelig bruger får 0 rækker ved SELECT.
2. Kør `sql/analytics_dashboard.sql`. Kør verifikationsblokken nederst i filen — de fleste kan køres FØR nogen events er logget, da de læser `predictions`/`matches`/`user_activity_days` (3 af 4 dashboard-sektioner har derfor reel historik allerede på dag ét; kun Engagement og story-views-faktoren i Liga Health starter tomme).
3. Merge frontend-branchen (events begynder at strømme ind).
4. Efter én fuld runde: klik igennem alle instrumenterede flows som en almindelig bruger, og tjek `select event_name, count(*) from analytics_events where created_at > now() - interval '15 minutes' group by 1` — alle navne i kataloget undtagen `opened_story` bør optræde.
5. Kør skema-eksport-workflowen, så `sql/schema.sql` fanger de nye objekter.
6. Opdatér `docs/ROADMAP.md` (gjort, se changelog).

Ingen af de to lock-policy-filer eller `sql/story_engine.sql`/`sql/groups.sql`/`sql/standings_views.sql` er rørt.

---

## 10. Bevidst ikke med i v1

- Ingen funnel-/kohorte-explorer i UI'et — kun de fire faste sektioner.
- Ingen per-bruger-drill-in fra dashboardet (privathedshensyn: analytics er aggregeret, ikke en overvågningsflade).
- Intet indeks på `competition_id` alene.
- `opened_story` reserveret, ikke udsendt (ingen story-drilldown findes endnu).
- Ingen dedikeret eksport-UI — Supabase SQL-editor / en direkte databaseforbindelse ER eksport-mekanismen.
- Ingen anonymisering ud over `on delete cascade` på `user_id` (sletter en bruger sin konto, forsvinder dens spor).
- Liga-retentionens kohorte-matrix (pr. tilmeldingsuge) findes kun for brugere i v1, ikke for ligaer — aggregatet (uge 1/4/12/26/52) findes for begge.

## 11. Acceptkriterier

- Blokeres `/rest/v1/analytics_events` i devtools' netværksfane, virker appen uændret — intet synligt fejler, ingen røde konsolfejl.
- North Star-tallet i dashboardet matcher en uafhængig `select`-forespørgsel mod `analytics_completion_facts` for samme konkurrence/vindue.
- En ikke-admin får `forbidden` fra alle fire `admin_analytics_*`-RPC'er og 0 rækker ved `select * from analytics_events`.
- Health Score er altid i `[0,100]` eller `null` — aldrig et tal uden for det interval.
- Et retention-vindue, hvis start ligger før `activity_since`, vises som "Ingen data endnu", aldrig som `0%`.
- En sektion, der fejler (fx netværksfejl), viser sin egen fejlbesked og blokerer ikke de tre andre.

## 12. Testcases

1. `logEvent` poster til `/rest/v1/analytics_events` med `Prefer: return=minimal`, array-body, ingen `user_id`-nøgle, og returnerer aldrig et promise.
2. Et afvist `restFetch`-kald fra `logEvent` giver ingen uhåndteret rejection og påvirker ikke kaldestedet.
3. `opened_home` to gange inden for 20 sekunder tæller som ét kald; `prediction_saved` to gange i træk tæller som to (writes throttles aldrig).
4. `logEventOnce` med samme nøgle logger kun én gang pr. sideliv.
5. `save()` i `PredictionsScreen`: første komplette gæt på en tom kamp → `prediction_started` + `prediction_saved` + `prediction_submitted`; en efterfølgende ændring → `prediction_saved` + `prediction_updated`; en sletning logger intet.
6. SQL-verifikation (kørt manuelt mod Supabase, se `sql/analytics_dashboard.sql`'s verifikationsblok): rundelås-udtrykket matcher RLS-policyens, ingen slots i ulåste runder, ingen slots før tilmelding, afgivne tips overstiger aldrig `predictions`, Health Score altid i `[0,100]` eller `null`.
7. En ikke-admin-bruger nægtes adgang til alle fire RPC'er og til rå læsning af `analytics_events`.

---

*Leveret. SQL er skrevet mod det dokumenterede skema (`DOCUMENTATION.md` afsnit 2) — verificér mod databasen (`sql/schema.sql` er kun gyldig som reference, når skema-eksporten er kørt efter denne migrering).*
