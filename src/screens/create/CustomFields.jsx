// Custom-kortets felter: første spørgsmål er METODEN — håndpluk kampene, eller
// tag alt i en periode. Perioden er den gamle `time_range`-mode; den bor her,
// fordi begge er "du bestemmer selv"-svar, og et syvende gallerikort ikke
// ville bære sin egen vægt. Mode-værdien i databasen er uændret, så
// efterfyldningen (api/_backfill.js) stadig kan lade periodens regel vokse.
import { C, chip, muted } from "../../ui/theme.js";
import { formatKickoff, isLocked } from "../../lib/scoring.js";
import LeagueChips from "./LeagueChips.jsx";
import RoundStartChoice from "./RoundStartChoice.jsx";

// Loftets valgmuligheder. 0 = "Alle" og er standarden, så en periode uden
// stillingtagen opfører sig præcis som før.
const PER_ROUND_CHOICES = [0, 3, 5, 8, 10, 15];

function CustomFields({
  method, onMethod,
  leagues, pickLeagueIds, onPickLeagueIds, upcomingRounds, upcomingTeams, pickedIds, onPickedIds,
  periodLeagueIds, onPeriodLeagueIds, startDate, endDate, onStartDate, onEndDate,
  perRound, onPerRound, periodCount,
  roundStart, onRoundStart, currentRoundMatches, currentRoundOpen, nextRound,
}) {
  // Antal valgte kampe, der stadig kan tippes — se tælleren nederst i vælgeren.
  const valgt = upcomingRounds
    .flatMap((r) => r.matches)
    .filter((m) => pickedIds.includes(m.id) && !isLocked(m)).length;

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
          {/* Samme turneringsvælger som håndpluk og de tilfældige typer. Feltet
              var en enkeltvalgs-dropdown indtil august 2026, så en periode kun
              kunne dække ÉN turnering — mens håndpluk lige ved siden af kunne
              vælge frit blandt dem alle. */}
          <LeagueChips leagues={leagues} selectedIds={periodLeagueIds} onChange={onPeriodLeagueIds} />
          {/* Samme startrunde-valg som de tilfældige typer — men her SÆTTER det
              startdatoen frem for at filtrere en pulje: perioden er defineret af
              sine datoer, og to kontroller, der begge kunne bestemme starten,
              ville kunne stå og modsige hinanden. Valget er derfor AFLEDT af
              datoen (se `periodRoundStart` i opret-skærmen): retter man datoen i
              hånden, følger chippen med, og ingen af dem kan lyve. */}
          <RoundStartChoice value={roundStart} onChange={onRoundStart}
            roundMatches={currentRoundMatches} currentOpen={currentRoundOpen} nextRound={nextRound} />
          <div style={{ display: "flex", gap: 8 }}>
            <input className="field" type="date" aria-label="Startdato" value={startDate} onChange={(e) => onStartDate(e.target.value)} />
            <input className="field" type="date" aria-label="Slutdato" value={endDate} onChange={(e) => onEndDate(e.target.value)} />
          </div>

          <div>
            <div style={{ ...muted, marginBottom: 6 }}>Kampe pr. runde</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PER_ROUND_CHOICES.map((n) => (
                <button key={n} type="button" aria-pressed={perRound === n} style={chip(perRound === n)}
                  onClick={() => onPerRound(n)}>
                  {perRound === n ? "\u2713 " : ""}{n === 0 ? "Alle" : n}
                </button>
              ))}
            </div>
          </div>

          {/* De to løfter udelukker hinanden, så teksten skifter med valget frem
              for at stå med et forbehold, der kun gælder halvdelen af tiden. */}
          <p style={{ ...muted, margin: 0 }}>
            {perRound
              ? `Højst ${perRound} kampe i hver runde, fordelt jævnt på de valgte turneringer — er der færre i en runde, kommer de alle med. Kampene vælges nu, så kampe, der først skemalægges senere, kommer ikke med.`
              : "Alle kampe mellem de to datoer kommer med — også dem, der skemalægges senere."}
          </p>
          {perRound > 0 && periodCount > 0 && (
            <p style={{ ...muted, margin: 0 }}>{periodCount} kampe valgt.</p>
          )}
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
                  // En låst kamp bliver STÅENDE, slukket, med "Låst" hvor
                  // klokkeslættet ellers står. De tilfældige typer fjerner den
                  // fra puljen, men her leder brugeren efter en bestemt kamp —
                  // og en kamp, der bare var væk, ville se ud som en kamp, der
                  // ikke fandtes. Det er samme fejl som `G35`s tavse afkortning,
                  // bare på én række. Listen går kun fra `nu` og frem, så det er
                  // højst en håndfuld rækker: dem, der låser inden for timen.
                  const locked = isLocked(m);
                  const checked = pickedIds.includes(m.id) && !locked;
                  return (
                    <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: locked ? "not-allowed" : "pointer", fontSize: 13, opacity: locked ? 0.45 : 1 }}>
                      <input type="checkbox" checked={checked} disabled={locked} onChange={() => {
                        if (locked) return;
                        onPickedIds(checked ? pickedIds.filter((x) => x !== m.id) : [...pickedIds, m.id]);
                      }} />
                      <span style={{ color: C.text }}>{upcomingTeams[m.home_team_id]} - {upcomingTeams[m.away_team_id]}</span>
                      <span style={{ color: C.muted, fontSize: 11, marginLeft: "auto", whiteSpace: "nowrap" }}>
                        {m._leagueName} · {locked ? "Låst" : formatKickoff(m.kickoff_at, m.kickoff_tbd, m.kickoff_uncertain)}
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
            {/* Tælleren tæller det SAMME, som afkrydsningerne viser: et valg,
                der er nået at låse, er slukket ovenfor og må ikke stadig tælle
                med hernede. (Bøjningen fulgte med: linjen sagde "1 kampe".) */}
            {valgt > 0 && <p style={{ ...muted, marginBottom: 0 }}>{valgt} {valgt === 1 ? "kamp" : "kampe"} valgt</p>}
          </div>
        </>
      )}
    </>
  );
}

export default CustomFields;
