# Backlog — det ubyggede

Alt, der er identificeret men ikke leveret: åbne beslutninger, ubyggede
opgaver, teknisk gæld og rå ideer. Ét sted at kigge, når man vil vide, hvad der
mangler.

Oprettet 31. juli 2026. Det ubyggede lå indtil da spredt over syv steder —
ROADMAP'ens åbne beslutninger, dens prioriterede rækkefølge (hvor 6 af 7 rækker
var leverede), `DOCUMENTATION.md` §12, to feature-specs og "Bevidst ikke med i
v1" i alle syv — og rå ideer havde slet intet hjem. Spredningen drev allerede:
§12 beskrev stadig en fil-opdeling, der var leveret, og pegede på en beslutning,
der var lukket. Samme udskillelse som `CHANGELOG.md` og `DECISIONS.md` fik den
30. juli, bare den anden vej: de er de sektioner, der kun vokser bagud, og denne
er den ene, der kun peger fremad.

**Leveret hører ikke til her.** Når et punkt lukkes, **slettes rækken** —
arkivet findes allerede: beslutninger i [`DECISIONS.md`](./DECISIONS.md),
leverancer i [`CHANGELOG.md`](./CHANGELOG.md), status i
[`ROADMAP.md`](./ROADMAP.md). Netop derfor må der slettes: listen skal kunne
skimmes på et halvt minut, og intet går tabt. Undtagelsen er forkastede ideer,
som ikke arkiveres andre steder — de får en linje nederst, så den samme idé ikke
foreslås tre gange.

**ID'erne er stabile og genbruges ikke.** `A#` fortsætter beslutningsserien fra
ROADMAP (næste ledige: **A25**) — `A11` er fx også navnet på en logadvarsel i
`api/_shared.js`. `B#` ubygget · `G#` teknisk gæld · `I#` ideer. Spec-lokale
ID'er (`K2`, `F1`) beholder deres eget navn og linker til spec'en.

---

## 📥 Indbakke

Skriv én linje. Intet ID, ingen begrundelse, ingen formatering — det er hele
pointen. Ryddes ved næste session: hvert punkt får et ID og en række nedenfor,
eller en linje i "Forkastede ideer".

- `Content-Security-Policy: font-src 'self'` ville gøre "vi fjernede kaldet til Google" til "browseren nægter kaldet" — én direktiv, ingen anden virkning; udskudt fra `B4` frem for bygget halvt
- Antallet af lukkede konti kan tælles på `profiles.anonymized_at`, men der findes ingen visning; en ny analytics-hændelse ville kræve at udvide kataloget i `sql/analytics_events.sql` OG logge om en person, der netop har bedt om at forsvinde
- En lukket konto bliver stående som deltager i konkurrencer, der endnu ikke er begyndt — dér ville en framelding hverken omskrive historik eller bryde `group_membership_invariant`, men `B4` valgte den simple regel: alt bevares
- `api/_backfill.js` regel 3 måler rundens start som tidligste `kickoff_at` minus en time og kender ikke `kickoff_tbd` — en TBD-kamps midnat-pladsholder regnes derfor som rundestart to timer efter klientens lås for samme kamp; ubetydeligt i dag (reglen måler i dage, afvigelsen er timer), men det er det sidste sted, låsen ikke går gennem den fælles regel
- `api/sync-matches.test.js` dækker kun rene hjælpefunktioner, så der er ingen test på, at `kickoff_tbd` faktisk kommer med i upserten — handleren kan ikke nås uden et HTTP-mock-apparat, filen ikke har
- De fire filer i `sql/README.md`, der ruller tavst tilbage, opdages stadig kun ved at nogen kigger — `job-heartbeat.yml` har allerede databaseadgangen og kunne tjekke, at virkningen står i databasen (scope-kolonnen, `security_invoker`, at de fem policies kalder `match_locked()`, A8-policyerne)
- fold-mønstret er nu håndrullet fem steder (`HjemTab`, `LigaerTab`, `MatchRow`, `LigaDiagnoseSection`, `HowItWorksScreen`) med hver sin blanding af `div role="button"` og rigtig `<button>` — en delt `Collapsible` i `ui/components.jsx` ville samle tastaturadgang, chevron-rotation og aria ét sted
- `ambiguousTeams` er permanent tændt for Scotland (Dundee ligger inde i Dundee United, og begge klubber bliver i Premiership), så feltets egenskab — "kun til stede, når der ER noget at kigge på" — holder ikke længere dér; enten en liste over godkendte par eller en accept af, at netop dette felt skal læses med et kendt par i baghovedet
- `B2`s testcase 3 (en `full_season`-konkurrence med begge turneringer) er godkendt 2. august 2026, og dét er præcis den kodesti, `G8` kalder uafprøvet mod rigtige data — blev konkurrencen oprettet i produktion, er `G8`s præmis ("nul rækker i `mode_params.tournaments`") ikke længere sand, og rækken skal enten skrumpe eller slettes; ét opslag afgør det

*Ryddet 2. august 2026: `...font`-linjen blev rettet med det samme frem for at få et ID. `...font` satte CSS-egenskaben `display` til et skriftnavn i to `<pre>` i `OpsPanel.jsx`; spredningen er fjernet frem for erstattet, fordi en `<pre>` er monospace i forvejen, og det er dét, en rå fejltekst og et JSON-resumé skal have. Visningen er derfor uændret — kun løftet om at gøre noget er væk.*

*Ryddet 1. august 2026 (fjerde runde): feedback-knappen blev `B14` og ikke en
idé — den er en direkte anmodning fra produktejeren, altså besluttet, og det
eneste åbne er, hvor beskeden lander. Holdnavne-normaliseringen blev `G52`.*

*Ryddet 1. august 2026 (tredje runde): de tre driftslinjer er lukket sammen med
Tier 1. `finishedRoundKeys()` og Champions League-dubletterne blev til kode
(`api/send-notifications.js` og `ambiguousTeamNames()` i `api/sync-matches.js`);
linjen om `ensureCompetitionAwards` **viste sig at være forkert** —
funktionen har sin egen `try/catch` om hele kroppen (`src/lib/data/awards.js:12-18`)
og kan derfor ikke afvise. Ingen ændring, ingen række.*

*Ryddet 1. august 2026 (anden runde): de tre linjer om grants/RLS og
paginering blev `G50` og `G51`; testtallene blev foldet ind i `G21`, som
allerede bar dokumentationsdriften.*

*Ryddet 1. august 2026: 35 linjer blev til `A23`, `B12`–`B13` og
`G23`–`G49`. Tre af dem fik ikke eget ID, men blev foldet ind i den række, de
hørte til (`rules.openDaysBefore` → `G3`, dev mod produktionsdata → `G4`,
Google-fonten → `B4`), og to par blev slået sammen, fordi de deler rettelse
(ubrugte exports + forældede modulhoveder → `G36`, fejltelemetri +
versionsstempel → `G42`).*

---

## Åbne beslutninger

Spørgsmål, der er identificeret, men bevidst ikke afgjort endnu. Når en
beslutning træffes, flyttes den til [`DECISIONS.md`](./DECISIONS.md) med dato og
begrundelse, og rækken her slettes. `Afgøres` er en **udløser**, ikke en dato.

| # | Spørgsmål | Kontekst | Afgøres |
|---|---|---|---|
| A5 | **Emojis i historie-kort: til eller fra?** | Gør kortet skimbart på mobil, men mindre klassisk. **v1-default: emojis til.** **Delvist besvaret (v1.1, juli 2026):** emoji er nu et *signal* — den findes kun i højdepunkt-tieret, mens dæmpede kort er uden. Spørgsmålet er dermed reduceret til, om højdepunkterne skal beholde deres. **Datamanglen er lukket (30. juli 2026):** Analytics-fanens sektion "Story Engine-regler" viser genereret/vist/delt/afvist pr. regel, så spørgsmålet kan afgøres på tal frem for fornemmelse. **Sidste forudsætning er væk (31. juli 2026):** `story_engine.sql` er gen-kørt i produktion (den tidligere `B3`), så v1.1's 14 regler genererer nu rigtige kort. Uret på "et par runder" starter her. | Når et par runder er kørt med den nye regelstatistik i hånden. |
| A11 | **`?secret=`-fallbacken fjernes helt** (hænger sammen med teknisk gæld) | Kan først lukkes, når alle cron-jobs (ét sync-job pr. turnering + notifikations-jobbet) er bekræftet flyttet til `x-sync-secret`-headeren — ellers fejler de med 401. **Aflæsningen er nu ét SQL-opslag (august 2026):** hver kørsel skriver `authVia` (`header`/`query`/`admin-token`) i `job_runs.detail`, så spørgsmålet besvares med 30 dages historik i appens egne data. `isAuthorized()` har altid vidst det — værdien blev bare kasseret, så det eneste spor var en advarsel i Vercels logs, hvor **fravær af advarsler ikke kunne skelnes fra fravær af kørsler**. Opslaget og aflæsningstabellen står i [`CRON.md`](./CRON.md). | Når opslaget viser `header` for alle jobs i en periode, der dækker alle skemaer (det langsomste er `sync-matches` hver 12. time). Derefter fjernes fallbacken fra `api/_shared.js`. |
| A14 | **Skal hele kodebasen gennemformateres med Prettier?** | `npm run format` findes, men `format:check` er bevidst ikke et CI-trin. En fuld gennemformatering ville omskrive ~6.700 linjer ved `printWidth: 140` (~14.000 ved standard 80) på tværs af alle 46 filer. Prisen er hele repoets `git blame`; gevinsten er konsistens i en kodebase med én forfatter og en i forvejen ensartet håndstil. Beslutningen er **udskudt, ikke truffet** — se [`DECISIONS.md`](./DECISIONS.md), 30. juli 2026. | Næste gang der alligevel røres bredt i frontenden — ellers aldrig. |
| A23 | **Skal appen have en router?** | Navigation er i dag to `useState` i `MainApp.jsx` (`tab` + `screen`), og deep links læses ved boot og strippes straks via `history.replaceState` (`App.jsx:104`, `MainApp.jsx:215,239`). Følgen er ingen tilbage-knap, ingen browser-historik og ingen delbare URL'er til interne skærme — mærkbart for en PWA, hvor telefonens tilbage-gestus forventes at virke. Men det er et arkitekturvalg, ikke en fejl: afhængighedsfattigheden er bevidst (fire runtime-deps, ingen router, `docs/reviews/2026-08-app-review.md` §7), og en router omskriver hele navigations-tilstandsmaskinen inkl. begge deep-link-join-flows, som ingen test dækker. | Når tilbage-knappen enten koster brugere (kan aflæses i analytics) eller en feature kræver ægte delbare interne URL'er — `I12`s offentlige ligaside er den første, der ville. |

## Ubygget

| # | Hvad | Hvorfor / hvad den venter på | Omfang |
|---|---|---|---|
| B9 | **Notifikation når en ny turnering bliver tilgængelig** | Samme skuffe som "ny konkurrence i din liga" (`B5`, leveret august 2026) — men trigger er en ny turnering, og modtageren er *alle* frem for en liga, så der er ingen medlemsliste at afgrænse med. Mønsteret at kopiere er `newCompetitionMessages()` i `api/send-notifications.js` (§16): et tidsvindue som udløser, en ren funktion med modtager-reglen, `notification_log`-nøgle med eget præfiks. | Lille–mellem |
| B10 | **Story-kort for lokale kåringer** ("Du blev Ugens bedste i X") | Bygger på `competition_awards` (A22): `stats`-jsonb'en har allerede exact/outcome/matches/goal_error, og RPC'en kan kaldes som `service_role`. Kræver en ny regel i `story_engine.sql`. **Forbeholdet om `G9`/`G10` er faldet (august 2026):** `send-notifications`' rundedetektion er nu `finishedRoundKeys()` afgrænset til de officielle turneringers sæsoner og kan genbruges — bemærk dog, at den dermed er scopet som Championship, mens en lokal kåring er scopet til én konkurrence. Navnereglen gælder: kortet siger "Ugens bedste", aldrig "rundevinder". | Lille–mellem |
| B11 | **Push-notifikation ved lokal kåring** | Samme fundament som `B10` — kåringsrækken findes allerede, når notifikationen skal sendes, så jobbet er kun at opdage nye rækker (fx `awarded_at > sidste kørsel`) og bruge mønsteret i §16. Samme bemærkning som `B10` om, at rundedetektionen er Championship-scopet. | Lille–mellem |
| B12 | **Mål, om "Anbefalet" på Sæson-kortet flytter fordelingen** | Mærket blev sat på i `A22` netop for at flytte, hvilken mode nye brugere vælger, men effekten er aldrig aflæst — og et anbefalings-mærke, der ikke virker, er værre end ingen, fordi det bruger den plads, der skulle guide. `competition_created` bærer allerede `metadata.mode`, så før/efter kan opgøres uden ny instrumentering. Samme opslag svarer på `I15`s åbne spørgsmål om, hvorvidt Ugens kupon-kortet bruges. **Forespørgslen er skrevet (august 2026)** — den står klar til at køre i [`features/analytics-v1.md`](./features/analytics-v1.md) §5F sammen med de tre forbehold, svaret skal læses med (lille datamængde, lossy hændelseslog, og at kort-rækkefølgen blev vendt samme dag som mærkatet kom på). Tilbage står at køre den. | Lille (opslag) |

## Teknisk gæld

| # | Gæld | Hvorfor den betyder noget | Omfang |
|---|---|---|---|
| G1 | **De resterende store skærmfiler** — `MainApp.jsx` ~480 linjer, `HjemTab.jsx` ~450, `CreateCompetitionScreen.jsx` ~356, `AdminScreen.jsx` ~310. **De største utestede skærme er nu `ProfileScreen.jsx` (584) og `ChampionshipTab.jsx` (515)** (gennemgang aug. 2026) — de bør med i splitrækkefølgen. | Anden halvdel af fil-opdelingen fra 30. juli 2026 (`data.js`, `PredictionsScreen.jsx` og `AnalyticsPanel.jsx` er delt). Mønstret er bevist: barrel eller ren flytning bag uændret flade, så et grønt build er beviset for, at ingen eksport er tabt. Gevinsten er ikke kosmetisk — tip-skærmens tids-logik kunne ikke testes, før den blev flyttet ud, og har nu 18 tests. | Mellem |
| G2 | **14 ESLint-advarsler fra React Compiler** (`set-state-in-effect`, `static-components`, `immutability`). | Står som advarsel frem for fejl, fordi hvert fund kræver en gennemtænkt omskrivning, ikke en rettelse. Loftet i `package.json` (`--max-warnings 14`) gør, at tallet kan falde, men aldrig vokse ubemærket — gælden er synlig i stedet for tavs. **Falder tallet, sænkes loftet i samme ombæring.** **Faldt fra 23 til 14 (3. august 2026, som sidegevinst ved `B4`):** `Section` i `HowItWorksScreen` var defineret inde i komponenten og udløste én advarsel pr. brugssted — ti stykker. Den slags er det billigste, der er tilbage på listen: se efter komponenter defineret inde i andre komponenter, før du kaster dig over effekterne. | Mellem |
| G3 | **Frontenden læser stadig `rules`-feltet.** | `rules` er historisk: `pc_points()` hardkoder 3/1 og ignorerer det, og alle opgørelser er altid 3-1-0 (F2, juli 2026). Læsningen er død kode, der antyder en konfigurerbarhed, som ikke findes. Noteret som "separat oprydning" i [`features/karriereprofil-v1.md`](./features/karriereprofil-v1.md) §7 og aldrig planlagt siden. **Samme oprydning:** `rules.openDaysBefore` ligger stadig i gamle `competitions`-rækker, men læses ikke længere af nogen (`B1` fjernede læsningen) — data, der ser ud som konfiguration, men ikke er det. | Lille |
| G4 | **Preview, lokal udvikling og produktion deler database**, medmindre staging-variablerne er sat (`DOCUMENTATION.md` §9). | Selve staging-projektet skal oprettes manuelt i Supabase; indtil det sker, kan en preview-deploy skrive i produktionsdata. Vilkåret er dokumenteret, men det er en risiko, ikke en beslutning. **Skærpelse (aug. 2026):** fallbacken i `supabase.js:7-8` er produktions-URL'en, så `npm run dev` uden `.env.local` også udvikler direkte mod produktionsdata — uden at sige det. Der findes desuden ingen seed-SQL til en tom database, så en tom staging er i dag ikke et brugbart alternativ. De tre skrive-/læsehuller, der gjorde ethvert preview-miljø til en fuldgyldig angrebsflade mod produktion, er lukket (`G14`–`G16`, august 2026) — men det ændrer kun, hvor slemt et uheld er, ikke at miljøerne deler database. | Lille |
| G5 | **`sql/rating_core.sql`s hoved advarer mod noget, filen ikke gør.** Kommentaren siger, at funktionskroppene indeholder CRLF og "MED VILJE" ikke må normaliseres (linje 26-30) — filen har i dag nul CR-tegn. | Enten er advarslen forældet (kroppene blev normaliseret ubemærket, uden at kommentaren blev rettet), eller også ligger CRLF kun i `prosrc` i selve databasen og forsvinder ved eksport/checkout — i så fald er advarslen korrekt for produktion, men vildledende for enhver, der læser filen i repoet. Skal afklares mod en frisk `sql/schema.sql`-eksport, før nogen stoler på hverken advarslen eller fraværet af den. **Samme eksport afgør `G21`s sidste punkt (august 2026):** hvor frisk `schema.sql` er, står med tre forskellige datoer rundtom, og det kan ikke rettes fra repoet — kun ved at køre eksporten og lade filens eget datostempel være svaret. | Lille |
| G7 | **Præfikset `fd:` er stadig det eneste, der holder de to leverandørers id-rum fra hinanden** — databasen gør det ikke. | **Halveret 2. august 2026:** `sql/api_id_uniqueness.sql` gav `leagues (provider, api_league_id)`, `seasons (league_id, api_season_id)` og `teams (league_id, api_team_id)`, så to samtidige sync-kørsler ikke længere kan skrive den samme række to gange. **Men rækken kunne ikke lukkes som skrevet:** de tre unikke var formuleret globalt pr. kolonne, og to af de tre ville have fejlet på produktionsdata (Arsenal findes i både Premier League og Champions League med samme `fd:57`; alle fem football-data-turneringer deler sæson-id'et `2026`). **Tilbage står den oprindelige begrundelse:** glemmer syncen præfikset på et hold, skriver den `57` inde i sin egen turnering, hvor ingen constraint kan se det. Den fejl er til gengæld selvhelende (næste kørsel finder rækken på navn og PATCHer id'et på plads), og på kampe var hullet lukket i forvejen af `matches_api_fixture_id_unique`. Det, der ville lukke resten, er en kontrol af id'ets FORM mod ligaens `provider` — og den kræver en trigger eller en kopi af provider-kolonnen ned på `teams`, fordi en check-constraint ikke kan læse en anden tabel. Spørgsmålet er derfor blevet et **valg**: er en permanent trigger prisen værd for en fejl, der retter sig selv? | Lille |
| G8 | **Multi-turnerings-`full_season` er uafprøvet mod rigtige data.** `mode_params.tournaments` har aldrig været skrevet i produktion (nul rækker, 31. juli 2026), så stien er kun dækket af unit-tests — både ved oprettelsen (`createCompetition` i `src/lib/data/competitions.js`) og i `coversSeason` i `api/backfill.js`. | Ufarlig indtil den første multi-turneringskonkurrence oprettes; dét er tidspunktet at kigge efter. **`A16` (1. august 2026) skærper den lidt:** gennemgangen viste, at `random` og `custom` allerede i dag leverer det tvær-turnerings-scenarie, feltet skulle have leveret — så den *adfærd*, man ville teste, findes i produktion, mens netop denne kodesti stadig ikke gør. Fejler den, fejler den derfor tavst i et hjørne, ingen har haft brug for endnu. **`A22` (1. august 2026) udvider skriversiden:** Favorithold med flere hold skriver nu OGSÅ `mode_params.tournaments` (plus `team_ids`), så den første rigtige multi-konkurrence kan lige så vel blive en hold-konkurrence — uanset hvilken, efterses den i Admin → Drift, når den kommer. | Lille |
| G11 | **`round_key()` er markeret `IMMUTABLE`, men er reelt `STABLE`** (`sql/rating_core.sql:125`). | `ts::date` på en `timestamptz` afhænger af sessionens `TimeZone`. Værdierne fryses ved insert i den genererede kolonne `matches.round_key`, så en writer med afvigende TZ ville skrive en anden runde end resten — og under UTC ligger rundegrænsen mandag 00:00 UTC, hvilket rammer kickoff mellem 00:00 og 02:00 dansk tirsdag. Rettelsen er ikke bare at ændre volatiliteten: en genereret kolonne *kræver* `IMMUTABLE`, så funktionen skal gøres ægte tidszone-uafhængig (fx `(ts at time zone 'Europe/Copenhagen')::date`), og et skift i grænsen flytter historiske `round_key`-værdier og kræver genberegning. | Mellem |
| G13 | **`predictions.updated_at` opdateres aldrig ved rettelse.** Ingen trigger på tabellen, og klienten sender ikke feltet (`PredictionsScreen.jsx:181` upserter kun `pred_home`/`pred_away`). | Verificeret mod PostgreSQL 16.13: `on conflict do update` uden feltet i `set` lader det stå. To følger: der findes intet revisionsspor for et rettet gæt, og Analytics' "Aktive konkurrencer" (og "Aktive ligaer") beskriver sig selv som "mindst ét tip **opdateret** i vinduet", mens `p.updated_at` i praksis måler *oprettede* tips. **Halveret (august 2026):** måle-ordbogen siger nu det, tallet faktisk gør — "afgivet", ikke "opdateret" — med forbeholdet skrevet ind. Det ændrer ingen tal. **Tilbage står triggeren**, som ville give et revisionsspor for rettede gæt og ændre, hvad de to Analytics-tal måler; dét er en beslutning om, hvad man vil vide, ikke en oprydning. | Lille–mellem |
| G32 | **Klientens tider og dagsgrupperinger følger enhedens tidszone** (`predictions/time.js`, `scoring.js:155-156`). | `round_key` beregnes i databasen, mens visningen beregnes i browseren — en bruger i en anden tidszone kan derfor se en kamp ligge på en anden dag end den runde, den faktisk tælles i. Adskilt fra `G11`, som er serversidens halvdel af samme uenighed; en rettelse af den ene uden den anden flytter blot problemet. **Udvidet august 2026:** låsen for en kamp uden fastlagt tid (`kickoff_tbd`) er "midnat på spilledagen", og de to sider er uenige om hvis midnat — klienten bruger enhedens (`lockAtOf`), serveren `Europe/Copenhagen` (`public.match_lock_at()`). Identisk for en dansk bruger, ikke for en rejsende. Vælges én zone for hele appen, er det denne uenighed, der forsvinder først. | Lille–mellem |
| G42 | **Et crash hos en bruger efterlader nul spor.** Ingen fejltelemetri og ingen source maps i frontenden, og commit-SHA'en stemples hverken i build eller `job_runs`. | Backenden har `job_runs`; frontenden har intet tilsvarende, så en hvid skærm hos en bruger kan hverken ses, reproduceres eller kobles til et deploy. Sammen med `G20` (ingen error boundary) betyder det, at fejlen hverken fanges eller rapporteres. **Halveret (august 2026):** versionsstemplet er leveret — commit-SHA'en står nu både nederst i "Sådan virker det" og i hver `job_runs`-række, så en fejlmelding kan kobles til et deploy. **Tilbage står fejltelemetrien selv** (hvor skal et crash rapporteres hen?) og source maps, som først giver mening, når der er et sted at sende dem hen. `componentDidCatch` i `ui/ErrorBoundary.jsx` er stedet, den kobles på. | Lille–mellem |
| G50 | **`grant all` til `anon` på 22 tabeller/views — RLS bærer hele adgangskontrollen alene.** `analytics_events` er den eneste undtagelse (`schema.sql:4179-4180`), og `matches` er siden indsnævret af `security_hardening.sql:71-72`. `notification_log` og `user_activity_days` har RLS slået til med **nul policies** — deny-all, altså sikkert, men så er grant'en meningsløs. | Grant'en er ikke i sig selv et hul: RLS holder, og de tre kendte huller er lukket (`G14`–`G16`). Men den efterlader nul dybde — en glemt eller fejlskrevet policy er forskellen mellem "lukket" og "offentlig", uden noget andet lag imellem. En grant, der er bredere end nogen policy tillader, beskriver desuden en adgang, der ikke findes, hvilket gør det svært at aflæse hensigten. Første skridt er at afgøre, om bredden er bevidst; er den, hører den til i §12 som vilkår frem for her. *(Verificeret aug. 2026; `monthly_standings` står uden `security_invoker` i `schema.sql:2690`, men det er dumpens alder — `security_hardening.sql:157` sætter den.)* | Lille–mellem |
| G52 | **Holdnavne-normaliseringen folder ikke ø/æ/å ned.** `normalizeTeamName()` (`api/sync-matches.js:49`) bruger NFD, som kun splitter accenter fra deres grundbogstav — ø, æ og å er selvstændige tegn og overlever, hvorefter tegn-filteret **sletter** dem: "FC København" bliver `fckbenhavn`, "FC Kobenhavn" bliver `fckobenhavn`. | To skrivemåder af samme danske klub er derfor to forskellige hold for både `findByName()` og `ambiguousTeamNames()` — og fordi navnet er *fald-tilbagen*, når leverandørens id ikke kendes, ender det som en dublet i `teams` frem for som en fejl. Ufarligt i dag: ingen af de syv turneringer har to skrivemåder af samme klub, og gabet er fastholdt i en test (`sync-matches.test.js:109-114`) frem for at være uskrevet. Men det er en fejl, der først viser sig, når en dansk klub kommer ind fra en anden leverandør end den, der oprettede den — altså i samme øjeblik en ottende turnering tilføjes, hvor ingen leder efter den. Rettelsen er tre linjer (`ø→o`, `æ→ae`, `å→aa`) før NFD; det svære er ikke koden, men at vælge foldningen: leverandører skriver både "Koebenhavn" og "Kobenhavn", og kun én af dem kan ramme samme nøgle. | Lille |

## Ideer

Ikke besluttet, ikke prioriteret — noteret, så de ikke skal opdages forfra. En
idé bliver til en `B`- eller `A`-række, når den er værd at tage stilling til.

| # | Idé | Hvorfor den er værd at overveje | Status |
|---|---|---|---|
| I1 | **Eksport-knap i Analytics ("kopiér som CSV/JSON")** | [`features/analytics-v1.md`](./features/analytics-v1.md) siger, at SQL-editoren *er* eksport-mekanismen. Det passer for ad hoc-analyse, men ikke for "send tallene videre" — og en knap koster ingen ny afhængighed. | Ny |
| I2 | **Diagnose-historik** | Liga-diagnosen er et øjebliksbillede. Uden historik kan man ikke se, at en liga gik fra "Sund" til "Kun en del tipper" for tre uger siden. Kræver et sted at gemme snapshottet — første gang noget i Analytics ville have brug for et cron eller en tidsserie-tabel, hvilket arkitekturvalg #3 i spec'en lukkede døren for. | Afventer behov |
| I3 | **Alarm ved tilstandsskifte i en liga** | Naturlig følge af `I2`: en liga, der skifter til rød, er interessant i det øjeblik det sker, ikke næste gang nogen åbner admin. | Afhænger af `I2` |
| I5 | **Del-mulighed for highlights** (Rundevinder, Ratingrekord, Ny rival, Månedsmester, Sæsonvinder m.fl.) | Naturlig forlængelse af Story Engine (§17): kortene findes allerede, men kan i dag ikke deles ud af appen. | Ny |
| I6 | **Ambassadørprogram ved oprettelse af ligaer/konkurrencer** (evt. med synligt deltagerantal) | Vækstkanal, der bygger på strukturen, der allerede findes (ligaer/konkurrencer), men ingen mekanik eller incitament er designet endnu. | Ny |
| I7 | **Finpuds invitationsflowet** | Invitationer er nøglen til nye brugere (delt konkurrence-/liga-link, §7), men er ikke selv blevet gennemgået som en samlet oplevelse. | Ny |
| I8 | **Professionel hjemmeside** (4–6 sider: forside, hvordan virker det, features, om os, kontakt, download app) | Giver troværdighed, kan deles og vises til virksomheder/brugere, og gør produktet indekserbart for Google. Ingen hjemmeside findes i dag ud over selve appen. | Ny |
| I9 | **SEO for hjemmesiden** | Afhænger af `I8` — der er ingen side at optimere, før den findes. | Afhænger af I8 |
| I10 | **Domæne og professionel e-mail** | Forudsætning for troværdighed udadtil (hjemmeside, invitationer, kontakt) — hænger sammen med `I8`. | Afhænger af I8 |
| I11 | **LinkedIn-side**, hvis der satses på indtægt via virksomheder | Betinget af en B2B-retning, der ikke er besluttet endnu. | Betinget af B2B-retning |
| I12 | **Offentlig side pr. liga** (fx `predictionhub.app/league/padel-legends`: antal sæsoner, medlemmer, mestre, statistik — ikke tips, kun historik) | Bygger videre på liga-laget (§18) som en delbar, offentlig facade for hver liga. Kræver stillingtagen til, hvad der må vises uden login. | Ny |
| I15 | **Weekly Mix** — automatikken: et job, der opretter ugens kupon af sig selv | **Indholdet er leveret 1. august 2026 (A22):** opret-galleriet har et "Ugens kupon"-kort — `random`, én runde frem, alle turneringer, navnet genereret — så en bruger leverer kuponen manuelt med to tryk. **Tilbage står KUN gentagelsen**, og dens to ubesluttede punkter: (1) **hvem skriver?** — enhver konkurrence skrives i dag af sin egen opretter, og RLS kræver `created_by = auth.uid()`, så et ugentligt job skal køre som `service_role` (mønsteret findes nu: `award_competition_periods()` tillader allerede `service_role`); (2) **"mest interessante kampe"** — der findes hverken odds eller tabelstilling i basen, så et automatisk udvalg bliver heuristik, hvilket støder på kap. 1's *"odds og avanceret analyse må aldrig overskygge det sociale formål"* — den leverede kupon undgår spørgsmålet ved at trække tilfældigt. Weekly Mix ville desuden være et **andet** ugentligt begreb ved siden af den globale spillerunde (som **er** produktets ugentlige tvær-turneringsbegreb) — det er dét, der skal begrundes. | Afventer efterspørgsel — mål først om Ugens kupon-kortet bruges (`competition_created` bærer `metadata.mode`) |

## Forkastede ideer

Ideer, der er overvejet og fravalgt. Står her, fordi de ikke arkiveres andre
steder — og fordi en forkastet idé ellers bliver foreslået igen.

| Dato | Idé | Hvorfor ikke |
|---|---|---|

---

*Levende dokument. Fravalgt scope for allerede leverede features står i den
enkelte spec under "Bevidst ikke med i v1" — det er en historisk
scope-beslutning, ikke en to-do. Bliver et af de punkter en reel kandidat, får
det en `B`-række her.*
