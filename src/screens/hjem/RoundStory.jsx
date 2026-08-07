// Story Engine v3 — rundens tap-through-story.
//
// Rundens sidste dag udgiver KUN rundekortet (dagsmotoren springer dagen over),
// og det er den ene gang om ugen, tap-through er sit besvær værd. Det sjældne
// format bliver dermed faktisk sjældent, og det er dét, der gør det til en
// begivenhed frem for endnu et kort.
//
// TO DELE
//   · Indgangskortet på Hjem: overskrift + "Se din runde" + ulæst-prik.
//   · Fuldskærms-visningen: 4–5 frames, ét tap frem, ét tilbage.
//
// Frames bygges i SQL (build_round_frames → payload.frames) og får deres tekst
// af renderFrame() i src/lib/stories.js. Komponenten her ved intet om, hvad en
// frame indeholder — den viser eyebrow/headline/body og lader være med at
// tegne en frame, hvis data mangler (usableFrames filtrerer dem fra).
import { useState, useEffect } from "react";
import { Share2, X, ChevronRight } from "lucide-react";
import { logEvent, logEventOnce } from "../../lib/analytics.js";
import { shareImage, storyShareText } from "../../lib/share.js";
import { usableFrames } from "../../lib/stories.js";
import { C, btnGhost, btnGold, font, iconBtn } from "../../ui/theme.js";
import { Card, Eyebrow } from "../../ui/components.jsx";
import { cardTight } from "./shared.js";

// De to frames, folk sender videre (spec §7): rundens tal og ratingen. De skal
// kunne stå alene som billede uden kontekst, og derfor er det kun dem, der har
// en Del-knap — ikke fordi de andre er hemmelige, men fordi en delefunktion på
// hver side gør ingen af dem til noget særligt.
const SHARABLE = new Set(["ROUND_SUM", "RATING"]);

// Billedet tegnes med canvas og ikke som en skærmbillede-kopi af DOM'en: det
// skal kunne læses uden appens baggrund, i en beskedtråd, på en telefon, der
// aldrig har set produktet. Derfor egen ramme, eget navn nederst.
function drawFrame(view, ctx, w, h) {
  ctx.fillStyle = "#14212F";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#F2C14E";
  ctx.fillRect(0, 0, w, 10);

  ctx.fillStyle = "#8DA2B8";
  ctx.font = "600 34px system-ui, sans-serif";
  ctx.fillText((view.eyebrow || "").toUpperCase(), 80, 200);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "700 92px system-ui, sans-serif";
  // Ombrydning i hånden: canvas har ingen. Grænsen er tegn og ikke pixels,
  // fordi målet er læsbarhed og ikke typografisk perfektion.
  const words = String(view.headline || "").split(" ");
  let line = "";
  let y = 340;
  for (const word of words) {
    if ((line + word).length > 18) { ctx.fillText(line.trim(), 80, y); y += 108; line = ""; }
    line += `${word} `;
  }
  if (line.trim()) ctx.fillText(line.trim(), 80, y);

  ctx.fillStyle = "#8DA2B8";
  ctx.font = "400 40px system-ui, sans-serif";
  ctx.fillText(String(view.body || "").slice(0, 46), 80, y + 90);

  ctx.fillStyle = "#F2C14E";
  ctx.font = "700 36px system-ui, sans-serif";
  ctx.fillText("Leagly", 80, h - 80);
}

function Frames({ story, frames, token, groupId, onClose, openProfile, userId }) {
  const [i, setI] = useState(0);
  const cur = frames[i];

  // Hver frame logges, når den bliver vist. Spørgsmålet, tallet svarer på, er
  // "hvor mange når frame 4?" — altså om tap-through overhovedet bliver brugt,
  // eller om folk lukker efter den første side.
  useEffect(() => {
    logEventOnce(token, "story_frame_viewed", `${story.id}:${i}`, {
      competitionId: story.competition_id || null, groupId,
      metadata: { story_id: story.id, frame: i + 1, total_frames: frames.length },
    });
  }, [i, story.id, token]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function share() {
    try {
      await shareImage((ctx, w, h) => drawFrame(cur.view, ctx, w, h), {
        text: storyShareText({ headline: cur.view.headline, body: cur.view.body }),
      });
      logEvent(token, "story_shared", {
        competitionId: story.competition_id || null, groupId,
        metadata: { rule: story.rule, from: `frame:${cur.raw.frame}` },
      });
    } catch { /* bruger annullerede — ignorér */ }
  }

  // Milepæls-CTA'en er stedets ENESTE deep-link til karriereprofilen, og den er
  // placeret dér, hvor brugeren netop har fået noget at være stolt af. Virker
  // den ikke — intet målbart løft i besøg inden for 24 timer — er det ikke
  // flere kort, der er svaret, men en anden indgang (spec §10).
  function openCareer() {
    logEvent(token, "milestone_cta_clicked", {
      metadata: { milestone_key: cur.raw.milestone_key || null },
    });
    onClose();
    openProfile?.(userId);
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Rundens historie"
      style={{
        position: "fixed", inset: 0, zIndex: 60, background: C.bg,
        display: "flex", flexDirection: "column", padding: 16,
      }}
      onClick={(e) => {
        // Tap i venstre tredjedel går tilbage, resten frem — samme greb som
        // enhver anden story-visning, så ingen skal læse en vejledning.
        const back = e.clientX < e.currentTarget.clientWidth / 3;
        if (back) setI((v) => Math.max(0, v - 1));
        else if (i + 1 < frames.length) setI(i + 1);
        else onClose();
      }}
    >
      {/* Fremdriftsstriber øverst: hvor mange sider, og hvor langt man er. */}
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {frames.map((f, n) => (
          <span key={f.raw.frame + n} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: n <= i ? C.gold : C.line,
          }} />
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8, flexShrink: 0 }}>
        <button style={iconBtn} aria-label="Luk"
          onClick={(e) => { e.stopPropagation(); onClose(); }}>
          <X size={20} />
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 10 }}>
        <Eyebrow>{cur.view.eyebrow}</Eyebrow>
        <div style={{ fontFamily: font.display, fontSize: 30, fontWeight: 700, lineHeight: 1.15 }}>
          {cur.view.headline}
        </div>
        {cur.view.body && (
          <div style={{ color: C.muted, fontSize: 16, lineHeight: 1.5 }}>{cur.view.body}</div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, flexShrink: 0, paddingBottom: 8 }}
           onClick={(e) => e.stopPropagation()}>
        {cur.raw.frame === "MILESTONE" && (
          <button style={{ ...btnGold, flex: 1 }} onClick={openCareer}>Se din karriere</button>
        )}
        {SHARABLE.has(cur.raw.frame) && (
          <button style={{ ...btnGhost, borderColor: C.gold, color: C.gold }} onClick={share}>
            <Share2 size={14} /> Del
          </button>
        )}
      </div>
    </div>
  );
}

function RoundStory({ story, token, competitions, seen, onSeen, onDismiss, openProfile, userId }) {
  const [open, setOpen] = useState(false);
  const groupId = competitions?.find((c) => c.id === story?.competition_id)?.group_id || null;
  const frames = usableFrames(story?.payload);

  // Indgangskortet tæller som impression — også hvis brugeren aldrig åbner
  // storyen. Det er kortet, der er vist, og det er dét, story_viewed måler.
  useEffect(() => {
    if (!story) return;
    logEventOnce(token, "story_viewed", story.id, {
      competitionId: story.competition_id || null, groupId,
      metadata: { rule: story.rule, priority: story.priority, quiet: false, period: "round" },
    });
  }, [story, token]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!story) return null;

  // Uden brugbare frames er der intet at tappe igennem, og så er rundekortet
  // bare et kort. Det sker for en bruger uden rating og uden tips i runden —
  // sjældent, men ikke umuligt, og en tom fuldskærmsvisning er værre end ingen.
  if (!frames.length) {
    return (
      <Card style={{ ...cardTight, borderColor: C.gold }}>
        <Eyebrow>Rundens historie</Eyebrow>
        <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, lineHeight: 1.15 }}>
          {story.headline}
        </div>
        <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.45, marginTop: 6 }}>{story.body}</div>
      </Card>
    );
  }

  return (
    <>
      <Card style={{
        ...cardTight, borderColor: C.gold,
        background: "linear-gradient(135deg, #14212F 0%, #221E14 100%)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <Eyebrow>Rundens historie</Eyebrow>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            {!seen && (
              <span aria-label="Ulæst" style={{
                width: 8, height: 8, borderRadius: 4, background: C.gold,
              }} />
            )}
            <button style={iconBtn} aria-label="Afvis" onClick={() => onDismiss(story)}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, lineHeight: 1.15 }}>
          {story.headline}
        </div>
        <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.45, marginTop: 6 }}>{story.body}</div>
        <button style={{ ...btnGold, marginTop: 12, width: "100%", justifyContent: "center" }}
          onClick={() => { setOpen(true); onSeen?.(story.id); }}>
          Se din runde <ChevronRight size={14} />
        </button>
      </Card>

      {open && (
        <Frames story={story} frames={frames} token={token} groupId={groupId}
          onClose={() => setOpen(false)} openProfile={openProfile} userId={userId} />
      )}
    </>
  );
}

export default RoundStory;
