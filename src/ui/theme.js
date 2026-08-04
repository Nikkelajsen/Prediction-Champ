// Designtokens og de delte styles: farver, skrifttyper, knapper, felter og den
// globale CSS. Ét sted, så en farve eller en knapform ikke findes i to udgaver.
const C = {
  bg: "#0C1622",
  surface: "#14212F",
  surface2: "#1B2C3E",
  line: "#24374C",
  text: "#EDF3F8",
  muted: "#8CA0B3",
  green: "#22C55E",
  // Blød grøn = +1 / korrekt udfald. Grøn familie, men tydeligt adskilt fra det
  // præcise hit (C.green), så nuancen alene fortæller hvor godt gættet var.
  greenSoft: "#7fd48a",
  // Logoets guld (public/leagly-icon-512.png). Var #F0B429 indtil navneskiftet
  // til Leagly — pokalen i ikonet og guldet i appen skal være samme farve, ellers
  // ses forskellen som en fejl, når de står ved siden af hinanden i headeren.
  gold: "#F2C14E",
  red: "#EF5B5B",
};
const font = {
  display: "'Barlow Condensed', sans-serif",
  // Ingen 'Inter' i kæden: den blev aldrig hentet nogen steder, så den
  // lovede en skrift, ingen bruger fik. Fallbacken er systemets egen.
  body: "'Barlow', sans-serif",
};

// ---------- fælles knap-styles (nyt tema) ----------
const btnGreen = {
  width: "100%", padding: "10px 0", borderRadius: 10, border: "none",
  background: C.green, color: "#06110A", fontWeight: 700, fontSize: 15, fontFamily: font.body, cursor: "pointer",
};
const btnGhost = {
  display: "inline-flex", alignItems: "center", gap: 6, background: C.surface2,
  border: `1px solid ${C.line}`, color: C.text, borderRadius: 10,
  padding: "8px 12px", fontSize: 13, fontFamily: font.body, cursor: "pointer",
};
const btnGold = {
  display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(240,180,41,0.12)",
  border: `1px solid ${C.gold}`, color: C.gold, borderRadius: 10,
  padding: "8px 12px", fontSize: 13, fontWeight: 700, fontFamily: font.body, cursor: "pointer",
};
const chip = (active) => ({
  padding: "4px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer", fontFamily: font.body, fontWeight: 600,
  border: `1px solid ${active ? C.green : C.line}`,
  background: active ? "rgba(34,197,94,0.12)" : "transparent",
  color: active ? C.green : C.muted,
});
const muted = { color: C.muted, fontSize: 13, margin: "0 0 10px 0", lineHeight: 1.5 };
const fieldFull = { width: "100%", marginBottom: 10, display: "block" };

const iconBtn = { background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center" };

const pagerBtn = (enabled) => ({
  background: enabled ? C.surface2 : "transparent", color: enabled ? C.text : C.line,
  border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 12px",
  cursor: enabled ? "pointer" : "default", display: "inline-flex", alignItems: "center",
});

const wrapOuter = { minHeight: "100vh", background: "#060B12", display: "flex", justifyContent: "center", fontFamily: font.body };
const phone = { width: "100%", maxWidth: 430, background: C.bg, color: C.text, minHeight: "100vh", display: "flex", flexDirection: "column" };
const thStyle = { color: C.muted, fontSize: 12, fontWeight: 600, fontFamily: font.display, textTransform: "uppercase", letterSpacing: "0.04em" };
// SKRIFTERNE HENTES FRA VORES EGEN SERVER (B4, august 2026).
//
// Her stod før en `@import` mod Googles fontværter, og den sendte hver eneste
// besøgendes IP-adresse dertil — også på login-skærmen, altså FØR nogen havde
// oprettet en konto eller accepteret noget. En privatlivspolitik kan beskrive
// en videregivelse; den kan ikke gøre den rimelig. Derfor er den fjernet frem
// for dokumenteret.
//
// To ting fulgte med i købet. Fonten skiftede sent, fordi reglen først fandtes,
// når React havde renderet — nu ligger filerne på vores eget domæne og
// forvarmes af to `<link rel="preload">` i index.html. Og en bredde-måling mod
// fallback-skriften har allerede kostet tid én gang (docs/DECISIONS.md, juli
// 2026, tip-skærmens tabel): med filerne i repoet kan enhver container måle
// mod den ægte skrift.
//
// KUN DE VÆGTE, DER BRUGES. Barlow 400/600/700 og Barlow Condensed 600/700 —
// talt i src/. Vægt 500 blev hentet før uden at blive brugt nogen steder. Vægt
// 800 bruges to steder, men blev heller ikke hentet før, så den syntetiseres
// af browseren nu som før; det er en uændret adfærd, ikke en ny mangel.
//
// LATIN-EXT ER IKKE PYNT. Champions League har klubber med tegn uden for
// latin-1 (fx Ş i Şahtar). `unicode-range` gør, at en dansk bruger kun henter
// latin-filerne — latin-ext koster først noget, når et tegn kræver den.
//
// Filnavnene er STABILE og cachet `immutable` i vercel.json. Skiftes en fil
// nogensinde ud, skal navnet skifte med, og de to preload-linjer i index.html
// skal rettes i samme ombæring.
//
// Forklaringen står HER og ikke inde i skabelonstrengen nedenfor: en
// CSS-kommentar sendes til hver eneste bruger i hver eneste bundle.
const globalCss = `
  /* Barlow 400 · latin */
  @font-face {
    font-family: 'Barlow';
    font-style: normal;
    font-weight: 400;
    font-display: swap;
    src: url('/fonts/barlow-400-latin.woff2') format('woff2');
    unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
  }
  /* Barlow 400 · latin-ext */
  @font-face {
    font-family: 'Barlow';
    font-style: normal;
    font-weight: 400;
    font-display: swap;
    src: url('/fonts/barlow-400-latin-ext.woff2') format('woff2');
    unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
  }
  /* Barlow 600 · latin */
  @font-face {
    font-family: 'Barlow';
    font-style: normal;
    font-weight: 600;
    font-display: swap;
    src: url('/fonts/barlow-600-latin.woff2') format('woff2');
    unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
  }
  /* Barlow 600 · latin-ext */
  @font-face {
    font-family: 'Barlow';
    font-style: normal;
    font-weight: 600;
    font-display: swap;
    src: url('/fonts/barlow-600-latin-ext.woff2') format('woff2');
    unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
  }
  /* Barlow 700 · latin */
  @font-face {
    font-family: 'Barlow';
    font-style: normal;
    font-weight: 700;
    font-display: swap;
    src: url('/fonts/barlow-700-latin.woff2') format('woff2');
    unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
  }
  /* Barlow 700 · latin-ext */
  @font-face {
    font-family: 'Barlow';
    font-style: normal;
    font-weight: 700;
    font-display: swap;
    src: url('/fonts/barlow-700-latin-ext.woff2') format('woff2');
    unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
  }
  /* Barlow Condensed 600 · latin */
  @font-face {
    font-family: 'Barlow Condensed';
    font-style: normal;
    font-weight: 600;
    font-display: swap;
    src: url('/fonts/barlow-condensed-600-latin.woff2') format('woff2');
    unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
  }
  /* Barlow Condensed 600 · latin-ext */
  @font-face {
    font-family: 'Barlow Condensed';
    font-style: normal;
    font-weight: 600;
    font-display: swap;
    src: url('/fonts/barlow-condensed-600-latin-ext.woff2') format('woff2');
    unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
  }
  /* Barlow Condensed 700 · latin */
  @font-face {
    font-family: 'Barlow Condensed';
    font-style: normal;
    font-weight: 700;
    font-display: swap;
    src: url('/fonts/barlow-condensed-700-latin.woff2') format('woff2');
    unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
  }
  /* Barlow Condensed 700 · latin-ext */
  @font-face {
    font-family: 'Barlow Condensed';
    font-style: normal;
    font-weight: 700;
    font-display: swap;
    src: url('/fonts/barlow-condensed-700-latin-ext.woff2') format('woff2');
    unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
  }
  * { box-sizing: border-box; }
  html, body, #root { min-height: 100%; }
  body { margin: 0; background: #060B12; }
  input, select, button { font-family: inherit; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 8px 8px; text-align: left; }
  .field { background: ${C.surface2}; border: 1px solid ${C.line}; color: ${C.text}; border-radius: 8px; padding: 8px 10px; font-size: 14px; }
  .rowline { border-bottom: 1px solid ${C.line}; }
  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  /* Tip-skærmens låste kamprække: hele rækken er tryk-fladen for "alles gæt",
     så affordancen skal kunne mærkes. Inline styles kan ikke :hover/:active. */
  .tiprow:hover, .tiprow:active { background: ${C.surface2}; }
  .livedot { animation: livepulse 1.4s ease-in-out infinite; }
  @keyframes livepulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
  /* En konkurrence er slut. Fejringen kører ÉN gang — første gang brugeren ser
     afslutningen — og aldrig igen; bagefter står kortet stille med sin guldkant.
     Det er med vilje ikke en løbende animation som live-prikken: dér betyder
     bevægelsen "det sker nu", og her ville den betyde "det skete engang". */
  .compdone { position: relative; overflow: hidden; animation: compglow 900ms ease-out 1; }
  .compdone::after {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(100deg, transparent 30%, rgba(242,193,78,0.26) 50%, transparent 70%);
    transform: translateX(-100%);
    animation: compsweep 900ms ease-out 1;
  }
  @keyframes compsweep { to { transform: translateX(100%); } }
  @keyframes compglow {
    from { box-shadow: 0 0 22px 0 rgba(242,193,78,0.45); }
    to   { box-shadow: 0 0 0 0 rgba(242,193,78,0); }
  }
  .comptrophy { display: inline-flex; }
  .compdone .comptrophy { animation: comppop 620ms cubic-bezier(0.2, 1.4, 0.4, 1) 1; }
  @keyframes comppop {
    0%   { transform: scale(0.2); opacity: 0; }
    60%  { transform: scale(1.25); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  /* Reduceret bevægelse gælder ALLE animationer, ikke kun live-prikken (G22).
     Spinderen er den hyppigste af dem — den kører på hver eneste indlæsning —
     og en bruger, der har bedt om ro, har bedt om ro fra den også. Den skjules
     ikke, kun stilles: ikonet er stadig signalet om, at noget er i gang. */
  @media (prefers-reduced-motion: reduce) {
    .livedot, .spin, .compdone, .compdone::after, .compdone .comptrophy { animation: none; }
    /* Stryge-laget skal også VÆK og ikke bare stå stille: uden animationen
       bliver det hængende midt over kortet som en permanent gul stribe. */
    .compdone::after { display: none; }
  }
  /* Fokusringen skal findes på ALT, der kan tabbes til — ikke kun knapper.
     Et felt, man kan nå med tastaturet, men ikke kan se, man står i, er
     tastatur-tilgængeligt kun på papiret. */
  button:focus-visible, input:focus-visible, select:focus-visible,
  a:focus-visible, [tabindex]:focus-visible {
    outline: 2px solid ${C.green}; outline-offset: 2px;
  }
  /* Etiket, der kun findes for skærmlæsere. Bruges hvor et synligt label ville
     gentage en placeholder eller sprænge en tæt kontrol — se ScoreInput og
     Auth-skærmen. Clip-metoden frem for display:none, som fjerner elementet
     fra tilgængelighedstræet og dermed også fra skærmlæseren. */
  .srOnly {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }
`;


export { C, font, btnGreen, btnGhost, btnGold, chip, muted, fieldFull, iconBtn, pagerBtn, wrapOuter, phone, thStyle, globalCss };
