// Sektion 1: produktets sundhed — North Star og de bærende nøgletal.

import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { loadAnalyticsHealth } from "../../lib/analytics.js";

import { C, font } from "../../ui/theme.js";
import { StatTile, StatGroup, MiniBars } from "../../ui/components.jsx";
import { M, Section, SubHead, useSection, weekLabel, monthLabel } from "./shared.jsx";

// ---------- 1. Produktets sundhed ----------
function HealthSection({ token, days }) {
  const { data, loading, err } = useSection(() => loadAnalyticsHealth(token, days), token, [token, days]);
  // Retning frem for niveau: "62 %" kan ikke bære en beslutning, "62 %, ned
  // fra 71 %" kan. Skjules helt, når forrige vindue var for tyndt (RPC'en
  // sender da null) — støj må ikke præsenteres som et fald.
  const prev = data?.completion_rate_prev;
  const nowRate = data?.completion_rate;
  const delta = (prev === null || prev === undefined || nowRate === null || nowRate === undefined)
    ? null : Math.round((nowRate - prev) * 10) / 10;

  return (
    <Section title="Produktets sundhed" subtitle={`Vinduet gælder alle tal undtagen hvor der står "alt tid".`} loading={loading} err={err}>
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* North Star: eget fremhævet kort, den vigtigste tal-fladen på siden */}
          <div style={{ background: "rgba(240,180,41,0.08)", border: `1px solid ${C.gold}`, borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ color: C.muted, fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
              Prediction Completion Rate (North Star) <M id="completion_rate" />
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontFamily: font.display, fontWeight: 700, fontSize: 34, color: C.gold, lineHeight: 1.1 }}>
                {nowRate === null || nowRate === undefined ? "—" : `${nowRate} %`}
              </div>
              {delta !== null && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 13, fontWeight: 600, color: delta < 0 ? C.red : C.green }}>
                  {delta < 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                  {delta > 0 ? "+" : ""}{delta} pp
                  <span style={{ color: C.muted, fontWeight: 400, marginLeft: 4 }}>mod forrige {days} dage ({prev} %)</span>
                  <M id="completion_trend" />
                </span>
              )}
            </div>
            <div style={{ color: C.muted, fontSize: 12 }}>
              {data.completion_done} af {data.completion_slots} mulige tips i vinduet · alt tid {data.completion_rate_all_time === null ? "—" : `${data.completion_rate_all_time} %`}
            </div>
          </div>
          <StatGroup title="Nøgletal">
            <StatTile label="Aktive brugere (7 dage)" value={data.active_users_7d} hint={`${data.active_users_30d} seneste 30 dage`} info={<M id="active_users" />} />
            <StatTile label="Aktive ligaer" value={data.active_groups} hint={`af ${data.groups_total} i alt · ${data.groups_with_active_member} med mindst én aktiv`} info={<M id="active_groups" />} />
            <StatTile label="Aktive konkurrencer" value={data.active_competitions} hint={`${data.live_competitions} i gang · ${data.competitions_total} i alt`} info={<M id="active_competitions" />} />
            <StatTile label="Deadline Miss Rate" value={data.deadline_miss.miss_rate === null ? "—" : `${data.deadline_miss.miss_rate} %`}
              hint={data.deadline_miss.miss_rate_of_exposed === null ? undefined : `${data.deadline_miss.miss_rate_of_exposed} % af de ${data.deadline_miss.users_with_deadline}, der havde en deadline`}
              info={<M id="deadline_miss_rate" />} />
            <StatTile label="Missede runder" value={data.deadline_miss.round_miss_rate === null ? "—" : `${data.deadline_miss.round_miss_rate} %`}
              hint={`${data.deadline_miss.rounds_missed} af ${data.deadline_miss.rounds_with_deadline} bruger-runder uden ét eneste tip`}
              info={<M id="deadline_miss_rate" />} />
            <StatTile label="Gennemførte spillerunder (alt tid)" value={data.rounds_completed} info={<M id="rounds_completed" />} />
          </StatGroup>
          <div>
            <SubHead>Completion rate pr. uge <M id="completion_by_week" /></SubHead>
            {/* pct, ikke `pct ?? 0`: en uge uden låste runder har ingen måling
                og skal gråtones, ikke tegnes som et 0 %, der ikke kan skelnes
                fra en uge, hvor ingen tippede. */}
            <MiniBars data={(data.completion_by_week || []).map((r) => ({ key: r.week, value: r.pct }))} color={C.gold} formatLabel={weekLabel} suffix=" %" />
          </div>
          <div>
            <SubHead>Completion rate pr. måned <M id="completion_by_month" /></SubHead>
            <MiniBars data={(data.completion_by_month || []).map((r) => ({ key: r.month, value: r.pct }))} color={C.gold} formatLabel={monthLabel} suffix=" %" />
          </div>
          <div>
            <SubHead>Gennemførte runder pr. uge <M id="rounds_completed_by_week" /></SubHead>
            <MiniBars data={(data.rounds_completed_by_week || []).map((r) => ({ key: r.week, value: r.count }))} color={C.green} formatLabel={weekLabel} />
          </div>
        </div>
      )}
    </Section>
  );
}

export { HealthSection };
