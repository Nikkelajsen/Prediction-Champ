import { describe, it, expect } from "vitest";
// Samme mønster som components.test.jsx: markup via renderToStaticMarkup, intet
// komponent-testbibliotek.
//
// Én ting kan denne opsætning IKKE: renderToStaticMarkup kører ikke React'
// fejlgrænse-maskineri — et kast fra et barn rethrowes i stedet for at give
// fallbacken (efterprøvet). Selve indfangningen hører derfor til browser-tjekket
// i DOCUMENTATION.md afsnit 11. Det, der kan pinnes her, er de tre dele, som
// indfangningen består af: at getDerivedStateFromError vender tilstanden, at
// fallbacken siger og tilbyder det rigtige, og at et rask træ går uberørt igennem.
import { renderToStaticMarkup } from "react-dom/server";
import ErrorBoundary, { Fallback } from "./ErrorBoundary.jsx";

describe("ErrorBoundary", () => {
  it("vender tilstanden til fejlet, når et barn kaster", () => {
    expect(ErrorBoundary.getDerivedStateFromError(new Error("boom"))).toEqual({ failed: true });
  });

  it("lader et rask træ passere uændret", () => {
    const html = renderToStaticMarkup(<ErrorBoundary><p>alt vel</p></ErrorBoundary>);
    expect(html).toBe("<p>alt vel</p>");
  });
});

describe("ErrorBoundary — fallbacken", () => {
  it("navngiver fejlen og tilbyder en vej videre", () => {
    const html = renderToStaticMarkup(<Fallback />);
    expect(html).toContain("Noget gik galt");
    expect(html).toContain("Genindlæs appen");
  });

  it("bærer sin egen globalCss, så den ikke renderes uden appens skrifter", () => {
    // App.jsx injicerer globalCss i alle tre af sine grene — er det App, der
    // kaster, findes den <style> ikke, når fallbacken tegnes.
    const html = renderToStaticMarkup(<Fallback />);
    expect(html).toContain("<style>");
    expect(html).toContain("Barlow");
  });

  it("beroliger om det, brugeren faktisk frygter: at tips gik tabt", () => {
    expect(renderToStaticMarkup(<Fallback />)).toContain("Dine tips er gemt");
  });
});
