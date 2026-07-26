import { describe, it, expect } from "vitest";
// renderToStaticMarkup frem for jsdom — samme greb som components.test.jsx:
// begge komponenter er ren markup, og projektet skal ikke have et komponent-
// testbibliotek for deres skyld.
import { renderToStaticMarkup } from "react-dom/server";
import { StandingsTable, Champions } from "./ChampionshipTab.jsx";
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
