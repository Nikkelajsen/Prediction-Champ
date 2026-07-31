// Registret over datakilder.
//
// Indtil nu var Sportmonks ikke et VALG — leverandøren var skrevet ind i
// URL'er, feltnavne og konstanter i api/sync-matches.js og api/sync-live.js.
// Det holdt, så længe der var én kilde. Sportmonks' gratis-plan rummer
// imidlertid ikke Premier League, Champions League, Bundesliga, Serie A eller
// Primera División, mens football-data.orgs gratis-plan rummer dem alle fem —
// men ikke Superligaen. De to planer er komplementære, og derfor er datakilden
// nu en egenskab ved LIGAEN (leagues.provider), ikke ved koden.
//
// Kontrakten et providermodul skal opfylde:
//
//   key            nøglen i leagues.provider
//   tokenEnv       navnet på miljøvariablen med API-nøglen
//   supportsLive   kan leverandøren overhovedet levere stilling undervejs?
//   toGlobalId(id) leverandørens id → værdien i matches.api_fixture_id
//   fromGlobalId   den modsatte vej
//   resolveSeasonId({ apiLeagueId, seasonName, token })
//   fetchSeasonFixtures({ apiLeagueId, apiSeasonId, token })
//   fetchLive({ providerIds, kickoffs, token })
//
// De to fetch-funktioner returnerer NORMALISEREDE kampe (se normaliseret form
// nederst i sportmonks.js). Alt hvad sync-matches og sync-live rører, er den
// form — de kender ingen leverandørs feltnavne.
import { sportmonks } from "./sportmonks.js";
import { footballdata } from "./footballdata.js";

export const PROVIDERS = {
  [sportmonks.key]: sportmonks,
  [footballdata.key]: footballdata,
};

// Ligaer oprettet før leagues.provider fandtes har ingen værdi i kolonnen.
// Migreringen sætter en default, men koden må ikke afhænge af, at den er kørt.
export const DEFAULT_PROVIDER = sportmonks.key;

export function getProvider(key) {
  const provider = PROVIDERS[key || DEFAULT_PROVIDER];
  if (!provider) {
    throw new Error(
      `Ukendt datakilde '${key}' på ligaen. Kendte datakilder: ${Object.keys(PROVIDERS).join(", ")}.`
    );
  }
  return provider;
}

// Nøglen hentes først når den skal bruges — og fejler tydeligt.
//
// Tidligere krævede begge endpoints SPORTMONKS_TOKEN, før de overhovedet gik i
// gang. Med to leverandører ville det betyde, at en football-data-liga ikke
// kunne synkroniseres uden en Sportmonks-nøgle, den aldrig bruger.
export function providerToken(provider, env = process.env) {
  const token = env[provider.tokenEnv];
  if (!token) {
    throw new Error(
      `Miljøvariablen ${provider.tokenEnv} mangler i Vercel-projektet. Den kræves af datakilden '${provider.key}'.`
    );
  }
  return token;
}

// Hvilken datakilde hører en kamp til? Kampe kender kun deres sæson, så vejen
// går matches.season_id → seasons.league_id → leagues.provider.
//
// Bevidst valg: der er IKKE tilføjet en provider-kolonne på matches. Tabellen
// er den største i basen, kolonnen ville kunne komme i utakt med ligaens, og de
// to opslag her er små nok til at ligge efter sync-lives tidlige retur — altså
// de fleste minutter i døgnet slet ikke.
export function indexSeasons(leagues, seasons) {
  const leagueById = new Map((leagues || []).map((l) => [l.id, l]));
  const bySeasonId = new Map();
  for (const s of seasons || []) {
    const league = leagueById.get(s.league_id);
    if (!league) continue;
    bySeasonId.set(s.id, {
      leagueId: league.id,
      leagueName: league.name,
      provider: league.provider || DEFAULT_PROVIDER,
      // `!== false` og ikke `=== true`: en liga fra før kolonnen fandtes har
      // null, og den skal opføre sig som i dag (live slået til).
      liveEnabled: league.live_enabled !== false,
    });
  }
  return bySeasonId;
}
