// Tiebreaker-stigen — ÉN kilde til sandhed for, hvordan en stilling afgøres.
//
// Alle stillinger i appen bruger den samme stige, i denne rækkefølge:
//   1. Flest point
//   2. Flest præcise resultater
//   3. Flest korrekte udfald
//   4. Flest rundesejre
//   5. Mindst målafvigelse pr. tippet kamp
// Er to spillere lige hele vejen ned, er de ÆGTE lige: de deler placering og titel.
// `userId` bruges udelukkende som skjult, stabil sorteringsnøgle, så rækker ikke
// hopper mellem to genindlæsninger — den afgør ALDRIG en placering.
//
// Hvorfor målafvigelsen er et gennemsnit og ikke en sum: en sum ville straffe den,
// der tipper flest kampe (flere kampe = flere afvigelser), og det strider mod
// beslutning A2 ("Månedschampionshippet må gerne belønne deltagelse"). Gennemsnittet
// normaliserer deltagelsesomfang på samme måde som ratingen (point pr. kamp).
//
// Rundechampionshippet har ingen rundesejre (den ér én runde) — feltet er der bare ikke,
// og `?? 0` gør trinnet neutralt i stedet for at kræve en separat komparator.
//
// Modulet er bevidst uden imports, så det også kan bruges uden for browseren.
// SQL-siden spejler stigen: sql/standings_tiebreakers.sql (views' kolonner),
// sql/story_engine.sql og sql/career_profile.sql (rank()-udtrykkene).

// Målafvigelse pr. tippet kamp, afrundet til 4 decimaler. Afrundingen er ikke
// kosmetik: SQL og JS skal blive enige om, HVORNÅR to tal er lige — ellers kan
// 1.0000000000000002 ≠ 1 gøre en ægte lighed til en usynlig afgørelse.
export function avgGoalError(goalErrorSum, matches) {
  if (!matches) return 0;
  return Math.round((goalErrorSum / matches) * 10000) / 10000;
}

// Hele stigen. 0 ⇒ spillerne er ægte lige (samme placering, delt titel).
export function compareStandings(a, b) {
  const d = (x, y) => (x ?? 0) - (y ?? 0);
  return (
    d(b.total, a.total) ||
    d(b.exactCount, a.exactCount) ||
    d(b.outcomeCount, a.outcomeCount) ||
    d(b.roundWins, a.roundWins) ||
    d(a.avgGoalError, b.avgGoalError) // mindst afvigelse vinder
  );
}

// Sortér efter stigen, med userId som skjult, stabil sidste nøgle.
export function sortStandings(rows) {
  return rows.slice().sort((a, b) =>
    compareStandings(a, b) || String(a.userId ?? "").localeCompare(String(b.userId ?? ""))
  );
}

// Sætter `rank` (ægte, delt placering) og `shared` på hver række. Forventer rækker,
// der allerede er sorteret — enten af sortStandings eller af databasens `order=`.
// To delte 2'ere betyder, at den næste er nr. 4; det er samme rank()-semantik som
// Story Engine og karriereprofilen allerede bruger i SQL.
// `cmp` kan overskrives af ranglister, der ikke er en pointstilling (fx ratingen).
export function assignRanks(rows, cmp = compareStandings) {
  let rank = 0;
  rows.forEach((r, i) => {
    const tiedWithPrev = i > 0 && cmp(rows[i - 1], r) === 0;
    if (!tiedWithPrev) rank = i + 1;
    r.rank = rank;
    r.shared = tiedWithPrev;
  });
  // marker også den FØRSTE i en delt gruppe (løkken ovenfor ser kun bagud)
  for (let i = 0; i < rows.length - 1; i++) {
    if (rows[i + 1].shared) rows[i].shared = true;
  }
  return rows;
}

// Rækkerne på 1. pladsen — én, når stillingen er afgjort, flere ved delt titel.
export function leaders(rows) {
  return (rows || []).filter((r) => r.rank === 1);
}

// "Anders", "Anders og Bo", "Anders, Bo og Carl" — til kåringer og notifikationer.
export function joinNames(names) {
  if (names.length <= 1) return names[0] || "";
  return names.slice(0, -1).join(", ") + " og " + names[names.length - 1];
}
