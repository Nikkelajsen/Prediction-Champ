// Admin → Feedback: meldingerne fra brugerne (B14).
//
// Egen fil frem for endnu en sektion i AdminScreen.jsx — samme valg som
// AnalyticsPanel.jsx og OpsPanel.jsx traf, af samme grund.
//
// Panelet svarer på ét spørgsmål: hvad er der kommet ind, som jeg ikke har set
// på endnu? Derfor er "Kun ubehandlede" tændt som udgangspunkt, og derfor er
// markeringen en knap og ikke en note et andet sted: en liste, der kun vokser,
// bliver holdt op med at blive læst.
import { useState, useEffect } from "react";
import { RefreshCw, Loader2, Check, RotateCcw } from "lucide-react";
import { C, btnGhost, chip, muted } from "../ui/theme.js";
import { Card, H } from "../ui/components.jsx";
import { KINDS, loadFeedback, setFeedbackHandled } from "../lib/data/feedback.js";

const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.key, k.label]));

// Tone efter hvad meldingen kræver, ikke efter hvor alvorlig den lyder: kun
// "Noget virker ikke" beskriver noget, der er i stykker lige nu.
const KIND_TONE = { problem: C.red, idea: C.gold, other: C.muted };

function fmtDato(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("da-DK", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function FeedbackRow({ row, onToggle, busy }) {
  const behandlet = !!row.handled_at;
  return (
    <Card style={behandlet ? { opacity: 0.6 } : undefined}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={{ color: KIND_TONE[row.kind] ?? C.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>
          {KIND_LABEL[row.kind] ?? row.kind}
        </span>
        <span style={{ ...muted, fontSize: 11 }}>
          {/* En slettet konto efterlader rækken, men uden navn (on delete set
              null). At skrive det frem for at vise et tomt felt er forskellen
              på "vi ved det ikke" og "ingen skrev den". */}
          {row.display_name || (row.user_id ? "Ukendt bruger" : "Slettet konto")} · {fmtDato(row.created_at)}
        </span>
      </div>

      <p style={{ color: C.text, fontSize: 14, lineHeight: 1.5, margin: "8px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {row.message}
      </p>

      {row.context && Object.keys(row.context).length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ ...muted, fontSize: 11, cursor: "pointer" }}>
            Version {row.context.version || "ukendt"}
            {row.context.screen ? ` · skærm: ${row.context.screen}` : ""}
          </summary>
          {/* Ingen fontFamily: <pre> er monospace i forvejen, og JSON skal
              stå i kolonner. Samme valg som de to i OpsPanel.jsx. */}
          <pre style={{
            fontSize: 10, color: C.muted, whiteSpace: "pre-wrap",
            wordBreak: "break-word", margin: "6px 0 0",
          }}>
            {JSON.stringify(row.context, null, 2)}
          </pre>
        </details>
      )}

      <div style={{ marginTop: 10 }}>
        <button type="button" style={btnGhost} onClick={() => onToggle(row)} disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" />
            : behandlet ? <RotateCcw size={14} /> : <Check size={14} />}
          {behandlet ? "Markér som ubehandlet" : "Markér som behandlet"}
        </button>
      </div>
    </Card>
  );
}

function FeedbackPanel({ token }) {
  const [rows, setRows] = useState(null);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState("");

  async function load(flag = onlyOpen) {
    setLoading(true);
    setErr("");
    try {
      setRows(await loadFeedback(token, { onlyOpen: flag }));
    } catch (e) {
      // Hyppigste årsag lige efter levering: migreringen er ikke kørt endnu.
      // Sig det frem for at vise en rå PostgREST-fejl — samme greb som
      // OpsPanel.jsx bruger til admin_job_health.
      setErr(
        String(e?.message ?? e).includes("admin_feedback")
          ? "Kunne ikke hente feedback. Er sql/feedback.sql kørt i Supabase?"
          : String(e?.message ?? e)
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Samme mønster og samme navngivne undtagelser som OpsPanel: at hente data
    // i en effekt og sætte state er dét, resten af skærmene gør, og `load`
    // genskabes ved hver render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(onlyOpen);
  }, [token, onlyOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle(row) {
    setBusyId(row.id);
    setErr("");
    try {
      await setFeedbackHandled(token, row.id, !row.handled_at);
      await load(onlyOpen);
    } catch (e) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <H>Feedback</H>
        <button type="button" style={btnGhost} onClick={() => load(onlyOpen)} disabled={loading}>
          {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Opdatér
        </button>
      </div>

      <div>
        <button type="button" aria-pressed={onlyOpen} style={chip(onlyOpen)} onClick={() => setOnlyOpen(!onlyOpen)}>
          Kun ubehandlede
        </button>
      </div>

      {err && <p style={{ color: C.red, fontSize: 12, margin: 0 }}>{err}</p>}
      {loading && !rows && <p style={{ ...muted, margin: 0 }}>Henter …</p>}

      {rows && rows.length === 0 && (
        <p style={{ ...muted, margin: 0 }}>
          {onlyOpen ? "Ingen ubehandlede meldinger." : "Ingen meldinger endnu."}
        </p>
      )}

      {rows && rows.map((r) => (
        <FeedbackRow key={r.id} row={r} onToggle={toggle} busy={busyId === r.id} />
      ))}
    </div>
  );
}

export default FeedbackPanel;
export { FeedbackRow, KIND_LABEL };
