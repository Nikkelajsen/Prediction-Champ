# Story Engine v2 — daglige historier (august 2026)

Bygger videre på `story-engine-v1.md`, som stadig beskriver runde-motoren, tonen og de 16 runde-regler. Denne fil beskriver **kun det, v2 tilføjer**.

## 1. Problemet

v1 talte én gang om ugen. `generate_stories(round_key)` kørte, når rundens sidste resultat var inde, og brugeren mødte ét kort. Mellem to mandag-aftener skete der intet på Hjem — også i uger med kampe fem ud af syv dage.

Samtidig var karriereprofilens "milepæle" et filtreret udsnit af den samme tabel (`priority < 90`). Da motoren gemmer *alle* udløste kandidater hver runde, samlede en bruger i tre konkurrencer "Kun 3 point op til føringen", "Din bedste runde hidtil" og "2 præcise resultater" op hver eneste uge. Arkivet var en rundelog.

v2 skiller de to ting ad: **stories bliver flygtigt feed-indhold**, og **milepæle bliver engangs-bedrifter** i deres egen tabel (`milepaele-v1.md`).

## 2. Modellen

To motorer, to tidsbegreber, én tabel:

| | Runde-motoren | Dags-motoren |
|---|---|---|
| Funktion | `generate_stories(p_round_key text)` | `generate_daily_stories(p_day date)` |
| Udløses når | rundens sidste resultat er inde | dagens sidste kamp er færdigspillet |
| Skriver | `period = 'round'` | `period = 'day'` + `day_key` |
| Antal | 1 vist (`latest_story`) | højst 2 pr. bruger pr. dag |
| Prioritet | 10–100 | 110–189 |

**Kortene akkumulerer gennem runden.** Karusellen på Hjem viser den aktuelle rundes kort, nyeste dag først, med et loft på 10. På rundens sidste dag lægger runde-motorens konkluderende kort sig øverst. Ny runde ⇒ nyt `round_key` ⇒ tom karrusel, uden at noget skal ryddes.

Ingen kampe på en dag ⇒ ingen kort. Det var et krav fra begyndelsen.

## 3. Dagens regler

| Prio | Regel | Udløses | Tærskel der holder den sjælden |
|---|---|---|---|
| 110 | `DAY_RESULT` | ≥1 scoret tip i dag | ankeret; optager reelt altid plads 1 |
| 120 | `CONTRARIAN` | præcis én i konkurrencen ramte udfaldet | **≥4 tippede kampen** |
| 125 | `COLLECTIVE_MISS` | ingen ramte kampen | ≥4 tippede, nul træffere |
| 130 | `DAY_TOP` | dagens højeste i konkurrencen | ≥3 deltagere, ≥2 kampe, vindersæt < felt |
| 140 | `STREAK_STATUS` | stimen lever eller brød | ≥5 i træk, **og den skal have ændret sig i dag** |
| 150 | `DUEL` | nærmeste rival over (eller under, hvis du fører) | afstand 1–3 **og afstanden har flyttet sig i dag** |
| 160 | `SO_CLOSE` | ét mål fra eksakt | **≥2 nærmisser** samme dag |

Tærsklerne er ikke pynt. Uden `is distinct from` på afstanden ville duellen fyre hver eneste dag med identisk tekst for alle i den øverste halvdel; uden "≥2 nærmisser" ville `SO_CLOSE` ramme næsten alle, fordi én målfejl er ~⅓ af alle tips; og uden "≥4 tippede" er "den eneste, der troede på Randers" trivielt sandt i en 3-mands konkurrence.

`STREAK_STATUS` er global (`competition_id` null) og ser dyrest ud — fuld historik-scanning med to vinduesfunktioner. **Målingen frikendte den:** 2,5 ms af dagsmotorens 23 i produktion (§11). Den mistænkte var ikke problemet.

### Loftet: to snit, i den rækkefølge

1. **Højst ét kort pr. regel pr. bruger.** Uden det ville en bruger med tre konkurrencer få to `DAY_RESULT`-kort og intet andet — reglen udløses i hver konkurrence og har den laveste prioritet af alle. Vinderen er den største liga.
2. **Derefter højst to kort i alt.**

I praksis betyder det *dagens facit + dagens højdepunkt*, hvilket er den tilsigtede læsning.

## 4. Hvorfor båndet 110–189

Valgt frem for en parallel 10–100-stige, i vigtighedsrækkefølge:

1. `loadCareerMilestones` filtrerede på `priority < 90`. Med båndet udelukkes dagskort **automatisk** fra arkivet. En parallel stige ville have oversvømmet minde-listen med "Dagens facit: 4 point" ved første udrulning — netop den fejl, v2 er sat i verden for at rette.
2. En forespørgsel, der glemmer `period`-filteret men sorterer på prioritet, sætter stadig runde-kort først. Sikker degradering.
3. `isQuiet()` (≥ 90) beholder sin betydning for sin eneste forbruger, `latest_story`, som nu er pinnet til `period = 'round'`.

180–189 er reserveret til et dæmpet dagstier, hvis det bliver nødvendigt. Intet genereres dér i dag.

## 5. Den danske dag

`matches.match_day` er en genereret `date`-kolonne fra `public.match_day(kickoff_at)` — samme form og samme begrundelse som `round_key()` efter G11: `timezone(text, timestamptz)` er immutable, mens casten `timestamptz::date` er stable.

**Afled aldrig en runde med `round_key(dag::timestamptz)`.** `date → timestamptz` læser sessionens `TimeZone` og er stable — det ville genindføre G11 ad bagvejen, denne gang i en funktion, ingen har mistanke til. Brug `round_key_of_date(date)`.

En dag er færdig, når ingen kamp med den danske dato mangler et resultat, og der findes mindst én kamp. **Afgrænsningen er global**, og prisen er kendt: én afbrudt kamp i en hvilken som helst liga blokerer dagen for evigt. Prædikatet holdes dumt og læsbart, og nødudgangen ligger i bagstopperen.

## 6. Bagstopper

`generate_stories_catchup(p_grace int default 2)` kaldes af `api/send-notifications.js` som `service_role` ved hver kørsel. Den dækker de to huller, matches-triggeren **per konstruktion** er blind for, fordi der ikke skrives til `matches`, når de opstår:

1. en dag, hvis sidste kamp aldrig får et resultat (afbrudt/annulleret),
2. en runde med en udsat kamp uden ny dato — det hul fandtes allerede i v1.

Samme mønster som B11's `award_competition_periods()`: jobbet er den pålidelige skriver for noget, en trigger ikke kan nå.

## 7. Triggeren har to porte

Rating-porten reagerer kun på ægte resultatændringer (uændret fra v1). Historie-porten er bredere: den reagerer også på **flytninger** (`match_day`/`round_key` ændret). En udsat kamp, der flytter *ud* af en dag eller runde, kan GØRE den færdig uden at ét resultat er ændret — et øjeblik v1 aldrig så. Rating må ikke trækkes med, da kampen ingen score havde.

## 8. Den farligste linje

`generate_stories`' delete er nu periode-afgrænset:

```sql
delete from public.stories where round_key = p_round_key and period = 'round';
```

Dagskortene bærer **samme `round_key`** som rundens kort, fordi karusellen grupperer på runden. Uden `and period = 'round'` tørrer runde-motoren hele ugens dagskort væk ved hver eneste resultatændring — og de genskabes aldrig, fordi dagsmotoren kun kører, når en dag *bliver* færdig. `sql/tests/story_engine_daily.sql` vogter præcis den regression.

Symmetrisk sletter dagsmotoren kun `period = 'day' and day_key = p_day`.

Af samme grund blev `generate_stories` **redigeret i `sql/story_engine.sql`** frem for at få en kopi i `story_engine_v2.sql`: en forældet kopi af funktionen ét sted i repoet ville være en landmine, som en gen-kørsel kunne udløse.

## 9. Frontend

Vandret swipe-karrusel og ikke en lodret stak, fordi produktbogens kapitel 6 beder forsiden om "næsten altid at fortælle én ting". Man ser ét kort ad gangen, det vigtigste ligger først — men ugen kan rumme mere end ét øjeblik.

Fire kort-udgaver: **milepæl** (guld + ikon, kan ikke afvises, ligger forrest) · **højdepunkt** (guld) · **dag** (almindeligt kort, kampdagens dato i eyebrow'en) · **dæmpet** (mindre overskrift, uden emoji, uden Del).

Karusellen filtrerer på den **klient-beregnede** rundenøgle (`currentRoundKey`) og aldrig på `max(round_key)`: i en ny rundes første dage findes der endnu ingen rækker, og et max ville vise den forrige uges kort i stedet for den tomme karrusel, en ny runde skal have.

`story_viewed` logges, når et kort **bliver synligt** — ikke for hele listen ved indlæsning. Ellers ville regelstatistikken i Analytics (A5) måle noget andet, end den påstår.

## 10. Push

**Ingen.** Hverken daglige historier eller milepæle sender push. Beslutningen beskytter A24-vurderingen: push-tilladelsen er den ene, produktet ikke kan få tilbage, og deadline-påmindelsen — produktets eneste aktive fastholdelses-værktøj — ryger med, hvis nogen slår notifikationer fra.

## 11. Kendte begrænsninger

- **Dagens afgrænsning er global.** Se afsnit 5. Bagstopperen dækker, men først efter to døgn.
- **`STREAK_STATUS` er dyr.** Se afsnit 3.
- **Teksterne står to steder.** `src/lib/stories.js` og SQL'en skal være byte-identiske. Syv nye regler er syv nye chancer for at drive fra hinanden — samme vilkår som v1.
- **Trigger-omkostningen er målt (august 2026), og den holder.** Alt kører synkront inde i den sætning, `api/sync-live.js` bruger til at afslutte en kamp, så tallet betyder noget.

  Produktionsmålingen var beroligende og uden informationsværdi: 23 ms i gennemsnit, men databasen havde kun **18 spillede kampe**. Dagsmotorens tunge del er opbygningen af `_sd_pts`, som er kumulativ og vokser hele sæsonen. Spørgsmålet var ikke, hvad den koster i august, men hvad den koster i maj — og det kan besvares uden at vente, med `sql/tests/story_engine_scale.sql` (syntetisk fuld sæson: 1800 kampe, 40 spillere, 33.000 rækker i `competition_match_points`, altså 116× produktionens datamængde):

  | | fuld sæson |
  |---|---|
  | `generate_daily_stories`, sidste dag | ~320 ms |
  | `generate_daily_stories`, første dag | ~45 ms |
  | `generate_stories` (runde-motoren) | ~105 ms |
  | `recompute_ratings` (**referencen**) | ~145 ms |
  | **hele trigger-sætningen ved rundeafslutning** | **~570 ms** |

  116× data giver kun ~14× tid, fordi den faste omkostning (otte temp-tabeller, syv regel-forespørgsler) dominerer ved små datamængder. Dagsmotoren er ~2,2× referencen, men kører kun når en dag bliver færdig, mens ratingen genberegnes ved **hver** resultatændring. Der er derfor intet at flytte — og `STREAK_STATUS`, som var den mistænkte, viste sig at koste 2,5 ms af de 23 i produktion.

  **De absolutte tal er maskinafhængige; forholdet til `recompute_ratings()` er ikke.** Det er derfor, målingen altid kører referencen med.
