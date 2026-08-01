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
import { seasonFetchVerdict } from "./sync-matches.js";

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
