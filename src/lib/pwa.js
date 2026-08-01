// PWA-laget: registrering af service workeren og browserens installations-prompt.
//
// HVORFOR DEN LIGGER HER OG IKKE I push.js (G27, august 2026).
// Service workeren blev indtil da kun registreret INDE i `enablePush()`. Følgen
// var, at en bruger, der ikke slog notifikationer til, aldrig fik en — og
// dermed heller aldrig blev en installerbar PWA i browserens øjne, fordi en
// registreret service worker er en af betingelserne. For en app, der
// markedsfører sig som noget, man lægger på hjemmeskærmen, var det halvdelen af
// løftet, låst bag en helt anden beslutning.
//
// Registreringen hører derfor til app-opstarten, ikke til notifikationer.
// `enablePush()` registrerer stadig selv, fordi den skal kunne kaldes, før
// denne er nået igennem — `register()` er idempotent for samme URL.
//
// HVAD DEN BEVIDST IKKE GØR: cache.
// `public/sw.js` har stadig ingen fetch-handler. Beslutningen står i
// DOCUMENTATION.md §11 og er uændret: uden caching kan appen aldrig hænge fast
// i en gammel version. Offline-adfærd er dermed fortsat fravalgt, ikke glemt —
// og det er et selvstændigt valg, der skal træffes med åbne øjne, fordi en
// fejlbehæftet fetch-handler er den klassiske måde at mure en PWA inde på.
import { useState, useEffect } from "react";

export async function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    // Må aldrig blokere opstarten: uden service worker mister man push og
    // installations-prompten, ikke appen.
    return null;
  }
}

// Browserens egen installations-prompt.
//
// `beforeinstallprompt` fyrer, når Chrome/Edge (desktop og Android) vurderer,
// at appen kan installeres. Hændelsen SKAL gemmes ved første fyring — den kan
// kun bruges én gang, og den kommer ikke igen af sig selv.
//
// Safari på iOS udsender den ikke og kommer ikke til det. Derfor forsvinder
// `InstallGuide`s manuelle trin ikke: de er den eneste vej på iOS, og iOS er
// samtidig den platform, hvor installation betyder mest, fordi Web Push kræver
// den. Prompten er altså en GENVEJ for de browsere, der har en — ikke en
// erstatning for vejledningen.
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState(null);

  useEffect(() => {
    const onPrompt = (e) => {
      // Uden preventDefault viser Chrome sin egen mini-infobar, og hændelsen
      // kan ikke genbruges senere fra vores egen knap.
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return {
    available: !!deferred,
    async promptInstall() {
      if (!deferred) return false;
      deferred.prompt();
      const { outcome } = await deferred.userChoice.catch(() => ({ outcome: "dismissed" }));
      // Hændelsen er brugt op, uanset hvad brugeren svarede. Ryddes den ikke,
      // ville knappen blive stående og ikke gøre noget ved næste tryk.
      setDeferred(null);
      return outcome === "accepted";
    },
  };
}
