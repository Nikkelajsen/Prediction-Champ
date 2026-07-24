--
-- PostgreSQL database dump
--

\restrict 3hwxK912SFbdSyXyLuf6h9evpqRRuQLIYS0dPU9FlfwCBje4SwTDPiEQU0OfuwS

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10 (Ubuntu 17.10-1.pgdg24.04+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: admin_user_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_user_stats() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  today  date := (now() at time zone 'utc')::date;
  result jsonb;
begin
  -- Kun admins må se statistik om alle brugere.
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    -- Brugere
    'total',   (select count(*) from public.profiles),
    'new_7d',  (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
    'new_30d', (select count(*) from public.profiles where created_at >= now() - interval '30 days'),

    -- Aktivitet
    'dau', (select count(distinct user_id) from public.user_activity_days where day = today),
    'wau', (select count(distinct user_id) from public.user_activity_days where day >= today - 6),
    'mau', (select count(distinct user_id) from public.user_activity_days where day >= today - 29),
    'avg_active_days_30d', (
      select coalesce(round(avg(c)::numeric, 1), 0)
      from (select count(*) c from public.user_activity_days where day >= today - 29 group by user_id) t
    ),

    -- Engagement
    'has_predicted',   (select count(distinct user_id) from public.predictions),
    'never_predicted', (select count(*) from public.profiles p
                        where not exists (select 1 from public.predictions pr where pr.user_id = p.id)),
    'avg_predictions', (
      select coalesce(round(avg(c)::numeric, 1), 0)
      from (select count(*) c from public.predictions group by user_id) t
    ),
    'in_private_league', (select count(distinct user_id) from public.competition_participants),

    -- Frafald
    'inactive_30d', (select count(*) from public.profiles p
                     where not exists (
                       select 1 from public.user_activity_days d
                       where d.user_id = p.id and d.day >= today - 29
                     )),

    -- Kurver
    'signups_by_week', (
      select coalesce(jsonb_agg(jsonb_build_object('week', wk, 'count', c) order by wk), '[]'::jsonb)
      from (
        select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') wk, count(*) c
        from public.profiles
        where created_at is not null and created_at >= now() - interval '84 days'
        group by 1
      ) w
    ),
    'active_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'), 'count', c) order by day), '[]'::jsonb)
      from (
        select day, count(distinct user_id) c
        from public.user_activity_days
        where day >= today - 29
        group by day
      ) d
    )
  ) into result;

  return result;
end;
$$;


--
-- Name: generate_stories(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_stories(p_round_key text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_label text;
  v_month text;
  v_month_name text;
  v_month_last boolean;
  v_rating_total int;
  months text[] := array['januar','februar','marts','april','maj','juni','juli','august','september','oktober','november','december'];
begin
  -- idempotent: fjern rundens historier og genberegn
  delete from public.stories where round_key = p_round_key;

  v_label := to_char(p_round_key::date, 'DD.MM') || ' – ' || to_char(p_round_key::date + 6, 'DD.MM');

  -- ---- point pr. konkurrence/bruger/runde (kun spillede kampe, t.o.m. denne runde) ----
  drop table if exists _se_rp;
  create temporary table _se_rp as
  select cm.competition_id, pr.user_id, m.round_key,
    sum(case when pr.pred_home = m.home_score and pr.pred_away = m.away_score then 3
             when sign(pr.pred_home - pr.pred_away) = sign(m.home_score - m.away_score) then 1
             else 0 end)::int as rpts,
    sum(case when pr.pred_home = m.home_score and pr.pred_away = m.away_score then 1 else 0 end)::int as rexact
  from public.competition_matches cm
  join public.matches m on m.id = cm.match_id
  join public.predictions pr on pr.match_id = m.id
  where m.home_score is not null and m.away_score is not null
    and pr.pred_home is not null and pr.pred_away is not null
    and m.round_key <= p_round_key
  group by cm.competition_id, pr.user_id, m.round_key;

  -- deltagerantal pr. konkurrence (league_size-snapshot)
  drop table if exists _se_size;
  create temporary table _se_size as
  select competition_id, count(*)::int as n
  from public.competition_participants group by competition_id;

  -- kumulativ stilling EFTER runden (t.o.m. p_round_key) + rang
  drop table if exists _se_after;
  create temporary table _se_after as
  select competition_id, user_id, sum(rpts)::int as pts, sum(rexact)::int as ex,
    rank() over (partition by competition_id order by sum(rpts) desc, sum(rexact) desc)::int as rnk
  from _se_rp group by competition_id, user_id;

  -- kumulativ stilling FØR runden (< p_round_key) + rang
  drop table if exists _se_before;
  create temporary table _se_before as
  select competition_id, user_id, sum(rpts)::int as pts, sum(rexact)::int as ex,
    rank() over (partition by competition_id order by sum(rpts) desc, sum(rexact) desc)::int as rnk
  from _se_rp where round_key < p_round_key group by competition_id, user_id;

  -- denne rundes point pr. konkurrence/bruger
  drop table if exists _se_this;
  create temporary table _se_this as
  select competition_id, user_id, rpts, rexact from _se_rp where round_key = p_round_key;

  -- ======== Regel 70 · Rundens vinder (pr. konkurrence) ========
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, t.user_id, t.competition_id, 'ROUND_WON', 70, sz.n,
    jsonb_build_object('points', t.rpts, 'shared', cnt.n_winners > 1),
    '🥇 Du vandt runden ' || v_label || ' i ' || c.name,
    t.rpts || ' point — flest af alle i ' || c.name ||
      case when cnt.n_winners > 1 then ' (delt med ' || (cnt.n_winners - 1) || ' andre).' else '.' end
  from _se_this t
  join (select competition_id, max(rpts) as top from _se_this group by competition_id) mx
    on mx.competition_id = t.competition_id and t.rpts = mx.top and t.rpts > 0
  join (select competition_id, max(rpts) as top, count(*) as n_winners
        from _se_this group by competition_id) cnt
    on cnt.competition_id = t.competition_id and cnt.top = t.rpts
  join _se_size sz on sz.competition_id = t.competition_id and sz.n >= 2
  join public.competitions c on c.id = t.competition_id;

  -- ======== Regel 20 · Førsteplads overtaget (pr. konkurrence) ========
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, a.user_id, a.competition_id, 'LEAD_TAKEN', 20, sz.n,
    jsonb_build_object('gap', a.pts - coalesce(second.pts, 0)),
    '🏆 Du overtog førstepladsen i ' || c.name,
    'Efter runden ' || v_label || ' fører du ' || c.name ||
      '. Forspring til nr. 2: ' || (a.pts - coalesce(second.pts, 0)) || ' point.'
  from _se_after a
  left join _se_before b on b.competition_id = a.competition_id and b.user_id = a.user_id
  join _se_size sz on sz.competition_id = a.competition_id and sz.n >= 2
  join public.competitions c on c.id = a.competition_id
  left join lateral (
    select pts from _se_after a2 where a2.competition_id = a.competition_id and a2.rnk = 2
    order by pts desc limit 1
  ) second on true
  where a.rnk = 1 and coalesce(b.rnk, 999) > 1;

  -- ======== Regel 21 · Førsteplads mistet (pr. konkurrence) ========
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, b.user_id, b.competition_id, 'LEAD_LOST', 21, sz.n,
    jsonb_build_object('rival', pr.display_name, 'gap', lead.pts - a.pts),
    '⚡ ' || pr.display_name || ' vippede dig af førstepladsen i ' || c.name,
    'Du førte ' || c.name || ', men ' || pr.display_name || ' gik forbi i runden ' || v_label ||
      '. Afstand op: ' || (lead.pts - a.pts) || ' point.'
  from _se_before b
  join _se_after a on a.competition_id = b.competition_id and a.user_id = b.user_id
  join _se_size sz on sz.competition_id = b.competition_id and sz.n >= 2
  join public.competitions c on c.id = b.competition_id
  join lateral (
    select user_id, pts from _se_after a2 where a2.competition_id = b.competition_id and a2.rnk = 1 limit 1
  ) lead on true
  join public.profiles pr on pr.id = lead.user_id
  where b.rnk = 1 and a.rnk > 1;

  -- ======== Regel 50 · Comeback (≥3 pladser op, konkurrencer med ≥5 deltagere) ========
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, a.user_id, a.competition_id, 'COMEBACK', 50, sz.n,
    jsonb_build_object('from', b.rnk, 'to', a.rnk, 'gap', top.pts - a.pts),
    '🚀 Fra nr. ' || b.rnk || ' til nr. ' || a.rnk || ' i ' || c.name,
    'Du rykkede ' || (b.rnk - a.rnk) || ' pladser frem i runden ' || v_label ||
      '. Toppen er nu ' || (top.pts - a.pts) || ' point væk.'
  from _se_after a
  join _se_before b on b.competition_id = a.competition_id and b.user_id = a.user_id
  join _se_size sz on sz.competition_id = a.competition_id and sz.n >= 5
  join public.competitions c on c.id = a.competition_id
  join lateral (select pts from _se_after a2 where a2.competition_id = a.competition_id and a2.rnk = 1 limit 1) top on true
  where (b.rnk - a.rnk) >= 3;

  -- ======== Regel 40 · Head-to-head-overhaling (pr. konkurrence, én rival) ========
  -- Forenkling v1: "overhalede denne runde" (var bagud/lige før, foran efter).
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select distinct on (competition_id, user_id)
    p_round_key, user_id, competition_id, 'H2H_PASS', 40, league_size, payload, headline, body
  from (
    select a.competition_id, a.user_id, sz.n as league_size,
      jsonb_build_object('rival', pr.display_name, 'gap', a.pts - ao.pts) as payload,
      '🔄 Du er nu foran ' || pr.display_name || ' i ' || c.name as headline,
      'Efter runden ' || v_label || ' fører du jeres duel i ' || c.name ||
        ' med ' || (a.pts - ao.pts) || ' point.' as body,
      (a.pts - ao.pts) as gap
    from _se_after a
    join _se_after ao on ao.competition_id = a.competition_id and ao.user_id <> a.user_id
    join _se_before b on b.competition_id = a.competition_id and b.user_id = a.user_id
    join _se_before bo on bo.competition_id = a.competition_id and bo.user_id = ao.user_id
    join _se_size sz on sz.competition_id = a.competition_id and sz.n >= 2
    join public.competitions c on c.id = a.competition_id
    join public.profiles pr on pr.id = ao.user_id
    where a.pts > ao.pts and b.pts <= bo.pts
  ) q
  order by competition_id, user_id, gap asc;  -- tættest overhaling = mest dramatisk

  -- ======== Regel 60 · Stime mod rival (≥3 sejre i træk, aktuel) ========
  drop table if exists _se_pair;
  create temporary table _se_pair as
  select a.competition_id, a.user_id, b.user_id as rival_id, a.round_key,
    (a.rpts > b.rpts) as won, a.rpts as mine, b.rpts as deres
  from _se_rp a
  join _se_rp b on b.competition_id = a.competition_id and b.round_key = a.round_key and b.user_id <> a.user_id;

  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select distinct on (s.competition_id, s.user_id)
    p_round_key, s.user_id, s.competition_id, 'STREAK', 60, sz.n,
    jsonb_build_object('rival', pr.display_name, 'n', s.streak, 'mine', s.mine, 'deres', s.deres),
    '🔥 ' || s.streak || '. sejr i træk mod ' || pr.display_name || ' i ' || c.name,
    'Du slog ' || pr.display_name || ' igen i runden ' || v_label || ' — ' ||
      s.mine || ' mod ' || s.deres || ' point.'
  from (
    select p.competition_id, p.user_id, p.rival_id,
      coalesce(min(p.rn) filter (where not p.won) - 1, count(*))::int as streak,
      max(p.mine) filter (where p.rn = 1) as mine,
      max(p.deres) filter (where p.rn = 1) as deres,
      bool_or(p.rn = 1 and p.round_key = p_round_key) as current
    from (
      select competition_id, user_id, rival_id, round_key, won, mine, deres,
        row_number() over (partition by competition_id, user_id, rival_id order by round_key desc) as rn
      from _se_pair
    ) p
    group by p.competition_id, p.user_id, p.rival_id
  ) s
  join _se_size sz on sz.competition_id = s.competition_id
  join public.competitions c on c.id = s.competition_id
  join public.profiles pr on pr.id = s.rival_id
  where s.current and s.streak >= 3
  order by s.competition_id, s.user_id, s.streak desc;

  -- ======== Regel 30 · Ny ratingrekord (global, efter provisorisk periode) ========
  select count(*)::int into v_rating_total from public.ratings where scope = 'ALL';
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, rh.user_id, null, 'RATING_HIGH', 30, null,
    jsonb_build_object('rating', round(rh.rating_after)::int, 'old', round(prev.old)::int, 'rank', rk.rnk, 'total', v_rating_total),
    '📈 Ny personlig ratingrekord: ' || round(rh.rating_after)::int,
    'Din runde ' || v_label || ' sendte dig forbi din hidtidige rekord på ' || round(prev.old)::int ||
      '. Du er nu nr. ' || rk.rnk || ' af ' || v_rating_total || ' på ranglisten.'
  from public.rating_history rh
  join public.ratings r on r.user_id = rh.user_id and r.scope = 'ALL' and coalesce(r.provisional, false) = false
  join lateral (
    select max(rh2.rating_after) as old from public.rating_history rh2
    where rh2.user_id = rh.user_id and rh2.scope = 'ALL' and rh2.round_key < p_round_key
  ) prev on true
  join lateral (
    select rank() over (order by rating desc)::int as rnk, user_id
    from public.ratings where scope = 'ALL'
  ) rk on rk.user_id = rh.user_id
  where rh.scope = 'ALL' and rh.round_key = p_round_key
    and prev.old is not null and rh.rating_after > prev.old;

  -- ======== Regel 10 · Månedens Champ (global, når runden lukker måneden) ========
  v_month := to_char(p_round_key::date, 'YYYY-MM');
  v_month_name := months[cast(to_char(p_round_key::date, 'MM') as int)];
  select not exists (
    select 1 from public.matches m
    where m.round_key > p_round_key and to_char(m.round_key::date, 'YYYY-MM') = v_month
      and m.home_score is not null
  ) into v_month_last;

  if v_month_last then
    insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
    select p_round_key, w.user_id, null, 'MONTH_CHAMP', 10, null,
      jsonb_build_object('month', v_month_name, 'points', w.total_points, 'gap', w.total_points - coalesce(sec.total_points, 0)),
      '👑 Du er Månedens Prediction Champ — ' || v_month_name,
      w.total_points || ' point — flest af alle i ' || v_month_name ||
        case when sec.total_points is not null then '. Nr. 2 var ' || (w.total_points - sec.total_points) || ' point efter.' else '.' end
    from (
      select user_id, total_points, exact_count
      from public.monthly_standings where month = v_month and scope = 'ALL'
      order by total_points desc, exact_count desc limit 1
    ) w
    left join lateral (
      select total_points from public.monthly_standings
      where month = v_month and scope = 'ALL' and user_id <> w.user_id
      order by total_points desc, exact_count desc limit 1
    ) sec on true;
  end if;

  -- ======== Regel 80 · Perfekt træfsikkerhed (global, ≥3 præcise i runden) ========
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, rs.user_id, null, 'SHARP', 80, null,
    jsonb_build_object('n', rs.exact_count, 'points', rs.total_points),
    '🎯 ' || rs.exact_count || ' præcise resultater i runden',
    'Du ramte ' || rs.exact_count || ' kampe præcist i runden ' || v_label ||
      ' — ' || rs.total_points || ' point i alt.'
  from public.round_standings rs
  where rs.round_key = p_round_key and rs.exact_count >= 3;

  drop table if exists _se_rp;
  drop table if exists _se_size;
  drop table if exists _se_after;
  drop table if exists _se_before;
  drop table if exists _se_this;
  drop table if exists _se_pair;
end;
$$;


--
-- Name: is_group_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_group_admin(gid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid() and role = 'admin'
  );
$$;


--
-- Name: is_group_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_group_member(gid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid()
  );
$$;


--
-- Name: move_competition_to_group(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.move_competition_to_group(p_comp_id uuid, p_group_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.competitions c
    where c.id = p_comp_id and c.created_by = auth.uid()
  ) then
    raise exception 'Kun konkurrencens opretter kan flytte den';
  end if;

  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = auth.uid()
  ) then
    raise exception 'Du er ikke medlem af den valgte liga';
  end if;

  update public.competitions set group_id = p_group_id where id = p_comp_id;

  insert into public.group_members (group_id, user_id, role)
  select p_group_id, cp.user_id, 'member'
  from public.competition_participants cp
  where cp.competition_id = p_comp_id
  on conflict (group_id, user_id) do nothing;
end;
$$;


--
-- Name: pc_points(integer, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pc_points(ph integer, pa integer, hs integer, as_ integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  select case
    when ph is null or pa is null or hs is null or as_ is null then null
    when ph = hs and pa = as_ then 3
    when sign(ph - pa) = sign(hs - as_) then 1
    else 0 end;
$$;


--
-- Name: recompute_ratings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_ratings() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare r record;
begin
  delete from rating_history where scope = 'ALL';
  delete from ratings where scope = 'ALL';

  drop table if exists _rs;
  create temp table _rs as
  select m.round_key,
         p.user_id,
         sum(pc_points(p.pred_home, p.pred_away, m.home_score, m.away_score)) as pts,
         count(*) as n,
         sum(case when p.pred_home = m.home_score and p.pred_away = m.away_score then 1 else 0 end) as exacts
  from predictions p
  join matches m on m.id = p.match_id
  where m.home_score is not null and m.away_score is not null
    and p.pred_home is not null and p.pred_away is not null
  group by m.round_key, p.user_id;

  drop table if exists _cur;
  create temp table _cur (user_id uuid primary key, rating numeric, rounds_played int);
  drop table if exists _step;
  create temp table _step (user_id uuid, d numeric, rating_after numeric, score numeric, n int, rnk int);

  for r in select distinct round_key from _rs order by round_key loop
    insert into _cur(user_id, rating, rounds_played)
    select rs.user_id, 1000, 0 from _rs rs
    where rs.round_key = r.round_key
      and not exists (select 1 from _cur c where c.user_id = rs.user_id);

    truncate _step;
    insert into _step(user_id, d, rating_after, score, n, rnk)
    with pt as (
      select rs.user_id, rs.pts::numeric / rs.n as score, rs.exacts, rs.n,
             c.rating, c.rounds_played
      from _rs rs join _cur c on c.user_id = rs.user_id
      where rs.round_key = r.round_key
    ),
    agg as (
      select u.user_id, u.rating, u.rounds_played, u.score, u.n,
             count(*) as others,
             sum(case when u.score > v.score
                        or (u.score = v.score and u.exacts > v.exacts) then 1
                      when u.score = v.score and u.exacts = v.exacts then 0.5
                      else 0 end) as s_sum,
             sum(1.0 / (1 + power(10, (v.rating - u.rating) / 400.0))) as e_sum
      from pt u join pt v on v.user_id <> u.user_id
      group by u.user_id, u.rating, u.rounds_played, u.score, u.n
    ),
    solo as (
      select user_id, rating, rounds_played, score, n,
             0::numeric as others, 0::numeric as s_sum, 0::numeric as e_sum
      from pt where (select count(*) from pt) = 1
    ),
    allrows as (select * from agg union all select * from solo),
    d as (
      select user_id, rating, score, n,
             case when others = 0 then 0
                  else (case when rounds_played < 5 then 32 else 24 end)::numeric
                       / others * (s_sum - e_sum) end as d
      from allrows
    )
    select user_id, d, rating + d as rating_after, score, n,
           rank() over (order by score desc) as rnk
    from d;

    update _cur c
      set rating = s.rating_after, rounds_played = c.rounds_played + 1
    from _step s where s.user_id = c.user_id;

    insert into rating_history(user_id, scope, round_key, rating_after, delta, round_score, matches_predicted, rnk)
    select user_id, 'ALL', r.round_key, rating_after, d, score, n, rnk from _step;
  end loop;

  insert into ratings(user_id, scope, rating, rounds_played, provisional, updated_at)
  select user_id, 'ALL', rating, rounds_played, rounds_played < 5, now() from _cur;

  drop table if exists _rs; drop table if exists _cur; drop table if exists _step;
end;
$$;


--
-- Name: recompute_ratings_if_scores_changed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_ratings_if_scores_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  v_round text;
begin
  -- saml berørte round_keys, afhængigt af operationen (kun når et resultat reelt ændres)
  drop table if exists _se_changed_rounds;
  create temporary table _se_changed_rounds (round_key text);

  if tg_op = 'INSERT' then
    insert into _se_changed_rounds
      select distinct round_key from new_rows
      where (home_score is not null or away_score is not null) and round_key is not null;
  elsif tg_op = 'UPDATE' then
    insert into _se_changed_rounds
      select distinct n.round_key from new_rows n
      join old_rows o on o.id = n.id
      where (n.home_score is distinct from o.home_score or n.away_score is distinct from o.away_score)
        and n.round_key is not null;
  elsif tg_op = 'DELETE' then
    insert into _se_changed_rounds
      select distinct round_key from old_rows
      where (home_score is not null or away_score is not null) and round_key is not null;
  end if;

  if exists (select 1 from _se_changed_rounds) then
    perform public.recompute_ratings();

    -- historier for berørte, nu fuldt afsluttede runder — best-effort, må aldrig
    -- kunne blokere resultat-lagring/rating (derfor exception-guarden).
    begin
      for v_round in (select distinct round_key from _se_changed_rounds) loop
        if exists (select 1 from public.matches m where m.round_key = v_round)
           and not exists (
             select 1 from public.matches m
             where m.round_key = v_round and (m.home_score is null or m.away_score is null)
           )
        then
          perform public.generate_stories(v_round);
        end if;
      end loop;
    exception when others then
      raise notice 'generate_stories fejlede (ignoreret, resultater/rating er uberørte): %', sqlerrm;
    end;
  end if;

  drop table if exists _se_changed_rounds;
  return null;
end;
$$;


--
-- Name: round_key(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.round_key(ts timestamp with time zone) RETURNS date
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  d date := ts::date;
  dow int := extract(dow from d)::int; -- 0=søn .. 2=tir .. 6=lør
  diff int := (dow - 2 + 7) % 7;
begin
  return d - diff;
end;
$$;


--
-- Name: touch_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_activity() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.uid() is null then
    return;
  end if;

  update public.profiles
    set last_seen_at = now()
    where id = auth.uid();

  insert into public.user_activity_days (user_id, day)
  values (auth.uid(), (now() at time zone 'utc')::date)
  on conflict (user_id, day) do nothing;
end;
$$;


--
-- Name: trg_recompute_ratings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_recompute_ratings() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform recompute_ratings();
  return null;
end; $$;


--
-- Name: username_available(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.username_available(name text) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select not exists (
    select 1 from public.profiles where lower(display_name) = lower(trim(name))
  );
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: competition_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competition_matches (
    competition_id uuid NOT NULL,
    match_id uuid NOT NULL
);


--
-- Name: competition_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competition_participants (
    competition_id uuid NOT NULL,
    user_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    hidden boolean DEFAULT false NOT NULL
);


--
-- Name: competitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    league_id uuid,
    season_id uuid,
    mode text NOT NULL,
    mode_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    rules jsonb DEFAULT '{"exact": 3, "outcome": 1}'::jsonb NOT NULL,
    invite_code text DEFAULT substr(md5((random())::text), 1, 8) NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    group_id uuid,
    CONSTRAINT competitions_mode_check CHECK ((mode = ANY (ARRAY['full_season'::text, 'team'::text, 'time_range'::text, 'custom'::text, 'random'::text])))
);


--
-- Name: group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_members (
    group_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT group_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])))
);


--
-- Name: groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    invite_code text DEFAULT substr(md5(((random())::text || (clock_timestamp())::text)), 1, 8) NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT groups_name_check CHECK (((char_length(name) >= 2) AND (char_length(name) <= 40)))
);


--
-- Name: stories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    round_key text NOT NULL,
    user_id uuid NOT NULL,
    competition_id uuid,
    rule text NOT NULL,
    priority integer NOT NULL,
    league_size integer,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    headline text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    dismissed_at timestamp with time zone
);


--
-- Name: latest_story; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.latest_story WITH (security_invoker='on') AS
 SELECT DISTINCT ON (user_id, round_key) id,
    round_key,
    user_id,
    competition_id,
    rule,
    priority,
    league_size,
    payload,
    headline,
    body,
    created_at,
    dismissed_at
   FROM public.stories
  ORDER BY user_id, round_key, priority, league_size DESC NULLS LAST, competition_id;


--
-- Name: leagues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leagues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    country text,
    api_league_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_visible boolean DEFAULT true NOT NULL
);


--
-- Name: matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    season_id uuid NOT NULL,
    home_team_id uuid NOT NULL,
    away_team_id uuid NOT NULL,
    kickoff_at timestamp with time zone NOT NULL,
    round_key date GENERATED ALWAYS AS (public.round_key(kickoff_at)) STORED,
    home_score integer,
    away_score integer,
    status text DEFAULT 'scheduled'::text NOT NULL,
    api_fixture_id text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    stage_name text
);


--
-- Name: predictions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.predictions (
    user_id uuid NOT NULL,
    match_id uuid NOT NULL,
    pred_home integer NOT NULL,
    pred_away integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: monthly_standings; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.monthly_standings AS
 SELECT to_char(date_trunc('month'::text, m.kickoff_at), 'YYYY-MM'::text) AS month,
    'ALL'::text AS scope,
    p.user_id,
    sum(public.pc_points(p.pred_home, p.pred_away, m.home_score, m.away_score)) AS total_points,
    count(*) AS matches,
    sum(
        CASE
            WHEN ((p.pred_home = m.home_score) AND (p.pred_away = m.away_score)) THEN 1
            ELSE 0
        END) AS exact_count
   FROM (public.predictions p
     JOIN public.matches m ON ((m.id = p.match_id)))
  WHERE ((m.home_score IS NOT NULL) AND (m.away_score IS NOT NULL) AND (p.pred_home IS NOT NULL) AND (p.pred_away IS NOT NULL))
  GROUP BY (to_char(date_trunc('month'::text, m.kickoff_at), 'YYYY-MM'::text)), 'ALL'::text, p.user_id;


--
-- Name: notification_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_log (
    user_id uuid NOT NULL,
    key text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    display_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_admin boolean DEFAULT false NOT NULL,
    last_seen_at timestamp with time zone
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rating_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rating_history (
    user_id uuid NOT NULL,
    scope text DEFAULT 'ALL'::text NOT NULL,
    round_key text NOT NULL,
    rating_after numeric NOT NULL,
    delta numeric NOT NULL,
    round_score numeric NOT NULL,
    matches_predicted integer NOT NULL,
    rnk integer NOT NULL
);


--
-- Name: ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ratings (
    user_id uuid NOT NULL,
    scope text DEFAULT 'ALL'::text NOT NULL,
    rating numeric NOT NULL,
    rounds_played integer NOT NULL,
    provisional boolean NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: round_standings; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.round_standings WITH (security_invoker='on') AS
 SELECT m.round_key,
    pr.user_id,
    (count(*))::integer AS matches,
    (sum(
        CASE
            WHEN ((pr.pred_home = m.home_score) AND (pr.pred_away = m.away_score)) THEN 3
            WHEN (sign(((pr.pred_home - pr.pred_away))::double precision) = sign(((m.home_score - m.away_score))::double precision)) THEN 1
            ELSE 0
        END))::integer AS total_points,
    (count(*) FILTER (WHERE ((pr.pred_home = m.home_score) AND (pr.pred_away = m.away_score))))::integer AS exact_count
   FROM (public.predictions pr
     JOIN public.matches m ON ((m.id = pr.match_id)))
  WHERE ((m.home_score IS NOT NULL) AND (m.away_score IS NOT NULL) AND (pr.pred_home IS NOT NULL) AND (pr.pred_away IS NOT NULL))
  GROUP BY m.round_key, pr.user_id;


--
-- Name: season_standings; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.season_standings WITH (security_invoker='on') AS
 SELECT m.season_id,
    pr.user_id,
    (count(*))::integer AS matches,
    (sum(
        CASE
            WHEN ((pr.pred_home = m.home_score) AND (pr.pred_away = m.away_score)) THEN 3
            WHEN (sign(((pr.pred_home - pr.pred_away))::double precision) = sign(((m.home_score - m.away_score))::double precision)) THEN 1
            ELSE 0
        END))::integer AS total_points,
    (count(*) FILTER (WHERE ((pr.pred_home = m.home_score) AND (pr.pred_away = m.away_score))))::integer AS exact_count
   FROM (public.predictions pr
     JOIN public.matches m ON ((m.id = pr.match_id)))
  WHERE ((m.home_score IS NOT NULL) AND (m.away_score IS NOT NULL) AND (pr.pred_home IS NOT NULL) AND (pr.pred_away IS NOT NULL))
  GROUP BY m.season_id, pr.user_id;


--
-- Name: seasons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seasons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    name text NOT NULL,
    api_season_id text,
    start_date date,
    end_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    name text NOT NULL,
    api_team_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_activity_days; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_activity_days (
    user_id uuid NOT NULL,
    day date DEFAULT ((now() AT TIME ZONE 'utc'::text))::date NOT NULL
);


--
-- Name: competition_matches competition_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_matches
    ADD CONSTRAINT competition_matches_pkey PRIMARY KEY (competition_id, match_id);


--
-- Name: competition_participants competition_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_participants
    ADD CONSTRAINT competition_participants_pkey PRIMARY KEY (competition_id, user_id);


--
-- Name: competitions competitions_invite_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitions
    ADD CONSTRAINT competitions_invite_code_key UNIQUE (invite_code);


--
-- Name: competitions competitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitions
    ADD CONSTRAINT competitions_pkey PRIMARY KEY (id);


--
-- Name: group_members group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_pkey PRIMARY KEY (group_id, user_id);


--
-- Name: groups groups_invite_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_invite_code_key UNIQUE (invite_code);


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);


--
-- Name: leagues leagues_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leagues
    ADD CONSTRAINT leagues_name_unique UNIQUE (name);


--
-- Name: leagues leagues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leagues
    ADD CONSTRAINT leagues_pkey PRIMARY KEY (id);


--
-- Name: matches matches_api_fixture_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_api_fixture_id_unique UNIQUE (api_fixture_id);


--
-- Name: matches matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_pkey PRIMARY KEY (id);


--
-- Name: notification_log notification_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_log
    ADD CONSTRAINT notification_log_pkey PRIMARY KEY (user_id, key);


--
-- Name: predictions predictions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.predictions
    ADD CONSTRAINT predictions_pkey PRIMARY KEY (user_id, match_id);


--
-- Name: profiles profiles_display_name_len; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_display_name_len CHECK (((char_length(btrim(display_name)) >= 2) AND (char_length(btrim(display_name)) <= 20))) NOT VALID;


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: rating_history rating_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_history
    ADD CONSTRAINT rating_history_pkey PRIMARY KEY (user_id, scope, round_key);


--
-- Name: ratings ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_pkey PRIMARY KEY (user_id, scope);


--
-- Name: seasons seasons_league_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_league_name_unique UNIQUE (league_id, name);


--
-- Name: seasons seasons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_pkey PRIMARY KEY (id);


--
-- Name: stories stories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stories
    ADD CONSTRAINT stories_pkey PRIMARY KEY (id);


--
-- Name: stories stories_round_key_user_id_rule_competition_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stories
    ADD CONSTRAINT stories_round_key_user_id_rule_competition_id_key UNIQUE (round_key, user_id, rule, competition_id);


--
-- Name: teams teams_league_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_league_name_unique UNIQUE (league_id, name);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: user_activity_days user_activity_days_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activity_days
    ADD CONSTRAINT user_activity_days_pkey PRIMARY KEY (user_id, day);


--
-- Name: competitions_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX competitions_group_idx ON public.competitions USING btree (group_id);


--
-- Name: group_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX group_members_user_idx ON public.group_members USING btree (user_id);


--
-- Name: matches_away_team_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_away_team_id_idx ON public.matches USING btree (away_team_id);


--
-- Name: matches_home_team_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_home_team_id_idx ON public.matches USING btree (home_team_id);


--
-- Name: matches_season_id_round_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_season_id_round_key_idx ON public.matches USING btree (season_id, round_key);


--
-- Name: profiles_display_name_lower_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_display_name_lower_idx ON public.profiles USING btree (lower(display_name));


--
-- Name: push_subscriptions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions USING btree (user_id);


--
-- Name: stories_user_round_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stories_user_round_idx ON public.stories USING btree (user_id, round_key);


--
-- Name: matches matches_recompute_ratings_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER matches_recompute_ratings_del AFTER DELETE ON public.matches REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_ratings_if_scores_changed();


--
-- Name: matches matches_recompute_ratings_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER matches_recompute_ratings_ins AFTER INSERT ON public.matches REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_ratings_if_scores_changed();


--
-- Name: matches matches_recompute_ratings_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER matches_recompute_ratings_upd AFTER UPDATE ON public.matches REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_ratings_if_scores_changed();


--
-- Name: competition_matches competition_matches_competition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_matches
    ADD CONSTRAINT competition_matches_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES public.competitions(id) ON DELETE CASCADE;


--
-- Name: competition_matches competition_matches_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_matches
    ADD CONSTRAINT competition_matches_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;


--
-- Name: competition_participants competition_participants_competition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_participants
    ADD CONSTRAINT competition_participants_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES public.competitions(id) ON DELETE CASCADE;


--
-- Name: competition_participants competition_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_participants
    ADD CONSTRAINT competition_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: competitions competitions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitions
    ADD CONSTRAINT competitions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: competitions competitions_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitions
    ADD CONSTRAINT competitions_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE SET NULL;


--
-- Name: competitions competitions_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitions
    ADD CONSTRAINT competitions_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: competitions competitions_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitions
    ADD CONSTRAINT competitions_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);


--
-- Name: group_members group_members_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;


--
-- Name: group_members group_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: groups groups_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: matches matches_away_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_away_team_id_fkey FOREIGN KEY (away_team_id) REFERENCES public.teams(id);


--
-- Name: matches matches_home_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_home_team_id_fkey FOREIGN KEY (home_team_id) REFERENCES public.teams(id);


--
-- Name: matches matches_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;


--
-- Name: notification_log notification_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_log
    ADD CONSTRAINT notification_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: predictions predictions_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.predictions
    ADD CONSTRAINT predictions_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;


--
-- Name: predictions predictions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.predictions
    ADD CONSTRAINT predictions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: rating_history rating_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_history
    ADD CONSTRAINT rating_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: ratings ratings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: seasons seasons_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;


--
-- Name: stories stories_competition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stories
    ADD CONSTRAINT stories_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES public.competitions(id) ON DELETE CASCADE;


--
-- Name: stories stories_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stories
    ADD CONSTRAINT stories_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: teams teams_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;


--
-- Name: user_activity_days user_activity_days_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activity_days
    ADD CONSTRAINT user_activity_days_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: competition_participants comp_participants_delete_own_unlocked; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comp_participants_delete_own_unlocked ON public.competition_participants FOR DELETE TO authenticated USING (((user_id = auth.uid()) AND (NOT (EXISTS ( SELECT 1
   FROM ((public.competition_matches cm
     JOIN public.matches m ON ((m.id = cm.match_id)))
     JOIN public.predictions p ON (((p.match_id = m.id) AND (p.user_id = auth.uid()))))
  WHERE ((cm.competition_id = competition_participants.competition_id) AND ((m.home_score IS NOT NULL) OR (EXISTS ( SELECT 1
           FROM public.matches m2
          WHERE ((m2.round_key = m.round_key) AND (NOT (m2.season_id IS DISTINCT FROM m.season_id)) AND (m2.kickoff_at IS NOT NULL) AND (m2.kickoff_at <= (now() + '01:00:00'::interval))))))))))));


--
-- Name: competition_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competition_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: competition_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competition_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: competitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;

--
-- Name: competitions create competitions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "create competitions" ON public.competitions FOR INSERT WITH CHECK ((created_by = auth.uid()));


--
-- Name: competitions creator deletes competitions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "creator deletes competitions" ON public.competitions FOR DELETE USING ((created_by = auth.uid()));


--
-- Name: competition_matches creator inserts competition_matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "creator inserts competition_matches" ON public.competition_matches FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.competitions c
  WHERE ((c.id = competition_matches.competition_id) AND (c.created_by = auth.uid())))));


--
-- Name: group_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

--
-- Name: group_members group_members_delete_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY group_members_delete_self ON public.group_members FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: group_members group_members_insert_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY group_members_insert_self ON public.group_members FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND ((role = 'member'::text) OR (EXISTS ( SELECT 1
   FROM public.groups g
  WHERE ((g.id = group_members.group_id) AND (g.created_by = auth.uid())))))));


--
-- Name: group_members group_members_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY group_members_select ON public.group_members FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_group_member(group_id)));


--
-- Name: groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

--
-- Name: groups groups_delete_admin_empty; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY groups_delete_admin_empty ON public.groups FOR DELETE TO authenticated USING ((public.is_group_admin(id) AND (NOT (EXISTS ( SELECT 1
   FROM public.competitions c
  WHERE (c.group_id = groups.id))))));


--
-- Name: groups groups_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY groups_insert_own ON public.groups FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid()));


--
-- Name: groups groups_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY groups_select_all ON public.groups FOR SELECT TO authenticated USING (true);


--
-- Name: groups groups_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY groups_update_admin ON public.groups FOR UPDATE TO authenticated USING (public.is_group_admin(id)) WITH CHECK (public.is_group_admin(id));


--
-- Name: matches insert matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "insert matches" ON public.matches FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: predictions insert own predictions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "insert own predictions" ON public.predictions FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: profiles insert own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "insert own profile" ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = id));


--
-- Name: competition_participants join competition; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "join competition" ON public.competition_participants FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: leagues; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;

--
-- Name: matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

--
-- Name: predictions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;

--
-- Name: predictions predictions_delete_own_unlocked; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY predictions_delete_own_unlocked ON public.predictions FOR DELETE TO authenticated USING (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.matches m
  WHERE ((m.id = predictions.match_id) AND (m.home_score IS NULL) AND (NOT (EXISTS ( SELECT 1
           FROM public.matches m2
          WHERE ((m2.round_key = m.round_key) AND (NOT (m2.season_id IS DISTINCT FROM m.season_id)) AND (m2.kickoff_at IS NOT NULL) AND (m2.kickoff_at <= (now() + '01:00:00'::interval)))))))))));


--
-- Name: predictions predictions_select_visible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY predictions_select_visible ON public.predictions FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.matches m
  WHERE ((m.id = predictions.match_id) AND ((m.home_score IS NOT NULL) OR (EXISTS ( SELECT 1
           FROM public.matches m2
          WHERE ((m2.round_key = m.round_key) AND (NOT (m2.season_id IS DISTINCT FROM m.season_id)) AND (m2.kickoff_at IS NOT NULL) AND (m2.kickoff_at <= (now() + '01:00:00'::interval)))))))))));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions push_subscriptions_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_own ON public.push_subscriptions TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: rating_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rating_history ENABLE ROW LEVEL SECURITY;

--
-- Name: rating_history rating_history_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rating_history_read ON public.rating_history FOR SELECT TO authenticated USING (true);


--
-- Name: ratings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

--
-- Name: ratings ratings_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ratings_read ON public.ratings FOR SELECT TO authenticated USING (true);


--
-- Name: competitions read all competitions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read all competitions" ON public.competitions FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: competition_participants read all participation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read all participation" ON public.competition_participants FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: competition_matches read competition matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read competition matches" ON public.competition_matches FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.competition_participants cp
  WHERE ((cp.competition_id = cp.competition_id) AND (cp.user_id = auth.uid())))));


--
-- Name: leagues read leagues; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read leagues" ON public.leagues FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: matches read matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read matches" ON public.matches FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: predictions read predictions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read predictions" ON public.predictions FOR SELECT USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.matches m
  WHERE ((m.id = predictions.match_id) AND ((m.home_score IS NOT NULL) OR (now() >= (m.kickoff_at - '01:00:00'::interval))))))));


--
-- Name: profiles read profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read profiles" ON public.profiles FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: seasons read seasons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read seasons" ON public.seasons FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: teams read teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read teams" ON public.teams FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: seasons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

--
-- Name: stories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;

--
-- Name: stories stories_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stories_select_own ON public.stories FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: stories stories_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stories_update_own ON public.stories FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- Name: matches update matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "update matches" ON public.matches FOR UPDATE USING ((auth.role() = 'authenticated'::text));


--
-- Name: competition_participants update own participation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "update own participation" ON public.competition_participants FOR UPDATE USING ((user_id = auth.uid()));


--
-- Name: predictions update own predictions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "update own predictions" ON public.predictions FOR UPDATE USING ((user_id = auth.uid()));


--
-- Name: profiles update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "update own profile" ON public.profiles FOR UPDATE USING ((auth.uid() = id));


--
-- Name: user_activity_days; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_activity_days ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION admin_user_stats(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_user_stats() TO anon;
GRANT ALL ON FUNCTION public.admin_user_stats() TO authenticated;
GRANT ALL ON FUNCTION public.admin_user_stats() TO service_role;


--
-- Name: FUNCTION generate_stories(p_round_key text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.generate_stories(p_round_key text) TO anon;
GRANT ALL ON FUNCTION public.generate_stories(p_round_key text) TO authenticated;
GRANT ALL ON FUNCTION public.generate_stories(p_round_key text) TO service_role;


--
-- Name: FUNCTION is_group_admin(gid uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_group_admin(gid uuid) TO anon;
GRANT ALL ON FUNCTION public.is_group_admin(gid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_group_admin(gid uuid) TO service_role;


--
-- Name: FUNCTION is_group_member(gid uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_group_member(gid uuid) TO anon;
GRANT ALL ON FUNCTION public.is_group_member(gid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_group_member(gid uuid) TO service_role;


--
-- Name: FUNCTION move_competition_to_group(p_comp_id uuid, p_group_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.move_competition_to_group(p_comp_id uuid, p_group_id uuid) TO anon;
GRANT ALL ON FUNCTION public.move_competition_to_group(p_comp_id uuid, p_group_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.move_competition_to_group(p_comp_id uuid, p_group_id uuid) TO service_role;


--
-- Name: FUNCTION pc_points(ph integer, pa integer, hs integer, as_ integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.pc_points(ph integer, pa integer, hs integer, as_ integer) TO anon;
GRANT ALL ON FUNCTION public.pc_points(ph integer, pa integer, hs integer, as_ integer) TO authenticated;
GRANT ALL ON FUNCTION public.pc_points(ph integer, pa integer, hs integer, as_ integer) TO service_role;


--
-- Name: FUNCTION recompute_ratings(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.recompute_ratings() TO anon;
GRANT ALL ON FUNCTION public.recompute_ratings() TO authenticated;
GRANT ALL ON FUNCTION public.recompute_ratings() TO service_role;


--
-- Name: FUNCTION recompute_ratings_if_scores_changed(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.recompute_ratings_if_scores_changed() TO anon;
GRANT ALL ON FUNCTION public.recompute_ratings_if_scores_changed() TO authenticated;
GRANT ALL ON FUNCTION public.recompute_ratings_if_scores_changed() TO service_role;


--
-- Name: FUNCTION round_key(ts timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.round_key(ts timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION public.round_key(ts timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.round_key(ts timestamp with time zone) TO service_role;


--
-- Name: FUNCTION touch_activity(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.touch_activity() TO anon;
GRANT ALL ON FUNCTION public.touch_activity() TO authenticated;
GRANT ALL ON FUNCTION public.touch_activity() TO service_role;


--
-- Name: FUNCTION trg_recompute_ratings(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_recompute_ratings() TO anon;
GRANT ALL ON FUNCTION public.trg_recompute_ratings() TO authenticated;
GRANT ALL ON FUNCTION public.trg_recompute_ratings() TO service_role;


--
-- Name: FUNCTION username_available(name text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.username_available(name text) TO anon;
GRANT ALL ON FUNCTION public.username_available(name text) TO authenticated;
GRANT ALL ON FUNCTION public.username_available(name text) TO service_role;


--
-- Name: TABLE competition_matches; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.competition_matches TO anon;
GRANT ALL ON TABLE public.competition_matches TO authenticated;
GRANT ALL ON TABLE public.competition_matches TO service_role;


--
-- Name: TABLE competition_participants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.competition_participants TO anon;
GRANT ALL ON TABLE public.competition_participants TO authenticated;
GRANT ALL ON TABLE public.competition_participants TO service_role;


--
-- Name: TABLE competitions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.competitions TO anon;
GRANT ALL ON TABLE public.competitions TO authenticated;
GRANT ALL ON TABLE public.competitions TO service_role;


--
-- Name: TABLE group_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.group_members TO anon;
GRANT ALL ON TABLE public.group_members TO authenticated;
GRANT ALL ON TABLE public.group_members TO service_role;


--
-- Name: TABLE groups; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.groups TO anon;
GRANT ALL ON TABLE public.groups TO authenticated;
GRANT ALL ON TABLE public.groups TO service_role;


--
-- Name: TABLE stories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.stories TO anon;
GRANT ALL ON TABLE public.stories TO authenticated;
GRANT ALL ON TABLE public.stories TO service_role;


--
-- Name: TABLE latest_story; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.latest_story TO anon;
GRANT ALL ON TABLE public.latest_story TO authenticated;
GRANT ALL ON TABLE public.latest_story TO service_role;


--
-- Name: TABLE leagues; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.leagues TO anon;
GRANT ALL ON TABLE public.leagues TO authenticated;
GRANT ALL ON TABLE public.leagues TO service_role;


--
-- Name: TABLE matches; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.matches TO anon;
GRANT ALL ON TABLE public.matches TO authenticated;
GRANT ALL ON TABLE public.matches TO service_role;


--
-- Name: TABLE predictions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.predictions TO anon;
GRANT ALL ON TABLE public.predictions TO authenticated;
GRANT ALL ON TABLE public.predictions TO service_role;


--
-- Name: TABLE monthly_standings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.monthly_standings TO anon;
GRANT ALL ON TABLE public.monthly_standings TO authenticated;
GRANT ALL ON TABLE public.monthly_standings TO service_role;


--
-- Name: TABLE notification_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notification_log TO anon;
GRANT ALL ON TABLE public.notification_log TO authenticated;
GRANT ALL ON TABLE public.notification_log TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE push_subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.push_subscriptions TO anon;
GRANT ALL ON TABLE public.push_subscriptions TO authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;


--
-- Name: TABLE rating_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rating_history TO anon;
GRANT ALL ON TABLE public.rating_history TO authenticated;
GRANT ALL ON TABLE public.rating_history TO service_role;


--
-- Name: TABLE ratings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ratings TO anon;
GRANT ALL ON TABLE public.ratings TO authenticated;
GRANT ALL ON TABLE public.ratings TO service_role;


--
-- Name: TABLE round_standings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.round_standings TO anon;
GRANT ALL ON TABLE public.round_standings TO authenticated;
GRANT ALL ON TABLE public.round_standings TO service_role;


--
-- Name: TABLE season_standings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.season_standings TO anon;
GRANT ALL ON TABLE public.season_standings TO authenticated;
GRANT ALL ON TABLE public.season_standings TO service_role;


--
-- Name: TABLE seasons; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.seasons TO anon;
GRANT ALL ON TABLE public.seasons TO authenticated;
GRANT ALL ON TABLE public.seasons TO service_role;


--
-- Name: TABLE teams; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teams TO anon;
GRANT ALL ON TABLE public.teams TO authenticated;
GRANT ALL ON TABLE public.teams TO service_role;


--
-- Name: TABLE user_activity_days; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_activity_days TO anon;
GRANT ALL ON TABLE public.user_activity_days TO authenticated;
GRANT ALL ON TABLE public.user_activity_days TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict 3hwxK912SFbdSyXyLuf6h9evpqRRuQLIYS0dPU9FlfwCBje4SwTDPiEQU0OfuwS

