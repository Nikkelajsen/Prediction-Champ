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
ROADMAP (næste ledige: **A38**; `A35`, `B27`, `G78` og `I19` blev brugt 7. august 2026 til Story Engine v3, `A36` samt `G79`–`G84` samme dags indbakke-rydning, og `A37` 7. august aften ved prøvekørslen af kontolukningen) — `A11` er fx også navnet på en logadvarsel i
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

- `sql/tests/liga_admin.sql` og `sql/tests/account_anonymization.sql` bygger deres eget håndskrevne minischema — de kan derfor være grønne, mens funktionen fejler mod det rigtige. `sql/schema.sql` ligger i repoet og kan køres i CI's postgres-service (kun `\restrict`, `CREATE SCHEMA public`, `COMMENT ON SCHEMA` og de 12 `ALTER DEFAULT PRIVILEGES` skal ud, jf. `docs/STAGING.md` trin 2).

*Ryddet 7. august 2026 (aften): de otte linjer blev til `A36` og `G79`–`G84`.
**Én blev ikke til en række, fordi den var en sortering og ikke en opgave:**
`G76`s udløser er sprunget (staging findes siden 6. august), så rækken er flyttet
fra Tier 6 til Tier 1 — den venter ikke længere på noget, den venter på et
miljø. **Ingen blev forkastet, og ingen blev foldet sammen** — heller ikke de to,
der kommer af samme hændelse: `G81` (hvad sender football-data.org, når tiden
ikke er fastsat?) og `G84` (ville vi have opdaget det?) deler årsag, men ikke
rettelse, og det er sammenlægningsreglens eneste kriterium.
**Runden har en kilde, ingen tidligere runde har haft: at BRUGE det, vi har
bygget.** Fem af de otte kom af at køre noget igennem som en bruger — `G80`
opdages kun af den, der klikker "Hent nu" på `npm run dev`; `G82` og `G83` kun
af den, der spillede en syntetisk sæson igennem i staging; og `G81`/`G84` kom af
en fejl, der blev fundet, fordi nogen undrede sig over en sortering i appen. De
fjorten fra 3. august kom af at læse dokumentationen op mod koden, de ti fra
5. august af at spørge produktionen; disse kom af at gøre det, dokumentationen
beskriver. **`G83` er den eneste, hvor
indbakke-linjens præmis ikke holdt ved eftersyn:** de to funktioner skrives ikke
"KUN lazy fra klienten" — notifikations-jobbet har været den pålidelige skriver
siden `B11` (3. august) — men det, der er tilbage bagved, er større end linjen
sagde, fordi ratingen slet ikke har en bagstopper.*

*Ryddet 7. august 2026: én linje — `loadLatestStory` og viewet `latest_story`
uden aftagere — og den blev **ikke** til en række. Story Engine v3-beslutningen
gør den til en delmængde af `B27`: rundestoryen gør viewet relevant igen, så
spørgsmålet er ikke længere "hvorfor vedligeholder vi det?", men "genbruges det
eller slettes det bevidst?", og det svares inde i leverancen. Det er samme
afgørelse som kontakt-mailen 4. august, hvor en linje blev foldet ind i `I10`
frem for at få sit eget ID.*

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

Alle 40 åbne punkter i den rækkefølge, de bør tages — ikke efter ID og ikke efter
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

*5. august 2026 (femte runde): **Tier 2 og Tier 5 er kørt** — `G73`, `G71`,
`G74` og `G70`, og `G1` er skrumpet til `MainApp` alene og flyttet til Tier 6.
Listen er 31 → 28. **To ting ved runden er værd at bemærke.** For det første er
`G70` den første leverance, der gør ROADMAP'ens beslutningslog **tom**: 46
rækker fordelt frem for kopieret, og udvælgelsen — beslutning eller leverance —
var hele arbejdet. For det andet er `G74` bygget på det modsatte svar af det,
rækken lagde op til: den spurgte, om blokkene kunne tjekkes **uden**
produktionsskemaet, og svaret er nej, fordi `B12`s `42803` opstår i
parse-analysen og kræver, at serveren kender tabellerne. Det behøver den heller
ikke — `sql/schema.sql` ER skemaet, og det ligger i repoet. **Tier 1 blev fyldt
igen af leverancen selv** (`B23`: `analytics_dashboard.sql`), præcis som `B19`
blev det tidligere samme dag — en SQL-tung leverance uden produktionsadgang
lægger sin sidste halvdel i ejerens kø. **Men denne gang blev den kørt samme
dag, og `B23` er slettet igen**; køen med to betjeninger holdt trit for første
gang. Listen er dermed 31 → 27.*

*7. august 2026: **Story Engine v3 er besluttet, og listen er 30 → 34** — `B27`
(byg v3), `A35` (er tærsklen 45 rigtig?), `G78` (scoringstallene står to steder)
og `I19` (historik over gamle dagskort). **Tier 3 er fyldt igen for første gang
siden 3. august**, og `B27` er den eneste af de fire, der ikke venter på noget:
de tre andre kan først aflæses, når v3 kører. Det er den modsatte form af de
seneste runders vækst — de kom af at læse eller aflæse noget bestående, mens
disse fire er en beslutnings egen hale. **Én indbakke-linje er ryddet uden at
blive til en række:** `loadLatestStory`/`latest_story` uden aftagere er ikke et
selvstændigt spørgsmål længere, den er en delmængde af `B27`, fordi rundestoryen
gør viewet relevant igen.*

*7. august 2026 (eftermiddag): **v3 er bygget, og listen er 34 → 33.** `B27` er
slettet, og `loadLatestStory` er genbrugt frem for slettet — rundestoryen læser
viewet. De to andre rækker fra formiddagen har nu en opfyldt udløser: `A35` kan
måles, fordi `news_value` gemmes på hver eneste v3-række, og `G78` er blevet
konkret frem for hypotetisk, fordi tallene nu FAKTISK står to steder.
**Leverancen efterlod ingen nye rækker**, og det er værd at bemærke, for tre
ting afveg undervejs fra spec'en; alle tre blev løst inde i opgaven og noteret i
spec'ens §13 frem for skudt til hjørne. Den mest lærerige var spec §5's eget
regnestykke — 8 + 12 + 20 = 40 — som ikke holdt mod en implementering, der gav
`DAY_RESULT` hele størrelsesloftet: den ville nå 58 og kunne udgive sig selv som
dagens historie, og så ville der aldrig findes en dag under tærsklen at falde
tilbage til. **En enhedstest fandt det, ikke en gennemlæsning** — samme form som
`G72`s lære om kode, der aldrig har kørt.*

*7. august 2026 (aften): **indbakken er ryddet, og listen er 33 → 40** — `A36` og
`G79`–`G84`, plus `G76` flyttet fra Tier 6 til Tier 1. **Fire tomme tiers er
fyldt på én gang** (1, 2, 4 og 5), og det er første gang siden 3. august, at det
sker af andet end en dokumentations-gennemgang. **Fordelingen siger noget, tallet
ikke gør:** to af de syv (`G81`, `G76`) kan kun besvares uden for repoet, og
`A36` hænger på den ene af dem — altså tre punkter i den kø, der har to
betjeninger, og som `A32` handler om. **Tier 4 er den, der bør læses først:**
`G84` er en kontrol, der VILLE have fanget en fejl, brugerne allerede har mærket
(alle football-data-kampe uden klokkeslæt i fire døgn), og `G83` er en
gendannelsesvej, der efterlader ratingen forkert uden at sige det. De to er
tilsammen svaret på "hvad opdager vi ikke?", og det spørgsmål har ikke haft en
række på listen før i dag.*

*7. august 2026 (sent): **`G84` er leveret og slettet — 40 → 39.** Rækken var
under to timer gammel, og det er ikke en anbefaling om at haste; det er, hvad
der sker, når en række beskriver en fejl, der ALLEREDE er sket, frem for en, der
kunne. **Leverancen efterlod ingen ny række, men den flyttede en grænse:**
`sql/checks/` er en ny slags fil i repoet — ikke en migrering, ikke en test, men
en overvågnings-forespørgsel, der køres to steder og derfor kun må findes ét.
Modellen er værd at genbruge, næste gang en kontrol skal skrives: en temporær
view installerer intet i produktionen og kan alligevel efterprøves i CI.
**Det mest lærerige skete i testen og ikke i kontrollen.** Otte mutationer blev
prøvet mod den; syv blev fanget, og den ottende — "erstat 100 %-reglen med
mindst halvdelen" — slap igennem, fordi testens blandede tilfælde var 2 af 5 og
dermed lå under tærsklen. Testen påstod at bevise, at kontrollen ikke er en
andel, og beviste det ikke. Den er nu 4 af 5. **En test, man ikke har set fejle,
er en formodning** — samme lære som `G74`s blokke og `G72`s kode, der aldrig har
kørt, bare stillet mod testen selv.*

*7. august 2026 (nat): **Tier 1 er kørt for første gang siden 5. august — halvt.**
`G76`s databasehalvdel er prøvet af og var ren; `G81` kunne ikke røres, fordi den
kræver et token, ingen maskine i repoet har. **Listen er 39 → 40, og det er
leverancens vigtigste tal:** en kørsel, der lukker en halv række og åbner en hel
ny, har fundet mere, end den brugte. `A37` — en liga, hvis eneste administrator
har lukket sin konto, kan aldrig administreres igen — stod ingen steder, og den
kunne ikke stå nogen steder: den findes kun i mødet mellem tre ting, der hver
især er rigtige og dokumenterede (admin uddeles kun ved oprettelsen, der er ingen
forfremmelse, en lukket konto kan ikke logge ind). **Ingen af de tre er en fejl.
Fejlen er, at ingen havde ganget dem sammen.** Det er samme form som `G84`s
fordeling: hver enkelt række så rigtig ud, og kun helheden var forkert.
**Metoden er værd at genbruge og var billigere, end tieret antog.** Rækken hed
"kør den i staging", og staging var ikke nødvendig for den halvdel, der bar
risikoen: `sql/schema.sql` ER produktionsskemaet, det ligger i repoet, og en
lokal PostgreSQL kan køre det. Det er samme indsigt som `G74`s — at skemaet i
repoet kan svare på spørgsmål, man troede krævede en database — bare brugt på en
kørsel frem for på et tjek. **Det, der faktisk krævede staging, viste sig at være
den anden halvdel:** knappen, endpointet og `auth.users`. Tieret hedder stadig
det rigtige; rækken var bare to opgaver.*

Rækkefølgen følger fire regler, i den rækkefølge de slår hinanden:

1. **Et svar, vi allerede har, er gratis** — et opslag, der lukker eller
   skrumper en række, kommer før alt, der skal bygges.
2. **Kode, der lyver, koster mere end kode, der mangler** — en betingelse fra en
   verden, der ikke findes mere, koster den næste læser tid hver gang.
3. **Fastholdelse før vækst** (produktbogens kapitel 3) — brugerværdi før
   robusthed, robusthed før udadvendt.
4. **Det, der venter på en udløser, prioriteres ikke** — det står nederst, ikke
   fordi det er uvigtigt, men fordi rækkefølgen ikke er vores at vælge.

### Tier 1 — Produktionsadgang: svaret ligger uden for repoet

**Kørt 7. august 2026 (sent), for halvdelens vedkommende.** `G76` er prøvet af —
ikke i staging, men mod `sql/schema.sql` i en lokal PostgreSQL 16 under ægte
RLS, hvilket viste sig at være nok til det, rækken var bange for, og for lidt
til resten. `G81` kunne ikke røres: den kræver et token, ingen maskine i repoet
har. **Tieret er vokset fra to punkter til fire**, og det er ikke en fiasko —
det er, hvad der sker, når en kørsel faktisk finder noget: `A37` fandtes ikke
før prøvekørslen, og `A36` er rykket hertil, fordi dens udløser er sprunget og
den besvares billigst i det samme kig som `A37`s opslag. `A36` er dermed den ene
række i tieret, der ikke selv kræver en adgang, kun en beslutning.

| # | Hvad | Hvorfor her |
|---|---|---|
| `A37` | **Aflæs, om der allerede findes en liga uden en levende administrator** | Ét opslag, der installerer intet: `sql/checks/league_admin_coverage.sql` er en temporær view efter samme model som `G84`s kontrol, så den kan køres mod produktionen uden at efterlade noget. `levende_admins = 0` er en liga, ingen kan administrere igen — nogensinde. Opslaget afgør, om rækken er en fremtidig fælde eller en, der allerede er sprunget. |
| `A36` | **Skal en lukket konto også forlade LIGAEN?** | Den eneste række i tieret uden en adgangsbarriere: aflæsningen ER lavet (se `A37`-rækken i beslutningstabellen), og det, der mangler, er ejerens svar. Står her, fordi den deler kig med `A37` — man kigger på den samme medlemsliste, og de to svar hænger sammen. |
| `G76` | **Luk en testkonto fra APPEN mod staging** | Skrumpet 7. august 2026: databasehalvdelen er prøvet af og var ren (se rækken i gældstabellen). Tilbage står det, SQL ikke kan nå — knappen i Profil, `api/delete-account.js` og soft-sletningen i `auth.users` — altså præcis den kæde, hvis halve tilstand (`kun_anonymiseret`) er dokumenteret og aldrig set. |
| `G81` | **Aflæs, hvad football-data.org faktisk sender, når tiden ikke er fastsat** | Ét kald: `&dryRun=true` mod en football-data-liga med runder langt ude i fremtiden, og se på tidsfeltet. Kræver et deploy og et admin-token, altså ejeren. **Forudsætningen er efterprøvet 7. august 2026:** forhåndsvisningen bærer BEGGE rå felter uændret — `kickoff` er `m.utcDate` ordret og `state` er `m.status` ordret (`api/_providers/footballdata.js:90,102`) — så det ene kald svarer faktisk på spørgsmålet. Champions League er den rigtige at kalde: `/api/sync-matches?leagueId=<CL's id>&dryRun=true`, hvor slutspilsrunderne ligger måneder ude. |

*Alt nedenfor er historik: tieret er kørt tomt fire gange, alle fire 5. august 2026.*

**Kørt tom FJERDE gang 5. august 2026.** `B24` (gen-kør `sql/liga_admin.sql`)
blev oprettet og lukket samme dag, præcis som `B23` få timer før: `A25` var
merget og **inert** i databasen, indtil `_anonymize_account()` var gen-kørt, og
ejeren kørte filen. **To kørsler samme dag er heller ikke et svar på `A32`** —
men det er anden gang i træk, at køen holdt trit, og rækken er skrevet på det
modsatte mønster.

*Nedenfor står de tre tidligere kørsler.*

**Kørt tom tredje gang 5. august 2026.** `B23` (gen-kør
`sql/analytics_dashboard.sql`) blev oprettet og lukket samme dag: `G73` var
merget og **inert** i databasen, indtil RPC'en var gen-kørt, og ejeren kørte
den. Det er første gang, tieret ikke har været en flaskehals — `B19` voksede fra
to SQL-filer til fem, mens den ventede, og `A32` (en vej til read-only opslag
uden ejeren) er skrevet på præcis den erfaring. **Én kørsel samme dag er ikke et
svar på `A32`**, men den er datapunktet, spørgsmålet mangler: bliver det
mønstret, er rækken mindre værd, end den ser ud.

*Og de to før den.*

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

**Fyldt igen 7. august 2026** af ét punkt, og det er tierets reneste eksempel
til dato: fejlbeskeden er ikke upræcis, den er om noget helt andet end det, der
skete.

| # | Hvad | Hvorfor her |
|---|---|---|
| `G80` | **`/api/*` på `npm run dev` svarer HTML, og appen oversætter det til noget forkert** | Fem kaldesteder, tre forskellige løgne: rå `Unexpected token '/'`, "Kontoen kunne ikke lukkes" (den blev aldrig forsøgt), og en tom forhåndsvisning. Rettelsen er ét sted og deles af alle fem. |

*Nedenfor står de tre tidligere kørsler.*

**Kørt tredje gang 5. august 2026.** `G73` er leveret og slettet:
`admin_analytics_stories` tæller nu `viewable` — kort skrevet, mens deres egen
runde stadig var den nuværende — og bruger den som nævner under BÅDE visnings- og
afvisningsraten. `generated` står uændret ved siden af, og forskellen mellem de to
tal er selv oplysningen; derfor er "Vis-bar" også en synlig kolonne og ikke kun en
nævner. **Rækken pegede på dagsreglerne, men fejlen var bredere:** definitionen
(skrevet før rundens slutning) fanger også et runde-kort, hvis runde først blev
spillet færdig efter den var forbi — en udsat kamp — og dét kan ske igen, mens
efterfyldningen var en engangsudgift. **`analytics_dashboard.sql` er gen-kørt af
ejeren samme dag** (den tidligere `B23`), så rettelsen er levende i databasen og
ikke kun i koden.

*Fyldt igen 5. august 2026 af `A5`-aflæsningen — og tømt samme dag. Nedenfor står
de to tidligere kørsler.*

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

### Tier 3 — Brugerværdi oven på noget, der allerede findes

**Tomt igen 7. august 2026.** Tieret blev fyldt af Story Engine v3-beslutningen
om formiddagen og tømt af leverancen samme dag — `B27` var den eneste række på
hele listen, der hverken ventede på en udløser eller på en produktionsadgang,
og den er nu bygget. Leverancen efterlod ingen ny række her: de to ting, den
udskød (`A35` og `G78`), venter begge på drift og hører til deres egne tiers.

*Nedenfor står de tidligere kørsler.*

**Kørt 3. august 2026.** Alle fire punkter er leveret og slettet: `B10` og `B11`
som én leverance (Story Engine v1.2's to kåringsregler + push, hvor
notifikations-jobbet blev den pålidelige skriver af kåringerne), `B9` (ny
turnering) og `I5` (deling).

`I5` viste sig at være **halvt leveret i forvejen**, og rækken sagde noget
forkert: historie-kortet på Hjem har haft en Del-knap siden v1.1. Det, der
manglede, var arkivet — karriereprofilens milepæle, altså netop dét sted, man
kigger, når kortet er væk fra Hjem igen.

### Tier 4 — Datarisiko med en lunte

**`G84` er leveret og slettet samme dag, den blev oprettet (7. august 2026).**
Heartbeat'en aflæser nu `kickoff_tbd` pr. turnering og slår alarm, når **alle**
en turnerings kampe inden for ti dage står uden klokkeslæt. **Leverancen blev
større end rækken sagde, og på ét bestemt punkt:** rækken bad om "én forespørgsel
+ ét tjek", men en kontrol er kode, der per definition næsten aldrig udløser —
den ville være tavs på nøjagtig samme måde, hvad enten den virkede eller ej.
Forespørgslen bor derfor i `sql/checks/` som en **temporær** view, der læses af
BÅDE heartbeat'en mod produktion og af en CI-test mod en tom database, og testen
er selv efterprøvet ved at mutere kontrollen otte gange og se den fange hver
enkelt. Den ottende mutation slap igennem første gang og afslørede en for svag
test — det blandede tilfælde var 2 af 5 og skelnede ikke mod en 50 %-tærskel.

| # | Hvad | Hvorfor her |
|---|---|---|
| `G83` | **Der findes ingen samlet genberegning af afledte rækker** | `RESTORE.md`s delvise gendannelse foreskriver `--disable-triggers` og siger så ikke, hvad man gør bagefter. Ratingen har ingen bagstopper i cron — den ville stå forkert, indtil nogen tilfældigvis rettede et resultat. |

*Nedenfor står de to tidligere kørsler.*

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

**Fyldt igen 7. august 2026.** De to punkter deler en egenskab, der er værd at
sige højt: begge handler om **kontroller, vi allerede har bygget**, og ikke om
kode, der mangler. `G79` er prisen for `G74`s eget forbehold, og `G82` er den
manuelle efterprøvning, `simulate_season.sql` blev leveret med — den slags, der
er gratis den første gang og dyrere for hver ændring.

| # | Hvad | Hvorfor her |
|---|---|---|
| `G79` | **Docs-SQL-tjekket arver `schema.sql`s forbehold, og fejlen ligner en anden fejl** | Står allerede skrevet i `docs_sql.mjs`' hoved som et vilkår. Det, der mangler, er, at KØRSLEN siger det — en rød blok skal kunne skelnes fra en manglende eksport. |
| `G82` | **Sæson-simulatoren har ingen CI-dækning** | 1.069 linjer SQL, efterprøvet i hånden mod en lokal PG16. `sql`-jobbet har allerede mønstret (opret database, kør fil, påstå tal), så prisen er ét trin — men det er også det tungeste trin, jobbet ville have. |

*Nedenfor står de tre tidligere kørsler.*

**Kørt tredje gang 5. august 2026.** `G71`, `G74` og `G70` er leveret og
slettet, og `G1` er skrumpet til `MainApp` alene og **flyttet til Tier 6** med
`A23` som udløser — den sidste fil er navigations-tilstandsmaskinen, og
rækkefølgen er dermed ikke længere vores at vælge.

**`G71` fandt en nøgle, ingen vidste manglede.** Testen kræver en
oversættelsestabel (`NØGLENS_LØFTE` i `legal.test.js`), fordi politikken
beskriver nøglerne i almindeligt sprog — og første gang den kørte, faldt
`pc_onboarding_v1_card` igennem: "Kom godt i gang"-checklisten var ikke nævnt.
Politikken har fået sin sætning; datoen står stille, som ved `G69`, fordi
behandlingen er uændret. **Testen fejler i begge retninger**, så en nøgle, der
FJERNES fra koden, heller ikke efterlader en sætning om noget, appen ikke gemmer.

**`G74` blev leveret på det modsatte svar af det, rækken lagde op til.** Den
spurgte, om blokkene kunne tjekkes "uden at kræve produktionsskemaet". Det kan
de ikke, og det er hele pointen: `B12`s `42803` opstår i **parse-analysen** og
kræver, at serveren kender `competitions` og dens kolonner — et syntakstjek
ville have sagt god for den. Men de behøver det heller ikke, for `sql/schema.sql`
ER skemaet, og det ligger i repoet. Hver blok bygges nu om til et `prepare`
(ingen `execute`, ingen rækker røres), og en blok, der ikke er en hel sætning,
markeres ` ```sql uddrag ` — **opt-out og ikke opt-in**, så en ny forespørgsel er
dækket, fordi nogen skrev den, og ikke fordi nogen huskede en markør.

*Første kørsel var 3. august 2026 (`G42`, `B16`, `G13`, `G7`), anden 5. august
(`G60`, `G68`, `G2`). To af de ni er lukket som et **nej** — `G7` og `G2` — og
begge gange fordi rækkens præmis ikke holdt ved eftersyn.*

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

### Tier 6 — Venter på en udløser

Står ikke her, fordi de er små, men fordi rækkefølgen ikke er vores at vælge.
Røres kun, når udløseren i deres `Afgøres`-felt indtræffer.

| # | Hvad | Udløser |
|---|---|---|
| `A26` | `ambiguousTeams`: godkendte par eller accepteret støj | Turnering #3. |
| `B26` | E-mailbekræftelse + bot-værn (Turnstile) på signup | **Når linket deles åbent** (hjemmesiden publiceres eller invitationer går uden for det kontrollerede felt). Gated af `B25` — bekræftelsesmailen skal have en afsender, der kan levere. |
| `A34` | Supabase Free → Pro? | **Når Usage-siden viser egress nær 5 GB/md, eller når fremmede udgør flertallet af de aktive** — de to falder formentlig sammen omkring 200–500 ugentligt aktive. |
| `G77` | `analytics_events` vokser uden loft | **Når `A34`s månedlige Usage-aflæsning viser tabellen som største vækstdriver** — eller sammen med `A34`, hvis Free-planen skal strækkes. |
| `A33` | Er dagsmotorens variation tyndere, end regelantallet lover? | **Når vis-bare dagskort har visninger.** `G73` (5. august 2026) rettede MÅLINGEN og ikke synligheden: de 197 efterfyldte dagskort kan stadig ikke vises, de tælles bare ikke længere i nævneren. Fremadrettede dagskort skrives inde i deres egen runde og ER vis-bare, så udløseren kan nu aflæses direkte — vis-bar > 0 og vist > 0 for dagsreglerne i Analytics. `DAY_RESULT` alene er 123 af 280 historier (44 %). |
| `A35` | Er Story Engine v3's publiceringstærskel på 45 den rigtige? | **To uger med v3 i drift og mindst ti kampdage.** Bygget 7. august 2026, så uret er startet. Måles på `stories.news_value`, som gemmes på alle rækker — også de dæmpede — netop for at kunne svare bagudrettet. Mål: 40–60 % af kampdagene med ulæst-markering. |
| `G78` | v3's scoringstal står i både SQL og `src/lib/stories.js` | **Når v3's udvælgelse er valideret i drift** (altså tidligst sammen med `A35`). Kræver en migrering af eksisterende rækker og lå derfor bevidst uden for v3-leverancen. Indtil da holdes de to sider ærlige af påstande frem for af struktur: `sql/tests/story_engine_daily.sql` låser de præcise `news_value`-tal, og `src/lib/stories.test.js` gør det samme fra JS-siden. |
| `A32` | Skal der findes en vej til read-only opslag uden ejeren? | Næste gang et tier blokeres af manglende produktionsadgang. Tier 1 blev sprunget over tre gange, og prisen var, at `B19` voksede fra to SQL-filer til fem imens. Et svar kan koste produktionstal i Actions-logs, og dét er afvejningen. |
| `A5` | Emojis i historie-kort: til eller fra? | **Når der findes en deling overhovedet.** Aflæst 5. august 2026: 280 historier, 21 af 21 brugere dækket — og **0 delinger**. Del-knappen er selve det, højdepunkt-tieret har og det dæmpede ikke, så uden en eneste deling kan signalet ikke måles. |
| `G8` | Multi-turnerings-`full_season` er stadig uafprøvet mod rigtige data | Den første konkurrence med `mode_params.tournaments` — aflæst tom igen 5. august 2026. |
| `A27` | Skal `competitions.rules` droppes? | Når produktet svarer på, om point skal kunne variere pr. konkurrence. Et `drop column` er uigenkaldeligt, og kolonnen koster kun plads, mens spørgsmålet står åbent. |
| `A23` | Skal appen have en router? | Når tilbage-knappen koster brugere, eller `I12` kræver delbare interne URL'er. |
| `G1` | `MainApp.jsx` (~582) er den sidste store skærmfil | `A23`. **De fire andre er delt 5. august 2026** — `AdminScreen` 434 → 67, `HjemTab` 672 → 411, `ProfileScreen` 480 → 241, `CreateCompetitionScreen` 444 → 394 — og det, der er tilbage i `MainApp`, **ER** navigations-tilstandsmaskinen plus render-træet, altså præcis `A23`s emne. Rækken er dermed ikke længere et stykke oprydning, men en afventning: en router omskriver det, der er tilbage, og en opdeling først ville skulle laves om. |
| `A14` | Fuld Prettier-gennemformatering | Næste gang der alligevel røres bredt i frontenden — ellers aldrig. |
| `B12` | Mål, om "Anbefalet" flytter fordelingen | **Når `efter`-perioden har tosifret `antal`** i §5F-opslaget. Kørt 5. august 2026: 6 oprettelser før mærkatet, **1** efter — n=1 kan ikke måle en fordeling. Opslaget er rettet og klar til at gentages. |
| `I15` | Weekly Mix-automatikken | Reel efterspørgsel. **Udløseren er rettet 5. august 2026:** her stod, at `B12`s opslag ville sige, om Ugens kupon-kortet bruges. Det kan det ikke — `mode = 'random'` dækker både galleriets kort og en håndlavet Quick Pick, og de to kan ikke skelnes på `mode_params`. |
| `I19` | "Historik" på karriereprofilen: gamle dagskort | **Når nogen spørger efter dem.** Karrusellen var utilsigtet et arkiv, og v3 fjerner det — men rækkerne bliver i tabellen, så intet er tabt, hvis spørgsmålet kommer. |
| `I2` | Diagnose-historik | Kræver et sted at gemme snapshottet — første gang Analytics ville have brug for en tidsserie-tabel. |
| `I3` | Alarm ved tilstandsskifte i en liga | Afhænger af `I2`. |

### Tier 7 — Udadvendt og ubesluttet

Vækst, ikke fastholdelse. Produktbogens kapitel 3 sætter dem bevidst efter alt
ovenstående, og de står i rækkefølge efter, hvad der gater hvad, ikke efter
værdi. **To undtagelser fra "ingen af dem er besluttet":** `B21` er besluttet i
princippet — produktet hedder Leagly, og repoet gør ikke — og venter kun på
`I10`, fordi det er den samme flytning. Og `B25` er besluttet (august 2026)
og ikke gated af noget: domænet er købt, og rækken står øverst, fordi den
gater både `B26` og en troværdig publicering.

| # | Hvad | Bemærkning |
|---|---|---|
| `B25` | **Egen SMTP til auth-mails** (Resend el.lign., `noreply@leagly.app`, SPF/DKIM) | **Besluttet (august 2026) og ikke længere gated:** domænet er købt. Skal FØR publicering af hjemmesiden: Supabases indbyggede mailservice er reelt kun til udvikling, så den første fremmede, der glemmer sin adgangskode, er låst ude — nulstillingsmailen går gennem samme kanal som bekræftelsen. Gater `B26`. |
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
| `I18` | i18n-lag (flersprogethed) | Betinget af dansk succes — men noteret NU, fordi prisen betales løbende: al brugertekst ligger hårdkodet i komponenterne, så hver ny skærm uden disciplin gør ombygningen dyrere. |

---

## Åbne beslutninger

Spørgsmål, der er identificeret, men bevidst ikke afgjort endnu. Når en
beslutning træffes, flyttes den til [`DECISIONS.md`](./DECISIONS.md) med dato og
begrundelse, og rækken her slettes. `Afgøres` er en **udløser**, ikke en dato.

| # | Spørgsmål | Kontekst | Afgøres |
|---|---|---|---|
| A32 | **Skal der findes en vej til at køre read-only opslag i produktion uden ejeren?** | Tier 1 blev sprunget over tre gange i træk, fordi de fem aflæsninger krævede en Supabase-adgang, arbejdsmaskinen ikke har — og prisen var ikke kun ventetid: `B19` voksede fra to SQL-filer til fem imens, fordi hver leverance, der ikke kunne køres samme dag, gjorde den ene opgave, der ventede på ejeren, større. Køen har altså to betjeninger, og kun den ene arbejder. **Men et svar er ikke gratis:** den nærliggende mekanik er en GitHub Actions-workflow med `SUPABASE_DB_URL` (som `schema-export.yml` allerede har), og den ville lægge produktionstal — deltagertal, hændelser, i værste fald pseudonymer — i Actions-logs. Det er en beslutning om, hvor brugerdata må stå, og ikke en oprydning. Alternativet er at acceptere, at aflæsninger er ejerens arbejde, og i stedet gøre dem billigere at bestille (ét paste, som 5. august). | Næste gang et tier blokeres af manglende produktionsadgang. |
| A34 | **Hvornår skiftes Supabase Free ud med Pro?** | Free-planens tre lofter bider i denne rækkefølge: **egress (5 GB/md)** først — appen er REST-fetch-tung, så et sted mellem 200 og 500 ugentligt aktive nærmer forbruget sig loftet; **database (500 MB)** langt senere (tips-rækker er små, `analytics_events` er den hurtigst voksende tabel, se `G77`); og **backup-vilkåret** er kvalitativt: 24 timers datatab (afsnit 22) er valgt til venner, og når fremmede udgør flertallet, er Pro's backups prisen værd. Aflæses på Supabase-dashboardets Usage-side — én gang om måneden, ikke oftere. Vercel Hobby er IKKE samme spørgsmål: dens tunge trafik skalerer med turneringer, ikke brugere, og skiftet dér udløses af kommercialisering (vilkårene), ikke af brugertal. | Egress nær loftet, eller fremmede i flertal blandt de aktive. |
| A35 | **Er publiceringstærsklen på 45 den rigtige?** | Story Engine v3 udgiver dagens kort med ulæst-markering, når nyhedsværdien når 45, og som dæmpet `DAY_RESULT` under. Tallet er udledt af grundvægtene (max for `DAY_RESULT` alene er 40), ikke af data — samme slags kvalificerede gæt som v1's A4-tærskler var, og de blev kalibreret på live-data. `story_score_distribution` logger vinderregel, `news_value` og runner-up, så fordelingen kan aflæses uden ny instrumentering. | **Efter to uger med v3 i drift og mindst ti kampdage.** Målet er 40–60 % af kampdagene med ulæst-markering for en aktiv bruger. Over 70 % ⇒ tærsklen er for lav, og v3 har genskabt v2's problem i ny indpakning. Under 25 % ⇒ Hjem er stille igen, og v2's oprindelige problem er tilbage. |
| A36 | **Skal en lukket konto også forlade ligaen, når den ikke længere deltager i én eneste af ligaens konkurrencer?** | `A25` (5. august 2026) melder den lukkede konto af hver konkurrence, der ikke er BEGYNDT, og lader resten stå — begrundelsen er vennernes historik, og den holder. Men frameldingen har en følge, der ikke blev tænkt til ende: er ingen af ligaens konkurrencer begyndt, fjernes samtlige deltagelser, og tilbage står `group_members`-rækken alene. Pseudonymet "Slettet 4f3a…" står da på medlemslisten uden en eneste ting bag sig — præcis den tilstand, `A25` fjernede ét lag længere nede, bare ét lag højere oppe. Koden siger det selv i `sql/liga_admin.sql`: *"Ligamedlemskabet bliver stående; det er hverken en stilling eller en plads i en konkurrence."* Det var rigtigt før `A25`, hvor medlemskabet altid havde mindst én deltagelse under sig. **Modargumentet er ikke svagt:** en liga er et socialt rum og ikke en konkurrence, og en tom plads på medlemslisten er også et spor af, at nogen VAR med — mens en fjernelse er uigenkaldelig og ændrer et tal (medlemsantallet), som ligaens ejer kan have set. Invarianten i `group_membership_invariant.sql` (deltager ⇒ medlem) peger i retning af fjernelse: den forbyder det omvendte, altså en deltagelse uden medlemskab, og siger dermed intet om et medlemskab uden deltagelse. **Aflæst 7. august 2026 (prøvekørslen, se `A37`):** tilstanden er præcis som beskrevet — efter lukningen står `Slettet 11111111` på medlemslisten med rollen `member` og nul deltagelser, mens `group_members`-rækken er urørt. **Men aflæsningen flyttede spørgsmålet mere, end den besvarede det:** den fandt `A37`, og de to har modsatrettede svar. Fjernes den lukkede konto fra ligaen, forsvinder pseudonymet fra listen — men i en liga, hvor den lukkede var ADMIN, ville fjernelsen efterlade ligaen både uden administrator OG uden nogen at pege på som årsag. `A36` bør derfor ikke afgøres før `A37`. | **Sammen med `A37`.** Udløseren (en rigtig lukning at kigge på) er sprunget; det, der mangler, er beslutningen — og den skal træffes efter `A37`, ikke før. |
| A37 | **Hvad skal der ske med en liga, hvis eneste administrator lukker sin konto?** | **Fundet 7. august 2026 ved prøvekørslen af `G76`, og det er ikke en formodning — det er efterprøvet under ægte RLS mod produktionsskemaet.** Kæden er kort og hvert led er dokumenteret og bevidst: (1) admin-rollen kan kun uddeles ÉN gang, ved oprettelsen, af opretteren til sig selv — `group_members_insert_self` tillader `role = 'admin'`, kun når `groups.created_by = auth.uid()`; (2) der findes **ingen UPDATE-policy** på `group_members`, altså ingen forfremmelse — medlems-administration er bevidst uden for v1 ([`features/liga-laget-v1.md`](./features/liga-laget-v1.md)); (3) en lukket konto kan aldrig logge ind igen, fordi `api/delete-account.js` soft-sletter rækken i `auth.users`. Følgen er, at `is_group_admin()` aldrig kan blive sand for den liga igen. **Målt i prøvekørslen:** et almindeligt medlem kunne hverken omdøbe ligaen, slette den, fjerne den lukkede konto fra listen, forfremme sig selv eller melde sig ind igen som admin — fem forsøg, fem afvisninger. Ligaen kan derefter aldrig omdøbes, aldrig slettes, aldrig få fjernet en deltager og aldrig få slettet en konkurrence. **Det er ikke et hjørnetilfælde:** hver liga har præcis én administrator, nemlig sin opretter, så enhver opretter, der lukker sin konto, efterlader sin liga sådan. Det eneste, de øvrige medlemmer kan, er at forlade den — så en liga kan ende som en tom skal, ingen kan rydde op i. **Rækkefølgen er vigtig:** aflæs først, om nogen liga allerede står sådan (Tier 1), for det afgør, om dette er en fælde eller en oprydning. Fire mulige svar, ikke gensidigt udelukkende: overdrag admin til det ældste levende medlem ved lukning; tillad forfremmelse (det udskudte stykke af liga-laget); lad en platform-admin gribe ind; eller acceptér vilkåret og skriv det i `DOCUMENTATION.md` §12. **Bemærk, at status quo ikke er neutral:** i dag er den eneste vej ud manuel SQL i Supabase, altså ejeren. | **Efter Tier 1-opslaget** `sql/checks/league_admin_coverage.sql`. Findes der allerede en frossen liga, er det en oprydning med en frist; findes der ingen, kan svaret vælges i ro — men det bliver ikke billigere med tiden, for hver ny liga er en ny opretter. |
| A33 | **Er dagsmotorens variation tyndere, end regelantallet lover?** | Story Engine v2 lagde syv dagsregler til, men `DAY_RESULT` alene står for 123 af 280 historier (44 %), og de næste to (`DUEL` 35, `COLLECTIVE_MISS` 19) er tilsammen mindre end halvdelen af den. En motor, der er markedsført på bredde og leverer det samme kort hver anden gang, er en anden oplevelse end tabellen antyder. **Spørgsmålet kan ikke stilles endnu:** ingen af de 197 dagskort er nogensinde blevet vist (`G73`), så der findes ingen, der har oplevet ensformigheden. Måske er 44 % helt rigtigt — "dagens facit" er også den mest almindelige ting at fortælle om en kampdag. **Delvist håndteret af v3 (7. august 2026):** `DAY_RESULT`s 44 % var en konstruktionsfølge — laveste prioritet, udløses altid — og v3 fjerner årsagen ved at give den grundvægt 8, hvilket gør den til fald-tilbage frem for anker. Spørgsmålet om, hvorvidt de øvrige seks regler faktisk varierer, er **ikke** besvaret og skal aflæses på ny fordeling. | Når dagskort faktisk bliver set, altså efter `G73`. |
| A5 | **Emojis i historie-kort: til eller fra?** | Gør kortet skimbart på mobil, men mindre klassisk. **v1-default: emojis til.** **Delvist besvaret (v1.1, juli 2026):** emoji er nu et *signal* — den findes kun i højdepunkt-tieret, mens dæmpede kort er uden. Spørgsmålet er dermed reduceret til, om højdepunkterne skal beholde deres. **Datamanglen er lukket (30. juli 2026):** Analytics-fanens sektion "Story Engine-regler" viser genereret/vist/delt/afvist pr. regel, så spørgsmålet kan afgøres på tal frem for fornemmelse. **Sidste forudsætning er væk (31. juli 2026):** `story_engine.sql` er gen-kørt i produktion (den tidligere `B3`), så v1.1's 14 regler genererer nu rigtige kort. Uret på "et par runder" starter her. | **Regelstatistikken er aflæst 5. august 2026, og den kan ikke afgøre spørgsmålet.** 280 historier, 21 af 21 brugere dækket — men **0 delinger** og kun 2 afvisninger i alt. Del-knappen er præcis det, højdepunkt-tieret har og det dæmpede ikke, så uden en eneste deling findes signalet ikke. Sammenligningen mangler desuden en nævner: det dæmpede tier har kun **6** historier (`Premiereugen` 3, `Stille runde` 3), fordi det per design kun genereres til brugere, der ellers ville stå uden kort. **Uret starter forfra ved den første deling** — ikke ved den næste runde. |
| A14 | **Skal hele kodebasen gennemformateres med Prettier?** | `npm run format` findes, men `format:check` er bevidst ikke et CI-trin. En fuld gennemformatering ville omskrive ~6.700 linjer ved `printWidth: 140` (~14.000 ved standard 80) på tværs af ~126 filer (86 uden testfiler; genmålt august 2026). Prisen er hele repoets `git blame`; gevinsten er konsistens i en kodebase med én forfatter og en i forvejen ensartet håndstil. Beslutningen er **udskudt, ikke truffet** — se [`DECISIONS.md`](./DECISIONS.md), 30. juli 2026. | Næste gang der alligevel røres bredt i frontenden — ellers aldrig. |
| A23 | **Skal appen have en router?** | Navigation er i dag to `useState` i `MainApp.jsx` (`tab` + `screen`), og deep links læses ved boot og strippes straks via `history.replaceState` (`App.jsx:104`, `MainApp.jsx:215,239`). Følgen er ingen tilbage-knap, ingen browser-historik og ingen delbare URL'er til interne skærme — mærkbart for en PWA, hvor telefonens tilbage-gestus forventes at virke. Men det er et arkitekturvalg, ikke en fejl: afhængighedsfattigheden er bevidst (fire runtime-deps, ingen router, `docs/reviews/2026-08-app-review.md` §7), og en router omskriver hele navigations-tilstandsmaskinen inkl. begge deep-link-join-flows, som ingen test dækker. | Når tilbage-knappen enten koster brugere (kan aflæses i analytics) eller en feature kræver ægte delbare interne URL'er — `I12`s offentlige ligaside er den første, der ville. |
| A27 | **Skal `competitions.rules` droppes?** | Efter `G3` (3. august 2026) har kolonnen **ingen læsere overhovedet** — hverken i klienten, som holdt op med at skrive den, eller i SQL, hvor `pc_points()` altid har hardkodet 3/1. Den står altså tilbage som ren historik i hver eneste konkurrence-række. Men et `drop column` er uigenkaldeligt, og spørgsmålet bagved er et **produktspørgsmål og ikke en oprydning**: skal point nogensinde kunne variere pr. konkurrence? Siges ja, er kolonnen den halve implementering af noget, der skal bruges igen; siges nej, er den støj, der får den næste læser til at lede efter en konfigurerbarhed, som ikke findes — præcis den omkostning, `G3` blev kørt for at fjerne. Prisen ved at lade den stå er lav og løbende; prisen ved at fjerne den forkert er, at en fremtidig pointvariation skal bygge sit skema forfra. | Når produktet svarer på, om point skal kunne variere pr. konkurrence — ikke før. Indtil da koster kolonnen kun plads. |
| A26 | **`ambiguousTeams`: godkendte par eller accepteret støj?** | Feltet i sync-resuméet er bygget på egenskaben *"kun til stede, når der ER noget at kigge på"* — og den holder ikke længere for Scotland: `Dundee` ligger inde i `Dundee United`, begge klubber bliver i Premiership, og feltet er derfor permanent tændt med et par, der allerede er afgjort som en ægte navnelighed (2. august 2026, [`features/turnering-2.md`](./features/turnering-2.md)). Et felt, der altid er der, holder man op med at læse — og så er kontrollen reelt væk, netop når turnering #8 tilføjer et par, ingen har set før. To veje: en liste over **godkendte** par (`Dundee`/`Dundee United`), så feltet igen kun melder det nye, eller en accept af, at dette ene felt læses med et kendt par i baghovedet. Den første koster en liste, der skal vedligeholdes pr. turnering; den anden koster kontrollens troværdighed. | Ved turnering #3 — det er dér, det viser sig, om det ene par er en undtagelse eller et mønster. |

## Ubygget

| # | Hvad | Hvorfor / hvad den venter på | Omfang |
|---|---|---|---|
| B21 | **Omdøb GitHub-repoet og Vercel-projektet, og ret hjemmesidens links** | Navneskiftet 4. august 2026 gik gennem app, manifest, ikoner, tekster og dokumentation, men stoppede ved projektnavnene — **med vilje**, fordi et skifte af Vercel-projektet ændrer `.vercel.app`-adressen og dermed knækker hvert link, der peger på den. Prisen ved status quo er, at produktet hedder Leagly overalt undtagen i den adresse, en ny bruger faktisk taster ind: 23 CTA'er i `site/` (4+5+6+4+4) plus README'ens live-link peger på `prediction-champ.vercel.app`. **Rækkefølgen er bindende og er hele grunden til, at rækken står lige efter `I10`:** vælges et rigtigt domæne, skal linkene alligevel skiftes, og gøres omdøbningen først, skiftes de to gange. Vercels gamle URL redirigerer ikke af sig selv, så et delt link fra før skiftet dør — det er kun ufarligt, så længe hjemmesiden ikke er publiceret. `docs/RESTORE.md`s omtale skal IKKE rettes: den navngiver backup-filer, der faktisk hedder det gamle. | Lille (men mange steder) |
| B25 | **Egen SMTP til auth-mails** (`noreply@leagly.app` via Resend el.lign., SPF/DKIM i DNS, indsat i Supabase → Auth → SMTP Settings) | Uden den går bekræftelses- og nulstillingsmails gennem Supabases delte, stærkt rate-begrænsede udviklings-mailservice — den første fremmede, der glemmer sin adgangskode, er låst ude, og afsenderen er ikke vores. Domænet er købt (august 2026), så rækken er ikke gated af noget. Gratis-tieret hos Resend rækker langt forbi `A34`s udløser. Gater `B26`. | Lille (opsætning + DNS) |
| B26 | **E-mailbekræftelse + Turnstile på signup** | I det kontrollerede felt er ubekræftede konti harmløse; offentligt kan hvem som helst oprette konti med hvem som helsts e-mail — både en spam-vektor og et lille GDPR-problem (adresser opbevares, som ingen har verificeret er deres). Begge dele er Supabase-konfiguration, ikke kode: bekræftelse slås til under Auth (kræver `B25`), Turnstile under Auth → Bot Protection. Prisen er ét ekstra trin i onboardingen — derfor først ved åben deling, ikke før. | Lille (konfiguration) |
| B20 | **Personlige invite-links** (`invite_links` + `invited_by` på `group_members`/`competition_participants`) | Attributionen "hvem inviterede hvem" findes ikke i skemaet: `groups.invite_code` er én kode pr. liga og ikke pr. bruger, og ingen af medlemstabellerne gemmer afsenderen. Det er derfor, milepælen **"5/10 venner tilmeldt via dit link" ikke kunne bygges** — `milestones` tæller i stedet `LEAGUE_GREW_5/10`, altså hvor mange der kom med i en liga, man har oprettet, hvilket er en anden bedrift. Begrundelsen står ved koden begge steder (`sql/milestones.sql`, `src/lib/milestones.js`) og peger på denne række. **Ventetid er ikke gratis her, og det er rækkens vigtigste egenskab:** attribution kan kun registreres fremad, så en bedrift bygget på den kan først tælle fra udrulningsdagen — de brugere, der allerede er inviteret, tælles aldrig. Gater desuden `I6` (ambassadørprogram), som ikke kan måle noget uden. | Mellem |
| B12 | **Mål, om "Anbefalet" på Sæson-kortet flytter fordelingen** | Mærket blev sat på i `A22` netop for at flytte, hvilken mode nye brugere vælger, men effekten er aldrig aflæst — og et anbefalings-mærke, der ikke virker, er værre end ingen, fordi det bruger den plads, der skulle guide. `competition_created` bærer allerede `metadata.mode`, så før/efter kan opgøres uden ny instrumentering. Samme opslag svarer på `I15`s åbne spørgsmål om, hvorvidt Ugens kupon-kortet bruges. Forespørgslen står i [`features/analytics-v1.md`](./features/analytics-v1.md) §5F sammen med de tre forbehold, svaret skal læses med (lille datamængde, lossy hændelseslog, og at kort-rækkefølgen blev vendt samme dag som mærkatet kom på). **Rækken har stået siden august 2026 med teksten "tilbage står at køre den" — og da den blev kørt 5. august 2026, kunne den ikke:** vinduet partitionerede på `(e.created_at < m.fra)`, som hverken står i `group by` eller er aggregeret, så PostgreSQL afviste den med `42803`. Perioden udledes nu i en CTE, efterprøvet mod PostgreSQL 16.13. **Anden kørsel samme dag afslørede, at kilden var forkert valgt:** hændelsesloggen svarede med tre oprettelser i alt, alle `random` — plausibelt nok ved ~20 testbrugere, men ubrugeligt, fordi `analytics_events` først findes fra 30. juli 2026, så "før mærkatet" var to døgn og ikke appens historik. `competitions.mode` + `created_at` bærer samme oplysning som **rigtige rækker over hele historikken**, og spec'ens §5F er byttet om, så tabellen er den primære kilde og hændelsen kontrollen. **Opslaget er kørt 5. august 2026, og svaret er "ikke endnu":** hele appens historik rummer **syv** konkurrencer — 6 før mærkatet (`time_range` 2, `random` 2, `full_season` 2) og **1** efter (`random`). Med n=1 i den ene periode kan ingen fordeling måles, hvilket er præcis rækkens eget første forbehold. Rækken er derfor flyttet til Tier 6 med en udløser, der kan aflæses med samme opslag: **tosifret `antal` i `efter`-perioden.** Det, der er leveret, er ikke svaret, men at spørgsmålet nu kan stilles — forespørgslen kunne hverken køre eller pege på den rigtige kilde, da rækken blev skrevet. | Lille (opslag) |

## Teknisk gæld

| # | Gæld | Hvorfor den betyder noget | Omfang |
|---|---|---|---|
| G83 | **Der findes ingen samlet indgang til at genberegne de afledte rækker.** | Fire tabeller er ren funktion af `matches` + `predictions`: `ratings`/`rating_history`, `stories`, `competition_awards` og `milestones`. Ingen af dem skrives af den, der skriver grunddataene — de skrives af en trigger, af klienten, eller af notifikations-jobbet. **Indbakke-linjens præmis ("skrives KUN lazy fra klienten") holder ikke:** `award_competition_periods()` og `award_milestones()` har haft en pålidelig skriver i cron siden `B11`/v2.1 (`api/send-notifications.js`), og v3 lagde `apply_milestone_stories()` til. **Det, der er tilbage bagved, er større:** `recompute_ratings()` har INGEN bagstopper — den udløses kun af triggeren på `matches` — og [`RESTORE.md`](./RESTORE.md) foreskriver `--disable-triggers` ved en delvis gendannelse **uden at sige, hvad man gør bagefter**. En gendannelse af tabte tips ville altså efterlade ratingen forkert, indtil nogen tilfældigvis rettede et resultat i den samme sæson. Simulatoren måtte af samme grund kalde tre funktioner i hånden i den rigtige rækkefølge (`sql/dev/simulate_season.sql`, opdaget ved at køre den), og en fremtidig backfill vil skulle det igen. Løsningen er ikke ny kode, men ét sted: en `recompute_all(p_season_id)` — eller, billigere og næsten lige så godt, et afsnit i `RESTORE.md` og i `sql/README.md`, der navngiver de fire kald og deres rækkefølge. **Rækkefølgen er ikke valgfri** og er allerede lært to gange: `award_milestones()` skal ligge efter sæson-flaget (6. august), og `apply_milestone_stories()` efter `award_milestones()` (7. august). | Lille (dokumentation) til mellem (én RPC) |
| G82 | **Sæson-simulatoren (`sql/dev/simulate_season.sql`, 1.069 linjer) har ingen CI-dækning.** | Filen er testdata-fabrikken for staging og dermed det eneste sted, en hel sæson kan opstå uden 300 håndindtastninger. Den er efterprøvet i hånden mod en lokal PostgreSQL 16 med `schema.sql` kørt ind — kampprogrammet (132 kampe, 22 runder, intet hold to gange pr. runde, hvert par præcis to gange), personaernes rangorden (0,62/0,54/0,47 point pr. kamp over 20.000 kampe) og at `teardown()` efterlader nul rækker i alle otte tabeller. **Den vej skal gås igen for hver ændring**, og den er allerede gået fire gange på to dage (6.–7. august: sæsonen kunne ikke afsluttes, milepælene fik ét tidsstempel, sæsonåret krydsede 1. juli). Filen rører desuden præcis de funktioner, `G83` handler om, så den er også den billigste levende dokumentation af deres rækkefølge. `sql`-jobbet i CI har mønstret i forvejen — opret database, kør fil, påstå tal — og `schema.sql` ligger i repoet. **Forbeholdet, sagt højt:** det ville blive jobbets tungeste trin (en fuld sæson med tips og resultater), og en simulator, der er langsom i CI, bliver en simulator, nogen vil springe over. Et delvist trin (`setup` + én runde + `teardown`) fanger de fleste regressioner til en brøkdel af tiden. | Mellem (ét CI-trin) |
| G79 | **Docs-SQL-tjekket er kun så sandt som `sql/schema.sql`, og en manglende eksport ligner en fejl i blokken.** | `G74`s tjek (`sql/tests/docs_sql.mjs`) bygger hver ` ```sql `-blok i `docs/` om til et `prepare` mod skemaet i repoet, og det er dét, der gør, at `B12`s `42803` ville være fanget. Prisen står allerede skrevet i filens eget hoved: `schema.sql` er et **genereret** øjebliksbillede, som kun er sandt, når eksport-workflowen er kørt efter seneste migrering (den kører ugentligt, mandag 06:00 UTC, plus manuelt). Skriver nogen en forespørgsel mod en kolonne fra en migrering, der ikke er eksporteret endnu, fejler tjekket — **med den rigtige fejl af den forkerte grund**: PostgreSQL siger "kolonnen findes ikke", og den næste læser retter sin blok i stedet for at køre eksporten. Vilkåret er erkendt, men kun i en kommentar; det, der mangler, er, at KØRSLEN siger det. To billige veje: CI-trinnet kan skrive `schema.sql`s commit-dato ud, før det kører (så alderen er synlig i loggen ved en rød kørsel), eller trinnet kan fejle med en linje, der navngiver eksporten som første mistænkte. Ingen af dem gør tjekket rigtigere — de gør fejlen læselig, hvilket er hele forskellen på en kontrol, folk stoler på, og en, de begynder at omgå. | Lille |
| G80 | **`/api/*` findes ikke på `npm run dev`, og appen oversætter Vites HTML-svar til noget forkert.** | Vite serverer `index.html` for enhver ukendt sti, så et kald til `/api/…` får **200 OK med HTML**. Det er ikke en fejl i sig selv — funktionerne kører kun på Vercel — men de fem kaldesteder tror alle, at 200 betyder JSON, og lyver hver sin løgn: "Hent nu" i Admin → Kampe viser den rå `Unexpected token '/', "// Server-"… is not valid JSON`; push-tilmeldingen (`src/lib/push.js`) kaster samme fejl videre uden at fange den, fordi `keyRes.ok` er sand; forhåndsvisningen i Admin → Drift svarer tomt; og **de to konto-lukninger siger "Kontoen kunne ikke lukkes. Prøv igen"** — altså at et forsøg mislykkedes, hvor der aldrig var et forsøg. Det sidste er den værste: netop dét endpoint har en dokumenteret HALV tilstand (`kun_anonymiseret`), så beskeden sender fejlsøgningen efter en tilstand i databasen, der ikke findes. Rettelsen er ét sted — en fælles `apiFetch()`, der ser på `content-type` og svarer *"endpointet findes ikke i udviklingsserveren — brug et preview-deploy"* — og fem kaldesteder, der bruger den. Prisen ved status quo betales kun af udviklere, men den betales hver gang: fejlen ligner en fejl i koden, og den er en fejl i miljøet. | Lille |
| G81 | **Midnats-pladsholderen er en antagelse hos football-data.org, ikke en aflæsning.** | `isMidnightPlaceholder()` (`api/_providers/kickoff.js`) er den ene regel, begge leverandører nu deles om: står der `00:00:00` i tidsfeltet, er klokkeslættet ikke fastsat. Filens hoved siger selv, at midnat-testen er "AFLÆST, ikke antaget" — men det, der blev aflæst, er, at en kamp gemt med 00:00 UTC vises som 02.00 i appen, altså at værdien går ORDRET igennem. Det er ikke det samme som at have set football-data.org sende midnat for en kamp uden fastsat tid. **Antagelsen er af nøjagtig samme slags som den, der lige blev afkræftet:** 2. august blev `status === "SCHEDULED"` valgt som markør ud fra leverandørens dokumentation, og 6. august viste dataene, at den ikke holdt — turneringer kan blive stående i `SCHEDULED` længe efter, tiderne er sendt. Fejlretningen erstattede altså én udokumenteret aflæsning med en anden. **Aflæsningen er billig:** `&dryRun=true` mod en football-data-liga med runder langt ude i fremtiden, og se på tidsfeltet i forhåndsvisningen — den rå status følger med som diagnose. Det koster ét kald med et admin-token. Sker det ikke, er alternativet at vente, til en runde derfra igen ser forkert ud, og så er prisen brugernes tid frem for vores. | Lille (aflæsning) |
| G76 | **`anonymize_my_account()` har aldrig kørt i produktion.** | `I16`s tælling 5. august 2026 gav 0 lukkede konti ud af 24 profiler, og dét tal har en anden aflæsning end den, rækken blev talt for: funktionen bag kontolukning er **uafprøvet mod rigtige data**. Den blev skrevet forfra 4. august (`A28`–`A31`) og gen-kørt 5. august, den er uigenkaldelig, og dens første rigtige kørsel er en bruger, der har bedt om at forsvinde og ikke kan fortryde, hvis den fejler halvvejs. Samme form som `G8` — en kodesti, kun unit-tests har været nede ad — men med en dyrere fejl, fordi `G8`s værste udfald er en forkert stilling, og denne er en halvt slettet person. Vejen til at prøve den uden en rigtig bruger er staging — og **den findes siden 6. august 2026**, så rækken er ikke længere gated, kun ubygget. **`A25` (5. august 2026) gjorde rækken tungere og ikke lettere:** kroppen sletter nu også deltagelsen i konkurrencer, der ikke er begyndt, altså én uigenkaldelig handling mere i en funktion, ingen har set køre. Reglen har en negativ kontrol i CI (afsnit 12 af `sql/tests/liga_admin.sql`), men CI er ikke produktionsdata. **Flyttet fra Tier 6 til Tier 1 den 7. august 2026:** rækken ventede på staging, staging findes, og den venter derfor ikke længere på noget — den venter på et miljø, hvilket er et andet tier. **Prøvekørt samme dag (sent) og dermed skrumpet.** Databasehalvdelen er kørt mod `sql/schema.sql` — det rigtige produktionsskema, 23 tabeller, 44 funktioner, 42 policies — i en lokal PostgreSQL 16 med en liga, tre medlemmer og fire konkurrencer i hver sin tilstand, og den var **ren**: det personlige ryddet (fem tabeller til nul), `feedback` og `client_errors` afkoblet uden at rækkerne forsvandt, tips/rating/milepæle/kåringer urørt, `auth.users` urørt, og `A25`s framelding ramte præcis den ene konkurrence, der hverken var begyndt eller havde brugeren som eneste deltager — mens den lod de tre andre stå, inklusive den, hvor brugeren var alene, og den, hvor brugeren aldrig havde tippet. Andet kald svarede samme pseudonym uden at flytte `anonymized_at`. **Det, der IKKE er prøvet af, er tilbage i Tier 1:** knappen i Profil, `api/delete-account.js` og soft-sletningen i `auth.users` — kæden med den dokumenterede halve tilstand. **Prøvekørslen fandt til gengæld noget, ingen læsning havde fundet:** `A37`, en liga, hvis eneste administrator har lukket sin konto, kan aldrig administreres igen. Opslagene ligger nu i `sql/dev/anonymize_rehearsal.sql`, så staging-halvdelen er et paste og ikke en opgave. | Lille (test) |
| G77 | **`analytics_events` vokser uden loft.** Hændelsesloggen er fire-and-forget og lossy by design (afsnit 21) — men den slettes aldrig, og den er den hurtigst voksende tabel pr. aktiv bruger. | En retention-regel (fx: slet rækker ældre end 6 måneder, kørt af heartbeat'en, som allerede har adgangen og et skema — samme mønster som `prune_job_runs()`, `G45`) køber Free-planens 500 MB lang tid gratis. Forbeholdet er dokumenteret i spec'en: loggen er kontrol-kilde for `B12`-lignende opslag, så vinduet skal være længere end det længste opslag, nogen vil stille. | Lille (én funktion + ét kald) |
| G78 | **Scoringens talværdier skal spejles i både SQL og `src/lib/stories.js`.** | v1 og v2 har begge "teksterne står to steder" på listen over kendte begrænsninger. v3 gør det værre i art, ikke i mængde: en afvigelse i en tekst giver forkert formulering, mens en afvigelse i en grundvægt eller et nærhedsled giver et **andet kort** — uden fejl, uden log, uden at nogen opdager det. Fejltypen er tavs. | Løsningen findes allerede i huset: `milepaele-v1.md` §8 gemmer `key` + `payload` og renderer i JS. Samme model for dagskortet (gem `rule` + `payload` + `news_value`, render i `stories.js`) fjerner både tekst- og taldubletten. Kræver migrering af eksisterende rækker og bør derfor ligge **efter** at v3's udvælgelse er valideret i drift — ikke i samme leverance. |
| G1 | **`MainApp.jsx` (~582 linjer) er den sidste store skærmfil.** | Sidste rest af fil-opdelingen fra 30. juli 2026. **De fire andre er delt 5. august 2026** — `AdminScreen` 434 → 67 (fire paneler i `screens/admin/`), `HjemTab` 672 → 411 (tre kort i `screens/hjem/`), `ProfileScreen` 480 → 241 (fem sektioner i `screens/profile/`) og `CreateCompetitionScreen` 444 → 394. Komponent-flytningerne er rene: intet JSX-element og ingen brugertekst er ændret, kun fordelt. **Det, der var værd at hente, var ikke linjetallet, men de to lib-moduler:** `data/createSources.js` og de to nye funktioner i `data/home.js` lå som `useEffect`-kroppe og kunne kun efterprøves i hånden; de har nu 27 tests, hvoraf tre vogter regler, der fejler TAVST (kampantal pr. turnering, `G35`; kamp-puljens mærkbare afkortning; en fejlende konkurrence springes over frem for at vælte hele Hjem). Samme snit og samme begrundelse som `MainApp`s invitations-flows fik samme dag. **Det, der er tilbage i `MainApp`, ER navigations-tilstandsmaskinen** plus render-træet — altså `A23`s emne — og rækken er derfor flyttet til Tier 6 med `A23` som udløser. | Lille — men gated af `A23` |
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
| I18 | **i18n-lag: al brugertekst ud af komponenterne** | Flersprogethed er den valgte vej til marked #2 (august 2026: dansk-først er bevidst, flere sprog HVIS dansk lykkes) — men appen har i dag intet tekstlag, så det bliver en ombygning og ikke en oversættelse. Noteret nu af én grund: prisen betales løbende. Hver ny skærm, der hårdkoder sine tekster, gør ombygningen dyrere, og en stille disciplin (nye tekster samles ét sted, når der alligevel røres ved en skærm) er gratis fra i dag. | Betinget af dansk succes |
| I19 | **"Historik" på karriereprofilen: gamle dagskort** | Karrusellen var utilsigtet også et arkiv — man kunne rulle tilbage i ugens kort. v3 fjerner det, og spørgsmålet er, om nogen savner det. Modargumentet er stærkt: en historikliste over dagskort er præcis den rundelog, `milepaele-v1.md` skilte karriereprofilen af med, og rækkerne bliver i tabellen uanset hvad (de filtreres allerede fra på prioritetsbåndet). | **Vent til nogen spørger.** Bygges den præventivt, er den bygget af samme grund som karrusellens loft på 10 — fordi det kunne lade sig gøre. |

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
