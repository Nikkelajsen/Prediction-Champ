-- Test af `sql/checks/kickoff_coverage.sql` (G84).
--
-- Kører mod en TOM engangsdatabase. Rører aldrig produktion.
--
-- HVAD DEN BEVISER
--   1. En sund turnering (kampe med rigtige klokkeslæt) er `ok`.
--   2. **Regressionen:** en turnering, hvor ALLE nært forestående kampe er uden
--      tid, melder `ALLE UDEN TID`. Det er august 2026-fejlen ordret.
--   3. En blandet turnering er `ok` — også ved 4 af 5 uden tid. Kontrollen må
--      ikke være en ANDEL: en terminsliste, hvor de fleste kampe endnu ikke har
--      fået tid, er normal, mens en fejlaflæsning af leverandørens markør rammer
--      alt eller intet.
--   4. Gulvet virker: to kampe, begge uden tid, er `for faa` og ikke en alarm.
--   5. En turnering uden `api_league_id` dømmes slet ikke. Den kan ikke
--      synkroniseres og kan derfor ikke rettes af en synkronisering — det er
--      også dét, der holder staging-simulatorens SIM-liga ude.
--   6. Kampe UDEN FOR vinduet tæller ikke med: en turnering, hvis eneste kampe
--      uden tid ligger måneder ude i fremtiden, er turneringernes NORMALTILSTAND
--      (Superligaen har altid nogle), og en kontrol, der råber ad den, ville
--      blive slukket inden for en uge.
--   7. Spillede kampe tæller ikke med.
--   8. En kamp SENERE I DAG tæller med. Den er hele grunden til, at vinduet
--      starter ved `current_date` og ikke ved `now()`: en kamp uden fastsat tid
--      bærer midnat som pladsholder, så dagens kampe ligger i fortiden fra kl.
--      00.01 UTC — og det er præcis dem, brugeren er ved at få vist forkert.
--
-- Fra `G85` (august 2026) til 17. august 2026 prøvede filen også kontrollens
-- anden markør, `kickoff_uncertain` (`ALLE UBEKRAEFTEDE`). Markøren og dens
-- maskineri blev fjernet igen med #71 — se docs/DECISIONS.md — og punkterne
-- 9–12 røg med.
--
-- Testen findes af samme grund som kontrollen: fejlen, den skal fange, var
-- USYNLIG for alt, vi havde. Enhedstestene efterprøvede, at `kickoff_tbd` kom
-- korrekt MED i rækken — og det gjorde det. En kontrol, der er skrevet men
-- aldrig kørt, er nøjagtig den slags kode, `G72` og `G76` er rækker om.

\set ON_ERROR_STOP on
\timing off

-- Kun de kolonner, kontrollen læser. `matches.round_key`/`match_day` er
-- genererede kolonner oven på `round_key()`/`match_day()` i produktion; de er
-- udeladt, fordi forespørgslen ikke rører dem, og fordi funktionerne ville
-- trække to migreringer med ind i en test af en enkelt forespørgsel.
create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text not null default 'sportmonks',
  api_league_id text
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  kickoff_at timestamptz not null,
  kickoff_tbd boolean not null default false,
  home_score int
);

-- Hjælper: læg n kampe i en turnering, relativt til i dag.
create function pg_temp.kampe(
  p_liga text,
  p_antal int,
  p_dage_frem int,
  p_tbd boolean,
  p_spillet boolean default false
) returns void language plpgsql as $$
declare
  v_sæson uuid;
begin
  select s.id into v_sæson
    from public.seasons s join public.leagues l on l.id = s.league_id
   where l.name = p_liga;

  insert into public.matches (season_id, kickoff_at, kickoff_tbd, home_score)
  select v_sæson,
         -- En TBD-kamp bærer midnat som pladsholder, præcis som i produktionen;
         -- en kamp med tid lægges kl. 19.00. Forskellen er ikke pynt: det er
         -- den, der gør punkt 8 til en rigtig prøve.
         (current_date + p_dage_frem)::timestamptz
           + case when p_tbd then interval '0 hours' else interval '19 hours' end,
         p_tbd,
         case when p_spillet then 1 else null end
    from generate_series(1, p_antal);
end $$;

insert into public.leagues (name, provider, api_league_id) values
  ('Superligaen',    'sportmonks',  '271'),
  ('La Liga',        'footballdata', 'PD'),
  ('Serie A',        'footballdata', 'SA'),
  ('Ligue 1',        'footballdata', 'FL1'),
  ('I dag',          'footballdata', 'TD'),
  ('SIM-ligaen',     'sportmonks',   null);
insert into public.seasons (league_id) select id from public.leagues;

-- 1) Sund turnering: seks kampe med tid inden for vinduet …
select pg_temp.kampe('Superligaen', 6, 3, false);
-- 6) … plus to uden tid LANGT ude i fremtiden. Det er normaltilstanden, og den
--    må ikke kunne ses i kontrollen overhovedet.
select pg_temp.kampe('Superligaen', 2, 120, true);
-- 7) … plus en spillet kamp uden tid inden for vinduet.
select pg_temp.kampe('Superligaen', 1, 1, true, true);

-- 2) Regressionen: alle fem nært forestående kampe uden tid.
select pg_temp.kampe('La Liga', 5, 4, true);

-- 3) Blandet: FIRE uden tid og én med. Tallet er valgt, så det slår enhver
--    andels-tærskel under 100 % ihjel — en test med 2 af 5 ville stå grøn, hvis
--    nogen skrev reglen om til "mindst halvdelen", og den mutation er præcis
--    den, kontrollen skal kunne modstå.
select pg_temp.kampe('Serie A', 4, 5, true);
select pg_temp.kampe('Serie A', 1, 5, false);

-- 4) Under gulvet: to kampe, begge uden tid.
select pg_temp.kampe('Ligue 1', 2, 2, true);

-- 5) Uden leverandør-id: fem uden tid, og alligevel ingen dom.
select pg_temp.kampe('SIM-ligaen', 5, 2, true);

-- 8) Tre kampe SENERE I DAG, i deres egen turnering, så påstanden kan måles
--    alene. `p_dage_frem = 0` giver dem midnat i dag — altså et tidspunkt, der
--    ligger i fortiden, hver gang kontrollen kører efter kl. 00.00 UTC.
select pg_temp.kampe('I dag', 3, 0, true);

\ir ../checks/kickoff_coverage.sql

do $$
declare
  r record;
begin
  -- 1) sund turnering
  select * into r from kickoff_coverage where liga = 'Superligaen';
  if r.kommende is distinct from 6 then
    raise exception 'Superligaen: forventede 6 kampe i vinduet, fik % (fremtid og spillede kampe skal ikke tælle med)', r.kommende;
  end if;
  if r.uden_tid <> 0 or r.tilstand <> 'ok' then
    raise exception 'Superligaen: forventede ok/0 uden tid, fik %/%', r.tilstand, r.uden_tid;
  end if;

  -- 2) regressionen
  select * into r from kickoff_coverage where liga = 'La Liga';
  if r.tilstand <> 'ALLE UDEN TID' then
    raise exception 'La Liga: en turnering, hvor ALLE nært forestående kampe er uden tid, skal give alarm — fik %', r.tilstand;
  end if;
  if r.provider <> 'footballdata' then
    raise exception 'La Liga: leverandøren skal med i rapporten (fejlen ramte pr. leverandør), fik %', r.provider;
  end if;

  -- 3) blandet er ikke en alarm, uanset hvor skæv fordelingen er
  select * into r from kickoff_coverage where liga = 'Serie A';
  if r.tilstand <> 'ok' then
    raise exception 'Serie A: 4 af 5 uden tid er stadig en terminsliste og ikke en fejlaflæsning — kun ALLE er en alarm, fik %', r.tilstand;
  end if;

  -- 4) gulvet
  select * into r from kickoff_coverage where liga = 'Ligue 1';
  if r.tilstand <> 'for faa' then
    raise exception 'Ligue 1: to kampe er under gulvet og må ikke give alarm — fik %', r.tilstand;
  end if;

  -- 5) uden leverandør-id: ingen række overhovedet
  if exists (select 1 from kickoff_coverage where liga = 'SIM-ligaen') then
    raise exception 'SIM-ligaen: en turnering uden api_league_id skal slet ikke dømmes';
  end if;

  -- 8) dagens kampe tæller med
  select * into r from kickoff_coverage where liga = 'I dag';
  if r.kommende is distinct from 3 then
    raise exception 'I dag: kampe i dag skal tælle med (vinduet starter ved current_date, ikke now()) — fik % kampe', coalesce(r.kommende, -1);
  end if;
  if r.tilstand <> 'ALLE UDEN TID' then
    raise exception 'I dag: tre kampe i dag uden tid skal give alarm — fik %', r.tilstand;
  end if;
end $$;

-- Kontrollen skal kunne læses to gange i samme session uden at fejle: sådan ser
-- en gentagen kørsel ud, hvis nogen kalder heartbeat-trinnet manuelt bagefter.
\ir ../checks/kickoff_coverage.sql

select 'kickoff_coverage: OK' as result;
