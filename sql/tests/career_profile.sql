-- Test af karriereprofilens indbyrdes opgør (sql/career_profile.sql, G107).
--
-- Kører mod PRODUKTIONSSKEMAET (`node sql/tests/_schema.mjs`) og gen-kører
-- derefter `career_profile.sql`. Rører aldrig produktion.
--
-- HVORFOR PRODUKTIONSSKEMAET OG IKKE ET MINISKEMA
-- Funktionen læser ni tabeller og fire views i ét kald, og reglen, testen måler,
-- ligger i samspillet mellem `competition_participants.joined_at`,
-- `competition_matches` og `match_lock_at()`. Et miniskema ville skulle bygge
-- halvdelen af produktet i hånden.
--
-- HVAD DEN BEVISER
--   1. Et møde tæller kun, hvis kampen låste EFTER BEGGE meldte sig til. Én
--      runde, den ene ikke var med i, er ikke et møde — den forsvinder både i
--      antallet og i sejrsregnskabet.
--   2. Grænsen er skarp og ligger ved LÅSEN (en time før kickoff), ikke ved
--      kickoff, og den måles mod `greatest()` af de to tilmeldinger: den
--      SENESTE af parret afgør.
--   3. 🔴 **Invarianten fra spec'ens testcase 41:** `rivals`-posten om en person
--      og `h2h`-linjen på den persons profil svarer det SAMME på samme
--      spørgsmål, spejlvendt. To steder i produktet må ikke svare forskelligt —
--      det er hele grunden til, at de to blokke skal rettes sammen.
--   4. Opgøret er stadig BREDT på den ene led, der er tilsigtet: en kamp, begge
--      kunne tippe, tæller, uanset om gættet blev afgivet i den delte
--      konkurrence eller i en anden (`predictions` er én række pr. bruger pr.
--      kamp). Nulpunktet afgrænser ADGANGEN, ikke gættets oprindelse.
--   5. Dedup'en pr. kamp er uændret: to delte konkurrencer, der dækker samme
--      kamp, giver ét møde og ikke to — og nulpunktet måles FØR dedup'en, så en
--      kamp tæller, hvis den kvalificerer i mindst én af dem.
--   6. Filen er idempotent.
--
-- HVAD DEN **IKKE** GØR, OG HVORFOR (§13)
-- Den måler ikke før-tilstanden — altså at det brede tal ville tælle den runde,
-- den ene ikke var med i. Før-tilstanden ville skulle læses af `sql/schema.sql`,
-- og dumpet skifter side, i det øjeblik skema-eksporten kører; påstanden ville
-- da måle sig selv. Præcis den fælde har kostet tid tre gange (`G94`, `G98`).
-- At testen er set fejle, er i stedet sikret med mutationer.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d cp -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d cp -v ON_ERROR_STOP=1 -b -f sql/tests/career_profile.sql

\set ON_ERROR_STOP on
\timing off

\ir ../career_profile.sql

-- Kald funktionen som en bestemt bruger (RPC'et kræver `auth.uid()`).
create function pg_temp.profil(p_viewer uuid, p_om uuid) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  perform set_config('test.uid', p_viewer::text, true);
  select public.career_profile(p_om) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- ÉN delt konkurrence, TRE kampe i hver sin runde, og TO spillere med
-- forskellige tilmeldingstidspunkter.
--
--   KAMP_1  kickoff 06-07 18.00Z  ⇒ låser 17.00Z   — kun ANNA var med
--   KAMP_2  kickoff 13-07 18.00Z  ⇒ låser 17.00Z   — begge var med
--   KAMP_3  kickoff 20-07 18.00Z  ⇒ låser 17.00Z   — begge var med
--
--   ANNA meldt til 01-06                — før alle tre låse
--   BO   meldt til 06-07 17.00:00Z      — PRÆCIS i KAMP_1's låsesekund
--
-- Gættene er lagt, så det brede tal og det rigtige tal IKKE er ens: Anna vinder
-- KAMP_1's runde, Bo vinder KAMP_2's, og KAMP_3 bliver uafgjort. Med
-- nulpunktet er stillingen derfor 0-1-1 set fra Anna (ét møde tabt, ét delt) —
-- uden det ville den være 1-1-1. Både antallet OG udfaldet flytter sig, så en
-- halv rettelse ikke kan snige sig igennem.
insert into auth.users (id, email) values
  ('71070000-0000-4000-8000-00000000000a', 'anna@test.local'),
  ('71070000-0000-4000-8000-00000000000b', 'bo@test.local');
insert into public.profiles (id, display_name) values
  ('71070000-0000-4000-8000-00000000000a', 'Anna'),
  ('71070000-0000-4000-8000-00000000000b', 'Bo');

insert into public.leagues (id, name) values
  ('71070000-0000-4000-8000-000000000101', 'Testligaen');
insert into public.seasons (id, league_id, name) values
  ('71070000-0000-4000-8000-000000000201', '71070000-0000-4000-8000-000000000101', '2026/27');
insert into public.teams (id, league_id, name) values
  ('71070000-0000-4000-8000-000000000301', '71070000-0000-4000-8000-000000000101', 'Hjemme'),
  ('71070000-0000-4000-8000-000000000302', '71070000-0000-4000-8000-000000000101', 'Ude');

insert into public.matches (id, season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score) values
  ('71070000-0000-4000-8000-000000000401', '71070000-0000-4000-8000-000000000201',
   '71070000-0000-4000-8000-000000000301', '71070000-0000-4000-8000-000000000302',
   '2026-07-06T18:00:00Z', 2, 1),
  ('71070000-0000-4000-8000-000000000402', '71070000-0000-4000-8000-000000000201',
   '71070000-0000-4000-8000-000000000301', '71070000-0000-4000-8000-000000000302',
   '2026-07-13T18:00:00Z', 2, 1),
  ('71070000-0000-4000-8000-000000000403', '71070000-0000-4000-8000-000000000201',
   '71070000-0000-4000-8000-000000000301', '71070000-0000-4000-8000-000000000302',
   '2026-07-20T18:00:00Z', 2, 1);

insert into public.competitions (id, name, mode, created_by) values
  ('71070000-0000-4000-8000-000000000501', 'Delt', 'full_season',
   '71070000-0000-4000-8000-00000000000a');
insert into public.competition_matches (competition_id, match_id) values
  ('71070000-0000-4000-8000-000000000501', '71070000-0000-4000-8000-000000000401'),
  ('71070000-0000-4000-8000-000000000501', '71070000-0000-4000-8000-000000000402'),
  ('71070000-0000-4000-8000-000000000501', '71070000-0000-4000-8000-000000000403');

insert into public.competition_participants (competition_id, user_id, joined_at) values
  ('71070000-0000-4000-8000-000000000501', '71070000-0000-4000-8000-00000000000a', '2026-06-01T00:00:00Z'),
  ('71070000-0000-4000-8000-000000000501', '71070000-0000-4000-8000-00000000000b', '2026-07-06T17:00:00Z');

-- KAMP_1: Anna præcist (3), Bo kun udfaldet (1)  → Anna ville vinde runden
-- KAMP_2: Anna kun udfaldet (1), Bo præcist (3)  → Bo vinder runden
-- KAMP_3: begge præcist (3/3)                    → uafgjort
insert into public.predictions (user_id, match_id, pred_home, pred_away) values
  ('71070000-0000-4000-8000-00000000000a', '71070000-0000-4000-8000-000000000401', 2, 1),
  ('71070000-0000-4000-8000-00000000000b', '71070000-0000-4000-8000-000000000401', 3, 1),
  ('71070000-0000-4000-8000-00000000000a', '71070000-0000-4000-8000-000000000402', 3, 1),
  ('71070000-0000-4000-8000-00000000000b', '71070000-0000-4000-8000-000000000402', 2, 1),
  ('71070000-0000-4000-8000-00000000000a', '71070000-0000-4000-8000-000000000403', 2, 1),
  ('71070000-0000-4000-8000-00000000000b', '71070000-0000-4000-8000-000000000403', 2, 1);

-- ---------------------------------------------------------------------------
-- 1 + 2. H2H bærer begge siders nulpunkt
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  -- Anna ser Bos profil. Kun de to runder, BEGGE kunne tippe, er møder.
  v := pg_temp.profil('71070000-0000-4000-8000-00000000000a',
                      '71070000-0000-4000-8000-00000000000b') -> 'h2h';
  if v is null then
    raise exception 'h2h skal findes: de deler en konkurrence og har fælles afgjorte runder';
  end if;
  if (v->>'meetings')::int <> 2 then
    raise exception 'KAMP_1 låste i Bos tilmeldingssekund og er ikke et møde — ventede 2, fik %',
      v->>'meetings';
  end if;
  -- Udfaldet flytter sig med: uden nulpunktet ville Anna have 1 sejr fra en
  -- runde, Bo aldrig kunne være med i.
  if (v->>'wins')::int <> 0 or (v->>'losses')::int <> 1 or (v->>'draws')::int <> 1 then
    raise exception 'ventede 0-1-1 set fra Anna, fik %-%-%',
      v->>'wins', v->>'losses', v->>'draws';
  end if;
  raise notice 'OK 1+2: h2h tæller kun runder, begge kunne tippe, og grænsen ligger ved låsen';
end $$;

-- ---------------------------------------------------------------------------
-- 2b. Grænsen er skarp: ét sekund tidligere, og KAMP_1 er et møde
-- ---------------------------------------------------------------------------
-- Samme fixtur, ét sekund flyttet. Er leddet `>=` frem for `>`, eller måles der
-- mod kickoff frem for låsen, svarer begge grene ens, og påstanden fejler.
do $$
declare v jsonb;
begin
  update public.competition_participants set joined_at = '2026-07-06T16:59:59Z'
   where user_id = '71070000-0000-4000-8000-00000000000b';

  v := pg_temp.profil('71070000-0000-4000-8000-00000000000a',
                      '71070000-0000-4000-8000-00000000000b') -> 'h2h';
  if (v->>'meetings')::int <> 3 then
    raise exception 'ét sekund før låsen skal give tre møder, fik %', v->>'meetings';
  end if;
  if (v->>'wins')::int <> 1 or (v->>'losses')::int <> 1 or (v->>'draws')::int <> 1 then
    raise exception 'ventede 1-1-1 med alle tre runder, fik %-%-%',
      v->>'wins', v->>'losses', v->>'draws';
  end if;

  update public.competition_participants set joined_at = '2026-07-06T17:00:00Z'
   where user_id = '71070000-0000-4000-8000-00000000000b';
  raise notice 'OK 2b: grænsen ligger ved låsen og er skarp';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Invarianten: rivals og h2h svarer det samme
-- ---------------------------------------------------------------------------
-- Tærsklen for en rival er 2 møder, og fixturen giver præcis 2 — altså er Bo
-- lige akkurat en rival, og de to blokke kan sammenlignes. Rettes kun den ene,
-- svarer de forskelligt, og produktet siger to ting om samme forhold.
do $$
declare v_rival jsonb; v_h2h jsonb;
begin
  select r into v_rival
    from jsonb_array_elements(
      pg_temp.profil('71070000-0000-4000-8000-00000000000a',
                     '71070000-0000-4000-8000-00000000000a') -> 'rivals') r
   where r->>'user_id' = '71070000-0000-4000-8000-00000000000b';

  if v_rival is null then
    raise exception 'Bo skal være rival: to møder er præcis tærsklen';
  end if;

  v_h2h := pg_temp.profil('71070000-0000-4000-8000-00000000000a',
                          '71070000-0000-4000-8000-00000000000b') -> 'h2h';

  -- Samme spørgsmål, samme svar. `rivals` er set fra profilens ejer (Anna), og
  -- `h2h` er set fra beskueren (også Anna) — altså skal de være ordret ens.
  if (v_rival->>'meetings') is distinct from (v_h2h->>'meetings')
     or (v_rival->>'wins')   is distinct from (v_h2h->>'wins')
     or (v_rival->>'losses') is distinct from (v_h2h->>'losses')
     or (v_rival->>'draws')  is distinct from (v_h2h->>'draws') then
    raise exception 'rivals og h2h er uenige: rivals=%-%-%/% h2h=%-%-%/%',
      v_rival->>'wins', v_rival->>'losses', v_rival->>'draws', v_rival->>'meetings',
      v_h2h->>'wins',   v_h2h->>'losses',   v_h2h->>'draws',   v_h2h->>'meetings';
  end if;
  raise notice 'OK 3: rivals og h2h svarer det samme på samme spørgsmål';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Nulpunktet afgrænser ADGANGEN, ikke gættets oprindelse
-- ---------------------------------------------------------------------------
-- Bo får en ANDEN konkurrence, som kun han er med i, og som også dækker KAMP_2.
-- Hans gæt er stadig ét og det samme (`predictions` er global pr. kamp), og
-- mødet i KAMP_2's runde skal fortsat tælle. Rammer leddet gættet frem for
-- adgangen, forsvinder mødet her.
do $$
declare v jsonb;
begin
  insert into public.competitions (id, name, mode, created_by) values
    ('71070000-0000-4000-8000-000000000502', 'Bos egen', 'full_season',
     '71070000-0000-4000-8000-00000000000b');
  insert into public.competition_matches (competition_id, match_id) values
    ('71070000-0000-4000-8000-000000000502', '71070000-0000-4000-8000-000000000402');
  insert into public.competition_participants (competition_id, user_id, joined_at) values
    ('71070000-0000-4000-8000-000000000502', '71070000-0000-4000-8000-00000000000b',
     '2026-06-01T00:00:00Z');

  v := pg_temp.profil('71070000-0000-4000-8000-00000000000a',
                      '71070000-0000-4000-8000-00000000000b') -> 'h2h';
  if (v->>'meetings')::int <> 2 then
    raise exception 'en konkurrence, kun den ene er med i, må hverken tilføje eller fjerne møder — fik %',
      v->>'meetings';
  end if;
  raise notice 'OK 4: nulpunktet afgrænser adgangen og ikke gættets oprindelse';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Dedup pr. kamp er uændret
-- ---------------------------------------------------------------------------
-- En ANDEN delt konkurrence, der dækker de samme tre kampe, og som begge er
-- med i fra start. KAMP_1 kvalificerer nu i den ene af de to (Bo var med fra
-- start dér), så mødetallet stiger til 3 — men KAMP_2 og KAMP_3 må ikke tælle
-- dobbelt. Uden dedup'en ville svaret være 5 eller 6.
do $$
declare v jsonb;
begin
  insert into public.competitions (id, name, mode, created_by) values
    ('71070000-0000-4000-8000-000000000503', 'Delt igen', 'full_season',
     '71070000-0000-4000-8000-00000000000a');
  insert into public.competition_matches (competition_id, match_id) values
    ('71070000-0000-4000-8000-000000000503', '71070000-0000-4000-8000-000000000401'),
    ('71070000-0000-4000-8000-000000000503', '71070000-0000-4000-8000-000000000402'),
    ('71070000-0000-4000-8000-000000000503', '71070000-0000-4000-8000-000000000403');
  insert into public.competition_participants (competition_id, user_id, joined_at) values
    ('71070000-0000-4000-8000-000000000503', '71070000-0000-4000-8000-00000000000a',
     '2026-06-01T00:00:00Z'),
    ('71070000-0000-4000-8000-000000000503', '71070000-0000-4000-8000-00000000000b',
     '2026-06-01T00:00:00Z');

  v := pg_temp.profil('71070000-0000-4000-8000-00000000000a',
                      '71070000-0000-4000-8000-00000000000b') -> 'h2h';
  if (v->>'meetings')::int <> 3 then
    raise exception 'tre runder, to delte konkurrencer — ventede 3 møder, fik %', v->>'meetings';
  end if;
  raise notice 'OK 5: en kamp tæller én gang, uanset hvor mange delte konkurrencer den ligger i';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Idempotens
-- ---------------------------------------------------------------------------
\ir ../career_profile.sql

do $$
declare v jsonb;
begin
  v := pg_temp.profil('71070000-0000-4000-8000-00000000000a',
                      '71070000-0000-4000-8000-00000000000b') -> 'h2h';
  if (v->>'meetings')::int <> 3 then
    raise exception 'anden kørsel ændrede svaret: % møder', v->>'meetings';
  end if;
  raise notice 'OK 6: filen er idempotent';
end $$;

\echo 'ALLE PÅSTANDE BESTÅET (career_profile)'
