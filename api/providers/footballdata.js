// Datakilde: football-data.org (api.football-data.org/v4).
//
// Hvorfor en leverandør nummer to: Sportmonks' gratis-plan rummer Superligaen og
// Scotland Premiership, men hverken Premier League, Champions League, Bundesliga,
// Serie A eller Primera División — de koster €29/md plus et add-on på €29/md for
// CL (docs/DECISIONS.md A10). football-data.orgs gratis-plan rummer alle fem, men
// ikke Superligaen. Planerne er komplementære, og tilsammen er de gratis.
//
// Tre ting adskiller den fra Sportmonks:
//
//   1. Nøglen er en HEADER (`X-Auth-Token`), ikke en query-parameter.
//   2. Hele sæsonens kampprogram kommer i ÉT kald — ingen paginering. Det er
//      grunden til, at 10 kald/minut er rigeligt: forbruget skalerer med antal
//      turneringer én gang pr. sync, ikke med antal kampe.
//   3. Gratis-planen har FORSINKEDE resultater og ingen livescore. Kampe herfra
//      må derfor ikke skrive live_*-felterne, medmindre ligaen har
//      live_enabled = true (sæt den, hvis €12/md-planen med livescores tegnes).
//      Point er upåvirkede: de kommer altid fra det endelige resultat.
//
// Miljøvariabel: FOOTBALLDATA_TOKEN

const BASE = "https://api.football-data.org/v4";

// Præfikset på alle id'er fra denne leverandør.
//
// matches.api_fixture_id har en GLOBAL unique-constraint, og både Sportmonks og
// football-data.org bruger almindelige heltal — kamp 537654 findes i begge
// univers. Uden et præfiks ville to forskellige kampe kunne kollidere i
// upserten og tavst overskrive hinanden. Sportmonks beholder bare tal (deres
// id'er står allerede i basen), så præfikset er nyt-leverandør-siden af aftalen.
const PREFIX = "fd:";

// Statusværdier hos football-data.org.
// AWARDED = kampen er tildelt et resultat ved skrivebordsafgørelse; den har et
// endeligt resultat på nøjagtig samme måde som FINISHED.
const FINISHED_STATES = new Set(["FINISHED", "AWARDED"]);
const LIVE_STATES = new Set(["IN_PLAY", "PAUSED"]);

// `/matches`-endpointet tillader højst 10 dages spænd.
const MAX_WINDOW_DAYS = 10;

function statusOf(m) {
  if (FINISHED_STATES.has(m.status)) return "finished";
  if (LIVE_STATES.has(m.status)) return "live";
  // SCHEDULED, TIMED, POSTPONED, SUSPENDED, CANCELLED — samme behandling.
  return "scheduled";
}

function team(t) {
  // Champions League-kampe findes i API'et, før lodtrækningen er foretaget: så
  // er homeTeam/awayTeam til stede, men med id og name = null. Kalderen springer
  // kampe uden begge hold over, præcis som den gør for Sportmonks.
  if (!t?.id || !t?.name) return null;
  return { providerId: String(t.id), globalId: PREFIX + t.id, name: t.name };
}

function normalize(m) {
  const full = m.score?.fullTime || {};
  return {
    providerId: String(m.id),
    globalId: PREFIX + m.id,
    kickoffAt: m.utcDate ?? null,
    // Rå engelsk stage-navn ("REGULAR_SEASON", "LAST_16" …) — oversættes i
    // STAGE_LABELS (src/lib/scoring.js), samme vej som Sportmonks' navne.
    stageName: m.stage ?? null,
    home: team(m.homeTeam),
    away: team(m.awayTeam),
    status: statusOf(m),
    score: {
      home: Number.isFinite(full.home) ? full.home : null,
      away: Number.isFinite(full.away) ? full.away : null,
    },
    liveState: m.status ?? null,
    // Spilleminuttet findes ikke på gratis-planen. Feltet læses alligevel, så
    // en opgradering af abonnementet begynder at levere det uden en kodeændring.
    liveMinute: Number.isFinite(m.minute) ? m.minute : null,
  };
}

// Ét gen-forsøg ved 429.
//
// Loftet er 10 kald/minut, og vores forbrug ligger under 6 i det værste minut
// (5 sync-matches-jobs + sync-live), så en 429 betyder reelt, at cron-jobbene
// er faldet sammen på samme minut. Ét gen-forsøg er nok til at komme videre;
// to ville sløre, at jobbene skal spredes ud.
async function fdFetch(path, token, fetchImpl) {
  const call = () => fetchImpl(`${BASE}${path}`, { headers: { "X-Auth-Token": token } });
  let res = await call();
  if (res.status === 429) {
    const reset = Number(res.headers?.get?.("X-RequestCounter-Reset"));
    const waitMs = (Number.isFinite(reset) && reset > 0 ? Math.min(reset, 60) : 6) * 1000;
    await new Promise((r) => setTimeout(r, waitMs));
    res = await call();
  }
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403) {
      throw new Error(
        `football-data.org: 403 — turneringen er ikke med i planen for nøglen (${body})`
      );
    }
    throw new Error(`football-data.org: ${res.status} ${body}`);
  }
  return res.json();
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// Sæsonens startår — det tal, `?season=` taler i. Både `currentSeason` og hver
// række i `seasons` bærer en `startDate` ("2025-07-08"), og året deri ER id'et.
function startYear(season) {
  return String(season?.startDate || "").match(/^\d{4}/)?.[0] ?? null;
}

export const footballdata = {
  key: "footballdata",
  label: "football-data.org",
  tokenEnv: "FOOTBALLDATA_TOKEN",
  // Leverandøren KAN levere livescore — men først på €12/md-planen. Om det
  // faktisk skrives, afgøres pr. liga af leagues.live_enabled, ikke her.
  supportsLive: true,

  toGlobalId: (id) => PREFIX + id,
  fromGlobalId: (id) => String(id).slice(PREFIX.length),

  // Der er intet sæson-id at slå op: `?season=` tager STARTÅRET. Sæsonen hedder
  // "2026/2027" hos os, så vi tager de fire første cifre. Ingen netværkskald —
  // og dermed intet kald spildt på et opslag, leverandøren ikke har brug for.
  async resolveSeasonId({ seasonName, apiLeagueId }) {
    const year = String(seasonName || "").match(/\d{4}/)?.[0];
    if (!year) {
      throw new Error(
        `Kunne ikke udlede et sæsonår af '${seasonName}' for ${apiLeagueId}. ` +
        `football-data.org bruger startåret (fx 2026) — sæt api_season_id direkte på sæson-rækken.`
      );
    }
    return year;
  },

  // Hele sæsonen i ét kald. `apiLeagueId` er turneringskoden ("PL", "CL",
  // "BL1", "SA", "PD") — den samme text-kolonne som Sportmonks' talværdier.
  async fetchSeasonFixtures({ apiLeagueId, apiSeasonId, token, fetchImpl = fetch }) {
    const data = await fdFetch(
      `/competitions/${apiLeagueId}/matches?season=${apiSeasonId}`,
      token,
      fetchImpl
    );
    return (data.matches || []).map(normalize);
  },

  // Hvorfor der findes et ekstra kald netop til den tomme sæson:
  //
  // `/competitions/<kode>/matches?season=<år>` svarer **200 med en tom liste** i
  // to helt forskellige situationer — sæsonen findes hos leverandøren, men har
  // endnu ingen kampe (Champions League før lodtrækningen), ELLER
  // `api_season_id` peger på et år, leverandøren slet ikke kender. De to ser ens
  // ud i Admin → Drift (`totalFixtures: 0`), og præcis dét efterlod `B8`
  // uafgjort: den første retter sig selv, den anden gør ikke.
  //
  // `/competitions/<kode>` bærer svaret: `currentSeason` og listen `seasons`
  // siger, hvilke år leverandøren overhovedet har. Kaldet sker KUN, når sæsonen
  // kom tom hjem — altså højst ét ekstra kald pr. kørsel, og kun mens
  // turneringen alligevel ikke leverer noget. Rate limiten (10/minut) mærker
  // det ikke.
  async describeEmptySeason({ apiLeagueId, apiSeasonId, token, fetchImpl = fetch }) {
    const data = await fdFetch(`/competitions/${apiLeagueId}`, token, fetchImpl);
    const requested = String(apiSeasonId);
    const current = startYear(data.currentSeason);
    const known = [...new Set((data.seasons || []).map(startYear).filter(Boolean))];

    // Rækkefølgen er ikke tilfældig: den sikre udlægning først, gættet sidst.
    let verdict;
    if (known.includes(requested) || current === requested) {
      verdict = {
        code: "season-empty",
        // Den ufarlige udgave. Sæsonen er oprettet, kampprogrammet er bare ikke
        // offentliggjort endnu — næste kørsel efter offentliggørelsen henter det.
        message: `Sæsonen ${requested} findes hos ${footballdata.label}, men har endnu ingen kampe. Retter sig selv, når programmet offentliggøres.`,
      };
    } else if (current && requested > current) {
      verdict = {
        code: "season-not-published",
        // Også ufarlig, men et andet sted i forløbet: sæsonen er ikke engang
        // oprettet endnu. Skelnes fra ovenstående, fordi den siger noget om HVOR
        // længe der er til — en sæson uden en række er længere væk end en tom.
        message: `${footballdata.label} har endnu ikke oprettet sæsonen ${requested} (aktuel sæson er ${current}). Ingen handling — turneringen begynder at hente af sig selv.`,
      };
    } else if (known.length || current) {
      verdict = {
        code: "season-unknown",
        // Den, der IKKE retter sig selv.
        message: `Sæsonen ${requested} kendes ikke af ${footballdata.label} (aktuel: ${current ?? "ukendt"}; kendte: ${known.join(", ") || "ingen"}). Ret api_season_id på sæson-rækken.`,
      };
    } else {
      verdict = {
        code: "undetermined",
        message: `${footballdata.label} oplyste hverken aktuel sæson eller sæsonliste for ${apiLeagueId} — spørgsmålet kan ikke afgøres herfra.`,
      };
    }

    return { requestedSeason: requested, currentSeason: current, knownSeasons: known, ...verdict };
  },

  // Kampe i et datovindue. football-data.org har intet "hent netop disse id'er"
  // på gratis-planen, så vi henter vinduet omkring de kampe, vi allerede ved
  // ligger dér, og filtrerer selv. Det er ÉT kald uanset hvor mange
  // turneringer der spiller — modsat Sportmonks, der tager 40 id'er pr. kald.
  async fetchLive({ providerIds, kickoffs = [], token, fetchImpl = fetch }) {
    const wanted = new Set(providerIds.map(String));
    if (!wanted.size) return new Map();

    const times = kickoffs.map((k) => new Date(k).getTime()).filter(Number.isFinite);
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    // Én dags luft i begge ender: kickoff er UTC, og en kamp kl. 21 dansk tid
    // ligger på grænsen til næste dato.
    let from = (times.length ? Math.min(...times, now) : now) - day;
    let to = (times.length ? Math.max(...times, now) : now) + day;
    // Endpointet afviser spænd over 10 dage. En hængende live-markering fra en
    // gammel kamp må ikke kunne gøre hele opslaget ubrugeligt, så vi klipper
    // vinduet frem for at fejle — kampen falder da bare ud af svaret, og
    // kalderen rydder markeringen, hvilket er den rigtige udgang alligevel.
    if (to - from > MAX_WINDOW_DAYS * day) from = to - MAX_WINDOW_DAYS * day;

    const data = await fdFetch(
      `/matches?dateFrom=${isoDate(from)}&dateTo=${isoDate(to)}`,
      token,
      fetchImpl
    );
    const out = new Map();
    for (const m of data.matches || []) {
      if (!wanted.has(String(m.id))) continue;
      out.set(PREFIX + m.id, normalize(m));
    }
    return out;
  },
};

export const __test = { normalize, statusOf, PREFIX };
