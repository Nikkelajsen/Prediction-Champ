// Skærmbilled-harnessens indgang (I23).
//
// Rækkefølgen er hele filen: attrappen SKAL være installeret, før en eneste
// linje af appen kører — `src/lib/supabase.js` læser sine miljøvariabler ved
// import, og `App.jsx` henter den gemte session i sin første effekt. Derfor
// `installér()` først og appen bagefter med et dynamisk `import`, som er det
// eneste, der garanterer den rækkefølge inde i ét modul.
//
// Bagefter navigeres der. Hvert skærmbillede er ét kald til Chromium med
// `?shot=<navn>`, og opskriften nedenfor trykker på de samme knapper, en bruger
// ville trykke på — der er ingen bagvej ind i `MainApp`s tilstand, og det skal
// der heller ikke være: en skærm, man ikke kan NÅ, er ikke en skærm at
// fotografere.
import { installér } from "./fake-rest.js";

installér();

await import("/src/main.jsx");

// Fanebladenes etiketter, som de står i `MainApp.jsx`. Slår opslaget fejl,
// kaster vi — et skærmbillede af den forkerte fane er værre end ingen, fordi
// det ligner et rigtigt billede.
const OPSKRIFTER = {
  hjem: [],
  tip: ["Tip"],
  // Konkurrencens stilling nås fra "Dine placeringer" nederst på Hjem — det er
  // den vej, en bruger går, og der er ingen fane, der fører direkte dertil.
  stilling: ["Kontorets Premier League"],
  championship: ["Championship"],
  ligaer: ["Ligaer"],
  rating: ["Rating"],
};

function vent(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Vent til en knap med teksten findes, og tryk.
//
// EKSAKT match først, dernæst begyndelsen. Fanebladenes knapper har præcis
// etiketten som tekst, mens en række i "Dine placeringer" bærer både navnet og
// sin placering ("Kontorets Premier League1."). Den omvendte rækkefølge ville
// gøre `"Tip"` tvetydig — "Tip nu" står på Hjem og begynder med det samme ord.
async function tryk(tekst) {
  for (let forsøg = 0; forsøg < 100; forsøg++) {
    const knapper = [...document.querySelectorAll("button")];
    const knap = knapper.find((b) => b.textContent.trim() === tekst)
      || knapper.find((b) => b.textContent.trim().startsWith(tekst));
    if (knap) { knap.click(); return; }
    await vent(100);
  }
  throw new Error(`fandt ingen knap med teksten "${tekst}"`);
}

const navn = new URLSearchParams(window.location.search).get("shot") || "hjem";
const opskrift = OPSKRIFTER[navn];
if (!opskrift) throw new Error(`ukendt skærmbillede: ${navn}`);

// Første maling af Hjem venter på et halvt dusin opslag. Ventetiden er virtuel
// (Chromium kører med `--virtual-time-budget`), så den koster ikke rigtige
// sekunder — den giver bare loaderne lov til at blive færdige, før der trykkes.
await vent(1500);
for (const tekst of opskrift) {
  await tryk(tekst);
  await vent(1500);
}
document.documentElement.dataset.klar = "1";
