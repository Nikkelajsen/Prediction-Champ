import { describe, it, expect } from "vitest";
import { CREATE_TYPES, createTypeById, pickRandomFromRounds, weeklyCouponName, buildSpec } from "./createTypes.js";

// Galleriet er kun en oversættelse: seks kort → de fem eksisterende modes plus
// parametre. Testene her holder oversættelsen fast, så opret-skærmen kan være
// en tynd container uden egen spec-logik.

describe("CREATE_TYPES", () => {
  it("dækker alle fem modes — og kun dem", () => {
    expect([...new Set(CREATE_TYPES.map((t) => t.mode))].sort())
      .toEqual(["custom", "full_season", "random", "team"]); // time_range bor under Custom-kortet
  });

  it("Sæson står øverst og er det anbefalede — præcis ét kort er det", () => {
    // Rækkefølgen er en anbefaling, ikke kun varighed: det øverste kort er dét,
    // produktet vil have flest i. Uden denne test kan den skride tavst ved
    // næste redigering af listen.
    expect(CREATE_TYPES[0].id).toBe("season");
    expect(CREATE_TYPES[0].recommended).toBe(true);
    expect(CREATE_TYPES.filter((t) => t.recommended)).toHaveLength(1);
  });

  it("hvert kort har både varigheds-mærkat og beskrivelse", () => {
    // De to akser, kortet skal bære: HVOR LÆNGE og HVILKE kampe.
    for (const t of CREATE_TYPES) {
      expect(t.duration, t.id).toBeTruthy();
      expect(t.subtitle, t.id).toBeTruthy();
    }
  });

  it("kårings-tilvalget (multiRound) er slukket for én-rundes typer", () => {
    // I en én-rundes konkurrence ER vinderen ugens bedste.
    expect(createTypeById("weekly_coupon").multiRound).toBe(false);
    expect(createTypeById("quick_pick").multiRound).toBe(false);
    expect(createTypeById("quick_league").multiRound).toBe(true);
    expect(createTypeById("season").multiRound).toBe(true);
  });
});

describe("pickRandomFromRounds", () => {
  // Deterministisk "shuffle": identiteten — så testene ser udvælgelsens regler,
  // ikke tilfældet.
  const keep = (arr) => arr;
  const pool = [
    { id: "a1", round_key: "2026-08-04" },
    { id: "a2", round_key: "2026-08-04" },
    { id: "a3", round_key: "2026-08-04" },
    { id: "b1", round_key: "2026-08-11" },
    { id: "b2", round_key: "2026-08-11" },
    { id: "c1", round_key: "2026-08-18" },
  ];

  it("rounds=1 er præcis den gamle Quick Pick-adfærd: kun nærmeste runde", () => {
    expect(pickRandomFromRounds(pool, { count: 2, rounds: 1, shuffle: keep })).toEqual(["a1", "a2"]);
  });

  it("tager de N nærmeste runder og trækker count PR. RUNDE", () => {
    expect(pickRandomFromRounds(pool, { count: 2, rounds: 2, shuffle: keep }))
      .toEqual(["a1", "a2", "b1", "b2"]);
  });

  it("klipper til rundens faktiske udbud i stedet for at låne fra næste runde", () => {
    expect(pickRandomFromRounds(pool, { count: 5, rounds: 3, shuffle: keep }))
      .toEqual(["a1", "a2", "a3", "b1", "b2", "c1"]);
  });

  it("flere runder end puljen har giver bare alle runder", () => {
    expect(pickRandomFromRounds(pool, { count: 1, rounds: 99, shuffle: keep }))
      .toEqual(["a1", "b1", "c1"]);
  });

  it("tom pulje giver tom liste", () => {
    expect(pickRandomFromRounds([], { count: 8, rounds: 6 })).toEqual([]);
  });
});

describe("weeklyCouponName", () => {
  // Det genererede navn er selve featuren for Ugens kupon-kortet — alle andre
  // kort starter tomt (B6). Selve datoformatet ejes af roundLabel (scoring.js).
  it("bygger navnet af runde-etiketten", () => {
    expect(weeklyCouponName("2026-08-04")).toMatch(/^Ugens kupon \d{2}\.\d{2}\. – \d{2}\.\d{2}\.$|^Ugens kupon /);
    expect(weeklyCouponName(null)).toBe("Ugens kupon");
  });
});

describe("buildSpec", () => {
  it("Sæson-kortet bliver full_season med tournaments", () => {
    expect(buildSpec({
      typeId: "season", name: "S", groupId: "g1", awards: true,
      tournaments: [{ leagueId: "L1", seasonId: "S1" }],
    })).toEqual({
      name: "S", groupId: "g1", awards: true, mode: "full_season",
      tournaments: [{ leagueId: "L1", seasonId: "S1" }],
    });
  });

  it("Favorithold-kortet bliver team med teams-listen", () => {
    expect(buildSpec({
      typeId: "team", name: "F", groupId: null,
      teams: [{ leagueId: "L1", seasonId: "S1", teamId: "T1" }],
    })).toMatchObject({ mode: "team", teams: [{ leagueId: "L1", seasonId: "S1", teamId: "T1" }], awards: false });
  });

  it("Custom-kortet skifter mellem håndpluk og periode på method", () => {
    expect(buildSpec({ typeId: "custom", name: "C", method: "pick", matchIds: ["x1"] }))
      .toMatchObject({ mode: "custom", matchIds: ["x1"] });
    expect(buildSpec({
      typeId: "custom", name: "C", method: "period",
      leagueId: "L1", seasonId: "S1", startDate: "2026-08-01", endDate: "2026-08-31",
    })).toMatchObject({ mode: "time_range", leagueId: "L1", seasonId: "S1", startDate: "2026-08-01", endDate: "2026-08-31" });
  });

  it("random-kortene bærer count og rounds — Ugens kupon med sit preset", () => {
    expect(buildSpec({ typeId: "quick_league", name: "QL", matchIds: ["x1"], randomCount: 8, rounds: 6 }))
      .toMatchObject({ mode: "random", randomCount: 8, rounds: 6 });
    // uden eksplicitte værdier falder kortet tilbage til sine presets
    expect(buildSpec({ typeId: "weekly_coupon", name: "UK", matchIds: ["x1"] }))
      .toMatchObject({ mode: "random", randomCount: 8, rounds: 1 });
    expect(buildSpec({ typeId: "quick_pick", name: "QP", matchIds: ["x1"] }))
      .toMatchObject({ mode: "random", randomCount: 6, rounds: 1 });
  });

  it("en ukendt korttype er en fejl, ikke en tavs default", () => {
    expect(() => buildSpec({ typeId: "knockout", name: "K" })).toThrow("Ukendt korttype");
  });
});
