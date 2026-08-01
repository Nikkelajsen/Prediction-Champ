import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "./supabase.js";

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
