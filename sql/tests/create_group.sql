-- Test af `sql/create_group.sql` (G95): ligaen og opretterens admin-række
-- skrives i ÉT statement, så vinduet for en forældreløs liga er lukket.
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR DET RIGTIGE SKEMA. Funktionen er `security definer` og forbigår
-- dermed de to insert-policies, den afløser — så påstanden om, at den ikke
-- lukker noget op, kan kun stilles et sted, hvor policyerne findes (`G91`). Og
-- påstand 6 måler den GAMLE vej, som pr. definition er policy-båret.
--
-- HVAD DEN BEVISER
--   1. Funktionen findes, er `security definer` og har ÉN parameter — der er
--      ikke et bruger-id at forfalske.
--   2. Ét kald giver både ligaen og opretterens admin-række, med de rigtige
--      værdier.
--   3. **Vinduet er væk.** Fejler den anden skrivning, findes ligaen heller
--      ikke — og testen viser den GAMLE adfærd ved siden af, hvor den bliver
--      stående. Uden den negative kontrol måler påstanden ingenting: en test,
--      der kun ser det lykkelige forløb, ville have været grøn hele tiden.
--   4. Vagten holder: uden `auth.uid()` afvises kaldet.
--   5. `anon` kan ikke kalde den — og det er ikke default privileges' fortjeneste,
--      men filens egen `revoke` (`G96`).
--   6. **Den gamle vej virker stadig**, altså mellemtilstanden mellem migrering
--      og deploy. Det er dét, der gør filen sikker at køre før frontend-mergen,
--      og det er samme påstand som `invite_lookup.sql`s måling af
--      mellemtilstanden mellem `#52` og `#53`.
--   7. Navnet trimmes, og et navn, der ikke overholder tabellens check, afvises.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d g95 -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d g95 -v ON_ERROR_STOP=1 -b -f sql/tests/create_group.sql

\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('95950000-0000-4000-8000-000000000001', 'opretter@test.local'),
  ('95950000-0000-4000-8000-000000000002', 'anden@test.local');
insert into public.profiles (id, display_name) values
  ('95950000-0000-4000-8000-000000000001', 'Opretter'),
  ('95950000-0000-4000-8000-000000000002', 'Anden');

-- ---------------------------------------------------------------------------
-- Migreringen
-- ---------------------------------------------------------------------------
\ir ../create_group.sql

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
declare v_sec boolean; v_args int;
begin
  select prosecdef, pronargs into v_sec, v_args from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'create_group';
  if v_sec is null then raise exception 'create_group() findes ikke'; end if;
  if not v_sec then raise exception 'create_group() er ikke security definer'; end if;
  -- Én parameter: navnet. To ville betyde, at kalderen kunne pege på en anden
  -- bruger, og hele vagten ville være en parameter, ikke en egenskab.
  if v_args <> 1 then raise exception 'create_group() har % parametre — der må ikke være et bruger-id at sende med', v_args; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Ét kald giver begge rækker
-- ---------------------------------------------------------------------------
do $$
declare v_svar jsonb; v_id uuid; v_n int; v_rolle text; v_af uuid;
begin
  v_svar := pg_temp.kald('95950000-0000-4000-8000-000000000001',
              $s$select public.create_group('  Fodboldkammeraterne  ')$s$);

  v_id := (v_svar->>'id')::uuid;
  if v_id is null then raise exception 'svaret bar ingen id: %', v_svar; end if;

  -- 2a. Navnet er trimmet (påstand 7's første halvdel).
  if v_svar->>'name' is distinct from 'Fodboldkammeraterne' then
    raise exception 'navnet blev ikke trimmet: %', v_svar->>'name';
  end if;

  -- 2b. Invitationskoden følger med. Klienten viser den som ligaens kode
  --     umiddelbart efter oprettelsen, så et svar uden den ville koste en
  --     ekstra rundtur — eller et tomt felt.
  if coalesce(v_svar->>'invite_code', '') = '' then
    raise exception 'svaret bar ingen invite_code: %', v_svar;
  end if;

  -- 2c. Ligaen står, med kalderen som opretter.
  select count(*) into v_n from public.groups where id = v_id;
  if v_n <> 1 then raise exception 'ligaen blev ikke skrevet'; end if;
  select created_by into v_af from public.groups where id = v_id;
  if v_af is distinct from '95950000-0000-4000-8000-000000000001'::uuid then
    raise exception 'created_by er forkert: %', v_af;
  end if;

  -- 2d. …og admin-rækken med den. Det er hele leverancen.
  select count(*) into v_n
    from public.group_members
   where group_id = v_id and user_id = '95950000-0000-4000-8000-000000000001';
  if v_n <> 1 then raise exception 'opretterens medlemsrække blev ikke skrevet'; end if;
  select role into v_rolle
    from public.group_members
   where group_id = v_id and user_id = '95950000-0000-4000-8000-000000000001';
  if v_rolle is distinct from 'admin' then raise exception 'opretteren fik rollen %, ikke admin', v_rolle; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Vinduet — den påstand, hele rækken handler om
-- ---------------------------------------------------------------------------
-- Den anden skrivning bringes til at fejle, og der måles, om ligaen står
-- tilbage. Én trigger tjener begge halvdele af sammenligningen.
create function pg_temp.spaerr() returns trigger language plpgsql as $$
begin
  raise exception 'simuleret fejl i skrivning nummer to';
end $$;
create trigger g95_spaerr before insert on public.group_members
  for each row execute function pg_temp.spaerr();

do $$
declare v_udfald text; v_n int;
begin
  -- 3a. DEN NYE VEJ: ét statement. Fejler medlemsrækken, ruller ligaen med.
  v_udfald := pg_temp.forsoeg('95950000-0000-4000-8000-000000000001',
                $s$select public.create_group('Ruller tilbage')$s$);
  if v_udfald = 'ok' then raise exception 'testens spærre virkede ikke — trigger fyrede ikke'; end if;

  select count(*) into v_n from public.groups where name = 'Ruller tilbage';
  if v_n <> 0 then
    raise exception 'FORÆLDRELØS LIGA: ligaen står tilbage uden medlemmer efter en fejlet medlemsskrivning';
  end if;

  -- 3b. NEGATIV KONTROL: den gamle vej, altså to statements. Her BLIVER ligaen
  --     stående — præcis det, `G95` beskrev. Uden denne halvdel måler 3a
  --     ingenting: den ville også være grøn, hvis testens spærre aldrig ramte.
  v_udfald := pg_temp.forsoeg('95950000-0000-4000-8000-000000000001',
                $s$insert into public.groups (name, created_by)
                   values ('Bliver staaende', '95950000-0000-4000-8000-000000000001')$s$);
  if v_udfald <> 'ok' then raise exception 'kontrollen kunne ikke skrive ligaen (%)', v_udfald; end if;

  v_udfald := pg_temp.forsoeg('95950000-0000-4000-8000-000000000001',
                $s$insert into public.group_members (group_id, user_id, role)
                   select id, '95950000-0000-4000-8000-000000000001', 'admin'
                     from public.groups where name = 'Bliver staaende'$s$);
  if v_udfald = 'ok' then raise exception 'testens spærre virkede ikke i kontrollen'; end if;

  select count(*) into v_n from public.groups g
   where g.name = 'Bliver staaende'
     and not exists (select 1 from public.group_members m where m.group_id = g.id);
  if v_n <> 1 then
    raise exception 'den negative kontrol viste ikke den gamle adfærd — så 3a beviser ingenting';
  end if;
end $$;

drop trigger g95_spaerr on public.group_members;
delete from public.groups where name = 'Bliver staaende';

-- ---------------------------------------------------------------------------
-- 4. Vagten: ingen session, ingen liga
-- ---------------------------------------------------------------------------
do $$
declare v_udfald text; v_n int;
begin
  v_udfald := pg_temp.forsoeg(null, $s$select public.create_group('Uden session')$s$);
  if v_udfald <> 'afvist:42501' then
    raise exception 'et kald uden auth.uid() blev ikke afvist med 42501 (%)', v_udfald;
  end if;
  select count(*) into v_n from public.groups where name = 'Uden session';
  if v_n <> 0 then raise exception 'en liga blev skrevet uden en session'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. `anon` kan ikke kalde den
-- ---------------------------------------------------------------------------
-- Filens egen `revoke … from public, anon` er dét, der bærer påstanden: en ny
-- funktion får PUBLIC's EXECUTE af PostgreSQLs indbyggede default, som ikke kan
-- lukkes ved kilden (`G96`). Falder denne påstand, er `revoke`-linjen røget.
do $$ begin
  if has_function_privilege('anon', 'public.create_group(text)', 'EXECUTE') then
    raise exception 'anon kan kalde create_group() — revoke-linjen mangler i migreringen';
  end if;
  if not has_function_privilege('authenticated', 'public.create_group(text)', 'EXECUTE') then
    raise exception 'authenticated kan IKKE kalde create_group() — grant-linjen mangler';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Mellemtilstanden: den gamle klient virker stadig
-- ---------------------------------------------------------------------------
-- Det er dét, der gør migreringen sikker at køre før deployet. Skrivningen sker
-- MED `returning`, fordi det er dét, `db.insert` gør (`Prefer:
-- return=representation`) — og fordi netop den kombination af INSERT- og
-- SELECT-policy væltede produktionen 11. august 2026 (`#55`).
do $$
declare v_id uuid; v_n int;
begin
  perform set_config('test.uid', '95950000-0000-4000-8000-000000000002', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  insert into public.groups (name, created_by)
  values ('Gammel vej', '95950000-0000-4000-8000-000000000002')
  returning id into v_id;
  insert into public.group_members (group_id, user_id, role)
  values (v_id, '95950000-0000-4000-8000-000000000002', 'admin');
  reset role;

  select count(*) into v_n from public.group_members where group_id = v_id;
  if v_n <> 1 then raise exception 'den gamle vej blev brudt af migreringen'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Navnereglen bor i tabellen og gælder også gennem funktionen
-- ---------------------------------------------------------------------------
do $$
declare v_udfald text;
begin
  -- Ét tegn er for kort (check: 2–40). 23514 er check_violation.
  v_udfald := pg_temp.forsoeg('95950000-0000-4000-8000-000000000001',
                $s$select public.create_group('x')$s$);
  if v_udfald <> 'afvist:23514' then
    raise exception 'et for kort navn slap igennem funktionen (%)', v_udfald;
  end if;

  -- Kun mellemrum er det samme som tomt, efter trim.
  v_udfald := pg_temp.forsoeg('95950000-0000-4000-8000-000000000001',
                $s$select public.create_group('    ')$s$);
  if v_udfald <> 'afvist:23514' then
    raise exception 'et tomt navn slap igennem funktionen (%)', v_udfald;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Idempotens: filen kan køres to gange
-- ---------------------------------------------------------------------------
\ir ../create_group.sql

do $$
declare v_svar jsonb;
begin
  v_svar := pg_temp.kald('95950000-0000-4000-8000-000000000001',
              $s$select public.create_group('Efter anden koersel')$s$);
  if (v_svar->>'id') is null then raise exception 'anden kørsel af filen brød funktionen'; end if;
end $$;

select 'create_group: OK' as result;
