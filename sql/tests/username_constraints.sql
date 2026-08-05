-- Test af `sql/username_constraints.sql` (G63): brugernavnets tre garantier kan
-- bygges op fra scriptet alene.
--
-- Kører mod en TOM engangsdatabase (CI: postgres-service; lokalt: en midlertidig
-- klynge). Rører aldrig produktion.
--
-- HVORFOR DEN FINDES
-- Indtil august 2026 rummede filen kun længde-constrainten, mens
-- `username_available()` og `profiles_display_name_lower_idx` alene stod i den
-- GENEREREDE `schema.sql`. Hullet var ikke i produktion — objekterne står der —
-- men i **gendannelsesvejen**: bygger man skemaet fra `sql/`-scripterne (fx et
-- staging-projekt, `B18`), fik man en database, hvor to brugere kunne hedde det
-- samme, og hvor signup-tjekket slet ikke fandtes.
--
-- Denne test ER den vej. Den opretter `profiles` som en tom tabel, kører
-- scriptet og spørger, om produktets løfte i §6 så gælder — frem for at tro på,
-- at det gør, fordi det gør i produktion.
--
-- HVAD DEN BEVISER
--   1. Alle tre objekter opstår af scriptet alene.
--   2. Unikheden er case-insensitiv OG trimmer — to brugere kan ikke hedde
--      "Anna" og "  anna ".
--   3. Længden håndhæves i begge ender (1 tegn og 21 tegn afvises).
--   4. `username_available()` svarer det SAMME som indekset håndhæver. To
--      forskellige udtryk her ville give et "ledigt", der blev til en
--      constraint-fejl et øjeblik senere.
--   5. Scriptet er idempotent: anden kørsel ændrer intet og fejler ikke.

\set ON_ERROR_STOP on
\timing off

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

-- Kun de kolonner, scriptet rører. En fuld `profiles` ville gøre testen
-- afhængig af et skema, den ikke handler om.
create table public.profiles (id uuid primary key, display_name text not null);

-- ---------- 1. Scriptet ----------
\ir ../username_constraints.sql

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_display_name_len') then
    raise exception 'længde-constrainten blev ikke oprettet';
  end if;
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'profiles_display_name_lower_idx') then
    raise exception 'unikhedsindekset blev ikke oprettet';
  end if;
  if not exists (select 1 from pg_proc
                  where proname = 'username_available' and pronamespace = 'public'::regnamespace) then
    raise exception 'username_available() blev ikke oprettet';
  end if;
end $$;

-- ---------- 2. Unikheden er case-insensitiv og trimmer ----------
insert into public.profiles (id, display_name) values (gen_random_uuid(), 'Anna');

do $$
begin
  insert into public.profiles (id, display_name) values (gen_random_uuid(), 'anna');
  raise exception 'to brugere kunne hedde Anna og anna';
exception when unique_violation then
  null; -- forventet
end $$;

-- ---------- 3. Længden i begge ender ----------
do $$
begin
  insert into public.profiles (id, display_name) values (gen_random_uuid(), 'a');
  raise exception 'et navn på ét tegn blev accepteret';
exception when check_violation then
  null; -- forventet
end $$;

do $$
begin
  insert into public.profiles (id, display_name) values (gen_random_uuid(), repeat('a', 21));
  raise exception 'et navn på 21 tegn blev accepteret';
exception when check_violation then
  null; -- forventet
end $$;

-- ---------- 4. Opslaget svarer det samme, som indekset håndhæver ----------
-- Den vigtigste af de fire: et "ledigt", der bliver til en constraint-fejl et
-- øjeblik senere, er værre end et "optaget", fordi brugeren allerede har trykket.
do $$
begin
  if public.username_available('Anna')   then raise exception 'ledigt for et taget navn'; end if;
  if public.username_available('  aNnA ') then raise exception 'ledigt for et taget navn med anden kasse og mellemrum'; end if;
  if not public.username_available('bertil') then raise exception 'optaget for et frit navn'; end if;
end $$;

-- ---------- 5. Idempotens ----------
\ir ../username_constraints.sql

do $$
begin
  if (select count(*) from pg_indexes
       where schemaname = 'public' and indexname = 'profiles_display_name_lower_idx') <> 1 then
    raise exception 'anden kørsel efterlod ikke præcis ét indeks';
  end if;
  if public.username_available('Anna') then
    raise exception 'anden kørsel ændrede opslagets svar';
  end if;
end $$;

select 'username_constraints: OK' as result;
