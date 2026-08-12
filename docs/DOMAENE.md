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

---

## Register

| Hvad | Værdi | Sidst verificeret |
|---|---|---|
| Domæne | `leagly.app` | 9. august 2026 — i brug til mail (`B25`) |
| Registrar | ? | ? |
| Hjemmesiden (`site/`) | `leagly.app` + `www.leagly.app` → apex | ? — ikke oprettet |
| Appen | `app.leagly.app` | ? — ikke oprettet |
| Gamle appadresser | `prediction-champ.vercel.app`, `prediction-champ-predictor-champ.vercel.app` | ? — svarer i dag, skal redirigeres |
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

### Trin 6 — redirigér de gamle adresser

Tilføj i `vercel.json` (app-projektet), én regel pr. gammelt værtsnavn:

```json
"redirects": [
  {
    "source": "/(.*)",
    "has": [{ "type": "host", "value": "prediction-champ.vercel.app" }],
    "destination": "https://app.leagly.app/$1",
    "permanent": true
  }
]
```

`permanent: true` giver 308, så søgemaskiner flytter kanonikaliteten med.
**Sti og query bevares** — det er dét, der holder allerede delte
`?liga=`/`?join=`-links i live. Tjek i Vercel → Settings → Domains, hvilke
`.vercel.app`-aliasser projektet faktisk har, og dæk dem alle.

### Trin 7 — `B21`s tekstdel

23 CTA'er i `site/` (4+5+6+4+4) + README'ens live-link peges på
`https://app.leagly.app`. Omdøb GitHub-repoet til `Leagly` (GitHub redirigerer
selv gamle links og remotes). **`docs/RESTORE.md` rettes IKKE** — den navngiver
backup-filer, der faktisk hedder det gamle.

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
- **Får sitet et build-step (fx med `I9`):** trin 2's "intet build" skal med
  samme ombæring, og `I17`s `og:`-adresse skal skrives i hånden, fordi sitet
  ikke har appens stempling.
