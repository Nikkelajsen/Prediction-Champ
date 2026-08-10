import { describe, it, expect, vi, beforeEach } from "vitest";

// `db` mockes, så opret-flowets fire opslag kan efterprøves uden netværk. Det er
// hele grunden til, at de blev flyttet ud af `CreateCompetitionScreen.jsx`
// (`G1`): testopsætningen er bevidst uden jsdom, så et opslag inde i en
// `useEffect` kun kunne efterprøves i hånden — og tre af de fire bærer hver sin
// lærepenge om tavs afkortning, altså præcis den slags fejl, ingen ser.
vi.mock("./supabase.js", () => ({ db: { select: vi.fn(), count: vi.fn() } }));

import { db } from "./supabase.js";
import {
  loadNewestSeasons, countMatchesPerLeague, loadTeamsByLeague, loadUpcomingMatches,
  loadCurrentRoundMatches,
} from "./data/createSources.js";

const LIGAER = [{ id: "l1", name: "Superliga" }, { id: "l2", name: "Premiership" }];

// Svar pr. tabel; hver funktion får forespørgslen med, så et kald kan
// efterprøves på det, det faktisk bad om.
function mockTables(tables) {
  db.select.mockImplementation(async (token, table, query) => {
    if (!(table in tables)) throw new Error(`uventet tabel i test: ${table}`);
    const rows = tables[table];
    return typeof rows === "function" ? rows(query) : rows;
  });
}

beforeEach(() => { db.select.mockReset(); db.count.mockReset(); });

describe("loadNewestSeasons", () => {
  it("beholder den FØRSTE række pr. turnering — opslaget er sorteret nyeste først", async () => {
    mockTables({ seasons: [
      { id: "s2", league_id: "l1" }, { id: "s1", league_id: "l1" }, { id: "s9", league_id: "l2" },
    ] });
    expect(await loadNewestSeasons("t", LIGAER)).toEqual({
      l1: { id: "s2", league_id: "l1" }, l2: { id: "s9", league_id: "l2" },
    });
  });

  // Turneringer uden sæsonrække MANGLER i svaret frem for at stå med null.
  // Kalderen skal kunne skelne "ingen sæson" fra "sæson uden kampe".
  it("udelader en turnering uden sæsonrække", async () => {
    mockTables({ seasons: [{ id: "s1", league_id: "l1" }] });
    const ud = await loadNewestSeasons("t", LIGAER);
    expect(Object.keys(ud)).toEqual(["l1"]);
  });

  it("spørger slet ikke, når der ingen turneringer er", async () => {
    expect(await loadNewestSeasons("t", [])).toEqual({});
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe("countMatchesPerLeague", () => {
  // G35: ét opslag PR. TURNERING. Et samlet opslag ville ramme PostgRESTs loft
  // på 1000 og tælle de sidste turneringer som nul.
  it("tæller pr. turnering og ikke i ét samlet opslag", async () => {
    db.count.mockImplementation(async (token, table, query) => (query === "season_id=eq.s1" ? 306 : 380));
    const ud = await countMatchesPerLeague("t", LIGAER, { l1: { id: "s1" }, l2: { id: "s2" } });
    expect(ud).toEqual({ l1: 306, l2: 380 });
    expect(db.count).toHaveBeenCalledTimes(2);
  });

  it("regner en turnering uden sæsonrække som nul uden at spørge", async () => {
    db.count.mockResolvedValue(12);
    const ud = await countMatchesPerLeague("t", LIGAER, { l1: { id: "s1" } });
    expect(ud).toEqual({ l1: 12, l2: 0 });
    expect(db.count).toHaveBeenCalledTimes(1);
  });
});

describe("loadTeamsByLeague", () => {
  it("grupperer holdene pr. turnering i ét opslag", async () => {
    mockTables({ teams: [
      { id: "t1", league_id: "l1", name: "AGF" },
      { id: "t2", league_id: "l1", name: "Brøndby" },
      { id: "t3", league_id: "l2", name: "Celtic" },
    ] });
    const ud = await loadTeamsByLeague("t", LIGAER);
    expect(Object.keys(ud)).toEqual(["l1", "l2"]);
    expect(ud.l1.map((t) => t.name)).toEqual(["AGF", "Brøndby"]);
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});

describe("loadUpcomingMatches", () => {
  const SÆSONER = { l1: { id: "s1", league_id: "l1" }, l2: { id: "s2", league_id: "l2" } };
  const kamp = (n, season = "s1") => ({ id: `m${n}`, season_id: season, home_team_id: "a", away_team_id: "b" });

  function stub(matches) {
    mockTables({
      matches,
      teams: [{ id: "a", name: "AGF" }, { id: "b", name: "Brøndby" }],
    });
  }

  it("beriger hver kamp med turneringens id og navn", async () => {
    stub([kamp(1), kamp(2, "s2")]);
    const { matches } = await loadUpcomingMatches("t", SÆSONER, LIGAER, { limit: 10 });
    expect(matches[0]._leagueId).toBe("l1");
    expect(matches[0]._leagueName).toBe("Superliga");
    expect(matches[1]._leagueName).toBe("Premiership");
  });

  // Kernen i G35: der bestilles limit+1, og den ekstra række er BEVISET for, at
  // listen er klippet. Uden den kan "1000 kampe" ikke skelnes fra "for mange".
  it("bestiller én række mere end den viser", async () => {
    stub([]);
    await loadUpcomingMatches("t", SÆSONER, LIGAER, { limit: 300 });
    expect(db.select.mock.calls[0][2]).toContain("limit=301");
  });

  it("melder afkortning OG klipper til loftet, når den ekstra række kommer hjem", async () => {
    stub([kamp(1), kamp(2), kamp(3)]);
    const ud = await loadUpcomingMatches("t", SÆSONER, LIGAER, { limit: 2 });
    expect(ud.truncated).toBe(true);
    expect(ud.matches).toHaveLength(2);
  });

  it("melder IKKE afkortning, når svaret lige akkurat fylder loftet", async () => {
    stub([kamp(1), kamp(2)]);
    const ud = await loadUpcomingMatches("t", SÆSONER, LIGAER, { limit: 2 });
    expect(ud.truncated).toBe(false);
    expect(ud.matches).toHaveLength(2);
  });

  it("slår holdnavnene op for præcis de hold, kampene nævner", async () => {
    stub([kamp(1)]);
    const ud = await loadUpcomingMatches("t", SÆSONER, LIGAER, { limit: 10 });
    expect(ud.teams).toEqual({ a: "AGF", b: "Brøndby" });
    expect(db.select.mock.calls[1][2]).toContain("id=in.(a,b)");
  });

  it("springer hold-opslaget over, når der ingen kampe er", async () => {
    stub([]);
    const ud = await loadUpcomingMatches("t", SÆSONER, LIGAER, { limit: 10 });
    expect(ud.teams).toEqual({});
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  // Quick League kigger 11 uger frem; de øvrige har ingen øvre grænse.
  it("sætter kun en øvre tidsgrænse, når der er bedt om en horisont", async () => {
    stub([]);
    const nu = Date.parse("2026-08-05T12:00:00Z");
    await loadUpcomingMatches("t", SÆSONER, LIGAER, { limit: 10, horizonMs: 7 * 24 * 3600 * 1000, now: nu });
    expect(db.select.mock.calls[0][2]).toContain("kickoff_at=lte.2026-08-12T12:00:00.000Z");

    db.select.mockClear();
    stub([]);
    await loadUpcomingMatches("t", SÆSONER, LIGAER, { limit: 10, now: nu });
    expect(db.select.mock.calls[0][2]).not.toContain("lte.");
  });

  it("spørger slet ikke uden en eneste sæson", async () => {
    const ud = await loadUpcomingMatches("t", {}, LIGAER, { limit: 10 });
    expect(ud).toEqual({ matches: [], teams: {}, truncated: false });
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe("loadCurrentRoundMatches", () => {
  const SÆSONER = { l1: { id: "s1", league_id: "l1" }, l2: { id: "s2", league_id: "l2" } };

  // NÆVNEREN er hele pointen: `loadUpcomingMatches` henter fra `nu` og frem og
  // kan derfor ikke se de kampe, der ALLEREDE er spillet — så en runde, hvor
  // fem af seks er fløjtet i gang, ligner en runde med én kamp.
  it("henter hele runden, også de kampe der er spillet", async () => {
    mockTables({ matches: [
      { id: "m1", season_id: "s1", home_score: 2, away_score: 1 },
      { id: "m2", season_id: "s2" },
    ] });
    const ud = await loadCurrentRoundMatches("t", SÆSONER, LIGAER, { roundKey: "2026-08-04" });
    expect(ud.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(db.select.mock.calls[0][2]).not.toContain("kickoff_at=gte");
  });

  // Rundenøglen er en KOLONNE, sat af public.round_key() i dansk tid. Regnede vi
  // selv rundens start og slut her, ville vi have en fjerde kopi af den regel.
  it("spørger på rundenøglen frem for at regne et tidsinterval ud", async () => {
    mockTables({ matches: [] });
    await loadCurrentRoundMatches("t", SÆSONER, LIGAER, { roundKey: "2026-08-04" });
    expect(db.select.mock.calls[0][2]).toContain("round_key=eq.2026-08-04");
    expect(db.select.mock.calls[0][2]).toContain("season_id=in.(s1,s2)");
  });

  it("beriger med turneringens id og navn, så tælleren kan følge turneringsvalget", async () => {
    mockTables({ matches: [{ id: "m1", season_id: "s2" }] });
    const [m] = await loadCurrentRoundMatches("t", SÆSONER, LIGAER, { roundKey: "2026-08-04" });
    expect(m._leagueId).toBe("l2");
    expect(m._leagueName).toBe("Premiership");
  });

  it("spørger slet ikke uden en eneste sæson", async () => {
    expect(await loadCurrentRoundMatches("t", {}, LIGAER, { roundKey: "2026-08-04" })).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });
});
