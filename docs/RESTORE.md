# Gendannelse — runbog

Den fil, man åbner, når data er væk eller forkerte. Skrevet til at blive læst
under pres: hvert scenarie er en liste af kommandoer, ikke en forklaring.

## Hvad der findes — og hvad der ikke gør

**Supabase-planen er Free, og Free giver ingenting.** Ingen automatiske backups,
ingen point-in-time recovery, intet "gendan til i går" i kontrolpanelet. *(Aflæst
2. august 2026. Skiftes plan, skal denne linje rettes — og så skal det også
afgøres, om workflowen nedenfor stadig er nødvendig. Svaret er formentlig ja: en
sikkerhedskopi, der ligger hos den leverandør, hvis konto man kan miste, dækker
ikke det tilfælde, hvor man mister kontoen.)*

Det eneste, der findes, er derfor det, repoet selv tager:

| | |
|---|---|
| **Hvad** | Hele databasen — skema **og** data, `public` + `auth` |
| **Hvordan** | `.github/workflows/data-backup.yml`, dagligt kl. 03:00 UTC + manuelt |
| **Hvor** | GitHub Actions-artefakt, `db-backup-<run-id>` (GitHubs lange run-id fra kørslens URL — ikke det korte løbenummer, UI'et viser først), gpg-krypteret |
| **Hvor længe** | 90 dage (GitHubs loft for et offentligt repo) |
| **Bevist gendannelig** | Ja — hver kørsel gendanner sit eget dump i en tom PostgreSQL og efterprøver rækketallene mod produktion |

**Første kørsel: 2. august 2026 — bestået.** 22 tabeller (20 i `public` plus
`auth.users` og `auth.identities`), 8.434 rækker, 316 kB krypteret. *(Siden er flere
tabeller kommet til — bl.a. `feedback` (#29), `client_errors` (#36),
`milestones` (#39) og `competition_participant_history` (#63) — så forvent
flere i nyere dumps: pr. 14. august 2026 er tallet 24 i `public` plus de to i
`auth`. Tallet vokser med hver migrering og er et pejlemærke, ikke et krav.)* Kørslen
besvarede samtidig det ene, der ikke kunne afgøres fra repoet: **pooler-rollen må
læse `auth`**, så brugerkontiene er faktisk med i kopien. Tallene står her som
udgangspunkt, ikke som et krav — men et dump, der pludselig er markant *mindre*
end det forrige, er værd at kigge på, og hver kørsels egen `manifest.txt` bærer
sammenligningsgrundlaget.

**Guarden er efterprøvet samme dag.** En kørsel uden `BACKUP_PASSPHRASE` fejlede
efter 22 sekunder — før dumpet — og efterlod **nul artefakter**. Det er kontrollen
af, at et ukrypteret dump ikke kan slippe ud af et offentligt repo, og den er
værd at gentage, hvis krypteringstrinnet nogensinde ændres.

**Ikke dækket. Læs listen én gang nu, ikke først den dag det gælder:**

- **Op til 24 timers tab.** Uden PITR er kadencen tabsgrænsen. Et uheld kl. 02:55
  koster næsten et døgns tips, ratings og historier.
- **Miljøvariablerne i Vercel** (`SUPABASE_SERVICE_ROLE_KEY`, `SYNC_SECRET`,
  VAPID-nøglerne, API-nøglerne). De står i `DOCUMENTATION.md` §9 som *liste*, men
  værdierne findes kun i Vercel. Mistes projektet, skal VAPID-nøglerne genskabes —
  og **alle push-abonnementer dør med dem**.

  ⚠️ **Skærpet 6. august 2026: "findes kun i Vercel" er for optimistisk.** Alle
  otte står som `Sensitive`, og en Sensitive-variabel er **skrive-kun** — den
  kan ikke læses igen, heller ikke af ejeren. *(Den kan derimod godt **flyttes**:
  miljøerne på en Sensitive-variabel kan ændres uden at genindtaste værdien.
  Efterprøvet samme dag med `SPORTMONKS_TOKEN`.)* Værdien findes altså kun dér,
  hvor den kom fra:

  | Variabel | Kan hentes igen hos | |
  |---|---|---|
  | `SPORTMONKS_TOKEN` | Sportmonks-kontoen | ✅ |
  | `FOOTBALLDATA_TOKEN` | football-data.org-kontoen | ✅ |
  | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API | ✅ |
  | `SYNC_SECRET` | Ingen — den er selvvalgt. Kan skiftes, men så skal **alle** cron-jobs i [`CRON.md`](./CRON.md) opdateres samme dag | ⚠️ |
  | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Ingen leverandør — men **ejeren har parret liggende uden for Vercel** (bekræftet 6. august 2026) | ✅ |
  | Resends SMTP-nøgle | Resend-kontoen — men den vises **kun én gang** ved oprettelsen og kan derefter kun erstattes af en ny. Den bor i Supabase → Auth → SMTP Settings, ikke i Vercel | ⚠️ |

  **Handlingen er den samme som for `BACKUP_PASSPHRASE`:** værdierne hører til i
  en passwordmanager, ikke kun i Vercel. VAPID-parret er det eneste, der hverken
  kan læses igen eller hentes hos en leverandør, og derfor det eneste, hvor
  kopien ER gendannelsesplanen. Den findes — **og skal gen-bekræftes, hver gang
  nøglerne skiftes**, for et nyt par uden kopi er samme hul igen.
- **cron-job.org-kontoen.** Jobbene står i [`CRON.md`](./CRON.md), men skal
  oprettes på ny i hånden.
- **DNS-posterne for mail.** SPF, DKIM og MX for både afsendelsen (Resend) og
  postkassen (Microsoft) står i [`MAIL.md`](./MAIL.md), men bor hos
  domæneregistratoren og indgår i intet dump. Ryddes de ved en fejl, holder
  nulstillingsmails op med at nå frem — og symptomet er tavshed, ikke en fejl.
  Samme rolle som cron-job.org-kontoen ovenfor.
- **Supabase Storage.** Appen bruger ikke buckets i dag. Gør den det en dag, er
  dumpet ikke længere hele historien.

## Nøglen

Dumpet er krypteret med repo-secret'en `BACKUP_PASSPHRASE`. **Den skal også ligge
i en passwordmanager uden for GitHub.** Ligger den kun som repo-secret, kan et
artefakt, man allerede har hentet ned, ikke dekrypteres af den, der har mistet
adgangen til repoet — og så er kopien til pynt.

**Ændrer du nøglen, så prøv at låse op med den bagefter.** En forkert indsat værdi
— et ekstra mellemrum, et manglende tegn — er **usynlig i drift**: gpg krypterer
lige så gladeligt med den forkerte nøgle, kørslen bliver grøn, og
gendannelsestesten rører aldrig den krypterede fil. Fejlen viser sig først den dag,
kopien skal bruges, og da er hver eneste kopi siden ændringen låst med en nøgle,
ingen har. Den eneste kontrol er at hente næste artefakt og dekryptere det med
passphrasen kopieret **fra passwordmanageren**, ikke fra hukommelsen. Husk også, at
en ændring ikke virker bagud: gamle artefakter er stadig låst med den gamle nøgle,
som derfor skal blive liggende, indtil de er udløbet.

Af samme grund: **hent ét artefakt i kvartalet og læg det et andet sted.** 90-dages
loftet og et tabt GitHub-login rammer ellers alle kopier på én gang. Den manuelle
øvelse (dekryptér, `pg_restore -l`, kig på listen) er samtidig den eneste
gendannelse, et menneske har prøvet — maskinen prøver kun sin egen.

## Fælles første skridt: hent og dekryptér

> **Filnavnet skiftede ved navneskiftet til Leagly (4. august 2026).** Kørsler fra
> før den dato hedder `prediction-champ-<dato>.dump.gpg` — samme format, samme
> passphrase, kun præfikset er et andet. Kommandoerne nedenfor virker på begge,
> når navnet rettes til det, artefaktet faktisk indeholder.

```bash
# 1. Hent artefaktet: Actions → Datasikkerhedskopi → vælg kørsel → Artifacts.
#    manifest.txt i samme artefakt viser dato, commit og rækketal pr. tabel
#    (målt både før og efter dumpet — det rigtige tal ligger imellem de to).
unzip db-backup-<run-id>.zip

# 2. Dekryptér (passphrasen indtastes, ikke skrevet i kommandoen)
gpg --output backup.dump --decrypt leagly-<dato>.dump.gpg

# 3. Se hvad der er i dumpet, uden at pakke det ud
pg_restore -l backup.dump | less
```

`pg_restore` kræver en **17-klient** (Supabase kører PG 17). På Ubuntu:
`sudo apt-get install postgresql-client-17` og brug `/usr/lib/postgresql/17/bin`.

---

## Scenarie 1 — nogle rækker eller én tabel skal tilbage

Det hyppigste rigtige tilfælde: en fejlkørt `delete`, en admin-fejl, en migrering
der ryddede for bredt. Rør **ikke** produktionsdatabasen med dumpet direkte —
gendan ved siden af, og flyt kun det, der skal flyttes.

```bash
# 1. En tom lokal database
createdb gendan

# 2. Kun den tabel, det handler om — data uden skema
pg_restore --data-only --disable-triggers -t predictions -d gendan backup.dump

# 3. Find de rækker, der mangler, og skriv dem ind i produktion
#    (fx via psql \copy, eller ved at generere insert-sætninger)
psql -d gendan -c "\copy (select * from predictions where …) to 'tilbage.csv' csv header"
```

**`--disable-triggers` er ikke valgfri her.** Uden den udløser indlæsningen
triggerne på `matches`, som kalder `recompute_ratings()` og `generate_stories()`
midt i det hele. *(Ved en FULD gendannelse er det omvendt unødvendigt: `pg_dump`
lægger triggere og constraints i post-data, altså efter alle `COPY`. Det er kun
den delvise, data-only-indlæsning, der møder et færdigt skema med levende
triggere.)*

### 🔴 Og så: regn det afledte om

**Dette trin er ikke valgfrit, og det er det, man glemmer.** `--disable-triggers`
gør præcis det, den lover: rækkerne kommer ind, og *intet* bliver regnet. Bagefter
står rating, historier, kåringer og milepæle på de gamle data — uden en fejl,
uden et rødt job og uden en tom skærm. Kun tal, der er lidt forkerte.

```bash
# Efter at rækkerne er skrevet ind i produktion. Returnerer én række pr. trin;
# ingen af dem må stå med "FEJLEDE". Samme kald virker i Supabase SQL-editoren.
psql "$SUPABASE_DB_URL" -c 'select * from public.recompute_derived();'
```

Rækkefølgen inde i kaldet er bindende (rating → historier → kåringer → milepæle →
milepæls-kort) og står forklaret i [`../sql/recompute_derived.sql`](../sql/recompute_derived.sql).

**Bagefter: spørg, om det virkede.** Kontrollen svarer på præcis dette:

```bash
psql "$SUPABASE_DB_URL" -q -At -F'|' \
  -f sql/checks/rating_freshness.sql \
  -c 'select manglende, foraeldede, overfloedige, tilstand from rating_freshness'
```

`tilstand = ok` betyder, at den gemte rating igen passer til kildedataene.
Kontrollen kører også af sig selv hver halve time i `job-heartbeat.yml`, så en
glemt genberegning bliver fanget inden for en time — men vent ikke på den, når du
alligevel står ved tastaturet.

**Ét privilegie er ikke afklaret:** om `--disable-triggers` / `session_replication_role`
er tilladt for `postgres`-rollen **i Supabase**. Det gælder kun, hvis man
indlæser direkte i produktion — hvilket denne opskrift netop undgår. Afklares ved
første rigtige øvelse; skriv svaret her.

## Scenarie 2 — hele projektet er væk

```bash
# 1. Nyt Supabase-projekt (samme region: West EU / eu-west-1, jf. vercel.json)

# 2. Rollerne skal findes, før dumpets GRANT-linjer kan køre.
#    I et Supabase-projekt findes de i forvejen — dette trin gælder kun en
#    gendannelse i en ren PostgreSQL.

# 3. Skemaet public findes allerede i en frisk database, og dumpet vil oprette
#    sit eget. Fjern det først, ellers fejler præcis den ene sætning.
psql "$NY_DB_URL" -c 'drop schema public cascade;'

# 4. Gendan alt
pg_restore -d "$NY_DB_URL" --no-owner backup.dump

# 5. Kontrollér mod manifest.txt — hvert tal skal ligge mellem "før" og "efter"
psql "$NY_DB_URL" -At -F'|' -f counts.sql   # forespørgslen står i data-backup.yml
```

Derefter, i denne rækkefølge:

1. **Vercel:** ret `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, og
   `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY` hvis de er sat. Redeploy.
2. **`src/lib/supabase.js`** (konstanterne øverst) har produktions-URL'en **hårdkodet** som fallback.
   Den skal rettes i koden, ikke kun i miljøvariablerne.
3. **GitHub-secrets:** `SUPABASE_DB_URL` (bruges af tre workflows).
4. **VAPID-nøgler:** genbrug dem fra Vercel, hvis de findes. Gør de ikke, generér
   nye (`npx web-push generate-vapid-keys`) — og vid, at **alle eksisterende
   push-abonnementer er døde**; hver bruger skal slå notifikationer til igen.
5. **cron-job.org:** liga-UUID'erne er nye, hvis `leagues`-rækkerne er det. De er
   det ikke efter en gendannelse fra dumpet — id'erne følger med. Tjek alligevel
   job-URL'erne mod [`CRON.md`](./CRON.md).
6. **`select * from public.recompute_derived();`** i SQL-editoren — den regner
   rating, historier, kåringer, milepæle og milepæls-kort om i den rigtige
   rækkefølge. (Admin → "Opdater ratings" dækker kun det første af de fem.)
   Derefter Admin → Drift: alle jobs skal melde sig inden for deres
   tavshedsgrænse.

> **Kan dumpet ikke læses**, er repoet det, der er tilbage — og siden 5. august
> 2026 rækker det til et *tomt, men komplet* miljø: `sql/schema.sql` giver hele
> skemaet, og de fire `sql/tournament_*.sql`-filer giver alle syv turneringer.
> Superligaen var indtil da den eneste uden fil, fordi den blev oprettet i
> hånden, før skabelonerne fandtes. **Brugere, tips og resultater er stadig
> væk** — det er præcis den forskel, dumpet dækker, og derfor er dette den
> sidste udvej og ikke en plan B.

## Scenarie 3 — en migrering rullede noget tavst tilbage

**Her er dumpet sjældent svaret.** En række filer i `sql/` bruger
`drop policy … create policy` / `drop view … create view` og *erstatter tavst* en
nyere definition med en ældre, uden at fejle. Rettelsen er at køre den **nyere**
fil bagefter — ikke at gendanne data, som ikke er gået tabt.

Parrene ("kørt ved en fejl → kør derefter") og begrundelsen for hvert af dem
står i [`../sql/README.md`](../sql/README.md), afsnittet **"Filerne i listen her
må ikke gen-køres blindt"**. Der stod tidligere en kopi af listen her som
genvej, men kopien drev fra kilden (fire rækker mod tolv), så genvejen er
nedlagt — slå op i kilden, som vedligeholdes ved hver ny migrering.

Har migreringen derimod ændret **data** (ikke kun regler), er det scenarie 1.

---

## Når gendannelsen er ovre

- **Er det afledte regnet om?** Kør `select * from public.recompute_derived();`
  hvis du er i tvivl — den er idempotent, så et unødvendigt kald koster kun tid.
  Kontrollen `sql/checks/rating_freshness.sql` siger, om det var nødvendigt.
- `select count(*) from job_runs where started_at > now() - interval '1 hour';`
  — skriver jobbene igen?
- Åbn appen som almindelig bruger: kan man logge ind (auth kom med), se sine tips
  og sin rating?
- **Skriv i `docs/CHANGELOG.md` hvad der skete.** En gendannelse er den eneste
  hændelse, hvor systemets historik og virkeligheden kan nå at være uenige.
