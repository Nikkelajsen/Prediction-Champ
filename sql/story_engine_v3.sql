-- Story Engine v3 — ÉT ØJEBLIK OM DAGEN.
--
-- KØR EFTER sql/story_engine_v2_day.sql og sql/story_engine_v2.sql, og GEN-KØR
-- BAGEFTER sql/story_engine.sql (runde-motoren kalder nu build_round_frames)
-- og sql/analytics_events.sql (tre nye eventnavne). Idempotent.
--
-- ---------------------------------------------------------------------------
-- Hvad v3 ændrer
--
-- v2 udgav ALT, den fandt: op til to dagskort pr. bruger pr. dag, som
-- akkumulerede i en karrusel gennem runden. Med kampe fem dage om ugen ramte
-- den rutinemæssigt sit loft på ti kort, og `DAY_RESULT` optog plads 1 hver
-- eneste dag. Et øjeblik, der deles med ni andre, er ikke et øjeblik.
--
-- v3 ændrer ikke HVORNÅR motoren kører — kun hvad den udgiver:
--   · højst ÉT `period = 'day'`-kort pr. bruger pr. dag, på tværs af ALLE
--     konkurrencer, håndhævet af et unikt indeks frem for af koden,
--   · valget sker på en NYHEDSVÆRDI-score (grundvægt + størrelse + nærhed) med
--     publiceringstærskel 45; herunder udgives et dæmpet `DAY_RESULT`,
--   · rundens sidste dag udgiver INTET dagskort — kun rundekortet, som får
--     `payload.frames` og vises som tap-through-story,
--   · milepæle får aldrig eget kort, men kaprer dagens ene slot.
--
-- Spec: docs/features/story-engine-v3.md.
--
-- ---------------------------------------------------------------------------
-- NÆRHED ER GRUNDEN TIL, AT DENNE FIL ER STOR
--
-- I v2 var enhver historie "dig"-centreret: kandidatens bruger var også dens
-- modtager. v3's nærhedsled ("hovedpersonen er din nærmeste rival" = 14) findes
-- kun, fordi en kandidat nu kan gå til en modtager, der IKKE er hovedpersonen.
-- Kandidatsættet bærer derfor et `subject_id`, og udvælgelsen sker pr.
-- MODTAGER. Tre regler fan-outer (CONTRARIAN, DAY_TOP, STREAK_STATUS) og har
-- af samme grund en tredjepersons-tekstvariant; resten er personlige.
--
-- FAN-OUT SKER KUN INDEN FOR DELTE KONKURRENCER. Designreglen fra juli 2026 —
-- "en historie må kun nævne personer, modtageren deler konkurrence med" — er
-- håndhævet strukturelt af joinet til competition_participants i _sd_reach, og
-- ikke af en betingelse, nogen kan glemme.
--
-- ---------------------------------------------------------------------------
-- TYPER — uændret fra v2, og stadig den fælde, der fejler TAVST:
--   date : matches.round_key, matches.match_day, stories.day_key
--   text : stories.round_key, rating_history.round_key, milestones.round_key
-- Postgres har ingen `date = text`-operator, og hele kæden ligger bag
-- matches-triggerens exception-guard. Et tomt kort kan ikke skelnes fra en
-- stille dag — derfor påstår sql/tests/story_engine_daily.sql rækkeantal.

-- ======================= 1. Skema =======================

-- news_value gør tærskeljusteringen (A35) målbar BAGUDRETTET og et forkert valg
-- debuggbart. Den gemmes på ALLE v3-rækker — også de dæmpede — og bærer dagens
-- HØJESTE kandidatscore for brugeren, altså det tal, tærsklen blev målt imod.
alter table public.stories
  add column if not exists news_value int;

-- ÉT SLOT, håndhævet i databasen.
--
-- AFVIGELSE FRA SPEC §9, og den er bevidst: spec'en skriver indekset som
-- `where period = 'day'` alene, men de historiske v2-rækker har op til TO
-- rækker pr. (bruger, dag), og spec §9 beder samtidig om at BEHOLDE dem som
-- analysedata. De to krav kan ikke begge holdes med det snævre prædikat.
--
-- `news_value is not null` skiller de to æraer ad: hver eneste v3-skrivning
-- sætter kolonnen (den står i insert-listen i begge funktioner nedenfor), så
-- invarianten er DB-håndhævet for alt, v3 producerer, mens v2-rækkerne bliver
-- stående urørt. Prædikatet er blivende sandt og ikke en dato-litteral — en
-- dato ville gøre CI-testens fixture (marts 2026) blind for netop det indeks,
-- den skal bevise.
--
-- RESTRISIKOEN: en fremtidig skriver, der indsætter en day-række UDEN
-- news_value, smutter uden om nettet. Sker det, er kolonnen ikke længere
-- æra-markør, og prædikatet skal strammes.
--
-- INTET PRE-FLIGHT, og det er ikke en forglemmelse. v2's dagsindeks krævede et
-- (dets prædikat dækkede eksisterende rækker, som kunne indeholde dubletter),
-- men dette gør ikke: `add column` ovenfor giver hver eneste eksisterende række
-- `news_value = null`, så prædikatet matcher NUL rækker i det øjeblik, indekset
-- oprettes. Det kan pr. konstruktion ikke fejle på en v2-database.
--
-- En kopieret pre-flight ville desuden ikke kunne køres FØR filen — kolonnen,
-- den spørger om, oprettes seks linjer længere oppe. Kontrollen, der faktisk
-- betyder noget, hører til BAGEFTER og står i verifikationsblokken nederst.
create unique index if not exists stories_day_slot_uniq
  on public.stories (user_id, day_key)
  where period = 'day' and news_value is not null;

-- ======================= 2. generate_daily_stories() — v3 =======================
--
-- PRIORITETSBÅNDET 110–189 ER UÆNDRET, men befolkningen er ny:
--   110  MILESTONE        (kapringen — dagbåndets top)
--   120  CONTRARIAN
--   125  COLLECTIVE_MISS
--   130  DAY_TOP
--   140  STREAK_STATUS
--   150  DUEL
--   160  SO_CLOSE
--   180  DAY_RESULT       (dæmpet; det reserverede tier tages i brug)
-- Prioriteten AFGØR IKKE LÆNGERE VALGET — det gør news_value. Den er beholdt,
-- fordi tre ting uden for denne fil læser den: karriereprofilens filter
-- (< 90), isQuiet()/isDailyQuiet() i frontenden, og enhver forespørgsel, der
-- glemmer `period`-filteret, men sorterer på priority og dermed stadig får
-- runde-kort først (sikker degradering, v2 §3).
--
-- DAY_RESULT er flyttet fra 110 til 180, fordi den med grundvægt 8 aldrig kan
-- nå tærsklen ved egen kraft (8 + 12 + 20 = 40 < 45). Den udgives derfor KUN
-- som fald-tilbage, og et fald-tilbage skal se dæmpet ud.
create or replace function public.generate_daily_stories(p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_round      date := public.round_key_of_date(p_day);
  v_round_text text := v_round::text;
  v_daylabel   text := to_char(p_day, 'DD.MM');
  v_threshold  int  := 45;   -- spec §5. Ukalibreret; se A35.
begin
  -- Idempotens: KUN dagens dag-kort. `period = 'day'` er ikke pynt — uden det
  -- ville en gen-kørsel slette rundens afsluttende kort. Symmetrisk sletter
  -- generate_stories() kun `period = 'round'`. Den farligste linje i v2 er
  -- lige så farlig i v3.
  delete from public.stories where period = 'day' and day_key = p_day;

  -- ---------- Rundens sidste dag: kun rundekortet ----------
  -- Dags-motoren springes over — ikke fordi den ville fejle, men fordi to kort
  -- samme dag er præcis det, v3 afskaffer. Bemærk `not exists ... > p_day`:
  -- afgørelsen bygger på om der er FLERE kampdage i runden, ikke på om runden
  -- er færdigspillet, så en udsat kamp senere i ugen holder dagen åben.
  if exists (select 1 from public.matches where round_key = v_round and match_day = p_day)
     and not exists (select 1 from public.matches where round_key = v_round and match_day > p_day)
  then
    return;
  end if;

  -- ---------- fakta (uændret fra v2) ----------
  drop table if exists _sd_pts;
  create temporary table _sd_pts as
  select * from public.competition_match_points where match_day <= p_day;
  create index on _sd_pts (competition_id, user_id);
  create index on _sd_pts (competition_id, match_id);

  drop table if exists _sd_size;
  create temporary table _sd_size as
  select competition_id, count(*)::int as n
  from public.competition_participants group by competition_id;

  drop table if exists _sd_today;
  create temporary table _sd_today as
  select competition_id, user_id,
         sum(pts)::int                               as pts,
         count(*)::int                               as matches,
         (count(*) filter (where pts = 3))::int      as exact_count,
         (count(*) filter (where pts = 1))::int      as outcome_count,
         (count(*) filter (where goal_err = 1))::int as near_misses
  from _sd_pts where match_day = p_day
  group by competition_id, user_id;
  -- Indekserne på _sd_today/_sd_after/_sd_before findes ikke i v2 og er ikke
  -- pynt: v3 slår op i dem PR. MODTAGER (nærhed, størrelse, den hårde
  -- no-tips-regel), hvor v2 kun scannede dem sekventielt én gang pr. regel.
  -- Uden dem stiger dagsmotorens forhold til referencen recompute_ratings(),
  -- og det er præcis det, acceptkriterie 10 forbyder.
  create index on _sd_today (user_id);
  create index on _sd_today (competition_id, user_id);

  -- Kumulativ stilling EFTER og FØR dagen, med HELE tiebreaker-stigen — identisk
  -- med sql/tournament_scope.sql, src/lib/standings.js og generate_stories.
  drop table if exists _sd_after;
  create temporary table _sd_after as
  select competition_id, user_id, sum(pts)::int as pts,
    rank() over (partition by competition_id
                 order by sum(pts) desc,
                          (count(*) filter (where pts = 3)) desc,
                          (count(*) filter (where pts = 1)) desc,
                          round(sum(goal_err)::numeric / count(*), 4) asc)::int as rnk
  from _sd_pts group by competition_id, user_id;
  create index on _sd_after (competition_id, user_id);
  create index on _sd_after (user_id);

  drop table if exists _sd_before;
  create temporary table _sd_before as
  select competition_id, user_id, sum(pts)::int as pts,
    rank() over (partition by competition_id
                 order by sum(pts) desc,
                          (count(*) filter (where pts = 3)) desc,
                          (count(*) filter (where pts = 1)) desc,
                          round(sum(goal_err)::numeric / count(*), 4) asc)::int as rnk
  from _sd_pts where match_day < p_day group by competition_id, user_id;
  create index on _sd_before (competition_id, user_id);

  -- ---------- STØRRELSE (0–30), spec §4 ----------
  -- Tre bidrag, hver med sit eget loft, summen loftet ved 30. Størrelsen hører
  -- til HÆNDELSEN og dermed til hovedpersonen — ikke til modtageren. Den
  -- beregnes derfor én gang pr. (hovedperson, konkurrence) og slås op, frem for
  -- at blive gentaget i otte kandidat-inserts, hvor et tal kunne drive.
  --
  -- Placeringsændringen er ABSOLUT: et fald er lige så meget drama som en
  -- fremgang. Tonen ligger i teksten, ikke i scoringen.
  drop table if exists _sd_avg;
  create temporary table _sd_avg as
  select competition_id, avg(pts)::numeric as avg_pts
  from _sd_today group by competition_id;

  drop table if exists _sd_mag;
  create temporary table _sd_mag as
  select t.competition_id, t.user_id,
    least(18, 6 * abs(coalesce(b.rnk, a.rnk) - a.rnk))::int                    as move_pts,
    least(12, (3 * floor(greatest(0, t.pts - av.avg_pts)))::int)::int          as over_pts
  from _sd_today t
  join _sd_after a  on a.competition_id  = t.competition_id and a.user_id = t.user_id
  left join _sd_before b on b.competition_id = t.competition_id and b.user_id = t.user_id
  join _sd_avg av   on av.competition_id = t.competition_id;
  create index on _sd_mag (competition_id, user_id);

  -- Stimen beregnes ÉN gang og bruges to steder: som regel 140's indhold og som
  -- størrelsesbidrag for enhver af brugerens kandidater. Katalogets dyre regel
  -- (fuld historik-scanning, to vinduesfunktioner) skal ikke køre to gange.
  drop table if exists _sd_streak;
  create temporary table _sd_streak as
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
           max(match_day) as ended_day,
           max(kickoff_at) as run_last,
           max(max(kickoff_at)) over (partition by user_id) as last_kick
    from grp group by user_id, hit, g
  )
  select user_id, len, (run_last = last_kick) as alive
  from runs
  where hit and len >= 5 and ended_day = p_day;
  create index on _sd_streak (user_id);

  -- ---------- kandidater ----------
  -- `base` er grundvægten (spec §4). `priority` er kun visnings-metadata.
  -- headline3/body3 er tredjepersons-varianten og er null for de personlige
  -- regler — er den null, kan kandidaten pr. konstruktion ikke nå en fremmed.
  drop table if exists _sd_cand;
  create temporary table _sd_cand (
    cid            bigserial primary key,
    subject_id     uuid not null,
    competition_id uuid,
    rule           text not null,
    priority       int  not null,
    base           int  not null,
    league_size    int,
    payload        jsonb not null,
    headline       text not null,
    body           text not null,
    headline3      text,
    body3          text
  );

  -- ======== 180 · Dagens facit (grundvægt 8) ========
  -- Ankeret, og efter v3 ALTID dæmpet: 8 + 12 + 20 = 40 kan ikke nå 45. Den
  -- findes for at være dagens fald-tilbage og for at bidrage til news_value.
  -- Ingen emoji — emoji er højdepunktets signal (v1.1), og et facit er ikke et
  -- højdepunkt.
  --
  -- TONEREGLEN ("driller, ydmyger aldrig"): placeringen nævnes KUN i den
  -- øverste halvdel af tabellen. Nederst står afstanden op til toppen.
  insert into _sd_cand (subject_id, competition_id, rule, priority, base, league_size, payload, headline, body)
  select t.user_id, t.competition_id, 'DAY_RESULT', 180, 8, sz.n,
    jsonb_build_object('points', t.pts, 'matches', t.matches, 'exact', t.exact_count,
                       'rank', a.rnk, 'total', sz.n, 'moved', coalesce(b.rnk - a.rnk, 0),
                       'gap', top.pts - a.pts, 'league', c.name),
    'Dagens facit: ' || t.pts || ' point',
    t.matches || case when t.matches = 1 then ' kamp' else ' kampe' end ||
      ' i ' || c.name ||
      case when t.exact_count > 0
           then ' — ' || t.exact_count || case when t.exact_count = 1 then ' præcis.' else ' præcise.' end
           else '.' end ||
      case
        when b.rnk is not null and b.rnk > a.rnk
          then ' Du rykkede fra nr. ' || b.rnk || ' til nr. ' || a.rnk || '.'
        when a.rnk * 2 <= sz.n
          then ' Du ligger nr. ' || a.rnk || ' af ' || sz.n || '.'
        when (top.pts - a.pts) > 0
          then ' Toppen er ' || (top.pts - a.pts) || ' point væk.'
        else ''
      end
  from _sd_today t
  join _sd_size sz on sz.competition_id = t.competition_id
  join public.competitions c on c.id = t.competition_id
  join _sd_after a on a.competition_id = t.competition_id and a.user_id = t.user_id
  left join _sd_before b on b.competition_id = t.competition_id and b.user_id = t.user_id
  join lateral (select pts from _sd_after a2
                where a2.competition_id = t.competition_id and a2.rnk = 1
                order by a2.user_id limit 1) top on true
  where t.matches >= 1;

  -- ======== 120 · Kontrarian (grundvægt 32, FAN-OUT) ========
  -- Præcis ÉN deltager ramte udfaldet — blandt mindst fire, der tippede kampen.
  -- Tærsklen er hele reglen: i en 3-mands konkurrence er "den eneste" støj.
  insert into _sd_cand (subject_id, competition_id, rule, priority, base, league_size, payload, headline, body, headline3, body3)
  select w.user_id, w.competition_id, 'CONTRARIAN', 120, 32, sz.n,
    jsonb_build_object('team', w.pick, 'home', w.home, 'away', w.away,
                       'score', w.hs || '-' || w.away_s, 'others', w.n_pred - 1,
                       'points', w.pts, 'draw', w.is_draw, 'league', c.name,
                       'subject', pr.display_name),
    case when w.is_draw
         then '🧠 Du var den eneste, der troede på uafgjort i ' || w.home || '–' || w.away
         else '🧠 Du var den eneste, der troede på ' || w.pick end,
    'I ' || c.name || ' havde ' || (w.n_pred - 1) ||
      case when w.n_pred - 1 = 1 then ' anden' else ' andre' end ||
      ' tippet imod. Det endte ' || w.home || ' ' || w.hs || '-' || w.away_s || ' ' || w.away ||
      ' — ' || w.pts || ' point til dig.',
    case when w.is_draw
         then '🧠 ' || pr.display_name || ' var den eneste, der troede på uafgjort i ' || w.home || '–' || w.away
         else '🧠 ' || pr.display_name || ' var den eneste, der troede på ' || w.pick end,
    'I ' || c.name || ' tippede ' || (w.n_pred - 1) ||
      case when w.n_pred - 1 = 1 then ' anden' else ' andre' end ||
      ' imod. Det endte ' || w.home || ' ' || w.hs || '-' || w.away_s || ' ' || w.away ||
      ' — ' || w.pts || ' point til ' || pr.display_name || '.'
  from (
    select p.competition_id, p.match_id, p.user_id, p.pts,
           m.home_score as hs, m.away_score as away_s,
           th.name as home, ta.name as away,
           (m.home_score = m.away_score) as is_draw,
           case when m.home_score > m.away_score then th.name
                when m.home_score < m.away_score then ta.name
                else 'uafgjort' end as pick,
           -- SKALAR SUBQUERY, ikke `count(*) over (partition by ...)`:
           -- vinduesfunktioner beregnes EFTER where-klausulen, og da den
           -- filtrerer til `pts >= 1`, ville vinduet tælle netop de træffere,
           -- vi allerede ved der kun er én af — n_pred blev 1, tærsklen `>= 4`
           -- kunne aldrig opfyldes, og reglen udløste dermed aldrig.
           (select count(*) from _sd_pts q2
            where q2.competition_id = p.competition_id and q2.match_id = p.match_id) as n_pred
    from _sd_pts p
    join public.matches m on m.id = p.match_id
    join public.teams th on th.id = m.home_team_id
    join public.teams ta on ta.id = m.away_team_id
    where p.match_day = p_day and p.pts >= 1
      and 1 = (select count(*) from _sd_pts q
               where q.competition_id = p.competition_id
                 and q.match_id = p.match_id and q.pts >= 1)
  ) w
  join _sd_size sz on sz.competition_id = w.competition_id
  join public.competitions c on c.id = w.competition_id
  join public.profiles pr on pr.id = w.user_id
  where w.n_pred >= 4;

  -- ======== 125 · Kollektiv fiasko (grundvægt 24) ========
  -- Personlig i fan-out-forstand: modtageren var SELV en af dem, der missede,
  -- så hovedpersonen er modtageren, og nærheden er 20. Med 24 + 20 = 44 lander
  -- den bevidst ét point under tærsklen: en fælles fiasko alene er dagens
  -- facit, men sammen med bevægelse i tabellen bliver den en historie.
  --
  -- `distinct on` er bærende: uden det giver en dårlig dag fire ens kandidater
  -- pr. bruger.
  insert into _sd_cand (subject_id, competition_id, rule, priority, base, league_size, payload, headline, body)
  select distinct on (p.competition_id, p.user_id)
    p.user_id, p.competition_id, 'COLLECTIVE_MISS', 125, 24, sz.n,
    jsonb_build_object('home', th.name, 'away', ta.name,
                       'score', m.home_score || '-' || m.away_score,
                       'n', (select count(*) from _sd_pts q
                             where q.competition_id = p.competition_id and q.match_id = p.match_id),
                       'league', c.name),
    '🙈 Ingen ramte ' || th.name || '–' || ta.name,
    (select count(*) from _sd_pts q
     where q.competition_id = p.competition_id and q.match_id = p.match_id) ||
      ' tippede kampen i ' || c.name || '. Den endte ' ||
      m.home_score || '-' || m.away_score || ' — og ingen havde den.'
  from _sd_pts p
  join public.matches m on m.id = p.match_id
  join public.teams th on th.id = m.home_team_id
  join public.teams ta on ta.id = m.away_team_id
  join _sd_size sz on sz.competition_id = p.competition_id
  join public.competitions c on c.id = p.competition_id
  where p.match_day = p_day
    and 4 <= (select count(*) from _sd_pts q
              where q.competition_id = p.competition_id and q.match_id = p.match_id)
    and 0 = (select count(*) from _sd_pts q
             where q.competition_id = p.competition_id and q.match_id = p.match_id and q.pts >= 1)
  order by p.competition_id, p.user_id, p.match_id;

  -- ======== 130 · Dagens højeste (grundvægt 34, FAN-OUT) ========
  -- Vinder-sættet skal være MINDRE end feltet — ellers kåres alle på en dag,
  -- hvor samtlige deltagere fik det samme.
  insert into _sd_cand (subject_id, competition_id, rule, priority, base, league_size, payload, headline, body, headline3, body3)
  select w.user_id, w.competition_id, 'DAY_TOP', 130, 34, sz.n,
    jsonb_build_object('points', w.pts, 'exact', w.exact_count,
                       'shared', w.n_top > 1, 'others', w.n_top - 1, 'league', c.name,
                       'subject', pr.display_name),
    '🔝 Du fik dagens højeste i ' || c.name,
    w.pts || ' point — flest af alle i ' || c.name || ' den ' || v_daylabel ||
      case when w.n_top > 2 then ' (delt med ' || (w.n_top - 1) || ' andre).'
           when w.n_top = 2 then ' (delt med 1 anden).'
           else '.' end,
    '🔝 ' || pr.display_name || ' fik dagens højeste i ' || c.name,
    w.pts || ' point — flest af alle i ' || c.name || ' den ' || v_daylabel ||
      case when w.n_top > 2 then ' (delt med ' || (w.n_top - 1) || ' andre).'
           when w.n_top = 2 then ' (delt med 1 anden).'
           else '.' end
  from (
    select competition_id, user_id, pts, exact_count,
           count(*) over (partition by competition_id) as n_top,
           n_played
    from (
      select competition_id, user_id, pts, exact_count,
             rank() over (partition by competition_id
                          order by pts desc, exact_count desc, outcome_count desc) as rnk,
             count(*) over (partition by competition_id) as n_played
      from _sd_today where matches >= 2
    ) r where r.rnk = 1
  ) w
  join _sd_size sz on sz.competition_id = w.competition_id and sz.n >= 3
  join public.competitions c on c.id = w.competition_id
  join public.profiles pr on pr.id = w.user_id
  where w.pts > 0 and w.n_top < w.n_played;

  -- ======== 140 · Stime-status (global, grundvægt 28, FAN-OUT) ========
  -- Fyrer KUN, når stimen blev forlænget i dag eller brudt i dag. Uden den
  -- betingelse ville den udløses hver eneste dag, stimen lever.
  -- competition_id er null: stimen er global, og fan-out sker via enhver delt
  -- konkurrence (se _sd_reach).
  insert into _sd_cand (subject_id, competition_id, rule, priority, base, league_size, payload, headline, body, headline3, body3)
  select s.user_id, null, 'STREAK_STATUS', 140, 28, null,
    jsonb_build_object('n', s.len, 'alive', s.alive, 'subject', pr.display_name),
    case when s.alive then '🔥 ' || s.len || ' kampe i træk med point'
         else '💤 Din stime stoppede ved ' || s.len end,
    case when s.alive
         then 'Du har fået point i ' || s.len || ' kampe i træk. Stimen lever efter den ' || v_daylabel || '.'
         else 'Efter ' || s.len || ' kampe i træk med point brød stimen den ' || v_daylabel || '. En ny begynder i morgen.'
    end,
    case when s.alive then '🔥 ' || pr.display_name || ' har ' || s.len || ' kampe i træk med point'
         else '💤 ' || pr.display_name || 's stime stoppede ved ' || s.len end,
    case when s.alive
         then pr.display_name || ' har fået point i ' || s.len || ' kampe i træk. Stimen lever efter den ' || v_daylabel || '.'
         else 'Efter ' || s.len || ' kampe i træk med point brød ' || pr.display_name ||
              's stime den ' || v_daylabel || '.'
    end
  from _sd_streak s
  join public.profiles pr on pr.id = s.user_id;

  -- ======== 150 · Duel (grundvægt 30) ========
  -- `is distinct from` på afstanden er HELE reglen. Uden den fyrer duellen hver
  -- eneste dag med identisk tekst for alle i den øverste halvdel.
  insert into _sd_cand (subject_id, competition_id, rule, priority, base, league_size, payload, headline, body)
  with lad as (
    select a.competition_id, a.user_id, a.pts,
           lag(a.user_id)  over w as above_id, lag(a.pts)  over w as above_pts,
           lead(a.user_id) over w as below_id, lead(a.pts) over w as below_pts
    from _sd_after a
    window w as (partition by a.competition_id order by a.rnk, a.user_id)
  ),
  pick as (
    select competition_id, user_id, pts,
           coalesce(above_id, below_id) as rival_id,
           (above_id is not null)       as is_above,
           case when above_id is not null then above_pts - pts
                else pts - below_pts end as gap
    from lad
    where coalesce(above_id, below_id) is not null
  ),
  duel as (
    -- Afstanden FØR dagen mellem de samme to personer. Er den uændret, er der
    -- ikke sket noget i dag, og så er der ingen historie. prev_gap = null (en af
    -- de to havde ingen point før i dag) tæller som "ændret".
    select p.*,
           case when p.is_above then br.pts - bu.pts else bu.pts - br.pts end as prev_gap
    from pick p
    left join _sd_before bu on bu.competition_id = p.competition_id and bu.user_id = p.user_id
    left join _sd_before br on br.competition_id = p.competition_id and br.user_id = p.rival_id
  )
  select d.user_id, d.competition_id, 'DUEL', 150, 30, sz.n,
    jsonb_build_object('rival', pr.display_name, 'gap', d.gap,
                       'above', d.is_above, 'league', c.name),
    case when d.is_above
         then '⚔️ Kun ' || d.gap || ' point op til ' || pr.display_name
         else '⚔️ ' || pr.display_name || ' er ' || d.gap || ' point efter dig' end,
    case when d.is_above
         then 'Efter den ' || v_daylabel || ' er der ' || d.gap || ' point op til ' ||
              pr.display_name || ' i ' || c.name || '.'
         else 'Du fører ' || c.name || ' med ' || d.gap || ' point ned til ' ||
              pr.display_name || ' efter den ' || v_daylabel || '.' end
  from duel d
  join _sd_size sz on sz.competition_id = d.competition_id and sz.n >= 3
  join public.competitions c on c.id = d.competition_id
  join public.profiles pr on pr.id = d.rival_id
  where d.gap between 1 and 3
    and d.gap is distinct from d.prev_gap;

  -- ======== 160 · Så tæt på (grundvægt 18) ========
  -- goal_err = 1 er ~⅓ af alle tips, så ét nærmiss er ikke en historie. To er.
  insert into _sd_cand (subject_id, competition_id, rule, priority, base, league_size, payload, headline, body)
  select t.user_id, t.competition_id, 'SO_CLOSE', 160, 18, sz.n,
    jsonb_build_object('n', t.near_misses, 'league', c.name),
    '😤 Ét mål fra ' || t.near_misses || ' eksakte',
    t.near_misses || ' af dine tips i ' || c.name || ' den ' || v_daylabel ||
      ' ramte målscoren på ét mål nær.'
  from _sd_today t
  join _sd_size sz on sz.competition_id = t.competition_id
  join public.competitions c on c.id = t.competition_id
  where t.near_misses >= 2;

  -- ======== 110 · Milepæl (grundvægt 100 — kaprer dagens slot) ========
  -- Milepæle får ALDRIG deres eget kort i køen (spec §6). De deltager i
  -- scoringen som enhver anden kandidat og vinder derfor altid.
  --
  -- TILKNYTNINGSDAGEN er `max(match_day) <= match_day(achieved_at)`: er
  -- milepælen uddelt på en kampdag, er det den dag; ellers den seneste kampdag
  -- før. Formlen er ORDRET DEN SAMME i apply_milestone_stories() nedenfor, og
  -- det er ikke en tilfældighed — det er dét, der gør, at en gen-kørsel af
  -- denne funktion GENSKABER en kapring, den lige har slettet. Ændres den ene,
  -- skal den anden ændres samtidig, ellers går sene milepæle tabt ved næste
  -- resultatrettelse.
  --
  -- Er der flere samme dag, vises den med højeste familie-rang og tier; resten
  -- ligger på karriereprofilen uden nogensinde at have været på Hjem. Ét slot
  -- ⇒ mængden kan ikke eksplodere, uanset hvor mange der udløses samtidigt.
  -- Rangordenen er MILESTONE_FAMILIES' egen (src/lib/milestones.js), spejlet.
  --
  -- headline/body er kun et FALDBACK. Klienten renderer altid milepælskort fra
  -- payload.milestone_key via renderMilestone() — teksten bor kun i JS, jf.
  -- milepaele-v1.md §8, og der er derfor ingen skabelon at holde i sync.
  insert into _sd_cand (subject_id, competition_id, rule, priority, base, league_size, payload, headline, body)
  select distinct on (m.user_id)
    m.user_id, m.competition_id, 'MILESTONE', 110, 100, sz.n,
    jsonb_build_object('milestone_key', m.key, 'milestone_payload', m.payload,
                       'family', m.family, 'tier', m.tier),
    'Ny milepæl', m.key
  from public.milestones m
  left join _sd_size sz on sz.competition_id = m.competition_id
  where (select max(mm.match_day) from public.matches mm
         where mm.match_day <= public.match_day(m.achieved_at)) = p_day
  order by m.user_id,
           case m.family when 'competition' then 0 when 'rating' then 1
                         when 'precision'  then 2 when 'community' then 3 else 4 end,
           m.tier desc, m.key asc;

  -- ---------- MODTAGERKREDSEN (fan-out) ----------
  -- Personlige regler når kun hovedpersonen. De tre fan-out-regler når alle,
  -- der DELER KONKURRENCE med hovedpersonen — designreglen håndhævet af joinet
  -- og ikke af en betingelse. En global kandidat (STREAK_STATUS) når via
  -- enhver delt konkurrence, og duplikaterne kollapses nedenfor med max().
  drop table if exists _sd_reach;
  create temporary table _sd_reach (cid bigint, user_id uuid, via_competition uuid);

  insert into _sd_reach (cid, user_id, via_competition)
  select c.cid, c.subject_id, c.competition_id
  from _sd_cand c
  where c.headline3 is null;

  insert into _sd_reach (cid, user_id, via_competition)
  select c.cid, cp.user_id, cs.competition_id
  from _sd_cand c
  join public.competition_participants cs on cs.user_id = c.subject_id
  join public.competition_participants cp on cp.competition_id = cs.competition_id
  where c.headline3 is not null
    and (c.competition_id is null or cs.competition_id = c.competition_id);

  -- ---------- NÆRHED (0–20), spec §4 ----------
  -- Beregnes PR. MODTAGER, ikke pr. hændelse: samme kamp giver forskellige kort
  -- til forskellige brugere, og det er meningen. Det er også grunden til, at
  -- slottet er (user_id, day_key)-unikt og ikke (competition_id, day_key).
  --
  -- Modtagerens største liga (flest deltagere) — deterministisk tiebreak.
  drop table if exists _sd_big;
  create temporary table _sd_big as
  select distinct on (cp.user_id) cp.user_id, cp.competition_id
  from public.competition_participants cp
  join _sd_size sz on sz.competition_id = cp.competition_id
  order by cp.user_id, sz.n desc, cp.competition_id asc;
  create index on _sd_big (user_id);

  -- Naboerne i stillingen. Samme lag/lead-stige som DUEL — nærmeste rival er
  -- den, man deler grænse med, og ikke enhver inden for tre point.
  drop table if exists _sd_rival;
  create temporary table _sd_rival as
  select competition_id, user_id, rival_id from (
    select a.competition_id, a.user_id,
           lag(a.user_id)  over w as up_id,   lag(a.pts)  over w as up_pts,
           lead(a.user_id) over w as down_id, lead(a.pts) over w as down_pts,
           a.pts
    from _sd_after a
    window w as (partition by a.competition_id order by a.rnk, a.user_id)
  ) l
  cross join lateral (values (l.up_id, l.up_pts - l.pts), (l.down_id, l.pts - l.down_pts))
    as v(rival_id, gap)
  where v.rival_id is not null and v.gap between 0 and 3;
  create index on _sd_rival (user_id, rival_id);

  drop table if exists _sd_prox;
  create temporary table _sd_prox as
  select r.cid, r.user_id, max(
    case
      when r.user_id = c.subject_id then 20
      when exists (select 1 from _sd_rival rv
                   where rv.competition_id = r.via_competition
                     and rv.user_id = r.user_id and rv.rival_id = c.subject_id) then 14
      when r.via_competition = bg.competition_id then 8
      else 4
    end)::int as prox
  from _sd_reach r
  join _sd_cand c on c.cid = r.cid
  left join _sd_big bg on bg.user_id = r.user_id
  group by r.cid, r.user_id;

  -- ---------- SCORING ----------
  -- nyhedsværdi = grundvægt + størrelse + nærhed (spec §4). Tallene står også i
  -- src/lib/stories.js og SKAL være ens: en afvigelse giver ikke en fejl, men
  -- et ANDET kort — tavst. Se docs/BACKLOG.md G78.
  drop table if exists _sd_scored;
  create temporary table _sd_scored as
  select px.user_id, c.cid, c.subject_id, c.competition_id, c.rule, c.priority,
         c.base, c.league_size, c.payload, c.headline, c.body, c.headline3, c.body3,
         -- MILESTONE får INTET størrelsesbidrag, og det er ikke en forglemmelse.
         -- En milepæl er en engangsbedrift; dens vægt er, at den er sket — ikke
         -- hvor mange pladser man tilfældigvis rykkede samme dag. Uden dette
         -- ville et milepælskort score forskelligt alt efter, om det blev
         -- skrevet af motoren (som kender dagens tal) eller af cron-kapringen
         -- (som ikke gør), og de to skal give SAMME række. news_value for en
         -- milepæl er derfor altid 100 + 20 = 120.
         case
           when c.rule = 'MILESTONE' then 0
           -- DAY_RESULT får KUN afstanden til dagens gennemsnit. Spec §5's
           -- regnestykke er et krav: 8 + 12 + 20 = 40 < 45, så dagens facit
           -- "kommer aldrig over tærsklen ved egen kraft ... det er en
           -- oplysning, ikke en historie". Med hele størrelsesloftet kunne den
           -- nå 58 og udgive sig selv som dagens historie — og så ville der
           -- aldrig findes en dag under tærsklen at falde tilbage til.
           when c.rule = 'DAY_RESULT' then coalesce(mg.over_pts, 0)
           else least(30, coalesce(mg.move_pts, 0) + coalesce(mg.over_pts, 0)
                        + least(12, 2 * greatest(0, coalesce(st.len, 0) - 5)))
         end::int as size_pts,
         px.prox
  from _sd_prox px
  join _sd_cand c on c.cid = px.cid
  left join _sd_mag mg on mg.competition_id = c.competition_id and mg.user_id = c.subject_id
  left join _sd_streak st on st.user_id = c.subject_id;

  create index on _sd_scored (user_id);
  alter table _sd_scored add column news_value int;
  update _sd_scored set news_value = base + size_pts + prox;

  -- HÅRD REGEL (acceptkriterie 8): en bruger uden ét eneste scoret tip på en
  -- kampdag får ALDRIG et drama-kort om andre. Uden denne linje kunne et
  -- fan-out-kort (34 + 20 = 54) lande hos en, der slet ikke var med.
  delete from _sd_scored s
  where not exists (select 1 from _sd_today t where t.user_id = s.user_id);

  -- ---------- UDVÆLGELSEN: én vinder pr. modtager ----------
  -- Afgørelse ved lige score (spec §4): højeste grundvægt → største konkurrence
  -- → laveste rule alfabetisk. De sidste tre led (competition_id, subject_id,
  -- headline) er ikke i spec'en, men er nødvendige for at to gen-kørsler giver
  -- SAMME kort — acceptkriterie 7. Uden dem ville to CONTRARIAN-kandidater fra
  -- samme dag i samme konkurrence være uadskillelige, og databasen valgte frit.
  drop table if exists _sd_rank;
  create temporary table _sd_rank as
  select *, row_number() over (
    partition by user_id
    order by news_value desc, base desc, league_size desc nulls last, rule asc,
             competition_id asc nulls last, subject_id asc, headline asc
  ) as rn
  from _sd_scored;

  -- ---------- UDGIVELSEN ----------
  -- news_value på rækken er dagens HØJESTE kandidatscore for brugeren — også
  -- når kortet er dæmpet. Det er tallet, tærsklen blev målt imod, og dermed
  -- A35's måledata. runner_up_value er nr. 2.
  insert into public.stories
    (round_key, day_key, period, user_id, competition_id, rule, priority,
     league_size, news_value, payload, headline, body)
  select v_round_text, p_day, 'day', w.user_id, w.competition_id, w.rule, w.priority,
         w.league_size, w.news_value,
         w.payload || jsonb_build_object(
           'day', v_daylabel, 'day_key', p_day,
           'third', w.user_id <> w.subject_id,
           'winner_rule', w.rule,
           'runner_up_value', coalesce(up.news_value, 0)),
         case when w.user_id <> w.subject_id then w.headline3 else w.headline end,
         case when w.user_id <> w.subject_id then w.body3     else w.body     end
  from _sd_rank w
  left join _sd_rank up on up.user_id = w.user_id and up.rn = 2
  where w.rn = 1 and w.news_value >= v_threshold;

  -- ---------- DET DÆMPEDE FALD-TILBAGE ----------
  -- Vinder < 45 ⇒ dagens facit uden ulæst-markering: en oplysning, ingen påstand
  -- om at der skete noget. Pointen er, at ULÆST-SIGNALET BLIVER SJÆLDENT NOK TIL
  -- AT BETYDE NOGET. Et badge, der lyser hver dag, er ikke et signal, det er en
  -- baggrundsfarve.
  --
  -- news_value bærer stadig den højeste kandidatscore, så en dag, der lå ét
  -- point under, kan kendes fra en dag, hvor intet skete.
  insert into public.stories
    (round_key, day_key, period, user_id, competition_id, rule, priority,
     league_size, news_value, payload, headline, body)
  select v_round_text, p_day, 'day', d.user_id, d.competition_id, 'DAY_RESULT', 180,
         d.league_size, coalesce(best.news_value, 0),
         d.payload || jsonb_build_object(
           'day', v_daylabel, 'day_key', p_day, 'third', false,
           'winner_rule', coalesce(best.rule, 'DAY_RESULT'),
           'runner_up_value', 0),
         d.headline, d.body
  from (
    select distinct on (s.user_id) s.*
    from _sd_scored s
    where s.rule = 'DAY_RESULT'
    order by s.user_id, s.league_size desc nulls last, s.competition_id asc
  ) d
  left join lateral (
    select r.news_value, r.rule from _sd_rank r where r.user_id = d.user_id and r.rn = 1
  ) best on true
  where coalesce(best.news_value, 0) < v_threshold;

  -- ---------- TIPS-PÅMINDELSEN (acceptkriterie 8) ----------
  -- Deltagere i en konkurrence med kampe i dag, som ikke havde ét eneste scoret
  -- tip. De har ingen DAY_RESULT-kandidat og ville ellers stå helt uden kort —
  -- og et drama-kort om andre er udtrykkeligt det forkerte svar. De får dagens
  -- omfang og en fremadrettet slutning. Ingen emoji: dette er dæmpet tier.
  insert into public.stories
    (round_key, day_key, period, user_id, competition_id, rule, priority,
     league_size, news_value, payload, headline, body)
  select v_round_text, p_day, 'day', q.user_id, q.competition_id, 'DAY_RESULT', 180,
         q.league_size, 0,
         jsonb_build_object('variant', 'no_tips', 'matches', q.matches,
                            'league', q.league, 'day', v_daylabel, 'day_key', p_day,
                            'third', false, 'winner_rule', 'DAY_RESULT',
                            'runner_up_value', 0),
         'Ingen tips i dag',
         'Der blev spillet ' || q.matches ||
           case when q.matches = 1 then ' kamp' else ' kampe' end ||
           ' i ' || q.league || ', men du havde ingen tips med. Husk at tippe, inden næste kamp låser.'
  from (
    select distinct on (cp.user_id)
      cp.user_id, cm.competition_id, c.name as league, sz.n as league_size,
      count(*) over (partition by cp.user_id, cm.competition_id)::int as matches
    from public.competition_matches cm
    join public.matches m on m.id = cm.match_id
    join public.competition_participants cp on cp.competition_id = cm.competition_id
    join public.competitions c on c.id = cm.competition_id
    join _sd_size sz on sz.competition_id = cm.competition_id
    where m.match_day = p_day and m.home_score is not null and m.away_score is not null
      and not exists (select 1 from _sd_today t where t.user_id = cp.user_id)
    order by cp.user_id, sz.n desc, cm.competition_id asc
  ) q;

  drop table if exists _sd_pts;
  drop table if exists _sd_size;
  drop table if exists _sd_today;
  drop table if exists _sd_after;
  drop table if exists _sd_before;
  drop table if exists _sd_avg;
  drop table if exists _sd_mag;
  drop table if exists _sd_streak;
  drop table if exists _sd_cand;
  drop table if exists _sd_reach;
  drop table if exists _sd_big;
  drop table if exists _sd_rival;
  drop table if exists _sd_prox;
  drop table if exists _sd_scored;
  drop table if exists _sd_rank;
end;
$fn$;

revoke execute on function public.generate_daily_stories(date) from public, anon, authenticated;
grant execute on function public.generate_daily_stories(date) to service_role;

-- ======================= 3. build_round_frames() =======================
-- Rundens sidste dag udgiver kun rundekortet, og det bliver til gengæld en
-- tap-through-story med 4–5 frames. Frames er PER BRUGER (rating, percentil,
-- Månedsligaen), mens runde-motoren skriver per-konkurrence-kandidater — så de
-- kan ikke bygges i de eksisterende inserts.
--
-- HVOR DE GEMMES: på præcis den række, latest_story ville vælge, i
-- `payload.frames`. Ikke på alle brugerens rækker (N× duplikeret blob), ikke i
-- en ny kolonne (latest_story har en BINDENDE kolonnerækkefølge og skal
-- droppes-og-genskabes for at få nye kolonner — den fælde er dokumenteret i
-- sql/story_engine_v2.sql), og ikke i en ny tabel (spec §9: ingen ny tabel).
-- ORDER BY nedenfor SKAL være byte-identisk med viewets, ellers får en anden
-- række end den viste sine frames.
--
-- HVORFOR EN EGEN FUNKTION frem for kode inde i generate_stories(): den kaldes
-- fra TO steder. Runde-motoren bygger frames ved hver generering, og
-- apply_milestone_stories() bygger dem om, når en milepæl lander EFTER at
-- rundestoryen er skrevet (frame 5 er betinget af netop den milepæl).
--
-- Frame 4 er GLOBAL — rundens Champion og Månedsligaen. Det bryder ikke
-- designreglen om, hvem en historie må nævne: DOCUMENTATION §5 fastslår, at
-- alle brugere automatisk er med i rundechampionshippet og månedschampionshippet,
-- så det er en arena, modtageren deler med enhver. Rundens Champion står
-- allerede med navn på Championship-fanen for alle.
create or replace function public.build_round_frames(p_round_key text)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_round date := p_round_key::date;
  v_label text := to_char(p_round_key::date, 'DD.MM') || ' – ' || to_char(p_round_key::date + 6, 'DD.MM');
  v_month text := to_char(p_round_key::date, 'YYYY-MM');
  v_n int := 0;
begin
  -- Rundens vinder(e) globalt. Delt sejr nævnes som sådan.
  drop table if exists _bf_champ;
  create temporary table _bf_champ as
  select pr.display_name as name, rs.total_points as points,
         count(*) over ()::int as n_winners
  from public.round_standings rs
  join public.profiles pr on pr.id = rs.user_id
  where rs.round_key = v_round and rs.scope = 'ALL'
    and rs.total_points = (select max(total_points) from public.round_standings
                           where round_key = v_round and scope = 'ALL');

  -- Frame 1's percentil kræver hele feltet, ikke kun brugerens række.
  drop table if exists _bf_me;
  create temporary table _bf_me as
  select rs.user_id, rs.total_points, rs.exact_count, rs.matches,
         rank() over (order by rs.total_points desc)::int as rnk,
         count(*) over ()::int as n_field
  from public.round_standings rs
  where rs.round_key = v_round and rs.scope = 'ALL';

  -- Bedste og værste tip i runden. Samme afgrænsning som round_standings (kun
  -- officielle ligaer), så frame 2 ikke kan nævne en kamp, frame 1 ikke talte.
  drop table if exists _bf_tips;
  create temporary table _bf_tips as
  select pr.user_id, th.name as home, ta.name as away,
         m.home_score || '-' || m.away_score as score,
         pr.pred_home || '-' || pr.pred_away as guess,
         public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) as pts,
         abs(pr.pred_home - m.home_score) + abs(pr.pred_away - m.away_score) as goal_err,
         m.kickoff_at, m.id as match_id
  from public.predictions pr
  join public.matches m on m.id = pr.match_id
  join public.seasons s on s.id = m.season_id
  join public.leagues l on l.id = s.league_id and l.is_official
  join public.teams th on th.id = m.home_team_id
  join public.teams ta on ta.id = m.away_team_id
  where m.round_key = v_round
    and m.home_score is not null and m.away_score is not null
    and pr.pred_home is not null and pr.pred_away is not null;

  -- Bedste og værste tip PRÆ-AGGREGERES med `distinct on` frem for at blive
  -- slået op med en lateral pr. bruger. Det er ikke mikro-optimering: med en
  -- lateral sorterede Postgres hele _bf_tips forfra for hver eneste bruger, og
  -- rundemotoren gik fra 77 ms til 886 ms på en syntetisk fuld sæson —
  -- 7× referencen recompute_ratings(), stik imod acceptkriterie 10. To
  -- distinct on-pas koster to sorteringer i alt.
  -- Tiebreak på kickoff og match_id, så to lige gode tips altid giver samme svar.
  drop table if exists _bf_best;
  create temporary table _bf_best as
  select distinct on (user_id) * from _bf_tips
  order by user_id, pts desc, goal_err asc, kickoff_at asc, match_id asc;
  create index on _bf_best (user_id);

  drop table if exists _bf_worst;
  create temporary table _bf_worst as
  select distinct on (user_id) * from _bf_tips
  order by user_id, pts asc, goal_err desc, kickoff_at asc, match_id asc;
  create index on _bf_worst (user_id);

  -- Månedsstillingen materialiseres ÉN gang. Som lateral blev vinduesfunktionen
  -- kørt om for hver bruger — samme kvadratiske form som tips-opslaget ovenfor.
  drop table if exists _bf_month;
  create temporary table _bf_month as
  select user_id, total_points,
         rank() over (order by total_points desc)::int as rnk,
         count(*) over ()::int as n_field
  from public.monthly_standings where month = v_month and scope = 'ALL';
  create index on _bf_month (user_id);

  -- Vinder-rækken pr. bruger — byte-samme ORDER BY som latest_story-viewet.
  drop table if exists _bf_row;
  create temporary table _bf_row as
  select distinct on (user_id) id, user_id
  from public.stories
  where round_key = p_round_key and period = 'round'
  order by user_id, priority asc, league_size desc nulls last, competition_id asc nulls last;

  with frames as (
    select r.id, r.user_id,
      jsonb_build_array(
        -- Frame 1 · Din runde. Percentilen er "bedre end X %" og afrundes ned,
        -- så tallet aldrig lover mere, end det kan holde.
        jsonb_build_object('frame', 'ROUND_SUM', 'label', v_label,
          'points', coalesce(me.total_points, 0), 'exact', coalesce(me.exact_count, 0),
          'matches', coalesce(me.matches, 0), 'rank', me.rnk, 'total', me.n_field,
          'percentile', case when me.n_field > 1
                             then floor(100.0 * (me.n_field - me.rnk) / (me.n_field - 1))::int
                             else null end),
        -- Frame 2 · Kampen der afgjorde det.
        jsonb_build_object('frame', 'BEST_WORST',
          'best', case when bst.match_id is null then null else
            jsonb_build_object('home', bst.home, 'away', bst.away, 'score', bst.score,
                               'guess', bst.guess, 'points', bst.pts) end,
          'worst', case when wst.match_id is null or wst.match_id = bst.match_id then null else
            jsonb_build_object('home', wst.home, 'away', wst.away, 'score', wst.score,
                               'guess', wst.guess, 'points', wst.pts) end),
        -- Frame 3 · Rating. Uden en ratingrække (provisorisk/ingen tips) står
        -- rammen med null'er, og klienten springer den over.
        jsonb_build_object('frame', 'RATING',
          'rating', rh.rating_after, 'delta', rh.delta,
          'rank', rh.rnk, 'moved', prev.rnk - rh.rnk),
        -- Frame 4 · Rundens Champion + Månedsligaen (begge globale).
        jsonb_build_object('frame', 'CHAMPION',
          'winner', ch.name, 'winner_points', ch.points, 'shared', ch.n_winners > 1,
          'month', v_month, 'month_rank', ms.rnk, 'month_total', ms.n_field,
          'month_points', ms.total_points)
      ) as arr
    from _bf_row r
    left join _bf_me me on me.user_id = r.user_id
    left join public.rating_history rh on rh.user_id = r.user_id and rh.scope = 'ALL'
      and rh.round_key = p_round_key
    left join public.rating_history prev on prev.user_id = r.user_id and prev.scope = 'ALL'
      and prev.round_key = (v_round - 7)::text
    left join lateral (select * from _bf_champ order by name limit 1) ch on true
    left join _bf_month ms  on ms.user_id  = r.user_id
    left join _bf_best  bst on bst.user_id = r.user_id
    left join _bf_worst wst on wst.user_id = r.user_id
  ),
  -- Frame 5 er BETINGET: præcis én frame uanset antal milepæle i runden
  -- (acceptkriterie 6). Rangordenen er MILESTONE_FAMILIES' egen, spejlet fra
  -- src/lib/milestones.js — samme stige som kapringen bruger.
  ms5 as (
    select distinct on (m.user_id) m.user_id, m.key, m.payload
    from public.milestones m
    where public.match_day(m.achieved_at) between v_round and v_round + 6
    order by m.user_id,
             case m.family when 'competition' then 0 when 'rating' then 1
                           when 'precision'  then 2 when 'community' then 3 else 4 end,
             m.tier desc, m.key asc
  )
  update public.stories s
  set payload = s.payload || jsonb_build_object('frames',
        case when ms5.user_id is null then f.arr
             else f.arr || jsonb_build_array(jsonb_build_object(
               'frame', 'MILESTONE', 'milestone_key', ms5.key,
               'milestone_payload', ms5.payload))
        end)
  from frames f
  left join ms5 on ms5.user_id = f.user_id
  where s.id = f.id;

  get diagnostics v_n = row_count;

  drop table if exists _bf_champ;
  drop table if exists _bf_me;
  drop table if exists _bf_tips;
  drop table if exists _bf_best;
  drop table if exists _bf_worst;
  drop table if exists _bf_month;
  drop table if exists _bf_row;
  return v_n;
end;
$fn$;

revoke execute on function public.build_round_frames(text) from public, anon, authenticated;
grant execute on function public.build_round_frames(text) to service_role;

-- ======================= 4. apply_milestone_stories() =======================
-- SKRIVEREN AF MILEPÆLE ER CRON ALENE (milepaele-v1.md §7), og dagens kort er
-- skrevet af matches-triggeren. Rækkefølgen er derfor ikke garanteret: en
-- milepæl kan blive uddelt EFTER at dagens kort er udgivet. Uden denne funktion
-- ville den milepæl aldrig nå Hjem.
--
-- Kaldes af api/send-notifications.js som service_role, umiddelbart efter
-- award_milestones(). Erstatter — lægger aldrig noget til: ét slot betyder ét
-- slot, også når kapringen kommer for sent.
--
-- 48-TIMERS-GRÆNSEN gælder her og kun her: et kort, der er ældre end det,
-- vises alligevel ikke af klienten, så at rette det ville være at rette noget
-- usynligt. Milepælen ryger så på karriereprofilen og fanges af frame 5 i den
-- kommende rundestory.
--
-- BEMÆRK — en gen-kørsel af generate_daily_stories() sletter dagens rækker og
-- dermed også en kapring. Den GENSKABES af sig selv, fordi tilknytningsdags-
-- formlen dér er ordret den samme som her. Testes i
-- sql/tests/story_engine_daily.sql; ændres den ene formel uden den anden, går
-- sene milepæle tabt ved næste resultatrettelse, og det sker tavst.
create or replace function public.apply_milestone_stories(p_max_age_hours int default 48)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_n int := 0;
  r record;
begin
  -- ---- 1. Kapring af dagens kort ----
  with fresh as (
    select distinct on (m.user_id, d.day)
      m.user_id, d.day, m.key, m.payload, m.competition_id
    from public.milestones m
    cross join lateral (
      select (select max(mm.match_day) from public.matches mm
              where mm.match_day <= public.match_day(m.achieved_at)) as day
    ) d
    where m.achieved_at > now() - make_interval(hours => p_max_age_hours)
      and d.day is not null
    order by m.user_id, d.day,
             case m.family when 'competition' then 0 when 'rating' then 1
                           when 'precision'  then 2 when 'community' then 3 else 4 end,
             m.tier desc, m.key asc
  )
  update public.stories s
  set rule = 'MILESTONE',
      priority = 110,
      competition_id = fresh.competition_id,
      payload = s.payload || jsonb_build_object(
        'milestone_key', fresh.key, 'milestone_payload', fresh.payload,
        'winner_rule', 'MILESTONE'),
      -- 120 = grundvægt 100 + nærhed 20. Størrelsesbidraget er nul for en
      -- milepæl (se _sd_scored), så tallet er det SAMME, som motoren ville have
      -- skrevet — og en gen-kørsel af generate_daily_stories() giver derfor
      -- byte-samme række som denne kapring. Et hardkodet tal to steder er
      -- prisen; alternativet var, at cron og motor scorede samme kort
      -- forskelligt, hvilket ville bryde determinismen i acceptkriterie 7.
      news_value = 120,
      headline = 'Ny milepæl',
      body = fresh.key
  from fresh
  where s.user_id = fresh.user_id
    and s.day_key = fresh.day
    and s.period = 'day'
    and s.news_value is not null
    and s.rule <> 'MILESTONE'                          -- allerede kapret ⇒ rør den ikke
    and s.created_at > now() - make_interval(hours => p_max_age_hours);

  get diagnostics v_n = row_count;

  -- ---- 2. Frame 5 i allerede genererede rundestories ----
  -- build_round_frames() bygger hele arrayet om, så en milepæl, der lander
  -- efter rundekortet, får sin frame uden at de fire andre kan drive.
  for r in
    select distinct s.round_key
    from public.stories s
    where s.period = 'round'
      and exists (
        select 1 from public.milestones m
        where m.user_id = s.user_id
          and m.achieved_at > now() - make_interval(hours => p_max_age_hours)
          and public.match_day(m.achieved_at)
              between s.round_key::date and s.round_key::date + 6
      )
  loop
    perform public.build_round_frames(r.round_key);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$fn$;

revoke execute on function public.apply_milestone_stories(int) from public, anon, authenticated;
grant execute on function public.apply_milestone_stories(int) to service_role;

-- ============================================================================
-- Verifikation
-- ============================================================================
-- 1) ÉT SLOT. Forvent 0 rækker:
-- select user_id, day_key, count(*) from public.stories
--  where period = 'day' and news_value is not null group by 1,2 having count(*) > 1;
--
-- 2) Tærsklen — andelen af kampdage med ulæst-markering. Målet er 40–60 %
--    (spec §5, backloggens A35). Over 70 % ⇒ tærsklen er for lav:
-- select round(100.0 * count(*) filter (where news_value >= 45) / count(*), 1) as pct_ulaest
--   from public.stories where period = 'day' and news_value is not null;
--
-- 3) Scorefordelingen, som A35 skal afgøres på:
-- select rule, count(*), min(news_value), round(avg(news_value), 1), max(news_value)
--   from public.stories where period = 'day' and news_value is not null
--  group by 1 order by 4 desc;
--
-- 4) Rundens sidste dag har INGEN dagskort. Forvent 0:
-- select count(*) from public.stories s
--   where s.period = 'day' and not exists (
--     select 1 from public.matches m
--     where m.round_key = public.round_key_of_date(s.day_key) and m.match_day > s.day_key);
--
-- 5) Rundestoryerne har frames. Forvent 4 eller 5:
-- select jsonb_array_length(payload -> 'frames') as n, count(*)
--   from public.stories where period = 'round' and payload ? 'frames' group by 1;
--
-- 6) Dagskort overlever en gen-kørsel af runde-motoren (den vigtigste
--    regression — se sql/tests/story_engine_daily.sql):
-- select count(*) from public.stories where period = 'day';
-- select public.generate_stories('2026-08-04');
-- select count(*) from public.stories where period = 'day';   -- uændret
