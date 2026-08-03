// Sektion 3: liga-diagnose — målte signaler og én navngiven tilstand pr. liga.
import { useState, Fragment } from "react";

import { loadAnalyticsLeagueHealth, diagnoseLeagues, summarizeDiagnoses } from "../../lib/analytics.js";

import { C, muted } from "../../ui/theme.js";
import { FoldChevron, StateChip, SignalRow } from "../../ui/components.jsx";
import { M, Section, useSection, dtFmt, pctFmt } from "./shared.jsx";

// ---------- 3. Liga-diagnose ----------
// Afløser "Liga Health" (juli 2026). Tabellen viser tilstanden og de to
// signaler, der oftest afgør den (bredde og deltagelse); resten ligger i
// drill-in'en, hvor hvert signal har sin egen definition.
function LigaDiagnoseSection({ token, days }) {
  const { data, loading, err } = useSection(() => loadAnalyticsLeagueHealth(token, days), token, [token, days]);
  const [openId, setOpenId] = useState(null);
  const leagues = diagnoseLeagues(data?.leagues, days);
  const sum = summarizeDiagnoses(leagues);
  const th = { textAlign: "left", color: C.muted, fontSize: 12, fontWeight: 600, padding: "0 6px 6px" };

  return (
    <Section title="Liga-diagnose"
      subtitle={leagues.length ? `${sum.akut} kræver handling · ${sum.svag} med svaghedstegn · ${sum.sund} sunde · ${sum.ubedømt} kan ikke bedømmes` : undefined}
      loading={loading} err={err}>
      {leagues.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen ligaer endnu.</p>}
      {leagues.length > 0 && (
        <table style={{ width: "100%" }}><tbody>
          <tr>
            <th style={th}>Liga</th>
            <th style={th}>Tilstand</th>
            <th style={{ ...th, textAlign: "right" }}>Bredde</th>
            <th style={{ ...th, textAlign: "right" }}>Deltagelse</th>
          </tr>
          {leagues.map((l) => (
            <Fragment key={l.group_id}>
              {/* Rækken er stadig klikbar i hele sin bredde — det er den
                  hurtigste flade på en telefon — men SEMANTIKKEN bor nu i en
                  rigtig knap i første celle (G57). Før var folden en
                  `<tr onClick>` uden hverken tastaturadgang eller aria: den
                  eneste af appens fem folde, hvor indholdet var helt
                  uopnåeligt uden mus. En `<tr>` kan ikke selv være en knap, og
                  `Collapsible` kan ikke lægges om en tabelrække uden at bryde
                  tabellen — derfor knappen om navnet frem for om rækken. */}
              <tr className="rowline" style={{ cursor: "pointer" }} onClick={() => setOpenId(openId === l.group_id ? null : l.group_id)}>
                <td style={{ fontWeight: 600, padding: "8px 6px" }}>
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); setOpenId(openId === l.group_id ? null : l.group_id); }}
                    aria-expanded={openId === l.group_id}
                    aria-label={`${openId === l.group_id ? "Skjul" : "Vis"} diagnose for ${l.name}`}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left" }}>
                    {l.name}
                    <FoldChevron open={openId === l.group_id} size={13} />
                  </button>
                </td>
                <td style={{ padding: "8px 6px" }}><StateChip label={l.diagnosis.label} tone={l.diagnosis.tone} /></td>
                <td style={{ textAlign: "right", color: C.muted, fontSize: 13, padding: "8px 6px" }}>{l.predictors}/{l.members}</td>
                <td style={{ textAlign: "right", color: C.muted, fontSize: 13, padding: "8px 6px" }}>{pctFmt(l.completion_rate)}</td>
              </tr>
              {openId === l.group_id && (
                <tr>
                  <td colSpan={4} style={{ padding: "0 6px 14px" }}>
                    {/* Hvorfor + hvad man gør, med ligaens egne tal i sætningen
                        — et tal skal navngive sit eget omfang dér hvor det står. */}
                    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
                      <div style={{ color: C.text, fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}>
                        {l.diagnosis.why} <M id="league_state" />
                      </div>
                      {l.diagnosis.action && <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>{l.diagnosis.action}</div>}
                    </div>
                    <SignalRow label="Bredde" info={<M id="league_breadth" />}
                      value={pctFmt(l.predictor_share)} detail={`${l.predictors} af ${l.members} medlemmer tippede`} />
                    <SignalRow label="Deltagelse" info={<M id="league_completion" />}
                      value={pctFmt(l.completion_rate)} detail={`${l.completion_done} af ${l.completion_slots} mulige tips`} />
                    <SignalRow label="Retning" info={<M id="completion_trend" />}
                      value={l.completion_rate_prev === null || l.completion_rate_prev === undefined || l.completion_rate === null
                        ? "—"
                        : `${l.completion_rate - l.completion_rate_prev > 0 ? "+" : ""}${Math.round((l.completion_rate - l.completion_rate_prev) * 10) / 10} pp`}
                      detail={l.completion_rate_prev === null || l.completion_rate_prev === undefined ? "for lidt data i forrige vindue" : `forrige ${days} dage: ${l.completion_rate_prev} %`} />
                    <SignalRow label="Puls" info={<M id="league_pulse" />}
                      value={pctFmt(l.pulse)} detail={`${l.rounds_played} af ${l.rounds_available} låste runder blev spillet`} />
                    <SignalRow label="Koncentration" info={<M id="league_concentration" />}
                      value={pctFmt(l.top_predictor_share)} detail="den mest aktive tippers andel af ligaens tips" />
                    <SignalRow label="Aktive medlemmer" info={<M id="league_activity" />}
                      value={pctFmt(l.active_share)} detail={`${l.active_members} af ${l.members} åbnede appen i vinduet`} />
                    <SignalRow label="Fastholdelse" info={<M id="league_retention" />}
                      value={pctFmt(l.retention_rate)}
                      detail={l.retention_eligible ? `${l.retention_retained} af ${l.retention_eligible} medlemmer med mindst ${data.retention_min_age_days} dage på bagen` : "ingen medlemmer gamle nok endnu"} />
                    <SignalRow label="Konkurrencer" info={<M id="league_competitions" />}
                      value={`${l.competitions_active} i gang`} detail={`af ${l.competitions_total} i alt`} />
                    <SignalRow label="Story views" info={<M id="league_story_views" />}
                      value={l.story_views} detail="indgår bevidst ikke i diagnosen" />
                    <SignalRow label="Seneste aktivitet" info={<M id="league_last_activity" />}
                      value={dtFmt(l.last_activity_at)}
                      detail={l.days_since_activity === null ? "aldrig" : `for ${l.days_since_activity} ${l.days_since_activity === 1 ? "dag" : "dage"} siden`} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody></table>
      )}
      <p style={{ ...muted, margin: "12px 0 0" }}>
        Én tilstand pr. liga: den første regel, der passer, vinder — årsag før symptom, så en liga uden aktiv
        konkurrence hører dét frem for "for få tipper". Tærsklerne står samlet i <code>LEAGUE_THRESHOLDS</code>
        (<code>src/lib/analytics.js</code>) og kan ændres uden at røre databasen. Klik en række for at se hvert
        signal for sig.
      </p>
    </Section>
  );
}

export { LigaDiagnoseSection };
