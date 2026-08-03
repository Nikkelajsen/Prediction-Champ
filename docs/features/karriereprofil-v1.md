# Feature: Karriereprofil v1

**Status: ✅ Leveret (juli 2026) — `sql/career_profile.sql` + `src/screens/ProfileScreen.jsx`. K1 med fra start og siden udvidet: enhver indlogget bruger kan se enhver karriere (afsnit 8).** · *Filosofi: [`../PRODUCT_BOOK.md`](../PRODUCT_BOOK.md), kapitel 5–6 · Prioritering: [`../ROADMAP.md`](../ROADMAP.md), trin 4*
>
> ⚠️ **Rettelse (K4, 30. juli 2026):** karriereprofilen er udvidet med ét narrativt cross-profile H2H-punkt, "bedste nogensinde"-rekorder og et liga/konkurrence-fodaftryk — se afsnit 2 og 8 (K4). Testcase 4/5 nedenfor gælder fortsat uændret for milepæle og rivaler, som forbliver private.
>
> ⚠️ **Rettelse (omfang, 30. juli 2026 — anden runde):** skærmen sagde ikke, hvilke konkurrencer dens tal gælder. Rekorder, Titler og basistal er **globale** (Championship + global rating), Milepæle er **konkurrence-nære**. Se afsnit 10.
>
> ⚠️ **Rettelse (30. juli 2026 — tredje runde, delvis tilbagerulning af afsnit 10):** de **synlige** scope-linjer er fjernet igen efter brugerfeedback ("det skal ikke stå på forsiden"). Omfanget forklares nu i en `InfoDot` pr. sektion — og hver sektion med tal har fået sin egen. Se afsnit 13. Testcase 23 er erstattet af 45–48.

*Brugerens karriere som fortælling — milepæle, titler og rivaliseringer. Ikke en statistikside. Bygget på data, der allerede findes i databasen.*

---

## 1. Formål

I dag findes der ingen personlig profil-/karrierevisning (MVP-kravet "Grundlæggende karriere og head-to-head" står som ❌ i roadmappen). Alle per-bruger-tal er enten rangliste-rækker eller formkurve-prikker. Karriereprofilen giver hver bruger ét sted, hvor deres historie i produktet samler sig over tid: *hvem er jeg som tipper, hvad har jeg vundet, og hvem er mine rivaler?*

**Designprincip (ufravigeligt):** Produktbogen siger "Stories over Statistics", og det er allerede besluttet, at head-to-head bygges som Story Engine-regler, *ikke* som statistikside (ROADMAP, juli 2026). Karriereprofilen følger samme ånd:

1. **Fortælling frem for tabel.** Profilen læses oppefra som en karriere: titler → milepæle → kurve → rivaler. Rå tal optræder diskret og sekundært. *(Rettet efter levering: den leverede rækkefølge har flere sektioner — se rettelsen i afsnit 2.)*
2. **Genbrug af eksisterende fortælle-data.** `stories`-rækkerne gemmer allerede *alle* udløste kandidater pr. runde (ikke kun den viste) — netop som råmateriale til et minde-arkiv. Karriereprofilen er det arkivs første aftager.
3. **Driller, ydmyger aldrig.** Samme regel som Story Engine: ingen "din dårligste måned", ingen bundplaceringer. Profilen viser det, man har opnået — ikke det, man ikke har.

---

## 2. Indhold (v1)

Oppefra og ned på profilsiden:

> **Rettet efter levering (K2/K4, 30.–31. juli 2026):** den leverede skærm har flere sektioner end udkastet, og rækkefølgen er i dag: **hoved → H2H → titler → titler pr. turnering → rekorder → milepæle → ratingkurve → rivaler → basistal**. H2H, Rekorder og Fodaftryk er beskrevet i tabellens K4-rækker nedenfor; "Titler pr. turnering" er K2 — se afsnit 8 frem for en ekstra tabelrække her.

| Sektion | Indhold | Datakilde |
|---|---|---|
| **Hoved** | Navn, "medlem siden", aktuel rating + ▲/▼ og "NY"-badge (samme visning som Rating-fanen) | `profiles`, `ratings`, `rating_history` |
| **Titler** | Sæsontitler ("Sæsonens Prediction Champ — Superligaen 2026/27", *tilføjet 30. juli 2026*), månedstitler ("Månedens Prediction Champ, marts 2027") og rundetitler (antal rundesejre). Vises som badges/trofæer, nyeste først | `season_standings`, `monthly_standings`, `round_standings` (historik) |
| **Milepæle** | Kronologisk minde-liste fra story-arkivet: comebacks, stimer, ratingrekorder, H2H-overhalinger — genbrug af `headline` fra gemte `stories`-rækker. *(Tilføjet efter levering, `I5`, august 2026: hvert milepælskort har en Del-knap — deler med samme tekst som historie-kortet (`storyShareText`) og logger `story_shared` med `metadata: { rule, from: "milestone" }`.)* | `stories` (alle kandidater, ikke kun viste) |
| **Ratingkurve** | Rating over tid (én prik pr. runde), med provisorisk periode markeret. *(30. juli 2026:* toppunktet ringes ind (◎), og kurven har akser — y som neutralt interval, x som første/sidste runde*)* | `rating_history` |
| **Rivaler** | De 2–3 brugere, man har de mest **jævnbyrdige** opgør med — vist som fortælling ("Din tætteste rival: Jimmy. I har mødt hinanden 7 gange — du fører 4-3"). Navnet er tryk-flade. **[Rettet 30. juli 2026, K3 lukket]:** rangeres på `abs(sejre − nederlag)` fra faktiske møder, ikke på antal historier; udkastets `rating_history.rnk` er afvist — se afsnit 12 | `competition_participants` + `predictions` + `pc_points()` (møder) · `stories` (regel 40/60, kun som farve) |
| **Basistal (diskret)** | Samlede point, præcise hits (🎯), korrekte udfald *(tilføjet 30. juli 2026 — feltet blev hentet uden at blive vist, så halvdelen af pointene var usynlige)*, hit-rate, antal tippede kampe. Én kompakt linje/række nederst — bevidst ikke øverst | samme kilder som stillingerne (se afsnit 4) |
| **H2H-linje** *(K4, tilføjet 30. juli 2026)* | Ét narrativt punkt, kun ved fremmed profil med delt konkurrencehistorik: "I har mødt hinanden N gange — du fører A-B". Et møde er deduplikeret pr. runde/kamp på tværs af alle delte konkurrencer — deler to brugere fx både en rundebaseret og en full-season-konkurrence for samme turnering, tæller samme spillede runde kun én gang (rettet 30. juli 2026, testcase 13). | `competition_participants`, `competition_matches`, `predictions`, `pc_points()` |
| **Rekorder** *(K4)* | "Bedste nogensinde": bedste runde (flest point i én runde, *tilføjet 30. juli 2026*), bedste rundeplacering (kun hvis ikke allerede nr. 1, og med feltstørrelse — se afsnit 10), længste stime af rundesejre i træk, højeste rating. **Omfang: globalt** — global rating + Championships rundeliga, ikke brugerens egne konkurrencer | `rating_history` (`scope='ALL'`), `round_standings` (samme rank()-stige som Titler) |
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

- Ét nyt view/RPC, fx `career_profile(profile_user_id uuid)`, der returnerer jsonb med: titler (aggregeret fra `monthly_standings`/`round_standings`-historik), ratingkurve (`rating_history`), basistal og rival-aggregatet. Mønster: som `admin_user_stats()` (ét kald, `security definer` hvor RLS ellers ville blokere), men **uden** admin-gate — i stedet gated på relationen fra K1 (deler liga/konkurrence, eller egen profil). *(Rettet efter levering: K1 blev siden udvidet — adgangen er i dag blot login, og kun et ukendt id giver "not found". Se afsnit 8, K1.)*
- Milepæle hentes separat via eksisterende RLS-læsning af `stories` (kun egne rækker) — ingen ny adgang nødvendig.
- **Vigtigt — samme pointkilde som stillingerne:** basistallene skal beregnes af de samme views/samme SQL som `round_standings`/`season_standings`, ikke af en ny, uafhængig pointberegning. Scoring er i dag hardkodet 3/1 i views'ene, mens frontendens `pointsFor` læser konkurrencens `rules` — den inkonsistens må ikke spredes til et tredje sted (se forudsætning F2).

**Frontend:** ny skærm `src/screens/ProfileScreen.jsx` + loader `loadCareerProfile` i `src/lib/data/career.js` (samme mønster som `loadUserStats`/`loadRatingHistory`). Ratingkurven tegnes med samme letvægts-tilgang som eksisterende minikurver (ingen chart-bibliotek).

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
| **F2** | ~~Én pointkilde~~ **✅ Besluttet (juli 2026): 3-1-0 fastfryses overalt.** `rules`-feltet er historisk; alle opgørelser er altid 3/1 (DB'ens `pc_points` er kilden). Karriereprofilens tal bygger direkte på `pc_points`/stillings-views'ene. | Bekræftet mod `sql/schema.sql`: `pc_points()` hardkoder 3/1 og ignorerer `rules` — beslutningen matcher den faktiske adfærd. Frontendens `rules`-læsning kan afvikles som separat oprydning — fulgt som `G3` i [`../BACKLOG.md`](../BACKLOG.md) (31. juli 2026), så oprydningen ikke kun stod i en leveret spec. **Leveret 3. august 2026:** `pointsFor()` tager ikke længere et `rules`-argument, ingen skærm læser feltet, og klienten skriver det heller ikke længere — defaulten i databasen er nu den eneste kilde. Inkonsistensen, denne linje advarer om, findes dermed ikke længere nogen steder. |

## 8. Åbne beslutninger

| # | Spørgsmål | v1-anbefaling |
|---|---|---|
| K1 | ~~Hvem kan se en profil?~~ **✅ Besluttet (juli 2026), udvidet (juli 2026):** oprindeligt "alle, man deler en liga eller konkurrence med". **Nu: enhver indlogget bruger kan se enhver profil** (hoved, titler, kurve, basistal) — milepæle og rivaler forbliver private. | Rivalisering kræver et publikum; historier er personlige. Udvidelsen: på Championship er alle automatisk med, og navn, rating, point og præcise hits står i forvejen offentligt på Rating-/Championship-fanerne — den gamle gate afviste folk, man reelt konkurrerer med, og beskyttede intet, der ikke allerede var på en rangliste. |
| K2 | **Per-turnering-opdeling fra start?** `ratings.scope` er forberedt til per-liga-rating. | ~~Nej — vent til turnering #2 er i drift, ellers bygges en vælger uden indhold.~~ **✅ LUKKET 31. juli 2026:** turnering #2 er i drift, og Championship kårer nu på to niveauer ([`turnering-2.md`](./turnering-2.md) §3.6). Svaret blev **både og**: `titles.by_tournament` er en ny gren i `career_profile()`, som profilskærmen viser i en **adskilt** sektion under de samlede titler. De eksisterende grene (`monthly`/`season`/`round_wins`) er og forbliver **kun** de samlede — ellers ville "Månedens Prediction Champ ×5" betyde noget andet efter turnering #3 end før, og et karrieretal, hvis betydning skifter, når produktet vokser, kan ikke sammenlignes med sig selv. En turnering vises kun, hvis brugeren har vundet noget i den, så en ny turnering ikke giver enhver profil endnu en tom overskrift. **Per-turnering-*rating* (`ratings.scope`) er stadig ikke besluttet** og er bevidst ikke en del af dette: titler er begivenheder, rating er en løbende måling, og de to spørgsmål har ikke samme svar. |
| K3 | ~~**Rival-definitionen.** Ren `stories`-optælling (regel 40/60) eller også placerings-nabo-analyse fra `rating_history.rnk`?~~ **✅ Lukket (30. juli 2026): rangeres på jævnbyrdighed fra faktiske møder.** Story-optællingen beholdes som *farve*, ikke som rangering. Placerings-nabo på `rating_history.rnk` er **afvist** — se afsnit 12. | Oprindelig anbefaling: start med `stories`-optælling (billigst, allerede fortælle-formet); **udvid hvis den giver for få rivaler i små ligaer**. Udvidelsen blev nødvendig præcis af den grund, forudsigelsen nævnte. |
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

*(Omfang, 30. juli 2026 — fortsætter nummereringen):*

23. ~~Hver af de fire sektioner med tal (Titler, Rekorder, Milepæle, basistal) har en **synlig** scope-linje — ikke kun en `InfoDot`. En bruger skal kunne læse omfanget uden at trykke på noget.~~ **[Omgjort 30. juli 2026, tredje runde — se afsnit 13]:** den synlige scope-linje er **fjernet igen**. Gældende testcase: **hver sektion med tal har en `InfoDot`, og der står ingen forklarende brødtekst på siden.**
24. Rekorder-linjerne navngiver kilden i selve sætningen ("Championships rundeliga", "globale rating"). Ordet "konkurrence" må ikke stå i ental om Rekorder, da det inviterer til at læse tallet som én bestemt konkurrence.
25. `best_round_rank_field` > `best_round_rank` → "4. plads **af 31 spillere**". Feltstørrelsen mangler i svaret (migreringen ikke kørt) → linjen viser stadig "4. plads", ingen fejl, ingen "af null".
26. `best_round_rank == best_round_rank_field` (bruger var sidst i alle sine runder) → feltstørrelsen **udelades**, så der aldrig står "8. plads af 8". Bundplaceringer vises ikke (afsnit 1, punkt 3).
27. H2H-sætningen indledes "I jeres fælles konkurrencer …", og `meetings == 1` bøjes "1 gang" (ikke "1 gange").

*(Fem forbedringer, 30. juli 2026 — fortsætter nummereringen):*

28. Bruger vinder en **afsluttet** sæson → "🏆 Sæsonens Prediction Champ — *sæsonnavn*" står **først** blandt titel-badges. To brugere ægte lige hele stigen ned → begge får titlen.
29. Sæsonen er **ikke** færdigspillet (mindst ét resultat mangler) → ingen sæsontitel, hverken for føreren eller nogen anden. Verificeret ved at fjerne ét resultat: badget forsvinder, og dukker op igen når resultatet er tilbage.
30. Bruger med spillede runder → "Din bedste runde nogensinde: N point, heraf M 🎯 præcise — runden *dd/mm – dd/mm*". Ved pointlighed mellem to runder vælges den **ældste** (den, rekorden først blev sat i).
31. Runden havde ingen præcise → "heraf M præcise" udelades helt, ingen "heraf 0 præcise".
32. **Bruger hvis bedste runde gav 0 point** → linjen udelades helt. Der må ALDRIG stå "din bedste runde nogensinde: 0 point". *(Fundet på rigtige data under verificering mod PostgreSQL 16, ikke i gennemgangen — en spiller med én runde og nul point.)*
33. Basistallene viser "N korrekte udfald" ved siden af de præcise, så pointsummen kan stemme uden at brugeren selv regner resten ud.
34. Ratingkurven ringer toppunktet ind (◎) på den runde, `records.best_rating_round` udpeger. Mangler nøglen (gammel funktion), ringes kurvens eget maksimum ind — ringen forsvinder aldrig.
35. Kurven viser "Skala *min*–*max*" og første/sidste rundeetiket. Ordene "laveste"/"dårligste" må ikke forekomme — skalaen er en akse, ikke en bedømmelse.
36. Rekorder-linjerne står i rækkefølgen bedste runde → placering → stime → rating (mest konkret først).

*(K3 lukket, 30. juli 2026 — fortsætter nummereringen):*

37. To modstandere med **lige mange møder**, den ene jævnbyrdig (2-2) og den anden ensidig (4-0) → den jævnbyrdige står **først**. "Tætteste rival" skal måle tæthed.
38. Profilens ejer deler **to** konkurrencer med samme modstander, og begge dækker de samme kampe → 4 møder, ikke 8 (samme dedup-regel som H2H, testcase 13).
39. Modstander med kun **ét** møde → udelades helt (`v_rival_min_meetings` = 2). Ét møde gør ingen til en rival.
40. To spillere har tippet **præcis de samme kampe**, men i en konkurrence profilens ejer ikke deltager i → de optræder **ikke** som rivaler. Samme afgrænsningslektion som Story Engine-bugfixen (juli 2026); sikret strukturelt, ved at beregningen starter i `competition_participants`.
41. `rivals`-posten om person X og `h2h`-linjen på X's profil svarer **det samme** på samme spørgsmål (samme mødetal, spejlvendt stilling). Invariant — to steder i produktet må ikke svare forskelligt.
42. Fremmed profil → `rivals` er tom (uændret privathed, testcase 4/5).
43. Rivalnavnet er en tryk-flade, der åbner personens karriere (`user_id` følger nu med posten).
44. To modstandere ægte lige på både `abs(sejre − nederlag)` og antal møder → rækkefølgen er **deterministisk** (`rival_id` som sidste nøgle), så to kald ikke bytter om på dem.

*(Omfanget i info-feltet, 30. juli 2026 — fortsætter nummereringen. Erstatter testcase 23):*

45. **Hver** sektion med tal har en `InfoDot`: Karriere (hoved), H2H, Titler, Rekorder, Milepæle, Rivaler og basistallene. Ingen af dem må mangle. **[Rettet efter levering (K2, 31. juli 2026)]:** skærmen fik en ottende sektion, **Titler pr. turnering**, som også har sin egen `InfoDot` — den hører med i opremsningen.
46. Der står **ingen** forklarende brødtekst på siden — hverken under en overskrift eller som undertekst på et kort. Undtaget er ratingkurvens legende og aksevisning (afsnit 13).
47. På kort uden overskrift (H2H, basistal) står ikonet **inline efter** indholdet, aldrig foran det.
48. Tallene navngiver stadig deres eget omfang i sætningen ("i Championships rundeliga", "globale rating", "af N spillere") — det er dét, der bærer førstelæsningen, når brødteksten er væk. Testcase 24 gælder uændret.

---

## 10. Omfang på skærmen (rettelse, 30. juli 2026)

Skærmen viser **to forskellige omfang**, og indtil nu sagde den ikke hvilket er hvilket:

| Sektion | Omfang | Kilde |
|---|---|---|
| Titler | **Globalt** — Championships måneds- og rundeliga, alle brugere automatisk med | `monthly_standings` (`scope='ALL'`), `round_standings` |
| Rekorder | **Globalt** — global rating + Championships rundeliga | `rating_history` (`scope='ALL'`), `round_standings` |
| Basistal | **Globalt/karriere-bredt** — alle tippede kampe, uanset konkurrence (et tip er globalt pr. kamp) | `predictions` × `matches` |
| Milepæle | **Konkurrence-nært** — konkrete øjeblikke, de fleste i en navngiven konkurrence (`stories.competition_id` er kun `null` for de globale regler: rating og måned) | `stories` |
| H2H | **Kun delte konkurrencer** — og deduplikeret pr. runde | `competition_participants` + `predictions` |

**Hvorfor det ikke var nok at sætte en `InfoDot` på "Rekorder".** Den første rettelse gjorde netop det, men fejlede på to måder på én gang. Den var **skjult bag et klik**, hvor problemet er en forkert *førstelæsning* — en tvivl, brugeren ikke ved, de har, læser ikke en hjælpetekst. Og den var **upræcis**: teksten lød "på tværs af alle dine konkurrencer og ligaer", hvilket læses som en opgørelse *pr. brugerens egne konkurrencer*, mens `best_round_rank` faktisk er rangen mod **samtlige brugere** med point i den runde. Brugerens egen formulering ("jeg går ud fra at det er de globale konkurrencer og rating") ramte rigtigt — men at have ret ved gætværk er stadig en fejl i visningen.

**Reglen fremover:** et tal på karriereskærmen skal navngive sit eget omfang i den sætning, det står i. Sektionens overskrift bærer kontrasten; `InfoDot` uddyber. ~~En synlig scope-linje bærer kontrasten sammen med overskriften; `InfoDot` uddyber, men bærer aldrig alene en oplysning, der er nødvendig for at læse et tal rigtigt.~~ **[Rettet 30. juli 2026, tredje runde — se afsnit 13]:** den synlige scope-linje blev afvist af brugeren og er fjernet. `InfoDot` bærer nu forklaringen alene, og det er tallenes egen formulering ("i Championships rundeliga", "globale rating"), der gør førstelæsningen rigtig.

**Feltstørrelsen som scope-signal.** "4. plads" siger intet om, hvor stærk placeringen var, og var netop den linje, der blev læst som en egen konkurrence. `records.best_round_rank_field` gør den til "4. plads af 31 spillere" — hvilket samtidig *viser*, at feltet er stort og altså globalt. Den udelades ved `rank >= field`, fordi "8. plads af 8" er en bundplacering, og profilen viser aldrig bundplaceringer (afsnit 1, punkt 3) — sammen med feltet fra en større runde ved gentagne placeringer (`max(field)`) er det den eneste måde tilføjelsen ikke kan komme til at drille.

**Ikke ændret:** hvilke tal der beregnes, og hvordan. Rettelsen er ren visning plus ét nyt, afledt felt — ingen ændring i `records`' eksisterende værdier, ingen ny pointkilde (F2), ingen ændret synlighed (K1).

---

## 11. Fem forbedringer (30. juli 2026)

Leveret samlet efter en gennemgang af karrierestatistikken. Alle fem lå inden for det, skærmen allerede handler om — ingen af dem gør profilen til en statistikside.

| # | Forbedring | Hvorfor den var værd at bygge |
|---|---|---|
| 1 | **Sæsontitel** (`titles.season`) | Championship har **tre** kåringer, men karrieren registrerede kun to. Den største af dem ville aldrig stå nogen steder, når sæsonen sluttede — og karrieren er netop det sted, der "nulstilles aldrig". Samme regler som månedstitlen; badget står først. |
| 2 | **"Din bedste runde nogensinde"** | Den mest konkrete "bedste nogensinde", og den fandtes slet ikke. Sammenligner kun brugeren med brugeren selv (som `PERSONAL_BEST` i Story Engine), så den kan vises uanset placering. |
| 3 | **Korrekte udfald i basistallene** | `base.outcome_count` blev hentet uden at blive vist. Cirka halvdelen af pointene var dermed usynlige: 14 point kunne ikke stemme med 4 præcise, medmindre brugeren selv regnede resten ud. |
| 4 | **Toppunkt ringet ind i ratingkurven** | Rekordernes "højeste rating nogensinde" var et løsrevet tal, selvom kurven lige under indeholdt præcis det punkt. Ringen binder de to sammen uden at tilføje data. |
| 5 | **Akser på ratingkurven** | Kurven havde hverken tid eller værdi på sig og kunne derfor kun læses som "form", ikke som forløb. |

**To designvalg, der fulgte af produktreglerne, ikke af teknikken:**

- **"Skala 1200–1240", ikke "laveste rating".** Y-aksen skal gøre udsvingene læsbare, og en akse er neutral — men ordet "laveste" ville udpege et lavpunkt i brugerens egen historie, hvilket profilen ikke gør (afsnit 1, punkt 3).
- **Bedste runde vises kun ved > 0 point.** Fundet under verificering mod en rigtig PostgreSQL 16, ikke i gennemgangen: en spiller, hvis eneste runde gav nul point, ville have fået "din bedste runde nogensinde: 0 point". En rekord, der driller, er værre end ingen rekord.

**Akse-etiketterne står som HTML uden om SVG'en**, ikke som `<text>` inde i den: `Sparkline` bruger `preserveAspectRatio="none"`, så tekst inde i grafen ville blive strakt vandret på brede skærme. Ringen bruger `vectorEffect="non-scaling-stroke"` af samme grund.

**Verificeret mod PostgreSQL 16.13** med produktionsskemaet, 4 spillere over 3 afsluttede runder med håndregnet facit og en færdigspillet sæson: stillingerne matcher facit række for række, sæsontitlen udløses kun for den faktiske vinder og forsvinder, når ét resultat fjernes, `best_round_points` vælger den ældste runde ved lighed, en ny bruger giver `null`/`0` overalt, og filen er idempotent.

---

## 12. Rivaler: jævnbyrdighed frem for historier (K3 lukket, 30. juli 2026)

**Problemet var ikke, at der var for få rivaler — det var, at ordet "tætteste" var usandt.** Teksten sagde "Din tætteste rival", men rangeringen var antal `H2H_PASS`/`STREAK`-historier, altså hvor *dramatisk* forholdet havde været. På et testdatasæt gav den gamle metode én rival: den modstander, ejeren slår **4-0**. Den mest jævnbyrdige modstander (2-2) var usynlig, fordi der aldrig var skrevet en historie om hende.

**Hvorfor tragten var så smal.** Kun 2 af 16 Story Engine-regler skriver et rival-navn. Regel 40 (`H2H_PASS`) kræver en overhaling i netop den runde (bagud/lige før, foran efter); regel 60/75 (`STREAK`) kræver en **aktuel** stime på ≥2 sejre mod netop den person. Begge har `distinct on (competition_id, user_id)`, så der gemmes **én** rival pr. konkurrence pr. runde — overhaler man fire personer i én runde, findes der én række. I en lille liga med stabil rækkefølge sker der næsten ingen overhalinger. K3 forudsagde selv udfaldet.

**Den nye definition.** En rival er nogen, man *veksler slag med*: rangeret på `abs(sejre − nederlag)` blandt faktiske møder, med flest møder som tiebreak og `rival_id` som deterministisk sidste nøgle. Volumen alene ville ikke give rivaler, men blot den ældste medspiller i den største konkurrence.

**Møde-definitionen er lånt 1:1 fra `h2h`, ikke opfundet igen.** Et møde er én runde, hvor begge har tippet en kamp fra en delt konkurrence, dedupliceret pr. kamp, og hver side tæller de kampe, den selv har tippet — som `round_standings`, der heller ikke normaliserer for antal tippede kampe. Konsekvensen er en invariant, der er verificeret: `rivals`-posten om person X og `h2h`-linjen på X's profil svarer det samme. Det er den disciplin, tiebreaker- og Story Engine-leverancerne begge kostede at lære — to steder i produktet må ikke svare forskelligt på samme spørgsmål.

**`rating_history.rnk` er afvist**, selvom K3 selv foreslog den. `rnk` er den **globale** ratingplacering, så "placerings-nabo" kunne udpege folk, man ikke deler konkurrence med — direkte i strid med den ufravigelige designregel fra juli 2026. Den nye beregning starter i `competition_participants` og kan derfor *per konstruktion* ikke nævne en fremmed. Verificeret med to spillere, der har tippet præcis de samme kampe i en konkurrence uden profilens ejer: de optræder ikke.

**Ingen regression.** En story-rival er altid også en møde-rival: regel 40 kræver en stilling før runden for begge parter (≥1 tidligere fælles runde), regel 60 kræver ≥2 sejre i træk — begge medfører ≥2 møder. Historierne er beholdt som `stories`-feltet, altså farve i sætningen, aldrig rangering.

**To skavanker, der forsvandt undervejs.** `payload->>'rival'` er et `display_name`, ikke et `user_id`: (a) et navneskift kunne splitte én person i to rivaler, og (b) navnet kunne ikke trykkes på, så Rivaler var det ene sted i appen, hvor reglen *"et brugernavn er altid vejen til karrieren"* (afsnit 3) ikke gjaldt. Posten bærer nu `user_id`, så navnet er `PlayerName` som alle andre steder, og `ProfileScreen` tager imod `openProfile`.

**Tærsklen er navngivet, ikke indlejret.** `v_rival_min_meetings` (pt. **2**) står som en deklareret variabel i funktionen — samme princip som Story Engines kalibrerede tærskler: ét møde gør ingen til en rival, men en høj tærskel i en ung sæson med få runder giver nul rivaler. Den hæves, når der er runder nok til, at 2 møder ikke længere er meget.

**Det, der stadig bør måles i produktion:** beregningen er gået fra ét par til alle delte deltagere × runder inde i samme RPC. Med den nuværende brugerbase er det trivielt, men det er ikke målt på produktionsvolumen — det bør times, ikke antages.

---

## 13. Omfanget bor i info-feltet, ikke på siden (30. juli 2026, tredje runde)

**Afsnit 10's løsning blev delvist rullet tilbage efter brugerfeedback.** Den gav hver sektion med tal *både* en `InfoDot` og en **synlig** scope-linje under overskriften, med begrundelsen at en hjælpetekst bag et klik ikke fanger en forkert førstelæsning. Med alle sektioner på plads blev der fem forklarende afsnit på én skærm, og brugeren afviste dem: *"jeg vil gerne have den beskrivende tekst flyttet ind under Informations feltet … Det skal ikke stå på forsiden."*

**Hvad der blev fjernet:** scope-linjerne under Titler, Rekorder, Milepæle og Rivaler, den dæmpede undertekst på H2H-kortet og "Hele karrieren · alle kampe du har tippet"-linjen over basistallene. `scopeNote`-stilen findes ikke længere.

**Hvad der blev tilføjet:** en `InfoDot` til **hver** sektion med tal, så forklaringen findes alle de steder, den før kun fandtes ét af dem.

| Sektion | InfoDot | Placering |
|---|---|---|
| Karriere (hoved) | fandtes | på overskriften |
| Jeres indbyrdes opgør (H2H) | **ny** | inline efter sætningen (kortet har ingen overskrift) |
| Titler | **ny** | på overskriften |
| Titler pr. turnering | **ny** *(rettet efter levering — sektionen kom til med K2, 31. juli 2026, og har sin egen)* | på overskriften |
| Rekorder | fandtes, udvidet med scope-linjens indhold | på overskriften |
| Milepæle | **ny** | på overskriften |
| Rivaler | fandtes, udvidet med scope-linjens indhold | på overskriften |
| Basistal | **ny** | inline **efter** tallene (kortet har bevidst ingen overskrift, afsnit 2) |

**Hvorfor afsnit 10's ræsonnement ikke var forkert, men vejede forkert.** Præmissen holder — en bruger, der ikke *ved*, de har misforstået noget, åbner ikke en hjælpetekst. Men prisen blev betalt af alle på hver visning, mens gevinsten kun tilfaldt den, der læste forkert den første gang. Det, der faktisk fjerner tvivlen billigt, er ikke et ekstra afsnit, men at **tallet navngiver sit eget omfang i selve sætningen** ("Din bedste placering i *Championships rundeliga*", "din højeste *globale* rating", "4. plads *af 31 spillere*"). Det var også med i afsnit 10 og er beholdt uændret — det er den del, der bar løsningen.

**Reglen, som den står nu:** tal navngiver deres omfang i sætningen; `InfoDot` bærer forklaringen; siden har ingen forklarende brødtekst. **Ny sektion med tal ⇒ ny `InfoDot`, ikke ny brødtekst.**

**Bevidst beholdt som brødtekst:** ratingkurvens legende ("● grå/stiplet = foreløbig periode … ◎ = højeste rating nogensinde"). En legende afkoder symboler, man ser på *imens* — den er ikke en forklaring, man kan lægge et klik væk uden at gøre grafen ulæselig. Skala- og rundeetiketterne på kurvens akser er af samme grund heller ikke flyttet: de er aksevisning, ikke prosa.

---

*Leveret. SQL blev verificeret mod `sql/schema.sql` — husk, at den fil kun er gyldig som reference, når skema-eksporten er kørt efter seneste migrering (F1).*
