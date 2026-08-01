// Rundens ÉNE statuslinje på Tip-skærmen — ren logik uden React, så den kan testes
// direkte. Den lå før midt i skærmfilen og havde ingen dækning overhovedet, hvilket
// var værst netop dér: statuslinjen er det sted, per-kamp-låsen (A21) ændrer mest.
//
// Fem gensidigt udelukkende tilstande, i den rækkefølge de afgøres:
//   "Spillet · N point"            hele runden er færdigspillet
//   "Åbner {dato}"                 det rullende vindue har ikke åbnet nogen kamp endnu
//   "Låst · N af M tippet"         ingen kampe kan tippes lige nu
//   "N af M tippet · Låser om X"   præcis én kamp er tilbage at tippe
//   "N af M tippet · Næste lås…"   flere kampe tilbage, hver med sin egen lås
//
// Hvorfor der IKKE står en nedtælling på hver kamprække: efter A21 er lås =
// kickoff − 1 time, og rækken viser allerede kickoff i sin tid-kolonne. Deadlinen er
// dermed aflæselig af det, der står i forvejen, og hovedet behøver kun sige, hvornår
// den FØRSTE af dem løber ud. Før A21 låste hele runden samtidig, så tiden hørte
// naturligt ét sted hen; nu holder samme konklusion af en anden grund.

import { formatKickoff, isLocked, isPlayed, lockAtOf, pointsFor } from "../../lib/scoring.js";
import { lockLabel } from "./time.js";

// `opensAt(m)` returnerer en Date, hvis kampen endnu ikke er åben for tips
// (rullende gætte-vindue), ellers null. Vinduet er fortsat runde-baseret.
function roundStatus({ matches, preds = {}, rules, opensAt = () => null }) {
  const ms = matches || [];
  if (!ms.length) return null;

  const hasPred = (m) => {
    const p = preds[m.id];
    return !!(p && p.pred_home != null && p.pred_away != null);
  };
  const playedCount = ms.filter(isPlayed).length;
  const allPlayed = playedCount === ms.length;
  // "Slut" på hver række er ren gentagelse, når hele runden er spillet og hver række
  // har sit facit-chip; i en blandet runde er mærket derimod den hurtige adskiller.
  const showFinal = !allPlayed;

  if (allPlayed) {
    const pts = ms.reduce((sum, m) => sum + (pointsFor(preds[m.id], m, rules) ?? 0), 0);
    return { status: `Spillet · ${pts} point`, showFinal, mixedOpening: false };
  }

  const opens = ms.map((m) => opensAt(m));
  if (opens.every(Boolean)) {
    // Hele runden venter på vinduet: datoen står én gang i hovedet, ikke på hver række.
    const openTime = Math.min(...opens.map((o) => o.getTime()));
    return { status: `Åbner ${formatKickoff(new Date(openTime).toISOString())}`, showFinal, mixedOpening: false };
  }
  // Nogle kampe er åbne, andre ikke. Så kan hovedet ikke tale for dem alle, og de
  // lukkede rækker må selv sige, hvornår de åbner.
  const mixedOpening = opens.some(Boolean);

  const tippable = ms.filter((m, i) => !isPlayed(m) && !isLocked(m) && !opens[i]);
  if (!tippable.length) {
    // Runden er låst (eller helt uden tipbare kampe): vis hvad der nåede at komme ind.
    const parts = [`Låst · ${ms.filter(hasPred).length} af ${ms.length} tippet`];
    if (playedCount) parts.push(`${playedCount}/${ms.length} spillet`);
    return { status: parts.join(" · "), showFinal, mixedOpening };
  }

  const parts = [`${tippable.filter(hasPred).length} af ${tippable.length} tippet`];
  // Kun de kampe, der faktisk KAN tippes, har en deadline, der er noget værd: de
  // låste er forbi, og en kamp bag det rullende vindue kan man ikke nå at gøre
  // noget ved endnu.
  const deadlines = tippable.map(lockAtOf).filter((t) => t !== null);
  if (deadlines.length) {
    const lockText = lockLabel(Math.min(...deadlines), deadlines.length > 1 ? "Næste lås" : "Låser");
    if (lockText) parts.push(lockText);
  }
  return { status: parts.join(" · "), showFinal, mixedOpening };
}

export { roundStatus };
