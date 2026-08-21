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
        <th style={{ ...thStyle, textAlign: "center", padding: "8px 2px" }} title="Leagly Rating">Rating</th>
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

// Sidestørrelsen står ét sted, fordi den bruges to: den skærer listen op, OG
// den navngiver genvejsknappen ("Top 20"). Var tallet skrevet to gange, kunne
// knappen love noget andet, end side 1 viser.
const PER_PAGE = 20;

// Hvilken side står brugeren selv på? `null`, hvis hun ikke er i stillingen.
//
// 🔴 INDEKSET AFGØR SIDEN — IKKE `rank`. De to er ikke det samme tal:
// `assignRanks` (src/lib/standings.js) giver ægte lige spillere den SAMME
// placering, så tre delte 1.-pladser efterfølges af nr. 4 med indeks 3. Regnede
// vi siden ud af `rank`, ville en stilling med meget lighed — netop den, hvor
// listen er lang og genvejen betyder mest — lande en side ved siden af.
//
// `null` og ikke 0: "hun står ikke i stillingen" er et andet svar end "hun står
// på første side", og modalen skal kunne skelne dem. En bruger uden point i
// måneden har ingen række, og så er der ingen egen placering at hoppe til.
export function pageOfUser(rows, userId, perPage = PER_PAGE) {
  const i = rows.findIndex((r) => r.userId === userId);
  return i < 0 ? null : Math.floor(i / perPage);
}

// Fuld stilling i modal med paginering (maks. 20 pr. side).
//
// MODALEN ÅBNER, HVOR MAN SELV STÅR (21. august 2026). Kortet viser top 5, så
// er man nr. 25, var modalen den eneste vej til sin egen række — og den startede
// på side 1, hvorefter man skulle bladre sig frem i blinde. Startsiden er nu
// ens egen, og de to genveje ovenover fører den anden vej: "Top 20" til
// stillingens top, "Min placering" tilbage til en selv.
function FullStandingsModal({ title, rows, userId, isComplete, ratingMap, onClose, openProfile }) {
  const minSide = pageOfUser(rows, userId);
  // Startværdien er nok, og der er hverken en effekt eller en synkronisering:
  // modalen monteres ved hver åbning (`{full && <FullStandingsModal …>}` i
  // ChampionshipTab), så den kender sin egen bruger fra første render.
  const [page, setPage] = useState(minSide ?? 0);
  const perPage = PER_PAGE;
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const start = page * perPage;
  const slice = rows.slice(start, start + perPage);
  return (
    <Modal title={title} onClose={onClose}>
      {/* Genvejene står ØVERST og ikke nede ved bladre-knapperne: åbner modalen
          på side 2, ville en genvej under tabellen ligge tyve rækker nede — man
          skulle scrolle for at komme til toppen. Knapperne DISABLES frem for at
          forsvinde (samme mønster som pageren nedenfor og `RoundPager`), så
          rækken ikke skifter højde, mens man bladrer. */}
      {pages > 1 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button type="button" aria-label={`Gå til top ${perPage}`}
            style={{ ...pagerBtn(page > 0), fontSize: 13 }} disabled={page <= 0}
            onClick={() => setPage(0)}>Top {perPage}</button>
          {/* Kun når der ER en egen placering at hoppe til. En knap, der aldrig
              kan gøre noget, er ikke en deaktiveret knap — den er støj. */}
          {minSide !== null && (
            <button type="button" aria-label="Gå til din egen placering"
              style={{ ...pagerBtn(page !== minSide), fontSize: 13 }} disabled={page === minSide}
              onClick={() => setPage(minSide)}>Min placering</button>
          )}
        </div>
      )}
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
