import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Vagt over `public/manifest.json` (I23).
//
// ---------------------------------------------------------------------------
// HVORFOR MANIFESTET HAR BRUG FOR EN TEST
//
// JSON kan ikke bære en kommentar. Alt, hvad man skulle vide, før man retter en
// linje i den fil, må derfor stå et andet sted — og det "andet sted" er enten en
// tekst, ingen læser, eller en test, der siger fra. Her er begge dele samlet:
// begrundelserne står i kommentarerne nedenfor, og påstandene håndhæves.
//
// De fire ting, filen ikke selv kan sige:
//
//   1. `id` MÅ IKKE ÆNDRES. Den er appens identitet for browseren, og den er
//      sat til `"/"` netop fordi det er den værdi, browseren allerede har
//      udledt af `start_url`, siden den første installation. Skifter den, er
//      appen en ANDEN app: en installeret genvej peger på noget, der ikke
//      findes mere, og opdateringen kommer aldrig frem. Det er derfor `id`
//      overhovedet blev sat — så en senere ændring af `start_url` IKKE flytter
//      identiteten med sig.
//   2. `scope` afgrænser, hvad der åbnes inde i appen frem for i en browserfane.
//      `"/"` er hele originen, og appen bor alene på `app.leagly.app`
//      (`docs/DOMAENE.md`), så en snævrere scope ville kun kunne tage fejl.
//   3. Skærmbillederne er FILER, ikke tekst. `sizes` er en påstand om, hvad der
//      ligger på disken, og Chrome afviser tavst et skærmbillede, hvis målene
//      ikke passer, eller hvis to skærmbilleder med samme `form_factor` har
//      forskelligt størrelsesforhold. "Tavst" er hele problemet: prompten
//      falder bare tilbage til den nøgne ikon-dialog, og det er ikke noget,
//      nogen opdager på et deploy.
//   4. Beskrivelsen er den samme sætning som fem andre steder. Den påstand
//      håndhæves i `saelgesaetning.test.js` (G97) og gentages ikke her.
const ROD = dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(ROD, "public", "manifest.json"), "utf8"));

// Målene læses ud af PNG'ens hoved: efter signaturen (8 byte) kommer IHDR, hvor
// bredde og højde står som to 32-bit tal på position 16 og 20. Ingen afhængighed
// og ingen afkodning — vi skal kun bruge to tal.
function målene(sti) {
  const png = readFileSync(join(ROD, "public", sti.replace(/^\//, "")));
  if (png.toString("ascii", 1, 4) !== "PNG") throw new Error(`${sti} er ikke en PNG`);
  return { bredde: png.readUInt32BE(16), højde: png.readUInt32BE(20) };
}

describe("manifest.json (I23)", () => {
  it("har den identitet og det scope, en installeret app hænger på", () => {
    // Se punkt 1 og 2 ovenfor. Skal en af dem alligevel ændres, er det en
    // beslutning med konsekvenser for alle installerede apps — og så er det
    // testen her, der skal stå til regnskab for, hvorfor det er i orden.
    expect(MANIFEST.id).toBe("/");
    expect(MANIFEST.scope).toBe("/");
    expect(MANIFEST.start_url).toBe("/");
  });

  it("erklærer sproget, og det samme som appens egen HTML", () => {
    const html = readFileSync(join(ROD, "index.html"), "utf8");
    const sprog = html.match(/<html lang="([^"]+)"/)?.[1];
    expect(sprog, "index.html mangler lang på <html>").toBeTruthy();
    expect(MANIFEST.lang).toBe(sprog);
  });

  it("har mindst ét skærmbillede pr. form factor, og filerne findes", () => {
    expect(MANIFEST.screenshots?.length, "manifestet har ingen skærmbilleder").toBeGreaterThan(0);
    for (const s of MANIFEST.screenshots) {
      const { bredde, højde } = målene(s.src);
      expect(`${bredde}x${højde}`, `${s.src}: sizes passer ikke på filen`).toBe(s.sizes);
      expect(s.type).toBe("image/png");
      // Et skærmbillede uden etiket er stadig gyldigt, men etiketten er den
      // eneste tekst, en skærmlæser har at gå efter.
      expect(s.label?.length, `${s.src} mangler label`).toBeGreaterThan(10);
    }
  });

  it("overholder Chromes tre krav til målene", () => {
    const grupper = {};
    for (const s of MANIFEST.screenshots) {
      const { bredde, højde } = målene(s.src);
      // Mindst 320 og højst 3840 på hver led.
      expect(Math.min(bredde, højde), `${s.src} er for lille`).toBeGreaterThanOrEqual(320);
      expect(Math.max(bredde, højde), `${s.src} er for stor`).toBeLessThanOrEqual(3840);
      // Den længste side højst 2,3 gange den korteste.
      expect(Math.max(bredde, højde) / Math.min(bredde, højde), `${s.src} er for aflangt`).toBeLessThanOrEqual(2.3);
      (grupper[s.form_factor || "narrow"] ||= []).push({ src: s.src, forhold: bredde / højde });
    }
    // Ens størrelsesforhold inden for hver form factor. Chrome dropper hele
    // gruppen, hvis ét billede falder uden for — derfor måles de mod hinanden
    // og ikke mod en konstant.
    for (const [form, liste] of Object.entries(grupper)) {
      for (const s of liste) {
        expect(s.forhold, `${s.src} har et andet størrelsesforhold end resten af "${form}"`).toBeCloseTo(liste[0].forhold, 5);
      }
    }
  });
});
