# Roadmap — Status og prioritering

**Senest opdateret: 22. juli 2026** · *Levende dokument — opdateres, hver gang en feature leveres eller en beslutning træffes. Filosofien bag prioriteringen: [`PRODUCT_BOOK.md`](./PRODUCT_BOOK.md).*

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
| Story Engine (enkel første version) | ❌ Mangler | Findes ikke i appen endnu, men **v1 er nu fuldt specificeret** i [`features/story-engine-v1.md`](./features/story-engine-v1.md) — regelkatalog, tekster, datamodel, acceptkriterier og udrulning. Klar til implementering. |

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
| 1 | **Story Engine v1 (regelbaseret)** | Produktets motor ifølge kapitel 6 — og dataene findes allerede. Spec klar: [`features/story-engine-v1.md`](./features/story-engine-v1.md). Ingen AI nødvendig i v1. Start i skyggetilstand de første 1–2 runder. | Mellem |
| 2 | **Head-to-head som historieregel** | Indgår allerede i Story Engine v1-kataloget (regel 40 og 60) i stedet for en selvstændig statistikside — billigere og mere i bogens ånd. | Lille |
| 3 | **Liga-laget (permanente fællesskaber)** | Bogens vigtigste strukturelle princip og den største ændring. En gruppe-tabel oven på de eksisterende konkurrencer (konkurrencer får et gruppetilhør, medlemskab flyttes til gruppen, til-/framelding pr. konkurrence). Kan indføres uden at rive det eksisterende ned — Ligaer-fanen er allerede navngivet til det. Modnes i Del 2, før den bygges. | Stor |
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
| A3 | **Story Engine ved stille runder: intet kort eller dæmpet "status quo"-kort?** | Bogen siger stilhed er en funktion; udkastet anbefaler intet kort. | Efter skyggetilstand, på rigtige data. |
| A4 | **Story Engine-tærskler: comeback ≥3 pladser, stime ≥3 runder** | Rene gæt — skal kalibreres. | Efter skyggetilstand, på rigtige data. |
| A5 | **Emojis i historie-kort: til eller fra?** | Gør kortet skimbart på mobil, men mindre klassisk. | Efter skyggetilstand. |

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
