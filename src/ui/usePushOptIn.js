// "Skal vi spørge om push?" ét sted.
//
// To kort kan bede om notifikationer — det frie opt-in-kort på Hjem og
// "Kom godt i gang"-checklistens sidste trin. De må ikke hver have sin
// definition af, hvornår spørgsmålet giver mening, og de må ikke kunne stå
// og spørge om det samme samtidig.
import { useState, useEffect } from "react";
import { enablePush, getExistingSubscription, isPushSupported } from "../lib/push.js";

const PUSH_DISMISS_KEY = "pc_push_dismissed";

// { state: null | "available" | "hidden", busy, error, enable(), dismiss() }
// `state === null` betyder "ved det ikke endnu" — kalderen viser intet imens,
// så kortet ikke når at blinke forbi for en bruger, der allerede er tilmeldt.
function usePushOptIn(token, userId) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!isPushSupported() || Notification.permission === "denied" || localStorage.getItem(PUSH_DISMISS_KEY)) {
          if (!cancelled) setState("hidden");
          return;
        }
        const sub = await getExistingSubscription();
        if (!cancelled) setState(sub ? "hidden" : "available");
      } catch (e) { if (!cancelled) setState("hidden"); }
    })();
    return () => { cancelled = true; };
  }, []);

  async function enable() {
    setBusy(true); setError("");
    try {
      await enablePush(token, userId);
      setState("hidden");
    } catch (e) {
      setError(e.message || "Noget gik galt — prøv igen.");
    } finally { setBusy(false); }
  }

  function dismiss() {
    try { localStorage.setItem(PUSH_DISMISS_KEY, "1"); } catch (e) {}
    setState("hidden");
  }

  return { state, available: state === "available", busy, error, enable, dismiss };
}

export { usePushOptIn, PUSH_DISMISS_KEY };
