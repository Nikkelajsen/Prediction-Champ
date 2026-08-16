import { describe, it, expect, vi } from "vitest";
// renderToStaticMarkup frem for jsdom: projektet har bevidst intet
// komponent-testbibliotek (jf. OpsPanel.test.jsx og FeedbackPanel.test.jsx).
//
// `useSection` er hooket, der henter — og en effekt kører ikke under
// server-rendering, så sektionen ville stå på "Henter …" for evigt. Kun DEN ene
// eksport erstattes (resten kommer fra `importOriginal`), så testen måler den
// rigtige Section-ramme, den rigtige ⓘ og den rigtige tabel.
const svar = {
  rounds_window: 12,
  rounds_available: 9,
  activity_since: "2026-07-28",
  rounds: [
    { round_key: "2026-07-21", players: 4, exposed: 6, missed: 2, play_rate: 66.7, new_players: 4, tips: 12, visitors: null, match_count: 5, locked_count: 5, is_open: false },
    { round_key: "2026-07-28", players: 6, exposed: 7, missed: 1, play_rate: 85.7, new_players: 2, tips: 20, visitors: 9, match_count: 5, locked_count: 5, is_open: false },
    { round_key: "2026-08-04", players: 1, exposed: 8, missed: 7, play_rate: 12.5, new_players: 0, tips: 2, visitors: 3, match_count: 6, locked_count: 2, is_open: true },
  ],
};

vi.mock("./shared.jsx", async (importOriginal) => ({
  ...(await importOriginal()),
  useSection: () => ({ data: svar, loading: false, err: "" }),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { RoundsSection } from "./RoundsSection.jsx";

const html = () => renderToStaticMarkup(<RoundsSection token="tok" />);

describe("RoundsSection", () => {
  it("viser overskriftstallet fra den seneste FÆRDIGE runde, ikke fra den i gang", () => {
    const h = html();
    // 6 er den seneste lukkede runde; 1 er den åbne og må ikke stå som facit.
    expect(h).toContain("6 af 7 med en deadline spillede");
    expect(h).toContain("Runden fra 28. jul.");
  });

  // Uden mærkatet ville den sidste række se ud som et frit fald, og det er den
  // eneste række på skærmen, hvis tal stadig kan vokse.
  it("mærker runden i gang og siger hvor langt den er", () => {
    const h = html();
    expect(h).toContain("I GANG");
    expect(h).toContain("2 af 6 kampe låst");
  });

  it("skriver – og ikke 0 for en uge, aktivitetssporingen ikke dækker", () => {
    const h = html();
    expect(h).toContain("Aktivitetssporingen dækker ikke denne uge");
    expect(h).toContain("Besøgstal findes først fra 28. jul. 2026");
  });

  it("fortæller, at der findes flere runder end de viste", () => {
    expect(html()).toContain("9 spillede runder i alt");
  });

  // Besøgstallet læses af den seneste LUKKEDE runde (9), ikke af den åbne (3),
  // af samme grund som spiller-tallet: en uge, der ikke er forbi, er delvis.
  it("viser besøgstallet fra den seneste færdige runde", () => {
    expect(html()).toContain("Kom forbi, seneste færdige runde");
  });

  // Feltet "Kiggede uden at spille" fandtes indtil 16. august 2026. Det hvilede
  // på, at alle spillere også er besøgende, og det holder ikke — se
  // RoundsSection.jsx' hoved. Skærmen må hverken vise differencen eller
  // beskrive den, og fodnoten skal sige, HVORFOR de to ikke kan trækkes fra
  // hinanden. Uden denne vagt ville rammen kunne snige sig ind igen.
  it("viser hverken et gab eller en sætning, der inviterer til at regne et", () => {
    const h = html();
    expect(h).not.toContain("Kiggede uden at spille");
    expect(h).not.toContain("kiggede uden at spille");
    expect(h).toContain("skal IKKE trækkes fra hinanden");
    expect(h).toContain("tips kan gives i forvejen");
  });

  // Fixturen har tre runder, men kun ÉN lukket med målte besøg: den første er
  // umålt (visitors: null) og den sidste er i gang. Gennemsnittet skal derfor
  // være 9 over én runde — ikke 6 (som et null talt som nul ville give) og ikke
  // 6 (som den åbne runde ville trække det ned til).
  it("regner besøgs-gennemsnittet på de målte, lukkede runder og siger hvor mange det er", () => {
    expect(html()).toContain("gennemsnit 9 over 1 færdig runde med målte besøg");
  });

  it("tegner en søjlerække for besøg, hvor den umålte uge er 'ingen data'", () => {
    const h = html();
    expect(h).toContain("Kom forbi (var i appen)");
    expect(h).toContain("21. jul.: ingen data");
  });

  // "Kom forbi" kan være det LAVESTE tal i tabellen, og uden en forklaring
  // ligner det en fejl i visningen frem for to mål over hver sin periode.
  it("forklarer, at 'kom forbi' godt kan være lavere end 'spillede'", () => {
    expect(html()).toContain("kan udmærket være det laveste");
  });

  // Søjlen for runden i gang er stiplet og halvt gennemsigtig, og dens
  // værktøjstip siger hvorfor. Uden det ville den sidste søjle i serien se ud
  // som et fald frem for som en periode, der ikke er forbi.
  it("tegner runden i gang som en stiplet søjle med sin egen forklaring", () => {
    const h = html();
    expect(h).toContain("(i gang — tallet kan stadig vokse)");
    expect(h).toContain("border:1px dashed");
    expect(h).toContain("opacity:0.45");
  });
});
