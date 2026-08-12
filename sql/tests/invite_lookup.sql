-- Test af `sql/invite_lookup.sql` (A40).
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR DET RIGTIGE SKEMA. Hele filen handler om RLS, og en påstand om, at
-- noget er FORBUDT, kan ikke stilles i et miniskema, hvor de andre policies ikke
-- findes (`G91`). Her gælder det dobbelt: `group_membership_invariant` er en
-- trigger, der afgør rækkefølgen inde i `accept_invite()`, og den findes kun i
-- det rigtige skema.
--
-- **TESTEN ER TO HALVDELE, OG DEN ANDEN ER DEN VIGTIGSTE.** Den første viser, at
-- hullet er lukket. Den anden viser, at join-flowet stadig virker — og den er
-- der, fordi rettelsen kan gå galt på en måde, der er værre end hullet: smalnes
-- policyerne uden at opslaget flyttes, kan INGEN tage imod en invitation, og det
-- opdages af den næste bruger frem for af os. Hver eneste læsning, klienten
-- foretager i invitations-flowet, har derfor sin egen påstand.
--
-- HVAD DEN BEVISER
--   Mellemtilstanden (a–c): trin 1 alene rører ingen policy, den gamle klients
--     opslag virker uændret, og den nye klients kald virker allerede. Det er
--     dét, der gør migreringen sikker at køre FØR udrulningen — og det er hele
--     grunden til, at `A40` er delt i to filer.
--   Hullet (1–4):
--     1. En fremmed kan ikke LÆSE en liga, hun ikke er medlem af — heller ikke
--        `invite_code`. Negativ kontrol FØR migreringen: med den gamle policy
--        kan hun læse den.
--     2. En fremmed kan ikke melde sig ind i en liga, hvis id hun kender.
--        Negativ kontrol FØR migreringen — det var `INSERT 1`.
--     3. En fremmed kan ikke læse en fremmed konkurrence eller dens kode.
--     4. En fremmed kan ikke skrive sig som deltager i en konkurrence, hvis id
--        hun kender.
--   Flowet (5–10):
--     5. `invite_lookup()` svarer på en liga-kode — og SKRIVER IKKE.
--     6. `invite_lookup()` svarer på en konkurrence-kode med ligaens og
--        inviterens navn, som klienten viser i bekræftelsen.
--     7. `accept_invite()` på en liga-kode melder ind, er idempotent, og
--        `joined` skelner de to.
--     8. `accept_invite()` på en konkurrence-kode melder ind i BEGGE og i den
--        rigtige rækkefølge — invarianten ville afvise den modsatte.
--     9. Efter tilmelding kan medlemmet læse alt det, klienten faktisk henter:
--        egne ligaer, ligaens konkurrencer, konkurrencer på id.
--    10. Et ligamedlem kan stadig tilmelde sig ligaens konkurrencer direkte
--        ("Deltag"-knappen), og en opretter kan stadig oprette sin egen liga og
--        skrive sig selv som admin og deltager — men hverken som `member`
--        (`A37`s frosne liga) eller på en andens vegne. **Siden `G98`
--        (12. august 2026) gælder det gennem `create_group()` og KUN dér:**
--        10c1 måler, at den gamle klients `insert … returning` er lukket, 10c2
--        at den nye vej virker, og 10f at prisen for det gamle led er væk — en
--        opretter, der har forladt sin egen liga, kan ikke længere læse den.
--
-- EFTERPRØVET MED MUTATION (10. august 2026). Se listen nederst i filen.
--
-- ⚠️ **Sammenligningerne på svaret er `is distinct from` og ikke `<>`**, og det
-- er ikke stil. Første udgave brugte `<>`, og en mutation, der satte
-- `group_name` til null, slap FORBI: `NULL <> 'Offerets liga'` er NULL, altså
-- ikke sandt, så `if`-grenen aldrig blev taget. Påstanden kunne dermed kun se
-- et FORKERT navn, ikke et manglende — og det manglende var netop den fejl, der
-- ville melde brugeren ind i en liga uden at sige det.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d a40 -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d a40 -v ON_ERROR_STOP=1 -b -f sql/tests/invite_lookup.sql

\set ON_ERROR_STOP on
\timing off

alter table public.matches disable trigger all;

grant usage on schema auth to authenticated;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- OFFER ejer ligaen og begge konkurrencer. FREMMED er en helt almindelig
-- indlogget bruger uden nogen forbindelse til dem.
insert into auth.users (id, email) values
  ('0ffe0000-0000-4000-8000-000000000001', 'offer@test.local'),
  ('f2ed0000-0000-4000-8000-000000000002', 'fremmed@test.local');
insert into public.profiles (id, display_name) values
  ('0ffe0000-0000-4000-8000-000000000001', 'Offer'),
  ('f2ed0000-0000-4000-8000-000000000002', 'Fremmed');

insert into public.leagues (id, name) values
  ('11110000-0000-4000-8000-000000000001', 'Testligaen');
insert into public.seasons (id, league_id, name) values
  ('22220000-0000-4000-8000-000000000001', '11110000-0000-4000-8000-000000000001', '25/26');

insert into public.groups (id, name, created_by, invite_code) values
  ('33330000-0000-4000-8000-000000000001', 'Offerets liga',
   '0ffe0000-0000-4000-8000-000000000001', 'LIGAKODE');
insert into public.group_members (group_id, user_id, role) values
  ('33330000-0000-4000-8000-000000000001', '0ffe0000-0000-4000-8000-000000000001', 'admin');

-- To konkurrencer: én i ligaen, én liga-løs. De to går ad hver sin gren i
-- `accept_invite()`, og kun den første rører invarianten.
insert into public.competitions (id, name, mode, created_by, group_id, invite_code) values
  ('44440000-0000-4000-8000-000000000001', 'Ligaens konkurrence', 'custom',
   '0ffe0000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-000000000001', 'KONKKODE'),
  ('44440000-0000-4000-8000-000000000002', 'Fritstående konkurrence', 'custom',
   '0ffe0000-0000-4000-8000-000000000001', null, 'FRIKODE');
insert into public.competition_participants (competition_id, user_id) values
  ('44440000-0000-4000-8000-000000000001', '0ffe0000-0000-4000-8000-000000000001'),
  ('44440000-0000-4000-8000-000000000002', '0ffe0000-0000-4000-8000-000000000001');

-- Kør en forespørgsel som en bestemt bruger og svar med antallet af rækker.
create function pg_temp.tael(p_uid uuid, p_sql text) returns bigint
language plpgsql as $$
declare v_n bigint; v_bruger text;
begin
  perform set_config('test.uid', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  v_bruger := current_user;
  execute p_sql into v_n;
  reset role;
  if v_bruger <> 'authenticated' then
    raise exception 'rolleskiftet virkede ikke: kørte som %', v_bruger;
  end if;
  return v_n;
end $$;

-- Kør en SKRIVNING som en bruger og svar `afvist`, `nul` eller `tilladt`.
-- Samme tre udfald og samme begrundelse som `sql/tests/write_surface.sql`:
-- RLS uden adgang skjuler bare rækkerne, så en afvisning og et nul-resultat er
-- to forskellige ting.
create function pg_temp.skriv(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare v_rk bigint;
begin
  begin
    perform set_config('test.uid', p_uid::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    execute p_sql;
    get diagnostics v_rk = row_count;
    reset role;
    return case when v_rk > 0 then 'tilladt' else 'nul' end;
  exception when others then
    if sqlstate = 'P0001' then raise; end if;
    reset role; return 'afvist';
  end;
end $$;

-- Kør en skrivning MED `returning` og svar `afvist` eller `tilladt`.
--
-- ⚠️ **HVORFOR DER ER TO SKRIVE-HJÆLPERE — LÆS DENNE, FØR DU BRUGER `skriv()`
-- TIL EN PÅSTAND OM EN KLIENTHANDLING.** `skriv()` ovenfor kører `execute p_sql`
-- uden at læse noget tilbage, og måler dermed kun INSERT-policyen. Det er ikke
-- det, appen gør: `db.insert` sender altid `Prefer: return=representation`
-- (src/lib/supabase.js), så PostgREST kører `insert … returning *` — og en
-- RETURNING-klausul betyder, at rækken skal LÆSES tilbage, altså at **SELECT**-
-- policyen også anvendes på den nyindsatte række.
--
-- Forskellen er ikke teoretisk. Den kostede en produktionsfejl 11. august 2026:
-- `#53` smalnede `groups`' SELECT-policy til `is_group_member(id)`, og da
-- `createGroup` skriver ligaen FØR sin egen medlemsrække, kunne INGEN oprette en
-- liga. Påstand 10b nedenfor testede netop den oprettelse — med `skriv()` — og
-- var grøn hele vejen igennem. Se `sql/groups_select_creator.sql` (#55).
--
-- **Tommelfingerregel: en påstand om noget, appen SKRIVER, hører til her.**
-- `skriv()` er stadig den rigtige til påstande om, hvad en FREMMED ikke må.
create function pg_temp.skriv_retur(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare v_id uuid;
begin
  begin
    perform set_config('test.uid', p_uid::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    -- `into` er hele forskellen: den kræver, at sætningen returnerer en række,
    -- og det er dét, der udløser SELECT-policyen på den nye række.
    execute p_sql into v_id;
    reset role;
    return case when v_id is null then 'nul' else 'tilladt' end;
  exception when others then
    if sqlstate = 'P0001' then raise; end if;
    reset role; return 'afvist';
  end;
end $$;

-- Kald en funktion som en bruger og få svaret som jsonb.
create function pg_temp.kald(p_uid uuid, p_sql text) returns jsonb
language plpgsql as $$
declare v_svar jsonb;
begin
  perform set_config('test.uid', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  execute p_sql into v_svar;
  reset role;
  return v_svar;
end $$;

-- ---------------------------------------------------------------------------
-- TESTEN EJER SIN EGEN FØR-TILSTAND (G94-reglen, DOCUMENTATION.md §13)
-- ---------------------------------------------------------------------------
-- ⚠️ **Læs denne, før du fjerner blokken, fordi "den står jo allerede i
-- skemaet".** Det gjorde den — og præcis dét var fejlen.
--
-- Testen måler en migrering mod `sql/schema.sql`, som er et ØJEBLIKSBILLEDE af
-- produktionen. Indtil 12. august 2026 hentede den sin FØR-tilstand derfra: de
-- fire gamle policies stod i dumpet, så en fremmed kunne læse ligaen, og
-- mellemtilstand a) kunne tælle dem. Det holdt kun, så længe migreringen ikke
-- var kørt i produktion. I det øjeblik `A40` blev udrullet og skema-eksporten
-- kørte bagefter, ville dumpet bære de NYE policies — og testen ville blive rød
-- af, at arbejdet lykkedes, uden at nogen havde rørt hverken den eller
-- migreringen.
--
-- Det er anden gang, den fælde er stillet: `sql/tests/competition_matches_read.sql`
-- (`G94`) faldt i den 10. august 2026 og blev rettet på nøjagtig denne måde.
-- Reglen står i §13: **en test, der måler en migrering mod et øjebliksbillede,
-- må aldrig hente sin FØR-tilstand fra snapshottet.**
--
-- Definitionerne herunder er ordret dem fra `sql/invite_policies.sql`s
-- tilbagerulnings-blok, altså som de stod i `schema.sql` før `#53`. De nye
-- droppes først, så tilstanden er den samme, uanset hvilken side dumpet står på.
--
-- **BEGGE navne droppes, ikke kun det nye** — af nøjagtig samme grund som i
-- migreringen selv: står dumpet på den GAMLE side, findes `groups_select_all`
-- allerede, og `create policy` fejler med `42710`. Blokken skal virke fra begge
-- sider, ellers har den bare flyttet udløbsdatoen.
drop policy if exists groups_select_member on public.groups;
drop policy if exists groups_select_all on public.groups;
create policy groups_select_all on public.groups
  for select to authenticated using (true);

drop policy if exists competitions_select_involved on public.competitions;
drop policy if exists "read all competitions" on public.competitions;
create policy "read all competitions" on public.competitions
  for select using (auth.role() = 'authenticated'::text);

drop policy if exists group_members_insert_creator on public.group_members;
drop policy if exists group_members_insert_self on public.group_members;
create policy group_members_insert_self on public.group_members
  for insert to authenticated
  with check (((user_id = auth.uid()) and ((role = 'member'::text) or (exists (
    select 1 from public.groups g
     where ((g.id = group_members.group_id) and (g.created_by = auth.uid())))))));

drop policy if exists competition_participants_insert_involved on public.competition_participants;
drop policy if exists "join competition" on public.competition_participants;
create policy "join competition" on public.competition_participants
  for insert with check ((user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- FØR migreringen: hullet SKAL kunne genskabes
-- ---------------------------------------------------------------------------
-- Uden dette afsnit kunne påstand 1 og 2 bestå, fordi fixturen tilfældigvis var
-- harmløs. Begge kontroller rydder op efter sig.
do $$
declare v_n bigint; v_udfald text;
begin
  v_n := pg_temp.tael('f2ed0000-0000-4000-8000-000000000002',
    $s$select count(*) from public.groups where invite_code = 'LIGAKODE'$s$);
  if v_n <> 1 then
    raise exception 'fixturen holder ikke: en fremmed skulle KUNNE læse ligaen før migreringen (fik %)', v_n;
  end if;

  v_udfald := pg_temp.skriv('f2ed0000-0000-4000-8000-000000000002',
    $s$insert into public.group_members (group_id, user_id, role)
       values ('33330000-0000-4000-8000-000000000001', auth.uid(), 'member')$s$);
  if v_udfald <> 'tilladt' then
    raise exception 'fixturen holder ikke: en fremmed skulle KUNNE melde sig ind før migreringen (fik %)', v_udfald;
  end if;
  delete from public.group_members
   where group_id = '33330000-0000-4000-8000-000000000001'
     and user_id = 'f2ed0000-0000-4000-8000-000000000002';
end $$;

-- ---------------------------------------------------------------------------
-- Migreringen under test
-- ---------------------------------------------------------------------------
\ir ../invite_lookup.sql

-- ---------------------------------------------------------------------------
-- MELLEMTILSTANDEN efter trin 1 — den, hele delingen findes for
-- ---------------------------------------------------------------------------
-- `A40` køres i to trin, fordi Supabase betjenes i hånden og Vercel deployer af
-- sig selv: "samtidig" er ikke en instruks, et menneske kan følge. Delingen er
-- kun noget værd, hvis trin 1 er ufarligt at køre FØR udrulningen — altså hvis
-- den GAMLE klient stadig virker, mens den NYE allerede kan.
--
-- Uden dette afsnit ville det være en påstand i en kommentar. Her er det målt.
do $$
declare v_n bigint; v_svar jsonb;
begin
  -- a) Trin 1 rører ingen policy. De fire gamle står der endnu, så alt, den
  --    gamle klient gør, virker uændret.
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and policyname in ('groups_select_all', 'read all competitions',
                        'group_members_insert_self', 'join competition');
  if v_n <> 4 then
    raise exception 'mellemtilstand a) trin 1 har rørt policies (% af 4 gamle tilbage) — så er den ikke sikker at køre før udrulningen', v_n;
  end if;

  -- b) Den gamle klients opslag virker stadig: en fremmed kan læse ligaen på
  --    koden, præcis som før. Det er dét, der gør trin 1 ufarligt.
  v_n := pg_temp.tael('f2ed0000-0000-4000-8000-000000000002',
    $s$select count(*) from public.groups where invite_code = 'LIGAKODE'$s$);
  if v_n <> 1 then
    raise exception 'mellemtilstand b) den gamle klients opslag er brudt af trin 1';
  end if;

  -- c) …og den NYE klients kald virker allerede. Begge udgaver kan altså køre
  --    mod denne tilstand, og udrulningen kan ske i ro.
  v_svar := pg_temp.kald('f2ed0000-0000-4000-8000-000000000002',
    $s$select public.invite_lookup('LIGAKODE')$s$);
  if v_svar->>'kind' is distinct from 'group' then
    raise exception 'mellemtilstand c) den nye klients opslag virker ikke efter trin 1: %', v_svar;
  end if;
end $$;

\ir ../invite_policies.sql

-- `create_group()` (#57, `G95`) læses med, og det er ikke pynt: siden `G98`
-- (12. august 2026) er `groups`' SELECT-policy smalnet til `is_group_member(id)`
-- alene, og dermed er funktionen den ENESTE vej, en liga bliver til. En test,
-- der kun målte, at den gamle vej er lukket, ville være grøn i en app, hvor
-- ingen kan oprette en liga — det var netop den fejl, 11. august 2026 kostede.
-- Påstand 10c måler begge halvdele: den gamle vej afvist, den nye vej i orden.
--
-- Filen er `create or replace` + grants og rører ingen policy, så den kan
-- indlæses her uden at flytte det, resten af testen måler.
\ir ../create_group.sql

-- ---------------------------------------------------------------------------
-- Påstandene
-- ---------------------------------------------------------------------------
do $$
declare
  FREMMED constant uuid := 'f2ed0000-0000-4000-8000-000000000002';
  OFFER   constant uuid := '0ffe0000-0000-4000-8000-000000000001';
  v_n      bigint;
  v_udfald text;
  v_svar   jsonb;
begin
  -- ---------- Hullet ----------
  -- 1) Ligaen er usynlig for en fremmed
  v_n := pg_temp.tael(FREMMED, $s$select count(*) from public.groups$s$);
  if v_n <> 0 then
    raise exception '1) en fremmed kan stadig se % liga(er) — koden kan dermed høstes', v_n;
  end if;

  -- 2) …og kan ikke melde sig ind på id alene
  v_udfald := pg_temp.skriv(FREMMED,
    $s$insert into public.group_members (group_id, user_id, role)
       values ('33330000-0000-4000-8000-000000000001', auth.uid(), 'member')$s$);
  if v_udfald <> 'afvist' then
    raise exception '2) en fremmed kunne melde sig ind i ligaen (%)', v_udfald;
  end if;

  -- 3) Konkurrencerne er usynlige — begge grene
  v_n := pg_temp.tael(FREMMED, $s$select count(*) from public.competitions$s$);
  if v_n <> 0 then
    raise exception '3) en fremmed kan stadig se % konkurrence(r)', v_n;
  end if;

  -- 4) …og kan ikke skrive sig som deltager
  v_udfald := pg_temp.skriv(FREMMED,
    $s$insert into public.competition_participants (competition_id, user_id)
       values ('44440000-0000-4000-8000-000000000002', auth.uid())$s$);
  if v_udfald <> 'afvist' then
    raise exception '4) en fremmed kunne skrive sig som deltager (%)', v_udfald;
  end if;

  -- ---------- Flowet ----------
  -- 5) Opslaget på en liga-kode svarer — og skriver intet
  v_svar := pg_temp.kald(FREMMED, $s$select public.invite_lookup('LIGAKODE')$s$);
  if v_svar->>'kind' is distinct from 'group' then
    raise exception '5) invite_lookup svarede % på en liga-kode', v_svar->>'kind';
  end if;
  if v_svar->'group'->>'name' is distinct from 'Offerets liga' then
    raise exception '5) ligaens navn mangler i svaret: %', v_svar;
  end if;
  if (v_svar->>'already')::boolean then
    raise exception '5) svaret siger already=true for en, der ikke er medlem';
  end if;
  if v_svar->'group' ? 'invite_code' then
    raise exception '5) svaret bærer invite_code — den skal ikke med tilbage';
  end if;
  if exists (select 1 from public.group_members
              where group_id = '33330000-0000-4000-8000-000000000001' and user_id = FREMMED) then
    raise exception '5) opslaget MELDTE IND — bekræftelsen ville være et spørgsmål, der var besvaret på forhånd';
  end if;

  -- 6) Opslaget på en konkurrence-kode bærer de to navne, bekræftelsen viser
  v_svar := pg_temp.kald(FREMMED, $s$select public.invite_lookup('KONKKODE')$s$);
  if v_svar->>'kind' is distinct from 'competition' then
    raise exception '6) invite_lookup svarede % på en konkurrence-kode', v_svar->>'kind';
  end if;
  if v_svar->>'group_name' is distinct from 'Offerets liga' then
    raise exception '6) ligaens navn mangler: % — bekræftelsen ville melde ind i en liga uden at sige det', v_svar;
  end if;
  if v_svar->>'inviter_name' is distinct from 'Offer' then
    raise exception '6) inviterens navn mangler: %', v_svar;
  end if;

  -- En ukendt kode er brugerens tastefejl og ikke vores fejl
  v_svar := pg_temp.kald(FREMMED, $s$select public.invite_lookup('FINDESIKKE')$s$);
  if v_svar->>'kind' is distinct from 'none' then
    raise exception '6) en ukendt kode svarede % og ikke none', v_svar->>'kind';
  end if;

  -- 7) Tilmelding på en liga-kode — og idempotensen
  v_svar := pg_temp.kald(FREMMED, $s$select public.accept_invite('LIGAKODE')$s$);
  if v_svar->>'kind' is distinct from 'group' or not coalesce((v_svar->>'joined')::boolean, false) then
    raise exception '7) accept_invite meldte ikke ind: %', v_svar;
  end if;
  if not exists (select 1 from public.group_members
                  where group_id = '33330000-0000-4000-8000-000000000001'
                    and user_id = FREMMED and role = 'member') then
    raise exception '7) medlemsrækken blev ikke skrevet — eller ikke som member';
  end if;
  v_svar := pg_temp.kald(FREMMED, $s$select public.accept_invite('LIGAKODE')$s$);
  if (v_svar->>'joined')::boolean then
    raise exception '7) andet kald meldte ind igen — joined skal skelne, så klienten ikke logger to hændelser';
  end if;
  if (select count(*) from public.group_members
       where group_id = '33330000-0000-4000-8000-000000000001' and user_id = FREMMED) <> 1 then
    raise exception '7) andet kald skrev en dublet';
  end if;

  -- 8) Tilmelding på en konkurrence-kode melder ind i BEGGE
  --    Fremmed er nu ligamedlem fra 7), så testen bruger den FRITSTÅENDE
  --    konkurrence til at måle den anden gren, og ligaens til at måle
  --    rækkefølgen — sidstnævnte kræver en frisk bruger.
  insert into auth.users (id, email) values ('f2ed0000-0000-4000-8000-000000000003', 'ny@test.local');
  insert into public.profiles (id, display_name) values ('f2ed0000-0000-4000-8000-000000000003', 'Ny');
  v_svar := pg_temp.kald('f2ed0000-0000-4000-8000-000000000003',
    $s$select public.accept_invite('KONKKODE')$s$);
  if v_svar->>'kind' is distinct from 'competition' or not coalesce((v_svar->>'joined')::boolean, false) then
    raise exception '8) accept_invite meldte ikke ind i konkurrencen: %', v_svar;
  end if;
  -- Begge rækker, og medlemskabet er dét, invarianten kræver findes FØRST.
  if not exists (select 1 from public.group_members
                  where group_id = '33330000-0000-4000-8000-000000000001'
                    and user_id = 'f2ed0000-0000-4000-8000-000000000003') then
    raise exception '8) liga-medlemskabet blev ikke skrevet — A8-halvtilstanden er tilbage';
  end if;
  if not exists (select 1 from public.competition_participants
                  where competition_id = '44440000-0000-4000-8000-000000000001'
                    and user_id = 'f2ed0000-0000-4000-8000-000000000003') then
    raise exception '8) deltagelsen blev ikke skrevet';
  end if;

  -- Den fritstående konkurrence: ingen liga at melde ind i, og den skal virke
  -- alligevel — det er den gren, hvor `group_id is null`.
  v_svar := pg_temp.kald(FREMMED, $s$select public.accept_invite('FRIKODE')$s$);
  if not coalesce((v_svar->>'joined')::boolean, false) then
    raise exception '8) den fritstående konkurrence kunne ikke tilmeldes: %', v_svar;
  end if;

  -- 8c) REPARATIONEN: allerede deltager, men medlemskabet mangler (`A8`).
  --     Triggeren `ensure_group_membership_for_participant` udfylder kun
  --     medlemskabet, når der faktisk INDSÆTTES en deltager-række — så i netop
  --     dette tilfælde fyrer den ikke, og det er den ENESTE grund til, at
  --     `accept_invite()` selv melder ind i ligaen. Uden påstanden kunne den
  --     linje fjernes, uden at noget fejlede.
  delete from public.group_members
   where group_id = '33330000-0000-4000-8000-000000000001'
     and user_id = 'f2ed0000-0000-4000-8000-000000000003';
  v_svar := pg_temp.kald('f2ed0000-0000-4000-8000-000000000003',
    $s$select public.accept_invite('KONKKODE')$s$);
  if coalesce((v_svar->>'joined')::boolean, false) then
    raise exception '8c) svaret siger joined=true, selvom deltagelsen allerede fandtes: %', v_svar;
  end if;
  if not exists (select 1 from public.group_members
                  where group_id = '33330000-0000-4000-8000-000000000001'
                    and user_id = 'f2ed0000-0000-4000-8000-000000000003') then
    raise exception '8c) den halve A8-tilstand blev IKKE rettet — at bruge invitationen igen skal reparere medlemskabet';
  end if;

  -- 9) Medlemmet ser nu præcis det, klienten henter
  v_n := pg_temp.tael(FREMMED, $s$select count(*) from public.groups$s$);
  if v_n <> 1 then
    raise exception '9) medlemmet ser % ligaer og ikke sin ene', v_n;
  end if;
  -- Ligasidens liste over ligaens konkurrencer (`loadGroupDetail`)
  v_n := pg_temp.tael(FREMMED,
    $s$select count(*) from public.competitions
        where group_id = '33330000-0000-4000-8000-000000000001'$s$);
  if v_n <> 1 then
    raise exception '9) ligamedlemmet ser % af ligaens konkurrencer', v_n;
  end if;
  -- MainApps opslag på egne konkurrence-id'er
  v_n := pg_temp.tael(FREMMED,
    $s$select count(*) from public.competitions
        where id = '44440000-0000-4000-8000-000000000002'$s$);
  if v_n <> 1 then
    raise exception '9) deltageren kan ikke læse den fritstående konkurrence, hun lige meldte sig til';
  end if;

  -- 10) De to skrivninger, der IKKE går gennem en kode, virker stadig
  --     a) "Deltag"-knappen på ligasiden: et ligamedlem, der ikke er deltager
  delete from public.competition_participants
   where competition_id = '44440000-0000-4000-8000-000000000001' and user_id = FREMMED;
  v_udfald := pg_temp.skriv(FREMMED,
    $s$insert into public.competition_participants (competition_id, user_id)
       values ('44440000-0000-4000-8000-000000000001', auth.uid())$s$);
  if v_udfald <> 'tilladt' then
    raise exception '10a) et ligamedlem kunne ikke trykke Deltag (%)', v_udfald;
  end if;

  --     b) Oprettelse: egen liga + egen admin-række + egen deltagelse
  v_udfald := pg_temp.skriv(FREMMED,
    $s$insert into public.groups (id, name, created_by)
       values ('33330000-0000-4000-8000-000000000009', 'Fremmeds egen liga', auth.uid())$s$);
  if v_udfald <> 'tilladt' then
    raise exception '10b) kunne ikke oprette en liga (%)', v_udfald;
  end if;
  v_udfald := pg_temp.skriv(FREMMED,
    $s$insert into public.group_members (group_id, user_id, role)
       values ('33330000-0000-4000-8000-000000000009', auth.uid(), 'admin')$s$);
  if v_udfald <> 'tilladt' then
    raise exception '10b) opretteren kunne ikke skrive sin egen admin-række (%) — hele oprettelsen er brudt', v_udfald;
  end if;
  v_udfald := pg_temp.skriv(FREMMED,
    $s$insert into public.competitions (id, name, mode, created_by)
       values ('44440000-0000-4000-8000-000000000009', 'Egen fritstående', 'custom', auth.uid())$s$);
  if v_udfald <> 'tilladt' then
    raise exception '10b) kunne ikke oprette en liga-løs konkurrence (%)', v_udfald;
  end if;
  v_udfald := pg_temp.skriv(FREMMED,
    $s$insert into public.competition_participants (competition_id, user_id)
       values ('44440000-0000-4000-8000-000000000009', auth.uid())$s$);
  if v_udfald <> 'tilladt' then
    raise exception '10b) opretteren kunne ikke deltage i sin egen liga-løse konkurrence (%)', v_udfald;
  end if;

  --     c) OPRETTELSEN, SOM APPEN FAKTISK GØR DEN — og den vej, den IKKE
  --     længere går.
  --
  --     Påstand 10b ovenfor var grøn, mens produktionen var brudt (11. august
  --     2026), fordi `skriv()` ikke læser noget tilbage og dermed aldrig anvender
  --     SELECT-policyen på den nye række. `db.insert` gør det ALTID
  --     (`Prefer: return=representation` → `insert … returning *`), og den ene
  --     forskel var nok til, at ingen kunne oprette en liga: `groups`' SELECT-
  --     policy krævede medlemskab, og medlemsrækken skrives først i næste kald.
  --
  --     Siden `G98` (12. august 2026, `#58`) er den policy smalnet TILBAGE til
  --     `is_group_member(id)` alene, og de to påstande herunder er de to sider
  --     af netop den beslutning. **Den ene uden den anden måler ingenting:**
  --     c1 alene ville også være grøn i en app, hvor ingen kan oprette en liga,
  --     og c2 alene ville ikke opdage, at det gamle hul stod åbent.
  --
  --     c1) Den gamle klients vej — `insert … returning` på `groups` — er nu
  --         LUKKET. Det er hele G98's indhold: leddet `or created_by`, der bar
  --         den, er væk, fordi `create_group()` har overtaget skrivningen.
  v_udfald := pg_temp.skriv_retur(FREMMED,
    $s$insert into public.groups (id, name, created_by)
       values ('33330000-0000-4000-8000-00000000000c', 'Fremmeds anden liga', auth.uid())
       returning id$s$);
  if v_udfald <> 'afvist' then
    raise exception '10c1) den gamle klients `insert … returning` på groups blev ikke afvist (%) — `or created_by = auth.uid()` er tilbage i SELECT-policyen, og G98 er rullet tilbage', v_udfald;
  end if;
  select count(*) into v_n from public.groups
   where id = '33330000-0000-4000-8000-00000000000c';
  if v_n <> 0 then
    raise exception '10c1) ligaen blev skrevet alligevel — afvisningen kom efter rækken';
  end if;

  --     c2) …og den vej, appen GÅR, virker: `create_group()` skriver ligaen og
  --         opretterens admin-række som ejer i ÉN transaktion, så ingen
  --         SELECT-policy konsulteres undervejs. Bagefter kan hun læse ligaen —
  --         nu som medlem, altså af den ene grund, der er tilbage.
  v_svar := pg_temp.kald(FREMMED, $s$select public.create_group('Fremmeds anden liga')$s$);
  if coalesce(v_svar->>'invite_code', '') = '' then
    raise exception '10c2) create_group() svarede uden invite_code: % — oprettelsen er brudt, og det er den ENESTE vej tilbage', v_svar;
  end if;
  v_n := pg_temp.tael(FREMMED,
    format($s$select count(*) from public.groups where id = %L$s$, v_svar->>'id'));
  if v_n <> 1 then
    raise exception '10c2) opretteren kan ikke læse den liga, hun lige har oprettet';
  end if;

  --     c3) Og konkurrence-oprettelsen med `returning`, som appen STADIG gør
  --         (`createCompetition` er et almindeligt `db.insert`): `created_by`-
  --         leddet i `competitions_select_involved` er dét, der bærer den, så
  --         den ville fejle på samme måde, hvis leddet nogensinde forsvandt.
  --
  --     Der står ingen tilsvarende påstand om `group_members` længere: klienten
  --     skriver ikke selv i den tabel efter `A40` (`accept_invite()` gør det),
  --     og opretterens egen admin-række skrives nu inde i `create_group()`.
  --     Insert-policyen på tabellen måles stadig af 10b, 10d og 10e.
  v_udfald := pg_temp.skriv_retur(FREMMED,
    $s$insert into public.competitions (id, name, mode, created_by)
       values ('44440000-0000-4000-8000-00000000000c', 'Egen med returning', 'custom', auth.uid())
       returning id$s$);
  if v_udfald <> 'tilladt' then
    raise exception '10c3) kunne ikke oprette en konkurrence MED returning (%)', v_udfald;
  end if;

  --     d) …men opretteren kan ikke skrive sig selv som `member`.
  --     Det er ikke pedanteri om en rolle: der findes ingen UPDATE-policy på
  --     `group_members` og dermed ingen forfremmelse, så en liga, hvis opretter
  --     står som medlem, kan ALDRIG administreres — præcis den frosne liga,
  --     `A37` blev skrevet om. Klausulen `role = 'admin'` i policyen er det
  --     eneste, der forhindrer den tilstand i at opstå ved oprettelsen.
  delete from public.group_members where group_id = '33330000-0000-4000-8000-000000000009';
  v_udfald := pg_temp.skriv(FREMMED,
    $s$insert into public.group_members (group_id, user_id, role)
       values ('33330000-0000-4000-8000-000000000009', auth.uid(), 'member')$s$);
  if v_udfald <> 'afvist' then
    raise exception '10d) opretteren kunne skrive sig selv som member (%) — ligaen ville være frossen fra fødslen (A37)', v_udfald;
  end if;

  --     e) …men stadig ikke som en ANDEN bruger
  v_udfald := pg_temp.skriv(FREMMED,
    $s$insert into public.group_members (group_id, user_id, role)
       values ('33330000-0000-4000-8000-000000000009',
               '0ffe0000-0000-4000-8000-000000000001', 'member')$s$);
  if v_udfald <> 'afvist' then
    raise exception '10e) en opretter kunne melde en ANDEN ind i sin liga (%)', v_udfald;
  end if;

  --     f) PRISEN, `#55` BETALTE, ER BETALT TILBAGE (`G98`).
  --     Liga `…009` er FREMMEDs egen — hun står som `created_by` — men 10d
  --     fjernede hendes medlemsrække, så hun har i praksis forladt den. Så
  --     længe `or created_by = auth.uid()` stod i policyen, kunne hun blive ved
  --     med at læse den og dermed dens `invite_code`; det var accepteret som
  --     prisen for, at nogen overhovedet kunne oprette en liga.
  --
  --     Denne påstand er hele G98's udbytte og falder, i samme sekund leddet
  --     kommer tilbage. Den er nabo til 10c1 med vilje: den ene måler, at
  --     SKRIVNINGEN er lukket, den anden at LÆSNINGEN er det.
  v_n := pg_temp.tael(FREMMED,
    $s$select count(*) from public.groups
        where id = '33330000-0000-4000-8000-000000000009'$s$);
  if v_n <> 0 then
    raise exception '10f) en opretter, der har forladt sin egen liga, kan stadig læse den og dens invite_code — `or created_by = auth.uid()` er tilbage i SELECT-policyen';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- EFTERPRØVET MED MUTATION — hver af disse er set fejle
-- ---------------------------------------------------------------------------
--   · `groups_select_member` sat til `using (true)`            → påstand 1
--   · `group_members_insert_creator` uden `role = 'admin'`     → påstand 10d
--   · `competitions_select_involved` sat til `using (true)`    → påstand 3
--   · `competition_participants_insert_involved` uden EXISTS   → påstand 4
--   · `invite_lookup()` givet en INSERT (skriver ved opslag)   → påstand 5
--   · `group_name`/`inviter_name` fjernet fra svaret           → påstand 6
--   · `joined` hårdkodet til true                              → påstand 7
--   · liga-indmeldingen fjernet fra `accept_invite()`          → påstand 8c
--     (og IKKE påstand 8: triggeren udfylder selv medlemskabet, når en
--      deltager-række indsættes — kun reparationen afslører linjen)
--   · `is_group_member` fjernet fra deltager-policyen          → påstand 10a
--   · `created_by`-leddet fjernet fra deltager-policyen        → påstand 10b
--   · `groups_select_member` givet `or created_by = auth.uid()` tilbage
--     (tilstanden 11.–12. august 2026, `#55`)          → påstand 10c1 og 10f
--     ⚠️ og IKKE påstand 10b, som 10c1 er nabo til: den skriver uden
--     `returning` og anvender derfor aldrig SELECT-policyen. Netop dét var
--     blindvinklen, der lod produktionen stå brudt med en grøn CI.
--   · `create_group()` fjernet igen (`G95` rullet tilbage)     → påstand 10c2
--     — den halvdel, der forhindrer, at 10c1 bliver grøn i en app, hvor ingen
--     kan oprette en liga.

select 'invite_lookup: hullet er lukket, og alle ti led i join-flowet virker' as resultat;
