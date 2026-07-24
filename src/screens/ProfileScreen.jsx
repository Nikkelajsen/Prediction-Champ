// Karriereprofil v1 — brugerens karriere som fortælling (titler → milepæle →
// ratingkurve → rivaler), med rå basistal diskret nederst. Spec:
// docs/features/karriereprofil-v1.md. Drill-in-skærm (som BoardScreen).
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { loadCareerProfile, loadCareerMilestones, monthName } from "../lib/data.js";
import { C, font } from "../ui/theme.js";
import { BackBar, Card, Eyebrow, Move } from "../ui/components.jsx";

// Letvægts ratingkurve (ingen chart-bibliotek, jf. spec). Én prik pr. runde.
// De første <5 runder (provisorisk K-faktor) tegnes dæmpet/stiplet.
function Sparkline({ curve }) {
  if (!curve || curve.length < 2) return null;
  const W = 300, Hgt = 90, pad = 8;
  const vals = curve.map((p) => p.rating_after);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const n = curve.length;
  const x = (i) => pad + (i * (W - 2 * pad)) / (n - 1);
  const y = (v) => pad + (1 - (v - min) / span) * (Hgt - 2 * pad);
  const PROV = 5; // foreløbig periode = de første 5 runder
  const provEnd = Math.min(PROV, n); // antal provisoriske punkter (1-indekseret grænse)

  // to polyline-segmenter: provisorisk (dæmpet, stiplet) og fast (guld)
  const provPts = curve.slice(0, provEnd).map((p, i) => `${x(i).toFixed(1)},${y(p.rating_after).toFixed(1)}`).join(" ");
  const firmStart = Math.max(0, provEnd - 1); // overlap ét punkt så linjen hænger sammen
  const firmPts = curve.slice(firmStart).map((p, i) => `${x(firmStart + i).toFixed(1)},${y(p.rating_after).toFixed(1)}`).join(" ");

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${Hgt}`} width="100%" height={Hgt} preserveAspectRatio="none" style={{ display: "block" }}>
        {provEnd >= 2 && (
          <polyline points={provPts} fill="none" stroke={C.muted} strokeWidth="1.6" strokeDasharray="3 3" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {n - firmStart >= 2 && (
          <polyline points={firmPts} fill="none" stroke={C.gold} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {curve.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.rating_after)} r={i < PROV ? 2 : 2.6}
            fill={i < PROV ? C.muted : C.gold} />
        ))}
      </svg>
    </div>
  );
}

function ProfileScreen({ token, viewerUserId, profileUserId, onBack }) {
  const isOwn = profileUserId === viewerUserId;
  const [data, setData] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError("");
      try {
        const [profile, ms] = await Promise.all([
          loadCareerProfile(token, profileUserId),
          loadCareerMilestones(token, profileUserId, isOwn),
        ]);
        if (cancelled) return;
        setData(profile); setMilestones(ms);
      } catch (e) {
        if (cancelled) return;
        const msg = String(e?.message || e).toLowerCase();
        setError(msg.includes("forbidden")
          ? "Du kan kun se profiler for brugere, du deler en liga eller konkurrence med."
          : "Kunne ikke hente profilen lige nu. Prøv igen om lidt.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, profileUserId, isOwn]);

  if (loading) {
    return (
      <div>
        <BackBar title="Karriere" onBack={onBack} />
        <div style={{ display: "flex", gap: 10, color: C.muted, alignItems: "center", paddingTop: 20 }}>
          <Loader2 className="spin" size={18} />Henter profil …
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <BackBar title="Karriere" onBack={onBack} />
        <Card><span style={{ color: C.muted, fontSize: 14, lineHeight: 1.5 }}>{error}</span></Card>
      </div>
    );
  }

  const head = data?.head || {};
  const titles = data?.titles || { monthly: [], round_wins: 0 };
  const monthly = titles.monthly || [];
  const roundWins = titles.round_wins || 0;
  const curve = data?.curve || [];
  const base = data?.base || { total_points: 0, exact_count: 0, outcome_count: 0, matches: 0 };
  const rivals = data?.rivals || [];

  const memberSince = head.created_at ? monthName(String(head.created_at).slice(0, 7)) : null;
  const hitRate = base.matches > 0 ? Math.round((base.exact_count / base.matches) * 100) : 0;

  const hasTitles = monthly.length > 0 || roundWins > 0;
  const hasMilestones = isOwn && milestones.length > 0;
  const hasCurve = curve.length >= 2;
  // "Karriere lige begyndt": ingen titler, ingen milepæle og for lidt kurve.
  const isEmpty = !hasTitles && !hasMilestones && !hasCurve;

  const badge = {
    display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(240,180,41,0.12)",
    border: `1px solid ${C.gold}`, color: C.gold, borderRadius: 999,
    padding: "6px 12px", fontSize: 13, fontWeight: 700, fontFamily: font.body,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BackBar title="Karriere" onBack={onBack} />

      {/* Hoved */}
      <Card>
        <Eyebrow>{isOwn ? "Din karriere" : "Karriere"}</Eyebrow>
        <div style={{ fontFamily: font.display, textTransform: "uppercase", fontWeight: 700, fontSize: 28, lineHeight: 1.1 }}>
          {head.display_name || "—"}{isOwn ? <span style={{ color: C.muted, fontSize: 16 }}> (dig)</span> : ""}
        </div>
        {memberSince && <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Medlem siden {memberSince}</div>}
        {head.rating != null && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 12 }}>
            <span style={{ color: C.muted, fontSize: 12, fontFamily: font.display, textTransform: "uppercase", letterSpacing: "0.08em" }}>Rating</span>
            <span style={{ fontFamily: font.display, fontSize: 34, fontWeight: 700 }}>
              {head.rating}
              {head.provisional && <span style={{
                marginLeft: 8, fontSize: 11, color: C.gold, border: `1px solid ${C.gold}`,
                borderRadius: 4, padding: "1px 5px", verticalAlign: "middle",
              }}>NY</span>}
            </span>
            <Move d={head.move || 0} />
          </div>
        )}
      </Card>

      {isEmpty && (
        <Card>
          <span style={{ color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
            {isOwn
              ? "Din karriere er lige begyndt — den første runde skriver det første kapitel."
              : "Karrieren er lige begyndt — den første runde skriver det første kapitel."}
          </span>
        </Card>
      )}

      {/* Titler */}
      {hasTitles && (
        <div>
          <Eyebrow>Titler</Eyebrow>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {monthly.map((t) => (
              <span key={t.month} style={badge} title={`${t.points} point`}>
                👑 Månedens Prediction Champ — {t.month_name}
              </span>
            ))}
            {roundWins > 0 && (
              <span style={badge}>🥇 {roundWins} {roundWins === 1 ? "rundesejr" : "rundesejre"}</span>
            )}
          </div>
        </div>
      )}

      {/* Milepæle (kun egen profil) */}
      {hasMilestones && (
        <div>
          <Eyebrow>Milepæle</Eyebrow>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {milestones.map((m) => (
              <Card key={m.id} style={{ padding: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{m.headline}</div>
                {m.body && <div style={{ color: C.muted, fontSize: 13, marginTop: 3, lineHeight: 1.45 }}>{m.body}</div>}
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Ratingkurve */}
      {hasCurve && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase" }}>Ratingkurve</div>
            <span style={{ color: C.muted, fontSize: 12 }}>{curve.length} runder</span>
          </div>
          <Sparkline curve={curve} />
          <p style={{ color: C.muted, fontSize: 11, marginTop: 8, marginBottom: 0 }}>
            Rating efter hver runde. ● grå/stiplet = foreløbig periode (under 5 runder).
          </p>
        </Card>
      )}

      {/* Rivaler (kun egen profil) */}
      {isOwn && rivals.length > 0 && (
        <div>
          <Eyebrow>Rivaler</Eyebrow>
          <Card>
            <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6 }}>
              Din tætteste rival: <b style={{ color: C.gold }}>{rivals[0].rival}</b> — I har krydset klinger {rivals[0].count} {rivals[0].count === 1 ? "gang" : "gange"}.
            </div>
            {rivals.length > 1 && (
              <div style={{ color: C.muted, fontSize: 13, marginTop: 8 }}>
                Andre rivaler: {rivals.slice(1).map((r) => `${r.rival} (${r.count})`).join(" · ")}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Basistal (diskret, nederst) */}
      <Card style={{ padding: 12, background: "transparent", borderStyle: "dashed" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", color: C.muted, fontSize: 12 }}>
          <span><b style={{ color: C.text }}>{base.total_points}</b> point</span>
          <span>🎯 <b style={{ color: C.text }}>{base.exact_count}</b> præcise</span>
          <span><b style={{ color: C.text }}>{hitRate}%</b> træfsikkerhed</span>
          <span><b style={{ color: C.text }}>{base.matches}</b> tippede kampe</span>
        </div>
      </Card>
    </div>
  );
}

export default ProfileScreen;
