// Fælles hjælpere for de tre Vercel-funktioner i api/.
//
// Underscore-præfikset er bevidst: Vercel router filsystemet i api/ til
// endpoints, men springer filer med `_` over — så denne fil bliver aldrig
// selv et kaldbart endpoint.
//
// Indtil nu var `sb()` og `isAuthorized()` kopieret ORDRET i sync-matches.js,
// sync-live.js og send-notifications.js. Den vigtigste konsekvens var ikke
// linjetallet, men at enhver ændring i autorisationen skulle laves tre steder
// og være ens alle tre — fx den forestående fjernelse af `?secret=`-fallbacken
// (ROADMAP A11).
//
// api/ importerer bevidst ikke fra src/: funktionerne kører i Node på Vercel,
// mens src/ bygges til browseren. Denne fil er delingspunktet for api/ alene.
import { createHash, timingSafeEqual } from "node:crypto";

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
    const r = await fetch(`${supabaseUrl}${path}`, {
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
  return {
    async ok(res, body) {
      if (!skip) await recordRun(sb, job, { ok: true, startedAt, detail: body });
      return res.status(200).json(body);
    },
    // `error` er den fulde tekst til job_runs (kun admin-læsbar); `body` er det,
    // kalderen får at se. De to er med vilje ikke det samme — se handlernes catch.
    async fail(res, status, body, error) {
      if (!skip) await recordRun(sb, job, { ok: false, startedAt, detail: body, error });
      return res.status(status).json(body);
    },
  };
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
//   1. Den delte hemmelighed (ekstern cron) — helst i headeren `x-sync-secret`,
//      så den ikke havner i request-logs. `?secret=` bevares som fallback for
//      cron-jobs, der endnu ikke er flyttet (ROADMAP A11).
//   2. En admin-brugers eget login (`Authorization: Bearer <supabase-JWT>`) —
//      det er kun Admin-skærmens knapper, der bruger den vej.
//
// Returnerer `{ ok, via }` frem for en ren boolean. `via` fortæller HVILKEN vej
// der blev brugt, og det er det, der gør A11 til et datasspørgsmål frem for et
// hukommelsesspørgsmål: så længe noget kalder ind med `via: "query"`, ville en
// fjernelse af fallbacken give 401.
export async function isAuthorized(req, { sb, supabaseUrl, serviceKey, syncSecret }) {
  // `header || query` — præcis som før udtrækningen. Bemærk at en TILSTEDE men
  // forkert header dermed blokerer query-fallbacken; det er ikke en elegant
  // regel, men at gøre den mere eftergivende her ville være en adfærdsændring
  // smuglet ind i en oprydning.
  const headerSecret = req.headers["x-sync-secret"];
  const providedSecret = headerSecret || req.query?.secret;
  if (secretsMatch(providedSecret, syncSecret)) {
    if (headerSecret) return { ok: true, via: "header" };
    // Bevidst støj i Vercels logs: den er kvitteringen for, at fallbacken
    // stadig er i brug, og dermed at A11 endnu ikke kan lukkes.
    console.warn(
      "[A11] Forældet autorisation: hemmeligheden kom som ?secret=. Flyt jobbet til headeren x-sync-secret."
    );
    return { ok: true, via: "query" };
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const userToken = authHeader.slice(7);
    try {
      const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${userToken}` },
      });
      if (!userRes.ok) return { ok: false, via: null };
      const user = await userRes.json();
      const profs = await sb(`/rest/v1/profiles?id=eq.${user.id}&select=is_admin`);
      return profs[0]?.is_admin ? { ok: true, via: "admin-token" } : { ok: false, via: null };
    } catch {
      return { ok: false, via: null };
    }
  }
  return { ok: false, via: null };
}
