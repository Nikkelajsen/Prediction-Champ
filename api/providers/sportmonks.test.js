// Tests for api/providers/sportmonks.js.
//
// Koden i modulet er FLYTTET ud af api/sync-matches.js og api/sync-live.js, ikke
// nyskrevet. Testene her findes for at kunne bevise netop det: mappingen af
// Sportmonks' felter er den, Superligaen har kørt på, og en oprydning må ikke
// flytte et eneste resultat. Derfor er eksemplerne bygget efter de felter, den
// gamle kode faktisk læste — participants[].meta.location,
// scores[].description === "CURRENT", state.short_name, periods[].ticking.
import { describe, it, expect, vi } from "vitest";
import { sportmonks, __test } from "./sportmonks.js";

const { normalize } = __test;

function fixture(over = {}) {
  return {
    id: 19134567,
    starting_at: "2026-08-15 16:00:00",
    stage: { name: "Regular Season" },
    state: { short_name: "FT", developer_name: "FT" },
    participants: [
      { id: 293, name: "FC København", meta: { location: "home" } },
      { id: 86, name: "Brøndby IF", meta: { location: "away" } },
    ],
    scores: [
      { description: "CURRENT", score: { participant: "home", goals: 2 } },
      { description: "CURRENT", score: { participant: "away", goals: 1 } },
      { description: "1ST_HALF", score: { participant: "home", goals: 1 } },
    ],
    ...over,
  };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, text: async () => JSON.stringify(body), json: async () => body };
}

describe("normalize", () => {
  it("oversætter en afsluttet kamp", () => {
    const n = normalize(fixture());
    expect(n).toMatchObject({
      providerId: "19134567",
      globalId: "19134567",
      kickoffAt: "2026-08-15 16:00:00",
      stageName: "Regular Season",
      status: "finished",
      score: { home: 2, away: 1 },
    });
    expect(n.home).toEqual({ providerId: "293", globalId: "293", name: "FC København" });
    expect(n.away.name).toBe("Brøndby IF");
  });

  it("holder Sportmonks-id'er UDEN præfiks", () => {
    // Bevidst asymmetri med footballdata.js: id'erne står allerede i tusindvis
    // af rækker i matches.api_fixture_id. Et præfiks her ville betyde, at hver
    // eneste kamp blev oprettet på ny ved næste sync.
    expect(sportmonks.toGlobalId(19134567)).toBe("19134567");
    expect(sportmonks.fromGlobalId("19134567")).toBe("19134567");
  });

  it("læser kun CURRENT-scoren, ikke halvlegsscoren", () => {
    expect(normalize(fixture()).score).toEqual({ home: 2, away: 1 });
  });

  it.each(["FT", "AET", "FT_PEN"])("regner %s som afsluttet", (state) => {
    expect(normalize(fixture({ state: { short_name: state } })).status).toBe("finished");
  });

  it.each([
    "INPLAY_1ST_HALF", "INPLAY_2ND_HALF", "HT", "BREAK",
    "INPLAY_ET", "PEN_BREAK", "INPLAY_PENALTIES",
  ])("regner %s som i gang", (state) => {
    expect(normalize(fixture({ state: { developer_name: state } })).status).toBe("live");
  });

  it.each(["NS", "POSTP", "CANCL", "DELAYED"])("regner %s som ikke spillet", (state) => {
    expect(normalize(fixture({ state: { short_name: state } })).status).toBe("scheduled");
  });

  it("tager spilleminuttet fra den periode, der tikker", () => {
    const n = normalize(fixture({
      state: { developer_name: "INPLAY_2ND_HALF" },
      periods: [{ ticking: false, minutes: 45 }, { ticking: true, minutes: 63 }],
    }));
    expect(n.liveMinute).toBe(63);
  });

  it("har intet spilleminut, når ingen periode tikker (pause eller manglende include)", () => {
    expect(normalize(fixture({ periods: [{ ticking: false, minutes: 45 }] })).liveMinute).toBeNull();
    expect(normalize(fixture()).liveMinute).toBeNull();
  });

  it("springer en deltager over, der mangler id eller navn", () => {
    const n = normalize(fixture({
      participants: [{ id: 293, name: "FC København", meta: { location: "home" } }],
    }));
    expect(n.home).not.toBeNull();
    expect(n.away).toBeNull();
  });
});

describe("fetchSeasonFixtures", () => {
  it("pagineret indtil has_more er falsk, dedupliceret på id", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [fixture({ id: 1 }), fixture({ id: 2 })], pagination: { has_more: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: [fixture({ id: 2 }), fixture({ id: 3 })], pagination: { has_more: false } }));

    const out = await sportmonks.fetchSeasonFixtures({ apiSeasonId: "28275", token: "t", fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out.map((f) => f.providerId)).toEqual(["1", "2", "3"]);
    expect(fetchImpl.mock.calls[0][0]).toContain("filters=fixtureSeasons:28275");
  });

  it("kaster ved fejl frem for at returnere et halvt kampprogram", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { ok: false, status: 500 }));
    await expect(
      sportmonks.fetchSeasonFixtures({ apiSeasonId: "1", token: "t", fetchImpl })
    ).rejects.toThrow(/Sportmonks \(kampe\): 500/);
  });
});

describe("fetchLive", () => {
  it("henter i klumper af 40 id'er", async () => {
    const ids = Array.from({ length: 41 }, (_, i) => String(i + 1));
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }));
    await sportmonks.fetchLive({ providerIds: ids, token: "t", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("prøver igen uden periods, hvis abonnementet ikke har den include", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 403 }))
      .mockResolvedValueOnce(jsonResponse({ data: [fixture({ id: 7 })] }));

    const out = await sportmonks.fetchLive({ providerIds: ["7"], token: "t", fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toContain("include=scores;state;periods");
    expect(fetchImpl.mock.calls[1][0]).toContain("include=scores;state");
    expect(fetchImpl.mock.calls[1][0]).not.toContain("periods");
    expect(out.get("7").score).toEqual({ home: 2, away: 1 });
  });

  it("tåler at multi-endpointet svarer med ét objekt i stedet for et array", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: fixture({ id: 9 }) }));
    const out = await sportmonks.fetchLive({ providerIds: ["9"], token: "t", fetchImpl });
    expect(out.get("9").providerId).toBe("9");
  });
});

describe("resolveSeasonId", () => {
  it("finder sæsonen ved navn", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: { seasons: [{ id: 28275, name: "2026/2027" }, { id: 1, name: "2025/2026" }] } })
    );
    await expect(
      sportmonks.resolveSeasonId({ apiLeagueId: "501", seasonName: "2026/2027", token: "t", fetchImpl })
    ).resolves.toBe("28275");
  });

  it("lister de tilgængelige sæsoner, når navnet ikke findes", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: { seasons: [{ id: 1, name: "2025/2026" }] } }));
    await expect(
      sportmonks.resolveSeasonId({ apiLeagueId: "501", seasonName: "2030/2031", token: "t", fetchImpl })
    ).rejects.toThrow(/Tilgængelige sæsoner: 2025\/2026/);
  });
});
