-- Flere datakilder: leagues.provider + leagues.live_enabled
-- (spec: docs/features/flere-datakilder-v1.md)
--
-- Idempotent — kan køres igen når som helst (kør med "Run without RLS").
-- Ændrer INGEN eksisterende rækkers adfærd: begge kolonner har en default, der
-- beskriver præcis den verden, der var før migreringen.
--
-- ---------------------------------------------------------------------------
-- Hvorfor
--
-- Sportmonks var ikke et valg, men en antagelse skrevet ind i URL'er og
-- feltnavne i api/sync-matches.js og api/sync-live.js. Det holdt, så længe der
-- var én kilde. Men gratis-planen dér rummer kun fire turneringer (Superliga
-- 271/1659, Scotland Premiership 501/513), og Premier League koster €29/md med
-- Champions League som et add-on til yderligere €29/md (A10, 31. juli 2026).
--
-- football-data.orgs gratis-plan rummer 12 turneringer — heriblandt Premier
-- League, Champions League, Bundesliga, Serie A og Primera División — men ikke
-- Superligaen. De to planer er komplementære, og tilsammen koster de ingenting.
-- Derfor bliver datakilden en egenskab ved LIGAEN.
--
-- ---------------------------------------------------------------------------
-- Hvorfor ikke også en provider-kolonne på matches
--
-- matches er den største tabel i basen, og en kopi af ligaens datakilde dér
-- ville kunne komme i utakt med den. api/sync-live.js finder i stedet
-- leverandøren via season_id → seasons.league_id → leagues.provider; det er to
-- små opslag, og de ligger efter den tidlige retur, så de fleste minutter i
-- døgnet koster de ingenting.
--
-- Kollision mellem leverandørernes id'er løses i stedet med et PRÆFIKS:
-- matches.api_fixture_id (og teams.api_team_id) gemmer football-data.org-id'er
-- som 'fd:537654', mens Sportmonks beholder bare tal. Begge leverandører bruger
-- almindelige heltal, så uden præfikset kunne to forskellige kampe kollidere i
-- den globale unique-constraint matches_api_fixture_id_unique og tavst
-- overskrive hinanden. Sportmonks-id'erne står allerede i tusindvis af rækker og
-- er derfor dem, der IKKE flyttes — præfikset er nyt-leverandør-siden af
-- aftalen. Konventionen ejes af toGlobalId()/fromGlobalId() i api/providers/.
-- ---------------------------------------------------------------------------

alter table public.leagues
  add column if not exists provider text not null default 'sportmonks';

-- live_enabled: må ligaens kampe overhovedet vises som i gang?
--
-- Adskilt fra provider, fordi det ikke er et spørgsmål om HVEM man spørger, men
-- om HVAD abonnementet indeholder. football-data.orgs gratis-plan har forsinket
-- stilling og intet spilleminut, så de fem turneringer nedenfor får kun deres
-- ENDELIGE resultater. Point er upåvirkede — de kommer altid derfra.
--
-- Tegnes deres €12/md-plan med livescores, er hele opgraderingen én sætning:
--    update public.leagues set live_enabled = true where provider = 'footballdata';
-- Ingen kodeændring, ingen deploy.
alter table public.leagues
  add column if not exists live_enabled boolean not null default true;

-- Et ukendt providernavn er en tastefejl, der ellers først ville vise sig som en
-- fejlet sync-kørsel. Listen skal holdes ens med PROVIDERS i api/providers/index.js.
alter table public.leagues drop constraint if exists leagues_provider_check;
alter table public.leagues
  add constraint leagues_provider_check check (provider in ('sportmonks', 'footballdata'));

-- ---------------------------------------------------------------------------
-- Verifikation: alle eksisterende ligaer skal stå som sportmonks med live slået
-- til — altså nøjagtig som før migreringen.
select id, name, api_league_id, provider, live_enabled, is_visible, is_official
from public.leagues
order by name;
