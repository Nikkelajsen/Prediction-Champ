-- Test af, at deltagerens nulpunkt overlever en framelding
-- (sql/competition_participant_baseline.sql, G108).
--
-- Kører mod PRODUKTIONSSKEMAET (`node sql/tests/_schema.mjs`) og anvender
-- derefter BEGGE migreringer. Rører aldrig produktion.
--
-- HVORFOR BEGGE MIGRERINGER
-- `#63` er meningsløs uden `#61`: uden nulpunktsreglen ville en genindtræden
-- ikke koste noget, og der ville ikke være en fejl at rette. Testen indlæser
-- derfor `competition_join_baseline.sql` først og måler virkningen dér, hvor
-- den kan ses — i `competition_match_points`.
--
-- HVAD DEN BEVISER
--   1. Begge triggere sidder, og hukommelsen kan hverken læses af `anon` eller
--      af `authenticated`.
--   2. Kernen: forlader man en FÆRDIGSPILLET konkurrence og melder sig til
--      igen, er pointene der stadig. Uden hukommelsen ville hele sæsonen være
--      tømt, fordi alle kampe er låst i det øjeblik, man kommer tilbage.
--   3. 🔴 **`A53` svækkes IKKE.** En HELT ny deltager, der melder sig til den
--      samme færdigspillede konkurrence, står fortsat med nul — hun har ingen
--      historik at arve. Det er den påstand, der skiller "husk nulpunktet" fra
--      "drop nulpunktet i afsluttede konkurrencer".
--   4. `least` og ikke en overskrivning: nulpunktet kan aldrig flytte sig FREM,
--      heller ikke efter flere runder af forlad-og-kom-igen.
--   5. 🔴 **Guarden mod RI-cascade.** `competition_participants` har `on delete
--      cascade` fra både `competitions` og `profiles`, og cascaden kører EFTER
--      at forældrerækken er væk. Uden guarden ville hukommelsens egen
--      fremmednøgle fejle med `23503`, og følgen ville være, at man ikke længere
--      kunne slette en konkurrence eller lukke en konto. Måles begge veje.
--   6. Migreringen er idempotent.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d cpb -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d cpb -v ON_ERROR_STOP=1 -b -f sql/tests/competition_participant_baseline.sql

\set ON_ERROR_STOP on
\timing off

\ir ../competition_join_baseline.sql
\ir ../competition_participant_baseline.sql

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- ÉN færdigspillet konkurrence med to kampe, og tre spillere med samme,
-- præcise gæt: ANNA (var med fra start), NYE (melder sig først til bagefter) og
-- en ekstra, der kun findes for at kunne slettes i påstand 5.
--
--   KAMP_A  kickoff 06-07 18.00Z ⇒ låser 17.00Z
--   KAMP_B  kickoff 13-07 18.00Z ⇒ låser 17.00Z
insert into auth.users (id, email) values
  ('81080000-0000-4000-8000-00000000000a', 'anna@test.local'),
  ('81080000-0000-4000-8000-00000000000e', 'nye@test.local'),
  ('81080000-0000-4000-8000-00000000000f', 'exit@test.local');
insert into public.profiles (id, display_name) values
  ('81080000-0000-4000-8000-00000000000a', 'Anna'),
  ('81080000-0000-4000-8000-00000000000e', 'Nye'),
  ('81080000-0000-4000-8000-00000000000f', 'Exit');

insert into public.leagues (id, name) values
  ('81080000-0000-4000-8000-000000000101', 'Testligaen');
insert into public.seasons (id, league_id, name) values
  ('81080000-0000-4000-8000-000000000201', '81080000-0000-4000-8000-000000000101', '2026/27');
insert into public.teams (id, league_id, name) values
  ('81080000-0000-4000-8000-000000000301', '81080000-0000-4000-8000-000000000101', 'Hjemme'),
  ('81080000-0000-4000-8000-000000000302', '81080000-0000-4000-8000-000000000101', 'Ude');

insert into public.matches (id, season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score) values
  ('81080000-0000-4000-8000-000000000401', '81080000-0000-4000-8000-000000000201',
   '81080000-0000-4000-8000-000000000301', '81080000-0000-4000-8000-000000000302',
   '2026-07-06T18:00:00Z', 2, 1),
  ('81080000-0000-4000-8000-000000000402', '81080000-0000-4000-8000-000000000201',
   '81080000-0000-4000-8000-000000000301', '81080000-0000-4000-8000-000000000302',
   '2026-07-13T18:00:00Z', 0, 0);

insert into public.competitions (id, name, mode, created_by) values
  ('81080000-0000-4000-8000-000000000501', 'Afsluttet', 'full_season',
   '81080000-0000-4000-8000-00000000000a');
insert into public.competition_matches (competition_id, match_id) values
  ('81080000-0000-4000-8000-000000000501', '81080000-0000-4000-8000-000000000401'),
  ('81080000-0000-4000-8000-000000000501', '81080000-0000-4000-8000-000000000402');

insert into public.competition_participants (competition_id, user_id, joined_at) values
  ('81080000-0000-4000-8000-000000000501', '81080000-0000-4000-8000-00000000000a', '2026-06-01T00:00:00Z');

insert into public.predictions (user_id, match_id, pred_home, pred_away)
select p.id, m.id, m.home_score, m.away_score
from public.profiles p
cross join public.matches m;

-- ---------------------------------------------------------------------------
-- 1. Formen
-- ---------------------------------------------------------------------------
do $$
declare v_triggere int; v_anon boolean; v_auth boolean;
begin
  select count(*) into v_triggere from pg_trigger
   where tgrelid = 'public.competition_participants'::regclass
     and tgname in ('competition_participants_remember_baseline',
                    'competition_participants_restore_baseline');
  if v_triggere <> 2 then
    raise exception 'begge triggere skal sidde, fandt %', v_triggere;
  end if;

  select has_table_privilege('anon', 'public.competition_participant_history', 'SELECT'),
         has_table_privilege('authenticated', 'public.competition_participant_history', 'SELECT')
    into v_anon, v_auth;
  if v_anon or v_auth then
    raise exception 'hukommelsen er intern og må ikke kunne læses af klienten (anon=%, auth=%)',
      v_anon, v_auth;
  end if;

  raise notice 'OK 1: triggerne sidder, og hukommelsen er intern';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Kernen: forlad og kom tilbage
-- ---------------------------------------------------------------------------
do $$
declare v_foer int; v_efter int; v_joined timestamptz;
begin
  select count(*) into v_foer from public.competition_match_points
   where competition_id = '81080000-0000-4000-8000-000000000501'
     and user_id = '81080000-0000-4000-8000-00000000000a';
  if v_foer <> 2 then
    raise exception 'Anna var med fra start og skal have begge kampe, havde %', v_foer;
  end if;

  -- Framelding er tilladt her: hver kamp har resultat (gren (a) i
  -- `comp_participants_delete_own_unlocked`). Det er præcis den dør, rækken
  -- handler om.
  delete from public.competition_participants
   where competition_id = '81080000-0000-4000-8000-000000000501'
     and user_id = '81080000-0000-4000-8000-00000000000a';

  -- Og hun melder sig til igen. `joined_at` tager sin default (`now()`), som
  -- ligger LANGT efter begge låse — uden hukommelsen ville hele sæsonen være
  -- tømt her.
  insert into public.competition_participants (competition_id, user_id)
  values ('81080000-0000-4000-8000-000000000501', '81080000-0000-4000-8000-00000000000a');

  select joined_at into v_joined from public.competition_participants
   where competition_id = '81080000-0000-4000-8000-000000000501'
     and user_id = '81080000-0000-4000-8000-00000000000a';
  if v_joined <> '2026-06-01T00:00:00Z'::timestamptz then
    raise exception 'nulpunktet skulle være arvet fra første tilmelding, blev %', v_joined;
  end if;

  select count(*) into v_efter from public.competition_match_points
   where competition_id = '81080000-0000-4000-8000-000000000501'
     and user_id = '81080000-0000-4000-8000-00000000000a';
  if v_efter <> 2 then
    raise exception 'pointene skal være der efter genindtræden, havde %', v_efter;
  end if;

  raise notice 'OK 2: en genindtræden koster ikke sæsonen';
end $$;

-- ---------------------------------------------------------------------------
-- 3. En HELT ny deltager starter stadig på nul
-- ---------------------------------------------------------------------------
-- Den negative kontrol, og den vigtigste påstand i filen: hukommelsen må kun
-- gælde den, der HAR været med. Ellers ville enhver kunne melde sig til en
-- afsluttet konkurrence og arve hele stillingen — nøjagtig den spekulation,
-- `A53` blev skrevet imod.
do $$
declare v_nye int;
begin
  insert into public.competition_participants (competition_id, user_id)
  values ('81080000-0000-4000-8000-000000000501', '81080000-0000-4000-8000-00000000000e');

  select count(*) into v_nye from public.competition_match_points
   where competition_id = '81080000-0000-4000-8000-000000000501'
     and user_id = '81080000-0000-4000-8000-00000000000e';
  if v_nye <> 0 then
    raise exception 'en ny deltager i en afsluttet konkurrence skal have nul, havde %', v_nye;
  end if;
  raise notice 'OK 3: A53 er intakt — hukommelsen gælder kun den, der har været med';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Nulpunktet kan aldrig flytte sig frem
-- ---------------------------------------------------------------------------
do $$
declare v_joined timestamptz;
begin
  -- Anden runde af forlad-og-kom-igen. Havde funktionen overskrevet frem for at
  -- tage `least`, ville hukommelsen nu bære den ANDEN tilmelding.
  delete from public.competition_participants
   where competition_id = '81080000-0000-4000-8000-000000000501'
     and user_id = '81080000-0000-4000-8000-00000000000a';
  insert into public.competition_participants (competition_id, user_id, joined_at)
  values ('81080000-0000-4000-8000-000000000501', '81080000-0000-4000-8000-00000000000a',
          '2026-08-01T00:00:00Z');

  select joined_at into v_joined from public.competition_participants
   where competition_id = '81080000-0000-4000-8000-000000000501'
     and user_id = '81080000-0000-4000-8000-00000000000a';
  if v_joined <> '2026-06-01T00:00:00Z'::timestamptz then
    raise exception 'et senere tidspunkt må ikke kunne fortrænge det huskede, blev %', v_joined;
  end if;

  -- Og den anden vej: et TIDLIGERE tidspunkt vinder, fordi `least` peger den vej.
  delete from public.competition_participants
   where competition_id = '81080000-0000-4000-8000-000000000501'
     and user_id = '81080000-0000-4000-8000-00000000000a';
  insert into public.competition_participants (competition_id, user_id, joined_at)
  values ('81080000-0000-4000-8000-000000000501', '81080000-0000-4000-8000-00000000000a',
          '2026-05-01T00:00:00Z');

  select joined_at into v_joined from public.competition_participants
   where competition_id = '81080000-0000-4000-8000-000000000501'
     and user_id = '81080000-0000-4000-8000-00000000000a';
  if v_joined <> '2026-05-01T00:00:00Z'::timestamptz then
    raise exception 'et tidligere tidspunkt skal vinde, blev %', v_joined;
  end if;

  -- Og den vej, triggerne IKKE dækker: et `update` af `joined_at` fyrer hverken
  -- huske- eller gendan-triggeren, så rækken kan bære et SENERE tidspunkt end
  -- det huskede, når den slettes. Det er dér, `least` i huske-funktionen har
  -- sin virkning — uden den ville én administrativ rettelse kunne skubbe
  -- nulpunktet frem for altid.
  --
  -- Det forventede svar er 06-01 og ikke 05-01, og forskellen er værd at kende:
  -- hukommelsen skrives kun ved en FRAMELDING, så det tidligere 05-01 fra
  -- indsættelsen ovenfor blev aldrig gemt — 06-01 er det tidligste, en
  -- framelding nogensinde har set. Med en overskrivning ville svaret være
  -- 09-01, altså det, `update`'et satte.
  update public.competition_participants set joined_at = '2026-09-01T00:00:00Z'
   where competition_id = '81080000-0000-4000-8000-000000000501'
     and user_id = '81080000-0000-4000-8000-00000000000a';
  delete from public.competition_participants
   where competition_id = '81080000-0000-4000-8000-000000000501'
     and user_id = '81080000-0000-4000-8000-00000000000a';
  insert into public.competition_participants (competition_id, user_id)
  values ('81080000-0000-4000-8000-000000000501', '81080000-0000-4000-8000-00000000000a');

  select joined_at into v_joined from public.competition_participants
   where competition_id = '81080000-0000-4000-8000-000000000501'
     and user_id = '81080000-0000-4000-8000-00000000000a';
  if v_joined <> '2026-06-01T00:00:00Z'::timestamptz then
    raise exception 'hukommelsen må ikke kunne skubbes frem af et update, blev %', v_joined;
  end if;

  raise notice 'OK 4: least — nulpunktet flytter sig kun bagud';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Guarden mod RI-cascade
-- ---------------------------------------------------------------------------
-- Uden guarden fejler begge sletninger med `23503`, fordi triggeren forsøger at
-- skrive en historik-række, hvis fremmednøgle peger på den forældrerække, der
-- lige er væk. Symptomet ville være, at man ikke kunne slette en konkurrence
-- eller lukke en konto — altså to helt almindelige handlinger brækket af en
-- hukommelse, ingen havde bedt om.
do $$
declare v_rest int;
begin
  insert into public.competitions (id, name, mode, created_by) values
    ('81080000-0000-4000-8000-000000000502', 'Slettes', 'full_season',
     '81080000-0000-4000-8000-00000000000f');
  insert into public.competition_participants (competition_id, user_id) values
    ('81080000-0000-4000-8000-000000000502', '81080000-0000-4000-8000-00000000000f');

  delete from public.competitions where id = '81080000-0000-4000-8000-000000000502';

  select count(*) into v_rest from public.competition_participant_history
   where competition_id = '81080000-0000-4000-8000-000000000502';
  if v_rest <> 0 then
    raise exception 'en slettet konkurrence må ikke efterlade en hukommelses-række';
  end if;

  -- Samme vej gennem `profiles`: kontolukning sletter brugerens deltager-rækker.
  insert into public.competition_participants (competition_id, user_id) values
    ('81080000-0000-4000-8000-000000000501', '81080000-0000-4000-8000-00000000000f');
  delete from public.profiles where id = '81080000-0000-4000-8000-00000000000f';

  select count(*) into v_rest from public.competition_participant_history
   where user_id = '81080000-0000-4000-8000-00000000000f';
  if v_rest <> 0 then
    raise exception 'en slettet bruger må ikke efterlade en hukommelses-række';
  end if;

  raise notice 'OK 5: en cascade-sletning går igennem og efterlader intet';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Idempotens
-- ---------------------------------------------------------------------------
\ir ../competition_participant_baseline.sql

do $$
declare v_joined timestamptz; v_pts int;
begin
  select joined_at into v_joined from public.competition_participants
   where competition_id = '81080000-0000-4000-8000-000000000501'
     and user_id = '81080000-0000-4000-8000-00000000000a';
  select count(*) into v_pts from public.competition_match_points
   where competition_id = '81080000-0000-4000-8000-000000000501'
     and user_id = '81080000-0000-4000-8000-00000000000a';
  if v_joined <> '2026-06-01T00:00:00Z'::timestamptz or v_pts <> 2 then
    raise exception 'anden kørsel ændrede tilstanden: joined=%, rækker=%', v_joined, v_pts;
  end if;
  raise notice 'OK 6: migreringen er idempotent';
end $$;

\echo 'ALLE PÅSTANDE BESTÅET (competition_participant_baseline)'
