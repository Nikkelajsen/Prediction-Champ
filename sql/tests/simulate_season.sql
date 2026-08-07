-- Test af `sql/dev/simulate_season.sql` (G82).
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR DEN IKKE BYGGER SIT EGET MINISKEMA som de øvrige tests i denne mappe.
-- Simulatoren er 1.069 linjer, der rører hele kæden på én gang: ligaer,
-- sæsoner, hold, kampe, tips, `matches`-triggeren, rating, historier,
-- kåringer, milepæle og `competition_status`. Et håndskrevet minischema ville
-- kunne stå grønt, mens filen fejler mod det rigtige — og netop dén klasse
-- fejl er det eneste, testen findes for. `sql/schema.sql` ER produktions-
-- skemaet, og det ligger i repoet; samme indsigt som `G74`s og `A37`s.
--
-- HVAD DEN BEVISER
--   1. Filen kan køres i en frisk database: skemaet `sim` og dets funktioner
--      oprettes, uden at noget data ændres.
--   2. **Låsen holder.** `sim.setup()` uden `sim.arm()` fejler, og `sim.arm()`
--      med den forkerte sætning gør det samme. Den er filens eneste værn mod
--      at blive kørt i produktion, og et værn, ingen har set udløse, er en
--      formodning (G84's lære).
--   3. Kampprogrammet er en rigtig dobbeltturnering: 12 hold → 22 runder →
--      132 kampe, hvert par mødes præcis to gange, én gang med hver hjemmebane.
--   4. Sæsonen krydser ikke 1. juli. Det er ikke kosmetik: `award_milestones()`
--      tæller fodboldsæsoner, og en sæson i to sæsonår uddeler "To sæsoner med"
--      efter én. Præcis den fejl blev fundet i hånden 7. august 2026, og dette
--      er den påstand, der ville have fanget den.
--   5. `sim.season()` producerer AFLEDTE rækker og ikke bare tips: rating,
--      rundehistorier og dagshistorier. Hele kæden ligger bag `matches`-
--      triggerens exception-guard og fejler derfor TAVST — et ikke-nul
--      rækkeantal er den eneste måde at skelne "motoren virker" fra "der skete
--      ikke noget denne uge".
--   6. En færdigspillet sæson afsluttes: `competition_status.concluded` bliver
--      sand, og de lokale kåringer (`mode_params.awards`) er uddelt.
--   7. **Samme frø giver samme sæson.** Filens hoved lover det, og det er den
--      egenskab, en fejlsøgning hviler på — kan sæsonen ikke gentages, kan et
--      fund ikke genfindes.
--   8. `sim.teardown()` er sporløs: liga, sæson, hold, kampe, tips, deltagere,
--      kåringer og historier er væk, og ratingen er regnet om.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d simtest -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d simtest -v ON_ERROR_STOP=1 -b -f sql/tests/simulate_season.sql

\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------------------
-- 0. Brugerne
-- ---------------------------------------------------------------------------
-- Simulationen opretter dem IKKE (den siger det selv i sit hoved): brugere skal
-- komme gennem appen, så `profiles`-rækken bliver skrevet. Her skrives begge
-- rækker i hånden, fordi det er dét, appen ville have gjort.
--
-- Tre brugere og ikke to: personaerne er skarp/gennemsnitlig/kaotisk, og
-- `participation < 1` for de to sidste er selve grunden til, at simulationen
-- producerer de manglende tips, appen skal kunne vise.

insert into auth.users (id, email, created_at) values
  ('11111111-1111-4111-8111-111111111111', 'skarp@test.local',          now() - interval '3 days'),
  ('22222222-2222-4222-8222-222222222222', 'gennemsnitlig@test.local',  now() - interval '2 days'),
  ('33333333-3333-4333-8333-333333333333', 'kaotisk@test.local',        now() - interval '1 day');

insert into public.profiles (id, display_name, created_at) values
  ('11111111-1111-4111-8111-111111111111', 'Skarpe Sanne',   now() - interval '3 days'),
  ('22222222-2222-4222-8222-222222222222', 'Gennemsnit-Gert', now() - interval '2 days'),
  ('33333333-3333-4333-8333-333333333333', 'Kaotiske Karl',  now() - interval '1 day');

-- ---------------------------------------------------------------------------
-- 1. Selve filen
-- ---------------------------------------------------------------------------
-- `\ir` er relativ til DENNE fil, så testen kan køres fra hvilken som helst
-- mappe. Påstand 1: den kører igennem uden at fejle.

\ir ../dev/simulate_season.sql

do $$
begin
  if to_regnamespace('sim') is null then
    raise exception 'skemaet sim blev ikke oprettet';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'sim') < 15 then
    raise exception 'sim-funktionerne blev ikke oprettet (fandt %)',
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'sim');
  end if;
  -- Filen må ikke skrive data af sig selv.
  if (select count(*) from public.leagues) <> 0 then
    raise exception 'filen oprettede data ved indlæsning — den må kun oprette skemaet';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Låsen (påstand 2)
-- ---------------------------------------------------------------------------
-- Værnet mod at køre filen i produktion. Begge retninger prøves: uden `arm()`
-- og med den forkerte sætning.

do $$
declare v_fejl text;
begin
  begin
    perform sim.setup(4, 1);
    raise exception 'sim.setup() kørte UDEN sim.arm() — låsen virker ikke';
  exception when others then
    v_fejl := sqlerrm;
    if v_fejl not like '%låst%' then raise; end if;
  end;

  begin
    perform sim.arm('ja tak');
    raise exception 'sim.arm() godtog en forkert sætning — låsen virker ikke';
  exception when others then
    v_fejl := sqlerrm;
    if v_fejl not like '%låst%' then raise; end if;
  end;

  -- Og brugerloftet: 3 brugere skal ikke slippe igennem et loft på 2.
  begin
    perform sim.arm('JA - DETTE ER STAGING', 2);
    raise exception 'sim.arm() så bort fra brugerloftet';
  exception when others then
    v_fejl := sqlerrm;
    if v_fejl not like '%brugere%' then raise; end if;
  end;
end $$;

select sim.arm('JA - DETTE ER STAGING') as laasen_er_aabnet;

-- ---------------------------------------------------------------------------
-- 3. sim.setup() — kampprogrammet (påstand 3 og 4)
-- ---------------------------------------------------------------------------

select sim.setup(12, 10) as opsaetning;

do $$
declare
  v_season uuid := sim.season_id();
  v_n int;
  v_par int;
begin
  select count(*) into v_n from public.matches where season_id = v_season;
  if v_n <> 132 then raise exception '12 hold skal give 132 kampe, fik %', v_n; end if;

  select count(distinct round_key) into v_n from public.matches where season_id = v_season;
  if v_n <> 22 then raise exception '12 hold skal give 22 runder, fik %', v_n; end if;

  -- Præcis én kamp pr. hold pr. runde. Cirkelmetoden er let at skrive forkert,
  -- og fejlen ville vise sig som en runde, hvor et hold spiller to gange.
  select count(*) into v_n from (
    select round_key, home_team_id as t from public.matches where season_id = v_season
    union all
    select round_key, away_team_id from public.matches where season_id = v_season
  ) x group by round_key, t having count(*) > 1;
  if v_n <> 0 then raise exception '% hold spiller mere end én kamp i samme runde', v_n; end if;

  -- Hvert par mødes to gange, én gang med hver hjemmebane.
  select count(*) into v_par from (
    select least(home_team_id::text, away_team_id::text) a,
           greatest(home_team_id::text, away_team_id::text) b,
           count(*) n, count(distinct home_team_id) hj
    from public.matches where season_id = v_season group by 1, 2
  ) x where n <> 2 or hj <> 2;
  if v_par <> 0 then raise exception '% par mødes ikke præcis to gange med hver sin hjemmebane', v_par; end if;

  -- Ingen kamp kan rammes af en synkronisering.
  select count(*) into v_n from public.matches
   where season_id = v_season and api_fixture_id not like 'sim:%';
  if v_n <> 0 then raise exception '% kampe har et api_fixture_id, en leverandør kunne ramme', v_n; end if;

  -- Påstand 4: sæsonen ligger i ÉT fodboldsæsonår (juli er skillelinjen).
  select count(distinct case when extract(month from (kickoff_at at time zone 'Europe/Copenhagen')) >= 7
                             then extract(year from (kickoff_at at time zone 'Europe/Copenhagen'))
                             else extract(year from (kickoff_at at time zone 'Europe/Copenhagen')) - 1 end)
    into v_n from public.matches where season_id = v_season;
  if v_n <> 1 then
    raise exception 'sæsonen ligger i % sæsonår — den krydser 1. juli, og milepælene ville tælle den som to', v_n;
  end if;

  if (select count(*) from public.competition_participants where competition_id = sim.competition_id()) <> 3 then
    raise exception 'alle tre brugere skal være meldt ind i konkurrencen';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. sim.season() — de afledte rækker (påstand 5)
-- ---------------------------------------------------------------------------

select sim.season() as spillet;

do $$
declare
  v_season uuid := sim.season_id();
  v_comp   uuid := sim.competition_id();
  v_n int;
begin
  select count(*) into v_n from public.predictions p
    join public.matches m on m.id = p.match_id where m.season_id = v_season;
  if v_n = 0 then raise exception 'ingen tips blev skrevet'; end if;

  select count(*) into v_n from public.matches
   where season_id = v_season and home_score is not null;
  if v_n = 0 then raise exception 'ingen kampe blev afgjort'; end if;

  -- Ratingen. Den skrives af matches-triggeren, som er exception-guarded: uden
  -- denne påstand ville en motor, der intet producerer, være grøn.
  select count(*) into v_n from public.ratings where scope = 'ALL';
  if v_n <> 3 then raise exception 'forventede rating for tre brugere, fik %', v_n; end if;
  if (select count(*) from public.rating_history where scope = 'ALL') = 0 then
    raise exception 'rating_history er tom — ratingen blev aldrig regnet';
  end if;

  -- Begge historie-motorer. `period` skiller dem ad, og de deler tabel: en
  -- runde-motor, der sletter for bredt, ville tørre dagskortene væk.
  if (select count(*) from public.stories where competition_id = v_comp and period = 'round') = 0 then
    raise exception 'ingen rundehistorier blev skrevet';
  end if;
  if (select count(*) from public.stories where competition_id = v_comp and period = 'day') = 0 then
    raise exception 'ingen dagshistorier blev skrevet';
  end if;
  -- v3's ét-slot-invariant, målt på rigtige data frem for på en fixture.
  select count(*) into v_n from (
    select user_id, day_key from public.stories
     where period = 'day' and news_value is not null
     group by 1, 2 having count(*) > 1
  ) x;
  if v_n <> 0 then raise exception '% (bruger, dag) har mere end ét dagskort', v_n; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Den færdigspillede sæson (påstand 6)
-- ---------------------------------------------------------------------------

select sim.tip() as tips_paa_resten;
select sim.play('2030-01-01') as resten_spillet;
select sim.finish_season() as saesonen_meldt_faerdig;

do $$
declare
  v_season uuid := sim.season_id();
  v_comp   uuid := sim.competition_id();
  v_n int;
begin
  select count(*) into v_n from public.matches
   where season_id = v_season and home_score is null;
  if v_n <> 0 then raise exception '% kampe mangler stadig resultat', v_n; end if;

  if not (select concluded from public.competition_status where competition_id = v_comp) then
    raise exception 'konkurrencen blev ikke meldt afsluttet, selv om alle kampe er spillet og sæsonen er færdig';
  end if;

  -- Kåringerne (A22). `mode_params.awards` er sat af sim.setup(), så en
  -- gennemspillet sæson UDEN kåringer betyder, at halvdelen af historikken
  -- mangler — og det er præcis den halvdel, en simulering findes for at vise.
  select count(*) into v_n from public.competition_awards where competition_id = v_comp;
  if v_n = 0 then raise exception 'ingen kåringer blev uddelt i en færdigspillet sæson med awards = true'; end if;

  if (select count(*) from public.milestones) = 0 then
    raise exception 'ingen milepæle blev uddelt efter en hel sæson';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Samme frø, samme sæson (påstand 7)
-- ---------------------------------------------------------------------------
-- Gemmes FØR nedrivningen, sammenlignes efter genopbygningen. To summer og
-- ikke én: resultaterne og tippene trækkes fra samme generator, men kun
-- resultaterne ville afsløre en ændret trækning i `sim.play()`.
--
-- LØFTET ER "samme frø + SAMME KALD", og den anden halvdel er ikke en detalje.
-- `setseed()` sættes af `sim.setup()`, og hver eneste `random()` bagefter
-- trækker videre i den samme strøm — så tips og resultater deler kø. En
-- gentagelse, der springer `sim.season()` over, får derfor et andet facit, uden
-- at noget er gået galt. Rækkefølgen nedenfor er ordret den samme som ovenfor,
-- og dét er selve prøven. (Skrevet efter at have taget fejl af netop dette:
-- første udgave af testen kaldte `setup → play` anden gang og meldte
-- simulatoren ikke-deterministisk.)

create temporary table _facit as
select (select sum(home_score * 1000 + away_score) from public.matches where season_id = sim.season_id()) as maalsum,
       (select sum(pred_home * 1000 + pred_away) from public.predictions p
          join public.matches m on m.id = p.match_id where m.season_id = sim.season_id()) as tipsum;

select sim.teardown() as revet_ned;

select sim.setup(12, 10) as bygget_igen;
select sim.season() as spillet_igen;
select sim.tip() as tips_paa_resten_igen;
select sim.play('2030-01-01') as resten_spillet_igen;

do $$
declare v_maal bigint; v_tip bigint; f record;
begin
  select sum(home_score * 1000 + away_score) into v_maal
    from public.matches where season_id = sim.season_id();
  select sum(pred_home * 1000 + pred_away) into v_tip
    from public.predictions p join public.matches m on m.id = p.match_id
   where m.season_id = sim.season_id();
  select * into f from _facit;

  if v_maal is distinct from f.maalsum then
    raise exception 'samme frø og samme kald gav ANDRE resultater (% mod %) — et fund kan ikke genfindes', v_maal, f.maalsum;
  end if;
  if v_tip is distinct from f.tipsum then
    raise exception 'samme frø og samme kald gav ANDRE tips (% mod %)', v_tip, f.tipsum;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. sim.teardown() — sporløst (påstand 8)
-- ---------------------------------------------------------------------------

select sim.teardown() as fjernet;

do $$
declare v_n int;
begin
  if sim.league_id() is not null then raise exception 'SIM-ligaen står der stadig'; end if;

  select count(*) into v_n from public.matches;
  if v_n <> 0 then raise exception '% kampe blev efterladt', v_n; end if;
  select count(*) into v_n from public.predictions;
  if v_n <> 0 then raise exception '% tips blev efterladt', v_n; end if;
  select count(*) into v_n from public.teams;
  if v_n <> 0 then raise exception '% hold blev efterladt', v_n; end if;
  select count(*) into v_n from public.competitions;
  if v_n <> 0 then raise exception '% konkurrencer blev efterladt', v_n; end if;
  select count(*) into v_n from public.groups;
  if v_n <> 0 then raise exception '% ligaer (grupper) blev efterladt', v_n; end if;
  select count(*) into v_n from public.competition_awards;
  if v_n <> 0 then raise exception '% kåringer blev efterladt', v_n; end if;

  -- De to slags AFLEDTE rækker, kaskaderne IKKE fanger, fordi de ikke peger på
  -- konkurrencen. Nedrivningen håndterer dem selv; står de tilbage, handler de
  -- om en sæson, der ikke findes.
  select count(*) into v_n from public.stories;
  if v_n <> 0 then raise exception '% historier blev efterladt om en sæson, der ikke findes', v_n; end if;

  -- Ratingen er regnet om og ikke bare efterladt: uden kampe er der intet at
  -- rate, og en rating, der bliver stående, er den værste af de to fejl.
  select count(*) into v_n from public.ratings where scope = 'ALL';
  if v_n <> 0 then raise exception '% ratingrækker overlevede nedrivningen', v_n; end if;

  -- Brugerne selv rører nedrivningen ikke.
  if (select count(*) from public.profiles) <> 3 then
    raise exception 'nedrivningen rørte brugerne';
  end if;
end $$;

\echo 'simulate_season.sql: alle otte påstande holdt.'
