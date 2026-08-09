-- Test af kontolukning ved anonymisering (B4) — den vej, brugeren selv går.
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVAD `G91` LAVEDE OM (9. august 2026) — TO TING, OG DEN ANDEN ER DEN VIGTIGE
--
-- 1. **Skemaet.** Filen byggede sit eget: femten tabeller med syntetiske
--    fremmednøgler, hvor `predictions.match_id` fx var et `gen_random_uuid()`,
--    som produktionens `references matches(id)` ville afvise med det samme. En
--    test, hvis rigtighed hviler på tabeller, den selv har opfundet, kan stå
--    grøn, mens funktionen fejler mod det rigtige skema.
--
-- 2. **Den testede funktion var AFLØST.** Filen indlæste kun
--    `\ir ../account_anonymization.sql` og prøvede dermed #31's selvstændige
--    `anonymize_my_account()` — en funktionskrop, INGEN kører. Produktionen
--    kører `sql/liga_admin.sql`s udgave, som er en tynd skal om
--    `_anonymize_account()` med `A25`s framelding og `A36`/`A37`s
--    admin-overdragelse oveni. Testen vogtede altså en funktion, der kun findes,
--    fordi migreringerne læses i rækkefølge.
--
--    **Valget faldt på at pege den om frem for at slette den.** De otte
--    påstande nedenfor findes ikke i `sql/tests/liga_admin.sql`, som handler om
--    administratorens grænser: pseudonymets form og længde, at brugssporet er
--    ryddet tabel for tabel, at spillet står uændret, at ligaen overlever, at
--    vennen er urørt, og at to lukkede konti ikke kolliderer. At folde dem ind i
--    en fil på 800 linjer ville have gjort begge filer sværere at læse for at
--    spare en fixture. De to filer deler nu skema og migreringer, men stiller
--    hvert sit spørgsmål: her "hvad sker der med MIN konto", dér "hvad må en
--    administrator".
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
--      Konkurrencen i fixturen har en SPILLET kamp, og det er nu et krav og ikke
--      en tilfældighed: `A25` melder den lukkede af alt, der ikke er begyndt.
--      Det skel kunne den gamle fil ikke måle — dens skema havde hverken
--      `matches` eller `competition_matches` — og den skrev derfor en advarsel
--      om, at påstanden kun gjaldt dens egen krop. Advarslen kan nu slettes:
--      reglen er den samme her og i produktionen, og dens fire udfald er dækket
--      af afsnit 12 i `sql/tests/liga_admin.sql`.
--   5. **Ligaen, A oprettede, findes stadig med alle sine medlemmer.** En
--      sletning ville have kaskaderet den væk via groups.created_by.
--   6. A's feedback-række overlever uden user_id.
--   7. B er fuldstændig urørt.
--   8. Andet kald er et no-op, og to brugere kan lukkes uden at kollidere på
--      unikhedsindekset.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d anontest -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d anontest -v ON_ERROR_STOP=1 -b -f sql/tests/account_anonymization.sql

\set ON_ERROR_STOP on
\timing off

-- Story Engine-triggeren på `matches` ville skrive sine egne historier, og
-- påstand 3 og 7 tæller netop historier. Samme greb og samme grund som i
-- `sql/tests/liga_admin.sql`.
alter table public.matches disable trigger all;

-- ---------- migreringerne under test ----------
-- Produktionens rækkefølge: #31 lægger `profiles.anonymized_at` og den
-- oprindelige `anonymize_my_account()`, og liga_admin.sql erstatter den med
-- skallen om `_anonymize_account()`. Det er skallen, der er under test — at
-- læse begge filer er samtidig en prøve på, at opdelingen kan lægges oven på
-- den gamle.
\ir ../account_anonymization.sql
\ir ../season_end.sql
\ir ../liga_admin.sql

-- ---------- fixture ----------
-- A lukker sin konto. B er vennen, hvis historik ikke må røre sig.
insert into auth.users (id, email, created_at) values
  ('aaaaaaaa-1111-2222-3333-444444444444', 'a@test.local', now()),
  ('bbbbbbbb-1111-2222-3333-444444444444', 'b@test.local', now());
insert into public.profiles (id, display_name, is_admin, last_seen_at) values
  ('aaaaaaaa-1111-2222-3333-444444444444', 'Anna', true,  now()),
  ('bbbbbbbb-1111-2222-3333-444444444444', 'Bo',   false, now());

-- Turneringen bag kampen. Den er ny med `G91`: kampen skal findes, for at
-- konkurrencen kan være BEGYNDT, og et tip skal pege på en rigtig kamp.
insert into public.leagues (id, name) values
  ('10000000-1111-2222-3333-444444444444', 'Testligaen');
insert into public.seasons (id, league_id, name, is_finished) values
  ('20000000-1111-2222-3333-444444444444', '10000000-1111-2222-3333-444444444444', '25/26', true);
insert into public.teams (id, league_id, name) values
  ('30000000-1111-2222-3333-444444444444', '10000000-1111-2222-3333-444444444444', 'Hjemme'),
  ('30000000-1111-2222-3333-555555555555', '10000000-1111-2222-3333-444444444444', 'Ude');
insert into public.matches (id, season_id, home_team_id, away_team_id, kickoff_at, home_score, away_score) values
  ('40000000-1111-2222-3333-444444444444', '20000000-1111-2222-3333-444444444444',
   '30000000-1111-2222-3333-444444444444', '30000000-1111-2222-3333-555555555555',
   now() - interval '20 days', 2, 1);

insert into public.groups (id, name, created_by) values
  ('50000000-1111-2222-3333-444444444444', 'Kontorligaen', 'aaaaaaaa-1111-2222-3333-444444444444');
insert into public.group_members (group_id, user_id, role) values
  ('50000000-1111-2222-3333-444444444444', 'aaaaaaaa-1111-2222-3333-444444444444', 'admin'),
  ('50000000-1111-2222-3333-444444444444', 'bbbbbbbb-1111-2222-3333-444444444444', 'member');

insert into public.competitions (id, name, mode, created_by, group_id) values
  ('60000000-1111-2222-3333-444444444444', 'Sæson 26/27', 'custom',
   'aaaaaaaa-1111-2222-3333-444444444444', '50000000-1111-2222-3333-444444444444');
insert into public.competition_matches (competition_id, match_id) values
  ('60000000-1111-2222-3333-444444444444', '40000000-1111-2222-3333-444444444444');
insert into public.competition_participants (competition_id, user_id) values
  ('60000000-1111-2222-3333-444444444444', 'aaaaaaaa-1111-2222-3333-444444444444'),
  ('60000000-1111-2222-3333-444444444444', 'bbbbbbbb-1111-2222-3333-444444444444');
insert into public.competition_awards (competition_id, period_type, period_key, user_id, points) values
  ('60000000-1111-2222-3333-444444444444', 'round', '2026-07-28',
   'aaaaaaaa-1111-2222-3333-444444444444', 3);

insert into public.predictions (user_id, match_id, pred_home, pred_away) values
  ('aaaaaaaa-1111-2222-3333-444444444444', '40000000-1111-2222-3333-444444444444', 2, 1),
  ('bbbbbbbb-1111-2222-3333-444444444444', '40000000-1111-2222-3333-444444444444', 0, 0);
insert into public.ratings (user_id, scope, rating, rounds_played, provisional) values
  ('aaaaaaaa-1111-2222-3333-444444444444', 'ALL', 1042, 4, false),
  ('bbbbbbbb-1111-2222-3333-444444444444', 'ALL',  998, 4, false);
insert into public.rating_history (user_id, scope, round_key, rating_after, delta, round_score, matches_predicted, rnk) values
  ('aaaaaaaa-1111-2222-3333-444444444444', 'ALL', '2026-07-28', 1042, 12, 3, 1, 1),
  ('bbbbbbbb-1111-2222-3333-444444444444', 'ALL', '2026-07-28',  998, -6, 1, 1, 2);

insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  ('aaaaaaaa-1111-2222-3333-444444444444', 'https://push/1', 'k1', 'a1'),
  ('bbbbbbbb-1111-2222-3333-444444444444', 'https://push/2', 'k2', 'a2');
insert into public.notification_log (user_id, key) values
  ('aaaaaaaa-1111-2222-3333-444444444444', 'deadline:2026-08-01'),
  ('bbbbbbbb-1111-2222-3333-444444444444', 'deadline:2026-08-01');
insert into public.stories (round_key, user_id, rule, priority, headline, body) values
  ('2026-07-28', 'aaaaaaaa-1111-2222-3333-444444444444', 'DUEL', 120, 'Anna overhalede Bo', 'Et point.'),
  ('2026-07-28', 'bbbbbbbb-1111-2222-3333-444444444444', 'DUEL', 120, 'Bo blev nr. 2',      'Et point.');
insert into public.analytics_events (user_id, event_name) values
  ('aaaaaaaa-1111-2222-3333-444444444444', 'login'),
  ('bbbbbbbb-1111-2222-3333-444444444444', 'login');
insert into public.user_activity_days (user_id, day) values
  ('aaaaaaaa-1111-2222-3333-444444444444', current_date),
  ('bbbbbbbb-1111-2222-3333-444444444444', current_date);
insert into public.feedback (user_id, kind, message) values
  ('aaaaaaaa-1111-2222-3333-444444444444', 'problem', 'Push virker ikke på min iPhone');
insert into public.client_errors (user_id, kind, message) values
  ('aaaaaaaa-1111-2222-3333-444444444444', 'error', 'TypeError hos Anna'),
  ('bbbbbbbb-1111-2222-3333-444444444444', 'error', 'TypeError hos Bo');

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
  -- Konkurrencen er BEGYNDT (dens kamp er spillet), så A25 frameldingen rører
  -- den ikke. Var kampen ikke spillet, ville rækken være væk — og det ville
  -- være rigtigt. Se afsnit 12 i sql/tests/liga_admin.sql.
  if (select count(*) from public.competition_participants where user_id = a) <> 1 then raise exception 'deltagelse forsvandt fra en konkurrence, der ER begyndt'; end if;
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
  -- A36/A37: administratorrollen gik videre til det eneste levende medlem, og
  -- den lukkede konto står tilbage som almindeligt medlem, fordi deltagelsen i
  -- den begyndte konkurrence forbyder at fjerne den. Påstanden er ny med `G91`
  -- — overdragelsen fandtes ikke i den funktion, filen testede før.
  if not exists (select 1 from public.group_members
                  where user_id = 'bbbbbbbb-1111-2222-3333-444444444444' and role = 'admin') then
    raise exception 'administratorrollen blev ikke overdraget til det levende medlem';
  end if;
  if exists (select 1 from public.group_members
              where user_id = 'aaaaaaaa-1111-2222-3333-444444444444' and role = 'admin') then
    raise exception 'den lukkede konto står stadig som administrator';
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
