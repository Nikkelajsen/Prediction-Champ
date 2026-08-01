import { describe, it, expect, vi, afterEach } from "vitest";
import { outcome, pointsFor, groupIntoRounds, filterFromNextUnfinishedRound, currentRoundIndex, isLocked, lockAtOf, lockedRoundsOf, STAGE_LABELS, stageBadgeLabel, isPlayed, liveInfo, MODE_LABELS, modeLabel } from "./scoring.js";

const RULES = { exact: 3, outcome: 1 };

describe("outcome", () => {
  it("giver 1 ved hjemmesejr, X ved uafgjort, 2 ved udesejr", () => {
    expect(outcome(2, 1)).toBe("1");
    expect(outcome(1, 1)).toBe("X");
    expect(outcome(0, 3)).toBe("2");
  });
});

describe("pointsFor", () => {
  const match = { home_score: 2, away_score: 1 };

  it("giver +3 for præcist resultat", () => {
    expect(pointsFor({ pred_home: 2, pred_away: 1 }, match, RULES)).toBe(3);
  });

  it("giver +1 for korrekt udfald med forkert resultat", () => {
    expect(pointsFor({ pred_home: 3, pred_away: 0 }, match, RULES)).toBe(1);
  });

  it("giver 0 for forkert udfald — aldrig minuspoint", () => {
    expect(pointsFor({ pred_home: 0, pred_away: 0 }, match, RULES)).toBe(0);
    expect(pointsFor({ pred_home: 0, pred_away: 2 }, match, RULES)).toBe(0);
  });

  it("giver null uden forudsigelse eller uden resultat", () => {
    expect(pointsFor(null, match, RULES)).toBeNull();
    expect(pointsFor({ pred_home: null, pred_away: 1 }, match, RULES)).toBeNull();
    expect(pointsFor({ pred_home: 2, pred_away: 1 }, { home_score: null, away_score: null }, RULES)).toBeNull();
  });

  it("respekterer konkurrencens egne pointregler", () => {
    const rules = { exact: 5, outcome: 2 };
    expect(pointsFor({ pred_home: 2, pred_away: 1 }, match, rules)).toBe(5);
    expect(pointsFor({ pred_home: 1, pred_away: 0 }, match, rules)).toBe(2);
  });

  it("falder tilbage til +3/+1 for ældre konkurrencer uden rules-felt", () => {
    expect(pointsFor({ pred_home: 2, pred_away: 1 }, match, undefined)).toBe(3);
    expect(pointsFor({ pred_home: 1, pred_away: 0 }, match, undefined)).toBe(1);
  });

  it("håndterer 0-0 korrekt (0 er ikke 'manglende gæt')", () => {
    expect(pointsFor({ pred_home: 0, pred_away: 0 }, { home_score: 0, away_score: 0 }, RULES)).toBe(3);
  });
});

describe("groupIntoRounds", () => {
  it("grupperer på round_key, sorterer runder og kampe kronologisk", () => {
    const rounds = groupIntoRounds([
      { round_key: "2026-07-14", kickoff_at: "2026-07-18T14:00:00Z" },
      { round_key: "2026-07-07", kickoff_at: "2026-07-10T17:00:00Z" },
      { round_key: "2026-07-14", kickoff_at: "2026-07-15T17:00:00Z" },
    ]);
    expect(rounds.map((r) => r.key)).toEqual(["2026-07-07", "2026-07-14"]);
    expect(rounds[1].matches.map((m) => m.kickoff_at)).toEqual([
      "2026-07-15T17:00:00Z", "2026-07-18T14:00:00Z",
    ]);
  });
});

// Fase-afgrænsning ved oprettelse er fjernet (A20, juli 2026), og med den
// stageOptionLabel og filterByStages. STAGE_LABELS og badgen består: en kamp
// viser stadig, om den hører til et slutspil.
describe("stageBadgeLabel", () => {
  it("oversætter kendte Sportmonks-stages til dansk", () => {
    expect(STAGE_LABELS["Championship Round"]).toBe("Mesterskabsspil");
    expect(STAGE_LABELS["Relegation Round"]).toBe("Nedrykningsspil");
    expect(STAGE_LABELS["Regular Season"]).toBe("Grundspil");
  });

  it("falder tilbage til det rå navn for ukendte stages", () => {
    expect(stageBadgeLabel("Some New Stage")).toBe("Some New Stage");
  });

  it("skjuler grundspil-badge, men viser slutspils-stages", () => {
    expect(stageBadgeLabel("Regular Season")).toBeNull();
    expect(stageBadgeLabel(null)).toBeNull();
    expect(stageBadgeLabel("Championship Round")).toBe("Mesterskabsspil");
    expect(stageBadgeLabel("Relegation Round")).toBe("Nedrykningsspil");
  });

  // Scotland Premiership (turnering #2) kalder faserne noget andet end
  // Superligaen — og noget andet fra sæson til sæson: 2026/2027 hedder
  // grundspillet "1st Phase", 2025/2026 hed det "Regular Season".
  it("skjuler grundspils-badgen, uanset hvad turneringen kalder den på engelsk", () => {
    expect(stageBadgeLabel("1st Phase")).toBeNull();
    expect(stageBadgeLabel("2nd Phase")).toBe("Slutspil");
  });
});

describe("filterFromNextUnfinishedRound", () => {
  const finished = (key) => ({ round_key: key, home_score: 1, away_score: 0 });
  const upcoming = (key) => ({ round_key: key, home_score: null, away_score: null });

  it("udelader allerede afsluttede runder (nye konkurrencer starter fra 0)", () => {
    const result = filterFromNextUnfinishedRound([
      finished("2026-07-07"), finished("2026-07-07"),
      upcoming("2026-07-14"), upcoming("2026-07-21"),
    ]);
    expect(result.map((m) => m.round_key)).toEqual(["2026-07-14", "2026-07-21"]);
  });

  it("beholder en delvist spillet runde", () => {
    const result = filterFromNextUnfinishedRound([finished("2026-07-07"), upcoming("2026-07-07")]);
    expect(result).toHaveLength(2);
  });

  it("giver tom liste når hele sæsonen er spillet", () => {
    expect(filterFromNextUnfinishedRound([finished("2026-07-07")])).toEqual([]);
  });
});

describe("per-kamp-låsning (isLocked / lockAtOf)", () => {
  afterEach(() => vi.useRealTimers());

  const r1 = { season_id: "s1", round_key: "2026-07-14" };

  it("lockAtOf er kickoff minus én time, og null uden kendt kickoff", () => {
    expect(lockAtOf({ kickoff_at: "2026-07-15T17:00:00Z" }))
      .toBe(new Date("2026-07-15T16:00:00Z").getTime());
    expect(lockAtOf({ kickoff_at: null })).toBeNull();
    expect(lockAtOf(null)).toBeNull();
  });

  // A21 (1. august 2026): låsen følger KAMPEN, ikke runden. Denne test er invarianten
  // og ikke en detalje: genindfører nogen rundeaggregeringen, er det her, det slår fejl.
  it("en kamp låser af sit EGET kickoff — en tidligere kamp i runden låser den ikke", () => {
    const tidlig = { ...r1, home_score: null, kickoff_at: "2026-07-15T17:00:00Z" };
    const sen = { ...r1, home_score: null, kickoff_at: "2026-07-18T14:00:00Z" };

    vi.useFakeTimers({ now: new Date("2026-07-15T16:30:00Z") }); // 30 min før den tidlige
    expect(isLocked(tidlig)).toBe(true);
    expect(isLocked(sen)).toBe(false); // under rundelåsen var denne true

    vi.useFakeTimers({ now: new Date("2026-07-18T13:30:00Z") }); // 30 min før den sene
    expect(isLocked(sen)).toBe(true);
  });

  it("kampe med resultat er altid låst, og en kamp uden kickoff er aldrig låst", () => {
    vi.useFakeTimers({ now: new Date("2026-07-14T12:00:00Z") });
    expect(isLocked({ ...r1, home_score: 1, away_score: 0, kickoff_at: "2026-07-20T12:00:00Z" })).toBe(true);
    expect(isLocked({ ...r1, home_score: null, kickoff_at: "2026-07-14T12:30:00Z" })).toBe(true); // 30 min til kickoff
    expect(isLocked({ ...r1, home_score: null, kickoff_at: "2026-07-14T14:00:00Z" })).toBe(false); // 2 timer til kickoff
    // Uden kendt kickoff er kampen åben for tips — spejler skrivegrenen i
    // sql/predictions_match_lock.sql, hvor `kickoff_at is null` behandles eksplicit.
    expect(isLocked({ ...r1, home_score: null, kickoff_at: null })).toBe(false);
  });
});

describe("lockedRoundsOf", () => {
  afterEach(() => vi.useRealTimers());

  const round = (key, matches) => ({ key, label: key, matches });
  const m = (season_id, round_key, kickoff_at, home_score = null) => ({ season_id, round_key, kickoff_at, home_score });

  it("tager låste kampe med UDEN at kræve resultater", () => {
    // 30 min før første kickoff: kampen er låst, men ikke spillet.
    // Dette var fejlen — kravet om færdigspillede kampe skjulte hele drill-in'et.
    vi.useFakeTimers({ now: new Date("2026-07-15T16:30:00Z") });
    const laast = m("s1", "2026-07-13", "2026-07-15T17:00:00Z");
    const senere = m("s1", "2026-07-13", "2026-07-18T14:00:00Z");
    const out = lockedRoundsOf([round("2026-07-13", [laast, senere])]);
    expect(out).toHaveLength(1);
    // Efter A21 beskæres runden: den sene kamp kan stadig tippes, så dens gæt er hemmeligt.
    expect(out[0].matches).toEqual([laast]);
  });

  it("udelader runder, hvor ingen kamp har låst endnu", () => {
    vi.useFakeTimers({ now: new Date("2026-07-15T15:30:00Z") }); // 1½ time før
    const r = round("2026-07-13", [m("s1", "2026-07-13", "2026-07-15T17:00:00Z")]);
    expect(lockedRoundsOf([r])).toEqual([]);
  });

  it("beskærer til de låste kampe, uanset om de deler sæson", () => {
    vi.useFakeTimers({ now: new Date("2026-07-15T16:30:00Z") });
    const laast = m("s1", "2026-07-13", "2026-07-15T17:00:00Z");   // låser 16:00
    const aaben = m("s2", "2026-07-13", "2026-07-19T17:00:00Z");   // låser først 19/7
    const out = lockedRoundsOf([round("2026-07-13", [laast, aaben])]);
    expect(out[0].matches).toEqual([laast]); // det åbne gæt må ikke afsløres
  });

  it("tager spillede kampe med, uanset hvornår de lå", () => {
    vi.useFakeTimers({ now: new Date("2026-07-15T15:30:00Z") });
    const spillet = m("s1", "2026-07-06", "2026-07-08T17:00:00Z", 2);
    expect(lockedRoundsOf([round("2026-07-06", [spillet])])[0].matches).toEqual([spillet]);
  });

  it("giver tom liste uden runder", () => {
    expect(lockedRoundsOf([])).toEqual([]);
  });
});

describe("currentRoundIndex", () => {
  afterEach(() => vi.useRealTimers());

  it("finder runden der indeholder i dag, ellers den sidste", () => {
    vi.useFakeTimers({ now: new Date("2026-07-15T12:00:00Z") });
    const rounds = [{ key: "2026-07-07" }, { key: "2026-07-14" }, { key: "2026-07-21" }];
    expect(currentRoundIndex(rounds)).toBe(1);
    expect(currentRoundIndex([{ key: "2026-06-01" }])).toBe(0);
    expect(currentRoundIndex([])).toBe(0);
  });
});

describe("liveInfo", () => {
  const live = { home_score: null, away_score: null, live_home_score: 2, live_away_score: 1, live_state: "INPLAY_2ND_HALF", live_minute: 63 };

  it("giver nuværende stilling og spilleminut for en kamp i gang", () => {
    expect(liveInfo(live)).toEqual({ homeScore: 2, awayScore: 1, state: "INPLAY_2ND_HALF", minute: 63, label: "63′" });
  });

  it("viser Pause i halvlegen og skjuler minuttet", () => {
    const ht = liveInfo({ ...live, live_state: "HT", live_minute: 45 });
    expect(ht.label).toBe("Pause");
    expect(ht.minute).toBeNull();
  });

  it("falder tilbage til 'Live' når minuttet er ukendt", () => {
    expect(liveInfo({ ...live, live_minute: null }).label).toBe("Live");
  });

  it("giver 0-0 når live-scoren endnu ikke er sat", () => {
    const l = liveInfo({ ...live, live_home_score: null, live_away_score: null });
    expect([l.homeScore, l.awayScore]).toEqual([0, 0]);
  });

  it("returnerer null når kampen ikke er i gang", () => {
    expect(liveInfo({ home_score: null, live_state: null })).toBeNull();
    expect(liveInfo(null)).toBeNull();
  });

  it("et endeligt resultat slår altid live — en færdig kamp kan aldrig blive live igen", () => {
    expect(liveInfo({ ...live, home_score: 3, away_score: 1 })).toBeNull();
  });

  it("live-stilling giver ingen point (kun home_score tæller)", () => {
    expect(pointsFor({ pred_home: 2, pred_away: 1 }, live, RULES)).toBeNull();
    expect(isPlayed(live)).toBe(false);
    expect(isPlayed({ home_score: 0, away_score: 0 })).toBe(true);
  });
});

// Mode-navnene stod før fire steder i tre varianter (samme konkurrence hed
// "Enkelt hold" på Ligaer-kortet og "Et hold" i opret-dropdownen). Testen holder
// de fire kaldesteder på ét sæt navne.
describe("modeLabel", () => {
  it("dækker alle fem modes fra competitions.mode", () => {
    expect(Object.keys(MODE_LABELS).sort())
      .toEqual(["custom", "full_season", "random", "team", "time_range"]);
  });

  it("giver det danske navn for hver mode (I14-ordforrådet)", () => {
    expect(modeLabel("full_season")).toBe("Sæson");
    expect(modeLabel("team")).toBe("Favorithold");
    expect(modeLabel("time_range")).toBe("Periode");
    expect(modeLabel("custom")).toBe("Custom");
    expect(modeLabel("random")).toBe("Quick Pick");
  });

  // Quick League er ikke en mode i databasen — det er `random` over flere
  // runder, og forskellen bor alene i mode_params.rounds. Uden params (fx
  // admin-statistikkens aggregering) falder etiketten tilbage til Quick Pick.
  it("kalder random over flere runder Quick League", () => {
    expect(modeLabel("random", { rounds: 6 })).toBe("Quick League");
    expect(modeLabel("random", { rounds: 1 })).toBe("Quick Pick");
    expect(modeLabel("random", {})).toBe("Quick Pick");
    expect(modeLabel("random")).toBe("Quick Pick");
    expect(modeLabel("full_season", { rounds: 6 })).toBe("Sæson");
  });

  // en ny mode må aldrig blive til en tom celle i UI'et
  it("falder tilbage til den rå værdi for en ukendt mode", () => {
    expect(modeLabel("knockout")).toBe("knockout");
  });
});

