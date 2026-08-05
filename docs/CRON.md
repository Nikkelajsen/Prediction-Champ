# Cron-register — de planlagte jobs

Kilden til sandhed for, hvilke planlagte jobs der findes, hvad de kalder, og
hvordan de sender hemmeligheden.

## Hvorfor denne fil findes

Jobbene kører på **cron-job.org**, uden for dette repository. Indtil nu fandtes
opsætningen udelukkende i den konto's brugerflade, spredt over prosa i
`DOCUMENTATION.md`, `docs/features/live-resultater-v1.md` og
`docs/features/turnering-2.md`. Konsekvensen: opsætningen kunne hverken
gennemgås, diffes eller gendannes, og der var **ingen måde at svare på, om alle
jobs var flyttet til `x-sync-secret`** — hvilket er præcis den betingelse, ROADMAP
**A11** venter på.

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
| 1 | Kampprogram + endelige resultater Superliga | cron-job.org | hver 12. time, ved **minut 00** | `GET https://<app>/api/sync-matches?leagueId=<uuid>&smSeason=<navn>` | ? | 3. august 2026 — kørsel aflæst på cron-job.org (12:00, næste 00:00), lykkedes |
| 2 | Live-resultater | cron-job.org | hvert minut | `GET https://<app>/api/sync-live` | ? | — |
| 3 | Push-notifikationer **+ kåringer, historie-bagstopper og milepæle** | cron-job.org | hver 15.–30. minut, **hele døgnet** | `GET https://<app>/api/send-notifications` (valgfrit `&hours=`) | ? | — |

> **Job 3 gør mere end at sende beskeder.** Ud over kåringerne (`B11`, august 2026) kalder det siden Story Engine v2 også `generate_stories_catchup()` og `award_milestones(null)` som `service_role`. Begge er der af samme grund som kåringerne: matches-triggeren kan **per konstruktion** ikke se dem. Bagstopperen dækker en dag, hvis sidste kamp aldrig får et resultat, og en runde med en udsat kamp uden ny dato — i begge tilfælde skrives der intet til `matches`, så der er ingen trigger at fyre. Milepælene har tre familier, der slet ikke er kampdrevne (oprettede ligaer/konkurrencer, deltagne sæsoner, afsluttede konkurrencer). Alle tre kald er idempotente og springes over ved `dryRun`, fordi en forhåndsvisning er en læsning og ikke må uddele en permanent milepæl. **Der er ikke oprettet et nyt job** — de tre er lagt i et job, der i forvejen kører hyppigt nok.

| 4 | Skema-eksport | GitHub Actions | `0 6 * * 1` (mandag 06:00 UTC) + manuelt | `.github/workflows/schema-export.yml` | — (bruger repo-secret `SUPABASE_DB_URL`) | 30. juli 2026 |
| 5 | Kampprogram + endelige resultater Scotland | cron-job.org | hver 12. time | `GET https://<app>/api/sync-matches?leagueId=<uuid>&smSeason=<navn>` | ? | **2. august 2026 — kørsel aflæst i Admin → Drift: 198 af 198 kampe, tom `unmatched`, ingen fejl.** Bemærk at netop den kørsel har `authVia: admin-token`, altså et manuelt "Hent nu": den beviser, at *syncen* virker for Scotland, ikke at cron-jobbet selv kalder ind. Kolonnen til venstre er derfor stadig `?` (samme skelnen som i A11-tabellen nedenfor). `&smSeason=` i kaldet er reelt dødvægt: `sql/tournament_scotland_premiership.sql` satte `api_season_id` direkte, og parameteren læses kun, når id'et mangler — harmløs, men ikke påkrævet |
| 6 | Kampprogram + endelige resultater Premier League | cron-job.org | hver 12. time, ved **minut 05** | `GET https://<app>/api/sync-matches?leagueId=<uuid>` | `x-sync-secret` * | 31. juli 2026 (oprettet; første planlagte kørsel 01:05) |
| 7 | Kampprogram + endelige resultater Champions League | cron-job.org | hver 12. time, ved **minut 17** | `GET https://<app>/api/sync-matches?leagueId=<uuid>` | `x-sync-secret` * | **3. august 2026 — minuttal aflæst på cron-job.org (kørsel 16:17, næste 00:17): registret sagde minut 11, virkeligheden er 17.** 31. juli 2026 (oprettet; første planlagte kørsel 01:17. **`B8` er afgjort 1. august 2026:** football-data.org har endnu ikke oprettet sæsonen 2026 — deres aktuelle er 2025 — så jobbet henter 0 kampe og melder sig **gennemført** med forklaringen i `emptySeason`, indtil ligafasen er lodtrukket) |
| 8 | Kampprogram + endelige resultater Bundesliga | cron-job.org | hver 12. time, ved **minut 23** | `GET https://<app>/api/sync-matches?leagueId=<uuid>` | `x-sync-secret` * | **3. august 2026 — minuttal aflæst på cron-job.org (kørsel 16:23, næste 00:23): registret sagde minut 17, virkeligheden er 23.** 31. juli 2026 (oprettet; første planlagte kørsel 01:23) |
| 9 | Kampprogram + endelige resultater Serie A | cron-job.org | hver 12. time, ved **minut 11** | `GET https://<app>/api/sync-matches?leagueId=<uuid>` | `x-sync-secret` * | **3. august 2026 — minuttal aflæst på cron-job.org (kørsel 16:11, næste 00:11): registret sagde minut 23, virkeligheden er 11.** 31. juli 2026 (oprettet; første planlagte kørsel 01:11) |
| 10 | Kampprogram + endelige resultater Primera División | cron-job.org | hver 12. time, ved **minut 29** | `GET https://<app>/api/sync-matches?leagueId=<uuid>` | `x-sync-secret` * | **31. juli 2026 — kørt planlagt kl. 00:29, lykkedes (4,31 s)** |
| 11 | Datasikkerhedskopi | GitHub Actions | `0 3 * * *` (dagligt 03:00 UTC) + manuelt | `.github/workflows/data-backup.yml` | — (repo-secrets `SUPABASE_DB_URL` + `BACKUP_PASSPHRASE`) | 2. august 2026 (oprettet) |

> **Job 3 skriver også, og ikke kun til `notification_log` (3. august 2026, `B11`).** Hver kørsel kalder `award_competition_periods()` som `service_role` for hver konkurrence med `mode_params.awards`, FØR den læser kåringerne. Funktionen er lazy og blev indtil da kun trigget af en klient, der åbnede boardet, så en kåring — og dermed Story Engines kort for den — kunne mangle, til nogen tilfældigvis kiggede. Kaldet er idempotent (`on conflict do nothing`), og `&dryRun=true` springer det over, fordi forhåndsvisningen er en læsning. Det betyder også, at et stoppet job 3 ikke længere kun koster beskeder: kåringerne skrives da først, når nogen åbner boardet.

**Kolonnen "Hemmelighed sendes som" står med `?` med vilje.** Den kan ikke
udfyldes fra repoet — kun ved at kigge i cron-job.org eller ved at aflæse
loggene, se nedenfor. Udfyld den, når du ved det.

**\*** Job 6–10 er udfyldt efter opsætningsvejledningen, ikke efter et opslag i
cron-job.org. Antagelsen er efterprøvelig og efterprøver sig selv: dukker der en
`[A11]`-advarsel op i Vercels logs efter deres første kørsel, kom hemmeligheden
som `?secret=`, og stjernen skal rettes til `?query`. Bliver logs tavse, holder
den. Det er samme mekanisme, `A11` i øvrigt hviler på.

**Navnene i cron-job.org er ikke helt ens** — fire hedder "Kampe & Resultater
\<turnering\>", to af dem med "Hent" foran og én med bindestreg. Det er kosmetik,
men noteret her, fordi registeret skal kunne bruges til at *finde* jobbet igen.

Job 4 er det eneste, der er defineret **i** repoet og dermed det eneste, der er
versioneret. Resten er beskrevet her, men lever andetsteds.

## Hemmeligheden: header frem for query

`SYNC_SECRET` (miljøvariabel i Vercel) er den delte hemmelighed for alle
cron-jobbene mod appens endpoints (job 1–3 og 5–10 — samme `isAuthorized()`).
Der er to måder at sende den, og begge virker i dag:

| Måde | Status |
|---|---|
| Headeren `x-sync-secret: <SYNC_SECRET>` | **Den rigtige.** Brug altid denne til nye jobs. |
| Query-parameteren `?secret=<SYNC_SECRET>` | Fallback på vej ud (BACKLOG **A11**). Hemmeligheden havner i request-logs. Prøves i øvrigt kun, når headeren er helt udeladt — en sat, men forkert header blokerer fallbacken. |
| `Authorization: Bearer <admin-JWT>` | Tredje vej ind, kun til mennesker: en admin-brugers eget Supabase-token — det, "Hent nu"-knappen og Drift-forhåndsvisningen bruger (vises som `admin-token` i A11-tabellen nedenfor). Ikke til cron-jobs. |

Reglerne bor ét sted: `isAuthorized()` i `api/_shared.js`.

### Sådan afgøres A11

Fallbacken kan ikke fjernes på et gæt — rammer man forkert, svarer jobbene 401,
og syncen står stille. Fremgangsmåden er **ét SQL-opslag** (august 2026):

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
| `header` for ALLE jobs, og intet andet | Fallbacken er ubrugt. Fjern den fra `api/_shared.js`, og udfyld kolonnen ovenfor |
| `query` for ét job | Dét job kalder stadig med `?secret=`. Ret det i cron-job.org, og kør opslaget igen om et døgn |
| `admin-token` | Et menneske har trykket "Hent nu" i Admin. Tæller ikke med — cron-jobbene er dem, der skal flyttes |
| Et job **mangler helt** | Det har ikke kørt i vinduet. Det er IKKE det samme som "kalder rigtigt", og det er den eneste måde at tage fejl på her |

**Hvorfor et opslag og ikke logs.** Frem til august 2026 var det eneste spor en
advarsel i Vercels logs (`[A11] Forældet autorisation …`, som stadig skrives).
Den fremgangsmåde havde tre svagheder, og den tredje er den alvorlige: man
skulle huske at kigge et sted uden for appen, inden for logopbevaringens vindue
— og **fravær af advarsler kunne ikke skelnes fra fravær af kørsler.** Et job,
cron-job.org havde deaktiveret, så ud præcis som et job, der kaldte rigtigt.
`isAuthorized()` har altid returneret `via`; værdien blev bare kasseret. Nu står
den i `job_runs.detail` med 30 dages historik (`prune_job_runs`), hvor et job
uden kørsler simpelthen mangler i svaret.

Vejen står også i **Admin → Drift** under "Seneste resumé" på hvert jobkort, hvis
man kun vil have et hurtigt kig.

## Overvågning

Der er to lag, og de dækker hver sin slags fejl.

**1. `job_runs` — hvad der skete.** Hver kørsel af hvert app-job skriver én række
— alle `sync-matches`-jobbene (1 og 5–10, som `sync-matches:<liga-uuid>`),
live-syncen og notifikationsjobbet (`sql/job_runs.sql`, skrevet af
`recordRun()` i `api/_shared.js`). Rækken
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

Samme workflow efterprøver **migreringernes virkning i databasen** før
helbredstjekket (`B16`). Den spørger ikke, om filerne er kørt — det ville kræve
et register, ingen vedligeholder — men om deres virkning står der: har
`monthly_standings` `security_invoker`, nævner `round_key()` `Europe/Copenhagen`,
har `anon` tabel- eller sekvens-grants, og står der en default privilege, der
ville give dem tilbage. De tre `anon`-kontroller kom til med `G58` (august 2026)
og er grunden til, at den klasse ikke længere kræver en skema-eksport og et
menneske for at blive opdaget.

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
2. **Advanced → Headers**: `x-sync-secret` = `SYNC_SECRET`. **Ikke** `?secret=`.
3. Slå "Treat redirects as success" fra.
4. **Tilføj en række i tabellen ovenfor**, inkl. dato for verifikation.
