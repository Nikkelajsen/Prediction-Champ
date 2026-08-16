// Tests for det, der TEGNES, når noget deles som billede.
//
// Et attrap-`ctx`, der optager sine kald, frem for en rigtig canvas: malerne er
// rene mod deres kontekst, og det, der er værd at binde fast, er ikke pixels,
// men BESLUTNINGERNE — hvilke rækker kom med, hvem blev fremhævet, og siger
// tekst-faldbacken det samme som billedet.
//
// Præcis dét sidste er testens hovedærinde. `shareImage()` vælger vej efter,
// om browseren kan dele filer, og på iOS Safari kan den nogle gange ikke. To
// udgaver af den samme stilling, alt efter hvilken vej delingen tog, ville være
// en forskel, ingen kan se i koden — og som kun én af to brugere ville opleve.
import { describe, it, expect } from "vitest";
import {
  drawStandings, drawStoryCard, standingsHeight, standingsShareText,
  afkortStilling, MAX_RÆKKER,
} from "./shareCanvas.js";

// Optager alt, der tegnes. `fillText` er det eneste, påstandene læser; resten
// findes, for at malerne ikke falder over en manglende metode.
function fakeCtx() {
  const tekster = [];
  return {
    tekster,
    fillStyle: "", font: "", textAlign: "left",
    fillRect: () => {},
    fillText: (t, x, y) => tekster.push({ t: String(t), x, y }),
  };
}

const felt = (n) =>
  Array.from({ length: n }, (_, i) => ({ rank: i + 1, player: `Spiller${i + 1}`, total: 100 - i }));

describe("afkortStilling", () => {
  it("lader et lille felt stå helt", () => {
    const { rows } = afkortStilling(felt(4), 2);
    expect(rows.map((r) => r.player)).toEqual(["Spiller1", "Spiller2", "Spiller3", "Spiller4"]);
  });

  it("klipper til top-10, når modtageren allerede er med", () => {
    const { rows, meIndex } = afkortStilling(felt(20), 3);
    expect(rows).toHaveLength(MAX_RÆKKER);
    expect(meIndex).toBe(3);
    expect(rows.some((r) => r.ellipsis)).toBe(false);
  });

  // Den, der deler, skal kunne se sig selv i billedet — også som nr. 17.
  it("hænger modtagerens egen række på efter en skillerække", () => {
    const { rows, meIndex } = afkortStilling(felt(20), 16);
    expect(rows).toHaveLength(MAX_RÆKKER + 2);
    expect(rows[MAX_RÆKKER].ellipsis).toBe(true);
    expect(rows[meIndex].player).toBe("Spiller17");
  });

  it("klipper uden skillerække, når der ingen modtager er", () => {
    const { rows } = afkortStilling(felt(20), null);
    expect(rows).toHaveLength(MAX_RÆKKER);
  });
});

describe("standingsHeight", () => {
  const h = (n, title = "K") => standingsHeight({ title, rows: felt(n), meIndex: 0 });

  it("vokser med rækkeantallet, så en lille liga ikke får et halvtomt billede", () => {
    expect(h(4)).toBeLessThan(h(9));
  });

  it("stopper med at vokse, når feltet er klippet", () => {
    expect(h(40)).toBe(h(10));
  });

  // Højden SKAL følge titlens ombrydning. Gjorde den ikke det, ville en
  // to-linjers titel enten skubbe sidste række ud af billedet eller tvinge
  // titlen tilbage på én linje — og det sidste er, hvad den første udgave gjorde.
  it("giver plads til en titel, der fylder to linjer", () => {
    expect(h(6, "Kontorets meget lange Premier League")).toBeGreaterThan(h(6, "Kontoret"));
  });
});

describe("drawStandings", () => {
  it("tegner hver række i det lille felt", () => {
    const ctx = fakeCtx();
    drawStandings({ title: "Kontoret", subtitle: "8/20 spillet", rows: felt(4), meIndex: 1 }, ctx, 1080, 900);
    const t = ctx.tekster.map((x) => x.t);
    for (const navn of ["Spiller1", "Spiller2", "Spiller3", "Spiller4"]) expect(t).toContain(navn);
    expect(t).toContain("Kontoret");
    expect(t).toContain("8/20 SPILLET");
    expect(t).toContain("Leagly");
  });

  // Konkurrencens NAVN er dét, billedet skal fortælle. Første udgave tog kun
  // `ombryd(title, 22)[0]` og gjorde "Kontorets Premier League" til "Kontorets
  // Premier" — tavst, og i det ene felt hvor en forkortelse gør mest skade.
  it("klipper ikke konkurrencens navn væk, men bryder det", () => {
    const ctx = fakeCtx();
    const rows = felt(3);
    drawStandings({ title: "Kontorets Premier League", subtitle: "Afsluttet", rows, meIndex: 0 },
      ctx, 1080, standingsHeight({ title: "Kontorets Premier League", rows, meIndex: 0 }));
    expect(ctx.tekster.map((x) => x.t).join(" ")).toContain("League");
  });

  // Et navn, der er for langt til sin kolonne, får et "…". Uden det ligner det
  // et andet, kortere navn.
  it("markerer et afkortet spillernavn", () => {
    const ctx = fakeCtx();
    const rows = [{ rank: 1, player: "Bartholomeus Jespersen-Holm", total: 12 }];
    drawStandings({ title: "K", subtitle: "Afsluttet", rows, meIndex: 0 }, ctx, 1080, 700);
    expect(ctx.tekster.some((x) => x.t.endsWith("…") && x.t.startsWith("Bartholomeus"))).toBe(true);
  });

  // Kun #, navn og point. Rating, 🎯 og Form kræver hver deres forklaring, og
  // den står i tabellens fodnote — den kan ikke rejse med et billede.
  it("tager ikke rating, præcise eller form med", () => {
    const ctx = fakeCtx();
    const rows = [{ rank: 1, player: "Anna", total: 42, rating: 1550, exactCount: 7, form3: 12 }];
    drawStandings({ title: "K", subtitle: "Afsluttet", rows, meIndex: 0 }, ctx, 1080, 700);
    const t = ctx.tekster.map((x) => x.t);
    expect(t).toContain("42");
    expect(t).not.toContain("1550");
    expect(t).not.toContain("7");
    expect(t).not.toContain("12");
  });

  it("tegner skillerækken, når feltet er klippet", () => {
    const ctx = fakeCtx();
    drawStandings({ title: "K", subtitle: "Afsluttet", rows: felt(20), meIndex: 16 }, ctx, 1080, 1200);
    const t = ctx.tekster.map((x) => x.t);
    expect(t).toContain("…");
    expect(t).toContain("Spiller17");
    expect(t).not.toContain("Spiller12");
  });
});

describe("standingsShareText", () => {
  it("siger det samme som billedet, række for række", () => {
    const view = { title: "Kontoret", subtitle: "Afsluttet", rows: felt(3), meIndex: 0 };
    expect(standingsShareText(view)).toBe(
      "Kontoret · Afsluttet\n1. Spiller1 — 100\n2. Spiller2 — 99\n3. Spiller3 — 98\nLeagly"
    );
  });

  // Samme afkortning som billedet — ellers ville de to veje gennem shareImage()
  // vise hver sin stilling.
  it("bruger samme afkortning som billedet", () => {
    const view = { title: "K", subtitle: "Afsluttet", rows: felt(20), meIndex: 16 };
    const linjer = standingsShareText(view).split("\n");
    expect(linjer).toContain("…");
    expect(linjer).toContain("17. Spiller17 — 84");
    expect(linjer).not.toContain("12. Spiller12 — 89");
  });
});

describe("drawStoryCard", () => {
  it("tegner øjenbryn, overskrift og brødtekst", () => {
    const ctx = fakeCtx();
    drawStoryCard({ eyebrow: "Kampdag 15/8", headline: "Du vandt runden", body: "Tre point foran." }, ctx, 1080, 1080);
    const t = ctx.tekster.map((x) => x.t);
    expect(t).toContain("KAMPDAG 15/8");
    expect(t).toContain("Du vandt runden");
    expect(t).toContain("Tre point foran.");
    expect(t).toContain("Leagly");
  });

  // Den gamle ombrydning tegnede en TOM linje, hvis første ord i sig selv var
  // længere end grænsen. Rettelsen fulgte med flytningen ud af RoundStory.
  it("laver ikke en tom linje af et meget langt ord", () => {
    const ctx = fakeCtx();
    drawStoryCard({ eyebrow: "E", headline: "Rekordforestillingen kom", body: "B" }, ctx, 1080, 1080);
    expect(ctx.tekster.some((x) => x.t === "")).toBe(false);
  });

  // Brødteksten var `slice(0, 46)` og klippede MIDT I ET ORD uden at sige det.
  // Usynligt for rundestoryens korte frame-tekster, synligt med det samme på et
  // dagskort, hvis brødtekst er en hel sætning.
  it("bryder en lang brødtekst frem for at klippe midt i et ord", () => {
    const ctx = fakeCtx();
    const body = "I Kontorets Premier League havde 4 andre tippet imod. Det endte 1-1.";
    drawStoryCard({ eyebrow: "E", headline: "Kort", body }, ctx, 1080, 1080);
    const t = ctx.tekster.map((x) => x.t);
    expect(t).not.toContain("I Kontorets Premier League havde 4 andre tippe");
    expect(t.join(" ")).toContain("tippet imod.");
  });

  // Brødteksten skal ligge under SIDSTE overskriftslinje — ikke der, hvor
  // ombryd-løkken tilfældigvis efterlod skrivehovedet.
  it("rykker brødteksten ned, når overskriften fylder to linjer", () => {
    const en = fakeCtx();
    drawStoryCard({ eyebrow: "E", headline: "Kort", body: "BODY" }, en, 1080, 1080);
    const to = fakeCtx();
    drawStoryCard({ eyebrow: "E", headline: "En noget længere overskrift der brydes", body: "BODY" }, to, 1080, 1080);
    const y = (ctx) => ctx.tekster.find((x) => x.t === "BODY").y;
    expect(y(to)).toBeGreaterThan(y(en));
  });
});
