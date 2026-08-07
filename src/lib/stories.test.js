import { describe, it, expect } from "vitest";
import { DAILY_QUIET_MIN, DAILY_RULES, DAY_CARD_MAX_AGE_MS, isDailyQuiet, isFresh, isNewsworthy, isQuiet, pickDay, pickStory, priorityFor, PUBLISH_THRESHOLD, QUIET_TIER_MIN, renderFrame, renderStory, ROUND_STORY_MAX_AGE_MS, RULES, scoreDailyCandidates, sizeOf, SOFT_PRIORITY, THRESHOLDS, usableFrames } from "./stories.js";

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

  // v1.2: skabelonerne skal matche SQL'ens tekster ORDRET — det er hele
  // grunden til, at de findes to steder (fallback-rendering fra payload). En
  // afvigelse ses ikke i drift: kortet henter headline/body fra rækken, og
  // JS-skabelonen bruges kun, når payload skal renderes på ny.
  it("AWARD_WEEK bruger kåringens navn og siger 'delt' som rundens vinder", () => {
    const uden = renderStory("AWARD_WEEK", { league: "Kontorligaen", points: 14, label: "04.08 – 10.08" });
    expect(uden.headline).toBe("🏅 Du er Ugens bedste i Kontorligaen");
    expect(uden.body).toBe("14 point — flest af alle i Kontorligaen i runden 04.08 – 10.08.");
    const delt = renderStory("AWARD_WEEK", { league: "Kontorligaen", points: 14, label: "L", shared: true, others: 1 });
    expect(delt.headline).toBe("🏅 Du er delt Ugens bedste i Kontorligaen");
    expect(delt.body).toContain("(delt med 1 anden).");
    expect(renderStory("AWARD_WEEK", { league: "K", points: 1, label: "L", shared: true, others: 2 }).body)
      .toContain("(delt med 2 andre).");
  });

  // Navnereglen (turnering-2 §3.6): lokalt hedder det "Månedens bedste" og
  // ALDRIG "Månedens Champion", som er den globale titel. To niveauer
  // må ikke konkurrere om samme navn.
  it("AWARD_MONTH holder sig fra den globale titels navn", () => {
    const { headline, body } = renderStory("AWARD_MONTH", { league: "Kontorligaen", month: "juli", points: 42 });
    expect(headline).toBe("👑 Du er Månedens bedste i Kontorligaen — juli");
    expect(headline).not.toContain("Champion");
    expect(body).toBe("42 point — flest af alle i Kontorligaen i juli.");
  });

  // Stigen: en lokal månedskåring slår alt, hvad én runde kan producere, men
  // taber til den globale månedstitel — og ugekåringen ligger lige over
  // rundens vinder, fordi det er det samme øjeblik med et andet navn.
  it("kåringernes plads på prioritetsstigen", () => {
    expect(RULES.MONTH_CHAMP).toBeLessThan(RULES.AWARD_MONTH);
    expect(RULES.AWARD_MONTH).toBeLessThan(RULES.LEAD_TAKEN);
    expect(RULES.AWARD_WEEK).toBeLessThan(RULES.ROUND_WON);
    expect(RULES.STREAK).toBeLessThan(RULES.AWARD_WEEK);
    // Begge er højdepunkter og må derfor have emoji og Del-knap.
    expect(isQuiet(RULES.AWARD_WEEK)).toBe(false);
    expect(isQuiet(RULES.AWARD_MONTH)).toBe(false);
  });

  it("Månedens Champ angiver samlede point (aldrig gennemsnit) — acceptkriterie", () => {
    const { headline, body } = renderStory("MONTH_CHAMP", { month: "juli", points: 31, gap: 3 });
    expect(headline).toContain("Månedens Champion");
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

// ---------------------------------------------------------------------------
// v2/v3 · daglige historier
// ---------------------------------------------------------------------------

describe("scoreDailyCandidates + pickDay (v3 · dagens ENE kort)", () => {
  const cand = (rule, extra = {}) =>
    ({ rule, league_size: 5, competition_id: "c1", rel: "self", ...extra });

  // TALLENE ER LÅST MED VILJE. De står også i sql/story_engine_v3.sql, og en
  // afvigelse mellem de to giver ikke en fejl og ikke en forkert formulering,
  // men et ANDET kort — uden log. Derfor påstås de præcist frem for at blive
  // sammenlignet med "større end". Samme argument som de præcise news_value-tal
  // i sql/tests/story_engine_daily.sql.
  it("lægger grundvægt, størrelse og nærhed sammen", () => {
    const [got] = scoreDailyCandidates([cand("DAY_TOP", { moved: 2, overAvg: 3, rel: "biggest" })]);
    // 34 (grundvægt) + 12 (2 pladser) + 9 (3 point over snit) + 8 (største liga)
    expect(got.news_value).toBe(34 + 12 + 9 + 8);
  });

  it("lofter hvert størrelsesbidrag for sig og summen ved 30", () => {
    // 6 pladser = 36 → loftes til 18; 10 point over = 30 → loftes til 12;
    // stime 20 = 30 → loftes til 12. Sum 42 → loftes til 30.
    expect(sizeOf({ moved: 6, overAvg: 10, streak: 20 })).toBe(30);
    expect(sizeOf({ moved: 6 })).toBe(18);
    expect(sizeOf({ overAvg: 10 })).toBe(12);
    expect(sizeOf({ streak: 20 })).toBe(12);
  });

  it("tæller et FALD lige så tungt som en fremgang", () => {
    expect(sizeOf({ moved: -2 })).toBe(sizeOf({ moved: 2 }));
  });

  it("giver stimen point først OVER 5 runder", () => {
    expect(sizeOf({ streak: 5 })).toBe(0);
    expect(sizeOf({ streak: 6 })).toBe(2);
  });

  // Beviset for spec §5's påstand: "DAY_RESULT kan aldrig alene nå tærsklen".
  // Holder den ikke, er hele det dæmpede fald-tilbage meningsløst — dagens
  // facit ville kunne udgive sig selv som dagens historie.
  it("DAY_RESULT kan ikke nå tærsklen, uanset hvor stor dagen var", () => {
    const [max] = scoreDailyCandidates([
      cand("DAY_RESULT", { moved: 99, overAvg: 99, streak: 99, rel: "self" }),
    ]);
    // Spec §5's regnestykke ORDRET: 8 + 12 + 20 = 40. Dagens facit får kun
    // afstanden til dagens gennemsnit, ikke placeringsændring og ikke stime —
    // fik den hele størrelsesloftet (30), ville den nå 58 og kunne udgive sig
    // selv som dagens historie, og så ville der aldrig findes en dag under
    // tærsklen at falde tilbage til.
    expect(max.news_value).toBe(8 + 12 + 20);
    expect(max.news_value).toBeLessThan(PUBLISH_THRESHOLD);
  });

  // MILESTONE får intet størrelsesbidrag. Uden det ville motoren (som kender
  // dagens tal) og cron-kapringen (som ikke gør) skrive forskellig news_value
  // for det SAMME kort, og determinismen i acceptkriterie 7 ville falde.
  it("milepælen scorer fast 120 og vinder alt", () => {
    const [ms] = scoreDailyCandidates([cand("MILESTONE", { moved: 3, overAvg: 5, rel: "self" })]);
    expect(ms.news_value).toBe(120);
    const alle = scoreDailyCandidates([
      cand("MILESTONE", { rel: "self" }),
      cand("DAY_TOP", { moved: 6, overAvg: 10, rel: "self" }),
    ]);
    expect(pickDay(alle).rule).toBe("MILESTONE");
  });

  it("nærheden afgør, om en fremmeds aften bliver din historie", () => {
    const score = (rel) => scoreDailyCandidates([cand("CONTRARIAN", { rel })])[0].news_value;
    expect(score("self")).toBe(32 + 20);
    expect(score("rival")).toBe(32 + 14);
    expect(score("biggest")).toBe(32 + 8);
    expect(score("other")).toBe(32 + 4);
    // En ukendt relation må falde til den svageste og ikke til NaN.
    expect(score("vrøvl")).toBe(32 + 4);
  });

  it("vælger højeste nyhedsværdi", () => {
    const got = pickDay(scoreDailyCandidates([
      cand("SO_CLOSE", { rel: "self" }),          // 18 + 20 = 38
      cand("DAY_TOP", { rel: "biggest" }),        // 34 + 8  = 42
      cand("DUEL", { rel: "self" }),              // 30 + 20 = 50
    ]));
    expect(got.rule).toBe("DUEL");
  });

  // Tiebreak-stigen: grundvægt → største konkurrence → rule alfabetisk. Uden
  // det sidste led kunne to kandidater med samme score bytte plads mellem to
  // kørsler, og gen-kørslen ville give et andet kort.
  it("er deterministisk ved lige score", () => {
    // COLLECTIVE_MISS 24 + 20 = 44; SO_CLOSE 18 + 20 = 38 → forskellige.
    // To DUEL i lige store ligaer er derimod uadskillelige på alt andet end id.
    const a = pickDay(scoreDailyCandidates([
      cand("DUEL", { competition_id: "b" }), cand("DUEL", { competition_id: "a" }),
    ]));
    const b = pickDay(scoreDailyCandidates([
      cand("DUEL", { competition_id: "a" }), cand("DUEL", { competition_id: "b" }),
    ]));
    expect(a.competition_id).toBe("a");
    expect(b.competition_id).toBe("a");
  });

  it("lader grundvægten bryde uafgjort før konkurrencestørrelsen", () => {
    // DAY_TOP 34 + 4 = 38; SO_CLOSE 18 + 20 = 38. Samme score, højeste
    // grundvægt vinder — selv om SO_CLOSE ligger i den største liga.
    const got = pickDay(scoreDailyCandidates([
      cand("SO_CLOSE", { rel: "self", league_size: 20 }),
      cand("DAY_TOP", { rel: "other", league_size: 3 }),
    ]));
    expect(got.rule).toBe("DAY_TOP");
  });

  it("giver null uden kandidater", () => {
    expect(pickDay([])).toBe(null);
    expect(pickDay(null)).toBe(null);
    expect(scoreDailyCandidates(null)).toEqual([]);
  });
});

describe("ulæst-markering og udløb (v3)", () => {
  // Ulæst-signalet skal være sjældent nok til at betyde noget. Et badge, der
  // lyser hver dag, er ikke et signal, det er en baggrundsfarve.
  it("markerer kun kort over tærsklen", () => {
    expect(isNewsworthy({ news_value: 45, priority: 130 })).toBe(true);
    expect(isNewsworthy({ news_value: 44, priority: 130 })).toBe(false);
    expect(isNewsworthy(null)).toBe(false);
  });

  it("markerer ALDRIG det dæmpede kort, uanset news_value", () => {
    // Dagen kan have ligget ét point under tærsklen og stadig bære tallet —
    // men kortet, der blev udgivet, er facit og skal ikke lyse.
    expect(isNewsworthy({ news_value: 90, priority: 180 })).toBe(false);
  });

  it("dagskortet udløber efter 48 timer", () => {
    const now = Date.parse("2026-03-05T12:00:00Z");
    const at = (h) => ({ created_at: new Date(now - h * 3600e3).toISOString() });
    expect(isFresh(at(47), now)).toBe(true);
    expect(isFresh(at(49), now)).toBe(false);
    expect(isFresh({}, now)).toBe(false);
    expect(isFresh({ created_at: "ikke en dato" }, now)).toBe(false);
  });

  // Rundestoryen har et ANDET ur. Dagskortet handler om én aften og bliver en
  // løgn efter to døgn; ugens konklusion skal leve, indtil den nye runde har
  // noget at fortælle. Den afløsning sker i visningsreglen (et nyere dagskort),
  // ikke her — loftet er kun værnet mod sæsonpausen.
  it("rundestoryen lever hele den følgende runde", () => {
    const now = Date.parse("2026-03-05T12:00:00Z");
    const at = (d) => ({ created_at: new Date(now - d * 24 * 3600e3).toISOString() });
    // Fire dage inde i den følgende runde: stadig i live, hvor et dagskort for
    // længst ville være væk.
    expect(isFresh(at(4), now, ROUND_STORY_MAX_AGE_MS)).toBe(true);
    expect(isFresh(at(4), now)).toBe(false);
    // To runder senere uden en eneste kampdag = sæsonpause. Så skal den væk,
    // ellers står den sidste runde før pausen på Hjem i månedsvis.
    expect(isFresh(at(15), now, ROUND_STORY_MAX_AGE_MS)).toBe(false);
  });

  it("rundestoryens loft er mindst en hel runde længere end dagskortets", () => {
    expect(ROUND_STORY_MAX_AGE_MS).toBeGreaterThan(DAY_CARD_MAX_AGE_MS + 7 * 24 * 3600e3);
  });
});

describe("rundestoryens frames (v3)", () => {
  it("bygger frame 1 med percentil, så den kan stå alene som billede", () => {
    const v = renderFrame({
      frame: "ROUND_SUM", label: "03.03 – 09.03",
      points: 14, exact: 3, matches: 5, rank: 2, total: 41, percentile: 97,
    });
    expect(v.headline).toBe("14 point");
    expect(v.body).toContain("Bedre end 97 %");
    expect(v.body).toContain("3 præcise resultater");
  });

  it("springer rating-framen over, når brugeren ikke har en rating", () => {
    expect(renderFrame({ frame: "RATING", rating: null })).toBe(null);
    const v = renderFrame({ frame: "RATING", rating: 1187.6, delta: -12.4, rank: 7, moved: -2 });
    expect(v.headline).toBe("1188 (-12)");
    expect(v.body).toContain("2 pladser tilbage");
  });

  it("skriver et positivt ratingspring med fortegn", () => {
    const v = renderFrame({ frame: "RATING", rating: 1200, delta: 8, rank: 3, moved: 4 });
    expect(v.headline).toBe("1200 (+8)");
    expect(v.body).toContain("4 pladser frem");
  });

  it("nævner den værste kamp uden bebrejdelse — og udelader den, hvis den er den bedste", () => {
    const both = renderFrame({
      frame: "BEST_WORST",
      best: { home: "OB", away: "AGF", score: "2-1", guess: "2-1", points: 3 },
      worst: { home: "FCK", away: "FCM", score: "0-3", guess: "2-0", points: 0 },
    });
    expect(both.headline).toContain("3 point");
    expect(both.body).toContain("Den anden vej");
    expect(both.body).not.toMatch(/dårlig|fejl|forkert/i);

    const only = renderFrame({
      frame: "BEST_WORST",
      best: { home: "OB", away: "AGF", score: "2-1", guess: "2-1", points: 3 }, worst: null,
    });
    expect(only.body).toBe("");
    expect(renderFrame({ frame: "BEST_WORST", best: null })).toBe(null);
  });

  it("markerer en delt rundesejr som delt", () => {
    const v = renderFrame({
      frame: "CHAMPION", winner: "Anna", winner_points: 15, shared: true,
      month: "2026-03", month_rank: 4, month_total: 40, month_points: 52,
    });
    expect(v.headline).toContain("Delt: Anna");
    expect(v.body).toContain("nr. 4 af 40");
    expect(renderFrame({ frame: "CHAMPION", winner: null })).toBe(null);
  });

  it("renderer milepælsframen fra kataloget og ikke fra SQL'ens tekst", () => {
    const v = renderFrame({
      frame: "MILESTONE", milestone_key: "RATING_1200", milestone_payload: { peak: 1210 },
    });
    expect(v.headline).toContain("Rating 1200");
    expect(v.body).toContain("1210");
  });

  it("usableFrames filtrerer de ubrugelige fra og bevarer rækkefølgen", () => {
    const got = usableFrames({ frames: [
      { frame: "ROUND_SUM", points: 9, rank: 1, total: 2 },
      { frame: "BEST_WORST", best: null },          // ingen tips → ryger ud
      { frame: "RATING", rating: 1100, delta: 3, rank: 1 },
      { frame: "UKENDT_FRA_EN_NYERE_SERVER" },      // ryger ud, kaster ikke
    ] });
    expect(got.map((x) => x.raw.frame)).toEqual(["ROUND_SUM", "RATING"]);
    expect(usableFrames(null)).toEqual([]);
  });
});

describe("dagens regler (tekst)", () => {
  // Prioritetsbåndet er hele grunden til, at karriereprofilens milepæle ikke
  // behøvede en kodeændring: dens filter er priority < QUIET_TIER_MIN.
  it("ligger helt over det dæmpede runde-tier og inden for båndet 110–189", () => {
    for (const p of Object.values(DAILY_RULES)) {
      expect(p).toBeGreaterThan(QUIET_TIER_MIN);
      expect(p).toBeLessThan(190);
    }
    const values = Object.values(DAILY_RULES);
    expect(new Set(values).size).toBe(values.length);
  });

  // v3 tog det reserverede dæmpede dagstier i brug: DAY_RESULT er dagens
  // fald-tilbage og skal renderes uden guld, uden emoji og uden ulæst-prik.
  // Alle andre dagsregler er højdepunkter og skal ligge under grænsen.
  it("kun DAY_RESULT ligger i det dæmpede dagstier", () => {
    for (const [rule, p] of Object.entries(DAILY_RULES)) {
      expect(isDailyQuiet(p), `${rule} er i det forkerte tier`).toBe(rule === "DAY_RESULT");
    }
    expect(DAILY_RULES.DAY_RESULT).toBe(DAILY_QUIET_MIN);
  });

  it("Dagens facit nævner kun placeringen i den øverste halvdel", () => {
    const top = renderStory("DAY_RESULT",
      { points: 9, matches: 4, exact: 3, rank: 1, total: 5, moved: 0, gap: 0, league: "Kontoret" });
    expect(top.body).toContain("Du ligger nr. 1 af 5");

    const bottom = renderStory("DAY_RESULT",
      { points: 1, matches: 4, exact: 0, rank: 4, total: 5, moved: 0, gap: 8, league: "Kontoret" });
    expect(bottom.body).toContain("Toppen er 8 point væk");
    expect(bottom.body).not.toMatch(/nr\. 4/);   // driller, ydmyger aldrig
  });

  it("Dagens facit fortæller om et ryk frem, når der var et", () => {
    const { body } = renderStory("DAY_RESULT",
      { points: 7, matches: 3, exact: 1, rank: 2, total: 8, moved: 3, gap: 4, league: "Kontoret" });
    expect(body).toContain("fra nr. 5 til nr. 2");
  });

  it("Kontrarian formulerer uafgjort som en kamp og ikke som et hold", () => {
    const win = renderStory("CONTRARIAN",
      { team: "Randers", home: "Randers", away: "Silkeborg", score: "2-1", others: 4, points: 3, draw: false, league: "Kontoret" });
    expect(win.headline).toContain("troede på Randers");
    expect(win.body).toContain("4 andre tippet imod");

    const draw = renderStory("CONTRARIAN",
      { team: "uafgjort", home: "OB", away: "Viborg", score: "1-1", others: 1, points: 3, draw: true, league: "Kontoret" });
    expect(draw.headline).toContain("uafgjort i OB–Viborg");
    expect(draw.body).toContain("1 anden tippet imod");
  });

  it("Kollektiv fiasko nævner ingen ved navn", () => {
    const { headline, body } = renderStory("COLLECTIVE_MISS",
      { home: "OB", away: "Viborg", score: "3-3", n: 5, league: "Kontoret" });
    expect(headline).toBe("🙈 Ingen ramte OB–Viborg");
    expect(body).toContain("5 tippede kampen");
  });

  it("Stimen slutter fremadrettet, når den er brudt", () => {
    const alive = renderStory("STREAK_STATUS", { n: 7, alive: true, day: "03.03" });
    expect(alive.headline).toContain("7 kampe i træk");

    const dead = renderStory("STREAK_STATUS", { n: 7, alive: false, day: "03.03" });
    expect(dead.body).toContain("En ny begynder i morgen");
    expect(dead.headline).not.toMatch(/dårlig|værste|sidst/i);
  });

  it("Duellen vender teksten om, når man selv fører", () => {
    const up = renderStory("DUEL", { rival: "Bo", gap: 2, above: true, day: "03.03", league: "Kontoret" });
    expect(up.headline).toContain("Kun 2 point op til Bo");

    const down = renderStory("DUEL", { rival: "Bo", gap: 2, above: false, day: "03.03", league: "Kontoret" });
    expect(down.headline).toContain("Bo er 2 point efter dig");
    expect(down.body).toContain("Du fører Kontoret");
  });

  it("Så tæt på taler om nærmisser og ikke om fejl", () => {
    const { headline, body } = renderStory("SO_CLOSE", { n: 3, day: "03.03", league: "Kontoret" });
    expect(headline).toBe("😤 Ét mål fra 3 eksakte");
    expect(body).toContain("på ét mål nær");
  });

  it("alle dagens regler har en skabelon", () => {
    for (const rule of Object.keys(DAILY_RULES)) {
      const { headline } = renderStory(rule, { n: 1, points: 1, matches: 1, rank: 1, total: 2, gap: 0, others: 1 });
      expect(headline, `${rule} mangler en skabelon`).not.toBe("");
    }
  });
});
