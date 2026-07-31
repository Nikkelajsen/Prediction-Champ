// Datakilde: Sportmonks (api.sportmonks.com/v3/football).
//
// Koden her er FLYTTET, ikke nyskrevet: den kommer ordret fra api/sync-matches.js
// (sæsonopslag, paginering, score-udtræk) og api/sync-live.js (multi-opslag,
// state-tolkning, spilleminut). Den eneste tilføjelse er normalize(), som
// oversætter Sportmonks' felter til den fælles form, begge endpoints nu taler.
//
// Nøglen sendes som query-parameter (`&api_token=`), hvilket er Sportmonks' egen
// konvention — modsat football-data.org, der bruger en header.
//
// Miljøvariabel: SPORTMONKS_TOKEN

const BASE = "https://api.sportmonks.com/v3/football";

// Afslutnings-states. Stod før to steder (sync-matches.js:135 og sync-live.js:34)
// med en kommentar om, at de skulle holdes ens — nu er de ét sted.
const FINISHED_STATES = ["FT", "AET", "FT_PEN"];

// States hvor kampen er i gang (inkl. pauser undervejs).
const LIVE_STATES = new Set([
  "INPLAY_1ST_HALF", "INPLAY_2ND_HALF", "HT", "BREAK",
  "INPLAY_ET", "INPLAY_ET_2ND_HALF", "EXTRA_TIME_BREAK",
  "PEN_BREAK", "INPLAY_PENALTIES", "PENALTIES",
]);

// Sikkerhedsnet mod en uendelig løkke, hvis Sportmonks bliver ved med at sige
// has_more. 60 sider à 50 kampe = 3.000 kampe, altså rigeligt til en hel sæson.
const MAX_PAGES = 60;
// Live-opslaget tager flere kampe i ét kald.
const MAX_IDS_PER_CALL = 40;

// Sportmonks returnerer state-navnet i flere felter afhængigt af endpoint/plan.
function stateNames(fx) {
  return [fx.state?.developer_name, fx.state?.state, fx.state?.short_name].filter(Boolean);
}

// "scheduled" dækker også udsat/aflyst. Det er med vilje: begge endpoints
// behandler dem ens (skriv intet resultat, ryd en evt. live-markering), og en
// fjerde status ville være en skelnen uden en konsekvens.
function statusOf(fx) {
  const names = stateNames(fx);
  if (names.some((n) => FINISHED_STATES.includes(n))) return "finished";
  if (names.some((n) => LIVE_STATES.has(n) || /INPLAY/i.test(n))) return "live";
  return "scheduled";
}

// Nuværende stilling. Under en kamp opdaterer Sportmonks "CURRENT"-scoren
// løbende, så samme udtræk virker både live og ved slutfløjt.
function currentScore(fx) {
  const cur = (fx.scores || []).filter((s) => s.description === "CURRENT");
  return {
    home: cur.find((s) => s.score?.participant === "home")?.score?.goals ?? null,
    away: cur.find((s) => s.score?.participant === "away")?.score?.goals ?? null,
  };
}

// Spilleminut fra den periode, der tikker. Null i pauser — og hvis
// include=periods ikke er med i abonnementet, så viser UI'et bare "LIVE".
function liveMinute(fx) {
  const p = (fx.periods || []).find((x) => x.ticking);
  return Number.isFinite(p?.minutes) ? p.minutes : null;
}

function participant(fx, location) {
  const p = (fx.participants || []).find((x) => x?.meta?.location === location);
  if (!p?.id || !p?.name) return null;
  return { providerId: String(p.id), globalId: String(p.id), name: p.name };
}

// ---------------------------------------------------------------------------
// Den normaliserede form. ALLE providere returnerer præcis denne:
//
//   {
//     providerId  string   leverandørens eget kamp-id
//     globalId    string   værdien i matches.api_fixture_id
//     kickoffAt   string    | null
//     stageName   string    | null   (rå, engelsk — oversættes i src/lib/scoring.js)
//     home/away   { providerId, globalId, name } | null
//     status      "scheduled" | "live" | "finished"
//     score       { home: number|null, away: number|null }   aktuel stilling
//     liveState   string | null   rå state-navn til matches.live_state
//     liveMinute  number | null
//   }
//
// `score` er den AKTUELLE stilling, ikke nødvendigvis den endelige. Kalderen
// afgør, om den må skrives i home_score/away_score — og det må den kun, når
// status er "finished". Hele appen bruger "home_score is not null" som "kampen
// er spillet", så en live-stilling i den kolonne ville udløse point midt i en kamp.
// ---------------------------------------------------------------------------
function normalize(fx) {
  return {
    providerId: String(fx.id),
    globalId: String(fx.id),
    kickoffAt: fx.starting_at ?? null,
    stageName: fx.stage?.name ?? null,
    home: participant(fx, "home"),
    away: participant(fx, "away"),
    status: statusOf(fx),
    score: currentScore(fx),
    liveState: fx.state?.developer_name || fx.state?.state || fx.state?.short_name || null,
    liveMinute: liveMinute(fx),
  };
}

export const sportmonks = {
  key: "sportmonks",
  label: "Sportmonks",
  tokenEnv: "SPORTMONKS_TOKEN",
  supportsLive: true,

  // Bevidst UDEN præfiks. Sportmonks-id'erne står allerede i tusindvis af rækker
  // i matches.api_fixture_id, og et præfiks her ville kræve en datamigrering af
  // hele tabellen for at undgå, at hver eneste kamp blev oprettet på ny.
  // Nye leverandører præfikser i stedet (se footballdata.js).
  toGlobalId: (id) => String(id),
  fromGlobalId: (id) => String(id),

  // Slå sæson-id op ud fra navnet (fx "2026/2027"). Kaldes kun, når
  // seasons.api_season_id er tom — bagefter gemmer kalderen id'et.
  async resolveSeasonId({ apiLeagueId, seasonName, token, fetchImpl = fetch }) {
    const res = await fetchImpl(
      `${BASE}/leagues/${apiLeagueId}?include=seasons&api_token=${token}`
    );
    if (!res.ok) throw new Error(`Sportmonks (liga): ${res.status} ${await res.text()}`);
    const data = await res.json();
    const seasons = data.data?.seasons || [];
    const match = seasons.find((s) => s.name === seasonName);
    if (!match) {
      const available = seasons.map((s) => s.name).join(", ") || "(ingen sæsoner fundet)";
      throw new Error(
        `Kunne ikke finde sæsonen '${seasonName}' hos Sportmonks for liga ${apiLeagueId}. Tilgængelige sæsoner: ${available}`
      );
    }
    return String(match.id);
  },

  // Hele sæsonens kampprogram. Pagineret — ~4 kald for en typisk turnering.
  async fetchSeasonFixtures({ apiSeasonId, token, fetchImpl = fetch }) {
    const byId = new Map();
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const url =
        `${BASE}/fixtures?filters=fixtureSeasons:${apiSeasonId}` +
        `&include=participants;scores;state;stage&per_page=50&page=${page}&api_token=${token}`;
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`Sportmonks (kampe): ${res.status} ${await res.text()}`);
      const data = await res.json();
      for (const fx of data.data || []) byId.set(fx.id, fx);
      hasMore = !!data.pagination?.has_more;
      page++;
      // FEJL frem for at bryde stille. Loftet var før 20 sider med et bart
      // `break`, så en stor turnering kunne blive trunkeret uden at nogen
      // opdagede det: svaret var 200, og de manglende kampe fandtes bare ikke.
      if (page > MAX_PAGES && hasMore) {
        throw new Error(
          `Paginering afbrudt: Sportmonks har flere kampe efter side ${MAX_PAGES} for sæson ${apiSeasonId}. ` +
          `Kampprogrammet ville blive ufuldstændigt. Hæv MAX_PAGES i api/providers/sportmonks.js.`
        );
      }
      if (page > MAX_PAGES) break;
    }
    return [...byId.values()].map(normalize);
  },

  // Netop de angivne kampe, ét kald pr. 40. Returnerer en Map globalId → kamp;
  // kampe uden for abonnementet mangler ganske enkelt i den, og kalderen rydder
  // deres live-markering i stedet for at fejle.
  async fetchLive({ providerIds, token, fetchImpl = fetch }) {
    const out = new Map();
    for (let i = 0; i < providerIds.length; i += MAX_IDS_PER_CALL) {
      const chunk = providerIds.slice(i, i + MAX_IDS_PER_CALL);
      const endpoint = `${BASE}/fixtures/multi/${chunk.join(",")}`;
      const call = (include) => fetchImpl(`${endpoint}?include=${include}&api_token=${token}`);
      // periods giver spilleminuttet. Er den include ikke med i abonnementet,
      // svarer Sportmonks 4xx — så prøver vi igen uden, og viser kampen live
      // uden minuttal i stedet for at lade hele kørslen fejle.
      let r = await call("scores;state;periods");
      if (!r.ok && r.status >= 400 && r.status < 500) r = await call("scores;state");
      if (!r.ok) throw new Error(`Sportmonks (live): ${r.status} ${await r.text()}`);
      const data = await r.json();
      const rows = Array.isArray(data.data) ? data.data : data.data ? [data.data] : [];
      for (const fx of rows) out.set(String(fx.id), normalize(fx));
    }
    return out;
  },
};

// Eksporteret til test — mappingen er det, der ikke må flytte sig ved en oprydning.
export const __test = { normalize, statusOf, currentScore, liveMinute };
