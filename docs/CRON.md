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

| # | Job | Hvor | Skema | Kald | Hemmelighed sendes som | Sidst verificeret |
|---|---|---|---|---|---|---|
| 1 | Kampprogram + endelige resultater Superliga | cron-job.org | hver 12. time (kan stå på 10–15 min fra før live-syncen) | `GET https://<app>/api/sync-matches?leagueId=<uuid>&smSeason=<navn>` | ? | — |
| 2 | Live-resultater | cron-job.org | hvert minut | `GET https://<app>/api/sync-live` | ? | — |
| 3 | Push-notifikationer | cron-job.org | hver 15.–30. minut | `GET https://<app>/api/send-notifications` (valgfrit `&hours=`) | ? | — |
| 4 | Skema-eksport | GitHub Actions | `0 6 * * 1` (mandag 06:00 UTC) + manuelt | `.github/workflows/schema-export.yml` | — (bruger repo-secret `SUPABASE_DB_URL`) | 30. juli 2026 |
| 5 | Kampprogram + endelige resultater Scotland | cron-job.org | hver 12. time (kan stå på 10–15 min fra før live-syncen) | `GET https://<app>/api/sync-matches?leagueId=<uuid>&smSeason=<navn>` | ? | 31. juli 2026 (oprettet — bekræftet af ejeren) |

**Kolonnen "Hemmelighed sendes som" står med `?` med vilje.** Den kan ikke
udfyldes fra repoet — kun ved at kigge i cron-job.org eller ved at aflæse
loggene, se nedenfor. Udfyld den, når du ved det.

Job 4 er det eneste, der er defineret **i** repoet og dermed det eneste, der er
versioneret. Job 1–3 er beskrevet her, men lever andetsteds.

## Hemmeligheden: header frem for query

`SYNC_SECRET` (miljøvariabel i Vercel) er den delte hemmelighed for job 1–3.
Der er to måder at sende den, og begge virker i dag:

| Måde | Status |
|---|---|
| Headeren `x-sync-secret: <SYNC_SECRET>` | **Den rigtige.** Brug altid denne til nye jobs. |
| Query-parameteren `?secret=<SYNC_SECRET>` | Fallback på vej ud (BACKLOG **A11**). Hemmeligheden havner i request-logs. |

Reglerne bor ét sted: `isAuthorized()` i `api/_shared.js`.

### Sådan afgøres A11

Fallbacken kan ikke fjernes på et gæt — rammer man forkert, svarer jobbene 401,
og syncen står stille. Fremgangsmåden er derfor:

1. **Instrumenteringen er allerede live.** `isAuthorized()` skriver en advarsel i
   Vercels logs, hver gang hemmeligheden kommer som `?secret=`:

   ```
   [A11] Forældet autorisation: hemmeligheden kom som ?secret=. Flyt jobbet til headeren x-sync-secret.
   ```

2. **Lad den køre nogle dage** — mindst så længe, at alle fire skemaer ovenfor har
   udløst flere gange (det langsomste er `sync-matches` hver 6. time).

3. **Aflæs.** Ingen `[A11]`-linjer i perioden = alle jobs bruger headeren. Udfyld
   kolonnen ovenfor, og fjern fallbacken fra `api/_shared.js`.

4. **Er der linjer**, fortæller de, hvilket endpoint der stadig kalder forkert.
   Ret jobbet i cron-job.org først, og start punkt 2 forfra.

## Overvågning

Der er to lag, og de dækker hver sin slags fejl.

**1. `job_runs` — hvad der skete.** Hver kørsel af job 1–3 skriver én række
(`sql/job_runs.sql`, skrevet af `recordRun()` i `api/_shared.js`). Rækken
indeholder varighed, om det gik godt, jobbets eget resumé og fejlteksten.
Aflæses i **Admin → Drift**. Tørre kørsler (`?dryRun=true`) logges bevidst
ikke — de laver ikke noget arbejde, og ville ellers nulstille fejlserien.

**2. `job-heartbeat.yml` — hvad der IKKE skete.** `job_runs` kan per definition
kun se de kørsler, der fandt sted. Et job, cron-job.org har auto-deaktiveret,
skriver ingen rækker, og tavshed ligner ro. Derfor kører en workflow hver 6.
time, som slår alarm, hvis et job har været tavst for længe eller er fejlet
mindst 3 gange i træk.

Alarmen ligger med vilje **uden for appen**: kører Supabase eller Vercel ikke,
ville en alarm inde i appen dø af præcis samme årsag som jobbet. Kanalen er
GitHubs egen notifikation, når workflowen fejler.

Tavshedsgrænserne er rundhåndede i forhold til kadencen, så et enkelt sprunget
interval ikke larmer:

| Job | Kadence | Alarm efter |
|---|---|---|
| `sync-live` | hvert minut | 30 minutter |
| `send-notifications` | hver 15.–30. minut | 3 timer |
| `sync-matches` | hver 6. time | 14 timer |

> Grænserne står **tre** steder og skal ændres samlet: tabellen her,
> `.github/workflows/job-heartbeat.yml` og `JOBS` i `src/lib/ops.js`.

`job_runs` ryddes med `prune_job_runs(30)` — uden en grænse ville `sync-live`
alene lægge 1.440 rækker i tabellen i døgnet.

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
