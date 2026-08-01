// Tests for api/sync-matches.js.
//
// Handleren selv kræver en database og et request-objekt og testes ikke her.
// Det, der testes, er den ene REGEL, der afgør, om en fejlet sæsonhentning
// tæller som en fejlet kørsel — samme mønster som `finishedRoundKeys()` i
// send-notifications: reglen trækkes ud som ren funktion, netop fordi den skal
// være svær at ændre ved et uheld.
//
// Hvorfor den er værd at fastholde: en for bred tolerance gør en forkert
// api_season_id usynlig (jobbet står grønt, mens turneringen aldrig henter en
// eneste kamp), og en for smal gør Champions League rød i seks uger for noget
// forventeligt. Begge fejl ender samme sted — at ingen kigger på driftsloggen.
import { describe, it, expect } from "vitest";
import { seasonFetchVerdict, ambiguousTeamNames, normalizeTeamName } from "./sync-matches.js";

const fejl = new Error("football-data.org: 404 {\"message\":\"The resource you are looking for does not exist.\"}");

describe("seasonFetchVerdict", () => {
  it("tolererer en sæson, leverandøren endnu ikke har oprettet", () => {
    // Champions League indtil lodtrækningen. Retter sig selv.
    const v = seasonFetchVerdict(fejl, {
      code: "season-not-published",
      message: "football-data.org har endnu ikke oprettet sæsonen 2026 (aktuel sæson er 2025).",
    });
    expect(v.tolerated).toBe(true);
  });

  it("tolererer IKKE et forkert api_season_id", () => {
    // Den, der ikke retter sig selv, skal blive ved med at være rød.
    const v = seasonFetchVerdict(fejl, {
      code: "season-unknown",
      message: "Sæsonen 2019 kendes ikke af football-data.org. Ret api_season_id på sæson-rækken.",
    });
    expect(v.tolerated).toBe(false);
    expect(v.message).toMatch(/api_season_id/);
  });

  it.each(["season-empty", "undetermined", "lookup-failed"])(
    "tolererer ikke '%s' — kun den ene kode slipper igennem",
    (code) => {
      expect(seasonFetchVerdict(fejl, { code, message: "…" }).tolerated).toBe(false);
    }
  );

  it("bærer den rå fejl videre, når der ingen diagnose er", () => {
    // Sportmonks har ingen describeEmptySeason. Fejlen må ikke forsvinde.
    const v = seasonFetchVerdict(fejl, null);
    expect(v.tolerated).toBe(false);
    expect(v.message).toBe(fejl.message);
    expect(v.message).not.toMatch(/—/);
  });

  it("sætter diagnosen EFTER den rå fejl, så begge kan læses", () => {
    // Rækkefølgen er ikke ligegyldig: statuskoden er det, man søger efter i
    // logs, og forklaringen er det, man handler på.
    const v = seasonFetchVerdict(fejl, { code: "season-unknown", message: "Ret api_season_id." });
    expect(v.message).toBe(`${fejl.message} — Ret api_season_id.`);
  });
});

// Holdnavne, den fuzzy match ikke kan skelne.
//
// `B2` bad om, at Scotland Premiership' hold blev kontrolleret for dubletter
// efter første sync, og indbakken bad om den samme kontrol for Champions League
// efter lodtrækningen. Begge er engangs-tjek, et menneske skal huske på det
// rigtige tidspunkt — her er de i stedet en permanent del af hver kørsel.
describe("ambiguousTeamNames", () => {
  const hold = (...navne) => navne.map((name) => ({ name }));

  it("finder ingenting i en liga med entydige navne", () => {
    expect(ambiguousTeamNames(hold("Celtic", "Aberdeen", "Hibernian"))).toEqual([]);
  });

  // Den ægte skotske fælde: findByName() falder tilbage til en delstrengs-match,
  // så et nyt "Rangers" kan blive knyttet til "Queen's Park Rangers"' række.
  it("fanger et navn, der ligger inde i et andet", () => {
    const ud = ambiguousTeamNames(hold("Rangers", "Queen's Park Rangers"));
    expect(ud).toHaveLength(1);
    expect(ud[0].teams).toEqual(["Rangers", "Queen's Park Rangers"]);
  });

  // To rækker for samme klub — det, dubletkontrollen hed i drejebogen.
  it("fanger to rækker, der normaliserer til det samme", () => {
    const ud = ambiguousTeamNames(hold("Celtic FC", "Celtic F.C."));
    expect(ud).toHaveLength(1);
    expect(ud[0].why).toBe("identiske navne");
  });

  it("tåler tomme og manglende navne", () => {
    expect(ambiguousTeamNames([])).toEqual([]);
    expect(ambiguousTeamNames(undefined)).toEqual([]);
    expect(ambiguousTeamNames([{ name: null }, { name: "" }, { name: "Celtic" }])).toEqual([]);
  });
});

describe("normalizeTeamName", () => {
  // Skal være ORD for ord den samme som findByName()'s egen normalisering —
  // en kontrol, der normaliserer anderledes end det, den kontrollerer, ville
  // melde noget andet end det, der faktisk sker.
  it("fjerner accenter, tegn og store bogstaver", () => {
    expect(normalizeTeamName("Atlético  Madrid!")).toBe("atleticomadrid");
    expect(normalizeTeamName("Queen's Park Rangers")).toBe("queensparkrangers");
    expect(normalizeTeamName(null)).toBe("");
  });

  // Fastholdt, fordi det er en GRÆNSE og ikke en detalje: NFD splitter kun
  // accenter fra deres grundbogstav, mens ø, æ og å er selvstændige tegn, der
  // derfor forsvinder helt. "FC København" og "FC Kobenhavn" normaliserer altså
  // IKKE ens, og hverken findByName() eller ambiguousTeamNames() kan parre dem.
  // Ufarligt i dag — ingen af de syv turneringer har to skrivemåder af samme
  // klub — men reglen skal ikke kunne ændre sig ubemærket.
  it("folder ikke ø, æ og å ned til deres nærmeste latinske bogstav", () => {
    expect(normalizeTeamName("FC København")).toBe("fckbenhavn");
    expect(normalizeTeamName("FC Kobenhavn")).toBe("fckobenhavn");
  });
});
