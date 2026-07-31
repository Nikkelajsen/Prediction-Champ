// Admin → Drift: hvordan har de planlagte jobs det?
//
// Egen fil frem for endnu en sektion i AdminScreen.jsx (307 linjer, noteret
// som teknisk gæld i DOCUMENTATION.md afsnit 12) — samme valg som
// AnalyticsPanel.jsx traf.
//
// Panelet svarer på ét spørgsmål: kører jobbene? Registeret over hvilke jobs
// der SKAL findes, står i docs/CRON.md, og tavshedsgrænserne er de samme som i
// .github/workflows/job-heartbeat.yml. Denne skærm er den hurtige aflæsning;
// heartbeat-workflowen er den, der råber, når ingen kigger.
import { useState, useEffect } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { C, btnGhost, font, muted } from "../ui/theme.js";
import { Card, H, StateChip, SignalRow } from "../ui/components.jsx";
import { loadJobHealth, mergeJobHealth, STATE_LABEL, fmtSince } from "../lib/ops.js";

// Tonen følger StateChips regel: ORDET er signalet, farven er kun ekstra.
// "Ingen kørsler" får bevidst ingen tone — "vi ved det ikke" må ikke kunne
// forveksles med "det er fint".
const TONE = { ok: "green", ustabil: "gold", fejler: "red", tavs: "red", ukendt: null };

function JobCard({ j }) {
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <div style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>{j.label}</div>
          <div style={{ ...muted, fontSize: 11 }}>
            {j.job} · forventet {j.kadence}
          </div>
        </div>
        <StateChip label={STATE_LABEL[j.state]} tone={TONE[j.state]} />
      </div>

      <div style={{ marginTop: 8 }}>
        <SignalRow label="Sidste kørsel" value={fmtSince(j.silentFor)} />
        <SignalRow label="Sidste vellykkede" value={j.lastOkAt ? fmtSince(j.okSilentFor) : "aldrig"} />
        <SignalRow
          label="Fejl i træk"
          value={j.failures}
          detail={j.failures >= 3 ? "→ heartbeat slår alarm" : undefined}
        />
      </div>

      {j.state === "ukendt" && (
        <p style={{ ...muted, fontSize: 11, marginTop: 8, marginBottom: 0 }}>
          Jobbet har aldrig meldt sig. Enten er <code>sql/job_runs.sql</code> ikke kørt endnu, eller
          også findes jobbet ikke i cron-job.org — se <code>docs/CRON.md</code>.
        </p>
      )}

      {j.state === "tavs" && (
        <p style={{ color: C.red, fontSize: 11, marginTop: 8, marginBottom: 0 }}>
          Jobbet har ikke meldt sig længe nok til, at noget er galt. Tjek først, om cron-job.org har
          deaktiveret det efter gentagne fejl — et deaktiveret job skriver ingenting og ligner ro.
        </p>
      )}

      {j.lastError && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ ...muted, fontSize: 11, cursor: "pointer" }}>Seneste fejl</summary>
          <pre
            style={{
              ...font,
              fontSize: 10,
              color: C.muted,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: "6px 0 0",
              maxHeight: 160,
              overflowY: "auto",
            }}
          >
            {j.lastError}
          </pre>
        </details>
      )}

      {j.lastDetail && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ ...muted, fontSize: 11, cursor: "pointer" }}>Seneste resumé</summary>
          <pre
            style={{
              ...font,
              fontSize: 10,
              color: C.muted,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: "6px 0 0",
            }}
          >
            {JSON.stringify(j.lastDetail, null, 2)}
          </pre>
        </details>
      )}
    </Card>
  );
}

function OpsPanel({ token }) {
  const [jobs, setJobs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    setErr("");
    try {
      setJobs(mergeJobHealth(await loadJobHealth(token)));
    } catch (e) {
      // Den hyppigste årsag lige efter levering er, at migreringen ikke er kørt
      // endnu — så sig det frem for at vise en rå PostgREST-fejl.
      setErr(
        String(e?.message ?? e).includes("admin_job_health")
          ? "Kunne ikke læse driftsdata. Er sql/job_runs.sql kørt i Supabase?"
          : String(e?.message ?? e)
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Hent-ved-montering. Reglerne nedenfor slås fra med vilje og med navn —
    // modsat de 25 bare `// eslint-disable-line` andre steder i src/, som
    // slår ALT fra på deres linje og er selvstændig gæld:
    //   set-state-in-effect: at hente data i en effekt og sætte state er
    //     præcis det mønster, resten af skærmene bruger. At undgå den regel
    //     kræver et data-bibliotek, projektet bevidst ikke har.
    //   exhaustive-deps: `load` genskabes ved hver render og ville få
    //     effekten til at løbe i ring, hvis den stod i afhængighederne.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <H>Planlagte jobs</H>
        <button style={btnGhost} onClick={load} disabled={loading}>
          {loading ? <Loader2 size={14} /> : <RefreshCw size={14} />} Opdatér
        </button>
      </div>

      <p style={{ ...muted, fontSize: 12, margin: 0 }}>
        Jobbene kører på cron-job.org uden for appen. Registeret over dem står i{" "}
        <code>docs/CRON.md</code>. Et job, der er blevet deaktiveret, skriver ingen rækker — derfor
        vises "Tavs" ud fra hvor længe siden det sidst meldte sig, ikke ud fra en fejl.
      </p>

      {err && <p style={{ color: C.red, fontSize: 12, margin: 0 }}>{err}</p>}
      {loading && !jobs && <p style={{ ...muted, margin: 0 }}>Henter …</p>}

      {jobs && jobs.map((j) => <JobCard key={j.job} j={j} />)}
    </div>
  );
}

export default OpsPanel;
export { JobCard };
