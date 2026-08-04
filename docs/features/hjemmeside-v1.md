# Hjemmeside v1 — første udkast (`I8`)

**Status: udkast leveret 3. august 2026 — IKKE publiceret.** Siderne ligger i
`site/` i repoets rod, uden for Vite-buildet og uden for ethvert deploy: `vite
build` bruger kun rodens `index.html` + `public/`, så `site/` når aldrig `dist/`
og dermed aldrig Vercel. Udkastet ses ved at åbne `site/index.html` direkte i en
browser (`file://` virker) eller via `python3 -m http.server` fra mappen.

## Formål

Backloggens `I8` — en professionel hjemmeside — med **ét** formål, valgt af
ejeren: at overbevise en besøgende om at oprette eller joine en liga. Alt
indhold er en tragt mod dét ene CTA; sider som "Funktioner" og "Om os" findes
for den skeptiske, ikke som mål i sig selv. Copy er minet fra
[`PRODUCT_BOOK.md`](../PRODUCT_BOOK.md) (mission, ugerytme, Story
Engine-eksempler, kerneudsagn), `src/screens/Auth.jsx` (taglinen),
`src/screens/HowItWorksScreen.jsx` (reglerne) og `src/screens/InstallGuide.jsx`
(PWA-trinene) — så sitet ikke kan love noget, appen ikke holder.

## Sidekort

| Fil | Rolle i tragten |
|---|---|
| `index.html` | Hele salget: hero + stillings-mockup, tre-trins-teaser, ugerytmen (tirsdag–mandag), Story Engine, rating/karriere, CTA-bånd. |
| `saadan-virker-det.html` | Fjerner friktion: begreberne (liga/konkurrence/turnering), 3/1/0-point + tiebreak, låsning/live, rating. |
| `funktioner.html` | Bredden for den grundige: 9 feature-kort + tip-mockup. |
| `om.html` | Troværdighed: missionen, "hvad vi ikke er", kerneudsagnene — plus kontakt (mailto). |
| `hent-appen.html` | Sidste tekniske friktion: webapp/PWA, "Føj til hjemmeskærm" pr. platform. |

CTA'er peger på `https://prediction-champ.vercel.app`. Invite-links bærer selv
deres kode (`?liga=`/`?join=`), så "Har du en invitation?"-sporet linker blot
til appen.

`I8` nævnte "4–6 sider: forside, hvordan virker det, features, om os, kontakt,
download app" — kontakt er bevidst foldet ind i om-siden (en mailto bærer ikke
en side), download app er beholdt som egen side (PWA kræver forklaring pr.
platform). Filnavne uden æ/ø/å, så `file://`-åbning og en senere flytning til
eget domæne (`I10`) ikke støder på URL-encoding.

## Design

Appens identitet, valgt af ejeren frem for et lyst marketing-look:
`site/css/site.css` spejler `src/ui/theme.js` 1:1 (tokens som CSS custom
properties, `@font-face`-blokkene kopieret med `unicode-range`, `livepulse` +
`prefers-reduced-motion`-reglen, grøn fokusring). Kronen er en inline-SVG i
lucide-stil, fordi lucide er en React-dependency. Produktet vises som
**håndbyggede telefon-mockups i ren HTML/CSS** (stilling, tips med
+3/+1/0-piller, story-kort, ratingkurve) med produktbogens eksempelnavne
(Nikolaj, Jimmy, Anders) — der findes ingen skærmbillede-assets, og mockups
forældes mindre grimt end screenshots.

**Fontene er en KOPI** af `public/fonts/` (10 woff2-filer i `site/fonts/`), så
mappen er selvbærende og kan flyttes til eget domæne uden appen. Prisen er
dubletter i repoet; en relativ sti ud af mappen ville knække i samme øjeblik,
mappen flyttes.

## Bevidste fravalg (v1)

- **Ingen JS overhovedet** — heller ingen hamburger-menu; nav-links wrapper på
  mobil.
- **Header/footer er duplikeret i alle 5 sider** — intet build-step. En ændring
  skal laves 5 steder; accepteret for et udkast, genbesøges hvis sitet får et
  build (fx sammen med `I9`).
- **Ingen analytics, ingen tracking, nul eksterne requests** (samme princip som
  `B4`; produktionens CSP siger `font-src 'self'`).
- **Ingen formular-backend** — kontakt er en mailto (12-funktions-loftet, og
  intet er publiceret).
- **Ingen opfundne tal** — ingen testimonials, brugertal eller logoer.
  Ærligheden er en del af udtrykket ("Hvad vi ikke er"-sektionen).
- **Ingen SEO ud over `lang`/`title`/`meta description`** — det er `I9`, gated
  på beslutningerne herunder.

## Udestår før publicering

1. **Ejer-godkendelse af copy og udtryk** — dette er et førsteudkast.
2. **Kontakt-mail** — `om.html` bruger pladsholderen
   `kontakt@leagly.example`; den rigtige adresse er en del af `I10`
   (professionel e-mail). Står i backloggens indbakke.
3. **Domæne og hosting-beslutning** (`I10`) — eget domæne eller en sti på
   Vercel-projektet; afgør også, om appens CSP-headere skal justeres.
4. **SEO** (`I9`) — OG-tags, sitemap, indeksering.

## Verifikation af udkastet

Kørt 3. august 2026 med Chromium (Playwright) mod `file://`: alle 5 sider i
1280 px og 390 px — fonte loader fra `site/fonts/`, nul eksterne requests,
ingen vandret scroll, ingen konsolfejl. `npm run lint` og `npm test` uændrede
(`site/` indeholder kun HTML/CSS og ligger uden for begge).
