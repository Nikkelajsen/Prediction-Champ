# Feature: Opret-flow v2 — galleri-først + lokale kåringer

**Leveret 1. august 2026** (A22). Samler backloggens `I4`, `I13` og `I14` og
forbereder `I15`. Opret-skærmen var designet til ét turneringsvalg og stod med
syv (snart 12+): én flad formular, hvor fire af fem konkurrence-typer gemte sig
bag en "Flere valg"-fold.

## 1. Begreber (vigtigt)

- **Korttype ≠ mode.** Galleriet viser seks produktnavne, men databasen har
  stadig de fem modes (`competitions_mode_check` er urørt). Oversættelsen bor i
  `src/lib/createTypes.js` og er ren data: Quick League er `random` med
  `mode_params.rounds > 1`, Ugens kupon er `random` med et preset, Periode er
  `time_range` under Custom-kortet.
- **Lokal kåring ≠ global titel.** "Ugens bedste" og "Månedens bedste" er
  konkurrencens egne kåringer (`competition_awards`). "Rundevinder" /
  "månedsmester" / "Champion" er Championships og bruges ALDRIG om de
  lokale — navnereglen fra [`turnering-2.md`](./turnering-2.md) §3.6 (*to
  niveauer må ikke konkurrere om samme navn*) er bindende her.

## 2. Galleriet (I14)

Første skærm er "Hvad vil I spille?" med seks kort; et valg viser kun dén types
1–3 felter plus de fælles (navn, liga, kårings-tilvalg). Rækkefølgen er
varigheds-spørgsmålet, så det første valg samtidig svarer på, hvor længe
konkurrencen lever.

> **Rettet efter levering (1. august 2026).** Udkastet stillede kortene
> **kort → langt** med Ugens kupon øverst og beskrev rækkefølgen som neutral
> varighed. Den er nu vendt til **langt → kort**, og Sæson er markeret
> **Anbefalet** — rækkefølgen er dermed ikke længere neutral, men en anbefaling:
> det øverste kort er dét, produktet vil have flest i. Sæson og Favorithold står
> sammen øverst, fordi de er de eneste to, der løber sæsonen ud OG vokser af sig
> selv (efterfyldnings-regel 1); Favorithold er derfor det nærmeste alternativ
> under det anbefalede. Tabellen nedenfor står i den leverede rækkefølge.
>
> Samme ombæring gav hvert kort et **ikon** og en **varigheds-mærkat** ("Hele
> sæsonen" / "Nogle uger" / "Én runde" / "Du bestemmer") over beskrivelsen.
> Begrundelse: typerne adskiller sig på to akser — *hvilke kampe* og *hvor
> længe* — og udkastets beskrivelser var varianter af hinanden, så begge akser
> skulle udledes af prosaen. Mærkaten er den anden akse gjort aflæselig. Felterne
> `duration` og `recommended` er ren data i `CREATE_TYPES`; ikonet bor i
> `TypeGallery.jsx` (`ICONS`), fordi `createTypes.js` skal kunne testes uden
> render.

| Kort | Mærkat | Mode + params | Opfølgning |
|---|---|---|---|
| **Sæson** (Anbefalet) | Hele sæsonen | `full_season` | turnerings-chips med kampantal |
| **Favorithold** | Hele sæsonen | `team`, evt. flere hold: `mode_params.team_ids` + `tournaments` | hold på tværs af turneringer (grupperet dropdown + chips) |
| **Quick League** | Nogle uger | `random`, `mode_params.rounds` 2–10 (default 6) | turneringer · **startrunde** · runder · kampe **pr. runde** |
| **Quick Pick** | Én runde | `random`, rounds=1 | turneringer · **startrunde** · antal kampe |
| **Ugens kupon** | Én runde | `random`, preset count=8, rounds=1, alle turneringer | **startrunde** — navnet forudfyldes "Ugens kupon <runde-label>" (det ENESTE kort med forudfyldt navn) |
| **Custom** | Du bestemmer | `custom` (håndpluk) eller `time_range` (periode) | metode · kampvælger ELLER **startrunde** + datointerval + turnering |

Vilkår, der bevidst er ført videre uændret: liga-feltet er aldrig skjult
(liga-løs må ikke ske tavst), tomme turneringer kan ikke vælges (frossen-liste-
problemet), og navne-forudfyldningen er FJERNET for alle andre kort end Ugens
kupon (`B6` — et foreslået navn blev bare beholdt).

> **Rettet efter levering (august 2026) — startrunde og kampantal.** Udkastet
> beskrev opfølgningen på de tre `random`-kort som "antal + turneringer" og
> antog stiltiende, at konkurrencen begynder i **nærmeste kommende runde**.
> Antagelsen var usynlig, fordi den lå i dataopslaget og ikke i en kontrol:
> `loadUpcomingMatches` henter fra `nu` og frem, så en konkurrence oprettet
> søndag aften fik ugens to resterende kampe som hele sin første runde — og
> skærmen sagde det ikke, den skrev bare "(1 i nærmeste runde)".
>
> To ting er ændret, og de hænger sammen:
>
> 1. **Startrunde-valget** ("Indeværende runde" / "Ny runde", standard
>    indeværende) er nu et felt på alle fire typer med en startrunde — de tre
>    `random`-kort og Custom/periode. Vælges indeværende, står nævneren ved
>    siden af: *"5 af 6 kampe i indeværende runde er allerede i gang eller
>    spillet — 1 kamp kan stadig tippes."* Det kræver et opslag på **hele**
>    runden (`loadCurrentRoundMatches`), fordi puljen af kommende kampe per
>    definition ikke kan se de kampe, der allerede er væk.
> 2. **Kampantallet er ikke længere klippet til nærmeste runde.** Feltets `max`
>    var antallet i nærmeste runde, hvilket gjorde en halvspillet startrunde til
>    reglen for **alle** Quick Leagues runder: med én kamp tilbage kunne man kun
>    skrive "1" i et felt, der gælder seks uger frem. Loftet er nu teknisk
>    (`MAX_MATCHES_PER_ROUND` = 50), og udbuddet er oplysning — for Quick League
>    spændet over de valgte runder ("4–38 kampe pr. runde").
>
> Custom/periode oversætter valget til sin **startdato** i stedet for at
> filtrere en pulje, og chippen er dér afledt af datoen: to kontroller, der
> begge kunne bestemme starten, ville kunne modsige hinanden. Turneringsvalget
> er samtidig flyttet **øverst** på de to Quick-kort, fordi felterne under det
> nu svarer med tal, der kun gælder for de valgte turneringer.
>
> Arbejdet fandt undervejs en fejl, der var ældre end det selv: puljen filtrerer
> på `kickoff_at >= nu`, mens låsen falder en **time** før kickoff (`A21`), så
> en Quick Pick oprettet en halv time før kampstart trak kampe, ingen kunne nå
> at tippe. `filterTippable` skærer dem fra i alle tre `random`-typer — både når
> puljen bygges og igen ved oprettelsen, fordi puljen er et øjebliksbillede.
> Custom er omfattet, men svarer modsat på sine to grene: håndpluk lader den
> låste kamp blive stående, slukket, med "Låst" (man leder dér efter en bestemt
> kamp, og en, der var væk, ville se ud som en, der ikke fandtes), mens
> periodens loft-gren skærer dem fra i stilhed (et loft er en regel, ikke en
> liste). Låser en kamp, mens skærmen står åben, taber de tilfældige typer den
> bare, mens håndpluk stopper oprettelsen og siger det. Periode uden loft er
> `time_range` og deler `filterFromNextUnfinishedRound` med `full_season` og
> `team` — ikke omfattet, noteret i `docs/BACKLOG.md`.
>
> Fuld beskrivelse i `DOCUMENTATION.md` §3; beslutningen i `docs/DECISIONS.md`.

*Rettet efter levering (august 2026): liga-feltet er ikke længere blot altid
synligt — det er **påkrævet**. "Ingen liga" er væk, og en liga kan oprettes i
selve feltet. "Liga-løs må ikke ske tavst" er dermed blevet til "liga-løs sker
ikke": `createCompetition` afviser en spec uden `groupId`. Se `DOCUMENTATION.md`
§18.*

### Spec-former (nye felter i `createCompetition`, alle bagudkompatible)

- `teams: [{ leagueId, seasonId, teamId }]` — ét hold ⇒ præcis legacy-formen
  (bundet `league_id`/`season_id`, `mode_params.team_id`); flere ⇒ turneringsløs
  med `mode_params.team_ids` + `mode_params.tournaments` (den sidste, fordi
  efterfyldningens `coversSeason()` afgør sæsondækning på dén nøgle).
- `rounds` — skrives i `mode_params` KUN når > 1, så gamle rækkers form er
  uændret, og `modeLabel(mode, modeParams)` kan skelne Quick League fra Quick
  Pick alene på feltet.
- `awards: true` ⇒ `mode_params.awards = true` i alle mode-grene.

`api/_backfill.js` kender `team_ids` (fallback til `team_id`); `random` er
fortsat aldrig backfillbar (regel 1 — en kupon må ikke vokse).

## 3. Lokale kåringer (I13)

Tilvalg ved oprettelsen ("Kår Ugens bedste og Månedens bedste undervejs"),
kun synligt for flerrunde-typer — i en én-rundes konkurrence ER vinderen ugens
bedste.

- **Tabel `competition_awards`** (`sql/competition_awards.sql`): PK
  `(competition_id, period_type, period_key, user_id)`; delt førsteplads = én
  række pr. vinder med `shared = true`; `stats` jsonb
  (exact/outcome/matches/goal_error) er nok til Story-kort/push uden migrering.
- **Writer: lazy SECURITY DEFINER-RPC** `award_competition_periods(comp_id)`,
  trigget ved board-åbning (`ensureCompetitionAwards` i
  `src/lib/data/awards.js`). Ingen cron — **bevidst**: boardet er v1's eneste
  visningsflade, så latensen "første åbning efter en færdig runde" er usynlig,
  og der er ingen cron-job.org-opsætning, ingen række i `CRON.md`, ingen
  `job_runs`-udvidelse. Klienten kan kun trigge, aldrig skrive: tabellen har
  ingen insert/update/delete-policies.
- **Kåringsregler:** runde kåres, når ALLE konkurrencens kampe i `round_key`
  har resultat; måned (Europe/Copenhagen), når alle månedens kampe har resultat
  OG kalendermåneden er slut (beskytter mod at efterfyldningen lægger en udsat
  kamp ind i en kåret måned). Stigen er Championship-stigen: point → præcise →
  udfald → målafvigelse; består ligestillingen hele stigen, er sejren delt.
- **Frossen:** `on conflict do nothing` — et resultat, der rettes EFTER
  kåringen, omgør den ikke (samme egenskab som en sendt push-besked).

## 4. Ligaer-fanen (I4)

Med ≥1 liga foldes "Opret en liga" og "Deltag med kode" sammen til én kompakt
knap-række, der folder det respektive inputfelt ud ved klik — ligalisten er det
første, man ser. Med 0 ligaer vises de to fulde kort som før: dér ER de opgaven.

## 5. Bevidst ikke med i v2

- **Weekly Mix-automatikken (`I15`)** — det ugentlige service_role-job, der
  opretter konkurrencen af sig selv. Ugens kupon-kortet leverer indholdet
  manuelt; det, der mangler, er kun gentagelsen. RPC'ens guard tillader
  allerede `service_role`, så et fremtidigt job kan kalde den uden migrering.
- ~~**Story-kort og push for lokale kåringer** — backloggens `B10`/`B11`.~~ **Leveret 3. august 2026:** Story Engine v1.2 giver kåringen to kort (`AWARD_WEEK` 65, `AWARD_MONTH` 15), og notifikations-jobbet sender beskeden — og skriver samtidig kåringerne som `service_role` ved hver kørsel, hvilket gør `award_competition_periods()` uafhængig af, om nogen åbner boardet. Guarden i `sql/competition_awards.sql` var skrevet med netop dette for øje. Se [`story-engine-v1.md`](./story-engine-v1.md) §12.
  `stats`-feltet og `service_role`-adgangen er forberedelsen.
- **Match-picker-forbedringer** (søgning, vælg-hel-runde, holdfilter) — pickeren
  er flyttet uændret ind under Custom-kortet.
- **Kårings-tilvalg på eksisterende konkurrencer** — flaget sættes kun ved
  oprettelsen. En "slå til bagudrettet"-flade ville kåre måneder, deltagerne
  ikke vidste talte.

## 6. Kendte vilkår og risici

- En kamp uden resultat blokerer sin rundes kåring i dén konkurrence for altid
  (korrekt scope — men samme fejlklasse som `G10` globalt; en senere fallback
  kunne kåre runder ældre end fx 14 dage).
- Månedsgrænsen regnes i Europe/Copenhagen; `round_key` bærer `G11`s
  UTC-quirk — kåringen arver den bevidst og løses med `G11`.
- Favorithold med flere hold er første produktionsbrug af
  `mode_params.tournaments`-læsningen i backfill (`G8`-klassen) — den første
  rigtige konkurrence bør efterses i Admin → Drift.
- `AdminScreen`s mode-statistik aggregerer uden `mode_params` og viser derfor
  Quick League som "Quick Pick" — accepteret, admin-intern.

## 7. Acceptkriterier

1. Alle seks kort kan oprette en konkurrence, og de tre "findes allerede"-typer
   skriver præcis samme rækkeform som før (bevist af de urørte
   `createCompetition`-tests).
2. Onboarding-guiden opretter stadig sin starter-konkurrence uændret (delt
   skriver, ingen spec-ændring for `full_season` single).
3. En opt-in-konkurrence viser "Kåringer"-sektionen; to board-åbninger i træk
   giver samme rækker (idempotens); en ikke-deltager ser ingen rækker (RLS).
4. `sql/competition_awards.sql` er kørt i produktion FØR frontend-mergen
   (omvendt: tom kåringssektion, ingen fejl).
