// Browseren som værktøj: find den, kør den, ram en bestemt viewport.
//
// ---------------------------------------------------------------------------
// HVORFOR DEN LIGGER I SIN EGEN FIL
//
// Koden stod inde i `screenshots/capture.mjs`, som var den eneste, der havde
// brug for en browser. `G127` gav den en aftager mere — `build-og-image-site.mjs`
// tegner sitets OG-billede i en browser, fordi det er dér, Barlow allerede kan
// males med — og to kopier af "find en Chrome og ram 1200×630" ville drive fra
// hinanden uden at fejle. Samme udskillelse og samme begrundelse som `png.mjs`
// fik under `I23` og `harness.mjs` under `I24`.
//
// ---------------------------------------------------------------------------
// HVORFOR IKKE PLAYWRIGHT ELLER PUPPETEER
//
// Browseren køres gennem sin egen kommandolinje (`--headless --screenshot`).
// Grunden er den samme som alle andre steder i repoet: fire
// runtime-afhængigheder er et bevidst valg, og et browser-bibliotek på et par
// hundrede megabyte er ikke en god handel for en håndfuld PNG'er, der bygges i
// hånden. Prisen er, at maskinen skal HAVE en Chrome eller Chromium — se
// `findChrome()`.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Chrome findes ikke det samme sted på to maskiner, og der er ingen pakke at
// spørge. Rækkefølgen er: sig det selv (CHROME), Playwrights browser hvis den
// tilfældigvis er installeret, og derefter de sædvanlige stier.
export function findChrome() {
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
// `spawnSync` blokerer Node sin egen event loop, og så kan en Vite-server i
// samme proces (harnessen) ikke svare på et eneste modul. Browseren venter da på
// en side, der aldrig kommer, indtil dens tidsbudget er brugt op. Fejlen ligner
// en hængt browser og er en hængt server.
export function kør(chrome, argumenter) {
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
      // billedet, uanset hvor langt siden er nået.
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

// ---------------------------------------------------------------------------
// HVORFOR DER KALIBRERES FØR DER FOTOGRAFERES
//
// `--window-size` er ikke det samme som viewporten, og forskellen er ikke den
// samme fra browser til browser: den Chromium, dette blev skrevet på, har et
// MINDSTEMÅL på bredden (500 px) og trækker ~87 px fra højden til sin egen
// ramme. Skrev vi målene i hånden, ville billederne blive skæve på den næste
// maskine — og det ville se ud som et designproblem, ikke som en forkert
// flag-værdi.
//
// Derfor spørges browseren FØRST, vinduet regnes ud, og svaret efterprøves.
// Bredden må gerne blive større end ønsket (den klemmes op til et mindstemål og
// beskæres bagefter); højden skal ramme præcist.
export async function kalibrér(chrome, bredde, højde) {
  const første = await målViewport(chrome, bredde, højde);
  const vindue = {
    bredde: Math.max(bredde, første.bredde),
    højde: højde + (højde - første.højde),
  };
  const anden = await målViewport(chrome, vindue.bredde, vindue.højde);
  if (anden.bredde < bredde || anden.højde !== højde) {
    throw new Error(
      `kunne ikke ramme en viewport på ${bredde}×${højde}: et vindue på ` +
      `${vindue.bredde}×${vindue.højde} gav ${anden.bredde}×${anden.højde}.`,
    );
  }
  return { vindue, viewport: anden };
}
