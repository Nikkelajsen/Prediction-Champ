-- Test for sql/security_hardening.sql (G14/G15/G16).
--
-- Kører mod en TOM engangsdatabase (CI: postgres-service; lokalt: en midlertidig
-- klynge). Rører aldrig produktion.
--
-- HVAD DEN BEVISER
-- At de tre huller faktisk er lukkede, og — lige så vigtigt — at de tre veje,
-- der SKAL virke, stadig virker:
--
--   G14  anon og en almindelig authenticated bruger kan ikke skrive i matches;
--        en admin kan; service_role kan (omgår RLS).
--   G15  anon og en almindelig bruger kan ikke kalde recompute_ratings() eller
--        admin_recompute_ratings(); en admin kan kalde wrapperen; og
--        rating-triggeren kan stadig kalde motoren, når en ADMIN skriver et
--        resultat — det er den kombination, revoke'en kunne have brækket.
--   G16  monthly_standings er invoker og giver nul rækker til anon, mens en
--        authenticated bruger ser præcis de samme tal som før.
--
-- HVORFOR DET SIDSTE PUNKT UNDER G15 ER TESTENS KERNE: triggeren er ikke
-- SECURITY DEFINER i sin oprindelige form, så den kører som skriveren. Fjerner
-- man EXECUTE fra `authenticated` uden at gøre triggeren definer, fejler ENHVER
-- admin-skrivning af et resultat — den mest brugte admin-handling i appen.
--
-- auth.uid()/auth.role() stubbes med session-GUC'er (test.uid/test.role), så
-- "kalderen" kan skiftes undervejs. Samme greb som sql/tests/competition_awards.sql.

\set ON_ERROR_STOP on
\timing off

-- ---------- roller ----------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;

-- ---------- auth-stubs ----------
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('test.role', true), '')
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

-- ---------- minimalt skema, som produktionen ser ud FØR migreringen ----------
drop table if exists predictions, matches, seasons, leagues, rating_history, ratings, profiles cascade;

create table public.profiles (
  id uuid primary key,
  display_name text,
  is_admin boolean not null default false
);
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

\ir ../rating_core.sql

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  home_team_id uuid,
  away_team_id uuid,
  kickoff_at timestamptz not null,
  home_score int,
  away_score int,
  status text,
  round_key date generated always as (public.round_key(kickoff_at)) stored
);
create table public.predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  pred_home int,
  pred_away int,
  unique (user_id, match_id)
);

-- generate_stories stubbes: rating-triggeren kalder den, men Story Engine er
-- ikke det, denne test måler.
create or replace function public.generate_stories(p_round text) returns void
  language plpgsql as $$ begin return; end $$;

\ir ../rating_trigger_optimization.sql

-- ---------- RLS og grants, præcis som i produktion før migreringen ----------
alter table public.matches enable row level security;
alter table public.predictions enable row level security;
alter table public.profiles enable row level security;

create policy "read matches" on public.matches for select using (auth.role() = 'authenticated');
create policy "insert matches" on public.matches for insert with check (auth.role() = 'authenticated');
create policy "update matches" on public.matches for update using (auth.role() = 'authenticated');
create policy "read profiles" on public.profiles for select using (auth.role() = 'authenticated');
create policy predictions_select_visible on public.predictions for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.matches m
      where m.id = predictions.match_id
        and (m.home_score is not null
             or (m.kickoff_at is not null and m.kickoff_at <= now() + interval '1 hour'))
    )
  );

grant usage on schema public to anon, authenticated, service_role;
grant all on table public.matches, public.predictions, public.profiles,
                  public.leagues, public.seasons to anon, authenticated, service_role;

-- ---------- gen-åbn de to huller, kildefilerne selv har lukket ----------
-- rating_core.sql og rating_trigger_optimization.sql er rettet i samme ombæring
-- som migreringen, så de importerede filer ovenfor leverer allerede den SIKRE
-- tilstand. Testen skal måle et skifte, ikke en tilstand, så den ruller de to
-- linjer tilbage til produktionen, som den så ud FØR migreringen. Uden dette
-- ville "FØR"-sektionen nedenfor bevise ingenting — den ville bare gentage
-- efter-tilstanden.
grant execute on function public.recompute_ratings() to anon, authenticated;
alter function public.recompute_ratings_if_scores_changed() security invoker;

-- monthly_standings i sin sårbare form (uden security_invoker), forenklet til
-- det, testen måler: én række pr. (måned, scope, bruger).
drop view if exists public.monthly_standings;
create view public.monthly_standings as
select to_char(date_trunc('month', m.kickoff_at), 'YYYY-MM') as month,
       'ALL'::text as scope,
       p.user_id,
       sum(public.pc_points(p.pred_home, p.pred_away, m.home_score, m.away_score))::int as total_points
from public.predictions p
join public.matches m on m.id = p.match_id
join public.seasons s on s.id = m.season_id
join public.leagues l on l.id = s.league_id and l.is_official
where m.home_score is not null and m.away_score is not null
group by 1, 2, 3;
grant select on public.monthly_standings to anon, authenticated, service_role;

-- ---------- data ----------
insert into public.profiles(id, display_name, is_admin) values
  ('11111111-1111-1111-1111-111111111111', 'Admin',  true),
  ('22222222-2222-2222-2222-222222222222', 'Spiller', false);

insert into public.leagues(id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Testliga');
insert into public.seasons(id, league_id, name) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '2026/27');
insert into public.matches(id, season_id, kickoff_at, home_score, away_score) values
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '2026-08-08 16:00+02', 2, 1),
  ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', '2026-08-15 16:00+02', null, null);
insert into public.predictions(user_id, match_id, pred_home, pred_away) values
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001', 2, 1),
  ('22222222-2222-2222-2222-222222222222', 'cccccccc-0000-0000-0000-000000000001', 1, 1);

-- ---------- hjælper: kør et udtryk som en rolle og fortæl om det lykkedes ----------
-- Returnerer 'OK:<antal rækker>' eller 'FEJL: <besked>'.
--
-- RÆKKETALLET ER IKKE PYNT. En UPDATE, hvis `using`-udtryk er falsk, rammer nul
-- rækker og kaster INGEN fejl — RLS filtrerer rækkerne væk i stedet for at
-- afvise sætningen. En test, der kun spurgte "kastede den?", ville derfor
-- rapportere en blokeret skrivning som en gennemført. (INSERT er anderledes: et
-- brudt `with check` ER en fejl.)
create or replace function public.try_as(p_role text, p_uid text, p_sql text)
returns text language plpgsql as $$
declare n bigint;
begin
  execute format('set local role %I', p_role);
  perform set_config('test.role', p_role, true);
  perform set_config('test.uid', coalesce(p_uid, ''), true);
  begin
    execute p_sql;
    get diagnostics n = row_count;
    reset role;
    return 'OK:' || n;
  exception when others then
    reset role;
    return 'FEJL: ' || sqlerrm;
  end;
end $$;

\echo ''
\echo '=========================================================='
\echo 'FØR MIGRERINGEN — hullerne skal være ÅBNE (dokumentation)'
\echo '=========================================================='

select 'G14 før: almindelig bruger skriver resultat' as tilfaelde,
       public.try_as('authenticated', '22222222-2222-2222-2222-222222222222',
         $$update public.matches set home_score = 9, away_score = 0
           where id = 'cccccccc-0000-0000-0000-000000000001'$$) as resultat,
       'OK:1' as forventet;

select 'G15 før: anon kalder recompute_ratings()' as tilfaelde,
       public.try_as('anon', null, $$select public.recompute_ratings()$$) as resultat,
       'OK:*' as forventet;

select 'G16 før: anon læser monthly_standings' as tilfaelde,
       (select count(*) from public.monthly_standings) > 0 as raekker_findes;

-- ryd op efter det sabotage-update, testen lige lavede
update public.matches set home_score = 2, away_score = 1
where id = 'cccccccc-0000-0000-0000-000000000001';

\echo ''
\echo '=========================================================='
\echo 'MIGRERINGEN'
\echo '=========================================================='

\ir ../security_hardening.sql

\echo ''
\echo '=========================================================='
\echo 'EFTER MIGRERINGEN'
\echo '=========================================================='

-- ---------------------------------------------------------------------------
-- G14
-- ---------------------------------------------------------------------------
do $do$
declare v text;
begin
  -- 'OK:0' er den blokerede UPDATE: RLS filtrerede rækken væk, sætningen kastede
  -- ikke. Derfor sammenlignes der med rækketallet og ikke med "kastede den?".
  v := public.try_as('authenticated', '22222222-2222-2222-2222-222222222222',
        $$update public.matches set home_score = 9
          where id = 'cccccccc-0000-0000-0000-000000000001'$$);
  if v <> 'OK:0' then raise exception 'G14: almindelig bruger kunne stadig RETTE et resultat (%)', v; end if;

  v := public.try_as('authenticated', '22222222-2222-2222-2222-222222222222',
        $$insert into public.matches(season_id, kickoff_at)
          values ('bbbbbbbb-0000-0000-0000-000000000001', '2026-09-01 16:00+02')$$);
  if v not like 'FEJL:%' then raise exception 'G14: almindelig bruger kunne stadig OPRETTE en kamp (%)', v; end if;

  v := public.try_as('anon', null,
        $$update public.matches set home_score = 9
          where id = 'cccccccc-0000-0000-0000-000000000001'$$);
  if v not like 'FEJL:%' then raise exception 'G14: anon kunne stadig rette et resultat (%)', v; end if;

  -- ... men admin SKAL kunne. Og bemærk: dette update udløser rating-triggeren,
  -- som kalder recompute_ratings() — den revoke, G15 lige lavede. Går denne
  -- linje igennem, er begge halvdele af G15 bevist på én gang.
  v := public.try_as('authenticated', '11111111-1111-1111-1111-111111111111',
        $$update public.matches set home_score = 3, away_score = 1
          where id = 'cccccccc-0000-0000-0000-000000000001'$$);
  if v <> 'OK:1' then raise exception 'G14: ADMIN kunne ikke rette et resultat: %', v; end if;

  v := public.try_as('service_role', null,
        $$update public.matches set status = 'finished'
          where id = 'cccccccc-0000-0000-0000-000000000001'$$);
  if v <> 'OK:1' then raise exception 'G14: service_role (syncen) kunne ikke skrive: %', v; end if;

  raise notice 'G14 OK — skrivning er admin/service_role-only, og begge veje virker stadig';
end $do$;

-- Triggeren skal FAKTISK have kørt under admin-skrivningen ovenfor, ikke bare
-- have ladet være med at fejle.
do $$
begin
  if not exists (select 1 from public.ratings where scope = 'ALL') then
    raise exception 'G15: rating-triggeren kørte ikke under admin-skrivningen';
  end if;
  raise notice 'G15 OK (trigger) — motoren blev kaldt af triggeren i en authenticated session';
end $$;

-- ---------------------------------------------------------------------------
-- G15
-- ---------------------------------------------------------------------------
do $do$
declare v text;
begin
  -- Her ER 'FEJL:%' den rigtige forventning: et manglende EXECUTE og et brudt
  -- is_admin-tjek kaster begge, modsat en RLS-filtreret UPDATE.
  v := public.try_as('anon', null, $$select public.recompute_ratings()$$);
  if v not like 'FEJL:%' then raise exception 'G15: anon kunne stadig kalde recompute_ratings() (%)', v; end if;

  v := public.try_as('authenticated', '22222222-2222-2222-2222-222222222222',
        $$select public.recompute_ratings()$$);
  if v not like 'FEJL:%' then raise exception 'G15: almindelig bruger kunne stadig kalde recompute_ratings() (%)', v; end if;

  v := public.try_as('anon', null, $$select public.admin_recompute_ratings()$$);
  if v not like 'FEJL:%' then raise exception 'G15: anon kunne kalde admin_recompute_ratings() (%)', v; end if;

  v := public.try_as('authenticated', '22222222-2222-2222-2222-222222222222',
        $$select public.admin_recompute_ratings()$$);
  if v not like 'FEJL:%' then raise exception 'G15: almindelig bruger kunne kalde admin_recompute_ratings() (%)', v; end if;

  v := public.try_as('authenticated', '11111111-1111-1111-1111-111111111111',
        $$select public.admin_recompute_ratings()$$);
  if v not like 'OK:%' then raise exception 'G15: ADMIN kunne ikke kalde admin_recompute_ratings(): %', v; end if;

  v := public.try_as('service_role', null, $$select public.recompute_ratings()$$);
  if v not like 'OK:%' then raise exception 'G15: service_role kunne ikke kalde motoren: %', v; end if;

  raise notice 'G15 OK — motoren er service_role-only, wrapperen er admin-only';
end $do$;

-- ---------------------------------------------------------------------------
-- G16
-- ---------------------------------------------------------------------------
do $do$
declare
  v_anon int;
  v_user int;
  v_pts  int;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'monthly_standings'
      and 'security_invoker=on' = any(c.reloptions)
  ) then
    raise exception 'G16: monthly_standings er stadig ikke security_invoker';
  end if;

  set local role anon;
  perform set_config('test.role', 'anon', true);
  perform set_config('test.uid', '', true);
  select count(*) into v_anon from public.monthly_standings;
  reset role;
  if v_anon <> 0 then raise exception 'G16: anon fik % rækker fra monthly_standings', v_anon; end if;

  set local role authenticated;
  perform set_config('test.role', 'authenticated', true);
  perform set_config('test.uid', '22222222-2222-2222-2222-222222222222', true);
  select count(*), max(total_points) into v_user, v_pts from public.monthly_standings;
  reset role;
  -- Begge spillere skal stadig være med: viewet tæller kun kampe MED resultat,
  -- og dem må enhver authenticated bruger se. Havde RLS skåret noget væk, ville
  -- tallet være 1 (kun brugerens egen række).
  if v_user <> 2 then
    raise exception 'G16: authenticated bruger så % rækker, forventede 2 (RLS skar for meget væk)', v_user;
  end if;

  raise notice 'G16 OK — anon får nul rækker, authenticated ser uændret % rækker', v_user;
end $do$;

\echo ''
\echo 'ALLE TESTS BESTÅET (G14, G15, G16)'
