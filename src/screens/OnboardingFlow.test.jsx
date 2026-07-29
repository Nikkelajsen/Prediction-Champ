import { describe, it, expect, vi } from "vitest";
// renderToStaticMarkup: uden jsdom kan kun den første skærm renderes, og klik
// kan ikke simuleres. Derfor bor flowets logik i src/lib/onboarding.js, hvor den
// ER testbar (onboarding.test.js) — komponenten skal være en tynd renderer.
// De øvrige trin gennemgås manuelt før merge, jf. DOCUMENTATION.md afsnit 11.
import { renderToStaticMarkup } from "react-dom/server";
import OnboardingFlow, { GLOSSARY } from "./OnboardingFlow.jsx";

vi.mock("../lib/data.js", () => ({ joinByInviteCode: vi.fn(), createGroup: vi.fn() }));

const render = (props = {}) => renderToStaticMarkup(
  <OnboardingFlow token="t" userId="u1" profile={{ display_name: "Nikolaj" }} leagues={[]}
    onJoined={() => {}} onCreated={() => {}} onSkip={() => {}} {...props} />
);

describe("OnboardingFlow", () => {
  it("åbner med ordbogen — de tre ord, der ellers forveksles", () => {
    // Turnering/liga/konkurrence forklares dér, hvor de først møder brugeren,
    // ikke bag et ⓘ-ikon ingen bliver sendt hen til.
    expect(GLOSSARY.map((g) => g.word)).toEqual(["Turnering", "Liga", "Konkurrence"]);

    const html = render();
    expect(html).toContain("Hej Nikolaj");
    for (const { word } of GLOSSARY) expect(html).toContain(word);
  });

  it("siger pointreglen på velkomstskærmen", () => {
    const html = render();
    expect(html).toContain("+3");
    expect(html).toContain("+1");
    expect(html).toContain("Aldrig minuspoint");
  });

  it("tilbyder altid en vej ud", () => {
    expect(render()).toContain("Spring over");
  });

  it("hilser uden navn, når profilen mangler", () => {
    // profile kan være null (App.jsx's completeAuth-catch) — aldrig "Hej undefined".
    const html = render({ profile: null });
    expect(html).toContain("Hej der");
    expect(html).not.toContain("undefined");
  });
});
