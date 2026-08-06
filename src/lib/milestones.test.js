import { describe, it, expect } from "vitest";
import { compareMilestones, familyOf, groupMilestones, MILESTONE_FAMILIES, MILESTONES, renderMilestone } from "./milestones.js";

describe("milepæls-kataloget", () => {
  it("dækker alle fire familier, og hver nøgle hører til en af dem", () => {
    const known = new Set(MILESTONE_FAMILIES.map((f) => f.key));
    for (const [key, def] of Object.entries(MILESTONES)) {
      expect(known.has(def.family), `${key} har familien "${def.family}"`).toBe(true);
      expect(def.title, `${key} mangler titel`).toBeTruthy();
      expect(def.icon, `${key} mangler ikon`).toBeTruthy();
    }
    // Alle fire familier skal faktisk være i brug — en tom familie ville give en
    // overskrift uden indhold på karriereprofilen.
    const used = new Set(Object.values(MILESTONES).map((d) => d.family));
    expect([...known].every((k) => used.has(k))).toBe(true);
  });

  it("indeholder de tierede familier med alle deres trin", () => {
    for (const n of [1100, 1200, 1300, 1400]) expect(MILESTONES[`RATING_${n}`]).toBeTruthy();
    for (const n of [5, 10, 20]) expect(MILESTONES[`POINTS_STREAK_${n}`]).toBeTruthy();
    for (const n of [10, 30, 100]) expect(MILESTONES[`ROUNDS_COMPLETE_${n}`]).toBeTruthy();
    for (const n of [100, 500, 1000]) expect(MILESTONES[`TIPS_${n}`]).toBeTruthy();
    for (const n of [50, 250]) expect(MILESTONES[`EXACT_${n}`]).toBeTruthy();
  });

  // Milepæle er bedrifter. Ingen af dem må formulere et fravær — det er samme
  // designregel som historiernes "driller, ydmyger aldrig".
  it("formulerer aldrig noget som et nederlag", () => {
    for (const key of Object.keys(MILESTONES)) {
      const { title, body } = renderMilestone(key, {});
      expect(`${title} ${body}`).not.toMatch(/dårlig|værst|tabte|mislykke|sidst/i);
    }
  });
});

describe("renderMilestone", () => {
  it("bruger payload, når den findes", () => {
    expect(renderMilestone("RATING_1200", { peak: 1247 }).body).toBe("Din rating nåede 1247.");
    expect(renderMilestone("TIPS_500", { tips: 512 }).body).toBe("Du har afgivet 512 tips.");
    expect(renderMilestone("COMP_FIRST_WIN", { league: "Kontoret" }).body).toBe("Du vandt Kontoret.");
  });

  // Payload skrives af SQL'en, og en gammel række kan mangle et felt, en nyere
  // formulering gerne vil bruge. Teksten skal stadig give mening.
  it("falder tilbage på tærsklen, når payload er tom", () => {
    expect(renderMilestone("RATING_1200", {}).body).toBe("Din rating nåede 1200.");
    expect(renderMilestone("COMP_FIRST_WIN", {}).body).toBe("Du vandt din første konkurrence.");
  });

  it("overlever en ukendt nøgle uden at kaste", () => {
    const r = renderMilestone("FRA_FREMTIDEN", {});
    expect(r.title).toBe("FRA_FREMTIDEN");
    expect(r.body).toBe("");
  });

  it("overlever en payload, der får skabelonen til at kaste", () => {
    expect(() => renderMilestone("RATING_1200", null)).not.toThrow();
  });

  it("skelner delt og alene i championship-titlerne", () => {
    expect(renderMilestone("MONTH_CHAMP", { month: "juli", shared: false }).body).toContain("Vinder af");
    expect(renderMilestone("MONTH_CHAMP", { month: "juli", shared: true }).body).toContain("Delt vinder");
  });
});

describe("groupMilestones", () => {
  const row = (key, achievedAt) => ({ id: key, key, family: familyOf(key), achievedAt });

  it("grupperer i fast familie-rækkefølge og udelader tomme familier", () => {
    const groups = groupMilestones([
      row("TIPS_100", "2026-01-01"),
      row("COMP_FIRST_WIN", "2026-02-01"),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["competition", "precision"]);
    expect(groups[0].items).toHaveLength(1);
  });

  it("sorterer nyeste først inden for en familie", () => {
    const groups = groupMilestones([
      row("TIPS_100", "2026-01-01"),
      row("EXACT_50", "2026-05-01"),
      row("TIPS_500", "2026-03-01"),
    ]);
    expect(groups[0].items.map((m) => m.key)).toEqual(["EXACT_50", "TIPS_500", "TIPS_100"]);
  });

  it("udleder familien, når rækken ikke bærer den", () => {
    const groups = groupMilestones([{ id: "x", key: "RATING_1100", achievedAt: "2026-01-01" }]);
    expect(groups.map((g) => g.key)).toEqual(["rating"]);
  });

  it("giver [] for ingen milepæle", () => {
    expect(groupMilestones([])).toEqual([]);
    expect(groupMilestones(null)).toEqual([]);
  });
});

describe("compareMilestones (rækkefølgen i karusellen på Hjem)", () => {
  const m = (key, family, tier, achieved_at) => ({ key, family, tier, achieved_at });

  it("sætter nyeste DAG først", () => {
    const rows = [
      m("A", "community", 1, "2026-08-01T10:00:00Z"),
      m("B", "community", 1, "2026-08-05T09:00:00Z"),
    ];
    expect(rows.slice().sort(compareMilestones).map((r) => r.key)).toEqual(["B", "A"]);
  });

  // Den fejl, rettelsen findes for: `award_milestones()` er en batch, så flere
  // milepæle får samme tidsstempel — og så valgte databasen frit.
  it("lader præstationen slå opsætningen, når dagen er den samme", () => {
    const same = "2026-08-06T19:26:41.877946Z";
    const rows = [
      m("FIRST_LEAGUE_CREATED", "community", 1, same),
      m("FIRST_COMPETITION_CREATED", "community", 1, same),
      m("SEASON_CHAMP", "competition", 2, same),
      m("RATING_ESTABLISHED", "rating", 5, same),
      m("TIPS_100", "precision", 100, same),
    ];
    expect(rows.slice().sort(compareMilestones).map((r) => r.key)).toEqual([
      "SEASON_CHAMP", "RATING_ESTABLISHED", "TIPS_100",
      "FIRST_COMPETITION_CREATED", "FIRST_LEAGUE_CREATED",
    ]);
  });

  it("bruger tier INDEN FOR en familie, aldrig på tværs", () => {
    const same = "2026-08-06T12:00:00Z";
    const rows = [
      m("COMP_FIRST_WIN", "competition", 1, same),
      m("SEASON_CHAMP", "competition", 2, same),
    ];
    expect(rows.slice().sort(compareMilestones).map((r) => r.key)).toEqual(["SEASON_CHAMP", "COMP_FIRST_WIN"]);
    // …og en tier på 100 i en lavere rangeret familie overhaler ikke.
    const across = [m("TIPS_100", "precision", 100, same), m("COMP_FIRST_WIN", "competition", 1, same)];
    expect(across.slice().sort(compareMilestones).map((r) => r.key)).toEqual(["COMP_FIRST_WIN", "TIPS_100"]);
  });

  it("er stabil, når alt andet er lige (samme liste to gange = samme rækkefølge)", () => {
    const same = "2026-08-06T12:00:00Z";
    const rows = [m("B_KEY", "community", 1, same), m("A_KEY", "community", 1, same)];
    expect(rows.slice().sort(compareMilestones).map((r) => r.key)).toEqual(["A_KEY", "B_KEY"]);
  });

  it("dagen slår rangordenen — en gammel titel fortrænger ikke en ny milepæl", () => {
    const rows = [
      m("SEASON_CHAMP", "competition", 2, "2026-08-01T12:00:00Z"),
      m("FIRST_LEAGUE_CREATED", "community", 1, "2026-08-06T12:00:00Z"),
    ];
    expect(rows.slice().sort(compareMilestones).map((r) => r.key)).toEqual(["FIRST_LEAGUE_CREATED", "SEASON_CHAMP"]);
  });
});
