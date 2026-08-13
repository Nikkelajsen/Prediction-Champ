# Hjemmeside v1 — første udkast (`I8`)

**Status: første udkast 3. august 2026, andet udkast merget 13. august 2026 —
IKKE publiceret.** Siderne ligger i
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

CTA'er peger på `https://app.leagly.app`. Invite-links bærer selv deres kode
(`?liga=`/`?join=`), så "Har du en invitation?"-sporet linker blot til appen.

> **Rettet efter levering, 13. august 2026.** Udkastet skrev
> `https://prediction-champ.vercel.app` og noterede, at de 23 CTA'er skulle
> peges på `https://app.leagly.app` med `B21`. Det er nu gjort — som `I10`s
> trin 7, i samme ombæring som redirectet, præcis for ikke at skifte de samme
> 23 links to gange. **Adressen svarer først, når `I10`s trin 1 er kørt**
> ([`DOMAENE.md`](../DOMAENE.md)); indtil da peger sitet — som stadig ikke er
> publiceret — på en adresse, der ikke findes endnu. Det er tilsigtet og
> billigt netop fordi `site/` ikke deployes.

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
  `B4`; produktionens CSP siger `font-src 'self'`). **Det er også grunden til,
  at `I10`s beslutning ikke rører CSP'en:** sitet ligger på sin egen origin og
  henter intet, så appens header kan blive stående uændret.
- **Ingen formular-backend** — kontakt er en mailto (12-funktions-loftet, og
  intet er publiceret).
- **Ingen opfundne tal** — ingen testimonials, brugertal eller logoer.
  Ærligheden er en del af udtrykket ("Hvad vi ikke er"-sektionen).
- **Ingen SEO ud over `lang`/`title`/`meta description`** — det er `I9`, gated
  på beslutningerne herunder.

## Andet udkast — merget 13. august 2026

> **Rettet efter levering.** Afsnittene ovenfor beskriver **første** udkast
> (3. august 2026). Fem ting nedenfor afviger fra dem, og de er markeret frem
> for skrevet ind, så det fremgår, at noget blev ændret undervejs.

**Hvad der kom med:**

1. **Fodbold-eksplicit forside- og meta-tekst.** Sælgesætningen er omformuleret
   (`B30`) til *"Gæt resultaterne af ugens fodboldkampe mod dine venner. Opret
   en liga, tip kampene, og se hvem der er bedst."* og synkroniseret i alle fem
   filer, `saelgesaetning.test.js` vogter. **Turneringsnavnene står bevidst
   UDEN for sætningen** — begrundelsen i [`DECISIONS.md`](../DECISIONS.md).
2. **Ny sektion: "Syv turneringer fra start"** med live-mærkat på Superligaen
   og den skotske Premiership og et "Fra ligafasen"-forbehold på Champions
   League (`B32` fjerner det, når ligafasen er lodtrukket).
3. **Ugerytmen er skrevet om** fra syv dagskort (tirsdag–mandag) til tre kort:
   runden åbner, der spilles, runden gøres op. **Det retter en unøjagtighed i
   første udkast** — kampene kan ligge alle ugens dage, så et kort pr. ugedag
   lovede en rytme, produktet ikke har. Sidekortet ovenfor siger stadig
   "ugerytmen (tirsdag–mandag)"; det er den gamle form.
4. **Story-eksemplerne er nu motorens ægte formuleringer** (⚔️/🔥/🧠) i stedet
   for opdigtede citater. Det er sandere — og det er en **ny kobling** til
   `sql/story_engine_v3.sql`, som ingen vagt holder øje med: se `G103`.
5. **SEO-metadata, som lukker `I17`:** `canonical`, `theme-color`, favicon,
   apple-touch-icon, `og:`/`twitter:`-tags på alle fem sider og et `og:image`
   på 1200×630 — plus `site/robots.txt` og `site/sitemap.xml`. **Fravalget
   "Ingen SEO ud over `lang`/`title`/`meta description`" ovenfor gælder dermed
   ikke længere.** Resten af `I9` kræver en publiceret side.

**De to principper holder stadig:** ingen JS, og nul eksterne requests (kun
`leagly.app`-adresser, og de er metadata og links — ikke hentninger). De 23
CTA'er peger fortsat på `app.leagly.app`.

**Stadig ikke publiceret.** Det, der udestår, står i
[`BACKLOG.md`](../BACKLOG.md): `A48` (Beta-mærkatet, som **ikke** findes i
`site/` — spørgsmålet er først, om det skal), `A49` ("La Liga" vs.
`leagues.name` = "Primera División"), `A50` (serveres `robots.txt`/`sitemap.xml`
fra roden?), `B32`, `B33` (`.html`-endelser ved clean URLs), `I22`
(mobilnavigationen under 880px) og `G103`.

## Udestår før publicering

1. **Ejer-godkendelse af copy og udtryk** — nu af andet udkast (13. august
   2026), som ændrede forsidens tekst, ugerytmen og story-eksemplerne.
2. ~~**Kontakt-mail**~~ — **lukket 9. august 2026 med `B25`.** `om.html` bruger
   nu `kontakt@leagly.app`, som er en rigtig Microsoft 365-postkasse; den samme
   adresse står i `src/lib/legal.js`, og `docs/mail/templates.test.js` holder de
   to i trit. *(Punktet henviste til backloggens indbakke — den henvisning var
   forældet allerede, fordi punktet var foldet ind i `I10`.)*
3. ~~**Domæne og hosting-beslutning**~~ — **afgjort 12. august 2026 (`I10`).**
   Sitet får `leagly.app`, appen får `app.leagly.app`, begge på Vercel; det
   tredje alternativ (en sti på appens Vercel-projekt) er valgt fra, fordi appen
   er en SPA på roden og sitet så skulle vindes tilbage med en rewrite.
   **CSP-spørgsmålet faldt væk med samme beslutning** — to origins deler ikke
   headere. Tilbage står udførelsen, trin for trin i
   [`../DOMAENE.md`](../DOMAENE.md), som køres sammen med `B21`.
4. ~~**SEO** (`I9`) — OG-tags, sitemap, indeksering~~ — **halvt lukket
   13. august 2026 med andet udkast.** Metadataen er skrevet (se ovenfor), og
   `I17` er dermed leveret. Tilbage er det, der kræver en publiceret side:
   indeksering, Search Console og `A50`s aflæsning af, om `robots.txt` og
   `sitemap.xml` faktisk serveres fra roden.

## Verifikation af udkastet

Kørt 3. august 2026 med Chromium (Playwright) mod `file://`: alle 5 sider i
1280 px og 390 px — fonte loader fra `site/fonts/`, nul eksterne requests,
ingen vandret scroll, ingen konsolfejl. `npm run lint` og `npm test` uændrede
(`site/` indeholder kun HTML/CSS og ligger uden for begge).
