# SEO — hvordan `leagly.app` bliver fundet, og hvorfor `app.leagly.app` ikke skal

Registeret over produktets søge-signaler: hvad der ligger i repoet, hvad der
ligger i Google Search Console, og hvilke beviser der afgør, om det virker.

Oprettet 15. august 2026 sammen med `B34`s leverance. Indtil da lå SEO spredt
som `I9` i backloggen, en punktliste i
[`features/hjemmeside-v1.md`](./features/hjemmeside-v1.md) og en `A50`-aflæsning
i [`DOMAENE.md`](./DOMAENE.md) — og den eneste ting, der ikke havde noget hjem,
var netop den, der kan gøre skade: **appens origin må ikke lukkes for
crawlerne.**

> **De to origins har modsatte opgaver, og det er hele filen i én sætning.**
> `leagly.app` (hjemmesiden) skal findes af en, der søger på "Leagly".
> `app.leagly.app` (appen) skal IKKE — dens forside er en loginskærm, og en
> søgning, der lander dér, har mistet den ene side, der er skrevet for at
> overbevise nogen. Men appen skal stadig kunne HENTES af deleplatformenes
> crawlere, for det er dér, invitationernes link-preview bliver til.

---

## Register

| Hvad | Hvor | Status |
|---|---|---|
| Sidernes metadata (`canonical`, `og:*`, `twitter:*`, `theme-color`) | `site/*.html` | ✅ leveret 13. august 2026 (`I17`), suppleret med `og:locale` + `og:image:alt` 15. august 2026 (`B34`) |
| Sitemap | `site/sitemap.xml` | ✅ fem sider, `.html`-endelser i behold (`B33`) |
| Hjemmesidens robots | `site/robots.txt` | ✅ tillader alt, peger på sitemappet |
| 404-side | `site/404.html` | ✅ 15. august 2026 (`B34`) — `noindex`, uden for sitemappet, rod-absolutte stier |
| Cache på stilarket | `site/vercel.json` → `/css/(.*)` | ✅ 15. august 2026 (`B34`), `max-age=3600` |
| **Appens robots** | `public/robots.txt` | ✅ 15. august 2026 (`B34`) — tillader alt **med vilje** |
| **Appen ude af indekset** | `vercel.json` → `X-Robots-Tag: noindex, follow` | ✅ 15. august 2026 (`B34`) |
| Vagt over alt ovenstående | `seo.test.js` | ✅ 15. august 2026 — 15 påstande, afprøvet med 22 mutationer |
| Google Search Console | uden for repoet | 🔶 **ejerens arbejde** — trinnene nedenfor |
| Bing Webmaster Tools | uden for repoet | ⬜ valgfrit, se trin 5 |

---

## 🛑 De to regler, der ikke må brydes

**1. `public/robots.txt` må aldrig få et `Disallow`.**

Det ser ud som den oplagte måde at holde appen ude af Google på. Det er også
den, der slukker link-previewet i hver eneste gruppechat.

Appens origin leverer previewet for et delt invitationslink (`I7`):
`middleware.js` genkender `facebookexternalhit`, WhatsApp, Twitterbot,
LinkedInBot m.fl. på `/?liga=<kode>` og omskriver til `api/invite-preview.js`.
**De crawlere respekterer robots.txt.** Et `Disallow: /` betyder derfor ikke
"skjul for Google", men "hold op med at hente siden" — og resultatet er en nøgen
URL uden billede og uden en sætning om, hvad modtageren er inviteret til.

Symptomet ville være usynligt fra vores side: intet fejler, intet logges, og den
eneste, der ser forskellen, er modtageren.

**2. `X-Robots-Tag` i `vercel.json` skal blive stående.**

Det er den halvdel, der faktisk holder appen ude af indekset — og den virker,
fordi den kun læses af søgemaskiner. Deleplatformenes crawlere er ligeglade og
henter siden alligevel. `follow` og ikke `nofollow`: appen skal ud af indekset,
men dens links til `leagly.app` skal stadig tælle.

**Begge regler fejler tavst, og derfor vogter `seo.test.js` dem begge.** Det er
også grunden til, at `Disallow` og `X-Robots-Tag` ikke kan byttes om efter smag:
de gør ikke det samme, og kun den ene af dem er gratis.

> **Hvorfor ikke en cross-domain `canonical` fra appen til sitet?** Det var
> `B34`s anden foreslåede kur. Den er svagere på begge led: en canonical på
> tværs af domæner er et *hint*, søgemaskinen må se bort fra, og den siger
> "disse to sider er den samme side", hvilket en loginskærm og en salgsside
> ikke er. `noindex` siger præcis dét, vi mener. De to må desuden ikke
> kombineres — signalerne modsiger hinanden.

---

## Trin — Google Search Console

Alle trin køres af ejeren. Repoets halvdel er leveret; **intet herunder kan
gøres fra en session**, både fordi det kræver en Google-konto og fordi udgående
HTTPS til `leagly.app` afvises af arbejdsmiljøets proxy (`A32`).

### Trin 1 — opret ejendommen som **domæne**, ikke som URL-præfiks

Search Console → Add property → **Domain** → `leagly.app`.

**Vælg domæne-typen, ikke "URL prefix".** En domæne-ejendom dækker alle
underdomæner, altså **også `app.leagly.app`** — og det er dét, der gør trin 4's
bevis muligt: uden appen i ejendommen kan man ikke aflæse, om `noindex`
virker, kun gætte.

Verifikation sker med en TXT-record hos registraren (samme sted som A-recorden
fra [`DOMAENE.md`](./DOMAENE.md) trin 2). Den skal blive stående — fjernes den,
mister ejendommen sin verifikation.

### Trin 2 — indsend sitemappet

Search Console → Sitemaps → `sitemap.xml`.

Fem URL'er, alle med `.html` i behold. Står der færre, er `site/sitemap.xml`
drevet fra mappen, og så fejler `seo.test.js` allerede i CI — så tallet er en
kontrol af, at Google læser den fil, vi tror.

### Trin 3 — bed om indeksering af forsiden

URL Inspection → `https://leagly.app/` → Request indexing. De fire andre sider
findes af sig selv via sitemappet og de interne links; forsiden bedes om, fordi
den er den, en brand-søgning skal lande på.

**Gør det ikke for de fire andre.** Manuel indeksering er et begrænset budget og
gør ikke rangeringen bedre — det fremskynder kun første besøg.

### Trin 4 — kontrollér, at appen bliver holdt ude

Efter en uge: Search Console → Pages → **Excluded**. `app.leagly.app`-adresser
skal stå under *"Excluded by 'noindex' tag"*.

⚠️ **Står de under "Blocked by robots.txt" i stedet, er regel 1 blevet brudt** —
og så er link-previewet formentlig også dødt. Se fejlfindingen nedenfor.

### Trin 5 — Bing (valgfrit)

Bing Webmaster Tools kan importere hele opsætningen fra Search Console med ét
klik. Det koster fem minutter og dækker samtidig DuckDuckGo, som bruger Bings
indeks. Det er ikke gjort, og det haster ikke — noteret her, så spørgsmålet ikke
skal opdages forfra.

---

## Beviser

De tre første kan køres i dag. De to sidste kræver, at Google har været forbi.

1. **Appen bærer headeren.** `curl.exe -I https://app.leagly.app/` →
   `x-robots-tag: noindex, follow`.
   **Beviset er stærkere, end det ser ud:** en `headers`-blok i `vercel.json`,
   der ikke bliver læst, fejler fuldstændig tavst — siden ser præcis rigtig ud
   uden den. Det er samme fælde som bevis 6 i [`DOMAENE.md`](./DOMAENE.md), hvor
   `site/vercel.json` havde ligget i repoet uden nogensinde at have kørt.
2. **Appens robots.txt forbyder intet.** `curl.exe https://app.leagly.app/robots.txt`
   → `User-agent: *` og `Allow: /`, og **intet `Disallow`**. Får du HTML tilbage
   i stedet, ligger filen ikke i buildet, og så er advarslen heller ikke der,
   hvor den næste læser efter den.
3. **Link-previewet lever stadig.** Del et `?liga=`-link i en rigtig chat efter
   udrulningen, og se, at billede og tekst kommer frem.
   **Det her er dét bevis, hele filen findes for.** De to ovenfor kan begge være
   grønne, mens previewet er væk — og omvendt. Kør det derfor EFTER hver ændring
   i `public/robots.txt`, ikke kun denne ene gang.
4. **404-siden er vores.** `curl.exe -I https://leagly.app/findes-ikke` → `404`,
   og siden i en browser bærer sitets egen header, footer og stilark.
   Prøv med en **dyb** sti (`/en/dyb/sti/findes-ikke`), ikke kun en flad: en
   relativ sti i `404.html` virker fint på `/findes-ikke` og knækker først
   længere nede. *(Efterprøvet lokalt i Chromium 15. august 2026 på præcis den
   dybe sti, i 1280 og 390 px — stilark, fonte og burger-menu virker, ingen
   vandret scroll.)*
5. **Sitet er i indekset.** `site:leagly.app` i Google giver de fem sider.
   Regn med en til to uger efter trin 2.
6. **Appen er det ikke.** `site:app.leagly.app` giver ingenting.
   ⚠️ En loginskærm i resultatet betyder, at bevis 1 skal køres igen — headeren
   er enten fjernet eller aldrig blevet serveret.

---

## Fejlfinding

| Symptom | Sandsynlig årsag | Hvad man gør |
|---|---|---|
| Delte invitationslinks viser pludselig ingen preview | Der er kommet et `Disallow` i `public/robots.txt` | Fjern det. `noindex`-headeren er kuren, ikke robots.txt — se regel 1 |
| `app.leagly.app` dukker op i en søgning på "Leagly" | `X-Robots-Tag` mangler i svaret | Bevis 1. Er headeren i filen, men ikke i svaret, er `vercel.json` ikke blevet udrullet |
| En ny side på sitet bliver aldrig fundet | Den står ikke i `sitemap.xml` | `seo.test.js` fejler allerede — tilføj både `<loc>` og `canonical` |
| Google melder "Duplicate, submitted URL not selected as canonical" | To adresser for samme side — typisk `www` eller en `.vercel.app` | Bevis 7 i [`DOMAENE.md`](./DOMAENE.md); redirectene er kuren |
| Stilarket er en time bagud efter en rettelse | `max-age=3600` på `/css/` | Ved vilje. Skal en rettelse slå igennem med det samme, sænkes tallet i `site/vercel.json` — HTML'en selv cacher ikke (Vercels `max-age=0`) |
| Search Console viser `noindex` på hjemmesiden | Nogen har kopieret et hoved fra `404.html` | Kun 404-siden må være `noindex`. Vagten måler de fem andre, men ikke at 404-siden ikke blev kopieret |

---

## Når noget ændrer sig

- **Ny side i `site/`:** den skal have `canonical`, `og:url` med sin egen
  adresse og en `<loc>` i `sitemap.xml`. `seo.test.js` fejler, indtil alle tre
  findes — mappen er facit, ikke listen.
- **Sitet skifter adresse:** `ORIGIN` i `seo.test.js`, alle `canonical`/`og:`-tags,
  `sitemap.xml` og `Sitemap:`-linjen i `site/robots.txt` skal følges ad, og
  ejendommen i Search Console skal oprettes forfra. Rækkefølgen står i
  [`DOMAENE.md`](./DOMAENE.md).
- **Appen skifter adresse:** `public/robots.txt`s advarsel navngiver
  `middleware.js` — begge skal med.
- **Der kommer et tredje værtsnavn:** spørgsmålet er hver gang det samme, og
  svaret er sjældent "indekser det". Skriv det i backloggens indbakke frem for
  at afgøre det i forbifarten.
