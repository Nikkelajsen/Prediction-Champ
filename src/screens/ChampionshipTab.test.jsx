import { describe, it, expect } from "vitest";
// renderToStaticMarkup frem for jsdom — samme greb som components.test.jsx:
// begge komponenter er ren markup, og projektet skal ikke have et komponent-
// testbibliotek for deres skyld.
import { renderToStaticMarkup } from "react-dom/server";
// Importerne peger på de udskilte moduler efter fil-opdelingen (G1, 3. august
// 2026). Skærmen selv eksporterer dem ikke længere — testen skal ramme dér,
// hvor koden bor, ikke gennem en gennemgangsluge, der kan blive stående som
// den eneste bruger.
import { StandingsTable, Champions, FullStandingsModal, pageOfUser } from "./championship/StandingsTable.jsx";
import { CardHead } from "./championship/CardHead.jsx";
import { pickSeasonLeague, boardTitle, scopeNote } from "./championship/scope.js";
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
    expect(text(<Champions rows={solo} title="Månedens Champion" isComplete />))
      .toContain("Anna er Månedens Champion");
  });

  it("nævner begge og siger 'delt', når titlen deles", () => {
    expect(text(<Champions rows={tied} title="Månedens Champion" isComplete />))
      .toContain("Anna og Bo er delt Månedens Champion");
  });

  it("sætter tre navne sammen på dansk", () => {
    expect(text(<Champions rows={three} title="Månedens Champion" isComplete />))
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

// Overskriftsrækken bar filtrene ud over kortets højre kant på telefonen, da
// turneringsvælgeren kom til: rækken brød ikke, og en <select> er så bred som
// sin bredeste option. Testen pinner de to egenskaber, der bærer rettelsen —
// rækken må bryde, og filtrene må krympe — så de ikke kan forsvinde i en
// senere oprydning af inline-styles uden at nogen opdager det.
describe("CardHead (titel + filtre på en 430 px skærm)", () => {
  const head = (children, info) => renderToStaticMarkup(
    <CardHead title="Rundens Champion" info={info}>{children}</CardHead>,
  );

  it("lader rækken bryde, så filtrene falder ned under titlen frem for ud over kanten", () => {
    expect(head(<select />)).toMatch(/flex-wrap:wrap/);
  });

  it("lader både titel og filter-gruppe krympe — ellers skubber indholdet rækken bredere", () => {
    expect([...head(<select />).matchAll(/min-width:0/g)]).toHaveLength(2);
  });

  it("holder filtrene i højre side, også når de står på deres egen linje", () => {
    expect(head(<select />)).toMatch(/margin-left:auto/);
  });

  it("renderer ingen filter-gruppe, når kortet ikke har filtre", () => {
    expect(head(false)).not.toMatch(/margin-left:auto/);
  });

  it("skriver titlen ud, som den er", () => {
    expect(head(false).replace(/<[^>]*>/g, "")).toContain("Rundens Champion");
  });

  // ⓘ'en må aldrig kunne brydes ned på en linje for sig selv: den er en fodnote
  // til titlen, og alene på en linje ligner den en knap uden tekst.
  it("binder ⓘ sammen med titlens sidste ord", () => {
    expect(head(false, <b>i</b>)).toMatch(/<span style="white-space:nowrap">Champion <b>i<\/b><\/span>/);
  });

  it("klarer en titel på ét ord", () => {
    const html = renderToStaticMarkup(<CardHead title="Championship" info={<b>i</b>} />);
    expect(html).toMatch(/<span style="white-space:nowrap">Championship <b>i<\/b><\/span>/);
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
// "Champion". Reglen skal kunne læses ét sted og testes for sig, fordi
// den optræder fire steder i fanen (overskrift, InfoDot-titel, kåring, modal).
describe("boardTitle (samlet vs. pr. turnering)", () => {
  const superliga = { id: "L1", name: "Superligaen" };

  it("giver den store titel, når ingen turnering er valgt", () => {
    expect(boardTitle("round", null)).toBe("Rundens Champion");
    expect(boardTitle("month", null)).toBe("Månedens Champion");
  });

  it("bruger 'bedste i', så en turneringsstilling ikke låner titlen", () => {
    expect(boardTitle("round", superliga)).toBe("Rundens bedste i Superligaen");
    expect(boardTitle("month", superliga)).toBe("Månedens bedste i Superligaen");
  });

  it("nævner aldrig 'Champion' på et turneringsniveau", () => {
    expect(boardTitle("round", superliga)).not.toContain("Champion");
    expect(boardTitle("month", superliga)).not.toContain("Champion");
  });

  // Sæsonen er undtagelsen (turnering-2 §3.6): den ér turneringsbunden, så den
  // beholder den store titel, uanset om en turnering er valgt.
  it("giver sæsonen den store titel, også med en valgt turnering", () => {
    expect(boardTitle("season")).toBe("Sæsonens Champion");
    expect(boardTitle("season", superliga)).toBe("Sæsonens Champion");
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
    expect(note).toContain("tæller hverken");
  });

  it("siger, hvor pointene så BLIVER af — ellers ligner udeladelsen et tab", () => {
    expect(scopeNote([superliga], [skotland])).toContain("din konkurrence");
  });

  // A17 (31. juli 2026): ratingen filtrerer nu også på is_official. Sagde
  // sætningen fortsat "og i din rating", ville den love point et sted, hvor de
  // ikke længere lander — den værste slags forkert tekst.
  it("lover ikke rating for en turnering, der ikke tæller", () => {
    const note = scopeNote([superliga], [skotland]);
    expect(note).toContain("hverken i Championship eller i rating");
    expect(note).not.toMatch(/og i din rating/);
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

// Modalen er den eneste vej til sin egen række, når man ikke er i top 5 — og
// den startede altid på side 1, så en spiller som nr. 25 skulle bladre sig frem
// i blinde. Testene her holder på tre ting: startsiden er ens egen, den regnes
// af INDEKSET og ikke af placeringen, og de to genveje findes kun, når der er
// noget at genveje til.
const langStilling = () => board(Array.from({ length: 45 }, (_, i) =>
  row(`u${i + 1}`, `Spiller-${String(i + 1).padStart(2, "0")}`, { total: 100 - i })));

describe("pageOfUser (hvilken side står man selv på)", () => {
  const rows = langStilling();

  it("holder de tyve første på side 0 og lægger den enogtyvende på side 1", () => {
    expect(pageOfUser(rows, "u1")).toBe(0);
    expect(pageOfUser(rows, "u20")).toBe(0);
    expect(pageOfUser(rows, "u21")).toBe(1);
  });

  it("lander nr. 25 på side 2 — altså indeks 24 og side 1 nulindekseret", () => {
    expect(pageOfUser(rows, "u25")).toBe(1);
  });

  it("giver null — og ikke 0 — for en bruger uden en række i stillingen", () => {
    expect(pageOfUser(rows, "ukendt")).toBeNull();
    expect(pageOfUser([], "u1")).toBeNull();
  });

  // Kernen i valget: `rank` og indeks er ikke det samme tal. To spillere deler
  // her placering 20 hen over sidegrænsen, så den anden af dem har rank 20 men
  // indeks 20 — regnet på placeringen ville hun blive sendt til side 1, hvor
  // hendes egen række ikke står.
  it("regner på indekset og ikke på placeringen, når en delt placering krydser sidegrænsen", () => {
    const delt = board(Array.from({ length: 25 }, (_, i) =>
      row(`v${String(i + 1).padStart(2, "0")}`, `Lige-${i + 1}`, { total: i === 20 ? 100 - 19 : 100 - i })));
    expect(delt[20].userId).toBe("v21");
    expect(delt[20].rank).toBe(20); // placeringen ville pege på side 0
    expect(pageOfUser(delt, "v21")).toBe(1); // indekset peger på den rigtige
  });
});

describe("FullStandingsModal (åbner, hvor du selv står)", () => {
  const knap = (html, label) =>
    html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? null;
  const modal = (rows, userId) => renderToStaticMarkup(
    <FullStandingsModal title="Månedschampionship" rows={rows} userId={userId}
      isComplete={false} onClose={() => {}} />,
  );

  it("åbner på brugerens egen side og viser hendes række", () => {
    const html = modal(langStilling(), "u25");
    expect(html).toContain("Side 2 af 3");
    expect(html).toContain("Spiller-25");
    expect(html).not.toContain("Spiller-01");
  });

  it("åbner på side 1, når brugeren ikke står i stillingen", () => {
    const html = modal(langStilling(), "ukendt");
    expect(html).toContain("Side 1 af 3");
    expect(html).toContain("Spiller-01");
  });

  it("tilbyder vejen til toppen, men ikke tilbage til en selv, når man allerede er der", () => {
    const html = modal(langStilling(), "u25");
    expect(knap(html, "Gå til top 20")).not.toMatch(/disabled/);
    expect(knap(html, "Gå til din egen placering")).toMatch(/disabled/);
  });

  it("deaktiverer top-genvejen på side 1 frem for at fjerne den", () => {
    const html = modal(langStilling(), "u5");
    expect(knap(html, "Gå til top 20")).toMatch(/disabled/);
  });

  // En knap, der aldrig kan gøre noget, er ikke en deaktiveret knap — den er
  // støj. Står man ikke i stillingen, er der ingen egen placering at hoppe til.
  it("udelader 'Min placering' helt for en bruger uden en række", () => {
    expect(knap(modal(langStilling(), "ukendt"), "Gå til din egen placering")).toBeNull();
  });

  it("viser ingen af delene, når hele stillingen er på én side", () => {
    const kort = board(Array.from({ length: 12 }, (_, i) =>
      row(`k${i + 1}`, `Kort-${i + 1}`, { total: 50 - i })));
    const html = modal(kort, "k9");
    expect(knap(html, "Gå til top 20")).toBeNull();
    expect(knap(html, "Gå til din egen placering")).toBeNull();
    expect(html).not.toContain("Side 1 af 1");
  });
});
