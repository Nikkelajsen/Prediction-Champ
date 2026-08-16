// Bygger `site/img/og-image.png` — det billede, der vises, når en side på
// hjemmesiden deles (G127).
//
//   node scripts/build-og-image-site.mjs
//
// ---------------------------------------------------------------------------
// HVORFOR DEN LIGGER VED SIDEN AF `build-og-image.mjs` OG IKKE INDE I DEN
//
// De to billeder er ikke det samme billede. Appens (`public/og-image.png`) er
// wordmarket alene og REGNES ud af PNG-matematik i ren Node; sitets er
// wordmarket PLUS sælgesætningen malet ind, og tekst kan Node ikke male: Barlow
// findes kun som `.woff2`, og at pakke en woff2 ud kræver Brotli plus woff2'ens
// egen glyf-transformation. Den begrundelse står stadig i søsterfilens hoved og
// gælder stadig.
//
// **Det, hovedet ikke kendte, var værktøjet.** Siden `I23` (15. august 2026)
// tager repoet skærmbilleder ved at køre Chromiums egen kommandolinje uden en
// eneste ny afhængighed — og en browser kan male med en woff2, for det er dét,
// den findes til. Skriftgengivelsen kostede altså ikke den afhængighed, prisen
// blev sat til; den var allerede betalt et andet sted i repoet.
//
// To scripts og ikke ét, fordi de kræver forskellige ting af maskinen: appens
// billede kan bygges hvor som helst, sitets kræver en Chrome. Et fælles script
// ville gøre den nemme halvdel afhængig af den svære.
//
// ---------------------------------------------------------------------------
// HVAD DER SKER
//
// `og-image-site.html` ER billedet — en side på 1200×630 med sitets egne
// tokens, sitets egen Barlow og wordmarket fra `public/`. Browseren åbner den
// og fotograferer den. Designet ligger derfor i en fil, man kan åbne og se, og
// ikke i tal spredt ud over et script.
//
// Kørslen er to browserstarter og ikke én: den første spørger siden, om Barlow
// faktisk blev brugt (`--dump-dom`), den anden tager billedet. Uden det første
// spørgsmål ville en manglende skrifttype give et billede, der ser rigtigt nok
// ud — og et OG-billede efterses af ingen, fordi det kun ses af dem, der ikke
// bruger appen endnu.
//
// Køres I HÅNDEN og committes sammen med sit resultat, præcis som søsterfilen
// og `screenshots/capture.mjs`. Billedet ændrer sig kun, når wordmarket eller
// sælgesætningen gør.
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beskær, læsPng, skrivPng } from "./png.mjs";
import { findChrome, kalibrér, kør } from "./chromium.mjs";

const HER = dirname(fileURLToPath(import.meta.url));
const ROD = join(HER, "..");
const KILDE = join(HER, "og-image-site.html");
const MÅL = join(ROD, "site", "img", "og-image.png");

// 1200×630 er det format, crawlere forventer (1,91:1) — samme mål som appens
// billede, og det, `seo.test.js` kræver, at `og:image:width`/`height` melder.
const BREDDE = 1200;
const HØJDE = 630;

const chrome = findChrome();
const opsætning = await kalibrér(chrome, BREDDE, HØJDE);

// ---------------------------------------------------------------------------
// Første kørsel: blev Barlow brugt?
const dom = await kør(chrome, ["--dump-dom", `file://${KILDE}`]);
const status = (dom.match(/<pre id="skriftstatus" hidden="">([^<]*)<\/pre>/) || [])[1];
if (status !== "barlow") {
  throw new Error(
    status === undefined
      ? `${KILDE}: siden svarede ikke på, om Barlow blev brugt — er skriftstatus-feltet fjernet?`
      : `Barlow blev IKKE brugt (siden svarede »${status}«). Billedet ville få en systemskrift.\n` +
        "Findes site/fonts/barlow-600-latin*.woff2 stadig, og passer stierne i og-image-site.html?",
  );
}

// ---------------------------------------------------------------------------
// Anden kørsel: selve billedet.
const rå = join(tmpdir(), "leagly-og-site-rå.png");
await kør(chrome, [
  `--window-size=${opsætning.vindue.bredde},${opsætning.vindue.højde}`,
  "--force-device-scale-factor=1",
  `--screenshot=${rå}`,
  `file://${KILDE}`,
]);
if (!existsSync(rå)) throw new Error("browseren skrev intet billede");

// Beskæringen fra (0,0) og ikke fra midten: `body` har `margin: 0`, så siden
// begynder i venstre kant, uanset hvor bred viewporten blev klemt op til.
const billede = læsPng(rå);
unlinkSync(rå);
skrivPng(MÅL, beskær(billede, 0, 0, BREDDE, HØJDE));
console.log(`${MÅL}: ${BREDDE}×${HØJDE}, ${(readFileSync(MÅL).length / 1024).toFixed(1)} kB`);
