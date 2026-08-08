import { describe, it, expect } from "vitest";
import { DAILY_QUIET_MIN, DAILY_RULES, DAY_CARD_MAX_AGE_MS, isDailyQuiet, isFresh, isNewsworthy, isQuiet, pickStory, priorityFor, QUIET_TIER_MIN, renderFrame, roundStoryEyebrow, roundStorySuperseded, ROUND_STORY_EYEBROW, ROUND_STORY_MAX_AGE_MS, RULES, SOFT_PRIORITY, THRESHOLDS, usableFrames } from "./stories.js";

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

  // DE FEM TEKST-TESTS, DER STOD HER, ER SLETTET MED `renderStory` (G86,
  // 8. august 2026): emoji-signalet, "nævner aldrig placeringen i nederste
  // halvdel", status quo-formuleringen og premiereugens udeladte afstand.
  // De påstod alle sammen noget om skabeloner, ingen bruger nogensinde mødte —
  // teksterne kommer fra SQL'en. **Designreglerne, de vogtede, er ikke
  // ophævet**, og det er den eneste grund til, at det er værd at nævne her:
  // "historier driller, men ydmyger aldrig" og "emoji findes kun i
  // højdepunkt-tieret" gælder uændret, de gælder bare om `sql/story_engine.sql`,
  // hvor teksterne står. En test af dem hører derfor til i et SQL-tjek og ikke i
  // vitest, og indtil den findes, er de vogtet af gennemlæsning alene.
});

describe("nye regler (v1.1)", () => {
  it("prioritetsstigen er entydig — ingen to regler deler prioritet", () => {
    const values = Object.values(RULES);
    expect(new Set(values).size).toBe(values.length);
  });
});

// ---------------------------------------------------------------------------
// v2/v3 · daglige historier
// ---------------------------------------------------------------------------

describe("ulæst-markering og udløb (v3)", () => {
  // Ulæst-signalet skal være sjældent nok til at betyde noget. Et badge, der
  // lyser hver dag, er ikke et signal, det er en baggrundsfarve.
  // TÆRSKLEN STÅR IKKE I JS (G78). Den er afgjort, da rækken blev skrevet:
  // et v3-dagskort med prioritet under 180 ER et kort over tærsklen, fordi
  // motorens eneste anden udgang er det dæmpede DAY_RESULT på 180. Invarianten
  // selv påstås mod en rigtig PostgreSQL i sql/tests/story_engine_daily.sql —
  // her prøves kun aflæsningen af den.
  it("markerer kortet med en rigtig regels prioritet", () => {
    expect(isNewsworthy({ news_value: 52, priority: 130 })).toBe(true);
    expect(isNewsworthy({ news_value: 120, priority: 110 })).toBe(true);
    expect(isNewsworthy(null)).toBe(false);
  });

  // v2-rækkerne har ingen news_value og dermed ingen tærskel at være over.
  // Æra-markøren er den samme, som det unikke indeks i migreringen bruger.
  it("markerer aldrig en historisk v2-række", () => {
    expect(isNewsworthy({ priority: 130 })).toBe(false);
    expect(isNewsworthy({ news_value: null, priority: 110 })).toBe(false);
  });

  it("markerer ALDRIG det dæmpede kort, uanset news_value", () => {
    // Dagen kan have ligget ét point under tærsklen og stadig bære tallet —
    // men kortet, der blev udgivet, er facit og skal ikke lyse. Tallet 90 er
    // valgt, fordi det ligger OVER tærsklen: det er netop den kombination, en
    // aflæsning af news_value alene ville tage fejl af.
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

// ---------------------------------------------------------------------------
// Afløsningen (august 2026)
//
// Indtil da blev rundestoryen kun afløst af et NYERE dagskort. Den regel er
// sand, men for smal: et dagskort kræver en færdigspillet kampdag, mens
// stillingen flytter sig ved hvert enkelt slutfløjt. Hullet blev meldt 7. august
// 2026 — kortet sagde "du er nu foran Lis04", mens Lis04 lå over brugeren i
// STILLING, fordi den nye rundes første kamp var spillet.
describe("rundestoryens afløsning", () => {
  const story = { round_key: "2026-07-28" };

  it("trækker sig, så snart den nye runde har sit første resultat", () => {
    expect(roundStorySuperseded(story, { roundKey: "2026-08-04", playedCount: 1 })).toBe(true);
  });

  it("bliver stående, indtil den nye runde har spillet", () => {
    // Tirsdagens tomhed: ny runde begyndt på kalenderen, men intet fortalt endnu.
    expect(roundStorySuperseded(story, { roundKey: "2026-08-04", playedCount: 0 })).toBe(false);
  });

  it("bliver stående gennem sin EGEN runde, uanset hvor mange kampe der er spillet", () => {
    // STRENGT større: kortet handler om præcis den runde, skærmen viser.
    expect(roundStorySuperseded(story, { roundKey: "2026-07-28", playedCount: 6 })).toBe(false);
  });

  it("trækker sig ikke på en ældre runde", () => {
    expect(roundStorySuperseded(story, { roundKey: "2026-07-21", playedCount: 3 })).toBe(false);
  });

  it("er tavs uden data — ufuldstændig viden må aldrig fjerne et kort", () => {
    expect(roundStorySuperseded(null, { roundKey: "2026-08-04", playedCount: 1 })).toBe(false);
    expect(roundStorySuperseded(story, null)).toBe(false);
    expect(roundStorySuperseded(story, undefined)).toBe(false);
    expect(roundStorySuperseded(story, { playedCount: 2 })).toBe(false);
  });
});

describe("rundestoryens dateline", () => {
  it("sætter rundens interval på overskriftslinjen", () => {
    expect(roundStoryEyebrow({ round_key: "2026-07-28" })).toBe("Rundens historie · 28.07 – 03.08");
  });

  it("falder tilbage til den nøgne etiket ved manglende eller ugyldig rundenøgle", () => {
    // roundLabel() ville ellers skrive "Invalid Date – Invalid Date" hen over kortet.
    expect(roundStoryEyebrow({})).toBe(ROUND_STORY_EYEBROW);
    expect(roundStoryEyebrow(null)).toBe(ROUND_STORY_EYEBROW);
    expect(roundStoryEyebrow({ round_key: "ikke en dato" })).toBe(ROUND_STORY_EYEBROW);
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

  // SYV TEKST-TESTS ER SLETTET HER MED `renderStory` (G86, 8. august 2026):
  // dagens facit, kontrarian, kollektiv fiasko, stimen, duellen, "så tæt på" og
  // dækningspåstanden "alle dagens regler har en skabelon". Den sidste er værd
  // at nævne ved navn, fordi den lyder som en dækningsgaranti og ikke var det:
  // den beviste, at hver af de otte dagsregler havde en skabelon i JS —
  // ikke at motoren, der faktisk skriver teksten, har en. Den påstand hører til
  // i sql/tests/story_engine_daily.sql, hvor teksterne kommer fra.
});
