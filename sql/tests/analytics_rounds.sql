-- Test af "Aktive brugere pr. runde" (`admin_analytics_rounds`, B38).
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR DEN FINDES. RPC'en er en serie, ingen kan efterprøve i hånden: den
-- læser fire kilder (kampe, konkurrencer, tips, aktivitetsdage) og lægger dem i
-- én spand pr. runde. Hver eneste af dens fejlmåder er TAVS — et forkert tal,
-- ikke en fejlmeddelelse — og en aktivitetsserie, der lyver, er værre end ingen
-- serie: den bliver læst som en udvikling og handlet på.
--
-- HVAD DEN BEVISER
--   1. Formen: ældst først, én række pr. runde, og `p_rounds` klampes til
--      [1, 52] frem for at blive stolet på.
--   2. Kun runder, der er gået i gang OG indgår i mindst én konkurrence. En
--      Sportmonks-runde, ingen tipper på, er ikke en runde, nogen kunne have
--      været aktiv i.
--   3. `players` ÷ `exposed` pr. runde, og `missed` som differencen. Begge fra
--      samme kilde som North Star, så deltagelsen ikke kan modsige den.
--   4. 🔴 **GRAIN-REGLEN.** En bruger med den SAMME kamp i to konkurrencer er
--      ÉN eksponeret og ÉN spiller — ikke to. `predictions` deles på tværs af
--      konkurrencer, så et glemt `distinct` dobbelttæller netop de mest
--      aktive brugere og gør serien pænest, hvor den er mest forkert.
--   5. 🔴 **`new_players` måles over HELE historikken, ikke over vinduet.**
--      Med `p_rounds = 2` må en bruger, der debuterede før vinduet, ikke tælle
--      som ny. Fejlen ville få hver eneste flytning af vinduet til at se ud som
--      en strøm af nye spillere.
--   6. 🔴 **Et tip på en kamp UDEN konkurrence gør ingen til spiller.** Det er
--      fælden ved den oplagte implementering (tæl `predictions` direkte): den
--      kan give flere spillere end eksponerede og dermed en rate over 100 %.
--   7. `visitors` er `null` for en runde, hvis uge begynder før
--      aktivitetssporingen fandtes — ALDRIG 0, som ikke kan skelnes fra "ingen
--      kom forbi". Samme regel som retention-matrixen.
--   8. `is_open` er enig med `match_locked()` — se forbeholdet nedenfor.
--   9. Adgang: en almindelig bruger får `forbidden`, ikke et svar.
--  10. Migreringen er idempotent (filen køres to gange).
--
-- HVAD DEN **IKKE** GØR, OG HVORFOR (§13)
-- `is_open` kan ikke fastholdes til `true` af en test. Flaget betyder "ikke
-- alle rundens kampe er låst endnu", og fordi `round_key` er GENERERET af
-- kickoff, kan det kun være sandt for den runde, uret står i lige nu — altså i
-- et vindue, testen ikke selv kan vælge. Påstand 8 sammenligner derfor mod
-- sandheden fra `public.match_locked()` frem for mod en hardkodet forventning:
-- den måler, at RPC'en og låsen siger det samme, hvilket er selve invarianten.
-- At klienten holder en åben runde ude af overskriftstallet og retningen er
-- unit-testet deterministisk i `src/lib/analytics.test.js`.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d rundetest -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d rundetest -v ON_ERROR_STOP=1 -b -f sql/tests/analytics_rounds.sql

\set ON_ERROR_STOP on
\timing off

\ir ../analytics_dashboard.sql

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- Fem runder, forankret i den runde uret står i nu — fire af dem er gået i gang.
-- Ankeret er `now() - 3 timer` og ikke `now()`, så en kørsel i minutterne
-- omkring en rundegrænse lander i en runde, der beviseligt ER gået i gang.
--
--   R1 (r4-21)  ANNA tipper                       → ANNAs debut
--   R2 (r4-14)  ANNA + BO tipper                  → BOs debut. ANNA er med i TO
--                                                   konkurrencer på samme kamp
--   R3 (r4-7)   ANNA + CARL tipper                → CARLs debut. CARL meldte sig
--                                                   først til efter R2, så han er
--                                                   ikke eksponeret før her
--   R4 (r4)     ingen tipper endnu                → runden i gang
--   R5 (r4+14)  kampen er ikke låst endnu         → runden er ikke gået i gang
--                                                   og må ALDRIG tegne en søjle
--
--   DIDDE er med i konkurrencen hele vejen og tipper ALDRIG en kamp, der tæller
--   — kun en forældreløs kamp uden konkurrence (påstand 6).
create temp table runder as
select public.round_key(now() - interval '3 hours') as r4;

insert into auth.users (id, email) values
  ('b3800000-0000-4000-8000-00000000000a', 'admin@test.local'),
  ('b3800000-0000-4000-8000-00000000000b', 'anna@test.local'),
  ('b3800000-0000-4000-8000-00000000000c', 'bo@test.local'),
  ('b3800000-0000-4000-8000-00000000000d', 'carl@test.local'),
  ('b3800000-0000-4000-8000-00000000000e', 'didde@test.local');
insert into public.profiles (id, display_name, is_admin) values
  ('b3800000-0000-4000-8000-00000000000a', 'Admin', true),
  ('b3800000-0000-4000-8000-00000000000b', 'Anna',  false),
  ('b3800000-0000-4000-8000-00000000000c', 'Bo',    false),
  ('b3800000-0000-4000-8000-00000000000d', 'Carl',  false),
  ('b3800000-0000-4000-8000-00000000000e', 'Didde', false);

insert into public.leagues (id, name) values
  ('b3800000-0000-4000-8000-000000000101', 'Testligaen');
insert into public.seasons (id, league_id, name) values
  ('b3800000-0000-4000-8000-000000000201', 'b3800000-0000-4000-8000-000000000101', '2026/27');
insert into public.teams (id, league_id, name) values
  ('b3800000-0000-4000-8000-000000000301', 'b3800000-0000-4000-8000-000000000101', 'Hjemme'),
  ('b3800000-0000-4000-8000-000000000302', 'b3800000-0000-4000-8000-000000000101', 'Ude');

-- Onsdag 18.00 dansk tid i hver af de tre afsluttede runder: midt i ugen, så
-- ingen kamp kan glide over i naboenrunden, uanset sommertid.
insert into public.matches (id, season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
select v.id, 'b3800000-0000-4000-8000-000000000201',
       'b3800000-0000-4000-8000-000000000301', 'b3800000-0000-4000-8000-000000000302',
       (((select r4 from runder) - v.uger_siden * 7)::timestamp at time zone 'Europe/Copenhagen')
         + interval '1 day 18 hours',
       2, 1
from (values
  ('b3800000-0000-4000-8000-000000000401'::uuid, 3),   -- R1
  ('b3800000-0000-4000-8000-000000000402'::uuid, 2),   -- R2
  ('b3800000-0000-4000-8000-000000000403'::uuid, 1),   -- R3
  ('b3800000-0000-4000-8000-000000000404'::uuid, 1)    -- R3, forældreløs (ingen konkurrence)
) as v(id, uger_siden);

-- R4, runden i gang: én kamp der er låst (spillet for tre timer siden, uden
-- resultat endnu) og én i rundens sidste minut, som normalt IKKE er låst endnu.
insert into public.matches (id, season_id, home_team_id, away_team_id, kickoff_at) values
  ('b3800000-0000-4000-8000-000000000405', 'b3800000-0000-4000-8000-000000000201',
   'b3800000-0000-4000-8000-000000000301', 'b3800000-0000-4000-8000-000000000302',
   now() - interval '3 hours'),
  ('b3800000-0000-4000-8000-000000000406', 'b3800000-0000-4000-8000-000000000201',
   'b3800000-0000-4000-8000-000000000301', 'b3800000-0000-4000-8000-000000000302',
   ((((select r4 from runder) + 7)::timestamp at time zone 'Europe/Copenhagen') - interval '1 minute')),
  -- R5: en runde, der IKKE er gået i gang. Den må ikke tegne en søjle — en
  -- fremtidig runde har hverken spillere eller eksponerede, og en tom søjle
  -- forrest i serien ville se ud som et frafald.
  ('b3800000-0000-4000-8000-000000000407', 'b3800000-0000-4000-8000-000000000201',
   'b3800000-0000-4000-8000-000000000301', 'b3800000-0000-4000-8000-000000000302',
   ((((select r4 from runder) + 14)::timestamp at time zone 'Europe/Copenhagen') + interval '1 day 18 hours'));

-- Selvtjek af fixturen: fire runder og ikke fem. Uden den kunne en
-- rundegrænse, ingen havde tænkt på, gøre alle tal nedenfor til noget andet,
-- end de påstår at måle — og testen ville stadig se grøn ud på de forkerte tal.
do $$
declare v_runder int; v_r4 date := (select r4 from runder);
begin
  select count(distinct round_key) into v_runder from public.matches;
  if v_runder <> 5 then
    raise exception 'fixturen ramte % runder og ikke 5 — rundegrænserne flyttede sig under kørslen', v_runder;
  end if;
  if (select round_key from public.matches where id = 'b3800000-0000-4000-8000-000000000405') <> v_r4 then
    raise exception 'R4-kampen landede i en anden runde end ankeret';
  end if;
  if (select round_key from public.matches where id = 'b3800000-0000-4000-8000-000000000406') <> v_r4 then
    raise exception 'R4s sene kamp landede i en anden runde end ankeret';
  end if;
end $$;

-- To konkurrencer. Den anden findes UDELUKKENDE for grain-reglen: den deler
-- R2-kampen med den første, og ANNA er med i begge.
insert into public.competitions (id, name, mode, created_by) values
  ('b3800000-0000-4000-8000-000000000501', 'Hovedkonkurrencen', 'full_season', 'b3800000-0000-4000-8000-00000000000b'),
  ('b3800000-0000-4000-8000-000000000502', 'Sidekonkurrencen',  'full_season', 'b3800000-0000-4000-8000-00000000000b');

insert into public.competition_matches (competition_id, match_id) values
  ('b3800000-0000-4000-8000-000000000501', 'b3800000-0000-4000-8000-000000000401'),
  ('b3800000-0000-4000-8000-000000000501', 'b3800000-0000-4000-8000-000000000402'),
  ('b3800000-0000-4000-8000-000000000501', 'b3800000-0000-4000-8000-000000000403'),
  ('b3800000-0000-4000-8000-000000000501', 'b3800000-0000-4000-8000-000000000405'),
  ('b3800000-0000-4000-8000-000000000501', 'b3800000-0000-4000-8000-000000000406'),
  ('b3800000-0000-4000-8000-000000000501', 'b3800000-0000-4000-8000-000000000407'),
  -- Samme R2-kamp i konkurrence nr. 2.
  ('b3800000-0000-4000-8000-000000000502', 'b3800000-0000-4000-8000-000000000402');
-- Kampen '...404' er med vilje IKKE i nogen konkurrence (påstand 6).

insert into public.competition_participants (competition_id, user_id, joined_at) values
  ('b3800000-0000-4000-8000-000000000501', 'b3800000-0000-4000-8000-00000000000b', now() - interval '60 days'),
  ('b3800000-0000-4000-8000-000000000501', 'b3800000-0000-4000-8000-00000000000c', now() - interval '60 days'),
  ('b3800000-0000-4000-8000-000000000501', 'b3800000-0000-4000-8000-00000000000e', now() - interval '60 days'),
  -- ANNA i begge — grain-reglen.
  ('b3800000-0000-4000-8000-000000000502', 'b3800000-0000-4000-8000-00000000000b', now() - interval '60 days'),
  -- CARL kom først til efter R2 var låst: rundens start i R3.
  ('b3800000-0000-4000-8000-000000000501', 'b3800000-0000-4000-8000-00000000000d',
   (((select r4 from runder) - 7)::timestamp at time zone 'Europe/Copenhagen'));

insert into public.predictions (user_id, match_id, pred_home, pred_away) values
  ('b3800000-0000-4000-8000-00000000000b', 'b3800000-0000-4000-8000-000000000401', 2, 1), -- ANNA R1
  ('b3800000-0000-4000-8000-00000000000b', 'b3800000-0000-4000-8000-000000000402', 2, 1), -- ANNA R2
  ('b3800000-0000-4000-8000-00000000000b', 'b3800000-0000-4000-8000-000000000403', 2, 1), -- ANNA R3
  ('b3800000-0000-4000-8000-00000000000c', 'b3800000-0000-4000-8000-000000000402', 1, 1), -- BO   R2
  ('b3800000-0000-4000-8000-00000000000d', 'b3800000-0000-4000-8000-000000000403', 0, 0), -- CARL R3
  -- DIDDE tipper KUN den forældreløse kamp.
  ('b3800000-0000-4000-8000-00000000000e', 'b3800000-0000-4000-8000-000000000404', 3, 3);

-- Aktivitetsdage findes først fra R3: R1 og R2 skal derfor svare `null` og
-- ikke 0 besøgende.
insert into public.user_activity_days (user_id, day) values
  ('b3800000-0000-4000-8000-00000000000b', (select r4 - 7 from runder)),
  ('b3800000-0000-4000-8000-00000000000c', (select r4 - 7 from runder)),
  ('b3800000-0000-4000-8000-00000000000b', (select r4 - 5 from runder)),
  ('b3800000-0000-4000-8000-00000000000d', (select r4     from runder));

-- Kør som admin resten af filen. RPC'en er `security definer` med en
-- is_admin-vagt, så uden dette svarer den 'forbidden'.
select set_config('test.uid', 'b3800000-0000-4000-8000-00000000000a', false);

-- ===========================================================================
-- 1. Formen: ældst først, én række pr. runde, klampet vindue
-- ===========================================================================
do $$
declare
  v jsonb;
  v_r4 date := (select r4 from runder);
begin
  v := public.admin_analytics_rounds(12);

  -- Fem runder findes; kun de FIRE, der er gået i gang, må være med.
  if jsonb_array_length(v -> 'rounds') <> 4 then
    raise exception 'forventede 4 igangsatte runder, fik %', jsonb_array_length(v -> 'rounds');
  end if;
  if (v -> 'rounds' -> 0 ->> 'round_key')::date <> v_r4 - 21 then
    raise exception 'serien er ikke ældst først: første runde er %', v -> 'rounds' -> 0 ->> 'round_key';
  end if;
  if (v -> 'rounds' -> 3 ->> 'round_key')::date <> v_r4 then
    raise exception 'serien slutter ikke på den nyeste runde: %', v -> 'rounds' -> 3 ->> 'round_key';
  end if;
  if (v ->> 'rounds_available')::int <> 4 then
    raise exception 'rounds_available er % og ikke 4', v ->> 'rounds_available';
  end if;

  -- Klampningen: et vindue er en oplysning fra klienten, ikke en tillid.
  if (public.admin_analytics_rounds(0) ->> 'rounds_window')::int <> 1 then
    raise exception 'p_rounds = 0 blev ikke klampet til 1';
  end if;
  if (public.admin_analytics_rounds(9999) ->> 'rounds_window')::int <> 52 then
    raise exception 'p_rounds = 9999 blev ikke klampet til 52';
  end if;
  if (public.admin_analytics_rounds(null) ->> 'rounds_window')::int <> 12 then
    raise exception 'p_rounds = null gav ikke standarden 12';
  end if;
  if jsonb_array_length(public.admin_analytics_rounds(2) -> 'rounds') <> 2 then
    raise exception 'p_rounds = 2 gav ikke de 2 nyeste runder';
  end if;

  raise notice 'OK 1: kun de igangsatte runder, ældst først, vinduet klampet';
end $$;

-- ===========================================================================
-- 2 + 3 + 4. Tallene pr. runde — og grain-reglen
-- ===========================================================================
-- R2 er den vigtige række: ANNA er eksponeret for den SAMME kamp i to
-- konkurrencer. Uden `distinct` ville hun tælle som to eksponerede og to
-- spillere, og R2 ville stå med 4 eksponerede i stedet for 3.
do $$
declare
  r jsonb;
  fejl text := '';
  v_r4 date := (select r4 from runder);
begin
  for r in select e from jsonb_array_elements(public.admin_analytics_rounds(12) -> 'rounds') e loop
    if (r ->> 'round_key')::date = v_r4 - 21 then           -- R1
      if (r ->> 'exposed')::int <> 3 or (r ->> 'players')::int <> 1 then
        fejl := fejl || format('R1: eksponerede=%s spillere=%s (ventet 3/1); ', r ->> 'exposed', r ->> 'players');
      end if;
      if (r ->> 'new_players')::int <> 1 then
        fejl := fejl || format('R1: nye=%s (ventet 1 — ANNAs debut); ', r ->> 'new_players');
      end if;
    elsif (r ->> 'round_key')::date = v_r4 - 14 then        -- R2
      if (r ->> 'exposed')::int <> 3 then
        fejl := fejl || format('R2: eksponerede=%s (ventet 3 — ANNA tælles ÉN gang i to konkurrencer); ', r ->> 'exposed');
      end if;
      if (r ->> 'players')::int <> 2 then
        fejl := fejl || format('R2: spillere=%s (ventet 2); ', r ->> 'players');
      end if;
      if (r ->> 'tips')::int <> 2 then
        fejl := fejl || format('R2: tips=%s (ventet 2 — ANNAs tip tælles ÉN gang); ', r ->> 'tips');
      end if;
      if (r ->> 'new_players')::int <> 1 then
        fejl := fejl || format('R2: nye=%s (ventet 1 — BOs debut); ', r ->> 'new_players');
      end if;
    elsif (r ->> 'round_key')::date = v_r4 - 7 then         -- R3
      if (r ->> 'exposed')::int <> 4 or (r ->> 'players')::int <> 2 then
        fejl := fejl || format('R3: eksponerede=%s spillere=%s (ventet 4/2); ', r ->> 'exposed', r ->> 'players');
      end if;
      if (r ->> 'new_players')::int <> 1 then
        fejl := fejl || format('R3: nye=%s (ventet 1 — CARLs debut); ', r ->> 'new_players');
      end if;
    elsif (r ->> 'round_key')::date = v_r4 then             -- R4
      if (r ->> 'exposed')::int <> 4 or (r ->> 'players')::int <> 0 then
        fejl := fejl || format('R4: eksponerede=%s spillere=%s (ventet 4/0); ', r ->> 'exposed', r ->> 'players');
      end if;
    end if;

    -- Invarianterne, som gælder hver eneste række.
    if (r ->> 'players')::int > (r ->> 'exposed')::int then
      fejl := fejl || format('%s: flere spillere end eksponerede; ', r ->> 'round_key');
    end if;
    if (r ->> 'missed')::int <> (r ->> 'exposed')::int - (r ->> 'players')::int then
      fejl := fejl || format('%s: missed er ikke differencen; ', r ->> 'round_key');
    end if;
    if (r ->> 'new_players')::int > (r ->> 'players')::int then
      fejl := fejl || format('%s: flere nye end spillere; ', r ->> 'round_key');
    end if;
    if r ->> 'play_rate' is not null and (r ->> 'play_rate')::numeric > 100 then
      fejl := fejl || format('%s: deltagelse over 100 %%; ', r ->> 'round_key');
    end if;
  end loop;

  if fejl <> '' then raise exception 'runde-tallene er forkerte: %', fejl; end if;
  raise notice 'OK 2-4: tallene pr. runde holder, og en delt kamp tælles én gang';
end $$;

-- ===========================================================================
-- 5. `new_players` måles over hele historikken, ikke over vinduet
-- ===========================================================================
-- Med `p_rounds = 2` ligger ANNAs debut (R1) UDEN for vinduet. Ser RPC'en kun
-- vinduet, bliver hun "ny" i R3 — og hver eneste flytning af vinduet ville
-- opfinde nye spillere.
do $$
declare r jsonb; v_r4 date := (select r4 from runder);
begin
  select e into r from jsonb_array_elements(public.admin_analytics_rounds(2) -> 'rounds') e
   where (e ->> 'round_key')::date = v_r4 - 7;

  if r is null then
    raise exception 'R3 mangler i et 2-runders vindue';
  end if;
  if (r ->> 'players')::int <> 2 then
    raise exception 'R3 i det smalle vindue har % spillere og ikke 2', r ->> 'players';
  end if;
  if (r ->> 'new_players')::int <> 1 then
    raise exception 'nye spillere måles over vinduet og ikke over historikken: R3 gav % (ventet 1)', r ->> 'new_players';
  end if;
  raise notice 'OK 5: debut læses over hele historikken — et smalt vindue opfinder ingen nye spillere';
end $$;

-- ===========================================================================
-- 6. Et tip uden konkurrence gør ingen til spiller
-- ===========================================================================
-- DIDDE har tippet præcis én kamp — den forældreløse i R3. Tælles `predictions`
-- direkte, bliver hun en aktiv bruger i en runde, hun ikke deltog i, og R3
-- ville stå med 3 spillere ud af 4 eksponerede.
do $$
declare r jsonb; v_r4 date := (select r4 from runder);
begin
  select e into r from jsonb_array_elements(public.admin_analytics_rounds(12) -> 'rounds') e
   where (e ->> 'round_key')::date = v_r4 - 7;

  if (r ->> 'players')::int <> 2 then
    raise exception 'et tip på en kamp uden konkurrence blev talt med: R3 har % spillere', r ->> 'players';
  end if;
  if (r ->> 'match_count')::int <> 1 then
    raise exception 'den forældreløse kamp blev talt med i runden: match_count=%', r ->> 'match_count';
  end if;
  raise notice 'OK 6: kun kampe i en konkurrence tæller — hverken i spillere eller i kampantal';
end $$;

-- ===========================================================================
-- 7. `visitors`: umålt er null, aldrig nul
-- ===========================================================================
do $$
declare
  v jsonb; r jsonb; fejl text := '';
  v_r4 date := (select r4 from runder);
begin
  v := public.admin_analytics_rounds(12);

  if (v ->> 'activity_since')::date <> v_r4 - 7 then
    fejl := fejl || format('activity_since=%s (ventet %s); ', v ->> 'activity_since', v_r4 - 7);
  end if;

  for r in select e from jsonb_array_elements(v -> 'rounds') e loop
    if (r ->> 'round_key')::date < v_r4 - 7 then
      if r ->> 'visitors' is not null then
        fejl := fejl || format('%s: besøgende=%s, men ugen ligger før sporingen fandtes (skal være null); ',
                               r ->> 'round_key', r ->> 'visitors');
      end if;
    elsif (r ->> 'round_key')::date = v_r4 - 7 then
      -- ANNA og BO, hvor ANNA har to dage i samme uge: distinkte BRUGERE.
      if (r ->> 'visitors')::int is distinct from 2 then
        fejl := fejl || format('R3: besøgende=%s (ventet 2); ', r ->> 'visitors');
      end if;
    elsif (r ->> 'round_key')::date = v_r4 then
      if (r ->> 'visitors')::int is distinct from 1 then
        fejl := fejl || format('R4: besøgende=%s (ventet 1); ', r ->> 'visitors');
      end if;
    end if;
  end loop;

  if fejl <> '' then raise exception 'besøgs-tallene er forkerte: %', fejl; end if;
  raise notice 'OK 7: umålte uger er null, målte uger tæller distinkte brugere';
end $$;

-- ===========================================================================
-- 8. `is_open` siger det samme som låsen
-- ===========================================================================
do $$
declare
  r jsonb;
  v_r4 date := (select r4 from runder);
  v_sandhed boolean;
begin
  select exists (
    select 1 from public.matches m
    join public.competition_matches cm on cm.match_id = m.id
    where m.round_key = v_r4 and not public.match_locked(m.kickoff_at, m.kickoff_tbd)
  ) into v_sandhed;

  select e into r from jsonb_array_elements(public.admin_analytics_rounds(12) -> 'rounds') e
   where (e ->> 'round_key')::date = v_r4;

  if (r ->> 'is_open')::boolean is distinct from v_sandhed then
    raise exception 'is_open=% men låsen siger %', r ->> 'is_open', v_sandhed;
  end if;

  -- De afsluttede runder må ALDRIG være åbne — den halvdel er deterministisk.
  if exists (
    select 1 from jsonb_array_elements(public.admin_analytics_rounds(12) -> 'rounds') e
    where (e ->> 'round_key')::date < v_r4 and (e ->> 'is_open')::boolean
  ) then
    raise exception 'en afsluttet runde blev markeret som i gang';
  end if;

  raise notice 'OK 8: is_open er enig med match_locked(), og afsluttede runder er lukkede';
end $$;

-- ===========================================================================
-- 9. Adgang: en almindelig bruger får intet svar
-- ===========================================================================
do $$
declare v jsonb;
begin
  perform set_config('test.uid', 'b3800000-0000-4000-8000-00000000000b', true);
  begin
    v := public.admin_analytics_rounds(12);
    raise exception 'en almindelig bruger fik et svar: %', v;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  raise notice 'OK 9: gaten holder — kun admins får serien';
end $$;

select set_config('test.uid', 'b3800000-0000-4000-8000-00000000000a', false);

-- ===========================================================================
-- 10. Idempotens
-- ===========================================================================
\ir ../analytics_dashboard.sql

do $$
declare v jsonb;
begin
  v := public.admin_analytics_rounds(12);
  if jsonb_array_length(v -> 'rounds') <> 4 then
    raise exception 'anden kørsel af migreringen ændrede svaret: % runder', jsonb_array_length(v -> 'rounds');
  end if;
  raise notice 'OK 10: to kørsler i træk giver samme svar';
end $$;

\echo 'analytics_rounds.sql: alle paastande holder'
