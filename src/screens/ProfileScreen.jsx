// Karriereprofil v1 — brugerens karriere som fortælling (titler → milepæle →
// ratingkurve → rivaler), med rå basistal diskret nederst. Spec:
// docs/features/karriereprofil-v1.md. Drill-in-skærm (som BoardScreen).
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { loadCareerProfile, loadCareerMilestones, monthName } from "../lib/data.js";
import { roundLabel } from "../lib/scoring.js";
import { C, font } from "../ui/theme.js";
import { BackBar, Card, Eyebrow, InfoDot, Move } from "../ui/components.jsx";

// Karriereskærmen blander bevidst TO omfang, og det var ikke til at se på den:
// Titler, Rekorder og basistallene er globale (Championship + global rating —
// alle brugere er med), mens Milepælene er øjeblikke fra brugerens egne
// konkurrencer. En bruger læste derfor "8. plads" som en placering i én af sine
// egne konkurrencer. Hvert afsnit siger nu sit omfang med en synlig linje —
// ikke kun bag en InfoDot, som skal klikkes for at hjælpe.
const scopeNote = { color: C.muted, fontSize: 12, lineHeight: 1.45, marginTop: -2, marginBottom: 6 };

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

// Feature 1 (K4): narrativ H2H-sætning ved fremmed profil. Vises uanset om
// viewer fører eller taber — kun tælletal, ingen superlativer ("aldrig",
// "værst"). Se sql/career_profile.sql for begrundelsen.
//
// Sætningen navngiver sit eget omfang ("I jeres fælles konkurrencer"): tallet
// dækker KUN kampe fra konkurrencer, begge er deltager i — ikke hele
// Championship, og ikke alt hvad de hver især har tippet. Uden den indledning
// læses "I har mødt hinanden 12 gange" som en global opgørelse.
export function h2hSentence(h2h, name) {
  const { meetings, wins, losses, draws } = h2h;
  const drawNote = draws > 0 ? ` (${draws} uafgjort)` : "";
  const lead = `I jeres fælles konkurrencer har I mødt hinanden ${meetings} ${meetings === 1 ? "gang" : "gange"}`;
  if (wins > losses) return `${lead} — du fører ${wins}-${losses}${drawNote}.`;
  if (wins < losses) return `${lead} — ${name} fører ${losses}-${wins}${drawNote}.`;
  return `${lead} — I står lige, ${wins}-${losses}${drawNote}.`;
}

// Normaliserer `records`-nøglen til præcis det, Rekorder-sektionen skal vise.
// Ren funktion, så reglerne kan enhedstestes uden at rendere skærmen.
export function recordFacts(records, currentRating) {
  const r = records || {};
  const bestRating = r.best_rating ?? null;
  const rank = r.best_round_rank ?? null;
  const field = r.best_round_rank_field ?? null;
  const streak = r.longest_round_streak || 0;

  // Rundeplaceringen vises kun, når den ikke er 1 — nr. 1 er redundant med
  // "🥇 N rundesejre"-badget under Titler.
  const showRank = rank != null && rank > 1;

  // Feltstørrelsen ("af 34") er det, der gør rangen læsbar — men den må ALDRIG
  // afsløre en sidsteplads: "8. plads af 8" er en bundplacering, og profilen
  // viser aldrig bundplaceringer (karriereprofil-v1.md §1, punkt 3). Ved
  // rank >= field falder linjen tilbage til rangen alene. Feltet mangler også,
  // indtil migreringen er kørt i produktion — samme, tomme udfald.
  const showField = showRank && field != null && rank < field;

  // Ratingtoppen får sin runde med, når round_key ser ud som en rundenøgle
  // (uge-startdato). Feltet fandtes allerede i RPC-svaret uden at blive vist —
  // "1247" alene siger ikke, hvornår toppen blev sat.
  const round = r.best_rating_round;
  const bestRatingRound = typeof round === "string" && /^\d{4}-\d{2}-\d{2}$/.test(round)
    ? roundLabel(round) : null;

  return {
    bestRating,
    bestRatingIsCurrent: bestRating != null && currentRating === bestRating,
    bestRatingRound,
    rank: showRank ? rank : null,
    rankCount: r.best_round_rank_count || 0,
    rankField: showField ? field : null,
    streak: streak >= 2 ? streak : 0,
    hasAny: bestRating != null || showRank || streak >= 2,
  };
}

const MILESTONE_PAGE = 20;

function ProfileScreen({ token, viewerUserId, profileUserId, onBack }) {
  const isOwn = profileUserId === viewerUserId;
  const [data, setData] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [milestoneExpanded, setMilestoneExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(""); setMilestoneExpanded(false);
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
        setError(msg.includes("not found")
          ? "Profilen findes ikke længere."
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
  const records = data?.records || {};
  const footprint = data?.footprint || { leagues: 0, competitions: 0 };

  const memberSince = head.created_at ? monthName(String(head.created_at).slice(0, 7)) : null;
  const hitRate = base.matches > 0 ? Math.round((base.exact_count / base.matches) * 100) : 0;

  const rec = recordFacts(records, head.rating);
  const hasRecords = rec.hasAny;

  const visibleMilestones = milestoneExpanded ? milestones : milestones.slice(0, MILESTONE_PAGE);

  const hasTitles = monthly.length > 0 || roundWins > 0;
  const hasMilestones = isOwn && milestones.length > 0;
  const hasCurve = curve.length >= 2;
  const hasH2H = !isOwn && !!data?.h2h;
  // "Karriere lige begyndt": ingen titler, ingen milepæle, rekorder, H2H og for lidt kurve.
  const isEmpty = !hasTitles && !hasMilestones && !hasCurve && !hasRecords && !hasH2H;

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
        <Eyebrow>{isOwn ? "Din karriere" : "Karriere"} <InfoDot title="Karriere">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>Din karriere <b>nulstilles aldrig</b> — den følger dig på tværs af sæsoner, ligaer og turneringer.</div>
            <div>Her samles rating over tid, titler fra Championship, dine milepæle og dine tætteste rivaler.</div>
            <div>Du kan åbne alle andres karriere ved at trykke på deres navn — hvor som helst i appen.</div>
          </div>
        </InfoDot></Eyebrow>
        <div style={{ fontFamily: font.display, textTransform: "uppercase", fontWeight: 700, fontSize: 28, lineHeight: 1.1 }}>
          {head.display_name || "—"}{isOwn ? <span style={{ color: C.muted, fontSize: 16 }}> (dig)</span> : ""}
        </div>
        {memberSince && <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Medlem siden {memberSince}</div>}
        {(footprint.leagues > 0 || footprint.competitions > 0) && (
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>
            Har spillet i {footprint.leagues} {footprint.leagues === 1 ? "liga" : "ligaer"} og{" "}
            {footprint.competitions} {footprint.competitions === 1 ? "konkurrence" : "konkurrencer"}
          </div>
        )}
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

      {/* H2H (kun fremmed profil, delt konkurrence) */}
      {hasH2H && (
        <Card>
          <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6 }}>
            {h2hSentence(data.h2h, head.display_name)}
          </div>
          <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.45, marginTop: 6 }}>
            Runde for runde, kun kampe fra konkurrencer I begge er med i — hver runde tæller én gang.
          </div>
        </Card>
      )}

      {isEmpty && (
        <Card>
          <span style={{ color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
            {isOwn
              ? "Din karriere er lige begyndt — den første runde skriver det første kapitel."
              : "Karrieren er lige begyndt — den første runde skriver det første kapitel."}
          </span>
        </Card>
      )}

      {/* Titler — globalt omfang, ligesom Rekorder nedenfor */}
      {hasTitles && (
        <div>
          <Eyebrow>Titler · Championship</Eyebrow>
          <p style={scopeNote}>
            Fra Championships måneds- og rundeliga, hvor alle brugere automatisk er med — ikke fra egne konkurrencer.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {monthly.map((t) => (
              <span key={t.month} style={badge} title={`${t.points} point`}>
                👑 Månedens Prediction Champ — {t.month_name}
              </span>
            ))}
            {roundWins > 0 && (
              <span style={badge} title="Runder vundet i Championships rundeliga">
                🥇 {roundWins} {roundWins === 1 ? "rundesejr" : "rundesejre"} i rundeligaen
              </span>
            )}
          </div>
        </div>
      )}

      {/* Rekorder ("bedste nogensinde") — GLOBALT omfang: Championship + global
          rating, ikke brugerens egne konkurrencer. Første forsøg på at gøre det
          klart var en InfoDot alene; den var både skjult bag et klik OG upræcis
          ("på tværs af alle dine konkurrencer og ligaer" læses som en opgørelse
          PR. egen konkurrence, hvor rangen faktisk måles mod samtlige brugere i
          rundeligaen). Nu navngiver hver linje sin egen kilde. */}
      {hasRecords && (
        <div>
          <Eyebrow>Rekorder · Championship <InfoDot title="Rekorder">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>Rekorderne kommer fra <b>Championship</b> og din <b>globale rating</b> — de to steder, hvor <b>alle brugere</b> automatisk er med.</div>
              <div>Rundeplacering og stime måles i <b>Championships rundeliga</b>, altså mod samtlige brugere med point i runden — ikke mod deltagerne i én af dine egne konkurrencer.</div>
              <div>Ratingen er den samme, du ser på <b>Rating-fanen</b> (én global rating på tværs af alle konkurrencer og turneringer).</div>
              <div><b>Milepælene</b> nedenfor er derimod konkrete øjeblikke, de fleste i en navngiven konkurrence.</div>
            </div>
          </InfoDot></Eyebrow>
          <p style={scopeNote}>
            Championship og global rating — hvor alle brugere er med. Ikke dine egne konkurrencer.
          </p>
          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14, color: C.text, lineHeight: 1.6 }}>
              {rec.bestRating != null && (
                <div>
                  {rec.bestRatingIsCurrent
                    ? <>Du er på din <b style={{ color: C.gold }}>højeste globale rating nogensinde</b> lige nu: {rec.bestRating}.</>
                    : <>Din højeste globale rating nogensinde: <b style={{ color: C.gold }}>{rec.bestRating}</b>
                        {rec.bestRatingRound ? <span style={{ color: C.muted }}> — sat efter runden {rec.bestRatingRound}</span> : null}.</>}
                </div>
              )}
              {rec.rank != null && (
                <div>Din bedste placering i <b>Championships rundeliga</b>:{" "}
                  <b style={{ color: C.gold }}>{rec.rank}. plads</b>
                  {rec.rankField != null ? ` af ${rec.rankField} spillere` : ""}
                  {rec.rankCount > 1 ? ` (${rec.rankCount} gange)` : ""}.</div>
              )}
              {rec.streak > 0 && (
                <div>Din længste stime af rundesejre i <b>Championships rundeliga</b>:{" "}
                  <b style={{ color: C.gold }}>{rec.streak} runder</b> i træk.</div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Milepæle (kun egen profil) — det ANDET omfang på skærmen: konkrete
          øjeblikke, oftest i en navngiven konkurrence (stories.competition_id er
          kun null for de globale regler: rating og måned). */}
      {hasMilestones && (
        <div>
          <Eyebrow>Milepæle</Eyebrow>
          <p style={scopeNote}>
            Øjeblikke fra dine runder — de fleste i en af dine egne konkurrencer, resten fra Championship og din rating.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visibleMilestones.map((m) => (
              <Card key={m.id} style={{ padding: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{m.headline}</div>
                {m.body && <div style={{ color: C.muted, fontSize: 13, marginTop: 3, lineHeight: 1.45 }}>{m.body}</div>}
              </Card>
            ))}
          </div>
          {!milestoneExpanded && milestones.length > MILESTONE_PAGE && (
            <p style={{ color: C.muted, fontSize: 13, marginTop: 8, marginBottom: 0, cursor: "pointer", textDecoration: "underline" }}
               onClick={() => setMilestoneExpanded(true)}>
              Vis alle {milestones.length} milepæle
            </p>
          )}
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
            Rating efter hver runde — den nyeste prik kan stadig flytte sig, indtil runden er slut. ● grå/stiplet = foreløbig periode (under 5 runder).
          </p>
        </Card>
      )}

      {/* Rivaler (kun egen profil) */}
      {isOwn && rivals.length > 0 && (
        <div>
          <Eyebrow>Rivaler</Eyebrow>
          <Card>
            <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6 }}>
              {/* count er antal rivaliserings-HISTORIER (H2H_PASS/STREAK), ikke antal
                  møder — sql/career_profile.sql. Teksten sagde før "krydset klinger
                  N gange", som læses som antal opgør. */}
              Din tætteste rival: <b style={{ color: C.gold }}>{rivals[0].rival}</b> — {rivals[0].count} {rivals[0].count === 1 ? "historie" : "historier"} handler om jeres indbyrdes opgør.
            </div>
            {rivals.length > 1 && (
              <div style={{ color: C.muted, fontSize: 13, marginTop: 8 }}>
                Andre rivaler: {rivals.slice(1).map((r) => `${r.rival} (${r.count})`).join(" · ")}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Basistal (diskret, nederst) — karriere-brede: ALLE tippede kampe,
          uanset hvilken konkurrence de blev tippet i (et tip er globalt pr.
          kamp). Samme scope-spørgsmål som Rekorder, så det står også her. */}
      <Card style={{ padding: 12, background: "transparent", borderStyle: "dashed" }}>
        <div style={{ color: C.muted, fontSize: 11, marginBottom: 6 }}>
          Hele karrieren · alle kampe du har tippet, uanset konkurrence
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", color: C.muted, fontSize: 12 }}>
          <span><b style={{ color: C.text }}>{base.total_points}</b> point</span>
          <span>🎯 <b style={{ color: C.text }}>{base.exact_count}</b> præcise</span>
          {/* hitRate = exact_count / matches — altså andelen af PRÆCISE resultater.
              "Træfsikkerhed" læses som "hvor ofte havde jeg ret", hvor et korrekt
              udfald (+1) uretfærdigt talte som en fejl. */}
          <span><b style={{ color: C.text }}>{hitRate}%</b> præcise pr. kamp</span>
          <span><b style={{ color: C.text }}>{base.matches}</b> tippede kampe</span>
        </div>
      </Card>
    </div>
  );
}

export default ProfileScreen;
