# Live-resultater v1

**Status: leveret (juli 2026).** Teknisk dokumentation: `DOCUMENTATION.md` afsnit 8. Produktfilosofi: [`../PRODUCT_BOOK.md`](../PRODUCT_BOOK.md).

---

## 1. Problemet

Under en kamp stod der blot **"I gang"** ud for kampen på Hjem-fanen. Man kunne se, at noget skete — men ikke hvad. Brugerne forlod appen for at slå stillingen op et andet sted, netop i de 90 minutter hvor spændingen er størst og deres eget tip er på spil.

## 2. Målet

Mens en kamp spilles, skal appen vise **den nuværende stilling** — og det skal være umuligt at forveksle "i gang" med "færdigspillet".

Modkravet er lige så vigtigt: **tabellerne må ikke bevæge sig, før kampen er slut.** En stilling, der giver point for et 1-0 i 12. minut og tager dem igen i 88., er ikke en stilling — den er støj. Point er en afgørelse, ikke et øjebliksbillede.

## 3. Designbeslutningen: separate kolonner

Hele appen bruger ét udtryk som betydningen "kampen er spillet færdig":

```
matches.home_score is not null
```

Det gælder pointberegningen (`pointsFor`), alle tre stillings-views (`round_standings`, `season_standings`, `monthly_standings`), rating-triggeren, låsereglen (`isLocked` + RLS-policyen) og Story Engine.

Derfor skrives live-scoren **aldrig** i `home_score`/`away_score`, men i separate kolonner (`sql/live_scores.sql`):

| Kolonne | Indhold |
|---|---|
| `live_home_score` / `live_away_score` | nuværende mål |
| `live_state` | Sportmonks-state (`INPLAY_1ST_HALF`, `HT`, …) — `null` = ikke i gang |
| `live_minute` | spilleminut fra den tikkende periode (`null` i pauser) |
| `live_updated_at` | hvornår live-syncen sidst skrev |

Konsekvensen er, at **ingen eksisterende læse- eller skrivesti skulle ændres**:

- rating-triggeren (`sql/rating_trigger_optimization.sql`) sammenligner kun `home_score`/`away_score` i sine transition tables → live-opdateringer udløser hverken Elo-genberegning eller `generate_stories()`.
- stillings-views'ene summerer kun kampe med endeligt resultat → tabellerne står stille under kampen.
- låsningen er uændret (runde-baseret, kigger på `home_score` + kickoff).

Alternativet — at skrive live i `home_score` og filtrere det fra alle steder — ville have krævet ændringer i tre views, en trigger, en RLS-policy og hver eneste frontend-sti. Ét forglemt sted = forkerte point. Separate kolonner gør det rigtige til standarden.

## 4. Serverfunktionen (`api/sync-live.js`)

Ét cron-job, hvert minut, alle ligaer på én gang.

1. Slår i **vores egen** database op, hvilke kampe der kan være i gang: uden endeligt resultat med kickoff i [nu − 6 t; nu + 15 min], plus alle kampe der stadig står markeret som live.
2. Er der ingen — de fleste minutter i døgnet — returneres uden at kalde Sportmonks. Det er hele grunden til, at et minut-interval er forsvarligt på en gratis plan.
3. Ellers hentes præcis de kampe: `fixtures/multi/{ids}?include=scores;state;periods`, ét kald pr. 40 kampe.
4. Pr. kamp: **FT/AET/FT_PEN** → skriv endeligt resultat + ryd live-felterne · **i gang** → skriv kun live-felterne · **hverken/eller** (ikke startet, udsat, aflyst) → ryd live-felterne.
5. Alt skrives i **én** upsert, så statement-triggeren på `matches` kører netop én gang.

Uændrede skrivninger springes over, så databasen ikke bankes på hvert minut uden grund.

**Sidegevinst:** funktionen færdigmelder også kampe. Før ventede en færdigspillet kamp op til 15 minutter på næste `sync-matches`-kørsel; nu opdaterer stillinger og rating inden for et minut efter slutfløjt. `sync-matches` bevares uændret (ét job pr. liga, hvert 10.-15. minut) og passer kampprogram, flyttede kampe og nye hold.

## 5. Brugerfladen

Én helper, `liveInfo(match)` i `src/lib/scoring.js`, oversætter kolonnerne til UI-tilstand og er det eneste sted, reglen bor. Den returnerer `null`, hvis kampen ikke er i gang — og **et endeligt resultat slår altid live**, så en kamp aldrig kan "gå tilbage" til live efter at være meldt færdig.

Tre visuelt adskilte tilstande:

| Tilstand | Visning |
|---|---|
| Færdigspillet | resultat + point-pille + dæmpet **Slut** |
| I gang | nuværende stilling (rød) + rødt, pulserende **LIVE 63′** — ingen point |
| Kommende | kickoff-tidspunkt |

- **Hjem**, "Indeværende runde": LIVE-mærket vises allerede på det **foldede** kort (`liveCount`), så man kan se at der spilles uden at folde ud. Kortet genindlæser i forvejen hvert minut.
- **Tip**: LIVE-mærket står på kampens meta-linje, den nuværende stilling i en neutral, rød-kantet ramme — bevidst **uden** den grøn/rød-farvekodning som færdige kampe har, for der er intet afgjort endnu. Skærmen genhenter kun kampene, når mindst én kamp er i live-vinduet.
- Pulsen slås fra ved `prefers-reduced-motion`.
- "Sådan virker det" har fået en **Live-resultater**-sektion, der siger det direkte: live-stillingen giver ingen point, og tabellerne opdateres først ved slutfløjt.

## 6. Bevidst udeladt i v1

- **Live i Championship-/liga-stillingerne.** De skal netop stå stille under kampen — en "hvis alt ender sådan her"-projektion er en selvstændig feature (og et selvstændigt produktspørgsmål), ikke en del af live-resultater.
- **Live-notifikationer ved mål.** Push-strategien er bevidst "få, relevante beskeder" (to typer). Målnotifikationer ville tredoble støjen.
- **Målscorere, kort, statistik.** Kræver flere Sportmonks-includes pr. kald; giver ikke mere til tippekonkurrencen.

## 7. Engangsopsætning

1. Kør `sql/live_scores.sql` i Supabase ("Run without RLS").
2. Opret ét cron-job på cron-job.org: hvert minut, `https://<app>/api/sync-live`, med headeren `x-sync-secret`. Ingen query-parametre.
3. Verificér med `?dryRun=true` under en kamp: svaret viser `live`, `finished` og `cleared` uden at skrive noget.
