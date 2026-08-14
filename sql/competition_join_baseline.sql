-- Deltagerens nulpunkt: kun kampe, der stadig kunne tippes ved tilmeldingen,
-- tæller for hende i konkurrencen (A53).
-- Idempotent — kan køres igen når som helst (kør med "Run without RLS").
--
-- ---------------------------------------------------------------------------
-- Hvorfor
--
-- `predictions` er én række pr. `(bruger, kamp)` og har ingen konkurrence-
-- dimension: et gæt hører til KAMPEN, ikke til den konkurrence, man afgav det i.
-- To konkurrencer på samme turnering deler alle deres kampe, så det er reglen og
-- ikke undtagelsen.
--
-- Følgen var, at man kunne møde op med point. En bruger meldte sig ind i en ny
-- liga, tilmeldte sig dens Superliga-konkurrence — og stod med point med det
-- samme, fordi hun havde tippet de samme kampe i en anden ligas konkurrence.
-- De øvrige deltagere kunne ikke nå at gætte på dem; kampene var spillet.
--
-- Halvdelen af værnet fandtes i forvejen. `filterTippable` (src/lib/scoring.js)
-- materialiserer kun kampe, der stadig kan tippes, når en konkurrence OPRETTES,
-- netop for at "deltagerne skal stå lige". Den regel havde bare ingen pendant
-- ved TILMELDINGEN, og argumentet er ord for ord det samme.
--
-- To ting gjorde den værd at lukke frem for at leve med:
--   * en sen tilmelding kan gøre allerede udsendte HISTORIER forkerte bagud —
--     Story Engine fortæller om konkurrencens stilling, og en, der melder sig i
--     sidste runde og slår alle, omskriver den stilling, kortene beskrev;
--   * den kan spekuleres i: meld dig sent til en turnering, du ved du har
--     tippet godt.
--
-- ---------------------------------------------------------------------------
-- Reglen
--
--   Et gæt tæller i konkurrencen, hvis kampen LÅSTE efter deltagerens joined_at.
--
-- `public.match_lock_at(kickoff_at, kickoff_tbd)` er den samme funktion, RLS
-- håndhæver skrivelåsen med (sql/matches_kickoff_tbd.sql), så "kunne tippes" her
-- betyder præcis det samme som "måtte tippes" dér. Null (ukendt kickoff) tæller
-- MED — kampen kan stadig tippes, samme svar som policyens skrivegren.
--
-- Frontenden bærer reglen som `wasTippableAt(match, atMs)` i src/lib/scoring.js.
-- **De to skal ændres sammen.** To steder, der svarer forskelligt på ét
-- spørgsmål, er nøjagtig den fejl, Story Engine kostede i juli 2026, da
-- `_se_rp` manglede sit join til `competition_participants` (docs/DECISIONS.md).
--
-- ---------------------------------------------------------------------------
-- Hvad den rører — og hvad den med vilje ikke rører
--
-- To skrivninger, fordi konkurrence-point beregnes to steder i SQL:
--   1. `competition_match_points` — flaskehalsen. Story Engine (alle tre
--      generationer) og milepælene læser udelukkende igennem den.
--   2. `award_competition_periods()` — lokale kåringer har sine egne inline-
--      joins og går uden om viewet.
--
-- IKKE rørt: rating, runde-/måneds-/sæson-championship. De er TURNERINGS-
-- scopede og har slet ingen konkurrence-dimension at melde sig til (§5) —
-- ratingen tæller netop hver kamp én gang på tværs af alle officielle ligaer.
-- Karriereprofilens indbyrdes opgør (`rival`) er heller ikke rørt: det er et
-- spørgsmål om to spilleres gæt på delte kampe, ikke om en konkurrences
-- stilling. Noteret i docs/BACKLOG.md.
--
-- ---------------------------------------------------------------------------
-- Bagud
--
-- Intet omskrives. Stillingen beregnes live og retter derfor sig selv ved næste
-- åbning; det er tilsigtet, og det er dét, der fjerner det forkerte point, der
-- udløste rækken. Alt FROSSENT står stille: udsendte historier er materialiserede
-- rækker i `stories`, kåringer er `on conflict do nothing`, og milepæle er
-- permanente. En kåring, der allerede er faldet på det gamle grundlag, falder
-- ikke om.

-- ============================================================================
-- 1) competition_match_points — flaskehalsen
-- ============================================================================
-- Uændret fra sql/story_engine_v2_day.sql bortset fra det sidste where-led.
-- security_invoker = on bevares: viewet må ikke blive et hul rundt om
-- predictions' RLS. Begge story-motorer er security definer og læser igennem
-- det uanset.
create or replace view public.competition_match_points
with (security_invoker = on) as
select cm.competition_id,
       pr.user_id,
       m.id        as match_id,
       m.round_key,                    -- date
       m.match_day,                    -- date
       public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) as pts,
       abs(pr.pred_home - m.home_score) + abs(pr.pred_away - m.away_score)      as goal_err
from public.competition_matches cm
join public.matches m on m.id = cm.match_id
join public.predictions pr on pr.match_id = m.id
join public.competition_participants cp
  on cp.competition_id = cm.competition_id and cp.user_id = pr.user_id
where m.home_score is not null and m.away_score is not null
  and pr.pred_home is not null and pr.pred_away is not null
  -- A53: gættet tæller kun, hvis kampen låste EFTER hun meldte sig til.
  -- coalesce(..., true): en kamp uden kendt kickoff har ingen låsetid og kan
  -- stadig tippes, så den tæller med.
  and coalesce(public.match_lock_at(m.kickoff_at, m.kickoff_tbd) > cp.joined_at, true);

grant select on public.competition_match_points to authenticated, service_role;

-- ============================================================================
-- 2) award_competition_periods() — lokale kåringer
-- ============================================================================
-- Uændret fra sql/competition_awards.sql bortset fra, at begge `comp_matches`-
-- CTE'er nu bærer `kickoff_at`/`kickoff_tbd`, og begge `scored`-CTE'er bærer
-- A53-leddet. Uden kolonnerne kan leddet ikke stilles — og et filter, der ikke
-- kan se sit eget grundlag, fejler tavst.
create or replace function public.award_competition_periods(p_comp_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rounds integer := 0;
  v_months integer := 0;
begin
  -- Guard: en deltager (eller service_role, jf. B10/B11) — fremmede kan ikke
  -- engang trigge beregningen. Uden opt-in ved oprettelsen sker der intet.
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from competition_participants cp
    where cp.competition_id = p_comp_id and cp.user_id = auth.uid()
  ) then
    return 0;
  end if;

  if not exists (
    select 1 from competitions c
    where c.id = p_comp_id and (c.mode_params ->> 'awards') = 'true'
  ) then
    return 0;
  end if;

  -- ---------- Ugens bedste (pr. færdigspillet runde) ----------
  with comp_matches as (
    select m.id, m.round_key, m.home_score, m.away_score,
           m.kickoff_at, m.kickoff_tbd
    from competition_matches cm
    join matches m on m.id = cm.match_id
    where cm.competition_id = p_comp_id
  ),
  complete_rounds as (
    select round_key
    from comp_matches
    group by round_key
    having count(*) filter (where home_score is null or away_score is null) = 0
  ),
  scored as (
    select m.round_key, pr.user_id,
           pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) as pts,
           abs(pr.pred_home - m.home_score) + abs(pr.pred_away - m.away_score) as goal_err
    from comp_matches m
    join complete_rounds r on r.round_key = m.round_key
    join predictions pr on pr.match_id = m.id
    join competition_participants cp
      on cp.competition_id = p_comp_id and cp.user_id = pr.user_id
    where pr.pred_home is not null and pr.pred_away is not null
      and coalesce(match_lock_at(m.kickoff_at, m.kickoff_tbd) > cp.joined_at, true)  -- A53
  ),
  totals as (
    select round_key, user_id,
           sum(pts)::int as points,
           count(*)::int as matches,
           (count(*) filter (where pts = 3))::int as exact_count,
           (count(*) filter (where pts = 1))::int as outcome_count,
           round(sum(goal_err)::numeric / count(*), 4) as avg_goal_error,
           rank() over (
             partition by round_key
             order by sum(pts) desc,
                      (count(*) filter (where pts = 3)) desc,
                      (count(*) filter (where pts = 1)) desc,
                      round(sum(goal_err)::numeric / count(*), 4) asc
           ) as rnk
    from scored
    group by round_key, user_id
  ),
  winners as (
    select *, (count(*) over (partition by round_key)) > 1 as is_shared
    from totals where rnk = 1
  ),
  ins as (
    insert into competition_awards
      (competition_id, period_type, period_key, user_id, points, shared, stats)
    select p_comp_id, 'round', w.round_key::text, w.user_id, w.points, w.is_shared,
           jsonb_build_object('exact', w.exact_count, 'outcome', w.outcome_count,
                              'matches', w.matches, 'goal_error', w.avg_goal_error)
    from winners w
    on conflict do nothing
    returning 1
  )
  select count(*) into v_rounds from ins;

  -- ---------- Månedens bedste (pr. afsluttet kalendermåned) ----------
  with comp_matches as (
    select m.id,
           to_char(m.kickoff_at at time zone 'Europe/Copenhagen', 'YYYY-MM') as month_key,
           m.home_score, m.away_score,
           m.kickoff_at, m.kickoff_tbd
    from competition_matches cm
    join matches m on m.id = cm.match_id
    where cm.competition_id = p_comp_id
  ),
  complete_months as (
    select month_key
    from comp_matches
    group by month_key
    having count(*) filter (where home_score is null or away_score is null) = 0
       -- Kalendermåneden skal være forbi — ellers kunne en kåring falde, mens
       -- måneden stadig kan få nye kampe (efterfyldning, udsatte kampe).
       and month_key < to_char(now() at time zone 'Europe/Copenhagen', 'YYYY-MM')
  ),
  scored as (
    select m.month_key, pr.user_id,
           pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) as pts,
           abs(pr.pred_home - m.home_score) + abs(pr.pred_away - m.away_score) as goal_err
    from comp_matches m
    join complete_months cm on cm.month_key = m.month_key
    join predictions pr on pr.match_id = m.id
    join competition_participants cp
      on cp.competition_id = p_comp_id and cp.user_id = pr.user_id
    where pr.pred_home is not null and pr.pred_away is not null
      and coalesce(match_lock_at(m.kickoff_at, m.kickoff_tbd) > cp.joined_at, true)  -- A53
  ),
  totals as (
    select month_key, user_id,
           sum(pts)::int as points,
           count(*)::int as matches,
           (count(*) filter (where pts = 3))::int as exact_count,
           (count(*) filter (where pts = 1))::int as outcome_count,
           round(sum(goal_err)::numeric / count(*), 4) as avg_goal_error,
           rank() over (
             partition by month_key
             order by sum(pts) desc,
                      (count(*) filter (where pts = 3)) desc,
                      (count(*) filter (where pts = 1)) desc,
                      round(sum(goal_err)::numeric / count(*), 4) asc
           ) as rnk
    from scored
    group by month_key, user_id
  ),
  winners as (
    select *, (count(*) over (partition by month_key)) > 1 as is_shared
    from totals where rnk = 1
  ),
  ins as (
    insert into competition_awards
      (competition_id, period_type, period_key, user_id, points, shared, stats)
    select p_comp_id, 'month', w.month_key, w.user_id, w.points, w.is_shared,
           jsonb_build_object('exact', w.exact_count, 'outcome', w.outcome_count,
                              'matches', w.matches, 'goal_error', w.avg_goal_error)
    from winners w
    on conflict do nothing
    returning 1
  )
  select count(*) into v_months from ins;

  return v_rounds + v_months;
end;
$$;

revoke execute on function public.award_competition_periods(uuid) from public, anon;
grant execute on function public.award_competition_periods(uuid) to authenticated, service_role;

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- 1) Leddet er der. Forvent begge = true.
-- select
--   pg_get_viewdef('public.competition_match_points'::regclass) like '%joined_at%'  as view_ok,
--   pg_get_functiondef('public.award_competition_periods(uuid)'::regprocedure)
--     like '%joined_at%'                                                            as fn_ok;

-- 2) Hvem taber point ved kørslen, og hvor mange? Kør FØR og EFTER: differencen
--    er præcis de gæt, der kom med udefra. Nul rækker = ingen har meldt sig sent.
-- select cp.competition_id, cp.user_id, count(*) as taeller_ikke_laengere
--   from public.competition_participants cp
--   join public.competition_matches cm on cm.competition_id = cp.competition_id
--   join public.matches m on m.id = cm.match_id
--   join public.predictions pr on pr.match_id = m.id and pr.user_id = cp.user_id
--  where m.home_score is not null
--    and public.match_lock_at(m.kickoff_at, m.kickoff_tbd) <= cp.joined_at
--  group by 1, 2
--  order by 3 desc;

-- 3) Ingen ændring for den, der har været med fra start. Forvent 0.
--    (Opretteren melder sig i samme sekund, konkurrencen laves, og
--    filterTippable har allerede sorteret de låste kampe fra.)
-- select count(*)
--   from public.competition_participants cp
--   join public.competitions c on c.id = cp.competition_id
--   join public.competition_matches cm on cm.competition_id = cp.competition_id
--   join public.matches m on m.id = cm.match_id
--   join public.predictions pr on pr.match_id = m.id and pr.user_id = cp.user_id
--  where cp.user_id = c.created_by
--    and public.match_lock_at(m.kickoff_at, m.kickoff_tbd) <= cp.joined_at;

-- ============================================================================
-- Tilbagerulning
-- ============================================================================
-- Gen-kør sql/story_engine_v2_day.sql (viewet) og sql/competition_awards.sql
-- (funktionen). Begge er idempotente og bærer den gamle udgave uændret.
-- Ingen rækker er rørt af denne migrering, så der er intet at gendanne.
