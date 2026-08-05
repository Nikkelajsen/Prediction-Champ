-- Test af kontolukning ved anonymisering (sql/account_anonymization.sql, B4).
--
-- Kører mod en TOM engangsdatabase (CI: postgres-service). Rører aldrig
-- produktion. Samme mønster som feedback.sql.
--
-- HVAD DEN BEVISER
--   1. Funktionen har NUL parametre. Det er ikke en stilkontrol — det er selve
--      adgangsgarantien: der findes ikke et bruger-id at forfalske.
--   2. Uden en session er den `forbidden`.
--   3. Efter kaldet er A's navn et pseudonym, og A's brugsspor er væk.
--   4. **A's tips, rating, ratinghistorik og kåringer står uændret**, og A er
--      stadig deltager og ligamedlem. Det er hele grunden til, at anonymisering
--      blev valgt frem for sletning — går denne påstand tabt, får vennernes
--      stillinger huller.
--      ⚠️ Deltagelses-påstanden gælder DENNE FILS krop og ikke produktionens.
--      Produktionen kalder `_anonymize_account()` (sql/liga_admin.sql), som
--      siden A25 også melder den lukkede af de konkurrencer, der IKKE er
--      begyndt. Skellet kan ikke måles her — dette skema har hverken `matches`
--      eller `competition_matches`, så en konkurrence kan ikke være begyndt —
--      og hører derfor hjemme i afsnit 12 af sql/tests/liga_admin.sql, hvor
--      begge tabeller findes. Den fulde regel er: begge kroppe bevarer
--      deltagelsen i alt, der er spillet.
--   5. **Ligaen, A oprettede, findes stadig med alle sine medlemmer.** En
--      sletning ville have kaskaderet den væk via groups.created_by.
--   6. A's feedback-række overlever uden user_id.
--   7. B er fuldstændig urørt.
--   8. Andet kald er et no-op, og to brugere kan lukkes uden at kollidere på
--      unikhedsindekset.

\set ON_ERROR_STOP on
\timing off

do $blk$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $blk$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $q$ select nullif(current_setting('test.uid', true), '')::uuid $q$;
create table if not exists auth.users (id uuid primary key);

-- ---------- minimalt skema ----------
-- Kun det, funktionen rører, plus de constraints, pseudonymet skal overholde.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  is_admin boolean not null default false,
  last_seen_at timestamptz
);
create unique index profiles_display_name_lower_idx on public.profiles (lower(display_name));
alter table public.profiles add constraint profiles_display_name_len
  check (char_length(btrim(display_name)) between 2 and 20);

create table public.push_subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, endpoint text);
create table public.notification_log   (user_id uuid not null references auth.users(id) on delete cascade, key text, primary key (user_id, key));
create table public.stories            (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, headline text);
create table public.analytics_events   (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, event_name text);
create table public.user_activity_days (user_id uuid not null references auth.users(id) on delete cascade, day date, primary key (user_id, day));
create table public.feedback           (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null, message text);
create table public.client_errors      (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null, message text);

-- Det, der SKAL overleve.
create table public.predictions     (user_id uuid not null references public.profiles(id) on delete cascade, match_id uuid, pred_home int, pred_away int, primary key (user_id, match_id));
create table public.ratings         (user_id uuid not null references public.profiles(id) on delete cascade, scope text, rating numeric, primary key (user_id, scope));
create table public.rating_history  (user_id uuid not null references public.profiles(id) on delete cascade, scope text, round_key date, rating_after numeric, primary key (user_id, scope, round_key));
create table public.groups          (id uuid primary key default gen_random_uuid(), name text, created_by uuid references public.profiles(id) on delete cascade);
create table public.group_members   (group_id uuid not null references public.groups(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, primary key (group_id, user_id));
create table public.competitions    (id uuid primary key default gen_random_uuid(), name text, created_by uuid references public.profiles(id));
create table public.competition_participants (competition_id uuid not null references public.competitions(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, primary key (competition_id, user_id));
create table public.competition_awards (competition_id uuid not null references public.competitions(id) on delete cascade, period_key text, user_id uuid not null references public.profiles(id) on delete cascade, primary key (competition_id, period_key, user_id));

grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- ---------- migreringen under test ----------
\ir ../account_anonymization.sql

-- ---------- fixture ----------
-- A lukker sin konto. B er vennen, hvis historik ikke må røre sig.
do $blk$
declare
  a uuid := 'aaaaaaaa-1111-2222-3333-444444444444';
  b uuid := 'bbbbbbbb-1111-2222-3333-444444444444';
  g uuid; c uuid;
begin
  insert into auth.users (id) values (a), (b);
  insert into public.profiles (id, display_name, is_admin, last_seen_at)
    values (a, 'Anna', true, now()), (b, 'Bo', false, now());

  insert into public.groups (name, created_by) values ('Kontorligaen', a) returning id into g;
  insert into public.group_members (group_id, user_id) values (g, a), (g, b);
  insert into public.competitions (name, created_by) values ('Sæson 26/27', a) returning id into c;
  insert into public.competition_participants (competition_id, user_id) values (c, a), (c, b);
  insert into public.competition_awards (competition_id, period_key, user_id) values (c, '2026-W31', a);

  insert into public.predictions (user_id, match_id, pred_home, pred_away)
    values (a, gen_random_uuid(), 2, 1), (b, gen_random_uuid(), 0, 0);
  insert into public.ratings (user_id, scope, rating) values (a, 'ALL', 1042), (b, 'ALL', 998);
  insert into public.rating_history (user_id, scope, round_key, rating_after)
    values (a, 'ALL', date '2026-07-28', 1042), (b, 'ALL', date '2026-07-28', 998);

  insert into public.push_subscriptions (user_id, endpoint) values (a, 'https://push/1'), (b, 'https://push/2');
  insert into public.notification_log (user_id, key) values (a, 'deadline:2026-08-01'), (b, 'deadline:2026-08-01');
  insert into public.stories (user_id, headline) values (a, 'Anna overhalede Bo'), (b, 'Bo blev nr. 2');
  insert into public.analytics_events (user_id, event_name) values (a, 'login'), (b, 'login');
  insert into public.user_activity_days (user_id, day) values (a, current_date), (b, current_date);
  insert into public.feedback (user_id, message) values (a, 'Push virker ikke på min iPhone');
  insert into public.client_errors (user_id, message) values (a, 'TypeError hos Anna'), (b, 'TypeError hos Bo');
end $blk$;

-- ---------- 1) funktionen har nul parametre ----------
do $blk$
declare n int;
begin
  select pronargs into n from pg_proc where proname = 'anonymize_my_account';
  if n is null then raise exception 'funktionen findes ikke'; end if;
  if n <> 0 then
    raise exception 'anonymize_my_account tager % parametre — den må ikke kunne pege på en anden bruger', n;
  end if;
end $blk$;

-- ---------- 2) uden session: forbidden ----------
do $blk$
begin
  perform set_config('test.uid', '', false);
  begin
    perform public.anonymize_my_account();
    raise exception 'kaldet lykkedes uden en session';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'forbidden' then raise exception 'forkert fejl: %', sqlerrm; end if;
  end;
end $blk$;

-- ---------- 3) A lukker sin konto ----------
do $blk$
declare
  a uuid := 'aaaaaaaa-1111-2222-3333-444444444444';
  v_navn text;
begin
  perform set_config('test.uid', a::text, false);
  v_navn := public.anonymize_my_account();

  if v_navn !~ '^Slettet [0-9a-f]+$' then raise exception 'uventet pseudonym: %', v_navn; end if;
  if char_length(v_navn) > 20 then raise exception 'pseudonymet er for langt: % tegn', char_length(v_navn); end if;

  if exists (select 1 from public.profiles where id = a and display_name = 'Anna') then
    raise exception 'navnet blev ikke skiftet';
  end if;
  if not exists (select 1 from public.profiles where id = a and anonymized_at is not null and not is_admin and last_seen_at is null) then
    raise exception 'profilen blev ikke lukket ordentligt';
  end if;

  -- brugssporet er væk
  if exists (select 1 from public.push_subscriptions where user_id = a) then raise exception 'push-abonnement tilbage'; end if;
  if exists (select 1 from public.notification_log   where user_id = a) then raise exception 'notifikationslog tilbage'; end if;
  if exists (select 1 from public.stories            where user_id = a) then raise exception 'historier tilbage'; end if;
  if exists (select 1 from public.analytics_events   where user_id = a) then raise exception 'hændelser tilbage'; end if;
  if exists (select 1 from public.user_activity_days where user_id = a) then raise exception 'aktive dage tilbage'; end if;

  -- feedback overlever uden afsender
  if not exists (select 1 from public.feedback where user_id is null and message like 'Push virker%') then
    raise exception 'feedback-rækken overlevede ikke uden user_id';
  end if;

  -- fejlrapporten overlever uden kobling til personen. Kontoen soft-lukkes,
  -- så FK'ens `on delete set null` udløses aldrig — funktionen SKAL selv nulle,
  -- ellers holder privatlivspolitikkens løfte ikke.
  if not exists (select 1 from public.client_errors where user_id is null and message = 'TypeError hos Anna') then
    raise exception 'fejlrapporten beholdt koblingen til den lukkede konto';
  end if;
end $blk$;

-- ---------- 4) spillet står uændret ----------
-- Den vigtigste påstand i filen: går den tabt, får vennernes stillinger huller,
-- og valget af anonymisering frem for sletning var forgæves.
do $blk$
declare a uuid := 'aaaaaaaa-1111-2222-3333-444444444444';
begin
  if (select count(*) from public.predictions    where user_id = a) <> 1 then raise exception 'tips forsvandt'; end if;
  if (select count(*) from public.ratings        where user_id = a) <> 1 then raise exception 'rating forsvandt'; end if;
  if (select count(*) from public.rating_history where user_id = a) <> 1 then raise exception 'ratinghistorik forsvandt'; end if;
  if (select count(*) from public.competition_awards where user_id = a) <> 1 then raise exception 'kåring forsvandt'; end if;
  if (select count(*) from public.competition_participants where user_id = a) <> 1 then raise exception 'deltagelse forsvandt'; end if;
  if (select count(*) from public.group_members where user_id = a) <> 1 then raise exception 'ligamedlemskab forsvandt'; end if;
end $blk$;

-- ---------- 5) ligaen og konkurrencen overlever med alle medlemmer ----------
do $blk$
begin
  if not exists (select 1 from public.groups where name = 'Kontorligaen') then
    raise exception 'ligaen forsvandt — det er præcis dét, sletning ville have gjort';
  end if;
  if (select count(*) from public.group_members) <> 2 then
    raise exception 'ligaen mistede medlemmer';
  end if;
  if not exists (select 1 from public.competitions where name = 'Sæson 26/27') then
    raise exception 'konkurrencen forsvandt';
  end if;
end $blk$;

-- ---------- 6) B er urørt ----------
do $blk$
declare b uuid := 'bbbbbbbb-1111-2222-3333-444444444444';
begin
  if not exists (select 1 from public.profiles where id = b and display_name = 'Bo' and anonymized_at is null) then
    raise exception 'B blev berørt';
  end if;
  if (select count(*) from public.stories where user_id = b) <> 1 then raise exception 'B mistede sin historie'; end if;
  if (select count(*) from public.analytics_events where user_id = b) <> 1 then raise exception 'B mistede sine hændelser'; end if;
  if (select count(*) from public.push_subscriptions where user_id = b) <> 1 then raise exception 'B mistede sit abonnement'; end if;
  if (select count(*) from public.client_errors where user_id = b) <> 1 then raise exception 'B mistede koblingen til sin fejlrapport'; end if;
end $blk$;

-- ---------- 7) idempotens + to lukkede konti kolliderer ikke ----------
do $blk$
declare
  a uuid := 'aaaaaaaa-1111-2222-3333-444444444444';
  b uuid := 'bbbbbbbb-1111-2222-3333-444444444444';
  n1 text; n2 text; nb text;
begin
  perform set_config('test.uid', a::text, false);
  n1 := public.anonymize_my_account();
  n2 := public.anonymize_my_account();
  if n1 <> n2 then raise exception 'andet kald gav et andet navn: % mod %', n1, n2; end if;

  perform set_config('test.uid', b::text, false);
  nb := public.anonymize_my_account();
  if nb = n1 then raise exception 'to lukkede konti fik samme pseudonym'; end if;

  if (select count(*) from public.profiles where anonymized_at is not null) <> 2 then
    raise exception 'forventede to lukkede konti';
  end if;
end $blk$;

\echo 'account_anonymization: OK'
