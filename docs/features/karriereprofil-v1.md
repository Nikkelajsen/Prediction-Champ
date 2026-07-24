# Feature: Karriereprofil v1

**Status: Specificeret — afventer forudsætninger (se afsnit 7)** · *Filosofi: [`../PRODUCT_BOOK.md`](../PRODUCT_BOOK.md), kapitel 5–6 · Prioritering: [`../ROADMAP.md`](../ROADMAP.md), trin 4*

*Brugerens karriere som fortælling — milepæle, titler og rivaliseringer. Ikke en statistikside. Bygget på data, der allerede findes i databasen.*

---

## 1. Formål

I dag findes der ingen personlig profil-/karrierevisning (MVP-kravet "Grundlæggende karriere og head-to-head" står som ❌ i roadmappen). Alle per-bruger-tal er enten rangliste-rækker eller formkurve-prikker. Karriereprofilen giver hver bruger ét sted, hvor deres historie i produktet samler sig over tid: *hvem er jeg som tipper, hvad har jeg vundet, og hvem er mine rivaler?*

**Designprincip (ufravigeligt):** Produktbogen siger "Stories over Statistics", og det er allerede besluttet, at head-to-head bygges som Story Engine-regler, *ikke* som statistikside (ROADMAP, juli 2026). Karriereprofilen følger samme ånd:

1. **Fortælling frem for tabel.** Profilen læses oppefra som en karriere: titler → milepæle → kurve → rivaler. Rå tal optræder diskret og sekundært.
2. **Genbrug af eksisterende fortælle-data.** `stories`-rækkerne gemmer allerede *alle* udløste kandidater pr. runde (ikke kun den viste) — netop som råmateriale til et minde-arkiv. Karriereprofilen er det arkivs første aftager.
3. **Driller, ydmyger aldrig.** Samme regel som Story Engine: ingen "din dårligste måned", ingen bundplaceringer. Profilen viser det, man har opnået — ikke det, man ikke har.

---

## 2. Indhold (v1)

Oppefra og ned på profilsiden:

| Sektion | Indhold | Datakilde |
|---|---|---|
| **Hoved** | Navn, "medlem siden", aktuel rating + ▲/▼ og "NY"-badge (samme visning som Rating-fanen) | `profiles`, `ratings`, `rating_history` |
| **Titler** | Månedstitler ("Månedens Prediction Champ, marts 2027") og rundetitler (antal rundesejre). Vises som badges/trofæer, nyeste først | `monthly_standings`, `round_standings` (historik) |
| **Milepæle** | Kronologisk minde-liste fra story-arkivet: comebacks, stimer, ratingrekorder, H2H-overhalinger — genbrug af `headline` fra gemte `stories`-rækker | `stories` (alle kandidater, ikke kun viste) |
| **Ratingkurve** | Rating over tid (én prik pr. runde), med provisorisk periode markeret | `rating_history` |
| **Rivaler** | De 2–3 brugere, man oftest har byttet placering/udvekslet H2H-historier med — vist som fortælling ("Din tætteste rival: Jimmy — I har overhalet hinanden 5 gange") | `stories` (regel 40/60) + `rating_history.rnk` |
| **Basistal (diskret)** | Samlede point, præcise hits (🎯), hit-rate, antal tippede kampe. Én kompakt linje/række nederst — bevidst ikke øverst | samme kilder som stillingerne (se afsnit 4) |

**Ikke i v1:** per-turnering-opdeling (afventer turnering #2 — `ratings.scope` er forberedt), sæsonarkiv på tværs af år (der findes kun én sæson endnu), sammenligning af to profiler side om side (H2H bor i Story Engine).

---

## 3. Brugerflow

- **Adgang:** klik på eget navn/rating-snapshot på Hjem, og på eget navn i ranglister. Profilen er en drill-in-skærm (som Stilling/Liga-siden) — ingen ny fane i bundnavigationen.
- **Andres profiler (åben beslutning K1, se afsnit 8):** v1-anbefaling er, at man kan åbne profiler for brugere, man deler en liga (fællesskab) eller konkurrence med — det er dér, rivaliseringen bor. Milepæle fra `stories` er dog personlige (RLS: kun egne) og vises **kun på ens egen profil**; andres profil viser hoved, titler, kurve og basistal.
- **Tom tilstand:** en ny bruger uden titler/milepæle ser hoved + kurve + en venlig tekst ("Din karriere er lige begyndt — den første runde skriver det første kapitel"). Ingen tomme nul-tabeller.

---

## 4. Datamodel og beregning

**Ingen nye tabeller i v1.** Alt kan afledes af eksisterende data. I tråd med beslutningen "PostgreSQL som kilde til sandhed" samles læsningen i DB frem for klient-beregning:

- Ét nyt view/RPC, fx `career_profile(profile_user_id uuid)`, der returnerer jsonb med: titler (aggregeret fra `monthly_standings`/`round_standings`-historik), ratingkurve (`rating_history`), basistal og rival-aggregatet. Mønster: som `admin_user_stats()` (ét kald, `security definer` hvor RLS ellers ville blokere), men **uden** admin-gate — i stedet gated på relationen fra K1 (deler liga/konkurrence, eller egen profil).
- Milepæle hentes separat via eksisterende RLS-læsning af `stories` (kun egne rækker) — ingen ny adgang nødvendig.
- **Vigtigt — samme pointkilde som stillingerne:** basistallene skal beregnes af de samme views/samme SQL som `round_standings`/`season_standings`, ikke af en ny, uafhængig pointberegning. Scoring er i dag hardkodet 3/1 i views'ene, mens frontendens `pointsFor` læser konkurrencens `rules` — den inkonsistens må ikke spredes til et tredje sted (se forudsætning F2).

**Frontend:** ny skærm `src/screens/ProfileScreen.jsx` + loader `loadCareerProfile` i `src/lib/data.js` (samme mønster som `loadUserStats`/`loadRatingHistory`). Ratingkurven tegnes med samme letvægts-tilgang som eksisterende minikurver (ingen chart-bibliotek).

---

## 5. Udrulning

1. Forudsætninger F1–F2 lukkes (afsnit 7).
2. SQL (`sql/career_profile.sql`, idempotent, "Run without RLS" jf. dokumentationens afsnit 13) + skærm bag eget-navn-klik.
3. Første version kun for egen profil; K1 (andres profiler) kan åbnes i samme leverance eller trin 2, alt efter beslutning.

## 6. Acceptkriterier

- Profilen viser aldrig negativt vinklet indhold (ingen bundplaceringer, ingen "dårligste …").
- Basistal matcher altid Championship-fanens tal for samme bruger (samme kilde).
- Milepæle fra `stories` kan kun ses af brugeren selv (RLS uændret).
- En bruger uden data ser en meningsfuld tom tilstand, ikke nuller.
- Ratingkurven matcher Rating-fanens historik (`rating_history`), inkl. provisorisk markering.
- Titler tildeles kun for afsluttede måneder/runder (samme "færdigspillet"-regel som kåringerne i Championship).

## 7. Forudsætninger (skal lukkes før implementering)

| # | Forudsætning | Hvorfor |
|---|---|---|
| **F1** | ~~Kerneskemaet eksporteres til repoet~~ **✅ Lukket (juli 2026):** `sql/schema.sql` er i repoet og holdes opdateret af det ugentlige workflow `.github/workflows/schema-export.yml` (guide: `sql/README.md`). | Ny SQL kan nu skrives og verificeres mod den faktiske DDL. |
| **F2** | **Én pointkilde.** Afklar scoring-dupliketten: `pointsFor` (frontend) læser `rules`-jsonb, mens `round_standings`/`season_standings`/`monthly_standings`/`generate_stories` hardkoder 3/1. Beslut enten (a) `pc_points` i DB læser `rules`, eller (b) det slås fast, at globale opgørelser altid er 3/1 uanset konkurrence-regler — og det dokumenteres. | Karriereprofilens basistal skal bygge på stillingernes kilde. Uden afklaring arver profilen en kendt inkonsistens og gør den mere synlig. |

## 8. Åbne beslutninger

| # | Spørgsmål | v1-anbefaling |
|---|---|---|
| K1 | **Hvem kan se en profil?** Kun egen, eller alle man deler liga/konkurrence med? | Delte ligaer/konkurrencer (rivalisering kræver et publikum) — men milepæle forbliver private. |
| K2 | **Per-turnering-opdeling fra start?** `ratings.scope` er forberedt til per-liga-rating. | Nej — vent til turnering #2 er i drift ([`turnering-2.md`](./turnering-2.md)), ellers bygges en vælger uden indhold. |
| K3 | **Rival-definitionen.** Ren `stories`-optælling (regel 40/60) eller også placerings-nabo-analyse fra `rating_history.rnk`? | Start med `stories`-optælling (billigst, allerede fortælle-formet); udvid hvis den giver for få rivaler i små ligaer. |

## 9. Testcases

1. Bruger med månedstitel + rundesejre → titler vises nyeste først, med korrekt måned/runde.
2. Bruger uden titler/milepæle → tom tilstand-tekst, ingen nul-rækker.
3. Basistal sammenlignes med Championship-fanen for samme bruger → identiske.
4. Bruger A åbner Bruger B's profil (deler liga) → hoved/titler/kurve/basistal synlige, ingen milepæle.
5. Bruger A åbner Bruger C's profil (ingen delt liga/konkurrence) → afvist (K1-regel), pæn fejltekst.
6. Provisorisk spiller (< 5 runder) → kurve med provisorisk markering, "NY"-badge i hovedet.
7. Resultat rettes af admin → profilens tal følger med efter trigger-genberegning (samme flow som stillinger/ratings).

---

*Næste skridt: F1 er lukket — afgør F2 + K1 → implementér som feature-branch.*
