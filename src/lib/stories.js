// Story Engine — ren regel-logik (prioritering, udvælgelse, tekst-rendering).
//
// Selve genereringen sker i databasen (sql/story_engine.sql, generate_stories),
// som gemmer færdig headline+body. Dette modul spejler prioriterings-/udvælgelses-
// reglen og tekst-skabelonerne, så logikken kan enhedstestes (vitest, jf.
// docs/features/story-engine-v1.md afsnit 9) og genbruges i frontend (fallback-
// rendering fra payload). Skabelonerne SKAL holdes i sync med SQL'ens tekster.

// Prioritetsstige (lavere tal = vigtigere). Én kilde til sandhed for regel-metadata.
export const RULES = {
  MONTH_CHAMP: 10,
  LEAD_TAKEN: 20,
  LEAD_LOST: 21,
  RATING_HIGH: 30,
  H2H_PASS: 40,
  COMEBACK: 50,
  STREAK: 60,
  ROUND_WON: 70,
  SHARP: 80,
};

// Tærskler (spec afsnit 3) — gæt, kalibreres efter skyggetilstand (åben beslutning A4).
export const THRESHOLDS = { comebackPlaces: 3, streakRounds: 3, sharpExact: 3, comebackMinPlayers: 5 };

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

// Rendering fra payload → { headline, body }. Skabelonerne matcher SQL'ens tekster.
// {label} = rundens dato-interval (fx "21.07 – 27.07"); leveres i payload som `label`.
export function renderStory(rule, payload = {}) {
  const p = payload;
  const L = p.label || "";
  switch (rule) {
    case "MONTH_CHAMP":
      return {
        headline: `👑 Du er Månedens Prediction Champ — ${p.month}`,
        body: `${p.points} point — flest af alle i ${p.month}.` +
          (p.gap != null && p.gap > 0 ? ` Nr. 2 var ${p.gap} point efter.` : ""),
      };
    case "LEAD_TAKEN":
      return {
        headline: `🏆 Du overtog førstepladsen i ${p.league}`,
        body: `Efter runden ${L} fører du ${p.league}. Forspring til nr. 2: ${p.gap} point.`,
      };
    case "LEAD_LOST":
      return {
        headline: `⚡ ${p.rival} vippede dig af førstepladsen i ${p.league}`,
        body: `Du førte ${p.league}, men ${p.rival} gik forbi i runden ${L}. Afstand op: ${p.gap} point.`,
      };
    case "RATING_HIGH":
      return {
        headline: `📈 Ny personlig ratingrekord: ${p.rating}`,
        body: `Din runde ${L} sendte dig forbi din hidtidige rekord på ${p.old}. Du er nu nr. ${p.rank} af ${p.total} på ranglisten.`,
      };
    case "H2H_PASS":
      return {
        headline: `🔄 Du er nu foran ${p.rival} i ${p.league}`,
        body: `Efter runden ${L} fører du jeres duel i ${p.league} med ${p.gap} point.`,
      };
    case "COMEBACK":
      return {
        headline: `🚀 Fra nr. ${p.from} til nr. ${p.to} i ${p.league}`,
        body: `Du rykkede ${p.from - p.to} pladser frem i runden ${L}. Toppen er nu ${p.gap} point væk.`,
      };
    case "STREAK":
      return {
        headline: `🔥 ${p.n}. sejr i træk mod ${p.rival} i ${p.league}`,
        body: `Du slog ${p.rival} igen i runden ${L} — ${p.mine} mod ${p.deres} point.`,
      };
    case "ROUND_WON":
      return {
        headline: `🥇 Du vandt runden ${L} i ${p.league}`,
        body: `${p.points} point — flest af alle i ${p.league}` +
          (p.shared ? " (delt)." : "."),
      };
    case "SHARP":
      return {
        headline: `🎯 ${p.n} præcise resultater i runden`,
        body: `Du ramte ${p.n} kampe præcist i runden ${L} — ${p.points} point i alt.`,
      };
    default:
      return { headline: "", body: "" };
  }
}
