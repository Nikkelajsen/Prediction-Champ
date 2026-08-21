// Milepælene på karriereprofilen — engangs-bedrifter grupperet i fire familier,
// med Del-knap pr. milepæl (`I5`).
//
// Ren flytning ud af `ProfileScreen.jsx` (G1, august 2026).
import { Share2 } from "lucide-react";
import { C, iconBtn } from "../../ui/theme.js";
import { Card, Eyebrow, InfoDot, TekstLink } from "../../ui/components.jsx";

function MilestonesSection({ hasMilestones, visibleMilestones, milestones, milestoneExpanded, hiddenCount, setMilestoneExpanded, shareMilestone }) {
  if (!hasMilestones) return null;
  return (
    <>
      {/* Milepæle (kun egen profil) — engangs-bedrifter, grupperet i fire
          familier. Indtil august 2026 var dette en kronologisk liste over
          story-arkivet, hvilket gjorde den til en rundelog: Story Engine gemmer
          ALLE udløste kandidater hver runde, så "Kun 3 point op til føringen"
          landede her hver uge. Milepæle har nu deres egen tabel og et katalog,
          hvor hver bedrift opnås én gang. */}
      {hasMilestones && (
        <div>
          <Eyebrow>Milepæle <InfoDot title="Milepæle">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>Milepæle er <b>bedrifter, du opnår én gang</b> — at vinde en konkurrence, at nå en ratinggrænse, at afgive 100 tips. De forsvinder aldrig igen.</div>
              <div>Det er dermed et andet omfang end <b>Rekorder</b> ovenfor, som viser dine bedste tal lige nu og godt kan blive overgået.</div>
              <div>De skrives automatisk, når du opnår dem. Er du tæt på den næste, dukker den op af sig selv.</div>
              <div>Kun du kan se dine milepæle.</div>
            </div>
          </InfoDot></Eyebrow>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {visibleMilestones.map((g) => (
              <div key={g.key}>
                <div style={{ color: C.muted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>
                  {g.label}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {g.items.map((m) => (
                    <Card key={m.id} style={{ padding: 12 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <div style={{ fontSize: 18, lineHeight: 1.2, flexShrink: 0 }} aria-hidden="true">{m.icon}</div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{m.headline}</div>
                          {m.body && <div style={{ color: C.muted, fontSize: 13, marginTop: 3, lineHeight: 1.45 }}>{m.body}</div>}
                        </div>
                        {/* Del (I5). Kortet på Hjem forsvinder, når runden er
                            forbi — og det er typisk EFTER en uge, man har lyst
                            til at vise en bedrift frem. Samme tekst og samme
                            `story_shared`-hændelse som kortet, så tallet i
                            Analytics fortsat måler "et højdepunkt blev delt". */}
                        <button type="button" onClick={() => shareMilestone(m)}
                          aria-label={`Del milepælen: ${m.headline}`}
                          style={{ ...iconBtn, flexShrink: 0, color: C.gold }}>
                          <Share2 size={15} />
                        </button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {!milestoneExpanded && hiddenCount > 0 && (
            <TekstLink style={{ color: C.muted, fontSize: 13, display: "block", marginTop: 8, marginBottom: 0 }}
               onClick={() => setMilestoneExpanded(true)}>
              Vis alle {milestones.length} milepæle
            </TekstLink>
          )}
        </div>
      )}
    </>
  );
}

export default MilestonesSection;
