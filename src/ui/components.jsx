// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState, useEffect } from "react";
import { ChevronRight, ChevronLeft, ArrowUp, ArrowDown, Minus, Info, X } from "lucide-react";
import { outcome, pointsFor } from "../lib/scoring.js";
import { C, font, iconBtn, muted, pagerBtn } from "./theme.js";

const Card = ({ children, style, onClick }) => (
  <div
    onClick={onClick}
    style={{
      background: C.surface,
      border: `1px solid ${C.line}`,
      borderRadius: 14,
      padding: 16,
      cursor: onClick ? "pointer" : "default",
      ...style,
    }}
  >
    {children}
  </div>
);
const Eyebrow = ({ children }) => (
  <div style={{
    fontFamily: font.display, textTransform: "uppercase",
    letterSpacing: "0.12em", fontSize: 13, color: C.muted, marginBottom: 8,
  }}>
    {children}
  </div>
);
const H = ({ children, size = 26 }) => (
  <div style={{
    fontFamily: font.display, textTransform: "uppercase",
    fontWeight: 700, fontSize: size, lineHeight: 1.1, color: C.text,
  }}>
    {children}
  </div>
);
// Brugernavn, der åbner karriereprofilen. Ét sted for udseende, tastaturadgang og
// "(dig)"-suffikset, så et navn opfører sig ens i ranglister, medlemslister og
// gæt-lister. Uden `onOpenProfile`/`userId` renderes navnet som ren tekst — så kan
// et kald-sted fravælge klik uden at ændre layoutet.
// `stopPropagation` er nødvendig, fordi flere navne bor inde i klikbare kort.
// `truncate` bruges i stillingstabellerne, hvor kolonnen har fast bredde: en knap
// er et atomart element, så cellens eget text-overflow ville klippe uden "…" —
// knappen må derfor selv trunkere. Uden `truncate` beholder knappen sin
// tekst-baseline, så navnet flugter med teksten omkring det ("Hej Nikolaj",
// "🏆 Nikolaj (42 point)").
const PlayerName = ({ userId, name, you = false, onOpenProfile, truncate = false, style }) => {
  const label = `${name || "—"}${you ? " (dig)" : ""}`;
  if (!onOpenProfile || !userId) return <>{label}</>;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpenProfile(userId); }}
      aria-label={you ? "Din karriereprofil" : `Karriereprofil for ${name}`}
      style={{
        background: "none", border: "none", padding: 0, margin: 0,
        font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer",
        textDecoration: "underline", textDecorationColor: C.line, textUnderlineOffset: 3,
        ...(truncate
          ? { maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }
          : { verticalAlign: "baseline" }),
        ...style,
      }}
    >
      {label}
    </button>
  );
};
// Form guide dots — grønne = stærk runde, gul = middel, grå = svag
const FormDots = ({ form }) => (
  <span style={{ display: "inline-flex", gap: 3 }}>
    {(form || []).map((f, i) => (
      <span key={i} style={{
        width: 7, height: 7, borderRadius: "50%",
        background: f === 2 ? C.green : f === 1 ? C.gold : C.line,
      }} />
    ))}
  </span>
);
// LIVE-mærke: rød, pulserende prik + kort tekst (spilleminut eller "Pause").
// Bruges alle steder, hvor en kamp kan være i gang, så "live" og "færdigspillet"
// aldrig kan forveksles. Prikkens puls slås fra ved prefers-reduced-motion.
const LiveBadge = ({ text = "Live" }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
    background: "rgba(239,91,91,0.14)", color: C.red, border: `1px solid ${C.red}`,
    borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 800,
    letterSpacing: "0.06em", textTransform: "uppercase",
  }}>
    <span className="livedot" style={{ width: 6, height: 6, borderRadius: "50%", background: C.red }} />
    Live{text && text !== "Live" ? ` ${text}` : ""}
  </span>
);
// Dæmpet "Slut"-mærke, så en færdigspillet kamp er umiskendeligt forskellig fra en live kamp.
const FinalBadge = () => (
  <span style={{
    color: C.muted, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
    textTransform: "uppercase", whiteSpace: "nowrap",
  }}>Slut</span>
);
// lille point-pille: grøn +3 · blød grøn +1 · dæmpet 0 · "–" hvis intet tip.
// Nuancerne er de samme som i "Sådan virker det" → Pointsystem (HowItWorksScreen),
// så beskrivelsen og alle visninger af point taler samme farvesprog.
// Bruges både i Hjem's runde-oversigt og på Tip-skærmen.
const PointsPill = ({ pts }) => {
  if (pts == null) return <span style={{ color: C.muted, fontSize: 12 }}>–</span>;
  const col = pts >= 3 ? C.green : pts >= 1 ? C.greenSoft : C.muted;
  const bg = pts >= 3 ? "rgba(34,197,94,0.18)" : pts >= 1 ? "rgba(127,212,138,0.12)" : "transparent";
  const border = pts >= 1 ? "none" : `1px solid ${C.line}`;
  return (
    <span style={{ background: bg, color: col, border, fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "2px 8px", minWidth: 30, textAlign: "center" }}>
      {pts > 0 ? `+${pts}` : "0"}
    </span>
  );
};
const Move = ({ d }) => {
  if (d > 0) return <span style={{ color: C.green, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 2 }}><ArrowUp size={12} />{d}</span>;
  if (d < 0) return <span style={{ color: C.red, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 2 }}><ArrowDown size={12} />{Math.abs(d)}</span>;
  return <span style={{ color: C.muted, fontSize: 12 }}><Minus size={12} /></span>;
};

// ---------- generisk modal ----------
function Modal({ title, children, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, width: "100%",
        maxWidth: 420, maxHeight: "85vh", overflowY: "auto", padding: 18,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontFamily: font.display, textTransform: "uppercase", fontWeight: 700, fontSize: 18 }}>{title}</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", padding: 0 }}><X size={20} /></button>
        </div>
        <div style={{ color: C.text, fontSize: 14, lineHeight: 1.5 }}>{children}</div>
      </div>
    </div>
  );
}
// ⓘ-ikon der åbner en kontekstuel forklaring (Fase 5A)
function InfoDot({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Forklaring" style={{
        background: "none", border: "none", cursor: "pointer", color: C.muted,
        padding: 0, display: "inline-flex", alignItems: "center", verticalAlign: "middle",
      }}>
        <Info size={15} />
      </button>
      {open && <Modal title={title} onClose={() => setOpen(false)}>{children}</Modal>}
    </>
  );
}

const BackBar = ({ title, onBack, right }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
    <button onClick={onBack} aria-label="Tilbage" style={{ ...iconBtn, color: C.text }}><ChevronLeft size={22} /></button>
    <div style={{ fontFamily: font.display, textTransform: "uppercase", fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>{title}</div>
    {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
  </div>
);

function ScoreInput({ value, onChange, disabled }) {
  return (
    <input type="number" min="0" max="20" disabled={disabled}
      value={value === null || value === undefined ? "" : value}
      onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Math.min(20, Number(e.target.value))))}
      style={{
        width: 44, textAlign: "center", fontFamily: "ui-monospace, monospace", fontSize: 16, fontWeight: 700,
        background: disabled ? C.surface : C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 2px",
      }} />
  );
}

function RoundPager({ rounds, index, setIndex }) {
  if (!rounds.length) return null;
  const round = rounds[index];
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 10 }}>
      <button style={pagerBtn(index > 0)} disabled={index <= 0} onClick={() => setIndex(Math.max(0, index - 1))}><ChevronLeft size={16} /></button>
      <div style={{ color: C.text, fontWeight: 700, fontSize: 14, textAlign: "center" }}>
        Runde {round.label}
        <div style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>({index + 1} af {rounds.length})</div>
      </div>
      <button style={pagerBtn(index < rounds.length - 1)} disabled={index >= rounds.length - 1} onClick={() => setIndex(Math.min(rounds.length - 1, index + 1))}><ChevronRight size={16} /></button>
    </div>
  );
}

// Kolonner i forudsigelses-overlayet: holdnavnet er den eneste elastiske
// kolonne, resten er faste og smalle nok til, at rækken passer på en 320 px
// telefon (fast 38+38+36 + 3×6 gap = 130 px, resten til navnet).
const predCols = { display: "grid", gridTemplateColumns: "1fr 38px 38px 36px", gap: 6, alignItems: "center" };
const predLabel = {
  color: C.muted, fontSize: 10, fontFamily: font.display, textTransform: "uppercase",
  letterSpacing: "0.06em", textAlign: "center",
};

// én brugers forudsigelser pr. LÅST runde (kalderen filtrerer til låste kampe)
function UserRoundPredictions({ playerName, userId, lockedRounds, predsByKey, rules, initialKey, onClose, onOpenProfile }) {
  const startIdx = (() => {
    if (initialKey) { const i = lockedRounds.findIndex((r) => r.key === initialKey); if (i >= 0) return i; }
    return lockedRounds.length - 1;
  })();
  const [idx, setIdx] = useState(startIdx);
  const round = lockedRounds[idx];
  const canPrev = idx > 0;
  const canNext = idx < lockedRounds.length - 1;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && canPrev) setIdx((v) => v - 1);
      else if (e.key === "ArrowRight" && canNext) setIdx((v) => v + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canPrev, canNext, onClose]);

  if (!round) return null;
  // Kalderen leverer kun LÅSTE kampe: fra låsen kan ingen rette sit gæt, så
  // gættet må vises, uanset om kampen er spillet endnu. En låst, endnu ikke
  // spillet kamp viser derfor gættet med "–" som facit og ingen point.
  let roundTotal = 0;

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      {/* maxWidth følger appens telefonramme (theme.phone = 430), og overflowX
          er låst: intet i overlayet må kunne fremtvinge vandret scroll. */}
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, width: "100%",
        maxWidth: 430, maxHeight: "85vh", overflowY: "auto", overflowX: "hidden", padding: 18,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 12, letterSpacing: 1, color: C.muted, fontFamily: font.display }}>FORUDSIGELSER</span>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", padding: 0 }}><X size={20} /></button>
        </div>
        <div style={{ fontFamily: font.display, textTransform: "uppercase", fontWeight: 700, fontSize: 22 }}>
          {/* Navnet er også herfra vejen til karrieren — overlayet lukkes først,
              ellers ville profilen ligge bag den mørke baggrund. */}
          <PlayerName userId={userId} name={playerName} truncate
            onOpenProfile={onOpenProfile ? (uid) => { onClose(); onOpenProfile(uid); } : undefined} />
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "10px 0 14px" }}>
          <button disabled={!canPrev} onClick={() => setIdx((v) => v - 1)} style={pagerBtn(canPrev)}><ChevronLeft size={16} /></button>
          <span style={{ color: C.text, fontSize: 13, fontWeight: 700, textAlign: "center" }}>Runde {round.label}</span>
          <button disabled={!canNext} onClick={() => setIdx((v) => v + 1)} style={pagerBtn(canNext)}><ChevronRight size={16} /></button>
        </div>

        {/* Fælles kolonner for både labels og rækker, så tallene flugter. Ordet
            "facit" stod før inde i hver række og kostede ~38 px af en bredde,
            der ikke var til overs på en smal telefon — nu står det som label
            ét sted. Holdnavnet er den eneste elastiske kolonne (minWidth 0 +
            ellipsis), så rækken kan klemmes ned uden at flyde ud i bredden. */}
        <div style={{ ...predCols, padding: "0 10px", marginBottom: 4 }}>
          <span />
          <span style={predLabel}>Gæt</span>
          <span style={predLabel}>Facit</span>
          <span style={predLabel}>Point</span>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          {round.matches.map((m) => {
            const pred = predsByKey.get(`${m.id}:${userId}`);
            const pts = pointsFor(pred, m, rules);
            if (pts !== null) roundTotal += pts;
            const has = pred && pred.pred_home !== null && pred.pred_home !== undefined;
            const played = m.home_score !== null && m.home_score !== undefined;
            const ptColor = pts === (rules?.exact ?? 3) ? C.green : pts === (rules?.outcome ?? 1) ? C.greenSoft : C.muted;
            return (
              <div key={m.id} style={{ ...predCols, background: C.surface2, borderRadius: 8, padding: "8px 10px" }}>
                <span style={{ color: C.muted, fontSize: 12, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m._home || m.home_team_id} – {m._away || m.away_team_id}
                </span>
                <span style={{ color: C.text, fontSize: 13, fontWeight: 700, textAlign: "center" }}>
                  {has ? `${pred.pred_home}-${pred.pred_away}` : "–"}
                </span>
                <span style={{ color: played ? C.text : C.muted, fontSize: 13, fontWeight: 700, textAlign: "center" }}>
                  {played ? `${m.home_score}-${m.away_score}` : "–"}
                </span>
                <span style={{ background: C.surface, color: ptColor, fontSize: 12, fontWeight: 700, textAlign: "center", borderRadius: 999, padding: "2px 4px" }}>
                  {/* Samme regel som PointsPill: 0 er ikke "+0". Ingen tip = "–". */}
                  {pts === null ? "–" : pts > 0 ? `+${pts}` : "0"}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
          <span style={{ color: C.muted, fontSize: 13 }}>Rundens total</span>
          <span style={{ color: C.gold, fontWeight: 800, fontSize: 16 }}>{roundTotal} point</span>
        </div>
      </div>
    </div>
  );
}

export { Card, Eyebrow, H, PlayerName, FormDots, Move, Modal, InfoDot, BackBar, ScoreInput, RoundPager, UserRoundPredictions, LiveBadge, FinalBadge, PointsPill };
