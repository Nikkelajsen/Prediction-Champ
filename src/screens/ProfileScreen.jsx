// Karriereprofil v1 — brugerens karriere som fortælling (titler → milepæle →
// ratingkurve → rivaler), med rå basistal diskret nederst. Spec:
// docs/features/karriereprofil-v1.md. Drill-in-skærm (som BoardScreen).
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { loadCareerProfile, loadCareerMilestones, monthName } from "../lib/data.js";
import { roundLabel } from "../lib/scoring.js";
import { C, font } from "../ui/theme.js";
import { BackBar, Card, Eyebrow, InfoDot, Move, PlayerName } from "../ui/components.jsx";

// Karriereskærmen blander bevidst TO omfang, og det var ikke til at se på den:
// Titler, Rekorder og basistallene er globale (Championship + global rating —
// alle brugere er med), mens Milepælene er øjeblikke fra brugerens egne
// konkurrencer. En bruger læste derfor "8. plads" som en placering i én af sine
// egne konkurrencer. Hvert afsnit siger nu sit omfang med en synlig linje —
// ikke kun bag en InfoDot, som skal klikkes for at hjælpe.
const scopeNote = { color: C.muted, fontSize: 12, lineHeight: 1.45, marginTop: -2, marginBottom: 6 };

// Rundenøgler kommer som tekst fra to kilder (rating_history.round_key er text,
// matches.round_key er date), så nøglen valideres, før den bliver en etiket —
// roundLabel på en ikke-dato giver "Invalid Date – Invalid Date".
function safeRoundLabel(key) {
  return typeof key === "string" && /^\d{4}-\d{2}-\d{2}$/.test(key) ? roundLabel(key) : null;
}

// Letvægts ratingkurve (ingen chart-bibliotek, jf. spec). Én prik pr. runde.
// De første <5 runder (provisorisk K-faktor) tegnes dæmpet/stiplet.
//
// `peakRoundKey` ringer toppunktet ind, så Rekordernes "højeste rating
// nogensinde" kan genfindes i kurven i stedet for at være et løsrevet tal.
//
// Akse-etiketterne står som HTML uden om SVG'en, ikke som <text> inde i den:
// viewBox'en skaleres med preserveAspectRatio="none", så tekst inde i grafen
// ville blive vandret forvrænget på brede skærme.
export function Sparkline({ curve, peakRoundKey }) {
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

  // Toppunktet: brug RPC'ets round_key, så ring og rekord-linje altid peger på
  // samme runde. Falder tilbage til kurvens egen maksimumsprik, hvis nøglen
  // mangler (fx før migreringen) — så ringen aldrig bare forsvinder.
  const peakIdx = peakRoundKey != null
    ? curve.findIndex((p) => p.round_key === peakRoundKey)
    : vals.indexOf(max);
  const peak = peakIdx >= 0 ? peakIdx : vals.indexOf(max);

  const firstLabel = safeRoundLabel(curve[0]?.round_key);
  const lastLabel = safeRoundLabel(curve[n - 1]?.round_key);
  const axis = { color: C.muted, fontSize: 11, whiteSpace: "nowrap" };

  return (
    <div>
      {/* Y-akse som neutral skala-angivelse frem for "din laveste rating":
          intervallet gør kurvens udsving læsbare uden at udpege et lavpunkt. */}
      <div style={{ ...axis, marginBottom: 2 }}>Skala {min}–{max}</div>
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
          {peak >= 0 && (
            <circle cx={x(peak)} cy={y(curve[peak].rating_after)} r="5.5"
              fill="none" stroke={C.gold} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      </div>
      {/* X-akse: kun første og sidste runde. Alle etiketter ville ikke kunne
          læses på en telefon, og kurven skal give et forløb, ikke aflæsninger. */}
      {(firstLabel || lastLabel) && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
          <span style={axis}>{firstLabel || ""}</span>
          <span style={axis}>{lastLabel || ""}</span>
        </div>
      )}
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
  const bestRatingRound = safeRoundLabel(r.best_rating_round);

  // "Din bedste runde nogensinde" — flest point i én runde. Kun ved MINDST ét
  // point: en runde uden point er ingen rekord, og "din bedste runde
  // nogensinde: 0 point" ville drille præcis den bruger, der har mindst brug
  // for det. Fundet på rigtige data (en spiller med én runde og nul point).
  const roundPts = r.best_round_points ?? null;
  const showRoundPts = roundPts != null && roundPts > 0;

  return {
    bestRating,
    bestRatingIsCurrent: bestRating != null && currentRating === bestRating,
    bestRatingRound,
    bestRoundPoints: showRoundPts ? roundPts : null,
    bestRoundExact: showRoundPts ? (r.best_round_exact || 0) : 0,
    bestRoundRound: showRoundPts ? safeRoundLabel(r.best_round_points_round) : null,
    rank: showRank ? rank : null,
    rankCount: r.best_round_rank_count || 0,
    rankField: showField ? field : null,
    streak: streak >= 2 ? streak : 0,
    hasAny: bestRating != null || showRank || streak >= 2 || showRoundPts,
  };
}

// Rival-linjens tal. Rivaler rangeres på jævnbyrdighed fra faktiske møder
// (K3 lukket, 30. juli 2026), så sætningen skal sige mødetallet og stillingen —
// ikke, hvor mange historier der tilfældigvis er skrevet om personen.
// Vises kun på egen profil, så samme privathedsargument som K4's H2H gælder:
// stillingen står også, når man er bagud, men altid som rene tælletal.
export function rivalTally(r) {
  const { meetings, wins, losses, draws } = r;
  const drawNote = draws > 0 ? ` (${draws} uafgjort)` : "";
  const met = `I har mødt hinanden ${meetings} ${meetings === 1 ? "gang" : "gange"}`;
  if (wins === losses) return `${met} — det står lige, ${wins}-${losses}${drawNote}.`;
  if (wins > losses) return `${met} — du fører ${wins}-${losses}${drawNote}.`;
  return `${met} — du er bagud ${wins}-${losses}${drawNote}.`;
}

const MILESTONE_PAGE = 20;

function ProfileScreen({ token, viewerUserId, profileUserId, onBack, openProfile }) {
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
  const titles = data?.titles || { monthly: [], season: [], round_wins: 0 };
  const monthly = titles.monthly || [];
  const seasonTitles = titles.season || [];
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

  const hasTitles = monthly.length > 0 || seasonTitles.length > 0 || roundWins > 0;
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
            Fra Championships sæson-, måneds- og rundeliga, hvor alle brugere automatisk er med — ikke fra egne konkurrencer.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {/* Sæsontitlen står FØRST: Championship har tre kåringer, og sæsonen
                er den største af dem. Den manglede helt, så en afsluttet sæson
                efterlod intet spor i karrieren. */}
            {seasonTitles.map((t) => (
              <span key={t.season_id} style={badge} title={`${t.points} point`}>
                🏆 Sæsonens Prediction Champ — {t.season_name}
              </span>
            ))}
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
              {/* Rækkefølgen går fra det mest konkrete til det mest abstrakte:
                  én runde → placering → stime → det lange ratingtal. */}
              {rec.bestRoundPoints != null && (
                <div>Din bedste runde nogensinde: <b style={{ color: C.gold }}>{rec.bestRoundPoints} point</b>
                  {rec.bestRoundExact > 0 ? `, heraf ${rec.bestRoundExact} 🎯 præcise` : ""}
                  {rec.bestRoundRound ? <span style={{ color: C.muted }}> — runden {rec.bestRoundRound}</span> : null}.</div>
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
              {rec.bestRating != null && (
                <div>
                  {rec.bestRatingIsCurrent
                    ? <>Du er på din <b style={{ color: C.gold }}>højeste globale rating nogensinde</b> lige nu: {rec.bestRating}.</>
                    : <>Din højeste globale rating nogensinde: <b style={{ color: C.gold }}>{rec.bestRating}</b>
                        {rec.bestRatingRound ? <span style={{ color: C.muted }}> — sat efter runden {rec.bestRatingRound}</span> : null}.</>}
                </div>
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
          <Sparkline curve={curve} peakRoundKey={records.best_rating_round} />
          <p style={{ color: C.muted, fontSize: 11, marginTop: 8, marginBottom: 0 }}>
            Rating efter hver runde — den nyeste prik kan stadig flytte sig, indtil runden er slut. ● grå/stiplet = foreløbig periode (under 5 runder). ◎ = højeste rating nogensinde.
          </p>
        </Card>
      )}

      {/* Rivaler (kun egen profil). "Tætteste" er nu en påstand, tallene faktisk
          bakker op: rangeringen er mindst forskel mellem sejre og nederlag blandt
          rigtige møder, ikke antal historier (K3 lukket — se career_profile.sql).
          Navnet er tryk-flade som alle andre navne i appen: rivalen kommer med
          user_id, hvilket den gamle stories-optælling ikke kunne levere. */}
      {isOwn && rivals.length > 0 && (
        <div>
          <Eyebrow>Rivaler <InfoDot title="Rivaler">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>Dine rivaler er dem, du har de <b>mest jævnbyrdige</b> opgør med — mindst forskel mellem sejre og nederlag.</div>
              <div>Et <b>møde</b> er én runde, hvor I begge har tippet i en konkurrence, I deler. Deler I flere konkurrencer, tæller runden stadig kun én gang.</div>
              <div>Kun du kan se dine rivaler.</div>
            </div>
          </InfoDot></Eyebrow>
          <p style={scopeNote}>Fra de konkurrencer, du deler med dem — runde for runde.</p>
          <Card>
            <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6 }}>
              {/* Punktum efter navnet frem for tankestreg: rivalTally har selv en
                  tankestreg inde i sig, og to i samme sætning læses tungt. */}
              Din tætteste rival:{" "}
              <b style={{ color: C.gold }}>
                <PlayerName userId={rivals[0].user_id} name={rivals[0].rival} onOpenProfile={openProfile} />
              </b>. {rivalTally(rivals[0])}
              {rivals[0].stories > 0 && (
                <span style={{ color: C.muted }}>
                  {" "}{rivals[0].stories} {rivals[0].stories === 1 ? "historie" : "historier"} handler om jeres opgør.
                </span>
              )}
            </div>
            {rivals.length > 1 && (
              <div style={{ color: C.muted, fontSize: 13, marginTop: 8 }}>
                Andre rivaler:{" "}
                {rivals.slice(1).map((r, i) => (
                  <span key={r.user_id || r.rival}>
                    {i > 0 && " · "}
                    <PlayerName userId={r.user_id} name={r.rival} onOpenProfile={openProfile} />
                    {" "}({r.wins}-{r.losses} af {r.meetings})
                  </span>
                ))}
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
          {/* De korrekte udfald (+1) blev hentet i `base` uden nogensinde at blive
              vist, så cirka halvdelen af pointene var usynlige: 14 point kunne
              ikke stemme med 4 præcise, uden at man selv regnede resten ud. */}
          <span><b style={{ color: C.text }}>{base.outcome_count}</b> korrekte udfald</span>
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
