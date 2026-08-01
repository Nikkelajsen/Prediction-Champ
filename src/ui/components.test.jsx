import { describe, it, expect } from "vitest";
// renderToStaticMarkup frem for en jsdom-opsætning: PlayerName er ren markup,
// og projektet skal ikke have et komponent-testbibliotek for den ene komponents skyld.
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerName, UserRoundPredictions, EmptyCompetitions, StatTile, StatGroup, MiniBars, StateChip, SignalRow, ScoreInput, Modal } from "./components.jsx";

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

  // value: null = INGEN MÅLING (fx en uge uden låste runder). Den må ikke
  // kunne forveksles med et ægte nul — samme regel som PctGrid følger.
  it("MiniBars skelner 'ingen data' fra et ægte nul", () => {
    const html = renderToStaticMarkup(
      <MiniBars data={[{ key: "a", value: null }, { key: "b", value: 0 }]} color="#22C55E" formatLabel={(x) => x} />
    );
    expect(html).toContain("ingen data");
    expect((html.match(/ingen data/g) || []).length).toBe(1);
  });

  it("StatTile viser en valgfri ⓘ ved siden af etiketten", () => {
    const html = renderToStaticMarkup(<StatTile label="Deltagelse" value="80 %" info={<span>FORKLARING</span>} />);
    expect(html).toContain("Deltagelse");
    expect(html).toContain("FORKLARING");
  });
});

// StateChip afløser HealthBar (juli 2026): den sammenvejede 0-100-score er
// fjernet, så der er ikke længere et tal at tegne en bjælke for. ORDET er
// signalet; farven er kun ekstra — og en tilstand uden tone ("For ny") må ikke
// se ud som en grøn.
describe("StateChip", () => {
  it("viser altid ordet, uanset tone", () => {
    for (const [label, tone] of [["Sund", "green"], ["Bæres af én", "gold"], ["Død", "red"], ["For ny", null]]) {
      expect(renderToStaticMarkup(<StateChip label={label} tone={tone} />)).toContain(label);
    }
  });

  it("en tilstand uden tone får ikke samme farve som en sund liga", () => {
    const ukendt = renderToStaticMarkup(<StateChip label="For ny" tone={null} />);
    const sund = renderToStaticMarkup(<StateChip label="Sund" tone="green" />);
    const farve = (html) => (html.match(/color:([^;"]+)/) || [])[1];
    expect(farve(ukendt)).not.toBe(farve(sund));
  });
});

// SignalRow bærer liga-diagnosens enkeltsignaler: navn, værdi og rå-tallene
// bag procenten, så en procent aldrig står alene.
describe("SignalRow", () => {
  it("viser label, værdi og detalje", () => {
    const html = renderToStaticMarkup(<SignalRow label="Bredde" value="33 %" detail="2 af 6 medlemmer tippede" />);
    expect(html).toContain("Bredde");
    expect(html).toContain("33 %");
    expect(html).toContain("2 af 6 medlemmer tippede");
  });

  it("udelader detaljen, når den ikke er sat", () => {
    const html = renderToStaticMarkup(<SignalRow label="Puls" value="100 %" />);
    expect(html).toContain("100 %");
    expect(html).not.toContain("undefined");
  });
});

// G22: appens mest brugte kontrol og dens eneste dialog.
//
// At taste et resultat ER kernehandlingen, og feltet var en bar
// `<input type="number">` uden navn — en skærmlæser sagde "redigeringsfelt,
// tal" om begge felter i en kamp uden at kunne skelne hjemme fra ude.
describe("ScoreInput (G22)", () => {
  it("bærer det navn, kaldstedet giver den", () => {
    const html = renderToStaticMarkup(
      <ScoreInput label="Dit gæt: mål til Brøndby mod FCK" value={2} onChange={() => {}} />
    );
    expect(html).toContain('aria-label="Dit gæt: mål til Brøndby mod FCK"');
  });

  it("viser et tomt felt frem for 0, når der intet er tippet", () => {
    const html = renderToStaticMarkup(<ScoreInput label="x" value={null} onChange={() => {}} />);
    expect(html).toContain('value=""');
  });
});

describe("Modal (G22)", () => {
  const render = () =>
    renderToStaticMarkup(<Modal title="Slet konkurrencen?" onClose={() => {}}>Indhold</Modal>);

  // Uden dialog-semantikken er den for en skærmlæser bare mere indhold på
  // siden — og da baggrunden ikke skjules, kunne brugeren læse videre ned i en
  // skærm, der visuelt er dækket.
  it("er en rigtig dialog med et navn", () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("aria-labelledby=");
  });

  // Navnet skal PEGE på den overskrift, der faktisk står der — ikke på et
  // id, der ikke findes.
  it("peger sit navn på den overskrift, der står i dialogen", () => {
    const html = render();
    const id = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain("Slet konkurrencen?");
  });

  it("giver luk-knappen et navn", () => {
    expect(render()).toContain('aria-label="Luk"');
  });
});
