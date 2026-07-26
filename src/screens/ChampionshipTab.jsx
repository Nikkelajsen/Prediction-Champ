// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState, useEffect, useMemo } from "react";
import { Crown, ChevronLeft, ChevronRight } from "lucide-react";
import { currentMonthKey, loadMonthlyBoard, loadMonthsAvailable, loadRatingMap, loadRoundsAvailable, loadRoundBoard, loadSeasonBoard, monthName } from "../lib/data.js";
import { roundLabel } from "../lib/scoring.js";
import { leaders } from "../lib/standings.js";
import { C, font, muted, pagerBtn, thStyle } from "../ui/theme.js";
import { Card, Eyebrow, H, InfoDot, Modal, PlayerName } from "../ui/components.jsx";

// Kolonne-forklaringen under stillingerne. Hele tiebreaker-stigen står i InfoDot'en
// og på "Sådan virker det" — her nævnes kun det, tabellen faktisk viser, og først
// når der rent faktisk ér en delt placering at forklare.
const TIEBREAK_HINT = (rows) =>
  "🎯 = præcise resultater" + (rows.some((r) => r.shared) ? " · ens placering = delt" : "");

// Stilling i samme format som liga (BoardScreen): en rigtig tabel med kolonne-
// overskrifter, så 🎯 (præcise resultater) er en kolonne-header i stedet for at
// stå på hver række. Placeringen kommer fra rækkens `rank` (ægte, delt placering
// sat af assignRanks) — ikke fra listeindekset, som ville vise to lige spillere
// som "3." og "4.".
export function StandingsTable({ rows, userId, isComplete, ratingMap, openProfile }) {
  return (
    <table style={{ tableLayout: "fixed", width: "100%" }}>
      <colgroup>
        <col style={{ width: 26 }} />
        <col />
        <col style={{ width: 50 }} />
        <col style={{ width: 30 }} />
        <col style={{ width: 52 }} />
      </colgroup>
      <thead><tr className="rowline">
        <th style={{ ...thStyle, padding: "8px 2px" }}>#</th>
        <th style={{ ...thStyle, padding: "8px 4px" }}>Spiller</th>
        <th style={{ ...thStyle, textAlign: "center", padding: "8px 2px" }} title="Prediction Champ Rating">Rating</th>
        <th style={{ ...thStyle, textAlign: "center", padding: "8px 2px" }} title="Antal præcise resultater">🎯</th>
        <th style={{ ...thStyle, textAlign: "right", padding: "8px 2px" }}>Point</th>
      </tr></thead>
      <tbody>
        {rows.map((r) => {
          const you = r.userId === userId;
          const rt = ratingMap?.get(r.userId);
          const top = r.rank === 1;
          return (
            <tr key={r.userId} className="rowline" style={{ background: you ? "rgba(34,197,94,0.06)" : "transparent" }}>
              <td style={{ color: top ? C.gold : C.muted, fontWeight: 700, whiteSpace: "nowrap", fontFamily: font.display, padding: "8px 2px" }}>
                {top && isComplete ? "🏆" : r.rank}
              </td>
              <td style={{ color: C.text, fontWeight: you ? 700 : 600, padding: "8px 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <PlayerName userId={r.userId} name={r.player} you={you} onOpenProfile={openProfile} truncate />
              </td>
              <td style={{ textAlign: "center", whiteSpace: "nowrap", padding: "8px 2px" }}>
                {rt
                  ? <span style={{ color: C.gold, fontWeight: 700, fontSize: 13 }}>{rt.rating}{rt.provisional ? <span style={{ color: C.muted, fontWeight: 400 }} title="Foreløbig">*</span> : ""}</span>
                  : <span style={{ color: C.muted, fontSize: 13 }}>–</span>}
              </td>
              <td style={{ textAlign: "center", color: C.text, fontSize: 13, padding: "8px 2px" }}>{r.exactCount}</td>
              <td style={{ textAlign: "right", padding: "8px 2px" }}>
                <span style={{ background: top ? "rgba(240,180,41,0.15)" : C.surface2, color: top ? C.gold : C.text, fontSize: 15, fontWeight: 700, borderRadius: 999, padding: "3px 8px" }}>{r.total}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Fuld stilling i modal med paginering (maks. 20 pr. side).
function FullStandingsModal({ title, rows, userId, isComplete, ratingMap, onClose, openProfile }) {
  const [page, setPage] = useState(0);
  const perPage = 20;
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const start = page * perPage;
  const slice = rows.slice(start, start + perPage);
  return (
    <Modal title={title} onClose={onClose}>
      <StandingsTable rows={slice} userId={userId} isComplete={isComplete} ratingMap={ratingMap} openProfile={openProfile} />
      {pages > 1 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
          <button style={pagerBtn(page > 0)} disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronLeft size={16} /></button>
          <span style={{ color: C.muted, fontSize: 12 }}>Side {page + 1} af {pages}</span>
          <button style={pagerBtn(page < pages - 1)} disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}><ChevronRight size={16} /></button>
        </div>
      )}
      <p style={{ ...muted, marginTop: 10, marginBottom: 0, fontSize: 11 }}>{TIEBREAK_HINT(rows)}</p>
    </Modal>
  );
}

// Kåringen øverst på hvert kort. Titlen kan deles: er to spillere ægte lige hele
// tiebreaker-stigen ned, er de begge champ — så nævner banneret dem begge frem for
// at lade en skjult nøgle udpege en vinder, tabellen ikke kan forklare.
export function Champions({ rows, title, isComplete, openProfile }) {
  const top = leaders(rows);
  if (!top.length) return null;
  const shared = top.length > 1;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, background: "rgba(240,180,41,0.1)",
      border: `1px solid rgba(240,180,41,0.35)`, borderRadius: 10, padding: "8px 12px", marginBottom: 10,
    }}>
      <Crown size={16} color={C.gold} />
      <span style={{ fontSize: 13 }}>
        {top.map((r, i) => (
          <span key={r.userId}>
            {i > 0 && (i === top.length - 1 ? " og " : ", ")}
            <b><PlayerName userId={r.userId} name={r.player} onOpenProfile={openProfile} /></b>
          </span>
        ))}
        {" "}
        {isComplete
          ? (shared ? `er delt ${title}` : `er ${title}`)
          : (shared ? "deler føringen lige nu" : "fører lige nu")}
      </span>
    </div>
  );
}

// Kort-visning: top 5 i tabel-format + link til fuld stilling, når der er flere.
function Standings({ rows, userId, isComplete, ratingMap, title, onOpenFull, openProfile }) {
  return (
    <>
      <StandingsTable rows={rows.slice(0, 5)} userId={userId} isComplete={isComplete} ratingMap={ratingMap} openProfile={openProfile} />
      {rows.length > 5 && (
        <p style={{ ...muted, marginTop: 8, marginBottom: 0, cursor: "pointer", textDecoration: "underline" }}
          onClick={() => onOpenFull({ title, rows, isComplete })}>
          Vis hele stillingen ({rows.length}) →
        </p>
      )}
      <div style={{ color: C.muted, fontSize: 11, marginTop: 8 }}>{TIEBREAK_HINT(rows)}</div>
    </>
  );
}

function ChampionshipTab({ token, userId, leagues = [], openProfile }) {
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
            <InfoDot title="Rundens Prediction Champ">Dine samlede point for én enkelt spillerunde (på tværs af alle turneringer, hver kamp én gang). Alle er automatisk med. Ved pointlighed afgør flest præcise resultater, så flest korrekte udfald, og til sidst hvem der var tættest på. Rundens bedste kåres som Rundens Prediction Champ — er to helt lige, deles titlen. Vælg en runde i dropdownen.</InfoDot>
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
            <Champions rows={roundBoard.rows} title="Rundens Prediction Champ" isComplete={roundBoard.isComplete} openProfile={openProfile} />
            <Standings rows={roundBoard.rows} userId={userId} isComplete={roundBoard.isComplete} ratingMap={ratingMap}
              title={`Rundeliga · runde ${roundKey ? roundLabel(roundKey) : ""}`} onOpenFull={setFull} openProfile={openProfile} />
          </>
        )}
      </Card>

      {/* Månedsliga */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
            Månedens Prediction Champ
            <InfoDot title="Månedens Prediction Champ">Dine samlede point for alle månedens kampe (hver kamp tælles én gang på tværs af turneringer). Ved pointlighed afgør flest præcise resultater, så flest korrekte udfald, så flest rundesejre, og til sidst hvem der var tættest på. Månedens vinder kåres som Månedens Prediction Champ — er to helt lige, deles titlen. Alle er automatisk med, og stillingen nulstilles den 1. i hver måned.</InfoDot>
          </div>
          <select className="field" value={month} onChange={(e) => changeMonth(e.target.value)} style={{ padding: "4px 8px", fontSize: 12 }}>
            {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </div>

        {rows && <Champions rows={rows} title="Månedens Prediction Champ" isComplete={isPast} openProfile={openProfile} />}

        {loading && <p style={{ ...muted, margin: 0 }}>Henter…</p>}
        {!loading && rows && rows.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen point i denne måned endnu.</p>}
        {!loading && rows && rows.length > 0 && (
          <Standings rows={rows} userId={userId} isComplete={isPast} ratingMap={ratingMap}
            title={`Månedsliga · ${monthName(month)}`} onOpenFull={setFull} openProfile={openProfile} />
        )}
      </Card>

      {/* Sæsonchampionship (live — samlede point for hele sæsonen) */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
            Sæsonens Prediction Champ
            <InfoDot title="Sæsonens Prediction Champ">Dine samlede point for alle {superliga?.name || "Superligaens"} kampe i hele sæsonen. Alle er automatisk med. Ved pointlighed afgør flest præcise resultater, så flest korrekte udfald, så flest rundesejre, og til sidst hvem der var tættest på. Sæsonens bedste kåres som Sæsonens Prediction Champ — er to helt lige, deles titlen.</InfoDot>
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
            <Champions rows={season.rows} title="Sæsonens Prediction Champ" isComplete={season.isComplete} openProfile={openProfile} />
            <Standings rows={season.rows} userId={userId} isComplete={season.isComplete} ratingMap={ratingMap}
              title={`Sæsonchampionship · ${superliga?.name || "Superligaen"}`} onOpenFull={setFull} openProfile={openProfile} />
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
          ratingMap={ratingMap} onClose={() => setFull(null)} openProfile={openProfile} />
      )}
    </div>
  );
}

export default ChampionshipTab;
