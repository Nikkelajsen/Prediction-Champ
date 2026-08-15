// Harnessen: hele appen kørende mod en attrap-database (I23, løsrevet af I24).
//
// ---------------------------------------------------------------------------
// HVAD DEN ER
//
// Vites udviklingsserver, sat op så `scripts/screenshots/index.html` kan
// serveres. Den side starter den RIGTIGE app — `src/main.jsx`, ikke en kopi —
// men med `fake-rest.js` installeret først, så hvert Supabase-kald besvares af
// `demo-db.js` i stedet for af et netværk. Der er ingen database, ingen nøgler
// og ingen konto involveret.
//
// ---------------------------------------------------------------------------
// HVORFOR DEN LIGGER I SIN EGEN FIL
//
// Den lå indtil 15. august 2026 inde i `capture.mjs`, altså som et led i det
// script, der tager PNG'erne. Det var dér, den blev bygget, men det er ikke
// dér, den hører til: at køre appen uden Supabase er en EGENSKAB, og PNG'erne
// er én anvendelse af den. Så længe de to var samme fil, kunne harnessen kun
// bruges af en, der også ville have fire skærmbilleder ud af det.
//
// Løsrevet har den to aftagere i dag (`capture.mjs` og `serve.mjs`) og en
// oplagt tredje: `A42` spørger, om en rigtig browser skal have en plads i CI,
// og hvis svaret en dag bliver ja, er det HER, en browser-test ville pege — en
// app, der kan startes uden hemmeligheder, er forudsætningen for at kunne
// klikke den igennem i et CI-job.
//
// To aftagere er grænsen, og det er samme argument som `sql/tests/_schema.mjs`
// og `sql/checks/` hviler på: en regel, der køres to steder, må kun findes ét.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

export const ROD = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Ikke 5173. `npm run dev` har den port, og harnessen skal kunne køre ved siden
// af den rigtige udviklingsserver uden at den ene stjæler den andens plads.
export const PORT = 5199;

export const SIDE = "/scripts/screenshots/index.html";

// Adressen på harnessen, eventuelt med en opskrift.
//
// `shot` er `boot.js`s parameter: den afgør, hvilke knapper der trykkes efter
// boot. Uden den lander man på Hjem og kan klikke frit — hvilket er hele
// pointen med den løsrevne udgave.
export function harnessURL({ port = PORT, shot = null } = {}) {
  return `http://localhost:${port}${SIDE}${shot ? `?shot=${shot}` : ""}`;
}

// Attrappen svarer på alt, appen spørger om, men `src/lib/supabase.js` KASTER
// ved import, hvis variablerne mangler i udvikling (G4) — det er værnet mod, at
// en lokal kørsel tavst rammer produktion. Værdierne her er åbenlyst falske af
// samme grund som i `vite.config.js`' testopsætning: et rigtigt projekt-id
// ville være den samme tavse kobling i en anden forklædning.
//
// `.invalid` er reserveret af RFC 2606 og kan pr. definition ikke slås op i
// DNS. Slipper et kald udenom attrappen, fejler det derfor med det samme frem
// for at ramme noget.
export function sætDemoMiljø() {
  process.env.VITE_SUPABASE_URL = "https://demo.leagly.invalid";
  process.env.VITE_SUPABASE_KEY = "demo-key-ikke-en-rigtig-nøgle";
}

// Starter serveren og giver den tilbage, så kalderen kan lukke den igen.
//
// `hmr` er det ene, de to aftagere er uenige om, og uenigheden er ægte:
//
//   · `capture.mjs` slår den FRA. Vites hot-reload holder en websocket åben, og
//     en åben forbindelse kan få Chromiums virtuelle tid til at stå stille —
//     browseren venter på et netværk, der aldrig bliver færdigt. Hver kørsel er
//     ét kald til én side, så der er intet at genindlæse.
//   · `serve.mjs` slår den TIL. Der sidder et menneske og retter i appen, og
//     for dem er hot-reload hele grunden til at bruge Vite.
export async function startHarness({ port = PORT, hmr = false } = {}) {
  sætDemoMiljø();
  const server = await createServer({ root: ROD, server: { port, strictPort: true, hmr } });
  await server.listen();
  return server;
}
