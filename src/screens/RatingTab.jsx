// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState, useEffect } from "react";
import { loadRatingBoard, loadRatingHistory } from "../lib/data.js";
import { C, font, muted } from "../ui/theme.js";
import { Card, Eyebrow, FormDots, H, InfoDot, Move } from "../ui/components.jsx";

function RatingTab({ token, userId }) {
  const [rows, setRows] = useState(null);
  const [hist, setHist] = useState(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [board, h] = await Promise.all([loadRatingBoard(token), loadRatingHistory(token)]);
      setRows(board); setHist(h);
      setLoading(false);
    })();
  }, []); // eslint-disable-line

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <Eyebrow>På tværs af alle turneringer <InfoDot title="Rating">Din langsigtede dygtighed på tværs af alle turneringer. Opdateres efter hver runde. Championship er dét, man vinder — rating er dét, man er.</InfoDot></Eyebrow>
        <H>Rating</H>
        <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
          Din langsigtede dygtighed. Opdateres efter hver runde — Championship er dét, man vinder; rating er dét, man <i>er</i>.
        </div>
      </div>

      {loading && <Card><span style={{ color: C.muted, fontSize: 13 }}>Henter…</span></Card>}
      {!loading && rows && rows.length === 0 && (
        <Card><span style={{ color: C.muted, fontSize: 13 }}>Ingen ratings endnu — de beregnes, når der er spillet runder med resultater.</span></Card>
      )}
      {!loading && rows && rows.length > 0 && (
        <Card style={{ padding: 0 }}>
          {rows.map((r, i) => {
            const you = r.userId === userId;
            const h = hist.get(r.userId) || {};
            return (
              <div key={r.userId} style={{
                display: "grid", gridTemplateColumns: "26px 1fr auto auto", gap: 10, alignItems: "center",
                padding: "12px 16px", borderTop: i ? `1px solid ${C.line}` : "none",
                background: you ? "rgba(34,197,94,0.07)" : "transparent",
              }}>
                <span style={{ fontFamily: font.display, fontSize: 18, fontWeight: 700, color: i === 0 ? C.gold : C.muted }}>{i + 1}</span>
                <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 14, fontWeight: you ? 700 : 500 }}>
                    {r.player}{you ? " (dig)" : ""}
                    {r.provisional && <span style={{
                      marginLeft: 6, fontSize: 10, color: C.gold, border: `1px solid ${C.gold}`,
                      borderRadius: 4, padding: "1px 4px", verticalAlign: "middle",
                    }}>NY</span>}
                  </span>
                  <FormDots form={h.form || []} />
                </span>
                <Move d={h.move || 0} />
                <span style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700 }}>{r.rating}</span>
              </div>
            );
          })}
        </Card>
      )}

      <div style={{ color: C.muted, fontSize: 11 }}>
        ● grøn = stærk runde · ● gul = middel · ● grå = svag. "NY" = under 5 runder (foreløbig K-faktor).
      </div>
    </div>
  );
}

export default RatingTab;
