-- Turnering #1: Superligaen, Sportmonks-id 271.
-- Idempotent — kan køres igen når som helst (kør med "Run without RLS").
-- FORUDSÆTTER at sql/multi_provider.sql (#22: provider, live_enabled) og
-- sql/tournament_scope.sql (#20: is_official) er kørt først.
--
-- ---------------------------------------------------------------------------
-- Hvorfor filen findes — og hvorfor den kom sidst
--
-- Superligaen blev oprettet i hånden i juli 2026, før der fandtes skabeloner.
-- De seks andre turneringer har hver sin fil (#21, #23, #24), og skemaet har
-- sin (schema.sql) — men schema.sql er skema UDEN rækker, så en database bygget
-- af repoet alene havde alt undtagen turnering nr. 1. Det ramte to veje:
--
--   · staging (docs/STAGING.md trin 3) — den turnering, der bruges mest, var
--     den eneste, der ikke kunne oprettes,
--   · gendannelse (docs/RESTORE.md) — hvis datadumpet en dag ikke kan læses,
--     er repoet det, der er tilbage.
--
-- **I PRODUKTION ER FILEN ET NO-OP.** Rækkerne står der. Den er skrevet til de
-- databaser, hvor de ikke gør.
--
-- ---------------------------------------------------------------------------
-- De to værdier, du selv skal udfylde — og hvorfor de ikke står her
--
-- Ligaen kan skrives ned, fordi 271 er verificeret (kontoens plan, aflæst 31.
-- juli 2026: Superliga 271, Superliga Play-offs 1659, Scotland Premiership 501,
-- Premiership Play-Offs 513). Sæsonen kan den ikke: dens navn og id skifter
-- hvert år, og ingen af delene kunne verificeres, da filen blev skrevet.
--
-- Et gæt ville være dyrere end en tom parameter. Det er præcis G65's erfaring
-- fra tournament_scotland_premiership.sql: en skabelon, der er forkert, ligner
-- det svar, man ledte efter. Derfor står de to som `null`, og blokken nedenfor
-- STOPPER med en læsbar fejl frem for at skrive en halv sæson.
--
-- Hent dem ét af to steder:
--
--   1. Fra produktionen (den nemmeste, og den der er sand):
--
--      select l.name, l.api_league_id, l.provider, l.live_enabled,
--             l.is_visible, l.is_official,
--             s.name as season_name, s.api_season_id, s.start_date
--      from leagues l
--      join seasons s on s.league_id = l.id
--      where l.api_league_id = '271';
--
--   2. Fra Sportmonks, hvis produktionen ikke kan nås:
--
--      curl -s "https://api.sportmonks.com/v3/football/leagues/271?include=seasons&api_token=$T" \
--        | jq -r '.data.seasons[] | "\(.id)\t\(.name)"'
--
-- ---------------------------------------------------------------------------
-- api_season_id må gerne være null — for netop denne turnering
--
-- Cron-job #1 (docs/CRON.md) sender `&smSeason=<navn>`, og api/sync-matches.js
-- slår sæsonen op på NAVN, når id'et mangler. Superligaen har derfor kunnet
-- køre uden id'et, hvor #21 og #23 satte det med det samme.
--
-- Sæt det alligevel, hvis du har det: så virker Admin-knappen "Hent nu" fra
-- første klik, og navnet behøver ikke matche leverandørens tekst NØJAGTIGT.
-- Udelader du det, er navnet den eneste nøgle, og et navn, der er skrevet en
-- smule anderledes, fejler med "sæson ikke fundet" og intet andet spor.
--
-- ---------------------------------------------------------------------------
-- is_official = true — den eneste af de syv
--
-- Superligaen ER Championshippet (DOCUMENTATION.md §5, §12): runde-, måneds- og
-- sæsontitlerne summerer point på tværs af de OFFICIELLE turneringer, og de seks
-- andre er uofficielle med vilje. Værdien her er altså ikke en default, der gik
-- godt — den er selve grunden til, at de andre skabeloner sætter false.
--
-- is_visible følger med af nødvendighed: `leagues_official_implies_visible`
-- afviser en officiel turnering, ingen kan se. Begge sættes derfor i SAMME
-- insert, som i #24 — to adskilte sætninger ville fejle på den første.
--
-- Gen-kørsel sætter kun `provider`, præcis som #21 og #23: is_visible,
-- is_official og live_enabled er manuelle valg og må ikke rulles tilbage af en
-- uskyldig gen-kørsel.
--
-- ---------------------------------------------------------------------------
-- Kørslen er ALT-ELLER-INTET, og det er værd at vide
--
-- Hele blokken er ÉN sætning, så en fejl på sæsonen ruller også ligaen tilbage.
-- Kører du med tomme parametre i en tom database, står du altså ikke med en
-- turnering uden sæson — du står, hvor du begyndte. Efterprøvet 5. august 2026
-- (se CHANGELOG). Det er derfor fejlen er en `raise exception` og ikke en
-- `raise warning`: en advarsel ville have efterladt netop den halve tilstand.
-- ---------------------------------------------------------------------------

do $$
declare
  v_league_id uuid;
  -- ▼▼▼ UDFYLD DISSE FØR KØRSEL I EN TOM DATABASE ▼▼▼
  -- Navnet skal være Sportmonks' eget (fx '2026/2027'), hvis api_season_id er null.
  v_season_name text := null;
  v_season_api_id text := null;    -- valgfri, se blokken ovenfor
  v_season_start date := null;     -- valgfri, kun til visning
  -- ▲▲▲
begin
  select id into v_league_id from leagues where api_league_id = '271' and provider = 'sportmonks';

  if v_league_id is null then
    insert into leagues (name, api_league_id, provider, live_enabled, is_visible, is_official)
    values ('Superligaen', '271', 'sportmonks', true, true, true)
    returning id into v_league_id;
    raise notice 'Superligaen oprettet (%).', v_league_id;
  else
    update leagues set provider = 'sportmonks' where id = v_league_id;
    raise notice 'Superligaen fandtes i forvejen (%) — kun provider sat.', v_league_id;
  end if;

  -- Sæsonen. Findes der ALLEREDE en sæson på ligaen, er filen færdig: den
  -- genskaber turnering nr. 1, den tilføjer ikke næste års sæson. Derfor
  -- spørges der på ligaen og ikke på navnet, som #21 gør — ellers ville en
  -- kørsel med tomme parametre vælte i produktionen, hvor rækken står.
  if exists (select 1 from seasons where league_id = v_league_id) then
    raise notice 'Ligaen har allerede mindst én sæson — intet oprettet.';
    return;
  end if;

  if v_season_name is null then
    raise exception using
      message = 'Sæsonen kan ikke oprettes: v_season_name er ikke udfyldt.',
      hint = 'Hent navn (og gerne api_season_id) med et af de to opslag i filens hoved, og sæt dem i deklarationsblokken.';
  end if;

  insert into seasons (league_id, name, api_season_id, start_date)
  values (v_league_id, v_season_name, v_season_api_id, v_season_start);
  raise notice 'Sæsonen "%" oprettet.', v_season_name;
end $$;

-- ---------------------------------------------------------------------------
-- Verifikation: én liga (officiel, synlig, sportmonks, live), én sæson, og
-- endnu ingen hold eller kampe — de kommer med syncen.
select l.id as league_id, l.name, l.api_league_id, l.provider, l.live_enabled,
       l.is_visible, l.is_official,
       s.id as season_id, s.name as season_name, s.api_season_id, s.start_date,
       (select count(*) from teams t where t.league_id = l.id) as teams,
       (select count(*) from matches m where m.season_id = s.id) as matches
from leagues l
left join seasons s on s.league_id = l.id
where l.api_league_id = '271' and l.provider = 'sportmonks';
