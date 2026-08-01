// Tests for login- og oprettelsesskærmen.
//
// Skærmen var **helt utestet** indtil august 2026, og det er den første, hver
// eneste ny bruger møder. `G28` handlede om fire ting, der alle er usynlige på
// et skærmbillede — en formular, feltnavne, autoComplete-kontrakter og danske
// fejl — så de er præcis den slags, der forsvinder igen ved næste oprydning,
// hvis ingen holder fast i dem.
//
// renderToStaticMarkup som resten af skærmtestene: effekter kører ikke, og der
// røres intet netværk.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthScreen, ResetPasswordScreen, daAuthError } from "./Auth.jsx";

const render = (over = {}) =>
  renderToStaticMarkup(<AuthScreen onAuthed={() => {}} booting={false} {...over} />);

describe("login-skærmen er en rigtig formular (G28)", () => {
  // Uden `<form>` sender Enter ikke — man skal ramme knappen. På den skærm,
  // hvor flest brugere står, og hvor Enter er den mest indøvede gestus der
  // findes.
  it("har en form med en submit-knap", () => {
    const html = render();
    expect(html).toContain("<form");
    expect(html).toContain('type="submit"');
  });

  // Uden `type="email"` får telefonen et almindeligt tastatur uden @.
  it("beder om et e-mail-tastatur", () => {
    expect(render()).toContain('type="email"');
  });

  // Uden autoComplete hverken udfylder ELLER GEMMER adgangskode-managere. Det
  // sidste er det, der gør ondt: en ny bruger får ingen hjælp til at huske den
  // kode, de lige har valgt.
  it("giver adgangskode-manageren den rigtige kontrakt pr. tilstand", () => {
    expect(render()).toContain('autoComplete="current-password"');
  });

  // Et felt uden navn er navnløst for en skærmlæser: placeholderen forsvinder,
  // så snart der skrives i feltet.
  it("giver hvert felt en etiket, også når den er skjult", () => {
    const html = render();
    expect(html).toContain('class="srOnly"');
    expect(html).toContain('for="email"');
    expect(html).toContain('id="email"');
  });

  // Tilstandsskiftene var `<p onClick>`: usynlige for tastaturet, uden rolle.
  // `type="button"` er ikke til forhandling inde i en form, hvor standarden er
  // submit — uden den ville "Glemt adgangskode?" sende formularen.
  it("gør tilstandsskiftene til knapper, der ikke sender formularen", () => {
    const html = render();
    expect(html).toContain("Glemt adgangskode?");
    expect(html).toContain("Ny bruger? Opret konto");
    expect((html.match(/type="button"/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("nulstil-skærmen", () => {
  it("er også en formular med navngivne felter", () => {
    const html = renderToStaticMarkup(<ResetPasswordScreen accessToken="t" onDone={() => {}} />);
    expect(html).toContain("<form");
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('for="nyt-kodeord"');
  });
});

// GoTrue svarer på engelsk i en ellers dansk app. Kun de fejl, en bruger
// realistisk rammer, oversættes — alt andet vises som det kommer, fordi en
// tavs omskrivning af en ukendt fejl gør fejlsøgning sværere, end den engelske
// tekst gør det for brugeren.
describe("daAuthError", () => {
  it("oversætter de fejl, en bruger faktisk rammer", () => {
    expect(daAuthError("Invalid login credentials")).toBe("Forkert e-mail eller adgangskode.");
    expect(daAuthError("User already registered")).toMatch(/findes allerede/);
    expect(daAuthError("Password should be at least 6 characters")).toMatch(/for kort/);
  });

  it("lader en ukendt fejl passere uændret frem for at gætte", () => {
    expect(daAuthError("Database connection reset")).toBe("Database connection reset");
  });

  it("giver en tekst, også når fejlen ingen besked har", () => {
    expect(daAuthError(undefined)).toBe("Noget gik galt");
    expect(daAuthError("")).toBe("Noget gik galt");
  });
});
