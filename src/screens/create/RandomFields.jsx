// Quick Pick- og Quick League-kortenes felter. Quick League er samme mode
// (`random`) med et rundetal — kampantallet er PR. RUNDE, så "8 kampe, 6 runder
// frem" betyder 8 i hver uge, klippet til rundens faktiske udbud.
import { C, muted } from "../../ui/theme.js";
import LeagueChips from "./LeagueChips.jsx";

function RandomFields({ isQuickLeague, count, onCount, rounds, onRounds, leagues, leagueIds, onLeagueIds, poolRounds }) {
  const nearest = poolRounds[0];
  const nearestSize = nearest ? nearest.matches.length : 0;
  return (
    <>
      {isQuickLeague && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: C.text, fontSize: 14 }}>Antal runder:</span>
          <input className="field" type="number" min="2" max="10" style={{ width: 70 }}
            value={rounds}
            onChange={(e) => onRounds(Math.min(Math.max(Number(e.target.value) || 2, 2), 10))} />
          <span style={{ color: C.muted, fontSize: 12 }}>({poolRounds.length} kommende fundet)</span>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: C.text, fontSize: 14 }}>{isQuickLeague ? "Kampe pr. runde:" : "Antal kampe:"}</span>
        <input className="field" type="number" min="1" max={Math.max(1, nearestSize)} style={{ width: 70 }}
          value={Math.min(Number(count) || 1, Math.max(1, nearestSize))}
          onChange={(e) => onCount(Math.min(Number(e.target.value) || 1, Math.max(1, nearestSize)))} />
        <span style={{ color: C.muted, fontSize: 12 }}>({nearestSize} i nærmeste runde)</span>
      </div>
      <LeagueChips leagues={leagues} selectedIds={leagueIds} onChange={onLeagueIds} />
      <p style={{ ...muted, margin: 0 }}>
        {isQuickLeague
          ? "Trækker tilfældige kampe i hver af de kommende runder."
          : "Trækker tilfældige kampe fra den nærmeste kommende runde."}
      </p>
    </>
  );
}

export default RandomFields;
