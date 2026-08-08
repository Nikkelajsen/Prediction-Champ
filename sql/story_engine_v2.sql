-- Story Engine v2, trin 2 af 2 — DAGLIGE HISTORIER.
--
-- KØR sql/story_engine_v2_day.sql FØRST (match_day, match_day_complete,
-- round_key_of_date, competition_match_points), og GEN-KØR BAGEFTER
-- sql/story_engine.sql (generate_stories er ændret til at slette periode-
-- afgrænset) og sql/rating_trigger_optimization.sql (triggeren samler nu dage).
-- Idempotent.
--
-- ---------------------------------------------------------------------------
-- Hvad v2 tilføjer
--
-- v1 talte én gang om ugen: generate_stories() kørte, når rundens sidste
-- resultat var inde, og brugeren mødte ét kort. Mellem to mandage skete der
-- ingenting.
--
-- v2 lægger et DAG-lag under runde-laget. Når dagens sidste kamp er
-- færdigspillet, får hver bruger op til TO kort om dagen. Kortene akkumulerer
-- gennem runden i en vandret karrusel på Hjem (nyeste dag først), og på rundens
-- sidste dag lægger v1-motorens konkluderende kort sig øverst. Ny runde ⇒ nyt
-- round_key ⇒ karrusellen er tom af sig selv.
--
-- ---------------------------------------------------------------------------
-- TYPER — tre nøgletyper i én tabel. Bland dem ikke.
--
--   date : matches.round_key, matches.match_day, round_standings.round_key,
--          stories.day_key
--   text : stories.round_key, rating_history.round_key,
--          competition_awards.period_key
--
-- Postgres har ingen `date = text`-operator, så én blandet sammenligning fejler
-- HELE funktionen — og bag matches-triggerens exception-guard sker det TAVST.
-- En tom karrusel kan ikke skelnes fra en stille dag. Derfor påstår
-- sql/tests/story_engine_daily.sql et IKKE-NUL rækkeantal: en tavs fejl skal
-- være rød i CI, ikke grøn.
--
-- day_key er bevidst `date` og ikke `text`. At stories.round_key er text er den
-- dokumenterede historiske fejl (DOCUMENTATION §17); den fordobles ikke.

-- ======================= 1. Skema: periode + dag =======================
alter table public.stories
  add column if not exists period  text not null default 'round',
  add column if not exists day_key date;

-- `default 'round'` udfylder eksisterende rækker ved ADD COLUMN (PG11+, ingen
-- omskrivning). Defensivt for en delvist kørt migrering:
update public.stories set period = 'round' where period is null or period = '';

alter table public.stories drop constraint if exists stories_period_check;
alter table public.stories add constraint stories_period_check
  check (period in ('round', 'day'));

-- day_key og period er ÉN oplysning skrevet to steder. Constrainten binder dem
-- sammen, så ingen kan skrive en dag-historie uden dag — eller omvendt.
alter table public.stories drop constraint if exists stories_day_key_shape;
alter table public.stories add constraint stories_day_key_shape
  check ((period = 'day') = (day_key is not null));

-- ---- Unikhed pr. periode ----
-- Den gamle constraint FORBØD daglige kort: DAY_RESULT tirsdag og DAY_RESULT
-- onsdag deler round_key, bruger, regel og konkurrence. Den erstattes af to
-- partielle indexes — ét pr. periode — frem for at blive udvidet med day_key,
-- for en udvidelse ville tavst slukke sikkerhedsnettet for RUNDE-kortene (hvor
-- day_key er null, og null'er er indbyrdes forskellige).
--
-- PRE-FLIGHT — skal give 0 rækker, ellers fejler index-oprettelsen nedenfor:
--   select round_key, user_id, rule, competition_id, count(*)
--     from public.stories group by 1,2,3,4 having count(*) > 1;
alter table public.stories
  drop constraint if exists stories_round_key_user_id_rule_competition_id_key;

-- `nulls not distinct` (PG15+; produktionen kører 17.6) lukker samtidig et hul,
-- den gamle constraint havde: en global regel (competition_id null) kunne
-- indsættes to gange, fordi NULL aldrig er lig NULL. Det skete ikke i praksis,
-- fordi generate_stories sletter før den indsætter — men sikkerhedsnettet var
-- reelt slukket netop for de regler, der ikke hører til en konkurrence.
create unique index if not exists stories_round_uniq
  on public.stories (round_key, user_id, rule, competition_id)
  nulls not distinct
  where period = 'round';

create unique index if not exists stories_day_uniq
  on public.stories (day_key, user_id, rule, competition_id)
  nulls not distinct
  where period = 'day';

-- Karusellens opslag: alle kort i den aktuelle runde for én bruger.
-- stories_user_round_idx (user_id, round_key) bliver et præfiks af denne og
-- koster derfor kun skrivetid.
create index if not exists stories_user_round_day_idx
  on public.stories (user_id, round_key, day_key desc, priority);
drop index if exists public.stories_user_round_idx;

-- ======================= 2. latest_story: kun runde-kort =======================
-- Viewet lovede "præcis én historie pr. bruger pr. runde", og det løfte skal
-- holde, nu hvor tabellen også rummer dagskort. Med period-filteret er
-- ændringen bagudkompatibel: Hjem-kortet og dets tests virker uændret, så SQL'en
-- kan køres FØR frontend-merge.
-- DROP FØRST, og det er ikke pynt: `create or replace view` kan kun FØJE
-- kolonner til enden, aldrig indsætte i midten. Uden droppet fejler filen med
-- "cannot change name of view column "user_id" to "day_key"". Samme fælde er
-- dokumenteret i sql/analytics_dashboard.sql.
--
-- KOLONNEREKKEFØLGEN ER BINDENDE: day_key og period står SIDST, så en senere
-- `create or replace` stadig kan udvide viewet uden at skulle droppe det.
drop view if exists public.latest_story;

create view public.latest_story with (security_invoker = on) as
select distinct on (user_id, round_key)
  id, round_key, user_id, competition_id, rule, priority, league_size,
  payload, headline, body, created_at, dismissed_at,
  day_key, period
from public.stories
where period = 'round'
order by user_id, round_key, priority asc, league_size desc nulls last, competition_id asc nulls last;

grant select on public.latest_story to authenticated;

-- ======================= 3. generate_daily_stories() =======================
-- PRIORITETSBÅND 110–189 (180+ reserveret til et dæmpet dagstier, hvis det
-- nogensinde bliver nødvendigt). Båndet er valgt frem for en parallel
-- 10–100-stige af tre grunde, i vigtighedsrækkefølge:
--
--   1) src/lib/data/career.js filtrerer milepæle på `priority < 90`. Med båndet
--      udelukkes dagskort AUTOMATISK fra karriereprofilen. En parallel stige
--      ville have oversvømmet minde-arkivet med "Dagens facit: 4 point" ved
--      første udrulning — præcis den fejl, v2 er sat i verden for at rette.
--   2) En forespørgsel, der glemmer `period`-filteret, men sorterer på
--      `priority asc`, sætter stadig runde-kort først. Sikker degradering.
--   3) isQuiet() (>= 90) beholder sin nuværende betydning for sin eneste
--      forbruger, latest_story, som nu er runde-only.
create or replace function public.generate_daily_stories(p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- TYPER: p_day, match_day, round_key, stories.day_key = date.
  --        stories.round_key = TEXT. v_round_text findes udelukkende for at
  --        gøre den ene nødvendige konvertering synlig ét sted.
  v_round      date := public.round_key_of_date(p_day);
  v_round_text text := v_round::text;
  v_daylabel   text := to_char(p_day, 'DD.MM');
  v_max_cards  int  := 2;   -- spec'ens loft
begin
  -- Idempotens: KUN dagens dag-kort. `period = 'day'` er ikke pynt — uden det
  -- ville en gen-kørsel slette rundens afsluttende kort. Symmetrisk sletter
  -- generate_stories() kun `period = 'round'`.
  delete from public.stories where period = 'day' and day_key = p_day;

  -- ---------- fakta ----------
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

  -- Kumulativ stilling EFTER og FØR dagen, med HELE tiebreaker-stigen (point →
  -- præcise → udfald → målafvigelse) — identisk med sql/tournament_scope.sql,
  -- src/lib/standings.js og generate_stories. Ingen parallel stige: to steder i
  -- produktet må ikke svare forskelligt på samme spørgsmål (K3).
  drop table if exists _sd_after;
  create temporary table _sd_after as
  select competition_id, user_id, sum(pts)::int as pts,
    rank() over (partition by competition_id
                 order by sum(pts) desc,
                          (count(*) filter (where pts = 3)) desc,
                          (count(*) filter (where pts = 1)) desc,
                          round(sum(goal_err)::numeric / count(*), 4) asc)::int as rnk
  from _sd_pts group by competition_id, user_id;

  drop table if exists _sd_before;
  create temporary table _sd_before as
  select competition_id, user_id, sum(pts)::int as pts,
    rank() over (partition by competition_id
                 order by sum(pts) desc,
                          (count(*) filter (where pts = 3)) desc,
                          (count(*) filter (where pts = 1)) desc,
                          round(sum(goal_err)::numeric / count(*), 4) asc)::int as rnk
  from _sd_pts where match_day < p_day group by competition_id, user_id;

  drop table if exists _sd_cand;
  create temporary table _sd_cand (
    user_id uuid, competition_id uuid, rule text, priority int,
    league_size int, payload jsonb, headline text, body text
  );

  -- ======== 110 · Dagens facit ========
  -- Ankeret. Udløses, når du har haft mindst ét scoret tip i dag, og optager
  -- derfor reelt altid plads 1 — "max 2" læses i praksis som *facit + dagens
  -- højdepunkt*, hvilket er hensigten.
  --
  -- TONEREGLEN ("driller, ydmyger aldrig"): placeringen nævnes KUN i den
  -- øverste halvdel af tabellen. Nederst står afstanden op til toppen og en
  -- fremadrettet slutning — aldrig "du er nr. 9 af 10".
  insert into _sd_cand
  select t.user_id, t.competition_id, 'DAY_RESULT', 110, sz.n,
    jsonb_build_object('points', t.pts, 'matches', t.matches, 'exact', t.exact_count,
                       'rank', a.rnk, 'total', sz.n, 'moved', coalesce(b.rnk - a.rnk, 0),
                       'gap', top.pts - a.pts, 'league', c.name),
    '📋 Dagens facit: ' || t.pts || ' point',
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

  -- ======== 120 · Kontrarian ========
  -- Præcis ÉN deltager ramte udfaldet — blandt mindst fire, der tippede kampen.
  -- Tærsklen er hele reglen: i en 3-mands konkurrence er "den eneste" støj.
  insert into _sd_cand
  select w.user_id, w.competition_id, 'CONTRARIAN', 120, sz.n,
    jsonb_build_object('team', w.pick, 'home', w.home, 'away', w.away,
                       'score', w.hs || '-' || w.away_s, 'others', w.n_pred - 1,
                       'points', w.pts, 'draw', w.is_draw, 'league', c.name),
    case when w.is_draw
         then '🧠 Du var den eneste, der troede på uafgjort i ' || w.home || '–' || w.away
         else '🧠 Du var den eneste, der troede på ' || w.pick end,
    'I ' || c.name || ' havde ' || (w.n_pred - 1) ||
      case when w.n_pred - 1 = 1 then ' anden' else ' andre' end ||
      ' tippet imod. Det endte ' || w.home || ' ' || w.hs || '-' || w.away_s || ' ' || w.away ||
      ' — ' || w.pts || ' point til dig.'
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
           -- vi allerede ved der kun er én af — n_pred blev 1 og tærsklen
           -- `>= 4` kunne aldrig opfyldes. Reglen udløste dermed aldrig.
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
  where w.n_pred >= 4;

  -- ======== 125 · Kollektiv fiasko ========
  -- `distinct on` er bærende: uden det giver en dårlig dag fire ens kort pr.
  -- bruger, som fylder hele max-2-loftet med dubletter.
  insert into _sd_cand
  select distinct on (p.competition_id, p.user_id)
    p.user_id, p.competition_id, 'COLLECTIVE_MISS', 125, sz.n,
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

  -- ======== 130 · Dagens højeste ========
  -- Vinder-sættet skal være MINDRE end feltet — ellers kåres alle på en dag,
  -- hvor samtlige deltagere fik det samme.
  insert into _sd_cand
  select w.user_id, w.competition_id, 'DAY_TOP', 130, sz.n,
    jsonb_build_object('points', w.pts, 'exact', w.exact_count,
                       'shared', w.n_top > 1, 'others', w.n_top - 1, 'league', c.name),
    '🔝 Du fik dagens højeste i ' || c.name,
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
  where w.pts > 0 and w.n_top < w.n_played;

  -- ======== 140 · Stime-status (global) ========
  -- Katalogets DYRE regel: fuld historik-scanning med to vinduesfunktioner.
  -- Beregnes derfor ÉN gang globalt (competition_id null) og ikke pr.
  -- konkurrence. Er generate_daily_stories nogensinde for langsom, er det den
  -- her, der ryger først.
  --
  -- Den fyrer KUN, når stimen blev forlænget i dag eller brudt i dag. Uden den
  -- betingelse ville den udløses hver eneste dag, stimen lever.
  insert into _sd_cand
  select s.user_id, null, 'STREAK_STATUS', 140, null,
    jsonb_build_object('n', s.len, 'alive', s.alive),
    case when s.alive then '🔥 ' || s.len || ' kampe i træk med point'
         else '💤 Din stime stoppede ved ' || s.len end,
    case when s.alive
         then 'Du har fået point i ' || s.len || ' kampe i træk. Stimen lever efter den ' || v_daylabel || '.'
         else 'Efter ' || s.len || ' kampe i træk med point brød stimen den ' || v_daylabel || '. En ny begynder i morgen.'
    end
  from (
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
    where hit and len >= 5 and ended_day = p_day
  ) s;

  -- ======== 150 · Duel ========
  -- `is distinct from` på afstanden er HELE reglen. Uden den fyrer duellen hver
  -- eneste dag med identisk tekst for alle i den øverste halvdel.
  -- Nærmeste rival OVER dig; fører du, er det den nærmeste under.
  insert into _sd_cand
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
    -- ikke sket noget i dag, og så er der ingen historie.
    -- prev_gap = null (en af de to havde ingen point før i dag) tæller som
    -- "ændret" — det er netop dagen, duellen opstod.
    select p.*,
           case when p.is_above then br.pts - bu.pts else bu.pts - br.pts end as prev_gap
    from pick p
    left join _sd_before bu on bu.competition_id = p.competition_id and bu.user_id = p.user_id
    left join _sd_before br on br.competition_id = p.competition_id and br.user_id = p.rival_id
  )
  select d.user_id, d.competition_id, 'DUEL', 150, sz.n,
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

  -- ======== 160 · Så tæt på ========
  -- goal_err = 1 er ~⅓ af alle tips, så ét nærmiss er ikke en historie. To er.
  insert into _sd_cand
  select t.user_id, t.competition_id, 'SO_CLOSE', 160, sz.n,
    jsonb_build_object('n', t.near_misses, 'league', c.name),
    '😤 Ét mål fra ' || t.near_misses || ' eksakte',
    t.near_misses || ' af dine tips i ' || c.name || ' den ' || v_daylabel ||
      ' ramte målscoren på ét mål nær.'
  from _sd_today t
  join _sd_size sz on sz.competition_id = t.competition_id
  join public.competitions c on c.id = t.competition_id
  where t.near_misses >= 2;

  -- ---------- loftet ----------
  -- TO snit, og rækkefølgen betyder noget:
  --   1) højst ÉT kort pr. regel pr. bruger — ellers ville en bruger med tre
  --      konkurrencer få to DAY_RESULT-kort og intet andet, og karusellen
  --      mistede sin variation. Vinderen er den største liga.
  --   2) derefter højst v_max_cards kort i alt.
  -- Tiebreaket er det samme som latest_story-viewets, så to kandidater fra samme
  -- regel i to ligaer altid vælges deterministisk.
  insert into public.stories
    (round_key, day_key, period, user_id, competition_id, rule, priority,
     league_size, payload, headline, body)
  select v_round_text, p_day, 'day', c.user_id, c.competition_id, c.rule,
         c.priority, c.league_size,
         c.payload || jsonb_build_object('day', v_daylabel, 'day_key', p_day),
         c.headline, c.body
  from (
    select *, row_number() over (
      partition by user_id
      order by priority asc, league_size desc nulls last, competition_id asc nulls last
    ) as rn
    from (
      select distinct on (user_id, rule) *
      from _sd_cand
      order by user_id, rule, league_size desc nulls last, competition_id asc nulls last
    ) one_per_rule
  ) c
  where c.rn <= v_max_cards;

  drop table if exists _sd_pts;
  drop table if exists _sd_size;
  drop table if exists _sd_today;
  drop table if exists _sd_after;
  drop table if exists _sd_before;
  drop table if exists _sd_cand;
end;
$fn$;

revoke execute on function public.generate_daily_stories(date) from public, anon, authenticated;
grant execute on function public.generate_daily_stories(date) to service_role;

-- ======================= 4. Bagstopper =======================
-- To huller kan matches-triggeren PER KONSTRUKTION ikke se, fordi der ikke
-- skrives noget til matches, når de opstår:
--   1) en dag, hvis sidste kamp aldrig får et resultat (afbrudt/annulleret),
--      blokerer dagen for evigt (jf. den globale afgrænsning i match_day_complete),
--   2) en runde med en udsat kamp uden ny dato bliver aldrig komplet — det hul
--      findes allerede i v1 i dag.
--
-- Kaldes af api/send-notifications.js som service_role ved hver kørsel — samme
-- mønster som B11's award_competition_periods(). Begge motorer er
-- delete-then-insert pr. periode, så kaldet er gratis at gentage.
create or replace function public.generate_stories_catchup(p_grace int default 2)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_today date := public.match_day(now());
  v_n int := 0;
  d date;
  r date;
begin
  -- Dage med spillede kampe og uden ét eneste dag-kort.
  --
  -- GRACE-VINDUET GÆLDER IKKE LÆNGERE DAGENE (august 2026). Indtil da så løkken
  -- kun på `match_day < v_today - p_grace`, altså dage ældre end to døgn, og det
  -- var for langsomt: 7. august 2026 blev dagens kort aldrig skrevet af
  -- triggeren, og bagstopperen ville først have taget dagen den 9. Imens stod
  -- rundestoryen på Hjem med en påstand, stillingen modsagde — dagskortet er
  -- dét, der afløser den, så et tabt dagskort er ikke bare et manglende kort.
  --
  -- Dagen er sin egen afgrænsning: `match_day_complete` inde i
  -- generate_daily_stories kræver, at ALLE dagens kampe har resultat, så en dag,
  -- der stadig spilles, kan pr. konstruktion ikke få et kort for tidligt. Der er
  -- derfor intet at beskytte med en forsinkelse. Runde-løkken nedenfor beholder
  -- sit vindue: en runde må ikke få sit afsluttende kort, mens den stadig kan få
  -- flere resultater, og dét er en anden slags påstand.
  --
  -- Loftet er ikke pynt: køres bagstopperen første gang mod en database med
  -- huller langt tilbage, må én kørsel ikke generere hundredvis af dage. De
  -- ældste tages først (`order by 1`), så efterslæbet afvikles i takt.
  --
  -- DE TO SIDSTE BETINGELSER GØR LØKKEN SELVAFSLUTTENDE, og uden dem ville
  -- fjernelsen af grace-vinduet være en fejl. Der findes nemlig dage, som ALDRIG
  -- kan få et kort, og som derfor ville blive forsøgt igen ved hver eneste
  -- kørsel — 48-96 gange i døgnet, for evigt, og de ville æde loftet, så de
  -- rigtige huller aldrig kom til:
  --   · rundens SIDSTE kampdag udgiver kun rundekortet (generate_daily_stories
  --     returnerer straks). Betingelsen her er den nøjagtige negation af den
  --     udgang, så de dage aldrig tilbydes.
  --   · en dag, hvor ingen af kampene indgår i en konkurrence, har intet at lave
  --     et kort ud af — appen synkroniserer syv turneringer, men konkurrencerne
  --     dækker ikke dem alle.
  for d in
    select m.match_day
    from public.matches m
    where m.home_score is not null and m.away_score is not null
      and not exists (select 1 from public.stories s
                      where s.period = 'day' and s.day_key = m.match_day)
      and exists (select 1 from public.matches m2
                  where m2.round_key = public.round_key_of_date(m.match_day)
                    and m2.match_day > m.match_day)
      and exists (select 1 from public.competition_matches cm
                  join public.matches m3 on m3.id = cm.match_id
                  where m3.match_day = m.match_day)
    group by m.match_day
    order by 1
    limit 20
  loop
    perform public.generate_daily_stories(d);
    v_n := v_n + 1;
  end loop;

  -- Runder, hvis vindue er lukket (tirsdag + 7 dage) og som mangler
  -- afslutningskortet. round_key er date her og text i stories — derfor ::text.
  for r in
    select distinct m.round_key
    from public.matches m
    where m.round_key < v_today - 7 - p_grace
      and m.home_score is not null and m.away_score is not null
      and not exists (select 1 from public.stories s
                      where s.period = 'round' and s.round_key = m.round_key::text)
    order by 1
  loop
    perform public.generate_stories(r::text);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$fn$;

revoke execute on function public.generate_stories_catchup(int) from public, anon, authenticated;
grant execute on function public.generate_stories_catchup(int) to service_role;

-- ============================================================================
-- Verifikation
-- ============================================================================
-- 1) Begge perioder findes efter backfill:
-- select period, count(*) from public.stories group by 1;
--
-- 2) Loftet holder. Forvent max <= 2:
-- select max(cnt) from (select user_id, day_key, count(*) cnt
--   from public.stories where period = 'day' group by 1,2) x;
--
-- 3) Ingen bruger har to kort fra samme regel samme dag. Forvent 0 rækker:
-- select user_id, day_key, rule, count(*) from public.stories
--  where period = 'day' group by 1,2,3 having count(*) > 1;
--
-- 4) Dagskort overlever en gen-kørsel af runde-motoren (den vigtigste
--    regression — se sql/tests/story_engine_daily.sql):
-- select count(*) from public.stories where period = 'day';
-- select public.generate_stories('2026-08-04');
-- select count(*) from public.stories where period = 'day';   -- uændret
