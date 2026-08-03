# `sql/` — skema, migreringer og eksport

Denne mappe indeholder de SQL-scripts, der definerer og udvider produktionsskemaet
(`public`) i Supabase. De enkelte `*.sql`-filer er **migreringer**, kørt manuelt i
Supabase SQL-editor med **"Run without RLS"** (scripterne sætter selv RLS på de
tabeller, der skal have det — jf. `DOCUMENTATION.md` afsnit 13). Alle er idempotente
og kan køres igen.

`schema.sql` er en **genereret** fuld-skema-eksport — et øjebliksbillede af hele
`public`-skemaet, som det så ud ved seneste eksport. Den redigeres aldrig i hånden;
den regenereres med guiden nedenfor.

> ⚠️ **Øjebliksbilledet er BAGUD igen (aften, 3. august 2026).** Eksporten blev
> kørt samme dag og var frisk indtil migreringerne nedenfor — den er kørt efter
> `predictions_match_lock.sql` (#25), `competition_awards.sql` (#26),
> `security_hardening.sql` (#27), `matches_kickoff_tbd.sql` (#28), `feedback.sql`
> (#29), `api_id_uniqueness.sql` (#30) og `account_anonymization.sql` (#31), og
> den viser dem alle. Filens eget datostempel i git er svaret på "hvor gammel er
> den?" — ikke en dato skrevet i hånden her, som var dét, der drev tre steder
> fra hinanden indtil `G21`.
>
> **Bagud igen efter 3. august-kørslerne.** Dumpet kender hverken #33
> (`round_key()`s nye krop), #34 (`anon`s grants er væk) eller Story Engine
> v1.2's `generate_stories()`. #32 rører ikke skemaet. Kør
> [`schema-export.yml`](../.github/workflows/schema-export.yml), eller lad
> mandagskørslen gøre det — datoen ovenfor gælder indtil da.
>
> **Adgangskontrakten kan igen læses af filen:** de gamle, åbne
> `matches`-policies og `grant … to anon` på `recompute_ratings()` er væk, som
> #27 gjorde dem.
>
> **Det, eksporten samtidig afgjorde (`G5`):** funktionskroppene i produktion
> indeholder CRLF — alle 25 af dem. Advarslen i `rating_core.sql`s hoved var
> altså sand om databasen, mens selve filen var blevet normaliseret til LF.
> Kroppene er hentet ordret tilbage, og `.gitattributes` (`*.sql -text`) holder
> dem der.
>
> Reglen er uændret: **eksport efter hver migrering** — kør
> [`schema-export.yml`](../.github/workflows/schema-export.yml) manuelt, eller
> lad mandagskørslen gøre det. Verificér mod databasen, ikke mod filen, hvis der
> er tvivl; til gengæld er netop det den hurtigste måde at se, om en migrering
> faktisk **er** kørt i produktion.

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
| 8 | `story_engine.sql` | `stories`, `latest_story`, `generate_stories()` | Aktiv — ~~v1.1 skal gen-køres i produktion~~ **gen-kørt 31. juli 2026** (både v1.1's 14 regler og `scope = 'ALL'`-filtreringen efter #20). Kun funktionen ændres, tabel og view er uændrede. **v1.2 gen-kørt 3. august 2026** (`B10`): to nye regler (`AWARD_WEEK`, `AWARD_MONTH`) læser `competition_awards`, og regel 70 tier, hvor en kåring dækker. Forudsætter #26 |
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
| 26 | `competition_awards.sql` | Lokale kåringer (I13/A22): tabellen `competition_awards` + SECURITY DEFINER-RPC'en `award_competition_periods()` ("Ugens/Månedens bedste" i en opt-in-konkurrence) | Aktiv — tilføjet 1. august 2026. Idempotent. Ingen skrive-policies: funktionen er den eneste skriver, klienten trigger den ved board-åbning. **Skal køres FØR frontend-mergen** — omvendt degraderer boardet blot til en tom kåringssektion |
| 27 | `security_hardening.sql` | Sikkerhedsstramning (G14/G15/G16): `matches` bliver admin-only at skrive i, `recompute_ratings()` bliver service_role-only med wrapperen `admin_recompute_ratings()`, og `monthly_standings` får `security_invoker` | Aktiv — tilføjet august 2026. Idempotent. **Ændrer ingen tal og intet, brugerne ser** — kun hvem der må skrive og læse. **Skal køres FØR frontend-mergen:** Admin-skærmens "Opdater ratings" kalder herefter `admin_recompute_ratings`, som først findes med denne migrering. Forudsætter #0, #5 og #20 |
| 28 | `matches_kickoff_tbd.sql` | **"Tid ikke fastlagt"**: kolonnen `matches.kickoff_tbd` + låsen samlet i `public.match_lock_at()`/`match_locked()`, som alle fem policies og `analytics_match_locks` nu kalder | Aktiv — tilføjet august 2026. Idempotent. **Afløser låseudtrykket i #25**, som stod 1:1 fem steder. **Ingen adfærdsændring ved kørsel:** kolonnen får `default false`, så udtrykket er bogstaveligt det gamle, indtil `sync-matches` har sat flaget — derfor behøver den *ikke* køres mellem to runder. Skal køres FØR frontend-mergen; ellers viser klienten stadig pladsholder-tider. Forudsætter #25 |
| 29 | `feedback.sql` | Feedback fra brugerne (`B14`): tabellen `feedback` + RPC'erne `admin_feedback()` og `admin_feedback_set_handled()` | Aktiv — tilføjet 2. august 2026. Idempotent. Ingen adfærdsændring for eksisterende data. **Skal køres FØR frontend-mergen** — omvendt får brugeren en fejl, når de trykker Send, og Admin → Feedback siger "Er sql/feedback.sql kørt?" |
| 30 | `api_id_uniqueness.sql` | Unique-constraints på leverandør-id'erne (`G7`): `leagues (provider, api_league_id)`, `seasons (league_id, api_season_id)`, `teams (league_id, api_team_id)` | Aktiv — tilføjet 2. august 2026. Idempotent. **Fejler højlydt, hvis der allerede findes dubletter** — det er med vilje, og fejlteksten nævner rækkerne. Ingen kodeændring hører til; se filens eget hoved for, hvorfor `api/sync-matches.js` bevidst IKKE er lavet om til et upsert |
| 31 | `account_anonymization.sql` | Luk din egen konto (`B4`): kolonnen `profiles.anonymized_at` + RPC'en `anonymize_my_account()` | Aktiv — tilføjet 3. august 2026. Idempotent. **Funktionen har NUL parametre med vilje** — der findes ikke et bruger-id at forfalske. Den rører ikke `auth.users`; selve kontolukningen gør `api/delete-account.js` bagefter med service-nøglen. **Skal køres FØR frontend-mergen**, ellers fejler knappen. Går et forløb i stykker mellem de to trin, er bagstopperen manuel: find brugeren i Supabase → Authentication og slet den blødt dér; RPC'en er allerede kørt og er idempotent |

| 32 | `competitions_rules_cleanup.sql` | Fjerner den døde nøgle `openDaysBefore` fra `competitions.rules` (`G3`) | Aktiv — tilføjet og **kørt 3. august 2026**. Idempotent. **Den eneste fil i listen, det ikke gør nogen forskel at springe over:** ingen adfærdsændring, intet en bruger kan se, og ingen kode afhænger af den. Frontenden holdt op med at LÆSE `rules` i samme leverance, så nøglen er misvisende og ikke farlig. Kolonnen droppes bevidst ikke |

| 33 | `round_key_timezone.sql` | `round_key()` aflæser datoen i dansk tid frem for i sessionens (`G11`) | Aktiv — tilføjet og **kørt 3. august 2026**. Idempotent. **Flytter kun de rækker, den nye regel er uenig med** — i praksis forventeligt nul, da ingen af de syv turneringer spiller mellem midnat og 02.00 dansk tid; tællingen står i filens hoved. Rører den rækker, genberegner matches-triggeren rating og historier af sig selv, så kør den **mellem to runder**. Skal køres sammen med frontend-mergen: klienten regner fra samme dag efter `G32` |
| 34 | `anon_grants.sql` | Fjerner `anon`s tabel-privilegier i `public` og lukker kilden (Supabases default privileges) — `G50` | Aktiv — tilføjet og **kørt 3. august 2026**. Idempotent. **Ingen adfærdsændring for en indlogget bruger:** appen sender altid brugerens JWT (rollen `authenticated`), og det eneste kald før login rører en `SECURITY DEFINER`-funktion. Ændrer intet i RLS — den giver dybde, hvor policyen stod alene. Tilbagerulningen er to linjer og står i filen. Dækket af `sql/tests/anon_grants.sql` i CI |
| 35 | `predictions_updated_at.sql` | Trigger, så `predictions.updated_at` flytter sig ved en RETTELSE (`G13`) | Aktiv — tilføjet 3. august 2026. Idempotent. **Ændrer, hvad to Analytics-tal måler:** "Aktive konkurrencer/ligaer" og retention tæller fra nu af også rettede tips, altså aktivitet frem for kun afgivne tips. Måle-ordbogen er rettet i samme ombæring. En gen-skrivning af samme score flytter intet. Dækket af `sql/tests/predictions_updated_at.sql` i CI |
| 36 | `client_errors.sql` | Fejltelemetri for frontenden (`G42`): tabellen `client_errors`, `admin_client_errors()` og `prune_client_errors()` | Aktiv — tilføjet 3. august 2026. Idempotent. **Skal køres FØR frontend-mergen** — ellers fejler hver rapportering tavst (den er fire-and-forget, så brugeren mærker intet, men sporet er væk). Samme RLS-form som #29: kun insert, kun egne rækker, ingen select. Dækket af `sql/tests/client_errors.sql` i CI |

### ⚠️ Fire filer må ikke gen-køres blindt

Alle fire bruger `drop policy … create policy` / `drop view … create view`, så en
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

Testene kan køres lokalt mod enhver tom database:

```bash
createdb ratingtest && createdb awardstest && createdb sectest && createdb fbtest && createdb idtest && createdb anontest
cd sql/tests && psql -d ratingtest -v ON_ERROR_STOP=1 -b -f rating_equivalence.sql
psql -d awardstest -v ON_ERROR_STOP=1 -b -f competition_awards.sql
psql -d sectest -v ON_ERROR_STOP=1 -b -f security_hardening.sql
psql -d fbtest -v ON_ERROR_STOP=1 -b -f feedback.sql
psql -d idtest -v ON_ERROR_STOP=1 -b -f api_id_uniqueness.sql
psql -d anontest -v ON_ERROR_STOP=1 -b -f account_anonymization.sql
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
