-- Test for sql/feedback.sql (B14).
--
-- Kører mod en TOM engangsdatabase (CI: postgres-service). Rører aldrig
-- produktion. Samme mønster som security_hardening.sql, som `try_as` er lånt
-- fra.
--
-- HVAD DEN BEVISER
--   1. En almindelig bruger kan skrive sin egen melding — og kun sin egen.
--   2. Ingen bruger kan LÆSE tabellen. Det er ikke en detalje: uden en
--      select-policy er den eneste vej ind i andres meldinger den admin-gatede
--      RPC, og glider der en select-grant ind senere, skal denne test fejle.
--   3. anon kan hverken læse eller skrive.
--   4. De to constraints (kind, længde) afviser det, klienten ellers ville
--      skulle være ene om at fange.
--   5. Begge RPC'er svarer 'forbidden' til en ikke-admin — inklusive den, der
--      ellers ville kunne rette en andens melding til "behandlet".
--   6. only_open filtrerer, og set_handled kan slås til OG fra igen.
--
-- auth.uid()/auth.role() stubbes med session-GUC'er (test.uid/test.role).

\set ON_ERROR_STOP on
\timing off

-- ---------- roller ----------
-- Cluster-brede, ikke database-lokale: se advarslen i security_hardening.sql.
-- Denne test afhænger ikke af bypassrls, men opretter rollerne, hvis en
-- tidligere test ikke nåede det først.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;

-- ---------- auth-stubs ----------
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $$;
create table if not exists auth.users (id uuid primary key);
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid(), auth.role() to anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  is_admin boolean not null default false
);
grant usage on schema public to anon, authenticated;
grant select on public.profiles to anon, authenticated;

-- ---------- migreringen under test ----------
\ir ../feedback.sql

-- ---------- fixture ----------
-- u1 almindelig bruger, u2 almindelig bruger, ad admin.
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('99999999-9999-9999-9999-999999999999');
insert into public.profiles (id, display_name, is_admin) values
  ('11111111-1111-1111-1111-111111111111', 'Anna', false),
  ('22222222-2222-2222-2222-222222222222', 'Bo',   false),
  ('99999999-9999-9999-9999-999999999999', 'Admin', true);

-- ---------- hjælper ----------
-- Returnerer 'OK:<antal rækker>' eller 'FEJL: <besked>'. Rækketallet er ikke
-- pynt — se begrundelsen i security_hardening.sql: en RLS-filtreret UPDATE
-- kaster ingen fejl, den rammer bare nul rækker.
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

-- Sammenligner og fejler højlydt. `like` frem for lighed, fordi
-- fejlbeskederne fra Postgres bærer detaljer, testen ikke skal gentage.
create or replace function public.forvent(p_navn text, p_fik text, p_moenster text)
returns void language plpgsql as $$
begin
  if p_fik not like p_moenster then
    raise exception '% : fik "%", forventede "%"', p_navn, p_fik, p_moenster;
  end if;
end $$;

-- ---------- 1) skriv: egen række ja, andres nej ----------
do $blk$
declare u1 text := '11111111-1111-1111-1111-111111111111';
begin
  perform public.forvent('bruger skriver sin egen melding',
    public.try_as('authenticated', u1,
      $q$insert into public.feedback (kind, message) values ('problem', 'Push virker ikke på min iPhone')$q$),
    'OK:1');

  -- user_id sendes eksplicit med en ANDEN brugers id. Defaulten kan altså ikke
  -- alene bære sikkerheden — `with check` skal fange det.
  perform public.forvent('bruger kan ikke skrive i en andens navn',
    public.try_as('authenticated', u1,
      $q$insert into public.feedback (user_id, kind, message)
        values ('22222222-2222-2222-2222-222222222222', 'idea', 'Skrevet i Bos navn')$q$),
    'FEJL: new row violates row-level security%');

  -- Kolonnen er nullable (den skal overleve en slettet konto, punkt 7), så
  -- det er RLS og ikke `not null`, der holder anonyme rækker ude. `null =
  -- auth.uid()` er NULL og altså ikke sand — policyen afviser.
  perform public.forvent('user_id kan ikke sættes til null udenom defaulten',
    public.try_as('authenticated', u1,
      $q$insert into public.feedback (user_id, kind, message)
        values (null, 'idea', 'Uden afsender')$q$),
    'FEJL: new row violates row-level security%');
end $blk$;

-- ---------- 2) læs: ingen bruger kan ----------
do $blk$
begin
  perform public.forvent('bruger kan ikke læse tabellen',
    public.try_as('authenticated', '11111111-1111-1111-1111-111111111111',
      $q$select 1 from public.feedback$q$),
    'FEJL: permission denied for table feedback');

  -- Også sin egen: der findes ingen select-policy overhovedet, og klienten har
  -- ingen brug for at hente rækken igen.
  perform public.forvent('bruger kan ikke engang læse sin egen',
    public.try_as('authenticated', '11111111-1111-1111-1111-111111111111',
      $q$select 1 from public.feedback where user_id = auth.uid()$q$),
    'FEJL: permission denied for table feedback');
end $blk$;

-- ---------- 3) anon: hverken læs eller skriv ----------
do $blk$
begin
  perform public.forvent('anon kan ikke skrive',
    public.try_as('anon', null,
      $q$insert into public.feedback (kind, message) values ('other', 'Hej fra ingenmandsland')$q$),
    'FEJL: permission denied for table feedback');
  perform public.forvent('anon kan ikke læse',
    public.try_as('anon', null, $q$select 1 from public.feedback$q$),
    'FEJL: permission denied for table feedback');
end $blk$;

-- ---------- 4) constraints ----------
do $blk$
declare u1 text := '11111111-1111-1111-1111-111111111111';
begin
  perform public.forvent('ukendt kind afvises',
    public.try_as('authenticated', u1,
      $q$insert into public.feedback (kind, message) values ('spørgsmål', 'En fjerde slags')$q$),
    'FEJL: new row for relation "feedback" violates check constraint "feedback_kind_check"');

  perform public.forvent('for kort besked afvises',
    public.try_as('authenticated', u1, $q$insert into public.feedback (kind, message) values ('idea', 'hej')$q$),
    'FEJL: new row for relation "feedback" violates check constraint "feedback_message_len"');

  perform public.forvent('for lang besked afvises',
    public.try_as('authenticated', u1,
      $q$insert into public.feedback (kind, message) values ('idea', repeat('x', 2001))$q$),
    'FEJL: new row for relation "feedback" violates check constraint "feedback_message_len"');

  -- Grænserne selv er lovlige — ellers ville testen fastholde en grænse, der
  -- lå ét tegn forkert.
  perform public.forvent('præcis 4 tegn er lovligt',
    public.try_as('authenticated', u1, $q$insert into public.feedback (kind, message) values ('other', 'fire')$q$),
    'OK:1');
  perform public.forvent('præcis 2000 tegn er lovligt',
    public.try_as('authenticated', u1,
      $q$insert into public.feedback (kind, message) values ('idea', repeat('y', 2000))$q$),
    'OK:1');
end $blk$;

-- ---------- 5) RPC'erne er admin-gatede ----------
do $blk$
declare v_id uuid;
begin
  perform public.forvent('ikke-admin kan ikke læse listen',
    public.try_as('authenticated', '11111111-1111-1111-1111-111111111111',
      $q$select 1 from public.admin_feedback()$q$),
    'FEJL: forbidden');

  -- Id'et slås op HER (som testens ejer-rolle) og skrives ind i sætningen.
  -- Hentede kaldet det selv, ville det ramme select-spærringen fra punkt 2 og
  -- aldrig nå frem til RPC'ens vagt — testen ville da bestå af den forkerte
  -- grund og stadig bestå, hvis vagten blev fjernet.
  select id into v_id from public.feedback order by created_at limit 1;

  perform public.forvent('ikke-admin kan ikke markere som behandlet',
    public.try_as('authenticated', '22222222-2222-2222-2222-222222222222',
      format($q$select public.admin_feedback_set_handled(%L, true)$q$, v_id)),
    'FEJL: forbidden');

  perform public.forvent('anon kan ikke læse listen',
    public.try_as('anon', null, $q$select 1 from public.admin_feedback()$q$),
    'FEJL: forbidden');
end $blk$;

-- ---------- 6) admin: listen, filteret og markeringen ----------
do $blk$
declare
  ad text := '99999999-9999-9999-9999-999999999999';
  v_id uuid;
  n int;
begin
  perform set_config('test.uid', ad, false);
  perform set_config('test.role', 'authenticated', false);

  -- Tre gyldige meldinger blev skrevet ovenfor (1 + 2 grænsetilfælde).
  select count(*) into n from public.admin_feedback();
  if n <> 3 then raise exception 'admin_feedback() gav % rækker, forventede 3', n; end if;

  -- Navnet joines på — en melding, man ikke kan svare på, er halvt ubrugelig.
  if not exists (select 1 from public.admin_feedback() where display_name = 'Anna') then
    raise exception 'display_name blev ikke joinet på';
  end if;

  select id into v_id from public.admin_feedback() order by created_at limit 1;

  if public.admin_feedback_set_handled(v_id, true) is null then
    raise exception 'set_handled(true) returnerede intet tidsstempel';
  end if;

  select count(*) into n from public.admin_feedback(true);
  if n <> 2 then raise exception 'only_open gav % rækker, forventede 2', n; end if;

  -- Og tilbage igen: en fejlagtig markering skal kunne fortrydes.
  if public.admin_feedback_set_handled(v_id, false) is not null then
    raise exception 'set_handled(false) ryddede ikke handled_at';
  end if;
  select count(*) into n from public.admin_feedback(true);
  if n <> 3 then raise exception 'efter fortrydelse gav only_open % rækker, forventede 3', n; end if;
end $blk$;

-- ---------- 7) en slettet konto tager ikke meldingen med sig ----------
-- on delete SET NULL og ikke cascade, modsat analytics_events: fejlen, en
-- melding beskriver, findes stadig, efter den, der skrev den, er væk.
do $blk$
declare n int;
begin
  delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
  perform set_config('test.uid', '99999999-9999-9999-9999-999999999999', false);
  select count(*) into n from public.admin_feedback();
  if n <> 3 then raise exception 'meldingerne overlevede ikke sletningen (% tilbage)', n; end if;
  if not exists (select 1 from public.admin_feedback() where user_id is null) then
    raise exception 'user_id blev ikke sat til null ved sletning';
  end if;
end $blk$;

\echo 'feedback: OK'
