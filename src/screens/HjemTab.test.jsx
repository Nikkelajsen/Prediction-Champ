// Tests for Hjem-fanens skal.
//
// renderToStaticMarkup som resten af skærmtestene: effekter kører ikke, så
// komponenten tegner sin opstarts-tilstand uden at røre netværket.
//
// Det, der testes, er opdater-knappen (`B13`). Den er lille, men den er den
// eneste vej ud af forældede tal for en bruger, der har appen åben under en
// kampdag — runde-oversigten genindlæser sig selv hvert minut, mens "Dine
// placeringer" og rating-snapshottet kun hentede ved montering. Forsvinder
// knappen, er der ingen fejl at se: tallene står bare stille.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import HjemTab from "./HjemTab.jsx";

const render = (over = {}) =>
  renderToStaticMarkup(
    <HjemTab
      token="tok"
      userId="u1"
      profile={{ display_name: "Test" }}
      competitions={[]}
      goTab={() => {}}
      openPredictions={() => {}}
      openBoard={() => {}}
      openGroup={() => {}}
      openProfile={() => {}}
      onboarding={null}
      {...over}
    />
  );

describe("opdater-knappen på Hjem (B13)", () => {
  it("findes og har et navn, en skærmlæser kan bruge", () => {
    expect(render()).toContain('aria-label="Opdatér tallene på Hjem"');
  });

  // Knappens optagethed er UDLEDT af, at placeringerne mangler, frem for at
  // være sin egen state. Følgen — som er den rigtige — er, at den også står
  // optaget under den allerførste indlæsning: der ER noget i gang.
  it("står optaget, så længe placeringerne ikke er hentet", () => {
    const html = render();
    expect(html).toContain("disabled");
    expect(html).toContain("spin");
  });
});

// Hjem må aldrig stå tom.
//
// Alle de øvrige kort ligger bag `tips.hasComps`, så en bruger uden
// konkurrencer fik kun checklisten. Den kan udeblive ad to veje — brugeren
// trykker X på den, eller onboarding-proben fejler stille i MainApp — og så stod
// skærmen med dato og navn og intet andet. Præcis dét skete for en nyoprettet
// konto på en brugt enhed, hvor et arvet localStorage-flag slukkede onboardingen.
describe("tom-sikringen på Hjem", () => {
  it("peger videre, når der hverken er konkurrencer eller checkliste", () => {
    const html = render({ competitions: [], onboarding: null });
    expect(html).toContain("Kom i gang");
    expect(html).toContain("Opret eller deltag i en liga");
  });

  // Checklisten er den rigtige vej videre, når den er der — to kort må ikke
  // sige det samme på samme skærm.
  it("viger for checklisten", () => {
    const onboarding = {
      complete: false, doneCount: 0, groups: [], steps: [
        { id: "liga", done: false, label: "Opret eller deltag i en liga", hint: "…" },
      ],
    };
    const html = render({ competitions: [], onboarding });
    expect(html).toContain("Kom godt i gang");
    expect(html).not.toContain("Kom i gang</div>");
  });

  // "Henter din næste deadline…" lovede før en deadline, der ikke fandtes, for
  // en bruger uden konkurrencer — og stod side om side med kortet ovenfor.
  it("lover ikke en deadline, der ikke findes", () => {
    expect(render({ competitions: [], onboarding: null })).not.toContain("Henter din næste deadline");
  });
});
