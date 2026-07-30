import { describe, it, expect } from "vitest";
import { recordFacts, h2hSentence } from "./ProfileScreen.jsx";

// Rekorder-sektionen er GLOBAL (Championship + global rating), ikke en opgørelse
// pr. brugerens egne konkurrencer. Reglerne for hvad der vises, ligger i
// recordFacts, så de kan testes uden at rendere skærmen.
describe("recordFacts (hvad Rekorder-sektionen viser)", () => {
  const full = {
    best_rating: 1240, best_rating_round: "2026-05-12",
    best_round_rank: 4, best_round_rank_count: 2, best_round_rank_field: 31,
    longest_round_streak: 3,
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
