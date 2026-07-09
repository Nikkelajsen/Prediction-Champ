// Server-side funktion (kører på Vercel, ikke i browseren).
// Henter kampe + resultater for den angivne liga fra Sportmonks,
// og skriver dem ind i Supabase.
//
// Kald med: /api/sync-matches?leagueId=<vores egen liga-uuid>&smSeason=2026/2027
//
// Miljøvariabler der skal være sat i Vercel:
//   SPORTMONKS_TOKEN
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  try {
    const SPORTMONKS_TOKEN = process.env.SPORTMONKS_TOKEN;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SPORTMONKS_TOKEN || !SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ error: "Miljøvariabler mangler i Vercel-projektet (SPORTMONKS_TOKEN, SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY)" });
    }

    const leagueId = req.query.leagueId;
    const smSeasonName = req.query.smSeason || "2026/2027";
    if (!leagueId) return res.status(400).json({ error: "Mangler leagueId query-parameter" });

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

    // find ligaen i vores egen database (giver os navn + Sportmonks-liga-id)
    const leagueRows = await sb(`/rest/v1/leagues?id=eq.${leagueId}&select=id,name,api_league_id`);
    if (!leagueRows.length) throw new Error("Ligaen findes ikke i databasen");
    const dbLeague = leagueRows[0];
    if (!dbLeague.api_league_id) throw new Error(`Ligaen '${dbLeague.name}' har intet Sportmonks-liga-id (api_league_id) sat`);
    const SPORTMONKS_LEAGUE_ID = dbLeague.api_league_id;

    const seasons = await sb(`/rest/v1/seasons?league_id=eq.${leagueId}&select=id&limit=1`);
    if (!seasons.length) throw new Error("Sæson ikke fundet i databasen for denne liga");
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

    // Find Sportmonks' egen sæson-id for den ønskede sæson (fx "2026/2027"),
    // i stedet for at stole på "currentSeason", som kan være usikker omkring sæsonskiftet.
    const leagueRes = await fetch(
      `https://api.sportmonks.com/v3/football/leagues/${SPORTMONKS_LEAGUE_ID}?include=seasons&api_token=${SPORTMONKS_TOKEN}`
    );
    if (!leagueRes.ok) throw new Error(`Sportmonks (liga): ${leagueRes.status} ${await leagueRes.text()}`);
    const leagueData = await leagueRes.json();
    const smSeason = (leagueData.data?.seasons || []).find((s) => s.name === smSeasonName);
    if (!smSeason) throw new Error(`Kunne ikke finde sæsonen '${smSeasonName}' hos Sportmonks for ${dbLeague.name}`);
    const smSeasonId = smSeason.id;

    const fixturesById = new Map();
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const smUrl = `https://api.sportmonks.com/v3/football/fixtures` +
        `?filters=fixtureSeasons:${smSeasonId}&include=participants;scores&per_page=50&page=${page}&api_token=${SPORTMONKS_TOKEN}`;
      const smRes = await fetch(smUrl);
      if (!smRes.ok) throw new Error(`Sportmonks (kampe): ${smRes.status} ${await smRes.text()}`);
      const smData = await smRes.json();
      for (const fx of smData.data || []) fixturesById.set(fx.id, fx);
      hasMore = !!smData.pagination?.has_more;
      page++;
      if (page > 20) break; // sikkerhedsnet
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
      let hs = ftScores.find((s) => s.score?.participant === "home")?.score?.goals ?? null;
      let as = ftScores.find((s) => s.score?.participant === "away")?.score?.goals ?? null;

      // fallback: hvis der ikke er en "FT"-score, men kampen startede for mere end
      // 3 timer siden, brug den seneste ("CURRENT") score i stedet
      if (hs === null && fx.starting_at && new Date(fx.starting_at).getTime() < Date.now() - 3 * 3600 * 1000) {
        const curScores = (fx.scores || []).filter((s) => s.description === "CURRENT");
        hs = curScores.find((s) => s.score?.participant === "home")?.score?.goals ?? null;
        as = curScores.find((s) => s.score?.participant === "away")?.score?.goals ?? null;
      }

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
