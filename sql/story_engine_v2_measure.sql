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
-- RESULTATET KOMMER SOM EN TABEL, ikke som NOTICE.
--
-- Supabases SQL-editor viser resultatrækker og ikke serverens NOTICE-beskeder:
-- en `raise notice` giver "Success. No rows returned", altså en kørsel, der så
-- vellykket ud og intet fortalte. Det er samme fælde som psql-kommandoerne
-- (`\timing`) én gang til — værktøjet, der KØRER filen, bestemmer også, hvordan
-- den må SVARE. Målingerne samles derfor i en temp-tabel, og filen slutter med
-- et `select`.
--
-- SIKKERHED: den regenererer dagskort for dage UDEN FOR den aktuelle runde, så
-- ingen brugers karrusel ændrer sig. Motorerne er delete-then-insert pr.
-- periode, så kortene bliver bit-for-bit de samme. `recompute_ratings()` i
-- trin 5 er en fuld genopbygning — præcis den, triggeren selv kører hele tiden.
--
-- Kør HELE filen i Supabases SQL-editor med "Run without RLS".

drop table if exists _measure;
create temporary table _measure (
  ord int, trin text, maaling text, vaerdi text
);

-- ======================= 1. Hvor stort er grundlaget? =======================
do $$
begin
  insert into _measure values
    (11, '1. Grundlag', 'competition_match_points (= _sd_pts)',
        (select count(*) from public.competition_match_points)::text || ' rækker'),
    (12, '1. Grundlag', 'predictions',
        (select count(*) from public.predictions)::text || ' rækker'),
    (13, '1. Grundlag', 'spillede kampe',
        (select count(*) from public.matches where home_score is not null)::text),
    (14, '1. Grundlag', 'konkurrencer / deltagere',
        (select count(*) from public.competitions)::text || ' / ' ||
        (select count(*) from public.competition_participants)::text);
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
  v_i int := 20;
  -- Kun dage uden for den aktuelle runde: så kan ingen brugers karrusel ændre
  -- sig af, at vi måler (et dagskort uden for runden vises ikke).
  v_cur_round date := public.round_key_of_date(public.match_day(now()));
begin
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

      v_i := v_i + 1;
      insert into _measure values (v_i, '2. Dagsmotoren', d::text,
        round(v_ms, 1)::text || ' ms   (' ||
        (select count(*) from public.stories where period = 'day' and day_key = d)::text ||
        ' kort)');

      v_total := v_total + v_ms;
      if v_ms > v_max then v_max := v_ms; end if;
      v_n := v_n + 1;
    end if;
  end loop;

  if v_n = 0 then
    insert into _measure values (39, '2. Dagsmotoren', 'INGEN færdige dage fundet',
      'uden for den aktuelle runde');
  else
    insert into _measure values
      (38, '2. Dagsmotoren', '--> GENNEMSNIT', round(v_total / v_n, 1)::text || ' ms over ' || v_n || ' dage'),
      (39, '2. Dagsmotoren', '--> VÆRSTE', round(v_max, 1)::text || ' ms');
  end if;
end $$;

-- ======================= 3. Runde-motoren, til sammenligning =======================
do $$
declare r date; v_start timestamptz; v_ms numeric;
begin
  select max(m.round_key) into r
  from public.matches m
  where not exists (
    select 1 from public.matches m2
    where m2.round_key = m.round_key
      and (m2.home_score is null or m2.away_score is null)
  );

  if r is null then
    insert into _measure values (40, '3. Runde-motoren', 'ingen fuldt afsluttet runde', '—');
  else
    v_start := clock_timestamp();
    perform public.generate_stories(r::text);
    v_ms := extract(epoch from clock_timestamp() - v_start) * 1000;
    insert into _measure values (40, '3. Runde-motoren', 'runde ' || r::text,
      round(v_ms, 1)::text || ' ms');
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
  insert into _measure values (50, '4. Regel 140 isoleret', 'historik-scanningen alene',
    round(v_ms, 1)::text || ' ms   (' || v_rows || ' stimer udløst)');
end $$;

-- ======================= 5. Referencen: rating-genberegningen =======================
-- Den kører ved HVER resultatændring i forvejen. Ligger dagsmotoren under
-- dette tal, er der ingen sag: triggeren betaler allerede mere for noget,
-- den gør oftere.
do $$
declare v_start timestamptz; v_ms numeric; v_avg numeric;
begin
  v_start := clock_timestamp();
  perform public.recompute_ratings();
  v_ms := extract(epoch from clock_timestamp() - v_start) * 1000;

  insert into _measure values (60, '5. Reference', 'recompute_ratings()',
    round(v_ms, 1)::text || ' ms   (kører ved HVER resultatændring)');

  -- Dommen, regnet ud her frem for i hovedet. Grænserne står i filens hoved.
  select nullif(regexp_replace(vaerdi, ' ms.*', ''), '')::numeric into v_avg
  from _measure where ord = 38;

  insert into _measure values (70, '6. DOM', 'dagsmotor vs. reference',
    case
      when v_avg is null then 'kunne ikke måles — ingen færdige dage'
      when v_avg <= v_ms then 'BEHOLD ALT. Dagsmotoren er billigere end den rating, triggeren allerede kører ved hver resultatændring.'
      when v_avg < 1000 then 'BEHOLD, men mål igen ved næste turnering. Over referencen, under 1 s.'
      else 'HANDL. Over 1 s: drop regel 140 STREAK_STATUS først (se trin 4), derefter flyt dagsmotoren ud i cron.'
    end);
end $$;

-- ======================= Svaret =======================
select trin, maaling, vaerdi from _measure order by ord;
