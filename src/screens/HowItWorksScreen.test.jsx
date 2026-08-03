// Tests for "Sådan virker det"-skærmens foldede standardtilstand.
//
// renderToStaticMarkup som resten af skærmtestene: der findes ingen
// klik-simulering i repoet, så det, der kan testes, er præcis dét, der er
// værd at værne om — at skærmen ÅBNER som en menu og ikke som en mur.
// Folder et emne sig ud af sig selv igen (fx fordi `Topic` flyttes tilbage
// ind i komponentkroppen og dermed remountes), falder testen her.
//
// Bemærk: `InstallGuide` læser `navigator` under render, og testmiljøet er
// node. Testen er kun grøn, fordi installations-emnet er lukket — den må
// ikke rendere skærmen med et emne foldet ud.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import HowItWorksScreen from "./HowItWorksScreen.jsx";

const html = () => renderToStaticMarkup(<HowItWorksScreen onBack={() => {}} token="tok" />);

describe("HowItWorksScreen — foldet som standard", () => {
  it("viser de seks emner som overskrifter", () => {
    const out = html();
    for (const title of ["Begreberne", "Point og stilling", "Under kampene", "Din udvikling", "Installér som app", "Privatliv og vilkår"]) {
      expect(out).toContain(title);
    }
  });

  it("har alle emner lukket, og ingen af dem åbne", () => {
    const out = html();
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('aria-expanded="true"');
  });

  it("renderer ikke indholdet, før et emne foldes ud", () => {
    const out = html();
    expect(out).not.toContain("Ingen minuspoint");
    expect(out).not.toContain("Parvis multiplayer-Elo");
    expect(out).not.toContain("Tips-synlighed");
  });

  it("holder «Sig til» og versionsstemplet uden for foldningen", () => {
    const out = html();
    expect(out).toContain("Sig til");
    expect(out).toContain(`Version ${__APP_VERSION__}`);
  });
});
