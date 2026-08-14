// PNG ind og PNG ud — kun med `node:zlib`.
//
// ---------------------------------------------------------------------------
// HVORFOR DEN FINDES FOR SIG SELV
//
// Koden stod inde i `build-og-image.mjs`, som var den eneste, der havde brug
// for den. Da `capture.mjs` (I23) skulle beskære skærmbilleder, var der to
// veje: en kopi af en PNG-codec i fil nummer to, eller den her fil. En codec er
// præcis den slags kode, en kopi driver fra i det stille — en fejl i
// Paeth-filteret ét af stederne giver ikke en fejlmeddelelse, den giver et
// billede, der ser næsten rigtigt ud.
//
// Hvorfor ikke et bibliotek: projektet har fire runtime-afhængigheder, og det
// er et bevidst valg (`docs/DECISIONS.md`). At hente `sharp` eller `pngjs` ind
// for at læse et format, `node:zlib` allerede kan halvdelen af, er ikke en
// handel værd at lave.
//
// ---------------------------------------------------------------------------
// HVAD DEN KAN
//
// 8 bit pr. kanal, uden interlace, RGB (farvetype 2) eller RGBA (farvetype 6).
// Det er dét, både `leagly-wordmark-navy.png` og Chromiums skærmbilleder er, og
// alt andet KASTER frem for at gætte: et billede, der er læst forkert, opdager
// ingen, før det står på et markedsføringsmateriale.
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

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

// De fem filtertyper er PNG-formatets egne (0 None, 1 Sub, 2 Up, 3 Average,
// 4 Paeth). Alle fem SKAL kunne læses — hvilken der er brugt, afgør encoderen
// pr. række, og kilderne er lavet af værktøjer, vi ikke selv styrer.
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// Læser en PNG til rå pixels. `kanaler` er 3 (RGB) eller 4 (RGBA) — kalderen
// skal vide hvilken, og filen er den eneste, der ved det.
function læsPng(sti) {
  const fil = readFileSync(sti);
  if (!fil.subarray(0, 8).equals(PNG_SIGNATUR)) throw new Error(`${sti} er ikke en PNG`);

  const idat = [];
  let bredde = 0;
  let højde = 0;
  let kanaler = 0;
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
      if (bitdybde !== 8 || (farvetype !== 2 && farvetype !== 6) || interlace !== 0) {
        throw new Error(`${sti}: forventede 8-bit RGB/RGBA uden interlace, fik bitdybde=${bitdybde} farvetype=${farvetype} interlace=${interlace}`);
      }
      kanaler = farvetype === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      // Flere IDAT-chunks er normalt — encodere deler strømmen op i portioner,
      // og de skal sættes sammen FØR de pakkes ud.
      idat.push(fil.subarray(i + 8, i + 8 + længde));
    }
    i += 12 + længde;
    if (type === "IEND") break;
  }

  const stride = bredde * kanaler;
  const rå = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(højde * stride);
  for (let y = 0; y < højde; y++) {
    const filter = rå[y * (stride + 1)];
    const kilde = rå.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const nu = px.subarray(y * stride, (y + 1) * stride);
    const før = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= kanaler ? nu[x - kanaler] : 0;
      const b = før ? før[x] : 0;
      const c = x >= kanaler && før ? før[x - kanaler] : 0;
      let v = kilde[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      nu[x] = v & 0xff;
    }
  }
  return { bredde, højde, kanaler, px };
}

// Skriver rå pixels som PNG med filter Up på alle rækker undtagen den første.
//
// Up frem for None er ikke pynt: store flader i disse billeder er ensfarvede, så
// en række, der er magen til den forrige, bliver til lutter nuller — og deflate
// pakker nuller til ingenting. Første række har ingen forgænger og bruger None.
function skrivPng(sti, { bredde, højde, kanaler, px }) {
  const stride = bredde * kanaler;
  const rå = Buffer.alloc(højde * (stride + 1));
  for (let y = 0; y < højde; y++) {
    const ud = y * (stride + 1);
    rå[ud] = y === 0 ? 0 : 2;
    for (let x = 0; x < stride; x++) {
      const nu = px[y * stride + x];
      const før = y > 0 ? px[(y - 1) * stride + x] : 0;
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
  ihdr[8] = 8;                       // bitdybde
  ihdr[9] = kanaler === 4 ? 6 : 2;   // farvetype: 6 = RGBA, 2 = RGB
  // 10-12: komprimering, filter, interlace — alle 0, som PNG kun tillader.

  writeFileSync(sti, Buffer.concat([
    PNG_SIGNATUR,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rå, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]));
}

// Klipper et rektangel ud. Ligger her og ikke hos kalderen, fordi den er den
// eneste operation, der skal kende `kanaler` og `stride` — altså formatets
// detaljer, som resten af filen findes for at skjule.
function beskær(billede, x, y, bredde, højde) {
  if (x < 0 || y < 0 || x + bredde > billede.bredde || y + højde > billede.højde) {
    throw new Error(`beskæringen (${x},${y} ${bredde}×${højde}) ligger uden for billedet (${billede.bredde}×${billede.højde})`);
  }
  const k = billede.kanaler;
  const px = Buffer.alloc(bredde * højde * k);
  for (let r = 0; r < højde; r++) {
    billede.px.copy(px, r * bredde * k, ((y + r) * billede.bredde + x) * k, ((y + r) * billede.bredde + x + bredde) * k);
  }
  return { bredde, højde, kanaler: k, px };
}

export { læsPng, skrivPng, beskær };
