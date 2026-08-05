// Karriereprofil v1 — brugerens karriere som fortælling (titler → milepæle →
// ratingkurve → rivaler), med rå basistal diskret nederst. Spec:
// docs/features/karriereprofil-v1.md. Drill-in-skærm (som BoardScreen).
// Karriereskærmen blander bevidst TO omfang: Titler, Rekorder og basistallene er
// globale (Championship + global rating — alle brugere er med), mens Milepælene er
// øjeblikke fra brugerens egne konkurrencer. En bruger læste derfor "8. plads" som
// en placering i én af sine egne konkurrencer.
//
// Omfanget forklares på ÉN måde: en InfoDot pr. sektion. Et mellemtrin havde
// desuden en synlig brødtekstlinje under hver overskrift, men den løsning blev
// afvist af brugeren — fem forklarende afsnit gjorde siden tungere at skimme end
// den tvivl, de skulle fjerne, var værd. Skærmen bærer derfor kun de tal, der
// navngiver deres eget omfang i selve sætningen ("i Championships rundechampionship",
// "globale rating"), og forklaringen ligger ét klik væk. Ny sektion med tal ⇒ ny
// InfoDot, ikke ny brødtekst.
//
// Skærmen er delt op ad to omgange (G1). 3. august 2026 flyttede de rene regler
// til profile/facts.js og ratingkurven til profile/Sparkline.jsx; 5. august
// fulgte de fem store sektioner — titler, rekorder, milepæle, rivaler og
// basistallene. Tilbage her står dét, en skærm er: hent profilen, udled hvad
// der findes, og sæt sektionerne sammen. Begge flytninger er rene.
//
// SNITTET er bevidst det samme som i `data/invites.js`: sektionerne får FÆRDIGT
// udledte værdier og afgør kun, hvordan de tegnes. Udledningen — hvad findes,
// hvad er tomt, hvad er en rekord — bliver her, hvor den kan læses i ét stykke.
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { loadCareerProfile, loadCareerMilestones, monthName } from "../lib/data.js";
import { logEvent } from "../lib/analytics.js";
import { shareText, storyShareText } from "../lib/share.js";
import { groupMilestones } from "../lib/milestones.js";
import { C, font } from "../ui/theme.js";
import { BackBar, Card, Eyebrow, InfoDot, Move } from "../ui/components.jsx";
import { Sparkline } from "./profile/Sparkline.jsx";
import { h2hSentence, recordFacts } from "./profile/facts.js";
import TitlesSection from "./profile/TitlesSection.jsx";
import RecordsSection from "./profile/RecordsSection.jsx";
import MilestonesSection from "./profile/MilestonesSection.jsx";
import RivalsSection from "./profile/RivalsSection.jsx";
import BaseFacts from "./profile/BaseFacts.jsx";

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
  // Per-turnering-titler (K2). Grenen mangler, indtil career_profile.sql er
  // gen-kørt i produktion — en tom liste giver samme udfald som "ingen vundet",
  // altså ingen sektion, ikke en fejl.
  const byTournament = titles.by_tournament || [];
  const curve = data?.curve || [];
  const base = data?.base || { total_points: 0, exact_count: 0, outcome_count: 0, matches: 0 };
  const rivals = data?.rivals || [];
  const records = data?.records || {};
  const footprint = data?.footprint || { leagues: 0, competitions: 0 };

  const memberSince = head.created_at ? monthName(String(head.created_at).slice(0, 7)) : null;
  const hitRate = base.matches > 0 ? Math.round((base.exact_count / base.matches) * 100) : 0;

  const rec = recordFacts(records, head.rating);
  const hasRecords = rec.hasAny;

  // Milepælene grupperes i de fire familier (Konkurrence, Rating, Streaks &
  // præcision, Fællesskab) frem for at stå som én kronologisk liste. Med et
  // katalog på ~30 engangs-bedrifter er kronologien ikke længere den nyttige
  // akse: man vil se, hvad man har opnået — og hvad der mangler i den familie,
  // man er tættest på. Tomme familier udelades helt.
  const milestoneGroups = groupMilestones(milestones);
  const visibleMilestones = milestoneExpanded ? milestoneGroups : milestoneGroups.map((g) => ({
    ...g, items: g.items.slice(0, MILESTONE_PAGE), hidden: Math.max(0, g.items.length - MILESTONE_PAGE),
  }));
  const hiddenCount = visibleMilestones.reduce((n, g) => n + (g.hidden || 0), 0);

  // Milepælen deles med samme tekst som historie-kortet (`storyShareText`), så
  // en milepæl, der er delt to gange med et halvt år imellem, ser ens ud.
  // Hændelsen bærer nøglen som `rule` — det er den, A5 skal bruge for at kunne
  // se, HVILKE korttyper der bliver delt.
  async function shareMilestone(m) {
    try {
      await shareText(storyShareText(m));
      logEvent(token, "story_shared", { metadata: { rule: m.key, from: "milestone" } });
    } catch { /* bruger annullerede — ignorér */ }
  }

  const hasTitles = monthly.length > 0 || seasonTitles.length > 0 || roundWins > 0;
  const hasTournamentTitles = byTournament.length > 0;
  const hasMilestones = isOwn && milestones.length > 0;
  const hasCurve = curve.length >= 2;
  const hasH2H = !isOwn && !!data?.h2h;
  // "Karriere lige begyndt": ingen titler, ingen milepæle, rekorder, H2H og for lidt kurve.
  const isEmpty = !hasTitles && !hasTournamentTitles && !hasMilestones && !hasCurve && !hasRecords && !hasH2H;

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
            {h2hSentence(data.h2h, head.display_name)}{" "}
            <InfoDot title="Jeres indbyrdes opgør">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div>Tallene dækker <b>kun</b> kampe fra konkurrencer, I begge er med i — ikke hele Championship, og ikke alt hvad I hver især har tippet.</div>
                <div>Et <b>møde</b> er én runde. Deler I flere konkurrencer, der dækker de samme kampe, tæller runden stadig kun én gang.</div>
                <div>Kun du kan se denne linje.</div>
              </div>
            </InfoDot>
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

      <TitlesSection hasTitles={hasTitles} seasonTitles={seasonTitles} monthly={monthly}
        roundWins={roundWins} hasTournamentTitles={hasTournamentTitles} byTournament={byTournament} />

      <RecordsSection hasRecords={hasRecords} rec={rec} />

      <MilestonesSection hasMilestones={hasMilestones} visibleMilestones={visibleMilestones}
        milestones={milestones} milestoneExpanded={milestoneExpanded} hiddenCount={hiddenCount}
        setMilestoneExpanded={setMilestoneExpanded} shareMilestone={shareMilestone} />

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

      <RivalsSection isOwn={isOwn} rivals={rivals} openProfile={openProfile} />

      <BaseFacts base={base} hitRate={hitRate} />
    </div>
  );
}

export default ProfileScreen;
