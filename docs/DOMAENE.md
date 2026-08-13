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

> 🛑 **Repoets halvdel er skrevet 13. august 2026 og må ikke udrulles endnu.**
> Trin 6 (redirectet i `vercel.json`) og trin 7 (de 23 CTA'er + README) ligger
> som kode. **Udrulles de, før `app.leagly.app` svarer, sendes hver eneste
> bruger til en adresse, der ikke findes** — det er den værste af de tre
> rækkefølgefejl nedenfor, og den eneste, der rammer alle på én gang.
> **Rækkefølgen er derfor: trin 1 → trin 3 → merge.** Intet andet i denne
> runbog er blokeret af det.

---

## Register

| Hvad | Værdi | Sidst verificeret |
|---|---|---|
| Domæne | `leagly.app` | 9. august 2026 — i brug til mail (`B25`) |
| Registrar | ? | ? |
| Hjemmesiden (`site/`) | `leagly.app` + `www.leagly.app` → apex | ? — ikke oprettet |
| Appen | `app.leagly.app` | ? — ikke oprettet |
| Gamle appadresser | `prediction-champ.vercel.app`, `prediction-champ-predictor-champ.vercel.app` | ? — svarer i dag. Redirect **skrevet** 13. august 2026, ikke udrullet. **Listen er aldrig aflæst i Vercel → Domains** og er dermed runbogens svageste påstand: dækker den ikke alle projektets aliasser, dør links delt fra det oversete |
| Cron-jobbenes værtsnavn | Den gamle adresse (`docs/CRON.md` skriver `<app>`) | ? — **ikke aflæst på cron-job.org.** `/api/` er med vilje undtaget fra redirectet, så jobbene overlever flytningen uden at blive rørt |
| Vercel-projektnavn | **Uændret** (bevidst — se `DECISIONS.md`) | 12. august 2026 |
| GitHub-repo | `Nikkelajsen/Prediction-Champ` | ? — omdøbes med `B21` |
| Supabase Site URL | Se [`MAIL.md`](./MAIL.md) trin 3.2 | ? — skal flyttes |
| Turnstile-værtsnavne | Se [`OPRETTELSE.md`](./OPRETTELSE.md)s register | ? — skal udvides |

**`?` betyder "aldrig kørt"**, ikke "kørt og bestået".

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

### Trin 1 — appen får `app.leagly.app`

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

### Trin 3 — verificér, at begge adresser svarer

Åbn `https://app.leagly.app` og `https://leagly.app` i en privat fane. **Først
her må resten køres.**

### Trin 4 — Supabase: Site URL og Redirect URLs

[`MAIL.md`](./MAIL.md) trin 3.2. Site URL → `https://app.leagly.app`.
Allow-listen skal have samme adresse. Skabelonerne røres **ikke** — de bærer
ingen adresse, og `docs/mail/templates.test.js` håndhæver det.

### Trin 5 — Turnstile: tilføj værtsnavnet

Cloudflare → Turnstile → widgeten `Leagly` → **tilføj** `app.leagly.app` til
værtsnavnene. Behold `prediction-champ.vercel.app`, indtil redirectet i trin 6
har stået i noget tid. Opdatér registeret i [`OPRETTELSE.md`](./OPRETTELSE.md).

### Trin 6 — redirigér de gamle adresser ✅ *skrevet 13. august 2026, ikke udrullet*

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
`?liga=`/`?join=`-links i live. Tjek i Vercel → Settings → Domains, hvilke
`.vercel.app`-aliasser projektet faktisk har, og dæk dem alle; filen dækker i dag
de to, registeret ovenfor kender.

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

### Trin 7 — `B21`s tekstdel 🔶 *repoets del skrevet 13. august 2026, ikke udrullet*

23 CTA'er i `site/` (4+5+6+4+4) + README'ens live-link peger nu på
`https://app.leagly.app`. **Tilbage i trinnet:** omdøb GitHub-repoet til
`Leagly` (GitHub redirigerer selv gamle links og remotes).
**`docs/RESTORE.md` rettes IKKE** — den navngiver backup-filer, der faktisk
hedder det gamle.

De 23 CTA'er kunne rettes uden risiko før flytningen, fordi `site/` ligger uden
for Vite-buildet og aldrig når et deploy (trin 2 er stadig gated af `I8`).
README'ens link er den eneste af de 24, der er offentligt synlig i mellemtiden —
og den er død, indtil trin 1 er kørt.

### Trin 8 — kør de eksisterende beviser igen

[`MAIL.md`](./MAIL.md)s fire kontroller og [`OPRETTELSE.md`](./OPRETTELSE.md)s
beviser er skrevet som instruktion netop til denne situation. Kør dem.

---

## Beviser

**Den anden er den eneste, der ikke kan snydes** — den måler et rigtigt delt
link og ikke en konfiguration, der ser rigtig ud.

1. **Redirectet svarer 308.** `curl -I https://prediction-champ.vercel.app/`
   → `location: https://app.leagly.app/`.
2. **Et gammelt invitationslink virker stadig.** Åbn
   `https://prediction-champ.vercel.app/?liga=<kode>` og se, at du lander på
   `app.leagly.app/?liga=<kode>` **med koden i behold** — og at previewet
   stadig tegnes.
3. **Login virker på den nye adresse.** Beviser, at Turnstile-værtsnavnet blev
   tilføjet, og ikke bare at widgeten tegnes.
3b. **`/api/` redirigerer IKKE.** `curl -I https://prediction-champ.vercel.app/api/sync-live`
   → **ikke** 308 (401/405 er det rigtige svar uden hemmeligheden). Beviser
   `(?!api/)` i trin 6, altså at de ni cron-jobs stadig rammer noget. Kør den i
   samme åndedrag som bevis 1: de to fejler hver sin vej, og den ene kan se
   rigtig ud, mens den anden er gået galt.
4. **En nulstillingsmail peger på `app.leagly.app`.** Beviser Site URL.
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
