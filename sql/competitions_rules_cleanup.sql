-- Fjern den døde nøgle `openDaysBefore` fra competitions.rules (G3).
--
-- HVORFOR
-- `rules` er historisk konfigurerbart og har aldrig været det i praksis:
-- `pc_points()` hardkoder 3/1 (F2, juli 2026), og alle stillinger regner altid
-- 3-1-0. Den ENESTE variation, der nogensinde blev skrevet i feltet, var det
-- rullende gætte-vindue `openDaysBefore` — og det blev fjernet igen med B1
-- (august 2026). Nøglen blev stående i de rækker, der havde den.
--
-- Frontenden holdt op med at læse `rules` overhovedet med G3 (august 2026), så
-- nøglen er ikke længere farlig — den er misvisende. En jsonb med et
-- `openDaysBefore: 7` i beskriver en konkurrence, hvis kampe åbner syv dage
-- før runden, og den regel findes ikke længere nogen steder. Den næste, der
-- åbner tabellen, skal ikke bruge et kvarter på at finde ud af det.
--
-- STATUS
-- **Denne migrering haster ikke og ændrer intet, en bruger kan se.** Den er den
-- eneste i mappen, hvor det ikke gør nogen forskel, om den køres før eller
-- efter en merge — eller aldrig. Køres den ikke, står den døde nøgle bare
-- videre i de gamle rækker.
--
-- Idempotent: anden kørsel rammer nul rækker, fordi `where`-klausulen kun
-- finder rækker, der stadig HAR nøglen.

-- Hvor mange rækker bærer den? (kør gerne før og efter)
--   select count(*) from public.competitions where rules ? 'openDaysBefore';

update public.competitions
   set rules = rules - 'openDaysBefore'
 where rules ? 'openDaysBefore';

-- Efterlader `rules` som `{"exact": 3, "outcome": 1}` — identisk med kolonnens
-- default, som nye rækker nu får af databasen selv (klienten holdt op med at
-- sende feltet med G3).
--
-- Kolonnen er BEVIDST ikke droppet her. Den har ganske vist ingen læsere
-- tilbage — hverken i klienten eller i SQL — men et `drop column` er
-- uigenkaldeligt, og spørgsmålet om, hvorvidt pointene nogensinde skal kunne
-- variere pr. konkurrence, er et produktspørgsmål og ikke en oprydning.
-- Noteret i backloggens indbakke.
