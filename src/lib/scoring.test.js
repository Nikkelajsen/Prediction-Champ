import { describe, it, expect, vi, afterEach } from "vitest";
import { outcome, pointsFor, groupIntoRounds, filterFromNextUnfinishedRound, currentRoundIndex, isLocked, lockedRoundsOf, buildRoundLockMap, roundLockKey, STAGE_LABELS, stageBadgeLabel, isPlayed, liveInfo, MODE_LABELS, modeLabel, mixesTournaments } from "./scoring.js";

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

describe("runde-baseret låsning (roundLockKey / buildRoundLockMap / isLocked)", () => {
  afterEach(() => vi.useRealTimers());

  const s1r1 = { season_id: "s1", round_key: "2026-07-14" };

  it("roundLockKey scoper på (season_id, round_key)", () => {
    expect(roundLockKey({ season_id: "s1", round_key: "2026-07-14" }))
      .not.toBe(roundLockKey({ season_id: "s2", round_key: "2026-07-14" }));
    expect(roundLockKey({ season_id: "s1", round_key: "2026-07-14" }))
      .toBe(roundLockKey({ season_id: "s1", round_key: "2026-07-14" }));
  });

  it("buildRoundLockMap finder rundens tidligste kickoff og springer kampe uden kickoff over", () => {
    const map = buildRoundLockMap([
      { ...s1r1, kickoff_at: "2026-07-18T14:00:00Z" },
      { ...s1r1, kickoff_at: "2026-07-15T17:00:00Z" },
      { ...s1r1, kickoff_at: null },
    ]);
    expect(map.get(roundLockKey(s1r1))).toBe(new Date("2026-07-15T17:00:00Z").getTime());
  });

  it("hele runden låser 1 time før rundens FØRSTE kickoff", () => {
    vi.useFakeTimers({ now: new Date("2026-07-15T16:30:00Z") }); // 30 min før første kamp
    const early = { ...s1r1, home_score: null, kickoff_at: "2026-07-15T17:00:00Z" };
    const late = { ...s1r1, home_score: null, kickoff_at: "2026-07-18T14:00:00Z" };
    const map = buildRoundLockMap([early, late]);
    expect(isLocked(early, map)).toBe(true);
    expect(isLocked(late, map)).toBe(true); // låst selvom dens egen kamp er 3 dage ude

    vi.useFakeTimers({ now: new Date("2026-07-15T15:30:00Z") }); // 1½ time før første kamp
    expect(isLocked(early, map)).toBe(false);
    expect(isLocked(late, map)).toBe(false);
  });

  // A16 (1. august 2026): låsen er scopet på (season_id, round_key) og forbliver det.
  // Denne test er invarianten, ikke en detalje: forsøger nogen senere at lade låsen
  // følge KONKURRENCEN i stedet for turneringen, er det her, det slår fejl.
  it("to turneringer i samme round_key låser hver for sig", () => {
    const dk = { season_id: "dk", round_key: "2026-07-13", home_score: null, kickoff_at: "2026-07-15T17:00:00Z" };
    const sco = { season_id: "sco", round_key: "2026-07-13", home_score: null, kickoff_at: "2026-07-18T17:00:00Z" };
    const map = buildRoundLockMap([dk, sco]);
    expect(map.size).toBe(2); // delt round_key må ikke kollapse til én lås-gruppe

    vi.useFakeTimers({ now: new Date("2026-07-15T16:30:00Z") }); // 30 min før DK's første kamp
    expect(isLocked(dk, map)).toBe(true);
    expect(isLocked(sco, map)).toBe(false); // den skotske runde er stadig åben at tippe
  });

  it("kampe med resultat er altid låst, og uden map falder den tilbage til per-kamp", () => {
    vi.useFakeTimers({ now: new Date("2026-07-14T12:00:00Z") });
    expect(isLocked({ ...s1r1, home_score: 1, away_score: 0, kickoff_at: "2026-07-20T12:00:00Z" })).toBe(true);
    expect(isLocked({ ...s1r1, home_score: null, kickoff_at: "2026-07-14T12:30:00Z" })).toBe(true); // 30 min til egen kickoff
    expect(isLocked({ ...s1r1, home_score: null, kickoff_at: "2026-07-14T14:00:00Z" })).toBe(false); // 2 timer til egen kickoff
    expect(isLocked({ ...s1r1, home_score: null, kickoff_at: null })).toBe(false);
  });
});

describe("lockedRoundsOf", () => {
  afterEach(() => vi.useRealTimers());

  const round = (key, matches) => ({ key, label: key, matches });
  const m = (season_id, round_key, kickoff_at, home_score = null) => ({ season_id, round_key, kickoff_at, home_score });

  it("tager låste runder med UDEN at kræve resultater", () => {
    // 30 min før første kickoff: runden er låst, men ingen kamp er spillet.
    // Dette var fejlen — kravet om færdigspillede kampe skjulte hele drill-in'et.
    vi.useFakeTimers({ now: new Date("2026-07-15T16:30:00Z") });
    const r = round("2026-07-13", [m("s1", "2026-07-13", "2026-07-15T17:00:00Z"), m("s1", "2026-07-13", "2026-07-18T14:00:00Z")]);
    const out = lockedRoundsOf([r]);
    expect(out).toHaveLength(1);
    expect(out[0].matches).toHaveLength(2);
  });

  it("udelader runder, der endnu ikke har låst", () => {
    vi.useFakeTimers({ now: new Date("2026-07-15T15:30:00Z") }); // 1½ time før
    const r = round("2026-07-13", [m("s1", "2026-07-13", "2026-07-15T17:00:00Z")]);
    expect(lockedRoundsOf([r])).toEqual([]);
  });

  it("beskærer til de låste kampe, når en runde rummer to turneringer med hver sin lås", () => {
    vi.useFakeTimers({ now: new Date("2026-07-15T16:30:00Z") });
    const laast = m("s1", "2026-07-13", "2026-07-15T17:00:00Z");   // låser 16:00
    const aaben = m("s2", "2026-07-13", "2026-07-19T17:00:00Z");   // egen sæson, låser først 18/7
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

  it("giver det danske navn for hver mode", () => {
    expect(modeLabel("full_season")).toBe("Hel sæson");
    expect(modeLabel("team")).toBe("Et hold");
    expect(modeLabel("time_range")).toBe("Tidsperiode");
    expect(modeLabel("custom")).toBe("Håndplukkede kampe");
    expect(modeLabel("random")).toBe("Tilfældig kupon");
  });

  // en ny mode må aldrig blive til en tom celle i UI'et
  it("falder tilbage til den rå værdi for en ukendt mode", () => {
    expect(modeLabel("knockout")).toBe("knockout");
  });
});

// A16: en blandet konkurrence får én deadline PR. TURNERING, fordi låsen er scopet
// på (season_id, round_key). Advarslen på opret-skærmen er det ene sted, brugeren
// får det at vide, før valget er truffet — derfor testes udløseren, ikke teksten.
describe("mixesTournaments", () => {
  it("full_season blander, når mere end én turnering er valgt", () => {
    expect(mixesTournaments({ mode: "full_season", fullSeasonLeagueIds: ["dk"] })).toBe(false);
    expect(mixesTournaments({ mode: "full_season", fullSeasonLeagueIds: ["dk", "sco"] })).toBe(true);
  });

  it("random og custom ser på hver sin kilde og påvirker ikke hinanden", () => {
    const both = { randomPoolLeagueIds: ["dk", "sco"], pickedLeagueIds: ["dk", "eng"] };
    expect(mixesTournaments({ mode: "random", ...both })).toBe(true);
    expect(mixesTournaments({ mode: "custom", ...both })).toBe(true);
    // custom-udvalget er blandet, men random-puljen er det ikke — kun random spørges
    expect(mixesTournaments({ mode: "random", randomPoolLeagueIds: ["dk", "dk"], pickedLeagueIds: ["dk", "eng"] })).toBe(false);
  });

  it("team og time_range blander aldrig — de er bundet til én turnering", () => {
    const noisy = { fullSeasonLeagueIds: ["dk", "sco"], randomPoolLeagueIds: ["dk", "sco"], pickedLeagueIds: ["dk", "sco"] };
    expect(mixesTournaments({ mode: "team", ...noisy })).toBe(false);
    expect(mixesTournaments({ mode: "time_range", ...noisy })).toBe(false);
  });

  it("tomme og ufuldstændige lister giver falsk frem for at advare i blinde", () => {
    expect(mixesTournaments({ mode: "full_season" })).toBe(false);
    expect(mixesTournaments({ mode: "random", randomPoolLeagueIds: [] })).toBe(false);
    // en kamp uden kendt liga (opslaget nåede ikke med) må ikke tælle som turnering nr. 2
    expect(mixesTournaments({ mode: "custom", pickedLeagueIds: ["dk", undefined, null] })).toBe(false);
  });
});
