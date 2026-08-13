# Domæne — `leagly.app` til hjemmesiden, `app.leagly.app` til appen

Runbog for `I10` og den halvdel af `B21`, der følger med. Efter
[`MAIL.md`](./MAIL.md)s form — register, rækkefølge, trin, beviser og en
fejlfindingstabel i én fil.

Formen er besluttet 12. august 2026 og begrundet i
[`DECISIONS.md`](./DECISIONS.md): **appen får sit eget subdomæne, fordi det er
appens adresse, brugerne deler** — invitationslinks bygges af
`window.location.origin` (`GroupScreen.jsx:87`, `BoardScreen.jsx:126`), ikke af
hjemmesidens URL. Alt bliver på Vercel. **Vercel-projektet omdøbes ikke.**

> ⚠️ **Udløseren er `I8`.** Der er ingen grund til at pege et domæne på en
> hjemmeside, ejeren ikke har godkendt. Appens halvdel (trin 1, 4, 5, 6) kan
> derimod køres for sig — og bør køres tidligt, fordi prisen stiger med
> brugertallet: **en installeret PWA er bundet til sin origin**, så alle, der har
> installeret fra `.vercel.app`, skal installere igen og logge ind på ny.

> ✅ **Appens halvdel er kørt 13. august 2026: trin 1, 3, 4 og 5.**
> `app.leagly.app` er oprettet og svarer, Supabases Site URL er flyttet og
> testet, og Turnstiles værtsnavne er **udvidet** — ikke skiftet. Alle tre
> rækkefølgefejl nedenfor er dermed passeret på den rigtige side, og repoets
> halvdel (trin 6 + 7) kunne udrulles.
>
> **Trin 6 og 7 er udrullet samme dag, og bevis 1 + 3b er bestået** — redirectet
> svarer 308 mod `app.leagly.app`, og `/api/` gør ikke. **Bevis 4 er bestået
> 13. august 2026** på en modtaget nulstillingsmail. **Tilbage: resten af
> trin 8 og `B21`s GitHub-omdøbning.** De beviser er ikke en formalitet: de fire
> dashboard-trin er meldt udført, og ingen af dem er efterprøvet af andet end
> den, der udførte dem. **Trin 2 og dermed `leagly.app` er stadig gated af
> `I8`.**

---

## Register

| Hvad | Værdi | Sidst verificeret |
|---|---|---|
| Domæne | `leagly.app` | 9. august 2026 — i brug til mail (`B25`) |
| Registrar | ? | ? |
| Hjemmesiden (`site/`) | `leagly.app` + `www.leagly.app` → apex | ? — ikke oprettet |
| Appen | `app.leagly.app` | **13. august 2026 — oprettet og svarer, meldt af ejeren** (trin 1 + 3). Ikke aflæst herfra: udgående HTTPS er spærret i arbejdsmiljøet, så adressen er aldrig blevet spurgt af en maskine. Beviserne nedenfor er stadig det, der afgør det |
| Gamle appadresser | `prediction-champ.vercel.app`, `prediction-champ-predictor-champ.vercel.app` | **13. august 2026 — redirect udrullet og BEVIST** for den første: 308 med `Location: https://app.leagly.app/` (bevis 1). Den anden er ikke spurgt. **Listen er ikke aflæst i Vercel → Domains, og det bliver den ikke** (`A47`, afgjort 13. august 2026): de to ER Vercels standardsæt for et team-projekt, og projektet er aldrig omdøbt. Findes der mod forventning en tredje, dør intet — adressen serverer samme deployment og redirigerer bare ikke; rettelsen er da én regel mere her |
| Cron-jobbenes værtsnavn | Den gamle adresse (`docs/CRON.md` skriver `<app>`) | ? — men **spørgsmålet er flyttet ind i appen 13. august 2026 (`A46`)**: hver kørsel skriver nu sit værtsnavn i `job_runs.detail`, så de ni værdier aflæses i Admin → Drift frem for i cron-job.org. Svaret findes, når hvert job har kørt én gang efter udrulningen — langsomste skema er hver 12. time. Undtagelsen, der beskytter jobbene imens, er bevist samme dag: `/api/sync-live` på den gamle adresse svarer 401 og ikke 308 (bevis 3b), så de rammer funktionen uanset hvilken adresse de er sat op med |
| Vercel-projektnavn | **Uændret** (bevidst — se `DECISIONS.md`) | 12. august 2026 |
| GitHub-repo | `Nikkelajsen/Prediction-Champ` | ? — omdøbes med `B21` |
| Supabase Site URL | `https://app.leagly.app` — se [`MAIL.md`](./MAIL.md) trin 3.2 | **13. august 2026 — flyttet, testet OG bevist** (trin 4 + bevis 4). Ikke længere kun meldt: `redirect_to=https://app.leagly.app/` er aflæst i kilden på en modtaget nulstillingsmail, og det felt bygger Supabase af Site URL |
| Turnstile-værtsnavne | Se [`OPRETTELSE.md`](./OPRETTELSE.md)s register | **13. august 2026 — `app.leagly.app` tilføjet, meldt af ejeren** (trin 5). Det gamle værtsnavn står stadig, som trinnet foreskriver. Bevis 3 (et rigtigt login på den nye adresse) er det, der afgør det |

**`?` betyder "aldrig kørt"**, ikke "kørt og bestået". **"Meldt af ejeren"
betyder heller ikke "bestået"** — det betyder, at handlingen er udført, mens
beviset for, at den virkede, stadig udestår. De to falder først sammen i
trin 8.

---

## 🛑 Rækkefølgen er det eneste, der kan gøre skade

**Adressen skal SVARE, før noget peges derhen.** De tre måder at gøre skade på
er alle den samme fejl — at flytte en henvisning før destinationen findes:

1. **Site URL flyttet før `app.leagly.app` svarer** → hver nulstillings- og
   bekræftelsesmail peger på ingenting, mens alt andet ser rigtigt ud. Det er
   præcis den tilstand, `B25` blev kørt for at komme UD af.
2. **Turnstile-værtsnavnet skiftet i stedet for udvidet** → bot-tjekket fejler
   på den ene af de to adresser, og symptomet er, at ingen kan logge ind.
   Tilføj det nye, fjern først det gamle bagefter.
3. **Redirect uden `has`-betingelse på værtsnavn** → reglen matcher også det nye
   domæne og looper. Redirectet skal betinges af den GAMLE host.

---

## Trin

### Trin 1 — appen får `app.leagly.app` ✅ *13. august 2026*

Vercel → app-projektet → Settings → Domains → tilføj `app.leagly.app`. Hos
registraren: `CNAME app → cname.vercel-dns.com`. Vent på, at Vercel viser
hængelås (SSL udstedes typisk inden for en halv time).

**Projektnavnet røres ikke.** `.vercel.app`-adresserne bliver ved med at svare —
det er tilsigtet og håndteres i trin 6.

### Trin 2 — hjemmesiden får `leagly.app` *(gated af `I8`)*

Nyt Vercel-projekt med **root directory `site`** og intet build-step (mappen er
ren HTML/CSS og ligger med vilje uden for Vite-buildet). Tilføj `leagly.app` og
`www.leagly.app`, og lad den ene redirigere til den anden.

Apex-domæner kan ikke bruge CNAME; brug den A-record, Vercel oplyser i panelet.

> **Hvorfor et selvstændigt projekt frem for en sti i appens?** Appen er en SPA
> på roden, så sitet skulle vindes tilbage med en rewrite — og en rewrite på en
> sti, hvor der ligger en fil, fyrer aldrig (se `CHANGELOG.md`, 12. august 2026).
> To projekter betyder også, at et deploy af sitet pr. konstruktion ikke kan
> vælte appen.

### Trin 3 — verificér, at begge adresser svarer 🔶 *appens halvdel 13. august 2026*

Åbn `https://app.leagly.app` og `https://leagly.app` i en privat fane. **Først
her må resten køres.**

`app.leagly.app` svarer (meldt af ejeren 13. august 2026). `leagly.app`s halvdel
kan pr. konstruktion ikke være kørt, fordi trin 2 stadig er gated af `I8` — og
det er i orden: de to halvdele gater hver sin resten. Appens halvdel er den, der
frigiver trin 4, 5 og 6.

### Trin 4 — Supabase: Site URL og Redirect URLs ✅ *13. august 2026*

[`MAIL.md`](./MAIL.md) trin 3.2. Site URL → `https://app.leagly.app`.
Allow-listen skal have samme adresse. Skabelonerne røres **ikke** — de bærer
ingen adresse, og `docs/mail/templates.test.js` håndhæver det.

### Trin 5 — Turnstile: tilføj værtsnavnet ✅ *13. august 2026*

Cloudflare → Turnstile → widgeten `Leagly` → **tilføj** `app.leagly.app` til
værtsnavnene. Behold `prediction-champ.vercel.app`, indtil redirectet i trin 6
har stået i noget tid. Opdatér registeret i [`OPRETTELSE.md`](./OPRETTELSE.md).

### Trin 6 — redirigér de gamle adresser ✅ *udrullet og bevist 13. august 2026*

Står i `vercel.json` (app-projektet), én regel pr. gammelt værtsnavn:

```json
{
  "source": "/:sti((?!api/).*)",
  "has": [{ "type": "host", "value": "prediction-champ.vercel.app" }],
  "destination": "https://app.leagly.app/:sti",
  "permanent": true
}
```

`permanent: true` giver 308, så søgemaskiner flytter kanonikaliteten med.
**Sti og query bevares** — Vercel videregiver query automatisk, når destinationen
ikke selv har en, og det er dét, der holder allerede delte
`?liga=`/`?join=`-links i live. Filen dækker de to værtsnavne, registeret
ovenfor kender.

> **De to er hele listen — afgjort, ikke aflæst** (`A47`, 13. august 2026).
> Her stod indtil da "tjek i Vercel → Settings → Domains, hvilke aliasser
> projektet faktisk har, og dæk dem alle". Den aflæsning er droppet: de to er
> præcis det sæt, et team-projekt får tildelt af sig selv (projektnavnet, og
> projektnavnet plus team-slug), og et tredje ville kræve enten en håndtilføjet
> alias eller en omdøbning — og omdøbningen er netop dét, `B21` fravalgte.
> **Prisen ved at tage fejl er lav og synlig:** en overset alias serverer stadig
> samme deployment, så et link dertil virker; det redirigerer bare ikke, og
> brugeren bliver på en ikke-kanonisk origin. Rettelsen er da én regel mere her.
> Begrundelsen står i [`DECISIONS.md`](./DECISIONS.md).

> **`(?!api/)` er en bevidst afvigelse fra rækkens oprindelige `/(.*)`.**
> Redirectet er tænkt til MENNESKER, der følger et delt link. Ramte det også
> `/api/`, ville flytningen tage to ting med sig, som ingen leder efter:
>
> - **De ni cron-jobs** kalder `https://<app>/api/…` med `x-sync-secret`
>   ([`CRON.md`](./CRON.md)). Et 308 til et nyt værtsnavn kræver, at
>   cron-job.org både følger redirectet og gensender headeren — to antagelser,
>   der ikke er efterprøvet, og hvis symptom er, at live-resultater bare holder
>   op med at komme.
> - **Allerede installerede PWA'er** på den gamle origin ville få deres
>   `/api/`-kald sendt på tværs af origins, hvor de før var samme origin, altså
>   CORS på kald, der aldrig har haft brug for det.
>
> Prisen er, at `/api/` bliver ved med at svare på den gamle adresse. Det er
> tilsigtet: det er dét, der gør flytningen valgfri for cron-jobbene i stedet for
> samtidig med.

> ⚠️ **Denne regel kan ikke efterprøves på et preview-deploy.** `has` er betinget
> af produktionsværtsnavnet, og et preview har sit eget — så reglen fyrer pr.
> konstruktion først i produktion. CI kører ikke Vercels router
> ([`DOCUMENTATION.md`](../DOCUMENTATION.md) §13). **Bevis 1 nedenfor skal derfor
> køres umiddelbart efter udrulningen**, ikke ved lejlighed. Til gengæld fejler
> den ikke tavst: enten svarer den gamle adresse 308, eller også gør den ikke.

### Trin 7 — `B21`s tekstdel 🔶 *repoets del udrullet 13. august 2026*

23 CTA'er i `site/` (4+5+6+4+4) + README'ens live-link peger nu på
`https://app.leagly.app`. **Tilbage i trinnet:** omdøb GitHub-repoet til
`Leagly` (GitHub redirigerer selv gamle links og remotes).
**`docs/RESTORE.md` rettes IKKE** — den navngiver backup-filer, der faktisk
hedder det gamle.

De 23 CTA'er kunne rettes uden risiko før flytningen, fordi `site/` ligger uden
for Vite-buildet og aldrig når et deploy (trin 2 er stadig gated af `I8`).

### Trin 8 — kør de eksisterende beviser igen

[`MAIL.md`](./MAIL.md)s fire kontroller og [`OPRETTELSE.md`](./OPRETTELSE.md)s
beviser er skrevet som instruktion netop til denne situation. Kør dem.

---

## Beviser

**Den anden er den eneste, der ikke kan snydes** — den måler et rigtigt delt
link og ikke en konfiguration, der ser rigtig ud.

> 🪟 **Kører du dem fra PowerShell, så skriv `curl.exe` med endelsen.** I Windows
> PowerShell 5.1 er `curl` et **alias for `Invoke-WebRequest`**, og `-I` fejler
> som et ukendt parameternavn. I PowerShell 7 er aliaset fjernet, så `curl`
> rammer den rigtige `curl.exe` (følger med Windows 10 1803+) — men `.exe`
> virker i begge, og det er dét, der gør linjen uafhængig af, hvilken shell den
> bliver klistret ind i.
>
> ⚠️ **Rettelsen, der ligger lige for, snyder beviset.** Skriver man i stedet
> `Invoke-WebRequest -Method Head`, **følger den redirectet af sig selv** og
> svarer `200` fra `app.leagly.app`. Bevis 1 ser dermed grønt ud uden at have
> målt den 308, det handler om — og bevis 3b ville vise det modsatte af sit
> formål. `curl.exe` følger som standard ikke redirects, og det er præcis
> derfor, den er værktøjet her.
>
> **Sæt anførselstegn om enhver URL med `?` eller `&`.** `&` er en reserveret
> operator i PowerShell og giver en parsefejl uden dem — det rammer især
> bevis 2, hvor `?liga=` er hele pointen.

1. ✅ **Redirectet svarer 308.** `curl -I https://prediction-champ.vercel.app/`
   → `location: https://app.leagly.app/`.
   **Bestået 13. august 2026, 14:57 UTC:** `HTTP/1.1 308 Permanent Redirect`,
   `Location: https://app.leagly.app/`, `Server: Vercel`.
2. **Et gammelt invitationslink virker stadig.** Åbn
   `https://prediction-champ.vercel.app/?liga=<kode>` og se, at du lander på
   `app.leagly.app/?liga=<kode>` **med koden i behold** — og at previewet
   stadig tegnes.
3. **Login virker på den nye adresse.** Beviser, at Turnstile-værtsnavnet blev
   tilføjet, og ikke bare at widgeten tegnes.
3b. ✅ **`/api/` redirigerer IKKE.** `curl -I https://prediction-champ.vercel.app/api/sync-live`
   → **ikke** 308 (401/405 er det rigtige svar uden hemmeligheden). Beviser
   `(?!api/)` i trin 6, altså at de ni cron-jobs stadig rammer noget. Kør den i
   samme åndedrag som bevis 1: de to fejler hver sin vej, og den ene kan se
   rigtig ud, mens den anden er gået galt.
   **Bestået 13. august 2026, 14:57 UTC — og med et led mere, end beviset bad
   om:** svaret var `HTTP/1.1 401 Unauthorized` og bar
   `Content-Security-Policy: font-src 'self'`, altså appens EGEN header fra
   `vercel.json`. Kaldet nåede dermed helt frem til funktionen; havde det været
   afvist af routingen undervejs, ville headeren mangle. Et 401 alene beviser
   kun "ikke redirigeret" — headeren beviser "ramte det rigtige".
4. ✅ **En nulstillingsmail peger på `app.leagly.app`.** Beviser Site URL.
   **Bestået 13. august 2026**, aflæst i kilden på en modtaget mail ("vis
   original"): `…/auth/v1/verify?token=…&type=recovery&redirect_to=https://app.leagly.app/`.
   Beviset er stærkere end sin egen ordlyd: `redirect_to` er dét, Supabase
   bygger af Site URL, så linjen måler indstillingen direkte og ikke en
   omdirigering, der tilfældigvis ender rigtigt. Samme aflæsning bekræftede, at
   afsenderen går gennem Resend (`AmazonSES` i headeren, `B25`).
5. **`og:url` i kildekoden på `app.leagly.app` siger `app.leagly.app`.**
   Adressen stemples ind ved build fra `VERCEL_PROJECT_PRODUCTION_URL`
   (`vite.config.js`), så den bør følge med af sig selv — **men det er en
   antagelse, indtil den er aflæst.** Gør den ikke, er faldbacken i samme fil
   stedet at rette.

---

## Fejlfinding

| Symptom | Sandsynlig årsag | Hvad man gør |
|---|---|---|
| SSL står "pending" i over en time | CAA-record blokerer, eller en proxy (Cloudflare orange cloud) står foran | Slå proxy fra, så posten er ren DNS; kontrollér CAA |
| Uendeligt redirect på det nye domæne | Redirectet i trin 6 mangler sin `has`-betingelse og matcher også sig selv | Betinget på den GAMLE host — se trin 6 |
| Ingen kan logge ind på det nye domæne | Turnstile-værtsnavnet blev skiftet i stedet for udvidet | `OPRETTELSE.md`, "Når noget ændrer sig" |
| Live-resultater og kampprogram holder op med at opdatere efter flytningen | Redirectet ramte også `/api/`, og cron-jobbene taber enten redirectet eller `x-sync-secret` undervejs | Bevis 3b. Enten `(?!api/)` tilbage i trin 6, eller jobbenes URL flyttet på cron-job.org — ikke begge halvt |
| Nulstillingslink lander på en død adresse | Site URL flyttet, før domænet svarede — eller slet ikke flyttet | `MAIL.md` trin 3.2 |
| Testerens installerede app viser stadig det gamle | En PWA er bundet til sin origin | Afinstallér og installér igen fra `app.leagly.app`; login skal laves om |
| Link-preview viser den gamle adresse | Buildet er ældre end domæneskiftet | Nyt deploy — `VERCEL_PROJECT_PRODUCTION_URL` læses ved build, ikke ved request |

---

## Når noget ændrer sig

- **Skifter appens adresse igen:** trin 4, 5 og 6 er listen. Hvert af de tre
  steder fejler tavst hver for sig.
- **Fjernes en gammel `.vercel.app`-adresse fra redirectet:** hvert link delt
  før flytningen dør i samme øjeblik. Der er ingen udløbsdato, hvor det bliver
  sikkert — kun et punkt, hvor prisen bliver lille nok.
- **Flyttes cron-jobbene til `app.leagly.app`:** gør det på cron-job.org, ét job
  ad gangen, og aflæs kørslen i Admin → Drift bagefter. Undtagelsen `(?!api/)` i
  trin 6 må først fjernes, når alle ni er flyttet — og den er billig at lade
  stå, for `/api/` er ingens delte link. Opdatér [`CRON.md`](./CRON.md)s
  register i samme ombæring.
- **Får sitet et build-step (fx med `I9`):** trin 2's "intet build" skal med
  samme ombæring, og `I17`s `og:`-adresse skal skrives i hånden, fordi sitet
  ikke har appens stempling.
