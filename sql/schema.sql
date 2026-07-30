--
-- PostgreSQL database dump
--

\restrict bW1mVXQKFT0ZczJd0hyaJPWd020KhgFCVgquCnGEF1ubesVEPRRddBUzly91d9t

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
-- Name: admin_analytics_engagement(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_analytics_engagement(p_days integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  result jsonb;
begin
  perform public.analytics_require_admin();

  select jsonb_build_object(
    'window_days', p_days,

    'events', (
      select coalesce(jsonb_object_agg(event_name, jsonb_build_object('count', c, 'users', u)), '{}'::jsonb)
      from (
        select event_name, count(*) as c, count(distinct user_id) as u
        from public.analytics_events
        where created_at >= now() - make_interval(days => p_days)
        group by event_name
      ) t
    ),

    -- "opened_league" dækker BÅDE liga-listen og én bestemt liga (metadata i
    -- klienten skelner via view: "list"/"detail") — Liga Views som ét tal er
    -- league_views_total; league_views_detail (group_id is not null) er den
    -- cut Liga Health-scoren faktisk bruger.
    'league_views_total',  (select count(*) from public.analytics_events
                             where event_name = 'opened_league' and created_at >= now() - make_interval(days => p_days)),
    'league_views_detail', (select count(*) from public.analytics_events
                             where event_name = 'opened_league' and group_id is not null and created_at >= now() - make_interval(days => p_days)),

    'events_by_day', (
      select coalesce(jsonb_object_agg(event_name, series), '{}'::jsonb)
      from (
        select event_name, jsonb_agg(jsonb_build_object('day', day, 'count', c) order by day) as series
        from (
          select event_name, created_at::date as day, count(*) as c
          from public.analytics_events
          where event_name in ('opened_home', 'opened_tip', 'opened_league', 'opened_rating',
                                'opened_career', 'opened_standings', 'opened_championship', 'story_viewed')
            and created_at >= now() - make_interval(days => p_days)
          group by event_name, created_at::date
        ) d
        group by event_name
      ) e
    ),

    -- Push Notification Open Rate. "sent" kommer fra notification_log (ikke
    -- push_sent-events — den findes ikke, se sql/analytics_events.sql).
    -- notification_log claimes FØR web-push-kaldet (sql/push_notifications.sql
    -- + api/send-notifications.js), så en fejlet levering tæller stadig som
    -- sendt — raten er derfor et gulv, ikke et loft.
    'push', (
      with sent as (
        select split_part(key, ':', 1) as kind, count(*) as c
        from public.notification_log
        where sent_at >= now() - make_interval(days => p_days)
        group by 1
      ), opened as (
        select coalesce(metadata->>'kind', 'unknown') as kind, count(*) as c
        from public.analytics_events
        where event_name = 'push_opened' and created_at >= now() - make_interval(days => p_days)
        group by 1
      )
      select jsonb_build_object(
        'sent', coalesce((select sum(c) from sent), 0),
        'opened', coalesce((select sum(c) from opened), 0),
        'open_rate', case when coalesce((select sum(c) from sent), 0) = 0 then null
          else round(100.0 * coalesce((select sum(c) from opened), 0) / (select sum(c) from sent), 1) end,
        'by_kind', coalesce((
          select jsonb_agg(jsonb_build_object(
            'kind', s.kind, 'sent', s.c, 'opened', coalesce(o.c, 0),
            'pct', case when s.c = 0 then null else round(100.0 * coalesce(o.c, 0) / s.c, 1) end
          ) order by s.kind)
          from sent s left join opened o on o.kind = s.kind
        ), '[]'::jsonb),

        -- ---- Push-EFFEKT (juli 2026) ----
        -- Open rate siger, om beskeden blev åbnet. Den siger intet om, hvorvidt
        -- den VIRKEDE. Deadline-påmindelsen er produktets eneste aktive
        -- fastholdelses-værktøj, så det spørgsmål er værd at kunne svare på:
        -- tippede de, der åbnede den, oftere end de, der ikke gjorde?
        --
        -- Enheden er (bruger, runde): én modtaget deadline-påmindelse for én
        -- runde. "Tippede" = mindst ét tip i netop den runde, læst fra
        -- analytics_completion_facts — altså fra predictions, ikke fra loggen.
        --
        -- ⚠️ KORRELATION, IKKE ÅRSAG. Folk, der åbner notifikationer, er de
        -- engagerede i forvejen; forskellen er derfor et LOFT over pushets
        -- reelle effekt, ikke et estimat af den. Det står også i måle-ordbogen
        -- (src/lib/analyticsMetrics.js, `push_effect`), fordi det er den
        -- eneste måde, tallet kan læses forkert på.
        'effect', (
          with sent_rounds as (
            -- Nøglen er `deadline:<season_id>:<round_key>:<dato>` (se
            -- api/send-notifications.js). season_id kan være tom, men indeholder
            -- aldrig et kolon, så felt 3 er altid runde-nøglen. Regex-tjekket
            -- gør parsingen defensiv: en nøgle i et uventet format udelades
            -- frem for at kaste og tage hele Engagement-sektionen med sig.
            select nl.user_id, split_part(nl.key, ':', 3)::date as round_key, min(nl.sent_at) as sent_at
            from public.notification_log nl
            where nl.key like 'deadline:%'
              and nl.sent_at >= now() - make_interval(days => p_days)
              and split_part(nl.key, ':', 3) ~ '^\d{4}-\d{2}-\d{2}$'
            group by 1, 2
          ), opened_rounds as (
            select distinct e.user_id, (e.metadata->>'round_key')::date as round_key
            from public.analytics_events e
            where e.event_name = 'push_opened'
              and e.metadata->>'kind' = 'deadline'
              and e.metadata->>'round_key' ~ '^\d{4}-\d{2}-\d{2}$'
              and e.created_at >= now() - make_interval(days => p_days)
          ), predicted_rounds as (
            select user_id, round_key, bool_or(predicted) as any_predicted
            from public.analytics_completion_facts
            group by 1, 2
          ), locks as (
            select round_key, min(lock_at) as lock_at from public.analytics_round_locks group by 1
          ), j as (
            select s.user_id, s.round_key, s.sent_at, l.lock_at,
              (o.user_id is not null)                as did_open,
              coalesce(p2.any_predicted, false)      as did_predict,
              case
                when l.lock_at is null or l.lock_at <= s.sent_at then null
                when l.lock_at - s.sent_at <  interval '3 hours'  then 1
                when l.lock_at - s.sent_at <  interval '6 hours'  then 2
                when l.lock_at - s.sent_at <  interval '12 hours' then 3
                when l.lock_at - s.sent_at <  interval '24 hours' then 4
                else 5
              end as lead_bucket
            from sent_rounds s
            left join opened_rounds    o  on o.user_id  = s.user_id and o.round_key  = s.round_key
            left join predicted_rounds p2 on p2.user_id = s.user_id and p2.round_key = s.round_key
            left join locks            l  on l.round_key = s.round_key
          )
          select jsonb_build_object(
            'recipients', (select count(*) from j),
            'opened_n',       (select count(*) from j where did_open),
            'opened_pred',    (select count(*) from j where did_open and did_predict),
            'opened_rate',    (select case when count(*) = 0 then null
                                 else round(100.0 * count(*) filter (where did_predict) / count(*), 1) end
                               from j where did_open),
            'not_opened_n',    (select count(*) from j where not did_open),
            'not_opened_pred', (select count(*) from j where not did_open and did_predict),
            'not_opened_rate', (select case when count(*) = 0 then null
                                 else round(100.0 * count(*) filter (where did_predict) / count(*), 1) end
                               from j where not did_open),
            -- Varsel: hvor lang tid før rundelåsen blev beskeden sendt. Den
            -- eneste knap, der reelt kan drejes på — cron-tidspunktet.
            'by_lead_time', coalesce((
              select jsonb_agg(jsonb_build_object(
                'bucket', bucket, 'sort', sort, 'n', n, 'predicted', pred,
                'rate', case when n = 0 then null else round(100.0 * pred / n, 1) end
              ) order by sort)
              from (
                select
                  coalesce(lead_bucket, 0) as sort,
                  case coalesce(lead_bucket, 0)
                    when 0 then 'ukendt' when 1 then 'under 3 t' when 2 then '3-6 t'
                    when 3 then '6-12 t' when 4 then '12-24 t'  else 'over 24 t' end as bucket,
                  count(*) as n, count(*) filter (where did_predict) as pred
                from j group by 1, 2
              ) b
            ), '[]'::jsonb)
          )
        )
      )
    ),

    -- Gennemsnitlig sessionstid: sessionisering med 30-minutters inaktivitets-
    -- grænse (SESSION_GAP — den ene tunbare konstant i denne RPC, samme
    -- ånd som vægtene i admin_analytics_league_health nedenfor). En sessions
    -- varighed er FØRSTE hændelse → SIDSTE hændelse, så en session med kun
    -- ét event måler 0 sekunder — gennemsnittet er derfor en NEDRE grænse.
    -- avg_seconds_multi og medianen findes, så tallet kan læses ærligt.
    'session', (
      with e as (
        select user_id, created_at,
               lag(created_at) over (partition by user_id order by created_at) as prev
        from public.analytics_events
        where created_at >= now() - make_interval(days => p_days)
      ), marked as (
        select user_id, created_at,
               case when prev is null or created_at - prev > interval '30 minutes' then 1 else 0 end as is_new
        from e
      ), numbered as (
        select user_id, created_at,
               sum(is_new) over (partition by user_id order by created_at rows between unbounded preceding and current row) as sid
        from marked
      ), sessions as (
        select user_id, sid, min(created_at) as t0, max(created_at) as t1, count(*) as n
        from numbered group by 1, 2
      )
      select jsonb_build_object(
        'sessions', (select count(*) from sessions),
        'avg_seconds', (select coalesce(round(avg(extract(epoch from (t1 - t0)))), 0) from sessions),
        'avg_seconds_multi', (select coalesce(round(avg(extract(epoch from (t1 - t0)))), 0) from sessions where n > 1),
        'median_seconds', (select coalesce(round(percentile_cont(0.5) within group (order by extract(epoch from (t1 - t0)))), 0) from sessions),
        'avg_events', (select coalesce(round(avg(n), 1), 0) from sessions)
      )
    )
  ) into result;

  return result;
end;
$_$;


--
-- Name: admin_analytics_funnel(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_analytics_funnel(p_days integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  result jsonb;
begin
  perform public.analytics_require_admin();

  with base as (
    select
      p.id as user_id,
      p.created_at,
      (select min(gm.joined_at) from public.group_members gm where gm.user_id = p.id) as league_at,
      (select min(cp.joined_at) from public.competition_participants cp where cp.user_id = p.id) as competition_at,
      (select min(pr.updated_at) from public.predictions pr where pr.user_id = p.id) as prediction_at,
      -- SELVSTARTER ELLER INVITERET afgøres af den FØRSTE liga, brugeren kom
      -- med i: oprettede de den selv, eller trådte de ind i en andens?
      -- En bruger UDEN liga regnes som selvstarter: A8-invarianten indmelder
      -- automatisk i ligaen i samme øjeblik, en invitation accepteres, så
      -- ingen liga betyder, at der aldrig blev accepteret en invitation.
      coalesce((
        select g.created_by = p.id
        from public.group_members gm
        join public.groups g on g.id = gm.group_id
        where gm.user_id = p.id
        order by gm.joined_at asc, g.id asc
        limit 1
      ), true) as is_selfstarter
    from public.profiles p
    where p.created_at is not null
  ),
  labelled as (
    select b.*,
      case when b.is_selfstarter then 'selvstarter' else 'inviteret' end as path,
      -- STALL-PARTITIONEN: hvor står brugeren NU. Modsat trin-tællingerne
      -- nedenfor er disse fire gensidigt udelukkende og dækker hele kohorten,
      -- så "hvor mister vi dem" har præcis ét svar pr. bruger.
      case
        when b.prediction_at  is not null then 'gennemfoert'
        when b.competition_at is not null then 'uden_tip'
        when b.league_at      is not null then 'uden_konkurrence'
        else 'uden_liga'
      end as stalled_at
    from base b
  ),
  scopes as (select 'window' as scope union all select 'all_time' as scope),
  tagged as (
    select s.scope, l.*
    from labelled l cross join scopes s
    where s.scope = 'all_time' or l.created_at >= now() - make_interval(days => p_days)
  ),
  -- grouping sets giver både totalen (path = null) og opdelingen i ét pass.
  agg as (
    select
      scope,
      path,
      count(*)                                                as cohort,
      count(*) filter (where league_at      is not null)      as reached_league,
      count(*) filter (where competition_at is not null)      as reached_competition,
      count(*) filter (where prediction_at  is not null)      as reached_prediction,
      count(*) filter (where stalled_at = 'uden_liga')        as stalled_uden_liga,
      count(*) filter (where stalled_at = 'uden_konkurrence') as stalled_uden_konkurrence,
      count(*) filter (where stalled_at = 'uden_tip')         as stalled_uden_tip,
      count(*) filter (where stalled_at = 'gennemfoert')      as stalled_gennemfoert,
      round(percentile_cont(0.5) within group (
        order by extract(epoch from (league_at - created_at)) / 60)::numeric, 1)      as median_min_league,
      round(percentile_cont(0.5) within group (
        order by extract(epoch from (competition_at - created_at)) / 60)::numeric, 1) as median_min_competition,
      round(percentile_cont(0.5) within group (
        order by extract(epoch from (prediction_at - created_at)) / 60)::numeric, 1)  as median_min_prediction
    from tagged
    group by grouping sets ((scope), (scope, path))
  )
  select jsonb_build_object(
    'window_days', p_days,
    'rows', coalesce(jsonb_agg(to_jsonb(a) order by a.scope, a.path nulls first), '[]'::jsonb)
  ) into result
  from agg a;

  return result;
end;
$$;


--
-- Name: admin_analytics_health(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_analytics_health(p_days integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  result jsonb;
  today date := (now() at time zone 'utc')::date;
begin
  perform public.analytics_require_admin();

  select jsonb_build_object(
    'window_days', p_days,

    'active_users_7d',  (select count(distinct user_id) from public.user_activity_days where day >= today - 6),
    'active_users_30d', (select count(distinct user_id) from public.user_activity_days where day >= today - 29),

    'groups_total', (select count(*) from public.groups),
    -- En liga er "aktiv", når nogen faktisk har TIPPET i den for nylig —
    -- ikke blot åbnet appen. groups_with_active_member (nedenfor) er den
    -- svagere version, og gabet mellem de to er selv interessant ("ligaer
    -- hvor folk kigger forbi, men ingen spiller").
    'active_groups', (
      select count(distinct c.group_id)
      from public.predictions p
      join public.matches m on m.id = p.match_id
      join public.competition_matches cm on cm.match_id = m.id
      join public.competitions c on c.id = cm.competition_id
      where c.group_id is not null
        and p.updated_at >= now() - make_interval(days => p_days)
    ),
    -- VINDUE (rettet juli 2026): dag-granulære vinduer er `today - (p_days-1)`,
    -- så p_days = 30 betyder 30 kalenderdage inkl. i dag — ikke 31. Før talte
    -- dette felt (og deadline_miss' nævner) én dag mere end de tidsstempel-
    -- baserede felter i samme svar, så to tal i samme sektion målte over hver
    -- sin periode uden at sige det.
    'groups_with_active_member', (
      select count(distinct gm.group_id)
      from public.group_members gm
      join public.user_activity_days d on d.user_id = gm.user_id
      where d.day >= today - (p_days - 1)
    ),

    'competitions_total', (select count(*) from public.competitions),
    'active_competitions', (
      select count(distinct cm.competition_id)
      from public.predictions p
      join public.matches m on m.id = p.match_id
      join public.competition_matches cm on cm.match_id = m.id
      where p.updated_at >= now() - make_interval(days => p_days)
    ),
    -- "Aktiv" og "i gang" er bevidst to forskellige tal: en konkurrence kan
    -- have masser af historisk aktivitet uden at have en eneste ulåst runde
    -- tilbage (sæsonen er slut), og omvendt en helt ny konkurrence uden
    -- aktivitet endnu, men med ulåste runder foran sig.
    'live_competitions', (
      select count(distinct cm.competition_id)
      from public.competition_matches cm
      join public.matches m on m.id = cm.match_id
      join public.analytics_round_locks rl
        on rl.season_id is not distinct from m.season_id and rl.round_key = m.round_key
      where not rl.is_locked
    ),

    -- Prediction Completion Rate (North Star) — se analytics_completion_facts
    -- for definitionen af "mulige tips" og grain-reglen.
    'completion_rate', (
      select case when count(*) = 0 then null
        else round(100.0 * count(*) filter (where predicted) / count(*), 1) end
      from (
        select distinct user_id, match_id, predicted
        from public.analytics_completion_facts
        where lock_at >= now() - make_interval(days => p_days)
      ) t
    ),
    'completion_slots', (
      select count(*) from (
        select distinct user_id, match_id
        from public.analytics_completion_facts
        where lock_at >= now() - make_interval(days => p_days)
      ) t
    ),
    'completion_done', (
      select count(*) from (
        select distinct user_id, match_id
        from public.analytics_completion_facts
        where lock_at >= now() - make_interval(days => p_days) and predicted
      ) t
    ),
    'completion_rate_all_time', (
      select case when count(*) = 0 then null
        else round(100.0 * count(*) filter (where predicted) / count(*), 1) end
      from (select distinct user_id, match_id, predicted from public.analytics_completion_facts) t
    ),
    -- Det FOREGÅENDE lige så lange vindue, så headline-tallet kan vises med en
    -- retning. Et dashboard uden retning kan sige "62 %", men ikke om 62 % er
    -- på vej op eller ned — og retningen er det eneste, en beslutning kan
    -- hænge på. Nøglen er null, når det foregående vindue ikke havde nok
    -- mulige tips (< MIN_SLOTS_FOR_TREND) at sammenligne med; UI'et skjuler
    -- pilen i det tilfælde i stedet for at kalde støj for et fald.
    'completion_rate_prev', (
      select case when count(*) < 5 then null
        else round(100.0 * count(*) filter (where predicted) / count(*), 1) end
      from (
        select distinct user_id, match_id, predicted
        from public.analytics_completion_facts
        where lock_at >= now() - make_interval(days => 2 * p_days)
          and lock_at <  now() - make_interval(days => p_days)
      ) t
    ),
    'completion_by_week', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'week', week, 'slots', slots, 'done', done,
        'pct', case when slots = 0 then null else round(100.0 * done / slots, 1) end
      ) order by week), '[]'::jsonb)
      from (
        select week, count(*) as slots, count(*) filter (where predicted) as done
        from (
          select distinct week, user_id, match_id, predicted
          from public.analytics_completion_facts
          where week >= today - 84 -- seneste ~12 uger
        ) t
        group by week
      ) w
    ),
    'completion_by_month', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'month', month, 'slots', slots, 'done', done,
        'pct', case when slots = 0 then null else round(100.0 * done / slots, 1) end
      ) order by month), '[]'::jsonb)
      from (
        select month, count(*) as slots, count(*) filter (where predicted) as done
        from (
          select distinct month, user_id, match_id, predicted
          from public.analytics_completion_facts
          where month >= to_char(today - interval '6 months', 'YYYY-MM')
        ) t
        group by month
      ) mth
    ),

    -- Deadline Miss Rate. Enheden er RUNDEN, ikke kampen — det er dér, låsen
    -- og deadline-push'en er forankret. En bruger "missede deadline i runde
    -- R", hvis de havde ≥1 muligt tip i R og NUL af dem blev afgivet — en
    -- bruger der tippede 3 af 5 kampe missede IKKE deadline (det måler
    -- Completion Rate, som dækker delvis udfyldning). Tre tal returneres:
    -- miss_rate (brugerens godkendte formel: missede / AKTIVE brugere,
    -- headline), miss_rate_of_exposed (missede / brugere der reelt HAVDE en
    -- deadline — forhindrer at raten falder kunstigt, når brugerbasen vokser
    -- med folk uden konkurrencer) og round_miss_rate (volumen i runder).
    'deadline_miss', (
      with rounds as (
        select user_id, season_id, round_key, bool_or(predicted) as any_predicted
        from public.analytics_completion_facts
        where lock_at >= now() - make_interval(days => p_days)
        group by 1, 2, 3
      ), active as (
        select count(distinct user_id) as n from public.user_activity_days where day >= today - (p_days - 1)
      )
      select jsonb_build_object(
        'rounds_missed', (select count(*) filter (where not any_predicted) from rounds),
        'rounds_with_deadline', (select count(*) from rounds),
        'round_miss_rate', (select case when count(*) = 0 then null
          else round(100.0 * count(*) filter (where not any_predicted) / count(*), 1) end from rounds),
        'users_missed', (select count(distinct user_id) filter (where not any_predicted) from rounds),
        'users_with_deadline', (select count(distinct user_id) from rounds),
        'active_users', (select n from active),
        'miss_rate', (select case when (select n from active) = 0 then null
          else round(100.0 * (select count(distinct user_id) filter (where not any_predicted) from rounds) / (select n from active), 1) end),
        'miss_rate_of_exposed', (select case when (select count(distinct user_id) from rounds) = 0 then null
          else round(100.0 * (select count(distinct user_id) filter (where not any_predicted) from rounds) / (select count(distinct user_id) from rounds), 1) end)
      )
    ),

    -- Gennemførte spillerunder: kun runder der faktisk indgår i mindst én
    -- konkurrence (ikke blot Sportmonks-runder ingen tipper på), og hvor
    -- ALLE kampe har resultat. BEMÆRK: dette tal er ALT-TID, ikke p_days —
    -- derfor står "(alt tid)" i UI-etiketten, så det ikke læses som om
    -- vinduesvælgeren gælder det.
    'rounds_completed', (
      select count(*) from public.analytics_round_locks rl
      where rl.finished_count = rl.match_count
        and exists (
          select 1 from public.competition_matches cm
          join public.matches m on m.id = cm.match_id
          where m.season_id is not distinct from rl.season_id and m.round_key = rl.round_key
        )
    ),
    'rounds_completed_by_week', (
      select coalesce(jsonb_agg(jsonb_build_object('week', wk, 'count', c) order by wk), '[]'::jsonb)
      from (
        select date_trunc('week', rl.first_kickoff)::date as wk, count(*) as c
        from public.analytics_round_locks rl
        where rl.finished_count = rl.match_count
          and exists (
            select 1 from public.competition_matches cm
            join public.matches m on m.id = cm.match_id
            where m.season_id is not distinct from rl.season_id and m.round_key = rl.round_key
          )
          and rl.first_kickoff >= now() - interval '12 weeks'
        group by 1
      ) r
    )
  ) into result;

  return result;
end;
$$;


--
-- Name: admin_analytics_league_health(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_analytics_league_health(p_days integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  result jsonb;
begin
  perform public.analytics_require_admin();

  with k as (
    select
      28 as retention_min_age_days,   -- medlem skal have været med så længe …
      14 as retention_window_days     -- … og været aktiv inden for så længe
  ),
  win as (
    select
      now() - make_interval(days => p_days)     as t0,
      now() - make_interval(days => 2 * p_days) as t0_prev,
      (now() at time zone 'utc')::date - (p_days - 1) as d0
  ),
  -- GRAIN-REGLEN: ét tip kan ligge i flere konkurrencer i samme liga (delt
  -- predictions-tabel), så alt herunder tælles på distinct (group, user, match).
  -- `predicted` afhænger kun af (user, match) og duplikerer derfor ikke rækken.
  facts as (
    select distinct f.group_id, f.user_id, f.match_id, f.season_id, f.round_key, f.predicted
    from public.analytics_completion_facts f cross join win w
    where f.group_id is not null and f.lock_at >= w.t0
  ),
  facts_prev as (
    select distinct f.group_id, f.user_id, f.match_id, f.predicted
    from public.analytics_completion_facts f cross join win w
    where f.group_id is not null and f.lock_at >= w.t0_prev and f.lock_at < w.t0
  ),
  participation as (
    select group_id,
      count(*)                                                    as slots,
      count(*) filter (where predicted)                           as done,
      -- BREDDE: hvor mange forskellige medlemmer der faktisk tippede. Det
      -- signal v1 manglede helt: "andel aktive medlemmer" målte, om folk
      -- ÅBNEDE appen, ikke om de spillede. En liga hvor én tipper alt og fire
      -- kigger på, og en liga hvor alle fem tipper, kunne få samme score.
      count(distinct user_id) filter (where predicted)             as predictors,
      count(distinct user_id)                                      as exposed_members,
      -- PULS: spillede runder ÷ runder der var noget at spille i.
      count(distinct (season_id, round_key))                       as rounds_available,
      count(distinct (season_id, round_key)) filter (where predicted) as rounds_played
    from facts group by group_id
  ),
  participation_prev as (
    select group_id, count(*) as slots, count(*) filter (where predicted) as done
    from facts_prev group by group_id
  ),
  -- KONCENTRATION: den mest aktive tippers andel af ligaens afgivne tips.
  -- Høj koncentration + få tippere = ligaen bæres af én person, det klassiske
  -- vennegruppe-sammenbrud. Diagnosen bruger `predictors`; dette tal er
  -- nuancen i drill-in'en.
  concentration as (
    select group_id, max(n) as top_n, sum(n) as total_n
    from (select group_id, user_id, count(*) as n from facts where predicted group by 1, 2) t
    group by group_id
  ),
  member_counts as (
    select group_id, count(*) as members from public.group_members group by group_id
  ),
  -- Følger nu p_days. FØR var denne CTE hårdkodet til 30 dage, mens etiketten
  -- fulgte vinduesvælgeren: valgte man "7 dage", viste kolonnen stadig 30
  -- dages tal uden at sige det.
  active_members as (
    select gm.group_id, count(distinct gm.user_id) as n
    from public.group_members gm
    join public.user_activity_days d on d.user_id = gm.user_id
    cross join win w
    where d.day >= w.d0
    group by gm.group_id
  ),
  retention_eligible as (
    select gm.group_id,
      count(*) as eligible,
      count(*) filter (where exists (
        select 1 from public.user_activity_days d
        where d.user_id = gm.user_id
          and d.day >= (now() at time zone 'utc')::date - (select retention_window_days from k)
      )) as retained
    from public.group_members gm
    where gm.joined_at <= now() - make_interval(days => (select retention_min_age_days from k))
    group by gm.group_id
  ),
  story_views as (
    select e.group_id, count(*) as views
    from public.analytics_events e cross join win w
    where e.event_name = 'story_viewed' and e.group_id is not null and e.created_at >= w.t0
    group by e.group_id
  ),
  last_activity as (
    select g.id as group_id, greatest(
      (select max(d.day)::timestamptz from public.group_members gm
        join public.user_activity_days d on d.user_id = gm.user_id where gm.group_id = g.id),
      (select max(p2.updated_at) from public.competitions c
        join public.competition_matches cm on cm.competition_id = c.id
        join public.predictions p2 on p2.match_id = cm.match_id
        where c.group_id = g.id),
      (select max(e.created_at) from public.analytics_events e where e.group_id = g.id)
    ) as last_activity_at
    from public.groups g
  ),
  signals as (
    select
      g.id as group_id, g.name, g.created_at,
      floor(extract(epoch from (now() - g.created_at)) / 86400)::int as age_days,
      coalesce(mc.members, 0)                as members,
      coalesce(am.n, 0)                      as active_members,
      coalesce(pa.predictors, 0)             as predictors,
      coalesce(pa.exposed_members, 0)        as exposed_members,
      coalesce(pa.slots, 0)                  as completion_slots,
      coalesce(pa.done, 0)                   as completion_done,
      coalesce(pa.rounds_available, 0)       as rounds_available,
      coalesce(pa.rounds_played, 0)          as rounds_played,
      coalesce(sv.views, 0)                  as story_views,
      la.last_activity_at,
      case when la.last_activity_at is null then null
        else floor(extract(epoch from (now() - la.last_activity_at)) / 86400)::int end as days_since_activity,
      (select count(*) from public.competitions c where c.group_id = g.id) as competitions_total,
      (select count(distinct cm.competition_id) from public.competitions c
        join public.competition_matches cm on cm.competition_id = c.id
        join public.matches m on m.id = cm.match_id
        join public.analytics_round_locks rl on rl.season_id is not distinct from m.season_id and rl.round_key = m.round_key
        where c.group_id = g.id and not rl.is_locked) as competitions_active,
      case when coalesce(pa.slots, 0) = 0 then null
        else round(100.0 * pa.done / pa.slots, 1) end as completion_rate,
      -- Trend-nøglen er null, når det foregående vindue havde under 5 mulige
      -- tips: en enkelt kamp mere eller mindre må ikke kunne læses som "faldende".
      case when coalesce(pp.slots, 0) < 5 then null
        else round(100.0 * pp.done / pp.slots, 1) end as completion_rate_prev,
      case when coalesce(mc.members, 0) = 0 then null
        else round(100.0 * coalesce(pa.predictors, 0) / mc.members, 1) end as predictor_share,
      case when coalesce(mc.members, 0) = 0 then null
        else round(100.0 * coalesce(am.n, 0) / mc.members, 1) end as active_share,
      case when coalesce(pa.rounds_available, 0) = 0 then null
        else round(100.0 * pa.rounds_played / pa.rounds_available, 1) end as pulse,
      case when coalesce(cn.total_n, 0) = 0 then null
        else round(100.0 * cn.top_n / cn.total_n, 1) end as top_predictor_share,
      re.eligible as retention_eligible,
      re.retained as retention_retained,
      case when coalesce(re.eligible, 0) = 0 then null
        else round(100.0 * re.retained / re.eligible, 1) end as retention_rate
    from public.groups g
    left join member_counts       mc on mc.group_id = g.id
    left join active_members      am on am.group_id = g.id
    left join participation       pa on pa.group_id = g.id
    left join participation_prev  pp on pp.group_id = g.id
    left join concentration       cn on cn.group_id = g.id
    left join retention_eligible  re on re.group_id = g.id
    left join story_views         sv on sv.group_id = g.id
    left join last_activity       la on la.group_id = g.id
  )
  select jsonb_build_object(
    'window_days', p_days,
    'retention_min_age_days', (select retention_min_age_days from k),
    'retention_window_days', (select retention_window_days from k),
    -- Usorteret bevidst: rækkefølgen bestemmes af diagnosens alvor i
    -- klienten (diagnoseLeague), som er det eneste sted, alvor er defineret.
    'leagues', coalesce(jsonb_agg(to_jsonb(s) order by s.name), '[]'::jsonb)
  ) into result
  from signals s;

  return result;
end;
$$;


--
-- Name: admin_analytics_retention(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_analytics_retention() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  result jsonb;
  v_activity_since date;
begin
  perform public.analytics_require_admin();
  select min(day) into v_activity_since from public.user_activity_days;

  with milestones as (
    select unnest(array[1, 4, 12, 26, 52]) as wk
  ),
  user_ret as (
    select m.wk,
      count(*) as eligible,
      count(*) filter (where exists (
        select 1 from public.user_activity_days d
        where d.user_id = p.id
          and d.day >= (p.created_at + make_interval(weeks => m.wk))::date
          and d.day <  (p.created_at + make_interval(weeks => m.wk + 1))::date
      )) as retained
    from public.profiles p
    cross join milestones m
    where p.created_at is not null
      and p.created_at + make_interval(weeks => m.wk + 1) <= now()
    group by m.wk
  ),
  -- Sidste 12 ugentlige kohorter × 5 milepæle, så én dårlig uge er synlig i
  -- stedet for at blive udjævnet af det samlede gennemsnit ovenfor.
  user_cohorts as (
    select date_trunc('week', p.created_at)::date as cohort_week, m.wk,
      count(*) as eligible,
      count(*) filter (where exists (
        select 1 from public.user_activity_days d
        where d.user_id = p.id
          and d.day >= (p.created_at + make_interval(weeks => m.wk))::date
          and d.day <  (p.created_at + make_interval(weeks => m.wk + 1))::date
      )) as retained
    from public.profiles p
    cross join milestones m
    where p.created_at is not null
      and p.created_at + make_interval(weeks => m.wk + 1) <= now()
      and p.created_at >= now() - interval '12 weeks'
    group by 1, m.wk
  ),
  -- Liga-retention: en liga tælles som "i live" ved milepæl N, hvis et
  -- NUVÆRENDE medlem enten har en aktivitetsdag eller afgav et tip i vinduet
  -- [created_at+N uger, created_at+(N+1) uger). Bevidst tilnærmelse:
  -- medlemskab evalueres som det ser ud NU, ikke som det så ud dengang
  -- (leavere er væk) — acceptabelt for et liga-niveau livstegn, og billigere
  -- end at rekonstruere historisk medlemskab.
  league_ret as (
    select m.wk,
      count(*) as eligible,
      count(*) filter (where
        exists (
          select 1 from public.group_members gm
          join public.user_activity_days d on d.user_id = gm.user_id
          where gm.group_id = g.id
            and d.day >= (g.created_at + make_interval(weeks => m.wk))::date
            and d.day <  (g.created_at + make_interval(weeks => m.wk + 1))::date
        )
        or exists (
          select 1 from public.competitions c
          join public.competition_matches cm on cm.competition_id = c.id
          join public.predictions p2 on p2.match_id = cm.match_id
          where c.group_id = g.id
            and p2.updated_at >= (g.created_at + make_interval(weeks => m.wk))
            and p2.updated_at <  (g.created_at + make_interval(weeks => m.wk + 1))
        )
      ) as retained
    from public.groups g
    cross join milestones m
    where g.created_at + make_interval(weeks => m.wk + 1) <= now()
    group by m.wk
  )
  select jsonb_build_object(
    'activity_since', v_activity_since,
    'user_retention', coalesce((
      select jsonb_agg(jsonb_build_object('week', wk, 'eligible', eligible, 'retained', retained,
        'pct', case when eligible = 0 then null else round(100.0 * retained / eligible, 1) end) order by wk)
      from user_ret
    ), '[]'::jsonb),
    'user_cohorts', coalesce((
      select jsonb_agg(jsonb_build_object('cohort_week', cohort_week, 'week', wk, 'eligible', eligible, 'retained', retained,
        'pct', case when eligible = 0 then null else round(100.0 * retained / eligible, 1) end) order by cohort_week, wk)
      from user_cohorts
    ), '[]'::jsonb),
    'league_retention', coalesce((
      select jsonb_agg(jsonb_build_object('week', wk, 'eligible', eligible, 'retained', retained,
        'pct', case when eligible = 0 then null else round(100.0 * retained / eligible, 1) end) order by wk)
      from league_ret
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;


--
-- Name: admin_analytics_stories(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_analytics_stories(p_days integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  result jsonb;
begin
  perform public.analytics_require_admin();

  with win as (select now() - make_interval(days => p_days) as t0),
  -- Regelkataloget som DATA: alle regler, der nogensinde har udløst. En regel,
  -- der har udløst før, men ikke i vinduet, skal stå med 0 — ikke mangle.
  -- Regler, der ALDRIG har udløst, kan ikke ses herfra (de findes kun i
  -- generate_stories()); klienten holder katalogen og markerer dem.
  rules as (select distinct rule from public.stories),
  gen as (
    select s.rule,
      count(*)                                              as generated,
      count(distinct s.user_id)                             as users,
      count(*) filter (where s.dismissed_at is not null)    as dismissed,
      round(avg(s.priority), 1)                             as avg_priority,
      max(s.created_at)                                     as last_generated_at
    from public.stories s cross join win w
    where s.created_at >= w.t0
    group by s.rule
  ),
  ev as (
    select e.metadata->>'rule' as rule,
      count(*) filter (where e.event_name = 'story_viewed')  as viewed,
      count(*) filter (where e.event_name = 'story_shared')  as shared
    from public.analytics_events e cross join win w
    where e.event_name in ('story_viewed', 'story_shared')
      and e.created_at >= w.t0
      and e.metadata->>'rule' is not null
    group by 1
  ),
  joined as (
    select r.rule,
      coalesce(g.generated, 0) as generated,
      coalesce(g.users, 0)     as users,
      coalesce(g.dismissed, 0) as dismissed,
      g.avg_priority,
      g.last_generated_at,
      coalesce(e.viewed, 0)    as viewed,
      coalesce(e.shared, 0)    as shared,
      case when coalesce(g.generated, 0) = 0 then null
        else round(100.0 * coalesce(e.viewed, 0) / g.generated, 1) end as view_rate,
      case when coalesce(g.generated, 0) = 0 then null
        else round(100.0 * g.dismissed / g.generated, 1) end as dismiss_rate,
      case when coalesce(e.viewed, 0) = 0 then null
        else round(100.0 * coalesce(e.shared, 0) / e.viewed, 1) end as share_rate
    from rules r
    left join gen g on g.rule = r.rule
    left join ev  e on e.rule = r.rule
  )
  select jsonb_build_object(
    'window_days', p_days,
    'quiet_tier_min', 90,  -- skal matche QUIET_TIER_MIN i src/lib/stories.js
    'generated_total', (select coalesce(sum(generated), 0) from joined),
    'users_reached', (
      select count(distinct s.user_id) from public.stories s cross join win w where s.created_at >= w.t0
    ),
    -- Dækning: hvor stor en del af de brugere, der HAVDE en afsluttet runde i
    -- vinduet, fik overhovedet en historie. Det tal, v1.1-leverancen blev målt
    -- på ("1 af 8 → 8 af 8 brugere i premiereugen"), gjort permanent.
    'users_with_rounds', (
      select count(distinct f.user_id) from public.analytics_completion_facts f cross join win w
      where f.lock_at >= w.t0
    ),
    'rules', coalesce((
      select jsonb_agg(to_jsonb(j) order by j.generated desc, j.rule) from joined j
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;


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
-- Name: analytics_require_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_require_admin() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'forbidden';
  end if;
end;
$$;


--
-- Name: career_profile(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.career_profile(profile_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_own   boolean := (profile_user_id = auth.uid());
  v_rivals jsonb := '[]'::jsonb;
  v_h2h    jsonb := null;
  -- Tunbar tærskel, navngivet frem for indlejret — samme princip som Story
  -- Engines kalibrerede tærskler (v1.1): ét møde gør ingen til en rival, men i
  -- en ung sæson med få runder vil en høj tærskel give nul rivaler. Hæves, når
  -- der er runder nok til, at 2 møder ikke længere er meget.
  v_rival_min_meetings int := 2;
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
  -- K3 LUKKET (30. juli 2026): rangeres på JÆVNBYRDIGHED fra faktiske møder,
  -- ikke på antal historier.
  --
  -- Før: ren stories-optælling af regel 40 (H2H_PASS) / 60 (STREAK). K3 valgte
  -- den som det billigste udgangspunkt og forudsagde selv problemet: "udvid hvis
  -- den giver for få rivaler i små ligaer". Tragten var for smal — kun 2 af 14
  -- regler skriver et rival-navn, regel 40 kræver en overhaling i netop den
  -- runde og regel 60 en AKTUEL stime på ≥2 sejre, og begge har
  -- `distinct on (competition_id, user_id)`, så der gemmes ÉN rival pr.
  -- konkurrence pr. runde. I en lille liga med stabil rækkefølge sker der
  -- næsten ingen overhalinger → nul rivaler efter 20 runder mod de samme tre
  -- personer. Teksten sagde desuden "Din tætteste rival", men rangeringen målte
  -- ikke tæthed — den målte, hvor dramatisk forholdet havde været.
  --
  -- K3's egen foreslåede udvej (`rating_history.rnk`, placerings-nabo) er
  -- BEVIDST ikke valgt: `rnk` er den globale ratingplacering, så den ville
  -- kunne udpege folk, man ikke deler konkurrence med — i strid med den
  -- ufravigelige designregel fra juli 2026 (en historie må kun nævne personer,
  -- modtageren deler konkurrence med). Denne beregning starter i
  -- `competition_participants` og kan derfor per konstruktion ikke nævne en
  -- fremmed.
  --
  -- INGEN REGRESSION: en story-rival er altid også en møde-rival. Regel 40
  -- kræver en stilling FØR runden for begge parter (altså ≥1 tidligere fælles
  -- runde) og regel 60 kræver ≥2 sejre i træk — begge medfører ≥2 møder, så
  -- alle, den gamle optælling kunne finde, er med her.
  if v_own then
    with pair_matches as (
      -- Kampe fra konkurrencer, hvor BÅDE profilens ejer og modstanderen
      -- deltager. `distinct`: samme kamp kan ligge i flere delte konkurrencer,
      -- og et møde må kun tælle én gang — samme dedup-regel som h2h
      -- (K4-rettelsen 30. juli 2026), her blot pr. modstander.
      select distinct theirs.user_id as rival_id, cm.match_id,
             m.round_key, m.home_score, m.away_score
      from public.competition_participants mine
      join public.competition_participants theirs
        on theirs.competition_id = mine.competition_id
       and theirs.user_id <> profile_user_id
      join public.competition_matches cm on cm.competition_id = mine.competition_id
      join public.matches m on m.id = cm.match_id
      where mine.user_id = profile_user_id
        and m.home_score is not null and m.away_score is not null
    ),
    pair_round as (
      -- Point pr. (modstander, runde, spiller). Hver side tæller de kampe, DEN
      -- selv har tippet — præcis samme semantik som h2h-blokken nedenfor og som
      -- round_standings, der heller ikke normaliserer for antal tippede kampe.
      -- Det er ikke en detalje: samme spørgsmål må ikke få to forskellige svar
      -- to steder i produktet (jf. tiebreaker- og Story Engine-leverancerne),
      -- og møde-tallene her skal stemme med H2H-linjen på den andens profil.
      select pm.rival_id, pm.round_key, pr.user_id,
        sum(public.pc_points(pr.pred_home, pr.pred_away, pm.home_score, pm.away_score))::int as pts
      from pair_matches pm
      join public.predictions pr
        on pr.match_id = pm.match_id
       and pr.user_id in (profile_user_id, pm.rival_id)
      where pr.pred_home is not null and pr.pred_away is not null
      group by pm.rival_id, pm.round_key, pr.user_id
    ),
    paired as (
      select a.rival_id, a.round_key, a.pts as my_pts, b.pts as their_pts
      from pair_round a
      join pair_round b
        on b.rival_id = a.rival_id and b.round_key = a.round_key
       and b.user_id = a.rival_id
      where a.user_id = profile_user_id
    ),
    tally as (
      select rival_id,
        count(*)::int                                   as meetings,
        count(*) filter (where my_pts > their_pts)::int  as wins,
        count(*) filter (where my_pts < their_pts)::int  as losses,
        count(*) filter (where my_pts = their_pts)::int  as draws
      from paired
      group by rival_id
    ),
    story_counts as (
      -- Historier beholdes som FARVE, aldrig som rangering. Joines på
      -- display_name, fordi det er alt, payloaden gemmer: skifter en bruger
      -- navn, mister de gamle historier tilknytningen. Acceptabelt for et
      -- pyntetal — og præcis derfor må rangeringen ikke hvile på det.
      select payload->>'rival' as name, count(*)::int as c
      from public.stories
      where user_id = profile_user_id
        and rule in ('H2H_PASS', 'STREAK')
        and payload->>'rival' is not null
      group by payload->>'rival'
    )
    -- Rangering: mindst forskel mellem sejre og nederlag = mest jævnbyrdig.
    -- Volumen alene ville ikke give rivaler, men blot den ældste medspiller i
    -- den største konkurrence; en rival er nogen, man veksler slag med. Flest
    -- møder bryder lighed, og rival_id sikrer et deterministisk svar ved to
    -- ellers identiske modstandere (samme disciplin som Story Engines laterale
    -- opslag, juli 2026).
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id',  x.rival_id,
             'rival',    x.display_name,
             'meetings', x.meetings,
             'wins',     x.wins,
             'losses',   x.losses,
             'draws',    x.draws,
             'stories',  x.stories
           ) order by x.ord), '[]'::jsonb)
    into v_rivals
    from (
      select t.rival_id, p.display_name, t.meetings, t.wins, t.losses, t.draws,
             coalesce(sc.c, 0) as stories,
             row_number() over (order by abs(t.wins - t.losses) asc,
                                         t.meetings desc,
                                         t.rival_id asc) as ord
      from tally t
      join public.profiles p on p.id = t.rival_id
      left join story_counts sc on sc.name = p.display_name
      where t.meetings >= v_rival_min_meetings
      order by ord
      limit 3
    ) x;
  end if;

  -- ---------- K4: H2H-narrativ (kun ved fremmed profil, delt konkurrence) ----------
  -- Bevidst, afgrænset undtagelse fra "H2H bor i Story Engine, ikke en
  -- sammenligningsside" (karriereprofil-v1.md) — ÉT narrativt punkt, ingen
  -- tabel, ingen historik-liste. pc_points() kaldes direkte (samme kilde som
  -- Story Engine/stillings-views, F2).
  -- Vises uanset om viewer fører eller taber (se K4-begrundelse i specen):
  -- kun viewer selv ser sætningen, tallene er allerede offentlige for delte
  -- konkurrencedeltagere via stillingerne, og Story Engines LEAD_LOST fortæller
  -- allerede den tabende part om nederlag i neutralt sprog.
  --
  -- "Et møde" = én runde (round_key), hvor begge har mindst ét scoret tip på
  -- en kamp fra en konkurrence, de deler (competition_participants — ikke
  -- valgfrit, jf. Story Engines deltager-afgrænsning). DEDUPLIKERET pr. kamp
  -- (30. juli 2026-rettelse): predictions er ét tip pr. bruger pr. KAMP, ikke
  -- pr. konkurrence, så hvis to brugere deler flere konkurrencer, der begge
  -- dækker samme kamp/runde (fx en rundebaseret + en full-season-konkurrence,
  -- der begge følger Superligaen), må rundens møde kun tælle ÉN gang — ellers
  -- viser "I har mødt hinanden 2 gange" efter kun én spillet runde.
  if not v_own then
    with shared_comp as (
      select cp1.competition_id
      from public.competition_participants cp1
      join public.competition_participants cp2
        on cp2.competition_id = cp1.competition_id and cp2.user_id = profile_user_id
      where cp1.user_id = v_uid
    ),
    shared_matches as (
      -- distinct på match_id: samme kamp kan ligge i flere delte konkurrencer.
      select distinct cm.match_id, m.round_key, m.home_score, m.away_score
      from public.competition_matches cm
      join shared_comp sc on sc.competition_id = cm.competition_id
      join public.matches m on m.id = cm.match_id
      where m.home_score is not null and m.away_score is not null
    ),
    rp as (
      select sm.round_key, pr.user_id,
        sum(public.pc_points(pr.pred_home, pr.pred_away, sm.home_score, sm.away_score))::int as pts
      from shared_matches sm
      join public.predictions pr on pr.match_id = sm.match_id and pr.user_id in (v_uid, profile_user_id)
      where pr.pred_home is not null and pr.pred_away is not null
      group by sm.round_key, pr.user_id
    ),
    paired as (
      select a.round_key, a.pts as my_pts, b.pts as their_pts
      from rp a
      join rp b on b.round_key = a.round_key
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
      -- Sæsontitler: Championship har TRE kåringer (runde, måned, sæson), men
      -- karrieren registrerede kun to — den største af dem ville aldrig stå
      -- nogen steder, når sæsonen sluttede. Samme regler som månedstitlen:
      -- kun AFSLUTTEDE sæsoner (alle kampe spillet), rank() frem for distinct on
      -- (delt titel er en titel for begge), fuld tiebreaker-stige inkl.
      -- round_wins — season_standings har alle stigens kolonner.
      -- season_id kan være null på en kamp; join'et til seasons filtrerer dem
      -- ud, og null matcher aldrig i sc-join'et.
      'season', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'season_id',   sw.season_id,
                 'season_name', sw.name,
                 'points',      sw.total_points
               ) order by sw.start_date desc nulls last, sw.name desc), '[]'::jsonb)
        from (
          select ss.season_id, ss.user_id, ss.total_points, s.name, s.start_date,
            rank() over (partition by ss.season_id
                         order by ss.total_points desc, ss.exact_count desc, ss.outcome_count desc,
                                  ss.round_wins desc, ss.avg_goal_error asc) as rnk
          from public.season_standings ss
          join public.seasons s on s.id = ss.season_id
          join (
            select season_id
            from public.matches
            where season_id is not null
            group by season_id
            having bool_and(home_score is not null and away_score is not null)
          ) sc on sc.season_id = ss.season_id
        ) sw
        where sw.user_id = profile_user_id and sw.rnk = 1
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
        select rs.round_key, rs.user_id, rs.total_points, rs.exact_count,
          rank() over (partition by rs.round_key
                       order by rs.total_points desc, rs.exact_count desc, rs.outcome_count desc,
                                rs.avg_goal_error asc) as rnk,
          -- Feltstørrelsen for runden: hvor mange spillere placeringen blev sat imod.
          -- "8. plads" alene siger intet om, hvor stærk præstationen var — og var
          -- netop den linje, en bruger læste som en placering i én af sine EGNE
          -- konkurrencer (30. juli 2026). Rundeligaen er global, så feltet er
          -- alle brugere med mindst ét scoret tip i runden — samme kreds som
          -- Championship-fanens rundeliga viser.
          count(*) over (partition by rs.round_key) as field
        from public.round_standings rs
        join (
          select round_key
          from public.matches
          group by round_key
          having bool_and(home_score is not null and away_score is not null)
        ) rc on rc.round_key = rs.round_key
      ),
      mine as (
        select round_key, rnk, field, total_points, exact_count, (rnk = 1) as won
        from rr where user_id = profile_user_id
      ),
      -- "Din bedste runde nogensinde": flest point i én enkelt spillerunde.
      -- Den mest konkrete "bedste nogensinde", og den manglede helt. Kun
      -- AFSLUTTEDE runder indgår (rr's join), så tallet ikke vokser bagefter og
      -- gør en påstået rekord forældet, mens brugeren ser på den.
      -- Sammenligner kun brugeren med brugeren selv — ingen placering, ingen
      -- andre nævnt, så linjen kan vises uanset hvor i tabellen man står.
      best_round as (
        select total_points as pts, exact_count as ex, round_key
        from mine
        order by total_points desc, exact_count desc, round_key asc
        limit 1
      ),
      -- max(field): er samme bedste placering sat i flere runder, tælles den mod
      -- den STØRSTE kreds, spilleren slog den i. Aldrig misvisende — en større
      -- feltstørrelse kan kun gøre rangen mere, ikke mindre, imponerende.
      best_rank as (
        select rnk, count(*)::int as cnt, max(field)::int as field
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
        'best_round_points',       (select pts from best_round),
        'best_round_exact',        (select ex from best_round),
        'best_round_points_round', (select round_key from best_round),
        'best_round_rank',       (select rnk from best_rank),
        'best_round_rank_count', (select cnt from best_rank),
        'best_round_rank_field', (select field from best_rank),
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
$$;


--
-- Name: ensure_group_membership_for_participant(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_group_membership_for_participant() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id
  from public.competitions
  where id = new.competition_id;

  if v_group_id is not null then
    insert into public.group_members (group_id, user_id, role)
    values (v_group_id, new.user_id, 'member')
    on conflict (group_id, user_id) do nothing;
  end if;

  return new;
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
  -- VIGTIGT — round_key har TO typer i skemaet, og de må ikke blandes:
  --   date: matches.round_key (genereret kolonne) og alt afledt af den
  --         (round_standings, _se_rp, _se_pair).
  --   text: stories.round_key og rating_history.round_key.
  -- Postgres har ingen `date <= text`-operator, så en usammenlignet blanding
  -- fejler HELE funktionen — og da matches-triggeren er exception-guarded, sker
  -- det tavst (et tomt historie-kort kan ikke skelnes fra en stille uge).
  -- Derfor: brug v_round mod date-kolonnerne, p_round_key mod text-kolonnerne.
  v_round date := p_round_key::date;
  months text[] := array['januar','februar','marts','april','maj','juni','juli','august','september','oktober','november','december'];
begin
  -- idempotent: fjern rundens historier og genberegn (stories.round_key er text)
  delete from public.stories where round_key = p_round_key;

  v_label := to_char(v_round, 'DD.MM') || ' – ' || to_char(v_round + 6, 'DD.MM');

  -- ---- point pr. konkurrence/bruger/runde (kun spillede kampe, t.o.m. denne runde) ----
  -- Ud over point og præcise hits opgøres alt, tiebreaker-stigen har brug for:
  -- korrekte udfald, målafvigelse og om runden blev vundet. Stigen er den samme
  -- som i stillingerne (sql/standings_tiebreakers.sql, src/lib/standings.js), så
  -- en historie aldrig kan påstå en placering, tabellen modsiger.
  -- `round_won` = nr. 1 i runden efter stigen uden rundesejr-trinnet; delt sejr
  -- tæller for alle, hvilket regel 70 nedenfor bruger direkte.
  --
  -- DELTAGER-AFGRÆNSNINGEN ER IKKE VALGFRI. `predictions` er global pr. (bruger,
  -- kamp) — den ved intet om konkurrencer. Uden joinet til competition_participants
  -- tælles ENHVER, der har tippet den samme kamp i en anden konkurrence, med i
  -- denne konkurrences stilling. To konkurrencer på samme turnering deler alle
  -- deres kampe, så det er reglen, ikke undtagelsen. Konsekvenserne var alvorlige:
  -- en fremmed kunne stå som rundens vinder i en konkurrence, vedkommende ikke
  -- deltager i, rangnumre kunne overstige league_size ("nr. 9 af 8"), og en
  -- historie kunne nævne en person ved navn, som brugeren aldrig har mødt.
  -- Appens egen stilling (computeCompetitionState i src/lib/data.js) har altid
  -- bygget på deltagerlisten — denne join er det, der gør de to enige.
  drop table if exists _se_rp;
  create temporary table _se_rp as
  with scored as (
    select cm.competition_id, pr.user_id, m.round_key,
      public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) as pts,
      abs(pr.pred_home - m.home_score) + abs(pr.pred_away - m.away_score) as goal_err
    from public.competition_matches cm
    join public.matches m on m.id = cm.match_id
    join public.predictions pr on pr.match_id = m.id
    join public.competition_participants cp
      on cp.competition_id = cm.competition_id and cp.user_id = pr.user_id
    where m.home_score is not null and m.away_score is not null
      and pr.pred_home is not null and pr.pred_away is not null
      and m.round_key <= v_round
  ),
  agg as (
    select competition_id, user_id, round_key,
      sum(pts)::int                          as rpts,
      (count(*) filter (where pts = 3))::int as rexact,
      (count(*) filter (where pts = 1))::int as routcome,
      sum(goal_err)::int                     as rgoalerr,
      count(*)::int                          as rmatches
    from scored
    group by competition_id, user_id, round_key
  )
  select agg.*,
    (rank() over (partition by competition_id, round_key
                  order by rpts desc, rexact desc, routcome desc,
                           round(rgoalerr::numeric / rmatches, 4) asc) = 1)::int as round_won
  from agg;

  -- deltagerantal pr. konkurrence (league_size-snapshot)
  drop table if exists _se_size;
  create temporary table _se_size as
  select competition_id, count(*)::int as n
  from public.competition_participants group by competition_id;

  -- kumulativ stilling EFTER runden (t.o.m. p_round_key) + rang efter hele stigen
  drop table if exists _se_after;
  create temporary table _se_after as
  select competition_id, user_id, sum(rpts)::int as pts, sum(rexact)::int as ex,
    rank() over (partition by competition_id
                 order by sum(rpts) desc, sum(rexact) desc, sum(routcome) desc, sum(round_won) desc,
                          round(sum(rgoalerr)::numeric / sum(rmatches), 4) asc)::int as rnk
  from _se_rp group by competition_id, user_id;

  -- kumulativ stilling FØR runden (< p_round_key) + rang efter hele stigen
  drop table if exists _se_before;
  create temporary table _se_before as
  select competition_id, user_id, sum(rpts)::int as pts, sum(rexact)::int as ex,
    rank() over (partition by competition_id
                 order by sum(rpts) desc, sum(rexact) desc, sum(routcome) desc, sum(round_won) desc,
                          round(sum(rgoalerr)::numeric / sum(rmatches), 4) asc)::int as rnk
  from _se_rp where round_key < v_round group by competition_id, user_id;

  -- denne rundes point pr. konkurrence/bruger
  drop table if exists _se_this;
  create temporary table _se_this as
  select competition_id, user_id, rpts, rexact, round_won from _se_rp where round_key = v_round;

  -- ======== Regel 70 · Rundens vinder (pr. konkurrence) ========
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, t.user_id, t.competition_id, 'ROUND_WON', 70, sz.n,
    jsonb_build_object('points', t.rpts, 'shared', cnt.n_winners > 1, 'others', cnt.n_winners - 1),
    '🥇 Du vandt runden ' || v_label || ' i ' || c.name,
    t.rpts || ' point — flest af alle i ' || c.name ||
      case when cnt.n_winners > 2 then ' (delt med ' || (cnt.n_winners - 1) || ' andre).'
           when cnt.n_winners = 2 then ' (delt med 1 anden).'
           else '.' end
  from _se_this t
  join (select competition_id, sum(round_won)::int as n_winners
        from _se_this group by competition_id) cnt
    on cnt.competition_id = t.competition_id
  join _se_size sz on sz.competition_id = t.competition_id and sz.n >= 2
  join public.competitions c on c.id = t.competition_id
  where t.round_won = 1 and t.rpts > 0;

  -- ======== Regel 20 · Førsteplads overtaget (pr. konkurrence) ========
  -- Kræver, at konkurrencen HAR en runde før denne. Uden den betingelse udløste
  -- reglen i en konkurrences første runde (b.rnk er null → coalesce(...,999) > 1)
  -- og påstod, at nr. 1 havde "overtaget" en førsteplads, ingen havde haft.
  -- Premiereugen dækkes i stedet af det dæmpede SEASON_OPENER nederst.
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
  where a.rnk = 1 and coalesce(b.rnk, 999) > 1
    and exists (select 1 from _se_before b2 where b2.competition_id = a.competition_id);

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
    -- delt førsteplads: vælg deterministisk, så teksten ikke skifter rival mellem
    -- to gen-kørsler af samme runde (idempotens gælder også de nævnte navne)
    select user_id, pts from _se_after a2 where a2.competition_id = b.competition_id and a2.rnk = 1
    order by a2.user_id limit 1
  ) lead on true
  join public.profiles pr on pr.id = lead.user_id
  where b.rnk = 1 and a.rnk > 1;

  -- ======== Regel 50/75 · Comeback (≥2 pladser op, konkurrencer med ≥4 deltagere) ========
  -- A4-kalibrering (v1.1): tærsklen sænket fra 3 til 2 pladser og fra 5 til 4
  -- deltagere, men et 2-pladers spring får prioritet 75 — altså UNDER rundens
  -- vinder (70). Et rigtigt comeback (≥3 pladser) beholder 50 og vinder som før.
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, a.user_id, a.competition_id, 'COMEBACK',
    case when (b.rnk - a.rnk) >= 3 then 50 else 75 end, sz.n,
    jsonb_build_object('from', b.rnk, 'to', a.rnk, 'gap', top.pts - a.pts),
    '🚀 Fra nr. ' || b.rnk || ' til nr. ' || a.rnk || ' i ' || c.name,
    'Du rykkede ' || (b.rnk - a.rnk) || ' pladser frem i runden ' || v_label ||
      '. Toppen er nu ' || (top.pts - a.pts) || ' point væk.'
  from _se_after a
  join _se_before b on b.competition_id = a.competition_id and b.user_id = a.user_id
  join _se_size sz on sz.competition_id = a.competition_id and sz.n >= 4
  join public.competitions c on c.id = a.competition_id
  join lateral (select pts from _se_after a2 where a2.competition_id = a.competition_id and a2.rnk = 1
                order by a2.user_id limit 1) top on true
  where (b.rnk - a.rnk) >= 2;

  -- ======== Regel 22 · Ind i top 3 (v1.1, konkurrencer med ≥6 deltagere) ========
  -- Comeback måler BEVÆGELSE og misser derfor det skift, der føles størst i en
  -- tabel: 4. → 3. plads. Top-3 er en tærskel, ikke en distance. Kun i ligaer med
  -- ≥6 deltagere, hvor en top-3 rent faktisk betyder noget.
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, a.user_id, a.competition_id, 'PODIUM_ENTER', 22, sz.n,
    jsonb_build_object('rank', a.rnk, 'from', b.rnk, 'total', sz.n, 'gap', top.pts - a.pts),
    '🏅 Du er inde i top 3 i ' || c.name,
    'Efter runden ' || v_label || ' ligger du nr. ' || a.rnk || ' af ' || sz.n || ' i ' || c.name ||
      '. Toppen er ' || (top.pts - a.pts) || ' point væk.'
  from _se_after a
  join _se_before b on b.competition_id = a.competition_id and b.user_id = a.user_id
  join _se_size sz on sz.competition_id = a.competition_id and sz.n >= 6
  join public.competitions c on c.id = a.competition_id
  join lateral (select pts from _se_after a2 where a2.competition_id = a.competition_id and a2.rnk = 1
                order by a2.user_id limit 1) top on true
  where a.rnk <= 3 and b.rnk >= 4;

  -- ======== Regel 45 · Tæt på toppen (v1.1) ========
  -- Virker UDEN historik og er derfor en af de få rigtige historier, en første
  -- runde kan producere. Betingelsen er fremadrettet af design: højst 3 point op,
  -- og afstanden må ikke være vokset i runden (ingen historik ⇒ betingelsen
  -- springes over). gap = 0 er udeladt — dér er man reelt lige med føringen, og
  -- teksten "0 point op" ville være forkert.
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, a.user_id, a.competition_id, 'CLOSING_IN', 45, sz.n,
    jsonb_build_object('rival', pr.display_name, 'gap', top.pts - a.pts, 'rank', a.rnk),
    '👀 Kun ' || (top.pts - a.pts) || ' point op til føringen i ' || c.name,
    'Efter runden ' || v_label || ' er der ' || (top.pts - a.pts) || ' point op til ' ||
      pr.display_name || ' i ' || c.name || '.'
  from _se_after a
  join _se_size sz on sz.competition_id = a.competition_id and sz.n >= 3
  join public.competitions c on c.id = a.competition_id
  join lateral (select a2.user_id, a2.pts from _se_after a2
                where a2.competition_id = a.competition_id and a2.rnk = 1
                order by a2.user_id limit 1) top on true
  join public.profiles pr on pr.id = top.user_id
  left join _se_before b on b.competition_id = a.competition_id and b.user_id = a.user_id
  left join lateral (select b2.pts from _se_before b2
                     where b2.competition_id = a.competition_id and b2.rnk = 1
                     order by b2.user_id limit 1) btop on true
  where a.rnk > 1
    and (top.pts - a.pts) between 1 and 3
    and (b.pts is null or btop.pts is null or (top.pts - a.pts) <= (btop.pts - b.pts));

  -- ======== Regel 55 · Personlig runderekord (v1.1) ========
  -- Kræver kun brugerens EGNE tidligere runder — den kan derfor udløses af en
  -- spiller, der ligger sidst, uden at historien nogensinde nævner placeringen.
  -- Ingen deltagergrænse: rekorden er personlig og gælder også en solo-konkurrence.
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, t.user_id, t.competition_id, 'PERSONAL_BEST', 55, sz.n,
    jsonb_build_object('points', t.rpts, 'old', prev.old, 'league', c.name),
    '📊 Din bedste runde hidtil: ' || t.rpts || ' point',
    'Runden ' || v_label || ' er din stærkeste i ' || c.name ||
      ' — din forrige rekord var ' || prev.old || ' point.'
  from _se_this t
  join _se_size sz on sz.competition_id = t.competition_id
  join public.competitions c on c.id = t.competition_id
  join lateral (
    select max(r.rpts)::int as old, count(*)::int as prev_rounds
    from _se_rp r
    where r.competition_id = t.competition_id and r.user_id = t.user_id and r.round_key < v_round
  ) prev on true
  where prev.prev_rounds >= 1 and t.rpts > prev.old;

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

  -- ======== Regel 60/75 · Stime mod rival (≥2 sejre i træk, aktuel) ========
  -- A4-kalibrering (v1.1): stimen tæller fra 2 sejre i træk, men en 2-stime får
  -- prioritet 75 (under rundens vinder, 70) — "2. sejr i træk mod Jimmy" er en
  -- sand og sjov detalje, men den må aldrig fortrænge "du vandt runden".
  -- Fra 3 sejre er den spec'ens oprindelige historie og beholder prioritet 60.
  drop table if exists _se_pair;
  create temporary table _se_pair as
  select a.competition_id, a.user_id, b.user_id as rival_id, a.round_key,
    (a.rpts > b.rpts) as won, a.rpts as mine, b.rpts as deres
  from _se_rp a
  join _se_rp b on b.competition_id = a.competition_id and b.round_key = a.round_key and b.user_id <> a.user_id;

  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select distinct on (s.competition_id, s.user_id)
    p_round_key, s.user_id, s.competition_id, 'STREAK',
    case when s.streak >= 3 then 60 else 75 end, sz.n,
    jsonb_build_object('rival', pr.display_name, 'n', s.streak, 'mine', s.mine, 'deres', s.deres),
    '🔥 ' || s.streak || '. sejr i træk mod ' || pr.display_name || ' i ' || c.name,
    'Du slog ' || pr.display_name || ' igen i runden ' || v_label || ' — ' ||
      s.mine || ' mod ' || s.deres || ' point.'
  from (
    select p.competition_id, p.user_id, p.rival_id,
      coalesce(min(p.rn) filter (where not p.won) - 1, count(*))::int as streak,
      max(p.mine) filter (where p.rn = 1) as mine,
      max(p.deres) filter (where p.rn = 1) as deres,
      bool_or(p.rn = 1 and p.round_key = v_round) as current
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
  where s.current and s.streak >= 2
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
  v_month := to_char(v_round, 'YYYY-MM');
  v_month_name := months[cast(to_char(v_round, 'MM') as int)];
  select not exists (
    select 1 from public.matches m
    where m.round_key > v_round and to_char(m.round_key, 'YYYY-MM') = v_month
      and m.home_score is not null
  ) into v_month_last;

  -- Månedstitlen afgøres af hele tiebreaker-stigen, og den kan DELES: er to
  -- spillere ægte lige hele vejen ned, får de begge historien — samme regel som
  -- kåringen på Championship-fanen og titlerne i karriereprofilen.
  if v_month_last then
    insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
    select p_round_key, w.user_id, null, 'MONTH_CHAMP', 10, null,
      jsonb_build_object('month', v_month_name, 'points', w.total_points,
                         'gap', w.total_points - coalesce(sec.total_points, w.total_points),
                         'shared', w.n_top > 1),
      '👑 Du er ' || case when w.n_top > 1 then 'delt ' else '' end
        || 'Månedens Prediction Champ — ' || v_month_name,
      w.total_points || ' point — flest af alle i ' || v_month_name ||
        case when w.n_top > 1 then ' (delt).' else '.' end ||
        case when sec.total_points is not null and sec.total_points < w.total_points
             then ' Nr. 2 var ' || (w.total_points - sec.total_points) || ' point efter.' else '' end
    from (
      select user_id, total_points, count(*) over () as n_top
      from (
        select user_id, total_points,
          rank() over (order by total_points desc, exact_count desc, outcome_count desc,
                                round_wins desc, avg_goal_error asc) as rnk
        from public.monthly_standings where month = v_month and scope = 'ALL'
      ) r
      where r.rnk = 1
    ) w
    left join lateral (
      select total_points from public.monthly_standings
      where month = v_month and scope = 'ALL' and user_id <> w.user_id
      order by total_points desc, exact_count desc, outcome_count desc,
               round_wins desc, avg_goal_error asc limit 1
    ) sec on true;
  end if;

  -- ======== Regel 80/85 · Perfekt træfsikkerhed (global, ≥2 præcise i runden) ========
  -- A4-kalibrering (v1.1): tælles fra 2 præcise, men 2 giver prioritet 85 — den
  -- lander dermed under alt andet på højdepunkt-stigen og fungerer som den
  -- sidste rigtige historie, før det dæmpede tier tager over.
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, rs.user_id, null, 'SHARP',
    case when rs.exact_count >= 3 then 80 else 85 end, null,
    jsonb_build_object('n', rs.exact_count, 'points', rs.total_points),
    '🎯 ' || rs.exact_count || ' præcise resultater i runden',
    'Du ramte ' || rs.exact_count || ' kampe præcist i runden ' || v_label ||
      ' — ' || rs.total_points || ' point i alt.'
  from public.round_standings rs
  where rs.round_key = v_round and rs.exact_count >= 2;

  -- ======== Dæmpet tier (v1.1) · kun når INTET andet er i spil ========
  -- Kandidaterne er de brugere, der tippede i runden og efter alle reglerne
  -- ovenfor står helt uden en række. De får ét stille kort, knyttet til deres
  -- største liga (deterministisk tiebreak på competition_id), med prioritet ≥ 90,
  -- så det aldrig kan vinde over en rigtig historie — og aldrig behøver det,
  -- eftersom det kun findes, når der ikke er nogen.
  --
  -- Tonen er bundet af designreglen "historier driller — de ydmyger aldrig":
  -- placeringen nævnes KUN i den øverste halvdel af tabellen. Ligger man i den
  -- nederste, står der afstanden op til toppen og en fremadrettet slutning —
  -- aldrig "du er nr. 9 af 10".
  drop table if exists _se_quiet;
  create temporary table _se_quiet as
  select distinct on (t.user_id)
    t.user_id, t.competition_id, c.name as league, sz.n as league_size,
    t.rpts as points, a.rnk, (top.pts - a.pts) as gap,
    not exists (
      select 1 from _se_rp r
      where r.competition_id = t.competition_id and r.round_key < v_round
    ) as first_round
  from _se_this t
  join _se_size sz on sz.competition_id = t.competition_id and sz.n >= 2
  join public.competitions c on c.id = t.competition_id
  join _se_after a on a.competition_id = t.competition_id and a.user_id = t.user_id
  join lateral (select pts from _se_after a2 where a2.competition_id = t.competition_id and a2.rnk = 1
                order by a2.user_id limit 1) top on true
  where not exists (
    select 1 from public.stories s
    where s.round_key = p_round_key and s.user_id = t.user_id
  )
  order by t.user_id, sz.n desc, t.competition_id asc;

  -- ---- Prioritet 90 · Premiereugen (konkurrencens første afsluttede runde) ----
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, q.user_id, q.competition_id, 'SEASON_OPENER', 90, q.league_size,
    jsonb_build_object('points', q.points, 'rank', q.rnk, 'total', q.league_size, 'gap', q.gap, 'league', q.league),
    'Første runde i ' || q.league || ' er i hus',
    case when q.rnk * 2 <= q.league_size
      then q.points || ' point — du starter som nr. ' || q.rnk || ' af ' || q.league_size || '.' ||
           case when q.gap > 0 then ' Toppen er ' || q.gap || ' point væk.' else '' end
      else q.points || ' point i den første runde. Toppen er ' || q.gap ||
           ' point væk — der er lang vej endnu.'
    end
  from _se_quiet q
  where q.first_round;

  -- ---- Prioritet 100 · Stille runde ----
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, q.user_id, q.competition_id, 'QUIET_ROUND', 100, q.league_size,
    jsonb_build_object('points', q.points, 'rank', q.rnk, 'total', q.league_size, 'gap', q.gap, 'league', q.league),
    'Din runde: ' || q.points || ' point',
    case
      when q.rnk = 1 then 'Du fører fortsat ' || q.league || ' efter runden ' || v_label || '.'
      when q.rnk * 2 <= q.league_size
        then 'Du holder nr. ' || q.rnk || ' af ' || q.league_size || ' i ' || q.league ||
             ' — ' || q.gap || ' point op til toppen.'
      else q.gap || ' point op til toppen i ' || q.league || '. Næste runde er en ny chance.'
    end
  from _se_quiet q
  where not q.first_round;

  drop table if exists _se_rp;
  drop table if exists _se_size;
  drop table if exists _se_after;
  drop table if exists _se_before;
  drop table if exists _se_this;
  drop table if exists _se_pair;
  drop table if exists _se_quiet;
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
  -- date, ikke text: matches.round_key er en genereret date-kolonne, og Postgres
  -- har ingen `date = text`-operator. Med text her fejlede opslaget nedenfor
  -- (m.round_key = v_round) inde i exception-guarden — altså tavst, hvorved
  -- generate_stories aldrig blev kaldt. generate_stories tager text og får
  -- derfor et eksplicit ::text.
  v_round date;
begin
  -- saml berørte round_keys, afhængigt af operationen (kun når et resultat reelt ændres)
  drop table if exists _se_changed_rounds;
  create temporary table _se_changed_rounds (round_key date);

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
          perform public.generate_stories(v_round::text);
        end if;
      end loop;
    exception when others then
      -- warning, ikke notice: guarden skal blive ved med at beskytte resultat-
      -- lagringen, men en fejl må ikke være usynlig igen (jf. A9, juli 2026).
      -- warning når Postgres-loggen som standard; notice gjorde ikke.
      raise warning 'generate_stories fejlede (ignoreret, resultater/rating er uberørte): %', sqlerrm;
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
    stage_name text,
    live_home_score integer,
    live_away_score integer,
    live_state text,
    live_minute integer,
    live_updated_at timestamp with time zone
);


--
-- Name: COLUMN matches.live_home_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matches.live_home_score IS 'Nuværende mål (hjemme) mens kampen spilles. Null når kampen ikke er i gang. Tæller ALDRIG point.';


--
-- Name: COLUMN matches.live_away_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matches.live_away_score IS 'Nuværende mål (ude) mens kampen spilles. Null når kampen ikke er i gang. Tæller ALDRIG point.';


--
-- Name: COLUMN matches.live_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matches.live_state IS 'Sportmonks-state (developer_name), fx INPLAY_1ST_HALF, HT, INPLAY_2ND_HALF. Null = ikke i gang.';


--
-- Name: COLUMN matches.live_minute; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matches.live_minute IS 'Spilleminut fra den tickende periode. Null i pauser og når minuttet er ukendt.';


--
-- Name: COLUMN matches.live_updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matches.live_updated_at IS 'Hvornår live-felterne sidst blev opdateret af api/sync-live.js.';


--
-- Name: analytics_round_locks; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.analytics_round_locks AS
 SELECT season_id,
    round_key,
    min(kickoff_at) AS first_kickoff,
    (min(kickoff_at) - '01:00:00'::interval) AS lock_at,
    ((min(kickoff_at) - '01:00:00'::interval) <= now()) AS is_locked,
    count(*) AS match_count,
    count(*) FILTER (WHERE ((home_score IS NOT NULL) AND (away_score IS NOT NULL))) AS finished_count
   FROM public.matches m
  WHERE (kickoff_at IS NOT NULL)
  GROUP BY season_id, round_key;


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
-- Name: analytics_completion_facts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.analytics_completion_facts AS
 SELECT cp.user_id,
    cm.competition_id,
    c.group_id,
    m.id AS match_id,
    m.season_id,
    m.round_key,
    rl.lock_at,
    (date_trunc('week'::text, rl.lock_at))::date AS week,
    to_char(rl.lock_at, 'YYYY-MM'::text) AS month,
    (p.user_id IS NOT NULL) AS predicted
   FROM (((((public.competition_participants cp
     JOIN public.competitions c ON ((c.id = cp.competition_id)))
     JOIN public.competition_matches cm ON ((cm.competition_id = c.id)))
     JOIN public.matches m ON ((m.id = cm.match_id)))
     JOIN public.analytics_round_locks rl ON (((NOT (rl.season_id IS DISTINCT FROM m.season_id)) AND (rl.round_key = m.round_key))))
     LEFT JOIN public.predictions p ON (((p.user_id = cp.user_id) AND (p.match_id = m.id))))
  WHERE ((rl.lock_at <= now()) AND (rl.lock_at >= cp.joined_at));


--
-- Name: analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_name text NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    group_id uuid,
    competition_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analytics_events_name_check CHECK ((event_name = ANY (ARRAY['account_created'::text, 'login'::text, 'logout'::text, 'league_created'::text, 'league_joined'::text, 'league_invite_sent'::text, 'league_invite_accepted'::text, 'competition_created'::text, 'competition_joined'::text, 'competition_opened'::text, 'prediction_started'::text, 'prediction_saved'::text, 'prediction_updated'::text, 'prediction_submitted'::text, 'opened_home'::text, 'opened_tip'::text, 'opened_league'::text, 'opened_standings'::text, 'opened_rating'::text, 'opened_career'::text, 'opened_story'::text, 'opened_championship'::text, 'story_viewed'::text, 'story_shared'::text, 'push_opened'::text])))
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
-- Name: monthly_standings; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.monthly_standings AS
 WITH scored AS (
         SELECT to_char(date_trunc('month'::text, m.kickoff_at), 'YYYY-MM'::text) AS month,
            m.round_key,
            p.user_id,
            public.pc_points(p.pred_home, p.pred_away, m.home_score, m.away_score) AS pts,
            (abs((p.pred_home - m.home_score)) + abs((p.pred_away - m.away_score))) AS goal_err
           FROM (public.predictions p
             JOIN public.matches m ON ((m.id = p.match_id)))
          WHERE ((m.home_score IS NOT NULL) AND (m.away_score IS NOT NULL) AND (p.pred_home IS NOT NULL) AND (p.pred_away IS NOT NULL))
        ), per_round AS (
         SELECT scored.month,
            scored.user_id,
            rank() OVER (PARTITION BY scored.month, scored.round_key ORDER BY (sum(scored.pts)) DESC, (count(*) FILTER (WHERE (scored.pts = 3))) DESC, (count(*) FILTER (WHERE (scored.pts = 1))) DESC, (round(((sum(scored.goal_err))::numeric / (count(*))::numeric), 4))) AS rnk
           FROM scored
          GROUP BY scored.month, scored.round_key, scored.user_id
        ), wins AS (
         SELECT per_round.month,
            per_round.user_id,
            (count(*))::integer AS round_wins
           FROM per_round
          WHERE (per_round.rnk = 1)
          GROUP BY per_round.month, per_round.user_id
        )
 SELECT s.month,
    'ALL'::text AS scope,
    s.user_id,
    (sum(s.pts))::integer AS total_points,
    (count(*))::integer AS matches,
    (count(*) FILTER (WHERE (s.pts = 3)))::integer AS exact_count,
    (count(*) FILTER (WHERE (s.pts = 1)))::integer AS outcome_count,
    round(((sum(s.goal_err))::numeric / (count(*))::numeric), 4) AS avg_goal_error,
    COALESCE(w.round_wins, 0) AS round_wins
   FROM (scored s
     LEFT JOIN wins w ON (((NOT (w.month IS DISTINCT FROM s.month)) AND (w.user_id = s.user_id))))
  GROUP BY s.month, s.user_id, w.round_wins;


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
 WITH scored AS (
         SELECT m.round_key,
            pr.user_id,
            public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) AS pts,
            (abs((pr.pred_home - m.home_score)) + abs((pr.pred_away - m.away_score))) AS goal_err
           FROM (public.predictions pr
             JOIN public.matches m ON ((m.id = pr.match_id)))
          WHERE ((m.home_score IS NOT NULL) AND (m.away_score IS NOT NULL) AND (pr.pred_home IS NOT NULL) AND (pr.pred_away IS NOT NULL))
        )
 SELECT round_key,
    user_id,
    (count(*))::integer AS matches,
    (sum(pts))::integer AS total_points,
    (count(*) FILTER (WHERE (pts = 3)))::integer AS exact_count,
    (count(*) FILTER (WHERE (pts = 1)))::integer AS outcome_count,
    round(((sum(goal_err))::numeric / (count(*))::numeric), 4) AS avg_goal_error
   FROM scored
  GROUP BY round_key, user_id;


--
-- Name: season_standings; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.season_standings WITH (security_invoker='on') AS
 WITH scored AS (
         SELECT m.season_id,
            m.round_key,
            pr.user_id,
            public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) AS pts,
            (abs((pr.pred_home - m.home_score)) + abs((pr.pred_away - m.away_score))) AS goal_err
           FROM (public.predictions pr
             JOIN public.matches m ON ((m.id = pr.match_id)))
          WHERE ((m.home_score IS NOT NULL) AND (m.away_score IS NOT NULL) AND (pr.pred_home IS NOT NULL) AND (pr.pred_away IS NOT NULL))
        ), per_round AS (
         SELECT scored.season_id,
            scored.user_id,
            rank() OVER (PARTITION BY scored.season_id, scored.round_key ORDER BY (sum(scored.pts)) DESC, (count(*) FILTER (WHERE (scored.pts = 3))) DESC, (count(*) FILTER (WHERE (scored.pts = 1))) DESC, (round(((sum(scored.goal_err))::numeric / (count(*))::numeric), 4))) AS rnk
           FROM scored
          GROUP BY scored.season_id, scored.round_key, scored.user_id
        ), wins AS (
         SELECT per_round.season_id,
            per_round.user_id,
            (count(*))::integer AS round_wins
           FROM per_round
          WHERE (per_round.rnk = 1)
          GROUP BY per_round.season_id, per_round.user_id
        )
 SELECT s.season_id,
    s.user_id,
    (count(*))::integer AS matches,
    (sum(s.pts))::integer AS total_points,
    (count(*) FILTER (WHERE (s.pts = 3)))::integer AS exact_count,
    (count(*) FILTER (WHERE (s.pts = 1)))::integer AS outcome_count,
    round(((sum(s.goal_err))::numeric / (count(*))::numeric), 4) AS avg_goal_error,
    COALESCE(w.round_wins, 0) AS round_wins
   FROM (scored s
     LEFT JOIN wins w ON (((NOT (w.season_id IS DISTINCT FROM s.season_id)) AND (w.user_id = s.user_id))))
  GROUP BY s.season_id, s.user_id, w.round_wins;


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
-- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);


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
-- Name: analytics_events_group_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_group_time_idx ON public.analytics_events USING btree (group_id, created_at DESC) WHERE (group_id IS NOT NULL);


--
-- Name: analytics_events_name_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_name_time_idx ON public.analytics_events USING btree (event_name, created_at DESC);


--
-- Name: analytics_events_user_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_user_time_idx ON public.analytics_events USING btree (user_id, created_at);


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
-- Name: matches_live_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_live_state_idx ON public.matches USING btree (live_state) WHERE (live_state IS NOT NULL);


--
-- Name: matches_live_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_live_window_idx ON public.matches USING btree (kickoff_at) WHERE (home_score IS NULL);


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
-- Name: competition_participants competition_participants_ensure_group; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER competition_participants_ensure_group BEFORE INSERT ON public.competition_participants FOR EACH ROW EXECUTE FUNCTION public.ensure_group_membership_for_participant();


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
-- Name: analytics_events analytics_events_competition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES public.competitions(id) ON DELETE SET NULL;


--
-- Name: analytics_events analytics_events_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE SET NULL;


--
-- Name: analytics_events analytics_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


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
-- Name: analytics_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_events analytics_events_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY analytics_events_insert_own ON public.analytics_events FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: competition_participants comp_participants_delete_own_unlocked; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comp_participants_delete_own_unlocked ON public.competition_participants FOR DELETE TO authenticated USING (((user_id = auth.uid()) AND ((NOT (EXISTS ( SELECT 1
   FROM (public.competition_matches cm
     JOIN public.matches m ON ((m.id = cm.match_id)))
  WHERE ((cm.competition_id = competition_participants.competition_id) AND ((m.home_score IS NULL) OR (m.away_score IS NULL)))))) OR (NOT (EXISTS ( SELECT 1
   FROM ((public.competition_matches cm
     JOIN public.matches m ON ((m.id = cm.match_id)))
     JOIN public.predictions p ON (((p.match_id = m.id) AND (p.user_id = auth.uid()))))
  WHERE ((cm.competition_id = competition_participants.competition_id) AND ((m.home_score IS NOT NULL) OR (EXISTS ( SELECT 1
           FROM public.matches m2
          WHERE ((m2.round_key = m.round_key) AND (NOT (m2.season_id IS DISTINCT FROM m.season_id)) AND (m2.kickoff_at IS NOT NULL) AND (m2.kickoff_at <= (now() + '01:00:00'::interval)))))))))))));


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

CREATE POLICY group_members_delete_self ON public.group_members FOR DELETE TO authenticated USING (((user_id = auth.uid()) AND (NOT (EXISTS ( SELECT 1
   FROM (public.competition_participants cp
     JOIN public.competitions c ON ((c.id = cp.competition_id)))
  WHERE ((cp.user_id = auth.uid()) AND (c.group_id = group_members.group_id)))))));


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
-- Name: predictions predictions_insert_own_unlocked; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY predictions_insert_own_unlocked ON public.predictions FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
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
-- Name: predictions predictions_update_own_unlocked; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY predictions_update_own_unlocked ON public.predictions FOR UPDATE TO authenticated USING (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.matches m
  WHERE ((m.id = predictions.match_id) AND (m.home_score IS NULL) AND (NOT (EXISTS ( SELECT 1
           FROM public.matches m2
          WHERE ((m2.round_key = m.round_key) AND (NOT (m2.season_id IS DISTINCT FROM m.season_id)) AND (m2.kickoff_at IS NOT NULL) AND (m2.kickoff_at <= (now() + '01:00:00'::interval))))))))))) WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.matches m
  WHERE ((m.id = predictions.match_id) AND (m.home_score IS NULL) AND (NOT (EXISTS ( SELECT 1
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
-- Name: FUNCTION admin_analytics_engagement(p_days integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_analytics_engagement(p_days integer) TO anon;
GRANT ALL ON FUNCTION public.admin_analytics_engagement(p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_analytics_engagement(p_days integer) TO service_role;


--
-- Name: FUNCTION admin_analytics_funnel(p_days integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_analytics_funnel(p_days integer) TO anon;
GRANT ALL ON FUNCTION public.admin_analytics_funnel(p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_analytics_funnel(p_days integer) TO service_role;


--
-- Name: FUNCTION admin_analytics_health(p_days integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_analytics_health(p_days integer) TO anon;
GRANT ALL ON FUNCTION public.admin_analytics_health(p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_analytics_health(p_days integer) TO service_role;


--
-- Name: FUNCTION admin_analytics_league_health(p_days integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_analytics_league_health(p_days integer) TO anon;
GRANT ALL ON FUNCTION public.admin_analytics_league_health(p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_analytics_league_health(p_days integer) TO service_role;


--
-- Name: FUNCTION admin_analytics_retention(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_analytics_retention() TO anon;
GRANT ALL ON FUNCTION public.admin_analytics_retention() TO authenticated;
GRANT ALL ON FUNCTION public.admin_analytics_retention() TO service_role;


--
-- Name: FUNCTION admin_analytics_stories(p_days integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_analytics_stories(p_days integer) TO anon;
GRANT ALL ON FUNCTION public.admin_analytics_stories(p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_analytics_stories(p_days integer) TO service_role;


--
-- Name: FUNCTION admin_user_stats(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_user_stats() TO anon;
GRANT ALL ON FUNCTION public.admin_user_stats() TO authenticated;
GRANT ALL ON FUNCTION public.admin_user_stats() TO service_role;


--
-- Name: FUNCTION analytics_require_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.analytics_require_admin() TO anon;
GRANT ALL ON FUNCTION public.analytics_require_admin() TO authenticated;
GRANT ALL ON FUNCTION public.analytics_require_admin() TO service_role;


--
-- Name: FUNCTION career_profile(profile_user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.career_profile(profile_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.career_profile(profile_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.career_profile(profile_user_id uuid) TO service_role;


--
-- Name: FUNCTION ensure_group_membership_for_participant(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.ensure_group_membership_for_participant() TO anon;
GRANT ALL ON FUNCTION public.ensure_group_membership_for_participant() TO authenticated;
GRANT ALL ON FUNCTION public.ensure_group_membership_for_participant() TO service_role;


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
-- Name: TABLE matches; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.matches TO anon;
GRANT ALL ON TABLE public.matches TO authenticated;
GRANT ALL ON TABLE public.matches TO service_role;


--
-- Name: TABLE analytics_round_locks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_round_locks TO service_role;


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
-- Name: TABLE predictions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.predictions TO anon;
GRANT ALL ON TABLE public.predictions TO authenticated;
GRANT ALL ON TABLE public.predictions TO service_role;


--
-- Name: TABLE analytics_completion_facts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_completion_facts TO service_role;


--
-- Name: TABLE analytics_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_events TO authenticated;
GRANT ALL ON TABLE public.analytics_events TO service_role;


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

\unrestrict bW1mVXQKFT0ZczJd0hyaJPWd020KhgFCVgquCnGEF1ubesVEPRRddBUzly91d9t

