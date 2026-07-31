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
ROADMAP (næste ledige: **A15**) — `A11` er fx også navnet på en logadvarsel i
`api/_shared.js`. `B#` ubygget · `G#` teknisk gæld · `I#` ideer. Spec-lokale
ID'er (`K2`, `F1`) beholder deres eget navn og linker til spec'en.

---

## 📥 Indbakke

Skriv én linje. Intet ID, ingen begrundelse, ingen formatering — det er hele
pointen. Ryddes ved næste session: hvert punkt får et ID og en række nedenfor,
eller en linje i "Forkastede ideer".

- dokumentationen siger gratis-planen giver 180 kald/time pr. entitet, kontosiden siger 3.000 API-kald — hvilket tal og hvilken enhed gælder?
- Lav privatlivspolitik og brugervilkår. Er der andet der skal tages hensyn til?

---

## Åbne beslutninger

Spørgsmål, der er identificeret, men bevidst ikke afgjort endnu. Når en
beslutning træffes, flyttes den til [`DECISIONS.md`](./DECISIONS.md) med dato og
begrundelse, og rækken her slettes. `Afgøres` er en **udløser**, ikke en dato.

| # | Spørgsmål | Kontekst | Afgøres |
|---|---|---|---|
| A5 | **Emojis i historie-kort: til eller fra?** | Gør kortet skimbart på mobil, men mindre klassisk. **v1-default: emojis til.** **Delvist besvaret (v1.1, juli 2026):** emoji er nu et *signal* — den findes kun i højdepunkt-tieret, mens dæmpede kort er uden. Spørgsmålet er dermed reduceret til, om højdepunkterne skal beholde deres. **Datamanglen er lukket (30. juli 2026):** Analytics-fanens sektion "Story Engine-regler" viser genereret/vist/delt/afvist pr. regel, så spørgsmålet kan afgøres på tal frem for fornemmelse. | Når et par runder er kørt med den nye regelstatistik i hånden. |
| A11 | **`?secret=`-fallbacken fjernes helt** (hænger sammen med teknisk gæld) | Kan først lukkes, når alle cron-jobs (ét sync-job pr. turnering + notifikations-jobbet) er bekræftet flyttet til `x-sync-secret`-headeren — ellers fejler de med 401. **Vejen er banet (30. juli 2026):** `isAuthorized()` i `api/_shared.js` logger en `[A11]`-advarsel, hver gang fallbacken bruges, så bekræftelsen kan *aflæses* i Vercels logs frem for gættes. Fremgangsmåden står i [`CRON.md`](./CRON.md). | Når loggene har været rene i en periode, der dækker alle skemaer (det langsomste er `sync-matches` hver 6. time) — senest sammen med turnering #2. |
| A14 | **Skal hele kodebasen gennemformateres med Prettier?** | `npm run format` findes, men `format:check` er bevidst ikke et CI-trin. En fuld gennemformatering ville omskrive ~6.700 linjer ved `printWidth: 140` (~14.000 ved standard 80) på tværs af alle 46 filer. Prisen er hele repoets `git blame`; gevinsten er konsistens i en kodebase med én forfatter og en i forvejen ensartet håndstil. Beslutningen er **udskudt, ikke truffet** — se [`DECISIONS.md`](./DECISIONS.md), 30. juli 2026. | Næste gang der alligevel røres bredt i frontenden — ellers aldrig. |
| K2 | **Per-turnering-opdeling af karriereprofilen fra start?** `ratings.scope` er forberedt til per-liga-rating. | Spec-lokal beslutning; sandheden står i [`features/karriereprofil-v1.md`](./features/karriereprofil-v1.md) §8. Står her, fordi backloggen skal kunne læses alene. v1-anbefaling: nej — ellers bygges en vælger uden indhold. | Når turnering #2 er i drift (`B2`). |

## Ubygget

| # | Hvad | Hvorfor / hvad den venter på | Omfang |
|---|---|---|---|
| B3 | **Gen-kør `sql/story_engine.sql` i produktion** | Story Engine v1.1 (A3/A4-leverancen) er i repoet, men migreringen er en manuel kørsel i Supabase SQL-editor, og den er ikke bekræftet kørt. Triggeren er uændret siden A9-rettelsen. Forudsætning for at kunne læse tonen på kortene og dermed for `A5`. | Lille |
| B2 | **Turnering #2: sæt Scotland Premiership i drift** | **Koden er leveret 31. juli 2026** (turneringsvælger, synligheds-korrekt rundeliga, SQL-script) — tilbage står de trin, der kræver produktionsadgang: kør [`sql/tournament_scotland_premiership.sql`](../sql/tournament_scotland_premiership.sql) (verificér sæsonnavnet først), kald `/api/sync-matches?leagueId=…` (`&dryRun=true` først — sæson-id'et står allerede i scriptet, så `&smSeason=` er unødvendig), kontrollér holdene for dubletter, opret cron-jobbet og skriv det i [`CRON.md`](./CRON.md), og kør testcases 2–6 i [`features/turnering-2.md`](./features/turnering-2.md) §6. Turneringen tændes **synlig** med det samme (fravigelse af `A10`). Gater `B1`. | Lille (drift) |
| B1 | **Global tirsdag–mandag-runde** | Produktbogens kapitel 4–5 beskriver den som gældende; appen regner i dag pr. turneringsrunde, hvilket med Superligaen alene reelt er det samme. Udskydes bevidst, til flere turneringer er i drift — først dér adskiller den sig. Står som trin 5 i [`ROADMAP.md`](./ROADMAP.md) og som kendt afvigelse mellem bog og app. | Mellem |

## Teknisk gæld

| # | Gæld | Hvorfor den betyder noget | Omfang |
|---|---|---|---|
| G1 | **De resterende store skærmfiler** — `MainApp.jsx` ~480 linjer, `HjemTab.jsx` ~450, `CreateCompetitionScreen.jsx` ~420, `AdminScreen.jsx` ~310. | Anden halvdel af fil-opdelingen fra 30. juli 2026 (`data.js`, `PredictionsScreen.jsx` og `AnalyticsPanel.jsx` er delt). Mønstret er bevist: barrel eller ren flytning bag uændret flade, så et grønt build er beviset for, at ingen eksport er tabt. Gevinsten er ikke kosmetisk — tip-skærmens tids-logik kunne ikke testes, før den blev flyttet ud, og har nu 18 tests. | Mellem |
| G2 | **26 ESLint-advarsler fra React Compiler** (`static-components`, `set-state-in-effect`, `purity`, `immutability`). | Står som advarsel frem for fejl, fordi hvert fund kræver en gennemtænkt omskrivning, ikke en rettelse. Loftet i `package.json` (`--max-warnings 26`) gør, at tallet kan falde, men aldrig vokse ubemærket — gælden er synlig i stedet for tavs. **Falder tallet, sænkes loftet i samme ombæring.** | Mellem |
| G3 | **Frontenden læser stadig `rules`-feltet.** | `rules` er historisk: `pc_points()` hardkoder 3/1 og ignorerer det, og alle opgørelser er altid 3-1-0 (F2, juli 2026). Læsningen er død kode, der antyder en konfigurerbarhed, som ikke findes. Noteret som "separat oprydning" i [`features/karriereprofil-v1.md`](./features/karriereprofil-v1.md) §7 og aldrig planlagt siden. | Lille |
| G4 | **Preview og produktion deler database**, medmindre staging-variablerne er sat (`DOCUMENTATION.md` §9). | Selve staging-projektet skal oprettes manuelt i Supabase; indtil det sker, kan en preview-deploy skrive i produktionsdata. Vilkåret er dokumenteret, men det er en risiko, ikke en beslutning. | Lille |

## Ideer

Ikke besluttet, ikke prioriteret — noteret, så de ikke skal opdages forfra. En
idé bliver til en `B`- eller `A`-række, når den er værd at tage stilling til.

| # | Idé | Hvorfor den er værd at overveje | Status |
|---|---|---|---|
| I1 | **Eksport-knap i Analytics ("kopiér som CSV/JSON")** | [`features/analytics-v1.md`](./features/analytics-v1.md) siger, at SQL-editoren *er* eksport-mekanismen. Det passer for ad hoc-analyse, men ikke for "send tallene videre" — og en knap koster ingen ny afhængighed. | Ny |
| I2 | **Diagnose-historik** | Liga-diagnosen er et øjebliksbillede. Uden historik kan man ikke se, at en liga gik fra "Sund" til "Kun en del tipper" for tre uger siden. Kræver et sted at gemme snapshottet — første gang noget i Analytics ville have brug for et cron eller en tidsserie-tabel, hvilket arkitekturvalg #3 i spec'en lukkede døren for. | Afventer behov |
| I3 | **Alarm ved tilstandsskifte i en liga** | Naturlig følge af `I2`: en liga, der skifter til rød, er interessant i det øjeblik det sker, ikke næste gang nogen åbner admin. | Afhænger af `I2` |
| I4 | **Gentænk "Opret en liga" og "Deltag med kode" på Ligaer-fanen** — de fylder for meget | `LigaerTab.jsx` (linje 191–210) rendrer to permanente fuldbredde-kort øverst, uden nogen betingelse: de vises ens, uanset om man har nul ligaer eller ti, og den første `GroupCard` kommer først derefter. Til sammenligning er "Ny konkurrence"-knappen lige ovenfor gated på `groups.length > 0`. **To ting gør den værd at tage alvorligt:** (1) den spejlvendte fejl er allerede rettet én gang i samme fil — kommentaren dér forklarer, at "Ny konkurrence" lå skjult for præcis de brugere, der havde brug for den; her vises to felter permanent til præcis dem, der ikke har; (2) Onboarding v1 og `GetStartedCard` er bygget til netop "jeg har ingen liga endnu", så kortene duplikerer en opgave, der har fået sin egen løsning. Mulige veje: vis dem kun ved nul ligaer · fold begge sammen bag én knap · flyt dem til liga-siden. | Ny |

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
