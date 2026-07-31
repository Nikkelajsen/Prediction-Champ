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

import { createSb, isAuthorized, createRunLogger, failJob } from "./_shared.js";

export default async function handler(req, res) {
  // Sættes så snart autorisationen er i hus. Ligger uden for try'et, fordi
  // catch'en skal kunne bruge den — en kørsel, der vælter, er netop den, der
  // skal ende i job_runs.
  let run = null;
  try {
    const SPORTMONKS_TOKEN = process.env.SPORTMONKS_TOKEN;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SYNC_SECRET = process.env.SYNC_SECRET;

    if (!SPORTMONKS_TOKEN || !SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ error: "Miljøvariabler mangler i Vercel-projektet (SPORTMONKS_TOKEN, SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY)" });
    }

    const sb = createSb(SUPABASE_URL, SERVICE_KEY);

    // ---- autorisation: enten en admin-brugers login, eller den delte hemmelige nøgle (til ekstern cron) ----
    // Reglerne bor i api/_shared.js, så de er ens for alle tre job-endpoints.
    const auth = await isAuthorized(req, {
      sb,
      supabaseUrl: SUPABASE_URL,
      serviceKey: SERVICE_KEY,
      syncSecret: SYNC_SECRET,
    });
    if (!auth.ok) {
      return res.status(401).json({ error: "Ikke autoriseret" });
    }

    const leagueId = req.query.leagueId;
    // Ingen hårdkodet fallback. Tidligere stod her `|| "2026/2027"`, hvilket
    // betød, at et job uden &smSeason= tavst ledte efter en sæson, der måske
    // slet ikke var den rigtige for ligaen. Navnet bruges kun, når ligaen
    // endnu ikke har et gemt api_season_id — så fejler vi hellere tydeligt
    // dér end at gætte. (Flagget i docs/features/turnering-2.md §3.2.)
    const smSeasonName = req.query.smSeason || null;
    const dryRun = req.query.dryRun === "true";
    run = createRunLogger(sb, "sync-matches", { skip: dryRun });
    // Et job uden leagueId er et forkert opsat cron-job, ikke en tilfældig fejl —
    // derfor tælles det som en fejlet kørsel, så det dukker op i fejlserien.
    if (!leagueId) return run.fail(res, 400, { error: "Mangler leagueId query-parameter" }, "Mangler leagueId query-parameter");

    // find ligaen i vores egen database (giver os navn + Sportmonks-liga-id)
    const leagueRows = await sb(`/rest/v1/leagues?id=eq.${leagueId}&select=id,name,api_league_id`);
    if (!leagueRows.length) throw new Error("Ligaen findes ikke i databasen");
    const dbLeague = leagueRows[0];
    if (!dbLeague.api_league_id) throw new Error(`Ligaen '${dbLeague.name}' har intet Sportmonks-liga-id (api_league_id) sat`);
    const SPORTMONKS_LEAGUE_ID = dbLeague.api_league_id;

    const seasons = await sb(`/rest/v1/seasons?league_id=eq.${leagueId}&select=id,api_season_id&order=start_date.desc&limit=1`);
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

    // Sportmonks sæson-id: brug det gemte, hvis vi har det — ellers slå op
    // ved navn (fx "2026/2027") og gem det på vores season-række, så
    // fremtidige kørsler (og sæsonskift) ikke afhænger af navne-opslag.
    let smSeasonId = seasons[0].api_season_id;
    if (!smSeasonId) {
      if (!smSeasonName) {
        throw new Error(
          `Ligaen '${dbLeague.name}' har intet gemt api_season_id, og der er ikke angivet &smSeason=. ` +
          `Kald med fx &smSeason=2026/2027 én gang — id'et gemmes derefter på sæson-rækken.`
        );
      }
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
      smSeasonId = smSeason.id;
      await sb(`/rest/v1/seasons?id=eq.${seasonId}`, {
        method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ api_season_id: String(smSeasonId) }),
      });
    }

    const fixturesById = new Map();
    let page = 1;
    let hasMore = true;
    // Sikkerhedsnet mod en uendelig løkke, hvis Sportmonks bliver ved med at
    // sige has_more. 60 sider à 50 kampe = 3.000 kampe, altså rigeligt til en
    // hel sæson i enhver turnering, vi realistisk tilføjer.
    const MAX_PAGES = 60;
    while (hasMore) {
      const smUrl = `https://api.sportmonks.com/v3/football/fixtures` +
        `?filters=fixtureSeasons:${smSeasonId}&include=participants;scores;state;stage&per_page=50&page=${page}&api_token=${SPORTMONKS_TOKEN}`;
      const smRes = await fetch(smUrl);
      if (!smRes.ok) throw new Error(`Sportmonks (kampe): ${smRes.status} ${await smRes.text()}`);
      const smData = await smRes.json();
      for (const fx of smData.data || []) fixturesById.set(fx.id, fx);
      hasMore = !!smData.pagination?.has_more;
      page++;
      // FEJL frem for at bryde stille. Loftet var før 20 sider med et bart
      // `break`, så en stor turnering kunne blive trunkeret uden at nogen
      // opdagede det: svaret var 200, og de manglende kampe fandtes bare ikke.
      // En kørsel, der ikke nåede alle sider, har ikke gjort sit arbejde.
      if (page > MAX_PAGES && hasMore) {
        throw new Error(
          `Paginering afbrudt: Sportmonks har flere kampe efter side ${MAX_PAGES} for sæson ${smSeasonId}. ` +
          `Kampprogrammet ville blive ufuldstændigt. Hæv MAX_PAGES i api/sync-matches.js.`
        );
      }
      if (page > MAX_PAGES) break;
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
          stage: fx.stage?.name ?? null,
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
        stage_name: fx.stage?.name ?? null,
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

    // run.ok og ikke res.json: en vellykket kørsel SKAL skrive sin række i
    // job_runs. Stod her tidligere som et bart res.status(200).json(), hvilket
    // betød, at kun fejlende kørsler blev logget — Admin → Drift kunne aldrig
    // vise en grøn sync-matches-kørsel, og job-heartbeat.yml ville melde
    // "INGEN KOERSLER" for jobbet, uanset hvor fint det kørte. Detaljerne
    // (synced/totalFixtures/teamsCreated/unmatched) er samtidig det, der gør en
    // tavs delvis fejl synlig: en kørsel kan svare 200 og have hentet 0 kampe.
    return run.ok(res, {
      synced: toUpsert.length,
      totalFixtures: fixtures.length,
      teamsCreated: newTeams.length,
      unmatched: [...unmatched],
    });
  } catch (e) {
    return failJob(run, res, e, "sync-matches");
  }
}
