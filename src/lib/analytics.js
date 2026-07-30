// Analytics v1 — internt måle-lag. Spec: docs/features/analytics-v1.md
//
// KONTRAKT FOR HELE DENNE FIL: intet kaster, intet afventes, intet blokerer.
// Fejler en logning, sker der ingenting — præcis som touchActivity() i
// data.js. user_id sættes af databasen (kolonnens default er auth.uid()),
// ALDRIG af klienten, så det hverken kan glemmes eller forfalskes.
//
// Ny fil frem for endnu en funktion i data.js (747 linjer, allerede noteret
// som teknisk gæld i DOCUMENTATION.md §12 — én ren splitning frem for at
// gøre gælden større). Denne fils funktioner adlyder en kontrakt intet andet
// i data.js gør (aldrig kastende, aldrig afventet), så det er værd at kunne
// auditere i én fil for sig. loadUserStats bliver bevidst i data.js — at
// flytte den ville røre AdminScreen-imports uden nogen gevinst.
import { restFetch } from "./supabase.js";

// Navigations-hændelser (opened_*) throttles, så hurtig fane-skift eller
// React StrictMode's dobbelt-render i dev ikke tredobler tallene. Writes
// (prediction_saved m.fl.) er IKKE throttlet — de er reelt gentagne, og hver
// af dem tæller mod North Star-metrikken.
const NAV_THROTTLE_MS = 20000;
const lastFired = new Map();   // "name|groupId|competitionId" -> timestamp
const firedOnce = new Set();   // "name|key" — impressions, én gang pr. sideliv

function post(token, name, groupId, competitionId, metadata) {
  restFetch(`/rest/v1/analytics_events`, {
    method: "POST",
    token,
    body: [{
      event_name: name,
      group_id: groupId || null,
      competition_id: competitionId || null,
      metadata: metadata || {},
    }],
    prefer: "return=minimal",
  }).catch(() => {}); // sporing må aldrig kaste en uhåndteret rejection
}

// Log et event. Kaldes ALTID efter at det primære write er lykkedes (aldrig
// inde i det primære try, aldrig awaited) — se instrumenterings-tabellen i
// docs/features/analytics-v1.md for hvert kaldested.
function logEvent(token, name, { groupId = null, competitionId = null, metadata = null } = {}) {
  try {
    if (!token || !name) return;
    if (name.startsWith("opened_")) {
      const k = `${name}|${groupId || ""}|${competitionId || ""}`;
      const now = Date.now();
      if (now - (lastFired.get(k) || 0) < NAV_THROTTLE_MS) return;
      lastFired.set(k, now);
    }
    post(token, name, groupId, competitionId, metadata);
  } catch (e) { /* sporing må aldrig påvirke brugeren */ }
}

// Som logEvent, men kun én gang pr. unik nøgle for hele sidens levetid —
// til impressions (story_viewed), som ellers ville blive talt flere gange,
// når en komponent remounter (fx faneskift frem og tilbage til Hjem).
function logEventOnce(token, name, key, opts) {
  try {
    const k = `${name}|${key}`;
    if (firedOnce.has(k)) return;
    firedOnce.add(k);
    logEvent(token, name, opts);
  } catch (e) { /* sporing må aldrig påvirke brugeren */ }
}

// ---------- Dashboard: read-helpers ----------
// Modsat logEvent* KASTER disse (samme mønster som loadUserStats/
// loadCareerProfile) — AnalyticsPanel fanger fejl pr. sektion, så én langsom
// eller fejlende sektion ikke blokerer de tre andre.
const loadAnalyticsHealth = (token, days = 30) =>
  restFetch(`/rest/v1/rpc/admin_analytics_health`, { method: "POST", token, body: { p_days: days } });

const loadAnalyticsEngagement = (token, days = 30) =>
  restFetch(`/rest/v1/rpc/admin_analytics_engagement`, { method: "POST", token, body: { p_days: days } });

const loadAnalyticsLeagueHealth = (token, days = 30) =>
  restFetch(`/rest/v1/rpc/admin_analytics_league_health`, { method: "POST", token, body: { p_days: days } });

const loadAnalyticsRetention = (token) =>
  restFetch(`/rest/v1/rpc/admin_analytics_retention`, { method: "POST", token, body: {} });

// Ren funktion (testbar uden DOM): 0-100 → farve + ord. Farve er ALDRIG
// eneste signal (samme regel som ModeBars følger for CVD) — HealthBar viser
// altid tallet og ordet ved siden af.
function healthTone(score) {
  if (score === null || score === undefined) return { label: "For ny", color: null };
  if (score >= 70) return { label: "Sund", color: "green" };
  if (score >= 40) return { label: "Svag", color: "gold" };
  return { label: "Kritisk", color: "red" };
}

export {
  logEvent, logEventOnce, healthTone,
  loadAnalyticsHealth, loadAnalyticsEngagement, loadAnalyticsLeagueHealth, loadAnalyticsRetention,
};
