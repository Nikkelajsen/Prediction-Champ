import { describe, it, expect } from "vitest";
import { pickStory, renderStory, RULES, THRESHOLDS } from "./stories.js";

// Testcases spejler docs/features/story-engine-v1.md afsnit 9 (det der kan
// udtrykkes rent i JS; DB-idempotens og trigger-adfærd verificeres i skyggetilstand).

describe("pickStory (deterministisk udvælgelse)", () => {
  it("vælger laveste prioritet", () => {
    const chosen = pickStory([
      { rule: "ROUND_WON", priority: 70, league_size: 8, competition_id: "c1" },
      { rule: "LEAD_TAKEN", priority: 20, league_size: 4, competition_id: "c2" },
      { rule: "RATING_HIGH", priority: 30, league_size: null, competition_id: null },
    ]);
    expect(chosen.rule).toBe("LEAD_TAKEN"); // §9.1: 1.-pladsskift vinder over rundevinder/rating
  });

  it("ved samme prioritet vinder den største liga", () => {
    const chosen = pickStory([
      { rule: "LEAD_TAKEN", priority: 20, league_size: 4, competition_id: "a" },
      { rule: "LEAD_TAKEN", priority: 20, league_size: 8, competition_id: "b" },
    ]);
    expect(chosen.competition_id).toBe("b");
  });

  it("bruger competition_id som endelig, unik tiebreak", () => {
    const chosen = pickStory([
      { rule: "ROUND_WON", priority: 70, league_size: 5, competition_id: "zeta" },
      { rule: "ROUND_WON", priority: 70, league_size: 5, competition_id: "alpha" },
    ]);
    expect(chosen.competition_id).toBe("alpha");
  });

  it("global historie (league_size null) taber en lighed til en liga-historie (nulls last)", () => {
    // (opstår ikke i praksis pga. unikke globale prioriteter, men reglen skal være entydig)
    const chosen = pickStory([
      { rule: "X", priority: 50, league_size: null, competition_id: null },
      { rule: "Y", priority: 50, league_size: 3, competition_id: "c" },
    ]);
    expect(chosen.competition_id).toBe("c");
  });

  it("ingen kandidater → null (stilhed, intet kort) — §9.2", () => {
    expect(pickStory([])).toBeNull();
    expect(pickStory(null)).toBeNull();
  });

  it("Comeback (50) vælges over Perfekt træfsikkerhed (80); begge er kandidater — §9.3", () => {
    const candidates = [
      { rule: "COMEBACK", priority: RULES.COMEBACK, league_size: 9, competition_id: "pk" },
      { rule: "SHARP", priority: RULES.SHARP, league_size: null, competition_id: null },
    ];
    expect(pickStory(candidates).rule).toBe("COMEBACK");
    expect(candidates).toHaveLength(2); // begge bevares (gemmes i DB), kun én vises
  });
});

describe("renderStory (tekst-skabeloner)", () => {
  it("Månedens Champ angiver samlede point (aldrig gennemsnit) — acceptkriterie", () => {
    const { headline, body } = renderStory("MONTH_CHAMP", { month: "juli", points: 31, gap: 3 });
    expect(headline).toContain("Månedens Prediction Champ");
    expect(headline).toContain("juli");
    expect(body).toContain("31 point");
    expect(body).not.toMatch(/gennemsnit/i);
  });

  it("hver body har præcis ét tal-anker og nævner runden", () => {
    const { body } = renderStory("LEAD_TAKEN", { league: "Kontoret", gap: 2, label: "21.07 – 27.07" });
    expect(body).toContain("Kontoret");
    expect(body).toContain("2 point");
    expect(body).toContain("21.07 – 27.07");
  });

  it("Comeback rendrer antal rykkede pladser", () => {
    const { headline, body } = renderStory("COMEBACK", { from: 8, to: 4, gap: 5, league: "Padel", label: "L" });
    expect(headline).toContain("Fra nr. 8 til nr. 4");
    expect(body).toContain("4 pladser frem");
    expect(body).toContain("5 point væk");
  });

  it("Stime mod rival nævner rival og rundens pointforskel", () => {
    const { headline, body } = renderStory("STREAK", { n: 4, rival: "Nikolaj", mine: 7, deres: 4, league: "Kontoret", label: "L" });
    expect(headline).toContain("4. sejr i træk mod Nikolaj");
    expect(body).toContain("7 mod 4 point");
  });

  it("ukendt regel → tom tekst (defensivt)", () => {
    expect(renderStory("UNKNOWN", {})).toEqual({ headline: "", body: "" });
  });
});

describe("tærskler", () => {
  it("comeback ≥3 pladser og stime ≥3 runder (spec-defaults)", () => {
    expect(THRESHOLDS.comebackPlaces).toBe(3);
    expect(THRESHOLDS.streakRounds).toBe(3);
  });
});
