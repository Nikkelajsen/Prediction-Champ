import { describe, it, expect, vi, afterEach } from "vitest";
import { deleteMyAccount, KUN_ANONYMISERET } from "./account.js";
import { LOKALE_NØGLER } from "../supabase.js";

const ORIGINAL = globalThis.fetch;

function stub(res) {
  const kald = [];
  globalThis.fetch = vi.fn(async (url, opts) => {
    kald.push({ url: String(url), opts });
    if (res instanceof Error) throw res;
    return res;
  });
  return kald;
}
const svar = (ok, body, status = ok ? 200 : 500) => ({ ok, status, json: async () => body });

afterEach(() => { globalThis.fetch = ORIGINAL; vi.restoreAllMocks(); });

describe("deleteMyAccount", () => {
  it("sender kun sin token — der er intet bruger-id at forfalske", async () => {
    const kald = stub(svar(true, { ok: true }));
    await deleteMyAccount("min-token");
    expect(kald).toHaveLength(1);
    expect(kald[0].url).toBe("/api/delete-account");
    expect(kald[0].opts.method).toBe("POST");
    expect(kald[0].opts.headers.Authorization).toBe("Bearer min-token");
    expect(kald[0].opts.body).toBeUndefined();
  });

  // Den halve tilstand skal have sin egen sætning. En generisk fejl ville få
  // brugeren til at tro, at intet var sket — og de ville skrive til supporten
  // om noget, der allerede er udført.
  it("oversætter kun_anonymiseret til en sætning, der siger hvad der ER sket", async () => {
    stub(svar(false, { ok: false, kode: "kun_anonymiseret" }));
    await expect(deleteMyAccount("t")).rejects.toThrow(KUN_ANONYMISERET);
    expect(KUN_ANONYMISERET).toContain("er fjernet");
  });

  it("viderebringer serverens egen fejltekst", async () => {
    stub(svar(false, { ok: false, error: "Din session er udløbet. Log ind igen." }, 401));
    await expect(deleteMyAccount("t")).rejects.toThrow(/session er udløbet/);
  });

  it("siger det, når serveren slet ikke kunne nås", async () => {
    stub(new Error("netværk"));
    await expect(deleteMyAccount("t")).rejects.toThrow(/Kunne ikke nå serveren/);
  });

  // Fejl må ALDRIG svælges her, modsat analytics og kåringer. En bruger, der
  // tror kontoen er lukket, mens den ikke er, er værre stillet end en, der får
  // en fejl at se.
  it("kaster også, når svaret er 200 uden ok", async () => {
    stub(svar(true, { ok: false }));
    await expect(deleteMyAccount("t")).rejects.toThrow();
  });
});

describe("den lokale oprydning", () => {
  // Listen i supabase.js og opremsningen i privatlivspolitikken beskriver det
  // samme. Kommer der en ny nøgle, og glemmes den her, følger den den NÆSTE
  // bruger på samme telefon.
  it("dækker hver pc_-nøgle, appen skriver", () => {
    for (const n of [
      "pc_session", "pc_last_ping", "pc_onboarding_v1_flow", "pc_onboarding_v1_card",
      "pc_onboarding_v1_complete", "pc_push_dismissed", "pc_liga_nudge_dismissed",
      "pc_season_league", "pc_pwa_onboarded", "pc_comp_done_seen",
    ]) {
      expect(LOKALE_NØGLER).toContain(n);
    }
  });
});
