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
| Turnstile-widget | Cloudflare → Turnstile. Navn: `Leagly` | 10. august 2026 — oprettet |
| Værtsnavne på widgeten | `prediction-champ.vercel.app` | **12. august 2026 — BEVIST.** Widgeten viser "Succes!" på produktionens login-skærm, og `window.turnstile.getResponse()` returnerede en token. Værtsnavnet accepteres altså, og ikke bare "widgeten tegnes" |
| Widget-tilstand | Managed | 12. august 2026 — bekræftet på skærmen: udfordringen løses af sig selv på ca. et sekund og ender i et grønt "Succes!" uden et klik |
| Site key (offentlig) | `VITE_TURNSTILE_SITE_KEY` i Vercel | **10. august 2026 — sat OG udrullet.** Aflæst på, at widgeten tegnes på login-skærmen; komponenten returnerer `null` uden nøgle, så der er ingen mellemtilstand |
| Site key i **Preview** | **Bevidst ikke sat** — preview kører mod staging (`B18`), som ikke har Bot Protection | 10. august 2026 |
| Secret key (hemmelig) | Kun i Supabase → Authentication → Attack Protection | **12. august 2026 — indtastet og virksom.** Afvisningen i trin 5, punkt 4 er selve beviset: Supabase kan kun afvise, hvis den taler med Cloudflare, og nøglerne hører derfor til samme widget |
| Bot Protection | **Slået TIL** | **12. august 2026 — alle fire kontroller i trin 5 bestået**, inklusive afvisningen af et kald uden kvittering. (Var kortvarigt slået til 10. august og lukkede adgangen for alle, fordi trin 3 var sprunget over — se "Første kørsel" nederst) |
| Confirm email | **Slået TIL** | **12. august 2026 — bekræftet på GoTrues eget `/auth/v1/settings`:** `mailer_autoconfirm = false`. Talt op forinden: nul konti med `email_confirmed_at is null`, så ingen sad fast i forvejen. (Var kortvarigt slået til 10. august 08:04–ca. 09:43 og efterlod én ubekræftet konto, som blev bekræftet i hånden) |
| Skabelon: Confirm signup | Emne + brødtekst fra [`mail/confirm-signup.html`](./mail/confirm-signup.html) | ? — indsat 10. august 2026, men aldrig aflæst på en modtaget mail |

**`?` betyder "aldrig kørt"**, ikke "kørt og bestået". Udfyld datoerne, når
beviserne nedenfor er gået igennem — forskellen er hele pointen med registeret.

> **Status 10. august 2026:** trin 1–3 er kørt og trin 3 er bestået — nøglen er
> udrullet, og widgeten tegnes. Begge knapper i Supabase står på **fra** efter
> et rollback. Næste skridt er trin 4, som nu er den knap, den skulle have været
> hele tiden: en, der kan trykkes tilbage.
>
> **Status 12. august 2026: BOT-VÆRNET ER I DRIFT.** Trin 3 fik et punkt 4 —
> kontrollen af, at værtsnavnet accepteres — og den bestod: `getResponse()` gav
> en token på produktionens login-skærm. Det var det ene ubeviste punkt foran
> trin 4, og med det af vejen blev **trin 4 og hele trin 5 kørt samme dag**,
> inklusive den fjerde kontrol, der ikke kan snydes.
>
> **Og e-mailbekræftelsen er slået til samme dag.** Trin 6 og 7 er kørt,
> `mailer_autoconfirm` står på `false`, og der blev talt nul ubekræftede konti
> forinden. **Tilbage står alene trin 8** — de fem beviser, som kræver en rigtig
> oprettelse mod en adresse, der kan læses. Indtil de er kørt, er `B26`
> konfigureret, men ikke efterprøvet: den femte kontrol (brugernavnet står i
> appen) er den eneste, der rører `sikrProfil()`, og den kan kun køres af et
> menneske med en indbakke.

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

> **Preview-deploys rammes ikke, og det skyldes `B18`.** Preview peger på sit
> eget Supabase-projekt (staging, leveret 6. august 2026 — se
> [`STAGING.md`](./STAGING.md)), og Bot Protection er en indstilling **pr.
> projekt**. Slås den til i produktionen, gælder den kun dér. Derfor står
> preview-værtsnavnene heller ikke på widgeten, og derfor sættes nøglen kun i
> Production (trin 2).
>
> Skriv `localhost` på listen, hvis du vil kunne bruge værnet i `npm run dev` —
> men det kræver, at nøglen står i `.env.local`, og det er bevidst ikke
> standard.

## Trin 2 — Vercel: sæt nøglen

Settings → Environment Variables → Add.

| Felt | Værdi |
|---|---|
| Name | `VITE_TURNSTILE_SITE_KEY` |
| Value | Site key fra trin 1 |
| Environments | **Kun Production** |

> **Preview skal IKKE have nøglen.** Preview peger på staging-projektet
> (`B18`), som har sin egen Attack Protection — slået fra. En widget dér ville
> udstede kvitteringer, ingen kontrollerer, og fejle på et værtsnavn, der ikke
> står på listen, uden at det betød noget. Støj uden gevinst.
>
> *(Rettet 10. august 2026. Her stod "Production og Preview" med den begrundelse,
> at de to miljøer deler Supabase-projekt. Det var sandt indtil 6. august, hvor
> `B18` gav preview sit eget projekt.)*

Variablen er en `VITE_`-variabel og bages ind i buildet. **Den virker først
efter en ny deploy** — en ændret miljøvariabel rører ikke det build, der kører.

## Trin 3 — Kontrollér FØR du rører Supabase

Dette trin er hele sikkerhedsnettet. Bot Protection er stadig slået fra, så
GoTrue ignorerer kvitteringen — intet kan gå i stykker endnu.

1. Redeploy produktionen (Vercel → Deployments → Redeploy på seneste).
2. Åbn `https://prediction-champ.vercel.app` og log **ud**.
3. **Se widgeten stå på login-skærmen.** Gør den ikke det, er nøglen ikke med i
   buildet — gå ikke videre.
4. **Se widgeten sige "Succes!", og bekræft med én linje i konsollen.** Dette er
   kontrollen af VÆRTSNAVNET, og den er den eneste af de fem, der efterprøver,
   at Cloudflare rent faktisk udsteder en kvittering. En widget tegnes nemlig
   også på et domæne, der ikke står på listen — den fejler først bagefter, og
   punkt 3 alene beviser derfor kun, at nøglen er i buildet.

   ```js
   window.turnstile.getResponse()
   ```

   | Svar | Betyder |
   |---|---|
   | En lang streng (`0.hNrjF7RVn7DRsDo7kMtS6G…`) | Kvitteringen er udstedt, værtsnavnet er accepteret |
   | `""` eller `undefined` | Ingen kvittering. Kig efter Cloudflares kode i konsollen — `110200` er "domain not allowed" (trin 1, punkt 3); ellers er scriptet blokeret af en annonceblokering |

   > **Widgeten forsvinder IKKE, når den er løst** — den bliver stående med et
   > grønt "Succes!", og det er den readable kvittering. Det, der forsvinder, er
   > den grå linje "Bekræfter, at du ikke er en robot …" UNDER widgeten
   > (`TurnstileVenter`, vist så længe `captchaToken` er tom). I Managed-tilstand
   > løses udfordringen på ca. et sekund, så linjen når sjældent at blive set —
   > **dens fravær er derfor et dårligt bevis, og `getResponse()` et godt et.**
   >
   > *(Rettet 12. august 2026. Punktet bad oprindeligt om at "se sætningen
   > forsvinde", og første læser aflæste det på widget-boksen, der blev stående,
   > og konkluderede at kontrollen fejlede — mens tokenen var udstedt.)*
5. **Log ind igen. Det skal virke.** Gør det ikke, er noget galt med selve
   udrulningen, og du har stadig ingen låst dør.

Består alle fem, er trin 4 en knap, du kan trykke tilbage.

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

   **I PowerShell er det den her i stedet** — på ÉN linje:

   ```powershell
   curl.exe -s -X POST "https://qfcjbpvttburccdyfnkx.supabase.co/auth/v1/signup" -H "apikey: sb_publishable_Et9Dahm8LOhZk6cS1XRqhA_9RuNmnvC" -H "Content-Type: application/json" -d '{\"email\":\"bot-test@example.com\",\"password\":\"hemmelig123\"}'
   ```

   > **Tre ting adskiller dem, og alle tre fejler tavst.**
   > 1. **`curl.exe`, ikke `curl`.** I Windows PowerShell 5.1 er `curl` et alias
   >    for `Invoke-WebRequest`, som ikke forstår `-H` og `-d` — den tolker `-d`
   >    som forkortelse for noget helt andet og svarer med en parameterfejl, der
   >    intet har med Supabase at gøre.
   > 2. **Ingen `\` til linjeskift.** Backslash er ikke fortsættelsestegn i
   >    PowerShell (det er backtick `` ` ``), så kommandoen bliver klippet over
   >    ved første linjeskift og sendt af sted halv.
   > 3. **De indre `"` skal escapes som `\"`.** PowerShell fjerner anførselstegn,
   >    når argumenter gives videre til et rigtigt program, så et ikke-escapet
   >    JSON-legeme når frem som `{email:...}` — ugyldig JSON, og svaret bliver
   >    en parsefejl i stedet for det captcha-svar, kontrollen leder efter.

   **Forventet:** en fejl, der nævner captcha. Det svar, kontrollen gav 12.
   august 2026, var ordret:

   ```json
   {"code":400,"error_code":"captcha_failed","msg":"captcha protection: request disallowed (no captcha_token found)"}
   ```

   Parentesen varierer — advarslen om rækkefølgen ovenfor citerer
   `(not-provided)`, som er den samme afvisning set fra login-endpointet. Det er
   `error_code: captcha_failed`, der er beviset, ikke den præcise sætning.

   Får du i stedet en oprettet bruger, er værnet slået til i panelet uden at
   være aktivt — og så er trin 4 ikke gennemført.

Udfyld registeret, når de fire er gået igennem.

## Trin 6 — Skabelonen, FØR bekræftelsen slås til

Authentication → Email Templates → **Confirm signup**.

| Felt | Værdi |
|---|---|
| Subject | `Bekræft din e-mail` |
| Body | [`mail/confirm-signup.html`](./mail/confirm-signup.html) **fra `<table role="presentation"` og ned** |

> **Tag ikke kommentarhovedet med.** Filens første 31 linjer er interne noter —
> de nævner backlog-rækker, kodestier og hændelsen 10. august — og en HTML-
> kommentar forsvinder ikke, fordi den ikke vises: den rejser med i mailens
> kilde og kan læses af enhver modtager, der åbner "vis original". Den gør
> ingen skade, men den hører ikke til i en mail til en fremmed.

> 🛑 **Denne rækkefølge er ikke kosmetisk.** Slås bekræftelsen til før
> skabelonen er indsat, går den første mail ud med Supabases engelske standard
> — præcis den fejl, `B25` allerede betalte for på emnelinjen (`MAIL.md`,
> "Emnet er et SEPARAT felt"). Emnet er et selvstændigt felt over brødteksten og
> bliver stående på engelsk, hvis kun brødteksten indsættes.

## Trin 7 — Slå bekræftelsen til

> **Denne kontakt kan IKKE låse eksisterende brugere ude — og det er værd at
> vide, fordi den forveksles med trin 4, som kan.** Bot Protection er en global
> port foran tre endpoints; `Confirm email` afvises pr. bruger på deres eget
> `email_confirmed_at`. Beviset er rollback-afsnittets asymmetri nedenfor: en
> ubekræftet konto kommer ikke ind igen ved at slå kontakten fra, hvilket kun
> giver mening, hvis kontakten aldrig var det, der spærrede. **Er du bekræftet i
> dag, mærker du intet. Er du ubekræftet i dag, er du allerede låst ude.**
>
> **Kør alligevel denne først** — ikke fordi kontakten skader dem, men så et
> tal, du kendte i forvejen, ikke bliver til en mistanke mod kontakten i morgen:
>
> ```sql
> select email, created_at, last_sign_in_at, email_confirmed_at
>   from auth.users
>  where email_confirmed_at is null
>  order by created_at;
> ```
>
> **Nul rækker er det forventede.** Kommer der rækker, så ryd dem FØR du slår
> til: `Resend confirmation` i ⋯-menuen under Authentication → Users er den
> rigtige vej, og den manuelle `update` nederst i denne fil er nødløsningen med
> den pris, der står beskrevet dér.

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

I PowerShell — her er der ingen JSON at escape, så den kan bruge det indbyggede
og læse feltet direkte frem for at lede i et helt svar:

```powershell
(Invoke-RestMethod 'https://qfcjbpvttburccdyfnkx.supabase.co/auth/v1/settings' -Headers @{ apikey = 'sb_publishable_Et9Dahm8LOhZk6cS1XRqhA_9RuNmnvC' }).mailer_autoconfirm
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
bekræfte, kan ikke logge ind — heller ikke efter et rollback.** Kontakten
gælder kun NYE oprettelser; den går ikke tilbage og bekræfter dem, der allerede
står med `email_confirmed_at = null`. Det er den ene ting ved bekræftelsen, der
ikke ruller tilbage af sig selv.

**Sådan bekræfter du for dem.** Knappen ligger i ⋯-menuen på brugerens række
under Authentication → Users og vises kun for ubekræftede konti — men gå i SQL
Editor i stedet, hvis den ikke er til at finde:

```sql
update auth.users
   set email_confirmed_at = now()
 where email = 'deres@mail.dk'
returning email, email_confirmed_at;
```

Rør kun `email_confirmed_at`; `confirmed_at` er genereret af den og kan ikke
sættes. **Vær opmærksom på, hvad det koster:** en manuel bekræftelse springer
netop det bevis over, bekræftelsen findes for — at adressen tilhører dem.
I en vennekreds er det uproblematisk, men adressen står fremover som verificeret
uden at være det. Vil du hellere have flowet kørt rigtigt, så brug **Resend
confirmation** fra samme menu.

> **Bekræftelsen alene skaber ikke profilrækken.** Den skrives af appen ved
> brugerens første *login* — det er der, der findes en token. Kig derfor ikke
> efter dem i `public.profiles` eller i appens Admin → Brugere umiddelbart efter
> en bekræftelse; de dukker først op, når de har logget ind.

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

- **Skifter appens adresse (`I10`/`B21` → `app.leagly.app`):** værtsnavnet på
  Turnstile-widgeten skal med i samme ombæring som Site URL og Redirect URLs.
  Glemmes widgeten, fejler bot-tjekket på den nye adresse, mens alt andet ser
  rigtigt ud — og symptomet er, at ingen kan logge ind på det nye domæne.
  **Tilføj det nye værtsnavn FØR det gamle fjernes,** så begge adresser virker,
  mens redirectet står. Trinnet er nummer 5 i [`DOMAENE.md`](./DOMAENE.md).
- **Skal værnet afprøves uden risiko:** slå det til i **staging** først (`B18`,
  leveret 6. august 2026). Preview peger derind, og projektet har sine egne
  Attack Protection-indstillinger, så en fejl koster ingen rigtige brugere
  adgang. Det kræver en widget mere hos Cloudflare med preview-værtsnavnet på
  — og det er den billigste måde at tage trin 3–5 om på.
- **Slås værnet fra permanent:** fjern også `VITE_TURNSTILE_SITE_KEY` fra
  Vercel, så koden og konfigurationen siger det samme. En nøgle, der er sat uden
  at blive brugt, får den næste læser til at tro, at værnet er aktivt.

---

## Første kørsel, 10. august 2026 — hvad den lærte

Runbogen blev fulgt samme dag, den blev skrevet, og gik i stå tre gange. Alle
tre er rettet ovenfor; de står her, fordi det er den slags, der ellers findes
igen ved næste kørsel.

**1. Trin 7 stod tre forskellige steder, før den stod rigtigt.** `Confirm email`
sidder i blokken `User Signups` ØVERST på Sign In / Providers — ikke i
Email-provideren og ikke under Emails. Runbogen gættede to gange forkert, fordi
Supabase har flyttet indstillingen mellem dashboard-versioner. Det er derfor
kontrollen i trin 7 nu spørger GoTrues `/auth/v1/settings` frem for menuen: den
er sand, uanset hvad knappen hedder i denne uge.

**2. Trin 3 blev sprunget over, og prisen var, at ingen kunne logge ind.** Bot
Protection blev slået til, uden at kontrollen "se widgeten stå på login-skærmen"
var kørt — og en `VITE_`-variabel virker først efter en NY deploy. Klienten
sendte derfor ingen kvittering, og døren lukkede for alle. **Trin 3 er ikke en
formalitet; den er hele forskellen på en knap, der kan trykkes tilbage, og en
hændelse.**

**3. Appen sagde "Noget gik galt" til to helt forskellige fejl — og det var en
rigtig fejl i koden.** `restError()` læste kun `message`, men GoTrue svarer
`msg`, og `res.statusText` er tom over HTTP/2. Hver eneste auth-fejl endte
derfor uden tekst, og både bot-værnets afvisning og "Email not confirmed" blev
til appens mest intetsigende sætning — med det præcise svar liggende i kroppen,
hvor ingen kunne se det. Rettet samme dag (`fejltekst()` i `src/lib/supabase.js`
plus to oversættelser i `AUTH_FEJL`).

**Det, der virkede efter hensigten:** en bruger oprettede sig 08:04, mens
bekræftelsen var slået til, nåede ikke linket inden for den time, det gælder, og
blev bekræftet i hånden. Ved hans første login skrev `sikrProfil()` hans
brugernavn på plads fra `raw_user_meta_data` — altså præcis det hul, `B26`s
klientside blev bygget for at lukke, efterprøvet på en rigtig konto frem for i
en test.
