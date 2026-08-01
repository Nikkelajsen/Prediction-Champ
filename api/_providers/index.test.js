// Tests for api/_providers/index.js — registret over datakilder.
import { describe, it, expect } from "vitest";
import { getProvider, providerToken, indexSeasons, DEFAULT_PROVIDER, PROVIDERS } from "./index.js";

describe("getProvider", () => {
  it("slår begge kendte datakilder op", () => {
    expect(getProvider("sportmonks").key).toBe("sportmonks");
    expect(getProvider("footballdata").key).toBe("footballdata");
  });

  it("falder tilbage til sportmonks, når kolonnen er tom", () => {
    // Ligaer oprettet før leagues.provider fandtes. Migreringen sætter en
    // default, men koden må ikke afhænge af, at den er kørt.
    expect(getProvider(null).key).toBe(DEFAULT_PROVIDER);
    expect(getProvider(undefined).key).toBe("sportmonks");
  });

  it("fejler tydeligt på et ukendt navn og nævner de kendte", () => {
    expect(() => getProvider("opta")).toThrow(/Ukendt datakilde 'opta'/);
    expect(() => getProvider("opta")).toThrow(/sportmonks, footballdata/);
  });

  it("hver datakilde opfylder kontrakten", () => {
    for (const p of Object.values(PROVIDERS)) {
      expect(typeof p.key).toBe("string");
      expect(typeof p.tokenEnv).toBe("string");
      expect(typeof p.toGlobalId).toBe("function");
      expect(typeof p.fromGlobalId).toBe("function");
      expect(typeof p.resolveSeasonId).toBe("function");
      expect(typeof p.fetchSeasonFixtures).toBe("function");
      expect(typeof p.fetchLive).toBe("function");
      // Rundtur: et id skal kunne oversættes frem og tilbage. Går den i stykker,
      // henter sync-live de forkerte kampe — eller ingen.
      expect(p.fromGlobalId(p.toGlobalId("12345"))).toBe("12345");
    }
  });
});

describe("providerToken", () => {
  it("henter nøglen fra leverandørens egen miljøvariabel", () => {
    expect(providerToken(getProvider("footballdata"), { FOOTBALLDATA_TOKEN: "abc" })).toBe("abc");
  });

  it("nævner den manglende variabel ved navn", () => {
    // En football-data-liga må ikke fejle på SPORTMONKS_TOKEN — og omvendt.
    expect(() => providerToken(getProvider("footballdata"), { SPORTMONKS_TOKEN: "abc" }))
      .toThrow(/FOOTBALLDATA_TOKEN mangler/);
  });
});

describe("indexSeasons", () => {
  const leagues = [
    { id: "L1", name: "Superliga", provider: "sportmonks", live_enabled: true },
    { id: "L2", name: "Premier League", provider: "footballdata", live_enabled: false },
    { id: "L3", name: "Gammel liga", provider: null, live_enabled: null },
  ];
  const seasons = [
    { id: "S1", league_id: "L1" },
    { id: "S2", league_id: "L2" },
    { id: "S3", league_id: "L3" },
    { id: "S4", league_id: "findes-ikke" },
  ];

  it("kortlægger sæson til datakilde og live-flag", () => {
    const map = indexSeasons(leagues, seasons);
    expect(map.get("S1")).toMatchObject({ provider: "sportmonks", liveEnabled: true });
    expect(map.get("S2")).toMatchObject({ provider: "footballdata", liveEnabled: false });
  });

  it("behandler en liga fra før kolonnerne fandtes som i dag", () => {
    // null må ikke betyde "live slået fra" — det ville slukke Superligaens
    // live-kort i et miljø, hvor migreringen ikke er kørt endnu.
    const map = indexSeasons(leagues, seasons);
    expect(map.get("S3")).toMatchObject({ provider: "sportmonks", liveEnabled: true });
  });

  it("springer en sæson over, hvis ligaen mangler", () => {
    expect(indexSeasons(leagues, seasons).has("S4")).toBe(false);
  });

  it("tåler tomme svar", () => {
    expect(indexSeasons(null, null).size).toBe(0);
  });
});
