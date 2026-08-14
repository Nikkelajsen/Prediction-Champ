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

  // "Tid ikke fastlagt". Sportmonks har ingen status for "dato kendt, klokkeslæt
  // ukendt" — den tilstand en Superliga-runde står i, indtil TV-tiderne falder
  // på plads — så to markører må bære den: state TBA, og midnat-pladsholderen
  // i starting_at.
  describe("kickoffTbd", () => {
    it("er falsk for en kamp med et rigtigt klokkeslæt", () => {
      expect(normalize(fixture()).kickoffTbd).toBe(false);
      expect(normalize(fixture({ starting_at: "2026-09-13 20:00:00" })).kickoffTbd).toBe(false);
    });

    it("er sand, når starting_at står på midnat", () => {
      // Sådan så de seks Superliga-kampe ud seks uger før runden: kun datoen var
      // kendt. Gemt ordret som 00:00 UTC blev de vist som "02.00" dansk tid.
      const n = normalize(fixture({
        starting_at: "2026-09-13 00:00:00",
        state: { short_name: "NS", developer_name: "NS" },
      }));
      expect(n.kickoffTbd).toBe(true);
      expect(n.status).toBe("scheduled"); // statussen selv er uændret
    });

    it("er sand for state TBA, uanset hvad der står i starting_at", () => {
      const n = normalize(fixture({
        starting_at: "2026-09-13 16:00:00",
        state: { short_name: "TBA", developer_name: "TBA" },
      }));
      expect(n.kickoffTbd).toBe(true);
    });

    it("er falsk, når starting_at helt mangler", () => {
      expect(normalize(fixture({ starting_at: null })).kickoffTbd).toBe(false);
    });
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

describe("fetchSeasonMeta", () => {
  const liga = (seasons) => jsonResponse({ data: { seasons } });

  it("læser ending_at og finished af sæsonobjektet", async () => {
    const fetchImpl = vi.fn(async () => liga([
      { id: 28275, name: "2026/2027", ending_at: "2027-05-24", finished: false },
      { id: 1, name: "2025/2026", ending_at: "2026-05-25", finished: true },
    ]));
    await expect(sportmonks.fetchSeasonMeta({ apiLeagueId: "271", apiSeasonId: "28275", token: "t", fetchImpl }))
      .resolves.toEqual({ endsAt: "2027-05-24", finished: false });
    await expect(sportmonks.fetchSeasonMeta({ apiLeagueId: "271", apiSeasonId: "1", token: "t", fetchImpl }))
      .resolves.toEqual({ endsAt: "2026-05-25", finished: true });
  });

  // "Ved ikke" må aldrig blive til "slut": et manglende felt betyder ikke, at
  // sæsonen er færdig — og en sæson, der fejlagtigt meldes færdig, uddeler
  // milepæle, der ikke kan tages tilbage.
  it("melder ikke færdig, når feltet mangler", async () => {
    const fetchImpl = vi.fn(async () => liga([{ id: 5, name: "2026/2027" }]));
    await expect(sportmonks.fetchSeasonMeta({ apiLeagueId: "271", apiSeasonId: "5", token: "t", fetchImpl }))
      .resolves.toEqual({ endsAt: null, finished: false });
  });

  it("svarer null for en sæson, der ikke er i svaret", async () => {
    const fetchImpl = vi.fn(async () => liga([{ id: 5, name: "2026/2027" }]));
    await expect(sportmonks.fetchSeasonMeta({ apiLeagueId: "271", apiSeasonId: "999", token: "t", fetchImpl }))
      .resolves.toBeNull();
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

// G109: en langsom leverandør er ikke en fejlende leverandør.
//
// 14. august 2026 fejlede sync-live i omtrent to ud af tre minutter med en
// tidsgrænse på ét fixture-id og den letteste include-kombination, endpointet
// kan få — ikke ét eneste 4xx eller 5xx. De kørsler, der lykkedes, tog 7-13
// sekunder, altså lige under grænsen på 10. Rettelsen er to ting, der kun
// giver mening sammen: en højere grænse PR. KALD og et budget for HELE
// opslaget, så det højere loft ikke bare flytter afklipningen op til Vercels
// `maxDuration`, hvor en kørsel fejler UDEN at efterlade en fejl at læse.
describe("live-opslaget og en langsom leverandør (G109)", () => {
  const timeout = () => {
    const e = new Error("Tidsgrænse: intet svar fra https://x.test inden for 20000 ms");
    e.timeout = true;
    return e;
  };
  const svar = (status, body = {}) => ({
    ok: status < 400, status,
    headers: { get: () => null },
    text: async () => "", json: async () => body,
  });

  it("prøver præcis én gang mere, når kaldet løb ud i tid", async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(timeout())
      .mockResolvedValueOnce(svar(200, { data: [fixture({ id: 7 })] }));

    const out = await sportmonks.fetchLive({ providerIds: ["7"], token: "t", fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out.get("7").score).toEqual({ home: 2, away: 1 });
    // Gen-forsøget er det SAMME kald, ikke et fald tilbage til en mindre
    // include: en timeout siger intet om, hvad abonnementet indeholder.
    for (const [url] of fetchImpl.mock.calls) expect(url).toContain("periods");
  });

  it("giver op efter det ene gen-forsøg og lader fejlen nå driftsloggen", async () => {
    const fetchImpl = vi.fn(async () => { throw timeout(); });
    await expect(
      sportmonks.fetchLive({ providerIds: ["7"], token: "t", fetchImpl })
    ).rejects.toThrow(/Tidsgrænse/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // 🔴 DEN TEST, DER MANGLEDE — og som ville have fanget, at G109s gen-forsøg
  // aldrig fyrede i produktion.
  //
  // Testen ovenfor lader `fetchImpl` kaste ØJEBLIKKELIGT, så uret ikke er
  // rykket, når budgettet spørges. Et rigtigt timeout tager derimod HELE
  // tidsgrænsen — og så var `fits(0)` (`timeLeftMs() >= perCall`) falsk med et
  // budget på præcis 2 × grænsen, hver eneste gang. Aflæst i produktionen
  // 14. august 2026: de fejlende kørsler tog 21,7 s hos cron-job.org, ikke de
  // ~41 s, to forsøg ville have kostet.
  it("prøver igen efter et timeout, der tog HELE tidsgrænsen", async () => {
    const { LIVE_TIMEOUT_MS } = __test;
    let ur = 0;
    const fetchImpl = vi.fn(async () => {
      // Et rigtigt timeout: grænsen plus den smule, opsætningen koster.
      ur += LIVE_TIMEOUT_MS + 120;
      throw timeout();
    });
    await expect(
      sportmonks.fetchLive({ providerIds: ["7"], token: "t", fetchImpl, now: () => ur })
    ).rejects.toThrow(/Tidsgrænse/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // Budgettet er stadig loftet: gen-forsøget må gerne få mindre end en fuld
  // tidsgrænse, men det skal holde sig inden for det, kørslen har tilbage.
  it("giver gen-forsøget den tid, der er tilbage — aldrig mere", async () => {
    const { LIVE_TIMEOUT_MS, LIVE_BUDGET_MS } = __test;
    let ur = 0;
    const fetchImpl = vi.fn(async () => { ur += LIVE_TIMEOUT_MS + 120; throw timeout(); });
    await expect(
      sportmonks.fetchLive({ providerIds: ["7"], token: "t", fetchImpl, now: () => ur })
    ).rejects.toThrow(/Tidsgrænse/);
    const [, andet] = fetchImpl.mock.calls;
    expect(andet[2]).toBeLessThanOrEqual(LIVE_TIMEOUT_MS);
    expect(andet[2]).toBeGreaterThan(0);
    // Summen af de to grænser må ikke kunne sprænge budgettet.
    expect(fetchImpl.mock.calls[0][2] + andet[2]).toBeLessThanOrEqual(LIVE_BUDGET_MS);
  });

  // Grænsen er hævet netop dér, hvor problemet er — ikke overalt. De to
  // sæson-opslag kører hver 12. time og har ingen grund til at vente længere.
  it("sender live-kaldet med sin egen, højere tidsgrænse", async () => {
    const { LIVE_TIMEOUT_MS } = __test;
    const fetchImpl = vi.fn(async () => svar(200, { data: [] }));
    await sportmonks.fetchLive({ providerIds: ["7"], token: "t", fetchImpl });
    expect(fetchImpl.mock.calls[0][2]).toBe(LIVE_TIMEOUT_MS);
  });

  it("lader sæson-opslagene beholde standardgrænsen", async () => {
    const fetchImpl = vi.fn(async () => svar(200, { data: [], pagination: { has_more: false } }));
    await sportmonks.fetchSeasonFixtures({ apiSeasonId: "1", token: "t", fetchImpl });
    // Ingen tredje parameter = `fetchWithTimeout`s egen FETCH_TIMEOUT_MS.
    expect(fetchImpl.mock.calls[0][2]).toBeUndefined();
  });

  // Selve grunden til, at budgettet findes. Uden det ville et gen-forsøg efter
  // et 20-sekunders kald kunne fortsætte ind i Vercels afklipning.
  //
  // Grænsen er `LIVE_MIN_CALL_MS` og ikke en hel tidsgrænse mere (`G116`): et
  // gen-forsøg med resten af budgettet er et rigtigt gen-forsøg, et med under
  // to sekunder er ikke. Kravet om en HEL grænse var netop dét, der gjorde
  // gen-forsøget til død kode, når budgettet var 2 × grænsen.
  it("prøver IKKE igen, når der ikke er tid til et kald, der er værd at sende", async () => {
    const { LIVE_BUDGET_MS, LIVE_MIN_CALL_MS } = __test;
    let ur = 0;
    // Første kald "tager" alt på nær mindre end det mindste brugbare kald.
    const fetchImpl = vi.fn(async () => {
      ur += LIVE_BUDGET_MS - (LIVE_MIN_CALL_MS - 500);
      throw timeout();
    });
    await expect(
      sportmonks.fetchLive({ providerIds: ["7"], token: "t", fetchImpl, now: () => ur })
    ).rejects.toThrow(/Tidsgrænse/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // Den anden side af samme grænse — uden den ville testen ovenfor være grøn
  // for en implementering, der aldrig prøver igen (præcis den, `G116` fandt).
  it("prøver igen, når der lige akkurat ER tid til et kald", async () => {
    const { LIVE_BUDGET_MS, LIVE_MIN_CALL_MS } = __test;
    let ur = 0;
    const fetchImpl = vi.fn(async () => {
      ur += LIVE_BUDGET_MS - (LIVE_MIN_CALL_MS + 500);
      throw timeout();
    });
    await expect(
      sportmonks.fetchLive({ providerIds: ["7"], token: "t", fetchImpl, now: () => ur })
    ).rejects.toThrow(/Tidsgrænse/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][2]).toBe(LIVE_MIN_CALL_MS + 500);
  });

  // Samme regel for 429-pausen: en pause på op til 30 sekunder oven på et
  // langsomt kald er præcis den kombination, budgettet skal fange.
  it("venter ikke på Retry-After, når pausen ikke kan nås inden for budgettet", async () => {
    const { LIVE_BUDGET_MS } = __test;
    let ur = 0;
    const ventet = [];
    const fetchImpl = vi.fn(async () => {
      ur += LIVE_BUDGET_MS - 5_000;
      return { ok: false, status: 429, headers: { get: () => "30" }, text: async () => "", json: async () => ({}) };
    });
    await expect(
      sportmonks.fetchLive({
        providerIds: ["7"], token: "t", fetchImpl,
        sleep: async (ms) => { ventet.push(ms); }, now: () => ur,
      })
    ).rejects.toThrow(/Sportmonks \(live\): 429/);
    expect(ventet).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // Klumperne deler ét budget. Er det brugt, skal den næste klump sige det med
  // rene ord frem for at sende et kald med en grænse, ingen kan svare inden for.
  it("stopper med en læsbar fejl, når budgettet er brugt midt i klumperne", async () => {
    const { LIVE_BUDGET_MS } = __test;
    let ur = 0;
    const fetchImpl = vi.fn(async () => { ur += LIVE_BUDGET_MS; return svar(200, { data: [] }); });
    const ids = Array.from({ length: 41 }, (_, i) => String(i + 1));
    await expect(
      sportmonks.fetchLive({ providerIds: ids, token: "t", fetchImpl, now: () => ur })
    ).rejects.toThrow(/tidsbudgettet på 40000 ms er brugt efter 40 af 41 kampe/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // Gen-forsøget gælder KUN timeouts. En ECONNREFUSED er et svar, og et
  // gen-forsøg på et svar er bare et kald mere.
  it("prøver ikke igen ved en netværksfejl, der ikke er en tidsgrænse", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    await expect(
      sportmonks.fetchLive({ providerIds: ["7"], token: "t", fetchImpl })
    ).rejects.toThrow("ECONNREFUSED");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

// A15: hvilket tal gælder for gratis-planen — 180 pr. entitet eller 3.000?
//
// Spørgsmålet har stået åbent, fordi svaret krævede en henvendelse til
// supporten. Det gør det ikke: Sportmonks lægger sit eget regnskab i hvert
// svar, og `requested_entity` er netop det felt, der afgør, om grænsen er pr.
// entitet. Aflæses i Admin → Drift.
//
// Svaret kom 2. august 2026: `Fixture`, 2996 tilbage efter fire kald, 3600 s
// vindue — altså 3.000 i timen PR. ENTITET. Testene herunder er derfor ikke
// længere kun forberedelse: de holder på det felt, beslutningen hviler på.
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
