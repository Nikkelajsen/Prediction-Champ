# Feature: Privatliv, vilkår og kontolukning v1

**Status: ✅ Leveret (3. august 2026, `B4`).** Kræver migreringen `sql/account_anonymization.sql`. · *Filosofi: `../PRODUCT_BOOK.md` · Prioritering: `../ROADMAP.md`*

Spec'en beskriver **kontrakten**, ikke ordlyden. Selve teksten bor kun ét sted — `src/lib/legal.js` — og en kopi her ville drive fra hinanden inden for en måned.

---

## 1. Formål

Appen lå på en offentlig URL, indsamlede persondata i fjorten tabeller og havde hverken privatlivspolitik, vilkår eller en måde at komme af med sin konto på. `B4` var porten før enhver offentlig deling.

Målestokken er skarp: **en bruger skal kunne læse, hvad vi gemmer, og komme af med det — uden at skrive til nogen.** Kræver det en mail til en udvikler, er retten teoretisk.

## 2. Problemet før

| Sted | Problem |
|---|---|
| `theme.js:58` | `@import` mod Googles fontværter sendte hver besøgendes IP dertil. `globalCss` injiceres allerede i boot- og login-grenen (`App.jsx:203, 213`), så det skete **før** nogen havde oprettet en konto eller kunne acceptere noget. |
| Hele `src/` | Ingen tekst om privatliv, vilkår, cookies eller GDPR. Verificeret ved søgning før ændringen. |
| `Auth.jsx` | Ingen plads til et samtykke, og ingen vej for en ikke-indlogget person til at læse noget som helst. |
| `auth.users` | Ingen slette-funktion. En bruger kunne kun komme af med sin konto ved at bede en udvikler gøre det i Supabase-konsollen. |

## 3. Ufravigelig regel

> **En ny tabel med persondata, en ny tredjepart eller en ny `localStorage`-nøgle skal have en linje i `src/lib/legal.js` i SAMME ombæring.**

En politik, der er forældet, er værre end ingen — den er en påstand, der ikke passer. `legal.test.js` har et emnetjek, der fanger den hyppigste form for forfald (et helt emne, der forsvinder under en omskrivning), men ingen test kan se en tabel, ingen har skrevet om. Samme slags regel som `CRON.md`s.

## 4. Fonten selv-hostes

Ti `woff2`-filer i `public/fonts/`: fem vægte (Barlow 400/600/700, Barlow Condensed 600/700 — talt i `src/`; vægt 500 blev hentet uden at blive brugt) × to subsets (`latin` + `latin-ext`, fordi Champions League har klubber med tegn uden for latin-1). `unicode-range` gør, at en dansk bruger kun henter latin-filerne.

`@font-face` står i `globalCss` og ikke i `index.html`, fordi designtokens kun må findes ét sted — og fordi `ErrorBoundary` injicerer den samme CSS i sin fallback. Til gengæld forvarmes de to skrifter, første maling bruger, af `<link rel="preload">` i `index.html`; ellers ville skriften stadig skifte sent, selv om filerne nu er vores egne.

**Filnavnene er stabile og cachet `immutable`.** Skiftes en fontfil ud, skal navnet skifte med, og både `theme.js` og de to preload-linjer rettes i samme ombæring (`DOCUMENTATION.md` §11).

## 5. Teksterne

Data i `src/lib/legal.js`, tegnet af `LegalDocument.jsx`. **Kontrakten er, at komponenten hverken tager `token` eller callbacks** — det er dét, der gør den brugbar både inde i `AuthShell` (ingen session, ingen `MainApp`) og som skærm. `LegalDocument.test.jsx` fastholder det.

To pladsholdere skal udfyldes før offentliggørelse: `[NAVN]` og `[KONTAKT-E-MAIL]`. En test håndhæver, **hvor** de står — ikke at de er væk. Se tjeklisten nedenfor.

## 6. Kontolukning = anonymisering

Rigtig sletning er i dette skema en fælde, og det er ikke til at se på overfladen:

- `groups.created_by` er `on delete cascade` → brugerens **ligaer** ville forsvinde sammen med alle de andre medlemmers medlemskab.
- `competitions.created_by` har **ingen** `on delete`-regel → sletningen ville blive blokeret for enhver, der har oprettet en konkurrence.

Anonymisering går uden om begge, fordi `profiles`-rækken bliver stående.

| Tabel | Handling |
|---|---|
| `profiles` | pseudonym (`Slettet <8 hex>`), `anonymized_at`, `is_admin = false`, `last_seen_at = null` |
| `push_subscriptions`, `notification_log`, `stories`, `analytics_events`, `user_activity_days` | slettes |
| `feedback.user_id` | → `null` (samme valg som tabellens egen `on delete set null`) |
| `predictions`, `ratings`, `rating_history`, `competition_awards`, `competition_participants`, `group_members` | **bevares** — de er grundlaget for andres stillinger |
| `groups`, `competitions` | røres ikke; overlever fordi `profiles` gør |

**Medlemskaberne kan ikke behandles hver for sig.** `group_membership_invariant.sql` håndhæver, at en konkurrence-deltager altid er ligamedlem — at slette det ene og beholde det andet ville genskabe præcis den forældreløse tilstand, invarianten findes for at forhindre.

`anonymize_my_account()` har **nul parametre**. Det er hele adgangsgarantien: der findes ikke et bruger-id at forfalske. `sql/tests/account_anonymization.sql` efterprøver det mekanisk med et `pg_proc`-opslag.

## 7. Endpointet

`api/delete-account.js`, tre trin i en rækkefølge, der ikke er til forhandling:

1. **Hvem er du** — `GET /auth/v1/user` med kalderens egen token. Id'et kommer herfra og intet andet sted; body læses aldrig.
2. **Anonymisér** — RPC'en kaldes med **brugerens** token, ikke service-nøglen, så funktionens `auth.uid()`-vagt stadig bestemmer.
3. **Luk kontoen** — `DELETE /auth/v1/admin/users/<id>` med `should_soft_delete: true` og service-nøglen. En **hård** sletning ville kaskadere og fjerne præcis det, trin 2 lige har bevaret.

Fejler trin 3 efter trin 2, svares `kode: "kun_anonymiseret"`. Brugeren skal vide, at deres data ER væk, og at kun lukningen mangler; begge trin er idempotente, så et nyt forsøg er ufarligt. Bagstopperen er manuel blød sletning i Supabase → Authentication.

⚠️ **Efterprøv ved første kørsel i produktion, om projektets GoTrue-version også obfuskerer `email` ved blød sletning** (`select email, deleted_at from auth.users where id = …`). Gør den ikke det, skal der indsættes et trin 2½: `PUT /auth/v1/admin/users/<id>` med en uigenkendelig e-mail før lukningen.

## 8. Ændringer pr. fil

| Fil | Ændring |
|---|---|
| `public/fonts/*.woff2` | **Ny.** Ti filer |
| `src/ui/theme.js` | `@import` → ti `@font-face`; `'Inter'` fjernet fra kæden |
| `index.html` | To `preload`-linjer |
| `vercel.json` | `immutable`-cache på `/fonts/(.*)` |
| `src/lib/legal.js` | **Ny.** Begge dokumenter som data |
| `src/screens/LegalDocument.jsx` | **Ny.** Visningen, uden token og callbacks |
| `src/screens/LegalScreen.jsx` | **Ny.** Ramme + dokumentskifter + kortet "Luk min konto" |
| `src/screens/Auth.jsx` | `jura`-tilstand, `AuthShell`s `bred`, `TekstLink`, `JuraLinje` |
| `src/screens/HowItWorksScreen.jsx` | Nyt emne "Privatliv og vilkår" med to knapper. *(Rettet efter levering: skærmen blev samme dag lagt om til fem foldbare emner på `main`, så tilføjelsen er et `Topic` og ikke et kort. Den oprindelige udgave flyttede desuden `Section` til modulniveau og sænkede lint-loftet fra 23 til 14 — omlægningen opnåede det samme, og loftet står stadig på 14.)* |
| `src/screens/MainApp.jsx` | `openLegal` + `screen.type === "legal"` |
| `src/lib/supabase.js` | `clearAllLocalState()` (`LOKALE_NØGLER` bor i dag i `src/lib/localFlags.js` og re-eksporteres herfra) |
| `src/lib/data/account.js` | **Ny.** `deleteMyAccount()` |
| `sql/account_anonymization.sql` | **Ny.** Migrering #31 |
| `api/delete-account.js` | **Ny.** Fjerde serverless-funktion (loftet er 12) |

## 9. Acceptkriterier

- [x] Ingen kald til Googles værter i `dist/` efter et build.
- [x] Begge dokumenter kan læses uden at være logget ind.
- [x] Samtykke-sætningen og aldersgrænsen vises ved oprettelse — og kun der.
- [x] En bruger, der åbner et dokument midt i en oprettelse, kommer tilbage med sine indtastninger i behold.
- [x] Kontolukningen kan ikke udføres for en anden bruger — mekanisk, ikke ved en vagt.
- [x] Efter lukning: brugssporet er væk, spillet står uændret, og ligaen findes med alle sine medlemmer.
- [x] Politikken siger, hvad anonymiseringen **ikke** når.
- [ ] `[NAVN]` og `[KONTAKT-E-MAIL]` er udfyldt. **Kan først krydses af af ejeren.**

## 10. Før teksten regnes som offentliggjort

1. Udfyld `[NAVN]` og `[KONTAKT-E-MAIL]` i `src/lib/legal.js`.
2. Kør `sql/account_anonymization.sql` i Supabase ("Run without RLS").
3. Efterprøv den bløde sletnings e-mail-adfærd (§7).
4. Kør de tre `B4`-punkter i "Tjekliste før merge" (`DOCUMENTATION.md` §11).

## 11. Bevidst ikke med i v1

Rigtig sletning (kræver oprydning i fremmednøgler og en beslutning om ligaers skæbne) · cookie-banner (der er ingen cookies) · afkrydsningsboks ved samtykke (implicit accept er standarden for en tjeneste uden markedsføring eller profilering) · databehandleraftaler med Supabase og Vercel (relevant først ved en forretning) · engelsk oversættelse · en offentlig, delbar URL til teksterne (kræver en router, `A23`) · `Content-Security-Policy: font-src 'self'` som hærdning oven på selv-hostningen.
