# Guide: Eksportér kerneskemaet fra Supabase til repoet

**Mål:** at få én fil, `sql/schema.sql`, ind i dette repo. Filen skal indeholde hele databasens opskrift (tabeller, funktioner, views, triggere, adgangsregler), som i dag **kun** findes inde i Supabase. Når filen er committet, kan databasen genskabes fra git, staging kan sættes op, og al fremtidig SQL kan skrives mod den faktiske virkelighed i stedet for hukommelsen. Det er forudsætning **F1** i [`../docs/features/karriereprofil-v1.md`](../docs/features/karriereprofil-v1.md).

Guiden forudsætter **ingen** forhåndsviden. Der er to veje — tag Vej 1, medmindre du har lyst til at prøve selv.

---

## Ordliste (én linje pr. ord)

| Ord | Betyder |
|---|---|
| **Skema** | Databasens "opskrift": hvilke tabeller, kolonner, funktioner osv. der findes — **ikke** selve dataene (brugere, tips, resultater kommer ikke med). |
| **Dump** | En eksport af skemaet til en tekstfil. Ren læsning — den ændrer intet i databasen. |
| **Connection string** | Én lang tekstlinje, der fortæller et program, hvordan det når din database (adresse + brugernavn + adgangskode i ét). Starter med `postgresql://`. |
| **Terminal** | Et program, hvor man skriver kommandoer i stedet for at klikke (bruges kun i Vej 2). |

**Er det farligt?** Nej. En dump *læser kun*. Produktionen og brugernes data kan ikke tage skade af noget i denne guide. Det eneste, du skal passe på, er adgangskoden — derfor slutter Vej 1 med at nulstille den.

---

## Vej 1 (anbefalet): Lad Claude gøre det — ca. 10 minutter, ingen installation

Du skal kun gøre to ting selv: finde én tekstlinje i Supabase og indsætte den i en Claude Code-session. Claude Code-sessioner i skyen har allerede værktøjet (`pg_dump`) installeret.

### Trin 1: Find din connection string i Supabase

1. Gå til [supabase.com](https://supabase.com) i din browser og log ind.
2. Klik på dit projekt (Prediction Champ-databasen), så du står på projektets forside.
3. Klik på knappen **"Connect"** — den sidder i bjælken **øverst på siden**.
4. Der åbner dialogen *"Connect to your project"* med en række kort/faner øverst (Framework, Server, Direct, ORM, MCP …). Klik på kortet **"Direct – Connection string"**.
5. Ved connection-strengen er der en **type-vælger** med tre muligheder: *Direct connection*, *Transaction pooler* og *Session pooler* — vælg **Session pooler**. (Ser du kun én streng, så scroll ned i dialogen; de tre typer står typisk under hinanden.)
6. Kopiér tekstlinjen. Den rigtige kan kendes på værtsnavn med `pooler.supabase.com` **og port `5432`**, fx:
   `postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
   *Forkert type?* `db.<projekt>.supabase.co` = Direct connection (kræver IPv6 — dur ikke her); port `6543` = Transaction pooler (dur ikke til dump).
7. Erstat `[YOUR-PASSWORD]` (inklusive de firkantede parenteser) med databasens adgangskode.
   - **Kan du ikke huske adgangskoden?** Det er normalt — den bruges sjældent. Nulstil den: klik på **tandhjulet (Project Settings)** i venstremenuen → **Database** → find **"Database password"** → klik **"Reset database password"** → kopiér den nye kode med det samme (den vises kun én gang). *Nulstillingen påvirker ikke appen — appen bruger API-nøgler, ikke denne kode.*

✅ **Sådan ved du, at trinnet lykkedes:** du har én lang linje, der starter med `postgresql://` og **ikke** længere indeholder `[YOUR-PASSWORD]`.

### Trin 2: Giv opgaven til Claude

1. Start en ny Claude Code-session på dette repo (som du plejer — fx via claude.ai/code).
2. Kopiér beskeden herunder, indsæt din connection string, og send:

> Kør skema-eksporten beskrevet i `sql/README.md`, Vej 1: lav en dump af `public`-skemaet (kun skema, ingen data, uden ejer-info men **med** grants) til `sql/schema.sql`, kør verifikationstjeklisten fra guiden, og commit + push filen. Connection string: `postgresql://...INDSÆT-DIN-HER...`

Claude kører så (til orientering — du skal ikke selv gøre noget):
```
pg_dump --schema-only --schema=public --no-owner "<connection string>" > sql/schema.sql
```
…verificerer indholdet mod tjeklisten nederst i denne guide og committer filen.

✅ **Sådan ved du, at trinnet lykkedes:** Claude melder tilbage, at alle objekter i tjeklisten er fundet, og at `sql/schema.sql` er pushet. Du kan selv se filen på GitHub i `sql/`-mappen.

### Trin 3: Nulstil adgangskoden bagefter

Du har nu delt databasens adgangskode i en chat. Det er lav risiko, men god hygiejne at rydde op: gentag nulstillingen fra Trin 1.7 (**Project Settings → Database → Reset database password**). Du behøver ikke gemme den nye kode noget sted — den kan altid nulstilles igen næste gang.

✅ **Færdig.** Spring ned til ["Efter eksporten"](#efter-eksporten).

---

## Vej 2: Gør det selv i en terminal

Kræver installation af to programmer og lidt tålmodighed — vælg kun denne, hvis du gerne vil kunne gøre det selv fremover.

### 2.1 Åbn en terminal

- **Windows:** tryk på Windows-tasten, skriv `powershell`, tryk Enter. Et blåt/sort vindue åbner — det er terminalen.
- **Mac:** tryk Cmd+Mellemrum, skriv `terminal`, tryk Enter.

Alle kommandoer herunder skrives (eller indsættes) i det vindue efterfulgt af Enter.

### 2.2 Installér Node.js

Supabases værktøj startes via Node.js.

1. Gå til [nodejs.org](https://nodejs.org), download **LTS**-versionen og kør installationen (alle standardvalg er fine).
2. **Luk terminalen og åbn en ny** (så den opdager det nye program).
3. Tjek: skriv `node --version` og tryk Enter.

✅ **Lykkedes:** der står et versionsnummer, fx `v22.11.0`. Står der *"node is not recognized"* / *"command not found"*, er installationen ikke færdig — prøv at genstarte computeren.

### 2.3 Installér Docker Desktop

Supabases dump-kommando bruger Docker bag kulisserne (den kører database-værktøjet i en lille isoleret kasse, så versionen altid passer).

1. Download **Docker Desktop** fra [docker.com](https://www.docker.com/products/docker-desktop/), installér, og **start programmet**.
2. Vent til Docker-ikonet (hvalen) melder "running".

✅ **Lykkedes:** skriv `docker --version` i terminalen — der står et versionsnummer. *(Er Docker for besværligt, så brug Vej 1 — det er præcis derfor, den findes.)*

### 2.4 Find din connection string

Følg **Vej 1, Trin 1** (Supabase → Connect → Session pooler → erstat `[YOUR-PASSWORD]`).

### 2.5 Kør dumpen

Skriv (én linje — udskift connection-strengen med din egen, og behold citationstegnene):

```
npx supabase db dump --db-url "postgresql://...DIN-STRENG-HER..." --schema public -f schema.sql
```

- `npx supabase` henter og kører Supabases værktøj uden fast installation — første gang spørger den måske *"Ok to proceed? (y)"*: skriv `y` og tryk Enter.
- Kommandoen kan tage et par minutter første gang (Docker henter et hjælpe-image).

✅ **Lykkedes:** der ligger nu en fil `schema.sql` i den mappe, terminalen stod i (Windows: typisk `C:\Users\<dig>`; Mac: din hjemmemappe). Åbn den i Notesblok/TextEdit — den skal være fuld af `CREATE TABLE …`-linjer. Kør derefter [tjeklisten](#tjekliste-er-dumpen-komplet) med Ctrl+F.

### 2.6 Læg filen i repoet på GitHub (uden git)

1. Gå til repoet på GitHub → åbn mappen **`sql`**.
2. Klik **"Add file" → "Upload files"**.
3. Træk `schema.sql` ind, skriv en commit-besked (fx *"Tilføj kerneskema eksporteret fra Supabase"*), og vælg at committe til en branch/pull request som du plejer.

*(Bruger du git lokalt: læg filen i `sql/`, og kør `git add sql/schema.sql`, `git commit -m "Tilføj kerneskema eksporteret fra Supabase"`, `git push`.)*

✅ **Lykkedes:** `sql/schema.sql` er synlig på GitHub.

---

## Tjekliste: er dumpen komplet?

Åbn `schema.sql` og søg (Ctrl+F / Cmd+F) efter hvert navn herunder. **Alle** skal findes mindst én gang — mangler ét, er dumpen ufuldstændig (se Fejlfinding):

- **Tabeller:** `leagues`, `seasons`, `teams`, `matches`, `profiles`, `competitions`, `competition_participants`, `competition_matches`, `predictions`, `ratings`, `rating_history`, `groups`, `group_members`, `stories`, `push_subscriptions`, `notification_log`, `user_activity_days`
- **Funktioner:** `recompute_ratings`, `pc_points`, `username_available`, `touch_activity`, `admin_user_stats`, `generate_stories`, `is_group_member`
- **Views:** `monthly_standings`, `round_standings`, `season_standings`, `latest_story`
- **Triggere:** `matches_recompute_ratings_ins`, `matches_recompute_ratings_upd`, `matches_recompute_ratings_del`
- **Adgangsregler:** teksten `CREATE POLICY` (skal forekomme mange gange) og `GRANT` (rettigheder til `authenticated`)

I Vej 1 kører Claude selv denne tjekliste og melder resultatet.

---

## Efter eksporten

- **Kilden til sandhed:** `sql/schema.sql` er nu det samlede snapshot. De øvrige scripts i denne mappe bevares som patch-historik — de er allerede indeholdt i dumpen.
- **Vedligeholdelse:** hver gang der fremover køres ny SQL i Supabase (nye scripts, håndrettelser), gentages eksporten med samme kommando, så filen følger med. Det er hurtigt og ufarligt at gentage.
- **Det låser op:** staging kan nu oprettes ved at køre `schema.sql` i et nyt Supabase-projekt (jf. `DOCUMENTATION.md` afsnit 9), og forbeholdene "skemaet er ikke i repoet" i `DOCUMENTATION.md` (afsnit 5, 9, 12, 17) kan fjernes. Karriereprofilens forudsætning **F1** er lukket.

## Fejlfinding

| Problem | Årsag og løsning |
|---|---|
| *"password authentication failed"* | Forkert adgangskode i strengen. Nulstil den (Vej 1, Trin 1.7) og indsæt den nye. |
| Adgangskoden indeholder specialtegn (`@`, `#`, `%` …) og forbindelsen fejler | Tegnene skal URL-kodes (fx `@` → `%40`, `#` → `%23`). Nemmest: nulstil til en kode uden specialtegn, eller lad Claude håndtere det (Vej 1). |
| *"server version mismatch"* (pg_dump) | Værktøjets version er ældre end databasens. I en Claude-session installerer Claude selv en nyere klient; i Vej 2 undgår Docker-metoden problemet helt. |
| *"Cannot connect to the Docker daemon"* (Vej 2) | Docker Desktop er ikke startet — åbn programmet og vent på "running". |
| Forbindelsen hænger/timeout | Du har fat i "Direct connection" (kræver IPv6) — gå tilbage og vælg **Session pooler** (Trin 1.5). |
| Et navn fra tjeklisten mangler i filen | Dumpen fik ikke hele `public`-skemaet med — kør igen og tjek, at kommandoen indeholder `--schema public` (Vej 2) / `--schema=public` (Vej 1), og at du ikke ramte en staging-database. |
