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
--     Møder deduplikeres pr. runde/kamp på tværs af delte konkurrencer
--     (rettelse 30. juli 2026 — se kommentaren ved h2h-blokken nedenfor).
--   - records: bedste rating nogensinde, bedste runde (flest point i én runde),
--     bedste rundeplacering (kun hvis ikke allerede nr. 1 — redundant med
--     titles.round_wins ellers), længste stime af rundesejre i træk.
--     Genbruger samme rank()-stige som round_wins.
--     OMFANG (tydeliggjort 30. juli 2026): records er GLOBALT — rating er
--     scope='ALL' (samme tal som Rating-fanen), og rundeplacering/stime måles i
--     round_standings, altså Championships rundeliga, hvor ALLE brugere er med.
--     Det er IKKE en opgørelse pr. brugerens egne konkurrencer.
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
--   seasons(id, league_id, name, start_date),
--   view monthly_standings(month, scope, user_id, total_points, matches, exact_count),
--   view round_standings(round_key, scope, user_id, matches, total_points, exact_count, avg_goal_error),
--     — scope: 'ALL' = alle officielle turneringer samlet, ellers league_id. Denne
--       funktion læser KUN 'ALL'; per-turnering-titler hører til i by_tournament.
--   view season_standings(season_id, user_id, total_points, exact_count, outcome_count, round_wins, avg_goal_error),
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
          -- Kun den SAMLEDE rundeliga. round_standings har siden
          -- sql/tournament_scope.sql også en række pr. turnering, og uden dette
          -- filter ville én rundesejr tælle to gange (samlet + i sin turnering).
          -- Per-turnering-titler hører til i titles.by_tournament, ikke her.
          where rs.scope = 'ALL'
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
        -- Kun den samlede rundeliga (sql/tournament_scope.sql). Uden filteret
        -- ville feltstørrelsen tælle hver spiller én gang pr. turnering, og
        -- "4. plads af 31" blive til "af 62".
        where rs.scope = 'ALL'
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
$fn$;

grant execute on function public.career_profile(uuid) to authenticated, service_role;
