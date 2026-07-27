import { describe, it, expect } from "vitest";
// renderToStaticMarkup frem for en jsdom-opsætning: PlayerName er ren markup,
// og projektet skal ikke have et komponent-testbibliotek for den ene komponents skyld.
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerName, UserRoundPredictions } from "./components.jsx";

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

// Pointvisningen skal sige det samme overalt: PointsPill har altid vist 0 som "0",
// mens runde-overlayet skrev "+0" for et forkert gæt — og "Sådan virker det"
// lover "0 ellers".
describe("UserRoundPredictions: pointvisning", () => {
  const round = {
    key: "2026-07-14",
    label: "14.07 – 20.07",
    matches: [
      { id: "m1", _home: "Hjemme", _away: "Ude", home_score: 3, away_score: 0 }, // forkert gæt ⇒ 0
      { id: "m2", _home: "A", _away: "B", home_score: 2, away_score: 1 },        // præcist ⇒ +3
      { id: "m3", _home: "C", _away: "D", home_score: null, away_score: null },  // låst, ikke spillet
    ],
  };
  const predsByKey = new Map([
    ["m1:u1", { pred_home: 0, pred_away: 0 }],
    ["m2:u1", { pred_home: 2, pred_away: 1 }],
    ["m3:u1", { pred_home: 1, pred_away: 1 }],
  ]);
  const html = () => renderToStaticMarkup(
    <UserRoundPredictions playerName="Nikolaj" userId="u1" lockedRounds={[round]}
      predsByKey={predsByKey} rules={{ exact: 3, outcome: 1 }} onClose={() => {}} />
  );

  it("viser 0 point som \"0\", ikke \"+0\"", () => {
    const out = html();
    expect(out).toContain("Hjemme"); // rækken er faktisk renderet
    expect(out).not.toContain("+0");
  });

  it("beholder plus foran point, der faktisk er givet", () => {
    expect(html()).toContain("+3");
  });

  // en låst, endnu ikke spillet kamp har hverken facit eller point
  it("viser – for en kamp uden resultat", () => {
    expect(html()).toContain("–");
  });
});
