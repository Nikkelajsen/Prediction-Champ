// Sæson-kortets felter: turnerings-chips med kampantal. Flyttet uændret ud af
// den gamle opret-skærm — logikken og forbeholdene er de samme som før galleriet.
import { C, chip } from "../../ui/theme.js";
import RoundStartChoice from "./RoundStartChoice.jsx";

// Ikke en <label>: der er ingen enkelt formularkontrol at mærke, og
// label-teksten ville smitte af på hver chips tilgængelige navn, så
// en skærmlæser (og enhver test) ville høre "Turnering Superligaen
// Premier League" på den første knap.
function SeasonFields({ leagues, fsLeagueIds, countByLeague, onToggle,
  roundStart, onRoundStart, currentRoundMatches, currentRoundOpen, nextRound }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ color: C.muted, fontSize: 12 }}>Turnering{fsLeagueIds.length > 1 ? "er — flere valgt" : ""}</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {leagues.map((l) => {
          const sel = fsLeagueIds.includes(l.id);
          const n = countByLeague[l.id];
          const empty = n === 0;
          return (
            <button key={l.id} type="button" aria-pressed={sel} disabled={empty}
              title={empty ? "Kampprogrammet er ikke lagt endnu" : undefined}
              onClick={() => onToggle(l.id)}
              style={{ ...chip(sel), opacity: empty ? 0.45 : 1, cursor: empty ? "not-allowed" : "pointer" }}>
              {sel ? "✓ " : ""}{l.name}{n === undefined ? "" : ` · ${n} kampe`}
            </button>
          );
        })}
      </div>
      {/* Siger hvorfor en chip er slukket. Uden linjen ligner en tom
          turnering en fejl i appen frem for en sæson, der ikke er lagt. */}
      {leagues.some((l) => countByLeague[l.id] === 0) && (
        <span style={{ color: C.muted, fontSize: 11.5, lineHeight: 1.4 }}>
          Turneringer uden kampe kan ikke vælges endnu — kampprogrammet er ikke lagt.
        </span>
      )}
      {/* En hel sæson afgøres ikke af sin første runde, men vilkåret er det
          samme som for de korte typer: opretter man søndag aften, består første
          runde af de kampe, der tilfældigvis var tilbage. Det skal kunne vælges
          frem for at arves. */}
      <div style={{ marginTop: 4 }}>
        <RoundStartChoice value={roundStart} onChange={onRoundStart}
          roundMatches={currentRoundMatches} currentOpen={currentRoundOpen} nextRound={nextRound} />
      </div>
    </div>
  );
}

export default SeasonFields;
