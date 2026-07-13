// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { X } from "lucide-react";

// ---------- scoring helpers ----------
// Simpelt, straffrit pointsystem:
//   +3 korrekt resultat · +1 korrekt udfald · 0 forkert gæt
function outcome(h, a) { return h === a ? "X" : h > a ? "1" : "2"; }
function pointsFor(pred, actual, rules) {
  if (!pred
    || actual.home_score == null || actual.away_score == null
    || pred.pred_home == null || pred.pred_away == null) return null;

  const exact = rules?.exact ?? 3;
  const out = rules?.outcome ?? 1;

  if (pred.pred_home === actual.home_score && pred.pred_away === actual.away_score) return exact;
  if (outcome(pred.pred_home, pred.pred_away) === outcome(actual.home_score, actual.away_score)) return out;
  return 0;
}
function roundLabel(key) {
  const start = new Date(key + "T12:00:00");
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const fmt = (x) => x.toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit" });
  return `${fmt(start)} – ${fmt(end)}`;
}
function groupIntoRounds(matches) {
  const map = {};
  for (const m of matches) { (map[m.round_key] ||= []).push(m); }
  return Object.keys(map).sort().map((key) => ({
    key, label: roundLabel(key),
    matches: map[key].slice().sort((a, b) => (a.kickoff_at || "").localeCompare(b.kickoff_at || "")),
  }));
}
// beholder kun kampe fra og med den første runde, der IKKE er helt afsluttet endnu
function filterFromNextUnfinishedRound(matches) {
  if (!matches.length) return matches;
  const byRound = {};
  for (const m of matches) { (byRound[m.round_key] ||= []).push(m); }
  const roundKeys = Object.keys(byRound).sort();
  const isRoundFinished = (key) => byRound[key].every((m) => m.home_score !== null && m.home_score !== undefined);
  const nextUnfinished = roundKeys.find((key) => !isRoundFinished(key));
  if (nextUnfinished === undefined) return [];
  return matches.filter((m) => m.round_key >= nextUnfinished);
}
// indeks for den runde, der indeholder i dag — eller den nærmeste kommende
function currentRoundIndex(rounds) {
  if (!rounds.length) return 0;
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < rounds.length; i++) {
    const end = new Date(rounds[i].key + "T12:00:00");
    end.setDate(end.getDate() + 6);
    if (end.toISOString().slice(0, 10) >= today) return i;
  }
  return rounds.length - 1;
}
function formatKickoff(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("da-DK", { weekday: "short", day: "2-digit", month: "2-digit" }) + " kl. " +
    d.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });
}
function isLocked(match) {
  if (match.home_score !== null && match.home_score !== undefined) return true;
  if (!match.kickoff_at) return false;
  const lockAt = new Date(match.kickoff_at).getTime() - 60 * 60 * 1000; // 1 time før kickoff
  return Date.now() >= lockAt;
}

export { outcome, pointsFor, roundLabel, groupIntoRounds, filterFromNextUnfinishedRound, currentRoundIndex, formatKickoff, isLocked };
