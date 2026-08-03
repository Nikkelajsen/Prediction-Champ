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
ROADMAP (næste ledige: **A27**) — `A11` er fx også navnet på en logadvarsel i
`api/_shared.js`. `B#` ubygget · `G#` teknisk gæld · `I#` ideer. Spec-lokale
ID'er (`K2`, `F1`) beholder deres eget navn og linker til spec'en.

**Rækkefølgen står i [Prioriteret rækkefølge](#prioriteret-rækkefølge) nedenfor**
— tabellerne længere nede er opslagsværker sorteret efter ID, ikke efter, hvad
der skal laves først.

---

## 📥 Indbakke

Skriv én linje. Intet ID, ingen begrundelse, ingen formatering — det er hele
pointen. Ryddes ved næste session: hvert punkt får et ID og en række nedenfor,
eller en linje i "Forkastede ideer".

- `#34` lukkede kun kilden for grantor-rollen `postgres`: skema-eksporten efter #36 viser, at `alter default privileges for role supabase_admin … grant all on tables to anon` stadig står der (migreringens `do`-blok swallowede fejlen, som den var skrevet til), og sekvenserne blev aldrig dækket — `grant all on sequence public.job_runs_id_seq to anon` plus begge `on sequences`-defaults står tilbage
- `competitions.rules` har efter `G3` ingen læsere overhovedet — hverken i klienten eller i SQL, hvor `pc_points()` altid har hardkodet 3/1 — så kolonnen står tilbage som ren historik; et `drop column` er uigenkaldeligt og er et produktspørgsmål (skal point nogensinde kunne variere pr. konkurrence?) og ikke en oprydning
- `send-notifications.js` læser `round_standings` til "nr. X af N" med `sb()` uden paginering — N kan afkortes ved >1000 rækker (samme klasse som `G51`)
- deadline-dedup-nøglen bruger serverens UTC-dato (`new Date().toISOString()`), ikke `dateInZone` — harmløst i 08–22-vinduet, men eneste dato i filen uden dansk tidszone
- `KIND_LABEL` i `src/lib/ops.js` kender ikke `award:`/`newleague:` — Drift-forhåndsvisningen viser rå nøgle-prefixer for de to nyeste beskedtyper
- karriereprofilens globale titler/rekorder kræver komplethed på tværs af ALLE kampe, også uofficielle — én uspillet skotsk kamp kan tilbageholde en global måneds-/rundetitel (`career_profile.sql`, samme klasse som `G9`/`G10`)
- `username_available()` og `profiles_display_name_lower_idx` findes kun i schema-eksporten — ingen versioneret migrering i `sql/`
- `api/delete-account.js` har ingen `maxDuration` i `vercel.json` og arver platformens 300 s
- `sql/tournament_scotland_premiership.sql` sætter hverken `provider`, `live_enabled` eller `is_official` — skabelonen halter efter `multi_provider.sql`
- auth-opslaget i `isAuthorized()` (`api/_shared.js`) er det sidste udgående kald uden timeout — `G19`-hullet
- staging-projektet i Supabase mistede sin tracker, da `G4` blev leveret som dev-fejlen — opgaven står ingen steder
- gen-kørsel af `tournament_scope.sql` eller `standings_tiebreakers.sql` re-granter `anon` select på stillings-viewene — i konflikt med `G50`
- Tier 2–5-beslutningerne står kun i ROADMAP'ens beslutningslog — `DECISIONS.md` fik dem aldrig, selvom begge filer udråber sig som arkivet
- `rnk` i `rating_history` rangerer kun på score uden exacts-tiebreak — to spillere kan dele gemt runde-placering, selvom Elo-duellen skiller dem

*Ryddet 3. august 2026: de elleve linjer blev til `A25`–`A26`, `B15`–`B16`,
`G53`–`G57` og `I16`. Én fik ikke eget ID: `B2`s testcase 3 er foldet ind i
`G8`, som den handler om — den flytter rækkens spørgsmål fra "er stien nogensinde
kørt?" til "står rækken i produktion?". Samtidig fik backloggen en **prioriteret
rækkefølge i tiers**, som den ikke har haft siden ROADMAP'ens gamle liste blev
delt op 31. juli; ID-tabellerne kunne kun læses som opslagsværk, ikke som
"hvad nu".*

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

## Prioriteret rækkefølge

Alle 22 åbne punkter i den rækkefølge, de bør tages — ikke efter ID og ikke efter
størrelse. **Hvert punkt står præcis ét sted.** Tabellerne længere nede er
opslagsværket (hvad er `G32`?); denne er svaret på "hvad nu?".

*Tier 2, 3, 4 og 5 er alle kørt 3. august 2026: 21 punkter leveret og slettet på
én dag. Tier 1 (fem aflæsninger) står tilbage som det næste — den kræver adgang
til produktionsdata og ikke kode.*

Rækkefølgen følger fire regler, i den rækkefølge de slår hinanden:

1. **Et svar, vi allerede har, er gratis** — et opslag, der lukker eller
   skrumper en række, kommer før alt, der skal bygges.
2. **Kode, der lyver, koster mere end kode, der mangler** — en betingelse fra en
   verden, der ikke findes mere, koster den næste læser tid hver gang.
3. **Fastholdelse før vækst** (produktbogens kapitel 3) — brugerværdi før
   robusthed, robusthed før udadvendt.
4. **Det, der venter på en udløser, prioriteres ikke** — det står nederst, ikke
   fordi det er uvigtigt, men fordi rækkefølgen ikke er vores at vælge.

### Tier 1 — Aflæsninger: svaret ligger i vores egne data

Ingen af de fem kræver, at der bygges noget. De kræver, at nogen kigger. Tre af
dem har ventet på en aflæsning i flere uger, mens spørgsmålet stod som åbent.

| # | Hvad | Hvorfor her |
|---|---|---|
| `A11` | Kør `job_runs.authVia`-opslaget (står i [`CRON.md`](./CRON.md)) | Ét SQL-opslag afgør, om `?secret=`-fallbacken kan fjernes. Er svaret `header` hele vejen, er næste skridt en sletning i `api/_shared.js`. |
| `B12` | Kør §5F-forespørgslen i [`features/analytics-v1.md`](./features/analytics-v1.md) | Forespørgslen er skrevet, forbeholdene er skrevet. Svarer samtidig på `I15`s åbne spørgsmål, om Ugens kupon-kortet overhovedet bruges — to rækker for ét opslag. |
| `G8` | `select ... from competitions where mode_params ? 'tournaments'` | `B2`s testcase 3 er godkendt 2. august, og den ER denne kodesti. Svarer opslaget med rækker, slettes rækken helt. |
| `I16` | Tæl `profiles.anonymized_at is not null` | Billigste punkt på hele listen, og det eneste, der giver `A25` en udløser. Ingen ny hændelse — kun en tælling på et felt, der allerede står der. |
| `A5` | Læs Story Engine-regelstatistikken | Uret har kørt siden 31. juli. Kræver kun, at Analytics-fanen åbnes med spørgsmålet "beholder højdepunkterne deres emoji?" i hånden. |

### Tier 2 — Billige rettelser, hvor koden lyver ✅ tomt

**Kørt 3. august 2026.** Alle otte punkter er leveret og slettet: `G54`, `G53`,
`G3`, `B15`, `G55`, `G56`, `G57` — og til sidst `G5`, som ikke kunne afgøres fra
repoet. Skema-eksporten blev kørt, og svaret var, at advarslen havde ret om
databasen og uret om filen: produktionens 25 funktionskroppe indeholder alle
CRLF, mens `rating_core.sql` selv var blevet normaliseret til LF. Kroppene er
hentet ordret tilbage fra eksporten og er nu byte-identiske med `prosrc`;
`.gitattributes` holder dem der. Samme eksport lukkede `G21`s sidste punkt —
`schema.sql` er frisk, og filens eget datostempel er nu svaret på, hvor gammel
den er.

Tieret bliver stående som en tom overskrift indtil næste gennemgang: det er
billigere at se, at kategorien findes og er tom, end at genopdage, at den skulle
have været der.

### Tier 3 — Brugerværdi oven på noget, der allerede findes ✅ tomt

**Kørt 3. august 2026.** Alle fire punkter er leveret og slettet: `B10` og `B11`
som én leverance (Story Engine v1.2's to kåringsregler + push, hvor
notifikations-jobbet blev den pålidelige skriver af kåringerne), `B9` (ny
turnering) og `I5` (deling).

`I5` viste sig at være **halvt leveret i forvejen**, og rækken sagde noget
forkert: historie-kortet på Hjem har haft en Del-knap siden v1.1. Det, der
manglede, var arkivet — karriereprofilens milepæle, altså netop dét sted, man
kigger, når kortet er væk fra Hjem igen.

### Tier 4 — Datarisiko med en lunte ✅ tomt

**Kørt 3. august 2026.** Alle fem punkter er leveret og slettet: `G52`, `G11` +
`G32` (samlet, som rækkerne krævede), `G4` og `G50`.

To af dem viste sig at handle om noget andet, end rækken sagde. **`G50`** spurgte,
om bredden var bevidst — svaret står i eksporten og er nej: `grant all` til `anon`
kommer fra Supabases default privileges for `public` og gælder derfor hver eneste
tabel, nogen opretter. Bredden var en **regel**, ikke en liste, så en oprydning,
der kun fjernede de 22, ville være rullet tilbage af den næste migrering.
**`G52`**s foldning var det svære valg, rækken lovede: retningen følger af NFD,
som allerede folder "ä" til "a" — så den udskrevne form skal folde samme sted
hen. "ue" er bevidst ikke med, fordi det er to almindelige bogstaver i de sprog,
klubnavnene står på.

### Tier 5 — Robusthed og vedligehold ✅ næsten tomt

**Kørt 3. august 2026.** Fire af de seks er leveret og slettet: `G42`
(fejltelemetri + source maps), `B16` (heartbeat'en tjekker migreringernes
virkning), `G13` (rettede tips flytter `updated_at`) og `G7`, som blev lukket
som et **nej** — en permanent trigger er ikke prisen værd for en fejl, der
retter sig selv, og begrundelsen står i `DECISIONS.md`.

To rækker skrumpede i stedet for at forsvinde, og begge er ærligere nu:

| # | Hvad står tilbage | Hvorfor det ikke bare er mere af det samme |
|---|---|---|
| `G2` | 7 advarsler, alle `set-state-in-effect` | De billige mønstre er brugt op. Det, der er tilbage, er ÉT mønster — "hent data i en effekt og sæt state" — som resten af skærmene bruger, og som ikke kan undgås uden et data-bibliotek, projektet bevidst ikke har. Næste skridt er en beslutning om det mønster, ikke en oprydning. |
| `G1` | `MainApp` (~606) og fire mindre | `ChampionshipTab` og `ProfileScreen` er delt. `MainApp` er den næste og den sværeste: navigations-tilstandsmaskinen bor der, og den er også `A23`s emne — de to bør formentlig ses sammen. |

### Tier 6 — Venter på en udløser

Står ikke her, fordi de er små, men fordi rækkefølgen ikke er vores at vælge.
Røres kun, når udløseren i deres `Afgøres`-felt indtræffer.

| # | Hvad | Udløser |
|---|---|---|
| `A25` | Lukket konto som deltager i ikke-startede konkurrencer | Første rigtige kontolukning — synlig, når `I16` er talt. |
| `A26` | `ambiguousTeams`: godkendte par eller accepteret støj | Turnering #3. |
| `A23` | Skal appen have en router? | Når tilbage-knappen koster brugere, eller `I12` kræver delbare interne URL'er. |
| `A14` | Fuld Prettier-gennemformatering | Næste gang der alligevel røres bredt i frontenden — ellers aldrig. |
| `I15` | Weekly Mix-automatikken | `B12`s opslag (Tier 1) siger, om Ugens kupon-kortet overhovedet bruges. Bruges det ikke, er automatikken besvaret. |
| `I2` | Diagnose-historik | Kræver et sted at gemme snapshottet — første gang Analytics ville have brug for en tidsserie-tabel. |
| `I3` | Alarm ved tilstandsskifte i en liga | Afhænger af `I2`. |

### Tier 7 — Udadvendt og ubesluttet

Vækst, ikke fastholdelse. Produktbogens kapitel 3 sætter dem bevidst efter alt
ovenstående, og ingen af dem er besluttet — de står i rækkefølge efter, hvad der
gater hvad, ikke efter værdi.

| # | Hvad | Bemærkning |
|---|---|---|
| `I8` | Professionel hjemmeside | Gater `I9` og `I10`. Den første, der skal besluttes, hvis der overhovedet satses udadtil. |
| `I10` | Domæne og professionel e-mail | Forudsætning for troværdighed i invitationer og kontakt. |
| `I9` | SEO | Der er ingen side at optimere, før `I8` findes. |
| `I7` | Finpuds invitationsflowet | Det eneste punkt i tieret, der virker på **eksisterende** brugere — kunne argumenteres op i Tier 3, hvis vækst bliver målet. |
| `I12` | Offentlig side pr. liga | Kræver stillingtagen til, hvad der må vises uden login — og ville som den første gøre `A23` (router) nødvendig. |
| `I6` | Ambassadørprogram | Ingen mekanik designet endnu. |
| `I11` | LinkedIn-side | Betinget af en B2B-retning, der ikke er valgt. |
| `I1` | Eksport-knap i Analytics | Nederst, fordi SQL-editoren allerede **er** eksport-mekanismen for den ene bruger, der har adgang. |

---

## Åbne beslutninger

Spørgsmål, der er identificeret, men bevidst ikke afgjort endnu. Når en
beslutning træffes, flyttes den til [`DECISIONS.md`](./DECISIONS.md) med dato og
begrundelse, og rækken her slettes. `Afgøres` er en **udløser**, ikke en dato.

| # | Spørgsmål | Kontekst | Afgøres |
|---|---|---|---|
| A5 | **Emojis i historie-kort: til eller fra?** | Gør kortet skimbart på mobil, men mindre klassisk. **v1-default: emojis til.** **Delvist besvaret (v1.1, juli 2026):** emoji er nu et *signal* — den findes kun i højdepunkt-tieret, mens dæmpede kort er uden. Spørgsmålet er dermed reduceret til, om højdepunkterne skal beholde deres. **Datamanglen er lukket (30. juli 2026):** Analytics-fanens sektion "Story Engine-regler" viser genereret/vist/delt/afvist pr. regel, så spørgsmålet kan afgøres på tal frem for fornemmelse. **Sidste forudsætning er væk (31. juli 2026):** `story_engine.sql` er gen-kørt i produktion (den tidligere `B3`), så v1.1's 14 regler genererer nu rigtige kort. Uret på "et par runder" starter her. | Når et par runder er kørt med den nye regelstatistik i hånden. |
| A11 | **`?secret=`-fallbacken fjernes helt** (hænger sammen med teknisk gæld) | Kan først lukkes, når alle cron-jobs (ét sync-job pr. turnering + notifikations-jobbet) er bekræftet flyttet til `x-sync-secret`-headeren — ellers fejler de med 401. **Aflæsningen er nu ét SQL-opslag (august 2026):** hver kørsel skriver `authVia` (`header`/`query`/`admin-token`) i `job_runs.detail`, så spørgsmålet besvares med 30 dages historik i appens egne data. `isAuthorized()` har altid vidst det — værdien blev bare kasseret, så det eneste spor var en advarsel i Vercels logs, hvor **fravær af advarsler ikke kunne skelnes fra fravær af kørsler**. Opslaget og aflæsningstabellen står i [`CRON.md`](./CRON.md). | Når opslaget viser `header` for alle jobs i en periode, der dækker alle skemaer (det langsomste er `sync-matches` hver 12. time). Derefter fjernes fallbacken fra `api/_shared.js`. |
| A14 | **Skal hele kodebasen gennemformateres med Prettier?** | `npm run format` findes, men `format:check` er bevidst ikke et CI-trin. En fuld gennemformatering ville omskrive ~6.700 linjer ved `printWidth: 140` (~14.000 ved standard 80) på tværs af ~126 filer (86 uden testfiler; genmålt august 2026). Prisen er hele repoets `git blame`; gevinsten er konsistens i en kodebase med én forfatter og en i forvejen ensartet håndstil. Beslutningen er **udskudt, ikke truffet** — se [`DECISIONS.md`](./DECISIONS.md), 30. juli 2026. | Næste gang der alligevel røres bredt i frontenden — ellers aldrig. |
| A23 | **Skal appen have en router?** | Navigation er i dag to `useState` i `MainApp.jsx` (`tab` + `screen`), og deep links læses ved boot og strippes straks via `history.replaceState` (`App.jsx:104`, `MainApp.jsx:215,239`). Følgen er ingen tilbage-knap, ingen browser-historik og ingen delbare URL'er til interne skærme — mærkbart for en PWA, hvor telefonens tilbage-gestus forventes at virke. Men det er et arkitekturvalg, ikke en fejl: afhængighedsfattigheden er bevidst (fire runtime-deps, ingen router, `docs/reviews/2026-08-app-review.md` §7), og en router omskriver hele navigations-tilstandsmaskinen inkl. begge deep-link-join-flows, som ingen test dækker. | Når tilbage-knappen enten koster brugere (kan aflæses i analytics) eller en feature kræver ægte delbare interne URL'er — `I12`s offentlige ligaside er den første, der ville. |
| A25 | **Skal en lukket konto meldes af konkurrencer, der endnu ikke er begyndt?** | `B4` valgte den simple regel: alt bevares, fordi tips, rating og kåringer er *vennernes* stillinger og ikke kun den lukkedes egne. Den begrundelse holder for alt, der er spillet — men ikke for en konkurrence, hvor ingen kamp er låst endnu: dér findes der ingen historik at beskytte, og en framelding ville hverken omskrive noget eller bryde `group_membership_invariant`, som netop tillader framelding, når man ingen tips har på låste kampe. Prisen ved status quo er et pseudonym på deltagerlisten i en konkurrence, personen aldrig kommer til at spille — synligt for alle de andre deltagere hele sæsonen. | Når den første konto faktisk lukkes. Antallet kan i dag ikke aflæses nogen steder (`I16`), så udløseren er indtil videre en henvendelse, ikke et tal. |
| A26 | **`ambiguousTeams`: godkendte par eller accepteret støj?** | Feltet i sync-resuméet er bygget på egenskaben *"kun til stede, når der ER noget at kigge på"* — og den holder ikke længere for Scotland: `Dundee` ligger inde i `Dundee United`, begge klubber bliver i Premiership, og feltet er derfor permanent tændt med et par, der allerede er afgjort som en ægte navnelighed (2. august 2026, [`features/turnering-2.md`](./features/turnering-2.md)). Et felt, der altid er der, holder man op med at læse — og så er kontrollen reelt væk, netop når turnering #8 tilføjer et par, ingen har set før. To veje: en liste over **godkendte** par (`Dundee`/`Dundee United`), så feltet igen kun melder det nye, eller en accept af, at dette ene felt læses med et kendt par i baghovedet. Den første koster en liste, der skal vedligeholdes pr. turnering; den anden koster kontrollens troværdighed. | Ved turnering #3 — det er dér, det viser sig, om det ene par er en undtagelse eller et mønster. |

## Ubygget

| # | Hvad | Hvorfor / hvad den venter på | Omfang |
|---|---|---|---|
| B12 | **Mål, om "Anbefalet" på Sæson-kortet flytter fordelingen** | Mærket blev sat på i `A22` netop for at flytte, hvilken mode nye brugere vælger, men effekten er aldrig aflæst — og et anbefalings-mærke, der ikke virker, er værre end ingen, fordi det bruger den plads, der skulle guide. `competition_created` bærer allerede `metadata.mode`, så før/efter kan opgøres uden ny instrumentering. Samme opslag svarer på `I15`s åbne spørgsmål om, hvorvidt Ugens kupon-kortet bruges. **Forespørgslen er skrevet (august 2026)** — den står klar til at køre i [`features/analytics-v1.md`](./features/analytics-v1.md) §5F sammen med de tre forbehold, svaret skal læses med (lille datamængde, lossy hændelseslog, og at kort-rækkefølgen blev vendt samme dag som mærkatet kom på). Tilbage står at køre den. | Lille (opslag) |

## Teknisk gæld

| # | Gæld | Hvorfor den betyder noget | Omfang |
|---|---|---|---|
| G1 | **De resterende store skærmfiler** — `MainApp.jsx` ~606 linjer, `HjemTab.jsx` ~530, `ProfileScreen.jsx` ~460, `CreateCompetitionScreen.jsx` ~444, `AdminScreen.jsx` ~329. | Anden halvdel af fil-opdelingen fra 30. juli 2026. **To af dem er delt 3. august 2026 (Tier 5):** `ChampionshipTab` gik fra 512 til 272 linjer (`championship/StandingsTable.jsx`, `scope.js`, `CardHead.jsx`) og `ProfileScreen` fra 614 til 460 (`profile/facts.js`, `Sparkline.jsx`) — rene flytninger, hvor testene nu importerer fra modulerne frem for gennem skærmen. Mønstret er dermed bevist tre gange. Gevinsten er testbarhed og læsbarhed, ikke linjetal: `MainApp` er den næste, og den er også den sværeste, fordi navigations-tilstandsmaskinen bor der (`A23`). | Mellem |
| G2 | **7 ESLint-advarsler fra React Compiler** — alle af typen `set-state-in-effect`, i indlæsningsstier (`ChampionshipTab`, `CreateCompetitionScreen`, `GroupScreen`, `MainApp`, `PredictionsScreen` ×3). | Står som advarsel frem for fejl, fordi hvert fund kræver en gennemtænkt omskrivning, ikke en rettelse. Loftet i `package.json` (`--max-warnings 7`) gør, at tallet kan falde, men aldrig vokse ubemærket. **Faldt fra 23 til 14 (3. august, `B4`) og fra 14 til 7 samme dag (`G2`, Tier 5):** de billige mønstre er brugt op — en komponent defineret inde i en anden (fire advarsler på én rettelse), en akkumulator, der lagde sammen under render, og to effekter i `App.jsx`, som satte tilstand, der lige så godt kunne være initial. **Det, der er tilbage, er ét mønster:** "hent data i en effekt og sæt state", som resten af skærmene bruger, og som ikke kan undgås uden et data-bibliotek, projektet bevidst ikke har. Næste skridt er derfor ikke en oprydning, men en beslutning om det mønster. | Mellem |
| G8 | **Multi-turnerings-`full_season` er uafprøvet mod rigtige data.** `mode_params.tournaments` har aldrig været skrevet i produktion (nul rækker, 31. juli 2026), så stien er kun dækket af unit-tests — både ved oprettelsen (`createCompetition` i `src/lib/data/competitions.js`) og i `coversSeason` i `api/_backfill.js`. | Ufarlig indtil den første multi-turneringskonkurrence oprettes; dét er tidspunktet at kigge efter. **`A16` (1. august 2026) skærper den lidt:** gennemgangen viste, at `random` og `custom` allerede i dag leverer det tvær-turnerings-scenarie, feltet skulle have leveret — så den *adfærd*, man ville teste, findes i produktion, mens netop denne kodesti stadig ikke gør. Fejler den, fejler den derfor tavst i et hjørne, ingen har haft brug for endnu. **`A22` (1. august 2026) udvider skriversiden:** Favorithold med flere hold skriver nu OGSÅ `mode_params.tournaments` (plus `team_ids`), så den første rigtige multi-konkurrence kan lige så vel blive en hold-konkurrence — uanset hvilken, efterses den i Admin → Drift, når den kommer. **Præmissen er formentlig allerede faldet (3. august 2026):** `B2`s testcase 3 er *præcis* denne kodesti — "`full_season`-konkurrence med begge turneringer (multivalg) → kampe fra begge materialiseres, stilling korrekt" — og ejeren har kørt og godkendt den mod produktionsdata 2. august ([`features/turnering-2.md`](./features/turnering-2.md) §6). Blev konkurrencen oprettet frem for kun gennemklikket, er "nul rækker i `mode_params.tournaments`" ikke længere sandt, og rækken skal slettes. **Rækken er derfor skrumpet til ét opslag:** `select id, name, mode_params from competitions where mode_params ? 'tournaments'` — svarer den med rækker, er stien kørt mod rigtige data, og det eneste tilbage er at se stillingen efter. | Lille (opslag) |

## Ideer

Ikke besluttet, ikke prioriteret — noteret, så de ikke skal opdages forfra. En
idé bliver til en `B`- eller `A`-række, når den er værd at tage stilling til.

| # | Idé | Hvorfor den er værd at overveje | Status |
|---|---|---|---|
| I1 | **Eksport-knap i Analytics ("kopiér som CSV/JSON")** | [`features/analytics-v1.md`](./features/analytics-v1.md) siger, at SQL-editoren *er* eksport-mekanismen. Det passer for ad hoc-analyse, men ikke for "send tallene videre" — og en knap koster ingen ny afhængighed. | Ny |
| I2 | **Diagnose-historik** | Liga-diagnosen er et øjebliksbillede. Uden historik kan man ikke se, at en liga gik fra "Sund" til "Kun en del tipper" for tre uger siden. Kræver et sted at gemme snapshottet — første gang noget i Analytics ville have brug for et cron eller en tidsserie-tabel, hvilket arkitekturvalg #3 i spec'en lukkede døren for. | Afventer behov |
| I3 | **Alarm ved tilstandsskifte i en liga** | Naturlig følge af `I2`: en liga, der skifter til rød, er interessant i det øjeblik det sker, ikke næste gang nogen åbner admin. | Afhænger af `I2` |
| I6 | **Ambassadørprogram ved oprettelse af ligaer/konkurrencer** (evt. med synligt deltagerantal) | Vækstkanal, der bygger på strukturen, der allerede findes (ligaer/konkurrencer), men ingen mekanik eller incitament er designet endnu. | Ny |
| I7 | **Finpuds invitationsflowet** | Invitationer er nøglen til nye brugere (delt konkurrence-/liga-link, §7), men er ikke selv blevet gennemgået som en samlet oplevelse. | Ny |
| I8 | **Professionel hjemmeside** (4–6 sider: forside, hvordan virker det, features, om os, kontakt, download app) | Giver troværdighed, kan deles og vises til virksomheder/brugere, og gør produktet indekserbart for Google. Ingen hjemmeside findes i dag ud over selve appen. | Ny |
| I9 | **SEO for hjemmesiden** | Afhænger af `I8` — der er ingen side at optimere, før den findes. | Afhænger af I8 |
| I10 | **Domæne og professionel e-mail** | Forudsætning for troværdighed udadtil (hjemmeside, invitationer, kontakt) — hænger sammen med `I8`. | Afhænger af I8 |
| I11 | **LinkedIn-side**, hvis der satses på indtægt via virksomheder | Betinget af en B2B-retning, der ikke er besluttet endnu. | Betinget af B2B-retning |
| I12 | **Offentlig side pr. liga** (fx `predictionhub.app/league/padel-legends`: antal sæsoner, medlemmer, mestre, statistik — ikke tips, kun historik) | Bygger videre på liga-laget (§18) som en delbar, offentlig facade for hver liga. Kræver stillingtagen til, hvad der må vises uden login. | Ny |
| I15 | **Weekly Mix** — automatikken: et job, der opretter ugens kupon af sig selv | **Indholdet er leveret 1. august 2026 (A22):** opret-galleriet har et "Ugens kupon"-kort — `random`, én runde frem, alle turneringer, navnet genereret — så en bruger leverer kuponen manuelt med to tryk. **Tilbage står KUN gentagelsen**, og dens to ubesluttede punkter: (1) **hvem skriver?** — enhver konkurrence skrives i dag af sin egen opretter, og RLS kræver `created_by = auth.uid()`, så et ugentligt job skal køre som `service_role` (mønsteret findes nu: `award_competition_periods()` tillader allerede `service_role`); (2) **"mest interessante kampe"** — der findes hverken odds eller tabelstilling i basen, så et automatisk udvalg bliver heuristik, hvilket støder på kap. 1's *"odds og avanceret analyse må aldrig overskygge det sociale formål"* — den leverede kupon undgår spørgsmålet ved at trække tilfældigt. Weekly Mix ville desuden være et **andet** ugentligt begreb ved siden af den globale spillerunde (som **er** produktets ugentlige tvær-turneringsbegreb) — det er dét, der skal begrundes. | Afventer efterspørgsel — mål først om Ugens kupon-kortet bruges (`competition_created` bærer `metadata.mode`) |
| I16 | **Tælling af lukkede konti** | `B4` gav kontolukning, men ingen måde at se, om nogen bruger den. Tallet findes allerede som data — `profiles.anonymized_at is not null` — så det er et opslag, ikke en instrumentering, og det er den billige halvdel. Den dyre halvdel er, hvad man gør med det: en analytics-hændelse ville kræve at udvide kataloget i `sql/analytics_events.sql` OG **logge om en person, der netop har bedt om at forsvinde** — og selv en aggregeret optælling er en måling af en handling, hvis hele pointe er at efterlade færrest mulige spor. En ren tælling på et felt, der i forvejen står i basen, tilføjer intet nyt spor; en hændelse gør. Gater desuden `A25`, som mangler en udløser. | Ny — afgrænses til tællingen, ikke en hændelse |

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
