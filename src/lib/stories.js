// Story Engine — ren regel-logik (prioritering, udvælgelse, frame-rendering).
//
// Selve genereringen sker i databasen (sql/story_engine.sql, generate_stories),
// som gemmer færdig headline+body på rækken. Dette modul spejler prioriterings-
// og udvælgelsesreglen, så logikken kan enhedstestes (vitest, jf.
// docs/features/story-engine-v1.md afsnit 9).
//
// RUNDE- OG DAGSKORTENES TEKSTER STÅR IKKE HER (G86, 8. august 2026).
// Filen bar frem til august 2026 en `renderStory()` med skabeloner for alle 16
// regler, beskrevet som en "fallback-rendering fra payload", som SKULLE holdes i
// sync med SQL'ens tekster. Den fallback blev aldrig taget i brug: ingen skærm
// kaldte funktionen, og eneste aftager var dens egne 36 testkald. Prisen var
// ikke en fejl, men en skjult dobbeltvedligeholdelse — `A38` rettede tre reglers
// overskrifter til datid og skulle røre begge steder, hvoraf kun det ene kunne
// ses af en bruger. Teksterne bor nu ét sted: sql/story_engine.sql og
// sql/story_engine_v3.sql. Samme oprydning og samme begrundelse som `G78` én dag
// tidligere, hvor v3's scoringstal viste sig at være en død kopi med sin egen
// test som eneste aftager.
//
// FRAMES ER NOGET ANDET og bliver: `renderFrame()` nedenfor er den ENESTE kilde
// til rundestoryens frame-tekster — SQL'en bygger `payload.frames` som rene
// data, og teksten skrives her. Ingen kopi, intet at holde i sync.
//
// v1.1 (juli 2026): tre nye regler (PODIUM_ENTER, CLOSING_IN, PERSONAL_BEST),
// sænkede tærskler med svag prioritet (SOFT_PRIORITY) og et dæmpet tier
// (SEASON_OPENER, QUIET_ROUND), der kun genereres, når intet andet udløses.
//
// v1.2 (august 2026): to regler for de LOKALE kåringer (AWARD_WEEK,
// AWARD_MONTH). De læser `competition_awards` i SQL'en frem for at regne noget
// om, så et kort aldrig kan modsige den kåring, boardet viser.
//
// v3 (august 2026): motoren VÆLGER frem for at udgive. Ét kort pr. bruger pr.
// dag, valgt på en nyhedsværdi-score, der bor i SQL'en alene (G78), og
// rundekortet er blevet en tap-through-story med frames (renderFrame).

import { renderMilestone } from "./milestones.js";
import { roundLabel } from "./scoring.js";

// PRIORITETSSTIGEN STÅR IKKE HER (G86, 8. august 2026).
//
// Filen bar frem til august 2026 to regelkataloger — `RULES` (16 runderegler)
// og `DAILY_RULES` (8 dagsregler) — med hver regels prioritetstal, plus
// `SOFT_PRIORITY`, `THRESHOLDS` og `priorityFor()`, der spejlede SQL'ens
// `case`-udtryk. **Ikke én af dem havde en aftager i appen.** Motoren kører i
// databasen og skriver `priority` på rækken; frontenden læser tallet og har
// aldrig haft brug for at kunne udlede det. Deres eneste aftagere var deres
// egne enhedstests, og de tests var selvrefererende: de påstod, at en JS-kopi
// var internt konsistent, hvilket ville have været sandt, uanset hvor langt
// SQL'en var drevet fra den.
//
// Tallene bor nu ét sted, i `sql/story_engine.sql` og `sql/story_engine_v3.sql`.
// **Regelnavnene har stadig et katalog i JS**, men det er `STORY_RULES` i
// `src/lib/analytics.js`, som har en rigtig aftager (Analytics kan ikke vise en
// regel, der aldrig har udløst) og en test, der læser `sql/story_engine*.sql`
// og fejler ved drift. Det er forskellen på de to: dette katalog blev vogtet
// mod SQL'en, katalogerne her blev vogtet mod sig selv.

// ---------------------------------------------------------------------------
// DAGSKORTETS DÆMPEDE TIER
//
// Dagbåndet er 110–189, og 180–189 er det dæmpede tier. BÅNDET ER VALGT MED
// VILJE og ikke som en parallel til rundens 10–100-stige:
//   1) karriereprofilens milepæle filtrerer på `priority < 90`, så dagskort
//      udelukkes AUTOMATISK fra arkivet. En parallel stige ville have
//      oversvømmet minde-listen med "Dagens facit: 4 point" — netop den fejl,
//      v2 er sat i verden for at rette.
//   2) en forespørgsel, der glemmer at filtrere på periode, men sorterer på
//      prioritet, sætter stadig runde-kort først. Sikker degradering.
//
// v3 (august 2026): MILESTONE er dagbåndets top (110), og DAY_RESULT er flyttet
// fra 110 til 180 — det reserverede dæmpede tier er taget i brug. Med grundvægt
// 8 kan dagens facit aldrig nå publiceringstærsklen ved egen kraft
// (8 + 12 + 20 = 40 < 45), så den udgives KUN som fald-tilbage, og et
// fald-tilbage skal se dæmpet ud.
//
// TALLET 180 STÅR OGSÅ I SQL'EN og er dermed det sidste sted, hvor JS og SQL
// deler en konstant. Invarianten `priority < 180 ⟺ over tærsklen` er låst af
// påstand 14 i sql/tests/story_engine_daily.sql.
export const DAILY_QUIET_MIN = 180;

// Dæmpet dagskort: mindre overskrift, ingen emoji, ingen ulæst-markering.
export function isDailyQuiet(priority) {
  return (priority ?? 0) >= DAILY_QUIET_MIN;
}

// ---------------------------------------------------------------------------
// v3 · NYHEDSVÆRDI — OG HVORFOR DEN IKKE STÅR HER (G78, 7. august 2026)
//
//   nyhedsværdi = grundvægt + størrelse + nærhed   (spec §4)
//
// Frem til august 2026 stod hele regnestykket ogsÅ her: otte grundvægte, tre
// størrelseslofter med hver sin sats, fire nærhedsled, publiceringstærsklen og
// selve udvælgelsen (`sizeOf`, `proximityOf`, `scoreDailyCandidates`,
// `pickDay`). Det var en KOPI af sql/story_engine_v3.sql, og det er den værste
// slags dobbelthed: en afvigelse i en grundvægt giver ikke en fejl og ikke en
// forkert formulering, men et ANDET kort — uden log, uden at nogen opdager det.
//
// KOPIEN VAR DESUDEN DØD. Ikke én af de fire funktioner blev kaldt af appen;
// motoren kører i databasen, og frontenden læser den færdige række. Deres
// eneste aftagere var deres egne enhedstests — altså tal, der blev holdt i trit
// med SQL'en for at holde en test grøn, som beviste, at de var i trit med
// SQL'en. Tallene bor nu ét sted: sql/story_engine_v3.sql, hvor motoren er, og
// sql/tests/story_engine_daily.sql påstår dem mod en rigtig PostgreSQL.
//
// TILBAGE ER ÉT SPØRGSMÅL, frontenden faktisk skal svare på: fortjener kortet
// en ulæst-markering? Se `isNewsworthy()` nedenfor — svaret kræver ikke
// tærsklen, og det er hele grunden til, at rækken kunne lukkes uden en
// migrering, sådan som backloggen ellers forudsagde.

// Fortjener kortet en ulæst-markering? Et badge, der lyser hver dag, er ikke et
// signal, det er en baggrundsfarve.
//
// SPØRGSMÅLET ER ALLEREDE BESVARET, når rækken skrives, og derfor står tærsklen
// ikke her (G78). `generate_daily_stories()` har to udgange, og de er
// udtømmende for et v3-dagskort:
//
//   · vinderen over tærsklen udgives med sin egen regels prioritet (110–160),
//   · alt andet udgives som dæmpet DAY_RESULT med prioritet 180.
//
// Prioriteten er dermed selve afgørelsen, gemt på rækken. Dagens facit kan
// aldrig nå tærsklen ved egen kraft (8 + 12 + 20 = 40 < 45, spec §5), så et
// kort med prioritet under 180 ER et kort over tærsklen — og omvendt. Milepæls-
// kapringen skriver 110 og passer ind i samme regel.
//
// At læse prioriteten er ikke en genvej, men den GRÆNSEFLADE, motoren selv
// udpeger: sql/story_engine_v3.sql skriver, at prioriteten er beholdt netop
// fordi tre ting uden for filen læser den, og `isDailyQuiet()` er den ene af de
// tre. Invarianten er låst af en påstand i sql/tests/story_engine_daily.sql, så
// en fremtidig tredje udgang ikke kan opstå i tavshed.
//
// `news_value != null` skiller v3 fra de historiske v2-rækker — samme
// æra-markør som det unikke indeks i migreringen bruger. En v2-række har ingen
// tærskel at være over.
export function isNewsworthy(story) {
  if (!story) return false;
  return story.news_value != null && !isDailyQuiet(story.priority);
}

// Udløb: et kort ældre end dette vises ikke, selvom rækken bliver stående.
// Uden det er "dagens historie" en løgn på en tirsdag efter en stille weekend.
export const DAY_CARD_MAX_AGE_MS = 48 * 60 * 60 * 1000;

// RUNDESTORYEN HAR ET ANDET UR, og det er hele forskellen mellem de to formater.
//
// Dagskortet handler om ÉN aften og bliver en løgn, så snart aftenen er to døgn
// gammel. Rundestoryen er ugens konklusion og skal leve, indtil den nye runde
// har noget at fortælle — altså indtil dagsmotoren udgiver sit første kort i
// den. Den afløsning sker af sig selv i visningsreglen (`roundIsNewer` i
// HjemTab): et nyere dagskort er per konstruktion fra den NYE runde, fordi
// triggeren kører dagene før runden, så den gamle rundes dagskort altid er
// ældre end rundekortet.
//
// Loftet her er derfor ikke det, der normalt afløser rundestoryen — det er et
// værn mod SÆSONPAUSEN. Uden det ville den sidste runde før en pause stå på
// Hjem i månedsvis, fordi der aldrig kom et nyere dagskort at afløse den med.
// Fjorten dage = den følgende runde plus slæk til en runde, der sluttede sent.
export const ROUND_STORY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function isFresh(story, now = Date.now(), maxAge = DAY_CARD_MAX_AGE_MS) {
  if (!story?.created_at) return false;
  const t = Date.parse(story.created_at);
  return Number.isFinite(t) && now - t < maxAge;
}

// ---------------------------------------------------------------------------
// Rundestoryen skal trække sig, når virkeligheden er løbet fra den
// ---------------------------------------------------------------------------
// Rundestoryens overskrifter er udsagn om en STILLING ("du er nu foran Lis04"),
// og en stilling er live pr. kamp: `computeCompetitionState` medregner en runde,
// så snart ÉN kamp i den har resultat. Afløseren — dagskortet — skrives derimod
// først, når HELE kampdagen er færdigspillet, og komplethedsprædikatet er globalt
// over alle turneringer. Mellem "første resultat i den nye runde" og "dagens
// sidste kamp er fløjtet af" stod Hjem derfor med et kort, STILLING modsagde. Det
// hul er ikke teoretisk: det blev rapporteret 7. august 2026.
//
// Ét resultat er nok til at trække kortet. Ét resultat kan flytte en duel.
export function roundStorySuperseded(story, round) {
  if (!story || !round) return false;      // ingen rundedata → intet at modsige
  if (!round.playedCount) return false;    // den nye runde har intet fortalt endnu
  // STRENGT større: er runden den samme som storyens, handler kortet om præcis
  // den runde, skærmen viser, og skal blive stående hele vejen igennem den.
  return String(round.roundKey || "") > String(story.round_key || "");
}

// Overskriftslinjen på rundekortet bærer rundens interval: "Rundens historie ·
// 28.07 – 03.08". Uden datoen læses en overskrift uden tidsangivelse som en
// påstand om NU — og brødteksten, der har båret "Efter runden …" hele tiden,
// læses først bagefter. Etiketten udledes af `round_key`, så den virker på
// rækker, der allerede står i databasen; ingen migrering, ingen genberegning.
//
// Nøglen valideres, fordi roundLabel() på en ugyldig streng ville skrive
// "Invalid Date – Invalid Date" hen over kortet.
export const ROUND_STORY_EYEBROW = "Rundens historie";

export function roundStoryEyebrow(story) {
  const key = String(story?.round_key || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return ROUND_STORY_EYEBROW;
  return `${ROUND_STORY_EYEBROW} · ${roundLabel(key)}`;
}

// ---------------------------------------------------------------------------
// v3 · RUNDESTORYENS FRAMES
//
// Rundens sidste dag udgiver kun rundekortet, og det er til gengæld den ene
// gang om ugen, tap-through er sit besvær værd. Frames bygges i SQL
// (build_round_frames) og gemmes i payload.frames; teksten bor KUN her.
//
// Frame 1 og 3 skal kunne stå alene som delt billede uden kontekst — det er de
// to, folk sender videre. Derfor er deres overskrifter hele sætninger.
//
// En frame, der mangler sine data (ingen ratingrække, ingen tips i runden),
// returnerer null og springes over af visningen frem for at vise tomme felter.
export function renderFrame(frame = {}) {
  const f = frame;
  switch (f.frame) {
    case "ROUND_SUM":
      return {
        eyebrow: `Din runde ${f.label || ""}`.trim(),
        headline: `${f.points ?? 0} point`,
        body: [
          f.exact > 0 ? `${f.exact}${f.exact === 1 ? " præcist resultat" : " præcise resultater"}` : null,
          f.percentile != null ? `Bedre end ${f.percentile} % af feltet` : null,
          f.rank != null && f.total != null ? `Nr. ${f.rank} af ${f.total}` : null,
        ].filter(Boolean).join(" · "),
      };
    case "BEST_WORST": {
      if (!f.best) return null;
      const line = (t) => `${t.home}–${t.away}: du tippede ${t.guess}, det endte ${t.score}`;
      return {
        eyebrow: "Kampen der afgjorde det",
        headline: `${line(f.best)} — ${f.best.points} point`,
        // Den værste nævnes uden bebrejdelse: kampen, ikke tippet, er emnet.
        body: f.worst ? `Den anden vej: ${line(f.worst)}.` : "",
      };
    }
    case "RATING": {
      if (f.rating == null) return null;
      const d = Number(f.delta ?? 0);
      const sign = d > 0 ? "+" : "";
      return {
        eyebrow: "Rating",
        headline: `${Math.round(Number(f.rating))} (${sign}${Math.round(d)})`,
        body: [
          f.rank != null ? `Nr. ${f.rank} på ranglisten` : null,
          f.moved ? (f.moved > 0 ? `${f.moved} pladser frem` : `${Math.abs(f.moved)} pladser tilbage`) : null,
        ].filter(Boolean).join(" · "),
      };
    }
    case "CHAMPION": {
      if (!f.winner) return null;
      return {
        eyebrow: "Rundens Champion",
        headline: `${f.shared ? "Delt: " : ""}${f.winner} — ${f.winner_points} point`,
        body: f.month_rank != null
          ? `I Månedsligaen ligger du nr. ${f.month_rank} af ${f.month_total} med ${f.month_points} point.`
          : "",
      };
    }
    case "MILESTONE": {
      const m = renderMilestone(f.milestone_key, f.milestone_payload || {});
      return { eyebrow: "Ny milepæl", headline: `${m.icon} ${m.title}`, body: m.body };
    }
    default:
      return null;
  }
}

// Frames, der faktisk kan vises. En rundestory med kun to brugbare frames er
// stadig en story — den har bare færre sider.
export function usableFrames(payload) {
  return (payload?.frames || [])
    .map((f) => ({ raw: f, view: renderFrame(f) }))
    .filter((x) => x.view);
}
