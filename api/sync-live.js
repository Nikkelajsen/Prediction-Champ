// Server-side funktion (kører på Vercel, ikke i browseren).
// LIVE-resultater: henter nuværende stilling for de kampe, der spilles lige nu,
// og skriver dem i matches' live_*-kolonner. Tænkt til at køre hvert minut.
//
// Kald med: /api/sync-live            (ingen parametre — dækker ALLE ligaer på én gang)
// Test uden at skrive noget: /api/sync-live?dryRun=true
//
// Forskellen på api/sync-matches.js (hver 12. time, ét job pr. liga):
//   sync-matches  = hele sæsonens kampprogram + ENDELIGE resultater (mange API-kald)
//   sync-live     = kun kampe i det aktuelle tidsvindue (ét API-kald, ofte nul)
//
// PRINCIP: live-scoren skrives i live_home_score/live_away_score og rører ALDRIG
// home_score/away_score, før kampen faktisk er slut. Hele appen bruger
// "home_score is not null" som "kampen er spillet" — point, stillinger, rating og
// Story Engine må derfor først bevæge sig ved FT. Se sql/live_scores.sql.
//
// Til gengæld FÆRDIGMELDER denne funktion også kampe: så snart datakilden melder
// slutfløjt, skrives det endelige resultat med det samme (i stedet for at vente på
// næste sync-matches-kørsel), så stillinger og rating opdaterer inden for et minut.
//
// FLERE DATAKILDER (fra 2026): kampene i vinduet grupperes efter deres ligas
// leverandør, og hver leverandør spørges for sig. To ting følger af det:
//
//   * leagues.live_enabled = false ⇒ live_*-felterne skrives ALDRIG for ligaen,
//     kun endelige resultater. Sådan står de fem football-data.org-turneringer
//     på gratis-planen, hvor stillingen er forsinket og et minuttal ikke findes.
//     Tegnes €12/md-planen med livescores, er opgraderingen én UPDATE — ikke en
//     kodeændring.
//   * Fejler ÉN leverandør, skrives de øvriges opdateringer alligevel, og
//     kørslen ender derefter som fejlet. En manglende football-data-nøgle må
//     ikke kunne stoppe Superligaens live-scores.
//
// Miljøvariabler:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SYNC_SECRET
//   SPORTMONKS_TOKEN      (kræves kun af sportmonks-ligaer)
//   FOOTBALLDATA_TOKEN    (kræves kun af footballdata-ligaer)

import { createSb, isAuthorized, createRunLogger, failJob } from "./_shared.js";
import { getProvider, providerToken, indexSeasons, DEFAULT_PROVIDER } from "./_providers/index.js";

// Hvor langt tilbage/frem vi leder efter kampe, der kan være i gang.
// 6 timer bagud dækker rigeligt en kamp med forlænget spilletid og forsinkelser.
const WINDOW_BACK_MS = 6 * 60 * 60 * 1000;
const WINDOW_AHEAD_MS = 15 * 60 * 1000;

// ---- efterfejningen: kampe, der aldrig fik deres resultat (G122) ----
//
// HVAD DER VAR GALT. Vinduet ovenfor er også en GRÆNSE: en kamp, hvis kickoff
// ligger mere end 6 timer tilbage og som stadig står uden endeligt resultat, er
// usynlig for dette job. Den ventede derfor på næste `sync-matches`-kørsel —
// hver 12. time — og i hele det vindue stod rating og stillinger forkerte.
//
// Backloggen foreslog to veje: køre `sync-matches` hyppigere, eller lade den
// genopfriske de seneste dages kampe. Den anden er allerede sand — begge
// providere henter HELE sæsonen, og `matchUpsertRow()` skriver score for alt,
// der er `finished`, ved hver eneste kørsel. Der var altså ingen manglende
// genopfriskning at bygge; der var kun en LATENS på op til 12 timer.
//
// Derfor ligger rettelsen her i stedet. Det er dette job, der kører hvert
// minut, og som allerede kender hele vejen fra kamp til leverandør — så
// bagstopperen koster hverken et nyt cron-job, en ny række i `docs/CRON.md`
// eller en hyppigere kadence hos leverandørerne.
//
// TRE VÆRN, fordi den naive udgave er dyr. Uden dem ville en kamp, der ALDRIG
// kan få et resultat — en udsat kamp, hvis `kickoff_at` endnu ikke er skrevet
// om, eller en kamp uden for abonnementet — udløse et leverandørkald hvert
// eneste minut, i døgnet rundt. Den tidlige retur nedenfor er hele jobbets
// forbrugsbegrænsning, og en bagstopper, der punkterer den, er dyrere end det
// hul, den lukker.
//
//   1. ÉT MINUT I TIMEN. Efterfejningen kører kun i `STALE_SWEEP_MINUTE`, så
//      den værst tænkelige pris er 24 ekstra kald i døgnet pr. leverandør frem
//      for 1.440. Latensen falder dermed fra op til 12 timer til op til én, og
//      det er den rigtige byttehandel: et tabt resultat er en fejl, der skal
//      rettes samme aften, ikke inden for et minut.
//   2. EN ØVRE ALDER. Ud over `STALE_MAX_AGE_MS` er en kamp uden resultat ikke
//      et tabt slutfløjt længere, men et datapunkt, et menneske skal se på.
//      `sync-matches` har da haft tre kørsler til at rette den.
//   3. ET LOFT PÅ ANTALLET. `STALE_MAX` holder Sportmonks-opslaget på ét kald
//      (grænsen dér er 40 id'er pr. kald), så én turnering med noget galt ikke
//      kan gøre efterfejningen til jobbets dyreste del.
//
// Minuttallet er ikke tilfældigt: 00, 05, 11, 15, 17, 23 og 29 er optaget af
// kampprogram-jobbene, og `docs/CRON.md` beder udtrykkeligt om, at et nyt
// football-data-kald ikke lægges oven i et af dem. 41 er ledigt.
const STALE_SWEEP_MINUTE = 41;
const STALE_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const STALE_MAX = 40;

// Skal DENNE kørsel feje efter, og i så fald hvilket tidsrum?
//
// Ren funktion og eksporteret af samme grund som `matchUpsertRow()` i
// sync-matches.js: handleren kan ikke nås uden et HTTP-mock-apparat, så en
// regel, der kun findes inde i den, er en regel uden test. Netop denne må ikke
// kunne skride ubemærket — bliver `null` til "altid feje", er det jobbets
// forbrugsbegrænsning, der ryger.
//
// `to` er nøjagtig `from`-grænsen i hovedopslaget nedenfor, så de to vinduer
// støder op til hinanden uden overlap: en kamp høres af præcis ét af dem.
export function staleWindow(now, { sweepMinute = STALE_SWEEP_MINUTE } = {}) {
  if (new Date(now).getUTCMinutes() !== sweepMinute) return null;
  return {
    from: new Date(now - STALE_MAX_AGE_MS).toISOString(),
    to: new Date(now - WINDOW_BACK_MS).toISOString(),
  };
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

    // API-nøglerne tjekkes ikke her, men pr. leverandør nedenfor — se
    // kommentaren i api/sync-matches.js.
    // Svaret navngiver IKKE variablerne (G38). Tjekket ligger nødvendigvis FØR
    // autorisationen — uden dem kan vi ikke engang slå kalderen op — så teksten
    // ville ellers kortlægge backendens opsætning for enhver uautentificeret
    // kaldende. Navnene er ikke hemmelige, men de er gratis rekognoscering, og
    // de hører hjemme dér, hvor kun vi kan læse dem: i Vercels logs.
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error("[opsætning] SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY mangler i miljøet.");
      return res.status(500).json({ error: "Serveren er ikke sat rigtigt op." });
    }

    const sb = createSb(SUPABASE_URL, SERVICE_KEY);

    // ---- autorisation: samme regler som sync-matches (header foretrukket) ----
    const auth = await isAuthorized(req, {
      sb,
      supabaseUrl: SUPABASE_URL,
      serviceKey: SERVICE_KEY,
      syncSecret: SYNC_SECRET,
    });
    if (!auth.ok) {
      return res.status(401).json({ error: "Ikke autoriseret" });
    }

    const dryRun = req.query.dryRun === "true";
    run = createRunLogger(sb, "sync-live", { skip: dryRun });
    // A11: hvilken vej autorisationen kom ind, ned i driftsloggen — se setAuth().
    run.setAuth(auth.via);
    // A46: hvilket værtsnavn jobbet kaldte ind på — se setHost().
    run.setHost(req);

    // ---- 1) hvilke kampe kan være i gang lige nu? ----
    // (a) kampe uden endeligt resultat, hvis kickoff ligger i tidsvinduet, ELLER
    // (b) kampe der stadig står markeret som live (skal ryddes/færdigmeldes,
    //     også hvis de er faldet ud af vinduet), ELLER
    // (c) én gang i timen: kampe, der for længst burde have fået et resultat og
    //     ikke har et (G122) — se `staleWindow()` ovenfor.
    const now = Date.now();
    const from = new Date(now - WINDOW_BACK_MS).toISOString();
    const to = new Date(now + WINDOW_AHEAD_MS).toISOString();
    const cols = "id,api_fixture_id,season_id,home_team_id,away_team_id,kickoff_at,status,home_score,away_score,live_home_score,live_away_score,live_state,live_minute";
    const stale = staleWindow(now);
    // Simple opslag frem for ét or=(and(...))-udtryk: tidsstempler i en PostgREST-
    // logiktræ-værdi kræver citering, og det er ikke besværet værd for opslag,
    // der næsten altid returnerer nul rækker i (b) og (c).
    //
    // (c) er `not.is.true` og ikke `is.false`, så rækker fra før `kickoff_tbd`
    // fandtes (null) tælles med. Kampe UDEN bekræftet klokkeslæt holdes derimod
    // ude med vilje: efterfejningen bygger på "kampen burde være slut nu", og
    // det udsagn kan ikke stilles om en kamp, hvis starttid er en pladsholder.
    // De ville desuden kunne fylde loftet nedenfor og fortrænge ægte fund.
    const [inWindow, stillLive, staleRows] = await Promise.all([
      sb(`/rest/v1/matches?select=${cols}&home_score=is.null&kickoff_at=gte.${from}&kickoff_at=lte.${to}`),
      sb(`/rest/v1/matches?select=${cols}&live_state=not.is.null`),
      stale
        ? sb(`/rest/v1/matches?select=${cols}&home_score=is.null&kickoff_tbd=not.is.true&kickoff_at=gte.${stale.from}&kickoff_at=lt.${stale.to}&order=kickoff_at.desc&limit=${STALE_MAX}`)
        : Promise.resolve([]),
    ]);
    const byId = new Map();
    for (const m of [...(inWindow || []), ...(stillLive || [])]) byId.set(m.id, m);
    // Efterfejningens id'er huskes, så resuméet kan skelne "live-syncen gjorde
    // sit arbejde" fra "bagstopperen fangede noget, der var tabt". Uden den
    // skelnen ville et hul, der opstår igen og igen, se ud som en normal kørsel.
    // Sættet fyldes FØR `byId`, så en kamp, der også er i (a) eller (b), ikke
    // fejlagtigt tælles som et fund.
    const staleIds = new Set();
    for (const m of staleRows || []) {
      if (byId.has(m.id)) continue;
      staleIds.add(m.id);
      byId.set(m.id, m);
    }

    // Kvitteringen for efterfejningen, og den er tre-værdiet med vilje: feltet
    // MANGLER, når minuttet ikke var fejeminuttet, og står `0`, når der blev
    // fejet uden fund. Et felt, der altid var der, ville man holde op med at
    // læse; et felt, der kun var der ved fund, ville ikke kunne skelne "fejede,
    // alt var fint" fra "holdt op med at feje" — og det er præcis den forskel,
    // `A11` og `G43` begge kostede noget at lære.
    const staleInfo = stale ? { staleChecked: staleIds.size } : {};

    const withFixture = [...byId.values()].filter((m) => m.api_fixture_id);
    if (!withFixture.length) {
      // Ingen kampe i vinduet — spar API-kaldet helt (det er langt de fleste minutter i døgnet).
      // Dette er hele forbrugsbegrænsningen, og de to liga-opslag nedenfor ligger
      // bevidst EFTER den, så en stille nat ikke koster to Supabase-kald i minuttet.
      return run.ok(res, { checked: 0, live: 0, finished: 0, cleared: 0, ...staleInfo, note: "Ingen kampe i tidsvinduet" });
    }

    // ---- 2) hvilken datakilde hører hver kamp til? ----
    // Vejen går matches.season_id → seasons.league_id → leagues.provider.
    // Begge tabeller er små (én række pr. turnering/sæson), så det er to
    // billige opslag — og de sparer en provider-kolonne på matches, som ville
    // kunne komme i utakt med ligaens.
    //
    // `select=*` på leagues og ikke en kolonneliste: koden deployes automatisk
    // ved push, mens sql/multi_provider.sql køres manuelt bagefter. En navngiven
    // kolonne, der endnu ikke findes, giver 400 fra PostgREST — og dette job
    // kører hvert minut, så live-scoren ville være nede i hele vinduet mellem
    // deploy og migrering. Med `*` mangler felterne bare, og indexSeasons()
    // læser dem som "sportmonks, live slået til" = verden før migreringen.
    const [leagues, seasons] = await Promise.all([
      sb(`/rest/v1/leagues?select=*`),
      sb(`/rest/v1/seasons?select=id,league_id`),
    ]);
    const seasonMeta = indexSeasons(leagues, seasons);

    const groups = new Map();
    for (const m of withFixture) {
      const meta = seasonMeta.get(m.season_id);
      const key = meta?.provider || DEFAULT_PROVIDER;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }

    // ---- 3) hent kampene hos hver leverandør ----
    const fixtureByGlobalId = new Map();
    // Kampe hvis leverandør fejlede. De må IKKE ende i beslutningsløkken: en
    // manglende nøgle eller et 500-svar er ikke det samme som "kampen findes
    // ikke", og at rydde live-markeringen på den baggrund ville slukke en
    // igangværende kamp på Hjem-skærmen, hver gang en API kortvarigt vaklede.
    const skipped = new Set();
    const providerErrors = [];

    // Leverandørens eget regnskab over forbruget (A15). Kun Sportmonks
    // rapporterer i dag; feltet mangler tavst for de øvrige.
    const providerMeta = {};
    for (const [key, matches] of groups) {
      try {
        const provider = getProvider(key);
        const token = providerToken(provider);
        const found = await provider.fetchLive({
          providerIds: matches.map((m) => provider.fromGlobalId(m.api_fixture_id)),
          kickoffs: matches.map((m) => m.kickoff_at),
          token,
          meta: providerMeta,
        });
        for (const [globalId, fx] of found) fixtureByGlobalId.set(globalId, fx);
      } catch (e) {
        for (const m of matches) skipped.add(m.id);
        providerErrors.push(`${key}: ${e?.message ?? String(e)}`);
        console.error(`[sync-live] Datakilden '${key}' fejlede:`, e?.stack || e?.message || e);
      }
    }

    // ---- 4) beslut hvad der skal skrives ----
    const updates = [];
    let liveCount = 0, finishedCount = 0, clearedCount = 0, liveSuppressed = 0, staleRescued = 0;
    const preview = [];

    for (const m of withFixture) {
      if (skipped.has(m.id)) continue;

      const fx = fixtureByGlobalId.get(String(m.api_fixture_id));
      const liveEnabled = seasonMeta.get(m.season_id)?.liveEnabled !== false;
      const base = {
        api_fixture_id: m.api_fixture_id,
        season_id: m.season_id,
        home_team_id: m.home_team_id,
        away_team_id: m.away_team_id,
        kickoff_at: m.kickoff_at,
      };
      const clearLive = { live_home_score: null, live_away_score: null, live_state: null, live_minute: null, live_updated_at: null };
      // Ryd en hængende live-markering, hvis der er en. Bruges de tre steder,
      // hvor kampen ikke (længere) skal vises som i gang.
      const clearIfMarked = () => {
        if (m.live_state == null) return false;
        updates.push({ ...base, status: m.status, home_score: m.home_score, away_score: m.away_score, ...clearLive });
        clearedCount++;
        return true;
      };

      // Kampen kunne ikke hentes (fx uden for abonnementet) — ryd en evt. hængende live-markering.
      if (!fx) { clearIfMarked(); continue; }

      if (fx.status === "finished") {
        // Slutfløjt: skriv det ENDELIGE resultat med det samme. Det er her — og kun her —
        // point, stillinger og rating bevæger sig (DB-triggeren fanger score-ændringen).
        // Melder datakilden slut uden en stilling (datafejl), skriver vi IKKE et tomt
        // resultat — vi rydder blot live-markeringen og prøver igen næste kørsel.
        const hs = fx.score.home, as = fx.score.away;
        if (hs == null || as == null) { clearIfMarked(); continue; }
        if (m.home_score === hs && m.away_score === as && m.live_state == null) continue;
        updates.push({ ...base, status: "finished", home_score: hs, away_score: as, ...clearLive });
        finishedCount++;
        // Et resultat, det normale vindue havde tabt (G122). Tælles for sig,
        // fordi det er selve målet: står tallet vedvarende over nul, er der et
        // hul i live-syncen, som bagstopperen skjuler frem for at afsløre.
        if (staleIds.has(m.id)) staleRescued++;
        preview.push({ fixture: m.api_fixture_id, action: staleIds.has(m.id) ? "finished (efterfejet)" : "finished", score: `${hs}-${as}` });
        continue;
      }

      if (fx.status === "live") {
        // Ligaen har ikke live slået til (football-data.orgs gratis-plan har
        // forsinket stilling og intet spilleminut). Kampen er i gang, men vi
        // påstår det ikke i UI'et — vi venter på det endelige resultat ovenfor.
        if (!liveEnabled) {
          liveSuppressed++;
          clearIfMarked();
          continue;
        }
        const hs = fx.score.home, as = fx.score.away;
        const state = fx.liveState || "INPLAY";
        const minute = fx.liveMinute;
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
      if (clearIfMarked()) {
        preview.push({ fixture: m.api_fixture_id, action: "cleared", state: fx.liveState });
      }
    }

    const summary = {
      checked: withFixture.length - skipped.size,
      live: liveCount,
      finished: finishedCount,
      cleared: clearedCount,
      // Kampe der ER i gang, men hvis liga ikke har live slået til. Tallet er
      // den synlige kvittering for, hvad €12/md-planen ville købe.
      liveSuppressed,
      ...staleInfo,
      // Kun til stede, når bagstopperen faktisk fangede noget. Et resultat her
      // er ikke en succes at glæde sig over, men et spor efter et tabt
      // slutfløjt — se tælleren i beslutningsløkken ovenfor.
      ...(staleRescued ? { staleRescued } : {}),
      providers: [...groups.keys()],
    };

    if (dryRun) {
      return res.status(200).json({
        dryRun: true,
        note: "Intet er skrevet til databasen — dette er kun en forhåndsvisning.",
        ...summary,
        skipped: skipped.size,
        providerErrors,
        preview,
      });
    }

    // ---- 5) ét samlet skriv ----
    // Alle ændringer i én upsert-sætning: statement-triggeren på matches kører dermed
    // netop én gang, og genberegner kun ratings hvis mindst ét ENDELIGT resultat ændrede sig.
    if (updates.length) {
      await sb(`/rest/v1/matches?on_conflict=api_fixture_id`, {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: JSON.stringify(updates),
      });
    }

    const body = {
      ...summary,
      written: updates.length,
      // Leverandørens eget forbrugstal, når den rapporterer et (A15). Netop
      // dette job er det interessante: det kører hvert minut og er dermed det,
      // der kommer tættest på grænsen.
      ...(providerMeta.rateLimit ? { rateLimit: providerMeta.rateLimit } : {}),
    };

    // Rækkefølgen er med vilje: de leverandører, der virkede, har fået deres
    // opdateringer skrevet, FØR kørslen meldes fejlet. En fejlet leverandør
    // skal være synlig i Admin → Drift og få cron-job.org til at markere
    // kørslen rød — men den må ikke koste de andre deres resultater.
    if (providerErrors.length) {
      const msg = `Datakilder fejlede: ${providerErrors.join(" | ")}`;
      return run.fail(res, 500, { ...body, error: msg, skipped: skipped.size }, msg);
    }

    return run.ok(res, body);
  } catch (e) {
    return failJob(run, res, e, "sync-live");
  }
}
