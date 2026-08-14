# Hjemmeside v1 — første udkast (`I8`)

**Status: PUBLICERET 14. august 2026 på `leagly.app`.** Første udkast
3. august 2026, andet udkast merget 13. august, copy godkendt og sitet gjort
udrulningsklart samme dag, Vercel-projektet oprettet dagen efter.
**`I8` er dermed leveret.** Siderne ligger i
`site/` i repoets rod, uden for Vite-buildet: `vite build` bruger kun rodens
`index.html` + `public/`, så `site/` når aldrig `dist/`. **Mappen deployes i
stedet af sit EGET Vercel-projekt med root directory `site`** (14. august 2026,
[`DOMAENE.md`](../DOMAENE.md) trin 2) — sætningen "uden for ethvert deploy"
stod her indtil da og gælder ikke længere. Udkastet ses ved at åbne `site/index.html` direkte i en
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

- **Ingen JS overhovedet.** *(Rettet 13. august 2026 med `I22`: der ER en
  burger-menu nu under 700px, og den koster stadig ingen JS — en skjult
  checkbox og en `<label>` gør arbejdet i ren CSS. Halvsætningen "heller ingen
  hamburger-menu; nav-links wrapper på mobil" gælder dermed ikke længere.)*
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
   🔵 **Rettet efter levering (14. august 2026, `G103`): vagten findes nu
   (`story-eksempler.test.js`), og punktets egen formulering var for stærk.**
   Ingen af de fire kort er motorens ord for ord: sitet sætter punktum, hvor
   motoren ikke gør, og stime-kortet er overskriftens 🔥 sat foran brødtekstens
   ordlyd, fordi mockup'en har én linje, hvor appen har to (overskrift +
   brødtekst, `screens/hjem/DayCard.jsx`). De afvigelser er redaktionelle og
   bevidste. **Det, der er ægte, er ordene mellem værdierne**, og det er dem,
   vagten holder fast: hver værdi står i et `<span class="story-var">`, hvert
   kort siger med `data-story-rule`, hvilken regel det citerer, og alt
   derimellem skal findes i dén regels strenge i `story_engine_v3.sql`.
   **Skriver du et nyt eksempel, så marker dets værdier** — ellers måler vagten
   dem som motor-ordlyd og fejler.
5. **SEO-metadata, som lukker `I17`:** `canonical`, `theme-color`, favicon,
   apple-touch-icon, `og:`/`twitter:`-tags på alle fem sider og et `og:image`
   på 1200×630 — plus `site/robots.txt` og `site/sitemap.xml`. **Fravalget
   "Ingen SEO ud over `lang`/`title`/`meta description`" ovenfor gælder dermed
   ikke længere.** Resten af `I9` kræver en publiceret side.

**De to principper holder stadig:** ingen JS, og nul eksterne requests (kun
`leagly.app`-adresser, og de er metadata og links — ikke hentninger). De 23
CTA'er peger fortsat på `app.leagly.app`.

~~**Stadig ikke publiceret.** Det, der udestår, står i
[`BACKLOG.md`](../BACKLOG.md): `A48` (Beta-mærkatet, som **ikke** findes i
`site/` — spørgsmålet er først, om det skal), `A49` ("La Liga" vs.
`leagues.name` = "Primera División"), `A50` (serveres `robots.txt`/`sitemap.xml`
fra roden?), `B32`, `B33` (`.html`-endelser ved clean URLs), `I22`
(mobilnavigationen under 880px) og `G103`.~~ *(Rettet efter levering,
14. august 2026: siden ER publiceret — se status øverst — og af listen er kun
`B32` fortsat åben; resten blev lukket 13.–14. august 2026.)*

## Udrulningsklar — 13. august 2026

> **Rettet efter levering.** Dette afsnit ændrer to ting i afsnittene ovenfor:
> fravalget af en hamburger-menu (se "Bevidste fravalg") og sætningen om, at
> `site/` kun indeholder HTML og CSS.

Fire backlog-rækker om sitet er lukket samlet, og de to ting, udrulningen
kræver af repoet, er skrevet. Begrundelserne i sin fulde længde står i
[`DECISIONS.md`](../DECISIONS.md).

| Hvad | Hvor |
|---|---|
| **`site/vercel.json`** — CSP, `X-Content-Type-Options`, `Referrer-Policy`, cache-headere til `fonts/`+`img/`, og `"cleanUrls": false` | ny fil, læses af sitets eget Vercel-projekt (root directory `site`) |
| **Beta-mærkat i headeren** (`A48`) | `.beta-tag` ved siden af ordmærket i alle fem sider |
| **Burger-menu under 700px** (`I22`) | `.nav-check` + `.nav-toggle` i alle fem headere, `@media (max-width: 700px)` i `site.css` |
| **`.html` bliver stående** (`B33`) | `"cleanUrls": false` — canonical, `sitemap.xml` og de interne links røres ikke |
| **"La Liga" bliver stående** (`A49`) | ingen ændring i `site/` — appen beholder "Primera División" |

**Burgeren er JS-fri, og det er ikke en detalje.** `I22` skrev, at en
burger-menu ville koste fravalget af JavaScript. Det gør den ikke: en skjult
checkbox, en `<label>` og `.nav-check:checked ~ .site-nav` gør præcis det samme.
Checkboxen skal stå **før** `.site-nav` i DOM'en — `~`-selektoren afhænger af
det, og en ombytning knækker menuen tavst. Breakpointet er 700px og ikke 880px:
de fem punkter står på én linje helt ned til 701px, og først derunder wrapper de.
En sticky header, der wrapper, fyldte 159px af en 390px-skærm; nu 69px.

**CSP'en håndhæver "ingen JS".** `script-src 'none'` gør princippet til en
header i stedet for en sætning i denne fil. `style-src` må have `'unsafe-inline'`,
fordi siderne bærer 29 `style=`-attributter; med `script-src 'none'` er den
tilladelse nær-harmløs. **Appens `vercel.json` er ikke rørt** — to origins deler
ikke headere.

**Én fejl fundet af verifikationen og ikke af en række:** `.phone` havde
`width: 300px`, og en fast bredde gør grid-sporets min-content 300px, så
containeren blev skubbet 4px ud på fire af de fem sider. Nu `width: min(300px,
100%)`. **Fejlen lå mellem de to bredder, første udkasts verifikation målte**
(1280px og 390px) — den viser sig først under 340px.

## Udestår før publicering

1. ~~**Ejer-godkendelse af copy og udtryk**~~ — **givet 13. august 2026** af
   ejeren, på et klikbart preview af alle fem sider (andet udkast plus dagens
   burger og Beta-mærkat). Ingen rettelser bestilt.
5. ~~**Trin 2 i [`../DOMAENE.md`](../DOMAENE.md)**~~ — **kørt 14. august 2026.**
   Vercel-projektet er oprettet med root directory `site`, og `leagly.app` er
   live. `A50` blev bevist i samme ombæring: `/robots.txt` og `/sitemap.xml`
   serveres fra roden. **Listen er dermed tom — `I8` er leveret.** ~~To ting er
   endnu ikke aflæst og står som bevis 6 og 7 i runbogen~~ *(aflæst og bestået
   senere samme dag, 12:51–12:52 UTC — se `CHANGELOG.md` og `DOMAENE.md`)*:
   hjemmesidens egne svar-headere (CSP'en fra `site/vercel.json` svarer ord
   for ord i produktion) og `www.leagly.app` → apex (308).
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
   indeksering og Search Console (`I9`). ~~Og `A50`s aflæsning af, om
   `robots.txt` og `sitemap.xml` faktisk serveres fra roden~~ *(bevist
   14. august 2026 — se punkt 5 ovenfor; `A50` er lukket og slettet af
   backloggen)*.

## Verifikation af udkastet

Kørt 3. august 2026 med Chromium (Playwright) mod `file://`: alle 5 sider i
1280 px og 390 px — fonte loader fra `site/fonts/`, nul eksterne requests,
ingen vandret scroll, ingen konsolfejl. `npm run lint` og `npm test` uændrede
(`site/` indeholder kun HTML, CSS og — siden 13. august 2026 — `vercel.json`,
og mappen ligger uden for begge). *(Rettet efter levering: mappen bærer i dag
også `robots.txt`, `sitemap.xml`, `fonts/` og `img/` — stadig ingen JS og
intet, Vite eller Vitest rører.)*

**Kørt igen 13. august 2026** med Chromium (Playwright) mod en lokal server,
fordi to af kontrollerne ikke kan laves over `file://`:

- **Ti bredder** — 1280, 1000, 880, 820, 760, 701, 700, 560, 390, 320 og 280 px:
  ingen vandret scroll nogen steder (den nye nedre grænse er 280 px), ingen
  konsolfejl, nul requests uden for `localhost`. Burgeren åbner og lukker på
  klik; checkboxen er tabbar, så den virker også på tastatur.
- **CSP'en fra `site/vercel.json` sat som rigtig header** på alle fem sider:
  ingen overtrædelser, fontene loader, `.beta-tag` og de inline
  `style=`-attributter beholder deres farve. **Det er kontrollen, der afgør, om
  CSP'en kan udrulles** — en for stram CSP viser sig først, når headeren er
  der, og `file://` har ingen.

`npm run lint` (7 advarsler, uændret) og `npm test` (1321 tests, 57 filer) er
grønne.
