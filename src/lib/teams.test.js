import { describe, it, expect } from "vitest";
import { teamLabel, teamLabelMap, TEAM_SELECT } from "./teams.js";

// `B39`s visningsregel. Testen er lille, fordi reglen er lille — men den er
// vagten om, at den KUN er ét sted: falder en af påstandene, er der et hold
// et sted i appen, der pludselig hedder noget andet.
describe("teamLabel", () => {
  it("bruger det korte navn, når leverandøren har sendt ét", () => {
    expect(teamLabel({ name: "Real Racing Club de Santander", short_name: "Santander" })).toBe("Santander");
  });

  // Sportmonks-ligaerne (Superligaen, Scotland) får ALDRIG feltet, og en helt ny
  // turnerings allerførste sync har det heller ikke endnu. Begge skal vise det
  // fulde navn, ikke ingenting.
  it("falder tilbage på det fulde navn, når der ikke er et kort", () => {
    expect(teamLabel({ name: "AGF" })).toBe("AGF");
    expect(teamLabel({ name: "AGF", short_name: null })).toBe("AGF");
    // Tom streng er den tredje form for "ingenting": leverandøren sendte feltet
    // med, men uden indhold. `||` fanger alle tre, og det er derfor den og ikke
    // `??` står i reglen.
    expect(teamLabel({ name: "AGF", short_name: "" })).toBe("AGF");
  });

  // En række, der aldrig kom hjem (holdet er ikke i svaret), må ikke vælte en
  // kamprække — den viser bare ingenting, præcis som før kolonnen fandtes.
  it("svarer tom streng på et hold, der ikke findes", () => {
    expect(teamLabel(undefined)).toBe("");
    expect(teamLabel({})).toBe("");
  });
});

describe("teamLabelMap", () => {
  it("slår id op i visningsnavnet og blander de to slags hold", () => {
    const m = teamLabelMap([
      { id: "a", name: "Club Atlético de Madrid", short_name: "Atleti" },
      { id: "b", name: "Odense BK" },
    ]);
    expect(m.get("a")).toBe("Atleti");
    expect(m.get("b")).toBe("Odense BK");
  });

  it("tåler et tomt svar", () => {
    expect(teamLabelMap([]).size).toBe(0);
    expect(teamLabelMap(null).size).toBe(0);
  });
});

// Den påstand, der gør, at et preview mod en staging-database uden `#72` ikke
// bliver en hvid skærm: et holdopslag må ALDRIG navngive `short_name`, for en
// kolonne, der ikke findes, er en 400 fra PostgREST. Se begrundelsen i teams.js.
describe("TEAM_SELECT", () => {
  it("navngiver ingen kolonner, så opslaget virker uden #72", () => {
    expect(TEAM_SELECT).toBe("*");
  });
});
