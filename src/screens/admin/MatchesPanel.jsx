// Admin → Kampe: turneringsvælger, synkronisering fra datakilden og rundens
// kampe med kickoff. Ren flytning ud af `AdminScreen.jsx` (G1, august 2026) —
// panelet var altid selvstændigt, det lå bare i samme fil som fire andre.
import { useState, useEffect, useMemo } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { db } from "../../lib/supabase.js";
import { apiFetch } from "../../lib/api.js";
import { currentRoundIndex, formatKickoff, groupIntoRounds } from "../../lib/scoring.js";
import { C, btnGold, font, muted } from "../../ui/theme.js";
import { Card, RoundPager } from "../../ui/components.jsx";

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
      // apiFetch() (G80): `res.json()` på udviklingsserverens index.html gav
      // den rå parser-fejl `Unexpected token '/'` i knappens fejlfelt.
      const { data } = await apiFetch(`/api/sync-matches?leagueId=${league.id}`, { headers: { Authorization: `Bearer ${token}` } });
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
            <p style={{ ...muted, margin: "4px 0 0" }}>Fra turneringens egen datakilde for {league?.name || "denne turnering"}.</p>
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
        {/* Hentede kørslen nul kampe, står forklaringen her — ikke kun i Admin → Drift.
            "0 kampe synkroniseret ud af 0 fundet" er sandt og ubrugeligt: det er den
            samme sætning, uanset om turneringens kampprogram bare ikke er offentliggjort
            endnu, eller api_season_id peger et forkert sted hen (B8). Kun season-unknown
            kræver en handling, så den ene er rød og de øvrige dæmpede. */}
        {syncResult?.emptySeason && (
          <p style={{ color: syncResult.emptySeason.code === "season-unknown" ? C.red : C.muted, fontSize: 13, marginTop: 6, marginBottom: 0 }}>
            {syncResult.emptySeason.message}
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
                <td style={{ color: C.muted, fontSize: 13, width: 130 }}>{formatKickoff(m.kickoff_at, m.kickoff_tbd)}</td>
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

export default MatchesPanel;
