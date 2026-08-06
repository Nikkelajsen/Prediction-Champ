// Fælles hjælpere for de tre Vercel-funktioner i api/.
//
// Underscore-præfikset er bevidst: Vercel router filsystemet i api/ til
// endpoints, men springer filer med `_` over — så denne fil bliver aldrig
// selv et kaldbart endpoint.
//
// Indtil nu var `sb()` og `isAuthorized()` kopieret ORDRET i sync-matches.js,
// sync-live.js og send-notifications.js. Den vigtigste konsekvens var ikke
// linjetallet, men at enhver ændring i autorisationen skulle laves tre steder
// og være ens alle tre — fx fjernelsen af `?secret=`-fallbacken (A11), som
// derfor kunne laves ét sted 5. august 2026.
//
// api/ importerer bevidst ikke fra src/: funktionerne kører i Node på Vercel,
// mens src/ bygges til browseren. Denne fil er delingspunktet for api/ alene.
import { createHash, timingSafeEqual } from "node:crypto";

// ---- udgående kald med tidsgrænse (G19) ----
//
// Intet udgående `fetch` havde en timeout indtil august 2026, og standarden er
// "vent for evigt". En hængende leverandør — ikke en fejlende, en HÆNGENDE —
// stoppede dermed hele kørslen, indtil Vercel klippede funktionen over, og en
// funktion, der klippes over, når hverken at skrive sin `job_runs`-række eller
// at rydde op efter sig. `sync-live` kører hvert minut, så to hængende kald kan
// desuden ligge oven i hinanden.
//
// Grænsen er PR. KALD og ikke pr. kørsel: en paginering på fire sider må gerne
// tage fire gange så lang tid som én side, men ingen enkelt side må hænge. Det
// samlede loft er funktionens `maxDuration` (vercel.json), og de to tal hænger
// sammen — et kald-loft, der er større end funktionens budget, er ingen grænse.
export const FETCH_TIMEOUT_MS = 10_000;

// `AbortSignal.timeout()` frem for en håndrullet AbortController: den findes i
// Node 18+ (Vercel kører 22), rydder sin egen timer op og kan ikke lække en
// timer, hvis kaldet fejler af en anden grund undervejs.
export async function fetchWithTimeout(url, opts = {}, ms = FETCH_TIMEOUT_MS) {
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    // Abort-fejlen siger kun "This operation was aborted", hvilket i en
    // driftslog er ubrugeligt: den fortæller hverken hvilken adresse eller
    // hvor længe. Fejlteksten ender i `job_runs.error` og skal kunne læses af
    // et menneske et halvt år senere.
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      // Query-strengen klippes af med vilje: Sportmonks sender sin API-nøgle
      // som `?api_token=`, og fejlteksten ender i `job_runs.error`.
      const kort = String(url).split("?")[0];
      throw new Error(`Tidsgrænse: intet svar fra ${kort} inden for ${ms} ms`, { cause: e });
    }
    throw e;
  }
}

// PostgREST-klient mod Supabase med service-nøglen. Kaster ved alt andet end 2xx,
// så en fejl aldrig kan forveksles med et tomt resultat.
export function createSb(supabaseUrl, serviceKey) {
  return async function sb(path, opts = {}) {
    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(opts.prefer ? { Prefer: opts.prefer } : {}),
    };
    const r = await fetchWithTimeout(`${supabaseUrl}${path}`, {
      method: opts.method,
      headers,
      body: opts.body,
    });
    if (!r.ok) throw new Error(`Supabase ${path}: ${r.status} ${await r.text()}`);
    if (r.status === 204) return null;
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  };
}

// Henter ALLE rækker for et GET-opslag — også når der er flere, end Supabase
// leverer i ét svar.
//
// Supabase klipper hvert svar ved projektets `db-max-rows` (1000 som standard)
// og siger det ikke: svaret er 200 med en kortere liste. `sb()` kaster kun ved
// ikke-2xx og kan derfor ikke se forskel på "det var alt" og "her er de første
// 1000" — et afkortet svar er ikke en fejl, men et forkert facit.
//
// Det kostede en falsk notifikation 1. august 2026 (`G51`): runde-opslaget i
// send-notifications havde kun en NEDRE grænse på `round_key` og bad dermed om
// hele resten af sæsonen for fem officielle turneringer. Svaret blev klippet, og
// en runde, hvis uspillede kampe faldt uden for klippet, så færdigspillet ud.
//
// To detaljer er ikke til forhandling:
//   * `order` er PÅKRÆVET. PostgRESTs rækkefølge er udefineret uden den, så
//     paginering ville både tabe og gentage rækker mellem to sider. Der findes
//     ingen brugbar standardværdi at gætte på: flere tabeller i skemaet har
//     sammensat primærnøgle og slet ingen `id`-kolonne.
//   * der stoppes ved en TOM side, ikke ved en side, der er kortere end
//     `pageSize`. Er projektets `db-max-rows` mindre end `pageSize`, ville
//     "kortere end bestilt" være sandt for hver eneste fulde side — og så havde
//     vi bygget den samme tavse afkortning igen. Loftet kan ikke aflæses fra
//     repoet, så det må ikke antages. Prisen er ét ekstra kald pr. opslag;
//     jobbene kører hvert 15.-30. minut.
export async function sbAll(sb, path, { order, pageSize = 1000, maxPages = 100 } = {}) {
  if (!order || /[?&]order=/.test(path)) {
    throw new Error(
      `sbAll(${path}): sorteringen skal angives i 'order'-argumentet og kun dér — paginering uden én stabil sortering taber rækker`
    );
  }
  const sep = path.includes("?") ? "&" : "?";
  const rows = [];
  for (let page = 0; page < maxPages; page++) {
    const batch = await sb(`${path}${sep}order=${order}&limit=${pageSize}&offset=${rows.length}`);
    if (!batch?.length) return rows;
    rows.push(...batch);
  }
  // Nås kun ved mere end maxPages sider. Kastet er med vilje: at returnere det
  // halve resultat her ville være præcis den tavse afkortning, funktionen findes
  // for at forhindre.
  throw new Error(`sbAll(${path}): over ${maxPages * pageSize} rækker — opslaget skal afgrænses`);
}

// Hvilken kode kørte? (G42)
//
// Vercel sætter VERCEL_GIT_COMMIT_SHA i funktionsmiljøet. Uden den kan en
// række i `job_runs` ikke kobles til et deploy — og netop dét spørgsmål er
// dyrt at ikke kunne svare på: `B8` kostede tre merges, fordi et fejlet deploy
// betød, at det, der kørte i produktion, var to versioner ældre end `main`,
// uden at nogen kunne se det. Med SHA'en på hver kørsel er "kørte rettelsen
// overhovedet?" et opslag frem for en antagelse.
//
// Syv tegn, samme længde som frontendens stempel og som `git log --oneline`.
const APP_VERSION = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || null;

// Skriver én række i job_runs pr. kørsel (sql/job_runs.sql).
//
// KONTRAKT: må ALDRIG kaste og aldrig ændre jobbets svar. Overvågning, der kan
// vælte det, den overvåger, er værre end ingen overvågning — så en fejlet
// logning bliver til en advarsel i Vercels logs og intet andet. Samme princip
// som logEvent() i src/lib/analytics.js.
//
// `detail` er jobbets eget resumé (antal synkede, sendte, sprunget over). Det
// er dét felt, der gør en tavs delvis fejl synlig: en kørsel kan svare 200 og
// stadig have lavet ingenting.
export async function recordRun(sb, job, { ok, startedAt, detail = null, error = null }) {
  try {
    await sb("/rest/v1/job_runs", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({
        job,
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        ok,
        detail,
        // Fejlteksten kan indeholde svar-bodies fra Supabase eller Sportmonks.
        // job_runs er kun læsbar for admins, så den må gerne stå der — men den
        // klippes, så en enkelt kæmpefejl ikke fylder tabellen.
        error: error ? String(error).slice(0, 2000) : null,
      }),
    });
  } catch (e) {
    console.warn(`[job_runs] Kunne ikke logge kørsel af ${job}:`, e?.message ?? e);
  }
}

// Bogholderi for én kørsel: måler varigheden og skriver rækken FØR svaret sendes.
//
// Rækkefølgen er ikke til forhandling. På Vercel kan funktionen fryses, så snart
// svaret er afsendt, så en logning efter res.json() ville gå tabt netop når det
// er mest interessant — ved en fejl.
//
// Tørre kørsler (?dryRun=true) logges bevidst IKKE: de laver ikke noget arbejde,
// og en manuel forhåndsvisning ville ellers nulstille fejlserien i
// admin_job_health() og skjule et job, der reelt er gået i stå.
export function createRunLogger(sb, job, { skip = false } = {}) {
  const startedAt = Date.now();
  let name = job;
  // Hvordan kørslen autoriserede sig. Sættes af handleren og lægges i
  // `job_runs.detail` — se setAuth() nedenfor for hvorfor.
  let authVia = null;
  // Detaljen er jobbets eget svar PLUS det, kørslen ved om sig selv. De to
  // holdes adskilt, fordi svaret er til kalderen (et cron-job, en maskine),
  // mens detaljen er til den, der læser driftsloggen bagefter.
  const withMeta = (body) => {
    const ekstra = { ...(authVia ? { authVia } : {}), ...(APP_VERSION ? { version: APP_VERSION } : {}) };
    // Er der intet at tilføje, sendes svaret videre UÆNDRET — også når det er
    // null. `{...null}` ville blive til `{}`, altså et tomt resumé, hvor der
    // før stod "ingenting", og de to ser ens ud i driftsloggen uden at være det.
    return Object.keys(ekstra).length ? { ...body, ...ekstra } : body;
  };
  return {
    // Skifter jobnavnet MIDT i kørslen, uden at nulstille varigheden.
    //
    // Findes for sync-matches (G44): navnet skal bære turneringen, så syv jobs
    // ikke deler én række i driftsloggen — men hvilken turnering det er, står i
    // query-parameteren og kendes derfor først EFTER autorisationen. Havde vi i
    // stedet flyttet logger-oprettelsen ned efter opslaget, ville en kørsel, der
    // vælter undervejs, miste sin startTid; og de fejl, der sker før opslaget
    // (manglende leagueId), ville slet ikke blive logget.
    rename(nextJob) {
      if (nextJob) name = nextJob;
    },
    // Skriver HVILKEN vej kørslen autoriserede sig ind i driftsloggen (A11).
    //
    // `isAuthorized()` har altid vidst det — den returnerer `via` — men værdien
    // blev kasseret, så det eneste spor var en `[A11]`-advarsel i Vercels logs.
    // Det gjorde beslutningen om at fjerne `?secret=`-fallbacken afhængig af, at
    // nogen huskede at kigge et sted uden for appen, inden for logopbevaringens
    // vindue, og kunne skelne "ingen advarsler" fra "ingen kørsler".
    //
    // Med værdien i `job_runs.detail` blev spørgsmålet et ALMINDELIGT OPSLAG
    // med 30 dages historik (`prune_job_runs`), og — vigtigst — et opslag, der
    // kan skelne de to: et job, der ikke har kørt, har ingen række, mens et job,
    // der kalder rigtigt, har rækker med `authVia: "header"`. **Opslaget er kørt
    // 5. august 2026, og fallbacken er fjernet.** Feltet skrives fortsat: det
    // skiller nu en planlagt kørsel fra et manuelt "Hent nu", hvilket er den
    // skelnen, `CRON.md`s verifikationskolonne hviler på. Fremgangsmåden — nu
    // som eksempel på, hvordan et hukommelsesspørgsmål gøres til et opslag —
    // står i docs/CRON.md.
    setAuth(via) {
      authVia = via || null;
    },
    async ok(res, body) {
      if (!skip) await recordRun(sb, name, { ok: true, startedAt, detail: withMeta(body) });
      return res.status(200).json(body);
    },
    // `error` er den fulde tekst til job_runs (kun admin-læsbar); `body` er det,
    // kalderen får at se. De to er med vilje ikke det samme — se handlernes catch.
    async fail(res, status, body, error) {
      if (!skip) await recordRun(sb, name, { ok: false, startedAt, detail: withMeta(body), error });
      return res.status(status).json(body);
    },
  };
}

// Er værdien et UUID? (G18)
//
// `leagueId` kommer fra query-strengen og interpoleres i PostgREST-URL'er, der
// kaldes med SERVICE-NØGLEN. Det er ikke SQL-injektion — PostgREST
// parametriserer — men en kaldende med sync-hemmeligheden kunne føje EKSTRA
// PostgREST-parametre til (`&limit=`, `&order=`, flere filtre) og dermed
// omforme en forespørgsel, der kører uden om RLS. Værdier afledt af databasen
// (api/_backfill.js) er betroede og går ikke gennem denne.
//
// Formatet er den rigtige kontrol og ikke en escaping: kolonnen ER en uuid, så
// alt andet end et uuid er alligevel en fejl. Afvises tidligt, er der intet at
// escape.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v) {
  return typeof v === "string" && UUID.test(v);
}

// Jobnavnet for én turnerings kampsynkronisering (G44).
//
// Indtil august 2026 skrev alle syv sync-matches-jobs den SAMME jobrække, så
// admin_job_health() så dem som ét job: den seneste kørsel vandt, og en
// turnering, der fejlede ved hver eneste kørsel, var usynlig bag en, der gik
// godt. Præcis den fejlklasse var `B8`, og den blev kun fundet, fordi nogen
// kiggede manuelt.
//
// Nøglen er liga-UUID'en og ikke et navne-slug. Det er ikke pænere, det er
// præcist: både overvågningen (job-heartbeat.yml) og Admin → Drift udleder den
// forventede jobliste fra `leagues`-tabellen, og med id'et som nøgle kan de to
// ender ikke drive fra hinanden — hvad de kunne, hvis en slug-funktion skulle
// være ens i api/, i src/ og i SQL. Menneskenavnet slås op i samme tabel.
export function syncMatchesJob(leagueId) {
  return `sync-matches:${leagueId}`;
}

// Fælles afslutning på handlernes catch: fuld fejl i logs og i job_runs,
// kort fejl til kalderen.
//
// Bemærk hvad der IKKE sker her: fejlteksten sløres ikke. Endpointet svarer
// 401 før nogen fejl kan opstå, så de eneste, der nogensinde ser en fejl, er
// cron-jobbet (en maskine) og en admin i Admin-skærmen. For admin'en er den
// præcise tekst hele pointen — "Kørslen fejlede" ville gøre knappen ubrugelig.
// Hverken sb() eller Sportmonks-kaldene lægger nøgler i deres fejlbeskeder.
export async function failJob(run, res, e, job) {
  const full = e?.stack || e?.message || String(e);
  console.error(`[${job}] Kørslen fejlede:`, full);
  const body = { error: e?.message ?? String(e) };
  if (run) return run.fail(res, 500, body, full);
  // Fejlede vi før autorisationen var i hus, findes der ingen kørsel at logge.
  return res.status(500).json(body);
}

// Konstant-tids sammenligning af to hemmeligheder.
//
// Begge hashes først, så `timingSafeEqual` altid får to lige lange buffere —
// ellers kaster den på ulige længder, og selve kastet ville i sig selv røbe,
// at længden var forkert. Tidligere var det et almindeligt `===`, som falder
// igennem ved første forskellige tegn.
export function secretsMatch(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Autorisation for de tre job-endpoints. To veje ind:
//
//   1. Den delte hemmelighed (ekstern cron) i headeren `x-sync-secret`, så den
//      ikke havner i request-logs.
//   2. En admin-brugers eget login (`Authorization: Bearer <supabase-JWT>`) —
//      det er kun Admin-skærmens knapper, der bruger den vej.
//
// `?secret=`-FALLBACKEN ER FJERNET (A11, 5. august 2026). Den fandtes, fordi
// hemmeligheden i en query-streng havner i request-logs, mens ingen turde
// fjerne den på et gæt: rammer man forkert, svarer jobbene 401, og syncen står
// stille. Beslutningen blev derfor til et opslag i `job_runs.detail`, og det
// svarede entydigt over 14 dage: `header` for alle ni jobs (sync-live,
// send-notifications og syv sync-matches), nul rækker med `query`. De eneste
// andre værdier var `admin-token` (tre manuelle "Hent nu") og `(ukendt)` fra
// før feltet fandtes — sidstnævnte alle med sidste kørsel 1. august 21:17,
// altså selve udrulningsminuttet, og ingen efter den.
//
// Returnerer stadig `{ ok, via }` frem for en ren boolean, og `via` skrives
// stadig i `job_runs.detail`. Feltet overlever altså det spørgsmål, det blev
// bygget til: det er nu dét, der skiller en planlagt kørsel fra et menneske,
// der har trykket "Hent nu" — den skelnen, `CRON.md`s verifikationskolonne
// hviler på.
export async function isAuthorized(req, { sb, supabaseUrl, serviceKey, syncSecret }) {
  // Kun headeren. `secretsMatch()` afviser selv en manglende eller ikke-streng
  // værdi, så der er ingen grund til at tjekke for tilstedeværelse først.
  if (secretsMatch(req.headers["x-sync-secret"], syncSecret)) return { ok: true, via: "header" };

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const userToken = authHeader.slice(7);
    try {
      // `fetchWithTimeout` og ikke bart `fetch` (G66, august 2026). Det var
      // filens sidste udgående kald uden tidsgrænse, og det sad værst tænkeligt:
      // FØR `run` findes, altså før der er noget at skrive i `job_runs`. Hang
      // opslaget, blev funktionen klippet over af Vercel uden at efterlade en
      // række — nøjagtig den tavshed, `G19` blev bygget for at afskaffe.
      //
      // Stien rammes kun af admin-token-kald ("Hent nu", Drift-forhåndsvisningen)
      // og ikke af cron-jobbene, hvilket både er grunden til, at den blev
      // overset, og til at den er billig at lukke: en tidsgrænse her kan ikke
      // koste en planlagt kørsel noget.
      const userRes = await fetchWithTimeout(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${userToken}` },
      });
      // Hvorfor en 401 opstod, kan kun læses HER (august 2026). Svaret til
      // kalderen er og bliver et nøgent "Ikke autoriseret" — teksten må ikke
      // kortlægge opsætningen for en uautentificeret kalder, jf. begrundelsen i
      // sync-matches.js. Men de tre veje til den 401 kræver hver sin rettelse,
      // og uden en linje her ser de ens ud:
      //
      //   · 404 fra /auth/v1/user  → SUPABASE_URL peger forkert (fx på
      //     "RESTful endpoint" med /rest/v1 bagpå i stedet for Project URL)
      //   · 401 fra /auth/v1/user  → service-nøglen hører til et andet projekt,
      //     eller brugerens token er udløbet
      //   · is_admin falsk         → funktionen kigger i en ANDEN database end
      //     den, klienten viste Admin-fanen ud fra
      //
      // Fælden er ægte og ikke hypotetisk: den kostede en aften under
      // opsætningen af staging (docs/STAGING.md trin 5-6), hvor alle tre var
      // mistænkt på skift, fordi loggen kun sagde "401".
      //
      // Intet hemmeligt logges — hverken nøgle eller token — og logs kan kun
      // læses af projektets ejer.
      if (!userRes.ok) {
        console.error(`[auth] ${supabaseUrl}/auth/v1/user svarede ${userRes.status}. 404 = forkert SUPABASE_URL, 401 = forkert SUPABASE_SERVICE_ROLE_KEY eller udløbet brugertoken.`);
        return { ok: false, via: null };
      }
      const user = await userRes.json();
      const profs = await sb(`/rest/v1/profiles?id=eq.${user.id}&select=is_admin`);
      if (!profs[0]?.is_admin) {
        console.error(`[auth] Bruger ${user.id} har ikke is_admin i databasen på ${supabaseUrl} (fandt ${profs.length} profilrække(r)).`);
        return { ok: false, via: null };
      }
      return { ok: true, via: "admin-token" };
    } catch (e) {
      console.error(`[auth] Opslaget af kalderen fejlede: ${e.message}`);
      return { ok: false, via: null };
    }
  }
  console.error("[auth] Hverken en gyldig x-sync-secret-header eller et Bearer-token fulgte med kaldet.");
  return { ok: false, via: null };
}
