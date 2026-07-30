import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./supabase.js", () => ({ restFetch: vi.fn() }));
import { restFetch } from "./supabase.js";
import { logEvent, logEventOnce, diagnoseLeague, diagnoseLeagues, summarizeDiagnoses, LEAGUE_THRESHOLDS } from "./analytics.js";
import { METRICS, metricInfo } from "./analyticsMetrics.js";

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

// ---------- Liga-diagnose (afløser healthTone/Health Score) ----------
// En sund liga i alle henseender. Hver test nedenfor ændrer PRÆCIS ét felt,
// så det er utvetydigt, hvilket signal der udløser hvilken tilstand.
const healthyLeague = {
  group_id: "g1", name: "Testligaen", window_days: 30,
  age_days: 120, members: 6, active_members: 5,
  predictors: 5, predictor_share: 83.3,
  completion_slots: 60, completion_done: 48, completion_rate: 80, completion_rate_prev: 78,
  rounds_available: 4, rounds_played: 4, pulse: 100,
  top_predictor_share: 25, active_share: 83.3,
  retention_eligible: 6, retention_retained: 5, retention_rate: 83.3,
  competitions_total: 2, competitions_active: 1,
  story_views: 12, last_activity_at: "2026-07-30T10:00:00Z", days_since_activity: 1,
};
const league = (over) => ({ ...healthyLeague, ...over });

describe("diagnoseLeague — én tilstand pr. liga, første regel der passer vinder", () => {
  it("en liga uden problemer er 'Sund' og har ingen handling", () => {
    const d = diagnoseLeague(healthyLeague);
    expect(d.key).toBe("healthy");
    expect(d.tone).toBe("green");
    expect(d.action).toBeNull();
  });

  it("for ung slår ALT andet — en liga fra i går må aldrig stemples 'død'", () => {
    const d = diagnoseLeague(league({
      age_days: 2, days_since_activity: null, competitions_active: 0,
      members: 1, predictors: 0, rounds_available: 0,
    }));
    expect(d.key).toBe("too_new");
    expect(d.tone).toBeNull();
  });

  it("14 dage gammel er lige akkurat gammel nok til at blive bedømt", () => {
    expect(diagnoseLeague(league({ age_days: 13 })).key).toBe("too_new");
    expect(diagnoseLeague(league({ age_days: 14 })).key).toBe("healthy");
  });

  it("aldrig nogen aktivitet (og gammel nok) → død", () => {
    expect(diagnoseLeague(league({ days_since_activity: null })).key).toBe("dead");
  });

  it("over 30 dage uden aktivitet → død; 30 dage præcis er kun dvale", () => {
    expect(diagnoseLeague(league({ days_since_activity: 31 })).key).toBe("dead");
    expect(diagnoseLeague(league({ days_since_activity: 30 })).key).toBe("dormant");
  });

  it("ingen aktiv konkurrence slår dvale — årsagen før symptomet", () => {
    const d = diagnoseLeague(league({ competitions_active: 0, days_since_activity: 20 }));
    expect(d.key).toBe("no_competition");
    expect(d.action).toMatch(/Opret en konkurrence/);
  });

  it("skelner 'har aldrig haft en konkurrence' fra 'ingen af dem er i gang'", () => {
    expect(diagnoseLeague(league({ competitions_active: 0, competitions_total: 0 })).why).toMatch(/aldrig/);
    expect(diagnoseLeague(league({ competitions_active: 0, competitions_total: 3 })).why).toMatch(/3 konkurrencer/);
  });

  it("over 14 dage uden aktivitet, men med konkurrence i gang → dvale", () => {
    expect(diagnoseLeague(league({ days_since_activity: 15 })).key).toBe("dormant");
    expect(diagnoseLeague(league({ days_since_activity: 14 })).key).toBe("healthy");
  });

  it("ét medlem er et invitations-problem, ikke et engagements-problem", () => {
    const d = diagnoseLeague(league({ members: 1, predictors: 1, predictor_share: 100 }));
    expect(d.key).toBe("solo");
    expect(d.action).toMatch(/invitation/);
  });

  it("ingen låst runde i vinduet → 'Intet at måle på', ikke 0 % deltagelse", () => {
    const d = diagnoseLeague(league({ rounds_available: 0, completion_slots: 0, completion_rate: null, predictors: 0 }));
    expect(d.key).toBe("no_rounds");
    expect(d.tone).toBeNull();
  });

  it("låste runder, men ingen der tippede → den alvorligste aktive tilstand", () => {
    const d = diagnoseLeague(league({ predictors: 0, predictor_share: 0, completion_done: 0, completion_rate: 0 }));
    expect(d.key).toBe("no_predictors");
    expect(d.tone).toBe("red");
  });

  it("præcis én tipper blandt flere medlemmer → 'Bæres af én'", () => {
    const d = diagnoseLeague(league({ predictors: 1, predictor_share: 16.7 }));
    expect(d.key).toBe("single_player");
  });

  it("under halvdelen af medlemmerne tipper → 'Kun en del tipper'", () => {
    expect(diagnoseLeague(league({ predictors: 2, predictor_share: 33.3 })).key).toBe("narrow");
    expect(diagnoseLeague(league({ predictors: 3, predictor_share: 50 })).key).toBe("healthy");
    expect(diagnoseLeague(league({ predictors: 3, predictor_share: 49.9 })).key).toBe("narrow");
  });

  it("bredde måles på MEDLEMMER, ikke på flittighed — høj deltagelse redder ikke en smal liga", () => {
    const d = diagnoseLeague(league({ predictors: 2, predictor_share: 33.3, completion_rate: 100 }));
    expect(d.key).toBe("narrow");
  });

  it("et fald på mindst 15 procentpoint → 'Deltagelsen falder'", () => {
    expect(diagnoseLeague(league({ completion_rate: 60, completion_rate_prev: 75 })).key).toBe("declining");
    expect(diagnoseLeague(league({ completion_rate: 61, completion_rate_prev: 75 })).key).toBe("healthy");
  });

  it("uden sammenligningsgrundlag (prev = null) kaldes intet for et fald", () => {
    expect(diagnoseLeague(league({ completion_rate: 20, completion_rate_prev: null })).key).toBe("low_completion");
  });

  it("deltagelse under 50 % → 'Lav deltagelse'", () => {
    expect(diagnoseLeague(league({ completion_rate: 49, completion_rate_prev: 50 })).key).toBe("low_completion");
    expect(diagnoseLeague(league({ completion_rate: 50, completion_rate_prev: 50 })).key).toBe("healthy");
  });

  it("under 5 mulige tips er for tyndt til at kalde deltagelsen lav", () => {
    const d = diagnoseLeague(league({ completion_slots: 4, completion_done: 1, completion_rate: 25, completion_rate_prev: null }));
    expect(d.key).toBe("healthy");
  });

  it("begrundelsen indeholder ligaens egne tal — et tal skal navngive sit eget omfang", () => {
    const d = diagnoseLeague(league({ predictors: 2, predictor_share: 33.3 }));
    expect(d.why).toContain("2 af 6");
  });

  it("tærsklerne kan overstyres uden at røre databasen", () => {
    const strict = { ...LEAGUE_THRESHOLDS, lowCompletion: 90 };
    expect(diagnoseLeague(league({ completion_rate_prev: 80 })).key).toBe("healthy");
    expect(diagnoseLeague(league({ completion_rate_prev: 80 }), strict).key).toBe("low_completion");
  });

  it("hver tilstand har både etikette og alvor", () => {
    const cases = [
      healthyLeague,
      league({ age_days: 1 }),
      league({ days_since_activity: null }),
      league({ competitions_active: 0 }),
      league({ days_since_activity: 20 }),
      league({ members: 1 }),
      league({ rounds_available: 0 }),
      league({ predictors: 0 }),
      league({ predictors: 1 }),
      league({ predictors: 2, predictor_share: 33 }),
      league({ completion_rate: 50, completion_rate_prev: 75 }),
      league({ completion_rate: 20, completion_rate_prev: null }),
    ];
    for (const c of cases) {
      const d = diagnoseLeague(c);
      expect(typeof d.label).toBe("string");
      expect(d.label.length).toBeGreaterThan(0);
      expect(typeof d.severity).toBe("number");
      expect(typeof d.why).toBe("string");
    }
  });
});

describe("diagnoseLeagues — rækkefølge og robusthed", () => {
  it("mest akutte først, uafhængigt af inputrækkefølgen", () => {
    const out = diagnoseLeagues([
      league({ group_id: "a", name: "Sund" }),
      league({ group_id: "b", name: "Død", days_since_activity: 99 }),
      league({ group_id: "c", name: "Smal", predictors: 2, predictor_share: 33 }),
    ], 30);
    expect(out.map((l) => l.name)).toEqual(["Død", "Smal", "Sund"]);
  });

  it("ved samme alvor kommer den med lavest deltagelse først, null sidst", () => {
    const out = diagnoseLeagues([
      league({ group_id: "a", name: "A", predictors: 2, predictor_share: 33, completion_rate: 70 }),
      league({ group_id: "b", name: "B", predictors: 2, predictor_share: 33, completion_rate: 20 }),
      league({ group_id: "c", name: "C", predictors: 2, predictor_share: 33, completion_rate: null }),
    ], 30);
    expect(out.map((l) => l.name)).toEqual(["B", "A", "C"]);
  });

  it("vinduet skrives ind i hver liga, så begrundelserne kan nævne det", () => {
    const [l] = diagnoseLeagues([league({ rounds_available: 0 })], 7);
    expect(l.diagnosis.why).toContain("7 dage");
  });

  it("tom eller manglende liste giver et tomt resultat, ikke en fejl", () => {
    expect(diagnoseLeagues(undefined, 30)).toEqual([]);
    expect(diagnoseLeagues([], 30)).toEqual([]);
  });
});

describe("summarizeDiagnoses — optælling frem for gennemsnit", () => {
  it("tæller pr. tone og lægger de ubedømte for sig", () => {
    const out = summarizeDiagnoses(diagnoseLeagues([
      league({ group_id: "a", name: "A" }),
      league({ group_id: "b", name: "B", days_since_activity: 99 }),
      league({ group_id: "c", name: "C", predictors: 1 }),
      league({ group_id: "d", name: "D", age_days: 3 }),
    ], 30));
    expect(out).toEqual({ akut: 1, svag: 1, sund: 1, ubedømt: 1 });
  });

  it("tom liste giver nuller, ikke undefined", () => {
    expect(summarizeDiagnoses([])).toEqual({ akut: 0, svag: 0, sund: 0, ubedømt: 0 });
  });
});

describe("måle-ordbogen — hvert nøgletal skal kunne forklare sig selv", () => {
  it("hver metrik har titel, hvad, hvordan og kilde", () => {
    for (const [id, m] of Object.entries(METRICS)) {
      for (const field of ["title", "what", "how", "source"]) {
        expect(typeof m[field], `${id}.${field}`).toBe("string");
        expect(m[field].length, `${id}.${field}`).toBeGreaterThan(0);
      }
    }
  });

  it("et ukendt id giver null frem for at kaste — en tastefejl koster ⓘ'en, ikke sektionen", () => {
    expect(metricInfo("findes_ikke")).toBeNull();
    expect(metricInfo(undefined)).toBeNull();
  });

  it("alle id'er, AnalyticsPanel slår op, findes i ordbogen", () => {
    const used = [
      "completion_rate", "completion_trend", "active_users", "active_groups", "active_competitions",
      "deadline_miss_rate", "rounds_completed", "completion_by_week", "completion_by_month",
      "rounds_completed_by_week", "event_views", "league_views", "push_open_rate", "session_time",
      "league_state", "league_breadth", "league_pulse", "league_completion", "league_concentration",
      "league_activity", "league_retention", "league_last_activity", "league_competitions",
      "league_story_views", "user_retention", "league_retention_agg", "user_cohorts",
    ];
    for (const id of used) expect(metricInfo(id), id).not.toBeNull();
  });

  it("de tal, der er et gulv og ikke et facit, siger det i forbeholdet", () => {
    for (const id of ["event_views", "push_open_rate"]) {
      expect(METRICS[id].caveat.toLowerCase()).toContain("gulv");
    }
  });
});
