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
// HVORFOR ORDLYDEN IKKE ER MALET IND I BILLEDET
//
// Det oplagte ville være at brænde "Gæt resultater. Slå dine venner." ind under
// wordmarket. To ting taler imod, og de peger samme vej:
//
//   1. Der er ingen skrifttype at male med. Projektets egen Barlow ligger kun
//      som `.woff2` (public/fonts/), og at pakke en woff2 ud kræver Brotli PLUS
//      woff2'ens egen glyf-transformation — altså et bibliotek, projektet ikke
//      har og ikke skal have for ét billedes skyld. En systemskrift ville
//      hverken være Barlow eller findes på den næste maskine, scriptet køres på.
//   2. Det ville alligevel være det forkerte sted at skrive den. Et OG-billede
//      vises ofte som en miniature på ~120 px højde i en samtaleliste, hvor en
//      tagline sat ved 1200 px bredde er ulæselig. `og:title` bærer den samme
//      sætning som RIGTIG tekst — i modtagerens egen skriftstørrelse, aldrig
//      skaleret ned, og læsbar af en skærmlæser.
//
// Billedet siger derfor hvem, og `index.html`s tags siger hvad.
//
// ---------------------------------------------------------------------------
// HVAD DER SKER
//
// PNG ind → PNG ud, kun med `node:zlib`. Kilden er 1200×435 RGBA (en navy
// "pill" med det gule wordmark), målet er 1200×630 — det format, crawlere
// forventer (1,91:1). Wordmarket nedskaleres til 72 % og centreres på en flade i
// samme navy som pillen, så pillens runde hjørner smelter sammen med baggrunden
// og efterlader luft hele vejen rundt.
//
// Kilden har ALFA (de runde hjørner), målet har ikke: resultatet er
// uigennemsigtigt, og en gennemsigtig PNG er i forvejen noget, flere crawlere
// gengiver på sort. Derfor læses RGBA og skrives RGB.
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

const PNG_SIGNATUR = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---------------------------------------------------------------------------
// CRC32 — PNG'ens egen, samme polynomium som zlib's. Tabellen bygges én gang.
const CRC_TABEL = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABEL[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Læsning: chunks ud, IDAT samlet, scanlines af-filtreret.
//
// De fem filtertyper er PNG-formatets egne (0 None, 1 Sub, 2 Up, 3 Average,
// 4 Paeth). Alle fem SKAL kunne læses — hvilken der er brugt, afgør encoderen
// pr. række, og kilden er lavet af et værktøj, vi ikke selv styrer.
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function læsPng(sti) {
  const fil = readFileSync(sti);
  if (!fil.subarray(0, 8).equals(PNG_SIGNATUR)) throw new Error(`${sti} er ikke en PNG`);

  const idat = [];
  let bredde = 0;
  let højde = 0;
  let i = 8;
  while (i < fil.length) {
    const længde = fil.readUInt32BE(i);
    const type = fil.toString("ascii", i + 4, i + 8);
    if (type === "IHDR") {
      bredde = fil.readUInt32BE(i + 8);
      højde = fil.readUInt32BE(i + 12);
      const bitdybde = fil[i + 16];
      const farvetype = fil[i + 17];
      const interlace = fil[i + 20];
      // Scriptet kan ét format, og det er det, kilden har. Et andet skal fejle
      // højlydt frem for at give et billede, ingen kigger efter bagefter.
      if (bitdybde !== 8 || farvetype !== 6 || interlace !== 0) {
        throw new Error(`${sti}: forventede 8-bit RGBA uden interlace, fik bitdybde=${bitdybde} farvetype=${farvetype} interlace=${interlace}`);
      }
    } else if (type === "IDAT") {
      idat.push(fil.subarray(i + 8, i + 8 + længde));
    }
    i += 12 + længde;
    if (type === "IEND") break;
  }

  const bpp = 4;
  const stride = bredde * bpp;
  const rå = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(højde * stride);
  for (let y = 0; y < højde; y++) {
    const filter = rå[y * (stride + 1)];
    const kilde = rå.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const nu = px.subarray(y * stride, (y + 1) * stride);
    const før = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? nu[x - bpp] : 0;
      const b = før ? før[x] : 0;
      const c = x >= bpp && før ? før[x - bpp] : 0;
      let v = kilde[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      nu[x] = v & 0xff;
    }
  }
  return { bredde, højde, px };
}

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
// Skrivning: RGB, filter Up på alle rækker undtagen den første.
//
// Up frem for None er ikke pynt: fladen er ensfarvet navy over det meste af
// billedet, så en række, der er magen til den forrige, bliver til lutter
// nuller — og deflate pakker nuller til ingenting. Første række har ingen
// forgænger og bruger None.
function skrivPng(sti, bredde, højde, rgb) {
  const stride = bredde * 3;
  const rå = Buffer.alloc(højde * (stride + 1));
  for (let y = 0; y < højde; y++) {
    const ud = y * (stride + 1);
    rå[ud] = y === 0 ? 0 : 2;
    for (let x = 0; x < stride; x++) {
      const nu = rgb[y * stride + x];
      const før = y > 0 ? rgb[(y - 1) * stride + x] : 0;
      rå[ud + 1 + x] = (nu - (y === 0 ? 0 : før)) & 0xff;
    }
  }

  const chunk = (type, data) => {
    const ud = Buffer.alloc(12 + data.length);
    ud.writeUInt32BE(data.length, 0);
    ud.write(type, 4, "ascii");
    data.copy(ud, 8);
    ud.writeUInt32BE(crc32(ud.subarray(4, 8 + data.length)), 8 + data.length);
    return ud;
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(bredde, 0);
  ihdr.writeUInt32BE(højde, 4);
  ihdr[8] = 8; // bitdybde
  ihdr[9] = 2; // farvetype 2 = RGB uden alfa
  // 10-12: komprimering, filter, interlace — alle 0, som PNG kun tillader.

  writeFileSync(sti, Buffer.concat([
    PNG_SIGNATUR,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rå, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]));
}

// ---------------------------------------------------------------------------
const kilde = læsPng(KILDE);
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

skrivPng(MÅL, BREDDE, HØJDE, lærred);
console.log(`${MÅL}: ${BREDDE}×${HØJDE}, ${(readFileSync(MÅL).length / 1024).toFixed(1)} kB`);
