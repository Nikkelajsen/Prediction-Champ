// Admin → Resultater: indtastning af kampresultater runde for runde. Ren
// flytning ud af `AdminScreen.jsx` (G1, august 2026).
import { useState, useEffect, useMemo } from "react";
import { db } from "../../lib/supabase.js";
import { currentRoundIndex, formatKickoff, groupIntoRounds } from "../../lib/scoring.js";
import { C, muted } from "../../ui/theme.js";
import { Card, RoundPager, ScoreInput } from "../../ui/components.jsx";

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
        <p style={muted}>Ingen kampe endnu — hent dem under "Kampe".</p>
      ) : (
        <Card>
          <p style={{ ...muted, marginTop: 0 }}>Indtast faktiske resultater. Stillingen opdateres automatisk.</p>
          <RoundPager rounds={rounds} index={roundIndex} setIndex={setRoundIndex} />
          <table><tbody>
            {round.matches.map((m) => (
              <tr key={m.id} className="rowline">
                <td style={{ padding: "10px 6px" }}>
                  <div style={{ color: C.text, fontWeight: 600 }}>{teamsById[m.home_team_id]} vs {teamsById[m.away_team_id]}</div>
                  <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{formatKickoff(m.kickoff_at, m.kickoff_tbd)}</div>
                </td>
                <td>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <ScoreInput label={`Resultat: mål til ${teamsById[m.home_team_id]} mod ${teamsById[m.away_team_id]}`}
                      value={m.home_score} onChange={(v) => setScore(m.id, "home_score", v)} />
                    <span aria-hidden="true" style={{ color: C.muted }}>-</span>
                    <ScoreInput label={`Resultat: mål til ${teamsById[m.away_team_id]} mod ${teamsById[m.home_team_id]}`}
                      value={m.away_score} onChange={(v) => setScore(m.id, "away_score", v)} />
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
// Kategorisk fordeling som vandrette magnitude-søjler: label + antal + procent.
// Enkelt hue (identitet bæres af label, ikke farve) → ingen CVD-adjacens-problem.

export default ResultsPanel;
