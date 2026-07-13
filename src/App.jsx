import { useState, useEffect, useMemo } from "react";
import {
  Home, Users, Trophy, TrendingUp, ChevronRight, ChevronLeft, Clock,
  Plus, Crown, ArrowUp, ArrowDown, Minus, Archive, Trash2, Copy, Check,
  RefreshCw, Loader2, LogOut, Info, CalendarDays, ClipboardList, X, Settings,
} from "lucide-react";

// ================================================================
//  DATA-LAG (bevaret 1:1 fra tidligere version — ingen ændringer i
//  database, scoring, rating eller konkurrence-logik)
// ================================================================

// ---------- Supabase config ----------
const SUPABASE_URL = "https://qfcjbpvttburccdyfnkx.supabase.co";
const SUPABASE_KEY = "sb_publishable_Et9Dahm8LOhZk6cS1XRqhA_9RuNmnvC";

// ---------- tiny REST helpers (no SDK needed) ----------
async function restFetch(path, { method = "GET", body, token, prefer } = {}) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${token || SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).message || msg; } catch (e) {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
const db = {
  select: (token, table, query = "") => restFetch(`/rest/v1/${table}?${query}`, { token }),
  insert: (token, table, rows) =>
    restFetch(`/rest/v1/${table}`, { method: "POST", token, body: rows, prefer: "return=representation" }),
  upsert: (token, table, rows, onConflict) =>
    restFetch(`/rest/v1/${table}${onConflict ? `?on_conflict=${onConflict}` : ""}`, {
      method: "POST", token, body: rows, prefer: "resolution=merge-duplicates,return=representation",
    }),
  update: (token, table, query, patch) =>
    restFetch(`/rest/v1/${table}?${query}`, { method: "PATCH", token, body: patch, prefer: "return=representation" }),
  del: (token, table, query) =>
    restFetch(`/rest/v1/${table}?${query}`, { method: "DELETE", token, prefer: "return=minimal" }),
};
const auth = {
  signUp: (email, password) =>
    restFetch(`/auth/v1/signup`, { method: "POST", body: { email, password } }),
  signIn: (email, password) =>
    restFetch(`/auth/v1/token?grant_type=password`, { method: "POST", body: { email, password } }),
  refresh: (refresh_token) =>
    restFetch(`/auth/v1/token?grant_type=refresh_token`, { method: "POST", body: { refresh_token } }),
  recover: (email) =>
    restFetch(`/auth/v1/recover`, { method: "POST", body: { email } }),
  updatePassword: (accessToken, password) =>
    restFetch(`/auth/v1/user`, { method: "PUT", token: accessToken, body: { password } }),
  checkUsername: (name) =>
    restFetch(`/rest/v1/rpc/username_available`, { method: "POST", body: { name } }),
};
const SESSION_KEY = "pc_session";
function saveSession(session) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {}
}
function loadSession() {
  try { const raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
}

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
  const untipped = tippable.filter((m) => {
    const p = predByMatch.get(m.id);
    return !(p && p.pred_home != null && p.pred_away != null);
  });

  if (!untipped.length) {
    const future = ms.filter((m) => !played(m) && m.kickoff_at && new Date(m.kickoff_at).getTime() > now)
      .sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));
    return { hasComps: true, allTipped: true, nextOpen: future[0]?.kickoff_at || null };
  }

  untipped.sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));
  const roundKey = untipped[0].round_key;
  const roundUntipped = untipped.filter((m) => m.round_key === roundKey);
  const deadline = Math.min(...roundUntipped.map((m) => new Date(m.kickoff_at).getTime() - 3600 * 1000));
  const names = roundUntipped.slice(0, 3).map((m) => `${teamName.get(m.home_team_id) || "?"} – ${teamName.get(m.away_team_id) || "?"}`);
  return { hasComps: true, allTipped: false, roundKey, roundLabelText: roundLabel(roundKey), deadline, missingCount: roundUntipped.length, names };
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

// ================================================================
//  DESIGN-SYSTEM (fra mockup)
// ================================================================
const C = {
  bg: "#0C1622",
  surface: "#14212F",
  surface2: "#1B2C3E",
  line: "#24374C",
  text: "#EDF3F8",
  muted: "#8CA0B3",
  green: "#22C55E",
  gold: "#F0B429",
  red: "#EF5B5B",
};
const font = {
  display: "'Barlow Condensed', sans-serif",
  body: "'Barlow', 'Inter', sans-serif",
};

// ---------- små byggeklodser ----------
const Card = ({ children, style, onClick }) => (
  <div
    onClick={onClick}
    style={{
      background: C.surface,
      border: `1px solid ${C.line}`,
      borderRadius: 14,
      padding: 16,
      cursor: onClick ? "pointer" : "default",
      ...style,
    }}
  >
    {children}
  </div>
);
const Eyebrow = ({ children }) => (
  <div style={{
    fontFamily: font.display, textTransform: "uppercase",
    letterSpacing: "0.12em", fontSize: 13, color: C.muted, marginBottom: 8,
  }}>
    {children}
  </div>
);
const H = ({ children, size = 26 }) => (
  <div style={{
    fontFamily: font.display, textTransform: "uppercase",
    fontWeight: 700, fontSize: size, lineHeight: 1.1, color: C.text,
  }}>
    {children}
  </div>
);
// Form guide dots — grønne = stærk runde, gul = middel, grå = svag
const FormDots = ({ form }) => (
  <span style={{ display: "inline-flex", gap: 3 }}>
    {(form || []).map((f, i) => (
      <span key={i} style={{
        width: 7, height: 7, borderRadius: "50%",
        background: f === 2 ? C.green : f === 1 ? C.gold : C.line,
      }} />
    ))}
  </span>
);
const Move = ({ d }) => {
  if (d > 0) return <span style={{ color: C.green, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 2 }}><ArrowUp size={12} />{d}</span>;
  if (d < 0) return <span style={{ color: C.red, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 2 }}><ArrowDown size={12} />{Math.abs(d)}</span>;
  return <span style={{ color: C.muted, fontSize: 12 }}><Minus size={12} /></span>;
};

// ---------- generisk modal ----------
function Modal({ title, children, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, width: "100%",
        maxWidth: 420, maxHeight: "85vh", overflowY: "auto", padding: 18,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontFamily: font.display, textTransform: "uppercase", fontWeight: 700, fontSize: 18 }}>{title}</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", padding: 0 }}><X size={20} /></button>
        </div>
        <div style={{ color: C.text, fontSize: 14, lineHeight: 1.5 }}>{children}</div>
      </div>
    </div>
  );
}
// ⓘ-ikon der åbner en kontekstuel forklaring (Fase 5A)
function InfoDot({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Forklaring" style={{
        background: "none", border: "none", cursor: "pointer", color: C.muted,
        padding: 0, display: "inline-flex", alignItems: "center", verticalAlign: "middle",
      }}>
        <Info size={15} />
      </button>
      {open && <Modal title={title} onClose={() => setOpen(false)}>{children}</Modal>}
    </>
  );
}

// ---------- fælles knap-styles (nyt tema) ----------
const btnGreen = {
  width: "100%", padding: "10px 0", borderRadius: 10, border: "none",
  background: C.green, color: "#06110A", fontWeight: 700, fontSize: 15, fontFamily: font.body, cursor: "pointer",
};
const btnGhost = {
  display: "inline-flex", alignItems: "center", gap: 6, background: C.surface2,
  border: `1px solid ${C.line}`, color: C.text, borderRadius: 10,
  padding: "8px 12px", fontSize: 13, fontFamily: font.body, cursor: "pointer",
};
const btnGold = {
  display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(240,180,41,0.12)",
  border: `1px solid ${C.gold}`, color: C.gold, borderRadius: 10,
  padding: "8px 12px", fontSize: 13, fontWeight: 700, fontFamily: font.body, cursor: "pointer",
};
const chip = (active) => ({
  padding: "4px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer", fontFamily: font.body, fontWeight: 600,
  border: `1px solid ${active ? C.green : C.line}`,
  background: active ? "rgba(34,197,94,0.12)" : "transparent",
  color: active ? C.green : C.muted,
});
const muted = { color: C.muted, fontSize: 13, margin: "0 0 10px 0", lineHeight: 1.5 };
const fieldFull = { width: "100%", marginBottom: 10, display: "block" };

// ================================================================
//  APP ROOT
// ================================================================
export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [booting, setBooting] = useState(true);
  const [recoveryToken, setRecoveryToken] = useState(null);
  const [pendingJoinCode, setPendingJoinCode] = useState(null);

  async function completeAuth({ access_token, refresh_token, user }, chosenUsername) {
    try {
      if (chosenUsername) {
        const rows = await db.upsert(access_token, "profiles", [{ id: user.id, display_name: chosenUsername }], "id");
        setProfile(rows[0]);
      } else {
        const rows = await db.select(access_token, "profiles", `id=eq.${user.id}&select=*`);
        setProfile(rows[0] || null);
      }
    } catch (e) {
      const rows = await db.select(access_token, "profiles", `id=eq.${user.id}&select=*`);
      setProfile(rows[0] || null);
    }
    setSession({ access_token, refresh_token, user });
    saveSession({ refresh_token, user });
  }

  function handleLogout() {
    setSession(null); setProfile(null); clearSession();
  }

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hash.get("type") === "recovery" && hash.get("access_token")) {
      setRecoveryToken(hash.get("access_token"));
      setBooting(false);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const join = params.get("join");
    if (join) setPendingJoinCode(join);

    (async () => {
      const saved = loadSession();
      if (saved?.refresh_token) {
        try {
          const res = await auth.refresh(saved.refresh_token);
          await completeAuth(res, null);
        } catch (e) {
          clearSession();
        }
      }
      setBooting(false);
    })();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!session?.refresh_token) return;
    const id = setInterval(async () => {
      try {
        const res = await auth.refresh(session.refresh_token);
        setSession((s) => ({ ...s, access_token: res.access_token, refresh_token: res.refresh_token }));
        saveSession({ refresh_token: res.refresh_token, user: session.user });
      } catch (e) { /* ignorer */ }
    }, 45 * 60 * 1000);
    return () => clearInterval(id);
  }, [session?.refresh_token]); // eslint-disable-line

  if (recoveryToken) {
    return (
      <>
        <style>{globalCss}</style>
        <ResetPasswordScreen accessToken={recoveryToken} onDone={() => {
          window.location.hash = "";
          setRecoveryToken(null);
        }} />
      </>
    );
  }

  if (booting) {
    return (
      <div style={wrapOuter}>
        <style>{globalCss}</style>
        <div style={{ display: "flex", gap: 10, color: C.muted, alignItems: "center", paddingTop: 60 }}>
          <Loader2 className="spin" size={20} />Henter …
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{globalCss}</style>
      {!session ? (
        <AuthScreen onAuthed={completeAuth} booting={false} />
      ) : (
        <MainApp session={session} profile={profile} onLogout={handleLogout}
          pendingJoinCode={pendingJoinCode} clearPendingJoinCode={() => setPendingJoinCode(null)} />
      )}
    </>
  );
}

// ================================================================
//  RESET PASSWORD / AUTH
// ================================================================
function AuthShell({ children }) {
  return (
    <div style={{ ...wrapOuter, alignItems: "flex-start" }}>
      <div style={{ width: "100%", maxWidth: 430, padding: "60px 18px", display: "flex", justifyContent: "center" }}>
        <Card style={{ width: 320 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Crown size={18} color={C.gold} />
            <span style={{ fontFamily: font.display, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 16 }}>
              Prediction Champ
            </span>
          </div>
          {children}
        </Card>
      </div>
    </div>
  );
}

function ResetPasswordScreen({ accessToken, onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setError("");
    if (password.length < 6) { setError("Adgangskoden skal være mindst 6 tegn"); return; }
    if (password !== confirm) { setError("Adgangskoderne er ikke ens"); return; }
    setLoading(true);
    try {
      await auth.updatePassword(accessToken, password);
      setDone(true);
    } catch (e) {
      setError(e.message || "Noget gik galt");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <p style={muted}>Vælg et nyt kodeord til din konto.</p>
      {done ? (
        <>
          <p style={{ color: C.green, fontSize: 14 }}>Kodeord opdateret! Du kan nu logge ind.</p>
          <button style={btnGreen} onClick={onDone}>Til login</button>
        </>
      ) : (
        <>
          <input className="field" style={fieldFull} type="password" placeholder="Nyt kodeord" value={password} onChange={(e) => setPassword(e.target.value)} />
          <input className="field" style={fieldFull} type="password" placeholder="Gentag kodeord" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {error && <p style={{ color: C.red, fontSize: 13 }}>{error}</p>}
          <button style={btnGreen} onClick={submit} disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : "Gem nyt kodeord"}
          </button>
        </>
      )}
    </AuthShell>
  );
}

function AuthScreen({ onAuthed, booting }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(""); setInfo(""); setLoading(true);
    try {
      if (mode === "signup") {
        if (!username.trim()) { setError("Vælg et brugernavn"); setLoading(false); return; }
        const available = await auth.checkUsername(username.trim());
        if (!available) { setError("Brugernavnet er allerede taget. Vælg et andet."); setLoading(false); return; }
        const res = await auth.signUp(email, password);
        if (res.access_token) { await onAuthed(res, username.trim()); return; }
        setInfo("Konto oprettet. Tjek om der kræves e-mail-bekræftelse i Supabase-projektet, log derefter ind.");
        setMode("signin");
      } else if (mode === "forgot") {
        await auth.recover(email);
        setInfo("Hvis e-mailen findes, er der sendt et link til at nulstille kodeordet.");
      } else {
        const res = await auth.signIn(email, password);
        await onAuthed(res);
      }
    } catch (e) {
      setError(e.message || "Noget gik galt");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <p style={muted}>{mode === "signin" ? "Log ind" : mode === "signup" ? "Opret konto" : "Nulstil kodeord"}</p>
      {mode === "signup" && (
        <input className="field" style={fieldFull} placeholder="Brugernavn (vises for andre)" value={username} onChange={(e) => setUsername(e.target.value)} />
      )}
      <input className="field" style={fieldFull} placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
      {mode !== "forgot" && (
        <input className="field" style={fieldFull} type="password" placeholder="Adgangskode" value={password} onChange={(e) => setPassword(e.target.value)} />
      )}
      {error && <p style={{ color: C.red, fontSize: 13 }}>{error}</p>}
      {info && <p style={{ color: C.green, fontSize: 13 }}>{info}</p>}
      <button style={btnGreen} onClick={submit} disabled={loading || booting}>
        {loading || booting ? <Loader2 size={16} className="spin" /> : mode === "signin" ? "Log ind" : mode === "signup" ? "Opret konto" : "Send nulstillingslink"}
      </button>
      {mode === "signin" && (
        <p style={{ ...muted, marginTop: 12, textAlign: "center", cursor: "pointer" }}
          onClick={() => { setMode("forgot"); setError(""); setInfo(""); }}>
          Glemt kodeord?
        </p>
      )}
      <p style={{ ...muted, marginTop: 6, marginBottom: 0, textAlign: "center", cursor: "pointer" }}
        onClick={() => { setMode(mode === "signup" ? "signin" : mode === "forgot" ? "signin" : "signup"); setError(""); setInfo(""); }}>
        {mode === "signup" ? "Har du allerede en konto? Log ind" : mode === "forgot" ? "Tilbage til login" : "Ny bruger? Opret konto"}
      </p>
    </AuthShell>
  );
}

// ================================================================
//  MAIN APP (logget ind) — 4-fane bundnavigation
// ================================================================
function MainApp({ session, profile, onLogout, pendingJoinCode, clearPendingJoinCode }) {
  const token = session.access_token;
  const userId = session.user.id;
  const isAdmin = !!profile?.is_admin;

  const [tab, setTab] = useState("hjem");
  const [screen, setScreen] = useState(null); // null | {type, ...params}
  const [loading, setLoading] = useState(true);
  const [leagues, setLeagues] = useState([]);
  const [competitions, setCompetitions] = useState([]);

  async function loadLeagues() {
    const ls = await db.select(token, "leagues", "select=*&order=name");
    setLeagues(ls);
    return ls;
  }

  async function loadCompetitions() {
    const myComps = await db.select(token, "competition_participants", `user_id=eq.${userId}&select=competition_id,hidden`);
    if (myComps.length) {
      const hiddenMap = Object.fromEntries(myComps.map((c) => [c.competition_id, !!c.hidden]));
      const ids = myComps.map((c) => c.competition_id).join(",");
      const comps = await db.select(token, "competitions", `id=in.(${ids})&select=*`);
      const merged = comps.map((c) => ({ ...c, _hidden: hiddenMap[c.id] || false }));
      setCompetitions(merged);
      return merged;
    }
    setCompetitions([]);
    return [];
  }

  async function loadAll() {
    setLoading(true);
    await loadLeagues();
    await loadCompetitions();
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []); // eslint-disable-line

  useEffect(() => {
    if (!pendingJoinCode) return;
    (async () => {
      try {
        const found = await db.select(token, "competitions", `invite_code=eq.${pendingJoinCode}&select=*`);
        if (found.length) {
          const already = await db.select(token, "competition_participants", `competition_id=eq.${found[0].id}&user_id=eq.${userId}&select=competition_id`);
          if (!already.length) {
            await db.insert(token, "competition_participants", [{ competition_id: found[0].id, user_id: userId }]);
          }
          await loadCompetitions();
          setTab("ligaer");
          setScreen({ type: "predictions", compFilter: found[0].id });
        }
      } catch (e) { /* ignorer */ }
      clearPendingJoinCode();
      const url = new URL(window.location.href);
      url.searchParams.delete("join");
      window.history.replaceState({}, "", url.toString());
    })();
  }, [pendingJoinCode]); // eslint-disable-line

  const visibleLeagues = leagues.filter((l) => l.is_visible !== false);

  // navigations-hjælpere
  const goTab = (t) => { setScreen(null); setTab(t); };
  const openBoard = (compId) => setScreen({ type: "board", compId });
  const openPredictions = (compFilter = "all", roundKey = null) => setScreen({ type: "predictions", compFilter, roundKey });
  const openCreate = () => setScreen({ type: "create" });
  const openAdmin = () => setScreen({ type: "admin" });
  const openHow = () => setScreen({ type: "how" });

  const tabs = [
    { id: "hjem", label: "Hjem", icon: Home },
    { id: "ligaer", label: "Ligaer", icon: Users },
    { id: "championship", label: "Championship", icon: Trophy },
    { id: "rating", label: "Rating", icon: TrendingUp },
  ];

  let body;
  if (loading) {
    body = (
      <div style={{ display: "flex", gap: 10, color: C.muted, alignItems: "center", paddingTop: 40 }}>
        <Loader2 className="spin" size={20} />Henter data …
      </div>
    );
  } else if (screen?.type === "board") {
    body = <BoardScreen token={token} userId={userId} competitions={competitions.filter((c) => !c._hidden)}
      initialCompId={screen.compId} onBack={() => setScreen(null)} goToPredictions={openPredictions} />;
  } else if (screen?.type === "predictions") {
    body = <PredictionsScreen token={token} userId={userId} competitions={competitions.filter((c) => !c._hidden)}
      initialFilter={screen.compFilter} onBack={() => setScreen(null)} />;
  } else if (screen?.type === "create") {
    body = <CreateCompetitionScreen token={token} userId={userId} leagues={visibleLeagues}
      onBack={() => setScreen(null)} onCreated={async () => { await loadCompetitions(); }} openBoard={openBoard} />;
  } else if (screen?.type === "admin") {
    body = <AdminScreen token={token} leagues={leagues} reloadLeagues={loadLeagues} onBack={() => setScreen(null)} />;
  } else if (screen?.type === "how") {
    body = <HowItWorksScreen onBack={() => setScreen(null)} />;
  } else if (tab === "hjem") {
    body = <HjemTab token={token} userId={userId} profile={profile} competitions={competitions.filter((c) => !c._hidden)}
      goTab={goTab} openPredictions={openPredictions} openBoard={openBoard} />;
  } else if (tab === "ligaer") {
    body = <LigaerTab token={token} userId={userId} competitions={competitions}
      openBoard={openBoard} openCreate={openCreate} reload={loadAll} />;
  } else if (tab === "championship") {
    body = <ChampionshipTab token={token} userId={userId} />;
  } else if (tab === "rating") {
    body = <RatingTab token={token} userId={userId} />;
  }

  return (
    <div style={wrapOuter}>
      <div style={phone}>
        {/* Top brand bar */}
        <div style={{
          padding: "14px 18px 10px", display: "flex", alignItems: "center", gap: 8,
          borderBottom: `1px solid ${C.line}`,
        }}>
          <Crown size={17} color={C.gold} />
          <span style={{
            fontFamily: font.display, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.1em", fontSize: 15,
          }}>
            Prediction Champ
          </span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={openHow} aria-label="Sådan virker det" style={iconBtn}><Info size={18} /></button>
            {isAdmin && <button onClick={openAdmin} aria-label="Admin" style={iconBtn}><Settings size={18} /></button>}
            <button onClick={onLogout} aria-label="Log ud" style={iconBtn}><LogOut size={17} /></button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: "18px 18px 96px", overflowY: "auto" }}>
          {body}
        </div>

        {/* Bottom nav */}
        <div style={{
          position: "fixed", bottom: 0, width: "100%", maxWidth: 430,
          background: "rgba(12,22,34,0.96)", backdropFilter: "blur(8px)",
          borderTop: `1px solid ${C.line}`, display: "flex",
        }}>
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id && !screen;
            return (
              <button key={t.id} onClick={() => goTab(t.id)} style={{
                flex: 1, background: "none", border: "none", cursor: "pointer",
                padding: "10px 0 14px", display: "flex", flexDirection: "column",
                alignItems: "center", gap: 3,
                color: active ? C.green : C.muted, fontFamily: font.body,
              }}>
                <Icon size={21} strokeWidth={active ? 2.4 : 1.8} />
                <span style={{ fontSize: 10.5, fontWeight: active ? 700 : 500 }}>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
const iconBtn = { background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center" };

// ================================================================
//  FANE: HJEM
// ================================================================
function HjemTab({ token, userId, profile, competitions, goTab, openPredictions, openBoard }) {
  const [tips, setTips] = useState(null);
  const [snapshot, setSnapshot] = useState(null); // { rating, move, form, rank, total }
  const [placements, setPlacements] = useState(null); // [{ label, pos, gold, onClick }]
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // deadline / manglende tips
      try {
        const t = await computeHomeTips(token, userId, competitions);
        if (!cancelled) setTips(t);
      } catch (e) { if (!cancelled) setTips({ hasComps: competitions.length > 0, error: true }); }

      // rating-snapshot
      try {
        const [board, hist] = await Promise.all([loadRatingBoard(token), loadRatingHistory(token)]);
        const idx = board.findIndex((r) => r.userId === userId);
        if (!cancelled) {
          if (idx >= 0) {
            const me = board[idx];
            const h = hist.get(userId) || {};
            setSnapshot({ rating: me.rating, move: h.move || 0, form: h.form || [], rank: idx + 1, total: board.length, provisional: me.provisional });
          } else {
            setSnapshot({ none: true });
          }
        }
      } catch (e) { if (!cancelled) setSnapshot({ none: true }); }

      // placeringer: månedsliga + hver privat konkurrence
      try {
        const list = [];
        const monthly = await loadMonthlyBoard(token, currentMonthKey());
        const mIdx = monthly.findIndex((r) => r.userId === userId);
        if (mIdx >= 0) list.push({ label: "Månedsliga · " + monthName(currentMonthKey()), pos: `${mIdx + 1}.`, tab: "championship" });
        for (const c of competitions.filter((x) => !x._hidden)) {
          try {
            const state = await computeCompetitionState(token, c.id, c.rules || { exact: 3, outcome: 1 });
            const rIdx = state.rows.findIndex((r) => r.userId === userId);
            if (rIdx >= 0 && state.rows.length) list.push({ label: c.name, pos: `${rIdx + 1}.`, compId: c.id });
          } catch (e) { /* spring over */ }
        }
        if (!cancelled) setPlacements(list);
      } catch (e) { if (!cancelled) setPlacements([]); }
    })();
    return () => { cancelled = true; };
  }, [token, userId, competitions]); // eslint-disable-line

  const firstName = (profile?.display_name || "").split(" ")[0] || profile?.display_name || "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <Eyebrow>{daFullDate()}</Eyebrow>
        <H size={30}>Hej {firstName}</H>
      </div>

      {/* Signatur: næste deadline */}
      {tips === null && <Card><span style={{ color: C.muted, fontSize: 13 }}>Henter din næste deadline…</span></Card>}
      {tips && !tips.hasComps && (
        <Card style={{ borderStyle: "dashed", background: "transparent" }}>
          <div style={{ color: C.muted, fontSize: 14, textAlign: "center" }}>
            Du er ikke med i nogen ligaer endnu. <span onClick={() => goTab("ligaer")} style={{ color: C.green, cursor: "pointer", fontWeight: 700 }}>Opret eller join én →</span>
          </div>
        </Card>
      )}
      {tips && tips.hasComps && tips.allTipped && (
        <Card style={{ borderColor: C.line }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Check size={16} color={C.green} />
            <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase" }}>Alle tips er inde</div>
          </div>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
            {tips.nextOpen ? `Næste kamp: ${formatKickoff(tips.nextOpen)}` : "Vi giver besked, når næste runde åbner."}
          </div>
        </Card>
      )}
      {tips && tips.hasComps && !tips.allTipped && !tips.noMatches && !tips.error && (
        <Card style={{ borderColor: C.green, background: "linear-gradient(135deg, #14212F 0%, #14302A 100%)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.green, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            <Clock size={13} /> Deadline om {fmtCountdown(tips.deadline)}
          </div>
          <div style={{ fontFamily: font.display, fontSize: 22, fontWeight: 700, textTransform: "uppercase", marginTop: 4 }}>
            Runde {tips.roundLabelText} · {tips.missingCount} {tips.missingCount === 1 ? "kamp mangler" : "kampe mangler"} tips
          </div>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{tips.names.join(" · ")}</div>
          <button style={{ ...btnGreen, marginTop: 12 }} onClick={() => openPredictions("all", tips.roundKey)}>Tip nu</button>
        </Card>
      )}

      {/* Rating-snapshot */}
      {snapshot && !snapshot.none && (
        <Card onClick={() => goTab("rating")}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <Eyebrow>Din rating</Eyebrow>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontFamily: font.display, fontSize: 34, fontWeight: 700 }}>{snapshot.rating}{snapshot.provisional ? <span style={{ color: C.muted, fontSize: 18 }}>*</span> : ""}</span>
                <Move d={snapshot.move} />
              </div>
              <div style={{ color: C.muted, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                Nr. {snapshot.rank} af {snapshot.total} {snapshot.form.length > 0 && <>· <FormDots form={snapshot.form} /></>}
              </div>
            </div>
            <ChevronRight color={C.muted} />
          </div>
        </Card>
      )}

      {/* Placeringer */}
      {placements && placements.length > 0 && (
        <Card>
          <Eyebrow>Dine placeringer</Eyebrow>
          {placements.map((r, i) => (
            <div key={i} onClick={() => r.tab ? goTab(r.tab) : openBoard(r.compId)} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 0", borderTop: i ? `1px solid ${C.line}` : "none", cursor: "pointer",
            }}>
              <span style={{ fontSize: 14 }}>{r.label}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: font.display, fontSize: 18, fontWeight: 700, color: r.pos === "1." ? C.gold : C.text }}>{r.pos}</span>
                <ChevronRight size={15} color={C.muted} />
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
function monthName(monthKey) {
  const [y, m] = monthKey.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  const s = d.toLocaleDateString("da-DK", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ================================================================
//  FANE: LIGAER (private konkurrencer)
// ================================================================
function LigaerTab({ token, userId, competitions, openBoard, openCreate, reload }) {
  const [statusMap, setStatusMap] = useState({});
  const [showArchived, setShowArchived] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinErr, setJoinErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(competitions.map(async (c) => {
        try {
          const state = await computeCompetitionState(token, c.id, c.rules || { exact: 3, outcome: 1 });
          const myIdx = state.rows.findIndex((r) => r.userId === userId);
          const winner = state.isComplete && state.rows.length ? state.rows[0] : null;
          return [c.id, { isComplete: state.isComplete, playedMatches: state.playedMatches, totalMatches: state.totalMatches, participants: state.rows.length, myPos: myIdx >= 0 ? myIdx + 1 : null, winner }];
        } catch (e) { return [c.id, null]; }
      }));
      if (!cancelled) setStatusMap(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [competitions]); // eslint-disable-line

  async function setArchived(compId, hidden) {
    await db.update(token, "competition_participants", `competition_id=eq.${compId}&user_id=eq.${userId}`, { hidden });
    await reload();
  }
  async function deleteCompetition(comp) {
    if (!window.confirm(`Slet "${comp.name}" for ALLE deltagere? Dette kan ikke fortrydes.`)) return;
    await db.del(token, "competitions", `id=eq.${comp.id}`);
    await reload();
  }
  async function joinCompetition() {
    setBusy(true); setJoinErr("");
    try {
      const found = await db.select(token, "competitions", `invite_code=eq.${inviteCode.trim()}&select=*`);
      if (!found.length) { setJoinErr("Ingen konkurrence fundet med den kode"); setBusy(false); return; }
      await db.insert(token, "competition_participants", [{ competition_id: found[0].id, user_id: userId }]);
      setInviteCode("");
      await reload();
    } catch (e) { setJoinErr(e.message); } finally { setBusy(false); }
  }

  const modeLabel = (m) => m === "full_season" ? "Hel sæson" : m === "team" ? "Enkelt hold" : m === "time_range" ? "Datointerval" : m === "custom" ? "Håndplukket" : "Tilfældig kupon";

  const visible = competitions.filter((c) => !c._hidden);
  const archived = competitions.filter((c) => c._hidden);
  const active = visible.filter((c) => !statusMap[c.id]?.isComplete);
  const completed = visible.filter((c) => statusMap[c.id]?.isComplete);

  const LeagueCard = ({ c, isArchived }) => {
    const s = statusMap[c.id];
    return (
      <Card onClick={() => openBoard(c.id)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
              {s?.isComplete && <Trophy size={13} color={C.gold} />}
              <span>{c.name}</span>
            </div>
            <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
              {modeLabel(c.mode)}{s?.participants != null ? ` · ${s.participants} deltager${s.participants === 1 ? "" : "e"}` : ""}
              {s && !s.isComplete && s.totalMatches > 0 ? ` · ${s.playedMatches}/${s.totalMatches} spillet` : ""}
            </div>
            {s?.isComplete && s.winner && (
              <div style={{ color: C.gold, fontSize: 12, fontWeight: 700, marginTop: 3 }}>🏆 {s.winner.player} ({s.winner.total} point)</div>
            )}
          </div>
          <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 8 }}>
            {s?.myPos != null && (
              <div>
                <div style={{ fontFamily: font.display, fontSize: 24, fontWeight: 700, color: s.myPos === 1 ? C.gold : C.text }}>{s.myPos}.</div>
                <div style={{ color: C.muted, fontSize: 11 }}>din plads</div>
              </div>
            )}
            <ChevronRight size={18} color={C.muted} />
          </div>
        </div>
        {(s?.isComplete || isArchived) && (
          <div style={{ marginTop: 8, display: "flex", gap: 14, alignItems: "center" }}>
            <span onClick={(e) => { e.stopPropagation(); setArchived(c.id, !isArchived); }}
              style={{ color: C.muted, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
              {isArchived ? "Gendan" : "Arkivér"}
            </span>
            {c.created_by === userId && (
              <span onClick={(e) => { e.stopPropagation(); deleteCompetition(c); }}
                style={{ color: C.red, fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Trash2 size={12} /> Slet
              </span>
            )}
          </div>
        )}
      </Card>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <Eyebrow>Private konkurrencer <InfoDot title="Ligaer">Private konkurrencer, du opretter og inviterer venner til. Klik på en liga for at se stillingen.</InfoDot></Eyebrow>
          <H>Dine ligaer</H>
        </div>
        <button style={btnGhost} onClick={openCreate}><Plus size={15} /> Opret</button>
      </div>

      {/* Join med kode */}
      <Card>
        <Eyebrow>Join med kode</Eyebrow>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="field" style={{ flex: 1 }} placeholder="Invitationskode…" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
          <button style={{ ...btnGold, opacity: busy || !inviteCode ? 0.5 : 1 }} onClick={joinCompetition} disabled={busy || !inviteCode}>Join</button>
        </div>
        {joinErr && <p style={{ color: C.red, fontSize: 13, margin: "8px 0 0" }}>{joinErr}</p>}
      </Card>

      {competitions.length === 0 && (
        <Card style={{ borderStyle: "dashed", background: "transparent" }}>
          <div style={{ color: C.muted, fontSize: 13, textAlign: "center" }}>
            Ingen ligaer endnu — opret en, eller join med en kode ovenfor.
          </div>
        </Card>
      )}

      {active.map((c) => <LeagueCard key={c.id} c={c} />)}

      {completed.length > 0 && (
        <>
          <Eyebrow>Afsluttede</Eyebrow>
          {completed.map((c) => <LeagueCard key={c.id} c={c} />)}
        </>
      )}

      {archived.length > 0 && (
        <>
          <div onClick={() => setShowArchived(!showArchived)} style={{ display: "flex", alignItems: "center", gap: 6, color: C.muted, fontSize: 13, padding: "4px 2px", cursor: "pointer" }}>
            <Archive size={14} /> Arkiverede ligaer ({archived.length}) <ChevronRight size={14} style={{ transform: showArchived ? "rotate(90deg)" : "none" }} />
          </div>
          {showArchived && archived.map((c) => <LeagueCard key={c.id} c={c} isArchived />)}
        </>
      )}
    </div>
  );
}

// ================================================================
//  FANE: CHAMPIONSHIP (månedsliga + kommende officielle events)
// ================================================================
function ChampionshipTab({ token, userId }) {
  const [months, setMonths] = useState([]);
  const [month, setMonth] = useState(currentMonthKey());
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const ms = await loadMonthsAvailable(token);
      const list = ms.length ? ms : [currentMonthKey()];
      setMonths(list);
      const chosen = list.includes(month) ? month : list[0];
      setMonth(chosen);
      setRows(await loadMonthlyBoard(token, chosen));
      setLoading(false);
    })();
  }, []); // eslint-disable-line

  async function changeMonth(m) {
    setMonth(m); setRows(null);
    setRows(await loadMonthlyBoard(token, m));
  }

  const champ = rows && rows.length ? rows[0] : null;
  const isPast = month < currentMonthKey();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <Eyebrow>Officielle konkurrencer · alle er med <InfoDot title="Championship">Officielle konkurrencer, hvor alle brugere automatisk er med — ingen tilmelding.</InfoDot></Eyebrow>
        <H>Championship</H>
      </div>

      {/* Månedsliga */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
            Månedsliga
            <InfoDot title="Månedsliga">Point pr. kamp i gennemsnit for månedens runder. Uafgjort afgøres på flest præcise resultater. Månedens vinder kåres som Månedens Prediction Champ. Alle er automatisk med, og stillingen nulstilles den 1. i hver måned.</InfoDot>
          </div>
          <select className="field" value={month} onChange={(e) => changeMonth(e.target.value)} style={{ padding: "4px 8px", fontSize: 12 }}>
            {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </div>

        {champ && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, background: "rgba(240,180,41,0.1)",
            border: `1px solid rgba(240,180,41,0.35)`, borderRadius: 10, padding: "8px 12px", marginBottom: 10,
          }}>
            <Crown size={16} color={C.gold} />
            <span style={{ fontSize: 13 }}><b>{champ.player}</b> {isPast ? "er Månedens Prediction Champ" : "fører lige nu"}</span>
          </div>
        )}

        {loading && <p style={{ ...muted, margin: 0 }}>Henter…</p>}
        {!loading && rows && rows.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen point i denne måned endnu.</p>}
        {!loading && rows && rows.map((r, i) => {
          const you = r.userId === userId;
          const avg = r.matches > 0 ? (r.total / r.matches) : 0;
          return (
            <div key={r.userId} style={{
              display: "grid", gridTemplateColumns: "24px 1fr auto auto", gap: 10, alignItems: "center",
              padding: "8px 0", borderTop: i ? `1px solid ${C.line}` : "none",
              background: you ? "rgba(34,197,94,0.06)" : "transparent",
              margin: you ? "0 -8px" : 0, paddingLeft: you ? 8 : 0, paddingRight: you ? 8 : 0, borderRadius: you ? 8 : 0,
            }}>
              <span style={{ fontFamily: font.display, fontWeight: 700, color: i === 0 ? C.gold : C.muted }}>{i + 1}</span>
              <span style={{ fontSize: 14, fontWeight: you ? 700 : 400 }}>{r.player}{you ? " (dig)" : ""}</span>
              <span style={{ color: C.muted, fontSize: 12 }}>{r.exactCount} × 🎯</span>
              <span style={{ fontFamily: font.display, fontSize: 17, fontWeight: 700 }}>{avg.toFixed(2).replace(".", ",")}</span>
            </div>
          );
        })}
        <div style={{ color: C.muted, fontSize: 11, marginTop: 8 }}>Point pr. kamp i gennemsnit · uafgjort afgøres på flest præcise resultater</div>
      </Card>

      {/* Sæsonchampionship (statisk — datamodellen udvides senere) */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase" }}>Sæsonchampionship</div>
            <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>Hele Superligaen · løber over hele sæsonen</div>
          </div>
          <Minus color={C.muted} size={18} />
        </div>
      </Card>

      {/* Plads til flere events */}
      <Card style={{ borderStyle: "dashed", background: "transparent" }}>
        <div style={{ color: C.muted, fontSize: 13, textAlign: "center" }}>
          Her lander fremtidige events — fx en cup-weekend eller tema-runder
        </div>
      </Card>
    </div>
  );
}

// ================================================================
//  FANE: RATING
// ================================================================
function RatingTab({ token, userId }) {
  const [rows, setRows] = useState(null);
  const [hist, setHist] = useState(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [board, h] = await Promise.all([loadRatingBoard(token), loadRatingHistory(token)]);
      setRows(board); setHist(h);
      setLoading(false);
    })();
  }, []); // eslint-disable-line

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <Eyebrow>På tværs af alle ligaer <InfoDot title="Rating">Din langsigtede dygtighed på tværs af alle ligaer. Opdateres efter hver runde. Championship er dét, man vinder — rating er dét, man er.</InfoDot></Eyebrow>
        <H>Rating</H>
        <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
          Din langsigtede dygtighed. Opdateres efter hver runde — Championship er dét, man vinder; rating er dét, man <i>er</i>.
        </div>
      </div>

      {loading && <Card><span style={{ color: C.muted, fontSize: 13 }}>Henter…</span></Card>}
      {!loading && rows && rows.length === 0 && (
        <Card><span style={{ color: C.muted, fontSize: 13 }}>Ingen ratings endnu — de beregnes, når der er spillet runder med resultater.</span></Card>
      )}
      {!loading && rows && rows.length > 0 && (
        <Card style={{ padding: 0 }}>
          {rows.map((r, i) => {
            const you = r.userId === userId;
            const h = hist.get(r.userId) || {};
            return (
              <div key={r.userId} style={{
                display: "grid", gridTemplateColumns: "26px 1fr auto auto", gap: 10, alignItems: "center",
                padding: "12px 16px", borderTop: i ? `1px solid ${C.line}` : "none",
                background: you ? "rgba(34,197,94,0.07)" : "transparent",
              }}>
                <span style={{ fontFamily: font.display, fontSize: 18, fontWeight: 700, color: i === 0 ? C.gold : C.muted }}>{i + 1}</span>
                <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 14, fontWeight: you ? 700 : 500 }}>
                    {r.player}{you ? " (dig)" : ""}
                    {r.provisional && <span style={{
                      marginLeft: 6, fontSize: 10, color: C.gold, border: `1px solid ${C.gold}`,
                      borderRadius: 4, padding: "1px 4px", verticalAlign: "middle",
                    }}>NY</span>}
                  </span>
                  <FormDots form={h.form || []} />
                </span>
                <Move d={h.move || 0} />
                <span style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700 }}>{r.rating}</span>
              </div>
            );
          })}
        </Card>
      )}

      <div style={{ color: C.muted, fontSize: 11 }}>
        ● grøn = stærk runde · ● gul = middel · ● grå = svag. "NY" = under 5 runder (foreløbig K-faktor).
      </div>
    </div>
  );
}

// ================================================================
//  DELKOMPONENTER (nyt tema)
// ================================================================
const BackBar = ({ title, onBack, right }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
    <button onClick={onBack} aria-label="Tilbage" style={{ ...iconBtn, color: C.text }}><ChevronLeft size={22} /></button>
    <div style={{ fontFamily: font.display, textTransform: "uppercase", fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>{title}</div>
    {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
  </div>
);

function ScoreInput({ value, onChange, disabled }) {
  return (
    <input type="number" min="0" max="20" disabled={disabled}
      value={value === null || value === undefined ? "" : value}
      onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Math.min(20, Number(e.target.value))))}
      style={{
        width: 44, textAlign: "center", fontFamily: "ui-monospace, monospace", fontSize: 16, fontWeight: 700,
        background: disabled ? C.surface : C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 2px",
      }} />
  );
}

const pagerBtn = (enabled) => ({
  background: enabled ? C.surface2 : "transparent", color: enabled ? C.text : C.line,
  border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 12px",
  cursor: enabled ? "pointer" : "default", display: "inline-flex", alignItems: "center",
});
function RoundPager({ rounds, index, setIndex }) {
  if (!rounds.length) return null;
  const round = rounds[index];
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 10 }}>
      <button style={pagerBtn(index > 0)} disabled={index <= 0} onClick={() => setIndex(Math.max(0, index - 1))}><ChevronLeft size={16} /></button>
      <div style={{ color: C.text, fontWeight: 700, fontSize: 14, textAlign: "center" }}>
        Runde {round.label}
        <div style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>({index + 1} af {rounds.length})</div>
      </div>
      <button style={pagerBtn(index < rounds.length - 1)} disabled={index >= rounds.length - 1} onClick={() => setIndex(Math.min(rounds.length - 1, index + 1))}><ChevronRight size={16} /></button>
    </div>
  );
}

// én brugers forudsigelser pr. færdigspillet runde
function UserRoundPredictions({ playerName, userId, completedRounds, predsByKey, rules, initialKey, onClose }) {
  const startIdx = (() => {
    if (initialKey) { const i = completedRounds.findIndex((r) => r.key === initialKey); if (i >= 0) return i; }
    return completedRounds.length - 1;
  })();
  const [idx, setIdx] = useState(startIdx);
  const round = completedRounds[idx];
  const canPrev = idx > 0;
  const canNext = idx < completedRounds.length - 1;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && canPrev) setIdx((v) => v - 1);
      else if (e.key === "ArrowRight" && canNext) setIdx((v) => v + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canPrev, canNext, onClose]);

  if (!round) return null;
  const playedMatches = round.matches.filter((m) => m.home_score !== null && m.home_score !== undefined);
  let roundTotal = 0;

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, width: "100%",
        maxWidth: 460, maxHeight: "85vh", overflowY: "auto", padding: 18,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 12, letterSpacing: 1, color: C.muted, fontFamily: font.display }}>FORUDSIGELSER</span>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", padding: 0 }}><X size={20} /></button>
        </div>
        <div style={{ fontFamily: font.display, textTransform: "uppercase", fontWeight: 700, fontSize: 22 }}>{playerName}</div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "10px 0 14px" }}>
          <button disabled={!canPrev} onClick={() => setIdx((v) => v - 1)} style={pagerBtn(canPrev)}><ChevronLeft size={16} /></button>
          <span style={{ color: C.text, fontSize: 13, fontWeight: 700, textAlign: "center" }}>Runde {round.label}</span>
          <button disabled={!canNext} onClick={() => setIdx((v) => v + 1)} style={pagerBtn(canNext)}><ChevronRight size={16} /></button>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          {playedMatches.map((m) => {
            const pred = predsByKey.get(`${m.id}:${userId}`);
            const pts = pointsFor(pred, m, rules);
            if (pts !== null) roundTotal += pts;
            const has = pred && pred.pred_home !== null && pred.pred_home !== undefined;
            const ptColor = pts === (rules?.exact ?? 3) ? C.green : pts === (rules?.outcome ?? 1) ? "#7fd48a" : C.muted;
            return (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, background: C.surface2, borderRadius: 8, padding: "8px 10px" }}>
                <span style={{ flex: 1, color: C.muted, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m._home || m.home_team_id} – {m._away || m.away_team_id}
                </span>
                <span style={{ color: C.text, fontSize: 13, fontWeight: 700, minWidth: 34, textAlign: "center" }}>
                  {has ? `${pred.pred_home}-${pred.pred_away}` : "–"}
                </span>
                <span style={{ color: C.muted, fontSize: 12 }}>facit</span>
                <span style={{ color: C.text, fontSize: 13, fontWeight: 700, minWidth: 34, textAlign: "center" }}>{m.home_score}-{m.away_score}</span>
                <span style={{ background: C.surface, color: ptColor, fontSize: 12, fontWeight: 700, minWidth: 30, textAlign: "center", borderRadius: 999, padding: "2px 8px" }}>
                  {pts === null ? "–" : `+${pts}`}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
          <span style={{ color: C.muted, fontSize: 13 }}>Rundens total</span>
          <span style={{ color: C.gold, fontWeight: 800, fontSize: 16 }}>{roundTotal} point</span>
        </div>
      </div>
    </div>
  );
}

// ================================================================
//  SKÆRM: STILLING (drill-in fra Ligaer / Hjem)
// ================================================================
function BoardScreen({ token, userId, competitions, initialCompId, onBack, goToPredictions }) {
  const [selectedCompId, setSelectedCompId] = useState(initialCompId || competitions[0]?.id || null);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAllRounds, setShowAllRounds] = useState(false);
  const [viewUser, setViewUser] = useState(null);
  const comp = competitions.find((c) => c.id === selectedCompId);

  useEffect(() => {
    if (!selectedCompId || !comp) return;
    (async () => {
      setLoading(true);
      setShowAllRounds(false);
      const rules = comp.rules || { exact: 3, outcome: 1 };
      const result = await computeCompetitionState(token, selectedCompId, rules);
      try {
        const ratingMap = await loadRatingMap(token);
        result.rows.forEach((row) => {
          const rt = ratingMap.get(row.userId);
          if (rt) { row.rating = rt.rating; row.provisional = rt.provisional; }
        });
      } catch (e) { /* ratings optional */ }
      setState(result);
      setLoading(false);
    })();
  }, [selectedCompId, comp]); // eslint-disable-line

  function copyInviteLink() {
    if (!comp) return;
    const link = `${window.location.origin}${window.location.pathname}?join=${comp.invite_code}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!competitions.length) {
    return (<div><BackBar title="Stilling" onBack={onBack} /><p style={muted}>Opret eller join en konkurrence først.</p></div>);
  }

  const roundsDesc = state?.rounds ? state.rounds.slice().reverse() : [];
  const shownRounds = showAllRounds ? roundsDesc : roundsDesc.slice(0, 3);
  const completedRounds = (state?.allRounds || []).filter(
    (r) => r.matches.length > 0 && r.matches.every((m) => m.home_score !== null && m.home_score !== undefined)
  );
  const hasCompleted = completedRounds.length > 0;
  const openUser = (uid, playerName, initialKey = null) => { if (hasCompleted) setViewUser({ userId: uid, playerName, initialKey }); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BackBar title="Stilling" onBack={onBack} />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select className="field" style={{ flex: 1, minWidth: 160 }} value={selectedCompId || ""} onChange={(e) => setSelectedCompId(e.target.value)}>
          {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button style={btnGold} onClick={copyInviteLink}>
          {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Kopieret!" : "Invitér"}
        </button>
        <button style={btnGhost} onClick={() => goToPredictions(selectedCompId)}><ClipboardList size={15} /> Tip</button>
      </div>

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase" }}>Stilling</div>
          {state?.isComplete
            ? <span style={{ background: "rgba(240,180,41,0.15)", color: C.gold, fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 4 }}><Trophy size={12} />Afsluttet</span>
            : state && state.totalMatches > 0 && <span style={{ color: C.muted, fontSize: 12 }}>{state.playedMatches}/{state.totalMatches} spillet</span>}
        </div>
        {loading && <p style={{ ...muted, margin: 0 }}>Beregner…</p>}
        {!loading && state && state.rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr className="rowline">
                <th style={thStyle}>#</th>
                <th style={thStyle}>Spiller</th>
                <th style={{ ...thStyle, textAlign: "center" }} title="Prediction Champ Rating">Rating</th>
                <th style={{ ...thStyle, textAlign: "center" }} title="Antal præcise resultater">🎯</th>
                <th style={{ ...thStyle, textAlign: "center" }} title="Point i de seneste 3 runder">Form</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Point</th>
              </tr></thead>
              <tbody>
                {state.rows.map((r, i) => (
                  <tr key={r.player} className="rowline" style={{ background: r.userId === userId ? "rgba(34,197,94,0.06)" : "transparent" }}>
                    <td style={{ color: i === 0 ? C.gold : C.muted, fontWeight: 700, whiteSpace: "nowrap", fontFamily: font.display }}>
                      {i === 0 && state.isComplete ? "🏆" : i + 1}
                      {r.rankDelta !== undefined && r.rankDelta !== 0 && (
                        <span style={{ fontSize: 11, marginLeft: 4, color: r.rankDelta > 0 ? C.green : C.red }}>
                          {r.rankDelta > 0 ? `▲${r.rankDelta}` : `▼${Math.abs(r.rankDelta)}`}
                        </span>
                      )}
                    </td>
                    <td style={{ color: C.text, fontWeight: r.userId === userId ? 700 : 600 }}>
                      {hasCompleted
                        ? <span onClick={() => openUser(r.userId, r.player)} style={{ cursor: "pointer", textDecoration: "underline", textDecorationColor: C.line }}>{r.player}</span>
                        : r.player}
                    </td>
                    <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                      {r.rating != null
                        ? <span style={{ color: C.gold, fontWeight: 700, fontSize: 13 }}>{r.rating}{r.provisional ? <span style={{ color: C.muted, fontWeight: 400 }} title="Foreløbig">*</span> : ""}</span>
                        : <span style={{ color: C.muted, fontSize: 13 }}>–</span>}
                    </td>
                    <td style={{ textAlign: "center", color: C.text, fontSize: 13 }}>{r.exactCount}</td>
                    <td style={{ textAlign: "center", color: C.muted, fontSize: 13 }}>{r.form3}</td>
                    <td style={{ textAlign: "right" }}>
                      <span style={{ background: i === 0 ? "rgba(240,180,41,0.15)" : C.surface2, color: i === 0 ? C.gold : C.text, fontSize: 15, fontWeight: 700, borderRadius: 999, padding: "3px 10px" }}>{r.total}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && state && state.rows.length > 0 && (
          <p style={{ ...muted, marginTop: 8, marginBottom: 0, fontSize: 11 }}>🎯 = præcise resultater · Form = point seneste 3 runder · ▲▼ = ændring efter seneste runde</p>
        )}
        {!loading && state && state.rows.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen deltagere endnu.</p>}
      </Card>

      {!loading && state && roundsDesc.length > 0 && (
        <Card>
          <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>Point pr. runde</div>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr className="rowline">
                <th style={thStyle}>Runde</th>
                {state.rows.map((row) => <th key={row.player} style={{ ...thStyle, textAlign: "center", whiteSpace: "nowrap" }}>{row.player}</th>)}
              </tr></thead>
              <tbody>
                {shownRounds.map((r) => {
                  const best = Math.max(...state.rows.map((x) => x.perRound[r.key] ?? -Infinity));
                  return (
                    <tr key={r.key} className="rowline">
                      <td style={{ color: C.text, fontSize: 13, whiteSpace: "nowrap" }}>{r.label}</td>
                      {state.rows.map((row) => {
                        const v = row.perRound[r.key];
                        const isBest = v !== undefined && v === best && v > 0;
                        const clickable = v !== undefined && completedRounds.some((cr) => cr.key === r.key);
                        return (
                          <td key={row.player} style={{ textAlign: "center", color: isBest ? C.gold : C.text, fontWeight: isBest ? 700 : 400 }}>
                            {clickable
                              ? <span onClick={() => openUser(row.userId, row.player, r.key)} style={{ cursor: "pointer", textDecoration: "underline", textDecorationColor: C.line }}>{v}</span>
                              : (v ?? "–")}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {roundsDesc.length > 3 && (
            <p style={{ ...muted, marginTop: 10, marginBottom: 0, cursor: "pointer", textDecoration: "underline" }}
              onClick={() => setShowAllRounds(!showAllRounds)}>
              {showAllRounds ? "Vis kun de 3 seneste" : `Vis alle ${roundsDesc.length} runder`}
            </p>
          )}
        </Card>
      )}

      {viewUser && state && (
        <UserRoundPredictions playerName={viewUser.playerName} userId={viewUser.userId}
          completedRounds={completedRounds} predsByKey={state.predsByKey}
          rules={comp?.rules || { exact: 3, outcome: 1 }} initialKey={viewUser.initialKey}
          onClose={() => setViewUser(null)} />
      )}
    </div>
  );
}

// ================================================================
//  SKÆRM: FORUDSIGELSER (tip)
// ================================================================
function PredictionsScreen({ token, userId, competitions, initialFilter, onBack }) {
  const [compFilter, setCompFilter] = useState(initialFilter || "all");
  const [allMatches, setAllMatches] = useState([]);
  const [preds, setPreds] = useState({});
  const [allPreds, setAllPreds] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [teamsById, setTeamsById] = useState({});
  const [loading, setLoading] = useState(false);
  const [roundIndex, setRoundIndex] = useState(0);
  const [savedIds, setSavedIds] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [matchComps, setMatchComps] = useState({});
  const [, setTick] = useState(0);
  const comp = compFilter !== "all" ? competitions.find((c) => c.id === compFilter) : null;
  const rules = comp?.rules || { exact: 3, outcome: 1 };

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const compIds = compFilter === "all" ? competitions.map((c) => c.id) : [compFilter];
    if (!compIds.length) { setAllMatches([]); return; }
    (async () => {
      setLoading(true);
      setExpandedId(null);
      const cms = await db.select(token, "competition_matches", `competition_id=in.(${compIds.join(",")})&select=competition_id,match_id`);
      const ids = [...new Set(cms.map((c) => c.match_id))];
      const mcMap = {};
      for (const c of cms) (mcMap[c.match_id] ||= []).push(c.competition_id);
      setMatchComps(mcMap);
      if (!ids.length) { setAllMatches([]); setTeamsById({}); setLoading(false); return; }
      const ms = await db.select(token, "matches", `id=in.(${ids.join(",")})&select=*&order=kickoff_at`);
      setAllMatches(ms);
      const teamIds = [...new Set(ms.flatMap((m) => [m.home_team_id, m.away_team_id]))];
      if (teamIds.length) {
        const tms = await db.select(token, "teams", `id=in.(${teamIds.join(",")})&select=id,name`);
        setTeamsById(Object.fromEntries(tms.map((t) => [t.id, t.name])));
      }
      const ap = await db.select(token, "predictions", `match_id=in.(${ids.join(",")})&select=*`);
      setAllPreds(ap);
      setPreds(Object.fromEntries(ap.filter((p) => p.user_id === userId).map((p) => [p.match_id, p])));
      const parts = await db.select(token, "competition_participants", `competition_id=in.(${compIds.join(",")})&select=user_id`);
      const partIds = [...new Set(parts.map((p) => p.user_id))];
      const profs = partIds.length ? await db.select(token, "profiles", `id=in.(${partIds.join(",")})&select=id,display_name`) : [];
      setParticipants(profs);
      const rds = groupIntoRounds(ms);
      setRoundIndex(currentRoundIndex(rds));
      setLoading(false);
    })();
  }, [compFilter, competitions]); // eslint-disable-line

  const rounds = useMemo(() => groupIntoRounds(allMatches), [allMatches]);
  const round = rounds[roundIndex];

  async function save(matchId, field, val) {
    const cur = preds[matchId] || { pred_home: null, pred_away: null };
    const next = { ...cur, [field]: val };
    setPreds({ ...preds, [matchId]: next });
    if (next.pred_home === null || next.pred_away === null) return;
    try {
      await db.upsert(token, "predictions", [{ user_id: userId, match_id: matchId, pred_home: next.pred_home, pred_away: next.pred_away }], "user_id,match_id");
      setSavedIds((s) => ({ ...s, [matchId]: true }));
      setTimeout(() => setSavedIds((s) => { const c = { ...s }; delete c[matchId]; return c; }), 2000);
    } catch (e) { /* næste forsøg overskriver */ }
  }

  function lockCountdown(m) {
    if (!m.kickoff_at) return null;
    const msLeft = new Date(m.kickoff_at).getTime() - 60 * 60 * 1000 - Date.now();
    if (msLeft <= 0 || msLeft > 24 * 3600 * 1000) return null;
    const hours = Math.floor(msLeft / 3600000);
    const mins = Math.floor((msLeft % 3600000) / 60000);
    return hours > 0 ? `Låser om ${hours} t ${mins} min` : `Låser om ${mins} min`;
  }
  function opensAt(m) {
    const compIds = matchComps[m.id] || [];
    const comps = compIds.map((id) => competitions.find((c) => c.id === id)).filter(Boolean);
    if (!comps.length) return null;
    const windows = comps.map((c) => c.rules?.openDaysBefore || 0);
    if (windows.some((w) => !w)) return null;
    const maxDays = Math.max(...windows);
    const openTime = new Date(m.kickoff_at).getTime() - maxDays * 24 * 3600 * 1000;
    return Date.now() < openTime ? new Date(openTime) : null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BackBar title="Tip" onBack={onBack} />
      {!competitions.length ? (
        <p style={muted}>Opret eller join en konkurrence først.</p>
      ) : (
        <>
          <select className="field" value={compFilter} onChange={(e) => setCompFilter(e.target.value)}>
            <option value="all">Alle konkurrencer</option>
            {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          {loading && <p style={muted}>Henter kampe…</p>}
          {!loading && rounds.length === 0 && <p style={muted}>Ingen kampe i denne konkurrence endnu.</p>}
          {!loading && rounds.length > 0 && (
            <Card>
              <RoundPager rounds={rounds} index={roundIndex} setIndex={setRoundIndex} />
              <div style={{ display: "flex", flexDirection: "column" }}>
                {round.matches.map((m) => {
                  const pred = preds[m.id] || { pred_home: null, pred_away: null };
                  const locked = isLocked(m);
                  const played = m.home_score !== null && m.home_score !== undefined;
                  const hasPred = pred.pred_home !== null && pred.pred_away !== null;
                  const pts = played ? pointsFor(pred, m, rules) : null;
                  const exact = played && hasPred && pred.pred_home === m.home_score && pred.pred_away === m.away_score;
                  const correctOutcome = played && pts !== null && pts > 0;
                  const countdown = !locked ? lockCountdown(m) : null;
                  const notOpenUntil = !locked ? opensAt(m) : null;
                  const expanded = expandedId === m.id;
                  const matchPreds = locked ? allPreds.filter((p) => p.match_id === m.id) : [];

                  return (
                    <div key={m.id} style={{ padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
                      <div style={{ color: C.text, fontWeight: 600 }}>{teamsById[m.home_team_id]} - {teamsById[m.away_team_id]}</div>
                      <div style={{ color: C.muted, fontSize: 12, marginTop: 2, marginBottom: 10 }}>
                        {formatKickoff(m.kickoff_at)}
                        {!played && locked && <span style={{ color: C.red, marginLeft: 8 }}>· Låst</span>}
                        {countdown && !notOpenUntil && <span style={{ color: C.gold, marginLeft: 8 }}>· {countdown}</span>}
                        {notOpenUntil && <span style={{ color: C.muted, marginLeft: 8 }}>· Åbner {formatKickoff(notOpenUntil.toISOString())}</span>}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <ScoreInput value={pred.pred_home} onChange={(v) => save(m.id, "pred_home", v)} disabled={locked || !!notOpenUntil} />
                          <span style={{ color: C.muted }}>-</span>
                          <ScoreInput value={pred.pred_away} onChange={(v) => save(m.id, "pred_away", v)} disabled={locked || !!notOpenUntil} />
                          {savedIds[m.id] && <Check size={16} style={{ color: C.green }} />}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {played && (
                            <>
                              <span style={{
                                background: !hasPred ? C.surface2 : correctOutcome ? "rgba(34,197,94,0.18)" : "rgba(239,91,91,0.18)",
                                color: !hasPred ? C.muted : correctOutcome ? C.green : C.red,
                                border: exact ? `2px solid ${C.gold}` : "1px solid transparent",
                                fontSize: 15, fontWeight: 700, padding: "6px 12px", whiteSpace: "nowrap", borderRadius: 8,
                              }}>{m.home_score} - {m.away_score}</span>
                              {hasPred && <span style={{ fontSize: 12, color: C.muted, whiteSpace: "nowrap" }}>{pts > 0 ? `+${pts}` : pts} point</span>}
                            </>
                          )}
                          {locked && participants.length > 1 && (
                            <span onClick={() => setExpandedId(expanded ? null : m.id)}
                              style={{ fontSize: 12, color: C.gold, cursor: "pointer", whiteSpace: "nowrap", textDecoration: "underline" }}>
                              {expanded ? "Skjul gæt" : "Alles gæt"}
                            </span>
                          )}
                        </div>
                      </div>
                      {expanded && (
                        <div style={{ marginTop: 10, padding: "10px 12px", background: C.surface2, borderRadius: 10 }}>
                          {participants.map((p) => {
                            const pp = matchPreds.find((x) => x.user_id === p.id);
                            const ppts = played && pp ? pointsFor(pp, m, rules) : null;
                            return (
                              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 13 }}>
                                <span style={{ color: p.id === userId ? C.gold : C.text, fontWeight: p.id === userId ? 700 : 400 }}>{p.display_name}</span>
                                <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
                                  <span style={{ color: C.text, fontFamily: "ui-monospace, monospace" }}>{pp ? `${pp.pred_home} - ${pp.pred_away}` : "–"}</span>
                                  {ppts !== null && (
                                    <span style={{ color: ppts > 0 ? C.green : ppts < 0 ? C.red : C.muted, minWidth: 28, textAlign: "right" }}>{ppts > 0 ? `+${ppts}` : ppts}</span>
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ================================================================
//  SKÆRM: OPRET KONKURRENCE
// ================================================================
function CreateCompetitionScreen({ token, userId, leagues, onBack, onCreated, openBoard }) {
  const [createLeagueId, setCreateLeagueId] = useState(leagues[0]?.id || "");
  const [createSeason, setCreateSeason] = useState(null);
  const [createTeams, setCreateTeams] = useState([]);
  const [name, setName] = useState("");
  const [mode, setMode] = useState("full_season");
  const [teamId, setTeamId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [upcoming, setUpcoming] = useState([]);
  const [upcomingTeams, setUpcomingTeams] = useState({});
  const [pickedIds, setPickedIds] = useState([]);
  const [pickLeagueIds, setPickLeagueIds] = useState(null);
  const [randomCount, setRandomCount] = useState(6);
  const [randomLeagueIds, setRandomLeagueIds] = useState(null);
  const [rollingWindow, setRollingWindow] = useState(false);

  useEffect(() => { if (!createLeagueId && leagues.length) setCreateLeagueId(leagues[0].id); }, [leagues]); // eslint-disable-line

  useEffect(() => {
    if (!createLeagueId) return;
    (async () => {
      const seasons = await db.select(token, "seasons", `league_id=eq.${createLeagueId}&select=*&order=start_date.desc&limit=1`);
      setCreateSeason(seasons[0] || null);
      const tms = await db.select(token, "teams", `league_id=eq.${createLeagueId}&select=*&order=name`);
      setCreateTeams(tms);
      setTeamId("");
    })();
  }, [createLeagueId]); // eslint-disable-line

  useEffect(() => {
    if (mode !== "custom" && mode !== "random") return;
    (async () => {
      const leagueIds = leagues.map((l) => l.id);
      if (!leagueIds.length) return;
      const seasons = await db.select(token, "seasons", `league_id=in.(${leagueIds.join(",")})&select=id,league_id&order=start_date.desc`);
      const newestByLeague = {};
      for (const s of seasons) if (!newestByLeague[s.league_id]) newestByLeague[s.league_id] = s;
      const seasonIds = Object.values(newestByLeague).map((s) => s.id);
      if (!seasonIds.length) { setUpcoming([]); return; }
      const seasonToLeague = Object.fromEntries(Object.values(newestByLeague).map((s) => [s.id, s.league_id]));
      const leagueNames = Object.fromEntries(leagues.map((l) => [l.id, l.name]));
      const nowIso = new Date().toISOString();
      const ms = await db.select(token, "matches", `season_id=in.(${seasonIds.join(",")})&kickoff_at=gte.${nowIso}&select=*&order=kickoff_at&limit=300`);
      const teamIds = [...new Set(ms.flatMap((m) => [m.home_team_id, m.away_team_id]))];
      const tms = teamIds.length ? await db.select(token, "teams", `id=in.(${teamIds.join(",")})&select=id,name`) : [];
      setUpcomingTeams(Object.fromEntries(tms.map((t) => [t.id, t.name])));
      setUpcoming(ms.map((m) => ({ ...m, _leagueId: seasonToLeague[m.season_id], _leagueName: leagueNames[seasonToLeague[m.season_id]] })));
      setPickedIds([]);
    })();
  }, [mode, leagues]); // eslint-disable-line

  async function createCompetition() {
    if (!name) return;
    setBusy(true); setErr("");
    try {
      const crossLeague = mode === "custom" || mode === "random";
      if (!crossLeague && (!createLeagueId || !createSeason)) { setBusy(false); return; }

      let matchIds = [];
      if (mode === "custom") {
        matchIds = pickedIds;
        if (!matchIds.length) { setErr("Vælg mindst én kamp"); setBusy(false); return; }
      } else if (mode === "random") {
        const allowedLeagues = randomLeagueIds || leagues.map((l) => l.id);
        const pool = upcoming.filter((m) => allowedLeagues.includes(m._leagueId));
        if (!pool.length) { setErr("Ingen kommende kampe i de valgte ligaer"); setBusy(false); return; }
        const firstRound = pool.reduce((min, m) => (m.round_key < min ? m.round_key : min), pool[0].round_key);
        const roundPool = pool.filter((m) => m.round_key === firstRound);
        const shuffled = roundPool.slice().sort(() => Math.random() - 0.5);
        matchIds = shuffled.slice(0, Math.max(1, Number(randomCount) || 6)).map((m) => m.id);
      }

      const mode_params = mode === "team" ? { team_id: teamId }
        : mode === "time_range" ? { start_date: startDate, end_date: endDate }
        : mode === "random" ? { count: Number(randomCount) || 6 } : {};
      const rules = { exact: 3, outcome: 1, ...(rollingWindow ? { openDaysBefore: 7 } : {}) };
      const [comp] = await db.insert(token, "competitions", [{
        name,
        league_id: crossLeague ? null : createLeagueId,
        season_id: crossLeague ? null : createSeason.id,
        mode, mode_params, rules, created_by: userId,
      }]);
      await db.insert(token, "competition_participants", [{ competition_id: comp.id, user_id: userId }]);

      if (crossLeague) {
        await db.insert(token, "competition_matches", matchIds.map((id) => ({ competition_id: comp.id, match_id: id })));
      } else {
        let query = `season_id=eq.${createSeason.id}&select=id,round_key,home_score`;
        if (mode === "team" && teamId) query += `&or=(home_team_id.eq.${teamId},away_team_id.eq.${teamId})`;
        if (mode === "time_range" && startDate && endDate) query += `&kickoff_at=gte.${startDate}&kickoff_at=lte.${endDate}T23:59:59`;
        let matchedMatches = await db.select(token, "matches", query);
        matchedMatches = filterFromNextUnfinishedRound(matchedMatches);
        if (matchedMatches.length) {
          await db.insert(token, "competition_matches", matchedMatches.map((m) => ({ competition_id: comp.id, match_id: m.id })));
        }
      }
      await onCreated();
      openBoard(comp.id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const pickAllowed = pickLeagueIds || leagues.map((l) => l.id);
  const upcomingRounds = useMemo(
    () => groupIntoRounds(upcoming.filter((m) => pickAllowed.includes(m._leagueId))),
    [upcoming, pickLeagueIds, leagues] // eslint-disable-line
  );
  const randomPool = useMemo(() => {
    const allowed = randomLeagueIds || leagues.map((l) => l.id);
    const pool = upcoming.filter((m) => allowed.includes(m._leagueId));
    if (!pool.length) return [];
    const firstRound = pool.reduce((min, m) => (m.round_key < min ? m.round_key : min), pool[0].round_key);
    return pool.filter((m) => m.round_key === firstRound);
  }, [upcoming, randomLeagueIds, leagues]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BackBar title="Opret liga" onBack={onBack} />
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input className="field" placeholder="Navn på konkurrence…" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="field" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="full_season">Hel sæson</option>
            <option value="team">Et hold</option>
            <option value="time_range">Tidsperiode (fx 3 uger)</option>
            <option value="custom">Håndplukkede kampe</option>
            <option value="random">Tilfældig kupon</option>
          </select>

          {(mode === "full_season" || mode === "team" || mode === "time_range") && leagues.length > 1 && (
            <select className="field" value={createLeagueId} onChange={(e) => setCreateLeagueId(e.target.value)}>
              {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          {mode === "team" && (
            <select className="field" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">Vælg hold…</option>
              {createTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          {mode === "time_range" && (
            <div style={{ display: "flex", gap: 8 }}>
              <input className="field" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <input className="field" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          )}

          {mode === "random" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: C.text, fontSize: 14 }}>Antal kampe:</span>
                <input className="field" type="number" min="1" max={Math.max(1, randomPool.length)} style={{ width: 70 }}
                  value={Math.min(Number(randomCount) || 1, Math.max(1, randomPool.length))}
                  onChange={(e) => setRandomCount(Math.min(Number(e.target.value) || 1, Math.max(1, randomPool.length)))} />
                <span style={{ color: C.muted, fontSize: 12 }}>({randomPool.length} i nærmeste runde)</span>
              </div>
              {leagues.length > 1 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {leagues.map((l) => {
                    const sel = (randomLeagueIds || leagues.map((x) => x.id)).includes(l.id);
                    return (
                      <button key={l.id} type="button" onClick={() => {
                        const base = randomLeagueIds || leagues.map((x) => x.id);
                        const next = sel ? base.filter((x) => x !== l.id) : [...base, l.id];
                        setRandomLeagueIds(next.length ? next : base);
                      }} style={chip(sel)}>{sel ? "✓ " : ""}{l.name}</button>
                    );
                  })}
                </div>
              )}
              <p style={{ ...muted, margin: 0 }}>Trækker tilfældige kampe fra den nærmeste kommende runde.</p>
            </>
          )}

          {mode === "custom" && (
            <>
              {leagues.length > 1 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {leagues.map((l) => {
                    const sel = pickAllowed.includes(l.id);
                    return (
                      <button key={l.id} type="button" onClick={() => {
                        const base = pickLeagueIds || leagues.map((x) => x.id);
                        const next = sel ? base.filter((x) => x !== l.id) : [...base, l.id];
                        setPickLeagueIds(next.length ? next : base);
                      }} style={chip(sel)}>{sel ? "✓ " : ""}{l.name}</button>
                    );
                  })}
                </div>
              )}
              <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${C.line}`, borderRadius: 10, padding: 10 }}>
                {upcomingRounds.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen kommende kampe fundet.</p>}
                {upcomingRounds.map((r) => (
                  <div key={r.key} style={{ marginBottom: 10 }}>
                    <div style={{ color: C.gold, fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Runde {r.label}</div>
                    {r.matches.map((m) => {
                      const checked = pickedIds.includes(m.id);
                      return (
                        <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", fontSize: 13 }}>
                          <input type="checkbox" checked={checked} onChange={() =>
                            setPickedIds(checked ? pickedIds.filter((x) => x !== m.id) : [...pickedIds, m.id])} />
                          <span style={{ color: C.text }}>{upcomingTeams[m.home_team_id]} - {upcomingTeams[m.away_team_id]}</span>
                          <span style={{ color: C.muted, fontSize: 11, marginLeft: "auto", whiteSpace: "nowrap" }}>{m._leagueName} · {formatKickoff(m.kickoff_at)}</span>
                        </label>
                      );
                    })}
                  </div>
                ))}
                {pickedIds.length > 0 && <p style={{ ...muted, marginBottom: 0 }}>{pickedIds.length} kampe valgt</p>}
              </div>
            </>
          )}

          <label style={{ display: "flex", alignItems: "center", gap: 8, color: C.text, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={rollingWindow} onChange={(e) => setRollingWindow(e.target.checked)} />
            Rullende gætte-vindue — kampe kan først tippes 7 dage før kickoff
          </label>

          {err && <p style={{ color: C.red, fontSize: 13, margin: 0 }}>{err}</p>}
          <button style={{ ...btnGreen, opacity: busy || !name ? 0.5 : 1 }} onClick={createCompetition} disabled={busy || !name}>
            {busy ? "Opretter…" : "Opret konkurrence"}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ================================================================
//  SKÆRM: ADMIN (Kampe + Resultater)
// ================================================================
function AdminScreen({ token, leagues, reloadLeagues, onBack }) {
  const [sub, setSub] = useState("matches");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BackBar title="Admin" onBack={onBack} />
      <div style={{ display: "flex", gap: 8 }}>
        <button style={chip(sub === "matches")} onClick={() => setSub("matches")}>Kampe</button>
        <button style={chip(sub === "results")} onClick={() => setSub("results")}>Resultater</button>
      </div>
      {sub === "matches" && <MatchesPanel token={token} leagues={leagues} reloadLeagues={reloadLeagues} />}
      {sub === "results" && <ResultsPanel token={token} leagues={leagues} />}
    </div>
  );
}

function MatchesPanel({ token, leagues, reloadLeagues }) {
  const [leagueId, setLeagueId] = useState(leagues[0]?.id || "");
  const [teams, setTeams] = useState([]);
  const [matches, setMatches] = useState([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const league = leagues.find((l) => l.id === leagueId) || null;
  const teamsById = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t.name])), [teams]);
  const rounds = useMemo(() => groupIntoRounds(matches), [matches]);

  useEffect(() => { if (!leagueId && leagues.length) setLeagueId(leagues[0].id); }, [leagues]); // eslint-disable-line

  async function loadData() {
    if (!leagueId) return;
    const tms = await db.select(token, "teams", `league_id=eq.${leagueId}&select=*&order=name`);
    setTeams(tms);
    const seasons = await db.select(token, "seasons", `league_id=eq.${leagueId}&select=id&order=start_date.desc&limit=1`);
    if (seasons[0]) {
      const ms = await db.select(token, "matches", `season_id=eq.${seasons[0].id}&select=*&order=kickoff_at`);
      setMatches(ms);
      setRoundIndex(currentRoundIndex(groupIntoRounds(ms)));
    } else setMatches([]);
  }
  useEffect(() => { loadData(); }, [leagueId]); // eslint-disable-line

  async function syncFromApi() {
    if (!league) return;
    setSyncing(true); setSyncResult(null);
    try {
      const res = await fetch(`/api/sync-matches?leagueId=${league.id}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setSyncResult(data);
      await reloadLeagues();
      await loadData();
    } catch (e) { setSyncResult({ error: e.message }); } finally { setSyncing(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {leagues.length > 1 && (
        <select className="field" value={leagueId} onChange={(e) => setLeagueId(e.target.value)}>
          {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      )}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontFamily: font.display, fontSize: 18, fontWeight: 700, textTransform: "uppercase" }}>Hent kampe & resultater</div>
            <p style={{ ...muted, margin: "4px 0 0" }}>Fra Sportmonks for {league?.name || "denne liga"}.</p>
          </div>
          <button style={btnGold} onClick={syncFromApi} disabled={syncing}>
            {syncing ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Hent nu
          </button>
        </div>
        {syncResult && !syncResult.error && (
          <p style={{ color: C.green, fontSize: 13, marginTop: 10, marginBottom: 0 }}>
            {syncResult.synced} kampe synkroniseret ud af {syncResult.totalFixtures} fundet.
            {syncResult.unmatched?.length > 0 && <span style={{ color: C.red }}> Kunne ikke matche: {syncResult.unmatched.join(", ")}</span>}
          </p>
        )}
        {syncResult?.error && <p style={{ color: C.red, fontSize: 13, marginTop: 10, marginBottom: 0 }}>Fejl: {syncResult.error}</p>}
      </Card>

      {rounds.length === 0 && <p style={muted}>Ingen kampe endnu.</p>}
      {rounds.length > 0 && (
        <Card>
          <RoundPager rounds={rounds} index={roundIndex} setIndex={setRoundIndex} />
          <table><tbody>
            {rounds[roundIndex].matches.map((m) => (
              <tr key={m.id} className="rowline">
                <td style={{ color: C.muted, fontSize: 13, width: 130 }}>{formatKickoff(m.kickoff_at)}</td>
                <td style={{ color: C.text, fontWeight: 600 }}>{teamsById[m.home_team_id]} <span style={{ color: C.muted }}>vs</span> {teamsById[m.away_team_id]}</td>
                <td style={{ textAlign: "right" }}>
                  {m.home_score !== null
                    ? <span style={{ background: C.surface2, color: C.gold, borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>{m.home_score} - {m.away_score}</span>
                    : <span style={{ color: C.muted, fontSize: 12 }}>Ikke spillet</span>}
                </td>
              </tr>
            ))}
          </tbody></table>
        </Card>
      )}
    </div>
  );
}

function ResultsPanel({ token, leagues }) {
  const [leagueId, setLeagueId] = useState(leagues[0]?.id || "");
  const [teams, setTeams] = useState([]);
  const [matches, setMatches] = useState([]);
  const [roundIndex, setRoundIndex] = useState(0);

  const teamsById = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t.name])), [teams]);
  const rounds = useMemo(() => groupIntoRounds(matches), [matches]);
  const round = rounds[roundIndex];

  useEffect(() => { if (!leagueId && leagues.length) setLeagueId(leagues[0].id); }, [leagues]); // eslint-disable-line

  async function loadData() {
    if (!leagueId) return;
    const tms = await db.select(token, "teams", `league_id=eq.${leagueId}&select=*&order=name`);
    setTeams(tms);
    const seasons = await db.select(token, "seasons", `league_id=eq.${leagueId}&select=id&order=start_date.desc&limit=1`);
    if (seasons[0]) {
      const ms = await db.select(token, "matches", `season_id=eq.${seasons[0].id}&select=*&order=kickoff_at`);
      setMatches(ms);
      setRoundIndex(currentRoundIndex(groupIntoRounds(ms)));
    } else setMatches([]);
  }
  useEffect(() => { loadData(); }, [leagueId]); // eslint-disable-line

  async function setScore(id, field, val) {
    await db.update(token, "matches", `id=eq.${id}`, { [field]: val, status: "finished" });
    const seasons = await db.select(token, "seasons", `league_id=eq.${leagueId}&select=id&order=start_date.desc&limit=1`);
    if (seasons[0]) {
      const ms = await db.select(token, "matches", `season_id=eq.${seasons[0].id}&select=*&order=kickoff_at`);
      setMatches(ms);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {leagues.length > 1 && (
        <select className="field" value={leagueId} onChange={(e) => setLeagueId(e.target.value)}>
          {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      )}
      {rounds.length === 0 ? (
        <p style={muted}>Ingen kampe endnu — tilføj under "Kampe".</p>
      ) : (
        <Card>
          <p style={{ ...muted, marginTop: 0 }}>Indtast faktiske resultater. Stillingen opdateres automatisk.</p>
          <RoundPager rounds={rounds} index={roundIndex} setIndex={setRoundIndex} />
          <table><tbody>
            {round.matches.map((m) => (
              <tr key={m.id} className="rowline">
                <td style={{ padding: "10px 6px" }}>
                  <div style={{ color: C.text, fontWeight: 600 }}>{teamsById[m.home_team_id]} vs {teamsById[m.away_team_id]}</div>
                  <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{formatKickoff(m.kickoff_at)}</div>
                </td>
                <td>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <ScoreInput value={m.home_score} onChange={(v) => setScore(m.id, "home_score", v)} />
                    <span style={{ color: C.muted }}>-</span>
                    <ScoreInput value={m.away_score} onChange={(v) => setScore(m.id, "away_score", v)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody></table>
        </Card>
      )}
    </div>
  );
}

// ================================================================
//  SKÆRM: SÅDAN VIRKER DET (Fase 5B)
// ================================================================
function HowItWorksScreen({ onBack }) {
  const Section = ({ title, children }) => (
    <Card>
      <div style={{ fontFamily: font.display, fontSize: 18, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>{title}</div>
      <div style={{ color: C.text, fontSize: 14, lineHeight: 1.55 }}>{children}</div>
    </Card>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BackBar title="Sådan virker det" onBack={onBack} />
      <Section title="Pointsystem">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div><span style={{ color: C.green, fontWeight: 700 }}>+3</span> for præcist resultat (fx gættet 2-1, endte 2-1).</div>
          <div><span style={{ color: "#7fd48a", fontWeight: 700 }}>+1</span> for korrekt udfald (rigtig vinder/uafgjort, forkert resultat).</div>
          <div><span style={{ color: C.muted, fontWeight: 700 }}>0</span> ellers. Ingen minuspoint — du kan aldrig gå i minus.</div>
        </div>
      </Section>
      <Section title="Tiebreak">
        Ved pointlighed afgør flest <b>præcise resultater</b> først, dernæst flest <b>korrekte udfald</b>.
      </Section>
      <Section title="Rating">
        Parvis multiplayer-Elo. Alle starter på <b>1000</b>. Du stiger, hvis du rammer bedre end de andre i runden, og falder, hvis du rammer dårligere — det tæller ekstra at slå spillere med høj rating. Beregnes én gang pr. runde ud fra dine gennemsnitspoint pr. kamp. De første 5 runder er foreløbige (<b>NY</b>-badge).
      </Section>
      <Section title="Månedsliga & Championship">
        <b>Championship</b> er officielle konkurrencer, hvor alle automatisk er med. <b>Månedsligaen</b> samler dine point for alle kampe i kalendermåneden (point pr. kamp i gennemsnit). Månedens bedste kåres som <b>Månedens Prediction Champ</b>, og stillingen nulstilles den 1.
      </Section>
      <Section title="Tips-synlighed">
        Du kan først se andres tips, når alle kampe i en runde har fået resultat — ingen kan se dine tips for uspillede kampe. En forudsigelse låses 1 time før kickoff.
      </Section>
      <Section title="Rullende gætte-vindue">
        Nogle ligaer bruger et rullende vindue: en kamp kan først tippes et bestemt antal dage før kickoff (typisk 7). Så tipper alle med nogenlunde samme viden. Det vælges, når konkurrencen oprettes.
      </Section>
    </div>
  );
}

// ================================================================
//  STYLES
// ================================================================
const wrapOuter = { minHeight: "100vh", background: "#060B12", display: "flex", justifyContent: "center", fontFamily: font.body };
const phone = { width: "100%", maxWidth: 430, background: C.bg, color: C.text, minHeight: "100vh", display: "flex", flexDirection: "column" };
const thStyle = { color: C.muted, fontSize: 12, fontWeight: 600, fontFamily: font.display, textTransform: "uppercase", letterSpacing: "0.04em" };
const globalCss = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; }
  html, body, #root { min-height: 100%; }
  body { margin: 0; background: #060B12; }
  input, select, button { font-family: inherit; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 8px 8px; text-align: left; }
  .field { background: ${C.surface2}; border: 1px solid ${C.line}; color: ${C.text}; border-radius: 8px; padding: 8px 10px; font-size: 14px; }
  .rowline { border-bottom: 1px solid ${C.line}; }
  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  button:focus-visible { outline: 2px solid ${C.green}; outline-offset: 2px; }
`;

