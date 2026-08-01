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
import { RefreshCw, Loader2, Eye } from "lucide-react";
import { C, btnGhost, font, muted } from "../ui/theme.js";
import { Card, H, StateChip, SignalRow } from "../ui/components.jsx";
import {
  loadJobHealth,
  mergeJobHealth,
  previewNotifications,
  summarizeOutbox,
  STATE_LABEL,
  fmtSince,
} from "../lib/ops.js";

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

// Forhåndsvisning af notifikations-outboxen (?dryRun=true).
//
// Kortet er en LÆSNING og ikke en handling: der sendes intet, reserveres intet
// i notification_log og skrives ingen række i job_runs. Derfor den dæmpede
// knap — den skal ikke kunne forveksles med de knapper, der ændrer noget.
//
// Det er også den eneste vej til en forhåndsvisning uden SYNC_SECRET. Behovet
// blev fundet under G51 (august 2026), hvor den falske runde-besked skulle
// efterprøves, og den eneste vej var at hente hemmeligheden i Vercel og kalde
// endpointet i hånden.
function PreviewCard({ token }) {
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");

  async function run() {
    setLoading(true);
    setErr("");
    setRes(null);
    try {
      setRes(await previewNotifications(token));
    } catch (e) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 60%", minWidth: 0 }}>
          <div style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>Forhåndsvis notifikationer</div>
          <div style={{ ...muted, fontSize: 11 }}>
            Viser hvad næste kørsel ville sende. Sender intet, reserverer intet.
          </div>
        </div>
        <button style={btnGhost} onClick={run} disabled={loading}>
          {loading ? <Loader2 size={14} className="spin" /> : <Eye size={14} />} Vis hvad der venter
        </button>
      </div>

      {err && <p style={{ color: C.red, fontSize: 12, margin: "10px 0 0" }}>{err}</p>}

      {res && <OutboxPreview res={res} />}
    </Card>
  );
}

// Selve aflæsningen, skilt fra knappen så den kan afprøves uden et klik.
// Delingen er ikke kosmetisk: hele værdien af kortet ligger i de to
// formuleringer nedenfor, og den ene af dem er kontraintuitiv.
function OutboxPreview({ res }) {
  const rows = summarizeOutbox(res.wouldSend);
  return (
    <div style={{ marginTop: 10 }}>
      {/* Noten kommer fra endpointet og skrives ikke om her — den er også
          stedet, hvor "klokken er uden for sendevinduet" bliver sagt, og den
          formulering skal kun findes ét sted. */}
      <p style={{ ...muted, fontSize: 11, margin: 0 }}>{res.note}</p>

      {rows.length === 0 ? (
        // Forbeholdet er hele grunden til, at tomheden kan læses forkert:
        // wouldSend er filtreret mod notification_log, så en allerede sendt
        // besked er usynlig her. Uden sætningen ville "ingen beskeder venter"
        // se ud som "der er ikke noget at sende" — to forskellige ting.
        <p style={{ ...muted, fontSize: 12, margin: "8px 0 0" }}>
          Ingen beskeder venter. Bemærk: listen er filtreret mod <code>notification_log</code>, så
          tom betyder <em>intet nyt</em> — ikke, at der intet findes.
        </p>
      ) : (
        <div style={{ marginTop: 8 }}>
          {rows.map((r) => (
            <div key={r.key} style={{ borderTop: `1px solid ${C.surface2}`, padding: "8px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span style={{ color: C.gold, fontSize: 11, fontWeight: 700 }}>{r.kindLabel}</span>
                <span style={{ ...muted, fontSize: 11 }}>
                  {r.recipients} {r.recipients === 1 ? "modtager" : "modtagere"}
                </span>
              </div>
              <div style={{ color: C.text, fontSize: 13, fontWeight: 600, marginTop: 2 }}>{r.title}</div>
              <div style={{ ...muted, fontSize: 12 }}>{r.body}</div>
              <code style={{ ...muted, fontSize: 10 }}>{r.key}</code>
            </div>
          ))}
        </div>
      )}
    </div>
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

      <PreviewCard token={token} />
    </div>
  );
}

export default OpsPanel;
export { JobCard, PreviewCard, OutboxPreview };
