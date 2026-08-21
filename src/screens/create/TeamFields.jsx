// Favorithold-kortets felter (I14): hold på tværs af turneringer. `teams` er
// pr.-liga-rækker uden logo/land, så navn + liganavn er hele den tilgængelige
// identitet — derfor én grupperet dropdown (optgroup pr. turnering) som
// tilføj-flade og de valgte hold som chips med liganavn.
//
// `_label` og ikke `name`: kort holdnavn, hvor der er ét (`B39`). Feltet er
// sat af `loadTeamsByLeague()`, som sorterer listen efter netop det.
import { C, chip } from "../../ui/theme.js";
import RoundStartChoice from "./RoundStartChoice.jsx";

function TeamFields({ leagues, teamsByLeague, seasonByLeague, selected, onAdd, onRemove,
  roundStart, onRoundStart, currentRoundMatches, currentRoundOpen, nextRound }) {
  const leagueName = Object.fromEntries(leagues.map((l) => [l.id, l.name]));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ color: C.muted, fontSize: 12 }}>Hold{selected.length > 1 ? " — flere valgt" : ""}</span>
      {selected.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {selected.map((t) => (
            <button key={t.teamId} type="button" title="Fjern holdet" style={chip(true)}
              onClick={() => onRemove(t.teamId)}>
              {t.name} · {leagueName[t.leagueId]} ✕
            </button>
          ))}
        </div>
      )}
      {teamsByLeague === null ? (
        <span style={{ color: C.muted, fontSize: 12 }}>Henter hold…</span>
      ) : (
        /* value er altid "" med vilje: dropdownen er en tilføj-knap, ikke et
           valg — det valgte bor i chips-rækken ovenfor. */
        <select className="field" value="" onChange={(e) => { if (e.target.value) onAdd(e.target.value); }}>
          <option value="">Tilføj hold…</option>
          {leagues.map((l) => {
            const teams = seasonByLeague[l.id] ? teamsByLeague[l.id] || [] : [];
            if (!teams.length) return null;
            return (
              <optgroup key={l.id} label={l.name}>
                {teams.map((t) => (
                  <option key={t.id} value={t.id} disabled={selected.some((s) => s.teamId === t.id)}>
                    {t._label}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      )}
      {/* Vises først, når der ER valgt hold: uden hold er nævneren tom, og et
          valg uden tal er præcis det, hele startrunde-arbejdet handlede om at
          undgå. Tælleren dækker KUN de valgte holds kampe — det er dem,
          konkurrencen kommer til at bestå af. */}
      {selected.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <RoundStartChoice value={roundStart} onChange={onRoundStart}
            roundMatches={currentRoundMatches} currentOpen={currentRoundOpen} nextRound={nextRound} />
        </div>
      )}
    </div>
  );
}

export default TeamFields;
