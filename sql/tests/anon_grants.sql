-- Test af `sql/anon_grants.sql` (G50): `anon` mister tabel-adgangen, og kilden
-- til den lukkes.
--
-- Kører mod en TOM engangsdatabase (CI: postgres-service; lokalt: en midlertidig
-- klynge). Rører aldrig produktion.
--
-- HVAD DEN BEVISER
--   1. Udgangspunktet er ægte: Supabases default privileges giver `anon` fuld
--      adgang til enhver ny tabel i `public`. Uden dette trin ville testen kunne
--      "bestå" mod en database, hvor problemet aldrig fandtes.
--   2. Efter migreringen har `anon` NUL tabel-privilegier i `public`.
--   3. `authenticated` er urørt — migreringen må ikke lukke appen ude.
--   4. En tabel oprettet EFTER migreringen får det heller ikke. Det er den
--      halvdel, der betyder noget på sigt: bredden var en regel og ikke en
--      liste, så en oprydning uden dette trin ville blive rullet tilbage af den
--      næste migrering, uden at nogen opdagede det.
--   5. `anon` kan stadig køre en SECURITY DEFINER-funktion. Det er præcis dét,
--      oprettelsen af en konto har brug for (`username_available`).
--
--      ⚠️ **Her stod indtil 11. august 2026 "og den er det eneste, appen laver i
--      anon-rollen". Det er ikke længere sandt, og det var upræcist også dengang.**
--      `I7` lagde `invite_preview()` ved siden af — invitationens etiket, læst
--      før login. Men vigtigere: `grant all on functions to anon` gælder HVER
--      funktion i `public`, ikke kun dem, appen kalder. Hvad `anon` kan NÅ, og
--      hvad appen BRUGER, er to forskellige lister, og kun den anden er kort.
--      Det, der holder en fremmed ude af fx `invite_lookup()`, er funktionens
--      egen `auth.uid()`-vagt — se `sql/README.md`s adgangskontrakt.

\set ON_ERROR_STOP on
\timing off

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- ---------- 1. Genskab Supabases udgangspunkt ----------
-- Præcis den regel, eksporten viser, og som gør bredden arvet frem for valgt.
alter default privileges in schema public grant all on tables to anon;
alter default privileges in schema public grant all on tables to authenticated;

create table public.profiles (id uuid primary key, display_name text);
create table public.predictions (user_id uuid, match_id uuid, pred_home int);

create or replace function public.username_available(name text) returns boolean
  language sql security definer set search_path to 'public' as
  $$ select not exists (select 1 from public.profiles where lower(display_name) = lower(trim(name))) $$;
grant execute on function public.username_available(text) to anon, authenticated;

do $$
declare n int;
begin
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public';
  if n = 0 then
    raise exception 'Testens udgangspunkt holder ikke: anon fik ingen grants af default privileges';
  end if;
end $$;

-- ---------- 2. Migreringen ----------
\ir ../anon_grants.sql

do $$
declare n int;
begin
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public';
  if n <> 0 then raise exception 'anon har stadig % tabel-privilegier', n; end if;

  -- ---------- 3. authenticated er urørt ----------
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public';
  if n = 0 then raise exception 'migreringen lukkede også authenticated ude'; end if;
end $$;

-- ---------- 4. En tabel oprettet BAGEFTER får det heller ikke ----------
create table public.nyere_tabel (id int primary key);
do $$
declare n int;
begin
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public' and table_name = 'nyere_tabel';
  if n <> 0 then
    raise exception 'en ny tabel fik % privilegier til anon — kilden er ikke lukket', n;
  end if;
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public' and table_name = 'nyere_tabel';
  if n = 0 then raise exception 'en ny tabel gav ikke authenticated adgang'; end if;
end $$;

-- ---------- 5. anon kan stadig oprette en konto ----------
-- Funktionen er SECURITY DEFINER og læser `profiles` på definerens vegne, så
-- den virker uden en eneste tabel-grant til anon. Det er hele grunden til, at
-- migreringen kan være så bred, som den er.
set role anon;
do $$
begin
  if not public.username_available('nikolaj') then
    raise exception 'username_available gav forkert svar som anon';
  end if;
end $$;

-- … og kan stadig IKKE læse tabellen bagved.
do $$
begin
  perform 1 from public.profiles limit 1;
  raise exception 'anon kunne stadig læse public.profiles';
exception when insufficient_privilege then
  null; -- forventet
end $$;
reset role;

select 'anon_grants: OK' as result;
