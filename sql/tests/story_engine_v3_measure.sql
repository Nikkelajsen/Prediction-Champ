-- Test af `sql/story_engine_v3_measure.sql` — aflæsningen bag `A33` og `A35`.
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR EN AD HOC-AFLÆSNING FÅR EN TEST
-- `sql/story_engine_v2_measure.sql` har ingen, og det er normen for et
-- ad hoc-værktøj. Denne fil er en undtagelse af én grund: `A32` (10. august
-- 2026) gjorde produktionsaflæsninger til ejerens arbejde, og prisen — som
-- beslutningen selv siger — er en kø på ét menneske. En forespørgsel, der
-- fejler i SQL-editoren med `42703 column … does not exist`, koster derfor en
-- hel omgang af netop den ressource, `A32` erklærede for dyr. Det, der arbejdes
-- på i stedet, er "at gøre en bestilling billig", og en bestilling, der er
-- bevist mod det RIGTIGE skema, er billigere end en, der er læst igennem.
--
-- HVORFOR DET RIGTIGE SKEMA OG IKKE ET MINISKEMA
-- Aflæsningen læser `stories.news_value`, `stories.day_key`, `stories.payload`
-- og `analytics_events.metadata` — alle fire er kolonner, motoren og klienten
-- skriver, og et miniskema ville gøre dem til kolonner, testen selv fandt på.
-- `stories_day_slot_uniq` (ét kort pr. bruger pr. dag i v3-æraen) og
-- `analytics_events_name_check` (kataloget over lovlige eventnavne) findes kun
-- i produktionsskemaet — og begge bærer en påstand her: fixturen kan ikke
-- indsætte to kort til samme bruger samme dag, og den kan ikke stave
-- `story_score_distribution` forkert.
--
-- HVAD DEN BEVISER
-- Fixturen er syntetisk og dens facit er regnet i hånden FØR kørslen: 5 brugere,
-- 12 kampdage, fire kort-mønstre i fast rotation. Påstandene dækker
--   1. udløserens to halvdele (to uger, ti kampdage) og de to for `A33`
--      (vis-bar > 0, vist > 0),
--   2. `A35`s andel globalt (25 af 51 = 49,0 %) og pr. aktiv bruger (median
--      50,0 %) — inkl. at en bruger med FÆRRE end fem kampdage ikke tæller med,
--   3. at handlingsgrænsernes dom sættes af tallet og ikke af en formodning,
--   4. **modspillets pointe:** andelen er den SAMME ved tærskel 45, 48, 51 og
--      53 og springer først ved 38/44 og ved 55. Det er hele scorerum-fundet
--      gjort til en påstand: håndtaget er ujævnt, og en tærskelflytning inden
--      for et spænd mellem to gulve gør ingenting,
--   5. `A33`s tre mål for variation — fordelingen over VALGTE regler,
--      gentagelsen fra kampdag til kampdag (26,1 %) og ensformigheden (50,0 %),
--   6. at reglen, brugeren SÅ, holdes adskilt fra den, motoren VALGTE: 13 kort
--      er dæmpede `DAY_RESULT` med en anden vinder,
--   7. at regler uden en eneste udløsning navngives frem for at mangle,
--   8. **vis-bar efter v3's regel og ikke v2's karrusel:** to kort skrevet i
--      SAMME sætning med hver sin `day_key` — bagstopperens dagsløkke — giver
--      det ældste et vindue på nul minutter, fordi `loadDayCard` altid henter
--      den nyeste `day_key`. Det er den ene påstand, der kan skelne v3-reglen
--      fra ingen regel.
-- Påstand 8 kører aflæsningen ANDEN gang i samme session og beviser dermed
-- samtidig, at filen er trygt gen-kørbar.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d v3maal -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d v3maal -v ON_ERROR_STOP=1 -b -f sql/tests/story_engine_v3_measure.sql

\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- Datoerne er RELATIVE til `current_date`, fordi aflæsningen selv regner "dage
-- siden første v3-dagskort" mod den. En fixture med faste datoer ville bestå i
-- dag og fejle om et år — og det er ikke en test, det er et lotteri.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-00000000000' || i)::uuid, 'u' || i || '@test.local'
from generate_series(1, 5) i;
insert into public.profiles (id, display_name)
select ('00000000-0000-4000-8000-00000000000' || i)::uuid, 'Bruger ' || i
from generate_series(1, 5) i;

-- Fire mønstre i rotation efter (dag + bruger) mod 4, så hver af de fire
-- bruger-serier er faseforskudt. Bruger 1–4 har 12 kampdage; bruger 5 har 3 og
-- må derfor IKKE tælle som aktiv (påstand 2).
insert into public.stories
  (round_key, user_id, rule, priority, league_size, news_value,
   payload, headline, body, period, day_key, created_at)
select
  to_char(current_date - 21, 'YYYY-MM-DD'),
  ('00000000-0000-4000-8000-00000000000' || u)::uuid,
  v.vist, v.prio, 8, v.nv,
  jsonb_build_object('winner_rule', v.vinder, 'runner_up_value', v.toer,
                     'day_key', (current_date - 20 + d), 'third', false),
  'overskrift', 'brødtekst', 'day', (current_date - 20 + d),
  (current_date - 20 + d)::timestamptz + interval '22 hours'
from generate_series(1, 5) u
cross join generate_series(0, 11) d
cross join lateral (
  select * from (values
    -- vist regel · valgt regel · news_value · toerens værdi · prioritet
    (0, 'DAY_TOP',    'DAY_TOP',         54, 44, 130),
    (1, 'DAY_RESULT', 'COLLECTIVE_MISS', 44,  0, 180),
    (2, 'DAY_RESULT', 'DAY_RESULT',      36,  0, 180),
    (3, 'CONTRARIAN', 'CONTRARIAN',      58, 50, 120)
  ) t(md, vist, vinder, nv, toer, prio)
  where t.md = (d + u) % 4
) v
where u < 5 or d < 3;

-- Bruger 1 har set sine fire ældste kort. Ingen andre har set noget — så
-- `vist > 0` er sandt uden at være trivielt sandt for alle.
insert into public.analytics_events (event_name, user_id, metadata, created_at)
select 'story_score_distribution', s.user_id,
       jsonb_build_object('day_key', s.day_key::text,
                          'winner_rule', s.payload ->> 'winner_rule',
                          'news_value', s.news_value,
                          'runner_up_value', s.payload ->> 'runner_up_value'),
       s.created_at + interval '1 hour'
from public.stories s
where s.user_id = '00000000-0000-4000-8000-000000000001'
order by s.day_key
limit 4;

-- ---------------------------------------------------------------------------
-- Stime-fixturen (blok 3 · `G143`)
-- ---------------------------------------------------------------------------
-- Bruger 1 får fem kampe i træk med point, som slutter på den dag, hun i forvejen
-- har et `DAY_TOP`-kort (`current_date - 17`, altså d = 3 i rotationen ovenfor),
-- og derefter én kamp UDEN point dagen efter.
--
-- Fixturen er skruet sammen for at ramme de to tilstande, blokken findes for:
--   · stimen var kandidat på en dag, hvor en ANDEN regel vandt — reglen er
--     domineret og ikke uden anledning, og
--   · stimen brød en SENERE dag, altså 💤-grenens blinde vinkel (`G144`).
-- Uden begge dele kan blokken kun bevise, at den kan tælle til nul.
--
-- Triggerne på `matches` slås fra: de kalder `recompute_ratings()` og dermed
-- historie-motoren, som ville skrive sine egne kort ind i det, testen tæller.
alter table public.matches disable trigger all;

insert into public.leagues (id, name, is_official)
values ('99999999-0000-4000-8000-000000000001', 'Stimeligaen', true);
insert into public.seasons (id, league_id, name)
values ('99999999-0000-4000-8000-000000000002', '99999999-0000-4000-8000-000000000001', '25/26');
insert into public.teams (id, league_id, name) values
  ('99999999-0000-4000-8000-000000000003', '99999999-0000-4000-8000-000000000001', 'Hjemme'),
  ('99999999-0000-4000-8000-000000000004', '99999999-0000-4000-8000-000000000001', 'Ude');

-- Seks kampe: fem på dagene −21 … −17 og én på −16. Alle ender 2-0.
insert into public.matches (id, season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
select ('99999999-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid,
       '99999999-0000-4000-8000-000000000002',
       '99999999-0000-4000-8000-000000000003', '99999999-0000-4000-8000-000000000004',
       (current_date - 21 + i)::timestamptz + interval '18 hours', 2, 0
from generate_series(0, 5) i;

-- De fem første tips rammer udfaldet (1 point), det sjette gør ikke (0 point).
insert into public.predictions (user_id, match_id, pred_home, pred_away)
select '00000000-0000-4000-8000-000000000001',
       ('99999999-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid,
       case when i < 5 then 2 else 0 end,
       case when i < 5 then 0 else 2 end
from generate_series(0, 5) i;

-- ---------------------------------------------------------------------------
-- Aflæsningen selv
-- ---------------------------------------------------------------------------
\ir ../story_engine_v3_measure.sql

-- ---------------------------------------------------------------------------
-- Påstande
-- ---------------------------------------------------------------------------
create or replace function pg_temp.v(p_ord int) returns text
language sql stable as $f$ select vaerdi from _maal where ord = p_ord $f$;
create or replace function pg_temp.d(p_ord int) returns text
language sql stable as $f$ select dom from _maal where ord = p_ord $f$;

do $$
declare
  v text;
begin
  -- 1) Udløseren: to uger, ti kampdage, vis-bar > 0, vist > 0
  if pg_temp.v(11) <> '20' then
    raise exception 'dage siden første kort: forventede 20, fik %', pg_temp.v(11);
  end if;
  if pg_temp.d(11) <> 'to uger: OPFYLDT' then
    raise exception 'to uger skulle være opfyldt, fik %', pg_temp.d(11);
  end if;
  if pg_temp.v(12) <> '12' or pg_temp.d(12) <> 'ti kampdage: OPFYLDT' then
    raise exception 'kampdage: forventede 12/OPFYLDT, fik %/%', pg_temp.v(12), pg_temp.d(12);
  end if;
  if pg_temp.v(13) <> '51' then
    raise exception 'bruger-dage: forventede 51 (4×12 + 1×3), fik %', pg_temp.v(13);
  end if;
  if pg_temp.v(17) <> '51' or pg_temp.d(17) not like 'A33 halvdel 1: OPFYLDT%' then
    raise exception 'vis-bare: forventede 51/OPFYLDT, fik %/%', pg_temp.v(17), pg_temp.d(17);
  end if;
  if pg_temp.v(18) <> '4' or pg_temp.d(18) not like 'A33 halvdel 2: OPFYLDT%' then
    raise exception 'sete kort: forventede 4/OPFYLDT, fik %/%', pg_temp.v(18), pg_temp.d(18);
  end if;
  if pg_temp.v(19) <> '1' then
    raise exception 'brugere med en visning: forventede 1, fik %', pg_temp.v(19);
  end if;

  -- 2) A35's andel. 25 af 51 kort har news_value >= 45 (54 og 58, ikke 44/36).
  if pg_temp.v(20) <> '49.0 %' then
    raise exception 'andel ulæst: forventede 49,0 %%, fik %', pg_temp.v(20);
  end if;
  -- Aktive brugere er 4 og ikke 5: bruger 5 har tre kampdage. Fjernes
  -- `having count(*) >= 5`, bliver tallet 5 og medianen en anden.
  if pg_temp.v(22) <> '4' then
    raise exception 'aktive brugere: forventede 4 (bruger 5 har kun 3 kampdage), fik %', pg_temp.v(22);
  end if;
  if pg_temp.v(23) <> '50.0 %' then
    raise exception 'median pr. aktiv bruger: forventede 50,0 %%, fik %', pg_temp.v(23);
  end if;
  if pg_temp.v(26) <> '4' then
    raise exception 'alle fire aktive brugere skal ligge i båndet 40–60 %%, fik % i det', pg_temp.v(26);
  end if;

  -- 3) Dommen skal komme af tallet
  if pg_temp.d(20) <> 'i målet 40–60 % ⇒ 45 holder' then
    raise exception 'dommen ved 49,0 %% skal være "i målet", fik %', pg_temp.d(20);
  end if;
  if pg_temp.d(23) <> 'i målet ⇒ 45 holder' then
    raise exception 'medianens dom ved 50,0 %% skal være "i målet", fik %', pg_temp.d(23);
  end if;

  -- 4) Modspillet: håndtaget er ujævnt. 45, 48, 51 og 53 giver DET SAMME, fordi
  --    ingen kandidat i fixturen lander mellem 45 og 53 — præcis som ingen
  --    personlig kandidat i motoren lander mellem 45 og 47.
  if pg_temp.v(31) <> '74.5 %' or pg_temp.v(33) <> '74.5 %' then
    raise exception 'tærskel 38 og 44 skal begge give 74,5 %%, fik %/%', pg_temp.v(31), pg_temp.v(33);
  end if;
  if pg_temp.v(34) <> '49.0 %' or pg_temp.v(35) <> '49.0 %'
     or pg_temp.v(36) <> '49.0 %' or pg_temp.v(37) <> '49.0 %' then
    raise exception 'tærskel 45–53 skal alle give 49,0 %%, fik %/%/%/%',
      pg_temp.v(34), pg_temp.v(35), pg_temp.v(36), pg_temp.v(37);
  end if;
  if pg_temp.v(38) <> '25.5 %' then
    raise exception 'tærskel 55 skal springe til 25,5 %%, fik %', pg_temp.v(38);
  end if;
  if pg_temp.v(202) not like 'fra 74.5 % (tærskel 38) til 25.5 % (tærskel 55)%' then
    raise exception 'håndtagets rækkevidde: fik %', pg_temp.v(202);
  end if;

  -- 4b) Fordelingen skåret ved reglernes gulve
  if pg_temp.v(42) <> '13 · 25.5 %' or pg_temp.v(43) <> '13 · 25.5 %'
     or pg_temp.v(46) <> '25 · 49.0 %' then
    raise exception 'fordelingen: forventede 13/13/25 i 28–40, 41–44 og 54–119, fik %/%/%',
      pg_temp.v(42), pg_temp.v(43), pg_temp.v(46);
  end if;

  -- 5) A33's tre mål. Rækkefølgen af regel-rækkerne er efter antal, så
  --    COLLECTIVE_MISS (13) står før DAY_TOP (12).
  select vaerdi into v from _maal where maal = 'VALGT regel: DAY_TOP';
  if v not like '12 · 23.5 %%' then
    raise exception 'DAY_TOP skulle være 12 kort (23,5 %%), fik %', v;
  end if;
  select vaerdi into v from _maal where maal = 'VALGT regel: DAY_RESULT';
  if v not like '13 · 25.5 %%' then
    raise exception 'DAY_RESULT skulle være 13 kort (25,5 %%), fik %', v;
  end if;
  -- Gentagelsen er 12 af 46 overgange og ikke 13: bruger 2's serie begynder og
  -- slutter et andet sted i rotationen end de tre andres. Tallet er regnet af
  -- fixturen og ikke rundet af — det er dét, der gør påstanden skarp.
  if pg_temp.v(81) <> '26.1 %' then
    raise exception 'gentagelse: forventede 26,1 %% (12 af 46 overgange), fik %', pg_temp.v(81);
  end if;
  if pg_temp.v(82) <> '50.0 %' then
    raise exception 'ensformighed: forventede 50,0 %% (6 af 12 kort er DAY_RESULT), fik %', pg_temp.v(82);
  end if;

  -- 6) Vist regel ≠ valgt regel
  if pg_temp.v(80) <> '13' then
    raise exception 'dæmpede kort: forventede 13 COLLECTIVE_MISS holdt tilbage af tærsklen, fik %', pg_temp.v(80);
  end if;

  -- 7) Regler uden en eneste udløsning navngives
  if pg_temp.v(79) <> 'DUEL, MILESTONE, SO_CLOSE, STREAK_STATUS' then
    raise exception 'de fire uudløste regler skal navngives, fik %', pg_temp.v(79);
  end if;
  if pg_temp.d(79) <> '4 af 8 regler har udløst' then
    raise exception 'regeltællingen: fik %', pg_temp.d(79);
  end if;

  -- 10) G143: stimen fandtes, var kandidat, og TABTE. Uden denne påstand kan
  --     blokken kun bevise, at den kan tælle til nul.
  if pg_temp.v(100) <> '1' or pg_temp.v(102) <> '5 kampe' then
    raise exception 'stime: forventede 1 femer-stime på 5 kampe, fik %/%',
      pg_temp.v(100), pg_temp.v(102);
  end if;
  if pg_temp.v(103) <> '1' or pg_temp.v(104) <> '0' or pg_temp.v(105) <> '1' then
    raise exception 'stime: forventede kandidat=1, vandt=0, tabte=1, fik %/%/%',
      pg_temp.v(103), pg_temp.v(104), pg_temp.v(105);
  end if;
  -- 48 = 28 + 0 (stime-bonus for len 5) + 20. Kortet, hun fik, var DAY_TOP på 54.
  if pg_temp.v(106) <> '6 point' then
    raise exception 'stime: afstanden op til vinderen skulle være 54 − 48 = 6, fik %', pg_temp.v(106);
  end if;
  -- 💤-grenens blinde vinkel: stimen brød dagen EFTER, så intet kort blev skrevet.
  if pg_temp.v(107) <> '1' or pg_temp.v(108) <> '0' then
    raise exception 'stime: forventede brud en SENERE dag (1) og ingen samme dag (0), fik %/%',
      pg_temp.v(107), pg_temp.v(108);
  end if;
  if pg_temp.v(203) <> 'DOMINERET — den var kandidat og tabte' then
    raise exception 'G143-dommen: fik %', pg_temp.v(203);
  end if;

  -- Dommene til sidst
  if pg_temp.v(200) not like 'JA — 4 visninger%' or pg_temp.v(201) <> 'JA' then
    raise exception 'begge rækker skal kunne besvares, fik %/%', pg_temp.v(200), pg_temp.v(201);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Påstand 8 · vis-bar efter v3's regel — og filen kørt anden gang
-- ---------------------------------------------------------------------------
-- Bagstopperens dagsløkke skriver flere dages kort i SAMME sætning, så de deler
-- `created_at`. `loadDayCard` henter altid den nyeste `day_key`, så det ældste
-- af to samtidigt skrevne kort kunne aldrig nå en skærm. Uden den regel — fx
-- med et `n.created_at > k.created_at` i joinet — ville det tælle som vis-bart.
insert into public.stories
  (round_key, user_id, rule, priority, league_size, news_value,
   payload, headline, body, period, day_key, created_at)
values
  (to_char(current_date - 21, 'YYYY-MM-DD'), '00000000-0000-4000-8000-000000000005',
   'DAY_RESULT', 180, 8, 36,
   '{"winner_rule":"DAY_RESULT","runner_up_value":0}', 'o', 'b', 'day',
   current_date - 3, current_date::timestamptz - interval '1 day' + interval '9 hours'),
  (to_char(current_date - 21, 'YYYY-MM-DD'), '00000000-0000-4000-8000-000000000005',
   'DAY_TOP', 130, 8, 54,
   '{"winner_rule":"DAY_TOP","runner_up_value":0}', 'o', 'b', 'day',
   current_date - 2, current_date::timestamptz - interval '1 day' + interval '9 hours'),
  (to_char(current_date - 21, 'YYYY-MM-DD'), '00000000-0000-4000-8000-000000000005',
   'CONTRARIAN', 120, 8, 58,
   '{"winner_rule":"CONTRARIAN","runner_up_value":0}', 'o', 'b', 'day',
   current_date - 1, current_date::timestamptz - interval '1 day' + interval '9 hours' + interval '10 minutes');

\ir ../story_engine_v3_measure.sql

do $$
begin
  if pg_temp.v(13) <> '54' then
    raise exception 'anden kørsel: forventede 54 bruger-dage, fik %', pg_temp.v(13);
  end if;
  -- 53 og ikke 54: det ældste af de to samtidigt skrevne kort har et vindue på
  -- nul minutter.
  if pg_temp.v(17) <> '53' then
    raise exception 'vis-bare: forventede 53 af 54 — det instant afløste kort må ikke tælle, fik %',
      pg_temp.v(17);
  end if;
  if pg_temp.v(12) <> '15' then
    raise exception 'anden kørsel: forventede 15 kampdage, fik %', pg_temp.v(12);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Påstand 9 · to nævnere, to modsatte domme
-- ---------------------------------------------------------------------------
-- DEN VIGTIGSTE PÅSTAND I FILEN, og den kom af den første rigtige kørsel
-- (21. august 2026). Aflæsningen gav 50,0 % på række 20 — midt i målet 40–60 %
-- — og 76,9 % på række 21, altså over rækkens eget "over 70 % ⇒ tærsklen er for
-- lav". Samme datasæt, to nævnere, to modsatte domme, og hele forskellen er de
-- bruger-dage, hvor brugeren ikke havde ét scoret tip.
--
-- Uden denne påstand er de to linjer kun testet på en fixture UDEN
-- tips-påmindelser, hvor de pr. konstruktion er ens — altså netop ikke testet.
--
-- Ti brugere, ti kampdage hver: seks kort over tærsklen og fire
-- tips-påmindelser. Dagene ligger uden for de andres, så ingen af påstandene
-- ovenfor kan blive ramt af dem.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000000' || lpad(u::text, 2, '0'))::uuid,
       'u' || u || '@test.local'
from generate_series(6, 15) u;
insert into public.profiles (id, display_name)
select ('00000000-0000-4000-8000-0000000000' || lpad(u::text, 2, '0'))::uuid, 'Bruger ' || u
from generate_series(6, 15) u;

insert into public.stories
  (round_key, user_id, rule, priority, league_size, news_value,
   payload, headline, body, period, day_key, created_at)
select
  to_char(current_date - 41, 'YYYY-MM-DD'),
  ('00000000-0000-4000-8000-0000000000' || lpad(u::text, 2, '0'))::uuid,
  case when d < 6 then 'CONTRARIAN' else 'DAY_RESULT' end,
  case when d < 6 then 120 else 180 end,
  8,
  case when d < 6 then 58 else 0 end,
  case when d < 6
       then jsonb_build_object('winner_rule', 'CONTRARIAN', 'runner_up_value', 0, 'third', false)
       else jsonb_build_object('winner_rule', 'DAY_RESULT', 'runner_up_value', 0, 'third', false,
                               'variant', 'no_tips') end,
  'overskrift', 'brødtekst', 'day', (current_date - 40 + d),
  (current_date - 40 + d)::timestamptz + interval '22 hours'
from generate_series(6, 15) u
cross join generate_series(0, 9) d;

\ir ../story_engine_v3_measure.sql

do $$
begin
  -- 154 = 54 fra ovenstående + 100 nye. 40 af dem er tips-påmindelser.
  if pg_temp.v(13) <> '154' or pg_temp.v(14) <> '40' then
    raise exception 'tredje kørsel: forventede 154 bruger-dage / 40 tips-påmindelser, fik %/%',
      pg_temp.v(13), pg_temp.v(14);
  end if;
  -- 87 af 154 = 56,5 % — i målet.
  if pg_temp.v(20) <> '56.5 %' or pg_temp.d(20) <> 'i målet 40–60 % ⇒ 45 holder' then
    raise exception 'række 20 skulle være 56,5 %% og "i målet", fik %/%', pg_temp.v(20), pg_temp.d(20);
  end if;
  -- 87 af 114 = 76,3 % — den MODSATTE dom, på samme datasæt.
  if pg_temp.v(21) <> '76.3 %' then
    raise exception 'række 21 skulle være 76,3 %%, fik %', pg_temp.v(21);
  end if;
  if pg_temp.d(21) <> 'OVER 70 % ⇒ tærsklen er for lav, når brugeren FAKTISK tipper' then
    raise exception 'række 21 skulle dømme "for lav" dér, hvor række 20 siger "i målet" — fik %',
      pg_temp.d(21);
  end if;
  -- Og fordelingens nul-bånd skal kende de fyrre igen.
  if pg_temp.v(40) not like '40 · %' then
    raise exception 'fordelingens 0-bånd skulle rumme de 40 tips-påmindelser, fik %', pg_temp.v(40);
  end if;
end $$;

select 'story_engine_v3_measure: alle påstande holder' as resultat;
