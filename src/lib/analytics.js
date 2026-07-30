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
  } catch (e) { /* sporing må aldrig påvirke brugeren */ }
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
  } catch (e) { /* sporing må aldrig påvirke brugeren */ }
}

// ---------- Dashboard: read-helpers ----------
// Modsat logEvent* KASTER disse (samme mønster som loadUserStats/
// loadCareerProfile) — AnalyticsPanel fanger fejl pr. sektion, så én langsom
// eller fejlende sektion ikke blokerer de tre andre.
const loadAnalyticsHealth = (token, days = 30) =>
  restFetch(`/rest/v1/rpc/admin_analytics_health`, { method: "POST", token, body: { p_days: days } });

const loadAnalyticsEngagement = (token, days = 30) =>
  restFetch(`/rest/v1/rpc/admin_analytics_engagement`, { method: "POST", token, body: { p_days: days } });

const loadAnalyticsLeagueHealth = (token, days = 30) =>
  restFetch(`/rest/v1/rpc/admin_analytics_league_health`, { method: "POST", token, body: { p_days: days } });

const loadAnalyticsRetention = (token) =>
  restFetch(`/rest/v1/rpc/admin_analytics_retention`, { method: "POST", token, body: {} });

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
        : `Ingen af ligaens ${l.competitions_total} konkurrencer har en ulåst runde tilbage.`,
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
  // 3. Herfra måler vi deltagelse. Uden en låst runde i vinduet findes der
  //    ingen "mulige tips", og enhver deltagelsesprocent ville være et
  //    påstået 0 — samme falskhed, som retention-sektionen gråtoner væk.
  if (l.rounds_available === 0) {
    return state("no_rounds",
      `Ingen låst runde i de seneste ${win} dage — der er intet at måle deltagelse på.`,
      "Vælg et længere vindue, eller vent til ligaens næste runde låser.");
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

export {
  logEvent, logEventOnce,
  loadAnalyticsHealth, loadAnalyticsEngagement, loadAnalyticsLeagueHealth, loadAnalyticsRetention,
  diagnoseLeague, diagnoseLeagues, summarizeDiagnoses, LEAGUE_THRESHOLDS, LEAGUE_STATES,
};
