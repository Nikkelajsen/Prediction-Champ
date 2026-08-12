-- Invitationskoden bliver hemmeligheden igen — TRIN 2 af 2 (A40).
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- 🔴 **KØR FØRST, NÅR DEN NYE KLIENT ER UDRULLET OG AFPRØVET.** Denne fil
-- smalner de fire policies, og fra det sekund kan en invitation KUN tages imod
-- gennem `invite_lookup()`/`accept_invite()` fra trin 1. Den gamle klient slår
-- ligaen op med et almindeligt tabelopslag, og det opslag bliver tomt her.
--
-- FORUDSÆTNING: `sql/invite_lookup.sql` (#52) skal være kørt. Policyen på
-- `group_members` kalder `is_group_creator()`, som bor dér — kør denne fil
-- uden den, og `create policy` fejler med `42883: function … does not exist`.
-- Det er med vilje den vej rundt: en fejl ved oprettelsen er bedre end en
-- policy, der refererer til noget, der ikke findes.
--
-- ---------------------------------------------------------------------------
-- RÆKKEFØLGEN, OG HVORFOR DEN IKKE ER "SAMTIDIG"
--
--   1. Kør #52.        Gammel klient: uændret. Ny klient: virker.
--   2. Merge og udrul. Gammel klient væk.      Ny klient: virker.
--   3. Kør DENNE fil.  Hullet lukket.          Ny klient: virker.
--
-- Hvert trin har en tilstand, hvor det, der er i produktion, virker. Det er
-- hele grunden til, at migreringen er delt i to: Supabase køres i hånden og
-- Vercel deployer af sig selv, så "samtidig" er ikke en instruks, et menneske
-- kan følge.
--
-- **Køres denne fil for tidligt**, kan ingen tage imod en invitation, før
-- udrulningen er færdig. Symptomet er "Kunne ikke tilmelde dig ligaen lige nu"
-- eller en bekræftelse, der aldrig kommer. Tilbagerulningen står nederst i
-- filen og er fire `create policy` — den kan køres på et minut.
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

-- ---------------------------------------------------------------------------
-- Policies: fra "alle" til "dem, der er med"
--
-- ⚠️ **HVER policy droppes TO gange, og begge linjer skal blive stående.**
-- Den første dropper det GAMLE navn, fordi filen afløser det. Den anden dropper
-- filens EGET navn, fordi `create policy` fejler med `42710`, hvis navnet
-- allerede findes — og det gør det, så snart filen er kørt én gang.
--
-- Det stod der ikke oprindeligt, og filen var derfor ikke idempotent, selvom
-- både dens eget hoved og `sql/README.md` påstod det. Fundet 12. august 2026,
-- da skema-eksporten skulle køres efter `A40`: en gen-kørsel mod produktionen
-- stoppede på `policy "competitions_select_involved" for table "competitions"
-- already exists`. Kun `groups_select_member` havde sit andet drop, og det kom
-- til ved et tilfælde med `#55`.

-- Ligaen: medlemmer. Punktum.
--
-- ⚠️ **LINJEN HAR VÆRET UDE OG VENDE, OG BEGGE VENDINGER ER VÆRD AT KENDE, FØR
-- DU RØRER DEN.** Fra 11. til 12. august 2026 stod her
-- `or created_by = auth.uid()`, og det led var ikke pynt: uden det kunne INGEN
-- oprette en liga.
--
-- Den oprindelige begrundelse for det ene led var *"opretteren er altid medlem
-- (`createGroup` skriver admin-rækken i samme ombæring), så der er ingen grund
-- til et `or created_by`"*. Den var forkert. "I samme ombæring" er sandt om
-- funktionen og falsk om statementet: `createGroup` lavede TO kald, og ligaen var
-- det første — så når `groups`-rækken blev skrevet, fandtes opretterens
-- medlemsrække ikke endnu.
--
-- Og det gjorde en forskel, netop fordi klienten skriver med
-- `Prefer: return=representation`: PostgREST kører `insert … returning *`, og en
-- RETURNING-klausul betyder, at rækken skal LÆSES tilbage. Denne policy anvendes
-- altså på den nyindsatte række, oven i INSERT-policyen. Svaret var
-- `new row violates row-level security policy for table "groups"`. Samme fælde
-- som den, `is_group_creator()` i #52 findes for — bare ét statement tidligere.
-- Hele forklaringen står i `sql/groups_select_creator.sql` (#55).
--
-- **Leddet er væk igen 12. august 2026 (`G98`, [#58]
-- `sql/groups_select_member_narrow.sql`), og forudsætningen var et DEPLOY og
-- ikke en anden migrering:** `create_group()` (#57) skriver ligaen og
-- opretterens admin-række i ÉN transaktion som ejer, så oprettelsen ikke længere
-- går gennem et `insert … returning`. Prisen, leddet kostede — en opretter, der
-- har forladt sin egen liga, kunne stadig læse den og dens `invite_code` — er
-- dermed betalt tilbage.
--
-- 🔴 **Køres denne fil mod en produktion, hvor klienten IKKE kalder
-- `create_group()`, brydes oprettelsen af enhver liga igen.** Det er samme
-- rækkefølge-krav som filens eget hoved beskriver, bare på en anden linje.
drop policy if exists groups_select_all on public.groups;
drop policy if exists groups_select_member on public.groups;
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
drop policy if exists competitions_select_involved on public.competitions;
create policy competitions_select_involved on public.competitions
  for select to authenticated
  using (
    created_by = auth.uid()
    or (group_id is not null and public.is_group_member(group_id))
    or exists (select 1 from public.competition_participants cp
                where cp.competition_id = competitions.id and cp.user_id = auth.uid())
  );

-- Medlemskabet: kun opretteren skriver sin egen række direkte. Alle andre
-- kommer ind gennem `accept_invite()`.
--
-- Den gamle policy tillod `role = 'member'` i en HVILKEN SOM HELST liga, og det
-- var den halvdel, der gjorde et id nok. Den nye tillader kun opretterens
-- admin-række — præcis det ene tilfælde, hvor der endnu ikke findes en
-- invitation at fremvise, fordi ligaen lige er opstået.
drop policy if exists group_members_insert_self on public.group_members;
drop policy if exists group_members_insert_creator on public.group_members;
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
drop policy if exists competition_participants_insert_involved on public.competition_participants;
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
-- Verifikation — kør efter trin 2
-- ============================================================================
-- ⚠️ Blokkene herunder er KOMMENTERET UD, så hele filen kan pastes i ét
-- stykke. Skal de køres, fjernes `--` først — ellers udføres der ingenting,
-- og editoren svarer "Success. No rows returned", hvilket ligner et svar.
-- En kørbar udgave, der samler dem alle, står i `docs/UDRULNING-A40.md` trin 9.
--
-- 1) De fire nye policies står der. Forvent fire rækker.
-- select tablename, policyname from pg_policies
--  where schemaname = 'public'
--    and policyname in ('groups_select_member', 'competitions_select_involved',
--                       'group_members_insert_creator',
--                       'competition_participants_insert_involved')
--  order by tablename;

-- 2) De gamle er væk. Forvent NUL rækker.
-- select tablename, policyname from pg_policies
--  where schemaname = 'public'
--    and policyname in ('groups_select_all', 'read all competitions',
--                       'group_members_insert_self', 'join competition');

-- 3) Ingen liga er blevet usynlig for sine egne: hver liga har mindst ét
--    medlem. Forvent NUL rækker. (En liga uden medlemmer er tilladt efter en
--    kontolukning — `A36` — men den skal ses her, ikke opdages senere.)
-- select g.id, g.name from public.groups g
--  where not exists (select 1 from public.group_members m where m.group_id = g.id);

-- 4) I APPEN, og det er den, der tæller: åbn et invitationslink til en liga,
--    du ikke er medlem af, med en anden konto. Bekræftelsen skal komme med
--    ligaens navn, og tilmeldingen skal virke.

-- ============================================================================
-- 🔙 TILBAGERULNING — hvis invitationer ikke virker efter kørslen
-- ============================================================================
-- Gendanner de fire policies ORDRET som de stod i `sql/schema.sql` før #53.
-- Hullet er så åbent igen, præcis som det har været hele tiden — det er den
-- rigtige pris at betale for at få join-flowet tilbage med det samme.
--
-- drop policy if exists groups_select_member on public.groups;
-- create policy groups_select_all on public.groups
--   for select to authenticated using (true);
--
-- drop policy if exists competitions_select_involved on public.competitions;
-- create policy "read all competitions" on public.competitions
--   for select using (auth.role() = 'authenticated'::text);
--
-- drop policy if exists group_members_insert_creator on public.group_members;
-- create policy group_members_insert_self on public.group_members
--   for insert to authenticated
--   with check (((user_id = auth.uid()) and ((role = 'member'::text) or (exists (
--     select 1 from public.groups g
--      where ((g.id = group_members.group_id) and (g.created_by = auth.uid())))))));
--
-- drop policy if exists competition_participants_insert_involved on public.competition_participants;
-- create policy "join competition" on public.competition_participants
--   for insert with check ((user_id = auth.uid()));
