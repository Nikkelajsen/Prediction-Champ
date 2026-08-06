// Tests for api/_providers/footballdata.js.
//
// Det, der testes, er MAPPINGEN — ikke netværket. En datakilde er kun så god
// som oversættelsen af dens felter til vores, og det er dér, en stille fejl
// gør mest skade: en forkert status betyder, at et resultat enten aldrig
// skrives eller skrives for tidligt, og point flytter sig begge veje.
import { describe, it, expect, vi } from "vitest";
import { footballdata, __test } from "./footballdata.js";

const { normalize, PREFIX } = __test;

function match(over = {}) {
  return {
    id: 537654,
    utcDate: "2026-08-15T14:00:00Z",
    status: "FINISHED",
    stage: "REGULAR_SEASON",
    homeTeam: { id: 57, name: "Arsenal FC" },
    awayTeam: { id: 61, name: "Chelsea FC" },
    score: { fullTime: { home: 2, away: 1 } },
    ...over,
  };
}

function jsonResponse(body, { ok = true, status = 200, headers = {} } = {}) {
  return {
    ok,
    status,
    headers: { get: (k) => headers[k] ?? null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

describe("normalize", () => {
  it("oversætter en afsluttet kamp", () => {
    const n = normalize(match());
    expect(n).toMatchObject({
      providerId: "537654",
      globalId: "fd:537654",
      kickoffAt: "2026-08-15T14:00:00Z",
      stageName: "REGULAR_SEASON",
      status: "finished",
      score: { home: 2, away: 1 },
    });
    expect(n.home).toEqual({ providerId: "57", globalId: "fd:57", name: "Arsenal FC" });
  });

  it("præfikser id'er, så de ikke kan kollidere med Sportmonks'", () => {
    // Hele pointen med præfikset: matches.api_fixture_id har en GLOBAL
    // unique-constraint, og begge leverandører bruger almindelige heltal.
    expect(normalize(match({ id: 271 })).globalId).toBe("fd:271");
    expect(PREFIX).toBe("fd:");
  });

  it.each([
    ["FINISHED", "finished"],
    ["AWARDED", "finished"],
    ["IN_PLAY", "live"],
    ["PAUSED", "live"],
    ["SCHEDULED", "scheduled"],
    ["TIMED", "scheduled"],
    ["POSTPONED", "scheduled"],
    ["CANCELLED", "scheduled"],
  ])("mapper status %s til %s", (raw, expected) => {
    expect(normalize(match({ status: raw })).status).toBe(expected);
  });

  // "Tid ikke fastlagt" aflæses af TIDSFELTET, ikke af statussen: er `utcDate`
  // midnat UTC, er kun datoen kendt (samme markør som hos Sportmonks).
  it.each([
    ["2026-08-15T00:00:00Z", true],
    ["2026-08-15T14:00:00Z", false],
    ["2026-08-15T20:30:00Z", false],
  ])("sætter kickoffTbd ud fra utcDate %s → %s", (utcDate, expected) => {
    expect(normalize(match({ utcDate, status: "SCHEDULED" })).kickoffTbd).toBe(expected);
  });

  it("regner ikke en manglende utcDate for en pladsholder", () => {
    expect(normalize(match({ utcDate: null })).kickoffTbd).toBe(false);
  });

  // Regressionen fra 6. august 2026. Her stod `status === "SCHEDULED"` som den
  // eneste markør, og resultatet var, at ALLE La Liga-kampe i runden
  // 11.08–17.08 mistede deres klokkeslæt i appen — leverandøren havde sendt
  // rigtige, indbyrdes forskellige tider, men blev ved med at kalde kampene
  // SCHEDULED. Statussen må ikke kunne kaste en tid væk igen.
  it.each(["SCHEDULED", "TIMED", "IN_PLAY", "FINISHED", "POSTPONED"])(
    "lader status %s være uden betydning for kickoffTbd, når tiden er ægte",
    (status) => {
      expect(normalize(match({ status, utcDate: "2026-08-16T17:30:00Z" })).kickoffTbd).toBe(false);
    }
  );

  it("giver null-score når kampen ikke har et resultat endnu", () => {
    const n = normalize(match({ status: "TIMED", score: { fullTime: { home: null, away: null } } }));
    expect(n.score).toEqual({ home: null, away: null });
  });

  it("bevarer 0-0 som et rigtigt resultat", () => {
    // Fælden: 0 er falsy. Et `||`-udtryk ville have gjort 0-0 til null-null,
    // og en målløs kamp ville aldrig være blevet færdigmeldt.
    const n = normalize(match({ score: { fullTime: { home: 0, away: 0 } } }));
    expect(n.score).toEqual({ home: 0, away: 0 });
    expect(n.status).toBe("finished");
  });

  it("returnerer null-hold for en CL-kamp, der endnu ikke er lodtrukket", () => {
    const n = normalize(match({
      stage: "LAST_16",
      homeTeam: { id: null, name: null },
      awayTeam: { id: null, name: null },
    }));
    expect(n.home).toBeNull();
    expect(n.away).toBeNull();
    expect(n.stageName).toBe("LAST_16");
  });

  it("har intet spilleminut på gratis-planen", () => {
    expect(normalize(match({ status: "IN_PLAY" })).liveMinute).toBeNull();
    // …men læser det, hvis abonnementet begynder at levere det.
    expect(normalize(match({ status: "IN_PLAY", minute: 63 })).liveMinute).toBe(63);
  });
});

describe("resolveSeasonId", () => {
  it("udleder startåret af sæsonnavnet uden et netværkskald", async () => {
    await expect(footballdata.resolveSeasonId({ seasonName: "2026/2027" })).resolves.toBe("2026");
  });

  it("fejler tydeligt på et navn uden årstal", async () => {
    await expect(
      footballdata.resolveSeasonId({ seasonName: "forår", apiLeagueId: "PL" })
    ).rejects.toThrow(/sæsonår/);
  });
});

describe("fetchSeasonFixtures", () => {
  it("henter hele sæsonen i ét kald med nøglen i headeren", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ matches: [match(), match({ id: 2 })] }));
    const out = await footballdata.fetchSeasonFixtures({
      apiLeagueId: "PL", apiSeasonId: "2026", token: "hemmelig", fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.football-data.org/v4/competitions/PL/matches?season=2026");
    expect(opts.headers["X-Auth-Token"]).toBe("hemmelig");
    // Nøglen må ikke havne i URL'en, hvor den ville stå i request-logs.
    expect(url).not.toContain("hemmelig");
    expect(out).toHaveLength(2);
  });

  it("oversætter 403 til en besked om planen", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: "ikke i planen" }, { ok: false, status: 403 }));
    await expect(
      footballdata.fetchSeasonFixtures({ apiLeagueId: "WC", apiSeasonId: "2026", token: "t", fetchImpl })
    ).rejects.toThrow(/ikke med i planen/);
  });

  it("prøver igen én gang ved 429", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 429, headers: { "X-RequestCounter-Reset": "3" } }))
        .mockResolvedValueOnce(jsonResponse({ matches: [match()] }));
      const p = footballdata.fetchSeasonFixtures({ apiLeagueId: "PL", apiSeasonId: "2026", token: "t", fetchImpl });
      await vi.runAllTimersAsync();
      await expect(p).resolves.toHaveLength(1);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("describeEmptySeason", () => {
  function competition({ current = "2026-09-15", seasons = ["2026-09-15", "2025-07-08"] } = {}) {
    return {
      currentSeason: current ? { startDate: current } : null,
      seasons: seasons.map((startDate) => ({ startDate })),
    };
  }

  it("kalder turneringens eget endpoint, ikke kamplisten igen", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(competition()));
    await footballdata.describeEmptySeason({
      apiLeagueId: "CL", apiSeasonId: "2026", token: "hemmelig", fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.football-data.org/v4/competitions/CL");
    expect(fetchImpl.mock.calls[0][1].headers["X-Auth-Token"]).toBe("hemmelig");
  });

  it("kalder sæsonen ufarlig, når leverandøren kender den", async () => {
    // Det ene af de to svar på B8: sæsonen findes, kampprogrammet mangler bare.
    const fetchImpl = vi.fn(async () => jsonResponse(competition()));
    const out = await footballdata.describeEmptySeason({
      apiLeagueId: "CL", apiSeasonId: "2026", token: "t", fetchImpl,
    });
    expect(out).toMatchObject({ code: "season-empty", requestedSeason: "2026", currentSeason: "2026" });
    expect(out.knownSeasons).toEqual(["2026", "2025"]);
  });

  it("skelner en endnu ikke oprettet sæson fra en tom", async () => {
    // Præcis Champions League-situationen i juli/august: 2026/2027 er ikke
    // oprettet endnu, fordi ligafasen ikke er lodtrukket.
    const fetchImpl = vi.fn(async () =>
      jsonResponse(competition({ current: "2025-07-08", seasons: ["2025-07-08", "2024-07-09"] }))
    );
    const out = await footballdata.describeEmptySeason({
      apiLeagueId: "CL", apiSeasonId: "2026", token: "t", fetchImpl,
    });
    expect(out.code).toBe("season-not-published");
    expect(out.message).toMatch(/2026/);
  });

  it("udpeger et forkert api_season_id — den udgave, der ikke retter sig selv", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(competition()));
    const out = await footballdata.describeEmptySeason({
      apiLeagueId: "CL", apiSeasonId: "2019", token: "t", fetchImpl,
    });
    expect(out.code).toBe("season-unknown");
    expect(out.message).toMatch(/api_season_id/);
  });

  it("gætter ikke, når leverandøren intet oplyser", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const out = await footballdata.describeEmptySeason({
      apiLeagueId: "CL", apiSeasonId: "2026", token: "t", fetchImpl,
    });
    expect(out).toMatchObject({ code: "undetermined", currentSeason: null, knownSeasons: [] });
  });
});

describe("fetchLive", () => {
  it("henter ét datovindue og filtrerer til de ønskede kampe", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ matches: [match({ id: 1, status: "IN_PLAY" }), match({ id: 999 })] })
    );
    const out = await footballdata.fetchLive({
      providerIds: ["1"],
      kickoffs: ["2026-08-15T14:00:00Z"],
      token: "t",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toMatch(/\/matches\?dateFrom=\d{4}-\d{2}-\d{2}&dateTo=\d{4}-\d{2}-\d{2}$/);
    // Ét kald dækker ALLE football-data-turneringer på én gang — derfor
    // skalerer forbruget ikke med antal turneringer.
    expect([...out.keys()]).toEqual(["fd:1"]);
    expect(out.get("fd:1").status).toBe("live");
  });

  it("sparer kaldet helt, når der ingen kampe er", async () => {
    const fetchImpl = vi.fn();
    const out = await footballdata.fetchLive({ providerIds: [], token: "t", fetchImpl });
    expect(out.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fromGlobalId fjerner præfikset igen", () => {
    expect(footballdata.fromGlobalId("fd:537654")).toBe("537654");
  });
});

describe("fetchSeasonMeta", () => {
  const comp = (current, seasons) => ({
    currentSeason: current ? { startDate: current.start, endDate: current.end } : null,
    seasons: seasons.map(([start, end]) => ({ startDate: start, endDate: end })),
  });

  it("henter slutdatoen fra turneringens sæsonliste", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(
      comp({ start: "2026-08-14", end: "2027-05-23" }, [["2026-08-14", "2027-05-23"], ["2025-08-15", "2026-05-24"]])
    ));
    const out = await footballdata.fetchSeasonMeta({ apiLeagueId: "PL", apiSeasonId: "2026", token: "t", fetchImpl });
    expect(out).toEqual({ endsAt: "2027-05-23", finished: false });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.football-data.org/v4/competitions/PL");
  });

  // Leverandøren har intet `finished`-flag. At sæsonen ikke længere er den
  // AKTUELLE er den erklæring, vi har — og vi gætter ikke ud fra datoen.
  it("melder en sæson færdig, når leverandøren er gået videre til den næste", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(
      comp({ start: "2026-08-14", end: "2027-05-23" }, [["2026-08-14", "2027-05-23"], ["2025-08-15", "2026-05-24"]])
    ));
    const out = await footballdata.fetchSeasonMeta({ apiLeagueId: "PL", apiSeasonId: "2025", token: "t", fetchImpl });
    expect(out).toEqual({ endsAt: "2026-05-24", finished: true });
  });

  it("svarer null for en sæson, leverandøren ikke kender", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(comp({ start: "2026-08-14", end: "2027-05-23" }, [])));
    await expect(footballdata.fetchSeasonMeta({ apiLeagueId: "PL", apiSeasonId: "2019", token: "t", fetchImpl }))
      .resolves.toBeNull();
  });
});
