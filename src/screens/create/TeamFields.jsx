// Favorithold-kortets felter (I14): hold på tværs af turneringer. `teams` er
// pr.-liga-rækker uden logo/land, så navn + liganavn er hele den tilgængelige
// identitet — derfor én grupperet dropdown (optgroup pr. turnering) som
// tilføj-flade og de valgte hold som chips med liganavn.
import { C, chip } from "../../ui/theme.js";

function TeamFields({ leagues, teamsByLeague, seasonByLeague, selected, onAdd, onRemove }) {
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
                    {t.name}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      )}
    </div>
  );
}

export default TeamFields;
