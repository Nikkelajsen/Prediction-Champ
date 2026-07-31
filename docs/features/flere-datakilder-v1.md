# Flere datakilder v1 — Sportmonks og football-data.org side om side

**Status:** leveret og i drift 31. juli 2026. Fire af de fem turneringer henter kampe;
Champions League gør endnu ikke (`B8` i [`../BACKLOG.md`](../BACKLOG.md)).
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
leagues.provider  ──►  api/providers/<key>.js  ──►  normaliseret kamp  ──►  fælles sync
```

| Fil | Rolle |
|---|---|
| `api/providers/index.js` | Registret. `getProvider()`, `providerToken()`, `indexSeasons()` |
| `api/providers/sportmonks.js` | Sportmonks. Koden er **flyttet**, ikke nyskrevet |
| `api/providers/footballdata.js` | football-data.org. Ny |
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
  home, away,                    // { providerId, globalId, name } | null
  status,                        // "scheduled" | "live" | "finished"
  score: { home, away },         // AKTUEL stilling — ikke nødvendigvis endelig
  liveState, liveMinute,
}
```

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
der er ingen skjult grænse af den slags, `A15` stadig er åben om hos Sportmonks.

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
- **Kadence-uoverensstemmelsen i `CRON.md` er ikke rettet.** Jobtabellen siger
  hver 12. time, overvågningen hver 6. med alarm efter 14 timer. Rettelsen
  kræver, at man ved, hvad jobbene faktisk står på i cron-job.org, og skal ske
  tre steder samlet. Noteret i backloggens indbakke.

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
