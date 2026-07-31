-- Fem turneringer fra football-data.org: PL, CL, BL1, SA, PD
-- (spec: docs/features/flere-datakilder-v1.md)
--
-- Idempotent — kan køres igen når som helst (kør med "Run without RLS").
-- FORUDSÆTTER at sql/multi_provider.sql er kørt først (kolonnerne provider og
-- live_enabled skal findes).
--
-- Scriptet opretter KUN de rækker, en ny turnering skal have: ligaen og dens
-- sæson. Hold oprettes automatisk af api/sync-matches.js ud fra kampenes
-- deltagere, og kampene kommer samme vej. Samme mønster som
-- tournament_scotland_premiership.sql — se den for den fulde begrundelse for,
-- hvorfor det er et script og ikke fem insert-sætninger i en chat.
--
-- ---------------------------------------------------------------------------
-- api_league_id er en KODE, ikke et tal
--
-- football-data.org identificerer turneringer med korte koder ("PL", "CL").
-- Kolonnen er text og rummer begge dele, så Sportmonks' '271' og '501' står
-- uændret side om side med dem.
--
-- api_season_id er STARTÅRET ('2026'), som er det, `?season=` forventer. Sat med
-- det samme, præcis som for Scotland Premiership: så behøver første sync ikke
-- &smSeason=<navn>, og Admin-knappen "Hent nu" virker fra første klik.
--
-- ---------------------------------------------------------------------------
-- live_enabled = false på alle fem
--
-- Gratis-planen har forsinkede resultater og ingen livescore. Kampene får derfor
-- kun deres ENDELIGE resultater — Hjem-skærmens live-kort tikker ikke for dem.
-- Point er upåvirkede: de kommer altid fra det endelige resultat. Tegnes
-- €12/md-planen med livescores, er opgraderingen én update (se multi_provider.sql).
--
-- ---------------------------------------------------------------------------
-- is_official = false og is_visible = false på alle fem
--
-- is_official: Championship summerer point på tværs af alle OFFICIELLE
-- turneringer (DOCUMENTATION.md §12). Fem nye turneringer ville altså ændre,
-- hvad en titel betyder, i samme sekund de blev tændt. Forfremmelse er et
-- selvstændigt valg, ikke en fodnote til en migrering.
--
-- is_visible: turneringerne skal verificeres først — især hold-dubletter, som
-- den fuzzy holdmatch i api/sync-matches.js aldrig er afprøvet på engelske,
-- tyske, italienske eller spanske navne. Når verifikationen er grøn:
--    update public.leagues set is_visible = true where provider = 'footballdata';
-- (Bemærk: is_official ⇒ is_visible er en constraint fra tournament_scope.sql,
-- så rækkefølgen er altid synlig FØR officiel — aldrig omvendt.)
--
-- ---------------------------------------------------------------------------
-- Champions League er anderledes end de fire andre
--
-- Kampene i knockout-fasen findes i kampprogrammet, FØR lodtrækningen er
-- foretaget, og har da ingen hold. api/sync-matches.js springer dem over og
-- tæller dem i `undrawn` i kørslens svar — de kommer med ved næste kørsel efter
-- lodtrækningen. Står `undrawn` stille hen over en lodtrækning, henter syncen
-- ikke de nye kampe.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_league_id uuid;
  -- Sæsonen. Navn og år hører sammen — ret dem samlet ved sæsonskift.
  v_season_name text := '2026/2027';
  v_season_api_id text := '2026';
begin
  for r in
    select * from (values
      ('Premier League',   'PL',  date '2026-08-01'),
      ('Champions League', 'CL',  date '2026-09-01'),
      ('Bundesliga',       'BL1', date '2026-08-01'),
      ('Serie A',          'SA',  date '2026-08-01'),
      ('Primera División', 'PD',  date '2026-08-01')
    ) as t(name, code, season_start)
  loop
    select id into v_league_id from public.leagues where api_league_id = r.code;

    if v_league_id is null then
      insert into public.leagues (name, api_league_id, provider, live_enabled, is_visible, is_official)
      values (r.name, r.code, 'footballdata', false, false, false)
      returning id into v_league_id;
    else
      -- Gen-kørsel: sæt kun det, migreringen ejer. is_visible og is_official
      -- røres IKKE, så en turnering, der er tændt eller forfremmet manuelt,
      -- ikke bliver slukket igen af en uskyldig gen-kørsel.
      update public.leagues
         set provider = 'footballdata'
       where id = v_league_id;
    end if;

    if not exists (
      select 1 from public.seasons where league_id = v_league_id and name = v_season_name
    ) then
      insert into public.seasons (league_id, name, api_season_id, start_date)
      values (v_league_id, v_season_name, v_season_api_id, r.season_start);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Verifikation: fem ligaer, hver med én sæson med api_season_id = 2026, og
-- endnu ingen hold eller kampe — de kommer med syncen.
select l.name, l.api_league_id, l.provider, l.live_enabled, l.is_visible, l.is_official,
       s.name as season_name, s.api_season_id,
       (select count(*) from public.teams t where t.league_id = l.id) as teams,
       (select count(*) from public.matches m where m.season_id = s.id) as matches
from public.leagues l
join public.seasons s on s.league_id = l.id
where l.provider = 'footballdata'
order by l.name;
