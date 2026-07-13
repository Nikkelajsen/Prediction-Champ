// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
const C = {
  bg: "#0C1622",
  surface: "#14212F",
  surface2: "#1B2C3E",
  line: "#24374C",
  text: "#EDF3F8",
  muted: "#8CA0B3",
  green: "#22C55E",
  gold: "#F0B429",
  red: "#EF5B5B",
};
const font = {
  display: "'Barlow Condensed', sans-serif",
  body: "'Barlow', 'Inter', sans-serif",
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
const globalCss = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;600;700&display=swap');
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
  button:focus-visible { outline: 2px solid ${C.green}; outline-offset: 2px; }
`;


export { C, font, btnGreen, btnGhost, btnGold, chip, muted, fieldFull, iconBtn, pagerBtn, wrapOuter, phone, thStyle, globalCss };
