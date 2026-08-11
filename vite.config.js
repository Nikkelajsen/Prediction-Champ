import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Commit-SHA'en stemples ind i buildet (G42, august 2026).
//
// Uden den kan en fejlmelding fra en bruger ikke kobles til et deploy: "det
// virkede ikke i går" er ubrugeligt, hvis man ikke ved, hvilken version de så.
// Vercel sætter VERCEL_GIT_COMMIT_SHA i byggemiljøet; lokalt er der ingen, og
// så står der "dev", hvilket er den sande værdi.
//
// Syv tegn, fordi det er dét, `git log --oneline` viser — versionen skal kunne
// kopieres fra appen og indsættes i en `git show` uden mellemregninger.
const version = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || "dev";

// `/api/*` findes ikke i `npm run dev` (G40): Vite serverer kun `src/`, mens
// funktionerne i `api/` er Vercels. Følgen var, at push-flowet slet ikke kunne
// afprøves lokalt — `push.js` henter VAPID-nøglen fra `/api/send-notifications`
// — og at enhver ændring i `api/` skulle deployes for at blive set.
//
// To veje, og de løser hver sit:
//   * `npm run dev:api` (`vercel dev`) kører funktionerne LOKALT med den kode,
//     der ligger i repoet. Det er vejen, når man ændrer noget i `api/`.
//   * `VITE_API_PROXY=<url>` videresender `/api/*` til en kørende deploy. Det er
//     vejen, når man arbejder i frontenden og bare har brug for, at endpointet
//     svarer — fx tilmelding til notifikationer.
//
// Proxyen er OPT-IN med vilje. Var den tændt som standard, ville lokal udvikling
// tavst kalde produktionens funktioner, og de skriver i produktionens database
// (`G4`). Den skal vælges, ikke arves.
const apiProxy = process.env.VITE_API_PROXY;

// Appens offentlige adresse, stemplet ind i `index.html`s OG-tags (I7).
//
// HVORFOR DEN IKKE ER HARDKODET. `og:image` SKAL være en absolut URL — en
// crawler har intet dokument at gøre en relativ sti relativ til. Og
// produktionsadressen er netop et ÅBENT spørgsmål (`I10`/`B21`: appen kører på
// prediction-champ.vercel.app, leagly.app er planlagt). En hardkodet adresse
// ville derfor blive forkert på en dag, ingen af os kan planlægge efter, og
// symptomet ville være et link-preview uden billede — altså det ene sted, hvor
// ingen af os kigger, fordi vi allerede har appen installeret.
//
// `VERCEL_PROJECT_PRODUCTION_URL` er projektets produktionsdomæne uden skema og
// følger med, den dag domænet skifter. Preview-deploys arver med vilje
// produktionens adresse frem for deres egen flygtige: billedet er det samme, og
// et preview skal ikke udgive sig selv som kanonisk.
//
// Vites egen `%VITE_*%`-erstatning i index.html kan ikke bruges — den ser kun
// variabler med `VITE_`-præfiks, og dette er en systemvariabel fra Vercel. Deraf
// de tre linjer plugin.
const publicOrigin =
  process.env.PUBLIC_ORIGIN ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
  "https://prediction-champ.vercel.app";

const ogOrigin = {
  name: "leagly-og-origin",
  transformIndexHtml(html) {
    // Skrives i byggeloggen, så spørgsmålet "hvilken adresse blev stemplet ind?"
    // kan besvares uden at hente den byggede fil ned.
    console.log(`[leagly] OG-adresse: ${publicOrigin}`);
    return html.replaceAll("%OG_ORIGIN%", publicOrigin);
  },
};

export default defineConfig({
  plugins: [react(), ogOrigin],
  build: {
    // Source maps udgives (G42, 3. august 2026).
    //
    // Stakspor i `client_errors` er minificerede, og en linje som
    // `index-Bd4x.js:1:48213` kan ikke bruges til noget. Med `.map`-filerne ved
    // siden af kan browserens devtools — og et opslag i hånden — oversætte den
    // til fil og linje.
    //
    // Indvendingen mod source maps i produktion er, at de udstiller kildekoden.
    // Den gælder ikke her: **repoet er offentligt**, så koden kan læses i
    // forvejen af enhver, der vil. Prisen er derfor kun størrelsen på de
    // ekstra filer, som browseren kun henter, når devtools er åbne.
    sourcemap: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  // Testene importerer `src/lib/supabase.js`, som efter `G4` KASTER i udvikling,
  // hvis Supabase-variablerne mangler — netop for at en lokal kørsel ikke tavst
  // rammer produktion. En testkørsel er "udvikling" for Vite, så den skal have
  // værdier at importere med. De er med vilje åbenlyst falske: intet i
  // testsuiten laver netværkskald, og et rigtigt projekt-id her ville være den
  // samme tavse kobling til produktion i en anden forklædning.
  test: {
    env: {
      VITE_SUPABASE_URL: "http://localhost:54321",
      VITE_SUPABASE_KEY: "test-key-ikke-en-rigtig-nøgle",
    },
  },
  server: apiProxy
    ? { proxy: { "/api": { target: apiProxy, changeOrigin: true } } }
    : undefined,
});
