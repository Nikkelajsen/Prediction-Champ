import { useState, useEffect, useMemo } from "react";
import { Trophy, Plus, Trash2, Users, CalendarDays, ClipboardList, BarChart3, Loader2, LogOut, Copy, Check, RefreshCw, Info } from "lucide-react";

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
function outcome(h, a) { return h === a ? "X" : h > a ? "1" : "2"; }
function pointsFor(pred, actual, rules) {
  if (!pred || actual.home_score === null || actual.away_score === null) return null;
  if (pred.pred_home === actual.home_score && pred.pred_away === actual.away_score) return rules.exact;
  const predOutcome = outcome(pred.pred_home, pred.pred_away);
  const actualOutcome = outcome(actual.home_score, actual.away_score);
  if (predOutcome === actualOutcome) return rules.outcome;

  // straf: aldrig hvis man gættede uafgjort
  if (predOutcome === "X") return 0;
  const penaltyBase = rules.wrongWinPenalty ?? 1;
  if (!penaltyBase) return 0;

  const reversedWinner = actualOutcome !== "X" && predOutcome !== actualOutcome;
  const predDiff = pred.pred_home - pred.pred_away;
  const actualDiff = actual.home_score - actual.away_score;
  const diffOff = Math.abs(predDiff - actualDiff) > 5;

  if (reversedWinner && diffOff) return -2 * penaltyBase;
  if (reversedWinner || diffOff) return -1 * penaltyBase;
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

  const rounds = groupIntoRounds(ms);
  const predsByKey = new Map(preds.map((pr) => [`${pr.match_id}:${pr.user_id}`, pr]));

  const rows = profiles.map((p) => {
    let total = 0;
    const perRound = {};
    for (const round of rounds) {
      let rTotal = 0;
      let rPlayed = false;
      for (const m of round.matches) {
        const pred = predsByKey.get(`${m.id}:${p.id}`);
        const pts = pointsFor(pred, m, rules);
        if (pts !== null) { rTotal += pts; rPlayed = true; }
      }
      if (rPlayed) perRound[round.key] = rTotal;
      total += rTotal;
    }
    return { player: p.display_name, total, perRound };
  }).sort((a, b) => b.total - a.total);

  const totalMatches = ms.length;
  const playedMatches = ms.filter((m) => m.home_score !== null && m.home_score !== undefined).length;
  const isComplete = totalMatches > 0 && playedMatches === totalMatches;

  // kun runder hvor mindst én kamp er spillet (relevant for "point pr. runde"-tabellen)
  const playedRounds = rounds.filter((r) => r.matches.some((m) => m.home_score !== null && m.home_score !== undefined));

  return { rows, rounds: playedRounds, totalMatches, playedMatches, isComplete };
}

// ---------- runde-navigation (bruges af Forudsigelser og Resultater) ----------
function RoundPager({ rounds, index, setIndex }) {
  if (!rounds.length) return null;
  const round = rounds[index];
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 10 }}>
      <button style={ghostNavBtn} disabled={index <= 0} onClick={() => setIndex(Math.max(0, index - 1))}>← Forrige</button>
      <div style={{ color: "#f4f1e8", fontWeight: 700, fontSize: 15, textAlign: "center" }}>
        Runde {round.label}
        <div style={{ color: "#7fa38c", fontWeight: 400, fontSize: 12 }}>({index + 1} af {rounds.length})</div>
      </div>
      <button style={ghostNavBtn} disabled={index >= rounds.length - 1} onClick={() => setIndex(Math.min(rounds.length - 1, index + 1))}>Næste →</button>
    </div>
  );
}

// ---------- small UI atoms ----------
function ScoreInput({ value, onChange, disabled }) {
  return (
    <input type="number" min="0" max="20" disabled={disabled}
      value={value === null || value === undefined ? "" : value}
      onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Math.min(20, Number(e.target.value))))}
      style={{ width: 40, textAlign: "center", fontFamily: "ui-monospace, monospace", fontSize: 16, fontWeight: 700,
        background: disabled ? "#1c2f27" : "#0f2019", color: "#f4f1e8", border: "1px solid #2c4a3c", borderRadius: 6, padding: "4px 2px" }} />
  );
}
function TabButton({ active, onClick, icon: Icon, children }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 10,
      border: "1px solid " + (active ? "#d4a73c" : "transparent"),
      background: active ? "rgba(212,167,60,0.12)" : "transparent",
      color: active ? "#d4a73c" : "#cfd8d1", fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
    }}>
      <Icon size={16} />{children}
    </button>
  );
}

// ================= APP ROOT =================
export default function App() {
  const [session, setSession] = useState(null); // {access_token, refresh_token, user}
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
    // nulstil-kodeord-link? (#access_token=...&type=recovery)
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hash.get("type") === "recovery" && hash.get("access_token")) {
      setRecoveryToken(hash.get("access_token"));
      setBooting(false);
      return;
    }
    // invitationslink? (?join=KODE)
    const params = new URLSearchParams(window.location.search);
    const join = params.get("join");
    if (join) setPendingJoinCode(join);

    // genopret gemt session, hvis der er en
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

  // forny access token stille og roligt hvert 45. minut, så man forbliver logget ind
  useEffect(() => {
    if (!session?.refresh_token) return;
    const id = setInterval(async () => {
      try {
        const res = await auth.refresh(session.refresh_token);
        setSession((s) => ({ ...s, access_token: res.access_token, refresh_token: res.refresh_token }));
        saveSession({ refresh_token: res.refresh_token, user: session.user });
      } catch (e) { /* ignorer — næste handling beder om login, hvis nødvendigt */ }
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
      <div style={wrap}>
        <style>{globalCss}</style>
        <div style={{ display: "flex", gap: 10, color: "#cfd8d1" }}><Loader2 className="spin" size={20} />Henter …</div>
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

// ================= RESET PASSWORD SCREEN =================
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
    <div style={{ ...wrap, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 480 }}>
      <div className="card" style={{ ...cardStyle, width: 320 }}>
        <h2 style={{ ...h3, fontSize: 20, marginBottom: 4 }}><Trophy size={20} style={{ verticalAlign: -3, marginRight: 6, color: "#d4a73c" }} />Nyt kodeord</h2>
        {done ? (
          <>
            <p style={{ color: "#7fd48a", fontSize: 14, marginTop: 10 }}>Kodeord opdateret! Du kan nu logge ind.</p>
            <button style={{ ...primaryBtn, width: "100%", justifyContent: "center", marginTop: 10 }} onClick={onDone}>Til login</button>
          </>
        ) : (
          <>
            <p style={muted}>Vælg et nyt kodeord til din konto.</p>
            <input className="field" style={fieldFull} type="password" placeholder="Nyt kodeord" value={password} onChange={(e) => setPassword(e.target.value)} />
            <input className="field" style={fieldFull} type="password" placeholder="Gentag kodeord" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {error && <p style={{ color: "#e08a7a", fontSize: 13 }}>{error}</p>}
            <button style={{ ...primaryBtn, width: "100%", justifyContent: "center", marginTop: 6 }} onClick={submit} disabled={loading}>
              {loading ? <Loader2 size={16} className="spin" /> : "Gem nyt kodeord"}
            </button>
          </>
        )}
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ================= AUTH SCREEN =================
function AuthScreen({ onAuthed, booting }) {
  const [mode, setMode] = useState("signin"); // signin | signup | forgot
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
    <div style={{ ...wrap, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 480 }}>
      <div className="card" style={{ ...cardStyle, width: 320 }}>
        <h2 style={{ ...h3, fontSize: 20, marginBottom: 4 }}><Trophy size={20} style={{ verticalAlign: -3, marginRight: 6, color: "#d4a73c" }} />Prediction Champ</h2>
        <p style={muted}>{mode === "signin" ? "Log ind" : mode === "signup" ? "Opret konto" : "Nulstil kodeord"}</p>
        {mode === "signup" && (
          <input className="field" style={fieldFull} placeholder="Brugernavn (vises for andre)" value={username} onChange={(e) => setUsername(e.target.value)} />
        )}
        <input className="field" style={fieldFull} placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
        {mode !== "forgot" && (
          <input className="field" style={fieldFull} type="password" placeholder="Adgangskode" value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
        {error && <p style={{ color: "#e08a7a", fontSize: 13 }}>{error}</p>}
        {info && <p style={{ color: "#7fd48a", fontSize: 13 }}>{info}</p>}
        <button style={{ ...primaryBtn, width: "100%", justifyContent: "center", marginTop: 6 }} onClick={submit} disabled={loading || booting}>
          {loading || booting ? <Loader2 size={16} className="spin" /> : mode === "signin" ? "Log ind" : mode === "signup" ? "Opret konto" : "Send nulstillingslink"}
        </button>
        {mode === "signin" && (
          <p style={{ ...muted, marginTop: 10, textAlign: "center", cursor: "pointer" }}
            onClick={() => { setMode("forgot"); setError(""); setInfo(""); }}>
            Glemt kodeord?
          </p>
        )}
        <p style={{ ...muted, marginTop: 6, textAlign: "center", cursor: "pointer" }}
          onClick={() => { setMode(mode === "signup" ? "signin" : mode === "forgot" ? "signin" : "signup"); setError(""); setInfo(""); }}>
          {mode === "signup" ? "Har du allerede en konto? Log ind" : mode === "forgot" ? "Tilbage til login" : "Ny bruger? Opret konto"}
        </p>
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ================= MAIN APP (logged in) =================
function MainApp({ session, profile, onLogout, pendingJoinCode, clearPendingJoinCode }) {
  const token = session.access_token;
  const [tab, setTab] = useState("competitions");
  const [loading, setLoading] = useState(true);
  const [leagues, setLeagues] = useState([]);
  const [filterLeagueIds, setFilterLeagueIds] = useState(null); // null = alle (ingen filter)
  const [competitions, setCompetitions] = useState([]);
  const [selectedCompId, setSelectedCompId] = useState(null);
  const isAdmin = !!profile?.is_admin;

  async function loadLeagues() {
    const ls = await db.select(token, "leagues", "select=*&order=name");
    setLeagues(ls);
    return ls;
  }

  async function loadCompetitions() {
    const myComps = await db.select(token, "competition_participants", `user_id=eq.${session.user.id}&select=competition_id,hidden`);
    if (myComps.length) {
      const hiddenMap = Object.fromEntries(myComps.map((c) => [c.competition_id, !!c.hidden]));
      const ids = myComps.map((c) => c.competition_id).join(",");
      const comps = await db.select(token, "competitions", `id=in.(${ids})&select=*`);
      const merged = comps.map((c) => ({ ...c, _hidden: hiddenMap[c.id] || false }));
      setCompetitions(merged);
      if (!selectedCompId && merged.length) setSelectedCompId(merged[0].id);
    } else {
      setCompetitions([]);
    }
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
          const already = await db.select(token, "competition_participants", `competition_id=eq.${found[0].id}&user_id=eq.${session.user.id}&select=competition_id`);
          if (!already.length) {
            await db.insert(token, "competition_participants", [{ competition_id: found[0].id, user_id: session.user.id }]);
          }
          await loadCompetitions();
          setSelectedCompId(found[0].id);
          setTab("predictions");
        }
      } catch (e) { /* ignorer — koden findes måske ikke */ }
      clearPendingJoinCode();
      const url = new URL(window.location.href);
      url.searchParams.delete("join");
      window.history.replaceState({}, "", url.toString());
    })();
  }, [pendingJoinCode]); // eslint-disable-line

  const visibleLeagues = leagues.filter((l) => l.is_visible !== false);
  const activeFilterIds = filterLeagueIds || visibleLeagues.map((l) => l.id);
  const filteredCompetitions = competitions.filter((c) => !c.league_id || activeFilterIds.includes(c.league_id));

  function toggleLeagueFilter(id) {
    setFilterLeagueIds((cur) => {
      const base = cur || visibleLeagues.map((l) => l.id);
      if (base.includes(id)) {
        const next = base.filter((x) => x !== id);
        return next.length ? next : base; // aldrig helt tom
      }
      return [...base, id];
    });
  }

  if (loading) {
    return <div style={wrap}><div style={{ display: "flex", gap: 10, color: "#cfd8d1" }}><Loader2 className="spin" size={20} />Henter data …</div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;
  }

  return (
    <div style={wrap}>
      <style>{globalCss}</style>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 2, color: "#d4a73c", fontWeight: 700, marginBottom: 4 }}>PREDICTION CHAMP</div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#f4f1e8" }}>
            <Trophy size={24} style={{ verticalAlign: -4, marginRight: 8, color: "#d4a73c" }} />Prediction Champ
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "#9fb3a5" }}>{profile?.display_name}</span>
          <button onClick={onLogout} style={ghostBtn}><LogOut size={14} />Log ud</button>
        </div>
      </header>

      {visibleLeagues.length > 1 && (tab === "competitions" || tab === "predictions" || tab === "board") && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: "#7fa38c", fontSize: 11, marginBottom: 6, letterSpacing: 1 }}>FILTRÉR PÅ LIGA</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {visibleLeagues.map((l) => {
              const active = activeFilterIds.includes(l.id);
              return (
                <button key={l.id} onClick={() => toggleLeagueFilter(l.id)} style={{
                  padding: "6px 14px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer",
                  border: "1px solid " + (active ? "#d4a73c" : "#2c4a3c"),
                  background: active ? "rgba(212,167,60,0.15)" : "transparent",
                  color: active ? "#d4a73c" : "#9fb3a5",
                }}>{active ? "✓ " : ""}{l.name}</button>
              );
            })}
          </div>
        </div>
      )}

      <nav style={{ display: "flex", gap: 6, marginBottom: 20, overflowX: "auto", paddingBottom: 4 }}>
        <TabButton active={tab === "competitions"} onClick={() => setTab("competitions")} icon={Users}>Konkurrencer</TabButton>
        <TabButton active={tab === "predictions"} onClick={() => setTab("predictions")} icon={ClipboardList}>Forudsigelser</TabButton>
        <TabButton active={tab === "board"} onClick={() => setTab("board")} icon={BarChart3}>Stilling</TabButton>
        <TabButton active={tab === "rules"} onClick={() => setTab("rules")} icon={Info}>Regler</TabButton>
        {isAdmin && <TabButton active={tab === "matches"} onClick={() => setTab("matches")} icon={CalendarDays}>Kampe</TabButton>}
        {isAdmin && <TabButton active={tab === "results"} onClick={() => setTab("results")} icon={ClipboardList}>Resultater</TabButton>}
      </nav>

      {tab === "competitions" && (
        <CompetitionsTab token={token} userId={session.user.id} leagues={visibleLeagues}
          competitions={filteredCompetitions} selectedCompId={selectedCompId} setSelectedCompId={setSelectedCompId} reload={loadAll}
          goToBoard={(id) => { setSelectedCompId(id); setTab("board"); }} />
      )}
      {tab === "matches" && isAdmin && (
        <MatchesTab token={token} leagues={leagues} reloadLeagues={loadLeagues} />
      )}
      {tab === "predictions" && (
        <PredictionsTab token={token} userId={session.user.id} competitions={filteredCompetitions}
          selectedCompId={selectedCompId} setSelectedCompId={setSelectedCompId} />
      )}
      {tab === "results" && isAdmin && (
        <ResultsTab token={token} leagues={leagues} />
      )}
      {tab === "board" && (
        <BoardTab token={token} competitions={filteredCompetitions} selectedCompId={selectedCompId} setSelectedCompId={setSelectedCompId} />
      )}
      {tab === "rules" && <RulesTab />}
    </div>
  );
}

// ================= TAB: RULES =================
function RulesTab() {
  const Row = ({ label, value, color }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #1f3a2c" }}>
      <span style={{ color: "#cfd8d1", fontSize: 14 }}>{label}</span>
      <span className="pill" style={{ background: "#1c3d2c", color: color || "#d4a73c", fontWeight: 700 }}>{value}</span>
    </div>
  );
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <h3 style={h3}>Pointsystem</h3>
        <p style={muted}>Sådan beregnes point for hver kamp, du har forudsagt.</p>
        <Row label="Korrekt resultat (fx gættet 2-1, endte 2-1)" value="+3 point" color="#d4a73c" />
        <Row label="Korrekt udfald (rigtig vinder/uafgjort, forkert resultat)" value="+1 point" color="#7fd48a" />
        <Row label="Forkert gæt (uden nogen af de to nedenstående)" value="0 point" />
        <Row label="Gættede en vinder, men det modsatte hold vandt — eller gættede en vinder, men målforskellen ramte mere end 5 mål forkert" value="−1 point" color="#e08a7a" />
        <Row label="Begge ovenstående på samme tid (helt galt på den)" value="−2 point" color="#e08a7a" />
        <p style={{ ...muted, marginTop: 10 }}>
          Straf gælder <strong>aldrig</strong>, hvis du gættede uafgjort — der er kun nedside ved at gætte på en vinder.
        </p>
      </div>

      <div className="card">
        <h3 style={h3}>Hvornår låses en forudsigelse?</h3>
        <p style={{ color: "#cfd8d1", fontSize: 14 }}>
          Din forudsigelse låses automatisk <strong>1 time før kampens starttidspunkt</strong> — derefter kan hverken
          du eller andre ændre den. Er kampen allerede afgjort (resultatet er kendt), er den også låst.
        </p>
      </div>

      <div className="card">
        <h3 style={h3}>Runder</h3>
        <p style={{ color: "#cfd8d1", fontSize: 14 }}>
          En runde løber fra <strong>tirsdag til og med mandag</strong>. Kampe grupperes automatisk i runder ud fra
          deres kickoff-tidspunkt.
        </p>
      </div>
    </div>
  );
}
function CompetitionsTab({ token, userId, leagues, competitions, selectedCompId, setSelectedCompId, reload, goToBoard }) {
  const [createLeagueId, setCreateLeagueId] = useState(leagues[0]?.id || "");
  const [createSeason, setCreateSeason] = useState(null);
  const [createTeams, setCreateTeams] = useState([]);
  const [name, setName] = useState("");
  const [mode, setMode] = useState("full_season");
  const [teamId, setTeamId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [statusMap, setStatusMap] = useState({}); // { [compId]: { isComplete, playedMatches, totalMatches, winner } }
  const [showArchived, setShowArchived] = useState(false);
  // til custom/random: kommende kampe på tværs af ligaer
  const [upcoming, setUpcoming] = useState([]); // [{match, leagueName}]
  const [upcomingTeams, setUpcomingTeams] = useState({});
  const [pickedIds, setPickedIds] = useState([]);
  const [pickLeagueIds, setPickLeagueIds] = useState(null); // null = alle (filter i håndplukket-vælgeren)
  const [randomCount, setRandomCount] = useState(6);
  const [randomLeagueIds, setRandomLeagueIds] = useState(null); // null = alle

  useEffect(() => {
    if (!createLeagueId && leagues.length) setCreateLeagueId(leagues[0].id);
  }, [leagues]); // eslint-disable-line

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

  // hent kommende kampe på tværs af alle synlige ligaer (til håndplukket/tilfældig)
  useEffect(() => {
    if (mode !== "custom" && mode !== "random") return;
    (async () => {
      const leagueIds = leagues.map((l) => l.id);
      if (!leagueIds.length) return;
      const seasons = await db.select(token, "seasons", `league_id=in.(${leagueIds.join(",")})&select=id,league_id&order=start_date.desc`);
      // nyeste sæson pr. liga
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(competitions.map(async (c) => {
        const rules = c.rules || { exact: 3, outcome: 1, wrongWinPenalty: 1 };
        const state = await computeCompetitionState(token, c.id, rules);
        const winner = state.isComplete && state.rows.length ? state.rows[0] : null;
        return [c.id, { ...state, winner }];
      }));
      if (!cancelled) setStatusMap(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [competitions]); // eslint-disable-line

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
        // nærmeste kommende runde
        const firstRound = pool.reduce((min, m) => (m.round_key < min ? m.round_key : min), pool[0].round_key);
        const roundPool = pool.filter((m) => m.round_key === firstRound);
        const shuffled = roundPool.slice().sort(() => Math.random() - 0.5);
        matchIds = shuffled.slice(0, Math.max(1, Number(randomCount) || 6)).map((m) => m.id);
      }

      const mode_params = mode === "team" ? { team_id: teamId }
        : mode === "time_range" ? { start_date: startDate, end_date: endDate }
        : mode === "random" ? { count: Number(randomCount) || 6 } : {};
      const rules = { exact: 3, outcome: 1, wrongWinPenalty: 1 };
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
        let query = `season_id=eq.${createSeason.id}&select=id`;
        if (mode === "team" && teamId) query += `&or=(home_team_id.eq.${teamId},away_team_id.eq.${teamId})`;
        if (mode === "time_range" && startDate && endDate) query += `&kickoff_at=gte.${startDate}&kickoff_at=lte.${endDate}T23:59:59`;
        const matchedMatches = await db.select(token, "matches", query);
        if (matchedMatches.length) {
          await db.insert(token, "competition_matches", matchedMatches.map((m) => ({ competition_id: comp.id, match_id: m.id })));
        }
      }
      setName(""); setTeamId(""); setStartDate(""); setEndDate(""); setPickedIds([]);
      await reload();
      setSelectedCompId(comp.id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function joinCompetition() {
    setBusy(true); setErr("");
    try {
      const found = await db.select(token, "competitions", `invite_code=eq.${inviteCode.trim()}&select=*`);
      if (!found.length) { setErr("Ingen konkurrence fundet med den kode"); setBusy(false); return; }
      await db.insert(token, "competition_participants", [{ competition_id: found[0].id, user_id: userId }]);
      setInviteCode("");
      await reload();
      setSelectedCompId(found[0].id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function setArchived(compId, hidden) {
    await db.update(token, "competition_participants", `competition_id=eq.${compId}&user_id=eq.${userId}`, { hidden });
    await reload();
  }

  async function deleteCompetition(comp) {
    if (!window.confirm(`Slet "${comp.name}" for ALLE deltagere? Dette kan ikke fortrydes.`)) return;
    await db.del(token, "competitions", `id=eq.${comp.id}`);
    await reload();
  }

  const modeLabel = (m) => m === "full_season" ? "hel sæson" : m === "team" ? "et hold" : m === "time_range" ? "tidsperiode" : m === "custom" ? "håndplukket" : "tilfældig kupon";

  function CompetitionCard({ c, archived }) {
    const status = statusMap[c.id];
    return (
      <div key={c.id} className="pill" style={{
        background: "#1c3d2c", border: "1px solid transparent",
        cursor: "pointer", padding: "8px 12px", flexDirection: "column", alignItems: "flex-start", gap: 2,
      }} onClick={() => goToBoard(c.id)} title="Se stillingen">
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
          {status?.isComplete && <Trophy size={12} style={{ color: "#d4a73c", marginRight: 2 }} />}
          <span style={{ color: "#f4f1e8", fontWeight: 700 }}>{c.name}</span>
          <span style={{ color: "#7fa38c", fontSize: 12 }}>({modeLabel(c.mode)})</span>
          {(status?.isComplete || archived) && (
            <span style={{ color: "#9fb3a5", fontSize: 11, marginLeft: 6, textDecoration: "underline" }}
              onClick={(e) => { e.stopPropagation(); setArchived(c.id, !archived); }}>
              {archived ? "Gendan" : "Arkivér"}
            </span>
          )}
          {c.created_by === userId && (
            <Trash2 size={12} style={{ color: "#c96a5a", marginLeft: 6 }}
              onClick={(e) => { e.stopPropagation(); deleteCompetition(c); }} />
          )}
        </div>
        {status && !status.isComplete && status.totalMatches > 0 && (
          <span style={{ color: "#7fa38c", fontSize: 11 }}>{status.playedMatches}/{status.totalMatches} kampe spillet</span>
        )}
        {status?.isComplete && status.winner && (
          <span style={{ color: "#d4a73c", fontSize: 11, fontWeight: 700 }}>🏆 Vinder: {status.winner.player} ({status.winner.total} point)</span>
        )}
      </div>
    );
  }

  const visible = competitions.filter((c) => !c._hidden);
  const archivedComps = competitions.filter((c) => c._hidden);
  const active = visible.filter((c) => !statusMap[c.id]?.isComplete);
  const completed = visible.filter((c) => statusMap[c.id]?.isComplete);

  // gruppér kommende kampe pr. runde og liga til plukkeren
  // håndplukket: filtrér vælgeren på valgte ligaer
  const pickAllowed = pickLeagueIds || leagues.map((l) => l.id);
  const upcomingRounds = useMemo(
    () => groupIntoRounds(upcoming.filter((m) => pickAllowed.includes(m._leagueId))),
    [upcoming, pickLeagueIds, leagues] // eslint-disable-line
  );

  // tilfældig: hvor mange kampe er der reelt i den nærmeste kommende runde?
  const randomPool = useMemo(() => {
    const allowed = randomLeagueIds || leagues.map((l) => l.id);
    const pool = upcoming.filter((m) => allowed.includes(m._leagueId));
    if (!pool.length) return [];
    const firstRound = pool.reduce((min, m) => (m.round_key < min ? m.round_key : min), pool[0].round_key);
    return pool.filter((m) => m.round_key === firstRound);
  }, [upcoming, randomLeagueIds, leagues]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <h3 style={h3}>Aktive konkurrencer</h3>
        <p style={{ ...muted, marginTop: -4 }}>Klik på en konkurrence for at se stillingen.</p>
        {competitions.length === 0 && <p style={muted}>Du er ikke med i nogen konkurrencer endnu — opret en, eller join med en kode.</p>}
        {competitions.length > 0 && active.length === 0 && <p style={muted}>Ingen aktive konkurrencer lige nu.</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {active.map((c) => <CompetitionCard key={c.id} c={c} />)}
        </div>
      </div>

      {completed.length > 0 && (
        <div className="card">
          <h3 style={h3}>Afsluttede konkurrencer</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {completed.map((c) => <CompetitionCard key={c.id} c={c} />)}
          </div>
        </div>
      )}

      {archivedComps.length > 0 && (
        <div className="card">
          <span style={{ color: "#9fb3a5", fontSize: 13, cursor: "pointer", textDecoration: "underline" }}
            onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? "Skjul arkiverede" : `Vis arkiverede (${archivedComps.length})`}
          </span>
          {showArchived && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              {archivedComps.map((c) => <CompetitionCard key={c.id} c={c} archived />)}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h3 style={h3}>Join med kode</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="field" style={{ flex: 1 }} placeholder="Invitationskode…" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
          <button style={primaryBtn} onClick={joinCompetition} disabled={busy || !inviteCode}>Join</button>
        </div>
      </div>

      <div className="card">
        <h3 style={h3}>Opret ny konkurrence</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 480 }}>
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
                <span style={{ color: "#cfd8d1", fontSize: 14 }}>Antal kampe:</span>
                <input className="field" type="number" min="1" max={Math.max(1, randomPool.length)} style={{ width: 70 }}
                  value={Math.min(Number(randomCount) || 1, Math.max(1, randomPool.length))}
                  onChange={(e) => setRandomCount(Math.min(Number(e.target.value) || 1, Math.max(1, randomPool.length)))} />
                <span style={{ color: "#7fa38c", fontSize: 12 }}>({randomPool.length} tilgængelige i nærmeste runde)</span>
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
                      }} style={{
                        padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
                        border: "1px solid " + (sel ? "#d4a73c" : "#2c4a3c"),
                        background: sel ? "rgba(212,167,60,0.15)" : "transparent",
                        color: sel ? "#d4a73c" : "#9fb3a5",
                      }}>{sel ? "✓ " : ""}{l.name}</button>
                    );
                  })}
                </div>
              )}
              <p style={muted}>Trækker tilfældige kampe fra den nærmeste kommende runde.</p>
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
                      }} style={{
                        padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
                        border: "1px solid " + (sel ? "#d4a73c" : "#2c4a3c"),
                        background: sel ? "rgba(212,167,60,0.15)" : "transparent",
                        color: sel ? "#d4a73c" : "#9fb3a5",
                      }}>{sel ? "✓ " : ""}{l.name}</button>
                    );
                  })}
                </div>
              )}
              <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid #2c4a3c", borderRadius: 10, padding: 10 }}>
                {upcomingRounds.length === 0 && <p style={muted}>Ingen kommende kampe fundet.</p>}
                {upcomingRounds.map((r) => (
                  <div key={r.key} style={{ marginBottom: 10 }}>
                    <div style={{ color: "#d4a73c", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Runde {r.label}</div>
                    {r.matches.map((m) => {
                      const checked = pickedIds.includes(m.id);
                      return (
                        <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", fontSize: 13 }}>
                          <input type="checkbox" checked={checked} onChange={() =>
                            setPickedIds(checked ? pickedIds.filter((x) => x !== m.id) : [...pickedIds, m.id])
                          } />
                          <span style={{ color: "#f4f1e8" }}>{upcomingTeams[m.home_team_id]} - {upcomingTeams[m.away_team_id]}</span>
                          <span style={{ color: "#7fa38c", fontSize: 11, marginLeft: "auto", whiteSpace: "nowrap" }}>{m._leagueName} · {formatKickoff(m.kickoff_at)}</span>
                        </label>
                      );
                    })}
                  </div>
                ))}
                {pickedIds.length > 0 && <p style={{ ...muted, marginBottom: 0 }}>{pickedIds.length} kampe valgt</p>}
              </div>
            </>
          )}

          {err && <p style={{ color: "#e08a7a", fontSize: 13 }}>{err}</p>}
          <button style={primaryBtn} onClick={createCompetition} disabled={busy || !name}>
            <Plus size={14} /> Opret konkurrence
          </button>
        </div>
      </div>
    </div>
  );
}

// ================= TAB: MATCHES (admin) =================
function MatchesTab({ token, leagues, reloadLeagues }) {
  const [leagueId, setLeagueId] = useState(leagues[0]?.id || "");
  const [teams, setTeams] = useState([]);
  const [matches, setMatches] = useState([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const league = leagues.find((l) => l.id === leagueId) || null;
  const teamsById = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t.name])), [teams]);
  const rounds = useMemo(() => groupIntoRounds(matches), [matches]);

  useEffect(() => {
    if (!leagueId && leagues.length) setLeagueId(leagues[0].id);
  }, [leagues]); // eslint-disable-line

  async function loadData() {
    if (!leagueId) return;
    const tms = await db.select(token, "teams", `league_id=eq.${leagueId}&select=*&order=name`);
    setTeams(tms);
    const seasons = await db.select(token, "seasons", `league_id=eq.${leagueId}&select=id&order=start_date.desc&limit=1`);
    if (seasons[0]) {
      const ms = await db.select(token, "matches", `season_id=eq.${seasons[0].id}&select=*&order=kickoff_at`);
      setMatches(ms);
      setRoundIndex(currentRoundIndex(groupIntoRounds(ms)));
    } else {
      setMatches([]);
    }
  }

  useEffect(() => { loadData(); }, [leagueId]); // eslint-disable-line

  async function syncFromApi() {
    if (!league) return;
    setSyncing(true); setSyncResult(null);
    try {
      const res = await fetch(`/api/sync-matches?leagueId=${league.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setSyncResult(data);
      await reloadLeagues();
      await loadData();
    } catch (e) {
      setSyncResult({ error: e.message });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      {leagues.length > 1 && (
        <div style={{ marginBottom: 16 }}>
          <select className="field" value={leagueId} onChange={(e) => setLeagueId(e.target.value)}>
            {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      )}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h3 style={h3}>Hent kampe og resultater automatisk</h3>
            <p style={muted}>Henter fra Sportmonks for {league?.name || "denne liga"} og opdaterer kampe, tidspunkter og resultater.</p>
          </div>
          <button style={goldBtn} onClick={syncFromApi} disabled={syncing}>
            {syncing ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Hent resultater nu
          </button>
        </div>
        {syncResult && !syncResult.error && (
          <p style={{ color: "#7fd48a", fontSize: 13, marginTop: 10 }}>
            {syncResult.synced} kampe synkroniseret ud af {syncResult.totalFixtures} fundet.
            {syncResult.unmatched?.length > 0 && (
              <span style={{ color: "#e08a7a" }}> Kunne ikke matche hold: {syncResult.unmatched.join(", ")}</span>
            )}
          </p>
        )}
        {syncResult?.error && <p style={{ color: "#e08a7a", fontSize: 13, marginTop: 10 }}>Fejl: {syncResult.error}</p>}
      </div>

      {rounds.length === 0 && <p style={muted}>Ingen kampe endnu.</p>}
      {rounds.length > 0 && (
        <div className="card">
          <RoundPager rounds={rounds} index={roundIndex} setIndex={setRoundIndex} />
          <table><tbody>
            {rounds[roundIndex].matches.map((m) => (
              <tr key={m.id} className="rowline">
                <td style={{ color: "#9fb3a5", fontSize: 13, width: 140 }}>{formatKickoff(m.kickoff_at)}</td>
                <td style={{ color: "#f4f1e8", fontWeight: 600 }}>{teamsById[m.home_team_id]} <span style={{ color: "#7fa38c" }}>vs</span> {teamsById[m.away_team_id]}</td>
                <td style={{ textAlign: "right" }}>
                  {m.home_score !== null ? <span className="pill" style={{ background: "#2c4a3c", color: "#d4a73c" }}>{m.home_score} - {m.away_score}</span>
                    : <span className="pill" style={{ background: "#1c3d2c", color: "#7fa38c" }}>Ikke spillet</span>}
                </td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </div>
  );
}

// ================= TAB: PREDICTIONS =================
function PredictionsTab({ token, userId, competitions, selectedCompId, setSelectedCompId }) {
  const [compFilter, setCompFilter] = useState("all"); // "all" eller et konkurrence-id
  const [allMatches, setAllMatches] = useState([]);
  const [preds, setPreds] = useState({});
  const [allPreds, setAllPreds] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [teamsById, setTeamsById] = useState({});
  const [loading, setLoading] = useState(false);
  const [roundIndex, setRoundIndex] = useState(0);
  const [savedIds, setSavedIds] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [, setTick] = useState(0);
  const comp = compFilter !== "all" ? competitions.find((c) => c.id === compFilter) : null;
  const rules = comp?.rules || { exact: 3, outcome: 1, wrongWinPenalty: 1 };

  // genberegn nedtælling/låsning hvert minut
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
      const cms = await db.select(token, "competition_matches", `competition_id=in.(${compIds.join(",")})&select=match_id`);
      const ids = [...new Set(cms.map((c) => c.match_id))];
      if (!ids.length) { setAllMatches([]); setTeamsById({}); setLoading(false); return; }
      const ms = await db.select(token, "matches", `id=in.(${ids.join(",")})&select=*&order=kickoff_at`);
      setAllMatches(ms);
      const teamIds = [...new Set(ms.flatMap((m) => [m.home_team_id, m.away_team_id]))];
      if (teamIds.length) {
        const tms = await db.select(token, "teams", `id=in.(${teamIds.join(",")})&select=id,name`);
        setTeamsById(Object.fromEntries(tms.map((t) => [t.id, t.name])));
      }
      // henter ALLE forudsigelser — databasen udleverer kun andres for låste kampe
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
    } catch (e) { /* fejl vises ikke — næste forsøg overskriver */ }
  }

  function lockCountdown(m) {
    if (!m.kickoff_at) return null;
    const msLeft = new Date(m.kickoff_at).getTime() - 60 * 60 * 1000 - Date.now();
    if (msLeft <= 0 || msLeft > 24 * 3600 * 1000) return null;
    const hours = Math.floor(msLeft / 3600000);
    const mins = Math.floor((msLeft % 3600000) / 60000);
    return hours > 0 ? `Låser om ${hours} t ${mins} min` : `Låser om ${mins} min`;
  }

  if (!competitions.length) return <p style={muted}>Opret eller join en konkurrence først.</p>;

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <select className="field" value={compFilter} onChange={(e) => setCompFilter(e.target.value)}>
          <option value="all">Alle konkurrencer</option>
          {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {loading && <p style={muted}>Henter kampe…</p>}
      {!loading && rounds.length === 0 && <p style={muted}>Ingen kampe i denne konkurrence endnu.</p>}
      {!loading && rounds.length > 0 && (
        <div className="card">
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
              const expanded = expandedId === m.id;
              const matchPreds = locked ? allPreds.filter((p) => p.match_id === m.id) : [];

              return (
                <div key={m.id} className="rowline" style={{ padding: "12px 0" }}>
                  <div style={{ color: "#f4f1e8", fontWeight: 600 }}>{teamsById[m.home_team_id]} - {teamsById[m.away_team_id]}</div>
                  <div style={{ color: "#7fa38c", fontSize: 12, marginTop: 2, marginBottom: 10 }}>
                    {formatKickoff(m.kickoff_at)}
                    {!played && locked && <span style={{ color: "#c96a5a", marginLeft: 8 }}>· Låst</span>}
                    {countdown && <span style={{ color: "#d4a73c", marginLeft: 8 }}>· {countdown}</span>}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <ScoreInput value={pred.pred_home} onChange={(v) => save(m.id, "pred_home", v)} disabled={locked} />
                      <span style={{ color: "#7fa38c" }}>-</span>
                      <ScoreInput value={pred.pred_away} onChange={(v) => save(m.id, "pred_away", v)} disabled={locked} />
                      {savedIds[m.id] && <Check size={16} style={{ color: "#7fd48a" }} />}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {played && (
                        <>
                          <span className="pill" style={{
                            background: !hasPred ? "#1c3d2c" : correctOutcome ? "rgba(80,180,110,0.18)" : "rgba(201,106,90,0.18)",
                            color: !hasPred ? "#7fa38c" : correctOutcome ? "#7fd48a" : "#e08a7a",
                            border: exact ? "2px solid #d4a73c" : "1px solid transparent",
                            fontSize: 15, padding: "6px 12px", whiteSpace: "nowrap",
                          }}>{m.home_score} - {m.away_score}</span>
                          {hasPred && <span style={{ fontSize: 12, color: "#9fb3a5", whiteSpace: "nowrap" }}>{pts > 0 ? `+${pts}` : pts} point</span>}
                        </>
                      )}
                      {locked && participants.length > 1 && (
                        <span onClick={() => setExpandedId(expanded ? null : m.id)}
                          style={{ fontSize: 12, color: "#d4a73c", cursor: "pointer", whiteSpace: "nowrap", textDecoration: "underline" }}>
                          {expanded ? "Skjul gæt" : "Alles gæt"}
                        </span>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <div style={{ marginTop: 10, padding: "10px 12px", background: "#0f2a1e", borderRadius: 10 }}>
                      {participants.map((p) => {
                        const pp = matchPreds.find((x) => x.user_id === p.id);
                        const ppts = played && pp ? pointsFor(pp, m, rules) : null;
                        return (
                          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 13 }}>
                            <span style={{ color: p.id === userId ? "#d4a73c" : "#cfd8d1", fontWeight: p.id === userId ? 700 : 400 }}>{p.display_name}</span>
                            <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
                              <span style={{ color: "#f4f1e8", fontFamily: "ui-monospace, monospace" }}>
                                {pp ? `${pp.pred_home} - ${pp.pred_away}` : "–"}
                              </span>
                              {ppts !== null && (
                                <span style={{ color: ppts > 0 ? "#7fd48a" : ppts < 0 ? "#e08a7a" : "#7fa38c", minWidth: 28, textAlign: "right" }}>
                                  {ppts > 0 ? `+${ppts}` : ppts}
                                </span>
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
        </div>
      )}
    </div>
  );
}

// ================= TAB: RESULTS (manuel indtastning) =================
function ResultsTab({ token, leagues }) {
  const [leagueId, setLeagueId] = useState(leagues[0]?.id || "");
  const [teams, setTeams] = useState([]);
  const [matches, setMatches] = useState([]);
  const [roundIndex, setRoundIndex] = useState(0);

  const teamsById = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t.name])), [teams]);
  const rounds = useMemo(() => groupIntoRounds(matches), [matches]);
  const round = rounds[roundIndex];

  useEffect(() => {
    if (!leagueId && leagues.length) setLeagueId(leagues[0].id);
  }, [leagues]); // eslint-disable-line

  async function loadData() {
    if (!leagueId) return;
    const tms = await db.select(token, "teams", `league_id=eq.${leagueId}&select=*&order=name`);
    setTeams(tms);
    const seasons = await db.select(token, "seasons", `league_id=eq.${leagueId}&select=id&order=start_date.desc&limit=1`);
    if (seasons[0]) {
      const ms = await db.select(token, "matches", `season_id=eq.${seasons[0].id}&select=*&order=kickoff_at`);
      setMatches(ms);
      setRoundIndex(currentRoundIndex(groupIntoRounds(ms)));
    } else {
      setMatches([]);
    }
  }

  useEffect(() => { loadData(); }, [leagueId]); // eslint-disable-line

  async function setScore(id, field, val) {
    await db.update(token, "matches", `id=eq.${id}`, { [field]: val, status: "finished" });
    const tmsSeasons = await db.select(token, "seasons", `league_id=eq.${leagueId}&select=id&order=start_date.desc&limit=1`);
    if (tmsSeasons[0]) {
      const ms = await db.select(token, "matches", `season_id=eq.${tmsSeasons[0].id}&select=*&order=kickoff_at`);
      setMatches(ms);
    }
  }

  return (
    <div>
      {leagues.length > 1 && (
        <div style={{ marginBottom: 16 }}>
          <select className="field" value={leagueId} onChange={(e) => setLeagueId(e.target.value)}>
            {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      )}
      {rounds.length === 0 ? (
        <p style={muted}>Ingen kampe endnu — tilføj under "Kampe".</p>
      ) : (
        <div className="card">
          <p style={{ ...muted, marginBottom: 4 }}>Indtast faktiske resultater manuelt. Stillingen opdateres automatisk.</p>
          <RoundPager rounds={rounds} index={roundIndex} setIndex={setRoundIndex} />
          <table><tbody>
            {round.matches.map((m) => (
              <tr key={m.id} className="rowline">
                <td style={{ padding: "10px 10px" }}>
                  <div style={{ color: "#f4f1e8", fontWeight: 600 }}>{teamsById[m.home_team_id]} vs {teamsById[m.away_team_id]}</div>
                  <div style={{ color: "#7fa38c", fontSize: 12, marginTop: 2 }}>{formatKickoff(m.kickoff_at)}</div>
                </td>
                <td>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <ScoreInput value={m.home_score} onChange={(v) => setScore(m.id, "home_score", v)} />
                    <span style={{ color: "#7fa38c" }}>-</span>
                    <ScoreInput value={m.away_score} onChange={(v) => setScore(m.id, "away_score", v)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </div>
  );
}

// ================= TAB: BOARD (leaderboard) =================
function BoardTab({ token, competitions, selectedCompId, setSelectedCompId }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAllRounds, setShowAllRounds] = useState(false);
  const comp = competitions.find((c) => c.id === selectedCompId);

  useEffect(() => {
    if (!selectedCompId || !comp) return;
    (async () => {
      setLoading(true);
      setShowAllRounds(false);
      const rules = comp.rules || { exact: 3, outcome: 1, wrongWinPenalty: 1 };
      const result = await computeCompetitionState(token, selectedCompId, rules);
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

  if (!competitions.length) return <p style={muted}>Opret eller join en konkurrence først.</p>;

  // nyeste runder først; vis kun 3 medmindre "vis alle"
  const roundsDesc = state?.rounds ? state.rounds.slice().reverse() : [];
  const shownRounds = showAllRounds ? roundsDesc : roundsDesc.slice(0, 3);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <select className="field" value={selectedCompId || ""} onChange={(e) => setSelectedCompId(e.target.value)}>
          {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button style={goldBtn} onClick={copyInviteLink}>
          {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Link kopieret!" : "Invitér ven"}
        </button>
      </div>
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <h3 style={{ ...h3, marginBottom: 0 }}>Stilling</h3>
          {state?.isComplete
            ? <span className="pill" style={{ background: "rgba(212,167,60,0.15)", color: "#d4a73c" }}><Trophy size={12} style={{ marginRight: 4 }} />Afsluttet</span>
            : state && state.totalMatches > 0 && <span className="pill" style={{ background: "#1c3d2c", color: "#7fa38c" }}>{state.playedMatches}/{state.totalMatches} kampe spillet</span>}
        </div>
        {loading && <p style={muted}>Beregner…</p>}
        {!loading && state && (
          <table><tbody>
            {state.rows.map((r, i) => (
              <tr key={r.player} className="rowline">
                <td style={{ color: i === 0 ? "#d4a73c" : "#7fa38c", fontWeight: 700 }}>
                  {i === 0 && state.isComplete ? "🏆" : i + 1}
                </td>
                <td style={{ color: "#f4f1e8", fontWeight: 600 }}>{r.player}</td>
                <td style={{ textAlign: "right" }}>
                  <span className="pill" style={{ background: i === 0 ? "#3a3010" : "#1c3d2c", color: i === 0 ? "#d4a73c" : "#e7ecdf", fontSize: 15 }}>{r.total}</span>
                </td>
              </tr>
            ))}
          </tbody></table>
        )}
        {!loading && state && state.rows.length === 0 && <p style={muted}>Ingen deltagere endnu.</p>}
      </div>

      {!loading && state && roundsDesc.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={h3}>Point pr. runde</h3>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr className="rowline">
                  <th style={{ color: "#9fb3a5", fontSize: 13 }}>Runde</th>
                  {state.rows.map((row) => (
                    <th key={row.player} style={{ color: "#9fb3a5", fontSize: 12, textAlign: "center", whiteSpace: "nowrap" }}>{row.player}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownRounds.map((r) => {
                  const best = Math.max(...state.rows.map((x) => x.perRound[r.key] ?? -Infinity));
                  return (
                    <tr key={r.key} className="rowline">
                      <td style={{ color: "#cfd8d1", fontSize: 13, whiteSpace: "nowrap" }}>{r.label}</td>
                      {state.rows.map((row) => {
                        const v = row.perRound[r.key];
                        const isBest = v !== undefined && v === best && v > 0;
                        return (
                          <td key={row.player} style={{ textAlign: "center", color: isBest ? "#d4a73c" : "#cfd8d1", fontWeight: isBest ? 700 : 400 }}>
                            {v ?? "–"}
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
        </div>
      )}
    </div>
  );
}

// ---------- styles ----------
const wrap = { minHeight: "100%", background: "#0b2318", color: "#f4f1e8", fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", padding: 24, borderRadius: 16 };
const cardStyle = { background: "#123526", border: "1px solid #244a37", borderRadius: 14, padding: 18 };
const h3 = { margin: "0 0 6px 0", fontSize: 16, fontWeight: 700, color: "#f4f1e8" };
const muted = { color: "#7fa38c", fontSize: 13, margin: "0 0 10px 0" };
const fieldFull = { width: "100%", marginBottom: 10, display: "block" };
const primaryBtn = { display: "flex", alignItems: "center", gap: 6, background: "#d4a73c", color: "#0b2318", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer", fontSize: 14 };
const goldBtn = { display: "flex", alignItems: "center", gap: 6, background: "#1c3d2c", color: "#d4a73c", border: "1px solid #d4a73c", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer", fontSize: 14 };
const ghostBtn = { display: "flex", alignItems: "center", gap: 6, background: "transparent", color: "#c96a5a", border: "1px solid #4a2c2c", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontWeight: 700 };
const ghostNavBtn = { background: "#1c3d2c", color: "#d4a73c", border: "1px solid #2c4a3c", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const globalCss = `
  * { box-sizing: border-box; }
  input, select, button { font-family: inherit; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 8px 10px; text-align: left; }
  .card { background: #123526; border: 1px solid #244a37; border-radius: 14px; padding: 18px; }
  .pill { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:700; }
  .field { background:#0f2019; border:1px solid #2c4a3c; color:#f4f1e8; border-radius:8px; padding:8px 10px; font-size:14px; }
  .rowline { border-bottom: 1px solid #1f3a2c; }
  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;
