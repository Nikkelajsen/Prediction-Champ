// Analytics v1 — internt dashboard (Admin → Analytics). Spec: docs/features/analytics-v1.md
//
// Filen var 646 linjer og udpeget som teknisk gæld i DOCUMENTATION.md afsnit 12.
// De syv sektioner ligger nu hver for sig i analytics/; det, der er tilbage her,
// er periodevælgeren og sammensætningen.
//
// Sektionerne er bevidst uafhængige: hver har sit eget { data, loading, err } via
// useSection, så én langsom eller fejlende sektion aldrig blokerer de andre.
//
// AUGUST 2026: "Aktive brugere pr. runde" (B38) — den løbende udvikling målt på
// produktets egen enhed, spillerunden. Den er den eneste sektion med sin egen
// vælger, fordi 7/30/90 dage skærer midt igennem en runde.
// Ingen ny chart-dependency — genbruger de håndrullede StatTile/StatGroup/
// MiniBars fra ui/components.jsx (samme stil som den eksisterende
// "Statistik"-fane, jf. arkitekturvalg #2).
//
// JULI 2026, to ændringer:
//   · Hvert nøgletal har en ⓘ, der siger hvad der måles, hvordan, fra hvilken
//     kilde og hvad tallet IKKE kan bruges til (måle-ordbogen i
//     src/lib/analyticsMetrics.js). Etiketter og hints kan fortsat læses
//     alene — ⓘ'en uddyber, den bærer aldrig forudsætningen.
//   · "Liga Health" (ét sammenvejet 0-100-tal) er afløst af "Liga-diagnose":
//     målte signaler hver for sig plus én navngivet tilstand med en handling.
//     Begrundelsen står i diagnoseLeague() i src/lib/analytics.js.
import { useState } from "react";
import { chip } from "../ui/theme.js";
import { HealthSection } from "./analytics/HealthSection.jsx";
import { RoundsSection } from "./analytics/RoundsSection.jsx";
import { EngagementSection } from "./analytics/EngagementSection.jsx";
import { LigaDiagnoseSection } from "./analytics/LigaDiagnoseSection.jsx";
import { RetentionSection } from "./analytics/RetentionSection.jsx";
import { FunnelSection } from "./analytics/FunnelSection.jsx";
import { StoriesSection } from "./analytics/StoriesSection.jsx";

function AnalyticsPanel({ token }) {
  const [days, setDays] = useState(30);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {[7, 30, 90].map((d) => (
          <button key={d} style={chip(days === d)} onClick={() => setDays(d)}>{d} dage</button>
        ))}
      </div>
      {/* Rækkefølgen følger brugerens rejse: kommer de ind (tragt), bliver de
          (sundhed/runder/engagement), hvad ser de (Story Engine), hvor bor de
          (liga-diagnose), og bliver de hængende (retention).
          Runde-serien står lige efter sundheden, fordi den svarer på det, et
          vindue ikke kan: går det op eller ned? Den er også den ENESTE sektion,
          dagsvælgeren ovenfor ikke gælder — den har sit eget runde-vindue. */}
      <FunnelSection token={token} days={days} />
      <HealthSection token={token} days={days} />
      <RoundsSection token={token} />
      <EngagementSection token={token} days={days} />
      <StoriesSection token={token} days={days} />
      <LigaDiagnoseSection token={token} days={days} />
      <RetentionSection token={token} />
    </div>
  );
}

export default AnalyticsPanel;
