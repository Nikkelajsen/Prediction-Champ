-- Test af `sql/season_end.sql` — sæson-gaten på `competition_status`.
--
-- Kører mod en TOM engangsdatabase. Rører aldrig produktion.
--
-- HVAD DEN BEVISER
--   1. En konkurrence, der KAN vokse, er ikke afsluttet, blot fordi alle dens
--      kendte kampe har resultat. Sæsonen skal selv sige, at den er slut.
--      Det er hele opgaven: en Superliga-sæson er ÉN sæson med flere stages, og
--      slutspillet skemalægges først til foråret — så mellem sidste
--      grundspilsrunde og udgivelsen af slutspillet er "alle mine kampe er
--      spillet" trivielt sandt og fuldstændig forkert.
--   2. `is_finished` lukker den.
--   3. `ends_at` i fortiden lukker den også — bagstopperen, hvis flaget aldrig
--      nåede at blive sat.
--   4. `ends_at` i FREMTIDEN lukker den ikke. En kendt slutdato er en oplysning
--      om, at sæsonen IKKE er slut endnu, og må ikke kunne overhales af ventilen.
--   5. Ventilen: uden metadata overhovedet er en sæson færdig, når seneste
--      kickoff er over 30 dage gammel — og ikke før.
--   6. En `custom`-konkurrence (håndplukket kupon) er upåvirket af det hele:
--      den kan ikke vokse, så alle kampe spillet ER afsluttet.
--   7. Det samme gælder en gammel `full_season` med `mode_params.stages` —
--      mærkatet for "afgrænset i hånden under den gamle ordning".
--   8. En periode (`time_range`), hvis slutdato er passeret, er afsluttet uden
--      at vente på sæsonen — men først DAGEN EFTER slutdatoen, kun med en
--      kendt slutdato, og stadig kun med alle resultater inde. Efterfyldningen
--      kan ikke lægge en kamp ind i et passeret vindue (dens runde er pr.
--      definition begyndt), så der er intet at vente på — uden undtagelsen
--      ventede en færdigspillet augustperiode på hele sæsonen.
--
-- Testen findes, fordi den gamle fejl var USYNLIG i data: viewet svarede
-- `concluded = true`, alt så rigtigt ud, og prisen blev betalt et helt andet
-- sted — som en permanent milepæl, der ikke kan trækkes tilbage.

\set ON_ERROR_STOP on
\timing off

-- `leagues` og `profiles` er ikke med, fordi viewet bruger dem — det gør det
-- ikke — men fordi migreringens administrator-funktioner gør. De hører til
-- samme fil, og en test, der springer dem over, ville lade dem være usyntakset.
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $q$ select nullif(current_setting('test.uid', true), '')::uuid $q$;
create table public.profiles (id uuid primary key, display_name text, is_admin boolean not null default false);
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
  home_score int, away_score int
);
create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mode text not null default 'custom',
  mode_params jsonb not null default '{}'::jsonb
);
create table public.competition_matches (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  primary key (competition_id, match_id)
);

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

\ir ../season_end.sql

-- ---------------------------------------------------------------------------
-- Data: én sæson, hvis kendte kampe ALLE er spillet, men som ligger kun 5 dage
-- tilbage i tiden — altså inden for ventilens 30 dage. Det er præcis den
-- tilstand, en Superliga står i, når grundspillet er slut og slutspillet endnu
-- ikke er udgivet.
insert into public.leagues (id, name) values
  ('a1000000-0000-0000-0000-000000000001', 'Testturnering');
insert into public.seasons (id, league_id, name) values
  ('50000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Testsæson');

insert into public.matches (id, season_id, kickoff_at, home_score, away_score) values
  ('10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', now() - interval '20 days', 2, 1),
  ('10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', now() -  interval '5 days', 0, 0);

insert into public.competitions (id, name, mode, mode_params) values
  ('c0000000-0000-0000-0000-000000000001', 'Hel sæson',      'full_season', '{}'::jsonb),
  ('c0000000-0000-0000-0000-000000000002', 'Håndplukket',    'custom',      '{}'::jsonb),
  ('c0000000-0000-0000-0000-000000000003', 'Gammel afgrænset','full_season','{"stages": ["Regular Season"]}'::jsonb);

insert into public.competition_matches (competition_id, match_id)
select c.id, m.id
from public.competitions c
cross join public.matches m;

create or replace function pg_temp.concluded(p_comp uuid) returns boolean
language sql stable as $$
  select concluded from public.competition_status where competition_id = p_comp;
$$;

do $$
declare
  hel     uuid := 'c0000000-0000-0000-0000-000000000001';
  kupon   uuid := 'c0000000-0000-0000-0000-000000000002';
  gammel  uuid := 'c0000000-0000-0000-0000-000000000003';
  saeson  uuid := '50000000-0000-0000-0000-000000000001';
begin
  -- 1) Uden metadata og med en kamp for kun 5 dage siden: IKKE afsluttet.
  if pg_temp.concluded(hel) then
    raise exception '1) en voksbar konkurrence blev afsluttet, mens sæsonen stadig kan få kampe';
  end if;

  -- 6) Den håndplukkede kupon er derimod færdig — den kan ikke vokse.
  if not pg_temp.concluded(kupon) then
    raise exception '6) en custom-konkurrence med alle kampe spillet blev ikke afsluttet';
  end if;

  -- 7) Og det samme gælder den gamle, håndafgrænsede full_season.
  if not pg_temp.concluded(gammel) then
    raise exception '7) mode_params.stages blev ikke respekteret som "vokser aldrig"';
  end if;

  -- 2) is_finished lukker den.
  update public.seasons set is_finished = true where id = saeson;
  if not pg_temp.concluded(hel) then
    raise exception '2) is_finished lukkede ikke konkurrencen';
  end if;

  -- 3) ends_at i fortiden lukker den også.
  update public.seasons set is_finished = false, ends_at = current_date - 1 where id = saeson;
  if not pg_temp.concluded(hel) then
    raise exception '3) en passeret ends_at lukkede ikke konkurrencen';
  end if;

  -- 4) ends_at i fremtiden lukker den IKKE — heller ikke selvom alle kendte
  --    kampe er spillet. En kendt slutdato er positiv viden om det modsatte.
  update public.seasons set ends_at = current_date + 30 where id = saeson;
  if pg_temp.concluded(hel) then
    raise exception '4) en fremtidig ends_at blev alligevel læst som "sæsonen er slut"';
  end if;

  -- 5) Ventilen: ingen metadata, men SENESTE kickoff er over 30 dage gammel.
  --    Begge kampe flyttes — det er `max(kickoff_at)`, ventilen måler på, så en
  --    enkelt gammel kamp i en sæson, der spillede i sidste uge, må intet gøre.
  update public.seasons set ends_at = null, is_finished = false where id = saeson;
  update public.matches set kickoff_at = kickoff_at - interval '40 days'
   where season_id = saeson;
  if not pg_temp.concluded(hel) then
    raise exception '5) sikkerhedsventilen udløste ikke efter 30 dage';
  end if;

  -- 5b) Ventilen måler på den SENESTE kamp, ikke på en vilkårlig gammel én.
  --     Rykkes én kamp frem til i går, er sæsonen i gang igen.
  update public.matches set kickoff_at = now() - interval '1 day'
   where id = '10000000-0000-0000-0000-000000000002';
  if pg_temp.concluded(hel) then
    raise exception '5b) ventilen udløste, selvom sæsonen spillede i går';
  end if;
  update public.matches set kickoff_at = now() - interval '45 days'
   where id = '10000000-0000-0000-0000-000000000002';

  -- 5c) …og den er ikke bare "altid sand": et uspillet resultat spærrer stadig,
  -- uanset hvor gammel kampen er. Ventilen løsner sæson-kravet, ikke
  -- resultat-kravet.
  update public.matches set home_score = null, away_score = null
   where id = '10000000-0000-0000-0000-000000000002';
  if pg_temp.concluded(hel) then
    raise exception '5c) en uspillet kamp blev afsluttet af sikkerhedsventilen';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Den manuelle bagstopper: kun en administrator må lukke en sæson i hånden.
insert into public.profiles (id, display_name, is_admin) values
  ('b0000000-0000-0000-0000-000000000001', 'Admin',   true),
  ('b0000000-0000-0000-0000-000000000002', 'Alm',     false);

do $$
declare
  saeson uuid := '50000000-0000-0000-0000-000000000001';
begin
  -- Kampen fra 5c) er stadig uspillet — spil den, så kun sæson-gaten er tilbage.
  update public.matches set home_score = 1, away_score = 1 where home_score is null;
  update public.matches set kickoff_at = now() - interval '1 day' where season_id = saeson;
  update public.seasons set is_finished = false, ends_at = null where id = saeson;

  perform set_config('test.uid', 'b0000000-0000-0000-0000-000000000002', true);
  begin
    perform public.admin_set_season_finished(saeson, true);
    raise exception '8) en almindelig bruger kunne lukke en sæson';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  if pg_temp.concluded('c0000000-0000-0000-0000-000000000001') then
    raise exception '8b) sæsonen blev lukket af det afviste kald';
  end if;

  perform set_config('test.uid', 'b0000000-0000-0000-0000-000000000001', true);
  perform public.admin_set_season_finished(saeson, true);
  if not pg_temp.concluded('c0000000-0000-0000-0000-000000000001') then
    raise exception '9) admin kunne ikke lukke sæsonen i hånden';
  end if;

  -- Begge veje: en fejllukket sæson skal kunne åbnes igen uden en tur i
  -- databasekonsollen.
  perform public.admin_set_season_finished(saeson, false);
  if pg_temp.concluded('c0000000-0000-0000-0000-000000000001') then
    raise exception '10) sæsonen kunne ikke åbnes igen';
  end if;

  if (select count(*) from public.admin_seasons()) <> 1 then
    raise exception '11) admin_seasons svarede ikke med sæsonen';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Perioden: sæson-gaten slipper, når slutdatoen er passeret. Sæsonen står ÅBEN
-- her (is_finished = false, ends_at = null, seneste kickoff i går — sådan
-- efterlod blokken ovenfor den), og det er hele pointen: perioden skal
-- afslutte alligevel, mens `full_season` ved siden af stadig venter.
insert into public.competitions (id, name, mode, mode_params) values
  ('c0000000-0000-0000-0000-000000000004', 'Periode, passeret', 'time_range',
   jsonb_build_object('start_date', to_char(current_date - 30, 'YYYY-MM-DD'),
                      'end_date',   to_char(current_date - 1,  'YYYY-MM-DD'))),
  ('c0000000-0000-0000-0000-000000000005', 'Periode, sidste dag', 'time_range',
   jsonb_build_object('start_date', to_char(current_date - 30, 'YYYY-MM-DD'),
                      'end_date',   to_char(current_date,      'YYYY-MM-DD'))),
  ('c0000000-0000-0000-0000-000000000006', 'Periode, uden slutdato', 'time_range',
   '{}'::jsonb);

insert into public.competition_matches (competition_id, match_id)
select c.id, m.id
from public.competitions c
cross join public.matches m
where c.id in ('c0000000-0000-0000-0000-000000000004',
               'c0000000-0000-0000-0000-000000000005',
               'c0000000-0000-0000-0000-000000000006');

do $$
declare
  passeret   uuid := 'c0000000-0000-0000-0000-000000000004';
  sidste_dag uuid := 'c0000000-0000-0000-0000-000000000005';
  uden_slut  uuid := 'c0000000-0000-0000-0000-000000000006';
  hel        uuid := 'c0000000-0000-0000-0000-000000000001';
begin
  -- 12) Passeret slutdato + alle kampe spillet ⇒ afsluttet, selvom sæsonen er
  --     åben. Det er selve lempelsen.
  if not pg_temp.concluded(passeret) then
    raise exception '12) en periode med passeret slutdato ventede stadig på sæsonen';
  end if;

  -- 12b) …og den gælder KUN perioden: hel-sæson-konkurrencen på præcis de
  --      samme kampe venter stadig. Uden denne modprøve kunne 12) også bestås
  --      af en gate, der var faldet helt af.
  if pg_temp.concluded(hel) then
    raise exception '12b) sæson-gaten er væk — en full_season afsluttede med åben sæson';
  end if;

  -- 12c) På selve slutdatoen er vinduet stadig åbent — dagens kampe kan nå at
  --      komme til, så `<` og ikke `<=` er reglen.
  if pg_temp.concluded(sidste_dag) then
    raise exception '12c) en periode blev afsluttet på sin egen sidste dag';
  end if;

  -- 12d) Uden slutdato gælder undtagelsen ikke: uvished trækker mod "ikke
  --      afsluttet", samme princip som seasons_done's coalesce.
  if pg_temp.concluded(uden_slut) then
    raise exception '12d) en periode uden slutdato blev afsluttet med sæsonen åben';
  end if;

  -- 12e) Undtagelsen løsner kun sæson-kravet, ikke resultat-kravet.
  update public.matches set home_score = null, away_score = null
   where id = '10000000-0000-0000-0000-000000000002';
  if pg_temp.concluded(passeret) then
    raise exception '12e) en uspillet kamp blev afsluttet af periode-undtagelsen';
  end if;
  update public.matches set home_score = 1, away_score = 1
   where id = '10000000-0000-0000-0000-000000000002';
end $$;

-- Idempotens: anden kørsel erstatter view, kolonner og funktioner uden at fejle.
\ir ../season_end.sql

select 'competition_status: OK' as result;
