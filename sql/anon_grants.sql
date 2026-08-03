-- `anon` mister sine tabel-privilegier i public — og kilden lukkes (G50).
-- Idempotent — kan køres igen når som helst.
--
-- ---------------------------------------------------------------------------
-- Spørgsmålet rækken stillede, og svaret
--
-- `G50` spurgte, om bredden var BEVIDST: 22 tabeller og views med `grant all`
-- til `anon`, hvor RLS bar hele adgangskontrollen alene. Svaret står i
-- eksporten, og det er nej. Grants'ene er ikke skrevet ét ad gangen — de kommer
-- fra en regel:
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT ALL ON TABLES TO anon;
--
-- Det er Supabases standardopsætning for `public`, og den gælder hver eneste
-- tabel, nogen opretter — også dem, der bliver oprettet i morgen. Bredden er
-- altså hverken valgt eller vedligeholdt; den er arvet. Og fordi den er en
-- REGEL og ikke en liste, ville en oprydning, der kun fjernede de 22, være
-- rullet tilbage af den næste migrering uden at nogen opdagede det.
--
-- ---------------------------------------------------------------------------
-- Hvad `anon` faktisk har brug for: ingenting
--
-- `anon` er rollen FØR login. Appen laver præcis ét kald i den tilstand, som
-- rører databasen: `username_available()` ved oprettelse af en konto — og den
-- er `SECURITY DEFINER`, så den kræver EXECUTE på funktionen og ingen adgang
-- til `profiles`. Alt andet i appen sender brugerens JWT, hvor rollen er
-- `authenticated`. Login, oprettelse og nulstilling går til `/auth/v1/*`, som
-- slet ikke er PostgREST.
--
-- Migreringen rører derfor hverken funktions-grants eller `usage` på skemaet.
-- Kun tabellerne.
--
-- ---------------------------------------------------------------------------
-- Hvad den IKKE er
--
-- Den lukker ikke et kendt hul. RLS holder, og de tre huller, der fandtes, blev
-- lukket af `security_hardening.sql` (#27). Det, den giver, er **dybde**: i dag
-- er en glemt eller fejlskrevet policy forskellen mellem "lukket" og
-- "offentlig", uden noget andet lag imellem. Efter denne migrering skal både
-- policyen og grant'en være forkerte, før noget bliver læsbart uden login.
--
-- Den fjerner samtidig en løgn: en grant, der er bredere end nogen policy
-- tillader, beskriver en adgang, der ikke findes, og gør `schema.sql`
-- ulæselig som adgangskontrakt.
--
-- ⚠️ **Kør den, og hold øje bagefter.** Skulle et flow alligevel læse en tabel
-- uden login, viser det sig som `permission denied for table …` med det samme
-- og ikke som forkerte data. Tilbagerulningen er én linje, og den står nederst.

-- ---------- 1. Fjern det, `anon` har i dag ----------
revoke all on all tables in schema public from anon;

-- ---------- 2. Luk kilden, så nye tabeller ikke får det igen ----------
-- To grantor-roller, fordi begge optræder i eksporten. `supabase_admin` kan
-- kræve et medlemskab, sessionen ikke har; det må ikke vælte migreringen, for
-- den første regel er den, der gælder alt, vi selv opretter.
alter default privileges for role postgres in schema public revoke all on tables from anon;

do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon';
exception when others then
  raise notice 'Kunne ikke ændre default privileges for supabase_admin (%). Tabeller oprettet AF den rolle vil stadig få grants til anon — tjek med forespørgsel 3 nedenfor.', sqlerrm;
end $$;

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- 1) Ingen tabel-privilegier tilbage til anon i public. Forvent 0 rækker.
-- select table_name, privilege_type
--   from information_schema.role_table_grants
--  where grantee = 'anon' and table_schema = 'public';

-- 2) authenticated er urørt (RLS afgør resten). Forvent mange rækker.
-- select count(*) from information_schema.role_table_grants
--  where grantee = 'authenticated' and table_schema = 'public';

-- 3) Kilden er lukket. Forvent ingen 'anon=arwdDxt' i defaclacl for public.
-- select r.rolname as grantor, d.defaclacl
--   from pg_default_acl d
--   join pg_roles r on r.oid = d.defaclrole
--   join pg_namespace n on n.oid = d.defaclnamespace
--  where n.nspname = 'public' and d.defaclobjtype = 'r';

-- 4) Oprettelsen af en konto virker stadig (SECURITY DEFINER, ingen tabeladgang).
-- select public.username_available('et-eller-andet-navn');

-- ============================================================================
-- Tilbagerulning
-- ============================================================================
-- grant all on all tables in schema public to anon;
-- alter default privileges for role postgres in schema public grant all on tables to anon;
