-- MÅLING af Story Engine v2's dagsmotor. Ad hoc-værktøj, ikke en migrering.
--
-- SPØRGSMÅLET, DEN SKAL BESVARE
--
-- `generate_daily_stories()` kaldes fra matches-triggeren og kører altså
-- SYNKRONT inde i den sætning, `api/sync-live.js` bruger til at afslutte en
-- kamp. Bliver den for langsom, forsinker den ikke en baggrundsopgave — den
-- forsinker skrivningen af et resultat.
--
-- Målingen er derfor ikke "hvor mange millisekunder tager den", men "koster den
-- mere end det, triggeren allerede betaler". Referencen er `recompute_ratings()`,
-- som kører ved HVER resultatændring, mens dagsmotoren kun kører, når en dag
-- bliver færdig. Er dagsmotoren billigere end ratingen, er der intet at flytte.
--
-- HANDLINGSGRÆNSER (jf. docs/features/story-engine-v2.md §11)
--   under recompute_ratings()   → behold alt som det er
--   over den, men under ~1 s    → behold, men mål igen ved næste turnering
--   over ~1 s                   → drop regel 140 STREAK_STATUS (trin 4 viser,
--                                 hvor stor en del den er)
--   stadig over efter det       → flyt dagsmotoren ud i cron; den skal
--                                 alligevel kun køre én gang i døgnet
--
-- SIKKERHED: den regenererer dagskort for dage UDEN FOR den aktuelle runde, så
-- ingen brugers karrusel ændrer sig. Motorerne er delete-then-insert pr.
-- periode, så kortene bliver bit-for-bit de samme. `recompute_ratings()` i
-- trin 5 er en fuld genopbygning — præcis den, triggeren selv kører hele tiden.
--
-- Kør i Supabases SQL-editor med "Run without RLS". Svarene kommer som NOTICE.

-- ======================= 1. Hvor stort er grundlaget? =======================
do $$
declare
  v_cmp bigint; v_pred bigint; v_matches bigint; v_comps bigint; v_parts bigint;
begin
  select count(*) into v_cmp     from public.competition_match_points;
  select count(*) into v_pred    from public.predictions;
  select count(*) into v_matches from public.matches where home_score is not null;
  select count(*) into v_comps   from public.competitions;
  select count(*) into v_parts   from public.competition_participants;

  raise notice '=== 1. Grundlag ===';
  raise notice 'competition_match_points : % rækker   <-- dette er _sd_pts', v_cmp;
  raise notice 'predictions              : % rækker', v_pred;
  raise notice 'spillede kampe           : %', v_matches;
  raise notice 'konkurrencer / deltagere : % / %', v_comps, v_parts;
end $$;

-- ======================= 2. Dagsmotoren, pr. dag =======================
do $$
declare
  d date;
  v_start timestamptz;
  v_ms numeric;
  v_total numeric := 0;
  v_max numeric := 0;
  v_n int := 0;
  v_cards int;
  -- Kun dage uden for den aktuelle runde: så kan ingen brugers karrusel ændre
  -- sig af at vi måler (et dagskort uden for runden vises ikke).
  v_cur_round date := public.round_key_of_date(public.match_day(now()));
begin
  raise notice '=== 2. generate_daily_stories, ti seneste færdige dage ===';

  for d in
    select x.d from (
      select distinct match_day as d
      from public.matches
      where home_score is not null and away_score is not null
        and round_key < v_cur_round
      order by 1 desc
      limit 10
    ) x
    order by x.d
  loop
    if public.match_day_complete(d) then
      v_start := clock_timestamp();
      perform public.generate_daily_stories(d);
      v_ms := extract(epoch from clock_timestamp() - v_start) * 1000;

      select count(*) into v_cards from public.stories
       where period = 'day' and day_key = d;

      raise notice '  %  % ms   (% kort)', d, lpad(round(v_ms, 1)::text, 8), v_cards;
      v_total := v_total + v_ms;
      if v_ms > v_max then v_max := v_ms; end if;
      v_n := v_n + 1;
    end if;
  end loop;

  if v_n = 0 then
    raise notice '  INGEN færdige dage fundet uden for den aktuelle runde.';
  else
    raise notice '  --> gennemsnit % ms, værste % ms, over % dage',
      round(v_total / v_n, 1), round(v_max, 1), v_n;
  end if;
end $$;

-- ======================= 3. Runde-motoren, til sammenligning =======================
do $$
declare
  r date; v_start timestamptz; v_ms numeric;
begin
  raise notice '=== 3. generate_stories (runde-motoren), seneste færdige runde ===';

  select max(m.round_key) into r
  from public.matches m
  where not exists (
    select 1 from public.matches m2
    where m2.round_key = m.round_key
      and (m2.home_score is null or m2.away_score is null)
  );

  if r is null then
    raise notice '  ingen fuldt afsluttet runde fundet';
  else
    v_start := clock_timestamp();
    perform public.generate_stories(r::text);
    v_ms := extract(epoch from clock_timestamp() - v_start) * 1000;
    raise notice '  runde %  --> % ms', r, round(v_ms, 1);
  end if;
end $$;

-- ======================= 4. Regel 140 alene (den mistænkte) =======================
-- STREAK_STATUS er den eneste regel, der læser UDEN FOR dagens vindue: hele
-- brugerens scorede historik, med to vinduesfunktioner. Er dagsmotoren for
-- langsom, er det den, der skal væk først — men kun hvis tallet her rent
-- faktisk udgør en stor del af trin 2.
do $$
declare
  v_start timestamptz; v_ms numeric; v_rows bigint;
  p_day date := public.match_day(now()) - 1;
begin
  raise notice '=== 4. Regel 140 STREAK_STATUS isoleret ===';
  v_start := clock_timestamp();

  with hist as (
    select pr.user_id, m.kickoff_at, m.match_day, m.id as match_id,
           (public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) >= 1) as hit
    from public.predictions pr
    join public.matches m on m.id = pr.match_id
    join public.seasons s on s.id = m.season_id
    join public.leagues l on l.id = s.league_id and l.is_official
    where m.home_score is not null and m.away_score is not null
      and pr.pred_home is not null and pr.pred_away is not null
      and m.match_day <= p_day
  ),
  grp as (
    select *,
      row_number() over (partition by user_id order by kickoff_at, match_id)
      - row_number() over (partition by user_id, hit order by kickoff_at, match_id) as g
    from hist
  ),
  runs as (
    select user_id, hit, g, count(*)::int as len,
           max(match_day) as ended_day, max(kickoff_at) as run_last,
           max(max(kickoff_at)) over (partition by user_id) as last_kick
    from grp group by user_id, hit, g
  )
  select count(*) into v_rows from runs where hit and len >= 5 and ended_day = p_day;

  v_ms := extract(epoch from clock_timestamp() - v_start) * 1000;
  raise notice '  historik-scanningen alene: % ms  (% stimer udløst)', round(v_ms, 1), v_rows;
end $$;

-- ======================= 5. Referencen: rating-genberegningen =======================
-- Den kører ved HVER resultatændring i forvejen. Ligger dagsmotoren under
-- dette tal, er der ingen sag: triggeren betaler allerede mere for noget,
-- den gør oftere.
do $$
declare v_start timestamptz; v_ms numeric;
begin
  raise notice '=== 5. recompute_ratings (referencen) ===';
  v_start := clock_timestamp();
  perform public.recompute_ratings();
  v_ms := extract(epoch from clock_timestamp() - v_start) * 1000;
  raise notice '  --> % ms   (kører ved HVER resultatændring)', round(v_ms, 1);
  raise notice '';
  raise notice 'Sammenlign trin 2 (gennemsnit + værste) med dette tal.';
end $$;
