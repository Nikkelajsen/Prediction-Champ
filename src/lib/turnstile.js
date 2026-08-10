// Cloudflare Turnstile — bot-værnet foran Supabase Auth (B26).
//
// VÆRNET SLÅS TIL MED EN NØGLE, IKKE MED EN UDRULNING. Uden
// `VITE_TURNSTILE_SITE_KEY` findes hverken widget eller script, og de tre
// auth-kald sender ingen kvittering — appen opfører sig præcis som før. Det er
// bevidst og er hele grunden til, at koden kan ligge her, længe før nogen
// trykker på knappen i Supabase: rækkefølgen skal kunne være "kode først,
// konfiguration bagefter", for den omvendte rækkefølge lukker login for alle.
//
// Og det er ikke en teoretisk risiko. Slås Bot Protection til i Supabase, mens
// klienten intet sender, svarer GoTrue `captcha protection: request disallowed
// (not-provided)` på signup, login OG nulstilling — altså hele adgangen til
// appen, ikke bare oprettelsen af nye konti. Backloggen kaldte `B26` "ren
// konfiguration"; det holdt for e-mailbekræftelsen og ikke for denne halvdel.
//
// `render=explicit`: vi tegner selv widgeten, når skærmen er der. Automatisk
// rendering leder efter `.cf-turnstile` i DOM'en på load-tidspunktet, og i en
// React-app findes den node først senere.
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

// Nøglen er OFFENTLIG — den er beregnet til at stå i klienten, ligesom
// `VITE_SUPABASE_KEY`. Hemmeligheden i parret er secret key'en, og den ser
// appen aldrig: den bor i Supabase, som verificerer kvitteringen server-side.
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";

function turnstileSiteKey() {
  return SITE_KEY;
}

function turnstileAktiv() {
  return Boolean(SITE_KEY);
}

// Scriptet hentes ÉN gang, uanset hvor mange widgets der beder om det.
// Promisen huskes i modulet, så to skærme, der monteres samtidig (login og
// jura-visningen frem og tilbage), ikke lægger to `<script>` i hovedet.
let indlæsning = null;

function loadTurnstile() {
  if (!turnstileAktiv()) return Promise.reject(new Error("Turnstile er ikke slået til"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (indlæsning) return indlæsning;

  indlæsning = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = SCRIPT_URL;
    el.async = true;
    el.defer = true;
    el.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile blev indlæst uden at melde sig"));
    };
    // En blokeret hentning (annonceblokering, offline, firewall) må give en
    // AFVIST promise og ikke en, der hænger. Kalderen skal kunne komme videre
    // og lade GoTrue afvise med en tekst, brugeren kan læse — se
    // `daAuthError` i Auth.jsx. Promisen nulstilles, så næste forsøg prøver
    // igen frem for at arve fejlen for altid.
    el.onerror = () => {
      indlæsning = null;
      reject(new Error("Turnstile kunne ikke hentes"));
    };
    document.head.appendChild(el);
  });
  return indlæsning;
}

export { loadTurnstile, turnstileAktiv, turnstileSiteKey };
