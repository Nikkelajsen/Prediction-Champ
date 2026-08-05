// De små ting, appen husker på ENHEDEN — og hvem de husker dem for.
//
// Nøglerne lå før spredt i fem filer (onboarding.js, MainApp, LigaerTab,
// usePushOptIn, ChampionshipTab), mens listen over dem lå i supabase.js. To
// steder at holde i trit er ét for meget: guard-testen i data/account.test.js
// findes udelukkende for at fange den skævhed. Nu bor navnene og adgangen til
// dem samme sted, og listen bygges af navnene i stedet for at gentage dem.
//
// ── Hvorfor et bruger-id i VÆRDIEN ──────────────────────────────────────────
// localStorage er bundet til browseren, men næsten alle flagene beskriver en
// BRUGER: har DU set introduktionen, har DU lukket liga-forslaget, har DU sagt
// nej til notifikationer. Så længe værdien bare var "1", arvede den næste konto
// på samme telefon den forriges svar.
//
// Det var ikke teoretisk. `pc_onboarding_v1_complete` fra en tidligere konto
// fik MainApp til at springe onboarding-proben helt over, så `onboarding` blev
// stående som `null` — og dermed forsvandt BÅDE guiden og "Kom godt i gang"-
// kortet. En nyoprettet bruger mødte en Hjem-skærm med kun sit eget navn på og
// ingen vej videre. clearAllLocalState() ryddede nøglerne, men kun ved
// kontolukning; et log ud efterfulgt af en NY konto er en anden vej, og det er
// præcis den vej en tester og en delt telefon går.
//
// Id'et lægges i værdien og ikke i nøglenavnet, fordi navnene har tre andre
// aftagere: LOKALE_NØGLER rydder på eksakte navne, guard-testen opremser dem,
// og privatlivspolitikken (src/lib/legal.js) beskriver dem. Et suffiks på
// nøglen ville bryde alle tre; et suffiks på værdien rører ingen af dem.
//
// Alle tre aftagere har nu en test. Den tredje kom sidst (`G71`, august 2026)
// og er den eneste, der ikke kunne bygges som et navne-match: politikken siger
// "om du har lukket kortet om notifikationer" og ikke `pc_push_dismissed`, så
// koblingen bor i en oversættelsestabel i src/lib/legal.test.js. Tilføjes en
// nøgle her, kræver den derfor to linjer dér — en i tabellen og en i teksten.

// ---------- nøglerne ----------

// Sessionen selv er ikke bruger-specifik — den ER brugeren.
const SESSION_KEY = "pc_session";

const PING_KEY = "pc_last_ping";                  // aktivitets-ping, throttle
const FLOW_KEY = "pc_onboarding_v1_flow";         // "done" | "skipped"
const CARD_KEY = "pc_onboarding_v1_card";         // "1" = checklisten er skjult
const COMPLETE_KEY = "pc_onboarding_v1_complete"; // "1" = færdig, spring proben over
const PUSH_DISMISS_KEY = "pc_push_dismissed";
const NUDGE_KEY = "pc_liga_nudge_dismissed";
const SEASON_LEAGUE_KEY = "pc_season_league";
const PWA_ONBOARDED_KEY = "pc_pwa_onboarded";
// Hvilke konkurrencer har brugeren allerede set slutte? Værdien er en
// KOMMASEPARERET liste af id'er — ikke én nøgle pr. konkurrence.
//
// Formen er ikke tilfældig: navnene har tre andre aftagere (LOKALE_NØGLER
// rydder på eksakte navne, guard-testen opremser dem, og privatlivspolitikken
// beskriver dem), så et suffiks på NØGLEN ville bryde alle tre — mens et suffiks
// på værdien ikke rører nogen af dem. Samme argument som bruger-id'et nedenfor.
const COMP_DONE_KEY = "pc_comp_done_seen";

// Alt, appen har lagt på enheden — ikke kun sessionen.
//
// Bruges når en konto LUKKES (B4), ikke ved et almindeligt log ud. Forskellen
// er, hvem der sidder med telefonen bagefter: ved et log ud er det den samme
// person, som gerne må slippe for introduktionen igen — og siden flagene nu
// bærer et bruger-id, kan den næste konto ikke arve dem alligevel. Ved en
// lukket konto er der ingen at huske noget for, og så skal sporene væk.
//
// Listen skal holdes i trit med privatlivspolitikkens afsnit om lokale data
// (src/lib/legal.js): står en nøgle ikke her, bliver den heller ikke ryddet.
// Siden `G71` håndhæves den anden halvdel af kravet af en test —
// src/lib/legal.test.js fejler, hvis en nøgle her mangler sin sætning dér.
const LOKALE_NØGLER = [
  SESSION_KEY,
  PING_KEY,
  FLOW_KEY,
  CARD_KEY,
  COMPLETE_KEY,
  PUSH_DISMISS_KEY,
  NUDGE_KEY,
  SEASON_LEAGUE_KEY,
  PWA_ONBOARDED_KEY,
  COMP_DONE_KEY,
];

// ---------- de rå, enheds-globale læse/skrive ----------

// localStorage kan være utilgængelig (privat browsing, blokerede cookies).
// Intet af det, der gemmes her, må kunne vælte en skærm, så begge veje er
// stille — en manglende hukommelse betyder bare, at appen spørger igen.
function readFlag(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeFlag(key, value) {
  try { localStorage.setItem(key, value); } catch { /* utilgængelig — spring over */ }
}
function removeFlag(key) {
  try { localStorage.removeItem(key); } catch { /* utilgængelig — spring over */ }
}

// ---------- de bruger-bundne ----------

// "@" kan ikke optræde i et uuid, så den kan skille værdi fra ejer uden at
// kunne forveksles med indholdet. `lastIndexOf` og ikke `indexOf`: det er
// EJEREN, der står til højre, og en fremtidig værdi må gerne indeholde tegnet.
const OWNER_SEP = "@";

// Returnerer værdien, hvis flaget tilhører `userId` — ellers `null`.
//
// Et flag UDEN ejer stammer fra før denne opdeling og tilhører per definition
// ingen. Det ignoreres frem for at blive tildelt den, der tilfældigvis logger
// ind først: netop dén migrering ville gen-indføre fejlen for en bruger, der
// opretter en ny konto lige efter et log ud. Prisen er, at en eksisterende
// bruger ser fx PWA-modalen og liga-forslaget én gang mere — en engangsudgift,
// der betales i det øjeblik, flaget skrives igen med ejer på.
function readUserFlag(key, userId) {
  const raw = readFlag(key);
  if (!raw || !userId) return null;
  const i = raw.lastIndexOf(OWNER_SEP);
  if (i < 0) return null;
  if (raw.slice(i + 1) !== String(userId)) return null;
  // En tom værdi ("@uid") betyder "sat", ikke "ikke sat" — kalderne bruger
  // flest af flagene som rene ja/nej.
  return raw.slice(0, i) || "1";
}

function writeUserFlag(key, userId, value = "1") {
  if (!userId) return; // uden ejer kan flaget ikke læses igen — så lad være
  writeFlag(key, `${value}${OWNER_SEP}${userId}`);
}

// ---------- listeflaget: sete konkurrence-afslutninger ----------
//
// Læse/skrive-parret bor her og ikke hos kalderen, fordi FORMATET er det, der
// skal holdes ét sted: to skærme viser fejringen (Ligaer-fanen og liga-siden),
// og en kommasepareret liste, der parses to steder, er én kommasepareret liste
// for meget.
const MAX_SEEN = 50; // en liste, der kun vokser, ender som et localStorage-loft

function readSeenCompletions(userId) {
  const raw = readUserFlag(COMP_DONE_KEY, userId);
  if (!raw || raw === "1") return new Set(); // "1" = sat uden indhold (se readUserFlag)
  return new Set(raw.split(",").filter(Boolean));
}

// Returnerer den opdaterede mængde, så kalderen kan gentegne uden at læse igen.
function markCompletionSeen(userId, competitionId) {
  const seen = readSeenCompletions(userId);
  if (seen.has(competitionId)) return seen;
  seen.add(competitionId);
  // De ÆLDSTE ryger først. At tabe en gammel post koster i værste fald én
  // gentaget fejring for en konkurrence, brugeren ikke har set i lang tid.
  const ids = [...seen].slice(-MAX_SEEN);
  writeUserFlag(COMP_DONE_KEY, userId, ids.join(","));
  return new Set(ids);
}

export {
  SESSION_KEY, PING_KEY, FLOW_KEY, CARD_KEY, COMPLETE_KEY,
  PUSH_DISMISS_KEY, NUDGE_KEY, SEASON_LEAGUE_KEY, PWA_ONBOARDED_KEY, COMP_DONE_KEY,
  LOKALE_NØGLER,
  readFlag, writeFlag, removeFlag, readUserFlag, writeUserFlag,
  readSeenCompletions, markCompletionSeen,
};
