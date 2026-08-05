-- Test af `sql/liga_admin.sql` — hvad en administrator må.
--
-- Kører mod en TOM engangsdatabase. Rører aldrig produktion.
--
-- HVAD DEN BEVISER
--
-- Den ene regel, alle tre liga-policies er skåret efter, er "en administrator må
-- fjerne det URØRTE, aldrig det brugte". Testen findes for at holde den regel i
-- live, for begge halvdele er usynlige i data: en policy, der er for STRAM,
-- viser sig som en knap, der ikke virker (og bliver opdaget); en policy, der er
-- for LØS, viser sig som en andens historik, der forsvandt — og det opdages
-- ikke, for der er ikke noget tilbage at opdage det på.
--
--   1. Liga-admin kan fjerne en deltager UDEN tips fra en konkurrence.
--   2. Liga-admin kan IKKE fjerne en deltager, der har tippet.
--   3. Et almindeligt medlem kan ikke fjerne nogen — heller ikke en utippet.
--   4. Liga-admin kan ikke bruge admin-policyen på SIG SELV (egen framelding har
--      sine egne, strengere regler et andet sted).
--   5. Liga-admin kan slette en konkurrence, ingen har tippet i.
--   6. Liga-admin kan IKKE slette en konkurrence, der er tippet i.
--   7. Liga-admin kan slette en liga, hvor alle konkurrencer er AFSLUTTEDE …
--   8. … og ikke en, hvor en konkurrence stadig er i gang.
--   9. `anonymize_my_account()` har stadig NUL parametre efter opdelingen.
--  10. `_anonymize_account()` kan ikke kaldes af en bruger.
--  11. `admin_anonymize_account()` afviser en ikke-admin, sig selv og en anden
--      administrator — og virker på en almindelig bruger.
--  12. En lukket konto meldes af de konkurrencer, der IKKE er begyndt (A25) —
--      og bliver i dem, der er, også når den lukkede aldrig har tippet i dem.

\set ON_ERROR_STOP on
\timing off

do $blk$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $blk$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $q$ select nullif(current_setting('test.uid', true), '')::uuid $q$;
create table if not exists auth.users (id uuid primary key);

-- ---------- skema ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  is_admin boolean not null default false,
  last_seen_at timestamptz
);
create unique index profiles_display_name_lower_idx on public.profiles (lower(display_name));
alter table public.profiles add constraint profiles_display_name_len
  check (char_length(btrim(display_name)) between 2 and 20);

-- Anonymiseringens ryddetabeller.
create table public.push_subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, endpoint text);
create table public.notification_log   (user_id uuid not null references auth.users(id) on delete cascade, key text, primary key (user_id, key));
create table public.stories            (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, headline text);
create table public.analytics_events   (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, event_name text);
create table public.user_activity_days (user_id uuid not null references auth.users(id) on delete cascade, day date, primary key (user_id, day));
create table public.feedback           (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null, message text);
create table public.client_errors      (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null, message text);

-- Liga-laget og konkurrencerne.
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references public.profiles(id) on delete cascade
);
create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',
  primary key (group_id, user_id)
);
create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mode text not null default 'custom',
  mode_params jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  group_id uuid references public.groups(id) on delete set null
);
create table public.competition_participants (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  hidden boolean not null default false,
  primary key (competition_id, user_id)
);
create table public.leagues (id uuid primary key default gen_random_uuid(), name text not null);
create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete cascade,
  name text
);
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  kickoff_at timestamptz not null,
  kickoff_tbd boolean not null default false,
  home_score int, away_score int
);
create table public.competition_matches (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  primary key (competition_id, match_id)
);
create table public.predictions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  pred_home int, pred_away int,
  primary key (user_id, match_id)
);

-- Låsen fra sql/matches_kickoff_tbd.sql (#28), som A25-frameldingen i afsnit 4
-- kalder. Hele migreringen kan ikke køres her: den genskaber også de fem
-- predictions-policies og viewet `analytics_match_locks`, og de kræver et skema,
-- denne test bevidst ikke har. De to funktioner er kopieret ORDRET — ændres
-- låsen, ændres den i #28, og denne kopi skal følge med.
create or replace function public.match_lock_at(kickoff_at timestamptz, kickoff_tbd boolean)
  returns timestamptz language sql stable as $q$
  select case
    when kickoff_at is null then null
    when kickoff_tbd then
      date_trunc('day', kickoff_at at time zone 'Europe/Copenhagen')
        at time zone 'Europe/Copenhagen'
    else kickoff_at - interval '1 hour'
  end;
$q$;
create or replace function public.match_locked(kickoff_at timestamptz, kickoff_tbd boolean)
  returns boolean language sql stable as $q$
  select coalesce(public.match_lock_at(kickoff_at, kickoff_tbd) <= now(), false);
$q$;

-- Security definer-hjælperen fra sql/groups.sql — den, policyerne kalder.
create or replace function public.is_group_admin(gid uuid)
returns boolean language sql security definer set search_path = public stable as $q$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid() and role = 'admin'
  );
$q$;

grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function public.is_group_admin(uuid) to authenticated;
grant select on all tables in schema public to authenticated;
grant delete on public.competition_participants, public.competitions, public.groups to authenticated;

-- RLS kun på de tre tabeller, policyerne handler om. Hjælpetabellerne
-- (predictions, competition_matches) står uden, så testen måler policy-logikken
-- og ikke de andre tabellers egne policies.
alter table public.competition_participants enable row level security;
alter table public.competitions enable row level security;
alter table public.groups enable row level security;

-- Læsepolicyerne fra produktion. De er ikke pynt: policyerne under test slår
-- selv op i `competitions`, og uden en SELECT-policy dér ser deres `exists`
-- ingen rækker — så ville testen bevise, at reglen er stram, uden at have
-- afprøvet den.
create policy t_read_competitions on public.competitions for select to authenticated using (true);
create policy t_read_participants on public.competition_participants for select to authenticated using (true);
create policy t_read_groups on public.groups for select to authenticated using (true);
-- Opretter-policyen fra produktion — den skal være med, for testen af
-- admin-vejen består i, at den ANDEN policy ikke rækker.
create policy t_creator_deletes on public.competitions for delete to authenticated using (created_by = auth.uid());

-- ---------- migreringerne under test ----------
-- Rækkefølgen er produktionens: account_anonymization.sql lægger
-- `profiles.anonymized_at` og den oprindelige `anonymize_my_account()`, og
-- liga_admin.sql deler den op bagefter. At køre dem i den rækkefølge er
-- samtidig en test af, at opdelingen faktisk kan lægges oven på den gamle fil.
\ir ../account_anonymization.sql
\ir ../season_end.sql
\ir ../liga_admin.sql

-- ---------- data ----------
-- Ligaen "Vennerne": ADMIN er liga-admin, MEDLEM er almindeligt medlem,
-- TIPPER har tippet, TAVS har aldrig tippet.
insert into auth.users (id) values
  ('a0000000-0000-0000-0000-000000000001'),  -- ADMIN (liga-admin)
  ('a0000000-0000-0000-0000-000000000002'),  -- MEDLEM
  ('a0000000-0000-0000-0000-000000000003'),  -- TIPPER
  ('a0000000-0000-0000-0000-000000000004'),  -- TAVS
  ('a0000000-0000-0000-0000-000000000005'),  -- GLOBAL (is_admin)
  ('a0000000-0000-0000-0000-000000000006');  -- ANDEN-ADMIN (is_admin)

insert into public.profiles (id, display_name, is_admin) values
  ('a0000000-0000-0000-0000-000000000001', 'Admin',  false),
  ('a0000000-0000-0000-0000-000000000002', 'Medlem', false),
  ('a0000000-0000-0000-0000-000000000003', 'Tipper', false),
  ('a0000000-0000-0000-0000-000000000004', 'Tavs',   false),
  ('a0000000-0000-0000-0000-000000000005', 'Global', true),
  ('a0000000-0000-0000-0000-000000000006', 'Anden',  true);

insert into public.groups (id, name, created_by) values
  ('90000000-0000-0000-0000-000000000001', 'Vennerne', 'a0000000-0000-0000-0000-000000000001');

insert into public.group_members (group_id, user_id, role) values
  ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'admin'),
  ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'member'),
  ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'member'),
  ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', 'member');

insert into public.seasons (id, name, is_finished) values
  ('50000000-0000-0000-0000-000000000001', 'Færdig sæson', true);

-- To kampe: én spillet, én uspillet.
insert into public.matches (id, season_id, kickoff_at, home_score, away_score) values
  ('10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', now() - interval '40 days', 2, 1),
  ('10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', now() + interval '2 days', null, null);

-- TIPPET: en afsluttet konkurrence, TIPPER har tippet i den.
-- URØRT:  en konkurrence med samme spillede kamp, som ingen har tippet i.
-- AKTIV:  en konkurrence med den uspillede kamp — altså stadig i gang.
insert into public.competitions (id, name, group_id, created_by) values
  ('c0000000-0000-0000-0000-000000000001', 'Tippet',  '90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002', 'Urørt',   '90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000003', 'Aktiv',   '90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001');

insert into public.competition_matches (competition_id, match_id) values
  ('c0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002');

insert into public.competition_participants (competition_id, user_id) values
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003'),
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004'),
  -- TAVS er også med i "Urørt" — og har aldrig tippet. Den konkurrence deler
  -- kamp med "Tippet", som TIPPER HAR tippet, og TIPPER er ikke med i "Urørt".
  -- Det er præcis den stilling, der skiller "nogen har tippet kampen" fra
  -- "nogen af DELTAGERNE har tippet".
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000004');

insert into public.predictions (user_id, match_id, pred_home, pred_away) values
  ('a0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 2, 1);

-- ---------- hjælper: kør en sætning som en bestemt bruger ----------
create or replace function pg_temp.slet(p_uid uuid, p_sql text) returns int
language plpgsql as $q$
declare n int;
begin
  perform set_config('test.uid', p_uid::text, true);
  set local role authenticated;
  execute p_sql;
  get diagnostics n = row_count;
  reset role;
  return n;
end $q$;

-- ---------- 1–4: fjern en deltager ----------
do $$
declare
  liga_admin uuid := 'a0000000-0000-0000-0000-000000000001';
  medlem     uuid := 'a0000000-0000-0000-0000-000000000002';
  n int;
begin
  -- 3) Et almindeligt medlem kan ikke fjerne den tavse deltager.
  n := pg_temp.slet(medlem, $q$delete from public.competition_participants
        where competition_id = 'c0000000-0000-0000-0000-000000000001'
          and user_id = 'a0000000-0000-0000-0000-000000000004'$q$);
  if n <> 0 then raise exception '3) et almindeligt medlem fjernede en deltager'; end if;

  -- 2) Liga-admin kan ikke fjerne den, der har tippet.
  n := pg_temp.slet(liga_admin, $q$delete from public.competition_participants
        where competition_id = 'c0000000-0000-0000-0000-000000000001'
          and user_id = 'a0000000-0000-0000-0000-000000000003'$q$);
  if n <> 0 then raise exception '2) liga-admin fjernede en deltager, der havde tippet'; end if;

  -- 4) Liga-admin kan ikke bruge admin-policyen på sig selv.
  n := pg_temp.slet(liga_admin, $q$delete from public.competition_participants
        where competition_id = 'c0000000-0000-0000-0000-000000000001'
          and user_id = 'a0000000-0000-0000-0000-000000000001'$q$);
  if n <> 0 then raise exception '4) liga-admin frameldte sig selv gennem admin-policyen'; end if;

  -- 1) …men kan fjerne den, der aldrig har tippet.
  n := pg_temp.slet(liga_admin, $q$delete from public.competition_participants
        where competition_id = 'c0000000-0000-0000-0000-000000000001'
          and user_id = 'a0000000-0000-0000-0000-000000000004'$q$);
  if n <> 1 then raise exception '1) liga-admin kunne ikke fjerne en deltager uden tips (rækker: %)', n; end if;
end $$;

-- ---------- 5–6: slet en konkurrence ----------
do $$
declare
  liga_admin uuid := 'a0000000-0000-0000-0000-000000000001';
  n int;
begin
  -- 6) Den tippede konkurrence kan ikke slettes af admin-policyen.
  --    (`created_by` er admin selv i disse data, så opretter-policyen skal ud af
  --    billedet for at måle den rigtige ting — derfor peges den om først.)
  update public.competitions set created_by = 'a0000000-0000-0000-0000-000000000003'
   where id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002');

  n := pg_temp.slet(liga_admin, $q$delete from public.competitions
        where id = 'c0000000-0000-0000-0000-000000000001'$q$);
  if n <> 0 then raise exception '6) liga-admin slettede en konkurrence, der var tippet i'; end if;

  -- 5) Den urørte kan — selvom dens ENE kamp er tippet af en, der ikke er med.
  --    Tips er globale pr. kamp, så et tip fra en udenforstående må ikke låse en
  --    konkurrence, ingen af deltagerne har rørt.
  n := pg_temp.slet(liga_admin, $q$delete from public.competitions
        where id = 'c0000000-0000-0000-0000-000000000002'$q$);
  if n <> 1 then raise exception '5) liga-admin kunne ikke slette en utippet konkurrence (rækker: %)', n; end if;
end $$;

-- ---------- 7–8: slet ligaen ----------
do $$
declare
  liga_admin uuid := 'a0000000-0000-0000-0000-000000000001';
  n int;
begin
  -- 8) "Aktiv" er stadig i gang (uspillet kamp), så ligaen er spærret.
  n := pg_temp.slet(liga_admin, $q$delete from public.groups
        where id = '90000000-0000-0000-0000-000000000001'$q$);
  if n <> 0 then raise exception '8) ligaen blev slettet, mens en konkurrence var i gang'; end if;

  -- 7) Spilles kampen færdig, er alt afsluttet, og ligaen kan lukkes.
  update public.matches set home_score = 1, away_score = 1, kickoff_at = now() - interval '1 day'
   where id = '10000000-0000-0000-0000-000000000002';
  n := pg_temp.slet(liga_admin, $q$delete from public.groups
        where id = '90000000-0000-0000-0000-000000000001'$q$);
  if n <> 1 then raise exception '7) ligaen kunne ikke slettes, selvom alt var afsluttet (rækker: %)', n; end if;

  -- Konkurrencerne overlevede som liga-løse — det er hele grunden til, at
  -- reglen tør være løsere end den gamle.
  if exists (select 1 from public.competitions where group_id is not null) then
    raise exception '7b) en konkurrence beholdt sit liga-tilhør efter sletningen';
  end if;
  if (select count(*) from public.competitions) <> 2 then
    raise exception '7c) liga-sletningen tog konkurrencer med sig';
  end if;
end $$;

-- ---------- 9–11: anonymiseringen ----------
do $$
declare
  global uuid := 'a0000000-0000-0000-0000-000000000005';
  anden  uuid := 'a0000000-0000-0000-0000-000000000006';
  tipper uuid := 'a0000000-0000-0000-0000-000000000003';
  medlem uuid := 'a0000000-0000-0000-0000-000000000002';
  n int;
  navn text;
begin
  -- 9) Den egne vej har stadig nul parametre.
  select pronargs into n from pg_proc where proname = 'anonymize_my_account';
  if n <> 0 then raise exception '9) anonymize_my_account fik % parametre', n; end if;

  -- 10) Den interne krop er ikke kaldbar for en bruger.
  if has_function_privilege('authenticated', 'public._anonymize_account(uuid)', 'execute') then
    raise exception '10) _anonymize_account kan kaldes af authenticated';
  end if;

  -- 11a) En ikke-admin afvises.
  perform set_config('test.uid', medlem::text, true);
  begin
    perform public.admin_anonymize_account(tipper);
    raise exception '11a) en ikke-admin kunne lukke en anden konto';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;

  -- 11b) En admin kan ikke lukke sig selv herfra.
  perform set_config('test.uid', global::text, true);
  begin
    perform public.admin_anonymize_account(global);
    raise exception '11b) en admin lukkede sin egen konto gennem admin-vejen';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'Din egen konto%' then raise; end if;
  end;

  -- 11c) …og heller ikke en anden administrator.
  begin
    perform public.admin_anonymize_account(anden);
    raise exception '11c) en admin lukkede en anden administrators konto';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'En administrator%' then raise; end if;
  end;

  -- 11d) En almindelig bruger kan lukkes — og tippet står tilbage.
  navn := public.admin_anonymize_account(tipper);
  if navn not like 'Slettet %' then raise exception '11d) pseudonymet blev "%"', navn; end if;
  if not exists (select 1 from public.profiles where id = tipper and anonymized_at is not null) then
    raise exception '11d) anonymized_at blev ikke sat';
  end if;
  if not exists (select 1 from public.predictions where user_id = tipper) then
    raise exception '11d) tippet forsvandt — anonymisering må aldrig røre andres stillinger';
  end if;
end $$;

-- ---------- 12: framelding fra det, der ikke er begyndt (A25) ----------
--
-- Egne data, fordi de foregående afsnit har slettet både ligaen og en
-- konkurrence undervejs. Fire konkurrencer, fordi reglen har fire udfald, og de
-- tre af dem er "lad være":
--
--   IGANG      spillet kamp, LUKKES har ALDRIG tippet   → beholdes
--   KOMMENDE   kun en fremtidig kamp, VEN er også med   → frameldes
--   ALENE      kun en fremtidig kamp, LUKKES er ene     → beholdes
--   TOM        ingen kampe overhovedet, VEN er også med → frameldes
--
-- IGANG er den vigtigste: en deltager uden tips i en igangværende konkurrence
-- står stadig i en stilling, de andre har set. Reglen måler konkurrencen og
-- ikke brugerens tips — havde den målt tips, ville netop den forsvinde.
insert into auth.users (id) values
  ('b0000000-0000-0000-0000-000000000001'),  -- LUKKES
  ('b0000000-0000-0000-0000-000000000002');  -- VEN

insert into public.profiles (id, display_name, is_admin) values
  ('b0000000-0000-0000-0000-000000000001', 'Lukkes', false),
  ('b0000000-0000-0000-0000-000000000002', 'Ven',    false);

insert into public.groups (id, name, created_by) values
  ('91000000-0000-0000-0000-000000000001', 'Naboerne', 'b0000000-0000-0000-0000-000000000002');
insert into public.group_members (group_id, user_id, role) values
  ('91000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'member'),
  ('91000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'admin');

insert into public.matches (id, season_id, kickoff_at, home_score, away_score) values
  ('11000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', now() - interval '3 days', 2, 1),
  ('11000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', now() + interval '10 days', null, null);

insert into public.competitions (id, name, group_id, created_by) values
  ('c1000000-0000-0000-0000-000000000001', 'Igang',    '91000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002'),
  ('c1000000-0000-0000-0000-000000000002', 'Kommende', '91000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002'),
  ('c1000000-0000-0000-0000-000000000003', 'Alene',    '91000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-000000000004', 'Tom',      '91000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002');

insert into public.competition_matches (competition_id, match_id) values
  ('c1000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000002'),
  ('c1000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000002');
  -- "Tom" får bevidst ingen kampe.

insert into public.competition_participants (competition_id, user_id) values
  ('c1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002'),
  ('c1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002'),
  ('c1000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002');

do $$
declare
  global uuid := 'a0000000-0000-0000-0000-000000000005';
  lukkes uuid := 'b0000000-0000-0000-0000-000000000001';
  ven    uuid := 'b0000000-0000-0000-0000-000000000002';
begin
  perform set_config('test.uid', global::text, true);
  perform public.admin_anonymize_account(lukkes);

  -- 12a) De to ikke-begyndte er væk.
  if exists (select 1 from public.competition_participants
              where user_id = lukkes and competition_id = 'c1000000-0000-0000-0000-000000000002') then
    raise exception '12a) pseudonymet blev stående i en konkurrence, der ikke er begyndt';
  end if;
  if exists (select 1 from public.competition_participants
              where user_id = lukkes and competition_id = 'c1000000-0000-0000-0000-000000000004') then
    raise exception '12a) pseudonymet blev stående i en konkurrence uden kampe';
  end if;

  -- 12b) Den igangværende beholdes — også uden ét eneste tip.
  if not exists (select 1 from public.competition_participants
                  where user_id = lukkes and competition_id = 'c1000000-0000-0000-0000-000000000001') then
    raise exception '12b) deltagelsen forsvandt fra en konkurrence, der ER begyndt';
  end if;

  -- 12c) Den sidste deltager frameldes ikke — en tom konkurrence er ny rod.
  if not exists (select 1 from public.competition_participants
                  where user_id = lukkes and competition_id = 'c1000000-0000-0000-0000-000000000003') then
    raise exception '12c) den eneste deltager blev frameldt og efterlod en tom konkurrence';
  end if;

  -- 12d) Ingen andres rækker er rørt, og ingen konkurrence står uden deltagere.
  if (select count(*) from public.competition_participants where user_id = ven) <> 3 then
    raise exception '12d) frameldingen ramte en anden deltager';
  end if;
  if exists (
    select 1 from public.competitions c
    where c.id::text like 'c1000000%'
      and not exists (select 1 from public.competition_participants p where p.competition_id = c.id)
  ) then
    raise exception '12d) en konkurrence endte uden deltagere';
  end if;

  -- 12e) Ligamedlemskabet står. Invarianten er "deltager ⇒ medlem" og rammes
  --      ikke af, at der fjernes i deltager-enden.
  if not exists (select 1 from public.group_members
                  where user_id = lukkes and group_id = '91000000-0000-0000-0000-000000000001') then
    raise exception '12e) ligamedlemskabet forsvandt';
  end if;
end $$;

-- Idempotens: anden kørsel erstatter policies og funktioner uden at fejle.
\ir ../liga_admin.sql

select 'liga_admin: OK' as result;
