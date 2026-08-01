// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.

// ---------- scoring helpers ----------
// Simpelt, straffrit pointsystem:
//   +3 korrekt resultat · +1 korrekt udfald · 0 forkert gæt
function outcome(h, a) { return h === a ? "X" : h > a ? "1" : "2"; }
function pointsFor(pred, actual, rules) {
  if (!pred
    || actual.home_score == null || actual.away_score == null
    || pred.pred_home == null || pred.pred_away == null) return null;

  const exact = rules?.exact ?? 3;
  const out = rules?.outcome ?? 1;

  if (pred.pred_home === actual.home_score && pred.pred_away === actual.away_score) return exact;
  if (outcome(pred.pred_home, pred.pred_away) === outcome(actual.home_score, actual.away_score)) return out;
  return 0;
}
function roundLabel(key) {
  const start = new Date(key + "T12:00:00");
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const fmt = (x) => x.toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit" });
  return `${fmt(start)} – ${fmt(end)}`;
}
function groupIntoRounds(matches) {
  const map = {};
  for (const m of matches) { (map[m.round_key] ||= []).push(m); }
  return Object.keys(map).sort().map((key) => ({
    key, label: roundLabel(key),
    matches: map[key].slice().sort((a, b) => (a.kickoff_at || "").localeCompare(b.kickoff_at || "")),
  }));
}
// beholder kun kampe fra og med den første runde, der IKKE er helt afsluttet endnu
function filterFromNextUnfinishedRound(matches) {
  if (!matches.length) return matches;
  const byRound = {};
  for (const m of matches) { (byRound[m.round_key] ||= []).push(m); }
  const roundKeys = Object.keys(byRound).sort();
  const isRoundFinished = (key) => byRound[key].every((m) => m.home_score !== null && m.home_score !== undefined);
  const nextUnfinished = roundKeys.find((key) => !isRoundFinished(key));
  if (nextUnfinished === undefined) return [];
  return matches.filter((m) => m.round_key >= nextUnfinished);
}
// indeks for den runde, der indeholder i dag — eller den nærmeste kommende
function currentRoundIndex(rounds) {
  if (!rounds.length) return 0;
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < rounds.length; i++) {
    const end = new Date(rounds[i].key + "T12:00:00");
    end.setDate(end.getDate() + 6);
    if (end.toISOString().slice(0, 10) >= today) return i;
  }
  return rounds.length - 1;
}
// ---------- stages (grundspil / mesterskabsspil / nedrykningsspil) ----------
// Sportmonks leverer stage-navne på engelsk; vi oversætter til dansk i UI'et.
// Navnene her er dem, syncen faktisk har leveret. En ny turnerings fasenavne
// tilføjes, når man har SET dem — et gæt er værre end fallbacken nedenfor, som
// viser det rå navn pænt.
//
// Navngivningen er ikke fælles på tværs af turneringer, og heller ikke på tværs
// af sæsoner i samme turnering (verificeret hos Sportmonks 31. juli 2026):
// Superligaen deler sig i "Championship Round"/"Relegation Round", mens Scotland
// Premiership kalder det "1st Phase"/"2nd Phase" i 2026/2027 — men brugte
// "Regular Season" + "2nd Phase" i 2025/2026. Derfor er både `Regular Season` og
// `1st Phase` grundspil, og der er ét fælles ord for det skotske slutspil:
// Sportmonks giver ikke top-6 og bund-6 hver sin stage, som DBU gør, så en
// opdeling i mesterskabs-/nedrykningsspil ville påstå noget, dataene ikke siger.
//
// Fra 2026 kommer fem turneringer fra en ANDEN datakilde (football-data.org),
// og den skriver sine faser i VERSALER med understreg: "REGULAR_SEASON",
// "LAST_16". Det er ikke to konkurrerende konventioner, der skal forenes — det
// er to leverandørers rå navne, og tabellen her er netop stedet, hvor rå navne
// bliver til danske. De står adskilt nedenfor, så det er til at se, hvor et nyt
// navn hører hjemme, når det dukker op.
//
// Champions League' ligafase mapper til "Grundspil" med vilje: badge-reglen
// nedenfor skjuler netop det ord, og en badge på hver eneste ligafase-kamp er
// præcis den støj, reglen findes for. Knockout-runderne beholder deres badge,
// og det er dem, der siger noget.
const STAGE_LABELS = {
  // Sportmonks (Superliga, Scotland Premiership)
  "Regular Season": "Grundspil",
  "1st Phase": "Grundspil",
  "2nd Phase": "Slutspil",
  "Championship Round": "Mesterskabsspil",
  "Relegation Round": "Nedrykningsspil",
  "Conference League Play-offs – Final": "Conference League-playoff",
  // football-data.org (Premier League, Champions League, Bundesliga, Serie A, Primera División)
  REGULAR_SEASON: "Grundspil",
  LEAGUE_STAGE: "Grundspil",
  GROUP_STAGE: "Grundspil",
  PLAYOFFS: "Playoff",
  PLAYOFF_ROUND: "Playoff",
  PRELIMINARY_ROUND: "Kvalifikation",
  FIRST_QUALIFYING_ROUND: "1. kvalifikationsrunde",
  SECOND_QUALIFYING_ROUND: "2. kvalifikationsrunde",
  THIRD_QUALIFYING_ROUND: "3. kvalifikationsrunde",
  LAST_32: "1/16-finale",
  LAST_16: "Ottendedelsfinale",
  QUARTER_FINALS: "Kvartfinale",
  SEMI_FINALS: "Semifinale",
  THIRD_PLACE: "Bronzekamp",
  FINAL: "Finale",
};
// Kamp-badge: skjul grundspil — stage er kun interessant, når sæsonen er delt.
// Reglen ser på det DANSKE ord og ikke på det engelske navn: grundspil hedder
// noget forskelligt i hver turnering ("Regular Season", "1st Phase" …), og en
// badge på hver eneste kamp i grundspillet er præcis den støj, reglen findes for.
function stageBadgeLabel(name) {
  if (!name) return null;
  const label = STAGE_LABELS[name] || name;
  return label === "Grundspil" ? null : label;
}

// ---------- konkurrence-modes ----------
// ÉN kilde til sandhed for, hvad en mode hedder på dansk. Navnene stod før fire
// steder i tre forskellige varianter (samme konkurrence hed "Enkelt hold" på
// Ligaer-kortet, "Et hold" i opret-dropdownen og "Et hold" i admin-statistikken).
// Kanoniske navne = dem brugeren møder først, i opret-flowet.
// Ordforrådet fulgte I14-gennemgangen (august 2026): "Hel sæson" → "Sæson",
// "Et hold" → "Favorithold", "Tilfældig kupon" → "Quick Pick" osv. Nøglerne
// (mode-værdierne i databasen) er uændrede — kun det, brugeren ser, er nyt.
const MODE_LABELS = {
  full_season: "Sæson",
  team: "Favorithold",
  time_range: "Periode",
  custom: "Custom",
  random: "Quick Pick",
};
// Én linje pr. mode, der siger hvad valget BETYDER. Etiketten alene ("Periode",
// "Custom") forudsætter, at man allerede kender systemet — hintet
// bor her ved siden af etiketten, så opret-skærmen og onboarding-guiden ikke kan
// beskrive den samme mode forskelligt.
const MODE_HINTS = {
  full_season: "Alle resterende kampe i én eller flere turneringer — I følges ad hele sæsonen.",
  team: "Følg dine favorithold — ét eller flere hold, også på tværs af turneringer.",
  time_range: "Alle kampe mellem to datoer — fx en enkelt måned.",
  custom: "Du bestemmer selv præcis hvilke kampe, der skal med.",
  random: "Tilfældige kampe fra den nærmeste runde. Hurtig at gå til.",
};
// Ukendt mode vises råt frem for tomt — så en ny mode aldrig forsvinder i UI'et.
// `random` over flere runder er sit eget produkt-navn (Quick League), men samme
// mode i databasen — forskellen bor i mode_params.rounds, så etiketten skal
// have params med, hvor rækken har dem. Uden params falder den tilbage til
// "Quick Pick", hvilket kun rammer aggregeringer uden mode_params (admin).
function modeLabel(mode, modeParams) {
  if (mode === "random" && Number(modeParams?.rounds) > 1) return "Quick League";
  return MODE_LABELS[mode] || mode;
}

function formatKickoff(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("da-DK", { weekday: "short", day: "2-digit", month: "2-digit" }) + " kl. " +
    d.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });
}
const LOCK_LEAD_MS = 60 * 60 * 1000; // 1 time før kampens eget kickoff

// ---------- rundens lås ----------
// Klienten har ikke længere brug for rundens START. Den blev kun brugt af det
// rullende gætte-vindue (`rules.openDaysBefore`), som er fjernet igen (B1, august
// 2026) — og `roundStartKey`/`buildRoundStartMap` røg med. Runden er stadig et
// rigtigt begreb (tidsenhed for point, rating og stillinger), men den er ikke
// længere et TIDSPUNKT her: både lås og åbning følger kampen. Rundens første
// kickoff findes fortsat serverside, hvor det stadig betyder noget —
// `api/_backfill.js` regel 3 og `analytics_round_locks`.

// Låsetidspunktet for én kamp (ms), eller null hvis kickoff ikke er kendt.
function lockAtOf(m) {
  if (!m?.kickoff_at) return null;
  const t = new Date(m.kickoff_at).getTime();
  return Number.isNaN(t) ? null : t - LOCK_LEAD_MS;
}

// En kamp er låst hvis den har fået resultat, ELLER hvis vi er inden for 1 time
// af sit EGET kickoff (A21, 1. august 2026 — afsnit 3). Låsen var før scopet på
// (season_id, round_key), så rundens tidligste kickoff låste hele runden;
// fredagens kamp låste dermed søndagens. Nu er deadlinen en egenskab ved kampen,
// ens for alle — samme regel som RLS i sql/predictions_match_lock.sql.
//
// En kamp uden kendt kickoff er ikke låst; det spejler policyens skrivegren.
function isLocked(match) {
  if (match.home_score !== null && match.home_score !== undefined) return true;
  const lockAt = lockAtOf(match);
  if (lockAt === null) return false;
  return Date.now() >= lockAt;
}

// De runder, hvor andres tips må vises — nemlig fra låsen, hvor ingen længere
// kan rette sit gæt. Hver runde beskæres til sine LÅSTE kampe, så et gæt aldrig
// kan ses før deadline. Med per-kamp-låsen er en delvist låst runde reglen frem
// for undtagelsen: en runde står typisk halvt beskåret i dagevis, mens dens
// senere kampe stadig kan tippes.
// Et resultat er ikke et krav — en låst, endnu ikke spillet kamp viser gættet
// uden facit. Samme regel som "Alles gæt" på Tip-skærmen.
function lockedRoundsOf(rounds) {
  return rounds
    .map((r) => ({ ...r, matches: r.matches.filter((m) => isLocked(m)) }))
    .filter((r) => r.matches.length > 0);
}

// ---------- live-resultater ----------
// Live-stillingen bor i SEPARATE kolonner (live_*) og tæller ALDRIG point: en kamp
// er først "spillet", når home_score er sat. Derfor kan stillinger, rating og point
// aldrig bevæge sig midt i en kamp — de venter på slutfløjt. Se sql/live_scores.sql.
//
// Kampens tre tilstande i UI'et:
//   færdigspillet → isPlayed(m) === true (resultat + point)
//   i gang        → liveInfo(m) !== null (nuværende stilling + LIVE-mærke)
//   kommende      → ingen af delene (kickoff-tidspunkt)
const LIVE_BREAK_STATES = ["HT", "BREAK", "EXTRA_TIME_BREAK", "PEN_BREAK"];

function isPlayed(m) { return !!m && m.home_score !== null && m.home_score !== undefined; }

// Returnerer null hvis kampen ikke er i gang. Et endeligt resultat slår altid live,
// så en kamp aldrig kan "gå tilbage" til live efter at være meldt færdig.
function liveInfo(m) {
  if (!m || isPlayed(m) || m.live_state == null) return null;
  const paused = LIVE_BREAK_STATES.includes(m.live_state);
  return {
    homeScore: m.live_home_score ?? 0,
    awayScore: m.live_away_score ?? 0,
    state: m.live_state,
    minute: paused ? null : (m.live_minute ?? null),
    // kort label ved siden af LIVE-mærket: spilleminut, eller "Pause" i pauserne
    label: paused ? "Pause" : (m.live_minute != null ? `${m.live_minute}′` : "Live"),
  };
}

export { outcome, pointsFor, roundLabel, groupIntoRounds, filterFromNextUnfinishedRound, currentRoundIndex, formatKickoff, isLocked, lockAtOf, lockedRoundsOf, LOCK_LEAD_MS, STAGE_LABELS, stageBadgeLabel, isPlayed, liveInfo, MODE_LABELS, MODE_HINTS, modeLabel };
