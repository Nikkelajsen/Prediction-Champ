import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../supabase.js", () => ({ db: { select: vi.fn() } }));
import { db } from "../supabase.js";
import { loadCompetitionStatuses } from "./competitionStatus.js";

function mockTables(tables) {
  db.select.mockImplementation(async (token, table, query) => {
    if (!(table in tables)) throw new Error(`uventet tabel i test: ${table}`);
    const rows = tables[table];
    return typeof rows === "function" ? rows(query) : rows;
  });
}

beforeEach(() => { db.select.mockReset(); });

// Kampene ligger så langt ude i fremtiden, at de aldrig er låst, uanset hvornår
// testen køres — en kamp låser 1 time før kickoff (A21).
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
const M = [
  // næste runde (tidligste round_key blandt de tipbare)
  { id: "m1", round_key: "2099-01-05", kickoff_at: iso(30), home_score: null, away_score: null },
  { id: "m2", round_key: "2099-01-05", kickoff_at: iso(31), home_score: null, away_score: null },
  // runden efter — må ALDRIG trække fluebenet ned
  { id: "m3", round_key: "2099-01-12", kickoff_at: iso(37), home_score: null, away_score: null },
];

describe("loadCompetitionStatuses", () => {
  it("henter status for alle konkurrencer med ét opslag i viewet", async () => {
    mockTables({
      competition_status: [
        { competition_id: "c1", matches: 10, scored_matches: 10, concluded: true, can_grow: false },
        { competition_id: "c2", matches: 10, scored_matches: 10, concluded: false, can_grow: true },
      ],
      competition_matches: [],
    });
    const out = await loadCompetitionStatuses("token", "u1", ["c1", "c2"]);
    expect(out.c1).toMatchObject({ matches: 10, scoredMatches: 10, concluded: true, canGrow: false });
    // c2 har alle kampe spillet, men kan stadig vokse — netop dét, sæson-gaten
    // findes for. Kortet må ikke vise pokal.
    expect(out.c2.concluded).toBe(false);
    // ét opslag i viewet uanset antal konkurrencer
    expect(db.select.mock.calls.filter((c) => c[1] === "competition_status")).toHaveLength(1);
  });

  it("giver en tom, men fuldt formet status til en konkurrence uden kampe", async () => {
    mockTables({ competition_status: [], competition_matches: [] });
    const out = await loadCompetitionStatuses("token", "u1", ["c1"]);
    expect(out.c1).toEqual({
      matches: 0, scoredMatches: 0, concluded: false, canGrow: false,
      nextRoundKey: null, nextRoundAllTipped: false, hasNextRound: false,
    });
  });

  it("sætter fluebenet, når næste runde er fuldt tippet — og ikke før", async () => {
    const tables = (preds) => ({
      competition_status: [{ competition_id: "c1", matches: 3, scored_matches: 0, concluded: false, can_grow: true }],
      competition_matches: M.map((m) => ({ competition_id: "c1", match_id: m.id })),
      matches: M,
      predictions: preds,
    });

    mockTables(tables([{ match_id: "m1", pred_home: 1, pred_away: 0 }]));
    let out = await loadCompetitionStatuses("token", "u1", ["c1"]);
    expect(out.c1).toMatchObject({ hasNextRound: true, nextRoundKey: "2099-01-05", nextRoundAllTipped: false });

    // Begge kampe i NÆSTE runde tippet — m3 i runden efter er stadig utippet,
    // og det må ikke tælle med.
    mockTables(tables([
      { match_id: "m1", pred_home: 1, pred_away: 0 },
      { match_id: "m2", pred_home: 2, pred_away: 2 },
    ]));
    out = await loadCompetitionStatuses("token", "u1", ["c1"]);
    expect(out.c1.nextRoundAllTipped).toBe(true);
  });

  it("melder ikke 'alt tippet', når der intet er at tippe", async () => {
    // Alle kampe spillet ⇒ ingen næste runde. Uden `hasNextRound` ville et kort
    // ikke kunne skelne det fra "du er færdig", og en bruger med nul tips ville
    // få et grønt flueben.
    const spillet = M.map((m) => ({ ...m, home_score: 1, away_score: 1 }));
    mockTables({
      competition_status: [{ competition_id: "c1", matches: 3, scored_matches: 3, concluded: true, can_grow: false }],
      competition_matches: spillet.map((m) => ({ competition_id: "c1", match_id: m.id })),
      matches: spillet,
      predictions: [],
    });
    const out = await loadCompetitionStatuses("token", "u1", ["c1"]);
    expect(out.c1.hasNextRound).toBe(false);
    expect(out.c1.nextRoundAllTipped).toBe(false);
  });

  it("springer tips-opslagene over uden en bruger", async () => {
    mockTables({
      competition_status: [{ competition_id: "c1", matches: 3, scored_matches: 0, concluded: false, can_grow: true }],
      competition_matches: M.map((m) => ({ competition_id: "c1", match_id: m.id })),
    });
    const out = await loadCompetitionStatuses("token", null, ["c1"]);
    expect(out.c1.hasNextRound).toBe(false);
    expect(db.select.mock.calls.some((c) => c[1] === "predictions")).toBe(false);
  });

  it("gør intet ved en tom liste", async () => {
    expect(await loadCompetitionStatuses("token", "u1", [])).toEqual({});
    expect(db.select).not.toHaveBeenCalled();
  });
});
