# Feature: Story Engine v1

**Status: Specificeret — klar til implementering (skyggetilstand først)** · *Filosofi: [`../PRODUCT_BOOK.md`](../PRODUCT_BOOK.md), kapitel 6 · Prioritering: [`../ROADMAP.md`](../ROADMAP.md), trin 2*

*Regelbaseret første version. Ingen AI. Bygget på data, der allerede findes i databasen.*

---

## 1. Formål

Story Engine v1 skal gøre én ting: Når en spillerunde er afsluttet, skal hver bruger mødes af **én historie**, der fortæller, hvad runden betød *for dem* — ikke hvad der skete.

Tre principper fra produktbogen er ufravigelige:

1. **Én historie ad gangen.** Sker der fem interessante ting, vises kun den vigtigste.
2. **Personlig.** Jimmy og Nikolaj ser forskellige historier om den samme begivenhed.
3. **Stilhed er tilladt.** En kedelig runde skal ikke pustes op. Ingen historie er bedre end en tvungen historie.

Én designregel tilføjes i v1: **Historier driller — de ydmyger aldrig.** Positionsskift og overhalinger er fair game (det er konkurrencens natur), men der genereres aldrig historier af typen "du er sidst" eller "din dårligste runde nogensinde". Negative historier slutter altid fremadrettet eller neutralt — aldrig med nederlaget som sidste ord.

---

## 2. Brugerflow

**Hvornår opstår en historie?**
Historier genereres, når en runde afsluttes — dvs. når alle rundens kampe har fået resultat, og ratings er genberegnet (det trigger-flow findes allerede). Rækkefølgen er vigtig: point → stillinger → ratings → **historier**. Dermed kan historieregler læse på friske ratings.

**Hvor ser brugeren den?**
Ét **historie-kort** øverst på Hjem-fanen:

- Kortet vises fra runden afsluttes, og indtil næste runde er afsluttet (eller brugeren afviser det).
- Når en ny rundes deadline nærmer sig, viger historie-kortet for deadline-kortet — deadline er altid vigtigst, når der skal handles.
- Kortet har en "Del"-knap, der deler historien som tekst (`navigator.share`, fallback til udklipsholder). Det er ambassadør-princippet fra kapitel 3: giv den person, der taler mest om konkurrencen, noget at sende i gruppens beskedtråd.

**Hvad hvis intet skete?**
Så vises **intet kort** — ikke et "status quo"-kort, bare stilhed. Det gør de ægte historier mere værd. (Åben beslutning A3 i roadmappen: revurderes efter skyggetilstand.)

---

## 3. Regelkataloget (prioriteret)

Hver regel har et prioritetstal. Pr. bruger pr. runde vælges historien med lavest tal; ved lighed vinder historien fra den største liga.

| Prio | Regel | Udløses når | Datakilde |
|---|---|---|---|
| 10 | Månedens Champ | Måneden slutter, og brugeren vandt Månedsligaen | `monthly_standings` |
| 20 | Førsteplads overtaget | Brugeren gik fra ikke-1. til 1. i en liga | rundestillinger |
| 21 | Førsteplads mistet | Brugeren gik fra 1. til ikke-1. (nævn hvor længe de førte) | rundestillinger |
| 30 | Ny ratingrekord | Rating oversteg personlig all-time high (kun efter provisorisk periode) | `rating_history` |
| 40 | Head-to-head-overhaling | Første gang denne sæson foran spiller X i en liga, hvor man før var bagud | rundestillinger |
| 50 | Comeback | Rykkede ≥3 pladser op i én runde (ligaer med ≥5 deltagere) | rundestillinger |
| 60 | Stime mod rival | Slået samme spiller ≥3 runder i træk (flere rundepoint) | rundepoint pr. par |
| 70 | Rundens vinder | Flest point i runden i en liga (delt: flest præcise) | rundepoint |
| 80 | Perfekt træfsikkerhed | ≥3 præcise resultater i én runde | `predictions` + resultater |
| — | *Stilhed* | Ingen regel udløst → intet kort | — |

**Bevidst ikke med i v1:** sæsonresuméer, negative præstationshistorier, historier om andre end brugeren selv ("Anders slog rekord") og alt, der kræver fritekst-generering. Kataloget er lille med vilje — hellere 9 regler, der rammer præcist, end 30, der støjer.

---

## 4. Teksterne

Skabelon pr. regel med felter i `{klammer}`, plus renderingseksempel. Hver body indeholder præcis ét tal-anker (forspring, afstand, placering), så historien føles konkret uden at blive en statistikside. Emojis er åben beslutning A5.

### 10 · Månedens Champ
> 👑 **Du er Månedens Prediction Champ — {måned}**
> "{point} point over {n} runder — flest af alle i {måned}. {evt: {navn} var tættest på med {gap} point færre.}"

*Eksempel: "31 point over 4 runder — flest af alle i juli. Jimmy var tættest på med 3 point færre."*

### 20 · Førsteplads overtaget
> 🏆 **Du overtog førstepladsen i {liga}**
> "{udløser} gav dig {point} point i runde {r} — nok til at vippe {navn} af tronen efter {n} runder. Forspring: {gap} point."

*Eksempel: "Dit præcise tip på FCM–AGF (2-1) gav +3 i runde 4 — nok til at vippe Jimmy af tronen efter 3 runder. Forspring: 2 point."*

### 21 · Førsteplads mistet
> ⚡ **{navn} vippede dig af førstepladsen**
> "Du havde ført {liga} siden runde {start}. {navn} scorede {point} point i runde {r} og overtog. Afstand op: {gap} point."

*Eksempel: "Du havde ført Kontoret siden runde 1. Nikolaj scorede 7 point i runde 4 og overtog. Afstand op: 2 point."*

### 30 · Ny ratingrekord
> 📈 **Ny personlig ratingrekord: {rating}**
> "Din stærke runde {r} sendte dig forbi din hidtidige rekord på {gammel}. Du er nu nr. {plads} af {antal} på den globale rangliste."

*Eksempel: "Din stærke runde 7 sendte dig forbi din hidtidige rekord på 1048. Du er nu nr. 3 af 14 på den globale rangliste."*

### 40 · Head-to-head-overhaling
> 🔄 **Du er nu foran {navn} — for første gang**
> "Du har været bagud siden runde {start}. Efter runde {r} fører du {liga}-duellen med {gap} point."

*Eksempel: "Du har været bagud siden runde 2. Efter runde 8 fører du Kontoret-duellen med 1 point."*

### 50 · Comeback
> 🚀 **Fra nr. {a} til nr. {b} på én runde**
> "{udløser} gav dig rundens højeste score i {liga}. Toppen er nu {gap} point væk."

*Eksempel: "Tre præcise resultater gav dig rundens højeste score i Padelklubben. Toppen er nu 5 point væk."*

### 60 · Stime mod rival
> 🔥 **{n}. runde i træk bag {navn}** *(eller spejlvendt: foran)*
> Bagud: "{navn} vandt jeres interne duel igen — {deres} point mod dine {mine}. Runde {næste} er din chance for at bryde stimen."
> Foran: "Du vandt duellen igen — {mine} point mod {navn}s {deres}. Kan du holde stimen i runde {næste}?"

*Eksempel: "Nikolaj vandt jeres interne duel igen — 7 point mod dine 4. Runde 5 er din chance for at bryde stimen."*

### 70 · Rundens vinder
> 🥇 **Du vandt runde {r} i {liga}**
> "{point} point — flest af alle. {evt: Delt med {navn}, men du havde flest præcise resultater.}"

*Eksempel: "9 point — flest af alle i Kontoret."*

### 80 · Perfekt træfsikkerhed
> 🎯 **{n} præcise resultater i én runde**
> "Du ramte {kampe} på kornet. Det gav {point} point og din bedste træfprocent i denne sæson."

*Eksempel: "Du ramte FCK–FCM, AGF–OB og Brøndby–Silkeborg på kornet. Det gav 11 point og din bedste træfprocent i denne sæson."*

---

## 5. Konkrete situationer

### Situation A — Sen scoring flytter førstepladsen

*Runde 4. FCM–AGF ender 2-1 på et mål i overtiden. Nikolaj havde tippet 2-1 (+3). Det sender ham fra 2. til 1. i ligaen "Kontoret", hvor Jimmy har ført siden runde 1. Anders taber dermed 4. runde i træk til Nikolaj.*

Tre brugere, samme mål, tre historier:

- **Nikolaj (prio 20):** 🏆 *Du overtog førstepladsen i Kontoret* — "Dit præcise tip på FCM–AGF (2-1) gav +3 i overtiden — nok til at vippe Jimmy af tronen efter 3 runder. Forspring: 2 point."
- **Jimmy (prio 21):** ⚡ *Nikolaj vippede dig af førstepladsen* — "Du havde ført Kontoret siden runde 1. Et mål i overtiden i FCM–AGF gav Nikolaj de point, der gjorde forskellen. Afstand op: 2 point."
- **Anders (prio 60):** 🔥 *4. runde i træk bag Nikolaj* — "Nikolaj vandt jeres interne duel igen — 7 point mod dine 4. Runde 5 er din chance for at bryde stimen."

### Situation B — Månedsafslutning

*Juli slutter. Vinderen af Månedsligaen har 31 point over 4 runder (samlede point, tiebreak: flest præcise).*

- **Vinderen (prio 10):** 👑 *Du er Månedens Prediction Champ — juli* — "31 point over 4 runder — flest af alle i juli. Jimmy var tættest på med 3 point færre."

Alle andre ser deres normale rundehistorie — månedshistorien genereres kun til vinderen i v1. (Senere kan nr. 2 få en "3 point fra titlen"-variant.)

### Situation C — Ratingrekord i en stille runde

*Runde 7 ændrer ingen placeringer i nogen af Mettes ligaer, men hendes rating stiger fra 1041 til 1052 — ny personlig rekord.*

- **Mette (prio 30):** 📈 *Ny personlig ratingrekord: 1052* — "Din stærke runde 7 sendte dig forbi din hidtidige rekord på 1048. Du er nu nr. 3 af 14 på den globale rangliste."

Havde ratingen ikke slået rekord, havde Mette set **ingenting** — og det er korrekt adfærd.

### Situation D — Comebacket

*Casper har haft tre elendige runder og ligger nr. 8 af 9 i "Padelklubben". I runde 9 rammer han tre præcise resultater og hopper til nr. 4. To regler udløses: Comeback (50) og Perfekt træfsikkerhed (80). Prioriteten vælger:*

- **Casper (prio 50):** 🚀 *Fra nr. 8 til nr. 4 på én runde* — "Tre præcise resultater gav dig rundens højeste score i Padelklubben. Toppen er nu 5 point væk."

---

## 6. Teknisk skitse

Samme mønster som ratings: beregnes i databasen, én gang pr. runde, idempotent.

**Ny tabel `stories`:**

```sql
create table stories (
  id uuid primary key default gen_random_uuid(),
  round_key text not null,
  user_id uuid not null references profiles(id),
  competition_id uuid references competitions(id),  -- null for globale (rating, måned)
  rule text not null,          -- 'LEAD_TAKEN', 'RATING_HIGH', ...
  priority int not null,
  payload jsonb not null,      -- fx {"rival":"Jimmy","led_rounds":3,"gap":2}
  headline text not null,      -- færdigrenderet dansk tekst
  body text not null,
  created_at timestamptz default now(),
  dismissed_at timestamptz,
  unique (round_key, user_id, rule, competition_id)
);
```

- **Både payload og færdig tekst gemmes.** Teksten gør v1 triviel at vise; payloaden gør det muligt senere at forbedre formuleringer eller bygge minde-arkivet uden datatab.
- **Alle udløste kandidater gemmes** (ikke kun vinderen). Visningen vælger laveste prioritet pr. bruger via et view `latest_story`. Det giver gratis råmateriale til "Historier bliver til minder" senere.

**Funktion `generate_stories(round_key)`:**
Sletter og genberegner rundens rækker (idempotent, ligesom `recompute_ratings`). Kaldes til sidst i det eksisterende trigger-flow på `matches` — efter ratings. Reglerne 20–70 beregnes ud fra stillinger før/efter runden, som kan afledes af rundepoint.

**Frontend:** HjemTab henter én række fra `latest_story` og viser kortet. "Afvis" sætter `dismissed_at`. Del-knappen bruger `navigator.share` med headline + body (fallback: udklipsholder).

**RLS:** Brugere kan kun læse rækker med eget `user_id`. Ingen kan se andres historier — de er personlige.

---

## 7. Udrulning

1. **Skyggetilstand (1–2 runder):** Historier genereres, men vises kun for admin. Formålet er at læse dem med friske øjne: Rammer tonen? Er der for mange? For få?
2. **Justér tærskler:** Comeback-grænsen (≥3 pladser) og stime-grænsen (≥3 runder) er gæt — de kalibreres på rigtige data (åben beslutning A4).
3. **Live for alle** med et lille "Nyt: Historier"-kort første gang.

## 8. Acceptkriterier

- Der vises højst én historie pr. bruger pr. runde.
- To brugere i samme liga kan se forskellige historier om samme runde.
- En runde uden udløste regler viser intet historie-kort.
- Genkørsel af `generate_stories` for samme runde ændrer ingenting (idempotent).
- Ingen historie omtaler en bruger negativt om placering i bunden eller dårlige præstationer.
- Historie-kortet viger for deadline-kortet, når der er utippede kampe med nær deadline.
- En bruger kan aldrig læse en anden brugers historier (RLS).
- Månedens Champ-teksten angiver samlede point (aldrig gennemsnit).

## 9. Testcases

1. Runde hvor 1.-pladsen skifter → begge involverede får hver sin historie (prio 20 og 21), øvrige får evt. lavere-prioritetshistorier.
2. Runde uden ændringer og uden rekorder → nul rækker for de fleste brugere, intet kort.
3. Bruger udløser både Comeback og Perfekt træfsikkerhed → kun Comeback vises, begge gemmes.
4. Måned slutter midt i en runde-uge → Månedens Champ-historien knyttes til den runde, der lukkede måneden.
5. Provisorisk spiller (< 5 runder) sætter "rekord" → ingen ratingrekord-historie (reglen er slået fra i provisorisk periode).
6. Resultat rettes af admin efter runden er lukket → trigger genkører ratings og historier; historien opdateres konsistent.

---

*Næste skridt: Godkend regelkatalog og tone → implementér som feature-branch med skyggetilstand → kalibrér på runde 1–2 af den nye sæson.*
