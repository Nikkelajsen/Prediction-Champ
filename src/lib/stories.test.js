import { describe, it, expect } from "vitest";
import { isQuiet, pickStory, priorityFor, QUIET_TIER_MIN, renderStory, RULES, SOFT_PRIORITY, THRESHOLDS } from "./stories.js";

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
  it("ROUND_WON siger, hvor mange sejren deles med — i grammatisk dansk", () => {
    expect(renderStory("ROUND_WON", { points: 9, league: "Kontoret", label: "L" }).body).toContain("Kontoret.");
    expect(renderStory("ROUND_WON", { points: 9, league: "Kontoret", label: "L", shared: true, others: 1 }).body)
      .toContain("(delt med 1 anden).");
    expect(renderStory("ROUND_WON", { points: 9, league: "Kontoret", label: "L", shared: true, others: 3 }).body)
      .toContain("(delt med 3 andre).");
  });

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

describe("tærskler (A4-kalibrering, v1.1)", () => {
  it("comeback fra 2 pladser, stime fra 2 runder, præcise fra 2", () => {
    expect(THRESHOLDS.comebackPlaces).toBe(2);
    expect(THRESHOLDS.streakRounds).toBe(2);
    expect(THRESHOLDS.sharpExact).toBe(2);
  });

  it("den svage variant får højere prioritetstal end den stærke", () => {
    // "tærsklen afgør, om historien findes; prioriteten afgør, om den vises"
    expect(priorityFor("COMEBACK", 3)).toBe(RULES.COMEBACK);
    expect(priorityFor("COMEBACK", 2)).toBe(SOFT_PRIORITY.COMEBACK);
    expect(priorityFor("STREAK", 4)).toBe(RULES.STREAK);
    expect(priorityFor("STREAK", 2)).toBe(SOFT_PRIORITY.STREAK);
    expect(priorityFor("SHARP", 3)).toBe(RULES.SHARP);
    expect(priorityFor("SHARP", 2)).toBe(SOFT_PRIORITY.SHARP);
  });

  it("en svag variant kan ikke fortrænge rundens vinder", () => {
    for (const rule of ["COMEBACK", "STREAK", "SHARP"]) {
      expect(priorityFor(rule, 2)).toBeGreaterThan(RULES.ROUND_WON);
    }
    // … men den stærke variant af comeback/stime skal fortsat vinde over den
    expect(priorityFor("COMEBACK", 3)).toBeLessThan(RULES.ROUND_WON);
    expect(priorityFor("STREAK", 3)).toBeLessThan(RULES.ROUND_WON);
  });

  it("regler uden svag variant har én fast prioritet", () => {
    expect(priorityFor("MONTH_CHAMP", 99)).toBe(RULES.MONTH_CHAMP);
    expect(priorityFor("UKENDT", 1)).toBeNull();
  });
});

describe("dæmpet tier (v1.1)", () => {
  it("kun SEASON_OPENER og QUIET_ROUND er dæmpede", () => {
    const quiet = Object.entries(RULES).filter(([, p]) => isQuiet(p)).map(([r]) => r);
    expect(quiet.sort()).toEqual(["QUIET_ROUND", "SEASON_OPENER"]);
    expect(isQuiet(RULES.SHARP)).toBe(false);
    expect(isQuiet(SOFT_PRIORITY.SHARP)).toBe(false); // 85 er stadig en rigtig historie
    expect(isQuiet(undefined)).toBe(false);
  });

  it("et dæmpet kort taber altid til en rigtig historie", () => {
    const chosen = pickStory([
      { rule: "QUIET_ROUND", priority: RULES.QUIET_ROUND, league_size: 12, competition_id: "a" },
      { rule: "SHARP", priority: SOFT_PRIORITY.SHARP, league_size: 3, competition_id: "b" },
    ]);
    expect(chosen.rule).toBe("SHARP");
    expect(QUIET_TIER_MIN).toBeGreaterThan(SOFT_PRIORITY.SHARP);
  });

  it("dæmpede tekster har ingen emoji — emoji er højdepunkternes signal", () => {
    const emoji = /\p{Extended_Pictographic}/u;
    const quiet = [
      renderStory("SEASON_OPENER", { league: "Kontoret", points: 7, rank: 2, total: 8, gap: 1 }),
      renderStory("QUIET_ROUND", { league: "Kontoret", points: 4, rank: 6, total: 8, gap: 9, label: "L" }),
    ];
    for (const s of quiet) expect(s.headline).not.toMatch(emoji);
    for (const rule of ["MONTH_CHAMP", "LEAD_TAKEN", "ROUND_WON", "SHARP", "PODIUM_ENTER", "CLOSING_IN", "PERSONAL_BEST"]) {
      expect(renderStory(rule, { n: 2, gap: 1, points: 5, rank: 3, total: 8 }).headline).toMatch(emoji);
    }
  });

  it("nævner ALDRIG placeringen i nederste halvdel af tabellen", () => {
    // designreglen: historier driller, men ydmyger aldrig
    const opener = renderStory("SEASON_OPENER", { league: "Kontoret", points: 4, rank: 7, total: 8, gap: 4 });
    expect(opener.body).not.toContain("nr. 7");
    expect(opener.body).toContain("4 point væk");
    const quiet = renderStory("QUIET_ROUND", { league: "Kontoret", points: 4, rank: 6, total: 8, gap: 9, label: "L" });
    expect(quiet.body).not.toContain("nr. 6");
    expect(quiet.body).toContain("Næste runde er en ny chance");
  });

  it("nævner placeringen i øverste halvdel", () => {
    expect(renderStory("SEASON_OPENER", { league: "Kontoret", points: 7, rank: 2, total: 8, gap: 1 }).body)
      .toContain("nr. 2 af 8");
    expect(renderStory("QUIET_ROUND", { league: "Kontoret", points: 7, rank: 3, total: 8, gap: 2, label: "L" }).body)
      .toContain("nr. 3 af 8");
  });

  it("en stille runde i front siger status quo frem for en placering", () => {
    const { body } = renderStory("QUIET_ROUND", { league: "Kontoret", points: 6, rank: 1, total: 8, gap: 0, label: "18.08 – 24.08" });
    expect(body).toBe("Du fører fortsat Kontoret efter runden 18.08 – 24.08.");
  });

  it("premiereugen udelader afstanden, når man selv fører", () => {
    const { body } = renderStory("SEASON_OPENER", { league: "Kontoret", points: 8, rank: 1, total: 8, gap: 0 });
    expect(body).toBe("8 point — du starter som nr. 1 af 8.");
  });
});

describe("nye regler (v1.1)", () => {
  it("Top 3 nævner både placering og afstand til toppen", () => {
    const { headline, body } = renderStory("PODIUM_ENTER", { league: "Kontoret", rank: 3, from: 5, total: 8, gap: 6, label: "L" });
    expect(headline).toContain("top 3 i Kontoret");
    expect(body).toContain("nr. 3 af 8");
    expect(body).toContain("6 point væk");
  });

  it("Tæt på toppen nævner føreren ved navn", () => {
    const { headline, body } = renderStory("CLOSING_IN", { league: "Kontoret", rival: "Jimmy", gap: 1, rank: 2, label: "04.08 – 10.08" });
    expect(headline).toContain("Kun 1 point op til føringen");
    expect(body).toContain("op til Jimmy");
    expect(body).toContain("04.08 – 10.08");
  });

  it("Personlig runderekord sammenligner kun med brugeren selv", () => {
    const { headline, body } = renderStory("PERSONAL_BEST", { points: 11, old: 8, league: "Kontoret", label: "L" });
    expect(headline).toContain("11 point");
    expect(body).toContain("forrige rekord var 8 point");
    expect(body).not.toMatch(/nr\.|plads/); // rekorden er personlig, ikke en placering
  });

  it("prioritetsstigen er entydig — ingen to regler deler prioritet", () => {
    const values = Object.values(RULES);
    expect(new Set(values).size).toBe(values.length);
  });
});
