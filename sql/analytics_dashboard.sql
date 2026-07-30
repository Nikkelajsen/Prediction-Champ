-- Prediction Champ — Analytics v1: dashboard (læse-siden)
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
-- Spec: docs/features/analytics-v1.md
--
-- Modsat sql/analytics_events.sql (skrive-siden, kør én gang) er DENNE fil
-- SIKKER OG FORVENTET AT BLIVE GEN-KØRT. Alt herunder er `create or replace`
-- på objekter, denne fil selv ejer — den rører INGEN policy, INGEN
-- eksisterende view og INGEN eksisterende funktion fra sql/groups.sql,
-- sql/standings_views.sql eller nogen af de to lock-policy-filer
-- (predictions_round_lock_policies.sql, predictions_write_lock.sql).
--
-- JULI 2026 — Liga-diagnose erstatter Liga Health Score: RPC 3 returnerer nu
-- målte signaler pr. liga UDEN sammenvejet 0-100-score, og diagnosen udledes
-- i src/lib/analytics.js. Gen-kør filen efter frontend-mergen; en gammel
-- klient mod en ny RPC (eller omvendt) viser en tom Liga-sektion, ikke
-- forkerte tal. Begrundelsen står i sin helhed over RPC 3.
--
-- North Star: Prediction Completion Rate = afgivne tips / mulige tips.
-- "Mulige tips" defineres PRÆCIST i analytics_completion_facts nedenfor —
-- læs kommentaren dér, før du bruger viewet til noget nyt.

-- ---------- Admin-gate, delt af alle fire RPC'er ----------
create or replace function public.analytics_require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'forbidden';
  end if;
end;
$fn$;

grant execute on function public.analytics_require_admin() to authenticated;

-- ---------- View: analytics_round_locks ----------
-- Samme rundelås som sql/predictions_round_lock_policies.sql, omskrevet til
-- et AGGREGAT i stedet for en EXISTS-betingelse pr. kamp. De to udtryk er
-- algebraisk ækvivalente:
--
--   exists (select 1 from matches m2 where … m2.kickoff_at <= now() + interval '1 hour')
--     ⇔  min(kickoff_at) <= now() + interval '1 hour'
--     ⇔  min(kickoff_at) - interval '1 hour' <= now()
--
-- En runde, hvor alle kickoffs er NULL, giver ingen række → regnes aldrig som
-- låst, ligesom policyen (`matches.kickoff_at` er i dag `not null`, så dette
-- er kun en defensiv detalje). VIGTIGT: denne fil må ALDRIG bruges til at
-- ÆNDRE selve rundelåsen — den lever udelukkende i
-- predictions_round_lock_policies.sql og predictions_write_lock.sql.
--
-- Bevidst UDEN security_invoker=on (modsat round_standings/latest_story, som
-- klienter læser direkte): dette view kører med EJERENS rettigheder inde i
-- RPC'erne nedenfor, og revokes derfor fra alle klient-roller.
create or replace view public.analytics_round_locks as
select
  m.season_id,
  m.round_key,
  min(m.kickoff_at)                                 as first_kickoff,
  min(m.kickoff_at) - interval '1 hour'              as lock_at,
  (min(m.kickoff_at) - interval '1 hour') <= now()   as is_locked,
  count(*)                                           as match_count,
  count(*) filter (where m.home_score is not null and m.away_score is not null) as finished_count
from public.matches m
where m.kickoff_at is not null
group by m.season_id, m.round_key;

revoke all on public.analytics_round_locks from anon, authenticated;

-- ---------- View: analytics_completion_facts ----------
-- Centerpiece for North Star-metrikken. Én række pr. MULIGT tip:
--
--   1) "Mulige tips" = kampene i de konkurrencer, brugeren deltager i, i
--      runder der allerede er LÅST — en ulåst runde er ikke et muligt tip,
--      for man kan ikke have misset en deadline, der ikke er indtruffet.
--   2) … OG kun runder der låste EFTER brugeren meldte sig til
--      (`lock_at >= cp.joined_at`). Uden dette ville alle, der joiner en
--      igangværende full_season-konkurrence, starte ved ~0% og aldrig
--      komme sig — North Star ville måle anciennitet, ikke deltagelse.
--   3) `predicted = true`, blot fordi rækken FINDES i predictions, er
--      pålideligt uden et timestamp-tjek: sql/predictions_write_lock.sql
--      blokerer INSERT/UPDATE efter rundelåsen, og ingen serverkode skriver
--      predictions (api/send-notifications.js læser kun) — så en eksisterende
--      række KAN ikke være skrevet efter deadline.
--
-- GRAIN-REGLEN (den letteste ting at få galt — læs før du grupperer):
--   · pr. bruger / pr. liga / globalt / pr. uge / pr. måned:
--       brug count(distinct (user_id, match_id)) — ét tip kan optræde i
--       flere konkurrencer (delt predictions-tabel) og må ikke tælles dobbelt.
--   · pr. konkurrence: almindeligt count(*) er korrekt (competition_matches'
--       PK gør hver (competition_id, match_id) unik).
--
-- Skala: ved venneflok-skala er dette O(deltagere × kampe) ≈ 10⁴–10⁵ rækker,
-- genberegnet kun når en admin åbner dashboardet. Bliver det for langsomt, er
-- svaret et smallere p_days-vindue — ikke et materialized view (findes ikke
-- i dette skema, og arkitekturvalg #3 udelukker nye scheduled jobs).
create or replace view public.analytics_completion_facts as
select
  cp.user_id,
  cm.competition_id,
  c.group_id,
  m.id                              as match_id,
  m.season_id,
  m.round_key,
  rl.lock_at,
  date_trunc('week', rl.lock_at)::date as week,
  to_char(rl.lock_at, 'YYYY-MM')       as month,
  (p.user_id is not null)              as predicted
from public.competition_participants cp
join public.competitions        c  on c.id = cp.competition_id
join public.competition_matches cm on cm.competition_id = c.id
join public.matches             m  on m.id = cm.match_id
join public.analytics_round_locks rl
  on rl.season_id is not distinct from m.season_id
 and rl.round_key = m.round_key
left join public.predictions p
  on p.user_id = cp.user_id and p.match_id = m.id
where rl.lock_at <= now()
  and rl.lock_at >= cp.joined_at;

revoke all on public.analytics_completion_facts from anon, authenticated;

-- Eksempel-forespørgsler til Supabase SQL-editor / et BI-værktøj forbundet
-- direkte til databasen — det er DETTE, der gør analytics "trækkes ud, ikke
-- kun i appen":
--   North Star, globalt:  select round(100.0 * avg(predicted::int), 1) from (
--                            select distinct user_id, match_id, predicted
--                            from analytics_completion_facts) t;
--   pr. uge:               select week, count(distinct (user_id, match_id)) slots,
--                                 count(distinct (user_id, match_id)) filter (where predicted) done
--                          from analytics_completion_facts group by week order by week;
--   pr. konkurrence:       select competition_id, round(100.0*avg(predicted::int),1)
--                          from analytics_completion_facts group by competition_id;

-- ================= RPC 1: admin_analytics_health =================
-- "Produktets sundhed": aktive brugere, aktive ligaer/konkurrencer, North
-- Star, Deadline Miss Rate, gennemførte spillerunder.
create or replace function public.admin_analytics_health(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
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
$fn$;

grant execute on function public.admin_analytics_health(int) to authenticated;

-- ================= RPC 2: admin_analytics_engagement =================
-- "Engagement": pr.-event optælling, Push Open Rate, gennemsnitlig sessionstid.
create or replace function public.admin_analytics_engagement(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
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
        ), '[]'::jsonb)
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
$fn$;

grant execute on function public.admin_analytics_engagement(int) to authenticated;

-- ================= RPC 3: admin_analytics_league_health =================
-- Liga-diagnose. Returnerer MÅLTE SIGNALER pr. liga — ingen sammenvejet score.
--
-- HVORFOR DEN SAMMENVEJEDE SCORE ER VÆK (omlagt juli 2026, lukker ROADMAP A12):
-- v1 returnerede ét `health_score` (0-100) som en vægtet blanding af fem
-- faktorer. Den var for BRED til at bruge til noget:
--
--   1) Blandingen søgte mod midten. På de fire første rigtige ligaer gav den
--      75/77/77/88 — alle fire "SUND", grøn bjælke hele vejen ned. En metrik,
--      der ikke kan skelne ligaer fra hinanden, kan heller ikke pege på den,
--      der har brug for hjælp.
--   2) Den sagde aldrig HVAD der var galt. "77" er ikke en handling. Det, en
--      admin skal vide, er "denne liga har ingen aktiv konkurrence" eller
--      "denne liga bæres af én person" — to helt forskellige problemer, som
--      den vægtede sum kunne give præcis samme tal for.
--   3) Faktorerne overlappede (antal aktive medlemmer, andel aktive medlemmer
--      og retention måler alle tre "kommer medlemmerne her"), så tre af de
--      fem vægte trak i samme streng, mens deltagelse reelt vejede mindre end
--      de 35 %, tallet lovede.
--   4) Vægte kan ikke kalibreres på fire ligaer. A12 spurgte "hvornår
--      rekalibrerer vi?" — det rigtige svar viste sig at være "vi fjerner den
--      størrelse, der kræver kalibrering".
--
-- I stedet: hvert signal står for sig med sin egen enhed og sin egen
-- definition (UI'et viser definitionen via måle-ordbogen i
-- src/lib/analyticsMetrics.js), og DIAGNOSEN — hvilken tilstand ligaen er i,
-- og hvad man gør ved det — udledes i `diagnoseLeague()` i
-- src/lib/analytics.js.
--
-- HVORFOR DIAGNOSEN LIGGER I JS OG IKKE HER: reglerne er produktjudgement, der
-- skal tunes ofte, og de kan unit-testes i vitest (ingen CI kører SQL). Samme
-- valg som Onboarding v1, hvor tilstanden bevidst udledes af data i klienten
-- uden SQL. Denne fil måler; klienten fortolker. Nye tærskler kræver derfor
-- ikke længere en gen-kørsel i Supabase.
--
-- Alle signaler i ét vindue: p_days. Målt over `analytics_completion_facts`
-- (samme kilde som North Star, så tallene her og i "Produktets sundhed" ikke
-- kan modsige hinanden) plus user_activity_days, groups og analytics_events.
create or replace function public.admin_analytics_league_health(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
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
$fn$;

grant execute on function public.admin_analytics_league_health(int) to authenticated;

-- ================= RPC 4: admin_analytics_retention =================
-- Retention uge 1/4/12/26/52 for brugere og for ligaer.
--
-- ÆRLIGHEDS-FELT (ikke-forhandlingsbart): user_activity_days har kun data fra
-- den dag, sql/user_stats.sql blev kørt (samme kilde som den eksisterende
-- DAU/WAU/MAU i Admin → Statistik). Uge-52-retention vil derfor læse som ~0%,
-- indtil der findes et helt års aktivitetsdata — hvilket er en FALSK 0%, ikke
-- en rigtig én. `activity_since` returneres, så UI'et kan gråtone og skrive
-- "Ingen data endnu" for ethvert vindue, der åbner før den dato, i stedet for
-- at vise et selvsikkert forkert tal.
create or replace function public.admin_analytics_retention()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
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
$fn$;

grant execute on function public.admin_analytics_retention() to authenticated;

-- ---------- Verifikation efter kørsel ----------
-- Kør disse i Supabase SQL-editor. Alle "skal give 0" er ægte invarianter —
-- samme stil som sql/group_membership_invariant.sql.

-- 1) Rundelås-udtrykket er ækvivalent med RLS-policyens. Skal give 0 rækker:
-- select rl.season_id, rl.round_key
-- from public.analytics_round_locks rl
-- where rl.is_locked <> exists (
--   select 1 from public.matches m2
--   where m2.round_key = rl.round_key
--     and m2.season_id is not distinct from rl.season_id
--     and m2.kickoff_at is not null
--     and m2.kickoff_at <= now() + interval '1 hour');

-- 2) Ingen "mulige tips" i runder der IKKE er låst. Skal give 0:
-- select count(*) from public.analytics_completion_facts f
-- join public.analytics_round_locks rl
--   on rl.season_id is not distinct from f.season_id and rl.round_key = f.round_key
-- where not rl.is_locked;

-- 3) Ingen slots fra før man meldte sig til. Skal give 0:
-- select count(*) from public.analytics_completion_facts f
-- join public.competition_participants cp
--   on cp.user_id = f.user_id and cp.competition_id = f.competition_id
-- where f.lock_at < cp.joined_at;

-- 4) Afgivne tips i facts må aldrig overstige rækker i predictions. Skal give 0:
-- select count(*) from (
--   select distinct user_id, match_id from public.analytics_completion_facts where predicted
-- ) t
-- left join public.predictions p using (user_id, match_id)
-- where p.user_id is null;

-- 5) Kryds-tjek af North Star mod Tip-skærmens egen optælling for ÉN konkurrence
--    (indsæt en rigtig konkurrence-uuid — skal matche "N af M tippet"):
-- select count(*) slots, count(*) filter (where predicted) done
-- from public.analytics_completion_facts where competition_id = '<uuid>';

-- 6) Liga-diagnose: alle procent-signaler i [0,100] eller null (afløser den
--    gamle "health_score i [0,100]"-invariant). Skal give 0:
-- select count(*) from jsonb_array_elements(
--   (select public.admin_analytics_league_health(30) -> 'leagues')) e,
--   lateral (values ('completion_rate'),('predictor_share'),('active_share'),
--                   ('pulse'),('top_predictor_share'),('retention_rate')) as f(kk)
-- where (e->>f.kk) is not null
--   and ((e->>f.kk)::numeric < 0 or (e->>f.kk)::numeric > 100);

-- 6b) Bredde kan aldrig overstige medlemstallet, og spillede runder kan
--     aldrig overstige tilgængelige runder. Skal give 0:
-- select count(*) from jsonb_array_elements(
--   (select public.admin_analytics_league_health(30) -> 'leagues')) e
-- where (e->>'predictors')::int > (e->>'members')::int
--    or (e->>'rounds_played')::int > (e->>'rounds_available')::int;

-- 7) Retention: se hvor langt tilbage aktivitetsdata reelt findes, før du
--    stoler på uge-26/52-tallene:
-- select public.admin_analytics_retention() -> 'activity_since';

-- 8) Adgang: kør som en NON-admin (Supabase-editor: "Run with RLS" + impersonér
--    bruger). Skal fejle med 'forbidden' / give 0 rækker:
-- select public.admin_analytics_health(30);
-- select count(*) from public.analytics_events;
