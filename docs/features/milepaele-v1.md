# Milepæle v1 (august 2026)

## 1. Problemet

Milepæle var ikke et begreb i koden. `loadCareerMilestones` hentede alle rækker i `stories` med `priority < 90` og kaldte dem milepæle. Story Engine gemmer **alle** udløste kandidater hver runde — ikke kun den, der vises på Hjem — så en bruger i tre konkurrencer samlede "Kun 3 point op til føringen", "Din bedste runde hidtil" og "2 præcise resultater" op hver eneste uge.

Karriereprofilens minde-liste var altså en rundelog, hvor de ægte øjeblikke lå gemt inde imellem.

## 2. Definitionen

> **Historie** = hvad der skete i denne dag eller runde. Flygtig, gentager sig, forsvinder fra Hjem igen.
> **Milepæl** = noget du har opnået **én gang** og altid har opnået. Permanent.

Det er hele skellet, og det er det, tabellen håndhæver: primærnøglen er `(user_id, key)`, og hver skrivning er `on conflict do nothing`.

Nøglen bærer tieret (`RATING_1200`, `TIPS_500`). `competition_id` er **kontekst til teksten, ikke identitet** — "Første sejr i en konkurrence" er én begivenhed, ikke én pr. konkurrence.

## 3. Kataloget

Fire familier, som karriereprofilen grupperer efter.

### Konkurrence
`COMP_FIRST_WIN` · `COMP_WIN_BIG_8` (≥8 deltagere) · `COMP_PODIUM` (top 3, kræver ≥5 deltagere) · `COMP_COMEBACK` (vandt uden at have ført undervejs) · `MONTH_CHAMP` · `SEASON_CHAMP`

### Rating
`RATING_ESTABLISHED` (de fem provisoriske runder gennemført) · `RATING_1100/1200/1300/1400` · `LEADERBOARD_TOP10/TOP3/NO1`

### Streaks & præcision
`POINTS_STREAK_5/10/20` · `ROUNDS_COMPLETE_10/30/100` ("aldrig glemt") · `PERFECT_ROUND` · `PERFECT_ROUND_EXACT` · `TIPS_100/500/1000` · `EXACT_50/250`

### Fællesskab
`FIRST_LEAGUE_CREATED` · `FIRST_COMPETITION_CREATED` · `LEAGUE_GREW_5/10` · `SEASONS_2/3`

## 4. Guards — det, der gør en milepæl noget værd

- **Feltstørrelse på ranglisten.** Top-10 kræver ≥10 ikke-provisoriske spillere, top-3 kræver ≥8, nr. 1 kræver ≥5. Uden dem uddeles "top 3 af 3" på dag ét, og milepælen betyder ingenting.
- **Deltagerantal i konkurrencen.** Podie kræver ≥5 deltagere — ellers er alle på podiet. Sejr kræver ≥2.
- **Perfekt runde kræver ≥5 kampe.** Fire rigtige er ikke en perfekt runde, og en runde med én kamp er slet ikke en.
- **Sæsoner kræver ≥5 tips pr. sæson**, så et strøtip ikke tæller som "en sæson med".
- **Rating måles mod peak**, ikke mod nuværende: en bedrift kan ikke tabes igen.

## 5. Hvornår er en konkurrence slut?

Fire af konkurrence-milepælene kræver, at en konkurrence er færdig, og **det begreb fandtes ikke** — `competitions` har hverken slutdato eller status.

"Alle mine kampe har resultat" er ikke nok: `full_season`/`team`/`time_range` får løbende nye kampe via `api/_backfill.js`, så en sådan konkurrence kan se færdig ud mandag og vokse igen onsdag. Og en uddelt milepæl kan ikke tages tilbage.

Viewet `competition_status` afgør det: alle kampe har resultat, **og** — for de modes, der kan vokse — er deres sæsoner færdigspillede. `mode_params ? 'stages'` markerer en håndafgrænset gammel konkurrence, som aldrig vokser.

Det er ny logik uden produktionshistorik, og den uddeler en permanent belønning. CI-testen "en voksende konkurrence med uafsluttet sæson meldes ikke færdig" er det, der holder den ærlig.

## 6. Frossen semantik

`recompute_ratings()` er en fuld genopbygning, så en rettet kamp kan sænke en brugers peak under en tærskel, de allerede har fået. **Rækken bliver.**

Det er samme afvejning som `competition_awards` (A22) og som en afsendt push — men det betyder, at tabellen før eller siden rummer en række, de nuværende data ikke længere begrunder. Det er et vilkår, ikke en fejl.

## 7. Hvem skriver, og hvornår

**Fra matches-triggeren**, inde i exception-guarden, kun når en runde bliver komplet. Alt kampdrevet (rating, præcision, perfekte runder, stimer) bliver sandt netop dér, hvor ratings lige er genberegnet — og brugeren kigger på sit kort i samme øjeblik.

**Fra `api/send-notifications.js`** som `service_role` ved hver kørsel. Tre familier er ikke kampdrevne og ses aldrig af triggeren: oprettede ligaer/konkurrencer (skriver til `groups`/`competitions`), deltagne sæsoner (sandt når en sæson starter) og konkurrence-familien (afhænger af, at `competition_status` vipper, hvilket kan være kalenderdrevet).

**Ikke fra klienten.** Skriver-sættet er trigger + cron, som `competition_awards`.

## 8. Tekst og visning

Teksten bor **kun** i `src/lib/milestones.js`. Tabellen gemmer `key` + `payload`, så en formulering kan rettes uden en migrering — modsat historierne, hvor SQL'en gemmer færdig `headline`/`body` og JS-modulet skal spejle skabelonerne.

Kataloget er defensivt: en ukendt nøgle (fx uddelt af en nyere SQL-version end den kode, brugeren har hentet) falder tilbage på nøglen selv frem for at kaste. Et arkiv må ikke kunne vælte karriereprofilen.

**På karriereprofilen** grupperes milepælene i de fire familier frem for at stå kronologisk. Med ~30 engangs-bedrifter er kronologien ikke længere den nyttige akse: man vil se, hvad man har opnået. Tomme familier udelades. Privat som før — kun egen profil, via RLS på `milestones`.

**På Hjem** lægger en nyopnået milepæl sig forrest i karusellen som guldkort. Uden den plads ville de fleste aldrig opdage, at de havde opnået noget. Milepæle kan ikke afvises — de er permanente.

## 9. Det, der ikke kunne bygges

**"5/10 venner tilmeldt via dit link" findes ikke i skemaet.** `groups.invite_code` er én kode pr. **liga**, ikke pr. bruger, så koden kan ikke identificere afsenderen. Hverken `group_members` eller `competition_participants` har en `invited_by`-kolonne. `analytics_events.league_invite_accepted` bærer kun `groupId` og `metadata.via` — aldrig inviterens id — og tabellen er i sin egen header erklæret *"lossy by design og må ALDRIG bruges til noget, en bruger kan bestride"*. En permanent bedrift er per definition noget, en bruger vil bestride.

Milepælen er derfor **erstattet** af `LEAGUE_GREW_5/10`: "5/10 medlemmer i en liga, du har oprettet". Det er en anden bedrift, og den hedder noget andet. Personlige invite-links (`invite_links` + `invited_by` + ændret del- og tilmeldingsflow) ligger i backloggens indbakke; de kan først tælle fra den dag, de udrulles — historisk attribution er uigenkaldeligt tabt.

**"Ny personlig rekord" blev ikke en milepæl.** Den gentager sig og passer ikke i en tabel nøglet `(user_id, key)`. Den findes allerede som story-regel 30 `RATING_HIGH` og bliver dér.

## 10. Kendte begrænsninger

- **Deltagerantal er nutidigt, ikke et øjebliksbillede.** Forlader nogen konkurrencen inden scanningen, udløses `COMP_WIN_BIG_8` aldrig. Ikke løsbart uden en snapshot-kolonne; accepteret vilkår.
- **`COMP_COMEBACK` er upræcis i én retning.** En bruger uden tips i en given runde har ingen række dér og indgår ikke i den rundes rangering, så en mellemliggende førsteplads kan være usynlig. Konsekvensen er, at milepælen kan uddeles lidt for let — aldrig at en ægte comeback-sejr overses.
- **`POINTS_STREAK_*` er en point-stime, ikke en eksakt-stime.** Spec-linjen lød "5/10/20 eksakte resultater i træk hvor du fik point". En stime på 20 *eksakte* er statistisk uopnåelig (eksakt-raten er ~15 %, altså 0,15²⁰), mens 5/10/20 kampe i træk **med point** er en bedrift, man kan jagte. Samme vindue som dagsreglen `STREAK_STATUS`, så de to aldrig kan modsige hinanden.
