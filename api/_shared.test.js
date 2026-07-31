// Tests for api/_shared.js.
//
// api/ havde indtil nu ingen testdækning overhovedet. Autorisationen er
// samtidig det sted, hvor BACKLOG A11 skal skære (`?secret=`-fallbacken
// fjernes), så det er præcis den kode, der har brug for et net under sig
// FØR den ændres — ikke efter.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSb,
  secretsMatch,
  isAuthorized,
  recordRun,
  createRunLogger,
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

  it("godkender ?secret=-fallbacken, men råber op om den (A11)", async () => {
    const r = await isAuthorized(reqWith({ query: { secret: SECRET } }), deps());
    expect(r).toEqual({ ok: true, via: "query" });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("[A11]");
  });

  // Bevaret adfærd fra før udtrækningen: `header || query` betyder, at en
  // TILSTEDE men forkert header blokerer fallbacken. Dokumenteret her, så
  // ingen "retter" den ved et uheld.
  it("lader en forkert header blokere query-fallbacken", async () => {
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
