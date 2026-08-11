-- Test af `sql/invite_preview.sql` (I7 · A41).
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR DET RIGTIGE SKEMA. Filen åbner en funktion for `anon` — altså for
-- enhver på internettet — og halvdelen af påstandene handler om, hvad `anon`
-- IKKE må. En påstand om noget FORBUDT kan ikke stilles i et miniskema, hvor
-- de policies, der forbyder det, ikke findes (`G91`).
--
-- HVAD DEN BEVISER
--   1. Funktionen findes, er `security definer` og er `stable` (den skriver
--      ikke). Det sidste er ikke pedanteri: en anonym funktion, der kunne
--      skrive, ville være et helt andet angrebsflade.
--   2. `anon` må køre den — og må STADIG IKKE køre `invite_lookup()` eller
--      `accept_invite()`. Det er selve snittet mellem ETIKET og ADGANG, og det
--      er den påstand, der holder `A40` på plads: previewet er en billedtekst,
--      ikke en dør.
--   3. `anon` kan stadig ikke læse `groups` eller `competitions` direkte. Var
--      det muligt, ville funktionen være overflødig og hullet være tilbage.
--   4. Svarets NØGLESÆT er nøjagtigt det tilladte. Positivt formuleret ville en
--      tilføjet kolonne kunne glide med i en fremtidig ændring uden at nogen
--      opdagede det, så påstanden er den negative: `id`, `invite_code`,
--      `created_by` og `group_id` må ikke optræde.
--   5. Værdierne er rigtige — navn og medlemsantal, også for en konkurrence,
--      hvor ligaens navn skal med (`A8`: man meldes ind i begge).
--   6. En ukendt kode, en tom kode og en absurd lang kode afslører ingenting.
--   7. Koden matches EKSAKT — samme regel som `invite_lookup()`. Svarede den
--      ene mere for at være venlig, kunne en kode have et preview uden at have
--      et opslag.
--
-- ⚠️ Sammenligningerne er `is distinct from` og ikke `<>`, af samme grund som i
-- `sql/tests/invite_lookup.sql`: en mutation, der satte et felt til null, slap
-- ellers forbi, fordi `NULL <> 'x'` er NULL og altså ikke sandt.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d i7 -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d i7 -v ON_ERROR_STOP=1 -b -f sql/tests/invite_preview.sql

\set ON_ERROR_STOP on
\timing off

alter table public.matches disable trigger all;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('0ffe0000-0000-4000-8000-000000000001', 'ejer@test.local'),
  ('0ffe0000-0000-4000-8000-000000000002', 'medlem@test.local');
insert into public.profiles (id, display_name) values
  ('0ffe0000-0000-4000-8000-000000000001', 'Ejer'),
  ('0ffe0000-0000-4000-8000-000000000002', 'Medlem');

insert into public.groups (id, name, created_by, invite_code) values
  ('33330000-0000-4000-8000-000000000001', 'Fodboldkammeraterne',
   '0ffe0000-0000-4000-8000-000000000001', 'ligakode');
insert into public.group_members (group_id, user_id, role) values
  ('33330000-0000-4000-8000-000000000001', '0ffe0000-0000-4000-8000-000000000001', 'admin'),
  ('33330000-0000-4000-8000-000000000001', '0ffe0000-0000-4000-8000-000000000002', 'member');

insert into public.competitions (id, name, mode, created_by, group_id, invite_code) values
  ('44440000-0000-4000-8000-000000000001', 'EM-kuponen', 'custom',
   '0ffe0000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-000000000001', 'konkkode');
insert into public.competition_participants (competition_id, user_id) values
  ('44440000-0000-4000-8000-000000000001', '0ffe0000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- Migreringerne
-- ---------------------------------------------------------------------------
-- `A40`s to trin FØRST, i produktionens rækkefølge. De skal med, fordi
-- `sql/schema.sql` er et øjebliksbillede, der endnu ikke er eksporteret efter
-- `A40` — og fordi halvdelen af påstandene nedenfor handler netop om, at #54
-- IKKE flytter den mur, de to byggede.
\ir ../invite_lookup.sql
\ir ../invite_policies.sql
\ir ../invite_preview.sql

-- Kør en forespørgsel som `anon` og svar `afvist` eller antallet af rækker.
--
-- To udfald og ikke ét, af samme grund som `skriv()` i
-- `sql/tests/invite_lookup.sql` har tre: en manglende TABEL-rettighed (`G50`)
-- og en RLS-policy, der bare skjuler rækkerne, er to forskellige ting. Begge er
-- sikre; at kunne skelne dem er det, der gør en fremtidig ændring læsbar.
create function pg_temp.som_anon(p_sql text) returns text
language plpgsql as $$
declare v_n bigint; v_bruger text;
begin
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  v_bruger := current_user;
  if v_bruger <> 'anon' then
    raise exception 'rolleskiftet virkede ikke: kørte som %', v_bruger;
  end if;
  execute p_sql into v_n;
  reset role;
  return v_n::text;
exception when insufficient_privilege then
  reset role;
  return 'afvist';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Funktionens form
-- ---------------------------------------------------------------------------
do $$
declare v_secdef boolean; v_volatil "char";
begin
  select prosecdef, provolatile into v_secdef, v_volatil
    from pg_proc where pronamespace = 'public'::regnamespace and proname = 'invite_preview';
  if v_secdef is null then
    raise exception '1: invite_preview() findes ikke';
  end if;
  if v_secdef is distinct from true then
    raise exception '1: invite_preview() er ikke security definer — så kan anon intet se';
  end if;
  -- 's' = stable. En ANONYM funktion, der kunne skrive, ville være en helt
  -- anden slags flade end den billedtekst, den er ment som.
  if v_volatil is distinct from 's' then
    raise exception '1: invite_preview() er ikke stable (volatilitet=%) — den må ikke kunne skrive', v_volatil;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Snittet mellem ETIKET og ADGANG
-- ---------------------------------------------------------------------------
-- ⚠️ PÅSTANDEN MÅLER ADFÆRD OG IKKE GRANTS, og det er ikke en forenkling —
-- det var den eneste rigtige måde at stille den på. Første udgave spurgte
-- `has_function_privilege('anon', 'invite_lookup', 'execute')` og forventede
-- `false`. Den fejlede med det samme, og svaret er værd at have skrevet ned:
--
-- **`anon` HAR EXECUTE på hver eneste funktion i `public`.** Supabases default
-- privileges giver `grant all on functions to anon` (se `schema.sql`s afsnit om
-- DEFAULT ACL), og `G50`/`G58` lukkede kun TABELLERNE og SEKVENSERNE — ikke
-- funktionerne. `revoke execute from public` i `invite_lookup.sql` fjerner
-- derfor PUBLIC's adgang, men ikke `anon`s egen.
--
-- Det, der faktisk holder en fremmed ude af de to, er deres egen vagt:
-- `if auth.uid() is null then raise exception 'forbidden'`. Den linje er altså
-- BÆRENDE og ikke en dobbeltsikring — og det er præcis dét, en test skal holde
-- fast i, for den kan fjernes af et uheld, uden at nogen grant ser anderledes ud.
--
-- (At `anon` kan kalde alt, er noteret i backloggen som en selvstændig
-- oprydning: den koster en migrering mere og hører ikke til `I7`.)
do $$
declare v_fejl text;
begin
  if not has_function_privilege('anon', 'public.invite_preview(text)', 'execute') then
    raise exception '2: anon kan ikke køre invite_preview() — hele formålet er tabt';
  end if;

  -- Previewet SVARER en anonym kalder. Det er hele forskellen på de tre.
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin
    if public.invite_preview('ligakode')->>'kind' is distinct from 'group' then
      raise exception '2: invite_preview() svarede ikke anon på en gyldig kode';
    end if;
  exception when insufficient_privilege then
    raise exception '2: anon blev afvist af invite_preview() — hele formålet er tabt';
  end;

  -- De to andre er `A40`s mur, og previewet må ikke have flyttet den.
  begin
    perform public.invite_lookup('ligakode');
    raise exception '2: invite_lookup() svarede en anonym kalder — A40 er rullet tilbage';
  exception when insufficient_privilege then
    null; -- 'forbidden' rejses med errcode 42501; det er den rigtige afvisning
  end;

  begin
    perform public.accept_invite('ligakode');
    raise exception '2: accept_invite() svarede en anonym kalder — en fremmed kan melde sig ind';
  exception when insufficient_privilege then
    null;
  end;
  reset role;

  -- Og muren skal stadig stå, når rollen er lagt fra sig igen.
  if current_user = 'anon' then
    raise exception '2: rollen blev ikke lagt fra sig';
  end if;
exception when others then
  get stacked diagnostics v_fejl = message_text;
  reset role;
  raise exception '%', v_fejl;
end $$;

-- ---------------------------------------------------------------------------
-- 3. anon kan stadig ikke læse tabellerne selv
-- ---------------------------------------------------------------------------
-- `afvist` er det, produktionen svarer i dag: `G50` fjernede `anon`s
-- TABEL-rettigheder helt, så forespørgslen når aldrig frem til RLS. `0` ville
-- også være sikkert (rettigheden tilbage, men policyen skjuler rækkerne) og
-- accepteres derfor — alt andet er hullet, `A40` lukkede, åbnet igen.
do $$
declare v text;
begin
  foreach v in array array['groups', 'competitions'] loop
    if pg_temp.som_anon(format('select count(*) from public.%I', v)) not in ('afvist', '0') then
      raise exception '3: anon kunne læse rækker i % direkte — funktionen er overflødig, og hullet er tilbage', v;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Svaret bærer KUN etiketten
-- ---------------------------------------------------------------------------
do $$
declare v_noegler text[];
begin
  select array(select jsonb_object_keys(public.invite_preview('ligakode')) order by 1)
    into v_noegler;
  if v_noegler is distinct from array['kind', 'member_count', 'name'] then
    raise exception '4: liga-svarets nøgler er % — forventede kind, member_count, name', v_noegler;
  end if;

  select array(select jsonb_object_keys(public.invite_preview('konkkode')) order by 1)
    into v_noegler;
  if v_noegler is distinct from array['group_name', 'kind', 'member_count', 'name'] then
    raise exception '4: konkurrence-svarets nøgler er % — forventede group_name, kind, member_count, name', v_noegler;
  end if;

  -- Den negative halvdel, sagt eksplicit: dét, der ALDRIG må slippe ud, uanset
  -- hvilke felter der ellers måtte blive tilføjet senere.
  if exists (
    select 1 from unnest(array['ligakode', 'konkkode']) k,
                  jsonb_object_keys(public.invite_preview(k)) n
     where n in ('id', 'invite_code', 'created_by', 'group_id')
  ) then
    raise exception '4: svaret bærer et id eller selve koden — det må det aldrig';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Værdierne
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  v := public.invite_preview('ligakode');
  if v->>'kind' is distinct from 'group' then raise exception '5: liga-koden gav kind=%', v->>'kind'; end if;
  if v->>'name' is distinct from 'Fodboldkammeraterne' then raise exception '5: forkert liganavn: %', v->>'name'; end if;
  if (v->>'member_count')::int is distinct from 2 then raise exception '5: forkert medlemstal: %', v->>'member_count'; end if;

  v := public.invite_preview('konkkode');
  if v->>'kind' is distinct from 'competition' then raise exception '5: konkurrence-koden gav kind=%', v->>'kind'; end if;
  if v->>'name' is distinct from 'EM-kuponen' then raise exception '5: forkert konkurrencenavn: %', v->>'name'; end if;
  -- Ligaens navn skal med: en konkurrence-invitation melder også ind i ligaen
  -- (`A8`), og modtageren skal kunne se begge dele, de siger ja til.
  if v->>'group_name' is distinct from 'Fodboldkammeraterne' then
    raise exception '5: ligaens navn manglede på konkurrence-svaret: %', v->>'group_name';
  end if;
  if (v->>'member_count')::int is distinct from 1 then raise exception '5: forkert deltagertal: %', v->>'member_count'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Ingenting afsløres om det, der ikke findes
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  foreach v in array array[
    public.invite_preview('detherfindesikke'),
    public.invite_preview(''),
    public.invite_preview(null),
    public.invite_preview(repeat('a', 500))
  ] loop
    if v->>'kind' is distinct from 'none' then
      raise exception '6: en kode uden træf gav % i stedet for none', v->>'kind';
    end if;
    if (select count(*) from jsonb_object_keys(v)) is distinct from 1 then
      raise exception '6: none-svaret bærer mere end kind: %', v;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Eksakt match — samme regel som invite_lookup()
-- ---------------------------------------------------------------------------
do $$
begin
  -- Mellemrum trimmes (det gør invite_lookup() også) …
  if public.invite_preview('  ligakode  ')->>'kind' is distinct from 'group' then
    raise exception '7: mellemrum omkring koden burde trimmes';
  end if;
  -- … men store bogstaver oversættes IKKE. Gjorde previewet det, ville en kode
  -- kunne have en billedtekst uden at have et opslag, og de to funktioner ville
  -- svare forskelligt på den samme streng.
  if public.invite_preview('LIGAKODE')->>'kind' is distinct from 'none' then
    raise exception '7: previewet matcher uden hensyn til store bogstaver — invite_lookup() gør ikke';
  end if;
end $$;

select 'invite_preview: OK' as result;
