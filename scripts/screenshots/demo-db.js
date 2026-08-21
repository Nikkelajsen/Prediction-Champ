// Demo-databasen bag skærmbillederne til `manifest.json` (I23).
//
// ---------------------------------------------------------------------------
// HVAD DEN ER
//
// Et komplet, opdigtet datasæt — seks spillere, én liga, én konkurrence, seks
// spillerunder i Premier League — formet præcis som de tabeller og views,
// appen læser. `fake-rest.js` serverer det gennem en `fetch`-attrap, så det er
// den RIGTIGE app, der tegner skærmbillederne: samme komponenter, samme
// loaders, samme CSS. Kun databasen er falsk.
//
// Alternativet var at bygge en facsimile af skærmene i HTML til lejligheden.
// Det ville være hurtigere at skrive og forkert dagen efter — en attrap af en
// skærm driver fra skærmen uden at nogen kan se det, mens dette datasæt kun kan
// producere det, appen faktisk kan tegne. Går en loader i stykker, kommer
// skærmbilledet tomt ud, og det er til at få øje på.
//
// ---------------------------------------------------------------------------
// HVORFOR TALLENE ER REGNET OG IKKE SKREVET
//
// Point, stillinger, rundesejre og målafvigelse udledes af gættene med appens
// EGEN `pointsFor()` (src/lib/scoring.js) længere nede i filen. Skrev vi
// stillingen i hånden, ville tabellen på ét skærmbillede kunne modsige
// kampresultaterne på det næste — den slags fejl opdager ingen i en PNG, og den
// ville stå på et markedsføringsmateriale.
//
// Ratingtallene er den ene undtagelse og er MED VILJE grove: den rigtige rating
// beregnes i databasen (`sql/rating_core.sql`) og kan ikke køres her. De er
// derfor et plausibelt tal til et skærmbillede og ikke en gengivelse af
// motoren. Ingen anden del af datasættet gætter.
//
// ---------------------------------------------------------------------------
// TIDEN STÅR STILLE
//
// `NU` er et fast tidspunkt — lørdag 15. august 2026 kl. 18.35 dansk tid, midt
// i en kampdag: fem kampe er spillet, én er i gang, fire mangler. `fake-rest.js`
// fryser browserens ur på det tidspunkt, så to kørsler af scriptet giver samme
// billede. Uden frysningen ville låse, live-mærker og nedtællinger flytte sig
// med kalenderen, og et skærmbillede taget i næste uge ville vise en runde,
// der var kørt af sporet.
//
// ---------------------------------------------------------------------------
// NAVNENE
//
// Spillerne er opdigtede, og det skal de blive ved med at være: et
// skærmbillede i installationsprompten er offentligt materiale, og en rigtig
// brugers navn og placering hører ikke til dér. Klubberne er rigtige, fordi det
// er dem, appen viser.
import { pointsFor, POINTS } from "../../src/lib/scoring.js";

// Lørdag 15. august 2026, 18.35 dansk tid.
const NU = Date.parse("2026-08-15T18:35:00+02:00");

// Id'er er faste strenge i uuid-form. De behøver ikke være rigtige uuid'er —
// intet her validerer dem — men formen gør det lettere at se, hvad der er hvad,
// hvis man læser en forespørgsel i browserens netværksfane.
const id = (præfiks, n) => `${præfiks}${String(n).padStart(4, "0")}-0000-4000-8000-000000000000`;

const LIGA_ID = id("11111111", 1);     // turneringen (leagues)
const SÆSON_ID = id("22222222", 1);    // seasons
const GRUPPE_ID = id("33333333", 1);   // groups (liga-laget)
const KONK_ID = id("44444444", 1);     // competitions

// ---------------------------------------------------------------------------
// Spillerne. Den første er den, skærmbillederne er set fra.
const SPILLERE = [
  { id: id("aaaaaaaa", 1), navn: "Mikkel" },
  { id: id("aaaaaaaa", 2), navn: "Sofie" },
  { id: id("aaaaaaaa", 3), navn: "Jonas" },
  { id: id("aaaaaaaa", 4), navn: "Freja" },
  { id: id("aaaaaaaa", 5), navn: "Rasmus" },
  { id: id("aaaaaaaa", 6), navn: "Emil" },
];
const MIG = SPILLERE[0].id;

// ---------------------------------------------------------------------------
// Holdene. Tyve klubber, så en runde er ti kampe uden at et hold optræder to
// gange — præcis som en rigtig spillerunde.
const HOLDNAVNE = [
  "Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton",
  "Burnley", "Chelsea", "Crystal Palace", "Everton", "Fulham",
  "Leeds", "Liverpool", "Manchester City", "Manchester United", "Newcastle",
  "Nottingham Forest", "Sunderland", "Tottenham", "West Ham", "Wolves",
];
const HOLD = HOLDNAVNE.map((navn, i) => ({ id: id("55555555", i + 1), league_id: LIGA_ID, name: navn }));
const holdId = (navn) => HOLD.find((t) => t.name === navn).id;

// ---------------------------------------------------------------------------
// Kampene.
//
// Den igangværende runde er skrevet i hånden, fordi den ER skærmbilledet: hvad
// der er spillet, hvad der er i gang, og hvad der mangler et tip, afgør hvert
// eneste kort på Hjem. De fem foregående runder er kun til for at give
// stillingen, formkurven og ▲/▼ noget at stå på, og de genereres derfor.
//
// FEM og ikke to: ratingen er FORELØBIG under fem spillede runder (den viser en
// stjerne), og en app, hvis eget nøgletal står med forbehold på hvert
// skærmbillede, sælger sig selv dårligt. Fem er motorens egen grænse, ikke et
// tal valgt her.
const TIDLIGERE = [
  { nøgle: "2026-07-07", lørdag: "2026-07-11" },
  { nøgle: "2026-07-14", lørdag: "2026-07-18" },
  { nøgle: "2026-07-21", lørdag: "2026-07-25" },
  { nøgle: "2026-07-28", lørdag: "2026-08-01" },
  { nøgle: "2026-08-04", lørdag: "2026-08-08" },
];
const RUNDE_NU = "2026-08-11";

const iso = (dag, tid) => `${dag}T${tid}:00+02:00`;

// [hjemme, ude, hjemmemål, udemål, kickoff] — mål er null, når kampen ikke er
// spillet. Live-kampen får sine live-felter nedenfor.
const RUNDE_NU_KAMPE = [
  ["Brighton", "Fulham", 2, 1, iso("2026-08-15", "13:30")],
  ["Arsenal", "Wolves", 3, 0, iso("2026-08-15", "16:00")],
  ["Everton", "Burnley", 1, 1, iso("2026-08-15", "16:00")],
  ["Manchester United", "Tottenham", 2, 2, iso("2026-08-15", "16:00")],
  ["Sunderland", "Leeds", 0, 2, iso("2026-08-15", "16:00")],
  ["Chelsea", "Newcastle", null, null, iso("2026-08-15", "18:30")], // i gang lige nu
  ["Aston Villa", "Brentford", null, null, iso("2026-08-16", "15:00")],
  ["Bournemouth", "Crystal Palace", null, null, iso("2026-08-16", "15:00")],
  ["Nottingham Forest", "West Ham", null, null, iso("2026-08-16", "17:30")],
  ["Liverpool", "Manchester City", null, null, iso("2026-08-16", "20:00")],
];

// Den kamp, dagens historie handler om (se STORY nedenfor): den skal være
// spillet, og gættene på den skrives i hånden, så påstanden i kortet er sand.
const KONTRARIAN = { hjemme: "Everton", ude: "Burnley" };

// Deterministisk pseudo-tilfældighed. `Math.random()` ville gøre datasættet
// forskelligt fra kørsel til kørsel, og så ville et skærmbillede, der skulle
// laves om, vise en anden stilling end det, der lå ved siden af.
function tilfældig(frø) {
  let t = frø >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// De tidligere runder: hold parres ved at rotere listen, så ingen kamp
// gentages fra runde til runde.
function tidligereRunde(rundenøgle, lørdag, rotation, frø) {
  const rnd = tilfældig(frø);
  const hjemme = HOLDNAVNE.slice(0, 10);
  // Rotationen tages modulo ti: udeholdene er ti, og listen er lagt dobbelt, så
  // et snit på ti altid er fuldt. Uden `% 10` løber snittet ud over enden ved
  // femte runde, og de sidste par kampe får `undefined` som udehold — en fejl,
  // der først viser sig som en tom skærm.
  const rot = rotation % 10;
  const ude = [...HOLDNAVNE.slice(10), ...HOLDNAVNE.slice(10)].slice(rot, rot + 10);
  return hjemme.map((h, i) => {
    // 0-3 mål med tyngde mod 1-2, som en fodboldkamp.
    const mål = () => [0, 1, 1, 2, 2, 3][Math.floor(rnd() * 6)];
    const tid = ["13:30", "16:00", "16:00", "18:30"][i % 4];
    return [h, ude[i], mål(), mål(), iso(lørdag, tid), rundenøgle];
  });
}

const RÅ_KAMPE = [
  ...TIDLIGERE.flatMap((r, i) => tidligereRunde(r.nøgle, r.lørdag, i * 3, 20260707 + i)),
  ...RUNDE_NU_KAMPE.map((k) => [...k, RUNDE_NU]),
];

const KAMPE = RÅ_KAMPE.map(([hjemme, ude, hs, as_, kickoff, rundenøgle], i) => {
  const live = hjemme === "Chelsea";
  return {
    id: id("66666666", i + 1),
    season_id: SÆSON_ID,
    home_team_id: holdId(hjemme),
    away_team_id: holdId(ude),
    kickoff_at: new Date(kickoff).toISOString(),
    round_key: rundenøgle,
    home_score: hs,
    away_score: as_,
    status: hs === null ? "scheduled" : "finished",
    stage_name: "Regular Season",
    // Live-felterne skrives af `api/sync-live.js` hvert minut; her er de sat på
    // den ene kamp, uret står midt i. `INPLAY_1ST_HALF` er Sportmonks' eget
    // navn og det, `liveInfo()` forventer at se.
    live_home_score: live ? 1 : null,
    live_away_score: live ? 0 : null,
    live_state: live ? "INPLAY_1ST_HALF" : null,
    live_minute: live ? 34 : null,
    live_updated_at: live ? new Date(NU - 40000).toISOString() : null,
    kickoff_tbd: false,
  };
});
const kampVed = (hjemme, ude) =>
  KAMPE.find((m) => m.home_team_id === holdId(hjemme) && m.away_team_id === holdId(ude));

// ---------------------------------------------------------------------------
// Gættene.
//
// Alle seks tipper alt, der er låst — ellers ville stillingen være hullet på en
// måde, en aktiv liga ikke er. På rundens ÅBNE kampe mangler den, skærmbillederne
// er set fra, to tips: det er dét, der giver deadline-kortet på Hjem noget at
// sige, og det er den tilstand, en bruger oftest åbner appen i.
const MINE_MANGLENDE = [
  kampVed("Nottingham Forest", "West Ham").id,
  kampVed("Liverpool", "Manchester City").id,
];

// Hvor godt rammer hver spiller? Tabellen er de afvigelser fra det rigtige
// resultat, gættet trækkes fra: flere nuller er flere præcise gæt.
//
// Den findes, fordi et helt symmetrisk datasæt giver en tilfældig vinder, og
// stillingen på skærmbillederne skal fortælle en historie, der hænger sammen på
// tværs af de fire billeder — Sofie fører, og den, billederne er set fra, er nr.
// 2 og tæt på. Formen er den samme for alle; det er kun tabellen, der er hver
// sin.
const PRÆCISION = {
  0: [0, 0, 0, 1, -1, 1],   // Mikkel — skarp, men ikke bedst
  1: [0, 0, 0, 1, 1, -1],   // Sofie  — fører
  2: [0, 0, 1, -1, 1, 2],
  3: [0, 1, -1, 1, 2, -2],
  4: [0, 1, 1, -1, 2, 2],
  5: [0, 1, -1, 2, -2, 2],
};

const GÆT = [];
for (const kamp of KAMPE) {
  const spillet = kamp.home_score !== null;
  const rnd = tilfældig(Number(kamp.id.slice(8, 12)) + 7919);
  for (const [nr, spiller] of SPILLERE.entries()) {
    if (!spillet && spiller.id === MIG && MINE_MANGLENDE.includes(kamp.id)) continue;
    let ph, pa;
    if (spillet) {
      // Gættet lægger sig OM resultatet frem for at være uafhængigt af det.
      // Et helt tilfældigt gæt rammer sjældent, og en stilling, hvor ingen har
      // point, ligner en app, der ikke virker.
      const afvig = PRÆCISION[nr];
      const nær = (v) => Math.max(0, v + afvig[Math.floor(rnd() * afvig.length)]);
      ph = nær(kamp.home_score);
      pa = nær(kamp.away_score);
    } else {
      ph = [0, 1, 1, 2, 2, 3][Math.floor(rnd() * 6)];
      pa = [0, 0, 1, 1, 2, 2][Math.floor(rnd() * 6)];
    }
    GÆT.push({ user_id: spiller.id, match_id: kamp.id, pred_home: ph, pred_away: pa, updated_at: new Date(NU - 86400000).toISOString() });
  }
}

// Kontrarian-kampen skrives om i hånden: Everton–Burnley endte 1-1, og PÅSTANDEN
// i dagens historie er, at én eneste troede på uafgjort. Den skal være sand i
// dataene, ellers modsiger kortet den tabel, det står over.
{
  const kamp = kampVed(KONTRARIAN.hjemme, KONTRARIAN.ude);
  const andres = [[2, 0], [1, 0], [3, 1], [2, 1], [1, 0]];
  SPILLERE.forEach((spiller, i) => {
    const g = GÆT.find((p) => p.match_id === kamp.id && p.user_id === spiller.id);
    if (i === 0) { g.pred_home = 1; g.pred_away = 1; }      // ramte uafgjort
    else { [g.pred_home, g.pred_away] = andres[i - 1]; }     // alle andre tippede hjemmesejr
  });
}

// ---------------------------------------------------------------------------
// Stillingerne — REGNET, ikke skrevet.
//
// De tre views (`round_standings`, `monthly_standings`, `season_standings`)
// bygges her af de samme gæt og resultater, som skærmene selv læser. Kolonnerne
// er viewenes egne (sql/standings_tiebreakers.sql), så loaderne i
// `src/lib/data/standings.js` kan læse dem uden at vide, hvor de kom fra.
const gætVed = new Map(GÆT.map((p) => [`${p.match_id}:${p.user_id}`, p]));
const spilledeKampe = KAMPE.filter((m) => m.home_score !== null);
const spilledeRunder = [...new Set(spilledeKampe.map((m) => m.round_key))].sort();

function opgør(kampe, brugerId) {
  let total = 0, antal = 0, præcise = 0, udfald = 0, målfejl = 0;
  for (const m of kampe) {
    const g = gætVed.get(`${m.id}:${brugerId}`);
    const p = pointsFor(g, m);
    if (p === null) continue;
    total += p; antal++;
    målfejl += Math.abs(g.pred_home - m.home_score) + Math.abs(g.pred_away - m.away_score);
    if (p === POINTS.exact) præcise++;
    else if (p === POINTS.outcome) udfald++;
  }
  return { total_points: total, matches: antal, exact_count: præcise, outcome_count: udfald,
    avg_goal_error: antal ? Number((målfejl / antal).toFixed(2)) : 0 };
}

// Rundestillingen pr. runde — også grundlaget for rundesejre længere nede.
const RUNDE_STILLING = [];
for (const nøgle of spilledeRunder) {
  const kampe = spilledeKampe.filter((m) => m.round_key === nøgle);
  for (const s of SPILLERE) {
    RUNDE_STILLING.push({ round_key: nøgle, scope: "ALL", league_id: LIGA_ID, user_id: s.id, ...opgør(kampe, s.id) });
  }
}

// Rundesejre: nr. 1 i runden efter samme stige som stillingen (uden
// rundesejr-trinnet, som ikke findes inde i én runde). Delt sejr tæller for alle.
const rundesejre = new Map(SPILLERE.map((s) => [s.id, 0]));
for (const nøgle of spilledeRunder) {
  const rækker = RUNDE_STILLING.filter((r) => r.round_key === nøgle);
  const bedst = rækker.slice().sort((a, b) =>
    b.total_points - a.total_points || b.exact_count - a.exact_count ||
    b.outcome_count - a.outcome_count || a.avg_goal_error - b.avg_goal_error)[0];
  for (const r of rækker) {
    if (r.total_points === bedst.total_points && r.exact_count === bedst.exact_count &&
        r.outcome_count === bedst.outcome_count && r.avg_goal_error === bedst.avg_goal_error) {
      rundesejre.set(r.user_id, rundesejre.get(r.user_id) + 1);
    }
  }
}

const SÆSON_STILLING = SPILLERE.map((s) => ({
  season_id: SÆSON_ID, league_id: LIGA_ID, user_id: s.id,
  ...opgør(spilledeKampe, s.id), round_wins: rundesejre.get(s.id),
}));

// Månedschampionshippet følger KAMPENS måned og ikke rundenøglens: viewet
// grupperer på `date_trunc('month', m.kickoff_at)` (sql/standings_tiebreakers.sql),
// og de to er forskellige netop i den runde, der begynder i juli og spilles i
// august. Den forskel ville koste en hel runde på skærmbilledet.
const MÅNED = "2026-08";
const måned = (m) => m.kickoff_at.slice(0, 7);
const AUGUST = spilledeKampe.filter((m) => måned(m) === MÅNED);
const augustRunder = [...new Set(AUGUST.map((m) => m.round_key))];
const MÅNEDS_STILLING = SPILLERE.map((s) => ({
  month: MÅNED, scope: "ALL", user_id: s.id, ...opgør(AUGUST, s.id),
  round_wins: augustRunder.reduce((sum, nøgle) => {
    const rækker = RUNDE_STILLING.filter((r) => r.round_key === nøgle);
    const top = Math.max(...rækker.map((r) => r.total_points));
    return sum + (rækker.find((r) => r.user_id === s.id).total_points === top ? 1 : 0);
  }, 0),
}));

// De to Championship-vælgere svares siden `#74 championship_selectors.sql` af
// hver sit `distinct`-view i stedet for af hele grundmængden (`G146`).
// Listerne UDLEDES her af præcis de rækker, vælgerne læste før — de spillede
// runder og månedsstillingens egne måneder — så attrappen ikke kan komme til
// at vise en anden dropdown, end den rigtige database ville.
const CHAMPIONSHIP_RUNDER = spilledeRunder.flatMap((nøgle) => [
  { scope: "ALL", round_key: nøgle },
  { scope: LIGA_ID, round_key: nøgle },
]);
const CHAMPIONSHIP_MÅNEDER = [...new Set(MÅNEDS_STILLING.map((r) => r.month))].flatMap((m) => [
  { scope: "ALL", month: m },
  { scope: LIGA_ID, month: m },
]);

// ---------------------------------------------------------------------------
// Rating og ratinghistorik.
//
// GROVT REGNET, og det er den ene ting i filen, der ikke spejler produktionen:
// den rigtige rating er en Elo-agtig motor i `sql/rating_core.sql`, som ikke kan
// køre i en browser. Formlen her giver tal i det rigtige leje og en historik,
// der hænger sammen med rundernes point — nok til et skærmbillede, og ikke et
// forsøg på at gengive motoren.
const START_RATING = 1000;
const RATING_HISTORIK = [];
const ratingNu = new Map(SPILLERE.map((s) => [s.id, START_RATING]));
for (const nøgle of spilledeRunder) {
  const rækker = RUNDE_STILLING.filter((r) => r.round_key === nøgle);
  const snit = rækker.reduce((s, r) => s + r.total_points, 0) / rækker.length;
  const rangeret = rækker.slice().sort((a, b) => b.total_points - a.total_points);
  for (const r of rækker) {
    const delta = Math.round((r.total_points - snit) * 6);
    ratingNu.set(r.user_id, ratingNu.get(r.user_id) + delta);
    RATING_HISTORIK.push({
      user_id: r.user_id, scope: "ALL", round_key: nøgle,
      rating_after: ratingNu.get(r.user_id), delta,
      round_score: r.total_points, matches_predicted: r.matches,
      rnk: rangeret.findIndex((x) => x.user_id === r.user_id) + 1,
    });
  }
}
const RATINGS = SPILLERE.map((s) => ({
  user_id: s.id, scope: "ALL", rating: ratingNu.get(s.id),
  rounds_played: spilledeRunder.length,
  // Under fem runder er ratingen foreløbig — samme regel som motoren.
  provisional: spilledeRunder.length < 5,
  updated_at: new Date(NU - 3600000).toISOString(),
}));

// ---------------------------------------------------------------------------
// Dagens historie (Story Engine v3).
//
// Reglen er `CONTRARIAN`: præcis én deltager ramte udfaldet blandt mindst fire,
// der tippede kampen. Teksten er skrevet efter SKABELONEN i
// `sql/story_engine_v3.sql` (regel 120) med dette datasæts tal — motoren kører i
// databasen og kan ikke køre her, så kortet er en gengivelse og ikke en kørsel.
// Ændrer skabelonen sig, er dette skærmbillede forældet; det er den samme pris
// som resten af billedet, hvor enhver ændring i skærmen gør PNG'en gammel.
const KONTRARIAN_KAMP = kampVed(KONTRARIAN.hjemme, KONTRARIAN.ude);
const miniRækker = SÆSON_STILLING
  .slice()
  .sort((a, b) => b.total_points - a.total_points || b.exact_count - a.exact_count)
  .map((r, i) => ({ rnk: i + 1, name: SPILLERE.find((s) => s.id === r.user_id).navn, pts: r.total_points, me: r.user_id === MIG }));
const minPlads = miniRækker.findIndex((r) => r.me);
const STORY = {
  id: id("77777777", 1),
  round_key: RUNDE_NU,
  user_id: MIG,
  competition_id: KONK_ID,
  rule: "CONTRARIAN",
  priority: 120,
  league_size: SPILLERE.length,
  period: "day",
  day_key: "2026-08-15",
  news_value: 62,
  headline: `🧠 Du var den eneste, der troede på uafgjort i ${KONTRARIAN.hjemme}–${KONTRARIAN.ude}`,
  body: `I Kontorets Premier League havde 4 andre tippet imod. Det endte ${KONTRARIAN.hjemme} ` +
    `${KONTRARIAN_KAMP.home_score}-${KONTRARIAN_KAMP.away_score} ${KONTRARIAN.ude} — 3 point til dig.`,
  payload: {
    day: "15/8", league: "Kontorets Premier League",
    // Tre rækker omkring modtageren, som SQL'en pakker dem.
    mini: miniRækker.slice(Math.max(0, minPlads - 1), Math.max(0, minPlads - 1) + 3),
  },
  created_at: new Date(NU - 5400000).toISOString(),
  dismissed_at: null,
};

// ---------------------------------------------------------------------------
// Tabellerne, som `fake-rest.js` slår op i. Navnene er PostgREST-stierne, altså
// både rigtige tabeller og views — appen kan ikke se forskel, og det skal den
// heller ikke her.
const tabeller = {
  profiles: SPILLERE.map((s) => ({
    id: s.id, display_name: s.navn, is_admin: false,
    created_at: "2026-06-01T10:00:00Z", last_seen_at: new Date(NU).toISOString(),
    anonymized_at: null, display_name_changed_at: null,
  })),
  leagues: [{ id: LIGA_ID, name: "Premier League", is_visible: true, is_official: true, provider: "sportmonks", live_enabled: true }],
  seasons: [{ id: SÆSON_ID, league_id: LIGA_ID, name: "2026/2027", start_date: "2026-07-28", ends_at: "2027-05-23", is_finished: false }],
  teams: HOLD,
  matches: KAMPE,
  predictions: GÆT,
  groups: [{ id: GRUPPE_ID, name: "Kontoret", invite_code: "kontoret", created_by: MIG, created_at: "2026-06-01T10:00:00Z" }],
  group_members: SPILLERE.map((s, i) => ({
    group_id: GRUPPE_ID, user_id: s.id, role: i === 0 ? "admin" : "member",
    joined_at: `2026-06-0${i + 1}T10:00:00Z`,
  })),
  group_counts: [{ group_id: GRUPPE_ID, member_count: SPILLERE.length, competition_count: 1 }],
  competitions: [{
    id: KONK_ID, name: "Kontorets Premier League", league_id: LIGA_ID, season_id: SÆSON_ID,
    mode: "full_season", mode_params: {}, rules: { exact: 3, outcome: 1 },
    invite_code: "pl2627", created_by: MIG, created_at: "2026-07-20T09:00:00Z", group_id: GRUPPE_ID,
  }],
  competition_participants: SPILLERE.map((s) => ({
    competition_id: KONK_ID, user_id: s.id, joined_at: "2026-07-20T09:00:00Z", hidden: false,
  })),
  competition_matches: KAMPE.map((m) => ({ competition_id: KONK_ID, match_id: m.id })),
  competition_status: [{
    competition_id: KONK_ID, matches: KAMPE.length, scored_matches: spilledeKampe.length,
    concluded: false, can_grow: true,
  }],
  competition_awards: [],
  ratings: RATINGS,
  rating_history: RATING_HISTORIK,
  monthly_standings: MÅNEDS_STILLING,
  championship_months: CHAMPIONSHIP_MÅNEDER,
  championship_rounds: CHAMPIONSHIP_RUNDER,
  round_standings: RUNDE_STILLING,
  season_standings: SÆSON_STILLING,
  stories: [STORY],
  latest_story: [],   // rundestoryen udelades: Hjem viser dagens kort i stedet
  milestones: [],
  analytics_events: [],
  client_errors: [],
};

// Sessionen, appen finder i localStorage ved opstart. `access_token` er en
// vilkårlig streng — attrappen kigger ikke på den, og der er ingen server, der
// kunne.
const SESSION = {
  refresh_token: "demo-refresh",
  access_token: "demo-access",
  user: { id: MIG, email: "demo@leagly.app", user_metadata: { display_name: "Mikkel" } },
};

// RPC-svarene. Kun de kald, de skærme vi fotograferer faktisk laver — alt andet
// svarer `null` i `fake-rest.js`, hvilket er den rigtige degradering: appen
// tåler et tomt svar fra dem alle.
const rpc = {
  my_profile: () => tabeller.profiles[0],
  touch_activity: () => null,
  award_competition_periods: () => null,
  career_profile: () => null,
  username_available: () => true,
};

export { NU, MIG, SESSION, tabeller, rpc };
