// Én kamps række i tip-skærmen — både den låste visning og den åbne med
// score-input — plus holdnavnenes elastiske typografi og de delte kolonnebredder.
import { useLayoutEffect, useRef } from "react";
import { Check, ChevronUp, ChevronRight } from "lucide-react";
import { pointsFor, stageBadgeLabel } from "../../lib/scoring.js";
import { C, font } from "../../ui/theme.js";
import { FinalBadge, PlayerName, PointsPill, ScoreInput } from "../../ui/components.jsx";
import { hhmm } from "./time.js";

const scoreChip = (extra) => ({
  fontSize: 14, fontWeight: 700, padding: "4px 9px", borderRadius: 8,
  whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace", ...extra,
});

// ---------- den låste rækkes kolonner ----------
// Tid/status · holdnavn (elastisk) · gæt · facit · point · chevron. Bredderne er
// målt til det, tallene faktisk fylder — hvert sparet pixel går til holdnavnet,
// som er det eneste, der kan blive for langt. Overskrifterne (GÆT/FACIT/P) står
// én gang øverst i runden, så de tre tal ikke længere skal gættes fra hukommelsen.
const ROW_COLS = "36px minmax(0,1fr) 25px 38px 26px 14px";
const ROW_GAP = 4;
const rowGrid = {
  display: "grid", gridTemplateColumns: ROW_COLS, gap: ROW_GAP,
  alignItems: "center", minHeight: 42, width: "calc(100% + 12px)",
  padding: "8px 6px", margin: "0 -6px", borderRadius: 8, textAlign: "left",
};
const cellCenter = { textAlign: "center", fontSize: 13, fontFamily: "ui-monospace, monospace" };

// Holdnavnene sættes i appens condensed display-skrift: den fylder ~25 % mindre end
// brødskriften, hvilket er præcis det, der får kampen til at rummes på ÉN linje.
// Passer navnet alligevel ikke, falder skriften ét trin ad gangen — og først når
// trinene er brugt op, ombrydes der. Der trunkeres aldrig: et afkortet holdnavn er
// skjult information (samme regel som før kompakteringen).
const NAME_STEPS = [15, 13.5, 12.5];
function TeamNames({ home, away }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.whiteSpace = "nowrap";
      let i = 0;
      for (; i < NAME_STEPS.length; i++) {
        el.style.fontSize = `${NAME_STEPS[i]}px`;
        if (el.scrollWidth <= el.clientWidth + 0.5) break;
      }
      el.style.whiteSpace = i < NAME_STEPS.length ? "nowrap" : "normal";
    };
    fit();
    // Kun bredde-ændringer må udløse en ny måling: fit() ændrer selv højden, så et
    // ubetinget kald her ville løbe i ring.
    let lastW = -1;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w === lastW) return;
      lastW = w;
      fit();
    });
    ro.observe(el);
    // Skriften hentes asynkront; uden dette måles fallback-skriftens bredde, som er
    // bredere — så en række ville ombryde unødigt indtil næste render.
    if (document.fonts?.ready) document.fonts.ready.then(fit).catch(() => {});
    return () => ro.disconnect();
  });
  return (
    <span ref={ref} style={{
      fontFamily: font.display, fontWeight: 600, color: C.text,
      // Marginen (ikke padding) gør selve boksen smallere, så måleren ovenfor regner
      // luften med og navnet aldrig lander klods op ad gæt-tallet.
      minWidth: 0, overflow: "hidden", lineHeight: 1.2, marginRight: 4,
    }}>
      {home} – {away}
    </span>
  );
}

// Én kamp på to linjer (én, hvis der intet mærke er at vise): klokkeslæt + hold til
// venstre, tip-felter og resultat til højre. Ligger bevidst på MODUL-niveau: defineret
// inde i PredictionsScreen ville komponenten få ny type ved hver render, så React
// unmountede rækken hvert minut (live-tikket) og et fokuseret scorefelt mistede fokus
// midt i indtastningen.
function MatchRow({
  m, pred, rules, homeName, awayName, locked, played, live, notOpenUntil, openLabel,
  showFinal, saved, err, onSave, expanded, onToggleExpanded, participants, matchPreds, userId, last, openProfile,
}) {
  const hasPred = pred.pred_home !== null && pred.pred_away !== null;
  const pts = played ? pointsFor(pred, m, rules) : null;
  const exact = played && hasPred && pred.pred_home === m.home_score && pred.pred_away === m.away_score;
  const correctOutcome = played && pts !== null && pts > 0;
  const stage = stageBadgeLabel(m.stage_name);
  const canExpand = locked && participants.length > 1;
  // Anden linje vises nu kun til det, der IKKE kan bo i en kolonne: stage-mærket,
  // "Åbner …" (kun når runden er delvist lukket af det rullende vindue) og slettefejl.
  // "Slut", "Live" og "Alles gæt" er flyttet ind i rækken selv. Rækken bærer INGEN
  // nedtælling: efter A21 er lås = kickoff − 1 time, og tid-kolonnen viser allerede
  // kickoff, så deadlinen er aflæselig af det, der står i forvejen.
  const hasMeta = !!(stage || openLabel || err);

  // Tid/status-kolonnen bærer kampens tilstand: en færdigspillet kamps kickoff er
  // lav værdi, når facit står i samme række, og et spilleminut er lige så tydeligt
  // her som i en badge på en linje for sig.
  const status = played && showFinal ? <FinalBadge />
    : live && live.label === "Pause" ? <span style={{ color: C.red, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>Pause</span>
    : live ? (
      <span style={{ color: C.red, fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3, whiteSpace: "nowrap" }}>
        <span className="livedot" style={{ width: 6, height: 6, borderRadius: "50%", background: C.red, flexShrink: 0 }} />
        {live.label}
      </span>
    ) : <span style={{ color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>{played ? "" : hhmm(m.kickoff_at) || "–"}</span>;

  // Den låste række: seks kolonner, én linje. Hele rækken er tryk-fladen for
  // "alles gæt" — en låst række har ingen indtastningsfelter at komme i vejen for,
  // og et 14 px chevron ville være alt for lille et mål for en finger (jf. den
  // samme fejl i stillingens drill-in). Chevronet er kun det synlige tegn.
  const lockedCells = (
    <>
      {status}
      <TeamNames home={homeName} away={awayName} />
      <span style={{ ...cellCenter, color: C.muted }}>{hasPred ? `${pred.pred_home}-${pred.pred_away}` : "–"}</span>
      <span style={{ textAlign: "center" }}>
        {played ? (
          // Facit følger samme nuance som pointpillen (og "Sådan virker det"):
          // præcist hit = fuld grøn + guldkant, korrekt udfald = blød grøn,
          // forkert = rød. Så har hele rækken ÉN farve, der siger hvor godt det gik.
          <span style={scoreChip({
            fontSize: 13, padding: "3px 5px",
            background: !hasPred ? C.surface2 : exact ? "rgba(34,197,94,0.18)" : correctOutcome ? "rgba(127,212,138,0.12)" : "rgba(239,91,91,0.18)",
            color: !hasPred ? C.muted : exact ? C.green : correctOutcome ? C.greenSoft : C.red,
            border: exact ? `2px solid ${C.gold}` : "1px solid transparent",
          })}>{m.home_score}-{m.away_score}</span>
        ) : live ? (
          // Live: nuværende stilling i neutral (rød-kantet) ramme — bevidst UDEN
          // point/farvekodning, for point afgøres først ved slutfløjt.
          <span style={scoreChip({
            fontSize: 13, padding: "3px 5px",
            background: "rgba(239,91,91,0.10)", color: C.text, border: `1px solid ${C.red}`,
          })}>{live.homeScore}-{live.awayScore}</span>
        ) : null}
      </span>
      <span style={{ textAlign: "center" }}>{played && hasPred && <PointsPill pts={pts} />}</span>
      <span style={{ color: C.gold, display: "inline-flex", justifyContent: "flex-end" }}>
        {canExpand && (expanded ? <ChevronUp size={14} /> : <ChevronRight size={14} />)}
      </span>
    </>
  );

  return (
    <div style={{ borderBottom: last ? "none" : `1px solid ${C.line}` }}>
      {locked ? (
        canExpand ? (
          <button type="button" className="tiprow" onClick={onToggleExpanded} aria-expanded={expanded}
            aria-label={expanded ? "Skjul alles gæt" : `Vis alles gæt for ${homeName} mod ${awayName}`}
            style={{ ...rowGrid, background: "none", border: "none", cursor: "pointer", fontFamily: font.body, color: C.text }}>
            {lockedCells}
          </button>
        ) : (
          <div style={rowGrid}>{lockedCells}</div>
        )
      ) : (
        /* Åben runde: rækken skal rumme to indtastningsfelter, så den beholder sin
           flex-form. Kolonne-hovedet vises kun for låste runder, hvor der er noget
           at stille op i kolonner. */
        <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40, padding: "7px 0" }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>{hhmm(m.kickoff_at) || "–"}</span>
            {/* Ombryder frem for at trunkere: et afkortet holdnavn er skjult information. */}
            <span style={{ color: C.text, fontWeight: 600, fontSize: 14, lineHeight: 1.25, minWidth: 0 }}>
              {homeName} – {awayName}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <ScoreInput value={pred.pred_home} onChange={(v) => onSave(m.id, "pred_home", v)} disabled={!!notOpenUntil} />
            <span style={{ color: C.muted, fontSize: 12 }}>-</span>
            <ScoreInput value={pred.pred_away} onChange={(v) => onSave(m.id, "pred_away", v)} disabled={!!notOpenUntil} />
            {/* Fast slot, så felterne ikke hopper når ✓ kommer og går. */}
            <span style={{ width: 16, display: "inline-flex", justifyContent: "center" }}>
              {saved && <Check size={15} style={{ color: C.green }} />}
            </span>
          </div>
        </div>
      )}

      {/* Linje 2: kun det, der ikke kan bo i en kolonne. Renderes derfor sjældent. */}
      {hasMeta && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
          {stage && (
            <span style={{ background: C.surface2, color: C.gold, fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 999, whiteSpace: "nowrap" }}>
              {stage}
            </span>
          )}
          {/* Kun ved flere lås-grupper i samme runde (flere turneringer): så gælder
              rundehovedets tid ikke alle kampe, og rækken må selv sige det. */}
          {openLabel && <span style={{ color: C.muted, fontSize: 11 }}>{openLabel}</span>}
          {err && <span style={{ fontSize: 11, color: C.red }}>Kunne ikke slette</span>}
        </div>
      )}

      {expanded && (
        <div style={{ margin: "2px 0 8px", padding: "8px 10px", background: C.surface2, borderRadius: 10 }}>
          {participants.map((p) => {
            const pp = matchPreds.find((x) => x.user_id === p.id);
            const ppts = played && pp ? pointsFor(pp, m, rules) : null;
            return (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", fontSize: 12 }}>
                <span style={{ color: p.id === userId ? C.gold : C.text, fontWeight: p.id === userId ? 700 : 400, flex: 1, minWidth: 0 }}>
                  <PlayerName userId={p.id} name={p.display_name} onOpenProfile={openProfile} truncate />
                </span>
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ color: C.text, fontFamily: "ui-monospace, monospace" }}>{pp ? `${pp.pred_home}-${pp.pred_away}` : "–"}</span>
                  {ppts !== null && <PointsPill pts={ppts} />}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { MatchRow, TeamNames, ROW_COLS, ROW_GAP, rowGrid, cellCenter, scoreChip, NAME_STEPS };
