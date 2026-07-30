// Analytics v1 — internt dashboard (Admin → Analytics). Spec: docs/features/analytics-v1.md
//
// Fire uafhængige sektioner, hver med egen { data, loading, err } og eget
// useEffect: én langsom eller fejlende sektion blokerer aldrig de tre andre.
// Ingen ny chart-dependency — genbruger de håndrullede StatTile/StatGroup/
// MiniBars fra ui/components.jsx (samme stil som den eksisterende
// "Statistik"-fane, jf. arkitekturvalg #2).
import { useState, useEffect, Fragment } from "react";
import { Loader2 } from "lucide-react";
import { loadAnalyticsHealth, loadAnalyticsEngagement, loadAnalyticsLeagueHealth, loadAnalyticsRetention } from "../lib/analytics.js";
import { C, chip, font, muted } from "../ui/theme.js";
import { Card, StatTile, StatGroup, MiniBars, HealthBar, PctGrid } from "../ui/components.jsx";

const dayLabel = (iso) => { const d = new Date(iso); return d.toLocaleDateString("da-DK", { day: "numeric", month: "short" }); };
const weekLabel = (iso) => { const d = new Date(iso); return d.toLocaleDateString("da-DK", { day: "numeric", month: "short" }); };
const dtFmt = (iso) => iso ? new Date(iso).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" }) : "Aldrig";
function fmtDur(sec) {
  sec = Number(sec) || 0;
  const m = Math.floor(sec / 60); const s = Math.round(sec % 60);
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

// Fælles skal for en sektion: overskrift + loading/fejl/indhold. Fejl i én
// sektion rammer kun dens eget Card.
function Section({ title, loading, err, children }) {
  return (
    <Card>
      <div style={{ fontFamily: font.display, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 15, marginBottom: 12 }}>{title}</div>
      {loading && <p style={{ ...muted, display: "flex", gap: 8, alignItems: "center", margin: 0 }}><Loader2 size={14} className="spin" /> Henter …</p>}
      {err && <p style={{ color: C.red, fontSize: 13, margin: 0 }}>Fejl: {err}</p>}
      {!loading && !err && children}
    </Card>
  );
}

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

// ---------- 1. Produktets sundhed ----------
function HealthSection({ token, days }) {
  const { data, loading, err } = useSection(() => loadAnalyticsHealth(token, days), token, [token, days]);
  return (
    <Section title="Produktets sundhed" loading={loading} err={err}>
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* North Star: eget fremhævet kort, den vigtigste tal-fladen på siden */}
          <div style={{ background: "rgba(240,180,41,0.08)", border: `1px solid ${C.gold}`, borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ color: C.muted, fontSize: 12 }}>Prediction Completion Rate (North Star)</div>
            <div style={{ fontFamily: font.display, fontWeight: 700, fontSize: 34, color: C.gold, lineHeight: 1.1 }}>
              {data.completion_rate === null ? "—" : `${data.completion_rate}%`}
            </div>
            <div style={{ color: C.muted, fontSize: 12 }}>
              {data.completion_done} af {data.completion_slots} mulige tips i vinduet · alt-tid {data.completion_rate_all_time === null ? "—" : `${data.completion_rate_all_time}%`}
            </div>
          </div>
          <StatGroup title="Nøgletal">
            <StatTile label="Aktive brugere (7 dage)" value={data.active_users_7d} hint={`${data.active_users_30d} seneste 30 dage`} />
            <StatTile label="Aktive ligaer" value={data.active_groups} hint={`af ${data.groups_total} i alt · ${data.groups_with_active_member} med mindst én aktiv`} />
            <StatTile label="Aktive konkurrencer" value={data.active_competitions} hint={`${data.live_competitions} i gang · ${data.competitions_total} i alt`} />
            <StatTile label="Deadline Miss Rate" value={data.deadline_miss.miss_rate === null ? "—" : `${data.deadline_miss.miss_rate}%`}
              hint={data.deadline_miss.miss_rate_of_exposed === null ? undefined : `${data.deadline_miss.miss_rate_of_exposed}% af dem der havde en deadline`} />
            <StatTile label="Gennemførte spillerunder" value={data.rounds_completed} />
          </StatGroup>
          <div>
            <div style={{ fontFamily: font.display, fontWeight: 700, textTransform: "uppercase", fontSize: 13, color: C.muted, marginBottom: 8 }}>Completion rate pr. uge</div>
            <MiniBars data={(data.completion_by_week || []).map((r) => ({ key: r.week, value: r.pct ?? 0 }))} color={C.gold} formatLabel={weekLabel} />
          </div>
          <div>
            <div style={{ fontFamily: font.display, fontWeight: 700, textTransform: "uppercase", fontSize: 13, color: C.muted, marginBottom: 8 }}>Gennemførte runder pr. uge</div>
            <MiniBars data={(data.rounds_completed_by_week || []).map((r) => ({ key: r.week, value: r.count }))} color={C.green} formatLabel={weekLabel} />
          </div>
        </div>
      )}
    </Section>
  );
}

// ---------- 2. Engagement ----------
function EngagementSection({ token, days }) {
  const { data, loading, err } = useSection(() => loadAnalyticsEngagement(token, days), token, [token, days]);
  const [metric, setMetric] = useState("opened_home");
  const seriesOptions = ["opened_home", "opened_tip", "opened_league", "opened_rating", "opened_career", "opened_standings", "opened_championship", "story_viewed"];
  const ev = data?.events || {};
  const series = (data?.events_by_day?.[metric] || []).map((r) => ({ key: r.day, value: r.count }));

  return (
    <Section title="Engagement" loading={loading} err={err}>
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <StatGroup title="Views">
            <StatTile label="Story Views" value={ev.story_viewed?.count ?? 0} hint={`${ev.story_viewed?.users ?? 0} brugere`} />
            <StatTile label="Karriere Views" value={ev.opened_career?.count ?? 0} hint={`${ev.opened_career?.users ?? 0} brugere`} />
            <StatTile label="Rating Views" value={ev.opened_rating?.count ?? 0} hint={`${ev.opened_rating?.users ?? 0} brugere`} />
            <StatTile label="Liga Views" value={data.league_views_total} hint={`${data.league_views_detail} på en bestemt liga`} />
            <StatTile label="Tip Views" value={ev.opened_tip?.count ?? 0} hint={`${ev.opened_tip?.users ?? 0} brugere`} />
          </StatGroup>
          <StatGroup title="Notifikationer & sessioner">
            <StatTile label="Push Notification Open Rate" value={data.push.open_rate === null ? "—" : `${data.push.open_rate}%`}
              hint={`${data.push.opened} åbnet af ${data.push.sent} sendt`} />
            <StatTile label="Gns. sessionstid" value={fmtDur(data.session.avg_seconds)}
              hint={`median ${fmtDur(data.session.median_seconds)} · ${data.session.sessions} sessioner (kun 1 hændelse tæller som 0 s)`} />
          </StatGroup>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontFamily: font.display, fontWeight: 700, textTransform: "uppercase", fontSize: 13, color: C.muted }}>Hændelser pr. dag</div>
              <select className="field" value={metric} onChange={(e) => setMetric(e.target.value)} style={{ fontSize: 12, padding: "4px 8px" }}>
                {seriesOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <MiniBars data={series} color={C.green} formatLabel={dayLabel} />
          </div>
        </div>
      )}
    </Section>
  );
}

// ---------- 3. Liga Health ----------
function LigaHealthSection({ token, days }) {
  const { data, loading, err } = useSection(() => loadAnalyticsLeagueHealth(token, days), token, [token, days]);
  const [openId, setOpenId] = useState(null);
  const leagues = data?.leagues || [];

  return (
    <Section title="Liga Health" loading={loading} err={err}>
      {leagues.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen ligaer endnu.</p>}
      {leagues.length > 0 && (
        <table><tbody>
          <tr>
            <th style={{ textAlign: "left", color: C.muted, fontSize: 12, fontWeight: 600 }}>Liga</th>
            <th style={{ textAlign: "left", color: C.muted, fontSize: 12, fontWeight: 600 }}>Health Score</th>
            <th style={{ textAlign: "right", color: C.muted, fontSize: 12, fontWeight: 600 }}>Aktive medlemmer</th>
            <th style={{ textAlign: "right", color: C.muted, fontSize: 12, fontWeight: 600 }}>Seneste aktivitet</th>
          </tr>
          {leagues.map((l) => (
            <Fragment key={l.group_id}>
              <tr className="rowline" style={{ cursor: "pointer" }} onClick={() => setOpenId(openId === l.group_id ? null : l.group_id)}>
                <td style={{ fontWeight: 600, padding: "8px 6px" }}>{l.name}</td>
                <td style={{ padding: "8px 6px" }}><HealthBar score={l.health_score} /></td>
                <td style={{ textAlign: "right", color: C.muted, fontSize: 13, padding: "8px 6px" }}>{l.active_members_30d}/{l.members}</td>
                <td style={{ textAlign: "right", color: C.muted, fontSize: 12, padding: "8px 6px" }}>{dtFmt(l.last_activity_at)}</td>
              </tr>
              {openId === l.group_id && (
                <tr>
                  <td colSpan={4} style={{ padding: "0 6px 14px" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, color: C.muted }}>
                      <span>Completion rate: {l.completion_rate === null ? "—" : `${l.completion_rate}%`} (vægt 35%)</span>
                      <span>Retention: {l.retention_rate === null ? "—" : `${l.retention_rate}%`} (vægt 20%)</span>
                      <span>Aktivitet 30 dage: {l.activity_rate === null ? "—" : `${l.activity_rate}%`} (vægt 20%)</span>
                      <span>Story views: {l.story_views_30d} (vægt 10%)</span>
                      <span>Konkurrencer: {l.competitions_active} i gang af {l.competitions_total} (medlemsvægt 15%)</span>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody></table>
      )}
      <p style={{ ...muted, margin: "12px 0 0" }}>
        Health Score er en v1-heuristik (vægtene kan tunes i sql/analytics_dashboard.sql) — kun meningsfuld som rangering inden for dette snapshot, ikke som et absolut mål. Klik en række for at se, hvad scoren består af.
      </p>
    </Section>
  );
}

// ---------- 4. Retention ----------
const MILESTONES = [1, 4, 12, 26, 52];

function isMilestoneUnmeasurable(wk, since) {
  if (!since) return true;
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - wk * 7);
  return windowStart < new Date(since);
}

function RetentionSection({ token }) {
  const { data, loading, err } = useSection(() => loadAnalyticsRetention(token), token, [token]);

  if (!data) return <Section title="Retention" loading={loading} err={err} />;

  const since = data.activity_since;
  const milestoneRows = (arr) => {
    const byWeek = Object.fromEntries((arr || []).map((r) => [r.week, r]));
    return MILESTONES.map((wk) => {
      const r = byWeek[wk];
      const disabled = isMilestoneUnmeasurable(wk, since) || !r || r.eligible === 0;
      return { wk, pct: r?.pct ?? null, eligible: r?.eligible ?? 0, retained: r?.retained ?? 0, disabled };
    });
  };
  const userRows = milestoneRows(data.user_retention);
  const leagueRows = milestoneRows(data.league_retention);

  // Kohortematrix: seneste 12 ugentlige tilmeldings-kohorter × 5 milepæle.
  const cohortColumns = MILESTONES.map((wk) => ({ key: wk, label: `U${wk}` }));
  const byCohort = new Map();
  for (const r of data.user_cohorts || []) {
    if (!byCohort.has(r.cohort_week)) byCohort.set(r.cohort_week, { key: r.cohort_week, label: dtFmt(r.cohort_week), cells: {} });
    const disabled = isMilestoneUnmeasurable(r.week, since) || r.eligible === 0;
    byCohort.get(r.cohort_week).cells[r.week] = {
      pct: r.pct, disabled, reason: disabled ? "Ingen data endnu, eller ingen nye brugere i den uge" : undefined,
    };
  }
  const cohortRows = [...byCohort.values()].sort((a, b) => (a.key < b.key ? 1 : -1));

  return (
    <Section title="Retention" loading={loading} err={err}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <div style={{ fontFamily: font.display, fontWeight: 700, textTransform: "uppercase", fontSize: 13, color: C.muted, marginBottom: 8 }}>Brugere</div>
          <Grid2>
            {userRows.map((r) => (
              <StatTile key={r.wk} label={`Uge ${r.wk}`} value={r.disabled ? "—" : `${r.pct}%`}
                hint={r.disabled ? "Ingen data endnu" : `${r.retained} af ${r.eligible}`} />
            ))}
          </Grid2>
        </div>
        <div>
          <div style={{ fontFamily: font.display, fontWeight: 700, textTransform: "uppercase", fontSize: 13, color: C.muted, marginBottom: 8 }}>Ligaer</div>
          <Grid2>
            {leagueRows.map((r) => (
              <StatTile key={r.wk} label={`Uge ${r.wk}`} value={r.disabled ? "—" : `${r.pct}%`}
                hint={r.disabled ? "Ingen data endnu" : `${r.retained} af ${r.eligible}`} />
            ))}
          </Grid2>
        </div>
        {cohortRows.length > 0 && (
          <div>
            <div style={{ fontFamily: font.display, fontWeight: 700, textTransform: "uppercase", fontSize: 13, color: C.muted, marginBottom: 8 }}>
              Seneste kohorter (brugere, pr. tilmeldingsuge)
            </div>
            <PctGrid columns={cohortColumns} rows={cohortRows} />
          </div>
        )}
        <p style={{ ...muted, margin: 0 }}>
          Aktivitetstal begynder først at samle sig fra {since ? dtFmt(since) : "…"} — en milepæl, hvis vindue åbner før dén dato, vises som "Ingen data endnu", ALDRIG som et forkert 0%.
        </p>
      </div>
    </Section>
  );
}

// ---------- Top-level panel ----------
function AnalyticsPanel({ token }) {
  const [days, setDays] = useState(30);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {[7, 30, 90].map((d) => (
          <button key={d} style={chip(days === d)} onClick={() => setDays(d)}>{d} dage</button>
        ))}
      </div>
      <HealthSection token={token} days={days} />
      <EngagementSection token={token} days={days} />
      <LigaHealthSection token={token} days={days} />
      <RetentionSection token={token} />
    </div>
  );
}

export default AnalyticsPanel;
