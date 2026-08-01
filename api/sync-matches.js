// Server-side funktion (kører på Vercel, ikke i browseren).
// Henter kampe + resultater for den angivne liga fra ligaens datakilde,
// og skriver dem ind i Supabase.
//
// Kald med: /api/sync-matches?leagueId=<vores egen liga-uuid>&smSeason=2026/2027
//
// DATAKILDEN ER LIGAENS, IKKE KODENS. leagues.provider afgør, hvem der spørges
// (se api/providers/index.js). Superligaen og Scotland Premiership kommer fra
// Sportmonks; Premier League, Champions League, Bundesliga, Serie A og Primera
// División fra football-data.org. Alt nedenfor — holdmatchning, upsert,
// job-logning — er fælles og kender ingen leverandørs feltnavne.
//
// Miljøvariabler der skal være sat i Vercel:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SYNC_SECRET
//   SPORTMONKS_TOKEN      (kræves kun af sportmonks-ligaer)
//   FOOTBALLDATA_TOKEN    (kræves kun af footballdata-ligaer)

import { createSb, isAuthorized, createRunLogger, failJob } from "./_shared.js";
import { getProvider, providerToken } from "./providers/index.js";
import { backfillCompetitionMatches } from "./backfill.js";

// Er en fejlet sæsonhentning en fejlet KØRSEL?
//
// Næsten altid ja. Det ene undtagelsestilfælde er, at leverandøren endnu ikke
// har oprettet sæsonen: Champions League' ligafase lodtrækkes i slutningen af
// august, så `?season=2026` svarer 404 ved hver eneste kørsel indtil da. Et job,
// der står rødt i seks uger for noget forventeligt, er værre end intet job — det
// lærer én at holde op med at kigge, og så er den NÆSTE røde række også usynlig.
// Den kørsel tælles derfor som gennemført med nul kampe, med forklaringen i
// detaljen.
//
// Kun `season-not-published` slipper igennem. `season-unknown` — et forkert
// api_season_id — skal blive ved med at være rød, fordi den ikke retter sig
// selv, og det samme gælder alt, diagnosen ikke kunne afgøre. Præcis den
// skelnen er hele grunden til, at diagnosen findes.
//
// Ren funktion og eksporteret, fordi reglen er værd at fastholde i en test:
// handleren selv kræver en database og et request-objekt.
export function seasonFetchVerdict(fetchError, emptySeason) {
  if (emptySeason?.code === "season-not-published") return { tolerated: true };
  const why = emptySeason?.message ? ` — ${emptySeason.message}` : "";
  return { tolerated: false, message: `${fetchError?.message ?? String(fetchError)}${why}` };
}

export default async function handler(req, res) {
  // Sættes så snart autorisationen er i hus. Ligger uden for try'et, fordi
  // catch'en skal kunne bruge den — en kørsel, der vælter, er netop den, der
  // skal ende i job_runs.
  let run = null;
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SYNC_SECRET = process.env.SYNC_SECRET;

    // Bemærk hvad der IKKE tjekkes her længere: API-nøglen. Med to leverandører
    // ville et krav om SPORTMONKS_TOKEN blokere en football-data-liga, der
    // aldrig bruger den. Nøglen hentes af providerToken() først, når vi ved
    // hvilken datakilde ligaen har — og fejler lige så tydeligt dér.
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ error: "Miljøvariabler mangler i Vercel-projektet (SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY)" });
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
    const seasonNameOverride = req.query.smSeason || null;
    const dryRun = req.query.dryRun === "true";
    run = createRunLogger(sb, "sync-matches", { skip: dryRun });
    // Et job uden leagueId er et forkert opsat cron-job, ikke en tilfældig fejl —
    // derfor tælles det som en fejlet kørsel, så det dukker op i fejlserien.
    if (!leagueId) return run.fail(res, 400, { error: "Mangler leagueId query-parameter" }, "Mangler leagueId query-parameter");

    // find ligaen i vores egen database (giver os navn, datakilde + dens liga-id)
    //
    // `select=*` og ikke en kolonneliste med `provider`: koden deployes
    // automatisk ved push, mens sql/multi_provider.sql køres manuelt bagefter.
    // En navngiven kolonne, der endnu ikke findes, får PostgREST til at svare
    // 400 — altså ville syncen være nede i vinduet mellem deploy og migrering.
    // Med `*` mangler feltet bare, og getProvider(undefined) falder tilbage til
    // sportmonks, hvilket er præcis den verden, migreringen endnu ikke har
    // ændret. Tabellen har én række pr. turnering, så bredden koster intet.
    const leagueRows = await sb(`/rest/v1/leagues?id=eq.${leagueId}&select=*`);
    if (!leagueRows.length) throw new Error("Ligaen findes ikke i databasen");
    const dbLeague = leagueRows[0];
    const provider = getProvider(dbLeague.provider);
    if (!dbLeague.api_league_id) throw new Error(`Ligaen '${dbLeague.name}' har intet liga-id (api_league_id) sat hos ${provider.label}`);
    const token = providerToken(provider);
    const apiLeagueId = dbLeague.api_league_id;

    const seasons = await sb(`/rest/v1/seasons?league_id=eq.${leagueId}&select=id,name,api_season_id&order=start_date.desc&limit=1`);
    if (!seasons.length) throw new Error("Sæson ikke fundet i databasen for denne liga");
    const seasonId = seasons[0].id;

    const teams = await sb(`/rest/v1/teams?league_id=eq.${leagueId}&select=id,name,api_team_id`);

    function normalize(s) {
      return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
    }
    function findByName(providerName) {
      const n = normalize(providerName);
      return teams.find((t) => normalize(t.name) === n)
        || teams.find((t) => normalize(t.name).includes(n) || n.includes(normalize(t.name)));
    }

    // Leverandørens sæson-id: brug det gemte, hvis vi har det — ellers slå det
    // op ud fra sæsonnavnet (fx "2026/2027") og gem det på vores season-række,
    // så fremtidige kørsler (og sæsonskift) ikke afhænger af navne-opslag.
    let apiSeasonId = seasons[0].api_season_id;
    if (!apiSeasonId) {
      const seasonName = seasonNameOverride;
      if (!seasonName) {
        throw new Error(
          `Ligaen '${dbLeague.name}' har intet gemt api_season_id, og der er ikke angivet &smSeason=. ` +
          `Kald med fx &smSeason=2026/2027 én gang — id'et gemmes derefter på sæson-rækken.`
        );
      }
      apiSeasonId = await provider.resolveSeasonId({ apiLeagueId, seasonName, token });
      await sb(`/rest/v1/seasons?id=eq.${seasonId}`, {
        method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ api_season_id: String(apiSeasonId) }),
      });
    }

    // Sæsonopslaget er tvetydigt på TO måder, og begge betyder det samme for
    // den, der kigger: turneringen henter ingen kampe, og man kan ikke se, om
    // det er en fejl. Enten er kampprogrammet ikke offentliggjort endnu, eller
    // også peger api_season_id et sted hen, leverandøren ikke kender — kun den
    // ene retter sig selv. Det var dét, der efterlod `B8` uafgjort.
    //
    // De to udgange ser forskellige ud i HTTP og er lige uigennemsigtige:
    //   · 200 med tom liste → `totalFixtures: 0`, som ikke siger hvorfor
    //   · 404               → "The resource you are looking for does not exist",
    //                         som heller ikke siger hvorfor
    // Første udgave af diagnosen dækkede kun den første — og det var den anden,
    // Champions League faktisk gav. Derfor spørges datakilden i BEGGE tilfælde.
    let fixtures = null;
    let fetchError = null;
    try {
      fixtures = await provider.fetchSeasonFixtures({ apiLeagueId, apiSeasonId, token });
    } catch (e) {
      fetchError = e;
    }

    // Diagnosen må ALDRIG kunne vælte en kørsel, der ellers gik godt: en tom
    // sæson er i sig selv en gyldig kørsel, og et ekstra opslag, der fejler
    // (429, nedetid), skal ikke gøre den til en fejl. Derfor fanges alt og
    // gemmes som tekst.
    let emptySeason = null;
    if ((fetchError || !fixtures.length) && provider.describeEmptySeason) {
      try {
        emptySeason = await provider.describeEmptySeason({ apiLeagueId, apiSeasonId, token });
      } catch (e) {
        emptySeason = { code: "lookup-failed", message: e?.message ?? String(e) };
      }
    }

    if (fetchError) {
      const verdict = seasonFetchVerdict(fetchError, emptySeason);
      if (!verdict.tolerated) throw new Error(verdict.message, { cause: fetchError });
      fixtures = [];
    }

    if (dryRun) {
      const sample = fixtures.slice(0, 15).map((fx) => ({
        kickoff: fx.kickoffAt,
        state: fx.liveState,
        stage: fx.stageName,
        home: fx.home?.name ?? null,
        away: fx.away?.name ?? null,
        // Samme regel som i det rigtige skriv: en stilling er først et resultat,
        // når kampen er slut. Ellers ville forhåndsvisningen vise noget andet,
        // end kørslen faktisk skriver.
        home_score: fx.status === "finished" ? fx.score.home : null,
        away_score: fx.status === "finished" ? fx.score.away : null,
      }));
      return res.status(200).json({
        dryRun: true,
        note: "Intet er skrevet til databasen — dette er kun en forhåndsvisning.",
        provider: provider.key,
        totalFixtures: fixtures.length,
        ...(emptySeason ? { emptySeason } : {}),
        sample,
      });
    }

    // ---- auto-opdag og opret hold ud fra kampenes deltagere ----
    // Nøglen er holdets GLOBALE id (leverandørpræfikset), fordi det er den
    // værdi, der står i teams.api_team_id.
    const providerTeams = new Map();
    for (const fx of fixtures) {
      for (const t of [fx.home, fx.away]) {
        if (t) providerTeams.set(t.globalId, t.name);
      }
    }

    const newTeams = [];
    const linkUpdates = [];
    const globalIdToOurId = new Map();

    for (const [globalId, name] of providerTeams) {
      const byApiId = teams.find((t) => t.api_team_id === globalId);
      if (byApiId) { globalIdToOurId.set(globalId, byApiId.id); continue; }

      const byName = findByName(name);
      if (byName) {
        globalIdToOurId.set(globalId, byName.id);
        if (byName.api_team_id !== globalId) linkUpdates.push({ id: byName.id, api_team_id: globalId });
        continue;
      }

      newTeams.push({ league_id: leagueId, name, api_team_id: globalId });
    }

    if (newTeams.length) {
      const inserted = await sb(`/rest/v1/teams`, {
        method: "POST", prefer: "return=representation", body: JSON.stringify(newTeams),
      });
      // Nøglen læses som TEKST tilbage. Stod før som Number(row.api_team_id),
      // hvilket kun virkede, fordi Sportmonks-id'er er tal — et præfikset
      // football-data-id ville være blevet til NaN, og hver eneste kamp i
      // turneringen ville have manglet sine hold.
      for (const row of inserted) globalIdToOurId.set(String(row.api_team_id), row.id);
    }
    for (const upd of linkUpdates) {
      await sb(`/rest/v1/teams?id=eq.${upd.id}`, {
        method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ api_team_id: upd.api_team_id }),
      });
    }

    let toUpsert = [];
    const unmatched = new Set();
    let undrawn = 0;

    for (const fx of fixtures) {
      // Kampe uden begge hold. Hos Sportmonks er det en datafejl; i Champions
      // League er det normalt — knockout-kampene findes i kampprogrammet, før
      // lodtrækningen er foretaget, og har da ingen hold endnu. De kommer med,
      // så snart de er trukket, ved næste kørsel.
      if (!fx.home || !fx.away) { undrawn++; continue; }

      const homeTeamId = globalIdToOurId.get(fx.home.globalId);
      const awayTeamId = globalIdToOurId.get(fx.away.globalId);
      if (!homeTeamId || !awayTeamId) {
        unmatched.add(`${fx.home.name} vs ${fx.away.name}`);
        continue;
      }

      const finished = fx.status === "finished";

      toUpsert.push({
        season_id: seasonId,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        kickoff_at: fx.kickoffAt,
        home_score: finished ? fx.score.home : null,
        away_score: finished ? fx.score.away : null,
        status: finished ? "finished" : "scheduled",
        stage_name: fx.stageName,
        api_fixture_id: fx.globalId,
      });
    }

    if (toUpsert.length) {
      await sb(`/rest/v1/matches?on_conflict=api_fixture_id`, {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: JSON.stringify(toUpsert),
      });
    }

    // Efterfyld eksisterende konkurrencer med de kampe, der er kommet til siden
    // de blev oprettet (A20). Skal ligge EFTER upserten — det er først dér, de
    // nye kampe har fået et id. Reglerne og hvorfor de er, som de er, står i
    // api/backfill.js; den kaster aldrig, så en fejl her kan ikke vælte en sync,
    // der ellers gik godt.
    const backfill = dryRun ? { added: 0, competitions: 0 } : await backfillCompetitionMatches(sb, seasonId);

    // run.ok og ikke res.json: en vellykket kørsel SKAL skrive sin række i
    // job_runs. Stod her tidligere som et bart res.status(200).json(), hvilket
    // betød, at kun fejlende kørsler blev logget — Admin → Drift kunne aldrig
    // vise en grøn sync-matches-kørsel, og job-heartbeat.yml ville melde
    // "INGEN KOERSLER" for jobbet, uanset hvor fint det kørte. Detaljerne
    // (synced/totalFixtures/teamsCreated/unmatched) er samtidig det, der gør en
    // tavs delvis fejl synlig: en kørsel kan svare 200 og have hentet 0 kampe.
    return run.ok(res, {
      provider: provider.key,
      synced: toUpsert.length,
      totalFixtures: fixtures.length,
      teamsCreated: newTeams.length,
      // Ikke en fejl, men skal kunne aflæses: står tallet stille hen over en
      // CL-lodtrækning, henter syncen ikke de nye kampe.
      undrawn,
      // Kun til stede, når sæsonen kom tom hjem — og så er det netop det felt,
      // der siger, om tomheden er ufarlig eller en fejlkonfiguration.
      ...(emptySeason ? { emptySeason } : {}),
      // A20: hvor mange kampe der blev føjet til eksisterende konkurrencer.
      // Hører i detail'en af samme grund som de øvrige tal — en efterfyldning,
      // der tavst holder op med at virke, ville ellers først vise sig som en
      // konkurrence, der manglede sit slutspil.
      backfilled: backfill.added,
      backfilledCompetitions: backfill.competitions,
      ...(backfill.error ? { backfillError: backfill.error } : {}),
      unmatched: [...unmatched],
    });
  } catch (e) {
    return failJob(run, res, e, "sync-matches");
  }
}
