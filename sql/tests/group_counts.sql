-- Test af ligaens to tal (sql/group_counts.sql, G106).
--
-- Kører mod PRODUKTIONSSKEMAET (`node sql/tests/_schema.mjs`) og anvender
-- derefter migreringen. Rører aldrig produktion.
--
-- HVORFOR PRODUKTIONSSKEMAET OG IKKE ET MINISKEMA
-- Hele pointen med viewet er `security_invoker`: tallene skal arve kalderens
-- egen RLS på TRE tabeller — `groups` (`#58`), `group_members` og
-- `competitions` (`#60`s `is_competition_visible()`). De tre policies findes
-- kun i produktionsskemaet, og et miniskema ville måle håndlavede kopier af
-- præcis det, påstanden handler om.
--
-- HVAD DEN BEVISER
--   1. Viewet er `security_invoker`, og `anon` kan ikke læse det.
--   2. Tallene er RIGTIGE: et medlem ser sin ligas faktiske medlems- og
--      konkurrenceantal.
--   3. 🔴 **Viewet er ikke et hul rundt om RLS.** En fremmed ser nul rækker —
--      hverken sin egen nul eller nogen andens tal. Det er den påstand, der
--      skiller et `security_invoker`-view fra et almindeligt, og den ville
--      fejle ved et enkelt glemt `with (security_invoker = on)`.
--   4. Tallene ER de rækker, klienten selv talte før: viewets svar sammenlignes
--      med den optælling, `loadMyGroups()` lavede i browseren — målt gennem
--      SAMME session, så RLS gælder begge sider. Migreringen må ikke ændre ét
--      tal på skærmen, kun hvor det tælles.
--   5. Optællingen holder over PostgRESTs loft. Med 1.001 medlemsrækker svarer
--      viewet 1001 — det tal, den gamle vej pr. konstruktion ikke kunne give.
--   6. Migreringen er idempotent.
--
-- HVAD DEN **IKKE** GØR, OG HVORFOR (§13)
-- Den måler ikke før-tilstanden — altså at den gamle klient ville have set
-- 1000 i påstand 5. Afkortningen sker i PostgREST og ikke i PostgreSQL, så den
-- findes slet ikke i den database, testen kører mod; en påstand om den ville
-- måle en efterligning. Klientens halvdel er dækket i `src/lib/data.test.js`.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d gc -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d gc -v ON_ERROR_STOP=1 -b -f sql/tests/group_counts.sql

\set ON_ERROR_STOP on
\timing off

\ir ../group_counts.sql

-- Læs noget som en bestemt bruger — altså gennem hendes egen RLS.
create function pg_temp.som(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare v_svar text;
begin
  perform set_config('test.uid', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  execute p_sql into v_svar;
  reset role;
  return v_svar;
end $$;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- ÉN liga med to medlemmer og to konkurrencer, plus en FREMMED, der ikke er med
-- i noget. Fremmeden er ikke pynt: hun er hele påstand 3.
insert into auth.users (id, email) values
  ('61060000-0000-4000-8000-00000000000a', 'anna@test.local'),
  ('61060000-0000-4000-8000-00000000000b', 'bo@test.local'),
  ('61060000-0000-4000-8000-00000000000f', 'fremmed@test.local');
insert into public.profiles (id, display_name) values
  ('61060000-0000-4000-8000-00000000000a', 'Anna'),
  ('61060000-0000-4000-8000-00000000000b', 'Bo'),
  ('61060000-0000-4000-8000-00000000000f', 'Fremmed');

insert into public.groups (id, name, created_by) values
  ('61060000-0000-4000-8000-000000000101', 'Kontoret', '61060000-0000-4000-8000-00000000000a');
insert into public.group_members (group_id, user_id, role) values
  ('61060000-0000-4000-8000-000000000101', '61060000-0000-4000-8000-00000000000a', 'admin'),
  ('61060000-0000-4000-8000-000000000101', '61060000-0000-4000-8000-00000000000b', 'member');

insert into public.competitions (id, name, mode, created_by, group_id) values
  ('61060000-0000-4000-8000-000000000201', 'Efterår', 'random',
   '61060000-0000-4000-8000-00000000000a', '61060000-0000-4000-8000-000000000101'),
  ('61060000-0000-4000-8000-000000000202', 'Forår', 'random',
   '61060000-0000-4000-8000-00000000000a', '61060000-0000-4000-8000-000000000101');

-- ---------------------------------------------------------------------------
-- 1. Formen
-- ---------------------------------------------------------------------------
do $$
declare v_invoker boolean; v_anon boolean;
begin
  select 'security_invoker=on' = any(c.reloptions) into v_invoker
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relname = 'group_counts';
  if v_invoker is not true then
    raise exception 'viewet skal være security_invoker — uden det svarer det uden om RLS';
  end if;

  select has_table_privilege('anon', 'public.group_counts', 'SELECT') into v_anon;
  if v_anon then
    raise exception '`anon` skal ikke kunne læse group_counts';
  end if;

  -- 🔴 Viewet ER auto-opdaterbart (ét `from`, `group_id` er en simpel
  -- kolonnereference), og Supabases default privileges giver `authenticated`
  -- ALLE privilegier på hver ny relation. Uden migreringens `revoke … from
  -- authenticated` kunne man derfor skrive i `groups` gennem viewet. De øvrige
  -- views i basen er inerte på det punkt, fordi ingen af dem er
  -- auto-opdaterbare — dette er undtagelsen, og derfor måles den her.
  if not has_table_privilege('authenticated', 'public.group_counts', 'SELECT') then
    raise exception 'en indlogget bruger skal kunne LÆSE viewet';
  end if;
  if has_table_privilege('authenticated', 'public.group_counts', 'INSERT')
     or has_table_privilege('authenticated', 'public.group_counts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.group_counts', 'DELETE') then
    raise exception 'viewet er auto-opdaterbart — `authenticated` må kun have SELECT';
  end if;

  raise notice 'OK 1: security_invoker, kun læsning for authenticated, intet til anon';
end $$;

-- ---------------------------------------------------------------------------
-- 2 + 3. Tallene, og hvem der overhovedet får en række
-- ---------------------------------------------------------------------------
do $$
declare v_anna text; v_bo text; v_fremmed text;
begin
  select pg_temp.som('61060000-0000-4000-8000-00000000000a',
    $q$ select member_count || '/' || competition_count from public.group_counts
         where group_id = '61060000-0000-4000-8000-000000000101' $q$) into v_anna;
  if v_anna is distinct from '2/2' then
    raise exception 'Anna skal se 2 medlemmer og 2 konkurrencer, så: %', coalesce(v_anna, '(ingen række)');
  end if;

  -- Et almindeligt medlem ser det samme som administratoren: tallene er
  -- ligaens, ikke rollens.
  select pg_temp.som('61060000-0000-4000-8000-00000000000b',
    $q$ select member_count || '/' || competition_count from public.group_counts
         where group_id = '61060000-0000-4000-8000-000000000101' $q$) into v_bo;
  if v_bo is distinct from '2/2' then
    raise exception 'Bo er medlem og skal se 2/2, så: %', coalesce(v_bo, '(ingen række)');
  end if;

  -- Påstand 3: fremmeden får slet ingen række. Fejler et `with
  -- (security_invoker = on)`, svarer denne linje '2/2' i stedet for null, og
  -- viewet er da en offentlig optælling af enhver ligas størrelse.
  select pg_temp.som('61060000-0000-4000-8000-00000000000f',
    $q$ select member_count || '/' || competition_count from public.group_counts
         where group_id = '61060000-0000-4000-8000-000000000101' $q$) into v_fremmed;
  if v_fremmed is not null then
    raise exception 'en fremmed må ikke kunne læse ligaens tal, så: %', v_fremmed;
  end if;

  raise notice 'OK 2+3: tallene er rigtige for medlemmer og usynlige for fremmede';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Viewet svarer det samme, som klienten selv talte
-- ---------------------------------------------------------------------------
-- Den gamle vej hentede rækkerne og talte listen; den nye spørger viewet. Målt
-- gennem SAMME session gælder RLS begge steder, så et afvigende tal ville
-- betyde, at migreringen havde ændret hvad brugeren ser — og ikke kun hvor det
-- blev talt.
do $$
declare v_afvig text;
begin
  select pg_temp.som('61060000-0000-4000-8000-00000000000a', $q$
    select coalesce(string_agg(v.group_id::text, ','), '')
      from public.group_counts v
      join (select g.id,
                   (select count(*) from public.group_members m where m.group_id = g.id) as m,
                   (select count(*) from public.competitions  c where c.group_id = g.id) as k
              from public.groups g) f on f.id = v.group_id
     where v.member_count <> f.m or v.competition_count <> f.k
  $q$) into v_afvig;

  if v_afvig <> '' then
    raise exception 'viewet er uenigt med den optælling, klienten lavede, for: %', v_afvig;
  end if;
  raise notice 'OK 4: viewet svarer ordret det, klienten selv talte';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Over PostgRESTs loft
-- ---------------------------------------------------------------------------
-- 1.001 medlemmer er ét mere end det svar, PostgREST højst leverer. Den gamle
-- vej ville have set 1000 rækker og skrevet 1000 uden at kunne vide bedre;
-- viewet svarer 1001, fordi tallet aldrig forlader databasen som rækker.
do $$
declare v_tal text;
begin
  insert into auth.users (id, email)
  select ('61060000-0000-4000-9000-' || lpad(i::text, 12, '0'))::uuid, 'm' || i || '@test.local'
    from generate_series(1, 999) i;
  insert into public.profiles (id, display_name)
  select ('61060000-0000-4000-9000-' || lpad(i::text, 12, '0'))::uuid, 'Medlem ' || i
    from generate_series(1, 999) i;
  insert into public.group_members (group_id, user_id, role)
  select '61060000-0000-4000-8000-000000000101',
         ('61060000-0000-4000-9000-' || lpad(i::text, 12, '0'))::uuid, 'member'
    from generate_series(1, 999) i;

  select pg_temp.som('61060000-0000-4000-8000-00000000000a',
    $q$ select member_count::text from public.group_counts
         where group_id = '61060000-0000-4000-8000-000000000101' $q$) into v_tal;
  if v_tal is distinct from '1001' then
    raise exception 'over loftet skal viewet stadig svare 1001, svarede: %', coalesce(v_tal, '(ingen)');
  end if;
  raise notice 'OK 5: optællingen holder over PostgRESTs loft';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Idempotens
-- ---------------------------------------------------------------------------
\ir ../group_counts.sql

do $$
declare v_tal text;
begin
  select pg_temp.som('61060000-0000-4000-8000-00000000000a',
    $q$ select member_count || '/' || competition_count from public.group_counts
         where group_id = '61060000-0000-4000-8000-000000000101' $q$) into v_tal;
  if v_tal is distinct from '1001/2' then
    raise exception 'anden kørsel ændrede svaret: %', coalesce(v_tal, '(ingen)');
  end if;
  raise notice 'OK 6: migreringen er idempotent';
end $$;

\echo 'ALLE PÅSTANDE BESTÅET (group_counts)'
