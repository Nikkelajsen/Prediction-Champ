// Analytics v1 — internt måle-lag. Spec: docs/features/analytics-v1.md
//
// KONTRAKT FOR HELE DENNE FIL: intet kaster, intet afventes, intet blokerer.
// Fejler en logning, sker der ingenting — præcis som touchActivity() i
// data.js. user_id sættes af databasen (kolonnens default er auth.uid()),
// ALDRIG af klienten, så det hverken kan glemmes eller forfalskes.
//
// Ny fil frem for endnu en funktion i data.js (747 linjer, allerede noteret
// som teknisk gæld i DOCUMENTATION.md §12 — én ren splitning frem for at
// gøre gælden større). Denne fils funktioner adlyder en kontrakt intet andet
// i data.js gør (aldrig kastende, aldrig afventet), så det er værd at kunne
// auditere i én fil for sig. loadUserStats bliver bevidst i data.js — at
// flytte den ville røre AdminScreen-imports uden nogen gevinst.
import { restFetch } from "./supabase.js";

// Navigations-hændelser (opened_*) throttles, så hurtig fane-skift eller
// React StrictMode's dobbelt-render i dev ikke tredobler tallene. Writes
// (prediction_saved m.fl.) er IKKE throttlet — de er reelt gentagne, og hver
// af dem tæller mod North Star-metrikken.
const NAV_THROTTLE_MS = 20000;
const lastFired = new Map();   // "name|groupId|competitionId" -> timestamp
const firedOnce = new Set();   // "name|key" — impressions, én gang pr. sideliv

function post(token, name, groupId, competitionId, metadata) {
  restFetch(`/rest/v1/analytics_events`, {
    method: "POST",
    token,
    body: [{
      event_name: name,
      group_id: groupId || null,
      competition_id: competitionId || null,
      metadata: metadata || {},
    }],
    prefer: "return=minimal",
  }).catch(() => {}); // sporing må aldrig kaste en uhåndteret rejection
}

// Log et event. Kaldes ALTID efter at det primære write er lykkedes (aldrig
// inde i det primære try, aldrig awaited) — se instrumenterings-tabellen i
// docs/features/analytics-v1.md for hvert kaldested.
function logEvent(token, name, { groupId = null, competitionId = null, metadata = null } = {}) {
  try {
    if (!token || !name) return;
    if (name.startsWith("opened_")) {
      const k = `${name}|${groupId || ""}|${competitionId || ""}`;
      const now = Date.now();
      if (now - (lastFired.get(k) || 0) < NAV_THROTTLE_MS) return;
      lastFired.set(k, now);
    }
    post(token, name, groupId, competitionId, metadata);
  } catch { /* sporing må aldrig påvirke brugeren */ }
}

// Som logEvent, men kun én gang pr. unik nøgle for hele sidens levetid —
// til impressions (story_viewed), som ellers ville blive talt flere gange,
// når en komponent remounter (fx faneskift frem og tilbage til Hjem).
function logEventOnce(token, name, key, opts) {
  try {
    const k = `${name}|${key}`;
    if (firedOnce.has(k)) return;
    firedOnce.add(k);
    logEvent(token, name, opts);
  } catch { /* sporing må aldrig påvirke brugeren */ }
}

// ---------- Dashboard: read-helpers ----------
// Modsat logEvent* KASTER disse (samme mønster som loadUserStats/
// loadCareerProfile) — AnalyticsPanel fanger fejl pr. sektion, så én langsom
// eller fejlende sektion ikke blokerer de fem andre.
const loadAnalyticsHealth = (token, days = 30) =>
  restFetch(`/rest/v1/rpc/admin_analytics_health`, { method: "POST", token, body: { p_days: days } });

const loadAnalyticsEngagement = (token, days = 30) =>
  restFetch(`/rest/v1/rpc/admin_analytics_engagement`, { method: "POST", token, body: { p_days: days } });

const loadAnalyticsLeagueHealth = (token, days = 30) =>
  restFetch(`/rest/v1/rpc/admin_analytics_league_health`, { method: "POST", token, body: { p_days: days } });

const loadAnalyticsRetention = (token) =>
  restFetch(`/rest/v1/rpc/admin_analytics_retention`, { method: "POST", token, body: {} });

const loadAnalyticsFunnel = (token, days = 30) =>
  restFetch(`/rest/v1/rpc/admin_analytics_funnel`, { method: "POST", token, body: { p_days: days } });

const loadAnalyticsStories = (token, days = 30) =>
  restFetch(`/rest/v1/rpc/admin_analytics_stories`, { method: "POST", token, body: { p_days: days } });

// Runde-serien tager et antal RUNDER og ikke et antal dage. Den er den eneste
// sektion, panelets dagsvælger ikke gælder for, og det er med vilje: en
// udvikling aflæses på produktets egen enhed (spillerunden), ikke på 7/30/90
// dage, som skærer midt igennem en runde.
const loadAnalyticsRounds = (token, rounds = 12) =>
  restFetch(`/rest/v1/rpc/admin_analytics_rounds`, { method: "POST", token, body: { p_rounds: rounds } });

// ---------- Tragt for nye brugere ----------
// RPC'en returnerer én flad `rows`-liste med grouping sets: to scopes
// (vinduet + alt tid) × (totalen + hver vej ind). Klienten plukker den række,
// sektionen skal bruge, frem for at RPC'en skal kende UI'ets opdeling.
//
// De fire trin er IKKE strengt indlejrede: en konkurrence kan være liga-løs,
// så en bruger kan nå "konkurrence" og "tip" uden nogensinde at have en liga.
// Derfor to forskellige tal i sektionen — `steps` tæller, hvem der nåede hvert
// trin overhovedet, mens `stalled` er en ÆGTE partition af kohorten (hver
// bruger tælles præcis ét sted), og det er den, der besvarer "hvor mister vi
// dem". At læse stall-tallene som trin-tal ville dobbelttælle.
const FUNNEL_STEPS = [
  { key: "cohort", label: "Oprettede konto", medianKey: null },
  { key: "reached_league", label: "Kom med i en liga", medianKey: "median_min_league" },
  { key: "reached_competition", label: "Kom med i en konkurrence", medianKey: "median_min_competition" },
  { key: "reached_prediction", label: "Afgav sit første tip", medianKey: "median_min_prediction" },
];

const FUNNEL_STALLS = [
  { key: "stalled_uden_liga", label: "Står uden liga" },
  { key: "stalled_uden_konkurrence", label: "Har liga, men ingen konkurrence" },
  { key: "stalled_uden_tip", label: "Har konkurrence, men intet tip" },
  { key: "stalled_gennemfoert", label: "Nåede hele vejen" },
];

// Find én række i svaret. `path` = null giver totalen for scopet.
function funnelRow(data, scope, path = null) {
  return (data?.rows || []).find((r) => r.scope === scope && (r.path ?? null) === path) || null;
}

// Læg trinnene ud med procent af kohorten og faldet fra forrige trin.
// `drop` er det, sektionen faktisk handler om: hvor stort et spring der
// forsvandt netop dér — ikke hvor mange der er tilbage.
function funnelSteps(row) {
  if (!row || !row.cohort) return [];
  const cohort = row.cohort;
  let prev = null;
  return FUNNEL_STEPS.map((s) => {
    const users = row[s.key] ?? 0;
    const step = {
      key: s.key, label: s.label, users,
      pct: Math.round((1000 * users) / cohort) / 10,
      dropFromPrev: prev === null ? null : prev - users,
      dropPct: prev === null || prev === 0 ? null : Math.round((1000 * (prev - users)) / prev) / 10,
      medianMinutes: s.medianKey ? row[s.medianKey] : null,
    };
    prev = users;
    return step;
  });
}

// Det største fald mellem to på hinanden følgende trin — sektionens overskrift
// i ét tal. Null, når kohorten er tom eller intet trin tabte nogen.
function biggestDrop(steps) {
  let worst = null;
  for (const s of steps) {
    if (s.dropFromPrev === null || s.dropFromPrev <= 0) continue;
    if (!worst || s.dropFromPrev > worst.dropFromPrev) worst = s;
  }
  return worst;
}

// Minutter → læsbar varighed. Medianer i denne sektion spænder fra sekunder
// (inviteret bruger, der joiner via link) til dage (selvstarter, der vender
// tilbage senere), så én fast enhed ville gøre halvdelen ulæselig.
function fmtMinutes(min) {
  if (min === null || min === undefined) return "—";
  const m = Number(min);
  if (m < 1) return `${Math.round(m * 60)} s`;
  if (m < 90) return `${Math.round(m)} min`;
  if (m < 60 * 48) return `${Math.round(m / 60)} t`;
  return `${Math.round(m / 60 / 24)} dage`;
}

// ---------- Story Engine-regler ----------
// Katalogen SKAL matche reglerne i BEGGE motorer — sql/story_engine.sql
// (runde) og sql/story_engine_v2.sql (dag). Den findes her, fordi RPC'en kun
// kan se regler, der HAR udløst — og det interessante spørgsmål er netop,
// hvilke der ALDRIG har. Drift fanges af en test, der læser SQL-filerne og
// sammenligner (src/lib/analytics.test.js), så listen ikke stille kan blive
// forældet, næste gang motoren udvides. Den test læste indtil august 2026 kun
// runde-motorens fil, og derfor stod v2's syv dagsregler som UKENDT uden navn
// i tabellen — drift-testen fangede ikke den udvidelse, den var sat til at
// fange.
const STORY_RULES = {
  // --- Runde-motoren (v1) · prioritet 10–100 · sql/story_engine.sql
  RATING_HIGH: "Højeste rating nogensinde",
  LEAD_TAKEN: "Overtog føringen",
  ROUND_WON: "Vandt runden",
  LEAD_LOST: "Mistede føringen",
  COMEBACK: "Comeback",
  PODIUM_ENTER: "Ind på podiet",
  CLOSING_IN: "Haler ind",
  PERSONAL_BEST: "Personlig rekord",
  H2H_PASS: "Overhalede en rival",
  STREAK: "Stime",
  SHARP: "Skarpe tips",
  MONTH_CHAMP: "Månedens Champion",
  AWARD_WEEK: "Ugens bedste (lokal kåring)",
  AWARD_MONTH: "Månedens bedste (lokal kåring)",
  SEASON_OPENER: "Premiereugen",
  QUIET_ROUND: "Stille runde",
  // --- Dags-motoren (v2/v3) · prioritet 110–189 · sql/story_engine_v2.sql og
  // sql/story_engine_v3.sql. Navnene siger, hvad kortet handler om, ikke hvad
  // tærsklen er — og de er valgt så de ikke kan forveksles med runde-reglernes:
  // STREAK er rundens stime, STREAK_STATUS er dagens, og DUEL er dagens udgave
  // af CLOSING_IN.
  //
  // Efter v3 er reglerne KANDIDATER, ikke udgivelser: kun ét kort pr. bruger pr.
  // dag udgives, så `generated` i tabellen tæller vindere. Andelen af dage, en
  // regel VANDT, er dermed det tal, der siger noget — og MILESTONE vinder altid,
  // når den er i spil.
  MILESTONE: "Milepæl kaprede dagens kort",
  DAY_RESULT: "Dagens facit (dæmpet fald-tilbage)",
  CONTRARIAN: "Alene om at ramme",
  COLLECTIVE_MISS: "Ingen ramte kampen",
  DAY_TOP: "Dagens højeste",
  STREAK_STATUS: "Stimen lever eller brød",
  DUEL: "Duel med nærmeste rival",
  SO_CLOSE: "Ét mål fra eksakt",
};

// Flet RPC'ens tal med katalogen, så regler der ALDRIG har udløst kommer med
// som `never: true` i stedet for slet ikke at være der. En regel, der aldrig
// udløser, er den dyreste slags død kode: den ser ud til at virke.
//
// `viewable` (G73) er de kort, der overhovedet kunne nå en skærm — se RPC'ens
// kommentar i sql/analytics_dashboard.sql. Feltet er `?? generated` og ikke
// `?? 0`: kører klienten mod en database, hvor RPC'en endnu ikke er gen-kørt,
// findes kolonnen ikke, og en nul-nævner ville lade hele tabellens rater
// forsvinde. Faldet tilbage til `generated` er præcis den gamle opførsel.
function storyRuleRows(data) {
  const measured = new Map((data?.rules || []).map((r) => [r.rule, r]));
  const rows = [];
  for (const [rule, label] of Object.entries(STORY_RULES)) {
    const m = measured.get(rule);
    rows.push({
      rule, label,
      generated: m?.generated ?? 0, viewable: m?.viewable ?? m?.generated ?? 0, users: m?.users ?? 0,
      viewed: m?.viewed ?? 0, shared: m?.shared ?? 0, dismissed: m?.dismissed ?? 0,
      view_rate: m?.view_rate ?? null, share_rate: m?.share_rate ?? null,
      dismiss_rate: m?.dismiss_rate ?? null, avg_priority: m?.avg_priority ?? null,
      // `never` = har aldrig udløst, heller ikke uden for vinduet. `silent` =
      // har udløst før, men ikke i vinduet. To forskellige ting: den første er
      // en regel, der måske ikke virker; den anden er bare en stille periode.
      never: !measured.has(rule),
      silent: measured.has(rule) && (m?.generated ?? 0) === 0,
    });
    measured.delete(rule);
  }
  // Regler i databasen, som katalogen ikke kender — sker kun, hvis motoren er
  // udvidet uden at listen ovenfor er fulgt med. Vises frem for at skjules.
  for (const [rule, m] of measured) {
    rows.push({ ...m, rule, label: rule, viewable: m.viewable ?? m.generated ?? 0,
      never: false, silent: (m.generated ?? 0) === 0, unknown: true });
  }
  return rows.sort((a, b) => (b.generated - a.generated) || a.rule.localeCompare(b.rule));
}

// ---------- Delingsflader ----------
// De fire steder, en deling kan komme fra. Rækkefølgen er den, panelet viser
// dem i, og den følger fladernes alder: rundekortet (v1), dagskortet (I25),
// milepælen, stillingen (I22).
const SHARE_SURFACES = [
  { id: "round", label: "Rundekort", hint: "Hjem · tap-through" },
  { id: "day_card", label: "Dagskort", hint: "Hjem · dagens kort" },
  { id: "milestone", label: "Milepæl", hint: "Karriereprofilen" },
  { id: "standings", label: "Stilling", hint: "Stilling-skærmen" },
];

// Opdelingen af `story_shared` findes kun i `metadata.from` og dermed kun i
// SQL'en. Returnerer `null`, når RPC'en ikke er gen-kørt endnu — og det er hele
// pointen med funktionen: nul delinger og en umålt opdeling ser ens ud i et
// panel, der bare skriver 0, og de to betyder det stik modsatte ("knappen
// bruges ikke" vs. "vi måler ikke endnu"). Samme regel som `admin_job_health`s
// umålte fejlrate (G115) og `viewable ?? generated` i storyRuleRows.
function shareSurfaceRows(data) {
  const s = data?.shares;
  if (!s || typeof s !== "object") return null;
  return SHARE_SURFACES.map((f) => ({
    ...f,
    count: s[f.id]?.count ?? 0,
    users: s[f.id]?.users ?? 0,
  }));
}

// ---------- Aktive brugere pr. runde ----------
// Vinduerne er RUNDER og ikke dage. En runde er en uge, så 12 ≈ et kvartal,
// 26 ≈ et halvår, 52 ≈ et år.
const ROUND_WINDOWS = [12, 26, 52];

// Læg serien ud til visning: retning mod forrige runde, og de afledte tal,
// skærmen ellers ville regne inde i sin JSX.
//
// 🔴 EN ÅBEN RUNDE FÅR ALDRIG EN RETNING, og det er hele grunden til, at
// funktionen findes. `is_open` betyder, at ikke alle rundens kampe er låst
// endnu — altså at tallene stadig kan vokse. En delvis runde sammenlignet med
// en hel giver et fald hver eneste gang, uanset hvad brugerne gør, og det fald
// ville blive læst som en udvikling. Runden VISES (den er den nyeste nyhed,
// man har), men den er mærket, og hverken den eller dens nabo får en pil.
// Samme klasse som G73's nævner og G115's umålte fejlrate: et tal, der ser
// målt ud, men ikke er sammenligneligt.
function roundActivityRows(data) {
  const rounds = Array.isArray(data?.rounds) ? data.rounds : [];
  return rounds.map((r, i) => {
    const prev = i > 0 ? rounds[i - 1] : null;
    const comparable = prev && !r.is_open && !prev.is_open;
    return {
      ...r,
      // `returning` frem for at lade skærmen trække to tal fra hinanden: nye
      // og tilbagevendende skal altid summe til spillerne på skærmen.
      returning: Math.max(0, (r.players ?? 0) - (r.new_players ?? 0)),
      delta: comparable ? (r.players ?? 0) - (prev.players ?? 0) : null,
      // Gabet mellem "kom forbi" og "spillede". null når besøg er umålt —
      // aldrig 0, som ville betyde "alle der kom forbi, spillede".
      idle_visitors: r.visitors === null || r.visitors === undefined
        ? null : Math.max(0, r.visitors - (r.players ?? 0)),
    };
  });
}

// Overskriftstallet og retningen. Begge læses af den seneste LUKKEDE runde —
// en runde i gang er et delvist tal og må hverken bære overskriften eller
// pilen. Er der ingen lukket runde endnu, er svaret null og ikke et gæt.
function roundActivitySummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const closed = list.filter((r) => !r.is_open);
  const latest = closed.length ? closed[closed.length - 1] : null;
  const prev = closed.length > 1 ? closed[closed.length - 2] : null;
  const open = list.find((r) => r.is_open) || null;
  const players = closed.map((r) => r.players ?? 0);
  // Besøg har en tredje tilstand, spillere ikke har: UMÅLT. En runde, hvis uge
  // begynder før aktivitetssporingen fandtes, svarer `null`, og den må ikke
  // trækkes ned i et gennemsnit som et nul — så ville de ældste runder i et
  // 52-runders vindue halvere tallet uden at nogen var blevet væk. Runderne
  // filtreres derfor FRA, i stedet for at blive talt som 0.
  const visitors = closed.map((r) => r.visitors).filter((v) => v !== null && v !== undefined);
  return {
    latest,
    prev,
    open,
    closed_rounds: closed.length,
    delta: latest && prev ? (latest.players ?? 0) - (prev.players ?? 0) : null,
    // Gennemsnittet er et niveau at holde den seneste runde op mod — regnet
    // over de lukkede runder alene, af samme grund som pilen.
    avg_players: players.length
      ? Math.round((players.reduce((a, b) => a + b, 0) / players.length) * 10) / 10
      : null,
    avg_visitors: visitors.length
      ? Math.round((visitors.reduce((a, b) => a + b, 0) / visitors.length) * 10) / 10
      : null,
    // Hvor mange af de lukkede runder besøgstallet overhovedet er målt for.
    // Står ved siden af gennemsnittet, så "5,0 over 2 runder" ikke kan
    // forveksles med "5,0 over 12".
    measured_visitor_rounds: visitors.length,
    // Summen af debuter i vinduet: hvor meget af spillerbasen der er kommet
    // til i den viste periode. Åbne runder tælles med her — en debut er en
    // debut, uanset om runden er færdig.
    new_players: list.reduce((a, r) => a + (r.new_players ?? 0), 0),
  };
}

// ---------- Liga-diagnose ----------
// Afløser Liga Health Score (juli 2026). Den gamle score var ét 0-100-tal,
// vægtet ud fra fem faktorer i SQL. Den var for BRED til at bruge: på de fire
// første rigtige ligaer gav den 75/77/77/88 — alle fire grønne og "SUND", så
// den kunne hverken skelne ligaerne fra hinanden eller sige HVAD der var galt.
// "77" er ikke en handling; "ligaen har ingen aktiv konkurrence" er.
//
// I stedet: RPC'en måler signaler, og denne fil FORTOLKER dem — én tilstand
// pr. liga, første regel der passer vinder, ligesom Story Engines regelkatalog.
// Reglerne bor i JS og ikke i SQL, fordi de er produktjudgement, der skal
// justeres ofte, og fordi de kan unit-testes (ingen CI kører SQL). Samme valg
// som Onboarding v1, hvor tilstanden bevidst udledes af data uden SQL.
//
// Tærskler ét sted. At ændre et tal her ændrer diagnosen overalt — ingen
// gen-kørsel i Supabase, ingen migrering.
const LEAGUE_THRESHOLDS = {
  minAgeDays: 14,       // yngre end dette → kan ikke bedømmes
  deadDays: 30,         // ingen aktivitet i så mange dage → død
  dormantDays: 14,      // … eller i så mange → dvale
  narrowShare: 50,      // under så mange % af medlemmerne tipper → for smal
  lowCompletion: 50,    // deltagelse under så mange % → lav
  decliningDrop: 15,    // fald i procentpoint mod forrige vindue → faldende
  minSlots: 5,          // færre mulige tips end dette → deltagelse bedømmes ikke
};

// Alvor styrer rækkefølgen i tabellen: det mest akutte øverst. `tone` er
// ALDRIG eneste signal — StateChip viser altid ordet, farven er kun ekstra
// (samme regel som ModeBars følger for farveblindhed).
const LEAGUE_STATES = {
  dead:           { label: "Død",                  tone: "red",   severity: 6 },
  no_predictors:  { label: "Ingen tipper",         tone: "red",   severity: 5 },
  no_competition: { label: "Ingen konkurrence",    tone: "red",   severity: 5 },
  dormant:        { label: "I dvale",              tone: "red",   severity: 5 },
  solo:           { label: "Kun ét medlem",        tone: "gold",  severity: 4 },
  single_player:  { label: "Bæres af én",          tone: "gold",  severity: 4 },
  narrow:         { label: "Kun en del tipper",    tone: "gold",  severity: 3 },
  declining:      { label: "Deltagelsen falder",   tone: "gold",  severity: 3 },
  low_completion: { label: "Lav deltagelse",       tone: "gold",  severity: 2 },
  healthy:        { label: "Sund",                 tone: "green", severity: 1 },
  no_rounds:      { label: "Intet at måle på",     tone: null,    severity: 0 },
  too_new:        { label: "For ny",               tone: null,    severity: 0 },
};

const pct = (v) => (v === null || v === undefined ? "—" : `${v} %`);
const dayWord = (n) => (n === 1 ? "dag" : "dage");

// Diagnosticér én liga ud fra dens målte signaler. Ren funktion: samme input
// giver altid samme output, ingen DOM, ingen netværk.
//
// Regler evalueres OPPEFRA OG NED, og den første, der passer, vinder. Derfor
// er rækkefølgen selve designet: en liga uden aktiv konkurrence skal høre
// "opret en konkurrence", ikke "for få tipper" — årsagen før symptomet.
function diagnoseLeague(l, t = LEAGUE_THRESHOLDS) {
  const state = (key, why, action) => ({ key, why, action, ...LEAGUE_STATES[key] });
  const days = l.days_since_activity;
  const win = l.window_days;

  // 1. For ung til at bedømmes. Skal stå FØRST: uden den ville en liga
  //    oprettet i går, som endnu ikke har nået at gøre noget, blive stemplet
  //    "død" — nøjagtig den fejl, den gamle scores null-sikre renormalisering
  //    fandtes for at undgå.
  if (l.age_days < t.minAgeDays) {
    return state("too_new",
      `Ligaen er ${l.age_days} ${dayWord(l.age_days)} gammel — for tidligt at bedømme.`,
      `Kig igen, når den er ${t.minAgeDays} dage.`);
  }
  if (days === null || days === undefined) {
    return state("dead",
      "Ingen registreret aktivitet overhovedet.",
      "Ligaen blev oprettet og forladt. Spørg opretteren, om den skal findes.");
  }
  if (days > t.deadDays) {
    return state("dead",
      `Ingen aktivitet i ${days} dage.`,
      "Ligaen er reelt ophørt — start en kort konkurrence, eller lad den gå.");
  }
  // 2. Årsag før symptom: uden en konkurrence i gang er der bogstavelig talt
  //    intet at tippe på, og alle deltagelses-tal nedenfor ville måle en
  //    mangel, ligaen ikke selv kan gøre noget ved.
  if (l.competitions_active === 0) {
    return state("no_competition",
      l.competitions_total === 0
        ? "Ligaen har aldrig haft en konkurrence."
        : `Ingen af ligaens ${l.competitions_total} konkurrencer har en runde tilbage, der ikke er gået i gang.`,
      "Opret en konkurrence — indtil da er der intet at tippe på.");
  }
  if (days > t.dormantDays) {
    return state("dormant",
      `Seneste aktivitet var for ${days} dage siden, selvom der er en konkurrence i gang.`,
      "Konkurrencen kører uden spillere — tjek om deadline-notifikationerne når frem.");
  }
  if (l.members <= 1) {
    return state("solo",
      `Ligaen har ${l.members} medlem — der er ingen at dyste mod.`,
      "Den manglende handling er en invitation, ikke mere engagement.");
  }
  // 3. Herfra måler vi deltagelse. Uden en låst kamp i vinduet findes der
  //    ingen "mulige tips", og enhver deltagelsesprocent ville være et
  //    påstået 0 — samme falskhed, som retention-sektionen gråtoner væk.
  if (l.rounds_available === 0) {
    return state("no_rounds",
      `Ingen låst kamp i de seneste ${win} dage — der er intet at måle deltagelse på.`,
      "Vælg et længere vindue, eller vent til ligaens næste kamp låser.");
  }
  if (l.predictors === 0) {
    return state("no_predictors",
      `Ingen af ligaens ${l.members} medlemmer tippede, selvom ${l.rounds_available} ${l.rounds_available === 1 ? "runde låste" : "runder låste"} i vinduet.`,
      "Konkurrencen kører, men ingen spiller. Det er det alvorligste, en aktiv liga kan vise.");
  }
  if (l.predictors === 1) {
    return state("single_player",
      `Én af ${l.members} medlemmer står for alle ligaens tips.`,
      "Klassisk vennegruppe-sammenbrud: den ene bliver træt, og så er ligaen væk. Få nummer to i gang.");
  }
  if (l.predictor_share !== null && l.predictor_share < t.narrowShare) {
    return state("narrow",
      `Kun ${l.predictors} af ${l.members} medlemmer tippede (${pct(l.predictor_share)}).`,
      "Bredden er problemet, ikke flittigheden — de aktive tipper fint, resten er passagerer.");
  }
  const prev = l.completion_rate_prev;
  const now = l.completion_rate;
  if (prev !== null && prev !== undefined && now !== null && now !== undefined && prev - now >= t.decliningDrop) {
    return state("declining",
      `Deltagelsen faldt fra ${pct(prev)} til ${pct(now)} mod de foregående ${win} dage.`,
      "Retningen betyder mere end niveauet — find ud af, hvad der skete imellem de to vinduer.");
  }
  if (l.completion_slots >= t.minSlots && now !== null && now !== undefined && now < t.lowCompletion) {
    return state("low_completion",
      `${l.completion_done} af ${l.completion_slots} mulige tips blev afgivet (${pct(now)}).`,
      "Medlemmerne er der, men når ikke at tippe — se på deadline-påmindelsen.");
  }
  return state("healthy",
    `${l.predictors} af ${l.members} medlemmer tipper, og ${pct(now)} af de mulige tips blev afgivet.`,
    null);
}

// Diagnosticér hele listen og sortér den mest akutte først. Nøjagtig samme
// rækkefølge hver gang: alvor, derefter laveste deltagelse (null sidst),
// derefter navn — så en liga aldrig hopper rundt mellem to opdateringer.
function diagnoseLeagues(leagues, windowDays, t = LEAGUE_THRESHOLDS) {
  return (leagues || [])
    .map((l) => {
      const withWindow = { ...l, window_days: windowDays };
      return { ...withWindow, diagnosis: diagnoseLeague(withWindow, t) };
    })
    .sort((a, b) => {
      if (a.diagnosis.severity !== b.diagnosis.severity) return b.diagnosis.severity - a.diagnosis.severity;
      const ar = a.completion_rate, br = b.completion_rate;
      if (ar !== br) {
        if (ar === null || ar === undefined) return 1;
        if (br === null || br === undefined) return -1;
        return ar - br;
      }
      return String(a.name).localeCompare(String(b.name), "da");
    });
}

// Én linje øverst i sektionen: hvor mange ligaer der har brug for
// opmærksomhed lige nu. Erstatter det, den gamle score forsøgte at være —
// men som en optælling af navngivne tilstande, ikke et gennemsnit af dem.
function summarizeDiagnoses(diagnosed) {
  const out = { akut: 0, svag: 0, sund: 0, ubedømt: 0 };
  for (const l of diagnosed || []) {
    const tone = l.diagnosis.tone;
    if (tone === "red") out.akut += 1;
    else if (tone === "gold") out.svag += 1;
    else if (tone === "green") out.sund += 1;
    else out.ubedømt += 1;
  }
  return out;
}

export { logEvent, logEventOnce, loadAnalyticsHealth, loadAnalyticsEngagement, loadAnalyticsLeagueHealth, loadAnalyticsRetention, loadAnalyticsFunnel, loadAnalyticsStories, loadAnalyticsRounds, roundActivityRows, roundActivitySummary, ROUND_WINDOWS, diagnoseLeague, diagnoseLeagues, summarizeDiagnoses, LEAGUE_THRESHOLDS, funnelRow, funnelSteps, biggestDrop, fmtMinutes, FUNNEL_STALLS, storyRuleRows, STORY_RULES, shareSurfaceRows, SHARE_SURFACES };
