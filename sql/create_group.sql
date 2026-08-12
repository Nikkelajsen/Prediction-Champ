-- Ligaen og dens første medlem bliver ÉN skrivning (G95).
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- ✅ **REN TILFØJELSE — SIKKER AT KØRE NÅR SOM HELST, OGSÅ FØR FRONTEND-MERGEN.**
-- Filen tilføjer én funktion og dens grants. Ingen policy røres, ingen rettighed
-- smalnes, ingen række ændres. Den nuværende klient kalder ikke funktionen og
-- mærker derfor intet; den nye ville allerede virke. Samme form og samme
-- begrundelse som `#52`.
--
-- ---------------------------------------------------------------------------
-- HVAD DER VAR GALT — OG HVOR GALT DET VAR
--
-- `createGroup` (`src/lib/data/groups.js`) skrev ligaen i ét kald og
-- opretterens admin-række i det NÆSTE:
--
--     const [g] = await db.insert(token, "groups", [...]);
--     await db.insert(token, "group_members", [...]);
--
-- To PostgREST-kald er to transaktioner, og rækkefølgen er bindende: ligaen
-- skal findes, før medlemsrækken kan pege på den. Fejler kald nummer to —
-- netværk, RLS, en lukket fane, hvad som helst — er resultatet en **forældreløs
-- liga**: den har en `created_by`, men ingen medlemmer. Følgen er, at den ikke
-- vises i nogens oversigt (`loadMyGroups` læser `group_members`), ikke kan
-- forlades og ikke kan slettes gennem UI'et. Den kan kun ses af `A37`s kontrol,
-- `sql/checks/league_admin_coverage.sql`, og først når nogen kigger.
--
-- **Nul forekomster i produktion** (talt ved `A40`s udrulning 11. august 2026).
-- Gælden er altså vinduets eksistens og ikke en oprydning — men vinduet lukker
-- ikke af sig selv, og prisen for at lukke det er én funktion.
--
-- ---------------------------------------------------------------------------
-- HVORFOR EN FUNKTION OG IKKE EN TRIGGER
--
-- En `after insert`-trigger på `groups`, der indsatte admin-rækken, ville også
-- gøre de to skrivninger til én transaktion — og den ville endda dække de
-- skrivninger, der ikke kommer fra klienten. Den blev valgt fra af to grunde:
--
--   1. **`A8`-triggeren har allerede vist, hvad en usynlig skrivning koster.**
--      `ensure_group_membership_for_participant()` UDFYLDER et medlemskab frem
--      for at afvise, og netop dét gjorde, at en mutation, som fjernede
--      liga-indmeldingen i `accept_invite()`, ikke fik nogen test til at fejle
--      (`sql/invite_lookup.sql`s hoved). En trigger mere på samme område ville
--      gøre det endnu sværere at læse, hvem der egentlig skriver hvad.
--   2. **Funktionen kan svare.** Klienten skal bruge ligaen tilbage (id og navn
--      til navigation og til `league_created`-hændelsen), og en RPC returnerer
--      den i samme rundtur. En trigger ville efterlade klientens `insert …
--      returning` — altså præcis det statement, hasterettelsen `#55` handler om.
--
-- ---------------------------------------------------------------------------
-- HVAD DER **IKKE** ER MED, OG HVORFOR
--
-- 🔴 **`groups`' SELECT-policy beholder sit `or created_by = auth.uid()`.**
-- `#55` gav den leddet, fordi `db.insert` sender `Prefer: return=representation`
-- og PostgREST derfor kører `insert … returning *` — og en RETURNING-klausul
-- anvender SELECT-policyen på den nye række, hvor opretteren endnu ikke er
-- medlem. Denne funktion fjerner behovet: den skriver som ejer, så ingen policy
-- konsulteres undervejs.
--
-- **Men leddet må ikke fjernes i samme ombæring.** Så længe den gamle klient er
-- i luften — og det er den, indtil deployet er kørt — er det direkte `insert …
-- returning` stadig den vej, en liga bliver til. Fjernes leddet før deployet,
-- kan ingen oprette en liga, hvilket er nøjagtig den produktionsfejl, `#55` blev
-- skrevet for at rette. Smalningen er derfor en SELVSTÆNDIG opgave efter
-- udrulningen og står som `G98` i backloggen — sammen med den bivirkning, den
-- lukker: en opretter, der har forladt sin egen liga, kan i dag stadig se den og
-- dens `invite_code`.
--
-- ---------------------------------------------------------------------------
-- SIKKERHEDEN: HVAD `SECURITY DEFINER` SKAL BÆRE SELV
--
-- Funktionen skriver som ejer og forbigår dermed de to insert-policies, den
-- afløser. Begge regler er derfor skrevet ind i kroppen frem for at hvile på
-- RLS:
--
--   · `groups_insert_own`             → `created_by` sættes til `auth.uid()`
--                                       og kan ikke sendes med udefra.
--   · `group_members_insert_creator`  → medlemsrækken er kalderens egen, har
--                                       rollen `admin` og peger på den liga,
--                                       kaldet lige har oprettet.
--
-- **Funktionen har ÉN parameter, og det er en sikkerhedsegenskab og ikke en
-- forglemmelse:** der findes ikke et bruger-id at forfalske. Samme argument som
-- `anonymize_my_account()`s nul parametre (`#31`).
--
-- Navnereglen bliver derimod stående i tabellens check-constraint (2–40 tegn).
-- En kopi i funktionen ville være et andet sted, den kunne drive fra —
-- constrainten gælder uanset hvem der skriver, og fejlteksten er den samme, som
-- klienten fik før.

create or replace function public.create_group(p_name text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid   uuid := auth.uid();
  v_navn  text := btrim(coalesce(p_name, ''));
  v_group public.groups%rowtype;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- De to skrivninger, der før var to kald. Rækkefølgen er uændret og stadig
  -- bindende — medlemsrækken har en fremmednøgle til ligaen — men den er nu
  -- ligegyldig for udfaldet: fejler den anden, ruller den første med.
  insert into public.groups (name, created_by)
  values (v_navn, v_uid)
  returning * into v_group;

  insert into public.group_members (group_id, user_id, role)
  values (v_group.id, v_uid, 'admin');

  -- Hele rækken retur, `invite_code` inklusive. Det er ikke en lækage: modtageren
  -- er den, der lige har oprettet ligaen, og koden er dét, hun skal invitere med.
  -- `to_jsonb` frem for en håndskrevet nøgleliste, så en ny kolonne på `groups`
  -- følger med af sig selv — klienten fik før hele rækken fra PostgREST og skal
  -- have præcis det samme.
  return to_jsonb(v_group);
end;
$$;

-- `revoke … from public` FØR `grant`, og det er nu en REGEL og ikke en vane:
-- PostgreSQLs indbyggede default giver PUBLIC — og dermed `anon` — EXECUTE på
-- hver ny funktion, og den default kan ikke lukkes med `ALTER DEFAULT
-- PRIVILEGES` (se `sql/anon_grants_functions.sql`, `G96`). `anon` nævnes
-- eksplicit, så filen er uafhængig af, om `G96` er kørt før eller efter denne.
revoke all on function public.create_group(text) from public, anon;
grant execute on function public.create_group(text) to authenticated, service_role;

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- ⚠️ Blokkene er KOMMENTERET UD, så hele filen kan pastes i ét stykke.
--
-- 1) Funktionen findes og er security definer. Forvent én række, 't'.
-- select proname, prosecdef from pg_proc
--  where pronamespace = 'public'::regnamespace and proname = 'create_group';

-- 2) `anon` kan den ikke. Forvent 'f'.
-- select has_function_privilege('anon', 'public.create_group(text)', 'EXECUTE');

-- 3) Ingen forældreløs liga i produktion. Forvent 0 rækker — samme forespørgsel
--    som `sql/checks/league_admin_coverage.sql` stiller bredere.
-- select g.id, g.name, g.created_at from public.groups g
--  where not exists (select 1 from public.group_members m where m.group_id = g.id);

-- 4) Selve kaldet kræver en session (`auth.uid()` er null i SQL-editoren) og
--    kan derfor ikke afprøves her — prøv "Opret liga" i appen efter deployet.

-- ============================================================================
-- Tilbagerulning
-- ============================================================================
-- Ikke nødvendig: funktionen er additiv, og den gamle vej (to `insert`) står
-- urørt, indtil `G98` smalner `groups`' SELECT-policy. Skal den alligevel væk:
-- drop function if exists public.create_group(text);
