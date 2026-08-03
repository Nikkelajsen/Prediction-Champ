// Fejltelemetri for frontenden (G42). Modtageren er `public.client_errors`.
//
// KONTRAKT, som for analytics.js: intet kaster, intet afventes, intet blokerer.
// En rapportering, der selv kan vælte, er værre end ingen — den ville ramme
// præcis i det øjeblik, appen allerede er i knæ.
//
// Hvorfor tabellen og ikke en tjeneste: se hovedet i sql/client_errors.sql.
// Kort fortalt er en ekstern fejltjeneste en ny databehandler i en app, der
// netop har fået en privatlivspolitik — og stakspor fra denne app indeholder
// brugernes eget indhold.
import { restFetch } from "./supabase.js";

// ---------- de to grænser, der gør telemetrien sikker at have ----------
//
// En render-fejl er sjældent ÉN fejl. En boundary, der fanger, kan blive
// remountet af en navigation og kaste igen, og en `unhandledrejection` i en
// timer kan gentage sig hvert sekund. Uden grænser ville et enkelt uheld hos
// én bruger skrive tusindvis af rækker — og den, der skulle læse dem, ville
// se ét problem gentaget frem for de fem forskellige, der findes.
//
// To grænser, fordi de fanger hver sin form:
//   * DEDUP på (kind + message + første stak-linje): den samme fejl rapporteres
//     én gang pr. sideliv. Det er den, der fanger gentagelsen.
//   * LOFT på antallet i alt: den fanger den fejl, der er forskellig hver gang
//     (en besked med et tidsstempel i, en løkke over skiftende data).
const MAX_PER_SESSION = 10;
const sent = new Set();
let count = 0;

// ---------- hvem og hvor, for dem der står uden for React ----------
//
// Error boundaryen er en klassekomponent, og den ene om ROD-træet ligger i
// main.jsx — uden for App og dermed uden adgang til hverken session eller
// navigation. To modul-holdere løser det, og det er bevidst det mindste af to
// onder: alternativet var at trække token og skærmnavn gennem props til en
// komponent, hvis eneste opgave er at fange det, der går galt et helt andet
// sted. App og MainApp sætter dem, når de ved besked.
let currentToken = null;
let currentScreen = null;
function setTelemetryToken(t) { currentToken = t || null; }
function setTelemetryScreen(name) { currentScreen = name || null; }
function telemetryToken() { return currentToken; }
function telemetryScreen() { return currentScreen; }

// Kun til test: nulstiller sidelivets hukommelse.
function _resetTelemetry() {
  sent.clear();
  count = 0;
  currentToken = null;
  currentScreen = null;
}

// Klip frem for at afvise. Databasens constraints ville afvise en for lang
// stak med en fejl, og en fejlrapport, der fejler, fordi den er for detaljeret,
// er den værst tænkelige udgang. Grænserne her er derfor mindre end SQL'ens.
function klip(s, max) {
  if (typeof s !== "string" || !s) return null;
  return s.length > max ? `${s.slice(0, max)}\n… [klippet]` : s;
}

// Nøglen til dedup. Første stak-linje er med, fordi den samme besked ("Cannot
// read properties of undefined") kan komme fra to helt forskellige steder, og
// de to er ikke den samme fejl.
function nøgle(kind, message, stack) {
  const førsteLinje = (stack || "").split("\n").find((l) => l.trim()) || "";
  return `${kind}|${message}|${førsteLinje.trim()}`;
}

// Rapportér én fejl. Kaldes fra error boundaryen (kind "render") og fra de to
// globale håndterere (kind "error"/"rejection").
//
// `token` mangler, indtil brugeren er logget ind. Det er ikke en fejl at
// udelade rapporten dér: RLS kræver `user_id = auth.uid()`, så et kald uden
// token ville blive afvist alligevel. Prisen er kendt og skrevet i backloggen:
// et crash på login-skærmen efterlader stadig intet spor.
function reportClientError(token, { kind, error, componentStack, screen } = {}) {
  try {
    if (!token || !kind) return false;
    if (count >= MAX_PER_SESSION) return false;

    const message = klip(String(error?.message || error || "Ukendt fejl"), 500);
    if (!message) return false;
    const stack = klip(error?.stack || null, 4000);

    const k = nøgle(kind, message, stack);
    if (sent.has(k)) return false;
    sent.add(k);
    count++;

    restFetch(`/rest/v1/client_errors`, {
      method: "POST",
      token,
      body: [{
        kind,
        message,
        stack,
        component_stack: klip(componentStack || null, 4000),
        screen: screen || null,
        // Stemplet fra buildet (G42's første halvdel). Det er dét, der gør en
        // fejlmelding koblet til et deploy frem for til "i går".
        app_version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : null,
        url: klip(typeof window !== "undefined" ? window.location?.href : null, 500),
        user_agent: klip(typeof navigator !== "undefined" ? navigator.userAgent : null, 500),
      }],
      prefer: "return=minimal",
    }).catch(() => {}); // må aldrig blive en uhåndteret rejection — se nedenfor
    return true;
  } catch {
    return false; // telemetri må aldrig påvirke brugeren
  }
}

// De to globale håndterere.
//
// `window.onerror` fanger det, React ikke gør: fejl i event handlers, i timere
// og i kode uden for render-træet. `unhandledrejection` fanger den afviste
// promise, ingen `catch` tog — den klasse, der i denne kodebase ellers kun
// efterlader en tom skærm, fordi et fejlet `await` i en indlæsning ikke tegner
// noget.
//
// **Rapporteringen fanger bevidst IKKE sine egne fejl i en løkke:** kaldet
// ovenfor har en `.catch(() => {})`, netop så en fejlet rapportering ikke bliver
// til en `unhandledrejection`, som ville udløse en ny rapportering.
//
// Returnerer en oprydningsfunktion, så en test (og en fremtidig hot reload)
// kan afmelde igen.
function installGlobalErrorReporting(getToken, getScreen) {
  if (typeof window === "undefined") return () => {};

  const onError = (event) => {
    reportClientError(getToken?.(), {
      kind: "error",
      error: event?.error || { message: event?.message },
      screen: getScreen?.(),
    });
  };
  const onRejection = (event) => {
    reportClientError(getToken?.(), {
      kind: "rejection",
      error: event?.reason instanceof Error ? event.reason : { message: String(event?.reason) },
      screen: getScreen?.(),
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

export {
  reportClientError, installGlobalErrorReporting, MAX_PER_SESSION,
  setTelemetryToken, setTelemetryScreen, telemetryToken, telemetryScreen,
  _resetTelemetry,
};
