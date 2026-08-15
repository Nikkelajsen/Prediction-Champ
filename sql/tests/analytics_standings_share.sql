-- Test af `sql/analytics_standings_share.sql` (#67).
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR DEN FINDES. Migreringen kan kun sætte check-constrainten I SIN
-- HELHED, så den er nødt til at gentage hele hændelseskataloget. Det er en
-- kopi, og en kopi kan tabe en linje — og fejlen ville være tavs på præcis den
-- måde, `analytics.js`' kontrakt gør alt tavst: et navn, der falder ud, holder
-- op med at blive skrevet, uden at nogen får en fejl. Tallet ville bare stå
-- stille, og det ligner en funktion, ingen bruger.
--
-- HVAD DEN BEVISER
--   1. Kataloget er præcis det gamle PLUS `standings_shared` — hverken mere
--      eller mindre. Påstanden læser den GAMLE liste ud af skemaet, før
--      migreringen køres, så den holder sig selv opdateret: tilføjes et navn i
--      `analytics_events.sql`, skal det også med her, ellers bliver testen rød.
--   2. En række med `standings_shared` kan faktisk skrives.
--   3. Et opdigtet navn afvises fortsat (23514) — constrainten er ikke bare
--      blevet bredere.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d sstest -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d sstest -v ON_ERROR_STOP=1 -b -f sql/tests/analytics_standings_share.sql

\set ON_ERROR_STOP on
\timing off

-- Katalogets navne, som de står FØR migreringen. `pg_get_constraintdef` skriver
-- listen som `= ANY (ARRAY['login'::text, …])`, uanset at kilden bruger `in (…)`.
create temporary table _katalog_foer as
select unnest(regexp_matches(pg_get_constraintdef(oid), '''([a-z_]+)''', 'g'))::text as navn
from pg_constraint where conname = 'analytics_events_name_check';

do $$
begin
  if (select count(*) from _katalog_foer) = 0 then
    raise exception 'kunne ikke læse det eksisterende hændelseskatalog — er skemaet indlæst?';
  end if;
end $$;

\ir ../analytics_standings_share.sql

create temporary table _katalog_efter as
select unnest(regexp_matches(pg_get_constraintdef(oid), '''([a-z_]+)''', 'g'))::text as navn
from pg_constraint where conname = 'analytics_events_name_check';

-- ---------------------------------------------------------------------------
-- Påstand 1: præcis ét navn kom til, og intet forsvandt
-- ---------------------------------------------------------------------------
do $$
declare v_tabt text; v_nye text;
begin
  select string_agg(navn, ', ' order by navn) into v_tabt
  from (select navn from _katalog_foer except select navn from _katalog_efter) t;
  if v_tabt is not null then
    raise exception 'migreringen TABTE hændelsesnavne: %', v_tabt;
  end if;

  select string_agg(navn, ', ' order by navn) into v_nye
  from (select navn from _katalog_efter except select navn from _katalog_foer) t;
  if v_nye is distinct from 'standings_shared' then
    raise exception 'forventede præcis "standings_shared" som nyt navn, fik "%"', coalesce(v_nye, '(ingen)');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Påstand 2 og 3: navnet virker, og bredden er uændret
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, created_at)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@test.local', now());
insert into public.profiles (id, display_name)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bo');

insert into public.analytics_events (event_name, user_id, metadata)
values ('standings_shared', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{"rows": 8}'::jsonb);

do $$
begin
  if (select count(*) from public.analytics_events where event_name = 'standings_shared') <> 1 then
    raise exception 'standings_shared blev ikke skrevet';
  end if;
end $$;

do $$
begin
  begin
    insert into public.analytics_events (event_name, user_id)
    values ('ikke_et_navn', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    raise exception 'et opdigtet hændelsesnavn blev accepteret — constrainten er blevet for bred';
  exception when check_violation then
    null; -- forventet
  end;
end $$;

select 'analytics_standings_share: alle påstande bestået' as resultat;
