-- Test af Story Engine v3 — DAGENS ENE KORT.
--
-- Kører mod en TOM engangsdatabase (CI: postgres-service; lokalt: en midlertidig
-- klynge). Rører aldrig produktion.
--
-- HVAD DEN BEVISER
--   1. En færdig dag producerer kort — og der er MINDST ét. Påstanden om et
--      ikke-nul rækkeantal er ikke pedantisk: hele kæden ligger bag matches-
--      triggerens exception-guard, og den mest sandsynlige fejl (en `date`/`text`
--      -sammenligning) fejler TAVST. Uden denne påstand ville en motor, der
--      intet producerer, være grøn i CI.
--   2. Den danske dag er den rigtige dag — også for en kamp, hvis UTC-dato er
--      en anden (23.30 dansk nytårsaften).
--   3. ÉT SLOT (v3): højst ét kort pr. bruger pr. dag på tværs af ALLE
--      konkurrencer — og det er databasen, ikke koden, der siger nej. Testen
--      forsøger derfor også at indsætte række nummer to direkte.
--   4. Rundens sidste dag udgiver INTET dagskort.
--   5. Scoringen er låst: de præcise news_value-tal påstås. En afvigelse i en
--      grundvægt eller et nærhedsled giver ikke en fejl, men et ANDET kort —
--      tavst. Det er hele grunden til, at tallene står her.
--   6. Tærsklen: en dag, hvor intet når 45, giver et dæmpet DAY_RESULT med
--      priority 180 — og news_value bærer stadig dagens højeste kandidatscore.
--   7. En bruger uden ét eneste tip får tips-påmindelsen, ALDRIG et drama-kort
--      om andre (acceptkriterie 8).
--   8. Milepæle: kaprer dagens slot, erstatter et allerede udgivet kort via
--      apply_milestone_stories(), og — det subtile — GENSKABES af en gen-kørsel
--      af dagsmotoren, fordi tilknytningsdags-formlen står ens begge steder.
--   9. Determinisme (acceptkriterie 7): to gen-kørsler giver byte-samme kort,
--      også når to kandidater har samme score.
--  10. Rundestoryens frames: præcis vinder-rækken får dem, og frame 5 findes
--      præcis én gang uanset antal milepæle.
--  11. REGRESSIONEN, DER BETYDER MEST: generate_stories() må ALDRIG slette
--      dagskort. Dagskortene bærer samme round_key som rundens kort, og v1's
--      `delete ... where round_key = p_round_key` ville have tørret hele ugen
--      væk ved hver eneste resultatændring — og de genskabes aldrig, for
--      dagsmotoren kører kun, når en dag BLIVER færdig.
--  12. latest_story ser kun runde-kort, og prioritetsbåndet 110–189 holder, så
--      karriereprofilens filter (< 90) udelukker dagskort uden kodeændring.
--  13. Karriereprofilen er uberørt (acceptkriterie 9).
--  14. **PRIORITETEN ER TÆRSKLEN** (`G78`, august 2026): for hvert v3-dagskort
--      gælder `priority < 180` ⟺ `news_value >= tærsklen`. Den påstand er hele
--      grunden til, at tærsklen kunne fjernes fra `src/lib/stories.js`, hvor den
--      stod som en kopi af `v_threshold`. Frontendens ulæst-markering læser nu
--      prioriteten, og hvis motoren en dag får en TREDJE udgang, skal det
--      opdages her frem for som et badge, der lyser den forkerte dag.
--
-- OM TIDSVINDUER: fixturen ligger i marts 2026, mens `now()` er hvad det er.
-- apply_milestone_stories() måler alder mod `now()`, så testen kalder den med
-- et bredt vindue, når kapringen skal ske, og med det snævre (default 48 t), når
-- den skal udeblive. Det er netop grænsen, der afprøves — ikke kalenderen.

\set ON_ERROR_STOP on
\timing off

-- ---------- minimalt skema ----------
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $$;
create table if not exists auth.users (id uuid primary key);
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create table public.profiles (id uuid primary key, display_name text, is_admin boolean default false);

\ir ../rating_core.sql

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_official boolean not null default true
);
create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  name text
);
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete cascade,
  name text not null
);
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  home_team_id uuid references public.teams(id),
  away_team_id uuid references public.teams(id),
  kickoff_at timestamptz not null,
  round_key date generated always as (public.round_key(kickoff_at)) stored,
  home_score int,
  away_score int
);
create table public.predictions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  pred_home int, pred_away int,
  primary key (user_id, match_id)
);
create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mode text not null default 'custom',
  mode_params jsonb not null default '{}'::jsonb,
  created_by uuid
);
create table public.competition_matches (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  primary key (competition_id, match_id)
);
create table public.competition_participants (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (competition_id, user_id)
);

-- Stillings-viewene stubbes som TOMME tabeller: de hører til de globale
-- RUNDE-regler (10 MONTH_CHAMP, 80/85 SHARP), som denne test ikke handler om.
-- `matches`-kolonnen er med, fordi build_round_frames() læser den til frame 1 —
-- den findes i det rigtige view (sql/tournament_scope.sql), og en stub, der
-- mangler den, ville fejle inde i en funktion frem for i en påstand.
create table public.round_standings (
  round_key date, scope text, user_id uuid, matches int,
  total_points int, exact_count int, outcome_count int, avg_goal_error numeric
);
create table public.monthly_standings (
  month text, scope text, user_id uuid,
  total_points int, exact_count int, outcome_count int, round_wins int, avg_goal_error numeric
);

\ir ../competition_awards.sql
-- Rækkefølgen er bindende: v2_day tilføjer matches.match_day og viewet
-- competition_match_points, som story_engine.sql's _se_rp læser fra.
\ir ../story_engine_v2_day.sql
\ir ../story_engine.sql
\ir ../story_engine_v2.sql
-- milestones FØR v3: dagsmotoren læser tabellen til kapringen (regel 110).
\ir ../milestones.sql
\ir ../story_engine_v3.sql

-- GEN-KØRSEL AF story_engine.sql, og den er ikke pynt. Produktionens rækkefølge
-- er "kør v2 og v3, gen-kør så story_engine" (den sidste er ændret til en
-- periode-afgrænset delete OG kalder nu build_round_frames), mens indlæsningen
-- ovenfor kører dem i den modsatte rækkefølge, fordi story_engine.sql opretter
-- selve tabellen. Uden denne linje afprøver testen kun den ene retning — og det
-- var netop den anden, der fejlede i produktion: filen havde sin egen
-- `create or replace view latest_story` med den korte kolonneliste, som ikke kan
-- erstatte v2's længere (`42P16: cannot drop columns from view`).
\ir ../story_engine.sql

-- ---------- fixture ----------
-- 2026-03-03 er en tirsdag (rundens første dag), 03-04 onsdag, 03-05 torsdag.
-- Dag 1 (tirsdag) bærer hele scoringstesten. Dag 3 (torsdag) er rundens SIDSTE
-- kampdag og skal derfor slet ikke give dagskort.
--
-- TO KONKURRENCER, og det er v3's kerne: c1 har fem deltagere, c2 fire. Uden en
-- anden konkurrence kunne testen ikke skelne "ét kort pr. bruger pr. dag" fra
-- v2's "ét kort pr. regel", og tiebreak-leddet "største konkurrence" ville
-- aldrig blive udøvet.
--
-- u6 deltager i c2 uden at afgive ét eneste tip — hun er acceptkriterie 8.
do $$
declare
  u1 uuid := '00000000-0000-0000-0000-000000000001';
  u2 uuid := '00000000-0000-0000-0000-000000000002';
  u3 uuid := '00000000-0000-0000-0000-000000000003';
  u4 uuid := '00000000-0000-0000-0000-000000000004';
  u5 uuid := '00000000-0000-0000-0000-000000000005';
  u6 uuid := '00000000-0000-0000-0000-000000000006';
  c1 uuid := '10000000-0000-0000-0000-000000000001';
  c2 uuid := '10000000-0000-0000-0000-000000000002';
  lg uuid; sn uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid; t7 uuid; t8 uuid; t9 uuid; t10 uuid;
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid; m6 uuid;
begin
  insert into public.profiles (id, display_name) values
    (u1,'Anna'), (u2,'Bo'), (u3,'Cecilie'), (u4,'David'), (u5,'Eva'), (u6,'Frida');

  insert into public.leagues (name) values ('Testliga') returning id into lg;
  insert into public.seasons (league_id, name) values (lg, '2025/26') returning id into sn;

  insert into public.teams (league_id, name) values (lg,'Randers') returning id into t1;
  insert into public.teams (league_id, name) values (lg,'Silkeborg') returning id into t2;
  insert into public.teams (league_id, name) values (lg,'OB') returning id into t3;
  insert into public.teams (league_id, name) values (lg,'Viborg') returning id into t4;
  insert into public.teams (league_id, name) values (lg,'AGF') returning id into t5;
  insert into public.teams (league_id, name) values (lg,'Brøndby') returning id into t6;
  insert into public.teams (league_id, name) values (lg,'FCK') returning id into t7;
  insert into public.teams (league_id, name) values (lg,'FCM') returning id into t8;
  insert into public.teams (league_id, name) values (lg,'Vejle') returning id into t9;
  insert into public.teams (league_id, name) values (lg,'Lyngby') returning id into t10;

  -- 12.00 UTC = 13.00 dansk, så match_day er utvetydigt den danske dag.
  insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
    values (sn, t1, t2, '2026-03-03 12:00:00+00', 2, 1) returning id into m1;
  insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
    values (sn, t3, t4, '2026-03-03 13:00:00+00', 3, 3) returning id into m2;
  insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
    values (sn, t5, t6, '2026-03-03 14:00:00+00', 1, 0) returning id into m3;
  insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
    values (sn, t7, t8, '2026-03-03 15:00:00+00', 2, 2) returning id into m4;
  -- onsdagens kamp: en stille dag, som skal ende i det dæmpede fald-tilbage
  insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
    values (sn, t9, t10, '2026-03-04 19:00:00+00', 1, 1) returning id into m5;
  -- torsdagens kamp lukker runden
  insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
    values (sn, t1, t3, '2026-03-05 19:00:00+00', 0, 0) returning id into m6;

  insert into public.competitions (id, name, mode) values
    (c1, 'Testkonkurrencen', 'custom'), (c2, 'Lillekonkurrencen', 'custom');
  insert into public.competition_participants (competition_id, user_id)
    values (c1,u1),(c1,u2),(c1,u3),(c1,u4),(c1,u5),
           (c2,u1),(c2,u2),(c2,u3),(c2,u6);
  insert into public.competition_matches (competition_id, match_id)
    values (c1,m1),(c1,m2),(c1,m3),(c1,m4),(c1,m5),(c1,m6),
           (c2,m1),(c2,m2),(c2,m3),(c2,m4),(c2,m5),(c2,m6);

  -- m1 (2-1 hjemmesejr): KUN u1 rammer udfaldet → CONTRARIAN (5 tippere ≥ 4)
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values
    (u1,m1,2,1), (u2,m1,0,1), (u3,m1,0,2), (u4,m1,1,2), (u5,m1,0,3);
  -- m2 (3-3): alle tipper hjemmesejr → INGEN rammer → COLLECTIVE_MISS
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values
    (u1,m2,2,0), (u2,m2,1,0), (u3,m2,2,1), (u4,m2,3,1), (u5,m2,4,0);
  -- m3 (1-0): u3 og u4 rammer på ét mål nær
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values
    (u1,m3,1,0), (u2,m3,1,0), (u3,m3,2,0), (u4,m3,0,0), (u5,m3,0,1);
  -- m4 (2-2): u3 og u4 rammer igen på ét mål nær → to nærmisser hver
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values
    (u1,m4,2,2), (u2,m4,1,1), (u3,m4,2,1), (u4,m4,1,2), (u5,m4,0,0);
  -- onsdag: alle rammer det samme, så ingen skiller sig ud → dæmpet dag
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values
    (u1,m5,1,1), (u2,m5,1,1), (u3,m5,1,1), (u4,m5,1,1), (u5,m5,1,1);
  -- torsdag
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values
    (u1,m6,0,0), (u2,m6,1,0), (u3,m6,0,1), (u4,m6,2,0), (u5,m6,0,0);
end $$;

-- ---------- 0. Forudsætninger ----------
do $$ begin
  -- 2026-03-03 SKAL være en tirsdag, ellers er hele fixturen forkert forankret.
  if public.round_key_of_date('2026-03-03') <> '2026-03-03'::date then
    raise exception 'FEJL 0a: 2026-03-03 er ikke rundens første dag';
  end if;
  if (select match_day from public.matches where kickoff_at = '2026-03-03 12:00:00+00')
     <> '2026-03-03'::date then
    raise exception 'FEJL 0b: match_day er ikke den danske dag';
  end if;
  if not public.match_day_complete('2026-03-03') then
    raise exception 'FEJL 0c: dagen meldes ikke komplet';
  end if;
  if public.match_day_complete('1999-01-01') then
    raise exception 'FEJL 0d: en dag uden kampe meldes komplet';
  end if;
  -- Alle seks kampe hører til samme runde, ellers rammer sidste-dag-testen ved siden af.
  if (select count(distinct round_key) from public.matches) <> 1 then
    raise exception 'FEJL 0e: fixturens kampe ligger i mere end én runde';
  end if;
end $$;

-- ---------- 1. Den danske dag ved døgnskiftet ----------
-- 23.30 dansk nytårsaften er 22.30 UTC. Uden zone-konverteringen ville kampen
-- lande på den forkerte dag — og med `timestamptz::date` (G11's fejl) ville
-- svaret desuden afhænge af, hvem der spørger.
do $$ begin
  if public.match_day('2026-12-31 22:30:00+00') <> '2026-12-31'::date then
    raise exception 'FEJL 1a: dansk 31/12 23.30 blev ikke 31. december';
  end if;
  if public.match_day('2026-12-31 23:30:00+00') <> '2027-01-01'::date then
    raise exception 'FEJL 1b: dansk 1/1 00.30 blev ikke 1. januar';
  end if;
end $$;

set timezone = 'America/New_York';
do $$ begin
  if public.match_day('2026-12-31 22:30:00+00') <> '2026-12-31'::date then
    raise exception 'FEJL 1c: match_day afhænger af sessionens tidszone';
  end if;
end $$;
reset timezone;

-- ---------- 2. Generér dag 1 · ÉT SLOT ----------
select public.generate_daily_stories('2026-03-03');

do $$
declare v_n int;
begin
  select count(*) into v_n from public.stories where period = 'day' and day_key = '2026-03-03';
  -- IKKE-NUL-PÅSTANDEN: en tavs fejl skal være rød, ikke grøn.
  if v_n = 0 then
    raise exception 'FEJL 2a: dagen producerede INGEN kort (tavs fejl?)';
  end if;

  -- V3'S KERNEINVARIANT: ét kort pr. bruger pr. dag, på tværs af BEGGE
  -- konkurrencer. I v2 ville de samme fem brugere have fået op til to hver.
  if exists (select 1 from public.stories where period = 'day' and day_key = '2026-03-03'
             group by user_id having count(*) > 1) then
    raise exception 'FEJL 2b: en bruger fik mere end ét kort';
  end if;

  -- Alle seks brugere skal have præcis ét — også Frida, der ingen tips havde.
  select count(distinct user_id) into v_n
  from public.stories where period = 'day' and day_key = '2026-03-03';
  if v_n <> 6 then
    raise exception 'FEJL 2c: % brugere fik kort, forventede 6', v_n;
  end if;

  -- Prioritetsbåndet — karriereprofilen filtrerer på priority < 90.
  if exists (select 1 from public.stories where period = 'day' and priority not between 110 and 189) then
    raise exception 'FEJL 2d: et dagskort ligger uden for båndet 110-189';
  end if;

  -- Formen: period/day_key hænger sammen, og round_key peger på rundens tirsdag.
  if exists (select 1 from public.stories where period = 'day' and round_key <> '2026-03-03') then
    raise exception 'FEJL 2e: dagskortets round_key er ikke rundens tirsdag';
  end if;

  -- news_value skrives ALTID. Det er æra-markøren, det unikke indeks hviler på —
  -- en v3-række uden den smutter uden om ét-slot-nettet.
  if exists (select 1 from public.stories where period = 'day' and news_value is null) then
    raise exception 'FEJL 2f: et v3-dagskort mangler news_value';
  end if;
end $$;

-- ---------- 3. ÉT SLOT håndhæves af DATABASEN, ikke af koden ----------
-- Acceptkriterie 1. Koden kunne have en fejl; indekset kan ikke.
do $$
declare v_uid uuid;
begin
  select user_id into v_uid from public.stories
  where period = 'day' and day_key = '2026-03-03' limit 1;
  begin
    insert into public.stories (round_key, day_key, period, user_id, rule, priority,
                                news_value, headline, body)
    values ('2026-03-03', '2026-03-03', 'day', v_uid, 'X', 130, 50, 'h', 'b');
    raise exception 'FEJL 3a: databasen accepterede kort nummer to samme dag';
  exception when unique_violation then null;
  end;

  -- Og modsat: en række UDEN news_value er uden for indeksets prædikat og
  -- afvises IKKE. Det er den dokumenterede restrisiko ved at skille æraerne ad
  -- på netop den kolonne, og den skal stå som en påstand frem for som en
  -- antagelse — ændres prædikatet, fejler denne linje og tvinger en beslutning.
  insert into public.stories (round_key, day_key, period, user_id, rule, priority,
                              news_value, headline, body)
  values ('2026-03-03', '2026-03-03', 'day', v_uid, 'V2ARV', 130, null, 'h', 'b');
  delete from public.stories where rule = 'V2ARV';
end $$;

-- ---------- 4. Scoringen er låst ----------
-- Tallene her er nyhedsværdi = grundvægt + størrelse + nærhed (spec §4). De står
-- også i src/lib/stories.js, og en afvigelse mellem de to giver ikke en fejl,
-- men et ANDET kort — uden log, uden at nogen opdager det. Derfor påstås de
-- præcist frem for at blive tjekket med "større end".
do $$
declare v_rule text; v_nv int; v_third boolean;
begin
  -- Anna fik dagens højeste i begge konkurrencer og er hovedperson:
  -- DAY_TOP 34 + størrelse + nærhed 20. Kortet skal komme fra den STØRSTE
  -- konkurrence (c1, fem deltagere) — tiebreak-leddet "største konkurrence".
  select rule, news_value, (payload ->> 'third')::boolean into v_rule, v_nv, v_third
  from public.stories where period = 'day' and day_key = '2026-03-03'
    and user_id = '00000000-0000-0000-0000-000000000001';
  if v_rule <> 'DAY_TOP' then
    raise exception 'FEJL 4a: Anna fik % , forventede DAY_TOP', v_rule;
  end if;
  if v_third then
    raise exception 'FEJL 4b: Annas eget kort blev renderet i tredjeperson';
  end if;
  if v_nv <> 34 + 12 + 20 then
    raise exception 'FEJL 4c: Annas news_value var %, forventede %', v_nv, 34 + 12 + 20;
  end if;
  if (select league_size from public.stories where period = 'day'
      and day_key = '2026-03-03' and user_id = '00000000-0000-0000-0000-000000000001') <> 5 then
    raise exception 'FEJL 4d: Annas kort kom ikke fra den største konkurrence';
  end if;

  -- Et fan-out-kort: Bo deler konkurrence med Anna og er ikke hovedperson.
  -- 34 + Annas størrelse 12 + nærhed (8 = største liga) = 54.
  select rule, news_value, (payload ->> 'third')::boolean into v_rule, v_nv, v_third
  from public.stories where period = 'day' and day_key = '2026-03-03'
    and user_id = '00000000-0000-0000-0000-000000000002';
  if not v_third then
    raise exception 'FEJL 4e: Bos kort om Anna blev ikke renderet i tredjeperson';
  end if;
  if v_nv <> 34 + 12 + 8 then
    raise exception 'FEJL 4f: Bos news_value var %, forventede %', v_nv, 34 + 12 + 8;
  end if;
  -- Tredjepersons-teksten skal nævne hovedpersonen ved navn — og hun deler
  -- konkurrence med Bo, så designreglen er overholdt.
  if (select headline from public.stories where period = 'day' and day_key = '2026-03-03'
      and user_id = '00000000-0000-0000-0000-000000000002') not like '%Anna%' then
    raise exception 'FEJL 4g: tredjepersons-kortet nævner ikke hovedpersonen';
  end if;
end $$;

-- ---------- 5. Tips-påmindelsen (acceptkriterie 8) ----------
-- Frida er deltager i c2, hvor der blev spillet fire kampe, men hun tippede
-- ingen. Hun må ALDRIG få et drama-kort om andre — hverken Annas dagshøjeste
-- eller nogens duel.
do $$
declare v_rule text; v_pri int; v_variant text; v_nv int;
begin
  select rule, priority, payload ->> 'variant', news_value
    into v_rule, v_pri, v_variant, v_nv
  from public.stories where period = 'day' and day_key = '2026-03-03'
    and user_id = '00000000-0000-0000-0000-000000000006';
  if v_rule is null then
    raise exception 'FEJL 5a: brugeren uden tips fik intet kort';
  end if;
  if v_rule <> 'DAY_RESULT' or v_pri <> 180 or v_variant <> 'no_tips' then
    raise exception 'FEJL 5b: brugeren uden tips fik %/%/% i stedet for det dæmpede no_tips-kort',
      v_rule, v_pri, v_variant;
  end if;
  if v_nv <> 0 then
    raise exception 'FEJL 5c: no_tips-kortet fik news_value %, forventede 0', v_nv;
  end if;
  -- Ingen emoji: dæmpet tier signalerer med fraværet af den.
  if (select headline from public.stories where period = 'day' and day_key = '2026-03-03'
      and user_id = '00000000-0000-0000-0000-000000000006') <> 'Ingen tips i dag' then
    raise exception 'FEJL 5d: no_tips-kortets overskrift er ikke den forventede';
  end if;
end $$;

-- ---------- 6. Tærsklen og det dæmpede fald-tilbage ----------
-- Onsdag tipper alle fem det samme rigtige resultat: ingen skiller sig ud,
-- ingen rykker, ingen duel ændrer sig. Ingen kandidat kan nå 45.
select public.generate_daily_stories('2026-03-04');

do $$
declare v_n int;
begin
  select count(*) into v_n from public.stories where period = 'day' and day_key = '2026-03-04';
  if v_n = 0 then
    raise exception 'FEJL 6a: den stille dag gav slet ingen kort';
  end if;

  -- Alle kort denne dag skal være det dæmpede fald-tilbage.
  if exists (select 1 from public.stories where period = 'day' and day_key = '2026-03-04'
             and (rule <> 'DAY_RESULT' or priority <> 180)) then
    raise exception 'FEJL 6b: en stille dag udgav et højdepunkt-kort';
  end if;

  -- ... og ingen af dem må have nået tærsklen. Det er selve definitionen.
  if exists (select 1 from public.stories where period = 'day' and day_key = '2026-03-04'
             and news_value >= 45) then
    raise exception 'FEJL 6c: et dæmpet kort bar en news_value over tærsklen';
  end if;

  -- news_value bæres stadig, så en dag ét point under kan kendes fra en tom dag
  -- (det er hele A35's måledata).
  if exists (select 1 from public.stories where period = 'day' and day_key = '2026-03-04'
             and news_value is null) then
    raise exception 'FEJL 6d: det dæmpede kort tabte sin news_value';
  end if;

  -- Ét slot gælder også her.
  if exists (select 1 from public.stories where period = 'day' and day_key = '2026-03-04'
             group by user_id having count(*) > 1) then
    raise exception 'FEJL 6e: den stille dag gav en bruger to kort';
  end if;
end $$;

-- ---------- 7. Rundens sidste dag udgiver INTET dagskort ----------
-- Acceptkriterie 2. Torsdag er rundens sidste kampdag, og da skal kun
-- rundekortet tale.
select public.generate_daily_stories('2026-03-05');

do $$ begin
  if exists (select 1 from public.stories where period = 'day' and day_key = '2026-03-05') then
    raise exception 'FEJL 7a: rundens sidste dag udgav et dagskort';
  end if;
  -- De tidligere dage er urørte — skippet er et return, ikke en oprydning.
  if not exists (select 1 from public.stories where period = 'day' and day_key = '2026-03-03') then
    raise exception 'FEJL 7b: sidste-dag-skippet slettede en tidligere dag';
  end if;
end $$;

-- ---------- 8. Determinisme (acceptkriterie 7) ----------
-- Fingerprintet dækker ALT, der kan flytte sig: valgt regel, konkurrence,
-- score, prioritet og selve teksten. To kandidater i fixturen har samme score
-- (Cecilie og David har identiske tips), så tiebreak-stigen udøves faktisk.
do $$
declare v_before text; v_after text;
begin
  select string_agg(user_id::text || ':' || rule || ':' || coalesce(competition_id::text, '-') ||
                    ':' || priority || ':' || news_value || ':' || md5(headline || body),
                    '|' order by user_id, rule)
    into v_before from public.stories where period = 'day' and day_key = '2026-03-03';
  perform public.generate_daily_stories('2026-03-03');
  select string_agg(user_id::text || ':' || rule || ':' || coalesce(competition_id::text, '-') ||
                    ':' || priority || ':' || news_value || ':' || md5(headline || body),
                    '|' order by user_id, rule)
    into v_after from public.stories where period = 'day' and day_key = '2026-03-03';
  if v_before is distinct from v_after then
    raise exception 'FEJL 8: to gen-kørsler gav forskellige kort';
  end if;
end $$;

-- ---------- 9. Milepæle kaprer dagens slot ----------
do $$
declare
  u2 uuid := '00000000-0000-0000-0000-000000000002';
  u3 uuid := '00000000-0000-0000-0000-000000000003';
  v_rule text; v_n int; v_nv int;
begin
  -- (a) En milepæl, der findes FØR generering, vinder slottet direkte.
  insert into public.milestones (user_id, key, family, tier, payload, achieved_at)
    values (u3, 'RATING_1200', 'rating', 1200, '{"peak": 1210}', '2026-03-03 20:00:00+00');
  perform public.generate_daily_stories('2026-03-03');

  select rule, news_value into v_rule, v_nv from public.stories
  where period = 'day' and day_key = '2026-03-03' and user_id = u3;
  if v_rule <> 'MILESTONE' then
    raise exception 'FEJL 9a: milepælen kaprede ikke slottet (fik %)', v_rule;
  end if;
  -- 100 (grundvægt) + 0 (milepæle får intet størrelsesbidrag) + 20 (nærhed).
  -- Tallet SKAL være det samme, som apply_milestone_stories skriver — se 9c.
  if v_nv <> 120 then
    raise exception 'FEJL 9b: milepælens news_value var %, forventede 120', v_nv;
  end if;
  select count(*) into v_n from public.stories
  where period = 'day' and day_key = '2026-03-03' and user_id = u3;
  if v_n <> 1 then
    raise exception 'FEJL 9c: kapringen lagde et kort TIL i stedet for at erstatte';
  end if;

  -- (b) En SEN milepæl — uddelt af cron efter at dagens kort er skrevet.
  insert into public.milestones (user_id, key, family, tier, payload, achieved_at)
    values (u2, 'PERFECT_ROUND', 'precision', 0, '{"matches": 4}', '2026-03-03 21:00:00+00');
  -- Det snævre vindue (default 48 t) må IKKE røre en milepæl fra marts.
  perform public.apply_milestone_stories();
  if (select rule from public.stories where period = 'day' and day_key = '2026-03-03'
      and user_id = u2) = 'MILESTONE' then
    raise exception 'FEJL 9d: en milepæl uden for aldersvinduet kaprede alligevel';
  end if;

  -- Med et bredt vindue erstattes kortet — og der er stadig præcis ét.
  perform public.apply_milestone_stories(200000);
  select rule, news_value into v_rule, v_nv from public.stories
  where period = 'day' and day_key = '2026-03-03' and user_id = u2;
  if v_rule <> 'MILESTONE' then
    raise exception 'FEJL 9e: den sene milepæl erstattede ikke kortet (fik %)', v_rule;
  end if;
  if v_nv <> 120 then
    raise exception 'FEJL 9f: den sene kapring gav news_value %, ikke 120 som motoren', v_nv;
  end if;
  select count(*) into v_n from public.stories
  where period = 'day' and day_key = '2026-03-03' and user_id = u2;
  if v_n <> 1 then
    raise exception 'FEJL 9g: den sene kapring lagde et kort til';
  end if;

  -- (c) DET SUBTILE: en gen-kørsel af dagsmotoren sletter dagens rækker og
  -- dermed kapringen — men GENSKABER den, fordi tilknytningsdags-formlen står
  -- ordret ens i generate_daily_stories() og apply_milestone_stories(). Ændres
  -- den ene uden den anden, går sene milepæle tabt ved næste resultatrettelse,
  -- og det sker tavst.
  perform public.generate_daily_stories('2026-03-03');
  if (select rule from public.stories where period = 'day' and day_key = '2026-03-03'
      and user_id = u2) <> 'MILESTONE' then
    raise exception 'FEJL 9h: gen-kørslen tabte kapringen';
  end if;

  -- (d) To milepæle samme dag: familie-rangordenen afgør, og der er STADIG ét
  -- kort. 'competition' rangerer over 'precision' (MILESTONE_FAMILIES).
  insert into public.milestones (user_id, key, family, tier, payload, achieved_at)
    values (u2, 'COMP_FIRST_WIN', 'competition', 0, '{"league": "Testkonkurrencen"}',
            '2026-03-03 21:30:00+00');
  perform public.generate_daily_stories('2026-03-03');
  select count(*) into v_n from public.stories
  where period = 'day' and day_key = '2026-03-03' and user_id = u2;
  if v_n <> 1 then
    raise exception 'FEJL 9i: to milepæle samme dag gav % kort', v_n;
  end if;
  if (select payload ->> 'milestone_key' from public.stories
      where period = 'day' and day_key = '2026-03-03' and user_id = u2) <> 'COMP_FIRST_WIN' then
    raise exception 'FEJL 9j: familie-rangordenen valgte den forkerte milepæl';
  end if;
end $$;

-- ---------- 10. REGRESSIONEN: runde-motoren må ikke slette dagskort ----------
-- Den vigtigste påstand i filen, uændret fra v2. Dagskortene bærer samme
-- round_key som rundens kort, så v1's uafgrænsede
-- `delete ... where round_key = p_round_key` ville tørre hele ugen væk ved hver
-- eneste resultatændring — og de genskabes aldrig.
do $$
declare v_before int; v_after int; v_round int;
begin
  select count(*) into v_before from public.stories where period = 'day';
  perform public.generate_stories('2026-03-03');
  select count(*) into v_after from public.stories where period = 'day';
  if v_after <> v_before then
    raise exception 'FEJL 10a: generate_stories slettede dagskort (% -> %)', v_before, v_after;
  end if;

  select count(*) into v_round from public.stories where period = 'round';
  if v_round = 0 then
    raise exception 'FEJL 10b: runde-motoren producerede ingen kort';
  end if;

  -- Og omvendt: dagsmotoren må ikke røre rundens kort.
  perform public.generate_daily_stories('2026-03-03');
  if (select count(*) from public.stories where period = 'round') <> v_round then
    raise exception 'FEJL 10c: generate_daily_stories slettede runde-kort';
  end if;
end $$;

-- ---------- 11. Rundestoryens frames ----------
-- Acceptkriterie 6: præcis én frame 5, uanset at Bo nu har to milepæle i runden.
do $$
declare v_n int; v_f5 int;
begin
  -- Præcis vinder-rækken pr. bruger har frames — ikke alle brugerens rækker.
  if exists (
    select 1 from public.stories where period = 'round' and payload ? 'frames'
    group by user_id, round_key having count(*) > 1
  ) then
    raise exception 'FEJL 11a: mere end én runde-række pr. bruger fik frames';
  end if;

  -- Og den række, der fik dem, er den, latest_story viser.
  if exists (
    select 1 from public.stories s
    where s.period = 'round' and s.payload ? 'frames'
      and not exists (select 1 from public.latest_story ls where ls.id = s.id)
  ) then
    raise exception 'FEJL 11b: frames landede på en anden række end den viste';
  end if;

  -- Fire frames uden milepæl, fem med.
  select count(*) into v_n from public.stories
  where period = 'round' and jsonb_array_length(payload -> 'frames') not in (4, 5);
  if v_n > 0 then
    raise exception 'FEJL 11c: % rundekort har et forkert antal frames', v_n;
  end if;

  -- Bo har TO milepæle i runden og skal have præcis ÉN frame 5.
  select jsonb_array_length(payload -> 'frames') into v_n from public.stories
  where period = 'round' and user_id = '00000000-0000-0000-0000-000000000002'
    and payload ? 'frames';
  if v_n <> 5 then
    raise exception 'FEJL 11d: Bo har to milepæle men % frames, forventede 5', v_n;
  end if;
  select count(*) into v_f5 from jsonb_array_elements(
    (select payload -> 'frames' from public.stories where period = 'round'
     and user_id = '00000000-0000-0000-0000-000000000002' and payload ? 'frames')) e
  where e ->> 'frame' = 'MILESTONE';
  if v_f5 <> 1 then
    raise exception 'FEJL 11e: Bo fik % milepæls-frames, forventede præcis 1', v_f5;
  end if;

  -- Frame 1 og 3 er dem, der skal kunne stå alene som delt billede — de skal
  -- derfor findes på hvert eneste rundekort.
  if exists (
    select 1 from public.stories s where s.period = 'round' and s.payload ? 'frames'
      and not (s.payload -> 'frames' -> 0 ->> 'frame' = 'ROUND_SUM'
           and s.payload -> 'frames' -> 2 ->> 'frame' = 'RATING')
  ) then
    raise exception 'FEJL 11f: frame-rækkefølgen er ikke den, frontenden renderer';
  end if;
end $$;

-- ---------- 12. latest_story ser kun runde-kort ----------
do $$ begin
  if exists (select 1 from public.latest_story where period <> 'round') then
    raise exception 'FEJL 12a: latest_story lækker dagskort til Hjem-kortet';
  end if;
  if exists (select 1 from public.latest_story group by user_id, round_key having count(*) > 1) then
    raise exception 'FEJL 12b: latest_story gav mere end ét kort pr. bruger pr. runde';
  end if;
  if exists (select 1 from public.stories where period = 'round'
             group by round_key, user_id, rule, competition_id having count(*) > 1) then
    raise exception 'FEJL 12c: dublet blandt runde-kort';
  end if;
  -- Constrainten, der binder period og day_key sammen, skal afvise en forkert form.
  begin
    insert into public.stories (round_key, day_key, period, user_id, rule, priority, headline, body)
    values ('2026-03-03', null, 'day', '00000000-0000-0000-0000-000000000001', 'X', 110, 'h', 'b');
    raise exception 'FEJL 12d: et dagskort uden day_key blev accepteret';
  exception when check_violation then null;
  end;
end $$;

-- ---------- 13. Karriereprofilen er uberørt (acceptkriterie 9) ----------
-- loadCareerMilestones læser milestones-tabellen direkte. Hele v3 må ikke have
-- rørt en eneste række dér — kapringen læser, den skriver ikke.
do $$
declare v_n int;
begin
  select count(*) into v_n from public.milestones;
  if v_n <> 3 then
    raise exception 'FEJL 13a: milestones-tabellen har % rækker, forventede de 3 indsatte', v_n;
  end if;
  if exists (select 1 from public.milestones where payload = '{}'::jsonb) then
    raise exception 'FEJL 13b: en milepæls payload blev overskrevet';
  end if;
end $$;

-- ---------- 14. Prioriteten ER tærsklen (G78) ----------
-- Frontendens ulæst-markering læser `priority` og ikke `news_value`, fordi
-- tærsklen ikke længere står i src/lib/stories.js. Det hviler på ÉN invariant,
-- som denne blok er hele beviset for: motoren har præcis to udgange for et
-- dagskort — vinderen over tærsklen med sin egen regels prioritet (110–160),
-- og det dæmpede DAY_RESULT på 180 — og de to falder aldrig sammen.
--
-- Påstanden er skrevet med `v_threshold` som TAL og ikke som symbol med vilje:
-- A35 kan flytte tærsklen, og så skal påstanden stadig holde. Den siger derfor
-- ikke "45", men "de to sider er enige".
do $$
declare v_grænse int := 45;   -- v_threshold i generate_daily_stories()
begin
  if exists (
    select 1 from public.stories
     where period = 'day' and news_value is not null
       and (priority < 180) <> (news_value >= v_grænse)
  ) then
    raise exception
      'FEJL 14a: et dagskort, hvor prioritet og tærskel er UENIGE — frontendens ulæst-markering (isNewsworthy) læser prioriteten og ville tage fejl. Fandt: %',
      (select string_agg(format('%s/%s/%s', rule, priority, news_value), ', ')
         from public.stories where period = 'day' and news_value is not null
          and (priority < 180) <> (news_value >= v_grænse));
  end if;

  -- Og at der FINDES kort i begge lejre. Uden dette ville påstanden ovenfor
  -- være tom sandhed på en fixture, hvor alle kort tilfældigvis var dæmpede.
  if not exists (select 1 from public.stories where period = 'day' and news_value is not null and priority < 180) then
    raise exception 'FEJL 14b: fixturen har ingen kort OVER tærsklen — påstand 14a beviser da ingenting';
  end if;
  if not exists (select 1 from public.stories where period = 'day' and news_value is not null and priority = 180) then
    raise exception 'FEJL 14c: fixturen har ingen DÆMPEDE kort — påstand 14a beviser da ingenting';
  end if;
end $$;

\echo 'story_engine_daily: alle påstande holdt'
