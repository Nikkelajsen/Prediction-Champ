-- Ligaens to tal — medlemmer og konkurrencer — tælles i databasen (G106).
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- 📍 `#N` er en migrering: nummeret står i kolonne 1 i filoversigten i
--    `sql/README.md`, hvor filnavnene er links. `#61` =
--    `competition_join_baseline.sql`, denne fil er `#62`.
--
-- ✅ **REN TILFØJELSE — SIKKER AT KØRE NÅR SOM HELST.** Filen tilføjer ét view
-- og dets grants. Ingen tabel, ingen policy, ingen rettighed smalnes, ingen
-- række ændres. Den nuværende klient kender ikke viewet og mærker derfor intet.
--
-- 🔴 **MEN DEN SKAL KØRES FØR FRONTEND-MERGEN**, og det er den eneste
-- rækkefølge-regel i filen: `loadMyGroups()` læser viewet, og et opslag mod et
-- view, der ikke findes, svarer `404` — altså en tom Ligaer-fane og ikke en
-- degraderet en. Modsat `#57`/`#59`, hvor den nye klient ville have virket
-- uanset, er der her en rigtig afhængighed den ene vej.
--
-- ---------------------------------------------------------------------------
-- HVAD DER VAR GALT
--
-- `loadMyGroups()` (`src/lib/data/groups.js`) skrev "N medlemmer · M
-- konkurrencer" på hvert ligakort ved at HENTE rækkerne og tælle listen i
-- browseren:
--
--     db.select(token, "group_members", `group_id=in.(…)&select=group_id`);
--     db.select(token, "competitions",  `group_id=in.(…)&select=id,group_id`);
--
-- PostgREST leverer højst 1000 rækker pr. svar (Supabases `max-rows`) og siger
-- **ikke**, at den klipper — et svar på 1000 rækker er et loft og ikke et
-- facit. En bruger, hvis ligaer tilsammen når loftet, ville derfor se for lave
-- tal uden en fejl noget sted. Præcis den fælde kostede "· 0 kampe" i Opret →
-- Sæson 1. august 2026 (`DOCUMENTATION.md` §13) og blev fejet igen som `G101`
-- 14. august 2026.
--
-- Ufarligt i dag — enogtyve brugere, og tallene skal være i tusinder, før
-- loftet nås. Det, der gør rækken værd at lukke, er ikke tiden, men at fejlen
-- ville være **tavs**: en optælling, der er klippet, ser ud som en optælling.
--
-- ---------------------------------------------------------------------------
-- HVORFOR ET VIEW OG IKKE `db.count()` PR. LIGA
--
-- `G101` løste den samme fælde ét sted længere inde med `db.count()` — ét
-- opslag pr. konkurrence, kørt samtidig. **Den kur kan ikke kopieres hertil**,
-- og det er hele grunden til, at rækken blev åbnet frem for lukket samme dag:
-- `loadGroupDetail` tæller deltagere i ÉN ligas konkurrencer, så fan-out'en er
-- bundet. Her er nævneren brugerens ligaer GANGE TO — ti ligaer bliver tyve
-- rundture, hvor der i dag er to. Fan-out var altså den eneste af de tre veje,
-- der ville gøre noget målbart værre for at rette noget, ingen mærker.
--
-- Den tredje vej — `G35`s synlige loft — blev også valgt fra. Det mønster
-- findes til en LISTE, brugeren kan handle på ("skal du bruge en kamp længere
-- ude i fremtiden, så opret konkurrencen som en hel sæson"). En afkortet
-- OPTÆLLING har ingen handling, kun en undskyldning på et tal.
--
-- Viewet fjerner i stedet selve nævneren: aggregeringen sker i databasen, og
-- svaret er én række pr. liga. Det loft, der er tilbage, er antallet af ligaer
-- — nøjagtig det samme, som `groups`-opslaget lige over allerede er bundet af,
-- og dermed ikke et nyt.
--
-- ---------------------------------------------------------------------------
-- HVORFOR `security_invoker` ER BÆRENDE OG IKKE PYNT
--
-- Et view kører som standard med sin EJERS rettigheder, og et view over
-- `group_members` ville da svare uden om RLS — altså et hul rundt om
-- `group_members_select` for enhver, der kunne læse viewet. Med
-- `security_invoker = on` gælder kalderens egne policies på alle tre tabeller:
--
--   · `groups`             → `is_group_member(id)` (`#58`), så viewet kun har
--                            rækker for de ligaer, kalderen selv er med i.
--   · `group_members`      → `user_id = auth.uid() or is_group_member(group_id)`
--   · `competitions`       → `is_competition_visible(id)` (`#60`), hvis andet
--                            led er `is_group_member(c.group_id)`.
--
-- **Følgen er, at tallene er ORDRET dem, brugeren ser i dag** — samme
-- rækkemængde, bare talt ét sted. Migreringen ændrer altså ikke ét tal på
-- skærmen, og det er meningen: den flytter kun, hvor optællingen sker.
-- Samme form og samme begrundelse som `competition_status` (`#39`/`#41`) og
-- `round_standings` (`#20`).

create or replace view public.group_counts
with (security_invoker = on) as
select
  g.id as group_id,
  (select count(*) from public.group_members m where m.group_id = g.id)::int as member_count,
  (select count(*) from public.competitions  c where c.group_id = g.id)::int as competition_count
from public.groups g;

-- `revoke … from public` FØR `grant`, samme regel som for funktioner (`G96`):
-- `anon` er bevidst ikke med — Ligaer-fanen kræver login, og `anon_grants.sql`
-- (`#34`) fjernede rollens tabel-privilegier med den begrundelse, at bredden er
-- en REGEL og ikke en liste.
--
-- 🔴 **`authenticated` skal OGSÅ revokes først, og det er ikke overflødigt her.**
-- Supabases `alter default privileges` giver `authenticated` ALLE privilegier på
-- hver ny relation i `public` — for de øvrige views er det inert, fordi ingen af
-- dem er auto-opdaterbare, men dette ER: ét `from`, ingen aggregater i
-- rækkekilden, og `group_id` er en simpel kolonnereference. Uden linjen kunne
-- `authenticated` altså skrive i `groups` GENNEM viewet. Det ville ikke være en
-- rettighedseskalering — `security_invoker` lader `groups_update_admin` og
-- `groups_delete_admin_empty` gælde — men det ville være en skriveflade, ingen
-- har bedt om, og præcis den klasse er dét, `sql/tests/write_surface.sql`
-- findes for. Efterprøvet mod PostgreSQL 16.13: `information_schema.views`
-- svarer `is_updatable = YES` for netop dette view og `NO` for alle de andre.
revoke all on public.group_counts from public, anon, authenticated;
grant select on public.group_counts to authenticated, service_role;

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- ⚠️ Blokkene er KOMMENTERET UD, så hele filen kan pastes i ét stykke.
--
-- 1) Viewet findes og er security_invoker. Forvent én række, 't'.
-- select c.relname, 'security_invoker=on' = any(c.reloptions) as invoker
--   from pg_class c
--  where c.relnamespace = 'public'::regnamespace and c.relname = 'group_counts';

-- 2) `anon` kan det ikke. Forvent 'f'.
-- select has_table_privilege('anon', 'public.group_counts', 'SELECT');

-- 3) Tallene er de samme som dem, klienten selv talte. Forvent 0 rækker —
--    kør den UDEN RLS, så den måler viewets aritmetik og ikke synligheden.
-- select v.group_id, v.member_count, v.competition_count
--   from public.group_counts v
--   join (select g.id,
--                (select count(*) from public.group_members m where m.group_id = g.id) as m,
--                (select count(*) from public.competitions  c where c.group_id = g.id) as k
--           from public.groups g) f on f.id = v.group_id
--  where v.member_count <> f.m or v.competition_count <> f.k;

-- 4) Ligaer, hvis medlemsrækker ALENE ville have nærmet sig PostgRESTs loft —
--    altså den fejl, migreringen fjerner muligheden for. Forvent 0 rækker i
--    dag; svarer den med noget, har nogen allerede set for lave tal.
-- select group_id, member_count from public.group_counts where member_count >= 1000;

-- ============================================================================
-- Tilbagerulning
-- ============================================================================
-- Viewet er additivt og har ingen aftagere ud over `loadMyGroups()`. Skal det
-- alligevel væk, skal klienten rulles tilbage FØRST:
-- drop view if exists public.group_counts;
