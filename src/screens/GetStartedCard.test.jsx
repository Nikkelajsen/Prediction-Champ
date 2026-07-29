import { describe, it, expect } from "vitest";
// renderToStaticMarkup frem for jsdom: kortet er ren markup over deriveOnboarding,
// og projektet har bevidst intet komponent-testbibliotek (jf. ui/components.test.jsx).
import { renderToStaticMarkup } from "react-dom/server";
import GetStartedCard from "./GetStartedCard.jsx";
import { deriveOnboarding } from "../lib/onboarding.js";

const render = (props) => renderToStaticMarkup(<GetStartedCard {...props} />);
const cold = deriveOnboarding({ groups: [], competitions: [], hasPrediction: false });
const almost = deriveOnboarding({
  groups: [{ id: "g1", memberCount: 1 }], competitions: [{ id: "c1" }], hasPrediction: true,
});

describe("GetStartedCard", () => {
  it("viser alle fire trin og tælleren for en kold bruger", () => {
    const html = render({ onboarding: cold });
    expect(html).toContain("Kom godt i gang");
    expect(html).toContain("0 af 4 klaret");
    expect(html).toContain("Opret eller deltag i en liga");
    expect(html).toContain("Kom med i en konkurrence");
    expect(html).toContain("Afgiv dit første tip");
    expect(html).toContain("Invitér en ven");
  });

  it("forklarer kun det uafsluttede trin — færdige trin står uden hint", () => {
    const html = render({ onboarding: almost });
    expect(html).toContain("3 af 4 klaret");
    expect(html).toContain("Det er først en konkurrence, når I er flere."); // invitér mangler
    expect(html).not.toContain("+3 for det præcise resultat"); // tip er klaret
  });

  it("forsvinder helt, når onboardingen er gennemført", () => {
    const done = deriveOnboarding({
      groups: [{ id: "g1", memberCount: 3 }], competitions: [{ id: "c1" }], hasPrediction: true,
    });
    expect(render({ onboarding: done })).toBe("");
  });

  it("renderes ikke, før tilstanden er hentet", () => {
    // MainApp sender null, indtil proben er kørt — kortet må ikke blinke forbi.
    expect(render({ onboarding: null })).toBe("");
  });

  it("tilføjer notifikations-trinnet, men KUN når push kan tilbydes", () => {
    expect(render({ onboarding: cold, push: { available: false } })).not.toContain("Få besked før deadline");

    const html = render({ onboarding: cold, push: { available: true } });
    expect(html).toContain("Få besked før deadline");
    // Det er et ekstra trin, ikke et krav: tælleren må ikke hoppe mellem enheder.
    expect(html).toContain("0 af 4 klaret");
  });

  it("gør kun uafsluttede trin klikbare", () => {
    const html = render({ onboarding: almost, actions: { invitér: () => {}, liga: () => {} } });
    // tre klarede trin + ét uafsluttet med handling → præcis én knap-rolle
    expect(html.match(/role="button"/g) || []).toHaveLength(1);
  });
});
