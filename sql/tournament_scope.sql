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
-- Rundeligaen og månedsligaen joinede kun predictions ↔ matches: intet filter på
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
-- Beslutning A2 (juli 2026) svarede "månedsligaen må gerne belønne deltagelse" —
-- truffet før turnering #2 fandtes, altså om en situation, der ikke kunne afprøves.
-- Denne migrering afløser den med to niveauer:
--
--   scope = 'ALL'      alle OFFICIELLE turneringer under ét
--                      → "Rundens / Månedens Prediction Champ" (den store titel)
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

-- Scotland Premiership er en generalprøve for flere turneringer, ikke en officiel
-- turnering. Den er synlig og kan tippes; den afgør bare ingen titler.
update public.leagues set is_official = false where api_league_id = '501';

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
drop view if exists public.monthly_standings;

create view public.monthly_standings as
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
grant select on public.round_standings   to anon, authenticated, service_role;
grant select on public.monthly_standings to anon, authenticated, service_role;

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- 1) Turneringernes status. Skotland skal stå som synlig, men ikke officiel.
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

-- 3) Samme invariant for månedsligaen. Skal give 0 rækker.
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

-- 5) Kun ÉN scope-værdi i dag (Superligaen), fordi Skotland ikke er officiel:
--    'ALL' + superligaens uuid.
-- select scope, count(*) from round_standings group by scope;
