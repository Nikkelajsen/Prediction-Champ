import { describe, it, expect } from "vitest";
// renderToStaticMarkup frem for jsdom — samme greb som components.test.jsx:
// begge komponenter er ren markup, og projektet skal ikke have et komponent-
// testbibliotek for deres skyld.
import { renderToStaticMarkup } from "react-dom/server";
import { StandingsTable, Champions, pickSeasonLeague, boardTitle, scopeNote } from "./ChampionshipTab.jsx";
import { assignRanks, sortStandings } from "../lib/standings.js";

// Basisrække: alle trin i stigen lige, så testene kun ændrer ét ad gangen.
const row = (userId, player, over = {}) => ({
  userId, player, total: 10, exactCount: 2, outcomeCount: 4, roundWins: 1, avgGoalError: 1.5, matches: 20, ...over,
});
const board = (rows) => assignRanks(sortStandings(rows));

// Kun cellerne i #-kolonnen (første <td> i hver række).
const rankCells = (html) => [...html.matchAll(/<tr[^>]*><td[^>]*>(.*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]*>/g, ""));

describe("StandingsTable (placering, ikke listeindeks)", () => {
  it("viser delt placering, og næste spiller springer et nummer over", () => {
    const html = renderToStaticMarkup(<StandingsTable rows={board([
      row("u1", "Anna"), row("u2", "Bo"), row("u3", "Carl", { total: 5 }),
    ])} userId="u1" isComplete={false} />);
    expect(rankCells(html)).toEqual(["1", "1", "3"]);
  });

  it("giver pokalen til ALLE på 1. pladsen, når stillingen er afsluttet", () => {
    const html = renderToStaticMarkup(<StandingsTable rows={board([
      row("u1", "Anna"), row("u2", "Bo"), row("u3", "Carl", { total: 5 }),
    ])} userId="u1" isComplete />);
    expect(rankCells(html)).toEqual(["🏆", "🏆", "3"]);
  });

  it("nummererer normalt uden lighed", () => {
    const html = renderToStaticMarkup(<StandingsTable rows={board([
      row("u1", "Anna", { total: 12 }), row("u2", "Bo", { total: 8 }), row("u3", "Carl", { total: 5 }),
    ])} userId="u1" isComplete={false} />);
    expect(rankCells(html)).toEqual(["1", "2", "3"]);
  });
});

describe("Champions (kåringen)", () => {
  const solo = board([row("u1", "Anna", { total: 12 }), row("u2", "Bo")]);
  const tied = board([row("u1", "Anna"), row("u2", "Bo")]);
  const three = board([row("u1", "Anna"), row("u2", "Bo"), row("u3", "Carl")]);
  const text = (el) => renderToStaticMarkup(el).replace(/<[^>]*>/g, "");

  it("nævner én vinder, når titlen ikke deles", () => {
    expect(text(<Champions rows={solo} title="Månedens Prediction Champ" isComplete />))
      .toContain("Anna er Månedens Prediction Champ");
  });

  it("nævner begge og siger 'delt', når titlen deles", () => {
    expect(text(<Champions rows={tied} title="Månedens Prediction Champ" isComplete />))
      .toContain("Anna og Bo er delt Månedens Prediction Champ");
  });

  it("sætter tre navne sammen på dansk", () => {
    expect(text(<Champions rows={three} title="Månedens Prediction Champ" isComplete />))
      .toContain("Anna, Bo og Carl er delt");
  });

  it("siger 'fører lige nu' før stillingen er afgjort — og 'deler føringen' ved lighed", () => {
    expect(text(<Champions rows={solo} title="X" isComplete={false} />)).toContain("Anna fører lige nu");
    expect(text(<Champions rows={tied} title="X" isComplete={false} />)).toContain("deler føringen lige nu");
  });

  it("renderer intet uden rækker", () => {
    expect(renderToStaticMarkup(<Champions rows={[]} title="X" isComplete />)).toBe("");
  });
});

// Forvalget på sæsonkortet. Erstattede /superliga/i-regexet, da turnering #2
// (Scotland Premiership) kom til — og skal netop IKKE lade alfabetet bestemme.
describe("pickSeasonLeague (hvilken turnering vises)", () => {
  const superliga = { id: "L1", name: "Superligaen", created_at: "2026-01-01T00:00:00Z" };
  const skotland = { id: "L2", name: "Scotland Premiership", created_at: "2026-07-31T00:00:00Z" };

  it("vælger den ældste turnering, ikke den første i alfabetet", () => {
    expect(pickSeasonLeague([skotland, superliga], null).id).toBe("L1");
  });

  it("lader brugerens gemte valg vinde", () => {
    expect(pickSeasonLeague([superliga, skotland], "L2").id).toBe("L2");
  });

  it("falder tilbage til forvalget, når det gemte id ikke findes længere", () => {
    expect(pickSeasonLeague([superliga, skotland], "slettet").id).toBe("L1");
  });

  it("giver null uden turneringer", () => {
    expect(pickSeasonLeague([], null)).toBeNull();
    expect(pickSeasonLeague(undefined, "L1")).toBeNull();
  });

  it("vælger stadig noget, når created_at mangler", () => {
    expect(pickSeasonLeague([{ id: "L9", name: "Uden dato" }], null).id).toBe("L9");
  });
});

// Navnet bærer forskellen mellem de to niveauer: kun den SAMLEDE stilling hedder
// "Prediction Champ". Reglen skal kunne læses ét sted og testes for sig, fordi
// den optræder fire steder i fanen (overskrift, InfoDot-titel, kåring, modal).
describe("boardTitle (samlet vs. pr. turnering)", () => {
  const superliga = { id: "L1", name: "Superligaen" };

  it("giver den store titel, når ingen turnering er valgt", () => {
    expect(boardTitle("round", null)).toBe("Rundens Prediction Champ");
    expect(boardTitle("month", null)).toBe("Månedens Prediction Champ");
  });

  it("bruger 'bedste i', så en turneringsstilling ikke låner titlen", () => {
    expect(boardTitle("round", superliga)).toBe("Rundens bedste i Superligaen");
    expect(boardTitle("month", superliga)).toBe("Månedens bedste i Superligaen");
  });

  it("nævner aldrig 'Prediction Champ' på et turneringsniveau", () => {
    expect(boardTitle("month", superliga)).not.toContain("Prediction Champ");
  });
});

// En synlig turnering, der ikke afgør titler, blev udeladt af stillingerne uden
// at blive nævnt: både vælgeren og "To niveauer"-forklaringen er gated på mere
// end én OFFICIEL turnering, så med én af hver viste fanen ingen af delene.
// Sætningen skal navngive begge sider — hvad der tæller, og hvad der ikke gør.
describe("scopeNote (hvad tæller med i Championship)", () => {
  const superliga = { id: "L1", name: "Superligaen" };
  const skotland = { id: "L2", name: "Scotland Premiership" };
  const brøndby = { id: "L3", name: "1. division" };

  it("tier, når alle synlige turneringer afgør titler", () => {
    expect(scopeNote([superliga], [])).toBeNull();
  });

  it("navngiver både den, der tæller, og den, der ikke gør", () => {
    const note = scopeNote([superliga], [skotland]);
    expect(note).toContain("Championship afgøres af Superligaen");
    expect(note).toContain("Scotland Premiership");
    expect(note).toContain("tæller ikke med her");
  });

  it("siger, hvor pointene så BLIVER af — ellers ligner udeladelsen et tab", () => {
    const note = scopeNote([superliga], [skotland]);
    expect(note).toContain("din konkurrence");
    expect(note).toContain("din rating");
  });

  it("sætter flere navne sammen på dansk i begge ender", () => {
    const note = scopeNote([superliga, brøndby], [skotland]);
    expect(note).toContain("Superligaen og 1. division");
  });

  it("tier uden officielle turneringer — der er ingen stilling at forklare", () => {
    expect(scopeNote([], [skotland])).toBeNull();
    expect(scopeNote(undefined, undefined)).toBeNull();
  });
});
