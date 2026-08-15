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
// ikke gennem Playwright eller Puppeteer. Grunden er den samme som alle andre
// steder i repoet: fire runtime-afhængigheder er et bevidst valg, og et
// browser-bibliotek på et par hundrede megabyte for fire PNG'er er ikke en god
// handel. Prisen er, at maskinen skal HAVE en Chrome eller Chromium — se
// `findChrome()`.
//
// ---------------------------------------------------------------------------
// HVORFOR DER KALIBRERES FØR DER FOTOGRAFERES
//
// `--window-size` er ikke det samme som viewporten, og forskellen er ikke den
// samme fra browser til browser: den Chromium, dette blev skrevet på, har et
// MINDSTEMÅL på bredden (500 px) og trækker ~87 px fra højden til sin egen
// ramme. Skrev vi målene i hånden, ville skærmbillederne blive skæve på den
// næste maskine — og det ville se ud som et designproblem, ikke som en
// forkert flag-værdi.
//
// Derfor spørger scriptet browseren FØRST (`--dump-dom` på en side, der skriver
// sin egen `innerWidth`/`innerHeight`), regner vinduet ud, der giver den ønskede
// viewport, og efterprøver svaret. Bagefter beskæres billedet til appens egen
// ramme — telefonens 430 px brede spalte midt i viewporten — så resultatet er
// den app, en telefon ville vise, og ikke et browservindue med grå kanter.
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
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beskær, læsPng, skrivPng } from "../png.mjs";
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

// Chrome findes ikke det samme sted på to maskiner, og der er ingen pakke at
// spørge. Rækkefølgen er: sig det selv (CHROME), Playwrights browser hvis den
// tilfældigvis er installeret, og derefter de sædvanlige stier.
function findChrome() {
  const kandidater = [
    process.env.CHROME,
    process.env.PLAYWRIGHT_BROWSERS_PATH && join(process.env.PLAYWRIGHT_BROWSERS_PATH, "chromium", "chrome"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const fundet = kandidater.find((sti) => existsSync(sti));
  if (!fundet) {
    throw new Error(
      "Fandt ingen Chrome/Chromium. Sæt CHROME=<sti til browseren> og kør igen.\n" +
      "Prøvede:\n  " + kandidater.join("\n  "),
    );
  }
  return fundet;
}

// Kører browseren og venter — ASYNKRONT, og det er ikke en detalje. Med
// `spawnSync` blokerer Node sin egen event loop, og så kan Vite-serveren i
// samme proces ikke svare på et eneste modul. Browseren venter da på en side,
// der aldrig kommer, indtil dens tidsbudget er brugt op. Fejlen ligner en hængt
// browser og er en hængt server.
function kør(chrome, argumenter) {
  const profil = mkdtempSync(join(tmpdir(), "leagly-shot-"));
  return new Promise((resolve, reject) => {
    const p = spawn(chrome, [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      // Animationer gør billedet UFORUDSIGELIGT: live-prikken pulser i 1,4
      // sekunders takt, og hvilket sted i takten billedet rammer, afhænger af,
      // hvornår den virtuelle tid løber ud. To kørsler gav derfor to forskellige
      // PNG'er af den samme skærm.
      //
      // Flaget er appens EGEN vej ud af det: `prefers-reduced-motion: reduce`
      // slukker alle fire animationer i `src/ui/theme.js` (`G22`), og
      // grundtilstanden er den, en bruger med den indstilling ser. Et lag
      // indsprøjtet CSS ville gøre det samme og samtidig gøre skærmbilledet til
      // noget, ingen bruger kan få vist.
      "--force-prefers-reduced-motion",
      `--user-data-dir=${profil}`,
      // Virtuel tid: browseren spoler sine egne timere frem, så de halvandet
      // sekunds ventetid i `boot.js` mellem hvert tryk ikke koster halvandet
      // sekund. Budgettet er loftet for HELE siden — er det brugt op, tages
      // billedet, uanset hvor langt appen er nået.
      "--virtual-time-budget=30000",
      ...argumenter,
    ], { encoding: "utf8" });
    let ud = "";
    p.stdout.on("data", (d) => { ud += d; });
    p.stderr.on("data", () => { /* Chromium skriver dbus- og socket-støj, der intet betyder her */ });
    p.on("error", reject);
    p.on("close", () => { rmSync(profil, { recursive: true, force: true }); resolve(ud); });
  });
}

// Hvilken viewport giver et vindue på (bredde × højde)? Siden skriver svaret i
// sin egen DOM, og `--dump-dom` skriver DOM'en til stdout.
async function målViewport(chrome, bredde, højde) {
  const sti = join(tmpdir(), "leagly-kalibrering.html");
  writeFileSync(sti, `<html><body><pre id="m"></pre><script>m.textContent=innerWidth+"x"+innerHeight;</script></body></html>`);
  const dom = await kør(chrome, [`--window-size=${bredde},${højde}`, "--dump-dom", `file://${sti}`]);
  unlinkSync(sti);
  const m = dom.match(/<pre id="m">(\d+)x(\d+)<\/pre>/);
  if (!m) throw new Error(`kunne ikke måle browserens viewport:\n${dom.slice(0, 500)}`);
  return { bredde: Number(m[1]), højde: Number(m[2]) };
}

async function kalibrér(chrome) {
  // Første måling: bed om præcis den viewport, vi vil have, og se hvad vi får.
  const første = await målViewport(chrome, APP_BREDDE, APP_HØJDE);
  // Bredden kan være klemt op til et mindstemål; højden mangler typisk det, som
  // browserens egen ramme optager. Begge dele rettes ved at bede om et vindue,
  // der er så meget større.
  const vindue = {
    bredde: Math.max(APP_BREDDE, første.bredde),
    højde: APP_HØJDE + (APP_HØJDE - første.højde),
  };
  const anden = await målViewport(chrome, vindue.bredde, vindue.højde);
  if (anden.bredde < APP_BREDDE || anden.højde !== APP_HØJDE) {
    throw new Error(
      `kunne ikke ramme en viewport på ${APP_BREDDE}×${APP_HØJDE}: et vindue på ` +
      `${vindue.bredde}×${vindue.højde} gav ${anden.bredde}×${anden.højde}.`,
    );
  }
  return { vindue, viewport: anden };
}

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

const opsætning = await kalibrér(chrome);
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
