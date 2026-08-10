// Startrunde-valget: begynder konkurrencen i den runde, der er i gang, eller i
// den næste? (august 2026)
//
// Valget fandtes ikke før: puljen blev hentet fra `nu` og frem, så man altid
// startede i indeværende runde — og en konkurrence oprettet søndag aften havde
// de to kampe, der var tilbage, som hele sin første runde. Ingen på skærmen
// sagde det; feltet viste bare "(1 i nærmeste runde)", hvilket er den samme
// fejl som "0 kampe": et tal uden nævner kan ikke bruges til at beslutte noget.
//
// Derfor står NÆVNEREN her ("5 af 6 kampe … er allerede i gang eller spillet").
// Den er hele grunden til, at komponenten henter indeværende rundes kampe
// separat — puljen af kommende kampe kan per definition ikke fortælle, hvor
// mange der ALLEREDE er væk.
//
// Komponenten er delt af de fire typer, der har en startrunde: Quick League,
// Quick Pick, Ugens kupon og Custom/periode. Custom/periode oversætter valget
// til sin startdato i stedet for at filtrere en pulje — samme valg, samme ord,
// to måder at virke på.
import { C, chip, muted } from "../../ui/theme.js";
import { roundProgress } from "../../lib/createTypes.js";

function RoundStartChoice({ value, onChange, roundMatches, currentOpen, nextRound }) {
  const { total, locked, open } = roundProgress(roundMatches);

  return (
    <div>
      <div style={{ ...muted, marginBottom: 6 }}>Start</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {/* Indeværende runde er standarden — man vil som regel i gang nu. Den
            slukkes kun, når den er umulig: er alle rundens kampe låst, er der
            intet at starte på, og en knap, der ser aktiv ud, ville love det. */}
        <button type="button" aria-pressed={value === "current"} disabled={!currentOpen}
          style={{ ...chip(value === "current"), opacity: currentOpen ? 1 : 0.4, cursor: currentOpen ? "pointer" : "not-allowed" }}
          onClick={() => currentOpen && onChange("current")}>
          {value === "current" ? "✓ " : ""}Indeværende runde
        </button>
        <button type="button" aria-pressed={value === "next"} style={chip(value === "next")}
          onClick={() => onChange("next")}>
          {value === "next" ? "✓ " : ""}Ny runde
        </button>
      </div>

      {/* role="status" — teksten skifter som SVAR på et klik, og en skærmlæser
          skal have ændringen med uden at skulle lede efter den. */}
      <p role="status" style={{ ...muted, margin: "6px 0 0" }}>
        {!total
          ? "Ingen kampe i indeværende runde i de valgte turneringer."
          : value === "current"
            ? `${locked} af ${total} kampe i indeværende runde er allerede i gang eller spillet — ${open} ${open === 1 ? "kamp kan" : "kampe kan"} stadig tippes.`
            : nextRound
              ? `Starter i runden ${nextRound.label} med ${nextRound.matches.length} ${nextRound.matches.length === 1 ? "kamp" : "kampe"}.`
              : "Ingen kommende runde fundet i de valgte turneringer."}
      </p>

      {/* Den låste runde forklares, i stedet for at knappen bare står grå. */}
      {!currentOpen && total > 0 && (
        <p style={{ color: C.muted, fontSize: 12, margin: "4px 0 0" }}>
          Alle {total} kampe i indeværende runde er låst, så der kan kun startes i en ny runde.
        </p>
      )}
    </div>
  );
}

export default RoundStartChoice;
