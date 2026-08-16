// Ét konkurrence-kort — det samme på Ligaer-fanen og inde på liga-siden.
//
// ---------------------------------------------------------------------------
// Hvorfor det bor for sig selv
//
// Kortet fandtes kun ét sted (`LeagueCard` inde i `LigaerTab`), og liga-siden
// havde sit eget, som ikke viste noget: en konkurrence i en liga stod med navn,
// mode og deltagerantal, uden pokal, uden vinder og uden at man kunne se, om den
// overhovedet var slut. Det var den forkerte vej rundt — liga-laget ER stedet,
// konkurrencer bor, og "Øvrige konkurrencer" er dem uden (en understøttet
// tilstand, ikke et overgangslag — `A57`).
//
// Delingen går på STATUS-visningen: badge, pokal, fremdrift, flueben og
// vinderlinje. Handlingerne er forskellige de to steder (Deltag/Frameld inde i
// en liga, Arkivér/Slet på Ligaer-fanen), og de sendes derfor ind som children
// frem for at blive til ti props, kortet selv skulle finde ud af at kombinere.
import { useEffect, useRef } from "react";
import { Check, ChevronRight, Trophy } from "lucide-react";
import { modeLabel } from "../../lib/scoring.js";
import { C, font } from "../../ui/theme.js";
import { Card, PlayerName } from "../../ui/components.jsx";

// Badge'en, der siger "kapitlet er lukket". Guldkanten alene rakte ikke: den
// læses som pynt, indtil man har set en konkurrence UDEN den ved siden af.
function DoneBadge() {
  return (
    <span style={{
      fontFamily: font.display, textTransform: "uppercase", letterSpacing: "0.1em",
      fontSize: 10, fontWeight: 700, color: C.gold, border: `1px solid ${C.gold}`,
      borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap",
    }}>Afsluttet</span>
  );
}

// Fluebenet. Titel OG aria-label, fordi de to gør hver sin ting: `title` er
// muse-forklaringen, `aria-label` er den, en skærmlæser siger — et bart ✓ ville
// ellers blive læst op som ingenting.
function AllTippedTick() {
  const t = "Alle kampe i næste runde er tippet";
  return (
    <span role="img" aria-label={t} title={t}
      style={{ display: "inline-flex", alignItems: "center", color: C.green }}>
      <Check size={14} strokeWidth={3} />
    </span>
  );
}

// `status` er en række fra `loadCompetitionStatuses` (src/lib/data/competitionStatus.js).
// `winners` og `myPos` hentes kun, hvor de bruges, og må gerne mangle.
function CompetitionCard({
  c, status, winners = [], myPos = null, myShared = false, meta = null,
  celebrate = false, onCelebrated, onOpen, right, onOpenProfile, children,
}) {
  const s = status || null;
  const done = !!s?.concluded;
  // Fejringen kører én gang og skrives ned, så snart den er startet — ikke når
  // den er færdig. Et skærmskifte midt i animationen må ikke give den en tur
  // mere næste gang.
  const marked = useRef(false);
  useEffect(() => {
    if (!celebrate || marked.current) return;
    marked.current = true;
    onCelebrated?.(c.id);
  }, [celebrate, c.id, onCelebrated]);

  const showTick = !done && s?.hasNextRound && s.nextRoundAllTipped;

  return (
    <Card
      onClick={onOpen}
      className={celebrate ? "compdone" : undefined}
      style={done ? { borderColor: C.gold } : undefined}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 15, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {done && <span className="comptrophy"><Trophy size={13} color={C.gold} /></span>}
            <span>{c.name}</span>
            {showTick && <AllTippedTick />}
            {done && <DoneBadge />}
          </div>
          <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
            {modeLabel(c.mode, c.mode_params)}
            {meta ? ` · ${meta}` : ""}
            {/* Fremdriften er sand, også mens sæson-gaten holder kortet åbent —
                og den er netop dét, der forklarer, hvorfor en konkurrence med
                alle kampe spillet endnu ikke er afsluttet. */}
            {s && !done && s.matches > 0 ? ` · ${s.scoredMatches}/${s.matches} spillet` : ""}
          </div>
          {done && winners.length > 0 && (
            <div style={{ color: C.gold, fontSize: 12, fontWeight: 700, marginTop: 3 }}>
              🏆 {winners.map((w, i) => (
                <span key={w.userId}>
                  {i > 0 && (i === winners.length - 1 ? " og " : ", ")}
                  <PlayerName userId={w.userId} name={w.player} onOpenProfile={onOpenProfile} />
                </span>
              ))} ({winners[0].total} point{winners.length > 1 ? " — delt" : ""})
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {right}
          {myPos != null && (
            <div>
              <div style={{ fontFamily: font.display, fontSize: 24, fontWeight: 700, color: myPos === 1 ? C.gold : C.text }}>{myPos}.</div>
              <div style={{ color: C.muted, fontSize: 11 }}>{myShared ? "delt plads" : "din plads"}</div>
            </div>
          )}
          {onOpen && <ChevronRight size={18} color={C.muted} />}
        </div>
      </div>
      {children && (
        <div style={{ marginTop: 8, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          {children}
        </div>
      )}
    </Card>
  );
}

// Den fælles form for de tekst-knapper, kortet får som children. Ligger her, så
// "Arkivér", "Frameld dig" og "Fjern" ikke bliver tre lidt forskellige links.
const cardAction = (tone) => ({
  background: "none", border: "none", padding: 0, fontSize: 12, cursor: "pointer",
  fontFamily: font.body, color: tone === "danger" ? C.red : C.muted,
  textDecoration: tone === "danger" ? "none" : "underline",
  display: "inline-flex", alignItems: "center", gap: 4,
});

export default CompetitionCard;
export { cardAction };
