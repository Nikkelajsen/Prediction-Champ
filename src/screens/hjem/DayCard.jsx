// Story Engine v3 — dagens ENE kort på Hjem.
//
// Afløser `StoryCarousel.jsx`. Forskellen er ikke kosmetisk: karusellen var et
// vandret felt med op til ti kort, som man rydder eller ignorerer, og v3's
// diagnose var, at et øjeblik delt med ni andre ikke er et øjeblik. Her er der
// ét kort, og hvilket ét er afgjort af nyhedsværdien i databasen.
//
// DEL OG AFVIS KOM TIL 15. AUGUST 2026 — og spec'en sagde nej til begge.
//
//   · §7 skrev *"Delefunktionen ligger kun her [rundestoryen]; hverdagskortet
//     har den ikke længere"* — begrundelsen var, at en delefunktion på hver
//     flade gør ingen af dem til noget særligt.
//   · §8 skrev *"Ingen friktion, intet at åbne, intet at rydde"* — kortet
//     udløber jo af sig selv efter 48 timer.
//
// Begge argumenter er stadig rigtige om det, de handlede om: at UDBREDE deling
// udvander den, og at et kort med udløbsdato ikke SKAL ryddes. Det, de begge
// overså, er, at brugeren kan have en grund, produktet ikke har: dagens facit
// er dét, man sender i en ligachat, og et kort, man er færdig med, vil man
// gerne af med nu og ikke om halvandet døgn. Ingen af de to sætninger stod i
// spec'ens §2 "Låste beslutninger".
//
// Prisen er betalt to steder frem for ved at lade være:
//   · Del vises IKKE på påmindelseskortet (`variant === 'no_tips'`) —
//     `isShareableDayCard()` i src/lib/stories.js bærer reglen og begrundelsen.
//   · Ulæst-prikkens tærskel er URØRT. Prikken siger stadig kun noget ved
//     `news_value ≥ 45`; det er den, der skulle være sjælden, og den er det.
//
// HVAD DER STADIG BEVIDST IKKE ER HER
//   · Ingen tap-through. Hverdagen er ét blik.
//   · **Ingen tips-status.** Kortet bar frem til 14. august 2026 en fod med
//     enten "N kampe mangler tips" eller "Næste kamp: …". Den var en DUBLET i
//     alle tre tilstande — deadline-kortet, det grønne "alt ok" og "intet at
//     tippe lige nu" står hver især umiddelbart under kortet og siger det
//     samme, med nedtælling, rundenavn og kampnavne oveni. Betingelserne var
//     ordret de samme udtryk (`tips.allTipped === false`), så foden kunne pr.
//     konstruktion aldrig være en faldback for noget, skærmen ikke allerede
//     sagde bedre 40 px længere nede.
//
//     Prisen var kortets pointe: et kort, der er VALGT af en nyhedsværdi-score
//     til at bære dagens ene øjeblik, sluttede på en administrativ opgave frem
//     for på sin mini-stilling. Rundestoryen — det større format — har aldrig
//     haft en sådan fod, og asymmetrien var utilsigtet.
//
//     Spec §8 opregner "næste kamp og evt. manglende tips" som en del af
//     kortets indhold, og filen her skrev *"står PÅ kortet og ikke i et kort
//     mere"*: planen var, at kortet skulle ERSTATTE deadline-kortet. Det skete
//     aldrig — deadline-kortet er Hjems signatur — så de stod side om side.
//     Spec'en er rettet frem for at koden er.
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
import { Share2, X } from "lucide-react";
import { logEvent, logEventOnce } from "../../lib/analytics.js";
import { shareImage, storyShareText } from "../../lib/share.js";
import { drawStoryCard } from "../../lib/shareCanvas.js";
import { isDailyQuiet, isNewsworthy, isShareableDayCard } from "../../lib/stories.js";
import { C, font, iconBtn } from "../../ui/theme.js";
import { Card, Eyebrow } from "../../ui/components.jsx";
import { cardTight } from "./shared.js";

// Mini-stillingen: tre rækker omkring modtageren fra kortets konkurrence.
// Pakket af SQL'en i payload.mini, fordi navnene skal være afgrænset til
// personer, modtageren deler konkurrence med — den regel er strukturel i
// dagsmotoren og må ikke genopfindes i en komponent.
//
// Globale kort (stimen, milepæle) har ingen konkurrence og dermed ingen mini;
// så udelades sektionen helt frem for at vise en tom ramme.
//
// OVERSKRIFTEN DATERER STILLINGEN, og det er ikke pynt. Rækkerne er et snapshot
// taget, da kampdagen blev gjort færdig, mens kortet lever i 48 timer og
// STILLING-fanen er live pr. kamp — de to KAN modsige hinanden, præcis som
// rundestoryens udaterede overskrift kunne det (A38, august 2026). Datoen er
// samme kur: kortet påstår ikke noget om nuet, det fortæller, hvad der gjaldt
// den dag. Mangler `day` mod forventning, udelades linjen frem for at vise
// "efter kampdag" uden en dag.
function MiniStanding({ rows, day }) {
  if (!rows?.length) return null;
  return (
    <div style={{ marginTop: 10, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
      {day && (
        <div style={{ color: C.muted, fontSize: 11, letterSpacing: 0.3, marginBottom: 4 }}>
          Stillingen efter kampdag {day}
        </div>
      )}
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

function DayCard({ story, token, competitions, seen, onSeen, onDismiss }) {
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
  // Øjenbrynet står ét sted, fordi det nu har to aftagere: kortets egen linje og
  // det delte billede. To udgaver ville drive fra hinanden, og forskellen ville
  // først kunne ses i en beskedtråd.
  const eyebrow = milestone ? "Ny milepæl" : `Kampdag ${story.payload?.day || ""}`.trim();

  // Billedet tegnes af den samme maler som rundestoryens frames
  // (`drawStoryCard`), så de to formater ligner hinanden i modtagerens tråd.
  // MINI-STILLINGEN KOMMER IKKE MED: dens navne er afgrænset til folk, modtageren
  // deler konkurrence med — den regel er strukturel i dagsmotoren, og et billede
  // rejser uden for den afgrænsning. Skal en stilling deles, er det Stilling-
  // skærmens egen Del-knap, hvor brugeren VÆLGER tabellen.
  async function share() {
    try {
      await shareImage((ctx, w, h) => drawStoryCard({ eyebrow, headline: story.headline, body: story.body }, ctx, w, h), {
        // Billedteksten er øjenbrynet — kortets adresse, ikke dets indhold.
        // Overskrift og brødtekst STÅR på billedet, og at sende dem med som
        // tekst gjorde beskeden til den samme historie fortalt to gange.
        caption: eyebrow,
        // Kun hvis billedet ikke kan sendes: da er teksten hele beskeden.
        text: storyShareText(story),
      });
      logEvent(token, "story_shared", {
        competitionId: story.competition_id || null, groupId,
        metadata: { rule: story.rule, from: "day_card" },
      });
    } catch { /* bruger annullerede — ignorér */ }
  }

  return (
    <Card style={{
      ...cardTight,
      ...(gold ? { borderColor: C.gold, background: "linear-gradient(135deg, #14212F 0%, #221E14 100%)" }
        : !quiet ? { borderColor: C.gold } : null),
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <Eyebrow>
          {/* "I dag" stod her indtil august 2026 og var forkert på dag to:
              kortet lever i 48 timer. Samme defekt som rundestoryens udaterede
              overskrift, bare i lille format — datoen er den samme kur. */}
          {eyebrow}
        </Eyebrow>
        {/* Prik, Del, Afvis — samme rækkefølge og samme `iconBtn` som
            rundestoryens indgangskort, så "kortets egne handlinger" er ét
            mønster og ikke to. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          {/* Ulæst-prikken er HELE pointen med tærsklen. Et badge, der lyser hver
              dag, er ikke et signal, det er en baggrundsfarve — derfor vises den
              aldrig på det dæmpede kort, uanset hvor længe det har stået ulæst.
              Del-knappen ændrer den regel IKKE: at et kort kan sendes videre er
              ikke det samme som, at det er værd at afbryde for. */}
          {unread && (
            <span aria-label="Ulæst" style={{
              width: 8, height: 8, borderRadius: 4, background: C.gold, flexShrink: 0,
            }} />
          )}
          {isShareableDayCard(story) && (
            <button style={iconBtn} aria-label="Del" onClick={share}>
              <Share2 size={16} />
            </button>
          )}
          {onDismiss && (
            <button style={iconBtn} aria-label="Afvis" onClick={() => onDismiss(story)}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div style={{
        fontFamily: font.display, fontSize: quiet ? 17 : 20, fontWeight: 700, lineHeight: 1.15,
      }}>
        {story.headline}
      </div>
      <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.45, marginTop: 6 }}>{story.body}</div>

      {/* Mini-stillingen er kortets AFSLUTNING og ikke dets næstsidste afsnit.
          Se filhovedet: her stod tips-status, og den tog den plads. */}
      <MiniStanding rows={story.payload?.mini} day={story.payload?.day} />
    </Card>
  );
}

export default DayCard;
