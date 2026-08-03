import { describe, it, expect } from "vitest";
import { globalCss, font } from "./theme.js";

// Skrifterne selv-hostes (B4). Det er den slags, der kan glide tilbage uden at
// nogen opdager det: en @import er én linje, den virker med det samme, og
// forskellen kan ikke ses i browseren — kun i netværksfanen.
describe("globalCss henter ikke skrifter udefra", () => {
  it("nævner ingen af Googles font-værter", () => {
    expect(globalCss).not.toContain("fonts.googleapis.com");
    expect(globalCss).not.toContain("fonts.gstatic.com");
    // @import overhovedet: en fremtidig ekstern stylesheet ville have samme
    // problem, uanset hvem der hoster den.
    expect(globalCss).not.toContain("@import");
  });

  it("henter alt fra vores eget domæne", () => {
    const kilder = [...globalCss.matchAll(/src:\s*url\('([^']+)'\)/g)].map((m) => m[1]);
    expect(kilder.length).toBeGreaterThan(0);
    for (const k of kilder) expect(k.startsWith("/fonts/")).toBe(true);
  });

  // Fem vægte × to subsets. Tallet er ikke pynt: falder det, er en vægt tabt og
  // browseren syntetiserer den i stedet — hvilket ser ud som en designfejl og
  // ikke som en manglende fil.
  it("har præcis de ti @font-face-blokke, filerne dækker", () => {
    expect(globalCss.match(/@font-face/g)).toHaveLength(10);
  });

  it("bruger font-display: swap på hver blok", () => {
    expect(globalCss.match(/font-display:\s*swap/g)).toHaveLength(10);
  });

  // unicode-range er dét, der gør latin-ext gratis for en dansk bruger. Uden
  // den henter browseren begge filer for hver vægt.
  it("afgrænser hver blok med unicode-range", () => {
    expect(globalCss.match(/unicode-range:/g)).toHaveLength(10);
  });
});

describe("font-kæden lover kun skrifter, vi leverer", () => {
  // 'Inter' stod her uden nogensinde at blive hentet. En fallback, der ikke
  // findes, er ikke en fallback — den er en påstand om et design, ingen ser.
  it("nævner ingen skrift uden en @font-face", () => {
    for (const kæde of [font.display, font.body]) {
      for (const navn of kæde.match(/'([^']+)'/g) ?? []) {
        expect(globalCss).toContain(`font-family: ${navn}`);
      }
    }
  });
});
