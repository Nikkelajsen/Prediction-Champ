-- Test af `sql/checks/rating_freshness.sql` (G83).
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR DET RIGTIGE SKEMA OG IKKE ET MINISKEMA som de fleste andre tests her.
-- Kontrollen krydser præcis den fælde, §17 kalder den tavse: `matches.round_key`
-- er **date**, `rating_history.round_key` er **text**, og PostgreSQL har ingen
-- `date = text`-operator. Et håndskrevet miniskema ville have givet begge
-- kolonner samme type — og så ville testen bevise noget andet end det, der
-- kører i produktion. `matches.round_key` er desuden en GENERERET kolonne oven
-- på `round_key()`, altså tidszonelogikken selv.
--
-- HVORFOR TRIGGERNE SLÅS FRA
-- Ikke for at gøre testen nemmere, men fordi det ER tilstanden, kontrollen
-- findes for: `docs/RESTORE.md` scenarie 1 foreskriver
-- `pg_restore --disable-triggers`, og efter den indlæsning står ratingen
-- forkert uden at nogen får det at vide. Testen bygger dermed gendannelsens
-- egen tilstand og spørger, om kontrollen kan se den.
--
-- HVAD DEN BEVISER
--   1. En database, hvor `recompute_ratings()` lige er kørt, er `ok`.
--   2. **Regressionen:** rækker indlæst med triggerne slået fra melder
--      `RATING ER BAGUD` med et `manglende`-tal.
--   3. Et RETTET resultat uden genberegning melder `foraeldede` — den fejl,
--      der ellers er helt usynlig.
--   4. En efterladt historik-række (slettet kamp, nedrevet simulering) melder
--      `overfloedige` — mens en række i et ANDET scope ikke gør.
--   5. En UOFFICIEL turnering tæller ikke med (A17). Kontrollen skal spejle
--      `_rs`, og en turnering, der ikke kan vindes, flytter ikke ratingen.
--   6. Kampe uden resultat tæller ikke med — ellers ville
--      enhver kommende runde melde ratingen bagud.
--   7. `recompute_derived()` bringer den tilbage til `ok`. Kontrollen og
--      rettelsen hører sammen; en alarm uden en knap er en bekymring.
--   8. Samme point på FÆRRE kampe meldes også — det snævre tilfælde, hvor
--      gennemsnittet er uændret og kun antallet har flyttet sig. Påstanden
--      findes, fordi mutationstesten fandt den manglende (se afsnittet selv).
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d rftest -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d rftest -v ON_ERROR_STOP=1 -b -f sql/tests/rating_freshness.sql

\set ON_ERROR_STOP on
\timing off

\ir ../recompute_derived.sql
\ir ../checks/rating_freshness.sql

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, created_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local', now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@test.local', now());
insert into public.profiles (id, display_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Anna'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bo');

-- Gendannelsens tilstand: rækkerne kommer ind, uden at noget regnes.
alter table public.matches disable trigger all;

insert into public.leagues (id, name, is_official, is_visible) values
  ('11111111-0000-4000-8000-000000000001', 'Officiel liga',  true,  true),
  ('11111111-0000-4000-8000-000000000002', 'Uofficiel liga', false, true);
insert into public.seasons (id, league_id, name, start_date) values
  ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', '25/26', current_date - 60),
  ('22222222-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000002', '25/26', current_date - 60);
insert into public.teams (id, league_id, name) values
  ('33333333-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'Hjemme'),
  ('33333333-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000001', 'Ude'),
  ('33333333-0000-4000-8000-000000000003', '11111111-0000-4000-8000-000000000002', 'U-hjemme'),
  ('33333333-0000-4000-8000-000000000004', '11111111-0000-4000-8000-000000000002', 'U-ude');

-- To spillede runder i den officielle turnering, to kampe i hver.
--
-- KLOKKESLÆTTENE ER ABSOLUTTE OG IKKE `now() - interval`, og det er ikke smag.
-- `matches.round_key` grupperer tirsdag–mandag i Europe/Copenhagen, så to
-- kampe "20 og 21 dage siden" ligger i samme runde nogle ugedage og i hver sin
-- runde andre. Testen påstår et rundeantal, og en påstand, der afhænger af,
-- hvilken dag CI kørte, er ikke en påstand. Datoerne nedenfor ligger i
-- ugerne tirsdag 3. og 10. marts 2026 — to runder, uanset hvornår de læses.
insert into public.matches (id, season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score) values
  ('44444444-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001',
   '33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000002', '2026-03-04 19:00+01', 2, 1),
  ('44444444-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000001',
   '33333333-0000-4000-8000-000000000002', '33333333-0000-4000-8000-000000000001', '2026-03-07 15:00+01', 0, 0),
  ('44444444-0000-4000-8000-000000000003', '22222222-0000-4000-8000-000000000001',
   '33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000002', '2026-03-11 19:00+01', 3, 2),
  ('44444444-0000-4000-8000-000000000004', '22222222-0000-4000-8000-000000000001',
   '33333333-0000-4000-8000-000000000002', '33333333-0000-4000-8000-000000000001', '2026-03-14 15:00+01', 1, 1),
  -- Påstand 6: en kamp, der ikke er spillet.
  ('44444444-0000-4000-8000-000000000005', '22222222-0000-4000-8000-000000000001',
   '33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000002', '2026-03-18 19:00+01', null, null),
  -- Påstand 5: en spillet kamp i den UOFFICIELLE turnering.
  ('44444444-0000-4000-8000-000000000006', '22222222-0000-4000-8000-000000000002',
   '33333333-0000-4000-8000-000000000003', '33333333-0000-4000-8000-000000000004', '2026-03-04 19:00+01', 4, 0);

-- Anna rammer ALTID præcis, Bo altid ét mål for meget på hjemmeholdet.
-- Annas ufejlbarlighed er valgt med vilje og bruges af påstand 8: når hver af
-- hendes kampe giver samme pointtal, kan antallet af kampe i en runde ændre sig,
-- uden at gennemsnittet gør det.
insert into public.predictions (user_id, match_id, pred_home, pred_away)
select u.id, m.id,
       case when u.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then m.home_score else m.home_score + 1 end,
       case when u.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then m.away_score else m.away_score end
from public.profiles u
cross join public.matches m
where m.home_score is not null;

-- Et tip på den USPILLEDE kamp (påstand 6). Det er den rigtige prøve, og den er
-- ikke den, fixturen først blev skrevet til: `_rs` filtrerer også på
-- `p.pred_home is not null`, men `predictions.pred_home` er NOT NULL i det
-- rigtige skema, så et tip uden tal kan slet ikke findes. Filteret i
-- `recompute_ratings()` er dermed dødt, og kontrollen spejler det bevidst
-- alligevel — den skal ligne `_rs`, ikke være klogere end den.
insert into public.predictions (user_id, match_id, pred_home, pred_away)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-0000-4000-8000-000000000005', 1, 0);

-- ---------------------------------------------------------------------------
-- Påstand 2: gendannelsens tilstand ER bagud
-- ---------------------------------------------------------------------------

do $$
declare r record;
begin
  select * into r from rating_freshness;
  if r.tilstand <> 'RATING ER BAGUD' then
    raise exception 'rækker indlæst med triggerne slået fra skal melde bagud, fik % (manglende=%)', r.tilstand, r.manglende;
  end if;
  -- To brugere × to runder = fire (runde, bruger)-par, ingen af dem regnet.
  if r.manglende <> 4 then
    raise exception 'forventede 4 manglende (2 brugere × 2 runder), fik %', r.manglende;
  end if;
  if r.foraeldede <> 0 or r.overfloedige <> 0 then
    raise exception 'en helt uregnet database har hverken forældede eller overflødige rækker, fik %/%',
      r.foraeldede, r.overfloedige;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Påstand 1, 5 og 6: efter genberegningen er den grøn
-- ---------------------------------------------------------------------------

select trin, resultat from public.recompute_derived();

do $$
declare r record;
begin
  select * into r from rating_freshness;
  if r.tilstand <> 'ok' then
    raise exception 'efter recompute_derived() skal kontrollen være grøn, fik % (%/%/%)',
      r.tilstand, r.manglende, r.foraeldede, r.overfloedige;
  end if;
  -- Påstand 5 og 6 måles her: havde den uofficielle eller den kommende kamp
  -- talt med, ville de fire par være flere — og
  -- kontrollen ville melde bagud på en database, der er helt i orden.
  if r.sammenlignede <> 4 then
    raise exception 'forventede 4 sammenlignede par (uofficiel og kommende kamp skal IKKE tælle), fik %',
      r.sammenlignede;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Påstand 3: et rettet resultat uden genberegning
-- ---------------------------------------------------------------------------
-- Den mest usynlige af de tre. Ingen række mangler, intet er efterladt — kun
-- tallet er forkert.

update public.matches set home_score = 5, away_score = 0
 where id = '44444444-0000-4000-8000-000000000001';

do $$
declare r record;
begin
  select * into r from rating_freshness;
  if r.foraeldede = 0 then
    raise exception 'et rettet resultat uden genberegning skal melde forældede rækker, fik 0 (tilstand %)', r.tilstand;
  end if;
  if r.manglende <> 0 or r.overfloedige <> 0 then
    raise exception 'en rettelse skaber hverken manglende eller overflødige rækker, fik %/%',
      r.manglende, r.overfloedige;
  end if;
  if r.tilstand <> 'RATING ER BAGUD' then
    raise exception 'tilstanden skal være rød, når tallene er forældede, fik %', r.tilstand;
  end if;
end $$;

select trin from public.recompute_derived();

-- ---------------------------------------------------------------------------
-- Påstand 4: en efterladt historik-række
-- ---------------------------------------------------------------------------

insert into public.rating_history (user_id, scope, round_key, rating_after, delta, round_score, matches_predicted, rnk)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ALL', '1999-01-05', 1000, 0, 3, 1, 1);

-- Og en række i et ANDET scope. `ratings.scope`/`rating_history.scope` er
-- forberedt til flere ratinglister (sql/cleanup_orphans.sql lod dem bevidst
-- stå), og `recompute_ratings()` rører kun `'ALL'`. Uden filteret i kontrollen
-- ville den dag, det andet scope tages i brug, hver eneste af dets rækker blive
-- meldt overflødig — en alarm, der udløses af en ny funktion frem for af en
-- fejl, bliver slukket. Påstanden findes, fordi mutationen af netop dét filter
-- slap igennem den første udgave af testen.
insert into public.rating_history (user_id, scope, round_key, rating_after, delta, round_score, matches_predicted, rnk)
-- Nøglen er en runde UDEN kildedata med vilje. Bruges en runde, der findes,
-- matcher rækken kildens egen række, og så beviser fixturen ingenting — den
-- var netop sådan første gang, og mutationen af scope-filteret slap igennem.
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'MONTH', '2026-04-07', 1000, 0, 3, 2, 1);

do $$
declare r record;
begin
  select * into r from rating_freshness;
  if r.overfloedige <> 1 then
    raise exception 'præcis ÉN række skal meldes overflødig (den anden er et andet scope), fik %', r.overfloedige;
  end if;
  if r.manglende <> 0 then
    raise exception 'en efterladt række må ikke tælles som manglende, fik %', r.manglende;
  end if;
end $$;

delete from public.rating_history where round_key = '1999-01-05' or scope <> 'ALL';

-- ---------------------------------------------------------------------------
-- Påstand 8: samme point på FÆRRE kampe
-- ---------------------------------------------------------------------------
-- Den ottende påstand findes, fordi den ottende MUTATION slap igennem.
-- Kontrollen blev mutationstestet ved at fjerne hver af dens led på skift, og
-- syv af otte blev fanget. Den ene, der ikke blev, var
-- `g.matches_predicted <> k.n`: ingen af de syv fixtures kunne skelne en runde,
-- hvor antallet af kampe har ændret sig, mens gennemsnittet er det samme —
-- og så påstod testen at bevise noget, den ikke beviste. Samme lære som
-- `G84`s: en test, man ikke har set fejle, er en formodning.
--
-- Tilfældet er ikke konstrueret. `round_score` gemmes som pts/n, og Anna rammer
-- præcis hver gang: 6 point på 2 kampe og 3 point på 1 kamp er begge 3,0. En
-- slettet kamp i en spillet runde efterlader dermed en historik-række, hvor
-- ALLE tal ser rigtige ud på nær ét.

-- ANDEN runde og ikke første: påstand 3 rettede et resultat i runde 1, så
-- Annas to kampe dér ikke længere giver det samme. Runde 2 er urørt, og begge
-- hendes tips er præcise — 3 point pr. kamp, uanset hvor mange der tælles med.
delete from public.predictions
 where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   and match_id = '44444444-0000-4000-8000-000000000004';

do $$
declare r record; v_score numeric; v_n int;
begin
  select * into r from rating_freshness;
  -- Først: bevis at det ER det snævre tilfælde, og ikke bare en anden uenighed.
  select round_score, matches_predicted into v_score, v_n
    from public.rating_history
   where scope = 'ALL' and user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   order by round_key desc limit 1;
  if v_score <> 3 or v_n <> 2 then
    raise exception 'fixturen holder ikke: forventede 3,0 point på 2 kampe, fik % på %', v_score, v_n;
  end if;

  if r.foraeldede <> 1 then
    raise exception 'en runde med samme gennemsnit på færre kampe skal meldes forældet, fik % (tilstand %)',
      r.foraeldede, r.tilstand;
  end if;
  if r.manglende <> 0 or r.overfloedige <> 0 then
    raise exception 'tilfældet er hverken manglende eller overflødigt, fik %/%', r.manglende, r.overfloedige;
  end if;
end $$;

select trin from public.recompute_derived();

-- ---------------------------------------------------------------------------
-- Påstand 7: og tilbage til grøn
-- ---------------------------------------------------------------------------

do $$
declare r record;
begin
  select * into r from rating_freshness;
  if r.tilstand <> 'ok' then
    raise exception 'kontrollen skal kunne blive grøn igen, fik % (%/%/%)',
      r.tilstand, r.manglende, r.foraeldede, r.overfloedige;
  end if;
end $$;

\echo 'rating_freshness.sql: alle otte påstande holdt.'
