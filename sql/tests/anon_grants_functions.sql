-- Test af `sql/anon_grants_functions.sql` (G96): `anon` mister FUNKTIONERNE,
-- og kilden lukkes — mens de to, der skal være åbne, bliver det.
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR DET RIGTIGE SKEMA. Migreringen rører hver eneste funktion i `public`,
-- og halvdelen af påstandene er, at den IKKE rørte noget: at `authenticated` og
-- `service_role` har præcis den adgang bagefter, de havde før. Det kan kun måles
-- et sted, hvor alle 54 funktioner findes (`G91`).
--
-- HVAD DEN BEVISER
--   1. Udgangspunktet er ægte: `anon` kan nå funktionerne, før migreringen
--      kører — både gennem sin egen grant og gennem PUBLIC.
--   2. Bagefter kan `anon` nøjagtig TO: `username_available()` og
--      `invite_preview()`. Hverken flere eller færre.
--   3. PUBLIC har intet tilbage i `public`. Det er den halvdel, backloggens
--      `G96` ikke nævnte, og uden den ville `anon` stadig komme ind.
--   4. **`authenticated` og `service_role` er urørte** — målt som mængder af
--      signaturer før og efter, ikke som et antal. Et tal kan være ens, mens
--      indholdet er byttet om.
--   5. En funktion oprettet EFTER migreringen er lukket for `anon` og åben for
--      de to andre. Det er halvdelen, der betyder noget på sigt: bredden var en
--      REGEL og ikke en liste, og en ny funktion skal være lukket, indtil nogen
--      aktivt åbner den.
--   6. Adfærd, ikke kun ACL'er: `anon` kan stadig oprette en konto og læse
--      invitationens etiket, og bliver nu AFVIST på `invite_lookup()` og
--      `accept_invite()` — de to, hvis `auth.uid()`-vagt indtil nu var det
--      eneste, der holdt. Dobbeltsikringen er selve leverancen.
--   7. Den varme sti holder: en indlogget bruger kan stadig læse sin liga,
--      hvilket kræver EXECUTE på `is_group_member()` fra en RLS-policy.
--
-- ⚠️ **PÅSTANDENE SPØRGER `has_function_privilege` OG IKKE EN GRANT-TABEL.**
-- PUBLIC giver adgang uden at nævne `anon` nogen steder, så en kontrol på
-- `information_schema.role_routine_grants` ville melde "lukket" om en funktion,
-- enhver kan kalde. Samme fælde som sekvenserne i `#43` (`information_schema`
-- rapporterer kun USAGE), bare med en anden mekanisme.
--
-- ⚠️ **TESTEN EJER SIN EGEN FØR-TILSTAND** (`G94`-reglen, `DOCUMENTATION.md`
-- §13). `sql/schema.sql` er et øjebliksbillede af produktionen, og i det
-- øjeblik migreringen er kørt DÉR, bærer dumpet efter-tilstanden. Hentede
-- testen sin før-tilstand fra dumpet, ville påstand 1 blive rød af, at arbejdet
-- lykkedes — præcis det, der skete for `invite_lookup.sql` og
-- `competition_matches_read.sql` 12. august 2026. Blokken nedenfor genskaber
-- derfor Supabases udgangspunkt eksplicit.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d g96 -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d g96 -v ON_ERROR_STOP=1 -b -f sql/tests/anon_grants_functions.sql

\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------------------
-- Fixture — kun det, de tre adfærds-påstande skal bruge
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('96960000-0000-4000-8000-000000000001', 'ejer@test.local');
insert into public.profiles (id, display_name) values
  ('96960000-0000-4000-8000-000000000001', 'Ejer');
insert into public.groups (id, name, created_by, invite_code) values
  ('96960000-0000-4000-8000-0000000000a1', 'Fodboldkammeraterne',
   '96960000-0000-4000-8000-000000000001', 'g96kode');
insert into public.group_members (group_id, user_id, role) values
  ('96960000-0000-4000-8000-0000000000a1', '96960000-0000-4000-8000-000000000001', 'admin');

-- Kald noget som en bestemt rolle, og svar `ok`, `afvist` eller fejlteksten.
-- `afvist` er reserveret til 42501 (insufficient_privilege), som er dét, en
-- lukket funktion svarer — alt andet ville sløre forskellen mellem "ingen
-- adgang" og "funktionen er i stykker".
create function pg_temp.som(p_rolle text, p_sql text) returns text
language plpgsql as $$
begin
  begin
    execute format('set local role %I', p_rolle);
    execute p_sql;
    reset role;
    return 'ok';
  exception when insufficient_privilege then
    reset role; return 'afvist';
  when others then
    reset role; return sqlstate || ': ' || sqlerrm;
  end;
end $$;

-- Mængden af funktioner i `public`, en rolle kan eksekvere.
create function pg_temp.kan(p_rolle text) returns text[]
language sql stable as $$
  -- Signaturen skrives UDEN skema: `regprocedure` tager `public.` med, når
  -- skemaet ikke står i sessionens `search_path`, og udelader det, når det gør
  -- — altså to forskellige tekster for den samme funktion. En påstand, der
  -- sammenligner strenge, må ikke afhænge af, hvem der kører den.
  select coalesce(array_agg(sig order by sig), '{}')
    from (select regexp_replace(p.oid::regprocedure::text, '^public\.', '') as sig
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'
             and has_function_privilege(p_rolle, p.oid, 'EXECUTE')) s;
$$;

create table pg_temp.foer (rolle text primary key, sigs text[]);

-- ---------------------------------------------------------------------------
-- 1. Genskab Supabases udgangspunkt, og bevis at det ER udgangspunktet
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public grant all on functions to anon;
grant execute on all functions in schema public to anon;

insert into pg_temp.foer
select r, pg_temp.kan(r) from unnest(array['authenticated', 'service_role']) r;

do $$
declare v_egen int; v_public int;
begin
  -- 1a. Rækkens præmis: `anon` kan nå funktioner, den ikke har noget at gøre i.
  if not has_function_privilege('anon', 'public.invite_lookup(text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.accept_invite(text)', 'EXECUTE') then
    raise exception 'fixturen holder ikke: anon skulle KUNNE nå invite_lookup/accept_invite før migreringen';
  end if;

  -- 1b. Og den kan det ad BEGGE veje. Er PUBLIC-tallet nul, måler testen kun
  --     den halvdel, `G96` selv beskrev, og ville ikke fange en migrering, der
  --     glemte PUBLIC.
  select count(*) into v_egen
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and exists (select 1 from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a::text like 'anon=%');
  select count(*) into v_public
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and exists (select 1 from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a::text like '=%');
  if v_egen = 0 then raise exception 'fixturen holder ikke: anon har ingen egne funktions-grants'; end if;
  if v_public = 0 then raise exception 'fixturen holder ikke: PUBLIC har ingen EXECUTE at miste'; end if;
  raise notice 'Før migreringen: anon har egen grant på %, PUBLIC på % funktion(er).', v_egen, v_public;
end $$;

-- En funktion oprettet FØR migreringen er åben for anon — kilden er i brug.
create function public.g96_foer() returns int language sql immutable as $$ select 1 $$;
do $$ begin
  if not has_function_privilege('anon', 'public.g96_foer()', 'EXECUTE') then
    raise exception 'fixturen holder ikke: en ny funktion fik ikke anon-grant af default privileges';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Migreringen
-- ---------------------------------------------------------------------------
\ir ../anon_grants_functions.sql

-- ---------------------------------------------------------------------------
-- 3. Efter: anon kan nøjagtig to — og PUBLIC ingen
-- ---------------------------------------------------------------------------
do $$
declare v_kan text[];
begin
  v_kan := pg_temp.kan('anon');
  if v_kan <> array['invite_preview(text)', 'username_available(text)'] then
    raise exception 'anon kan de forkerte funktioner efter migreringen: %', v_kan;
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and exists (select 1 from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    where a::text like '=%'))
  then
    raise exception 'PUBLIC har stadig EXECUTE på mindst én funktion i public';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. De indloggede roller er urørte — som MÆNGDER, ikke som antal
-- ---------------------------------------------------------------------------
do $$
declare r record; v_nu text[]; v_tabt text[]; v_ny text[];
begin
  for r in select rolle, sigs from pg_temp.foer loop
    v_nu := pg_temp.kan(r.rolle);
    select coalesce(array_agg(s order by s), '{}') into v_tabt
      from unnest(r.sigs) s where s <> all (v_nu);
    select coalesce(array_agg(s order by s), '{}') into v_ny
      from unnest(v_nu) s where s <> all (r.sigs);
    -- `g96_foer()` er testens egen og fandtes ikke, da mængden blev målt.
    v_ny := array_remove(v_ny, 'g96_foer()');
    if array_length(v_tabt, 1) is not null then
      raise exception '% mistede EXECUTE på: %', r.rolle, v_tabt;
    end if;
    if array_length(v_ny, 1) is not null then
      raise exception '% fik EXECUTE på noget nyt: %', r.rolle, v_ny;
    end if;
  end loop;
end $$;

-- Den ene funktion, der viser, at trin 1 ikke er for bredt: `_anonymize_account`
-- tager et bruger-id og har ingen egen `auth.uid()`-vagt, så den er lukket for
-- `authenticated` med vilje (#42). En migrering, der havde skrevet
-- `grant execute on all functions … to authenticated`, ville have åbnet den.
do $$ begin
  if has_function_privilege('authenticated', 'public._anonymize_account(uuid)', 'EXECUTE') then
    raise exception 'authenticated fik EXECUTE på _anonymize_account — trin 1 materialiserede for bredt';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Kilden — og den halvdel af den, der ikke kan lukkes
-- ---------------------------------------------------------------------------
-- Her ligger denne migrerings vigtigste forskel fra #34 og #43. Dér var default
-- privileges det ENESTE, der gav `anon` adgang til en ny tabel eller sekvens, så
-- kilden kunne lukkes helt. En ny FUNKTION får derimod PUBLIC's EXECUTE fra
-- PostgreSQLs indbyggede default (`acldefault('f', ejer)`), og den kan ikke
-- fjernes med `ALTER DEFAULT PRIVILEGES`: posten gemmes som et TILLÆG, de to
-- flettes ved oprettelsen, og fletningen kan kun lægge til.
create function public.g96_efter() returns int language sql immutable as $$ select 1 $$;

do $$ begin
  -- 5a. Det, der KAN lukkes, ER lukket: den nye funktion har ingen egen
  --     anon-post i sin ACL. Uden trin 3 i migreringen ville den have en.
  if exists (select 1 from unnest(coalesce(
               (select proacl from pg_proc where oid = 'public.g96_efter()'::regprocedure),
               acldefault('f', 'postgres'::regrole::oid))) a
              where a::text like 'anon=%') then
    raise exception 'en ny funktion fik sin egen anon-grant — kilden er ikke lukket';
  end if;

  -- 5b. …og den nye funktion er ALLIGEVEL kaldbar af `anon`, fordi PUBLIC's
  --     indbyggede default gælder. **Påstanden er en VAGT OVER EN
  --     FORUDSÆTNING, ikke en accept af en fejl:** den beskriver den grænse,
  --     migreringens hoved bygger sin regel på — at hver ny funktion selv skal
  --     skrive `revoke execute … from public`.
  --
  --     🟢 **Fejler denne linje, er det GODE nyheder.** Så kan PUBLIC-defaulten
  --     lukkes i den PostgreSQL-version, testen kører mod, og så skal
  --     migreringen have sin `alter default privileges … revoke execute on
  --     functions from public` tilbage, og den røde blok i dens hoved skal
  --     omskrives. Efterprøvet mod PostgreSQL 16.13 (12. august 2026).
  if not has_function_privilege('anon', 'public.g96_efter()', 'EXECUTE') then
    raise exception 'PUBLIC-defaulten kan lukkes i denne PostgreSQL — se punkt 5b i testen, migreringen skal opdateres';
  end if;

  if not has_function_privilege('authenticated', 'public.g96_efter()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.g96_efter()', 'EXECUTE') then
    raise exception 'en ny funktion er lukket for authenticated/service_role — defaulten er smalnet for meget';
  end if;
end $$;

-- 5c. **Den påstand, der bærer reglen.** Hele skemaet måles: kan `anon` nå
--     noget ud over de to, er der en funktion, hvis migrering glemte sin
--     `revoke execute … from public`. Det er den vagt, databasen ikke kan
--     stille selv — og den grund, denne test skal blive ved at findes.
--     `g96_efter()` er testens egen og er netop det tilfælde, den skal fange:
--     den fjernes her, så påstanden måler produktionsskemaet og ikke fixturen.
drop function public.g96_efter();

do $$
declare v_kan text[];
begin
  v_kan := pg_temp.kan('anon');
  if v_kan <> array['invite_preview(text)', 'username_available(text)'] then
    raise exception 'en funktion i public er åben for anon ud over de to tilladte: %', v_kan;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Adfærd: de to åbne virker, de to lukkede afviser
-- ---------------------------------------------------------------------------
do $$
declare v text;
begin
  v := pg_temp.som('anon', $s$select public.username_available('et-ledigt-navn')$s$);
  if v <> 'ok' then raise exception 'anon kan ikke længere oprette en konto (%)', v; end if;

  v := pg_temp.som('anon', $s$select public.invite_preview('g96kode')$s$);
  if v <> 'ok' then raise exception 'anon kan ikke længere læse invitationens etiket (%)', v; end if;

  -- Dobbeltsikringen. Indtil nu var `raise exception 'forbidden'` inde i de to
  -- funktioner det ENESTE, der holdt en fremmed ude; nu afviser databasen
  -- allerede kaldet. Bemærk forskellen på de to udfald: `forbidden` er P0001
  -- fra funktionens krop, `afvist` er 42501 fra rettighedssystemet — og det er
  -- kun det sidste, der beviser, at grant'en er væk.
  v := pg_temp.som('anon', $s$select public.invite_lookup('g96kode')$s$);
  if v <> 'afvist' then raise exception 'anon kan stadig kalde invite_lookup (%)', v; end if;

  v := pg_temp.som('anon', $s$select public.accept_invite('g96kode')$s$);
  if v <> 'afvist' then raise exception 'anon kan stadig kalde accept_invite (%)', v; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Den varme sti: policy-hjælperne skal stadig kunne kaldes af en bruger
-- ---------------------------------------------------------------------------
-- `groups_select_member` kalder `is_group_member()`, og et policy-udtryk
-- evalueres SOM DEN KALDENDE ROLLE — mangler EXECUTE, fejler ikke opslaget,
-- men hele liga-oversigten. Det er den dyreste måde, denne migrering kunne gå
-- galt på, og den ville ikke vise sig i en ACL-optælling.
do $$
declare v_n bigint;
begin
  perform set_config('test.uid', '96960000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  select count(*) into v_n from public.groups;
  reset role;
  if v_n <> 1 then
    raise exception 'et medlem kunne ikke længere læse sin liga (fik % rækker)', v_n;
  end if;
end $$;

do $$
declare r record;
begin
  for r in select unnest(array[
      'public.is_group_member(uuid)', 'public.is_group_admin(uuid)',
      'public.is_group_creator(uuid)', 'public.match_locked(timestamptz, boolean)',
      'public.match_lock_at(timestamptz, boolean)']) as sig
  loop
    if not has_function_privilege('authenticated', r.sig, 'EXECUTE') then
      raise exception 'authenticated mistede EXECUTE på policy-hjælperen %', r.sig;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Idempotens: en anden kørsel mod den tilstand, filen selv efterlader
-- ---------------------------------------------------------------------------
-- Reglen fra 12. august 2026 (`DOCUMENTATION.md` §13): en migrering, der kaldes
-- idempotent, skal efterprøves ved at blive kørt TO gange.
\ir ../anon_grants_functions.sql

do $$ begin
  if pg_temp.kan('anon') <> array['invite_preview(text)', 'username_available(text)'] then
    raise exception 'anden kørsel ændrede anons adgang — filen er ikke idempotent';
  end if;
end $$;

select 'anon_grants_functions: OK' as result;
