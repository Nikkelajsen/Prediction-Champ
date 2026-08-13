import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Vagt over sælgesætningen (G97).
//
// ---------------------------------------------------------------------------
// HVORFOR DUBLETTEN IKKE KAN FJERNES
//
// Den ene sætning — sælgesætningen, hvis anker er `index.html`s
// `<meta name="description">` — står i FEM filer, og ingen af dem kan hente
// den fra de andre:
//
// (Ordlyden stod skrevet her indtil 13. august 2026. Den blev fjernet samme
// dag, den blev omformuleret: en kommentar, der citerer teksten, er lige så
// meget en sjette kopi som en kodelinje, der gør det — den bliver bare forkert
// uden at nogen test kan opdage det. Se afsnittet nedenfor.)
//
//   · `index.html` er statisk HTML. `<meta name="description">` og
//     `og:description` læses af crawlere, FØR noget JavaScript kører, så de kan
//     pr. konstruktion ikke importere fra `src/`.
//   · `site/index.html` ligger med vilje uden for Vite-buildet
//     (`docs/features/hjemmeside-v1.md`), så den kan slet ikke dele modul med
//     appen.
//   · `api/invite-preview.js` importerer aldrig fra `src/`, og at hente sin
//     egen `index.html` ned for at læse to tags ville være et netværkskald for
//     at undgå to strenge (funktionens eget hoved).
//   · `src/screens/Auth.jsx` og `README.md` er de to, der KUNNE importere — og
//     en import fra hver af dem ville stadig efterlade de tre ovenfor.
//
// **Prisen er derfor ikke dubletten, men at intet holder de fem i trit.**
// Navneskiftet 4. august 2026 og `I7`s OG-tags rørte hver især nogle af dem, og
// en fremtidig omformulering vil ramme den fil, forfatteren tilfældigvis har
// åben. Fejlen er tavs: alle fem filer er syntaktisk gyldige med hver sin
// ordlyd, og den eneste, der ser forskellen, er en modtager, der læser to af
// dem efter hinanden.
//
// Samme svar og samme placering som `docs/mail/templates.test.js`, der holder
// mailskabelonerne og `src/lib/legal.js` i trit uden at flytte teksten: en test,
// der læser filerne og sammenligner strengen. Koster hverken et build-trin
// eller en afhængighed.
//
// ---------------------------------------------------------------------------
// HVORFOR TESTEN IKKE SELV SKRIVER SÆTNINGEN
//
// Der står ikke en eneste kopi af ordlyden i denne fil, og det er med vilje.
// Skrev vagten sin egen kopi, ville en omformulering skulle rettes SEKS steder
// i stedet for fem, og vagten ville være blevet det sjette sted, der kan drive.
// `index.html` er ankeret — det er den udgave, en crawler læser, og dermed den,
// der er sværest at opdage er forkert — og alle andre måles mod den.
//
// Følgen er, at ordlyden kan ændres frit: retter man alle fem, er testen grøn
// uden at blive rørt. Det er præcis den ene ting, den skal håndhæve.
//
// ---------------------------------------------------------------------------
// HVAD DEN IKKE PÅSTÅR
//
// Ikke at sætningen er GOD — det er en produktbeslutning, ingen test kan tage.
// Og ikke at de fem filer er ordret identiske i det hele: `site/index.html`
// føjer bevidst ", Gratis, uden odds og uden betting" til sin `description`, og
// hjemmesidens `<title>` er sin egen ("Slå dine venner. Uge efter uge."). Kravet
// er, at sælgesætningen SELV er den samme — altså at den står som et helt
// præfiks eller afsnit i hver af dem, ikke at filerne er kopier.

const ROD = dirname(fileURLToPath(import.meta.url));
const læs = (f) => readFileSync(join(ROD, f), "utf8");

// HTML-entiteter i attributter skal afkodes, før strenge kan sammenlignes:
// `&amp;` i et attributværdi og `&` i JSX er den samme tekst for en læser, og en
// forskel dér ville være falsk alarm. Kun de fem, `escapeHtml` i
// `api/invite-preview.js` producerer — flere ville være at bygge en HTML-parser.
function afkod(s) {
  return String(s)
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

// Ombrudt tekst er den samme tekst. README's linjer brydes ved ~78 tegn midt i
// sætningen, og JSX'en i `Auth.jsx` har den indrykket over en linje for sig med
// linjeskift i begge ender. Uden denne normalisering ville vagten måle
// linjebredde frem for ordlyd.
const énLinje = (s) => String(s).replace(/\s+/g, " ").trim();

function metaIndhold(html, mønster) {
  const m = html.match(mønster);
  return m ? afkod(m[1]) : null;
}

const INDEX = læs("index.html");

// Ankeret. Alt andet måles mod denne ene streng.
const SÆLGESÆTNING = metaIndhold(INDEX, /<meta name="description" content="([^"]*)"/);

describe("sælgesætningen står ens alle fem steder (G97)", () => {
  // Vagten må ikke stå og bevogte ingenting. Omdøbes eller fjernes ankeret,
  // ville hver eneste påstand nedenfor blive triviel sand mod `null`, og filen
  // ville fortsætte med at være grøn, mens den intet målte.
  it("ankeret findes i index.html og er en rigtig sætning", () => {
    expect(SÆLGESÆTNING, "index.html mangler <meta name=\"description\">").not.toBeNull();
    expect(SÆLGESÆTNING.length).toBeGreaterThan(40);
    expect(SÆLGESÆTNING).not.toMatch(/[[\]{}]|%[A-Z_]+%/); // pladsholder sluppet igennem
  });

  // Samme fil, to tags. `og:description` er den, en modtager ser i beskeden;
  // `description` er den, en søgemaskine viser. De to må ikke sige hver sit om
  // det samme produkt, og de er nemme at rette hver for sig.
  it("index.html's og:description er den samme sætning", () => {
    expect(metaIndhold(INDEX, /<meta property="og:description" content="([^"]*)"/)).toBe(SÆLGESÆTNING);
  });

  // Login-skærmen. Den generelle tekst vises, når der IKKE er et
  // invitations-preview at vise (`I7`) — altså for enhver, der lander på appen
  // uden en kode, og det er den samme situation, `index.html`s tags beskriver.
  it("AuthShell i src/screens/Auth.jsx bruger den samme sætning", () => {
    expect(énLinje(læs("src/screens/Auth.jsx"))).toContain(SÆLGESÆTNING);
  });

  // Hjemmesiden, to steder: `description`-tagget (som bevidst føjer et
  // salgsargument til bagefter) og hero-afsnittet, brugeren faktisk læser.
  it("site/index.html bruger den samme sætning i både meta og hero", () => {
    const site = læs("site/index.html");
    const beskrivelse = metaIndhold(site, /<meta name="description" content="([^"]*)"/);
    expect(beskrivelse, "site/index.html mangler <meta name=\"description\">").not.toBeNull();
    expect(beskrivelse.startsWith(SÆLGESÆTNING), `site/index.html's description begynder ikke med sælgesætningen: ${beskrivelse}`).toBe(true);
    expect(énLinje(site)).toContain(SÆLGESÆTNING);
  });

  // Link-previewets FALDBAGUD-tekst. Den vises, når koden er ukendt, eller når
  // opslaget fejler — altså netop når en modtager af et delt link har mindst at
  // gå efter. Filens eget hoved siger "ordret den, der står i index.html", og
  // det er den påstand, der her holdes.
  it("api/invite-preview.js's generelle tekst er den samme sætning", () => {
    const api = læs("api/invite-preview.js");
    const tekst = api.match(/const GENEREL_TEKST\s*=\s*([\s\S]*?);\n/);
    expect(tekst, "GENEREL_TEKST findes ikke i api/invite-preview.js").not.toBeNull();
    expect(énLinje(tekst[1])).toContain(SÆLGESÆTNING);
  });

  // README'en er ikke marketing, men den er det første, en læser af repoet ser,
  // og den har været med i hver eneste omformulering hidtil. Ombrudt over to
  // linjer, derfor `énLinje`.
  it("README.md bruger den samme sætning", () => {
    expect(énLinje(læs("README.md"))).toContain(SÆLGESÆTNING);
  });

  // OVERSKRIFTEN er den anden dublet, og den har kun to aftagere: `og:title` i
  // `index.html` og `GENEREL_TITEL` i `api/invite-preview.js`, som skriver
  // præcis de to tags om for en crawler. Hjemmesidens `<title>` er bevidst en
  // anden — den sælger et website, ikke en invitation — og måles derfor ikke.
  it("og:title og api/invite-preview.js's generelle titel er den samme", () => {
    const titel = metaIndhold(INDEX, /<meta property="og:title" content="([^"]*)"/);
    expect(titel, "index.html mangler og:title").not.toBeNull();
    const api = læs("api/invite-preview.js");
    const apiTitel = api.match(/const GENEREL_TITEL\s*=\s*([\s\S]*?);\n/);
    expect(apiTitel, "GENEREL_TITEL findes ikke i api/invite-preview.js").not.toBeNull();
    expect(énLinje(apiTitel[1])).toContain(titel);
  });
});
