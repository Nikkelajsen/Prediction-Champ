# `sql/` — skema, migreringer og eksport

Denne mappe indeholder de SQL-scripts, der definerer og udvider produktionsskemaet
(`public`) i Supabase. De enkelte `*.sql`-filer er **migreringer**, kørt manuelt i
Supabase SQL-editor med **"Run without RLS"** (scripterne sætter selv RLS på de
tabeller, der skal have det — jf. `DOCUMENTATION.md` afsnit 13). Alle er idempotente
og kan køres igen.

`schema.sql` er en **genereret** fuld-skema-eksport — et øjebliksbillede af hele
`public`-skemaet, som det så ud ved seneste eksport. Den redigeres aldrig i hånden;
den regenereres med guiden nedenfor.

> 🔶 **Øjebliksbilledet er ÆLDRE END PRODUKTIONEN: `#56` og `#57` er kørt
> 12. august 2026 og står ikke i filen — kør skema-eksporten.** Indtil da
> mangler dumpet `create_group()` og bærer `anon`s gamle funktions-grants.
> **CI er efterprøvet fra begge sider** og er grøn både mod det nuværende dump
> og mod et, hvor de to migreringer er kørt; det gælder alle elleve tests, der
> indlæser filen.
>
> 🔴 **`#58` (`G98`) er lagt til og kørt samme dag**; den er den tredje, dumpet
> mangler, indtil eksporten kører igen. Også den er efterprøvet fra begge sider — de fjorten skema-indlæsende
> tests er grønne både mod det nuværende dump og mod et, hvor `#58` er kørt.
> **Den efterprøvning fandt en rigtig fejl** i `sql/tests/create_group.sql`s
> negative kontrol, som hentede en ligas id med et opslag, den smalnede policy
> gør tomt: kontrollen ville være blevet et tavst no-op i det sekund eksporten
> kørte. Se §13-reglen om tests, der læser deres før-tilstand af et snapshot. Uden den efterprøvning ville `sql/tests/anon_grants_functions.sql`
> være blevet rød af, at arbejdet lykkedes — se dens egen før-blok.
>
> ✅ **Forrige friske øjebliksbillede: 5. august 2026 (efter #0's gen-kørsel).**
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
> **Funktionerne fulgte efter 12. august 2026 (`G96`, `#56`):** `anon` kan
> herefter nøjagtig TO — `username_available()` (oprettelsen) og
> `invite_preview()` (`I7` — invitationens etiket) — hvor den før kunne nå dem
> alle. Indtil da var vagten `if auth.uid() is null then raise 'forbidden'` inde
> i hver funktion **bærende og ikke en dobbeltsikring**; nu afviser
> rettighedssystemet allerede kaldet. `sql/tests/invite_preview.sql` måler
> stadig vagten som ADFÆRD, og det er stadig den rigtige måde — de to lag skal
> begge holde, og en test på grants alene ville måle noget andet, end den tror.
>
> 🔴 **FUNKTIONER HAR ÉN REGEL, TABELLER OG SEKVENSER IKKE HAR — læs den, før du
> skriver en ny funktion i `public`.** `#34` og `#43` kunne lukke kilden helt,
> fordi default privileges var det eneste, der gav `anon` adgang til en ny tabel
> eller sekvens. For funktioner giver PostgreSQL som **indbygget** default
> EXECUTE til PUBLIC — og PUBLIC er enhver rolle, også `anon`. Den post kan
> **ikke** fjernes med `ALTER DEFAULT PRIVILEGES`: `pg_default_acl` gemmer kun
> tillægget, de to flettes ved oprettelsen, og fletningen kan kun lægge til
> (efterprøvet mod PostgreSQL 16.13). Derfor:
>
> > **Hver ny funktion i `public` skal selv bære `revoke execute on function …
> > from public;` FØR sin `grant execute … to <roller>;`.**
>
> Konventionen findes allerede i de fleste migreringer (`#31`, `#36`, `#42`,
> `#46`, `#52`, `#54`, `#57`), men den er nu et krav og ikke en vane. **En
> gen-kørsel er ufarlig** — `create or replace function` bevarer ACL'en, så de
> filer, der gen-køres rutinemæssigt, ikke åbner noget igen — men **`drop
> function` + `create function` nulstiller den** og giver den indbyggede default
> tilbage. Begge dele efterprøvet mod PostgreSQL 16.13. Vagten er
> `sql/tests/anon_grants_functions.sql`, som måler HELE skemaet — `anon` skal
> kunne nøjagtig to funktioner — og bliver rød ved den første, der glemmer
> linjen. Det er den halvdel af `#56`, databasen ikke kan bære selv.
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
| `sql/tests/` | SQL-testene, som CI's `sql`-job kører mod en rigtig PostgreSQL. **To af dem er ikke tests af én migrering, men af en EGENSKAB ved hele skemaet.** [`anon_grants_functions.sql`](./tests/anon_grants_functions.sql) (`G96`) vogter LÆSE-/kaldefladen for `anon`: at der findes nøjagtig to funktioner i `public`, en fremmed uden login kan kalde. Den påstand håndhæver en regel, databasen ikke kan bære selv — PUBLIC's indbyggede EXECUTE på nye funktioner kan ikke lukkes ved kilden — så den bliver rød ved den første migrering, der glemmer sin `revoke execute … from public`. **Den måler dog `sql/schema.sql` og dermed et øjebliksbillede;** siden `G100` stiller [`checks/anon_routine_reach.sql`](./checks/anon_routine_reach.sql) den samme regel mod den levende database hver halve time. Og [`write_surface.sql`](./tests/write_surface.sql) vogter, hvad en indlogget bruger kan skrive — fortegnelsen over skrive-policies, at ingen skrivbar view mangler `security_invoker`, `profiles`' kolonneliste og tyve fjendtlige skrivninger. Den er revisionen efter `B29` skrevet som en påstand, så en ny `grant` eller policy ikke kan udvide fladen ubemærket | Af CI. Bruger `\ir`/`\set` med vilje og kan derfor **ikke** pastes i SQL-editoren |
| `sql/checks/` | **Overvågning**, ikke migreringer. Fem filer: [`kickoff_coverage.sql`](./checks/kickoff_coverage.sql) (`G84`), som spørger, om de nært forestående kampe har et rigtigt klokkeslæt — og siden `G85` også, om det er BEKRÆFTET, hvilket var den halvdel, den var blind for i præcis de tre turneringer, fejlen ramte; [`league_admin_coverage.sql`](./checks/league_admin_coverage.sql) (`A37`), som spørger, om hver liga stadig har en administrator, der kan logge ind; [`rating_freshness.sql`](./checks/rating_freshness.sql) (`G83`), som spørger, om den gemte rating stadig passer til de data, den er udledt af; [`day_card_coverage.sql`](./checks/day_card_coverage.sql) (`A38`), som spørger, om en færdigspillet kampdag fik sit dagskort — og siden `G92` også det modsatte, om en dag, der stadig spilles, har fået et, den ikke skulle have; og [`anon_routine_reach.sql`](./checks/anon_routine_reach.sql) (`G100`), som spørger, om `anon` kan nå noget i `public` ud over de to tilladte funktioner — **den eneste af de fem, der dømmer en RETTIGHED og ikke data**, og den, der giver `G96`s regel en vagt mod PRODUKTIONEN frem for mod dumpet. Alle fem opretter en **temporær** view og installerer derfor intet — de lever kun i den psql-session, der læser dem. **Alle fem har en test i `sql/tests/` og et CI-trin** (de fire siden `G93`, 9. august 2026; den femte kom med sin egen); dagskort-kontrollen var den sidste uden, og det var netop derfor, den kunne stå grøn, mens reglen bag den fejlede | Mod produktion med `psql "$SUPABASE_DB_URL" -f …` (kickoff-, rating- og anon-kontrollen desuden af `job-heartbeat.yml` hver halve time), og i CI mod en tom database af den tilsvarende fil i `sql/tests/`. **Samme fil begge steder** — det er hele grunden til, at de er filer og ikke heredocs i en workflow. **Det er dén form, en forespørgsel skal have, før den må køres mod produktion** |
| `sql/dev/` | Værktøjer til **staging**, ikke migreringer. To filer: [`simulate_season.sql`](./dev/simulate_season.sql), som spiller en hel sæson igennem for testbrugerne — tips, resultater, stillinger, rating, historier og kåringer — i sin EGEN turnering, som ingen synkronisering kan røre (**dækket af `sql/tests/simulate_season.sql` i CI siden `G82`, 7. august 2026** — den er jobbets tungeste trin og kører mod det rigtige skema, fordi filen rører hele kæden på én gang); og [`anonymize_rehearsal.sql`](./dev/anonymize_rehearsal.sql) (`G76`), som stiller kontolukningens kontrakt op som før/efter, så man kan se, hvad den gør, før den køres på et menneske | I hånden i staging-projektets SQL-editor. 🛑 **Ingen af dem i produktion.** `simulate_season.sql` er selv låst med `sim.arm('JA - DETTE ER STAGING')` og et loft over antallet af brugere. `anonymize_rehearsal.sql` rører ingen data, men **installerer** et skema og en funktion, der bliver stående — derfor hører den til her og ikke i `sql/checks/`. Skal produktionen aflæses, er det `checks/league_admin_coverage.sql` |

Filerne i `sql/dev/` pastes i editoren ligesom migreringerne og er derfor
dækket af den samme vagt mod psql-kommandoer (`migration_syntax.test.js`).

---

## Filoversigt og kørerækkefølge

Rækkefølgen er den, filerne blev kørt i, og den, en frisk database skal bruge.
Skal et miljø bygges op fra bunden, er `schema.sql` genvejen (den indeholder
slutresultatet af det hele) — listen her er til at forstå *hvorfor* skemaet ser ud,
som det gør, og til at undgå at køre en gammel fil oven i en nyere.

> **📍 Hvad `#56` betyder — og hvorfor tallet står alle vegne.** Tallet i første
> kolonne herunder ER migreringens navn. Hele dokumentationen henviser til
> filerne på den måde (`#34`, `#52`, `#56`), fordi et nummer overlever, at en fil
> omdøbes, og fordi rækkefølgen er det, der gør en migrering farlig eller
> harmløs. **Numrene genbruges og omnummereres ALDRIG** — derfor står `#47`
> mellem `#48` og `#49` i kørerækkefølgen (se dens egen række), og derfor er
> `#1`, `#4` og `#14` stadig i tabellen, selvom de aldrig må køres igen.
>
> **Slå et nummer op sådan her:** filnavnene i kolonne 2 er links, så ét klik
> åbner selve migreringen. De to nyeste er
> [`#56 anon_grants_functions.sql`](./anon_grants_functions.sql) og
> [`#57 create_group.sql`](./create_group.sql).
>
> ⚠️ **Tabellen er sorteret efter nummer og ikke efter dato.** Et højt nummer
> betyder "kom sent til LISTEN", ikke nødvendigvis "kørt sidst" — `#47` er det
> stående eksempel.

| # | Fil | Formål | Status |
|---|---|---|---|
| — | [`schema.sql`](./schema.sql) | **Genereret** øjebliksbillede af hele `public`. Kør den i et nyt/staging-projekt i stedet for hele listen | Redigér aldrig i hånden. 🛑 **Filen kan ikke pastes direkte i SQL-editoren.** 16 linjer skal ud først, i fire slags: `\restrict`/`\unrestrict` (psql-**meta**-kommandoer fra `pg_dump` 17.5+ → `42601`), `CREATE SCHEMA public;` (findes i forvejen i et friskt projekt → `42P06`), `COMMENT ON SCHEMA public` (ejerskab, forebyggende) og de 12 `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` til sidst (editorens session er ikke medlem af rollen → `42501`; samme begrænsning som advarslen øverst i denne fil). Opskriften — én `sed` — og hvad man gør, hvis kørslen døde midtvejs (filen er **ikke** idempotent), står i [`../docs/STAGING.md`](../docs/STAGING.md) trin 2 |
| 0 | [`rating_core.sql`](./rating_core.sql) | `pc_points()`, `round_key()`, `recompute_ratings()` + tabellerne `ratings`/`rating_history` | Aktiv — **skal køres før #5**. Tilføjet 30. juli 2026 med optimeringen fra samme dag (logistikken i `double precision`, ~175× hurtigere). **Skal gen-køres efter #20** (31. juli 2026, A17): `_rs` joiner nu `seasons`/`leagues` og tæller kun **officielle** turneringer. ⚠️ **Gen-kørslen ændrer kun funktionen, ikke tallene** — `ratings` står uændret, til noget kalder `recompute_ratings()`. Tryk "Opdater ratings" i Admin bagefter, ellers ligger de gamle tal og venter på næste kampresultat. ~~**SKAL gen-køres igen efter `G68`**~~ **gen-kørt 5. august 2026** (`G68`): `rnk` rangerer nu på `score desc, exacts desc` og ikke på score alene, og ejeren har trykket "Opdater ratings" bagefter, så de gemte værdier faktisk er regnet om. Samme forbehold som ovenfor — gen-kørslen ændrer kun funktionen, og de gemte `rnk`-værdier i `rating_history` flytter sig først, når `recompute_ratings()` faktisk kører (næste resultatændring eller "Opdater ratings"). ⚠️ **Filen har CRLF i funktionskroppene med vilje** (`G5`, `.gitattributes`) — kopiér den ordret ind i SQL-editoren, og lad være med at køre den gennem et værktøj, der normaliserer linjeskift |
| 1 | [`standings_views.superseded.sql`](./standings_views.superseded.sql) | Første udgave af `round_standings` + `season_standings` | ⚠️ **Afløst af `standings_tiebreakers.sql`** — kør den aldrig. Omdøbt 30. juli 2026, så filnavnet selv advarer; kun bevaret for historikken |
| 2 | [`user_stats.sql`](./user_stats.sql) | `user_activity_days`, `touch_activity()`, `admin_user_stats()` | Aktiv |
| 3 | [`username_constraints.sql`](./username_constraints.sql) | Hele §6-løftet om et brugernavn: længde-constraint (2–20), det unikke indeks `profiles_display_name_lower_idx` og `username_available()` | Aktiv — **kørt 5. august 2026** (no-op: objekterne stod der i forvejen). Idempotent. **De to sidste kom til august 2026 (`G63`)**: de fandtes indtil da kun i den genererede `schema.sql`, så et skema bygget fra `sql/`-scripterne lod to brugere hedde det samme og manglede signup-tjekket. Hullet var i **gendannelsesvejen**, ikke i produktion, hvor objekterne står. Dækket af `sql/tests/username_constraints.sql` i CI |
| 4 | [`predictions_round_lock_policies.sql`](./predictions_round_lock_policies.sql) | Runde-baseret lås på `predictions` for **SELECT + DELETE** | ⚠️ **Afløst af #25** — kør den aldrig igen. En gen-kørsel ruller tavst låsen tilbage fra kamp til runde |
| 5 | [`rating_trigger_optimization.sql`](./rating_trigger_optimization.sql) | Statement-level triggere på `matches`; kalder `recompute_ratings()` + `generate_stories()` | Aktiv — forudsætter `rating_core.sql` (#0) |
| 6 | [`matches_stage.sql`](./matches_stage.sql) | `matches.stage_name` (grundspil/slutspil) | Aktiv |
| 7 | [`push_notifications.sql`](./push_notifications.sql) | `push_subscriptions` + `notification_log` | Aktiv |
| 8 | [`story_engine.sql`](./story_engine.sql) | `stories` + `generate_stories()` (viewet `latest_story` flyttede til #38 med v2) | Aktiv — ~~v1.1 skal gen-køres i produktion~~ **gen-kørt 31. juli 2026** (både v1.1's 14 regler og `scope = 'ALL'`-filtreringen efter #20). Kun funktionen ændres, tabel og view er uændrede. **v1.2 gen-kørt 3. august 2026** (`B10`): to nye regler (`AWARD_WEEK`, `AWARD_MONTH`) læser `competition_awards`, og regel 70 tier, hvor en kåring dækker. Forudsætter #26. Dækket af `sql/tests/story_engine_awards.sql` i CI. **v1.3 gen-kørt 4. august 2026** (navneskiftet til Leagly): regel 10's overskrift hedder nu "Månedens Champion" og er dermed byte-identisk med skabelonen i `src/lib/stories.js`. Kun funktionen ændres, som ved de to foregående gen-kørsler. **v2 (august 2026): SKAL gen-køres efter #37 og #38** — `delete`en er nu periode-afgrænset (`and period = 'round'`), og `_se_rp` læser viewet `competition_match_points`. Uden gen-kørslen sletter runde-motoren hele ugens dagskort ved hver resultatændring. **`latest_story` er samtidig fjernet fra filen** og bor nu kun i #38: filen gen-køres rutinemæssigt, og en `create or replace view` med den korte kolonneliste kan ikke erstatte v2's længere — gen-kørslen fejlede med `42P16: cannot drop columns from view`, netop når man fulgte den dokumenterede rækkefølge |
| 9 | [`groups.sql`](./groups.sql) | Liga-laget: `groups`, `group_members`, `is_group_member()`, `move_competition_to_group()` | ⚠️ Aktiv, men **to af dens policies er afløst** — se advarslen nedenfor |
| 10 | [`career_profile.sql`](./career_profile.sql) | `career_profile(profile_user_id)` | Aktiv — ~~gen-kør efter #20~~ **gen-kørt 31. juli 2026**: rundesejre og "bedste runde" filtrerer nu `scope = 'ALL'` (ellers tælles hver sejr én gang pr. turnering), og samme kørsel gav `titles.by_tournament` (K2). ~~**SKAL gen-køres igen efter `G62`**~~ **gen-kørt 5. august 2026** (`G62`): de tre GLOBALE komplethedsjoin (månedstitel, rundesejre, "bedste runde") grupperede `matches` uden join til `seasons`/`leagues`, mens pointene ved siden af kom fra `scope = 'ALL'`, som kun tæller officielle — så én uspillet **uofficiel** kamp kunne tilbageholde en global titel, brugeren havde vundet. Kun funktionen ændres. Verificeret mod PostgreSQL 16.13 med negativ kontrol: samme data gav 0 rundesejre/0 månedstitler før og 1/1 efter |
| 11 | [`live_scores.sql`](./live_scores.sql) | `matches.live_*`-kolonner + live-indekser | Aktiv |
| 12 | [`standings_tiebreakers.sql`](./standings_tiebreakers.sql) | Genskaber alle tre stillings-views med `outcome_count`, `round_wins`, `avg_goal_error` | Aktiv — **afløser #1** |
| 13 | [`group_membership_invariant.sql`](./group_membership_invariant.sql) | A8 i databasen: backfill, auto-indmeldende trigger, strammet liga-exit + framelding | Aktiv — **afløser to policies fra #9** |
| 14 | [`predictions_write_lock.sql`](./predictions_write_lock.sql) | Runde-låsen også på **INSERT + UPDATE**; rydder den gamle `"read predictions"` op | ⚠️ **Afløst af #25** — kør den aldrig igen, af samme grund som #4 |
| 15 | [`story_engine_backfill.sql`](./story_engine_backfill.sql) | Kalder `generate_stories()` for alle fuldt afsluttede runder | **Engangs-/ad hoc-kørsel**, ikke en migrering. Kør efter #8, når nye regler skal gælde bagud |
| 16 | [`analytics_events.sql`](./analytics_events.sql) | Analytics v1: `analytics_events` (hændelseslog), RLS (kun INSERT, egne rækker), indekser, hændelseskatalog-constraint | Aktiv — kør én gang, gen-kør kun ved ny event i kataloget |
| 17 | [`analytics_dashboard.sql`](./analytics_dashboard.sql) | Analytics v1: tre views (`analytics_match_locks`, `analytics_round_locks`, `analytics_completion_facts`) + seks dashboard-RPC'er (`admin_analytics_health/engagement/league_health/retention/funnel/stories`) + gaten `analytics_require_admin()` | Aktiv — **sikker og forventet at blive gen-kørt**. **Gen-kør efter 30. juli 2026-omlægningen** (Liga Health Score fjernet, `admin_analytics_league_health` returnerer nu signaler i stedet for en score) sammen med frontend-mergen; en gammel klient mod en ny RPC — eller omvendt — viser en tom liga-sektion, ikke forkerte tal |
| 18 | [`job_runs.sql`](./job_runs.sql) | Overvågning: tabellen `job_runs`, `admin_job_health()` og `prune_job_runs()` | Aktiv — tilføjet 30. juli 2026 |
| 19 | [`cleanup_orphans.sql`](./cleanup_orphans.sql) | Fjerner `trg_recompute_ratings()`, `leagues.country` og `seasons.end_date` | **Engangs-oprydning**, men idempotent. Filen dokumenterer også, hvad der bevidst IKKE blev fjernet, og hvorfor |
| 20 | [`tournament_scope.sql`](./tournament_scope.sql) | `leagues.is_official` + `round_standings`/`monthly_standings` med **scope** (samlet + pr. turnering) | Aktiv — **afløser de to views i #12**. **Kørt 31. juli 2026**, sammen med #8 og #10, som filtrerer `scope = 'ALL'` og derfor ikke må stå tilbage i en ældre udgave |
| 21 | [`tournament_scotland_premiership.sql`](./tournament_scotland_premiership.sql) | Turnering #2 (`B2`): `leagues`- + `seasons`-rækken for Scotland Premiership (`501`) | **Data, ikke skema** — ændrer intet i strukturen og indgår derfor ikke i `schema.sql`. Idempotent, og en gen-kørsel rører hverken `is_visible`, `is_official` eller `live_enabled`. **Kørt 31. juli 2026**, og cron-jobbet er oprettet (job #5 i [`../docs/CRON.md`](../docs/CRON.md)); `B2` er lukket 2. august 2026. **Forudsætter #20 og #22**, som begge har højere nummer end den selv: filen satte oprindeligt ingen af de tre nyere kolonner og fik dem med `G65` (august 2026), fordi `is_official` ellers defaultede til `true` og gjorde skabelonen forkert (§10). Bygges skemaet op fra scripterne frem for fra `schema.sql`, skal #20 og #22 altså køres før denne |
| 22 | [`multi_provider.sql`](./multi_provider.sql) | Flere datakilder: `leagues.provider` + `leagues.live_enabled` + check-constraint | Aktiv — tilføjet 31. juli 2026. **Ændrer ingen eksisterende rækkers adfærd**: begge kolonner har en default (`'sportmonks'`, `true`), der beskriver verden før migreringen. Skal køres FØR #23 |
| 23 | [`tournament_footballdata.sql`](./tournament_footballdata.sql) | De fem football-data.org-turneringer: `leagues`- + `seasons`-rækker for Premier League (`PL`), Champions League (`CL`), Bundesliga (`BL1`), Serie A (`SA`), Primera División (`PD`) | **Data, ikke skema** — indgår derfor ikke i `schema.sql`. Idempotent, og en gen-kørsel rører hverken `is_visible` eller `is_official`, så en turnering, der er tændt manuelt, ikke slukkes igen. Forudsætter #22 |
| 25 | [`predictions_match_lock.sql`](./predictions_match_lock.sql) | **Per-kamp-lås** (`A21`): alle fire `predictions`-policies + `comp_participants_delete_own_unlocked`. En kamp låser 1 time før sit EGET kickoff | Aktiv — **afløser #4 og #14**. Idempotent. **Adfærdsændring i produktion:** en runde, der er låst i dag, får sine senere kampe åbnet igen i samme øjeblik. Kør derfor MELLEM to runder, ikke midt i en |
| 24 | [`tournament_footballdata_promote.sql`](./tournament_footballdata_promote.sql) | Sætter `is_visible` + `is_official` = true på de fem football-data-turneringer (A19) | **Data, ikke skema.** Idempotent. **Kørt 31. juli 2026.** Begge kolonner sættes i SAMME update med vilje — check-constrainten `leagues_official_implies_visible` afviser en officiel turnering, ingen kan se, så to adskilte sætninger ville fejle på den første. Scotland Premiership er bevidst ikke med; den forfremmes, når dens igangværende spillerunde er talt op |
| 26 | [`competition_awards.sql`](./competition_awards.sql) | Lokale kåringer (I13/A22): tabellen `competition_awards` + SECURITY DEFINER-RPC'en `award_competition_periods()` ("Ugens/Månedens bedste" i en opt-in-konkurrence) | Aktiv — tilføjet 1. august 2026. Idempotent. Ingen skrive-policies: funktionen er den eneste skriver, klienten trigger den ved board-åbning. **Skal køres FØR frontend-mergen** — omvendt degraderer boardet blot til en tom kåringssektion |
| 27 | [`security_hardening.sql`](./security_hardening.sql) | Sikkerhedsstramning (G14/G15/G16): `matches` bliver admin-only at skrive i, `recompute_ratings()` bliver service_role-only med wrapperen `admin_recompute_ratings()`, og `monthly_standings` får `security_invoker` | Aktiv — tilføjet august 2026. Idempotent. **Ændrer ingen tal og intet, brugerne ser** — kun hvem der må skrive og læse. **Skal køres FØR frontend-mergen:** Admin-skærmens "Opdater ratings" kalder herefter `admin_recompute_ratings`, som først findes med denne migrering. Forudsætter #0, #5 og #20 |
| 28 | [`matches_kickoff_tbd.sql`](./matches_kickoff_tbd.sql) | **"Tid ikke fastlagt"**: kolonnen `matches.kickoff_tbd` + låsen samlet i `public.match_lock_at()`/`match_locked()`, som alle fem policies og `analytics_match_locks` nu kalder | Aktiv — tilføjet august 2026. Idempotent. **Afløser låseudtrykket i #25**, som stod 1:1 fem steder. **Ingen adfærdsændring ved kørsel:** kolonnen får `default false`, så udtrykket er bogstaveligt det gamle, indtil `sync-matches` har sat flaget — derfor behøver den *ikke* køres mellem to runder. Skal køres FØR frontend-mergen; ellers viser klienten stadig pladsholder-tider. Forudsætter #25 |
| 29 | [`feedback.sql`](./feedback.sql) | Feedback fra brugerne (`B14`): tabellen `feedback` + RPC'erne `admin_feedback()` og `admin_feedback_set_handled()` | Aktiv — tilføjet 2. august 2026. Idempotent. Ingen adfærdsændring for eksisterende data. **Skal køres FØR frontend-mergen** — omvendt får brugeren en fejl, når de trykker Send, og Admin → Feedback siger "Er sql/feedback.sql kørt?" |
| 30 | [`api_id_uniqueness.sql`](./api_id_uniqueness.sql) | Unique-constraints på leverandør-id'erne (`G7`): `leagues (provider, api_league_id)`, `seasons (league_id, api_season_id)`, `teams (league_id, api_team_id)` | Aktiv — tilføjet 2. august 2026. Idempotent. **Fejler højlydt, hvis der allerede findes dubletter** — det er med vilje, og fejlteksten nævner rækkerne. Ingen kodeændring hører til; se filens eget hoved for, hvorfor `api/sync-matches.js` bevidst IKKE er lavet om til et upsert |
| 31 | [`account_anonymization.sql`](./account_anonymization.sql) | Luk din egen konto (`B4`): kolonnen `profiles.anonymized_at` + RPC'en `anonymize_my_account()` | Aktiv — tilføjet 3. august 2026. Idempotent. **Udvidet senere samme dag: nuller nu også `client_errors.user_id`** (#36 kom til efter filen, og politikken lover, at fejlrapporter mister koblingen) — **gen-kør filen i Supabase**, hvis den kun er kørt i den oprindelige form. **Funktionen har NUL parametre med vilje** — der findes ikke et bruger-id at forfalske. Den rører ikke `auth.users`; selve kontolukningen gør `api/delete-account.js` bagefter med service-nøglen. **Skal køres FØR frontend-mergen**, ellers fejler knappen. Går et forløb i stykker mellem de to trin, er bagstopperen manuel: find brugeren i Supabase → Authentication og slet den blødt dér; RPC'en er allerede kørt og er idempotent |
| 32 | [`competitions_rules_cleanup.sql`](./competitions_rules_cleanup.sql) | Fjerner den døde nøgle `openDaysBefore` fra `competitions.rules` (`G3`) | Aktiv — tilføjet og **kørt 3. august 2026**. Idempotent. **Den eneste fil i listen, det ikke gør nogen forskel at springe over:** ingen adfærdsændring, intet en bruger kan se, og ingen kode afhænger af den. Frontenden holdt op med at LÆSE `rules` i samme leverance, så nøglen er misvisende og ikke farlig. Kolonnen droppes bevidst ikke |
| 33 | [`round_key_timezone.sql`](./round_key_timezone.sql) | `round_key()` aflæser datoen i dansk tid frem for i sessionens (`G11`) | Aktiv — tilføjet og **kørt 3. august 2026**. Idempotent. **Flytter kun de rækker, den nye regel er uenig med** — i praksis forventeligt nul, da ingen af de syv turneringer spiller mellem midnat og 02.00 dansk tid; tællingen står i filens hoved. Rører den rækker, genberegner matches-triggeren rating og historier af sig selv, så kør den **mellem to runder**. Skal køres sammen med frontend-mergen: klienten regner fra samme dag efter `G32` |
| 34 | [`anon_grants.sql`](./anon_grants.sql) | Fjerner `anon`s tabel-privilegier i `public` og lukker kilden (Supabases default privileges) — `G50` | Aktiv — tilføjet og **kørt 3. august 2026**. Idempotent. **Ingen adfærdsændring for en indlogget bruger:** appen sender altid brugerens JWT (rollen `authenticated`), og det eneste kald før login rører en `SECURITY DEFINER`-funktion. Ændrer intet i RLS — den giver dybde, hvor policyen stod alene. Tilbagerulningen er to linjer og står i filen. Dækket af `sql/tests/anon_grants.sql` i CI |
| 35 | [`predictions_updated_at.sql`](./predictions_updated_at.sql) | Trigger, så `predictions.updated_at` flytter sig ved en RETTELSE (`G13`) | Aktiv — tilføjet 3. august 2026. Idempotent. **Ændrer, hvad to Analytics-tal måler:** "Aktive konkurrencer/ligaer" og retention tæller fra nu af også rettede tips, altså aktivitet frem for kun afgivne tips. Måle-ordbogen er rettet i samme ombæring. En gen-skrivning af samme score flytter intet. Dækket af `sql/tests/predictions_updated_at.sql` i CI |
| 36 | [`client_errors.sql`](./client_errors.sql) | Fejltelemetri for frontenden (`G42`): tabellen `client_errors`, `admin_client_errors()` og `prune_client_errors()` | Aktiv — tilføjet 3. august 2026. Idempotent. **Skal køres FØR frontend-mergen** — ellers fejler hver rapportering tavst (den er fire-and-forget, så brugeren mærker intet, men sporet er væk). Samme RLS-form som #29: kun insert, kun egne rækker, ingen select. Dækket af `sql/tests/client_errors.sql` i CI |
| 37 | [`story_engine_v2_day.sql`](./story_engine_v2_day.sql) | Story Engine v2, trin 1: `match_day()` + den genererede kolonne `matches.match_day`, `match_day_complete()`, `round_key_of_date()` og viewet `competition_match_points` | Aktiv — tilføjet august 2026. Idempotent. **KØR MELLEM TO RUNDER:** `ADD COLUMN … GENERATED … STORED` omskriver hele `matches` under en ACCESS EXCLUSIVE-lås (tabel-omskrivninger udløser dog IKKE triggere, så rating og historier genberegnes ikke). Skal køres FØR #38. `round_key_of_date()` findes, fordi `round_key(dag::timestamptz)` ville genindføre `G11` ad bagvejen — `date → timestamptz` læser sessionens tidszone |
| 38 | [`story_engine_v2.sql`](./story_engine_v2.sql) | Story Engine v2, trin 2: `stories.period` + `day_key`, to partielle unique-indexes, `latest_story` pinnet til runde-kort, `generate_daily_stories()` og `generate_stories_catchup()` | Aktiv — tilføjet august 2026. Idempotent. Forudsætter #37. **Gen-kør #8 bagefter** (dens `delete` er nu periode-afgrænset). **Kør pre-flight-forespørgslen i filens hoved først:** den gamle samlede constraint droppes, og index-oprettelsen fejler højlydt, hvis der findes dubletter. Bagudkompatibel for frontenden, så den kan køres FØR mergen. Dækket af `sql/tests/story_engine_daily.sql` i CI |
| 39 | [`milestones.sql`](./milestones.sql) | Milepæle: tabellen `milestones` (engangs-bedrifter), viewet `competition_status` og `award_milestones()` | Aktiv — tilføjet august 2026. Idempotent og **sikker at gen-køre** — hver skrivning er `on conflict do nothing`. Forudsætter #37. Ingen skrive-policies: funktionen er eneste skriver (trigger + notifikations-jobbet). **Skal køres FØR frontend-mergen** — ellers viser karriereprofilen ingen milepæle. **En uddelt milepæl kan aldrig trækkes tilbage**, heller ikke hvis en resultatrettelse sænker peak under tærsklen; se filens hoved. Dækket af `sql/tests/milestones.sql` i CI |
| — | [`milestones_cleanup_v1_1.sql`](./milestones_cleanup_v1_1.sql) | Sletter `COMP_COMEBACK` og `SEASONS_2/3` og uddeler dem forfra | **Engangskørsel** efter en gen-kørsel af #39. To regler uddelte milepæle for noget, der ikke kunne være sket: comeback i en konkurrence med én runde, og "to sæsoner" for to TURNERINGER i samme sæson. At slette her modsiger ikke tabellens frosne semantik — den beskytter mod datakorrektioner, ikke mod en regel, der aldrig var sand |
| — | [`story_engine_v2_measure.sql`](./story_engine_v2_measure.sql) | Måler `generate_daily_stories()` mod referencen `recompute_ratings()`, plus regel 140 isoleret | **Ad hoc-værktøj**, ikke en migrering og ikke en engangskørsel — kør den igen, hver gang en turnering kommer til. Dagsmotoren kører SYNKRONT inde i den sætning, `api/sync-live.js` bruger til at afslutte en kamp, så spørgsmålet er ikke "hvor mange ms", men "koster den mere end det, triggeren allerede betaler". Regenererer kun dage UDEN FOR den aktuelle runde, så ingen brugers karrusel ændrer sig. Handlingsgrænserne står i filens hoved, og filen regner selv dommen ud i sidste række. **Svaret kommer som en TABEL og ikke som `raise notice`** — Supabases editor viser resultatrækker, ikke serverens NOTICE-beskeder, så en notice-baseret måling svarer "Success. No rows returned" og fortæller intet |
| 40 | [`story_engine_v2_backfill.sql`](./story_engine_v2_backfill.sql) | Kalder `generate_daily_stories()` for hver færdigspillet dag og `award_milestones(null)` én gang | **Engangs-/ad hoc-kørsel**, ikke en migrering. Kør efter #37–#39 og gen-kørslen af #8. Tager tid — den regner hele historikken igennem. Kør uden for en kampdag. Fremdriften meldes med `raise notice` frem for `\timing`: **ingen fil i `sql/` må indeholde psql-kommandoer**, da Supabases editor ikke kender dem — bevogtet af `sql/migration_syntax.test.js` |
| 41 | [`season_end.sql`](./season_end.sql) | Sæsonen får en slutning: `seasons.ends_at` + `seasons.is_finished`, og **`competition_status` v2**, hvor en sæson først er færdig, når den selv siger det | Aktiv — tilføjet august 2026, **kørt 5. august 2026**. Idempotent. **Redefinerer `competition_status` fra #39** — kør denne fil igen, hvis #39 nogensinde køres på ny. **Kan køres FØR frontend-mergen:** kolonnerne er additive, og viewets kolonner er uændrede. **Har én synlig følge på kørselsdagen:** alle eksisterende sæsoner har `ends_at = null` og `is_finished = false`, så en netop afsluttet konkurrence først melder sig færdig, når sidste kickoff er 30 dage gammel — eller straks, når sync/Drift har sat flaget. Det er den rigtige retning: for tidligt er uopretteligt, for sent er ikke. Dækket af `sql/tests/competition_status.sql` i CI |
| 42 | [`liga_admin.sql`](./liga_admin.sql) | Hvad en administrator må: tre RLS-policies (liga-admin fjerner en deltager **uden tips**, sletter en konkurrence **uden tips**, sletter en liga uden **aktive** konkurrencer) + `_anonymize_account()`/`admin_anonymize_account()` | Aktiv — tilføjet august 2026, **kørt 5. august 2026**. Idempotent. Forudsætter #41 (liga-sletningen læser `competition_status.concluded`) og **#28** (frameldingen nedenfor kalder `match_locked()`). **AFLØSER `groups_delete_admin_empty` fra `groups.sql`.** `anonymize_my_account()` beholder sin nul-parameter-signatur; kun kroppen er flyttet til den ikke-grantede `_anonymize_account(uuid)`, som begge indgange kalder. 🔴 **SKAL GEN-KØRES efter `A36`/`A37` (7. august 2026):** `_anonymize_account()` har fået tre trin mere efter A25-frameldingen — **overdrag** administratorrollen til det ældste levende medlem (`group_members.joined_at`), **forlad** de ligaer uden en tilbageværende deltagelse, og **degradér** rollen til `member`, hvor medlemskabet bliver stående. Uden overdragelsen kan en liga, hvis eneste administrator lukker sin konto, aldrig administreres igen (aflæst i produktion 7. august: én liga stod allerede sådan). **Filen bærer også en engangs-backfill**, der gør det samme for de konti, der allerede var lukket, da reglen blev skrevet — den er idempotent og konvergerer, så en gen-kørsel er et no-op. Kør FØR næste kontolukning; der er ingen frontend-ændring at merge sammen med. ✅ **Gen-kørt 5. august 2026 efter `A25`:** `_anonymize_account()` melder nu den lukkede konto af de konkurrencer, der **ikke er begyndt** — ingen låst eller spillet kamp — og kun når der er mindst én anden deltager tilbage. Alt, der er spillet, bevares uændret. Kun funktionen ændres; ingen eksisterende rækker blev rørt af kørslen, og der findes i dag nul lukkede konti at ramme. **Skal køres FØR frontend-mergen** — ellers fejler Admin → Brugere og liga-siden bliver ved at melde "kunne ikke". Dækket af `sql/tests/liga_admin.sql` i CI |
| 43 | [`anon_grants_finish.sql`](./anon_grants_finish.sql) | `anon` mister også **sekvenserne**, og kilden til dem lukkes (`G58`) | Aktiv — **kørt 5. august 2026**. Idempotent. Anden halvdel af #34, som kun dækkede tabellerne: ordet "tables" stod tre steder i formuleringen, så `job_runs_id_seq` og begge `on sequences`-defaults blev aldrig rørt. **Lukker intet kendt hul** — `anon` har ingen INSERT på `job_runs` — men fjerner en uenighed mellem #34s påstand og skema-eksporten. ⚠️ `supabase_admin`-delen kan formentlig ikke køres fra SQL-editoren; se filens hoved for, hvad der så gælder. Dækket af `sql/tests/anon_grants_finish.sql` i CI |
| 44 | [`tournament_superliga.sql`](./tournament_superliga.sql) | Turnering #1: `leagues`- + `seasons`-rækken for Superligaen (`271`, Sportmonks) | **Data, ikke skema** — indgår derfor ikke i `schema.sql`. Idempotent, og **i produktion et no-op**: rækkerne står der. Filen findes for de databaser, hvor de ikke gør — staging ([`../docs/STAGING.md`](../docs/STAGING.md) trin 3) og en gendannelse fra repoet alene. Superligaen blev oprettet i hånden i juli 2026, før skabelonerne fandtes, og var indtil august 2026 den eneste af de syv turneringer uden fil. **Sæsonens navn og id er tomme parametre**, som skal udfyldes før kørsel i en tom database — de skifter hvert år og kunne ikke verificeres, da filen blev skrevet; blokken stopper med en læsbar fejl frem for at skrive en halv sæson. Forudsætter #20 og #22 |
| 45 | [`recompute_derived.sql`](./recompute_derived.sql) | Samlet genberegning af alt afledt (`G83`): `recompute_derived()` + admin-wrapperen `admin_recompute_derived()` — rating → historier → kåringer → milepæle → milepæls-kort, i dén rækkefølge | Aktiv — tilføjet 7. august 2026. Idempotent og **sikker at køre når som helst**; den kalder kun funktioner, der i forvejen er idempotente. **Ændrer intet i sig selv** — den er en genberegning, ikke en migrering, og findes for gendannelsen: `docs/RESTORE.md` scenarie 1 foreskriver `--disable-triggers` og efterlod indtil da alt det udledte forkert uden at sige det. Returnerer én række pr. trin, så en kørsel kan læses bagefter; et trin, der fejler, tager ikke resten med. **Rækkefølgen er bindende** — `apply_milestone_stories()` efter `award_milestones()`, som i kaldelisten i `api/send-notifications.js`. Dækket af `sql/tests/rating_freshness.sql` i CI |
| 46 | [`analytics_retention.sql`](./analytics_retention.sql) | Loft over hændelsesloggen (`G77`): `prune_analytics_events(18)` | Aktiv — tilføjet 7. august 2026. Idempotent. **Skal køres FØR næste heartbeat-kørsel** — `.github/workflows/job-heartbeat.yml` kalder funktionen ved siden af `prune_job_runs(30)` og `prune_client_errors(90)`, og et kald mod en funktion, der ikke findes, gør trinnet rødt. **Første kørsel kan fjerne mange rækker**; kør forespørgsel 2 i filens verifikationsblok først, hvis du vil vide hvor mange. `analytics_events.sql` (#16) beskrev indtil da rydningen som manuel — den linje er rettet i samme ombæring, og spec'ens arkitekturvalg #3 er uændret, fordi der ikke oprettes et nyt job. Dækket af `sql/tests/analytics_retention.sql` i CI |
| 47 | [`story_engine_v3.sql`](./story_engine_v3.sql) | Story Engine v3: ét dagskort pr. bruger pr. dag, valgt på `news_value` (grundvægt + størrelse + nærhed, tærskel 45) — `stories.news_value` + `stories_day_slot_uniq`, `generate_daily_stories()` skrevet forfra, `build_round_frames()` og `apply_milestone_stories()` | Aktiv — tilføjet 7. august 2026. Idempotent. **Nummeret er højere end #45–#46, men filen er ÆLDRE end dem** — den blev aldrig indført i denne tabel, og en omnummerering ville flytte de numre, resten af dokumentationen henviser til. Kør den før #45, som kalder `generate_stories_catchup()`. **Kør EFTER #37 og #38, og GEN-KØR bagefter #8** (runde-motoren kalder nu `build_round_frames`) **og `analytics_events.sql`** (tre nye eventnavne). Dækket af `sql/tests/story_engine_daily.sql` i CI. **Skal gen-køres ved hver ændring af dagsmotoren** — og filen er derfor den, der oftest står med et 🔴 i `docs/CHANGELOG.md`. ✅ **Gen-kørt 9. august 2026 i produktion OG staging (`G92`):** `generate_daily_stories()` har fået en tidlig udgang mere — `match_day_complete(p_day)`, placeret efter sidste-dag-udgangen og **før** `delete`. Kravet lå indtil da KUN i matches-triggeren (`rating_trigger_optimization.sql`), som bagstopperen `generate_stories_catchup()` i #38 pr. definition omgår, så én færdigspillet kamp kunne udløse hele dagens kort midt på kampdagen. **Kør INGEN andre filer for at levere den — særligt ikke #38**, hvis rettelse er ren kommentar og hvis gen-kørsel ville rulle hele denne fil tilbage (se advarslen længere nede). Kun funktionen ændres; ingen rækker røres, og et forkert kort, der allerede står, skrives forfra af dagens sidste resultat. Tidligere gen-kørsel: 8. august 2026 (mini-stillingen, `G88`) |
| 48 | [`story_engine_v3_cleanup.sql`](./story_engine_v3_cleanup.sql) | Dropper v2's dagsindeks `stories_day_uniq`, som #47's strengere `stories_day_slot_uniq` har afløst | **KØRES SIDST**, og rækkefølgen er bindende: #47 → gen-kør #8 → gen-kør `analytics_events.sql` → **deploy frontenden** → denne fil. Idempotent, og den sletter INGEN rækker — de historiske v2-dagskort (`news_value is null`) bliver stående som analysedata, fordi `A33`s måling hviler på dem |
| 49 | [`matches_kickoff_uncertain.sql`](./matches_kickoff_uncertain.sql) | "Klokkeslættet er ikke bekræftet" som egenskab ved kampen (`G85`): `matches.kickoff_prev_at` + `kickoff_uncertain`, triggeren `matches_remember_previous_kickoff` og `refresh_kickoff_uncertain()` | Aktiv — tilføjet 8. august 2026. 🔴 **SKAL KØRES FØR NÆSTE HEARTBEAT-KØRSEL.** `sql/checks/kickoff_coverage.sql` læser `matches.kickoff_uncertain`, og `job-heartbeat.yml` kører kontrollen mod produktion hvert 30. minut — findes kolonnen ikke, fejler trinnet med `42703` hver eneste gang. Samme forbehold som #46 (`analytics_retention.sql`), og af samme grund: koden i repoet og skemaet i Supabase skal følges ad, når en kontrol får en ny kolonne at læse. Idempotent og **sikker at gen-køre**: den rører hverken policies eller views, kun to `add column if not exists`, én trigger og én funktion. **Adfærdsændring ved kørsel: ingen** — begge kolonner starter tomme, og reglen kan først markere noget, når den har set tre kampe flytte sig fra samme klokkeslæt. Kaldes af `api/sync-matches` efter hver upsert; tallet står som `uncertainMarked` i Admin → Drift. Dækket af `sql/tests/kickoff_uncertain.sql` i CI, kørt mod det rigtige skema og efterprøvet med ni mutationer |
| 50 | [`competition_matches_read.sql`](./competition_matches_read.sql) | Læsepolicyen på `competition_matches` sagde ikke, hvad den mente (`G94`): tautologien `cp.competition_id = cp.competition_id` erstattes af `auth.role() = 'authenticated'` — samme regel som de fem nabotabeller | Aktiv — tilføjet 9. august 2026. Idempotent og **sikker at gen-køre**: den dropper og genskaber ÉN policy under samme navn og rører ingen rækker. 🔴 **Skal køres, før symptomet forsvinder** — indtil da ser en bruger uden en eneste deltagelse ligaens konkurrencekort som "0 kampe", fordi `competition_status` er en `security_invoker`-view oven på tabellen og derfor også er tom for hende. **Adfærdsændring ved kørsel: ja, og den er tilsigtet** — netop den bruger begynder at se rigtige tal; ingen mister adgang til noget. Der er ingen frontend-ændring at merge sammen med. **Policyen fandtes ikke i nogen migrering før denne fil** — den var lavet i hånden og levede kun i den genererede `schema.sql`, hvilket er anden halvdel af, hvorfor fejlen kunne stå. Dækket af `sql/tests/competition_matches_read.sql` i CI, kørt mod det rigtige skema og efterprøvet med seks mutationer |
| 51 | [`username_change.sql`](./username_change.sql) | Skift af brugernavn (`B29`): `profiles.display_name_changed_at`, triggeren `profiles_name_guard` (trimmer navnet ved hver skrivning, stempler et skift, låser en lukket kontos pseudonym) — og 🔴 **kolonne-privilegierne på `profiles`** | Aktiv — tilføjet og **kørt i staging og produktion 10. august 2026**. Idempotent og **sikker at gen-køre**: én kolonne, én trigger og to grants, ingen rækker røres. ~~🔴 SKAL KØRES FØR FRONTEND-MERGEN.~~ Uden den fejler navneskiftet, og — vigtigere — står hullet, filen lukker, stadig åbent: `grant all on profiles to authenticated` + policyen `update own profile` lod **enhver indlogget bruger sætte sin egen `is_admin`** og dermed passere admin-vagten i `admin_user_stats()`, `admin_feedback()`, `admin_client_errors()`, `admin_job_health()` og `admin_anonymize_account()`. En policy afgrænser rækken, ikke kolonnen. Efterprøvet mod `sql/schema.sql` i en PostgreSQL 16: `UPDATE 1` som rollen `authenticated`. **Adfærdsændring ved kørsel: ja, og den er tilsigtet** — `authenticated` må herefter kun skrive `id` og `display_name` på `profiles`. `id` skal med, fordi PostgREST's upsert oversættes til `on conflict do update set id = excluded.id, …`, og privilegiet kræves på hver kolonne i `set`-listen; uden den fejler oprettelsen af enhver ny profil. Får en fremtidig skærm brug for at skrive en ny kolonne som den indloggede bruger, skal kolonnen tilføjes i grant'en — fejlen er tydelig ("permission denied for table profiles") og er meningen. Dækket af `sql/tests/username_change.sql` i CI, kørt mod det rigtige skema og efterprøvet med otte mutationer. **Revisionen bagefter (10. august 2026) svarede, at `profiles` var det eneste sted, fejlklassen gjorde en forskel** — de øvrige 29 objekter med `grant all` er enten helt lukkede af RLS uden en skrive-policy eller scopet til `auth.uid()`/`created_by`/`is_admin`/`is_group_admin` — og svaret står som `sql/tests/write_surface.sql`, som vogter hele fladen |
| 52 | [`invite_lookup.sql`](./invite_lookup.sql) | **Trin 1 af 2** i `A40`: `invite_lookup()`, `accept_invite()` og `is_group_creator()` — alle tre `security definer`. Rører ingen policy | Aktiv — tilføjet 10. august 2026 og **kørt i staging og produktion 11. august 2026**. Idempotent. ✅ **Sikker at køre når som helst, også før frontend-mergen:** den TILFØJER kun og smalner intet, så den nuværende klient mærker ingenting, mens den nye allerede ville virke. **Adfærdsændring ved kørsel: ingen.** Hullet lukkes af #53 |
| 53 | [`invite_policies.sql`](./invite_policies.sql) | **Trin 2 af 2** i `A40`: de fire smalnede policies — `groups` og `competitions` kan kun læses af dem, der er med, `group_members` kan kun indsættes af opretteren, og deltagelse kræver medlemskab eller ejerskab | Aktiv — tilføjet 10. august 2026 og **kørt i staging og produktion 11. august 2026** (efterprøvet: fire nye policies, nul gamle, tre funktioner). ~~Idempotent.~~ **Var det ikke indtil 12. august 2026** — tre af de fire `create policy` manglede et drop af deres EGET navn, så en gen-kørsel stoppede på `42710: policy "competitions_select_involved" … already exists`. Rettet; filen kan nu køres igen mod den tilstand, den selv efterlader, og det er efterprøvet med to kørsler i træk. ~~🔴 KØR FØRST, NÅR DEN NYE KLIENT ER UDRULLET OG AFPRØVET.~~ Rækkefølgen er efterlevet; runbogen står i [`docs/UDRULNING-A40.md`](../docs/UDRULNING-A40.md). Forudsætter #52 (policyen kalder `is_group_creator()`; uden den fejler `create policy` med `42883`). **Adfærdsændring ved kørsel: ja, og den er hele formålet** — `groups_select_all` var `using (true)`, så hver indlogget bruger kunne læse hver liga inkl. `invite_code`, og et liga-id var nok til at melde sig ind. Køres den for tidligt, kan ingen tage imod en invitation, før udrulningen er færdig; **tilbagerulningen er fire `create policy` og står nederst i filen.** **Fælden, der kostede en runde:** insert-policyen på `group_members` skal spørge `groups`, som netop er blevet smalnet, og en opretter er ikke medlem, når hun skriver sin egen admin-række — derfor `is_group_creator()` som `security definer` i #52. Uden den kan INGEN oprette en liga. Begge filer er dækket af `sql/tests/invite_lookup.sql` i CI, som også måler MELLEMTILSTANDEN mellem de to trin, og er efterprøvet med tretten mutationer | ⚠️ **Filen har været rettet TO gange på samme linje, og den står nu igen som oprindeligt.** 11. august 2026 fik `groups_select_member` `or created_by = auth.uid()` (`#55`s hasterettelse), og 12. august 2026 mistede den det igen (`G98`, `#58`), fordi `create_group()` (`#57`) har overtaget oprettelsen. **Filen er dermed gyldig at køre — men kun mod en produktion, hvor klienten kalder `create_group()`.** Kører du den mod en ældre klient, kan ingen oprette en liga; rettelsen er `#55` bagefter.
| 54 | [`invite_preview.sql`](./invite_preview.sql) | Invitationens ETIKET må læses uden login (`I7`/`A41`): `invite_preview()` — `security definer`, `stable`, **ingen `auth.uid()`-vagt** og åben for `anon` — svarer med navn og medlemsantal og intet andet | Aktiv — tilføjet 11. august 2026. Idempotent. **Rent additiv og sikker at køre når som helst, også før frontend-mergen:** den tilføjer én funktion og dens grants, rører ingen policy og ingen række. Køres den efter deployet, udebliver previewet blot, indtil den er kørt. Afvejningen mod `A40` står i filens hoved og i `DECISIONS.md`: previewet er en BILLEDTEKST til en kode, kalderen allerede har — `invite_lookup()` (opslaget) og `accept_invite()` (adgangen) er urørte. ⚠️ Skal følges af en gen-kørsel af `analytics_events.sql` (#16), som har fået `invite_landed` i hændelses-constrainten. Dækket af `sql/tests/invite_preview.sql` i CI |
| 55 | [`groups_select_creator.sql`](./groups_select_creator.sql) | 🔴 **Hasterettelse:** `groups`' SELECT-policy får sit `or created_by = auth.uid()` tilbage, så en opretter kan læse den liga, hun netop har indsat | 🛑 **OVERHALET AF `#58` (`G98`, 12. august 2026) — MÅ IKKE KØRES IGEN.** Filen tilføjer præcis det led, `#58` fjerner, så en gen-kørsel ruller `G98` tavst tilbage; den står i listen nedenfor. Rettelsen, hvis det er sket, er at køre `#58` bagefter. Hoved og forklaring er bevaret, fordi den er den bedste beskrivelse af, hvorfor en `INSERT` med `RETURNING` også skal bestå SELECT-policyen. Historikken: tilføjet 11. august 2026. Idempotent og **rent udvidende**, altså sikker at køre når som helst og uafhængigt af et deploy. **Retter en regression fra #53:** `db.insert` sender `Prefer: return=representation`, så PostgREST kører `insert … returning *` — og en RETURNING-klausul anvender SELECT-policyen på den NYE række. `createGroup` skriver ligaen før sin egen medlemsrække, så `is_group_member(id)` var falsk, og **ingen kunne oprette en liga** i hverken staging eller produktion. Prisen ved leddet: en opretter, der har forladt sin egen liga, kan stadig se den og dens `invite_code` — accepteret, se filens hoved og `DOCUMENTATION.md` §13. Dækket af påstand 10c i `sql/tests/invite_lookup.sql`, som er den første, der skriver MED `returning` |
| 56 | [`anon_grants_functions.sql`](./anon_grants_functions.sql) | `anon` mister også **funktionerne**, og den halvdel af kilden, der kan lukkes, lukkes (`G96`) | Aktiv — tilføjet og **kørt i staging og produktion 12. august 2026**. Idempotent (efterprøvet med to kørsler i træk). Tredje og sidste del af `G50`-oprydningen: `#34` tog tabellerne, `#43` sekvenserne, og denne tager det, begge sagde eksplicit, at de ikke rørte. **Lukker intet kendt hul** — hver funktion afviser selv en kalder uden `auth.uid()` — men gør den vagt til en dobbeltsikring i stedet for det eneste, der holder. **Adfærdsændring ved kørsel: ingen**, hvis appen gør som beskrevet; et flow, der alligevel kaldte en funktion uden login, fejler med `permission denied for function …` med det samme og ikke med forkerte data. **Uafhængig af et deploy** — den rører ingen funktionskrop og ingen signatur. ⚠️ **To ting er værd at kende, før filen læses:** `anon` kommer ind ad TO veje (sin egen grant OG PUBLIC), så påstande skal stilles med `has_function_privilege` og ikke mod `information_schema`; og PUBLIC-defaulten på nye funktioner kan ikke lukkes ved kilden — se den røde blok øverst i denne fil og filens eget hoved. Trin 1 fastfryser den adgang, `authenticated` og `service_role` faktisk har, FØR PUBLIC lukkes, så migreringen er sikker ved konstruktion frem for ved en optælling (i produktion et no-op; den melder det selv). Dækket af `sql/tests/anon_grants_functions.sql` i CI, kørt mod det rigtige skema og efterprøvet med fem mutationer. 🟢 **Reglen, filen efterlader, har siden `G100` (12. august 2026) også en vagt mod PRODUKTIONEN:** [`sql/checks/anon_routine_reach.sql`](./checks/anon_routine_reach.sql), kørt af `job-heartbeat.yml` hver halve time — testen ovenfor måler `sql/schema.sql`, og dumpet er op til en uge gammelt. Samme række afdækkede, at `revoke … on all functions` **ikke dækker procedurer** (efterprøvet mod 16.13): der findes nul i dag, men skrives den første, skal trin 2 være `all routines`, og kontrollen er det ene sted, der siger til |
| 57 | [`create_group.sql`](./create_group.sql) | Ligaen og opretterens admin-række bliver ÉN skrivning: `create_group(navn)` (`G95`) | Aktiv — tilføjet og **kørt i staging og produktion 12. august 2026**. Idempotent. ✅ **Ren tilføjelse og sikker at køre når som helst, også før frontend-mergen** — én funktion og dens grants, ingen policy, ingen række. Den gamle klient kalder den ikke; den nye ville allerede virke. Samme form som `#52`. **Adfærdsændring ved kørsel: ingen.** Lukker vinduet, hvor et fejlet kald nummer to efterlod en **forældreløs liga** (ingen medlemmer ⇒ usynlig i enhver oversigt, kan hverken forlades eller slettes). Nul forekomster i produktion, talt ved `A40`s udrulning. 🔴 **Fjerner IKKE `#55`s `or created_by = auth.uid()`** — det led bar den gamle klients `insert … returning`, indtil deployet var kørt. ✅ **Smalningen er sket som `#58` (`G98`, 12. august 2026), da oprettelsen var afprøvet i produktionen.** Dækket af `sql/tests/create_group.sql` i CI, kørt mod det rigtige skema og efterprøvet med fem mutationer — heriblandt en negativ kontrol, der fremkalder den forældreløse liga ad den gamle vej |

| 58 | [`groups_select_member_narrow.sql`](./groups_select_member_narrow.sql) | `groups`' SELECT-policy mister `or created_by = auth.uid()` igen (`G98`): reglen er herefter *"du kan se en liga, hvis du er medlem"* — punktum | Aktiv — tilføjet og **kørt i staging og produktion 12. august 2026**. Idempotent (ét `drop policy` + ét `create policy`, ingen rækker røres). 🔴 **FORUDSÆTNINGEN ER ET DEPLOY OG IKKE EN ANDEN MIGRERING:** leddet bar den GAMLE klients `insert … returning`, og køres filen, mens en klient uden `create_group()` (#57) er i luften, kan INGEN oprette en liga — nøjagtig produktionsfejlen fra 11. august 2026. **Forudsætningen er indfriet:** `#57` er kørt, den nye klient er udrullet, og "Opret liga" er afprøvet i produktionen 12. august 2026. Er du i tvivl, så prøv "Opret liga" i appen FØR du kører filen. **Adfærdsændring ved kørsel: ja, og den er hele formålet** — en opretter, der har FORLADT sin egen liga, kan ikke længere læse den og dens `invite_code`; prisen, `#55` betalte, er dermed betalt tilbage. ⚠️ **Én følge mere, som er tilsigtet:** en liga uden medlemmer bliver usynlig for alle, også for opretteren — kør filens verifikation 3 FØR migreringen; der er nul af dem i produktionen (talt ved `A40`s og `#57`s udrulning). Samme smalning står nu i `#53` selv, mens `#55` er den fil, der ikke må gen-køres. Tilbagerulningen er ét statement og står nederst i filen. Dækket af `sql/tests/create_group.sql` (påstand 6, som måler porten fra BEGGE sider) og `sql/tests/invite_lookup.sql` (10c1, 10c2, 10f) i CI, efterprøvet med fem mutationer |

### ⚠️ Ti filer må ikke gen-køres blindt

Alle ti bruger `drop policy … create policy` / `drop view … create view`, så en
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
- **`groups_select_creator.sql`** (#55) genskaber `groups`' SELECT-policy MED
  `or created_by = auth.uid()` og ruller dermed `G98` (#58) tilbage. Symptomet er
  ikke en fejl, men en tilstand: en opretter, der har forladt sin egen liga, kan
  igen læse den og dens `invite_code`. Leddet var rigtigt i ét døgn — det bar den
  gamle klients `insert … returning`, indtil `create_group()` (#57) overtog
  oprettelsen. **Kør `groups_select_member_narrow.sql` (#58) bagefter.** ⚠️ Og
  omvendt: har en gammel klient alligevel brug for leddet, er #55 netop
  tilbagerulningen — den er den ene af de ti, hvor "kør den nyere bagefter" ikke
  altid er svaret. *(Tilføjet 12. august 2026.)*

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

  > 🛑 **DEN FARLIGSTE ER IKKE VIEWET, MEN DAGSMOTOREN (tilføjet 8. august
  > 2026).** #38 indeholder sin EGEN `generate_daily_stories()`, og #47
  > (`story_engine_v3.sql`) erstatter den. **Køres #38 uden at #47 køres
  > BAGEFTER, er v3's dagsmotor væk** — ét kort pr. bruger pr. dag,
  > nyhedsværdien, mini-stillingen og datid-teksterne — og produktionen falder
  > tilbage til v2's to-kort-om-dagen uden at noget fejler. Det er præcis den
  > tavse tilbagerulning, hele dette afsnit findes for, bare på den dyreste af
  > filens objekter.
  >
  > **Rækkefølgen, når #38 skal gen-køres, er derfor bindende og har tre trin:**
  >
  > 1. `story_engine_v2.sql` (#38)
  > 2. `story_engine_v3.sql` (#47) — genskaber dagsmotoren, #38 lige overskrev
  > 3. `story_engine_v3_cleanup.sql` (#48) — #38 genskabte `stories_day_uniq`,
  >    som #48 er skrevet for at fjerne. Harmløst i sig selv (v3's
  >    `stories_day_slot_uniq` er strengere og afviser alt, det gamle ville),
  >    men det efterlader databasen med et indeks, repoet mener er væk.
  >
  > `story_engine.sql` (#8) behøver **ikke** at komme med: den definerer kun
  > `generate_stories()`, som hverken #38 eller #47 rører, og dens gamle
  > `latest_story` er væk siden v3.

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
`account_anonymization.sql` + `liga_admin.sql` i produktionens rækkefølge mod
**produktionsskemaet** og efterprøver den
påstand, hele valget af anonymisering frem for sletning hviler på: at brugerens
**tips, rating, ratinghistorik og kåringer står uændret**, at de stadig er
deltager og ligamedlem, og at **den liga, de oprettede, findes med alle sine
medlemmer**. En rigtig sletning ville have kaskaderet ligaen væk via
`groups.created_by` og dermed opløst fællesskabet for alle andre. Dertil: at
funktionen har nul parametre (den mekaniske udgave af "kan ikke ramme en anden
bruger"), at brugssporet er væk, at feedback-rækken overlever uden afsender, at
en anden bruger er urørt, og at andet kald er et no-op.

**Begge dele — det rigtige skema og `liga_admin.sql` — kom til med `G91`
(9. august 2026), og den anden er den vigtige.** Filen indlæste indtil da kun
`account_anonymization.sql` og prøvede dermed #31's SELVSTÆNDIGE
`anonymize_my_account()`, som ingen kører: produktionen kører #42's skal om
`_anonymize_account()`. Testen vogtede altså en funktionskrop, der kun findes,
fordi migreringerne læses i rækkefølge. Samme runde flyttede
`sql/tests/liga_admin.sql` over på produktionsskemaet, og dér kostede
miniskemaet en påstand, der var direkte forkert — se `docs/DECISIONS.md`.

**`sql/tests/story_engine_daily.sql`** (samme CI-job, egen database) dækker Story
Engine **v3's** dagsmotor — femten påstande, fra ét-slot-invarianten til
mini-stillingens vindue. To af dem er værd at kende:

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
