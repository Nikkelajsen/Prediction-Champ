-- Story Engine v1 — stories-tabel, latest_story-view og generate_stories().
-- Idempotent — kan køres igen når som helst (kør med "Run without RLS";
-- scriptet sætter selv RLS, jf. DOCUMENTATION.md afsnit 13).
--
-- Spec: docs/features/story-engine-v1.md. Beregnes i databasen, én gang pr.
-- runde, idempotent — samme mønster som recompute_ratings().
--
-- BEMÆRK — kør BAGEFTER (eller gen-kør) sql/rating_trigger_optimization.sql:
-- den hooker generate_stories() ind sidst i matches-triggeren (efter ratings),
-- pakket i en exception-guard så en historik-fejl ALDRIG kan blokere
-- resultat-lagring eller rating-genberegning.
--
-- SKEMA-ANTAGELSER (det oprindelige skema ligger ikke i repoet, kun i Supabase —
-- jf. DOCUMENTATION afsnit 12). Denne SQL antager kolonnerne som dokumenteret:
--   competitions(id, name, created_by), competition_participants(competition_id, user_id),
--   competition_matches(competition_id, match_id),
--   matches(id, round_key, home_score, away_score),
--   predictions(user_id, match_id, pred_home, pred_away),
--   profiles(id, display_name),
--   ratings(user_id, scope, rating, rounds_played, provisional),
--   rating_history(user_id, scope, round_key, rating_after),
--   views round_standings(round_key,user_id,total_points,exact_count) og
--   monthly_standings(month, scope, user_id, total_points, exact_count).
-- Verificér mod jeres faktiske skema før produktion; køres i SKYGGETILSTAND først.

-- ======================= 1. Tabel =======================
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  round_key text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  competition_id uuid references public.competitions (id) on delete cascade, -- null for globale (rating, måned)
  rule text not null,           -- 'LEAD_TAKEN', 'RATING_HIGH', ...
  priority int not null,
  league_size int,              -- snapshot: antal deltagere i ligaen ved generering; null for globale
  payload jsonb not null default '{}'::jsonb,
  headline text not null,
  body text not null,
  created_at timestamptz not null default now(),
  dismissed_at timestamptz,
  unique (round_key, user_id, rule, competition_id)
);
create index if not exists stories_user_round_idx on public.stories (user_id, round_key);

-- RLS: brugere kan kun læse/afvise egne historier.
alter table public.stories enable row level security;
drop policy if exists stories_select_own on public.stories;
create policy stories_select_own on public.stories
  for select to authenticated using (user_id = auth.uid());
drop policy if exists stories_update_own on public.stories;
create policy stories_update_own on public.stories
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- INSERT/DELETE sker kun via generate_stories() (security definer). Ingen bruger-policy.

grant select, update on public.stories to authenticated;

-- ======================= 2. latest_story-view =======================
-- Præcis én kandidat pr. (user_id, round_key): laveste priority, dernæst største
-- liga (snapshottet league_size), dernæst competition_id som garanteret unik
-- tiebreak. dismissed_at filtreres IKKE her — frontenden henter seneste runde og
-- viser intet, hvis den er afvist (så en afvist historie ikke afslører en ældre).
create or replace view public.latest_story with (security_invoker = on) as
select distinct on (user_id, round_key)
  id, round_key, user_id, competition_id, rule, priority, league_size,
  payload, headline, body, created_at, dismissed_at
from public.stories
order by user_id, round_key, priority asc, league_size desc nulls last, competition_id asc nulls last;

grant select on public.latest_story to authenticated;

-- ======================= 3. generate_stories() =======================
create or replace function public.generate_stories(p_round_key text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
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
$fn$;

grant execute on function public.generate_stories(text) to authenticated, service_role;
