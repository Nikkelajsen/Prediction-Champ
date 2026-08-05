-- `anon`s sidste privilegier: sekvenserne — og hvad der IKKE kunne lukkes (G58).
-- Idempotent — kan køres igen når som helst (kør med "Run without RLS").
--
-- Anden halvdel af `anon_grants.sql` (#34). Den lukkede tabellerne og
-- `postgres`' default privileges for TABLES; denne lukker det, den aldrig
-- rørte, og skriver ned, hvad der ikke kan lukkes herfra.
--
-- ---------------------------------------------------------------------------
-- Hvad #34 efterlod, og hvorfor det ikke blev opdaget
--
-- Skema-eksporten efter #36 viser tre ting tilbage til `anon` i `public`:
--
--   1. GRANT ALL ON SEQUENCE public.job_runs_id_seq TO anon;
--   2. ALTER DEFAULT PRIVILEGES FOR ROLE postgres       … GRANT ALL ON SEQUENCES TO anon;
--   3. ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin … GRANT ALL ON SEQUENCES TO anon;
--      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin … GRANT ALL ON TABLES    TO anon;
--
-- #34 skrev `revoke all on all TABLES` og `… on TABLES from anon` — ordet
-- "tables" stod tre steder, og sekvenserne var simpelthen ikke med i
-- formuleringen. Det er ikke en fejl i begrundelsen, men i dækningen: nøjagtig
-- den slags, en gennemgang af dokumentationen mod koden finder, og som ingen
-- kørsel nogensinde ville melde, fordi `anon` kun bruges til ét kald før login.
--
-- Punkt 4 i #34s egen verifikation ville have fanget punkt 3 for TABLES —
-- migreringens `do`-blok slugte fejlen, som den var skrevet til, og notitsen
-- druknede i SQL-editorens output. Derfor er kontrollen flyttet til
-- heartbeat'en (job-heartbeat.yml), hvor den bliver læst hver halve time i
-- stedet for én gang af den, der trykkede Run.
--
-- ---------------------------------------------------------------------------
-- Hvad en sekvens-grant er værd for en angriber: næsten ingenting — og det er
-- grunden til, at den ikke hastede, ikke grunden til at lade den stå
--
-- `anon` har ingen INSERT på `job_runs`, så en `nextval()` kan kun brænde
-- numre i en sekvens, ingen læser fortløbende. Det, der rettes, er ikke et hul,
-- men en **uenighed**: #34 erklærede, at `anon` ikke har adgang til noget i
-- `public`, og skema-eksporten sagde noget andet. En adgangskontrakt, man skal
-- kende undtagelserne til, er ikke en kontrakt.
--
-- ---------------------------------------------------------------------------
-- ⚠️ `supabase_admin` kan formentlig IKKE lukkes herfra — og det er ikke så
-- slemt, som rækken lød
--
-- `ALTER DEFAULT PRIVILEGES FOR ROLE x` gælder kun objekter, der oprettes AF
-- rolle x. Vores migreringer kører som `postgres`, så hver tabel og sekvens,
-- VI opretter, følger `postgres`' defaults — og dem lukkede #34 (tabeller) og
-- denne fil (sekvenser). `supabase_admin`s defaults rammer altså kun det,
-- Supabase selv måtte oprette i `public`, hvilket i praksis er ingenting.
--
-- Sætningen kræver medlemskab af rollen, som SQL-editorens session normalt ikke
-- har. Den står derfor i en `do`-blok — men denne gang med en `raise warning`,
-- der siger, hvad der så gælder, frem for en notits, der ligner en fodnote.
-- Den blivende kontrol er heartbeat'ens: den spørger om TILSTANDEN, ikke om
-- sætningen lykkedes.

-- ---------- 1. Fjern det, `anon` har i dag ----------
revoke all on all sequences in schema public from anon;

-- ---------- 2. Luk kilden for det, VI opretter ----------
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- ---------- 3. Forsøg kilden for det, Supabase opretter ----------
do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon';
  raise notice 'supabase_admin-defaults lukket.';
exception when others then
  raise warning $m$Kunne ikke ændre default privileges for supabase_admin (%).
Det betyder: en tabel eller sekvens, der oprettes AF rollen supabase_admin i public, vil stadig få grants til anon.
Alt, vi selv opretter, kører som postgres og er dækket af trin 2 og af #34.
Kontrollen "anon uden default privileges" i job-heartbeat.yml holder øje med det.$m$, sqlerrm;
end $$;

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- 1) Ingen sekvens-privilegier tilbage til anon. Forvent 0 rækker.
--    ACL'en læses fra pg_class: information_schema.usage_privileges rapporterer
--    pr. standarden kun USAGE, mens `grant all` også giver SELECT og UPDATE.
-- select c.relname, c.relacl
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public' and c.relkind = 'S'
--    and coalesce(c.relacl::text, '') like '%anon=%';

-- 2) Ingen tabel-privilegier (fra #34, gentaget her fordi de to hører sammen).
--    Forvent 0 rækker.
-- select table_name, privilege_type
--   from information_schema.role_table_grants
--  where grantee = 'anon' and table_schema = 'public';

-- 3) Kilderne. Forvent INGEN 'anon=' for grantor postgres på objekttype 'r'
--    (tabeller/views) eller 'S' (sekvenser). Står der stadig en for
--    supabase_admin, er trin 3 ovenfor afvist, og forbeholdet i hovedet gælder.
--
--    ⚠️ 'f' (FUNCTIONS) SKAL stadig have anon — `username_available()` kaldes
--    før login, og #34 siger eksplicit, at den hverken rører funktions-grants
--    eller `usage` på skemaet. En "oprydning", der tog den med, ville lukke
--    oprettelsen af nye konti.
-- select r.rolname as grantor, d.defaclobjtype, d.defaclacl
--   from pg_default_acl d
--   join pg_roles r on r.oid = d.defaclrole
--   join pg_namespace n on n.oid = d.defaclnamespace
--  where n.nspname = 'public';

-- 4) Oprettelsen af en konto virker stadig (SECURITY DEFINER, ingen tabeladgang).
-- select public.username_available('et-eller-andet-navn');

-- 5) Driftsloggen kan stadig skrives (service_role, som ejer sekvensen).
--    Forvent en række med et id.
-- select id from public.job_runs order by id desc limit 1;

-- ============================================================================
-- Tilbagerulning
-- ============================================================================
-- grant all on all sequences in schema public to anon;
-- alter default privileges for role postgres in schema public grant all on sequences to anon;
