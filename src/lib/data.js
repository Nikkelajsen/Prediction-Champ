// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { db, restFetch } from "./supabase.js";
import { currentRoundIndex, groupIntoRounds, isLocked, outcome, pointsFor, roundLabel } from "./scoring.js";

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

  const rows = profiles.map((p) => {
    let total = 0;
    let exactCount = 0;
    let outcomeCount = 0;
    const perRound = {};
    for (const round of rounds) {
      let rTotal = 0;
      let rPlayed = false;
      for (const m of round.matches) {
        const pred = predsByKey.get(`${m.id}:${p.id}`);
        const pts = pointsFor(pred, m, rules);
        if (pts !== null) {
          rTotal += pts; rPlayed = true;
          if (pred && pred.pred_home === m.home_score && pred.pred_away === m.away_score) exactCount++;
          else if (pts === rules.outcome) outcomeCount++;
        }
      }
      if (rPlayed) perRound[round.key] = rTotal;
      total += rTotal;
    }
    const form3 = playedKeys.slice(-3).reduce((s, k) => s + (perRound[k] ?? 0), 0);
    const prevTotal = lastKey !== undefined ? total - (perRound[lastKey] ?? 0) : total;
    return { userId: p.id, player: p.display_name, total, perRound, exactCount, outcomeCount, form3, prevTotal };
  }).sort((a, b) => b.total - a.total || b.exactCount - a.exactCount || b.outcomeCount - a.outcomeCount);

  if (playedKeys.length >= 2) {
    const prevOrder = rows.slice().sort((a, b) => b.prevTotal - a.prevTotal);
    const prevRank = new Map(prevOrder.map((r, i) => [r.player, i]));
    rows.forEach((r, i) => { r.rankDelta = (prevRank.get(r.player) ?? i) - i; });
  }

  const totalMatches = ms.length;
  const playedMatches = ms.filter((m) => m.home_score !== null && m.home_score !== undefined).length;
  const isComplete = totalMatches > 0 && playedMatches === totalMatches;

  return { userId: undefined, rows, rounds: playedRounds, allRounds: rounds, predsByKey, totalMatches, playedMatches, isComplete };
}

// ---------- global rating + monthly league (scope 'ALL') ----------
async function loadRatingBoard(token) {
  const ratings = await db.select(token, "ratings", `scope=eq.ALL&select=user_id,rating,rounds_played,provisional&order=rating.desc`);
  if (!ratings.length) return [];
  const ids = ratings.map((r) => r.user_id);
  const profiles = await db.select(token, "profiles", `id=in.(${ids.join(",")})&select=id,display_name`);
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));
  return ratings.map((r) => ({
    userId: r.user_id,
    player: nameById.get(r.user_id) || "—",
    rating: Math.round(Number(r.rating)),
    roundsPlayed: r.rounds_played,
    provisional: r.provisional,
  }));
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
  } catch (e) {
    return new Map();
  }
}

function currentMonthKey() { return new Date().toISOString().slice(0, 7); }

async function loadMonthlyBoard(token, month) {
  const rows = await db.select(token, "monthly_standings",
    `month=eq.${month}&scope=eq.ALL&select=user_id,total_points,matches,exact_count&order=total_points.desc,exact_count.desc`);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.user_id);
  const profiles = await db.select(token, "profiles", `id=in.(${ids.join(",")})&select=id,display_name`);
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));
  return rows.map((r) => ({
    userId: r.user_id,
    player: nameById.get(r.user_id) || "—",
    total: r.total_points, matches: r.matches, exactCount: r.exact_count,
  }));
}

async function loadMonthsAvailable(token) {
  const rows = await db.select(token, "monthly_standings", `scope=eq.ALL&select=month`);
  return [...new Set(rows.map((r) => r.month))].sort().reverse();
}

// ---------- Rundeliga: samlede point for én enkelt spillerunde (round_key) ----------
// Samme princip som månedsligaen: alle er automatisk med, på tværs af alle ligaer,
// hver kamp tælles én gang. Beregnet i appen; kun spillede (låste) kampe tæller.
async function loadRoundsAvailable(token) {
  const rows = await db.select(token, "matches", `home_score=not.is.null&select=round_key`);
  return [...new Set(rows.map((r) => r.round_key))].sort().reverse();
}
async function loadRoundBoard(token, roundKey) {
  const ms = await db.select(token, "matches", `round_key=eq.${roundKey}&select=id,home_score,away_score`);
  if (!ms.length) return { rows: [], totalMatches: 0, playedMatches: 0, isComplete: false };
  const matchIds = ms.map((m) => m.id);
  const preds = await db.select(token, "predictions", `match_id=in.(${matchIds.join(",")})&select=user_id,match_id,pred_home,pred_away`);
  const matchById = new Map(ms.map((m) => [m.id, m]));
  const rules = { exact: 3, outcome: 1 };
  const byUser = {};
  for (const p of preds) {
    const m = matchById.get(p.match_id);
    if (!m || m.home_score == null || m.away_score == null) continue; // kun spillede kampe
    const pts = pointsFor(p, m, rules);
    if (pts == null) continue;
    const u = (byUser[p.user_id] ||= { total: 0, exactCount: 0, matches: 0 });
    u.total += pts; u.matches += 1;
    if (p.pred_home === m.home_score && p.pred_away === m.away_score) u.exactCount++;
  }
  const userIds = Object.keys(byUser);
  const profiles = userIds.length ? await db.select(token, "profiles", `id=in.(${userIds.join(",")})&select=id,display_name`) : [];
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));
  const rows = userIds.map((uid) => ({ userId: uid, player: nameById.get(uid) || "—", ...byUser[uid] }))
    .sort((a, b) => b.total - a.total || b.exactCount - a.exactCount);
  const playedMatches = ms.filter((m) => m.home_score != null && m.away_score != null).length;
  return { rows, totalMatches: ms.length, playedMatches, isComplete: ms.length > 0 && playedMatches === ms.length };
}

// ---------- Sæsonchampionship: samlede point for hele en ligas sæson ----------
// Beregnet i appen: alle er automatisk med (alle der har tippet en kamp i sæsonen).
// Kun spillede kampe tæller — de er altid låste, så alles gæt kan læses (RLS).
async function loadSeasonBoard(token, leagueId) {
  const seasons = await db.select(token, "seasons", `league_id=eq.${leagueId}&select=id,name,start_date&order=start_date.desc&limit=1`);
  if (!seasons.length) return null;
  const season = seasons[0];
  const ms = await db.select(token, "matches", `season_id=eq.${season.id}&select=id,round_key,home_score,away_score`);
  if (!ms.length) return { season, rows: [], totalMatches: 0, playedMatches: 0, isComplete: false };
  const matchIds = ms.map((m) => m.id);
  const preds = await db.select(token, "predictions", `match_id=in.(${matchIds.join(",")})&select=user_id,match_id,pred_home,pred_away`);
  const matchById = new Map(ms.map((m) => [m.id, m]));
  const rules = { exact: 3, outcome: 1 };
  const byUser = {};
  for (const p of preds) {
    const m = matchById.get(p.match_id);
    if (!m || m.home_score == null || m.away_score == null) continue; // kun spillede kampe
    const pts = pointsFor(p, m, rules);
    if (pts == null) continue;
    const u = (byUser[p.user_id] ||= { total: 0, exactCount: 0, matches: 0 });
    u.total += pts; u.matches += 1;
    if (p.pred_home === m.home_score && p.pred_away === m.away_score) u.exactCount++;
  }
  const userIds = Object.keys(byUser);
  const profiles = userIds.length ? await db.select(token, "profiles", `id=in.(${userIds.join(",")})&select=id,display_name`) : [];
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));
  const rows = userIds.map((uid) => ({ userId: uid, player: nameById.get(uid) || "—", ...byUser[uid] }))
    .sort((a, b) => b.total - a.total || b.exactCount - a.exactCount);
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
  const teamIds = [...new Set(ms.flatMap((m) => [m.home_team_id, m.away_team_id]).filter(Boolean))];
  const teams = teamIds.length ? await db.select(token, "teams", `id=in.(${teamIds.join(",")})&select=id,name`) : [];
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const preds = await db.select(token, "predictions", `match_id=in.(${ids.join(",")})&user_id=eq.${userId}&select=match_id,pred_home,pred_away`);
  const predByMatch = new Map(preds.map((p) => [p.match_id, p]));

  // rullende vindue: en kamp er "ikke åben endnu", hvis ALLE konkurrencer, den indgår i, har openDaysBefore
  const opensAt = (m) => {
    const cids = matchComps[m.id] || [];
    const cs = cids.map((id) => competitions.find((c) => c.id === id)).filter(Boolean);
    if (!cs.length) return false;
    const w = cs.map((c) => c.rules?.openDaysBefore || 0);
    if (w.some((x) => !x)) return false;
    const md = Math.max(...w);
    return Date.now() < new Date(m.kickoff_at).getTime() - md * 24 * 3600 * 1000;
  };
  const now = Date.now();
  const played = (m) => m.home_score !== null && m.home_score !== undefined;

  const tippable = ms.filter((m) => !played(m) && !isLocked(m) && !opensAt(m) && m.kickoff_at);
  const isTipped = (m) => { const p = predByMatch.get(m.id); return !!(p && p.pred_home != null && p.pred_away != null); };
  const allOk = () => {
    const future = ms.filter((m) => !played(m) && m.kickoff_at && new Date(m.kickoff_at).getTime() > now)
      .sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));
    return { hasComps: true, allTipped: true, nextOpen: future[0]?.kickoff_at || null };
  };

  // "Næste runde" = den TIDLIGSTE runde, der stadig har kampe man kan tippe. Vi viser
  // KUN status for den runde: er den fuldt tippet, er alt ok (grøn) — også selvom senere
  // runder mangler tips (de bliver "næste runde" i tur, efterhånden som runderne spilles).
  // (Før valgte vi den tidligste UTIPPEDE kamp, så en runde langt ude kunne fejlagtigt
  // vise rødt, selvom de nærmeste runder var tippet.)
  if (!tippable.length) return allOk();
  const nextRoundKey = tippable.reduce((min, m) => (m.round_key < min ? m.round_key : min), tippable[0].round_key);
  const roundUntipped = tippable.filter((m) => m.round_key === nextRoundKey && !isTipped(m))
    .sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));
  if (!roundUntipped.length) return allOk();

  const deadline = Math.min(...roundUntipped.map((m) => new Date(m.kickoff_at).getTime() - 3600 * 1000));
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
    const inProgress = !played && m.kickoff_at && new Date(m.kickoff_at).getTime() <= Date.now();
    return {
      id: m.id,
      home: teamName.get(m.home_team_id) || "?",
      away: teamName.get(m.away_team_id) || "?",
      homeScore: m.home_score, awayScore: m.away_score,
      kickoff: m.kickoff_at, played, inProgress, pred, points,
    };
  });
  return {
    roundKey: round.key, roundLabelText: round.label,
    matches, myPoints, playedCount, totalCount: round.matches.length,
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
  } catch (e) { /* ignorer — sporing er best-effort */ }
}

// loadUserStats: henter aggregeret brugerstatistik. RPC'en er admin-kun (security
// definer med is_admin-guard) og returnerer alle nøgletal + kurver i ét kald.
async function loadUserStats(token) {
  return restFetch(`/rest/v1/rpc/admin_user_stats`, { method: "POST", token, body: {} });
}

export { computeCompetitionState, loadRatingBoard, loadRatingMap, loadRatingHistory, currentMonthKey, loadMonthlyBoard, loadMonthsAvailable, loadRoundsAvailable, loadRoundBoard, loadSeasonBoard, computeHomeTips, computeCurrentRound, daFullDate, fmtCountdown, monthName, touchActivity, loadUserStats };
