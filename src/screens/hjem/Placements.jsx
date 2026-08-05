// "Dine placeringer" på Hjem. Ren flytning ud af `HjemTab.jsx`
// (G1, august 2026).
import { ChevronRight } from "lucide-react";
import { C, font } from "../../ui/theme.js";

// pr. liga (liga-laget). Har brugeren ingen ligaer, vises konkurrencerne fladt som før.
function Placements({ placements, goTab, openBoard }) {
  const monthlyRows = placements.filter((r) => r.tab);
  const compRows = placements.filter((r) => r.compId);
  const hasGroups = compRows.some((r) => r.groupId);

  // Rigtige knapper og ikke klikbare `<div>`s (G22): rækkerne er appens
  // primære vej videre fra Hjem, og de var tastatur-uopnåelige og uden rolle
  // for en skærmlæser. `width: 100%` + `textAlign: left` beholder udseendet.
  const Row = ({ r, top }) => (
    <button type="button" onClick={() => (r.tab ? goTab(r.tab) : openBoard(r.compId))} style={{
      display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
      background: "none", border: "none", textAlign: "left", font: "inherit", color: "inherit",
      padding: "10px 0", borderTop: top ? `1px solid ${C.line}` : "none", cursor: "pointer",
    }}>
      <span style={{ fontSize: 14 }}>{r.label}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        {/* "delt" siges kun her, hvor der er plads til ord — tabellerne nøjes med tallet */}
        {r.shared && <span style={{ fontSize: 11, color: C.muted }}>delt</span>}
        <span style={{ fontFamily: font.display, fontSize: 18, fontWeight: 700, color: r.pos === "1." ? C.gold : C.text }}>{r.pos}</span>
        <ChevronRight size={15} color={C.muted} />
      </span>
    </button>
  );
  const SubHead = ({ children }) => (
    <div style={{ fontFamily: font.display, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 11, color: C.muted, margin: "12px 0 2px" }}>{children}</div>
  );

  if (!hasGroups) {
    return <>{[...monthlyRows, ...compRows].map((r, i) => <Row key={r.compId || r.tab} r={r} top={i > 0} />)}</>;
  }

  // grupper konkurrence-rækker pr. liga (første-optrædende rækkefølge); liga-løse sidst
  const order = [];
  const byKey = new Map();
  for (const r of compRows) {
    const key = r.groupId || "__loose__";
    if (!byKey.has(key)) { byKey.set(key, { key, name: r.groupId ? r.groupName : "Øvrige", rows: [] }); order.push(key); }
    byKey.get(key).rows.push(r);
  }
  const groups = order.map((k) => byKey.get(k)).sort((a, b) => (a.key === "__loose__" ? 1 : 0) - (b.key === "__loose__" ? 1 : 0));

  return (
    <>
      {monthlyRows.map((r, i) => <Row key={r.tab} r={r} top={i > 0} />)}
      {groups.map((g) => (
        <div key={g.key}>
          <SubHead>{g.name}</SubHead>
          {g.rows.map((r, i) => <Row key={r.compId} r={r} top={i > 0} />)}
        </div>
      ))}
    </>
  );
}

export default Placements;
