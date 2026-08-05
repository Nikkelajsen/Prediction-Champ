-- Test af `sql/anon_grants_finish.sql` (G58): `anon` mister også SEKVENSERNE,
-- og kilden til dem lukkes — mens funktions-adgangen bevares.
--
-- Kører mod en TOM engangsdatabase (CI: postgres-service; lokalt: en midlertidig
-- klynge). Rører aldrig produktion.
--
-- HVAD DEN BEVISER
--   1. Udgangspunktet er ægte: Supabases default privileges giver `anon` fuld
--      adgang til enhver ny sekvens i `public`. Uden dette trin ville testen
--      kunne "bestå" mod en database, hvor problemet aldrig fandtes — præcis
--      samme opbygning som `anon_grants.sql`s test, af samme grund.
--   2. Efter migreringen har `anon` NUL sekvens-privilegier.
--   3. En sekvens oprettet EFTER migreringen får det heller ikke. Det er
--      halvdelen, der betyder noget på sigt: bredden er en regel, ikke en liste.
--   4. `service_role` er urørt — det er den, der skriver i `job_runs`, og en
--      migrering, der lukkede sekvensen for den, ville stoppe driftsloggen.
--   5. **`anon` kan STADIG køre `username_available()`.** Det er den grænse,
--      hele oprydningen skal respektere: `anon_grants.sql` siger eksplicit, at
--      hverken funktions-grants eller `usage` på skemaet må røres, fordi
--      oprettelsen af en konto sker før login. En "oprydning", der tog
--      funktions-defaults med, ville lukke nye brugere ude — og det ville ikke
--      vise sig nogen andre steder end her.
--
-- ACL'erne læses fra `pg_class`/`pg_default_acl` og ikke fra
-- `information_schema`: sidstnævnte rapporterer pr. standarden kun USAGE på en
-- sekvens, mens `grant all` også giver SELECT og UPDATE. En kontrol, der kun så
-- den ene, ville melde ok for to tredjedele af det, den skal fange.

\set ON_ERROR_STOP on
\timing off

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- ---------- 1. Genskab Supabases udgangspunkt ----------
alter default privileges in schema public grant all on sequences to anon;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to anon;

create table public.profiles (id uuid primary key, display_name text);
create table public.job_runs (id bigserial primary key, job text);

create or replace function public.username_available(name text) returns boolean
  language sql security definer set search_path to 'public' as
  $$ select not exists (select 1 from public.profiles where lower(display_name) = lower(trim(name))) $$;

do $$
begin
  if not exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'S'
       and coalesce(c.relacl::text, '') like '%anon=%')
  then
    raise exception 'Testens udgangspunkt holder ikke: anon fik ingen sekvens-grants af default privileges';
  end if;
end $$;

-- ---------- 2. Migreringen ----------
\ir ../anon_grants_finish.sql

do $$
declare n int;
begin
  -- 2a. Ingen sekvens-privilegier tilbage til anon
  select count(*) into n from pg_class c
    join pg_namespace n2 on n2.oid = c.relnamespace
   where n2.nspname = 'public' and c.relkind = 'S'
     and coalesce(c.relacl::text, '') like '%anon=%';
  if n <> 0 then raise exception 'anon har stadig sekvens-privilegier på % sekvens(er)', n; end if;

  -- 2b. service_role er urørt — den skriver i job_runs
  select count(*) into n from pg_class c
    join pg_namespace n2 on n2.oid = c.relnamespace
   where n2.nspname = 'public' and c.relkind = 'S'
     and coalesce(c.relacl::text, '') like '%service_role=%';
  if n = 0 then raise exception 'migreringen lukkede også service_role ude af sekvenserne'; end if;
end $$;

-- ---------- 3. En sekvens oprettet BAGEFTER får det heller ikke ----------
create table public.nyere_tabel (id bigserial primary key);
do $$
declare n int;
begin
  select count(*) into n from pg_class c
    join pg_namespace n2 on n2.oid = c.relnamespace
   where n2.nspname = 'public' and c.relkind = 'S' and c.relname like 'nyere_tabel%'
     and coalesce(c.relacl::text, '') like '%anon=%';
  if n <> 0 then
    raise exception 'en ny sekvens fik privilegier til anon — kilden er ikke lukket';
  end if;
end $$;

-- ---------- 4. Kilden set fra heartbeat'ens vinkel ----------
-- Nøjagtig det udtryk, job-heartbeat.yml bruger. Står de to forskellige steder
-- med hver sin formulering, driver de fra hinanden — og en kontrol, der er
-- utestet, er en påstand.
do $$
begin
  if exists (
    select 1
      from pg_default_acl d
      join pg_namespace n on n.oid = d.defaclnamespace
     where n.nspname = 'public'
       and d.defaclobjtype in ('r', 'S')
       and coalesce(d.defaclacl::text, '') like '%anon=%')
  then
    raise exception 'default privileges giver stadig anon adgang til tabeller eller sekvenser';
  end if;
end $$;

-- ---------- 5. Grænsen: funktions-adgangen SKAL overleve ----------
-- Den vigtigste af de fem. Oprettelsen af en konto sker før login, altså i
-- anon-rollen, og `username_available()` er det eneste kald, den laver.
do $$
begin
  if not exists (
    select 1
      from pg_default_acl d
      join pg_namespace n on n.oid = d.defaclnamespace
     where n.nspname = 'public' and d.defaclobjtype = 'f'
       and coalesce(d.defaclacl::text, '') like '%anon=%')
  then
    raise exception 'migreringen fjernede funktions-defaults for anon — nye konti kan ikke oprettes';
  end if;
end $$;

set role anon;
do $$
begin
  if not public.username_available('nikolaj') then
    raise exception 'username_available gav forkert svar som anon';
  end if;
end $$;
reset role;

select 'anon_grants_finish: OK' as result;
