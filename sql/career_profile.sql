-- Prediction Champ — Karriereprofil v1
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS"
-- (funktionen er security definer og læser på tværs af RLS — jf. DOCUMENTATION.md afsnit 13).
--
-- Spec: docs/features/karriereprofil-v1.md.
--
-- Ét RPC samler hele profil-læsningen i databasen (mønster som admin_user_stats()
-- i sql/user_stats.sql). Adgang kræver kun, at man er logget ind (K1 udvidet,
-- juli 2026): på Championship er ALLE automatisk med, og navn, rating, point og
-- præcise hits er i forvejen offentlige på Rating-/Championship-fanerne — den
-- gamle delt-liga/konkurrence-gate afviste derfor folk, man reelt konkurrerer med,
-- og beskyttede intet, der ikke allerede stod på en rangliste.
--
-- Det personlige er stadig privat: milepæle (stories, RLS) og rivaler returneres
-- kun for ens egen profil.
--
-- Basistal og titler bygger på det SAMME 3/1-udtryk som round_standings/
-- season_standings (F2: 3-1-0 er fastfrosset overalt), så profilens tal altid
-- matcher Championship-fanen for samme bruger.
--
-- Milepæle hentes IKKE her — de læses separat client-side via den eksisterende
-- RLS-læsning af stories (kun egne rækker), så de forbliver private.
--
-- SKEMA (verificeret mod sql/schema.sql):
--   profiles(id, display_name, created_at),
--   ratings(user_id, scope, rating, rounds_played, provisional),
--   rating_history(user_id, scope, round_key, rating_after, delta),
--   matches(id, kickoff_at, round_key, home_score, away_score, season_id),
--   predictions(user_id, match_id, pred_home, pred_away),
--   view monthly_standings(month, scope, user_id, total_points, matches, exact_count),
--   view round_standings(round_key, user_id, matches, total_points, exact_count),
--   stories(user_id, rule, payload).

create or replace function public.career_profile(profile_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_own   boolean := (profile_user_id = auth.uid());
  v_rivals jsonb := '[]'::jsonb;
  months text[] := array['januar','februar','marts','april','maj','juni','juli','august','september','oktober','november','december'];
  result jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- ---------- K1: adgang ----------
  -- Enhver indlogget bruger må se enhver karriere (hoved, titler, kurve, basistal).
  -- Kun et ukendt id afvises — ellers ville svaret være et hoved uden navn.
  if not exists (select 1 from public.profiles where id = profile_user_id) then
    raise exception 'not found';
  end if;

  -- ---------- Rivaler (kun egen profil — private, jf. K1) ----------
  -- Ren stories-optælling (K3): tæl rival-navn i head-to-head- og stime-historier.
  if v_own then
    select coalesce(jsonb_agg(jsonb_build_object('rival', rival, 'count', c) order by c desc), '[]'::jsonb)
    into v_rivals
    from (
      select payload->>'rival' as rival, count(*)::int as c
      from public.stories
      where user_id = profile_user_id
        and rule in ('H2H_PASS', 'STREAK')
        and payload->>'rival' is not null
      group by payload->>'rival'
      order by c desc
      limit 3
    ) t;
  end if;

  select jsonb_build_object(

    -- ---------- Hoved ----------
    'head', jsonb_build_object(
      'user_id',      profile_user_id,
      'display_name', (select display_name from public.profiles where id = profile_user_id),
      'created_at',   (select created_at   from public.profiles where id = profile_user_id),
      'rating',       (select round(rating)::int from public.ratings where user_id = profile_user_id and scope = 'ALL'),
      'provisional',  (select provisional  from public.ratings where user_id = profile_user_id and scope = 'ALL'),
      'rounds_played',(select rounds_played from public.ratings where user_id = profile_user_id and scope = 'ALL'),
      'move', (select round(delta)::int from public.rating_history
               where user_id = profile_user_id and scope = 'ALL'
               order by round_key desc limit 1)
    ),

    -- ---------- Titler ----------
    'titles', jsonb_build_object(
      -- Månedstitler: afsluttede måneder (alle kampe spillet) hvor brugeren er nr. 1.
      'monthly', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'month',      mw.month,
                 'month_name', months[cast(substring(mw.month from 6 for 2) as int)] || ' ' || substring(mw.month from 1 for 4),
                 'points',     mw.total_points
               ) order by mw.month desc), '[]'::jsonb)
        from (
          select distinct on (ms.month) ms.month, ms.user_id, ms.total_points
          from public.monthly_standings ms
          join (
            select to_char(date_trunc('month', kickoff_at), 'YYYY-MM') as month
            from public.matches
            group by 1
            having bool_and(home_score is not null and away_score is not null)
          ) mc on mc.month = ms.month
          where ms.scope = 'ALL'
          order by ms.month, ms.total_points desc, ms.exact_count desc
        ) mw
        where mw.user_id = profile_user_id
      ),
      -- Rundesejre: antal afsluttede runder (alle kampe spillet) hvor brugeren er nr. 1.
      'round_wins', (
        select count(*)::int
        from (
          select rs.round_key, rs.user_id,
            rank() over (partition by rs.round_key
                         order by rs.total_points desc, rs.exact_count desc) as rnk
          from public.round_standings rs
          join (
            select round_key
            from public.matches
            group by round_key
            having bool_and(home_score is not null and away_score is not null)
          ) rc on rc.round_key = rs.round_key
        ) rr
        where rr.user_id = profile_user_id and rr.rnk = 1
      )
    ),

    -- ---------- Ratingkurve (én prik pr. runde) ----------
    -- Provisorisk periode (de første <5 runder) markeres frontend-side.
    'curve', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'round_key',    round_key,
               'rating_after', round(rating_after)::int
             ) order by round_key), '[]'::jsonb)
      from public.rating_history
      where user_id = profile_user_id and scope = 'ALL'
    ),

    -- ---------- Basistal (samme 3/1-kilde som stillingerne) ----------
    'base', (
      select jsonb_build_object(
        'total_points', coalesce(sum(case
              when pr.pred_home = m.home_score and pr.pred_away = m.away_score then 3
              when sign((pr.pred_home - pr.pred_away)::double precision) = sign((m.home_score - m.away_score)::double precision) then 1
              else 0 end), 0)::int,
        'exact_count', coalesce(sum(case
              when pr.pred_home = m.home_score and pr.pred_away = m.away_score then 1
              else 0 end), 0)::int,
        'outcome_count', coalesce(sum(case
              when not (pr.pred_home = m.home_score and pr.pred_away = m.away_score)
                   and sign((pr.pred_home - pr.pred_away)::double precision) = sign((m.home_score - m.away_score)::double precision) then 1
              else 0 end), 0)::int,
        'matches', count(*)::int
      )
      from public.predictions pr
      join public.matches m on m.id = pr.match_id
      where m.home_score is not null and m.away_score is not null
        and pr.pred_home is not null and pr.pred_away is not null
        and pr.user_id = profile_user_id
    ),

    -- ---------- Rivaler ----------
    'rivals', v_rivals,

    'is_own', v_own

  ) into result;

  return result;
end;
$fn$;

grant execute on function public.career_profile(uuid) to authenticated, service_role;
