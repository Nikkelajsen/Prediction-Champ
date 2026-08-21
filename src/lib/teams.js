// Holdets NAVN PÅ SKÆRMEN — ét sted, fordi det ellers bliver otte.
//
// `teams` bærer to navne efter `B39` (#72 teams_short_name.sql):
//
//   · `name`       leverandørens fulde navn ("Real Racing Club de Santander").
//                  Det er NØGLEN: `teams_league_name_unique (league_id, name)`,
//                  og syncen matcher hold på det normaliserede navn med en
//                  `includes()`-fallback. Det må aldrig blive kortere — korte
//                  navne skaber netop de kollisioner, `ambiguousTeamNames()`
//                  fælder ("Real Sociedad" ⊂ "Real Sociedad de Fútbol").
//   · `short_name` leverandørens eget VISNINGSNAVN ("Santander", "Espanyol",
//                  "Atleti"). Ren visning, udfyldes kun for football-data-
//                  ligaerne; Sportmonks har intet at fylde i (deres `short_code`
//                  er et tre-bogstavs badge, ikke et navn).
//
// Reglen — kort navn når der er ét, ellers det fulde — stod indtil 21. august
// 2026 som `t.short_name || t.name` ét sted (tip-rækkerne). Da den skulle gælde
// hele appen, var otte kopier af det udtryk den nærliggende vej, og den er
// forkert af to grunde: et sted, der glemmes, viser tavst det lange navn igen,
// og et sted, der henter `select=id,name`, gør det samme UDEN at fejle. Begge
// fejl ser ud som "der er ikke noget kort navn for det hold".
function teamLabel(team) {
  return team?.short_name || team?.name || "";
}

// `id → visningsnavn` for en holdliste. Den form, hver eneste aftager har brug
// for: kampen bærer `home_team_id`, ikke holdet.
function teamLabelMap(rows) {
  return new Map((rows || []).map((t) => [t.id, teamLabel(t)]));
}

// Kolonnerne, holdopslag skal bede om — og hvorfor det er `*` og ikke
// `id,name,short_name`.
//
// **En navngiven kolonne, der ikke findes, er en 400 fra PostgREST**, og
// `short_name` findes kun i en database, hvor `#72` er kørt. Produktionen har
// kørt den, men staging og et preview, der peger på staging, behøver ikke at
// have gjort det (`docs/STAGING.md`) — og så ville hver eneste skærm med en
// kamp på være hvid dér. Med `*` mangler feltet bare, `teamLabel()` falder
// tilbage på det fulde navn, og appen virker. Det er den samme uafhængighed
// mellem migrering og deploy, som `planTeamWrites()` giver skrivesiden.
//
// Prisen er tre ubrugte kolonner pr. hold på en tabel med ~20 rækker pr.
// turnering. `profiles` er den modsatte afvejning (dér er `select=*` et `42501`
// efter kolonne-grants'ene, #60) — `teams` har tabel-grants, som dækker nye
// kolonner, så bredden er gratis her.
const TEAM_SELECT = "*";

export { teamLabel, teamLabelMap, TEAM_SELECT };
