-- Læsefladen smalnes — TRIN 1 af 2 (A43).
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- 📍 `#N` er en migrering: nummeret står i kolonne 1 i filoversigten i
--    `sql/README.md`, hvor filnavnene er links. `#52` = `invite_lookup.sql`,
--    `#53` = `invite_policies.sql`, denne fil er `#59` og dens anden halvdel
--    `#60` = `read_scope_narrow.sql`.
--
-- ✅ **REN TILFØJELSE — SIKKER AT KØRE NÅR SOM HELST, OGSÅ FØR FRONTEND-MERGEN.**
-- Filen tilføjer fire funktioner og deres grants. Ingen policy røres, ingen
-- rettighed smalnes, ingen række ændres. Den nuværende klient kalder ingen af
-- dem og mærker derfor intet; den nye ville allerede virke. Samme form og samme
-- begrundelse som `#52` og `#57`.
--
-- ---------------------------------------------------------------------------
-- RÆKKEFØLGEN, OG HVORFOR DEN IKKE ER "SAMTIDIG"
--
--   1. Kør DENNE fil.  Gammel klient: uændret. Ny klient: virker.
--   2. Merge og udrul. Gammel klient væk.      Ny klient: virker.
--   3. Kør #60.        Fladen smalnet.         Ny klient: virker.
--
-- Hvert trin har en tilstand, hvor det, der er i produktion, virker — præcis
-- `A40`s opdeling og af samme grund: Supabase køres i hånden og Vercel deployer
-- af sig selv, så "samtidig" er ikke en instruks, et menneske kan følge.
-- Runbogen står i [`docs/UDRULNING-A43.md`](../docs/UDRULNING-A43.md).
--
-- ---------------------------------------------------------------------------
-- HVAD DER ER GALT, OG HVORFOR DET ER TO FORSKELLIGE PROBLEMER
--
-- `profiles` og `competition_participants` har hver en SELECT-policy på
-- `auth.role() = 'authenticated'` og intet andet (`read profiles`, `read all
-- participation`). `A40` smalnede `groups` og `competitions` og gik netop uden
-- om disse to. Rækken `A43` foreslog `A40`s vej for begge — og gennemlæsningen
-- viste, at de har MODSATTE svar:
--
--   · **`profiles` er et KOLONNE-problem.** Rating-fanen, Månedsligaen og
--     Championship (`scope = 'ALL'`) viser hver eneste brugers visningsnavn til
--     enhver indlogget — med vilje. En rækkepolicy ville tømme hver eneste
--     stilling OG skjule præcis det ene felt, produktet selv publicerer. Det,
--     der IKKE er publiceret, er resten af rækken: `is_admin` (peger på, hvilken
--     konto der er værd at angribe), `last_seen_at` (adfærdsdata pr. navngiven
--     person), `created_at` og `display_name_changed_at`.
--
--   · **`competition_participants` er et RÆKKE-problem.** Deltagerlisten er
--     ikke publiceret nogen steder — man ser kun deltagerne i konkurrencer, man
--     selv er med i — men i dag kan enhver med en konto hente hele det sociale
--     netværk med ét kald.
--
-- Værktøjet til den første lå allerede i repoet, i modsat retning:
-- `sql/username_change.sql` (#51) gav `authenticated` KOLONNE-grants på
-- SKRIVNING, netop fordi *en policy kan afgrænse rækken, ikke kolonnen*. Samme
-- greb på LÆSNING lukker `profiles`-halvdelen uden at røre en eneste policy.
--
-- Denne fil bygger det, klienten skal bruge, når de to kolonner og den ene
-- policy forsvinder i `#60`.
--
-- ---------------------------------------------------------------------------
-- 🔴 EN RETTIGHED, DER OGSÅ RAMMER SKRIVNINGER — LÆS DEN, FØR DU RETTER KLIENTEN
--
-- `revoke select` i `#60` rammer mere end de opslag, man kan få øje på.
-- PostgREST sender `Prefer: return=representation` på hver `insert`, `upsert`,
-- `update` og `delete`, og en RETURNING-klausul **kræver LÆSE-privilegiet på de
-- kolonner, den giver tilbage.** Uden et `select=` i URL'en returnerer PostgREST
-- alle kolonner — altså også dem, `#60` lukker.
--
-- Følgen er, at et navneskift og oprettelsen af en profil fejler med
-- `permission denied for table profiles`, selvom UPDATE- og INSERT-rettigheden
-- er i orden. Det er samme mekanik som produktionsfejlen 11. august 2026
-- (`#55`: en RETURNING-klausul anvender SELECT-**policyen**) — bare på
-- privilegier frem for på policies, og derfor et sted, ingen policy-revision
-- ville have fundet den.
--
-- Efterprøvet mod PostgreSQL 16.13: `insert … on conflict … returning *` som
-- `authenticated` svarer `42501`, mens `returning id, display_name` går igennem.

-- ---------------------------------------------------------------------------
-- 1. `my_profile()` — ens EGEN række, hele vejen rundt
-- ---------------------------------------------------------------------------
-- Klienten læser sin egen profil to steder (`App.jsx`, `sikrProfil()` i
-- `src/lib/data/profile.js`), og begge steder med `select=*`. Det er ikke
-- dovenskab: `MainApp.jsx` afgør admin-fanen på `profile.is_admin`, og det felt
-- forsvinder fra tabellens læseflade i `#60`.
--
-- **Ens egen række er ikke det, rækken beskytter.** `is_admin` om ANDRE er en
-- oplysning om, hvilken konto der er værd at angribe; `is_admin` om én selv er
-- en oplysning, brugeren allerede har (fanen står der). Funktionen giver derfor
-- hele rækken tilbage — men kun kalderens egen.
--
-- **Ingen `auth.uid() is null`-vagt, og det er med vilje.** Filtret ER
-- `auth.uid()`: uden en session sammenlignes `p.id` med null, og resultatet er
-- ingen rækker. En `raise exception` ville være teater — der er ikke en
-- betingelse at snyde, kun en tom mængde. (Modsat `create_group()`, hvor
-- `auth.uid()` SKRIVES og et null derfor skal stoppes.)
--
-- `to_jsonb` frem for en håndskrevet nøgleliste, så en ny kolonne på `profiles`
-- følger med af sig selv — klienten fik hele rækken fra PostgREST før og skal
-- have præcis det samme.

create or replace function public.my_profile()
returns jsonb
language sql
security definer
set search_path to 'public'
stable
as $$
  select to_jsonb(p) from public.profiles p where p.id = auth.uid();
$$;

revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. `admin_profiles()` — Admin → Brugere
-- ---------------------------------------------------------------------------
-- Brugerlisten i Admin → Brugere (`src/screens/admin/UsersPanel.jsx`) er det
-- ene sted i appen, der læser `created_at`, `last_seen_at` og `is_admin` om
-- ANDRE — altså præcis de tre kolonner, `#60` lukker. Skærmen er ikke forkert;
-- den er bare bygget på en rettighed, der var for bred til alle andre.
--
-- Vagten er den samme som i de fem eksisterende admin-funktioner
-- (`admin_user_stats()`, `admin_feedback()`, `admin_client_errors()`,
-- `admin_job_health()`, `admin_anonymize_account()`): `is_admin` på kalderens
-- egen profilrække. Den er ikke svækket af noget her — `#51` gjorde `is_admin`
-- uskrivelig for `authenticated`, og `#60` gør den også ulæselig om andre.
--
-- **Kolonnelisten er udtømmende og bevidst:** funktionen svarer med de seks
-- felter, skærmen faktisk viser, og ikke med `to_jsonb(p)`. En ny kolonne på
-- `profiles` skal vælges ind her, ikke arves — samme regel som grant'en i
-- `#51`, og af samme grund.
--
-- Sorteringen ligger i funktionen frem for i klientens `order=`: efter `#60`
-- kan `authenticated` ikke længere sortere på `created_at`, fordi ORDER BY på
-- en kolonne uden læse-privilegium også afvises med `42501`.

create or replace function public.admin_profiles()
returns table (
  id                 uuid,
  display_name       text,
  created_at         timestamptz,
  last_seen_at       timestamptz,
  is_admin           boolean,
  anonymized_at      timestamptz
)
language plpgsql
security definer
set search_path to 'public'
stable
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select p.id, p.display_name, p.created_at, p.last_seen_at, p.is_admin, p.anonymized_at
      from public.profiles p
     order by p.created_at desc;
end;
$$;

revoke all on function public.admin_profiles() from public, anon;
grant execute on function public.admin_profiles() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. `is_platform_admin()` — den vagt, tre POLICIES stod og læste med
-- ---------------------------------------------------------------------------
-- 🔴 **DEN FUNKTION, RÆKKEN IKKE VIDSTE, DEN HAVDE BRUG FOR — OG UDEN DEN
-- BRÆKKER `#60` ADMIN → DRIFT FOR ALLE, OGSÅ FOR EN ADMINISTRATOR.**
--
-- En RLS-policys udtryk evalueres med den KALDENDE rolles privilegier. Tre
-- policies slår op i `profiles.is_admin`:
--
--   · `job_runs_read_admin`   (SELECT) — Admin → Drift, hele skærmen
--   · `matches_update_admin`  (UPDATE) — "Hent nu" og syncens rettelser
--   · `matches_insert_admin`  (INSERT) — do.
--
-- I det sekund `#60` fjerner `is_admin` fra `authenticated`s læseflade, holder
-- de tre policies op med at FILTRERE og begynder at FEJLE:
-- `permission denied for table profiles`, 42501. Forskellen er hele pointen —
-- en policy, der ikke passer, giver nul rækker; en policy, der ikke kan
-- evalueres, giver en fejl. `select count(*) from public.job_runs` som en
-- ADMINISTRATOR svarer 42501. Efterprøvet mod PostgreSQL 16.13.
--
-- **Fundet af `sql/tests/write_surface.sql`, kørt mod et skema, hvor `#60`
-- allerede var kørt** — altså af den efterprøvning fra BEGGE sider af dumpet,
-- som `G94` og `G98` gjorde til en regel (`DOCUMENTATION.md` §13). Ingen
-- gennemlæsning af klienten kunne have fundet den: de tre steder er policies og
-- ikke kaldesteder.
--
-- Løsningen er den, repoet i forvejen bruger til det samme problem ét niveau
-- nede: en `security definer`-funktion, som kører som ejer og derfor ikke
-- rammes af kalderens kolonne-privilegier. Præcis `is_group_member`s form og
-- begrundelse, bare for platformens administrator frem for ligaens.

create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin
  );
$$;

revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. `is_competition_visible()` — reglen for, hvem der må se en konkurrence
-- ---------------------------------------------------------------------------
-- 🔴 **DEN VIGTIGSTE FUNKTION I FILEN, OG DEN ENESTE, DER IKKE KAN SKRIVES
-- ANDERLEDES.** `#60`s policy på `competition_participants` skal spørge, om
-- kalderen må se konkurrencen — og den må hverken slå op i `competitions` eller
-- i sin egen tabel:
--
--   · **Sin egen tabel** er den kendte fælde (produktbogens 24.7,
--     `DOCUMENTATION.md` §13): en SELECT-policy, der læser den tabel, den
--     beskytter, udløser sig selv.
--   · **`competitions`** er den NYE halvdel, og den er ikke åbenlys:
--     `competitions_select_involved` (#53) slår selv op i
--     `competition_participants`. Så snart deltagertabellen får en policy, der
--     slår op i `competitions`, peger de to på hinanden.
--
-- Efterprøvet mod PostgreSQL 16.13 med præcis den naive policy: svaret er
-- `42P17 infinite recursion detected in policy for relation
-- "competition_participants"` — **og `select * from competitions` fejler med
-- samme fejl.** Rekursionen bliver altså ikke ved deltagerlisten; den slukker
-- for hele konkurrencelaget. Det er værd at kende, fordi symptomet ikke ligner
-- sin årsag: man har rørt én policy og mistet en anden tabel.
--
-- **Funktionen er også det ene sted, reglen står.** `#60` lader
-- `competitions_select_involved` kalde den frem for at gentage prædikatet, så
-- de to policies ikke kan drive fra hinanden. Det er samme begrundelse som
-- `sql/checks/`s "en regel, der køres to steder, må kun findes ét" — og her er
-- prisen for to kopier ikke uenighed i et svar, men to forskellige svar på
-- "hvem må se den her konkurrence".
--
-- Reglen selv er ordret `#53`s, og de tre led har hver deres grund (se
-- `sql/invite_policies.sql`): opretteren, fordi en liga-løs konkurrence ellers
-- bliver usynlig for den, der lige har lavet den; ligaens medlemmer, fordi
-- ligasiden viser alle ligaens konkurrencer med en "Deltag"-knap ved dem, man
-- ikke er med i; og deltagerne selv.

create or replace function public.is_competition_visible(cid uuid)
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $$
  select exists (
    select 1
      from public.competitions c
     where c.id = cid
       and (
         c.created_by = auth.uid()
         or (c.group_id is not null and public.is_group_member(c.group_id))
         or exists (select 1 from public.competition_participants cp
                     where cp.competition_id = c.id and cp.user_id = auth.uid())
       )
  );
$$;

revoke all on function public.is_competition_visible(uuid) from public, anon;
grant execute on function public.is_competition_visible(uuid) to authenticated, service_role;

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- ⚠️ Blokkene er KOMMENTERET UD, så hele filen kan pastes i ét stykke.
--
-- 1) De fire funktioner findes og er security definer. Forvent fire rækker, 't'.
-- select proname, prosecdef from pg_proc
--  where pronamespace = 'public'::regnamespace
--    and proname in ('my_profile', 'admin_profiles', 'is_platform_admin',
--                    'is_competition_visible')
--  order by proname;

-- 2) `anon` kan ingen af dem. Forvent fire gange 'f'.
-- select has_function_privilege('anon', 'public.my_profile()', 'EXECUTE'),
--        has_function_privilege('anon', 'public.admin_profiles()', 'EXECUTE'),
--        has_function_privilege('anon', 'public.is_platform_admin()', 'EXECUTE'),
--        has_function_privilege('anon', 'public.is_competition_visible(uuid)', 'EXECUTE');

-- 3) `is_competition_visible()` svarer det samme som den policy, den skal
--    afløse. Kør som `postgres` (altså uden session): forvent NUL rækker, fordi
--    begge sider er falske uden en `auth.uid()`. Den rigtige måling er testens
--    matrix i `sql/tests/read_scope.sql`.
-- select c.id from public.competitions c
--  where public.is_competition_visible(c.id)
--    <> (c.created_by = auth.uid()
--        or (c.group_id is not null and public.is_group_member(c.group_id))
--        or exists (select 1 from public.competition_participants cp
--                    where cp.competition_id = c.id and cp.user_id = auth.uid()));

-- 4) `my_profile()` og `admin_profiles()` kræver en session og kan derfor ikke
--    afprøves i SQL-editoren (`auth.uid()` er null). Prøv appen efter deployet:
--    admin-fanen skal stadig stå, og Admin → Brugere skal vise listen.

-- ============================================================================
-- Tilbagerulning
-- ============================================================================
-- Ikke nødvendig: filen er additiv, og intet i produktionen kalder de tre
-- funktioner, før klienten er udrullet. Skal de alligevel væk, skal `#60`
-- rulles tilbage FØRST — dens policy kalder `is_competition_visible()`:
-- drop function if exists public.my_profile();
-- drop function if exists public.admin_profiles();
-- drop function if exists public.is_platform_admin();
-- drop function if exists public.is_competition_visible(uuid);
