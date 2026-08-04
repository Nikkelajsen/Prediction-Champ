import { describe, it, expect } from "vitest";
import { avgGoalError, compareStandings, sortStandings, assignRanks, leaders, joinNames } from "./standings.js";

// Basisrække: alle trin lige. Hver test ændrer PRÆCIS ét trin, så testen viser,
// at netop dét trin afgør, når alle trin over det er lige.
const base = (over = {}) => ({
  userId: "u", total: 10, exactCount: 2, outcomeCount: 4, roundWins: 1, avgGoalError: 1.5, ...over,
});

describe("compareStandings (tiebreaker-stigen)", () => {
  it("1. flest point afgør først", () => {
    expect(compareStandings(base({ total: 11 }), base({ total: 10, exactCount: 99 }))).toBeLessThan(0);
  });

  it("2. ved lige point afgør flest præcise resultater", () => {
    expect(compareStandings(base({ exactCount: 3 }), base({ exactCount: 2, outcomeCount: 99 }))).toBeLessThan(0);
  });

  it("3. ved lige præcise afgør flest korrekte udfald", () => {
    expect(compareStandings(base({ outcomeCount: 5 }), base({ outcomeCount: 4, roundWins: 99 }))).toBeLessThan(0);
  });

  it("4. ved lige udfald afgør flest rundesejre", () => {
    expect(compareStandings(base({ roundWins: 2 }), base({ roundWins: 1, avgGoalError: 0 }))).toBeLessThan(0);
  });

  it("5. ved lige rundesejre afgør MINDST målafvigelse", () => {
    expect(compareStandings(base({ avgGoalError: 1.0 }), base({ avgGoalError: 1.5 }))).toBeLessThan(0);
  });

  it("returnerer 0 ved ægte lighed — også når userId er forskellig", () => {
    expect(compareStandings(base({ userId: "a" }), base({ userId: "b" }))).toBe(0);
  });

  it("manglende rundesejre (Rundechampionshippet) er neutralt, ikke afgørende", () => {
    const a = { userId: "a", total: 10, exactCount: 2, outcomeCount: 4, avgGoalError: 1.0 };
    const b = { userId: "b", total: 10, exactCount: 2, outcomeCount: 4, avgGoalError: 2.0 };
    expect(compareStandings(a, b)).toBeLessThan(0); // målafvigelsen afgør, ikke det manglende felt
  });
});

describe("avgGoalError", () => {
  it("er et gennemsnit, så flere tippede kampe ikke straffes", () => {
    expect(avgGoalError(10, 10)).toBe(1);
    expect(avgGoalError(20, 20)).toBe(1); // dobbelt så mange kampe, samme præcision ⇒ lige
  });

  it("afrunder til 4 decimaler, så SQL og JS er enige om lighed", () => {
    expect(avgGoalError(1, 3)).toBe(0.3333);
  });

  it("håndterer nul kampe uden at dele med nul", () => {
    expect(avgGoalError(0, 0)).toBe(0);
  });
});

describe("sortStandings", () => {
  it("sorterer efter stigen", () => {
    const rows = sortStandings([
      base({ userId: "c", total: 8 }),
      base({ userId: "a", total: 12 }),
      base({ userId: "b", total: 10 }),
    ]);
    expect(rows.map((r) => r.userId)).toEqual(["a", "b", "c"]);
  });

  it("bruger userId som stabil sidste nøgle, så rækkefølgen ikke driver", () => {
    const tied = [base({ userId: "zeta" }), base({ userId: "alpha" })];
    expect(sortStandings(tied).map((r) => r.userId)).toEqual(["alpha", "zeta"]);
    expect(sortStandings(tied.slice().reverse()).map((r) => r.userId)).toEqual(["alpha", "zeta"]);
  });

  it("muterer ikke input", () => {
    const rows = [base({ userId: "b", total: 1 }), base({ userId: "a", total: 9 })];
    sortStandings(rows);
    expect(rows[0].userId).toBe("b");
  });
});

describe("assignRanks (delte placeringer)", () => {
  it("giver delt placering, og næste spiller springer et nummer over", () => {
    const rows = assignRanks(sortStandings([
      base({ userId: "a", total: 20 }),
      base({ userId: "b", total: 10 }),
      base({ userId: "c", total: 10 }),
      base({ userId: "d", total: 5 }),
    ]));
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it("markerer begge sider af en delt placering som shared", () => {
    const rows = assignRanks(sortStandings([
      base({ userId: "a", total: 10 }),
      base({ userId: "b", total: 10 }),
      base({ userId: "c", total: 5 }),
    ]));
    expect(rows.map((r) => r.shared)).toEqual([true, true, false]);
  });

  it("userId påvirker rækkefølgen, men aldrig placeringen", () => {
    const rows = assignRanks(sortStandings([base({ userId: "zeta" }), base({ userId: "alpha" })]));
    expect(rows.map((r) => r.userId)).toEqual(["alpha", "zeta"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 1]);
  });

  it("håndterer en tom stilling", () => {
    expect(assignRanks([])).toEqual([]);
  });
});

describe("leaders / joinNames (delt titel)", () => {
  it("giver alle på 1. pladsen ved delt titel", () => {
    const rows = assignRanks(sortStandings([
      base({ userId: "a", total: 10 }),
      base({ userId: "b", total: 10 }),
      base({ userId: "c", total: 9 }),
    ]));
    expect(leaders(rows).map((r) => r.userId)).toEqual(["a", "b"]);
  });

  it("sætter navne sammen på dansk", () => {
    expect(joinNames(["Anders"])).toBe("Anders");
    expect(joinNames(["Anders", "Bo"])).toBe("Anders og Bo");
    expect(joinNames(["Anders", "Bo", "Carl"])).toBe("Anders, Bo og Carl");
  });
});
