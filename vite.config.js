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

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
});
