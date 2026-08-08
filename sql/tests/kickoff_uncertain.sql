-- Test af `sql/matches_kickoff_uncertain.sql` (G85).
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR DET RIGTIGE SKEMA OG IKKE ET MINISKEMA. Tre af påstandene kan slet
-- ikke stilles mod et håndskrevet skema: triggeren ligger på `public.matches`
-- SAMMEN med de tre statement-level rating-triggere, `analytics_match_locks`
-- er det view, påstanden om låsen læses af, og `round_key`/`match_day` er
-- genererede kolonner oven på tidszonelogikken. Et miniskema ville have svaret
-- på et andet spørgsmål end det, produktionen stiller — `G91` er en hel række
-- om præcis dét.
--
-- **Rating-triggerne slås derfor bevidst IKKE fra.** Påstand 9 er, at
-- markeringen kan skrives, uden at maskineriet på den tabel vælter.
--
-- HVAD DEN BEVISER
--   1. Triggeren gemmer den forrige tid — og KUN når tiden faktisk flytter sig.
--      En upsert, der skriver den samme værdi igen, må ikke efterlade et spor;
--      det er dét, hver eneste sync-kørsel gør for hver eneste kamp.
--   2. **Gulvet:** to flytninger fra samme klokkeslæt lærer ingenting. Uden
--      gulvet ville en enkelt omberammelse markere hele turneringen.
--   3. Tre flytninger fra samme klokkeslæt lærer det — og turneringens ØVRIGE
--      kampe på det klokkeslæt markeres. Det er hele generaliseringen.
--   4. Tre flytninger fra TRE FORSKELLIGE klokkeslæt lærer ingenting. En
--      terminsliste, der bliver rykket rundt på i småbidder, er ikke et
--      pladsholder-regime.
--   5. Markeringen rydder sig selv, når leverandøren sætter den rigtige tid.
--   6. Spillede kampe markeres aldrig.
--   7. Sæsonerne er isolerede: en anden turnerings flytninger lærer ikke ind.
--   8. **LÅSEN ER UPÅVIRKET.** `analytics_match_locks` giver præcis samme
--      `lock_at` og `is_locked` før og efter markeringen. Det er den påstand,
--      hele valget af en display-only markør står og falder med — havde vi
--      genbrugt `kickoff_tbd`, ville tallene have flyttet sig 16 timer.
--   9. Funktionen er idempotent: andet kald returnerer 0, fordi den kun tæller
--      de rækker, hvis markør FAKTISK skiftede.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d kutest -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d kutest -v ON_ERROR_STOP=1 -b -f sql/tests/kickoff_uncertain.sql

\set ON_ERROR_STOP on
\timing off

\ir ../matches_kickoff_uncertain.sql

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- To turneringer: én, der får leverandørens opdigtede klokkeslæt (påstand 2–6),
-- og én, der bruges til at vise, at læringen ikke smitter (påstand 7).
--
-- DATOERNE ER ABSOLUTTE og ligger i december 2026, altså efter aflæsningens
-- oktober-skifte. En påstand, der afhænger af, hvornår CI kørte, er ikke en
-- påstand — samme begrundelse som i `rating_freshness.sql`.

insert into public.leagues (id, name, is_official, is_visible, provider, api_league_id) values
  ('11111111-0000-4000-8000-000000000001', 'Premier League', true, true, 'footballdata', 'PL'),
  ('11111111-0000-4000-8000-000000000002', 'Serie A',        true, true, 'footballdata', 'SA');
insert into public.seasons (id, league_id, name, start_date) values
  ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', '26/27', '2026-08-01'),
  ('22222222-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000002', '26/27', '2026-08-01');
insert into public.teams (id, league_id, name) values
  ('33333333-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'Hjemme'),
  ('33333333-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000001', 'Ude'),
  ('33333333-0000-4000-8000-000000000003', '11111111-0000-4000-8000-000000000002', 'S-hjemme'),
  ('33333333-0000-4000-8000-000000000004', '11111111-0000-4000-8000-000000000002', 'S-ude');

-- Otte kampe i Premier League, alle på 15:00 UTC — leverandørens gæt, sådan som
-- aflæsningen fandt det (PL december: 15:00 ×40). Nummer 7 er SPILLET
-- (påstand 6), nummer 8 ligger på et andet klokkeslæt og skal aldrig markeres.
insert into public.matches (id, season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score) values
  ('44444444-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001',
   '33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000002', '2026-12-05 15:00+00', null, null),
  ('44444444-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000001',
   '33333333-0000-4000-8000-000000000002', '33333333-0000-4000-8000-000000000001', '2026-12-12 15:00+00', null, null),
  ('44444444-0000-4000-8000-000000000003', '22222222-0000-4000-8000-000000000001',
   '33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000002', '2026-12-19 15:00+00', null, null),
  ('44444444-0000-4000-8000-000000000004', '22222222-0000-4000-8000-000000000001',
   '33333333-0000-4000-8000-000000000002', '33333333-0000-4000-8000-000000000001', '2027-01-09 15:00+00', null, null),
  ('44444444-0000-4000-8000-000000000005', '22222222-0000-4000-8000-000000000001',
   '33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000002', '2027-01-16 15:00+00', null, null),
  ('44444444-0000-4000-8000-000000000006', '22222222-0000-4000-8000-000000000001',
   '33333333-0000-4000-8000-000000000002', '33333333-0000-4000-8000-000000000001', '2027-01-23 15:00+00', null, null),
  -- Påstand 6: spillet, og på præcis det indlærte klokkeslæt.
  ('44444444-0000-4000-8000-000000000007', '22222222-0000-4000-8000-000000000001',
   '33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000002', '2026-11-28 15:00+00', 2, 1),
  -- Et andet klokkeslæt i samme turnering: må aldrig rives med.
  ('44444444-0000-4000-8000-000000000008', '22222222-0000-4000-8000-000000000001',
   '33333333-0000-4000-8000-000000000002', '33333333-0000-4000-8000-000000000001', '2026-12-26 20:00+00', null, null);

-- Serie A: tre kampe på 17:30 UTC — plus ÉN på 15:00, altså præcis det
-- klokkeslæt, Premier League om lidt lærer at mistro. Den fjerde kamp er hele
-- prøven i påstand 7: uden den kan en regel, der grupperer på tværs af sæsoner,
-- ikke skelnes fra en, der ikke gør.
insert into public.matches (id, season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score) values
  ('55555555-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000002',
   '33333333-0000-4000-8000-000000000003', '33333333-0000-4000-8000-000000000004', '2026-12-05 17:30+00', null, null),
  ('55555555-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000002',
   '33333333-0000-4000-8000-000000000004', '33333333-0000-4000-8000-000000000003', '2026-12-12 17:30+00', null, null),
  ('55555555-0000-4000-8000-000000000003', '22222222-0000-4000-8000-000000000002',
   '33333333-0000-4000-8000-000000000003', '33333333-0000-4000-8000-000000000004', '2026-12-19 17:30+00', null, null),
  ('55555555-0000-4000-8000-000000000004', '22222222-0000-4000-8000-000000000002',
   '33333333-0000-4000-8000-000000000004', '33333333-0000-4000-8000-000000000003', '2026-12-26 15:00+00', null, null);

-- Låsen for tre PL-kampe, FØR noget er markeret. Påstand 8 sammenligner med den.
create table _laas_foer as
select match_id, lock_at, is_locked from public.analytics_match_locks
 where match_id in ('44444444-0000-4000-8000-000000000004',
                    '44444444-0000-4000-8000-000000000005',
                    '44444444-0000-4000-8000-000000000006');

-- ---------------------------------------------------------------------------
-- Påstand 1: triggeren gemmer kun en flytning, ikke en gen-skrivning
-- ---------------------------------------------------------------------------
-- Første halvdel er hele grunden til `when (...)` på triggeren: syncen skriver
-- hver kamp igen hver 12. time med den samme værdi, og hvis DET talte som en
-- flytning, ville hver eneste kamp lære sit eget klokkeslæt inden for et døgn.

update public.matches
   set kickoff_at = '2026-12-05 15:00+00'
 where id = '44444444-0000-4000-8000-000000000001';

do $$
declare v timestamptz;
begin
  select kickoff_prev_at into v from public.matches
   where id = '44444444-0000-4000-8000-000000000001';
  if v is not null then
    raise exception 'en gen-skrivning af den SAMME tid må ikke tælle som en flytning, fik %', v;
  end if;
end $$;

update public.matches
   set kickoff_at = '2026-12-05 17:30+00'
 where id = '44444444-0000-4000-8000-000000000001';

do $$
declare v timestamptz;
begin
  select kickoff_prev_at into v from public.matches
   where id = '44444444-0000-4000-8000-000000000001';
  if v is distinct from '2026-12-05 15:00+00'::timestamptz then
    raise exception 'flytningen skulle have efterladt 15:00 i kickoff_prev_at, fik %', v;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Påstand 2: gulvet — to flytninger fra samme klokkeslæt lærer ingenting
-- ---------------------------------------------------------------------------

update public.matches
   set kickoff_at = '2026-12-12 17:30+00'
 where id = '44444444-0000-4000-8000-000000000002';

do $$
declare n int;
begin
  n := public.refresh_kickoff_uncertain('22222222-0000-4000-8000-000000000001');
  if n <> 0 then
    raise exception 'to flytninger fra samme klokkeslæt må ikke lære noget, markerede %', n;
  end if;
  if exists (select 1 from public.matches where kickoff_uncertain) then
    raise exception 'ingen kamp må være markeret endnu';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Påstand 3: tre flytninger lærer klokkeslættet, og turneringen markeres
-- ---------------------------------------------------------------------------
-- Kampene 4, 5 og 6 står stadig på 15:00 og har ALDRIG flyttet sig. De
-- markeres, fordi turneringen nu ved, at 15:00 er et gæt — det er
-- generaliseringen fra kamp til turnering, og uden den ville reglen kun kunne
-- svare om fortiden.

update public.matches
   set kickoff_at = '2026-12-19 17:30+00'
 where id = '44444444-0000-4000-8000-000000000003';

do $$
declare n int; markerede uuid[];
begin
  n := public.refresh_kickoff_uncertain('22222222-0000-4000-8000-000000000001');
  if n <> 3 then
    raise exception 'tre kampe på det indlærte klokkeslæt skulle markeres, fik %', n;
  end if;
  select array_agg(id order by id) into markerede
    from public.matches where kickoff_uncertain;
  if markerede <> array['44444444-0000-4000-8000-000000000004',
                        '44444444-0000-4000-8000-000000000005',
                        '44444444-0000-4000-8000-000000000006']::uuid[] then
    raise exception 'forkerte kampe markeret: %', markerede;
  end if;
end $$;

-- Påstand 6, i samme åndedrag: den SPILLEDE kamp bærer det indlærte
-- klokkeslæt og er ikke med i listen ovenfor. Et klokkeslæt bagudrettet er
-- ligegyldigt for både lås og visning — samme afgrænsning som G84's kontrol.
do $$
begin
  if (select kickoff_uncertain from public.matches
       where id = '44444444-0000-4000-8000-000000000007') then
    raise exception 'en spillet kamp må aldrig markeres';
  end if;
end $$;

-- Kampen på 20:00 er hverken flyttet eller på et indlært klokkeslæt.
do $$
begin
  if (select kickoff_uncertain from public.matches
       where id = '44444444-0000-4000-8000-000000000008') then
    raise exception 'et klokkeslæt, turneringen ikke har lært, må ikke markeres';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Påstand 7: læringen smitter ikke til en anden turnering
-- ---------------------------------------------------------------------------
-- Premier League har nu lært, at 15:00 er et gæt. Serie A har en kamp på præcis
-- 15:00 og ingen flytninger overhovedet. Havde `laert` grupperet på tværs af
-- sæsoner, ville dén kamp stå markeret her — det er den ene forskel, påstanden
-- måler, og prøven skal derfor bruge det klokkeslæt, PL lærte FRA, ikke det, den
-- flyttede TIL.

do $$
declare n int;
begin
  n := public.refresh_kickoff_uncertain('22222222-0000-4000-8000-000000000002');
  if n <> 0 then
    raise exception 'Serie A har ingen flytninger og må ikke lære noget, markerede %', n;
  end if;
  if exists (select 1 from public.matches m
              where m.season_id = '22222222-0000-4000-8000-000000000002'
                and m.kickoff_uncertain) then
    raise exception 'en anden turnerings flytninger må ikke markere Serie A';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Påstand 8: LÅSEN HAR IKKE FLYTTET SIG
-- ---------------------------------------------------------------------------
-- Tre markerede kampe, og `analytics_match_locks` siger præcis det samme som
-- før. Det er dét, en display-only markør betyder — og den eneste påstand her,
-- der ville have fejlet, hvis vi havde genbrugt `kickoff_tbd`.

do $$
declare r record;
begin
  for r in
    select f.match_id, f.lock_at as foer, n.lock_at as efter,
           f.is_locked as foer_l, n.is_locked as efter_l
      from _laas_foer f
      join public.analytics_match_locks n on n.match_id = f.match_id
  loop
    if r.foer is distinct from r.efter or r.foer_l is distinct from r.efter_l then
      raise exception 'låsen for % flyttede sig: % (%) → % (%)',
        r.match_id, r.foer, r.foer_l, r.efter, r.efter_l;
    end if;
  end loop;
  if (select count(*) from _laas_foer) <> 3 then
    raise exception 'påstanden skal måle tre kampe, målte %', (select count(*) from _laas_foer);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Påstand 9: idempotens
-- ---------------------------------------------------------------------------
-- Andet kald må returnere 0 og lade markeringerne stå. Tallet er "hvor mange
-- skiftede", ikke "hvor mange er markeret" — det er dét, der gør, at
-- `uncertainMarked` i Admin → Drift kan læses som en ændring.

do $$
declare n int;
begin
  n := public.refresh_kickoff_uncertain('22222222-0000-4000-8000-000000000001');
  if n <> 0 then
    raise exception 'andet kald skal returnere 0, fik %', n;
  end if;
  if (select count(*) from public.matches where kickoff_uncertain) <> 3 then
    raise exception 'markeringerne skal stå efter andet kald';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Påstand 5: markeringen rydder sig selv
-- ---------------------------------------------------------------------------
-- Leverandøren sætter den rigtige tid på kamp 4. Markeringen skal væk uden at
-- nogen rører den — det er hele grunden til, at `refresh_kickoff_uncertain()`
-- også skriver `false` og ikke kun `true`.

update public.matches
   set kickoff_at = '2027-01-09 12:30+00'
 where id = '44444444-0000-4000-8000-000000000004';

do $$
declare n int;
begin
  n := public.refresh_kickoff_uncertain('22222222-0000-4000-8000-000000000001');
  if n <> 1 then
    raise exception 'præcis én markering skulle falde bort, fik %', n;
  end if;
  if (select kickoff_uncertain from public.matches
       where id = '44444444-0000-4000-8000-000000000004') then
    raise exception 'en rettet tid skal rydde sin egen markering';
  end if;
  if (select count(*) from public.matches where kickoff_uncertain) <> 2 then
    raise exception 'de to øvrige markeringer skal stå';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Påstand 4: tre flytninger fra TRE FORSKELLIGE klokkeslæt lærer ingenting
-- ---------------------------------------------------------------------------
-- Serie A får nu tre flytninger — men fra hvert sit klokkeslæt, fordi de først
-- rykkes hver for sig. En terminsliste, der bliver rettet i småbidder, er ikke
-- et regime, og `group by` på klokkeslættet er det, der kender forskel.

update public.matches set kickoff_at = '2026-12-05 11:00+00' where id = '55555555-0000-4000-8000-000000000001';
update public.matches set kickoff_at = '2026-12-05 12:00+00' where id = '55555555-0000-4000-8000-000000000001';
update public.matches set kickoff_at = '2026-12-12 14:00+00' where id = '55555555-0000-4000-8000-000000000002';
update public.matches set kickoff_at = '2026-12-19 16:00+00' where id = '55555555-0000-4000-8000-000000000003';

do $$
declare n int;
begin
  -- Kamp 1 er rykket TO gange, så dens kickoff_prev_at er 11:00 og ikke 17:30.
  -- De tre forrige værdier er dermed 11:00, 17:30 og 17:30: kun de to sidste
  -- deler klokkeslæt, og to er under gulvet.
  n := public.refresh_kickoff_uncertain('22222222-0000-4000-8000-000000000002');
  if n <> 0 then
    raise exception 'flytninger fra forskellige klokkeslæt må ikke lære noget, markerede %', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------

drop table _laas_foer;

do $$
begin
  raise notice 'kickoff_uncertain: alle ni påstande holdt.';
end $$;
