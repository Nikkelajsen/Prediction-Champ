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
import { loadHomePlacements, ratingSnapshot } from "./data/home.js";

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

describe("ratingSnapshot", () => {
  const board = [
    { userId: "andet", rating: 1600, rank: 1 },
    { userId: MIG, rating: 1500, rank: 2, provisional: true },
  ];

  it("samler rating, bevægelse, form og ægte placering", () => {
    const hist = new Map([[MIG, { move: -3, form: [1, 0, 1] }]]);
    expect(ratingSnapshot(board, hist, MIG)).toEqual({
      rating: 1500, move: -3, form: [1, 0, 1], rank: 2, total: 2, provisional: true,
    });
  });

  it("nulstiller bevægelse og form, når historikken mangler brugeren", () => {
    expect(ratingSnapshot(board, new Map(), MIG)).toMatchObject({ move: 0, form: [] });
  });

  // "Ikke på ranglisten" er en gyldig tilstand — en ny bruger uden en afsluttet
  // runde — og ikke en fejl. Kortet viser sin egen tomme udgave.
  it("svarer { none: true } for en bruger uden en række", () => {
    expect(ratingSnapshot(board, new Map(), "ukendt")).toEqual({ none: true });
  });
});
