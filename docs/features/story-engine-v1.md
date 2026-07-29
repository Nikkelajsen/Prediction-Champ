# Feature: Story Engine v1

**Status: ✅ Leveret — live for alle brugere (juli 2026) · udvidet til v1.1 (juli 2026, se afsnit 10)** · *Filosofi: [`../PRODUCT_BOOK.md`](../PRODUCT_BOOK.md), kapitel 6 · Prioritering: [`../ROADMAP.md`](../ROADMAP.md), trin 1*

*Regelbaseret første version. Ingen AI. Bygget på data, der allerede findes i databasen.*

> **Læsevejledning.** Dokumentet beskriver v1 som leveret. Afsnit 10 er **v1.1**, som blev bygget efter den første rigtige runde, hvor stort set ingen fik en historie. v1.1 tilføjer regler, sænker tærskler og indfører et **dæmpet tier** — dvs. den ændrer afsnit 3, 4 og 8. Hvor afsnittene modsiger hinanden, gælder afsnit 10.

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
Ét **historie-kort** på Hjem-fanen, som sit eget kort **direkte under tips-status-kortet** (deadline/alt-ok):

- Kortet vises fra runden afsluttes, og indtil næste runde er afsluttet (eller brugeren afviser det).
- Historie-kortet og tips-status deler ikke plads: tips-status forbliver øverst (handling først), og historie-kortet vises **altid** direkte under det — også når det røde "mangler tips"-kort er fremme. Det er bevidst, at man både mødes af "hvad skal jeg gøre" og "hvad skete der".
- Kortet har en "Del"-knap, der deler historien som tekst (`navigator.share`, fallback til udklipsholder). Det er ambassadør-princippet fra kapitel 3: giv den person, der taler mest om konkurrencen, noget at sende i gruppens beskedtråd.

**Hvad hvis intet skete?**
Så vises **intet kort** — ikke et "status quo"-kort, bare stilhed. Det gør de ægte historier mere værd. (Åben beslutning A3 i roadmappen: revurderes på rigtige data. Skyggetilstanden, som A3 oprindeligt skulle vurderes efter, blev fjernet i juli 2026 — kortet er live for alle.)

> **Rettet efter levering (v1.1, juli 2026):** A3 er lukket i den modsatte retning af v1-udkastet. De rigtige data viste, at "intet kort" i praksis betød *intet kort for næsten alle* — i premiereugen 1 af 8 brugere. Der vises nu et **dæmpet** kort (prioritet ≥ 90) til de brugere, der ellers ville stå uden, mens kortet forbliver stille i formen: ingen guldkant, ingen emoji, ingen Del-knap. Se afsnit 10.2.

---

## 3. Regelkataloget (prioriteret)

> **Rettet efter levering (v1.1, afsnit 10):** kataloget er udvidet til 14 regler, tre tærskler er sænket, og "stilhed" er erstattet af et dæmpet tier. Tabellen nedenfor er v1 som leveret.

Hver regel har et prioritetstal. Pr. bruger pr. runde vælges historien med lavest tal; ved lighed vinder historien fra den største liga (flest deltagere). Er en bruger med i flere ligaer, udløses typisk flere kandidater (én eller flere pr. liga + de globale) — alle gemmes, men kun én vises. Den fulde, deterministiske udvælgelses­regel (og hvorfor global-vs-liga aldrig kan gå lige op) står i afsnit 6.

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

**Dette afsnit er rettet til de faktisk leverede tekster (juli 2026).** Udkastet herunder var før-implementering og lovede mere, end motoren har data til: hver body havde et udløser-anker ("Dit præcise tip på FCM–AGF (2-1) gav +3"), et startpunkt ("siden runde 2") og et rundenummer. De leverede tekster er kortere, har ét tal-anker og bruger **rundens dato-interval** frem for et rundenummer — `round_key` er en dato, ikke et løbenummer, så "runde 4" findes ikke som begreb i databasen.

Teksterne bor to steder og **skal holdes i sync**: `sql/story_engine.sql` skriver færdig `headline`/`body` ved genereringen, og `src/lib/stories.js` (`renderStory`) spejler skabelonerne til fallback-rendering og enhedstest. Ændrer du en tekst, så ændr begge.

`{L}` = rundens dato-interval, fx `21.07 – 27.07`. Emojis er åben beslutning A5.

| Prio | Regel | Headline | Body |
|---|---|---|---|
| 10 | `MONTH_CHAMP` | 👑 Du er {delt }Månedens Prediction Champ — {month} | {points} point — flest af alle i {month}{ (delt)}. {evt: Nr. 2 var {gap} point efter.} |
| 20 | `LEAD_TAKEN` | 🏆 Du overtog førstepladsen i {league} | Efter runden {L} fører du {league}. Forspring til nr. 2: {gap} point. |
| 21 | `LEAD_LOST` | ⚡ {rival} vippede dig af førstepladsen i {league} | Du førte {league}, men {rival} gik forbi i runden {L}. Afstand op: {gap} point. |
| 30 | `RATING_HIGH` | 📈 Ny personlig ratingrekord: {rating} | Din runde {L} sendte dig forbi din hidtidige rekord på {old}. Du er nu nr. {rank} af {total} på ranglisten. |
| 40 | `H2H_PASS` | 🔄 Du er nu foran {rival} i {league} | Efter runden {L} fører du jeres duel i {league} med {gap} point. |
| 50 | `COMEBACK` | 🚀 Fra nr. {from} til nr. {to} i {league} | Du rykkede {from−to} pladser frem i runden {L}. Toppen er nu {gap} point væk. |
| 60 | `STREAK` | 🔥 {n}. sejr i træk mod {rival} i {league} | Du slog {rival} igen i runden {L} — {mine} mod {deres} point. |
| 70 | `ROUND_WON` | 🥇 Du vandt runden {L} i {league} | {points} point — flest af alle i {league}{ (delt med N andre)}. |
| 80 | `SHARP` | 🎯 {n} præcise resultater i runden | Du ramte {n} kampe præcist i runden {L} — {points} point i alt. |

**Regel 60 findes kun i sejrs-varianten.** Udkastet specificerede også en spejlvendt "bagud"-historie ("🔥 {n}. runde i træk bag {navn} … Runde {næste} er din chance for at bryde stimen"). Den er **ikke bygget**: `sql/story_engine.sql` indsætter kun rækker, hvor brugeren har vundet duellen. Det er i tråd med designreglen "historier driller, men ydmyger aldrig" — en stime, man taber, er netop den slags historie, hvor nederlaget bliver sidste ord. Skal den bygges, kræver den sin egen formulering med et fremadrettet slutpunkt; indtil da bør den ikke stå som leveret.

## 5. Konkrete situationer

> **Bemærk:** eksemplerne nedenfor bruger udkastets tekster og rundenumre og er bevaret som illustration af *hvilke* historier der udløses af samme begivenhed. De faktisk viste tekster står i afsnit 4. Anders' historie i situation A findes desuden ikke i v1 — regel 60 har kun en sejrs-variant.

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
  league_size int,             -- snapshot: antal deltagere i ligaen ved generering; null for globale
  payload jsonb not null,      -- fx {"rival":"Jimmy","led_rounds":3,"gap":2}
  headline text not null,      -- færdigrenderet dansk tekst
  body text not null,
  created_at timestamptz default now(),
  dismissed_at timestamptz,
  unique (round_key, user_id, rule, competition_id)
);
```

- **Både payload og færdig tekst gemmes.** Teksten gør v1 triviel at vise; payloaden gør det muligt senere at forbedre formuleringer eller bygge minde-arkivet uden datatab.
- **Alle udløste kandidater gemmes** (ikke kun vinderen). Visningen vælger laveste prioritet pr. bruger. Det giver gratis råmateriale til "Historier bliver til minder" senere.
- **`league_size` snapshottes ved generering** — ligastørrelsen aflæses IKKE live i viewet. Ellers kunne den viste historie for samme runde skifte, hvis nogen joiner/forlader ligaen bagefter. Snapshot = frosset, reproducerbart valg (og idempotent gen-kørsel giver samme resultat).

**Deterministisk udvælgelse (`latest_story`-view):**
Præcis én historie pr. `(user_id, round_key)`. Tre sorteringsnøgler, hvor den sidste er garanteret unik, så viewet aldrig kan returnere to rækker eller skifte vilkårligt:

```sql
-- pr. (user_id, round_key): vælg rækken med
order by priority asc, league_size desc nulls last, competition_id asc
limit 1   -- fx via distinct on (user_id, round_key) med denne order
-- vis kun ikke-afviste: where dismissed_at is null
```

1. **`priority asc`** — laveste tal (vigtigst) vinder.
2. **`league_size desc nulls last`** — ved samme prio vinder den største liga. `nulls last` betyder, at en global historie (uden ligastørrelse) taber en lighed til en liga-historie — men det sker aldrig i praksis, for de globale prioriteter (10, 30) er unikke på stigen og kan ikke gå lige op med en liga-historie. Reglen er derfor entydig, og `nulls last` er blot et sikkerhedsnet.
3. **`competition_id asc`** (eller story-`id`) — endelig, garanteret unik tiebreak, så der altid returneres præcis én række.

**Funktion `generate_stories(round_key)`:**
Sletter og genberegner rundens rækker (idempotent, ligesom `recompute_ratings`). Kaldes til sidst i det eksisterende trigger-flow på `matches` — efter ratings. Triggeren sender **kun fuldt afsluttede runder** videre (alle rundens kampe har resultat); delvist spillede runder genererer ingen historier endnu. Reglerne 20–70 beregnes ud fra stillinger før/efter runden, som kan afledes af rundepoint.

**Frontend:** HjemTab henter én række fra `latest_story` for den **seneste fuldt afsluttede runde** og viser kortet, indtil (a) næste runde afsluttes, eller (b) brugeren afviser (`dismissed_at`). Del-knappen bruger `navigator.share` med headline + body (fallback: udklipsholder).

**Placering på Hjem:** historie-kortet rendes som sit eget kort **direkte under tips-status-kortet** i `HjemTab` (mellem tips-status og "Indeværende runde"-kortet). Det vises **altid**, når der findes en ikke-afvist historie for den seneste afsluttede runde — også samtidig med det røde "mangler tips"-kort. Tips-status forbliver øverst, så handling ikke fortrænges; historien er ugens følelsesmæssige krog lige under. Visuelt er kortet **guld-fremhævet** (`borderColor: C.gold` + svag ravgul gradient), så det læses som ugens highlight.

**RLS:** Brugere kan kun læse rækker med eget `user_id`. Ingen kan se andres historier — de er personlige.

---

## 7. Udrulning

1. **Skyggetilstand (1–2 runder):** ✅ Gennemført. Historier blev genereret, men vist kun for admin, så tonen kunne læses med friske øjne.
2. **Justér tærskler:** Comeback-grænsen (≥3 pladser) og stime-grænsen (≥3 runder) er gæt — de kalibreres fortsat på rigtige data (åben beslutning A4).
3. **Live for alle:** ✅ Skyggetilstand fjernet (juli 2026) — historie-kortet hentes nu for alle brugere på Hjem (`HjemTab`, `loadLatestStory`). Tærskel-kalibrering (A4) kører videre på live-data.

## 8. Acceptkriterier

> **Rettet efter levering (v1.1):** kriteriet "en runde uden udløste regler viser intet historie-kort" gælder ikke længere — en sådan runde viser nu et **dæmpet** kort (afsnit 10.2). Kriteriet er erstattet af afsnit 10.5's liste; resten står ved magt.

- Der vises højst én historie pr. bruger pr. runde.
- To brugere i samme liga kan se forskellige historier om samme runde.
- En runde uden udløste regler viser intet historie-kort.
- Genkørsel af `generate_stories` for samme runde ændrer ingenting (idempotent).
- Ingen historie omtaler en bruger negativt om placering i bunden eller dårlige præstationer.
- Historie-kortet vises altid direkte under tips-status-kortet — også samtidig med det røde "mangler tips"-kort (jf. beslutningen i ROADMAP, juli 2026: handling øverst, historie lige under).
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

## 10. v1.1 — dækningsgrad og dæmpet tier (juli 2026)

**Status: ✅ Leveret.** Dette afsnit ændrer afsnit 3 (regelkataloget), 4 (teksterne) og 8 (acceptkriterierne). v1-teksten ovenfor er bevaret, så det fremgår, hvad der var planlagt, og hvad der blev rettet efter levering.

### 10.1 Anledningen

Efter den første runde, hvor motoren rent faktisk kørte (A9 var netop lukket), fik **stort set ingen** en historie. Årsagen er strukturel og ikke en fejl:

| Regel | Hvorfor den ikke kunne udløses i en konkurrences første runde |
|---|---|
| 20, 21, 40, 50, 60 | Læser alle på stillingen **før** runden. Den findes ikke endnu. |
| 30 (ratingrekord) | Kræver en ikke-provisorisk rating, dvs. mindst 5 spillede runder. |
| 10 (Månedens Champ) | Kræver, at runden lukker en måned. |
| 70 (rundens vinder) | Udløses per definition for én spiller (evt. et par ved delt sejr). |
| 80 (≥3 præcise) | Sjælden. |

Reproduceret mod en rigtig PostgreSQL 16 med produktionsskemaet (`sql/schema.sql`) og 8 spillere over 3 runder: **1 af 8 brugere** fik et kort i runde 1 — og teksten var den forkerte "🏆 Du overtog førstepladsen", fordi regel 20 udløses på `coalesce(før-placering, 999) > 1`, når der ingen "før" er. Ingen havde haft en førsteplads at overtage.

### 10.2 Tre svar, i den rækkefølge de virker

**1) Tre nye regler**, hvoraf to virker uden historik:

| Prio | Regel | Udløses når | Virker uden historik |
|---|---|---|---|
| 22 | `PODIUM_ENTER` | Fra nr. ≥4 til top 3 (konkurrencer med ≥6 deltagere) | nej |
| 45 | `CLOSING_IN` | Ikke nr. 1, 1–3 point op til føringen, og afstanden er ikke vokset i runden | **ja** |
| 55 | `PERSONAL_BEST` | Rundens point er brugerens højeste hidtil i konkurrencen | **ja** (fra runde 2) |

`PODIUM_ENTER` findes, fordi comeback måler **bevægelse** og derfor misser det skift, der føles størst i en tabel: 4. → 3. plads. Top-3 er en tærskel, ikke en distance.
`CLOSING_IN` er bevidst formuleret fremadrettet og er en af de få rigtige historier, en premiereuge kan producere.
`PERSONAL_BEST` sammenligner kun brugeren med brugeren selv og kan derfor udløses af en spiller i bunden, uden at historien nogensinde nævner en placering.

**2) Sænkede tærskler med dynamisk prioritet (lukker A4).** Princippet er:

> **Tærsklen afgør, om historien findes. Prioriteten afgør, om den vises.**

| Regel | Tærskel før | Tærskel nu | Prioritet |
|---|---|---|---|
| Comeback | ≥3 pladser, ≥5 deltagere | **≥2 pladser, ≥4 deltagere** | 50 ved ≥3 pladser, ellers **75** |
| Stime mod rival | ≥3 sejre i træk | **≥2 sejre i træk** | 60 ved ≥3 sejre, ellers **75** |
| Præcise resultater | ≥3 præcise | **≥2 præcise** | 80 ved ≥3, ellers **85** |

75 ligger **under** rundens vinder (70). Derfor kan "🔥 2. sejr i træk mod Jimmy" aldrig fortrænge "🥇 Du vandt runden" — dækningen stiger, uden at de store øjeblikke fortyndes. Alternativet (bare at sænke tærsklen) ville have gjort præcis det.

**3) Dæmpet tier (lukker A3).** To regler med prioritet ≥ 90, som **kun genereres for brugere, der ellers ville stå helt uden en række i runden**:

| Prio | Regel | Udløses når |
|---|---|---|
| 90 | `SEASON_OPENER` | Konkurrencens første afsluttede runde |
| 100 | `QUIET_ROUND` | Alle andre stille runder |

Produktbogens kapitel 6 ("Stilhed er også en funktion") beder selv Story Engine om at turde sige *"Status quo."* v1 læste det som **intet kort**; v1.1 læser det som **et stille kort**. Forskellen skal kunne ses: kortet renderes uden guldkant, uden emoji i overskriften, med mindre typografi og **uden Del-knap** — der er intet at sende i gruppens beskedtråd. Det kan afvises som ethvert andet kort.

Kortet knyttes til brugerens største liga (deterministisk tiebreak på `competition_id`) og genereres kun for brugere, der faktisk tippede i runden. Har man ikke spillet, er stilheden fortsat total.

### 10.3 Teksterne (v1.1)

Emoji i overskriften er nu et **signal**: den findes kun i højdepunkt-tieret. Teksterne bor fortsat to steder og skal holdes i sync (`sql/story_engine.sql` og `renderStory` i `src/lib/stories.js`).

| Prio | Regel | Headline | Body |
|---|---|---|---|
| 22 | `PODIUM_ENTER` | 🏅 Du er inde i top 3 i {league} | Efter runden {L} ligger du nr. {rank} af {total} i {league}. Toppen er {gap} point væk. |
| 45 | `CLOSING_IN` | 👀 Kun {gap} point op til føringen i {league} | Efter runden {L} er der {gap} point op til {rival} i {league}. |
| 55 | `PERSONAL_BEST` | 📊 Din bedste runde hidtil: {points} point | Runden {L} er din stærkeste i {league} — din forrige rekord var {old} point. |
| 90 | `SEASON_OPENER` | Første runde i {league} er i hus | *øverste halvdel:* {points} point — du starter som nr. {rank} af {total}.{ Toppen er {gap} point væk.} · *nederste halvdel:* {points} point i den første runde. Toppen er {gap} point væk — der er lang vej endnu. |
| 100 | `QUIET_ROUND` | Din runde: {points} point | *nr. 1:* Du fører fortsat {league} efter runden {L}. · *øverste halvdel:* Du holder nr. {rank} af {total} i {league} — {gap} point op til toppen. · *nederste halvdel:* {gap} point op til toppen i {league}. Næste runde er en ny chance. |

**Tonereglen er kodet ind, ikke kun beskrevet:** i det dæmpede tier nævnes placeringen **kun i den øverste halvdel af tabellen** (`rank * 2 <= total`). Ligger man i den nederste, står afstanden op til toppen og en fremadrettet slutning i stedet. Der står aldrig "du er nr. 9 af 10". Det er dækket af en enhedstest.

### 10.4 Rettelse i regel 20

Regel 20 (`LEAD_TAKEN`) kræver nu, at konkurrencen **har** en runde før denne. Uden den betingelse påstod den i en premiereuge, at nr. 1 havde overtaget en førsteplads, ingen havde haft. Premiereugen dækkes i stedet af `SEASON_OPENER`.

Samtidig er de laterale opslag på "hvem fører" gjort deterministiske (`order by user_id`). Ved en **delt** førsteplads kunne to gen-kørsler af samme runde ellers nævne hver sin rival i regel 21 — idempotens gælder også de navne, teksten nævner.

### 10.5 Nye acceptkriterier

- Et dæmpet kort genereres **kun**, når brugeren ikke har nogen anden historie i runden. Ingen bruger har både et dæmpet og et rigtigt kort i samme runde.
- Et dæmpet kort kan aldrig vinde over en rigtig historie i `latest_story`.
- Dæmpede kort optræder **ikke** som milepæle i karriereprofilen (`loadCareerMilestones` henter kun `priority < 90`). Ellers ville arkivet blive en rundelog med de ægte øjeblikke gemt inde i.
- Emoji i overskriften findes kun i højdepunkt-tieret.
- En svag variant (comeback på 2 pladser, stime på 2 sejre, 2 præcise) kan aldrig fortrænge rundens vinder.
- Regel 20 udløses ikke i en konkurrences første runde.

### 10.6 Verifikation

Kørt mod en rigtig **PostgreSQL 16** med produktionsskemaet indlæst (`sql/schema.sql`) og et datasæt på 8 spillere / 3 runder / 18 kampe:

| Runde | Brugere med kort — v1 | Brugere med kort — v1.1 |
|---|---|---|
| 1 (premiere) | **1 af 8** | **8 af 8** |
| 2 | 6 af 8 | 8 af 8 |
| 3 | 5 af 8 | 8 af 8 |

Desuden verificeret: 13 af de 14 regler udløses på datasættet (`RATING_HIGH` kræver en ikke-provisorisk rating, dvs. ≥5 runder, og kan ikke rammes af et 3-runders datasæt), gen-kørsel af `generate_stories` for samme runde giver **byte-identiske** rækker (md5 over alle rækker før/efter), præcis én `latest_story` pr. `(user_id, round_key)`, ingen bruger har både dæmpet og rigtigt kort, ingen `LEAD_TAKEN` i første runde — og historierne skabes fortsat ad **triggerstien** (`sql/rating_trigger_optimization.sql`), ikke kun ved direkte kald.

### 10.7 Engangsopsætning

Gen-kør `sql/story_engine.sql` i Supabase ("Run without RLS"). Scriptet er idempotent og ændrer hverken tabellen eller viewet — kun `generate_stories()`. Triggeren behøver **ikke** gen-køres (`sql/rating_trigger_optimization.sql` er uændret).

Historier for **allerede afsluttede** runder får ikke de nye regler af sig selv: `generate_stories` kaldes kun, når et resultat ændres. Vil man have de nye kort med tilbagevirkende kraft, køres `sql/story_engine_backfill.sql` ("Run without RLS"), som kalder funktionen én gang pr. afsluttet runde.

> **Rettelse (juli 2026):** dette afsnit indeholdt oprindeligt et kald, der filtrerede på `where home_score is not null`. Det var forkert — filteret rammer den *enkelte kamp* og ville derfor også kalde `generate_stories` på **delvist spillede** runder, hvor motoren ville skrive historier ("du vandt runden") ud fra en halv stilling. Backfill-scriptet bruger i stedet nøjagtig samme komplethedsfilter som matches-triggeren: kun runder, hvor ingen kamp mangler resultat.

Bemærk, at en genberegning nulstiller `dismissed_at` for de berørte runder — et kort, brugeren havde afvist, kan dukke op igen.

---

*Status: v1.1 live (juli 2026). A3 (stille runder) og A4 (tærskler) er lukket med denne leverance; A5 (emojis) er delvist besvaret — emoji er nu et signal, der adskiller de to tiers, frem for et spørgsmål om til/fra.*
