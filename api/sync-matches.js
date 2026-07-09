// Server-side funktion (kører på Vercel, ikke i browseren).
// Henter kampe + resultater for den angivne liga fra Sportmonks,
// og skriver dem ind i Supabase.
//
// Kald med: /api/sync-matches?leagueId=<vores egen liga-uuid>&smSeason=2026/2027
// Test-tilstand (skriver intet): tilføj &dryRun=true
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
    const dryRun = req.query.dryRun === "true";
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

    const teams = await sb(`/rest/v1/teams?league_id=eq.${leagueId}&select=id,name,api_team_id`);

    function normalize(s) {
      return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
    }
    function findByName(sportmonksName) {
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
    if (!smSeason) {
      const available = (leagueData.data?.seasons || []).map((s) => s.name).join(", ") || "(ingen sæsoner fundet)";
      throw new Error(`Kunne ikke finde sæsonen '${smSeasonName}' hos Sportmonks for ${dbLeague.name}. Tilgængelige sæsoner: ${available}`);
    }
    const smSeasonId = smSeason.id;

    const fixturesById = new Map();
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const smUrl = `https://api.sportmonks.com/v3/football/fixtures` +
        `?filters=fixtureSeasons:${smSeasonId}&include=participants;scores;state&per_page=50&page=${page}&api_token=${SPORTMONKS_TOKEN}`;
      const smRes = await fetch(smUrl);
      if (!smRes.ok) throw new Error(`Sportmonks (kampe): ${smRes.status} ${await smRes.text()}`);
      const smData = await smRes.json();
      for (const fx of smData.data || []) fixturesById.set(fx.id, fx);
      hasMore = !!smData.pagination?.has_more;
      page++;
      if (page > 20) break; // sikkerhedsnet
    }
    const fixtures = [...fixturesById.values()];

    const FINISHED_STATES = ["FT", "AET", "FT_PEN"];
    function extractScore(fx) {
      const isFinished = FINISHED_STATES.includes(fx.state?.short_name);
      if (!isFinished) return { hs: null, as: null, finished: false };
      const curScores = (fx.scores || []).filter((s) => s.description === "CURRENT");
      const hs = curScores.find((s) => s.score?.participant === "home")?.score?.goals ?? null;
      const as = curScores.find((s) => s.score?.participant === "away")?.score?.goals ?? null;
      return { hs, as, finished: true };
    }

    if (dryRun) {
      const sample = fixtures.slice(0, 15).map((fx) => {
        const home = fx.participants?.find((p) => p.meta?.location === "home");
        const away = fx.participants?.find((p) => p.meta?.location === "away");
        const { hs, as } = extractScore(fx);
        return {
          kickoff: fx.starting_at,
          state: fx.state?.short_name,
          home: home?.name,
          away: away?.name,
          home_score: hs,
          away_score: as,
        };
      });
      return res.status(200).json({
        dryRun: true,
        note: "Intet er skrevet til databasen — dette er kun en forhåndsvisning.",
        totalFixtures: fixtures.length,
        sample,
      });
    }

    // ---- auto-opdag og opret hold ud fra kampenes deltagere ----
    const smTeamsById = new Map();
    for (const fx of fixtures) {
      for (const p of fx.participants || []) {
        if (p?.id && p?.name) smTeamsById.set(p.id, p.name);
      }
    }

    const newTeams = [];
    const linkUpdates = [];
    const smIdToOurId = new Map();

    for (const [smId, smName] of smTeamsById) {
      const byApiId = teams.find((t) => t.api_team_id === String(smId));
      if (byApiId) { smIdToOurId.set(smId, byApiId.id); continue; }

      const byName = findByName(smName);
      if (byName) {
        smIdToOurId.set(smId, byName.id);
        if (byName.api_team_id !== String(smId)) linkUpdates.push({ id: byName.id, api_team_id: String(smId) });
        continue;
      }

      newTeams.push({ league_id: leagueId, name: smName, api_team_id: String(smId) });
    }

    if (newTeams.length) {
      const inserted = await sb(`/rest/v1/teams`, {
        method: "POST", prefer: "return=representation", body: JSON.stringify(newTeams),
      });
      for (const row of inserted) smIdToOurId.set(Number(row.api_team_id), row.id);
    }
    for (const upd of linkUpdates) {
      await sb(`/rest/v1/teams?id=eq.${upd.id}`, {
        method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ api_team_id: upd.api_team_id }),
      });
    }

    let toUpsert = [];
    const unmatched = new Set();

    for (const fx of fixtures) {
      const home = fx.participants?.find((p) => p.meta?.location === "home");
      const away = fx.participants?.find((p) => p.meta?.location === "away");
      if (!home || !away) continue;

      const homeTeamId = smIdToOurId.get(home.id);
      const awayTeamId = smIdToOurId.get(away.id);
      if (!homeTeamId || !awayTeamId) {
        unmatched.add(`${home.name} vs ${away.name}`);
        continue;
      }

      const { hs, as, finished } = extractScore(fx);

      toUpsert.push({
        season_id: seasonId,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        kickoff_at: fx.starting_at,
        home_score: hs,
        away_score: as,
        status: finished ? "finished" : "scheduled",
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

    res.status(200).json({
      synced: toUpsert.length,
      totalFixtures: fixtures.length,
      teamsCreated: newTeams.length,
      unmatched: [...unmatched],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
