// Tager skærmbillederne i `public/screenshots/` — dem, `manifest.json` peger på,
// og som Chrome viser i den rige installationsprompt (I23).
//
//   node scripts/screenshots/capture.mjs
//
// ---------------------------------------------------------------------------
// KØRES I HÅNDEN, PRÆCIS SOM `build-og-image.mjs`
//
// Hverken buildet eller CI kalder scriptet. Billederne ændrer sig kun, når
// skærmene gør, og et deploy skal ikke starte en browser. De committes sammen
// med koden — og `manifest.test.js` holder øje med, at det, manifestet lover om
// dem (filnavn, mål, størrelsesforhold), stadig passer på filerne.
//
// ---------------------------------------------------------------------------
// HVORDAN
//
// Vites udviklingsserver serverer harnessen i `scripts/screenshots/index.html`,
// som starter den RIGTIGE app med en attrap i stedet for en database (se
// `fake-rest.js`). Chromium åbner den én gang pr. skærmbillede — `?shot=<navn>`
// afgør, hvilken fane der trykkes frem — og skriver en PNG, som beskæres til
// appens egen ramme.
//
// Chromium køres gennem sin egen kommandolinje (`--headless --screenshot`) og
// ikke gennem Playwright eller Puppeteer. Selve browser-håndteringen — find
// den, kør den, ram en bestemt viewport — bor i `../chromium.mjs` siden `G127`,
// hvor sitets OG-billede fik brug for den samme.
//
// Bagefter beskæres billedet til appens egen ramme — telefonens 430 px brede
// spalte midt i viewporten — så resultatet er den app, en telefon ville vise,
// og ikke et browservindue med grå kanter.
//
// ---------------------------------------------------------------------------
// MÅLENE
//
// 430×932 CSS-pixels ved dobbelt pixeltæthed = 860×1864 rigtige pixels. 430 er
// `phone`s egen `maxWidth` (src/ui/theme.js), og 932 er højden på en iPhone 15
// Pro Max — altså den skærm, appen er tegnet til, i sin fulde bredde.
//
// Chromes egne krav til et skærmbillede i manifestet er tre, og de er alle
// opfyldt med god margin: mindst 320 og højst 3840 pixels på hver led, den
// længste side højst 2,3 gange den korteste (her 2,17), og ENS
// størrelsesforhold på alle skærmbilleder med samme `form_factor`. Det sidste
// er derfor ikke et valg pr. billede: skiftes målene, skiftes de for alle fire.
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beskær, læsPng, skrivPng } from "../png.mjs";
// Browseren selv — `findChrome`, `kør` og kalibreringen — bor i `chromium.mjs`
// (`G127`). Den lå her indtil 16. august 2026, hvor `build-og-image-site.mjs`
// blev den anden aftager.
import { findChrome, kalibrér, kør } from "../chromium.mjs";
// Selve harnessen — Vite-serveren og attrap-miljøet — bor i `harness.mjs`
// (`I24`). Den lå her indtil 15. august 2026, hvilket gjorde "kør appen uden
// Supabase" til noget, man kun kunne, hvis man også ville have fire PNG'er ud
// af det. `serve.mjs` er den anden aftager.
import { harnessURL, startHarness, ROD } from "./harness.mjs";

const UD = join(ROD, "public", "screenshots");

const APP_BREDDE = 430;
const APP_HØJDE = 932;
const TÆTHED = 2;

// Navnene er dem, `boot.js`s opskrifter kender, og filnavnene er dem,
// `public/manifest.json` peger på. Rækkefølgen her er den, manifestet lister
// dem i — og dermed den, Chrome viser dem i.
const BILLEDER = ["hjem", "tip", "stilling", "championship"];

async function skyd(chrome, opsætning, navn) {
  const rå = join(tmpdir(), `leagly-${navn}-rå.png`);
  await kør(chrome, [
    `--window-size=${opsætning.vindue.bredde},${opsætning.vindue.højde}`,
    `--force-device-scale-factor=${TÆTHED}`,
    `--screenshot=${rå}`,
    harnessURL({ shot: navn }),
  ]);
  if (!existsSync(rå)) throw new Error(`${navn}: browseren skrev intet billede`);

  // Beskæringen: appens egen spalte, centreret i viewporten. Alt uden for den er
  // `wrapOuter`s baggrund og browserens ramme — ikke app.
  const billede = læsPng(rå);
  unlinkSync(rå);
  const x = Math.round(((opsætning.viewport.bredde - APP_BREDDE) / 2) * TÆTHED);
  const beskåret = beskær(billede, x, 0, APP_BREDDE * TÆTHED, APP_HØJDE * TÆTHED);

  const fil = join(UD, `${navn}.png`);
  skrivPng(fil, beskåret);
  return { bredde: beskåret.bredde, højde: beskåret.højde, kb: readFileSync(fil).length / 1024 };
}

const chrome = findChrome();
mkdirSync(UD, { recursive: true });

const opsætning = await kalibrér(chrome, APP_BREDDE, APP_HØJDE);
console.log(`vindue ${opsætning.vindue.bredde}×${opsætning.vindue.højde} → viewport ${opsætning.viewport.bredde}×${opsætning.viewport.højde}`);

// HMR er slået FRA med vilje, og `startHarness` gør det som standard. Vites
// hot-reload holder en websocket åben, og en åben forbindelse er præcis dét,
// der kan få Chromiums virtuelle tid til at stå stille: browseren venter på et
// netværk, der aldrig bliver færdigt. Harnessen skal ikke genindlæse noget —
// hver kørsel er ét kald til én side. (`serve.mjs` slår den til, fordi der dér
// sidder et menneske og retter i appen.)
const server = await startHarness();
try {
  for (const navn of BILLEDER) {
    const { bredde, højde, kb } = await skyd(chrome, opsætning, navn);
    console.log(`public/screenshots/${navn}.png: ${bredde}×${højde}, ${kb.toFixed(1)} kB`);
  }
} finally {
  await server.close();
}
