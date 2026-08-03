-- Test af fejltelemetrien (sql/client_errors.sql, G42).
--
-- Kører mod en TOM engangsdatabase. Rører aldrig produktion. Samme mønster som
-- feedback.sql, som tabellen er bygget efter.
--
-- HVAD DEN BEVISER
--   1. En bruger kan skrive SIN EGEN fejl og ingen andres.
--   2. Ingen kan LÆSE tabellen gennem RLS — heller ikke sine egne rækker.
--      Læsningen går gennem den admin-gatede RPC og intet andet sted.
--   3. `admin_client_errors()` afviser en ikke-admin og svarer en admin.
--   4. Længdegrænserne holder: en fejlrapport kan ikke fylde tabellen.
--   5. Rydningen fjerner det gamle og lader det nye stå.

\set ON_ERROR_STOP on
\timing off

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $$;
create table if not exists auth.users (id uuid primary key);
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
grant usage on schema public to authenticated, anon;

create table public.profiles (id uuid primary key, display_name text, is_admin boolean default false);

\ir ../client_errors.sql

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');
insert into public.profiles (id, display_name, is_admin) values
  ('00000000-0000-0000-0000-000000000001', 'Nikolaj', true),
  ('00000000-0000-0000-0000-000000000002', 'Bo', false);

-- ---------- 1+2) skrive egne, læse ingen ----------
select set_config('test.uid', '00000000-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
begin

  insert into public.client_errors (user_id, kind, message, stack, screen, app_version)
  values ('00000000-0000-0000-0000-000000000002', 'render', 'Cannot read properties of undefined',
          'at HjemTab (index.js:1:1)', 'hjem:', 'abc1234');

  -- … men ikke i en andens navn.
  begin
    insert into public.client_errors (user_id, kind, message)
    values ('00000000-0000-0000-0000-000000000001', 'render', 'i en andens navn');
    raise exception 'en bruger kunne skrive en fejl i en andens navn';
  exception when insufficient_privilege then null;
  end;

  -- … og kan ikke læse noget som helst, heller ikke sin egen række.
  -- Bemærk HVORDAN den afvises: der er ingen SELECT-grant overhovedet, så
  -- afvisningen sker på rettighedsniveau og ikke som en tom RLS-filtrering.
  -- Det er strengere, og det er med vilje — læsningen har ét sted at gå
  -- igennem, den admin-gatede RPC.
  begin
    perform 1 from public.client_errors limit 1;
    raise exception 'en almindelig bruger kunne læse client_errors';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------- 4) længdegrænserne ----------
do $$
begin
  begin
    insert into public.client_errors (user_id, kind, message)
    values ('00000000-0000-0000-0000-000000000002', 'render', repeat('x', 2001));
    raise exception 'en 2001 tegns besked slap igennem';
  exception when check_violation then null;
  end;

  begin
    insert into public.client_errors (user_id, kind, message)
    values ('00000000-0000-0000-0000-000000000002', 'ukendt-slags', 'x');
    raise exception 'en ukendt kind slap igennem';
  exception when check_violation then null;
  end;
end $$;

-- ---------- 3) læsningen er admin-gatet ----------
do $$
declare n int;
begin
  -- ikke-admin
  perform set_config('test.uid', '00000000-0000-0000-0000-000000000002', false);
  begin
    perform * from public.admin_client_errors(10);
    raise exception 'en ikke-admin kunne læse fejlrapporterne';
  exception when raise_exception then null;
  end;

  -- admin
  perform set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
  select count(*) into n from public.admin_client_errors(10);
  if n <> 1 then raise exception 'admin så % rækker, forventede 1', n; end if;

  -- navnet joines på, så en fejl kan følges op
  if not exists (select 1 from public.admin_client_errors(10) where display_name = 'Bo') then
    raise exception 'admin-listen mangler brugerens navn';
  end if;
end $$;

-- ---------- 5) rydningen ----------
do $$
declare slettet int;
begin
  insert into public.client_errors (user_id, kind, message, created_at)
  values ('00000000-0000-0000-0000-000000000002', 'error', 'gammel fejl', now() - interval '200 days');

  slettet := public.prune_client_errors(90);
  if slettet <> 1 then raise exception 'rydningen slettede % rækker, forventede 1', slettet; end if;
  if (select count(*) from public.client_errors) <> 1 then
    raise exception 'rydningen tog den nye række med';
  end if;
end $$;

select 'client_errors: OK' as result;
