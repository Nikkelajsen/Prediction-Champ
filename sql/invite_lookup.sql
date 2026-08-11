-- Invitationskoden bliver hemmeligheden igen — TRIN 1 af 2 (A40).
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- ✅ **DENNE FIL ER SIKKER AT KØRE NÅR SOM HELST, OGSÅ FØR FRONTEND-MERGEN.**
-- Den TILFØJER kun: to funktioner, en hjælpefunktion og deres grants. Ingen
-- policy røres, ingen rettighed smalnes, ingen række ændres. Den nuværende
-- klient kalder ikke funktionerne og mærker derfor intet.
--
-- 🔴 **Selve hullet lukkes af trin 2, `sql/invite_policies.sql` (#53)**, som
-- SKAL køres EFTER at den nye klient er udrullet. Se rækkefølgen i den fil.
--
-- HVORFOR TO FILER OG IKKE ÉN. Første udgave var én migrering med instruksen
-- "kør sammen med frontend-mergen". Den instruks kan ikke følges: Supabase
-- køres i hånden, Vercel deployer af sig selv, og de to kan ikke ramme samme
-- sekund. Uanset hvilken rækkefølge man så valgte, var der et vindue, hvor
-- invitationer ikke virkede — enten fordi klienten slog op i en tabel, der lige
-- var blevet lukket, eller fordi den kaldte funktioner, der endnu ikke fandtes.
--
-- Delt i to har hvert trin en tilstand, hvor BEGGE udgaver af klienten virker,
-- og rækkefølgen er dermed et krav frem for et sammentræf:
--
--   1. Kør #52 (denne fil).  Gammel klient: uændret. Ny klient: virker.
--   2. Merge og udrul.       Gammel klient væk. Ny klient: virker.
--   3. Kør #53.              Hullet lukket. Ny klient: virker.
--
-- Vinduet mellem 1 og 3 er ikke gratis — hullet står åbent imens — men det har
-- stået åbent siden liga-laget blev bygget, og en time mere er en anden pris
-- end en invitation, ingen kan tage imod.
--
-- ---------------------------------------------------------------------------
-- HVAD DER VAR GALT
--
-- `groups_select_all` var `using (true)` og `read all competitions`
-- `auth.role() = 'authenticated'`. Enhver indlogget bruger kunne derfor læse
-- HVER liga og HVER konkurrence i appen — inklusive `invite_code`. Og
-- `group_members_insert_self` krævede kun `user_id = auth.uid()`, så et id var
-- nok til at melde sig ind.
--
-- To ting ganget sammen: koderne kunne høstes, og de var ikke engang
-- nødvendige. Fundet ved revisionen efter `B29` (10. august 2026) og efterprøvet
-- mod `sql/schema.sql`: et fremmed medlemskab blev skrevet, `INSERT 1`.
--
-- **Det er en anden fejlklasse end `B29`s.** Dér kunne en KOLONNE skrives, som
-- ingen policy kunne beskytte — der fandtes ingen måde at udtrykke reglen på.
-- Her gjorde policyen præcis, hvad der stod i den; spørgsmålet var, om det var
-- den rigtige regel. Svaret er nej, og reglen er nu:
--
--   **Du kan se og tilmelde dig en liga eller en konkurrence, hvis du allerede
--   er med i den — eller hvis du fremviser dens invitationskode.**
--
-- ---------------------------------------------------------------------------
-- HVORFOR BREDDEN VAR DER, OG HVORFOR DEN IKKE KUNNE FJERNES ALENE
--
-- Klienten slår ligaen op på koden med et almindeligt tabelopslag, og opslaget
-- sker FØR man er medlem. En smalnet policy uden et andet opslag ville derfor
-- ikke lukke et hul, men join-flowet. Rettelsen er en FLYTNING: opslaget og
-- selve tilmeldingen bor nu i to `security definer`-funktioner, som er de eneste
-- to steder, en kode veksles til adgang.
--
-- ---------------------------------------------------------------------------
-- HVORFOR TILMELDINGEN ER ÉN FUNKTION OG IKKE TO
--
-- `accept_invite()` melder ind i BÅDE liga og konkurrence, når koden peger på en
-- konkurrence i en liga. Lå de to i hver sin funktion, ville klienten skulle
-- kende sammenhængen — og `A8` er historien om, hvad der sker, når to kaldsteder
-- kender den hver for sig og driver fra hinanden.
--
-- ⚠️ **Her stod først, at rækkefølgen var reglen — at invarianten ville AFVISE
-- en deltagelse uden et medlemskab. Det passer ikke, og det er værd at have
-- skrevet ned.** `ensure_group_membership_for_participant()` er en BEFORE
-- INSERT-trigger, der **udfylder** medlemskabet (`on conflict do nothing`)
-- frem for at afvise. En deltagelse skrevet først ville altså ikke fejle; den
-- ville bare selv skabe medlemskabet. Fejlen blev fundet af en mutation, der
-- fjernede liga-indmeldingen herunder og IKKE fik testen til at fejle.
--
-- **Indmeldingen bliver alligevel stående, men af en anden grund end den, der
-- stod her — og den grund er nu dækket af påstand 8c.** Triggeren fyrer kun,
-- når der faktisk INDSÆTTES en deltager-række. Er brugeren allerede deltager,
-- men mangler medlemskabet — præcis `A8`s halve tilstand — sker der ingen
-- insert, triggeren fyrer ikke, og uden linjen herunder ville et nyt tryk på
-- invitationslinket ikke rette noget. At trykke på linket igen ER den naturlige
-- måde at forsøge at rette en halv tilstand på, så det skal faktisk rette den.
--
-- Funktionen er idempotent hele vejen af samme grund.

-- ---------------------------------------------------------------------------
-- 1. Opslaget: hvad peger koden på?
--
-- Returnerer `jsonb` og ikke en tabel, fordi de to udfald har forskellig form —
-- en liga har ingen `group_name`, en konkurrence har. Et `setof groups` ville
-- have krævet to funktioner og to rundture, og klienten skal kunne stille ét
-- spørgsmål: *hvad er det her for en kode?*
--
-- **Den skriver intet.** Bekræftelses-dialogen skal kunne vises, uden at
-- brugeren allerede er meldt ind — ellers er "Vil du være med?" et spørgsmål,
-- der er besvaret på forhånd.
--
-- `invite_code` udelades bevidst af svaret. Kalderen fremviste den selv, så det
-- er ikke en hemmelighed for dem — men et svar, der bærer den, ville lægge den i
-- klientens hukommelse og i enhver fejllog, svaret måtte passere.

create or replace function public.invite_lookup(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid   uuid := auth.uid();
  v_code  text := btrim(coalesce(p_code, ''));
  v_group public.groups%rowtype;
  v_comp  public.competitions%rowtype;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_code = '' then
    return jsonb_build_object('kind', 'none');
  end if;

  -- Ligaen først. Rækkefølgen er den samme som klientens gamle, og den er
  -- vilkårlig men skal være fast: koderne er fra to forskellige rum, og en kode,
  -- der tilfældigvis fandtes begge steder, skal give det samme svar hver gang.
  select * into v_group from public.groups where invite_code = v_code;
  if found then
    return jsonb_build_object(
      'kind', 'group',
      'group', jsonb_build_object(
        'id', v_group.id,
        'name', v_group.name,
        'created_by', v_group.created_by,
        'created_at', v_group.created_at),
      'already', exists (select 1 from public.group_members
                          where group_id = v_group.id and user_id = v_uid));
  end if;

  select * into v_comp from public.competitions where invite_code = v_code;
  if not found then
    return jsonb_build_object('kind', 'none');
  end if;

  return jsonb_build_object(
    'kind', 'competition',
    'competition', jsonb_build_object(
      'id', v_comp.id,
      'name', v_comp.name,
      'mode', v_comp.mode,
      'group_id', v_comp.group_id,
      'created_by', v_comp.created_by,
      'created_at', v_comp.created_at),
    -- De to navne er PYNT på bekræftelsen — samme rolle som i den klient, de
    -- afløser — men de hentes HER frem for i to ekstra rundture. Ligaens navn
    -- kunne den gamle klient kun få, fordi hver liga var læsbar for enhver.
    'group_name', (select name from public.groups where id = v_comp.group_id),
    'inviter_name', (select display_name from public.profiles where id = v_comp.created_by),
    'already', exists (select 1 from public.competition_participants
                        where competition_id = v_comp.id and user_id = v_uid));
end;
$$;

revoke execute on function public.invite_lookup(text) from public;
grant execute on function public.invite_lookup(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Tilmeldingen: veksl koden til adgang
--
-- Den ENESTE vej ind i en liga eller konkurrence, man ikke i forvejen er med i.
-- Alt andet går gennem policies, der kræver, at man allerede er med.
--
-- Bemærk `where not exists` frem for `on conflict do nothing`: det gør det
-- muligt at svare, om der faktisk skete noget (`joined`), og et svar, klienten
-- kan skelne på, er dét, der afgør, om der logges en hændelse. `on conflict`
-- ville skjule forskellen.

create or replace function public.accept_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid    uuid := auth.uid();
  v_code   text := btrim(coalesce(p_code, ''));
  v_group  public.groups%rowtype;
  v_comp   public.competitions%rowtype;
  v_ny_liga boolean := false;
  v_rk      bigint  := 0;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_code = '' then
    return jsonb_build_object('kind', 'none');
  end if;

  select * into v_group from public.groups where invite_code = v_code;
  if found then
    insert into public.group_members (group_id, user_id, role)
    select v_group.id, v_uid, 'member'
     where not exists (select 1 from public.group_members
                        where group_id = v_group.id and user_id = v_uid);
    get diagnostics v_rk = row_count;
    v_ny_liga := v_rk > 0;
    return jsonb_build_object('kind', 'group', 'group_id', v_group.id, 'joined', v_ny_liga);
  end if;

  select * into v_comp from public.competitions where invite_code = v_code;
  if not found then
    return jsonb_build_object('kind', 'none');
  end if;

  -- Liga før konkurrence — men IKKE fordi triggeren ville afvise den modsatte
  -- rækkefølge (det gør den ikke; se filens hoved). Linjen er her for det ene
  -- tilfælde, triggeren ikke dækker: en bruger, der allerede ER deltager, men
  -- mangler medlemskabet. Der indsættes da ingen deltager-række, triggeren fyrer
  -- ikke, og `A8`s halve tilstand ville blive stående, hver gang brugeren
  -- forsøgte at rette den ved at bruge invitationen igen.
  if v_comp.group_id is not null then
    insert into public.group_members (group_id, user_id, role)
    select v_comp.group_id, v_uid, 'member'
     where not exists (select 1 from public.group_members
                        where group_id = v_comp.group_id and user_id = v_uid);
  end if;

  insert into public.competition_participants (competition_id, user_id)
  select v_comp.id, v_uid
   where not exists (select 1 from public.competition_participants
                      where competition_id = v_comp.id and user_id = v_uid);
  get diagnostics v_rk = row_count;

  return jsonb_build_object(
    'kind', 'competition',
    'competition_id', v_comp.id,
    'group_id', v_comp.group_id,
    'joined', v_rk > 0);
end;
$$;

revoke execute on function public.accept_invite(text) from public;
grant execute on function public.accept_invite(text) to authenticated, service_role;

-- Er kalderen den, der har OPRETTET ligaen?
--
-- SECURITY DEFINER, og det er ikke pynt — det er hønen og ægget. Policyen
-- nedenfor skal spørge `groups`, og `groups` er fra og med denne fil kun læsbar
-- for MEDLEMMER. I det sekund en opretter skriver sin egen admin-række, er hun
-- endnu ikke medlem, så en almindelig underforespørgsel ville se nul rækker og
-- afvise hende. **Følgen ville være, at ingen kunne oprette en liga overhovedet**
-- — altså en rettelse, der lukkede et hul og hele produktet på én gang.
--
-- Fanget af `sql/tests/invite_lookup.sql` påstand 10b, som findes netop for at
-- måle, at flowet stadig virker. Første kørsel: *"opretteren kunne ikke skrive
-- sin egen admin-række (afvist) — hele oprettelsen er brudt"*.
--
-- Samme form og samme grund som `is_group_member()` og `is_group_admin()`, der
-- er DEFINER af nøjagtig samme årsag: de læses fra policies på den tabel, de
-- selv slår op i.
create or replace function public.is_group_creator(gid uuid) returns boolean
  language sql stable security definer
  set search_path to 'public'
  as $$
  select exists (select 1 from public.groups where id = gid and created_by = auth.uid());
$$;

grant execute on function public.is_group_creator(uuid) to authenticated, service_role;

-- ============================================================================
-- Verifikation — kør efter trin 1
-- ============================================================================
-- 1) De tre funktioner findes og er security definer. Forvent tre rækker, alle 't'.
-- select proname, prosecdef from pg_proc
--  where pronamespace = 'public'::regnamespace
--    and proname in ('invite_lookup', 'accept_invite', 'is_group_creator')
--  order by proname;

-- 2) Intet er smalnet endnu — de fire gamle policies står stadig.
--    Forvent FIRE rækker. Er der nul, er #53 kørt for tidligt.
-- select tablename, policyname from pg_policies
--  where schemaname = 'public'
--    and policyname in ('groups_select_all', 'read all competitions',
--                       'group_members_insert_self', 'join competition')
--  order by tablename;

-- 3) Opslaget svarer. Brug en rigtig invitationskode fra din egen liga:
--    forvent `{"kind": "group", ...}`. Kaldet kræver en session, så det virker
--    IKKE i SQL-editoren (auth.uid() er null dér) — prøv det fra appen efter
--    udrulningen i stedet.
