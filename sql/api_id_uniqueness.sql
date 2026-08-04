-- Leagly — unique-constraints på leverandør-id'erne (G7)
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- ---------------------------------------------------------------------------
-- Hvad filen gør
--
--   leagues  unique (provider, api_league_id)
--   seasons  unique (league_id, api_season_id)
--   teams    unique (league_id, api_team_id)
--
-- Tre rækker, der før kunne stå to gange, kan det ikke længere. `matches` har
-- haft sin siden begyndelsen (matches_api_fixture_id_unique) — de tre andre
-- havde den aldrig, uden at nogen havde besluttet det.
--
-- ---------------------------------------------------------------------------
-- Hvorfor omfanget er, som det er — og hvorfor ingen af dem er GLOBALE
--
-- G7 var skrevet som "unique på teams.api_team_id, seasons.api_season_id og
-- leagues.api_league_id", altså globalt pr. kolonne. To af de tre ville have
-- fejlet på produktionsdata, og den tredje ville have været forkert:
--
--   · teams   — et hold hører til ÉN turnering i vores skema (teams.league_id),
--               så Arsenal findes som to rækker: én i Premier League og én i
--               Champions League. Begge bærer football-data.orgs `fd:57`.
--               En global unique ville have gjort det umuligt at have en klub
--               i to turneringer, hvilket er hele pointen med Champions League.
--   · seasons — alle fem football-data-turneringer deler `api_season_id`
--               '2026' (sql/tournament_footballdata.sql). Sæson-id'et er dér et
--               ÅRSTAL, ikke et id, så det ER meningen, at det gentages.
--   · leagues — her ville en global unique have virket i dag, men den ville
--               have været strengere end virkeligheden: Sportmonks bruger tal
--               (271, 501), football-data koder (PL, CL). At de to id-rum ikke
--               overlapper, er tilfældigt, ikke garanteret. `provider` er
--               allerede en kolonne på tabellen, så det rigtige omfang koster
--               ingenting.
--
-- ---------------------------------------------------------------------------
-- Hvad filen så IKKE gør — læs dette, før G7 streges ud
--
-- G7's egen begrundelse var: *"en fremtidig fejl i sync-koden, der glemmer
-- præfikset, ville kunne skrive et kollideret id, uden at Postgres protesterer"*.
-- Den halvdel lukkes IKKE her, og det kan den ikke af en unique-constraint:
--
--   · Glemmer syncen `fd:` på et HOLD, skriver den `57` i stedet for `fd:57` —
--     men inde i sin egen turnering, hvor ingen anden række hedder `57`. En
--     unique ser derfor ingenting. (Skaden er til gengæld mild og selvhelende:
--     næste kørsel finder ikke `57`, falder tilbage til navne-opslaget, finder
--     rækken og PATCHer id'et på plads igen.)
--   · Glemmer den præfikset på en KAMP, er der allerede en global unique på
--     matches.api_fixture_id, som fanger det — dén halvdel var lukket, før G7
--     blev skrevet.
--
-- Det, der ville lukke resten, er en kontrol af id'ets FORM mod ligaens
-- `provider`. Den kan ikke skrives som en check-constraint, fordi `provider`
-- bor på en anden tabel end `teams`; den ville kræve en trigger eller en kopi
-- af provider-kolonnen ned på `teams`. Ingen af delene er skrevet her, fordi
-- den fejl, de ville fange, er selvhelende, mens prisen er permanent.
--
-- Det, filen faktisk lukker, er en anden og mere nærværende fejlklasse: to
-- kørsler af samme sync på én gang (cron'en og "Hent nu" i Admin → Kampe)
-- læser begge holdlisten, ser begge det samme hold mangle, og indsætter det
-- begge to. Resultatet er en dublet, som `ambiguousTeamNames()` derefter kan
-- advare om — men først bagefter, og kun i et resumé, nogen skal åbne.
--
-- ---------------------------------------------------------------------------
-- Accepteret pris: den ene af to samtidige kørsler fejler nu
--
-- Efter denne migrering svarer PostgREST 409 på det andet indsæt, og den
-- kørsel fejler i stedet for at skrive dubletten. Det er MENINGEN: en fejlet
-- kørsel står rødt i Admin → Drift og forsvinder ved næste interval, mens en
-- dublet bliver stående, indtil et menneske opdager den.
--
-- api/sync-matches.js er derfor bevidst ikke ændret. Alternativet — at lade
-- indsættet være et upsert med `on_conflict=league_id,api_team_id` — ville
-- have krævet, at migreringen var kørt FØR koden blev deployet, ellers ville
-- PostgREST afvise hver eneste sync (`on_conflict` mod kolonner uden unique er
-- en fejl). Den rækkefølgeafhængighed er dyrere end den fejl, den fjerner.
--
-- ---------------------------------------------------------------------------

-- ---------- 1. Findes der dubletter allerede? ----------
-- Blokken kører FØR de tre alter-sætninger og fejler højlydt med rækkerne
-- skrevet ud, hvis der er noget at rydde op i. Det er med vilje, at den ikke
-- selv rydder op: hvilken af to dublet-rækker der er den rigtige, afhænger af,
-- hvad der peger på dem (matches.home_team_id, seasons → matches), og det er
-- ikke et valg, en migrering skal træffe på egen hånd.
--
-- Uden blokken ville en gen-kørsel mod beskidte data fejle på selve
-- constrainten med Postgres' egen tekst ("could not create unique index …
-- Key (league_id, api_team_id)=(…) is duplicated"), som nævner ét par ad
-- gangen og ingen navne.
do $$
declare
  v_txt text;
begin
  select string_agg(t, e'\n') into v_txt from (
    select format('  leagues: provider=%s api_league_id=%s står %s gange', provider, api_league_id, count(*)) as t
    from public.leagues where api_league_id is not null
    group by provider, api_league_id having count(*) > 1
    union all
    select format('  seasons: league_id=%s api_season_id=%s står %s gange', league_id, api_season_id, count(*))
    from public.seasons where api_season_id is not null
    group by league_id, api_season_id having count(*) > 1
    union all
    select format('  teams: league_id=%s api_team_id=%s står %s gange (%s)', league_id, api_team_id, count(*), string_agg(name, ' / '))
    from public.teams where api_team_id is not null
    group by league_id, api_team_id having count(*) > 1
  ) d;

  if v_txt is not null then
    raise exception e'Der findes allerede dubletter — constrainten kan ikke sættes, før de er ryddet:\n%\n\nRyd op i hånden (se hvad der peger på rækken, før du sletter), og kør filen igen.', v_txt;
  end if;
end $$;

-- ---------- 2. De tre constraints ----------
-- drop + add frem for `if not exists`: en constraint har ikke den form, og
-- mønstret er det samme som leagues_provider_check i sql/multi_provider.sql.
-- NULL tæller som forskellig fra NULL i en unique (standard-opførsel, ikke
-- `nulls not distinct`), så turneringer uden api_league_id — hvis nogen
-- nogensinde oprettes i hånden — er upåvirkede.

alter table public.leagues drop constraint if exists leagues_provider_api_id_unique;
alter table public.leagues
  add constraint leagues_provider_api_id_unique unique (provider, api_league_id);

alter table public.seasons drop constraint if exists seasons_league_api_id_unique;
alter table public.seasons
  add constraint seasons_league_api_id_unique unique (league_id, api_season_id);

alter table public.teams drop constraint if exists teams_league_api_id_unique;
alter table public.teams
  add constraint teams_league_api_id_unique unique (league_id, api_team_id);

-- Bemærk: hver constraint bygger sit eget indeks, og det dækker samtidig de
-- opslag, syncen laver i forvejen (`teams?league_id=eq.…`), fordi league_id
-- står først. Der er derfor intet indeks at fjerne bagefter.

-- ---------------------------------------------------------------------------
-- Verifikation efter kørsel: tre rækker, alle med `u` som type.
select conrelid::regclass as tabel, conname as constraint, contype as type,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where conname in (
  'leagues_provider_api_id_unique',
  'seasons_league_api_id_unique',
  'teams_league_api_id_unique'
)
order by 1;
