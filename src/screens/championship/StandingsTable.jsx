// Championship-fanens stillings- og kårings-visninger.
//
// Udskilt fra ChampionshipTab.jsx den 3. august 2026 (G1, anden halvdel af
// fil-opdelingen). REN FLYTNING: ikke en linje er ændret undervejs — det er
// hele pointen med mønstret, for et grønt build er så beviset for, at ingen
// eksport er tabt. Skærmen bliver dermed en skærm (hent data, vælg omfang, sæt
// kortene sammen), og tabellen kan læses uden at rulle forbi den.
import { useState } from "react";
import { Crown, ChevronLeft, ChevronRight } from "lucide-react";
import { leaders } from "../../lib/standings.js";
import { C, font, muted, pagerBtn, thStyle } from "../../ui/theme.js";
import { Modal, PlayerName } from "../../ui/components.jsx";
import { TIEBREAK_HINT } from "./scope.js";

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

// Hvilken turnering skal sæsonchampionshippet vise, når der er mere end én?
//
// Erstatter det gamle `/superliga/i`-regex — den eneste reelle hardkodning i
// UI'et (drejebogen `docs/features/turnering-2.md` §3.2). Rækkefølgen er:
// brugerens eget valg, hvis turneringen stadig findes → ellers den turnering
// appen startede med.
//
// `created_at` frem for navn er et bevidst valg: `leagues` kommer sorteret på
// navn, og alfabetet ville gøre "Scotland Premiership" til forvalg foran
// "Superligaen" i det øjeblik turnering #2 blev synlig. Den ældste turnering er
// den, appen blev bygget om — det er et stabilt svar, som ingen skal huske at
// vedligeholde i en kolonne.

export { FullStandingsModal, Standings };
