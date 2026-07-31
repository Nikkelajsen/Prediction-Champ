// Rundehoved: rundelabel + pager på én linje, og rundens status (deadline, lås,
// tippet-tæller, point) på én dæmpet linje under. Deadline hører til runden — ikke
// til hver enkelt kamp — så den står KUN her.
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import { C, font, pagerBtn } from "../../ui/theme.js";
import { InfoDot } from "../../ui/components.jsx";

// (Bevidst ikke den delte RoundPager: den bruges uændret af AdminScreen.)
function RoundHeader({ rounds, index, setIndex, status, hint }) {
  const round = rounds[index];
  const canPrev = index > 0;
  const canNext = index < rounds.length - 1;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          flex: 1, minWidth: 0, fontFamily: font.display, textTransform: "uppercase",
          fontWeight: 700, fontSize: 18, lineHeight: 1.1, color: C.text,
        }}>
          Runde {round.label}{" "}
          {/* Tip-skærmen havde ingen forklaring overhovedet. Reglerne, en ny bruger
              undrer sig over præcis her — hvad giver point, hvornår kan jeg ikke
              rette mere, og hvornår må jeg se de andres — står nu ved runden selv. */}
          <InfoDot title="Runden">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div><b>Point:</b> <span style={{ color: C.green, fontWeight: 700 }}>+3</span> for det præcise resultat,{" "}
                <span style={{ color: C.greenSoft, fontWeight: 700 }}>+1</span> for den rigtige vinder (eller uafgjort). Aldrig minuspoint.</div>
              <div><b>Lås:</b> hele runden låser samtidig, 1 time før rundens første kamp. Indtil da kan du rette dine gæt frit.</div>
              <div><b>Andres gæt:</b> først synlige, når runden er låst — så tipper alle på samme grundlag. Fra låsen kan du trykke på en kamp og se alles gæt.</div>
            </div>
          </InfoDot>
        </div>
        <span style={{ color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>{index + 1}/{rounds.length}</span>
        <button style={{ ...pagerBtn(canPrev), padding: "4px 8px" }} disabled={!canPrev}
          aria-label="Forrige runde" onClick={() => setIndex(index - 1)}><ChevronLeft size={16} /></button>
        <button style={{ ...pagerBtn(canNext), padding: "4px 8px" }} disabled={!canNext}
          aria-label="Næste runde" onClick={() => setIndex(index + 1)}><ChevronRight size={16} /></button>
      </div>
      {status && <div style={{ color: C.muted, fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>{status}</div>}
      {/* Forklaringslinjen står ÉT sted for hele runden i stedet for en "Alles gæt"-knap
          på hver eneste række. Samme greb som under stillingstabellen i BoardScreen:
          sig hvad der kan trykkes på, frem for at håbe rækken selv afslører det. */}
      {hint && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.muted, fontSize: 11.5, marginTop: 5, lineHeight: 1.3 }}>
          <Users size={13} style={{ flexShrink: 0 }} />
          {hint}
        </div>
      )}
    </div>
  );
}

export { RoundHeader };
