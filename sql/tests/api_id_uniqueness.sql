-- Test af unique-constraints på leverandør-id'erne (sql/api_id_uniqueness.sql, G7).
--
-- Kører mod en TOM engangsdatabase (CI: postgres-service). Rører aldrig
-- produktion. Samme mønster som competition_awards.sql.
--
-- HVAD DEN BEVISER
--   1. De tre constraints kommer på en ren database.
--   2. De tre LOVLIGE gentagelser er stadig lovlige — og det er hele grunden
--      til, at omfanget ikke er globalt:
--        · samme klub i to turneringer (Arsenal i PL og i CL, begge `fd:57`)
--        · samme api_season_id i to turneringer ('2026' i alle fem
--          football-data-turneringer)
--        · samme api_league_id hos to leverandører
--      Bliver en af de tre nogensinde afvist, er constrainten strammet for
--      meget, og Champions League kan ikke synkroniseres.
--   3. De tre ÆGTE dubletter afvises — én pr. tabel.
--   4. Dublet-vagten fejler højlydt og LADER VÆRE med at sætte constrainten,
--      hvis dataene er beskidte i forvejen.
--
-- Punkt 2 er det, testen egentlig findes for. Punkt 3 ville et hvilket som
-- helst unique-indeks bestå; punkt 2 består kun det, der har det rigtige
-- omfang.

\set ON_ERROR_STOP on
\timing off

-- ---------- minimalt skema ----------
-- Kun de tre kolonner, migreringen rører, plus det, fremmednøglerne kræver.
-- Ingen auth, ingen RLS: filen sætter ingen af delene.
create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  api_league_id text,
  provider text not null default 'sportmonks'
);
create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  name text not null,
  api_season_id text
);
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  name text not null,
  api_team_id text
);

-- ---------- fixture: verden som den faktisk ser ud i produktion ----------
-- Superligaen hos Sportmonks (tal-id'er) + to football-data-turneringer, hvor
-- Arsenal spiller begge steder og begge sæsoner hedder '2026'.
insert into public.leagues (id, name, api_league_id, provider) values
  ('a0000000-0000-0000-0000-000000000001', 'Superligaen',       '271', 'sportmonks'),
  ('a0000000-0000-0000-0000-000000000002', 'Premier League',    'PL',  'footballdata'),
  ('a0000000-0000-0000-0000-000000000003', 'Champions League',  'CL',  'footballdata');

insert into public.seasons (league_id, name, api_season_id) values
  ('a0000000-0000-0000-0000-000000000002', '2026/2027', '2026'),
  ('a0000000-0000-0000-0000-000000000003', '2026/2027', '2026');

insert into public.teams (league_id, name, api_team_id) values
  ('a0000000-0000-0000-0000-000000000002', 'Arsenal FC', 'fd:57'),
  ('a0000000-0000-0000-0000-000000000003', 'Arsenal FC', 'fd:57');

-- ---------- 1) migreringen kører på ren (men gentagelses-rig) data ----------
\ir ../api_id_uniqueness.sql

do $$
declare n int;
begin
  select count(*) into n from pg_constraint where conname in (
    'leagues_provider_api_id_unique', 'seasons_league_api_id_unique', 'teams_league_api_id_unique');
  if n <> 3 then raise exception 'forventede 3 constraints, fandt %', n; end if;
end $$;

-- ---------- 2) de lovlige gentagelser er stadig lovlige ----------
-- Bemærk at fixturet ovenfor ALLEREDE indeholder alle tre; at migreringen
-- overhovedet kunne køre, er derfor halvdelen af beviset. Her efterprøves den
-- anden halvdel: at de også kan tilføjes EFTER constrainten.
do $$
declare lg uuid := 'a0000000-0000-0000-0000-000000000004';
begin
  -- En fjerde turnering hos football-data, som deler både sæson-id og en klub
  -- med de to andre.
  insert into public.leagues (id, name, api_league_id, provider)
    values (lg, 'Bundesliga', 'BL1', 'footballdata');
  insert into public.seasons (league_id, name, api_season_id) values (lg, '2026/2027', '2026');
  insert into public.teams (league_id, name, api_team_id) values (lg, 'Arsenal FC', 'fd:57');

  -- Og en Sportmonks-turnering, hvis id tilfældigvis er det samme som en
  -- football-data-kode. Det sker ikke i dag, men det er præcis dét, `provider`
  -- i constrainten gør ufarligt.
  insert into public.leagues (name, api_league_id, provider) values ('Skygge-PL', 'PL', 'sportmonks');
end $$;

-- ---------- 3) de ægte dubletter afvises ----------
-- Én pr. tabel. `sqlstate '23505'` er unique_violation; enhver anden fejl (fx
-- en tastefejl i kolonnenavnet) skal stadig vælte testen, så der fanges IKKE
-- bredt med `others`.
do $$
declare hit int := 0;
begin
  begin
    insert into public.leagues (name, api_league_id, provider) values ('Superligaen igen', '271', 'sportmonks');
  exception when sqlstate '23505' then hit := hit + 1;
  end;

  begin
    insert into public.seasons (league_id, name, api_season_id)
      values ('a0000000-0000-0000-0000-000000000002', '2026/2027 igen', '2026');
  exception when sqlstate '23505' then hit := hit + 1;
  end;

  -- Den, migreringen egentlig findes for: to samtidige sync-kørsler, der
  -- begge indsætter det samme hold i den samme turnering.
  begin
    insert into public.teams (league_id, name, api_team_id)
      values ('a0000000-0000-0000-0000-000000000002', 'Arsenal', 'fd:57');
  exception when sqlstate '23505' then hit := hit + 1;
  end;

  if hit <> 3 then raise exception 'forventede 3 afviste dubletter, fik %', hit; end if;
end $$;

-- ---------- 4) vagten mod dubletter, der findes i forvejen ----------
-- Constrainten fjernes, en dublet lægges ind, og migreringen køres igen.
-- Vagten skal fejle FØR alter-sætningen, så constrainten IKKE kommer tilbage.
--
-- ON_ERROR_STOP slås fra, mens filen køres: uden det ville psql stoppe hele
-- testen på den forventede fejl. Bemærk følgen — psql fortsætter til de
-- efterfølgende sætninger i den inkluderede fil, så de to andre constraints
-- bliver sat igen (de har ingen dubletter), og alter-sætningen for `teams`
-- fejler bagefter med Postgres' egen tekst. Kørslen støjer derfor med TO
-- fejl, og begge er forventede.
--
-- Hvad påstanden herunder derfor beviser præcist: **beskidte data ⇒ ingen
-- constraint, rene data ⇒ constraint**. Den kan ikke skelne, om det var
-- vagten eller selve indekset, der sagde fra — det er hele grunden til, at
-- vagten findes (den ene fejl nævner rækkerne ved navn, den anden ét par
-- uden navne), men forskellen er en læsbarhed, ikke en adfærd, og kan kun
-- ses i kørslens output.
alter table public.teams drop constraint teams_league_api_id_unique;
insert into public.teams (league_id, name, api_team_id)
  values ('a0000000-0000-0000-0000-000000000002', 'Arsenal F.C.', 'fd:57');

\set ON_ERROR_STOP off
\ir ../api_id_uniqueness.sql
\set ON_ERROR_STOP on

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'teams_league_api_id_unique') then
    raise exception 'vagten lod constrainten komme på trods af en eksisterende dublet';
  end if;
end $$;

-- Og når dubletten er ryddet, kan filen køres igen uden ændringer.
delete from public.teams where name = 'Arsenal F.C.';
\ir ../api_id_uniqueness.sql

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'teams_league_api_id_unique') then
    raise exception 'constrainten kom ikke på, efter dubletten var ryddet';
  end if;
end $$;

\echo 'api_id_uniqueness: OK'
