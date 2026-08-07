# `sql/` — skema, migreringer og eksport

Denne mappe indeholder de SQL-scripts, der definerer og udvider produktionsskemaet
(`public`) i Supabase. De enkelte `*.sql`-filer er **migreringer**, kørt manuelt i
Supabase SQL-editor med **"Run without RLS"** (scripterne sætter selv RLS på de
tabeller, der skal have det — jf. `DOCUMENTATION.md` afsnit 13). Alle er idempotente
og kan køres igen.

`schema.sql` er en **genereret** fuld-skema-eksport — et øjebliksbillede af hele
`public`-skemaet, som det så ud ved seneste eksport. Den redigeres aldrig i hånden;
den regenereres med guiden nedenfor.

> ✅ **Øjebliksbilledet er FRISKT (5. august 2026, efter #0's gen-kørsel).**
> Eksporten er kørt manuelt to gange samme dag og viser alle dagens migreringer: `seasons.ends_at`
> og `competition_status` v2 (#41), `_anonymize_account()`/`admin_anonymize_account()`
> og de tre administrator-policies (#42), `anon`s tomme sekvens-grants (#43),
> `career_profile()`s officielle komplethedsjoin (#10) og brugernavne-objekterne
> (#3). Filens eget datostempel i git er svaret på "hvor gammel er den?" — ikke
> en dato skrevet i hånden her, som var dét, der drev tre steder fra hinanden
> indtil `G21`.
>
> **Adgangskontrakten kan læses af filen:** `anon` har hverken tabel- eller
> sekvens-privilegier, og `postgres`' default privileges giver dem ikke tilbage.
> Kun `on functions` står tilbage — med vilje, for `username_available()` kaldes
> før login.
>
> ⚠️ **Én ting står stadig, og den kan ikke lukkes herfra:** `supabase_admin`s
> `ALTER DEFAULT PRIVILEGES … TO anon` (både `TABLES` og `SEQUENCES`). Sætningen
> kræver medlemskab af rollen, som SQL-editorens session ikke har, og #43
> melder det som en `warning` frem for at vælte. **Følgen er snævrere, end den
> lyder:** reglen gælder kun objekter, der oprettes **af** `supabase_admin`, og
> alt, vi selv opretter, ejes af `postgres`. Tilstanden aflæses af tre
> kontroller i [`job-heartbeat.yml`](../.github/workflows/job-heartbeat.yml) hver
> halve time — tabeller, sekvenser og selve kilden.
>
> **#0 er gen-kørt, og eksporten er beviset.** Den første eksport samme dag
> afslørede, at `recompute_ratings()` i produktion stadig rangerede `rnk` på
> score alene — `G68` var merget som kode og inert i databasen, fordi
> `rating_core.sql` er en migrering, der køres i hånden, og aldrig blev flaget
> som en kørsel. Det blev `B22`, som nu er lukket: funktionen bærer
> `order by score desc, exacts desc`, og ratingene er regnet om.
>
> **Diff'en er samtidig `G5`s bevis:** gen-kørslen gav 19 linjers ændring og
> ikke ~2.400. Var filen blevet normaliseret til LF undervejs, ville hver eneste
> linje i hver eneste funktionskrop stå som ændret — og en rigtig ændring kunne
> gemme sig i støjen.
>
> **Det, en tidligere eksport afgjorde (`G5`):** funktionskroppene i produktion
> indeholder CRLF — alle funktionskroppe med `$$`-body. Advarslen i `rating_core.sql`s
> hoved var altså sand om databasen, mens selve filen var blevet normaliseret til
> LF. Kroppene er hentet ordret tilbage, og `.gitattributes` (`*.sql -text`) holder
> dem der.
>
> Reglen er uændret: **eksport efter hver migrering** — kør
> [`schema-export.yml`](../.github/workflows/schema-export.yml) manuelt, eller
> lad mandagskørslen gøre det. Verificér mod databasen, ikke mod filen, hvis der
> er tvivl; til gengæld er netop det den hurtigste måde at se, om en migrering
> faktisk **er** kørt i produktion.

---

## Undermapper

| Mappe | Hvad | Køres |
|---|---|---|
| `sql/tests/` | SQL-testene, som CI's `sql`-job kører mod en rigtig PostgreSQL | Af CI. Bruger `\ir`/`\set` med vilje og kan derfor **ikke** pastes i SQL-editoren |
| `sql/checks/` | **Overvågning**, ikke migreringer. Tre filer: [`kickoff_coverage.sql`](./checks/kickoff_coverage.sql) (`G84`), som spørger, om de nært forestående kampe har et rigtigt klokkeslæt; [`league_admin_coverage.sql`](./checks/league_admin_coverage.sql) (`A37`), som spørger, om hver liga stadig har en administrator, der kan logge ind; og [`rating_freshness.sql`](./checks/rating_freshness.sql) (`G83`), som spørger, om den gemte rating stadig passer til de data, den er udledt af. Alle tre opretter en **temporær** view og installerer derfor intet — de lever kun i den psql-session, der læser dem | Mod produktion med `psql "$SUPABASE_DB_URL" -f …` (kickoff- og rating-kontrollen desuden af `job-heartbeat.yml` hver halve time), og i CI mod en tom database af den tilsvarende fil i `sql/tests/`. **Samme fil begge steder** — det er hele grunden til, at de er filer og ikke heredocs i en workflow. **Det er dén form, en forespørgsel skal have, før den må køres mod produktion** |
| `sql/dev/` | Værktøjer til **staging**, ikke migreringer. To filer: [`simulate_season.sql`](./dev/simulate_season.sql), som spiller en hel sæson igennem for testbrugerne — tips, resultater, stillinger, rating, historier og kåringer — i sin EGEN turnering, som ingen synkronisering kan røre (**dækket af `sql/tests/simulate_season.sql` i CI siden `G82`, 7. august 2026** — den er jobbets tungeste trin og kører mod det rigtige skema, fordi filen rører hele kæden på én gang); og [`anonymize_rehearsal.sql`](./dev/anonymize_rehearsal.sql) (`G76`), som stiller kontolukningens kontrakt op som før/efter, så man kan se, hvad den gør, før den køres på et menneske | I hånden i staging-projektets SQL-editor. 🛑 **Ingen af dem i produktion.** `simulate_season.sql` er selv låst med `sim.arm('JA - DETTE ER STAGING')` og et loft over antallet af brugere. `anonymize_rehearsal.sql` rører ingen data, men **installerer** et skema og en funktion, der bliver stående — derfor hører den til her og ikke i `sql/checks/`. Skal produktionen aflæses, er det `checks/league_admin_coverage.sql` |

Filerne i `sql/dev/` pastes i editoren ligesom migreringerne og er derfor
dækket af den samme vagt mod psql-kommandoer (`migration_syntax.test.js`).

---

## Filoversigt og kørerækkefølge

Rækkefølgen er den, filerne blev kørt i, og den, en frisk database skal bruge.
Skal et miljø bygges op fra bunden, er `schema.sql` genvejen (den indeholder
slutresultatet af det hele) — listen her er til at forstå *hvorfor* skemaet ser ud,
som det gør, og til at undgå at køre en gammel fil oven i en nyere.

| # | Fil | Formål | Status |
|---|---|---|---|
| — | `schema.sql` | **Genereret** øjebliksbillede af hele `public`. Kør den i et nyt/staging-projekt i stedet for hele listen | Redigér aldrig i hånden. 🛑 **Filen kan ikke pastes direkte i SQL-editoren.** 16 linjer skal ud først, i fire slags: `\restrict`/`\unrestrict` (psql-**meta**-kommandoer fra `pg_dump` 17.5+ → `42601`), `CREATE SCHEMA public;` (findes i forvejen i et friskt projekt → `42P06`), `COMMENT ON SCHEMA public` (ejerskab, forebyggende) og de 12 `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` til sidst (editorens session er ikke medlem af rollen → `42501`; samme begrænsning som advarslen øverst i denne fil). Opskriften — én `sed` — og hvad man gør, hvis kørslen døde midtvejs (filen er **ikke** idempotent), står i [`../docs/STAGING.md`](../docs/STAGING.md) trin 2 |
| 0 | `rating_core.sql` | `pc_points()`, `round_key()`, `recompute_ratings()` + tabellerne `ratings`/`rating_history` | Aktiv — **skal køres før #5**. Tilføjet 30. juli 2026 med optimeringen fra samme dag (logistikken i `double precision`, ~175× hurtigere). **Skal gen-køres efter #20** (31. juli 2026, A17): `_rs` joiner nu `seasons`/`leagues` og tæller kun **officielle** turneringer. ⚠️ **Gen-kørslen ændrer kun funktionen, ikke tallene** — `ratings` står uændret, til noget kalder `recompute_ratings()`. Tryk "Opdater ratings" i Admin bagefter, ellers ligger de gamle tal og venter på næste kampresultat. ~~**SKAL gen-køres igen efter `G68`**~~ **gen-kørt 5. august 2026** (`G68`): `rnk` rangerer nu på `score desc, exacts desc` og ikke på score alene, og ejeren har trykket "Opdater ratings" bagefter, så de gemte værdier faktisk er regnet om. Samme forbehold som ovenfor — gen-kørslen ændrer kun funktionen, og de gemte `rnk`-værdier i `rating_history` flytter sig først, når `recompute_ratings()` faktisk kører (næste resultatændring eller "Opdater ratings"). ⚠️ **Filen har CRLF i funktionskroppene med vilje** (`G5`, `.gitattributes`) — kopiér den ordret ind i SQL-editoren, og lad være med at køre den gennem et værktøj, der normaliserer linjeskift |
| 1 | `standings_views.superseded.sql` | Første udgave af `round_standings` + `season_standings` | ⚠️ **Afløst af `standings_tiebreakers.sql`** — kør den aldrig. Omdøbt 30. juli 2026, så filnavnet selv advarer; kun bevaret for historikken |
| 2 | `user_stats.sql` | `user_activity_days`, `touch_activity()`, `admin_user_stats()` | Aktiv |
| 3 | `username_constraints.sql` | Hele §6-løftet om et brugernavn: længde-constraint (2–20), det unikke indeks `profiles_display_name_lower_idx` og `username_available()` | Aktiv — **kørt 5. august 2026** (no-op: objekterne stod der i forvejen). Idempotent. **De to sidste kom til august 2026 (`G63`)**: de fandtes indtil da kun i den genererede `schema.sql`, så et skema bygget fra `sql/`-scripterne lod to brugere hedde det samme og manglede signup-tjekket. Hullet var i **gendannelsesvejen**, ikke i produktion, hvor objekterne står. Dækket af `sql/tests/username_constraints.sql` i CI |
| 4 | `predictions_round_lock_policies.sql` | Runde-baseret lås på `predictions` for **SELECT + DELETE** | ⚠️ **Afløst af #25** — kør den aldrig igen. En gen-kørsel ruller tavst låsen tilbage fra kamp til runde |
| 5 | `rating_trigger_optimization.sql` | Statement-level triggere på `matches`; kalder `recompute_ratings()` + `generate_stories()` | Aktiv — forudsætter `rating_core.sql` (#0) |
| 6 | `matches_stage.sql` | `matches.stage_name` (grundspil/slutspil) | Aktiv |
| 7 | `push_notifications.sql` | `push_subscriptions` + `notification_log` | Aktiv |
| 8 | `story_engine.sql` | `stories` + `generate_stories()` (viewet `latest_story` flyttede til #38 med v2) | Aktiv — ~~v1.1 skal gen-køres i produktion~~ **gen-kørt 31. juli 2026** (både v1.1's 14 regler og `scope = 'ALL'`-filtreringen efter #20). Kun funktionen ændres, tabel og view er uændrede. **v1.2 gen-kørt 3. august 2026** (`B10`): to nye regler (`AWARD_WEEK`, `AWARD_MONTH`) læser `competition_awards`, og regel 70 tier, hvor en kåring dækker. Forudsætter #26. Dækket af `sql/tests/story_engine_awards.sql` i CI. **v1.3 gen-kørt 4. august 2026** (navneskiftet til Leagly): regel 10's overskrift hedder nu "Månedens Champion" og er dermed byte-identisk med skabelonen i `src/lib/stories.js`. Kun funktionen ændres, som ved de to foregående gen-kørsler. **v2 (august 2026): SKAL gen-køres efter #37 og #38** — `delete`en er nu periode-afgrænset (`and period = 'round'`), og `_se_rp` læser viewet `competition_match_points`. Uden gen-kørslen sletter runde-motoren hele ugens dagskort ved hver resultatændring. **`latest_story` er samtidig fjernet fra filen** og bor nu kun i #38: filen gen-køres rutinemæssigt, og en `create or replace view` med den korte kolonneliste kan ikke erstatte v2's længere — gen-kørslen fejlede med `42P16: cannot drop columns from view`, netop når man fulgte den dokumenterede rækkefølge |
| 9 | `groups.sql` | Liga-laget: `groups`, `group_members`, `is_group_member()`, `move_competition_to_group()` | ⚠️ Aktiv, men **to af dens policies er afløst** — se advarslen nedenfor |
| 10 | `career_profile.sql` | `career_profile(profile_user_id)` | Aktiv — ~~gen-kør efter #20~~ **gen-kørt 31. juli 2026**: rundesejre og "bedste runde" filtrerer nu `scope = 'ALL'` (ellers tælles hver sejr én gang pr. turnering), og samme kørsel gav `titles.by_tournament` (K2). ~~**SKAL gen-køres igen efter `G62`**~~ **gen-kørt 5. august 2026** (`G62`): de tre GLOBALE komplethedsjoin (månedstitel, rundesejre, "bedste runde") grupperede `matches` uden join til `seasons`/`leagues`, mens pointene ved siden af kom fra `scope = 'ALL'`, som kun tæller officielle — så én uspillet **uofficiel** kamp kunne tilbageholde en global titel, brugeren havde vundet. Kun funktionen ændres. Verificeret mod PostgreSQL 16.13 med negativ kontrol: samme data gav 0 rundesejre/0 månedstitler før og 1/1 efter |
| 11 | `live_scores.sql` | `matches.live_*`-kolonner + live-indekser | Aktiv |
| 12 | `standings_tiebreakers.sql` | Genskaber alle tre stillings-views med `outcome_count`, `round_wins`, `avg_goal_error` | Aktiv — **afløser #1** |
| 13 | `group_membership_invariant.sql` | A8 i databasen: backfill, auto-indmeldende trigger, strammet liga-exit + framelding | Aktiv — **afløser to policies fra #9** |
| 14 | `predictions_write_lock.sql` | Runde-låsen også på **INSERT + UPDATE**; rydder den gamle `"read predictions"` op | ⚠️ **Afløst af #25** — kør den aldrig igen, af samme grund som #4 |
| 15 | `story_engine_backfill.sql` | Kalder `generate_stories()` for alle fuldt afsluttede runder | **Engangs-/ad hoc-kørsel**, ikke en migrering. Kør efter #8, når nye regler skal gælde bagud |
| 16 | `analytics_events.sql` | Analytics v1: `analytics_events` (hændelseslog), RLS (kun INSERT, egne rækker), indekser, hændelseskatalog-constraint | Aktiv — kør én gang, gen-kør kun ved ny event i kataloget |
| 17 | `analytics_dashboard.sql` | Analytics v1: tre views (`analytics_match_locks`, `analytics_round_locks`, `analytics_completion_facts`) + seks dashboard-RPC'er (`admin_analytics_health/engagement/league_health/retention/funnel/stories`) + gaten `analytics_require_admin()` | Aktiv — **sikker og forventet at blive gen-kørt**. **Gen-kør efter 30. juli 2026-omlægningen** (Liga Health Score fjernet, `admin_analytics_league_health` returnerer nu signaler i stedet for en score) sammen med frontend-mergen; en gammel klient mod en ny RPC — eller omvendt — viser en tom liga-sektion, ikke forkerte tal |
| 18 | `job_runs.sql` | Overvågning: tabellen `job_runs`, `admin_job_health()` og `prune_job_runs()` | Aktiv — tilføjet 30. juli 2026 |
| 19 | `cleanup_orphans.sql` | Fjerner `trg_recompute_ratings()`, `leagues.country` og `seasons.end_date` | **Engangs-oprydning**, men idempotent. Filen dokumenterer også, hvad der bevidst IKKE blev fjernet, og hvorfor |
| 20 | `tournament_scope.sql` | `leagues.is_official` + `round_standings`/`monthly_standings` med **scope** (samlet + pr. turnering) | Aktiv — **afløser de to views i #12**. **Kørt 31. juli 2026**, sammen med #8 og #10, som filtrerer `scope = 'ALL'` og derfor ikke må stå tilbage i en ældre udgave |
| 21 | `tournament_scotland_premiership.sql` | Turnering #2 (`B2`): `leagues`- + `seasons`-rækken for Scotland Premiership (`501`) | **Data, ikke skema** — ændrer intet i strukturen og indgår derfor ikke i `schema.sql`. Idempotent, og en gen-kørsel rører hverken `is_visible`, `is_official` eller `live_enabled`. **Kørt 31. juli 2026**, og cron-jobbet er oprettet (job #5 i [`../docs/CRON.md`](../docs/CRON.md)); `B2` er lukket 2. august 2026. **Forudsætter #20 og #22**, som begge har højere nummer end den selv: filen satte oprindeligt ingen af de tre nyere kolonner og fik dem med `G65` (august 2026), fordi `is_official` ellers defaultede til `true` og gjorde skabelonen forkert (§10). Bygges skemaet op fra scripterne frem for fra `schema.sql`, skal #20 og #22 altså køres før denne |
| 22 | `multi_provider.sql` | Flere datakilder: `leagues.provider` + `leagues.live_enabled` + check-constraint | Aktiv — tilføjet 31. juli 2026. **Ændrer ingen eksisterende rækkers adfærd**: begge kolonner har en default (`'sportmonks'`, `true`), der beskriver verden før migreringen. Skal køres FØR #23 |
| 23 | `tournament_footballdata.sql` | De fem football-data.org-turneringer: `leagues`- + `seasons`-rækker for Premier League (`PL`), Champions League (`CL`), Bundesliga (`BL1`), Serie A (`SA`), Primera División (`PD`) | **Data, ikke skema** — indgår derfor ikke i `schema.sql`. Idempotent, og en gen-kørsel rører hverken `is_visible` eller `is_official`, så en turnering, der er tændt manuelt, ikke slukkes igen. Forudsætter #22 |
| 25 | `predictions_match_lock.sql` | **Per-kamp-lås** (`A21`): alle fire `predictions`-policies + `comp_participants_delete_own_unlocked`. En kamp låser 1 time før sit EGET kickoff | Aktiv — **afløser #4 og #14**. Idempotent. **Adfærdsændring i produktion:** en runde, der er låst i dag, får sine senere kampe åbnet igen i samme øjeblik. Kør derfor MELLEM to runder, ikke midt i en |
| 24 | `tournament_footballdata_promote.sql` | Sætter `is_visible` + `is_official` = true på de fem football-data-turneringer (A19) | **Data, ikke skema.** Idempotent. **Kørt 31. juli 2026.** Begge kolonner sættes i SAMME update med vilje — check-constrainten `leagues_official_implies_visible` afviser en officiel turnering, ingen kan se, så to adskilte sætninger ville fejle på den første. Scotland Premiership er bevidst ikke med; den forfremmes, når dens igangværende spillerunde er talt op |
| 26 | `competition_awards.sql` | Lokale kåringer (I13/A22): tabellen `competition_awards` + SECURITY DEFINER-RPC'en `award_competition_periods()` ("Ugens/Månedens bedste" i en opt-in-konkurrence) | Aktiv — tilføjet 1. august 2026. Idempotent. Ingen skrive-policies: funktionen er den eneste skriver, klienten trigger den ved board-åbning. **Skal køres FØR frontend-mergen** — omvendt degraderer boardet blot til en tom kåringssektion |
| 27 | `security_hardening.sql` | Sikkerhedsstramning (G14/G15/G16): `matches` bliver admin-only at skrive i, `recompute_ratings()` bliver service_role-only med wrapperen `admin_recompute_ratings()`, og `monthly_standings` får `security_invoker` | Aktiv — tilføjet august 2026. Idempotent. **Ændrer ingen tal og intet, brugerne ser** — kun hvem der må skrive og læse. **Skal køres FØR frontend-mergen:** Admin-skærmens "Opdater ratings" kalder herefter `admin_recompute_ratings`, som først findes med denne migrering. Forudsætter #0, #5 og #20 |
| 28 | `matches_kickoff_tbd.sql` | **"Tid ikke fastlagt"**: kolonnen `matches.kickoff_tbd` + låsen samlet i `public.match_lock_at()`/`match_locked()`, som alle fem policies og `analytics_match_locks` nu kalder | Aktiv — tilføjet august 2026. Idempotent. **Afløser låseudtrykket i #25**, som stod 1:1 fem steder. **Ingen adfærdsændring ved kørsel:** kolonnen får `default false`, så udtrykket er bogstaveligt det gamle, indtil `sync-matches` har sat flaget — derfor behøver den *ikke* køres mellem to runder. Skal køres FØR frontend-mergen; ellers viser klienten stadig pladsholder-tider. Forudsætter #25 |
| 29 | `feedback.sql` | Feedback fra brugerne (`B14`): tabellen `feedback` + RPC'erne `admin_feedback()` og `admin_feedback_set_handled()` | Aktiv — tilføjet 2. august 2026. Idempotent. Ingen adfærdsændring for eksisterende data. **Skal køres FØR frontend-mergen** — omvendt får brugeren en fejl, når de trykker Send, og Admin → Feedback siger "Er sql/feedback.sql kørt?" |
| 30 | `api_id_uniqueness.sql` | Unique-constraints på leverandør-id'erne (`G7`): `leagues (provider, api_league_id)`, `seasons (league_id, api_season_id)`, `teams (league_id, api_team_id)` | Aktiv — tilføjet 2. august 2026. Idempotent. **Fejler højlydt, hvis der allerede findes dubletter** — det er med vilje, og fejlteksten nævner rækkerne. Ingen kodeændring hører til; se filens eget hoved for, hvorfor `api/sync-matches.js` bevidst IKKE er lavet om til et upsert |
| 31 | `account_anonymization.sql` | Luk din egen konto (`B4`): kolonnen `profiles.anonymized_at` + RPC'en `anonymize_my_account()` | Aktiv — tilføjet 3. august 2026. Idempotent. **Udvidet senere samme dag: nuller nu også `client_errors.user_id`** (#36 kom til efter filen, og politikken lover, at fejlrapporter mister koblingen) — **gen-kør filen i Supabase**, hvis den kun er kørt i den oprindelige form. **Funktionen har NUL parametre med vilje** — der findes ikke et bruger-id at forfalske. Den rører ikke `auth.users`; selve kontolukningen gør `api/delete-account.js` bagefter med service-nøglen. **Skal køres FØR frontend-mergen**, ellers fejler knappen. Går et forløb i stykker mellem de to trin, er bagstopperen manuel: find brugeren i Supabase → Authentication og slet den blødt dér; RPC'en er allerede kørt og er idempotent |
| 32 | `competitions_rules_cleanup.sql` | Fjerner den døde nøgle `openDaysBefore` fra `competitions.rules` (`G3`) | Aktiv — tilføjet og **kørt 3. august 2026**. Idempotent. **Den eneste fil i listen, det ikke gør nogen forskel at springe over:** ingen adfærdsændring, intet en bruger kan se, og ingen kode afhænger af den. Frontenden holdt op med at LÆSE `rules` i samme leverance, så nøglen er misvisende og ikke farlig. Kolonnen droppes bevidst ikke |
| 33 | `round_key_timezone.sql` | `round_key()` aflæser datoen i dansk tid frem for i sessionens (`G11`) | Aktiv — tilføjet og **kørt 3. august 2026**. Idempotent. **Flytter kun de rækker, den nye regel er uenig med** — i praksis forventeligt nul, da ingen af de syv turneringer spiller mellem midnat og 02.00 dansk tid; tællingen står i filens hoved. Rører den rækker, genberegner matches-triggeren rating og historier af sig selv, så kør den **mellem to runder**. Skal køres sammen med frontend-mergen: klienten regner fra samme dag efter `G32` |
| 34 | `anon_grants.sql` | Fjerner `anon`s tabel-privilegier i `public` og lukker kilden (Supabases default privileges) — `G50` | Aktiv — tilføjet og **kørt 3. august 2026**. Idempotent. **Ingen adfærdsændring for en indlogget bruger:** appen sender altid brugerens JWT (rollen `authenticated`), og det eneste kald før login rører en `SECURITY DEFINER`-funktion. Ændrer intet i RLS — den giver dybde, hvor policyen stod alene. Tilbagerulningen er to linjer og står i filen. Dækket af `sql/tests/anon_grants.sql` i CI |
| 35 | `predictions_updated_at.sql` | Trigger, så `predictions.updated_at` flytter sig ved en RETTELSE (`G13`) | Aktiv — tilføjet 3. august 2026. Idempotent. **Ændrer, hvad to Analytics-tal måler:** "Aktive konkurrencer/ligaer" og retention tæller fra nu af også rettede tips, altså aktivitet frem for kun afgivne tips. Måle-ordbogen er rettet i samme ombæring. En gen-skrivning af samme score flytter intet. Dækket af `sql/tests/predictions_updated_at.sql` i CI |
| 36 | `client_errors.sql` | Fejltelemetri for frontenden (`G42`): tabellen `client_errors`, `admin_client_errors()` og `prune_client_errors()` | Aktiv — tilføjet 3. august 2026. Idempotent. **Skal køres FØR frontend-mergen** — ellers fejler hver rapportering tavst (den er fire-and-forget, så brugeren mærker intet, men sporet er væk). Samme RLS-form som #29: kun insert, kun egne rækker, ingen select. Dækket af `sql/tests/client_errors.sql` i CI |
| 37 | `story_engine_v2_day.sql` | Story Engine v2, trin 1: `match_day()` + den genererede kolonne `matches.match_day`, `match_day_complete()`, `round_key_of_date()` og viewet `competition_match_points` | Aktiv — tilføjet august 2026. Idempotent. **KØR MELLEM TO RUNDER:** `ADD COLUMN … GENERATED … STORED` omskriver hele `matches` under en ACCESS EXCLUSIVE-lås (tabel-omskrivninger udløser dog IKKE triggere, så rating og historier genberegnes ikke). Skal køres FØR #38. `round_key_of_date()` findes, fordi `round_key(dag::timestamptz)` ville genindføre `G11` ad bagvejen — `date → timestamptz` læser sessionens tidszone |
| 38 | `story_engine_v2.sql` | Story Engine v2, trin 2: `stories.period` + `day_key`, to partielle unique-indexes, `latest_story` pinnet til runde-kort, `generate_daily_stories()` og `generate_stories_catchup()` | Aktiv — tilføjet august 2026. Idempotent. Forudsætter #37. **Gen-kør #8 bagefter** (dens `delete` er nu periode-afgrænset). **Kør pre-flight-forespørgslen i filens hoved først:** den gamle samlede constraint droppes, og index-oprettelsen fejler højlydt, hvis der findes dubletter. Bagudkompatibel for frontenden, så den kan køres FØR mergen. Dækket af `sql/tests/story_engine_daily.sql` i CI |
| 39 | `milestones.sql` | Milepæle: tabellen `milestones` (engangs-bedrifter), viewet `competition_status` og `award_milestones()` | Aktiv — tilføjet august 2026. Idempotent og **sikker at gen-køre** — hver skrivning er `on conflict do nothing`. Forudsætter #37. Ingen skrive-policies: funktionen er eneste skriver (trigger + notifikations-jobbet). **Skal køres FØR frontend-mergen** — ellers viser karriereprofilen ingen milepæle. **En uddelt milepæl kan aldrig trækkes tilbage**, heller ikke hvis en resultatrettelse sænker peak under tærsklen; se filens hoved. Dækket af `sql/tests/milestones.sql` i CI |
| — | `milestones_cleanup_v1_1.sql` | Sletter `COMP_COMEBACK` og `SEASONS_2/3` og uddeler dem forfra | **Engangskørsel** efter en gen-kørsel af #39. To regler uddelte milepæle for noget, der ikke kunne være sket: comeback i en konkurrence med én runde, og "to sæsoner" for to TURNERINGER i samme sæson. At slette her modsiger ikke tabellens frosne semantik — den beskytter mod datakorrektioner, ikke mod en regel, der aldrig var sand |
| — | `story_engine_v2_measure.sql` | Måler `generate_daily_stories()` mod referencen `recompute_ratings()`, plus regel 140 isoleret | **Ad hoc-værktøj**, ikke en migrering og ikke en engangskørsel — kør den igen, hver gang en turnering kommer til. Dagsmotoren kører SYNKRONT inde i den sætning, `api/sync-live.js` bruger til at afslutte en kamp, så spørgsmålet er ikke "hvor mange ms", men "koster den mere end det, triggeren allerede betaler". Regenererer kun dage UDEN FOR den aktuelle runde, så ingen brugers karrusel ændrer sig. Handlingsgrænserne står i filens hoved, og filen regner selv dommen ud i sidste række. **Svaret kommer som en TABEL og ikke som `raise notice`** — Supabases editor viser resultatrækker, ikke serverens NOTICE-beskeder, så en notice-baseret måling svarer "Success. No rows returned" og fortæller intet |
| 40 | `story_engine_v2_backfill.sql` | Kalder `generate_daily_stories()` for hver færdigspillet dag og `award_milestones(null)` én gang | **Engangs-/ad hoc-kørsel**, ikke en migrering. Kør efter #37–#39 og gen-kørslen af #8. Tager tid — den regner hele historikken igennem. Kør uden for en kampdag. Fremdriften meldes med `raise notice` frem for `\timing`: **ingen fil i `sql/` må indeholde psql-kommandoer**, da Supabases editor ikke kender dem — bevogtet af `sql/migration_syntax.test.js` |
| 41 | `season_end.sql` | Sæsonen får en slutning: `seasons.ends_at` + `seasons.is_finished`, og **`competition_status` v2**, hvor en sæson først er færdig, når den selv siger det | Aktiv — tilføjet august 2026, **kørt 5. august 2026**. Idempotent. **Redefinerer `competition_status` fra #39** — kør denne fil igen, hvis #39 nogensinde køres på ny. **Kan køres FØR frontend-mergen:** kolonnerne er additive, og viewets kolonner er uændrede. **Har én synlig følge på kørselsdagen:** alle eksisterende sæsoner har `ends_at = null` og `is_finished = false`, så en netop afsluttet konkurrence først melder sig færdig, når sidste kickoff er 30 dage gammel — eller straks, når sync/Drift har sat flaget. Det er den rigtige retning: for tidligt er uopretteligt, for sent er ikke. Dækket af `sql/tests/competition_status.sql` i CI |
| 42 | `liga_admin.sql` | Hvad en administrator må: tre RLS-policies (liga-admin fjerner en deltager **uden tips**, sletter en konkurrence **uden tips**, sletter en liga uden **aktive** konkurrencer) + `_anonymize_account()`/`admin_anonymize_account()` | Aktiv — tilføjet august 2026, **kørt 5. august 2026**. Idempotent. Forudsætter #41 (liga-sletningen læser `competition_status.concluded`) og **#28** (frameldingen nedenfor kalder `match_locked()`). **AFLØSER `groups_delete_admin_empty` fra `groups.sql`.** `anonymize_my_account()` beholder sin nul-parameter-signatur; kun kroppen er flyttet til den ikke-grantede `_anonymize_account(uuid)`, som begge indgange kalder. 🔴 **SKAL GEN-KØRES efter `A36`/`A37` (7. august 2026):** `_anonymize_account()` har fået tre trin mere efter A25-frameldingen — **overdrag** administratorrollen til det ældste levende medlem (`group_members.joined_at`), **forlad** de ligaer uden en tilbageværende deltagelse, og **degradér** rollen til `member`, hvor medlemskabet bliver stående. Uden overdragelsen kan en liga, hvis eneste administrator lukker sin konto, aldrig administreres igen (aflæst i produktion 7. august: én liga stod allerede sådan). **Filen bærer også en engangs-backfill**, der gør det samme for de konti, der allerede var lukket, da reglen blev skrevet — den er idempotent og konvergerer, så en gen-kørsel er et no-op. Kør FØR næste kontolukning; der er ingen frontend-ændring at merge sammen med. ✅ **Gen-kørt 5. august 2026 efter `A25`:** `_anonymize_account()` melder nu den lukkede konto af de konkurrencer, der **ikke er begyndt** — ingen låst eller spillet kamp — og kun når der er mindst én anden deltager tilbage. Alt, der er spillet, bevares uændret. Kun funktionen ændres; ingen eksisterende rækker blev rørt af kørslen, og der findes i dag nul lukkede konti at ramme. **Skal køres FØR frontend-mergen** — ellers fejler Admin → Brugere og liga-siden bliver ved at melde "kunne ikke". Dækket af `sql/tests/liga_admin.sql` i CI |
| 43 | `anon_grants_finish.sql` | `anon` mister også **sekvenserne**, og kilden til dem lukkes (`G58`) | Aktiv — **kørt 5. august 2026**. Idempotent. Anden halvdel af #34, som kun dækkede tabellerne: ordet "tables" stod tre steder i formuleringen, så `job_runs_id_seq` og begge `on sequences`-defaults blev aldrig rørt. **Lukker intet kendt hul** — `anon` har ingen INSERT på `job_runs` — men fjerner en uenighed mellem #34s påstand og skema-eksporten. ⚠️ `supabase_admin`-delen kan formentlig ikke køres fra SQL-editoren; se filens hoved for, hvad der så gælder. Dækket af `sql/tests/anon_grants_finish.sql` i CI |
| 44 | `tournament_superliga.sql` | Turnering #1: `leagues`- + `seasons`-rækken for Superligaen (`271`, Sportmonks) | **Data, ikke skema** — indgår derfor ikke i `schema.sql`. Idempotent, og **i produktion et no-op**: rækkerne står der. Filen findes for de databaser, hvor de ikke gør — staging ([`../docs/STAGING.md`](../docs/STAGING.md) trin 3) og en gendannelse fra repoet alene. Superligaen blev oprettet i hånden i juli 2026, før skabelonerne fandtes, og var indtil august 2026 den eneste af de syv turneringer uden fil. **Sæsonens navn og id er tomme parametre**, som skal udfyldes før kørsel i en tom database — de skifter hvert år og kunne ikke verificeres, da filen blev skrevet; blokken stopper med en læsbar fejl frem for at skrive en halv sæson. Forudsætter #20 og #22 |
| 45 | `recompute_derived.sql` | Samlet genberegning af alt afledt (`G83`): `recompute_derived()` + admin-wrapperen `admin_recompute_derived()` — rating → historier → kåringer → milepæle → milepæls-kort, i dén rækkefølge | Aktiv — tilføjet 7. august 2026. Idempotent og **sikker at køre når som helst**; den kalder kun funktioner, der i forvejen er idempotente. **Ændrer intet i sig selv** — den er en genberegning, ikke en migrering, og findes for gendannelsen: `docs/RESTORE.md` scenarie 1 foreskriver `--disable-triggers` og efterlod indtil da alt det udledte forkert uden at sige det. Returnerer én række pr. trin, så en kørsel kan læses bagefter; et trin, der fejler, tager ikke resten med. **Rækkefølgen er bindende** — `apply_milestone_stories()` efter `award_milestones()`, som i kaldelisten i `api/send-notifications.js`. Dækket af `sql/tests/rating_freshness.sql` i CI |
| 46 | `analytics_retention.sql` | Loft over hændelsesloggen (`G77`): `prune_analytics_events(18)` | Aktiv — tilføjet 7. august 2026. Idempotent. **Skal køres FØR næste heartbeat-kørsel** — `.github/workflows/job-heartbeat.yml` kalder funktionen ved siden af `prune_job_runs(30)` og `prune_client_errors(90)`, og et kald mod en funktion, der ikke findes, gør trinnet rødt. **Første kørsel kan fjerne mange rækker**; kør forespørgsel 2 i filens verifikationsblok først, hvis du vil vide hvor mange. `analytics_events.sql` (#16) beskrev indtil da rydningen som manuel — den linje er rettet i samme ombæring, og spec'ens arkitekturvalg #3 er uændret, fordi der ikke oprettes et nyt job. Dækket af `sql/tests/analytics_retention.sql` i CI |

### ⚠️ Ni filer må ikke gen-køres blindt

Alle syv bruger `drop policy … create policy` / `drop view … create view`, så en
gen-kørsel **erstatter tavst** en nyere definition med en ældre. Der kommer ingen
fejl — reglen bliver bare den gamle igen.

> **Er det allerede sket?** Rettelsen er at køre den *nyere* fil bagefter, ikke at
> gendanne data — de er der jo stadig. Parrene står samlet som scenarie 3 i
> [`../docs/RESTORE.md`](../docs/RESTORE.md); begrundelsen for hvert par står her.
> Har migreringen derimod ændret **data**, er det scenarie 1 samme sted.

- **`predictions_match_lock.sql`** (#25) genskaber alle fem policies med låsen skrevet
  i hånden som `kickoff_at <= now() + interval '1 hour'` og taber dermed
  `kickoff_tbd`: en kamp, hvis klokkeslæt ikke er fastlagt, låser igen kl. 01.00 om
  natten i stedet for ved midnat på spilledagen — og klienten, som følger den nye
  regel, vil være uenig med serveren. Filen er stadig den bedste beskrivelse af
  *hvorfor* låsen følger kampen, men selve udtrykket bor nu i
  `public.match_lock_at()`. **Skal `predictions_match_lock.sql` køres, så kør
  `matches_kickoff_tbd.sql` (#28) umiddelbart efter.** *(Tilføjet august 2026.)*

- **`standings_tiebreakers.sql`** genskaber `round_standings` og `monthly_standings` i deres udgave **uden `scope`**. En gen-kørsel efter `tournament_scope.sql` (#20) fjerner scope-kolonnen tavst: Championship-fanen viser tomme stillinger, fordi den beder om `scope=eq.ALL`, og `career_profile`/`story_engine` fejler på det samme filter. `season_standings` i filen er derimod stadig den gældende udgave. **Kør altid `tournament_scope.sql` bagefter.** *(Tilføjet 31. juli 2026.)* **Siden august 2026 er der to ting at miste:** filens `monthly_standings` er også uden `security_invoker`, så en gen-kørsel genåbner G16 — den uautentificerede læsning af per-bruger månedspoint. `tournament_scope.sql` bagefter lukker begge dele på én gang.
- **`groups.sql`** genskaber `group_members_delete_self` og
  `comp_participants_delete_own_unlocked` i deres **oprindelige** form og ruller
  dermed A8-invarianten tilbage: man kan igen forlade en liga, mens man deltager i
  dens konkurrencer (forældreløse deltagere), og framelding bliver igen permanent
  spærret efter første spillede runde. Skal `groups.sql` køres, så kør
  **`group_membership_invariant.sql` umiddelbart efter**. *(August 2026: der er nu
  en tredje ting at miste — filens `groups_delete_admin_empty` kræver NUL
  konkurrencer og afløser dermed `liga_admin.sql`s regel om nul **aktive**. Kør
  `liga_admin.sql` bagefter i samme ombæring.)*

- **`milestones.sql`** (#39) genskaber `competition_status` i sin **v1**-form, hvor
  en sæson er "færdigspillet", så snart dens kendte kampe har resultat. En
  gen-kørsel efter `season_end.sql` (#41) fjerner altså tavst sæson-gaten — og
  symptomet er præcis det, gaten findes for: en "hel sæson"-konkurrence bliver
  afsluttet med pokal, vinder og **permanente milepæle**, mens slutspillet endnu
  ikke er skemalagt. Milepælen kan ikke trækkes tilbage bagefter. **Kør altid
  `season_end.sql` umiddelbart efter.** *(Tilføjet august 2026.)*

- **`account_anonymization.sql`** (#31) genskaber `anonymize_my_account()` med
  kroppen skrevet ind i funktionen igen og ruller dermed opdelingen i
  `liga_admin.sql` (#42) tilbage. ⚠️ **Den var den mildeste af de ni indtil
  `A25` (5. august 2026), og det er den ikke længere:** filens gamle krop melder
  ikke den lukkede konto af de konkurrencer, der ikke er begyndt, så en
  gen-kørsel af #31 alene efterlader den egne vej med den *forkerte* adfærd —
  mens `admin_anonymize_account()` beholder den rigtige, fordi
  `_anonymize_account()` står urørt. To indgange, der gør forskellige ting, er
  præcis det, opdelingen fandtes for at forhindre. Det var i øvrigt den
  forudsagte konsekvens: "den næste tabel, der skal ryddes, bliver kun tilføjet
  det ene af dem". **Kør `liga_admin.sql` bagefter.** *(Tilføjet august 2026,
  skærpet 5. august 2026.)*
- **`standings_views.superseded.sql`** genskaber `round_standings`/`season_standings` **uden**
  tiebreaker-kolonnerne. Kør `standings_tiebreakers.sql` efter — eller lad være med
  at røre filen; den er kun bevaret for historikken.
- **`predictions_round_lock_policies.sql`** (#4) genskaber SELECT- og DELETE-policyen
  på `predictions` med den gamle **runde-baserede** lås og ruller dermed to af de fem
  per-kamp-policies fra `predictions_match_lock.sql` (#25) tilbage. "Kør aldrig igen"
  pr. sin egen tabelrække — skal den alligevel køres, så kør #25 (og #28) umiddelbart
  efter.
- **`predictions_write_lock.sql`** (#14) gør det samme for INSERT- og UPDATE-policyen:
  en gen-kørsel ruller per-kamp-låsen tilbage til runde-lås. "Kør aldrig igen" af samme
  grund som #4 — rettelsen er igen #25 (og #28) bagefter.

- **`story_engine_v2.sql`** (#38) dropper og genskaber `latest_story`. Efter en
  fremtidig ændring af viewet ruller en gen-kørsel den tavst tilbage — kolonne-
  rækkefølgen er samtidig bindende (`day_key`/`period` står SIDST, så viewet kan
  udvides med `create or replace` uden at skulle droppes igen). Den gen-skaber
  desuden de to partielle unique-indexes; det er harmløst, men den dropper først
  den gamle samlede constraint, og **dropper man den, uden at indexene bliver
  oprettet, står `stories` uden sikkerhedsnet mod dubletter**. *(Tilføjet august
  2026.)*

  Bemærk til gengæld, at `generate_stories()` **bevidst ikke** har en kopi i denne
  fil: den blev redigeret i #8 i stedet. En forældet kopi af netop den funktion
  ville være den farligste landmine i repoet — dens `delete` er periode-afgrænset,
  og uden afgrænsningen tørrer runde-motoren hele ugens dagskort væk.

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

**`sql/tests/security_hardening.sql`** (samme CI-job, egen database) kører
migreringen `security_hardening.sql` mod et minimalt skema og efterprøver de tre
huller i BEGGE retninger: at `anon` og en almindelig indlogget bruger er lukket
ude af `matches`, `recompute_ratings()` og `monthly_standings` — og at admin,
rating-triggeren og `service_role` stadig kommer igennem. Testen ruller bevidst
de to kildefiler tilbage til deres sårbare form først, så den måler et skifte og
ikke bare en tilstand.

To detaljer er værd at kende, hvis testen skal udvides. En **UPDATE**, hvis
`using`-udtryk er falsk, rammer nul rækker og kaster **ingen** fejl — RLS
filtrerer i stedet for at afvise, så en test, der kun spørger "kastede den?",
ville rapportere en blokeret skrivning som gennemført. Derfor sammenlignes der på
rækketal (`OK:0` mod `OK:1`). Og en **funktions-revoke** skal ramme pseudorollen
`PUBLIC`: Postgres giver som standard `EXECUTE` til `PUBLIC` på hver ny funktion,
og `anon` arver den, så `revoke … from anon` alene lukker ingenting.

**Roller er cluster-brede, ikke database-lokale** — og det gælder alle tre tests.
CI kører dem mod SAMME postgres-service i hver sin database, så `anon`,
`authenticated` og `service_role` deles på tværs, og den test, der kører først,
bestemmer deres egenskaber. Et `if not exists … create role service_role
bypassrls` er derfor ikke nok: kører `rating_equivalence.sql` først (det gør
den), findes rollen allerede uden `bypassrls`, og blokken springer tavst over.
Sæt egenskaber ubetinget med `alter role`. Fælden er usynlig lokalt, hvis man
kører sin egen test først — den blev fanget i CI og ikke på maskinen.

**`sql/tests/competition_awards.sql`** (samme CI-job, egen database) kører selve
migreringen `competition_awards.sql` mod et minimalt skema og efterprøver
kåringsreglerne: en færdigspillet runde/afsluttet måned kåres, en ufærdig gør
ikke, delt sejr giver én række pr. vinder, et ikke-deltagende tip kan aldrig
vinde, en fremmed kalder skriver intet, andet kald er et no-op, og
`service_role` må kalde uden at være deltager. `auth.uid()`/`auth.role()`
stubbes med session-GUC'er (`test.uid`/`test.role`), så testen kan skifte
"kalder" undervejs.

**`sql/tests/feedback.sql`** (samme CI-job, egen database) kører migreringen
`feedback.sql` mod et minimalt skema og efterprøver adgangen fra begge sider: en
bruger kan skrive sin egen melding og kun sin egen, INGEN bruger kan læse
tabellen (heller ikke sin egen række — der findes ingen select-policy), `anon`
kan hverken læse eller skrive, de to check-constraints afviser en ukendt type og
en for kort/lang besked, og begge admin-RPC'er svarer `forbidden` til en
ikke-admin. Sidste punkt er, at en slettet konto efterlader meldingen — den
`on delete set null`, kolonnen har.

**`sql/tests/api_id_uniqueness.sql`** (samme CI-job, egen database) er skrevet
for ét punkt frem for de andre: at de tre **lovlige** gentagelser stadig er
lovlige. Samme klub i to turneringer (Arsenal i PL og i CL, begge `fd:57`),
samme `api_season_id` i flere turneringer (`'2026'` i alle fem
football-data-turneringer) og samme `api_league_id` hos to leverandører. En
global unique — som `G7` oprindeligt var formuleret — ville have afvist alle
tre, og Champions League kunne da ikke synkroniseres. At dubletter afvises,
ville et hvilket som helst unique-indeks bestå; kun det rigtige omfang består
den første halvdel. Kørslen støjer bevidst med to forventede fejl til sidst
(vagten mod dubletter, der findes i forvejen).

**`sql/tests/account_anonymization.sql`** (samme CI-job, egen database) kører
migreringen `account_anonymization.sql` mod et minimalt skema og efterprøver den
påstand, hele valget af anonymisering frem for sletning hviler på: at brugerens
**tips, rating, ratinghistorik og kåringer står uændret**, at de stadig er
deltager og ligamedlem, og at **den liga, de oprettede, findes med alle sine
medlemmer**. En rigtig sletning ville have kaskaderet ligaen væk via
`groups.created_by` og dermed opløst fællesskabet for alle andre. Dertil: at
funktionen har nul parametre (den mekaniske udgave af "kan ikke ramme en anden
bruger"), at brugssporet er væk, at feedback-rækken overlever uden afsender, at
en anden bruger er urørt, og at andet kald er et no-op.

**`sql/tests/story_engine_daily.sql`** (samme CI-job, egen database) dækker Story
Engine v2's dagsmotor. To af påstandene er værd at kende:

Den vigtigste er ikke, at reglerne virker, men at **runde-motoren ikke sletter
dagskort**. De to motorer deler tabel og `round_key`, og v1's uafgrænsede `delete
… where round_key = p_round_key` ville tørre hele ugen væk ved hver
resultatændring — og kortene genskabes aldrig, fordi dagsmotoren kun kører, når
en dag *bliver* færdig.

Den anden er, at filen påstår et **ikke-nul rækkeantal**. Det er ikke pedanteri:
hele kæden ligger bag matches-triggerens exception-guard, og den mest sandsynlige
fejl — en `date`/`text`-sammenligning, jf. de tre nøgletyper i `stories` — fejler
TAVST. Uden den påstand ville en motor, der intet producerer, være grøn i CI.

**`sql/tests/story_engine_scale.sql`** er ikke en test, men et **lokalt
benchmark** — den påstår ingenting og kører ikke i CI. Den bygger en syntetisk
fuld sæson (1800 kampe, 40 spillere, 33.000 faktarækker) og måler, hvad
motorerne koster, når datamængden er den, produktionen har om ni måneder.
Baggrunden: den første produktionsmåling gav 23 ms, men databasen indeholdt 18
spillede kampe — betryggende og uden informationsværdi. Forsøget flyttede
mistanken fra `STREAK_STATUS` (2,5 ms) til `award_milestones()` (1.087 ms,
heraf 726 i `COMP_COMEBACK`) og førte til, at milepælene blev taget ud af
matches-triggeren. **Kør den igen, hver gang en motor får en ny regel.**

**`sql/tests/milestones.sql`** vogter de guards, der gør en milepæl noget værd:
feltstørrelse på ranglisten ("top 3 af 3" må ikke uddeles), peak frem for
nuværende rating, ≥5 kampe for en perfekt runde, og at en konkurrence, der stadig
kan vokse, ikke meldes færdig. En uddelt milepæl kan ikke tages tilbage, så en
fejl her er ikke til at rette bagefter.

**`sql/tests/story_engine_awards.sql`** (samme CI-job, egen database) kører
`rating_core.sql`, `competition_awards.sql` og `story_engine.sql` i én tom
database og efterprøver kæden fra kåringsrække til historie-kort (Story Engine
v1.2's regler `AWARD_WEEK`/`AWARD_MONTH`, `B10`). Kæden fejler TAVST i
produktion — matches-triggeren er exception-guarded — så testen er det eneste
sted, et manglende kort bliver rødt.

**`sql/tests/client_errors.sql`** (samme CI-job, egen database) kører migreringen
`client_errors.sql` (#36) og efterprøver begge retninger: en bruger kan skrive
sin egen fejlrapport og ikke andres, og INGEN kan læse tabellen uden om den
admin-gatede RPC `admin_client_errors()`.

**`sql/tests/predictions_updated_at.sql`** (samme CI-job, egen database)
efterprøver triggeren fra `predictions_updated_at.sql` (#35): `updated_at`
flytter sig ved en rettelse. En manglende trigger er usynlig — feltet har en
default, så en frisk række ser rigtig ud, og fejlen ville ellers først vise sig
som et Analytics-tal, der er lidt for lavt.

**`sql/tests/anon_grants.sql`** (samme CI-job, egen database) kører migreringen
`anon_grants.sql` (#34) og efterprøver begge halvdele: at `anon` mister
tabel-adgangen i `public`, og at kilden (Supabases default privileges) er
lukket, så en tabel oprettet bagefter heller ikke får den. Den anden halvdel er
den, der betyder noget på sigt — bredden var en regel og ikke en liste.

**`sql/tests/docs_sql.mjs`** (samme CI-job, egen database) er jobbets eneste
trin, der ikke tester en migrering, men **dokumentationen** (`G74`). Hver
` ```sql `-blok i `docs/` bygges om til et `prepare` mod hele `schema.sql`, så
PostgreSQL selv siger, om forespørgslen kunne køre — `prepare` uden `execute`
rører ingen rækker, så også et `update` i et dokument er ufarligt at tjekke.

Baggrunden er `B12`, hvis forespørgsel stod to døgn som "klar til at køre" og
blev afvist med `42803`, første gang nogen prøvede. **Et rent syntakstjek ville
ikke have fanget den:** fejlen opstår i parse-analysen og kræver, at serveren
kender tabellerne — derfor `schema.sql` og ikke et tomt skema. Prisen er, at
tjekket arver denne fils advarsel om, at `schema.sql` kun er sand efter en
eksport; en blok mod en ueksporteret kolonne fejler, og fejlen ser ud som
blokkens, selv om den er eksportens.

En blok, der ikke er en hel sætning (et skema-udkast, en `join`-linje), markeres
` ```sql uddrag ` og springes over — **opt-out og ikke opt-in**, så en ny
forespørgsel er dækket, fordi nogen skrev den, og ikke fordi nogen huskede en
markør. De sprungne tælles op med navn i CI-loggen. Udtrækkerens egne
afvisninger er dækket af `sql/tests/docs_sql.test.mjs` i `npm test`.

Testene kan køres lokalt mod enhver tom database:

```bash
createdb ratingtest && createdb awardstest && createdb cetest && createdb putest && createdb anongrants && createdb storytest && createdb sectest && createdb fbtest && createdb idtest && createdb anontest && createdb docssql
cd sql/tests && psql -d ratingtest -v ON_ERROR_STOP=1 -b -f rating_equivalence.sql
psql -d awardstest -v ON_ERROR_STOP=1 -b -f competition_awards.sql
psql -d cetest -v ON_ERROR_STOP=1 -b -f client_errors.sql
psql -d putest -v ON_ERROR_STOP=1 -b -f predictions_updated_at.sql
psql -d anongrants -v ON_ERROR_STOP=1 -b -f anon_grants.sql
psql -d storytest -v ON_ERROR_STOP=1 -b -f story_engine_awards.sql
psql -d sectest -v ON_ERROR_STOP=1 -b -f security_hardening.sql
psql -d fbtest -v ON_ERROR_STOP=1 -b -f feedback.sql
psql -d idtest -v ON_ERROR_STOP=1 -b -f api_id_uniqueness.sql
psql -d anontest -v ON_ERROR_STOP=1 -b -f account_anonymization.sql
# docs/-blokkene: udtrækkeren skriver hele kørslen, psql udfører den
node docs_sql.mjs > /tmp/docs_sql.gen.sql && psql -d docssql -v ON_ERROR_STOP=1 -f /tmp/docs_sql.gen.sql
```

`predictions_round_lock_policies.sql` er IKKE en mild undtagelse, selv om den kun
rører SELECT/DELETE: en gen-kørsel ruller tavst de to policies tilbage fra
per-kamp-låsen (#25) til runde-lås — se listen over de seks filer ovenfor.

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
