// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState, useEffect, useMemo } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { db, restFetch } from "../lib/supabase.js";
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

export default AdminScreen;
