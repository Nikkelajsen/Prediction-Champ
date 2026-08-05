// Admin-skærmen (kun for is_admin): fanevælgeren og "Opdater ratings" — intet
// andet. Hentes først, når den åbnes — se lazy() i MainApp.
//
// De syv paneler bor hver for sig (`./admin/` for de fire, der før lå her, plus
// AnalyticsPanel, OpsPanel og FeedbackPanel, som allerede gjorde). Opdelingen er
// `G1`s halvdel af filen (august 2026) og en ren flytning: panelerne delte
// hverken state eller hjælpere, kun fil. Det, der er tilbage her, ER skærmen —
// hvilken fane er valgt, og den ene handling, der gælder på tværs.
import { useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { restFetch } from "../lib/supabase.js";
import { btnGhost, chip, muted } from "../ui/theme.js";
import { BackBar } from "../ui/components.jsx";
import MatchesPanel from "./admin/MatchesPanel.jsx";
import ResultsPanel from "./admin/ResultsPanel.jsx";
import StatsPanel from "./admin/StatsPanel.jsx";
import UsersPanel from "./admin/UsersPanel.jsx";
import AnalyticsPanel from "./AnalyticsPanel.jsx";
import OpsPanel from "./OpsPanel.jsx";
import FeedbackPanel from "./FeedbackPanel.jsx";

function AdminScreen({ token, leagues, reloadLeagues, onBack }) {
  const [sub, setSub] = useState("matches");
  const [recomputing, setRecomputing] = useState(false);
  const [msg, setMsg] = useState("");

  async function recompute() {
    setRecomputing(true); setMsg("");
    try {
      // admin_recompute_ratings, ikke recompute_ratings: motoren er service_role-only
      // siden G15 (sql/security_hardening.sql). Wrapperen har is_admin-tjekket og er
      // den eneste vej ind for et brugertoken.
      await restFetch(`/rest/v1/rpc/admin_recompute_ratings`, { method: "POST", token, body: {} });
      setMsg("Ratings opdateret.");
    } catch (e) { setMsg("Fejl: " + (e.message || "kunne ikke opdatere")); }
    setRecomputing(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BackBar title="Admin" onBack={onBack} right={
        <button style={btnGhost} onClick={recompute} disabled={recomputing}>
          {recomputing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Opdater ratings
        </button>
      } />
      {msg && <p style={{ ...muted, margin: 0 }}>{msg}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={chip(sub === "matches")} onClick={() => setSub("matches")}>Kampe</button>
        <button style={chip(sub === "results")} onClick={() => setSub("results")}>Resultater</button>
        <button style={chip(sub === "stats")} onClick={() => setSub("stats")}>Statistik</button>
        <button style={chip(sub === "users")} onClick={() => setSub("users")}>Brugere</button>
        <button style={chip(sub === "analytics")} onClick={() => setSub("analytics")}>Analytics</button>
        <button style={chip(sub === "ops")} onClick={() => setSub("ops")}>Drift</button>
        <button style={chip(sub === "feedback")} onClick={() => setSub("feedback")}>Feedback</button>
      </div>
      {sub === "matches" && <MatchesPanel token={token} leagues={leagues} reloadLeagues={reloadLeagues} />}
      {sub === "results" && <ResultsPanel token={token} leagues={leagues} />}
      {sub === "stats" && <StatsPanel token={token} />}
      {sub === "users" && <UsersPanel token={token} />}
      {sub === "analytics" && <AnalyticsPanel token={token} />}
      {sub === "ops" && <OpsPanel token={token} leagues={leagues} />}
      {sub === "feedback" && <FeedbackPanel token={token} />}
    </div>
  );
}

export default AdminScreen;
