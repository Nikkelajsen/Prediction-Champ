-- Konkurrencen, opretteren som deltager og kampene bliver ÉN skrivning (G133).
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- 📍 `#N` er en migrering: nummeret står i kolonne 1 i filoversigten i
--    `sql/README.md`, hvor filnavnene er links. `#57` = `create_group.sql`,
--    denne fil er `#73`.
--
-- ✅ **REN TILFØJELSE — SIKKER AT KØRE NÅR SOM HELST, OGSÅ FØR FRONTEND-MERGEN.**
-- Filen tilføjer én funktion og dens grants. Ingen policy røres, ingen rettighed
-- smalnes, ingen række ændres. Den nuværende klient kalder ikke funktionen og
-- mærker derfor intet; den nye ville allerede virke. Samme form og samme
-- begrundelse som `#57`.
--
-- 🔴 **MEN RÆKKEFØLGEN ER BINDENDE DEN ANDEN VEJ:** den nye klient kalder KUN
-- denne funktion. Udrulles klienten, før filen er kørt, kan INGEN oprette en
-- konkurrence — kaldet svarer 404. Kør filen først (den er ufarlig), merge så.
--
-- ---------------------------------------------------------------------------
-- HVAD DER VAR GALT — OG HVOR GALT DET VAR
--
-- `createCompetition()` (`src/lib/data/competitions.js`) skrev konkurrencen,
-- opretterens deltagerrække og kampene som TRE adskilte PostgREST-kald:
--
--     const [competition] = await db.insert(token, "competitions", [...]);
--     await db.insert(token, "competition_participants", [...]);
--     await db.insert(token, "competition_matches", [...]);
--
-- Tre kald er tre transaktioner. Fejler nummer to eller tre — netværk, RLS, en
-- lukket fane — står der en konkurrence uden deltager eller uden kampe, og den
-- retter sig aldrig selv: klienten viser den, stillingen er tom, og ingen
-- kontrol leder efter den. Præcis samme klasse som `G95`s forældreløse liga,
-- bare med to vinduer i stedet for ét.
--
-- **Lunten er kort, men den findes:** `G130` (17. august 2026) fik hvert eneste
-- forsøg til at fejle på skrivning ÉT, hvor intet efterlades — havde fejlen
-- ligget ét kald senere, ville hver bruger have efterladt en halv konkurrence i
-- de fem dage, fejlen stod på.
--
-- ---------------------------------------------------------------------------
-- HVAD DER BLIVER I KLIENTEN, OG HVORFOR
--
-- Funktionen tager de FÆRDIGE værdier — navn, liga, mode, `mode_params` og
-- kamplisten — og udfører kun skrivningen. Udvælgelsen af kampe (filterTippable,
-- startrunde-valget, hold- og periodefiltrene) bliver i klienten: den er
-- forskellig pr. mode, læser kun offentligt læsbare tabeller og er dækket af
-- klientens egne tests. At flytte den ind i funktionen ville være at flytte
-- fem modes' forretningslogik for at lukke et vindue, der kun sidder i
-- skrivningen. Reglen "en NY konkurrence skal høre til en liga" bliver også i
-- klienten (den kan ikke være `not null` i basen: `on delete set null` gør
-- gamle rækker liga-løse — se kommentaren i `createCompetition()`).
--
-- ---------------------------------------------------------------------------
-- SIKKERHEDEN: HVAD `SECURITY DEFINER` SKAL BÆRE SELV
--
-- Funktionen skriver som ejer og forbigår dermed de tre insert-policies, den
-- afløser. Deres regler er derfor skrevet ind i kroppen frem for at hvile på
-- RLS:
--
--   · `create competitions`                     → `created_by` sættes til
--     (`created_by = auth.uid()`)                 `auth.uid()` og kan ikke
--                                                 sendes med udefra.
--   · `competition_participants_insert_involved`→ deltagerrækken er kalderens
--                                                 egen, på den konkurrence
--                                                 kaldet lige har oprettet.
--   · `creator inserts competition_matches`     → kampene peger på samme
--                                                 konkurrence, og dens
--                                                 `created_by` ER kalderen.
--
-- **Der er ingen bruger-parameter, og det er en sikkerhedsegenskab og ikke en
-- forglemmelse** — samme argument som `create_group()` (`#57`) og
-- `anonymize_my_account()` (`#31`): der findes ikke et id at forfalske.
--
-- Kamplisten valideres ikke ud over fremmednøglen: den gamle policy lod
-- opretteren skrive ENHVER kamp ind i sin egen konkurrence, og funktionen
-- hverken udvider eller smalner det. Et opdigtet kamp-id fælder hele kaldet på
-- `competition_matches_match_id_fkey` — og ruller de to andre skrivninger med,
-- hvilket er hele pointen.
--
-- `mode`-reglen bliver stående i tabellens check-constraint
-- (`competitions_mode_check`) — en kopi i funktionen ville være et andet sted,
-- den kunne drive fra.

create or replace function public.create_competition(
  p_name        text,
  p_group_id    uuid,
  p_mode        text,
  p_league_id   uuid    default null,
  p_season_id   uuid    default null,
  p_mode_params jsonb   default '{}'::jsonb,
  p_match_ids   uuid[]  default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid  uuid := auth.uid();
  v_comp public.competitions%rowtype;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- De tre skrivninger, der før var tre kald. Rækkefølgen er uændret og stadig
  -- bindende — deltager- og kamprækkerne har fremmednøgler til konkurrencen —
  -- men den er nu ligegyldig for udfaldet: fejler én, ruller de andre med.
  insert into public.competitions (name, group_id, league_id, season_id, mode, mode_params, created_by)
  values (p_name, p_group_id, p_league_id, p_season_id, p_mode, coalesce(p_mode_params, '{}'::jsonb), v_uid)
  returning * into v_comp;

  insert into public.competition_participants (competition_id, user_id)
  values (v_comp.id, v_uid);

  insert into public.competition_matches (competition_id, match_id)
  select v_comp.id, m from unnest(p_match_ids) as m;

  -- Hele rækken retur, `invite_code` inklusive — modtageren er opretteren, og
  -- koden er dét, hun skal invitere med. `to_jsonb` frem for en håndskrevet
  -- nøgleliste, så en ny kolonne følger med af sig selv: klienten fik før hele
  -- rækken fra PostgREST (`Prefer: return=representation`) og skal have præcis
  -- det samme.
  return to_jsonb(v_comp);
end;
$$;

-- `revoke … from public` FØR `grant` — PostgreSQLs indbyggede default giver
-- PUBLIC (og dermed `anon`) EXECUTE på hver ny funktion, og den default kan
-- ikke lukkes med `ALTER DEFAULT PRIVILEGES` (se `sql/anon_grants_functions.sql`,
-- `G96`). `anon` nævnes eksplicit, så filen er uafhængig af, om `G96` er kørt
-- før eller efter denne.
revoke all on function public.create_competition(text, uuid, text, uuid, uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.create_competition(text, uuid, text, uuid, uuid, jsonb, uuid[]) to authenticated, service_role;

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- ⚠️ Blokkene er KOMMENTERET UD, så hele filen kan pastes i ét stykke.
--
-- 1) Funktionen findes og er security definer. Forvent én række, 't'.
-- select proname, prosecdef from pg_proc
--  where pronamespace = 'public'::regnamespace and proname = 'create_competition';

-- 2) `anon` kan den ikke. Forvent 'f'.
-- select has_function_privilege('anon',
--   'public.create_competition(text, uuid, text, uuid, uuid, jsonb, uuid[])', 'EXECUTE');

-- 3) Ingen halv konkurrence i produktion — hverken uden deltager eller uden
--    kampe. Kamp-halvdelen kan have LOVLIGE nul-rækker (en sæson, der var
--    spillet færdig ved oprettelsen), så den liste skal LÆSES, ikke tælles.
-- select c.id, c.name, c.created_at,
--        not exists (select 1 from public.competition_participants p where p.competition_id = c.id) as uden_deltager,
--        not exists (select 1 from public.competition_matches m where m.competition_id = c.id)     as uden_kampe
--   from public.competitions c
--  where not exists (select 1 from public.competition_participants p where p.competition_id = c.id)
--     or not exists (select 1 from public.competition_matches m where m.competition_id = c.id);

-- 4) Selve kaldet kræver en session (`auth.uid()` er null i SQL-editoren) og
--    kan derfor ikke afprøves her — opret en konkurrence i appen efter deployet.

-- ============================================================================
-- Tilbagerulning
-- ============================================================================
-- Funktionen er additiv, og de tre insert-policies står urørte, så den GAMLE
-- klient virker uden den. Men den NYE klient kalder kun funktionen — fjern den
-- ikke, mens et deploy med den nye `createCompetition()` er i luften:
-- drop function if exists public.create_competition(text, uuid, text, uuid, uuid, jsonb, uuid[]);
-- revoke'en behøver ingen makker her: funktionen er væk, og grants dør med den.
