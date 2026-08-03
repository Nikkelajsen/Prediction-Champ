import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { restFetch } from "./supabase.js";
import {
  reportClientError, installGlobalErrorReporting, MAX_PER_SESSION,
  setTelemetryToken, setTelemetryScreen, telemetryToken, telemetryScreen,
  _resetTelemetry,
} from "./telemetry.js";

vi.mock("./supabase.js", () => ({ restFetch: vi.fn(() => Promise.resolve()) }));

// De to grænser ER funktionen. Uden dem ville ét uheld hos én bruger skrive
// tusindvis af rækker, og den, der skulle læse dem, ville se ét problem
// gentaget frem for de fem forskellige, der findes. Derfor testes de først.
describe("reportClientError: grænserne", () => {
  beforeEach(() => { _resetTelemetry(); restFetch.mockClear(); });

  const fejl = (msg = "boom", stack = "at Foo (index.js:1:1)") => ({ message: msg, stack });

  it("sender den samme fejl én gang pr. sideliv", () => {
    expect(reportClientError("tok", { kind: "render", error: fejl() })).toBe(true);
    expect(reportClientError("tok", { kind: "render", error: fejl() })).toBe(false);
    expect(restFetch).toHaveBeenCalledTimes(1);
  });

  // Samme besked fra to forskellige steder er TO fejl. Uden stak-linjen i
  // nøglen ville den anden forsvinde — og "Cannot read properties of
  // undefined" er netop den slags besked, der kommer fra hvor som helst.
  it("skelner to fejl med samme besked men forskellig stak", () => {
    reportClientError("tok", { kind: "render", error: fejl("boom", "at A (a.js:1:1)") });
    reportClientError("tok", { kind: "render", error: fejl("boom", "at B (b.js:2:2)") });
    expect(restFetch).toHaveBeenCalledTimes(2);
  });

  // Loftet fanger den fejl, dedup ikke kan: den der er forskellig hver gang.
  it("stopper ved loftet, uanset hvor forskellige fejlene er", () => {
    for (let i = 0; i < MAX_PER_SESSION + 5; i++) {
      reportClientError("tok", { kind: "error", error: fejl(`fejl nr. ${i}`) });
    }
    expect(restFetch).toHaveBeenCalledTimes(MAX_PER_SESSION);
  });

  // RLS kræver `user_id = auth.uid()`, så et kald uden token ville blive
  // afvist alligevel. At springe det over er derfor ikke tab af data — det er
  // at lade være med at bruge et netværkskald på et sikkert nej.
  it("sender ikke uden token", () => {
    expect(reportClientError(null, { kind: "render", error: fejl() })).toBe(false);
    expect(restFetch).not.toHaveBeenCalled();
  });

  it("klipper en meget lang stak frem for at få rækken afvist", () => {
    reportClientError("tok", { kind: "render", error: { message: "x", stack: "y".repeat(9000) } });
    const krop = restFetch.mock.calls[0][1].body[0];
    expect(krop.stack.length).toBeLessThan(4100);
    expect(krop.stack.endsWith("[klippet]")).toBe(true);
  });

  it("bærer skærm og version med, så rapporten kan læses uden at gætte", () => {
    reportClientError("tok", { kind: "render", error: fejl(), screen: "hjem:", componentStack: "i HjemTab" });
    const krop = restFetch.mock.calls[0][1].body[0];
    expect(krop).toMatchObject({ kind: "render", screen: "hjem:", component_stack: "i HjemTab" });
    expect("app_version" in krop).toBe(true);
  });

  // Kontrakten for hele filen: intet må kaste. En rapportering, der vælter,
  // rammer præcis i det øjeblik, appen allerede er i knæ.
  it("kaster ikke, når selve afsendelsen fejler", () => {
    restFetch.mockImplementationOnce(() => Promise.reject(new Error("netværk")));
    expect(() => reportClientError("tok", { kind: "render", error: fejl() })).not.toThrow();
  });
});

describe("modul-holderne (token og skærm)", () => {
  beforeEach(() => _resetTelemetry());

  it("giver boundaryen adgang til det, den ikke har som props", () => {
    setTelemetryToken("abc");
    setTelemetryScreen("ligaer:group");
    expect(telemetryToken()).toBe("abc");
    expect(telemetryScreen()).toBe("ligaer:group");
    setTelemetryToken(null);
    expect(telemetryToken()).toBeNull();
  });
});

// Testsuiten kører uden DOM (skærmtestene bruger renderToStaticMarkup, så
// projektet har bevidst hverken jsdom eller happy-dom). En håndrullet
// window-stub er derfor billigere end en ny dev-afhængighed — og den gør
// samtidig testen skarpere: den viser præcis de to metoder, funktionen bruger.
function fakeWindow() {
  const lyttere = {};
  return {
    addEventListener: (navn, fn) => { (lyttere[navn] ||= []).push(fn); },
    removeEventListener: (navn, fn) => { lyttere[navn] = (lyttere[navn] || []).filter((f) => f !== fn); },
    fyr: (navn, event) => (lyttere[navn] || []).forEach((f) => f(event)),
  };
}

describe("installGlobalErrorReporting", () => {
  let afmeld;
  let vindue;

  beforeEach(() => {
    _resetTelemetry();
    restFetch.mockClear();
    vindue = fakeWindow();
    globalThis.window = vindue;
  });
  afterEach(() => { afmeld?.(); delete globalThis.window; });

  it("fanger en uhåndteret fejl og en afvist promise", () => {
    afmeld = installGlobalErrorReporting(() => "tok", () => "hjem:");

    vindue.fyr("error", { error: new Error("fra en handler") });
    vindue.fyr("unhandledrejection", { reason: new Error("fra en promise") });

    const kinds = restFetch.mock.calls.map((c) => c[1].body[0].kind);
    expect(kinds).toEqual(["error", "rejection"]);
  });

  // `unhandledrejection` kan bære hvad som helst — også en streng. En
  // rapportering, der kun kan læse en Error, ville tabe netop den afvisning,
  // der kom fra et `Promise.reject("noget gik galt")`.
  it("tåler en afvisning, der ikke er en Error", () => {
    afmeld = installGlobalErrorReporting(() => "tok", () => null);
    vindue.fyr("unhandledrejection", { reason: "bare en streng" });
    expect(restFetch.mock.calls[0][1].body[0].message).toBe("bare en streng");
  });

  it("holder op med at lytte, når oprydningen kaldes", () => {
    const stop = installGlobalErrorReporting(() => "tok", () => null);
    stop();
    vindue.fyr("error", { error: new Error("efter stop") });
    expect(restFetch).not.toHaveBeenCalled();
  });
});
