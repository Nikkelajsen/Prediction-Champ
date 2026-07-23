// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState, useEffect, useMemo } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { db, restFetch } from "../lib/supabase.js";
import { loadUserStats } from "../lib/data.js";
import { currentRoundIndex, formatKickoff, groupIntoRounds } from "../lib/scoring.js";
import { C, btnGhost, btnGold, chip, font, muted } from "../ui/theme.js";
import { BackBar, Card, RoundPager, ScoreInput } from "../ui/components.jsx";

function AdminScreen({ token, leagues, reloadLeagues, onBack }) {
  const [sub, setSub] = useState("matches");
  const [recomputing, setRecomputing] = useState(false);
  const [msg, setMsg] = useState("");

  async function recompute() {
    setRecomputing(true); setMsg("");
    try {
      await restFetch(`/rest/v1/rpc/recompute_ratings`, { method: "POST", token, body: {} });
      setMsg("Ratings opdateret.");
    } catch (e) { setMsg("Fejl: " + (e.message || "kunne ikke opdatere")); }
    setRecomputing(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BackBar title="Admin" onBack={onBack} right={
        <button style={btnGhost} onClick={recompute} disabled={recomputing}>
          {recomputing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Opdater ratings
        </button>
      } />
      {msg && <p style={{ ...muted, margin: 0 }}>{msg}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={chip(sub === "matches")} onClick={() => setSub("matches")}>Kampe</button>
        <button style={chip(sub === "results")} onClick={() => setSub("results")}>Resultater</button>
        <button style={chip(sub === "stats")} onClick={() => setSub("stats")}>Statistik</button>
      </div>
      {sub === "matches" && <MatchesPanel token={token} leagues={leagues} reloadLeagues={reloadLeagues} />}
      {sub === "results" && <ResultsPanel token={token} leagues={leagues} />}
      {sub === "stats" && <StatsPanel token={token} />}
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
            <p style={{ ...muted, margin: "4px 0 0" }}>Fra Sportmonks for {league?.name || "denne turnering"}.</p>
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

// ---------- Statistik ----------
// Danske labels for konkurrence-modes (matcher CreateCompetitionScreen).
const MODE_LABELS = {
  full_season: "Hel sæson",
  team: "Et hold",
  time_range: "Tidsperiode",
  custom: "Håndplukkede",
  random: "Tilfældig kupon",
};

// Kategorisk fordeling som vandrette magnitude-søjler: label + antal + procent.
// Enkelt hue (identitet bæres af label, ikke farve) → ingen CVD-adjacens-problem.
function ModeBars({ data, total }) {
  if (!data || !data.length) return <p style={{ ...muted, margin: 0 }}>Ingen konkurrencer endnu.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {data.map((d) => {
        const pct = total ? Math.round((d.count / total) * 100) : 0;
        return (
          <div key={d.mode}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
              <span style={{ color: C.text }}>{MODE_LABELS[d.mode] || d.mode}</span>
              <span style={{ color: C.muted }}>{d.count} · {pct}%</span>
            </div>
            <div style={{ height: 8, background: C.surface2, borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: C.green, borderRadius: 999 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Et enkelt nøgletal ("stat tile").
function StatTile({ label, value, hint }) {
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontFamily: font.display, fontWeight: 700, fontSize: 28, lineHeight: 1.05, color: C.text }}>{value}</div>
      <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{label}</div>
      {hint && <div style={{ color: C.muted, fontSize: 11, marginTop: 4, opacity: 0.8 }}>{hint}</div>}
    </div>
  );
}

// Overskrift for en gruppe af nøgletal.
function StatGroup({ title, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontFamily: font.display, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 13, color: C.muted }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{children}</div>
    </div>
  );
}

// Enkelt-serie søjlediagram (magnitude over tid). Tynde søjler med afrundet top,
// 2px mellemrum, diskret baseline. Ingen legend — titlen navngiver serien.
// Hover viser etikette + værdi via native title. Farve = én temafarve.
function MiniBars({ data, color, formatLabel }) {
  if (!data || !data.length) return <p style={{ ...muted, margin: 0 }}>Ingen data endnu.</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 96, borderBottom: `1px solid ${C.line}`, paddingBottom: 0 }}>
      {data.map((d, i) => (
        <div key={i} title={`${formatLabel(d.key)}: ${d.value}`}
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", minWidth: 0 }}>
          <span style={{ color: C.muted, fontSize: 9, lineHeight: 1, marginBottom: 2 }}>{d.value || ""}</span>
          <div style={{
            width: "100%", height: `${Math.max(d.value > 0 ? 3 : 0, (d.value / max) * 74)}px`,
            background: color, borderRadius: "4px 4px 0 0",
          }} />
        </div>
      ))}
    </div>
  );
}

function StatsPanel({ token }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true); setErr("");
      try { setStats(await loadUserStats(token)); }
      catch (e) { setErr(e.message || "Kunne ikke hente statistik"); }
      setLoading(false);
    })();
  }, [token]);

  if (loading) return <p style={{ ...muted, display: "flex", gap: 8, alignItems: "center" }}><Loader2 size={14} className="spin" /> Henter statistik …</p>;
  if (err) return <p style={{ color: C.red, fontSize: 13 }}>Fejl: {err}</p>;
  if (!stats) return null;

  const s = stats;
  const stickiness = s.mau ? Math.round((s.dau / s.mau) * 100) : 0;
  const signups = (s.signups_by_week || []).map((r) => ({ key: r.week, value: r.count }));
  const actives = (s.active_by_day || []).map((r) => ({ key: r.day, value: r.count }));
  const weekLabel = (iso) => { const d = new Date(iso); return d.toLocaleDateString("da-DK", { day: "numeric", month: "short" }); };
  const dayLabel = (iso) => { const d = new Date(iso); return d.toLocaleDateString("da-DK", { weekday: "short", day: "numeric", month: "short" }); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <StatGroup title="Brugere">
        <StatTile label="Brugere i alt" value={s.total} />
        <StatTile label="Nye seneste 30 dage" value={s.new_30d} hint={`heraf ${s.new_7d} seneste 7 dage`} />
      </StatGroup>

      <StatGroup title="Aktivitet">
        <StatTile label="Aktive i dag" value={s.dau} />
        <StatTile label="Aktive seneste 7 dage" value={s.wau} />
        <StatTile label="Aktive seneste 30 dage" value={s.mau} />
        <StatTile label="Fastholdelse (DAU/MAU)" value={`${stickiness}%`} hint={`gns. ${s.avg_active_days_30d} aktive dage/bruger`} />
      </StatGroup>

      <StatGroup title="Engagement">
        <StatTile label="Har afgivet mindst ét tip" value={s.has_predicted} hint={s.total ? `${Math.round((s.has_predicted / s.total) * 100)}% af alle` : undefined} />
        <StatTile label="Gns. tips pr. bruger" value={s.avg_predictions} />
        <StatTile label="Med i en privat konkurrence" value={s.in_private_league} />
      </StatGroup>

      <StatGroup title="Frafald">
        <StatTile label="Har aldrig tippet" value={s.never_predicted} />
        <StatTile label="Inaktive i 30+ dage" value={s.inactive_30d} />
      </StatGroup>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <div style={{ fontFamily: font.display, fontWeight: 700, textTransform: "uppercase", fontSize: 15 }}>Konkurrencer</div>
          <div style={{ fontFamily: font.display, fontWeight: 700, fontSize: 22, color: C.text }}>{s.competitions_total ?? 0}</div>
        </div>
        <ModeBars data={s.competitions_by_mode || []} total={s.competitions_total || 0} />
        <p style={{ ...muted, margin: "12px 0 0" }}>Kun private konkurrencer — de officielle (månedsliga m.fl.) tælles ikke med.</p>
      </Card>

      <Card>
        <div style={{ fontFamily: font.display, fontWeight: 700, textTransform: "uppercase", fontSize: 15, marginBottom: 10 }}>Nye tilmeldinger pr. uge</div>
        <MiniBars data={signups} color={C.gold} formatLabel={weekLabel} />
        <p style={{ ...muted, margin: "8px 0 0" }}>Seneste ~12 uger.</p>
      </Card>

      <Card>
        <div style={{ fontFamily: font.display, fontWeight: 700, textTransform: "uppercase", fontSize: 15, marginBottom: 10 }}>Aktive brugere pr. dag</div>
        <MiniBars data={actives} color={C.green} formatLabel={dayLabel} />
        <p style={{ ...muted, margin: "8px 0 0" }}>Seneste 30 dage. Aktivitet begynder først at tælle fra denne funktion blev taget i brug.</p>
      </Card>
    </div>
  );
}

export default AdminScreen;
