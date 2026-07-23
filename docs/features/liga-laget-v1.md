# Feature: Liga-laget v1 (permanente fællesskaber)

**Status: Godkendt — klar til implementering (fase 1 først)** · *Filosofi: [`../PRODUCT_BOOK.md`](../PRODUCT_BOOK.md), kapitel 4–5 · Prioritering: [`../ROADMAP.md`](../ROADMAP.md), trin 3*

*Bogens vigtigste strukturelle princip: ligaen (fællesskabet) er produktets centrum. Konkurrencer er kapitler i ligaens historie. Denne plan indfører liga-laget oven på det eksisterende — uden at rive noget ned.*

---

## 1. Formål

I dag er **konkurrencer topniveau**: en "liga" på Ligaer-fanen er reelt én konkurrence med sit eget invite-link og sin egen deltagerliste. Når en sæson slutter, slutter fællesskabet med den — man må starte forfra med et nyt link og en ny deltagerliste. Det strider mod bogens kerneprincip: *en liga forsvinder aldrig*.

Liga-laget indfører en **permanent liga-enhed (et fællesskab)**, som konkurrencer lever indeni:

1. **Ligaen er permanent.** Medlemskab, historik og identitet bor på ligaen — ikke på den enkelte konkurrence.
2. **Konkurrencer er kapitler.** Ny sæson = ny konkurrence i samme liga. Ét invite-link pr. liga, ikke pr. konkurrence.
3. **Til-/framelding pr. konkurrence.** Hvert medlem vælger selv, hvilke af ligaens konkurrencer det deltager i. To medlemmer kan spille forskellige konkurrencer og stadig være i samme fællesskab.

Det, der IKKE ændres: pointsystem, låseregler, rating, Championship-fanen, `predictions`-modellen (delt pr. bruger pr. kamp) og alle eksisterende konkurrencer — de bliver ved med at virke, også uden liga (afsnit 6).

---

## 2. Begreber og navngivning (vigtig kollision)

Ordet "liga" er i dag brugt om **to forskellige ting** (fodboldligaer og private konkurrencer). Med liga-laget indføres en fast ordbog, så hvert ord kun betyder én ting:

| UI-ord (besluttet) | Betydning | DB |
|---|---|---|
| **Turnering** | Fodboldliga/turnering fra Sportmonks (Superligaen, Premier League …) | `leagues` (uændret navn — kun UI-teksten skifter) |
| **Liga** | Fællesskabet — den nye permanente enhed | `groups` / `group_members` |
| **Konkurrence** | En tippekonkurrence (kapitel i en liga) | `competitions` (uændret) |

**Beslutninger:**

- Den nye DB-enhed hedder `groups` (medlemmer: `group_members`) for at undgå kollision med `leagues`. I al brugervendt tekst hedder den "liga" — det er bogens sprog, og Ligaer-fanen er allerede navngivet til det. I kode-kommentarer skrives "liga (group)" ved risiko for forveksling.
- **Alt i UI, der handler om fodboldligaer, omdøbes til "turnering"** — så "liga" udelukkende betyder fællesskabet. Konkrete steder (fejes i fase 2 sammen med den nye UI):
  - `PredictionsScreen.jsx`: turnerings-filteret ("Alle ligaer" → "Alle turneringer", fallback-navnet "Liga" → "Turnering").
  - `CreateCompetitionScreen.jsx`: turneringsvalg ved oprettelse ("Ingen kommende kampe i de valgte ligaer" → "… valgte turneringer" m.fl.).
  - `AdminScreen.jsx`: "denne liga" → "denne turnering" (Sportmonks-sync-teksten). "Med i en privat liga"-statistikken omformuleres til konkurrence/liga-sprog, når liga-laget er ude.
  - `HowItWorksScreen.jsx`: gennemskrives med ordbogen (fx "Nogle ligaer bruger et rullende vindue" → "Nogle konkurrencer …").
  - `ChampionshipTab.jsx` / `RatingTab.jsx`: InfoDot-tekster som "på tværs af alle ligaer" → "på tværs af alle dine konkurrencer".
  - DB-navne (`leagues`, `league_id`) og interne variabelnavne røres ikke — det er en ren UI-tekst-omdøbning.

---

## 3. Brugerflow

### Opret liga
Fra Ligaer-fanen: "Opret liga" → navn (2–40 tegn) → færdig. Opretteren bliver liga-admin. Under ét minut, ingen andre felter i v1 (ingen ikoner/farver/beskrivelser — identitet kan komme senere).

### Invitér
Ét delbart link pr. liga: `?liga=<kode>` (samme mønster som dagens `?join=<kode>`, ny parameter så de to kodetyper ikke blandes). Modtageren ser bekræftelses-modalen ("{navn} har inviteret dig til ligaen {liga}") og lander efter join på liga-siden. "Join med kode"-kortet på Ligaer-fanen accepterer begge kodetyper (slår først liga-koder op, dernæst konkurrence-koder).

### Liga-siden (ny drill-in-skærm)
Klik på et liga-kort på Ligaer-fanen → liga-siden:

- **Konkurrencer** i ligaen, delt i aktive/afsluttede (samme kort-stil som i dag: navn, type, deltagere, egen placering, klik → Stilling).
- **Deltag/Forlad** pr. konkurrence: står man udenfor, viser kortet en "Deltag"-knap (insert i `competition_participants`); er man med, kan man framelde sig via kortmenuen (delete af egen række — kun så længe man ikke har låste/spillede tips i konkurrencen, ellers arkivér som i dag). Det er her, bogens "frivillig tilmelding pr. konkurrence" endelig får et hjem.
- **Medlemmer**: navneliste med admin-markering og "medlem siden".
- **Invitér**-knap (kopierer liga-linket) og **"Opret konkurrence"** (åbner det eksisterende opret-flow med ligaen forvalgt).
- **Forlad liga** (nederst, diskret): fjerner medlemskab; egne konkurrence-deltagelser i ligaen frameldes ikke automatisk (man kan være gæst i en enkelt konkurrence — se A8 i åbne beslutninger).

### Opret konkurrence
Det eksisterende flow får ét nyt felt øverst: **"Liga"** (dropdown over ligaer, man er medlem af, + "Ingen liga"). Kommer man fra liga-siden, er ligaen forvalgt. En konkurrence i en liga får intet eget invite-link i UI — medlemmerne finder og tilmelder sig den på liga-siden. Opretteren tilmeldes selv automatisk (som i dag).

### Ligaer-fanen (omstruktureret)
1. Brugerens **ligaer** som kort (navn, antal medlemmer, antal aktive konkurrencer, evt. egen bedste placering).
2. **"Øvrige konkurrencer"**: eksisterende/nye konkurrencer uden liga — uændret adfærd (kort, join med kode, arkivér, slet). Sektionen er overgangslaget, ikke en blindgyde: den forsvinder naturligt, efterhånden som konkurrencer flyttes ind i ligaer.
3. Opret liga · Join med kode.

### Hjem
"Dine placeringer" grupperes pr. liga (liga-navn som lille overskrift over dens konkurrencer; "Øvrige" for liga-løse). Ellers uændret.

---

## 4. Datamodel og RLS

Nyt idempotent script `sql/groups.sql` (køres i Supabase-editoren med "Run without RLS", jf. dokumentationens afsnit 13).

```sql
create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 40),
  invite_code text not null unique default substr(md5(random()::text), 1, 8),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table group_members (
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table competitions add column if not exists group_id uuid references groups(id) on delete set null;
```

**RLS:**

| Objekt | Regel |
|---|---|
| `groups` SELECT | `authenticated` (åben læsning — nødvendig for join-med-kode-opslag; samme bevidste valg som for `competitions` i dag, jf. fejlfindingsloggen "Kunne ikke joine med kode") |
| `groups` INSERT | `created_by = auth.uid()` |
| `groups` UPDATE/DELETE | kun liga-admin (via hjælpefunktion, se nedenfor). DELETE kaskaderer til `group_members`; konkurrencer får `group_id = null` (bliver liga-løse, slettes IKKE) |
| `group_members` SELECT | egne rækker + rækker i ligaer, man selv er medlem af — **via `security definer`-hjælpefunktionen `is_group_member(gid uuid)`**, aldrig ved at policy'en slår op i `group_members` direkte (kendt "infinite recursion"-fælde, jf. fejlfindingsloggen) |
| `group_members` INSERT | `user_id = auth.uid()` (man melder sig selv ind — koden er adgangsbilletten) |
| `group_members` DELETE | `user_id = auth.uid()` (forlad liga). Admin-fjernelse af andre er bevidst udskudt (afsnit 8) |
| `competition_participants` DELETE | **ny policy**: egen række, og kun hvis brugeren ingen forudsigelser har på konkurrencens allerede låste kampe (samme runde-lås-udtryk som `sql/predictions_round_lock_policies.sql`) — så framelding ikke kan bruges til at slette en dårlig, synlig historik midt i et forløb |

Opretteren indsættes som `role='admin'` i samme flow som liga-oprettelsen (frontend laver to inserts; rækkefølgen er ufarlig, da INSERT-policyen kun kræver eget `user_id`).

**Ingen ændringer** i `predictions`, `matches`, `ratings`, standings-views eller triggere. `ratings.scope` holder allerede døren åben for per-liga-rating senere — liga-laget er forudsætningen, ikke en del af v1.

---

## 5. Frontend-ændringer (pr. fil)

| Fil | Ændring | Omfang |
|---|---|---|
| `src/lib/data.js` | Nye helpers: `loadMyGroups` (ligaer + medlemstal + aktive konkurrencer i ét kald pr. liste), `loadGroupDetail` (medlemmer + ligaens konkurrencer + egne deltagelser), `createGroup`, `joinGroupByCode`, `leaveGroup`, `joinCompetitionInGroup`, `leaveCompetition`, `moveCompetitionToGroup` | Mellem |
| `src/screens/LigaerTab.jsx` | Omstruktureres: liga-kort øverst, "Øvrige konkurrencer" nedenunder (genbruger `LeagueCard`), "Opret liga", fælles join-felt | Mellem |
| `src/screens/GroupScreen.jsx` (**ny**) | Liga-siden: konkurrencer med Deltag/Forlad, medlemsliste, Invitér, Opret konkurrence, Forlad liga, "Flyt konkurrence hertil" (kun for konkurrence-oprettere, afsnit 6) | Stor |
| `src/screens/MainApp.jsx` | `?liga=<kode>`-deep-link (parallelt med `?join=`), ny screen-type `group`, navigation Ligaer → liga-side | Lille |
| `src/screens/CreateCompetitionScreen.jsx` | Liga-dropdown (forvalgt fra liga-siden), skriver `group_id`; invite-link-visning skjules for liga-konkurrencer | Lille |
| `src/screens/HjemTab.jsx` | "Dine placeringer" grupperet pr. liga | Lille |
| `src/screens/BoardScreen.jsx` | "Invitér"-knappen viser liga-linket, når konkurrencen har en liga (ellers uændret konkurrence-link) | Lille |
| `src/screens/HowItWorksScreen.jsx` | Nyt afsnit: liga vs. konkurrence, til-/framelding | Lille |
| `src/App.jsx` | Læs `?liga=`-parameteren ved boot (samme mønster som `pendingJoinCode`) | Lille |
| Terminologi-fejning | Fodboldliga → "turnering" i al UI-tekst (afsnit 2: PredictionsScreen, CreateCompetitionScreen, AdminScreen, HowItWorks, Championship-/Rating-InfoDots) | Lille |
| `src/lib/*.test.js` | Tests af de nye helpers med mocket database (samme stil som `data.test.js`) | Lille |

Ingen ændringer i `api/` — liga-laget er rent DB + frontend.

---

## 6. Eksisterende konkurrencer: blød migrering

**Princip: ingen automatisk gruppering.** Vi kan ikke gætte, hvilke konkurrencer der hører til samme fællesskab (samme opretter kan sagtens køre to adskilte vennegrupper), og et forkert gæt ville flytte medlemskaber uden samtykke. I stedet:

1. **Dag 1:** Alle eksisterende konkurrencer har `group_id = null` og virker præcis som før under "Øvrige konkurrencer". Intet i brugernes verden går i stykker; gamle `?join=`-links virker uændret.
2. **"Flyt til liga":** En konkurrences opretter kan flytte den ind i en liga, vedkommende er medlem af (sætter `group_id`). Ved flytning tilføjes konkurrencens nuværende deltagere automatisk som medlemmer af ligaen (`role='member'`, hvis de ikke allerede er med) — fællesskabet følger med, ingen mister adgang eller skal gen-invitere. Udføres af en `security definer`-funktion `move_competition_to_group(comp_id, group_id)` (guard: kalderen ejer konkurrencen og er medlem af mål-ligaen — jf. A6, ingen admin-gate), da almindelig RLS ikke kan indsætte andres medlemsrækker.
3. **Engangs-nudge:** Første gang en bruger med egne liga-løse konkurrencer åbner Ligaer-fanen efter udrulning, vises et lille kort: "Nyt: Saml dine konkurrencer i en liga" → opret liga → flyt. Kan afvises (localStorage).
4. **Gamle konkurrence-links:** `?join=<konkurrence-kode>` fortsætter med at virke. Peger koden på en konkurrence i en liga, melder joinet brugeren ind i **både ligaen og konkurrencen** (én bekræftelse: "…inviteret til {konkurrence} i ligaen {liga}").

---

## 7. Faseplan

Hver fase kan merges og udrulles separat (test på preview, jf. tjeklisten i `DOCUMENTATION.md` afsnit 11).

| Fase | Indhold | Omfang | Kan merges alene? |
|---|---|---|---|
| **1. DB-fundament** ✅ | `sql/groups.sql` **leveret**: tabeller, RLS, `is_group_member()`/`is_group_admin()`, `move_competition_to_group()`, `competitions.group_id`, `competition_participants`-DELETE-policy. Skal køres i Supabase (staging først). | Lille | Ja — ingen UI-effekt |
| **2. Liga-UI** ✅ | **Leveret:** opret liga, liga-kort på Ligaer-fanen, liga-siden (`GroupScreen`: medlemmer, konkurrencer, Deltag/Forlad, Invitér), `?liga=`-deep-link, liga-dropdown i opret-konkurrence, terminologi-fejning (fodboldliga → "turnering"), BoardScreen deler liga-link. *Hjem-gruppering pr. liga udskudt som kosmetisk polish (konkurrencer vises fortsat korrekt i "Dine placeringer").* | Stor | Ja — liga-løse konkurrencer uberørte |
| **3. Adoption** ✅ | **Leveret sammen med fase 2:** "Flyt til liga"-flowet (`move_competition_to_group` fra GroupScreen), engangs-nudge på Ligaer-fanen, samlet join-felt (liga- eller konkurrence-kode; konkurrence-link melder også ind i ligaen), HowItWorks-tekst. QA-tjekliste udvides ved staging-verifikation. | Mellem | Ja |
| **4. Efterfølgende (uden for v1)** | Per-liga-rating (`ratings.scope`), Story Engine-tekster med liga-navn, medlems-administration (fjern/forfrem), liga-identitet (ikon/farve), Karriereprofil-titler pr. liga | — | Separate features |

Rækkefølgen respekterer roadmappens tommelfingerregel: Story Engine-kalibreringen (trin 1–2) kører videre uafhængigt; liga-laget rører ikke trigger-flowet.

---

## 8. Bevidst IKKE med i v1

- **Medlems-administration** (admin fjerner/forfremmer medlemmer) — lille brugerbase af venner; udskydes til behovet opstår.
- **Liga-identitet** (ikon, farve, beskrivelse) — navn er nok til at bevise strukturen.
- **Per-liga-rating og per-liga-månedsliga** — `scope`-kolonnen er forberedt; egen feature senere (åben beslutning A2 hænger sammen).
- **Offentlige/søgbare ligaer** — invite-link er eneste indgang (bogen: vækst gennem eksisterende fællesskaber).
- **Sletning af ligaer med indhold i UI** — v1 tillader kun sletning af tomme ligaer (ingen konkurrencer); ellers via admin/DB. Undgår destruktive fejlklik på fællesskabets kerne.

---

## 9. Acceptkriterier

- En bruger kan oprette en liga, dele ét link, og en modtager kan joine og se liga-siden — uden at nogen konkurrence findes endnu.
- En konkurrence oprettet i en liga er synlig for alle liga-medlemmer på liga-siden; kun de, der aktivt har trykket "Deltag", optræder i dens stilling.
- Et medlem kan framelde sig en konkurrence, det ikke er begyndt i — men ikke en, hvor det har tips på låste kampe (RLS håndhæver, ikke kun UI).
- Alle eksisterende konkurrencer virker uændret uden liga; gamle `?join=`-links virker fortsat.
- Flytning af en konkurrence til en liga bevarer stilling, tips og deltagere 1:1, og deltagerne bliver liga-medlemmer.
- En bruger, der ikke er medlem af en liga, kan ikke læse dens medlemsliste (RLS), men kan slå navnet op via invite-koden.
- Ingen "infinite recursion"-fejl fra `group_members`-policies (verificér eksplicit — kendt fælde).
- Rating, Championship, månedsliga, runde-lås og Story Engine er upåvirkede (regressions-tjeklisten består).

## 10. Testcases

1. Opret liga → join via `?liga=`-link fra anden konto → begge ser samme medlemsliste; ikke-medlem ser den ikke.
2. Opret konkurrence i ligaen fra liga-siden → medlem B ser den med "Deltag"-knap; B deltager → optræder i stillingen fra 0 point (eksisterende "start fra næste runde"-regel).
3. B frameldes en konkurrence uden låste tips → rækken slettes, stillingen opdateres. B forsøger framelding med tips på låst runde → afvises af RLS.
4. Flyt eksisterende konkurrence (3 deltagere) til ny liga → alle 3 er nu medlemmer; stilling uændret; gammel `?join=`-kode melder en ny bruger ind i både liga og konkurrence.
5. Forlad liga → ligaens konkurrencer forsvinder fra Ligaer-fanen; egne tips/historik i `predictions` er intakte.
6. Slet liga (tom) → ok; slet-knap vises ikke på liga med konkurrencer.
7. Join med kode-feltet: liga-kode rammer liga-flowet, konkurrence-kode rammer det gamle flow.
8. `npm test` grøn; fuld "Tjekliste før merge" gennemgået på preview (staging-DB, da `sql/groups.sql` skal køres før fase 2 testes).

---

## 11. Beslutninger (afgjort juli 2026)

Godkendt sammen med planen; ført i roadmappens beslutningslog:

| # | Spørgsmål | Beslutning |
|---|---|---|
| A6 | Hvem må oprette konkurrencer i en liga — kun liga-admin eller alle medlemmer? | **Alle medlemmer.** Bogen gør admin til vært, ikke gatekeeper; mindst friktion i små vennegrupper. Kan strammes senere uden datamodel-ændring. |
| A7 | Skal konkurrence-invite-links udfases, når liga-laget er i drift? | **Behold som fallback i v1**, skjul dem blot i UI for liga-konkurrencer. Udfasning besluttes, når "Øvrige konkurrencer" er tom i praksis. |
| A8 | Kan man deltage i en enkelt konkurrence uden at være liga-medlem ("gæst")? | **Nej i v1** — deltagelse i en liga-konkurrence kræver medlemskab (join via konkurrence-link melder én ind i begge, afsnit 6). Én regel, ingen kant-tilfælde. |
| — | UI-terminologi for fodboldligaer | **"Turnering"** i al brugervendt tekst; "liga" betyder herefter kun fællesskabet (afsnit 2). DB-navne uændrede. |

---

*Næste skridt: Implementér fase 1 (`sql/groups.sql` på staging) → fase 2 som feature-branch (liga-UI + terminologi-fejning) → fase 3 (adoption).*
