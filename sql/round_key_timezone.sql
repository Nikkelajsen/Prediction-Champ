-- round_key() aflæser datoen i DANSK tid frem for i sessionens tidszone (G11).
-- Idempotent — kan køres igen når som helst.
--
-- ---------------------------------------------------------------------------
-- Hvad der var galt
--
-- `round_key()` er markeret `IMMUTABLE`, men kroppen brugte `ts::date`, og en
-- cast fra `timestamptz` til `date` afhænger af sessionens `TimeZone`. Den var
-- altså reelt `STABLE`, og markeringen var en påstand, ingen kunne se var
-- forkert: `matches.round_key` er en GENERERET kolonne, og en genereret kolonne
-- *kræver* en immutable funktion, så Postgres tog markeringen for pålydende.
--
-- Følgen er ikke teoretisk. Vercel og Supabase kører UTC, så rundegrænsen har
-- ligget mandag kl. 00:00 UTC = mandag kl. 02.00 dansk (sommertid). En kamp med
-- kickoff mellem midnat og 02.00 dansk tirsdag blev derfor talt med i den
-- FORRIGE runde. Og skrev en writer med en anden sessionszone — en migrering
-- kørt fra en laptop, et script med `set timezone`, et fremtidigt miljø — ville
-- den skrive en anden runde end resten af databasen for de samme kampe.
--
-- `timezone(text, timestamptz)` er selv `IMMUTABLE` (`pg_proc.provolatile = 'i'`,
-- efterprøvet), så den nye krop er ægte immutable. Markeringen er nu sand.
--
-- ---------------------------------------------------------------------------
-- Hvad den gør ved eksisterende rækker
--
-- En `create or replace function` ændrer IKKE lagrede værdier i en genereret
-- kolonne — de blev frosset ved insert. Migreringen flytter derfor selv de
-- rækker, hvis værdi rent faktisk ændrer sig, ved at røre rækken: en `update`
-- genberegner alle lagrede genererede kolonner.
--
-- **`where`-klausulen er hele sikkerheden.** Den rammer kun rækker, hvor den
-- lagrede værdi er uenig med den nye regel — i praksis forventeligt NUL, fordi
-- ingen af de syv turneringer spiller mellem midnat og 02.00 dansk tid. Kør
-- tællingen nedenfor FØR migreringen, hvis du vil vide det på forhånd.
--
-- **Rører den rækker, genberegnes rating og historier af sig selv.** `matches`
-- har statement-level triggere (`sql/rating_trigger_optimization.sql`), som
-- kalder `recompute_ratings()` og `generate_stories()`. Det er netop den
-- genberegning, en flyttet rundegrænse kræver — men det betyder også, at en
-- migrering, der rammer mange rækker, laver rigtigt arbejde. Kør den mellem to
-- runder, ikke midt i en kampdag.

-- Hvor mange rækker ville flytte sig? (kør gerne før og efter — efter skal den
-- give 0, og det er samtidig testen på, at migreringen virkede)
--   select count(*) from public.matches
--    where round_key is distinct from public.round_key(kickoff_at);

CREATE OR REPLACE FUNCTION public.round_key(ts timestamp with time zone) RETURNS date
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  -- G11: datoen aflæses i DANSK tid og ikke i sessionens.
  d date := (ts at time zone 'Europe/Copenhagen')::date;
  dow int := extract(dow from d)::int; -- 0=søn .. 2=tir .. 6=lør
  diff int := (dow - 2 + 7) % 7;
begin
  return d - diff;
end;
$$;

-- Flyt de rækker, den nye regel er uenig med. Ingen kolonne ændres af sig selv;
-- `kickoff_at = kickoff_at` er der udelukkende for at få rækken skrevet, så den
-- genererede kolonne udregnes forfra.
update public.matches
   set kickoff_at = kickoff_at
 where round_key is distinct from public.round_key(kickoff_at);

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- 1) Ingen uenige rækker tilbage. Forvent 0.
-- select count(*) from public.matches
--  where round_key is distinct from public.round_key(kickoff_at);

-- 2) Funktionen er zone-uafhængig. Begge skal give SAMME dato.
-- set timezone = 'UTC';              select public.round_key('2026-08-10T22:30:00Z');
-- set timezone = 'America/New_York'; select public.round_key('2026-08-10T22:30:00Z');
-- reset timezone;

-- 3) Rørte migreringen rækker, har triggeren genberegnet rating og historier.
--    Efterse Championship-fanen og Admin → Drift; tallene skal stå, som de gjorde
--    — flytningen ændrer KUN de kampe, der lå mellem midnat og 02.00 dansk tid.
