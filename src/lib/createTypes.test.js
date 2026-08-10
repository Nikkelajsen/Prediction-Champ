import { describe, it, expect } from "vitest";
import {
  CREATE_TYPES, MAX_MATCHES_PER_ROUND, createTypeById, pickRandomFromRounds, pickPerRound,
  filterFromRoundStart, roundProgress, weeklyCouponName, buildSpec,
} from "./createTypes.js";

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

describe("filterFromRoundStart", () => {
  const pool = [
    { id: "a1", round_key: "2026-08-04" },
    { id: "b1", round_key: "2026-08-11" },
    { id: "c1", round_key: "2026-08-18" },
  ];

  it("lader puljen være i fred, når der startes i indeværende runde", () => {
    expect(filterFromRoundStart(pool, { start: "current", currentKey: "2026-08-04" })).toEqual(pool);
  });

  it("smider indeværende runde væk, når der startes i en ny", () => {
    expect(filterFromRoundStart(pool, { start: "next", currentKey: "2026-08-04" }).map((m) => m.id))
      .toEqual(["b1", "c1"]);
  });

  // Vinduet i pickRandomFromRounds tager de N FØRSTE rundenøgler, så filtreringen
  // er alt, der skal til for at rykke hele Quick League-vinduet en uge frem.
  it("rykker hele rundevinduet med, ikke kun den første runde", () => {
    const uden = filterFromRoundStart(pool, { start: "next", currentKey: "2026-08-04" });
    expect(pickRandomFromRounds(uden, { count: 1, rounds: 2, shuffle: (a) => a }))
      .toEqual(["b1", "c1"]);
  });

  // Er indeværende runde allerede væk af sig selv (alt spillet), giver de to
  // valg samme pulje — og det er den rigtige adfærd, ikke en tom liste.
  it("er uskadelig, når puljen allerede er forbi indeværende runde", () => {
    const senere = pool.slice(1);
    expect(filterFromRoundStart(senere, { start: "next", currentKey: "2026-08-04" })).toEqual(senere);
  });

  it("uden rundenøgle filtreres der ikke — et gæt ville være værre end intet", () => {
    expect(filterFromRoundStart(pool, { start: "next", currentKey: "" })).toEqual(pool);
    expect(filterFromRoundStart(null, {})).toEqual([]);
  });
});

describe("roundProgress", () => {
  // Nævneren er hele runden, også de spillede kampe — det er dét, valget mellem
  // indeværende og ny runde skal træffes på. "1 i nærmeste runde" fortalte kun,
  // hvad der var tilbage, og aldrig hvorfor der kun var én.
  const om = (min) => new Date(Date.now() + min * 60000).toISOString();
  const siden = (min) => new Date(Date.now() - min * 60000).toISOString();

  it("tæller spillede, igangværende og resterende kampe i samme runde", () => {
    const ud = roundProgress([
      { id: "m1", kickoff_at: siden(200), home_score: 2, away_score: 1 }, // færdig
      { id: "m2", kickoff_at: siden(30) },                                // i gang
      { id: "m3", kickoff_at: om(20) },                                   // låser om 20 min (inden for 1 time)
      { id: "m4", kickoff_at: om(3000) },                                 // kan stadig tippes
    ]);
    expect(ud).toEqual({ total: 4, locked: 3, open: 1 });
  });

  // "Spillet" er her det samme som LÅST: for den, der skal beslutte sig, er en
  // kamp i gang lige så tabt som en, der er fløjtet af.
  it("regner en igangværende kamp som væk, ikke som tilgængelig", () => {
    expect(roundProgress([{ id: "m", kickoff_at: siden(10) }])).toEqual({ total: 1, locked: 1, open: 0 });
  });

  it("en tom runde giver nul hele vejen igennem", () => {
    expect(roundProgress([])).toEqual({ total: 0, locked: 0, open: 0 });
    expect(roundProgress(null)).toEqual({ total: 0, locked: 0, open: 0 });
  });
});

describe("MAX_MATCHES_PER_ROUND", () => {
  // Loftet er TEKNISK, ikke sportsligt: det fanger en tastefejl og skal ikke
  // kunne forveksles med rundens udbud. pickRandomFromRounds klipper alligevel.
  it("er højere end nogen rigtig runde og bruges ikke som udbudsgrænse", () => {
    expect(MAX_MATCHES_PER_ROUND).toBeGreaterThanOrEqual(50);
    const pool = [{ id: "a1", round_key: "2026-08-04" }, { id: "a2", round_key: "2026-08-04" }];
    expect(pickRandomFromRounds(pool, { count: MAX_MATCHES_PER_ROUND, rounds: 1, shuffle: (a) => a }))
      .toEqual(["a1", "a2"]);
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

describe("pickPerRound (loft pr. runde, fordelt på turneringer)", () => {
  // r1: liga A har 4 kampe, liga B har 3, liga C har 2 — ni i alt.
  const m = (id, round, league, hour) =>
    ({ id, round_key: round, _leagueId: league, kickoff_at: `2026-08-${round}T${String(hour).padStart(2, "0")}:00:00Z` });
  const pool = [
    m("a1", "10", "A", 18), m("a2", "10", "A", 19), m("a3", "10", "A", 20), m("a4", "10", "A", 21),
    m("b1", "10", "B", 17), m("b2", "10", "B", 22), m("b3", "10", "B", 23),
    m("c1", "10", "C", 16), m("c2", "10", "C", 15),
  ];

  it("uden loft kommer alt med", () => {
    expect(pickPerRound(pool, { perRound: 0 })).toHaveLength(9);
    expect(pickPerRound(pool, {})).toHaveLength(9);
  });

  it("fordeler loftet jævnt på turneringerne", () => {
    const ids = pickPerRound(pool, { perRound: 6 });
    expect(ids).toHaveLength(6);
    const perLeague = {};
    for (const id of ids) perLeague[id[0]] = (perLeague[id[0]] || 0) + 1;
    expect(perLeague).toEqual({ a: 2, b: 2, c: 2 });
  });

  // Brugerens egen betingelse: er der færre kampe end loftet, er det bare dem, der er.
  it("tager alt, når runden har færre kampe end loftet", () => {
    expect(pickPerRound(pool, { perRound: 20 })).toHaveLength(9);
  });

  it("lader de øvrige fylde pladsen ud, når en turnering løber tør", () => {
    // Loft 8: C har kun 2, så A og B må dele de sidste — ingen huller.
    const ids = pickPerRound(pool, { perRound: 8 });
    expect(ids).toHaveLength(8);
    const perLeague = {};
    for (const id of ids) perLeague[id[0]] = (perLeague[id[0]] || 0) + 1;
    expect(perLeague.c).toBe(2);
    expect(perLeague.a + perLeague.b).toBe(6);
  });

  it("er deterministisk — samme pulje giver samme kampe", () => {
    expect(pickPerRound(pool, { perRound: 5 })).toEqual(pickPerRound(pool.slice().reverse(), { perRound: 5 }));
  });

  it("giver den ekstra plads til den turnering, der spiller først", () => {
    // Loft 4 på tre turneringer: 2/1/1, og de to går til C, som har rundens
    // tidligste kickoff (15:00).
    const ids = pickPerRound(pool, { perRound: 4 });
    expect(ids.filter((id) => id[0] === "c")).toHaveLength(2);
  });

  it("gælder PR. RUNDE og ikke for hele perioden", () => {
    const two = [...pool, m("a9", "17", "A", 18), m("b9", "17", "B", 19), m("c9", "17", "C", 20)];
    const ids = pickPerRound(two, { perRound: 2 });
    expect(ids).toHaveLength(4); // 2 i runde 10 + 2 i runde 17
  });
});

describe("buildSpec — custom/periode", () => {
  const base = { typeId: "custom", name: "Test", groupId: "g1", method: "period", startDate: "2026-08-01", endDate: "2026-08-31" };

  it("uden loft er det en VOKSENDE periode (time_range)", () => {
    const spec = buildSpec({ ...base, tournaments: [{ leagueId: "l1", seasonId: "s1" }], leagueId: "l1", seasonId: "s1" });
    expect(spec.mode).toBe("time_range");
    expect(spec.startDate).toBe("2026-08-01");
  });

  it("bærer flere turneringer videre", () => {
    const tournaments = [{ leagueId: "l1", seasonId: "s1" }, { leagueId: "l2", seasonId: "s2" }];
    expect(buildSpec({ ...base, tournaments }).tournaments).toEqual(tournaments);
  });

  // Loftet gør konkurrencen håndplukket, ellers ville efterfyldningen bryde det.
  it("MED loft bliver den til et frosset udvalg (custom)", () => {
    const spec = buildSpec({ ...base, perRound: 10, matchIds: ["m1", "m2"] });
    expect(spec.mode).toBe("custom");
    expect(spec.matchIds).toEqual(["m1", "m2"]);
  });
});
