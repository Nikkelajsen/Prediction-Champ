# Staging — runbog

Sådan oprettes og vedligeholdes Supabase-projekt nr. 2, som preview-miljøet og
lokal udvikling peger på, så en ændring kan prøves af mod data, der ikke er
brugernes.

Rækken hedder `B18` i [`BACKLOG.md`](./BACKLOG.md), og indtil projektet findes,
er `DOCUMENTATION.md` §9's advarsel det eneste, der holder preview væk fra
produktionsdata — i hånden. Denne fil er trinene; §9 er tabellen over, hvilke
variabler der findes.

**Hvad staging IKKE er.** Den er ikke en kopi af produktionen. Skemaet er det
samme, dataene er ikke: ingen rigtige brugere, ingen rigtige tips. Det er et
bevidst valg og ikke dovenskab — se "Data" nedenfor.

---

## Før du går i gang

- **Free-planen giver et begrænset antal aktive projekter pr. organisation**
  (to, da denne fil blev skrevet). Staging bruger den anden plads. Tjek tallet
  på prisplanen, når du opretter — det er den slags, der ændrer sig.
- **Et gratis-projekt går i dvale efter en uges inaktivitet.** Det er ikke et
  problem, det er en egenskab: staging bruges i ryk. Vækkes fra kontrolpanelet,
  og første kald derefter er langsomt. Bliver det irriterende, er svaret at
  åbne preview en gang om ugen — ikke at betale.
- **Sæt en time af.** Trin 1–5 er nødvendige, før noget virker; trin 6–7 er
  dem, der afgør, om du kan stole på, at staging faktisk ER staging.

---

## 1. Opret projektet

Supabase → **New project** i samme organisation som produktionen.

| Felt | Værdi | Hvorfor |
|---|---|---|
| Navn | `leagly-staging` | Skal kunne kendes fra produktionen på én skærm |
| Region | **West EU (Ireland) · eu-west-1** | Samme som produktionen. `vercel.json` pinner funktionerne til `dub1` (Dublin), og en staging-database i US-East ville måle noget andet end det, der er i drift (§11) |
| Database-password | Genereret | **Læg det i passwordmanageren med det samme.** Det kan ikke læses igen bagefter, og det er halvdelen af den forbindelsesstreng, trin 3 og enhver senere `psql` skal bruge |

---

## 2. Kør skemaet

`sql/schema.sql` er hele `public` på én gang — tabeller, views, funktioner,
policies og grants. De enkelte migreringer i `sql/` er **ikke** nødvendige;
de er historikken om, hvordan skemaet blev, som det er.

**Vej A — SQL-editoren (ingen værktøjer krævet).** Supabase → SQL Editor → New
query → indsæt hele filen → **Run without RLS**. Filen er ~6.700 linjer;
editoren kan klare den, men browseren bliver træg undervejs.

**Vej B — `psql` (hurtigere, kræver port 5432).**

```bash
psql "postgresql://postgres.<staging-ref>:<password>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" \
  -v ON_ERROR_STOP=1 -f sql/schema.sql
```

> 🛑 **16 linjer skal ud FØRST.** Fire slags, og de rammer i denne rækkefølge —
> de tre første, før noget som helst er kørt, den sidste til allersidst:
>
> | Linjer | Fejl | Hvorfor |
> |---|---|---|
> | `\restrict` / `\unrestrict` (linje 5 og sidst) | `42601: syntax error at or near "\"` | psql-**meta**-kommandoer, som `pg_dump` 17.5+ selv lægger ind. SQL-editoren sender ren SQL til serveren og kender dem ikke. Ren emballage |
> | `CREATE SCHEMA public;` | `42P06: schema "public" already exists` | Et friskt Supabase-projekt har allerede `public`. Dumpet vil oprette sit eget |
> | `COMMENT ON SCHEMA public …` | `42501: must be owner of schema public` (forebyggende) | Supabase lader `pg_database_owner` eje skemaet. Ren kosmetik — et friskt projekt har i forvejen præcis den kommentar, linjen ville sætte |
> | `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin …` (12 stk., til sidst) | `42501: permission denied to change default privileges` | Sætningen kræver **medlemskab af `supabase_admin`**, som SQL-editorens session ikke har. Kendt begrænsning — `sql/README.md` beskriver den, og `anon_grants_finish.sql` (#43) melder den som en `warning` frem for at vælte |
>
> ```bash
> sed -E '/^\\(un)?restrict\b/d; /^CREATE SCHEMA public;$/d; /^COMMENT ON SCHEMA public /d; /^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin/d' \
>   sql/schema.sql > schema_til_editoren.sql
> ```
>
> **De 12 sidste er de eneste, hvor `sed` ikke bare er en omvej uden om en
> psql-detalje — der springes noget over.** Det er alligevel det rigtige, af tre
> grunde. Reglerne gælder kun objekter, der oprettes **af** `supabase_admin`, og
> alt, vi selv opretter, ejes af `postgres`. Et friskt Supabase-projekt har
> allerede sine egne udgaver, så der fjernes intet — de bliver bare ikke sat på
> ny. Og tre af de 12 giver `anon` adgang, hvilket er præcis det, `G50`/`G58`
> har brugt to migreringer på at komme af med i produktionen. Efterprøvet
> 6. august 2026: uden dem står adgangskontrakten uændret — `authenticated` kan
> læse `matches`, `anon` kan ikke, og `anon` beholder sin `usage` på skemaet.
>
> Skemaets **grants følger med længere nede i filen** (`GRANT USAGE ON SCHEMA
> public TO anon/authenticated/service_role`), så det eksisterende `public` får
> den rigtige adgangskontrakt uden at blive oprettet forfra.
>
> **[`RESTORE.md`](./RESTORE.md) scenarie 2 dropper i stedet `public` først, og
> begge veje er rigtige** — hver i sin sammenhæng. Ved en gendannelse er et
> `drop schema public cascade` rigtigt, fordi hele projektet skal genskabes. Her
> er det ikke: du sidder med to Supabase-faner åbne, og den kommando i den
> forkerte fane er uigenkaldelig. Derfor `sed` frem for `drop`.
>
> Verificeret 6. august 2026: den klippede fil kørt mod PostgreSQL 16 ind i en
> database, hvor `public` fandtes i forvejen — **23 tabeller, 9 views, 42
> policies, 42 funktioner**, ingen fejl, og de 3.573 CRLF-linjer urørt.
>
> **Kører du vej B med en psql ÆLDRE end 17.5, skal to ting mere ud** —
> `SET transaction_timeout` (GUC fra PG17) og `MAINTAIN` i ét grant på
> `public.matches`. En psql 17.5+ mod en PG17-server klarer dem selv, og
> `\restrict` er da også lovlig. Præcis de tre undtagelser laver CI i
> [`sql/tests/docs_sql.mjs`](../sql/tests/docs_sql.mjs) (`tilPG16`), og
> begrundelsen for hver af dem står dér:
>
> ```bash
> sed -E '/^\\(un)?restrict\b/d; /^CREATE SCHEMA public;$/d; /^COMMENT ON SCHEMA public /d; /^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin/d; /^SET transaction_timeout\b/d; s/\bMAINTAIN,//; s/,MAINTAIN\b//' \
>   sql/schema.sql > schema_pg16.sql
> ```
>
> *(De to første slags er ikke PG-version-ting og står derfor i begge
> kommandoer: `CREATE SCHEMA public` afhænger af måldatabasen, og
> `supabase_admin`-linjerne af hvilken rolle du kører som. Kører du som
> superbruger i din egen PostgreSQL, kan de sidste 12 blive stående.)*

> ⚠️ **Ud over de linjer: kopiér filen ordret.** Funktionskroppene indeholder
> CRLF med vilje (`G5`, `.gitattributes`) — kør den ikke gennem et værktøj, der
> normaliserer linjeskift. `sed` ovenfor rører dem ikke.

> ⚠️ **`schema.sql` er kun sand efter en eksport.** Den er et genereret
> øjebliksbillede, ikke en kilde. Er der kørt en migrering i produktionen efter
> filens seneste commit, mangler den i staging. Tjek `git log -1 -- sql/schema.sql`
> mod din seneste kørsel, og kør skema-eksport-workflowen først, hvis der er
> tvivl (`sql/README.md`).

**Efterprøv, at det virkede:**

```sql
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE')                 as tabeller,
  (select count(*) from information_schema.views  where table_schema = 'public') as views,
  (select count(*) from pg_policies               where schemaname   = 'public') as policies,
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public')                                                  as funktioner;
```

`schema.sql` gav **23 tabeller, 9 views, 42 policies** (målt 5. august 2026 mod
PostgreSQL 16 — tallene vokser med hver migrering, så de er et pejlemærke og
ikke et krav). Sammenlign med produktionen. **Nul policies er den fejl, der gør
mest skade og larmer mindst** — skemaet ser rigtigt ud, og RLS er væk.

### Døde kørslen midtvejs?

**`schema.sql` er ikke idempotent** — den er et dump, og dens `create table` har
intet `if not exists`. Du kan altså ikke bare rette fejlen og køre igen: anden
kørsel svarer `42P07: relation … already exists`, og så er det ikke til at se,
hvad der nåede at komme med.

Kør tællingen ovenfor. Er den **nul hele vejen**, rullede kørslen tilbage — ret
filen og kør den igen. Står der tabeller, skal skemaet nulstilles:

```sql
select count(*) as brugere from auth.users;
```

**Det tal skal være 0.** Det er kontrollen af, at du står i staging og ikke i
produktionen — og den skal tages hver gang, ikke kun første gang. Derefter:

```sql uddrag
drop schema public cascade;
create schema public;
```

og kør så den rettede fil igen. Skemaets grants står i dumpet selv, så det
nyoprettede `public` får dem med.

---

## 3. Data: turneringer

`schema.sql` er skema uden rækker, så staging har ingen turneringer at tippe på.
Kør datafilerne i denne rækkefølge:

1. `sql/tournament_superliga.sql` — Superligaen (turnering #1, den officielle)
2. `sql/tournament_footballdata.sql` — de fem football-data.org-turneringer
3. `sql/tournament_footballdata_promote.sql` — gør dem synlige og officielle
4. `sql/tournament_scotland_premiership.sql` — Scotland Premiership

**Superliga-filen bærer sine værdier** (sæson `2026/27`, `api_season_id` 27897 —
aflæst i produktionen 6. august 2026). Skifter sæsonen, står begge opslag i
filens hoved, og guarden stopper læsbart, hvis nogen tømmer parametrene uden at
udfylde dem. *(Filen kom til 5. august 2026. Indtil da var Superligaen den
eneste af de syv turneringer, et miljø bygget af repoet alene ikke kunne få.)*

Efter alle fire: **7 ligaer, 7 sæsoner** — Superligaen officiel, de fem
football-data officielle, Scotland uofficiel. Hold, kampe og resultater kommer
af en sync (trin 6).

---

## 4. Data: brugere

Appen skriver selv `profiles`-rækken ved oprettelse (`App.jsx` upserter den
efter signup), så **opret testbrugerne gennem appen** frem for i Supabase —
ellers står de i `auth.users` uden profil, og halvdelen af skærmene er tomme.

**Men hvilken app?** Den, der peger på staging — og det afgøres af `VITE_*`,
som bages ind ved build-tid. Produktions-appen skriver ALTID i produktionen,
uanset hvilken fane du har åben ved siden af. Der er to instanser at vælge
imellem, og den første kan bruges med det samme:

| Vej | Sådan | Hvornår |
|---|---|---|
| **Lokalt** (hurtigst) | `cp .env.example .env.local`, udfyld med staging-URL og publishable-nøgle, `npm run dev` → `localhost:5173` | Nu. Kræver ikke trin 5. `/api/*` findes ikke i dev, men oprettelse bruger det ikke — signup går direkte til Supabases auth-endpoint |
| **Preview-deployet** | Trin 5's fire variabler, derefter branchens preview-URL | Når trin 5 alligevel er lavet |

**`npm run dev` kan ikke ramme produktionen ved et uheld** (`G4`): mangler de to
variabler, kaster `src/lib/supabase.js` med det samme frem for at falde tilbage.
Fallbacken gælder kun produktions-buildet.

Før den første bruger:

- Authentication → Sign In / Providers: slå **"Confirm email" fra** i staging.
  **Det er ikke bekvemmelighed, det er nødvendigt:** med bekræftelse slået til
  returnerer signup ingen session, og uden token kan appen ikke skrive
  `profiles`-rækken (`Auth.jsx` kræver `access_token` for at gå videre). Det
  brugernavn, du lige valgte, går tabt, og kontoen ender uden profil. Ved næste
  login slås profilen kun OP — den oprettes ikke. Produktionens indstilling er
  en anden sag og røres ikke.
- Gør dig selv til administrator bagefter:

  ```sql
  update public.profiles set is_admin = true where display_name = '<dit testnavn>';
  ```

- **Bekræft, at brugeren landede det rigtige sted**, før du opretter nummer to:
  netværksfanen skal vise kaldet til `/auth/v1/signup` mod **staging-ref'en**, og

  ```sql
  select count(*) from auth.users;
  ```

  skal stige i staging, mens produktionens står stille.

**Bruger du alligevel Dashboard → Add user**, opretter det kun `auth.users`-
rækken. Så skal profilen sættes i hånden, ellers har brugeren intet navn:

```sql uddrag
insert into public.profiles (id, display_name)
select id, 'Testbruger' from auth.users where email = '<mail>';
```

**Kopiér ikke produktionens brugere ind.** Det er teknisk muligt —
`data-backup.yml` dumper også `auth.users` — men det flytter rigtige personers
e-mail og tips til et andet projekt med andre adgangsregler, og det er en
behandling, privatlivspolitikken ikke lover. Syntetiske brugere er ikke bare
tilstrækkelige, de er svaret.

---

## 5. Peg miljøerne på staging

Nøglerne står i Supabase → Project Settings → API: **Project URL**, den
offentlige **publishable**-nøgle (`sb_publishable_…`) og den hemmelige
**service_role**-nøgle.

### Vercel — kun Preview

Settings → Environment Variables. Alle fire sættes med **Preview** som eneste
miljø:

| Variabel | Værdi |
|---|---|
| `VITE_SUPABASE_URL` | staging-projektets URL |
| `VITE_SUPABASE_KEY` | staging-publishable-nøglen |
| `SUPABASE_URL` | samme URL (serverfunktionerne) |
| `SUPABASE_SERVICE_ROLE_KEY` | staging-service_role-nøglen |

> ⚠️ **Tjek scope på de variabler, der allerede findes, FØR du opretter noget.**
> Vercel tillader ikke to værdier for samme navn i overlappende miljøer. Står en
> eksisterende på *Production and Preview*, skal den først **begrænses til
> Production**, og derefter oprettes staging-værdien for Preview. Gør man kun
> det sidste, ser det ud som om det virkede — og preview kalder videre til
> produktionen.
>
> **Aflæst 6. august 2026 var det ikke nødvendigt for nogen af de fire:**
> `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SYNC_SECRET` og
> `SPORTMONKS_TOKEN` stod allerede som **Production** alene, så Preview-værdien
> kan oprettes ved siden af. `FOOTBALLDATA_TOKEN` og de tre `VAPID_*` står på
> *Production and Preview* og skal blive der — de er de samme værdier i begge
> miljøer, og en preview mod staging vil gerne have dem.

**Det, aflæsningen samtidig afslørede:** preview har aldrig haft en
`SUPABASE_URL`, så `/api/*` på en preview-URL har aldrig kunnet svare. Det
forklarer, hvorfor `DOCUMENTATION.md` §9's "alle miljøer peger på samme
Supabase-projekt" kun har været sandt for **frontenden** (som har produktionens
værdier hårdkodet som fallback) — serverfunktionerne på preview fejlede i
stedet på en manglende variabel. Trin 5 retter begge dele på én gang.

Sæt en **anden** `SYNC_SECRET` for Preview. To miljøer med samme hemmelighed
betyder, at et kald, der ved en fejl rammer produktionen, bliver autoriseret.
Den bruges ikke af "Hent nu" (den autoriserer på admin-token), så den kan sættes
bagefter — men så er den også sat, den dag et cron-lignende kald skal prøves af.

Leverandør-tokens skal være sat for Preview, hvis kampene skal hentes:
`SPORTMONKS_TOKEN` (Superligaen) og `FOOTBALLDATA_TOKEN` (de fem andre). **De
deler kaldebudget med produktionens cron-jobs** — football-data.org har 10
kald/minut, og minut-spredningen i [`CRON.md`](./CRON.md) regner ikke med en
ekstra kalder. Synkronisér i staging i ryk, ikke på et skema.

**Variabler slår først igennem ved et NYT deploy.** `VITE_*` bages ind i
buildet, så en preview-URL, der allerede er bygget, peger stadig på det, den
blev bygget med. Redeploy branchen (eller push en commit) efter at have sat
dem — ellers ser opsætningen rigtig ud i Vercels UI og forkert i browseren.

### Lokalt

```bash
cp .env.example .env.local   # og udfyld med staging-værdierne
```

`npm run dev` kræver de to `VITE_`-variabler (`G4`) — det er præcis dette valg,
kravet findes for.

> ⚠️ **`/api/*` findes ikke i `npm run dev`, og det rammer trin 6.** Admin →
> Drift → "Hent nu" kalder `/api/sync-matches`, som er en Vercel-funktion.
> Lokalt får du 404, og **staging får aldrig kampe** — resten af appen virker,
> men der er intet at tippe på. Tre veje, i den rækkefølge de er værd at prøve:
>
> 1. **Preview-deployet** (anbefalet): funktionerne er der allerede, og de peger
>    på staging, så snart variablerne ovenfor er sat. Ingen lokal opsætning.
> 2. **`npm run dev:api`** (`vercel dev`) kører funktionerne lokalt. Kræver, at
>    `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SYNC_SECRET` og
>    leverandørens token også står i `.env.local` — og at det linkede
>    Vercel-projekts *Development*-variabler ikke overskriver dem med
>    produktionens.
> 3. **`VITE_API_PROXY`** — 🛑 **ikke til dette formål.** Den videresender
>    `/api/*` til en kørende deploy, og den deploys funktioner skriver i
>    **deres egen** database. Peger du den på produktions-deployet, mens
>    frontenden kører mod staging, henter og skriver du kampe i PRODUKTIONEN
>    fra en app, der ser ud til at være staging. Proxyen er lavet til at
>    afprøve push-flowet, ikke til at synkronisere.

### Det, der IKKE må pege på staging

| Hvad | Hvorfor |
|---|---|
| Jobbene på cron-job.org ([`CRON.md`](./CRON.md)) | De holder produktionen kørende. Skal staging synkroniseres, gøres det i hånden fra Admin → Drift |
| Repo-secret'en `SUPABASE_DB_URL` | Skema-eksport, job-heartbeat og datasikkerhedskopi. Peger den på staging, eksporterer vi et skema, ingen bruger, og sikkerhedskopierer en tom database — **og produktionens backup stopper uden at fejle** |
| `BACKUP_PASSPHRASE` | Uændret |

---

## 6. Første kørsel

1. Åbn **preview-URL'en** for en branch (ikke `localhost` — se advarslen i trin
   5), log ind med den bruger, du oprettede i trin 4. Er brugeren lavet lokalt,
   findes den allerede: begge instanser taler med samme staging-database.
2. Admin → Drift → **"Hent nu"** for en liga ad gangen. Kampene kommer ind, og
   `job_runs` får en række med `authVia: admin-token`. Får du i stedet en fejl
   om en manglende nøgle, mangler leverandørens token for Preview (trin 5).
3. Opret en liga og en konkurrence, afgiv et tip.

**Sync'en er den eneste vej til kampe.** Appen kan rette et resultat, men ikke
oprette kampen — så uden et gennemført "Hent nu" har staging turneringer uden
noget at tippe på.

---

## 7. Bevis, at det er staging

Tre kontroller. Den sidste er den eneste, der ikke kan snydes af en cachet
service worker eller en variabel, der ikke slog igennem:

1. **Netværksfanen på preview:** kaldene skal gå til staging-projektets ref, ikke
   til produktionens (`qfcjbpvttburccdyfnkx`).
2. **Hard-refresh først.** PWA-cachen kan holde et gammelt build i live, og et
   gammelt build har de gamle variabler indbygget (`VITE_*` bages ind ved
   build-tid — en ændret variabel kræver et **nyt deploy**, ikke bare en
   genindlæsning).
3. **Kig i produktionen efter det, du lige lavede.** Konkurrencen fra trin 6 må
   ikke findes dér:

   ```sql
   select id, name, created_at from public.competitions order by created_at desc limit 5;
   ```

---

## 8. Vedligehold

**Staging driver fra produktionen med hver migrering.** Der er to måder at holde
den ajour, og den anden er som regel den rigtige:

- **Kør migreringen begge steder.** Det er hele pointen — staging først,
  produktion bagefter.
- **Byg staging op forfra**, når den alligevel er blevet et rodet
  testdatasæt: slet projektet, og gentag trin 1–4 mod en frisk `schema.sql`.
  Der er ingen data at miste, og det er den eneste vej, der også efterprøver,
  at `schema.sql` faktisk kan genskabe skemaet — altså gendannelsesvejen i
  [`RESTORE.md`](./RESTORE.md).

**Det, staging låser op:**

- `G76` — `anonymize_my_account()` har aldrig kørt. Den er uigenkaldelig, og
  dens første kørsel bør ikke være en bruger, der ikke kan fortryde.
- Migreringer, hvis advarsel i dag lyder "kør mellem to runder" — de kan prøves
  af først.
- Tjeklisten i `DOCUMENTATION.md` §11: de punkter, der i dag kræver, at man
  tester mod produktionsdata, kan flyttes hertil. **Ikke alle** — RLS-punkterne
  er kun sande mod de rigtige rollers rigtige rækker.
