-- Engangs-genberegning efter Story Engine v2 og milepælene. IKKE en migrering
-- — kør den ÉN gang, efter de fire filer er kørt:
--   1. sql/story_engine_v2_day.sql
--   2. sql/story_engine_v2.sql
--   3. sql/story_engine.sql            (gen-køres — periode-afgrænset delete)
--   4. sql/milestones.sql
--   5. sql/rating_trigger_optimization.sql
--
-- Samme rolle som sql/story_engine_backfill.sql havde for v1: motorerne kører
-- fremadrettet af sig selv via matches-triggeren, men de dage og milepæle, der
-- ligger FØR udrulningen, findes ikke, før de bliver regnet ud.
--
-- FORVENT AT DEN TAGER TID. Den kører dagsmotoren én gang pr. spillet dag i
-- hele historikken, og hver kørsel bygger konkurrencernes pointgrundlag forfra.
-- Kør den uden for en kampdag.
--
-- Idempotent: begge motorer er delete-then-insert pr. periode, og
-- award_milestones() er `on conflict do nothing`. Den kan afbrydes og køres igen.

-- INGEN psql-kommandoer i denne fil (`\timing`, `\ir`, `\set`). Migreringerne
-- køres i Supabases SQL-editor, som sender ren SQL til serveren og ikke kender
-- psql's backslash-syntaks — en `\timing on` fejler med
-- `42601: syntax error at or near "\"`. Kun filerne i sql/tests/ må bruge dem;
-- de køres udelukkende gennem psql i CI.

-- ---------- 1. Daglige historier for hver færdigspillet dag ----------
do $$
declare
  d date;
  n int := 0;
begin
  for d in
    select distinct match_day
    from public.matches
    where match_day is not null
      and home_score is not null and away_score is not null
    order by 1
  loop
    -- Kun dage, hvor ALT er spillet. En dag med en afbrudt kamp springes over
    -- her og fanges senere af generate_stories_catchup() fra cron-jobbet.
    if public.match_day_complete(d) then
      perform public.generate_daily_stories(d);
      n := n + 1;
    end if;
  end loop;
  raise notice 'Dagshistorier genereret for % dage', n;
end $$;

-- ---------- 2. Milepæle for hele historikken ----------
-- Ét kald, ikke ét pr. bruger: funktionen scanner alle brugere i forvejen, og
-- en fuld scanning er billigere end N scanninger med et filter.
do $$
declare n int;
begin
  n := public.award_milestones(null);
  raise notice 'Milepæle uddelt: %', n;
end $$;

-- ============================================================================
-- Verifikation
-- ============================================================================
-- 1) Begge perioder findes:
-- select period, count(*) from public.stories group by 1;
--
-- 2) Loftet holdt hele vejen. Forvent max <= 2:
-- select max(cnt) from (select user_id, day_key, count(*) cnt
--   from public.stories where period = 'day' group by 1,2) x;
--
-- 3) Ingen bruger fik to kort fra samme regel samme dag. Forvent 0 rækker:
-- select user_id, day_key, rule, count(*) from public.stories
--  where period = 'day' group by 1,2,3 having count(*) > 1;
--
-- 4) Milepælene fordeler sig på de fire familier:
-- select family, count(*) from public.milestones group by 1 order by 1;
--
-- 5) Anden kørsel af milepælene uddeler intet nyt:
-- select public.award_milestones(null);   -- forvent 0
--
-- 6) Karriereprofilen er ikke længere en rundelog — sammenlign antallet af
--    milepæle med, hvad det gamle story-arkiv ville have vist:
-- select (select count(*) from public.milestones)                        as milepaele,
--        (select count(*) from public.stories where priority < 90)       as gamle_arkiv;
