// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState, useEffect } from "react";
import { Trophy, Copy, Check, ClipboardList } from "lucide-react";
import { outcome } from "../lib/scoring.js";
import { computeCompetitionState, loadRatingMap } from "../lib/data.js";
import { C, btnGhost, btnGold, font, muted, thStyle } from "../ui/theme.js";
import { BackBar, Card, UserRoundPredictions } from "../ui/components.jsx";

function BoardScreen({ token, userId, competitions, initialCompId, inviterName, onBack, goToPredictions }) {
  const [selectedCompId, setSelectedCompId] = useState(initialCompId || competitions[0]?.id || null);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAllRounds, setShowAllRounds] = useState(false);
  const [viewUser, setViewUser] = useState(null);
  const comp = competitions.find((c) => c.id === selectedCompId);

  useEffect(() => {
    if (!selectedCompId || !comp) return;
    (async () => {
      setLoading(true);
      setShowAllRounds(false);
      const rules = comp.rules || { exact: 3, outcome: 1 };
      const result = await computeCompetitionState(token, selectedCompId, rules);
      try {
        const ratingMap = await loadRatingMap(token);
        result.rows.forEach((row) => {
          const rt = ratingMap.get(row.userId);
          if (rt) { row.rating = rt.rating; row.provisional = rt.provisional; }
        });
      } catch (e) { /* ratings optional */ }
      setState(result);
      setLoading(false);
    })();
  }, [selectedCompId, comp]); // eslint-disable-line

  async function shareInvite() {
    if (!comp) return;
    const link = `${window.location.origin}${window.location.pathname}?join=${comp.invite_code}`;
    const intro = inviterName
      ? `${inviterName} har inviteret dig til ligaen "${comp.name}" på Prediction Champ ⚽`
      : `Du er inviteret til ligaen "${comp.name}" på Prediction Champ ⚽`;
    const text = `${intro}\nGæt resultater, saml point og se hvem der er bedst. Tryk her for at være med:\n${link}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Prediction Champ", text });
      } else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (e) { /* bruger annullerede deling — ignorér */ }
  }

  if (!competitions.length) {
    return (<div><BackBar title="Stilling" onBack={onBack} /><p style={muted}>Opret eller join en konkurrence først.</p></div>);
  }

  const roundsDesc = state?.rounds ? state.rounds.slice().reverse() : [];
  const shownRounds = showAllRounds ? roundsDesc : roundsDesc.slice(0, 3);
  const completedRounds = (state?.allRounds || []).filter(
    (r) => r.matches.length > 0 && r.matches.every((m) => m.home_score !== null && m.home_score !== undefined)
  );
  const hasCompleted = completedRounds.length > 0;
  const openUser = (uid, playerName, initialKey = null) => { if (hasCompleted) setViewUser({ userId: uid, playerName, initialKey }); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BackBar title="Stilling" onBack={onBack} />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select className="field" style={{ flex: 1, minWidth: 160 }} value={selectedCompId || ""} onChange={(e) => setSelectedCompId(e.target.value)}>
          {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button style={btnGold} onClick={shareInvite}>
          {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Kopieret!" : "Invitér"}
        </button>
        <button style={btnGhost} onClick={() => goToPredictions(selectedCompId)}><ClipboardList size={15} /> Tip</button>
      </div>

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase" }}>Stilling</div>
          {state?.isComplete
            ? <span style={{ background: "rgba(240,180,41,0.15)", color: C.gold, fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 4 }}><Trophy size={12} />Afsluttet</span>
            : state && state.totalMatches > 0 && <span style={{ color: C.muted, fontSize: 12 }}>{state.playedMatches}/{state.totalMatches} spillet</span>}
        </div>
        {loading && <p style={{ ...muted, margin: 0 }}>Beregner…</p>}
        {!loading && state && state.rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr className="rowline">
                <th style={thStyle}>#</th>
                <th style={thStyle}>Spiller</th>
                <th style={{ ...thStyle, textAlign: "center" }} title="Prediction Champ Rating">Rating</th>
                <th style={{ ...thStyle, textAlign: "center" }} title="Antal præcise resultater">🎯</th>
                <th style={{ ...thStyle, textAlign: "center" }} title="Point i de seneste 3 runder">Form</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Point</th>
              </tr></thead>
              <tbody>
                {state.rows.map((r, i) => (
                  <tr key={r.player} className="rowline" style={{ background: r.userId === userId ? "rgba(34,197,94,0.06)" : "transparent" }}>
                    <td style={{ color: i === 0 ? C.gold : C.muted, fontWeight: 700, whiteSpace: "nowrap", fontFamily: font.display }}>
                      {i === 0 && state.isComplete ? "🏆" : i + 1}
                      {r.rankDelta !== undefined && r.rankDelta !== 0 && (
                        <span style={{ fontSize: 11, marginLeft: 4, color: r.rankDelta > 0 ? C.green : C.red }}>
                          {r.rankDelta > 0 ? `▲${r.rankDelta}` : `▼${Math.abs(r.rankDelta)}`}
                        </span>
                      )}
                    </td>
                    <td style={{ color: C.text, fontWeight: r.userId === userId ? 700 : 600 }}>
                      {hasCompleted
                        ? <span onClick={() => openUser(r.userId, r.player)} style={{ cursor: "pointer", textDecoration: "underline", textDecorationColor: C.line }}>{r.player}</span>
                        : r.player}
                    </td>
                    <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                      {r.rating != null
                        ? <span style={{ color: C.gold, fontWeight: 700, fontSize: 13 }}>{r.rating}{r.provisional ? <span style={{ color: C.muted, fontWeight: 400 }} title="Foreløbig">*</span> : ""}</span>
                        : <span style={{ color: C.muted, fontSize: 13 }}>–</span>}
                    </td>
                    <td style={{ textAlign: "center", color: C.text, fontSize: 13 }}>{r.exactCount}</td>
                    <td style={{ textAlign: "center", color: C.muted, fontSize: 13 }}>{r.form3}</td>
                    <td style={{ textAlign: "right" }}>
                      <span style={{ background: i === 0 ? "rgba(240,180,41,0.15)" : C.surface2, color: i === 0 ? C.gold : C.text, fontSize: 15, fontWeight: 700, borderRadius: 999, padding: "3px 10px" }}>{r.total}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && state && state.rows.length > 0 && (
          <p style={{ ...muted, marginTop: 8, marginBottom: 0, fontSize: 11 }}>🎯 = præcise resultater · Form = point seneste 3 runder · ▲▼ = ændring efter seneste runde</p>
        )}
        {!loading && state && state.rows.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen deltagere endnu.</p>}
      </Card>

      {!loading && state && roundsDesc.length > 0 && (
        <Card>
          <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>Point pr. runde</div>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr className="rowline">
                <th style={thStyle}>Runde</th>
                {state.rows.map((row) => <th key={row.player} style={{ ...thStyle, textAlign: "center", whiteSpace: "nowrap" }}>{row.player}</th>)}
              </tr></thead>
              <tbody>
                {shownRounds.map((r) => {
                  const best = Math.max(...state.rows.map((x) => x.perRound[r.key] ?? -Infinity));
                  return (
                    <tr key={r.key} className="rowline">
                      <td style={{ color: C.text, fontSize: 13, whiteSpace: "nowrap" }}>{r.label}</td>
                      {state.rows.map((row) => {
                        const v = row.perRound[r.key];
                        const isBest = v !== undefined && v === best && v > 0;
                        const clickable = v !== undefined && completedRounds.some((cr) => cr.key === r.key);
                        return (
                          <td key={row.player} style={{ textAlign: "center", color: isBest ? C.gold : C.text, fontWeight: isBest ? 700 : 400 }}>
                            {clickable
                              ? <span onClick={() => openUser(row.userId, row.player, r.key)} style={{ cursor: "pointer", textDecoration: "underline", textDecorationColor: C.line }}>{v}</span>
                              : (v ?? "–")}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {roundsDesc.length > 3 && (
            <p style={{ ...muted, marginTop: 10, marginBottom: 0, cursor: "pointer", textDecoration: "underline" }}
              onClick={() => setShowAllRounds(!showAllRounds)}>
              {showAllRounds ? "Vis kun de 3 seneste" : `Vis alle ${roundsDesc.length} runder`}
            </p>
          )}
        </Card>
      )}

      {viewUser && state && (
        <UserRoundPredictions playerName={viewUser.playerName} userId={viewUser.userId}
          completedRounds={completedRounds} predsByKey={state.predsByKey}
          rules={comp?.rules || { exact: 3, outcome: 1 }} initialKey={viewUser.initialKey}
          onClose={() => setViewUser(null)} />
      )}
    </div>
  );
}

export default BoardScreen;
