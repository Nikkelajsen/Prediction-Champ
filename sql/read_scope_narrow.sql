-- Læsefladen smalnes — TRIN 2 af 2 (A43).
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- 📍 Denne fil er `#60`. Første halvdel er `#59`
--    ([`read_scope_functions.sql`](./read_scope_functions.sql)).
--
-- 🔴 **KØR FØRST, NÅR DEN NYE KLIENT ER UDRULLET OG AFPRØVET.**
-- FORUDSÆTNING: `#59` skal være kørt. Policyen nedenfor kalder
-- `is_competition_visible()`, som bor dér — kør denne fil uden den, og
-- `create policy` fejler med `42883: function … does not exist`. Det er med
-- vilje den vej rundt: en fejl ved oprettelsen er bedre end en policy, der
-- refererer til noget, der ikke findes.
--
-- RÆKKEFØLGEN, OG HVAD DER SKER, HVIS DEN BRYDES
--
--   1. Kør #59.        Gammel klient: uændret. Ny klient: virker.
--   2. Merge og udrul. Gammel klient væk.      Ny klient: virker.
--   3. Kør DENNE fil.  Fladen smalnet.         Ny klient: virker.
--
-- **Køres filen for tidligt**, går den gamle klient i stykker tre steder på én
-- gang: appen kan ikke hente sin egen profilrække (`select=*`), Admin → Brugere
-- svarer `permission denied`, og enhver konkurrencestilling mister sine navne.
-- Tilbagerulningen står nederst og er tre statements.
--
-- Runbog: [`docs/UDRULNING-A43.md`](../docs/UDRULNING-A43.md).
--
-- ---------------------------------------------------------------------------
-- ⚠️ ADFÆRDSÆNDRING VED KØRSEL: JA, OG DEN ER HELE FORMÅLET
--
--   · `authenticated` kan herefter læse NØJAGTIG tre kolonner i `profiles`:
--     `id`, `display_name` og `anonymized_at`. `is_admin`, `last_seen_at`,
--     `created_at` og `display_name_changed_at` er lukkede — også for en
--     administrator, som i stedet går gennem `admin_profiles()` (#59).
--   · `competition_participants` kan herefter kun læses for de konkurrencer,
--     man selv kan se. Deltagerlisten er ikke længere et opslag, der svarer med
--     hele appens sociale netværk.
--
-- **Får en fremtidig skærm brug for en fjerde kolonne på `profiles`, skal den
-- vælges ind i grant'en her.** Fejlen er tydelig (`permission denied for table
-- profiles`) og er hele pointen — samme regel og samme formulering som
-- UPDATE-grant'en i `#51`.

-- ---------------------------------------------------------------------------
-- 1. `profiles`: kolonne-privilegier frem for hele rækken
-- ---------------------------------------------------------------------------
-- **Rækkerne bliver.** Der røres ikke en policy her, og det er ikke en
-- forglemmelse: `read profiles` skal blive ved med at være
-- `auth.role() = 'authenticated'`, fordi Rating-fanen, Månedsligaen og
-- Championship (`scope = 'ALL'`) viser hver eneste brugers visningsnavn til
-- enhver indlogget — med vilje. En rækkepolicy ville tømme
-- `loadMonthlyBoard`/`loadRoundBoard`/`loadSeasonBoard` og samtidig skjule
-- præcis det felt, produktet selv publicerer.
--
-- **De tre kolonner er ikke et skøn.** `display_name` er navnet i hver stilling.
-- `id` er nøglen, alle opslag joiner på. `anonymized_at` er dét, der filtrerer
-- lukkede konti væk fra de globale lister (`PROFILE_SELECT` i
-- `src/lib/data/standings.js`) — uden den ville en lukket konto stå tilbage på
-- en offentlig rangliste.
--
-- **Det, der lukkes, er det, ingen skærm viser om ANDRE:**
--   · `is_admin`             — peger på, hvilken konto der er værd at angribe.
--   · `last_seen_at`         — adfærdsdata pr. navngiven person.
--   · `created_at`           — do.
--   · `display_name_changed_at` — do.
--
-- `revoke select` fjerner IKKE insert eller update — dem afgør `#51`s
-- kolonne-grant og policies fortsat, og de er uændrede. `service_role` beholder
-- alt: `api/delete-account.js` og de SECURITY DEFINER-funktioner læser
-- `is_admin` og `last_seen_at`, og ingen af de veje går gennem `authenticated`.
--
-- 🔴 **RETURNING ER OGSÅ EN LÆSNING.** PostgREST sender `Prefer:
-- return=representation` på hver skrivning, og uden et `select=` i URL'en
-- returnerer den alle kolonner. Et navneskift og oprettelsen af en profil
-- fejler derfor med `permission denied for table profiles`, hvis klienten ikke
-- er rettet først. Samme mekanik som produktionsfejlen 11. august 2026 (`#55`),
-- bare på privilegier frem for på policies. Efterprøvet mod PostgreSQL 16.13.

revoke select on public.profiles from authenticated;
grant select (id, display_name, anonymized_at) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. 🔴 De tre policies, der LÆSER `is_admin` — og som ellers ville FEJLE
-- ---------------------------------------------------------------------------
-- **Uden dette afsnit brækker afsnit 1 Admin → Drift for alle, også for en
-- administrator.** En RLS-policys udtryk evalueres med den KALDENDE rolles
-- privilegier, og tre policies slår op i `profiles.is_admin`:
--
--   · `job_runs_read_admin`   (SELECT) — hele Admin → Drift
--   · `matches_update_admin`  (UPDATE) — "Hent nu" og syncens rettelser
--   · `matches_insert_admin`  (INSERT) — do.
--
-- Fra det sekund `is_admin` forsvinder fra `authenticated`s læseflade, holder de
-- tre op med at FILTRERE og begynder at FEJLE: `permission denied for table
-- profiles`. Forskellen er hele pointen — en policy, der ikke passer, giver nul
-- rækker; en policy, der ikke kan evalueres, giver `42501`.
--
-- `is_platform_admin()` (#59) er `security definer` og kører som ejer, så
-- kalderens kolonne-privilegier er den uvedkommende. Samme greb og samme
-- begrundelse som `is_group_member` — bare for platformens administrator frem
-- for for ligaens.
--
-- **Adfærdsændring ved kørsel: ingen.** Prædikatet er ordret det samme, kun
-- flyttet ind i en funktion. Fundet af `sql/tests/write_surface.sql`, kørt mod
-- et skema hvor denne fil allerede var kørt — den efterprøvning fra BEGGE sider
-- af dumpet, som `G94` og `G98` gjorde til en regel.

drop policy if exists job_runs_read_admin on public.job_runs;
create policy job_runs_read_admin on public.job_runs
  for select to authenticated
  using (public.is_platform_admin());

drop policy if exists matches_update_admin on public.matches;
create policy matches_update_admin on public.matches
  for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists matches_insert_admin on public.matches;
create policy matches_insert_admin on public.matches
  for insert to authenticated
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 3. `competitions`: samme regel, ét sted
-- ---------------------------------------------------------------------------
-- Policyen er ordret `#53`s — de tre led er uændrede — men prædikatet er flyttet
-- ind i `is_competition_visible()` (#59), som afsnit 4 nedenfor også kalder.
--
-- **Det er ikke pynt.** Uden flytningen ville nøjagtig den samme regel stå to
-- steder: her og i deltagerpolicyen. To kopier af en adgangsregel er ikke
-- uenighed i et svar, men to forskellige svar på "hvem må se den her
-- konkurrence" — og `G99` (12. august 2026) var netop en oprydning efter fem
-- adgangsregler, der havde drevet fra hinanden.
--
-- **Adfærdsændring ved kørsel: ingen.** Prædikatet er identisk, og
-- `sql/tests/read_scope.sql` måler de to op mod hinanden i en matrix, hvor
-- hver af de fire slags brugere prøves mod hver af de tre slags konkurrencer.
--
-- Bemærk, at underforespørgslen på `competition_participants` nu ligger inde i
-- en `security definer`-funktion. **Cyklussen mellem de to tabeller er dermed
-- brudt to gange frem for én** — afsnit 4 bryder den også fra sin side, og
-- hver af de to ville være nok. Det er ikke overflødigt arbejde: den naive
-- form, hvor BEGGE policies skriver deres prædikat inline, svarer
-- `42P17 infinite recursion` — og ikke kun på deltagerlisten, men også på
-- `competitions` selv. Testens afsnit 8b stiller præcis den tilstand op og
-- måler fejlen, så advarslen i `#59` ikke kun er en kommentar.

drop policy if exists competitions_select_involved on public.competitions;
create policy competitions_select_involved on public.competitions
  for select to authenticated
  using (public.is_competition_visible(id));

-- ---------------------------------------------------------------------------
-- 4. `competition_participants`: fra "alle" til "dem, man kan se"
-- ---------------------------------------------------------------------------
-- `read all participation` var `auth.role() = 'authenticated'`, altså hele
-- deltagerlisten for hele appen til enhver med en konto. Den nye regel er:
-- *du kan se en deltager-række, hvis den er din egen, eller hvis du kan se
-- konkurrencen.*
--
-- ⚠️ **`user_id = auth.uid()` er en HURTIG STI og ikke en betingelse — og det
-- er efterprøvet, ikke antaget.** Leddet blev skrevet ind, fordi skrivninger
-- læser deres egen række tilbage (`Prefer: return=representation`), og det
-- lignede fælden fra 11. august 2026 (`#55`). Målingen siger noget andet:
-- fjernes leddet, holder hver eneste påstand i `sql/tests/read_scope.sql`
-- stadig. Grunden er, at INSERT-policyen
-- (`competition_participants_insert_involved`) selv kræver, at man er opretter
-- eller ligamedlem — altså at et af `is_competition_visible()`s to ANDRE led
-- allerede er sandt, før rækken overhovedet må skrives. Der findes dermed ikke
-- en tilmelding, leddet redder.
--
-- **Det bliver stående alligevel, og grunden er prisen og ikke adgangen:**
-- `MainApp.jsx` henter ved hver opstart sine egne deltagelser
-- (`user_id=eq.<mig>`), og uden leddet ville hver af de rækker koste et
-- funktionskald. Det er værd at vide for den, der senere fristes til at fjerne
-- det: regningen er ydelse, ikke en 42501.
--
-- **Liga-admins fjernelse af en ANDEN deltager går derimod gennem funktionen:**
-- `removeParticipant` sletter med `return=representation`, så den slettede
-- række skal kunne læses — og den har `user_id <> auth.uid()`. Det virker,
-- fordi `comp_participants_delete_admin_untipped` kun gælder konkurrencer i en
-- liga, hvor admin pr. definition er medlem. Påstand 7 i testen måler netop
-- den sti, fordi den ellers ville fejle først i produktionen.
--
-- **Prisen, der skal måles:** `loadGroupDetail` (`src/lib/data/groups.js`)
-- henter deltagere for ALLE konkurrencer i alle brugerens ligaer for at kunne
-- vise et deltagerantal på hvert kort — altså ét funktionskald pr. række i den
-- varme sti. Funktionen er `stable` og opslaget er indekseret på primærnøglen,
-- så prisen er lille pr. kald; den skal alligevel aflæses i staging på en liga
-- med rigtige tal, før nogen kalder tallet lille. Det er rækkens ene
-- omkostningsspørgsmål, og det står i `docs/UDRULNING-A43.md` som et trin.

drop policy if exists "read all participation" on public.competition_participants;
drop policy if exists competition_participants_select_visible on public.competition_participants;
create policy competition_participants_select_visible on public.competition_participants
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_competition_visible(competition_id)
  );

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- ⚠️ Blokkene er KOMMENTERET UD, så hele filen kan pastes i ét stykke.
-- En kørbar udgave, der samler dem, står i `docs/UDRULNING-A43.md` trin 8.
--
-- 1) 🔴 Læsefladen på `profiles` er smal. Forvent PRÆCIS tre rækker:
--    anonymized_at, display_name, id.
-- select column_name from information_schema.column_privileges
--  where table_schema = 'public' and table_name = 'profiles'
--    and grantee = 'authenticated' and privilege_type = 'SELECT'
--  order by column_name;

-- 2) …og der er ingen tabel-bred SELECT tilbage. Forvent 'f'.
-- select has_table_privilege('authenticated', 'public.profiles', 'SELECT');

-- 3) De to policies står der, og de gamle er væk. Forvent to rækker.
-- select tablename, policyname from pg_policies
--  where schemaname = 'public'
--    and policyname in ('competitions_select_involved',
--                       'competition_participants_select_visible')
--  order by tablename;

-- 3b) De tre admin-policies læser ikke længere `profiles` direkte. Forvent NUL
--     rækker — ellers fejler Admin → Drift og "Hent nu" med 42501.
-- select tablename, policyname from pg_policies
--  where schemaname = 'public'
--    and (coalesce(qual, '') || coalesce(with_check, '')) like '%profiles%';
-- select tablename, policyname from pg_policies
--  where schemaname = 'public' and policyname = 'read all participation';

-- 4) `read profiles` er URØRT — rækkerne skulle netop blive. Forvent én række.
-- select policyname, qual from pg_policies
--  where schemaname = 'public' and tablename = 'profiles'
--    and policyname = 'read profiles';

-- 5) I APPEN, og det er den, der tæller: log ind, åbn Rating (navnene skal
--    stå), åbn en konkurrence (stillingen skal have navne), skift brugernavn,
--    og åbn Admin → Brugere som administrator.

-- ============================================================================
-- 🔙 TILBAGERULNING — hvis noget ikke virker efter kørslen
-- ============================================================================
-- Gendanner ORDRET, som det stod før. Læsefladen er så bred igen,
-- præcis som den har været hele tiden — det er den rigtige pris at betale for
-- at få appen tilbage med det samme.
--
-- grant select on public.profiles to authenticated;
--
-- drop policy if exists competition_participants_select_visible on public.competition_participants;
-- create policy "read all participation" on public.competition_participants
--   for select using (auth.role() = 'authenticated');
--
-- drop policy if exists job_runs_read_admin on public.job_runs;
-- create policy job_runs_read_admin on public.job_runs
--   for select to authenticated
--   using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin));
--
-- drop policy if exists matches_update_admin on public.matches;
-- create policy matches_update_admin on public.matches
--   for update to authenticated
--   using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
--   with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
--
-- drop policy if exists matches_insert_admin on public.matches;
-- create policy matches_insert_admin on public.matches
--   for insert to authenticated
--   with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
--
-- drop policy if exists competitions_select_involved on public.competitions;
-- create policy competitions_select_involved on public.competitions
--   for select to authenticated
--   using (
--     created_by = auth.uid()
--     or (group_id is not null and public.is_group_member(group_id))
--     or exists (select 1 from public.competition_participants cp
--                 where cp.competition_id = competitions.id and cp.user_id = auth.uid())
--   );
--
-- ⚠️ `grant select on … to authenticated` fjerner IKKE kolonne-grant'en, den
-- lægger den brede rettighed oven på. Det er uskadeligt (den brede vinder), men
-- vil du have skemaet tilbage præcis som før, skal kolonne-posterne fjernes
-- eksplicit: `revoke select (id, display_name, anonymized_at) on public.profiles
-- from authenticated;` FØR den brede `grant`.
