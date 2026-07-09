import { useState, useEffect, useMemo } from "react";
import { Trophy, Plus, Trash2, Users, CalendarDays, ClipboardList, BarChart3, Loader2, LogOut, Copy, Check } from "lucide-react";

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
};
const auth = {
  signUp: (email, password) =>
    restFetch(`/auth/v1/signup`, { method: "POST", body: { email, password } }),
  signIn: (email, password) =>
    restFetch(`/auth/v1/token?grant_type=password`, { method: "POST", body: { email, password } }),
};

// ---------- scoring helpers ----------
function outcome(h, a) { return h === a ? "X" : h > a ? "1" : "2"; }
function pointsFor(pred, actual, rules) {
  if (!pred || actual.home_score === null || actual.away_score === null) return null;
  if (pred.pred_home === actual.home_score && pred.pred_away === actual.away_score) return rules.exact;
  if (outcome(pred.pred_home, pred.pred_away) === outcome(actual.home_score, actual.away_score)) return rules.outcome;
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

  const rows = profiles.map((p) => {
    let total = 0;
    for (const m of ms) {
      const pred = preds.find((pr) => pr.match_id === m.id && pr.user_id === p.id);
      const pts = pointsFor(pred, m, rules);
      if (pts !== null) total += pts;
    }
    return { player: p.display_name, total };
  }).sort((a, b) => b.total - a.total);

  const totalMatches = ms.length;
  const playedMatches = ms.filter((m) => m.home_score !== null && m.home_score !== undefined).length;
  const isComplete = totalMatches > 0 && playedMatches === totalMatches;

  return { rows, totalMatches, playedMatches, isComplete };
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
  const [session, setSession] = useState(null); // {access_token, user}
  const [profile, setProfile] = useState(null);
  const [booting, setBooting] = useState(false);

  return (
    <>
      <style>{globalCss}</style>
      {!session ? (
        <AuthScreen onAuthed={async ({ access_token, user }, chosenUsername) => {
          setBooting(true);
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
          setSession({ access_token, user });
          setBooting(false);
        }} booting={booting} />
      ) : (
        <MainApp session={session} profile={profile} onLogout={() => { setSession(null); setProfile(null); }} />
      )}
    </>
  );
}

// ================= AUTH SCREEN =================
function AuthScreen({ onAuthed, booting }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(""); setLoading(true);
    try {
      if (mode === "signup") {
        if (!username.trim()) { setError("Vælg et brugernavn"); setLoading(false); return; }
        const res = await auth.signUp(email, password);
        if (res.access_token) { await onAuthed(res, username.trim()); return; }
        setError("Konto oprettet. Tjek om der kræves e-mail-bekræftelse i Supabase-projektet, log derefter ind.");
        setMode("signin");
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
        <p style={muted}>{mode === "signin" ? "Log ind" : "Opret konto"}</p>
        {mode === "signup" && (
          <input className="field" style={fieldFull} placeholder="Brugernavn (vises for andre)" value={username} onChange={(e) => setUsername(e.target.value)} />
        )}
        <input className="field" style={fieldFull} placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="field" style={fieldFull} type="password" placeholder="Adgangskode" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p style={{ color: "#e08a7a", fontSize: 13 }}>{error}</p>}
        <button style={{ ...primaryBtn, width: "100%", justifyContent: "center", marginTop: 6 }} onClick={submit} disabled={loading || booting}>
          {loading || booting ? <Loader2 size={16} className="spin" /> : mode === "signin" ? "Log ind" : "Opret konto"}
        </button>
        <p style={{ ...muted, marginTop: 14, textAlign: "center", cursor: "pointer" }}
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "Ny bruger? Opret konto" : "Har du allerede en konto? Log ind"}
        </p>
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ================= MAIN APP (logged in) =================
function MainApp({ session, profile, onLogout }) {
  const token = session.access_token;
  const [tab, setTab] = useState("competitions");
  const [loading, setLoading] = useState(true);
  const [league, setLeague] = useState(null);
  const [season, setSeason] = useState(null);
  const [teams, setTeams] = useState([]);
  const [matches, setMatches] = useState([]);
  const [competitions, setCompetitions] = useState([]);
  const [selectedCompId, setSelectedCompId] = useState(null);

  async function loadAll() {
    setLoading(true);
    const leagues = await db.select(token, "leagues", "select=*&limit=1");
    const l = leagues[0];
    setLeague(l);
    if (l) {
      const seasons = await db.select(token, "seasons", `league_id=eq.${l.id}&select=*&limit=1`);
      setSeason(seasons[0]);
      const tms = await db.select(token, "teams", `league_id=eq.${l.id}&select=*&order=name`);
      setTeams(tms);
      if (seasons[0]) {
        const ms = await db.select(token, "matches", `season_id=eq.${seasons[0].id}&select=*&order=kickoff_at`);
        setMatches(ms);
      }
    }
    const myComps = await db.select(token, "competition_participants", `user_id=eq.${session.user.id}&select=competition_id`);
    if (myComps.length) {
      const ids = myComps.map((c) => c.competition_id).join(",");
      const comps = await db.select(token, "competitions", `id=in.(${ids})&select=*`);
      setCompetitions(comps);
      if (!selectedCompId && comps.length) setSelectedCompId(comps[0].id);
    } else {
      setCompetitions([]);
    }
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []); // eslint-disable-line

  const teamsById = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t.name])), [teams]);

  if (loading) {
    return <div style={wrap}><div style={{ display: "flex", gap: 10, color: "#cfd8d1" }}><Loader2 className="spin" size={20} />Henter data …</div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;
  }

  return (
    <div style={wrap}>
      <style>{globalCss}</style>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 2, color: "#d4a73c", fontWeight: 700, marginBottom: 4 }}>{league?.name?.toUpperCase() || "PREDICTION CHAMP"}</div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#f4f1e8" }}>
            <Trophy size={24} style={{ verticalAlign: -4, marginRight: 8, color: "#d4a73c" }} />Prediction Champ
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "#9fb3a5" }}>{profile?.display_name}</span>
          <button onClick={onLogout} style={ghostBtn}><LogOut size={14} />Log ud</button>
        </div>
      </header>

      <nav style={{ display: "flex", gap: 6, marginBottom: 20, overflowX: "auto", paddingBottom: 4 }}>
        <TabButton active={tab === "competitions"} onClick={() => setTab("competitions")} icon={Users}>Konkurrencer</TabButton>
        <TabButton active={tab === "matches"} onClick={() => setTab("matches")} icon={CalendarDays}>Kampe</TabButton>
        <TabButton active={tab === "predictions"} onClick={() => setTab("predictions")} icon={ClipboardList}>Forudsigelser</TabButton>
        <TabButton active={tab === "results"} onClick={() => setTab("results")} icon={ClipboardList}>Resultater</TabButton>
        <TabButton active={tab === "board"} onClick={() => setTab("board")} icon={BarChart3}>Stilling</TabButton>
      </nav>

      {tab === "competitions" && (
        <CompetitionsTab token={token} userId={session.user.id} league={league} season={season} teams={teams}
          competitions={competitions} selectedCompId={selectedCompId} setSelectedCompId={setSelectedCompId} reload={loadAll} />
      )}
      {tab === "matches" && (
        <MatchesTab token={token} season={season} teams={teams} matches={matches} teamsById={teamsById} reload={loadAll} />
      )}
      {tab === "predictions" && (
        <PredictionsTab token={token} userId={session.user.id} competitions={competitions}
          selectedCompId={selectedCompId} setSelectedCompId={setSelectedCompId} teamsById={teamsById} />
      )}
      {tab === "results" && (
        <ResultsTab token={token} matches={matches} teamsById={teamsById} reload={loadAll} />
      )}
      {tab === "board" && (
        <BoardTab token={token} competitions={competitions} selectedCompId={selectedCompId} setSelectedCompId={setSelectedCompId} teamsById={teamsById} />
      )}
    </div>
  );
}

// ================= TAB: COMPETITIONS =================
function CompetitionsTab({ token, userId, league, season, teams, competitions, selectedCompId, setSelectedCompId, reload }) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState("full_season");
  const [teamId, setTeamId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [err, setErr] = useState("");
  const [statusMap, setStatusMap] = useState({}); // { [compId]: { isComplete, playedMatches, totalMatches, winner } }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(competitions.map(async (c) => {
        const rules = c.rules || { exact: 3, outcome: 1 };
        const state = await computeCompetitionState(token, c.id, rules);
        const winner = state.isComplete && state.rows.length ? state.rows[0] : null;
        return [c.id, { ...state, winner }];
      }));
      if (!cancelled) setStatusMap(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [competitions]); // eslint-disable-line

  async function createCompetition() {
    if (!name || !league || !season) return;
    setBusy(true); setErr("");
    try {
      const mode_params = mode === "team" ? { team_id: teamId } : mode === "time_range" ? { start_date: startDate, end_date: endDate } : {};
      const [comp] = await db.insert(token, "competitions", [{
        name, league_id: league.id, season_id: season.id, mode, mode_params, created_by: userId,
      }]);
      await db.insert(token, "competition_participants", [{ competition_id: comp.id, user_id: userId }]);

      // find matchende kampe og kobl dem på
      let query = `season_id=eq.${season.id}&select=id`;
      if (mode === "team" && teamId) query += `&or=(home_team_id.eq.${teamId},away_team_id.eq.${teamId})`;
      if (mode === "time_range" && startDate && endDate) query += `&kickoff_at=gte.${startDate}&kickoff_at=lte.${endDate}T23:59:59`;
      const matchedMatches = await db.select(token, "matches", query);
      if (matchedMatches.length) {
        await db.insert(token, "competition_matches", matchedMatches.map((m) => ({ competition_id: comp.id, match_id: m.id })));
      }
      setName(""); setTeamId(""); setStartDate(""); setEndDate("");
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

  function CompetitionCard({ c }) {
    const status = statusMap[c.id];
    return (
      <div key={c.id} className="pill" style={{
        background: selectedCompId === c.id ? "rgba(212,167,60,0.15)" : "#1c3d2c",
        border: selectedCompId === c.id ? "1px solid #d4a73c" : "1px solid transparent",
        cursor: "pointer", padding: "6px 12px", flexDirection: "column", alignItems: "flex-start", gap: 2,
      }} onClick={() => setSelectedCompId(c.id)}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {status?.isComplete && <Trophy size={12} style={{ color: "#d4a73c", marginRight: 6 }} />}
          <span style={{ color: "#f4f1e8", fontWeight: 700 }}>{c.name}</span>
          <span style={{ color: "#7fa38c", fontSize: 12, marginLeft: 6 }}>
            ({c.mode === "full_season" ? "hel sæson" : c.mode === "team" ? "et hold" : "tidsperiode"})
          </span>
          <Copy size={12} style={{ marginLeft: 8, cursor: "pointer", color: "#9fb3a5" }}
            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(c.invite_code); setCopiedId(c.id); setTimeout(() => setCopiedId(null), 1500); }} />
          {copiedId === c.id && <Check size={12} style={{ color: "#7fd48a", marginLeft: 4 }} />}
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

  const active = competitions.filter((c) => !statusMap[c.id]?.isComplete);
  const completed = competitions.filter((c) => statusMap[c.id]?.isComplete);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <h3 style={h3}>Aktive konkurrencer</h3>
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

      <div className="card">
        <h3 style={h3}>Join med kode</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="field" style={{ flex: 1 }} placeholder="Invitationskode…" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
          <button style={primaryBtn} onClick={joinCompetition} disabled={busy || !inviteCode}>Join</button>
        </div>
      </div>

      <div className="card">
        <h3 style={h3}>Opret ny konkurrence</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 420 }}>
          <input className="field" placeholder="Navn på konkurrence…" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="field" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="full_season">Hel sæson</option>
            <option value="team">Et hold</option>
            <option value="time_range">Tidsperiode (fx 3 uger)</option>
          </select>
          {mode === "team" && (
            <select className="field" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">Vælg hold…</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          {mode === "time_range" && (
            <div style={{ display: "flex", gap: 8 }}>
              <input className="field" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <input className="field" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
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

// ================= TAB: MATCHES (admin, manuel indtastning) =================
function MatchesTab({ token, season, teams, matches, teamsById, reload }) {
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [kickoff, setKickoff] = useState("");
  const [busy, setBusy] = useState(false);

  const rounds = useMemo(() => groupIntoRounds(matches), [matches]);

  async function addMatch() {
    if (!home || !away || home === away || !kickoff || !season) return;
    setBusy(true);
    try {
      await db.insert(token, "matches", [{ season_id: season.id, home_team_id: home, away_team_id: away, kickoff_at: `${kickoff}:00` }]);
      setHome(""); setAway(""); setKickoff("");
      await reload();
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={h3}>Tilføj kamp</h3>
        <p style={muted}>Runden beregnes automatisk (tirsdag t.o.m. mandag) ud fra spilletidspunktet.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select className="field" value={home} onChange={(e) => setHome(e.target.value)}>
            <option value="">Hjemmehold…</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="field" value={away} onChange={(e) => setAway(e.target.value)}>
            <option value="">Udehold…</option>
            {teams.filter((t) => t.id !== home).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input className="field" type="datetime-local" value={kickoff} onChange={(e) => setKickoff(e.target.value)} />
          <button style={primaryBtn} onClick={addMatch} disabled={busy}><Plus size={14} />Tilføj</button>
        </div>
      </div>
      {rounds.length === 0 && <p style={muted}>Ingen kampe endnu.</p>}
      {rounds.map((r) => (
        <div key={r.key} className="card" style={{ marginBottom: 14 }}>
          <h4 style={{ ...h3, marginBottom: 10 }}>Runde {r.label}</h4>
          <table><tbody>
            {r.matches.map((m) => (
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
      ))}
    </div>
  );
}

// ================= TAB: PREDICTIONS =================
function PredictionsTab({ token, userId, competitions, selectedCompId, setSelectedCompId, teamsById }) {
  const [allMatches, setAllMatches] = useState([]);
  const [preds, setPreds] = useState({});
  const [loading, setLoading] = useState(false);
  const [roundIndex, setRoundIndex] = useState(0);
  const comp = competitions.find((c) => c.id === selectedCompId);
  const rules = comp?.rules || { exact: 3, outcome: 1 };

  useEffect(() => {
    if (!selectedCompId) return;
    (async () => {
      setLoading(true);
      setRoundIndex(0);
      const cms = await db.select(token, "competition_matches", `competition_id=eq.${selectedCompId}&select=match_id`);
      const ids = cms.map((c) => c.match_id);
      if (!ids.length) { setAllMatches([]); setLoading(false); return; }
      const ms = await db.select(token, "matches", `id=in.(${ids.join(",")})&select=*&order=kickoff_at`);
      setAllMatches(ms);
      const myPreds = await db.select(token, "predictions", `user_id=eq.${userId}&match_id=in.(${ids.join(",")})&select=*`);
      setPreds(Object.fromEntries(myPreds.map((p) => [p.match_id, p])));
      setLoading(false);
    })();
  }, [selectedCompId]); // eslint-disable-line

  const rounds = useMemo(() => groupIntoRounds(allMatches), [allMatches]);
  const round = rounds[roundIndex];

  async function save(matchId, field, val) {
    const cur = preds[matchId] || { pred_home: null, pred_away: null };
    const next = { ...cur, [field]: val };
    setPreds({ ...preds, [matchId]: next });
    if (next.pred_home === null || next.pred_away === null) return;
    await db.upsert(token, "predictions", [{ user_id: userId, match_id: matchId, pred_home: next.pred_home, pred_away: next.pred_away }], "user_id,match_id");
  }

  if (!competitions.length) return <p style={muted}>Opret eller join en konkurrence først.</p>;

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <select className="field" value={selectedCompId || ""} onChange={(e) => setSelectedCompId(e.target.value)}>
          {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {loading && <p style={muted}>Henter kampe…</p>}
      {!loading && rounds.length === 0 && <p style={muted}>Ingen kampe i denne konkurrence endnu.</p>}
      {!loading && rounds.length > 0 && (
        <div className="card">
          <RoundPager rounds={rounds} index={roundIndex} setIndex={setRoundIndex} />
          <table><tbody>
            {round.matches.map((m) => {
              const pred = preds[m.id] || { pred_home: null, pred_away: null };
              const locked = isLocked(m);
              const played = m.home_score !== null && m.home_score !== undefined;
              const hasPred = pred.pred_home !== null && pred.pred_away !== null;
              const pts = played ? pointsFor(pred, m, rules) : null;
              const exact = played && hasPred && pred.pred_home === m.home_score && pred.pred_away === m.away_score;
              const correctOutcome = played && pts !== null && pts > 0;

              return (
                <tr key={m.id} className="rowline">
                  <td style={{ padding: "10px 10px" }}>
                    <div style={{ color: "#f4f1e8", fontWeight: 600 }}>{teamsById[m.home_team_id]} - {teamsById[m.away_team_id]}</div>
                    <div style={{ color: "#7fa38c", fontSize: 12, marginTop: 2 }}>
                      {formatKickoff(m.kickoff_at)}
                      {!played && locked && <span style={{ color: "#c96a5a", marginLeft: 8 }}>· Låst</span>}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <ScoreInput value={pred.pred_home} onChange={(v) => save(m.id, "pred_home", v)} disabled={locked} />
                      <span style={{ color: "#7fa38c" }}>-</span>
                      <ScoreInput value={pred.pred_away} onChange={(v) => save(m.id, "pred_away", v)} disabled={locked} />
                    </div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {played && (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                        <span className="pill" style={{
                          background: !hasPred ? "#1c3d2c" : correctOutcome ? "rgba(80,180,110,0.18)" : "rgba(201,106,90,0.18)",
                          color: !hasPred ? "#7fa38c" : correctOutcome ? "#7fd48a" : "#e08a7a",
                          border: exact ? "2px solid #d4a73c" : "1px solid transparent",
                        }}>{m.home_score} - {m.away_score}</span>
                        {hasPred && <span style={{ fontSize: 11, color: "#9fb3a5" }}>{pts} point</span>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody></table>
        </div>
      )}
    </div>
  );
}

// ================= TAB: RESULTS (manuel indtastning) =================
function ResultsTab({ token, matches, teamsById, reload }) {
  const [roundIndex, setRoundIndex] = useState(0);
  const rounds = useMemo(() => groupIntoRounds(matches), [matches]);
  const round = rounds[roundIndex];

  async function setScore(id, field, val) {
    await db.update(token, "matches", `id=eq.${id}`, { [field]: val, status: "finished" });
    await reload();
  }

  if (rounds.length === 0) return <p style={muted}>Ingen kampe endnu — tilføj under "Kampe".</p>;

  return (
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
  );
}

// ================= TAB: BOARD (leaderboard) =================
function BoardTab({ token, competitions, selectedCompId, setSelectedCompId, teamsById }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const comp = competitions.find((c) => c.id === selectedCompId);

  useEffect(() => {
    if (!selectedCompId || !comp) return;
    (async () => {
      setLoading(true);
      const rules = comp.rules || { exact: 3, outcome: 1 };
      const result = await computeCompetitionState(token, selectedCompId, rules);
      setState(result);
      setLoading(false);
    })();
  }, [selectedCompId, comp]); // eslint-disable-line

  if (!competitions.length) return <p style={muted}>Opret eller join en konkurrence først.</p>;

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <select className="field" value={selectedCompId || ""} onChange={(e) => setSelectedCompId(e.target.value)}>
          {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
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
