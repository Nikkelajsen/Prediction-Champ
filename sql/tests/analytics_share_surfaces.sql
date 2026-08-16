-- Test af delingsfladerne i `admin_analytics_engagement` og af, at
-- milepæls-delinger holdes ude af `admin_analytics_stories` (B37).
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR DEN FINDES. Opdelingen er en `case`-stige over `metadata->>'from'`,
-- og hver eneste af dens fejlmåder er TAVS: en flade, der havner i den forkerte
-- spand, giver ikke en fejl, men et forkert tal — og et forkert tal i et panel,
-- ingen kan efterprøve, er værre end intet panel. Det er samme fejlklasse som
-- `G84`s og `analytics_retention`s: kode, der ser rigtig ud, og som ville være
-- tavs, hvad enten den virkede eller ej.
--
-- HVAD DEN BEVISER
--   1. De tre `story_shared`-flader skilles ad på `metadata.from`:
--      'day_card' → dagskort, 'milestone' → milepæl, 'frame:ROUND_SUM' → rundekort.
--   2. **En række UDEN `from` er et rundekort.** Feltet kom til med v3's
--      frames, så de historiske rækker har det ikke — havner de i en
--      'ukendt'-spand eller falder de ud, forsvinder produktets ældste
--      delingsflade fra opgørelsen.
--   3. `standings_shared` tælles som sin egen flade og blandes ikke ind i
--      historie-tallene (I22's begrundelse for et selvstændigt navn).
--   4. `users` er DISTINKTE brugere pr. flade — to delinger fra samme bruger
--      er to delinger, men én bruger.
--   5. **Et tomt vindue giver `{}` og ikke `null`.** Klienten skelner "målt til
--      nul" fra "RPC'en er ikke gen-kørt" på præcis den forskel, så en
--      `null` her ville få panelet til at melde umålt for evigt.
--   6. Milepæls-delinger tælles IKKE med i regeltabellens `shared`.
--      `MONTH_CHAMP` er bevidst BÅDE en story-regel og en milepælsnøgle
--      (se src/lib/milestones.js), så uden filteret lander karriereprofilens
--      delinger på motorens regelrække.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d deltest -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d deltest -v ON_ERROR_STOP=1 -b -f sql/tests/analytics_share_surfaces.sql

\set ON_ERROR_STOP on
\timing off

-- #67 FØRST, og det er ikke pynt: `sql/schema.sql` er et øjebliksbillede fra
-- før den migrering blev kørt, så `standings_shared` er endnu ikke et lovligt
-- navn i dumpets check-constraint. Uden denne linje fejler testens egen
-- opsætning med 23514 — hvilket i sig selv er beviset for, at rækkefølgen
-- gælder i produktionen på samme måde.
\ir ../analytics_standings_share.sql
\ir ../analytics_dashboard.sql

-- ---------------------------------------------------------------------------
-- Opsætning: én admin (RPC'erne er gated) og én almindelig bruger
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, created_at) values
  ('b3700000-0000-4000-8000-00000000000a', 'admin@test.local', now()),
  ('b3700000-0000-4000-8000-00000000000b', 'bruger@test.local', now());
insert into public.profiles (id, display_name, is_admin) values
  ('b3700000-0000-4000-8000-00000000000a', 'Admin', true),
  ('b3700000-0000-4000-8000-00000000000b', 'Bruger', false);

-- Kør som admin resten af filen. RPC'erne er `security definer` med en
-- is_admin-gate, så uden dette svarer de 'forbidden'.
select set_config('test.uid', 'b3700000-0000-4000-8000-00000000000a', false);

-- ===========================================================================
-- 1. Tomt vindue: `{}` og ikke `null`
-- ===========================================================================
do $$
declare v jsonb;
begin
  v := public.admin_analytics_engagement(30) -> 'shares';
  if v is null then
    raise exception 'shares mangler helt — klienten ville melde "ikke målt endnu" for evigt';
  end if;
  if v <> '{}'::jsonb then
    raise exception 'tomt vindue gav % og ikke {}', v;
  end if;
  raise notice 'OK 1: tomt vindue giver {} — målt til nul, ikke umålt';
end $$;

-- ===========================================================================
-- 2. Én række pr. flade, plus de to former, der let forsvinder
-- ===========================================================================
insert into public.analytics_events (event_name, user_id, metadata) values
  -- Rundekortet, nye rækker: ét felt pr. deling.
  ('story_shared', 'b3700000-0000-4000-8000-00000000000b', '{"rule": "CHAMPION", "from": "frame:ROUND_SUM"}'),
  ('story_shared', 'b3700000-0000-4000-8000-00000000000b', '{"rule": "CHAMPION", "from": "frame:RATING"}'),
  -- Rundekortet, historisk: ingen `from` overhovedet.
  ('story_shared', 'b3700000-0000-4000-8000-00000000000a', '{"rule": "CHAMPION"}'),
  -- Dagskortet (I25).
  ('story_shared', 'b3700000-0000-4000-8000-00000000000b', '{"rule": "DAY_TOP", "from": "day_card"}'),
  -- Milepælen: nøglen står i `rule`, og den kolliderer bevidst med en regel.
  ('story_shared', 'b3700000-0000-4000-8000-00000000000b', '{"rule": "MONTH_CHAMP", "from": "milestone"}'),
  -- Stillingen (I22): eget navn, ingen `from`.
  ('standings_shared', 'b3700000-0000-4000-8000-00000000000b', '{"rows": 8}');

do $$
declare
  v jsonb;
  fejl text := '';
begin
  v := public.admin_analytics_engagement(30) -> 'shares';

  -- 2 frames + 1 historisk uden `from` = 3 delinger, 2 brugere.
  if (v #>> '{round,count}')::int is distinct from 3 then
    fejl := fejl || format('rundekort count=%s (forventet 3); ', v #>> '{round,count}');
  end if;
  if (v #>> '{round,users}')::int is distinct from 2 then
    fejl := fejl || format('rundekort users=%s (forventet 2); ', v #>> '{round,users}');
  end if;
  if (v #>> '{day_card,count}')::int is distinct from 1 then
    fejl := fejl || format('dagskort count=%s (forventet 1); ', v #>> '{day_card,count}');
  end if;
  if (v #>> '{milestone,count}')::int is distinct from 1 then
    fejl := fejl || format('milepæl count=%s (forventet 1); ', v #>> '{milestone,count}');
  end if;
  if (v #>> '{standings,count}')::int is distinct from 1 then
    fejl := fejl || format('stilling count=%s (forventet 1); ', v #>> '{standings,count}');
  end if;

  if fejl <> '' then
    raise exception 'delingsfladerne tælles forkert: %', fejl;
  end if;
  raise notice 'OK 2: fire flader, og en række uden `from` er et rundekort';
end $$;

-- ===========================================================================
-- 3. Ingen anden hændelse kan smitte af på tallene
-- ===========================================================================
-- Delingsspanden må kun se de to navne. Et `story_viewed` med samme metadata
-- ville ellers lande i 'round' — den `else`-gren, der fanger de historiske
-- rækker, fanger alt, hvis `where` ikke afgrænser.
insert into public.analytics_events (event_name, user_id, metadata) values
  ('story_viewed', 'b3700000-0000-4000-8000-00000000000b', '{"rule": "CHAMPION", "from": "frame:RATING"}'),
  ('opened_home', 'b3700000-0000-4000-8000-00000000000b', '{}'::jsonb);

do $$
declare v jsonb;
begin
  v := public.admin_analytics_engagement(30) -> 'shares';
  if (v #>> '{round,count}')::int is distinct from 3 then
    raise exception 'et story_viewed blev talt som en deling: rundekort=%', v #>> '{round,count}';
  end if;
  if v ? 'opened_home' or jsonb_typeof(v -> 'unknown') is not null then
    raise exception 'fremmede spande i shares: %', v;
  end if;
  raise notice 'OK 3: kun de to delingsnavne tælles';
end $$;

-- ===========================================================================
-- 4. Milepæls-delinger forurener ikke regeltabellen
-- ===========================================================================
-- MONTH_CHAMP er både en story-regel (sql/story_engine.sql) og en
-- milepælsnøgle. Reglen skal have EN historie, så rækken overhovedet findes i
-- tabellen — `rules` udledes af `stories`.
insert into public.stories (user_id, round_key, rule, priority, headline, body, period)
values ('b3700000-0000-4000-8000-00000000000b', to_char(now(), 'YYYY-MM-DD'),
        'MONTH_CHAMP', 10, 'Månedens Champion', 'Du vandt måneden.', 'round');

do $$
declare
  v jsonb;
  raekke jsonb;
begin
  v := public.admin_analytics_stories(30);
  select r into raekke from jsonb_array_elements(v -> 'rules') r
   where r ->> 'rule' = 'MONTH_CHAMP';

  if raekke is null then
    raise exception 'MONTH_CHAMP mangler i regeltabellen — opsætningen holder ikke';
  end if;
  if (raekke ->> 'shared')::int is distinct from 0 then
    raise exception 'milepæls-delingen blev talt med som en regel-deling: shared=%',
      raekke ->> 'shared';
  end if;
  raise notice 'OK 4: karriereprofilens deling tælles ikke som motorens';
end $$;

-- Og modprøven: en RIGTIG deling af regelens kort SKAL tælle. Uden den ville
-- påstanden ovenfor også være opfyldt af et filter, der tæller alting fra.
insert into public.analytics_events (event_name, user_id, metadata)
values ('story_shared', 'b3700000-0000-4000-8000-00000000000b',
        '{"rule": "MONTH_CHAMP", "from": "frame:ROUND_SUM"}');

do $$
declare raekke jsonb;
begin
  select r into raekke
    from jsonb_array_elements(public.admin_analytics_stories(30) -> 'rules') r
   where r ->> 'rule' = 'MONTH_CHAMP';
  if (raekke ->> 'shared')::int is distinct from 1 then
    raise exception 'en ægte deling af regelens kort tælles ikke: shared=%', raekke ->> 'shared';
  end if;
  raise notice 'OK 5: filteret rammer milepælen og ikke reglen';
end $$;

\echo 'analytics_share_surfaces.sql: alle paastande holder'
