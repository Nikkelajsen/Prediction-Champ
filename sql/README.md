# `sql/` — skema, migreringer og eksport

Denne mappe indeholder de SQL-scripts, der definerer og udvider produktionsskemaet
(`public`) i Supabase. De enkelte `*.sql`-filer er **migreringer**, kørt manuelt i
Supabase SQL-editor med **"Run without RLS"** (scripterne sætter selv RLS på de
tabeller, der skal have det — jf. `DOCUMENTATION.md` afsnit 13). Alle er idempotente
og kan køres igen.

`schema.sql` er en **genereret** fuld-skema-eksport — et øjebliksbillede af hele
`public`-skemaet, som det så ud ved seneste eksport. Den redigeres aldrig i hånden;
den regenereres med guiden nedenfor.

> ⚠️ **Øjebliksbilledet er BAGUD pr. 1. august 2026**: `predictions_match_lock.sql` (#25) og
> den omlagte `analytics_dashboard.sql` (nye `analytics_match_locks`, omdøbte kolonner i
> `analytics_round_locks`) er kørt siden. Eksporten skal køres, og datoen nedenfor rettes.
>
> **Øjebliksbilledet var friskt pr. 31. juli 2026** — eksporten er kørt efter
> `multi_provider.sql` (#22) og indeholder `leagues.provider`, `leagues.live_enabled`
> og `leagues.is_official`. Et staging-projekt bygget op fra `schema.sql` alene får
> altså det skema, koden faktisk kører imod.
>
> Reglen er uændret: **eksport efter hver migrering, og datoen ovenfor rettet i
> samme ombæring** — ellers ved næste læser ikke, om filen kan stoles på.
> Verificér mod databasen, ikke mod filen, hvis der er tvivl; til gengæld er netop
> det den hurtigste måde at se, om en migrering faktisk **er** kørt i produktion.

---

## Filoversigt og kørerækkefølge

Rækkefølgen er den, filerne blev kørt i, og den, en frisk database skal bruge.
Skal et miljø bygges op fra bunden, er `schema.sql` genvejen (den indeholder
slutresultatet af det hele) — listen her er til at forstå *hvorfor* skemaet ser ud,
som det gør, og til at undgå at køre en gammel fil oven i en nyere.

| # | Fil | Formål | Status |
|---|---|---|---|
| — | `schema.sql` | **Genereret** øjebliksbillede af hele `public`. Kør den i et nyt/staging-projekt i stedet for hele listen | Redigér aldrig i hånden |
| 0 | `rating_core.sql` | `pc_points()`, `round_key()`, `recompute_ratings()` + tabellerne `ratings`/`rating_history` | Aktiv — **skal køres før #5**. Tilføjet 30. juli 2026 med optimeringen fra samme dag (logistikken i `double precision`, ~175× hurtigere). **Skal gen-køres efter #20** (31. juli 2026, A17): `_rs` joiner nu `seasons`/`leagues` og tæller kun **officielle** turneringer. ⚠️ **Gen-kørslen ændrer kun funktionen, ikke tallene** — `ratings` står uændret, til noget kalder `recompute_ratings()`. Tryk "Opdater ratings" i Admin bagefter, ellers ligger de gamle tal og venter på næste kampresultat |
| 1 | `standings_views.superseded.sql` | Første udgave af `round_standings` + `season_standings` | ⚠️ **Afløst af `standings_tiebreakers.sql`** — kør den aldrig. Omdøbt 30. juli 2026, så filnavnet selv advarer; kun bevaret for historikken |
| 2 | `user_stats.sql` | `user_activity_days`, `touch_activity()`, `admin_user_stats()` | Aktiv |
| 3 | `username_constraints.sql` | Længde-constraint på `profiles.display_name` (2–20), `username_available()` | Aktiv |
| 4 | `predictions_round_lock_policies.sql` | Runde-baseret lås på `predictions` for **SELECT + DELETE** | ⚠️ **Afløst af #25** — kør den aldrig igen. En gen-kørsel ruller tavst låsen tilbage fra kamp til runde |
| 5 | `rating_trigger_optimization.sql` | Statement-level triggere på `matches`; kalder `recompute_ratings()` + `generate_stories()` | Aktiv — forudsætter `rating_core.sql` (#0) |
| 6 | `matches_stage.sql` | `matches.stage_name` (grundspil/slutspil) | Aktiv |
| 7 | `push_notifications.sql` | `push_subscriptions` + `notification_log` | Aktiv |
| 8 | `story_engine.sql` | `stories`, `latest_story`, `generate_stories()` | Aktiv — ~~v1.1 skal gen-køres i produktion~~ **gen-kørt 31. juli 2026** (både v1.1's 14 regler og `scope = 'ALL'`-filtreringen efter #20). Kun funktionen ændres, tabel og view er uændrede |
| 9 | `groups.sql` | Liga-laget: `groups`, `group_members`, `is_group_member()`, `move_competition_to_group()` | ⚠️ Aktiv, men **to af dens policies er afløst** — se advarslen nedenfor |
| 10 | `career_profile.sql` | `career_profile(profile_user_id)` | Aktiv — ~~gen-kør efter #20~~ **gen-kørt 31. juli 2026**: rundesejre og "bedste runde" filtrerer nu `scope = 'ALL'` (ellers tælles hver sejr én gang pr. turnering), og samme kørsel gav `titles.by_tournament` (K2) |
| 11 | `live_scores.sql` | `matches.live_*`-kolonner + live-indekser | Aktiv |
| 12 | `standings_tiebreakers.sql` | Genskaber alle tre stillings-views med `outcome_count`, `round_wins`, `avg_goal_error` | Aktiv — **afløser #1** |
| 13 | `group_membership_invariant.sql` | A8 i databasen: backfill, auto-indmeldende trigger, strammet liga-exit + framelding | Aktiv — **afløser to policies fra #9** |
| 14 | `predictions_write_lock.sql` | Runde-låsen også på **INSERT + UPDATE**; rydder den gamle `"read predictions"` op | ⚠️ **Afløst af #25** — kør den aldrig igen, af samme grund som #4 |
| 15 | `story_engine_backfill.sql` | Kalder `generate_stories()` for alle fuldt afsluttede runder | **Engangs-/ad hoc-kørsel**, ikke en migrering. Kør efter #8, når nye regler skal gælde bagud |
| 16 | `analytics_events.sql` | Analytics v1: `analytics_events` (hændelseslog), RLS (kun INSERT, egne rækker), indekser, hændelseskatalog-constraint | Aktiv — kør én gang, gen-kør kun ved ny event i kataloget |
| 17 | `analytics_dashboard.sql` | Analytics v1: `analytics_round_locks`/`analytics_completion_facts`-views + `admin_analytics_health/engagement/league_health/retention`-RPC'er | Aktiv — **sikker og forventet at blive gen-kørt**. **Gen-kør efter 30. juli 2026-omlægningen** (Liga Health Score fjernet, `admin_analytics_league_health` returnerer nu signaler i stedet for en score) sammen med frontend-mergen; en gammel klient mod en ny RPC — eller omvendt — viser en tom liga-sektion, ikke forkerte tal |
| 18 | `job_runs.sql` | Overvågning: tabellen `job_runs`, `admin_job_health()` og `prune_job_runs()` | Aktiv — tilføjet 30. juli 2026 |
| 19 | `cleanup_orphans.sql` | Fjerner `trg_recompute_ratings()`, `leagues.country` og `seasons.end_date` | **Engangs-oprydning**, men idempotent. Filen dokumenterer også, hvad der bevidst IKKE blev fjernet, og hvorfor |
| 20 | `tournament_scope.sql` | `leagues.is_official` + `round_standings`/`monthly_standings` med **scope** (samlet + pr. turnering) | Aktiv — **afløser de to views i #12**. **Kørt 31. juli 2026**, sammen med #8 og #10, som filtrerer `scope = 'ALL'` og derfor ikke må stå tilbage i en ældre udgave |
| 21 | `tournament_scotland_premiership.sql` | Turnering #2 (`B2`): `leagues`- + `seasons`-rækken for Scotland Premiership (`501`) | **Data, ikke skema** — ændrer intet i strukturen og indgår derfor ikke i `schema.sql`. Idempotent. **Kørt 31. juli 2026**, og cron-jobbet er oprettet (job #5 i [`../docs/CRON.md`](../docs/CRON.md)); tilbage af `B2` står verifikationen — dubletter i hold, fasenavne og testcases 2–6 i [`../docs/features/turnering-2.md`](../docs/features/turnering-2.md) §6 |
| 22 | `multi_provider.sql` | Flere datakilder: `leagues.provider` + `leagues.live_enabled` + check-constraint | Aktiv — tilføjet 31. juli 2026. **Ændrer ingen eksisterende rækkers adfærd**: begge kolonner har en default (`'sportmonks'`, `true`), der beskriver verden før migreringen. Skal køres FØR #23 |
| 23 | `tournament_footballdata.sql` | De fem football-data.org-turneringer: `leagues`- + `seasons`-rækker for Premier League (`PL`), Champions League (`CL`), Bundesliga (`BL1`), Serie A (`SA`), Primera División (`PD`) | **Data, ikke skema** — indgår derfor ikke i `schema.sql`. Idempotent, og en gen-kørsel rører hverken `is_visible` eller `is_official`, så en turnering, der er tændt manuelt, ikke slukkes igen. Forudsætter #22 |
| 25 | `predictions_match_lock.sql` | **Per-kamp-lås** (`A21`): alle fire `predictions`-policies + `comp_participants_delete_own_unlocked`. En kamp låser 1 time før sit EGET kickoff | Aktiv — **afløser #4 og #14**. Idempotent. **Adfærdsændring i produktion:** en runde, der er låst i dag, får sine senere kampe åbnet igen i samme øjeblik. Kør derfor MELLEM to runder, ikke midt i en |
| 24 | `tournament_footballdata_promote.sql` | Sætter `is_visible` + `is_official` = true på de fem football-data-turneringer (A19) | **Data, ikke skema.** Idempotent. **Kørt 31. juli 2026.** Begge kolonner sættes i SAMME update med vilje — check-constrainten `leagues_official_implies_visible` afviser en officiel turnering, ingen kan se, så to adskilte sætninger ville fejle på den første. Scotland Premiership er bevidst ikke med; den forfremmes, når dens igangværende spillerunde er talt op |

### ⚠️ Tre filer må ikke gen-køres blindt

Alle tre bruger `drop policy … create policy` / `drop view … create view`, så en
gen-kørsel **erstatter tavst** en nyere definition med en ældre. Der kommer ingen
fejl — reglen bliver bare den gamle igen.

- **`standings_tiebreakers.sql`** genskaber `round_standings` og `monthly_standings` i deres udgave **uden `scope`**. En gen-kørsel efter `tournament_scope.sql` (#20) fjerner scope-kolonnen tavst: Championship-fanen viser tomme stillinger, fordi den beder om `scope=eq.ALL`, og `career_profile`/`story_engine` fejler på det samme filter. `season_standings` i filen er derimod stadig den gældende udgave. **Kør altid `tournament_scope.sql` bagefter.** *(Tilføjet 31. juli 2026.)*
- **`groups.sql`** genskaber `group_members_delete_self` og
  `comp_participants_delete_own_unlocked` i deres **oprindelige** form og ruller
  dermed A8-invarianten tilbage: man kan igen forlade en liga, mens man deltager i
  dens konkurrencer (forældreløse deltagere), og framelding bliver igen permanent
  spærret efter første spillede runde. Skal `groups.sql` køres, så kør
  **`group_membership_invariant.sql` umiddelbart efter**.
- **`standings_views.superseded.sql`** genskaber `round_standings`/`season_standings` **uden**
  tiebreaker-kolonnerne. Kør `standings_tiebreakers.sql` efter — eller lad være med
  at røre filen; den er kun bevaret for historikken.

### Tests

`sql/tests/rating_equivalence.sql` kører i CI (jobbet `sql` i `.github/workflows/ci.yml`)
mod en frisk PostgreSQL-container og sammenligner `recompute_ratings()` med den
**frosne** før-optimering-udgave i `sql/tests/_reference_recompute.sql`. Rangorden,
`rnk` og `provisional` skal være identiske; tallene må afvige med højst 1e-9.

Den frosne reference må kun opdateres, hvis rating-algoritmen ændres *meningsfuldt* —
og den opdatering er så selve beslutningen om, at tallene må flytte sig.

**Det er sket én gang: 31. juli 2026 (A17)**, hvor ratingen fik samme `is_official`-filter
som Championships stillinger. Bemærk dobbeltheden, hvis det sker igen: når referencen får
en ændring med, kan testen ikke længere selv bevise, at ændringen virker — begge sider er
jo enige. Beviset skal derfor flyttes til en egen sektion, der ændrer *tilstanden* og
kræver, at intet rykker sig. Sådan en sektion ligger nu nederst i
`rating_equivalence.sql`, og den er verificeret ved at fjerne filteret igen og se testen
fejle.

Testen kan køres lokalt mod enhver tom database:

```bash
createdb ratingtest
cd sql/tests && psql -d ratingtest -v ON_ERROR_STOP=1 -b -f rating_equivalence.sql
```

Samme mønster gælder mildere for `predictions_round_lock_policies.sql`: den rører
kun SELECT/DELETE, så den kan gen-køres uden at ødelægge skrive-låsen fra #14.

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

### Vej 3 — GitHub Action (automatiseret)

`.github/workflows/schema-export.yml` kører Vej 1 på en GitHub-runner (som har fri
netadgang til port 5432, i modsætning til web-sandkassen), kører verifikations-
tjeklisten og committer `sql/schema.sql`, hvis noget er ændret.

Engangsopsætning: læg forbindelsesstrengen ind som repo-secret `SUPABASE_DB_URL`
(*Settings → Secrets and variables → Actions → New repository secret*). Kør derefter
workflowen manuelt via **Actions → Skema-eksport → Run workflow**. Den kører desuden
automatisk **hver mandag kl. 06:00 UTC** som sikkerhedsnet mod skema-drift.

**Overlappende kørsler er håndteret.** To kørsler kan sagtens ramme hinanden — fx en
manuel oven i den ugentlige, eller to dispatches lige efter hinanden. `concurrency`
sætter dem i kø frem for at køre dem parallelt, men `actions/checkout` henter som
standard den SHA, der var gældende ved *dispatch*, så nummer to ellers ville arbejde
videre på en forældet base og få sit push afvist som non-fast-forward — en rød kørsel,
selvom eksporten lykkedes. Workflowen tjekker derfor branchens **spids** ud
(`ref: ${{ github.ref_name }}`), og commit-trinnet henter nyeste ref og lægger sit
friske dump ovenpå, hvis pushet afvises. Det er sikkert netop for denne fil, fordi den
er *genereret* og aldrig håndredigeret: der er intet at flette, kun det nyeste dump,
der gælder. Er skemaet allerede identisk på branchen, laves ingen tom commit.

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
