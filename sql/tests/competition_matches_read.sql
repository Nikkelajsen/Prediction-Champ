-- Test af `sql/competition_matches_read.sql` (G94).
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR DET RIGTIGE SKEMA, OG HVORFOR DET HER ER DEN ENESTE MULIGE FORM
-- Testen måler en RLS-policy, og en påstand om en policy kan kun stilles, hvis
-- alle de andre policies er der. Det var `G91`s lære, betalt kontant: en test
-- mod et miniskema påstod, at en liga-admin ikke kunne framelde sig selv, og
-- det var forkert, fordi den policy, der afgør sagen, ikke fandtes i skemaet.
-- Her ville et miniskema desuden ikke kunne bære påstand 3 overhovedet —
-- `competition_status` er en `security_invoker`-view oven på
-- `competition_matches`, og det er hele mekanismen, symptomet gik igennem.
--
-- Testen indlæser skemaet FØRST og migreringen BAGEFTER, hvilket er den
-- rigtige rækkefølge og ikke en tilfældighed: migreringen gør her præcis, hvad
-- en kørsel i Supabase gør — erstatter den policy, der står i forvejen.
--
-- **Den gamle policy sættes op af testen selv** og læses IKKE af `schema.sql`.
-- Sådan var det ikke oprindeligt, og det kostede en rød CI 10. august 2026:
-- snapshottet bar den gamle regel, indtil migreringen blev kørt i produktionen,
-- og skiftede derefter side. Begrundelsen står i fuld længde ved selve
-- opsætningen nedenfor.
--
-- HVAD DEN BEVISER
--   1. Der er nøjagtig ÉN læsepolicy på tabellen bagefter. To ville betyde, at
--      tautologien stod tilbage under et andet navn — og fordi RLS er et OR
--      mellem permissive policies, ville den gamle så stadig gælde, uden at
--      nogen kunne se det på den nye.
--   2. Reglen er ordret nabolagets. `competition_participants`, `matches`,
--      `leagues` og `seasons` har alle `auth.role() = 'authenticated'`, og
--      pointen med rettelsen var netop at gøre dem ens. Påstanden sammenligner
--      dem derfor med hinanden frem for med en streng, testen selv har skrevet.
--      *(`competitions` stod på listen indtil 12. august 2026 og er taget ud:
--      `A40` smalnede den med vilje, så den ikke længere ER en nabo med samme
--      regel. Se begrundelsen ved selve påstanden.)*
--   3. **Regressionen:** en bruger UDEN en eneste deltagelse ser nu ligaens
--      kampe og dens `competition_status`. Det var symptomet — den netop
--      inviterede så hver konkurrence som "0 kampe" — og påstanden er skrevet
--      på begge tabeller, fordi det var viewet, brugeren mærkede.
--   4. En deltager ser stadig det samme som før. Rettelsen må ikke være en
--      ombytning af, hvem der er lukket ude.
--   5. `anon` er stadig lukket ude. `auth.role()` er ikke et frikort: reglen
--      siger `authenticated`, og en ikke-logget-ind læser skal have nul rækker.
--      Uden påstanden ville `using (true)` bestå de fire foregående.
--
-- EFTERPRØVET MED MUTATION. Migreringen er ændret seks gange og testen set
-- fejle hver gang: reglen sat til `true`, reglen sat tilbage til tautologien,
-- reglen sat til den "tilsigtede" scoping (påstand 2 fanger alle tre), `drop
-- policy` fjernet, policyen omdøbt, og — den farlige — den gamle policy ladt
-- stående ved siden af en ny under et andet navn, som kun påstand 1 kan se.
--
-- De to første af de fem fanges allerede, når migreringen læses, fordi
-- `create policy` uden `drop` støder ind i den, skemaet har. Det er en gyldig
-- fangst, men en anden slags: den siger, at filen ikke kan køres, ikke at
-- reglen er forkert.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d cmtest -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d cmtest -v ON_ERROR_STOP=1 -b -f sql/tests/competition_matches_read.sql

\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------------------
-- Fixture — bygget FØR migreringen, så påstand 3 kan måles i begge tilstande
-- ---------------------------------------------------------------------------

-- Rating- og Story Engine-triggerne har intet med policies at gøre og ville kun
-- gøre kørslen langsom. Samme greb som i `sql/tests/liga_admin.sql`.
alter table public.matches disable trigger all;

insert into auth.users (id) values
  ('a0000000-0000-4000-8000-000000000001'),   -- DELTAGER
  ('a0000000-0000-4000-8000-000000000002');   -- NYBEGYNDER: ligamedlem, deltager i intet
insert into public.profiles (id, display_name) values
  ('a0000000-0000-4000-8000-000000000001', 'Deltager'),
  ('a0000000-0000-4000-8000-000000000002', 'Nybegynder');

insert into public.leagues (id, name) values
  ('b0000000-0000-4000-8000-000000000001', 'Testligaen');
insert into public.seasons (id, league_id, name) values
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', '25/26');
insert into public.teams (id, league_id, name) values
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Hjemme'),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Ude');
insert into public.matches (id, season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score) values
  ('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002',
   now() - interval '5 days', 2, 1);

-- Ligaen, begge er medlem af. Det er dét, der gør NYBEGYNDER til en rigtig
-- bruger og ikke en konstruktion: hun har taget imod en invitation og står på
-- ligasiden, hvor kortene tegnes.
insert into public.groups (id, name, created_by) values
  ('f0000000-0000-4000-8000-000000000001', 'Vennerne', 'a0000000-0000-4000-8000-000000000001');
insert into public.group_members (group_id, user_id, role) values
  ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'admin'),
  ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'member');

insert into public.competitions (id, name, mode, created_by, group_id) values
  ('01000000-0000-4000-8000-000000000001', 'Ligaens konkurrence', 'custom',
   'a0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001');
insert into public.competition_matches (competition_id, match_id) values
  ('01000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001');
-- Kun DELTAGER melder sig til. NYBEGYNDER har "Deltag"-knappen foran sig.
insert into public.competition_participants (competition_id, user_id) values
  ('01000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');

-- Hvad ser en bestemt bruger? Returnerer de to tal, ligasidens kort hviler på.
create function pg_temp.syn(p_uid uuid, p_rolle text default 'authenticated')
returns table(kampe bigint, status bigint) language plpgsql as $$
begin
  perform set_config('test.uid', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_rolle, true);
  execute format('set local role %I', p_rolle);
  return query select (select count(*) from public.competition_matches),
                      (select count(*) from public.competition_status);
end $$;

-- ---------------------------------------------------------------------------
-- Den GAMLE policy sættes op af testen selv
-- ---------------------------------------------------------------------------
-- **Testen hentede indtil 10. august 2026 den gamle policy fra `schema.sql`,
-- og dén antagelse udløb den dag.** Migreringen blev kørt i produktionen,
-- skema-eksporten fangede den rettede regel, og den negative kontrol nedenfor
-- kunne ikke længere genskabe fejlen: `nybegynderen skulle se 0/0 med den
-- GAMLE policy, men så 1/1`. Testen var altså selvophævende — den blev rød i
-- præcis det øjeblik, den beviste, at rettelsen var nået frem.
--
-- Det er ikke et særtilfælde for denne test, men et vilkår for enhver test, der
-- måler en migrering mod et øjebliksbillede af produktionen: snapshottet
-- skifter side, når migreringen køres. **Derfor ejer testen nu sin egen
-- før-tilstand** og læser den ikke af skemaet. Formen nedenfor er den, der stod
-- i produktionen indtil #50 blev kørt, ordret fra hovedet i
-- `sql/competition_matches_read.sql`.
--
-- Migreringen dropper og gen-opretter policyen under samme navn, så den er
-- stadig under test: den skal stadig erstatte det, der står her.
drop policy if exists "read competition matches" on public.competition_matches;
create policy "read competition matches" on public.competition_matches
  for select
  using (exists (select 1 from public.competition_participants cp
                  where cp.competition_id = cp.competition_id
                    and cp.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- FØR migreringen: fixturen SKAL vise fejlen, ellers beviser testen ingenting
-- ---------------------------------------------------------------------------
-- Uden dette afsnit kunne påstand 3 bestå, fordi fixturen tilfældigvis var
-- harmløs. Det er samme krav som `G92`s "negativ kontrol før påstand": en test,
-- man ikke har set fejle, er en formodning. Kontrollen er uændret og har nu
-- fået sin egen betingelse skrevet ovenfor frem for lånt af et snapshot.

do $$
declare r record;
begin
  select * into r from pg_temp.syn('a0000000-0000-4000-8000-000000000002');
  if r.kampe <> 0 or r.status <> 0 then
    raise exception 'fixturen holder ikke: nybegynderen skulle se 0/0 med den GAMLE policy, men så %/%',
      r.kampe, r.status;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Migreringen under test
-- ---------------------------------------------------------------------------

\ir ../competition_matches_read.sql

-- ---------------------------------------------------------------------------
-- Påstandene
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_antal int;
  v_regel text;
  v_afvigere text;
begin
  -- 1) Præcis én læsepolicy
  select count(*) into v_antal from pg_policies
   where tablename = 'competition_matches' and cmd = 'SELECT';
  if v_antal <> 1 then
    raise exception '1) forventede én læsepolicy på competition_matches, fandt % — står den gamle tautologi tilbage under et andet navn?', v_antal;
  end if;

  -- 2) Reglen er nabolagets, målt mod naboerne selv
  select qual into v_regel from pg_policies
   where tablename = 'competition_matches' and cmd = 'SELECT';
  select string_agg(tablename || ' (' || coalesce(qual, 'ingen') || ')', ', ' order by tablename)
    into v_afvigere
    from pg_policies
   where cmd = 'SELECT'
     -- `competitions` stod her indtil 12. august 2026 og er taget UD med vilje:
     -- `A40` smalnede dens læsepolicy til deltagere, ligamedlemmer og opretteren
     -- (`competitions_select_involved`), fordi `invite_code` ellers kunne høstes
     -- af enhver indlogget bruger. Den er altså ikke længere en nabo med samme
     -- regel — og det er et bevidst valg, ikke en afvigelse at melde.
     --
     -- Påstanden fandt det selv, da skema-eksporten kørte efter `A40`; indtil da
     -- bar dumpet den gamle, ensartede regel. Fjernes en tabel herfra igen, skal
     -- grunden stå ved siden af som her.
     and tablename in ('competition_participants', 'matches', 'leagues', 'seasons')
     and coalesce(qual, '') is distinct from coalesce(v_regel, '');
  if v_afvigere is not null then
    raise exception '2) reglen skal være den samme som naboernes — disse afviger nu: %', v_afvigere;
  end if;

  -- 3) REGRESSIONEN: nybegynderen ser ligaens kampe og dens status
  select * into r from pg_temp.syn('a0000000-0000-4000-8000-000000000002');
  if r.kampe <> 1 then
    raise exception '3) en bruger uden deltagelser ser stadig ikke ligaens kampe (fik % rækker)', r.kampe;
  end if;
  if r.status <> 1 then
    raise exception '3) competition_status er stadig tom for en bruger uden deltagelser (fik % rækker) — det var symptomet på ligasiden', r.status;
  end if;

  -- 4) Deltageren har ikke mistet noget
  select * into r from pg_temp.syn('a0000000-0000-4000-8000-000000000001');
  if r.kampe <> 1 or r.status <> 1 then
    raise exception '4) deltageren mistede adgang ved rettelsen: %/%', r.kampe, r.status;
  end if;

  -- 5) …og anon er stadig lukket ude. To udfald er begge rigtige, og det ene er
  --    stærkere end det andet: enten svarer policyen nul rækker, ELLER kaldet
  --    afvises allerede på tabel-adgangen, fordi `anon` mistede sine grants med
  --    `G50` og policyen derfor aldrig når at blive spurgt. Påstanden accepterer
  --    begge og afviser kun det tredje udfald — at der kommer rækker ud.
  begin
    select * into r from pg_temp.syn(null, 'anon');
    if r.kampe <> 0 or r.status <> 0 then
      raise exception '5) anon kan læse konkurrencens kampe (%/%) — reglen siger authenticated', r.kampe, r.status;
    end if;
  exception when insufficient_privilege then
    null;  -- lukket ude af grants, ikke af policyen. Endnu bedre.
  end;
end $$;

-- Idempotens: anden kørsel erstatter policyen uden at fejle og uden at lave to.
\ir ../competition_matches_read.sql

do $$
declare v_antal int;
begin
  select count(*) into v_antal from pg_policies
   where tablename = 'competition_matches' and cmd = 'SELECT';
  if v_antal <> 1 then
    raise exception 'gen-kørslen efterlod % læsepolicies', v_antal;
  end if;
end $$;

select 'competition_matches_read: OK' as result;
