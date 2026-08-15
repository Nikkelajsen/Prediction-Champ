// Kør hele appen mod en attrap-database, uden Supabase (I24).
//
//   npm run harness
//
// ---------------------------------------------------------------------------
// HVAD DEN ER TIL
//
// Ét sted at klikke appen igennem uden en database, en konto eller en nøgle.
// Harnessen (`harness.mjs`) fandtes i forvejen — den er dét, `capture.mjs`
// bruger til at fotografere de fire skærme i `manifest.json` — men lå indtil
// 15. august 2026 kun som et led i det script. Man kunne altså køre appen uden
// Supabase, hvis man samtidig ville have fire PNG'er ud af det.
//
// Tre situationer, den er svaret på:
//
//   1. **Se en ændring på en skærm, der kræver data.** Hjem, Tip, stillingen og
//      Championship er alle tomme uden en database. `npm run dev` viser dem
//      ikke; her er de fyldte.
//   2. **Arbejde uden hemmeligheder.** Ingen `.env`, intet Supabase-projekt,
//      ingen risiko for at ramme produktion (`G4`s værn er stadig aktivt —
//      variablerne peger på `.invalid`).
//   3. **Forudsætningen for `A42`.** Skal en rigtig browser en dag have en
//      plads i CI, er en app, der kan startes uden hemmeligheder, det, en
//      browser-test ville pege på.
//
// ---------------------------------------------------------------------------
// HVAD DEN IKKE ER
//
// **Ikke `npm run dev`.** Den rigtige udviklingsserver taler med en rigtig
// database og er stadig den, man bruger til alt, der skal SKRIVE noget.
// Attrappen svarer på læsninger; en skrivning går ingen steder, og næste
// genindlæsning har glemt den. Se `fake-rest.js` for hvad den dækker.
//
// **Ikke en test.** Der er ingen påstande her, og en skærm, der ser rigtig ud i
// harnessen, er ikke bevist rigtig. Dataene er `demo-db.js`' opdigtede sæson,
// valgt så skærmbillederne bliver pæne — ikke så randtilfældene bliver ramt.
import { harnessURL, startHarness, PORT } from "./harness.mjs";

const server = await startHarness({ hmr: true });

console.log(`
  Leagly kører mod attrap-databasen — ingen Supabase, ingen nøgler.

    ${harnessURL()}

  Skærmene nås ved at klikke, præcis som en bruger ville: fanebladene
  nederst, og konkurrencens stilling gennem "Dine placeringer" på Hjem.

  Vil du springe direkte til én af skærmbilledernes opskrifter, så føj
  ?shot=<navn> til adressen — hjem · tip · stilling · championship ·
  ligaer · rating (se OPSKRIFTER i boot.js).

  Ctrl+C for at stoppe.
`);

// Uden dette lukker Node, så snart der ikke er mere at gøre — Vites server
// alene holder ikke processen i live på alle platforme.
process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});

// Porten er `strictPort`, så en optaget port er en fejl og ikke et stille skift
// til en anden. Adressen ovenfor skal kunne kopieres, uden at man først læser
// efter, om den passer.
if (server.config.server.port !== PORT) {
  throw new Error(`harnessen lyttede på ${server.config.server.port} og ikke ${PORT}`);
}
