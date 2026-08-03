// Letvægts ratingkurve — ingen chart-bibliotek (arkitekturvalg i
// features/karriereprofil-v1.md).
//
// Udskilt fra ProfileScreen.jsx den 3. august 2026 (G1). Ren flytning.
import { C } from "../../ui/theme.js";
import { safeRoundLabel } from "./facts.js";

// nogensinde" kan genfindes i kurven i stedet for at være et løsrevet tal.
//
// Akse-etiketterne står som HTML uden om SVG'en, ikke som <text> inde i den:
// viewBox'en skaleres med preserveAspectRatio="none", så tekst inde i grafen
// ville blive vandret forvrænget på brede skærme.
export function Sparkline({ curve, peakRoundKey }) {
  if (!curve || curve.length < 2) return null;
  const W = 300, Hgt = 90, pad = 8;
  const vals = curve.map((p) => p.rating_after);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const n = curve.length;
  const x = (i) => pad + (i * (W - 2 * pad)) / (n - 1);
  const y = (v) => pad + (1 - (v - min) / span) * (Hgt - 2 * pad);
  const PROV = 5; // foreløbig periode = de første 5 runder
  const provEnd = Math.min(PROV, n); // antal provisoriske punkter (1-indekseret grænse)

  // to polyline-segmenter: provisorisk (dæmpet, stiplet) og fast (guld)
  const provPts = curve.slice(0, provEnd).map((p, i) => `${x(i).toFixed(1)},${y(p.rating_after).toFixed(1)}`).join(" ");
  const firmStart = Math.max(0, provEnd - 1); // overlap ét punkt så linjen hænger sammen
  const firmPts = curve.slice(firmStart).map((p, i) => `${x(firmStart + i).toFixed(1)},${y(p.rating_after).toFixed(1)}`).join(" ");

  // Toppunktet: brug RPC'ets round_key, så ring og rekord-linje altid peger på
  // samme runde. Falder tilbage til kurvens egen maksimumsprik, hvis nøglen
  // mangler (fx før migreringen) — så ringen aldrig bare forsvinder.
  const peakIdx = peakRoundKey != null
    ? curve.findIndex((p) => p.round_key === peakRoundKey)
    : vals.indexOf(max);
  const peak = peakIdx >= 0 ? peakIdx : vals.indexOf(max);

  const firstLabel = safeRoundLabel(curve[0]?.round_key);
  const lastLabel = safeRoundLabel(curve[n - 1]?.round_key);
  const axis = { color: C.muted, fontSize: 11, whiteSpace: "nowrap" };

  return (
    <div>
      {/* Y-akse som neutral skala-angivelse frem for "din laveste rating":
          intervallet gør kurvens udsving læsbare uden at udpege et lavpunkt. */}
      <div style={{ ...axis, marginBottom: 2 }}>Skala {min}–{max}</div>
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${Hgt}`} width="100%" height={Hgt} preserveAspectRatio="none" style={{ display: "block" }}>
          {provEnd >= 2 && (
            <polyline points={provPts} fill="none" stroke={C.muted} strokeWidth="1.6" strokeDasharray="3 3" strokeLinejoin="round" strokeLinecap="round" />
          )}
          {n - firmStart >= 2 && (
            <polyline points={firmPts} fill="none" stroke={C.gold} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          )}
          {curve.map((p, i) => (
            <circle key={i} cx={x(i)} cy={y(p.rating_after)} r={i < PROV ? 2 : 2.6}
              fill={i < PROV ? C.muted : C.gold} />
          ))}
          {peak >= 0 && (
            <circle cx={x(peak)} cy={y(curve[peak].rating_after)} r="5.5"
              fill="none" stroke={C.gold} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      </div>
      {/* X-akse: kun første og sidste runde. Alle etiketter ville ikke kunne
          læses på en telefon, og kurven skal give et forløb, ikke aflæsninger. */}
      {(firstLabel || lastLabel) && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
          <span style={axis}>{firstLabel || ""}</span>
          <span style={axis}>{lastLabel || ""}</span>
        </div>
      )}
    </div>
  );
}
