// Tests for api/_providers/sportmonks.js.
//
// Koden i modulet er FLYTTET ud af api/sync-matches.js og api/sync-live.js, ikke
// nyskrevet. Testene her findes for at kunne bevise netop det: mappingen af
// Sportmonks' felter er den, Superligaen har kørt på, og en oprydning må ikke
// flytte et eneste resultat. Derfor er eksemplerne bygget efter de felter, den
// gamle kode faktisk læste — participants[].meta.location,
// scores[].description === "CURRENT", state.short_name, periods[].ticking.
import { describe, it, expect, vi } from "vitest";
import { sportmonks, smFetch, __test } from "./sportmonks.js";

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

// G48: 429 skal give ét gen-forsøg efter en pause — ikke et ekstra kald med det
// samme.
//
// Providermodulet gen-forsøgte indtil august 2026 STRAKS ved enhver 4xx i
// fetchLive, inklusive 429. Et ekstra kald mod en grænse, der lige er ramt,
// gør situationen værre og kan forlænge udelukkelsen; `sync-live` kører hvert
// minut, så det skete igen og igen. footballdata-provideren gjorde det rigtigt
// fra starten, så mønsteret fandtes allerede i repoet.
describe("smFetch — grænsen på kald i timen", () => {
  const svar = (status, headers = {}) => ({
    ok: status < 400, status,
    headers: { get: (h) => headers[h] ?? null },
    text: async () => "", json: async () => ({}),
  });

  it("prøver præcis én gang mere efter en pause ved 429", async () => {
    const ventet = [];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(svar(429, { "Retry-After": "3" }))
      .mockResolvedValueOnce(svar(200));

    const r = await smFetch("https://x.test/a", fetchImpl, async (ms) => { ventet.push(ms); });

    expect(r.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(ventet).toEqual([3000]);
  });

  it("giver op efter det ene gen-forsøg frem for at banke videre", async () => {
    const fetchImpl = vi.fn(async () => svar(429));
    const r = await smFetch("https://x.test/a", fetchImpl, async () => {});
    expect(r.status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rører ikke andre statusser", async () => {
    for (const status of [200, 403, 404, 500]) {
      const fetchImpl = vi.fn(async () => svar(status));
      await smFetch("https://x.test/a", fetchImpl, async () => {});
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  // En absurd Retry-After ville ellers bruge hele funktionens budget på at
  // vente, og et kald, der aldrig når at blive sendt, er værre end et, der
  // fejler hurtigt.
  it("lægger loft over ventetiden og falder tilbage, når headeren mangler", () => {
    const { retryAfterMs, RETRY_AFTER_MAX_S, RETRY_AFTER_FALLBACK_S } = __test;
    const res = (v) => ({ headers: { get: () => v } });
    expect(retryAfterMs(res("3"))).toBe(3000);
    expect(retryAfterMs(res("9999"))).toBe(RETRY_AFTER_MAX_S * 1000);
    expect(retryAfterMs(res(null))).toBe(RETRY_AFTER_FALLBACK_S * 1000);
    expect(retryAfterMs(res("nonsens"))).toBe(RETRY_AFTER_FALLBACK_S * 1000);
    expect(retryAfterMs(res("-5"))).toBe(RETRY_AFTER_FALLBACK_S * 1000);
  });
});

describe("fetchLive og 429", () => {
  const svar = (status, body = {}) => ({
    ok: status < 400, status,
    headers: { get: () => null },
    text: async () => "", json: async () => body,
  });

  // Selve rettelsen. En for høj kaldefrekvens har intet med `periods` at gøre,
  // så et kald uden den include ville blot være ET KALD MERE mod en grænse, der
  // lige er ramt. smFetch har allerede ventet og prøvet igen.
  it("falder IKKE tilbage til et kald uden periods ved 429", async () => {
    const fetchImpl = vi.fn(async () => svar(429));
    await expect(
      sportmonks.fetchLive({ providerIds: ["7"], token: "t", fetchImpl, sleep: async () => {} })
    ).rejects.toThrow(/Sportmonks \(live\): 429/);
    // To kald: det oprindelige og smFetch's ene gen-forsøg. Ikke fire.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [url] of fetchImpl.mock.calls) expect(url).toContain("periods");
  });

  // Fald-tilbage'et skal stadig virke for det, det var til: en include, der
  // ikke er med i abonnementet.
  it("falder stadig tilbage ved 403", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(svar(403))
      .mockResolvedValueOnce(svar(200, { data: [fixture({ id: 7 })] }));
    const out = await sportmonks.fetchLive({ providerIds: ["7"], token: "t", fetchImpl });
    expect(out.get("7")).toBeTruthy();
    expect(fetchImpl.mock.calls[1][0]).not.toContain("periods");
  });
});

// A15: hvilket tal gælder for gratis-planen — 180 pr. entitet eller 3.000?
//
// Spørgsmålet har stået åbent, fordi svaret krævede en henvendelse til
// supporten. Det gør det ikke: Sportmonks lægger sit eget regnskab i hvert
// svar, og `requested_entity` er netop det felt, der afgør, om grænsen er pr.
// entitet. Aflæses i Admin → Drift.
describe("readRateLimit", () => {
  const { readRateLimit } = __test;

  it("plukker de tre felter, spørgsmålet handler om", () => {
    const meta = {};
    readRateLimit({ rate_limit: { remaining: 2999, resets_in_seconds: 3540, requested_entity: "Fixture" } }, meta);
    expect(meta.rateLimit).toEqual({ remaining: 2999, resetsInSeconds: 3540, entity: "Fixture" });
  });

  // Feltet er VALGFRIT. Er det der ikke — anden plan, ændret svarformat —
  // skrives intet, og alt fungerer som før. En aflæsning, der kræver en
  // ændring hos leverandøren for at fejle stille, er ikke værd at have.
  it("skriver intet, når leverandøren ikke rapporterer noget", () => {
    const meta = {};
    readRateLimit({ data: [] }, meta);
    readRateLimit(null, meta);
    expect(meta).toEqual({});
  });

  it("tåler at blive kaldt uden et sted at skrive hen", () => {
    expect(() => readRateLimit({ rate_limit: { remaining: 1 } }, undefined)).not.toThrow();
  });

  it("bevarer feltet som null frem for at udelade det, når kun nogle er der", () => {
    const meta = {};
    readRateLimit({ rate_limit: { remaining: 7 } }, meta);
    expect(meta.rateLimit).toEqual({ remaining: 7, resetsInSeconds: null, entity: null });
  });
});

describe("providerne fører forbruget videre", () => {
  const svar = (body) => ({ ok: true, status: 200, headers: { get: () => null },
    text: async () => JSON.stringify(body), json: async () => body });
  const RL = { remaining: 2999, resets_in_seconds: 3540, requested_entity: "Fixture" };

  it("fra kampprogram-opslaget", async () => {
    const meta = {};
    const fetchImpl = vi.fn(async () => svar({ data: [fixture({ id: 1 })], pagination: { has_more: false }, rate_limit: RL }));
    await sportmonks.fetchSeasonFixtures({ apiSeasonId: "1", token: "t", fetchImpl, meta });
    expect(meta.rateLimit.remaining).toBe(2999);
  });

  // Det vigtigste sted: sync-live kører hvert minut og kommer dermed tættest
  // på grænsen af alle jobs.
  it("fra live-opslaget", async () => {
    const meta = {};
    const fetchImpl = vi.fn(async () => svar({ data: [fixture({ id: 7 })], rate_limit: RL }));
    await sportmonks.fetchLive({ providerIds: ["7"], token: "t", fetchImpl, meta });
    expect(meta.rateLimit.entity).toBe("Fixture");
  });
})
