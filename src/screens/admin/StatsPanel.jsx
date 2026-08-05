// Admin → Statistik: brugerstatistikken fra `admin_user_stats()`, plus
// fordelingen af konkurrence-typer. Ren flytning ud af `AdminScreen.jsx`
// (G1, august 2026).
//
// `ModeBars` bor her og ikke i `ui/components.jsx`, fordi den kender
// `modeLabel` og dermed konkurrence-domænet — den er panelets egen tegning,
// ikke en genbrugelig primitiv.
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { loadUserStats } from "../../lib/data.js";
import { modeLabel } from "../../lib/scoring.js";
import { C, font, muted } from "../../ui/theme.js";
import { Card, StatTile, StatGroup, MiniBars } from "../../ui/components.jsx";

function ModeBars({ data, total }) {
  if (!data || !data.length) return <p style={{ ...muted, margin: 0 }}>Ingen konkurrencer endnu.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {data.map((d) => {
        const pct = total ? Math.round((d.count / total) * 100) : 0;
        return (
          <div key={d.mode}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
              <span style={{ color: C.text }}>{modeLabel(d.mode)}</span>
              <span style={{ color: C.muted }}>{d.count} · {pct}%</span>
            </div>
            <div style={{ height: 8, background: C.surface2, borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: C.green, borderRadius: 999 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatsPanel({ token }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true); setErr("");
      try { setStats(await loadUserStats(token)); }
      catch (e) { setErr(e.message || "Kunne ikke hente statistik"); }
      setLoading(false);
    })();
  }, [token]);

  if (loading) return <p style={{ ...muted, display: "flex", gap: 8, alignItems: "center" }}><Loader2 size={14} className="spin" /> Henter statistik …</p>;
  if (err) return <p style={{ color: C.red, fontSize: 13 }}>Fejl: {err}</p>;
  if (!stats) return null;

  const s = stats;
  const stickiness = s.mau ? Math.round((s.dau / s.mau) * 100) : 0;
  const signups = (s.signups_by_week || []).map((r) => ({ key: r.week, value: r.count }));
  const actives = (s.active_by_day || []).map((r) => ({ key: r.day, value: r.count }));
  const weekLabel = (iso) => { const d = new Date(iso); return d.toLocaleDateString("da-DK", { day: "numeric", month: "short" }); };
  const dayLabel = (iso) => { const d = new Date(iso); return d.toLocaleDateString("da-DK", { weekday: "short", day: "numeric", month: "short" }); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <StatGroup title="Brugere">
        <StatTile label="Brugere i alt" value={s.total} />
        <StatTile label="Nye seneste 30 dage" value={s.new_30d} hint={`heraf ${s.new_7d} seneste 7 dage`} />
      </StatGroup>

      <StatGroup title="Aktivitet">
        <StatTile label="Aktive i dag" value={s.dau} />
        <StatTile label="Aktive seneste 7 dage" value={s.wau} />
        <StatTile label="Aktive seneste 30 dage" value={s.mau} />
        {/* DAU/MAU er stickiness ("hvor stor en del af månedens brugere er her i dag"),
            ikke fastholdelse. Variablen hed rigtigt hele tiden — kun etiketten var forkert. */}
        <StatTile label="Stickiness (DAU/MAU)" value={`${stickiness}%`} hint={`gns. ${s.avg_active_days_30d} aktive dage/bruger`} />
      </StatGroup>

      <StatGroup title="Engagement">
        <StatTile label="Har afgivet mindst ét tip" value={s.has_predicted} hint={s.total ? `${Math.round((s.has_predicted / s.total) * 100)}% af alle` : undefined} />
        <StatTile label="Gns. tips pr. bruger" value={s.avg_predictions} />
        <StatTile label="Med i en privat konkurrence" value={s.in_private_league} />
      </StatGroup>

      <StatGroup title="Frafald">
        <StatTile label="Har aldrig tippet" value={s.never_predicted} />
        <StatTile label="Inaktive i 30+ dage" value={s.inactive_30d} />
      </StatGroup>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <div style={{ fontFamily: font.display, fontWeight: 700, textTransform: "uppercase", fontSize: 15 }}>Konkurrencer</div>
          <div style={{ fontFamily: font.display, fontWeight: 700, fontSize: 22, color: C.text }}>{s.competitions_total ?? 0}</div>
        </div>
        <ModeBars data={s.competitions_by_mode || []} total={s.competitions_total || 0} />
        <p style={{ ...muted, margin: "12px 0 0" }}>Kun private konkurrencer — de officielle (månedschampionship m.fl.) tælles ikke med.</p>
      </Card>

      <Card>
        <div style={{ fontFamily: font.display, fontWeight: 700, textTransform: "uppercase", fontSize: 15, marginBottom: 10 }}>Nye tilmeldinger pr. uge</div>
        <MiniBars data={signups} color={C.gold} formatLabel={weekLabel} />
        <p style={{ ...muted, margin: "8px 0 0" }}>Seneste ~12 uger.</p>
      </Card>

      <Card>
        <div style={{ fontFamily: font.display, fontWeight: 700, textTransform: "uppercase", fontSize: 15, marginBottom: 10 }}>Aktive brugere pr. dag</div>
        <MiniBars data={actives} color={C.green} formatLabel={dayLabel} />
        <p style={{ ...muted, margin: "8px 0 0" }}>Seneste 30 dage. Aktivitet begynder først at tælle fra denne funktion blev taget i brug.</p>
      </Card>
    </div>
  );
}

// Brugerlisten og den ene handling, der hører til den: at lukke en konto.
//
// Fanen findes, fordi kontolukning indtil nu KUN kunne udføres af brugeren selv
// (B4). Ved misbrug — spam-navne, en konto oprettet for at genere en liga — var
// den eneste udvej at gå i Supabases egen konsol, altså uden for produktet og
// uden om anonymiseringen. Det efterlod en halv tilstand: kontoen lukket, men
// navnet og sporene stående.
//
// Listen viser ikke tips-tal. Det ville kræve en aggregering over hele
// `predictions` for hver visning, og beslutningen "skal denne konto lukkes"
// træffes på navnet og aktiviteten — ikke på et pointtal. Skal man vide mere,
// er brugerens profil ét klik væk i appen.

export default StatsPanel;
