// Tid og dato for tip-skærmen: dagsgruppering, klokkeslæt og nedtælling.
//
// Ren logik uden React — udskilt så den kan testes direkte, hvilket den ikke
// kunne, da den lå midt i en 705-linjers skærmfil.

import { APP_TZ, byKickoffThenTeams, formatKickoff, showUncertain, zonedDateKey } from "../../lib/scoring.js";

// Datoen står i dagens overskrift; rækken viser kun klokkeslæt.
//
// Er tiden ikke fastlagt, er der intet klokkeslæt at vise: kickoff_at bærer en
// pladsholder, som ville stå som "02.00" og se ud som en rigtig kampstart.
// Tomt svar lader kalderens `|| "–"` slå igennem; forklaringen står i
// dagsoverskriften, hvor der er plads til den.
//
// `uncertain` (G85) er den svagere markør og gør det MODSATTE af `tbd`: tiden
// bliver stående, fordi den er brugbar at planlægge efter, og får et `~` foran.
// Det er leverandørens gæt for tre af de fem football-data-turneringer, og
// forskellen på "kl. 16.00" og "vi ved det ikke" er hele pointen — mens en
// skjult tid ville koste brugeren den dato- og tidsplanlægning, der faktisk
// holder. Tegnets betydning står i dagsoverskriften, hvor der er plads.
//
// Om markøren overhovedet VISES afgøres af `showUncertain` (`G135`) og ikke af
// flaget alene: inden for ti dage er den næsten altid falsk, fordi et
// pladsholder-klokkeslæt er turneringens egen typiske anspilstid. Hele
// begrundelsen — og hvorfor horisonten ligger i visningen og ikke i SQL — står
// ved funktionen i `src/lib/scoring.js`.
function hhmm(iso, tbd = false, uncertain = false, now = Date.now()) {
  if (!iso || tbd) return "";
  const t = new Date(iso).toLocaleTimeString("da-DK", { timeZone: APP_TZ, hour: "2-digit", minute: "2-digit" });
  return showUncertain(iso, tbd, uncertain, now) ? "~" + t : t;
}
// Dagsnøglen er den DANSKE kalenderdato (G32). Med enhedens dato kunne en
// søndagskamp kl. 20 dansk lande i lørdagens gruppe for en bruger vestpå — og
// dagsgrupperingen er netop det sted, hvor "hvilken dag spilles den?" bliver
// besvaret på skærmen.
const dayKey = zonedDateKey;
// Dag-overskrift, fx "lør 25. jul" (uppercase sættes i style). Danske korte navne
// ender på punktum ("lør." / "jul."), som bliver støjende i en versal overskrift.
function dayLabel(iso) {
  const d = new Date(iso);
  const wd = d.toLocaleDateString("da-DK", { timeZone: APP_TZ, weekday: "short" }).replace(/\.$/, "");
  const dm = d.toLocaleDateString("da-DK", { timeZone: APP_TZ, day: "numeric", month: "short" }).replace(/\.$/, "");
  return `${wd} ${dm}`;
}
// Gruppér rundens kampe pr. kampdag, så datoen står ÉN gang i stedet for på hver
// række. Kampene er allerede sorteret på kickoff (groupIntoRounds); kampe uden
// kickoff samles i en sidste bucket.
//
// En kamp uden fastlagt klokkeslæt bliver i sin RIGTIGE dag — datoen er kendt,
// det er kun tiden, der mangler. Står hele dagen uden tider, siger overskriften
// det; det er dér, rækkernes tomme tidskolonne får sin forklaring.
//
// `teamNameOf` sorterer dagens kampe på holdnavn, når de deler tidsstempel. Det
// er reglen frem for undtagelsen på en dag uden fastlagte tider: dér bærer ALLE
// kampe det samme, og uden en tiebreaker kunne listen skifte orden mellem to
// visninger af den samme runde.
function groupIntoDays(matches, teamNameOf, now = Date.now()) {
  const days = [];
  const byKey = new Map();
  for (const m of matches) {
    const key = dayKey(m.kickoff_at) || "?";
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { key, label: m.kickoff_at ? dayLabel(m.kickoff_at) : "Tid ikke fastlagt", matches: [] };
      byKey.set(key, bucket);
      days.push(bucket);
    }
    bucket.matches.push(m);
  }
  const cmp = byKickoffThenTeams(teamNameOf);
  for (const day of days) {
    day.matches.sort(cmp);
    if (day.key !== "?" && day.matches.every((m) => m.kickoff_tbd)) {
      day.label += " · Tid ikke fastlagt";
    // `some` og ikke `every` som ovenfor, og forskellen følger af, hvad rækkerne
    // viser: en TBD-kamps tomme tidsfelt forklarer sig selv, mens et `~` er et
    // tegn, der skal have sin betydning med. Står der ét på dagen, skal
    // overskriften sige hvad det betyder — også hvis de øvrige kampe har
    // bekræftede tider (G85).
    //
    // `showUncertain` og ikke flaget, så tegnforklaringen og tegnet selv aldrig
    // kan komme i utakt: en dag inden for horisonten har ingen tilder at
    // forklare, og en overskrift, der alligevel forklarede dem, ville lede
    // brugeren efter et tegn, der ikke er der (G135).
    } else if (day.key !== "?" && day.matches.some((m) => showUncertain(m.kickoff_at, m.kickoff_tbd, m.kickoff_uncertain, now))) {
      day.label += " · ~ = tid ikke bekræftet";
    }
  }
  return days.sort((a, b) => (a.key === "?" ? 1 : b.key === "?" ? -1 : 0));
}
// "3 t 12 min" / "12 min"
function fmtLeft(ms) {
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return hours > 0 ? `${hours} t ${mins} min` : `${mins} min`;
}
// Deadline-tekst: relativ nedtælling tæt på, absolut tid når der er mere end et døgn
// til. Vises ALTID — før blev strengen skjult >24 t ude, hvilket var forsvarligt
// dengang den stod på hver række, men nu står den ét sted, og så er tavshed bare
// manglende information.
function lockLabel(deadlineMs, prefix = "Låser") {
  const msLeft = deadlineMs - Date.now();
  if (msLeft <= 0) return null;
  return msLeft <= 24 * 3600 * 1000
    ? `${prefix} om ${fmtLeft(msLeft)}`
    : `${prefix} ${formatKickoff(new Date(deadlineMs).toISOString())}`;
}

export { hhmm, dayKey, dayLabel, groupIntoDays, fmtLeft, lockLabel };
