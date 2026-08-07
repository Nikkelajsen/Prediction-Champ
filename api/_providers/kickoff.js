// Pladsholder-klokkeslættet. Sportmonks' markør — og Bundesligas, men ikke de
// øvrige football-data-turneringers.
//
// En terminsliste offentliggøres med DATOER længe før TIDSPUNKTER. Sender
// leverandøren da midnat UTC i tidsfeltet, står kampen skrevet ordret i appen
// som "02.00" (midnat UTC i dansk sommertid) med en lås midt om natten; det var
// fejlen bag `matches.kickoff_tbd` (august 2026).
//
// AFLÆST 7. august 2026 — og kun delvist sand.
// Fire turneringer læst direkte hos football-data.org
// (docs/reviews/football-data-kickoff-aflaesning-2026-08-07.md):
//
//   · Bundesliga: 261 af 306 kampe bærer 00:00 og står `SCHEDULED`, resten
//     bærer rigtige tider og står `TIMED`. Markøren er ægte og konsistent.
//   · Premier League, Primera División, Serie A: **nul** af 1.140 kampe bærer
//     midnat. Alle 1.140 står `SCHEDULED`. Denne funktion returnerer derfor
//     ALDRIG true for dem, og `kickoff_tbd` er permanent falsk (`G85`).
//
// Funktionen er altså ikke forkert — den er ufuldstændig, og den fejler tavst
// for de tre turneringer, hvor den ikke rammer. Rettelsen hører i den enkelte
// leverandørs `kickoffTbdOf()`, ikke her: Sportmonks' og Bundesligas markør er
// aflæst og skal ikke røres.
//
// Prisen er en falsk positiv for en kamp, der FAKTISK starter 00:00 UTC (02.00
// dansk sommertid). Ingen af de turneringer, appen dækker, spiller på det
// tidspunkt; kommer en til, er det her, den skal tages højde for.
//
// Formatet er forskelligt hos de to — Sportmonks sender "2026-08-15 16:00:00",
// football-data.org "2026-08-15T14:00:00Z" — men begge er UTC, og begge har
// tidsdelen efter en separator, der enten er mellemrum eller `T`.
export function isMidnightPlaceholder(ts) {
  if (typeof ts !== "string") return false;
  return /[ T]00:00:00/.test(ts);
}
