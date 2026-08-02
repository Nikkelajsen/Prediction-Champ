// Tid og dato for tip-skærmen: dagsgruppering, klokkeslæt og nedtælling.
//
// Ren logik uden React — udskilt så den kan testes direkte, hvilket den ikke
// kunne, da den lå midt i en 705-linjers skærmfil.

import { byKickoffThenTeams, formatKickoff } from "../../lib/scoring.js";

// Datoen står i dagens overskrift; rækken viser kun klokkeslæt.
//
// Er tiden ikke fastlagt, er der intet klokkeslæt at vise: kickoff_at bærer en
// pladsholder, som ville stå som "02.00" og se ud som en rigtig kampstart.
// Tomt svar lader kalderens `|| "–"` slå igennem; forklaringen står i
// dagsoverskriften, hvor der er plads til den.
function hhmm(iso, tbd = false) {
  if (!iso || tbd) return "";
  return new Date(iso).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });
}
function dayKey(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
// Dag-overskrift, fx "lør 25. jul" (uppercase sættes i style). Danske korte navne
// ender på punktum ("lør." / "jul."), som bliver støjende i en versal overskrift.
function dayLabel(iso) {
  const d = new Date(iso);
  const wd = d.toLocaleDateString("da-DK", { weekday: "short" }).replace(/\.$/, "");
  const dm = d.toLocaleDateString("da-DK", { day: "numeric", month: "short" }).replace(/\.$/, "");
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
function groupIntoDays(matches, teamNameOf) {
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
