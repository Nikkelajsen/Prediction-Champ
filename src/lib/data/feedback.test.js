import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KINDS, MESSAGE_MAX, collectContext, sendFeedback } from "./feedback.js";

// Klientens validering er den FØRSTE af to. Den anden er check-constrainten i
// sql/feedback.sql, som er den, der gælder — men uden denne får brugeren en
// PostgREST-fejl på engelsk i stedet for en dansk sætning. Testene her
// fastholder derfor, at grænserne er de samme to steder.

const original = globalThis.fetch;

function stubFetch() {
  const kald = [];
  globalThis.fetch = vi.fn(async (url, opts) => {
    kald.push({ url: String(url), opts });
    return { ok: true, status: 204, text: async () => "", json: async () => null };
  });
  return kald;
}

beforeEach(() => { globalThis.fetch = original; });
afterEach(() => { globalThis.fetch = original; vi.restoreAllMocks(); });

describe("sendFeedback", () => {
  it("afviser en for kort besked, før der sendes noget", async () => {
    const kald = stubFetch();
    await expect(sendFeedback("t", { kind: "problem", message: "hej" })).rejects.toThrow(/Skriv lidt mere/);
    expect(kald).toHaveLength(0);
  });

  it("tæller på den TRIMMEDE tekst — mellemrum er ikke en melding", async () => {
    const kald = stubFetch();
    await expect(sendFeedback("t", { kind: "problem", message: "  a  " })).rejects.toThrow(/Skriv lidt mere/);
    expect(kald).toHaveLength(0);
  });

  it("afviser en for lang besked", async () => {
    stubFetch();
    await expect(sendFeedback("t", { kind: "idea", message: "x".repeat(MESSAGE_MAX + 1) }))
      .rejects.toThrow(/højst fylde 2000 tegn/);
  });

  it("afviser en ukendt type — ordforrådet skal være det samme som constraintens", async () => {
    stubFetch();
    await expect(sendFeedback("t", { kind: "spørgsmål", message: "En fjerde slags" }))
      .rejects.toThrow(/Vælg hvad meldingen handler om/);
  });

  it("sender aldrig user_id med — defaulten i databasen ejer feltet", async () => {
    const kald = stubFetch();
    await sendFeedback("token", { kind: "problem", message: "Push virker ikke", screen: "how" });
    expect(kald).toHaveLength(1);
    const body = JSON.parse(kald[0].opts.body);
    expect(Object.keys(body[0])).toEqual(["kind", "message", "context"]);
  });

  it("beder om return=minimal — tabellen har ingen select-policy", async () => {
    const kald = stubFetch();
    await sendFeedback("token", { kind: "other", message: "En melding" });
    expect(kald[0].opts.headers.Prefer).toBe("return=minimal");
  });

  it("trimmer beskeden, før den sendes", async () => {
    const kald = stubFetch();
    await sendFeedback("token", { kind: "idea", message: "   Et forslag   " });
    expect(JSON.parse(kald[0].opts.body)[0].message).toBe("Et forslag");
  });
});

describe("collectContext", () => {
  // Hele værdien af context er, at brugeren ikke skal huske noget. Falder et
  // af felterne ud, kan en melding ikke følges op — og det ville ikke kunne
  // ses på skærmen.
  it("bærer version, skærm og browser", () => {
    const c = collectContext({ screen: "how" });
    expect(c.version).toBeTruthy();
    expect(c.screen).toBe("how");
    expect("userAgent" in c).toBe(true);
  });

  it("udelader skærm frem for at skrive null, når den ikke er kendt", () => {
    expect("screen" in collectContext({})).toBe(false);
  });
});

describe("KINDS", () => {
  // Listen er ordforrådet i feedback_kind_check. Kommer der en fjerde til her
  // uden en migrering, afvises hver eneste melding af den type.
  it("er præcis de tre, constrainten kender", () => {
    expect(KINDS.map((k) => k.key)).toEqual(["problem", "idea", "other"]);
  });
});
