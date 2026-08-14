-- Championship på to niveauer: samlet + pr. turnering.
-- Idempotent — kan køres igen når som helst (kør med "Run without RLS").
--
-- ⚠️ AFLØSER `round_standings` og `monthly_standings` i standings_tiebreakers.sql.
--    Gen-køres den fil efter denne, forsvinder scope-kolonnen tavst, og
--    Championship-fanen viser tomme stillinger. Se advarslen i sql/README.md.
--
-- ---------------------------------------------------------------------------
-- Hvorfor
--
-- Rundechampionshippet og månedschampionshippet joinede kun predictions ↔ matches: intet filter på
-- turnering, intet på konkurrence. De summerede point for ALT, brugeren havde
-- tippet — og hvad man har tippet, afgøres af, hvilke FRIVILLIGE konkurrencer man
-- er meldt ind i.
--
-- Med én turnering var det uproblematisk: alle tippede stort set de samme kampe.
-- Med to bliver to brugere målt på forskellige kampmængder — ~12 kampe og et loft
-- på 36 point mod ~6 kampe og 18. Ingen mængde dygtighed lukker det hul. Problemet
-- er ikke, at deltagelse belønnes; det er, at de eneste konkurrencer, INGEN selv
-- har valgt, blev afgjort af, hvad man tilfældigvis havde valgt andre steder.
--
-- Beslutning A2 (juli 2026) svarede "månedschampionshippet må gerne belønne deltagelse" —
-- truffet før turnering #2 fandtes, altså om en situation, der ikke kunne afprøves.
-- Denne migrering afløser den med to niveauer:
--
--   scope = 'ALL'      alle OFFICIELLE turneringer under ét
--                      → "Rundens / Månedens Champion" (den store titel)
--   scope = <league_id> én stilling pr. officiel turnering
--                      → "Rundens / Månedens bedste i <turnering>"
--
-- ---------------------------------------------------------------------------
-- is_official: hvad der overhovedet fodrer Championship
--
-- Adskilt fra is_visible, så en turnering kan være tipbar uden at ændre
-- kåringernes betydning. En turnering forfremmes til officiel som et bevidst valg
-- — ikke i samme øjeblik, den tændes.
-- ---------------------------------------------------------------------------

alter table public.leagues
  add column if not exists is_official boolean not null default true;

-- En officiel turnering, ingen kan se, er en selvmodsigelse: den ville afgøre
-- titler ud fra kampe, brugerne ikke kan tippe. is_official ⇒ is_visible.
alter table public.leagues drop constraint if exists leagues_official_implies_visible;
alter table public.leagues
  add constraint leagues_official_implies_visible check (not is_official or is_visible);

-- Her stod indtil 14. august 2026:
--
--   -- Scotland Premiership er en generalprøve for flere turneringer, ikke en
--   -- officiel turnering. Den er synlig og kan tippes; den afgør bare ingen titler.
--   update public.leagues set is_official = false where api_league_id = '501';
--
-- Sætningen er FJERNET og ikke rettet, fordi den var en STARTTILSTAND skrevet
-- som en regel. Scotland Premiership er forfremmet til officiel med `A55`
-- (14. august 2026, #64 tournament_scotland_promote.sql), og en gen-kørsel af
-- denne fil — som er nødvendig, hver gang de to views ændrer sig — ville have
-- rullet forfremmelsen tilbage TAVST og flyttet både rating og titler for alle
-- brugere. Det er præcis `G65`s fejl en gang til: `is_visible`/`is_official`/
-- `live_enabled` er manuelle valg, og et script, der sætter dem som en
-- sidegevinst, kan ikke gen-køres uden at tage valget om igen.
--
-- Bygges skemaet op fra scripterne frem for fra `schema.sql`, kommer
-- turneringens egen række fra #21 (som indsætter den uofficiel) og
-- forfremmelsen fra #64. Rækkefølgen står i sql/README.md.

-- ============================================================================
-- round_standings — én spillerunde, samlet og pr. turnering
-- ============================================================================
-- Stigen er uændret (se standings_tiebreakers.sql): point → præcise → udfald →
-- målafvigelse. Kun scope er nyt.
--
-- `cross join lateral (values ...)` frem for to aggregeringer i union all: hver
-- tippet kamp tælles én gang i 'ALL' og én gang i sin egen turnering, og
-- aggregeringen står ÉT sted. To kopier af stigen ville være to steder at
-- vedligeholde og dermed en fremtidig uoverensstemmelse.
drop view if exists public.round_standings;

create view public.round_standings
with (security_invoker = on) as
with scored as (
  select
    m.round_key,
    l.id as league_id,
    pr.user_id,
    public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) as pts,
    abs(pr.pred_home - m.home_score) + abs(pr.pred_away - m.away_score) as goal_err
  from public.predictions pr
  join public.matches m on m.id = pr.match_id
  join public.seasons s on s.id = m.season_id
  join public.leagues l on l.id = s.league_id and l.is_official
  where m.home_score is not null and m.away_score is not null
    and pr.pred_home is not null and pr.pred_away is not null
),
scoped as (
  select sc.round_key, sc.user_id, sc.pts, sc.goal_err, x.scope
  from scored sc
  cross join lateral (values ('ALL'), (sc.league_id::text)) as x(scope)
)
select
  round_key,
  scope,
  user_id,
  count(*)::int                                        as matches,
  sum(pts)::int                                        as total_points,
  (count(*) filter (where pts = 3))::int               as exact_count,
  (count(*) filter (where pts = 1))::int               as outcome_count,
  round(sum(goal_err)::numeric / count(*), 4)          as avg_goal_error
from scoped
group by round_key, scope, user_id;

-- ============================================================================
-- monthly_standings — en kalendermåned, samlet og pr. turnering
-- ============================================================================
-- scope-kolonnen fandtes allerede, hårdkodet til 'ALL'. Den var forberedt til
-- netop dette (samme greb som ratings.scope), og fordi career_profile.sql og
-- story_engine.sql i forvejen filtrerer scope = 'ALL' på månedslæsningerne, er
-- de upåvirkede af, at der nu kommer flere værdier.
--
-- Rundesejre afgrænses af (scope, måned, runde): en runde, der krydser en
-- månedsgrænse, tæller i hver måned med netop de kampe, der allerede giver point
-- dér — og en rundesejr i én turnering er ikke en rundesejr samlet set.
--
-- security_invoker tilføjet august 2026 (G16). Uden det kørte viewet med ejerens
-- rettigheder og omgik RLS på predictions — og med `grant select … to anon`
-- nederst i filen kunne en UAUTENTIFICERET kalder læse per-bruger månedspoint.
-- round_standings ovenfor har haft det hele tiden; her manglede det.
--
-- Ingen indlogget bruger ser andre tal af den grund: viewet tæller kun kampe MED
-- resultat, og præcis de tips er synlige for enhver authenticated bruger via
-- predictions_select_visible. Det, RLS nu skærer væk, er det, viewet alligevel
-- ikke medtog. For anon findes der slet ingen SELECT-policy på predictions.
drop view if exists public.monthly_standings;

create view public.monthly_standings
with (security_invoker = on) as
with scored as (
  select
    to_char(date_trunc('month', m.kickoff_at), 'YYYY-MM') as month,
    m.round_key,
    l.id as league_id,
    p.user_id,
    public.pc_points(p.pred_home, p.pred_away, m.home_score, m.away_score) as pts,
    abs(p.pred_home - m.home_score) + abs(p.pred_away - m.away_score) as goal_err
  from public.predictions p
  join public.matches m on m.id = p.match_id
  join public.seasons s on s.id = m.season_id
  join public.leagues l on l.id = s.league_id and l.is_official
  where m.home_score is not null and m.away_score is not null
    and p.pred_home is not null and p.pred_away is not null
),
scoped as (
  select sc.month, sc.round_key, sc.user_id, sc.pts, sc.goal_err, x.scope
  from scored sc
  cross join lateral (values ('ALL'), (sc.league_id::text)) as x(scope)
),
per_round as (
  select
    scope,
    month,
    user_id,
    rank() over (
      partition by scope, month, round_key
      order by sum(pts) desc,
               (count(*) filter (where pts = 3)) desc,
               (count(*) filter (where pts = 1)) desc,
               round(sum(goal_err)::numeric / count(*), 4) asc
    ) as rnk
  from scoped
  group by scope, month, round_key, user_id
),
wins as (
  select scope, month, user_id, count(*)::int as round_wins
  from per_round where rnk = 1
  group by scope, month, user_id
)
select
  s.month,
  s.scope,
  s.user_id,
  sum(s.pts)::int                                      as total_points,
  count(*)::int                                        as matches,
  (count(*) filter (where s.pts = 3))::int             as exact_count,
  (count(*) filter (where s.pts = 1))::int             as outcome_count,
  round(sum(s.goal_err)::numeric / count(*), 4)        as avg_goal_error,
  coalesce(w.round_wins, 0)                            as round_wins
from scoped s
left join wins w
  on w.scope = s.scope
 and w.month is not distinct from s.month
 and w.user_id = s.user_id
group by s.month, s.scope, s.user_id, w.round_wins;

-- ============================================================================
-- `anon` er BEVIDST ikke med (G58, august 2026). Stillingerne kræver login, og
-- `anon_grants.sql` (#34) fjernede rollens tabel-privilegier med den begrundelse,
-- at bredden var en REGEL og ikke en liste. En `grant … to anon` her ville
-- omgøre det ved en helt almindelig gen-kørsel af denne fil — som er dokumenteret
-- som idempotent og forventet gen-kørt — uden at nogen havde besluttet noget.
-- Heartbeat'en ville opdage det inden for en halv time, men en fil, der lægger
-- en fejl, en kontrol så fanger, er stadig en fil, der lægger en fejl.
grant select on public.round_standings   to authenticated, service_role;
grant select on public.monthly_standings to authenticated, service_role;

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- 1) Turneringernes status. Skotland stod som synlig, men ikke officiel, indtil
--    `A55` (14. august 2026) forfremmede den — se #64. Alle synlige turneringer
--    er officielle i dag.
-- select name, api_league_id, is_visible, is_official from leagues order by created_at;

-- 2) Summen passer: for hver (bruger, runde) skal per-turnering-rækkerne summere
--    til 'ALL'-rækken. Skal give 0 rækker.
-- select round_key, user_id from (
--   select round_key, user_id,
--          sum(matches) filter (where scope <> 'ALL') as pr_turnering,
--          max(matches) filter (where scope = 'ALL')  as samlet,
--          sum(total_points) filter (where scope <> 'ALL') as p_pr,
--          max(total_points) filter (where scope = 'ALL')  as p_samlet
--   from round_standings group by round_key, user_id
-- ) t where pr_turnering is distinct from samlet or p_pr is distinct from p_samlet;

-- 3) Samme invariant for månedschampionshippet. Skal give 0 rækker.
-- select month, user_id from (
--   select month, user_id,
--          sum(matches) filter (where scope <> 'ALL') as pr_turnering,
--          max(matches) filter (where scope = 'ALL')  as samlet
--   from monthly_standings group by month, user_id
-- ) t where pr_turnering is distinct from samlet;

-- 4) Ingen ikke-officiel turnering har sneget sig ind. Skal give 0 rækker.
-- select distinct scope from round_standings
-- where scope <> 'ALL'
--   and scope not in (select id::text from leagues where is_official);

-- 5) Scope-værdierne: 'ALL' + én uuid pr. officiel turnering, der er tippet på.
--    Var 'ALL' + superligaens uuid alene, indtil Skotland blev forfremmet (#64).
-- select scope, count(*) from round_standings group by scope;
