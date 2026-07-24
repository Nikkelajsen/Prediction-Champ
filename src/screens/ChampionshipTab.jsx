// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState, useEffect, useMemo } from "react";
import { Crown, ChevronLeft, ChevronRight } from "lucide-react";
import { currentMonthKey, loadMonthlyBoard, loadMonthsAvailable, loadRatingMap, loadRoundsAvailable, loadRoundBoard, loadSeasonBoard, monthName } from "../lib/data.js";
import { roundLabel } from "../lib/scoring.js";
import { C, font, muted, pagerBtn, thStyle } from "../ui/theme.js";
import { Card, Eyebrow, H, InfoDot, Modal } from "../ui/components.jsx";

// Stilling i samme format som liga (BoardScreen): en rigtig tabel med kolonne-
// overskrifter, så 🎯 (præcise resultater) er en kolonne-header i stedet for at
// stå på hver række. `offset` giver den korrekte placering ved paginering.
function StandingsTable({ rows, userId, isComplete, ratingMap, offset = 0 }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table>
        <thead><tr className="rowline">
          <th style={thStyle}>#</th>
          <th style={thStyle}>Spiller</th>
          <th style={{ ...thStyle, textAlign: "center" }} title="Prediction Champ Rating">Rating</th>
          <th style={{ ...thStyle, textAlign: "center" }} title="Antal præcise resultater">🎯</th>
          <th style={{ ...thStyle, textAlign: "right" }}>Point</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const rank = offset + i;
            const you = r.userId === userId;
            const rt = ratingMap?.get(r.userId);
            return (
              <tr key={r.userId} className="rowline" style={{ background: you ? "rgba(34,197,94,0.06)" : "transparent" }}>
                <td style={{ color: rank === 0 ? C.gold : C.muted, fontWeight: 700, whiteSpace: "nowrap", fontFamily: font.display }}>
                  {rank === 0 && isComplete ? "🏆" : rank + 1}
                </td>
                <td style={{ color: C.text, fontWeight: you ? 700 : 600 }}>{r.player}{you ? " (dig)" : ""}</td>
                <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                  {rt
                    ? <span style={{ color: C.gold, fontWeight: 700, fontSize: 13 }}>{rt.rating}{rt.provisional ? <span style={{ color: C.muted, fontWeight: 400 }} title="Foreløbig">*</span> : ""}</span>
                    : <span style={{ color: C.muted, fontSize: 13 }}>–</span>}
                </td>
                <td style={{ textAlign: "center", color: C.text, fontSize: 13 }}>{r.exactCount}</td>
                <td style={{ textAlign: "right" }}>
                  <span style={{ background: rank === 0 ? "rgba(240,180,41,0.15)" : C.surface2, color: rank === 0 ? C.gold : C.text, fontSize: 15, fontWeight: 700, borderRadius: 999, padding: "3px 10px" }}>{r.total}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Fuld stilling i modal med paginering (maks. 20 pr. side).
function FullStandingsModal({ title, rows, userId, isComplete, ratingMap, onClose }) {
  const [page, setPage] = useState(0);
  const perPage = 20;
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const start = page * perPage;
  const slice = rows.slice(start, start + perPage);
  return (
    <Modal title={title} onClose={onClose}>
      <StandingsTable rows={slice} offset={start} userId={userId} isComplete={isComplete} ratingMap={ratingMap} />
      {pages > 1 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
          <button style={pagerBtn(page > 0)} disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronLeft size={16} /></button>
          <span style={{ color: C.muted, fontSize: 12 }}>Side {page + 1} af {pages}</span>
          <button style={pagerBtn(page < pages - 1)} disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}><ChevronRight size={16} /></button>
        </div>
      )}
      <p style={{ ...muted, marginTop: 10, marginBottom: 0, fontSize: 11 }}>🎯 = præcise resultater · uafgjort afgøres på flest præcise resultater</p>
    </Modal>
  );
}

// Kort-visning: top 5 i tabel-format + link til fuld stilling, når der er flere.
function Standings({ rows, userId, isComplete, ratingMap, title, onOpenFull }) {
  return (
    <>
      <StandingsTable rows={rows.slice(0, 5)} userId={userId} isComplete={isComplete} ratingMap={ratingMap} />
      {rows.length > 5 && (
        <p style={{ ...muted, marginTop: 8, marginBottom: 0, cursor: "pointer", textDecoration: "underline" }}
          onClick={() => onOpenFull({ title, rows, isComplete })}>
          Vis hele stillingen ({rows.length}) →
        </p>
      )}
      <div style={{ color: C.muted, fontSize: 11, marginTop: 8 }}>🎯 = præcise resultater · uafgjort afgøres på flest præcise resultater</div>
    </>
  );
}

function ChampionshipTab({ token, userId, leagues = [] }) {
  const [months, setMonths] = useState([]);
  const [month, setMonth] = useState(currentMonthKey());
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState(null); // null=henter · undefined=ingen liga · objekt=data
  const [rounds, setRounds] = useState([]);
  const [roundKey, setRoundKey] = useState(null);
  const [roundBoard, setRoundBoard] = useState(null);
  const [ratingMap, setRatingMap] = useState(null); // user_id -> { rating, provisional }
  const [full, setFull] = useState(null); // { title, rows, isComplete } — fuld-stilling-modal

  const superliga = useMemo(
    () => leagues.find((l) => /superliga/i.test(l.name || "") && l.is_visible !== false)
      || leagues.find((l) => /superliga/i.test(l.name || "")) || null,
    [leagues]
  );

  useEffect(() => {
    loadRatingMap(token).then(setRatingMap).catch(() => setRatingMap(new Map()));
  }, [token]);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rs = await loadRoundsAvailable(token);
      if (cancelled) return;
      setRounds(rs);
      if (rs.length) {
        setRoundKey(rs[0]);
        const b = await loadRoundBoard(token, rs[0]);
        if (!cancelled) setRoundBoard(b);
      } else {
        setRoundBoard({ rows: [], totalMatches: 0, playedMatches: 0, isComplete: false });
      }
    })();
    return () => { cancelled = true; };
  }, [token]); // eslint-disable-line

  async function changeMonth(m) {
    setMonth(m); setRows(null);
    setRows(await loadMonthlyBoard(token, m));
  }

  async function changeRound(k) {
    setRoundKey(k); setRoundBoard(null);
    setRoundBoard(await loadRoundBoard(token, k));
  }

  const champ = rows && rows.length ? rows[0] : null;
  const isPast = month < currentMonthKey();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <Eyebrow>Officielle konkurrencer · alle er med <InfoDot title="Championship">Officielle konkurrencer, hvor alle brugere automatisk er med — ingen tilmelding.</InfoDot></Eyebrow>
        <H>Championship</H>
      </div>

      {/* Rundeliga — Rundens Prediction Champ */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
            Rundens Prediction Champ
            <InfoDot title="Rundens Prediction Champ">Dine samlede point for én enkelt spillerunde (på tværs af alle turneringer, hver kamp én gang). Alle er automatisk med. Uafgjort afgøres på flest præcise resultater, og rundens bedste kåres som Rundens Prediction Champ. Vælg en runde i dropdownen.</InfoDot>
          </div>
          {rounds.length > 0 && (
            <select className="field" value={roundKey || ""} onChange={(e) => changeRound(e.target.value)} style={{ padding: "4px 8px", fontSize: 12 }}>
              {rounds.map((k) => <option key={k} value={k}>{roundLabel(k)}</option>)}
            </select>
          )}
        </div>

        {roundBoard === null && <p style={{ ...muted, margin: 0 }}>Henter…</p>}
        {roundBoard && rounds.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen spillede runder endnu — stillingen kommer, når en runde er i gang.</p>}
        {roundBoard && rounds.length > 0 && roundBoard.rows.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen point i denne runde endnu.</p>}

        {roundBoard && roundBoard.rows.length > 0 && (
          <>
            <div style={{
              display: "flex", alignItems: "center", gap: 8, background: "rgba(240,180,41,0.1)",
              border: `1px solid rgba(240,180,41,0.35)`, borderRadius: 10, padding: "8px 12px", marginBottom: 10,
            }}>
              <Crown size={16} color={C.gold} />
              <span style={{ fontSize: 13 }}><b>{roundBoard.rows[0].player}</b> {roundBoard.isComplete ? "er Rundens Prediction Champ" : "fører lige nu"}</span>
            </div>
            <Standings rows={roundBoard.rows} userId={userId} isComplete={roundBoard.isComplete} ratingMap={ratingMap}
              title={`Rundeliga · runde ${roundKey ? roundLabel(roundKey) : ""}`} onOpenFull={setFull} />
          </>
        )}
      </Card>

      {/* Månedsliga */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
            Månedens Prediction Champ
            <InfoDot title="Månedens Prediction Champ">Dine samlede point for alle månedens kampe (hver kamp tælles én gang på tværs af turneringer). Uafgjort afgøres på flest præcise resultater. Månedens vinder kåres som Månedens Prediction Champ. Alle er automatisk med, og stillingen nulstilles den 1. i hver måned.</InfoDot>
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
        {!loading && rows && rows.length > 0 && (
          <Standings rows={rows} userId={userId} isComplete={isPast} ratingMap={ratingMap}
            title={`Månedsliga · ${monthName(month)}`} onOpenFull={setFull} />
        )}
      </Card>

      {/* Sæsonchampionship (live — samlede point for hele sæsonen) */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
            Sæsonens Prediction Champ
            <InfoDot title="Sæsonens Prediction Champ">Dine samlede point for alle {superliga?.name || "Superligaens"} kampe i hele sæsonen. Alle er automatisk med. Uafgjort afgøres på flest præcise resultater, og sæsonens bedste kåres som Sæsonens Prediction Champ.</InfoDot>
          </div>
          {season && season.rows && season.totalMatches > 0 && (
            <span style={{ color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>{season.playedMatches}/{season.totalMatches} spillet</span>
          )}
        </div>
        <div style={{ color: C.muted, fontSize: 12, marginTop: -4, marginBottom: 8 }}>
          {superliga?.name || "Superligaen"} · løber over hele sæsonen
        </div>

        {season === null && <p style={{ ...muted, margin: 0 }}>Henter…</p>}
        {season === undefined && <p style={{ ...muted, margin: 0 }}>Sæsonens Prediction Champ er ikke tilgængelig endnu.</p>}
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
            <Standings rows={season.rows} userId={userId} isComplete={season.isComplete} ratingMap={ratingMap}
              title={`Sæsonchampionship · ${superliga?.name || "Superligaen"}`} onOpenFull={setFull} />
          </>
        )}
      </Card>

      {/* Plads til flere events */}
      <Card style={{ borderStyle: "dashed", background: "transparent" }}>
        <div style={{ color: C.muted, fontSize: 13, textAlign: "center" }}>
          Her lander fremtidige events — fx en cup-weekend eller tema-runder
        </div>
      </Card>

      {full && (
        <FullStandingsModal title={full.title} rows={full.rows} userId={userId} isComplete={full.isComplete}
          ratingMap={ratingMap} onClose={() => setFull(null)} />
      )}
    </div>
  );
}

export default ChampionshipTab;
