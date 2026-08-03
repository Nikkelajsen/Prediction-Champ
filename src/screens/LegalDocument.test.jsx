import { describe, it, expect } from "vitest";
// renderToStaticMarkup frem for jsdom: projektet har bevidst intet
// komponent-testbibliotek (jf. OpsPanel.test.jsx og ui/components.test.jsx).
import { renderToStaticMarkup } from "react-dom/server";
import LegalDocument from "./LegalDocument.jsx";
import { JuraLinje } from "./Auth.jsx";
import { SletKontoKort, BEKRÆFT_ORD } from "./LegalScreen.jsx";
import { PRIVATLIV, VILKAAR, findDokument, MINDSTEALDER } from "../lib/legal.js";

const render = (el) => renderToStaticMarkup(el);

describe("LegalDocument", () => {
  // KONTRAKTEN, der gør delingen mulig: komponenten skal kunne tegnes uden
  // token, uden session og uden nogen callback. Brydes den, kan teksten ikke
  // længere vises på login-skærmen, hvor der ingen af delene findes — og det er
  // netop dér, den skal læses, før man opretter en konto.
  it.each([["privatliv", PRIVATLIV], ["vilkaar", VILKAAR]])(
    "tegner %s uden token og uden callbacks",
    (_id, doc) => {
      const html = render(<LegalDocument doc={doc} />);
      for (const a of doc.afsnit) expect(html).toContain(a.titel);
    }
  );

  it("tegner punktlister som rigtige lister", () => {
    const html = render(<LegalDocument doc={PRIVATLIV} />);
    expect(html).toContain("<ul");
    expect(html).toContain("<li>");
  });

  // Et ukendt id er en tastefejl i et kaldsted, ikke noget brugeren gjorde.
  // En tom skærm ville ligne en indlæsning, der aldrig blev færdig.
  it("siger det højt, når dokumentet ikke findes", () => {
    const html = render(<LegalDocument doc={findDokument("noget-forkert")} />);
    expect(html).toContain("kunne ikke findes");
  });
});

describe("JuraLinje", () => {
  // Selve samtykket. Forsvinder sætningen, oprettes konti uden at nogen har
  // accepteret noget — og linket er den eneste vej til teksterne for en
  // person, der endnu ikke har en konto.
  it("bærer samtykket og aldersgrænsen ved oprettelse", () => {
    const html = render(<JuraLinje mode="signup" onÅbn={() => {}} />);
    expect(html).toContain("Ved at oprette en konto accepterer du");
    expect(html).toContain("brugervilkårene");
    expect(html).toContain("privatlivspolitikken");
    expect(html).toContain(`mindst ${MINDSTEALDER} år`);
  });

  it("viser stadig begge links ved login, uden samtykke-sætningen", () => {
    const html = render(<JuraLinje mode="signin" onÅbn={() => {}} />);
    expect(html).toContain("Privatlivspolitik");
    expect(html).toContain("Brugervilkår");
    expect(html).not.toContain("accepterer du");
  });

  // `type="button"` inde i eller ved siden af en <form>: uden den er
  // standarden submit, og et tryk på "brugervilkårene" ville forsøge et login.
  it("bruger knapper, der ikke sender formularen", () => {
    const html = render(<JuraLinje mode="signup" onÅbn={() => {}} />);
    expect(html.match(/<button type="button"/g)).toHaveLength(2);
  });
});

describe("SletKontoKort", () => {
  // Handlingen kan ikke fortrydes. Kortet skal derfor sige BÅDE hvad der sker,
  // og hvad der IKKE sker — det sidste er det, folk faktisk er utrygge ved.
  it("siger hvad der forsvinder, og hvad der bliver stående", () => {
    const html = render(<SletKontoKort token="t" onLogout={() => {}} />);
    expect(html).toContain("Luk min konto");
    expect(html).toContain("pseudonym");
    expect(html).toContain("venners stillinger");
  });

  // Én knap, ét fejltryk. Bekræftelsesordet er det, der står imellem en telefon
  // i en lomme og en uigenkaldelig handling.
  it("kræver et bekræftelsesord, før noget kan ske", () => {
    expect(BEKRÆFT_ORD).toBeTruthy();
    const html = render(<SletKontoKort token="t" onLogout={() => {}} />);
    // Dialogen findes først efter et klik, som statisk render ikke kan give —
    // men knappen, der åbner den, må aldrig selv være handlingen.
    expect(html).not.toContain("Luk kontoen endeligt");
  });
});
