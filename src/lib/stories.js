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

// Prioritetsstige (lavere tal = vigtigere). Én kilde til sandhed for regel-metadata.
// Værdien her er reglens STÆRKE prioritet; tre regler har også en svag variant,
// se SOFT_PRIORITY og priorityFor() nedenfor.
export const RULES = {
  MONTH_CHAMP: 10,
  // Lokal månedstitel: større end alt, hvad én runde kan producere, mindre end
  // den globale månedstitel.
  AWARD_MONTH: 15,
  LEAD_TAKEN: 20,
  LEAD_LOST: 21,
  PODIUM_ENTER: 22,
  RATING_HIGH: 30,
  H2H_PASS: 40,
  CLOSING_IN: 45,
  COMEBACK: 50,
  PERSONAL_BEST: 55,
  STREAK: 60,
  // Lokal ugetitel. Ligger LIGE over rundens vinder, fordi det er det samme
  // øjeblik set fra konkurrencens eget navnesystem — og når den findes, springer
  // ROUND_WON over (se sql/story_engine.sql regel 70).
  AWARD_WEEK: 65,
  ROUND_WON: 70,
  SHARP: 80,
  // Dæmpet tier (≥ QUIET_TIER_MIN): genereres KUN for brugere, der ellers ville
  // stå helt uden historie i runden. Renderes uden guld, uden emoji og uden Del.
  SEASON_OPENER: 90,
  QUIET_ROUND: 100,
};

// ---------------------------------------------------------------------------
// v2 (august 2026) — DAGLIGE historier.
//
// Reglerne ovenfor hører til RUNDEN og udløses, når rundens sidste resultat er
// inde. Reglerne herunder hører til DAGEN og udløses, når dagens sidste kamp er
// færdigspillet. Kortene akkumulerer gennem runden i karusellen på Hjem, og på
// rundens sidste dag lægger runde-kortet sig øverst.
//
// BÅNDET 110–189 ER VALGT MED VILJE og ikke som en parallel 10–100-stige:
//   1) karriereprofilens milepæle filtrerede på `priority < QUIET_TIER_MIN`, så
//      dagskort udelukkes AUTOMATISK fra arkivet. En parallel stige ville have
//      oversvømmet minde-listen med "Dagens facit: 4 point" — netop den fejl,
//      v2 er sat i verden for at rette.
//   2) en forespørgsel, der glemmer at filtrere på periode, men sorterer på
//      prioritet, sætter stadig runde-kort først. Sikker degradering.
//   3) isQuiet() beholder sin betydning for latest_story, som nu er runde-only.
// v3 (august 2026): MILESTONE er kommet til som dagbåndets top, og DAY_RESULT
// er flyttet fra 110 til 180 — det reserverede dæmpede tier er taget i brug.
// Med grundvægt 8 kan dagens facit aldrig nå publiceringstærsklen ved egen
// kraft (8 + 12 + 20 = 40 < 45), så den udgives KUN som fald-tilbage, og et
// fald-tilbage skal se dæmpet ud.
export const DAILY_RULES = {
  MILESTONE: 110,
  CONTRARIAN: 120,
  COLLECTIVE_MISS: 125,
  DAY_TOP: 130,
  STREAK_STATUS: 140,
  DUEL: 150,
  SO_CLOSE: 160,
  DAY_RESULT: 180,
};

// Båndets grænser. 180–189 er det dæmpede dagstier.
export const DAILY_TIER_MIN = 110;
export const DAILY_QUIET_MIN = 180;
export function isDaily(priority) {
  return (priority ?? 0) >= DAILY_TIER_MIN;
}
// Dæmpet dagskort: mindre overskrift, ingen emoji, ingen ulæst-markering.
export function isDailyQuiet(priority) {
  return (priority ?? 0) >= DAILY_QUIET_MIN;
}

// Højst så mange dagskort pr. bruger pr. dag. ÉT — på tværs af alle
// konkurrencer. I v2 var tallet 2 og loftet "pr. regel, derefter i alt"; nu er
// der kun ét slot, og det håndhæves af et unikt indeks på (user_id, day_key) i
// databasen frem for af koden her. Konstanten står tilbage som den værdi,
// frontenden regner med at møde.
export const DAILY_MAX_CARDS = 1;

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

// Svage varianter (v1.1). Tærsklen for tre regler er sænket, så de udløses oftere,
// men den svage udgave får et højere prioritetstal og kan derfor kun vises, når der
// ikke er noget bedre. Princippet: **tærsklen afgør, om historien findes;
// prioriteten afgør, om den vises.** 75 ligger under rundens vinder (70), så
// "2. sejr i træk mod Jimmy" aldrig fortrænger "du vandt runden".
export const SOFT_PRIORITY = { COMEBACK: 75, STREAK: 75, SHARP: 85 };

// Grænsen mellem højdepunkt og dæmpet tier. Bruges af frontenden (kort-stil) og af
// karriereprofilens milepæle, som kun må vise rigtige historier.
export const QUIET_TIER_MIN = 90;
export function isQuiet(priority) {
  return (priority ?? 0) >= QUIET_TIER_MIN;
}

// Tærskler (spec afsnit 3). Kalibreret på live-data juli 2026 (beslutning A4):
// comeback 3→2 pladser og 5→4 deltagere, stime 3→2 runder, præcise 3→2 — alle med
// en svag variant, jf. SOFT_PRIORITY. `*Strong` er grænsen for den stærke prioritet.
export const THRESHOLDS = {
  comebackPlaces: 2, comebackStrongPlaces: 3, comebackMinPlayers: 4,
  streakRounds: 2, streakStrongRounds: 3,
  sharpExact: 2, sharpStrongExact: 3,
  podiumMinPlayers: 6, closingInMaxGap: 3,
};

// Prioriteten for en udløst regel. Spejler `case`-udtrykkene i sql/story_engine.sql:
// `strength` er antallet, der afgør styrken (rykkede pladser / sejre i træk / præcise).
export function priorityFor(rule, strength) {
  switch (rule) {
    case "COMEBACK": return strength >= THRESHOLDS.comebackStrongPlaces ? RULES.COMEBACK : SOFT_PRIORITY.COMEBACK;
    case "STREAK": return strength >= THRESHOLDS.streakStrongRounds ? RULES.STREAK : SOFT_PRIORITY.STREAK;
    case "SHARP": return strength >= THRESHOLDS.sharpStrongExact ? RULES.SHARP : SOFT_PRIORITY.SHARP;
    default: return RULES[rule] ?? DAILY_RULES[rule] ?? null;
  }
}

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

// Deterministisk udvælgelse: præcis én historie pr. bruger pr. runde.
// Laveste priority; ved lighed største liga (league_size); dernæst competition_id
// (garanteret unik tiebreak). Spejler latest_story-viewets ORDER BY. Returnerer
// null hvis der ingen kandidater er (= stilhed → intet kort).
export function pickStory(candidates) {
  if (!candidates || !candidates.length) return null;
  const ranked = candidates.slice().sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const as = a.league_size ?? -1, bs = b.league_size ?? -1; // null sidst (nulls last)
    if (as !== bs) return bs - as;
    return String(a.competition_id ?? "").localeCompare(String(b.competition_id ?? ""));
  });
  return ranked[0];
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
