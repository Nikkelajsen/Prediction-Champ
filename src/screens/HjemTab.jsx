// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState, useEffect } from "react";
import { ChevronRight, Clock, Check } from "lucide-react";
import { formatKickoff, outcome } from "../lib/scoring.js";
import { computeCompetitionState, computeHomeTips, currentMonthKey, daFullDate, fmtCountdown, loadMonthlyBoard, loadRatingBoard, loadRatingHistory, monthName } from "../lib/data.js";
import { C, btnGreen, font, muted } from "../ui/theme.js";
import { Card, Eyebrow, FormDots, H, Move } from "../ui/components.jsx";

function HjemTab({ token, userId, profile, competitions, goTab, openPredictions, openBoard }) {
  const [tips, setTips] = useState(null);
  const [snapshot, setSnapshot] = useState(null); // { rating, move, form, rank, total }
  const [placements, setPlacements] = useState(null); // [{ label, pos, gold, onClick }]
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // deadline / manglende tips
      try {
        const t = await computeHomeTips(token, userId, competitions);
        if (!cancelled) setTips(t);
      } catch (e) { if (!cancelled) setTips({ hasComps: competitions.length > 0, error: true }); }

      // rating-snapshot
      try {
        const [board, hist] = await Promise.all([loadRatingBoard(token), loadRatingHistory(token)]);
        const idx = board.findIndex((r) => r.userId === userId);
        if (!cancelled) {
          if (idx >= 0) {
            const me = board[idx];
            const h = hist.get(userId) || {};
            setSnapshot({ rating: me.rating, move: h.move || 0, form: h.form || [], rank: idx + 1, total: board.length, provisional: me.provisional });
          } else {
            setSnapshot({ none: true });
          }
        }
      } catch (e) { if (!cancelled) setSnapshot({ none: true }); }

      // placeringer: månedsliga + hver privat konkurrence
      try {
        const list = [];
        const monthly = await loadMonthlyBoard(token, currentMonthKey());
        const mIdx = monthly.findIndex((r) => r.userId === userId);
        if (mIdx >= 0) list.push({ label: "Månedsliga · " + monthName(currentMonthKey()), pos: `${mIdx + 1}.`, tab: "championship" });
        for (const c of competitions.filter((x) => !x._hidden)) {
          try {
            const state = await computeCompetitionState(token, c.id, c.rules || { exact: 3, outcome: 1 });
            const rIdx = state.rows.findIndex((r) => r.userId === userId);
            if (rIdx >= 0 && state.rows.length) list.push({ label: c.name, pos: `${rIdx + 1}.`, compId: c.id });
          } catch (e) { /* spring over */ }
        }
        if (!cancelled) setPlacements(list);
      } catch (e) { if (!cancelled) setPlacements([]); }
    })();
    return () => { cancelled = true; };
  }, [token, userId, competitions]); // eslint-disable-line

  const displayName = profile?.display_name || "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <Eyebrow>{daFullDate()}</Eyebrow>
        <H size={30}>Hej {displayName}</H>
      </div>

      {/* Signatur: næste deadline */}
      {tips === null && <Card><span style={{ color: C.muted, fontSize: 13 }}>Henter din næste deadline…</span></Card>}
      {tips && !tips.hasComps && (
        <Card style={{ borderStyle: "dashed", background: "transparent" }}>
          <div style={{ color: C.muted, fontSize: 14, textAlign: "center" }}>
            Du er ikke med i nogen ligaer endnu. <span onClick={() => goTab("ligaer")} style={{ color: C.green, cursor: "pointer", fontWeight: 700 }}>Opret eller join én →</span>
          </div>
        </Card>
      )}
      {tips && tips.hasComps && tips.allTipped && (
        <Card style={{ borderColor: C.green, background: "linear-gradient(135deg, #14212F 0%, #14302A 100%)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Check size={16} color={C.green} />
            <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase", color: C.green }}>Alt ok — alle tips er inde</div>
          </div>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
            {tips.nextOpen ? `Næste kamp: ${formatKickoff(tips.nextOpen)}` : "Vi giver besked, når næste runde åbner."}
          </div>
        </Card>
      )}
      {tips && tips.hasComps && !tips.allTipped && !tips.noMatches && !tips.error && (
        <Card style={{ borderColor: C.red, background: "linear-gradient(135deg, #14212F 0%, #2E1620 100%)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.red, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            <Clock size={13} /> Deadline om {fmtCountdown(tips.deadline)}
          </div>
          <div style={{ fontFamily: font.display, fontSize: 22, fontWeight: 700, textTransform: "uppercase", marginTop: 4 }}>
            Runde {tips.roundLabelText} · {tips.missingCount} {tips.missingCount === 1 ? "kamp mangler" : "kampe mangler"} tips
          </div>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{tips.names.join(" · ")}</div>
          <button style={{ ...btnGreen, marginTop: 12 }} onClick={() => openPredictions("all", tips.roundKey)}>Tip nu</button>
        </Card>
      )}

      {/* Rating-snapshot */}
      {snapshot && !snapshot.none && (
        <Card onClick={() => goTab("rating")}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <Eyebrow>Din rating</Eyebrow>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontFamily: font.display, fontSize: 34, fontWeight: 700 }}>{snapshot.rating}{snapshot.provisional ? <span style={{ color: C.muted, fontSize: 18 }}>*</span> : ""}</span>
                <Move d={snapshot.move} />
              </div>
              <div style={{ color: C.muted, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                Nr. {snapshot.rank} af {snapshot.total} {snapshot.form.length > 0 && <>· <FormDots form={snapshot.form} /></>}
              </div>
            </div>
            <ChevronRight color={C.muted} />
          </div>
        </Card>
      )}

      {/* Placeringer */}
      {placements && placements.length > 0 && (
        <Card>
          <Eyebrow>Dine placeringer</Eyebrow>
          {placements.map((r, i) => (
            <div key={i} onClick={() => r.tab ? goTab(r.tab) : openBoard(r.compId)} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 0", borderTop: i ? `1px solid ${C.line}` : "none", cursor: "pointer",
            }}>
              <span style={{ fontSize: 14 }}>{r.label}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: font.display, fontSize: 18, fontWeight: 700, color: r.pos === "1." ? C.gold : C.text }}>{r.pos}</span>
                <ChevronRight size={15} color={C.muted} />
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

export default HjemTab;
