// Kald til appens EGNE endpoints (`/api/*` på Vercel) — ét sted (G80).
//
// HVORFOR DEN FINDES. `/api/*` er serverless-funktioner, som Vercel kører.
// `npm run dev` er Vites udviklingsserver, og den kender dem ikke: den svarer
// `index.html` med status **200** på enhver ukendt sti, fordi SPA'ens
// history-fallback skal virke. Et fetch mod `/api/delete-account` får derfor
// ikke en fejl, men en HTML-side med et grønt statusnummer — og hvert kaldested
// oversatte den på sin egen måde:
//
//   · `src/screens/admin/MatchesPanel.jsx` viste den rå parser-fejl
//     `Unexpected token '/'` (index.html begynder med `<!doctype html>`).
//   · `src/lib/data/account.js` sagde "Kontoen kunne ikke lukkes" — den mest
//     uigenkaldelige handling i appen, meldt som afvist, selvom serveren
//     aldrig blev spurgt.
//   · `src/lib/ops.js` og `src/lib/push.js` faldt tilbage til tomt: en
//     forhåndsvisning uden rækker og "VAPID-nøgle mangler".
//
// Tre forskellige løgne om samme tilstand. Fejlen er hverken en manglende
// konto, en tom udbakke eller en manglende nøgle — det er, at endpointet ikke
// findes i det miljø, appen kører i. Rettelsen hører derfor ét sted.
//
// HVORFOR IKKE `restFetch`. Den går til Supabase. Disse fem kald går til appens
// eget bagland, fordi de kræver service-nøglen (e-mailen i `auth.users`,
// VAPID-parret, SYNC_SECRET) — se hovedet af src/lib/data/account.js.

// Netværket svigtede, før serveren nåede at svare. Samme tekst som de to
// kaldesteder i account.js brugte i forvejen.
const NAAEDE_IKKE_SERVEREN = "Kunne ikke nå serveren. Tjek forbindelsen og prøv igen.";

// Svaret var HTML og ikke JSON. Beskeden afhænger af, HVOR appen kører, fordi
// den samme observation har to helt forskellige årsager:
//
//   · udvikling — endpointet findes ikke i Vite, og svaret er `index.html`.
//     Det er ikke en fejl, der skal rettes i koden; det er et forkert
//     udviklingsmiljø, og beskeden siger, hvad man gør ved det.
//   · produktion — funktionen findes, så en HTML-side kommer fra platformen
//     (en 502/504-side foran den) og ikke fra appen. "Kør vercel dev" ville
//     være et vildledende råd, så det står der ikke.
//
// Dette er den ENESTE `import.meta.env.DEV` uden for supabase.js, og den er
// bevidst: alternativet er, at fem kaldesteder hver især gætter på årsagen.
function ikkeJsonBesked(status, dev) {
  if (dev) {
    return (
      "Endpointet /api/* findes ikke på udviklingsserveren — `npm run dev` " +
      "kører kun frontenden og svarer index.html på alle ukendte stier. " +
      "Kør `vercel dev` for at få serverless-funktionerne med."
    );
  }
  return `Serveren svarede ikke som forventet (HTTP ${status}). Prøv igen om lidt.`;
}

// Kaldet. Returnerer BÅDE svaret og den parsede krop, fordi kaldestederne
// bruger begge dele: `res.ok`/`res.status` til at afgøre udfaldet, og `data`
// til den fejlkode (`kode`), serveren selv sender med.
//
// `data` er null, når kroppen er tom eller ugyldig JSON — det er lovligt for
// et 204-svar og skal ikke kaste. Det, der kaster, er et svar, der slet ikke
// er JSON: da er det ikke vores endpoint, der svarede.
async function apiFetch(sti, init) {
  let res;
  try {
    res = await fetch(sti, init);
  } catch {
    throw new Error(NAAEDE_IKKE_SERVEREN);
  }

  const type = res.headers?.get?.("content-type") || "";
  if (!type.includes("json")) {
    throw new Error(ikkeJsonBesked(res.status, Boolean(import.meta.env?.DEV)));
  }

  const data = await res.json().catch(() => null);
  return { res, data };
}

export { apiFetch, ikkeJsonBesked, NAAEDE_IKKE_SERVEREN };
