// Sektion 6: Story Engine pr. regel — genereret, vist, delt, afvist.

import { loadAnalyticsStories, storyRuleRows } from "../../lib/analytics.js";

import { C, muted } from "../../ui/theme.js";
import { StatTile, StatGroup } from "../../ui/components.jsx";
import { M, Section, useSection } from "./shared.jsx";

// ---------- 6. Story Engine-regler ----------
function StoriesSection({ token, days }) {
  const { data, loading, err } = useSection(() => loadAnalyticsStories(token, days), token, [token, days]);
  const rows = storyRuleRows(data);
  const never = rows.filter((r) => r.never);
  const coverage = data && data.users_with_rounds
    ? Math.round((1000 * data.users_reached) / data.users_with_rounds) / 10 : null;
  const th = { textAlign: "right", color: C.muted, fontSize: 11, fontWeight: 600, padding: "0 4px 6px" };

  return (
    <Section title="Story Engine-regler"
      subtitle="Hvilke regler udløser, og hvordan reagerer folk på dem."
      loading={loading} err={err}>
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <StatGroup title="Samlet">
            <StatTile label="Historier genereret" value={data.generated_total} hint={`til ${data.users_reached} brugere`} info={<M id="story_rules" />} />
            <StatTile label="Dækning" value={coverage === null ? "—" : `${coverage} %`}
              hint={`${data.users_reached} af ${data.users_with_rounds} med en låst runde`} info={<M id="story_coverage" />} />
          </StatGroup>
          {never.length > 0 && (
            <div style={{ background: "rgba(239,68,68,0.07)", border: `1px solid ${C.red}`, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ color: C.text, fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}>
                {never.length} {never.length === 1 ? "regel har" : "regler har"} aldrig udløst <M id="story_never" />
              </div>
              <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
                {never.map((r) => r.label).join(" · ")} — hverken i vinduet eller nogensinde. Enten er tærsklen for stram, eller reglen virker ikke.
              </div>
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Regel</th>
                  <th style={th}>Genereret</th>
                  <th style={th}>Vist</th>
                  <th style={th}>Delt</th>
                  <th style={th}>Afvist</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rule} className="rowline" style={{ opacity: r.never ? 0.45 : 1 }}>
                    <td style={{ padding: "6px 4px", color: C.text }}>
                      {r.label}
                      {r.never && <span style={{ color: C.red, fontSize: 10, marginLeft: 6 }}>ALDRIG</span>}
                      {r.silent && <span style={{ color: C.muted, fontSize: 10, marginLeft: 6 }}>STILLE</span>}
                      {r.unknown && <span style={{ color: C.gold, fontSize: 10, marginLeft: 6 }}>UKENDT</span>}
                    </td>
                    <td style={{ ...th, padding: "6px 4px", color: C.text }}>{r.generated}</td>
                    <td style={{ ...th, padding: "6px 4px", color: C.muted }}>{r.viewed}{r.view_rate !== null && ` (${r.view_rate} %)`}</td>
                    <td style={{ ...th, padding: "6px 4px", color: C.muted }}>{r.shared}</td>
                    <td style={{ ...th, padding: "6px 4px", color: C.muted }}>{r.dismissed}{r.dismiss_rate !== null && ` (${r.dismiss_rate} %)`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ ...muted, margin: 0, fontSize: 11 }}>
            <b>Genereret</b> og <b>afvist</b> er rigtige rækker i <code>stories</code> og dermed præcise.
            <b> Vist</b> og <b>delt</b> kommer fra hændelsesloggen og er et <b>gulv</b> — en lav visningsrate kan
            lige så godt være tabt logning som en historie, ingen så. Sammenlign regler med hinanden, ikke med et ideal.
            <b> ALDRIG</b> = har aldrig udløst; <b>STILLE</b> = har udløst før, men ikke i vinduet.
          </p>
        </div>
      )}
    </Section>
  );
}

export { StoriesSection };
