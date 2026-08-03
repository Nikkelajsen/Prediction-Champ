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

export default defineConfig({
  plugins: [react()],
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
