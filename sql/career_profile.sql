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
-- K4 (30. juli 2026): tre nye nøgler, alle offentlige (samme niveau som hoved/
-- titler/kurve/basistal — K1). Kun milepæle og rivaler forbliver private.
--   - h2h: ÉT narrativt punkt ved fremmed profil ("I har mødt hinanden N gange
--     — du fører A-B"), ikke en sammenligningsside. Afgrænset, bevidst
--     undtagelse fra beslutningen "H2H bor i Story Engine" — se
--     docs/features/karriereprofil-v1.md §2/§8 (K4) og docs/ROADMAP.md.
--   - records: bedste rating nogensinde, bedste rundeplacering (kun hvis ikke
--     allerede nr. 1 — redundant med titles.round_wins ellers), længste stime
--     af rundesejre i træk. Genbruger samme rank()-stige som round_wins.
--   - footprint: antal ligaer/konkurrencer (group_members/competition_participants).
--
-- SKEMA (verificeret mod sql/schema.sql):
--   profiles(id, display_name, created_at),
--   ratings(user_id, scope, rating, rounds_played, provisional),
--   rating_history(user_id, scope, round_key, rating_after, delta),
--   matches(id, kickoff_at, round_key, home_score, away_score, season_id),
--   predictions(user_id, match_id, pred_home, pred_away),
--   competition_matches(competition_id, match_id),
--   competition_participants(competition_id, user_id, hidden),
--   group_members(group_id, user_id),
--   view monthly_standings(month, scope, user_id, total_points, matches, exact_count),
--   view round_standings(round_key, user_id, matches, total_points, exact_count, avg_goal_error),
--   pc_points(ph, pa, hs, as_) — kanonisk pointfunktion (F2),
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
  v_h2h    jsonb := null;
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

  -- ---------- K4: H2H-narrativ (kun ved fremmed profil, delt konkurrence) ----------
  -- Bevidst, afgrænset undtagelse fra "H2H bor i Story Engine, ikke en
  -- sammenligningsside" (karriereprofil-v1.md) — ÉT narrativt punkt, ingen
  -- tabel, ingen historik-liste. "Et møde" = én runde i en konkurrence begge
  -- deltager i (competition_participants — ikke valgfrit, jf. Story Engines
  -- deltager-afgrænsning), hvor begge har mindst ét scoret tip. pc_points()
  -- kaldes direkte (samme kilde som Story Engine/stillings-views, F2).
  -- Vises uanset om viewer fører eller taber (se K4-begrundelse i specen):
  -- kun viewer selv ser sætningen, tallene er allerede offentlige for delte
  -- konkurrencedeltagere via stillingerne, og Story Engines LEAD_LOST fortæller
  -- allerede den tabende part om nederlag i neutralt sprog.
  if not v_own then
    with shared_comp as (
      select cp1.competition_id
      from public.competition_participants cp1
      join public.competition_participants cp2
        on cp2.competition_id = cp1.competition_id and cp2.user_id = profile_user_id
      where cp1.user_id = v_uid
    ),
    rp as (
      select cm.competition_id, m.round_key, pr.user_id,
        sum(public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score))::int as pts
      from public.competition_matches cm
      join shared_comp sc on sc.competition_id = cm.competition_id
      join public.matches m on m.id = cm.match_id
      join public.predictions pr on pr.match_id = m.id and pr.user_id in (v_uid, profile_user_id)
      where m.home_score is not null and m.away_score is not null
        and pr.pred_home is not null and pr.pred_away is not null
      group by cm.competition_id, m.round_key, pr.user_id
    ),
    paired as (
      select a.competition_id, a.round_key, a.pts as my_pts, b.pts as their_pts
      from rp a
      join rp b on b.competition_id = a.competition_id and b.round_key = a.round_key
        and a.user_id = v_uid and b.user_id = profile_user_id
    )
    select case when count(*) = 0 then null else jsonb_build_object(
      'meetings', count(*)::int,
      'wins',     count(*) filter (where my_pts > their_pts)::int,
      'losses',   count(*) filter (where my_pts < their_pts)::int,
      'draws',    count(*) filter (where my_pts = their_pts)::int
    ) end
    into v_h2h
    from paired;
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
      -- rank() frem for distinct on: en delt titel er en titel for BEGGE — samme
      -- regel som kåringen på Championship-fanen. Rangen bruger hele tiebreaker-
      -- stigen (sql/standings_tiebreakers.sql, src/lib/standings.js).
      'monthly', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'month',      mw.month,
                 'month_name', months[cast(substring(mw.month from 6 for 2) as int)] || ' ' || substring(mw.month from 1 for 4),
                 'points',     mw.total_points
               ) order by mw.month desc), '[]'::jsonb)
        from (
          select ms.month, ms.user_id, ms.total_points,
            rank() over (partition by ms.month
                         order by ms.total_points desc, ms.exact_count desc, ms.outcome_count desc,
                                  ms.round_wins desc, ms.avg_goal_error asc) as rnk
          from public.monthly_standings ms
          join (
            select to_char(date_trunc('month', kickoff_at), 'YYYY-MM') as month
            from public.matches
            group by 1
            having bool_and(home_score is not null and away_score is not null)
          ) mc on mc.month = ms.month
          where ms.scope = 'ALL'
        ) mw
        where mw.user_id = profile_user_id and mw.rnk = 1
      ),
      -- Rundesejre: antal afsluttede runder (alle kampe spillet) hvor brugeren er nr. 1.
      -- Én runde har ingen rundesejre at bryde lighed med, så stigen stopper ved
      -- målafvigelsen. Delt sejr tæller for alle.
      'round_wins', (
        select count(*)::int
        from (
          select rs.round_key, rs.user_id,
            rank() over (partition by rs.round_key
                         order by rs.total_points desc, rs.exact_count desc, rs.outcome_count desc,
                                  rs.avg_goal_error asc) as rnk
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

    -- ---------- H2H (kun fremmed profil, delt konkurrence) ----------
    'h2h', v_h2h,

    -- ---------- Rekorder ("bedste nogensinde") ----------
    -- Offentlig som titler/kurve/basistal — al data er allerede synlig andetsteds
    -- (peak rating er et punkt i den offentlige kurve, rundeplacering er afledt
    -- af samme offentlige round_standings som titles.round_wins). Samme rank()-
    -- stige som round_wins ovenfor — ingen parallel pointberegning (F2).
    'records', (
      with rr as (
        select rs.round_key, rs.user_id,
          rank() over (partition by rs.round_key
                       order by rs.total_points desc, rs.exact_count desc, rs.outcome_count desc,
                                rs.avg_goal_error asc) as rnk
        from public.round_standings rs
        join (
          select round_key
          from public.matches
          group by round_key
          having bool_and(home_score is not null and away_score is not null)
        ) rc on rc.round_key = rs.round_key
      ),
      mine as (
        select round_key, rnk, (rnk = 1) as won
        from rr where user_id = profile_user_id
      ),
      best_rank as (
        select rnk, count(*)::int as cnt
        from mine group by rnk order by rnk asc limit 1
      ),
      streaks as (
        select count(*)::int as len
        from (
          select round_key, won,
            row_number() over (order by round_key)
            - row_number() over (partition by won order by round_key) as grp
          from mine
        ) g
        where won
        group by grp
      ),
      best_streak as (select coalesce(max(len), 0)::int as longest from streaks),
      peak_rating as (
        select rating_after, round_key
        from public.rating_history
        where user_id = profile_user_id and scope = 'ALL'
        order by rating_after desc, round_key asc
        limit 1
      )
      select jsonb_build_object(
        'best_rating',           (select round(rating_after)::int from peak_rating),
        'best_rating_round',     (select round_key from peak_rating),
        'best_round_rank',       (select rnk from best_rank),
        'best_round_rank_count', (select cnt from best_rank),
        'longest_round_streak',  (select longest from best_streak)
      )
    ),

    -- ---------- Fodaftryk (ligaer/konkurrencer) ----------
    -- Offentligt bart antal, ingen navne. Arkiverede (hidden=true) liga-løse
    -- konkurrencer tælles med — hidden er et personligt ryddeflag, ikke
    -- "forladt konkurrencen".
    'footprint', jsonb_build_object(
      'leagues',      (select count(*)::int from public.group_members where user_id = profile_user_id),
      'competitions', (select count(*)::int from public.competition_participants where user_id = profile_user_id)
    ),

    -- ---------- Rivaler ----------
    'rivals', v_rivals,

    'is_own', v_own

  ) into result;

  return result;
end;
$fn$;

grant execute on function public.career_profile(uuid) to authenticated, service_role;
