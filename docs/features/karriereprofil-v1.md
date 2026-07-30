# Feature: Karriereprofil v1

**Status: ✅ Leveret (juli 2026) — `sql/career_profile.sql` + `src/screens/ProfileScreen.jsx`. K1 med fra start og siden udvidet: enhver indlogget bruger kan se enhver karriere (afsnit 8).** · *Filosofi: [`../PRODUCT_BOOK.md`](../PRODUCT_BOOK.md), kapitel 5–6 · Prioritering: [`../ROADMAP.md`](../ROADMAP.md), trin 4*
>
> ⚠️ **Rettelse (K4, 30. juli 2026):** karriereprofilen er udvidet med ét narrativt cross-profile H2H-punkt, "bedste nogensinde"-rekorder og et liga/konkurrence-fodaftryk — se afsnit 2 og 8 (K4). Testcase 4/5 nedenfor gælder fortsat uændret for milepæle og rivaler, som forbliver private.

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
| **H2H-linje** *(K4, tilføjet 30. juli 2026)* | Ét narrativt punkt, kun ved fremmed profil med delt konkurrencehistorik: "I har mødt hinanden N gange — du fører A-B". Et møde er deduplikeret pr. runde/kamp på tværs af alle delte konkurrencer — deler to brugere fx både en rundebaseret og en full-season-konkurrence for samme turnering, tæller samme spillede runde kun én gang (rettet 30. juli 2026, testcase 13). | `competition_participants`, `competition_matches`, `predictions`, `pc_points()` |
| **Rekorder** *(K4)* | "Bedste nogensinde": højeste rating, bedste rundeplacering (kun hvis ikke allerede nr. 1), længste stime af rundesejre i træk | `rating_history`, `round_standings` (samme rank()-stige som Titler) |
| **Fodaftryk** *(K4)* | Antal ligaer og konkurrencer, som en diskret linje i hovedet | `group_members`, `competition_participants` |

**Ikke i v1:** per-turnering-opdeling (afventer turnering #2 — `ratings.scope` er forberedt), sæsonarkiv på tværs af år (der findes kun én sæson endnu), sammenligning af to profiler side om side (H2H bor i Story Engine). **[Delvist rettet, K4, 30. juli 2026]:** ét enkelt narrativt H2H-punkt ("I har mødt hinanden N gange — X fører A-B") vises nu også på tværs af profiler, når de to brugere deler mindst én konkurrence. Dette er IKKE en sammenligningsside — ingen tabel, ingen historik-liste, kun én sætning, kun synlig for viewer selv. Milepæle og rivaler forbliver private og uændrede (testcase 4/5). "Konkurrencer vundet" er bevidst stadig udeladt: `season_standings` er sæson-bred, ikke per konkurrence, og produktet kører kun én sæson — umodent koncept indtil turnering #2.

---

## 3. Brugerflow

- **Adgang:** **et brugernavn er altid vejen til karrieren** — alle steder, hvor et navn står i appen, åbner et tryk på det den pågældendes karriere. I dag: Hjem ("Hej *navn*" + rating-snapshot), Rating-ranglisten, konkurrence-stillingen og dens "Point pr. runde"-overskrifter, Championship-tabellerne (top 5, fuld stilling og de tre kåringer), liga-medlemslisten, "Alles gæt" på Tip-skærmen, vinderen på et afsluttet konkurrence-kort og navnet i runde-tips-overlayet. Profilen er en drill-in-skærm (som Stilling/Liga-siden) — ingen ny fane i bundnavigationen. Fælles komponent: `PlayerName` i `src/ui/components.jsx`.
- **Andres profiler (K1, se afsnit 8):** enhver indlogget bruger kan åbne enhver karriere og se hoved, titler, kurve og basistal. Milepæle fra `stories` er personlige (RLS: kun egne) og vises **kun på ens egen profil** — det samme gælder rivaler.
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
- Basistal matcher Championship-fanens tal for samme bruger (samme 3/1-udtryk, F2). **Forbehold:** profilens basistal er karriere-brede (alle tippede kampe), mens `season_standings` er scopet til én sæson og `monthly_standings` til én måned. Med kun én turnering i drift er tallene identiske; det ophører den dag turnering #2 tændes ([`turnering-2.md`](./turnering-2.md)), hvor profilen skal have samme scope-valg som Championship.
- Milepæle fra `stories` kan kun ses af brugeren selv (RLS uændret).
- En bruger uden data ser en meningsfuld tom tilstand, ikke nuller.
- Ratingkurven matcher Rating-fanens historik (`rating_history`), inkl. provisorisk markering.
- Titler tildeles kun for afsluttede måneder/runder (samme "færdigspillet"-regel som kåringerne i Championship).

## 7. Forudsætninger (skal lukkes før implementering)

| # | Forudsætning | Hvorfor |
|---|---|---|
| **F1** | ~~Kerneskemaet eksporteres til repoet~~ **✅ Lukket (juli 2026):** `sql/schema.sql` er i repoet, med workflowet `.github/workflows/schema-export.yml` (manuelt + hver mandag; guide: `sql/README.md`). | Ny SQL kan nu skrives og verificeres mod den faktiske DDL. **Men eksporten er kun så frisk som sidste kørsel** — pr. juli 2026 er filen flere migreringer bagud (den mangler bl.a. `career_profile` selv). Kør workflowen efter hver migrering, og verificér mod databasen ved tvivl. |
| **F2** | ~~Én pointkilde~~ **✅ Besluttet (juli 2026): 3-1-0 fastfryses overalt.** `rules`-feltet er historisk; alle opgørelser er altid 3/1 (DB'ens `pc_points` er kilden). Karriereprofilens tal bygger direkte på `pc_points`/stillings-views'ene. | Bekræftet mod `sql/schema.sql`: `pc_points()` hardkoder 3/1 og ignorerer `rules` — beslutningen matcher den faktiske adfærd. Frontendens `rules`-læsning kan afvikles som separat oprydning. |

## 8. Åbne beslutninger

| # | Spørgsmål | v1-anbefaling |
|---|---|---|
| K1 | ~~Hvem kan se en profil?~~ **✅ Besluttet (juli 2026), udvidet (juli 2026):** oprindeligt "alle, man deler en liga eller konkurrence med". **Nu: enhver indlogget bruger kan se enhver profil** (hoved, titler, kurve, basistal) — milepæle og rivaler forbliver private. | Rivalisering kræver et publikum; historier er personlige. Udvidelsen: på Championship er alle automatisk med, og navn, rating, point og præcise hits står i forvejen offentligt på Rating-/Championship-fanerne — den gamle gate afviste folk, man reelt konkurrerer med, og beskyttede intet, der ikke allerede var på en rangliste. |
| K2 | **Per-turnering-opdeling fra start?** `ratings.scope` er forberedt til per-liga-rating. | Nej — vent til turnering #2 er i drift ([`turnering-2.md`](./turnering-2.md)), ellers bygges en vælger uden indhold. |
| K3 | **Rival-definitionen.** Ren `stories`-optælling (regel 40/60) eller også placerings-nabo-analyse fra `rating_history.rnk`? | Start med `stories`-optælling (billigst, allerede fortælle-formet); udvid hvis den giver for få rivaler i små ligaer. |
| K4 | **Skal karriereprofilen vise ét cross-profile H2H-narrativ, selvom "H2H bor i Story Engine, ikke en sammenligningsside" (juli 2026) er besluttet? Og skal det vises, når viewer taber?** | **Besluttet (30. juli 2026): Ja, som afgrænset undtagelse.** Kun én sætning, kun ved delt konkurrence, aldrig en tabel/liste. Vises uanset om viewer fører eller taber, fordi (a) kun viewer selv ser den, aldrig den anden part eller offentligheden, (b) de samme runde-tal er allerede offentligt synlige for delte konkurrencedeltagere via stillingerne, og (c) Story Engines egen `LEAD_LOST`-regel fortæller allerede den tabende part om nederlag, i neutralt sprog. Ingen superlativer ("aldrig", "værst") — kun tælletal. Samtidig tilføjes `records` og `footprint` som nye **offentlige** jsonb-nøgler i `career_profile()`, på samme synlighedsniveau som hoved/titler/kurve/basistal (K1) — ingen ny privat information, kun tal der allerede er synlige andetsteds (kurve, stillinger) eller strukturelt neutrale (medlemskabstal). |

## 9. Testcases

1. Bruger med månedstitel + rundesejre → titler vises nyeste først, med korrekt måned/runde.
2. Bruger uden titler/milepæle → tom tilstand-tekst, ingen nul-rækker.
3. Basistal sammenlignes med Championship-fanen for samme bruger → identiske.
4. Bruger A åbner Bruger B's profil (deler liga) → hoved/titler/kurve/basistal synlige, ingen milepæle og ingen rivaler.
5. Bruger A åbner Bruger C's profil (ingen delt liga/konkurrence, fx fra Championship-tabellen) → samme visning som testcase 4, ingen afvisning.
8. Et navn trykkes hvert sted, det optræder (Hjem, Rating, Stilling, Point pr. runde, Championship top 5 + fuld stilling + kåringer, liga-medlemsliste, Alles gæt, konkurrence-vinder, runde-tips-overlay) → karriereskærmen åbnes for den rigtige bruger.
9. Navnet i konkurrence-stillingen åbner karrieren, mens **resten af rækken** åbner spillerens tips runde for runde. *(Leveret som hele rækken frem for kun pointtallet: et tal i en 46 px-kolonne er ca. 30×22 px mod de ~44 px, en finger kræver.)*
6. Provisorisk spiller (< 5 runder) → kurve med provisorisk markering, "NY"-badge i hovedet.
7. Resultat rettes af admin → profilens tal følger med efter trigger-genberegning (samme flow som stillinger/ratings).

*(K4, 30. juli 2026 — fortsætter nummereringen, omnummererer ikke 1–9):*

10. A åbner B's profil, delt konkurrence + fælles tippet runde → H2H-linje med korrekte møde-/sejrs-/nederlagstal (verificeret manuelt mod `round_standings` for den delte konkurrence).
11. A åbner C's profil uden nogensinde at have delt en konkurrence (fx fundet via Championship-tabellen) → `data.h2h` er `null`, ingen H2H-linje, ingen fejl.
12. A åbner sin **egen** profil → `h2h` er altid `null`, uanset historik, ingen H2H-linje.
13. To brugere deler flere konkurrencer samtidig, som begge dækker den samme runde (fx en rundebaseret + en full-season-konkurrence, der begge følger Superligaen) → rundens møde tælles kun **ÉN** gang i `meetings`, deduplikeret pr. kamp — **ikke** én gang pr. konkurrence. **[Rettet 30. juli 2026]:** denne testcase beskrev oprindeligt fejlagtigt det modsatte (tælling pr. konkurrence-runde-par); en bruger med to delte konkurrencer og kun én spillet runde så "I har mødt hinanden 2 gange". Det var en bug, ikke en tilsigtet regel — `predictions` er ét tip pr. bruger pr. kamp, ikke pr. konkurrence, så et møde skal svare til én kalenderrunde.
14. Fælles historik med uafgjorte runder (samme pointsum) → `draws` er korrekt og talt hverken som sejr eller nederlag.
15. A og C har begge tippet den samme kamp/runde, men i hver sin, **ikke-delte** konkurrence → tælles ikke med i H2H (samme deltager-afgrænsningslektion som Story Engine).
16. Bruger uden nogen rundesejr nogensinde → `records.best_round_rank` vises (fx "3. plads"), aldrig udeladt, aldrig med negativ formulering ("sidste plads" o.l. må aldrig forekomme).
17. Bruger med mindst én rundesejr → `best_round_rank`-linjen udelades (rank=1, redundant med Titler-badgen); `longest_round_streak`-linjen vises hvis ≥2 rundesejre i træk.
18. Helt ny bruger uden spillede runder → `records`-nøglen giver `null`/`0` på alle felter, Rekorder-sektionen udelades helt, ingen tom "0"-linje.
19. Højeste rating nogensinde == aktuel rating → teksten bruger "du er på din højeste rating nogensinde"-varianten, ikke to identiske tal.
20. Bruger med >20 milepæle → kun de nyeste 20 vises som standard, "Vis alle N milepæle" udvider listen; hvilke `stories` der regnes som milepæle er uændret (`priority < 90`).
21. Footprint-tallet matcher optællingen af brugerens rækker i `group_members`/`competition_participants`; en arkiveret (`hidden=true`) liga-løs konkurrence tæller stadig med.
22. Footprint-linjen vises identisk uanset om profilen ses af ejeren selv eller en anden bruger (ingen `isOwn`-gate).

---

*Leveret. SQL blev verificeret mod `sql/schema.sql` — husk, at den fil kun er gyldig som reference, når skema-eksporten er kørt efter seneste migrering (F1).*
