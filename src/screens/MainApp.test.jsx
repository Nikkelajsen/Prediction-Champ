// Tests for app-skallen i MainApp.jsx.
//
// renderToStaticMarkup frem for jsdom, som resten af skærmtestene: effekter
// kører ikke, så komponenten tegner sin opstarts-tilstand ("Henter data …")
// uden at røre netværket. Det er præcis nok — det, der testes her, er SKALLEN
// (brandbar, indholdsområde, bundnavigation), som tegnes uanset tilstand.
//
// Hvorfor det er værd at teste noget så statisk som polstring: `G29`s tre
// indstik hører uadskilleligt sammen med `viewport-fit=cover` i index.html, og
// det er en kobling, ingen kan se ved at læse én af filerne. Fjernes ét af dem
// under en oprydning ("den her padding gør jo ingenting"), lægger indholdet sig
// under iPhonens status-bar eller home-indikator — og kun på rigtig hardware.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MainApp from "./MainApp.jsx";

const SESSION = { access_token: "tok", refresh_token: "r", user: { id: "u1" } };

const render = () =>
  renderToStaticMarkup(
    <MainApp
      session={SESSION}
      profile={{ display_name: "Test", is_admin: false }}
      onLogout={() => {}}
      pendingJoinCode={null}
      clearPendingJoinCode={() => {}}
      pendingLigaCode={null}
      clearPendingLigaCode={() => {}}
    />
  );

describe("app-skallen og de sikre områder (G29)", () => {
  it("giver bundnavigationen plads til home-indikatoren", () => {
    // Som POLSTRING og ikke som `bottom`: baggrunden skal nå helt ned bag
    // indikatoren, mens knapperne holder sig over den.
    expect(render()).toContain("padding-bottom:env(safe-area-inset-bottom, 0px)");
  });

  it("lader indholdets bundpolstring vokse med den samme inset", () => {
    // Ellers ville de sidste linjer indhold gemme sig bag en nav, der netop er
    // blevet højere — de to skal ændres sammen.
    expect(render()).toContain("padding-bottom:calc(96px + env(safe-area-inset-bottom, 0px))");
  });

  it("giver brandbaren plads til status-baren", () => {
    // Nødvendig, fordi index.html sætter status-bar-style til black-translucent:
    // uret og batteriet tegnes oven på appen.
    expect(render()).toContain("padding-top:calc(14px + env(safe-area-inset-top, 0px))");
  });

  it("tegner de fem faner i bundnavigationen", () => {
    const html = render();
    for (const label of ["Hjem", "Tip", "Ligaer", "Championship", "Rating"]) {
      expect(html).toContain(label);
    }
  });
});
