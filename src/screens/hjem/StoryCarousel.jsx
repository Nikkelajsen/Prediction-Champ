// Story Engines karrusel på Hjem: ét kort ad gangen, vandret swipe.
//
// Ren flytning ud af `HjemTab.jsx` (G1, august 2026). De to komponenter følges
// ad, fordi `StoryCarousel` er den eneste, der tegner et `CarouselCard`, og
// fordi `story_viewed`-logningen hører til dét, der bliver SYNLIGT — den regel
// ville blive utydelig, hvis kortet lå i en anden fil end swipet.
import { useState, useEffect, useRef } from "react";
import { Share2, X } from "lucide-react";
import { logEvent, logEventOnce } from "../../lib/analytics.js";
import { shareText, storyShareText } from "../../lib/share.js";
import { C, btnGhost, font, iconBtn } from "../../ui/theme.js";
import { Card, Eyebrow } from "../../ui/components.jsx";
import { cardTight } from "./shared.js";

// Historie-kort (Story Engine v1.1). Vises direkte under tips-status, live for alle.
// Afvis sætter dismissed_at og skjuler kortet.
//
// TO UDGAVER, styret af prioriteten (`isQuiet`, jf. src/lib/stories.js):
//  · Højdepunkt (prioritet < 90): guld-kant, ravgul gradient, emoji i headline og
//    en Del-knap — ugens højdepunkt, noget man sender i gruppens beskedtråd.
//  · Dæmpet (prioritet ≥ 90): almindeligt kort, mindre headline, ingen emoji og
//    INGEN Del-knap. Det er den stille runde, produktbogens kapitel 6 beder om
//    ("status quo") — den skal kunne ses uden at ligne en sejr, og der er intet
//    at prale af. Genereres kun, når brugeren ellers ville stå helt uden kort.
// Ét kort i karusellen. `kind` afgør udseendet, og der er nu FIRE:
//   milestone  · guld + ikon. En bedrift, man har opnået én gang og altid har
//                opnået — den vigtigste ting, der kan stå på forsiden.
//   highlight  · guld. Rundens historie (prioritet < 90), som før.
//   day        · almindeligt kort med kampdagens dato i eyebrow'en. Rigtigt
//                indhold, men ikke ugens konklusion — derfor ikke guld.
//   quiet      · dæmpet, ingen emoji, ingen Del (prioritet ≥ 90). Produktbogens
//                "status quo": det skal kunne ses uden at ligne en sejr.
function CarouselCard({ item, onDismiss, token, groupId }) {
  const gold = item.kind === "milestone" || item.kind === "highlight";
  const quiet = item.kind === "quiet";
  async function share() {
    try {
      await shareText(storyShareText(item));
      // Samme hændelse som før — også for milepæle, så tallet i Analytics
      // fortsat måler "et højdepunkt blev delt" og ikke to forskellige ting.
      logEvent(token, "story_shared", {
        competitionId: item.competition_id || null, groupId,
        metadata: item.kind === "milestone"
          ? { rule: item.rule, from: "milestone" }
          : { rule: item.rule },
      });
    } catch { /* bruger annullerede — ignorér */ }
  }
  return (
    <Card style={{
      ...cardTight, minWidth: "100%", scrollSnapAlign: "start", margin: 0,
      ...(gold ? { borderColor: C.gold, background: "linear-gradient(135deg, #14212F 0%, #221E14 100%)" } : null),
    }}>
      {/* Del bor i eyebrow-linjen og ikke på sin egen række under teksten.
          Rækken var der allerede — den bar kun en etiket og et kryds — og en
          knap på egen linje kostede kortet knap en tredjedel af sin højde i en
          karrusel, hvor der kan ligge ti kort. Rækkefølgen er bevidst: Del til
          venstre for Afvis, med luft imellem, så den positive handling ikke
          sidder klods op ad den, der får kortet til at forsvinde. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <Eyebrow>{item.eyebrow}</Eyebrow>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          {!quiet && (
            <button style={{ ...btnGhost, padding: "5px 10px", borderColor: gold ? C.gold : C.line, color: gold ? C.gold : C.text }}
              onClick={share}><Share2 size={14} /> Del</button>
          )}
          {onDismiss && (
            <button style={iconBtn} aria-label="Afvis" onClick={onDismiss}><X size={16} /></button>
          )}
        </div>
      </div>
      <div style={{ fontFamily: font.display, fontSize: quiet ? 17 : 20, fontWeight: 700, lineHeight: 1.15 }}>
        {item.headline}
      </div>
      <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.45, marginTop: 6 }}>{item.body}</div>
    </Card>
  );
}

// Rundens karrusel (Story Engine v2). Kortene akkumulerer gennem runden — 0–2
// pr. kampdag — og vises nyeste først, med rundens afsluttende kort og
// nyopnåede milepæle øverst. Ny runde ⇒ tom karrusel, fordi round_key skifter.
//
// VANDRET SWIPE og ikke en lodret stak: produktbogens kapitel 6 beder forsiden
// om "næsten altid at fortælle én ting". Karusellen holder det løfte — man ser
// ét kort ad gangen, og det vigtigste ligger først — men giver plads til, at
// ugen kan rumme mere end ét øjeblik.
function StoryCarousel({ items, onDismiss, token, competitions }) {
  const ref = useRef(null);
  const [idx, setIdx] = useState(0);

  // Aktivt kort udledes af scroll-positionen frem for af en klik-handler, så
  // tallet også er rigtigt, når brugeren swiper med fingeren.
  function onScroll() {
    const el = ref.current;
    if (!el || !el.clientWidth) return;
    const next = Math.round(el.scrollLeft / el.clientWidth);
    if (next !== idx) setIdx(next);
  }

  const active = items[Math.min(idx, items.length - 1)];
  const groupIdOf = (it) => competitions.find((c) => c.id === it?.competition_id)?.group_id || null;

  // story_viewed logges, når kortet BLIVER synligt — ikke for hele listen ved
  // indlæsning. Ellers ville et kort, ingen swipede hen til, tælle som vist, og
  // regelstatistikken i Analytics (A5) ville måle noget andet end den påstår.
  useEffect(() => {
    if (!active || active.kind === "milestone") return;
    logEventOnce(token, "story_viewed", active.id, {
      competitionId: active.competition_id || null, groupId: groupIdOf(active),
      metadata: { rule: active.rule, priority: active.priority, quiet: active.kind === "quiet" },
    });
  }, [active, token]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!items.length) return null;

  return (
    <div>
      <div ref={ref} onScroll={onScroll} style={{
        display: "flex", gap: 12, overflowX: "auto", scrollSnapType: "x mandatory",
        scrollbarWidth: "none", msOverflowStyle: "none",
      }}>
        {items.map((it) => (
          <CarouselCard key={it.id} item={it} token={token} groupId={groupIdOf(it)}
            onDismiss={it.kind === "milestone" ? null : () => onDismiss(it)} />
        ))}
      </div>
      {items.length > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 8 }}
             aria-label={`Kort ${idx + 1} af ${items.length}`}>
          {items.map((it, i) => (
            <span key={it.id} style={{
              width: 6, height: 6, borderRadius: 3,
              background: i === idx ? C.gold : C.line,
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

export default StoryCarousel;
