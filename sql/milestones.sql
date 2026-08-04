-- Milepæle — permanente engangs-bedrifter. Idempotent, sikker at gen-køre.
--
-- ---------------------------------------------------------------------------
-- Hvorfor tabellen findes
--
-- Indtil august 2026 VAR der ingen milepæle i koden. Karriereprofilen kaldte
-- alle `stories`-rækker med `priority < 90` for milepæle (loadCareerMilestones i
-- src/lib/data/career.js), og da Story Engine gemmer ALLE udløste kandidater
-- hver runde — ikke kun den, der vises — samlede en bruger i tre konkurrencer
-- "Kun 3 point op til føringen", "Din bedste runde hidtil" og "2 præcise
-- resultater" op hver eneste uge. Arkivet var en rundelog, ikke en minde-liste.
--
-- En milepæl er noget andet end en historie:
--   historie = hvad der skete i denne runde (flygtig, gentager sig, forsvinder)
--   milepæl  = noget du har opnået én gang og altid har opnået (permanent)
--
-- ---------------------------------------------------------------------------
-- FROSSEN SEMANTIK — læs denne, før du "retter" noget
--
-- En milepæl kan ALDRIG trækkes tilbage. `on conflict do nothing` er ikke en
-- optimering, det er reglen. recompute_ratings() er en fuld genopbygning, så en
-- rettet kamp kan sænke en brugers peak-rating under en tærskel, de allerede har
-- fået. Rækken bliver. Det er den rigtige afvejning — samme frosne semantik som
-- competition_awards (A22) og som en afsendt push — men det betyder, at tabellen
-- før eller siden rummer en række, de nuværende data ikke længere begrunder.
-- Det er et vilkår, ikke en fejl.
--
-- ---------------------------------------------------------------------------
-- Kræver: sql/story_engine_v2_day.sql (competition_match_points).

-- ======================= 1. Tabel =======================
create table if not exists public.milestones (
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- NØGLEN BÆRER TIERET ('RATING_1200', 'TIPS_500'). Det er hele idempotensen:
  -- primærnøglen (user_id, key) + `on conflict do nothing` gør en fuld
  -- gen-scanning gratis og ufarlig.
  key text not null,
  -- 'competition' | 'rating' | 'precision' | 'community'. Findes, fordi
  -- karriereprofilen grupperer efter familie — klienten skal ikke parse
  -- nøgle-præfikser for at vide, hvor en række hører hjemme.
  family text not null,
  tier int not null default 0,          -- kun til visning/sortering
  competition_id uuid references public.competitions (id) on delete set null,
  round_key text,                       -- TEXT som stories/rating_history
  payload jsonb not null default '{}'::jsonb,
  achieved_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Nøglen er (user_id, key) og IKKE (user_id, key, competition_id): hver bedrift
-- i kataloget er livstids-engangs. "Første sejr i en konkurrence" er ÉN
-- begivenhed, ikke én pr. konkurrence. competition_id er kontekst til
-- korttekst, ikke identitet.

create index if not exists milestones_user_time_idx
  on public.milestones (user_id, achieved_at desc);

alter table public.milestones enable row level security;
drop policy if exists milestones_select_own on public.milestones;
create policy milestones_select_own on public.milestones
  for select to authenticated using (user_id = auth.uid());
-- Ingen insert/update/delete-policy: award_milestones() (security definer) er
-- eneste skriver — samme model som competition_awards og stories.

grant select on public.milestones to authenticated;

-- ======================= 2. Er en konkurrence slut? =======================
-- Fire af konkurrence-milepælene kræver, at en konkurrence er FÆRDIG, og det
-- begreb fandtes ikke: `competitions` har hverken slutdato eller status.
--
-- "Alle mine kampe har resultat" er IKKE nok. full_season/team/time_range får
-- løbende nye kampe via api/_backfill.js (BACKFILLABLE_MODES), så en sådan
-- konkurrence kan se færdig ud mandag og vokse igen onsdag — og en milepæl,
-- der er uddelt, kan ikke tages tilbage. Derfor skal de også have deres SÆSONER
-- færdigspillet.
--
-- `mode_params ? 'stages'` markerer en håndafgrænset gammel konkurrence, som
-- aldrig vokser, jf. api/_backfill.js.
create or replace view public.competition_status
with (security_invoker = on) as
with cm as (
  select cm.competition_id, m.id as match_id, m.season_id,
         (m.home_score is not null and m.away_score is not null) as scored
  from public.competition_matches cm
  join public.matches m on m.id = cm.match_id
),
agg as (
  select competition_id, count(*)::int as matches,
         (count(*) filter (where scored))::int as scored_matches
  from cm group by competition_id
),
growable as (
  select c.id as competition_id,
         (c.mode in ('full_season', 'team', 'time_range')
          and not (c.mode_params ? 'stages')) as can_grow
  from public.competitions c
),
-- "Sæsonerne, den trækker fra" aflæses på konkurrencens EGNE kampe: den kan kun
-- vokse fra sæsoner, den allerede henter kampe i.
seasons_done as (
  select x.competition_id, bool_and(sd.done) as seasons_complete
  from (select distinct competition_id, season_id from cm) x
  join lateral (
    select bool_and(m.home_score is not null and m.away_score is not null) as done
    from public.matches m where m.season_id = x.season_id
  ) sd on true
  group by x.competition_id
)
select a.competition_id, a.matches, a.scored_matches, g.can_grow,
       coalesce(sd.seasons_complete, true) as seasons_complete,
       (a.matches > 0
        and a.scored_matches = a.matches
        and (not g.can_grow or coalesce(sd.seasons_complete, true))) as concluded
from agg a
join growable g on g.competition_id = a.competition_id
left join seasons_done sd on sd.competition_id = a.competition_id;

grant select on public.competition_status to authenticated, service_role;

-- ======================= 3. award_milestones() =======================
-- Fuld gen-scanning med vilje. p_user_id = null ⇒ alle brugere.
create or replace function public.award_milestones(p_user_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_n int := 0;
begin
  drop table if exists _ms_new;
  create temporary table _ms_new (
    user_id uuid, key text, family text, tier int,
    competition_id uuid, round_key text, payload jsonb
  );

  -- ================= FAMILIE: rating =================
  -- Tærskler måles mod PEAK og ikke mod nuværende rating, så en senere nedtur
  -- ikke gør en allerede opnået milepæl usand i det øjeblik, den vises.
  insert into _ms_new
  select rh.user_id, 'RATING_' || t.tier, 'rating', t.tier, null, null,
         jsonb_build_object('peak', round(rh.peak)::int)
  from (
    select user_id, max(rating_after) as peak
    from public.rating_history
    where scope = 'ALL' and (p_user_id is null or user_id = p_user_id)
    group by user_id
  ) rh
  cross join (values (1100), (1200), (1300), (1400)) t(tier)
  where rh.peak >= t.tier;

  -- Etableret: de fem provisoriske runder er gennemført.
  insert into _ms_new
  select r.user_id, 'RATING_ESTABLISHED', 'rating', 5, null, null,
         jsonb_build_object('rounds', r.rounds_played)
  from public.ratings r
  where r.scope = 'ALL' and r.rounds_played >= 5
    and (p_user_id is null or r.user_id = p_user_id);

  -- Rangliste. FELTSTØRRELSE-GUARDEN ER IKKE VALGFRI: uden den uddeles
  -- "top 3 af 3" på dag ét, og så betyder milepælen ingenting.
  insert into _ms_new
  select r.user_id, x.key, 'rating', x.tier, null, null,
         jsonb_build_object('rank', r.rnk, 'total', r.total)
  from (
    select user_id,
           rank() over (order by rating desc)::int as rnk,
           (count(*) over ())::int as total
    from public.ratings
    where scope = 'ALL' and coalesce(provisional, false) = false
  ) r
  cross join (values
    ('LEADERBOARD_NO1',   1,  1,  5),
    ('LEADERBOARD_TOP3',  3,  3,  8),
    ('LEADERBOARD_TOP10', 10, 10, 10)
  ) x(key, tier, max_rnk, min_field)
  where r.rnk <= x.max_rnk and r.total >= x.min_field
    and (p_user_id is null or r.user_id = p_user_id);

  -- ================= FAMILIE: precision =================
  insert into _ms_new
  select c.user_id, 'TIPS_' || t.tier, 'precision', t.tier, null, null,
         jsonb_build_object('tips', c.n)
  from (
    select user_id, count(*)::int as n from public.predictions
    where pred_home is not null and pred_away is not null
      and (p_user_id is null or user_id = p_user_id)
    group by user_id
  ) c
  cross join (values (100), (500), (1000)) t(tier)
  where c.n >= t.tier;

  insert into _ms_new
  select c.user_id, 'EXACT_' || t.tier, 'precision', t.tier, null, null,
         jsonb_build_object('exact', c.n)
  from (
    select pr.user_id, count(*)::int as n
    from public.predictions pr
    join public.matches m on m.id = pr.match_id
    where m.home_score is not null and m.away_score is not null
      and pr.pred_home is not null and pr.pred_away is not null
      and public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) = 3
      and (p_user_id is null or pr.user_id = p_user_id)
    group by pr.user_id
  ) c
  cross join (values (50), (250)) t(tier)
  where c.n >= t.tier;

  -- Perfekt runde. Guard `n >= 5`: en runde med én kamp er ikke en perfekt
  -- runde. Kan ikke komme fra round_standings — den kender ikke pr.-kamp-minimum.
  insert into _ms_new
  select r.user_id, x.key, 'precision', x.tier, null, r.round_key::text,
         jsonb_build_object('matches', r.n, 'points', r.pts)
  from (
    select pr.user_id, m.round_key, count(*)::int as n,
           sum(public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score))::int as pts,
           min(public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score))::int as worst
    from public.predictions pr
    join public.matches m on m.id = pr.match_id
    join public.seasons s on s.id = m.season_id
    join public.leagues l on l.id = s.league_id and l.is_official
    where m.home_score is not null and m.away_score is not null
      and pr.pred_home is not null and pr.pred_away is not null
      and (p_user_id is null or pr.user_id = p_user_id)
    group by pr.user_id, m.round_key
    having count(*) >= 5
  ) r
  cross join (values
    ('PERFECT_ROUND', 1, 1), ('PERFECT_ROUND_EXACT', 2, 3)
  ) x(key, tier, min_pts)
  where r.worst >= x.min_pts;

  -- Kampe i træk med point.
  --
  -- LÆSNING AF SPEC-LINJEN: den lød "5/10/20 eksakte resultater i træk hvor du
  -- fik point". En stime på 20 EKSAKTE er statistisk uopnåelig (eksakt-raten er
  -- ~15 %, så 0,15^20), mens 5/10/20 kampe i træk MED POINT er en rigtig
  -- bedrift, man kan jagte. Derfor tælles point-stimen. Samme vindue som
  -- STREAK_STATUS-dagsreglen (sql/story_engine_v2.sql), så de to aldrig kan
  -- modsige hinanden.
  insert into _ms_new
  select b.user_id, 'POINTS_STREAK_' || t.tier, 'precision', t.tier, null, null,
         jsonb_build_object('streak', b.len)
  from (
    with hist as (
      select pr.user_id, m.kickoff_at, m.id as match_id,
             (public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) >= 1) as hit
      from public.predictions pr
      join public.matches m on m.id = pr.match_id
      join public.seasons s on s.id = m.season_id
      join public.leagues l on l.id = s.league_id and l.is_official
      where m.home_score is not null and m.away_score is not null
        and pr.pred_home is not null and pr.pred_away is not null
        and (p_user_id is null or pr.user_id = p_user_id)
    ),
    grp as (
      select *,
        row_number() over (partition by user_id order by kickoff_at, match_id)
        - row_number() over (partition by user_id, hit order by kickoff_at, match_id) as g
      from hist
    ),
    runs as (select user_id, hit, count(*)::int as len from grp group by user_id, hit, g)
    select user_id, max(len) as len from runs where hit group by user_id
  ) b
  cross join (values (5), (10), (20)) t(tier)
  where b.len >= t.tier;

  -- Runder i træk med ALLE tips afgivet ("aldrig glemt").
  -- analytics_completion_facts definerer allerede præcist, hvilke kampe en
  -- bruger var SAT til at tippe: låsen skal være passeret, og kampen skal ligge
  -- efter brugerens joined_at. Den definition genbruges frem for at udlede en ny.
  insert into _ms_new
  select b.user_id, 'ROUNDS_COMPLETE_' || t.tier, 'precision', t.tier, null, null,
         jsonb_build_object('rounds', b.len)
  from (
    with slots as (
      -- distinct: den samme kamp kan ligge i flere konkurrencer
      select distinct user_id, round_key, match_id, predicted
      from public.analytics_completion_facts
      where (p_user_id is null or user_id = p_user_id)
    ),
    per_round as (
      select user_id, round_key, bool_and(predicted) as full_round
      from slots group by user_id, round_key
    ),
    grp as (
      select *,
        row_number() over (partition by user_id order by round_key)
        - row_number() over (partition by user_id, full_round order by round_key) as g
      from per_round
    ),
    runs as (select user_id, full_round, count(*)::int as len from grp group by user_id, full_round, g)
    select user_id, max(len) as len from runs where full_round group by user_id
  ) b
  cross join (values (10), (30), (100)) t(tier)
  where b.len >= t.tier;

  -- ================= FAMILIE: competition =================
  -- Månedens Champion (global). Kriteriet er byte-identisk med
  -- career_profile.titles.monthly og med story-regel 10 — samme spørgsmål må
  -- ikke få to svar (K3). `month` udregnes præcis som i monthly_standings
  -- (date_trunc uden zone), fordi det er DEN tabel, vi rangerer i.
  insert into _ms_new
  select w.user_id, 'MONTH_CHAMP', 'competition', 1, null, null,
         jsonb_build_object('month', w.month, 'points', w.total_points, 'shared', w.n_top > 1)
  from (
    select ms.month, ms.user_id, ms.total_points, count(*) over (partition by ms.month) as n_top
    from (
      select month, user_id, total_points,
             rank() over (partition by month
                          order by total_points desc, exact_count desc, outcome_count desc,
                                   round_wins desc, avg_goal_error asc) as rnk
      from public.monthly_standings where scope = 'ALL'
    ) ms
    join (
      -- måneden skal være færdigspillet, ellers kan kåringen nå at skifte
      select to_char(date_trunc('month', m.kickoff_at), 'YYYY-MM') as month
      from public.matches m
      join public.seasons s on s.id = m.season_id
      join public.leagues l on l.id = s.league_id and l.is_official
      group by 1
      having count(*) filter (where m.home_score is null or m.away_score is null) = 0
    ) md on md.month = ms.month
    where ms.rnk = 1
  ) w
  where (p_user_id is null or w.user_id = p_user_id);

  -- Sæsonens Champion (global), samme mønster.
  insert into _ms_new
  select w.user_id, 'SEASON_CHAMP', 'competition', 2, null, null,
         jsonb_build_object('points', w.total_points, 'shared', w.n_top > 1)
  from (
    select ss.user_id, ss.total_points, count(*) over (partition by ss.season_id) as n_top
    from (
      select season_id, user_id, total_points,
             rank() over (partition by season_id
                          order by total_points desc, exact_count desc, outcome_count desc,
                                   round_wins desc, avg_goal_error asc) as rnk
      from public.season_standings
    ) ss
    join (
      select s.id as season_id
      from public.seasons s
      join public.leagues l on l.id = s.league_id and l.is_official
      join public.matches m on m.season_id = s.id
      group by s.id
      having count(*) filter (where m.home_score is null or m.away_score is null) = 0
    ) sd on sd.season_id = ss.season_id
    where ss.rnk = 1
  ) w
  where (p_user_id is null or w.user_id = p_user_id);

  -- Sejr, podie og storsejr i en AFSLUTTET konkurrence.
  drop table if exists _ms_final;
  create temporary table _ms_final as
  select p.competition_id, p.user_id, sum(p.pts)::int as pts,
    rank() over (partition by p.competition_id
                 order by sum(p.pts) desc,
                          (count(*) filter (where p.pts = 3)) desc,
                          (count(*) filter (where p.pts = 1)) desc,
                          round(sum(p.goal_err)::numeric / count(*), 4) asc)::int as rnk
  from public.competition_match_points p
  join public.competition_status cs
    on cs.competition_id = p.competition_id and cs.concluded
  group by p.competition_id, p.user_id;

  insert into _ms_new
  select f.user_id, x.key, 'competition', x.tier, f.competition_id, null,
         jsonb_build_object('league', c.name, 'points', f.pts, 'rank', f.rnk, 'total', sz.n)
  from _ms_final f
  join public.competitions c on c.id = f.competition_id
  join (select competition_id, count(*)::int as n
        from public.competition_participants group by competition_id) sz
    on sz.competition_id = f.competition_id
  cross join (values
    ('COMP_FIRST_WIN',  1, 1, 2),   -- sejr i en konkurrence med mindst 2 deltagere
    ('COMP_WIN_BIG_8',  3, 1, 8),   -- sejr i en konkurrence med mindst 8
    ('COMP_PODIUM',     2, 3, 5)    -- podie kræver mindst 5, ellers er alle på podiet
  ) x(key, tier, max_rnk, min_players)
  where f.rnk <= x.max_rnk and sz.n >= x.min_players
    and (p_user_id is null or f.user_id = p_user_id);

  -- Comeback: vandt konkurrencen uden at have ligget nr. 1 i nogen runde før
  -- den sidste. Katalogets dyreste regel — den kræver, at hele konkurrencens
  -- rundevise stilling genopbygges, fordi rang pr. runde ikke gemmes noget sted.
  --
  -- BEMÆRK en kendt upræcished: en bruger uden tips i en given runde har ingen
  -- række dér, og indgår derfor ikke i den rundes rangering. Det kan gøre en
  -- mellemliggende førsteplads usynlig. Konsekvensen er konservativ i den
  -- forkerte retning (milepælen kan uddeles lidt for let), men aldrig at en
  -- ægte comeback-sejr overses.
  --
  -- YDELSE: rangene bygges ÉN GANG for alle afsluttede konkurrencer og lægges i
  -- en temp-tabel. Første udgave havde genopbygningen som en korreleret
  -- `not exists` pr. vinder-række, altså én fuld gennemregning af konkurrencens
  -- historik pr. kandidat. Et skaleringsforsøg på en syntetisk fuld sæson
  -- (sql/tests/story_engine_scale.sql) målte den til **726 ms af funktionens
  -- 1087** — to tredjedele af hele milepæls-beregningen lå i denne ene regel.
  drop table if exists _ms_lead;
  create temporary table _ms_lead as
  with per_round as (
    select p.competition_id, p.user_id, p.round_key,
           sum(p.pts) as rpts,
           count(*) filter (where p.pts = 3) as rex,
           count(*) filter (where p.pts = 1) as rout,
           sum(p.goal_err) as rerr, count(*) as rm
    from public.competition_match_points p
    join public.competition_status cs
      on cs.competition_id = p.competition_id and cs.concluded
    group by p.competition_id, p.user_id, p.round_key
  ),
  cum as (
    select competition_id, user_id, round_key,
           sum(rpts) over w as pts, sum(rex) over w as ex,
           sum(rout) over w as outc, sum(rerr) over w as err, sum(rm) over w as m
    from per_round
    window w as (partition by competition_id, user_id order by round_key
                 rows between unbounded preceding and current row)
  ),
  ranked as (
    select competition_id, user_id, round_key,
           rank() over (partition by competition_id, round_key
                        order by pts desc, ex desc, outc desc,
                                 round(err::numeric / m, 4) asc) as rnk,
           max(round_key) over (partition by competition_id) as last_round
    from cum
  )
  -- Alle, der har ligget nr. 1 i en runde FØR den sidste. Er man ikke i denne
  -- liste og vandt alligevel, er det per definition et comeback.
  select distinct competition_id, user_id from ranked
  where rnk = 1 and round_key < last_round;

  -- GRÆNSERNE ER IKKE VALGFRIE. Uden dem uddeles milepælen for noget, der ikke
  -- kan være sket: en konkurrence med ÉN runde har ingen "før sidste runde", så
  -- `_ms_lead` er tom, `not exists` er sandt, og alle vindere fik et comeback.
  -- Og man kan ikke komme bagfra mod ingen — reglen manglede helt den
  -- deltagergrænse, alle de øvrige konkurrence-milepæle har.
  --   ≥ 3 runder     : der skal være en historie at vende
  --   ≥ 3 deltagere  : en føring skal betyde noget
  insert into _ms_new
  select f.user_id, 'COMP_COMEBACK', 'competition', 4, f.competition_id, null,
         jsonb_build_object('league', c.name, 'points', f.pts, 'rounds', rc.n_rounds)
  from _ms_final f
  join public.competitions c on c.id = f.competition_id
  join (select competition_id, count(*)::int as n
        from public.competition_participants group by competition_id) sz
    on sz.competition_id = f.competition_id and sz.n >= 3
  join (select competition_id, count(distinct round_key)::int as n_rounds
        from public.competition_match_points group by competition_id) rc
    on rc.competition_id = f.competition_id and rc.n_rounds >= 3
  where f.rnk = 1
    and (p_user_id is null or f.user_id = p_user_id)
    and not exists (
      select 1 from _ms_lead ml
      where ml.competition_id = f.competition_id and ml.user_id = f.user_id
    );

  -- ================= FAMILIE: community =================
  insert into _ms_new
  select g.created_by, 'FIRST_LEAGUE_CREATED', 'community', 1, null, null,
         jsonb_build_object('league', g.name)
  from public.groups g
  where (p_user_id is null or g.created_by = p_user_id);

  insert into _ms_new
  select c.created_by, 'FIRST_COMPETITION_CREATED', 'community', 1, c.id, null,
         jsonb_build_object('competition', c.name)
  from public.competitions c
  where (p_user_id is null or c.created_by = p_user_id);

  -- Liga-vækst.
  --
  -- HVORFOR IKKE "5/10 venner tilmeldt via DIT link": den attribution findes
  -- ikke i skemaet. groups.invite_code er ÉN kode pr. liga og ikke pr. bruger,
  -- så koden kan ikke identificere afsenderen; hverken group_members eller
  -- competition_participants har en invited_by-kolonne; og analytics_events er
  -- erklæret lossy by design (sql/analytics_events.sql) og må aldrig bære noget,
  -- en bruger kan bestride — hvilket en permanent bedrift per definition er.
  -- Personlige invite-links er en selvstændig feature (se backloggens indbakke);
  -- indtil da tæller vi det, der ER sandt: hvor mange der kom med i en liga, du
  -- har oprettet. Det er en anden bedrift, og den hedder noget andet.
  insert into _ms_new
  select b.created_by, 'LEAGUE_GREW_' || t.tier, 'community', t.tier, null, null,
         jsonb_build_object('members', b.n)
  from (
    select g.created_by, max(x.n)::int as n
    from public.groups g
    join lateral (
      select count(*)::int as n from public.group_members gm
      where gm.group_id = g.id and gm.user_id <> g.created_by
    ) x on true
    where (p_user_id is null or g.created_by = p_user_id)
    group by g.created_by
  ) b
  cross join (values (5), (10)) t(tier)
  where b.n >= t.tier;

  -- Sæsoner deltaget i. Guard `>= 5` tips pr. sæson, så et strøtip ikke tæller.
  --
  -- TÆLLER FODBOLDSÆSONER, IKKE RÆKKER I `seasons`. Den fejl var live i to
  -- dage: `seasons` har én række pr. TURNERING pr. år, så en bruger, der
  -- tippede Superliga og Premier League i den samme sæson, fik "To sæsoner med"
  -- efter en uge. Tabellens navn beskriver dens korn, ikke begrebet.
  --
  -- Sæsonåret udledes af kampens danske kickoff frem for af `seasons.name`:
  -- navnet er leverandørens tekst ("2026/27" hos den ene, "2026/2027" hos den
  -- anden), og to leverandører er allerede i drift. Måneden er skillelinjen —
  -- en sæson løber juli→juni, så alt før juli hører til året før.
  insert into _ms_new
  select b.user_id, 'SEASONS_' || t.tier, 'community', t.tier, null, null,
         jsonb_build_object('seasons', b.n)
  from (
    select user_id, count(*)::int as n
    from (
      select pr.user_id,
             (case
                when extract(month from m.kickoff_at at time zone 'Europe/Copenhagen') >= 7
                then extract(year from m.kickoff_at at time zone 'Europe/Copenhagen')
                else extract(year from m.kickoff_at at time zone 'Europe/Copenhagen') - 1
              end)::int as season_year
      from public.predictions pr
      join public.matches m on m.id = pr.match_id
      where pr.pred_home is not null and pr.pred_away is not null
        and (p_user_id is null or pr.user_id = p_user_id)
      group by 1, 2
      having count(*) >= 5
    ) s
    group by user_id
  ) b
  cross join (values (2), (3)) t(tier)
  where b.n >= t.tier;

  -- ================= Skriv =================
  -- `distinct on (user_id, key)` fordi flere blokke kan producere samme nøgle i
  -- samme kørsel (fx to afsluttede konkurrencer, der begge giver COMP_PODIUM).
  -- Den ÆLDSTE begivenhed vinder ikke her — vi har ingen tidsstempel pr.
  -- kandidat — men rækken skrives kun én gang, og det er hele pointen.
  with ins as (
    insert into public.milestones
      (user_id, key, family, tier, competition_id, round_key, payload)
    select distinct on (user_id, key)
           user_id, key, family, tier, competition_id, round_key, payload
    from _ms_new
    -- `user_id is not null` er et sikkerhedsnet, ikke en forventning: både
    -- groups.created_by og competitions.created_by er NOT NULL med fremmednøgle,
    -- så en null kan ikke opstå i dag. Filteret står her, fordi konsekvensen er
    -- uforholdsmæssig — funktionen skriver ALLE brugeres milepæle i ét insert,
    -- så én dårlig række afbryder hele batchen for alle, og den afbrydelse sker
    -- TAVST bag matches-triggerens exception-guard. Ét filter på den fælles vej
    -- ud dækker enhver kilde-blok, også dem der tilføjes senere.
    where user_id is not null
    order by user_id, key, tier desc
    on conflict (user_id, key) do nothing
    returning 1
  )
  select count(*)::int into v_n from ins;

  drop table if exists _ms_new;
  drop table if exists _ms_final;
  drop table if exists _ms_lead;
  return v_n;
end;
$fn$;

revoke execute on function public.award_milestones(uuid) from public, anon, authenticated;
grant execute on function public.award_milestones(uuid) to service_role;

-- ============================================================================
-- Verifikation
-- ============================================================================
-- 1) Uddel og tæl. Anden kørsel skal give 0 (idempotens):
-- select public.award_milestones(null);
-- select public.award_milestones(null);   -- forvent 0
--
-- 2) De fire familier findes:
-- select family, count(*) from public.milestones group by 1 order by 1;
--
-- 3) Feltstørrelse-guarden holder. Forvent 0 rækker:
-- select 1 from public.milestones m where m.key = 'LEADERBOARD_TOP3'
--   and (select count(*) from public.ratings where scope = 'ALL'
--        and coalesce(provisional,false) = false) < 8;
--
-- 4) Ingen konkurrence-milepæl for en konkurrence, der stadig kan vokse:
-- select cs.* from public.competition_status cs
--  where cs.can_grow and not cs.seasons_complete and cs.concluded;   -- forvent 0
