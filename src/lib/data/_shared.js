// Fælles byggesten for data-modulerne: tiebreaker-rækkefølgen som PostgREST
// forstår den, og de to små hjælpere, der former en stillingsrække.
//
// Ligger for sig selv, fordi både stillinger, hjem-fanen og karriereprofilen
// bruger dem — ikke fordi de hører logisk sammen med noget bestemt.

import { avgGoalError } from "../standings.js";

// Tiebreaker-stigen som PostgREST-order: point → præcise → udfald → rundesejre →
// målafvigelse, og til sidst user_id som skjult, stabil nøgle (afgør aldrig en
// placering — den sikrer bare, at rækker ikke bytter plads mellem to hentninger).
// Stigen selv bor i src/lib/standings.js; kolonnerne i sql/standings_tiebreakers.sql.
const TIEBREAK_ORDER = "total_points.desc,exact_count.desc,outcome_count.desc,round_wins.desc,avg_goal_error.asc,user_id.asc";
// Rundechampionshippet ér én runde og har derfor ingen rundesejre at bryde lighed med.
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

export { TIEBREAK_ORDER, TIEBREAK_ORDER_ROUND, roundRow, without };
