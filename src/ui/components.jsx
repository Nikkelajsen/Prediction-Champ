// Delkomponenter, der bruges på tværs af skærmene: kort, overskrifter,
// spillernavne, dialoger, tal-felter og de små signal-visninger til Analytics
// og Drift. Alt her er rent visuelt — ingen komponent henter data selv.
import { useState, useEffect, useRef, useId } from "react";
import { ChevronRight, ChevronLeft, ChevronDown, ArrowUp, ArrowDown, Minus, Info, X, Copy, Check } from "lucide-react";
import { POINTS, pointsFor } from "../lib/scoring.js";
import { C, btnGhost, btnGreen, font, iconBtn, muted, pagerBtn } from "./theme.js";

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
// Dialogen er en RIGTIG dialog (G22, august 2026): `role="dialog"`,
// `aria-modal` og et navn, der peger på overskriften. Uden dem er den for en
// skærmlæser bare mere indhold på siden — og da baggrunden ikke er skjult,
// ville brugeren kunne "læse videre" ned i en skærm, der visuelt er dækket.
//
// Fokus flyttes ind ved åbning og TILBAGE ved lukning. Det sidste er det, man
// mærker: uden det står fokus på `<body>` efter en lukket dialog, og næste tryk
// på Tab starter forfra øverst på siden — langt fra den knap, man lige brugte.
//
// Der er bevidst INGEN fuld fokusfælde. En sådan kræver, at man selv holder styr
// på alle fokusérbare elementer og fanger Tab i begge retninger; dialogerne her
// er små (en bekræftelse, en tabel), Escape og klik uden for virker begge, og en
// halvfærdig fælde er værre end ingen — den kan spærre en bruger inde.
function Modal({ title, children, onClose }) {
  const kortRef = useRef(null);
  const overskriftId = useId();
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const foer = document.activeElement;
    kortRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      // Kun hvis elementet stadig findes: skærmen bagved kan være skiftet ud,
      // mens dialogen var åben, og et `focus()` på et fjernet element kaster.
      if (foer instanceof HTMLElement && document.contains(foer)) foer.focus();
    };
  }, [onClose]);
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div role="dialog" aria-modal="true" aria-labelledby={overskriftId}
        ref={kortRef} tabIndex={-1}
        onClick={(e) => e.stopPropagation()} style={{
        background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, width: "100%",
        maxWidth: 420, maxHeight: "85vh", overflowY: "auto", padding: 18,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div id={overskriftId} style={{ fontFamily: font.display, textTransform: "uppercase", fontWeight: 700, fontSize: 18 }}>{title}</div>
          <button type="button" aria-label="Luk" onClick={onClose} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", padding: 0 }}><X size={20} /></button>
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

// "Du er ikke med i en konkurrence endnu" — ét sted.
//
// Tip-skærmen og stillingen havde hver sin blindgyde: sætningen "Opret eller
// deltag i en konkurrence først." uden en eneste knap. Brugeren fik at vide, at
// de manglede noget, men ikke hvor de skulle hen. Nu forklarer den, hvad en
// konkurrence ER, og peger på begge veje ind.
const EmptyCompetitions = ({ onCreate, onJoin }) => (
  <Card style={{ borderStyle: "dashed", background: "transparent" }}>
    <div style={{ fontFamily: font.display, fontSize: 18, fontWeight: 700, textTransform: "uppercase" }}>
      Ingen konkurrence endnu
    </div>
    <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.5, marginTop: 4 }}>
      En konkurrence er det, du og din liga dyster i — fx en hel Superliga-sæson
      eller bare næste weekend. Du skal være med i én for at kunne tippe.
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
      {onCreate && <button style={{ ...btnGreen, width: "auto", padding: "8px 14px" }} onClick={onCreate}>Opret konkurrence</button>}
      {onJoin && <button style={btnGhost} onClick={onJoin}>Deltag med kode</button>}
    </div>
  </Card>
);

// Invitationskoden i klartekst, ved siden af "Invitér"-knappen.
//
// Delingen har altid været et LINK, og linket er stadig den nemme vej: det
// åbner appen og bekræftelses-modalen i ét tryk. Men koden selv stod ingen
// steder i appen — mens "Deltag med kode"-feltet på Ligaer-fanen hele tiden
// har taget imod netop den rå kode. Man kunne altså joine med en kode, man
// ikke kunne få fat i, med mindre man selv klippede den ud af et link. Det er
// den anden halvdel af invitationen, ikke en ny måde at invitere på: koden kan
// læses op i telefonen, skrives på en tavle eller sendes et sted hen, hvor et
// link ikke overlever.
//
// Koden vises PRÆCIS som den står i databasen (små bogstaver, otte hex-tegn) —
// opslaget er `eq.`, og et pænere versal-format ville producere en kode, der
// ikke kunne bruges.
function InviteCode({ code, label = "Kode" }) {
  const [copied, setCopied] = useState(false);
  if (!code) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* udklipsholderen kan være spærret — koden står der stadig */ }
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.muted, fontSize: 12 }}>
      <span>{label}</span>
      <span style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13.5,
        letterSpacing: "0.08em", color: C.text, userSelect: "all",
        background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8, padding: "3px 8px",
      }}>{code}</span>
      <button type="button" onClick={copy} aria-label="Kopiér invitationskoden"
        style={{ ...iconBtn, gap: 4, fontSize: 12, color: copied ? C.green : C.muted }}>
        {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Kopieret!" : "Kopiér"}
      </button>
    </div>
  );
}

const BackBar = ({ title, onBack, right }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
    <button onClick={onBack} aria-label="Tilbage" style={{ ...iconBtn, color: C.text }}><ChevronLeft size={22} /></button>
    <div style={{ fontFamily: font.display, textTransform: "uppercase", fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>{title}</div>
    {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
  </div>
);

// Ingen `disabled`-tilstand: en kamp, der ikke må tippes, får slet ikke felter
// (rækken skifter form ved lås). Prop'en fandtes kun til det rullende
// gætte-vindue og røg med det (B1).
//
// `label` er PÅKRÆVET (G22, august 2026). Dette er appens mest brugte kontrol —
// at taste et resultat ER kernehandlingen — og den var en bar `<input
// type="number">` uden navn: en skærmlæser sagde "redigeringsfelt, tal" om
// begge felter i en kamp, uden at kunne skelne hjemme fra ude. Etiketten er
// skjult, fordi rækken er tæt og navnene står lige ved siden af for den, der
// kan se; men den findes, og uden den kan tippet ikke afgives på gehør.
//
// Argumentet er en tekst frem for et `aria-label` direkte, så kaldstedet ikke
// kan slippe af sted med at udelade det uden at det ses i diff'en.
function ScoreInput({ value, onChange, label }) {
  return (
    <input type="number" min="0" max="20" aria-label={label}
      value={value === null || value === undefined ? "" : value}
      onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Math.min(20, Number(e.target.value))))}
      style={{
        width: 44, textAlign: "center", fontFamily: "ui-monospace, monospace", fontSize: 16, fontWeight: 700,
        background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 2px",
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
function UserRoundPredictions({ playerName, userId, lockedRounds, predsByKey, initialKey, onClose, onOpenProfile }) {
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
            const pts = pointsFor(pred, m);
            if (pts !== null) roundTotal += pts;
            const has = pred && pred.pred_home !== null && pred.pred_home !== undefined;
            const played = m.home_score !== null && m.home_score !== undefined;
            const ptColor = pts === POINTS.exact ? C.green : pts === POINTS.outcome ? C.greenSoft : C.muted;
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

// ---------- Statistik-byggeklodser (delt af AdminScreen og AnalyticsPanel) ----------
// Flyttet hertil fra AdminScreen.jsx (analytics v1) — nu to forbrugere, samme
// grænse som resten af denne fils komponenter allerede lever efter.

// Et enkelt nøgletal ("stat tile"). `info` er en valgfri ⓘ ved siden af
// etiketten — se måle-ordbogen i src/lib/analyticsMetrics.js. Etiketten og
// hint'et skal fortsat kunne læses ALENE: ⓘ'en uddyber, den bærer aldrig det,
// der skal til for at forstå tallet.
// ---------- fold ----------
// Ét sted for det, der folder ud (G57, august 2026).
//
// Mønstret var håndrullet fem steder — HjemTab, LigaerTab, MatchRow,
// LigaDiagnoseSection og HowItWorksScreen — med hver sin blanding: to brugte en
// rigtig `<button>`, én en `div role="button"` med sin egen `onKeyDown`, og én
// en `<tr onClick>` uden hverken tastaturadgang eller aria overhovedet. Chevronen
// pegede tre forskellige veje. Ingen af delene var et VALG; de var fem
// uafhængige gæt på det samme.
//
// Det, der samles her, er semantikken: en rigtig knap, `aria-expanded`, en
// etiket der siger både handlingen og hvad den handler om, og et panel der
// slet ikke renderes, når det er lukket (husets konvention — indhold, der
// læser `navigator` eller regner på tid, må ikke køre i en lukket fold).
//
// PLACERINGEN af chevronen er derimod layout og bliver hos kalderen: HjemTabs
// kort har en to-linjers header, hvor pilen hører til på den første linje ved
// tælleren. Derfor kan `chevron` slås fra og `FoldChevron` sættes ind i
// headeren i stedet — stadig den samme pil med den samme rotation.
function FoldChevron({ open, size = 14, color = C.muted }) {
  return (
    <ChevronDown size={size} style={{
      flexShrink: 0, color,
      transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s",
    }} />
  );
}

function Collapsible({
  open, onToggle, label, header, children,
  chevron = true, chevronSize = 14, chevronColor = C.muted,
  grow = true, className = "tiprow", style,
}) {
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${open ? "Skjul" : "Vis"} ${label}`}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          width: "100%", background: "none", border: "none", padding: 0,
          color: C.text, textAlign: "left", cursor: "pointer", font: "inherit",
          ...style,
        }}
      >
        {/* `grow` styrer, om headeren fylder resten af bredden og skubber
           chevronen helt ud til kanten (et kort), eller lige netop sig selv, så
           pilen står klos op ad teksten (en lille linkagtig knap). */}
        <span style={{ minWidth: 0, flex: grow ? 1 : "0 1 auto" }}>{header}</span>
        {chevron && <FoldChevron open={open} size={chevronSize} color={chevronColor} />}
      </button>
      {open && children}
    </>
  );
}

function StatTile({ label, value, hint, info }) {
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontFamily: font.display, fontWeight: 700, fontSize: 28, lineHeight: 1.05, color: C.text }}>{value}</div>
      <div style={{ color: C.muted, fontSize: 12, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
        <span>{label}</span>{info}
      </div>
      {hint && <div style={{ color: C.muted, fontSize: 11, marginTop: 4, opacity: 0.8 }}>{hint}</div>}
    </div>
  );
}

// Overskrift for en gruppe af nøgletal.
function StatGroup({ title, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontFamily: font.display, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 13, color: C.muted }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{children}</div>
    </div>
  );
}

// Enkelt-serie søjlediagram (magnitude over tid). Tynde søjler med afrundet top,
// 2px mellemrum, diskret baseline. Ingen legend — titlen navngiver serien.
// Hover viser etikette + værdi via native title. Farve = én temafarve.
//
// `value: null` betyder INGEN MÅLING (fx en uge helt uden låste runder) og
// tegnes som en gråtonet stump med "–" — aldrig som en nulsøjle, der ikke kan
// skelnes fra et ægte nul. Samme regel som PctGrid følger for retention.
// `suffix` sættes, når enheden ikke er et antal (fx "%").
function MiniBars({ data, color, formatLabel, suffix = "" }) {
  if (!data || !data.length) return <p style={{ ...muted, margin: 0 }}>Ingen data endnu.</p>;
  const max = Math.max(1, ...data.map((d) => (d.value === null || d.value === undefined ? 0 : d.value)));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 96, borderBottom: `1px solid ${C.line}`, paddingBottom: 0 }}>
      {data.map((d, i) => {
        const missing = d.value === null || d.value === undefined;
        return (
          <div key={i} title={missing ? `${formatLabel(d.key)}: ingen data` : `${formatLabel(d.key)}: ${d.value}${suffix}`}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", minWidth: 0 }}>
            <span style={{ color: C.muted, fontSize: 9, lineHeight: 1, marginBottom: 2, opacity: missing ? 0.5 : 1 }}>
              {missing ? "–" : (d.value || "")}
            </span>
            <div style={{
              width: "100%",
              height: missing ? "2px" : `${Math.max(d.value > 0 ? 3 : 0, (d.value / max) * 74)}px`,
              background: missing ? C.line : color,
              borderRadius: "4px 4px 0 0",
            }} />
          </div>
        );
      })}
    </div>
  );
}

// Liga-diagnosens tilstands-mærkat. Afløser HealthBar (juli 2026), som tegnede
// en 0-100-bjælke for en sammenvejet score, der er fjernet — se begrundelsen i
// diagnoseLeague() i src/lib/analytics.js.
//
// ORDET er signalet; farven er kun ekstra (samme regel som ModeBars følger for
// farveblindhed — identitet må aldrig bæres af farve alene). En tilstand uden
// tone ("For ny", "Intet at måle på") får bevidst ingen farve i stedet for en
// neutral grøn, så "vi ved det ikke" ikke kan forveksles med "det er fint".
function StateChip({ label, tone }) {
  const color = tone === "green" ? C.green : tone === "gold" ? C.gold : tone === "red" ? C.red : C.muted;
  return (
    <span style={{
      display: "inline-block", padding: "3px 9px", borderRadius: 999,
      border: `1px solid ${color}`, color,
      // Ingen fyldfarve, uanset tone (G37). Her stod `tone ? "transparent" :
      // "transparent"` — en ternær med samme svar i begge grene, altså enten en
      // halvfærdig visuel tilstand eller en rest. Valget er truffet: ORDET er
      // signalet, farven er kun ekstra (samme regel som OpsPanels TONE-tabel),
      // og en svag fyldfarve bag et ord, der allerede er farvet, ville sløre
      // netop den skelnen. Skal en tone en dag give fyld, er det en beslutning
      // og ikke en genopdagelse.
      background: "transparent",
      fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
      whiteSpace: "nowrap",
    }}>{label}</span>
  );
}

// Ét målt signal i liga-drill-in'en: navn (med ⓘ fra måle-ordbogen), værdi og
// en kort under-linje med rå-tallene bag procenten.
function SignalRow({ label, value, detail, info }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "5px 0" }}>
      <span style={{ color: C.muted, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>{label}{info}</span>
      <span style={{ textAlign: "right" }}>
        <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{value}</span>
        {detail && <span style={{ color: C.muted, fontSize: 11, marginLeft: 6 }}>{detail}</span>}
      </span>
    </div>
  );
}

// Retention-kohortematrix: rækker × kolonner af procent-celler. En celle uden
// målbart data (fx uge 52 før der findes et års aktivitetshistorik) er
// `disabled` og viser "–" med en title, der forklarer hvorfor — ALDRIG et
// falsk 0%, som ellers ikke kan skelnes fra ægte nul-retention.
function PctGrid({ columns, rows }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", color: C.muted, fontWeight: 600 }}></th>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: "right", color: C.muted, fontWeight: 600, padding: "4px 6px" }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="rowline">
              <td style={{ color: C.muted, padding: "4px 6px" }}>{r.label}</td>
              {columns.map((c) => {
                const cell = r.cells[c.key];
                const disabled = !cell || cell.disabled;
                return (
                  <td key={c.key} title={disabled ? (cell?.reason || "Ingen data") : undefined}
                    style={{ textAlign: "right", padding: "4px 6px", color: disabled ? C.muted : C.text, opacity: disabled ? 0.5 : 1 }}>
                    {disabled ? "–" : `${cell.pct}%`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { Card, Collapsible, FoldChevron, Eyebrow, H, PlayerName, FormDots, Move, Modal, InfoDot, InviteCode, BackBar, ScoreInput, RoundPager, UserRoundPredictions, LiveBadge, FinalBadge, PointsPill, EmptyCompetitions, StatTile, StatGroup, MiniBars, StateChip, SignalRow, PctGrid };
