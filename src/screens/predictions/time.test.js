// Tests for tip-skærmens tids- og datologik.
//
// Logikken har eksisteret hele tiden, men lå midt i en 705-linjers skærmfil og
// kunne derfor ikke nås. Det er den konkrete gevinst ved opdelingen: ikke færre
// linjer, men noget der før var utestbart og nu ikke er det.
import { describe, it, expect, vi, afterEach } from "vitest";
import { hhmm, dayKey, dayLabel, groupIntoDays, fmtLeft, lockLabel } from "./time.js";

const kamp = (kickoff, id = kickoff) => ({ id, kickoff_at: kickoff });

describe("hhmm", () => {
  it("giver klokkeslættet i dansk format", () => {
    expect(hhmm("2026-07-25T18:30:00Z")).toMatch(/^\d{2}[.:]\d{2}$/);
  });

  it("giver tom streng, når tidspunktet mangler", () => {
    expect(hhmm(null)).toBe("");
    expect(hhmm(undefined)).toBe("");
    expect(hhmm("")).toBe("");
  });

  // Pladsholderen fra datakilden ville ellers stå som et rigtigt klokkeslæt
  // ("02.00" i dansk sommertid) på en kamp, hvis tid slet ikke er fastsat.
  it("giver tom streng, når tiden ikke er fastlagt", () => {
    expect(hhmm("2026-09-13T00:00:00Z", true)).toBe("");
    expect(hhmm("2026-09-13T00:00:00Z", false)).not.toBe("");
  });

  // G85. Den svagere markør gør det MODSATTE af tbd: tiden bliver stående,
  // fordi den er brugbar at planlægge efter, og siger bare at den er
  // leverandørens gæt. Havde den skjult tiden, ville vi have byttet en forkert
  // oplysning ud med ingen oplysning — og det er ikke en forbedring for en
  // bruger, der skal vide, om kampen ligger lørdag formiddag eller aften.
  it("sætter ~ foran, når tiden ikke er bekræftet", () => {
    // `now` skrives ud af samme grund som datoerne selv: horisonten i `G135`
    // regner fra den, og uden et fast ur holdt påstanden op med at passe, når
    // kalenderen indhentede december 2026.
    const nu = Date.parse("2026-11-01T12:00:00Z");
    expect(hhmm("2026-12-12T15:00:00Z", false, true, nu)).toMatch(/^~\d{2}[.:]\d{2}$/);
    expect(hhmm("2026-12-12T15:00:00Z", false, false, nu)).not.toMatch(/~/);
  });

  // G135. Skærmbilledet fra 17. august 2026: tre ægte Premier League-kampe fire
  // dage ude bar `~`, fordi 14:00 UTC både er blackout-slottet og
  // football-data.orgs efterårsgæt. Tilden må ikke stå på en nær kamp.
  it("dropper tilden på en kamp inden for ti dage", () => {
    const nu = Date.parse("2026-08-18T12:00:00Z");
    expect(hhmm("2026-08-22T14:00:00Z", false, true, nu)).toMatch(/^\d{2}[.:]\d{2}$/);
    expect(hhmm("2026-08-22T14:00:00Z", false, true, nu)).not.toMatch(/~/);
  });

  it("lader 'ingen tid' vinde over 'ikke bekræftet'", () => {
    // Bærer en kamp begge markører, er der ikke noget klokkeslæt at sætte et
    // tilde foran. Et "~02.00" ville være det værste af begge udgaver.
    expect(hhmm("2026-09-13T00:00:00Z", true, true)).toBe("");
  });
});

describe("dayKey", () => {
  it("samler to kampe samme dag under samme nøgle", () => {
    expect(dayKey("2026-07-25T13:00:00Z")).toBe(dayKey("2026-07-25T19:00:00Z"));
  });

  it("skiller to kampe på forskellige dage", () => {
    expect(dayKey("2026-07-25T13:00:00Z")).not.toBe(dayKey("2026-07-26T13:00:00Z"));
  });

  it("giver tom streng uden tidspunkt", () => {
    expect(dayKey(null)).toBe("");
  });
});

describe("dayLabel", () => {
  // Danske korte navne ender på punktum ("lør." / "jul."), og de punktummer
  // bliver støjende i en versal overskrift — derfor fjernes de. Datoens
  // ORDENSPUNKTUM ("25.") er derimod korrekt dansk og skal blive stående.
  it("fjerner ugedagens og månedens punktum, men beholder datoens", () => {
    expect(dayLabel("2026-07-25T13:00:00Z")).toBe("lør 25. jul");
  });

  it("fjerner ikke punktummer fra en måned, der ikke har et", () => {
    // maj forkortes ikke på dansk og har derfor intet punktum at fjerne.
    expect(dayLabel("2026-05-04T13:00:00Z")).toBe("man 4. maj");
  });
});

describe("groupIntoDays", () => {
  it("samler kampe pr. dag i den rækkefølge, de kommer", () => {
    const dage = groupIntoDays([
      kamp("2026-07-25T13:00:00Z"),
      kamp("2026-07-25T19:00:00Z"),
      kamp("2026-07-26T15:00:00Z"),
    ]);
    expect(dage).toHaveLength(2);
    expect(dage[0].matches).toHaveLength(2);
    expect(dage[1].matches).toHaveLength(1);
  });

  // Kampe uden fastlagt tidspunkt må ikke forsvinde — og de skal stå sidst,
  // så en runde ikke åbner med "Tid ikke fastlagt".
  it("lægger kampe uden kickoff sidst med en forklarende overskrift", () => {
    const dage = groupIntoDays([
      kamp(null, "ukendt"),
      kamp("2026-07-25T13:00:00Z"),
    ]);
    expect(dage).toHaveLength(2);
    expect(dage[dage.length - 1].label).toBe("Tid ikke fastlagt");
    expect(dage[dage.length - 1].matches[0].id).toBe("ukendt");
  });

  it("giver en tom liste for ingen kampe", () => {
    expect(groupIntoDays([])).toEqual([]);
  });

  // En kamp med ukendt klokkeslæt har stadig en kendt DATO og skal blive i sin
  // rigtige dag. Det er kun overskriften, der bærer forbeholdet — rækkerne har
  // ikke plads til det i tidskolonnen.
  it("markerer en dag, hvor ingen kampe har fastlagt tid", () => {
    const tbd = (kickoff, id) => ({ id, kickoff_at: kickoff, kickoff_tbd: true });
    const dage = groupIntoDays([
      tbd("2026-09-13T00:00:00Z", "a"),
      tbd("2026-09-13T00:00:00Z", "b"),
    ]);
    expect(dage).toHaveLength(1);
    expect(dage[0].matches).toHaveLength(2);
    expect(dage[0].label).toMatch(/· Tid ikke fastlagt$/);
    expect(dage[0].label).not.toBe("Tid ikke fastlagt"); // dagen står stadig først
  });

  // Hele pointen med tiebreakeren: en dag uden fastlagte tider har ét og samme
  // tidsstempel på alle kampe, så uden holdnavnene ville rækkefølgen være den,
  // databasen tilfældigvis returnerede — og den kan skifte mellem to visninger.
  it("sorterer dagens kampe på holdnavn, når de deler tidsstempel", () => {
    const t = "2026-09-13T00:00:00Z";
    const navne = { s: "Silkeborg IF", n: "Nordsjælland", f: "FC København", l: "Lyngby Boldklub" };
    const kampe = [
      { id: "s", kickoff_at: t, kickoff_tbd: true, home_team_id: "s", away_team_id: "n" },
      { id: "l", kickoff_at: t, kickoff_tbd: true, home_team_id: "l", away_team_id: "f" },
      { id: "f", kickoff_at: t, kickoff_tbd: true, home_team_id: "f", away_team_id: "s" },
    ];
    const orden = () => groupIntoDays(kampe.slice(), (id) => navne[id])[0].matches.map((m) => m.id);
    expect(orden()).toEqual(["f", "l", "s"]); // FC København, Lyngby, Silkeborg
    // Samme svar uanset hvilken rækkefølge kampene kom ind i.
    kampe.reverse();
    expect(orden()).toEqual(["f", "l", "s"]);
  });

  it("markerer ikke en dag, hvor bare én kamp har et rigtigt tidspunkt", () => {
    const dage = groupIntoDays([
      { id: "a", kickoff_at: "2026-09-13T00:00:00Z", kickoff_tbd: true },
      { id: "b", kickoff_at: "2026-09-13T14:00:00Z", kickoff_tbd: false },
    ]);
    expect(dage).toHaveLength(1);
    expect(dage[0].label).not.toMatch(/Tid ikke fastlagt/);
  });

  // G85. Tegnforklaringen skal med, så snart der står ét `~` på dagen — modsat
  // "Tid ikke fastlagt", som kun sættes, når HELE dagen mangler tid. Forskellen
  // er, at en tom tidskolonne forklarer sig selv, mens et tegn ikke gør.
  it("forklarer tilden, også når kun én kamp på dagen er ubekræftet", () => {
    const dage = groupIntoDays([
      { id: "a", kickoff_at: "2026-12-12T15:00:00Z", kickoff_tbd: false, kickoff_uncertain: true },
      { id: "b", kickoff_at: "2026-12-12T17:00:00Z", kickoff_tbd: false, kickoff_uncertain: false },
    ], undefined, Date.parse("2026-11-01T12:00:00Z"));
    expect(dage).toHaveLength(1);
    expect(dage[0].label).toMatch(/~ = tid ikke bekræftet/);
  });

  // G135. Tegnforklaringen og tegnet må ikke kunne komme i utakt: er dagen inde
  // under horisonten, står der ingen tilder i rækkerne, og en overskrift, der
  // alligevel forklarede dem, ville sende brugeren ud at lede efter et tegn,
  // der ikke er der.
  it("nævner ikke tilden, når dagen ligger inden for horisonten", () => {
    const dage = groupIntoDays([
      { id: "a", kickoff_at: "2026-08-22T14:00:00Z", kickoff_tbd: false, kickoff_uncertain: true },
      { id: "b", kickoff_at: "2026-08-22T16:30:00Z", kickoff_tbd: false, kickoff_uncertain: false },
    ], undefined, Date.parse("2026-08-18T12:00:00Z"));
    expect(dage).toHaveLength(1);
    expect(dage[0].label).not.toMatch(/bekræftet/);
  });

  it("nævner ikke tilden på en dag helt uden ubekræftede tider", () => {
    const dage = groupIntoDays([
      { id: "a", kickoff_at: "2026-12-12T15:00:00Z", kickoff_tbd: false, kickoff_uncertain: false },
    ]);
    expect(dage[0].label).not.toMatch(/bekræftet/);
  });

  // Bærer alle dagens kampe begge markører, er "Tid ikke fastlagt" det rigtige
  // svar: rækkerne viser ingen tid, så der er ingen tilde at forklare.
  it("siger 'Tid ikke fastlagt' frem for tegnforklaringen, når begge markører står", () => {
    const dage = groupIntoDays([
      { id: "a", kickoff_at: "2026-09-13T00:00:00Z", kickoff_tbd: true, kickoff_uncertain: true },
      { id: "b", kickoff_at: "2026-09-13T00:00:00Z", kickoff_tbd: true, kickoff_uncertain: true },
    ]);
    expect(dage[0].label).toMatch(/Tid ikke fastlagt/);
    expect(dage[0].label).not.toMatch(/~/);
  });

  it("taber ingen kampe", () => {
    const kampe = [
      kamp("2026-07-25T13:00:00Z", "a"),
      kamp(null, "b"),
      kamp("2026-07-26T15:00:00Z", "c"),
      kamp("2026-07-25T19:00:00Z", "d"),
    ];
    const ud = groupIntoDays(kampe).flatMap((d) => d.matches.map((m) => m.id));
    expect(ud.sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("fmtLeft", () => {
  it("skriver timer og minutter, når der er over en time", () => {
    expect(fmtLeft(3 * 3600000 + 12 * 60000)).toBe("3 t 12 min");
  });

  it("skriver kun minutter under en time", () => {
    expect(fmtLeft(12 * 60000)).toBe("12 min");
    expect(fmtLeft(0)).toBe("0 min");
  });
});

describe("lockLabel", () => {
  afterEach(() => vi.useRealTimers());

  const frys = (iso) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  };

  it("er null, når deadline er passeret", () => {
    frys("2026-07-25T12:00:00Z");
    expect(lockLabel(new Date("2026-07-25T11:00:00Z").getTime())).toBeNull();
  });

  it("tæller ned, når der er under et døgn til", () => {
    frys("2026-07-25T12:00:00Z");
    expect(lockLabel(new Date("2026-07-25T15:30:00Z").getTime())).toBe("Låser om 3 t 30 min");
  });

  // Over et døgn ude giver en nedtælling i minutter ingen mening — så vises
  // det absolutte tidspunkt i stedet.
  it("viser absolut tidspunkt, når der er mere end et døgn til", () => {
    frys("2026-07-25T12:00:00Z");
    const label = lockLabel(new Date("2026-07-28T12:00:00Z").getTime());
    expect(label).not.toContain("om ");
    expect(label.startsWith("Låser ")).toBe(true);
  });

  it("kan få et andet præfiks end 'Låser'", () => {
    frys("2026-07-25T12:00:00Z");
    expect(lockLabel(new Date("2026-07-25T13:00:00Z").getTime(), "Deadline")).toBe(
      "Deadline om 1 t 0 min"
    );
  });

  // Grænsetilfældet: præcis 24 timer skal stadig være en nedtælling.
  it("regner præcis et døgn som nedtælling", () => {
    frys("2026-07-25T12:00:00Z");
    expect(lockLabel(new Date("2026-07-26T12:00:00Z").getTime())).toContain("om ");
  });
});
