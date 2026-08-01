// Efterfyldningsreglen (A20). Testes her og ikke gennem sync-matches, fordi
// det er de tre sikkerhedsregler — ikke HTTP-laget — der skal holdes fast:
// kun regel-baserede modes, `stages` som mærkat, og at en låst runde aldrig
// vokser.

import { describe, it, expect } from "vitest";
import { matchesToBackfill, coversSeason, LOCK_LEAD_MS } from "./_backfill.js";

const NOW = Date.parse("2026-08-10T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

// To runder: den første låser om 30 minutter (altså inden for lås-vinduet på
// én time), den anden om en uge.
const LOCKED_ROUND = "2026-08-04";
const OPEN_ROUND = "2026-08-11";
const matches = [
  { id: "m1", round_key: LOCKED_ROUND, kickoff_at: iso(NOW + 30 * 60 * 1000), home_score: null, home_team_id: "T1", away_team_id: "T2" },
  { id: "m2", round_key: LOCKED_ROUND, kickoff_at: iso(NOW + 3 * 60 * 60 * 1000), home_score: null, home_team_id: "T3", away_team_id: "T4" },
  { id: "m3", round_key: OPEN_ROUND, kickoff_at: iso(NOW + 7 * 24 * 60 * 60 * 1000), home_score: null, home_team_id: "T1", away_team_id: "T3" },
  { id: "m4", round_key: OPEN_ROUND, kickoff_at: iso(NOW + 8 * 24 * 60 * 60 * 1000), home_score: null, home_team_id: "T2", away_team_id: "T4" },
];
const run = (competition, existingIds = []) =>
  matchesToBackfill({ competition, matches, existingIds, nowMs: NOW });

const fullSeason = { id: "c1", mode: "full_season", mode_params: {}, season_id: "S1" };

describe("matchesToBackfill", () => {
  it("tilføjer kampe fra runder, der ikke er gået i gang, og springer dem over, konkurrencen allerede har", () => {
    expect(run(fullSeason, ["m3"])).toEqual(["m4"]);
  });

  // Regel 3. m2 ligger tre timer ude, men hører til en runde, hvis FØRSTE kamp
  // begynder om 30 minutter. Efter A21 låser m2 SELV først om tre timer og kan
  // sagtens tippes — efterfyldningen er alligevel spærret, fordi regel 3 måler på
  // runden og ikke på kampen. Det er bevidst strengere end tipslåsen.
  it("lader en runde, der er gået i gang, være — også når kampen selv ligger langt ude", () => {
    expect(run(fullSeason)).toEqual(["m3", "m4"]);
  });

  it("regner rundestarten ud fra hele sæsonens kampe, ikke kun konkurrencens egne", () => {
    // Konkurrencen har m1 i forvejen; m2 må stadig ikke tilføjes, fordi det er
    // m1's kickoff, der sætter runden i gang.
    expect(run(fullSeason, ["m1"])).not.toContain("m2");
  });

  it("åbner runden, så snart dens start er mere end en time væk", () => {
    const justBefore = { ...fullSeason };
    const nowMs = Date.parse(iso(NOW + 30 * 60 * 1000)) - LOCK_LEAD_MS - 1000;
    const ids = matchesToBackfill({ competition: justBefore, matches, existingIds: [], nowMs });
    expect(ids).toContain("m1");
  });

  // Regel 2: mærkatet. Gamle konkurrencer, der blev afgrænset til bestemte
  // faser, står urørte — det er dét, der gør, at der ikke skal en overgangs-
  // regel eller en dato til.
  it("rører aldrig en konkurrence med mode_params.stages", () => {
    expect(run({ ...fullSeason, mode_params: { stages: ["Grundspil"] } })).toEqual([]);
  });

  // Regel 1: håndplukkede kuponer må ikke vokse under fødderne på deltagerne.
  it("efterfylder hverken custom eller random", () => {
    expect(run({ ...fullSeason, mode: "custom" })).toEqual([]);
    expect(run({ ...fullSeason, mode: "random", mode_params: { count: 6 } })).toEqual([]);
  });

  it("tilføjer aldrig en kamp, der allerede er spillet", () => {
    const played = matches.map((m) => (m.id === "m4" ? { ...m, home_score: 2 } : m));
    const ids = matchesToBackfill({ competition: fullSeason, matches: played, existingIds: [], nowMs: NOW });
    expect(ids).toEqual(["m3"]);
  });

  it("team-mode tager kun holdets egne kampe med", () => {
    const comp = { ...fullSeason, mode: "team", mode_params: { team_id: "T1" } };
    expect(run(comp)).toEqual(["m3"]); // m4 er T2 mod T4
  });

  // Favorithold (I14): flere hold skriver `team_ids` i stedet for `team_id`.
  // Begge kampsider tæller, og legacy-formen skal blive ved med at virke.
  it("team-mode med team_ids tager alle de valgte holds kampe med", () => {
    const comp = { ...fullSeason, mode: "team", mode_params: { team_ids: ["T1", "T4"] } };
    expect(run(comp)).toEqual(["m3", "m4"]); // m3 har T1 hjemme, m4 har T4 ude
  });

  it("team-mode uden hold i params efterfylder ingenting", () => {
    expect(run({ ...fullSeason, mode: "team", mode_params: {} })).toEqual([]);
  });

  it("time_range-mode holder sig inden for datointervallet", () => {
    const comp = {
      ...fullSeason, mode: "time_range",
      mode_params: { start_date: "2026-08-01", end_date: "2026-08-17" },
    };
    expect(run(comp)).toEqual(["m3"]); // m4 ligger 18. august
  });

  it("en runde uden kendte kickoffs regnes som ulåst frem for at blive tabt", () => {
    const noKickoff = [{ id: "x1", round_key: "2026-09-01", kickoff_at: null, home_score: null }];
    const ids = matchesToBackfill({ competition: fullSeason, matches: noKickoff, existingIds: [], nowMs: NOW });
    expect(ids).toEqual(["x1"]);
  });
});

describe("coversSeason", () => {
  it("genkender den bundne form", () => {
    expect(coversSeason({ season_id: "S1", mode_params: {} }, "S1")).toBe(true);
    expect(coversSeason({ season_id: "S2", mode_params: {} }, "S1")).toBe(false);
  });

  // Flere turneringer i én konkurrence ⇒ league_id/season_id er null, og
  // turneringerne står i mode_params. Uden dette ville netop de konkurrencer,
  // de syv turneringer gjorde mulige, aldrig blive efterfyldt.
  it("genkender en turneringsløs konkurrence via mode_params.tournaments", () => {
    const c = { season_id: null, mode_params: { tournaments: [{ league_id: "L1", season_id: "S1" }, { league_id: "L2", season_id: "S2" }] } };
    expect(coversSeason(c, "S2")).toBe(true);
    expect(coversSeason(c, "S3")).toBe(false);
  });

  it("tåler et tomt mode_params", () => {
    expect(coversSeason({ season_id: null, mode_params: {} }, "S1")).toBe(false);
  });
});
