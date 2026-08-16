-- Test af `sql/checks/day_card_coverage.sql` (G93).
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR DEN FINDES
-- `day_card_coverage.sql` var den eneste af de fire kontroller i `sql/checks/`
-- uden en test og uden et CI-trin — `kickoff_coverage`, `league_admin_coverage`
-- og `rating_freshness` har alle tre. Det er den værste kombination af
-- egenskaber, en fil kan have: en kontrol udløser per definition næsten aldrig,
-- så den ser lige rigtig ud, hvad enten den virker eller ej, og en kontrol UDEN
-- et bevis for sig selv kan stå grøn, mens reglen bag den fejler. Det er ikke
-- en formodning her — det er præcis, hvad der skete under `G92`: kontrollen
-- meldte roligt "spilles endnu" om dage, der både var uafsluttede og allerede
-- havde fået deres kort, og fejlen blev fundet af en bruger.
--
-- HVORFOR DET RIGTIGE SKEMA OG IKKE ET MINISKEMA
-- Tre ting i kontrollen findes kun i produktionsskemaet, og alle tre bærer en
-- påstand:
--   · `matches.match_day` og `matches.round_key` er GENEREREDE kolonner oven på
--     `match_day()`/`round_key()`, altså tidszonelogikken selv. Kontrollen
--     grupperer på den ene og sammenligner den anden med `round_key_of_date()`.
--     Et miniskema ville have gjort begge til almindelige kolonner, jeg selv
--     satte — og så ville testen bevise, at jeg kan skrive to ens datoer.
--   · `round_key_of_date()` er en rigtig funktion i skemaet. Den og
--     `round_key()` skal give SAMME runde for samme dag; gør de ikke det, er
--     "rundens sidste dag" forkert, og det ville et miniskema ikke kunne se.
--   · `stories_day_key_shape` — `(period = 'day') = (day_key is not null)` —
--     gør `s.period = 'day'`-filteret i kontrollen uangribeligt: en
--     runde-historie KAN ikke bære en `day_key`, så den kan ikke forveksles med
--     et dagskort. Filteret er dermed korrekt og redundant på én gang, og det
--     er en oplysning, der kun findes i det rigtige skema. Se noten ved påstand
--     9 — den er den ene mutation, testen bevidst ikke kan fange, fordi
--     databasen fanger den først.
-- `G91` flyttede samme dag de sidste to tests herover af samme grund; hvad et
-- miniskema kostede dem, står i `docs/DECISIONS.md`.
--
-- HVORFOR TRIGGERNE SLÅS FRA
-- Samme greb som `rating_freshness.sql`, men af en anden grund: `matches`-
-- triggeren KALDER dagsmotoren, så en indsat kamp med resultat ville skrive
-- sine egne kort. Testen skal bestemme præcis hvilke dage der har et kort og
-- hvilke der ikke har — det er hele det, kontrollen aflæser.
--
-- HVAD DEN BEVISER
--   1. En færdigspillet dag i en konkurrence, som ikke er rundens sidste, og
--      som HAR sit kort, er `ok`.
--   2. **Regressionen (`G92`):** samme dag uden kort melder `MANGLER DAGSKORT`.
--   3. En dag, der stadig spilles, melder `spilles endnu` og ikke en alarm.
--   4. **Den værre fejl vinder:** en dag, der stadig spilles og alligevel har
--      fået sit kort, melder `KORT PÅ EN DAG, DER SPILLES`. Det er tilstanden
--      fra august 2026, hvor bagstopperen udgav "Dagens facit" midt på
--      kampdagen — et FORKERT svar, brugeren allerede har læst, modsat det
--      udeblevne svar i påstand 2.
--   5. **Æra-skellet:** et kort fra før v3 (`news_value is null`) på en dag, der
--      spilles, udløser IKKE alarmen. Uden `news_value is not null` ville
--      historiske rækker holde kontrollen rød for evigt, og en alarm, der ikke
--      kan blive grøn, bliver slukket.
--   6. Rundens sidste kampdag har intet kort og skal ikke have et:
--      `rundens sidste dag`. Ordret samme udtryk som den tidlige udgang i
--      `generate_daily_stories()`.
--   7. En dag, hvis kampe ikke indgår i nogen konkurrence, melder
--      `uden for konkurrencerne`. Appen synkroniserer syv turneringer;
--      konkurrencerne dækker ikke dem alle.
--   8. Vinduet virker: en dag ældre end tredive dage dømmes slet ikke.
--      Historiske huller må ikke holde alarmen rød.
--   9. Tallene er tal og ikke flag: `kampe_i_konkurrence` tæller de af dagens
--      kampe, der er med i en konkurrence — og DELVIS dækning er `ok`, ikke
--      `uden for konkurrencerne`.
--  10. Rundeafgrænsningen: en senere kampdag i en ANDEN runde gør ikke påstand
--      6's dag til en ikke-sidste dag.
--  11. **A39:** et FROSSET kort på en dag, der stadig spilles, er ikke en fejl.
--      Påstår kortet kun de kampe, det blev regnet på, er det korrekt — og
--      alarmen skal tie. Det er modstykket til påstand 4, hvor kortet påstår at
--      dække en kamp, der ikke er spillet.
--  12. **A39:** dagen I DAG dømmes ikke for et manglende kort. Motoren skriver
--      kortet i samme sætning som resultatet, men kontrollen kan ramme
--      mellemrummet, og efter A39 åbner det N gange om dagen frem for én.
--
-- Testen er efterprøvet ved at mutere kontrollen — hver `case`-gren slået fra på
-- skift, æra-filteret, rundefilteret, `match_day > d.dag`, vinduet, og efter
-- A39 desuden frysningens grænse (`>= f.n_matches` svækket til `> 0`),
-- `i dag`-grenen, stigens rækkefølge og `klar`-definitionen. **Alle blev fanget
-- i første kørsel**, hvilket ikke er held: flere af påstandene findes KUN for at
-- gøre en mutation synlig og bærer ingen egen produktværdi. Påstand 10 (en
-- senere runde) er det eneste, der kan skelne rundefilteret fra ingenting, og
-- påstand 11 det eneste, der kan skelne et frosset kort fra et for tidligt.
-- Fjernes én af dem, kan kontrollen muteres, uden at testen siger fra.
--
-- ⚠️ `uden_resultat` FANDTES INDTIL A39 og er væk med den. Fixturens opdeling i
-- "kun `away_score` mangler" (torsdag) og "kun `home_score` mangler" (fredag)
-- står stadig, fordi `user_day_scope()` nu bærer det samme tveled i sit eget
-- `is_open` — og det skal stadig kunne skelnes.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d dctest -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d dctest -v ON_ERROR_STOP=1 -b -f sql/tests/day_card_coverage.sql

\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

-- Dagsmotoren må ikke skrive sine egne kort undervejs; se hovedet.
alter table public.matches disable trigger all;

insert into auth.users (id, email, created_at)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local', now());
insert into public.profiles (id, display_name)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Anna');

insert into public.leagues (id, name) values
  ('11111111-0000-4000-8000-000000000001', 'Testligaen');
insert into public.seasons (id, league_id, name) values
  ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', '25/26');
insert into public.teams (id, league_id, name) values
  ('33333333-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'Hjemme'),
  ('33333333-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000001', 'Ude');
insert into public.competitions (id, name, mode, created_by, league_id, season_id) values
  ('55555555-0000-4000-8000-000000000001', 'Testkonkurrencen', 'time_range',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '11111111-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001');

-- 🔴 DELTAGEREN ER IKKE PYNT (A39, august 2026). Kontrollen tæller siden den
-- personlige kampdag BRUGERE og ikke dage: `klar` kommer fra
-- `public.user_day_scope()`, som går fra kamp til konkurrence til DELTAGER.
-- Uden denne række har ingen dag en klar bruger, hver eneste dag melder
-- `spilles endnu`, og hele filen påstår ingenting. Fixturen bestod indtil da
-- uden en eneste deltager, fordi den gamle kontrol kun spurgte til kampene.
insert into public.competition_participants (competition_id, user_id, joined_at) values
  ('55555555-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   current_date - 60);

-- DATOERNE ER RELATIVE OG FORANKRET I EN RUNDE, ikke i `current_date` alene.
-- Kontrollens vindue er `current_date - 30`, så absolutte datoer (som
-- `rating_freshness.sql` bruger) ville falde ud af det. Men runden går
-- tirsdag–mandag, så "for 21 dage siden" er en tilfældig ugedag, og påstandene
-- om rundens sidste dag ville afhænge af, hvilken dag CI kørte.
--
-- `pg_temp.dag(n)` løser begge dele: den forankrer i runden FØR `current_date -
-- 21` og lægger n dage til, så dag 0–6 altid er tirsdag–mandag i én og samme
-- runde. Yderpunkterne ligger mellem `current_date - 27` og `current_date - 15`
-- og dermed altid inde i vinduet.
create function pg_temp.dag(p_offset int) returns date language sql stable as
$$ select public.round_key_of_date(current_date - 21) + p_offset $$;

-- Én kamp på en dag. Klokkeslættet er 19.00 dansk tid, så den genererede
-- `match_day` bliver netop `p_dag` — også når CI kører i UTC.
create function pg_temp.kamp(
  p_dag date,
  p_home int,
  p_away int,
  p_i_konkurrence boolean default true
) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.matches
    (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score, status)
  values ('22222222-0000-4000-8000-000000000001',
          '33333333-0000-4000-8000-000000000001',
          '33333333-0000-4000-8000-000000000002',
          (p_dag + time '19:00') at time zone 'Europe/Copenhagen',
          p_home, p_away,
          case when p_home is null or p_away is null then 'NS' else 'FT' end)
  returning id into v_id;

  if p_i_konkurrence then
    insert into public.competition_matches (competition_id, match_id)
    values ('55555555-0000-4000-8000-000000000001', v_id);
  end if;
  return v_id;
end $$;

-- Et dagskort. `p_news = null` er et kort fra FØR v3 — æra-skellet i påstand 5.
--
-- `p_scope` er A39's frysningstal (`payload.day_scope_matches`): hvor mange af
-- dagens kampe kortet blev regnet på. Det er dét, der efter A39 afgør, om et
-- kort på en uafsluttet dag er en FEJL eller et frosset kort, der er
-- fuldstændig korrekt — se påstand 4 og 4b. `null` er et kort uden tallet,
-- altså et fra før migreringen.
create function pg_temp.kort(p_dag date, p_news int, p_scope int default null)
returns void language sql as $$
  insert into public.stories
    (round_key, user_id, rule, priority, headline, body, period, day_key, news_value, payload)
  values (public.round_key_of_date(p_dag)::text,
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'DAY_RESULT', 180, 'Dagens facit', 'Anna tog dagen.', 'day', p_dag, p_news,
          case when p_scope is null then '{}'::jsonb
               else jsonb_build_object('day_scope_matches', p_scope) end);
$$;

-- 1) + 9) Tirsdag: tre kampe, to af dem i konkurrencen, alle spillet, kort skrevet.
--    Den delvise dækning er med vilje: `kampe_i_konkurrence` skal være et TAL,
--    og 2 af 3 må ikke læses som "uden for konkurrencerne".
select pg_temp.kamp(pg_temp.dag(0), 2, 1);
select pg_temp.kamp(pg_temp.dag(0), 0, 0);
select pg_temp.kamp(pg_temp.dag(0), 3, 3, false);
select pg_temp.kort(pg_temp.dag(0), 62);

-- 2) Onsdag: samme situation UDEN kort. Det er G92 ordret.
select pg_temp.kamp(pg_temp.dag(1), 1, 0);

-- 3) Torsdag: dagen spilles endnu, og det er kun `away_score`, der mangler.
--    Halvdelen er valgt med vilje — kontrollen skal spørge til BEGGE mål, og en
--    fixture, hvor altid begge er null, kan ikke skelne de to led.
select pg_temp.kamp(pg_temp.dag(2), 1, 1);
select pg_temp.kamp(pg_temp.dag(2), 2, null);

-- 4) Fredag: dagen spilles endnu, OG kortet er allerede udgivet. Her mangler
--    `home_score`, altså den anden halvdel af samme betingelse.
--    Kortet påstår at dække BEGGE dagens kampe (`day_scope_matches = 2`), mens
--    den ene stadig spilles. Det er efter A39 selve definitionen på den værre
--    fejl — og modstykket til påstand 4b nedenfor, hvor kortet kun påstår den
--    ene og derfor er et frosset, korrekt kort.
select pg_temp.kamp(pg_temp.dag(3), 1, 1);
select pg_temp.kamp(pg_temp.dag(3), null, 2);
select pg_temp.kort(pg_temp.dag(3), 51, 2);

-- 5) Lørdag: samme som fredag, men kortet er fra før v3 (`news_value` null).
select pg_temp.kamp(pg_temp.dag(4), 0, 1);
select pg_temp.kamp(pg_temp.dag(4), null, null);
select pg_temp.kort(pg_temp.dag(4), null);

-- 7) Søndag: to spillede kampe, ingen af dem i en konkurrence.
select pg_temp.kamp(pg_temp.dag(5), 4, 0, false);
select pg_temp.kamp(pg_temp.dag(5), 1, 2, false);

-- 6) Mandag: rundens SIDSTE kampdag. Spillet, i konkurrencen, uden kort — og
--    det er det rigtige svar, fordi den dag udgiver rundekortet i stedet.
select pg_temp.kamp(pg_temp.dag(6), 2, 2);

-- 10) En kampdag i en SENERE runde. Den findes kun for at gøre påstand 6 til en
--     rigtig prøve: uden den ville rundefilteret i `not exists (… round_key = …)`
--     kunne fjernes, uden at nogen påstand flyttede sig.
--
--     4b) DEN SAMME DAG BÆRER A39'S NYE TILSTAND: et FROSSET kort. Anna har to
--     kampe i konkurrencen, den ene spilles endnu, og kortet påstår kun den ene
--     (`day_scope_matches = 1`). Det er præcis det, frysningen producerer, når
--     nogen opretter en konkurrence om aftenen — og det er KORREKT. Uden denne
--     påstand kunne `>= f.n_matches` i kontrollen ændres til `> 0`, og hver
--     eneste frosne dag ville melde den værste alarm, uden at testen sagde fra.
--     Onsdagen i samme runde gør tirsdagen til en ikke-sidste kampdag.
select pg_temp.kamp(public.round_key_of_date(current_date - 7), 1, 1);
select pg_temp.kamp(public.round_key_of_date(current_date - 7), null, null);
select pg_temp.kort(public.round_key_of_date(current_date - 7), 44, 1);
select pg_temp.kamp(public.round_key_of_date(current_date - 7) + 1, 2, 0);

-- 11) I DAG: en færdigspillet kamp i konkurrencen, uden kort. Motoren skriver
--     kortet i samme sætning som resultatet, men kontrollen kan ramme
--     mellemrummet — og efter A39 åbner det mellemrum N gange om dagen frem for
--     én. Dagen må derfor ikke dømmes for et MANGLENDE kort, før den er forbi.
--     Morgendagens kamp holder dagen ude af "rundens sidste dag".
select pg_temp.kamp(current_date, 1, 0);
select pg_temp.kamp(current_date + 1, null, null);

-- 8) En dag LANGT uden for vinduet, som mangler sit kort. Historiske huller —
--    fx dem fra før v3 — må ikke kunne ses i kontrollen overhovedet.
select pg_temp.kamp(current_date - 45, 3, 1);

\ir ../checks/day_card_coverage.sql

-- ---------------------------------------------------------------------------
-- Påstandene
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  -- 1) + 9) den sunde dag, og tallene bag den
  select * into r from day_card_coverage where dag = pg_temp.dag(0);
  if r.tilstand <> 'ok' then
    raise exception 'tirsdag: en færdigspillet dag med sit kort skal være ok — fik %', r.tilstand;
  end if;
  if r.kampe <> 3 or r.kampe_i_konkurrence <> 2 or r.kort <> 1 then
    raise exception 'tirsdag: forventede 3 kampe / 2 i konkurrence / 1 kort, fik %/%/%',
      r.kampe, r.kampe_i_konkurrence, r.kort;
  end if;

  -- 2) regressionen
  select * into r from day_card_coverage where dag = pg_temp.dag(1);
  if r.tilstand <> 'MANGLER DAGSKORT' then
    raise exception 'onsdag: en færdigspillet dag i en konkurrence uden kort er G92 — fik %', r.tilstand;
  end if;

  -- 3) dagen spilles endnu, og kun det ene mål mangler
  select * into r from day_card_coverage where dag = pg_temp.dag(2);
  if r.tilstand <> 'spilles endnu' then
    raise exception 'torsdag: en kamp uden away_score gør dagen uafsluttet — fik %', r.tilstand;
  end if;

  -- 4) den værre fejl vinder
  select * into r from day_card_coverage where dag = pg_temp.dag(3);
  if r.tilstand <> 'KORT PÅ EN DAG, DER SPILLES' then
    raise exception 'fredag: et kort på en dag, der stadig spilles, er et FORKERT svar og skal stå før "spilles endnu" — fik %',
      r.tilstand;
  end if;
  if r.kort <> 1 then
    raise exception 'fredag: kortet skal også tælles, fik % kort', r.kort;
  end if;

  -- 5) æra-skellet
  select * into r from day_card_coverage where dag = pg_temp.dag(4);
  if r.tilstand <> 'spilles endnu' then
    raise exception 'lørdag: et kort fra før v3 (news_value null) må ikke udløse alarmen — fik %', r.tilstand;
  end if;
  if r.kort <> 1 then
    raise exception 'lørdag: kortet findes og skal tælles, også når det ikke dømmes — fik % kort', r.kort;
  end if;

  -- 7) uden for konkurrencerne
  select * into r from day_card_coverage where dag = pg_temp.dag(5);
  if r.tilstand <> 'uden for konkurrencerne' then
    raise exception 'søndag: en dag, hvis kampe ingen konkurrence har, har intet kort at savne — fik %', r.tilstand;
  end if;
  if r.kampe_i_konkurrence <> 0 then
    raise exception 'søndag: forventede 0 kampe i konkurrence, fik %', r.kampe_i_konkurrence;
  end if;

  -- 6) + 10) rundens sidste dag, også når en senere runde har kampe
  select * into r from day_card_coverage where dag = pg_temp.dag(6);
  if r.tilstand <> 'rundens sidste dag' then
    raise exception 'mandag: rundens sidste kampdag udgiver rundekortet og skal ikke savne et dagskort — fik %',
      r.tilstand;
  end if;
  if not exists (select 1 from day_card_coverage
                  where dag = public.round_key_of_date(current_date - 7)) then
    raise exception 'fixturen holder ikke: den senere runde skal selv være med i vinduet, ellers prøver påstand 10 ingenting';
  end if;

  -- 4b) A39: et FROSSET kort på en dag, der stadig spilles, er ikke en fejl.
  select * into r from day_card_coverage where dag = public.round_key_of_date(current_date - 7);
  if r.tilstand = 'KORT PÅ EN DAG, DER SPILLES' then
    raise exception 'senere runde: et kort, der kun påstår de kampe, det blev regnet på, er FROSSET og korrekt — alarmen må ikke lyse';
  end if;
  if r.tilstand <> 'spilles endnu' then
    raise exception 'senere runde: forventede "spilles endnu" for den frosne dag — fik %', r.tilstand;
  end if;
  if r.for_tidligt <> 0 then
    raise exception 'senere runde: forventede 0 for tidlige kort, fik %', r.for_tidligt;
  end if;

  -- 11) A39: dagen i dag dømmes ikke for et manglende kort.
  select * into r from day_card_coverage where dag = current_date;
  if r.tilstand <> 'i dag' then
    raise exception 'i dag: en dag, der ikke er forbi, må ikke meldes som MANGLER DAGSKORT — fik %', r.tilstand;
  end if;
  if r.klar <> 1 then
    raise exception 'i dag: forventede 1 klar bruger, fik % — ellers prøver påstanden ingenting', r.klar;
  end if;

  -- 8) vinduet
  if exists (select 1 from day_card_coverage where dag = current_date - 45) then
    raise exception 'en dag ældre end tredive dage skal slet ikke dømmes — historiske huller må ikke holde alarmen rød';
  end if;
end $$;

-- Kontrollen skal kunne læses to gange i samme session uden at fejle: sådan ser
-- en gentagen kørsel ud, hvis nogen kalder heartbeat-trinnet manuelt bagefter.
\ir ../checks/day_card_coverage.sql

select 'day_card_coverage: OK' as result;
