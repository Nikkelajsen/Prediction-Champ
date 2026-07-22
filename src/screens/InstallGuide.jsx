// Vejledning i at føje appen til hjemmeskærmen (PWA-installation).
// Bruges både i første-login-modalen (MainApp) og i "Sådan virker det"-siden,
// så den altid kan genfindes. Trinene tilpasses platformen.
import { C } from "../ui/theme.js";

// Er appen allerede åbnet som installeret PWA? (så skjuler vi vejledningen)
export function isStandalone() {
  try {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
      || window.navigator.standalone === true;
  } catch (e) { return false; }
}

function detectPlatform() {
  const ua = navigator.userAgent || "";
  const iOS = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/i.test(ua) && typeof document !== "undefined" && "ontouchend" in document);
  if (iOS) return "ios";
  if (/android/i.test(ua)) return "android";
  return "desktop";
}

const STEPS = {
  ios: [
    "Åbn appen i Safari.",
    "Tryk på Del-ikonet (firkant med en pil op) nederst.",
    "Vælg “Føj til hjemmeskærm”, og tryk “Tilføj”.",
  ],
  android: [
    "Åbn browserens menu (⋮).",
    "Vælg “Installér app” eller “Føj til startskærm”.",
    "Bekræft — så ligger appen på din startskærm.",
  ],
  desktop: [
    "I Chrome/Edge: klik installér-ikonet yderst i adresselinjen,",
    "eller åbn menuen og vælg “Installér Prediction Champ”.",
  ],
};

function InstallGuide() {
  const platform = detectPlatform();
  const steps = STEPS[platform];
  const note = platform === "ios"
    ? "På iPhone/iPad virker push-notifikationer først, når appen er føjet til hjemmeskærmen."
    : "Så åbner Prediction Champ som en rigtig app — uden browser-linjen.";
  return (
    <div>
      <p style={{ margin: "0 0 10px", color: C.muted, fontSize: 14, lineHeight: 1.5 }}>
        Føj Prediction Champ til hjemmeskærmen, så den åbner som en app og altid er ét tryk væk.
      </p>
      <ol style={{ margin: "0 0 10px", paddingLeft: 18, color: C.text, fontSize: 14, lineHeight: 1.6 }}>
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <p style={{ margin: 0, color: C.muted, fontSize: 13, lineHeight: 1.5 }}>{note}</p>
    </div>
  );
}

export default InstallGuide;
