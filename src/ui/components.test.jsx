import { describe, it, expect } from "vitest";
// renderToStaticMarkup frem for en jsdom-opsætning: PlayerName er ren markup,
// og projektet skal ikke have et komponent-testbibliotek for den ene komponents skyld.
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerName } from "./components.jsx";

describe("PlayerName", () => {
  it("renderes som ren tekst uden onOpenProfile", () => {
    expect(renderToStaticMarkup(<PlayerName userId="u1" name="Nikolaj" />)).toBe("Nikolaj");
  });

  // fx en rival fra stories, hvor kun navnet er gemt i payload
  it("renderes som ren tekst uden userId", () => {
    expect(renderToStaticMarkup(<PlayerName name="Jimmy" onOpenProfile={() => {}} />)).toBe("Jimmy");
  });

  it("er en rigtig knap med (dig)-suffiks og eget aria-label", () => {
    const html = renderToStaticMarkup(<PlayerName userId="u1" name="Nikolaj" you onOpenProfile={() => {}} />);
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Din karriereprofil"');
    expect(html).toContain("Nikolaj (dig)");
  });

  it("navngiver andres profil i aria-label", () => {
    const html = renderToStaticMarkup(<PlayerName userId="u2" name="Jimmy" onOpenProfile={() => {}} />);
    expect(html).toContain('aria-label="Karriereprofil for Jimmy"');
  });

  // truncate bruges i stillingstabellerne (faste kolonnebredder); uden den skal
  // navnet beholde sin tekst-baseline, så det flugter med teksten omkring det
  it("trunkerer kun når truncate er sat", () => {
    const trunc = renderToStaticMarkup(<PlayerName userId="u1" name="Jimmy" truncate onOpenProfile={() => {}} />);
    const inline = renderToStaticMarkup(<PlayerName userId="u1" name="Jimmy" onOpenProfile={() => {}} />);
    expect(trunc).toContain("text-overflow:ellipsis");
    expect(inline).not.toContain("text-overflow");
    expect(inline).toContain("vertical-align:baseline");
  });
});
