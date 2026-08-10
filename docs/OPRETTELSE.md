# Oprettelse — bot-værn og e-mailbekræftelse

Runbog for `B26`s to knapper: **Turnstile** foran login og oprettelse, og
**e-mailbekræftelse** af nye konti. Efter [`MAIL.md`](./MAIL.md)s form —
register, trin, beviser og en fejlfindingstabel i én fil.

Klientsiden blev bygget 10. august 2026 og ligger i produktion **inert**: uden
`VITE_TURNSTILE_SITE_KEY` findes værnet ikke, og med "Confirm email" slået fra
opfører oprettelsen sig som altid. Denne fil er det, der mangler — og det er
konfiguration uden for repoet, som kun kan udføres af ejeren.

> ⚠️ **`B26`s udløser er ikke sprunget.** Rækken venter på, at linket deles
> åbent (hjemmesiden publiceres, eller invitationer går uden for vennekredsen).
> Køres runbogen før det, er prisen et ekstra trin i onboardingen for de
> brugere, der allerede er der. Det er et legitimt valg — men det er et valg.

---

## Register

| Hvad | Værdi | Sidst verificeret |
|---|---|---|
| Turnstile-widget | Cloudflare → Turnstile. Navn: `Leagly` | ? |
| Værtsnavne på widgeten | `prediction-champ.vercel.app` | ? |
| Widget-tilstand | Managed | ? |
| Site key (offentlig) | `VITE_TURNSTILE_SITE_KEY` i Vercel, **Production + Preview** | ? |
| Secret key (hemmelig) | Kun i Supabase → Authentication → Attack Protection | ? |
| Bot Protection | **Slået fra** indtil runbogen køres | ? |
| Confirm email | **Slået fra** indtil runbogen køres | ? |
| Skabelon: Confirm signup | Emne + brødtekst fra [`mail/confirm-signup.html`](./mail/confirm-signup.html) | ? — se `MAIL.md`s register |

**`?` betyder "aldrig kørt"**, ikke "kørt og bestået". Udfyld datoerne, når
beviserne nedenfor er gået igennem — forskellen er hele pointen med registeret.

---

## 🛑 Rækkefølgen er det eneste, der kan gøre skade

**Nøglen i Vercel FØRST. Bot Protection i Supabase BAGEFTER.**

Appen taler REST direkte med GoTrue uden SDK, og kvitteringen skal ligge i
`gotrue_meta_security.captcha_token`. Slås Bot Protection til, mens klienten
ikke sender den, svarer serveren `captcha protection: request disallowed
(not-provided)` på **tre** endpoints: signup, login og nulstilling. Det er ikke
"nye konti kan ikke oprettes" — det er **hele adgangen lukket for alle
eksisterende brugere**, og de kan ikke engang nulstille sig ud af det.

Den gode nyhed: fejlen er øjeblikkeligt reversibel, og trin 3 nedenfor er lagt
ind netop for at gøre den umulig at begå.

---

## Trin 1 — Cloudflare: opret widgeten

Turnstile er gratis: ubegrænsede sitekeys og requests, intet betalingskort.
Produktsiden på `cloudflare.com` fører kun til en Enterprise-salgsformular —
**den er ikke vejen ind.** Gå direkte til dashboardet.

1. `dash.cloudflare.com` → **Turnstile** i venstremenuen → **Add widget**.
2. **Navn:** `Leagly`.
3. **Hostnames:** `prediction-champ.vercel.app`.
4. **Widget mode:** `Managed`. Cloudflare afgør selv, om der skal vises noget;
   de fleste brugere ser en boks, der kvitterer af sig selv på et sekund.
5. Gem. Du får to nøgler: **Site Key** (offentlig, hører i frontenden) og
   **Secret Key** (hemmelig, hører kun i Supabase).

> **Du skal IKKE flytte DNS til Cloudflare.** Turnstile virker på et hvilket som
> helst website uden at trafikken går gennem Cloudflare. Værtsnavns-feltet er
> alene listen over adresser, widgeten må vises på — ikke en overtagelse af
> domænet.

> ⚠️ **Preview-deploys får hver deres værtsnavn** (`…-git-<branch>-…vercel.app`)
> og står ikke på listen. Når Bot Protection er slået til, kan man derfor **ikke
> logge ind på en preview** — widgeten nægter at udstede en kvittering på et
> ukendt værtsnavn, og GoTrue afviser kaldet. Prisen betales, indtil
> staging-projektet (`B18`) findes; indtil da er svaret enten at tilføje det
> konkrete værtsnavn til widgeten, mens du tester, eller at slå Bot Protection
> fra imens. Skriv `localhost` på listen, hvis du også vil bruge værnet i
> `npm run dev` — men det kræver, at nøglen står i `.env.local`, og det er
> bevidst ikke standard.

## Trin 2 — Vercel: sæt nøglen

Settings → Environment Variables → Add.

| Felt | Værdi |
|---|---|
| Name | `VITE_TURNSTILE_SITE_KEY` |
| Value | Site key fra trin 1 |
| Environments | **Production _og_ Preview** |

> **Preview skal med, selv om previews ikke kan logge ind bagefter.** Preview og
> produktion deler Supabase-projekt (`DOCUMENTATION.md` §9), så Bot Protection
> gælder også dér. Uden nøglen i Preview ville previewet ikke engang tegne
> widgeten og dermed fejle af to grunde i stedet for én — og den ene ville
> skjule den anden, næste gang nogen fejlsøger.

Variablen er en `VITE_`-variabel og bages ind i buildet. **Den virker først
efter en ny deploy** — en ændret miljøvariabel rører ikke det build, der kører.

## Trin 3 — Kontrollér FØR du rører Supabase

Dette trin er hele sikkerhedsnettet. Bot Protection er stadig slået fra, så
GoTrue ignorerer kvitteringen — intet kan gå i stykker endnu.

1. Redeploy produktionen (Vercel → Deployments → Redeploy på seneste).
2. Åbn `https://prediction-champ.vercel.app` og log **ud**.
3. **Se widgeten stå på login-skærmen.** Gør den ikke det, er nøglen ikke med i
   buildet — gå ikke videre.
4. **Log ind igen. Det skal virke.** Gør det ikke, er noget galt med selve
   udrulningen, og du har stadig ingen låst dør.

Består alle fire, er trin 4 en knap, du kan trykke tilbage.

## Trin 4 — Supabase: slå bot-værnet til

Authentication → **Attack Protection** (hedder i nogle udgaver "Bot and Abuse
Protection").

1. Slå **Enable Captcha protection** til.
2. **Provider:** Turnstile.
3. **Secret key:** den hemmelige nøgle fra trin 1.
4. Gem.

Ændringen slår igennem med det samme — ingen deploy, ingen ventetid.

## Trin 5 — Bevis, at værnet virker

Fire kontroller. **Den fjerde er den eneste, der ikke kan snydes.**

1. **Log ud og ind** på produktionen. Virker det ikke, så gå til Rollback
   nedenfor med det samme — det er de eksisterende brugeres adgang.
2. **Glemt adgangskode** fra login-skærmen. Mailen skal komme som før.
3. **Opret en testkonto** mod en engangsadresse.
4. **Send et kald UDEN kvittering, og se det blive afvist.** De tre første
   beviser kun, at værnet ikke er i vejen — ikke at det virker. Adressen og
   nøglen nedenfor er offentlige og står i forvejen i `src/lib/supabase.js`:

   ```bash
   curl -s -X POST 'https://qfcjbpvttburccdyfnkx.supabase.co/auth/v1/signup' \
     -H 'apikey: sb_publishable_Et9Dahm8LOhZk6cS1XRqhA_9RuNmnvC' \
     -H 'Content-Type: application/json' \
     -d '{"email":"bot-test@example.com","password":"hemmelig123"}'
   ```

   **Forventet:** en fejl, der nævner captcha (`captcha protection: request
   disallowed`). Får du i stedet en oprettet bruger, er værnet slået til i
   panelet uden at være aktivt — og så er trin 4 ikke gennemført.

Udfyld registeret, når de fire er gået igennem.

## Trin 6 — Skabelonen, FØR bekræftelsen slås til

Authentication → Email Templates → **Confirm signup**.

| Felt | Værdi |
|---|---|
| Subject | `Bekræft din e-mail` |
| Body | Indholdet af [`mail/confirm-signup.html`](./mail/confirm-signup.html) |

> 🛑 **Denne rækkefølge er ikke kosmetisk.** Slås bekræftelsen til før
> skabelonen er indsat, går den første mail ud med Supabases engelske standard
> — præcis den fejl, `B25` allerede betalte for på emnelinjen (`MAIL.md`,
> "Emnet er et SEPARAT felt"). Emnet er et selvstændigt felt over brødteksten og
> bliver stående på engelsk, hvis kun brødteksten indsættes.

## Trin 7 — Slå bekræftelsen til

Authentication → **Sign In / Providers** → fanen **Supabase Auth** → blokken
**User Signups** ØVERST på siden → **Confirm email** → til → **Save changes**.

> ⚠️ **Kontakten sidder på SIDEN, ikke i Email-provideren — og det er den
> forveksling, der koster tid.** Folder man Email-rækken ud under *Auth
> Providers* længere nede, finder man `Enable email provider`, `Secure email
> change`, adgangskodereglerne og OTP-felterne — men ikke denne. Den står i
> `User Signups` sammen med `Allow new users to sign up`, altså i den blok, der
> handler om oprettelse frem for om e-mail som metode.
>
> Lad **`Allow new users to sign up`** blive stående på til. Uden den kan ingen
> oprette sig overhovedet, og symptomet ligner til forveksling et bot-værn, der
> afviser alt.
>
> **Husk `Save changes`.** Blokken gemmer ikke af sig selv, og en vippet kontakt
> uden et tryk på knappen ser fuldstændig rigtig ud.
>
> *(Stien er konstateret på skærmen under første kørsel, 10. august 2026. Her
> stod indtil da "klik rækken Email under Auth Providers", hvilket var forkert —
> og før dét pegede runbogen på Authentication → Emails, hvilket også var
> forkert. Supabase har flyttet indstillingen mellem dashboard-versioner, og
> det er præcis derfor kontrollen nedenfor ikke spørger menuen, men GoTrue.)*

Fra nu af svarer signup uden session, og appen viser "Konto oprettet …" i stedet
for at logge brugeren ind.

**Kontrollér, at det blev gemt — uden at spørge menuen.** GoTrue offentliggør
sin egen indstilling, så svaret er uafhængigt af, hvad dashboardet kalder
kontakten i denne uge:

```bash
curl -s 'https://qfcjbpvttburccdyfnkx.supabase.co/auth/v1/settings' \
  -H 'apikey: sb_publishable_Et9Dahm8LOhZk6cS1XRqhA_9RuNmnvC'
```

| `mailer_autoconfirm` | Betyder |
|---|---|
| `true` | Bekræftelse **slået fra** — konti auto-bekræftes. Udgangspunktet |
| `false` | Bekræftelse **slået til**. Det er den, trin 7 skal give |

Feltet er GoTrues eget, og det er dét, kontakten skriver til. Er værdien
uændret efter et tryk, blev der ikke gemt.

## Trin 8 — Bevis, at bekræftelsen virker

1. **Opret en konto** mod en engangsadresse, du kan læse — og vælg et
   brugernavn, du kan genkende igen.
2. **Appen må IKKE logge dig ind.** Der skal stå "Konto oprettet. Har du fået en
   bekræftelses-mail …".
3. **Mailen skal komme** fra `Leagly <noreply@leagly.app>` med det danske emne
   `Bekræft din e-mail`. Er emnet engelsk, er trin 6 sprunget over.
4. **Følg linket, og se, at du lander LOGGET IND** i appen — ikke på
   login-skærmen. Det er hash-aflæsningen i `src/App.jsx` (`type=signup`).
5. **Se dit brugernavn i appen.** Dette er den vigtigste kontrol og den eneste,
   der efterprøver `sikrProfil()`: navnet blev valgt før mailen og kunne ikke
   skrives dengang, fordi der ingen token var. Står der intet navn — fx i Admin
   → Brugere eller på din egen profil — er kontoen den blindgyde, hele
   `src/lib/data/profile.js` findes for at undgå.

---

## Rollback

| Hvad | Sådan | Virker |
|---|---|---|
| Bot-værnet | Supabase → Attack Protection → slå fra | Øjeblikkeligt, ingen deploy |
| Bekræftelsen | Supabase → Providers → Email → Confirm email → fra | Øjeblikkeligt |
| Nøglen i Vercel | **Lad den stå** | Uden Bot Protection ignorerer GoTrue kvitteringen |

⚠️ **Konti oprettet, mens bekræftelsen var slået til, og som ikke nåede at
bekræfte, kan ikke logge ind — heller ikke efter et rollback.** De skal
bekræftes i hånden under Authentication → Users. Det er den ene ting ved
bekræftelsen, der ikke ruller tilbage af sig selv.

---

## Fejlfinding

| Symptom | Sandsynlig årsag | Løsning |
|---|---|---|
| Ingen widget på login-skærmen | Nøglen mangler i buildet | Trin 2 + en NY deploy. `VITE_`-variabler bages ind ved build |
| Widgeten viser en fejl i stedet for en boks | Værtsnavnet står ikke på widgeten | Trin 1, punkt 3. Gælder især previews |
| "Bot-tjekket kunne ikke gennemføres" ved hvert forsøg | Scriptet er blokeret (annonceblokering, firewall), eller secret key'en passer ikke til site key'en | Prøv en anden browser. Passer nøglerne ikke sammen, står de i to forskellige widgets |
| Alle brugere kan pludselig ikke logge ind | Bot Protection blev slået til før nøglen var udrullet | Rollback, kør trin 2–3, og prøv igen |
| Bekræftelsesmailen er på engelsk | Skabelonen er ikke indsat, eller kun brødteksten er | Trin 6 — emnet er sit eget felt |
| Linket logger ikke ind, men lander på login | Site URL peger forkert | `MAIL.md` trin 3.2. Appen læser hash'et i `src/App.jsx` |
| Bekræftet bruger har intet brugernavn | `sikrProfil()` nåede ikke at skrive rækken | Kontrollér `profiles` i Supabase. Navnet ligger på auth-brugerens `raw_user_meta_data` og kan skrives derfra |
| Ny bruger hedder `Anna2` i stedet for `Anna` | Navnet blev taget, mens mailen lå ulæst | Tilsigtet — alternativet var en konto uden navn. Se `DECISIONS.md` 10. august 2026 |

---

## Når noget ændrer sig

- **Skifter appens adresse (`B21`/`I10`):** værtsnavnet på Turnstile-widgeten
  skal med i samme ombæring som Site URL og Redirect URLs. Glemmes widgeten,
  fejler bot-tjekket på den nye adresse, mens alt andet ser rigtigt ud — og
  symptomet er, at ingen kan logge ind på det nye domæne.
- **Kommer staging-projektet (`B18`):** slå værnet til dér først næste gang.
  Så bortfalder hele preview-forbeholdet i trin 1.
- **Slås værnet fra permanent:** fjern også `VITE_TURNSTILE_SITE_KEY` fra
  Vercel, så koden og konfigurationen siger det samme. En nøgle, der er sat uden
  at blive brugt, får den næste læser til at tro, at værnet er aktivt.
