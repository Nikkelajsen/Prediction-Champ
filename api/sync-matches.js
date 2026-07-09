// Server-side funktion (kører på Vercel, ikke i browseren).
// Henter kampe + resultater for Superligaen fra Sportmonks,
// og skriver dem ind i Supabase.
//
// Miljøvariabler der skal være sat i Vercel:
//   SPORTMONKS_TOKEN
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

const SPORTMONKS_SUPERLIGA_ID = 271;

export default async function handler(req, res) {
  try {
    const SPORTMONKS_TOKEN = process.env.SPORTMONKS_TOKEN;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SPORTMONKS_TOKEN || !SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ error: "Miljøvariabler mangler i Vercel-projektet (SPORTMONKS_TOKEN, SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY)" });
    }

    async function sb(path, opts = {}) {
      const headers = {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        ...(opts.prefer ? { Prefer: opts.prefer } : {}),
      };
      const r = await fetch(`${SUPABASE_URL}${path}`, { method: opts.method, headers, body: opts.body });
      if (!r.ok) throw new Error(`Supabase ${path}: ${r.status} ${await r.text()}`);
      if (r.status === 204) return null;
      const t = await r.text();
      return t ? JSON.parse(t) : null;
    }

    // find Superligaen + aktiv sæson + hold i vores egen database
    const leagues = await sb(`/rest/v1/leagues?name=eq.Superligaen&select=id`);
    if (!leagues.length) throw new Error("Superligaen ikke fundet i databasen — kør seed-superligaen.sql først");
    const leagueId = leagues[0].id;

    const seasons = await sb(`/rest/v1/seasons?league_id=eq.${leagueId}&select=id&limit=1`);
    if (!seasons.length) throw new Error("Sæson ikke fundet i databasen");
    const seasonId = seasons[0].id;

    const teams = await sb(`/rest/v1/teams?league_id=eq.${leagueId}&select=id,name`);

    function normalize(s) {
      return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
    }
    function matchTeam(sportmonksName) {
      const n = normalize(sportmonksName);
      return teams.find((t) => normalize(t.name) === n)
        || teams.find((t) => normalize(t.name).includes(n) || n.includes(normalize(t.name)));
    }

    // hent kampe fra Sportmonks i et rullende vindue (60 dage bagud, 200 dage frem).
    // Sportmonks tillader max 100 dage pr. kald, så vi deler op i bidder,
    // og gennemgår ALLE sider inden for hver bid (standard er 25 pr. side).
    function addDays(iso, days) {
      const d = new Date(iso + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    }
    const overallStart = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const overallEnd = new Date(Date.now() + 200 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const chunks = [];
    let cursor = overallStart;
    while (cursor < overallEnd) {
      const chunkEnd = addDays(cursor, 90) > overallEnd ? overallEnd : addDays(cursor, 90);
      chunks.push([cursor, chunkEnd]);
      cursor = addDays(chunkEnd, 1);
    }

    const fixturesById = new Map();
    for (const [start, end] of chunks) {
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const smUrl = `https://api.sportmonks.com/v3/football/fixtures/between/${start}/${end}` +
          `?filters=fixtureLeagues:${SPORTMONKS_SUPERLIGA_ID}&include=participants;scores&per_page=50&page=${page}&api_token=${SPORTMONKS_TOKEN}`;
        const smRes = await fetch(smUrl);
        if (!smRes.ok) throw new Error(`Sportmonks: ${smRes.status} ${await smRes.text()}`);
        const smData = await smRes.json();
        for (const fx of smData.data || []) fixturesById.set(fx.id, fx);
        hasMore = !!smData.pagination?.has_more;
        page++;
        if (page > 20) break; // sikkerhedsnet
      }
    }
    const fixtures = [...fixturesById.values()];

    let toUpsert = [];
    const unmatched = new Set();

    for (const fx of fixtures) {
      const home = fx.participants?.find((p) => p.meta?.location === "home");
      const away = fx.participants?.find((p) => p.meta?.location === "away");
      if (!home || !away) continue;

      const homeTeam = matchTeam(home.name);
      const awayTeam = matchTeam(away.name);
      if (!homeTeam || !awayTeam) {
        unmatched.add(`${home.name} vs ${away.name}`);
        continue;
      }

      const ftScores = (fx.scores || []).filter((s) => s.description === "FT");
      const hs = ftScores.find((s) => s.score?.participant === "home")?.score?.goals ?? null;
      const as = ftScores.find((s) => s.score?.participant === "away")?.score?.goals ?? null;

      toUpsert.push({
        season_id: seasonId,
        home_team_id: homeTeam.id,
        away_team_id: awayTeam.id,
        kickoff_at: fx.starting_at,
        home_score: hs,
        away_score: as,
        status: hs !== null ? "finished" : "scheduled",
        api_fixture_id: String(fx.id),
      });
    }

    if (toUpsert.length) {
      await sb(`/rest/v1/matches?on_conflict=api_fixture_id`, {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: JSON.stringify(toUpsert),
      });
    }

    res.status(200).json({ synced: toUpsert.length, totalFixtures: fixtures.length, unmatched: [...unmatched] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
