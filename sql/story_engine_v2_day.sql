-- Story Engine v2, trin 1 af 2 — DEN DANSKE DAG som kolonne på matches.
-- Idempotent, men se advarslen om kørselstidspunkt nedenfor.
--
-- KØR DENNE FØR sql/story_engine_v2.sql. Den anden fil bygger
-- generate_daily_stories() oven på match_day, og fejler uden den.
--
-- ---------------------------------------------------------------------------
-- Hvorfor
--
-- Story Engine v1 kendte kun ét tidsbegreb: runden (tirsdag→mandag), som bor i
-- den genererede kolonne matches.round_key. v2 fortæller også historier, når
-- dagens sidste kamp er færdigspillet, og "dagen" er den DANSKE kalenderdag —
-- ikke sessionens, ikke UTC's. En kamp med kickoff mandag 22.30 dansk tid er
-- mandagens kamp, uanset hvilken zone den, der spørger, sidder i.
--
-- ---------------------------------------------------------------------------
-- Hvorfor det må være en genereret kolonne (og hvorfor det er lovligt)
--
-- Dagen skal kunne indekseres og filtreres på, og den skal være den samme for
-- alle læsere. En genereret kolonne KRÆVER en immutable funktion, og den
-- historie har repoet været igennem før: G11 (sql/round_key_timezone.sql).
--
-- Konklusionen dér gælder her: `timezone(text, timestamptz)` — som `x at time
-- zone 'Europe/Copenhagen'` parser til — er selv IMMUTABLE
-- (`pg_proc.provolatile = 'i'`, efterprøvet). Det, der var STABLE og udgjorde
-- G11's fejl, er CASTEN `timestamptz::date`, fordi den læser sessionens
-- TimeZone. Kroppen nedenfor kaster fra `timestamp` (ikke `timestamptz`) til
-- `date`, og `timestamp_date` er immutable. Markeringen er altså sand.
--
-- ---------------------------------------------------------------------------
-- KØR MELLEM TO RUNDER, ikke midt i en kampdag
--
-- `ADD COLUMN ... GENERATED ... STORED` omskriver hele tabellen under en
-- ACCESS EXCLUSIVE-lås. På matches er det et sekund eller to. Tabel-
-- omskrivninger udløser IKKE triggere, så rating og historier genberegnes
-- ikke af denne migrering — men låsen blokerer sync-jobbene imens.

-- ======================= 1. Den danske dag =======================
-- Samme form som public.round_key(): den danske dato bor ÉT sted, så den ikke
-- ender skrevet ud i hånden fem steder (den fejl kostede allerede én migrering,
-- sql/matches_kickoff_tbd.sql).
create or replace function public.match_day(ts timestamp with time zone)
returns date
language sql
immutable
as $$
  -- G11-reglen: `timezone(text, timestamptz)` er IMMUTABLE; det er casten
  -- timestamptz::date, der er STABLE. Derfor `at time zone` FØR castet.
  select (ts at time zone 'Europe/Copenhagen')::date;
$$;

grant execute on function public.match_day(timestamp with time zone)
  to anon, authenticated, service_role;

alter table public.matches
  add column if not exists match_day date
    generated always as (public.match_day(kickoff_at)) stored;

create index if not exists matches_match_day_idx
  on public.matches (match_day);

-- Partielt: "mangler dagen et resultat?" er det opslag, der køres oftest, og
-- det skal kun se de få uspillede rækker — ikke hele kamphistorikken.
create index if not exists matches_match_day_open_idx
  on public.matches (match_day)
  where home_score is null or away_score is null;

-- ======================= 2. Er dagen færdig? =======================
-- Dagen er færdig, når INGEN kamp med den danske dato mangler et resultat — og
-- der findes mindst én kamp. Ingen kampe ⇒ ingen kort (spec'en: "Ingen stories
-- hvis der ikke er nogen kampe").
--
-- AFGRÆNSNINGEN ER GLOBAL, og det er et bevidst valg med en kendt pris: én
-- afbrudt eller annulleret kamp i en hvilken som helst liga blokerer dagen for
-- evigt. Alternativet — kun kampe, der indgår i en konkurrence eller en
-- officiel turnering — er mere korrekt, men gør prædikatet til noget, man ikke
-- kan læse sig til. I stedet holdes prædikatet dumt og læsbart, og nødudgangen
-- ligger i generate_stories_catchup() (sql/story_engine_v2.sql), som efter to
-- døgn genererer dagen alligevel.
create or replace function public.match_day_complete(p_day date)
returns boolean
language sql
stable
as $$
  select exists (select 1 from public.matches where match_day = p_day)
     and not exists (
       select 1 from public.matches
       where match_day = p_day and (home_score is null or away_score is null)
     );
$$;

grant execute on function public.match_day_complete(date)
  to authenticated, service_role;

-- ======================= 3. Fra dag til runde =======================
-- SKRIV ALDRIG public.round_key(p_day::timestamptz). `date → timestamptz`
-- bruger sessionens TimeZone og er STABLE — det ville genindføre G11 ad
-- bagvejen, og denne gang i en funktion, ingen har mistanke til.
--
-- p_day ER allerede den danske dag, så der er ingen zone at tage hensyn til.
-- Aritmetikken er identisk med round_key()'s: rul tilbage til rundens tirsdag.
create or replace function public.round_key_of_date(d date)
returns date
language sql
immutable
as $$
  select d - ((extract(dow from d)::int - 2 + 7) % 7);
$$;

grant execute on function public.round_key_of_date(date)
  to anon, authenticated, service_role;

-- ======================= 4. Fælles faktakilde =======================
-- Point pr. kamp pr. konkurrence — grundlaget for BEGGE historie-motorer.
--
-- Hvorfor et view og ikke to ens CTE'er: generate_stories() byggede dette
-- udtryk inline i _se_rp, og generate_daily_stories() har brug for præcis samme
-- faktum skåret pr. dag i stedet for pr. runde. Skrevet to steder driver de fra
-- hinanden — og det er ikke en hypotetisk bekymring i dette repo: lås-udtrykket
-- stod i fem kopier (sql/matches_kickoff_tbd.sql), og tiebreaker-stigen har
-- allerede krævet en oprydning (sql/standings_tiebreakers.sql →
-- sql/tournament_scope.sql).
--
-- DELTAGER-AFGRÆNSNINGEN ER IKKE VALGFRI (story-engine-v1 §11). `predictions` er
-- global pr. (bruger, kamp) og ved intet om konkurrencer. Uden joinet til
-- competition_participants tælles enhver, der har tippet den SAMME kamp i en
-- ANDEN konkurrence, med her — og to konkurrencer på samme turnering deler alle
-- deres kampe, så det er reglen, ikke undtagelsen. Følgen var "nr. 9 af 8" og
-- historier, der nævnte fremmede ved navn.
--
-- security_invoker = on: viewet må ikke blive et hul rundt om predictions' RLS.
-- Begge motorer er security definer og læser igennem det uanset.
create or replace view public.competition_match_points
with (security_invoker = on) as
select cm.competition_id,
       pr.user_id,
       m.id        as match_id,
       m.round_key,                    -- date
       m.match_day,                    -- date
       public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) as pts,
       abs(pr.pred_home - m.home_score) + abs(pr.pred_away - m.away_score)      as goal_err
from public.competition_matches cm
join public.matches m on m.id = cm.match_id
join public.predictions pr on pr.match_id = m.id
join public.competition_participants cp
  on cp.competition_id = cm.competition_id and cp.user_id = pr.user_id
where m.home_score is not null and m.away_score is not null
  and pr.pred_home is not null and pr.pred_away is not null;

grant select on public.competition_match_points to authenticated, service_role;

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- 1) Kolonnen er enig med funktionen. Forvent 0.
--    Bemærk: `create or replace function public.match_day(...)` genberegner
--    IKKE lagrede værdier (samme fælde som G11). Ændres zonen nogensinde, skal
--    rækkerne røres:
--      update public.matches set kickoff_at = kickoff_at
--       where match_day is distinct from public.match_day(kickoff_at);
-- select count(*) from public.matches
--  where match_day is distinct from public.match_day(kickoff_at);

-- 2) Funktionen er zone-uafhængig. Begge skal give 2026-08-10 (dansk mandag
--    22.30 er mandag, selvom UTC allerede siger 20.30 samme dag).
-- set timezone = 'UTC';              select public.match_day('2026-08-10T20:30:00Z');
-- set timezone = 'America/New_York'; select public.match_day('2026-08-10T20:30:00Z');
-- reset timezone;

-- 3) Dagen og runden hænger sammen: enhver kamps match_day skal ligge i dens
--    egen runde. Forvent 0.
-- select count(*) from public.matches
--  where round_key is distinct from public.round_key_of_date(match_day);

-- 4) En dag uden kampe er ikke "færdig". Forvent false.
-- select public.match_day_complete('1999-01-01'::date);
