-- Test af `sql/checks/league_admin_coverage.sql` (A37).
--
-- Kører mod en TOM engangsdatabase. Rører aldrig produktion.
--
-- HVAD DEN BEVISER
--   1. En sund liga (levende admin) er `ok`.
--   2. **Regressionen:** en liga, hvis ENESTE admin har lukket sin konto, melder
--      `INGEN LEVENDE ADMIN`. Det er `A37` ordret.
--   3. En liga med TO admins, hvoraf den ene har lukket, er `ok`. Kontrollen må
--      ikke være en andel og må ikke råbe, fordi der findes et pseudonym på
--      listen — det gør `A36`, og det er et andet spørgsmål.
--   4. En lukket konto, der kun er MEDLEM, gør ikke ligaen rød. Uden den påstand
--      ville kontrollen reelt måle `A36` og ikke `A37`, og de to har
--      modsatrettede rettelser.
--   5. En liga UDEN medlemmer overhovedet meldes rød og forsvinder ikke.
--      Et indre join ville skjule det værste tilfælde.
--   6. `opretter_lukket` skelner de to måder at ende frossen på — opretteren
--      lukkede selv, eller opretteren er væk af en anden grund.
--
-- Testen findes af samme grund som kontrollen. `A37` blev ikke fundet af en
-- gennemlæsning, men af en KØRSEL, og hvert af de tre led, der ganger op til
-- den, ser rigtigt ud for sig. En kontrol, der er skrevet men aldrig kørt, er
-- nøjagtig den slags kode, `G72` og `G76` er rækker om — og `G84`s lære var, at
-- en test, man ikke har set fejle, er en formodning.

\set ON_ERROR_STOP on
\timing off

-- Kun de kolonner, kontrollen læser.
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  anonymized_at timestamptz
);
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references public.profiles(id)
);
create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  primary key (group_id, user_id)
);

-- ---------- personer ----------
insert into public.profiles (id, display_name, anonymized_at) values
  ('11111111-1111-4111-8111-000000000001', 'Anna',              null),
  ('11111111-1111-4111-8111-000000000002', 'Bo',                null),
  ('11111111-1111-4111-8111-000000000003', 'Slettet aaaaaaaa',  now()),
  ('11111111-1111-4111-8111-000000000004', 'Slettet bbbbbbbb',  now());

-- ---------- ligaer ----------
insert into public.groups (id, name, created_by) values
  -- 1: sund
  ('22222222-2222-4222-8222-000000000001', 'Sund liga',
     '11111111-1111-4111-8111-000000000001'),
  -- 2: eneste admin har lukket  → A37
  ('22222222-2222-4222-8222-000000000002', 'Frossen liga',
     '11111111-1111-4111-8111-000000000003'),
  -- 3: to admins, den ene lukket
  ('22222222-2222-4222-8222-000000000003', 'To admins',
     '11111111-1111-4111-8111-000000000001'),
  -- 4: lukket konto som almindeligt MEDLEM  → A36, ikke A37
  ('22222222-2222-4222-8222-000000000004', 'Lukket medlem',
     '11111111-1111-4111-8111-000000000001'),
  -- 5: ingen medlemmer overhovedet
  ('22222222-2222-4222-8222-000000000005', 'Tom liga',
     '11111111-1111-4111-8111-000000000001');

insert into public.group_members (group_id, user_id, role) values
  ('22222222-2222-4222-8222-000000000001', '11111111-1111-4111-8111-000000000001', 'admin'),
  ('22222222-2222-4222-8222-000000000001', '11111111-1111-4111-8111-000000000002', 'member'),

  ('22222222-2222-4222-8222-000000000002', '11111111-1111-4111-8111-000000000003', 'admin'),
  ('22222222-2222-4222-8222-000000000002', '11111111-1111-4111-8111-000000000002', 'member'),

  ('22222222-2222-4222-8222-000000000003', '11111111-1111-4111-8111-000000000001', 'admin'),
  ('22222222-2222-4222-8222-000000000003', '11111111-1111-4111-8111-000000000004', 'admin'),

  ('22222222-2222-4222-8222-000000000004', '11111111-1111-4111-8111-000000000001', 'admin'),
  ('22222222-2222-4222-8222-000000000004', '11111111-1111-4111-8111-000000000003', 'member');

-- ---------- kontrollen, ordret som i produktion ----------
\ir ../checks/league_admin_coverage.sql

-- ---------- påstandene ----------
do $blk$
declare
  r record;
begin
  -- 1) sund liga
  select * into r from league_admin_coverage where liga = 'Sund liga';
  if r.tilstand <> 'ok' then
    raise exception '1) Sund liga: forventede ok, fik %', r.tilstand;
  end if;
  if r.levende_admins <> 1 or r.medlemmer <> 2 or r.lukkede <> 0 then
    raise exception '1) Sund liga: forkerte tal (% admins, % medlemmer, % lukkede)',
      r.levende_admins, r.medlemmer, r.lukkede;
  end if;

  -- 2) REGRESSIONEN: eneste admin har lukket
  select * into r from league_admin_coverage where liga = 'Frossen liga';
  if r.tilstand <> 'INGEN LEVENDE ADMIN' then
    raise exception '2) Frossen liga: forventede alarm, fik %', r.tilstand;
  end if;
  if r.levende_admins <> 0 then
    raise exception '2) Frossen liga: forventede 0 levende admins, fik %', r.levende_admins;
  end if;
  if not r.opretter_lukket then
    raise exception '2) Frossen liga: opretter_lukket burde være sand';
  end if;

  -- 3) to admins, den ene lukket → stadig ok
  select * into r from league_admin_coverage where liga = 'To admins';
  if r.tilstand <> 'ok' then
    raise exception '3) To admins: én levende admin er nok, fik %', r.tilstand;
  end if;
  if r.lukkede <> 1 then
    raise exception '3) To admins: forventede 1 lukket, fik %', r.lukkede;
  end if;

  -- 4) lukket konto som MEDLEM er A36 og ikke A37
  select * into r from league_admin_coverage where liga = 'Lukket medlem';
  if r.tilstand <> 'ok' then
    raise exception '4) Lukket medlem: et pseudonym på listen er ikke en alarm, fik %', r.tilstand;
  end if;
  if r.lukkede <> 1 or r.levende_admins <> 1 then
    raise exception '4) Lukket medlem: forkerte tal (% lukkede, % levende admins)',
      r.lukkede, r.levende_admins;
  end if;

  -- 5) tom liga forsvinder ikke
  select * into r from league_admin_coverage where liga = 'Tom liga';
  if not found then
    raise exception '5) Tom liga: rækken forsvandt — left join er brudt';
  end if;
  if r.tilstand <> 'INGEN LEVENDE ADMIN' or r.medlemmer <> 0 then
    raise exception '5) Tom liga: forventede alarm og 0 medlemmer, fik % / %',
      r.tilstand, r.medlemmer;
  end if;

  -- 6) opretter_lukket skelner
  select * into r from league_admin_coverage where liga = 'Sund liga';
  if r.opretter_lukket then
    raise exception '6) Sund liga: opretter_lukket burde være falsk';
  end if;

  raise notice 'Alle seks påstande holdt.';
end $blk$;

-- Samlet: præcis to ligaer må være røde.
do $blk$
declare
  n int;
begin
  select count(*) into n from league_admin_coverage where tilstand = 'INGEN LEVENDE ADMIN';
  if n <> 2 then
    raise exception 'Forventede præcis 2 røde ligaer, fik %', n;
  end if;
end $blk$;
