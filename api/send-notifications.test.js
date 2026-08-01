// Første tests for api/. Vitest kører uden konfigurationsfil, så
// default-include (**/*.test.js) samler filen op — der skal intet sættes op.
//
// Dækker de to invarianter, G9 og G10 brød: runde-resultat-notifikationen skal
// afgrænse BEGGE sine sider til de officielle turneringer, ellers er udløseren
// og indholdet uenige om, hvilke kampe runden består af.
import { describe, it, expect } from "vitest";
import { finishedRoundKeys, officialSeasonIds } from "./send-notifications.js";

const kamp = (round_key, home_score, away_score) => ({ id: `${round_key}-${home_score}-${away_score}`, round_key, home_score, away_score });

describe("finishedRoundKeys", () => {
  it("melder en runde færdig, når hver kamp har begge scorer", () => {
    expect(finishedRoundKeys([kamp("2026-08-04", 2, 1), kamp("2026-08-04", 0, 0)])).toEqual(["2026-08-04"]);
  });

  // G10's kerne: ÉN uspillet kamp holder hele runden tilbage. Det er korrekt
  // adfærd — fejlen var, at listen indeholdt kampe fra turneringer, stillingen
  // ikke dækker. Afgrænsningen sker i kaldet, invarianten her er "alle eller ingen".
  it("melder ikke en runde færdig, når én kamp mangler resultat", () => {
    expect(finishedRoundKeys([kamp("2026-08-04", 2, 1), kamp("2026-08-04", null, null)])).toEqual([]);
  });

  // Et 0-0 er et resultat: null-tjekket skal være på null og ikke på falsy,
  // ellers ville hver målløs kamp holde sin runde åben for evigt.
  it("behandler 0-0 som et resultat", () => {
    expect(finishedRoundKeys([kamp("2026-08-04", 0, 0)])).toEqual(["2026-08-04"]);
  });

  it("melder ikke en runde færdig, når kun den ene scorer er sat", () => {
    expect(finishedRoundKeys([kamp("2026-08-04", 3, null)])).toEqual([]);
    expect(finishedRoundKeys([kamp("2026-08-04", null, 3)])).toEqual([]);
  });

  it("afgør hver runde for sig", () => {
    const ud = finishedRoundKeys([
      kamp("2026-07-28", 1, 1),
      kamp("2026-08-04", 2, 0),
      kamp("2026-08-04", null, null),
    ]);
    expect(ud).toEqual(["2026-07-28"]);
  });

  it("giver ingen runder for en tom liste", () => {
    expect(finishedRoundKeys([])).toEqual([]);
  });
});

describe("officialSeasonIds", () => {
  // Stub-sb: returnerer svar pr. sti og husker, hvad der blev spurgt om.
  const stubSb = (svar) => {
    const kald = [];
    const sb = async (path) => {
      kald.push(path);
      const nøgle = Object.keys(svar).find((k) => path.startsWith(k));
      return nøgle ? svar[nøgle] : [];
    };
    return { sb, kald };
  };

  it("slår sæsoner op under de officielle turneringer", async () => {
    const { sb, kald } = stubSb({
      "/rest/v1/leagues": [{ id: "liga-1" }, { id: "liga-2" }],
      "/rest/v1/seasons": [{ id: "sæson-a" }, { id: "sæson-b" }],
    });
    expect(await officialSeasonIds(sb)).toEqual(["sæson-a", "sæson-b"]);
    expect(kald[0]).toContain("is_official=is.true");
    expect(kald[1]).toContain("league_id=in.(liga-1,liga-2)");
  });

  // Uden denne guard ville sæson-opslaget blive `in.()`, som PostgREST afviser
  // med 400 — og sb() kaster ved alt andet end 2xx, så hele kørslen ville vælte.
  it("springer sæson-opslaget over, når ingen turnering er officiel", async () => {
    const { sb, kald } = stubSb({ "/rest/v1/leagues": [] });
    expect(await officialSeasonIds(sb)).toEqual([]);
    expect(kald).toHaveLength(1);
  });
});
