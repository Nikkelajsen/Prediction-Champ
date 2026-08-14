-- Test af deltagerens nulpunkt (sql/competition_join_baseline.sql, A53).
--
-- Kører mod PRODUKTIONSSKEMAET (`node sql/tests/_schema.mjs`) og anvender
-- derefter migreringen. Rører aldrig produktion.
--
-- HVORFOR PRODUKTIONSSKEMAET OG IKKE ET MINISKEMA
-- Reglen bor to steder, og de to er kun enige, hvis de måles på det samme
-- grundlag: viewet `competition_match_points` (Story Engine + milepæle læser
-- udelukkende igennem det) og funktionen `award_competition_periods()` (lokale
-- kåringer har sine egne inline-joins og går uden om viewet). Et miniskema
-- ville skulle bygge begge to i hånden og dermed måle kopier.
--
-- HVAD DEN BEVISER
--   1. Et gæt på en kamp, der låste FØR tilmeldingen, tæller ikke i viewet.
--   2. Grænsen er skarp og ligger ved LÅSEN (1 time før kickoff), ikke ved
--      kickoff: tilmeldt i låsesekundet ⇒ tæller ikke; ét sekund før ⇒ tæller.
--   3. En kamp uden fastlagt klokkeslæt bruger midnat dansk tid.
--   4. Kåringerne bærer den samme regel: fire spillere med IDENTISKE gæt kåres
--      forskelligt, alene fordi de meldte sig til på forskellige tidspunkter.
--   5. Deltageren forsvinder ikke — hun har bare ingen rækker før sin
--      tilmelding. Kampe efter tæller fuldt ud.
--   6. Migreringen er idempotent.
--
-- HVAD DEN **IKKE** GØR, OG HVORFOR (§13)
-- Den måler IKKE før-tilstanden — altså at den sene deltager ville tælle med
-- uden migreringen. Fristelsen er stor, for det er selve fejlen; men
-- før-tilstanden ville skulle læses af `sql/schema.sql`, og dumpet skifter side,
-- i det øjeblik skema-eksporten kører. Påstanden ville da måle sig selv.
-- Præcis den fælde har kostet tid tre gange (`G94`, `G98`). At testen er set
-- fejle, er i stedet sikret med mutationer, og de står i commit-beskeden.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d a53 -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d a53 -v ON_ERROR_STOP=1 -b -f sql/tests/competition_join_baseline.sql

\set ON_ERROR_STOP on
\timing off

\ir ../competition_join_baseline.sql

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- ÉN konkurrence, TO spillede kampe, FIRE deltagere med NØJAGTIG samme gæt —
-- alle fire rammer begge resultater præcist. Så kan intet andet end
-- tilmeldingstidspunktet forklare en forskel i stillingen. Det er hele pointen
-- med fixturen: den fjerner enhver anden variabel.
--
--   KAMP_A  kickoff 06-07 18.00Z  ⇒ låser 17.00Z
--   KAMP_B  kickoff 13-07 18.00Z  ⇒ låser 17.00Z (egen runde)
--
--   ANNA   meldt til 01-06         — før begge låse       ⇒ begge kampe tæller
--   BO     meldt til 10-07         — mellem de to låse    ⇒ kun KAMP_B
--   CARL   meldt til 06-07 17.00Z  — PRÆCIS i låsesekundet ⇒ kun KAMP_B
--   DIDDE  meldt til 06-07 16:59:59 — ét sekund før        ⇒ begge kampe
insert into auth.users (id, email) values
  ('53530000-0000-4000-8000-00000000000a', 'anna@test.local'),
  ('53530000-0000-4000-8000-00000000000b', 'bo@test.local'),
  ('53530000-0000-4000-8000-00000000000c', 'carl@test.local'),
  ('53530000-0000-4000-8000-00000000000d', 'didde@test.local');
insert into public.profiles (id, display_name) values
  ('53530000-0000-4000-8000-00000000000a', 'Anna'),
  ('53530000-0000-4000-8000-00000000000b', 'Bo'),
  ('53530000-0000-4000-8000-00000000000c', 'Carl'),
  ('53530000-0000-4000-8000-00000000000d', 'Didde');

insert into public.leagues (id, name) values
  ('53530000-0000-4000-8000-000000000101', 'Testligaen');
insert into public.seasons (id, league_id, name) values
  ('53530000-0000-4000-8000-000000000201', '53530000-0000-4000-8000-000000000101', '2026/27');
insert into public.teams (id, league_id, name) values
  ('53530000-0000-4000-8000-000000000301', '53530000-0000-4000-8000-000000000101', 'Hjemme'),
  ('53530000-0000-4000-8000-000000000302', '53530000-0000-4000-8000-000000000101', 'Ude');

insert into public.matches (id, season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score) values
  ('53530000-0000-4000-8000-000000000401', '53530000-0000-4000-8000-000000000201',
   '53530000-0000-4000-8000-000000000301', '53530000-0000-4000-8000-000000000302',
   '2026-07-06T18:00:00Z', 2, 1),
  ('53530000-0000-4000-8000-000000000402', '53530000-0000-4000-8000-000000000201',
   '53530000-0000-4000-8000-000000000301', '53530000-0000-4000-8000-000000000302',
   '2026-07-13T18:00:00Z', 0, 0);

-- `awards = true`: uden opt-in skriver kåringsfunktionen intet, og påstand 4
-- ville måle en tom tabel og se grøn ud.
insert into public.competitions (id, name, mode, mode_params, created_by) values
  ('53530000-0000-4000-8000-000000000501', 'Konkurrencen', 'full_season',
   '{"awards": true}'::jsonb, '53530000-0000-4000-8000-00000000000a');
insert into public.competition_matches (competition_id, match_id) values
  ('53530000-0000-4000-8000-000000000501', '53530000-0000-4000-8000-000000000401'),
  ('53530000-0000-4000-8000-000000000501', '53530000-0000-4000-8000-000000000402');

insert into public.competition_participants (competition_id, user_id, joined_at) values
  ('53530000-0000-4000-8000-000000000501', '53530000-0000-4000-8000-00000000000a', '2026-06-01T00:00:00Z'),
  ('53530000-0000-4000-8000-000000000501', '53530000-0000-4000-8000-00000000000b', '2026-07-10T00:00:00Z'),
  ('53530000-0000-4000-8000-000000000501', '53530000-0000-4000-8000-00000000000c', '2026-07-06T17:00:00Z'),
  ('53530000-0000-4000-8000-000000000501', '53530000-0000-4000-8000-00000000000d', '2026-07-06T16:59:59Z');

-- Alle fire tipper begge kampe PRÆCIST. Enhver forskel nedenfor er derfor
-- udelukkende tilmeldingstidspunktets fortjeneste.
insert into public.predictions (user_id, match_id, pred_home, pred_away)
select p.id, m.id, m.home_score, m.away_score
from public.profiles p
cross join public.matches m;

-- ---------------------------------------------------------------------------
-- 1 + 2 + 5. Viewet: hvem tæller på hvilken kamp?
-- ---------------------------------------------------------------------------
do $$
declare
  v record;
begin
  select
    count(*) filter (where user_id = '53530000-0000-4000-8000-00000000000a') as anna,
    count(*) filter (where user_id = '53530000-0000-4000-8000-00000000000b') as bo,
    count(*) filter (where user_id = '53530000-0000-4000-8000-00000000000c') as carl,
    count(*) filter (where user_id = '53530000-0000-4000-8000-00000000000d') as didde
  into v
  from public.competition_match_points
  where competition_id = '53530000-0000-4000-8000-000000000501';

  if v.anna <> 2 then
    raise exception 'Anna var med fra start og skal have begge kampe, havde %', v.anna;
  end if;
  -- Selve fejlen, migreringen findes for: Bo meldte sig til efter KAMP_A var
  -- spillet og tog sit gæt fra en anden konkurrence med ind.
  if v.bo <> 1 then
    raise exception 'Bo meldte sig til efter KAMP_A og skal kun have KAMP_B, havde %', v.bo;
  end if;
  -- Grænsen er skarp: `>` og ikke `>=`. Tilmeldt i selve låsesekundet er for
  -- sent, for dér kan kampen ikke længere tippes.
  if v.carl <> 1 then
    raise exception 'Carl meldte sig til PRÆCIS ved låsen og skal kun have KAMP_B, havde %', v.carl;
  end if;
  if v.didde <> 2 then
    raise exception 'Didde nåede det med ét sekund og skal have begge kampe, havde %', v.didde;
  end if;

  -- Påstand 5: den sene er ikke slettet af konkurrencen — hun har fuld værdi
  -- på det, hun nåede. Bos ene række skal være KAMP_B og give fulde 3 point.
  perform 1 from public.competition_match_points
   where competition_id = '53530000-0000-4000-8000-000000000501'
     and user_id = '53530000-0000-4000-8000-00000000000b'
     and match_id = '53530000-0000-4000-8000-000000000402'
     and pts = 3;
  if not found then
    raise exception 'Bos gæt efter tilmeldingen skal tælle fuldt ud (3 point for præcist)';
  end if;

  raise notice 'OK 1+2+5: viewet skelner på tilmeldingstidspunktet, og grænsen ligger ved låsen';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Kamp uden fastlagt klokkeslæt: låsen er midnat dansk tid
-- ---------------------------------------------------------------------------
-- Dansk sommertid er UTC+2, så midnat 6. juli dansk tid er 2026-07-05 22.00Z.
-- En tilmelding 21.00Z er altså FØR låsen, og 23.00Z er efter — selvom begge
-- ligger på "dagen før" i UTC. Fejlen, det værn findes mod, er at regne dagen
-- i UTC; den ville give to forskellige svar for en rejsende bruger.
do $$
declare
  v_for  boolean;
  v_efter boolean;
begin
  update public.matches set kickoff_tbd = true
   where id = '53530000-0000-4000-8000-000000000401';

  select public.match_lock_at(kickoff_at, kickoff_tbd) > '2026-07-05T21:00:00Z'::timestamptz,
         public.match_lock_at(kickoff_at, kickoff_tbd) > '2026-07-05T23:00:00Z'::timestamptz
    into v_for, v_efter
    from public.matches where id = '53530000-0000-4000-8000-000000000401';

  if not v_for then raise exception 'tilmeldt 21.00Z er før midnat dansk tid og skal tælle'; end if;
  if v_efter then raise exception 'tilmeldt 23.00Z er efter midnat dansk tid og må ikke tælle'; end if;

  update public.matches set kickoff_tbd = false
   where id = '53530000-0000-4000-8000-000000000401';
  raise notice 'OK 3: kamp uden klokkeslæt låser ved midnat i Europe/Copenhagen';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Kåringerne bærer den samme regel
-- ---------------------------------------------------------------------------
-- Fire spillere, identiske gæt — og alligevel skal KAMP_A's runde kun kåre de
-- to, der var meldt til, da den kunne tippes. Går funktionen uden om reglen,
-- deles kåringen af alle fire, og påstanden fejler.
do $$
declare
  v_round_a text;
  v_vindere text;
begin
  select round_key::text into v_round_a
    from public.matches where id = '53530000-0000-4000-8000-000000000401';

  -- service_role, så guarden slipper os forbi uden en indlogget deltager.
  perform set_config('test.role', 'service_role', true);
  perform public.award_competition_periods('53530000-0000-4000-8000-000000000501');

  select string_agg(p.display_name, ',' order by p.display_name) into v_vindere
    from public.competition_awards a
    join public.profiles p on p.id = a.user_id
   where a.competition_id = '53530000-0000-4000-8000-000000000501'
     and a.period_type = 'round' and a.period_key = v_round_a;

  if v_vindere is distinct from 'Anna,Didde' then
    raise exception 'KAMP_A''s runde skal kåre Anna og Didde, kårede: %', coalesce(v_vindere, '(ingen)');
  end if;

  -- Og den anden vej: den runde, ALLE nåede, deles af alle fire.
  select string_agg(p.display_name, ',' order by p.display_name) into v_vindere
    from public.competition_awards a
    join public.profiles p on p.id = a.user_id
    join public.matches m on m.id = '53530000-0000-4000-8000-000000000402'
   where a.competition_id = '53530000-0000-4000-8000-000000000501'
     and a.period_type = 'round' and a.period_key = m.round_key::text;

  if v_vindere is distinct from 'Anna,Bo,Carl,Didde' then
    raise exception 'KAMP_B''s runde skal deles af alle fire, kårede: %', coalesce(v_vindere, '(ingen)');
  end if;

  raise notice 'OK 4: kåringerne skelner på tilmeldingstidspunktet — identiske gæt, forskellig kåring';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Idempotens
-- ---------------------------------------------------------------------------
\ir ../competition_join_baseline.sql

do $$
declare
  v_anna int;
begin
  select count(*) into v_anna
    from public.competition_match_points
   where competition_id = '53530000-0000-4000-8000-000000000501'
     and user_id = '53530000-0000-4000-8000-00000000000a';
  if v_anna <> 2 then
    raise exception 'anden kørsel ændrede resultatet: Anna havde % rækker', v_anna;
  end if;
  raise notice 'OK 6: migreringen er idempotent';
end $$;

\echo 'ALLE PÅSTANDE BESTÅET (competition_join_baseline)'
