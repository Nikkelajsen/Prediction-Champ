import { describe, it, expect, vi, afterEach } from "vitest";
import { currentRoundKey, roundKeyOfDate, nextRoundKey, outcome, POINTS, pointsFor, roundLabel, zonedDateKey, byKickoffThenTeams, groupIntoRounds, currentRoundIndex, formatKickoff, isLocked, filterTippable, wasTippableAt, filterFromRoundStart, lockAtOf, lockedRoundsOf, nextRoundTips, STAGE_LABELS, stageBadgeLabel, isPlayed, liveInfo, MODE_LABELS, modeLabel } from "./scoring.js";

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
    expect(pointsFor({ pred_home: 2, pred_away: 1 }, match)).toBe(3);
  });

  it("giver +1 for korrekt udfald med forkert resultat", () => {
    expect(pointsFor({ pred_home: 3, pred_away: 0 }, match)).toBe(1);
  });

  it("giver 0 for forkert udfald — aldrig minuspoint", () => {
    expect(pointsFor({ pred_home: 0, pred_away: 0 }, match)).toBe(0);
    expect(pointsFor({ pred_home: 0, pred_away: 2 }, match)).toBe(0);
  });

  it("giver null uden forudsigelse eller uden resultat", () => {
    expect(pointsFor(null, match)).toBeNull();
    expect(pointsFor({ pred_home: null, pred_away: 1 }, match)).toBeNull();
    expect(pointsFor({ pred_home: 2, pred_away: 1 }, { home_score: null, away_score: null })).toBeNull();
  });

  // De to tests, der stod her, hed "respekterer konkurrencens egne pointregler"
  // og "falder tilbage til +3/+1 for ældre konkurrencer uden rules-felt". Begge
  // beskrev en konfigurerbarhed, der aldrig har eksisteret uden for denne
  // funktion — databasen har hardkodet 3/1 hele vejen (F2) — og de holdt derfor
  // et argument i live, som ingen kaldte med andet end 3/1 (G3, august 2026).
  // Tilbage står dét, de reelt beskyttede: at tallene er dem, de skal være, og
  // at de kan læses ét sted af den, der farvelægger efter dem.
  it("bruger de faste point 3/1 — der er ikke noget at konfigurere", () => {
    expect(POINTS).toEqual({ exact: 3, outcome: 1 });
    expect(pointsFor({ pred_home: 2, pred_away: 1 }, match)).toBe(POINTS.exact);
    expect(pointsFor({ pred_home: 1, pred_away: 0 }, match)).toBe(POINTS.outcome);
  });

  it("håndterer 0-0 korrekt (0 er ikke 'manglende gæt')", () => {
    expect(pointsFor({ pred_home: 0, pred_away: 0 }, { home_score: 0, away_score: 0 })).toBe(3);
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

describe("filterTippable", () => {
  // Afløste RUNDE-reglen `filterFromNextUnfinishedRound` i august 2026. Den gamle
  // regel holdt sit løfte for hele runder og brød det inde i én: en konkurrence
  // oprettet MIDT i en runde fik rundens spillede kampe med, og da `predictions`
  // deles på tværs af konkurrencer, havde den, der havde tippet dem andetsteds,
  // point fra første sekund. Testene her er de gamle plus det, de ikke fangede.
  const om = (min) => new Date(Date.now() + min * 60000).toISOString();
  const siden = (min) => new Date(Date.now() - min * 60000).toISOString();
  const spillet = (key) => ({ round_key: key, kickoff_at: siden(3000), home_score: 1, away_score: 0 });
  const kommende = (key) => ({ round_key: key, kickoff_at: om(3000), home_score: null, away_score: null });

  it("udelader allerede afsluttede runder (nye konkurrencer starter fra 0)", () => {
    const ud = filterTippable([
      spillet("2026-07-07"), spillet("2026-07-07"),
      kommende("2026-07-14"), kommende("2026-07-21"),
    ]);
    expect(ud.map((m) => m.round_key)).toEqual(["2026-07-14", "2026-07-21"]);
  });

  // DET, RUNDE-REGLEN IKKE KUNNE. Den beholdt hele den delvist spillede runde,
  // altså også dens spillede kampe — præcis den fejl, den fandtes for at undgå.
  it("beholder KUN den delvist spillede rundes resterende kampe", () => {
    const ud = filterTippable([spillet("2026-07-07"), kommende("2026-07-07")]);
    expect(ud).toHaveLength(1);
    expect(ud[0].home_score).toBeNull();
  });

  it("giver tom liste når hele sæsonen er spillet", () => {
    expect(filterTippable([spillet("2026-07-07")])).toEqual([]);
  });

  // `wasTippableAt` er søsterreglen (`A53`): samme spørgsmål, men stillet om et
  // GIVET tidspunkt frem for om nu, og om en ny DELTAGER frem for en ny
  // konkurrence. Kunne kampen stadig tippes, da hun meldte sig til?
  describe("wasTippableAt — deltagerens nulpunkt", () => {
    const KAMP = { kickoff_at: "2026-07-06T18:00:00Z", kickoff_tbd: false };
    const ms = (iso) => Date.parse(iso);

    it("tæller kampen med, når man meldte sig til før låsen", () => {
      expect(wasTippableAt(KAMP, ms("2026-07-06T16:59:00Z"))).toBe(true);
    });

    it("tæller den IKKE med, når man meldte sig til efter låsen", () => {
      expect(wasTippableAt(KAMP, ms("2026-07-06T17:30:00Z"))).toBe(false);
    });

    // Grænsen ligger ved låsen (1 time før kickoff), ikke ved kickoff. Ét minut
    // galt her er forskellen på at tage en hel runde med eller lade den ligge.
    it("lægger grænsen præcis ved låsen og ikke ved kickoff", () => {
      expect(wasTippableAt(KAMP, ms("2026-07-06T16:59:59Z"))).toBe(true);
      expect(wasTippableAt(KAMP, ms("2026-07-06T17:00:00Z"))).toBe(false);
    });

    // Uden fastlagt klokkeslæt er låsen midnat på spilledagen i DANSK tid —
    // samme svar som `public.match_lock_at()`, der håndhæver den i RLS.
    it("bruger midnat dansk tid for en kamp uden fastlagt klokkeslæt", () => {
      const tbd = { kickoff_at: "2026-07-06T18:00:00Z", kickoff_tbd: true };
      expect(wasTippableAt(tbd, ms("2026-07-05T21:00:00Z"))).toBe(true);  // før midnat DK
      expect(wasTippableAt(tbd, ms("2026-07-05T23:00:00Z"))).toBe(false); // efter midnat DK
    });

    // Begge bagstoppere svarer "tæl med". En manglende oplysning må aldrig
    // kunne nulstille en spillers point.
    it("tæller med, når tilmeldingstidspunktet er ukendt", () => {
      expect(wasTippableAt(KAMP, NaN)).toBe(true);
      expect(wasTippableAt(KAMP, undefined)).toBe(true);
    });

    it("tæller med, når kampen ikke har noget kendt kickoff", () => {
      expect(wasTippableAt({ kickoff_at: null }, ms("2026-07-06T17:30:00Z"))).toBe(true);
    });
  });

  // Låst, ikke "har resultat": en kamp, der er fløjtet i gang, kan heller ikke
  // tippes, og en kamp, ingen kan gætte på, hører ikke til i en ny konkurrence.
  it("udelader en kamp, der er i gang eller låser inden for timen", () => {
    const ud = filterTippable([
      { id: "igang", kickoff_at: siden(30) },
      { id: "snart", kickoff_at: om(20) },
      { id: "aaben", kickoff_at: om(180) },
    ]);
    expect(ud.map((m) => m.id)).toEqual(["aaben"]);
  });

  // En kamp uden kendt kickoff er ikke låst — samme svar som RLS-policyens
  // skrivegren, og den rigtige vej at tage fejl.
  it("beholder en kamp uden kendt kickoff", () => {
    expect(filterTippable([{ id: "ukendt", kickoff_at: null }]).map((m) => m.id)).toEqual(["ukendt"]);
  });

  it("tåler tom og manglende liste", () => {
    expect(filterTippable([])).toEqual([]);
    expect(filterTippable(null)).toEqual([]);
  });
});

describe("filterFromRoundStart", () => {
  const pool = [
    { id: "a1", round_key: "2026-08-04" },
    { id: "b1", round_key: "2026-08-11" },
    { id: "c1", round_key: "2026-08-18" },
  ];

  it("lader puljen være i fred, når der startes i indeværende runde", () => {
    expect(filterFromRoundStart(pool, { start: "current", currentKey: "2026-08-04" })).toEqual(pool);
  });

  it("smider indeværende runde væk, når der startes i en ny", () => {
    expect(filterFromRoundStart(pool, { start: "next", currentKey: "2026-08-04" }).map((m) => m.id))
      .toEqual(["b1", "c1"]);
  });

  // Er indeværende runde allerede væk af sig selv (alt spillet), giver de to
  // valg samme pulje — og det er den rigtige adfærd, ikke en tom liste.
  it("er uskadelig, når puljen allerede er forbi indeværende runde", () => {
    const senere = pool.slice(1);
    expect(filterFromRoundStart(senere, { start: "next", currentKey: "2026-08-04" })).toEqual(senere);
  });

  it("uden rundenøgle filtreres der ikke — et gæt ville være værre end intet", () => {
    expect(filterFromRoundStart(pool, { start: "next", currentKey: "" })).toEqual(pool);
    expect(filterFromRoundStart(null, {})).toEqual([]);
  });
});

// G32: alt, brugeren ser af tid, står i DANSK tid — også når enheden ikke gør.
// CI kører UTC, så en manglende `timeZone` ville give 18.00 i stedet for 20.00
// og dermed fejle her; det er præcis den fejl, en dansk udvikler på en dansk
// maskine aldrig ville se.
describe("visningen står i dansk tid, ikke enhedens", () => {
  it("formatKickoff viser dansk klokkeslæt", () => {
    expect(formatKickoff("2026-08-10T18:00:00Z")).toBe("man. 10.08 kl. 20.00");
    expect(formatKickoff("2026-12-05T18:00:00Z")).toBe("lør. 05.12 kl. 19.00"); // vintertid
  });

  it("formatKickoff udelader klokkeslættet for en kamp uden fastlagt tid", () => {
    expect(formatKickoff("2026-08-10T22:30:00Z", true)).toBe("tirs. 11.08");
  });

  // Rundens etiket forankres på middag UTC og ikke middag lokalt: en enhed
  // langt vest for Danmark ville ellers få en dato, der er dansk næste dag.
  it("roundLabel giver samme interval uanset enhedens zone", () => {
    expect(roundLabel("2026-08-04")).toBe("04.08 – 10.08");
  });

  it("zonedDateKey giver den danske kalenderdato", () => {
    expect(zonedDateKey("2026-08-10T22:30:00Z")).toBe("2026-08-11"); // 00.30 dansk
    expect(zonedDateKey("2026-08-10T21:30:00Z")).toBe("2026-08-10"); // 23.30 dansk
    expect(zonedDateKey(null)).toBe("");
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

  // Tid ikke fastlagt: kickoff_at bærer kun en dato, og "1 time før kickoff" er
  // derfor ikke et rigtigt tidspunkt. Låsen bliver midnat på spilledagen.
  //
  // Testene stod indtil G32 som EGENSKABER ("time 0, minut 0") og ikke som et
  // tidsstempel, netop fordi låsen fulgte ENHEDENS tidszone og et fast ms-tal
  // ville have målt maskinen. Det er ikke længere sandt: låsen er dansk midnat
  // — samme regel som `public.match_lock_at()`, der håndhæver den i RLS — og
  // dermed ét bestemt øjeblik, uanset hvor telefonen står. At testen nu KAN
  // skrives som et tidsstempel, er hele forskellen.
  it("en kamp uden fastlagt tid låser ved DANSK midnat på spilledagen (sommertid)", () => {
    const lockAt = lockAtOf({ kickoff_at: "2026-09-13T00:00:00Z", kickoff_tbd: true });
    expect(lockAt).toBe(Date.parse("2026-09-12T22:00:00Z")); // midnat 13. sep. dansk = 22:00 UTC den 12.
  });

  // Vintertid: dansk midnat er 23:00 UTC dagen før. Offsettet aflæses og er
  // ikke hårdkodet, ellers ville låsen flytte sig en time to gange om året.
  it("følger sommertid/vintertid frem for et fast offset", () => {
    expect(lockAtOf({ kickoff_at: "2026-12-05T12:00:00Z", kickoff_tbd: true }))
      .toBe(Date.parse("2026-12-04T23:00:00Z"));
  });

  // Timerne lige efter midnat dansk tid er dem, hvor UTC-datoen og den danske
  // dato er forskellige — og hvor en naiv udregning rammer dagen før.
  it("bruger den danske dag og ikke UTC-dagen", () => {
    expect(lockAtOf({ kickoff_at: "2026-09-12T23:30:00Z", kickoff_tbd: true }))
      .toBe(Date.parse("2026-09-12T22:00:00Z")); // dansk 13. sep. kl. 01.30 → midnat samme danske dag
  });

  it("kickoff_tbd ændrer intet for en kamp med rigtigt klokkeslæt", () => {
    const kickoff = "2026-09-13T14:00:00Z";
    expect(lockAtOf({ kickoff_at: kickoff, kickoff_tbd: false }))
      .toBe(new Date("2026-09-13T13:00:00Z").getTime());
    // Feltet mangler helt på gamle rækker og skal opføre sig som false.
    expect(lockAtOf({ kickoff_at: kickoff })).toBe(new Date("2026-09-13T13:00:00Z").getTime());
  });

  it("en TBD-kamp er åben dagen før og låst på selve spilledagen", () => {
    const m = { ...r1, home_score: null, kickoff_at: "2026-09-13T00:00:00Z", kickoff_tbd: true };

    vi.useFakeTimers({ now: new Date("2026-09-11T12:00:00Z") });
    expect(isLocked(m)).toBe(false);

    vi.useFakeTimers({ now: new Date("2026-09-13T12:00:00Z") });
    expect(isLocked(m)).toBe(true);
  });
});

describe("byKickoffThenTeams", () => {
  const navne = { a: "AGF", b: "Brøndby IF", s: "Silkeborg IF", aa: "Aalborg BK" };
  const kamp = (id, kickoff, home, away) => ({ id, kickoff_at: kickoff, home_team_id: home, away_team_id: away });

  it("sorterer på kickoff først", () => {
    const ud = [kamp("sen", "2026-09-13T18:00:00Z", "a", "b"), kamp("tidlig", "2026-09-13T14:00:00Z", "s", "aa")]
      .sort(byKickoffThenTeams((id) => navne[id]));
    expect(ud.map((m) => m.id)).toEqual(["tidlig", "sen"]);
  });

  // Kernen: en hel runde deler tidsstempel, når klokkeslættet ikke er fastlagt.
  // Uden tiebreaker efterlader `order=kickoff_at` den rest udefineret, og listen
  // kunne skifte orden mellem to visninger af samme runde.
  it("falder tilbage på hjemmeholdets navn ved samme kickoff", () => {
    const t = "2026-09-13T00:00:00Z";
    const ud = [kamp("s", t, "s", "a"), kamp("a", t, "a", "b"), kamp("b", t, "b", "s")]
      .sort(byKickoffThenTeams((id) => navne[id]));
    expect(ud.map((m) => m.id)).toEqual(["a", "b", "s"]); // AGF, Brøndby, Silkeborg
  });

  it("bruger udeholdet, når hjemmeholdet er det samme", () => {
    const t = "2026-09-13T00:00:00Z";
    const ud = [kamp("mod-s", t, "a", "s"), kamp("mod-b", t, "a", "b")]
      .sort(byKickoffThenTeams((id) => navne[id]));
    expect(ud.map((m) => m.id)).toEqual(["mod-b", "mod-s"]);
  });

  // Dansk sortering, ikke maskinens: "Aa" alfabetiseres som "Å" og lander derfor
  // EFTER Z — det er Dansk Sprognævns regel, og den er grunden til at `"da"`
  // står i localeCompare. Under standard-collation ville Aalborg stå først, og
  // Brøndby ville lande mellem to b-navne i stedet for efter dem.
  it("sorterer efter dansk alfabet: Aa som Å, altså sidst", () => {
    const t = "2026-09-13T00:00:00Z";
    const ud = [kamp("aalborg", t, "aa", "a"), kamp("broendby", t, "b", "a"), kamp("agf", t, "a", "s")]
      .sort(byKickoffThenTeams((id) => navne[id]));
    expect(ud.map((m) => m.id)).toEqual(["agf", "broendby", "aalborg"]);
  });

  // Navnene hentes efter kampene, så der findes et render, hvor de mangler.
  // Rækkefølgen skal stadig være den samme hver gang — bare på id i stedet.
  it("er stabil uden holdnavne", () => {
    const t = "2026-09-13T00:00:00Z";
    const kampe = [kamp("x", t, "s", "a"), kamp("y", t, "a", "b")];
    const en = kampe.slice().sort(byKickoffThenTeams(undefined)).map((m) => m.id);
    const to = kampe.slice().reverse().sort(byKickoffThenTeams(undefined)).map((m) => m.id);
    expect(en).toEqual(to);
  });
});

describe("formatKickoff", () => {
  it("udelader klokkeslættet, når tiden ikke er fastlagt", () => {
    const iso = "2026-09-13T00:00:00Z";
    expect(formatKickoff(iso)).toContain(" kl. ");
    expect(formatKickoff(iso, true)).not.toContain("kl.");
    // Datoen bliver stående — den ER kendt; det er kun tiden, der mangler.
    expect(formatKickoff(iso, true)).toBe(formatKickoff(iso).split(" kl. ")[0]);
  });

  it("giver tom streng uden kickoff, uanset flaget", () => {
    expect(formatKickoff(null)).toBe("");
    expect(formatKickoff(null, true)).toBe("");
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
    expect(pointsFor({ pred_home: 2, pred_away: 1 }, live)).toBeNull();
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


// ---------------------------------------------------------------------------
// Rundenøglen på klienten (Story Engine v2's karrusel)
// ---------------------------------------------------------------------------
describe("roundKeyOfDate / currentRoundKey", () => {
  // Runden løber tirsdag→mandag, og nøglen er tirsdagens dato. Fjerde spejling
  // af public.round_key() — reglen skal give samme svar i SQL og i klienten,
  // ellers filtrerer karusellen på en anden uge end den, motoren skrev.
  it("ruller tilbage til rundens tirsdag", () => {
    expect(roundKeyOfDate("2026-03-03")).toBe("2026-03-03"); // tirsdag → sig selv
    expect(roundKeyOfDate("2026-03-04")).toBe("2026-03-03"); // onsdag
    expect(roundKeyOfDate("2026-03-08")).toBe("2026-03-03"); // søndag
    expect(roundKeyOfDate("2026-03-09")).toBe("2026-03-03"); // mandag — stadig samme runde
    expect(roundKeyOfDate("2026-03-10")).toBe("2026-03-10"); // ny tirsdag → ny runde
  });

  it("krydser måneds- og årsskifte", () => {
    expect(roundKeyOfDate("2026-01-01")).toBe("2025-12-30");
    expect(roundKeyOfDate("2026-03-01")).toBe("2026-02-24");
  });

  it("giver tom streng for ugyldigt input frem for at kaste", () => {
    expect(roundKeyOfDate("")).toBe("");
    expect(roundKeyOfDate("ikke-en-dato")).toBe("");
  });

  // Nøglen skal følge den DANSKE dag. En enhed i en anden zone må ikke få en
  // anden runde — det ville vise en tom karrusel for en rejsende bruger.
  it("aflæser dagen i dansk tid", () => {
    // 2026-03-09 23.30 dansk = 22.30 UTC → stadig mandag, altså rundens
    // sidste dag og ikke den næste runde.
    expect(currentRoundKey(new Date("2026-03-09T22:30:00Z"))).toBe("2026-03-03");
    // 2026-03-09 23.30 UTC = 00.30 dansk tirsdag → NY runde.
    expect(currentRoundKey(new Date("2026-03-09T23:30:00Z"))).toBe("2026-03-10");
  });
});

describe("nextRoundKey", () => {
  // Runder er ugentlige og forankret på tirsdagen, så "runden efter" er nøglen
  // plus syv dage — samme regning som SQL'ens `s.round_key::date + 7`.
  it("lægger præcis én uge til", () => {
    expect(nextRoundKey("2026-03-03")).toBe("2026-03-10");
    expect(nextRoundKey("2026-03-10")).toBe("2026-03-17");
  });

  it("krydser måneds- og årsskifte", () => {
    expect(nextRoundKey("2026-12-29")).toBe("2027-01-05");
    expect(nextRoundKey("2026-02-24")).toBe("2026-03-03");
  });

  // Sommertid må ikke kunne flytte datoen: nøglen er en dansk kalenderdato, og
  // ugen 2026-03-24 → 2026-03-31 ligger hen over det danske sommertidsskifte.
  it("holder datoen hen over sommertidsskiftet", () => {
    expect(nextRoundKey("2026-03-24")).toBe("2026-03-31");
    expect(nextRoundKey("2026-10-20")).toBe("2026-10-27");
  });

  it("giver tom streng for ugyldigt input frem for at kaste", () => {
    expect(nextRoundKey("")).toBe("");
    expect(nextRoundKey("ikke-en-dato")).toBe("");
  });
});

describe("nextRoundTips", () => {
  // Langt ude i fremtiden, så ingen kamp er låst, uanset hvornår testen køres.
  const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
  const m = (id, roundKey, days, extra = {}) =>
    ({ id, round_key: roundKey, kickoff_at: iso(days), home_score: null, away_score: null, ...extra });
  const tip = (...ids) => new Map(ids.map((id) => [id, { match_id: id, pred_home: 1, pred_away: 0 }]));

  it("vælger den TIDLIGSTE runde med tipbare kampe", () => {
    const next = nextRoundTips([m("a", "2099-01-12", 37), m("b", "2099-01-05", 30)], new Map());
    expect(next.roundKey).toBe("2099-01-05");
    expect(next.matches.map((x) => x.id)).toEqual(["b"]);
  });

  it("melder først 'alt tippet', når HELE runden er tippet", () => {
    const ms = [m("a", "2099-01-05", 30), m("b", "2099-01-05", 31), m("c", "2099-01-12", 37)];
    expect(nextRoundTips(ms, tip("a")).allTipped).toBe(false);
    // En senere runde må ikke trække den ned — den bliver "næste runde" i tur.
    expect(nextRoundTips(ms, tip("a", "b")).allTipped).toBe(true);
  });

  it("regner et halvt tip som intet tip", () => {
    const ms = [m("a", "2099-01-05", 30)];
    const halvt = new Map([["a", { match_id: "a", pred_home: 1, pred_away: null }]]);
    expect(nextRoundTips(ms, halvt).allTipped).toBe(false);
  });

  it("ser bort fra spillede og låste kampe", () => {
    // Spillet: har resultat. Låst: kickoff er passeret.
    const ms = [
      m("spillet", "2099-01-05", 30, { home_score: 1, away_score: 1 }),
      m("laast", "2099-01-05", -1),
      m("aaben", "2099-01-12", 37),
    ];
    const next = nextRoundTips(ms, new Map());
    expect(next.roundKey).toBe("2099-01-12");
    expect(next.matches.map((x) => x.id)).toEqual(["aaben"]);
  });

  it("svarer null, når der intet er at tippe", () => {
    // Skal kunne skelnes fra 'alt tippet' — ellers får en bruger med nul tips
    // at vide, at alting er inde.
    expect(nextRoundTips([m("a", "2099-01-05", 30, { home_score: 0, away_score: 0 })], new Map())).toBeNull();
    expect(nextRoundTips([], new Map())).toBeNull();
  });

  it("springer en kamp uden kendt kickoff over", () => {
    expect(nextRoundTips([m("a", "2099-01-05", 30, { kickoff_at: null })], new Map())).toBeNull();
  });
});
