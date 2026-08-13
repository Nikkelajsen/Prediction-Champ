// Tests for api/_shared.js.
//
// api/ havde indtil nu ingen testdækning overhovedet. Autorisationen var
// samtidig det sted, hvor A11 skulle skære (`?secret=`-fallbacken), så det var
// præcis den kode, der havde brug for et net under sig FØR den blev ændret —
// ikke efter. Snittet er lagt 5. august 2026, og nettet holdt: de to tests, der
// beskrev fallbacken, er vendt om til at bevise, at den er væk.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSb,
  sbAll,
  secretsMatch,
  isAuthorized,
  recordRun,
  requestHost,
  createRunLogger,
  syncMatchesJob,
  fetchWithTimeout,
  isUuid,
  failJob,
} from "./_shared.js";

const URL_BASE = "https://db.example.test";
const SERVICE_KEY = "service-key";
const SECRET = "korrekt-hemmelighed";

function reqWith({ headers = {}, query = {} } = {}) {
  return { headers, query };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => (body === null ? "" : JSON.stringify(body)),
    json: async () => body,
  };
}

describe("secretsMatch", () => {
  it("godkender to ens hemmeligheder", () => {
    expect(secretsMatch(SECRET, SECRET)).toBe(true);
  });

  it("afviser en forkert hemmelighed", () => {
    expect(secretsMatch("forkert", SECRET)).toBe(false);
  });

  it("afviser hemmeligheder af forskellig længde uden at kaste", () => {
    expect(() => secretsMatch("kort", SECRET)).not.toThrow();
    expect(secretsMatch("kort", SECRET)).toBe(false);
    expect(secretsMatch(SECRET + "x", SECRET)).toBe(false);
  });

  // Fejler lukket: er SYNC_SECRET ikke sat i miljøet, må INTET slippe igennem.
  it("afviser når den forventede hemmelighed mangler", () => {
    expect(secretsMatch("hvadsomhelst", undefined)).toBe(false);
    expect(secretsMatch("hvadsomhelst", "")).toBe(false);
  });

  it("afviser tomme og ikke-tekstlige input", () => {
    expect(secretsMatch("", "")).toBe(false);
    expect(secretsMatch(undefined, SECRET)).toBe(false);
    expect(secretsMatch(null, SECRET)).toBe(false);
    expect(secretsMatch(["array"], SECRET)).toBe(false);
  });
});

describe("createSb", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sender service-nøglen som både apikey og bearer", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([{ id: 1 }]));
    vi.stubGlobal("fetch", fetchMock);

    const sb = createSb(URL_BASE, SERVICE_KEY);
    const out = await sb("/rest/v1/profiles?select=id");

    expect(out).toEqual([{ id: 1 }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${URL_BASE}/rest/v1/profiles?select=id`);
    expect(init.headers.apikey).toBe(SERVICE_KEY);
    expect(init.headers.Authorization).toBe(`Bearer ${SERVICE_KEY}`);
  });

  it("sender Prefer-headeren når den er angivet, og ellers ikke", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const sb = createSb(URL_BASE, SERVICE_KEY);
    await sb("/rest/v1/x", { method: "POST", prefer: "resolution=ignore-duplicates" });
    expect(fetchMock.mock.calls[0][1].headers.Prefer).toBe("resolution=ignore-duplicates");

    await sb("/rest/v1/x");
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty("Prefer");
  });

  it("giver null ved 204 og ved tomt svar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(null, { status: 204 })));
    const sb = createSb(URL_BASE, SERVICE_KEY);
    expect(await sb("/rest/v1/x")).toBeNull();
  });

  // Vigtigt: en fejl må aldrig kunne forveksles med "ingen rækker".
  it("kaster ved ikke-2xx, med status og svartekst i beskeden", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403, text: async () => "permission denied" }))
    );
    const sb = createSb(URL_BASE, SERVICE_KEY);
    await expect(sb("/rest/v1/hemmelig")).rejects.toThrow(
      "Supabase /rest/v1/hemmelig: 403 permission denied"
    );
  });
});

// G51: den tavse afkortning kostede en falsk runde-notifikation 1. august 2026.
// Testene her pinner de to egenskaber, der gør sbAll() til et svar på den — og
// som begge er lette at "forenkle" væk igen.
describe("sbAll", () => {
  // Stub-sb, der opfører sig som PostgREST: læser limit/offset af stien og
  // skærer i sin egen række-liste. `kald` gemmer stierne, så pagineringen kan
  // efterprøves på det, der faktisk blev bedt om.
  const stubSb = (rows, { maxRows = Infinity } = {}) => {
    const kald = [];
    const sb = async (path) => {
      kald.push(path);
      const limit = Number(new URL(`https://x${path}`).searchParams.get("limit"));
      const offset = Number(new URL(`https://x${path}`).searchParams.get("offset"));
      return rows.slice(offset, offset + Math.min(limit, maxRows));
    };
    return { sb, kald };
  };

  const rækker = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));

  it("henter én side, når der er færre rækker end loftet", async () => {
    const { sb, kald } = stubSb(rækker(3));
    expect(await sbAll(sb, "/rest/v1/matches?select=id", { order: "id.asc", pageSize: 10 })).toHaveLength(3);
    // To kald: siden med de tre rækker, og den tomme, der beviser, at det var alt.
    expect(kald).toHaveLength(2);
    expect(kald[0]).toBe("/rest/v1/matches?select=id&order=id.asc&limit=10&offset=0");
    expect(kald[1]).toBe("/rest/v1/matches?select=id&order=id.asc&limit=10&offset=3");
  });

  it("samler alle sider, når rækkerne er flere end én side", async () => {
    const { sb, kald } = stubSb(rækker(25));
    const ud = await sbAll(sb, "/rest/v1/matches?select=id", { order: "id.asc", pageSize: 10 });
    expect(ud.map((r) => r.id)).toEqual(rækker(25).map((r) => r.id));
    // Fire kald: 10 + 10 + 5 + den tomme. Den sidste er ikke spild — det er
    // den, der skelner "det var alt" fra "her er de første."
    expect(kald).toHaveLength(4);
  });

  // KERNEN. Projektets db-max-rows kan ikke aflæses fra repoet og kan være
  // mindre end pageSize. Stoppede vi ved "kortere side end bestilt", ville hver
  // eneste fulde side se ud som den sidste — altså præcis den tavse afkortning,
  // funktionen findes for at forhindre.
  it("stopper ved en TOM side, ikke ved en side der er kortere end pageSize", async () => {
    const { sb } = stubSb(rækker(25), { maxRows: 10 }); // loftet er lavere end pageSize
    const ud = await sbAll(sb, "/rest/v1/matches?select=id", { order: "id.asc", pageSize: 1000 });
    expect(ud).toHaveLength(25);
  });

  it("tilføjer separator korrekt, når stien ingen query har", async () => {
    const { sb, kald } = stubSb([]);
    await sbAll(sb, "/rest/v1/matches", { order: "id.asc" });
    expect(kald[0]).toBe("/rest/v1/matches?order=id.asc&limit=1000&offset=0");
  });

  // Uden stabil sortering er PostgRESTs rækkefølge udefineret mellem to kald,
  // så paginering ville både tabe og gentage rækker. Der er ingen standardværdi
  // at falde tilbage på: flere tabeller har sammensat PK og ingen id-kolonne.
  it("kaster, når sorteringen mangler eller står i stien", async () => {
    const { sb } = stubSb([]);
    await expect(sbAll(sb, "/rest/v1/matches?select=id")).rejects.toThrow("order");
    await expect(sbAll(sb, "/rest/v1/matches?order=id.asc", { order: "id.asc" })).rejects.toThrow("order");
  });

  it("kaster frem for at returnere et halvt resultat ved for mange sider", async () => {
    const { sb } = stubSb(rækker(100));
    await expect(
      sbAll(sb, "/rest/v1/matches?select=id", { order: "id.asc", pageSize: 10, maxPages: 3 })
    ).rejects.toThrow("skal afgrænses");
  });
});

describe("isAuthorized", () => {
  let warn;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const deps = (over = {}) => ({
    sb: vi.fn(),
    supabaseUrl: URL_BASE,
    serviceKey: SERVICE_KEY,
    syncSecret: SECRET,
    ...over,
  });

  it("godkender hemmeligheden i x-sync-secret-headeren", async () => {
    const r = await isAuthorized(reqWith({ headers: { "x-sync-secret": SECRET } }), deps());
    expect(r).toEqual({ ok: true, via: "header" });
    expect(warn).not.toHaveBeenCalled();
  });

  // A11 er lukket 5. august 2026: `?secret=` er ikke længere en vej ind.
  //
  // Testen står med den RIGTIGE hemmelighed i query-strengen, fordi det er den
  // eneste formulering, der kan fange en genindførsel. En test med en forkert
  // hemmelighed ville være grøn både før og efter fjernelsen og dermed intet
  // bevise. Grunden til, at fallbacken kunne fjernes, var et opslag i
  // `job_runs.detail` med nul `query`-rækker over 14 dage — se docs/CRON.md.
  it("afviser hemmeligheden i ?secret=, også når den er rigtig (A11)", async () => {
    const r = await isAuthorized(reqWith({ query: { secret: SECRET } }), deps());
    expect(r).toEqual({ ok: false, via: null });
    // Advarslen fulgte fallbacken ud: der er ikke længere noget forældet at
    // melde, kun en afvisning.
    expect(warn).not.toHaveBeenCalled();
  });

  // En forkert header blokerede før query-fallbacken; nu findes fallbacken
  // ikke, så begge dele afvises af samme grund. Rækken bliver stående, fordi
  // den er den kombination, et gammelt cron-job ville ramme.
  it("afviser en forkert header, uanset hvad der står i query-strengen", async () => {
    const req = reqWith({ headers: { "x-sync-secret": "forkert" }, query: { secret: SECRET } });
    expect(await isAuthorized(req, deps())).toEqual({ ok: false, via: null });
  });

  it("afviser alt når SYNC_SECRET ikke er sat i miljøet", async () => {
    const req = reqWith({ headers: { "x-sync-secret": "hvadsomhelst" } });
    expect(await isAuthorized(req, deps({ syncSecret: undefined }))).toEqual({
      ok: false,
      via: null,
    });
  });

  it("godkender en admin-brugers eget token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ id: "user-1" })));
    const sb = vi.fn(async () => [{ is_admin: true }]);
    const req = reqWith({ headers: { authorization: "Bearer bruger-jwt" } });

    expect(await isAuthorized(req, deps({ sb }))).toEqual({ ok: true, via: "admin-token" });
    expect(sb).toHaveBeenCalledWith("/rest/v1/profiles?id=eq.user-1&select=is_admin");
  });

  it("afviser en gyldig bruger, der ikke er admin", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ id: "user-2" })));
    const sb = vi.fn(async () => [{ is_admin: false }]);
    const req = reqWith({ headers: { authorization: "Bearer bruger-jwt" } });
    expect(await isAuthorized(req, deps({ sb }))).toEqual({ ok: false, via: null });
  });

  it("afviser når profil-opslaget ikke giver nogen række", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ id: "user-3" })));
    const sb = vi.fn(async () => []);
    const req = reqWith({ headers: { authorization: "Bearer bruger-jwt" } });
    expect(await isAuthorized(req, deps({ sb }))).toEqual({ ok: false, via: null });
  });

  it("afviser når token-opslaget hos Supabase fejler", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "" })));
    const req = reqWith({ headers: { authorization: "Bearer udloebet" } });
    expect(await isAuthorized(req, deps())).toEqual({ ok: false, via: null });
  });

  it("afviser — uden at kaste — når opslaget smider en netværksfejl", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    const req = reqWith({ headers: { authorization: "Bearer bruger-jwt" } });
    expect(await isAuthorized(req, deps())).toEqual({ ok: false, via: null });
  });

  it("afviser en anmodning helt uden legitimation", async () => {
    expect(await isAuthorized(reqWith(), deps())).toEqual({ ok: false, via: null });
  });
});

describe("recordRun", () => {
  afterEach(() => vi.restoreAllMocks());

  it("skriver én række i job_runs med varighed og detaljer", async () => {
    const sb = vi.fn(async () => null);
    const startedAt = Date.now() - 1500;
    await recordRun(sb, "sync-live", { ok: true, startedAt, detail: { written: 3 } });

    expect(sb).toHaveBeenCalledOnce();
    const [path, opts] = sb.mock.calls[0];
    expect(path).toBe("/rest/v1/job_runs");
    expect(opts.method).toBe("POST");
    const row = JSON.parse(opts.body);
    expect(row.job).toBe("sync-live");
    expect(row.ok).toBe(true);
    expect(row.detail).toEqual({ written: 3 });
    expect(row.error).toBeNull();
    expect(new Date(row.finished_at) - new Date(row.started_at)).toBeGreaterThanOrEqual(1400);
  });

  it("klipper meget lange fejltekster", async () => {
    const sb = vi.fn(async () => null);
    await recordRun(sb, "sync-live", { ok: false, startedAt: Date.now(), error: "x".repeat(5000) });
    expect(JSON.parse(sb.mock.calls[0][1].body).error).toHaveLength(2000);
  });

  // Kontrakten: overvågning må aldrig vælte det, den overvåger.
  it("kaster aldrig, heller ikke når skrivningen fejler", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sb = vi.fn(async () => {
      throw new Error("job_runs findes ikke");
    });
    await expect(
      recordRun(sb, "sync-live", { ok: true, startedAt: Date.now() })
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("createRunLogger", () => {
  const mkRes = () => {
    const res = {
      statusCode: null,
      body: null,
      status(c) {
        res.statusCode = c;
        return res;
      },
      json(b) {
        res.body = b;
        return res;
      },
    };
    return res;
  };

  it("logger og svarer 200 ved ok()", async () => {
    const sb = vi.fn(async () => null);
    const res = mkRes();
    await createRunLogger(sb, "sync-live").ok(res, { written: 2 });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ written: 2 });
    expect(JSON.parse(sb.mock.calls[0][1].body).ok).toBe(true);
  });

  it("logger fejlen fuldt ud, men svarer kalderen det korte", async () => {
    const sb = vi.fn(async () => null);
    const res = mkRes();
    await createRunLogger(sb, "sync-matches").fail(
      res,
      400,
      { error: "kort" },
      "lang tekst til driften"
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "kort" });
    const row = JSON.parse(sb.mock.calls[0][1].body);
    expect(row.ok).toBe(false);
    expect(row.error).toBe("lang tekst til driften");
  });

  // En tør kørsel laver ikke noget arbejde. Blev den logget som vellykket,
  // ville en manuel forhåndsvisning nulstille fejlserien i admin_job_health()
  // og skjule et job, der reelt er gået i stå.
  it("logger ikke tørre kørsler, men svarer stadig", async () => {
    const sb = vi.fn(async () => null);
    const res = mkRes();
    const run = createRunLogger(sb, "sync-live", { skip: true });

    await run.ok(res, { dryRun: true });
    await run.fail(res, 500, { error: "x" }, "x");

    expect(sb).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
  });

  // Rækkefølgen er ikke til forhandling: på Vercel kan funktionen fryses, så
  // snart svaret er sendt, så en logning bagefter går tabt netop ved en fejl.
  it("skriver rækken FØR svaret sendes", async () => {
    const order = [];
    const sb = vi.fn(async () => {
      order.push("log");
      return null;
    });
    const res = mkRes();
    res.json = () => {
      order.push("svar");
      return res;
    };
    await createRunLogger(sb, "sync-live").ok(res, {});
    expect(order).toEqual(["log", "svar"]);
  });

  // G44: sync-matches kender først sin turnering EFTER autorisationen, men
  // varigheden skal måles fra kørslens start. Derfor et navneskift midtvejs
  // frem for at flytte selve logger-oprettelsen ned.
  it("skriver det omdøbte jobnavn uden at nulstille varigheden", async () => {
    const sb = vi.fn(async () => null);
    const res = mkRes();
    const run = createRunLogger(sb, "sync-matches");
    const start = JSON.parse(JSON.stringify({ t: Date.now() }));
    run.rename("sync-matches:abc");
    await run.ok(res, {});

    const row = JSON.parse(sb.mock.calls[0][1].body);
    expect(row.job).toBe("sync-matches:abc");
    expect(new Date(row.started_at).getTime()).toBeLessThanOrEqual(start.t + 50);
  });

  it("beholder det oprindelige navn, når omdøbningen ikke har noget at give", async () => {
    const sb = vi.fn(async () => null);
    const res = mkRes();
    const run = createRunLogger(sb, "sync-matches");
    run.rename(undefined);
    await run.ok(res, {});
    expect(JSON.parse(sb.mock.calls[0][1].body).job).toBe("sync-matches");
  });
});

// Nøglen er liga-UUID'en og ikke et navne-slug, netop for at overvågningen og
// api/ ikke kan drive fra hinanden: begge ender udleder navnet af den samme
// leagues-række. Formatet fastholdes her, fordi src/lib/ops.js og
// .github/workflows/job-heartbeat.yml bygger den samme streng hver for sig.
describe("syncMatchesJob", () => {
  it("navngiver kørslen efter turneringen", () => {
    expect(syncMatchesJob("11111111-1111-1111-1111-111111111111"))
      .toBe("sync-matches:11111111-1111-1111-1111-111111111111");
  });
});

describe("failJob", () => {
  afterEach(() => vi.restoreAllMocks());

  it("giver kalderen den præcise fejl og driften det fulde stakspor", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = vi.fn(async () => null);
    const res = {
      statusCode: null,
      body: null,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(b) {
        this.body = b;
        return this;
      },
    };
    const e = new Error("Supabase /rest/v1/matches: 500 boom");
    await failJob(createRunLogger(sb, "sync-live"), res, e, "sync-live");

    // Endpointet svarer 401 før nogen fejl kan opstå, så kun cron og admins ser
    // dette — og for admin'en i Admin-skærmen er den præcise tekst hele pointen.
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("Supabase /rest/v1/matches: 500 boom");
    expect(JSON.parse(sb.mock.calls[0][1].body).error).toContain("Error: Supabase");
  });

  it("svarer stadig, når fejlen kom før autorisationen var i hus", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = {
      statusCode: null,
      body: null,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(b) {
        this.body = b;
        return this;
      },
    };
    await failJob(null, res, new Error("miljøvariabel mangler"), "sync-live");
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "miljøvariabel mangler" });
  });
});

// Tidsgrænsen på udgående kald (G19).
//
// Uden den er standarden "vent for evigt", og en HÆNGENDE leverandør — ikke en
// fejlende — stopper hele kørslen, indtil Vercel klipper funktionen over. En
// funktion, der klippes over, når hverken at skrive sin job_runs-række eller at
// rydde op efter sig, så symptomet er tavshed frem for en fejl.
describe("fetchWithTimeout", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sender signalet med, så kaldet kan afbrydes", async () => {
    const spy = vi.fn(async () => ({ ok: true }));
    globalThis.fetch = spy;
    await fetchWithTimeout("https://x.test/a", { method: "POST" }, 50);
    const [, opts] = spy.mock.calls[0];
    expect(opts.method).toBe("POST");
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  // Fejlteksten ender i job_runs.error og skal kunne læses af et menneske et
  // halvt år senere. "This operation was aborted" siger hverken hvilken adresse
  // eller hvor længe — og query-strengen udelades, fordi Sportmonks lægger sin
  // API-nøgle dér.
  it("giver en læsbar fejl uden query-strengen, når svaret udebliver", async () => {
    globalThis.fetch = (url, opts) =>
      new Promise((_, reject) => {
        opts.signal.addEventListener("abort", () => reject(opts.signal.reason));
      });
    await expect(fetchWithTimeout("https://x.test/kampe?api_token=hemmelig", {}, 20))
      .rejects.toThrow(/Tidsgrænse: intet svar fra https:\/\/x\.test\/kampe inden for 20 ms/);
  });

  it("lader andre fejl passere uændret", async () => {
    globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
    await expect(fetchWithTimeout("https://x.test/a", {}, 50)).rejects.toThrow("ECONNREFUSED");
  });
});

// A11: hvilken vej autorisationen kom ind, skal kunne aflæses i driftsloggen.
//
// `isAuthorized()` har altid vidst det, men værdien blev kasseret, så det
// eneste spor var en advarsel i Vercels logs. Beslutningen om at fjerne
// `?secret=`-fallbacken afhang dermed af, at nogen huskede at kigge et sted
// uden for appen — og af at kunne skelne "ingen advarsler" fra "ingen kørsler".
describe("createRunLogger.setAuth", () => {
  const mkRes = () => {
    const res = { statusCode: null, body: null,
      status(c) { res.statusCode = c; return res; },
      json(b) { res.body = b; return res; } };
    return res;
  };

  it("lægger autorisationsvejen i detaljen", async () => {
    const sb = vi.fn(async () => null);
    const res = mkRes();
    const run = createRunLogger(sb, "sync-live");
    run.setAuth("header");
    await run.ok(res, { written: 2 });

    expect(JSON.parse(sb.mock.calls[0][1].body).detail).toEqual({ written: 2, authVia: "header" });
  });

  // Detaljen er til driftsloggen, svaret er til kalderen. De to skal ikke
  // vokse sammen — cron-jobbet har ingen brug for at få at vide, hvordan det
  // selv kaldte ind.
  it("ændrer ikke det, kalderen får at se", async () => {
    const sb = vi.fn(async () => null);
    const res = mkRes();
    const run = createRunLogger(sb, "sync-live");
    run.setAuth("query");
    await run.ok(res, { written: 2 });
    expect(res.body).toEqual({ written: 2 });
  });

  // En FEJLET kørsel er lige så interessant for A11: kaldte jobbet forkert OG
  // fejlede, skal begge dele kunne ses på samme række.
  it("gælder også fejlede kørsler", async () => {
    const sb = vi.fn(async () => null);
    const res = mkRes();
    const run = createRunLogger(sb, "sync-matches");
    run.setAuth("query");
    await run.fail(res, 500, { error: "kort" }, "lang");
    const row = JSON.parse(sb.mock.calls[0][1].body);
    expect(row.detail).toEqual({ error: "kort", authVia: "query" });
    expect(row.ok).toBe(false);
  });

  it("skriver intet felt, når vejen er ukendt", async () => {
    const sb = vi.fn(async () => null);
    const res = mkRes();
    await createRunLogger(sb, "sync-live").ok(res, { written: 1 });
    expect(JSON.parse(sb.mock.calls[0][1].body).detail).toEqual({ written: 1 });
  });
});

// A46: hvilket værtsnavn kaldte jobbet ind på? `docs/CRON.md` skrev `<app>` som
// pladsholder, fordi svaret lå i cron-job.org-kontoen — og efter domæneflytningen
// kan det være enten den gamle `.vercel.app`-adresse eller `app.leagly.app`,
// uden at forskellen kan ses noget sted (`/api/` er undtaget fra redirectet).
// Samme fejlklasse som A11: svaret stod i kaldet, det blev bare kasseret.
describe("requestHost", () => {
  it("læser x-forwarded-host før host", () => {
    expect(requestHost({ headers: { "x-forwarded-host": "app.leagly.app", host: "internt" } })).toBe(
      "app.leagly.app"
    );
  });

  it("falder tilbage på host", () => {
    expect(requestHost({ headers: { host: "prediction-champ.vercel.app" } })).toBe(
      "prediction-champ.vercel.app"
    );
  });

  // En proxykæde kan lægge flere værdier i feltet. Den første er den, kalderen
  // selv skrev — resten er tilføjet undervejs og svarer på et andet spørgsmål.
  it("tager den FØRSTE værdi, når feltet er en kæde", () => {
    expect(requestHost({ headers: { "x-forwarded-host": "app.leagly.app, proxy.intern" } })).toBe(
      "app.leagly.app"
    );
  });

  // Må aldrig kaste: den kaldes fra logningen, som per kontrakt ikke må kunne
  // vælte det job, den overvåger.
  it("svarer null frem for at kaste, når der intet værtsnavn er", () => {
    expect(requestHost({ headers: {} })).toBeNull();
    expect(requestHost({})).toBeNull();
    expect(requestHost(undefined)).toBeNull();
    expect(requestHost({ headers: { host: "" } })).toBeNull();
  });
});

describe("createRunLogger.setHost", () => {
  const mkRes = () => {
    const res = { statusCode: null, body: null,
      status(c) { res.statusCode = c; return res; },
      json(b) { res.body = b; return res; } };
    return res;
  };

  it("lægger værtsnavnet i detaljen ved siden af autorisationsvejen", async () => {
    const sb = vi.fn(async () => null);
    const res = mkRes();
    const run = createRunLogger(sb, "sync-live");
    run.setAuth("header");
    run.setHost({ headers: { host: "prediction-champ.vercel.app" } });
    await run.ok(res, { written: 2 });

    expect(JSON.parse(sb.mock.calls[0][1].body).detail).toEqual({
      written: 2,
      authVia: "header",
      host: "prediction-champ.vercel.app",
    });
  });

  // Samme skel som A11: detaljen er til driftsloggen, svaret er til kalderen.
  // Cron-jobbet ved i forvejen, hvilken adresse det selv skrev.
  it("ændrer ikke det, kalderen får at se", async () => {
    const sb = vi.fn(async () => null);
    const res = mkRes();
    const run = createRunLogger(sb, "sync-live");
    run.setHost({ headers: { host: "app.leagly.app" } });
    await run.ok(res, { written: 2 });
    expect(res.body).toEqual({ written: 2 });
  });

  // Et job, der kalder den gamle adresse OG fejler, skal kunne ses på samme
  // række — ellers skal to opslag holdes op mod hinanden for at se sammenhængen.
  it("gælder også fejlede kørsler", async () => {
    const sb = vi.fn(async () => null);
    const res = mkRes();
    const run = createRunLogger(sb, "sync-matches");
    run.setHost({ headers: { host: "prediction-champ-predictor-champ.vercel.app" } });
    await run.fail(res, 500, { error: "kort" }, "lang");
    const row = JSON.parse(sb.mock.calls[0][1].body);
    expect(row.detail).toEqual({
      error: "kort",
      host: "prediction-champ-predictor-champ.vercel.app",
    });
    expect(row.ok).toBe(false);
  });

  it("skriver intet felt, når værtsnavnet er ukendt", async () => {
    const sb = vi.fn(async () => null);
    const res = mkRes();
    const run = createRunLogger(sb, "sync-live");
    run.setHost({ headers: {} });
    await run.ok(res, { written: 1 });
    expect(JSON.parse(sb.mock.calls[0][1].body).detail).toEqual({ written: 1 });
  });
});

// G42: hvilken kode kørte? Uden svaret kan en række i job_runs ikke kobles til
// et deploy — og netop dét spørgsmål kostede `B8` tre merges, fordi det, der
// kørte i produktion, var to versioner ældre end `main`, uden at nogen kunne se
// det. Stemplet er tomt lokalt (ingen VERCEL_GIT_COMMIT_SHA), så testen her
// pinner den ene invariant, der gælder begge veje.
describe("createRunLogger — versionsstempel", () => {
  const mkRes = () => {
    const res = { statusCode: null, body: null,
      status(c) { res.statusCode = c; return res; },
      json(b) { res.body = b; return res; } };
    return res;
  };

  it("lader svaret gå uændret videre, når der intet er at tilføje", async () => {
    const sb = vi.fn(async () => null);
    const res = mkRes();
    const body = { written: 1 };
    await createRunLogger(sb, "sync-live").ok(res, body);
    // Ikke bare "ens" — SAMME objekt. `{...null}` ville ellers gøre et tomt
    // resumé til `{}`, og de to ser ens ud i driftsloggen uden at være det.
    expect(res.body).toBe(body);
    expect(JSON.parse(sb.mock.calls[0][1].body).detail).toEqual({ written: 1 });
  });
});

// G18: `leagueId` kommer fra query-strengen og interpoleres i PostgREST-URL'er,
// der kaldes med SERVICE-NØGLEN — altså uden om RLS. Det er ikke SQL-injektion,
// men en kaldende med sync-hemmeligheden kunne føje ekstra PostgREST-parametre
// til og dermed omforme forespørgslen. Formatet er den rigtige kontrol: kolonnen
// ER en uuid, så alt andet er alligevel en fejl.
describe("isUuid", () => {
  it("godkender et rigtigt uuid, uanset store og små bogstaver", () => {
    expect(isUuid("11111111-2222-3333-4444-555555555555")).toBe(true);
    expect(isUuid("A1B2C3D4-E5F6-7890-ABCD-EF1234567890")).toBe(true);
  });

  // Netop de former, der ville kunne føje en parameter til URL'en.
  it("afviser en værdi med noget hængende bagefter", () => {
    expect(isUuid("11111111-2222-3333-4444-555555555555&limit=1")).toBe(false);
    expect(isUuid("11111111-2222-3333-4444-555555555555&order=id.desc")).toBe(false);
    expect(isUuid("*")).toBe(false);
  });

  it("afviser tomt, forkert længde og ikke-tekst", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("1111-2222")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(12345)).toBe(false);
  });
});
