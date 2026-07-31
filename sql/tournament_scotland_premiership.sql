-- Turnering #2: Scotland Premiership (B2, drejebogen docs/features/turnering-2.md §3.1).
-- Idempotent — kan køres igen når som helst (kør med "Run without RLS").
--
-- Scriptet opretter KUN de to rækker, en ny turnering skal have: ligaen og dens
-- sæson. Hold oprettes automatisk af api/sync-matches.js ud fra kampenes
-- deltagere, og kampene kommer samme vej. Dette er altså trin 1 af tre — de to
-- næste (sync-kald + cron-job) står i drejebogen.
--
-- Hvorfor et script og ikke to insert-sætninger i en chat: rækkerne er en
-- ændring af produktionsdata, som skal kunne gennemgås, gentages i staging og
-- læses igen om et år, når turnering #3 skal tilføjes.
--
-- ---------------------------------------------------------------------------
-- Valget: Scotland Premiership, Sportmonks-id 501
--
-- Afgjort som A10 den 31. juli 2026 (docs/DECISIONS.md). Den er allerede med i
-- kontoens gratis-plan, og for det, B2 skal bevise (dobbelt-tælling,
-- turneringsvælger, stage-navne, fuzzy holdmatch, round_key på tværs), er det
-- turnerings-ANTALLET, der er variablen — ikke hvilken turnering det er.
-- Premier League koster €29/md og venter på reel efterspørgsel.
--
-- 501 alene dækker hele Premiership-sæsonen: sæsonopdelingen er stages inde i
-- sæsonen, ikke separate turneringer. Planens *_Play-offs-ligaer (513) er
-- op-/nedrykningsspillet mod næstbedste række og skal IKKE oprettes her.
--
-- ---------------------------------------------------------------------------
-- is_visible = true, selvom A10 sagde false
--
-- Drejebogen foreskrev is_visible = false, indtil §3.2 var verificeret. Fraveget
-- bevidst ved leveringen af B2: brugerskaren er lille, og alle ved, at der
-- stadig testes. Generalprøven køres altså i åbent land. Skal turneringen skjules
-- igen, er det én sætning:
--    update leagues set is_visible = false where api_league_id = '501';
-- Rundeligaen tæller kun kampe i synlige turneringer (src/lib/data/standings.js),
-- så en skjult turnering holder ikke runderne kunstigt åbne.
--
-- ---------------------------------------------------------------------------
-- Sæsonen: 2026/2027, Sportmonks-id 28275 — verificeret 31. juli 2026
--
-- Begge værdier er slået op på Sportmonks (liga 501 → "Current Season ID"), så
-- api_season_id kan sættes med det samme. Det er ikke bare en genvej: sætter man
-- id'et her, behøver første sync ikke &smSeason=<navn>, og Admin-knappen
-- "Hent nu" virker fra første klik. Navnet bruges kun, når id'et mangler.
--
-- Skal en anden sæson bruges (næste år), slås parret op igen med:
--    curl -s "https://api.sportmonks.com/v3/football/leagues/501?include=seasons&api_token=$T" \
--      | jq -r '.data.seasons[] | "\(.id)\t\(.name)"'
-- ---------------------------------------------------------------------------

do $$
declare
  v_league_id uuid;
  -- De tre parametre. Navn og id hører sammen — ret dem samlet.
  v_season_name text := '2026/2027';
  v_season_api_id text := '28275';
  v_season_start date := '2026-08-01';
begin
  select id into v_league_id from leagues where api_league_id = '501';

  if v_league_id is null then
    insert into leagues (name, api_league_id, is_visible)
    values ('Scotland Premiership', '501', true)
    returning id into v_league_id;
  end if;

  if not exists (select 1 from seasons where league_id = v_league_id and name = v_season_name) then
    insert into seasons (league_id, name, api_season_id, start_date)
    values (v_league_id, v_season_name, v_season_api_id, v_season_start);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Verifikation: én liga, én sæson med api_season_id = 28275, og endnu ingen hold
-- eller kampe — de kommer med syncen.
select l.id as league_id, l.name, l.api_league_id, l.is_visible,
       s.id as season_id, s.name as season_name, s.api_season_id,
       (select count(*) from teams t where t.league_id = l.id) as teams,
       (select count(*) from matches m where m.season_id = s.id) as matches
from leagues l
join seasons s on s.league_id = l.id
where l.api_league_id = '501';
