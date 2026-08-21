-- Test af `viewable` i `admin_analytics_stories` (G141).
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR DEN FINDES. `viewable` er nævneren under BÅDE visnings- og
-- afvisningsraten i analytics-tavlens regeltabel, og hver eneste af dens
-- fejlmåder er TAVS: en forkert nævner giver ikke en fejl, men en rate, der ser
-- målt ud. `G73` satte nævneren for at fange v2's efterfyldte kort — og v3 gjorde
-- reglen forældet uden at røre den, fordi karusellen, den beskrev, blev fjernet.
-- Det er samme fejlklasse to gange på tre uger, og det er derfor den nu har en
-- vagt frem for en kommentar.
--
-- HVAD DEN BEVISER
--   1. **Fixturen viser fejlen FØR migreringen læses.** Skemadumpet bærer den
--      GAMLE RPC, og påstand 1 kræver, at den svarer forkert på præcis de
--      rækker, påstand 2 svarer rigtigt på. Uden det kunne resten bestå på en
--      harmløs fixture.
--   2. Et v3-dagskort måles på SIT eget vindue (`created_at` → det tidligste af
--      48 timer og næste `day_key` for samme bruger) og ikke på karusellens
--      `round_key + 7 dage`. Et efterfyldt dagskort, skrevet uger efter sin egen
--      runde, er vis-bart — det var det nyeste, brugeren havde.
--   3. Et kort, der blev afløst i samme sekund, det blev skrevet, er IKKE
--      vis-bart. Det er bagstopperens dagsløkke, der skriver flere dages kort i
--      samme kørsel (`G142`).
--   4. Æra-skellet er `news_value is not null`. v2's dagskort levede i
--      karusellen og beholder dens regel — og en v2-række må ALDRIG kunne
--      aflive et v3-kort som "efterfølger".
--   5. Rundekortene beholder karusellens regel uændret.
--   6. Efterfølgeren slås op i hele tabellen og på SAMME bruger: en
--      resultatrettelse, der skriver en gammel dag om, efter en nyere allerede
--      stod, gav et kort, ingen kunne nå — og en anden brugers kort må ikke
--      kunne aflive dit.
--
-- DET, DEN IKKE VOGTER. 48-timers loftet i udtrykket kan ikke flytte et
-- boolesk svar (et vindue kappet ved 48 timer er stadig > 0), så der findes
-- ingen fixture, en ændring af tallet ville fejle på. Leddet står i RPC'en for
-- at kunne diffes mod aflæsningens udtryk; begrundelsen står ved koden.
--
-- TÆRSKLEN ER ARVET MED VILJE. Vinduet regnes i HELE minutter og tælles som
-- vis-bart ved `> 0` — ordret samme udtryk som `_vindue` i
-- `sql/story_engine_v3_measure.sql`, så tavlen og aflæsningen ikke kan svare
-- hver sit på det samme spørgsmål. Prisen er, at `::int` runder: et vindue på
-- 30–59 sekunder tælles med. I virkeligheden er vinduet enten under et sekund
-- (samme sætning) eller timer, så båndet er tomt — men det er en arv og ikke en
-- regel, nogen har valgt for sig.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d viewabletest -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d viewabletest -v ON_ERROR_STOP=1 -b -f sql/tests/analytics_story_viewable.sql

\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------------------
-- Opsætning: én admin (RPC'en er gated) og fire brugere med hver sin fixture
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, created_at) values
  ('c4100000-0000-4000-8000-00000000000a', 'admin@test.local', now()),
  ('c4100000-0000-4000-8000-00000000000b', 'b@test.local', now()),
  ('c4100000-0000-4000-8000-00000000000c', 'c@test.local', now()),
  ('c4100000-0000-4000-8000-00000000000d', 'd@test.local', now()),
  ('c4100000-0000-4000-8000-00000000000e', 'e@test.local', now());
insert into public.profiles (id, display_name, is_admin) values
  ('c4100000-0000-4000-8000-00000000000a', 'Admin', true),
  ('c4100000-0000-4000-8000-00000000000b', 'Bruger B', false),
  ('c4100000-0000-4000-8000-00000000000c', 'Bruger C', false),
  ('c4100000-0000-4000-8000-00000000000d', 'Bruger D', false),
  ('c4100000-0000-4000-8000-00000000000e', 'Bruger E', false);

select set_config('test.uid', 'c4100000-0000-4000-8000-00000000000a', false);

-- ---------------------------------------------------------------------------
-- Fixturen. Ni rækker, alle inden for RPC'ens tredive dages vindue.
--
-- `round_key` er kun i spil for karusel-grenen; på v3-dagskortene står den som
-- den dato, rækken hører til, og er ligegyldig EFTER rettelsen — hvilket er
-- præcis det, påstand 1 og 2 læser forskellen på.
-- ---------------------------------------------------------------------------
insert into public.stories
  (user_id, round_key, day_key, period, rule, priority, news_value,
   headline, body, created_at)
values
  -- K1/K2 · bagstopperens dagsløkke: to dage skrevet i samme kørsel, ét sekund
  -- fra hinanden. K1 var aldrig det nyeste.
  ('c4100000-0000-4000-8000-00000000000b', current_date::text, current_date - 3,
   'day', 'DAY_TOP', 10, 50, 'K1', 'K1', now() - interval '26 hours'),
  ('c4100000-0000-4000-8000-00000000000b', current_date::text, current_date - 2,
   'day', 'DAY_TOP', 10, 50, 'K2', 'K2', now() - interval '26 hours' + interval '1 second'),

  -- K3 · det efterfyldte dagskort: skrevet tre uger efter sin egen runde, og
  -- brugerens eneste. Karusel-reglen kalder det dødt; vinduet kalder det levende.
  ('c4100000-0000-4000-8000-00000000000c', (current_date - 21)::text, current_date - 20,
   'day', 'CONTRARIAN', 10, 60, 'K3', 'K3', now() - interval '5 days'),

  -- K4 · v2's dagskort (`news_value is null`). Ligger med vilje på GÅRSDAGEN og
  -- er skrevet FØR K2 — altså en "efterfølger", der ville aflive K2, hvis
  -- efterfølger-opslaget glemte æra-skellet. Den må ikke kunne det.
  ('c4100000-0000-4000-8000-00000000000b', (current_date - 21)::text, current_date - 1,
   'day', 'DAY_RESULT', 10, null, 'K4', 'K4', now() - interval '30 hours'),

  -- K7/K8 · resultatrettelsen: den NYE dag blev skrevet FØRST. K7 var dermed
  -- dødt i det øjeblik, den blev skrevet.
  ('c4100000-0000-4000-8000-00000000000d', current_date::text, current_date - 6,
   'day', 'DUEL', 10, 50, 'K7', 'K7', now() - interval '2 hours'),
  ('c4100000-0000-4000-8000-00000000000d', current_date::text, current_date - 5,
   'day', 'DUEL', 10, 50, 'K8', 'K8', now() - interval '3 hours'),

  -- K9 · en ANDEN brugers kort med en større `day_key` end K3's og en ÆLDRE
  -- `created_at`. Den findes kun for at fange et efterfølger-opslag, der glemmer
  -- `n.user_id = s.user_id`: uden brugerfiltret ville den aflive K3.
  ('c4100000-0000-4000-8000-00000000000e', current_date::text, current_date - 4,
   'day', 'SO_CLOSE', 10, 50, 'K9', 'K9', now() - interval '6 days');

-- Rundekortene: ét inden for sit vindue, ét skrevet længe efter.
insert into public.stories
  (user_id, round_key, period, rule, priority, headline, body, created_at)
values
  ('c4100000-0000-4000-8000-00000000000b', current_date::text,
   'round', 'CHAMPION', 10, 'K5', 'K5', now()),
  ('c4100000-0000-4000-8000-00000000000c', (current_date - 21)::text,
   'round', 'CHAMPION', 10, 'K6', 'K6', now());

-- ---------------------------------------------------------------------------
-- Hjælper: `viewable` for én regel. Findes for at holde påstandene læsbare.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.vis(p_rule text)
returns int language sql as $$
  select (r ->> 'viewable')::int
    from jsonb_array_elements(public.admin_analytics_stories(30) -> 'rules') r
   where r ->> 'rule' = p_rule
$$;

create or replace function pg_temp.gen(p_rule text)
returns int language sql as $$
  select (r ->> 'generated')::int
    from jsonb_array_elements(public.admin_analytics_stories(30) -> 'rules') r
   where r ->> 'rule' = p_rule
$$;

-- ===========================================================================
-- 1. FØR migreringen: den gamle regel svarer forkert på fixturen
-- ===========================================================================
-- Uden dette trin kunne påstand 2 bestå, fordi fixturen var harmløs. Skemadumpet
-- bærer karusel-reglen for ALT, så de to rækker, rettelsen handler om, skal
-- kunne ses at være forkerte her.
do $$
declare fejl text := '';
begin
  -- Det efterfyldte dagskort tælles som usynligt, selv om det var det nyeste.
  if pg_temp.vis('CONTRARIAN') is distinct from 0 then
    fejl := fejl || format('CONTRARIAN vis=%s (forventet 0 FØR rettelsen); ', pg_temp.vis('CONTRARIAN'));
  end if;
  -- Og de to kort fra samme kørsel tælles begge som synlige.
  if pg_temp.vis('DAY_TOP') is distinct from 2 then
    fejl := fejl || format('DAY_TOP vis=%s (forventet 2 FØR rettelsen); ', pg_temp.vis('DAY_TOP'));
  end if;
  if fejl <> '' then
    raise exception 'fixturen viser ikke G141-fejlen, så testen beviser intet: %', fejl;
  end if;
  raise notice 'OK 1: den gamle regel svarer forkert på fixturen — fejlen er reproduceret';
end $$;

\ir ../analytics_dashboard.sql

-- ===========================================================================
-- 2. EFTER migreringen: hver række måles på sin egen flades regel
-- ===========================================================================
do $$
declare
  fejl text := '';
  v jsonb;
begin
  -- Antallet af genererede må IKKE flytte sig: `generated` er sand og skal blive
  -- ved med at være det (G73). Kun nævneren skifter.
  if pg_temp.gen('DAY_TOP') is distinct from 2
     or pg_temp.gen('CONTRARIAN') is distinct from 1
     or pg_temp.gen('DAY_RESULT') is distinct from 1
     or pg_temp.gen('CHAMPION') is distinct from 2
     or pg_temp.gen('DUEL') is distinct from 2
     or pg_temp.gen('SO_CLOSE') is distinct from 1 then
    fejl := fejl || 'generated flyttede sig; ';
  end if;

  -- Påstand 3: afløst i samme sekund ⇒ ikke vis-bar. Kun K2 tæller.
  if pg_temp.vis('DAY_TOP') is distinct from 1 then
    fejl := fejl || format('DAY_TOP vis=%s (forventet 1: K1 var aldrig det nyeste); ', pg_temp.vis('DAY_TOP'));
  end if;

  -- Påstand 2: det efterfyldte dagskort måles på vinduet og ikke på round_key.
  if pg_temp.vis('CONTRARIAN') is distinct from 1 then
    fejl := fejl || format('CONTRARIAN vis=%s (forventet 1: karusel-reglen gælder ikke v3); ', pg_temp.vis('CONTRARIAN'));
  end if;

  -- Påstand 4: v2's dagskort beholder karusellens regel — og K4 aflivede ikke K2
  -- (det ses på DAY_TOP ovenfor).
  if pg_temp.vis('DAY_RESULT') is distinct from 0 then
    fejl := fejl || format('DAY_RESULT vis=%s (forventet 0: v2 måles stadig på karusellen); ', pg_temp.vis('DAY_RESULT'));
  end if;

  -- Påstand 5: rundekortene er uændrede.
  if pg_temp.vis('CHAMPION') is distinct from 1 then
    fejl := fejl || format('CHAMPION vis=%s (forventet 1: rundekortenes regel er urørt); ', pg_temp.vis('CHAMPION'));
  end if;

  -- Påstand 6a: den omvendte rækkefølge. Kun K8 tæller.
  if pg_temp.vis('DUEL') is distinct from 1 then
    fejl := fejl || format('DUEL vis=%s (forventet 1: K7 var dødt ved skrivningen); ', pg_temp.vis('DUEL'));
  end if;

  -- Påstand 6b: en anden brugers kort aflivede ikke K3 — det ses på CONTRARIAN
  -- ovenfor — og K9 er selv vis-bar.
  if pg_temp.vis('SO_CLOSE') is distinct from 1 then
    fejl := fejl || format('SO_CLOSE vis=%s (forventet 1); ', pg_temp.vis('SO_CLOSE'));
  end if;

  v := public.admin_analytics_stories(30);
  if (v ->> 'generated_total')::int is distinct from 9 then
    fejl := fejl || format('generated_total=%s (forventet 9); ', v ->> 'generated_total');
  end if;
  if (v ->> 'viewable_total')::int is distinct from 5 then
    fejl := fejl || format('viewable_total=%s (forventet 5); ', v ->> 'viewable_total');
  end if;

  if fejl <> '' then
    raise exception 'viewable regnes forkert: %', fejl;
  end if;
  raise notice 'OK 2: dagskort måles på vinduet, rundekort og v2 på karusellen';
end $$;

-- ===========================================================================
-- 3. Raterne bruger den nye nævner
-- ===========================================================================
-- Nævneren er ikke et tal i en kolonne, den er nævner under to rater — og det er
-- dér, en forkert `viewable` faktisk gør skade. Én visning af CONTRARIAN skal
-- give 100 % og ikke `null`: før rettelsen var nævneren nul, og raten forsvandt.
insert into public.analytics_events (event_name, user_id, metadata)
values ('story_viewed', 'c4100000-0000-4000-8000-00000000000c',
        '{"rule": "CONTRARIAN"}');

do $$
declare raekke jsonb;
begin
  select r into raekke
    from jsonb_array_elements(public.admin_analytics_stories(30) -> 'rules') r
   where r ->> 'rule' = 'CONTRARIAN';
  if (raekke ->> 'view_rate') is null then
    raise exception 'view_rate er null — nævneren er nul, altså den gamle regel';
  end if;
  if (raekke ->> 'view_rate')::numeric is distinct from 100.0 then
    raise exception 'view_rate=% (forventet 100.0)', raekke ->> 'view_rate';
  end if;
  raise notice 'OK 3: raterne regnes på det vindue, kortet faktisk havde';
end $$;

\echo 'analytics_story_viewable.sql: alle paastande holder'
