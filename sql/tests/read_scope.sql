-- Test af `sql/read_scope_functions.sql` (#59) og `sql/read_scope_narrow.sql`
-- (#60) — `A43`: læsefladen smalnes på `profiles` (kolonner) og
-- `competition_participants` (rækker).
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR DET RIGTIGE SKEMA. Hele rækken handler om samspillet mellem
-- privilegier og policies, som begge kun findes i produktionsskemaet: `#51`s
-- UPDATE-kolonner, `#53`s `competitions_select_involved`, `read profiles` og
-- deltagertabellens tre skrive-policies. Et minischema ville måle en anden
-- database end den, migreringen skal køre i.
--
-- HVAD DEN BEVISER
--   1. De tre funktioner findes, er `security definer`, og `anon` kan ingen af
--      dem.
--   2. **Mellemtilstanden mellem #59 og #60**, målt fra begge sider: med #59
--      alene virker den GAMLE klient uændret (`select=*`, hele deltagerlisten)
--      — det er dét, der gør #59 sikker at køre før frontend-mergen.
--   3. Efter #60 er `profiles` smal: præcis tre kolonner, `select *` afvises,
--      og `has_table_privilege` er falsk.
--   4. **Stillingen er IKKE tømt.** Enhver indlogget kan stadig læse ENHVER
--      brugers `display_name` — rækkerne skulle blive, og det er den påstand,
--      der skiller `A43`s svar fra det, rækken oprindeligt foreslog.
--   5. 🔴 **RETURNING er også en læsning.** En upsert uden `select=` afvises med
--      42501; med `select=id, display_name` går den igennem. Det er den fælde,
--      der ellers først ville vise sig som "kan ikke skifte brugernavn".
--   6. `my_profile()` giver ens EGEN række med `is_admin`, intet uden session,
--      og aldrig en andens. `admin_profiles()` afviser en ikke-admin.
--  6b. 🔴 **De tre policies, der LÆSER `is_admin`.** `job_runs_read_admin` og de
--      to på `matches` slog op i `profiles.is_admin` og ville derfor FEJLE med
--      42501 — ikke filtrere — i det sekund kolonnen forsvandt fra læsefladen.
--      Admin → Drift ville være brækket for alle, også for en administrator.
--      Påstanden måler begge retninger og desuden, at INGEN policy læser
--      `profiles` direkte længere.
--   7. Deltagerpolicyen, målt som en matrix: deltager, ligamedlem uden
--      deltagelse, opretter og fremmed × liga-konkurrence og liga-løs
--      konkurrence. Og de SEKS skrivninger, der læser deres egen række tilbage
--      (opret konkurrencen, tilmeld, arkivér, forlad, liga-admin fjerner en
--      ANDEN, og forsøget på at oprette i en andens navn). Listen var fire og
--      manglede netop oprettelsen — se 7e og `G130`.
--   8. **Ingen rekursion.** `competitions` kan stadig læses — den naive policy
--      slukker for BEGGE tabeller, og testen viser fejlen ved siden af.
--   9. `is_competition_visible()` svarer det samme som `#53`s inline-prædikat
--      for hver bruger i matrixen — altså er policy-omskrivningen i #60 et
--      no-op og ikke en ny regel.
--  10. Begge filer er idempotente.
--
-- HVAD DEN **IKKE** MÅLER, OG HVORFOR
-- To ting i `#60` er no-ops ved konstruktion, og testen siger det hellere end
-- at lade en læser tro, de er dækket. Begge er efterprøvet med en mutation, der
-- IKKE fik testen til at fejle:
--
--   · **`user_id = auth.uid()` i deltagerpolicyen.** Fjernes leddet, holder hver
--     eneste påstand her. INSERT-policyen kræver i forvejen, at man er opretter
--     eller ligamedlem, så der findes ikke en skrivning, leddet redder. Det står
--     for ydelsens skyld — se `#60`s afsnit 3.
--   · **Omskrivningen af `competitions_select_involved`.** Lades policyen stå
--     som `#53` skrev den, ændrer intet sig. Det er hele påstanden i `#60`
--     ("adfærdsændring: ingen"), og det, testen kan måle, er dét: påstand 9
--     stiller de to prædikater op mod hinanden for hver celle i matrixen.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d a43 -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d a43 -v ON_ERROR_STOP=1 -b -f sql/tests/read_scope.sql

\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- Fire brugere og to konkurrencer, valgt så matrixen i påstand 7 har en celle
-- for hver gren i `is_competition_visible()`:
--
--   ANNA   opretter ligaen og liga-konkurrencen, og deltager i den.
--   BO     er medlem af ligaen, men deltager IKKE i konkurrencen.
--   CARL   er hverken medlem eller deltager — han er den fremmede.
--   DIDDE  er global administrator og ellers uden for det hele.
--
--   KOMP_L er ligaens konkurrence.  KOMP_S er liga-løs og oprettet af Anna.
insert into auth.users (id, email) values
  ('43430000-0000-4000-8000-00000000000a', 'anna@test.local'),
  ('43430000-0000-4000-8000-00000000000b', 'bo@test.local'),
  ('43430000-0000-4000-8000-00000000000c', 'carl@test.local'),
  ('43430000-0000-4000-8000-00000000000d', 'didde@test.local');
insert into public.profiles (id, display_name, is_admin, last_seen_at) values
  ('43430000-0000-4000-8000-00000000000a', 'Anna',  false, now()),
  ('43430000-0000-4000-8000-00000000000b', 'Bo',    false, now()),
  ('43430000-0000-4000-8000-00000000000c', 'Carl',  false, now()),
  ('43430000-0000-4000-8000-00000000000d', 'Didde', true,  now());

insert into public.groups (id, name, created_by) values
  ('43430000-0000-4000-8000-000000000f01', 'Ligaen', '43430000-0000-4000-8000-00000000000a');
insert into public.group_members (group_id, user_id, role) values
  ('43430000-0000-4000-8000-000000000f01', '43430000-0000-4000-8000-00000000000a', 'admin'),
  ('43430000-0000-4000-8000-000000000f01', '43430000-0000-4000-8000-00000000000b', 'member');

insert into public.competitions (id, name, mode, created_by, group_id) values
  ('43430000-0000-4000-8000-0000000000c1', 'Ligakonkurrencen', 'random',
   '43430000-0000-4000-8000-00000000000a', '43430000-0000-4000-8000-000000000f01'),
  ('43430000-0000-4000-8000-0000000000c2', 'Liga-loes', 'random',
   '43430000-0000-4000-8000-00000000000a', null);
insert into public.competition_participants (competition_id, user_id) values
  ('43430000-0000-4000-8000-0000000000c1', '43430000-0000-4000-8000-00000000000a'),
  ('43430000-0000-4000-8000-0000000000c2', '43430000-0000-4000-8000-00000000000a');

-- En kørsel i `job_runs` og en kamp: de to tabeller, hvis policies LÆSER
-- `profiles.is_admin`, og som derfor er dem, afsnit 6b måler.
insert into public.job_runs (job, ok, detail) values ('sync-matches', true, '{}'::jsonb);

insert into public.leagues (id, name, api_league_id) values
  ('43430000-0000-4000-8000-0000000000e1', 'Testturnering', 434301);
insert into public.seasons (id, league_id, name) values
  ('43430000-0000-4000-8000-0000000000e2', '43430000-0000-4000-8000-0000000000e1', '2026');
insert into public.teams (id, league_id, name) values
  ('43430000-0000-4000-8000-0000000000e3', '43430000-0000-4000-8000-0000000000e1', 'Hjemme'),
  ('43430000-0000-4000-8000-0000000000e4', '43430000-0000-4000-8000-0000000000e1', 'Ude');
insert into public.matches (id, season_id, home_team_id, away_team_id, kickoff_at, home_score) values
  ('43430000-0000-4000-8000-0000000000e5', '43430000-0000-4000-8000-0000000000e2',
   '43430000-0000-4000-8000-0000000000e3', '43430000-0000-4000-8000-0000000000e4',
   now() - interval '1 day', 1);

-- ---------------------------------------------------------------------------
-- Hjælpere: kør som en bestemt indlogget bruger
-- ---------------------------------------------------------------------------
-- `svar` giver værdien tilbage som text; `forsoeg` svarer `ok` eller
-- `afvist:<sqlstate>` frem for at vælte kørslen. Samme form som i
-- `create_group.sql` og `invite_lookup.sql`.
create function pg_temp.svar(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare v text;
begin
  perform set_config('test.uid', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  return v;
end $$;

create function pg_temp.forsoeg(p_uid uuid, p_sql text) returns text
language plpgsql as $$
begin
  begin
    perform set_config('test.uid', coalesce(p_uid::text, ''), true);
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

-- ===========================================================================
-- 2a. FØR-tilstanden, skrevet i hånden og ikke læst af skemaet
-- ===========================================================================
-- ⚠️ **§13-reglen (`G94`, `G98`): en test må ikke læse sin før-tilstand af
-- dumpet.** `sql/schema.sql` er et øjebliksbillede, og i det sekund `#60`
-- eksporteres, ville et afsnit, der REGNER MED den brede flade, holde op med
-- at måle noget — grønt uden at bevise. Fladen skrives derfor eksplicit her.
grant select on public.profiles to authenticated;
drop policy if exists competition_participants_select_visible on public.competition_participants;
drop policy if exists "read all participation" on public.competition_participants;
create policy "read all participation" on public.competition_participants
  for select using (auth.role() = 'authenticated');

do $$
declare v_udfald text; v_n text;
begin
  -- Den gamle klients to bredeste opslag, ordret.
  v_udfald := pg_temp.forsoeg('43430000-0000-4000-8000-00000000000c',
                $s$select count(*) from public.profiles$s$);
  if v_udfald <> 'ok' then raise exception '2a) fixturen har ikke den brede flade (%)', v_udfald; end if;

  -- Carl er hverken medlem eller deltager og kan alligevel se HELE
  -- deltagerlisten. Det er hullet, med et tal på.
  v_n := pg_temp.svar('43430000-0000-4000-8000-00000000000c',
           $s$select count(*)::text from public.competition_participants$s$);
  if v_n <> '2' then
    raise exception '2a) en fremmed så % deltager-rækker, ikke 2 — fixturen måler ikke det, den tror', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Migrering, trin 1
-- ---------------------------------------------------------------------------
\ir ../read_scope_functions.sql

-- ===========================================================================
-- 1. Formen på de tre funktioner
-- ===========================================================================
do $$
declare r record; v_fundet int := 0;
begin
  for r in select proname, prosecdef, provolatile from pg_proc
            where pronamespace = 'public'::regnamespace
              and proname in ('my_profile', 'admin_profiles', 'is_competition_visible')
  loop
    v_fundet := v_fundet + 1;
    if not r.prosecdef then raise exception '1) %() er ikke security definer', r.proname; end if;
    -- `stable` og ikke `volatile`: funktionerne kaldes pr. RÆKKE i en policy,
    -- og en volatile funktion ville hverken kunne foldes eller planlægges væk.
    if r.provolatile <> 's' then raise exception '1) %() er ikke stable (%)', r.proname, r.provolatile; end if;
  end loop;
  if v_fundet <> 3 then raise exception '1) fandt % af de tre funktioner', v_fundet; end if;
end $$;

-- `anon`s EXECUTE kommer ikke af sig selv væk: PostgreSQL giver PUBLIC — og
-- dermed `anon` — EXECUTE på hver ny funktion, og den default kan ikke lukkes
-- ved kilden (`G96`). Falder denne påstand, er en `revoke`-linje røget.
do $$
declare r text;
begin
  foreach r in array array['public.my_profile()', 'public.admin_profiles()',
                           'public.is_competition_visible(uuid)']
  loop
    if has_function_privilege('anon', r, 'EXECUTE') then
      raise exception '1) anon kan kalde % — revoke-linjen mangler i migreringen', r;
    end if;
    if not has_function_privilege('authenticated', r, 'EXECUTE') then
      raise exception '1) authenticated kan IKKE kalde % — grant-linjen mangler', r;
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 2b. Mellemtilstanden: den GAMLE klient virker stadig efter #59
-- ===========================================================================
-- Det er dét, der gør #59 sikker at køre før frontend-mergen, og det er samme
-- påstand som `create_group.sql`s afsnit 6a og `invite_lookup.sql`s måling
-- mellem #52 og #53.
do $$
declare v_udfald text;
begin
  v_udfald := pg_temp.forsoeg('43430000-0000-4000-8000-00000000000a',
                $s$select id, display_name, is_admin, last_seen_at from public.profiles$s$);
  if v_udfald <> 'ok' then
    raise exception '2b) #59 brød den gamle klients profil-opslag (%) — så var den ikke sikker at køre før mergen', v_udfald;
  end if;

  -- …og den NYE klients veje virker allerede i samme tilstand. Begge kan altså
  -- køre mod databasen, og udrulningen kan ske i ro.
  if pg_temp.svar('43430000-0000-4000-8000-00000000000a',
       $s$select (public.my_profile()->>'display_name')$s$) is distinct from 'Anna' then
    raise exception '2b) my_profile() virkede ikke i mellemtilstanden';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Migrering, trin 2
-- ---------------------------------------------------------------------------
\ir ../read_scope_narrow.sql
-- #69 hører med til trin 2 og ikke til et trin for sig: den retter en fejl,
-- `#60` indførte i samme policy, og en base med #60 uden #69 er en tilstand,
-- ingen skal køre i — oprettelse af en konkurrence er umulig dér (`G130`).
-- Påstand 7e er skrevet til at fejle præcis i den tilstand.
\ir ../competitions_returning_fix.sql

-- ===========================================================================
-- 3. `profiles`' læseflade er smal
-- ===========================================================================
do $$
declare v_kolonner text;
begin
  select string_agg(column_name, ', ' order by column_name) into v_kolonner
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'profiles'
     and grantee = 'authenticated' and privilege_type = 'SELECT';
  if v_kolonner is distinct from 'anonymized_at, display_name, id' then
    raise exception '3) authenticated må læse disse kolonner på profiles: % — forventede id, display_name og anonymized_at',
      coalesce(v_kolonner, 'ingen');
  end if;

  -- Den brede rettighed er VÆK og ikke bare suppleret. `grant select (…)` oven
  -- på en tabel-bred `grant select` ville se ens ud i listen ovenfor og måle
  -- ingenting.
  if has_table_privilege('authenticated', 'public.profiles', 'SELECT') then
    raise exception '3) authenticated har stadig tabel-bred SELECT på profiles — revoke-linjen bider ikke';
  end if;
end $$;

do $$
declare v_udfald text;
begin
  v_udfald := pg_temp.forsoeg('43430000-0000-4000-8000-00000000000a',
                $s$select * from public.profiles$s$);
  if v_udfald <> 'afvist:42501' then
    raise exception '3) `select *` på profiles blev ikke afvist (%)', v_udfald;
  end if;

  -- Én kolonne ad gangen, så en fremtidig fejl peger på den rigtige.
  foreach v_udfald in array array['is_admin', 'last_seen_at', 'created_at', 'display_name_changed_at']
  loop
    if pg_temp.forsoeg('43430000-0000-4000-8000-00000000000a',
         format($s$select %I from public.profiles$s$, v_udfald)) <> 'afvist:42501' then
      raise exception '3) kolonnen %s er stadig læsbar for authenticated', v_udfald;
    end if;
  end loop;

  -- ORDER BY er også en læsning. Det er dét, der flyttede sorteringen i
  -- Admin → Brugere ind i `admin_profiles()`.
  if pg_temp.forsoeg('43430000-0000-4000-8000-00000000000a',
       $s$select id from public.profiles order by created_at desc$s$) <> 'afvist:42501' then
    raise exception '3) ORDER BY på en lukket kolonne blev ikke afvist';
  end if;
end $$;

-- ===========================================================================
-- 4. 🔴 STILLINGEN ER IKKE TØMT
-- ===========================================================================
-- Den påstand, der skiller `A43`s svar fra det, rækken oprindeligt foreslog.
-- Havde vi valgt en RÆKKE-policy — "kun de brugere, du deler en liga med" —
-- ville Carl, som deler intet med nogen, se NUL navne, og Rating-fanen,
-- Månedsligaen og Championship (`scope = 'ALL'`) ville stå tomme for ham.
--
-- Carl er fremmed for alt i fixturen. Han skal stadig kunne se alle fire navne.
do $$
declare v_n text; v_navn text;
begin
  v_n := pg_temp.svar('43430000-0000-4000-8000-00000000000c',
           $s$select count(*)::text from public.profiles$s$);
  if v_n <> '4' then
    raise exception '4) en fremmed ser % navne, ikke 4 — stillingerne er tømt, og det er præcis den fejl, kolonne-grant''en findes for at undgå', v_n;
  end if;

  -- Og det, stillingen faktisk henter (`PROFILE_SELECT`), går igennem.
  v_navn := pg_temp.svar('43430000-0000-4000-8000-00000000000c',
              $s$select display_name from public.profiles
                  where id = '43430000-0000-4000-8000-00000000000d'$s$);
  if v_navn is distinct from 'Didde' then
    raise exception '4) PROFILE_SELECT-opslaget svarede % og ikke Didde', coalesce(v_navn, 'null');
  end if;

  -- `read profiles`-policyen er URØRT. Står den anderledes, er halvdelen af
  -- rækkens svar rullet tilbage uden at nogen påstand ovenfor ville falde.
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'profiles'
                    and policyname = 'read profiles'
                    and qual = '(auth.role() = ''authenticated''::text)') then
    raise exception '4) `read profiles` er ændret — rækkerne skulle netop blive';
  end if;
end $$;

-- ===========================================================================
-- 5. 🔴 RETURNING ER OGSÅ EN LÆSNING
-- ===========================================================================
-- PostgREST sender `Prefer: return=representation` på hver skrivning, og uden
-- et `select=` i URL'en returnerer den alle kolonner. Uden denne påstand ville
-- fejlen først vise sig som "kan ikke skifte brugernavn" hos en rigtig bruger.
do $$
declare v_udfald text;
begin
  -- `sikrProfil()`s upsert, som den så ud FØR rettelsen.
  v_udfald := pg_temp.forsoeg('43430000-0000-4000-8000-00000000000a',
                $s$insert into public.profiles (id, display_name)
                   values ('43430000-0000-4000-8000-00000000000a', 'Anna')
                   on conflict (id) do update set id = excluded.id, display_name = excluded.display_name
                   returning *$s$);
  if v_udfald <> 'afvist:42501' then
    raise exception '5) en upsert med `returning *` slap igennem (%) — så måler påstanden ikke fælden', v_udfald;
  end if;

  -- …og som den ser ud EFTER. Det er den ene linje, klientrettelsen består i.
  v_udfald := pg_temp.forsoeg('43430000-0000-4000-8000-00000000000a',
                $s$insert into public.profiles (id, display_name)
                   values ('43430000-0000-4000-8000-00000000000a', 'Anna')
                   on conflict (id) do update set id = excluded.id, display_name = excluded.display_name
                   returning id$s$);
  if v_udfald <> 'ok' then
    raise exception '5) en upsert med `returning id` blev afvist (%) — så kan ingen ny bruger få en profil', v_udfald;
  end if;

  -- Navneskiftet (`changeDisplayName`), begge veje.
  if pg_temp.forsoeg('43430000-0000-4000-8000-00000000000a',
       $s$update public.profiles set display_name = 'Annabel'
           where id = '43430000-0000-4000-8000-00000000000a' returning *$s$) <> 'afvist:42501' then
    raise exception '5) et navneskift med `returning *` slap igennem';
  end if;
  if pg_temp.forsoeg('43430000-0000-4000-8000-00000000000a',
       $s$update public.profiles set display_name = 'Anna'
           where id = '43430000-0000-4000-8000-00000000000a' returning id, display_name$s$) <> 'ok' then
    raise exception '5) et navneskift med et smalt `returning` blev afvist — så kan ingen skifte brugernavn';
  end if;
end $$;

-- ===========================================================================
-- 6. `my_profile()` og `admin_profiles()`
-- ===========================================================================
do $$
declare v jsonb; v_udfald text; v_n text;
begin
  -- Egen række, hele vejen rundt — `is_admin` er dét, admin-fanen står på.
  v := pg_temp.svar('43430000-0000-4000-8000-00000000000d',
         $s$select public.my_profile()::text$s$)::jsonb;
  if v->>'display_name' is distinct from 'Didde' then raise exception '6) my_profile() gav %', v; end if;
  if (v->>'is_admin')::boolean is not true then
    raise exception '6) my_profile() bar ikke is_admin — så mister administratoren sin fane';
  end if;
  if v ? 'last_seen_at' is not true then
    raise exception '6) my_profile() bar ikke hele rækken (to_jsonb er blevet til en nøgleliste)';
  end if;

  -- Uden session: ingen række, ingen fejl. Filtret ER `auth.uid()`.
  if pg_temp.svar(null, $s$select coalesce(public.my_profile()::text, 'null')$s$) <> 'null' then
    raise exception '6) my_profile() svarede noget uden en session';
  end if;

  -- Funktionen kan ikke pege på en anden: den har nul parametre.
  if (select pronargs from pg_proc
       where pronamespace = 'public'::regnamespace and proname = 'my_profile') <> 0 then
    raise exception '6) my_profile() har parametre — der må ikke være et bruger-id at sende med';
  end if;

  -- Admin-listen: vagten afviser en almindelig bruger …
  v_udfald := pg_temp.forsoeg('43430000-0000-4000-8000-00000000000a',
                $s$select * from public.admin_profiles()$s$);
  if v_udfald <> 'afvist:42501' then
    raise exception '6) admin_profiles() slap en ikke-admin igennem (%)', v_udfald;
  end if;

  -- … og svarer administratoren med alle fire, nyeste først.
  v_n := pg_temp.svar('43430000-0000-4000-8000-00000000000d',
           $s$select count(*)::text from public.admin_profiles()$s$);
  if v_n <> '4' then raise exception '6) admin_profiles() gav % rækker, ikke 4', v_n; end if;
  if pg_temp.svar('43430000-0000-4000-8000-00000000000d',
       $s$select (select is_admin::text from public.admin_profiles()
                   where display_name = 'Didde')$s$) <> 'true' then
    raise exception '6) admin_profiles() bar ikke is_admin — så mister Admin → Brugere sin Admin-mærkat';
  end if;
end $$;

-- ===========================================================================
-- 6b. 🔴 DE TRE POLICIES, DER LÆSER `is_admin`
-- ===========================================================================
-- **Den påstand, der ikke stod i rækken, og som ville have brækket Admin →
-- Drift i produktionen.** En RLS-policys udtryk evalueres med den KALDENDE
-- rolles privilegier, og `job_runs_read_admin`, `matches_update_admin` og
-- `matches_insert_admin` slog alle op i `profiles.is_admin`. Fra det sekund
-- afsnit 1 i `#60` fjerner kolonnen fra læsefladen, holder de tre op med at
-- FILTRERE og begynder at FEJLE — `permission denied for table profiles`,
-- altså 42501 og ikke nul rækker.
--
-- Fundet ved at køre `sql/tests/write_surface.sql` mod et skema, hvor `#60`
-- allerede var kørt (§13-reglen om at efterprøve fra BEGGE sider af dumpet).
-- Rettelsen er `is_platform_admin()`, og påstanden her måler begge retninger.
do $$
declare v_udfald text; v_n text;
begin
  -- 6b1. Administratoren kan læse Drift. Uden `is_platform_admin()` er dette
  --      en 42501 — for ALLE, også for hende.
  -- Først UDFALDET og så tallet, i den rækkefølge. Uden `forsoeg` ville en
  -- policy, der ikke kan evalueres, vælte kørslen med et bart
  -- `permission denied for table profiles` — sandt, men uden en anelse om, at
  -- det er Admin → Drift, der er brækket.
  v_udfald := pg_temp.forsoeg('43430000-0000-4000-8000-00000000000d',
                $s$select count(*) from public.job_runs$s$);
  if v_udfald <> 'ok' then
    raise exception '6b1) en administrator kan ikke læse job_runs (%) — policyen LÆSER profiles.is_admin og fejler nu i stedet for at filtrere. Admin → Drift er brækket. Rettelsen er is_platform_admin() i #59.', v_udfald;
  end if;

  -- Filtreret på jobnavnet: matches-triggeren skriver selv en `story-engine`-række,
  -- så et bart `count(*)` ville måle Story Engine og ikke policyen.
  v_n := pg_temp.svar('43430000-0000-4000-8000-00000000000d',
           $s$select count(*)::text from public.job_runs where job = 'sync-matches'$s$);
  if v_n <> '1' then
    raise exception '6b1) en administrator så % kørsler i job_runs, ikke 1', coalesce(v_n, 'en fejl');
  end if;

  -- 6b2. …og en almindelig bruger ser NUL. Det er forskellen på en policy, der
  --      filtrerer, og en, der fejler: begge "virker ikke", kun den ene er rigtig.
  v_n := pg_temp.svar('43430000-0000-4000-8000-00000000000a',
           $s$select count(*)::text from public.job_runs$s$);
  if v_n <> '0' then
    raise exception '6b2) en almindelig bruger så % kørsler i job_runs, ikke 0', v_n;
  end if;

  -- 6b3. Ingen policy læser `profiles` direkte længere. Det er den generelle
  --      form af 6b1: en fjerde policy, der gør det, ville fejle på samme måde.
  select string_agg(tablename || '.' || policyname, ', ' order by policyname) into v_udfald
    from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') || coalesce(with_check, '')) like '%profiles%';
  if v_udfald is not null then
    raise exception '6b3) disse policies slår stadig direkte op i profiles og vil fejle med 42501: %', v_udfald;
  end if;

  -- 6b4. Vagten er ikke blevet en formalitet undervejs: en ikke-admin må ikke
  --      kunne skrive et resultat — og forskellen på 42501 og nul rækker måles
  --      HER frem for at blive antaget. Fixturen har én kamp med `home_score = 1`,
  --      så begge halvdele af påstanden har noget at være uenige om.
  v_udfald := pg_temp.forsoeg('43430000-0000-4000-8000-00000000000a',
                $s$update public.matches set home_score = 9
                    where id = '43430000-0000-4000-8000-0000000000e5'$s$);
  if v_udfald <> 'ok' then
    raise exception '6b4) matches-opdateringen fejlede (%) — den skal give NUL rækker, ikke en fejl', v_udfald;
  end if;
  select home_score::text into v_n from public.matches
   where id = '43430000-0000-4000-8000-0000000000e5';
  if v_n <> '1' then
    raise exception '6b4) en ikke-admin skrev et resultat (home_score = %) — vagten er væk', v_n;
  end if;

  -- 6b5. …og administratoren kan. Uden denne halvdel ville 6b4 også være grøn,
  --      hvis policyen afviste ALLE.
  v_udfald := pg_temp.forsoeg('43430000-0000-4000-8000-00000000000d',
                $s$update public.matches set home_score = 2
                    where id = '43430000-0000-4000-8000-0000000000e5'$s$);
  if v_udfald <> 'ok' then
    raise exception '6b5) administratorens opdatering blev afvist (%)', v_udfald;
  end if;
  select home_score::text into v_n from public.matches
   where id = '43430000-0000-4000-8000-0000000000e5';
  if v_n <> '2' then
    raise exception '6b5) administratoren kunne ikke skrive et resultat (home_score = %)', v_n;
  end if;
end $$;

-- ===========================================================================
-- 7. Deltagerpolicyen som en matrix
-- ===========================================================================
-- Fire slags brugere × to slags konkurrencer. Tallet er, hvor mange
-- deltager-rækker brugeren kan se i den konkurrence.
--
--   KOMP_L (i ligaen):  Anna deltager · Bo er medlem uden deltagelse ·
--                       Carl er fremmed · Didde er admin, men ikke medlem
--   KOMP_S (liga-løs):  Anna er opretter OG deltager · resten er fremmede
--
-- Bo skal kunne se deltagerne i en konkurrence, han ikke er med i: det er
-- ligasidens "Deltag"-knap med et deltagerantal ved siden af, og uden den ville
-- `loadGroupDetail` vise 0 på hvert kort.
do $$
declare
  r record;
  v_faktisk text;
begin
  for r in
    select * from (values
      ('43430000-0000-4000-8000-00000000000a', 'Anna',  '43430000-0000-4000-8000-0000000000c1', 'KOMP_L', '1'),
      ('43430000-0000-4000-8000-00000000000b', 'Bo',    '43430000-0000-4000-8000-0000000000c1', 'KOMP_L', '1'),
      ('43430000-0000-4000-8000-00000000000c', 'Carl',  '43430000-0000-4000-8000-0000000000c1', 'KOMP_L', '0'),
      ('43430000-0000-4000-8000-00000000000d', 'Didde', '43430000-0000-4000-8000-0000000000c1', 'KOMP_L', '0'),
      ('43430000-0000-4000-8000-00000000000a', 'Anna',  '43430000-0000-4000-8000-0000000000c2', 'KOMP_S', '1'),
      ('43430000-0000-4000-8000-00000000000b', 'Bo',    '43430000-0000-4000-8000-0000000000c2', 'KOMP_S', '0'),
      ('43430000-0000-4000-8000-00000000000c', 'Carl',  '43430000-0000-4000-8000-0000000000c2', 'KOMP_S', '0'),
      ('43430000-0000-4000-8000-00000000000d', 'Didde', '43430000-0000-4000-8000-0000000000c2', 'KOMP_S', '0')
    ) as t(uid, navn, cid, komp, ventet)
  loop
    v_faktisk := pg_temp.svar(r.uid::uuid, format(
      $s$select count(*)::text from public.competition_participants where competition_id = %L$s$, r.cid));
    if v_faktisk is distinct from r.ventet then
      raise exception '7) % så % deltager-rækker i %, ventede %', r.navn, v_faktisk, r.komp, r.ventet;
    end if;

    -- 9) Samme matrix måler policy-omskrivningen: `is_competition_visible()`
    --    skal svare præcis som #53's inline-prædikat. Er de to uenige, er #60
    --    ikke det no-op, filen påstår.
    --    Prædikatet er ordret #53's, men med brugerens id skrevet ind frem for
    --    `auth.uid()`: `authenticated` har ikke USAGE på skemaet `auth` i
    --    testharnessen, og et direkte kald ville måle harnessen og ikke reglen.
    --    Sammenligningen er den samme — det er `is_competition_visible()`, der
    --    bruger `auth.uid()`, og den kører som ejer.
    v_faktisk := pg_temp.svar(r.uid::uuid, format(
      $s$select (public.is_competition_visible(%L)
                 = exists (select 1 from public.competitions c
                            where c.id = %L
                              and (c.created_by = %L
                                   or (c.group_id is not null and public.is_group_member(c.group_id))
                                   or exists (select 1 from public.competition_participants cp
                                               where cp.competition_id = c.id and cp.user_id = %L))))::text$s$,
      r.cid, r.cid, r.uid, r.uid));
    if v_faktisk is distinct from 'true' then
      raise exception '9) is_competition_visible() er uenig med #53''s prædikat for % i %', r.navn, r.komp;
    end if;
  end loop;
end $$;

-- De SEKS skrivninger, der læser deres egen række tilbage. Alle sender
-- `Prefer: return=representation`, så SELECT-policyen anvendes på den rørte
-- række — fælden fra 11. august 2026 (`#55`), kendt på forhånd her.
--
-- 🔴 LISTEN VAR FIRE OG SKULLE HAVE VÆRET SEKS (`G130`, 17. august 2026). Den,
-- der manglede, var oprettelsen af selve konkurrencen, og prisen var, at `#60`
-- kunne gøre den umulig i produktionen uden at én påstand blev rød. En liste
-- over "alle skrivninger, der læser sig selv tilbage" er kun værd at have, hvis
-- den er fuldstændig — se 7e.
do $$
declare v_udfald text;
begin
  -- 7a. Tilmelding: Bo melder sig til ligaens konkurrence.
  v_udfald := pg_temp.forsoeg('43430000-0000-4000-8000-00000000000b',
                $s$insert into public.competition_participants (competition_id, user_id)
                   values ('43430000-0000-4000-8000-0000000000c1',
                           '43430000-0000-4000-8000-00000000000b') returning *$s$);
  if v_udfald <> 'ok' then
    raise exception '7a) tilmelding med `returning *` blev afvist (%) — leddet `user_id = auth.uid()` mangler i policyen', v_udfald;
  end if;

  -- 7b. Arkivering: Bo skjuler konkurrencen for sig selv.
  v_udfald := pg_temp.forsoeg('43430000-0000-4000-8000-00000000000b',
                $s$update public.competition_participants set hidden = true
                    where competition_id = '43430000-0000-4000-8000-0000000000c1'
                      and user_id = '43430000-0000-4000-8000-00000000000b' returning *$s$);
  if v_udfald <> 'ok' then raise exception '7b) arkivering blev afvist (%)', v_udfald; end if;

  -- 7c. Framelding: Bo forlader igen.
  v_udfald := pg_temp.forsoeg('43430000-0000-4000-8000-00000000000b',
                $s$delete from public.competition_participants
                    where competition_id = '43430000-0000-4000-8000-0000000000c1'
                      and user_id = '43430000-0000-4000-8000-00000000000b' returning *$s$);
  if v_udfald <> 'ok' then raise exception '7c) framelding blev afvist (%)', v_udfald; end if;

  -- 7d. 🔴 Liga-admin fjerner en ANDEN deltager. Det er den ene skrivning, hvor
  --     `user_id = auth.uid()` IKKE bærer læsningen tilbage — den skal gennem
  --     `is_competition_visible()`, og det virker, fordi admin er ligamedlem.
  insert into public.competition_participants (competition_id, user_id)
  values ('43430000-0000-4000-8000-0000000000c1', '43430000-0000-4000-8000-00000000000b');
  v_udfald := pg_temp.forsoeg('43430000-0000-4000-8000-00000000000a',
                $s$delete from public.competition_participants
                    where competition_id = '43430000-0000-4000-8000-0000000000c1'
                      and user_id = '43430000-0000-4000-8000-00000000000b' returning *$s$);
  if v_udfald <> 'ok' then
    raise exception '7d) liga-admins fjernelse af en anden deltager blev afvist (%) — RETURNING kunne ikke læse den slettede række', v_udfald;
  end if;
  if exists (select 1 from public.competition_participants
              where competition_id = '43430000-0000-4000-8000-0000000000c1'
                and user_id = '43430000-0000-4000-8000-00000000000b') then
    raise exception '7d) rækken blev ikke slettet — udfaldet `ok` kom fra nul rørte rækker';
  end if;

  -- 7e. 🔴 DEN FEMTE SKRIVNING, OG DEN MANGLEDE (`G130`, 17. august 2026).
  --     Overskriften ovenfor sagde "de FIRE skrivninger", og det var netop den,
  --     der ikke stod på listen: oprettelsen af selve konkurrencen. Følgen var,
  --     at `#60` kunne gøre det umuligt at oprette en konkurrence — for hver
  --     bruger, i produktionen, fra 12. august — uden at én påstand blev rød.
  --
  --     Fælden er den samme som 7a's, men et led værre: `competitions_select_
  --     involved` kalder `is_competition_visible()`, som slår rækken op i
  --     `competitions` SELV. Ved `INSERT … RETURNING` findes den række endnu
  --     ikke i funktionens snapshot, så den svarer `false`, og hele skrivningen
  --     afvises med `42501`. Leddet `created_by = auth.uid()` i policyen er dét,
  --     der redder den: det kan evalueres direkte på den nye række.
  --
  --     Testen er efterprøvet ved at fjerne leddet igen og se den fejle.
  v_udfald := pg_temp.forsoeg('43430000-0000-4000-8000-00000000000a',
                $s$insert into public.competitions (id, name, mode, created_by, group_id)
                   values ('43430000-0000-4000-8000-0000000000c9', 'Ny konkurrence', 'random',
                           '43430000-0000-4000-8000-00000000000a',
                           '43430000-0000-4000-8000-000000000f01') returning *$s$);
  if v_udfald <> 'ok' then
    raise exception '7e) oprettelse med `returning *` blev afvist (%) — leddet `created_by = auth.uid()` mangler i competitions_select_involved', v_udfald;
  end if;
  if not exists (select 1 from public.competitions
                  where id = '43430000-0000-4000-8000-0000000000c9') then
    raise exception '7e) rækken blev ikke skrevet — udfaldet `ok` kom fra ingenting';
  end if;

  -- 7f. MODPRØVEN, og uden den er 7e opfyldt af en policy, der slap alt igennem.
  --     Insert-checket `created_by = auth.uid()` skal stadig afvise en række,
  --     der udgiver sig for at være en andens.
  v_udfald := pg_temp.forsoeg('43430000-0000-4000-8000-00000000000a',
                $s$insert into public.competitions (id, name, mode, created_by, group_id)
                   values ('43430000-0000-4000-8000-0000000000ca', 'Paa andres vegne', 'random',
                           '43430000-0000-4000-8000-00000000000b',
                           '43430000-0000-4000-8000-000000000f01') returning *$s$);
  if v_udfald <> 'afvist:42501' then
    raise exception '7f) en konkurrence oprettet i en ANDENS navn slap igennem (%) — insert-checket er væk', v_udfald;
  end if;
end $$;

-- ===========================================================================
-- 8. Ingen rekursion — og den naive policy ved siden af
-- ===========================================================================
-- Rekursionen bliver ikke ved deltagerlisten: den slukker for `competitions`
-- OGSÅ. Symptomet ligner derfor ikke sin årsag, og det er hele grunden til, at
-- den negative kontrol står her frem for i en kommentar.
do $$
declare v_udfald text;
begin
  -- 8a. Sådan som #60 skrev det.
  v_udfald := pg_temp.forsoeg('43430000-0000-4000-8000-00000000000a',
                $s$select count(*) from public.competition_participants$s$);
  if v_udfald <> 'ok' then raise exception '8a) deltagerlisten kan ikke læses (%)', v_udfald; end if;
  v_udfald := pg_temp.forsoeg('43430000-0000-4000-8000-00000000000a',
                $s$select count(*) from public.competitions$s$);
  if v_udfald <> 'ok' then raise exception '8a) competitions kan ikke læses (%)', v_udfald; end if;
end $$;

-- 8b. NEGATIV KONTROL: de to policies, der peger på hinanden.
--
-- ⚠️ **Kontrollen skal sætte BEGGE sider tilbage, og det er selve pointen.**
-- Første udgave af dette afsnit installerede kun den naive deltagerpolicy og
-- forventede `42P17`. Den fik `ok` — fordi `#60` også har flyttet
-- `competitions`' prædikat ind i `is_competition_visible()`, og en
-- `security definer`-funktion bryder cyklussen fra DEN side. Rekursionen er en
-- egenskab ved PARRET og ikke ved den ene policy, så kontrollen måler kun
-- noget, hvis begge sider står, som de gjorde før.
--
-- Det er samtidig svaret på, hvorfor `#60` rører `competitions`: reglen står ét
-- sted, og cyklussen er brudt to gange frem for én.
drop policy if exists competition_participants_select_visible on public.competition_participants;
create policy cp_naiv on public.competition_participants
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.competitions c
                where c.id = competition_participants.competition_id
                  and c.created_by = auth.uid())
  );

-- #53's prædikat, ordret og skrevet i hånden (§13-reglen: ikke læst af dumpet).
drop policy if exists competitions_select_involved on public.competitions;
create policy competitions_select_involved on public.competitions
  for select to authenticated
  using (
    created_by = auth.uid()
    or (group_id is not null and public.is_group_member(group_id))
    or exists (select 1 from public.competition_participants cp
                where cp.competition_id = competitions.id and cp.user_id = auth.uid())
  );

do $$
declare v_udfald text;
begin
  v_udfald := pg_temp.forsoeg('43430000-0000-4000-8000-00000000000a',
                $s$select count(*) from public.competition_participants$s$);
  if v_udfald <> 'afvist:42P17' then
    raise exception '8b) de to naive policies udløste ikke rekursionen (%) — så beviser 8a ingenting', v_udfald;
  end if;
  v_udfald := pg_temp.forsoeg('43430000-0000-4000-8000-00000000000a',
                $s$select count(*) from public.competitions$s$);
  if v_udfald <> 'afvist:42P17' then
    raise exception '8b) rekursionen ramte ikke OGSÅ competitions (%) — den halvdel af advarslen holder ikke', v_udfald;
  end if;
end $$;

drop policy cp_naiv on public.competition_participants;

-- ===========================================================================
-- 10. Idempotens: begge filer kan køres to gange
-- ===========================================================================
\ir ../read_scope_functions.sql
\ir ../read_scope_narrow.sql
\ir ../competitions_returning_fix.sql

do $$
declare v_n text;
begin
  -- Og tilstanden er den samme bagefter — ikke bare "kørslen fejlede ikke".
  if has_table_privilege('authenticated', 'public.profiles', 'SELECT') then
    raise exception '10) anden kørsel gav den brede SELECT tilbage';
  end if;
  v_n := pg_temp.svar('43430000-0000-4000-8000-00000000000b',
           $s$select count(*)::text from public.competition_participants
               where competition_id = '43430000-0000-4000-8000-0000000000c1'$s$);
  if v_n <> '1' then raise exception '10) matrixen flyttede sig ved anden kørsel (% for Bo)', v_n; end if;
  if pg_temp.svar('43430000-0000-4000-8000-00000000000a',
       $s$select (public.my_profile()->>'display_name')$s$) is distinct from 'Anna' then
    raise exception '10) my_profile() brød ved anden kørsel';
  end if;
end $$;

select 'read_scope: OK' as result;
