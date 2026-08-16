// Bygger `public/og-image.png` — det billede, der vises, når et invitationslink
// deles i Messenger, WhatsApp eller iMessage (I7).
//
// ---------------------------------------------------------------------------
// HVORFOR ET SCRIPT OG IKKE BARE EN FIL
//
// Billedet er ikke tegnet; det er REGNET ud af `public/leagly-wordmark-navy.png`,
// som allerede findes og allerede er brandet rigtigt. Ligger opskriften kun i
// hovedet på den, der lavede filen, kan billedet ikke genskabes den dag
// wordmarket skiftes — og et OG-billede, der er en generation bagud, opdager
// ingen, fordi det kun ses af dem, der ikke bruger appen endnu.
//
// Scriptet køres I HÅNDEN (`node scripts/build-og-image.mjs`) og committes
// sammen med sit resultat. Det hører ikke til i `npm run build`: billedet ændrer
// sig kun, når wordmarket gør, og et deploy skal ikke bruge tid på at regne den
// samme fil ud hver gang.
//
// ---------------------------------------------------------------------------
// SITETS OG-BILLEDE ER EN ANDEN FIL OG BYGGES AF ET ANDET SCRIPT
//
// `site/img/og-image.png` er hjemmesidens, og det ER wordmarket plus
// sælgesætningen malet ind. Det bygges af `build-og-image-site.mjs` — læs dét
// hoved, hvis det er sitets billede, du skal have fat i. Indtil `G127`
// (16. august 2026) fandtes det script ikke, og filen var lavet uden for repoet
// med et værktøj, ingen havde skrevet ned; det var ordret den tilstand, dette
// hoved siger, det findes for at undgå.
//
// ---------------------------------------------------------------------------
// HVORFOR ORDLYDEN IKKE ER MALET IND I APPENS BILLEDE
//
// Det oplagte ville være at brænde "Gæt resultater. Slå dine venner." ind under
// wordmarket. To ting taler imod:
//
//   1. Der er ingen skrifttype at male med HER. Projektets egen Barlow ligger
//      kun som `.woff2` (public/fonts/), og at pakke en woff2 ud kræver Brotli
//      PLUS woff2'ens egen glyf-transformation — altså et bibliotek, projektet
//      ikke har og ikke skal have for ét billedes skyld. En systemskrift ville
//      hverken være Barlow eller findes på den næste maskine, scriptet køres på.
//   2. Det ville alligevel være det forkerte sted at skrive den. Et OG-billede
//      vises ofte som en miniature på ~120 px højde i en samtaleliste, hvor en
//      tagline sat ved 1200 px bredde er ulæselig. `og:title` bærer den samme
//      sætning som RIGTIG tekst — i modtagerens egen skriftstørrelse, aldrig
//      skaleret ned, og læsbar af en skærmlæser.
//
// **Punkt 1 er blevet snævrere, end det lyder, og det er værd at vide hvorfor.**
// Det gælder for REN NODE, ikke for repoet: siden `I23` (15. august 2026)
// tegner `screenshots/capture.mjs` PNG'er ved at køre Chromiums egen
// kommandolinje uden en eneste ny afhængighed, og en browser maler med en woff2
// uden videre. Skriftgengivelsen kostede altså aldrig den afhængighed, prisen
// blev sat til — den lå bare i et andet værktøj. Det er dén vej,
// `build-og-image-site.mjs` går. **Punkt 2 er uændret**, og det er derfor
// APPENS billede stadig er wordmarket alene: det er en designbeslutning om et
// link-preview i en samtaleliste, ikke en pris på en afhængighed.
//
// Billedet siger derfor hvem, og `index.html`s tags siger hvad.
//
// ---------------------------------------------------------------------------
// HVAD DER SKER
//
// PNG ind → PNG ud. Selve codec'en bor i `png.mjs` siden `I23`, hvor
// skærmbilled-scriptet fik brug for den samme — kun `node:zlib`, ingen
// afhængighed. Kilden er 1200×435 RGBA (en navy
// "pill" med det gule wordmark), målet er 1200×630 — det format, crawlere
// forventer (1,91:1). Wordmarket nedskaleres til 72 % og centreres på en flade i
// samme navy som pillen, så pillens runde hjørner smelter sammen med baggrunden
// og efterlader luft hele vejen rundt.
//
// Kilden har ALFA (de runde hjørner), målet har ikke: resultatet er
// uigennemsigtigt, og en gennemsigtig PNG er i forvejen noget, flere crawlere
// gengiver på sort. Derfor læses RGBA og skrives RGB.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { læsPng, skrivPng } from "./png.mjs";

const ROD = join(dirname(fileURLToPath(import.meta.url)), "..");
const KILDE = join(ROD, "public", "leagly-wordmark-navy.png");
const MÅL = join(ROD, "public", "og-image.png");

const BREDDE = 1200;
const HØJDE = 630;
// Samme navy som `<body>` i index.html og `theme-color` — baggrunden skal være
// den farve, appen selv åbner i, ellers blinker den ved første indlæsning.
const BAGGRUND = [0x0c, 0x16, 0x22];
// 72 %: nok luft til at wordmarket ikke rører kanten, og stort nok til at kunne
// læses i en miniature. Ændres tallet, flytter centreringen nedenfor med.
const SKALA = 0.72;

// ---------------------------------------------------------------------------
// Nedskalering med boks-filter (arealgennemsnit).
//
// Ikke nærmeste nabo: wordmarket er gult på navy med bløde kanter, og en
// punktprøve ville lave takker i netop de kurver, logoet består af. Alfa
// PRÆMULTIPLICERES undervejs — ellers ville en gennemsigtig sort kantpixel
// trække farven mod sort, hvilket er den klassiske grå bræmme om et skaleret
// logo.
function nedskalér(kilde, nyBredde, nyHøjde) {
  const ud = Buffer.alloc(nyBredde * nyHøjde * 4);
  const xSkala = kilde.bredde / nyBredde;
  const ySkala = kilde.højde / nyHøjde;
  for (let y = 0; y < nyHøjde; y++) {
    const y0 = Math.floor(y * ySkala);
    const y1 = Math.min(kilde.højde, Math.max(y0 + 1, Math.ceil((y + 1) * ySkala)));
    for (let x = 0; x < nyBredde; x++) {
      const x0 = Math.floor(x * xSkala);
      const x1 = Math.min(kilde.bredde, Math.max(x0 + 1, Math.ceil((x + 1) * xSkala)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const p = (sy * kilde.bredde + sx) * 4;
          const alfa = kilde.px[p + 3] / 255;
          r += kilde.px[p] * alfa;
          g += kilde.px[p + 1] * alfa;
          b += kilde.px[p + 2] * alfa;
          a += alfa;
          n++;
        }
      }
      const p = (y * nyBredde + x) * 4;
      // Tilbage fra præmultipliceret: divider med den summerede alfa, ikke med
      // antallet af pixels.
      ud[p] = a > 0 ? Math.round(r / a) : 0;
      ud[p + 1] = a > 0 ? Math.round(g / a) : 0;
      ud[p + 2] = a > 0 ? Math.round(b / a) : 0;
      ud[p + 3] = Math.round((a / n) * 255);
    }
  }
  return { bredde: nyBredde, højde: nyHøjde, px: ud };
}

// ---------------------------------------------------------------------------
const kilde = læsPng(KILDE);
// `nedskalér` regner med alfa i hver fjerde byte. En kilde uden alfa ville give
// et billede, hvor hver fjerde farvekanal blev læst som gennemsigtighed — altså
// noget, der ligner en fejl i logoet frem for en fejl i koden.
if (kilde.kanaler !== 4) throw new Error(`${KILDE}: forventede RGBA, fik ${kilde.kanaler} kanaler`);
const skaleret = nedskalér(kilde, Math.round(kilde.bredde * SKALA), Math.round(kilde.højde * SKALA));

const lærred = Buffer.alloc(BREDDE * HØJDE * 3);
for (let p = 0; p < lærred.length; p += 3) {
  lærred[p] = BAGGRUND[0];
  lærred[p + 1] = BAGGRUND[1];
  lærred[p + 2] = BAGGRUND[2];
}

const offsetX = Math.round((BREDDE - skaleret.bredde) / 2);
const offsetY = Math.round((HØJDE - skaleret.højde) / 2);
for (let y = 0; y < skaleret.højde; y++) {
  for (let x = 0; x < skaleret.bredde; x++) {
    const s = (y * skaleret.bredde + x) * 4;
    const alfa = skaleret.px[s + 3] / 255;
    if (alfa === 0) continue;
    const d = ((y + offsetY) * BREDDE + (x + offsetX)) * 3;
    for (let k = 0; k < 3; k++) {
      lærred[d + k] = Math.round(skaleret.px[s + k] * alfa + lærred[d + k] * (1 - alfa));
    }
  }
}

skrivPng(MÅL, { bredde: BREDDE, højde: HØJDE, kanaler: 3, px: lærred });
console.log(`${MÅL}: ${BREDDE}×${HØJDE}, ${(readFileSync(MÅL).length / 1024).toFixed(1)} kB`);
