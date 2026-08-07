// Story Engine v3 — dagens ENE kort på Hjem.
//
// Afløser `StoryCarousel.jsx`. Forskellen er ikke kosmetisk: karusellen var et
// vandret felt med op til ti kort, som man rydder eller ignorerer, og v3's
// diagnose var, at et øjeblik delt med ni andre ikke er et øjeblik. Her er der
// ét kort, og hvilket ét er afgjort af nyhedsværdien i databasen.
//
// HVAD DER BEVIDST IKKE ER HER
//   · Ingen Del-knap. Delingen bor kun i rundestoryen (spec §7) — det sjældne
//     format skal være det, man sender videre.
//   · Ingen Afvis. Kortet udløber efter 48 timer og erstattes hver kampdag, så
//     der er intet at rydde. Spec §8: "Ingen friktion, intet at åbne, intet at
//     rydde."
//   · Ingen tap-through. Hverdagen er ét blik.
//
// TRE UDGAVER, styret af regel og prioritet:
//   milestone · guld. En bedrift, man har opnået én gang og altid har opnået —
//               den kaprer dagens slot og er det største, der kan stå her.
//   highlight · guld-kant. Dagens historie: news_value nåede tærsklen 45.
//   quiet     · dæmpet (priority ≥ 180). Dagens facit eller tips-påmindelsen.
//               Mindre overskrift, ingen emoji, ingen ulæst-prik. Produktbogens
//               kapitel 6 beder forsiden om at turde sige "status quo"; det er
//               dette kort.
import { useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { logEventOnce } from "../../lib/analytics.js";
import { isDailyQuiet, isNewsworthy } from "../../lib/stories.js";
import { formatKickoff } from "../../lib/scoring.js";
import { C, btnGreen, font } from "../../ui/theme.js";
import { Card, Eyebrow } from "../../ui/components.jsx";
import { cardTight } from "./shared.js";

// Mini-stillingen: tre rækker (over / dig / under) fra kortets konkurrence.
// Pakket af SQL'en i payload.mini, fordi navnene skal være afgrænset til
// personer, modtageren deler konkurrence med — den regel er strukturel i
// dagsmotoren og må ikke genopfindes i en komponent.
//
// Globale kort (stimen, milepæle) har ingen konkurrence og dermed ingen mini;
// så udelades sektionen helt frem for at vise en tom ramme.
function MiniStanding({ rows }) {
  if (!rows?.length) return null;
  return (
    <div style={{ marginTop: 10, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
      {rows.map((r) => (
        <div key={`${r.rnk}:${r.name}`} style={{
          display: "flex", justifyContent: "space-between", gap: 8,
          fontSize: 13, lineHeight: 1.6,
          color: r.me ? C.text : C.muted,
          fontWeight: r.me ? 700 : 400,
        }}>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.rnk}. {r.name}
          </span>
          <span style={{ flexShrink: 0 }}>{r.pts}</span>
        </div>
      ))}
    </div>
  );
}

function DayCard({ story, token, competitions, tips, seen, onSeen, openPredictions }) {
  const groupId = competitions?.find((c) => c.id === story?.competition_id)?.group_id || null;

  // story_viewed logges, når kortet BLIVER synligt — reglen er uændret fra v2,
  // men bliver mere præcis nu, hvor der kun er ét kort: i karusellen kunne et
  // kort, ingen swipede hen til, aldrig tælle, og her er der intet at swipe
  // forbi. Samtidig sendes score-fordelingen, som A35 skal afgøre tærsklen på.
  // Begge felter ligger på rækken, så klienten regner ingenting.
  useEffect(() => {
    if (!story) return;
    logEventOnce(token, "story_viewed", story.id, {
      competitionId: story.competition_id || null, groupId,
      metadata: {
        rule: story.rule, priority: story.priority,
        quiet: isDailyQuiet(story.priority), news_value: story.news_value ?? null,
      },
    });
    logEventOnce(token, "story_score_distribution", story.id, {
      competitionId: story.competition_id || null, groupId,
      metadata: {
        day_key: story.day_key, winner_rule: story.payload?.winner_rule || story.rule,
        news_value: story.news_value ?? null,
        runner_up_value: story.payload?.runner_up_value ?? null,
      },
    });
    // Ulæst-prikken ryddes i samme øjeblik, kortet er set. Flaget er lokalt
    // (localFlags), fordi en ulæst-markering er en egenskab ved enheden.
    onSeen?.(story.id);
  }, [story, token]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!story) return null;

  const quiet = isDailyQuiet(story.priority);
  const milestone = story.rule === "MILESTONE";
  const gold = milestone;
  const unread = !seen && isNewsworthy(story);
  const noTips = story.payload?.variant === "no_tips";

  return (
    <Card style={{
      ...cardTight,
      ...(gold ? { borderColor: C.gold, background: "linear-gradient(135deg, #14212F 0%, #221E14 100%)" }
        : !quiet ? { borderColor: C.gold } : null),
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <Eyebrow>
          {milestone ? "Ny milepæl" : quiet ? "I dag" : `Kampdag ${story.payload?.day || ""}`.trim()}
        </Eyebrow>
        {/* Ulæst-prikken er HELE pointen med tærsklen. Et badge, der lyser hver
            dag, er ikke et signal, det er en baggrundsfarve — derfor vises den
            aldrig på det dæmpede kort, uanset hvor længe det har stået ulæst. */}
        {unread && (
          <span aria-label="Ulæst" style={{
            width: 8, height: 8, borderRadius: 4, background: C.gold, flexShrink: 0,
          }} />
        )}
      </div>

      <div style={{
        fontFamily: font.display, fontSize: quiet ? 17 : 20, fontWeight: 700, lineHeight: 1.15,
      }}>
        {story.headline}
      </div>
      <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.45, marginTop: 6 }}>{story.body}</div>

      <MiniStanding rows={story.payload?.mini} />

      {/* Næste kamp og manglende tips står PÅ kortet og ikke i et kort mere.
          Dataene er dem, Hjem allerede har hentet (computeHomeTips) — kortet
          henter intet selv. Rækkefølgen er bevidst: mangler der tips, er det
          det eneste, der skal stå; ellers er næste kamp den rolige besked. */}
      {tips?.allTipped === false && tips.missingCount > 0 ? (
        <button style={{ ...btnGreen, marginTop: 12 }}
          onClick={() => openPredictions?.("all", tips.roundKey)}>
          {tips.missingCount === 1 ? "1 kamp mangler tips" : `${tips.missingCount} kampe mangler tips`}
        </button>
      ) : tips?.nextOpen && !noTips ? (
        <div style={{ color: C.muted, fontSize: 13, marginTop: 10, display: "flex", alignItems: "center", gap: 4 }}>
          <ChevronRight size={13} /> Næste kamp: {formatKickoff(tips.nextOpen, tips.nextOpenTbd)}
        </div>
      ) : null}
    </Card>
  );
}

export default DayCard;
