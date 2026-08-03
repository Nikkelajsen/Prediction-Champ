// Efterfyldningsreglen (A20). Testes her og ikke gennem sync-matches, fordi
// det er de tre sikkerhedsregler — ikke HTTP-laget — der skal holdes fast:
// kun regel-baserede modes, `stages` som mærkat, og at en låst runde aldrig
// vokser.

import { describe, it, expect } from "vitest";
import { matchesToBackfill, matchLockAtMs, coversSeason, LOCK_LEAD_MS } from "./_backfill.js";

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

// G55 (august 2026): efterfyldningen regnede altid `kickoff_at − 1 time` og
// kendte ikke `kickoff_tbd`. En kamp uden fastlagt klokkeslæt bærer en
// PLADSHOLDER i kickoff_at, og både klienten (`lockAtOf`) og databasen
// (`public.match_lock_at()`) låser den ved midnat på spilledagen, dansk tid.
// Reglen her følger nu de to andre — testene er skrevet mod ØJEBLIKKE og ikke
// mod strengene, netop fordi hele fejlen bestod i at tage en pladsholder for
// pålydende.
describe("matchLockAtMs — den fælles lås, oversat til api/", () => {
  it("låser en almindelig kamp én time før kickoff", () => {
    const kickoff = Date.parse("2026-08-10T18:00:00Z");
    expect(matchLockAtMs({ kickoff_at: iso(kickoff) })).toBe(kickoff - LOCK_LEAD_MS);
    expect(matchLockAtMs({ kickoff_at: iso(kickoff), kickoff_tbd: false })).toBe(kickoff - LOCK_LEAD_MS);
  });

  // Sommertid: dansk midnat er 22:00 UTC dagen før. Pladsholderen ligger på
  // 00:00 UTC den 10., altså 02.00 dansk — samme DAG for spilleren, men to timer
  // efter den lås, resten af appen håndhæver.
  it("låser en TBD-kamp ved dansk midnat på spilledagen (sommertid)", () => {
    expect(matchLockAtMs({ kickoff_at: "2026-08-10T00:00:00Z", kickoff_tbd: true }))
      .toBe(Date.parse("2026-08-09T22:00:00Z"));
  });

  // Vintertid: dansk midnat er 23:00 UTC dagen før. Offsettet aflæses og er
  // ikke hårdkodet — ellers ville reglen flytte sig to gange om året.
  it("låser en TBD-kamp ved dansk midnat på spilledagen (vintertid)", () => {
    expect(matchLockAtMs({ kickoff_at: "2026-12-05T12:00:00Z", kickoff_tbd: true }))
      .toBe(Date.parse("2026-12-04T23:00:00Z"));
  });

  // Timerne efter midnat dansk tid er den ene, hvor UTC-datoen og den danske
  // dato er forskellige — og hvor et enkelt gennemløb ville ramme dagen før.
  it("bruger den DANSKE dato, ikke UTC-datoen", () => {
    expect(matchLockAtMs({ kickoff_at: "2026-08-09T23:30:00Z", kickoff_tbd: true }))
      .toBe(Date.parse("2026-08-09T22:00:00Z")); // dansk 10. aug. kl. 01.30 → midnat samme danske dag
  });

  it("giver null uden kendt kickoff", () => {
    expect(matchLockAtMs({ kickoff_at: null, kickoff_tbd: true })).toBeNull();
    expect(matchLockAtMs({ kickoff_at: "ikke en dato" })).toBeNull();
    expect(matchLockAtMs(null)).toBeNull();
  });
});

// Regel 3 læser nu låsen og ikke kickoff. For en TBD-kamp betyder det, at
// runden lukker for efterfyldning ved dansk midnat frem for en time før
// pladsholderen — dét er hele forskellen, og den er kun synlig for TBD-kampe.
describe("regel 3 med en TBD-kamp i runden", () => {
  const tbdRound = "2026-08-18";
  const tbd = [{ id: "t1", round_key: tbdRound, kickoff_at: "2026-08-18T00:00:00Z", kickoff_tbd: true, home_score: null, home_team_id: "T1", away_team_id: "T2" },
               { id: "t2", round_key: tbdRound, kickoff_at: "2026-08-19T17:00:00Z", home_score: null, home_team_id: "T3", away_team_id: "T4" }];
  const at = (isoStr) => matchesToBackfill({ competition: fullSeason, matches: tbd, existingIds: [], nowMs: Date.parse(isoStr) });

  it("efterfylder indtil dansk midnat på spilledagen", () => {
    expect(at("2026-08-17T21:59:00Z")).toEqual(["t1", "t2"]); // dansk 23.59 den 17.
  });

  it("stopper fra dansk midnat — også selvom pladsholderen først er to timer senere", () => {
    expect(at("2026-08-17T22:01:00Z")).toEqual([]); // dansk 00.01 den 18.
    // Den gamle regel (kickoff − 1 time) ville have haft runden åben helt frem
    // til 23:00 UTC, altså en time inde i spilledagen.
    expect(at("2026-08-17T22:59:00Z")).toEqual([]);
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
