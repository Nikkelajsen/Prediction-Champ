// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState, useEffect, useMemo } from "react";
import { Crown } from "lucide-react";
import { currentMonthKey, loadMonthlyBoard, loadMonthsAvailable, loadSeasonBoard, monthName } from "../lib/data.js";
import { C, font, muted } from "../ui/theme.js";
import { Card, Eyebrow, H, InfoDot } from "../ui/components.jsx";

function ChampionshipTab({ token, userId, leagues = [] }) {
  const [months, setMonths] = useState([]);
  const [month, setMonth] = useState(currentMonthKey());
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState(null); // null=henter · undefined=ingen liga · objekt=data

  const superliga = useMemo(
    () => leagues.find((l) => /superliga/i.test(l.name || "") && l.is_visible !== false)
      || leagues.find((l) => /superliga/i.test(l.name || "")) || null,
    [leagues]
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      const ms = await loadMonthsAvailable(token);
      const list = ms.length ? ms : [currentMonthKey()];
      setMonths(list);
      const chosen = list.includes(month) ? month : list[0];
      setMonth(chosen);
      setRows(await loadMonthlyBoard(token, chosen));
      setLoading(false);
    })();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!superliga) { setSeason(undefined); return; }
    let cancelled = false;
    (async () => {
      setSeason(null);
      try {
        const b = await loadSeasonBoard(token, superliga.id);
        if (!cancelled) setSeason(b || undefined);
      } catch (e) { if (!cancelled) setSeason(undefined); }
    })();
    return () => { cancelled = true; };
  }, [token, superliga]); // eslint-disable-line

  async function changeMonth(m) {
    setMonth(m); setRows(null);
    setRows(await loadMonthlyBoard(token, m));
  }

  const champ = rows && rows.length ? rows[0] : null;
  const isPast = month < currentMonthKey();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <Eyebrow>Officielle konkurrencer · alle er med <InfoDot title="Championship">Officielle konkurrencer, hvor alle brugere automatisk er med — ingen tilmelding.</InfoDot></Eyebrow>
        <H>Championship</H>
      </div>

      {/* Månedsliga */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
            Månedsliga
            <InfoDot title="Månedsliga">Dine samlede point for alle månedens kampe (hver kamp tælles én gang på tværs af ligaer). Uafgjort afgøres på flest præcise resultater. Månedens vinder kåres som Månedens Prediction Champ. Alle er automatisk med, og stillingen nulstilles den 1. i hver måned.</InfoDot>
          </div>
          <select className="field" value={month} onChange={(e) => changeMonth(e.target.value)} style={{ padding: "4px 8px", fontSize: 12 }}>
            {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </div>

        {champ && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, background: "rgba(240,180,41,0.1)",
            border: `1px solid rgba(240,180,41,0.35)`, borderRadius: 10, padding: "8px 12px", marginBottom: 10,
          }}>
            <Crown size={16} color={C.gold} />
            <span style={{ fontSize: 13 }}><b>{champ.player}</b> {isPast ? "er Månedens Prediction Champ" : "fører lige nu"}</span>
          </div>
        )}

        {loading && <p style={{ ...muted, margin: 0 }}>Henter…</p>}
        {!loading && rows && rows.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen point i denne måned endnu.</p>}
        {!loading && rows && rows.map((r, i) => {
          const you = r.userId === userId;
          return (
            <div key={r.userId} style={{
              display: "grid", gridTemplateColumns: "24px 1fr auto auto", gap: 10, alignItems: "center",
              padding: "8px 0", borderTop: i ? `1px solid ${C.line}` : "none",
              background: you ? "rgba(34,197,94,0.06)" : "transparent",
              margin: you ? "0 -8px" : 0, paddingLeft: you ? 8 : 0, paddingRight: you ? 8 : 0, borderRadius: you ? 8 : 0,
            }}>
              <span style={{ fontFamily: font.display, fontWeight: 700, color: i === 0 ? C.gold : C.muted }}>{i + 1}</span>
              <span style={{ fontSize: 14, fontWeight: you ? 700 : 400 }}>{r.player}{you ? " (dig)" : ""}</span>
              <span style={{ color: C.muted, fontSize: 12 }}>{r.exactCount} × 🎯 · {r.matches} kampe</span>
              <span style={{ fontFamily: font.display, fontSize: 17, fontWeight: 700 }}>{r.total}</span>
            </div>
          );
        })}
        <div style={{ color: C.muted, fontSize: 11, marginTop: 8 }}>Samlede point for månedens kampe · uafgjort afgøres på flest præcise resultater</div>
      </Card>

      {/* Sæsonchampionship (live — samlede point for hele sæsonen) */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
            Sæsonchampionship
            <InfoDot title="Sæsonchampionship">Dine samlede point for alle {superliga?.name || "Superligaens"} kampe i hele sæsonen. Alle er automatisk med. Uafgjort afgøres på flest præcise resultater, og sæsonens bedste kåres som Sæsonens Prediction Champ.</InfoDot>
          </div>
          {season && season.rows && season.totalMatches > 0 && (
            <span style={{ color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>{season.playedMatches}/{season.totalMatches} spillet</span>
          )}
        </div>
        <div style={{ color: C.muted, fontSize: 12, marginTop: -4, marginBottom: 8 }}>
          {superliga?.name || "Superligaen"} · løber over hele sæsonen
        </div>

        {season === null && <p style={{ ...muted, margin: 0 }}>Henter…</p>}
        {season === undefined && <p style={{ ...muted, margin: 0 }}>Sæsonchampionship er ikke tilgængeligt endnu.</p>}
        {season && season.rows && season.rows.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen point i sæsonen endnu — stillingen fyldes, når kampene spilles.</p>}

        {season && season.rows && season.rows.length > 0 && (
          <>
            <div style={{
              display: "flex", alignItems: "center", gap: 8, background: "rgba(240,180,41,0.1)",
              border: `1px solid rgba(240,180,41,0.35)`, borderRadius: 10, padding: "8px 12px", marginBottom: 10,
            }}>
              <Crown size={16} color={C.gold} />
              <span style={{ fontSize: 13 }}><b>{season.rows[0].player}</b> {season.isComplete ? "er Sæsonens Prediction Champ" : "fører lige nu"}</span>
            </div>
            {season.rows.map((r, i) => {
              const you = r.userId === userId;
              return (
                <div key={r.userId} style={{
                  display: "grid", gridTemplateColumns: "24px 1fr auto auto", gap: 10, alignItems: "center",
                  padding: "8px 0", borderTop: i ? `1px solid ${C.line}` : "none",
                  background: you ? "rgba(34,197,94,0.06)" : "transparent",
                  margin: you ? "0 -8px" : 0, paddingLeft: you ? 8 : 0, paddingRight: you ? 8 : 0, borderRadius: you ? 8 : 0,
                }}>
                  <span style={{ fontFamily: font.display, fontWeight: 700, color: i === 0 ? C.gold : C.muted }}>{i + 1}</span>
                  <span style={{ fontSize: 14, fontWeight: you ? 700 : 400 }}>{r.player}{you ? " (dig)" : ""}</span>
                  <span style={{ color: C.muted, fontSize: 12 }}>{r.exactCount} × 🎯 · {r.matches} kampe</span>
                  <span style={{ fontFamily: font.display, fontSize: 17, fontWeight: 700 }}>{r.total}</span>
                </div>
              );
            })}
            <div style={{ color: C.muted, fontSize: 11, marginTop: 8 }}>Samlede point for hele sæsonen · uafgjort afgøres på flest præcise resultater</div>
          </>
        )}
      </Card>

      {/* Plads til flere events */}
      <Card style={{ borderStyle: "dashed", background: "transparent" }}>
        <div style={{ color: C.muted, fontSize: 13, textAlign: "center" }}>
          Her lander fremtidige events — fx en cup-weekend eller tema-runder
        </div>
      </Card>
    </div>
  );
}

export default ChampionshipTab;
