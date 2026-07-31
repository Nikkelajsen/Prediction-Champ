// Sektion 5: tragten for nye brugere.
import { useState } from "react";

import { loadAnalyticsFunnel, funnelRow, funnelSteps, biggestDrop, fmtMinutes, FUNNEL_STALLS } from "../../lib/analytics.js";

import { C, chip, font, muted } from "../../ui/theme.js";
import { SignalRow } from "../../ui/components.jsx";
import { M, Section, SubHead, useSection } from "./shared.jsx";

// ---------- 5. Tragt for nye brugere ----------
// Onboarding v1 blev bygget på påstanden om, at selvstarteren faldt igennem,
// mens den inviterede klarede sig fint. Denne sektion er første gang, den
// påstand kan efterprøves — derfor står de to veje ind side om side, og ikke
// som en samlet total, der ville gemme forskellen.
function FunnelBar({ step, cohort }) {
  const width = cohort > 0 ? Math.max(1, (step.users / cohort) * 100) : 0;
  const bad = step.dropPct !== null && step.dropPct >= 40;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: C.text }}>{step.label}</span>
        <span style={{ color: C.muted }}>
          <b style={{ color: C.text }}>{step.users}</b> · {step.pct} %
          {step.medianMinutes !== null && step.medianMinutes !== undefined && <> · median {fmtMinutes(step.medianMinutes)}</>}
        </span>
      </div>
      <div style={{ height: 10, background: C.surface2, borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${width}%`, height: "100%", background: bad ? C.red : C.green, borderRadius: 999 }} />
      </div>
      {step.dropFromPrev > 0 && (
        <div style={{ fontSize: 11, color: bad ? C.red : C.muted, marginTop: 2 }}>
          −{step.dropFromPrev} her ({step.dropPct} % af dem, der nåede forrige trin)
        </div>
      )}
    </div>
  );
}

function FunnelColumn({ title, row, info }) {
  const steps = funnelSteps(row);
  if (!row || !row.cohort) {
    return (
      <div>
        <SubHead>{title} {info}</SubHead>
        <p style={{ ...muted, margin: 0, fontSize: 12 }}>Ingen nye brugere i vinduet.</p>
      </div>
    );
  }
  return (
    <div>
      <SubHead>{title} {info}</SubHead>
      {steps.map((s) => <FunnelBar key={s.key} step={s} cohort={row.cohort} />)}
    </div>
  );
}

function FunnelSection({ token, days }) {
  const { data, loading, err } = useSection(() => loadAnalyticsFunnel(token, days), token, [token, days]);
  // Vinduet er sandheden for "hvordan går det NU", men en 7-dages kohorte kan
  // være to brugere. Alt-tid står ved siden af som volumen, aldrig i stedet for.
  const [scope, setScope] = useState("window");
  const total = funnelRow(data, scope);
  const steps = funnelSteps(total);
  const worst = biggestDrop(steps);

  return (
    <Section title="Tragt for nye brugere"
      subtitle="Konto → liga → konkurrence → første tip. Udledt af rigtige tabeller, ikke af hændelsesloggen."
      loading={loading} err={err}>
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={chip(scope === "window")} onClick={() => setScope("window")}>Nye i vinduet</button>
            <button style={chip(scope === "all_time")} onClick={() => setScope("all_time")}>Alle brugere</button>
          </div>
          {!total || !total.cohort ? (
            <p style={{ ...muted, margin: 0 }}>Ingen brugere oprettet i perioden — vælg et længere vindue eller "Alle brugere".</p>
          ) : (
            <>
              {worst && (
                <div style={{ background: "rgba(240,180,41,0.08)", border: `1px solid ${C.gold}`, borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ color: C.muted, fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
                    Største frafald <M id="funnel" />
                  </div>
                  <div style={{ fontFamily: font.display, fontWeight: 700, fontSize: 18, color: C.gold, lineHeight: 1.2 }}>
                    {worst.label}
                  </div>
                  <div style={{ color: C.muted, fontSize: 12 }}>
                    {worst.dropFromPrev} af {total.cohort} brugere nåede ikke hertil — {worst.dropPct} % af dem, der klarede forrige trin.
                  </div>
                </div>
              )}
              <FunnelColumn title="Alle nye" row={total} info={<M id="funnel" />} />
              {/* Den opdeling, hele sektionen findes for. */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
                <FunnelColumn title="Selvstartere" row={funnelRow(data, scope, "selvstarter")} info={<M id="funnel_path" />} />
                <FunnelColumn title="Inviterede" row={funnelRow(data, scope, "inviteret")} info={<M id="funnel_path" />} />
              </div>
              <div>
                <SubHead>Hvor står de nu <M id="funnel_stalled" /></SubHead>
                {FUNNEL_STALLS.map((s) => (
                  <SignalRow key={s.key} label={s.label} value={total[s.key] ?? 0}
                    detail={total.cohort ? `${Math.round((1000 * (total[s.key] ?? 0)) / total.cohort) / 10} % af kohorten` : undefined} />
                ))}
                <p style={{ ...muted, margin: "8px 0 0", fontSize: 11 }}>
                  Disse fire tæller hver bruger præcis én gang og summer til kohorten — modsat trinnene ovenfor,
                  som ikke er strengt indlejrede (en liga-løs konkurrence kan nås uden en liga). <M id="funnel_time" />
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </Section>
  );
}

export { FunnelSection };
