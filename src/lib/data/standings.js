// Alle stillingslister, der IKKE hører til én konkurrence: global rating,
// månedschampionship, rundechampionship og sæsonchampionship. Fælles træk: de læser DB-views
// eller ratings-tabellen direkte og bruger den samme tiebreaker-stige.

import { db } from "../supabase.js";
import { assignRanks } from "../standings.js";
import { TIEBREAK_ORDER, TIEBREAK_ORDER_ROUND } from "./_shared.js";
import { selectIn } from "./chunked.js";

// ---------- lukkede konti på de GLOBALE lister ----------
//
// En lukket konto står tilbage som "Slettet a1b2c3d4" (sql/account_anonymization.sql).
// Det er det ærlige billede i en PRIVAT konkurrence, hvor deltagelsen er en del
// af vennernes fælles historik: fjernede vi rækken, ville en afsluttet
// konkurrence pludselig have haft én deltager færre, og en delt sejr kunne blive
// udelt. Derfor rører vi ikke `computeCompetitionState`.
//
// På de GLOBALE lister — rating, måneds-, runde- og sæsonchampionship — er der
// ingen sådan historik at beskytte. Dér er pseudonymet bare en fremmed, der
// fylder en plads, og den, der bad om at forsvinde, står stadig på en offentlig
// rangliste. De filtreres derfor væk her.
//
// Filtreringen sker i KLIENTEN og ikke i viewene. `monthly_standings`,
// `round_standings` og `season_standings` deles med rating-motoren og er dækket
// af den frosne reference i sql/tests/rating_equivalence.sql — en lukket konto
// må ikke kunne flytte tal, der allerede er beregnet. Vi ændrer, hvad der VISES,
// ikke hvad der er REGNET.
const PROFILE_SELECT = "id,display_name,anonymized_at";

// Navne-opslag + mængden af lukkede konti, der skal ud af listen.
function profileIndex(profiles) {
  return {
    nameById: new Map(profiles.map((p) => [p.id, p.display_name])),
    closed: new Set(profiles.filter((p) => p.anonymized_at).map((p) => p.id)),
  };
}

// ---------- global rating + monthly league (scope 'ALL') ----------
async function loadRatingBoard(token) {
  // user_id.asc er den stabile sidste nøgle — ratings er numeric, så to ens tal er
  // sjældne, men når de sker, skal ranglisten ikke bytte om mellem to hentninger.
  const ratings = await db.select(token, "ratings", `scope=eq.ALL&select=user_id,rating,rounds_played,provisional&order=rating.desc,user_id.asc`);
  if (!ratings.length) return [];
  const ids = ratings.map((r) => r.user_id);
  const profiles = await selectIn(token, "profiles", "id", ids, `&select=${PROFILE_SELECT}`);
  const { nameById, closed } = profileIndex(profiles);
  // Filtreres FØR assignRanks, så placeringerne nummereres uden huller.
  const rows = ratings.filter((r) => !closed.has(r.user_id)).map((r) => ({
    userId: r.user_id,
    player: nameById.get(r.user_id) || "—",
    rating: Math.round(Number(r.rating)),
    roundsPlayed: r.rounds_played,
    provisional: r.provisional,
  }));
  // Ranglisten er ikke en pointstilling: her deles placeringen ved samme viste rating.
  return assignRanks(rows, (a, b) => b.rating - a.rating);
}

// map of user_id -> rating, for showing rating next to names in any standings
async function loadRatingMap(token) {
  const ratings = await db.select(token, "ratings", `scope=eq.ALL&select=user_id,rating,provisional`);
  return new Map(ratings.map((r) => [r.user_id, { rating: Math.round(Number(r.rating)), provisional: r.provisional }]));
}

// rating_history -> pr. bruger: formkurve (seneste 5 runder) + bevægelse (seneste rundes ratingændring)
// Kolonner: user_id, scope, round_key, rating_after, delta, round_score, matches_predicted, rnk.
// Formkurve-prik pr. runde ud fra rundens ratingændring (delta): grøn=stærk, gul=middel, grå=svag.
// Fejler kaldet (fx tom tabel), degraderer vi pænt til ingen form/bevægelse.
async function loadRatingHistory(token) {
  try {
    const rows = await db.select(token, "rating_history",
      `scope=eq.ALL&select=user_id,round_key,delta&order=round_key.asc`);
    if (!rows || !rows.length) return new Map();
    const byUser = {};
    for (const r of rows) { (byUser[r.user_id] ||= []).push(r); }
    const map = new Map();
    for (const [uid, list] of Object.entries(byUser)) {
      // list er allerede sorteret stigende på round_key (server-side order)
      const last5 = list.slice(-5);
      const form = last5.map((r) => {
        const ch = Number(r.delta);
        if (!isFinite(ch)) return 1;
        return ch > 5 ? 2 : ch < -5 ? 0 : 1; // 2=grøn (stærk) · 1=gul (middel) · 0=grå (svag)
      });
      const move = Math.round(Number(list[list.length - 1].delta) || 0);
      map.set(uid, { form, move });
    }
    return map;
  } catch {
    return new Map();
  }
}

function currentMonthKey() { return new Date().toISOString().slice(0, 7); }

// Fælles kort fra et stillings-views række til stigens feltnavne.
function standingsRow(r, nameById) {
  return {
    userId: r.user_id,
    player: nameById.get(r.user_id) || "—",
    total: r.total_points,
    matches: r.matches,
    exactCount: r.exact_count,
    outcomeCount: r.outcome_count ?? 0,
    roundWins: r.round_wins ?? 0, // findes ikke i rundechampionshippet — 0 gør trinnet neutralt
    avgGoalError: Number(r.avg_goal_error ?? 0), // numeric kommer som streng over REST
  };
}

// ---------- scope: samlet eller pr. turnering ----------
// Championship har to niveauer (sql/tournament_scope.sql):
//   'ALL'        alle OFFICIELLE turneringer samlet — den store titel
//   <league_id>  én stilling pr. officiel turnering
// Alle loaderne herunder tager scope som sidste argument og defaulter til 'ALL',
// så eksisterende kaldesteder er uændrede.
const ALL = "ALL";

async function loadMonthlyBoard(token, month, scope = ALL) {
  const rows = await db.select(token, "monthly_standings",
    `month=eq.${month}&scope=eq.${scope}&select=user_id,total_points,matches,exact_count,outcome_count,round_wins,avg_goal_error&order=${TIEBREAK_ORDER}`);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.user_id);
  const profiles = await selectIn(token, "profiles", "id", ids, `&select=${PROFILE_SELECT}`);
  const { nameById, closed } = profileIndex(profiles);
  return assignRanks(rows.filter((r) => !closed.has(r.user_id)).map((r) => standingsRow(r, nameById)));
}

async function loadMonthsAvailable(token, scope = ALL) {
  const rows = await db.select(token, "monthly_standings", `scope=eq.${scope}&select=month`);
  return [...new Set(rows.map((r) => r.month))].sort().reverse();
}

// ---------- Rundechampionship: samlede point for én enkelt spillerunde (round_key) ----------
// Samme princip som månedschampionshippet: alle er automatisk med, hver kamp tælles én
// gang. Stillingen læses fra DB-viewet round_standings — kun spillede (låste)
// kampe indgår i viewet.
//
// Kampantallet skal følge SAMME afgrænsning som pointene, ellers kan de to ikke
// tale sammen: antallet afgør `isComplete`, og dermed om pokalen og titlen vises.
// Ved 'ALL' er det sæsonerne under de OFFICIELLE turneringer; ved et scope er det
// den ene turnerings sæsoner. `is_official` frem for `is_visible`: en turnering
// kan være tipbar uden at afgøre titler, og check-constraint'en på leagues gør
// officiel til en indsnævring af synlig. To trins-opslaget er samme mønster som
// loadStarterTournaments i src/lib/onboarding.js.
async function scopeSeasonIds(token, scope = ALL) {
  const filter = scope === ALL ? `is_official=is.true` : `id=eq.${scope}`;
  const leagues = await db.select(token, "leagues", `${filter}&select=id`);
  if (!leagues.length) return [];
  const seasons = await db.select(token, "seasons", `league_id=in.(${leagues.map((l) => l.id).join(",")})&select=id`);
  return seasons.map((s) => s.id);
}
async function loadRoundsAvailable(token, scope = ALL) {
  const seasonIds = await scopeSeasonIds(token, scope);
  if (!seasonIds.length) return [];
  const rows = await db.select(token, "matches", `season_id=in.(${seasonIds.join(",")})&home_score=not.is.null&select=round_key`);
  return [...new Set(rows.map((r) => r.round_key))].sort().reverse();
}
async function loadRoundBoard(token, roundKey, scope = ALL) {
  const seasonIds = await scopeSeasonIds(token, scope);
  const ms = seasonIds.length
    ? await db.select(token, "matches", `season_id=in.(${seasonIds.join(",")})&round_key=eq.${roundKey}&select=id,home_score,away_score`)
    : [];
  if (!ms.length) return { rows: [], totalMatches: 0, playedMatches: 0, isComplete: false };
  const board = await db.select(token, "round_standings",
    `round_key=eq.${roundKey}&scope=eq.${scope}&select=user_id,total_points,matches,exact_count,outcome_count,avg_goal_error&order=${TIEBREAK_ORDER_ROUND}`);
  const ids = board.map((r) => r.user_id);
  const profiles = await selectIn(token, "profiles", "id", ids, `&select=${PROFILE_SELECT}`);
  const { nameById, closed } = profileIndex(profiles);
  const rows = assignRanks(board.filter((r) => !closed.has(r.user_id)).map((r) => standingsRow(r, nameById)));
  const playedMatches = ms.filter((m) => m.home_score != null && m.away_score != null).length;
  return { rows, totalMatches: ms.length, playedMatches, isComplete: ms.length > 0 && playedMatches === ms.length };
}

// ---------- Sæsonchampionship: samlede point for hele en ligas sæson ----------
// Alle er automatisk med (alle der har tippet en spillet kamp i sæsonen).
// Stillingen læses fra DB-viewet season_standings (gældende definition i
// sql/standings_tiebreakers.sql — standings_views.sql er afløst, nu .superseded.sql);
// kampene hentes kun til fremdrifts-tælleren (spillet/total).
async function loadSeasonBoard(token, leagueId) {
  const seasons = await db.select(token, "seasons", `league_id=eq.${leagueId}&select=id,name,start_date&order=start_date.desc&limit=1`);
  if (!seasons.length) return null;
  const season = seasons[0];
  const ms = await db.select(token, "matches", `season_id=eq.${season.id}&select=id,home_score,away_score`);
  if (!ms.length) return { season, rows: [], totalMatches: 0, playedMatches: 0, isComplete: false };
  const board = await db.select(token, "season_standings",
    `season_id=eq.${season.id}&select=user_id,total_points,matches,exact_count,outcome_count,round_wins,avg_goal_error&order=${TIEBREAK_ORDER}`);
  const ids = board.map((r) => r.user_id);
  const profiles = await selectIn(token, "profiles", "id", ids, `&select=${PROFILE_SELECT}`);
  const { nameById, closed } = profileIndex(profiles);
  const rows = assignRanks(board.filter((r) => !closed.has(r.user_id)).map((r) => standingsRow(r, nameById)));
  const playedMatches = ms.filter((m) => m.home_score != null && m.away_score != null).length;
  const totalMatches = ms.length;
  return { season, rows, totalMatches, playedMatches, isComplete: totalMatches > 0 && playedMatches === totalMatches };
}

export { loadRatingBoard, loadRatingMap, loadRatingHistory, currentMonthKey, loadMonthlyBoard, loadMonthsAvailable, loadRoundsAvailable, loadRoundBoard, loadSeasonBoard };
