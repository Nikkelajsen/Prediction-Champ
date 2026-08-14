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
`A11` ventede på. **Den er besvaret 5. august 2026**, og svaret kom ikke fra
cron-job.org, men fra jobbenes egne kørsler (se nedenfor).

Filen erstatter ikke cron-job.org. Den er den liste, man holder kontoen op imod
— og aflæsningen 5. august viste, hvor nødvendig den skelnen er: registret og
virkeligheden var uenige om skemaet for fem af jobbene.

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

**`<app>` i kaldkolonnen er en pladsholder, der nu kan slås op.** Efter
domæneflytningen (`I10`) kan den være enten den gamle `.vercel.app`-adresse
eller `app.leagly.app`, og `/api/` er med vilje undtaget fra redirectet, så
begge svarer 200. Fra 13. august 2026 skriver hver kørsel sit værtsnavn i
`job_runs.detail` — se [`<app>` i tabellen](#app-i-tabellen-samme-fremgangsmåde-brugt-igen-a46)
nedenfor for opslaget og for, hvordan kolonnen udfyldes.

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
| 1 | Kampprogram + endelige resultater Superliga | cron-job.org | hver 12. time, ved **minut 00** | `GET https://<app>/api/sync-matches?leagueId=<uuid>&smSeason=<navn>` | `x-sync-secret` ✓ | 3. august 2026 — kørsel aflæst på cron-job.org (12:00, næste 00:00), lykkedes |
| 2 | Live-resultater | cron-job.org | hvert minut | `GET https://<app>/api/sync-live` | `x-sync-secret` ✓ | — |
| 3 | Push-notifikationer **+ kåringer, historie-bagstopper, milepæle og milepæls-kort** | cron-job.org | hver 15.–30. minut, **hele døgnet** — men beskeder sendes kun i vinduet **08–22 dansk tid** (`SEND_WINDOW` i `api/send-notifications.js`); kørsler udenfor logges med `sent: 0` og er no-ops med vilje | `GET https://<app>/api/send-notifications` (valgfrit `&hours=`, klippes til 1–24, standard 3; `&force=true` omgår sendevinduet — kun til manuel test; `&action=vapidKey` svarer med den **offentlige** VAPID-nøgle og ligger med vilje FØR auth-tjekket) | `x-sync-secret` ✓ | — |

> **Job 3 gør mere end at sende beskeder.** Ud over kåringerne (`B11`, august 2026) kalder det siden Story Engine v2 også `generate_stories_catchup()` og `award_milestones(null)` som `service_role` — og siden v3 desuden `apply_milestone_stories()`. Begge er der af samme grund som kåringerne: matches-triggeren kan **per konstruktion** ikke se dem. Bagstopperen dækker en dag, hvis sidste kamp aldrig får et resultat, og en runde med en udsat kamp uden ny dato — i begge tilfælde skrives der intet til `matches`, så der er ingen trigger at fyre. Milepælene har tre familier, der slet ikke er kampdrevne (oprettede ligaer/konkurrencer, deltagne sæsoner, afsluttede konkurrencer). Alle tre kald er idempotente og springes over ved `dryRun`, fordi en forhåndsvisning er en læsning og ikke må uddele en permanent milepæl. **`apply_milestone_stories()` SKAL køre efter `award_milestones()`, og rækkefølgen i kaldelisten er derfor bindende.** Efter v3 får milepæle ikke deres eget kort, men kaprer dagens ene slot. Skriveren af milepæle er dette job, mens dagens kort skrives af matches-triggeren — så normaltilfældet er, at milepælen uddeles *efter* at kortet er udgivet, og uden dette kald ville den aldrig nå Hjem. Kaldet **erstatter** kortet (det lægger aldrig et til) og rører kun kort under 48 timer gamle; er kortet ældre, er det alligevel usynligt for brugeren, og milepælen fanges af frame 5 i den kommende rundestory. **Der er ikke oprettet et nyt job** — de fire er lagt i et job, der i forvejen kører hyppigt nok.

| 4 | Skema-eksport | GitHub Actions | `0 6 * * 1` (mandag 06:00 UTC) + manuelt | `.github/workflows/schema-export.yml` | — (bruger repo-secret `SUPABASE_DB_URL`) | 30. juli 2026. **Jobbet committer ikke længere til `main` (12. august 2026):** den ugentlige kørsel dispatches pr. definition på standardgrenen, og dumpet landede derfor i produktionsgrenen uden at have været gennem CI — tre gange har det gjort CI rød bagefter. Kørslen skubber nu til `chore/schema-export` og åbner en pull request; en manuel dispatch på en arbejdsgren committer stadig direkte. **Følgen for dette register: jobbet kan nu efterlade en åben PR, og dét er dets måde at melde skema-drift på.** Se `sql/README.md` → Vej 3 |
| 5 | Kampprogram + endelige resultater Scotland | cron-job.org | hver 12. time, ved **minut 15** | `GET https://<app>/api/sync-matches?leagueId=<uuid>&smSeason=<navn>` | `x-sync-secret` ✓ | **2. august 2026 — kørsel aflæst i Admin → Drift: 198 af 198 kampe, tom `unmatched`, ingen fejl.** Bemærk at netop den kørsel har `authVia: admin-token`, altså et manuelt "Hent nu": den beviser, at *syncen* virker for Scotland, ikke at cron-jobbet selv kalder ind. Kolonnen til venstre stod derfor med `?` indtil `A11`-opslaget 5. august 2026, som viste otte `header`-kørsler for netop dette job — altså at cron-jobbet selv kalder ind. Samme opslag gav minuttallet (15), som manglede. `&smSeason=` i kaldet er reelt dødvægt: `sql/tournament_scotland_premiership.sql` satte `api_season_id` direkte, og parameteren læses kun, når id'et mangler — harmløs, men ikke påkrævet |
| 6 | Kampprogram + endelige resultater Premier League | cron-job.org | hver 12. time, ved **minut 05** | `GET https://<app>/api/sync-matches?leagueId=<uuid>` | `x-sync-secret` ✓ | 31. juli 2026 (oprettet; første planlagte kørsel 01:05) |
| 7 | Kampprogram + endelige resultater Champions League | cron-job.org | hver 12. time, ved **minut 17** | `GET https://<app>/api/sync-matches?leagueId=<uuid>` | `x-sync-secret` ✓ | **3. august 2026 — minuttal aflæst på cron-job.org (kørsel 16:17, næste 00:17): registret sagde minut 11, virkeligheden er 17.** 31. juli 2026 (oprettet; første planlagte kørsel 01:17. **`B8` er afgjort 1. august 2026:** football-data.org har endnu ikke oprettet sæsonen 2026 — deres aktuelle er 2025 — så jobbet henter 0 kampe og melder sig **gennemført** med forklaringen i `emptySeason`, indtil ligafasen er lodtrukket) |
| 8 | Kampprogram + endelige resultater Bundesliga | cron-job.org | hver 12. time, ved **minut 23** | `GET https://<app>/api/sync-matches?leagueId=<uuid>` | `x-sync-secret` ✓ | **3. august 2026 — minuttal aflæst på cron-job.org (kørsel 16:23, næste 00:23): registret sagde minut 17, virkeligheden er 23.** 31. juli 2026 (oprettet; første planlagte kørsel 01:23) |
| 9 | Kampprogram + endelige resultater Serie A | cron-job.org | hver 12. time, ved **minut 11** | `GET https://<app>/api/sync-matches?leagueId=<uuid>` | `x-sync-secret` ✓ | **3. august 2026 — minuttal aflæst på cron-job.org (kørsel 16:11, næste 00:11): registret sagde minut 23, virkeligheden er 11.** 31. juli 2026 (oprettet; første planlagte kørsel 01:11) |
| 10 | Kampprogram + endelige resultater Primera División | cron-job.org | hver 12. time, ved **minut 29** | `GET https://<app>/api/sync-matches?leagueId=<uuid>` | `x-sync-secret` ✓ | **31. juli 2026 — kørt planlagt kl. 00:29, lykkedes (4,31 s)** |
| 11 | Datasikkerhedskopi | GitHub Actions | `0 3 * * *` (dagligt 03:00 UTC) + manuelt | `.github/workflows/data-backup.yml` | — (repo-secrets `SUPABASE_DB_URL` + `BACKUP_PASSPHRASE`) | 2. august 2026 (oprettet) |

> **Job 3 skriver også, og ikke kun til `notification_log` (3. august 2026, `B11`).** Hver kørsel kalder `award_competition_periods()` som `service_role` for hver konkurrence med `mode_params.awards`, FØR den læser kåringerne. Funktionen er lazy og blev indtil da kun trigget af en klient, der åbnede boardet, så en kåring — og dermed Story Engines kort for den — kunne mangle, til nogen tilfældigvis kiggede. Kaldet er idempotent (`on conflict do nothing`), og `&dryRun=true` springer det over, fordi forhåndsvisningen er en læsning. Det betyder også, at et stoppet job 3 ikke længere kun koster beskeder: kåringerne skrives da først, når nogen åbner boardet.

**✓ Kolonnen "Hemmelighed sendes som" er udfyldt 5. august 2026** og står ikke
længere med `?`. Den kunne ikke udfyldes fra repoet — kun ved at kigge i
cron-job.org eller ved at aflæse appens egne data — og det sidste er, hvad der
skete: `A11`-opslaget nedenfor viste `header` for alle ni jobs og **nul**
`query`-kørsler over fjorten dage. Derfor er `?secret=` samtidig fjernet af
koden, så kolonnen ikke bare er udfyldt, men **ikke længere kan have en anden
værdi**: et cron-job, der sender hemmeligheden på nogen anden måde, får 401.

Det er værd at holde fast i, hvad der ændrede sig: kolonnen stod med `?` i en
måned, fordi svaret lå i en brugerflade uden for repoet. Det gjorde det aldrig
— det lå i jobbenes egne kørsler, som bare ikke gemte det.

**Navnene i cron-job.org er ikke helt ens** — fire hedder "Kampe & Resultater
\<turnering\>", to af dem med "Hent" foran og én med bindestreg. Det er kosmetik,
men noteret her, fordi registeret skal kunne bruges til at *finde* jobbet igen.

Job 4 er det eneste, der er defineret **i** repoet og dermed det eneste, der er
versioneret. Resten er beskrevet her, men lever andetsteds.

## Hemmeligheden: header frem for query

`SYNC_SECRET` (miljøvariabel i Vercel) er den delte hemmelighed for alle
cron-jobbene mod appens endpoints (job 1–3 og 5–10 — samme `isAuthorized()`).
Én gren er bevidst offentlig og ligger FØR auth-tjekket:
`send-notifications?action=vapidKey` svarer med den offentlige VAPID-nøgle,
som klienten skal bruge for at abonnere — så "alt under `/api/` kræver
headeren" er næsten sandt, men ikke helt.
Der er to måder at sende den, og begge virker i dag:

| Måde | Status |
|---|---|
| Headeren `x-sync-secret: <SYNC_SECRET>` | **Den eneste vej for et cron-job.** |
| ~~Query-parameteren `?secret=<SYNC_SECRET>`~~ | **Fjernet 5. august 2026 (`A11`).** Den lagde hemmeligheden i request-logs. Et kald med `?secret=` svarer nu 401 — også med den rigtige hemmelighed. |
| `Authorization: Bearer <admin-JWT>` | Anden vej ind, kun til mennesker: en admin-brugers eget Supabase-token — det, "Hent nu"-knappen og Drift-forhåndsvisningen bruger (vises som `admin-token` i `job_runs.detail`). Ikke til cron-jobs. |

Reglerne bor ét sted: `isAuthorized()` i `api/_shared.js`.

### A11 er afgjort — opslaget er kørt 5. august 2026

**Svaret var `header` hele vejen, og fallbacken er fjernet fra
`api/_shared.js`.** Opslaget, der afgjorde det, står nedenfor og er stadig
brugbart: det er nu måden at se, om et job er holdt op med at kalde ind.

```sql
-- Hvordan har hvert job autoriseret sig den seneste tid?
select job,
       coalesce(detail->>'authVia', '(ukendt)') as vej,
       count(*) as koersler,
       max(started_at) as senest
  from job_runs
 where started_at > now() - interval '14 days'
 group by 1, 2
 order by 1, 2;
```

> **Vinduet er 14 dage og ikke 7.** Det langsomste skema er hver 12. time, og et
> job, der **mangler** i svaret, er den eneste måde at læse tabellen forkert på
> — så vinduet skal være rundhåndet nok til, at fravær betyder noget.

**Sådan blev svaret læst 5. august 2026.** Alle ni jobs var til stede — to
faste (`sync-live`, `send-notifications`) og syv `sync-matches:<leagueId>`,
altså præcis de syv turneringer i registret ovenfor:

| Vej | Antal | Hvad det betød |
|---|---|---|
| `header` | alle ni jobs, senest inden for en time | Fallbacken var ubrugt |
| `query` | **nul rækker** | Ingen kalder med `?secret=` |
| `admin-token` | 3 kørsler (1.–2. august) | Mennesker, der trykkede "Hent nu". Tæller ikke med |
| `(ukendt)` | kun kørsler med `senest` ≤ 1. august 21:17 | Fra før feltet fandtes. **Nul efter udrulningsminuttet** |

**`(ukendt)` var det eneste, der krævede eftertanke**, fordi rækkerne i
princippet kunne skjule en `query`-kørsel: feltet er null, hvis handleren ikke
kaldte `setAuth()`. Men samtlige `(ukendt)`-rækker har deres sidste kørsel
1. august mellem 20:23 og 21:17, altså i selve udrulningsminuttet, og ikke én
ligger efter. De er historik fra før instrumenteringen, ikke en tredje vej ind.

**Hvorfor et opslag og ikke logs.** Frem til august 2026 var det eneste spor en
advarsel i Vercels logs (`[A11] Forældet autorisation …`). Den fremgangsmåde
havde tre svagheder, og den tredje er den alvorlige: man skulle huske at kigge
et sted uden for appen, inden for logopbevaringens vindue — og **fravær af
advarsler kunne ikke skelnes fra fravær af kørsler.** Et job, cron-job.org
havde deaktiveret, så ud præcis som et job, der kaldte rigtigt. `isAuthorized()`
har altid returneret `via`; værdien blev bare kasseret. Med den i
`job_runs.detail` (30 dages historik, `prune_job_runs`) mangler et job uden
kørsler simpelthen i svaret. **Det er den egentlige lære, og den overlever
A11:** et hukommelsesspørgsmål blev til et opslag ved at gemme en værdi, koden
allerede havde i hånden.

Vejen står også i **Admin → Drift** under "Seneste resumé" på hvert jobkort, hvis
man kun vil have et hurtigt kig.

### `<app>` i tabellen: samme fremgangsmåde, brugt igen (`A46`)

**Kaldkolonnen ovenfor skriver `https://<app>/api/…`, og pladsholderen har
aldrig haft en værdi i repoet.** Den blev aktuel med domæneflytningen (`I10`,
12.–13. august 2026): `<app>` kan i dag være enten den gamle
`.vercel.app`-adresse eller `app.leagly.app`, og de to kan ikke skelnes udefra,
fordi **`/api/` med vilje er undtaget fra redirectet**
([`DOMAENE.md`](./DOMAENE.md) trin 6). Et job på den gamle adresse svarer altså
fortsat 200 — bare uden den nye adresses egen CSP, og uden at registeret siger
det.

Spørgsmålet lignede endnu en aflæsning i cron-job.org: åbn ni jobs, skriv ni
URL'er af. **Men det er præcis `A11`s fejlklasse igen** — svaret lå i kaldet, det
blev bare kasseret. `req.headers` har altid båret værtsnavnet. Fra
13. august 2026 skriver `createRunLogger().setHost()` det i `job_runs.detail`
ved siden af `authVia`, og registeret udfyldes dermed **fra jobbenes egne
kørsler** i stedet for fra kontoen:

```sql
-- Hvilket værtsnavn kalder hvert job faktisk ind på?
select job,
       coalesce(detail->>'host', '(ukendt)') as vaertsnavn,
       count(*) as koersler,
       max(started_at) as senest
  from job_runs
 where started_at > now() - interval '14 days'
 group by 1, 2
 order by 1, 2;
```

> **`(ukendt)` betyder her "kørsel fra før 13. august 2026"** og ikke en tredje
> adresse — nøjagtig som `authVia`s `(ukendt)` gjorde det 5. august. Feltet er
> null, når rækken er skrevet af kode uden `setHost()`. Læs derfor `senest`:
> ligger den efter udrulningen, er der noget galt; ligger den før, er rækken
> historik. Samme vindue på 14 dage og samme begrundelse som ovenfor.

**Uden SQL:** hvert jobkort i **Admin → Drift** viser sin egen "Seneste resumé",
og `host` står nu i den. De ni værdier er dermed ét skærmbillede væk.

**Udfyld tabellens kaldkolonne, når svaret er læst** — erstat `<app>` med den
faktiske adresse, job for job. Er et job stadig på den gamle adresse, er det
ikke en fejl, der skal hastes: undtagelsen `(?!api/)` beskytter det, og
[`DOMAENE.md`](./DOMAENE.md) siger, at flytningen tages ét job ad gangen.

### Kørselstallene pegede på et skema, der allerede var rettet

Samme opslag bærer et `count(*)`, og det kan omregnes til en faktisk frekvens.
**Metoden validerer sig selv på de to jobs, hvis skema ikke er i tvivl:**
`sync-live` giver 1,0 minut (dokumenteret "hvert minut") og `send-notifications`
15,0 minutter (dokumenteret "hver 15.–30. minut"). For job 6–10 gav den derimod
**~1,8 time**, altså seks gange hyppigere end registrets "hver 12. time".

**Aflæst på cron-job.org 5. august 2026: skemaet ER hver 12. time.** De fem jobs
blev oprettet forkert 31. juli og er siden rettet — så udregningen beskrev
korrekt et vindue, der indeholdt den forkerte opsætning, og forkert den
tilstand, der gælder i dag. Registret havde ret; det var kun bagudskuende data,
der sagde noget andet.

**Læren er ikke at lade være med at regne, men hvad et gennemsnit kan sige.**
`count(*)` over fjorten dage er ét tal for hele perioden og kan ikke skelne "har
altid kørt for hyppigt" fra "kørte for hyppigt og blev rettet". Skal spørgsmålet
stilles igen, er `max(started_at)` og `min(started_at)` pr. job ikke nok — det
kræver afstanden mellem *nabokørsler* (`lag(started_at) over (partition by job
order by started_at)`), som viser hvornår ændringen skete i stedet for at midle
hen over den.

**Samme aflæsning bekræftede alle syv minuttal**, inklusive Scotlands 15, som
indtil da kun var udledt af `A11`-opslagets `max(started_at)`:

| Job | Minut |
|---|---|
| 1 Superliga | 00 |
| 6 Premier League | 05 |
| 9 Serie A | 11 |
| 5 Scotland | 15 |
| 7 Champions League | 17 |
| 8 Bundesliga | 23 |
| 10 Primera División | 29 |

Alle syv kørte planmæssigt samme dag (2,56–4,2 s, ingen fejl).

## Overvågning

Der er to lag, og de dækker hver sin slags fejl.

**1. `job_runs` — hvad der skete.** Hver kørsel af hvert app-job skriver én række
— alle `sync-matches`-jobbene (1 og 5–10, som `sync-matches:<liga-uuid>`),
live-syncen og notifikationsjobbet (`sql/job_runs.sql`, skrevet af
`recordRun()` i `api/_shared.js`). Rækken
indeholder varighed, om det gik godt, jobbets eget resumé og fejlteksten.
Aflæses i **Admin → Drift**. Tørre kørsler (`?dryRun=true`) logges bevidst
ikke — de laver ikke noget arbejde, og ville ellers nulstille fejlserien.

> **Kortet måler både en fejlSERIE og en fejlRATE (`G115`, 14. august 2026).**
> `consecutive_failures` nulstilles af enhver succes, og det gør den blind for
> det mønster, den skulle fange: et job, der kører hvert minut og fejler to ud
> af tre, har en grøn seneste kørsel hver tredje gang — så tælleren står på nul,
> mens jobbet reelt er nede. Det stod grønt i en time under `G109`.
> `admin_job_health()` svarer derfor også `recent_runs` og `recent_failures`
> over de sidste **24 timer** (`sql/job_health_rate.sql`), og `src/lib/ops.js`
> kalder et job `ustabil`, når mindst **10 %** af mindst **fem** kørsler
> fejlede. Vinduet er et TIDSvindue og ikke "de sidste N kørsler", fordi 30
> kørsler er en halv time for `sync-live` og en halv måned for et
> kampprogram-job — databasen kender ingen kadencer, det gør kun dette register
> og `ops.js`. Kortet viser rå tal ("40 af 60") og procenten som detalje:
> nævneren er selv oplysningen. **Raten kan hæve et job til `ustabil`, aldrig
> til `fejler`** — den tilstand er heartbeat'ens, og den hører til et job, der
> er holdt op med at virke, ikke til et, der virker dårligt.
>
> Grænsen på fem kørsler betyder, at **kampprogram-jobbene aldrig bedømmes på
> deres rate**: to kørsler i døgnet gør "1 af 2" til 50 %, hvilket ikke er en
> rate, men en anekdote. For dem er fejlserien i forvejen hele historien, fordi
> hver kørsel vejer.

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

**3. `kickoff_coverage` — om det, der kørte, skrev noget troværdigt** (`G84`,
7. august 2026). De to lag ovenfor kan begge stå grønne, mens dataene er
forkerte: jobbet kørte, skemaet er uændret, og syncen skrev bare noget forkert i
en kolonne. Det skete 2.–6. august 2026, hvor alle kampe fra de fem
football-data-turneringer stod uden klokkeslæt i fire døgn og blev fundet af et
menneske, der undrede sig over en sortering. Sidste trin i heartbeat'en aflæser
derfor `kickoff_tbd` pr. turnering og slår alarm, når **alle** en turnerings
kampe inden for ti dage står uden tid — ikke ved en andel, som ville kræve en
tærskel, vi ikke har data til at kalibrere. **Siden `G85` (8. august 2026)
aflæser den også `kickoff_uncertain`** og melder `ALLE UBEKRAEFTEDE` på samme
vilkår. Uden den halvdel var kontrollen grøn for præcis de tre turneringer,
fejlen ramte: Premier League, Primera División og Serie A kan ikke få
`kickoff_tbd` sat overhovedet, fordi leverandøren sender et opdigtet
klokkeslæt frem for en pladsholder. Forespørgslen bor i
[`sql/checks/kickoff_coverage.sql`](../sql/checks/kickoff_coverage.sql) frem for
i workflowen, så CI kan køre præcis den samme regel mod en tom database.
Trinnet ligger **sidst** med vilje: et fejlende trin springer resten af jobbet
over, og et tavst job er den dyrere af de to fejl. *(Rettet 7. august 2026: der
er nu ét trin efter det — se punkt 4. De to deler egenskaben, at de dømmer DATA
og ikke kørsler, og de ligger begge efter helbredstjekket af samme grund.
Rettet igen 12. august 2026: der er nu to — punkt 5 dømmer hverken data eller
kørsler, men en RETTIGHED, og ligger af samme grund sidst af alle.)*

**4. `rating_freshness` — om det, INGEN skrev, er blevet forkert** (`G83`,
7. august 2026). De tre lag ovenfor kan alle stå grønne, mens ratingen er
forkert, for ratingen skrives af en trigger på `matches` — og der findes veje
uden om triggeren. Den vigtigste er gendannelsen: `docs/RESTORE.md` scenarie 1
foreskriver `pg_restore --disable-triggers`, netop for at indlæsningen ikke skal
kalde `recompute_ratings()` midt i det hele, og efterlod indtil august 2026 alt
det udledte forkert uden at sige det. De to andre er et tip skrevet efter
kampen, og en turnering, der skifter `is_official` (kun officielle tæller, A17).

I alle tre tilfælde er der ingen fejlbesked, intet job der fejler og ingen tom
skærm — kun et tal, der er lidt forkert, indtil nogen tilfældigvis retter et
resultat og udløser en genberegning. Det var den eneste store afledte størrelse
i appen helt uden bagstopper.

Kontrollen sammenligner `rating_history` med det aggregat, `recompute_ratings()`
bygger sin Elo på, og melder tre tal: `manglende`, `foraeldede` og
`overfloedige`. Den genberegner **ikke** Elo'en — det ville være at efterprøve
en beregning med den selv; den delen dækkes af
`sql/tests/rating_equivalence.sql` i CI. Forespørgslen bor i
[`sql/checks/rating_freshness.sql`](../sql/checks/rating_freshness.sql), så CI
kan køre præcis den samme regel mod en tom database.

**Alarmen har en knap:** rettelsen er ét kald,
`select * from public.recompute_derived();`
([`sql/recompute_derived.sql`](../sql/recompute_derived.sql)), som regner rating,
historier, kåringer, milepæle og milepæls-kort om i den bindende rækkefølge.
Genberegningen er bevidst **ikke** sat på et skema: den er dyr (hele
`rating_history` bygges fra runde nul) og hører til efter en hændelse. Det er
kontrollen, der kører hvert kvarter, ikke arbejdet.

**5. `anon_routine_reach` — om `anon` kan nå noget, den ikke skal** (`G100`,
12. august 2026). Den femte og sidste kontrol, og den eneste, der dømmer en
RETTIGHED frem for data. `G96` lukkede `anon` ude af alle funktioner i `public`
og efterlod en regel, databasen ikke kan håndhæve selv: PostgreSQLs indbyggede
default giver PUBLIC — og dermed `anon` — EXECUTE på hver ny funktion, og den
post kan ikke fjernes med `ALTER DEFAULT PRIVILEGES`. Hver ny funktion skal
derfor selv bære sin `revoke execute … from public`.

Vagten over den regel lå indtil da kun i CI, og **CI måler `sql/schema.sql`,
ikke databasen**. Migreringerne køres i hånden i SQL-editoren, og skema-
eksporten er en ugentlig mandagskørsel plus en manuel knap, så en funktion kunne
stå åben for `anon` i produktionen i op til en uge, uden at nogen påstand nogen
steder var rød. Det er præcis den afstand, dette trin lukker: samme regel, samme
fil, men stillet mod den levende database hver halve time.

Kontrollen melder begge retninger. **For meget** er en rutine, en fremmed kan
kalde uden login, og kolonnerne `egen_grant`/`via_public` siger hvilken af de to
veje ind der er brugt — de har hver sin rettelse. **For lidt** er
`username_available()` eller `invite_preview()` lukket for `anon`, altså
oprettelsen af en konto eller invitationens etiket, der ikke virker uden login;
det er `#56`s trin 2 og 5 byttet om, og det ville være grønt i enhver anden
kontrol vi har. Forespørgslen bor i
[`sql/checks/anon_routine_reach.sql`](../sql/checks/anon_routine_reach.sql), så
CI kan køre præcis den samme regel mod en tom database.

**Trinnet logger ingen brugerdata** — udlæsningen er funktionsnavne og
rollenavne, ikke en eneste tabelrække. Det er den egenskab, der gør netop denne
kontrol egnet til en Actions-log, hvor `league_admin_coverage` (som skriver
liganavne) hører til hos ejeren (`A32`).

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
før hvert helbredstjek. Samme trin rydder `client_errors` med
`prune_client_errors(90)` og — siden `G77` (7. august 2026) — `analytics_events`
med `prune_analytics_events(18)`. Den sidste er den, der voksede hurtigst:
`sql/analytics_events.sql` foreskrev en rydning "i hånden med jævne mellemrum",
altså præcis det, dette afsnit engang skrev om `prune_job_runs()`. **Der er ikke
oprettet et job for den** — Analytics' arkitekturvalg #3 udelukker nyt cron, og
en rydning mere i et job, der findes, er ét udsagn. **Funktionen havde ingen kaldere overhovedet indtil
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
2. **Advanced → Headers**: `x-sync-secret` = `SYNC_SECRET`. Der er ikke længere
   et alternativ — `?secret=` blev fjernet 5. august 2026 (`A11`), så et job
   uden headeren får 401 og står stille.
3. Slå "Treat redirects as success" fra.
4. **Tilføj en række i tabellen ovenfor**, inkl. dato for verifikation.
