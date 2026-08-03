import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
// Importerne peger på de udskilte moduler efter fil-opdelingen (G1, 3. august
// 2026) — reglerne bor nu dér, og testen skal ramme koden, ikke skærmen.
import { recordFacts, rivalTally, h2hSentence } from "./profile/facts.js";
import { Sparkline } from "./profile/Sparkline.jsx";

// Rekorder-sektionen er GLOBAL (Championship + global rating), ikke en opgørelse
// pr. brugerens egne konkurrencer. Reglerne for hvad der vises, ligger i
// recordFacts, så de kan testes uden at rendere skærmen.
describe("recordFacts (hvad Rekorder-sektionen viser)", () => {
  const full = {
    best_rating: 1240, best_rating_round: "2026-05-12",
    best_round_rank: 4, best_round_rank_count: 2, best_round_rank_field: 31,
    longest_round_streak: 3,
    best_round_points: 17, best_round_exact: 4, best_round_points_round: "2026-05-19",
  };

  it("viser alle tre rekorder, når de findes", () => {
    const r = recordFacts(full, 1198);
    expect(r.hasAny).toBe(true);
    expect(r.bestRating).toBe(1240);
    expect(r.bestRatingIsCurrent).toBe(false);
    expect(r.rank).toBe(4);
    expect(r.rankField).toBe(31);
    expect(r.streak).toBe(3);
  });

  // Separatoren kommer fra toLocaleDateString("da-DK") og afhænger af ICU-buildet
  // (12/05 vs. 12.05), så testen holder på formen — dag/måned til dag/måned, en
  // uge frem — frem for på én maskines punktum.
  it("oversætter best_rating_round til en rundeetiket (feltet blev før hentet uden at blive vist)", () => {
    expect(recordFacts(full, 1198).bestRatingRound).toMatch(/^12[./]05 – 18[./]05$/);
  });

  it("udelader rundeetiketten, når round_key mangler eller ikke er en rundenøgle", () => {
    expect(recordFacts({ ...full, best_rating_round: null }, 1198).bestRatingRound).toBeNull();
    expect(recordFacts({ ...full, best_rating_round: "nonsens" }, 1198).bestRatingRound).toBeNull();
  });

  it("markerer, når højeste rating nogensinde ER den aktuelle (testcase 19)", () => {
    expect(recordFacts(full, 1240).bestRatingIsCurrent).toBe(true);
  });

  it("udelader rundeplaceringen ved rank 1 — redundant med rundesejr-badget (testcase 17)", () => {
    const r = recordFacts({ ...full, best_round_rank: 1 }, 1198);
    expect(r.rank).toBeNull();
    expect(r.rankField).toBeNull();
  });

  it("udelader stimen under 2 runder", () => {
    expect(recordFacts({ ...full, longest_round_streak: 1 }, 1198).streak).toBe(0);
  });

  // Feltstørrelsen gør rangen læsbar, men må aldrig afsløre en sidsteplads:
  // profilen viser ingen bundplaceringer (karriereprofil-v1.md §1, punkt 3).
  it("udelader feltstørrelsen, hvis den ville afsløre en sidsteplads", () => {
    const r = recordFacts({ ...full, best_round_rank: 8, best_round_rank_field: 8 }, 1198);
    expect(r.rank).toBe(8);
    expect(r.rankField).toBeNull();
  });

  it("udelader feltstørrelsen, indtil migreringen er kørt (feltet mangler i svaret)", () => {
    const { best_round_rank_field, ...old } = full;
    const r = recordFacts(old, 1198);
    expect(r.rank).toBe(4);
    expect(r.rankField).toBeNull();
  });

  it("giver tomt udfald for en helt ny bruger — sektionen udelades (testcase 18)", () => {
    const r = recordFacts({ best_rating: null, best_round_rank: null, longest_round_streak: 0 }, null);
    expect(r.hasAny).toBe(false);
    expect(recordFacts(null, null).hasAny).toBe(false);
  });

  // "Din bedste runde nogensinde" (flest point i én runde)
  it("viser bedste runde med point, præcise og rundeetiket", () => {
    const r = recordFacts(full, 1198);
    expect(r.bestRoundPoints).toBe(17);
    expect(r.bestRoundExact).toBe(4);
    expect(r.bestRoundRound).toMatch(/^19[./]05 – 25[./]05$/);
  });

  // Fundet på rigtige data: en spiller med én runde og nul point ville ellers
  // få "din bedste runde nogensinde: 0 point".
  it("udelader bedste runde ved 0 point — en rekord må ikke drille", () => {
    const r = recordFacts({ ...full, best_round_points: 0, best_round_exact: 0 }, 1198);
    expect(r.bestRoundPoints).toBeNull();
    expect(r.bestRoundRound).toBeNull();
  });

  it("udelader 'heraf N præcise', når runden ikke havde nogen præcise", () => {
    expect(recordFacts({ ...full, best_round_exact: 0 }, 1198).bestRoundExact).toBe(0);
  });

  it("tæller bedste runde med i hasAny, så sektionen vises selv uden rating/rang", () => {
    const r = recordFacts({ best_round_points: 9, best_round_exact: 1, longest_round_streak: 0 }, null);
    expect(r.hasAny).toBe(true);
  });
});

// Rivaler rangeres på jævnbyrdighed fra rigtige møder (K3 lukket), så linjen
// skal sige mødetal og stilling — ikke antal historier.
describe("rivalTally", () => {
  it("siger mødetal og stilling, når man fører", () => {
    expect(rivalTally({ meetings: 7, wins: 4, losses: 3, draws: 0 }))
      .toBe("I har mødt hinanden 7 gange — du fører 4-3.");
  });

  it("siger det neutralt, når man er bagud (kun tælletal, ingen superlativer)", () => {
    const s = rivalTally({ meetings: 7, wins: 3, losses: 4, draws: 0 });
    expect(s).toBe("I har mødt hinanden 7 gange — du er bagud 3-4.");
    expect(s).not.toMatch(/aldrig|værst|dårligst/i);
  });

  it("fremhæver den helt lige stilling — den mest jævnbyrdige rival", () => {
    expect(rivalTally({ meetings: 6, wins: 3, losses: 3, draws: 0 }))
      .toBe("I har mødt hinanden 6 gange — det står lige, 3-3.");
  });

  it("nævner uafgjorte runder, når der er nogen", () => {
    expect(rivalTally({ meetings: 7, wins: 3, losses: 3, draws: 1 }))
      .toBe("I har mødt hinanden 7 gange — det står lige, 3-3 (1 uafgjort).");
  });

  it("bøjer ét enkelt møde i ental", () => {
    expect(rivalTally({ meetings: 1, wins: 1, losses: 0, draws: 0 }))
      .toBe("I har mødt hinanden 1 gang — du fører 1-0.");
  });
});

// Ratingkurven: toppunkt-ring (så Rekordernes peak kan genfindes) og akser.
describe("Sparkline (toppunkt og akser)", () => {
  const curve = [
    { round_key: "2026-05-12", rating_after: 1200 },
    { round_key: "2026-05-19", rating_after: 1240 },
    { round_key: "2026-05-26", rating_after: 1225 },
  ];
  const svg = (props) => renderToStaticMarkup(<Sparkline {...props} />);

  it("ringer den runde ind, RPC'et kalder toppunktet", () => {
    const html = svg({ curve, peakRoundKey: "2026-05-19" });
    // ringen er den eneste cirkel uden fyld
    expect(html).toContain('fill="none"');
    const rings = [...html.matchAll(/<circle[^>]*fill="none"[^>]*>/g)];
    expect(rings).toHaveLength(1);
  });

  it("falder tilbage til kurvens maksimum, hvis peak-nøglen mangler", () => {
    const rings = [...svg({ curve }).matchAll(/<circle[^>]*fill="none"[^>]*>/g)];
    expect(rings).toHaveLength(1);
  });

  it("viser skalaen som et neutralt interval, ikke som 'laveste rating'", () => {
    const html = svg({ curve, peakRoundKey: "2026-05-19" });
    expect(html).toContain("Skala 1200–1240");
    expect(html).not.toMatch(/laveste|dårligste/i);
  });

  it("viser kun første og sidste runde på x-aksen", () => {
    const html = svg({ curve, peakRoundKey: "2026-05-19" });
    expect(html).toMatch(/12[./]05 – 18[./]05/);
    expect(html).toMatch(/26[./]05 – 01[./]06/);
    expect(html).not.toMatch(/19[./]05 – 25[./]05/);
  });

  it("tegner ingenting med under to punkter", () => {
    expect(svg({ curve: [curve[0]] })).toBe("");
    expect(svg({ curve: [] })).toBe("");
  });
});

// H2H-sætningen navngiver sit eget omfang: kun kampe fra konkurrencer, BEGGE er
// med i — ikke hele Championship.
describe("h2hSentence", () => {
  it("siger, at tallene gælder de fælles konkurrencer", () => {
    expect(h2hSentence({ meetings: 12, wins: 7, losses: 4, draws: 1 }, "Jimmy"))
      .toBe("I jeres fælles konkurrencer har I mødt hinanden 12 gange — du fører 7-4 (1 uafgjort).");
  });

  it("nævner modstanderen ved navn, når viewer er bagud", () => {
    expect(h2hSentence({ meetings: 5, wins: 1, losses: 4, draws: 0 }, "Jimmy"))
      .toBe("I jeres fælles konkurrencer har I mødt hinanden 5 gange — Jimmy fører 4-1.");
  });

  it("håndterer lige stilling og ét enkelt møde i ental", () => {
    expect(h2hSentence({ meetings: 1, wins: 0, losses: 0, draws: 1 }, "Jimmy"))
      .toBe("I jeres fælles konkurrencer har I mødt hinanden 1 gang — I står lige, 0-0 (1 uafgjort).");
  });
});
