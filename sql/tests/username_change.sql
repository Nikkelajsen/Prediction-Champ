-- Test af `sql/username_change.sql` (B29).
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR DET RIGTIGE SKEMA. Halvdelen af påstandene er om RETTIGHEDER og RLS,
-- og ingen af de to kan måles i et miniskema: en påstand om, at noget er
-- FORBUDT, kræver, at alle policies og alle grants er der, præcis som `G91`
-- lærte. Den anden halvdel måler samspillet mellem tre regler, der allerede
-- stod i skemaet — unikhedsindekset, længde-constrainten og
-- `username_available()` — og det samspil findes kun, hvor de gør.
--
-- HVAD DEN BEVISER
--   1. Kolonnen og triggeren er der efter migreringen.
--   2. En bruger kan skifte SIT eget navn som `authenticated` under RLS.
--   3. Skiftet stempler `display_name_changed_at`; et skriv, der ikke ændrer
--      navnet, gør ikke.
--   4. Navnet trimmes ved både insert og update — og det er dét, der lukker
--      hullet mellem `username_available()` (som trimmer) og unikhedsindekset
--      (som ikke gør). Negativ kontrol FØR migreringen: uden triggeren kan
--      "Anna " indsættes ved siden af "Anna".
--   5. Unikheden er case-insensitiv, også ved et skift.
--   6. Længde-constrainten bider på et skift i begge retninger.
--   7. En anden brugers navn kan ikke skiftes (RLS).
--   8. 🔴 REGRESSIONEN: `is_admin` kan IKKE sættes af brugeren selv, og rækken
--      kan ikke flyttes til en anden bruger. Hullet var åbent i produktion,
--      indtil denne migrering blev kørt — se filens hoved. Negativ kontrol FØR
--      migreringen, fordi en påstand om en lukket dør kun betyder noget, hvis
--      man har set den stå åben.
--   9. `sikrProfil()`s upsert virker stadig — `insert … on conflict do update
--      set id = excluded.id, …` er den form, PostgREST sender, og den kræver
--      UPDATE-privilegiet på `id`. Uden påstanden ville en for stram rettelse
--      knække oprettelsen af enhver ny profil, og det ville først vise sig ved
--      den næste nye bruger.
--  10. En LUKKET konto kan ikke omdøbes — men anonymiseringen selv kan stadig
--      skrive pseudonymet, og den sætter ikke stemplet.
--
-- EFTERPRØVET MED MUTATION (10. august 2026). Migreringen er ændret otte gange
-- og testen set fejle hver gang: `grant update` udvidet til hele tabellen
-- (påstand 8), `id` fjernet fra grant'en (9), trimningen fjernet (4),
-- trimningen begrænset til UPDATE (4), stemplet flyttet uden for
-- `is distinct from`-grenen (3), låsen på en lukket konto fjernet (10), låsen
-- skrevet på `new.anonymized_at` frem for `old` (10, den anden vej: så kan
-- anonymiseringen ikke længere køre), og triggeren droppet helt (1).
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d unavn -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d unavn -v ON_ERROR_STOP=1 -b -f sql/tests/username_change.sql

\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------------------
-- Migreringer, der ligger under den, vi tester
-- ---------------------------------------------------------------------------
-- `username_constraints.sql` er selve garantien, trimningen skal spille sammen
-- med, og `account_anonymization.sql` + `liga_admin.sql` giver den lukkede
-- konto, påstand 10 handler om. Produktionens rækkefølge.
\ir ../username_constraints.sql
\ir ../account_anonymization.sql
\ir ../season_end.sql
\ir ../liga_admin.sql

-- `authenticated` skal kunne nå `auth.uid()` inde i policyen, præcis som i
-- Supabase. Attrappen i `_schema.mjs` opretter skemaet uden det grant.
grant usage on schema auth to authenticated;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'anna@test.local'),
  ('a0000000-0000-4000-8000-000000000002', 'bo@test.local'),
  ('a0000000-0000-4000-8000-000000000003', 'lukket@test.local');
insert into public.profiles (id, display_name) values
  ('a0000000-0000-4000-8000-000000000001', 'Anna'),
  ('a0000000-0000-4000-8000-000000000002', 'Bo'),
  ('a0000000-0000-4000-8000-000000000003', 'Cecilie');

-- Kør en sætning som en bestemt indlogget bruger. Returnerer SQLSTATE ved fejl
-- og null ved succes, så en påstand kan spørge "blev det afvist, og hvorfor".
create function pg_temp.som(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare v_state text;
begin
  begin
    perform set_config('test.uid', p_uid::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    execute p_sql;
    reset role;
    return null;
  exception when others then
    v_state := sqlstate;
    reset role;
    return v_state;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- FØR migreringen: de to huller SKAL kunne genskabes
-- ---------------------------------------------------------------------------
-- En påstand om en lukket dør er kun værd at have, hvis man har set den stå
-- åben. Begge kontroller ruller sig selv tilbage bagefter, så fixturen er den
-- samme, når migreringen køres.
--
-- ⚠️ **TESTEN EJER SIN EGEN FØR-TILSTAND (G94-reglen, DOCUMENTATION.md §13).**
-- Rettighedshullet nedenfor hviler på `grant all on profiles to authenticated`,
-- altså tilstanden FØR `#51` smalnede den til to kolonner. Den stod i
-- `sql/schema.sql` — indtil migreringen blev kørt i produktion og skema-
-- eksporten kørte bagefter (12. august 2026), hvorefter dumpet bar den
-- SMALNEDE grant, og kontrollen fejlede med `42501`. Altså en test, der blev
-- rød af, at arbejdet lykkedes.
--
-- Grant'en sættes derfor eksplicit her frem for at blive læst af skemaet.
-- Migreringen under test smalner den igen få linjer længere nede, så påstand 8
-- måler stadig præcis det, den altid har målt.
grant all on public.profiles to authenticated;
--
-- Og trim-hullet (b) hviler på, at der IKKE er en trigger, der trimmer navnet
-- ved skrivning. `profiles_name_guard` er `#51`s egen, og den kom med i dumpet
-- ved samme eksport. Uden dette drop bliver "Anna " trimmet til "Anna" på vej
-- ind og kolliderer med den eksisterende række — altså et hul, der ikke kan
-- genskabes, fordi det allerede er lukket.
--
-- Migreringen under test opretter triggeren igen få linjer længere nede, så
-- påstandene om den måler stadig det, de altid har målt.
drop trigger if exists profiles_name_guard on public.profiles;

do $$
declare v_state text;
begin
  -- a) Rettighedshullet: enhver bruger kunne gøre sig selv til administrator.
  v_state := pg_temp.som('a0000000-0000-4000-8000-000000000001',
    $s$update public.profiles set is_admin = true where id = auth.uid()$s$);
  if v_state is not null then
    raise exception 'fixturen holder ikke: is_admin skulle KUNNE sættes før migreringen, men blev afvist med %', v_state;
  end if;
  if not (select is_admin from public.profiles where id = 'a0000000-0000-4000-8000-000000000001') then
    raise exception 'fixturen holder ikke: is_admin står ikke som sat efter det skriv, påstand 8 skal lukke';
  end if;
  update public.profiles set is_admin = false where id = 'a0000000-0000-4000-8000-000000000001';

  -- b) Trim-hullet: "Anna " kunne stå ved siden af "Anna", fordi indekset står
  --    på lower(display_name) og ikke på det trimmede navn.
  insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000009', 'dublet@test.local');
  insert into public.profiles (id, display_name) values ('a0000000-0000-4000-8000-000000000009', 'Anna ');
  if (select count(*) from public.profiles where btrim(display_name) = 'Anna') <> 2 then
    raise exception 'fixturen holder ikke: to profiler skulle kunne hedde Anna med et mellemrum imellem sig';
  end if;
  delete from public.profiles where id = 'a0000000-0000-4000-8000-000000000009';
  delete from auth.users where id = 'a0000000-0000-4000-8000-000000000009';
end $$;

-- ---------------------------------------------------------------------------
-- Migreringen under test
-- ---------------------------------------------------------------------------
\ir ../username_change.sql

-- ---------------------------------------------------------------------------
-- Påstandene
-- ---------------------------------------------------------------------------
do $$
declare
  v_antal    int;
  v_state    text;
  v_navn     text;
  v_stemplet timestamptz;
  v_kolonner text;
begin
  -- 1) Kolonnen og triggeren står der
  select count(*) into v_antal from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles'
     and column_name = 'display_name_changed_at';
  if v_antal <> 1 then raise exception '1) display_name_changed_at findes ikke'; end if;

  select count(*) into v_antal from pg_trigger
   where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_name_guard' and not tgisinternal;
  if v_antal <> 1 then raise exception '1) triggeren profiles_name_guard findes ikke'; end if;

  -- 2) Brugeren kan skifte sit eget navn
  v_state := pg_temp.som('a0000000-0000-4000-8000-000000000001',
    $s$update public.profiles set display_name = 'Annabel' where id = auth.uid()$s$);
  if v_state is not null then
    raise exception '2) et navneskift på egen række blev afvist med %', v_state;
  end if;
  select display_name into v_navn from public.profiles where id = 'a0000000-0000-4000-8000-000000000001';
  if v_navn <> 'Annabel' then raise exception '2) navnet blev ikke skiftet, står som %', v_navn; end if;

  -- 3) Stemplet sættes ved et skift — og kun ved et skift
  select display_name_changed_at into v_stemplet from public.profiles
   where id = 'a0000000-0000-4000-8000-000000000001';
  if v_stemplet is null then raise exception '3) display_name_changed_at blev ikke stemplet'; end if;
  if (select display_name_changed_at from public.profiles
       where id = 'a0000000-0000-4000-8000-000000000002') is not null then
    raise exception '3) Bo har et stempel uden at have skiftet navn';
  end if;
  -- Et skriv med SAMME navn må ikke rykke stemplet: så ville "sidst skiftet"
  -- betyde "sidst gemt", og en fremtidig karantæne ville måle det forkerte.
  --
  -- Stemplet sættes først til en KENDT gammel værdi, og det er ikke pedanteri:
  -- hele testen kører i én transaktion, så `now()` er den samme værdi hele
  -- vejen igennem. Sammenlignes der bare med det stempel, skiftet lige satte,
  -- består påstanden også for en trigger, der stempler ved hvert eneste skriv.
  update public.profiles set display_name_changed_at = timestamptz '2020-01-01 00:00+00'
   where id = 'a0000000-0000-4000-8000-000000000001';
  perform pg_temp.som('a0000000-0000-4000-8000-000000000001',
    $s$update public.profiles set display_name = 'Annabel' where id = auth.uid()$s$);
  if (select display_name_changed_at from public.profiles
       where id = 'a0000000-0000-4000-8000-000000000001')
     is distinct from timestamptz '2020-01-01 00:00+00' then
    raise exception '3) stemplet rykkede sig, selvom navnet var det samme';
  end if;
  update public.profiles set display_name_changed_at = v_stemplet
   where id = 'a0000000-0000-4000-8000-000000000001';

  -- 4) Trimningen — insert og update, og dermed hullet fra den negative kontrol
  insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000004', 'd@test.local');
  insert into public.profiles (id, display_name) values ('a0000000-0000-4000-8000-000000000004', '  Dorte  ');
  select display_name into v_navn from public.profiles where id = 'a0000000-0000-4000-8000-000000000004';
  if v_navn <> 'Dorte' then raise exception '4) navnet blev ikke trimmet ved insert, står som "%"', v_navn; end if;

  v_state := pg_temp.som('a0000000-0000-4000-8000-000000000002',
    $s$update public.profiles set display_name = '  Bodil ' where id = auth.uid()$s$);
  if v_state is not null then raise exception '4) skiftet med mellemrum blev afvist med %', v_state; end if;
  select display_name into v_navn from public.profiles where id = 'a0000000-0000-4000-8000-000000000002';
  if v_navn <> 'Bodil' then raise exception '4) navnet blev ikke trimmet ved update, står som "%"', v_navn; end if;

  -- Og selve hullet: "Dorte " kan ikke længere stå ved siden af "Dorte".
  insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000005', 'e@test.local');
  begin
    insert into public.profiles (id, display_name) values ('a0000000-0000-4000-8000-000000000005', 'Dorte ');
    raise exception '4) "Dorte " blev indsat ved siden af "Dorte" — trimningen lukker ikke hullet';
  exception when unique_violation then null;
  end;
  -- `username_available()` og indekset er nu enige om det samme navn.
  if public.username_available(' dorte ') then
    raise exception '4) username_available() siger ledigt om et navn, indekset ville afvise';
  end if;

  -- 5) Unikheden er case-insensitiv, også ved et skift
  v_state := pg_temp.som('a0000000-0000-4000-8000-000000000002',
    $s$update public.profiles set display_name = 'ANNABEL' where id = auth.uid()$s$);
  if v_state <> '23505' then
    raise exception '5) et skift til en anden brugers navn i anden kasse gav % og ikke en unikhedsfejl', coalesce(v_state, 'succes');
  end if;

  -- 6) Længden bider i begge retninger
  v_state := pg_temp.som('a0000000-0000-4000-8000-000000000002',
    $s$update public.profiles set display_name = 'A' where id = auth.uid()$s$);
  if v_state <> '23514' then
    raise exception '6) et navn på ét tegn gav % og ikke en check-fejl', coalesce(v_state, 'succes');
  end if;
  v_state := pg_temp.som('a0000000-0000-4000-8000-000000000002',
    $s$update public.profiles set display_name = 'ETogtyvetegnslangtnavn' where id = auth.uid()$s$);
  if v_state <> '23514' then
    raise exception '6) et navn på 22 tegn gav % og ikke en check-fejl', coalesce(v_state, 'succes');
  end if;

  -- 7) En anden brugers navn kan ikke skiftes
  perform pg_temp.som('a0000000-0000-4000-8000-000000000001',
    $s$update public.profiles set display_name = 'Kapret'
        where id = 'a0000000-0000-4000-8000-000000000002'$s$);
  if (select display_name from public.profiles
       where id = 'a0000000-0000-4000-8000-000000000002') <> 'Bodil' then
    raise exception '7) Anna kunne skrive Bos navn';
  end if;

  -- 8) 🔴 REGRESSIONEN: is_admin er lukket, og rækken kan ikke flyttes
  select string_agg(column_name, ', ' order by column_name) into v_kolonner
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'profiles'
     and grantee = 'authenticated' and privilege_type = 'UPDATE';
  if v_kolonner is distinct from 'display_name, id' then
    raise exception '8) authenticated må skrive disse kolonner: % — forventede kun id og display_name', coalesce(v_kolonner, 'ingen');
  end if;

  v_state := pg_temp.som('a0000000-0000-4000-8000-000000000001',
    $s$update public.profiles set is_admin = true where id = auth.uid()$s$);
  if v_state <> '42501' then
    raise exception '8) en bruger kunne gøre sig selv til administrator (svar: %)', coalesce(v_state, 'succes');
  end if;
  if (select is_admin from public.profiles where id = 'a0000000-0000-4000-8000-000000000001') then
    raise exception '8) is_admin står som sat efter forsøget';
  end if;

  v_state := pg_temp.som('a0000000-0000-4000-8000-000000000001',
    $s$update public.profiles set id = 'a0000000-0000-4000-8000-000000000002' where id = auth.uid()$s$);
  if v_state is null then
    raise exception '8) rækken kunne flyttes til en anden bruger';
  end if;

  -- 9) `sikrProfil()`s upsert — den form, PostgREST sender
  insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000006', 'f@test.local');
  v_state := pg_temp.som('a0000000-0000-4000-8000-000000000006',
    $s$insert into public.profiles (id, display_name)
       values (auth.uid(), 'Frida')
       on conflict (id) do update set id = excluded.id, display_name = excluded.display_name$s$);
  if v_state is not null then
    raise exception '9) oprettelsen af en profil via upsert blev afvist med % — mangler UPDATE på id?', v_state;
  end if;
  if (select display_name from public.profiles where id = 'a0000000-0000-4000-8000-000000000006') <> 'Frida' then
    raise exception '9) profilrækken blev ikke skrevet af upserten';
  end if;

  -- 10) Den lukkede konto
  perform set_config('test.uid', 'a0000000-0000-4000-8000-000000000003', true);
  perform public.anonymize_my_account();
  select display_name, display_name_changed_at into v_navn, v_stemplet
    from public.profiles where id = 'a0000000-0000-4000-8000-000000000003';
  if v_navn = 'Cecilie' then
    raise exception '10) anonymiseringen kunne ikke skrive pseudonymet — låsen rammer forkert vej';
  end if;
  if v_stemplet is not null then
    raise exception '10) anonymiseringen blev stemplet som et navneskift';
  end if;
  begin
    update public.profiles set display_name = 'Genoplivet'
     where id = 'a0000000-0000-4000-8000-000000000003';
    raise exception '10) en lukket kontos pseudonym kunne omdøbes';
  exception when insufficient_privilege then null;
  end;
end $$;

select 'username_change: alle 10 påstande bestået' as resultat;
