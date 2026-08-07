-- Story Engine — stories-tabel, latest_story-view og generate_stories().
--
-- v2 (august 2026) — RUNDE-MOTOREN ER NU ÉN AF TO. Dagsmotoren
-- (generate_daily_stories, sql/story_engine_v2.sql) skriver i den SAMME tabel,
-- og derfor er to ting ændret her:
--   · `delete` er periode-afgrænset (`and period = 'round'`). UDEN det sletter
--     runde-motoren hele ugens dagskort ved hver eneste resultatændring — og de
--     genskabes aldrig, for dagsmotoren kører kun, når en dag BLIVER færdig.
--     Det er den farligste linje i hele v2; sql/tests/story_engine_daily.sql
--     vogter den.
--   · det dæmpede tiers kandidat-udvælgelse tæller kun runde-kort, så et
--     dagskort ikke kan gøre en ellers stille runde tavs.
-- Rækkefølge: sql/story_engine_v2_day.sql → sql/story_engine_v2.sql → DENNE FIL
-- → sql/rating_trigger_optimization.sql. _se_rp læser nu viewet
-- competition_match_points, som oprettes i den første af dem.
--
-- v1.2 (august 2026)
--
-- v1.2 (august 2026) — LOKALE KÅRINGER (B10). To nye regler læser den
-- persisterede kåring i competition_awards (A22) frem for at regne den om:
--   65 AWARD_WEEK  "Du er Ugens bedste i <konkurrence>"   (pr. færdig runde)
--   15 AWARD_MONTH "Du er Månedens bedste i <konkurrence>" (første runde i ny måned)
-- Regel 70 (ROUND_WON) er samtidig gjort tavs, når en kåring dækker det samme
-- øjeblik — ellers ville ét øjeblik have to kort, og brugerens ENE kort pr.
-- runde kunne blive den svageste af de to formuleringer.
-- Idempotent — kan køres igen når som helst (kør med "Run without RLS";
-- scriptet sætter selv RLS, jf. DOCUMENTATION.md afsnit 13).
--
-- Spec: docs/features/story-engine-v1.md. Beregnes i databasen, én gang pr.
-- runde, idempotent — samme mønster som recompute_ratings().
--
-- v1.1 (juli 2026) — dækningsgrad. Efter den første rigtige runde fik stort set
-- ingen en historie: reglerne 20/21/40/50/60 læser alle på stillingen FØR runden,
-- og den findes ikke i en konkurrences første runde; 30 kræver en ikke-provisorisk
-- rating (≥5 runder), og 10 kræver et månedsskifte. Tilbage stod kun rundens
-- vinder og ≥3 præcise. Tre svar, i den rækkefølge de virker:
--   1) TRE NYE REGLER, hvoraf to virker uden historik (22 PODIUM_ENTER,
--      45 CLOSING_IN, 55 PERSONAL_BEST).
--   2) SÆNKEDE TÆRSKLER MED DYNAMISK PRIORITET (comeback fra 2 pladser, stime fra
--      2 sejre, præcise fra 2). Princippet: **tærsklen afgør, om historien findes;
--      prioriteten afgør, om den vises.** Den svage variant får et højere
--      prioritetstal og kan derfor kun vinde, når der ikke er noget bedre — så
--      dækningen stiger uden at fortrænge de store øjeblikke.
--   3) DÆMPET TIER (prioritet ≥ 90: 90 SEASON_OPENER, 100 QUIET_ROUND), som kun
--      genereres for brugere, der ellers ville stå uden noget som helst.
--      Produktbogen kapitel 6 beder selv Story Engine om at turde sige "status
--      quo"; v1 læste det som "intet kort", v1.1 læser det som "et stille kort".
--      Frontenden renderer prioritet ≥ 90 uden guld, uden emoji og uden Del-knap,
--      så et stille kort aldrig kan forveksles med en rigtig historie.
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
--   views round_standings(round_key, scope, user_id,total_points,exact_count) og
--   monthly_standings(month, scope, user_id, total_points, exact_count).
--   Begge læses ALTID med scope = 'ALL' (den samlede stilling) — se
--   sql/tournament_scope.sql. En historie hører til ugen, ikke til én turnering.
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
--
-- VIEWET DEFINERES I sql/story_engine_v2.sql — IKKE HER.
--
-- Det stod her indtil v2, og det var en fælde: v2 gav viewet to kolonner mere
-- (`day_key`, `period`) og et `where period = 'round'`, og DENNE fil gen-køres
-- rutinemæssigt (fire gange siden juli 2026). En `create or replace view` med
-- den gamle, kortere kolonneliste kan ikke fjerne kolonner igen — Postgres
-- svarer `42P16: cannot drop columns from view` — så gen-kørslen fejlede midt i
-- filen, præcis når man fulgte den dokumenterede rækkefølge (v2 før denne).
--
-- Derfor bor definitionen ét sted: i den fil, der indfører `period`. To
-- definitioner af samme view i to filer ville i bedste fald skulle holdes i
-- sync, og i værste fald tavst rulle hinanden tilbage.

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
  v_prev_month text;
  v_prev_month_name text;
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
  -- Idempotent: fjern rundens historier og genberegn (stories.round_key er text).
  -- `period = 'round'` ER IKKE VALGFRI (v2). Dagskortene bærer samme round_key,
  -- fordi karusellen grupperer på runden — uden filteret ville hver
  -- resultatændring i en færdig runde tørre ugens dagskort væk.
  delete from public.stories where round_key = p_round_key and period = 'round';

  v_label := to_char(v_round, 'DD.MM') || ' – ' || to_char(v_round + 6, 'DD.MM');

  -- ---- point pr. konkurrence/bruger/runde (kun spillede kampe, t.o.m. denne runde) ----
  -- Ud over point og præcise hits opgøres alt, tiebreaker-stigen har brug for:
  -- korrekte udfald, målafvigelse og om runden blev vundet. Stigen er den samme
  -- som i stillingerne (sql/standings_tiebreakers.sql, src/lib/standings.js), så
  -- en historie aldrig kan påstå en placering, tabellen modsiger.
  -- `round_won` = nr. 1 i runden efter stigen uden rundesejr-trinnet; delt sejr
  -- tæller for alle, hvilket regel 70 nedenfor bruger direkte.
  --
  -- Grundlaget er viewet competition_match_points (sql/story_engine_v2_day.sql),
  -- som dagsmotoren læser fra det samme sted. Viewet BÆRER deltager-
  -- afgrænsningen, og den er ikke valgfri: `predictions` er global pr. (bruger,
  -- kamp) og ved intet om konkurrencer, så uden joinet til
  -- competition_participants tælles enhver, der har tippet samme kamp i en anden
  -- konkurrence, med her (§11 — "nr. 9 af 8" og historier om fremmede).
  -- Udtrykket stod tidligere inline netop her; det bor nu ét sted, så de to
  -- motorer ikke kan drive fra hinanden.
  drop table if exists _se_rp;
  create temporary table _se_rp as
  with scored as (
    select competition_id, user_id, round_key, pts, goal_err
    from public.competition_match_points
    where round_key <= v_round
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
  where t.round_won = 1 and t.rpts > 0
    -- Har konkurrencen tilvalgt lokale kåringer, og er runden kåret, fortæller
    -- regel 65 nedenfor det samme øjeblik med det navn, konkurrencen selv
    -- bruger ("Ugens bedste"). To kort om én sejr ville betyde, at brugerens
    -- ENE kort pr. runde kunne blive den svageste af de to formuleringer — og
    -- at milepæls-arkivet fik dubletter. Kåringen vinder, fordi den er den
    -- persisterede sandhed, boardet allerede viser.
    and not exists (
      select 1 from public.competition_awards aw
      where aw.competition_id = t.competition_id
        and aw.period_type = 'round' and aw.period_key = p_round_key
        and aw.user_id = t.user_id
    );

  -- ======== Regel 65 · Ugens bedste (lokal kåring, pr. konkurrence) ========
  -- Læser den PERSISTEREDE kåring (competition_awards, A22) frem for at regne
  -- den om. Det er ikke en genvej: kåringen er frossen ved sit eget kriterie
  -- (alle konkurrencens kampe i runden har resultat) og vises allerede på
  -- boardet, så en historie, der regnede sit eget svar, ville kunne modsige den
  -- tabel, brugeren kan slå op i. Samme regel som stigen: én kilde pr. påstand.
  --
  -- HVEM SKRIVER RÆKKEN? Klienten ved board-åbning — og siden august 2026 også
  -- notifikations-jobbet som `service_role` ved hver kørsel (B11). Det sidste er
  -- det, der gør denne regel pålidelig: uden det ville kortet afhænge af, at et
  -- menneske havde åbnet boardet, FØR runden blev genereret. Rækkefølgen er
  -- alligevel ikke garanteret, men historier gendannes ved hvert resultat i
  -- runden (delete + insert øverst), så kortet indhentes af sig selv.
  --
  -- Navnereglen (turnering-2 §3.6): lokalt hedder det "Ugens bedste" — aldrig
  -- "rundevinder", som er den globale titel.
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, aw.user_id, aw.competition_id, 'AWARD_WEEK', 65, sz.n,
    jsonb_build_object('league', c.name, 'points', aw.points, 'shared', aw.shared,
                       'others', (count(*) over (partition by aw.competition_id))::int - 1,
                       'exact', coalesce((aw.stats ->> 'exact')::int, 0)),
    '🏅 Du er ' || case when aw.shared then 'delt ' else '' end || 'Ugens bedste i ' || c.name,
    aw.points || ' point — flest af alle i ' || c.name || ' i runden ' || v_label ||
      case when not aw.shared then '.'
           when (count(*) over (partition by aw.competition_id)) > 2
             then ' (delt med ' || ((count(*) over (partition by aw.competition_id))::int - 1) || ' andre).'
           else ' (delt med 1 anden).' end
  from public.competition_awards aw
  join public.competitions c on c.id = aw.competition_id
  join _se_size sz on sz.competition_id = aw.competition_id and sz.n >= 2
  where aw.period_type = 'round' and aw.period_key = p_round_key;

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

  -- ======== Regel 10 · Månedens Champion (global, når runden lukker måneden) ========
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
        || 'Månedens Champion — ' || v_month_name,
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

  -- ======== Regel 15 · Månedens bedste (lokal kåring, pr. konkurrence) ========
  -- Kortet hører til den FØRSTE runde i en ny måned, og det er en anden regel
  -- end regel 10 ovenfor, som fyrer i den sidste runde MED kampe i måneden.
  -- Forskellen er ikke kosmetisk: `award_competition_periods()` kårer først en
  -- måned, når kalendermåneden er forbi (ellers kunne efterfyldningen lægge en
  -- udsat kamp ind i en allerede kåret måned), så rækken FINDES ikke endnu, når
  -- regel 10 fyrer. Den første runde i den nye måned er det tidligste
  -- tidspunkt, hvor kåringen både er sand og skrevet.
  --
  -- Prioritet 15 ligger mellem den globale månedstitel (10) og en overtaget
  -- førsteplads (20): en lokal månedstitel er større end alt, hvad en enkelt
  -- runde kan producere, men mindre end at være Månedens Champion.
  v_prev_month := to_char(v_round - 7, 'YYYY-MM');
  if v_prev_month <> to_char(v_round, 'YYYY-MM') then
    v_prev_month_name := months[cast(substring(v_prev_month from 6 for 2) as int)];
    insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
    select p_round_key, aw.user_id, aw.competition_id, 'AWARD_MONTH', 15, sz.n,
      jsonb_build_object('league', c.name, 'month', v_prev_month_name, 'points', aw.points,
                         'shared', aw.shared,
                         'others', (count(*) over (partition by aw.competition_id))::int - 1),
      '👑 Du er ' || case when aw.shared then 'delt ' else '' end
        || 'Månedens bedste i ' || c.name || ' — ' || v_prev_month_name,
      aw.points || ' point — flest af alle i ' || c.name || ' i ' || v_prev_month_name ||
        case when not aw.shared then '.'
             when (count(*) over (partition by aw.competition_id)) > 2
               then ' (delt med ' || ((count(*) over (partition by aw.competition_id))::int - 1) || ' andre).'
             else ' (delt med 1 anden).' end
    from public.competition_awards aw
    join public.competitions c on c.id = aw.competition_id
    join _se_size sz on sz.competition_id = aw.competition_id and sz.n >= 2
    where aw.period_type = 'month' and aw.period_key = v_prev_month;
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
  -- Kun den samlede rundechampionship (sql/tournament_scope.sql). Uden scope-filteret
  -- ville hver bruger få ét SHARP-kort pr. turnering med hver sit tal.
  where rs.round_key = v_round and rs.scope = 'ALL' and rs.exact_count >= 2;

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
    -- Kun RUNDE-kort tæller (v2). Et dagskort er ikke rundens historie, så det
    -- må ikke gøre en ellers stille runde tavs — det ville tage det dæmpede
    -- kort fra netop de brugere, v1.1 indførte tieret for.
    select 1 from public.stories s
    where s.round_key = p_round_key and s.user_id = t.user_id and s.period = 'round'
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

  -- ======== v3 · frames til rundestoryen ========
  -- Rundekortet er efter v3 en tap-through-story med 4–5 frames (point og
  -- percentil, bedste/værste tip, rating, rundens Champion, evt. milepæl).
  -- Frames er PER BRUGER og kan derfor ikke bygges i inserts ovenfor, som alle
  -- er per konkurrence. Hele bygningen bor i sql/story_engine_v3.sql, fordi den
  -- kaldes fra to steder: her, og fra apply_milestone_stories() når en milepæl
  -- lander efter at rundekortet er skrevet.
  --
  -- GUARDEN ER IKKE PYNT. Denne fil gen-køres rutinemæssigt, og
  -- migreringsrækkefølgen (v3-filen først) kan ikke håndhæves af en SQL-editor.
  -- Uden guarden ville en gen-kørsel på en database uden v3 fejle midt i
  -- funktionen — og bag matches-triggerens exception-guard ville det ske tavst,
  -- så runden slet ingen historier fik. Det er præcis fejl A9's form.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'build_round_frames'
  ) then
    perform public.build_round_frames(p_round_key);
  end if;
end;
$fn$;

grant execute on function public.generate_stories(text) to authenticated, service_role;
