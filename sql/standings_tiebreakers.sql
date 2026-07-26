-- Tiebreakers i stillingerne: udvider round_standings, season_standings og
-- monthly_standings med de kolonner, hele tiebreaker-stigen har brug for.
-- Idempotent — kan køres igen når som helst.
--
-- Stigen (samme rækkefølge overalt, spejlet i src/lib/standings.js):
--   1. flest point            total_points   desc
--   2. flest præcise          exact_count    desc
--   3. flest korrekte udfald  outcome_count  desc   ← ny
--   4. flest rundesejre       round_wins     desc   ← ny (ikke i rundeligaen: den ér én runde)
--   5. mindst målafvigelse    avg_goal_error asc    ← ny
--   derefter er spillerne ÆGTE lige: delt placering og delt titel. Rækkefølgen
--   gøres stabil med user_id i klientens order=, som ALDRIG afgør en placering.
--
-- Hvorfor målafvigelsen er et GENNEMSNIT og ikke en sum: en sum ville straffe den,
-- der tipper flest kampe, og det strider mod beslutning A2 ("Månedsligaen må gerne
-- belønne deltagelse"). Gennemsnittet normaliserer deltagelsesomfang på samme måde
-- som ratingen (point pr. kamp). Der afrundes til 4 decimaler, så SQL og JS altid
-- er enige om, HVORNÅR to tal er lige.
--
-- En rundesejr = at være nr. 1 i den enkelte runde efter samme stige uden trin 4
-- (point → præcise → udfald → målafvigelse). En delt rundesejr tæller for alle.
--
-- Point aflæses via public.pc_points, aldrig ved at gentage 3/1-udtrykket: F2 (juli
-- 2026) fastfrøs pointsystemet som 3-1-0, så pts = 3 ⇒ præcist, pts = 1 ⇒ korrekt udfald.
--
-- Sikkerhed: round_standings/season_standings beholder security_invoker (arver
-- predictions/matches' RLS); monthly_standings beholder BEVIDST sin nuværende
-- semantik uden security_invoker — denne migrering ændrer kun kolonner, ikke
-- adgangsregler. Kun kampe MED resultat indgår, og de er altid låste, så alles
-- gæt må læses (ingen snyde-risiko).
--
-- Views'ene gendannes med drop + create, fordi kolonnetyper normaliseres til int.
-- Der bruges bevidst IKKE `cascade`: fejler drop'et på en overset afhængighed, er
-- det sikkerhedsnettet, ikke noget der skal tvinges igennem. generate_stories og
-- career_profile refererer kun til dem inde i funktionskroppe (sen binding) og er
-- derfor upåvirkede.

-- ============================================================================
-- round_standings — én spillerunde på tværs af alle turneringer
-- ============================================================================
drop view if exists public.round_standings;

create view public.round_standings
with (security_invoker = on) as
with scored as (
  select
    m.round_key,
    pr.user_id,
    public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) as pts,
    abs(pr.pred_home - m.home_score) + abs(pr.pred_away - m.away_score) as goal_err
  from public.predictions pr
  join public.matches m on m.id = pr.match_id
  where m.home_score is not null and m.away_score is not null
    and pr.pred_home is not null and pr.pred_away is not null
)
select
  round_key,
  user_id,
  count(*)::int                                        as matches,
  sum(pts)::int                                        as total_points,
  (count(*) filter (where pts = 3))::int               as exact_count,
  (count(*) filter (where pts = 1))::int               as outcome_count,
  round(sum(goal_err)::numeric / count(*), 4)          as avg_goal_error
from scored
group by round_key, user_id;

-- ============================================================================
-- season_standings — hele en ligas sæson
-- ============================================================================
drop view if exists public.season_standings;

create view public.season_standings
with (security_invoker = on) as
with scored as (
  select
    m.season_id,
    m.round_key,
    pr.user_id,
    public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) as pts,
    abs(pr.pred_home - m.home_score) + abs(pr.pred_away - m.away_score) as goal_err
  from public.predictions pr
  join public.matches m on m.id = pr.match_id
  where m.home_score is not null and m.away_score is not null
    and pr.pred_home is not null and pr.pred_away is not null
),
per_round as (
  select
    season_id,
    user_id,
    rank() over (
      partition by season_id, round_key
      order by sum(pts) desc,
               (count(*) filter (where pts = 3)) desc,
               (count(*) filter (where pts = 1)) desc,
               round(sum(goal_err)::numeric / count(*), 4) asc
    ) as rnk
  from scored
  group by season_id, round_key, user_id
),
wins as (
  select season_id, user_id, count(*)::int as round_wins
  from per_round where rnk = 1
  group by season_id, user_id
)
select
  s.season_id,
  s.user_id,
  count(*)::int                                        as matches,
  sum(s.pts)::int                                      as total_points,
  (count(*) filter (where s.pts = 3))::int             as exact_count,
  (count(*) filter (where s.pts = 1))::int             as outcome_count,
  round(sum(s.goal_err)::numeric / count(*), 4)        as avg_goal_error,
  coalesce(w.round_wins, 0)                            as round_wins
from scored s
left join wins w
  on w.season_id is not distinct from s.season_id
 and w.user_id = s.user_id
group by s.season_id, s.user_id, w.round_wins;

-- ============================================================================
-- monthly_standings — en kalendermåned på tværs af alle turneringer
-- ============================================================================
-- Rundesejre afgrænses her af (måned, runde): en runde, der krydser en måneds-
-- grænse, tæller i hver måned med netop de kampe, der allerede giver point dér —
-- samme afgrænsning som pointene selv.
drop view if exists public.monthly_standings;

create view public.monthly_standings as
with scored as (
  select
    to_char(date_trunc('month', m.kickoff_at), 'YYYY-MM') as month,
    m.round_key,
    p.user_id,
    public.pc_points(p.pred_home, p.pred_away, m.home_score, m.away_score) as pts,
    abs(p.pred_home - m.home_score) + abs(p.pred_away - m.away_score) as goal_err
  from public.predictions p
  join public.matches m on m.id = p.match_id
  where m.home_score is not null and m.away_score is not null
    and p.pred_home is not null and p.pred_away is not null
),
per_round as (
  select
    month,
    user_id,
    rank() over (
      partition by month, round_key
      order by sum(pts) desc,
               (count(*) filter (where pts = 3)) desc,
               (count(*) filter (where pts = 1)) desc,
               round(sum(goal_err)::numeric / count(*), 4) asc
    ) as rnk
  from scored
  group by month, round_key, user_id
),
wins as (
  select month, user_id, count(*)::int as round_wins
  from per_round where rnk = 1
  group by month, user_id
)
select
  s.month,
  'ALL'::text                                          as scope,
  s.user_id,
  sum(s.pts)::int                                      as total_points,
  count(*)::int                                        as matches,
  (count(*) filter (where s.pts = 3))::int             as exact_count,
  (count(*) filter (where s.pts = 1))::int             as outcome_count,
  round(sum(s.goal_err)::numeric / count(*), 4)        as avg_goal_error,
  coalesce(w.round_wins, 0)                            as round_wins
from scored s
left join wins w
  on w.month is not distinct from s.month
 and w.user_id = s.user_id
group by s.month, s.user_id, w.round_wins;

-- ============================================================================
grant select on public.round_standings   to anon, authenticated, service_role;
grant select on public.season_standings  to anon, authenticated, service_role;
grant select on public.monthly_standings to anon, authenticated, service_role;
