import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./supabase.js", () => ({ restFetch: vi.fn() }));
import { restFetch } from "./supabase.js";
import { readFileSync, readdirSync } from "node:fs";
import {
  logEvent, logEventOnce, diagnoseLeague, diagnoseLeagues, summarizeDiagnoses, LEAGUE_THRESHOLDS,
  funnelRow, funnelSteps, biggestDrop, fmtMinutes, storyRuleRows, STORY_RULES,
} from "./analytics.js";
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
      "push_effect", "push_lead_time", "funnel", "funnel_path", "funnel_stalled", "funnel_time",
      "story_rules", "story_never", "story_coverage",
    ];
    for (const id of used) expect(metricInfo(id), id).not.toBeNull();
  });

  it("de tal, der er et gulv og ikke et facit, siger det i forbeholdet", () => {
    for (const id of ["event_views", "push_open_rate"]) {
      expect(METRICS[id].caveat.toLowerCase()).toContain("gulv");
    }
  });
});

// ---------- Tragt for nye brugere (A13) ----------
// RPC'en leverer én flad rows-liste fra grouping sets: to scopes × (total + vej).
const funnelData = {
  window_days: 30,
  rows: [
    { scope: "window", path: null, cohort: 20, reached_league: 16, reached_competition: 12, reached_prediction: 6,
      stalled_uden_liga: 4, stalled_uden_konkurrence: 4, stalled_uden_tip: 6, stalled_gennemfoert: 6,
      median_min_league: 3.5, median_min_competition: 12, median_min_prediction: 2880 },
    { scope: "window", path: "selvstarter", cohort: 12, reached_league: 8, reached_competition: 5, reached_prediction: 2,
      stalled_uden_liga: 4, stalled_uden_konkurrence: 3, stalled_uden_tip: 3, stalled_gennemfoert: 2,
      median_min_league: 40, median_min_competition: 60, median_min_prediction: 4320 },
    { scope: "window", path: "inviteret", cohort: 8, reached_league: 8, reached_competition: 7, reached_prediction: 4,
      stalled_uden_liga: 0, stalled_uden_konkurrence: 1, stalled_uden_tip: 3, stalled_gennemfoert: 4,
      median_min_league: 0.5, median_min_competition: 2, median_min_prediction: 45 },
    { scope: "all_time", path: null, cohort: 100, reached_league: 90, reached_competition: 80, reached_prediction: 70,
      stalled_uden_liga: 10, stalled_uden_konkurrence: 10, stalled_uden_tip: 10, stalled_gennemfoert: 70,
      median_min_league: 2, median_min_competition: 8, median_min_prediction: 900 },
  ],
};

describe("funnelRow — plukker den rigtige række ud af grouping sets", () => {
  it("henter totalen for et scope, når path udelades", () => {
    expect(funnelRow(funnelData, "window").cohort).toBe(20);
    expect(funnelRow(funnelData, "all_time").cohort).toBe(100);
  });
  it("henter én vej ind", () => {
    expect(funnelRow(funnelData, "window", "selvstarter").cohort).toBe(12);
    expect(funnelRow(funnelData, "window", "inviteret").cohort).toBe(8);
  });
  it("blander ikke scopes sammen", () => {
    expect(funnelRow(funnelData, "all_time", "selvstarter")).toBeNull();
  });
  it("tomt eller manglende svar giver null, ikke en fejl", () => {
    expect(funnelRow(undefined, "window")).toBeNull();
    expect(funnelRow({ rows: [] }, "window")).toBeNull();
  });
});

describe("funnelSteps — trin, procent og fald", () => {
  const steps = funnelSteps(funnelRow(funnelData, "window"));

  it("første trin er altid hele kohorten ved 100 % og uden fald", () => {
    expect(steps[0].users).toBe(20);
    expect(steps[0].pct).toBe(100);
    expect(steps[0].dropFromPrev).toBeNull();
  });

  it("procent regnes af KOHORTEN, faldet af FORRIGE trin — to forskellige nævnere", () => {
    const konk = steps[2]; // 12 af 20 i kohorten, men 4 tabt af de 16 fra forrige trin
    expect(konk.pct).toBe(60);
    expect(konk.dropFromPrev).toBe(4);
    expect(konk.dropPct).toBe(25);
  });

  it("bærer mediantiden med, undtagen på første trin hvor den ikke findes", () => {
    expect(steps[0].medianMinutes).toBeNull();
    expect(steps[1].medianMinutes).toBe(3.5);
  });

  it("tom kohorte giver ingen trin i stedet for division med nul", () => {
    expect(funnelSteps({ cohort: 0 })).toEqual([]);
    expect(funnelSteps(null)).toEqual([]);
  });
});

describe("biggestDrop — sektionens overskrift i ét tal", () => {
  it("finder det trin, der taber flest", () => {
    const worst = biggestDrop(funnelSteps(funnelRow(funnelData, "window")));
    expect(worst.key).toBe("reached_prediction"); // 12 → 6, altså 6 tabt
    expect(worst.dropFromPrev).toBe(6);
  });

  it("en tragt uden frafald har intet største fald", () => {
    const perfect = funnelSteps({ cohort: 5, reached_league: 5, reached_competition: 5, reached_prediction: 5 });
    expect(biggestDrop(perfect)).toBeNull();
  });

  it("ignorerer trin, der VOKSER (liga-løs konkurrence kan nås uden liga)", () => {
    const odd = funnelSteps({ cohort: 10, reached_league: 4, reached_competition: 7, reached_prediction: 7 });
    expect(biggestDrop(odd).key).toBe("reached_league");
  });
});

describe("fmtMinutes — samme felt spænder fra sekunder til dage", () => {
  it("under et minut vises i sekunder", () => { expect(fmtMinutes(0.5)).toBe("30 s"); });
  it("minutter", () => { expect(fmtMinutes(42)).toBe("42 min"); });
  it("timer", () => { expect(fmtMinutes(180)).toBe("3 t"); });
  it("dage", () => { expect(fmtMinutes(60 * 72)).toBe("3 dage"); });
  it("null bliver til en tankestreg, aldrig til 0", () => {
    expect(fmtMinutes(null)).toBe("—");
    expect(fmtMinutes(undefined)).toBe("—");
  });
});

// ---------- Story Engine-regler (A5) ----------
describe("storyRuleRows — katalogen fletter med det målte", () => {
  const data = {
    rules: [
      { rule: "ROUND_WON", generated: 12, users: 5, viewed: 9, shared: 2, dismissed: 1, view_rate: 75, share_rate: 22.2, dismiss_rate: 8.3 },
      { rule: "STREAK", generated: 0, users: 0, viewed: 0, shared: 0, dismissed: 0, view_rate: null, share_rate: null, dismiss_rate: null },
    ],
  };
  const rows = storyRuleRows(data);
  const byRule = Object.fromEntries(rows.map((r) => [r.rule, r]));

  it("returnerer hele katalogen, ikke kun de regler databasen kender", () => {
    expect(rows.length).toBeGreaterThanOrEqual(Object.keys(STORY_RULES).length);
    for (const rule of Object.keys(STORY_RULES)) expect(byRule[rule]).toBeDefined();
  });

  it("skelner ALDRIG udløst fra STILLE i vinduet — to forskellige problemer", () => {
    expect(byRule.STREAK.silent).toBe(true);   // findes i databasen, men 0 i vinduet
    expect(byRule.STREAK.never).toBe(false);
    expect(byRule.COMEBACK.never).toBe(true);  // findes slet ikke
    expect(byRule.COMEBACK.silent).toBe(false);
  });

  it("nulstiller de regler, der ikke blev målt — aldrig undefined i tabellen", () => {
    expect(byRule.COMEBACK.generated).toBe(0);
    expect(byRule.COMEBACK.viewed).toBe(0);
    expect(byRule.COMEBACK.view_rate).toBeNull();
  });

  it("sorterer mest genererede først", () => { expect(rows[0].rule).toBe("ROUND_WON"); });

  it("en regel i databasen, katalogen ikke kender, skjules ikke — den markeres", () => {
    const out = storyRuleRows({ rules: [{ rule: "NY_REGEL", generated: 3, viewed: 1 }] });
    const ny = out.find((r) => r.rule === "NY_REGEL");
    expect(ny.unknown).toBe(true);
  });

  it("tomt svar giver hele katalogen på nul, ikke en tom tabel", () => {
    const out = storyRuleRows(undefined);
    expect(out.length).toBe(Object.keys(STORY_RULES).length);
    expect(out.every((r) => r.never)).toBe(true);
  });

  // G73: `viewable` er nævneren under alle procenter i tabellen. Falder den
  // til 0, forsvinder raterne — så en database, hvor RPC'en endnu ikke er
  // gen-kørt, må ikke give 0, men det gamle tal.
  describe("viewable — nævneren, når kortet overhovedet kunne nå en skærm", () => {
    it("bæres igennem, når RPC'en leverer den", () => {
      const out = storyRuleRows({ rules: [{ rule: "DAY_RESULT", generated: 123, viewable: 4 }] });
      expect(out.find((r) => r.rule === "DAY_RESULT").viewable).toBe(4);
    });

    it("falder tilbage til generated på en RPC uden kolonnen — ikke til nul", () => {
      expect(byRule.ROUND_WON.viewable).toBe(12);
      const ukendt = storyRuleRows({ rules: [{ rule: "NY_REGEL", generated: 3 }] })
        .find((r) => r.rule === "NY_REGEL");
      expect(ukendt.viewable).toBe(3);
    });

    it("er 0 for en regel, der slet ikke blev målt", () => {
      expect(byRule.COMEBACK.viewable).toBe(0);
    });
  });

  // Katalogen findes kun i JS, fordi RPC'en per definition ikke kan se regler,
  // der aldrig har udløst. Denne test er prisen for det: den fejler, hvis
  // motoren udvides uden at listen følger med.
  //
  // Filerne findes ved at LÆSE mappen, ikke ved en håndholdt liste. Testen
  // pegede indtil august 2026 kun på `story_engine.sql`, og da v2 lagde sin
  // dagsmotor i en ny fil, var der ingen drift at se: de syv dagsregler stod
  // som UKENDT uden navn i analytics, mens testen var grøn. En hårdkodet
  // filliste er den samme fejl som en hårdkodet regelliste.
  it("katalogen driver ikke fra sql/story_engine*.sql — hverken runde- eller dagsmotoren", () => {
    const dir = new URL("../../sql/", import.meta.url);
    const files = readdirSync(dir).filter((f) => /^story_engine.*\.sql$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(2); // v1 + v2; fanger en flyttet/omdøbt fil
    // Store bogstaver i apostroffer, som IKKE er regelnavne: 'ALL' er
    // generate_stories' scope-argument, 'UTC' en tidszone i dagsmotoren.
    const NOT_RULES = new Set(["ALL", "UTC"]);
    const inSql = new Set(
      files
        .flatMap((f) => [...readFileSync(new URL(f, dir), "utf8").matchAll(/'([A-Z][A-Z0-9_]{2,})'/g)])
        .map((m) => m[1])
        .filter((r) => !NOT_RULES.has(r))
    );
    expect([...inSql].sort()).toEqual(Object.keys(STORY_RULES).sort());
  });
});
