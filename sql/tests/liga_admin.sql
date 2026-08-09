-- Test af `sql/liga_admin.sql` — hvad en administrator må.
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR DET RIGTIGE SKEMA (G91, 9. august 2026)
-- Filen byggede indtil da sit eget miniskema: fjorten håndskrevne tabeller, tre
-- kopierede funktioner, fire hjemmelavede læsepolicyer og et
-- `grant select on all tables`. Det er præcis den konstruktion, `G91` var en
-- række om — en test, hvis rigtighed afhænger af tabeller, den selv opfinder,
-- kan stå grøn, mens funktionen fejler mod produktionens skema.
--
-- **Og den stod grøn på en påstand, der var forkert.** Den gamle påstand 4 sagde
-- "liga-admin kan ikke fjerne SIG SELV", målt i et skema, hvor
-- `comp_participants_delete_own_unlocked` ikke fandtes. Den policy findes i
-- produktionen, RLS er et OR mellem permissive policies, og konkurrencen i
-- fixturen er FÆRDIGSPILLET — så i produktionen kan hun. Testen beviste altså
-- ikke en regel, men fraværet af en anden fil. Se påstand 4 nedenfor for, hvad
-- der er sandt i stedet.
--
-- Prisen ved skiftet er en fixture, der skal overholde rigtige fremmednøgler
-- (kampe kræver en liga, en sæson og to hold), og et `disable trigger all` på
-- `matches`. Gevinsten er, at de fem policies, testen måler, er dem, der ligger
-- i produktionen, sammen med alle de andre, de konkurrerer med.
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
--   4. Liga-admin kan ikke fjerne sig selv fra en konkurrence, der er I GANG —
--      men KAN melde sig ud af en, der er spillet færdig. **Det andet led er
--      omvendt af, hvad filen påstod før `G91`**, og forskellen er ikke en
--      regelændring, men et miniskema, der manglede den anden policy.
--      Selvudelukkelsen `user_id <> auth.uid()` i admin-policyen kan ikke måles
--      alene, og det er ikke en mangel i testen: de to policies kan ikke være
--      det afgørende led samtidig. Egen-policyen siger nej, netop når den
--      lukkede selv har tippet i konkurrencen — og så siger admin-policyens
--      tredje led ("ingen tips") allerede nej. Leddet er dermed et værn og ikke
--      en regel, nogen kan komme til at læne sig på.
--   5. Liga-admin kan slette en konkurrence, ingen har tippet i.
--   6. Liga-admin kan IKKE slette en konkurrence, der er tippet i.
--   7. Liga-admin kan slette en liga, hvor alle konkurrencer er AFSLUTTEDE …
--   8. … og ikke en, hvor en konkurrence stadig er i gang — heller ikke en, hvor
--      den eneste rest er en konkurrence UDEN KAMPE. Den har ingen række i
--      `competition_status`, og `coalesce(…, false)` er det, der oversætter
--      fraværet til "ikke afsluttet".
--   9. `anonymize_my_account()` har stadig NUL parametre efter opdelingen.
--  10. `_anonymize_account()` kan ikke kaldes af en bruger.
--  11. `admin_anonymize_account()` afviser en ikke-admin, sig selv og en anden
--      administrator — og virker på en almindelig bruger.
--  12. En lukket konto meldes af de konkurrencer, der IKKE er begyndt (A25) —
--      og bliver i dem, der er, også når den lukkede aldrig har tippet i dem.
--  13. Ved lukning overdrages administratorrollen til det ældste LEVENDE medlem,
--      og den lukkede konto forlader ligaen (A36 + A37). Er der ingen levende
--      at overdrage til, bliver ligaen stående — tom og uden administrator.
--
-- EFTERPRØVET MED MUTATION (G91). De tre policyers led er fjernet ét ad gangen:
-- begge `is_group_admin`-krav, begge "ingen tips"-krav, `coalesce`-defaulten og
-- selvudelukkelsen. Seks af syv blev fanget. Den syvende er
-- `user_id <> auth.uid()`, og den KAN ikke fanges — se påstand 4. To af de seks
-- blev først fanget efter, at flytningen til det rigtige skema havde afsløret
-- hullerne: `coalesce(cs.concluded, false)` havde ingen konkurrence uden kampe
-- at møde (påstand 8b), og `is_group_admin(id)` i liga-policyen var aldrig
-- blevet prøvet af et almindeligt medlem (påstand 8c).

\set ON_ERROR_STOP on
\timing off

-- Rollerne, `auth.uid()`, `auth.users`, alle tabeller, alle grants og ALLE
-- policies kommer fra produktionsskemaet, som er indlæst før denne fil. Det,
-- der stod her indtil `G91`, var en håndskrevet efterligning af netop det —
-- inklusive fire læsepolicyer, der skulle erstatte produktionens egne, og et
-- `grant select on all tables`, der kunne skjule en manglende rettighed.
--
-- TRIGGERNE PÅ `matches` SLÅS FRA. De tre statement-level rating-triggere og
-- Story Engine-triggeren fyrer ved hver resultatændring, og afsnit 7 ændrer et
-- resultat midt i en påstand om liga-sletning. Deres arbejde er dækket af
-- `rating_equivalence.sql` og `story_engine_*.sql`; her ville de kun gøre
-- testen langsom og dens data uforudsigelige.
alter table public.matches disable trigger all;

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

-- Turneringen bag kampene. Den fandtes ikke i miniskemaet — `seasons.league_id`
-- og `matches.home_team_id`/`away_team_id` er NOT NULL i produktionen, og det er
-- den slags, `G91` mente med "syntetiske fremmednøgler, produktionsskemaet
-- afviser".
insert into public.leagues (id, name) values
  ('40000000-0000-0000-0000-000000000001', 'Testligaen');
insert into public.seasons (id, league_id, name, is_finished) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
   'Færdig sæson', true);
insert into public.teams (id, league_id, name) values
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Hjemme'),
  ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'Ude');

-- To kampe: én spillet, én uspillet.
insert into public.matches (id, season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score) values
  ('10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002',
   now() - interval '40 days', 2, 1),
  ('10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002',
   now() + interval '2 days', null, null);

-- TIPPET: en afsluttet konkurrence, TIPPER har tippet i den.
-- URØRT:  en konkurrence med samme spillede kamp, som ingen har tippet i.
-- AKTIV:  en konkurrence med den uspillede kamp — altså stadig i gang.
insert into public.competitions (id, name, mode, group_id, created_by) values
  ('c0000000-0000-0000-0000-000000000001', 'Tippet',   'custom', '90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002', 'Urørt',    'custom', '90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000003', 'Aktiv',    'custom', '90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
  -- UDEN KAMPE: hverken begyndt eller afsluttet, og derfor uden en række i
  -- `competition_status`. Den findes for påstand 8b — se dér.
  ('c0000000-0000-0000-0000-000000000004', 'Uden kampe', 'custom', '90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001');

insert into public.competition_matches (competition_id, match_id) values
  ('c0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001'),
  -- "Aktiv" har BEGGE kampe: den spillede og den uspillede. Den spillede er ny
  -- med `G91` og er der kun for påstand 4b — se tippene nedenfor.
  ('c0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002');

insert into public.competition_participants (competition_id, user_id) values
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003'),
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004'),
  -- TAVS er også med i "Urørt" — og har aldrig tippet. Den konkurrence deler
  -- kamp med "Tippet", som TIPPER HAR tippet, og TIPPER er ikke med i "Urørt".
  -- Det er præcis den stilling, der skiller "nogen har tippet kampen" fra
  -- "nogen af DELTAGERNE har tippet".
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000004'),
  -- ADMIN er med i "Aktiv" — den konkurrence, påstand 4b måles i.
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001'),
  -- MEDLEM er også med, og det er IKKE pynt: `competition_status` er en
  -- `security_invoker`-view, og `competition_matches`' læsepolicy kræver, at man
  -- deltager et sted. En bruger uden en eneste deltagelse ser derfor viewet tomt
  -- og bliver spærret ude af liga-policyen af den grund alene — så påstand 8c
  -- ville måle det forkerte led. Det er en detalje, kun det rigtige skema har.
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002');

insert into public.predictions (user_id, match_id, pred_home, pred_away) values
  ('a0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 2, 1),
  -- ADMINs eget tip på den SPILLEDE kamp. Det er den ene ting, der gør påstand
  -- 4b mulig: `comp_participants_delete_own_unlocked` slipper en deltager ud,
  -- så længe konkurrencen enten er spillet helt færdig ELLER hun ikke har
  -- tippet noget, der er låst. "Aktiv" har begge dele — en uspillet kamp OG et
  -- af hendes tips på en spillet — og er dermed det eneste sted i filen, hvor
  -- egen-frameldingen faktisk siger nej.
  ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1, 1);

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

  -- 4b) Liga-admin kan ikke fjerne SIG SELV fra "Aktiv", som er i gang, og hvor
  --     hun har tippet en spillet kamp. Begge policies siger nej: admin-policyen
  --     på `user_id <> auth.uid()` (og på "ingen tips"), egen-frameldingen på et
  --     låst tip i en konkurrence, der ikke er færdig.
  n := pg_temp.slet(liga_admin, $q$delete from public.competition_participants
        where competition_id = 'c0000000-0000-0000-0000-000000000003'
          and user_id = 'a0000000-0000-0000-0000-000000000001'$q$);
  if n <> 0 then raise exception '4b) liga-admin frameldte sig selv fra en konkurrence, der er i gang'; end if;

  -- 1) …men kan fjerne den, der aldrig har tippet.
  n := pg_temp.slet(liga_admin, $q$delete from public.competition_participants
        where competition_id = 'c0000000-0000-0000-0000-000000000001'
          and user_id = 'a0000000-0000-0000-0000-000000000004'$q$);
  if n <> 1 then raise exception '1) liga-admin kunne ikke fjerne en deltager uden tips (rækker: %)', n; end if;

  -- 4a) OG DEN MODSATTE VEJ, som er den, der blev opdaget med `G91`: af en
  --     konkurrence, der er spillet HELT færdig, kan hun godt melde sig ud —
  --     ikke gennem admin-policyen, men gennem `comp_participants_delete_own_
  --     unlocked`, hvis første led er "ingen uspillede kampe tilbage".
  --     "Tippet" har kun den spillede kamp.
  --
  --     Påstanden hører til her, fordi den siger noget om produktionen, som
  --     miniskemaet påstod det modsatte af — og fordi den ville fange en
  --     stramning af egen-frameldingen, som ellers først ville vise sig som en
  --     knap, der holdt op med at virke. Den står SIDST i afsnittet, fordi den
  --     fjerner en deltager, de foregående påstande regner med.
  n := pg_temp.slet(liga_admin, $q$delete from public.competition_participants
        where competition_id = 'c0000000-0000-0000-0000-000000000001'
          and user_id = 'a0000000-0000-0000-0000-000000000001'$q$);
  if n <> 1 then
    raise exception '4a) liga-admin kunne ikke melde sig ud af en færdigspillet konkurrence (rækker: %)', n;
  end if;
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
  medlem     uuid := 'a0000000-0000-0000-0000-000000000002';
  n int;
begin
  -- 8) "Aktiv" er stadig i gang (uspillet kamp), så ligaen er spærret.
  n := pg_temp.slet(liga_admin, $q$delete from public.groups
        where id = '90000000-0000-0000-0000-000000000001'$q$);
  if n <> 0 then raise exception '8) ligaen blev slettet, mens en konkurrence var i gang'; end if;

  -- 8b) Spilles den sidste kamp færdig, er "Aktiv" afsluttet — men ligaen er
  --     STADIG spærret, fordi "Uden kampe" hverken er begyndt eller afsluttet.
  --     Den har ingen række i `competition_status`, og `coalesce(…, false)` i
  --     policyen er dét, der gør fraværet til "ikke afsluttet". Vendes den
  --     default, står ligaen pludselig åben for sletning på grund af en
  --     konkurrence, ingen har rørt — og påstanden findes, fordi netop den
  --     mutation slap igennem, da testen blev flyttet til det rigtige skema.
  update public.matches set home_score = 1, away_score = 1, kickoff_at = now() - interval '1 day'
   where id = '10000000-0000-0000-0000-000000000002';
  n := pg_temp.slet(liga_admin, $q$delete from public.groups
        where id = '90000000-0000-0000-0000-000000000001'$q$);
  if n <> 0 then
    raise exception '8b) ligaen blev slettet, mens en konkurrence uden kampe stod tilbage';
  end if;

  -- 7) Fjernes også den, er alt afsluttet, og ligaen kan lukkes. Sletningen sker
  --    UDEN OM policyerne (opretteren måtte det selv) — det er ikke den, der
  --    måles her.
  delete from public.competitions where id = 'c0000000-0000-0000-0000-000000000004';

  -- 8c) Men kun ADMINISTRATOREN må. Et almindeligt medlem står nu foran en liga,
  --     hvor hver eneste anden betingelse er opfyldt, og skal stadig få nul
  --     rækker. Uden påstanden er `is_group_admin(id)` i policyen uafprøvet —
  --     og en liga, en hvilken som helst deltager kan slette, ville ikke vise
  --     sig som en fejl, men som en liga, der forsvandt.
  n := pg_temp.slet(medlem, $q$delete from public.groups
        where id = '90000000-0000-0000-0000-000000000001'$q$);
  if n <> 0 then raise exception '8c) et almindeligt medlem slettede ligaen'; end if;

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

insert into public.matches (id, season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score) values
  ('11000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002',
   now() - interval '3 days', 2, 1),
  ('11000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002',
   now() + interval '10 days', null, null);

insert into public.competitions (id, name, mode, group_id, created_by) values
  ('c1000000-0000-0000-0000-000000000001', 'Igang',    'custom', '91000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002'),
  ('c1000000-0000-0000-0000-000000000002', 'Kommende', 'custom', '91000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002'),
  ('c1000000-0000-0000-0000-000000000003', 'Alene',    'custom', '91000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-000000000004', 'Tom',      'custom', '91000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002');

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

  -- 12e) Ligamedlemskabet står — men BEGRUNDELSEN er en anden efter A36
  --      (7. august 2026). Før stod det, fordi medlemskaber aldrig blev rørt;
  --      nu står det, fordi der er deltagelser tilbage i ligaen ("Igang" og
  --      "Alene"), og invarianten "deltager ⇒ medlem" derfor forbyder at
  --      fjerne det. Påstanden er den samme, reglen bag den er ny — og
  --      afsnit 13 måler den anden gren.
  if not exists (select 1 from public.group_members
                  where user_id = lukkes and group_id = '91000000-0000-0000-0000-000000000001') then
    raise exception '12e) ligamedlemskabet forsvandt, selv om der er deltagelser tilbage i ligaen';
  end if;
end $$;

-- ---------- 13: overdragelse af admin + framelding af ligaen (A36 + A37) ----------
--
-- Egne data. Fire ligaer, fordi beslutningen har fire udfald:
--
--   ARV       LUKKES er admin · A og B lever, C er lukket   → A arver, LUKKES ud
--   HISTORIK  LUKKES er admin · D lever · LUKKES har en     → D arver, LUKKES
--             deltagelse i en BEGYNDT konkurrence             bliver, men som 'member'
--   ALENE     LUKKES er eneste medlem                       → ingen arving,
--                                                             LUKKES ud, ligaen står
--   GÆST      LUKKES er almindeligt medlem, E er admin      → E urørt, LUKKES ud
--
-- ARV er den vigtigste, og det er `C`, der gør den skarp: C meldte sig ind
-- FØRST og ville vinde en naiv "ældste medlem"-sortering — men C er selv
-- lukket, og en lukket konto kan ikke administrere noget. Uden C ville testen
-- ikke kunne skelne "ældste" fra "ældste levende".
insert into auth.users (id) values
  ('d0000000-0000-0000-0000-000000000001'),  -- LUKKES
  ('d0000000-0000-0000-0000-000000000002'),  -- A  (arving i ARV)
  ('d0000000-0000-0000-0000-000000000003'),  -- B  (yngre end A)
  ('d0000000-0000-0000-0000-000000000004'),  -- C  (ældst, men LUKKET)
  ('d0000000-0000-0000-0000-000000000005'),  -- D  (arving i HISTORIK)
  ('d0000000-0000-0000-0000-000000000006');  -- E  (admin i GÆST)

insert into public.profiles (id, display_name, is_admin, anonymized_at) values
  ('d0000000-0000-0000-0000-000000000001', 'Lukkes2',  false, null),
  ('d0000000-0000-0000-0000-000000000002', 'Anja',     false, null),   -- A
  ('d0000000-0000-0000-0000-000000000003', 'Bodil',    false, null),   -- B
  ('d0000000-0000-0000-0000-000000000004', 'C lukket', false, now() - interval '1 day'),
  ('d0000000-0000-0000-0000-000000000005', 'Dorte',    false, null),   -- D
  ('d0000000-0000-0000-0000-000000000006', 'Erik',     false, null);   -- E

insert into public.groups (id, name, created_by) values
  ('92000000-0000-0000-0000-000000000001', 'Arv',      'd0000000-0000-0000-0000-000000000001'),
  ('92000000-0000-0000-0000-000000000002', 'Historik', 'd0000000-0000-0000-0000-000000000001'),
  ('92000000-0000-0000-0000-000000000003', 'Alene',    'd0000000-0000-0000-0000-000000000001'),
  ('92000000-0000-0000-0000-000000000004', 'Gaest',    'd0000000-0000-0000-0000-000000000006');

-- `joined_at` er hele pointen i ARV: C er ældst, A er ældste LEVENDE.
insert into public.group_members (group_id, user_id, role, joined_at) values
  ('92000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'admin',  now() - interval '10 days'),
  ('92000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004', 'member', now() - interval '20 days'),
  ('92000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'member', now() - interval '15 days'),
  ('92000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'member', now() - interval '5 days'),

  ('92000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'admin',  now() - interval '10 days'),
  ('92000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000005', 'member', now() - interval '3 days'),

  ('92000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001', 'admin',  now() - interval '10 days'),

  ('92000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000006', 'admin',  now() - interval '10 days'),
  ('92000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001', 'member', now() - interval '2 days');

-- HISTORIK får en BEGYNDT konkurrence, som LUKKES deltager i — det er den, der
-- gør, at medlemskabet dér ikke må fjernes.
insert into public.competitions (id, name, mode, group_id, created_by) values
  ('c2000000-0000-0000-0000-000000000001', 'Spillet', 'custom', '92000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000005');
insert into public.competition_matches (competition_id, match_id) values
  ('c2000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001');
insert into public.competition_participants (competition_id, user_id) values
  ('c2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001'),
  ('c2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000005');

do $$
declare
  global uuid := 'a0000000-0000-0000-0000-000000000005';
  lukkes uuid := 'd0000000-0000-0000-0000-000000000001';
  arv      uuid := '92000000-0000-0000-0000-000000000001';
  historik uuid := '92000000-0000-0000-0000-000000000002';
  alene    uuid := '92000000-0000-0000-0000-000000000003';
  gaest    uuid := '92000000-0000-0000-0000-000000000004';
  r record;
begin
  perform set_config('test.uid', global::text, true);
  perform public.admin_anonymize_account(lukkes);

  -- 13a) ARV: det ældste LEVENDE medlem arvede — ikke det ældste.
  select * into r from public.group_members
   where group_id = arv and role = 'admin';
  if not found then
    raise exception '13a) ingen arvede administratorrollen i ARV';
  end if;
  if r.user_id <> 'd0000000-0000-0000-0000-000000000002' then
    raise exception '13a) forkert arving i ARV: % (forventede A, ikke den ældste C, som er lukket)', r.user_id;
  end if;
  if (select count(*) from public.group_members where group_id = arv and role = 'admin') <> 1 then
    raise exception '13a) ARV fik mere end én administrator';
  end if;

  -- 13b) ARV: den lukkede konto forlod ligaen (ingen deltagelser tilbage).
  if exists (select 1 from public.group_members where group_id = arv and user_id = lukkes) then
    raise exception '13b) den lukkede konto blev stående på ARVs medlemsliste';
  end if;

  -- 13c) HISTORIK: D arvede, OG den lukkede konto blev — men som 'member'.
  --      Invarianten forbyder frameldingen, fordi deltagelsen i "Spillet" står.
  if not exists (select 1 from public.group_members
                  where group_id = historik and user_id = 'd0000000-0000-0000-0000-000000000005'
                    and role = 'admin') then
    raise exception '13c) D arvede ikke administratorrollen i HISTORIK';
  end if;
  select * into r from public.group_members where group_id = historik and user_id = lukkes;
  if not found then
    raise exception '13c) medlemskabet blev fjernet, selv om en deltagelse står tilbage — invarianten er brudt';
  end if;
  if r.role <> 'member' then
    raise exception '13c) en lukket konto står stadig som administrator (rolle: %)', r.role;
  end if;

  -- 13d) ALENE: ingen arving. Ligaen bliver stående — tom og uden admin — og
  --      det er beslutningen, ikke en mangel.
  if exists (select 1 from public.group_members where group_id = alene) then
    raise exception '13d) ALENE har stadig medlemmer';
  end if;
  if not exists (select 1 from public.groups where id = alene) then
    raise exception '13d) den tomme liga blev slettet — den skal blive stående';
  end if;

  -- 13e) GÆST: en almindelig medlemskonto forlader også ligaen, og ligaens
  --      egen administrator er urørt.
  if exists (select 1 from public.group_members where group_id = gaest and user_id = lukkes) then
    raise exception '13e) den lukkede konto blev stående på GÆSTs medlemsliste';
  end if;
  if not exists (select 1 from public.group_members
                  where group_id = gaest and user_id = 'd0000000-0000-0000-0000-000000000006'
                    and role = 'admin') then
    raise exception '13e) GÆSTs egen administrator blev rørt';
  end if;

  -- 13f) Ingen lukket konto står som administrator nogen steder — hverken
  --      den, der lige lukkede, eller C, som var lukket i forvejen.
  if exists (
    select 1 from public.group_members gm
    join public.profiles p on p.id = gm.user_id
    where gm.role = 'admin' and p.anonymized_at is not null
  ) then
    raise exception '13f) en lukket konto står som administrator';
  end if;

  -- 13g) Ingen andres medlemskaber forsvandt: B står stadig i ARV.
  if not exists (select 1 from public.group_members
                  where group_id = arv and user_id = 'd0000000-0000-0000-0000-000000000003') then
    raise exception '13g) frameldingen ramte et andet medlem';
  end if;
end $$;

-- ---------- den efterladte liga, som backfillen skal redde ----------
--
-- Bygget HER og ikke i afsnit 13, fordi den er en tilstand, funktionen ikke kan
-- skabe: en liga, hvis administrator var lukket, FØR reglen fandtes. Det er
-- produktionens tilstand 7. august 2026 (`Testerr`), bare med medlemmer i —
-- altså det tilfælde, hvor der faktisk er noget at redde.
--
-- Uden den ville backfillens overdragelses-gren aldrig køre i testen, og en
-- gren, der aldrig har kørt, er en formodning (`G84`).
insert into public.groups (id, name, created_by) values
  ('92000000-0000-0000-0000-000000000005', 'Efterladt', 'd0000000-0000-0000-0000-000000000004');
insert into public.group_members (group_id, user_id, role, joined_at) values
  -- C er lukket OG administrator: præcis den frosne tilstand.
  ('92000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000004', 'admin',  now() - interval '30 days'),
  ('92000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000003', 'member', now() - interval '8 days'),
  ('92000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000002', 'member', now() - interval '12 days');

-- Idempotens: anden kørsel erstatter policies og funktioner uden at fejle —
-- og kører backfillen, som nu har noget at lave.
\ir ../liga_admin.sql

-- ---------- 14: backfillen i liga_admin.sql (A36 + A37) ----------
--
-- Gen-kørslen ovenfor er samtidig den eneste måde at afprøve backfillen på, og
-- den har et ægte emne: `C lukket` blev oprettet som ALLEREDE anonymiseret i
-- afsnit 13 og blev derfor aldrig behandlet af funktionen — præcis den
-- tilstand, produktionen stod i 7. august 2026, hvor én konto var lukket, før
-- reglen fandtes.
--
-- Uden dette afsnit ville backfillen være kode, der aldrig er efterprøvet —
-- `G72`s og `G76`s fejltype, og den dyreste slags her, fordi backfillen KUN
-- kører én gang og gør det mod rigtige data.
do $$
begin
  -- 14a) Den forud-lukkede konto forlod ligaen ved backfillen.
  if exists (
    select 1 from public.group_members
     where group_id = '92000000-0000-0000-0000-000000000001'
       and user_id  = 'd0000000-0000-0000-0000-000000000004'
  ) then
    raise exception '14a) backfillen fjernede ikke den forud-lukkede konto fra ARV';
  end if;

  -- 14b) Den rørte ikke de levende: Anja er stadig administrator, Bodil medlem.
  if not exists (
    select 1 from public.group_members
     where group_id = '92000000-0000-0000-0000-000000000001'
       and user_id  = 'd0000000-0000-0000-0000-000000000002' and role = 'admin'
  ) then
    raise exception '14b) backfillen fjernede eller degraderede den arvede administrator';
  end if;
  if not exists (
    select 1 from public.group_members
     where group_id = '92000000-0000-0000-0000-000000000001'
       and user_id  = 'd0000000-0000-0000-0000-000000000003'
  ) then
    raise exception '14b) backfillen ramte et levende medlem';
  end if;

  -- 14c) Den respekterer invarianten: HISTORIK har stadig sin lukkede konto,
  --      fordi deltagelsen i "Spillet" står.
  if not exists (
    select 1 from public.group_members
     where group_id = '92000000-0000-0000-0000-000000000002'
       and user_id  = 'd0000000-0000-0000-0000-000000000001'
  ) then
    raise exception '14c) backfillen brød invarianten deltager ⇒ medlem';
  end if;

  -- 14d) Ingen lukket konto er administrator nogen steder efter backfillen.
  if exists (
    select 1 from public.group_members gm
    join public.profiles p on p.id = gm.user_id
    where gm.role = 'admin' and p.anonymized_at is not null
  ) then
    raise exception '14d) en lukket konto står som administrator efter backfillen';
  end if;

  -- 14e) **Overdragelses-grenen:** den efterladte liga fik en ny, LEVENDE
  --      administrator — og det blev Anja, som meldte sig ind før Bodil.
  if not exists (
    select 1 from public.group_members
     where group_id = '92000000-0000-0000-0000-000000000005'
       and user_id  = 'd0000000-0000-0000-0000-000000000002' and role = 'admin'
  ) then
    raise exception '14e) den efterladte liga fik ikke det ældste levende medlem som administrator';
  end if;
  if (select count(*) from public.group_members
       where group_id = '92000000-0000-0000-0000-000000000005' and role = 'admin') <> 1 then
    raise exception '14e) den efterladte liga fik mere end én administrator';
  end if;

  -- 14f) Og den lukkede administrator forlod listen.
  if exists (
    select 1 from public.group_members
     where group_id = '92000000-0000-0000-0000-000000000005'
       and user_id  = 'd0000000-0000-0000-0000-000000000004'
  ) then
    raise exception '14f) den lukkede administrator blev stående på den efterladte ligas medlemsliste';
  end if;
end $$;

-- Og en TREDJE kørsel skal være et rent no-op — backfillen konvergerer.
\ir ../liga_admin.sql

select 'liga_admin: OK' as result;
