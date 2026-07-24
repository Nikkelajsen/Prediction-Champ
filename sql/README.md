# `sql/` — skema, migreringer og eksport

Denne mappe indeholder de SQL-scripts, der definerer og udvider produktionsskemaet
(`public`) i Supabase. De enkelte `*.sql`-filer er **migreringer** (kørt i rækkefølge
i produktion, se `docs/ROADMAP.md`s beslutningslog for hvornår). `schema.sql` er en
**genereret** fuld-skema-eksport — et øjebliksbillede af hele `public`-skemaet, som
det ser ud lige nu. Den redigeres aldrig i hånden; den regenereres med guiden nedenfor.

---

## Skema-eksport → `sql/schema.sql`

Formålet er ét versioneret øjebliksbillede af hele produktionsskemaet: **kun skema,
ingen data, uden ejer-info, men med grants.** Så kan skemaet læses, diffes og
genskabes uden at afsløre ejer-roller eller slæbe data med.

### Krav: direkte databaseadgang (port 5432)

Eksporten kræver en **direkte PostgreSQL-forbindelse** til Supabase-pooleren på
port `5432` (session-mode). Den kan derfor **ikke** køres fra miljøer, hvor kun
udgående HTTPS er tilladt (fx Claude Code på web / sandkasser med egress-politik,
der blokerer alt andet end 443). Kør den lokalt fra en maskine med netadgang til
databasen, eller fra et miljø hvor 5432 er åbnet.

Forbindelsesstrengen (session-pooler, port 5432):

```
postgresql://postgres.<projekt-ref>:<password>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
```

> Brug port **5432** (session-mode), ikke `6543` (transaction-mode). `pg_dump`
> kræver en session-forbindelse.

### Vej 1 — `pg_dump` (anbefalet)

Kør fra repo-roden:

```bash
pg_dump "postgresql://postgres.<projekt-ref>:<password>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" \
  --schema=public \
  --schema-only \
  --no-owner \
  -f sql/schema.sql
```

Hvad flagene betyder — og hvorfor netop disse:

| Flag | Effekt | Hvorfor |
|---|---|---|
| `--schema=public` | Kun `public`-skemaet dumpes | Supabase-interne skemaer (`auth`, `storage`, `extensions` …) hører ikke til app-skemaet. |
| `--schema-only` | Kun DDL, ingen rækker | Vi vil have strukturen, ikke data. |
| `--no-owner` | Ingen `ALTER … OWNER TO`-linjer | Ejer-roller er miljøspecifikke og skal ikke lækkes/bindes ind. |
| *(intet `--no-privileges`)* | `GRANT`/`REVOKE` **beholdes** | Grants er en del af skemaets sikkerhedskontrakt (RLS-rollernes adgang). |

> **Grants med, ejer fra:** `--no-owner` fjerner ejerskab; grants følger med, fordi
> vi bevidst *ikke* sætter `--no-privileges`. Byt ikke om på de to.

### Vej 2 — Supabase CLI (alternativ)

Kræver `supabase` CLI og et linket projekt (`supabase link`):

```bash
supabase db dump --schema public -f sql/schema.sql
```

CLI'en udelader ejer-info som standard og tager grants med. Resultatet skal opfylde
samme verifikationstjekliste som Vej 1.

---

## Verifikationstjekliste

Kør efter eksporten. Alle punkter skal passe, før filen committes:

```bash
# 1. Filen findes og er ikke tom
test -s sql/schema.sql && echo "OK: filen er ikke-tom"

# 2. Ingen data (kun skema)  → forvent 0
grep -cE '^(COPY|INSERT) ' sql/schema.sql

# 3. Ingen ejer-info          → forvent 0
grep -c 'OWNER TO' sql/schema.sql

# 4. Grants er med            → forvent > 0
grep -c '^GRANT ' sql/schema.sql

# 5. Skemaet er faktisk fyldt → forvent > 0
grep -c 'CREATE TABLE' sql/schema.sql

# 6. Kun public-skemaet       → forvent kun public (ingen auth./storage.-objekter)
grep -oE 'CREATE (TABLE|FUNCTION|VIEW) [a-z_]+\.' sql/schema.sql | sort -u
```

| # | Tjek | Forventet |
|---|---|---|
| 1 | Filen findes og er ikke-tom | `OK` |
| 2 | Ingen `COPY`/`INSERT` (ingen data) | `0` |
| 3 | Ingen `OWNER TO` (ingen ejer-info) | `0` |
| 4 | Mindst én `GRANT` (grants med) | `> 0` |
| 5 | Mindst én `CREATE TABLE` | `> 0` |
| 6 | Kun `public.`-objekter | kun `public.` |

Passer alt: commit `sql/schema.sql`.

```bash
git add sql/schema.sql
git commit -m "chore(sql): opdatér skema-eksport (schema.sql)"
git push -u origin <branch>
```
