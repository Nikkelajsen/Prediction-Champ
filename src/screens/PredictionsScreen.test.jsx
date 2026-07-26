import { describe, it, expect } from "vitest";
// renderToStaticMarkup, samme mønster som components.test.jsx: rækken er markup, og
// projektet skal ikke have et komponent-testbibliotek for dens skyld. Bredden kan den
// ikke måle — den måles i en rigtig browser, jf. beslutningsloggen — men den fastholder
// rækkens KONTRAKT: hvad der står i rækken, og hvad der ikke længere gør.
import { renderToStaticMarkup } from "react-dom/server";
import { MatchRow } from "./PredictionsScreen.jsx";

const RULES = { exact: 3, outcome: 1 };
const PARTS = [{ id: "u1", display_name: "Nikolaj" }, { id: "u2", display_name: "Jimmy" }];

function row(over = {}) {
  const props = {
    m: { id: 1, kickoff_at: "2026-07-24T17:00:00Z", home_score: null, away_score: null },
    pred: { pred_home: 1, pred_away: 1 },
    rules: RULES,
    homeName: "Viborg FF",
    awayName: "Odense BK",
    locked: true, played: false, live: null,
    notOpenUntil: null, openLabel: null, countdown: null, showFinal: true,
    saved: false, err: false, onSave: () => {},
    expanded: false, onToggleExpanded: () => {},
    participants: PARTS, matchPreds: [], userId: "u1", last: false,
    ...over,
  };
  return renderToStaticMarkup(<MatchRow {...props} />);
}

describe("MatchRow — låst række", () => {
  it("er en rigtig knap, så HELE rækken åbner alles gæt", () => {
    const html = row();
    expect(html).toContain("<button");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Vis alles gæt for Viborg FF mod Odense BK"');
  });

  it("har ikke længere en «Alles gæt»-tekstknap på egen linje", () => {
    expect(row()).not.toContain("Alles gæt<");
  });

  it("er ikke en knap, når man er alene i konkurrencen", () => {
    expect(row({ participants: [PARTS[0]] })).not.toContain("<button");
  });

  it("viser eget gæt, facit og point på færdigspillet kamp", () => {
    const html = row({ played: true, m: { id: 1, kickoff_at: "2026-07-24T17:00:00Z", home_score: 1, away_score: 0 } });
    expect(html).toContain("1-1");   // gæt
    expect(html).toContain("1-0");   // facit
    expect(html).toContain("Slut");  // tilstanden bor i tid-kolonnen
  });

  it("viser live-stilling og spilleminut uden point", () => {
    const html = row({ live: { homeScore: 0, awayScore: 1, label: "34′" } });
    expect(html).toContain("34′");
    expect(html).toContain("0-1");
    expect(html).not.toContain("+3");
  });

  it("viser «–» i gæt-kolonnen, når kampen ikke blev tippet", () => {
    expect(row({ pred: { pred_home: null, pred_away: null } })).toContain("–");
  });

  it("skjuler «Slut», når hele runden er spillet (showFinal=false)", () => {
    const html = row({ played: true, showFinal: false, m: { id: 1, kickoff_at: "2026-07-24T17:00:00Z", home_score: 1, away_score: 0 } });
    expect(html).not.toContain("Slut");
  });
});

describe("MatchRow — åben runde", () => {
  it("viser indtastningsfelter og hverken knap eller chevron", () => {
    const html = row({ locked: false });
    expect(html).toContain("<input");
    expect(html).not.toContain("aria-expanded");
  });
});
