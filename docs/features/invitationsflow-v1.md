# Invitationsflowet v1 (`I7`)

Leveret 11. august 2026. Beslutningerne bag: `DECISIONS.md` 11. august 2026
(`A41`, crawler-portvagten, `B20`-fravalget). Migrering: `sql/invite_preview.sql`
(`#54`).

Invitationer er den eneste vej ind i produktet — offentlige og søgbare ligaer er
bevidst fravalgt (`liga-laget-v1.md` linje 224). Selve flowet var alligevel
aldrig blevet gennemgået som **én samlet oplevelse**, kun bygget stykke for
stykke: liga-linket med liga-laget, konkurrence-linket med `A7`, koden som
hemmelighed med `A40`.

Denne spec beskriver flowet ende til ende. Modellen — hvad en kode ER, og hvad
den giver adgang til — bor stadig i `liga-laget-v1.md`.

---

## 1. De fem huller, der blev lukket

Alle fem sad efter hinanden i den samme tragt, og alle fem ramte den **nye**
bruger:

| # | Hullet | Hvad modtageren oplevede |
|---|---|---|
| 1 | `index.html` havde kun `<title>` | Et delt link viste en nøgen URL uden billede og uden tekst |
| 2 | `invite_lookup()` kræver `auth.uid()` | En generisk login-formular uden en antydning af hvorfor |
| 3 | Koden lå kun i React-state | Invitationen var væk, hvis brugeren forlod siden |
| 4 | `GroupScreen` skrev upersonligt | "Du er inviteret til ligaen X" — ingen afsender |
| 5 | Kun `sent` og `accepted` blev logget | Ingen kunne se, hvor folk faldt fra |

---

## 2. Link-previewet

**Statisk (alle):** `index.html` bærer `description`, `og:*` og
`twitter:card=summary_large_image`. Billedet er `public/og-image.png`, 1200×630.

**Adressen stemples ind ved build.** `og:image` skal være absolut, og
produktionsdomænet er et åbent spørgsmål (`I10`/`B21`). En lille
`transformIndexHtml`-plugin i `vite.config.js` erstatter `%OG_ORIGIN%` med
`https://$VERCEL_PROJECT_PRODUCTION_URL` og falder tilbage til dagens adresse.
Skift af domæne kræver derfor ingen kodeændring. Preview-deploys arver
produktionens adresse med vilje — et preview skal ikke udgive sig selv som
kanonisk.

**Billedet bygges, det tegnes ikke.** `scripts/build-og-image.mjs` komponerer
det ud af `public/leagly-wordmark-navy.png` (som allerede lå i repoet uden
aftager) på brandets navy, kun med `node:zlib`. Scriptet køres i hånden og
committes sammen med sit resultat, så billedet kan genskabes, når wordmarket
skiftes.

> **Ordlyden er bevidst ikke malet ind i billedet.** To grunde, og de peger
> samme vej: der er ingen skrifttype at male med (projektets Barlow ligger kun
> som `.woff2`, og at pakke den ud kræver et bibliotek, projektet ikke har), og
> et OG-billede vises ofte som en miniature på ~120 px højde, hvor en tagline
> sat ved 1200 px bredde er ulæselig. `og:title` bærer sætningen som **rigtig
> tekst** — i modtagerens egen skriftstørrelse og læsbar af en skærmlæser.
> Et designet billede med tagline er en designopgave og står i backloggen.

**Dynamisk (kun crawlere):** `api/invite-preview.js` svarer med ligaens eget
navn og antallet af spillere. `middleware.js` omskriver kun, når **både**
`?liga=`/`?join=` og en crawler-agent er til stede.

> **Rettelse 12. august 2026 — portvagten lå først i `vercel.json` og virkede aldrig.**
> `rewrites` ligger efter filsystem-opslaget, og der findes en fysisk `index.html`
> på `/`, så reglen kunne ikke fyre: `api/invite-preview.js` blev ALDRIG kaldt i
> produktion. Logikken bor nu i Routing Middleware, som kører før filsystemet.
> **Reglerne er ordret de samme** — kun stedet er flyttet. Se `DOCUMENTATION.md` §13.

- Et menneske kan pr. konstruktion ikke ende i funktionen. "Fejl åben" er
  dermed en egenskab ved opsætningen, ikke et løfte koden skal holde.
- Enhver fejl — manglende konfiguration, timeout, ukendt kode — svarer 200 med
  de **generelle** tags. Aldrig 500, aldrig et redirect.
- **Koden ekkoes aldrig:** ikke i teksten, ikke i `og:url` (som peger på
  forsiden uden query) og ikke i en fejlbesked. `X-Robots-Tag: noindex`.
- Alle navne HTML-escapes — et liganavn er brugerskrevet tekst.
- Googlebot står bevidst ikke på listen.

⚠️ Udtrykket er nu en almindelig JavaScript-regex i `middleware.js` og dækket af
`middleware.test.js`. **Men afprøv det stadig på et preview-deploy** med
`curl -A "WhatsApp/2.23" "$URL/?liga=<kode>"`: en test kan bevise, at porten
vælger rigtigt, men ikke at Vercel overhovedet kalder den — og det var præcis
dét, der gik galt første gang.

---

## 3. Invitationskontekst uden login

`invite_preview(p_code text)` — `security definer`, `stable`, **ingen
`auth.uid()`-vagt**, åben for `anon`.

```
{"kind":"group","name":…,"member_count":…}
{"kind":"competition","name":…,"group_name":…,"member_count":…}
{"kind":"none"}
```

Koden matches **eksakt**, ligesom `invite_lookup()` — svarede den ene mere for
at være venlig, kunne en kode have en billedtekst uden at have et opslag.

Login-skærmen skriver da *"Du er inviteret til ligaen «Fodboldkammeraterne». 6
spillere er allerede med. Opret en konto for at være med."* og åbner på **Opret
konto** frem for Log ind. Udebliver previewet, ser skærmen ud præcis som før —
der findes ingen fejltilstand, kun to gode skærme.

**Opslaget sker i `App.jsx`, og resultatet gives til `AuthScreen` som en prop.**
Det er ikke arkitektur for arkitekturens skyld: skærmtestene bruger
`renderToStaticMarkup`, hvor effekter ikke kører, så et opslag inde i skærmen
ville være utestbart. Ordlyden bor i `invitationsPitch()` — en ren funktion — af
samme grund.

### Sikkerhedsafvejningen

Se `DECISIONS.md` (`A41`) og hovedet i `sql/invite_preview.sql`. Kort:
etiket ≠ adgang; koden er 8 hextegn med et `unique`-indeks; præmien for et
gæt er et liganavn; tilbagevejen koster én linje.

> **Fund undervejs, som ikke var en del af opgaven.** `anon` har EXECUTE på
> **hver eneste funktion** i `public` via Supabases default privileges — `G50`
> og `G58` lukkede tabellerne og sekvenserne, ikke funktionerne. Det er ikke et
> hul i dag, fordi `invite_lookup()` og `accept_invite()` begge afviser en
> kalder uden `auth.uid()`. Men det gør den vagt **bærende** frem for en
> dobbeltsikring, og `sql/tests/invite_preview.sql` måler den derfor som
> **adfærd** og ikke som en grant. Selve oprydningen står i backloggen.

---

## 4. Invitationen overlever oprettelses-omvejen

`pc_pending_invite` i `localStorage`: `"<param>:<kode>:<ms>"`, levetid ét døgn.

- **Enheds-global og ikke bruger-mærket** — der er pr. definition ingen bruger
  endnu; det er hele situationen, nøglen findes for. Samme undtagelse som
  sessionen, og privatlivspolitikken siger det nu om begge.
- **Adressen vinder altid.** Står man med et friskt link i hånden, er det dét,
  man mener.
- Skrives og læses i en **effekt**, aldrig under render: både en skrivning til
  `localStorage` og et opslag på uret er urene dér.
- Ryddes ved indløsning (uanset udfald), ved udløb, og ved kontolukning.

Nøglen har tre maskinelt håndhævede aftagere (`G71`): `LOKALE_NØGLER`,
guard-testen i `src/lib/data/account.test.js` og privatlivspolitikken i
`src/lib/legal.js` + oversættelsestabellen i `src/lib/legal.test.js`.

**Grænsen, der ikke er lukket:** åbnes bekræftelses-mailen i en *anden browser*
end den, oprettelsen skete i, er invitationen stadig væk. Koden kan da tastes i
hånden ("Har du en kode?").

**`redirect_to` på GoTrue-signup: overvejet og fravalgt.** Det ville kræve, at
URL'en står på Supabases tilladelsesliste — en konfigurationsafhængighed, som
ingen test i repoet kan se — og det løser ikke tilfældet ovenfor.
`localStorage` dækker det samme uden.

---

## 5. Afsenderen

`inviteShareText({ inviterName, mål, link })` i `src/lib/share.js`. Begge skærme
kalder den, så tonen ikke kan drive fra hinanden igen. `mål` er hele frasen
(`ligaen "Vennerne"` / `konkurrencen "EM-kuponen"`), fordi sætningen skal kunne
bøjes forskelligt for de to.

`inviterName` er afsenderens **eget** navn, aflæst når der trykkes Del, og
derfor sandt pr. konstruktion. Mangler det, bruges den upersonlige form.

**Det er ikke en attribution, modtageren kan læse.** Koden er én pr. liga, så
modtagersiden ved ikke, hvem der delte linket. Det kræver `B20`.

---

## 6. Målingen

`invite_landed` er trinnet **mellem** `league_invite_sent` og
`league_invite_accepted`. Et nyt navn og ikke en ny `metadata.via`: en `via`
skelner mellem kilder til det samme trin, og "landet" er et andet trin.

Logges i `MainApp`s to deep-link-effekter, hvor **udfaldet** er kendt —
`notfound` er lige så interessant som `confirm`.

```
metadata: { via: "liga" | "join", udfald: "confirm" | "already" | "notfound",
            efter_oprettelse: <bool> }
```

`efter_oprettelse` er den ene ting, afsnit 4 handler om: kom koden fra
`localStorage`, har invitationen overlevet en omvej.

**Vises i Admin → Analytics → Engagement** som "Invitationer": sendt · landet ·
accepteret, side om side, fordi det er forholdet mellem dem, der er
oplysningen. Ingen ny RPC var nødvendig — `admin_analytics_engagement`
aggregerer hændelsesnavne generisk.

⚠️ **De tre tal tæller ikke det samme.** `sent` tæller *delinger*, ikke
modtagere, så `landed` kan overstige `sent`. Og `landed` har en systematisk
blind vinkel: en modtager, der åbner linket og aldrig opretter en konto, **kan
ikke tælles** — `analytics_events.user_id` er `not null default auth.uid()` —
altså netop det frafald, man helst ville se. Forbeholdet står i
`analyticsMetrics.js` under `invite_funnel`.

---

## 7. Udrulning

SQL'en er **rent additiv**, så der er intet vindue, hvor noget er i stykker:

1. Kør `sql/invite_preview.sql` (`#54`) i Supabase, "Run without RLS".
2. Gen-kør `sql/analytics_events.sql` (ny værdi i hændelses-constrainten).
3. Merge → Vercel deployer.

Køres 3 før 1 og 2, fejler kun det nye: previewet udebliver, og `invite_landed`
afvises tavst, fordi logning er fire-and-forget. Ingen bruger mister en
invitation. Rækkefølgen er alligevel den rigtige.

Efter udrulning — det, en maskine ikke kan se (`DOCUMENTATION.md` §11):

- `curl -A "facebookexternalhit/1.1" "$URL/?liga=<kode>"` → ligaens navn i
  `og:title`, og koden må ikke optræde nogen steder i svaret.
- `curl -A "Mozilla/5.0 … Safari" "$URL/?liga=<kode>"` → den almindelige app
  (beviser portvagten).
- Et rigtigt link sendt til sig selv i **iMessage** og **WhatsApp**, plus
  Facebooks Sharing Debugger for det statiske tilfælde.
- Logget ud med `?liga=<kode>` → invitationslinjen; med `?liga=<vrøvl>` → den
  generelle tekst.
- Hele omvejen: åbn linket → opret konto → (med `B26` slået til: følg mailen) →
  land i ligaen.
- `select event_name, count(*) from analytics_events where created_at > now() -
  interval '15 minutes' group by 1;`

Kør skema-eksport-workflowen bagefter, så `sql/schema.sql` kender
`invite_preview()`.

---

## 8. Ikke bygget

| Hvad | Hvorfor ikke |
|---|---|
| QR-kode i invitations-fladen | Kræver enten en afhængighed eller ~200 linjer egen encoder for situationen "vi sidder sammen fysisk", som delearket allerede dækker. Backlog. |
| `B20` — personlige invite-links | Egen leverance; se `DECISIONS.md`. `invite_preview()` skal bagefter kun bære ét felt mere. |
| OG-billede pr. liga | Kræver skriftgengivelse på serveren. Backlog. |
| OG-tags på `site/` | Hjemmesiden er sin egen flade (`I17`). |
| `redirect_to` på signup | Se afsnit 4. |
