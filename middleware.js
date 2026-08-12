// Routing Middleware — crawler-portvagten foran link-previewet (`I7`).
//
// ERSTATTER `rewrites`-reglen i vercel.json, som **aldrig blev ramt**.
//
// ---------------------------------------------------------------------------
// HVORFOR DEN GAMLE REGEL VAR DØD
//
// `vercel.json`s top-level `rewrites` oversættes til Vercels `afterFiles`-fase,
// altså EFTER filsystem-opslaget. Der ligger en fysisk `index.html` på præcis
// stien `/`, så den vandt hver eneste gang — uanset User-Agent og query.
// `api/invite-preview.js` blev derfor aldrig kaldt i produktion, selvom både
// funktionen, SQL-opslaget og miljøvariablerne var rigtige.
//
// Det er også grunden til, at et SPA's sædvanlige `"/(.*)" → /index.html`
// virker fint: dér findes filen netop IKKE, så rewriten er den første, der kan
// svare. Reglen er: **en rewrite på en sti, hvor der ligger en fil, er død.**
//
// Symptomet var tavshed. Hverken deployet eller CI sagde noget — konfigurationen
// var jo syntaktisk gyldig — og funktionen så korrekt ud, fordi den ér korrekt.
// Fejlen blev først fundet ved at sammenligne curl-svarets INDHOLD med
// kildekoden. Hele historien står i `DOCUMENTATION.md` §13.
//
// Middleware kører derimod FØR filsystemet og kan derfor overtage `/`. Det er
// hele grunden til, at logikken bor her og ikke i konfigurationen.
//
// ---------------------------------------------------------------------------
// REGLERNE ER UÆNDREDE
//
// Nøjagtig samme to betingelser som den gamle regel: der skal BÅDE være en
// invitationskode (`?liga=` eller `?join=`) OG en kendt crawler-agent. Et
// menneske rammer derfor stadig aldrig `api/invite-preview.js` — det er stadig
// kun en portvagt, ikke en ny betingelse. Googlebot står bevidst ikke på
// listen: en søgemaskine skal se det samme som brugeren.
//
// `api/invite-preview.js` er URØRT. Den fejler stadig åbent, ekkoer stadig
// aldrig koden, og sætter stadig sine egne cache- og `noindex`-headers.
import { rewrite, next } from "@vercel/functions";

const CRAWLER_UA =
  /(facebookexternalhit|facebot|whatsapp|twitterbot|slackbot|discordbot|telegrambot|linkedinbot|redditbot|pinterest|skypeuripreview|applebot)/i;

export const config = {
  // Kun selve forsiden. Assets, `/api/*` og alt andet rammes ikke, så
  // middlewaren er usynlig for enhver anden request.
  //
  // Matcheren kan hverken se query eller User-Agent — begge dele kræver kode,
  // og det er netop dét, hele denne fil findes for. Prisen er, at ethvert
  // besøg på forsiden invokerer middlewaren; den er til gengæld så smal, den
  // kan blive.
  matcher: "/",
};

export default function middleware(request) {
  // ⚠️ `try/catch` er IKKE pynt her, og den skal blive stående.
  //
  // Middlewaren kører på appens FORSIDE. En undtagelse i den ville give 500
  // til alle — også de mange, der ikke har en invitationskode — og dermed
  // gøre et manglende link-preview til et nedbrud af hele indgangen.
  //
  // Hele `I7` er bygget på, at portvagten fejler åbent. Det princip gælder
  // dobbelt her, hvor indsatsen er højest: går noget galt, falder vi igennem
  // til den statiske app, præcis som før `I7`.
  try {
    const url = new URL(request.url);
    const harInvitationskode = url.searchParams.has("liga") || url.searchParams.has("join");
    const erCrawler = CRAWLER_UA.test(request.headers.get("user-agent") || "");

    if (harInvitationskode && erCrawler) {
      const mål = new URL("/api/invite-preview", request.url);
      mål.search = url.search; // koden følger med — funktionen læser den fra req.query
      return rewrite(mål);
    }
  } catch {
    // Bevidst tavs: se ovenfor. En crawler uden preview er et fuldgyldigt
    // udfald; en forside, der svarer 500, er det ikke.
  }

  return next();
}
