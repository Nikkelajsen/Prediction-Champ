-- Invitationskoden bliver hemmeligheden igen (A40).
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- ⚠️ **SKAL KØRES SAMMEN MED FRONTEND-MERGEN, IKKE FØR.** Filen smalner de to
-- læsepolicies, klienten i dag bruger til at slå en invitation op. Køres den
-- alene, kan ingen tage imod en invitation, før den nye klient er udrullet.
-- Modsat rækkefølge (frontend først) er heller ikke rigtig: den nye klient
-- kalder funktioner, der ikke findes endnu. **Kør migreringen og udrul samme
-- deploy.**
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

-- ---------------------------------------------------------------------------
-- 3. Policies: fra "alle" til "dem, der er med"
--
-- ⚠️ Fra dette punkt kan en invitation kun tages imod gennem funktionerne
-- ovenfor. Det er hele pointen — og også grunden til, at filen skal køres
-- sammen med frontend-mergen.

-- Ligaen: kun medlemmer. Opretteren er altid medlem (`createGroup` skriver
-- admin-rækken i samme ombæring), så der er ingen grund til et `or created_by`
-- — og et sådant led ville gøre en liga synlig for en opretter, der har forladt
-- den.
drop policy if exists groups_select_all on public.groups;
create policy groups_select_member on public.groups
  for select to authenticated
  using (public.is_group_member(id));

-- Konkurrencen: deltagere, ligaens medlemmer og opretteren.
--
-- **Ligaens medlemmer og ikke kun deltagerne**, fordi ligasiden viser alle
-- ligaens konkurrencer med en "Deltag"-knap ved dem, man ikke er med i — det er
-- selve måden, en konkurrence findes på, når man først er i ligaen.
--
-- **Opretteren**, fordi en liga-løs konkurrence ellers ville blive usynlig for
-- den, der lige har lavet den, i det sekund hun forlader den igen.
--
-- Underforespørgslen på `competition_participants` er ufarlig for rekursion:
-- dens egen læsepolicy (`read all participation`) peger ikke tilbage hertil.
drop policy if exists "read all competitions" on public.competitions;
create policy competitions_select_involved on public.competitions
  for select to authenticated
  using (
    created_by = auth.uid()
    or (group_id is not null and public.is_group_member(group_id))
    or exists (select 1 from public.competition_participants cp
                where cp.competition_id = competitions.id and cp.user_id = auth.uid())
  );

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

-- Medlemskabet: kun opretteren skriver sin egen række direkte. Alle andre
-- kommer ind gennem `accept_invite()`.
--
-- Den gamle policy tillod `role = 'member'` i en HVILKEN SOM HELST liga, og det
-- var den halvdel, der gjorde et id nok. Den nye tillader kun opretterens
-- admin-række — præcis det ene tilfælde, hvor der endnu ikke findes en
-- invitation at fremvise, fordi ligaen lige er opstået.
drop policy if exists group_members_insert_self on public.group_members;
create policy group_members_insert_creator on public.group_members
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and role = 'admin'
    and public.is_group_creator(group_members.group_id)
  );

-- Deltagelsen: ligaens medlemmer og opretteren. Koden-stien går gennem
-- `accept_invite()`, som er `security definer` og derfor ikke rører denne
-- policy.
--
-- `created_by` skal med: opretteren skriver sin egen deltager-række umiddelbart
-- efter konkurrencen (`createCompetition`), og for en liga-løs konkurrence er
-- der intet medlemskab at hvile på.
drop policy if exists "join competition" on public.competition_participants;
create policy competition_participants_insert_involved on public.competition_participants
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.competitions c
                 where c.id = competition_participants.competition_id
                   and (c.created_by = auth.uid()
                        or (c.group_id is not null and public.is_group_member(c.group_id))))
  );

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- 1) De to funktioner findes og er security definer. Forvent to rækker med 't'.
-- select proname, prosecdef from pg_proc
--  where pronamespace = 'public'::regnamespace
--    and proname in ('invite_lookup', 'accept_invite') order by proname;

-- 2) De fire policies er skiftet ud. Forvent præcis disse fire navne.
-- select tablename, policyname from pg_policies
--  where schemaname = 'public'
--    and policyname in ('groups_select_member', 'competitions_select_involved',
--                       'group_members_insert_creator',
--                       'competition_participants_insert_involved')
--  order by tablename;

-- 3) De gamle er væk. Forvent NUL rækker.
-- select tablename, policyname from pg_policies
--  where schemaname = 'public'
--    and policyname in ('groups_select_all', 'read all competitions',
--                       'group_members_insert_self', 'join competition');

-- 4) Ingen liga er blevet usynlig for sine egne: hver liga har mindst ét
--    medlem, der kan se den. Forvent NUL rækker (en liga uden medlemmer er
--    tilladt og forventet efter en kontolukning — se `A36` — men den skal
--    kunne ses her, ikke opdages senere).
-- select g.id, g.name from public.groups g
--  where not exists (select 1 from public.group_members m where m.group_id = g.id);
