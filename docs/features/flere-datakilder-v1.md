# Flere datakilder v1 — Sportmonks og football-data.org side om side

**Status:** leveret og i drift 31. juli 2026. Fire af de fem turneringer henter kampe.
Champions League gør ikke — og **`B8` er afgjort 1. august 2026: det er ikke en fejl.**
football-data.org har endnu ikke oprettet sæsonen 2026 (deres aktuelle er 2025), fordi
ligafasen ikke er lodtrukket. `api_season_id` er rigtig, og turneringen henter af sig
selv, når sæsonen kommer. Se 7.1 og 7.2.
Alle fem er synlige og officielle (`A19`).
**Beslutning:** `A18` i [`../DECISIONS.md`](../DECISIONS.md).

---

## 1. Hvorfor

Sportmonks var ikke et valg, men en antagelse. Leverandøren stod skrevet ind i
URL'er, feltnavne og konstanter i `api/sync-matches.js` og `api/sync-live.js`,
og der fandtes ingen beslutningsrække om, hvorfor netop den. Det holdt fint, så
længe der var én kilde.

Men gratis-planen dér rummer kun fire turneringer: Superliga (`271`), Superliga
Play-offs (`1659`), Scotland Premiership (`501`) og Premiership Play-Offs
(`513`). `A10` gjorde regnestykket op den 31. juli 2026: Premier League koster
€29/md (Starter, 5 selvvalgte turneringer), og Champions League ligger i et
add-on til yderligere €29/md. For en app uden indtægter, hvor udgiften er
privat, var ~430 kr./md ikke en fodnote.

**football-data.orgs gratis-plan rummer 12 turneringer** — FIFA World Cup, UEFA
Champions League, Bundesliga, Eredivisie, Brasileirão Série A, Primera División,
Ligue 1, Championship, Primeira Liga, EM, Serie A og Premier League — og mangler
kun én ting, vi bruger: Superligaen. Præcis den, Sportmonks har.

De to planer er altså komplementære, ikke konkurrerende. Tilsammen koster de
ingenting. Det spørgsmål, `A10` aldrig stillede, var ikke *hvilken plan*, men
*hvilken leverandør* — og svaret viste sig at være "begge".

## 2. Hvad der blev bygget

Datakilden er nu en egenskab ved **ligaen**, ikke ved koden.

```
leagues.provider  ──►  api/_providers/<key>.js  ──►  normaliseret kamp  ──►  fælles sync
```

| Fil | Rolle |
|---|---|
| `api/_providers/index.js` | Registret. `getProvider()`, `providerToken()`, `indexSeasons()` |
| `api/_providers/sportmonks.js` | Sportmonks. Koden er **flyttet**, ikke nyskrevet |
| `api/_providers/footballdata.js` | football-data.org. Ny |
| `sql/multi_provider.sql` | `leagues.provider` + `leagues.live_enabled` + check-constraint |
| `sql/tournament_footballdata.sql` | De fem turneringers `leagues`- og `seasons`-rækker |

`api/sync-matches.js` og `api/sync-live.js` kender herefter **ingen leverandørs
feltnavne**. Holdmatchning, upsert, `job_runs`-logning og autorisation er fælles.

### Den normaliserede form

Alt, hvad et providermodul returnerer:

```js
{
  providerId, globalId,          // leverandørens id · værdien i matches.api_fixture_id
  kickoffAt, stageName,
  kickoffTbd,                    // klokkeslættet i kickoffAt er en PLADSHOLDER
  home, away,                    // { providerId, globalId, name } | null
  status,                        // "scheduled" | "live" | "finished"
  score: { home, away },         // AKTUEL stilling — ikke nødvendigvis endelig
  liveState, liveMinute,
}
```

> **Tilføjet efter levering (august 2026):** `kickoffTbd` stod ikke i det
> oprindelige udkast. Det kom til, da seks Superliga-kampe viste sig i appen med
> starttidspunkt "02.00" — midnat UTC, som begge leverandører sender, når kun
> datoen er kendt. Feltet er et godt eksempel på, hvad den normaliserede form er
> til for: **formen er fælles, kilden er det ikke.** football-data.org skelner
> `SCHEDULED` fra `TIMED`; Sportmonks har state `TBA` plus selve
> midnat-pladsholderen. Havde kalderen skullet kende den forskel, ville hele
> pointen med laget være væk.
>
> **Rettet 6. august 2026:** den ene af de to markører var forkert.
> football-data.orgs `SCHEDULED` betyder ikke "tiden mangler" — turneringer kan
> stå i den status længe efter, at tidspunkterne er sendt, og reglen skjulte
> derfor klokkeslæt, leverandøren havde leveret. **Begge** bruger nu
> midnat-pladsholderen i tidsfeltet (`isMidnightPlaceholder()` i
> `api/_providers/kickoff.js`); Sportmonks har fortsat `TBA` oveni. Pointen
> ovenfor står ved magt — den blev bare demonstreret den anden vej: markøren var
> leverandørspecifik i teorien og uprøvet i praksis, fordi API'et ikke kan nås
> fra udviklingsmiljøet. Begrundelsen: [`DECISIONS.md`](../DECISIONS.md),
> 6. august 2026.

`score` er den aktuelle stilling. Kalderen må kun skrive den i
`home_score`/`away_score`, når `status === "finished"` — hele appen bruger
"`home_score is not null`" som "kampen er spillet", så en live-stilling i den
kolonne ville udløse point midt i en kamp.

Kun tre statusser, fordi der kun findes tre behandlinger. Udsat, aflyst og
"ikke startet" ender alle i `scheduled`: en fjerde status ville være en skelnen
uden en konsekvens.

## 3. To valg, der er værd at kende

### 3.1 Id-præfiks frem for en provider-kolonne på `matches`

`matches.api_fixture_id` har en **global** unique-constraint
(`matches_api_fixture_id_unique`), og begge leverandører bruger almindelige
heltal — kamp `537654` findes i begge univers. Uden noget kunne to forskellige
kampe kollidere i upserten og tavst overskrive hinanden.

To udveje: en `provider`-kolonne på `matches` med en sammensat unique-constraint,
eller et præfiks på id'et. **Præfikset vandt**, fordi det ikke rører en eneste
eksisterende række: Sportmonks-id'erne står allerede i tusindvis af rækker og
beholder deres bare tal, mens football-data.org-id'er gemmes som `fd:537654`.
En sammensat constraint ville have krævet backfill og et constraint-skift på
basens største tabel — for at løse et problem, ingen data har i dag.

Prisen er en asymmetri, som ikke er smuk: én leverandør præfikser, den anden
ikke. Den ejes af `toGlobalId()`/`fromGlobalId()` i providermodulet, så
kaldstederne aldrig ser den. Samme konvention på `teams.api_team_id`.

`sync-live` finder til gengæld leverandøren via `season_id` →
`seasons.league_id` → `leagues.provider` (`indexSeasons()`). Det er to små
opslag mod tabeller med én række pr. turnering, og de ligger **efter** den
tidlige retur, så en stille nat stadig koster nul.

### 3.2 `live_enabled` er et flag, ikke en kodegren

football-data.orgs gratis-plan har **forsinkede resultater og ingen livescore**.
De fem turneringer får derfor `live_enabled = false`, og `sync-live` skriver
aldrig deres `live_*`-felter — kun de endelige resultater.

Det er bevidst lagt i **data** og ikke i kode, fordi det er abonnementet og ikke
arkitekturen, der bestemmer det. Tegnes deres €12/md-plan med livescores, er
hele opgraderingen:

```sql
update public.leagues set live_enabled = true where provider = 'footballdata';
```

Ingen kodeændring, ingen deploy. `footballdata.js` læser allerede `m.minute`,
selvom feltet er tomt på gratis-planen — netop for at opgraderingen kan begynde
at levere uden at nogen rører koden.

Kampe, der ER i gang, men undertrykt, tælles i `liveSuppressed` i kørslens svar.
Tallet er den synlige kvittering for, hvad €12/md faktisk ville købe.

**Point er upåvirkede.** De kommer altid fra det endelige resultat.

## 4. Kaldbudget — er 10 kald/minut nok?

Ja, med margin. Loftet er en **rate limit pr. minut**, ikke en månedspulje, så
der er ingen skjult grænse af den slags. **Det samme gælder Sportmonks (`A15`, aflæst
2. august 2026):** 3.000 kald i timen pr. entitet — også en rate limit, ikke en
månedspulje. De to leverandører adskiller sig altså i tal og periode, ikke i art.

| Kald | Frekvens | Forbrug |
|---|---|---|
| `sync-matches` (hele sæsonen, **ét** kald pr. turnering) | hver 12. time × 5 turneringer | 10 kald/døgn |
| `sync-live` (ét datovindue dækker alle fem) | hvert minut, kun mens kampe er i vinduet | ≤60 kald/time på kampdage |
| **Værste minut** (alle 5 `sync-matches` + `sync-live`) | | **6 af 10** |

Den afgørende forskel på leverandørerne er ikke loftet, men **formen**:
football-data.org returnerer hele sæsonens kampprogram i ét kald, hvor
Sportmonks skal pagineres (~4 kald). Forbruget skalerer altså med antal
turneringer én gang pr. sync — ikke med antal kampe.

Cron-jobbene er alligevel spredt på minut 05, 11, 17, 23 og 29
([`../CRON.md`](../CRON.md)), så intet minut bruger mere end 2. Ved 429 prøver
providermodulet igen én gang efter `X-RequestCounter-Reset`. Sker det, er det et
tegn på, at jobbene er faldet sammen — ikke at loftet er for lavt.

## 5. Fejl i én leverandør må ikke koste den anden

`sync-live` kører hvert minut og dækker alle ligaer. Hentede den alt i ét kald,
ville en manglende `FOOTBALLDATA_TOKEN` i Vercel slukke Superligaens live-scores.

Derfor hentes hver leverandørs gruppe i sit eget `try`/`catch`:

1. De leverandører, der virkede, får deres opdateringer **skrevet**.
2. Kampe fra en fejlet leverandør springes helt over — de må ikke ryddes, for
   "kunne ikke hentes" er ikke det samme som "findes ikke", og at slukke en
   igangværende kamp, hver gang en API vakler, ville være værre end intet.
3. Kørslen ender derefter som **fejlet**, så den er rød i Admin → Drift og hos
   cron-job.org.

## 6. Fasenavne

football-data.org skriver faser i VERSALER med understreg (`REGULAR_SEASON`,
`LAST_16`), hvor Sportmonks skriver dem i almindelig tekst (`Regular Season`,
`2nd Phase`). Begge oversættes i `STAGE_LABELS` (`src/lib/scoring.js`), som nu
har de to leverandørers navne i hver sin blok.

Champions League' ligafase mapper til **"Grundspil"** med vilje: badge-reglen
skjuler netop det ord, og en badge på hver eneste ligafase-kamp er præcis den
støj, reglen findes for. Knockout-runderne beholder deres badge, og det er dem,
der siger noget.

## 7. Champions League er anderledes

Knockout-kampene findes i kampprogrammet, **før** lodtrækningen er foretaget, og
har da ingen hold (`homeTeam.id === null`). `sync-matches` springer dem over og
tæller dem i `undrawn` i kørslens svar. De kommer med ved næste kørsel efter
lodtrækningen.

Det betyder, at en runde kan have huller frem til lodtrækningen, og at en
konkurrence scoped til fx ottendedelsfinalerne først kan oprettes bagefter —
samme vilkår som Superliga-slutspillet, af samme grund.

**Står `undrawn` stille hen over en lodtrækning, henter syncen ikke de nye
kampe.** Det er tallet, man kigger på.

### 7.1 Tilføjet efter levering (1. august 2026): den tomme sæson kan nu forklare sig selv

Spec'en forudså kampe uden hold. Den forudså ikke, at hele sæsonen kunne komme
tom hjem — og det gjorde Champions League ved idriftsættelsen (`B8`). Problemet
var ikke tomheden, men at den var **tvetydig**: turneringen henter ingen kampe,
og man kan ikke se, om det er en fejl. Enten er kampprogrammet ikke
offentliggjort endnu, eller også peger `api_season_id` et sted hen,
leverandøren ikke kender — og kun den ene retter sig selv.

**Rettet samme dag (se 7.2): tvetydigheden har to former, ikke én.**
`/competitions/CL/matches?season=<år>` kan både svare 200 med en tom liste og
**404** (*"The resource you are looking for does not exist"*), og de er lige
uigennemsigtige. Første udgave af diagnosen dækkede kun den første — og det var
den anden, Champions League faktisk gav.

Providerkontrakten har derfor fået en **valgfri** metode,
`describeEmptySeason()`, som `sync-matches` kalder — og kun kalder — når
sæsonopslaget enten kom tomt hjem **eller fejlede**. Den slår
`/competitions/<kode>` op og lægger svaret i `emptySeason` i kørslens detalje:

| `code` | Betydning | Handling |
|---|---|---|
| `season-empty` | Sæsonen findes hos leverandøren, men har endnu ingen kampe | Ingen — retter sig selv |
| `season-not-published` | Sæsonen er slet ikke oprettet endnu (aktuel sæson er ældre) | Ingen — retter sig selv |
| `season-unknown` | Året kendes ikke, og det er ikke et fremtidigt år | **Ret `seasons.api_season_id`** |
| `undetermined` | Leverandøren oplyste hverken aktuel sæson eller sæsonliste | Manuelt opslag |
| `lookup-failed` | Selve opslaget fejlede (fx 429) | Se på næste kørsel |

Prisen er ét ekstra API-kald, og kun mens turneringen alligevel ikke leverer
noget. Opslaget kan ikke vælte kørslen: en tom sæson **er** en gyldig kørsel, og
en fejlende diagnose må ikke gøre den til en fejlet.

Beskeden vises **to steder**: i `job_runs`-detaljen (Admin → Drift) og direkte
under "Hent nu"-knappen på Admin-skærmen. Det sidste er ikke pynt — den, der
trykker på knappen, er præcis den, der har brug for svaret, og kortet sagde
indtil nu kun *"0 kampe synkroniseret ud af 0 fundet"*, som er den samme sætning
i begge tilfælde. `season-unknown` står rødt, resten dæmpet, fordi kun den ene
kræver en handling.

### 7.2 Rettet efter første test (1. august 2026): 404, ikke tom liste — og én tolereret fejl

Det første forsøg på at hente Champions League gav ikke 200 med en tom liste,
men **404**. Diagnosen kørte derfor slet ikke: den sad kun på den tomme sæson,
mens 404'en kastede og gik direkte i `catch`'en. To ting fulgte af det.

**Diagnosen sidder nu på begge udgange.** Sæsonopslaget pakkes ind, og fejler
det, stilles spørgsmålet alligevel. Fejlbeskeden bærer så forklaringen med sig:
`football-data.org: 404 … — football-data.org har endnu ikke oprettet sæsonen
2026 (aktuel sæson er 2025)`. Den rå 404 er sand og ubrugelig; det er
sætningen efter tankestregen, man handler på.

**Og én kode tolereres.** Er svaret `season-not-published`, tælles kørslen som
**gennemført med nul kampe** frem for som fejlet. Grunden er ikke pænhed, men
brugbarhed: CL' ligafase lodtrækkes i slutningen af august, så jobbet ville
ellers stå rødt ved hver eneste kørsel i seks uger for noget fuldstændig
forventeligt — og et job, der altid er rødt, lærer én at holde op med at kigge,
hvorefter den *næste* røde række også er usynlig.

**Kun den ene kode slipper igennem.** `season-unknown` — et forkert
`api_season_id` — bliver ved med at være rød, fordi den ikke retter sig selv, og
det samme gælder alt, diagnosen ikke kunne afgøre. Præcis den skelnen er hele
grunden til, at diagnosen findes, og reglen er trukket ud som den rene funktion
`seasonFetchVerdict()` med sin egen test: en tolerance, der skrider, gør en død
turnering grøn.

### 7.3 Svaret på `B8` (1. august 2026)

Første kørsel med diagnosen i drift svarede:

> football-data.org har endnu ikke oprettet sæsonen 2026 (aktuel sæson er 2025).
> Ingen handling — turneringen begynder at hente af sig selv.

**Det var altså ikke en fejl.** `api_season_id = '2026'` er rigtig; sæsonen findes
bare ikke hos leverandøren endnu, fordi ligafasen ikke er lodtrukket. Kørslen
melder sig gennemført med nul kampe, indtil den bliver oprettet.

To ting, det kostede at nå frem til, og som er værd at huske:

**Antagelsen om, hvordan tomheden så ud, var forkert.** 7.1 blev bygget på "200
med tom liste"; virkeligheden var 404. En diagnose, der kun dækker den udgang,
man har forestillet sig, er ingen diagnose — den er en formodning med kode
omkring sig.

**Og rettelsen var ikke i drift, mens den blev afprøvet.** Deployet af den
fejlede tavst (se `DOCUMENTATION.md` §13), så den samme 404 blev aflæst tre
gange som kodens resultat, mens den kom fra en version, der var to merges
gammel. **Et uændret symptom efter en merge er ikke et resultat** — det er først
et resultat, når deployet er bekræftet.

## 8. Hvad der bevidst IKKE blev gjort

- **Ingen `provider`-kolonne på `matches`.** Se 3.1.
- ~~**`is_official = false` på alle fem.**~~ **Rettet efter levering (A19, 31.
  juli 2026): alle fem blev forfremmet samme dag.** Spec'ens argument var, at
  Championship summerer point på tværs af officielle turneringer, så fem nye
  ville ændre, hvad en titel betyder. Det argument holder — men det gælder kun
  turneringer med **tips**, og disse fem havde ingen konkurrencer endnu. Derfor
  var forfremmelsen gratis netop dér og ville være blevet dyrere for hver dag.
  Forfremmelse er stadig et selvstændigt valg; det blev bare truffet med det
  samme. `sql/tournament_footballdata_promote.sql`.
- ~~**`is_visible = false` indtil verifikation.**~~ **Rettet efter levering (31.
  juli 2026):** verifikationen blev kørt samme dag, og turneringerne blev tændt
  bagefter — altså som spec'en foreskrev, bare uden ventetid imellem.
- **Ingen retry på Sportmonks-siden.** Den har aldrig haft en, og at tilføje en
  under en oprydning ville skjule, om noget flyttede sig.
- ~~**Kadence-uoverensstemmelsen i `CRON.md` er ikke rettet.**~~ **Rettet efter
  levering (august 2026, `G6`):** jobtabellen sagde hver 12. time, overvågningen
  hver 6. med alarm efter 14 timer — og to andre steder sagde noget tredje og
  fjerde. Jobtabellen vandt, fordi den er den ene, der beskriver, hvad der
  faktisk er sat op i cron-job.org. Alarmgrænsen fulgte med til 26 timer.

## 8b. Rækkefølgen deploy → migrering er ufarlig

Koden deployes automatisk ved push til `main`, mens `sql/multi_provider.sql`
køres manuelt bagefter. I vinduet imellem findes kolonnerne `provider` og
`live_enabled` altså ikke endnu.

Derfor læser begge endpoints `leagues` med `select=*` frem for en kolonneliste:
en navngiven kolonne, der ikke findes, giver **400** fra PostgREST, og
`sync-live` kører hvert minut — live-scoren ville være nede i hele vinduet.
Med `*` mangler felterne bare, og `indexSeasons()` læser dem som "sportmonks,
live slået til", hvilket er præcis den verden, migreringen endnu ikke har
ændret. Tabellen har én række pr. turnering, så bredden koster intet.

## 9. Sådan sættes det i drift

> **Kørt 31. juli 2026.** Trinene står som opskrift, ikke som huskeliste —
> næste turnering fra samme kilde følger den samme vej.

1. Opret en gratis nøgle på <https://www.football-data.org/client/register> og
   sæt **`FOOTBALLDATA_TOKEN`** i Vercel (Production + Preview).
2. Kør `sql/multi_provider.sql` og derefter `sql/tournament_footballdata.sql` i
   Supabase SQL-editor med **"Run without RLS"**.
3. **Regressionstest Superligaen først** — det er eksisterende kode, der er
   flyttet:
   ```bash
   curl -s -H "x-sync-secret: $SYNC_SECRET" \
     "https://<app>/api/sync-matches?leagueId=<superliga-uuid>&dryRun=true"
   ```
   `totalFixtures` og `sample` skal være som før.
4. Tør-kør hver ny turnering (samme kald med dens uuid). Kontrollér holdnavne,
   kickoff-tider og fasenavne. `provider` i svaret skal stå på `footballdata`.
5. Kør uden `dryRun`, og **kontrollér `teams` for dubletter**:
   ```sql
   select league_id, name, api_team_id from public.teams
   where league_id in (select id from public.leagues where provider = 'footballdata')
   order by league_id, name;
   ```
   Dette er det punkt, der mest sandsynligt kræver manuel oprydning.
6. Opret de fem cron-jobs på de minutter, [`../CRON.md`](../CRON.md) udpeger.
7. Under en Premier League-kamp: `curl ".../api/sync-live?dryRun=true"` →
   kampen skal tælle i `liveSuppressed`, ikke i `live`.
8. Verificér i Admin → Drift, at `job_runs` viser grønne kørsler.
9. Tænd dem:
   ```sql
   update public.leagues set is_visible = true where provider = 'footballdata';
   ```
   `is_official` forbliver `false`.

---

## 10. Aflæsning: hvad sender football-data.org, når tiden ikke er fastsat? (`G81`)

**Status: UDFØRT 7. august 2026 — men ikke ad denne vej, og svaret var et andet
end de tre, guiden forudså.** Resultatet står i
[`../reviews/football-data-kickoff-aflaesning-2026-08-07.md`](../reviews/football-data-kickoff-aflaesning-2026-08-07.md),
og den åbne rest hed `G85`. Guiden bliver stående af to grunde: den skal
gentages for Champions League, når ligafasen er lodtrukket, og trinnene er de
samme, næste gang en leverandørs markør skal efterprøves.

**`G85` er lukket 8. august 2026, og rettelsen ligger IKKE i providerlaget.**
`kickoffTbdOf()` returnerer stadig `false` for hver eneste Premier League-,
Primera División- og Serie A-kamp, fordi der ikke findes et felt hos
leverandøren at læse tiden af. I stedet bærer `matches.kickoff_uncertain`
svaret: en trigger gemmer den forrige `kickoff_at`, og
`refresh_kickoff_uncertain()` lærer turneringens pladsholder-klokkeslæt af de
tider, der har flyttet sig mellem to kørsler (mindst tre fra samme UTC-tid,
`G84`s gulv), og markerer de øvrige kampe på det klokkeslæt. Markøren er
**display-only** — låsen og deadline-påmindelserne er upåvirkede, modsat
`kickoff_tbd`. Hele begrundelsen står i `sql/matches_kickoff_uncertain.sql`.

> **Det, aflæsningen gjorde anderledes — og bedre.** Guiden nedenfor går gennem
> `?dryRun=true`, altså gennem VORES normalisering. Aflæsningen gik uden om
> appen, direkte mod `api.football-data.org/v4`, og læste `utcDate` som rå
> tekst. **Det var afgørende:** guidens trin 1 ville have valgt turneringen med
> flest `kickoff_tbd`, og det er Bundesliga — den ene, hvor koden virker. Så
> ville svaret have været "antagelsen holder", og de tre turneringer, hvor
> flaget aldrig sættes, ville aldrig være blevet set. **En markør, man aflæser
> gennem sin egen tolkning af den, kan kun bekræftes.** Skal en leverandørs felt
> efterprøves igen, så læs det rå og læs mere end én turnering.

Guiden findes, fordi aflæsningen er billig og let at gøre forkert.

### Hvorfor den skal laves

`isMidnightPlaceholder()` (`api/_providers/kickoff.js`) er den ene regel, begge
leverandører deles om: står der `00:00:00` i tidsfeltet, er klokkeslættet ikke
fastsat. Filens eget hoved kalder midnat-testen "AFLÆST, ikke antaget" — men det,
der blev aflæst, er, at en kamp gemt med 00:00 UTC vises som 02.00 i appen,
altså at værdien går **ordret** igennem. Det er ikke det samme som at have set
football-data.org sende midnat for en kamp uden fastsat tid.

**Antagelsen er af samme slags som den, der allerede er afkræftet én gang.**
2. august 2026 blev `status === "SCHEDULED"` valgt som markør ud fra
leverandørens dokumentation; 6. august viste dataene, at den ikke holdt, og i
mellemtiden stod alle fem football-data-turneringer uden klokkeslæt i fire døgn.
Fejlretningen erstattede altså én udokumenteret aflæsning med en anden.

### Trin 0 — bekræft, at deployet er i drift

Springes dette over, aflæser man en gammel version og tror, man har et svar.
Det er ikke hypotetisk: `B8` blev aflæst tre gange som kodens resultat, mens
svaret kom fra en version, der var to merges gammel (§7.3). **Et uændret symptom
efter en merge er ikke et resultat.**

Åbn Vercel → Deployments og bekræft, at seneste commit på `main` er udrullet og
grøn.

### Trin 1 — find den rigtige turnering at kalde (i VORES data)

Dette trin er det vigtigste, og det er det, der er let at springe over. Kald
ikke bare Champions League: dens 2026-sæson fandtes ikke hos leverandøren så
sent som 1. august 2026 (§7.3), og en tom sæson svarer ingenting. Find i stedet
den turnering, hvor vi **selv** tror, der står pladsholdere:

```sql
select l.name                                            as turnering,
       l.api_league_id                                   as kode,
       s.api_season_id                                   as saeson,
       l.id                                              as league_id,
       count(*) filter (where m.kickoff_at >= now())      as kommende,
       count(*) filter (where m.kickoff_at >= now()
                          and m.kickoff_tbd)              as uden_tid,
       min(m.kickoff_at) filter (where m.kickoff_at >= now()
                                   and m.kickoff_tbd)     as foerste_uden_tid
  from public.leagues l
  join public.seasons s on s.league_id = l.id
  left join public.matches m on m.season_id = s.id
 where l.provider = 'footballdata'
 group by l.id, l.name, l.api_league_id, s.api_season_id
 order by 6 desc nulls last, 1;
```

Vælg rækken med det højeste `uden_tid`. Er `uden_tid` **nul overalt**, er der
lige nu ingen pladsholdere at aflæse — så er svaret at vente, til en runde langt
ude i fremtiden dukker op, frem for at kalde i blinde. Noter `league_id`.

### Trin 2 — hent hemmeligheden

Vercel → Settings → Environment Variables → **`SYNC_SECRET`**. Det er den
nemmeste vej ind: den anden (`Authorization: Bearer <bruger-JWT>`) kræver, at
man river et token ud af browseren, og den giver ikke et bedre svar.

### Trin 3 — kald forhåndsvisningen

```bash
curl -s -H "x-sync-secret: $SYNC_SECRET" \
  "https://<app>/api/sync-matches?leagueId=<league_id>&dryRun=true" | jq .
```

`dryRun=true` skriver **intet** til databasen og logger ikke en kørsel i
`job_runs` (`createRunLogger(..., { skip: dryRun })`). Kaldet er ufarligt og kan
gentages.

### Trin 4 — læs svaret

Forhåndsvisningen bærer begge rå felter **uændret**, og det er derfor det ene
kald kan besvare spørgsmålet:

| Felt i svaret | Kommer ordret fra | Kilde |
|---|---|---|
| `sample[].kickoff` | `m.utcDate` | `api/_providers/footballdata.js:90` |
| `sample[].state` | `m.status` | `api/_providers/footballdata.js:102` |
| `sample[].kickoffTbd` | **vores tolkning** af `kickoff` | `kickoffTbdOf()` |

Find de rækker i `sample`, hvor `kickoffTbd` er `true`, og se på deres
`kickoff`. Tre mulige udfald:

1. **`"2026-11-04T00:00:00Z"` — midnat, ordret.** Antagelsen holder.
   `isMidnightPlaceholder()` er nu aflæst og ikke gættet. Rækken lukkes, og
   kommentaren i `kickoff.js` rettes fra "AFLÆST" (om noget andet) til en
   henvisning til denne aflæsning med dato.
2. **Noget andet — fx `null`, `"2026-11-04"` uden tidsdel, eller et rigtigt
   klokkeslæt.** Så er reglen forkert, og det er et fund og ikke en skuffelse:
   `isMidnightPlaceholder()` skal skrives om, og `matches.kickoff_tbd` er
   forkert for de kampe, den har ramt. Kontrollen
   `sql/checks/kickoff_coverage.sql` er den, der siger, hvor bredt.
3. **`sample` er tom, eller `totalFixtures` er 0.** Så svarede turneringen ikke.
   Kig på `emptySeason` i svaret — diagnosen fra §7.1 forklarer sig selv i
   klartekst. Gå tilbage til trin 1 og vælg en anden turnering.

### Trin 5 — skriv svaret ned, uanset hvad det er

Aflæsningens værdi er, at den lukker en antagelse. Et svar, der kun står i en
terminal, er ikke en aflæsning — noter det i `kickoff.js`' hoved med **dato**,
og luk `G81` i backloggen. Blev udfaldet nr. 2, hører rettelsen og aflæsningen
sammen i samme leverance.
