-- Stage pr. kamp (grundspil / mesterskabsspil / nedrykningsspil / playoff).
-- Idempotent — kan køres igen når som helst (kør med "Run without RLS").
--
-- Sportmonks modellerer den danske Superliga som ÉN sæson med flere stages
-- (Regular Season, Championship Round, Relegation Round, Conference League
-- Play-offs – Final). Sync-funktionen (api/sync-matches.js) henter nu `stage`
-- med og gemmer stage-navnet rå (engelsk) her; frontenden oversætter til dansk.
--
-- Bruges til at scope en konkurrence til bestemte stages ved oprettelse
-- (CreateCompetitionScreen) og til at vise stage-badges i tip-visningen.

alter table matches add column if not exists stage_name text;

-- ---------------------------------------------------------------------------
-- Oprydning: fjern den forkerte, skjulte "Superliga Playoff"-liga.
--
-- Den byggede på en fejlantagelse om, at playoff'et var en separat liga. I
-- virkeligheden er playoff'et stages i hovedsæsonen og synkroniseres automatisk
-- med den. Kør nedenstående MANUELT efter at have bekræftet, at ligaen er tom.
--
-- 1) Find ligaen og tjek at den ingen sæsoner/kampe har:
--    select l.id, l.name,
--           (select count(*) from seasons s where s.league_id = l.id) as seasons,
--           (select count(*) from matches m
--              join seasons s on s.id = m.season_id where s.league_id = l.id) as matches
--    from leagues l where l.name ilike '%playoff%';
--
-- 2) Slet KUN hvis seasons = 0 og matches = 0 (indsæt id fra trin 1):
--    delete from leagues where id = '<playoff-league-id>';
