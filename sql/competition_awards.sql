-- Lokale kåringer: "Ugens bedste" og "Månedens bedste" i én konkurrence (I13).
-- Idempotent — kan køres igen når som helst (kør med "Run without RLS").
--
-- ---------------------------------------------------------------------------
-- Hvorfor
--
-- Runde- og månedskåringer fandtes kun globalt: Championship-fanens virtuelle
-- ligaer summerer på tværs af OFFICIELLE turneringer og kårer "Rundens/Månedens
-- Leagly". En liga, der kører sin egen konkurrence, kunne ikke kåre
-- nogen internt. Denne migrering giver konkurrencer, der har tilvalgt det
-- (`mode_params.awards = true` ved oprettelsen), en PERSISTERET kåring pr.
-- færdigspillet runde og kalendermåned.
--
-- Navnereglen (features/turnering-2.md §3.6) gælder: to niveauer må ikke
-- konkurrere om samme navn. Lokalt hedder det derfor "Ugens bedste" og
-- "Månedens bedste" — aldrig "rundevinder"/"månedsmester", som er reserveret
-- til de globale titler. `period_type = 'round'` er stadig runde-nøglen
-- (tirsdag–mandag), for runden ER produktets uge.
--
-- ---------------------------------------------------------------------------
-- Writer-modellen: lazy, klient-trigget, SECURITY DEFINER (A22)
--
-- Ingen cron. Klienten kalder `award_competition_periods(comp_id)` ved
-- board-åbning; funktionen beregner alt fra grunddata (predictions/matches via
-- `pc_points()`), så klienten kun kan TRIGGE en kåring, aldrig forfalske en.
-- Derfor har tabellen ingen insert/update/delete-policies — funktionen er den
-- eneste skriver. `on conflict do nothing` gør kaldet idempotent, og en kåring
-- er dermed FROSSEN: et resultat, der rettes efter kåringen, omgør den ikke
-- (samme egenskab som en sendt push-besked). Story Engine-kort og push
-- (backloggens B10/B11) kan senere kalde samme funktion som service_role —
-- guarden tillader det allerede.
-- ---------------------------------------------------------------------------

create table if not exists public.competition_awards (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  period_type    text not null check (period_type in ('round', 'month')),
  -- 'round': runde-nøglen (tirsdagens dato, 'YYYY-MM-DD') · 'month': 'YYYY-MM'
  period_key     text not null,
  user_id        uuid not null references auth.users(id) on delete cascade,
  points         integer not null,
  -- Delt førsteplads = én række pr. vinder, alle med shared = true.
  shared         boolean not null default false,
  -- {exact, outcome, matches, goal_error} — nok til et Story-kort eller en
  -- push-besked uden ny migrering (B10/B11 bygger ovenpå, ikke om).
  stats          jsonb not null default '{}'::jsonb,
  awarded_at     timestamptz not null default now(),
  primary key (competition_id, period_type, period_key, user_id)
);

alter table public.competition_awards enable row level security;

-- Kun konkurrencens deltagere kan læse dens kåringer — samme synlighedsgrænse
-- som stillingen på boardet.
drop policy if exists awards_select_participants on public.competition_awards;
create policy awards_select_participants on public.competition_awards
  for select using (
    exists (
      select 1 from public.competition_participants cp
      where cp.competition_id = competition_awards.competition_id
        and cp.user_id = auth.uid()
    )
  );

grant select on public.competition_awards to authenticated, service_role;

-- ============================================================================
-- award_competition_periods(p_comp_id) → antal nye kåringsrækker
-- ============================================================================
-- En runde kåres, når ALLE konkurrencens kampe med den runde-nøgle har
-- resultat. En måned (Europe/Copenhagen) kåres, når alle konkurrencens kampe i
-- måneden har resultat OG kalendermåneden er slut — det sidste beskytter mod,
-- at efterfyldningen (A20) senere lægger en udsat kamp ind i en allerede kåret
-- måned. Stigen er Championship-stigen (standings_tiebreakers.sql):
-- point → præcise → udfald → målafvigelse. Består ligestillingen hele stigen,
-- er sejren delt.
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
    select m.id, m.round_key, m.home_score, m.away_score
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
           m.home_score, m.away_score
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

-- Anon har intet at gøre her; authenticated rammer guarden, hvis de ikke er
-- deltagere. service_role er til B10/B11-opfølgningen.
revoke execute on function public.award_competition_periods(uuid) from public, anon;
grant execute on function public.award_competition_periods(uuid) to authenticated, service_role;

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- 1) Tabel + RLS findes. Forvent én række med rowsecurity = true.
-- select relname, relrowsecurity from pg_class where relname = 'competition_awards';

-- 2) Idempotens: to kald i træk giver 0 nye rækker i andet kald.
-- select award_competition_periods('<comp-id>');
-- select award_competition_periods('<comp-id>');  -- forvent 0

-- 3) Uden opt-in sker intet. Forvent 0 for en konkurrence uden mode_params.awards.
-- select award_competition_periods('<comp-id-uden-awards>');

-- 4) RLS: som ikke-deltager skal denne give 0 rækker.
-- select * from competition_awards where competition_id = '<comp-id>';
