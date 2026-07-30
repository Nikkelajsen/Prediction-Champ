import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./supabase.js", () => ({ restFetch: vi.fn() }));
import { restFetch } from "./supabase.js";
import { logEvent, logEventOnce, healthTone } from "./analytics.js";

beforeEach(() => {
  restFetch.mockReset();
  restFetch.mockResolvedValue(null);
});

describe("logEvent — kontrakt: intet kaster, intet afventes, intet blokerer", () => {
  it("poster til /rest/v1/analytics_events med return=minimal og et array-body", () => {
    logEvent("tok", "league_created", { groupId: "g1" });
    expect(restFetch).toHaveBeenCalledTimes(1);
    const [path, opts] = restFetch.mock.calls[0];
    expect(path).toBe("/rest/v1/analytics_events");
    expect(opts.method).toBe("POST");
    expect(opts.token).toBe("tok");
    expect(opts.prefer).toBe("return=minimal");
    expect(Array.isArray(opts.body)).toBe(true);
    expect(opts.body).toHaveLength(1);
  });

  it("sender ALDRIG en user_id-nøgle — kolonnens default (auth.uid()) ejer den", () => {
    logEvent("tok", "league_created", { groupId: "g1" });
    const row = restFetch.mock.calls[0][1].body[0];
    expect(row).not.toHaveProperty("user_id");
  });

  it("returnerer undefined — aldrig et promise (fire-and-forget må ikke kunne awaites ved en fejl)", () => {
    const result = logEvent("tok", "league_created", {});
    expect(result).toBeUndefined();
  });

  it("kaster aldrig videre, selv når restFetch afviser (ingen unhandled rejection)", async () => {
    restFetch.mockRejectedValueOnce(new Error("network down"));
    expect(() => logEvent("tok", "league_created", {})).not.toThrow();
    await Promise.resolve(); // lad .catch(() => {}) nå at køre
    await new Promise((r) => setTimeout(r, 0));
  });

  it("kalder ikke restFetch uden token", () => {
    logEvent(null, "league_created", {});
    expect(restFetch).not.toHaveBeenCalled();
  });

  it("kalder ikke restFetch uden event-navn", () => {
    logEvent("tok", null, {});
    expect(restFetch).not.toHaveBeenCalled();
  });

  it("serialiserer manglende groupId/competitionId/metadata som null/{} — aldrig undefined", () => {
    logEvent("tok", "prediction_saved_test_defaults");
    const row = restFetch.mock.calls[0][1].body[0];
    expect(row.group_id).toBeNull();
    expect(row.competition_id).toBeNull();
    expect(row.metadata).toEqual({});
  });
});

describe("logEvent — throttling af opened_*-navigation (IKKE af writes)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("to opened_home inden for 20s tæller kun som ét kald", () => {
    logEvent("tok", "opened_home_throttle_test");
    logEvent("tok", "opened_home_throttle_test");
    expect(restFetch).toHaveBeenCalledTimes(1);
  });

  it("to opened_home med 21s imellem tæller som to kald", () => {
    logEvent("tok", "opened_home_throttle_test_2");
    vi.advanceTimersByTime(21000);
    logEvent("tok", "opened_home_throttle_test_2");
    expect(restFetch).toHaveBeenCalledTimes(2);
  });

  it("prediction_saved-agtige writes throttles IKKE — hvert kald skal tælle", () => {
    logEvent("tok", "prediction_saved_throttle_test", { metadata: { match_id: "m1" } });
    logEvent("tok", "prediction_saved_throttle_test", { metadata: { match_id: "m1" } });
    expect(restFetch).toHaveBeenCalledTimes(2);
  });
});

describe("logEventOnce — impressions, én gang pr. unik nøgle", () => {
  it("samme nøgle to gange giver ét kald", () => {
    logEventOnce("tok", "story_viewed_once_test", "story-key-a");
    logEventOnce("tok", "story_viewed_once_test", "story-key-a");
    expect(restFetch).toHaveBeenCalledTimes(1);
  });

  it("forskellig nøgle giver to kald", () => {
    logEventOnce("tok", "story_viewed_once_test_b", "story-key-b1");
    logEventOnce("tok", "story_viewed_once_test_b", "story-key-b2");
    expect(restFetch).toHaveBeenCalledTimes(2);
  });
});

describe("healthTone — Liga Health-farve/ord, farve er aldrig eneste signal", () => {
  it("null → 'For ny', ingen farve", () => {
    expect(healthTone(null)).toEqual({ label: "For ny", color: null });
  });
  it("100 → Sund", () => { expect(healthTone(100).label).toBe("Sund"); });
  it("70 → Sund (grænse)", () => { expect(healthTone(70).label).toBe("Sund"); });
  it("69 → Svag", () => { expect(healthTone(69).label).toBe("Svag"); });
  it("40 → Svag (grænse)", () => { expect(healthTone(40).label).toBe("Svag"); });
  it("39 → Kritisk", () => { expect(healthTone(39).label).toBe("Kritisk"); });
  it("0 → Kritisk", () => { expect(healthTone(0).label).toBe("Kritisk"); });
});
