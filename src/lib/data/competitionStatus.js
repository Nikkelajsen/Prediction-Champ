// Status for MANGE konkurrencer på én gang: er den afsluttet, hvor langt er
// den, og mangler jeg tips i næste runde.
//
// ---------------------------------------------------------------------------
// Hvorfor den findes
//
// Ligaer-fanen og liga-siden tegner et kort pr. konkurrence, og kortet skal
// kende tre ting. Indtil nu blev de hentet ved at kalde `computeCompetitionState`
// — appens tungeste loader, seks kald pr. konkurrence — én gang pr. kort, alene
// for at kunne skrive "afsluttet" og "12/34 spillet". Belastningen voksede
// lineært med antallet af konkurrencer, altså netop for de mest aktive brugere.
//
// Her hentes det samme med FIRE opslag i alt, uanset hvor mange konkurrencer der
// er. `computeCompetitionState` bruges herefter kun, hvor hele stillingen
// faktisk skal bruges: på boardet og til vinderlinjen på et afsluttet kort.
//
// ---------------------------------------------------------------------------
// "Afsluttet" er databasens svar, ikke klientens
//
// `concluded` kommer fra viewet `public.competition_status` (sql/season_end.sql).
// Det er med vilje: klientens gamle regel var "alle kampe har resultat", og den
// er FORKERT for en konkurrence, der stadig kan vokse — en sæson med flere
// stages får slutspillet skemalagt undervejs, så mellem sidste grundspilsrunde
// og udgivelsen af slutspillet var den regel trivielt sand. Viewet kender
// forskellen, og det er samme svar, milepælene og kåringerne bruger.

import { db } from "../supabase.js";
import { nextRoundTips } from "../scoring.js";
import { selectIn } from "./chunked.js";

// Tom status — formen skal være ens, uanset om vi nåede at hente noget.
const EMPTY = {
  matches: 0, scoredMatches: 0, concluded: false, canGrow: false,
  nextRoundKey: null, nextRoundAllTipped: false, hasNextRound: false,
};

// Status for hver af `compIds`. Returnerer et objekt med ét felt pr. id — også
// for konkurrencer, der ingen kampe har endnu (de får `EMPTY`, ikke `undefined`,
// så et kort aldrig behøver at gætte på forskellen mellem "ikke hentet" og
// "ingen kampe").
//
// `signal` er valgfri og sendes til hvert kald, som i `computeCompetitionState`:
// skifter man skærm midtvejs, brydes kæden ved det første kald efter afbrydelsen.
async function loadCompetitionStatuses(token, userId, compIds, { signal } = {}) {
  const ids = [...new Set((compIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const o = { signal };
  const out = Object.fromEntries(ids.map((id) => [id, { ...EMPTY }]));

  const inList = ids.join(",");
  const [statuses, links] = await Promise.all([
    db.select(token, "competition_status", `competition_id=in.(${inList})&select=*`, o),
    db.select(token, "competition_matches", `competition_id=in.(${inList})&select=competition_id,match_id`, o),
  ]);

  for (const s of statuses) {
    const row = out[s.competition_id];
    if (!row) continue;
    row.matches = s.matches ?? 0;
    row.scoredMatches = s.scored_matches ?? 0;
    row.concluded = !!s.concluded;
    row.canGrow = !!s.can_grow;
  }

  // Fluebenet er en påstand om BRUGERENS tips, så uden en bruger er der intet at
  // sige — og så er de to sidste opslag heller ikke værd at lave.
  const matchIds = [...new Set(links.map((l) => l.match_id))];
  if (!userId || !matchIds.length) return out;

  // Kun de felter, `nextRoundTips` faktisk læser. Kampene deles på tværs af
  // konkurrencer (predictions er globale pr. kamp), så listen er unionen — og
  // typisk meget mindre end summen.
  const ms = await selectIn(token, "matches",
    "id", matchIds, "&select=id,round_key,kickoff_at,kickoff_tbd,home_score,away_score", o);
  const preds = await selectIn(token, "predictions",
    "match_id", matchIds, `&user_id=eq.${userId}&select=match_id,pred_home,pred_away`, o);

  const byId = new Map(ms.map((m) => [m.id, m]));
  const predByMatch = new Map(preds.map((p) => [p.match_id, p]));
  const matchesOf = new Map(ids.map((id) => [id, []]));
  for (const l of links) {
    const m = byId.get(l.match_id);
    if (m) matchesOf.get(l.competition_id)?.push(m);
  }

  for (const id of ids) {
    // Samme regel som Hjem-fanens deadline-kort — én funktion, to kaldere.
    const next = nextRoundTips(matchesOf.get(id) || [], predByMatch);
    if (!next) continue;
    out[id].hasNextRound = true;
    out[id].nextRoundKey = next.roundKey;
    out[id].nextRoundAllTipped = next.allTipped;
  }

  return out;
}

export { loadCompetitionStatuses, EMPTY as EMPTY_STATUS };
