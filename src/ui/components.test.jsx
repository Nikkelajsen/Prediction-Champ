import { describe, it, expect } from "vitest";
// renderToStaticMarkup frem for en jsdom-opsætning: PlayerName er ren markup,
// og projektet skal ikke have et komponent-testbibliotek for den ene komponents skyld.
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerName, UserRoundPredictions, EmptyCompetitions, StatTile, StatGroup, MiniBars, HealthBar } from "./components.jsx";

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

describe("EmptyCompetitions", () => {
  // Tip-skærmen og stillingen havde hver sin blindgyde: en sætning uden en eneste
  // knap. Komponenten deles, så de to ikke kan divergere igen.
  it("forklarer hvad en konkurrence er, og viser begge veje ind", () => {
    const html = renderToStaticMarkup(<EmptyCompetitions onCreate={() => {}} onJoin={() => {}} />);
    expect(html).toContain("Opret konkurrence");
    expect(html).toContain("Deltag med kode");
    expect((html.match(/<button/g) || []).length).toBe(2);
    expect(html).toContain("det, du og din liga dyster i");
  });

  it("udelader en knap, kalderen ikke kan honorere", () => {
    const html = renderToStaticMarkup(<EmptyCompetitions onJoin={() => {}} />);
    expect(html).not.toContain("Opret konkurrence");
    expect((html.match(/<button/g) || []).length).toBe(1);
  });
});

// Flyttet fra AdminScreen.jsx (analytics v1) — nu to forbrugere (StatsPanel +
// AnalyticsPanel), samme grænse som resten af denne fils komponenter.
describe("StatTile/StatGroup/MiniBars (flyttet fra AdminScreen)", () => {
  it("StatTile viser label og value, og hint kun når det er sat", () => {
    const withHint = renderToStaticMarkup(<StatTile label="Aktive brugere" value={42} hint="seneste 7 dage" />);
    expect(withHint).toContain("Aktive brugere");
    expect(withHint).toContain("42");
    expect(withHint).toContain("seneste 7 dage");
    const withoutHint = renderToStaticMarkup(<StatTile label="Aktive brugere" value={42} />);
    expect(withoutHint).not.toContain("seneste 7 dage");
  });

  it("StatGroup renderer sin titel og alle børn", () => {
    const html = renderToStaticMarkup(
      <StatGroup title="Nøgletal"><StatTile label="A" value={1} /><StatTile label="B" value={2} /></StatGroup>
    );
    expect(html).toContain("Nøgletal");
    expect(html).toContain("A");
    expect(html).toContain("B");
  });

  it("MiniBars viser 'Ingen data endnu' for et tomt datasæt", () => {
    const html = renderToStaticMarkup(<MiniBars data={[]} color="#22C55E" formatLabel={(x) => x} />);
    expect(html).toContain("Ingen data endnu");
  });

  it("MiniBars renderer én søjle pr. datapunkt", () => {
    const data = [{ key: "a", value: 3 }, { key: "b", value: 7 }];
    const html = renderToStaticMarkup(<MiniBars data={data} color="#22C55E" formatLabel={(x) => x} />);
    expect((html.match(/title="/g) || []).length).toBe(2);
  });
});

// HealthBar: farve er ALDRIG eneste signal — tallet og ordet skal altid stå
// ved siden af, og en null-score (for ny liga uden nok data) må ikke vises
// som et vilkårligt 0.
describe("HealthBar", () => {
  it("null renderes som 'For ny', ikke som 0", () => {
    const html = renderToStaticMarkup(<HealthBar score={null} />);
    expect(html).toContain("For ny");
    expect(html).not.toContain(">0<");
  });

  it("viser altid tallet OG ordet — aldrig kun en farvet bjælke", () => {
    const sund = renderToStaticMarkup(<HealthBar score={85} />);
    expect(sund).toContain("85");
    expect(sund).toContain("Sund");
    const svag = renderToStaticMarkup(<HealthBar score={50} />);
    expect(svag).toContain("50");
    expect(svag).toContain("Svag");
    const kritisk = renderToStaticMarkup(<HealthBar score={10} />);
    expect(kritisk).toContain("10");
    expect(kritisk).toContain("Kritisk");
  });
});
