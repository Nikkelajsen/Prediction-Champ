import { describe, it, expect, vi, afterEach } from "vitest";
import { outcome, pointsFor, groupIntoRounds, filterFromNextUnfinishedRound, currentRoundIndex, isLocked } from "./scoring.js";

const RULES = { exact: 3, outcome: 1 };

describe("outcome", () => {
  it("giver 1 ved hjemmesejr, X ved uafgjort, 2 ved udesejr", () => {
    expect(outcome(2, 1)).toBe("1");
    expect(outcome(1, 1)).toBe("X");
    expect(outcome(0, 3)).toBe("2");
  });
});

describe("pointsFor", () => {
  const match = { home_score: 2, away_score: 1 };

  it("giver +3 for præcist resultat", () => {
    expect(pointsFor({ pred_home: 2, pred_away: 1 }, match, RULES)).toBe(3);
  });

  it("giver +1 for korrekt udfald med forkert resultat", () => {
    expect(pointsFor({ pred_home: 3, pred_away: 0 }, match, RULES)).toBe(1);
  });

  it("giver 0 for forkert udfald — aldrig minuspoint", () => {
    expect(pointsFor({ pred_home: 0, pred_away: 0 }, match, RULES)).toBe(0);
    expect(pointsFor({ pred_home: 0, pred_away: 2 }, match, RULES)).toBe(0);
  });

  it("giver null uden forudsigelse eller uden resultat", () => {
    expect(pointsFor(null, match, RULES)).toBeNull();
    expect(pointsFor({ pred_home: null, pred_away: 1 }, match, RULES)).toBeNull();
    expect(pointsFor({ pred_home: 2, pred_away: 1 }, { home_score: null, away_score: null }, RULES)).toBeNull();
  });

  it("respekterer konkurrencens egne pointregler", () => {
    const rules = { exact: 5, outcome: 2 };
    expect(pointsFor({ pred_home: 2, pred_away: 1 }, match, rules)).toBe(5);
    expect(pointsFor({ pred_home: 1, pred_away: 0 }, match, rules)).toBe(2);
  });

  it("falder tilbage til +3/+1 for ældre konkurrencer uden rules-felt", () => {
    expect(pointsFor({ pred_home: 2, pred_away: 1 }, match, undefined)).toBe(3);
    expect(pointsFor({ pred_home: 1, pred_away: 0 }, match, undefined)).toBe(1);
  });

  it("håndterer 0-0 korrekt (0 er ikke 'manglende gæt')", () => {
    expect(pointsFor({ pred_home: 0, pred_away: 0 }, { home_score: 0, away_score: 0 }, RULES)).toBe(3);
  });
});

describe("groupIntoRounds", () => {
  it("grupperer på round_key, sorterer runder og kampe kronologisk", () => {
    const rounds = groupIntoRounds([
      { round_key: "2026-07-14", kickoff_at: "2026-07-18T14:00:00Z" },
      { round_key: "2026-07-07", kickoff_at: "2026-07-10T17:00:00Z" },
      { round_key: "2026-07-14", kickoff_at: "2026-07-15T17:00:00Z" },
    ]);
    expect(rounds.map((r) => r.key)).toEqual(["2026-07-07", "2026-07-14"]);
    expect(rounds[1].matches.map((m) => m.kickoff_at)).toEqual([
      "2026-07-15T17:00:00Z", "2026-07-18T14:00:00Z",
    ]);
  });
});

describe("filterFromNextUnfinishedRound", () => {
  const finished = (key) => ({ round_key: key, home_score: 1, away_score: 0 });
  const upcoming = (key) => ({ round_key: key, home_score: null, away_score: null });

  it("udelader allerede afsluttede runder (nye konkurrencer starter fra 0)", () => {
    const result = filterFromNextUnfinishedRound([
      finished("2026-07-07"), finished("2026-07-07"),
      upcoming("2026-07-14"), upcoming("2026-07-21"),
    ]);
    expect(result.map((m) => m.round_key)).toEqual(["2026-07-14", "2026-07-21"]);
  });

  it("beholder en delvist spillet runde", () => {
    const result = filterFromNextUnfinishedRound([finished("2026-07-07"), upcoming("2026-07-07")]);
    expect(result).toHaveLength(2);
  });

  it("giver tom liste når hele sæsonen er spillet", () => {
    expect(filterFromNextUnfinishedRound([finished("2026-07-07")])).toEqual([]);
  });
});

describe("isLocked", () => {
  afterEach(() => vi.useRealTimers());

  it("låser kampe med resultat og kampe under 1 time før kickoff", () => {
    vi.useFakeTimers({ now: new Date("2026-07-14T12:00:00Z") });
    expect(isLocked({ home_score: 1, away_score: 0, kickoff_at: "2026-07-20T12:00:00Z" })).toBe(true);
    expect(isLocked({ home_score: null, kickoff_at: "2026-07-14T12:30:00Z" })).toBe(true); // 30 min til kickoff
    expect(isLocked({ home_score: null, kickoff_at: "2026-07-14T14:00:00Z" })).toBe(false); // 2 timer til kickoff
    expect(isLocked({ home_score: null, kickoff_at: null })).toBe(false);
  });
});

describe("currentRoundIndex", () => {
  afterEach(() => vi.useRealTimers());

  it("finder runden der indeholder i dag, ellers den sidste", () => {
    vi.useFakeTimers({ now: new Date("2026-07-15T12:00:00Z") });
    const rounds = [{ key: "2026-07-07" }, { key: "2026-07-14" }, { key: "2026-07-21" }];
    expect(currentRoundIndex(rounds)).toBe(1);
    expect(currentRoundIndex([{ key: "2026-06-01" }])).toBe(0);
    expect(currentRoundIndex([])).toBe(0);
  });
});
