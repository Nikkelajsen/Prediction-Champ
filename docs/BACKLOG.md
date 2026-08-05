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
ROADMAP (næste ledige: **A34**; `A32`–`A33` blev brugt 5. august 2026) — `A11` er fx også navnet på en logadvarsel i
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

*Ryddet 5. august 2026: de ti linjer blev til `A32`–`A33` og `G70`–`G76`.
**Én blev rettet med det samme frem for at få et ID:** bruger-flag-tællingen i
`DOCUMENTATION.md` §13 og §20. Selve arbejdet var at tælle efter — der er ti
navne i `LOKALE_NØGLER`, hvoraf ni er bruger-bundne — og da tællingen var lavet,
var rettelsen to ord og en manglende nøgle (`pc_comp_done_seen`) i §20's
opremsning. Samme afgørelse som `...font`-linjen 2. august. **Ingen blev
forkastet**, og ingen blev foldet sammen: `G70`–`G76` deler ikke rettelse, selv
om `G71`s test ville have fanget netop den drift, der lige er rettet.
**Runden har en kilde, ingen tidligere runde har haft:** alle ti linjer kom af
at **køre** noget — fem aflæsninger, hvoraf tre ikke kunne svare på det, de blev
skrevet til. De fjorten fra 3. august kom af at læse dokumentationen op mod
koden; disse kom af at spørge produktionen. Det er den dyreste måde at finde
dem på og den eneste, der kunne have fundet dem: `G72` og `G76` er begge kode,
der aldrig har kørt, og det kan ingen gennemlæsning se.*

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

Alle 31 åbne punkter i den rækkefølge, de bør tages — ikke efter ID og ikke efter
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

### Tier 1 — Produktionsadgang: svaret ligger uden for repoet ✅ tomt

**Kørt tom to gange 5. august 2026: fem oprindelige aflæsninger, plus de to,
kørslen selv efterlod.** Tieret dækker nu også svar, der ligger i cron-job.org og
ikke kun i Supabase; fællesnævneren er, at adgangen ikke findes i den maskine,
arbejdet laves i.

**Alle fem oprindelige aflæsninger er lavet.** Tieret har været "det
næste" i tre runder uden at kunne røres, fordi opslagene krævede en adgang,
arbejdsmaskinen ikke har. De blev samlet til ét paste og kørt af ejeren.

**To rækker er slettet:** `I16` (0 lukkede konti af 24) og `A11` (`header` for
alle ni jobs, nul `query` — fallbacken er fjernet af koden). **Tre er flyttet
til Tier 6**, fordi svaret viste, at spørgsmålet endnu ikke kan besvares: `G8`
(nul multi-turneringskonkurrencer), `B12` (1 oprettelse efter mærkatet) og `A5`
(nul delinger af 280 historier).

**Det er tieret selv, resultatet siger mest om.** Tre af de fem punkter blev
kaldt "aflæsninger", som om svaret lå og ventede — men to af opslagene kunne
ikke køre som skrevet, ét pegede på den forkerte kilde, og tre svarede med tal
for små til at bære den beslutning, rækken var skrevet for. **En formuleret
forespørgsel er ikke det samme som et svar, der findes.**

*Fyldt igen samme dag af de fund, kørslen selv efterlod (`G72`, `G75`) — og
tømt igen samme dag, fordi begge var ét opslag. **Begge svarede "ikke en fejl":**
`G72` gav 0 konkurrencer med `mode_params.awards`, så Story Engines to
kåringsregler er uafprøvede og ikke døde; `G75` blev aflæst på cron-job.org, hvor
skemaet ER hver 12. time — de fem jobs blev oprettet forkert 31. juli og er siden
rettet. **`G75` er den mest lærerige af hele dagen, fordi den var vores fejl og
ikke registrets:** et `count(*)` over fjorten dage er ét tal for hele perioden og
kan ikke skelne "har altid kørt forkert" fra "kørte forkert og blev rettet".
Udregningen var rigtig om vinduet og forkert om nutiden. Skal spørgsmålet stilles
igen, kræver det afstanden mellem nabokørsler (`lag(started_at) over …`), ikke et
gennemsnit. Samme aflæsning bekræftede alle syv minuttal, inklusive Scotlands 15,
som indtil da kun var udledt.*

### Tier 2 — Billige rettelser, hvor koden lyver

| # | Hvad | Hvorfor her |
|---|---|---|
| `G73` | Dagsreglernes `generated` måler noget andet end det, en bruger kunne se | Karusellen henter `round_key=eq.<nuværende>`, så et dagskort fra en passeret runde aldrig kan vises. 197 af 280 historier er dagskort med **nul** visninger, og deres visningsrate læses i dag som et adfærdssignal. Analytics påstår altså noget, den ikke måler. |

*Fyldt igen 5. august 2026 af `A5`-aflæsningen. Nedenfor står de to tidligere
kørsler.*

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

| # | Hvad | Hvorfor her |
|---|---|---|
| `G71` | Ingen test binder `LOKALE_NØGLER` til privatlivspolitikkens afsnit om lokale data | `G69` slap igennem præcis dér. **Testen er ikke et navne-match:** policyen beskriver nøglerne i almindeligt sprog ("om du har lukket kortet om notifikationer"), ikke ved navn, så koblingen kræver en eksplicit oversættelse i testen — ellers bygger nogen en naiv `toContain` og opgiver. |
| `G74` | SQL-blokke i `docs/` har ingen CI bag sig | `B12`s forespørgsel stod to døgn som "klar til at køre" og kunne ikke køre. En blok i et dokument er en **påstand**, indtil nogen kører den. `sql`-jobbet i CI har allerede en rigtig PostgreSQL — spørgsmålet er, om blokkene kan udtrækkes og syntakstjekkes billigt. |
| `G70` | `DECISIONS.md` mangler omkring tredive rækker fra ROADMAP'ens beslutningslog | Fundet af `G67`, som kun lukkede de fem, den navngav. Prisen ved status quo er ikke et opslag mere, men at man tror, beslutningen aldrig blev truffet, og genåbner den. **Udvælgelsen er arbejdet:** hvad er en *beslutning* og hvad er en *leverance*. |


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
| `A25` | Lukket konto som deltager i ikke-startede konkurrencer | Første rigtige kontolukning. **Talt 5. august 2026: 0 af 24.** Udløseren er dermed et tal, ikke en henvendelse — den er bare ikke sprunget endnu. |
| `A26` | `ambiguousTeams`: godkendte par eller accepteret støj | Turnering #3. |
| `G76` | `anonymize_my_account()` har aldrig kørt i produktion | `B18` (staging) — eller den første rigtige kontolukning. Funktionen er uigenkaldelig og blev skrevet forfra 4. august, så dens første kørsel må ikke være en bruger, der ikke kan fortryde. Samme form som `G8`, men med en dyrere fejl. |
| `A33` | Er dagsmotorens variation tyndere, end regelantallet lover? | Når dagskort faktisk bliver set — altså efter `G73`. `DAY_RESULT` alene er 123 af 280 historier (44 %), men ingen af dem er vist, så det er endnu ikke til at vide, om ensformigheden mærkes. |
| `A32` | Skal der findes en vej til read-only opslag uden ejeren? | Næste gang et tier blokeres af manglende produktionsadgang. Tier 1 blev sprunget over tre gange, og prisen var, at `B19` voksede fra to SQL-filer til fem imens. Et svar kan koste produktionstal i Actions-logs, og dét er afvejningen. |
| `A5` | Emojis i historie-kort: til eller fra? | **Når der findes en deling overhovedet.** Aflæst 5. august 2026: 280 historier, 21 af 21 brugere dækket — og **0 delinger**. Del-knappen er selve det, højdepunkt-tieret har og det dæmpede ikke, så uden en eneste deling kan signalet ikke måles. |
| `G8` | Multi-turnerings-`full_season` er stadig uafprøvet mod rigtige data | Den første konkurrence med `mode_params.tournaments` — aflæst tom igen 5. august 2026. |
| `A27` | Skal `competitions.rules` droppes? | Når produktet svarer på, om point skal kunne variere pr. konkurrence. Et `drop column` er uigenkaldeligt, og kolonnen koster kun plads, mens spørgsmålet står åbent. |
| `B18` | Staging-projektet i Supabase | Første gang en ændring skal prøves af mod data, der ikke er brugernes — eller første gang nogen taster et forkert resultat ind på en preview. Indtil da holder §11's advarsel det i skak i hånden. |
| `A23` | Skal appen have en router? | Når tilbage-knappen koster brugere, eller `I12` kræver delbare interne URL'er. |
| `A14` | Fuld Prettier-gennemformatering | Næste gang der alligevel røres bredt i frontenden — ellers aldrig. |
| `B12` | Mål, om "Anbefalet" flytter fordelingen | **Når `efter`-perioden har tosifret `antal`** i §5F-opslaget. Kørt 5. august 2026: 6 oprettelser før mærkatet, **1** efter — n=1 kan ikke måle en fordeling. Opslaget er rettet og klar til at gentages. |
| `I15` | Weekly Mix-automatikken | Reel efterspørgsel. **Udløseren er rettet 5. august 2026:** her stod, at `B12`s opslag ville sige, om Ugens kupon-kortet bruges. Det kan det ikke — `mode = 'random'` dækker både galleriets kort og en håndlavet Quick Pick, og de to kan ikke skelnes på `mode_params`. |
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
| A32 | **Skal der findes en vej til at køre read-only opslag i produktion uden ejeren?** | Tier 1 blev sprunget over tre gange i træk, fordi de fem aflæsninger krævede en Supabase-adgang, arbejdsmaskinen ikke har — og prisen var ikke kun ventetid: `B19` voksede fra to SQL-filer til fem imens, fordi hver leverance, der ikke kunne køres samme dag, gjorde den ene opgave, der ventede på ejeren, større. Køen har altså to betjeninger, og kun den ene arbejder. **Men et svar er ikke gratis:** den nærliggende mekanik er en GitHub Actions-workflow med `SUPABASE_DB_URL` (som `schema-export.yml` allerede har), og den ville lægge produktionstal — deltagertal, hændelser, i værste fald pseudonymer — i Actions-logs. Det er en beslutning om, hvor brugerdata må stå, og ikke en oprydning. Alternativet er at acceptere, at aflæsninger er ejerens arbejde, og i stedet gøre dem billigere at bestille (ét paste, som 5. august). | Næste gang et tier blokeres af manglende produktionsadgang. |
| A33 | **Er dagsmotorens variation tyndere, end regelantallet lover?** | Story Engine v2 lagde syv dagsregler til, men `DAY_RESULT` alene står for 123 af 280 historier (44 %), og de næste to (`DUEL` 35, `COLLECTIVE_MISS` 19) er tilsammen mindre end halvdelen af den. En motor, der er markedsført på bredde og leverer det samme kort hver anden gang, er en anden oplevelse end tabellen antyder. **Spørgsmålet kan ikke stilles endnu:** ingen af de 197 dagskort er nogensinde blevet vist (`G73`), så der findes ingen, der har oplevet ensformigheden. Måske er 44 % helt rigtigt — "dagens facit" er også den mest almindelige ting at fortælle om en kampdag. | Når dagskort faktisk bliver set, altså efter `G73`. |
| A5 | **Emojis i historie-kort: til eller fra?** | Gør kortet skimbart på mobil, men mindre klassisk. **v1-default: emojis til.** **Delvist besvaret (v1.1, juli 2026):** emoji er nu et *signal* — den findes kun i højdepunkt-tieret, mens dæmpede kort er uden. Spørgsmålet er dermed reduceret til, om højdepunkterne skal beholde deres. **Datamanglen er lukket (30. juli 2026):** Analytics-fanens sektion "Story Engine-regler" viser genereret/vist/delt/afvist pr. regel, så spørgsmålet kan afgøres på tal frem for fornemmelse. **Sidste forudsætning er væk (31. juli 2026):** `story_engine.sql` er gen-kørt i produktion (den tidligere `B3`), så v1.1's 14 regler genererer nu rigtige kort. Uret på "et par runder" starter her. | **Regelstatistikken er aflæst 5. august 2026, og den kan ikke afgøre spørgsmålet.** 280 historier, 21 af 21 brugere dækket — men **0 delinger** og kun 2 afvisninger i alt. Del-knappen er præcis det, højdepunkt-tieret har og det dæmpede ikke, så uden en eneste deling findes signalet ikke. Sammenligningen mangler desuden en nævner: det dæmpede tier har kun **6** historier (`Premiereugen` 3, `Stille runde` 3), fordi det per design kun genereres til brugere, der ellers ville stå uden kort. **Uret starter forfra ved den første deling** — ikke ved den næste runde. |
| A14 | **Skal hele kodebasen gennemformateres med Prettier?** | `npm run format` findes, men `format:check` er bevidst ikke et CI-trin. En fuld gennemformatering ville omskrive ~6.700 linjer ved `printWidth: 140` (~14.000 ved standard 80) på tværs af ~126 filer (86 uden testfiler; genmålt august 2026). Prisen er hele repoets `git blame`; gevinsten er konsistens i en kodebase med én forfatter og en i forvejen ensartet håndstil. Beslutningen er **udskudt, ikke truffet** — se [`DECISIONS.md`](./DECISIONS.md), 30. juli 2026. | Næste gang der alligevel røres bredt i frontenden — ellers aldrig. |
| A23 | **Skal appen have en router?** | Navigation er i dag to `useState` i `MainApp.jsx` (`tab` + `screen`), og deep links læses ved boot og strippes straks via `history.replaceState` (`App.jsx:104`, `MainApp.jsx:215,239`). Følgen er ingen tilbage-knap, ingen browser-historik og ingen delbare URL'er til interne skærme — mærkbart for en PWA, hvor telefonens tilbage-gestus forventes at virke. Men det er et arkitekturvalg, ikke en fejl: afhængighedsfattigheden er bevidst (fire runtime-deps, ingen router, `docs/reviews/2026-08-app-review.md` §7), og en router omskriver hele navigations-tilstandsmaskinen inkl. begge deep-link-join-flows, som ingen test dækker. | Når tilbage-knappen enten koster brugere (kan aflæses i analytics) eller en feature kræver ægte delbare interne URL'er — `I12`s offentlige ligaside er den første, der ville. |
| A25 | **Skal en lukket konto meldes af konkurrencer, der endnu ikke er begyndt?** | `B4` valgte den simple regel: alt bevares, fordi tips, rating og kåringer er *vennernes* stillinger og ikke kun den lukkedes egne. Den begrundelse holder for alt, der er spillet — men ikke for en konkurrence, hvor ingen kamp er låst endnu: dér findes der ingen historik at beskytte, og en framelding ville hverken omskrive noget eller bryde `group_membership_invariant`, som netop tillader framelding, når man ingen tips har på låste kampe. Prisen ved status quo er et pseudonym på deltagerlisten i en konkurrence, personen aldrig kommer til at spille — synligt for alle de andre deltagere hele sæsonen. | Når den første konto faktisk lukkes. **Antallet er talt 5. august 2026 (den tidligere `I16`): 0 lukkede konti ud af 24 profiler.** Udløseren er dermed et tal og ikke længere en henvendelse, man skal håbe på — den er bare ikke sprunget endnu, og spørgsmålet er derfor stadig hypotetisk. Tælles der igen, er det samme opslag: `select count(*) filter (where anonymized_at is not null) from profiles`. |
| A27 | **Skal `competitions.rules` droppes?** | Efter `G3` (3. august 2026) har kolonnen **ingen læsere overhovedet** — hverken i klienten, som holdt op med at skrive den, eller i SQL, hvor `pc_points()` altid har hardkodet 3/1. Den står altså tilbage som ren historik i hver eneste konkurrence-række. Men et `drop column` er uigenkaldeligt, og spørgsmålet bagved er et **produktspørgsmål og ikke en oprydning**: skal point nogensinde kunne variere pr. konkurrence? Siges ja, er kolonnen den halve implementering af noget, der skal bruges igen; siges nej, er den støj, der får den næste læser til at lede efter en konfigurerbarhed, som ikke findes — præcis den omkostning, `G3` blev kørt for at fjerne. Prisen ved at lade den stå er lav og løbende; prisen ved at fjerne den forkert er, at en fremtidig pointvariation skal bygge sit skema forfra. | Når produktet svarer på, om point skal kunne variere pr. konkurrence — ikke før. Indtil da koster kolonnen kun plads. |
| A26 | **`ambiguousTeams`: godkendte par eller accepteret støj?** | Feltet i sync-resuméet er bygget på egenskaben *"kun til stede, når der ER noget at kigge på"* — og den holder ikke længere for Scotland: `Dundee` ligger inde i `Dundee United`, begge klubber bliver i Premiership, og feltet er derfor permanent tændt med et par, der allerede er afgjort som en ægte navnelighed (2. august 2026, [`features/turnering-2.md`](./features/turnering-2.md)). Et felt, der altid er der, holder man op med at læse — og så er kontrollen reelt væk, netop når turnering #8 tilføjer et par, ingen har set før. To veje: en liste over **godkendte** par (`Dundee`/`Dundee United`), så feltet igen kun melder det nye, eller en accept af, at dette ene felt læses med et kendt par i baghovedet. Den første koster en liste, der skal vedligeholdes pr. turnering; den anden koster kontrollens troværdighed. | Ved turnering #3 — det er dér, det viser sig, om det ene par er en undtagelse eller et mønster. |

## Ubygget

| # | Hvad | Hvorfor / hvad den venter på | Omfang |
|---|---|---|---|
| B21 | **Omdøb GitHub-repoet og Vercel-projektet, og ret hjemmesidens links** | Navneskiftet 4. august 2026 gik gennem app, manifest, ikoner, tekster og dokumentation, men stoppede ved projektnavnene — **med vilje**, fordi et skifte af Vercel-projektet ændrer `.vercel.app`-adressen og dermed knækker hvert link, der peger på den. Prisen ved status quo er, at produktet hedder Leagly overalt undtagen i den adresse, en ny bruger faktisk taster ind: 23 CTA'er i `site/` (4+5+6+4+4) plus README'ens live-link peger på `prediction-champ.vercel.app`. **Rækkefølgen er bindende og er hele grunden til, at rækken står lige efter `I10`:** vælges et rigtigt domæne, skal linkene alligevel skiftes, og gøres omdøbningen først, skiftes de to gange. Vercels gamle URL redirigerer ikke af sig selv, så et delt link fra før skiftet dør — det er kun ufarligt, så længe hjemmesiden ikke er publiceret. `docs/RESTORE.md`s omtale skal IKKE rettes: den navngiver backup-filer, der faktisk hedder det gamle. | Lille (men mange steder) |
| B20 | **Personlige invite-links** (`invite_links` + `invited_by` på `group_members`/`competition_participants`) | Attributionen "hvem inviterede hvem" findes ikke i skemaet: `groups.invite_code` er én kode pr. liga og ikke pr. bruger, og ingen af medlemstabellerne gemmer afsenderen. Det er derfor, milepælen **"5/10 venner tilmeldt via dit link" ikke kunne bygges** — `milestones` tæller i stedet `LEAGUE_GREW_5/10`, altså hvor mange der kom med i en liga, man har oprettet, hvilket er en anden bedrift. Begrundelsen står ved koden begge steder (`sql/milestones.sql`, `src/lib/milestones.js`) og peger på denne række. **Ventetid er ikke gratis her, og det er rækkens vigtigste egenskab:** attribution kan kun registreres fremad, så en bedrift bygget på den kan først tælle fra udrulningsdagen — de brugere, der allerede er inviteret, tælles aldrig. Gater desuden `I6` (ambassadørprogram), som ikke kan måle noget uden. | Mellem |
| B18 | **Staging-projektet i Supabase** | Preview og produktion deler database, medmindre staging-variablerne peger et andet sted (`DOCUMENTATION.md` §9). Selve projektet skal oprettes manuelt, og `sql/schema.sql` genskaber hele `public` på én gang, så opsætningen er kort. **Rækken findes, fordi opgaven mistede sin tracker:** den blev fulgt som `G4`, men `G4` blev leveret som noget andet — dev-serverens hårde krav om `.env.local` — og forsvandt derfor fra listen, mens selve staging-projektet aldrig blev oprettet. Prisen ved status quo er, at en preview-test skriver i brugernes rigtige data; det er dét, `DOCUMENTATION.md` §11's advarsel om ikke at taste resultater ind på en preview holder i skak i hånden. | Lille (opsætning) |
| B12 | **Mål, om "Anbefalet" på Sæson-kortet flytter fordelingen** | Mærket blev sat på i `A22` netop for at flytte, hvilken mode nye brugere vælger, men effekten er aldrig aflæst — og et anbefalings-mærke, der ikke virker, er værre end ingen, fordi det bruger den plads, der skulle guide. `competition_created` bærer allerede `metadata.mode`, så før/efter kan opgøres uden ny instrumentering. Samme opslag svarer på `I15`s åbne spørgsmål om, hvorvidt Ugens kupon-kortet bruges. Forespørgslen står i [`features/analytics-v1.md`](./features/analytics-v1.md) §5F sammen med de tre forbehold, svaret skal læses med (lille datamængde, lossy hændelseslog, og at kort-rækkefølgen blev vendt samme dag som mærkatet kom på). **Rækken har stået siden august 2026 med teksten "tilbage står at køre den" — og da den blev kørt 5. august 2026, kunne den ikke:** vinduet partitionerede på `(e.created_at < m.fra)`, som hverken står i `group by` eller er aggregeret, så PostgreSQL afviste den med `42803`. Perioden udledes nu i en CTE, efterprøvet mod PostgreSQL 16.13. **Anden kørsel samme dag afslørede, at kilden var forkert valgt:** hændelsesloggen svarede med tre oprettelser i alt, alle `random` — plausibelt nok ved ~20 testbrugere, men ubrugeligt, fordi `analytics_events` først findes fra 30. juli 2026, så "før mærkatet" var to døgn og ikke appens historik. `competitions.mode` + `created_at` bærer samme oplysning som **rigtige rækker over hele historikken**, og spec'ens §5F er byttet om, så tabellen er den primære kilde og hændelsen kontrollen. **Opslaget er kørt 5. august 2026, og svaret er "ikke endnu":** hele appens historik rummer **syv** konkurrencer — 6 før mærkatet (`time_range` 2, `random` 2, `full_season` 2) og **1** efter (`random`). Med n=1 i den ene periode kan ingen fordeling måles, hvilket er præcis rækkens eget første forbehold. Rækken er derfor flyttet til Tier 6 med en udløser, der kan aflæses med samme opslag: **tosifret `antal` i `efter`-perioden.** Det, der er leveret, er ikke svaret, men at spørgsmålet nu kan stilles — forespørgslen kunne hverken køre eller pege på den rigtige kilde, da rækken blev skrevet. | Lille (opslag) |

## Teknisk gæld

| # | Gæld | Hvorfor den betyder noget | Omfang |
|---|---|---|---|
| G70 | **`DECISIONS.md` mangler omkring tredive rækker** fra ROADMAP'ens beslutningslog. | Fundet af `G67` (5. august 2026), som lukkede de fem rækker, den selv navngav, og efterlod resten. `CLAUDE.md` sender én til `DECISIONS.md` for at vide, *hvorfor* noget blev som det blev — og en beslutning, der ikke står der, ser ud som om den aldrig blev truffet. Prisen er derfor ikke et opslag mere, men en genåbnet diskussion. **Arbejdet er udvælgelsen og ikke kopieringen:** ROADMAP'ens log blander beslutninger (som hører til) med leverancer (som hører i `CHANGELOG.md`), og den skelnen skal træffes række for række. | Mellem |
| G71 | **Ingen test binder `LOKALE_NØGLER` til privatlivspolitikkens afsnit om lokale data.** | `G69` slap igennem præcis dér: `pc_pwa_onboarded` blev ryddet af `clearAllLocalState()` og opremset i guard-testen, men manglede sin linje i policyen — altså et løfte til brugeren, der ikke passede. `localFlags.js` siger selv, at navnene har tre aftagere, og at den tredje er `legal.js`; kun de to første har en test. **Testen er ikke et navne-match, og det er hele udfordringen:** policyen beskriver nøglerne i almindeligt sprog ("om du har lukket kortet om notifikationer"), fordi den skal kunne læses af et menneske. Koblingen kræver derfor en eksplicit oversættelsestabel i testen — ellers bygger den næste en naiv `toContain` og opgiver, når den ikke kan virke. | Lille |
| G73 | **Dagsreglernes `generated` måler noget andet end det, en bruger kunne se.** 197 af 280 historier er dagskort, og ingen af dem er nogensinde vist. | Karusellen henter `round_key=eq.<nuværende runde>` (`loadRoundCarousel`, `src/lib/data/activity.js`), så et dagskort, der hører til en passeret runde, kan aldrig nå skærmen — og v2's efterfyldning skrev netop sådanne kort. Det er ikke i sig selv forkert (gamle kort skal ikke dukke op), men Analytics' regeltabel stiller `viewed` op mod `generated` og læser forholdet som et adfærdssignal. For dagsreglerne er nævneren oppustet med kort, der aldrig var vis-bare, så tallet siger noget om efterfyldningen og ikke om brugerne. **Det gør netop den regelstatistik, `A5` skal afgøres på, misvisende for syv af treogtyve regler.** Enten skal nævneren afgrænses til kort, der kunne vises, eller også skal tabellen sige det højt. | Lille (analyse) / Mellem (rettelse) |
| G74 | **SQL-blokke i `docs/` har ingen CI bag sig.** | `B12`s §5F-forespørgsel stod fra august 2026 med teksten "forespørgslen er skrevet, tilbage står at køre den" — og da den blev kørt 5. august, afviste PostgreSQL den med `42803`. En SQL-blok i et dokument er en **påstand** om, hvad der ville virke, indtil nogen kører den, og backloggen prioriterede den som "et opslag, vi allerede har svaret på". Der findes allerede et `sql`-job i CI med en rigtig PostgreSQL, så spørgsmålet er ikke om det kan lade sig gøre, men om blokkene kan udtrækkes og syntakstjekkes uden at kræve produktionsskemaet — `prepare` mod et tomt skema fejler på ukendte tabeller, ikke kun på syntaks. | Mellem |
| G76 | **`anonymize_my_account()` har aldrig kørt i produktion.** | `I16`s tælling 5. august 2026 gav 0 lukkede konti ud af 24 profiler, og dét tal har en anden aflæsning end den, rækken blev talt for: funktionen bag kontolukning er **uafprøvet mod rigtige data**. Den blev skrevet forfra 4. august (`A28`–`A31`) og gen-kørt 5. august, den er uigenkaldelig, og dens første rigtige kørsel er en bruger, der har bedt om at forsvinde og ikke kan fortryde, hvis den fejler halvvejs. Samme form som `G8` — en kodesti, kun unit-tests har været nede ad — men med en dyrere fejl, fordi `G8`s værste udfald er en forkert stilling, og denne er en halvt slettet person. Vejen til at prøve den uden en rigtig bruger er `B18` (staging). | Lille (test) — men gated af `B18` |
| G1 | **De resterende store skærmfiler** — `MainApp.jsx` ~582 linjer, `HjemTab.jsx` ~530, `ProfileScreen.jsx` ~460, `CreateCompetitionScreen.jsx` ~444, `AdminScreen.jsx` ~329. | Anden halvdel af fil-opdelingen fra 30. juli 2026. **Tre er delt (3. august):** `ChampionshipTab` 512 → 272 og `ProfileScreen` 614 → 460 — rene flytninger, hvor testene nu importerer fra modulerne frem for gennem skærmen. **`MainApp`s invitations-flows er udskilt 5. august 2026** til `src/lib/data/invites.js` med elleve tests. Linjetallet faldt kun 618 → 582, og dét er pointen: gevinsten var, at de to flows kunne testes overhovedet. De lå i to `useEffect`, altså uden for rækkevidde af en testopsætning uden jsdom — og `A23` står åben netop med den begrundelse, at ingen test dækker dem. **Det, der er tilbage i `MainApp`, ER navigations-tilstandsmaskinen** (`A23`s emne) plus render-træet, og bør vente på den beslutning. De fire andre filer er uafhængige og kan tages hver for sig. | Mellem |
| G8 | **Multi-turnerings-`full_season` er uafprøvet mod rigtige data.** `mode_params.tournaments` har aldrig været skrevet i produktion (nul rækker, 31. juli 2026), så stien er kun dækket af unit-tests — både ved oprettelsen (`createCompetition` i `src/lib/data/competitions.js`) og i `coversSeason` i `api/_backfill.js`. | Ufarlig indtil den første multi-turneringskonkurrence oprettes; dét er tidspunktet at kigge efter. **`A16` (1. august 2026) skærper den lidt:** gennemgangen viste, at `random` og `custom` allerede i dag leverer det tvær-turnerings-scenarie, feltet skulle have leveret — så den *adfærd*, man ville teste, findes i produktion, mens netop denne kodesti stadig ikke gør. Fejler den, fejler den derfor tavst i et hjørne, ingen har haft brug for endnu. **`A22` (1. august 2026) udvider skriversiden:** Favorithold med flere hold skriver nu OGSÅ `mode_params.tournaments` (plus `team_ids`), så den første rigtige multi-konkurrence kan lige så vel blive en hold-konkurrence — uanset hvilken, efterses den i Admin → Drift, når den kommer. **Præmissen om, at rækken var faldet, holdt IKKE — opslaget er kørt 5. august 2026 og svarede tomt.** Formodningen var, at `B2`s testcase 3 (godkendt mod produktionsdata 2. august, [`features/turnering-2.md`](./features/turnering-2.md) §6) *er* præcis denne kodesti, og at godkendelsen derfor måtte have efterladt en række. Det gjorde den ikke: testcasen er klikket igennem, ikke gemt — en godkendt test og en skrevet række er to forskellige ting, og kun den ene kan aflæses bagefter. **Nul rækker rammer bredere end antaget:** `A22`s Favorithold med flere hold skriver også `mode_params.tournaments`, så tallet siger, at *ingen* af de to skrivere nogensinde har kørt i produktion. Stien er dermed fortsat kun dækket af unit-tests, og rækken er ikke længere et opslag, men en ventetid — den flyttes til Tier 6 med den første rigtige multi-turneringskonkurrence som udløser. Efterses i Admin → Drift, når den kommer. | Lille (eftersyn, når udløseren kommer) |

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
| I15 | **Weekly Mix** — automatikken: et job, der opretter ugens kupon af sig selv | **Indholdet er leveret 1. august 2026 (A22):** opret-galleriet har et "Ugens kupon"-kort — `random`, én runde frem, alle turneringer, navnet genereret — så en bruger leverer kuponen manuelt med to tryk. **Tilbage står KUN gentagelsen**, og dens to ubesluttede punkter: (1) **hvem skriver?** — enhver konkurrence skrives i dag af sin egen opretter, og RLS kræver `created_by = auth.uid()`, så et ugentligt job skal køre som `service_role` (mønsteret findes nu: `award_competition_periods()` tillader allerede `service_role`); (2) **"mest interessante kampe"** — der findes hverken odds eller tabelstilling i basen, så et automatisk udvalg bliver heuristik, hvilket støder på kap. 1's *"odds og avanceret analyse må aldrig overskygge det sociale formål"* — den leverede kupon undgår spørgsmålet ved at trække tilfældigt. Weekly Mix ville desuden være et **andet** ugentligt begreb ved siden af den globale spillerunde (som **er** produktets ugentlige tvær-turneringsbegreb) — det er dét, der skal begrundes. | Afventer efterspørgsel. **Målingen, der var betingelsen, viste sig ikke at kunne laves (5. august 2026):** `mode = 'random'` dækker både galleriets Ugens kupon-kort og en håndlavet Quick Pick, og `mode_params` skiller dem ikke — `rounds` skrives kun ved > 1 runde, hvilket begge kan have. Skal kortets brug måles, kræver det en ny hændelse eller et felt, altså instrumentering og ikke et opslag |
| I17 | **Socialt delebillede til hjemmesiden** (`og:image` + `og:title`/`og:description`) | Hjemmesiden har **ingen** `og:`- eller `twitter:`-tags overhovedet, så et link delt i en besked, en gruppechat eller på LinkedIn vises som en nøgen URL — netop dér, hvor `I8`s formål (opret eller join en liga) skulle bære. Billedet, der mangler, findes allerede: `public/leagly-wordmark-navy.png` (34 kB) er uden en eneste aftager i koden, altså en fil, der kun overlevede navneskiftet. Koster ingen ny afhængighed og intet build-trin — fem `<meta>`-linjer og en kopi af filen — men kræver den endelige adresse, fordi `og:image` skal være absolut. | Ny — hører til `I9`s runde |

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
