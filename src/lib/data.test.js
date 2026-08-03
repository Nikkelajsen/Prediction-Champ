import { describe, it, expect, vi, beforeEach } from "vitest";

// db mockes, så loaderne kan testes uden netværk/Supabase
vi.mock("./supabase.js", () => ({ db: { select: vi.fn(), del: vi.fn(), insert: vi.fn() }, restFetch: vi.fn() }));
import { db, restFetch } from "./supabase.js";
import { computeCompetitionState, computeHomeTips, loadRoundBoard, loadRoundsAvailable, loadSeasonBoard, fmtCountdown, monthName, currentMonthKey, loadLatestStory, loadCareerProfile, loadCareerMilestones, loadMyGroups, loadGroupDetail, joinCompetition, leaveCompetition, leaveGroup, moveCompetitionToGroup, createCompetition, joinByInviteCode, inviteCodeFrom } from "./data.js";
import { QUIET_TIER_MIN } from "./stories.js";

// mock-svar pr. tabel/view. En værdi må være en funktion, når svaret afhænger
// af selve forespørgslen (fx et filter, testen vil holde loaderen op på).
function mockTables(tables) {
  db.select.mockImplementation(async (token, table, query) => {
    if (!(table in tables)) throw new Error(`uventet tabel i test: ${table}`);
    const rows = tables[table];
    return typeof rows === "function" ? rows(query) : rows;
  });
}

// bloksyntaks er vigtig: mockReset() returnerer mocken, og en returneret
// funktion ville blive kørt af vitest som cleanup-hook (uden argumenter)
beforeEach(() => { db.select.mockReset(); db.del.mockReset(); db.insert.mockReset(); restFetch.mockReset(); });

// Rundeligaen slår først turneringerne op (leagues → seasons), så begge tabeller
// skal med i mocken, selv når testen handler om noget andet.
const OFFICIAL = { leagues: [{ id: "L1" }], seasons: [{ id: "s1" }] };

describe("loadRoundBoard (round_standings-view)", () => {
  it("mapper viewets rækker til stillingsrækker med navne", async () => {
    mockTables({
      ...OFFICIAL,
      matches: [
        { id: "m1", home_score: 2, away_score: 1 },
        { id: "m2", home_score: null, away_score: null },
      ],
      round_standings: [
        { user_id: "u1", total_points: 4, matches: 2, exact_count: 1, outcome_count: 1, avg_goal_error: "1.5000" },
        { user_id: "u2", total_points: 1, matches: 2, exact_count: 0, outcome_count: 1, avg_goal_error: "2.0000" },
      ],
      profiles: [
        { id: "u1", display_name: "Anna" },
        { id: "u2", display_name: "Bo" },
      ],
    });
    const board = await loadRoundBoard("token", "2026-07-14");
    expect(board.rows).toEqual([
      { userId: "u1", player: "Anna", total: 4, exactCount: 1, outcomeCount: 1, roundWins: 0, avgGoalError: 1.5, matches: 2, rank: 1, shared: false },
      { userId: "u2", player: "Bo", total: 1, exactCount: 0, outcomeCount: 1, roundWins: 0, avgGoalError: 2, matches: 2, rank: 2, shared: false },
    ]);
    expect(board.totalMatches).toBe(2);
    expect(board.playedMatches).toBe(1);
    expect(board.isComplete).toBe(false);
  });

  it("markerer runden som komplet når alle kampe har resultat", async () => {
    mockTables({
      ...OFFICIAL,
      matches: [{ id: "m1", home_score: 0, away_score: 0 }],
      round_standings: [],
      profiles: [],
    });
    const board = await loadRoundBoard("token", "2026-07-14");
    expect(board.isComplete).toBe(true);
    expect(board.rows).toEqual([]);
  });

  it("giver tom stilling uden kampe i runden", async () => {
    mockTables({ ...OFFICIAL, matches: [] });
    const board = await loadRoundBoard("token", "2026-07-14");
    expect(board).toEqual({ rows: [], totalMatches: 0, playedMatches: 0, isComplete: false });
  });

  // En skjult turnerings kampe må ikke holde runden åben: kampantallet afgør
  // isComplete, og dermed om pokalen vises for kampe, ingen kan se eller tippe.
  it("henter kun kampe fra sæsoner under officielle turneringer", async () => {
    const queries = [];
    mockTables({
      leagues: [{ id: "L1" }],
      seasons: [{ id: "s1" }],
      matches: (q) => { queries.push(q); return [{ id: "m1", home_score: 2, away_score: 0 }]; },
      round_standings: [],
      profiles: [],
    });
    const board = await loadRoundBoard("token", "2026-07-14");
    expect(queries[0]).toContain("season_id=in.(s1)");
    expect(board.totalMatches).toBe(1);
    expect(board.isComplete).toBe(true);
  });

  it("giver tomt board, når ingen turnering er officiel", async () => {
    mockTables({ leagues: [] });
    const board = await loadRoundBoard("token", "2026-07-14");
    expect(board).toEqual({ rows: [], totalMatches: 0, playedMatches: 0, isComplete: false });
  });

  // De to niveauer i Championship: 'ALL' er den samlede stilling (den store
  // titel), et liga-id er stillingen for netop den turnering. Både stillingen
  // OG kampantallet skal følge scopet — ellers kan de to ikke tale sammen.
  it("henter den samlede stilling som standard", async () => {
    const queries = { leagues: [], round_standings: [] };
    mockTables({
      leagues: (q) => { queries.leagues.push(q); return [{ id: "L1" }]; },
      seasons: [{ id: "s1" }],
      matches: [{ id: "m1", home_score: 1, away_score: 1 }],
      round_standings: (q) => { queries.round_standings.push(q); return []; },
      profiles: [],
    });
    await loadRoundBoard("token", "2026-07-14");
    expect(queries.leagues[0]).toContain("is_official=is.true");
    expect(queries.round_standings[0]).toContain("scope=eq.ALL");
  });

  it("henter én turnerings stilling, når der gives et scope", async () => {
    const queries = { leagues: [], round_standings: [] };
    mockTables({
      leagues: (q) => { queries.leagues.push(q); return [{ id: "L2" }]; },
      seasons: [{ id: "s2" }],
      matches: [{ id: "m1", home_score: 1, away_score: 1 }],
      round_standings: (q) => { queries.round_standings.push(q); return []; },
      profiles: [],
    });
    await loadRoundBoard("token", "2026-07-14", "L2");
    // Ikke is_official: er turneringen valgt i vælgeren, ER den officiel — og
    // kampantallet skal komme fra netop dens sæsoner.
    expect(queries.leagues[0]).toContain("id=eq.L2");
    expect(queries.round_standings[0]).toContain("scope=eq.L2");
  });
});

describe("loadRoundsAvailable (runde-dropdownen)", () => {
  it("giver runder med spillede kampe, nyeste først", async () => {
    mockTables({
      ...OFFICIAL,
      matches: [{ round_key: "2026-07-07" }, { round_key: "2026-07-14" }, { round_key: "2026-07-07" }],
    });
    expect(await loadRoundsAvailable("token")).toEqual(["2026-07-14", "2026-07-07"]);
  });

  it("spørger kun efter sæsoner under officielle turneringer", async () => {
    const queries = [];
    mockTables({
      leagues: [{ id: "L1" }, { id: "L2" }],
      seasons: [{ id: "s1" }, { id: "s2" }],
      matches: (q) => { queries.push(q); return []; },
    });
    await loadRoundsAvailable("token");
    expect(queries[0]).toContain("season_id=in.(s1,s2)");
  });

  it("giver ingen runder, når ingen turnering er officiel", async () => {
    mockTables({ leagues: [] });
    expect(await loadRoundsAvailable("token")).toEqual([]);
  });

  it("begrænser runderne til den valgte turnering", async () => {
    const seen = [];
    mockTables({
      leagues: (q) => { seen.push(q); return [{ id: "L2" }]; },
      seasons: [{ id: "s2" }],
      matches: [{ round_key: "2026-07-14" }],
    });
    expect(await loadRoundsAvailable("token", "L2")).toEqual(["2026-07-14"]);
    expect(seen[0]).toContain("id=eq.L2");
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
      season_standings: [{ user_id: "u1", total_points: 6, matches: 2, exact_count: 2, outcome_count: 0, round_wins: 1, avg_goal_error: "0.0000" }],
      profiles: [{ id: "u1", display_name: "Anna" }],
    });
    const board = await loadSeasonBoard("token", "liga-1");
    expect(board.season.id).toBe("s1");
    expect(board.rows[0]).toEqual({ userId: "u1", player: "Anna", total: 6, exactCount: 2, outcomeCount: 0, roundWins: 1, avgGoalError: 0, matches: 2, rank: 1, shared: false });
    expect(board.playedMatches).toBe(2);
    expect(board.totalMatches).toBe(3);
    expect(board.isComplete).toBe(false);
  });
});

describe("computeCompetitionState (konkurrence-stillingen)", () => {
  const RULES = { exact: 3, outcome: 1 };
  // To runder à to kampe. Kickoff styrer round_key via groupIntoRounds.
  const MATCHES = [
    { id: "m1", kickoff_at: "2026-07-06T18:00:00Z", round_key: "2026-07-06", home_score: 2, away_score: 1 },
    { id: "m2", kickoff_at: "2026-07-07T18:00:00Z", round_key: "2026-07-06", home_score: 0, away_score: 0 },
    { id: "m3", kickoff_at: "2026-07-13T18:00:00Z", round_key: "2026-07-13", home_score: 1, away_score: 1 },
    { id: "m4", kickoff_at: "2026-07-14T18:00:00Z", round_key: "2026-07-13", home_score: 3, away_score: 0 },
  ];
  const mockComp = (predictions, profiles) => mockTables({
    competition_participants: profiles.map((p) => ({ user_id: p.id })),
    profiles,
    competition_matches: MATCHES.map((m) => ({ match_id: m.id })),
    matches: MATCHES,
    predictions,
    teams: [],
  });

  it("bruger hele stigen: rundesejre slår en bedre målafvigelse", async () => {
    // Anna: 2-1(3) · 1-0(0) | 5-5(1) · 0-3(0)  ⇒ 4 point, 1 præcis, 1 udfald, afvigelse 15/4
    // Bo:   1-0(1) · 0-0(3) | 2-0(0) · 0-2(0)  ⇒ 4 point, 1 præcis, 1 udfald, afvigelse 9/4
    // Runde 1: Bo 4 > Anna 3. Runde 2: Anna 1 > Bo 0. Én rundesejr hver ⇒ Bos
    // lavere afvigelse afgør. Giver vi Anna en rundesejr mere, vender det.
    await mockComp([
      { match_id: "m1", user_id: "u1", pred_home: 2, pred_away: 1 },
      { match_id: "m2", user_id: "u1", pred_home: 1, pred_away: 0 },
      { match_id: "m3", user_id: "u1", pred_home: 5, pred_away: 5 },
      { match_id: "m4", user_id: "u1", pred_home: 0, pred_away: 3 },
      { match_id: "m1", user_id: "u2", pred_home: 1, pred_away: 0 },
      { match_id: "m2", user_id: "u2", pred_home: 0, pred_away: 0 },
      { match_id: "m3", user_id: "u2", pred_home: 2, pred_away: 0 },
      { match_id: "m4", user_id: "u2", pred_home: 0, pred_away: 2 },
    ], [{ id: "u1", display_name: "Anna" }, { id: "u2", display_name: "Bo" }]);
    const { rows } = await computeCompetitionState("token", "c1", RULES);
    expect(rows.map((r) => r.player)).toEqual(["Bo", "Anna"]);
    expect(rows.map((r) => r.total)).toEqual([4, 4]);
    expect(rows.map((r) => r.exactCount)).toEqual([1, 1]);
    expect(rows.map((r) => r.outcomeCount)).toEqual([1, 1]);
    expect(rows.map((r) => r.roundWins)).toEqual([1, 1]);
    expect(rows.map((r) => r.avgGoalError)).toEqual([2.25, 3.75]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("giver delt placering og delt rundesejr ved fuldstændig lighed", async () => {
    // Identiske gæt ⇒ ægte lige hele vejen ned, og rundesejren tæller for begge.
    const preds = (uid) => [
      { match_id: "m1", user_id: uid, pred_home: 2, pred_away: 1 },
      { match_id: "m2", user_id: uid, pred_home: 0, pred_away: 0 },
      { match_id: "m3", user_id: uid, pred_home: 1, pred_away: 1 },
      { match_id: "m4", user_id: uid, pred_home: 3, pred_away: 0 },
    ];
    await mockComp([...preds("u1"), ...preds("u2"), { match_id: "m1", user_id: "u3", pred_home: 0, pred_away: 5 }],
      [{ id: "u1", display_name: "Anna" }, { id: "u2", display_name: "Bo" }, { id: "u3", display_name: "Carl" }]);
    const { rows } = await computeCompetitionState("token", "c1", RULES);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3]); // delt 1. plads ⇒ næste er nr. 3
    expect(rows.map((r) => r.shared)).toEqual([true, true, false]);
    expect(rows.slice(0, 2).map((r) => r.roundWins)).toEqual([2, 2]); // delt sejr i begge runder
  });

  it("sorterer stabilt på userId ved ægte lighed, uanset rækkefølgen fra DB", async () => {
    const preds = (uid) => [{ match_id: "m1", user_id: uid, pred_home: 2, pred_away: 1 }];
    const profiles = [{ id: "u9", display_name: "Zeta" }, { id: "u1", display_name: "Alpha" }];
    await mockComp([...preds("u9"), ...preds("u1")], profiles);
    const first = await computeCompetitionState("token", "c1", RULES);
    await mockComp([...preds("u1"), ...preds("u9")], profiles.slice().reverse());
    const second = await computeCompetitionState("token", "c1", RULES);
    expect(first.rows.map((r) => r.userId)).toEqual(["u1", "u9"]);
    expect(second.rows.map((r) => r.userId)).toEqual(["u1", "u9"]);
    expect(first.rows.map((r) => r.rank)).toEqual([1, 1]); // rækkefølgen er stabil, placeringen delt
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

describe("karriereprofil", () => {
  it("loadCareerProfile kalder RPC med profile_user_id og returnerer jsonb", async () => {
    const payload = { head: { display_name: "Anna" }, titles: { monthly: [], round_wins: 0 }, curve: [], base: {}, rivals: [], is_own: true };
    restFetch.mockResolvedValueOnce(payload);
    const res = await loadCareerProfile("token", "u1");
    expect(res).toBe(payload);
    expect(restFetch).toHaveBeenCalledWith("/rest/v1/rpc/career_profile",
      expect.objectContaining({ method: "POST", token: "token", body: { profile_user_id: "u1" } }));
  });

  it("loadCareerMilestones returnerer [] for andres profil uden at læse stories", async () => {
    const res = await loadCareerMilestones("token", "u2", false);
    expect(res).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("loadCareerMilestones mapper egne stories-rækker (nyeste først)", async () => {
    mockTables({
      stories: [
        { id: "s1", round_key: "2026-07-21", rule: "MONTH_CHAMP", headline: "👑 Månedens", body: "B1", created_at: "2026-07-22" },
        { id: "s2", round_key: "2026-07-14", rule: "STREAK", headline: "🔥 Stime", body: "B2", created_at: "2026-07-15" },
      ],
    });
    const res = await loadCareerMilestones("token", "u1", true);
    expect(res).toEqual([
      { id: "s1", roundKey: "2026-07-21", rule: "MONTH_CHAMP", headline: "👑 Månedens", body: "B1", createdAt: "2026-07-22" },
      { id: "s2", roundKey: "2026-07-14", rule: "STREAK", headline: "🔥 Stime", body: "B2", createdAt: "2026-07-15" },
    ]);
  });

  it("loadCareerMilestones henter kun højdepunkt-tieret (dæmpede kort er ikke milepæle)", async () => {
    let query = "";
    db.select.mockImplementation(async (t, table, q) => { query = q; return []; });
    await loadCareerMilestones("token", "u1", true);
    expect(query).toContain(`priority=lt.${QUIET_TIER_MIN}`);
  });

  it("loadCareerMilestones degraderer stille til [] ved fejl", async () => {
    db.select.mockRejectedValueOnce(new Error("boom"));
    expect(await loadCareerMilestones("token", "u1", true)).toEqual([]);
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

  // A8 (og A7, juli 2026): join via konkurrence-link skal melde én ind i BEGGE.
  // Reglen lå tidligere som en kopi i hver af de to join-stier, og kun den ene
  // huskede ligaen — derfor bor den nu ét sted og testes her.
  it("joinCompetition melder ind i ligaen FØR konkurrencen, når konkurrencen har en liga", async () => {
    const calls = [];
    db.select.mockImplementation(async (token, table) => {
      calls.push(`select:${table}`);
      return table === "group_members" ? [] : []; // endnu ikke medlem
    });
    db.insert.mockImplementation(async (token, table) => { calls.push(`insert:${table}`); });

    await joinCompetition("token", "u1", "c1", "g1");

    expect(calls).toEqual(["select:group_members", "insert:group_members", "insert:competition_participants"]);
  });

  it("joinCompetition springer liga-medlemskabet over, når man allerede er medlem", async () => {
    db.select.mockResolvedValueOnce([{ user_id: "u1" }]); // allerede medlem
    db.insert.mockResolvedValue(undefined);

    await joinCompetition("token", "u1", "c1", "g1");

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledWith("token", "competition_participants", [{ competition_id: "c1", user_id: "u1" }]);
  });

  it("joinCompetition rører ikke group_members for en liga-løs konkurrence", async () => {
    db.insert.mockResolvedValue(undefined);

    await joinCompetition("token", "u1", "c1");

    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledWith("token", "competition_participants", [{ competition_id: "c1", user_id: "u1" }]);
  });

  it("joinCompetition tilmelder IKKE konkurrencen, hvis liga-indmeldingen fejler", async () => {
    db.select.mockResolvedValueOnce([]);          // ikke medlem
    db.insert.mockRejectedValueOnce(new Error("RLS")); // group_members fejler

    await expect(joinCompetition("token", "u1", "c1", "g1")).rejects.toThrow("RLS");
    expect(db.insert).toHaveBeenCalledTimes(1); // nåede aldrig competition_participants
  });

  it("leaveGroup returnerer false, når RLS blokerer (deltager stadig i en konkurrence)", async () => {
    db.del.mockResolvedValueOnce([{ group_id: "g1", user_id: "u1" }]);
    expect(await leaveGroup("token", "u1", "g1")).toBe(true);
    db.del.mockResolvedValueOnce([]); // blokeret
    expect(await leaveGroup("token", "u1", "g1")).toBe(false);
  });

  it("moveCompetitionToGroup kalder RPC med rigtige parametre", async () => {
    restFetch.mockResolvedValueOnce(null);
    await moveCompetitionToGroup("token", "c1", "g1");
    expect(restFetch).toHaveBeenCalledWith("/rest/v1/rpc/move_competition_to_group",
      expect.objectContaining({ method: "POST", token: "token", body: { p_comp_id: "c1", p_group_id: "g1" } }));
  });
});

describe("dato-helpers", () => {
  // Systemtiden fryses: fmtCountdown læser selv Date.now(), så en test, der først
  // aflæser sit eget `now`, kapper altid et par millisekunder af resttiden. Præcis
  // 2 d 3 t bliver derfor "2 d 2 t" (gulvafrunding er den rigtige adfærd for en
  // deadline — man må aldrig få at vide, at der er mere tid tilbage, end der er).
  // Med fast tid kan de øvrige grænser tjekkes eksakt frem for med "9 eller 10".
  it("fmtCountdown viser dage/timer/minutter afhængigt af afstand", () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-07-25T12:00:00.000Z");
      vi.setSystemTime(now);
      const om = (ms) => fmtCountdown(now.getTime() + ms);

      expect(om(2 * 24 * 3600 * 1000 + 3 * 3600 * 1000)).toBe("2 d 3 t");
      expect(om(2 * 3600 * 1000 + 5 * 60 * 1000)).toBe("2 t 5 min");
      expect(om(10 * 60 * 1000)).toBe("10 min");
      // dage skjuler minutter, timer skjuler sekunder — og under et minut er "0 min"
      expect(om(24 * 3600 * 1000 + 59 * 60 * 1000)).toBe("1 d 0 t");
      expect(om(59 * 1000)).toBe("0 min");
      expect(om(-1000)).toBe("0 min");
    } finally {
      vi.useRealTimers();
    }
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

// "Alle tips er inde" er en påstand om brugerens tips og må kun bruges, når vi
// faktisk har set, at rundens tipbare kampe er tippet. Før returnerede
// computeHomeTips allTipped, hver gang der bare ikke var noget TIPBART — så en
// bruger med nul tips fik det grønne "Alt ok"-kort, mens runden lå låst eller
// endnu ikke havde åbnet.
describe("computeHomeTips: allTipped vs. nothingToTip", () => {
  const HOUR = 3600 * 1000;
  const comp = () => ({ id: "c1" });
  const setup = ({ matches, predictions = [] }) =>
    mockTables({
      competition_matches: matches.map((m) => ({ competition_id: "c1", match_id: m.id })),
      matches,
      teams: [{ id: "t1", name: "Hjemme" }, { id: "t2", name: "Ude" }],
      predictions,
    });
  const match = (over) => ({
    id: "m1", season_id: "s1", round_key: "2026-07-14",
    home_team_id: "t1", away_team_id: "t2", home_score: null, away_score: null, ...over,
  });

  it("siger allTipped, når rundens tipbare kampe FAKTISK er tippet", async () => {
    const kickoff = new Date(Date.now() + 48 * HOUR).toISOString();
    setup({
      matches: [match({ kickoff_at: kickoff })],
      predictions: [{ match_id: "m1", pred_home: 2, pred_away: 1 }],
    });
    const tips = await computeHomeTips("token", "u1", [comp()]);
    expect(tips.allTipped).toBe(true);
    expect(tips.nothingToTip).toBeUndefined();
  });

  it("siger nothingToTip — ikke allTipped — når runden er låst uden tips", async () => {
    // kickoff om 30 min ⇒ runden låste for en halv time siden (lås = kickoff − 1 t)
    const kickoff = new Date(Date.now() + 0.5 * HOUR).toISOString();
    setup({ matches: [match({ kickoff_at: kickoff })] });
    const tips = await computeHomeTips("token", "u1", [comp()]);
    expect(tips.nothingToTip).toBe(true);
    expect(tips.allTipped).toBeUndefined();
  });

  it("en kamp langt ude i fremtiden er tipbar — det rullende vindue er fjernet (B1)", async () => {
    // kickoff om 30 dage. Med vinduet ville den have været lukket endnu; nu er
    // en kamp tipbar fra det øjeblik, den findes, og indtil den låser.
    const kickoff = new Date(Date.now() + 30 * 24 * HOUR).toISOString();
    setup({ matches: [match({ kickoff_at: kickoff })] });
    const tips = await computeHomeTips("token", "u1", [comp()]);
    expect(tips.nothingToTip).toBeUndefined();
    expect(tips.allTipped).toBe(false);
  });

  it("siger allTipped: false, når en tipbar kamp mangler tips", async () => {
    const kickoff = new Date(Date.now() + 48 * HOUR).toISOString();
    setup({ matches: [match({ kickoff_at: kickoff })] });
    const tips = await computeHomeTips("token", "u1", [comp()]);
    expect(tips.allTipped).toBe(false);
    expect(tips.missingCount).toBe(1);
  });
});

// ---------- createCompetition (udtrukket fra CreateCompetitionScreen) ----------
// Skriveren har nu to kaldesteder (opret-skærmen og onboarding-guiden), så
// rækkeformen og rækkefølgen testes her frem for inde i en af skærmene.
describe("createCompetition", () => {
  // Én sæson: runde 1 er færdigspillet, runde 2 og 3 er ikke. En ny konkurrence
  // skal starte på 0 point, så kun runde 2 og 3 må komme med.
  const seasonMatches = [
    { id: "m1", round_key: "2026-08-04", home_score: 1, stage_name: "Grundspil" },
    { id: "m2", round_key: "2026-08-04", home_score: 0, stage_name: "Grundspil" },
    { id: "m3", round_key: "2026-08-11", home_score: null, stage_name: "Grundspil" },
    { id: "m4", round_key: "2026-08-18", home_score: null, stage_name: "Mesterskabsspil" },
  ];
  // Hver ny konkurrence skal høre til en liga (august 2026), så testene sender
  // den samme liga med, med mindre de netop handler om det manglende felt.
  const create = (spec) => createCompetition("token", "u1", { groupId: "g1", ...spec });
  const insertedRow = (table) => db.insert.mock.calls.find((c) => c[1] === table)?.[2][0];
  const matchRows = () => db.insert.mock.calls.find((c) => c[1] === "competition_matches")?.[2] || [];

  function setup(matches = seasonMatches) {
    db.select.mockResolvedValue(matches);
    db.insert.mockImplementation(async (token, table, rows) =>
      (table === "competitions" ? [{ id: "c1", ...rows[0] }] : undefined));
  }

  it("full sæson med én turnering bevarer den bundne form og tager kun ikke-spillede runder med", async () => {
    setup();
    const res = await create({
      name: "Superligaen 2026/27", groupId: "g1", mode: "full_season",
      tournaments: [{ leagueId: "L1", seasonId: "S1" }],
    });

    expect(insertedRow("competitions")).toMatchObject({
      name: "Superligaen 2026/27", league_id: "L1", season_id: "S1", group_id: "g1",
      mode: "full_season", mode_params: {}, created_by: "u1",
    });
    expect(matchRows().map((r) => r.match_id)).toEqual(["m3", "m4"]);
    expect(res.matchCount).toBe(2);
  });

  // A20: fase-afgrænsning findes ikke længere. "Hel sæson" betyder hele
  // sæsonen, også mesterskabsspillet — og `mode_params.stages` skrives aldrig,
  // fordi feltet nu er efterfyldningens mærkat for "afgrænset i hånden".
  it("tager alle faser med og skriver ALDRIG stages i mode_params", async () => {
    setup();
    await create({
      name: "Hele sæsonen", mode: "full_season",
      tournaments: [{ leagueId: "L1", seasonId: "S1" }],
    });

    expect(insertedRow("competitions").mode_params).toEqual({});
    expect(matchRows().map((r) => r.match_id)).toEqual(["m3", "m4"]); // m4 er mesterskabsspil
  });

  it("stage-felter i spec'en ignoreres, hvis en gammel kalder stadig sender dem", async () => {
    setup();
    await create({
      name: "Gammel kalder", mode: "team", leagueId: "L1", seasonId: "S1", teamId: "T1",
      availableStages: ["Grundspil", "Mesterskabsspil"], selectedStages: ["Grundspil"],
    });
    expect(insertedRow("competitions").mode_params).toEqual({ team_id: "T1" });
  });

  it("flere turneringer gør konkurrencen turneringsløs og gemmer dem i mode_params", async () => {
    setup();
    await create({
      name: "Dobbelt", mode: "full_season",
      tournaments: [
        { leagueId: "L1", seasonId: "S1" },
        { leagueId: "L2", seasonId: "S2" },
      ],
    });

    const row = insertedRow("competitions");
    expect(row.league_id).toBeNull();
    expect(row.season_id).toBeNull();
    expect(row.mode_params).toEqual({ tournaments: [{ league_id: "L1", season_id: "S1" }, { league_id: "L2", season_id: "S2" }] });
  });

  it("en færdigspillet sæson giver matchCount 0 og INTET competition_matches-insert", async () => {
    setup([{ id: "m1", round_key: "2026-08-04", home_score: 1, stage_name: null }]);
    const res = await create({
      name: "For sent", mode: "full_season",
      tournaments: [{ leagueId: "L1", seasonId: "S1" }],
    });

    expect(res.matchCount).toBe(0);
    expect(db.insert.mock.calls.some((c) => c[1] === "competition_matches")).toBe(false);
    // konkurrencen og deltageren oprettes stadig — den fyldes, når kampprogrammet er lagt
    expect(insertedRow("competition_participants")).toEqual({ competition_id: "c1", user_id: "u1" });
  });

  // `rules` sendes slet ikke længere (G3, august 2026). Kolonnen er `not null`
  // med defaulten {"exact": 3, "outcome": 1}, så rækken får den samme værdi som
  // før — fra databasen, som er det eneste sted, der nogensinde har afgjort
  // point. Testen stod her før som "skriver altid de faste pointregler" og
  // vogtede, at en ukendt nøgle fra spec'en (fx det fjernede `openDaysBefore`)
  // ikke kunne snige sig ind i feltet igen. Den vogter nu det samme ét skridt
  // tidligere: sendes feltet ikke, kan der heller ikke komme noget med i det.
  it("sender ikke rules — databasens default er den eneste kilde til pointreglerne", async () => {
    setup();
    const t = [{ leagueId: "L1", seasonId: "S1" }];
    await create({ name: "A", mode: "full_season", tournaments: t, openDaysBefore: 7 });
    expect(insertedRow("competitions")).not.toHaveProperty("rules");
  });

  it("custom bruger de valgte kampe og er turneringsløs", async () => {
    setup();
    const res = await create({
      name: "Håndplukket", mode: "custom", matchIds: ["x1", "x2"],
    });

    expect(insertedRow("competitions")).toMatchObject({ league_id: null, season_id: null, mode: "custom", mode_params: {} });
    expect(matchRows().map((r) => r.match_id)).toEqual(["x1", "x2"]);
    expect(res.matchCount).toBe(2);
  });

  it("afviser full sæson uden turnering og custom uden kampe — uden at skrive noget", async () => {
    setup();
    await expect(create({ name: "A", mode: "full_season", tournaments: [] }))
      .rejects.toThrow("Vælg mindst én turnering");
    await expect(create({ name: "A", mode: "custom", matchIds: [] }))
      .rejects.toThrow("Vælg mindst én kamp");
    expect(db.insert).not.toHaveBeenCalled();
  });

  // En liga-løs konkurrence kan ikke oprettes længere (august 2026). Reglen står
  // i skriveren og ikke kun i opret-skærmen, fordi guiden er det andet kaldested
  // — og fordi den ikke kan være et `not null` i databasen (`on delete set null`
  // gør en konkurrence liga-løs, når ligaen slettes).
  it("afviser en konkurrence uden liga — uden at skrive noget", async () => {
    setup();
    await expect(createCompetition("token", "u1", {
      name: "Uden liga", mode: "full_season", tournaments: [{ leagueId: "L1", seasonId: "S1" }],
    })).rejects.toThrow("Vælg eller opret den liga");
    expect(db.insert).not.toHaveBeenCalled();
  });

  // ---------- Favorithold (I14): den nye teams-liste ----------

  it("ét hold i teams-listen giver præcis legacy-formen (bundet league/season, team_id)", async () => {
    setup();
    await create({
      name: "Kun FCK", mode: "team",
      teams: [{ leagueId: "L1", seasonId: "S1", teamId: "T1" }],
    });
    expect(insertedRow("competitions")).toMatchObject({
      league_id: "L1", season_id: "S1", mode: "team", mode_params: { team_id: "T1" },
    });
    // kun ikke-spillede runder kommer med, som for full_season
    expect(matchRows().map((r) => r.match_id)).toEqual(["m3", "m4"]);
  });

  it("flere hold gør konkurrencen turneringsløs og skriver team_ids + tournaments", async () => {
    setup();
    await create({
      name: "Mine hold", mode: "team",
      teams: [
        { leagueId: "L1", seasonId: "S1", teamId: "T1" },
        { leagueId: "L2", seasonId: "S2", teamId: "T9" },
      ],
    });
    const row = insertedRow("competitions");
    expect(row.league_id).toBeNull();
    expect(row.season_id).toBeNull();
    // `tournaments` er ikke pynt: efterfyldningens coversSeason() afgør
    // sæsondækning på netop dén nøgle (api/_backfill.js).
    expect(row.mode_params).toEqual({
      team_ids: ["T1", "T9"],
      tournaments: [{ league_id: "L1", season_id: "S1" }, { league_id: "L2", season_id: "S2" }],
    });
  });

  it("afviser en teams-liste uden gyldige hold — uden at skrive noget", async () => {
    setup();
    await expect(create({
      name: "A", mode: "team", teams: [{ leagueId: "L1", seasonId: null, teamId: null }],
    })).rejects.toThrow("Vælg mindst ét hold");
    expect(db.insert).not.toHaveBeenCalled();
  });

  // ---------- Quick League (I14): rounds-parameteren ----------

  it("random skriver rounds i mode_params — men KUN når > 1, så gamle rækkers form er uændret", async () => {
    setup();
    await create({
      name: "Quick League", mode: "random", matchIds: ["x1"], randomCount: 8, rounds: 6,
    });
    expect(insertedRow("competitions").mode_params).toEqual({ count: 8, rounds: 6 });

    db.insert.mockClear();
    await create({
      name: "Quick Pick", mode: "random", matchIds: ["x1"], randomCount: 8, rounds: 1,
    });
    expect(insertedRow("competitions").mode_params).toEqual({ count: 8 });
  });

  // ---------- kårings-tilvalget (I13): awards i alle grene ----------

  it("awards: true lander i mode_params i alle grene — og udelades helt uden tilvalg", async () => {
    setup();
    await create({
      name: "Sæson", mode: "full_season", awards: true,
      tournaments: [{ leagueId: "L1", seasonId: "S1" }],
    });
    expect(insertedRow("competitions").mode_params).toEqual({ awards: true });

    db.insert.mockClear();
    await create({
      name: "Hold", mode: "team", awards: true,
      teams: [{ leagueId: "L1", seasonId: "S1", teamId: "T1" }],
    });
    expect(insertedRow("competitions").mode_params).toEqual({ team_id: "T1", awards: true });

    db.insert.mockClear();
    await create({ name: "Custom", mode: "custom", awards: true, matchIds: ["x1"] });
    expect(insertedRow("competitions").mode_params).toEqual({ awards: true });

    db.insert.mockClear();
    await create({ name: "Custom uden", mode: "custom", matchIds: ["x1"] });
    expect(insertedRow("competitions").mode_params).toEqual({});
  });
});

// ---------- joinByInviteCode (udtrukket fra LigaerTab) ----------
describe("joinByInviteCode", () => {
  it("trækker koden ud af et helt indsat link — og lader en rå kode passere", () => {
    // Nye brugere indsætter det, de fik i beskedtråden, ikke en renskrevet kode.
    expect(inviteCodeFrom("https://app.dk/?liga=abc123")).toBe("abc123");
    expect(inviteCodeFrom("https://app.dk/?join=xyz789&x=1")).toBe("xyz789");
    expect(inviteCodeFrom("  abc123  ")).toBe("abc123");
    expect(inviteCodeFrom("")).toBe("");
  });

  // Begge koder er otte hex-tegn med små bogstaver (`substr(md5(...), 1, 8)`),
  // og opslaget er `eq.`. En kode tastet af med versaler — eller rettet af
  // iOS-tastaturets automatik — ramte derfor nul rækker og lignede en forkert
  // kode. Ingen gyldig kode kan indeholde et stort bogstav.
  it("sænker koden, så en aftastet eller autokorrigeret kode stadig rammer", () => {
    expect(inviteCodeFrom("ABC123DE")).toBe("abc123de");
    expect(inviteCodeFrom("https://app.dk/?liga=ABC123DE")).toBe("abc123de");
  });

  it("prøver liga-koden først og melder ind i ligaen", async () => {
    db.select.mockImplementation(async (token, table) =>
      (table === "groups" ? [{ id: "g1", name: "Vennerne" }] : []));
    db.insert.mockResolvedValue(undefined);

    const res = await joinByInviteCode("token", "u1", "ABC123");

    expect(res).toMatchObject({ kind: "group", group: { id: "g1" } });
    expect(db.insert).toHaveBeenCalledWith("token", "group_members", [{ group_id: "g1", user_id: "u1", role: "member" }]);
  });

  it("en ukendt kode giver kind 'none' og skriver INTET", async () => {
    db.select.mockResolvedValue([]);
    expect(await joinByInviteCode("token", "u1", "FORKERT")).toEqual({ kind: "none" });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("konkurrence-kode melder ind i ligaen FØR deltager-rækken (A8-garantien)", async () => {
    const calls = [];
    db.select.mockImplementation(async (token, table) => {
      calls.push(`select:${table}`);
      if (table === "groups") return [];                                   // ikke en liga-kode
      if (table === "competitions") return [{ id: "c1", group_id: "g1" }];
      return []; // group_members / competition_participants: endnu ikke med
    });
    db.insert.mockImplementation(async (token, table) => { calls.push(`insert:${table}`); });

    const res = await joinByInviteCode("token", "u1", "KODE");

    expect(res).toMatchObject({ kind: "competition", alreadyJoined: false });
    expect(calls).toEqual([
      "select:groups", "select:competitions", "select:competition_participants",
      "select:group_members", "insert:group_members", "insert:competition_participants",
    ]);
  });

  it("er idempotent: allerede tilmeldt giver ingen dublet, men liga-medlemskabet repareres", async () => {
    // Netop A8-halvtilstanden: deltager uden liga-medlemskab. At bruge invitationen
    // igen er den naturlige måde at forsøge at rette den på, så det skal virke.
    db.select.mockImplementation(async (token, table) => {
      if (table === "groups") return [];
      if (table === "competitions") return [{ id: "c1", group_id: "g1" }];
      if (table === "competition_participants") return [{ competition_id: "c1" }];
      return []; // group_members: mangler
    });
    db.insert.mockResolvedValue(undefined);

    const res = await joinByInviteCode("token", "u1", "KODE");

    expect(res.alreadyJoined).toBe(true);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledWith("token", "group_members", [{ group_id: "g1", user_id: "u1", role: "member" }]);
  });
});
