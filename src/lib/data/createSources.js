// De fire opslag, opret-flowet lever af: nyeste sæson pr. turnering,
// kampantallet pr. turnering, holdene og puljen af kommende kampe.
//
// ---------------------------------------------------------------------------
// Hvorfor de bor her (G1, august 2026)
//
// De lå som fire `useEffect` i `CreateCompetitionScreen.jsx` — appens tredje
// største skærmfil — og var dermed **utestbare**: repoets testopsætning er
// bevidst uden jsdom, så alt, der kun kan nås gennem en render, kan kun
// efterprøves i hånden. Samme snit som `data/invites.js` fik samme måned.
//
// Det er ikke en teoretisk mangel. Tre af de fire bærer hver sin lærepenge om
// **tavs afkortning**, og alle tre kostede noget rigtigt:
//
//   · `countMatchesPerLeague` tæller med ét opslag PR. TURNERING. Det gamle
//     "hent alt og tæl i browseren" fyldte PostgRESTs loft på 1000 med de fire
//     første turneringer (306+380+182+132 = præcis 1000), så Premier League og
//     Serie A blev talt som nul og deres chip slukket — turneringer, der intet
//     fejlede (`G35`).
//   · `loadUpcomingMatches` beder om ÉN række mere, end den vil vise. Et loft,
//     der er lig med platformens, kan ikke skelnes fra en afkortning; med den
//     ekstra række kan "der er flere" siges højt (`G35`, samme fejl som `G51`).
//   · `loadNewestSeasons` er det ene opslag, de tre andre bygger på — hentes
//     det to gange, kan de nå at være uenige om, hvilken sæson der er nyeste.
//
// SNITTET: funktionerne svarer med DATA, ikke med state. Skærmen sætter selv
// sin `useState` — den beholder altså sit eget flow, mens opslagene flytter ud.
import { db } from "../supabase.js";
import { currentRoundKey } from "../scoring.js";

// Nyeste sæson pr. turnering: `{ [leagueId]: season }`.
//
// Ét opslag for alle turneringer, sorteret nyeste først — den første række pr.
// turnering vinder. Turneringer uden sæsonrække mangler i svaret, og det er den
// rigtige form: kalderen skal kunne skelne "ingen sæson" fra "sæson uden kampe".
async function loadNewestSeasons(token, leagues) {
  const leagueIds = leagues.map((l) => l.id);
  if (!leagueIds.length) return {};
  const seasons = await db.select(token, "seasons",
    `league_id=in.(${leagueIds.join(",")})&select=id,league_id&order=start_date.desc`);
  const newest = {};
  for (const s of seasons) if (!newest[s.league_id]) newest[s.league_id] = s;
  return newest;
}

// Kampantal pr. turnering: `{ [leagueId]: antal }`.
//
// Antallet er ikke pynt. En konkurrence materialiserer sine kampe én gang ved
// oprettelsen, så en turnering uden kampe giver en konkurrence, der er tom for
// altid — Champions League har netop nu en sæsonrække og nul kampe. Tallet gør
// den frosne liste synlig præcis dér, hvor nogen kan nå at reagere på den.
//
// Ingen sæsonrække tælles som 0: for brugeren er det samme spærring.
async function countMatchesPerLeague(token, leagues, seasonByLeague) {
  const entries = await Promise.all(leagues.map(async (l) => {
    const s = seasonByLeague[l.id];
    if (!s) return [l.id, 0];
    return [l.id, await db.count(token, "matches", `season_id=eq.${s.id}`)];
  }));
  return Object.fromEntries(entries);
}

// Alle synlige turneringers hold, grupperet: `{ [leagueId]: [hold] }`.
// Ét opslag (~20 hold pr. turnering).
async function loadTeamsByLeague(token, leagues) {
  const leagueIds = leagues.map((l) => l.id);
  if (!leagueIds.length) return {};
  const tms = await db.select(token, "teams",
    `league_id=in.(${leagueIds.join(",")})&select=id,league_id,name&order=name`);
  const byLeague = {};
  for (const t of tms) (byLeague[t.league_id] ||= []).push(t);
  return byLeague;
}

// Kommende kampe til valg-listerne — beriget med turnering, plus holdnavnene.
//
// Svarer `{ matches, teams, truncated }`. `truncated` er det, hele formen findes
// for: der bestilles `limit + 1` rækker, og kommer den ekstra hjem, ved vi, at
// listen er klippet, og kan sige det højt i stedet for at lade den se komplet
// ud. Selve `limit` er BEVIDST under PostgRESTs 1000 (`G35`).
//
// `horizonMs` sætter, hvor langt frem der kigges (Quick League skal kunne se
// flere runder frem end de øvrige); `null` betyder "ingen øvre grænse".
async function loadUpcomingMatches(token, seasonByLeague, leagues, { limit, horizonMs = null, now = Date.now() } = {}) {
  const seasons = Object.values(seasonByLeague);
  if (!seasons.length) return { matches: [], teams: {}, truncated: false };

  const seasonToLeague = Object.fromEntries(seasons.map((s) => [s.id, s.league_id]));
  const leagueNames = Object.fromEntries(leagues.map((l) => [l.id, l.name]));
  const horizon = horizonMs === null ? ""
    : `&kickoff_at=lte.${new Date(now + horizonMs).toISOString()}`;

  const raw = await db.select(token, "matches",
    `season_id=in.(${seasons.map((s) => s.id).join(",")})&kickoff_at=gte.${new Date(now).toISOString()}`
    + `&select=*&order=kickoff_at${horizon}&limit=${limit + 1}`);

  const truncated = raw.length > limit;
  const ms = truncated ? raw.slice(0, limit) : raw;

  const teamIds = [...new Set(ms.flatMap((m) => [m.home_team_id, m.away_team_id]))];
  const tms = teamIds.length
    ? await db.select(token, "teams", `id=in.(${teamIds.join(",")})&select=id,name`)
    : [];

  return {
    truncated,
    teams: Object.fromEntries(tms.map((t) => [t.id, t.name])),
    matches: ms.map((m) => ({
      ...m,
      _leagueId: seasonToLeague[m.season_id],
      _leagueName: leagueNames[seasonToLeague[m.season_id]],
    })),
  };
}

// Indeværende rundes kampe — ALLE, også dem der er i gang eller færdigspillet.
//
// Det er den ENE ting, `loadUpcomingMatches` ikke kan svare på. Den henter fra
// `nu` og frem, så en runde, hvor fem af seks kampe er fløjtet i gang, ser ud
// som en runde med én kamp — og en bruger, der opretter en konkurrence dér,
// ville få et førstested afgjort af, hvor sent på ugen han trykkede, uden at
// noget på skærmen fortalte hvorfor. Nævneren skal med, for at det kan siges.
//
// Ét opslag på rundenøglen frem for et tidsinterval: `round_key` er en kolonne
// på kampen, sat af `public.round_key()` i dansk tid (G11/G32). Regnede vi selv
// rundens start og slut i klienten, ville vi have en fjerde kopi af den regel,
// der allerede findes tre steder — og en kopi, der kun er uenig to timer om
// natten, er værre end ingen.
async function loadCurrentRoundMatches(token, seasonByLeague, leagues, { roundKey = null } = {}) {
  const key = roundKey || currentRoundKey();
  const seasons = Object.values(seasonByLeague);
  if (!seasons.length || !key) return [];

  const seasonToLeague = Object.fromEntries(seasons.map((s) => [s.id, s.league_id]));
  const leagueNames = Object.fromEntries(leagues.map((l) => [l.id, l.name]));
  const rows = await db.select(token, "matches",
    `season_id=in.(${seasons.map((s) => s.id).join(",")})&round_key=eq.${key}&select=*&order=kickoff_at`);

  return rows.map((m) => ({
    ...m,
    _leagueId: seasonToLeague[m.season_id],
    _leagueName: leagueNames[seasonToLeague[m.season_id]],
  }));
}

export { loadNewestSeasons, countMatchesPerLeague, loadTeamsByLeague, loadUpcomingMatches, loadCurrentRoundMatches };
