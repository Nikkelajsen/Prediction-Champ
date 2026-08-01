// Custom-kortets felter: første spørgsmål er METODEN — håndpluk kampene, eller
// tag alt i en periode. Perioden er den gamle `time_range`-mode; den bor her,
// fordi begge er "du bestemmer selv"-svar, og et syvende gallerikort ikke
// ville bære sin egen vægt. Mode-værdien i databasen er uændret, så
// efterfyldningen (api/_backfill.js) stadig kan lade periodens regel vokse.
import { C, chip, muted } from "../../ui/theme.js";
import { formatKickoff } from "../../lib/scoring.js";
import LeagueChips from "./LeagueChips.jsx";

function CustomFields({
  method, onMethod,
  leagues, pickLeagueIds, onPickLeagueIds, upcomingRounds, upcomingTeams, pickedIds, onPickedIds,
  periodLeagueId, onPeriodLeagueId, startDate, endDate, onStartDate, onEndDate,
}) {
  return (
    <>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" aria-pressed={method === "pick"} style={chip(method === "pick")} onClick={() => onMethod("pick")}>
          {method === "pick" ? "✓ " : ""}Håndpluk kampe
        </button>
        <button type="button" aria-pressed={method === "period"} style={chip(method === "period")} onClick={() => onMethod("period")}>
          {method === "period" ? "✓ " : ""}Periode
        </button>
      </div>

      {method === "period" && (
        <>
          {leagues.length > 1 && (
            <select className="field" value={periodLeagueId} onChange={(e) => onPeriodLeagueId(e.target.value)}>
              {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input className="field" type="date" value={startDate} onChange={(e) => onStartDate(e.target.value)} />
            <input className="field" type="date" value={endDate} onChange={(e) => onEndDate(e.target.value)} />
          </div>
          <p style={{ ...muted, margin: 0 }}>Alle kampe mellem de to datoer kommer med — også dem, der skemalægges senere.</p>
        </>
      )}

      {method === "pick" && (
        <>
          <LeagueChips leagues={leagues} selectedIds={pickLeagueIds} onChange={onPickLeagueIds} />
          <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${C.line}`, borderRadius: 10, padding: 10 }}>
            {upcomingRounds.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen kommende kampe fundet.</p>}
            {upcomingRounds.map((r) => (
              <div key={r.key} style={{ marginBottom: 10 }}>
                <div style={{ color: C.gold, fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Runde {r.label}</div>
                {r.matches.map((m) => {
                  const checked = pickedIds.includes(m.id);
                  return (
                    <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", fontSize: 13 }}>
                      <input type="checkbox" checked={checked} onChange={() =>
                        onPickedIds(checked ? pickedIds.filter((x) => x !== m.id) : [...pickedIds, m.id])} />
                      <span style={{ color: C.text }}>{upcomingTeams[m.home_team_id]} - {upcomingTeams[m.away_team_id]}</span>
                      <span style={{ color: C.muted, fontSize: 11, marginLeft: "auto", whiteSpace: "nowrap" }}>{m._leagueName} · {formatKickoff(m.kickoff_at)}</span>
                    </label>
                  );
                })}
              </div>
            ))}
            {pickedIds.length > 0 && <p style={{ ...muted, marginBottom: 0 }}>{pickedIds.length} kampe valgt</p>}
          </div>
        </>
      )}
    </>
  );
}

export default CustomFields;
