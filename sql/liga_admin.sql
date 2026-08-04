-- Leagly — hvad en administrator må: liga-admin rydder op, global admin lukker konti
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- Forudsætter sql/season_end.sql (afsnit 3 læser `competition_status.concluded`)
-- og sql/account_anonymization.sql (afsnit 4 bygger videre på `anonymized_at`).
--
-- ---------------------------------------------------------------------------
-- Den regel, der binder de tre liga-handlinger sammen
--
-- Liga-laget v1 udskød medlems-administration bevidst (spec afsnit 8): en lille
-- vennegruppe har ikke brug for en gatekeeper, og en admin-knap, der kan slette
-- andres historik, er den dyreste slags fejlklik.
--
-- Den begrundelse holder stadig — og derfor giver denne fil ikke liga-admin ret
-- til at slette noget, nogen har LAVET. Grænsen er den samme tre gange:
--
--     en administrator må fjerne det urørte, aldrig det brugte.
--
-- Ingen tips ⇒ ingen stilling at omskrive, intet point at tage fra nogen, ingen
-- kåring at omgøre. Det er en regel, der kan læses højt i en vennegruppe, og
-- den kan håndhæves af databasen frem for at bo i en knap.
--
-- ⚠️ AFLØSER `groups_delete_admin_empty` fra sql/groups.sql (afsnit 3). Gen-kør
-- ikke groups.sql efter denne fil — ellers ruller den gamle, strengere regel
-- tavst tilbage. Sker det, så kør denne fil umiddelbart efter. Samme fælde som
-- de to policies, groups.sql selv advarer om i sin egen header.

-- ======================= 1. Liga-admin fjerner en INAKTIV deltager =======================
--
-- Ved siden af `comp_participants_delete_own_unlocked` (sql/group_membership_invariant.sql),
-- som kun dækker én selv. De to har med vilje forskellige grænser:
--
--   * EGEN framelding er tilladt, når man ingen tips har på LÅSTE kampe — og
--     igen, når hele konkurrencen er spillet. Historikken er ens egen.
--   * ADMIN-fjernelse kræver, at deltageren aldrig har afgivet ét eneste tip i
--     konkurrencen. Det er en anden persons historik, og den må ikke kunne
--     forsvinde, fordi nogen ryddede op.
--
-- Liga-medlemskabet røres ikke. Invarianten i group_membership_invariant.sql er
-- "deltager ⇒ medlem", ikke omvendt, så et medlem uden deltagelse er en helt
-- almindelig tilstand — og personen kan trykke Deltag igen selv.
drop policy if exists comp_participants_delete_admin_untipped on public.competition_participants;
create policy comp_participants_delete_admin_untipped on public.competition_participants
  for delete to authenticated
  using (
    -- Egen framelding går ad den anden policy, med dens egne regler. Uden denne
    -- linje ville en liga-admin kunne framelde SIG SELV midt i en konkurrence,
    -- hvor vedkommende ingen tips har — og dermed have en løsere regel end sine
    -- egne medlemmer.
    user_id <> auth.uid()
    and exists (
      select 1 from public.competitions c
      where c.id = competition_participants.competition_id
        and c.group_id is not null
        and public.is_group_admin(c.group_id)
    )
    and not exists (
      select 1
      from public.competition_matches cm
      join public.predictions p
        on p.match_id = cm.match_id
       and p.user_id = competition_participants.user_id
      where cm.competition_id = competition_participants.competition_id
    )
  );

-- ======================= 2. Liga-admin sletter en konkurrence UDEN tips =======================
--
-- Ved siden af "creator deletes competitions", som bliver stående: opretteren må
-- stadig slette sin egen konkurrence, også en der er tippet i. Det er hans egen
-- oprettelse, og UI'et siger tydeligt, at sletningen gælder alle deltagere.
--
-- Admin-vejen er snævrere efter samme regel som ovenfor: en konkurrence, ingen
-- har tippet i, er en fejloprettelse — en, der ER tippet i, er nogens historik.
--
-- BEMÆRK, HVAD "TIPPET I" MÅ BETYDE. `predictions` er GLOBAL pr. kamp: ét tip
-- gælder i alle de konkurrencer, kampen indgår i (det er hele modellen — man
-- tipper en kamp, ikke en kupon). "Findes der et tip på en af konkurrencens
-- kampe" ville derfor være sandt for enhver konkurrence, der bruger en kamp fra
-- en officiel turnering — altså praktisk talt alle — og admin-vejen ville aldrig
-- kunne bruges. Spørgsmålet skal stilles om konkurrencens egne DELTAGERE: har
-- nogen af DEM et tip på en af DENS kampe, findes der en stilling at slette.
--
-- Den skelnen blev fundet af sql/tests/liga_admin.sql og ikke ved at læse
-- policyen — de to formuleringer ser ens ud, og forskellen viser sig kun, når en
-- udenforstående tilfældigvis har tippet den samme kamp.
drop policy if exists comp_delete_group_admin_untipped on public.competitions;
create policy comp_delete_group_admin_untipped on public.competitions
  for delete to authenticated
  using (
    group_id is not null
    and public.is_group_admin(group_id)
    and not exists (
      select 1
      from public.competition_participants cp
      join public.competition_matches cm on cm.competition_id = competitions.id
      join public.predictions p
        on p.match_id = cm.match_id
       and p.user_id = cp.user_id
      where cp.competition_id = competitions.id
    )
  );

-- ======================= 3. Liga-admin sletter en liga uden AKTIVE konkurrencer =======================
--
-- AFLØSER `groups_delete_admin_empty`. Den krævede NUL konkurrencer, hvilket i
-- praksis betød, at en liga aldrig kunne lukkes: en vennegruppe, der har spillet
-- en sæson færdig, har per definition en konkurrence liggende, og den kunne kun
-- fjernes af sin egen opretter.
--
-- Ny regel: ingen af ligaens konkurrencer må være uafsluttet — "afsluttet" i
-- `competition_status`' forstand, altså med sæson-gaten fra sql/season_end.sql.
-- Det er dét, der gør løsningen forsvarlig: en igangværende konkurrence spærrer
-- stadig, og en sæson, der bare venter på sit slutspil, tæller som igangværende.
--
-- Konkurrencerne SLETTES ikke. `competitions.group_id` er `on delete set null`
-- (sql/groups.sql), så de bliver liga-løse og står videre under "Øvrige
-- konkurrencer" med stilling, tips og kåringer i behold. Det er hele grunden
-- til, at reglen kan løsnes uden at blive destruktiv: der er intet at fortryde,
-- fordi der ikke forsvinder noget.
drop policy if exists groups_delete_admin_empty on public.groups;
drop policy if exists groups_delete_admin_inactive on public.groups;
create policy groups_delete_admin_inactive on public.groups
  for delete to authenticated
  using (
    public.is_group_admin(id)
    and not exists (
      select 1
      from public.competitions c
      left join public.competition_status cs on cs.competition_id = c.id
      -- `coalesce(…, false)`: en konkurrence uden kampe har ingen række i
      -- competition_status, og den er ikke afsluttet — den er ikke begyndt.
      where c.group_id = groups.id
        and coalesce(cs.concluded, false) = false
    )
  );

-- ======================= 4. Global admin lukker en anden konto =======================
--
-- `anonymize_my_account()` har NUL parametre med vilje (sql/account_anonymization.sql):
-- "der findes ikke et argument at forfalske". Den egenskab bevares — funktionen
-- beholder både sin signatur og sin vagt.
--
-- Kroppen flyttes til `_anonymize_account(uuid)`, som IKKE grantes til nogen
-- rolle og derfor kun kan nås gennem de to vagtede indgange. To indgange, én
-- krop: den dag anonymiseringen skal rydde en tabel mere, kan de to ikke komme
-- til at gøre forskellige ting. Det er samme begrundelse som `createCompetition`,
-- der har to kaldesteder og ét sted, hvor der skrives.
create or replace function public._anonymize_account(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_navn text;
  v_hex  int := 8;
begin
  if p_user_id is null then
    raise exception 'forbidden';
  end if;

  -- Allerede lukket: gør ingenting, men svar det samme, så kalderen kan gentage
  -- kaldet uden at skulle skelne.
  select display_name into v_navn from public.profiles
   where id = p_user_id and anonymized_at is not null;
  if found then
    return v_navn;
  end if;

  -- Navnet er unikt på lower(display_name) (profiles_display_name_lower_idx) og
  -- skal være 2–20 tegn (profiles_display_name_len). "Slettet bruger" kan
  -- derfor kun bruges ÉN gang. Otte hex-tegn af brugerens eget id giver 16 tegn
  -- og er unikt — men "unikt nok" er ikke godt nok, når fejlen ville ramme
  -- netop den, der har bedt om at forsvinde, så der forlænges ved kollision.
  loop
    v_navn := 'Slettet ' || left(replace(p_user_id::text, '-', ''), v_hex);
    exit when not exists (
      select 1 from public.profiles
      where lower(display_name) = lower(v_navn) and id <> p_user_id
    );
    v_hex := v_hex + 2;
    if v_hex > 12 then
      raise exception 'kunne ikke danne et ledigt pseudonym';
    end if;
  end loop;

  delete from public.push_subscriptions where user_id = p_user_id;
  delete from public.notification_log   where user_id = p_user_id;
  delete from public.stories            where user_id = p_user_id;
  delete from public.analytics_events   where user_id = p_user_id;
  delete from public.user_activity_days where user_id = p_user_id;

  update public.feedback set user_id = null where user_id = p_user_id;
  -- Kontoen soft-lukkes (auth.users-rækken består), så client_errors' egen
  -- `on delete set null` udløses aldrig — koblingen skal fjernes her.
  update public.client_errors set user_id = null where user_id = p_user_id;

  update public.profiles
     set display_name  = v_navn,
         anonymized_at = now(),
         is_admin      = false,
         last_seen_at  = null
   where id = p_user_id;

  return v_navn;
end $fn$;

revoke all on function public._anonymize_account(uuid) from public, anon, authenticated;

-- Uændret signatur, uændret vagt — kun kroppen er flyttet ud.
create or replace function public.anonymize_my_account()
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'forbidden';
  end if;
  return public._anonymize_account(v_uid);
end $fn$;

revoke all on function public.anonymize_my_account() from public, anon;
grant execute on function public.anonymize_my_account() to authenticated;

-- Admin-vejen. Tre afvisninger, og alle tre er grænsen — ikke bekvemmelighed:
--
--   * kalderen er ikke admin      — det er hele adgangskontrollen
--   * målet er kalderen selv      — en admin lukker sin EGEN konto ad den
--                                   almindelige vej. Ellers ville admin-stien
--                                   være en genvej uden om det forløb (og den
--                                   bekræftelse), enhver anden bruger møder.
--   * målet er selv admin         — to administratorer kan ikke lukke hinanden.
--                                   Uden den kunne én kompromitteret admin-konto
--                                   rydde alle de øvrige i ét kald.
--
-- Bemærk, at funktionen ikke rører `auth.users`. Selve kontolukningen gør
-- api/admin-close-account.js bagefter med service-nøglen — nøjagtig samme
-- rækkefølge og samme begrundelse som api/delete-account.js.
create or replace function public.admin_anonymize_account(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'forbidden';
  end if;
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'Din egen konto lukkes fra Profil, ikke herfra';
  end if;
  if exists (select 1 from public.profiles where id = p_user_id and is_admin) then
    raise exception 'En administrator kan ikke lukkes herfra';
  end if;
  return public._anonymize_account(p_user_id);
end $fn$;

revoke all on function public.admin_anonymize_account(uuid) from public, anon;
grant execute on function public.admin_anonymize_account(uuid) to authenticated;

-- ======================= Verifikation efter kørsel =======================
-- 1) De tre policies står, hvor de skal — og den gamle er væk:
--      select tablename, policyname, cmd from pg_policies
--       where schemaname = 'public'
--         and policyname in ('comp_participants_delete_admin_untipped',
--                            'comp_delete_group_admin_untipped',
--                            'groups_delete_admin_inactive',
--                            'groups_delete_admin_empty');
--    Tre rækker. `groups_delete_admin_empty` må IKKE være blandt dem.
--
-- 2) Anonymiseringen har stadig sin garanti — nul parametre på den egne vej:
--      select proname, pronargs from pg_proc
--       where proname in ('anonymize_my_account', 'admin_anonymize_account', '_anonymize_account');
--    anonymize_my_account = 0 · admin_anonymize_account = 1 · _anonymize_account = 1
--
-- 3) Den interne krop må ikke kunne kaldes af en bruger:
--      select has_function_privilege('authenticated', 'public._anonymize_account(uuid)', 'execute');
--    skal svare false.
