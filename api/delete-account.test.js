import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "./delete-account.js";

// Endpointet har ingen rene hjælpefunktioner at teste — hele værdien ligger i
// FORLØBET: hvem der spørges med hvilken nøgle, i hvilken rækkefølge, og hvad
// der sker, når trin 3 fejler efter at trin 2 er lykkedes. Derfor et lille
// mock-apparat frem for ingen test.

const ORIGINAL_FETCH = globalThis.fetch;
const BRUGER = { id: "11111111-1111-1111-1111-111111111111" };

function svar(ok, body = {}, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

// `ruter` er en liste af [mønster, svar] i den rækkefølge, de forventes kaldt.
function mockFetch(ruter) {
  const kald = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    kald.push({ url: u, method: opts.method ?? "GET", headers: opts.headers ?? {}, body: opts.body });
    for (const [mønster, res] of ruter) if (u.includes(mønster)) return res;
    throw new Error(`uventet kald: ${u}`);
  });
  return kald;
}

function svarObjekt() {
  const ud = {};
  return {
    ud,
    status(k) { ud.status = k; return this; },
    json(b) { ud.body = b; return this; },
  };
}

const req = (over = {}) => ({ method: "POST", headers: {}, ...over });

beforeEach(() => {
  process.env.SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-nøgle";
});
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe("adgang", () => {
  it("afviser alt andet end POST", async () => {
    const res = svarObjekt();
    await handler(req({ method: "GET" }), res);
    expect(res.ud.status).toBe(405);
  });

  it("afviser en kaldende uden token", async () => {
    const res = svarObjekt();
    await handler(req(), res);
    expect(res.ud.status).toBe(401);
  });

  it("afviser en token, GoTrue ikke godtager", async () => {
    mockFetch([["/auth/v1/user", svar(false, {}, 401)]]);
    const res = svarObjekt();
    await handler(req({ headers: { authorization: "Bearer gammel" } }), res);
    expect(res.ud.status).toBe(401);
  });

  // Hele adgangsgarantien: id'et kommer fra tokenen og INTET andet sted.
  // Et felt i body må ikke kunne pege på en anden konto.
  it("ignorerer et bruger-id i body fuldstændigt", async () => {
    const kald = mockFetch([
      ["/auth/v1/user", svar(true, BRUGER)],
      ["/rpc/anonymize_my_account", svar(true, "Slettet 11111111")],
      ["/auth/v1/admin/users/", svar(true)],
    ]);
    const res = svarObjekt();
    await handler(
      req({ headers: { authorization: "Bearer min" }, body: { user_id: "99999999-9999-9999-9999-999999999999" } }),
      res
    );
    expect(res.ud.status).toBe(200);
    const admin = kald.find((k) => k.url.includes("/auth/v1/admin/users/"));
    expect(admin.url).toContain(BRUGER.id);
    expect(admin.url).not.toContain("99999999");
  });
});

describe("forløbet", () => {
  it("anonymiserer FØR kontoen lukkes", async () => {
    const kald = mockFetch([
      ["/auth/v1/user", svar(true, BRUGER)],
      ["/rpc/anonymize_my_account", svar(true, "Slettet 11111111")],
      ["/auth/v1/admin/users/", svar(true)],
    ]);
    const res = svarObjekt();
    await handler(req({ headers: { authorization: "Bearer min" } }), res);

    expect(res.ud.body).toEqual({ ok: true });
    const rækkefølge = kald.map((k) => k.url.replace("https://x.supabase.co", ""));
    expect(rækkefølge[0]).toContain("/auth/v1/user");
    expect(rækkefølge[1]).toContain("anonymize_my_account");
    expect(rækkefølge[2]).toContain("/auth/v1/admin/users/");
  });

  // RPC'en skal køre som BRUGEREN, så funktionens auth.uid()-vagt stadig er
  // den, der bestemmer. Kørte den som service_role, ville vagten være
  // virkningsløs, og en fejl i endpointet kunne ramme en vilkårlig konto.
  it("kalder RPC'en med brugerens token og admin-API'et med service-nøglen", async () => {
    const kald = mockFetch([
      ["/auth/v1/user", svar(true, BRUGER)],
      ["/rpc/anonymize_my_account", svar(true, "Slettet 11111111")],
      ["/auth/v1/admin/users/", svar(true)],
    ]);
    await handler(req({ headers: { authorization: "Bearer min-token" } }), svarObjekt());

    const rpc = kald.find((k) => k.url.includes("anonymize_my_account"));
    expect(rpc.headers.Authorization).toBe("Bearer min-token");
    const admin = kald.find((k) => k.url.includes("/auth/v1/admin/users/"));
    expect(admin.headers.Authorization).toBe("Bearer service-nøgle");
  });

  // En HÅRD sletning ville kaskadere gennem profiles og tage tips, rating og
  // brugerens ligaer med sig — altså præcis dét, anonymiseringen lige har
  // bevaret. Flaget er derfor ikke en detalje.
  it("lukker kontoen blødt, så kaskaden ikke udløses", async () => {
    const kald = mockFetch([
      ["/auth/v1/user", svar(true, BRUGER)],
      ["/rpc/anonymize_my_account", svar(true, "Slettet 11111111")],
      ["/auth/v1/admin/users/", svar(true)],
    ]);
    await handler(req({ headers: { authorization: "Bearer min" } }), svarObjekt());
    const admin = kald.find((k) => k.url.includes("/auth/v1/admin/users/"));
    expect(admin.method).toBe("DELETE");
    expect(JSON.parse(admin.body)).toEqual({ should_soft_delete: true });
  });
});

describe("den halve tilstand", () => {
  // Data er anonymiseret, kontoen er stadig åben. Brugeren skal vide, at deres
  // data ER væk — en generisk fejl ville få dem til at tro, intet var sket.
  it("melder kun_anonymiseret, når lukningen fejler efter anonymiseringen", async () => {
    mockFetch([
      ["/auth/v1/user", svar(true, BRUGER)],
      ["/rpc/anonymize_my_account", svar(true, "Slettet 11111111")],
      ["/auth/v1/admin/users/", svar(false, { msg: "nej" }, 500)],
    ]);
    const res = svarObjekt();
    await handler(req({ headers: { authorization: "Bearer min" } }), res);
    expect(res.ud.status).toBe(500);
    expect(res.ud.body).toEqual({ ok: false, kode: "kun_anonymiseret" });
  });

  it("lukker ikke kontoen, hvis anonymiseringen fejlede", async () => {
    const kald = mockFetch([
      ["/auth/v1/user", svar(true, BRUGER)],
      ["/rpc/anonymize_my_account", svar(false, { message: "nej" }, 500)],
    ]);
    const res = svarObjekt();
    await handler(req({ headers: { authorization: "Bearer min" } }), res);
    expect(res.ud.status).toBe(500);
    expect(res.ud.body.kode).toBeUndefined();
    expect(kald.some((k) => k.url.includes("/auth/v1/admin/users/"))).toBe(false);
  });
});

describe("opsætning", () => {
  it("navngiver ikke miljøvariabler i svaret", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = svarObjekt();
    await handler(req({ headers: { authorization: "Bearer min" } }), res);
    expect(res.ud.status).toBe(500);
    expect(JSON.stringify(res.ud.body)).not.toContain("SUPABASE");
  });
});
