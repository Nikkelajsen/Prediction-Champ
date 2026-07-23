import { describe, it, expect, vi, beforeEach } from "vitest";

// db mockes, så loaderne kan testes uden netværk/Supabase
vi.mock("./supabase.js", () => ({ db: { select: vi.fn(), del: vi.fn() }, restFetch: vi.fn() }));
import { db, restFetch } from "./supabase.js";
import { loadRoundBoard, loadSeasonBoard, fmtCountdown, monthName, currentMonthKey, loadLatestStory, loadMyGroups, loadGroupDetail, leaveCompetition, moveCompetitionToGroup } from "./data.js";

// mock-svar pr. tabel/view
function mockTables(tables) {
  db.select.mockImplementation(async (token, table) => {
    if (!(table in tables)) throw new Error(`uventet tabel i test: ${table}`);
    return tables[table];
  });
}

// bloksyntaks er vigtig: mockReset() returnerer mocken, og en returneret
// funktion ville blive kørt af vitest som cleanup-hook (uden argumenter)
beforeEach(() => { db.select.mockReset(); db.del.mockReset(); restFetch.mockReset(); });

describe("loadRoundBoard (round_standings-view)", () => {
  it("mapper viewets rækker til stillingsrækker med navne", async () => {
    mockTables({
      matches: [
        { id: "m1", home_score: 2, away_score: 1 },
        { id: "m2", home_score: null, away_score: null },
      ],
      round_standings: [
        { user_id: "u1", total_points: 4, matches: 2, exact_count: 1 },
        { user_id: "u2", total_points: 1, matches: 2, exact_count: 0 },
      ],
      profiles: [
        { id: "u1", display_name: "Anna" },
        { id: "u2", display_name: "Bo" },
      ],
    });
    const board = await loadRoundBoard("token", "2026-07-14");
    expect(board.rows).toEqual([
      { userId: "u1", player: "Anna", total: 4, exactCount: 1, matches: 2 },
      { userId: "u2", player: "Bo", total: 1, exactCount: 0, matches: 2 },
    ]);
    expect(board.totalMatches).toBe(2);
    expect(board.playedMatches).toBe(1);
    expect(board.isComplete).toBe(false);
  });

  it("markerer runden som komplet når alle kampe har resultat", async () => {
    mockTables({
      matches: [{ id: "m1", home_score: 0, away_score: 0 }],
      round_standings: [],
      profiles: [],
    });
    const board = await loadRoundBoard("token", "2026-07-14");
    expect(board.isComplete).toBe(true);
    expect(board.rows).toEqual([]);
  });

  it("giver tom stilling uden kampe i runden", async () => {
    mockTables({ matches: [] });
    const board = await loadRoundBoard("token", "2026-07-14");
    expect(board).toEqual({ rows: [], totalMatches: 0, playedMatches: 0, isComplete: false });
  });
});

describe("loadSeasonBoard (season_standings-view)", () => {
  it("giver null når ligaen ingen sæson har", async () => {
    mockTables({ seasons: [] });
    expect(await loadSeasonBoard("token", "liga-1")).toBeNull();
  });

  it("mapper sæsonstillingen og tæller fremdrift", async () => {
    mockTables({
      seasons: [{ id: "s1", name: "2026/2027", start_date: "2026-07-01" }],
      matches: [
        { id: "m1", home_score: 1, away_score: 0 },
        { id: "m2", home_score: 2, away_score: 2 },
        { id: "m3", home_score: null, away_score: null },
      ],
      season_standings: [{ user_id: "u1", total_points: 6, matches: 2, exact_count: 2 }],
      profiles: [{ id: "u1", display_name: "Anna" }],
    });
    const board = await loadSeasonBoard("token", "liga-1");
    expect(board.season.id).toBe("s1");
    expect(board.rows[0]).toEqual({ userId: "u1", player: "Anna", total: 6, exactCount: 2, matches: 2 });
    expect(board.playedMatches).toBe(2);
    expect(board.totalMatches).toBe(3);
    expect(board.isComplete).toBe(false);
  });
});

describe("loadLatestStory (latest_story-view)", () => {
  it("returnerer seneste ikke-afviste historie", async () => {
    mockTables({ latest_story: [{ id: "s1", round_key: "2026-07-21", headline: "H", body: "B", dismissed_at: null }] });
    const s = await loadLatestStory("token");
    expect(s.id).toBe("s1");
  });
  it("returnerer null når den seneste historie er afvist", async () => {
    mockTables({ latest_story: [{ id: "s1", round_key: "2026-07-21", dismissed_at: "2026-07-22T00:00:00Z" }] });
    expect(await loadLatestStory("token")).toBeNull();
  });
  it("returnerer null uden historier", async () => {
    mockTables({ latest_story: [] });
    expect(await loadLatestStory("token")).toBeNull();
  });
});

describe("liga-laget (grupper)", () => {
  it("loadMyGroups tæller medlemmer + konkurrencer pr. liga og bevarer egen rolle", async () => {
    db.select.mockImplementation(async (token, table, query) => {
      if (table === "group_members" && query.includes("user_id=eq.")) return [{ group_id: "g1", role: "admin" }];
      if (table === "group_members") return [{ group_id: "g1" }, { group_id: "g1" }]; // alle medlemmer
      if (table === "groups") return [{ id: "g1", name: "Kontoret", invite_code: "abc" }];
      if (table === "competitions") return [{ id: "c1", group_id: "g1" }, { id: "c2", group_id: "g1" }];
      throw new Error(`uventet tabel: ${table}`);
    });
    const res = await loadMyGroups("token", "u1");
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ id: "g1", role: "admin", memberCount: 2, compCount: 2 });
  });

  it("loadMyGroups giver tom liste uden medlemskaber", async () => {
    db.select.mockImplementation(async () => []);
    expect(await loadMyGroups("token", "u1")).toEqual([]);
  });

  it("loadGroupDetail samler medlemmer, egen rolle og deltagelse pr. konkurrence", async () => {
    db.select.mockImplementation(async (token, table, query) => {
      switch (table) {
        case "groups": return [{ id: "g1", name: "Kontoret", invite_code: "abc" }];
        case "group_members": return [
          { user_id: "u1", role: "admin", joined_at: "2026-01-01" },
          { user_id: "u2", role: "member", joined_at: "2026-01-02" },
        ];
        case "profiles": return [{ id: "u1", display_name: "Anna" }, { id: "u2", display_name: "Bo" }];
        case "competitions": return [{ id: "c1", name: "Superliga", mode: "full_season", group_id: "g1" }];
        case "competition_participants":
          return query.includes("user_id=eq.u1") ? [{ competition_id: "c1" }] : [{ competition_id: "c1" }, { competition_id: "c1" }];
        default: throw new Error(`uventet tabel: ${table}`);
      }
    });
    const d = await loadGroupDetail("token", "u1", "g1");
    expect(d.isMember).toBe(true);
    expect(d.myRole).toBe("admin");
    expect(d.members).toHaveLength(2);
    expect(d.competitions[0]).toMatchObject({ id: "c1", joined: true, participantCount: 2 });
  });

  it("leaveCompetition returnerer true når rækken slettes, false når RLS blokerer", async () => {
    db.del.mockResolvedValueOnce([{ competition_id: "c1", user_id: "u1" }]);
    expect(await leaveCompetition("token", "u1", "c1")).toBe(true);
    db.del.mockResolvedValueOnce([]); // blokeret (tips på låst runde)
    expect(await leaveCompetition("token", "u1", "c1")).toBe(false);
  });

  it("moveCompetitionToGroup kalder RPC med rigtige parametre", async () => {
    restFetch.mockResolvedValueOnce(null);
    await moveCompetitionToGroup("token", "c1", "g1");
    expect(restFetch).toHaveBeenCalledWith("/rest/v1/rpc/move_competition_to_group",
      expect.objectContaining({ method: "POST", token: "token", body: { p_comp_id: "c1", p_group_id: "g1" } }));
  });
});

describe("dato-helpers", () => {
  it("fmtCountdown viser dage/timer/minutter afhængigt af afstand", () => {
    const now = Date.now();
    expect(fmtCountdown(now + 2 * 24 * 3600 * 1000 + 3 * 3600 * 1000)).toMatch(/^2 d 3 t$/);
    expect(fmtCountdown(now + 2 * 3600 * 1000 + 5 * 60 * 1000)).toMatch(/^2 t [45] min$/);
    expect(fmtCountdown(now + 10 * 60 * 1000)).toMatch(/^(9|10) min$/);
    expect(fmtCountdown(now - 1000)).toBe("0 min");
  });

  it("monthName giver dansk månedsnavn med stort begyndelsesbogstav", () => {
    const name = monthName("2026-07");
    expect(name.charAt(0)).toBe(name.charAt(0).toUpperCase());
    expect(name).toContain("2026");
  });

  it("currentMonthKey har formatet YYYY-MM", () => {
    expect(currentMonthKey()).toMatch(/^\d{4}-\d{2}$/);
  });
});
