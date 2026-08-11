# Feature: Analytics v1

> **Rettet efter levering (`A21`, 1. august 2026):** låsen er ikke længere runde-baseret.
> Spec'ens omtale af "rundelåsen" og `analytics_round_locks.lock_at` beskriver ordningen
> før den dato. I dag er `analytics_match_locks` låsen (pr. kamp), mens
> `analytics_round_locks` kun bærer rundens START (`round_start_at`/`has_started`).
> Konsekvenser: North Star tæller nu slots pr. kamp i stedet for pr. runde, så serien
> hen over 1. august 2026 sammenligner to definitioner; `deadline_miss` beholder runden
> som enhed, men nu fordi spørgsmålet har den; og push-effekten måles pr. (bruger, senddag)
> i stedet for pr. (bruger, runde), hvorfor dens serie starter forfra.

**Status: ✅ Leveret (juli 2026) — `sql/analytics_events.sql` + `sql/analytics_dashboard.sql` + `src/lib/analytics.js` + `src/screens/AnalyticsPanel.jsx` (Admin → Analytics).**
**⚠️ Rettet efter levering (30. juli 2026): Liga Health Score er fjernet og erstattet af Liga-diagnose (afsnit 6), og hvert nøgletal har fået en måle-ordbog (afsnit 5B).**
**➕ Udvidet (30. juli 2026): to nye sektioner — Tragt for nye brugere (afsnit 5C, lukker A13) og Story Engine-regler (afsnit 5D, lukker A5's datamangel) — samt push-EFFEKT i Engagement. De tre øverste forslag i afsnit 13 er dermed bygget.** · *Filosofi: [`../PRODUCT_BOOK.md`](../PRODUCT_BOOK.md), kapitel 3 (fastholdelse før vækst) · Prioritering: [`../ROADMAP.md`](../ROADMAP.md)*

*Internt måle-lag til produktforbedring — ikke marketing. Skal besvare fem spørgsmål: bruger folk appen hver uge? glemmer de at tippe? hvilke ligaer er mest aktive? hvilke funktioner bruges faktisk? hvor mister vi brugere? Må aldrig påvirke brugeroplevelsen.*

---

## 1. Formål

Produktet havde indtil nu kun `admin_user_stats()` (DAU/WAU/MAU, tilmeldinger, frafald) — nyttigt, men uden en samlet North Star-metrik, uden liga-niveau-indsigt og uden funktions-niveau-brug (hvad bruges faktisk: Story Engine, karriere, rating?). Analytics v1 tilføjer et hændelseskatalog og et 4-sektions admin-dashboard, der samlet besvarer de fem spørgsmål i indledningen. *(Rettet efter levering: dashboardet har i dag **6 sektioner** — Tragt (5C) og Story Engine-regler (5D) kom til 30.–31. juli 2026, jf. udvidelses-linjen i headeren.)*

**Hvorfor internt måle-lag ikke strider mod "Stories over Statistics" (PRODUCT_BOOK kapitel 6):** det princip gælder brugerens overflade — hvad *de* ser. Man kan ikke beskytte et produkts identitet mod en metrik, man ikke måler. Dette dashboard er internt (admin-kun), ændrer intet i brugerens oplevelse, og er selv et redskab til at holde produktet tro mod "fastholdelse før vækst" (PRODUCT_BOOK kapitel 3).

**Fire arkitekturvalg, alle bevidst truffet fremfor alternativer:**

1. **Kun Postgres/Supabase — intet Google Analytics.** North Star-metrikken (Prediction Completion Rate) kræver joins mod liga-/konkurrencedata, som GA ikke kan lave; at sende brugerdata til en tredjepart for internt, ikke-markedsføringsformål har ingen gevinst, der opvejer GDPR-overheadet. Data forbliver i egen database — samme mønster som `admin_user_stats()` — og kan trækkes ud via Supabase SQL-editor eller et BI-værktøj (Metabase/Grafana) forbundet direkte til connection-stringen. Det opfylder kravet "skal kunne trækkes ud, ikke kun i appen" uden en ny leverandør.
2. **Håndrullet dashboard-stil — intet nyt chart-bibliotek.** Genbruger `StatTile`/`StatGroup`/`MiniBars` (flyttet fra `AdminScreen.jsx` til `src/ui/components.jsx`, nu delt af "Statistik" og "Analytics"). Appens eneste dependencies var `lucide-react` + `web-push` — det forbliver sådan.
3. **Udledte KPI'er, intet nyt cron.** `prediction_locked`, `story_generated` og `push_sent` logges IKKE som diskrete events (se afsnit 3) — de beregnes/genbruges fra eksisterende data. Ingen ny scheduled job, ingen ny risiko tæt på den kritiske rundelås- eller Story Engine-kode. *(Præciseret efter levering, `G77`, 7. august 2026: `analytics_events` ryddes nu efter 18 måneder af `prune_analytics_events()` i `sql/analytics_retention.sql`. Valget står ved magt — der er **ikke** oprettet et nyt planlagt job; funktionen kaldes af `.github/workflows/job-heartbeat.yml`, som allerede kører hver halve time og allerede rydder `job_runs` og `client_errors` på samme måde. Det, valget beskyttede mod, var ny scheduled infrastruktur og ny kode nær rundelåsen; ingen af delene er sket.)*
4. **Samlet levering.** Events-tabel, fuld instrumentering og alle 4 dashboard-sektioner er leveret i én omgang. *(Rettet efter levering: siden udvidet til 6 sektioner — afsnit 5C/5D.)*

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
2. **"Afgivne tips"** = at rækken findes i `predictions`. Pålideligt uden et tidsstempel-tjek: `sql/predictions_write_lock.sql` blokerer INSERT/UPDATE efter rundelåsen *(rettet efter levering, `A21`, jf. banneret øverst: afløst af `sql/predictions_match_lock.sql` — låsen er i dag pr. kamp, og garantien gælder uændret)*, og ingen serverkode skriver `predictions` (`api/send-notifications.js` læser kun) — en eksisterende række KAN ikke være skrevet efter deadline.
3. **Grain-reglen** (den letteste ting at få galt): pr. bruger/liga/uge/måned/globalt bruges `count(distinct (user_id, match_id))` — ét tip kan optræde i flere konkurrencer (delt `predictions`-tabel) og må ikke tælles dobbelt. Pr. konkurrence er almindeligt `count(*)` korrekt.

North Star-KPI'en beregnes **altid** direkte fra `predictions`/`matches` via dette view — **aldrig** fra hændelsesloggen (`analytics_events`), som er lossy by design (se afsnit 7).

---

## 3. Hændelseskataloget

Logges via én generisk klient-helper, `logEvent(token, name, { groupId, competitionId, metadata })` (`src/lib/analytics.js`).

| Kategori | Events | Kaldested |
|---|---|---|
| Account | `account_created`, `login`, `logout` | `src/App.jsx` (`completeAuth` med `source`-parameter, `handleLogout`) |
| Liga | `league_created`, `league_joined`, `league_invite_sent`, `invite_landed`, `league_invite_accepted` | `src/lib/data/groups.js` (`createGroup`, `joinGroup`) + `src/lib/data/competitions.js` (`joinByInviteCode`) — *oprindeligt `data.js`; flyttet ved `G1`*, `src/screens/GroupScreen.jsx`/`BoardScreen.jsx` (`shareInvite`), `src/screens/MainApp.jsx` (`confirmGroupJoin`) |
| Konkurrence | `competition_created`, `competition_joined`, `competition_opened` | `src/lib/data.js` (`createCompetition` — alle 3 return-veje, `joinCompetition`), `src/screens/MainApp.jsx` (`openBoard`/`openPredictions`) |
| Tip | `prediction_started`, `prediction_saved`, `prediction_updated`, `prediction_submitted` | `src/screens/PredictionsScreen.jsx` (`save()`, efter vellykket upsert) |
| Navigation | `opened_home`, `opened_tip`, `opened_league`, `opened_standings`, `opened_rating`, `opened_career`, `opened_story`, `opened_championship` | `src/screens/MainApp.jsx` (`goTab`/`open*`, ét sted for al navigation) |
| Story Engine | `story_viewed`, `story_shared` | `src/screens/hjem/DayCard.jsx`, `RoundStory.jsx` |
| Story Engine v3 | `story_score_distribution`, `story_frame_viewed`, `milestone_cta_clicked` | `src/screens/hjem/DayCard.jsx` (scoren), `RoundStory.jsx` (frames + CTA) |
| Notifikationer | `push_opened` | `src/App.jsx` (boot-effekt, læser `?pn=`/`?rk=` fra push-linket) |

**Ikke logget — udledt i stedet (se afsnit 1):**

| Event i den rå spec | Udledes af |
|---|---|
| `prediction_locked` | `analytics_match_locks`-viewet (lås-udtrykket pr. kamp) + Deadline Miss Rate-beregningen |
| `story_generated` | `public.stories` (én række pr. genereret historie) |
| `push_sent` | `public.notification_log` (én række pr. sendt besked, `key`-præfiks = type) |

**Tre events kom til med Story Engine v3 (7. august 2026).** `story_score_distribution` (`day_key`, `winner_rule`, `news_value`, `runner_up_value`) svarer på, om publiceringstærsklen 45 er rigtig — men **kun som ekko af det sete**, og det er en vigtig skelnen: `analytics_events` er lossy by design og skrives af klienten under RLS, så den tabsfri fordeling, `A35` skal afgøres på, bor i `stories.news_value` og aflæses i SQL. Eventet siger, hvad brugerne faktisk *mødte*; kolonnen siger, hvad motoren *valgte imellem*. `story_frame_viewed` (`story_id`, `frame`, `total_frames`) svarer på, hvor mange der når frame 4 i rundestoryen — altså om tap-through overhovedet bliver brugt. `milestone_cta_clicked` (`milestone_key`) er det, der afgør, om frame 5 løser den bekymring, der udløste den: ser vi ikke et målbart løft i besøg på karriereprofilen inden for 24 timer efter en rundestory med frame 5, virker mekanismen ikke, og så skal milepæle have en anden indgang — ikke flere kort.

**`opened_story` er reserveret, men udsendes ikke i v1** — der findes endnu ingen selvstændig story-drilldown (kortet lever inline på Hjem; `story_viewed` er dens impression). Navnet står i check-constrainten, så en fremtidig detaljevisning ikke kræver en ny migrering.

**Bevidst uden for kataloget** (widening ville have krævet en constraint-ændring uden en tilsvarende dashboard-gevinst): `leaveGroup`, `deleteGroup`, `leaveCompetition`, `moveCompetitionToGroup`, `openCreate`, `openHow`. Konkurrence-invite har intet eget navn — genbruger `league_invite_sent`/`league_invite_accepted` med `metadata.via` ("liga_link" / "competition_link" / "code" / "link") som diskriminator, så invite-tragten kan følges ende-til-ende for begge link-typer uden at udvide vokabularet.

**`invite_landed` er undtagelsen, der bekræfter reglen (`I7`, 11. august 2026).**
Konkurrence-invitationen fik ingen egne navne, fordi den er en anden KILDE til
det samme trin — dét er, hvad `metadata.via` er til for. `invite_landed` er
derimod et **nyt trin**: linket blev åbnet, og modtageren nåede frem med en
session. Det kan ikke udtrykkes som en `via` på hverken `sent` eller `accepted`,
og uden det kunne tragten kun se sine to endepunkter.

Logges i `src/screens/MainApp.jsx`' to deep-link-effekter, hvor UDFALDET af
opslaget er kendt — `notfound` er lige så interessant som `confirm`:
`metadata: { via: "liga"|"join", udfald: "confirm"|"already"|"notfound",
efter_oprettelse: <bool> }`.

⚠️ **Den anonyme halvdel af trinnet kan ikke logges.** `analytics_events.user_id`
er `not null default auth.uid()`, så en besøgende uden konto har ingen række at
skrive — altså netop det frafald, man helst ville se. Tallet er et GULV med en
systematisk blind vinkel, og forbeholdet står i `analyticsMetrics.js` under
`invite_funnel`. **Dashboard-gevinsten** er gruppen "Invitationer" i Admin →
Analytics → Engagement (sendt · landet · accepteret); den krævede ingen ny RPC,
fordi `admin_analytics_engagement` aggregerer hændelsesnavne generisk.

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

- `analytics_match_locks` — låsen (samme regel som `sql/predictions_match_lock.sql`) pr. kamp; `analytics_round_locks` — rundens start, omskrevet til et aggregat pr. `(season_id, round_key)`.
- `analytics_completion_facts` — North Star-facts, se afsnit 2.

---

## 5. Nøgletal og formler

### Dashboard — 6 sektioner (Admin → Analytics, RPC'er i parentes) *(rettet efter levering: 4 ved leveringen; Tragt og Story Engine-regler kom til 30.–31. juli 2026)*

1. **Produktets sundhed** (`admin_analytics_health`): aktive brugere (7 dage), aktive ligaer, aktive konkurrencer, Prediction Completion Rate (med retning mod forrige vindue), Deadline Miss Rate, missede runder, gennemførte spillerunder (alt tid).
2. **Engagement** (`admin_analytics_engagement`): Story/Karriere/Rating/Liga/Tip Views, Push Notification Open Rate (i alt og pr. type), sessionstid (gennemsnit, median, kun-flere-hændelser og hændelser pr. session).
3. **Liga-diagnose** (`admin_analytics_league_health`): tilstand + målte signaler pr. liga — se afsnit 6.
4. **Retention** (`admin_analytics_retention`): uge 1/4/12/26/52, for brugere og for ligaer.
5. **Tragt for nye brugere** (`admin_analytics_funnel`): konto → liga → konkurrence → første tip, splittet på selvstarter/inviteret — se afsnit 5C.
6. **Story Engine-regler** (`admin_analytics_stories`): genereret/vist/delt/afvist pr. regel + dækning — se afsnit 5D.

Sektionerne står i brugerens rejsefølge: kommer de ind (tragt), bliver de (sundhed/engagement), hvad ser de (Story Engine), hvor bor de (liga-diagnose), og bliver de hængende (retention).

### Deadline Miss Rate

Enheden er **runden**, ikke kampen. En bruger "missede deadline i runde R", hvis de havde ≥1 muligt tip i R og **nul** af dem blev afgivet — 3 ud af 5 tippede kampe er ikke en miss, det måler Completion Rate. Tre tal returneres: `miss_rate` (missede / **aktive** brugere — den godkendte formel, vist som headline), `miss_rate_of_exposed` (missede / brugere der reelt **havde** en deadline — diagnostisk, forhindrer at raten falder kunstigt efterhånden som brugerbasen vokser med folk uden konkurrencer) og `round_miss_rate` (volumen i runder).

### Engagement-detaljer

- **Push Open Rate**: `sent` fra `notification_log` (claimet FØR web-push-kaldet — en fejlet levering tæller stadig som sendt, så raten er et gulv, ikke et loft), `opened` fra `push_opened`-events, splittet på type (`deadline`/`result`) via `key`-præfikset.
- **Sessionstid**: sessionisering med 30-minutters inaktivitetsgrænse. En sessions varighed er FØRSTE hændelse → SIDSTE hændelse, så en session med kun ét event måler 0 sekunder — gennemsnittet er derfor en **nedre grænse**. `avg_seconds_multi` og medianen returneres, så tallet kan læses ærligt.

### Vinduets grænser (rettet 30. juli 2026)

Dag-granulære vinduer (dem der læser `user_activity_days`) er `today - (p_days - 1)`, så `p_days = 30` betyder 30 kalenderdage inklusive i dag. Før talte `groups_with_active_member` og Deadline Miss Rates nævner 31 dage, mens tidsstempel-baserede felter i samme svar talte 30 — to tal i samme sektion målte over hver sin periode uden at sige det. `rounds_completed` er derimod bevidst **alt tid** og hedder det nu også i etiketten.

### Retning frem for niveau (nyt 30. juli 2026)

North Star vises med forskellen i procentpoint mod det lige så lange forrige vindue (`completion_rate_prev`). "62 %" kan ikke bære en beslutning; "62 %, ned fra 71 %" kan. Nøglen er `null` — og pilen skjules — når det forrige vindue havde under 5 mulige tips, så støj aldrig præsenteres som et fald.

### Retention — ærligheds-felt

`user_activity_days` har kun data fra den dag, `sql/user_stats.sql` blev kørt. Uge-52-retention vil derfor læse som ~0 %, indtil der findes et helt års aktivitetsdata — en **falsk** 0 %, ikke en rigtig. `admin_analytics_retention()` returnerer `activity_since`, og `AnalyticsPanel.jsx` gråtoner og skriver "Ingen data endnu" for ethvert vindue, der åbner før den dato, i stedet for at vise et selvsikkert forkert tal.

---

## 5B. Måle-ordbogen (tilføjet 30. juli 2026)

Hvert nøgletal på dashboardet har en **ⓘ**, der svarer på fire ting i fast rækkefølge:

| Felt | Svarer på |
|---|---|
| **Hvad måles** | hvad tallet er, i én sætning uden formel |
| **Hvordan** | udregningen, inkl. hvad der tælles med og hvad ikke |
| **Kilde** | hvilke tabeller/views tallet kommer fra, så det kan efterprøves i Supabase SQL-editoren uden at læse RPC'en |
| **Forbehold** | hvad tallet **ikke** kan bruges til — medtaget hver gang der findes en kendt faldgrube |

Teksterne lever i `src/lib/analyticsMetrics.js` (36 metrikker pr. august 2026; 27 ved leveringen) og hentes med `metricInfo(id)`; et ukendt id giver `null` frem for at kaste, så en tastefejl koster ⓘ'en og ikke sektionen. Komponenten `M` i `AnalyticsPanel.jsx` renderer dem i en `InfoDot`.

**Hvorfor det ikke gør etiketterne overflødige.** Reglen fra karriereprofilen (ROADMAP, 30. juli 2026) gælder også her: *et tal skal navngive sit eget omfang i den sætning, det står i; en ⓘ må uddybe, men aldrig alene bære det, der skal til for at læse tallet rigtigt.* Derfor bliver etiketter og hints ved med at sige "seneste 7 dage", "alt tid", "af dem der havde en deadline" — også når forklaringen findes i ordbogen.

Indtil nu stod svarene kun i SQL-kommentarerne, altså præcis dét sted den, der læser dashboardet, ikke kigger. "Deadline Miss Rate: 12 %" kan betyde mindst tre forskellige ting, og forskellen afgør, om tallet er alarmerende eller ligegyldigt.

---

## 5C. Tragt for nye brugere (tilføjet 30. juli 2026 — lukker A13)

Onboarding v1 blev bygget på produktbogens stærkeste påstand om nye brugere — *"en ny bruger skal hurtigst muligt oprette eller tilslutte sig en liga"* — og på iagttagelsen, at **selvstarteren faldt igennem** (syv skærme og ti valg før første tip), mens **den inviterede blev onboardet fint**. Ingen af delene var målt. Dashboardet kunne sige, hvor mange der var aktive, men ikke hvor de nye faldt fra.

**Fire trin:** konto → liga → konkurrence → første tip.

**Alt udledes af rigtige tabeller** (`profiles`, `group_members`, `competition_participants`, `predictions`) — **ikke** af hændelsesloggen. `account_created`, `league_joined` og `prediction_saved` findes i kataloget, men loggen er fire-and-forget: en tragt, der undervurderer sit eget første trin, er værre end ingen tragt.

**Selvstarter eller inviteret** afgøres af den *første* liga, brugeren kom med i: oprettede de den selv, eller trådte de ind i en andens? En bruger helt **uden** liga regnes som selvstarter — A8-invarianten indmelder automatisk i ligaen i samme øjeblik, en invitation accepteres, så ingen liga betyder, at der aldrig blev accepteret en invitation.

**To forskellige tal, og forskellen er vigtig:**

| Visning | Hvad den er | Hvornår den er rigtig |
|---|---|---|
| **Trin** | hvem der nåede hvert trin overhovedet | til at se, hvor stort et spring der forsvandt |
| **"Hvor står de nu"** | en ÆGTE partition — hver bruger tælles præcis ét sted | til at svare på "hvor mister vi dem" |

De to er ikke det samme, fordi trinnene **ikke er strengt indlejrede**: en konkurrence kan være liga-løs, så en bruger kan nå "konkurrence" og "tip" uden nogensinde at have haft en liga. At læse stall-tallene som trin-tal ville dobbelttælle.

**Mediantid pr. trin** (median, ikke gennemsnit — ét ekstremt tilfælde ville trække skævt). ⚠️ Tid til første tip er en **øvre grænse**: `predictions` har ingen `created_at`, kun `updated_at`, som flytter sig, når et tip *rettes*. Antallet, der nåede trinnet, er upåvirket — kun tiden kan være for høj.

**Vindue:** kohorten er brugere oprettet i vinduet, med "Alle brugere" som alternativ. En 7-dages kohorte kan være to brugere; alt-tid står ved siden af som volumen, aldrig i stedet for.

---

## 5D. Story Engine-regler (tilføjet 30. juli 2026)

A5 ("emojis i historie-kort: til eller fra?") og hele tone-spørgsmålet har hidtil kun kunnet besvares på fornemmelse, fordi der ikke fandtes ét sted, der viste hvilke regler der faktisk udløser. v1.1 gik fra 9 til 14 regler; om alle 14 nogensinde er blevet vist til et menneske, har ingen kunnet sige.

**To kilder med hver sin pålidelighed — bevidst holdt adskilt i svaret:**

| Tal | Kilde | Pålidelighed |
|---|---|---|
| genereret, vis-bar, afvist | `public.stories` | rigtige rækker, **præcise** |
| vist, delt | `analytics_events` (`metadata->>'rule'`) | fire-and-forget, et **gulv** |

En lav rate kan lige så godt betyde tabt logning som manglende visning. Sammenlign regler med hinanden, ikke med et ideal.

> ➕ **Tilføjet efter levering (5. august 2026, `G73`): kolonnen "Vis-bar", og
> den er nu NÆVNEREN under alle procenter i tabellen.** Karusellen på Hjem
> henter kun den nuværende rundes kort (`round_key=eq.<nuværende>`,
> `loadRoundCarousel`), så et kort skrevet efter dets egen runde var forbi kan
> aldrig nå en skærm. Sådanne kort fandtes i mængder: v2's efterfyldning skrev
> dagskort for hele historikken, og **197 af 280 historier var dagskort med nul
> visninger**. Med `genereret` som nævner målte visningsraten dermed
> efterfyldningen og ikke brugerne — for syv af treogtyve regler var tallet en
> påstand om noget helt andet, end tabellen sagde.
>
> Vis-bar = skrevet **før rundens slutning** (midnat dansk tid på tirsdagen efter
> rundenøglen). Definitionen fanger to ting med samme udtryk, og kun den ene er
> en engangsudgift: efterfyldte kort, og et runde-kort hvis runde først blev
> spillet færdig efter den var forbi (en udsat kamp). **Både visnings- og
> afvisningsraten deler nævner** — `dismissed_at` sættes kun fra karusellen, så
> et kort, ingen kunne se, kan heller ikke afvises.
>
> `genereret` står uændret ved siden af og skal blive ved med at være sandt:
> kortet BLEV genereret. Forskellen mellem de to tal er selv oplysningen, og
> derfor står vis-bar som en synlig kolonne frem for kun som en nævner.

> ⚠️ **Rettet efter levering (5. august 2026).** Her stod: *"En visningsrate over
> 100 % er derfor umulig."* **Det passer ikke**, og aflæsningen viste det: tabellen
> havde 200 % (`Vandt runden`), 400 % (`Månedens Champion`) og 133 % (`Premiereugen`).
> To grunde, og begge er ved design:
> 1. **Tælleren og nævneren tæller ikke det samme.** `generated` er historier
>    *oprettet* i vinduet; `viewed` er hændelser *logget* i vinduet. En historie
>    fra før vinduet, der ses inde i det, giver en visning uden en generering.
> 2. **`logEventOnce` afgrænser kun pr. sidens levetid** (`src/lib/analytics.js`),
>    ikke pr. historie for evigt. En bruger, der åbner Hjem igen i morgen, logger
>    samme kort igen — hvilket er det rigtige for en impression, men gør raten til
>    visninger pr. historie og ikke andelen af historier, der blev set.
>
> Raten er altså **visninger pr. genereret historie** og ikke en dækningsgrad.
> Over 100 % betyder "set flere gange", ikke "målefejl". Ordet *gulv* gælder
> stadig nedadtil.

**`dismissed_at` er den mest interessante kolonne:** den er brugerens eneste *aktive* afvisning af en historie, og den findes pr. række — ikke som event, og derfor uden gulv-forbeholdet.

**Regler, der aldrig udløser.** RPC'en kan per definition kun se regler, der *har* udløst. Katalogen med de 23 regler holdes derfor i klienten (`STORY_RULES` i `src/lib/analytics.js`) — 14 indtil Story Engine v1.2 (august 2026) lagde de to lokale kåringer til, og 16 indtil v2's syv dagsregler kom med *(rettet efter levering, august 2026 — se nedenfor)* — og de to tilstande skelnes:

- **ALDRIG** — har ikke udløst én eneste gang, heller ikke uden for vinduet. Den dyreste slags død kode: den ser ud til at virke.
- **STILLE** — har udløst før, men ikke i vinduet. Bare en stille periode.

> **De tre ALDRIG-regler pr. 5. august 2026 er efterset, og to af dem er
> uskyldige.** `AWARD_WEEK` og `AWARD_MONTH` læser `competition_awards`, som kun
> skrives for konkurrencer med `mode_params.awards` — og opslaget
> `select count(*) from competitions where mode_params ? 'awards'` svarer **0**.
> Reglerne er altså **uafprøvede, ikke defekte**: der har aldrig været en
> konkurrence, de kunne fyre på. De fyrer af sig selv, første gang nogen slår
> kåringer til.
>
> **Det er en anden situation end `G8`s uprøvede kodesti**, og forskellen er
> værd at kende: kæden fra kåringsrække til historie-kort er dækket af en
> SQL-test i CI ("Test af Story Engines kåringsregler"), fordi den går gennem
> tre filer og fejler tavst bag matches-triggerens exception-guard. Stien er
> altså afprøvet — bare ikke af produktionsdata.
>
> **Den tredje, `RATING_HIGH`, står stadig åben.** Den kræver en rating, der
> er højere end alle tidligere, altså en historik at slå — så den kan være
> tærsklen eller reglen. Boksen bør læses med det i baghovedet: **ALDRIG er et
> spørgsmål og ikke en dom.**

Prisen for at holde katalogen i JS er drift. Den betales af en test, der **læser alle `sql/story_engine*.sql`**, trækker regelnavnene ud og fejler, hvis de to lister ikke er ens — så listen ikke stille kan blive forældet, næste gang motoren udvides.

> ⚠️ **Rettet efter levering (august 2026).** Testen læste oprindeligt kun `sql/story_engine.sql` ved navn. Da Story Engine v2 lagde sin dagsmotor i en **ny fil** (`sql/story_engine_v2.sql`), var der derfor ingen drift at se: testen blev ved med at være grøn, mens de syv dagsregler stod i tabellen som rå nøgler (`DAY_RESULT`, `DUEL`, …) med mærkatet **UKENDT** og uden navn. En hårdkodet filliste var den samme fejl som den hårdkodede regelliste, testen skulle beskytte imod. Testen finder nu filerne ved at læse `sql/`-mappen, og katalogen har fået de syv navne: *Dagens facit · Alene om at ramme · Ingen ramte kampen · Dagens højeste · Stimen lever eller brød · Duel med nærmeste rival · Ét mål fra eksakt*.

**Dækning** = brugere med mindst én historie ÷ brugere med mindst ét muligt tip i en låst runde. Det er dét tal, v1.1-leverancen blev målt på ("1 af 8 → 8 af 8 brugere i premiereugen") — nu permanent i stedet for en engangsmåling.

---

## 5E. Push-effekt (tilføjet 30. juli 2026, inde i Engagement)

Open rate siger, om beskeden blev **åbnet**. Den siger intet om, hvorvidt den **virkede**. Deadline-påmindelsen er produktets eneste aktive fastholdelses-værktøj, så det spørgsmål er værd at kunne svare på: *tippede de, der åbnede den, oftere end de, der ikke gjorde?*

**Enheden er (bruger, runde)** — én modtaget deadline-påmindelse for én runde. "Tippede" = mindst ét tip i netop den runde, læst fra `analytics_completion_facts`, altså fra `predictions`.

Modtagerne findes ved at parse `notification_log.key` (`deadline:<season_id>:<round_key>:<dato>`; `season_id` kan være tom, men indeholder aldrig et kolon, så felt 3 er altid runde-nøglen). Parsingen er defensiv med et regex-tjek: en nøgle i uventet format udelades frem for at kaste og tage hele Engagement-sektionen med sig. *(Rettet efter levering, `A21` — jf. banneret øverst: nøglen er i dag `deadline:<dato>`, felt 2 er datoen, og det gamle 4-felts-format udelades bevidst af regex-tjekket.)*

> ⚠️ **Korrelation, ikke årsag.** De, der åbner notifikationer, er de engagerede i forvejen. Forskellen er et **loft** over pushets reelle effekt, ikke et estimat af den. Et push, der aldrig blev åbnet, kan desuden godt have virket — beskeden er synlig på låseskærmen, uden at linket bliver trykket.

**Varsel før første lås** (`sent_at` → `lock_at`, i intervaller) er med, fordi det er den eneste knap, der reelt kan drejes på: cron-tidspunktet. Intervallerne er ikke sammenlignelige uden videre — runder med tidligt kickoff får systematisk kortere varsel.

## 5F. Ad hoc-opslag: virker "Anbefalet"? (`B12`, august 2026)

Spec'en siger, at SQL-editoren **er** eksport- og analysemekanismen (§10). Det
gælder også dette: `B12` beder ikke om en ny sektion i dashboardet, men om ét
opslag, der er kørt én gang. Det står her, fordi et spørgsmål uden en formuleret
forespørgsel i praksis aldrig bliver stillet.

**Spørgsmålet.** `A22` satte mærkatet "Anbefalet" på Sæson-kortet i opret-galleriet
netop for at flytte, hvilken mode nye brugere vælger. Effekten er aldrig aflæst —
og et anbefalings-mærke, der ikke virker, er værre end ingen, fordi det bruger
den plads, der skulle guide.

**Der skal ikke instrumenteres noget** — men der skal vælges kilde, og det viste
sig at være hele forskellen (5. august 2026). Der er to, og de svarer på det
samme:

| Kilde | Vindue | Pålidelighed |
|---|---|---|
| **`competitions.mode` + `created_at`** | **hele appens historik** | rigtige rækker, **præcise** |
| `analytics_events` (`competition_created` → `metadata.mode`) | fra 30. juli 2026, da Analytics v1 blev udrullet | fire-and-forget, et **gulv** |

**Brug `competitions`.** Hændelsesloggen var det oprindelige valg her, fordi
`competition_created` allerede bar `metadata.mode` — men en oprettelse er ikke
kun en hændelse, den er også en **række**, og rækken har både den præcise mode
og et `created_at`, der går hele vejen tilbage. Med en lille brugerbase er
vinduets længde vigtigere end alt andet: hver oprettelse tæller, og
hændelsesloggen kasserer per konstruktion alt fra før 30. juli.

```sql
-- Fordelingen af konkurrence-typer før og efter, at "Anbefalet" kom på.
-- Sæt datoen til den dag, A22 blev udrullet.
with maerket as (select timestamptz '2026-08-01 00:00+02' as fra),
     raekker as (
       select case when c.created_at < m.fra then 'før' else 'efter' end as periode,
              c.mode
         from competitions c cross join maerket m
     )
select periode,
       mode,
       count(*)                                                     as antal,
       round(100.0 * count(*) / sum(count(*)) over (partition by periode), 1) as pct
  from raekker
 group by 1, 2
 order by 1 desc, 4 desc;
```

Hændelses-varianten står stadig her, fordi den er den eneste, der kan skelne en
oprettelse, som senere blev slettet, fra en, der aldrig fandtes — og fordi
`metadata` kan bære felter, tabellen ikke har:

```sql
-- Fordelingen af konkurrence-typer før og efter, at "Anbefalet" kom på.
-- Sæt datoen til den dag, A22 blev udrullet.
with maerket as (select timestamptz '2026-08-01 00:00+02' as fra),
     haendelser as (
       select case when e.created_at < m.fra then 'før' else 'efter' end as periode,
              e.metadata->>'mode'                                        as mode
         from analytics_events e cross join maerket m
        where e.event_name = 'competition_created'
     )
select periode,
       mode,
       count(*)                                                     as antal,
       round(100.0 * count(*) / sum(count(*)) over (partition by periode), 1) as pct
  from haendelser
 group by 1, 2
 order by 1 desc, 4 desc;
```

> ⚠️ **Rettet efter levering (5. august 2026), og to gange samme dag.**
>
> **1) Forespørgslen kunne ikke køre.** Den beregnede perioden i `select`-listen
> og partitionerede så vinduet på `(e.created_at < m.fra)` — et udtryk, der
> hverken står i `group by` eller er pakket i en aggregering. PostgreSQL afviser
> den med `42803: column "e.created_at" must appear in the GROUP BY clause`.
> Perioden udledes nu ét sted, i en CTE, så vinduet kan partitionere på selve
> grupperingsnøglen. Begge forespørgsler ovenfor er **efterprøvet mod PostgreSQL
> 16.13** (samme version som CI) med plantede data, hvor svaret var kendt på
> forhånd, og med en negativ kontrol (en `login`-række, der skal holdes ude).
>
> **2) Kilden var forkert valgt.** Da forespørgslen endelig kørte, svarede den
> med tre hændelser i alt, alle `random` — hvilket ikke er mistænkeligt ved en
> testbase på ~20 brugere, men gør spørgsmålet ubesvarligt. Det afgørende er, at
> **`analytics_events` først findes fra 30. juli 2026**, så "før mærkatet" var i
> praksis to døgn og ikke appens historik. `competitions` bærer den samme mode
> som en rigtig række med et `created_at`, der går hele vejen tilbage. Kilden er
> derfor byttet om: tabellen er den primære, hændelsen er kontrollen.
>
> **Læren er ikke "loggen er dårlig"** — den er lossy by design, og det står i
> §2. Læren er, at et gulv kun duer, når man har rigeligt af det man tæller.
> Ved lille datamængde skal man tælle **rækker**, ikke hændelser, hvis rækken
> findes.
>
> **Det, fejlen siger om spec'en, er vigtigere end fejlen.** §5F blev skrevet
> netop for, at et spørgsmål uden en formuleret forespørgsel aldrig bliver
> stillet — og backloggens `B12` stod i to døgn med teksten *"forespørgslen er
> skrevet, tilbage står at køre den"*. Den var skrevet, ikke kørt. En SQL-blok i
> et dokument har ingen CI bag sig, så den er en **påstand** om, hvad der ville
> virke, indtil nogen kører den.

**Sådan læses svaret.** Sammenlign `pct` for `full_season` før og efter. Bemærk
tre forbehold, som skal med, hvis tallet skal bære en beslutning:

* **Antallet er lille.** Med få oprettelser pr. uge er en forskel på et par
  procentpoint støj. Står `antal` i enkeltcifre for en periode, er svaret "vi
  ved det ikke endnu" — ikke "det virkede ikke".
* **Hændelsesloggen er fire-and-forget og lossy by design** (§2). Den er et
  GULV, ikke et facit. Til gengæld rammer tabet begge perioder lige, så
  *fordelingen* er mere troværdig end de absolutte tal. **Gælder kun
  kontrol-forespørgslen** — `competitions` er rigtige rækker.
* **Perioderne er ikke lige lange, og "før" er den korte.** Mærkatet kom på
  1. august 2026, mens appen har kørt siden juli — så "før" dækker uger og
  "efter" dage. Med `competitions` som kilde er det en styrke (der ER noget at
  sammenligne med); det er samtidig grunden til, at `pct` og ikke `antal` er
  tallet, man læser.
* **Rækkefølgen af kortene blev vendt samme dag** som mærkatet kom på (langt →
  kort med Sæson øverst). De to kan ikke skilles ad i data — flytter fordelingen
  sig, ved vi ikke hvilken af dem, der gjorde det. Det er acceptabelt for det,
  spørgsmålet skal bruges til (*virkede indgrebet?*), men ikke for et forsøg på
  at kalibrere de to hver for sig.

> ⚠️ **`I15`-påstanden var forkert og er fjernet (5. august 2026).** Her stod:
> *"Samme opslag svarer på `I15`s åbne spørgsmål: bruges Ugens kupon-kortet
> overhovedet? Kig efter `random` i `mode`-kolonnen."* Det gør det ikke.
> `mode = 'random'` dækker **både** galleriets Ugens kupon-kort og en håndlavet
> Quick Pick eller Quick League, og `mode_params` skiller dem ikke ad:
> `rounds` skrives kun når den er > 1, hvilket en manuel enkeltrunde også
> undlader. Skal kortets brug måles, kræver det en ny hændelse eller et felt —
> altså instrumentering, ikke et opslag. To rækker for ét opslag var en
> regnefejl.

## 5G. Hvad opslaget svarede første gang (5. august 2026)

Noteret her, fordi et opslag uden sit svar inviterer til at blive kørt igen med
den samme forventning.

| periode | mode | antal | pct |
|---|---|---|---|
| før | `time_range` | 2 | 33,3 |
| før | `random` | 2 | 33,3 |
| før | `full_season` | 2 | 33,3 |
| efter | `random` | 1 | 100,0 |

**Svaret er "ikke endnu", og det er ikke det samme som "mærkatet virker ikke".**
Hele appens historik rummer syv konkurrencer, og kun én er oprettet efter
mærkatet kom på. En fordelingssammenligning med n=1 i den ene periode kan ikke
måle noget — præcis det første forbehold ovenfor, nu med et tal på.

**Det, tallet derimod siger noget om, er metoden.** Et før/efter-design kræver
tocifrede tal i begge perioder, og produktet skaber en konkurrence nogle få
gange pr. sæson pr. liga — ikke pr. dag. Spørgsmålet "virkede indgrebet?" bliver
altså først besvarligt, når brugerbasen er vokset, og det er dét, `B12`s udløser
i backloggen nu siger: **tosifret `antal` i `efter`-perioden.** Indtil da hviler
mærkatet på produktjudgement, hvilket er et legitimt grundlag — bare ikke et
målt et.

## 6. Liga-diagnose (afløser Health Score, 30. juli 2026)

**Den sammenvejede Health Score (0-100) er fjernet.** Den var for bred til at bruge til noget, af fire grunde:

1. **Blandingen søgte mod midten.** På de fire første rigtige ligaer gav den 75/77/77/88 — alle fire grønne, alle fire "SUND". En metrik, der ikke kan skelne ligaer fra hinanden, kan heller ikke pege på den, der har brug for hjælp.
2. **Den sagde aldrig hvad der var galt.** "77" er ikke en handling. Det, en admin skal vide, er *"denne liga har ingen aktiv konkurrence"* eller *"denne liga bæres af én person"* — to helt forskellige problemer, som den vægtede sum kunne give præcis samme tal for.
3. **Faktorerne overlappede.** Antal aktive medlemmer, andel aktive medlemmer og retention måler alle tre "kommer medlemmerne her". Tre af fem vægte trak i samme streng, så deltagelse reelt vejede mindre end de 35 %, tallet lovede.
4. **Vægte kan ikke kalibreres på fire ligaer.** A12 spurgte "hvornår rekalibrerer vi?" — svaret viste sig at være "vi fjerner den størrelse, der kræver kalibrering". A12 er dermed lukket, ikke udskudt.

### Erstatningen: signaler + én navngivet tilstand

**RPC'en måler, klienten fortolker.** `admin_analytics_league_health(p_days)` returnerer nu rå signaler pr. liga uden score og uden tilstand; `diagnoseLeague()` i `src/lib/analytics.js` udleder tilstanden.

**Hvorfor reglerne ligger i JS og ikke i SQL:** de er produktjudgement, der skal tunes ofte, og de kan unit-testes i vitest — ingen CI kører SQL. Samme valg som Onboarding v1, hvor tilstanden bevidst udledes af data i klienten uden SQL. Nye tærskler kræver derfor ikke længere en gen-kørsel i Supabase.

**De målte signaler** (alle i ét vindue, `p_days`, alle fra `analytics_completion_facts` — samme kilde som North Star, så liga-tallene og "Produktets sundhed" ikke kan modsige hinanden):

| Signal | Betydning |
|---|---|
| **Bredde** | medlemmer med ≥1 afgivet tip ÷ medlemmer |
| **Deltagelse** | North Star for ligaens konkurrencer |
| **Retning** | deltagelse mod forrige lige så lange vindue (pp) |
| **Puls** | runder med ≥1 tip ÷ runder der låste |
| **Koncentration** | den mest aktive tippers andel af ligaens tips |
| **Aktive medlemmer** | medlemmer med ≥1 aktivitetsdag ÷ medlemmer |
| **Fastholdelse** | medlemmer ≥28 dage gamle, aktive inden for 14 dage |
| **Konkurrencer** | i alt og hvor mange med en ulåst runde tilbage |
| **Seneste aktivitet** | senest af aktivitetsdag / tip / hændelse |
| **Story views** | `story_viewed` med ligaen sat |

**Bredde er det signal, v1 manglede helt.** Den gamle "andel aktive medlemmer" målte, om folk *åbnede appen* — ikke om de *spillede*. En liga hvor én tipper alt og fire kigger på, og en liga hvor alle fem tipper, kunne få samme score.

### Regelkataloget

Tilstandene evalueres **oppefra og ned, første regel der passer vinder** — samme mønster som Story Engines regelkatalog. Rækkefølgen er selve designet: **årsag før symptom.** En liga uden aktiv konkurrence skal høre "opret en konkurrence", ikke "for få tipper" — den kan ikke gøre noget ved det sidste.

| # | Tilstand | Udløses af | Alvor |
|---|---|---|---|
| 1 | **For ny** | under 14 dage gammel | – |
| 2 | **Død** | ingen aktivitet nogensinde, eller i over 30 dage | 6 |
| 3 | **Ingen konkurrence** | ingen konkurrence med en ulåst runde | 5 |
| 4 | **I dvale** | over 14 dage uden aktivitet | 5 |
| 5 | **Kun ét medlem** | `members ≤ 1` | 4 |
| 6 | **Intet at måle på** | ingen låst runde i vinduet | – |
| 7 | **Ingen tipper** | låste runder, men 0 tippere | 5 |
| 8 | **Bæres af én** | præcis 1 tipper blandt flere medlemmer | 4 |
| 9 | **Kun en del tipper** | bredde under 50 % | 3 |
| 10 | **Deltagelsen falder** | fald på ≥15 pp mod forrige vindue | 3 |
| 11 | **Lav deltagelse** | under 50 % ved ≥5 mulige tips | 2 |
| 12 | **Sund** | ingen af ovenstående | 1 |

Hver tilstand giver en **begrundelse med ligaens egne tal** ("Én af 4 medlemmer står for alle ligaens tips") og en **handling** ("Klassisk vennegruppe-sammenbrud: den ene bliver træt, og så er ligaen væk. Få nummer to i gang."). Tabellen sorteres efter alvor, derefter laveste deltagelse (null sidst), derefter navn — samme rækkefølge hver gang, så en liga ikke hopper rundt mellem to opdateringer.

**Tærsklerne står samlet i `LEAGUE_THRESHOLDS`** (`src/lib/analytics.js`) og kan overstyres pr. kald (`diagnoseLeague(l, egneTærskler)`), hvilket er præcis dét, testene gør. De er stadig et velbegrundet gæt — men nu synlige, navngivne og hver især testbare frem for gemt i en vægtet sum.

**"For ny" står først med vilje.** Uden den ville en liga oprettet i går, som endnu ikke har nået at gøre noget, blive stemplet "Død" — nøjagtig den fejl, den gamle scores null-sikre renormalisering fandtes for at undgå. Tilstande uden tone ("For ny", "Intet at måle på") får bevidst **ingen farve**, så "vi ved det ikke" aldrig kan forveksles med "det er fint".

**Story views indgår ikke i diagnosen.** De var 10 % af den gamle score, hvilket gav den nyeste og svageste instrumentering en vægt, den ikke havde fortjent. Tallet vises stadig i drill-in'en med netop den bemærkning.

**Komponenter:** `HealthBar` er fjernet (der er ikke længere en score at tegne en bjælke for) og erstattet af `StateChip` (ordet er signalet, farven kun ekstra) + `SignalRow` (navn, værdi, rå-tal). `healthTone()` er væk sammen med den.

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
| `src/lib/analytics.js` (ny) | `logEvent`, `logEventOnce` + 4 dashboard-read-helpers. **30. juli 2026:** `healthTone` fjernet, `diagnoseLeague`/`diagnoseLeagues`/`summarizeDiagnoses`/`LEAGUE_THRESHOLDS`/`LEAGUE_STATES` tilføjet |
| `src/App.jsx` | `completeAuth` får en `source`-parameter ("signup"/"signin"/"restore"); `handleLogout` logger `logout`; ny boot-effekt for `?pn=`/`?rk=` → `push_opened` |
| `src/screens/Auth.jsx` | sender `source` til `onAuthed` ved signup/signin |
| `src/lib/data.js` | `createGroup`, `joinGroup`, `joinCompetition`, `createCompetition` (alle 3 veje), `joinByInviteCode` |
| `src/screens/MainApp.jsx` | `goTab`/`open*` (ét sted for al navigation), `confirmGroupJoin` |
| `src/screens/PredictionsScreen.jsx` | `save()` — `prediction_started`/`saved`/`updated`/`submitted` |
| `src/screens/HjemTab.jsx` | `StoryCard` får `token`/`groupId`-prop; `story_viewed` (once) + `story_shared` |
| `src/screens/GroupScreen.jsx`, `BoardScreen.jsx` | `shareInvite()` → `league_invite_sent` |
| `src/screens/MainApp.jsx` | deep-link-effekterne → `invite_landed` (efter opslaget, før navigationen) |
| `api/send-notifications.js` | beskeder får `kind`/`roundKey`; push-URL'en bliver `/?pn=<kind>&rk=<runde>` (intet server-side event). **Rettet efter levering (`B5`, august 2026):** URL'en bygges nu med `URLSearchParams`, og `rk` udelades, når beskeden ikke har en runde — "ny konkurrence"-beskeden bærer i stedet `join=<invite_code>`, så den lander i invitations-bekræftelsen |
| `src/ui/components.jsx` | `StatTile`/`StatGroup`/`MiniBars` flyttet fra `AdminScreen.jsx` (nu 2 forbrugere) + `PctGrid`. **30. juli 2026:** `HealthBar` fjernet, `StateChip`/`SignalRow` tilføjet; `StatTile` fik `info`-prop; `MiniBars` skelner nu `null` (ingen måling) fra 0 |
| `src/screens/AdminScreen.jsx` | fjerde chip "Analytics", render-gren til `AnalyticsPanel` |
| `src/screens/AnalyticsPanel.jsx` (ny) | 4-sektions dashboard. **30. juli 2026:** ⓘ på hvert nøgletal, North Star med retning, Liga-diagnose i stedet for Health Score, døde felter taget i brug |
| `src/lib/analyticsMetrics.js` (ny, 30. juli 2026) | måle-ordbogen: 36 metrikker × hvad/hvordan/kilde/forbehold |

---

## 9. Udrulning

0. **Efter 30. juli 2026-udvidelsen:** gen-kør `sql/analytics_dashboard.sql` — den indeholder to nye RPC'er (`admin_analytics_funnel`, `admin_analytics_stories`) og et udvidet `push`-objekt i `admin_analytics_engagement`. Filen er idempotent; ingen anden fil er rørt.
1. Kør `sql/analytics_events.sql` i Supabase ("Run without RLS"). Verificér: tabellen findes, præcis én policy, en almindelig bruger får 0 rækker ved SELECT.
2. Kør `sql/analytics_dashboard.sql`. Kør verifikationsblokken nederst i filen — de fleste kan køres FØR nogen events er logget, da de læser `predictions`/`matches`/`user_activity_days` (3 af 4 dashboard-sektioner har derfor reel historik allerede på dag ét; kun Engagement og story-views-signalet i Liga-diagnosen starter tomme).
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
- Alle procent-signaler i Liga-diagnosen er i `[0,100]` eller `null`; `predictors ≤ members` og `rounds_played ≤ rounds_available` holder altid.
- Hver liga får præcis ÉN tilstand, og en liga under 14 dage gammel får altid "For ny" — uanset hvor tomme dens øvrige signaler er.
- En tilstand uden tone ("For ny", "Intet at måle på") renderes ikke i samme farve som "Sund".
- Hvert nøgletal på skærmen har en ⓘ, og et ukendt metrik-id fjerner kun ⓘ'en, ikke sektionen.
- Tragtens "hvor står de nu" summer altid præcis til kohorten, og selvstarter + inviteret summer til totalen inden for hvert scope.
- En regel i Story Engine-katalogen, der aldrig har udløst, vises som ALDRIG — ikke som en manglende række. Katalogen kan ikke drive fra `sql/story_engine.sql` uden at en test fejler.
- Story Engines `viewed` overstiger aldrig `generated` (loggen er et gulv, aldrig et loft).
- Push-effektens åbnede + ikke-åbnede summer til antallet af modtagere.
- Et retention-vindue, hvis start ligger før `activity_since`, vises som "Ingen data endnu", aldrig som `0%`.
- En sektion, der fejler (fx netværksfejl), viser sin egen fejlbesked og blokerer ikke de tre andre.

## 12. Testcases

1. `logEvent` poster til `/rest/v1/analytics_events` med `Prefer: return=minimal`, array-body, ingen `user_id`-nøgle, og returnerer aldrig et promise.
2. Et afvist `restFetch`-kald fra `logEvent` giver ingen uhåndteret rejection og påvirker ikke kaldestedet.
3. `opened_home` to gange inden for 20 sekunder tæller som ét kald; `prediction_saved` to gange i træk tæller som to (writes throttles aldrig).
4. `logEventOnce` med samme nøgle logger kun én gang pr. sideliv.
5. `save()` i `PredictionsScreen`: første komplette gæt på en tom kamp → `prediction_started` + `prediction_saved` + `prediction_submitted`; en efterfølgende ændring → `prediction_saved` + `prediction_updated`; en sletning logger intet.
6. SQL-verifikation (kørt manuelt mod Supabase, se `sql/analytics_dashboard.sql`'s verifikationsblok): rundelås-udtrykket matcher RLS-policyens, ingen slots i ulåste runder, ingen slots før tilmelding, afgivne tips overstiger aldrig `predictions`, alle procent-signaler i `[0,100]` eller `null`, bredde ≤ medlemmer.
7. En ikke-admin-bruger nægtes adgang til alle fire RPC'er og til rå læsning af `analytics_events`.
8. `diagnoseLeague` rammer hver af de 12 tilstande, og hver tærskel testes på begge sider af sin grænse (13 vs. 14 dage, 30 vs. 31 dage, 49,9 % vs. 50 % bredde, 14 vs. 15 pp fald).
9. Rækkefølgen er bindende: "for ny" slår alt andet, og "ingen konkurrence" slår "i dvale" — årsag før symptom.
10. `diagnoseLeagues` sorterer efter alvor, derefter laveste deltagelse (null sidst), derefter navn; `undefined`/tom liste giver `[]`.
11. Måle-ordbogen: hver metrik har titel/hvad/hvordan/kilde; hvert id, panelet slår op, findes; `metricInfo("findes_ikke")` giver `null`.
12. `MiniBars` med `value: null` viser "ingen data", ikke en nulsøjle.
13. `funnelRow` plukker den rigtige række ud af grouping sets og blander aldrig scopes; manglende svar giver `null`.
14. `funnelSteps` regner procent af KOHORTEN og fald af FORRIGE trin — to forskellige nævnere; tom kohorte giver `[]` i stedet for division med nul.
15. `biggestDrop` ignorerer trin, der VOKSER (en liga-løs konkurrence kan nås uden liga), og giver `null` for en tragt uden frafald.
16. `fmtMinutes` dækker sekunder → dage i samme felt; `null` bliver til en tankestreg, aldrig til 0.
17. `storyRuleRows` returnerer hele katalogen (ikke kun det målte), skelner ALDRIG fra STILLE, og markerer en ukendt regel fra databasen frem for at skjule den.
18. Drift-test: regelnavnene i **alle** `sql/story_engine*.sql` (fundet ved at læse mappen, ikke ved navn) er præcis dem i `STORY_RULES` — og der findes mindst to sådanne filer, så en flyttet eller omdøbt motor ikke kan gøre testen tom.

---

## 13. Foreslået, men ikke bygget (30. juli 2026)

Fundet under gennemgangen, bevidst ikke leveret her. Rangeret efter forventet værdi pr. indsats.

**De tre åbne forslag følges nu i [`../BACKLOG.md`](../BACKLOG.md) (31. juli 2026)** som `I1`–`I3`. Tabellen her er bevaret som spec'ens egen optegnelse over, hvad gennemgangen fandt — men en idé, der kun står i en leveret spec, bliver ikke set igen.

| # | Forslag | Hvorfor det er værd at overveje |
|---|---|---|
| ~~1~~ | ~~**Tragt for nye brugere**~~ | ✅ **Bygget 30. juli 2026** — se afsnit 5C. |
| ~~2~~ | ~~**Sammenlign push-tidspunkt med deltagelse**~~ | ✅ **Bygget 30. juli 2026** — se afsnit 5E. |
| ~~3~~ | ~~**Story Engine-regler pr. visning**~~ | ✅ **Bygget 30. juli 2026** — se afsnit 5D. |
| 4 | **Eksport-knap ("kopiér som CSV/JSON")** | Spec'en siger, at SQL-editoren *er* eksport-mekanismen. Det passer for ad hoc-analyse, men ikke for "send tallene videre" — og en knap koster ingen ny afhængighed. → **`I1`** i [`../BACKLOG.md`](../BACKLOG.md). |
| 5 | **Diagnose-historik** | Diagnosen er et øjebliksbillede. Uden historik kan man ikke se, at en liga gik fra "Sund" til "Kun en del tipper" for tre uger siden. Kræver dog et sted at gemme snapshottet — første gang noget i Analytics ville have brug for et cron eller en tabel med tidsserier, hvilket arkitekturvalg #3 lukkede døren for. Tages op, hvis behovet melder sig igen. → **`I2`** i [`../BACKLOG.md`](../BACKLOG.md). |
| 6 | **Alarm ved tilstandsskifte** | Naturlig følge af #5: en liga, der skifter til rød, er interessant i det øjeblik det sker, ikke næste gang nogen åbner admin. Afhænger af #5. → **`I3`** i [`../BACKLOG.md`](../BACKLOG.md), hvor afhængigheden er bevaret som "afhænger af `I2`". |

---

*Leveret. SQL er skrevet mod det dokumenterede skema (`DOCUMENTATION.md` afsnit 2) — verificér mod databasen (`sql/schema.sql` er kun gyldig som reference, når skema-eksporten er kørt efter denne migrering).*
*Tragten, push-effekten og Story Engine-statistikken er verificeret mod en rigtig PostgreSQL 16.13 med en fixtur bygget til formålet: 10 brugere fordelt på selvstartere (heraf tre helt uden liga), inviterede, deltagere uden tip og gennemførere, fire deadline-påmindelser hvoraf to blev åbnet, og to udløste story-regler. Alle fire nye invarianter (6c-6f) gav 0, og JS-laget gav den forventede læsning: selvstarteren taber halvdelen på liga-trinnet, den inviterede er i en liga med det samme og taber først ved første tip.*
*Liga-diagnosen og de rettede vinduer er verificeret mod en rigtig PostgreSQL 16.13 med fire konstruerede ligaer (sund / bæres af én / uden konkurrence / helt ny) — alle invarianter i verifikationsblokken gav 0, og de fire ligaer fik hver den tilsigtede diagnose.*
