-- Brugernavne: længde, unikhed og opslaget før oprettelse.
-- Idempotent — kan køres igen når som helst (kør med "Run without RLS").
--
-- Filen samler ALT, produktet lover om et brugernavn (DOCUMENTATION.md §6):
-- det er 2–20 tegn, det er unikt uden hensyn til store og små bogstaver, og
-- man kan spørge, om det er ledigt, før man opretter en konto.
--
-- ---------------------------------------------------------------------------
-- Hvorfor de to sidste kom til i august 2026 (G63)
--
-- `username_available()` og `profiles_display_name_lower_idx` fandtes kun i den
-- GENEREREDE `schema.sql`, mens denne fil alene rummede længde-constrainten.
-- Det var ikke et hul i produktion — objekterne står der — men i
-- **gendannelsesvejen**: `sql/`-scripterne er den dokumenterede kilde til at
-- bygge skemaet op igen, og `docs/RESTORE.md` bruger kun `schema.sql` som en
-- genvej. Køres scripterne enkeltvis i stedet — fx i et staging-projekt
-- (`B18`) — fik man en database, hvor to brugere kunne hedde det samme, og hvor
-- signup-tjekket slet ikke fandtes. Det ville først vise sig, når det skete.
--
-- Unikke brugernavne er desuden en garanti, produktet giver eksplicit, og en
-- garanti, der kun står i et genereret øjebliksbillede, er ikke versioneret.

-- ---------------------------------------------------------------------------
-- 1. Længden: 2–20 tegn efter trim
--
-- Frontenden validerer også (Auth.jsx), men constraint'en er den egentlige
-- garanti, der ikke kan omgås. Grænsen beskytter samtidig mobil-layoutet:
-- display_name bruges bl.a. som kolonneoverskrift i "Point pr. runde"-tabellen.
--
-- NOT VALID: eksisterende rækker tjekkes ikke (undgår fejl på evt. gamle,
-- lange navne), men alle nye/ændrede rækker håndhæves. Er alle eksisterende
-- navne inden for grænsen, kan man senere køre:
--   alter table public.profiles validate constraint profiles_display_name_len;

alter table public.profiles drop constraint if exists profiles_display_name_len;
alter table public.profiles
  add constraint profiles_display_name_len
  check (char_length(btrim(display_name)) between 2 and 20) not valid;

-- ---------------------------------------------------------------------------
-- 2. Unikheden: ét navn, uanset store og små bogstaver
--
-- Et UNIKT INDEKS på `lower(display_name)` og ikke en unique constraint:
-- constraints kan ikke stå på et udtryk. Det er derfor navnet ender på `_idx`
-- og ikke på `_key`.
--
-- `if not exists` frem for drop/create: indekset findes i produktion, og et
-- drop ville i det korte øjeblik, det tager at genopbygge, lade to samtidige
-- oprettelser slippe igennem med samme navn. En gen-kørsel skal koste
-- ingenting.
--
-- ⚠️ Bygges skemaet op fra bunden med data i `profiles`, fejler sætningen, hvis
-- der allerede ER dubletter. Det er med vilje: en tavs oprettelse ville betyde,
-- at garantien ikke gjaldt, uden at nogen opdagede det. Ryd dubletterne først.

create unique index if not exists profiles_display_name_lower_idx
  on public.profiles (lower(display_name));

-- ---------------------------------------------------------------------------
-- 3. Opslaget: er navnet ledigt?
--
-- SECURITY DEFINER, fordi den kaldes af rollen `anon` — altså FØR login, hvor
-- der ikke findes et JWT. Det er hele grunden til, at `anon_grants.sql` (#34)
-- kunne fjerne rollens tabel-privilegier uden at knække oprettelsen: funktionen
-- svarer ja/nej og giver ingen adgang til `profiles`. En version, der læste
-- tabellen som kalderen, ville kræve en select-policy for `anon` på profiler —
-- altså at hele brugerlisten var offentlig for at kunne tjekke ét navn.
--
-- `set search_path to 'public'` er ikke pynt på en SECURITY DEFINER: uden den
-- kan kalderen pege `profiles` et andet sted hen.
--
-- Sammenligningen er `lower(trim(name))` — nøjagtig det udtryk, indekset i
-- trin 2 står på, så opslaget bruger indekset og svarer det samme, som
-- indsættelsen vil håndhæve et øjeblik senere. To forskellige udtryk her ville
-- give et "ledigt", der blev til en constraint-fejl.
--
-- Kroppen er hentet ORDRET fra `schema.sql` (`prosrc`), så gen-kørslen ikke
-- flytter en eneste byte — samme regel som `rating_core.sql`s, se `G5`.

create or replace function public.username_available(name text) returns boolean
  language sql security definer
  set search_path to 'public'
  as $$
  select not exists (
    select 1 from public.profiles where lower(display_name) = lower(trim(name))
  );
$$;

grant execute on function public.username_available(text) to anon, authenticated, service_role;

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- 1) Alle tre objekter står der. Forvent tre rækker.
-- select 'constraint' as slags, conname as navn
--   from pg_constraint where conname = 'profiles_display_name_len'
-- union all
-- select 'index', indexname from pg_indexes
--  where schemaname = 'public' and indexname = 'profiles_display_name_lower_idx'
-- union all
-- select 'function', proname from pg_proc
--  where proname = 'username_available' and pronamespace = 'public'::regnamespace;

-- 2) Opslaget svarer. Forvent true for et navn, ingen har.
-- select public.username_available('et-eller-andet-navn');

-- 3) Unikheden er case-insensitiv og trimmer. Forvent false, hvis nogen hedder "Anna".
-- select public.username_available('  aNnA ');
