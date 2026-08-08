import { describe, it, expect } from "vitest";
import { DAY_CARD_MAX_AGE_MS, isFresh, isNewsworthy, renderFrame, roundStoryEyebrow, roundStorySuperseded, ROUND_STORY_EYEBROW, ROUND_STORY_MAX_AGE_MS, usableFrames } from "./stories.js";

// Testcases spejler docs/features/story-engine-v1.md afsnit 9 (det der kan
// udtrykkes rent i JS; DB-idempotens og trigger-adfærd verificeres i skyggetilstand).

// HVAD DER IKKE LÆNGERE TESTES HER, OG HVORFOR DET IKKE ER ET TAB
// (G86, 8. august 2026)
//
// Filen bar tolv tests af `pickStory`, `priorityFor`, `THRESHOLDS`, `RULES` og
// `DAILY_RULES` — udvælgelsesreglen, den svage/stærke prioritetsvariant,
// A4-tærsklerne, at ingen to regler deler prioritet, og at kun DAY_RESULT ligger
// i det dæmpede dagstier. Alle fem exports er slettet, fordi ingen del af appen
// kaldte dem, og testene fulgte med.
//
// **De beviste mindre, end de så ud til.** Hver enkelt påstod noget om en
// JS-KOPI af noget, der bor i SQL — og en kopi kan være internt konsistent, mens
// originalen er drevet fra den. En test, der siger "ingen to regler i `RULES`
// deler prioritet", ville stå grøn dagen efter, at nogen gav to regler i
// `sql/story_engine.sql` samme tal.
//
// **Det, der bar noget, er dækket andetsteds og mod den rigtige motor:**
//   · udvælgelsesstigen (priority → league_size → competition_id) er
//     `latest_story`s ORDER BY, og påstand 11b i story_engine_daily.sql kræver,
//     at build_round_frames bruger nøjagtig samme.
//   · prioritetsbåndet 110–189 er påstand 2d.
//   · `priority < 180 ⟺ over tærsklen` er påstand 14.
//   · regelnavnenes katalog vogtes af `analytics.test.js`, som LÆSER
//     `sql/story_engine*.sql` og fejler ved drift. Det er den eneste af de
//     gamle kataloger, der havde en aftager og en rigtig vagt.

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

  // --- pr. konkurrence (G87, 8. august 2026) ---
  // Kortet hører til ÉN konkurrence. Brugerens globale runde er regnet på tværs
  // af alle hans konkurrencer, så et resultat i en anden turnering kunne trække
  // kortet, mens kortets egen konkurrence stadig var i den runde, det handler om.
  const medComp = { round_key: "2026-07-28", competition_id: "c1" };

  it("bruger kortets EGEN konkurrence, ikke brugerens globale runde", () => {
    // Globalt er verden gået videre og har spillet — men c1 er stadig i storyens
    // egen runde, og der skal kortet blive stående.
    const round = {
      roundKey: "2026-08-04", playedCount: 5,
      byCompetition: new Map([["c1", { roundKey: "2026-07-28", playedCount: 5 }]]),
    };
    expect(roundStorySuperseded(medComp, round)).toBe(false);
  });

  it("trækker sig, når KONKURRENCEN er kommet videre — også hvis globalt intet er spillet", () => {
    const round = {
      roundKey: "2026-07-28", playedCount: 0,
      byCompetition: new Map([["c1", { roundKey: "2026-08-04", playedCount: 1 }]]),
    };
    expect(roundStorySuperseded(medComp, round)).toBe(true);
  });

  it("kræver stadig, at konkurrencens nye runde HAR spillet", () => {
    const round = {
      roundKey: "2026-08-04", playedCount: 9,
      byCompetition: new Map([["c1", { roundKey: "2026-08-04", playedCount: 0 }]]),
    };
    expect(roundStorySuperseded(medComp, round)).toBe(false);
  });

  it("falder tilbage på den globale runde for et kort UDEN konkurrence", () => {
    // De globale regler (MONTH_CHAMP, SHARP) skriver competition_id = null.
    // For dem ER brugerens egen verden den rigtige målestok.
    const global = { round_key: "2026-07-28", competition_id: null };
    const round = {
      roundKey: "2026-08-04", playedCount: 1,
      byCompetition: new Map([["c1", { roundKey: "2026-07-28", playedCount: 0 }]]),
    };
    expect(roundStorySuperseded(global, round)).toBe(true);
  });

  it("falder tilbage, når konkurrencen ikke står i kortet (fx meldt ud siden)", () => {
    const round = {
      roundKey: "2026-08-04", playedCount: 1,
      byCompetition: new Map([["c2", { roundKey: "2026-07-28", playedCount: 0 }]]),
    };
    expect(roundStorySuperseded(medComp, round)).toBe(true);
  });

  it("virker uændret uden byCompetition — gamle kaldere mister ingenting", () => {
    expect(roundStorySuperseded(medComp, { roundKey: "2026-08-04", playedCount: 1 })).toBe(true);
    expect(roundStorySuperseded(medComp, { roundKey: "2026-07-28", playedCount: 1 })).toBe(false);
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

// ---------------------------------------------------------------------------
// DAGENS REGLER HAR INGEN JS-TESTS TILBAGE (G86, 8. august 2026)
//
// Her lå ni tests: syv af `renderStory`s dagsskabeloner og to af `DAILY_RULES`.
// Begge kilder er slettet, fordi ingen del af appen læste dem — teksterne
// skrives af `sql/story_engine_v3.sql` på rækken, og prioritetstallene bor
// samme sted.
//
// **Det, de vogtede, vogtes nu mod den rigtige motor** og ikke mod en kopi:
//   · båndet 110–189 for hvert udgivet dagskort → påstand 2d
//   · `priority < 180 ⟺ over tærsklen` → påstand 14
//   · at hver dagsregel HAR en tekst → motoren skriver `headline`/`body`, og en
//     tom tekst ville stå i selve rækken
//   · regelnavnene → `analytics.test.js`, som læser `sql/story_engine*.sql`
//
// Den slettede påstand "alle dagens regler har en skabelon" er værd at nævne
// ved navn, fordi den lød som en dækningsgaranti og ikke var det: den beviste,
// at hver af de otte regler havde en skabelon **i JS** — ikke at motoren, der
// faktisk skriver teksten, har en.
