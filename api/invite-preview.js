// Server-side funktion (kører på Vercel, ikke i browseren).
// LINK-PREVIEW PR. INVITATION (`I7`): den HTML, en crawler får at se, når nogen
// deler et `?liga=`- eller `?join=`-link i Messenger, WhatsApp eller iMessage.
//
// Kald med: GET /?liga=<kode> — men kun via omskrivningen i `middleware.js`,
// som kræver BÅDE parameteren og en crawler-agent. Et menneske rammer aldrig
// hertil.
//
// ⚠️ Portvagten lå oprindeligt i `vercel.json`s `rewrites` og virkede ALDRIG:
// de ligger efter filsystem-opslaget, og der findes en `index.html` på `/`.
// Se `middleware.js` og `DOCUMENTATION.md` §13.
//
// ---------------------------------------------------------------------------
// HVORFOR KUN CRAWLERE OMSKRIVES
//
// Alternativet var at lade ALLE `?liga=`-kald gå gennem denne funktion og
// servere appen herfra med tags'ene sat ind. Tre ting talte imod:
//
//   1. Hver eneste rigtige bruger ville få en cold start foran appens første
//      maling — på præcis det link, der skal give det bedste førstehåndsindtryk.
//   2. Funktionen ville skulle levere hele appen, altså kende `dist/` og holde
//      sig i sync med byggeriet.
//   3. Og vigtigst: et nedbrud her ville blive et nedbrud i selve invitationen.
//
// Med portvagten i `middleware.js` kan et menneske pr. KONSTRUKTION ikke ende her,
// og "fejl åben" er dermed en egenskab ved opsætningen frem for et løfte, denne
// fil skal holde. Prisen er, at en crawler, der ikke står på listen, får
// `index.html`s statiske tags — hvilket er nøjagtig det, alle fik før `I7`, og
// altså en gulvbrædde og ikke et hul.
//
// Googlebot står IKKE på listen. En søgemaskine skal se det samme som brugeren.
//
// ---------------------------------------------------------------------------
// TO REGLER, DER IKKE MÅ BRYDES
//
// **Koden ekkoes aldrig.** Hverken i teksten, i `og:url` eller i en fejlbesked.
// Samme regel som `invite_lookup()`s bevidste udeladelse af `invite_code`: den,
// der fremviste koden, kender den godt, men et svar, der bærer den, lægger den i
// enhver mellemliggende cache og fejllog. Derfor er `og:url` appens forside uden
// query, og derfor er `X-Robots-Tag: noindex` sat — en invitations-URL har intet
// at gøre i et søgeindeks.
//
// **Alt fejler åbent.** Manglende konfiguration, timeout, ukendt kode, kaos:
// svaret er 200 med de GENERELLE tags. Aldrig en 500, aldrig et redirect. En
// crawler prøver ikke igen, så en fejl her er et link uden preview — ikke et
// link, der ikke virker.
//
// ---------------------------------------------------------------------------
// HVORFOR DER IKKE STÅR "NIKOLAJ HAR INVITERET DIG"
//
// Fordi det ikke kan gøres sandt endnu. `groups.invite_code` er ÉN kode pr.
// liga (`B20`), så modtagersiden ved ikke, hvem der delte linket — kun hvem der
// oprettede ligaen, og det er sjældent det samme. Navnet på ligaen og antallet
// af spillere er derimod sandt, uanset hvem der trykkede Del. Attributionen
// kommer med `B20`; da skal denne funktion kun bruge ét felt mere i svaret.
//
// Miljøvariabler: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { fetchWithTimeout } from "./_shared.js";

// Den generelle tekst — ordret den, der står i index.html. Dubletten er med
// vilje: `api/` importerer aldrig fra `src/`, og at hente sin egen index.html
// ned for at læse to tags ville være et netværkskald for at undgå to strenge.
const GENEREL_TITEL = "Leagly — gæt resultater mod dine venner";
const GENEREL_TEKST =
  "Gæt resultater mod dine venner. Opret en liga, tip ugens kampe, og se hvem der er bedst.";

// Liganavne er brugerskrevet tekst og står i et attributværdi. Uden dette ville
// en liga ved navn `" />` kunne skrive sine egne tags i vores dokument.
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Hvad der skal stå, når koden faktisk peger på noget.
//
// Formen er "Kom med i …" og ikke "Du er inviteret til …": previewet vises også,
// når nogen deler linket i en gruppechat, hvor "du" ikke har en modtager.
function tekstFor(svar) {
  if (svar?.kind === "group" && svar.name) {
    const antal = Number(svar.member_count) || 0;
    return {
      titel: `Kom med i ligaen "${svar.name}" på Leagly`,
      tekst:
        (antal > 0
          ? `${antal} ${antal === 1 ? "spiller gætter" : "spillere gætter"} allerede resultater. `
          : "") + "Tip ugens kampe, saml point og se hvem der er bedst.",
    };
  }
  if (svar?.kind === "competition" && svar.name) {
    return {
      titel: `Kom med i konkurrencen "${svar.name}" på Leagly`,
      tekst: svar.group_name
        ? `Konkurrencen hører til ligaen "${svar.group_name}". Tip ugens kampe, saml point og se hvem der er bedst.`
        : "Tip ugens kampe, saml point og se hvem der er bedst.",
    };
  }
  return null;
}

function side({ titel, tekst, origin }) {
  const t = escapeHtml(titel);
  const b = escapeHtml(tekst);
  const o = escapeHtml(origin);
  // Ingen skrifter, ingen scripts, ingen billeder ud over `og:image` — den
  // globale CSP (`font-src 'self'`, vercel.json) rammer også dette svar.
  return `<!doctype html>
<html lang="da">
<head>
<meta charset="UTF-8" />
<title>${t}</title>
<meta name="description" content="${b}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Leagly" />
<meta property="og:locale" content="da_DK" />
<meta property="og:url" content="${o}/" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${b}" />
<meta property="og:image" content="${o}/og-image.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="Leagly" />
<meta name="twitter:card" content="summary_large_image" />
</head>
<body><h1>${t}</h1><p>${b}</p><p><a href="${o}/">Leagly</a></p></body>
</html>
`;
}

export default async function handler(req, res) {
  // Crawlere henter med GET og undersøger af og til med HEAD først.
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).send("Kun GET");
  }

  // Adressen bruges til `og:image`, som SKAL være absolut. Vercel sætter `host`
  // på hvert kald, så previewet virker på både produktions- og preview-domænet
  // uden en miljøvariabel mere at glemme.
  const vært = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  const origin = vært ? `https://${vært}` : "https://app.leagly.app";

  const svarMed = ({ titel, tekst }) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // 10 minutter: lang nok til at de fem crawlere, der følger ét delt link,
    // deler ét opslag — kort nok til at et omdøbt liganavn ikke hænger fast.
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
    res.setHeader("X-Robots-Tag", "noindex");
    return res.status(200).send(side({ titel, tekst, origin }));
  };
  const generelt = () => svarMed({ titel: GENEREL_TITEL, tekst: GENEREL_TEKST });

  try {
    const rå = req.query?.liga || req.query?.join || "";
    const kode = String(Array.isArray(rå) ? rå[0] : rå).trim();
    // Formen er `substr(md5(...), 1, 8)` (sql/groups.sql). Alt andet end den
    // slags streng er ikke en kode, og så er der intet at slå op.
    if (!/^[a-z0-9]{4,32}$/i.test(kode)) return generelt();

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error("invite-preview: SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY mangler");
      return generelt();
    }

    // `invite_preview()` er åben for `anon` og svarer det SAMME uanset hvilken
    // nøgle der spørger — service-nøglen giver altså ingen ekstra adgang her.
    // Den bruges, fordi den allerede findes i miljøet: en anon-nøgle mere ville
    // være en variabel, der kan glemmes ved opsætningen, og symptomet ville være
    // et preview, der tavst faldt tilbage til den generelle tekst.
    //
    // 2 sekunder: en crawler venter ikke længe, og et langsomt opslag skal
    // ende som et generelt preview frem for som ingenting.
    const svar = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/invite_preview`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_code: kode }),
    }, 2000);
    if (!svar.ok) {
      console.error("invite-preview: opslaget fejlede", svar.status);
      return generelt();
    }

    return svarMed(tekstFor(await svar.json()) || { titel: GENEREL_TITEL, tekst: GENEREL_TEKST });
  } catch (e) {
    // Med vilje uden koden i beskeden.
    console.error("invite-preview:", e?.message || e);
    return generelt();
  }
}
