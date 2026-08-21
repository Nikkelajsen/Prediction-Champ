-- Test af Championship-fanens to vælgere (sql/championship_selectors.sql, G146).
--
-- Kører mod PRODUKTIONSSKEMAET (`node sql/tests/_schema.mjs`) og anvender
-- derefter migreringen. Rører aldrig produktion.
--
-- HVORFOR PRODUKTIONSSKEMAET OG IKKE ET MINISKEMA
-- Den bærende påstand er, at måneds-viewet er den SAMME mængde som
-- `monthly_standings`. Det view findes kun i produktionsskemaet, og en
-- håndlavet kopi ville måle kopien frem for tingen. Runde-viewet skal
-- tilsvarende måles mod `matches.round_key`, som er en GENERERET kolonne
-- (`round_key(kickoff_at)`) — den regel bor også kun i skemaet.
--
-- HVAD DEN BEVISER
--   1. Formen: begge views er `security_invoker`, `anon` kan ikke læse dem, og
--      `authenticated` har kun `select`.
--   2. 🔴 **Måneds-viewet er ORDRET `select distinct scope, month from
--      monthly_standings`** — målt i BEGGE retninger, så hverken en manglende
--      eller en overskydende måned kan slippe forbi. Det er den påstand, der
--      gør gentagelsen af stillingens rækkekilde forsvarlig: driver de to fra
--      hinanden, fælder testen det i CI frem for i en dropdown.
--   3. 🔴 **Runde-viewet er ordret det, klienten selv gjorde** — det to-trins
--      opslag (`leagues` → `seasons` → `matches`), `loadRoundsAvailable` lavede
--      i browseren, skrevet ud i SQL og sammenlignet i begge retninger. Både
--      for `'ALL'` og for hver enkelt turnering.
--   4. `'ALL'` tæller kun officielle turneringer, og et turnerings-scope tæller
--      også en uofficiel. Det er `scopeSeasonIds()`s skævhed, arvet med vilje —
--      en påstand, så den ikke kan forsvinde ved et uheld.
--   5. En runde uden ét eneste tip er STADIG i vælgeren. Det er forskellen på
--      at bygge viewet på `matches` og på `round_standings`, og den koster en
--      runde i dropdownen, hvis nogen bytter om.
--   6. Migreringen er idempotent.
--
-- HVAD DEN **IKKE** GØR, OG HVORFOR (§13)
-- Den måler ikke `security_invoker` på ADFÆRD, kun på formen (påstand 1) og på
-- grants. Grunden er, at de rækker, viewene overhovedet kan vise, er dem, enhver
-- indlogget bruger allerede må læse: runde-viewet står på `matches`/`seasons`/
-- `leagues`, hvis policies er `auth.role() = 'authenticated'`, og måneds-viewet
-- tæller kun tips på SPILLEDE kampe, som `predictions_select_visible` netop
-- lukker op for alle. Der findes altså ingen bruger, for hvem invoker og definer
-- ville give to forskellige svar — og dét er samtidig grunden til, at viewene
-- ikke kan lække noget. Reglen står som en formpåstand, fordi den skal holde,
-- den dag rækkekilden ændrer sig.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d cs -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d cs -v ON_ERROR_STOP=1 -b -f sql/tests/championship_selectors.sql

\set ON_ERROR_STOP on
\timing off

\ir ../championship_selectors.sql

-- Rating- og Story Engine-triggerne har intet med vælgerne at gøre og ville kun
-- gøre kørslen langsom. Samme greb som i `sql/tests/write_surface.sql`.
alter table public.matches disable trigger all;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- To OFFICIELLE turneringer og én uofficiel (men synlig — check-constrainten
-- `leagues_official_implies_visible` går kun den ene vej). Kampe i to måneder,
-- så måneds-vælgeren har mere end én værdi at tage fejl af.
insert into auth.users (id, email) values
  ('61460000-0000-4000-8000-00000000000a', 'anna@test.local'),
  ('61460000-0000-4000-8000-00000000000b', 'bo@test.local');
insert into public.profiles (id, display_name) values
  ('61460000-0000-4000-8000-00000000000a', 'Anna'),
  ('61460000-0000-4000-8000-00000000000b', 'Bo');

insert into public.leagues (id, name, is_visible, is_official) values
  ('61460000-0000-4000-8000-000000000101', 'Officiel A', true, true),
  ('61460000-0000-4000-8000-000000000102', 'Officiel B', true, true),
  ('61460000-0000-4000-8000-000000000103', 'Uofficiel',  true, false);
insert into public.seasons (id, league_id, name) values
  ('61460000-0000-4000-8000-000000000201', '61460000-0000-4000-8000-000000000101', '2025/26'),
  ('61460000-0000-4000-8000-000000000202', '61460000-0000-4000-8000-000000000101', '2026/27'),
  ('61460000-0000-4000-8000-000000000203', '61460000-0000-4000-8000-000000000102', '2026/27'),
  ('61460000-0000-4000-8000-000000000204', '61460000-0000-4000-8000-000000000103', '2026/27');
insert into public.teams (id, league_id, name)
select ('61460000-0000-4000-8000-0000000003' || lpad(i::text, 2, '0'))::uuid,
       '61460000-0000-4000-8000-000000000101', 'Hold ' || i
  from generate_series(1, 2) i;

-- Kampene. `round_key` er GENERERET af `kickoff_at`, så runderne styres ved at
-- flytte datoen — fire spilledatoer fordelt på juli og august.
--
-- `61460000-…-0409` er den ene, der bærer påstand 5: spillet færdig, og ingen
-- har tippet den. Den ligger i sin EGEN runde, så en vælger bygget på
-- `round_standings` ville tabe præcis den ene værdi.
insert into public.matches (id, season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score) values
  -- Officiel A, sæson 2025/26 — juli
  ('61460000-0000-4000-8000-000000000401', '61460000-0000-4000-8000-000000000201',
   '61460000-0000-4000-8000-000000000301', '61460000-0000-4000-8000-000000000302', '2026-07-06T18:00:00Z', 2, 1),
  -- Officiel A, sæson 2026/27 — juli og august
  ('61460000-0000-4000-8000-000000000402', '61460000-0000-4000-8000-000000000202',
   '61460000-0000-4000-8000-000000000301', '61460000-0000-4000-8000-000000000302', '2026-07-13T18:00:00Z', 1, 1),
  ('61460000-0000-4000-8000-000000000403', '61460000-0000-4000-8000-000000000202',
   '61460000-0000-4000-8000-000000000301', '61460000-0000-4000-8000-000000000302', '2026-08-10T18:00:00Z', 3, 0),
  -- Officiel B — august, sin egen runde
  ('61460000-0000-4000-8000-000000000404', '61460000-0000-4000-8000-000000000203',
   '61460000-0000-4000-8000-000000000301', '61460000-0000-4000-8000-000000000302', '2026-08-17T18:00:00Z', 0, 0),
  -- Uofficiel — september, altså en runde og en måned, som `'ALL'` ikke må se
  ('61460000-0000-4000-8000-000000000405', '61460000-0000-4000-8000-000000000204',
   '61460000-0000-4000-8000-000000000301', '61460000-0000-4000-8000-000000000302', '2026-09-07T18:00:00Z', 2, 2),
  -- IKKE spillet endnu — hverken runde eller måned må komme med
  ('61460000-0000-4000-8000-000000000406', '61460000-0000-4000-8000-000000000202',
   '61460000-0000-4000-8000-000000000301', '61460000-0000-4000-8000-000000000302', '2026-10-05T18:00:00Z', null, null),
  -- Spillet, men uden ét eneste tip (påstand 5) — sin egen runde i november
  ('61460000-0000-4000-8000-000000000409', '61460000-0000-4000-8000-000000000202',
   '61460000-0000-4000-8000-000000000301', '61460000-0000-4000-8000-000000000302', '2026-11-09T18:00:00Z', 1, 0);

-- Tips. Ikke på `…409` (påstand 5). Der ER et tip på den uspillede kamp, og det
-- er med vilje: hverken dens runde eller dens måned må komme med, og et tip er
-- den eneste måde at fremkalde fejlen på i måneds-viewet.
--
-- `predictions.pred_home`/`pred_away` er `not null` i skemaet, så de to
-- `not null`-krav, viewet arver fra `monthly_standings`, kan ikke måles her.
-- De står alligevel: viewet skal være den samme rækkekilde som stillingen, og
-- en betingelse, der er inert i dag, er den, der bliver bærende, når kolonnen
-- en dag bliver valgfri.
insert into public.predictions (user_id, match_id, pred_home, pred_away) values
  ('61460000-0000-4000-8000-00000000000a', '61460000-0000-4000-8000-000000000401', 2, 1),
  ('61460000-0000-4000-8000-00000000000b', '61460000-0000-4000-8000-000000000401', 1, 0),
  ('61460000-0000-4000-8000-00000000000a', '61460000-0000-4000-8000-000000000402', 1, 1),
  ('61460000-0000-4000-8000-00000000000a', '61460000-0000-4000-8000-000000000403', 2, 0),
  ('61460000-0000-4000-8000-00000000000b', '61460000-0000-4000-8000-000000000404', 0, 1),
  ('61460000-0000-4000-8000-00000000000a', '61460000-0000-4000-8000-000000000405', 2, 2),
  ('61460000-0000-4000-8000-00000000000b', '61460000-0000-4000-8000-000000000406', 1, 1),
  ('61460000-0000-4000-8000-00000000000b', '61460000-0000-4000-8000-000000000403', 3, 1);

-- ---------------------------------------------------------------------------
-- 1. Formen
-- ---------------------------------------------------------------------------
do $$
declare v text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relname in ('championship_rounds', 'championship_months')
     and not ('security_invoker=on' = any(coalesce(c.reloptions, '{}')));
  if v is not null then
    raise exception 'view uden security_invoker: % — det ville svare uden om RLS', v;
  end if;

  foreach v in array array['championship_rounds', 'championship_months'] loop
    if has_table_privilege('anon', 'public.' || v, 'SELECT') then
      raise exception '`anon` skal ikke kunne læse %', v;
    end if;
    if not has_table_privilege('authenticated', 'public.' || v, 'SELECT') then
      raise exception 'en indlogget bruger skal kunne LÆSE %', v;
    end if;
    if has_table_privilege('authenticated', 'public.' || v, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || v, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || v, 'DELETE') then
      raise exception '% må kun kunne læses af authenticated', v;
    end if;
  end loop;

  raise notice 'OK 1: security_invoker, kun læsning for authenticated, intet til anon';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Måneds-viewet ER stillingens egne måneder
-- ---------------------------------------------------------------------------
-- Begge retninger. `monthly_standings` er facit, fordi det er den, brugeren
-- klikker sig videre til: står der en måned i dropdownen, som stillingen ikke
-- kender, får hun en tom skærm — og mangler der en, findes hendes point ikke.
do $$
declare v_mangler text; v_ekstra text;
begin
  select string_agg(scope || '/' || month, ', ' order by scope, month) into v_mangler
    from (select distinct scope, month from public.monthly_standings
          except select scope, month from public.championship_months) a;
  if v_mangler is not null then
    raise exception 'stillingen har måneder, vælgeren ikke viser: %', v_mangler;
  end if;

  select string_agg(scope || '/' || month, ', ' order by scope, month) into v_ekstra
    from (select scope, month from public.championship_months
          except select distinct scope, month from public.monthly_standings) b;
  if v_ekstra is not null then
    raise exception 'vælgeren viser måneder, stillingen ikke har: %', v_ekstra;
  end if;

  -- En mængde, der er tom på begge sider, ville bestå de to ovenfor uden at
  -- måle noget. Fixturen skal altså faktisk have måneder.
  if (select count(*) from public.championship_months where scope = 'ALL') < 2 then
    raise exception 'fixturen har under to måneder i ALL — påstanden måler da ingenting';
  end if;

  raise notice 'OK 2: måneds-vælgeren er ordret stillingens egne måneder';
end $$;

-- ---------------------------------------------------------------------------
-- 3 + 4. Runde-viewet ER det, klienten selv gjorde
-- ---------------------------------------------------------------------------
-- `loadRoundsAvailable()` skrevet ud i SQL: turneringerne i scopet → deres
-- sæsoner → runder med mindst én spillet kamp. Sammenlignet i begge retninger
-- for `'ALL'` og for hver enkelt turnering — også den uofficielle, som er
-- påstand 4's anden halvdel.
do $$
declare v_scope text; v_afvig text;
begin
  foreach v_scope in array (
    select array_agg(x) from (select 'ALL' as x union all select id::text from public.leagues) s
  ) loop
    with gammel as (
      select distinct m.round_key
        from public.matches m
       where m.home_score is not null
         and m.season_id in (
           select s.id from public.seasons s
             join public.leagues l on l.id = s.league_id
            where case when v_scope = 'ALL' then l.is_official else l.id::text = v_scope end)
    ), ny as (
      select round_key from public.championship_rounds where scope = v_scope
    )
    select string_agg(t.side || ' ' || t.round_key::text, ', ' order by t.round_key) into v_afvig
      from ((select 'mangler' as side, round_key from gammel except all select 'mangler', round_key from ny)
            union all
            (select 'for meget', round_key from ny except all select 'for meget', round_key from gammel)) t;

    if v_afvig is not null then
      raise exception 'runde-vælgeren er uenig med den gamle vej for scope %: %', v_scope, v_afvig;
    end if;
  end loop;

  -- Påstand 4, sagt direkte: den uofficielle turnerings runde er med i SIT
  -- eget scope og IKKE i `'ALL'`. Uden begge halvdele ville en tom
  -- `championship_rounds` bestå løkken ovenfor.
  if not exists (select 1 from public.championship_rounds
                  where scope = '61460000-0000-4000-8000-000000000103'
                    and round_key = public.round_key('2026-09-07T18:00:00Z'::timestamptz)) then
    raise exception 'et turnerings-scope skal også svare for en UOFFICIEL turnering';
  end if;
  if exists (select 1 from public.championship_rounds
              where scope = 'ALL'
                and round_key = public.round_key('2026-09-07T18:00:00Z'::timestamptz)) then
    raise exception 'ALL må kun tælle officielle turneringer';
  end if;

  -- Og den uspillede kamps runde er ingen steder.
  if exists (select 1 from public.championship_rounds
              where round_key = public.round_key('2026-10-05T18:00:00Z'::timestamptz)) then
    raise exception 'en runde uden en eneste spillet kamp må ikke stå i vælgeren';
  end if;

  raise notice 'OK 3+4: runde-vælgeren er ordret den gamle vej, i alle scopes';
end $$;

-- ---------------------------------------------------------------------------
-- 5. En runde uden tips er stadig en runde
-- ---------------------------------------------------------------------------
-- Forskellen på at bygge viewet på `matches` og på `round_standings`.
-- `loadRoundBoard` tæller selv kampene og viser fremdriften, så runden ER
-- brugbar uden et eneste gæt — og forsvinder den ud af dropdownen, er det en
-- ÆNDRING af, hvad brugeren kan se, og ikke en optimering.
do $$
declare v_runde date := public.round_key('2026-11-09T18:00:00Z'::timestamptz);
begin
  if exists (select 1 from public.round_standings where round_key = v_runde) then
    raise exception 'fixturen er forkert: %-runden skulle IKKE have tips', v_runde;
  end if;
  if not exists (select 1 from public.championship_rounds where scope = 'ALL' and round_key = v_runde) then
    raise exception 'en spillet runde uden tips faldt ud af vælgeren — viewet står på den forkerte tabel';
  end if;
  raise notice 'OK 5: en spillet runde uden tips er stadig i vælgeren';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Idempotens
-- ---------------------------------------------------------------------------
\ir ../championship_selectors.sql

do $$
declare v_runder int; v_maaneder int;
begin
  select count(*) into v_runder   from public.championship_rounds where scope = 'ALL';
  select count(*) into v_maaneder from public.championship_months where scope = 'ALL';
  if v_runder <> 5 or v_maaneder <> 2 then
    raise exception 'anden kørsel ændrede svaret: % runder, % måneder (forventede 5 og 2)', v_runder, v_maaneder;
  end if;
  raise notice 'OK 6: migreringen er idempotent';
end $$;

\echo 'ALLE PÅSTANDE BESTÅET (championship_selectors)'
