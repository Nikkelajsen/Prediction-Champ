# Onboarding v1 — de første to minutter

**Status: ✅ Leveret (juli 2026).** Ingen SQL-migrering.

---

## 1. Formål

En ny bruger skal selv kunne: oprette en konto · oprette eller deltage i en liga · oprette eller deltage i en konkurrence · afgive et tip · og undervejs forstå forskellen på liga og konkurrence, hvad rating er, hvad Championship er, og at de har en karriere, de kan se — **uden at spørge nogen om hjælp**.

Målestokken er skarp: spørger én ud af fem *"hvordan gør jeg?"*, er onboardingen ikke god nok.

Det følger direkte af produktbogen:

> *"En ny bruger skal derfor hurtigst muligt oprette eller tilslutte sig en liga. Uden et fællesskab mangler produktet sin vigtigste værdi."* — kap. 1
>
> *"Den bedste software er ikke den, der viser mest. Det er den, der får det svære til at føles enkelt."* — kap. 4

## 2. Problemet før

Den **inviterede** bruger blev faktisk onboardet fint: `?join=` → bekræftelsesmodal → direkte til Tip-skærmen. Det var **selvstarteren**, der faldt igennem:

`signup → PWA-installationsmodal → Hjem → én dashed sætning → Ligaer-fanen → skriv liganavn → liga-siden → "Opret konkurrence" → formular med ti valg → stilling`

Konkrete blindgyder, alle verificeret i koden før ændringen:

| Sted | Problem |
|---|---|
| `PredictionsScreen` tom-tilstand | *"Opret eller deltag i en konkurrence først."* — en sætning uden en eneste knap |
| `BoardScreen` tom-tilstand | Samme sætning, samme blindgyde |
| `LigaerTab` "Ny"-knap | Lå inde i `{loose.length > 0 && …}`, så en bruger uden liga-løse konkurrencer havde **ingen** vej til at oprette en |
| `HjemTab`, `PredictionsScreen` | Nul `InfoDot`s — appens to mest brugte skærme forklarede intet |
| PWA-modalen | Var det **allerførste**, en ny bruger mødte: installér en app, du endnu ikke ved hvad er |
| `HowItWorksScreen` | God tekst, men ingen blev sendt derhen — og **Karriere** manglede helt |
| `CreateCompetitionScreen` | Navn + liga + 5 modes + turnerings-chips + stage-chips + rullende vindue på én gang |
| `RatingTab`, `ChampionshipTab` | En ny bruger så ranglister, de ikke selv stod på, uden at få at vide hvorfor |

## 3. Tre lag

Ét lag rammer kun én brugertype. Der er tre:

1. **Guidet flow** (`src/screens/OnboardingFlow.jsx`) — for den, der lige er kommet ind. Kan springes over hele vejen.
2. **"Kom godt i gang"-kort** (`src/screens/GetStartedCard.jsx`) — for den, der sprang over eller blev afbrudt. Ikke-blokerende, forsvinder af sig selv.
3. **Kontekstuel hjælp** — ⓘ og rigtige tom-tilstande dér, hvor man går i stå, uanset hvordan man kom dertil.

## 4. Brugerflow

| Sti | Adfærd |
|---|---|
| **Kold selvstarter** | Guiden åbner: ordbog + pointregel → "er du inviteret?" → opret liga + konkurrence i ét tryk → lander på Tip med runden åben |
| **Inviteret via link** (`?liga=` / `?join=`) | Guiden åbner **aldrig**. Den eksisterende bekræftelsesmodal overtager — en invitation er en bedre onboarding end nogen guide |
| **Inviteret via indsat kode** | Guidens trin 1 tager hele linket eller den rå kode. Samme landing som deep-link-vejen |
| **Ugyldig invitationskode** | `joinError` vises; når banneret lukkes, åbner guiden — brugeren *er* reelt en kold selvstarter |
| **Liga uden konkurrence** | Guiden åbner ikke (`hasGroup`); checklisten peger på næste trin |
| **Sprunget over** | `pc_onboarding_v1_flow = "skipped"`; checklisten tager over |

## 5. Onboarding-tilstand: udledt, ingen SQL

Tilstanden **udledes af rigtige data** (`src/lib/onboarding.js`, `deriveOnboarding`) frem for at bo i en kolonne:

- migreringer køres i hånden i Supabase (`sql/README.md`), så en ny kolonne koster et manuelt trin i produktion;
- udledt tilstand kan ikke drive fra virkeligheden — melder en bruger sig ud af sin sidste liga, siger checklisten det af sig selv.

`localStorage` bruges kun til det, der ikke kan udledes: `pc_onboarding_v1_flow` (sprunget over) · `pc_onboarding_v1_card` (kortet skjult) · `pc_onboarding_v1_complete` (færdig — proben springes helt over ved næste opstart, så en etableret bruger ikke betaler ekstra netværkskald).

To RLS-forudsætninger, verificeret før implementering:

- **`predictions`-SELECT-policyen er `user_id = auth.uid() or (…locked…)`** — en bruger kan altid læse sine egne tips, også ulåste. `hasPrediction`-proben (`limit=1`) er derfor sikker.
- **A8-triggeren indsætter med `on conflict (group_id, user_id) do nothing`** (`sql/group_membership_invariant.sql`) — opretterens `admin`-række overlever deltager-insertet. Rækkefølgen `createGroup` → deltager-insert er dermed bindende; omvendt ville triggeren nå at lave en `member`-række først.

Trinnene: `liga` · `konkurrence` · `tip` · `invitér`. Notifikationer og PWA-installation er **ekstra** rækker på kortet og tæller ikke med i "X af Y" — ellers ville tælleren hoppe mellem enheder.

**Hvorfor "Invitér en ven" er et krav og ikke pynt:** produktets North Star er sunde, aktive ligaer (produktbogen kap. 3), og en liga med ét medlem er en død liga. Et tip afgivet alene er ikke en gennemført onboarding.

## 6. Ufravigelig regel: aldrig en liga-løs konkurrence

`competitions.group_id` er nullable, og `""` var defaulten i opret-skærmen. En liga-løs konkurrence er ikke i stykker — `?join=` virker, vennen kan tippe — men det er **overgangstilstanden**, hele liga-laget handlede om at komme væk fra: ingen liga-side, ingen medlemsliste, intet permanent invite-link, A8-triggeren gør intet, og når sæsonen slutter, består intet.

Derfor:

- guiden opretter liga **og** konkurrence i én handling (`createStarterLeague`);
- opret-skærmens hurtig-sti viser liga-feltet **altid** og defaulter til brugerens første liga.

Kontrol efter udrulning: `select count(*) from competitions where group_id is null and created_at > <udrulning>` skal være **0**.

## 7. Frontend-ændringer pr. fil

| Fil | Ændring |
|---|---|
| `src/lib/onboarding.js` | **Ny.** `deriveOnboarding` (ren) · `loadOnboardingSignals` · `loadHasPrediction` · `loadStarterTournaments` · `createStarterLeague` · `defaultLeagueName` · `validateGroupName` · localStorage-nøgler |
| `src/lib/data.js` | `createCompetition` og `joinByInviteCode` udtrukket fra skærmene (se §8) |
| `src/lib/scoring.js` | `MODE_HINTS` ved siden af `MODE_LABELS` |
| `src/screens/OnboardingFlow.jsx` | **Ny.** Fuldskærms-overlay, tre trin |
| `src/screens/GetStartedCard.jsx` | **Ny.** Checklisten |
| `src/ui/usePushOptIn.js` | **Ny.** Én definition af "skal vi spørge om push" |
| `src/ui/components.jsx` | **Ny** `EmptyCompetitions`, delt af Tip og stillingen |
| `src/screens/MainApp.jsx` | Onboarding-tilstand, flow-gate, PWA-gate, prop-føring |
| `src/screens/HjemTab.jsx` | Checklisten erstatter de to dashed tom-tilstande; eget `loadMyGroups` flyttet op; ⓘ ved rating og placeringer |
| `src/screens/CreateCompetitionScreen.jsx` | "Flere valg"-udfolder; liga defaulter til første liga; navn forudfyldes |
| `src/screens/LigaerTab.jsx` | "Ny konkurrence"-knappen flyttet ud af "Øvrige"-blokken |
| `src/screens/PredictionsScreen.jsx` | ⓘ ved runden; `EmptyCompetitions` |
| `src/screens/BoardScreen.jsx` | `EmptyCompetitions` |
| `src/screens/RatingTab.jsx` | "Hvorfor står jeg her ikke?" |
| `src/screens/ChampionshipTab.jsx` | Championship vs. konkurrence i ⓘ'en |
| `src/screens/ProfileScreen.jsx` | ⓘ ved karrieren |
| `src/screens/HowItWorksScreen.jsx` | **Karriere**-sektion tilføjet; ordbogen får en samlende linje; Championship-sektionen omdøbt og udvidet |
| `src/screens/Auth.jsx` | Én linje om hvad appen er, før der bedes om e-mail |

## 8. Udtrukket logik

Guiden fik brug for de samme to skrivninger, som lå inline i skærmene. To kopier af den samme skrivning er præcis, hvad A7 kostede, da kun den ene huskede liga-medlemskabet — så logikken flyttede, **før** der kom et kaldested mere.

- **`createCompetition(token, userId, spec)`** — flyttet ordret fra `CreateCompetitionScreen`. Returnerer nu `matchCount`, så en kalder kan se, at en konkurrence blev tom. Den tilfældige udvælgelse blev i skærmen (den læser UI-state).
- **`joinByInviteCode(token, userId, code)`** — flyttet fra `LigaerTab`. To rettelser undervejs: accepterer et **helt indsat link**, og er **idempotent** (`LigaerTab` tjekkede ikke eksisterende deltagelse, så gen-indsættelse kastede en rå PK-konflikt ud; deep-link-vejen tjekkede). For en eksisterende deltager forsøges liga-medlemskabet stadig — det er A8-halvtilstanden.

## 9. Kanttilfælde

| Tilfælde | Adfærd |
|---|---|
| **Sæsonen er spillet færdig** | `filterFromNextUnfinishedRound` giver `[]`. `loadStarterTournaments` markerer turneringen `hasUpcoming: false`; knappen skifter fra "Opret og tip" til "Opret liga" og siger hvorfor |
| **Ingen turnering med kampprogram** | Ligaen oprettes alene. Fællesskabet er det, der består |
| **Oprettet midt i en runde** | Første tipbare runde er næste uge. Landing forgrenes på `matchCount`, ikke på et løfte |
| **Liga oprettet, konkurrence fejlede** | Rulles **ikke** tilbage — en tom liga er brugbar og kan slettes af sin admin. Brugeren sendes til liga-siden med besked |
| **`profile` er `null`** (`App.jsx:28-31`) | `defaultLeagueName` falder tilbage til `"Min liga"`; guiden hilser "Hej der" — aldrig `"undefineds liga"` |
| **`localStorage` utilgængelig** | `readFlag`/`writeFlag` fejler stille; onboarding må aldrig blokere appen |

**Turneringen findes via data**, ikke via navn: `loadStarterTournaments` vælger nyeste sæson med kampe uden resultat. Regexet `/superliga/i` i `ChampionshipTab.jsx:147-151` er bevidst **ikke** kopieret ind — det hører til `turnering-2`.

## 10. Bevidst ikke med i v1

Server-side onboarding-tabel · A/B-test · video · tour-overlays oven på den rigtige brugerflade · fremdriftsbjælke · e-mail-drip.

## 11. Acceptkriterier

- [x] En kold selvstarter kan gå fra konto til første tip uden at forlade guiden.
- [x] En inviteret bruger ser **aldrig** selvstarter-flowet — hverken via link eller indsat kode.
- [x] Onboarding opretter **aldrig** en liga-løs konkurrence.
- [x] Checklisten forsvinder af sig selv, når alle fire trin er klaret.
- [x] En etableret bruger ser hverken guide eller checkliste og betaler ingen ekstra netværkskald.
- [x] Guiden lover aldrig et tip, der ikke findes.
- [x] Alle seks begreber forklares i appen: liga, konkurrence, turnering, rating, Championship, karriere.

## 12. Test

`src/lib/onboarding.test.js` (16) · `src/screens/GetStartedCard.test.jsx` (6) · `src/screens/OnboardingFlow.test.jsx` (4) · nye cases i `src/lib/data.test.js` (13) og `src/ui/components.test.jsx` (2).

Repoet har **hverken jsdom eller testing-library** — komponenter testes med `renderToStaticMarkup`, så klik kan ikke simuleres. Derfor bor flowets logik i `src/lib/onboarding.js`, hvor den *er* testbar; komponenten er en tynd renderer. De øvrige trin gennemgås manuelt før merge (`DOCUMENTATION.md` afsnit 11).

## 13. Afvigelser fra udkastet

Markeret her frem for slettet, jf. `CLAUDE.md`:

- **Checklistens `liga`-knap genåbner ikke guiden.** Udkastet foreslog det. Men en bruger med liga-løse konkurrencer har `liga.done === false`, og guidens trin 2 ville da oprette en *ny* konkurrence oveni. Knappen går i stedet til Ligaer-fanen, hvor både "Opret en liga" og "Deltag med kode" står øverst.
- **`HowItWorksScreen` blev ikke omstruktureret.** Udkastet antog, at ordbogen skulle flyttes op — den var allerede sektion 1. Kun **Karriere** manglede reelt.
