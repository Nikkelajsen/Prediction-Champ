// Karriereprofilens RENE regler: hvad Rekorder-, Rivaler- og H2H-linjerne
// faktisk siger, ud fra RPC'ets rå felter.
//
// Udskilt fra ProfileScreen.jsx den 3. august 2026 (G1, anden halvdel af
// fil-opdelingen). Ren flytning — ikke en linje er ændret. Funktionerne var i
// forvejen eksporteret og testet, netop fordi reglerne er værd at fastholde;
// nu bor de også dér, hvor det er tydeligt, at de kan læses uden en skærm.
import { roundLabel } from "../../lib/scoring.js";

// Rundenøgler kommer som tekst fra to kilder (rating_history.round_key er text,
// matches.round_key er date), så nøglen valideres, før den bliver en etiket —
// roundLabel på en ikke-dato giver "Invalid Date – Invalid Date".
function safeRoundLabel(key) {
  return typeof key === "string" && /^\d{4}-\d{2}-\d{2}$/.test(key) ? roundLabel(key) : null;
}

// Feature 1 (K4): narrativ H2H-sætning ved fremmed profil. Vises uanset om
// viewer fører eller taber — kun tælletal, ingen superlativer ("aldrig",
// "værst"). Se sql/career_profile.sql for begrundelsen.
//
// Sætningen navngiver sit eget omfang ("I jeres fælles konkurrencer"): tallet
// dækker KUN kampe fra konkurrencer, begge er deltager i — ikke hele
// Championship, og ikke alt hvad de hver især har tippet. Uden den indledning
// læses "I har mødt hinanden 12 gange" som en global opgørelse.
export function h2hSentence(h2h, name) {
  const { meetings, wins, losses, draws } = h2h;
  const drawNote = draws > 0 ? ` (${draws} uafgjort)` : "";
  const lead = `I jeres fælles konkurrencer har I mødt hinanden ${meetings} ${meetings === 1 ? "gang" : "gange"}`;
  if (wins > losses) return `${lead} — du fører ${wins}-${losses}${drawNote}.`;
  if (wins < losses) return `${lead} — ${name} fører ${losses}-${wins}${drawNote}.`;
  return `${lead} — I står lige, ${wins}-${losses}${drawNote}.`;
}

// Normaliserer `records`-nøglen til præcis det, Rekorder-sektionen skal vise.
// Ren funktion, så reglerne kan enhedstestes uden at rendere skærmen.
export function recordFacts(records, currentRating) {
  const r = records || {};
  const bestRating = r.best_rating ?? null;
  const rank = r.best_round_rank ?? null;
  const field = r.best_round_rank_field ?? null;
  const streak = r.longest_round_streak || 0;

  // Rundeplaceringen vises kun, når den ikke er 1 — nr. 1 er redundant med
  // "🥇 N rundesejre"-badget under Titler.
  const showRank = rank != null && rank > 1;

  // Feltstørrelsen ("af 34") er det, der gør rangen læsbar — men den må ALDRIG
  // afsløre en sidsteplads: "8. plads af 8" er en bundplacering, og profilen
  // viser aldrig bundplaceringer (karriereprofil-v1.md §1, punkt 3). Ved
  // rank >= field falder linjen tilbage til rangen alene. Feltet mangler også,
  // indtil migreringen er kørt i produktion — samme, tomme udfald.
  const showField = showRank && field != null && rank < field;

  // Ratingtoppen får sin runde med, når round_key ser ud som en rundenøgle
  // (uge-startdato). Feltet fandtes allerede i RPC-svaret uden at blive vist —
  // "1247" alene siger ikke, hvornår toppen blev sat.
  const bestRatingRound = safeRoundLabel(r.best_rating_round);

  // "Din bedste runde nogensinde" — flest point i én runde. Kun ved MINDST ét
  // point: en runde uden point er ingen rekord, og "din bedste runde
  // nogensinde: 0 point" ville drille præcis den bruger, der har mindst brug
  // for det. Fundet på rigtige data (en spiller med én runde og nul point).
  const roundPts = r.best_round_points ?? null;
  const showRoundPts = roundPts != null && roundPts > 0;

  return {
    bestRating,
    bestRatingIsCurrent: bestRating != null && currentRating === bestRating,
    bestRatingRound,
    bestRoundPoints: showRoundPts ? roundPts : null,
    bestRoundExact: showRoundPts ? (r.best_round_exact || 0) : 0,
    bestRoundRound: showRoundPts ? safeRoundLabel(r.best_round_points_round) : null,
    rank: showRank ? rank : null,
    rankCount: r.best_round_rank_count || 0,
    rankField: showField ? field : null,
    streak: streak >= 2 ? streak : 0,
    hasAny: bestRating != null || showRank || streak >= 2 || showRoundPts,
  };
}

// Rival-linjens tal. Rivaler rangeres på jævnbyrdighed fra faktiske møder
// (K3 lukket, 30. juli 2026), så sætningen skal sige mødetallet og stillingen —
// ikke, hvor mange historier der tilfældigvis er skrevet om personen.
// Vises kun på egen profil, så samme privathedsargument som K4's H2H gælder:
// stillingen står også, når man er bagud, men altid som rene tælletal.
export function rivalTally(r) {
  const { meetings, wins, losses, draws } = r;
  const drawNote = draws > 0 ? ` (${draws} uafgjort)` : "";
  const met = `I har mødt hinanden ${meetings} ${meetings === 1 ? "gang" : "gange"}`;
  if (wins === losses) return `${met} — det står lige, ${wins}-${losses}${drawNote}.`;
  if (wins > losses) return `${met} — du fører ${wins}-${losses}${drawNote}.`;
  return `${met} — du er bagud ${wins}-${losses}${drawNote}.`;
}

export { safeRoundLabel };
