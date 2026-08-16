// Det, der TEGNES, når noget deles som billede.
//
// `share.js` er transporten — deleark eller udklipsholder — og skal blive ved med
// kun at være det. Tegningen lå indtil august 2026 som `drawFrame()` inde i
// `RoundStory.jsx`, hvilket var det rigtige sted, så længe der fandtes ét
// delbart format. Da dagskortet og stillingen fik deres egne Del-knapper, blev
// den fælles RAMME det, der skulle holdes ét sted: et billede fra Hjem og et fra
// Stilling skal kunne ligge over hinanden i den samme beskedtråd og se ud som to
// sider af det samme produkt.
//
// HVORFOR CANVAS OG IKKE ET SKÆRMBILLEDE AF DOM'EN. Billedet skal kunne læses
// uden appens baggrund, i en beskedtråd, på en telefon, der aldrig har set
// produktet. Derfor egen ramme, egne farver og eget navn nederst — og derfor
// heller ingen `html-to-image`-afhængighed.
//
// Funktionerne her er RENE mod deres `ctx`: de tegner og returnerer ingenting,
// og de læser intet fra DOM'en eller fra modulets omgivelser. Det er dét, der
// gør dem testbare med et attrap-ctx, der optager kald.

// Farverne står som strenge og ikke som `C` fra theme.js. Det er med vilje:
// temaets farver må ændre sig med appens udseende, mens et delt billede skal se
// ens ud på tværs af de versioner, der ligger i folks beskedtråde.
const BG = "#14212F";
const GOLD = "#F2C14E";
const TEXT = "#FFFFFF";
const MUTED = "#8DA2B8";

const FONT = "system-ui, sans-serif";

// Den fælles ramme: navy flade, gold bjælke øverst, "Leagly" nederst til
// venstre. Alt, der deles, har den — det er dét, der gør to billeder fra to
// skærme til det samme produkt.
function ramme(ctx, w, h) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = GOLD;
  ctx.fillRect(0, 0, w, 10);

  ctx.fillStyle = GOLD;
  ctx.font = `700 36px ${FONT}`;
  ctx.fillText("Leagly", 80, h - 80);
}

// Ombrydning i hånden: canvas har ingen. Grænsen er TEGN og ikke pixels, fordi
// målet er læsbarhed og ikke typografisk perfektion — og fordi en pixel-måling
// (`measureText`) ville binde funktionen til en rigtig canvas-implementering og
// dermed gøre den utestbar uden en browser.
// `maxLinjer` klipper med en ELLIPSE og ikke i tavshed. Forskellen er hele
// pointen: en overskrift, der bare stopper, ser ud som om den var sådan, mens
// et "…" siger, at der stod mere. Uden loftet kunne en lang tekst løbe ned
// gennem "Leagly" og ud af billedet.
function ombryd(tekst, maxTegn, maxLinjer = Infinity) {
  const linjer = [];
  let linje = "";
  for (const ord of String(tekst || "").split(" ")) {
    if ((linje + ord).length > maxTegn && linje) { linjer.push(linje.trim()); linje = ""; }
    linje += `${ord} `;
  }
  if (linje.trim()) linjer.push(linje.trim());
  if (linjer.length <= maxLinjer) return linjer;
  const klippet = linjer.slice(0, maxLinjer);
  klippet[maxLinjer - 1] = `${klippet[maxLinjer - 1]}…`;
  return klippet;
}

// Ét navn, der er for langt til sin kolonne. Samme regel som ovenfor: et navn,
// der bare stopper, ligner et andet navn.
function klip(tekst, maxTegn) {
  const s = String(tekst || "");
  return s.length <= maxTegn ? s : `${s.slice(0, maxTegn - 1)}…`;
}

// ---------------------------------------------------------------------------
// Historie-kortet — rundestoryens frames OG dagskortet
// ---------------------------------------------------------------------------
// Flyttet ordret fra RoundStory.jsx (august 2026). Ingen adfærdsændring: de
// billeder, der allerede er sendt fra en rundestory, ser ud som de nye.
//
// `view` er `{ eyebrow, headline, body }` — altså præcis det, `renderFrame()`
// giver, og præcis det, et dagskort kan levere af sin egen række. At de to deler
// form er grunden til, at der kun er én maler.
//
// TO RETTELSER FULGTE MED FLYTNINGEN, og begge blev synlige, første gang en
// rigtig canvas tegnede resultatet:
//
//   1. Den gamle ombrydning tegnede en TOM linje, hvis overskriftens første ord
//      i sig selv var længere end grænsen (betingelsen manglede "… og der står
//      noget på linjen").
//   2. Brødteksten var `slice(0, 46)` — altså et klip MIDT I ET ORD og uden et
//      tegn, der sagde det. Det var usynligt for rundestoryens frames, hvis
//      brødtekster er korte af konstruktion (`renderFrame`), og bliver synligt
//      med det samme på et dagskort, hvis brødtekst er en hel sætning:
//      *"I Kontorets Premier League havde 4 andre tippe"*. Teksten ombrydes nu
//      over op til tre linjer og klippes med "…", hvis den er længere.
function drawStoryCard(view, ctx, w, h) {
  ramme(ctx, w, h);

  ctx.fillStyle = MUTED;
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText(String(view?.eyebrow || "").toUpperCase(), 80, 200);

  ctx.fillStyle = TEXT;
  ctx.font = `700 92px ${FONT}`;
  // 17 og ikke 18: ved 92px fed system-ui fylder atten tegn hele bredden, så
  // linjen rørte den højre kant uden margen. Det kunne ses på den første rigtige
  // tegning og var arvet fra `drawFrame`, hvor overskrifterne var kortere.
  const linjer = ombryd(view?.headline, 17, 4);
  let y = 340;
  for (const linje of linjer) { ctx.fillText(linje, 80, y); y += 108; }

  // Brødteksten sidder 90 px under SIDSTE overskriftslinje, ikke under det sted,
  // løkken efterlod skrivehovedet.
  ctx.fillStyle = MUTED;
  ctx.font = `400 40px ${FONT}`;
  let by = 340 + Math.max(0, linjer.length - 1) * 108 + 90;
  for (const linje of ombryd(view?.body, 42, 3)) { ctx.fillText(linje, 80, by); by += 54; }
}

// ---------------------------------------------------------------------------
// Stillingen
// ---------------------------------------------------------------------------
// HVAD DER KOMMER MED, OG HVAD DER IKKE GØR. Kun `#`, navn og point. Rating, 🎯
// og Form er app-interne begreber, som tabellen selv skal bruge en
// forklaringslinje på at gøre læsbare — og en forklaringslinje er præcis det,
// et delt billede ikke har plads til og ikke får læst.
//
// HØJDEN REGNES AF RÆKKEANTALLET. En liga med fire medlemmer skal ikke få et
// halvtomt kvadrat; en med tyve skal ikke få rækker uden for kanten.
const RÆKKE_H = 76;
const BUND = 190;     // plads til "Leagly" og luft under sidste række

// Hovedet er IKKE en konstant, og det er den ene ting, en rigtig canvas-tegning
// afslørede med det samme: en fast højde tvang titlen ned på én linje, og
// "Kontorets Premier League" blev til "Kontorets Premier" uden så meget som et
// "…". At klippe en konkurrences NAVN i det billede, der skal fortælle hvilken
// konkurrence det er, er den værst tænkelige forkortelse.
const TITEL_LINJE_H = 78;
const TITEL_MAX_LINJER = 2;
const titelLinjer = (title) => ombryd(title, 22, TITEL_MAX_LINJER);
const topFor = (title) => 235 + (titelLinjer(title).length - 1) * TITEL_LINJE_H + 75;

// Så mange rækker tegnes, før feltet klippes. Ti er det, der kan læses på en
// telefonskærm i en beskedtråd uden at zoome.
const MAX_RÆKKER = 10;

// Klipningen: top-10, en `…`-række og modtagerens egen række, når feltet er
// større. Samme greb som dagskortets mini-stilling — den, der deler, skal kunne
// se sig selv i billedet, også når vedkommende ligger nr. 17.
//
// Returnerer `{ rows, meIndex }` med `rows[i].ellipsis === true` for skille-
// rækken, så maleren og tekst-faldbacken deler præcis den samme beslutning.
function afkortStilling(rows, meIndex) {
  const alle = rows || [];
  if (alle.length <= MAX_RÆKKER) return { rows: alle, meIndex };
  const top = alle.slice(0, MAX_RÆKKER);
  if (meIndex == null || meIndex < MAX_RÆKKER) return { rows: top, meIndex };
  return { rows: [...top, { ellipsis: true }, alle[meIndex]], meIndex: top.length + 1 };
}

// Tager hele `view`, fordi højden afhænger af titlens ombrydning og ikke kun af
// rækkeantallet. To argumenter, der skulle holdes i trit med `drawStandings`,
// ville være præcis den slags kopi, filen her findes for at undgå.
function standingsHeight({ title, rows, meIndex }) {
  const { rows: vist } = afkortStilling(rows, meIndex);
  return topFor(title) + vist.length * RÆKKE_H + BUND;
}

function drawStandings({ title, subtitle, rows, meIndex }, ctx, w, h) {
  ramme(ctx, w, h);
  const { rows: vist, meIndex: minRække } = afkortStilling(rows, meIndex);

  ctx.fillStyle = MUTED;
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText(String(subtitle || "").toUpperCase(), 80, 150);

  ctx.fillStyle = TEXT;
  ctx.font = `700 64px ${FONT}`;
  let ty = 235;
  for (const linje of titelLinjer(title)) { ctx.fillText(linje, 80, ty); ty += TITEL_LINJE_H; }

  let y = topFor(title);
  vist.forEach((r, i) => {
    if (r.ellipsis) {
      ctx.fillStyle = MUTED;
      ctx.font = `400 44px ${FONT}`;
      ctx.fillText("…", 80, y + 46);
      y += RÆKKE_H;
      return;
    }
    // Egen række får en gold-tonet baggrund — samme markering som i tabellen på
    // Stilling-skærmen, bare i billedets eget farvesprog.
    const mig = i === minRække;
    if (mig) {
      ctx.fillStyle = "rgba(242,193,78,0.14)";
      ctx.fillRect(56, y - 8, w - 112, RÆKKE_H - 8);
    }
    ctx.fillStyle = mig ? GOLD : MUTED;
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText(String(r.rank ?? ""), 80, y + 46);

    ctx.fillStyle = mig ? TEXT : MUTED;
    ctx.font = `${mig ? 700 : 400} 44px ${FONT}`;
    ctx.fillText(klip(r.player, 20), 190, y + 46);

    ctx.fillStyle = mig ? GOLD : TEXT;
    ctx.font = `700 44px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(String(r.total ?? ""), w - 80, y + 46);
    ctx.textAlign = "left";

    y += RÆKKE_H;
  });
}

// Tekst-faldbacken. `shareImage()` bruger den, når browseren har `navigator.share`
// men afviser FILER — iOS Safari gør det i nogle sammenhænge, og en Del-knap,
// der så ikke gør noget, er værre end ingen knap.
//
// Den bruger SAMME afkortning som billedet: to forskellige udgaver af den samme
// stilling, alt efter hvilken vej delingen tog, ville være en forskel, ingen kan
// se i koden.
function standingsShareText({ title, subtitle, rows, meIndex }) {
  const { rows: vist } = afkortStilling(rows, meIndex);
  const linjer = vist.map((r) => (r.ellipsis ? "…" : `${r.rank}. ${r.player} — ${r.total}`));
  return [`${title} · ${subtitle}`, ...linjer, "Leagly"].join("\n");
}

export {
  drawStoryCard,
  drawStandings,
  standingsHeight,
  standingsShareText,
  afkortStilling,
  MAX_RÆKKER,
};
