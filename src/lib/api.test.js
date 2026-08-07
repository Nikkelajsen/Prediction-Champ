import { describe, it, expect, vi, afterEach } from "vitest";
import { apiFetch, ikkeJsonBesked, NAAEDE_IKKE_SERVEREN } from "./api.js";

const ORIGINAL = globalThis.fetch;
afterEach(() => { globalThis.fetch = ORIGINAL; vi.restoreAllMocks(); });

function stub(svar) {
  globalThis.fetch = vi.fn(async () => {
    if (svar instanceof Error) throw svar;
    return svar;
  });
}
const res = (body, { ok = true, status = 200, type = "application/json" } = {}) => ({
  ok, status,
  headers: new Headers(type ? { "content-type": type } : {}),
  json: async () => { if (body === "ugyldig") throw new SyntaxError("bad json"); return body; },
});

describe("apiFetch", () => {
  it("giver både svaret og den parsede krop", async () => {
    stub(res({ ok: true, synced: 3 }));
    const { res: r, data } = await apiFetch("/api/sync-matches");
    expect(r.status).toBe(200);
    expect(data.synced).toBe(3);
  });

  // Et 4xx/5xx med en JSON-krop er endpointets EGET svar og skal nå frem til
  // kaldestedet — det er dér, serverens `error`/`kode` bliver til en sætning.
  it("kaster ikke på en fejlstatus med JSON — den hører til kaldestedet", async () => {
    stub(res({ ok: false, error: "Din session er udløbet." }, { ok: false, status: 401 }));
    const { res: r, data } = await apiFetch("/api/delete-account");
    expect(r.ok).toBe(false);
    expect(data.error).toMatch(/udløbet/);
  });

  it("giver data = null ved tom eller ugyldig JSON-krop", async () => {
    stub(res("ugyldig"));
    const { data } = await apiFetch("/api/delete-account");
    expect(data).toBe(null);
  });

  it("oversætter et netværkssvigt til én sætning", async () => {
    stub(new TypeError("Failed to fetch"));
    await expect(apiFetch("/api/delete-account")).rejects.toThrow(NAAEDE_IKKE_SERVEREN);
  });

  // KERNEN I G80. Udviklingsserveren svarer index.html med status **200** på
  // enhver ukendt sti — `res.ok` er sand, og først `json()` fejler. Uden dette
  // tjek endte den ene observation som tre forskellige løgne i fem kaldesteder.
  it("kaster på et HTML-svar, selv når status er 200", async () => {
    stub(res(null, { type: "text/html; charset=utf-8" }));
    await expect(apiFetch("/api/send-notifications")).rejects.toThrow(/index\.html|findes ikke/);
  });

  it("kaster også, når svaret slet ingen content-type har", async () => {
    stub(res(null, { type: "" }));
    await expect(apiFetch("/api/sync-matches")).rejects.toThrow();
  });
});

// Beskeden afhænger af miljøet, fordi den samme observation har to årsager.
// Testes gennem den rene funktion frem for ved at forfalske import.meta.env:
// begge grene skal kunne læses, og kun den ene kører under Vitest.
describe("ikkeJsonBesked", () => {
  it("peger på vercel dev i udvikling", () => {
    const m = ikkeJsonBesked(200, true);
    expect(m).toMatch(/npm run dev/);
    expect(m).toMatch(/vercel dev/);
  });

  // "Kør vercel dev" ville være et vildledende råd i produktion: dér findes
  // funktionen, og en HTML-side kommer fra platformen foran den.
  it("nævner statuskoden og IKKE vercel dev i produktion", () => {
    const m = ikkeJsonBesked(502, false);
    expect(m).toMatch(/502/);
    expect(m).not.toMatch(/vercel dev/);
  });
});
