# Mail-register og runbog

Kilden til sandhed for, hvem der sender appens mails, hvem der modtager dem, og
hvilke DNS-poster de to hviler på.

## Hvorfor denne fil findes

Appen sender **to** mails, og de er begge kritiske: bekræftelse af e-mail og
nulstilling af adgangskode. Begge afsendes af Supabase Auth, ikke af kode i dette
repo — `src/lib/supabase.js:126-133` kalder `/auth/v1/signup` og
`/auth/v1/recover` med kun `{ email, password }`. Der er **ingen**
`emailRedirectTo`, ingen skabelon og ingen afsender nogen steder i koden.
Afsender, emne, brødtekst og linkets adresse bestemmes hundrede procent af
konfiguration uden for repoet.

Indtil `B25` gik de gennem Supabases indbyggede mailservice, som er delt og
stærkt rate-begrænset. Det er en udviklings-facilitet, ikke en leveringskanal, og
konsekvensen var konkret: **den første fremmede, der glemte sin adgangskode, var
låst ude.** Glemt-adgangskode er ellers bygget færdig i begge ender —
`src/screens/Auth.jsx:274` (knappen), `:217` (kaldet), `ResetPasswordScreen` på
`:134-181`, og `src/App.jsx:34`, som fanger `#type=recovery`.

Filen erstatter ikke Resend, Microsoft 365 eller DNS-panelet. Den er den liste,
man holder dem op imod.

> **Denne fil er kun sand, hvis den vedligeholdes.** Skifter du afsender, flytter
> en DNS-post eller retter en skabelon, så ret tabellerne i samme ombæring. Et
> register, der er forkert, er værre end intet register, fordi man tror på det.

## De to postkasser — og hvorfor de ikke er samme problem

Det er den skelnen, hele opsætningen hviler på, og den er nem at rode sammen:

| | `noreply@leagly.app` | `kontakt@leagly.app` |
|---|---|---|
| Retning | Kun **ud** | Kun **ind** |
| Hvem | Resend | Microsoft 365 |
| Hvad | Bekræftelse og nulstilling | Indsigt, sletning, spørgsmål |
| Postkasse? | **Nej** — svar skal bounce | Ja, ejerens |
| Lovet i | — | `src/lib/legal.js`, to steder |

`legal.js` lover, at kontakt-adressen *"virker også, hvis du ikke kan logge ind"*.
Det er præcis dét, `noreply@` per definition ikke gør — derfor to adresser, to
leverandører og to helt forskellige krav.

> 🛑 **Opret ikke `noreply@` som postkasse i Microsoft 365.** At svar bouncer er
> den rigtige adfærd, ikke en fejl. En postkasse dér ville samle svar op, som
> ingen læser, og det er værre end et afvist svar, brugeren kan se.

## Registeret

### Afsendelse (Resend)

| Felt | Værdi | Sidst verificeret |
|---|---|---|
| Udbyder | Resend | ? |
| Afsender | `noreply@leagly.app` | ? |
| Verificeret domæne | `leagly.app` (poster lægges på `send.leagly.app`) | ? |
| Region | ? — sættes i trin 1, og `legal.js` afhænger af svaret | ? |
| Plan | Free | ? |
| Loft | 3.000 mails/md, 100/dag (aflæses på planen) | ? |

**Loftet er rigeligt og bliver ved med at være det.** To mails pr. bruger i hele
kontoens levetid — én bekræftelse, og en nulstilling hvis de glemmer. Selv
`A34`s udløser (200–500 ugentligt aktive) rører det ikke.

### Modtagelse (Microsoft 365)

| Felt | Værdi | Sidst verificeret |
|---|---|---|
| Adresse | `kontakt@leagly.app` | ? |
| Hvor | Microsoft 365-postkasse på domænet | ? |
| Bruges af | `src/lib/legal.js` (indsigt/sletning), `site/om.html` | ? |

### DNS-poster

To afsendere deler ét domæne. **De kan sameksistere, fordi de ikke rører de samme
navne** — alt, hvad Resend har brug for, ligger under `send.leagly.app`, og roden
er Microsofts alene:

| Navn | Type | Ejer | Sidst verificeret |
|---|---|---|---|
| `leagly.app` | MX | Microsoft 365 (indgående `kontakt@`) | ? |
| `leagly.app` | TXT · SPF | Microsoft (`include:spf.protection.outlook.com`) | ? |
| `selector1._domainkey`, `selector2._domainkey` | CNAME | Microsofts DKIM | ? |
| `send.leagly.app` | MX | Resend (bounce, peger på AWS SES) | ? |
| `send.leagly.app` | TXT · SPF | Resend | ? |
| `resend._domainkey.send.leagly.app` | TXT | Resends DKIM | ? |
| `_dmarc.leagly.app` | TXT | Fælles for begge afsendere | ? |

> ⚠️ **De præcise værdier står ikke her, og det er med vilje.** DKIM-nøglen og
> SES-værten er kontospecifikke, og formen kan ændre sig hos Resend. Kopiér dem
> fra Resends egen skærm ved opsætningen. Formen ovenfor er aflæst af Resends
> dokumentation 9. august 2026 og er en **antagelse**, indtil den er set i
> panelet — udfyld `Sidst verificeret`, når den er.

> 🛑 **Fælden, der vælter begge afsendere på én gang.** Resends SPF-post hører til
> på `send.leagly.app`. Lægges den i stedet som en **anden** TXT-post på roden ved
> siden af Microsofts, har domænet to SPF-poster på samme navn — og det er
> `permerror` efter specifikationen, ikke "begge gælder". Så fejler *både*
> nulstillingsmails og almindelig post til og fra `kontakt@`. Skal to afsendere
> nogensinde stå på samme navn, skal de flettes til **én** post med to `include:`.

> ⚠️ **DMARC skal stå på relaxed alignment, som er standarden.** Resend signerer
> med `d=send.leagly.app`, mens afsenderen er `noreply@leagly.app`. Relaxed
> alignment accepterer et underdomæne; **strict** (`adkim=s`/`aspf=s`) gør ikke,
> og så fejler DMARC, selv om både SPF og DKIM består hver for sig. Det er en
> fælde, fordi den ser ud som en stramning, der ikke kan skade.

### Supabase → Auth

| Indstilling | Værdi | Sidst verificeret |
|---|---|---|
| SMTP Settings | Resends host, port, brugernavn, API-nøgle som password | ? |
| Sender email | `noreply@leagly.app` | ? |
| Sender name | Leagly | ? |
| Rate Limits → e-mails | Hævet fra standarden | ? |
| Site URL | Appens adresse — **bestemmer linket i mailen** | ? |
| Confirm email | **Slået fra** indtil `B26` | ? |

## Runbog: opsætning fra bunden

**Sæt en time af.** Trin 1–3 er nødvendige, før noget virker; trin 4 gør mailene
danske, og "Bevis, at det virker" er det eneste, der afgør, om du kan stole på
resultatet. DNS-udbredelse kan tage fra minutter til timer — regn med at skulle
vende tilbage til trin 1 for at trykke "Verify".

### Trin 0 — forudsætninger

- `leagly.app` er købt, og du kan redigere dens DNS.
- `kontakt@leagly.app` findes allerede som Microsoft 365-postkasse.
- Adgang til Supabase-projektets dashboard.

### Trin 1 — Resend-konto og verificér domænet

1. Opret konto på Resend, og tilføj domænet **`leagly.app`** (ikke
   `send.leagly.app` — Resend laver selv underdomænet).
2. **Vælg region.**
   > ⚠️ **Dette valg står i privatlivspolitikken.** Vælges EU (Irland), kan
   > linjen om Resend i `src/lib/legal.js` udvides med, at serverne står i
   > Irland — som linjen om Supabase gør. Vælges en region uden for EU, **skal**
   > linjen i stedet sige, at mails behandles uden for EU. Teksten står i dag
   > uden regionsangivelse, netop fordi valget ikke var truffet. Ret den i samme
   > ombæring som dette trin.
3. Noter de DNS-poster, Resend viser. Skriv dem ind i registeret ovenfor.

### Trin 2 — DNS-posterne

Læs 🛑-advarslen om SPF ovenfor, **før** du tilføjer noget.

1. Tilføj Resends MX, SPF og DKIM på de navne, Resend angiver — alle under
   `send.leagly.app`. Rør ikke rodens MX eller SPF; de er Microsofts.
2. Sæt eller efterse `_dmarc.leagly.app`. Relaxed alignment.
3. Tryk "Verify" i Resend. Fejler den, se fejlfindingstabellen.

### Trin 3 — Supabase → Auth → SMTP Settings

1. Slå custom SMTP til, og indsæt Resends host, port, brugernavn og API-nøgle.
2. Sender email `noreply@leagly.app`, sender name `Leagly`.
3. **Hæv rate limit** under Auth → Rate Limits. Det er et selvstændigt trin og
   ikke pynt: loftet er lavt, *fordi* den indbyggede service er delt, og skifter
   du kun SMTP'en, sidder halvdelen af problemet der endnu.
4. Kontrollér **Site URL**. Den bestemmer, hvor linket i mailen peger hen, og
   der findes ingen `emailRedirectTo` i koden til at overstyre den.
   > ⚠️ **`B21` flytter appens adresse.** Sker det, skal Site URL med — ellers
   > peger hver nulstillingsmail på en adresse, der ikke svarer, mens alt andet
   > ser rigtigt ud.

### Trin 4 — skabelonerne

Under Auth → Email Templates. Indsæt indholdet af:

| Skabelon i Supabase | Fil |
|---|---|
| Reset Password | [`mail/recovery.html`](./mail/recovery.html) |
| Confirm signup | [`mail/confirm-signup.html`](./mail/confirm-signup.html) |

De øvrige fire — Invite user, Magic Link, Change Email Address,
Reauthentication — beholder Supabases standard. Ingen af flowene er i brug:
appen har hverken invitationsmails, magic links eller e-mailskift.

`Confirm signup` bruges først, når `B26` slår bekræftelse til. Den skrives nu, så
`B26` bliver ét klik og ikke en skjult tekstopgave.

> ⚠️ **Supabase har ingen import.** Ændres en skabelon i repoet, er ændringen
> ikke udrullet, før nogen har pastet den ind igen. Der er ingen maskine, der
> opdager forskellen.

## Bevis, at det virker

Fire kontroller. **Den tredje er den eneste, der ikke kan snydes.**

1. **Send.** Nulstil adgangskoden fra appen mod en engangsadresse, du kan læse.
2. **Læs headeren.** `spf=pass`, `dkim=pass`, `dmarc=pass`, og afsenderen skal
   være `noreply@leagly.app` — ikke Supabases. I Gmail: "Vis original".
3. **Følg linket, og se `ResetPasswordScreen` åbne.** En korrekt afsender med et
   link, Site URL peger forkert hen, ser rigtig ud lige indtil nogen klikker —
   og det er den fejl, der ville ramme en bruger, som allerede er låst ude.
4. **Send udefra til `kontakt@leagly.app`, og se den lande.** Beviset for, at
   Resend-posterne ikke rørte den indgående post. Springes den over, opdages en
   SPF-kollision først, den dag nogen forgæves prøver at kontakte os om sine data.

Udfyld `Sidst verificeret` i registeret, når de fire er gået igennem. **Indtil da
er `B25` ikke leveret** — koden i dette repo er kun det halve.

## Fejlfinding

| Symptom | Årsag | Løsning |
|---|---|---|
| Resend verificerer ikke domænet | Posterne står på roden i stedet for `send.leagly.app` | Flyt dem. Se 🛑-advarslen om SPF |
| Resend verificerer ikke domænet | DNS-udbyderen har tilføjet domænet til MX-værdien, så den ender på `…amazonses.com.leagly.app` | Afslut værdien med et punktum |
| Mailen kommer aldrig | Supabase bruger stadig den indbyggede service | Custom SMTP er ikke slået til i trin 3 |
| Mailen kommer, men lander i spam | DKIM eller DMARC fejler | Læs headeren (kontrol 2). Er `dkim=pass` men `dmarc=fail`, står DMARC på strict — se ⚠️ ovenfor |
| Nogle mails kommer, andre ikke | Rate limit | Trin 3.3 |
| Linket åbner appen, men ikke nulstillingsskærmen | Site URL peger forkert, eller `#type=recovery` er strippet | Trin 3.4. Appen læser hash'et i `src/App.jsx:34` |
| Post til `kontakt@` er holdt op med at komme | To SPF-poster på roden | 🛑-advarslen ovenfor |

## Hold øje med

- **Forbruget hos Resend** — én gang i kvartalet er rigeligt. To mails pr. bruger
  i hele kontoens levetid; kommer du nær loftet, er det et symptom, ikke vækst.
- **Bounces.** Mange bounces på samme domæne er tegn på, at nogen opretter konti
  med adresser, de ikke ejer — hvilket er præcis det, `B26` findes for.
- **DKIM-nøgler udløber ikke,** men bliver slettet, hvis nogen rydder op i DNS.
  Registeret ovenfor er listen at holde panelet op imod.

## Når noget ændrer sig

- **Skifter appens adresse (`B21`):** Site URL i Supabase skal med. Skabelonerne
  skal *ikke* røres — de indeholder ingen adresse, og
  `docs/mail/templates.test.js` håndhæver det.
- **Skifter afsender væk fra Resend:** fjern posterne under `send.leagly.app`,
  ret SMTP-indstillingerne, og **slet linjen om Resend i `src/lib/legal.js`** i
  samme ombæring. En databehandler, der står i politikken uden at findes, er
  samme slags fejl som en, der findes uden at stå der.
- **Slås "Confirm email" til (`B26`):** skabelonen ligger klar, og
  `DOCUMENTATION.md` §12's linje om, at "alle kan oprette konti uden
  godkendelse", holder op med at være sand.
