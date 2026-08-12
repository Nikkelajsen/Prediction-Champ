import { describe, it, expect, vi, beforeEach } from "vitest";

// Test af crawler-portvagten (`I7`).
//
// HVORFOR DEN FINDES NU OG IKKE FØR. Porten var konfiguration — to `has`-
// betingelser i `vercel.json` — og konfiguration kan ikke unit-testes. Det var
// ikke en teoretisk mangel: reglen var **død** i produktion, fordi en rewrite
// ligger efter filsystem-opslaget, og hverken deployet eller CI sagde et ord.
// Nu er porten JavaScript, og så kan påstanden efterprøves.
//
// **Det, der testes, er en sikkerhedsgrænse.** `I7` hviler på sætningen "et
// menneske kan pr. konstruktion ikke ende i funktionen" — det er dén, der gør
// "fejl åben" til en egenskab ved opsætningen frem for et løfte, koden skal
// holde. Falder den, er det ikke previewet, der går i stykker; det er
// argumentet for, at funktionen må fejle, som ikke længere gælder.
vi.mock("@vercel/functions", () => ({
  rewrite: vi.fn((mål) => ({ slags: "rewrite", mål: String(mål) })),
  next: vi.fn(() => ({ slags: "next" })),
}));

import { rewrite, next } from "@vercel/functions";
import middleware, { config } from "./middleware.js";

const CRAWLER = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const MENNESKE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const kald = (url, ua) =>
  middleware({ url, headers: { get: (n) => (n.toLowerCase() === "user-agent" ? ua : null) } });

beforeEach(() => {
  rewrite.mockClear();
  next.mockClear();
});

describe("porten kræver BEGGE betingelser", () => {
  it("sender en crawler med en liga-kode videre til funktionen", () => {
    const r = kald("https://leagly.app/?liga=abc12345", CRAWLER);
    expect(r.slags).toBe("rewrite");
    expect(r.mål).toBe("https://leagly.app/api/invite-preview?liga=abc12345");
  });

  it("gør det samme for en konkurrence-kode", () => {
    expect(kald("https://leagly.app/?join=deadbeef", CRAWLER).mål)
      .toBe("https://leagly.app/api/invite-preview?join=deadbeef");
  });

  // Den vigtigste af de fire: uden den er "et menneske rammer aldrig
  // funktionen" ikke længere sandt, og så er hele fejl-åben-argumentet væk.
  it("lader et MENNESKE med en kode gå til appen", () => {
    expect(kald("https://leagly.app/?liga=abc12345", MENNESKE).slags).toBe("next");
    expect(rewrite).not.toHaveBeenCalled();
  });

  it("lader en crawler UDEN kode gå til den statiske forside", () => {
    expect(kald("https://leagly.app/", CRAWLER).slags).toBe("next");
    expect(rewrite).not.toHaveBeenCalled();
  });

  // Googlebot står bevidst ikke på listen: en søgemaskine skal se det samme
  // som brugeren. Fjernes den beslutning, skal den fjernes med vilje.
  it("regner ikke Googlebot for en crawler her", () => {
    expect(kald("https://leagly.app/?liga=abc12345", "Googlebot/2.1").slags).toBe("next");
  });

  it("tåler en request helt uden User-Agent", () => {
    expect(kald("https://leagly.app/?liga=abc12345", null).slags).toBe("next");
  });
});

describe("koden følger med, og kun den", () => {
  it("bevarer hele query-strengen, så funktionen kan læse req.query", () => {
    expect(kald("https://leagly.app/?liga=abc12345&utm_source=whatsapp", CRAWLER).mål)
      .toContain("?liga=abc12345&utm_source=whatsapp");
  });

  it("peger på funktionen og ikke på noget andet", () => {
    expect(new URL(kald("https://leagly.app/?liga=abc12345", CRAWLER).mål).pathname)
      .toBe("/api/invite-preview");
  });
});

describe("fejl åben", () => {
  // Middlewaren kører på appens FORSIDE. En undtagelse ville give 500 til alle
  // — også dem uden invitationskode — og dermed gøre et manglende preview til
  // et nedbrud af hele indgangen.
  it("falder igennem til appen, hvis noget kaster", () => {
    const r = middleware({
      url: "https://leagly.app/?liga=abc12345",
      headers: { get: () => { throw new Error("uventet"); } },
    });
    expect(r.slags).toBe("next");
  });

  it("kaster ikke selv, når request er noget helt andet", () => {
    expect(() => middleware({})).not.toThrow();
  });
});

describe("matcheren", () => {
  // Kun forsiden. Bredere ville betyde en edge-invokation på hvert eneste
  // asset — smallere findes ikke, for query og User-Agent kan matcheren ikke se.
  it("dækker kun forsiden", () => {
    expect(config.matcher).toBe("/");
  });
});
