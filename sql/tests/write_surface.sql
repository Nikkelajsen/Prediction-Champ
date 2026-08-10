-- Hvad kan en almindelig indlogget bruger SKRIVE? (efter `B29`)
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR DEN FINDES
-- `B29` fandt, at `grant all on public.profiles to authenticated` + policyen
-- `update own profile` lod enhver bruger sætte sin egen `is_admin`: en policy
-- afgrænser RÆKKEN, ikke KOLONNEN. Rettelsen var kolonne-privilegier, og
-- spørgsmålet, den efterlod, var det generelle — `grant all` står på 29 objekter
-- mere. Revisionen 10. august 2026 svarede, at resten er dækket: hvor der ingen
-- skrive-policy er, skjuler RLS rækkerne, og hvor der er en, er den scopet til
-- `auth.uid()`, `created_by`, `is_admin` eller `is_group_admin`.
--
-- **Men et svar fra en bestemt dag er ikke en kontrol.** Næste `grant`, næste
-- policy eller næste kolonne kan flytte fladen igen, og den slags viser sig ikke
-- som en fejl — det viser sig som noget, der pludselig virker. Denne fil er
-- derfor revisionen skrevet som en påstand, der køres hver gang.
--
-- HVORFOR RÆKKEANTAL OG IKKE "FEJLEDE DEN?"
-- Den fælde kostede en runde under revisionen og er værd at kende: **RLS uden
-- en policy skjuler bare rækkerne.** En fjendtlig `update public.ratings set
-- rating = 9999` rammer derfor NUL rækker og svarer `UPDATE 0` — ingen fejl,
-- ingen ændring. Måler man på fravær af en fejl, ser fem værn ud som fem huller.
-- Derfor skelner katalogret nedenfor mellem tre udfald: `afvist` (databasen sagde
-- nej), `nul` (sætningen kørte og ramte intet) og `tilladt` (rækker blev skrevet).
--
-- HVAD DEN BEVISER
--   1. Fortegnelsen over skrive-policies er præcis den forventede. En ny
--      permissiv policy skal VÆLGES ind, ikke ankomme ubemærket — RLS er et OR
--      mellem permissive policies, så en ny kan kun gøre fladen større.
--   2. Ingen view, `authenticated` kan nå, kan skrives igennem. En auto-opdaterbar
--      view UDEN `security_invoker` ville udføre skrivningen som viewets EJER og
--      dermed gå uden om RLS på tabellen under den. De seks, rollen kan nå, er
--      alle `security_invoker=on`; de tre `analytics_*`, der bevidst ikke er det,
--      kan rollen slet ikke nå.
--   3. `profiles`' kolonne-rettighed er præcis `id` + `display_name` — `B29`s
--      rettelse, sagt som en regel om fladen frem for om én migrering.
--   4. Atten fjendtlige skrivninger har hvert sit forventede udfald. Listen ER
--      dokumentationen for, hvad en bruger må, og den ene `tilladt`, der ikke er
--      en selvfølge, står med sin begrundelse ved siden af.
--
-- EFTERPRØVET MED MUTATION (10. august 2026). Fire ændringer af skemaet, tre
-- fanget: en ny permissiv `update`-policy på `competitions` (påstand 1), en
-- skrivbar view uden `security_invoker` (2), og `ratings` åbnet for ejeren selv
-- (1). Den fjerde — `grant update on profiles` lagt ind FØR testen — slap forbi,
-- og grunden er værd at kende.
--
-- ⚠️ **PÅSTAND 3 MÅLER MIGRERINGENS RESULTAT, IKKE PRODUKTIONENS TILSTAND —
-- INDTIL VIDERE.** Filen indlæser `\ir ../username_change.sql`, som selv
-- smalner rettigheden, så en udvidelse lagt ind før den bliver rullet tilbage af
-- testens egen opsætning. Påstanden er sund — en udvidelse lagt EFTER
-- migreringen aflæses korrekt (efterprøvet: listen bliver til alle syv
-- kolonner) — men den kan i dag ikke se en udvidelse, der står i snapshottet.
--
-- Grunden er, at `sql/schema.sql` endnu er ældre end migreringen. **Når
-- skema-eksporten er kørt**, bærer snapshottet selv den smalle rettighed, og så
-- skal `\ir`-linjen FJERNES herfra: påstanden begynder da at måle produktionen
-- frem for migreringen, og det er den, der er værd at have. Det er samme
-- udløbsdato som `G94` beskrev, bare den anden vej rundt — dér blev en test rød,
-- da migreringen nåede frem; her bliver en påstand først skarp.
--
-- BEVIDST OVERLAP MED `sql/tests/username_change.sql`
-- Begge rører `is_admin`. Det er ikke en dublet, men to spørgsmål: dér er det
-- REGRESSIONEN for en bestemt migrering (hullet, der stod åbent, er lukket), her
-- er det én linje i en fortegnelse over hele fladen. Fjernes migreringen, fejler
-- den første; udvides fladen et helt andet sted, fejler den anden.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d flade -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d flade -v ON_ERROR_STOP=1 -b -f sql/tests/write_surface.sql

\set ON_ERROR_STOP on
\timing off

-- Rating- og Story Engine-triggerne har intet med rettigheder at gøre og ville
-- kun gøre kørslen langsom. Samme greb som i `sql/tests/liga_admin.sql`.
alter table public.matches disable trigger all;

-- Migreringen, der smalnede `profiles`. Uden den er påstand 3 og den første
-- linje i katalogret en beskrivelse af hullet frem for af værnet.
\ir ../username_change.sql

grant usage on schema auth to authenticated;

-- ---------------------------------------------------------------------------
-- Fixture: A er angriberen, B er offeret, som ejer en liga og en konkurrence
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaa0000-0000-4000-8000-000000000001', 'angriber@test.local'),
  ('bbbb0000-0000-4000-8000-000000000002', 'offer@test.local');
insert into public.profiles (id, display_name, is_admin) values
  ('aaaa0000-0000-4000-8000-000000000001', 'Angriber', false),
  ('bbbb0000-0000-4000-8000-000000000002', 'Offer',    true);

insert into public.leagues (id, name) values
  ('cccc0000-0000-4000-8000-000000000001', 'Testligaen');
insert into public.seasons (id, league_id, name) values
  ('dddd0000-0000-4000-8000-000000000001', 'cccc0000-0000-4000-8000-000000000001', '25/26');
insert into public.teams (id, league_id, name) values
  ('eeee0000-0000-4000-8000-000000000001', 'cccc0000-0000-4000-8000-000000000001', 'Hjemme'),
  ('eeee0000-0000-4000-8000-000000000002', 'cccc0000-0000-4000-8000-000000000001', 'Ude');
-- Kampen er FREM i tiden og uden resultat: ellers ville en afvisning kunne
-- skyldes låsen frem for rettigheden, og påstanden ville måle det forkerte.
insert into public.matches (id, season_id, home_team_id, away_team_id, kickoff_at) values
  ('ffff0000-0000-4000-8000-000000000001', 'dddd0000-0000-4000-8000-000000000001',
   'eeee0000-0000-4000-8000-000000000001', 'eeee0000-0000-4000-8000-000000000002',
   now() + interval '5 days');

insert into public.groups (id, name, created_by, invite_code) values
  ('1111aaaa-0000-4000-8000-000000000001', 'Offerets liga',
   'bbbb0000-0000-4000-8000-000000000002', 'HEMMELIG');
insert into public.group_members (group_id, user_id, role) values
  ('1111aaaa-0000-4000-8000-000000000001', 'bbbb0000-0000-4000-8000-000000000002', 'admin');
insert into public.competitions (id, name, mode, created_by, group_id) values
  ('2222aaaa-0000-4000-8000-000000000001', 'Offerets konkurrence', 'custom',
   'bbbb0000-0000-4000-8000-000000000002', '1111aaaa-0000-4000-8000-000000000001');
insert into public.competition_matches (competition_id, match_id) values
  ('2222aaaa-0000-4000-8000-000000000001', 'ffff0000-0000-4000-8000-000000000001');
insert into public.ratings (user_id, rating, rounds_played, provisional) values
  ('aaaa0000-0000-4000-8000-000000000001', 1000, 3, false);
insert into public.competition_awards (competition_id, period_type, period_key, user_id, points) values
  ('2222aaaa-0000-4000-8000-000000000001', 'round', '2026-08-10',
   'bbbb0000-0000-4000-8000-000000000002', 9);

-- ---------------------------------------------------------------------------
-- Katalogret: hver linje er en sætning, en angriber ville prøve
-- ---------------------------------------------------------------------------
create temporary table forventning (nr int, navn text, sql text, forventet text);
insert into forventning values
 ( 1, 'profiles: gør mig selv til admin',
      $s$update public.profiles set is_admin = true where id = auth.uid()$s$, 'afvist'),
 ( 2, 'profiles: omdøb en anden bruger',
      $s$update public.profiles set display_name = 'Kapret'
          where id = 'bbbb0000-0000-4000-8000-000000000002'$s$, 'nul'),
 -- Den ene, der IKKE er en selvfølge. Se noten under katalogret.
 ( 3, 'group_members: meld mig ind i en fremmed liga som medlem',
      $s$insert into public.group_members (group_id, user_id, role)
         values ('1111aaaa-0000-4000-8000-000000000001', auth.uid(), 'member')$s$, 'tilladt'),
 ( 4, 'group_members: meld mig ind som ADMIN i en fremmed liga',
      $s$insert into public.group_members (group_id, user_id, role)
         values ('1111aaaa-0000-4000-8000-000000000001', auth.uid(), 'admin')$s$, 'afvist'),
 ( 5, 'group_members: forfrem mig selv til admin bagefter',
      $s$update public.group_members set role = 'admin' where user_id = auth.uid()$s$, 'nul'),
 ( 6, 'group_members: smid et andet medlem ud',
      $s$delete from public.group_members
          where user_id = 'bbbb0000-0000-4000-8000-000000000002'$s$, 'nul'),
 ( 7, 'groups: omdøb en fremmed liga',
      $s$update public.groups set name = 'Kapret'
          where id = '1111aaaa-0000-4000-8000-000000000001'$s$, 'nul'),
 ( 8, 'competition_matches: føj en kamp til en fremmed konkurrence',
      $s$insert into public.competition_matches (competition_id, match_id)
         values ('2222aaaa-0000-4000-8000-000000000001','ffff0000-0000-4000-8000-000000000001')$s$, 'afvist'),
 ( 9, 'competition_matches: fjern en kamp fra en fremmed konkurrence',
      $s$delete from public.competition_matches
          where competition_id = '2222aaaa-0000-4000-8000-000000000001'$s$, 'nul'),
 (10, 'predictions: tip i en andens navn',
      $s$insert into public.predictions (user_id, match_id, pred_home, pred_away)
         values ('bbbb0000-0000-4000-8000-000000000002','ffff0000-0000-4000-8000-000000000001',5,0)$s$, 'afvist'),
 (11, 'matches: skriv et resultat uden at være admin',
      $s$update public.matches set home_score = 9, away_score = 0
          where id = 'ffff0000-0000-4000-8000-000000000001'$s$, 'nul'),
 (12, 'competition_awards: giv mig selv en titel',
      $s$insert into public.competition_awards (competition_id, period_type, period_key, user_id, points)
         values ('2222aaaa-0000-4000-8000-000000000001','month','2026-08', auth.uid(), 99)$s$, 'afvist'),
 (13, 'ratings: sæt min egen rating',
      $s$update public.ratings set rating = 9999 where user_id = auth.uid()$s$, 'nul'),
 (14, 'milestones: giv mig selv en bedrift',
      $s$insert into public.milestones (user_id, key) values (auth.uid(), 'FAKE')$s$, 'afvist'),
 (15, 'stories: skriv mig selv en historie',
      $s$insert into public.stories (user_id, rule, headline)
         values (auth.uid(), 'FAKE', 'Jeg vandt alt')$s$, 'afvist'),
 (16, 'analytics_events: log en hændelse som en anden bruger',
      $s$insert into public.analytics_events (user_id, event_name)
         values ('bbbb0000-0000-4000-8000-000000000002','fake')$s$, 'afvist'),
 (17, 'feedback: send feedback i en andens navn',
      $s$insert into public.feedback (user_id, kind, message)
         values ('bbbb0000-0000-4000-8000-000000000002','bug','ikke mig')$s$, 'afvist'),
 (18, 'teams: omdøb et hold',
      $s$update public.teams set name = 'Hacket'
          where id = 'eeee0000-0000-4000-8000-000000000001'$s$, 'nul'),
 (19, 'job_runs: forfalsk en jobkørsel',
      $s$insert into public.job_runs (job, ok) values ('sync-matches', true)$s$, 'afvist'),
 (20, 'seasons: markér en sæson som afsluttet',
      $s$update public.seasons set is_finished = true
          where id = 'dddd0000-0000-4000-8000-000000000001'$s$, 'nul');

-- Kør én sætning som A og svar med udfaldet — `afvist`, `nul` eller `tilladt`.
create function pg_temp.udfald(p_sql text) returns text
language plpgsql as $$
declare v_rows bigint; v_bruger text;
begin
  begin
    perform set_config('test.uid', 'aaaa0000-0000-4000-8000-000000000001', true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    v_bruger := current_user;
    execute p_sql;
    get diagnostics v_rows = row_count;
    reset role;
    -- Uden dette led ville hele filen kunne bestå som superbruger, hvis
    -- rolleskiftet en dag holdt op med at virke — altså en test, der måler
    -- ejerens rettigheder og kalder dem brugerens.
    if v_bruger <> 'authenticated' then
      raise exception 'rolleskiftet virkede ikke: kørte som %', v_bruger;
    end if;
    return case when v_rows > 0 then 'tilladt' else 'nul' end;
  exception
    when insufficient_privilege then reset role; return 'afvist';
    when others then
      if sqlstate = 'P0001' then raise; end if;
      reset role; return 'afvist';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Påstandene
-- ---------------------------------------------------------------------------
do $$
declare
  v_afvigere text;
  v_kolonner text;
  v_faktisk  text;
  v_ventet   text;
begin
  -- 1) Fortegnelsen over skrive-policies
  select string_agg(tablename || ':' || cmd, ', ' order by tablename, cmd)
    into v_faktisk
    from pg_policies where schemaname = 'public' and cmd <> 'SELECT';
  v_ventet := 'analytics_events:INSERT, client_errors:INSERT, competition_matches:INSERT, '
           || 'competition_participants:DELETE, competition_participants:DELETE, '
           || 'competition_participants:INSERT, competition_participants:UPDATE, '
           || 'competitions:DELETE, competitions:DELETE, competitions:INSERT, '
           || 'feedback:INSERT, group_members:DELETE, group_members:INSERT, '
           || 'groups:DELETE, groups:INSERT, groups:UPDATE, matches:INSERT, matches:UPDATE, '
           || 'predictions:DELETE, predictions:INSERT, predictions:UPDATE, '
           || 'profiles:INSERT, profiles:UPDATE, push_subscriptions:ALL, stories:UPDATE';
  if v_faktisk is distinct from v_ventet then
    -- RAISE tager en LITERAL som format og ikke et udtryk; to literaler skilt
    -- af et linjeskift sættes sammen af parseren, en `||` gør ikke.
    raise exception E'1) skrive-fladen har flyttet sig.\nNU:      %\nVENTET:  %\n'
      'Er en policy tilføjet med vilje, opdateres listen HER sammen med den — '
      'RLS er et OR mellem permissive policies, så en ny kan kun gøre fladen større.',
      v_faktisk, v_ventet;
  end if;

  -- 2) Ingen skrivbar view uden security_invoker
  select string_agg(c.relname, ', ' order by c.relname) into v_afvigere
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join information_schema.views v
      on v.table_schema = 'public' and v.table_name = c.relname
   where n.nspname = 'public' and c.relkind = 'v'
     and (v.is_updatable = 'YES' or v.is_insertable_into = 'YES')
     and (has_table_privilege('authenticated', c.oid, 'INSERT')
       or has_table_privilege('authenticated', c.oid, 'UPDATE')
       or has_table_privilege('authenticated', c.oid, 'DELETE'))
     and not exists (select 1 from pg_options_to_table(c.reloptions) o
                      where o.option_name = 'security_invoker'
                        and o.option_value in ('on', 'true'));
  if v_afvigere is not null then
    raise exception '2) auto-opdaterbar view uden security_invoker, som authenticated kan skrive i: % — skrivningen ville køre som viewets EJER og gå uden om RLS', v_afvigere;
  end if;

  -- 3) `profiles`' kolonne-rettighed (B29)
  select string_agg(column_name, ', ' order by column_name) into v_kolonner
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'profiles'
     and grantee = 'authenticated' and privilege_type = 'UPDATE';
  if v_kolonner is distinct from 'display_name, id' then
    raise exception '3) authenticated må skrive disse kolonner på profiles: % — forventede kun id og display_name', coalesce(v_kolonner, 'ingen');
  end if;

  -- 4) Katalogret
  select string_agg(format(E'\n   %s. %s\n      ventet: %s, fik: %s', f.nr, f.navn, f.forventet, u.fik),
                    '' order by f.nr)
    into v_afvigere
    from forventning f
    cross join lateral (select pg_temp.udfald(f.sql) as fik) u
   where u.fik is distinct from f.forventet;
  if v_afvigere is not null then
    raise exception E'4) skrivninger med et andet udfald end forventet:%\n\n'
      'Blev noget "tilladt", der før var "afvist" eller "nul", er en dør gået op. '
      'Er ændringen tilsigtet, rettes linjen her sammen med policyen.', v_afvigere;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- NOTEN TIL LINJE 3 — den ene `tilladt`, der ikke er en selvfølge
-- ---------------------------------------------------------------------------
-- En bruger kan melde sig ind i ENHVER liga, hvis id hun kender, uden invitation:
-- `group_members_insert_self` kræver kun `user_id = auth.uid()` og `role =
-- 'member'`. Og id'et er ikke svært at få fat i — `groups_select_all` er
-- `using (true)`, så hver eneste indloggede bruger kan læse hver eneste liga,
-- INKLUSIVE `invite_code`. Det samme gælder `competitions` (`read all
-- competitions`).
--
-- Policyen er `true`, fordi klienten selv slår ligaen op på koden
-- (`src/lib/data/groups.js`), og opslaget sker FØR man er medlem. Den brede
-- læsning er altså prisen for, at join-flowet er et tabelopslag og ikke en
-- funktion.
--
-- **Det er ikke den fejlklasse, `B29` fandt** — dér kunne en KOLONNE skrives,
-- som ingen policy kunne beskytte. Her gør policyen præcis, hvad der står i
-- den; spørgsmålet er, om det er den rigtige regel. Derfor står linjen som
-- `tilladt` og ikke som en fejl: testen beskriver fladen, som den ER, og skal
-- ikke foregribe en beslutning, der ikke er truffet.
--
-- Skal det laves om, er det join-flowet, der skal ændres (et opslag på koden i
-- en `security definer`-funktion, som svarer med ÉN liga frem for at åbne
-- tabellen) — og så skal linje 3 herover skifte til `afvist` i samme ombæring.

select 'write_surface: fortegnelsen og alle 20 skrivninger er som ventet' as resultat;
