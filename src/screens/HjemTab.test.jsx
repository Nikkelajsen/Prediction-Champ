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
