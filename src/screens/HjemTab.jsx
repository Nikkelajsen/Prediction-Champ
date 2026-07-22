// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState, useEffect } from "react";
import { Bell, ChevronRight, Clock, Check, X } from "lucide-react";
import { formatKickoff, outcome } from "../lib/scoring.js";
import { computeCompetitionState, computeCurrentRound, computeHomeTips, currentMonthKey, daFullDate, fmtCountdown, loadMonthlyBoard, loadRatingBoard, loadRatingHistory, monthName } from "../lib/data.js";
import { enablePush, getExistingSubscription, isPushSupported } from "../lib/push.js";
import { C, btnGreen, font, iconBtn, muted } from "../ui/theme.js";
import { Card, Eyebrow, FormDots, H, Move } from "../ui/components.jsx";

const PUSH_DISMISS_KEY = "pc_push_dismissed";

// Opt-in-kort til push-notifikationer. Vises kun hvor det giver mening:
// browseren understøtter push, brugeren har ikke sagt nej, og er ikke tilmeldt endnu.
function PushOptInCard({ token, userId }) {
  const [state, setState] = useState(null); // null | "available" | "hidden"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!isPushSupported() || Notification.permission === "denied" || localStorage.getItem(PUSH_DISMISS_KEY)) {
          if (!cancelled) setState("hidden");
          return;
        }
        const sub = await getExistingSubscription();
        if (!cancelled) setState(sub ? "hidden" : "available");
      } catch (e) { if (!cancelled) setState("hidden"); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (state !== "available") return null;

  async function onEnable() {
    setBusy(true); setError("");
    try {
      await enablePush(token, userId);
      setState("hidden");
    } catch (e) {
      setError(e.message || "Noget gik galt — prøv igen.");
    } finally { setBusy(false); }
  }

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Bell size={15} color={C.gold} />
          <div style={{ fontFamily: font.display, fontSize: 18, fontWeight: 700, textTransform: "uppercase" }}>Få besked før deadline</div>
        </div>
        <button style={iconBtn} aria-label="Skjul" onClick={() => { try { localStorage.setItem(PUSH_DISMISS_KEY, "1"); } catch (e) {} setState("hidden"); }}>
          <X size={16} />
        </button>
      </div>
      <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
        Vi minder dig om at tippe, inden runden låser — og fortæller, hvordan den gik.
      </div>
      {error && <div style={{ color: C.red, fontSize: 13, marginTop: 8 }}>{error}</div>}
      <button style={{ ...btnGreen, marginTop: 12, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={onEnable}>
        {busy ? "Slår til …" : "Slå notifikationer til"}
      </button>
    </Card>
  );
}

// lille point-pille til runde-oversigten: grøn +3 · guld +1 · dæmpet 0 · "–" hvis intet tip
function PointsPill({ pts }) {
  if (pts == null) return <span style={{ color: C.muted, fontSize: 12 }}>–</span>;
  const col = pts >= 3 ? C.green : pts >= 1 ? C.gold : C.muted;
  const bg = pts >= 3 ? "rgba(34,197,94,0.15)" : pts >= 1 ? "rgba(240,180,41,0.15)" : "transparent";
  const border = pts >= 1 ? "none" : `1px solid ${C.line}`;
  return (
    <span style={{ background: bg, color: col, border, fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "2px 8px", minWidth: 30, textAlign: "center" }}>
      {pts > 0 ? `+${pts}` : "0"}
    </span>
  );
}

// kompakt kickoff til runde-oversigten (fx "man. 12.05. 14.00")
function shortKick(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const day = d.toLocaleDateString("da-DK", { weekday: "short", day: "2-digit", month: "2-digit" });
  const t = d.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });
  return `${day} ${t}`;
}

function HjemTab({ token, userId, profile, competitions, goTab, openPredictions, openBoard }) {
  const [tips, setTips] = useState(null);
  const [round, setRound] = useState(null); // live-oversigt over indeværende runde
  const [snapshot, setSnapshot] = useState(null); // { rating, move, form, rank, total }
  const [placements, setPlacements] = useState(null); // [{ label, pos, gold, onClick }]
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  // Indeværende runde: hentes ved mount og genindlæses hvert minut, så resultater/point
  // opdaterer løbende efterhånden som kampene spilles (results tikker ind via sync).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await computeCurrentRound(token, userId, competitions);
        if (!cancelled) setRound(r);
      } catch (e) { if (!cancelled) setRound(null); }
    };
    load();
    const id = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token, userId, competitions]); // eslint-disable-line

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

      {/* Indeværende runde: live-oversigt der opdaterer løbende */}
      {round && round.totalCount > 0 && (
        <Card onClick={() => openPredictions("all", round.roundKey)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <Eyebrow>Indeværende runde</Eyebrow>
            <span style={{ color: C.muted, fontSize: 12 }}>{round.playedCount}/{round.totalCount} spillet</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase" }}>Runde {round.roundLabelText}</span>
            {round.playedCount > 0 && (
              <span style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, color: C.gold }}>{round.myPoints} p</span>
            )}
          </div>
          <div style={{ marginTop: 6 }}>
            {round.matches.map((m, i) => (
              <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.home} – {m.away}</div>
                  <div style={{ color: C.muted, fontSize: 11, marginTop: 1 }}>{m.pred ? `Dit tip: ${m.pred.pred_home}-${m.pred.pred_away}` : "Intet tip"}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  {m.played ? (
                    <>
                      <span style={{ fontFamily: font.display, fontSize: 16, fontWeight: 700 }}>{m.homeScore}-{m.awayScore}</span>
                      <PointsPill pts={m.points} />
                    </>
                  ) : m.inProgress ? (
                    <span style={{ color: C.green, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>I gang</span>
                  ) : (
                    <span style={{ color: C.muted, fontSize: 12 }}>{shortKick(m.kickoff)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
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

      {/* Push-notifikationer: opt-in */}
      <PushOptInCard token={token} userId={userId} />
    </div>
  );
}

export default HjemTab;
