// Server-side funktion (kører på Vercel, ikke i browseren).
// LIVE-resultater: henter nuværende stilling for de kampe, der spilles lige nu,
// og skriver dem i matches' live_*-kolonner. Tænkt til at køre hvert minut.
//
// Kald med: /api/sync-live            (ingen parametre — dækker ALLE ligaer på én gang)
// Test uden at skrive noget: /api/sync-live?dryRun=true
//
// Forskellen på api/sync-matches.js (hvert 10.-15. minut, ét job pr. liga):
//   sync-matches  = hele sæsonens kampprogram + ENDELIGE resultater (mange API-kald)
//   sync-live     = kun kampe i det aktuelle tidsvindue (ét API-kald, ofte nul)
//
// PRINCIP: live-scoren skrives i live_home_score/live_away_score og rører ALDRIG
// home_score/away_score, før kampen faktisk er slut. Hele appen bruger
// "home_score is not null" som "kampen er spillet" — point, stillinger, rating og
// Story Engine må derfor først bevæge sig ved FT. Se sql/live_scores.sql.
//
// Til gengæld FÆRDIGMELDER denne funktion også kampe: så snart Sportmonks melder
// FT/AET/FT_PEN, skrives det endelige resultat med det samme (i stedet for at vente
// på næste sync-matches-kørsel), så stillinger og rating opdaterer inden for et minut
// efter slutfløjt.
//
// Miljøvariabler (samme som sync-matches):
//   SPORTMONKS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SYNC_SECRET

// Hvor langt tilbage/frem vi leder efter kampe, der kan være i gang.
// 6 timer bagud dækker rigeligt en kamp med forlænget spilletid og forsinkelser.
const WINDOW_BACK_MS = 6 * 60 * 60 * 1000;
const WINDOW_AHEAD_MS = 15 * 60 * 1000;
const MAX_IDS_PER_CALL = 40;

// Samme afslutnings-states som api/sync-matches.js.
const FINISHED_STATES = ["FT", "AET", "FT_PEN"];
// Sportmonks-states hvor kampen er i gang (inkl. pauser undervejs).
const LIVE_STATES = new Set([
  "INPLAY_1ST_HALF", "INPLAY_2ND_HALF", "HT", "BREAK",
  "INPLAY_ET", "INPLAY_ET_2ND_HALF", "EXTRA_TIME_BREAK",
  "PEN_BREAK", "INPLAY_PENALTIES", "PENALTIES",
]);

// Sportmonks returnerer state-navnet i flere felter afhængigt af endpoint/plan.
function stateNames(fx) {
  return [fx.state?.developer_name, fx.state?.state, fx.state?.short_name].filter(Boolean);
}
function isFinished(fx) {
  return stateNames(fx).some((n) => FINISHED_STATES.includes(n));
}
function isLive(fx) {
  return stateNames(fx).some((n) => LIVE_STATES.has(n) || /INPLAY/i.test(n));
}
// Nuværende stilling. Under en kamp opdaterer Sportmonks "CURRENT"-scoren løbende,
// så samme udtræk virker både live og ved slutfløjt.
function currentScore(fx) {
  const cur = (fx.scores || []).filter((s) => s.description === "CURRENT");
  const hs = cur.find((s) => s.score?.participant === "home")?.score?.goals ?? null;
  const as = cur.find((s) => s.score?.participant === "away")?.score?.goals ?? null;
  return { hs, as };
}
// Spilleminut fra den periode, der tikker. Null i pauser (og hvis include=periods
// ikke er med i abonnementet) — så viser UI'et bare "LIVE" uden minuttal.
function liveMinute(fx) {
  const p = (fx.periods || []).find((x) => x.ticking);
  return Number.isFinite(p?.minutes) ? p.minutes : null;
}

export default async function handler(req, res) {
  try {
    const SPORTMONKS_TOKEN = process.env.SPORTMONKS_TOKEN;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SYNC_SECRET = process.env.SYNC_SECRET;

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

    // ---- autorisation: samme regler som sync-matches (header foretrukket) ----
    async function isAuthorized() {
      const providedSecret = req.headers["x-sync-secret"] || req.query.secret;
      if (SYNC_SECRET && providedSecret === SYNC_SECRET) return true;
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const userToken = authHeader.slice(7);
        try {
          const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${userToken}` },
          });
          if (!userRes.ok) return false;
          const user = await userRes.json();
          const profs = await sb(`/rest/v1/profiles?id=eq.${user.id}&select=is_admin`);
          return !!profs[0]?.is_admin;
        } catch { return false; }
      }
      return false;
    }
    if (!(await isAuthorized())) {
      return res.status(401).json({ error: "Ikke autoriseret" });
    }

    const dryRun = req.query.dryRun === "true";

    // ---- 1) hvilke kampe kan være i gang lige nu? ----
    // (a) kampe uden endeligt resultat, hvis kickoff ligger i tidsvinduet, ELLER
    // (b) kampe der stadig står markeret som live (skal ryddes/færdigmeldes,
    //     også hvis de er faldet ud af vinduet).
    const now = Date.now();
    const from = new Date(now - WINDOW_BACK_MS).toISOString();
    const to = new Date(now + WINDOW_AHEAD_MS).toISOString();
    const cols = "id,api_fixture_id,season_id,home_team_id,away_team_id,kickoff_at,status,home_score,away_score,live_home_score,live_away_score,live_state,live_minute";
    // To simple opslag frem for ét or=(and(...))-udtryk: tidsstempler i en PostgREST-
    // logiktræ-værdi kræver citering, og det er ikke besværet værd for et opslag,
    // der næsten altid returnerer nul rækker i (b).
    const [inWindow, stillLive] = await Promise.all([
      sb(`/rest/v1/matches?select=${cols}&home_score=is.null&kickoff_at=gte.${from}&kickoff_at=lte.${to}`),
      sb(`/rest/v1/matches?select=${cols}&live_state=not.is.null`),
    ]);
    const byId = new Map();
    for (const m of [...(inWindow || []), ...(stillLive || [])]) byId.set(m.id, m);

    const withFixture = [...byId.values()].filter((m) => m.api_fixture_id);
    if (!withFixture.length) {
      // Ingen kampe i vinduet — spar API-kaldet helt (det er langt de fleste minutter i døgnet).
      return res.status(200).json({ checked: 0, live: 0, finished: 0, cleared: 0, note: "Ingen kampe i tidsvinduet" });
    }

    // ---- 2) hent netop de kampe hos Sportmonks (ét kald pr. 40 kampe) ----
    const fixtureById = new Map();
    const ids = withFixture.map((m) => String(m.api_fixture_id));
    for (let i = 0; i < ids.length; i += MAX_IDS_PER_CALL) {
      const chunk = ids.slice(i, i + MAX_IDS_PER_CALL);
      const endpoint = `https://api.sportmonks.com/v3/football/fixtures/multi/${chunk.join(",")}`;
      const call = (include) => fetch(`${endpoint}?include=${include}&api_token=${SPORTMONKS_TOKEN}`);
      // periods giver spilleminuttet. Er den include ikke med i abonnementet, svarer
      // Sportmonks 4xx — så prøver vi igen uden, og viser kampen live uden minuttal
      // i stedet for at lade hele kørslen fejle.
      let r = await call("scores;state;periods");
      if (!r.ok && r.status >= 400 && r.status < 500) r = await call("scores;state");
      if (!r.ok) throw new Error(`Sportmonks (live): ${r.status} ${await r.text()}`);
      const data = await r.json();
      const rows = Array.isArray(data.data) ? data.data : (data.data ? [data.data] : []);
      for (const fx of rows) fixtureById.set(String(fx.id), fx);
    }

    // ---- 3) beslut hvad der skal skrives ----
    const updates = [];
    let liveCount = 0, finishedCount = 0, clearedCount = 0;
    const preview = [];

    for (const m of withFixture) {
      const fx = fixtureById.get(String(m.api_fixture_id));
      const base = {
        api_fixture_id: m.api_fixture_id,
        season_id: m.season_id,
        home_team_id: m.home_team_id,
        away_team_id: m.away_team_id,
        kickoff_at: m.kickoff_at,
      };
      const clearLive = { live_home_score: null, live_away_score: null, live_state: null, live_minute: null, live_updated_at: null };

      // Kampen kunne ikke hentes (fx uden for abonnementet) — ryd en evt. hængende live-markering.
      if (!fx) {
        if (m.live_state != null) {
          updates.push({ ...base, status: m.status, home_score: m.home_score, away_score: m.away_score, ...clearLive });
          clearedCount++;
        }
        continue;
      }

      const { hs, as } = currentScore(fx);

      if (isFinished(fx)) {
        // Slutfløjt: skriv det ENDELIGE resultat med det samme. Det er her — og kun her —
        // point, stillinger og rating bevæger sig (DB-triggeren fanger score-ændringen).
        // Melder Sportmonks FT uden en CURRENT-score (datafejl), skriver vi IKKE et tomt
        // resultat — vi rydder blot live-markeringen og prøver igen næste kørsel.
        if (hs == null || as == null) {
          if (m.live_state != null) {
            updates.push({ ...base, status: m.status, home_score: m.home_score, away_score: m.away_score, ...clearLive });
            clearedCount++;
          }
          continue;
        }
        if (m.home_score === hs && m.away_score === as && m.live_state == null) continue;
        updates.push({ ...base, status: "finished", home_score: hs, away_score: as, ...clearLive });
        finishedCount++;
        preview.push({ fixture: m.api_fixture_id, action: "finished", score: `${hs}-${as}` });
        continue;
      }

      if (isLive(fx)) {
        const state = fx.state?.developer_name || fx.state?.state || fx.state?.short_name || "INPLAY";
        const minute = liveMinute(fx);
        // Skriv kun ved reel ændring, så vi ikke banker på databasen hvert minut uden grund.
        const unchanged = m.live_home_score === hs && m.live_away_score === as
          && m.live_state === state && m.live_minute === minute;
        if (unchanged) { liveCount++; continue; }
        updates.push({
          // home_score/away_score skrives med de eksisterende værdier (normalt null) — live
          // må aldrig kunne overskrive et endeligt resultat, der allerede står i databasen.
          ...base, status: m.status, home_score: m.home_score, away_score: m.away_score,
          live_home_score: hs, live_away_score: as, live_state: state, live_minute: minute,
          live_updated_at: new Date().toISOString(),
        });
        liveCount++;
        preview.push({ fixture: m.api_fixture_id, action: "live", score: `${hs}-${as}`, state, minute });
        continue;
      }

      // Hverken i gang eller færdig (ikke startet, udsat, aflyst …) — ryd live-felterne.
      if (m.live_state != null) {
        updates.push({ ...base, status: m.status, home_score: m.home_score, away_score: m.away_score, ...clearLive });
        clearedCount++;
        preview.push({ fixture: m.api_fixture_id, action: "cleared", state: stateNames(fx)[0] || null });
      }
    }

    if (dryRun) {
      return res.status(200).json({
        dryRun: true,
        note: "Intet er skrevet til databasen — dette er kun en forhåndsvisning.",
        checked: withFixture.length, live: liveCount, finished: finishedCount, cleared: clearedCount,
        preview,
      });
    }

    // ---- 4) ét samlet skriv ----
    // Alle ændringer i én upsert-sætning: statement-triggeren på matches kører dermed
    // netop én gang, og genberegner kun ratings hvis mindst ét ENDELIGT resultat ændrede sig.
    if (updates.length) {
      await sb(`/rest/v1/matches?on_conflict=api_fixture_id`, {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: JSON.stringify(updates),
      });
    }

    res.status(200).json({
      checked: withFixture.length,
      live: liveCount,
      finished: finishedCount,
      cleared: clearedCount,
      written: updates.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
