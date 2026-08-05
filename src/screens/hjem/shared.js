// De to små ting, Hjem-fanen og dens kort deler.
//
// Modulet findes, fordi `cardTight` bruges BÅDE af karusellens kort og af to
// kort i selve fanen — havde den fulgt karusellen ud, ville polstringen stå to
// steder og kunne blive uenig med sig selv. `shortKick` er ren formatering og
// har intet med React at gøre. Ren flytning ud af `HjemTab.jsx` (G1, august
// 2026).
import { APP_TZ } from "../../lib/scoring.js";

// Kompakt kort: mindre luft, ikke mindre indhold.
//
// Hjem er en oversigt, og de øverste kort skubbede alt det, oversigten handler
// om ("Indeværende runde", "Dine placeringer"), under skærmkanten på en telefon.
// Prisen blev betalt af CHROME og ikke af budskabet: den vandrette streg er
// polstring (16 → 12/14), og hvert kort havde en handlingsknap på sin EGEN
// linje, selvom rækken over den havde plads til overs.
//
// Reglen, der afgør hvilke kort der bliver kompakte: et kort, der BEKRÆFTER
// noget ("alt ok", "intet at tippe"), er en kvittering og skal fylde derefter —
// mens deadline-kortet, det ene med en frist og en konsekvens, beholder sin
// fulde højde og sin egen knap. Karusellen bliver kompakt af den anden grund:
// den er indhold, ingen har bedt om, og skal kunne ses uden at eje skærmen.
const cardTight = { padding: "12px 14px" };

// kompakt kickoff til runde-oversigten (fx "man. 12.05. 14.00")
function shortKick(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const day = d.toLocaleDateString("da-DK", { timeZone: APP_TZ, weekday: "short", day: "2-digit", month: "2-digit" });
  const t = d.toLocaleTimeString("da-DK", { timeZone: APP_TZ, hour: "2-digit", minute: "2-digit" });
  return `${day} ${t}`;
}

export { cardTight, shortKick };
