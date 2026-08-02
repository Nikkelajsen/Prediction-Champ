# Cron-register — de planlagte jobs

Kilden til sandhed for, hvilke planlagte jobs der findes, hvad de kalder, og
hvordan de sender hemmeligheden.

## Hvorfor denne fil findes

Jobbene kører på **cron-job.org**, uden for dette repository. Indtil nu fandtes
opsætningen udelukkende i den konto's brugerflade, spredt over prosa i
`DOCUMENTATION.md`, `docs/features/live-resultater-v1.md` og
`docs/features/turnering-2.md`. Konsekvensen: opsætningen kunne hverken
gennemgås, diffes eller gendannes, og der var **ingen måde at svare på, om alle
jobs var flyttet til `x-sync-secret`** — hvilket var præcis den betingelse,
`A11` ventede på. Den er besvaret 2. august 2026, se afsnittet om hemmeligheden
nedenfor.

Filen erstatter ikke cron-job.org. Den er den liste, man holder kontoen op imod.

> **Denne fil er kun sand, hvis den vedligeholdes.** Opretter, sletter eller
> ændrer du et job, så ret tabellen i samme ombæring. Et register, der er
> forkert, er værre end intet register, fordi man tror på det.

## Jobbene

Antallet skalerer med turneringer: **N ligaer → N+2 jobs** (ét `sync-matches` pr.
liga, plus `sync-live` og `send-notifications`, som begge dækker alle ligaer).

**Minuttallet i job 6–10 er ikke pynt.** football-data.orgs gratis-plan har en
rate limit på **10 kald/minut**, og de fem jobs bruger ét kald hver. Faldt de
sammen på samme minut, ville de sammen med `sync-live` bruge 6 af 10 — stadig
under loftet, men uden luft til et gen-forsøg. Spredt med 6 minutters mellemrum
bruger intet minut mere end 2. Opret ikke et sjette football-data-job på et af
de minutter, der allerede er taget.

Bemærk at job 6–10 ikke sender `&smSeason=`: `api_season_id` er sat direkte i
`sql/tournament_footballdata.sql`, så navne-opslaget aldrig bliver nødvendigt.

**Kampprogram-jobbene hedder ikke længere det samme i driftsloggen.** Hver
kørsel af `sync-matches` skriver `sync-matches:<liga-uuid>` i `job_runs` (G44,
august 2026) frem for det fælles `sync-matches`. Indtil da delte alle syv jobs
én række, så `admin_job_health()` så dem som ét job: den seneste kørsel vandt,
og en turnering, der fejlede hver gang, stod grøn bag en, der gik godt. Det var
præcis den fejlklasse, `B8` var — og den blev kun fundet, fordi nogen kiggede
manuelt. Både Admin → Drift og `job-heartbeat.yml` udleder nu den forventede
jobliste af `leagues`-tabellen, så en ny turnering forventes uden at nogen skal
huske at rette en liste. Der skal **intet ændres i cron-job.org** — navnet
kommer af `leagueId`, som jobbene allerede sender.

| # | Job | Hvor | Skema | Kald | Hemmelighed sendes som | Sidst verificeret |
|---|---|---|---|---|---|---|
| 1 | Kampprogram + endelige resultater Superliga | cron-job.org | hver 12. time | `GET https://<app>/api/sync-matches?leagueId=<uuid>&smSeason=<navn>` | `x-sync-secret` | 2. august 2026 (A11-opslaget) |
| 2 | Live-resultater | cron-job.org | hvert minut | `GET https://<app>/api/sync-live` | `x-sync-secret` | 2. august 2026 (A11-opslaget) |
| 3 | Push-notifikationer | cron-job.org | hver 15.–30. minut, **hele døgnet** | `GET https://<app>/api/send-notifications` (valgfrit `&hours=`) | `x-sync-secret` | 2. august 2026 (A11-opslaget) |
| 4 | Skema-eksport | GitHub Actions | `0 6 * * 1` (mandag 06:00 UTC) + manuelt | `.github/workflows/schema-export.yml` | — (bruger repo-secret `SUPABASE_DB_URL`) | 30. juli 2026 |
| 5 | Kampprogram + endelige resultater Scotland | cron-job.org | hver 12. time | `GET https://<app>/api/sync-matches?leagueId=<uuid>&smSeason=<navn>` | `x-sync-secret` | **2. august 2026 — kørsel aflæst i Admin → Drift: 198 af 198 kampe, tom `unmatched`, ingen fejl.** Netop den kørsel havde `authVia: admin-token`, altså et manuelt "Hent nu", og beviste derfor kun, at *syncen* virker for Scotland — ikke at cron-jobbet selv kalder ind. Kolonnen til venstre er udfyldt af A11-opslaget samme dag, som fandt jobbets egne planlagte kørsler med `header` |
| 6 | Kampprogram + endelige resultater Premier League | cron-job.org | hver 12. time, ved **minut 05** | `GET https://<app>/api/sync-matches?leagueId=<uuid>` | `x-sync-secret` | **2. august 2026 — `header` (A11-opslaget)** · 31. juli 2026 (oprettet; første planlagte kørsel 01:05) |
| 7 | Kampprogram + endelige resultater Champions League | cron-job.org | hver 12. time, ved **minut 11** | `GET https://<app>/api/sync-matches?leagueId=<uuid>` | `x-sync-secret` | **2. august 2026 — `header` (A11-opslaget)** · 31. juli 2026 (oprettet; første planlagte kørsel 01:17. **`B8` er afgjort 1. august 2026:** football-data.org har endnu ikke oprettet sæsonen 2026 — deres aktuelle er 2025 — så jobbet henter 0 kampe og melder sig **gennemført** med forklaringen i `emptySeason`, indtil ligafasen er lodtrukket) |
| 8 | Kampprogram + endelige resultater Bundesliga | cron-job.org | hver 12. time, ved **minut 17** | `GET https://<app>/api/sync-matches?leagueId=<uuid>` | `x-sync-secret` | **2. august 2026 — `header` (A11-opslaget)** · 31. juli 2026 (oprettet; første planlagte kørsel 01:23) |
| 9 | Kampprogram + endelige resultater Serie A | cron-job.org | hver 12. time, ved **minut 23** | `GET https://<app>/api/sync-matches?leagueId=<uuid>` | `x-sync-secret` | **2. august 2026 — `header` (A11-opslaget)** · 31. juli 2026 (oprettet; første planlagte kørsel 01:11) |
| 10 | Kampprogram + endelige resultater Primera División | cron-job.org | hver 12. time, ved **minut 29** | `GET https://<app>/api/sync-matches?leagueId=<uuid>` | `x-sync-secret` | **2. august 2026 — `header` (A11-opslaget)** · 31. juli 2026 — kørt planlagt kl. 00:29, lykkedes (4,31 s) |
| 11 | Datasikkerhedskopi | GitHub Actions | `0 3 * * *` (dagligt 03:00 UTC) + manuelt | `.github/workflows/data-backup.yml` | — (repo-secrets `SUPABASE_DB_URL` + `BACKUP_PASSPHRASE`) | 2. august 2026 (oprettet) |

**Kolonnen "Hemmelighed sendes som" stod med `?` indtil 2. august 2026.** Den
kunne ikke udfyldes fra repoet — kun ved at kigge i cron-job.org eller ved at
aflæse jobbenes egne kørsler. Den er nu udfyldt af A11-opslaget nedenfor, som
fandt `header` og intet andet for samtlige ni cron-job.org-jobs. Job 6–10 stod
desuden med en stjerne, fordi de var udfyldt efter opsætningsvejledningen frem
for efter en aflæsning; opslaget bekræftede antagelsen, og stjernen er væk.

**Opret et nyt job, og kolonnen står `?` igen, indtil opslaget har set det.**
Det er ikke pedanteri: hele A11 handlede om, at "vi plejer at sætte headeren på"
ikke er det samme som at have set den.

**Kørslerne siger noget andet om job 6–10's skema end tabellen gør.** Samme
opslag viste 24–26 kørsler pr. job i det døgn, dataene dækker — altså cirka hver
time, ikke hver 12. time som kolonnen påstår (job 1 og 5 rammer derimod deres to
kørsler i døgnet præcist). Det er ikke et problem for hverken rate limit'en eller
A11, og det er ikke rettet her, fordi det ikke kan afgøres fra repoet, hvad der
faktisk står i cron-job.org. Det ligger som en linje i backloggens indbakke.

**Navnene i cron-job.org er ikke helt ens** — fire hedder "Kampe & Resultater
\<turnering\>", to af dem med "Hent" foran og én med bindestreg. Det er kosmetik,
men noteret her, fordi registeret skal kunne bruges til at *finde* jobbet igen.

Job 4 er det eneste, der er defineret **i** repoet og dermed det eneste, der er
versioneret. Resten er beskrevet her, men lever andetsteds.

## Hemmeligheden: headeren, og kun headeren

`SYNC_SECRET` (miljøvariabel i Vercel) er den delte hemmelighed for job 1–3 og
5–10. Der er **én** måde at sende den:

| Måde | Status |
|---|---|
| Headeren `x-sync-secret: <SYNC_SECRET>` | **Den eneste.** |
| Query-parameteren `?secret=<SYNC_SECRET>` | **Fjernet 2. august 2026 (`A11`).** Giver 401. Kaldet skriver en `[A11]`-linje i Vercels logs, så en 401 af netop den grund kan kendes fra en forkert hemmelighed. |

Reglerne bor ét sted: `isAuthorized()` i `api/_shared.js`.

### Sådan blev A11 afgjort — og sådan tjekkes det igen

Fallbacken kunne ikke fjernes på et gæt — ramte man forkert, ville jobbene svare
401, og syncen ville stå stille. Fremgangsmåden var **ét SQL-opslag** (august
2026). Opslaget bliver stående her, fordi det stadig er måden at kontrollere et
nyt job på:

```sql
-- Hvordan har hvert job autoriseret sig den seneste uge?
select job,
       coalesce(detail->>'authVia', '(ukendt)') as vej,
       count(*) as koersler,
       max(started_at) as senest
  from job_runs
 where started_at > now() - interval '7 days'
 group by 1, 2
 order by 1, 2;
```

**Sådan læses svaret.** Én række pr. (job, vej):

| Hvad der står | Hvad det betyder |
|---|---|
| `header` for ALLE jobs, og intet andet | Alle jobs kalder rigtigt. Det var betingelsen for at fjerne fallbacken |
| `query` for ét job | Dét job kaldte med `?secret=`. Efter 2. august 2026 kan det ikke længere ske uden at jobbet også fejler — vejen giver 401, og kørslen skriver ingen `job_runs`-række. Tegnet er nu et **tavst** job plus en `[A11]`-linje i Vercels logs |
| `admin-token` | Et menneske har trykket "Hent nu" i Admin. Tæller ikke med — det er cron-jobbet selv, der skal kalde ind |
| Et job **mangler helt** | Det har ikke kørt i vinduet. Det er IKKE det samme som "kalder rigtigt", og det er den eneste måde at tage fejl på her |

**Svaret, A11 blev afgjort på (2. august 2026).** Alle **ni** cron-job.org-jobs
optrådte, og hvert eneste med `header` — ingen `query` nogen steder. `sync-live`
havde 1.458 kørsler med `header`, hvilket er præcis antallet af minutter siden
instrumenteringen blev deployet (1. august ca. 21.17), altså ikke ét sprunget
minut. De to jobs med det langsomste skema (hver 12. time) havde hver **to**
kørsler i vinduet, så perioden dækkede alle skemaer — netop den betingelse,
backloggen stillede. `(ukendt)` optrådte på rækker fra **før** deployet, hvor
feltet endnu ikke blev skrevet, og gav sig selv til kende ved, at deres `senest`
lå før samme klokkeslæt. To jobs havde desuden én `admin-token`-kørsel hver, som
efter reglen ovenfor ikke talte med.

**Hvorfor et opslag og ikke logs.** Frem til august 2026 var det eneste spor en
advarsel i Vercels logs (`[A11] …`, som stadig skrives, nu blot om et afvist
kald). Den fremgangsmåde havde tre svagheder, og den tredje er den alvorlige:
man skulle huske at kigge et sted uden for appen, inden for logopbevaringens
vindue — og **fravær af advarsler kunne ikke skelnes fra fravær af kørsler.** Et
job, cron-job.org havde deaktiveret, så ud præcis som et job, der kaldte rigtigt.
`isAuthorized()` har altid returneret `via`; værdien blev bare kasseret. Nu står
den i `job_runs.detail` med 30 dages historik (`prune_job_runs`), hvor et job
uden kørsler simpelthen mangler i svaret. Instrumenteringen var under et døgn om
at afgøre et spørgsmål, der havde stået åbent siden juli.

Vejen står også i **Admin → Drift** under "Seneste resumé" på hvert jobkort, hvis
man kun vil have et hurtigt kig.

## Overvågning

Der er to lag, og de dækker hver sin slags fejl.

**1. `job_runs` — hvad der skete.** Hver kørsel af job 1–3 skriver én række
(`sql/job_runs.sql`, skrevet af `recordRun()` i `api/_shared.js`). Rækken
indeholder varighed, om det gik godt, jobbets eget resumé og fejlteksten.
Aflæses i **Admin → Drift**. Tørre kørsler (`?dryRun=true`) logges bevidst
ikke — de laver ikke noget arbejde, og ville ellers nulstille fejlserien.

**2. `job-heartbeat.yml` — hvad der IKKE skete.** `job_runs` kan per definition
kun se de kørsler, der fandt sted. Et job, cron-job.org har auto-deaktiveret,
skriver ingen rækker, og tavshed ligner ro. Derfor kører en workflow **hver
halve time**, som slår alarm, hvis et job har været tavst for længe eller er
fejlet mindst 3 gange i træk.

Kadencen var indtil august 2026 hver 6. time og passede ikke til det, den
overvåger (`G46`): `sync-live`s tavshedsgrænse er 30 minutter, så et dødt
live-job kunne være usynligt næsten en hel kampdag — netop de timer, hvor det
betyder mest. En overvågning, der kigger sjældnere end den grænse, den
håndhæver, håndhæver den i praksis ikke. Repoet er offentligt, så de 48 kørsler
i døgnet er gratis; GitHub kører dog planlagte workflows med forsinkelse under
belastning, så kadencen er et loft for hyppigheden, ikke en garanti.

Alarmen ligger med vilje **uden for appen**: kører Supabase eller Vercel ikke,
ville en alarm inde i appen dø af præcis samme årsag som jobbet. Kanalen er
GitHubs egen notifikation, når workflowen fejler.

**Job 4 og 11 overvåges af ingen af de to lag** — de skriver ikke i `job_runs`
og optræder derfor ikke i Admin → Drift. De er selv GitHub Actions, så en fejlet
kørsel er allerede en rød workflow med en notifikation til ejeren; et ekstra lag
ville kun kunne se det samme. For job 11 (datasikkerhedskopien) er der en pointe
mere: den er rød, hvis dens **egen gendannelsestest** fejler, ikke kun hvis
dumpet fejler. Se [`RESTORE.md`](./RESTORE.md).

Tavshedsgrænserne er rundhåndede i forhold til kadencen, så et enkelt sprunget
interval ikke larmer:

| Job | Kadence | Alarm efter |
|---|---|---|
| `sync-live` | hvert minut | 30 minutter |
| `send-notifications` | hver 15.–30. minut | 3 timer |
| `sync-matches:<liga>` (ét pr. turnering) | hver 12. time | 26 timer |

> Grænserne står **tre** steder og skal ændres samlet: tabellen her,
> `.github/workflows/job-heartbeat.yml` og `BASE_JOBS`/`SYNC_MATCHES_*` i
> `src/lib/ops.js`.

**Kampprogrammets tal er rettet i august 2026 (`G6`).** Kadencen stod fire
steder med fire forskellige værdier: "hver 12. time" her i jobtabellen, "hver
6. time" i overvågningstabellen, i heartbeat'en og i `ops.js`, "hvert 10.-15.
minut" i `DOCUMENTATION.md` §8 og "pt. hver time" i `ROADMAP.md`. Registeret
vandt, fordi det er det ene af de fire, der beskriver, hvad der faktisk er sat
op i cron-job.org. Alarmgrænsen fulgte med fra 14 til 26 timer: 14 timer mod et
12-timers interval gav to timers luft, altså strammere end det skema, den skulle
overvåge — ét sprunget interval ville have larmet.

`job_runs` ryddes med `prune_job_runs(30)`, som kaldes af `job-heartbeat.yml`
før hvert helbredstjek. **Funktionen havde ingen kaldere overhovedet indtil
august 2026 (`G43`)** — dette afsnit beskrev en rydning, der ikke skete, mens
`sync-live` alene lagde 1.440 rækker i tabellen i døgnet. Heartbeat'en er
stedet, fordi den allerede har databaseadgangen og allerede kører på et skema:
en rydning er ét ekstra udsagn frem for et nyt endpoint, et nyt cron-job og en
ny række i denne tabel.

Ud over dette findes stadig cron-job.orgs egen fejlnotifikation og Vercels
invocation-forbrug — se `docs/features/live-resultater-v1.md` afsnit 9.

## Når du opretter et nyt job

Trin-for-trin-guiden med skærmfelter ligger i
[`features/live-resultater-v1.md`](./features/live-resultater-v1.md) afsnit 7.
Kort udgave:

1. cron-job.org → **Create cronjob**, `GET` mod endpointet.
2. **Advanced → Headers**: `x-sync-secret` = `SYNC_SECRET`. `?secret=` er ikke
   længere et alternativ, men en 401 — glemmer du headeren, kører jobbet aldrig.
3. Slå "Treat redirects as success" fra.
4. **Tilføj en række i tabellen ovenfor** med `?` i hemmeligheds-kolonnen.
5. Kør A11-opslaget ovenfor et døgn efter, og udfyld kolonnen med det, du så.
   Et job, der ikke er dukket op i opslaget, er ikke verificeret — det er tavst.
