# Roadmap — Status og prioritering

**Senest opdateret: 23. juli 2026** · *Levende dokument — opdateres, hver gang en feature leveres eller en beslutning træffes. Filosofien bag prioriteringen: [`PRODUCT_BOOK.md`](./PRODUCT_BOOK.md).*

---

## MVP-status

Opgjort mod MVP-kravene i produktbogens kapitel 3, ud fra den faktiske kodebase.

| MVP-krav | Status | Bemærkning |
|---|---|---|
| Konto og login | ✅ Bygget | Supabase Auth med unikke brugernavne (case-insensitivt). |
| Afgivelse og redigering af tips | ✅ Bygget | Inklusive valgfrit rullende tippevindue pr. konkurrence. |
| Automatisk låsning | ✅ Bygget | Rundebaseret lås i databasen (RLS): hele runden låses 1 time før rundens første kickoff og kan ikke omgås fra brugerfladen. |
| 3–1–0-pointsystem | ✅ Bygget | +3 for præcist resultat, +1 for korrekt udfald, 0 ellers. Ingen minuspoint. |
| Automatisk import af kampe og resultater | ✅ Bygget | Serverless Sportmonks-sync med cron (pt. hver time; hyppigere ved sæsonstart), automatisk holdoprettelse og opdatering af flyttede kampe. |
| Konkurrence- og månedsstillinger | ✅ Bygget | Fulde stillinger med form, præcise hits og placeringsbevægelse. Månedsliga (samlede point, tiebreak: flest præcise) med Månedens Prediction Champ. |
| Global multiplayer-Elo | ✅ Bygget | Én ratingopdatering pr. spillerunde på tværs af alle konkurrencer. Genberegnes automatisk, når resultater gemmes. |
| Enkel ratinghistorik | ✅ Bygget | Ratinghistorik med bevægelse, formkurve og provisorisk markering af nye spillere. |
| Mobilorienteret forside | ✅ Bygget | Hjem-fanen: deadline-kort med nedtælling, live-oversigt over indeværende runde, rating-snapshot og egne placeringer. |
| Invitationer | ✅ Bygget | Delbare invite-links — dog pr. konkurrence, ikke pr. liga (se liga-laget nedenfor). |
| Permanente ligaer | 🟡 Delvist | Konkurrencer findes og kan arkiveres, men der findes ingen permanent liga-enhed (fællesskab), som konkurrencer lever indeni. Bogens vigtigste strukturelle princip er endnu ikke afspejlet i datamodellen. |
| Konkurrencer inde i ligaer | 🟡 Delvist | Konkurrencer er i dag topniveau. Følger af liga-laget ovenfor. |
| Frivillig tilmelding pr. konkurrence | 🟡 Delvist | Opnås i praksis via separate invite-links, men uden liga-lag findes der ikke et sted, hvor et medlem kan se og til-/framelde ligaens konkurrencer. |
| Grundlæggende karriere og head-to-head | ❌ Mangler | Ratinghistorikken er første byggesten, men der findes ingen profil-/karrierevisning og ingen head-to-head-opgørelser. |
| Få, relevante notifikationer | ✅ Bygget | Web Push (juli 2026): deadline-påmindelse før rundelåsen og runde-resultat med point og placering. `notification_log` sikrer, at samme besked aldrig sendes to gange. |
| Story Engine (enkel første version) | 🟡 Skyggetilstand | v1 bygget: `stories`+`latest_story`, `generate_stories()` (9 regler) i matches-triggeren (exception-guarded), guld-historie-kort på Hjem. Vises pt. **kun for admin** — kalibreres på rigtige data, før det åbnes for alle. Spec: [`features/story-engine-v1.md`](./features/story-engine-v1.md). |

**Ud over MVP-listen er der allerede bygget:** flere konkurrenceformater (hel sæson, enkelt hold, datointerval, håndplukkede kampe, tilfældig kupon), arkivering pr. bruger, indsigt i andres tips for afsluttede runder, PWA-installation, en fuld admin-flade til kampe og resultater, DB-views til runde- og sæsonstillinger (`round_standings`/`season_standings`), en vitest-testsuite, staging-konfiguration, optimeret rating-trigger og rundebaseret åbningsvindue for tips.

---

## Kendte afvigelser mellem bog og app

- **Spillerunder:** Bogen beskriver en global tirsdag–mandag-runde på tværs af turneringer. Appen beregner i dag pr. turneringsrunde — hvilket med Superligaen alene reelt er det samme. Ombygning til kalenderuger udskydes bevidst, til flere turneringer er i drift.
- **Navngivning:** Appen hedder i dag Prediction Champ; bogen anvender arbejdstitlen Prediction Hub. Endelig navnebeslutning udestår.
- ~~**Månedsliga-beskrivelser:** "Sådan virker det"-siden sagde "point pr. kamp i gennemsnit".~~ **Lukket (juli 2026):** `HowItWorksScreen.jsx` retter nu teksten til **samlede point** (tiebreak: flest præcise), så den matcher `monthly_standings`-viewet og Championship-visningen. Gennemsnit bruges kun i ratingen.

---

## Prioriteret rækkefølge

Ét princip: størst mulig fastholdelseseffekt pr. indsats, i den rækkefølge der lader hvert trin bygge på det forrige.

| Nr. | Indsats | Hvorfor nu | Omfang |
|---|---|---|---|
| 1 | **Story Engine v1 (regelbaseret)** | ✅ Bygget, kører i skyggetilstand (kun admin). Produktets motor ifølge kapitel 6. Ingen AI. Næste: verificér tone/mængde på 1–2 rigtige runder, kalibrér tærskler (A4), åbn så for alle. | Mellem |
| 2 | **Head-to-head som historieregel** | Indgår allerede i Story Engine v1-kataloget (regel 40 og 60) i stedet for en selvstændig statistikside — billigere og mere i bogens ånd. | Lille |
| 3 | **Liga-laget (permanente fællesskaber)** | Bogens vigtigste strukturelle princip og den største ændring. En gruppe-tabel oven på de eksisterende konkurrencer (konkurrencer får et gruppetilhør, medlemskab flyttes til gruppen, til-/framelding pr. konkurrence). Kan indføres uden at rive det eksisterende ned — Ligaer-fanen er allerede navngivet til det. **Plan/spec skrevet (juli 2026): [`features/liga-laget-v1.md`](./features/liga-laget-v1.md)** — 3 faser (DB-fundament → liga-UI → blød migrering), afventer godkendelse af A6–A8. | Stor |
| 4 | **Karriereprofil** | Første version: ratingkurve over tid, titler (månedstitler), længste stimer og største rivaler. Bliver markant mere værdifuld, når Story Engine og liga-laget har produceret indhold i nogle måneder. | Mellem |
| 5 | **Global tirsdag–mandag-runde** | Udskydes bevidst, til flere turneringer (Premier League, Champions League) er i drift — først dér adskiller den sig reelt fra turneringsrunder. | Mellem |

**Tommelfingerregel:** Trin 1–2 kan leveres inden for den igangværende sæson og bygger direkte oven på de nye push-notifikationer (historierne kan på sigt genbruges som indhold i runde-resultat-notifikationen). Trin 3 modnes i Del 2 af produktbogen, før den bygges. Trin 4–5 venter, til der er data og turneringer nok til, at de giver mening.

---

## Åbne beslutninger (beslutningslog)

Spørgsmål, der er identificeret, men bevidst ikke afgjort endnu. Når en beslutning træffes, flyttes den til "Trufne beslutninger" med dato og begrundelse.

| # | Spørgsmål | Kontekst | Afgøres |
|---|---|---|---|
| A1 | **Navn: Prediction Hub eller Prediction Champ?** | Appen hedder Champ, bogen Hub. | Før markedsføring ud over vennekredsen. |
| A2 | **Månedsliga ved flere turneringer: samlede point eller snit?** | Total belønner aktivitet (flere konkurrencer = flere kampe = fordel); snit belønner præcision. Med kun Superliga er det ligegyldigt. | Når turnering nr. 2 tilføjes (Del 2). |
| A3 | **Story Engine ved stille runder: intet kort eller dæmpet "status quo"-kort?** | Bogen siger stilhed er en funktion; udkastet anbefaler intet kort. **v1-default: intet kort (stilhed).** | Revurderes efter skyggetilstand, på rigtige data. |
| A4 | **Story Engine-tærskler: comeback ≥3 pladser, stime ≥3 runder** | Rene gæt — skal kalibreres. **v1-default: spec'ens tærskler (comeback ≥3, stime ≥3), kører i skyggetilstand.** | Kalibreres efter skyggetilstand, på rigtige data. |
| A5 | **Emojis i historie-kort: til eller fra?** | Gør kortet skimbart på mobil, men mindre klassisk. **v1-default: emojis til.** | Revurderes efter skyggetilstand. |
| A6 | **Liga-laget: hvem må oprette konkurrencer i en liga?** | Bogen gør admin til vært, ikke gatekeeper. **Anbefalet default: alle medlemmer** (mindst friktion; kan strammes senere uden datamodel-ændring). Se [`features/liga-laget-v1.md`](./features/liga-laget-v1.md) afsnit 11. | Før liga-lagets fase 2. |
| A7 | **Liga-laget: skal konkurrence-invite-links udfases?** | Ét link pr. liga er målet. **Anbefalet default: behold konkurrence-links som fallback**, skjul dem i UI for liga-konkurrencer. | Når "Øvrige konkurrencer" er tom i praksis. |
| A8 | **Liga-laget: gæste-deltagelse i én konkurrence uden liga-medlemskab?** | **Anbefalet default: nej** — join via konkurrence-link melder én ind i både liga og konkurrence. Én regel, ingen kant-tilfælde. | Før liga-lagets fase 3. |

## Trufne beslutninger

| Dato | Beslutning | Begrundelse |
|---|---|---|
| Juli 2026 | Pointsystem forenklet til 3–1–0 uden minuspoint. | Simulering viste, at minuspoint forvirrede og lod en "tip altid uafgjort"-strategi konkurrere. |
| Juli 2026 | Rundebaseret tipslås (hele runden låses ved tidligste kickoff −1 t) i stedet for pr. kamp. | Lukker muligheden for at justere sene tips efter tidlige resultater. |
| Juli 2026 | Rating beregnes som gennemsnitspoint pr. kamp; Månedsliga som samlede point. | Rating skal være fair på tværs af deltagelsesomfang; Månedsliga må gerne belønne deltagelse (revurderes i A2). |
| Juli 2026 | Stack fastholdes som Vite + React + JavaScript (ikke Next.js/TypeScript/Tailwind). | Migrering ville koste uger uden brugerværdi. Teknologien må ikke definere produktet. |
| Juli 2026 | Head-to-head bygges som Story Engine-regler, ikke som statistikside. | Billigere, og i tråd med "Stories over Statistics". |
| Juli 2026 | Push-notifikationer: kun to beskedtyper (deadline-påmindelse og runde-resultat), dedupleret via `notification_log`. | "Få, relevante notifikationer" — hellere to beskeder, der altid rammer, end ti, der støjer. |
| Juli 2026 | Stillinger beregnes i DB-views (`round_standings`, `season_standings`) frem for i browseren. | PostgreSQL som kilde til sandhed; skalerer med flere brugere og kampe. |
| Juli 2026 | `SYNC_SECRET` sendes til serverfunktionerne via headeren `x-sync-secret` (query-string `?secret=` bevaret som fallback). | Hemmeligheden skal ikke ende i request-logs. Verificeret: kald uden header giver 401, cron-jobs med header giver 200. **Senere (teknisk gæld):** fjern `?secret=`-fallbacken helt, så kun headeren accepteres — først når alle cron-jobs (ét sync-job pr. liga + notifikations-jobbet) er bekræftet flyttet til headeren, ellers fejler de med 401. |
| Juli 2026 | Story Engine v1: udvælgelsen pr. bruger pr. runde er deterministisk — `priority asc`, dernæst største liga (snapshottet `league_size desc`), dernæst `competition_id`/`id` som garanteret unik tiebreak. Ligastørrelse aflæses IKKE live. | Fler-liga-brugere udløser flere kandidater; visningen skal altid give præcis én, reproducerbar historie, der ikke driver, når medlemskab ændres. Detaljer i [`features/story-engine-v1.md`](./features/story-engine-v1.md) afsnit 6. |
| Juli 2026 | Liga-lagets DB-enhed hedder `groups`/`group_members` (UI: "liga"); eksisterende konkurrencer migreres blødt (`group_id = null` → opretteren flytter selv, deltagere følger med som medlemmer). | Ordet "liga" kolliderer med `leagues` (fodboldturneringer) i skemaet. Automatisk gruppering kan gætte forkert og flytte medlemskaber uden samtykke. Detaljer i [`features/liga-laget-v1.md`](./features/liga-laget-v1.md) afsnit 2 og 6. |
| Juli 2026 | Story-kortet placeres som eget kort **direkte under Hjem's tips-status** (ikke øverst, ikke i samme slot), vises **altid** (også ved rødt "mangler tips") og er guld-fremhævet. Erstatter tidligere "deadline slår historie"-udkast. | Bruger vil både mødes af "hvad skal jeg gøre" (tips øverst) og "hvad skete der" (historie lige under). Separat, altid-synligt kort matcher "Stories over Statistics"; deadline beholder toppen. |
