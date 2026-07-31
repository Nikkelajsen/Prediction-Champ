// Alle stillingslister, der IKKE hører til én konkurrence: global rating,
// månedsliga, rundeliga og sæsonchampionship. Fælles træk: de læser DB-views
// eller ratings-tabellen direkte og bruger den samme tiebreaker-stige.

import { db } from "../supabase.js";
import { assignRanks } from "../standings.js";
import { TIEBREAK_ORDER, TIEBREAK_ORDER_ROUND } from "./_shared.js";

// ---------- global rating + monthly league (scope 'ALL') ----------
async function loadRatingBoard(token) {
  // user_id.asc er den stabile sidste nøgle — ratings er numeric, så to ens tal er
  // sjældne, men når de sker, skal ranglisten ikke bytte om mellem to hentninger.
  const ratings = await db.select(token, "ratings", `scope=eq.ALL&select=user_id,rating,rounds_played,provisional&order=rating.desc,user_id.asc`);
  if (!ratings.length) return [];
  const ids = ratings.map((r) => r.user_id);
  const profiles = await db.select(token, "profiles", `id=in.(${ids.join(",")})&select=id,display_name`);
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));
  const rows = ratings.map((r) => ({
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
    roundWins: r.round_wins ?? 0, // findes ikke i rundeligaen — 0 gør trinnet neutralt
    avgGoalError: Number(r.avg_goal_error ?? 0), // numeric kommer som streng over REST
  };
}

async function loadMonthlyBoard(token, month) {
  const rows = await db.select(token, "monthly_standings",
    `month=eq.${month}&scope=eq.ALL&select=user_id,total_points,matches,exact_count,outcome_count,round_wins,avg_goal_error&order=${TIEBREAK_ORDER}`);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.user_id);
  const profiles = await db.select(token, "profiles", `id=in.(${ids.join(",")})&select=id,display_name`);
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));
  return assignRanks(rows.map((r) => standingsRow(r, nameById)));
}

async function loadMonthsAvailable(token) {
  const rows = await db.select(token, "monthly_standings", `scope=eq.ALL&select=month`);
  return [...new Set(rows.map((r) => r.month))].sort().reverse();
}

// ---------- Rundeliga: samlede point for én enkelt spillerunde (round_key) ----------
// Samme princip som månedsligaen: alle er automatisk med, på tværs af alle ligaer,
// hver kamp tælles én gang. Stillingen læses fra DB-viewet round_standings
// (sql/standings_views.sql) — kun spillede (låste) kampe indgår i viewet.
async function loadRoundsAvailable(token) {
  const rows = await db.select(token, "matches", `home_score=not.is.null&select=round_key`);
  return [...new Set(rows.map((r) => r.round_key))].sort().reverse();
}
async function loadRoundBoard(token, roundKey) {
  const ms = await db.select(token, "matches", `round_key=eq.${roundKey}&select=id,home_score,away_score`);
  if (!ms.length) return { rows: [], totalMatches: 0, playedMatches: 0, isComplete: false };
  const board = await db.select(token, "round_standings",
    `round_key=eq.${roundKey}&select=user_id,total_points,matches,exact_count,outcome_count,avg_goal_error&order=${TIEBREAK_ORDER_ROUND}`);
  const ids = board.map((r) => r.user_id);
  const profiles = ids.length ? await db.select(token, "profiles", `id=in.(${ids.join(",")})&select=id,display_name`) : [];
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));
  const rows = assignRanks(board.map((r) => standingsRow(r, nameById)));
  const playedMatches = ms.filter((m) => m.home_score != null && m.away_score != null).length;
  return { rows, totalMatches: ms.length, playedMatches, isComplete: ms.length > 0 && playedMatches === ms.length };
}

// ---------- Sæsonchampionship: samlede point for hele en ligas sæson ----------
// Alle er automatisk med (alle der har tippet en spillet kamp i sæsonen).
// Stillingen læses fra DB-viewet season_standings (sql/standings_views.sql);
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
  const profiles = ids.length ? await db.select(token, "profiles", `id=in.(${ids.join(",")})&select=id,display_name`) : [];
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));
  const rows = assignRanks(board.map((r) => standingsRow(r, nameById)));
  const playedMatches = ms.filter((m) => m.home_score != null && m.away_score != null).length;
  const totalMatches = ms.length;
  return { season, rows, totalMatches, playedMatches, isComplete: totalMatches > 0 && playedMatches === totalMatches };
}

export { loadRatingBoard, loadRatingMap, loadRatingHistory, currentMonthKey, standingsRow, loadMonthlyBoard, loadMonthsAvailable, loadRoundsAvailable, loadRoundBoard, loadSeasonBoard };
