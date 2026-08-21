-- Test af `sql/create_competition.sql` (G133): konkurrencen, opretteren som
-- deltager og kampene skrives i ÉT statement, så begge vinduer for en halv
-- konkurrence er lukket.
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR DET RIGTIGE SKEMA. Funktionen er `security definer` og forbigår
-- dermed de tre insert-policies, den afløser — så påstanden om, at den ikke
-- lukker noget op, kan kun stilles et sted, hvor policyerne findes. Og
-- påstand 3's negative kontrol måler den GAMLE vej, som pr. definition er
-- policy-båret. Samme argument som `sql/tests/create_group.sql` (`G91`).
--
-- HVAD DEN BEVISER
--   1. Funktionen findes, er `security definer` og har ingen bruger-parameter
--      — `created_by` og deltagerrækken kan ikke peges på en anden.
--   2. Ét kald giver alle tre slags rækker, med de rigtige værdier.
--   3. **Vinduerne er væk.** Fejler kampskrivningen (skrivning tre), findes
--      hverken konkurrencen eller deltageren — og testen viser den GAMLE
--      adfærd ved siden af, hvor den halve konkurrence bliver stående. Uden
--      den negative kontrol måler påstanden ingenting.
--   4. …og det gælder også skrivning to: fejler deltagerrækken, ruller
--      konkurrencen med.
--   5. Et opdigtet kamp-id fælder HELE kaldet på fremmednøglen — tre skrivninger,
--      nul rækker. Det er transaktionens egen garanti, målt udefra.
--   6. Vagten holder: uden `auth.uid()` afvises kaldet.
--   7. `anon` kan ikke kalde den — filens egen `revoke` (`G96`).
--   8. `mode`-reglen bor i tabellens check-constraint og gælder også gennem
--      funktionen — der er ikke en kopi, der kan drive.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d g133 -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d g133 -v ON_ERROR_STOP=1 -b -f sql/tests/create_competition.sql

\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('13330000-0000-4000-8000-000000000001', 'opretter@test.local');
insert into public.profiles (id, display_name) values
  ('13330000-0000-4000-8000-000000000001', 'Opretter');

-- Ligaen, konkurrencen skal høre til — med opretteren som admin, så
-- A8-triggeren på deltagerrækken ikke har noget at udfylde.
insert into public.groups (id, name, created_by) values
  ('13330000-0000-4000-8000-00000000000a', 'Testligaen', '13330000-0000-4000-8000-000000000001');
insert into public.group_members (group_id, user_id, role) values
  ('13330000-0000-4000-8000-00000000000a', '13330000-0000-4000-8000-000000000001', 'admin');

-- En turnering med to kommende kampe.
insert into public.leagues (id, name) values ('13330000-0000-4000-8000-0000000000aa', 'Testliga');
insert into public.seasons (id, league_id, name) values
  ('13330000-0000-4000-8000-0000000000bb', '13330000-0000-4000-8000-0000000000aa', '2026/2027');
insert into public.teams (id, league_id, name) values
  ('13330000-0000-4000-8000-0000000000c1', '13330000-0000-4000-8000-0000000000aa', 'Hjemme'),
  ('13330000-0000-4000-8000-0000000000c2', '13330000-0000-4000-8000-0000000000aa', 'Ude');
insert into public.matches (id, season_id, home_team_id, away_team_id, kickoff_at) values
  ('13330000-0000-4000-8000-0000000000d1', '13330000-0000-4000-8000-0000000000bb',
   '13330000-0000-4000-8000-0000000000c1', '13330000-0000-4000-8000-0000000000c2', now() + interval '3 days'),
  ('13330000-0000-4000-8000-0000000000d2', '13330000-0000-4000-8000-0000000000bb',
   '13330000-0000-4000-8000-0000000000c2', '13330000-0000-4000-8000-0000000000c1', now() + interval '10 days');

-- ---------------------------------------------------------------------------
-- Migreringen
-- ---------------------------------------------------------------------------
\ir ../create_competition.sql

-- Kald en funktion som en bestemt bruger og få svaret som jsonb.
create function pg_temp.kald(p_uid uuid, p_sql text) returns jsonb
language plpgsql as $$
declare v_svar jsonb;
begin
  perform set_config('test.uid', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  execute p_sql into v_svar;
  reset role;
  return v_svar;
end $$;

-- Samme, men svarer `afvist` + sqlstate frem for at vælte kørslen.
create function pg_temp.forsoeg(p_uid uuid, p_sql text) returns text
language plpgsql as $$
begin
  begin
    if p_uid is not null then perform set_config('test.uid', p_uid::text, true);
    else perform set_config('test.uid', '', true); end if;
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    execute p_sql;
    reset role;
    return 'ok';
  exception when others then
    reset role;
    return 'afvist:' || sqlstate;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Formen
-- ---------------------------------------------------------------------------
do $$
declare v_sec boolean; v_navne text[];
begin
  select prosecdef, proargnames into v_sec, v_navne
    from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'create_competition';
  if v_sec is null then raise exception 'create_competition() findes ikke'; end if;
  if not v_sec then raise exception 'create_competition() er ikke security definer'; end if;
  -- Ingen bruger-parameter: `created_by` og deltagerrækken følger auth.uid(),
  -- og der må ikke findes et id at forfalske (samme egenskab som create_group).
  -- Navnene måles, ikke typerne — 'uuid' indeholder 'uid' og ville støje.
  if exists (select 1 from unnest(v_navne) n where n ilike '%user%' or n ilike '%uid%') then
    raise exception 'create_competition() har en bruger-parameter (%) — den må ikke findes', array_to_string(v_navne, ', ');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Ét kald giver alle tre slags rækker
-- ---------------------------------------------------------------------------
do $$
declare v_svar jsonb; v_id uuid; v_n int; v_af uuid;
begin
  v_svar := pg_temp.kald('13330000-0000-4000-8000-000000000001',
    $s$select public.create_competition(
         'Superligaen 2026/27',
         '13330000-0000-4000-8000-00000000000a',
         'full_season',
         '13330000-0000-4000-8000-0000000000aa',
         '13330000-0000-4000-8000-0000000000bb',
         '{}'::jsonb,
         array['13330000-0000-4000-8000-0000000000d1',
               '13330000-0000-4000-8000-0000000000d2']::uuid[])$s$);

  v_id := (v_svar->>'id')::uuid;
  if v_id is null then raise exception 'svaret bar ingen id: %', v_svar; end if;

  -- 2a. Invitationskoden følger med — klienten fik før hele rækken fra
  --     PostgREST og skal have præcis det samme.
  if coalesce(v_svar->>'invite_code', '') = '' then
    raise exception 'svaret bar ingen invite_code: %', v_svar;
  end if;

  -- 2b. Konkurrencen står, med kalderen som opretter.
  select created_by into v_af from public.competitions where id = v_id;
  if v_af is distinct from '13330000-0000-4000-8000-000000000001'::uuid then
    raise exception 'created_by er forkert: %', v_af;
  end if;

  -- 2c. `rules` er databasens default og ikke funktionens påfund (G3).
  if (select rules from public.competitions where id = v_id)
       is distinct from '{"exact": 3, "outcome": 1}'::jsonb then
    raise exception 'rules fik ikke tabellens default';
  end if;

  -- 2d. Deltagerrækken.
  select count(*) into v_n from public.competition_participants
   where competition_id = v_id and user_id = '13330000-0000-4000-8000-000000000001';
  if v_n <> 1 then raise exception 'opretterens deltagerrække blev ikke skrevet'; end if;

  -- 2e. Begge kampe.
  select count(*) into v_n from public.competition_matches where competition_id = v_id;
  if v_n <> 2 then raise exception 'kampene blev ikke skrevet (fandt %)', v_n; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Vinduerne — de påstande, hele rækken handler om
-- ---------------------------------------------------------------------------
-- Skrivning TRE bringes til at fejle, og der måles, om noget står tilbage.
create function pg_temp.spaerr() returns trigger language plpgsql as $$
begin
  raise exception 'simuleret fejl i en senere skrivning';
end $$;
create trigger g133_spaerr_kampe before insert on public.competition_matches
  for each row execute function pg_temp.spaerr();

do $$
declare v_udfald text; v_n int;
begin
  -- 3a. DEN NYE VEJ: fejler kampskrivningen, ruller konkurrence OG deltager med.
  v_udfald := pg_temp.forsoeg('13330000-0000-4000-8000-000000000001',
    $s$select public.create_competition('Ruller tilbage',
         '13330000-0000-4000-8000-00000000000a', 'full_season',
         '13330000-0000-4000-8000-0000000000aa', '13330000-0000-4000-8000-0000000000bb',
         '{}'::jsonb,
         array['13330000-0000-4000-8000-0000000000d1']::uuid[])$s$);
  if v_udfald = 'ok' then raise exception 'testens spærre virkede ikke — trigger fyrede ikke'; end if;

  select count(*) into v_n from public.competitions where name = 'Ruller tilbage';
  if v_n <> 0 then
    raise exception 'HALV KONKURRENCE: konkurrencen står tilbage efter en fejlet kampskrivning';
  end if;

  -- 3b. NEGATIV KONTROL: den gamle vej, tre statements. Her BLIVER konkurrencen
  --     og deltageren stående uden kampe — præcis det, `G133` beskrev. Uden
  --     denne halvdel måler 3a ingenting. ⚠️ Id'et skrives i hånden, og de
  --     senere statements peger på det og ikke på et opslag — en test må ikke
  --     læse sin egen før-tilstand ud af et skema, der kan flytte sig (`G94`).
  v_udfald := pg_temp.forsoeg('13330000-0000-4000-8000-000000000001',
    $s$insert into public.competitions (id, name, group_id, league_id, season_id, mode, created_by)
       values ('13330000-0000-4000-8000-00000000000b', 'Bliver staaende',
               '13330000-0000-4000-8000-00000000000a',
               '13330000-0000-4000-8000-0000000000aa', '13330000-0000-4000-8000-0000000000bb',
               'full_season', '13330000-0000-4000-8000-000000000001')$s$);
  if v_udfald <> 'ok' then raise exception 'kontrollen kunne ikke skrive konkurrencen (%)', v_udfald; end if;

  v_udfald := pg_temp.forsoeg('13330000-0000-4000-8000-000000000001',
    $s$insert into public.competition_participants (competition_id, user_id)
       values ('13330000-0000-4000-8000-00000000000b', '13330000-0000-4000-8000-000000000001')$s$);
  if v_udfald <> 'ok' then raise exception 'kontrollen kunne ikke skrive deltageren (%)', v_udfald; end if;

  v_udfald := pg_temp.forsoeg('13330000-0000-4000-8000-000000000001',
    $s$insert into public.competition_matches (competition_id, match_id)
       values ('13330000-0000-4000-8000-00000000000b', '13330000-0000-4000-8000-0000000000d1')$s$);
  if v_udfald = 'ok' then raise exception 'testens spærre virkede ikke i kontrollen'; end if;

  select count(*) into v_n from public.competitions c
   where c.name = 'Bliver staaende'
     and not exists (select 1 from public.competition_matches m where m.competition_id = c.id);
  if v_n <> 1 then
    raise exception 'den negative kontrol viste ikke den gamle adfærd — så 3a beviser ingenting';
  end if;
end $$;

drop trigger g133_spaerr_kampe on public.competition_matches;
delete from public.competitions where name = 'Bliver staaende';

-- 4. …og vinduet mellem skrivning ét og to: fejler deltagerrækken, ruller
--    konkurrencen med.
create trigger g133_spaerr_deltager before insert on public.competition_participants
  for each row execute function pg_temp.spaerr();

do $$
declare v_udfald text; v_n int;
begin
  v_udfald := pg_temp.forsoeg('13330000-0000-4000-8000-000000000001',
    $s$select public.create_competition('Uden deltager',
         '13330000-0000-4000-8000-00000000000a', 'full_season',
         '13330000-0000-4000-8000-0000000000aa', '13330000-0000-4000-8000-0000000000bb',
         '{}'::jsonb, '{}'::uuid[])$s$);
  if v_udfald = 'ok' then raise exception 'testens spærre virkede ikke — deltager-triggeren fyrede ikke'; end if;

  select count(*) into v_n from public.competitions where name = 'Uden deltager';
  if v_n <> 0 then
    raise exception 'HALV KONKURRENCE: konkurrencen står tilbage efter en fejlet deltagerskrivning';
  end if;
end $$;

drop trigger g133_spaerr_deltager on public.competition_participants;

-- ---------------------------------------------------------------------------
-- 5. Et opdigtet kamp-id fælder hele kaldet
-- ---------------------------------------------------------------------------
do $$
declare v_udfald text; v_n int;
begin
  v_udfald := pg_temp.forsoeg('13330000-0000-4000-8000-000000000001',
    $s$select public.create_competition('Opdigtet kamp',
         '13330000-0000-4000-8000-00000000000a', 'custom',
         null, null, '{}'::jsonb,
         array['13330000-0000-4000-8000-00000000ffff']::uuid[])$s$);
  if v_udfald <> 'afvist:23503' then
    raise exception 'et opdigtet kamp-id blev ikke fældet af fremmednøglen (%)', v_udfald;
  end if;
  select count(*) into v_n from public.competitions where name = 'Opdigtet kamp';
  if v_n <> 0 then raise exception 'konkurrencen står tilbage efter et opdigtet kamp-id'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Vagten: ingen session, ingen konkurrence
-- ---------------------------------------------------------------------------
do $$
declare v_udfald text; v_n int;
begin
  v_udfald := pg_temp.forsoeg(null,
    $s$select public.create_competition('Uden session',
         '13330000-0000-4000-8000-00000000000a', 'full_season',
         null, null, '{}'::jsonb, '{}'::uuid[])$s$);
  if v_udfald <> 'afvist:42501' then
    raise exception 'et kald uden auth.uid() blev ikke afvist med 42501 (%)', v_udfald;
  end if;
  select count(*) into v_n from public.competitions where name = 'Uden session';
  if v_n <> 0 then raise exception 'en konkurrence blev skrevet uden en session'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. `anon` kan ikke kalde den
-- ---------------------------------------------------------------------------
do $$ begin
  if has_function_privilege('anon',
       'public.create_competition(text, uuid, text, uuid, uuid, jsonb, uuid[])', 'EXECUTE') then
    raise exception 'anon kan kalde create_competition() — revoke-linjen mangler i migreringen';
  end if;
  if not has_function_privilege('authenticated',
       'public.create_competition(text, uuid, text, uuid, uuid, jsonb, uuid[])', 'EXECUTE') then
    raise exception 'authenticated kan IKKE kalde create_competition() — grant-linjen mangler';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. `mode`-reglen bor i tabellen og gælder også gennem funktionen
-- ---------------------------------------------------------------------------
do $$
declare v_udfald text;
begin
  v_udfald := pg_temp.forsoeg('13330000-0000-4000-8000-000000000001',
    $s$select public.create_competition('Forkert mode',
         '13330000-0000-4000-8000-00000000000a', 'findes_ikke',
         null, null, '{}'::jsonb, '{}'::uuid[])$s$);
  if v_udfald <> 'afvist:23514' then
    raise exception 'en ukendt mode slap igennem funktionen (%)', v_udfald;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Idempotens: filen kan køres to gange
-- ---------------------------------------------------------------------------
\ir ../create_competition.sql

do $$
declare v_svar jsonb;
begin
  v_svar := pg_temp.kald('13330000-0000-4000-8000-000000000001',
    $s$select public.create_competition('Efter anden koersel',
         '13330000-0000-4000-8000-00000000000a', 'random',
         null, null, '{"count": 6}'::jsonb, '{}'::uuid[])$s$);
  if (v_svar->>'id') is null then raise exception 'anden kørsel af filen brød funktionen'; end if;
end $$;

select 'create_competition: OK' as result;
