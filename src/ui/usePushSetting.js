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

// Ren, så rækkefølgen kan testes uden browser-API'er. Samme prioritering som
// enablePush() selv fejler i: understøttelse → hjemmeskærm → tilladelse.
function derivePushStatus({ supported, needsInstall, permission, hasSubscription }) {
  if (!supported) return "unsupported";
  if (needsInstall) return "needs-install";
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
      setError(e.message || "Noget gik galt — prøv igen.");
      // Tilladelsen kan netop være blevet afvist i prompten — aflæs den igen,
      // så kontakten låser med den rigtige forklaring frem for at friste igen.
      if (isPushSupported() && Notification.permission === "denied") setStatus("denied");
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
