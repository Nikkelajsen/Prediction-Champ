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
--  15. **EN DAG, DER STADIG SPILLES, FÅR INTET KORT** (august 2026). Kravet lå
--      kun i matches-triggeren, så bagstopperen — som pr. definition omgår den
--      — udgav "Dagens facit" midt på kampdagen med tal beregnet på en halv
--      dag. Påstanden dækker BEGGE veje ind i motoren og har en modprøve, uden
--      hvilken en motor, der er holdt op med at skrive, ville bestå.
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
  name text not null,
  -- `B39` (#72): motoren skriver det korte navn i historierne, hvor der er ét.
  short_name text
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
-- #68 FØR #47, og rækkefølgen er produktionens (se filens eget hoved):
-- generate_daily_stories() kalder users_with_complete_day(), og #68 overtager
-- desuden generate_stories_catchup() fra story_engine_v2.sql ovenfor.
\ir ../story_engine_personal_day.sql
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
--
-- u7 tipper NØJAGTIG som u3 og er kun med i c2. Hun findes for én ting: at c2's
-- stilling har en ÆGTE POINTLIGHED, hvor to spillere deler tredjepladsen på
-- hele tiebreaker-stigen (point, præcise, udfald, målfejl). Uden hende er `rnk`
-- og den totale orden det samme tal i hver eneste række i fixturen, og påstand
-- 15 kunne ikke skelne "vis placeringen" fra "vis rækkens nummer" — en mini,
-- der skriver 3. og 4. til to spillere, som begge ER nr. 3. Det slap netop
-- igennem ved mutationstesten af påstand 15 (8. august 2026).
do $$
declare
  u1 uuid := '00000000-0000-0000-0000-000000000001';
  u2 uuid := '00000000-0000-0000-0000-000000000002';
  u3 uuid := '00000000-0000-0000-0000-000000000003';
  u4 uuid := '00000000-0000-0000-0000-000000000004';
  u5 uuid := '00000000-0000-0000-0000-000000000005';
  u6 uuid := '00000000-0000-0000-0000-000000000006';
  u7 uuid := '00000000-0000-0000-0000-000000000007';
  c1 uuid := '10000000-0000-0000-0000-000000000001';
  c2 uuid := '10000000-0000-0000-0000-000000000002';
  lg uuid; sn uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid; t7 uuid; t8 uuid; t9 uuid; t10 uuid;
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid; m6 uuid;
begin
  insert into public.profiles (id, display_name) values
    (u1,'Anna'), (u2,'Bo'), (u3,'Cecilie'), (u4,'David'), (u5,'Eva'), (u6,'Frida'),
    (u7,'Gitte');

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
           (c2,u1),(c2,u2),(c2,u3),(c2,u6),(c2,u7);
  insert into public.competition_matches (competition_id, match_id)
    values (c1,m1),(c1,m2),(c1,m3),(c1,m4),(c1,m5),(c1,m6),
           (c2,m1),(c2,m2),(c2,m3),(c2,m4),(c2,m5),(c2,m6);

  -- m1 (2-1 hjemmesejr): KUN u1 rammer udfaldet → CONTRARIAN (5 tippere ≥ 4)
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values
    (u1,m1,2,1), (u2,m1,0,1), (u3,m1,0,2), (u4,m1,1,2), (u5,m1,0,3), (u7,m1,0,2);
  -- m2 (3-3): alle tipper hjemmesejr → INGEN rammer → COLLECTIVE_MISS
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values
    (u1,m2,2,0), (u2,m2,1,0), (u3,m2,2,1), (u4,m2,3,1), (u5,m2,4,0), (u7,m2,2,1);
  -- m3 (1-0): u3 og u4 rammer på ét mål nær
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values
    (u1,m3,1,0), (u2,m3,1,0), (u3,m3,2,0), (u4,m3,0,0), (u5,m3,0,1), (u7,m3,2,0);
  -- m4 (2-2): u3 og u4 rammer igen på ét mål nær → to nærmisser hver
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values
    (u1,m4,2,2), (u2,m4,1,1), (u3,m4,2,1), (u4,m4,1,2), (u5,m4,0,0), (u7,m4,2,1);
  -- onsdag: alle rammer det samme, så ingen skiller sig ud → dæmpet dag
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values
    (u1,m5,1,1), (u2,m5,1,1), (u3,m5,1,1), (u4,m5,1,1), (u5,m5,1,1), (u7,m5,1,1);
  -- torsdag
  insert into public.predictions (user_id, match_id, pred_home, pred_away) values
    (u1,m6,0,0), (u2,m6,1,0), (u3,m6,0,1), (u4,m6,2,0), (u5,m6,0,0), (u7,m6,0,1);
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

  -- Alle syv brugere skal have præcis ét — også Frida, der ingen tips havde.
  select count(distinct user_id) into v_n
  from public.stories where period = 'day' and day_key = '2026-03-03';
  if v_n <> 7 then
    raise exception 'FEJL 2c: % brugere fik kort, forventede 7', v_n;
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
  -- Konkurrencen påstås ved ID og ikke kun ved `league_size`: c2 har fem
  -- deltagere siden Gitte kom til (se fixturen), så størrelsen alene kan ikke
  -- længere skelne de to. Rækkefølgen afgøres da af `competition_id asc`, og
  -- dét er præcis det led, påstanden skal holde fast i.
  if (select competition_id from public.stories where period = 'day'
      and day_key = '2026-03-03' and user_id = '00000000-0000-0000-0000-000000000001')
     <> '10000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'FEJL 4d: Annas kort kom ikke fra c1';
  end if;
  if (select league_size from public.stories where period = 'day'
      and day_key = '2026-03-03' and user_id = '00000000-0000-0000-0000-000000000001') <> 5 then
    raise exception 'FEJL 4d2: Annas kort bærer et forkert deltagerantal';
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
-- score, prioritet, teksten OG payloaden. To kandidater i fixturen har samme
-- score (Cecilie og David har identiske tips), så tiebreak-stigen udøves faktisk.
--
-- PAYLOADEN KOM MED 8. AUGUST 2026 (G88), og udeladelsen var et hul og ikke et
-- valg: kommentaren her har altid påstået "ALT, der kan flytte sig", mens
-- fingerprintet kun dækkede overskrift og brødtekst. Da mini-stillingen flyttede
-- ind i payloaden, blev udeladelsen dyr — tre navne og deres placeringer kunne
-- have skiftet mellem to gen-kørsler, uden at én bogstav i teksten ændrede sig.
-- `jsonb`s tekstform er kanonisk (sorterede nøgler), så md5 over den er stabil.
do $$
declare v_before text; v_after text;
begin
  select string_agg(user_id::text || ':' || rule || ':' || coalesce(competition_id::text, '-') ||
                    ':' || priority || ':' || news_value || ':' || md5(headline || body) ||
                    ':' || md5(payload::text),
                    '|' order by user_id, rule)
    into v_before from public.stories where period = 'day' and day_key = '2026-03-03';
  perform public.generate_daily_stories('2026-03-03');
  select string_agg(user_id::text || ':' || rule || ':' || coalesce(competition_id::text, '-') ||
                    ':' || priority || ':' || news_value || ':' || md5(headline || body) ||
                    ':' || md5(payload::text),
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

-- ---------- 15. Mini-stillingen (G88) ----------
-- Rækken, denne blok findes for, var ikke en fejl i en beregning, men et felt
-- INGEN skrev: `DayCard.jsx` renderede `payload.mini`, spec §8 lovede den, og
-- `MiniStanding` returnerer `null` på en tom liste — så halvdelen af kortet
-- manglede uden at efterlade et spor. **15a er derfor den vigtigste påstand i
-- blokken**: den fejler på præcis den tilstand, der stod i produktion, og en
-- gennemlæsning af hverken SQL eller JSX kunne se den.
--
-- Påstand 15c er designreglen og ikke en formalitet: et navn i mini må aldrig
-- være en, modtageren ikke deler konkurrence med. Nøjagtig dén regel blev brudt
-- i juli 2026, da `_se_rp` manglede sit join, og fejlen var usynlig i alt andet
-- end de navne, folk læste på kortet.
do $$
declare
  u1 uuid := '00000000-0000-0000-0000-000000000001';
  u5 uuid := '00000000-0000-0000-0000-000000000005';
  u7 uuid := '00000000-0000-0000-0000-000000000007';
  c1 uuid := '10000000-0000-0000-0000-000000000001';
  c2 uuid := '10000000-0000-0000-0000-000000000002';
  v_n int; v_mini jsonb;
begin
  -- (a) Et dagskort for en konkurrence, modtageren HAR scorede tip i, skal have
  -- sin mini. Undtagelsen er MILESTONE (se 15f) og brugere uden ét eneste tip,
  -- som ikke står i stillingen og derfor ikke kan vises i den.
  select count(*) into v_n
  from public.stories s
  where s.period = 'day' and s.competition_id is not null and s.rule <> 'MILESTONE'
    and exists (select 1 from public.competition_match_points cmp
                where cmp.competition_id = s.competition_id
                  and cmp.user_id = s.user_id and cmp.match_day <= s.day_key)
    and not (s.payload ? 'mini');
  if v_n > 0 then
    raise exception 'FEJL 15a: % dagskort mangler payload.mini — kortet renderer en tom mini-stilling', v_n;
  end if;

  -- Og at der FINDES kort med mini. Uden dette var 15a en tom sandhed — præcis
  -- den slags påstand, der stod grøn, mens feltet aldrig blev skrevet.
  if not exists (select 1 from public.stories where period = 'day' and payload ? 'mini') then
    raise exception 'FEJL 15b: ingen dagskort har en mini — 15a beviser da ingenting';
  end if;

  -- (c) DESIGNREGLEN: hvert navn i en mini tilhører en deltager i kortets egen
  -- konkurrence.
  if exists (
    select 1 from public.stories s
    cross join lateral jsonb_array_elements(s.payload -> 'mini') as r
    where s.period = 'day' and s.payload ? 'mini'
      and not exists (
        select 1 from public.competition_participants cp
        join public.profiles p on p.id = cp.user_id
        where cp.competition_id = s.competition_id and p.display_name = r ->> 'name')
  ) then
    raise exception 'FEJL 15c: en mini nævner en, modtageren ikke deler konkurrence med';
  end if;

  -- (d) Præcis én række er markeret `me`, og det er modtagerens egen.
  if exists (
    select 1 from public.stories s
    where s.period = 'day' and s.payload ? 'mini'
      and (select count(*) from jsonb_array_elements(s.payload -> 'mini') r
           where (r ->> 'me')::boolean) <> 1
  ) then
    raise exception 'FEJL 15d: en mini har ikke præcis én me-markeret række';
  end if;
  if exists (
    select 1 from public.stories s
    join public.profiles p on p.id = s.user_id
    cross join lateral jsonb_array_elements(s.payload -> 'mini') as r
    where s.period = 'day' and s.payload ? 'mini'
      and (r ->> 'me')::boolean and r ->> 'name' <> p.display_name
  ) then
    raise exception 'FEJL 15e: me-rækken bærer et andet navn end modtagerens';
  end if;

  -- (f) Annas kort er c1 (fem deltagere, se 4d), og hun fører med 9 point.
  -- Stillingen efter dag 1: Anna 9, Bo 4, Cecilie 1, Eva 1, David 0 — Cecilie
  -- foran Eva på gennemsnitlig målfejl (2,0 mod 3,5), altså hele tiebreaker-
  -- stigen og ikke bare point. Nr. 1 ser 1-2-3, fordi vinduet klemmes mod
  -- toppen: alternativet ville give føreren mindst indhold.
  select payload -> 'mini' into v_mini from public.stories
  where period = 'day' and day_key = '2026-03-03' and user_id = u1;
  if v_mini is null or jsonb_array_length(v_mini) <> 3 then
    raise exception 'FEJL 15f: Annas mini har % rækker, forventede 3',
      coalesce(jsonb_array_length(v_mini)::text, 'ingen');
  end if;
  if (v_mini -> 0 ->> 'name') <> 'Anna' or (v_mini -> 0 ->> 'rnk') <> '1'
     or (v_mini -> 0 ->> 'pts') <> '9' or not (v_mini -> 0 ->> 'me')::boolean then
    raise exception 'FEJL 15g: Annas egen række er %, forventede Anna/1/9/me', v_mini -> 0;
  end if;
  if (v_mini -> 1 ->> 'name') <> 'Bo' or (v_mini -> 1 ->> 'rnk') <> '2'
     or (v_mini -> 2 ->> 'name') <> 'Cecilie' or (v_mini -> 2 ->> 'rnk') <> '3' then
    raise exception 'FEJL 15h: Annas naboer er %/%, forventede Bo(2) og Cecilie(3)',
      v_mini -> 1, v_mini -> 2;
  end if;

  -- (h2) DELT PLACERING VISES SOM DELT. Gitte tipper nøjagtig som Cecilie og er
  -- kun med i c2, så de to deler tredjepladsen på hele tiebreaker-stigen.
  -- Påstanden skelner `rnk` (placeringen, som er 3 for dem begge) fra rækkens
  -- nummer i vinduet (3 og 4) — uden en pointlighed i fixturen er de to tal ens
  -- overalt, og en mini, der skrev "4. Gitte" om en delt tredjeplads, ville stå
  -- grøn. Det er samtidig det ENESTE kort i fixturen fra c2, og dermed det, der
  -- giver 15c sine tænder: en mini hentet fra den forkerte konkurrence ville
  -- her nævne David eller Eva, som ikke er med i c2.
  select payload -> 'mini' into v_mini from public.stories
  where period = 'day' and day_key = '2026-03-03' and user_id = u7;
  if v_mini is null then
    raise exception 'FEJL 15h2: Gitte har ingen mini — pointligheden afprøves da ikke';
  end if;
  if (select competition_id from public.stories where period = 'day'
      and day_key = '2026-03-03' and user_id = u7) <> c2 then
    raise exception 'FEJL 15h3: Gittes kort er ikke fra c2 — 15c er da stadig tom';
  end if;
  if (v_mini -> 1 ->> 'name') <> 'Cecilie' or (v_mini -> 2 ->> 'name') <> 'Gitte' then
    raise exception 'FEJL 15h4: Gittes naboer er %/%, forventede Cecilie og Gitte',
      v_mini -> 1, v_mini -> 2;
  end if;
  if (v_mini -> 1 ->> 'rnk') <> '3' or (v_mini -> 2 ->> 'rnk') <> '3' then
    raise exception
      'FEJL 15h5: to spillere, der DELER tredjepladsen, står som %. og %. — mini viser rækkens nummer og ikke placeringen',
      v_mini -> 1 ->> 'rnk', v_mini -> 2 ->> 'rnk';
  end if;

  -- (i) VINDUET GLIDER. Uden denne påstand ville en implementering, der altid
  -- viste top 3, bestå alt ovenstående — Anna ER nr. 1. Nogen i bunden af
  -- stillingen skal se sine egne naboer og ikke førerfeltet.
  if not exists (
    select 1 from public.stories s
    where s.period = 'day' and s.payload ? 'mini'
      and (s.payload -> 'mini' -> 0 ->> 'rnk')::int > 1
  ) then
    raise exception 'FEJL 15i: ingen mini begynder under nr. 1 — vinduet er reelt "top 3"';
  end if;

  -- HVAD BLOK 15 IKKE BEVISER. Påstandene er muteret 12 gange (8. august 2026);
  -- ti blev fanget, to slap igennem, og de står her frem for at blive glemt:
  --
  --   · **Et opslag i _sd_mini uden konkurrence-afgrænsning.** Den realistiske
  --     form — `join ... on mn.user_id = w.user_id` alene — fanges af det unikke
  --     indeks, fordi den giver et kort pr. konkurrence. Den kunstige form (vælg
  --     brugerens laveste competition_id) gør intet forkert her, fordi
  --     tiebreak-stigen altid lader c1 vinde for en bruger, der er med i begge.
  --     Et kort på c2 for en bruger, der også er i c1, kan fixturen ikke
  --     fremkalde uden at vælte de hårdkodede news_value-tal i påstand 4.
  --   · **`row_number() over (order by rnk)` uden `user_id` som andet led.** Det
  --     er en LATENT ikke-determinisme: rækkefølgen blandt to ligeplacerede er
  --     fri, men PostgreSQL leverer den samme hver gang på en tabel af denne
  --     størrelse, så påstand 8 kan ikke fremtvinge en forskel. Leddet står i
  --     koden, fordi planen kan ændre sig — ikke fordi en test kræver det.
  --
  -- (j) MILEPÆLE HAR INGEN MINI, ad BEGGE veje til et sådant kort, og det er en
  -- determinismes-betingelse (acceptkriterie 7) og ikke en smagssag.
  --
  -- Vej 1: motoren. Milepælen får her en `competition_id` MED VILJE — uden den
  -- ville påstanden være tom, fordi et milepæls-kort uden konkurrence aldrig
  -- kan slå op i _sd_mini alligevel, og guarden `rule <> 'MILESTONE'` kunne
  -- slettes uden at nogen test blev rød.
  insert into public.milestones (user_id, key, family, tier, competition_id, payload, achieved_at)
    values (u1, 'COMP_STREAK_3', 'competition', 0, c1, '{"n": 3}', '2026-03-03 22:00:00+00');
  perform public.generate_daily_stories('2026-03-03');
  if (select rule from public.stories
      where period = 'day' and day_key = '2026-03-03' and user_id = u1) <> 'MILESTONE' then
    raise exception 'FEJL 15j: milepælen kaprede ikke Annas kort — 15k beviser da ingenting';
  end if;
  if exists (select 1 from public.stories where period = 'day' and rule = 'MILESTONE'
             and competition_id is not null and payload ? 'mini') then
    raise exception 'FEJL 15k: motoren gav et milepæls-kort med konkurrence en mini-stilling';
  end if;

  -- Vej 2: kapringen. Eva har stadig et almindeligt kort MED en mini, og hendes
  -- milepæl lander bagefter — altså præcis den rækkefølge, `- 'mini'` findes
  -- for. Kortets competition_id flyttes til milepælens (her: ingen), og en
  -- beholdt mini ville så vise c1's stilling under et kort uden konkurrence.
  if not (select payload ? 'mini' from public.stories
          where period = 'day' and day_key = '2026-03-03' and user_id = u5) then
    raise exception 'FEJL 15l: Evas kort har ingen mini at fjerne — 15m beviser da ingenting';
  end if;
  insert into public.milestones (user_id, key, family, tier, payload, achieved_at)
    values (u5, 'TIPS_100', 'precision', 100, '{"n": 100}', '2026-03-03 22:30:00+00');
  perform public.apply_milestone_stories(200000);
  if (select rule from public.stories
      where period = 'day' and day_key = '2026-03-03' and user_id = u5) <> 'MILESTONE' then
    raise exception 'FEJL 15m: kapringen tog ikke Evas kort';
  end if;
  if (select payload ? 'mini' from public.stories
      where period = 'day' and day_key = '2026-03-03' and user_id = u5) then
    raise exception 'FEJL 15n: kapringen beholdt en mini fra kortets tidligere konkurrence';
  end if;
end $$;

-- ---------- 16. Datid-formen bliver faktisk skrevet (G89) ----------
-- **SORTLISTEN BOR IKKE HER, og det er en lære værd at gemme.** Første udgave
-- af denne blok sortlistede de fem nutids-fraser mod `public.stories`. Den blev
-- muteret, og to af fem blev fanget: fixturen udgiver kun DAY_RESULT, DAY_TOP og
-- MILESTONE, så DUEL, SO_CLOSE, CONTRARIAN, COLLECTIVE_MISS og STREAK_STATUS
-- kunne stå i nutid uden at én påstand blev rød. En sortliste mod RÆKKER kan
-- kun se de regler, fixturen fyrer.
--
-- Sortlisten læser derfor KILDEN og bor i `sql/migration_syntax.test.js` (vagt
-- 3), hvor den dækker alle otte regler og fanger alle fem mutationer. Tilbage
-- her er den ene påstand, en fil-vagt ikke kan lave: at teksten også NÅR ud på
-- en udgivet række.
do $$ begin
  if not exists (
    select 1 from public.stories
     where period = 'day'
       and (body like '%Du sluttede dagen som nr.%' or body like '%Toppen var%')
  ) then
    raise exception 'FEJL 16: ingen udgivet DAY_RESULT bærer datid-formen — teksten er rettet i kilden, men når ikke ud på rækken';
  end if;
end $$;

-- ---------- 17. Bagstopperens runde-løkke er selvafsluttende (G90) ----------
-- En runde, der ALDRIG kan producere en historie, må ikke forsøges igen ved hver
-- kørsel. Fixturen får derfor en runde, der er præcis dét: kampen har resultat,
-- ligger langt i fortiden, er i ingen konkurrence, og INGEN har tippet den.
--
-- Uden betingelsen tæller `generate_stories_catchup()` den hver eneste gang —
-- 48-96 gange i døgnet, for evigt — og æder det loft, de rigtige huller skal
-- bruge. Påstanden er derfor, at TO kald i træk begge svarer 0.
do $$
declare
  lg uuid; sn uuid; ta uuid; tb uuid; v_mid uuid;
  v_1 int; v_2 int; i int;
begin
  -- En egen liga, så den ikke forstyrrer fixturens seasons/teams.
  insert into public.leagues (name) values ('Spøgelsesligaen') returning id into lg;
  insert into public.seasons (league_id, name) values (lg, '2025/26') returning id into sn;
  insert into public.teams (league_id, name) values (lg, 'Spøgelse A') returning id into ta;
  insert into public.teams (league_id, name) values (lg, 'Spøgelse B') returning id into tb;
  -- 2026-01-06 er en tirsdag, altså sin egen rundes eneste kampdag, og den
  -- ligger langt uden for både grace-vinduet og fixturens egen runde.
  insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
    values (sn, ta, tb, '2026-01-06 19:00:00+00', 1, 0);

  -- Kaldes med grace 0, altså den strengeste udgave.
  select public.generate_stories_catchup(0) into v_1;
  select public.generate_stories_catchup(0) into v_2;

  if v_1 <> 0 or v_2 <> 0 then
    raise exception 'FEJL 17a: bagstopperen forsøgte en runde, der aldrig kan give en historie (% og % forsøg)', v_1, v_2;
  end if;

  -- Og runden fik naturligvis ikke et kort — den kunne jo ikke.
  if exists (select 1 from public.stories where period = 'round' and round_key = '2026-01-06') then
    raise exception 'FEJL 17b: spøgelsesrunden fik et kort';
  end if;

  -- MODPRØVEN, uden hvilken 17a ville være opfyldt af en løkke, der aldrig kører
  -- overhovedet: gives runden ét scoret tip, ER den en kandidat igen.
  insert into public.predictions (user_id, match_id, pred_home, pred_away)
  select '00000000-0000-0000-0000-000000000001',
         m.id, 1, 0
    from public.matches m
   where m.season_id = sn;
  select public.generate_stories_catchup(0) into v_1;
  if v_1 <> 1 then
    raise exception 'FEJL 17c: en runde MED et scoret tip blev ikke forsøgt (% forsøg) — betingelsen er for stram', v_1;
  end if;

  -- (d) LOFTET. Betingelsen og loftet er to halvdele af samme kur, og et loft,
  -- man aldrig har set holde, er en formodning: fixturen havde ÉN kvalificerende
  -- runde, så `limit 20` kunne slettes uden at én påstand blev rød. Her er
  -- enogtyve — kvalificerede, men hver med sin egen uge — og kaldet skal svare
  -- nøjagtig 20. Enogtyve fordi tallet skal ligge ÉN over loftet: tyve ville
  -- være opfyldt af både et loft på 20 og slet intet loft.
  for i in 1..21 loop
    insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
      values (sn, ta, tb, ('2025-09-02'::date + (7 * i))::timestamptz + interval '19 hours', 2, 1)
      returning id into v_mid;
    insert into public.predictions (user_id, match_id, pred_home, pred_away)
      values ('00000000-0000-0000-0000-000000000001', v_mid, 2, 1);
  end loop;

  select public.generate_stories_catchup(0) into v_1;
  if v_1 <> 20 then
    raise exception 'FEJL 17d: bagstopperen forsøgte % runder, forventede loftet på 20', v_1;
  end if;

  -- (e) LOFTET ER ET LOFT OG IKKE NUL. Uden denne ville et `limit 0` også bestå
  -- 17d. Næste kald tager 20 igen — og dét tal er selv en oplysning: de tyve
  -- runder fik ikke et kort, fordi de ikke KAN få et (tipperen er i ingen
  -- konkurrence, og ingen global regel udløser), så de kvalificerer sig igen.
  --
  -- **Sådan blev det opdaget, at løkken ikke er selvafsluttende.** Påstanden her
  -- forventede oprindeligt 1 — altså at efterslæbet drænes — og den var forkert.
  -- Betingelsen ovenfor er nødvendig, ikke tilstrækkelig; det er loftet, der
  -- gør prisen endelig. Se begrundelsen i sql/story_engine_v2.sql.
  select public.generate_stories_catchup(0) into v_2;
  if v_2 <> 20 then
    raise exception 'FEJL 17e: næste kørsel tog % runder, forventede loftet på 20 igen', v_2;
  end if;
end $$;

-- ---------- 18. Den PERSONLIGE kampdag (A39) ----------
-- REGRESSIONEN FRA 9. AUGUST 2026. Kravet "dagens sidste kamp er færdigspillet"
-- lå kun i matches-triggeren, mens `generate_daily_stories()` selv aldrig
-- spurgte. Bagstopperens dagsløkke filtrerer pr. KAMP (`home_score is not
-- null`), så én færdigspillet kamp kvalificerede hele dagen, og et kort med
-- "Dagens facit" og "Du sluttede dagen som nr. 2 af 6" blev udgivet kl. 18.03,
-- mens dagens næste kamp stadig kørte. Tallene var beregnet på en halv dag.
--
-- Testen står SIDST, fordi den gør fixturens tirsdag ufuldstændig, og påstand
-- 0c kræver det modsatte. Rækkefølgen er derfor bindende.
--
-- **TRIN 4 ER SELVE REGRESSIONEN.** Trin 3 ville have bestået også før
-- rettelsen, hvis triggeren havde været indlæst — men den er ikke, og den var
-- heller ikke vejen ind. Bagstopperen var. En test, der kun kaldte motoren
-- direkte, ville bevise noget, der aldrig var i tvivl.
--
-- **TRIN 5 ER LIGE SÅ NØDVENDIG.** Uden modprøven ville 18a-18b være opfyldt af
-- en motor, der var holdt op med at skrive overhovedet — nøjagtig den slags
-- tavshed, hele denne fils punkt 1 findes for.
--
-- 🔴 **BLOKKEN ER SKREVET OM MED `A39` (august 2026), OG PÅSTANDEN ER VENDT.**
-- Indtil da påstod 18c/18d, at en ufuldstændig dag gav NUL kort — for alle.
-- Prædikatet var globalt, så det var sandt. Efter den personlige kampdag er en
-- dag ikke længere færdig eller ufærdig; den er færdig FOR NOGEN. Den åbne kamp
-- lægges derfor kun i `c1`, og påstanden er nu tvedelt: u4/u5 (kun c1) og
-- u1/u2/u3 (begge) får INTET, mens u6/u7 (kun c2) får hver ét.
--
-- **Den gamle påstand ville stadig bestå med en motor, der havde glemt A39
-- helt** — nul kort er nul kort. Det er derfor, den todelte form er nødvendig:
-- den kan kun opfyldes af en motor, der skelner.
--
-- Regressionen fra 9. august er stadig dækket, og trin 4 er stadig selve den:
-- bagstopperen var vejen ind, og en test, der kun kaldte motoren direkte, ville
-- bevise noget, der aldrig var i tvivl.
do $$
declare
  v_sn uuid; v_ta uuid; v_tb uuid; v_mid uuid; v_n int; v_før int;
  v_klar int; v_omfang int; v_id6 uuid; v_id7 uuid;
  u4 uuid := '00000000-0000-0000-0000-000000000004';
  u6 uuid := '00000000-0000-0000-0000-000000000006';
  u7 uuid := '00000000-0000-0000-0000-000000000007';
begin
  select id into v_sn from public.seasons
   where league_id = (select id from public.leagues where name = 'Testliga');
  select id into v_ta from public.teams where name = 'Vejle';
  select id into v_tb from public.teams where name = 'Lyngby';

  select count(*) into v_før from public.stories
   where period = 'day' and day_key = '2026-03-03';
  if v_før = 0 then
    raise exception 'FEJL 18a: tirsdagen havde ingen kort at fjerne — fixturen er ikke, hvad testen tror';
  end if;
  delete from public.stories where period = 'day' and day_key = '2026-03-03';

  -- En femte kamp på tirsdagen UDEN resultat. Samme runde, så torsdagen
  -- (2026-03-05) forbliver rundens sidste kampdag, og tirsdagen derfor stadig
  -- er en dag, der SKAL kunne få et kort — når den bliver færdig.
  insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at)
    values (v_sn, v_ta, v_tb, '2026-03-03 16:00:00+00') returning id into v_mid;
  insert into public.competition_matches (competition_id, match_id)
    values ('10000000-0000-0000-0000-000000000001', v_mid);

  if public.match_day_complete('2026-03-03') then
    raise exception 'FEJL 18b: dagen meldes komplet, selvom en kamp mangler resultat';
  end if;

  -- (2b) PRÆDIKATET SELV, og den billigste påstand i blokken. Den fejler først,
  -- hvis afgrænsningen driver — fx hvis nogen afgrænser til de TIPPEDE kampe i
  -- stedet for til konkurrencens. u4 er kun i c1 og skal have en åben kamp; u6
  -- er kun i c2 og skal være klar med præcis fixturens seks kampe... nej, fem:
  -- m6 er torsdag, m5 onsdag, så tirsdagen er m1-m4 = fire kampe.
  select count(*) into v_klar from public.users_with_complete_day('2026-03-03');
  if v_klar <> 2 then
    raise exception 'FEJL 18b2: % brugere meldes klar, forventede 2 (u6 og u7)', v_klar;
  end if;
  if exists (select 1 from public.users_with_complete_day('2026-03-03') u where u.user_id = u4) then
    raise exception 'FEJL 18b3: u4 meldes klar, men hendes egen konkurrence c1 har en åben kamp';
  end if;
  select u.n_matches into v_omfang
    from public.users_with_complete_day('2026-03-03') u where u.user_id = u6;
  if v_omfang <> 4 then
    raise exception 'FEJL 18b4: u6s dagsomfang er %, forventede 4 (m1-m4)', v_omfang;
  end if;

  -- (3) Direkte kald til motoren. TVEDELT PÅSTAND: u6/u7 får hver ét kort,
  -- alle andre intet.
  perform public.generate_daily_stories('2026-03-03');
  select count(*) into v_n from public.stories
   where period = 'day' and day_key = '2026-03-03';
  if v_n <> 2 then
    raise exception 'FEJL 18c: motoren udgav % kort, forventede 2 (u6 og u7)', v_n;
  end if;
  if exists (select 1 from public.stories s
              where s.period = 'day' and s.day_key = '2026-03-03'
                and s.user_id not in (u6, u7)) then
    raise exception 'FEJL 18c2: en bruger, hvis egen dag stadig spilles, fik et kort';
  end if;

  -- (4) Bagstopperen — vejen, kortet faktisk kom ad 9. august. Den skal nå
  -- SAMME resultat og må hverken skrive mere eller mindre.
  perform public.generate_stories_catchup(0);
  select count(*) into v_n from public.stories
   where period = 'day' and day_key = '2026-03-03';
  if v_n <> 2 then
    raise exception 'FEJL 18d: bagstopperen bragte antallet til %, forventede 2', v_n;
  end if;

  -- (4b) …og den skal DRÆNE. Klasse 2 kvalificerer kun dagen, så længe en klar
  -- bruger mangler sit kort; u6 og u7 har deres nu. Uden denne påstand ville
  -- endelighedsargumentet i #68 være en formodning.
  select id into v_id6 from public.stories
   where period = 'day' and day_key = '2026-03-03' and user_id = u6;
  select id into v_id7 from public.stories
   where period = 'day' and day_key = '2026-03-03' and user_id = u7;
  perform public.generate_stories_catchup(0);
  if not exists (select 1 from public.stories
                  where period = 'day' and day_key = '2026-03-03'
                    and user_id = u6 and id = v_id6) then
    raise exception 'FEJL 18d2: bagstopperen skrev u6s kort om, selvom intet var ændret';
  end if;

  -- (5) MODPRØVEN: dagen bliver færdig for alle, og resten af kortene kommer.
  update public.matches set home_score = 1, away_score = 1 where id = v_mid;
  if not public.match_day_complete('2026-03-03') then
    raise exception 'FEJL 18e: dagen meldes stadig ufuldstændig, efter sidste resultat er inde';
  end if;
  perform public.generate_daily_stories('2026-03-03');
  select count(*) into v_n from public.stories
   where period = 'day' and day_key = '2026-03-03';
  if v_n = 0 then
    raise exception 'FEJL 18f: den færdige dag gav ingen kort — værnet lukker mere end den skal';
  end if;
  if v_n <> 7 then
    raise exception 'FEJL 18f2: den færdige dag gav % kort, forventede 7', v_n;
  end if;

  -- (6) A'S KORT OVERLEVER B'S KØRSEL — den påstand, hele forliget findes for.
  -- `id`-lighed er den ENESTE form, der kan skelne "kortet overlevede" fra
  -- "kortet blev slettet og skrevet identisk igen", og det er netop dén forskel,
  -- `dismissed_at` og ulæst-prikken kan mærke. Uden den ville den gamle globale
  -- delete bestå hver eneste påstand ovenfor.
  if not exists (select 1 from public.stories
                  where period = 'day' and day_key = '2026-03-03'
                    and user_id = u6 and id = v_id6) then
    raise exception 'FEJL 18g: u6s kort fra den halve dag blev slettet, da u1-u5 fik deres';
  end if;
  if not exists (select 1 from public.stories
                  where period = 'day' and day_key = '2026-03-03'
                    and user_id = u7 and id = v_id7) then
    raise exception 'FEJL 18g2: u7s kort fra den halve dag blev slettet, da u1-u5 fik deres';
  end if;
end $$;

-- ---------- 19. Forliget: ingen churn, men en rettelse skriver stadig om ----------
-- **DEN HYPPIGSTE KØRSEL EFTER A39 ER DEN, DER INTET ÆNDRER.** Motoren kaldes
-- nu ved hvert slutfløjt, der gør nogens dag færdig — fire-fem gange på en stor
-- lørdag frem for én. Skrev den dagens rækker om hver gang, ville en bruger,
-- hvis tal ikke havde flyttet sig siden kl. 16, få nyt `id`, nyt `created_at`
-- og et tabt `dismissed_at` ved hver af dem. Frysningen fanger det IKKE: hendes
-- dag voksede jo ikke. Det er forliget, der fanger det.
--
-- **19b ER MODPRØVEN OG LIGE SÅ NØDVENDIG SOM 19a.** Uden den ville 19a være
-- opfyldt af en motor, der var holdt op med at skrive — igen den tavshed, hele
-- filens punkt 1 findes for. En resultatrettelse SKAL stadig nå frem.
do $$
declare
  v_foer text; v_efter text; v_rettet int;
begin
  select string_agg(id::text || ':' || created_at::text, ',' order by user_id)
    into v_foer from public.stories where period = 'day' and day_key = '2026-03-03';

  perform public.generate_daily_stories('2026-03-03');

  select string_agg(id::text || ':' || created_at::text, ',' order by user_id)
    into v_efter from public.stories where period = 'day' and day_key = '2026-03-03';
  if v_foer is distinct from v_efter then
    raise exception 'FEJL 19a: en gen-kørsel uden ændringer skrev dagens kort om';
  end if;

  -- (19b) MODPRØVEN: en resultatrettelse på dagen skal nå frem. m1 var 2-1 og
  -- bliver 5-0 — u1s CONTRARIAN falder, og kortene skal blive andre.
  update public.matches set home_score = 5, away_score = 0
   where kickoff_at = '2026-03-03 12:00:00+00';
  perform public.generate_daily_stories('2026-03-03');

  select count(*) into v_rettet from public.stories s
   where s.period = 'day' and s.day_key = '2026-03-03'
     and s.id::text || ':' || s.created_at::text <> all (string_to_array(v_efter, ','));
  if v_rettet = 0 then
    raise exception 'FEJL 19b: en resultatrettelse ændrede intet kort — forliget skriver aldrig';
  end if;
end $$;

-- ---------- 20. Frysningen: en dag, der VOKSER, rører ikke det udgivne kort ----------
-- **DEN FÆLDE, A39 SELV ÅBNER.** Den globale kampdag gjorde det umuligt for en
-- allerede skrevet dag at vokse: en kamp kl. 20 blokerede alle. Den personlige
-- gør det muligt — jeg opretter en konkurrence om aftenen, jeg melder mig ind i
-- en, eller en anden melder sig ind i min — og uden frysningen ville kortet
-- blive skrevet om, min afvisning genopstå og ulæst-prikken tændes igen.
--
-- 20b ER IKKE PYNT: uden den ville 20a være opfyldt af en motor, der er holdt op
-- med at skrive overhovedet. u7 er ikke i c3, hendes omfang er uændret, og
-- hendes kort skal derfor være urørt af nøjagtig samme grund — men ad en anden
-- vej. De to sammen kan kun opfyldes af en motor, der skelner.
do $$
declare
  v_sn uuid; v_ta uuid; v_tb uuid; v_mid uuid;
  v_id6 uuid; v_id7 uuid; v_scope int; v_omfang int;
  c3 uuid := '10000000-0000-0000-0000-000000000003';
  u6 uuid := '00000000-0000-0000-0000-000000000006';
  u7 uuid := '00000000-0000-0000-0000-000000000007';
begin
  select id into v_sn from public.seasons
   where league_id = (select id from public.leagues where name = 'Testliga');
  select id into v_ta from public.teams where name = 'Randers';
  select id into v_tb from public.teams where name = 'OB';

  select id, (payload ->> 'day_scope_matches')::int into v_id6, v_scope
    from public.stories where period = 'day' and day_key = '2026-03-03' and user_id = u6;
  select id into v_id7
    from public.stories where period = 'day' and day_key = '2026-03-03' and user_id = u7;
  if v_scope is null then
    raise exception 'FEJL 20a0: kortet bærer ingen day_scope_matches — frysningen har intet at måle mod';
  end if;

  -- En SPILLET kamp på tirsdagen i en helt ny konkurrence, som u6 melder sig
  -- ind i. Hendes dag er stadig færdig — den er bare blevet større.
  insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
    values (v_sn, v_ta, v_tb, '2026-03-03 17:00:00+00', 2, 0) returning id into v_mid;
  insert into public.competitions (id, name, mode) values (c3, 'Aftenkonkurrencen', 'custom');
  insert into public.competition_matches (competition_id, match_id) values (c3, v_mid);
  insert into public.competition_participants (competition_id, user_id) values (c3, u6);

  select u.n_matches into v_omfang
    from public.users_with_complete_day('2026-03-03') u where u.user_id = u6;
  if v_omfang is null then
    raise exception 'FEJL 20a1: u6s dag meldes ufærdig, men den nye kamp ER spillet';
  end if;
  if v_omfang <= v_scope then
    raise exception 'FEJL 20a2: u6s omfang er % og kortet står på % — dagen voksede ikke, og testen måler ingenting', v_omfang, v_scope;
  end if;

  perform public.generate_daily_stories('2026-03-03');

  if not exists (select 1 from public.stories
                  where period = 'day' and day_key = '2026-03-03'
                    and user_id = u6 and id = v_id6) then
    raise exception 'FEJL 20a: u6s kort blev skrevet om, fordi hendes dag voksede efter udgivelsen';
  end if;
  if (select (payload ->> 'day_scope_matches')::int from public.stories
       where period = 'day' and day_key = '2026-03-03' and user_id = u6) <> v_scope then
    raise exception 'FEJL 20a3: u6s day_scope_matches flyttede sig på et frosset kort';
  end if;
  if not exists (select 1 from public.stories
                  where period = 'day' and day_key = '2026-03-03'
                    and user_id = u7 and id = v_id7) then
    raise exception 'FEJL 20b: u7s kort blev rørt, selvom hendes omfang er uændret';
  end if;
end $$;

-- ---------- 21. Milepælskapringen bevarer frysningens nøgle ----------
-- `apply_milestone_stories()` UPDATE'r et færdigt dagskort i stedet for at lægge
-- et til, og den skriver `payload = (payload - 'mini') || …`. Nøglen overlever
-- derfor pr. konstruktion — men "pr. konstruktion" er præcis den slags påstand,
-- der holder op med at være sand, når nogen omskriver udtrykket. Uden nøglen
-- ville et kapret kort blive UFRYSBART: `coalesce(null, n) < n` er falsk, så det
-- ville blive skrevet om, hver gang dagen voksede.
do $$
declare
  u6 uuid := '00000000-0000-0000-0000-000000000006';
  v_scope int;
begin
  select (payload ->> 'day_scope_matches')::int into v_scope
    from public.stories where period = 'day' and day_key = '2026-03-03' and user_id = u6;

  insert into public.milestones (user_id, key, family, tier, achieved_at)
    values (u6, 'TIPS_500', 'community', 1, '2026-03-03 20:00:00+00')
    on conflict do nothing;
  perform public.apply_milestone_stories(200000);

  if not exists (select 1 from public.stories
                  where period = 'day' and day_key = '2026-03-03'
                    and user_id = u6 and rule = 'MILESTONE') then
    raise exception 'FEJL 21a: milepælen kaprede ikke u6s dagskort — testen måler ingenting';
  end if;
  if (select (payload ->> 'day_scope_matches')::int from public.stories
       where period = 'day' and day_key = '2026-03-03' and user_id = u6)
     is distinct from v_scope then
    raise exception 'FEJL 21b: kapringen tabte day_scope_matches — kortet er blevet ufrysbart';
  end if;
end $$;

-- ---------- 22. STREAK_STATUS: reglen, der aldrig havde kørt (G143) ----------
-- **DEN ENESTE AF DE OTTE DAGSREGLER UDEN ÉN ENESTE KØRSEL — hverken i
-- produktionen eller her.** Blok 16 ovenfor siger det selv om sin egen fixture:
-- "fixturen udgiver kun DAY_RESULT, DAY_TOP og MILESTONE, så DUEL, SO_CLOSE,
-- CONTRARIAN, COLLECTIVE_MISS og STREAK_STATUS kunne stå i nutid uden at én
-- påstand blev rød". `A33`-aflæsningen 21. august 2026 gjorde den observation
-- til et spørgsmål: død kode eller bare uden anledning?
--
-- **Svaret er: ikke død — men systematisk domineret**, og begge halvdele skal
-- være påstande, ellers kan den næste ændring flytte dem uden at nogen ser det.
--
-- Fixturen bor i sin EGEN konkurrence og sin egen liga, fordi den kræver noget,
-- ingen af de andre blokke har: en ubrudt række kampe med point for den samme
-- bruger. Lægges den oven på fixturen ovenfor, ændrer den de dage, blok 1-21
-- måler på.
--
-- 22a) Reglen udløser og VINDER, når intet andet sker den dag — og den når både
--      hovedpersonen og en fan-out-modtager. Det er beviset for, at den ikke er
--      død kode.
-- 22b) **Den taber ALTID til `DAY_TOP` for samme bruger samme dag**, og det er
--      ikke en tilfældighed i tallene, men en konstruktion: `STREAK_STATUS` har
--      `competition_id = null`, så `_sd_mag`-joinet (flytning + over
--      gennemsnittet) rammer ingen række, og den får KUN stime-bonussen som
--      størrelsesbidrag. `DAY_TOP` får den SAMME bonus plus flytning og
--      over-snit — og har 6 points højere grundvægt. Dens score er dermed
--      punkt for punkt større.
do $$
declare
  s1 uuid := 'ddddddd1-0000-4000-8000-000000000001';
  s2 uuid := 'ddddddd2-0000-4000-8000-000000000002';
  s3 uuid := 'ddddddd3-0000-4000-8000-000000000003';
  lg uuid; sn uuid; ta uuid; tb uuid; cp uuid; mid uuid;
  d date; i int; j int;
  v_rule text; v_nv int; v_toer int; v_third boolean;
begin
  insert into auth.users (id) values (s1), (s2), (s3);
  insert into public.profiles (id, display_name) values (s1,'Stine'), (s2,'Steen'), (s3,'Sara');
  insert into public.leagues (name) values ('Stimeligaen') returning id into lg;
  insert into public.seasons (league_id, name) values (lg, '25/26') returning id into sn;
  insert into public.teams (league_id, name) values (lg, 'SH') returning id into ta;
  insert into public.teams (league_id, name) values (lg, 'SU') returning id into tb;
  insert into public.competitions (name, mode) values ('Stimekonkurrencen','custom') returning id into cp;
  insert into public.competition_participants (competition_id, user_id) values (cp,s1),(cp,s2),(cp,s3);

  -- TO kampe pr. dag i seks dage (2026-04-07 … 2026-04-12). To er `DAY_TOP`s
  -- eget krav (`matches >= 2`), og uden dem kan 22b ikke stilles.
  -- Alle kampe ender 2-0; alle tre rammer udfaldet hver gang, så alle tre har en
  -- levende stime, og ingen skiller sig ud på point.
  for i in 0..5 loop
    d := date '2026-04-07' + i;
    for j in 1..2 loop
      insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score)
        values (sn, ta, tb, d::timestamptz + interval '17 hours' + (j || ' hours')::interval, 2, 0)
        returning id into mid;
      insert into public.competition_matches (competition_id, match_id) values (cp, mid);
      insert into public.predictions (user_id, match_id, pred_home, pred_away) values (s1, mid, 3, 0);
      insert into public.predictions (user_id, match_id, pred_home, pred_away) values (s2, mid, 4, 0);
      insert into public.predictions (user_id, match_id, pred_home, pred_away) values (s3, mid, 5, 0);
    end loop;
  end loop;
  -- En kamp UDEN resultat dagen efter, så 2026-04-12 ikke er rundens sidste
  -- kampdag — ellers udgiver motoren kun rundekortet og skriver intet dagskort.
  insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at)
    values (sn, ta, tb, (date '2026-04-13')::timestamptz + interval '18 hours');

  perform public.generate_daily_stories(date '2026-04-12');

  -- 22a) Hovedpersonen får stimekortet, og reglen er dermed ikke død kode.
  select rule, news_value into v_rule, v_nv
    from public.stories where period = 'day' and day_key = '2026-04-12' and user_id = s1;
  if v_rule is distinct from 'STREAK_STATUS' then
    raise exception 'FEJL 22a: stimen vandt ikke på en dag, hvor intet andet skete — fik %', coalesce(v_rule,'INTET KORT');
  end if;
  -- 28 (grundvægt) + 12 (stime-bonus, klippet ved 12) + 20 (nærhed) = 60.
  -- Ændres ét af de tre tal, er det HER det skal ses.
  if v_nv <> 60 then
    raise exception 'FEJL 22a2: stimekortets news_value skulle være 28 + 12 + 20 = 60, fik %', v_nv;
  end if;
  if not exists (select 1 from public.stories
                  where period = 'day' and day_key = '2026-04-12' and user_id = s2
                    and rule = 'STREAK_STATUS') then
    raise exception 'FEJL 22a3: stimen nåede ikke en fan-out-modtager — competition_id er null, og _sd_reach skal alligevel finde vejen';
  end if;

  -- 22b) Nu gøres Stine alene om dagens højeste: hendes tips den 12. bliver
  -- PRÆCISE (3 point), de andres bliver ved med at være udfaldet (1 point).
  -- Stimen er uændret levende — det eneste, der ændrer sig, er, at DAY_TOP nu
  -- også har en kandidat.
  update public.predictions p set pred_home = 2, pred_away = 0
    from public.matches m
   where m.id = p.match_id and m.match_day = date '2026-04-12' and p.user_id = s1;

  perform public.generate_daily_stories(date '2026-04-12');

  select rule, news_value, (payload ->> 'runner_up_value')::int, (payload ->> 'third')::boolean
    into v_rule, v_nv, v_toer, v_third
    from public.stories where period = 'day' and day_key = '2026-04-12' and user_id = s1;
  if v_rule is distinct from 'DAY_TOP' then
    raise exception 'FEJL 22b: DAY_TOP skal slå stimen for samme bruger samme dag — fik %', coalesce(v_rule,'INTET KORT');
  end if;
  if v_toer is distinct from 60 then
    raise exception 'FEJL 22b2: stimen skulle stå som toer med 60, fik % — er den slet ikke kandidat, måler 22b ingenting', v_toer;
  end if;
  if v_nv <= v_toer then
    raise exception 'FEJL 22b3: DAY_TOP (%) skal være strengt større end stimen (%)', v_nv, v_toer;
  end if;

  -- 22c) 💤-GRENEN ER NÆSTEN UNÅELIG, og det er en fejl i sig selv (`G144`).
  -- Reglens egen kommentar siger, den fyrer "når stimen blev forlænget i dag
  -- ELLER BRUDT I DAG". Men `_sd_streak` filtrerer `where hit and ended_day =
  -- p_day`, og en stime, der brød dagen EFTER, har `ended_day` = i går. Sara
  -- misser begge kampe den 13., og hendes stime på 12 får aldrig et kort.
  update public.matches set home_score = 2, away_score = 0 where match_day = date '2026-04-13';
  insert into public.predictions (user_id, match_id, pred_home, pred_away)
  select s3, m.id, 0, 2 from public.matches m where m.match_day = date '2026-04-13';
  insert into public.competition_matches (competition_id, match_id)
  select cp, m.id from public.matches m where m.match_day = date '2026-04-13'
  on conflict do nothing;
  -- De to andre skal også have tippet, ellers er dagen ikke sammenlignelig.
  insert into public.predictions (user_id, match_id, pred_home, pred_away)
  select s1, m.id, 3, 0 from public.matches m where m.match_day = date '2026-04-13';
  insert into public.predictions (user_id, match_id, pred_home, pred_away)
  select s2, m.id, 4, 0 from public.matches m where m.match_day = date '2026-04-13';
  -- Endnu en dag uden resultat, så den 13. ikke er rundens sidste kampdag.
  insert into public.matches (season_id, home_team_id, away_team_id, kickoff_at)
    values (sn, ta, tb, (date '2026-04-14')::timestamptz + interval '18 hours');

  perform public.generate_daily_stories(date '2026-04-13');

  select rule into v_rule
    from public.stories where period = 'day' and day_key = '2026-04-13' and user_id = s3;
  if v_rule = 'STREAK_STATUS' then
    raise exception 'FEJL 22c: 💤-grenen er blevet nåelig — G144 er rettet, og denne påstand skal vendes om';
  end if;
end $$;

\echo 'story_engine_daily: alle påstande holdt'
