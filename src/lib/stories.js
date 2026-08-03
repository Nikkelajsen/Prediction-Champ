// Story Engine — ren regel-logik (prioritering, udvælgelse, tekst-rendering).
//
// Selve genereringen sker i databasen (sql/story_engine.sql, generate_stories),
// som gemmer færdig headline+body. Dette modul spejler prioriterings-/udvælgelses-
// reglen og tekst-skabelonerne, så logikken kan enhedstestes (vitest, jf.
// docs/features/story-engine-v1.md afsnit 9) og genbruges i frontend (fallback-
// rendering fra payload). Skabelonerne SKAL holdes i sync med SQL'ens tekster.
//
// v1.1 (juli 2026): tre nye regler (PODIUM_ENTER, CLOSING_IN, PERSONAL_BEST),
// sænkede tærskler med svag prioritet (SOFT_PRIORITY) og et dæmpet tier
// (SEASON_OPENER, QUIET_ROUND), der kun genereres, når intet andet udløses.
//
// v1.2 (august 2026): to regler for de LOKALE kåringer (AWARD_WEEK,
// AWARD_MONTH). De læser `competition_awards` i SQL'en frem for at regne noget
// om, så et kort aldrig kan modsige den kåring, boardet viser.

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
    default: return RULES[rule] ?? null;
  }
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

// Rendering fra payload → { headline, body }. Skabelonerne matcher SQL'ens tekster.
// {label} = rundens dato-interval (fx "21.07 – 27.07"); leveres i payload som `label`.
export function renderStory(rule, payload = {}) {
  const p = payload;
  const L = p.label || "";
  switch (rule) {
    case "MONTH_CHAMP":
      return {
        headline: `👑 Du er ${p.shared ? "delt " : ""}Månedens Prediction Champ — ${p.month}`,
        body: `${p.points} point — flest af alle i ${p.month}${p.shared ? " (delt)" : ""}.` +
          (p.gap != null && p.gap > 0 ? ` Nr. 2 var ${p.gap} point efter.` : ""),
      };
    case "AWARD_WEEK":
      return {
        headline: `🏅 Du er ${p.shared ? "delt " : ""}Ugens bedste i ${p.league}`,
        body: `${p.points} point — flest af alle i ${p.league} i runden ${L}` +
          (!p.shared ? "."
            : p.others > 1 ? ` (delt med ${p.others} andre).`
            : " (delt med 1 anden)."),
      };
    case "AWARD_MONTH":
      return {
        headline: `👑 Du er ${p.shared ? "delt " : ""}Månedens bedste i ${p.league} — ${p.month}`,
        body: `${p.points} point — flest af alle i ${p.league} i ${p.month}` +
          (!p.shared ? "."
            : p.others > 1 ? ` (delt med ${p.others} andre).`
            : " (delt med 1 anden)."),
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
          (!p.shared ? "."
            : p.others > 1 ? ` (delt med ${p.others} andre).`
            : " (delt med 1 anden)."),
      };
    case "SHARP":
      return {
        headline: `🎯 ${p.n} præcise resultater i runden`,
        body: `Du ramte ${p.n} kampe præcist i runden ${L} — ${p.points} point i alt.`,
      };
    case "PODIUM_ENTER":
      return {
        headline: `🏅 Du er inde i top 3 i ${p.league}`,
        body: `Efter runden ${L} ligger du nr. ${p.rank} af ${p.total} i ${p.league}. Toppen er ${p.gap} point væk.`,
      };
    case "CLOSING_IN":
      return {
        headline: `👀 Kun ${p.gap} point op til føringen i ${p.league}`,
        body: `Efter runden ${L} er der ${p.gap} point op til ${p.rival} i ${p.league}.`,
      };
    case "PERSONAL_BEST":
      return {
        headline: `📊 Din bedste runde hidtil: ${p.points} point`,
        body: `Runden ${L} er din stærkeste i ${p.league} — din forrige rekord var ${p.old} point.`,
      };
    // --- Dæmpet tier: ingen emoji (emoji = højdepunkt), tekst altid fremadrettet.
    // Placeringen nævnes KUN i den øverste halvdel af tabellen; i den nederste står
    // afstanden op til toppen i stedet ("driller, men ydmyger aldrig").
    case "SEASON_OPENER":
      return {
        headline: `Første runde i ${p.league} er i hus`,
        body: p.rank * 2 <= p.total
          ? `${p.points} point — du starter som nr. ${p.rank} af ${p.total}.` +
            (p.gap > 0 ? ` Toppen er ${p.gap} point væk.` : "")
          : `${p.points} point i den første runde. Toppen er ${p.gap} point væk — der er lang vej endnu.`,
      };
    case "QUIET_ROUND":
      return {
        headline: `Din runde: ${p.points} point`,
        body: p.rank === 1
          ? `Du fører fortsat ${p.league} efter runden ${L}.`
          : p.rank * 2 <= p.total
            ? `Du holder nr. ${p.rank} af ${p.total} i ${p.league} — ${p.gap} point op til toppen.`
            : `${p.gap} point op til toppen i ${p.league}. Næste runde er en ny chance.`,
      };
    default:
      return { headline: "", body: "" };
  }
}
