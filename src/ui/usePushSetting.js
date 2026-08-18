// Notifikations-KNAPPEN på Indstillinger — ikke notifikations-SPØRGSMÅLET.
//
// usePushOptIn ejer spørgsmålet ("skal vi bede om push?") og kollapser med
// vilje tilmeldt, blokeret og afvist til ét `hidden` — de to kort, der deler
// den, viser aldrig forskellen. En indstillingsskærm skal netop VISE
// forskellen: en tilmeldt bruger skal se en tændt kontakt, en blokeret skal
// have at vide hvorfor den er låst. Derfor en søster-hook oven på de samme
// primitiver i src/lib/push.js frem for en udvidelse, der ville tvinge
// kortene til at kende tilstande, de ikke bruger.
import { useState, useEffect } from "react";
import {
  enablePush, disablePush, getExistingSubscription,
  isPushSupported, needsHomeScreenInstall,
} from "../lib/push.js";
import { writeUserFlag, PUSH_DISMISS_KEY } from "../lib/localFlags.js";

// Ren, så rækkefølgen kan testes uden browser-API'er.
//
// Hjemmeskærm FØR understøttelse — bevidst omvendt af enablePush()s egen
// fejlrækkefølge: i en iPhone-FANE er begge sande (fanen kan ikke push, og
// appen mangler på hjemmeskærmen), og kun den ene er en handling, brugeren
// kan udføre. "Understøttes ikke" var dér en blindgyde; set på en rigtig
// enhed 18. august 2026. enablePush() kan beholde sin rækkefølge — kontakten
// er låst i begge tilstande, så dens fejl kan ikke nås herfra.
function derivePushStatus({ supported, needsInstall, permission, hasSubscription }) {
  if (needsInstall) return "needs-install";
  if (!supported) return "unsupported";
  if (permission === "denied") return "denied";
  return hasSubscription ? "on" : "off";
}

// { status: null | "unsupported" | "needs-install" | "denied" | "on" | "off",
//   busy, error, enable(), disable() }
// `status === null` betyder "ved det ikke endnu" — kalderen viser intet imens,
// samme anti-blink-regel som usePushOptIn.
function usePushSetting(token, userId) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supported = isPushSupported();
        // getExistingSubscription må først kaldes, når vi ved den kan:
        // i en browser uden serviceWorker ville den bare svare null, men
        // rækkefølgen her skal afspejle derivePushStatus' prioritering.
        const sub = supported ? await getExistingSubscription() : null;
        if (cancelled) return;
        setStatus(derivePushStatus({
          supported,
          needsInstall: needsHomeScreenInstall(),
          permission: supported ? Notification.permission : "default",
          hasSubscription: !!sub,
        }));
      } catch { if (!cancelled) setStatus("off"); }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  async function enable() {
    setBusy(true); setError("");
    try {
      await enablePush(token, userId);
      setStatus("on");
    } catch (e) {
      // Afvist i selve prompten? Så låser kontakten med den fulde forklaring
      // på skærmen — og KUN den: en rød fejl, der siger det samme, oveni er
      // støj (set på en rigtig enhed 18. august 2026, hvor de to stod sammen).
      if (isPushSupported() && Notification.permission === "denied") {
        setStatus("denied");
      } else {
        setError(e.message || "Noget gik galt — prøv igen.");
      }
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setError("");
    try {
      await disablePush(token);
      // Et bevidst "fra" her er et stærkere nej end at lukke kortet på Hjem —
      // uden flaget ville opt-in-kortet stå klar ved næste besøg og bede
      // brugeren fortryde det valg, de lige har truffet.
      writeUserFlag(PUSH_DISMISS_KEY, userId, "1");
      setStatus("off");
    } catch (e) {
      setError(e.message || "Noget gik galt — prøv igen.");
    } finally { setBusy(false); }
  }

  return { status, busy, error, enable, disable };
}

export { usePushSetting, derivePushStatus };
