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
ROADMAP (næste ledige: **A32**; `A28`–`A31` blev brugt 4. august 2026) — `A11` er fx også navnet på en logadvarsel i
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

- `DECISIONS.md` mangler omkring tredive rækker mere fra ROADMAP'ens beslutningslog — udvælgelsen er spørgsmålet, ikke kopieringen
- `DOCUMENTATION.md` §20 siger "appens fem øvrige bruger-flag" og §13 "alle otte bruger-flag" — der er ni bruger-bundne nøgler i dag
- ingen test binder `LOKALE_NØGLER` til privatlivspolitikkens afsnit om lokale data, og det var præcis dér `G69` slap igennem
- Tier 1 er nu sprunget over tre gange i træk, fordi de fire opslag kræver en adgang, arbejdsmaskinen ikke har — skal der være en vej til at køre read-only opslag uden ejeren, eller er "to betjeninger i køen" bare vilkåret?

*Ryddet 4. august 2026: de seks linjer blev til `G69`, `B20`, `B21` og `I17` —
og for de sidste to gjaldt, at rækken ikke var svaret. **Én blev foldet ind:**
kontakt-mailen til hjemmesiden er ikke en opgave ved siden af `I10`, den ER
`I10` — spørgsmålet er hvilken adresse, og svaret skal samme dag ind tre steder
(`site/om.html`s `kontakt@leagly.example` og `legal.js`' `[NAVN]` og
`[KONTAKT-E-MAIL]`, som allerede står på tjeklisten i `DOCUMENTATION.md` §11).
**Én blev forkastet:** `manifest.json`s `short_name`. **Runden har samme kilde som
3. august, men den modsatte retning:** de fjorten fra dokumentations-gennemgangen
kom af at læse dokumentationen op mod koden; disse seks kom af at læse
**navneskiftet** op mod alt det, det rørte — og fire af de seks handler om det, der
ligger uden for appen (hjemmesiden, repoet, delebilledet). Det er der, et navneskifte
efterlader sine rester, netop fordi intet build fejler af dem. **`B20` er den ene, der
ikke kan vente uden at koste noget:** den kan først tælle fra udrulningsdagen, så hver
uge, den ligger stille, er en uge uden data — alle de andre koster det samme om et år.*

*Ryddet 3. august 2026 (anden runde): de femten linjer fra dokumentations-gennemgangen
blev til `A27`, `B17`–`B18` og `G58`–`G68`. **To linjer blev til én række:** `#34`s
efterladte default privileges og de `grant select … to anon`, der står nederst i
`tournament_scope.sql`/`standings_tiebreakers.sql`, er to veje ind i **samme**
tilstand — `anon` har adgang igen — og de lukkes af samme arbejde, så de er `G58`
sammen. Det er samme sammenlægningsregel som `G36` og `G42` i første runde.
**Fællesnævneren for runden er ikke en fejltype, men en kilde:** ingen af de femten
kom fra en bruger eller en fejlet kørsel. De kom af at læse dokumentationen op mod
koden — altså af at spørge, om det, der står skrevet, stadig passer. Det er en
billigere måde at finde `G59` (et opslag uden paginering, præcis `G51`s fejl et nyt
sted) end at vente på, at en runde igen melder et forkert deltagerantal.*

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

Alle 26 åbne punkter i den rækkefølge, de bør tages — ikke efter ID og ikke efter
størrelse. **Hvert punkt står præcis ét sted.** Tabellerne længere nede er
opslagsværket (hvad er `G32`?); denne er svaret på "hvad nu?".

*Tier 2, 3, 4 og 5 blev kørt tomme 3. august 2026 — 21 punkter leveret og slettet
på én dag — og fyldtes samme aften delvist op igen af dokumentations-gennemgangen
(14 nye rækker, `A27`, `B17`–`B18`, `G58`–`G68`). Det er ikke et tilbageskridt:
de fjorten fandtes hele tiden, de stod bare ingen steder. **Tier 1 er stadig det
næste** — den er vokset med `B17`, som er rykket øverst, fordi den er den eneste
række på listen, hvor status quo betyder, at et løfte til brugerne ikke holdes.*

*4. august 2026: `B17` er afløst af `B19` og slettet. Leverancen `A28`–`A31`
skriver `anonymize_my_account()` forfra i `sql/liga_admin.sql` med den
`client_errors`-nulstilling, `B17` skulle have leveret — så gen-kørslen af #31 er
ikke længere en selvstændig opgave, men en delmængde af en kørsel, der skal ske
alligevel. `G64` er slettet: `vercel.json` fik `maxDuration` på begge
konto-endpoints i samme ombæring, fordi det nye ikke måtte fødes med samme hul.*

*4. august 2026 (indbakken): fire nye rækker — `G69` øverst i Tier 2, og `B21`,
`I17` og `B20` i Tier 7. **Tier 1 er urørt**, og det er pointen: ingen af de fire
kan lukke en aflæsning, og `B19` er stadig det, hele leverancen fra samme dag
hænger på. Tier 7 voksede fra otte til elleve rækker og er nu tieret med flest —
en direkte følge af, at navneskiftet ramte alt det udadvendte, mens appen selv
var færdig samme dag.*

*5. august 2026: **Tier 2 er kørt tom igen** (`G69`, `G65`, `G67`, `G61`), og
listen er dermed 39 → 35. **Tier 1 er stadig urørt og stadig det næste** — det er
anden gang i træk, at et tier under den bliver kørt, mens `B19` og de fem
aflæsninger står stille, og grunden er den samme begge gange: Tier 1 kræver en
produktionsadgang, som ikke findes i den maskine, arbejdet bliver lavet i.
Rækkefølgen er altså rigtig, men den beskriver en kø, der har to betjeninger.*

*5. august 2026 (anden runde): **Tier 4 er kørt tom** (`G58`, `G59`, `G62`,
`G63`, `G66`), og listen er 35 → 30. To tiers på én dag, og begge gange var det
Tier 1, der ikke kunne røres. **`B19` er til gengæld vokset fra to SQL-filer til
fem** — det er prisen for at køre et SQL-tungt tier uden produktionsadgang, og
den er værd at se i øjnene: hver leverance, der ikke kan køres samme dag, gør
den ene opgave, der venter på ejeren, større. Tre af de fem er billige (#3 er et
no-op, #43 lukker intet kendt hul), men #10 er den, en bruger kan mærke.*

*5. august 2026 (tredje runde): **alle fem SQL-filer er kørt af ejeren, `B19` er
slettet, og Tier 5 er kørt** (`G60`, `G68`, `G2`; `G1` skrumpede). Listen er
30 → 26, og **Tier 1 er endelig rene aflæsninger igen** — der er ikke længere en
Run-knap på den. Fire tiers på én dag lyder som meget, men det er værd at bemærke
hvorfor det kunne lade sig gøre: tre af de fire var fyldt af
dokumentations-gennemgangen 3. august, altså af punkter, der aldrig havde ventet
på en beslutning, kun på at nogen læste efter. **To af dagens rækker blev lukket
som et NEJ** (`G2` og — 3. august — `G7`), og begge gange fordi rækkens præmis
ikke holdt ved eftersyn. Det er den billigste slags leverance og den, der er
lettest at springe over.*

*5. august 2026 (fjerde runde): `B22` er kørt og slettet — `rating_core.sql` er
gen-kørt, ratingene er regnet om, og en anden skema-eksport bekræfter, at
`recompute_ratings()` i produktion nu bærer `order by score desc, exacts desc`.
Listen er 27 → 26. **Dagens mest brugbare lære er ikke en af de tolv rækker, men
mekanikken, der fandt den trettende:** en frisk skema-eksport er den eneste
kilde, der kan modsige en påstand om, hvad der står i produktion, og den gjorde
det to gange på én dag. Begge gange var påstanden vores egen.*

Rækkefølgen følger fire regler, i den rækkefølge de slår hinanden:

1. **Et svar, vi allerede har, er gratis** — et opslag, der lukker eller
   skrumper en række, kommer før alt, der skal bygges.
2. **Kode, der lyver, koster mere end kode, der mangler** — en betingelse fra en
   verden, der ikke findes mere, koster den næste læser tid hver gang.
3. **Fastholdelse før vækst** (produktbogens kapitel 3) — brugerværdi før
   robusthed, robusthed før udadvendt.
4. **Det, der venter på en udløser, prioriteres ikke** — det står nederst, ikke
   fordi det er uvigtigt, men fordi rækkefølgen ikke er vores at vælge.

### Tier 1 — Produktionsadgang: svaret (eller kørslen) ligger i Supabase

Ingen af de fem kræver, at der bygges noget. De kræver, at nogen logger ind og
kigger. Tre af dem har ventet i flere uger, mens spørgsmålet stod som åbent.

*`B19` og `B22` er begge slettet 5. august 2026, og de to hører sammen: `B19`s
fem filer blev kørt, hvorefter skema-eksporten viste, at `rating_core.sql` (#0)
IKKE var — så `G68` var merget som kode og inert i databasen. Det blev `B22`,
som er kørt og verificeret i en anden eksport samme dag. **Tieret er dermed rene
aflæsninger igen.** Mønstret er værd at tage med: eksporten er den eneste kilde,
der kan sige nej til en påstand om, hvad der står i produktion — og den sagde
nej to gange på én dag, begge gange til os.*

| # | Hvad | Hvorfor her |
|---|---|---|
| `A11` | Kør `job_runs.authVia`-opslaget (står i [`CRON.md`](./CRON.md)) | Ét SQL-opslag afgør, om `?secret=`-fallbacken kan fjernes. Er svaret `header` hele vejen, er næste skridt en sletning i `api/_shared.js`. |
| `B12` | Kør §5F-forespørgslen i [`features/analytics-v1.md`](./features/analytics-v1.md) | Forespørgslen er skrevet, forbeholdene er skrevet. Svarer samtidig på `I15`s åbne spørgsmål, om Ugens kupon-kortet overhovedet bruges — to rækker for ét opslag. |
| `G8` | `select ... from competitions where mode_params ? 'tournaments'` | `B2`s testcase 3 er godkendt 2. august, og den ER denne kodesti. Svarer opslaget med rækker, slettes rækken helt. |
| `I16` | Tæl `profiles.anonymized_at is not null` | Billigste punkt på hele listen, og det eneste, der giver `A25` en udløser. Ingen ny hændelse — kun en tælling på et felt, der allerede står der. |
| `A5` | Læs Story Engine-regelstatistikken | Uret har kørt siden 31. juli. Kræver kun, at Analytics-fanen åbnes med spørgsmålet "beholder højdepunkterne deres emoji?" i hånden. **Udvidet af v2 (august 2026):** der er nu syv dagsregler mere at aflæse, og spørgsmålet er blevet skarpere — dagskortene har emoji, så tallene kan vise, om signalet stadig virker, når der kommer flere kort. |

### Tier 2 — Billige rettelser, hvor koden lyver ✅ tomt

**Kørt anden gang 5. august 2026.** De fire punkter fra dokumentations-gennemgangen
er leveret og slettet: `G69` (privatlivspolitikken nævner nu `pc_pwa_onboarded`),
`G65` (Scotland-skabelonen sætter `provider`, `live_enabled` og `is_official`),
`G67` (Tier 2–5-beslutningerne og `B4` er ført til `DECISIONS.md`) og `G61`
(`KIND_LABEL` kender alle fem beskedtyper).

*Første kørsel var 3. august 2026 (otte punkter: `G54`, `G53`, `G3`, `B15`,
`G55`, `G56`, `G57` og `G5`); tieret blev fyldt igen samme aften og er nu tømt
igen. Det er selve pointen med at lade overskriften stå: kategorien fandtes
begge gange, den var bare tom ind imellem.*

To af de fire viste sig at være større end rækken sagde, og begge gange samme
vej: **rækken pegede på ét sted, og fejlen havde to.** `G65` gjaldt ikke bare en
manglende kolonne, men at `is_official` defaulter til `true` — så skabelonen
ville have gjort en ny turnering officiel i samme sekund, den blev indsat, hvilket
er stik imod §10's egen tommelfingerregel. Og `G67`s "Tier 2–5" var et undertal:
`DECISIONS.md` mangler omkring tredive rækker fra ROADMAP'ens beslutningslog.
De fem, rækken navngav, er ført over; resten er noteret i indbakken, fordi
udvælgelsen — hvad der er en *beslutning* og hvad der er en *leverance* — er et
spørgsmål og ikke en kopiering.

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

**Kørt anden gang 5. august 2026.** Alle fem punkter er leveret og slettet:
`G58` (`anon` mister også sekvenserne, view-filerne re-granter ikke, og tre
heartbeat-kontroller aflæser tilstanden), `G59` (`round_standings` pagineres),
`G62` (karriereprofilens tre globale komplethedsjoin er afgrænset til officielle
turneringer), `G63` (brugernavnets unikhed og opslag har fået en versioneret
migrering) og `G66` (auth-opslaget har en tidsgrænse).

*Første kørsel var 3. august 2026 (`G52`, `G11` + `G32`, `G4` og `G50`); tieret
blev fyldt igen samme aften og er nu tømt igen — samme mønster som Tier 2.*

**To af de fem viste sig at være noget andet, end rækken sagde — og begge gange
mindre farlige og mere principielle.** `G58`(a) lød som "hver ny tabel fødes
åben"; men `alter default privileges FOR ROLE x` gælder kun objekter, der
oprettes **af** rolle x, og alt, vi selv opretter, ejes af `postgres` — hvis
defaults #34 lukkede. Det, der reelt stod tilbage, var sekvenserne, fordi ordet
"tables" stod tre steder i #34s formulering. Og `G63`s hul var ikke, at
garantien manglede, men at den kun fandtes i et **genereret** øjebliksbillede.
Begge er nu dækket af en test i CI, hvilket er den egentlige leverance: en
lunte, der er slukket, kan tændes igen, mens en test bliver ved med at spørge.

*Begrundelserne for begge kørsler står i [`DECISIONS.md`](./DECISIONS.md) og
[`CHANGELOG.md`](./CHANGELOG.md) — herunder `G50`s pointe om, at bredden var en
**regel** og ikke en liste, som `G58` er anden halvdel af.*

### Tier 5 — Robusthed og vedligehold

**Kørt anden gang 5. august 2026.** `G60` (deadline-nøglen regner i dansk tid),
`G68` (`rnk` bruger opgørets tiebreak) og `G2` (lukket som et **nej**) er
leveret og slettet. `G1` skrumpede.

*Første kørsel var 3. august 2026: `G42`, `B16`, `G13` og `G7`, hvor `G7` også
blev lukket som et nej.*

**`G2`s præmis holdt ikke, og dét afgjorde sagen.** Rækken sagde, at de syv
advarsler var ÉT mønster — "hent data i en effekt og sæt state" — som kun kunne
fjernes med et data-bibliotek, projektet bevidst har fravalgt. Gennemgangen
viste tre af den slags. De fire andre er en afledt default, en engangs-gate på
indlæst tilstand og to synkroniseringer af et rundeindeks. **Et data-bibliotek
ville altså kun have fjernet tre af syv** — så den store beslutning, rækken
ventede på, kunne ikke have løst problemet. De fire kan skrives om enkeltvis,
men ingen af dem er en fejl, og skærmene har ingen interaktionstests. Loftet
bliver stående på 7, og vilkåret står i `DOCUMENTATION.md` §12 sammen med den
fælde, den næste ville falde i.

| # | Hvad står tilbage | Hvorfor det ikke bare er mere af det samme |
|---|---|---|
| `G1` | `MainApp` (~582), `HjemTab` (~530), `ProfileScreen` (~460), `CreateCompetitionScreen` (~444), `AdminScreen` (~329) | **`MainApp`s invitations-flows er ude** (5. august 2026): de lå som ~100 linjer i to `useEffect` og har nu elleve tests i `src/lib/data/invites.js`. Gevinsten var ikke linjetallet (618 → 582), men at flowene kunne testes overhovedet — og det var netop den omkostning, `A23` stod og bar. Resten af `MainApp` **er** navigations-tilstandsmaskinen, altså `A23`s emne, og bør ikke røres før den beslutning. De fire andre filer er uafhængige af `A23` og kan tages hver for sig. |

### Tier 6 — Venter på en udløser

Står ikke her, fordi de er små, men fordi rækkefølgen ikke er vores at vælge.
Røres kun, når udløseren i deres `Afgøres`-felt indtræffer.

| # | Hvad | Udløser |
|---|---|---|
| `A25` | Lukket konto som deltager i ikke-startede konkurrencer | Første rigtige kontolukning — synlig, når `I16` er talt. |
| `A26` | `ambiguousTeams`: godkendte par eller accepteret støj | Turnering #3. |
| `A27` | Skal `competitions.rules` droppes? | Når produktet svarer på, om point skal kunne variere pr. konkurrence. Et `drop column` er uigenkaldeligt, og kolonnen koster kun plads, mens spørgsmålet står åbent. |
| `B18` | Staging-projektet i Supabase | Første gang en ændring skal prøves af mod data, der ikke er brugernes — eller første gang nogen taster et forkert resultat ind på en preview. Indtil da holder §11's advarsel det i skak i hånden. |
| `A23` | Skal appen have en router? | Når tilbage-knappen koster brugere, eller `I12` kræver delbare interne URL'er. |
| `A14` | Fuld Prettier-gennemformatering | Næste gang der alligevel røres bredt i frontenden — ellers aldrig. |
| `I15` | Weekly Mix-automatikken | `B12`s opslag (Tier 1) siger, om Ugens kupon-kortet overhovedet bruges. Bruges det ikke, er automatikken besvaret. |
| `I2` | Diagnose-historik | Kræver et sted at gemme snapshottet — første gang Analytics ville have brug for en tidsserie-tabel. |
| `I3` | Alarm ved tilstandsskifte i en liga | Afhænger af `I2`. |

### Tier 7 — Udadvendt og ubesluttet

Vækst, ikke fastholdelse. Produktbogens kapitel 3 sætter dem bevidst efter alt
ovenstående, og de står i rækkefølge efter, hvad der gater hvad, ikke efter
værdi. **Én undtagelse fra "ingen af dem er besluttet":** `B21` er besluttet i
princippet — produktet hedder Leagly, og repoet gør ikke — og venter kun på
`I10`, fordi det er den samme flytning.

| # | Hvad | Bemærkning |
|---|---|---|
| `I8` | Professionel hjemmeside | **Første udkast leveret i `site/` (3. august 2026, [`features/hjemmeside-v1.md`](./features/hjemmeside-v1.md)) — ikke publiceret.** Tilbage står ejer-godkendelse af copy, kontakt-mail, domæne og publicering. Gater fortsat `I9` og `I10`, men de har nu noget konkret at hænge på. |
| `I10` | Domæne og professionel e-mail | Forudsætning for troværdighed i invitationer og kontakt. Bærer nu også hjemmesidens kontakt-adresse, som ellers havde fået sin egen række — det er samme spørgsmål, stillet ét sted mere. |
| `B21` | Omdøb repo og Vercel-projekt, ret hjemmesidens 23 links | Direkte efter `I10`, fordi det er **samme** flytning: vælges et domæne, skal linkene alligevel skiftes, og gøres de to ting hver for sig, skiftes de tyve links to gange. |
| `I9` | SEO | Der er ingen side at optimere, før `I8` findes. |
| `I17` | Socialt delebillede (`og:image`) til hjemmesiden | Hører til `I9`s runde og ikke før: begge er metadata på en side, der ikke er publiceret, og begge skal alligevel have den endelige adresse i hånden. |
| `I7` | Finpuds invitationsflowet | Det eneste punkt i tieret, der virker på **eksisterende** brugere — kunne argumenteres op i Tier 3, hvis vækst bliver målet. |
| `B20` | Personlige invite-links (attribution) | Under `I7`, fordi det er den mekanik, en gennemgang af invitationsflowet ville blotlægge — og over `I6`, som ikke kan måle en ambassadør uden den. **Tieret ét sted, hvor ventetid koster:** attributionen kan først tælle fra udrulningsdagen. |
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
| A27 | **Skal `competitions.rules` droppes?** | Efter `G3` (3. august 2026) har kolonnen **ingen læsere overhovedet** — hverken i klienten, som holdt op med at skrive den, eller i SQL, hvor `pc_points()` altid har hardkodet 3/1. Den står altså tilbage som ren historik i hver eneste konkurrence-række. Men et `drop column` er uigenkaldeligt, og spørgsmålet bagved er et **produktspørgsmål og ikke en oprydning**: skal point nogensinde kunne variere pr. konkurrence? Siges ja, er kolonnen den halve implementering af noget, der skal bruges igen; siges nej, er den støj, der får den næste læser til at lede efter en konfigurerbarhed, som ikke findes — præcis den omkostning, `G3` blev kørt for at fjerne. Prisen ved at lade den stå er lav og løbende; prisen ved at fjerne den forkert er, at en fremtidig pointvariation skal bygge sit skema forfra. | Når produktet svarer på, om point skal kunne variere pr. konkurrence — ikke før. Indtil da koster kolonnen kun plads. |
| A26 | **`ambiguousTeams`: godkendte par eller accepteret støj?** | Feltet i sync-resuméet er bygget på egenskaben *"kun til stede, når der ER noget at kigge på"* — og den holder ikke længere for Scotland: `Dundee` ligger inde i `Dundee United`, begge klubber bliver i Premiership, og feltet er derfor permanent tændt med et par, der allerede er afgjort som en ægte navnelighed (2. august 2026, [`features/turnering-2.md`](./features/turnering-2.md)). Et felt, der altid er der, holder man op med at læse — og så er kontrollen reelt væk, netop når turnering #8 tilføjer et par, ingen har set før. To veje: en liste over **godkendte** par (`Dundee`/`Dundee United`), så feltet igen kun melder det nye, eller en accept af, at dette ene felt læses med et kendt par i baghovedet. Den første koster en liste, der skal vedligeholdes pr. turnering; den anden koster kontrollens troværdighed. | Ved turnering #3 — det er dér, det viser sig, om det ene par er en undtagelse eller et mønster. |

## Ubygget

| # | Hvad | Hvorfor / hvad den venter på | Omfang |
|---|---|---|---|
| B21 | **Omdøb GitHub-repoet og Vercel-projektet, og ret hjemmesidens links** | Navneskiftet 4. august 2026 gik gennem app, manifest, ikoner, tekster og dokumentation, men stoppede ved projektnavnene — **med vilje**, fordi et skifte af Vercel-projektet ændrer `.vercel.app`-adressen og dermed knækker hvert link, der peger på den. Prisen ved status quo er, at produktet hedder Leagly overalt undtagen i den adresse, en ny bruger faktisk taster ind: 23 CTA'er i `site/` (4+5+6+4+4) plus README'ens live-link peger på `prediction-champ.vercel.app`. **Rækkefølgen er bindende og er hele grunden til, at rækken står lige efter `I10`:** vælges et rigtigt domæne, skal linkene alligevel skiftes, og gøres omdøbningen først, skiftes de to gange. Vercels gamle URL redirigerer ikke af sig selv, så et delt link fra før skiftet dør — det er kun ufarligt, så længe hjemmesiden ikke er publiceret. `docs/RESTORE.md`s omtale skal IKKE rettes: den navngiver backup-filer, der faktisk hedder det gamle. | Lille (men mange steder) |
| B20 | **Personlige invite-links** (`invite_links` + `invited_by` på `group_members`/`competition_participants`) | Attributionen "hvem inviterede hvem" findes ikke i skemaet: `groups.invite_code` er én kode pr. liga og ikke pr. bruger, og ingen af medlemstabellerne gemmer afsenderen. Det er derfor, milepælen **"5/10 venner tilmeldt via dit link" ikke kunne bygges** — `milestones` tæller i stedet `LEAGUE_GREW_5/10`, altså hvor mange der kom med i en liga, man har oprettet, hvilket er en anden bedrift. Begrundelsen står ved koden begge steder (`sql/milestones.sql`, `src/lib/milestones.js`) og peger på denne række. **Ventetid er ikke gratis her, og det er rækkens vigtigste egenskab:** attribution kan kun registreres fremad, så en bedrift bygget på den kan først tælle fra udrulningsdagen — de brugere, der allerede er inviteret, tælles aldrig. Gater desuden `I6` (ambassadørprogram), som ikke kan måle noget uden. | Mellem |
| B18 | **Staging-projektet i Supabase** | Preview og produktion deler database, medmindre staging-variablerne peger et andet sted (`DOCUMENTATION.md` §9). Selve projektet skal oprettes manuelt, og `sql/schema.sql` genskaber hele `public` på én gang, så opsætningen er kort. **Rækken findes, fordi opgaven mistede sin tracker:** den blev fulgt som `G4`, men `G4` blev leveret som noget andet — dev-serverens hårde krav om `.env.local` — og forsvandt derfor fra listen, mens selve staging-projektet aldrig blev oprettet. Prisen ved status quo er, at en preview-test skriver i brugernes rigtige data; det er dét, `DOCUMENTATION.md` §11's advarsel om ikke at taste resultater ind på en preview holder i skak i hånden. | Lille (opsætning) |
| B12 | **Mål, om "Anbefalet" på Sæson-kortet flytter fordelingen** | Mærket blev sat på i `A22` netop for at flytte, hvilken mode nye brugere vælger, men effekten er aldrig aflæst — og et anbefalings-mærke, der ikke virker, er værre end ingen, fordi det bruger den plads, der skulle guide. `competition_created` bærer allerede `metadata.mode`, så før/efter kan opgøres uden ny instrumentering. Samme opslag svarer på `I15`s åbne spørgsmål om, hvorvidt Ugens kupon-kortet bruges. **Forespørgslen er skrevet (august 2026)** — den står klar til at køre i [`features/analytics-v1.md`](./features/analytics-v1.md) §5F sammen med de tre forbehold, svaret skal læses med (lille datamængde, lossy hændelseslog, og at kort-rækkefølgen blev vendt samme dag som mærkatet kom på). Tilbage står at køre den. | Lille (opslag) |

## Teknisk gæld

| # | Gæld | Hvorfor den betyder noget | Omfang |
|---|---|---|---|
| G1 | **De resterende store skærmfiler** — `MainApp.jsx` ~582 linjer, `HjemTab.jsx` ~530, `ProfileScreen.jsx` ~460, `CreateCompetitionScreen.jsx` ~444, `AdminScreen.jsx` ~329. | Anden halvdel af fil-opdelingen fra 30. juli 2026. **Tre er delt (3. august):** `ChampionshipTab` 512 → 272 og `ProfileScreen` 614 → 460 — rene flytninger, hvor testene nu importerer fra modulerne frem for gennem skærmen. **`MainApp`s invitations-flows er udskilt 5. august 2026** til `src/lib/data/invites.js` med elleve tests. Linjetallet faldt kun 618 → 582, og dét er pointen: gevinsten var, at de to flows kunne testes overhovedet. De lå i to `useEffect`, altså uden for rækkevidde af en testopsætning uden jsdom — og `A23` står åben netop med den begrundelse, at ingen test dækker dem. **Det, der er tilbage i `MainApp`, ER navigations-tilstandsmaskinen** (`A23`s emne) plus render-træet, og bør vente på den beslutning. De fire andre filer er uafhængige og kan tages hver for sig. | Mellem |
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
| I8 | **Professionel hjemmeside** (4–6 sider: forside, hvordan virker det, features, om os, kontakt, download app) | Giver troværdighed, kan deles og vises til virksomheder/brugere, og gør produktet indekserbart for Google. | Første udkast i `site/` (3. august 2026, [`features/hjemmeside-v1.md`](./features/hjemmeside-v1.md)) — mangler ejer-godkendelse, kontakt-mail, domæne og publicering |
| I9 | **SEO for hjemmesiden** | Afhænger af `I8` — der er ingen side at optimere, før den findes. | Afhænger af I8 |
| I10 | **Domæne og professionel e-mail** | Forudsætning for troværdighed udadtil (hjemmeside, invitationer, kontakt) — hænger sammen med `I8`. **Kontakt-adressen er den halvdel, der allerede har tre aftagere (august 2026):** `site/om.html` viser pladsholderen `kontakt@leagly.example`, og privatlivspolitikken lover en adresse, der "virker også, hvis du ikke kan logge ind", mens `src/lib/legal.js` stadig står med `[KONTAKT-E-MAIL]` og `[NAVN]` (tjeklisten i `DOCUMENTATION.md` §11). Det er ét valg, der lukker alle tre — og indtil det er truffet, kan hverken hjemmesiden eller teksten regnes som offentliggjort. | Afhænger af I8 |
| I11 | **LinkedIn-side**, hvis der satses på indtægt via virksomheder | Betinget af en B2B-retning, der ikke er besluttet endnu. | Betinget af B2B-retning |
| I12 | **Offentlig side pr. liga** (fx `predictionhub.app/league/padel-legends`: antal sæsoner, medlemmer, mestre, statistik — ikke tips, kun historik) | Bygger videre på liga-laget (§18) som en delbar, offentlig facade for hver liga. Kræver stillingtagen til, hvad der må vises uden login. | Ny |
| I15 | **Weekly Mix** — automatikken: et job, der opretter ugens kupon af sig selv | **Indholdet er leveret 1. august 2026 (A22):** opret-galleriet har et "Ugens kupon"-kort — `random`, én runde frem, alle turneringer, navnet genereret — så en bruger leverer kuponen manuelt med to tryk. **Tilbage står KUN gentagelsen**, og dens to ubesluttede punkter: (1) **hvem skriver?** — enhver konkurrence skrives i dag af sin egen opretter, og RLS kræver `created_by = auth.uid()`, så et ugentligt job skal køre som `service_role` (mønsteret findes nu: `award_competition_periods()` tillader allerede `service_role`); (2) **"mest interessante kampe"** — der findes hverken odds eller tabelstilling i basen, så et automatisk udvalg bliver heuristik, hvilket støder på kap. 1's *"odds og avanceret analyse må aldrig overskygge det sociale formål"* — den leverede kupon undgår spørgsmålet ved at trække tilfældigt. Weekly Mix ville desuden være et **andet** ugentligt begreb ved siden af den globale spillerunde (som **er** produktets ugentlige tvær-turneringsbegreb) — det er dét, der skal begrundes. | Afventer efterspørgsel — mål først om Ugens kupon-kortet bruges (`competition_created` bærer `metadata.mode`) |
| I17 | **Socialt delebillede til hjemmesiden** (`og:image` + `og:title`/`og:description`) | Hjemmesiden har **ingen** `og:`- eller `twitter:`-tags overhovedet, så et link delt i en besked, en gruppechat eller på LinkedIn vises som en nøgen URL — netop dér, hvor `I8`s formål (opret eller join en liga) skulle bære. Billedet, der mangler, findes allerede: `public/leagly-wordmark-navy.png` (34 kB) er uden en eneste aftager i koden, altså en fil, der kun overlevede navneskiftet. Koster ingen ny afhængighed og intet build-trin — fem `<meta>`-linjer og en kopi af filen — men kræver den endelige adresse, fordi `og:image` skal være absolut. | Ny — hører til `I9`s runde |
| I16 | **Tælling af lukkede konti** | `B4` gav kontolukning, men ingen måde at se, om nogen bruger den. Tallet findes allerede som data — `profiles.anonymized_at is not null` — så det er et opslag, ikke en instrumentering, og det er den billige halvdel. Den dyre halvdel er, hvad man gør med det: en analytics-hændelse ville kræve at udvide kataloget i `sql/analytics_events.sql` OG **logge om en person, der netop har bedt om at forsvinde** — og selv en aggregeret optælling er en måling af en handling, hvis hele pointe er at efterlade færrest mulige spor. En ren tælling på et felt, der i forvejen står i basen, tilføjer intet nyt spor; en hændelse gør. Gater desuden `A25`, som mangler en udløser. | Ny — afgrænses til tællingen, ikke en hændelse |

## Forkastede ideer

Ideer, der er overvejet og fravalgt. Står her, fordi de ikke arkiveres andre
steder — og fordi en forkastet idé ellers bliver foreslået igen.

| Dato | Idé | Hvorfor ikke |
|---|---|---|
| 4. august 2026 | **Give `manifest.json` et `short_name`, der er kortere end `name`** — i dag er begge "Leagly". | `short_name` findes for at have et alternativ, når `name` er for langt til pladsen under et ikon. "Leagly" er seks tegn og bliver ikke afkortet nogen steder, så et kortere alternativ ville ikke være en forbedring, men et **andet navn** for det samme produkt — og navneskiftet 4. august 2026 blev netop kørt i ét hug for at sikre, at kun ét navn figurerer. To identiske værdier er det rigtige svar her og skal ikke læses som et udfyldningsfelt, nogen glemte. Bliver navnet nogensinde længere, opstår spørgsmålet af sig selv. |

---

*Levende dokument. Fravalgt scope for allerede leverede features står i den
enkelte spec under "Bevidst ikke med i v1" — det er en historisk
scope-beslutning, ikke en to-do. Bliver et af de punkter en reel kandidat, får
det en `B`-række her.*
