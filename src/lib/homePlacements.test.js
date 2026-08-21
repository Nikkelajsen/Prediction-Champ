import { describe, it, expect, vi, beforeEach } from "vitest";

// "Dine placeringer" og rating-snapshottet lå inde i en `useEffect` i
// `HjemTab.jsx` og kunne derfor kun efterprøves i hånden (testopsætningen er
// bevidst uden jsdom). Udskilt med `G1`, august 2026 — samme snit som
// `data/invites.js` og `data/createSources.js`.
//
// De to regler, testene findes for, er begge tavse, når de går galt: en
// placering er rækkens ÆGTE rank (delt ved lighed) og ikke dens plads i listen,
// og en konkurrence, hvis stilling fejler, skal springes over frem for at vælte
// hele listen — Hjem ville ellers stå tom, fordi ét kald svarede 500.
vi.mock("./supabase.js", () => ({ db: { select: vi.fn() } }));
vi.mock("./data/standings.js", () => ({ loadMonthlyBoard: vi.fn() }));
vi.mock("./data/competitionState.js", () => ({ computeCompetitionState: vi.fn() }));

import { db } from "./supabase.js";
import { loadMonthlyBoard } from "./data/standings.js";
import { computeCompetitionState } from "./data/competitionState.js";
import { computeCurrentRound, loadHomePlacements, ratingSnapshot } from "./data/home.js";

const MIG = "u1";

beforeEach(() => {
  db.select.mockReset();
  db.select.mockResolvedValue([]);
  loadMonthlyBoard.mockReset();
  loadMonthlyBoard.mockResolvedValue([]);
  computeCompetitionState.mockReset();
});

// Stilling med mig på plads `rank`.
const stilling = (rank, shared = false) => ({ rows: [{ userId: MIG, rank, shared }] });

describe("loadHomePlacements", () => {
  it("lægger månedschampionshippet øverst med sin ægte rank", async () => {
    loadMonthlyBoard.mockResolvedValue([{ userId: MIG, rank: 3, shared: true }]);
    const ud = await loadHomePlacements("t", MIG, [], "2026-08");
    expect(ud).toHaveLength(1);
    expect(ud[0]).toMatchObject({ pos: "3.", shared: true, tab: "championship" });
    expect(ud[0].label).toContain("August 2026");
  });

  it("udelader månedsrækken, når man ikke selv står på boardet", async () => {
    loadMonthlyBoard.mockResolvedValue([{ userId: "andet", rank: 1 }]);
    expect(await loadHomePlacements("t", MIG, [], "2026-08")).toEqual([]);
  });

  it("bevarer konkurrencernes input-orden efter månedsrækken", async () => {
    loadMonthlyBoard.mockResolvedValue([{ userId: MIG, rank: 1 }]);
    computeCompetitionState.mockImplementation(async (t, id) => stilling(id === "c1" ? 2 : 5));
    const ud = await loadHomePlacements("t", MIG, [{ id: "c1", name: "A" }, { id: "c2", name: "B" }], "2026-08");
    expect(ud.map((r) => r.label)).toEqual([ud[0].label, "A", "B"]);
    expect(ud.map((r) => r.pos)).toEqual(["1.", "2.", "5."]);
  });

  // Rank og ikke listeindeks: to delte førstepladser skal begge stå som "1."
  it("bruger rækkens rank og ikke dens plads i listen", async () => {
    computeCompetitionState.mockResolvedValue({ rows: [
      { userId: "andet", rank: 1, shared: true },
      { userId: MIG, rank: 1, shared: true },
    ] });
    const ud = await loadHomePlacements("t", MIG, [{ id: "c1", name: "A" }], "2026-08");
    expect(ud[0]).toMatchObject({ pos: "1.", shared: true });
  });

  it("springer en konkurrence over, hvis dens stilling fejler — resten står", async () => {
    computeCompetitionState.mockImplementation(async (t, id) => {
      if (id === "c1") throw new Error("500");
      return stilling(4);
    });
    const ud = await loadHomePlacements("t", MIG, [{ id: "c1", name: "A" }, { id: "c2", name: "B" }], "2026-08");
    expect(ud.map((r) => r.label)).toEqual(["B"]);
  });

  it("udelader en konkurrence, man ikke selv har en række i", async () => {
    computeCompetitionState.mockResolvedValue({ rows: [{ userId: "andet", rank: 1 }] });
    expect(await loadHomePlacements("t", MIG, [{ id: "c1", name: "A" }], "2026-08")).toEqual([]);
  });

  it("rører slet ikke et arkiveret kort (`_hidden`)", async () => {
    computeCompetitionState.mockResolvedValue(stilling(1));
    const ud = await loadHomePlacements("t", MIG, [{ id: "c1", name: "A", _hidden: true }], "2026-08");
    expect(ud).toEqual([]);
    expect(computeCompetitionState).not.toHaveBeenCalled();
  });

  describe("liga-navnene til grupperingen", () => {
    it("slås op i ét kald og hænges på rækken", async () => {
      db.select.mockResolvedValue([{ id: "g1", name: "Vennerne" }]);
      computeCompetitionState.mockResolvedValue(stilling(1));
      const ud = await loadHomePlacements("t", MIG, [{ id: "c1", name: "A", group_id: "g1" }], "2026-08");
      expect(ud[0]).toMatchObject({ groupId: "g1", groupName: "Vennerne" });
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it("spørger ikke, når ingen konkurrence ligger i en liga", async () => {
      computeCompetitionState.mockResolvedValue(stilling(1));
      const ud = await loadHomePlacements("t", MIG, [{ id: "c1", name: "A" }], "2026-08");
      expect(ud[0].groupName).toBeNull();
      expect(db.select).not.toHaveBeenCalled();
    });

    // Et fejlet navneopslag må ikke koste placeringerne — rækken får et
    // pladsholder-navn, så grupperingen stadig kan tegnes.
    it("falder tilbage til \"Liga\", når navnet ikke kom hjem", async () => {
      db.select.mockRejectedValue(new Error("500"));
      computeCompetitionState.mockResolvedValue(stilling(1));
      const ud = await loadHomePlacements("t", MIG, [{ id: "c1", name: "A", group_id: "g1" }], "2026-08");
      expect(ud[0].groupName).toBe("Liga");
    });
  });
});

// Siden `G139` (21. august 2026) er `ratingSnapshot` en ren FLETNING af to
// opslag frem for en udregning på en hentet rangliste: tallene kommer fra
// `loadRatingSnapshot()` (efterprøvet i `data/standings.test.js`), formkurven
// fra `loadRatingHistory()`. Det, der kan gå galt uden et netværk, er
// fletningen — og det er dét, der måles her.
describe("ratingSnapshot", () => {
  const snap = { rating: 1500, rank: 2, total: 2, provisional: true };

  it("samler tallene og formkurven til ét kort", () => {
    const hist = new Map([[MIG, { move: -3, form: [1, 0, 1] }]]);
    expect(ratingSnapshot(snap, hist, MIG)).toEqual({
      rating: 1500, move: -3, form: [1, 0, 1], rank: 2, total: 2, provisional: true,
    });
  });

  it("nulstiller bevægelse og form, når historikken mangler brugeren", () => {
    expect(ratingSnapshot(snap, new Map(), MIG)).toMatchObject({ move: 0, form: [] });
  });

  // "Ikke på ranglisten" er en gyldig tilstand — en ny bruger uden en afsluttet
  // runde — og ikke en fejl. Kortet viser sin egen tomme udgave. Opslaget
  // svarer `{ none: true }`, og fletningen må ikke lave det om til et kort med
  // en formkurve og ingen tal.
  it("bærer { none: true } uændret igennem", () => {
    expect(ratingSnapshot({ none: true }, new Map([[MIG, { move: 9, form: [2] }]]), MIG))
      .toEqual({ none: true });
  });

  // Fejler opslaget, degraderer HjemTab til `{ none: true }` — men et `null`
  // eller `undefined` må ikke kunne komme igennem som et halvt kort.
  it("tåler et manglende opslag", () => {
    expect(ratingSnapshot(null, new Map(), MIG)).toEqual({ none: true });
  });
});

// ---------------------------------------------------------------------------
// computeCurrentRound → `byCompetition` (G87, 8. august 2026)
//
// Rundestoryens afløsning spurgte indtil august 2026 om brugerens GLOBALE
// indeværende runde, som er regnet på tværs af alle hans konkurrencer. Et
// resultat i én turnering kunne derfor trække rundekortet for en konkurrence i
// en anden. Kortet forsvandt altså for tidligt — den skånsomme retning, men
// stadig et kort, ingen bad om at miste.
//
// `byCompetition` er svaret, og pointen er, at det er GRATIS: kaldet henter
// allerede `competition_matches` for alle konkurrencer, det droppede bare
// kolonnen. Testene her vogter de to ting, en mutationstest afslørede ikke var
// dækket af noget: at kolonnen faktisk hentes, og at `playedCount` tæller de
// SPILLEDE kampe i konkurrencens egen runde og ikke dens kampe i alt.
describe("computeCurrentRound: konkurrencens egen runde (G87)", () => {
  // To konkurrencer, hver med sin egen runde. c1 spiller i uge 28.07, c2 i
  // uge 04.08 — altså præcis den situation, hvor en global runde er forkert.
  // `round_key` er en GENERERET kolonne i databasen (rundens tirsdag), så en
  // rigtig række bærer den altid — og `groupIntoRounds` grupperer på den og
  // ikke på kickoff. En fixture uden den grupperer på `undefined`.
  const KAMPE = [
    { id: "m1", round_key: "2026-07-28", home_team_id: "t1", away_team_id: "t2", kickoff_at: "2026-07-29T18:00:00Z", home_score: 1, away_score: 0 },
    { id: "m2", round_key: "2026-08-04", home_team_id: "t1", away_team_id: "t2", kickoff_at: "2026-08-05T18:00:00Z", home_score: null, away_score: null },
    { id: "m3", round_key: "2026-08-04", home_team_id: "t3", away_team_id: "t4", kickoff_at: "2026-08-05T20:00:00Z", home_score: 2, away_score: 2 },
  ];

  function mockKald({ cms }) {
    db.select.mockReset();
    db.select.mockImplementation((_t, tabel, q) => {
      if (tabel === "competition_matches") return Promise.resolve(cms);
      if (tabel === "matches") return Promise.resolve(KAMPE.filter((m) => q.includes(m.id)));
      if (tabel === "teams") return Promise.resolve([{ id: "t1", name: "A" }, { id: "t2", name: "B" }, { id: "t3", name: "C" }, { id: "t4", name: "D" }]);
      return Promise.resolve([]);
    });
  }

  it("henter competition_id med — uden den findes konkurrencens runde ikke", async () => {
    mockKald({ cms: [{ competition_id: "c1", match_id: "m1" }] });
    await computeCurrentRound("tok", MIG, [{ id: "c1" }]);
    const kald = db.select.mock.calls.find((c) => c[1] === "competition_matches");
    // `toContain("competition_id")` ville IKKE holde: strengen står også i
    // filteret (`competition_id=in.(…)`), så påstanden var sand, uanset hvad
    // der blev valgt. Den skal se på selve `select`-listen.
    expect(kald[2]).toContain("select=competition_id,match_id");
  });

  it("giver hver konkurrence sin EGEN indeværende runde", async () => {
    mockKald({ cms: [
      { competition_id: "c1", match_id: "m1" }, { competition_id: "c1", match_id: "m2" },
      { competition_id: "c2", match_id: "m3" },
    ] });
    const r = await computeCurrentRound("tok", MIG, [{ id: "c1" }, { id: "c2" }]);
    // c1's kampe ligger i to runder; den indeværende er den med et uspillet
    // resultat (04.08). c2 har kun 04.08-runden.
    expect(r.byCompetition.get("c1").roundKey).toBe("2026-08-04");
    expect(r.byCompetition.get("c2").roundKey).toBe("2026-08-04");
  });

  it("playedCount er de SPILLEDE kampe i konkurrencens runde, ikke dens kampe i alt", async () => {
    mockKald({ cms: [
      { competition_id: "c1", match_id: "m2" },   // 04.08, uspillet
      { competition_id: "c2", match_id: "m3" },   // 04.08, spillet
    ] });
    const r = await computeCurrentRound("tok", MIG, [{ id: "c1" }, { id: "c2" }]);
    // Dét er hele forskellen: c1's runde har fortalt INTET endnu, c2's har.
    // Talte vi kampe i stedet for spillede kampe, ville begge stå på 1, og
    // rundestoryen ville blive trukket for c1 uden grund.
    expect(r.byCompetition.get("c1").playedCount).toBe(0);
    expect(r.byCompetition.get("c2").playedCount).toBe(1);
  });

  it("en konkurrence uden kampe står slet ikke i kortet", async () => {
    mockKald({ cms: [{ competition_id: "c1", match_id: "m1" }] });
    const r = await computeCurrentRound("tok", MIG, [{ id: "c1" }, { id: "tom" }]);
    expect(r.byCompetition.has("tom")).toBe(false);
  });
});
