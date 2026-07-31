-- Forfremmelse: de fem football-data.org-turneringer bliver synlige OG officielle
-- (beslutning A19, 31. juli 2026 — se docs/DECISIONS.md)
--
-- Idempotent — kan køres igen når som helst (kør med "Run without RLS").
-- FORUDSÆTTER at sql/multi_provider.sql og sql/tournament_footballdata.sql er kørt.
--
-- ---------------------------------------------------------------------------
-- Hvorfor et selvstændigt script
--
-- tournament_footballdata.sql opretter turneringerne slukkede og rører bevidst
-- ALDRIG is_visible/is_official ved en gen-kørsel — netop for at en uskyldig
-- gen-kørsel ikke kan slukke noget, der er tændt. Forfremmelsen skal derfor
-- være sin egen sætning, og den er sit eget valg: den ændrer, hvad en titel
-- betyder, og hører hjemme i beslutningsloggen.
--
-- ---------------------------------------------------------------------------
-- Rækkefølgen i den ene update er ikke til forhandling
--
-- tournament_scope.sql har check-constrainten `leagues_official_implies_visible`
-- (not is_official or is_visible): en officiel turnering, ingen kan se, ville
-- afgøre titler ud fra kampe, brugerne ikke kan tippe. Sættes is_official = true
-- i én sætning og is_visible = true i en anden, fejler den første. Derfor sættes
-- begge i SAMME update.
--
-- ---------------------------------------------------------------------------
-- Hvad forfremmelsen faktisk ændrer
--
-- is_official styrer to ting: Championship (runde-/måneds-/sæsonkåringerne, som
-- summerer point på tværs af officielle turneringer — DOCUMENTATION.md §12) og
-- ratingen (recompute_ratings() joiner leagues og tæller kun officielle — A17).
--
-- Begge regner ud fra TIPS, ikke ud fra kampe. De fem turneringer har endnu
-- ingen konkurrencer og dermed ingen tips, så forfremmelsen flytter ingen
-- eksisterende tal — den ændrer, hvad der tælles fra og med den første
-- konkurrence, nogen opretter i dem. Derfor er nu det billigste tidspunkt.
--
-- ---------------------------------------------------------------------------
-- Scotland Premiership forbliver uofficiel — indtil videre
--
-- Bevidst udeladt her: den nuværende spillerunde er i gang, og en forfremmelse
-- midt i den ville ændre kåringen af en runde, folk allerede har tippet.
-- Når runden er slut, er det én sætning:
--    update public.leagues set is_official = true where api_league_id = '501';
-- Den hører også til i DECISIONS.md, når den køres.
-- ---------------------------------------------------------------------------

update public.leagues
   set is_visible = true,
       is_official = true
 where provider = 'footballdata';

-- ---------------------------------------------------------------------------
-- Verifikation. Forventet efter kørslen:
--   Superliga            sportmonks    synlig, officiel
--   Premier League       footballdata  synlig, officiel
--   Champions League     footballdata  synlig, officiel
--   Bundesliga           footballdata  synlig, officiel
--   Serie A              footballdata  synlig, officiel
--   Primera División     footballdata  synlig, officiel
--   Scotland Premiership sportmonks    synlig, IKKE officiel   ← den ene undtagelse
select l.name, l.provider, l.is_visible, l.is_official, l.live_enabled,
       (select count(*) from public.teams t where t.league_id = l.id) as teams,
       (select count(*) from public.matches m
          join public.seasons s on s.id = m.season_id
         where s.league_id = l.id) as matches
from public.leagues l
order by l.is_official desc, l.name;
