// Pladsholder-klokkeslættet — den ene regel, begge leverandører deler.
//
// En terminsliste offentliggøres med DATOER længe før TIDSPUNKTER, og begge
// leverandører sender da midnat UTC i tidsfeltet. Skrevet ordret står kampen i
// appen som "02.00" (midnat UTC i dansk sommertid) med en lås midt om natten;
// det var fejlen bag `matches.kickoff_tbd` (august 2026).
//
// Midnat-testen er AFLÆST, ikke antaget: en kamp gemt med 00:00 UTC vises som
// 02.00, og tidsfeltet skrives ordret hele vejen fra leverandøren til
// `matches.kickoff_at` (normalize → sync-matches). Intet led tilføjer midnat,
// så værdien kommer fra leverandøren.
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
