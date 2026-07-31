// Sektion 4: retention som kohortematrix.

import { loadAnalyticsRetention } from "../../lib/analytics.js";

import { muted } from "../../ui/theme.js";
import { StatTile, PctGrid } from "../../ui/components.jsx";
import { M, Section, SubHead, Grid2, useSection, dtFmt } from "./shared.jsx";

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
    <Section title="Retention" subtitle="Uafhængig af vinduesvælgeren — milepælene måles fra hver brugers eller ligas egen oprettelse." loading={loading} err={err}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <SubHead>Brugere <M id="user_retention" /></SubHead>
          <Grid2>
            {userRows.map((r) => (
              <StatTile key={r.wk} label={`Uge ${r.wk}`} value={r.disabled ? "—" : `${r.pct} %`}
                hint={r.disabled ? "Ingen data endnu" : `${r.retained} af ${r.eligible}`} />
            ))}
          </Grid2>
        </div>
        <div>
          <SubHead>Ligaer <M id="league_retention_agg" /></SubHead>
          <Grid2>
            {leagueRows.map((r) => (
              <StatTile key={r.wk} label={`Uge ${r.wk}`} value={r.disabled ? "—" : `${r.pct} %`}
                hint={r.disabled ? "Ingen data endnu" : `${r.retained} af ${r.eligible}`} />
            ))}
          </Grid2>
        </div>
        {cohortRows.length > 0 && (
          <div>
            <SubHead>Seneste kohorter (brugere, pr. tilmeldingsuge) <M id="user_cohorts" /></SubHead>
            <PctGrid columns={cohortColumns} rows={cohortRows} />
          </div>
        )}
        <p style={{ ...muted, margin: 0 }}>
          Aktivitetstal begynder først at samle sig fra {since ? dtFmt(since) : "…"} — en milepæl, hvis vindue åbner før dén dato, vises som "Ingen data endnu", ALDRIG som et forkert 0 %.
        </p>
      </div>
    </Section>
  );
}

// ---------- Top-level panel ----------

export { RetentionSection };
