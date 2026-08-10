import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { auth, db, fejltekst } from "./supabase.js";

// Fanger den ene ting, `select` ikke kunne: et tal, der er større end det antal
// rækker PostgREST vil levere i ét svar. Regressionen bag "Premier League ·
// 0 kampe" var netop dét — der blev talt rækker i et svar, der var klippet ved
// 1000, og turneringerne bag klippet blev talt som nul.
describe("db.count", () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); });

  function respond({ ok = true, range = "0-0/1760", status = 200 } = {}) {
    globalThis.fetch.mockResolvedValue({
      ok, status, statusText: "OK",
      headers: { get: (h) => (h.toLowerCase() === "content-range" ? range : null) },
      json: async () => ({ message: "boom" }),
    });
  }

  it("læser totalen fra Content-Range i stedet for at tælle rækker", async () => {
    respond({ range: "0-0/1760" });
    expect(await db.count("tok", "matches", "season_id=eq.s1")).toBe(1760);
  });

  it("beder om tallet uden rækkerne (count=exact + limit=0)", async () => {
    respond();
    await db.count("tok", "matches", "season_id=eq.s1");
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("/rest/v1/matches?season_id=eq.s1&limit=0");
    expect(opts.headers.Prefer).toBe("count=exact");
    expect(opts.headers.Authorization).toBe("Bearer tok");
  });

  it("undgår dobbelt & når forespørgslen er tom", async () => {
    respond();
    await db.count("tok", "matches");
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/rest/v1/matches?limit=0");
  });

  it("giver 0 — ikke NaN — når Content-Range mangler", async () => {
    respond({ range: null });
    expect(await db.count("tok", "matches", "season_id=eq.s1")).toBe(0);
  });

  it("kaster ved fejlsvar, så en tom turnering ikke forveksles med en fejl", async () => {
    respond({ ok: false, status: 400 });
    await expect(db.count("tok", "matches", "season_id=eq.s1")).rejects.toThrow("boom");
  });
});

// Fejlen skal bære sin HTTP-status videre (G26).
//
// Uden den kan en udløbet session ikke skelnes fra et netværkshul, og de to må
// ikke føre til det samme: den ene skal logge brugeren ud, den anden skal
// prøve igen. Før august 2026 kastede begge helpers et bart Error med en tekst.
describe("restFetch/restCount — fejlens status", () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const fejl = (status, body) => globalThis.fetch.mockResolvedValue({
    ok: false, status, statusText: "Unauthorized",
    headers: { get: () => null },
    json: async () => (body ?? { message: "JWT expired" }),
  });

  it("sætter status på fejlen fra et REST-kald", async () => {
    fejl(401);
    await expect(db.select("tok", "matches")).rejects.toMatchObject({ status: 401, message: "JWT expired" });
  });

  // Hele vejen igennem, og ikke kun i `fejltekst()`: det var dén sti, der var
  // brudt. GoTrues krop plus en tom statusText — som er, hvad HTTP/2 giver.
  it("bærer GoTrues `msg` helt ud til kalderen, også når statusText er tom", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false, status: 400, statusText: "",
      headers: { get: () => null },
      json: async () => ({ code: 400, error_code: "validation_failed", msg: "captcha protection: request disallowed" }),
    });
    await expect(db.select("tok", "matches")).rejects.toMatchObject({
      status: 400, message: "captcha protection: request disallowed",
    });
  });

  it("sætter status på fejlen fra et tælle-kald", async () => {
    fejl(403);
    await expect(db.count("tok", "matches")).rejects.toMatchObject({ status: 403 });
  });

  // Alle eksisterende catch-blokke læser `e.message`; en fejl uden JSON-krop må
  // derfor stadig give en læselig tekst.
  it("falder tilbage til statusText, når kroppen ikke er JSON", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false, status: 500, statusText: "Internal Server Error",
      headers: { get: () => null },
      json: async () => { throw new Error("ikke JSON"); },
    });
    await expect(db.select("tok", "matches")).rejects.toMatchObject({
      status: 500, message: "Internal Server Error",
    });
  });
});

// Fejlteksten skal findes, uanset hvilken server der svarer (10. august 2026).
//
// Regressionen er dyrt betalt: vi læste kun `message`, men GoTrue svarer `msg`,
// og `res.statusText` er TOM over HTTP/2. Hver eneste auth-fejl endte derfor
// som en fejl uden tekst, og skærmen viste "Noget gik galt" — også når kroppen
// indeholdt et præcist svar. To helt forskellige fejl så ens ud på skærmen
// under `B26`s første kørsel, og det var dét, der gjorde den blind.
describe("fejltekst — de to servere staver det forskelligt", () => {
  it("læser PostgRESTs `message`", () => {
    expect(fejltekst({ message: "duplicate key" })).toBe("duplicate key");
  });

  // DEN VIGTIGE. Uden denne linje kan ingen af oversættelserne i AUTH_FEJL
  // nogensinde ramme en auth-fejl.
  it("læser GoTrues `msg`", () => {
    expect(fejltekst({ code: 400, error_code: "validation_failed", msg: "Email not confirmed" }))
      .toBe("Email not confirmed");
  });

  it("læser token-endpointets `error_description`", () => {
    expect(fejltekst({ error: "invalid_grant", error_description: "Invalid login credentials" }))
      .toBe("Invalid login credentials");
  });

  // En kode er dårligere end en sætning og bedre end ingenting.
  it("falder tilbage på `error`, når den er en streng", () => {
    expect(fejltekst({ error: "invalid_grant" })).toBe("invalid_grant");
  });

  // `error` er et objekt på nogle svar. "[object Object]" på skærmen er værre
  // end den tomme streng, der lader kalderen vælge sin egen fallback.
  it("bruger ikke `error`, når den ikke er en streng", () => {
    expect(fejltekst({ error: { code: 400 } })).toBe("");
  });

  it("svarer tomt på en krop, der intet siger", () => {
    expect(fejltekst({})).toBe("");
    expect(fejltekst(null)).toBe("");
    expect(fejltekst("ikke et objekt")).toBe("");
  });
});

// Bot-værnet og brugernavnet gennem mailen (B26).
//
// Begge dele er FORMEN på en HTTP-krop, og formen er det eneste, der kan
// efterprøves herfra — GoTrue ligger uden for repoet. Til gengæld er det
// præcis dér, fejlen ville ligge: `gotrue_meta_security` er GoTrues eget
// feltnavn, og et forkert stavet felt fejler ikke, det ignoreres bare. Slås
// Bot Protection så til i Supabase, afviser serveren hvert eneste login,
// oprettelse og nulstilling — altså hele adgangen til appen.
describe("auth — captcha og brugernavn i kroppen", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: "OK",
      headers: { get: () => null },
      text: async () => JSON.stringify({ access_token: "a" }),
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const krop = () => JSON.parse(globalThis.fetch.mock.calls[0][1].body);

  it("sender kvitteringen i GoTrues eget felt ved oprettelse", async () => {
    await auth.signUp("a@b.dk", "hemmelig", { captchaToken: "kv1", displayName: "Anna" });
    expect(krop()).toEqual({
      email: "a@b.dk", password: "hemmelig",
      data: { display_name: "Anna" },
      gotrue_meta_security: { captcha_token: "kv1" },
    });
  });

  it("sender den også ved login og nulstilling — Bot Protection dækker alle tre", async () => {
    await auth.signIn("a@b.dk", "hemmelig", "kv2");
    expect(krop()).toEqual({
      email: "a@b.dk", password: "hemmelig",
      gotrue_meta_security: { captcha_token: "kv2" },
    });

    globalThis.fetch.mockClear();
    await auth.recover("a@b.dk", "kv3");
    expect(krop()).toEqual({ email: "a@b.dk", gotrue_meta_security: { captcha_token: "kv3" } });
  });

  // Det er DENNE, der gør, at koden kan ligge i produktionen længe før nogen
  // trykker på knappen i Supabase: uden nøgle sendes intet ekstra felt, og
  // kaldene ser ud præcis som før `B26`.
  it("udelader feltet helt, når værnet ikke er slået til", async () => {
    await auth.signIn("a@b.dk", "hemmelig");
    expect(krop()).toEqual({ email: "a@b.dk", password: "hemmelig" });

    globalThis.fetch.mockClear();
    await auth.signUp("a@b.dk", "hemmelig");
    expect(krop()).toEqual({ email: "a@b.dk", password: "hemmelig" });
  });

  // Brugernavnet er det eneste, der ikke kan skrives, når signup svarer uden
  // session. Metadataen er dets eneste vej over på den anden side af mailen.
  it("lægger brugernavnet i metadata, så det overlever bekræftelses-mailen", async () => {
    await auth.signUp("a@b.dk", "hemmelig", { displayName: "Anna" });
    expect(krop().data).toEqual({ display_name: "Anna" });
  });
});
