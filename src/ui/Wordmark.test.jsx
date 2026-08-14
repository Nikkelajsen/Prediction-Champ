import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Wordmark, TrophyMark } from "./Wordmark.jsx";
import { C } from "./theme.js";

// Mærket findes ét sted og bruges tre (header, login, onboarding). Det er
// præcis den slags, der glider fra hinanden igen: en farve rettes i headeren,
// og login står tilbage med den gamle.
describe("Wordmark", () => {
  const html = renderToStaticMarkup(<Wordmark />);

  it("skriver navnet ud", () => {
    expect(html.replace(/<[^>]*>/g, "")).toBe("LeaglyBeta");
  });

  // A56 (14. august 2026): mærkatet står på sitets fem sider og skal stå i
  // appen, så længe det står dér. Testen måler, at det følger MÆRKET og ikke
  // det enkelte kaldested — ellers ville "appen siger beta" igen afhænge af, om
  // den, der tilføjede en ny skærm, huskede det.
  it("bærer beta-mærkatet ved siden af navnet", () => {
    expect(html).toContain("Beta");
    expect(renderToStaticMarkup(<Wordmark size={20} />)).toContain("Beta");
  });

  // Størrelsen er bevidst uafhængig af `size`: headeren (20) og login (16) skal
  // vise det samme mærkat. Skrider det, vokser mærkatet ind i headerens
  // talte plads.
  it("skalerer ikke mærkatet med mærket", () => {
    const lille = renderToStaticMarkup(<Wordmark size={15} />);
    const stor = renderToStaticMarkup(<Wordmark size={20} />);
    const mærkat = (h) => h.slice(h.lastIndexOf("<span", h.indexOf(">Beta<")));
    expect(mærkat(stor)).toBe(mærkat(lille));
  });

  it("er tofarvet som logofilen — 'Leag' i guld, 'ly' i tekstfarven", () => {
    expect(html).toMatch(/color:#F2C14E[^>]*>Leag</);
    expect(html).toContain("ly</span>");
  });

  it("nævner ikke det gamle navn", () => {
    expect(html).not.toContain("Prediction");
    expect(html).not.toContain("Champ");
  });
});

// Pokalen er tegnet efter public/leagly-icon-512.png. To ting må ikke skride:
// farven (skal komme fra tokenet, ikke stå hardkodet i pathen) og "L"-hullet,
// som er evenodd og ikke en form malet i baggrundsfarven — males det, holder
// det kun på præcis den baggrund, mærket tilfældigvis står på i dag.
describe("TrophyMark", () => {
  const svg = renderToStaticMarkup(<TrophyMark />);

  it("henter guldet fra designtokenet", () => {
    expect(svg).toContain(C.gold);
    expect(svg).not.toMatch(/#F0B429/i);
  });

  it("skærer L'et ud frem for at male det i baggrundsfarven", () => {
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).not.toContain(C.bg);
  });

  it("er skjult for skærmlæsere, når den ikke har en titel", () => {
    expect(svg).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<TrophyMark title="Leagly" />)).toContain('aria-label="Leagly"');
  });

  it("spejler hankene om midteraksen, så de ikke kan komme ud af trit", () => {
    // De to hanke er tegnet i hånden i ikonfilens 512-rum. Spejlingen om
    // x = 255,5 (altså 511 − x) er det eneste, der binder dem sammen, så den
    // testes frem for at blive husket.
    const hanke = [...svg.matchAll(/stroke-linecap="round" d="([^"]+)"/g)].map((m) => m[1]);
    expect(hanke).toHaveLength(2);
    const tal = (d) => d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const [venstre, højre] = hanke.map(tal);
    expect(højre).toHaveLength(venstre.length);
    // Lige indeks er x, ulige er y: x spejles, y skal være identisk.
    expect(højre.map((n, i) => (i % 2 === 0 ? 511 - n : n))).toEqual(venstre);
  });
});
