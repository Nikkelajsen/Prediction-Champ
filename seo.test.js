import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Vagt over de to originers SØGE-SIGNALER (B34/I9).
//
// ---------------------------------------------------------------------------
// HVORFOR DEN FINDES
//
// SEO er den klasse af fejl, der pr. konstruktion ikke melder sig selv. En
// manglende `og:locale`, en side der ikke står i `sitemap.xml`, en `canonical`,
// der peger på den forkerte adresse, eller et `X-Robots-Tag`, nogen fjernede —
// intet af det giver en rød side, en konsolfejl eller en fejlet kørsel. Det
// eneste symptom er, at en side ikke bliver fundet, og det opdages måneder
// senere, hvis nogensinde.
//
// Klassen er MÅLT og ikke formodet: sitets metadata blev leveret 13. august
// 2026 som "et komplet sæt", og `B34` fandt fjorten dage senere to tags, der
// manglede på alle fem sider. Sættet var altså aldrig komplet — det så bare
// komplet ud, fordi de fem sider var ens.
//
// ---------------------------------------------------------------------------
// DEN VIGTIGSTE PÅSTAND STÅR NEDERST
//
// `public/robots.txt` må ikke indeholde `Disallow`. Det lyder som en
// pedanteri-regel og er den dyreste i filen: appens origin leverer
// link-previewet for hvert delt invitationslink (`I7`) — `middleware.js`
// genkender facebookexternalhit, WhatsApp, Twitterbot m.fl. og omskriver til
// `api/invite-preview.js` — og de crawlere respekterer robots.txt. Den
// nærliggende måde at "holde appen ude af Google" på (`Disallow: /`) ville
// derfor slukke previewet i hver eneste gruppechat, uden at noget andet end
// modtagerens skærm viste det.
//
// Appen holdes i stedet ude med `X-Robots-Tag: noindex, follow` i `vercel.json`.
// De to påstande hører sammen og skal blive ved med at gøre det: fjernes
// headeren, er appen indekserbar; tilføjes et `Disallow`, er previewet væk.
// Begge er tavse, og derfor står de begge her. Se `docs/SEO.md`.
//
// ---------------------------------------------------------------------------
// HVAD DEN IKKE PÅSTÅR
//
// Ikke at teksterne er GODE — en titel eller en beskrivelse er en
// produktbeslutning, ingen test kan tage (`A51` er præcis sådan en, og den står
// åben). Ikke at siden faktisk ER indekseret; det kan kun aflæses i Search
// Console, og det er ejerens arbejde (`A32`). Og ikke at headerne faktisk
// serveres — en `vercel.json`, der aldrig bliver læst, fejler tavst, og dét
// blev bevist i hånden 14. august 2026. Filen måler repoets halvdel.

const ROD = dirname(fileURLToPath(import.meta.url));
const læs = (f) => readFileSync(join(ROD, f), "utf8");

const ORIGIN = "https://leagly.app";

// Sitets sider, læst af mappen og ikke af en liste i denne fil. En sjette side
// skal fanges af vagten uden at nogen husker at skrive den ind her — det er
// hele grunden til, at listen ikke er hårdkodet.
const SIDER = readdirSync(join(ROD, "site"))
  .filter((f) => f.endsWith(".html") && f !== "404.html")
  .sort();

// Adressen, en side ER — index på roden, resten med `.html` i behold (`B33`).
const adresse = (fil) => (fil === "index.html" ? `${ORIGIN}/` : `${ORIGIN}/${fil}`);

const tagIndhold = (html, mønster) => {
  const m = html.match(mønster);
  return m ? m[1] : null;
};
const meta = (html, navn) =>
  tagIndhold(html, new RegExp(`<meta name="${navn}" content="([^"]*)"`)) ??
  tagIndhold(html, new RegExp(`<meta property="${navn}" content="([^"]*)"`));

describe("hjemmesidens metadata (B34)", () => {
  // Vagten må ikke stå og bevogte ingenting. Omdøbes mappen, eller flyttes
  // siderne, ville hver påstand nedenfor blive triviel sand mod en tom liste —
  // præcis den fejl, `G111`s egen første udgave havde.
  it("finder sitets sider", () => {
    expect(SIDER.length).toBeGreaterThanOrEqual(5);
    expect(SIDER).toContain("index.html");
  });

  it.each(SIDER)("%s har det fulde sæt", (fil) => {
    const html = læs(join("site", fil));

    // `canonical` og `og:url` er den samme påstand set fra hver sin ende: den
    // ene fortæller søgemaskinen, hvilken adresse siden ER, den anden fortæller
    // en deleplatform det samme. Peger de forskellige steder, vinder den, der
    // læses — og hvilken det er, afhænger af aftageren.
    const canonical = tagIndhold(html, /<link rel="canonical" href="([^"]*)"/);
    expect(canonical, `${fil} mangler canonical`).toBe(adresse(fil));
    expect(meta(html, "og:url"), `${fil}'s og:url er ikke dens egen adresse`).toBe(adresse(fil));

    expect(meta(html, "og:locale")).toBe("da_DK");
    expect(meta(html, "og:site_name")).toBe("Leagly");
    expect(meta(html, "og:type")).toBe("website");
    expect(meta(html, "twitter:card")).toBe("summary_large_image");
    expect(meta(html, "theme-color")).toBe("#0C1622");

    // Beskrivelse og titel skal FINDES og være rigtige sætninger. At de er
    // gode, måles ikke; at de er tomme eller bærer en pladsholder, gør.
    const beskrivelse = meta(html, "description");
    expect(beskrivelse, `${fil} mangler <meta name="description">`).not.toBeNull();
    expect(beskrivelse.length).toBeGreaterThan(40);
    expect(beskrivelse).not.toMatch(/[[\]{}]|%[A-Z_]+%/);
    expect(meta(html, "og:description")).not.toBeNull();
    expect(html).toMatch(/<title>[^<]{10,}<\/title>/);

    // Billedet. `og:image` SKAL være absolut — en relativ sti virker i
    // browseren og ikke hos en crawler — og de tre ledsagende tags er dem, der
    // afgør, om previewet bliver et stort billede eller en miniature.
    const billede = meta(html, "og:image");
    expect(billede, `${fil} mangler og:image`).not.toBeNull();
    expect(billede.startsWith(`${ORIGIN}/`), `${fil}'s og:image er ikke absolut`).toBe(true);
    expect(existsSync(join(ROD, "site", billede.slice(ORIGIN.length + 1))), `${fil}'s og:image findes ikke på disken`).toBe(true);
    expect(meta(html, "og:image:width")).toBe("1200");
    expect(meta(html, "og:image:height")).toBe("630");
    expect(meta(html, "og:image:alt")?.length ?? 0, `${fil} mangler og:image:alt`).toBeGreaterThan(3);
  });

  // Sitemappet og mappen skal beskrive den samme hjemmeside. Den fejl, det
  // fanger, er den mest almindelige der findes: en ny side skrives, linkes fra
  // menuen — og står aldrig i sitemappet, så den findes kun af den, der i
  // forvejen ved, den er der.
  it("sitemap.xml lister præcis de sider, mappen har", () => {
    const loc = [...læs("site/sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(loc.length, "sitemap.xml har ingen <loc>-linjer").toBeGreaterThan(0);
    expect([...loc].sort()).toEqual(SIDER.map(adresse).sort());
  });

  it("site/robots.txt tillader alt og peger på sitemappet", () => {
    const robots = læs("site/robots.txt");
    expect(robots).toMatch(/^Sitemap:\s*https:\/\/leagly\.app\/sitemap\.xml$/m);
    expect(forbudteStier(robots), "site/robots.txt forbyder stier — sitet skal findes").toEqual([]);
  });

  it("site/vercel.json cacher stilarket", () => {
    const konfiguration = JSON.parse(læs("site/vercel.json"));
    const css = konfiguration.headers?.find((h) => h.source.startsWith("/css/"));
    expect(css, "ingen cache-regel for /css/").toBeDefined();
    expect(css.headers.find((h) => h.key === "Cache-Control")?.value).toMatch(/max-age=\d+/);
  });
});

describe("404-siden (B34)", () => {
  const HTML = () => læs("site/404.html");

  it("findes", () => {
    expect(existsSync(join(ROD, "site", "404.html"))).toBe(true);
  });

  // Den svarer på uendeligt mange adresser. En canonical ville udpege én af dem
  // som den rigtige, og en plads i sitemappet ville invitere til at indeksere
  // den — begge dele er forkerte, og `noindex` er det eneste sande signal.
  it("er noindex, uden canonical og uden for sitemappet", () => {
    const html = HTML();
    expect(meta(html, "robots")).toMatch(/noindex/);
    expect(html).not.toMatch(/rel="canonical"/);
    expect(læs("site/sitemap.xml")).not.toMatch(/404\.html/);
  });

  // ⚠️ Den påstand, siden findes for. Serveres 404-siden for `/en/dyb/sti`,
  // slår en relativ `css/site.css` op i `/en/dyb/css/site.css` og giver en side
  // uden stilark. De fem andre sider ligger på roden og må gerne være relative;
  // netop derfor er det denne ene fil, der driver, hvis nogen kopierer et
  // hoved fra en af dem.
  it("bruger kun rod-absolutte eller eksterne stier", () => {
    const stier = [...HTML().matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    expect(stier.length).toBeGreaterThan(5);
    const relative = stier.filter((s) => !/^(https?:|\/|#|mailto:)/.test(s));
    expect(relative, "relative stier på 404-siden knækker på dybe adresser").toEqual([]);
  });
});

// En `Disallow`-linje uden sti (`Disallow:`) betyder "forbyd intet" og er
// lovlig. Kun linjer MED en sti er en forbudt sti — ellers ville vagten kalde
// den tomme, tilladende form for en overtrædelse.
function forbudteStier(robots) {
  return [...robots.matchAll(/^\s*Disallow:\s*(\S+)\s*$/gim)].map((m) => m[1]);
}

describe("appens origin holdes ude af indekset UDEN at lukke crawlerne ude (B34)", () => {
  // ⚠️⚠️ Filens dyreste påstand. Se hovedet: et `Disallow: /` her ville slukke
  // link-previewet (`I7`) i hver eneste gruppechat, et invitationslink deles i,
  // fordi facebookexternalhit, WhatsApp, Twitterbot og LinkedInBot alle
  // respekterer robots.txt. Symptomet ville være et link uden billede — altså
  // ingenting at fejlsøge på.
  it("public/robots.txt forbyder ingen stier", () => {
    const robots = læs("public/robots.txt");
    expect(forbudteStier(robots), "et Disallow på appens origin slukker link-previewet (I7)").toEqual([]);
    expect(robots).toMatch(/^User-agent:\s*\*/m);
  });

  // Og den anden halvdel: uden headeren er loginskærmen indekserbar og
  // konkurrerer med salgssiden om søgningen på "Leagly", hvilket er hele
  // grunden til, at `B34` blev skrevet.
  it("vercel.json sætter X-Robots-Tag: noindex på hele appen", () => {
    const konfiguration = JSON.parse(læs("vercel.json"));
    const alle = konfiguration.headers?.find((h) => h.source === "/(.*)");
    expect(alle, "ingen headers-regel for alle stier").toBeDefined();
    const robots = alle.headers.find((h) => h.key === "X-Robots-Tag");
    expect(robots, "X-Robots-Tag mangler — appen er indekserbar").toBeDefined();
    expect(robots.value).toMatch(/noindex/);
  });

  // `follow` og ikke `nofollow`: siden skal ud af indekset, men dens links til
  // `leagly.app` skal stadig tælle. `nofollow` ville kaste den halvdel væk uden
  // at vinde noget.
  it("lader links følge", () => {
    const konfiguration = JSON.parse(læs("vercel.json"));
    const værdi = konfiguration.headers
      .find((h) => h.source === "/(.*)")
      .headers.find((h) => h.key === "X-Robots-Tag").value;
    expect(værdi).not.toMatch(/nofollow/);
  });
});
