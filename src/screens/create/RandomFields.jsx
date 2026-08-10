// Quick Pick- og Quick League-kortenes felter. Quick League er samme mode
// (`random`) med et rundetal — kampantallet er PR. RUNDE, så "8 kampe, 6 runder
// frem" betyder 8 i hver uge, klippet til rundens faktiske udbud.
//
// Rækkefølgen er turneringer → start → antal (august 2026, sammen med
// startrunde-valget). Turneringsvalget flyttede ØVERST, fordi de to felter under
// det nu svarer med tal, der kun gælder for de valgte turneringer: "5 af 6
// kampe er spillet" og "4–38 kampe pr. runde" er meningsløse, hvis man ikke
// allerede har sagt, hvilke turneringer der tælles i.
import { C, muted } from "../../ui/theme.js";
import { MAX_MATCHES_PER_ROUND } from "../../lib/createTypes.js";
import LeagueChips from "./LeagueChips.jsx";
import RoundStartChoice from "./RoundStartChoice.jsx";

function RandomFields({
  isQuickLeague, count, onCount, rounds, onRounds, leagues, leagueIds, onLeagueIds, poolRounds,
  roundStart, onRoundStart, currentRoundMatches, currentRoundOpen, nextRound,
}) {
  // Kampantallet gælder ALLE de valgte runder, så tallet ved siden af feltet er
  // spændet over dem — ikke størrelsen på den første. Netop dét var fælden:
  // startrunden er ofte halvspillet, og flere turneringer går i gang forskudt,
  // så "1 i nærmeste runde" sagde intet om de fem runder bagefter.
  const window = poolRounds.slice(0, isQuickLeague ? Math.max(1, Number(rounds) || 1) : 1);
  const sizes = window.map((r) => r.matches.length);
  const hint = !sizes.length
    ? "ingen runder fundet"
    : isQuickLeague
      ? (Math.min(...sizes) === Math.max(...sizes)
        ? `${sizes[0]} kampe pr. runde`
        : `${Math.min(...sizes)}–${Math.max(...sizes)} kampe pr. runde`)
      : `${sizes[0]} kampe i runden`;

  return (
    <>
      <LeagueChips leagues={leagues} selectedIds={leagueIds} onChange={onLeagueIds} />
      <RoundStartChoice value={roundStart} onChange={onRoundStart}
        roundMatches={currentRoundMatches} currentOpen={currentRoundOpen} nextRound={nextRound} />
      {isQuickLeague && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: C.text, fontSize: 14 }}>Antal runder:</span>
          <input className="field" type="number" min="2" max="10" style={{ width: 70 }}
            value={rounds}
            onChange={(e) => onRounds(Math.min(Math.max(Number(e.target.value) || 2, 2), 10))} />
          <span style={{ color: C.muted, fontSize: 12 }}>({poolRounds.length} kommende fundet)</span>
        </div>
      )}
      {/* Feltet er IKKE klippet til rundens udbud (august 2026). Loftet er
          teknisk (MAX_MATCHES_PER_ROUND) og fanger en tastefejl; udbuddet er
          oplysning. `pickRandomFromRounds` klipper alligevel pr. runde, så et
          for højt tal betyder "så mange som muligt" — hvorimod det gamle loft
          gjorde en halvspillet startrunde til reglen for alle seks runder. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: C.text, fontSize: 14 }}>{isQuickLeague ? "Kampe pr. runde:" : "Antal kampe:"}</span>
        <input className="field" type="number" min="1" max={MAX_MATCHES_PER_ROUND} style={{ width: 70 }}
          value={count}
          onChange={(e) => onCount(Math.min(Math.max(Number(e.target.value) || 1, 1), MAX_MATCHES_PER_ROUND))} />
        <span style={{ color: C.muted, fontSize: 12 }}>({hint})</span>
      </div>
      <p style={{ ...muted, margin: 0 }}>
        {isQuickLeague
          ? "Trækker tilfældige kampe i hver af de kommende runder, fordelt jævnt på de valgte turneringer — er der færre i en runde, kommer de alle med."
          : "Trækker tilfældige kampe fra startrunden, fordelt jævnt på de valgte turneringer — er der færre, kommer de alle med."}
      </p>
    </>
  );
}

export default RandomFields;
