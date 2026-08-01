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
    showFinal: true,
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

// G24: rækken er det eneste sted, et fejlet gem kan blive synligt — der er ingen
// toast og ingen anden kvittering end ✓'et. Kontrakten er derfor, at `err` bærer
// BESKEDEN (ikke bare true), at den vises, og at den fortrænger ✓'et i det faste
// slot, så en fejl aldrig kan ligne et gem.
describe("MatchRow — fejlmarkering", () => {
  it("viser den besked, der sendes med — ikke en hårdkodet", () => {
    const html = row({ locked: false, err: "Kunne ikke gemme — prøv igen" });
    expect(html).toContain("Kunne ikke gemme — prøv igen");
    expect(html).not.toContain("Kunne ikke slette");
  });

  it("viser stadig slettefejlen, når det er DEN, der sendes med", () => {
    expect(row({ locked: false, err: "Kunne ikke slette" })).toContain("Kunne ikke slette");
  });

  it("fortrænger ✓'et, så et fejlet gem ikke kan forveksles med et gemt", () => {
    const ok = row({ locked: false, saved: true });
    const failed = row({ locked: false, saved: true, err: "Kunne ikke gemme — prøv igen" });
    expect(ok).toContain('aria-label="Gemt"');
    expect(failed).toContain('aria-label="Ikke gemt"');
    expect(failed).not.toContain('aria-label="Gemt"');
  });

  it("tegner ingen fejllinje, når der ingen fejl er", () => {
    const html = row({ locked: false });
    expect(html).not.toContain("Kunne ikke");
    expect(html).not.toContain('aria-label="Ikke gemt"');
  });
});
