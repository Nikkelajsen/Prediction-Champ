// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { db, restFetch } from "./supabase.js";
import { currentRoundIndex, groupIntoRounds, isLocked, liveInfo, pointsFor, roundLabel, buildRoundLockMap, roundLockKey, filterByStages, filterFromNextUnfinishedRound, LOCK_LEAD_MS } from "./scoring.js";
import { assignRanks, avgGoalError, compareStandings, sortStandings } from "./standings.js";
import { QUIET_TIER_MIN } from "./stories.js";
import { logEvent } from "./analytics.js";

// Tiebreaker-stigen som PostgREST-order: point → præcise → udfald → rundesejre →
// målafvigelse, og til sidst user_id som skjult, stabil nøgle (afgør aldrig en
// placering — den sikrer bare, at rækker ikke bytter plads mellem to hentninger).
// Stigen selv bor i src/lib/standings.js; kolonnerne i sql/standings_tiebreakers.sql.
const TIEBREAK_ORDER = "total_points.desc,exact_count.desc,outcome_count.desc,round_wins.desc,avg_goal_error.asc,user_id.asc";
// Rundeligaen ér én runde og har derfor ingen rundesejre at bryde lighed med.
const TIEBREAK_ORDER_ROUND = "total_points.desc,exact_count.desc,outcome_count.desc,avg_goal_error.asc,user_id.asc";

// Én rundes tal i stigens feltnavne (uden rundesejre — inde i én runde findes de ikke).
function roundRow(rs) {
  return { total: rs.total, exactCount: rs.exact, outcomeCount: rs.outcome, avgGoalError: avgGoalError(rs.goalError, rs.matches) };
}

// Stillingen som den så ud FØR runden `key` — samme felter, så stigen kan bruges igen.
function without(r, key) {
  const rs = r.perRoundStats[key];
  if (!rs) return r;
  const matches = r.matches - rs.matches;
  const goalError = r.goalError - rs.goalError;
  return {
    userId: r.userId,
    total: r.total - rs.total,
    exactCount: r.exactCount - rs.exact,
    outcomeCount: r.outcomeCount - rs.outcome,
    roundWins: r.roundWins - (r.wonRounds.has(key) ? 1 : 0),
    avgGoalError: avgGoalError(goalError, matches),
  };
}

// henter deltagere + kampe + forudsigelser for én konkurrence og beregner stilling + status
async function computeCompetitionState(token, competitionId, rules) {
  const participants = await db.select(token, "competition_participants", `competition_id=eq.${competitionId}&select=user_id`);
  const userIds = participants.map((p) => p.user_id);
  const profiles = userIds.length ? await db.select(token, "profiles", `id=in.(${userIds.join(",")})&select=*`) : [];
  const cms = await db.select(token, "competition_matches", `competition_id=eq.${competitionId}&select=match_id`);
  const matchIds = cms.map((c) => c.match_id);
  const ms = matchIds.length ? await db.select(token, "matches", `id=in.(${matchIds.join(",")})&select=*`) : [];
  const preds = matchIds.length ? await db.select(token, "predictions", `match_id=in.(${matchIds.join(",")})&select=*`) : [];

  const teamIds = [...new Set(ms.flatMap((m) => [m.home_team_id, m.away_team_id]).filter(Boolean))];
  const teams = teamIds.length ? await db.select(token, "teams", `id=in.(${teamIds.join(",")})&select=id,name`) : [];
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  ms.forEach((m) => { m._home = teamName.get(m.home_team_id); m._away = teamName.get(m.away_team_id); });

  const rounds = groupIntoRounds(ms);
  const predsByKey = new Map(preds.map((pr) => [`${pr.match_id}:${pr.user_id}`, pr]));

  const playedRounds = rounds.filter((r) => r.matches.some((m) => m.home_score !== null && m.home_score !== undefined));
  const playedKeys = playedRounds.map((r) => r.key);
  const lastKey = playedKeys[playedKeys.length - 1];

  // Alt hvad tiebreaker-stigen har brug for, opgjort i én gennemgang pr. spiller.
  // `perRoundStats` bruges bagefter til rundesejre og til stillingen FØR seneste runde.
  const rows = profiles.map((p) => {
    let total = 0;
    let exactCount = 0;
    let outcomeCount = 0;
    let goalError = 0;
    let matches = 0;
    const perRound = {};
    const perRoundStats = {};
    for (const round of rounds) {
      const rs = { total: 0, exact: 0, outcome: 0, goalError: 0, matches: 0 };
      let rPlayed = false;
      for (const m of round.matches) {
        const pred = predsByKey.get(`${m.id}:${p.id}`);
        const pts = pointsFor(pred, m, rules);
        if (pts !== null) {
          rs.total += pts; rs.matches++; rPlayed = true;
          rs.goalError += Math.abs(pred.pred_home - m.home_score) + Math.abs(pred.pred_away - m.away_score);
          if (pred.pred_home === m.home_score && pred.pred_away === m.away_score) rs.exact++;
          else if (pts === rules.outcome) rs.outcome++;
        }
      }
      if (rPlayed) { perRound[round.key] = rs.total; perRoundStats[round.key] = rs; }
      total += rs.total; exactCount += rs.exact; outcomeCount += rs.outcome;
      goalError += rs.goalError; matches += rs.matches;
    }
    const form3 = playedKeys.slice(-3).reduce((s, k) => s + (perRound[k] ?? 0), 0);
    return {
      userId: p.id, player: p.display_name, total, perRound, perRoundStats,
      exactCount, outcomeCount, matches, goalError,
      avgGoalError: avgGoalError(goalError, matches), form3,
    };
  });

  // Rundesejre: nr. 1 i den enkelte runde efter samme stige uden rundesejr-trinnet.
  // En delt rundesejr tæller for alle — samme regel som Story Engines rundevinder.
  rows.forEach((r) => { r.roundWins = 0; r.wonRounds = new Set(); });
  for (const key of playedKeys) {
    const inRound = rows
      .filter((r) => r.perRoundStats[key])
      .map((r) => ({ row: r, ...roundRow(r.perRoundStats[key]) }));
    if (!inRound.length) continue;
    const best = inRound.slice().sort(compareStandings)[0];
    inRound.forEach((c) => {
      if (compareStandings(c, best) === 0) { c.row.roundWins++; c.row.wonRounds.add(key); }
    });
  }

  const ranked = assignRanks(sortStandings(rows));

  // ▲/▼: sammenlign med stillingen FØR seneste spillede runde — med hele stigen,
  // så pilen ikke påstår en bevægelse, der kun skyldes en manglende tiebreak.
  if (playedKeys.length >= 2) {
    const prev = assignRanks(sortStandings(ranked.map((r) => without(r, lastKey))));
    const prevRank = new Map(prev.map((r) => [r.userId, r.rank]));
    ranked.forEach((r) => { r.rankDelta = (prevRank.get(r.userId) ?? r.rank) - r.rank; });
  }

  const totalMatches = ms.length;
  const playedMatches = ms.filter((m) => m.home_score !== null && m.home_score !== undefined).length;
  const isComplete = totalMatches > 0 && playedMatches === totalMatches;

  return { userId: undefined, rows: ranked, rounds: playedRounds, allRounds: rounds, predsByKey, totalMatches, playedMatches, isComplete };
}

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

// ---------- Hjem: næste deadline + manglende tips på tværs af brugerens konkurrencer ----------
async function computeHomeTips(token, userId, competitions) {
  const compIds = competitions.map((c) => c.id);
  if (!compIds.length) return { hasComps: false };
  const cms = await db.select(token, "competition_matches", `competition_id=in.(${compIds.join(",")})&select=competition_id,match_id`);
  const ids = [...new Set(cms.map((c) => c.match_id))];
  if (!ids.length) return { hasComps: true, noMatches: true };
  const matchComps = {};
  for (const c of cms) (matchComps[c.match_id] ||= []).push(c.competition_id);
  const ms = await db.select(token, "matches", `id=in.(${ids.join(",")})&select=*&order=kickoff_at`);
  const lockMap = buildRoundLockMap(ms);
  const teamIds = [...new Set(ms.flatMap((m) => [m.home_team_id, m.away_team_id]).filter(Boolean))];
  const teams = teamIds.length ? await db.select(token, "teams", `id=in.(${teamIds.join(",")})&select=id,name`) : [];
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const preds = await db.select(token, "predictions", `match_id=in.(${ids.join(",")})&user_id=eq.${userId}&select=match_id,pred_home,pred_away`);
  const predByMatch = new Map(preds.map((p) => [p.match_id, p]));

  // rullende vindue: en kamp er "ikke åben endnu", hvis ALLE konkurrencer, den indgår i, har openDaysBefore.
  // Vinduet er runde-baseret (regnet fra rundens tidligste kickoff), så en kamp aldrig åbner efter rundelåsen.
  const opensAt = (m) => {
    const cids = matchComps[m.id] || [];
    const cs = cids.map((id) => competitions.find((c) => c.id === id)).filter(Boolean);
    if (!cs.length) return false;
    const w = cs.map((c) => c.rules?.openDaysBefore || 0);
    if (w.some((x) => !x)) return false;
    const md = Math.max(...w);
    const roundStart = lockMap.get(roundLockKey(m)) ?? new Date(m.kickoff_at).getTime();
    return Date.now() < roundStart - md * 24 * 3600 * 1000;
  };
  const now = Date.now();
  const played = (m) => m.home_score !== null && m.home_score !== undefined;

  const tippable = ms.filter((m) => !played(m) && !isLocked(m, lockMap) && !opensAt(m) && m.kickoff_at);
  const isTipped = (m) => { const p = predByMatch.get(m.id); return !!(p && p.pred_home != null && p.pred_away != null); };
  // Fælles hale til de to "der er intet at gøre lige nu"-tilstande: nærmeste
  // kommende kamp + dens runde, så kortets knap kan åbne Tip landet det rigtige
  // sted (samme sted som "Tip nu" ved manglende tips).
  const nextUp = (extra) => {
    const future = ms.filter((m) => !played(m) && m.kickoff_at && new Date(m.kickoff_at).getTime() > now)
      .sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));
    return { hasComps: true, ...extra, nextOpen: future[0]?.kickoff_at || null, roundKey: future[0]?.round_key || null };
  };
  // "Alle tips er inde" er en påstand om BRUGERENS tips og må kun bruges, når vi
  // faktisk har set, at rundens tipbare kampe er tippet.
  const allOk = () => nextUp({ allTipped: true });
  // "Intet at tippe lige nu" er noget andet: der er ingen tipbare kampe overhovedet
  // (runden er låst/spillet, eller det rullende vindue har ikke åbnet endnu). Før
  // returnerede begge tilfælde allTipped, så en bruger med NUL tips fik at vide,
  // at alle tips var inde.
  const nothingToTip = () => nextUp({ nothingToTip: true });

  // "Næste runde" = den TIDLIGSTE runde, der stadig har kampe man kan tippe. Vi viser
  // KUN status for den runde: er den fuldt tippet, er alt ok (grøn) — også selvom senere
  // runder mangler tips (de bliver "næste runde" i tur, efterhånden som runderne spilles).
  // (Før valgte vi den tidligste UTIPPEDE kamp, så en runde langt ude kunne fejlagtigt
  // vise rødt, selvom de nærmeste runder var tippet.)
  if (!tippable.length) return nothingToTip();
  const nextRoundKey = tippable.reduce((min, m) => (m.round_key < min ? m.round_key : min), tippable[0].round_key);
  const roundUntipped = tippable.filter((m) => m.round_key === nextRoundKey && !isTipped(m))
    .sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));
  if (!roundUntipped.length) return allOk();

  const deadline = Math.min(...roundUntipped.map((m) => (lockMap.get(roundLockKey(m)) ?? new Date(m.kickoff_at).getTime()) - LOCK_LEAD_MS));
  const names = roundUntipped.slice(0, 3).map((m) => `${teamName.get(m.home_team_id) || "?"} – ${teamName.get(m.away_team_id) || "?"}`);
  return { hasComps: true, allTipped: false, roundKey: nextRoundKey, roundLabelText: roundLabel(nextRoundKey), deadline, missingCount: roundUntipped.length, names };
}

// ---------- Hjem: live-oversigt over indeværende runde ----------
// Samler brugerens konkurrence-kampe, grupperer i runder og vælger den runde der
// spilles nu (eller nærmeste kommende, via currentRoundIndex). Returnerer rundens
// kampe med resultat + brugerens eget tip + point, så Hjem kan vise en oversigt der
// opdaterer løbende, efterhånden som resultater tikker ind (sync). Hver kamp tælles
// én gang (dedup på match-id), da predictions deles på tværs af konkurrencer.
async function computeCurrentRound(token, userId, competitions) {
  const compIds = competitions.map((c) => c.id);
  if (!compIds.length) return null;
  const cms = await db.select(token, "competition_matches", `competition_id=in.(${compIds.join(",")})&select=match_id`);
  const ids = [...new Set(cms.map((c) => c.match_id))];
  if (!ids.length) return null;
  const ms = await db.select(token, "matches", `id=in.(${ids.join(",")})&select=*&order=kickoff_at`);
  if (!ms.length) return null;
  const rounds = groupIntoRounds(ms);
  const round = rounds[currentRoundIndex(rounds)];
  if (!round || !round.matches.length) return null;

  const teamIds = [...new Set(round.matches.flatMap((m) => [m.home_team_id, m.away_team_id]).filter(Boolean))];
  const teams = teamIds.length ? await db.select(token, "teams", `id=in.(${teamIds.join(",")})&select=id,name`) : [];
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const roundMatchIds = round.matches.map((m) => m.id);
  const preds = await db.select(token, "predictions", `match_id=in.(${roundMatchIds.join(",")})&user_id=eq.${userId}&select=match_id,pred_home,pred_away`);
  const predByMatch = new Map(preds.map((p) => [p.match_id, p]));
  const rules = { exact: 3, outcome: 1 };

  let myPoints = 0, playedCount = 0;
  const matches = round.matches.map((m) => {
    const played = m.home_score != null && m.away_score != null;
    const pred = predByMatch.get(m.id) || null;
    const points = played ? pointsFor(pred, m, rules) : null;
    if (played) { playedCount++; if (points != null) myPoints += points; }
    // Live-stilling (live_*-kolonnerne, skrevet af api/sync-live.js hvert minut).
    // Den tæller ikke point — kun det endelige resultat gør. inProgress er fallback:
    // kickoff er passeret, men vi har ingen live-data (fx uden for Sportmonks-planen).
    const live = liveInfo(m);
    const inProgress = !played && !live && m.kickoff_at && new Date(m.kickoff_at).getTime() <= Date.now();
    return {
      id: m.id,
      home: teamName.get(m.home_team_id) || "?",
      away: teamName.get(m.away_team_id) || "?",
      homeScore: m.home_score, awayScore: m.away_score,
      kickoff: m.kickoff_at, played, live, inProgress, pred, points,
    };
  });
  return {
    roundKey: round.key, roundLabelText: round.label,
    matches, myPoints, playedCount, totalCount: round.matches.length,
    // antal kampe der spilles LIGE NU — bruges til LIVE-mærket på det foldede kort
    liveCount: matches.filter((m) => m.live).length,
    isComplete: playedCount === round.matches.length,
  };
}

// ---------- dato/tid-formattering til Hjem ----------
function daFullDate(d = new Date()) {
  const s = d.toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function fmtCountdown(ts) {
  let s = Math.max(0, Math.floor((ts - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} d ${h} t`;
  if (h > 0) return `${h} t ${m} min`;
  return `${m} min`;
}

function monthName(monthKey) {
  const [y, m] = monthKey.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  const s = d.toLocaleDateString("da-DK", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- Aktivitets-sporing + brugerstatistik ----------
// touchActivity: letvægts-"ping" ved app-start. RPC'en registrerer, at brugeren har
// været inde i dag (last_seen_at + user_activity_days). Throttlet til maks. 1×/time via
// localStorage, så gentagne genstarter/refresh ikke spammer. Fejl ignoreres stille —
// sporing må aldrig blokere appen.
const PING_KEY = "pc_last_ping";
async function touchActivity(token) {
  try {
    const last = Number(localStorage.getItem(PING_KEY) || 0);
    if (Date.now() - last < 60 * 60 * 1000) return; // maks. 1 ping pr. time
    await restFetch(`/rest/v1/rpc/touch_activity`, { method: "POST", token, body: {} });
    localStorage.setItem(PING_KEY, String(Date.now()));
  } catch { /* ignorer — sporing er best-effort */ }
}

// loadUserStats: henter aggregeret brugerstatistik. RPC'en er admin-kun (security
// definer med is_admin-guard) og returnerer alle nøgletal + kurver i ét kald.
async function loadUserStats(token) {
  return restFetch(`/rest/v1/rpc/admin_user_stats`, { method: "POST", token, body: {} });
}

// ---------- Story Engine: seneste historie til Hjem ----------
// Læser latest_story-viewet (RLS: kun egne rækker) for den seneste runde. Er den
// seneste historie afvist, returneres null (så en afvist historie ikke afslører en
// ældre runde). Degraderer stille til null, hvis viewet endnu ikke findes (skygge/L3).
async function loadLatestStory(token) {
  try {
    const rows = await db.select(token, "latest_story", `order=round_key.desc&limit=1`);
    if (!rows || !rows.length) return null;
    const s = rows[0];
    if (s.dismissed_at) return null;
    return s;
  } catch { return null; }
}

// Afvis en historie (sætter dismissed_at). Best-effort.
async function dismissStory(token, id) {
  try {
    await db.update(token, "stories", `id=eq.${id}`, { dismissed_at: new Date().toISOString() });
  } catch { /* best-effort */ }
}

// ---------- Karriereprofil ----------
// Ét RPC-kald samler hele profil-læsningen (hoved, titler, ratingkurve, basistal,
// rivaler) i databasen — mønster som loadUserStats. RPC'et er security definer og
// gated på K1-relationen (egen profil, eller en man deler liga/konkurrence med);
// forsøg på en fremmed profil kaster 'forbidden', som skærmen viser som pæn tekst.
async function loadCareerProfile(token, profileUserId) {
  return restFetch(`/rest/v1/rpc/career_profile`, {
    method: "POST", token, body: { profile_user_id: profileUserId },
  });
}

// Milepæle hentes SEPARAT via den eksisterende RLS-læsning af stories (kun egne
// rækker), så de forbliver private — de vises kun på ens egen profil. RLS returnerer
// intet for andres profil, men vi springer kaldet helt over når det ikke er egen profil.
// Genbrug af story-arkivets færdige headline/body som kronologisk minde-liste.
//
// KUN højdepunkt-tieret (`priority < QUIET_TIER_MIN`). Story Engine v1.1 gemmer også
// dæmpede kort for stille runder ("Din runde: 4 point"), og de er per definition ikke
// milepæle — kom de med, ville arkivet blive en rundelog med de ægte øjeblikke gemt inde i.
async function loadCareerMilestones(token, profileUserId, isOwn) {
  if (!isOwn) return [];
  try {
    const rows = await db.select(token, "stories",
      `user_id=eq.${profileUserId}&priority=lt.${QUIET_TIER_MIN}&select=id,round_key,rule,headline,body,created_at&order=round_key.desc,priority.asc`);
    return (rows || []).map((s) => ({
      id: s.id, roundKey: s.round_key, rule: s.rule,
      headline: s.headline, body: s.body, createdAt: s.created_at,
    }));
  } catch { return []; }
}

// ---------- Liga-laget: permanente fællesskaber (grupper) ----------
// NB navngivning (docs/features/liga-laget-v1.md afsnit 2): DB-enheden `groups`
// hedder en "liga" i UI; `leagues` (fodbold) hedder en "turnering".

// Mine ligaer + medlemstal + antal konkurrencer i hver (til Ligaer-fanens kort).
async function loadMyGroups(token, userId) {
  const mem = await db.select(token, "group_members", `user_id=eq.${userId}&select=group_id,role`);
  if (!mem.length) return [];
  const ids = mem.map((m) => m.group_id);
  const roleById = new Map(mem.map((m) => [m.group_id, m.role]));
  const groups = await db.select(token, "groups", `id=in.(${ids.join(",")})&select=*&order=created_at`);
  // medlemstal pr. liga (RLS: is_group_member giver læseadgang til co-medlemmer)
  const members = await db.select(token, "group_members", `group_id=in.(${ids.join(",")})&select=group_id`);
  const memberCount = {};
  members.forEach((m) => { memberCount[m.group_id] = (memberCount[m.group_id] || 0) + 1; });
  // antal konkurrencer pr. liga
  const comps = await db.select(token, "competitions", `group_id=in.(${ids.join(",")})&select=id,group_id`);
  const compCount = {};
  comps.forEach((c) => { compCount[c.group_id] = (compCount[c.group_id] || 0) + 1; });
  return groups.map((g) => ({
    ...g, role: roleById.get(g.id),
    memberCount: memberCount[g.id] || 0, compCount: compCount[g.id] || 0,
  }));
}

// Fuld liga-side: gruppe, medlemmer, ligaens konkurrencer + egen deltagelse.
async function loadGroupDetail(token, userId, groupId) {
  const groups = await db.select(token, "groups", `id=eq.${groupId}&select=*`);
  if (!groups.length) return null;
  const group = groups[0];
  const members = await db.select(token, "group_members", `group_id=eq.${groupId}&select=user_id,role,joined_at&order=joined_at`);
  const ids = members.map((m) => m.user_id);
  const profiles = ids.length ? await db.select(token, "profiles", `id=in.(${ids.join(",")})&select=id,display_name`) : [];
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));
  const memberList = members.map((m) => ({ userId: m.user_id, name: nameById.get(m.user_id) || "—", role: m.role, joinedAt: m.joined_at }));
  const myRole = members.find((m) => m.user_id === userId)?.role || null;

  const comps = await db.select(token, "competitions", `group_id=eq.${groupId}&select=*&order=created_at.desc`);
  const compIds = comps.map((c) => c.id);
  const myParts = compIds.length ? await db.select(token, "competition_participants", `user_id=eq.${userId}&competition_id=in.(${compIds.join(",")})&select=competition_id`) : [];
  const joinedSet = new Set(myParts.map((p) => p.competition_id));
  const allParts = compIds.length ? await db.select(token, "competition_participants", `competition_id=in.(${compIds.join(",")})&select=competition_id`) : [];
  const partCount = {};
  allParts.forEach((p) => { partCount[p.competition_id] = (partCount[p.competition_id] || 0) + 1; });
  const competitions = comps.map((c) => ({ ...c, joined: joinedSet.has(c.id), participantCount: partCount[c.id] || 0 }));

  return { group, members: memberList, isMember: myRole !== null, myRole, competitions };
}

// Slå en liga op på invite-koden (uden at melde ind) — til bekræftelses-modalen.
async function loadGroupByCode(token, code) {
  const found = await db.select(token, "groups", `invite_code=eq.${code.trim()}&select=*`);
  return found[0] || null;
}

// Opret liga: indsæt gruppen + opretteren som admin-medlem.
async function createGroup(token, userId, name) {
  const [g] = await db.insert(token, "groups", [{ name: name.trim(), created_by: userId }]);
  await db.insert(token, "group_members", [{ group_id: g.id, user_id: userId, role: "admin" }]);
  logEvent(token, "league_created", { groupId: g.id });
  return g;
}

// Meld sig selv ind i en liga (idempotent — springer over hvis allerede medlem).
async function joinGroup(token, userId, groupId) {
  const existing = await db.select(token, "group_members", `group_id=eq.${groupId}&user_id=eq.${userId}&select=user_id`);
  if (!existing.length) {
    await db.insert(token, "group_members", [{ group_id: groupId, user_id: userId, role: "member" }]);
    logEvent(token, "league_joined", { groupId }); // ikke ved den idempotente early-return — kun ægte nye medlemskaber
  }
}

// Forlad en liga (fjern egen medlemsrække). RLS blokerer, hvis man stadig deltager
// i en af ligaens konkurrencer — ellers ville man stå tilbage som deltager uden
// liga-medlemskab, den forældreløse tilstand invarianten forbyder
// (sql/group_membership_invariant.sql). Returnerer false ved blokering, så UI kan
// forklare hvorfor, i stedet for tavst at navigere brugeren væk fra en liga, de
// stadig er medlem af. Samme mønster som leaveCompetition.
async function leaveGroup(token, userId, groupId) {
  const res = await db.del(token, "group_members", `group_id=eq.${groupId}&user_id=eq.${userId}`);
  return Array.isArray(res) ? res.length > 0 : true;
}

// Slet en tom liga (RLS: kun admin + ingen konkurrencer). Returnerer true hvis slettet.
async function deleteGroup(token, groupId) {
  const res = await db.del(token, "groups", `id=eq.${groupId}`);
  return Array.isArray(res) ? res.length > 0 : true;
}

// Deltag i en konkurrence (tilmelding pr. konkurrence).
// Deltag i en konkurrence. Hører den til en liga, meldes man samtidig ind i ligaen
// (A8: ingen gæste-deltagelse) — liga-medlemskabet FØRST, så en fejl undervejs ikke
// efterlader en deltager uden liga: usynlig på medlemslisten og uden adgang til
// ligaens side. `joinGroup` er idempotent, så det er gratis at kalde for et
// eksisterende medlem (fx når man melder sig til fra liga-siden).
//
// Reglen bor HER, fordi de to veje ind i en konkurrence — deep-link (?join=) og
// indsat invitationskode — havde hver sin kopi, og kun den ene huskede ligaen
// (A7, juli 2026).
async function joinCompetition(token, userId, compId, groupId = null) {
  if (groupId) await joinGroup(token, userId, groupId);
  await db.insert(token, "competition_participants", [{ competition_id: compId, user_id: userId }]);
  logEvent(token, "competition_joined", { competitionId: compId, groupId });
}

// Framelding: slet egen deltager-række. RLS blokerer, hvis man har tips på låste
// kampe (returnerer da ingen rækker) — vi returnerer false, så UI kan forklare hvorfor.
async function leaveCompetition(token, userId, compId) {
  const res = await db.del(token, "competition_participants", `competition_id=eq.${compId}&user_id=eq.${userId}`);
  return Array.isArray(res) ? res.length > 0 : true;
}

// ---------- oprettelse af konkurrence ----------

// Et ægte DELMÆNGDE-valg af stages. Dækker valget alle stages (eller er der kun
// én), filtreres der ikke — så kampe uden stage_name fra ældre sync ikke tavst
// droppes. Reglen er den samme for `full_season` pr. turnering og for team/
// time_range, og bor derfor ét sted.
function isStageSubset(available, selected) {
  return (available || []).length > 1 && (selected || []).length > 0 && selected.length < available.length;
}

// Opret en konkurrence: konkurrence-rækken + opretteren som deltager + de kampe,
// konkurrencen omfatter.
//
// Logikken bor HER og ikke i opret-skærmen, fordi den nu har to kaldesteder
// (opret-skærmen og onboarding-guiden). Præcis dét — to veje ind i den samme
// skrivning, hver med sin kopi — var det, A7 kostede, da kun den ene huskede
// ligaen. Skærmen beholder sin UI-state og bygger blot `spec`.
//
// `spec`:
//   name                  påkrævet
//   groupId               liga-tilhør (null = liga-løs)
//   mode                  full_season | team | time_range | custom | random
//   tournaments           full_season: [{ leagueId, seasonId, availableStages, selectedStages }]
//   leagueId, seasonId    team | time_range
//   teamId                team
//   startDate, endDate    time_range
//   availableStages,
//   selectedStages        team | time_range
//   matchIds              custom | random: de eksplicit valgte kampe
//   randomCount           random: gemmes i mode_params
//   openDaysBefore        rullende gætte-vindue (0 = fra)
//
// Returnerer `matchCount`, så kalderen kan se, at en konkurrence blev tom —
// fx en sæson, der er spillet færdig (`filterFromNextUnfinishedRound` giver da
// et tomt sæt). Guiden bruger det til ikke at love et tip, der ikke findes.
async function createCompetition(token, userId, spec) {
  const {
    name, groupId = null, mode = "full_season",
    tournaments = [], leagueId = null, seasonId = null,
    teamId = null, startDate = null, endDate = null,
    availableStages = [], selectedStages = [],
    matchIds = [], randomCount = null, openDaysBefore = 0,
  } = spec;

  const rules = { exact: 3, outcome: 1, ...(openDaysBefore ? { openDaysBefore } : {}) };
  const base = { name, group_id: groupId || null, rules, created_by: userId };

  // Full sæson kan spænde over flere turneringer på én gang (fx Superliga +
  // Premier League). Kampene materialiseres pr. turnering — med den turnerings
  // egne stage-valg — så læse-stierne (stilling, tips) virker uændret via
  // competition_matches.
  if (mode === "full_season") {
    const sel = tournaments.filter((t) => t && t.leagueId && t.seasonId);
    if (!sel.length) throw new Error("Vælg mindst én turnering");
    const multi = sel.length > 1;
    const picked = [];
    const ids = [];
    for (const t of sel) {
      const subset = isStageSubset(t.availableStages, t.selectedStages);
      let ms = await db.select(token, "matches", `season_id=eq.${t.seasonId}&select=id,round_key,home_score,stage_name`);
      ms = filterByStages(ms, subset ? t.selectedStages : []);
      ms = filterFromNextUnfinishedRound(ms);
      for (const m of ms) ids.push(m.id);
      picked.push({ league_id: t.leagueId, season_id: t.seasonId, ...(subset ? { stages: t.selectedStages } : {}) });
    }
    const only = picked[0];
    // Én turnering: bevar den bundne form (league_id/season_id sat, evt. stages).
    // Flere: liga-løs som custom/random (null), turneringerne gemt i mode_params.
    const [competition] = await db.insert(token, "competitions", [{
      ...base,
      league_id: multi ? null : only.league_id,
      season_id: multi ? null : only.season_id,
      mode: "full_season",
      mode_params: multi ? { tournaments: picked } : (only.stages ? { stages: only.stages } : {}),
    }]);
    await db.insert(token, "competition_participants", [{ competition_id: competition.id, user_id: userId }]);
    if (ids.length) {
      await db.insert(token, "competition_matches", ids.map((id) => ({ competition_id: competition.id, match_id: id })));
    }
    logEvent(token, "competition_created", { competitionId: competition.id, groupId, metadata: { mode: "full_season", match_count: ids.length } });
    return { competition, matchCount: ids.length };
  }

  const crossLeague = mode === "custom" || mode === "random";
  // Sæson-baserede modes kan ikke oprettes uden en sæson. Før returnerede
  // skærmen tavst her, så knappen bare holdt op med at virke; nu siges det højt.
  if (!crossLeague && (!leagueId || !seasonId)) throw new Error("Ingen turnering med et kampprogram — vælg en anden turnering.");
  if (crossLeague && !matchIds.length) throw new Error(mode === "custom" ? "Vælg mindst én kamp" : "Ingen kommende kampe i de valgte turneringer");

  const subset = !crossLeague && isStageSubset(availableStages, selectedStages);
  const [competition] = await db.insert(token, "competitions", [{
    ...base,
    league_id: crossLeague ? null : leagueId,
    season_id: crossLeague ? null : seasonId,
    mode,
    mode_params: {
      ...(mode === "team" ? { team_id: teamId }
        : mode === "time_range" ? { start_date: startDate, end_date: endDate }
        : mode === "random" ? { count: Number(randomCount) || 6 } : {}),
      ...(subset ? { stages: selectedStages } : {}),
    },
  }]);
  await db.insert(token, "competition_participants", [{ competition_id: competition.id, user_id: userId }]);

  if (crossLeague) {
    await db.insert(token, "competition_matches", matchIds.map((id) => ({ competition_id: competition.id, match_id: id })));
    logEvent(token, "competition_created", { competitionId: competition.id, groupId, metadata: { mode, match_count: matchIds.length } });
    return { competition, matchCount: matchIds.length };
  }

  let query = `season_id=eq.${seasonId}&select=id,round_key,home_score,stage_name`;
  if (mode === "team" && teamId) query += `&or=(home_team_id.eq.${teamId},away_team_id.eq.${teamId})`;
  if (mode === "time_range" && startDate && endDate) query += `&kickoff_at=gte.${startDate}&kickoff_at=lte.${endDate}T23:59:59`;
  let matched = await db.select(token, "matches", query);
  matched = filterByStages(matched, subset ? selectedStages : []);
  matched = filterFromNextUnfinishedRound(matched);
  if (matched.length) {
    await db.insert(token, "competition_matches", matched.map((m) => ({ competition_id: competition.id, match_id: m.id })));
  }
  logEvent(token, "competition_created", { competitionId: competition.id, groupId, metadata: { mode, match_count: matched.length } });
  return { competition, matchCount: matched.length };
}

// ---------- deltag med invitationskode ----------

// Ny brugere indsætter det, de fik i beskedtråden — hele linket, ikke en
// renskrevet kode. Træk koden ud af `?liga=`/`?join=`, og lad alt andet passere
// som en rå kode.
function inviteCodeFrom(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/[?&](?:liga|join)=([^&#\s]+)/i);
  return m ? decodeURIComponent(m[1]) : s;
}

// Deltag ud fra én kode, der kan være enten en liga- eller en konkurrence-kode
// (bagudkompatibelt: begge invite-links er permanente, jf. A7).
//
// Idempotent: er man allerede deltager, skrives der ingen dublet — men
// liga-medlemskabet forsøges stadig, fordi netop dét er A8-halvtilstanden
// (deltager uden liga-medlemskab), og at bruge invitationen igen er den
// naturlige måde at forsøge at rette den på.
async function joinByInviteCode(token, userId, rawCode) {
  const code = inviteCodeFrom(rawCode);
  if (!code) return { kind: "none" };

  const group = await loadGroupByCode(token, code);
  if (group) {
    await joinGroup(token, userId, group.id);
    logEvent(token, "league_invite_accepted", { groupId: group.id, metadata: { via: "code" } });
    return { kind: "group", group };
  }

  const found = await db.select(token, "competitions", `invite_code=eq.${code}&select=*`);
  if (!found.length) return { kind: "none" };
  const competition = found[0];

  const already = await db.select(token, "competition_participants", `competition_id=eq.${competition.id}&user_id=eq.${userId}&select=competition_id`);
  if (already.length) {
    if (competition.group_id) {
      try { await joinGroup(token, userId, competition.group_id); }
      catch { /* deltagelsen er intakt — bloker ikke navigationen */ }
      logEvent(token, "league_invite_accepted", { groupId: competition.group_id, competitionId: competition.id, metadata: { via: "code" } });
    }
    return { kind: "competition", competition, alreadyJoined: true };
  }

  await joinCompetition(token, userId, competition.id, competition.group_id);
  if (competition.group_id) {
    logEvent(token, "league_invite_accepted", { groupId: competition.group_id, competitionId: competition.id, metadata: { via: "code" } });
  }
  return { kind: "competition", competition, alreadyJoined: false };
}

// Flyt en egen liga-løs konkurrence ind i en liga (blød migrering). RPC'en gør
// konkurrencens deltagere til liga-medlemmer (security definer, guard i SQL).
async function moveCompetitionToGroup(token, compId, groupId) {
  return restFetch(`/rest/v1/rpc/move_competition_to_group`, {
    method: "POST", token, body: { p_comp_id: compId, p_group_id: groupId },
  });
}

export { computeCompetitionState, loadRatingBoard, loadRatingMap, loadRatingHistory, currentMonthKey, loadMonthlyBoard, loadMonthsAvailable, loadRoundsAvailable, loadRoundBoard, loadSeasonBoard, computeHomeTips, computeCurrentRound, daFullDate, fmtCountdown, monthName, touchActivity, loadUserStats, loadLatestStory, dismissStory, loadCareerProfile, loadCareerMilestones, loadMyGroups, loadGroupDetail, loadGroupByCode, createGroup, joinGroup, leaveGroup, deleteGroup, joinCompetition, leaveCompetition, moveCompetitionToGroup, createCompetition, joinByInviteCode, inviteCodeFrom };
