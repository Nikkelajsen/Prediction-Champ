// Tests for stillingens valg af konkurrence (G107).
//
// Fejlen, der gav anledning til dem: en bruger meldte sig til en konkurrence på
// liga-siden, trykkede sig ind på stillingen — og fik en tom tabel med en anden
// ligas konkurrence i vælgeren. To ting gik galt samtidig, og begge udspringer af
// den samme situation: det ØNSKEDE id fandtes ikke i listen.
//
// `effectiveCompId` er skilt ud som ren funktion netop for at kunne prøves her:
// projektets skærmtests er renderToStaticMarkup, så effekter kører ikke, og en
// synkroniserende effekt ville derfor være utestbar.
import { describe, it, expect } from "vitest";
import { effectiveCompId } from "./BoardScreen.jsx";

const COMPS = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("effectiveCompId — vælgeren og tabellen skal være enige", () => {
  it("beholder den ønskede, når den findes", () => {
    expect(effectiveCompId("b", COMPS)).toBe("b");
  });

  it("falder tilbage til den første, når den ønskede ikke er i listen", () => {
    // Dette ER fejlen: `<select value="ukendt">` viser browserens første option,
    // mens tabellen ikke kunne hente noget. Nu peger begge på det samme.
    expect(effectiveCompId("ukendt", COMPS)).toBe("a");
  });

  it("svarer null, når der ingen konkurrencer er", () => {
    // Skærmen tegner da EmptyCompetitions — men opslaget må ikke kaste undervejs.
    expect(effectiveCompId("a", [])).toBe(null);
    expect(effectiveCompId(null, [])).toBe(null);
  });

  it("falder tilbage, når intet er ønsket", () => {
    expect(effectiveCompId(null, COMPS)).toBe("a");
  });
});
