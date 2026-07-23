import { describe, it, expect, vi, afterEach } from "vitest";
import { outcome, pointsFor, groupIntoRounds, filterFromNextUnfinishedRound, currentRoundIndex, isLocked, buildRoundLockMap, roundLockKey, stageOptionLabel, stageBadgeLabel, filterByStages } from "./scoring.js";

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

describe("stageOptionLabel / stageBadgeLabel", () => {
  it("oversætter kendte Sportmonks-stages til dansk", () => {
    expect(stageOptionLabel("Championship Round")).toBe("Mesterskabsspil");
    expect(stageOptionLabel("Relegation Round")).toBe("Nedrykningsspil");
    expect(stageOptionLabel("Regular Season")).toBe("Grundspil");
  });

  it("falder tilbage til det rå navn for ukendte stages", () => {
    expect(stageOptionLabel("Some New Stage")).toBe("Some New Stage");
  });

  it("skjuler grundspil-badge, men viser slutspils-stages", () => {
    expect(stageBadgeLabel("Regular Season")).toBeNull();
    expect(stageBadgeLabel(null)).toBeNull();
    expect(stageBadgeLabel("Championship Round")).toBe("Mesterskabsspil");
    expect(stageBadgeLabel("Relegation Round")).toBe("Nedrykningsspil");
  });
});

describe("filterByStages", () => {
  const ms = [
    { id: "a", stage_name: "Regular Season" },
    { id: "b", stage_name: "Championship Round" },
    { id: "c", stage_name: "Relegation Round" },
    { id: "d", stage_name: null },
  ];

  it("tom/undefined liste ⇒ alle kampe (også uden stage_name)", () => {
    expect(filterByStages(ms, [])).toHaveLength(4);
    expect(filterByStages(ms, undefined)).toHaveLength(4);
  });

  it("filtrerer til de valgte stages", () => {
    expect(filterByStages(ms, ["Championship Round"]).map((m) => m.id)).toEqual(["b"]);
    expect(filterByStages(ms, ["Championship Round", "Relegation Round"]).map((m) => m.id)).toEqual(["b", "c"]);
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

describe("runde-baseret låsning (roundLockKey / buildRoundLockMap / isLocked)", () => {
  afterEach(() => vi.useRealTimers());

  const s1r1 = { season_id: "s1", round_key: "2026-07-14" };

  it("roundLockKey scoper på (season_id, round_key)", () => {
    expect(roundLockKey({ season_id: "s1", round_key: "2026-07-14" }))
      .not.toBe(roundLockKey({ season_id: "s2", round_key: "2026-07-14" }));
    expect(roundLockKey({ season_id: "s1", round_key: "2026-07-14" }))
      .toBe(roundLockKey({ season_id: "s1", round_key: "2026-07-14" }));
  });

  it("buildRoundLockMap finder rundens tidligste kickoff og springer kampe uden kickoff over", () => {
    const map = buildRoundLockMap([
      { ...s1r1, kickoff_at: "2026-07-18T14:00:00Z" },
      { ...s1r1, kickoff_at: "2026-07-15T17:00:00Z" },
      { ...s1r1, kickoff_at: null },
    ]);
    expect(map.get(roundLockKey(s1r1))).toBe(new Date("2026-07-15T17:00:00Z").getTime());
  });

  it("hele runden låser 1 time før rundens FØRSTE kickoff", () => {
    vi.useFakeTimers({ now: new Date("2026-07-15T16:30:00Z") }); // 30 min før første kamp
    const early = { ...s1r1, home_score: null, kickoff_at: "2026-07-15T17:00:00Z" };
    const late = { ...s1r1, home_score: null, kickoff_at: "2026-07-18T14:00:00Z" };
    const map = buildRoundLockMap([early, late]);
    expect(isLocked(early, map)).toBe(true);
    expect(isLocked(late, map)).toBe(true); // låst selvom dens egen kamp er 3 dage ude

    vi.useFakeTimers({ now: new Date("2026-07-15T15:30:00Z") }); // 1½ time før første kamp
    expect(isLocked(early, map)).toBe(false);
    expect(isLocked(late, map)).toBe(false);
  });

  it("kampe med resultat er altid låst, og uden map falder den tilbage til per-kamp", () => {
    vi.useFakeTimers({ now: new Date("2026-07-14T12:00:00Z") });
    expect(isLocked({ ...s1r1, home_score: 1, away_score: 0, kickoff_at: "2026-07-20T12:00:00Z" })).toBe(true);
    expect(isLocked({ ...s1r1, home_score: null, kickoff_at: "2026-07-14T12:30:00Z" })).toBe(true); // 30 min til egen kickoff
    expect(isLocked({ ...s1r1, home_score: null, kickoff_at: "2026-07-14T14:00:00Z" })).toBe(false); // 2 timer til egen kickoff
    expect(isLocked({ ...s1r1, home_score: null, kickoff_at: null })).toBe(false);
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
