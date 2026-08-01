// Opret-flowets typekatalog og rene hjælpere (I14/A22). Ingen React herinde:
// alt kan unit-testes uden render, og opret-skærmen bliver en tynd container.
//
// Et "korttype" er IKKE en ny mode i databasen. Galleriet oversætter seks
// produktnavne til de fem eksisterende mode-værdier plus parametre i
// mode_params — `competitions_mode_check` er urørt, og ingen eksisterende
// række skal migreres. Quick League er fx `random` med `rounds > 1`, og
// Ugens kupon er `random` med et fast preset.
import { roundLabel } from "./scoring.js";

// Rækkefølgen ER varigheds-spørgsmålet (I14: "varighed før turnering"), men
// den står langt → kort (vendt 1. august 2026): det øverste kort er dét,
// produktet anbefaler, og Sæson er den type, der binder en liga sammen en hel
// sæson. Sæson og Favorithold står sammen øverst, fordi de er de eneste to,
// der løber sæsonen ud OG vokser af sig selv, når nye kampe skemalægges
// (efterfyldnings-regel 1) — Favorithold er derfor det nærmeste alternativ
// under det anbefalede: "hele sæsonen, bare ikke alle kampe". Custom er sidst
// som escape-hatch.
//
//   duration    varigheds-mærkaten på kortet. Den findes, fordi forskellen på
//               typerne er to akser — HVILKE kampe og HVOR LÆNGE — og den
//               anden akse skal kunne aflæses uden at læse beskrivelsen.
//   recommended sætter "Anbefalet"-mærket. Præcis ét kort må bære det.
//   multiRound  styrer kårings-tilvalget (I13): for en én-rundes konkurrence
//               ER konkurrencevinderen ugens bedste, så tilvalget skjules.
//   presets     udfyldes i skærmens state, når kortet vælges — de er
//               startværdier, ikke låste valg (undtagen Ugens kupon, der
//               netop er "klar med to tryk" og ingen opfølgning har).
//
// Ikonet pr. korttype bor IKKE her: lucide-ikoner er React-komponenter, og
// denne fil skal kunne unit-testes uden render. Se ICONS i TypeGallery.jsx.
const CREATE_TYPES = [
  {
    id: "season",
    mode: "full_season",
    title: "Sæson",
    duration: "Hele sæsonen",
    subtitle: "Alle kampe i én eller flere turneringer. Nye kampe kommer automatisk med.",
    recommended: true,
    multiRound: true,
    presets: {},
  },
  {
    id: "team",
    mode: "team",
    title: "Favorithold",
    duration: "Hele sæsonen",
    subtitle: "Kun dine holds kampe. Vælg ét eller flere hold, også på tværs af turneringer.",
    multiRound: true,
    presets: {},
  },
  {
    id: "quick_league",
    mode: "random",
    title: "Quick League",
    duration: "Nogle uger",
    subtitle: "Tilfældige kampe i hver runde, fx 6 runder frem. Du vælger antal og turneringer.",
    multiRound: true,
    presets: { count: 8, rounds: 6 },
  },
  {
    id: "quick_pick",
    mode: "random",
    title: "Quick Pick",
    duration: "Én runde",
    subtitle: "Tilfældige kampe fra næste runde. Du vælger antal og turneringer.",
    multiRound: false,
    presets: { count: 6, rounds: 1 },
  },
  {
    id: "weekly_coupon",
    mode: "random",
    title: "Ugens kupon",
    duration: "Én runde",
    subtitle: "8 tilfældige kampe fra næste runde, alle turneringer. Klar med to tryk.",
    multiRound: false,
    presets: { count: 8, rounds: 1, allLeagues: true },
  },
  {
    id: "custom",
    mode: "custom",
    title: "Custom",
    duration: "Du bestemmer",
    subtitle: "Håndpluk kampene selv, eller tag alle kampe i en periode.",
    multiRound: true,
    presets: {},
  },
];

function createTypeById(id) {
  return CREATE_TYPES.find((t) => t.id === id) || null;
}

// ---------- tilfældig udvælgelse over én eller flere runder ----------
// Generalisering af den gamle pickRandomMatchIds (som kun kendte den nærmeste
// runde): tag de første `rounds` runde-nøgler stigende og træk op til `count`
// kampe PR. RUNDE — "8 kampe, 6 runder frem" betyder 8 i hver uge, klippet til
// rundens faktiske udbud. `rounds = 1` er præcis dagens Quick Pick-adfærd.
//
// `shuffle` kan injiceres, så testene er deterministiske; standarden er den
// samme Fisher-Yates-agtige sort, den gamle funktion brugte.
function pickRandomFromRounds(pool, { count = 6, rounds = 1, shuffle } = {}) {
  if (!pool.length) return [];
  const byRound = {};
  for (const m of pool) (byRound[m.round_key] ||= []).push(m);
  const keys = Object.keys(byRound).sort().slice(0, Math.max(1, Number(rounds) || 1));
  const doShuffle = shuffle || ((arr) => arr.slice().sort(() => Math.random() - 0.5));
  const perRound = Math.max(1, Number(count) || 6);
  const ids = [];
  for (const key of keys) {
    for (const m of doShuffle(byRound[key]).slice(0, perRound)) ids.push(m.id);
  }
  return ids;
}

// Ugens kupon er det ENE kort, der forudfylder navnet — det genererede navn er
// selve featuren ("Ugens kupon 12/08 – 18/08"), ikke en default, man glemmer at
// ændre (B6 fjernede netop dén slags forudfyldning alle andre steder).
function weeklyCouponName(roundKey) {
  return roundKey ? `Ugens kupon ${roundLabel(roundKey)}` : "Ugens kupon";
}

// ---------- spec-bygning ----------
// Ren funktion af skærmens state → `createCompetition`-spec (data/competitions.js).
// Bor her og ikke i skærmen, så formen kan testes pr. korttype uden render.
//
// `state`:
//   typeId       et id fra CREATE_TYPES
//   name         konkurrencens navn
//   groupId      liga-tilhør (null = liga-løs)
//   awards       kårings-tilvalget (I13) — kun meningsfuldt for multiRound-typer
//   tournaments  season: [{ leagueId, seasonId }]
//   teams        team: [{ leagueId, seasonId, teamId }]
//   method       custom: "pick" (håndpluk) | "period" (time_range)
//   leagueId, seasonId, startDate, endDate   custom/period
//   matchIds     custom/pick + alle random-typer (udpeget i klienten)
//   randomCount, rounds                      random-typerne
function buildSpec(state) {
  const type = createTypeById(state.typeId);
  if (!type) throw new Error(`Ukendt korttype: ${state.typeId}`);
  const shared = { name: state.name, groupId: state.groupId || null, awards: !!state.awards };

  if (type.id === "season") return { ...shared, mode: "full_season", tournaments: state.tournaments || [] };
  if (type.id === "team") return { ...shared, mode: "team", teams: state.teams || [] };
  if (type.id === "custom") {
    if (state.method === "period") {
      return {
        ...shared, mode: "time_range",
        leagueId: state.leagueId, seasonId: state.seasonId,
        startDate: state.startDate, endDate: state.endDate,
      };
    }
    return { ...shared, mode: "custom", matchIds: state.matchIds || [] };
  }
  // de tre random-typer: Ugens kupon, Quick Pick, Quick League
  return {
    ...shared, mode: "random",
    matchIds: state.matchIds || [],
    randomCount: state.randomCount ?? type.presets.count,
    rounds: state.rounds ?? type.presets.rounds ?? 1,
  };
}

export { CREATE_TYPES, createTypeById, pickRandomFromRounds, weeklyCouponName, buildSpec };
