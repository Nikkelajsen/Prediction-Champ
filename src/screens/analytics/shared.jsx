// Fælles byggesten for dashboardets sektioner: formattering, ⓘ-knappen fra
// måle-ordbogen, sektions-rammen med loading/fejl, og useSection-hooken.
//
// useSection er grunden til, at sektionerne kan være uafhængige: hver har sit
// eget { data, loading, err }, så én langsom eller fejlende sektion aldrig
// blokerer de tre andre.
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { metricInfo } from "../../lib/analyticsMetrics.js";
import { C, font, muted } from "../../ui/theme.js";
import { Card, InfoDot } from "../../ui/components.jsx";

const dayLabel = (iso) => { const d = new Date(iso); return d.toLocaleDateString("da-DK", { day: "numeric", month: "short" }); };
const weekLabel = (iso) => { const d = new Date(iso); return d.toLocaleDateString("da-DK", { day: "numeric", month: "short" }); };
const monthLabel = (ym) => {
  const [y, m] = String(ym).split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("da-DK", { month: "short", year: "2-digit" });
};
const dtFmt = (iso) => iso ? new Date(iso).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" }) : "Aldrig";
const pctFmt = (v) => (v === null || v === undefined ? "—" : `${v} %`);
function fmtDur(sec) {
  sec = Number(sec) || 0;
  const m = Math.floor(sec / 60); const s = Math.round(sec % 60);
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

// ⓘ for ét id i måle-ordbogen. Ukendt id → ingen ⓘ (metricInfo returnerer
// null), så en tastefejl koster forklaringen, ikke sektionen.
function M({ id }) {
  const m = metricInfo(id);
  if (!m) return null;
  const Row = ({ head, children }) => (
    <p style={{ margin: "0 0 10px" }}>
      <span style={{ color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", display: "block" }}>{head}</span>
      {children}
    </p>
  );
  return (
    <InfoDot title={m.title}>
      <Row head="Hvad måles">{m.what}</Row>
      <Row head="Hvordan">{m.how}</Row>
      <Row head="Kilde">{m.source}</Row>
      {m.caveat && <Row head="Forbehold">{m.caveat}</Row>}
    </InfoDot>
  );
}

// Fælles skal for en sektion: overskrift + loading/fejl/indhold. Fejl i én
// sektion rammer kun dens eget Card.
function Section({ title, subtitle, loading, err, children }) {
  return (
    <Card>
      <div style={{ fontFamily: font.display, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 15, marginBottom: subtitle ? 2 : 12 }}>{title}</div>
      {subtitle && <div style={{ ...muted, fontSize: 12, marginBottom: 12 }}>{subtitle}</div>}
      {loading && <p style={{ ...muted, display: "flex", gap: 8, alignItems: "center", margin: 0 }}><Loader2 size={14} className="spin" /> Henter …</p>}
      {err && <p style={{ color: C.red, fontSize: 13, margin: 0 }}>Fejl: {err}</p>}
      {!loading && !err && children}
    </Card>
  );
}

const SubHead = ({ children }) => (
  <div style={{ fontFamily: font.display, fontWeight: 700, textTransform: "uppercase", fontSize: 13, color: C.muted, marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>{children}</div>
);

// Simpel 2-kolonne-grid uden StatGroup's egen overskrift (bruges hvor
// overskriften allerede står lige ovenover).
const Grid2 = ({ children }) => <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{children}</div>;

function useSection(loader, token, deps) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr("");
      try { const d = await loader(); if (!cancelled) setData(d); }
      catch (e) { if (!cancelled) setErr(e.message || "Kunne ikke hente"); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, loading, err };
}

export { dayLabel, weekLabel, monthLabel, dtFmt, pctFmt, fmtDur, M, Section, SubHead, Grid2, useSection };
