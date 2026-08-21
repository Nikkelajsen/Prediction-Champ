# Beslutningslog — trufne beslutninger

Arkivet over afgjorte spørgsmål, med dato og begrundelse. Nyeste øverst.

Udskilt fra `docs/ROADMAP.md` den 30. juli 2026: loggen var vokset til
hovedparten af filens 104 KB, og ROADMAP'en skal kunne læses for at *træffe* en
beslutning — ikke for at læse alle de gamle.

**Åbne** beslutninger bor i [`BACKLOG.md`](./BACKLOG.md) (flyttet dertil
31. juli 2026). Når en af dem afgøres, flyttes den hertil med dato og
begrundelse.

Begrundelsen er det vigtige. En beslutning uden den kan ikke revideres senere:
man ved ikke, om forudsætningen stadig holder.

---

## 21. august 2026 — `B39`: det korte holdnavn gælder HELE appen, og reglen bor ét sted

**Beslutning (produktejeren):** det korte holdnavn vises **overalt, hvor et
holdnavn står** — Hjem, stillingens rundemodal, opret-flowet, Admin og Story
Engine, ikke kun tip-rækkerne. **Gårsdagens afgrænsning til tip-rækkerne er
dermed ophævet** (se entryen nedenfor, som står uændret som historik).

**Hvorfor den blev ophævet dagen efter.** Gårsdagens begrundelse var, at
tip-rækken er det ene sted, prisen betales, og at ét sted kan revideres billigt,
hvis tonen skurrer. Ejeren så resultatet i den kørende app og svarede på det
spørgsmål, afgrænsningen efterlod åbent: tonen skurrer ikke — det gør
**forskellen**. Når Tip siger "Hull City – Man United" og Hjem, Admin og
stillingen siger "Hull City AFC – Manchester United FC" om den samme kamp, er
kælenavnet ikke længere et kort navn, men et andet navn. Konsistens er her
argumentet, ikke plads.

**Præmissen holdt heller ikke.** "Alle andre visninger har plads til det fulde
navn" var forkert på det sted, det betød mest: Hjems rundeliste sætter
`textOverflow: "ellipsis"` og **trunkerer** — altså gør præcis det, tip-rækken
nægter at gøre, fordi et afkortet holdnavn er skjult information. Hjem var det
sted i appen, hvor et langt navn kostede information og ikke bare højde, og det
stod ikke i beslutningen.

**Reglen bor ét sted, og det er den egentlige leverance.** Otte kopier af
`t.short_name || t.name` var den nærliggende vej og er forkert på to måder, der
begge ser ud som "det hold har ikke noget kort navn": et sted, der glemmes,
viser tavst det lange navn, og et sted, der beder om `select=id,name`, gør det
samme UDEN at fejle. `teamLabel()`/`teamLabelMap()`/`TEAM_SELECT`
(`src/lib/teams.js`) er derfor regel OG opslag ét sted.

**`TEAM_SELECT` er `*` og navngiver med vilje ingen kolonner.** En navngiven
kolonne, der ikke findes, er en 400 fra PostgREST — og `short_name` findes kun i
en database, hvor `#72` er kørt. Produktionen har kørt den; staging og et preview
mod staging behøver ikke at have gjort det, og så ville hver skærm med en kamp
på være hvid dér. Det er samme uafhængighed mellem migrering og deploy, som
`planTeamWrites()` giver skrivesiden, og den er nu en påstand i `teams.test.js`
frem for en vane.

**Favorithold-listen sorterer efter det, der VISES.** Rækkefølgen kom fra
serverens `order=name`; med kort navn på skærmen ville "Atleti" stå midt i
C'erne, hvor "Club Atlético de Madrid" hører hjemme. En liste, man skal finde et
hold i, må sortere efter sin egen tekst — derfor `_label` på rækken og en
sortering i `loadTeamsByLeague()`.

**Story Engine skriver kort navn, men kun fremad, og det er en kant værd at
kende.** Historiernes tekst er FROSSEN ved skrivningen, så de kort, der allerede
står, beholder de lange navne, til dagen skrives forfra. Reglen er skrevet ud
seks steder i `story_engine_v3.sql` frem for at bo i en `public.team_label()`-
funktion: en ny funktion i `public` skal bære sin egen `revoke execute … from
public` (`#56`) og vogtes af to kontroller, og det er for meget maskineri om seks
kald i én fil — samme afvejning, som `G123` traf. Prisen er, at kilden og appen
kan drive fra hinanden, og den betales af en **kilde-læsende vagt** i
`sql/migration_syntax.test.js` (vagt 4): en påstand mod `stories` ville kun kunne
se de tre af otte dagsregler, fixturen faktisk fyrer — og COLLECTIVE_MISS, den
ene hvis OVERSKRIFT bærer to holdnavne, er netop en af de fem, den ikke fyrer.
Samme lære og samme form som vagt 3 (`G89`).

**Holdmatchen er stadig urørt.** `teams.name` er fortsat nøglen
(`teams_league_name_unique`, normaliseret navnematch med `includes()`-fallback).
Kolonnen er ren visning, og det var halvdelen af gårsdagens beslutning — den
halvdel står ved magt.

---

## 20. august 2026 — `B39`: det korte holdnavn vises KUN i tip-rækkerne, og skrivningen gater sig selv på kolonnens eksistens

> 🔶 **Første halvdel er OPHÆVET 21. august 2026** — det korte navn gælder nu
> hele appen, ikke kun tip-rækkerne (se entryen ovenfor). Anden halvdel — at
> skrivningen gater sig selv, og at `teams.name` forbliver nøglen — står ved
> magt. Entryen bliver stående uændret: den er begrundelsen for, hvorfor
> afgrænsningen blev prøvet først.

**Beslutning:** `teams.short_name` (`#72 teams_short_name.sql`) udfyldes af
syncen fra football-data.orgs `shortName` og vises i **tip-skærmens kamprækker
og ingen andre steder**. Hjem, stillinger, opret-flowet og Story Engine
beholder de fulde navne. Sportmonks-ligaerne får aldrig feltet (deres
`short_code` er et tre-bogstavs badge), og en gemt værdi nulstilles aldrig af
en leverandør, der holder op med at sende feltet.

**Hvorfor kun tip-rækkerne.** Rækken kom af ét konkret problem: Primera
Divisións fulde navne fylder to linjer i en kamprække, hvor seks kolonner deler
pladsen, og appen ombryder med vilje frem for at trunkere. Det er det ene sted,
prisen betales — alle andre visninger har plads til det fulde navn, og det
fulde navn ER informationen. At rulle kælenavnene bredt ud ville desuden gøre
tonevalget (næste afsnit) til hele appens tone på én gang; ét sted kan
revideres billigt, hvis det skurrer.

**Tonen er accepteret med åbne øjne.** Aflæsningen 20. august 2026
([`reviews/football-data-shortname-aflaesning-2026-08-20.md`](./reviews/football-data-shortname-aflaesning-2026-08-20.md))
viste, at leverandøren sender **kælenavne** ("Barça", "Atleti", "M'gladbach",
"HSV"), ikke afkortninger. Det er de navne, en fodboldlæser selv siger, og i en
kamprække er det en styrke; skævheden "Brighton Hove" (mistet "&") er én på 78
og accepteret. Skurrer tonen i praksis, er kuren at ændre visningsvalget i
`PredictionsScreen.jsx` — ikke at røre data.

**Skrivningen gater sig selv, så migrering og deploy er uafhængige — begge
veje.** Syncen læser `teams` med `select=*` og skriver kun `short_name`, når
nøglen faktisk var med i svaret (`harShortName` → `planTeamWrites()`,
`api/sync-matches.js`). Uden guarden ville en skrivning, der nævner kolonnen,
svare 400 i vinduet mellem deploy og `#72` — og syncen ville være nede, til
migreringen var kørt. Prisen er én bevidst kant: en HELT NY turnerings
allerførste sync har nul rækker at aflæse, svarer forsigtigt nej og lader næste
kørsel patche de korte navne på plads. Klienten bærer samme uafhængighed med
`select=*` og `short_name || name`. Derfor findes der ingen `UDRULNING-B39.md`:
hver mellemtilstand er gyldig.

**Holdmatchen er urørt, og det er halvdelen af beslutningen.** `teams.name`
forbliver nøglen (`teams_league_name_unique`, normaliseret navnematch med
`includes()`-fallback) — korte navne ville skabe netop de kollisioner,
`ambiguousTeamNames()` fælder ("Real Sociedad" ⊂ "Real Sociedad de Fútbol").
Kolonnen er ren visning.

## 18. august 2026 — Indstillinger-skærmen findes nu, og push-fravalget er én samlet kontakt (`B40`)

**Beslutning:** Appen har fået en Indstillinger-skærm (tandhjul i topbaren) med
push-notifikationer som til/fra-kontakt og "Skift brugernavn" som anden beboer.
Kontakten er **alt eller intet** — ingen pr.-type-valg (deadline, runderesultat
osv.) og ingen databaseændringer: tilstanden er fortsat alene "har denne enhed
en `push_subscriptions`-række". Et "fra" på Indstillinger sætter samme
"nej tak"-flag (`pc_push_dismissed`) som opt-in-kortets kryds. Admin-knappen
afgav tandhjulet og bærer nu skruenøglen.

**Hvorfor.** Ejerens ønske: brugere skal løbende kunne slå notifikationer til
og fra, og den flade fandtes ikke — kun opt-in (Hjem-kortet/checklisten) og de
to omveje log ud og browserens indstillinger. Alt-eller-intet, fordi
udsendelsen ingen præference-model har (afsnit 16), og en granularitet ville
kræve kolonne + serverfiltrering for et behov, ingen har efterspurgt; formen
kan udvides senere uden at kontakten skifter betydning. Dismiss-flaget ved
"fra", fordi opt-in-kortet ellers ville stå på Hjem og bede brugeren fortryde
et valg, de lige har truffet aktivt — et stærkere nej end at lukke et kort.
"Skift brugernavn" flyttede med, fordi `B29` selv udpegede en kommende
indstillingsskærm som knappens rette hjem ("dette er dens første beboer") —
én-punkts-menuen, der talte imod dengang, er ikke længere én-punkts.
Fuldskærm frem for dialog, fordi alle topbarens knapper åbner skærme; ét
mønster. Kendt begrænsning uændret: abonnementet er pr. enhed, og det siger
skærmen højt.

**Bevidst uden for:** pr.-type-præferencer, e-mail-fallback, adgangskodeskift
og sprogvalg på skærmen — de kan flytte ind senere.

---

## 17. august 2026 — Sæson-gaten slipper en periode, når dens slutdato er passeret

**Beslutning:** `competition_status`' sæson-gate (`A28`) undtager nu
`time_range`: en periode regnes kun som voksende, til dens `end_date` er
passeret (`#41 season_end.sql`, gen-kørsel påkrævet). Dagen efter slutdatoen
afsluttes en færdigspillet periode straks — pokal, vinderlinje, fejring og
`COMP_*`-milepæle — uden at vente på, at sæsonen selv melder sig slut.
`full_season` og `team` gates uændret, og resultat-kravet (alle kampe har
facit) løsnes ikke.

**Hvorfor.** Fundet af ejeren samme dag: "TEST – Superliga", en firerunders
augustperiode, stod med 22/22 spillet og ingen vinder. Gaten så kun på mode —
`time_range` står i `BACKFILLABLE_MODES`, altså "kan vokse", altså "vent på
sæsonen" — men Superliga-sæsonen slutter først til sommer, så en periode midt
i sæsonen ville have ventet i ti måneder på en kåring, dens deltagere kunne
regne ud i hovedet den aften, sidste kamp blev spillet.

**Hvorfor undtagelsen er sikker uden karensperiode.** Gaten findes for kampe,
der ikke er skemalagt endnu. Men efterfyldningen (`api/_backfill.js`) kan kun
optage en kamp i en periode, hvis kickoff-dagen ligger INDEN FOR
`[start_date; end_date]` — og dens regel 3 ("en runde, der er gået i gang,
vokser aldrig") gør en kamp i et passeret vindue umulig at tilføje, fordi dens
runde pr. definition er begyndt. Undtagelsen hviler altså på en strukturel
umulighed, ikke på at der er gået tid nok — derfor ingen 30-dages-ventil her.
`<` og ikke `<=`: på selve slutdatoen kan dagens kampe stadig komme til.
Uvished trækker stadig mod "ikke afsluttet": en periode uden `end_date` gates
som før (samme princip som `seasons_done`s `coalesce(…, false)`), og
sammenligningen sker som `'YYYY-MM-DD'`-tekst — samme form som
efterfyldningens egen — så en skæv værdi ikke kan vælte viewet, som en
`::date`-cast kunne.

**Efterprøvet fra begge sider:** `sql/tests/competition_status.sql` fik
påstand 12–12e — perioden med passeret slutdato afslutter, `full_season` på
præcis de samme kampe gør ikke (modprøven mod en gate, der var faldet helt
af), sidste-dagen og den slutdato-løse gates stadig, og en uspillet kamp
spærrer fortsat. Mutationsprøven er kørt: med den gamle view-definition svarer
"Periode, passeret" `false`, og påstand 12 vælter testen.

---

## 17. august 2026 — "Ikke bekræftet"-markøren fjernes helt: et klokkeslæt vises uden forbehold

**Beslutning:** `matches.kickoff_uncertain` og hele maskineriet bag den —
kolonnen `kickoff_prev_at`, triggeren `matches_remember_previous_kickoff`,
`refresh_kickoff_uncertain()`, syncens RPC-kald, `"(ikke bekræftet)"`/`~` i
visningen og `ALLE UBEKRAEFTEDE`-halvdelen af `kickoff_coverage`-kontrollen —
er fjernet (`#71 matches_kickoff_uncertain_drop.sql`). Reglen er herefter den
simple, ejeren selv formulerede: **har kampen et klokkeslæt, vises det uden
forbehold; har den ingen, viser `kickoff_tbd` kun datoen.** `kickoff_tbd` og
alt omkring lås og deadline er urørt.

**Hvorfor.** Truffet samme dag som `G135`-rettelsen (beslutningen nedenfor) og
oven på den: ejerens skærmbillede viste, at markøren stod på 16.00-kampene i en
runde, der tydeligt HAVDE været igennem tv-flytninger (kampe fredag 21.00,
lørdag 13.30 og 18.30) — netop de kampe, der er mest sikre. Dominans-reglen
indsnævrede gættet, men genoprettede ikke tilliden til det: et gæt, der har
ramt de mest bekræftede kampe én gang, læses ikke som information igen. Og
markørens reelle værdi var lille — et klokkeslæt, leverandøren flytter, retter
sig selv via syncen (hver 12. time), og markøren var display-only fra første
dag, så den beskyttede aldrig et tip eller en lås. Mod det stod en betydelig
vedligeholdsflade: to kolonner, en trigger på `matches`, en indlæringsregel med
to kalibrerede tærskler, en RPC pr. sync-kørsel, en 449-linjers SQL-test og en
kontrol-halvdel i heartbeat'en.

**Prisen, og den er valgt med åbne øjne:** `sql/checks/kickoff_coverage.sql`
er igen blind for præcis den tilstand, `G85` blev bygget for — Premier League,
Primera División og Serie A får et opdigtet klokkeslæt fra football-data.org
og kan aldrig få `kickoff_tbd` sat, så deres foreløbige tider vises, som var de
fastsatte. Accepteret, fordi fejlen retter sig selv ved næste sync, når tiden
flyttes, og fordi alternativet var en markør, der løj den anden vej.
`kickoff_tbd`-halvdelen af kontrollen (`ALLE UDEN TID`, `G84`) står urørt.

**Følger for gen-kørsel:** `#49` og `#70` må aldrig gen-køres (🛑 i
`sql/README.md` — #49 genskaber maskineriet tavst, #70 genskaber en funktion,
der først fejler ved kald). Kørselsrækkefølgen for `#71` er omvendt af `#49`s:
merge/deploy først, migrering bagefter, ellers fejler heartbeat'en med `42703`.

---

## 17. august 2026 — `G135`: en pladsholder kendes på RUNDEN, ikke på klokkeslættet — og horisonten hører i visningen

**Beslutning:** `refresh_kickoff_uncertain()` markerer kun en kamp, hvis det
indlærte klokkeslæt bærer **over halvdelen** af rundens ikke-spillede kampe. Oven
i lægger visningen en horisont på **ti dage** — men den ligger i
`src/lib/scoring.js` og bevidst **ikke** i SQL.

**Hvorfor dominans.** `G85` spurgte kun om klokkeslættet, aldrig om kampen. Det
kunne ikke virke, og aflæsningen 7. august havde allerede skrevet hvorfor:
efterårspladsholderen **er** turneringens typiske anspilstid. Det var netop
indvendingen, kandidat A blev forkastet på — og kandidat B, der blev valgt for at
undgå den, markerer også på klokkeslæt og *lærer* bare tabellen frem for at
hardkode den. **B undgik A's kalibreringsproblem, ikke A's kollisionsproblem.**
Den sætning er det, der er værd at tage med videre: to mekanismer, der udleder det
samme tal på forskellig vis, arver de samme fejl.

Runden er den rigtige enhed, fordi pladsholder-regimet tildeler ét klokkeslæt til
en hel runde ad gangen (PL november = 15:00 ×40), mens en tv-planlagt runde har
spredte slots. **Tærsklen er flertal og ikke ensartethed:** PL's december bærer to
distinkte pladsholdere (15:00 ×40, 20:00 ×20), og et krav om fuld ensartethed
ville tabe dem begge. Flertal er samtidig den eneste tærskel, man kan sætte uden
data at kalibrere på (`A35`) — den er ikke et valgt tal.

**Den negative form er sikker, hvor den positive blev forkastet.** Aflæsningen
afviste "alle kampe samme klokkeslæt ⇒ pladsholder", fordi Bundesligaens sidste
spillerunde er ægte og ensartet. "Spredte klokkeslæt ⇒ ikke en pladsholder" kan
kun fjerne markeringer og kan derfor kun fejle i retning af en umarkeret
pladsholder — den billige fejl, og den tilstand appen levede i før `G85`.

**Hvorfor horisonten IKKE ligger i SQL, og hvorfor det er den vigtigste halvdel af
beslutningen.** Den første udgave af rettelsen lagde de ti dage i funktionen med
et injicerbart `p_now`. To ting slog den ihjel:

1. **`G84`s kontrol ville være blevet stum kode.**
   `sql/checks/kickoff_coverage.sql` alarmerer, når ALLE en turnerings kampe inden
   for ti dage bærer `kickoff_uncertain`. Med horisonten i SQL kan ingen kamp i
   det vindue være markeret, så grenen kunne aldrig lyse igen. En kontrol, der
   ikke kan lyse, er værre end ingen kontrol, fordi den ligner dækning — og det
   var netop den blindhed, `G85` blev bygget for at lukke.
2. **Signaturen.** `p_now` med en default gør funktionen til en **overload** af
   `#49`s, og PostgREST kan da ikke binde syncens ét-argument-kald: "could not
   choose a candidate function". Det ville have krævet et `drop function` plus et
   gen-etableret grant — altså en migrering, der kan tage adgangen fra jobbet, i
   stedet for en, der kun kan give færre markeringer.

Med snittet i visningen beholder kolonnen **én** ren betydning ("det indlærte
klokkeslæt dominerer runden"), kontrollen beholder sin følsomhed, syncen røres
ikke, og brugeren ser alligevel ikke markøren på en nær kamp. Markøren har været
display-only siden `#49`, så en visnings-side horisont er den samme slags regel ét
lag længere ude. **At `kickoff_coverage.sql` og dens test kunne stå fuldstændig
uændret, er beviset på, at snittet lå rigtigt.**

**Tallet ti er lånt og ikke nyt.** Det er `G84`s eget vindue, brugt på præcis den
påstand, det blev valgt på: "En kamp, der spilles inden for ti dage, har et
klokkeslæt." Samme disciplin som `G85`s gulv på tre, der blev lånt af `G84`.

**Prisen er kendt og valgt:** en runde, hvor alle kampe RIGTIGT spilles samtidig
(Bundesligaens sidste spillerunde), kan gøre `G84`s kontrol rød uden en fejl bag.
Det er et menneske, der læser den kontrol, og en falsk alarm der er langt billigere
end en falsk markør på hver bruger-skærm.

**Hvorfor testen ikke fangede fejlen, og hvad det siger.** Påstand 3 i
`sql/tests/kickoff_uncertain.sql` **påstod** adfærden: kampe, der "ALDRIG har
flyttet sig", markeres. Fixturet lå i december/januar, hvor det er rigtigt. Der
fandtes ingen påstand om en runde med spredte klokkeslæt — altså om
normaltilstanden. En test, der kun beskriver den tilstand, reglen blev bygget til,
kan ikke se, at reglen også rammer alt andet.

## 16. august 2026 — `A39`: kampdagen er blevet personlig

**Beslutning:** et dagskort udgives, når alle kampe på dagen i de konkurrencer,
**modtageren deltager i**, har et resultat — ikke når hver eneste kamp i alle syv
synkroniserede turneringer har det. `match_day_complete()` er dermed ikke længere
motorens spørgsmål; den lever videre uændret som produktets globale begreb.

Backloggens `A39` stillede spørgsmålet som "skal et dagskort kunne udgives, mens
en anden turnering mangler et resultat?" og beskrev to veje. Det er den første,
der er valgt: fuldførtheden afgrænses til modtagerens egne konkurrencer, kortet
bliver personligt, og det kan skrives på forskellige tidspunkter for forskellige
brugere. Den anden vej — behold den globale dag og gør blokeringen aflæselig —
blev fravalgt af backloggens egen begrundelse: den "koster ingenting og løser
heller ikke noget".

**Det ophæver `G92`s forbehold.** Beslutningen fra 9. august 2026 sluttede med
"`A39` er ikke afgjort af dette". Det er den nu. `G92`s egen regel — at værnet
hører i motoren og ikke hos kalderne, fordi en regel, hver kalder skal huske, er
den regel, den femte kalder glemmer — står uændret ved magt og er selve grunden
til, at triggerens fortjek blev fjernet frem for gjort personligt.

**Afgrænsningen er ALLE dagens kampe i mine konkurrencer, ikke kun dem, jeg har
tippet.** Den nærliggende regel lyder rigtigere og er forkert. Kortet påstår ikke
kun noget om modtagerens egne tips: det bærer stillingen (`_sd_after`, med hele
tiebreaker-stigen) og siden `G88` en mini-stilling med tre rækker. De tal flytter
sig, når **modstanderne** får point. En bruger, der glemte at tippe aftenkampen,
ville få "du ligger nr. 2" kl. 16 og en anden sandhed kl. 22 — altså `A38`s
fejltype, som hele v3 er bygget for at undgå. Den valgte afgrænsning er til
gengæld sammenhængende hele vejen: er jeg klar, er `_sd_after` for netop mine
konkurrencer regnet på en færdig dag, og mini-stillingen og `_sd_rival` læser kun
gennem en konkurrence, jeg deler med hovedpersonen.

**Et udgivet kort fryses, når dagen VOKSER.** Den globale kampdag gjorde det
umuligt for en allerede skrevet dag at vokse — en kamp kl. 20 blokerede alle. Den
personlige åbner tre veje: jeg opretter en konkurrence (lovligt indtil en time før
kickoff), jeg melder mig ind i en, eller en anden melder sig ind i min.
Efterfyldningen er derimod ikke en vej ind: `api/_backfill.js` håndhæver "en
runde, der er gået i gang, vokser aldrig", så kun menneskehandlinger kan udløse
det. Kortet beholdes, som det stod, fordi det VAR sandt, da det blev skrevet —
samme semantik, overskriften allerede bærer ("Stillingen efter kampdag 03.08").
Målt på `payload.day_scope_matches`, antallet af kampe kortet blev regnet på.

**Retningen er `<` og ikke `<>`, og det er ikke en detalje.** Kun en *voksende*
dag fryser. Bliver dagen mindre — en udmeldelse, en udsat kamp — skrives kortet
om. En frysning, der også ramte den retning, ville efterlade et kort på en dag,
der ikke længere findes, stående for evigt. Frysningen skal være selvhelbredende.

**Slet-og-indsæt blev til et FORLIG, og det var ikke frivilligt.** Motoren
slettede dagens rækker og skrev dem igen. Det var rigtigt, da den kørte én gang
pr. kampdag. Efter A39 kører den ved hvert resultat, der gør nogens dag færdig —
fire-fem gange på en stor lørdag — og en bruger, hvis tal ikke havde flyttet sig
siden kl. 16, ville få nyt `id`, nyt `created_at` og et tabt `dismissed_at` ved
hver af dem. Frysningen fanger det ikke: dagen voksede jo ikke. Motoren bygger
derfor rækkerne i en temporær tabel og skriver kun dem, der faktisk bliver
forskellige. Det lukker den hyppige halvdel af `G129` som sidegevinst.

**Og det gør en invariant strukturel frem for argumenteret.** Sletningen drives nu
af det, der skal skrives, og ikke af dagen: en række kan kun slettes, hvis der
findes en erstatning for netop den bruger. "En tidlig udgang må aldrig efterlade
mindre, end den fandt" hvilede før på rækkefølgen af to udgange; nu kan en bruger,
hvis dag ikke er færdig — eller hvis kort er frosset — ikke røres overhovedet.
"Den farligste linje i v2" er ikke længere farlig.

**Prisen, der ikke blev betalt.** Gevinsten gælder ikke på rundens sidste kampdag:
den udgang er stadig global, fordi rundens sidste dag er et *runde*-begreb, og
rundekortet er pr. runde og ikke pr. bruger. Gøres den personlig, kan to brugere
få hver sin "sidste dag" i samme runde, og rundestoryens afløsning mister sin
grund.

**Acceptkriterie 7 er omformuleret.** "To gen-kørsler giver samme kort" er ikke
længere sandt som skrevet — en gen-kørsel senere på dagen giver med rette et andet
kort, fordi faktamængden voksede. Kriteriet er nu determinisme *givet samme
faktamængde*, og forliget gør det stærkere end før: anden kørsel skriver intet.

**Kontrollen måtte skrives om, ellers ville leverancen have ødelagt sin egen
udløser.** `day_card_coverage`s værste tilstand — `KORT PÅ EN DAG, DER SPILLES` —
ville have lyst på hver eneste delvist spillede dag, og filen siger selv, at "en
alarm, der altid lyser, er slukket". Den tæller nu brugere frem for dage, og den
værste fejl er omdefineret: ikke "et kort på en uafsluttet dag" (det er præcis,
hvad frysningen med vilje producerer), men et kort, der påstår at dække mindst
det, brugeren har nu, mens noget af det stadig spilles. Samtidig fik kontrollen
for første gang en aftager: den blev læst af **ingen** planlagt kørsel og har nu
et trin i `job-heartbeat.yml`.

## 16. august 2026 — `B38`: "aktiv i en runde" er den, der SPILLEDE — ikke den, der åbnede appen

**Beslutning:** Analytics-fanens nye runde-serie måler *spillede runden* (havde
mindst ét muligt tip i runden og afgav mindst ét af dem) som sit hovedtal, og
viser *kom forbi* (havde appen åben i rundens uge) som et sekundært tal ved
siden af. Runden er `round_key` — tirsdag til mandag, dansk tid.

**Hvorfor ikke §15's definition af "aktiv".** Produktet har allerede et
aktivitetsbegreb: `user_activity_days`, skrevet af `touch_activity()` når appen
bruges. Det er dét, DAU/WAU/MAU og "Aktive brugere (7 dage)" måler, og det ville
have været det billigste svar her. Men liga-diagnosen lærte det modsatte for et
halvt år siden: v1's "andel aktive medlemmer" målte, om folk **åbnede** appen,
ikke om de **spillede**, og **bredde** blev tilføjet netop som den rettelse. En
runde-serie bygget på app-åbninger ville gentage fejlen på produktets vigtigste
enhed. De to tal står nu ved siden af hinanden, fordi gabet mellem dem er en
oplysning i sig selv — samme greb som `active_groups` vs.
`groups_with_active_member`.

**Hvorfor ikke tælle `predictions` direkte.** Det oplagte er `count(distinct
user_id)` over tips på rundens kampe. Det er forkert: `predictions` er én række
pr. (bruger, kamp) og deles på tværs af konkurrencer, så tallet ville rumme tips
på kampe, brugeren ikke havde en deadline på i nogen konkurrence — og kunne
dermed give **flere spillere end eksponerede**, altså en deltagelse over 100 %.
Begge tal læses derfor af `analytics_completion_facts`, samme kilde som North
Star og Deadline Miss Rate, så de tre ikke kan modsige hinanden.

**Hvorfor runden og ikke ugen.** `completion_by_week` fandtes allerede, og
genbrug ville have været gratis. Men dens uge er `date_trunc('week', …)` —
mandag, ISO-ugen — mens produktets runde er `public.round_key()`: tirsdag,
aflæst i dansk tid. De to grids er forskudt et døgn, så en tirsdagskamp ville
lande i en anden spand end den runde, den tæller med i på Tip-skærmen, i
Championship og i notifikationerne. Et dashboard, der taler et andet sprog end
produktet, kan ikke bruges til at diskutere produktet.

**Hvorfor sektionen har sin egen vælger.** Panelets 7/30/90 dage skærer midt
igennem en runde. En serie, der skal vise en udvikling, skal have hele enheder,
og vinduerne er derfor 12/26/52 runder (et kvartal, et halvår, et år).

**Hvorfor runden i gang vises, men ikke tæller.** Alternativerne var at skjule
den (og dermed skjule den nyeste nyhed, man har) eller at lade den tælle med
(og dermed melde et fald hver eneste uge, uanset hvad brugerne gør, fordi et
delvist tal altid taber til et helt). Den vises som en stiplet søjle og holdes
ude af overskriftstallet, retningen og gennemsnittet. Flaget hedder `is_open` og
betyder *ikke alle rundens kampe er låst endnu* — altså "tallet kan stadig
vokse", ikke "runden er ikke spillet færdig". Det er `G73`s og `G115`s regel en
gang til: et tal, der ser målt ud, men ikke er sammenligneligt, skal mærkes.

**Hvorfor debut måles over hele historikken.** "Nye spillere" kunne være regnet
inden for det viste vindue, hvilket er billigere. Så ville hver eneste flytning
af vinduet se ud som en strøm af nye spillere — en måling, hvis værdi afhænger
af, hvor man står og kigger fra.

---

## 16. august 2026 — `A57` lukkes: "Øvrige konkurrencer" er en understøttet tilstand, ikke et overgangslag

**Beslutning (produktejeren):** sektionen bliver, og beskrivelsen rettes. En
konkurrence uden liga er en tilstand, produktet understøtter — ikke en rest, der
er på vej væk. Der migreres ingenting, og ligasletningen laves ikke om.

**Hvorfor spørgsmålet kunne afgøres uden den aflæsning, det stod og ventede på.**
Rækken lå i Tier 1 med ét tal foran sig: hvor mange liga-løse konkurrencer
findes der stadig? Begrundelsen var, at nul ville gøre blokken i `LigaerTab.jsx`
til et tomt overgangslag, der kunne slettes. **Det ville det ikke**, og rækken
bar selv modbeviset to sætninger længere nede: `competitions.group_id` er
`on delete set null`, så en slettet liga lægger sine konkurrencer ned i laget.
Vejen ind ved oprettelse er lukket siden august 2026 (`createCompetition`
kræver en liga), men det er ikke den eneste vej ind, og den anden er hverken en
fejl eller et hjørnetilfælde: `GroupScreen.jsx` lover den udtrykkeligt i
sletteboksen — *"de flytter ud af ligaen og står videre under 'Øvrige
konkurrencer' med stilling, tips og kåringer i behold"*. **Et lag med en levende
tilgangsvej er ikke midlertidigt**, uanset hvad tallet er i dag.

**Nul havde i øvrigt ingen handling knyttet til sig.** Blokken renderes kun, når
`loose.length > 0`. Ved nul viser den allerede ingenting, så en sletning af koden
ville ikke fjerne en eneste pixel — kun evnen til at tage imod den næste
ligasletning. Tallet kunne altså højst sige, hvor stor en migrering ville være,
hvis man valgte at lave en, og aldrig om man skulle.

**Hvorfor ikke den anden vej — migrér og luk vejen.** At lukke tilgangsvejen
betyder, at en ligasletning skal gøre noget andet med konkurrencerne: enten
slette dem (med stilling, tips og kåringer, altså præcis det, sletteboksen lover
ikke sker) eller auto-oprette en ny liga (en sletning, der efterlader en ny
liga). Begge er dyrere end det, de fjerner, og den første fjerner en bevidst
brugerbeskyttelse. Bemærk desuden, at RLS kun tillader sletning af en liga, hvis
ingen af dens konkurrencer er uafsluttede — det, der lander i laget, er altså
netop de færdigspillede med historik, der er værd at beholde.

**Vejen UD findes allerede og er den rigtige.** `move_competition_to_group()`
lader opretteren flytte sin konkurrence ind i en liga, og engangs-opfordringen på
fanen peger på den. Det er en enkeltbeslutning truffet af den, der ejer
konkurrencen — en bulk-migrering ville træffe den på deres vegne.

**Det, der VAR forkert, er ordlyden**, og den er rettet tre steder:
`liga-laget-v1.md` skrev, at sektionen *"forsvinder naturligt"*,
`LigaerTab.jsx` og `liga/CompetitionCard.jsx` kaldte den "overgangslaget".
`DOCUMENTATION.md` §18 sagde allerede det modsatte og rigtige — at blokken lever
videre, fordi `group_id` ikke kan blive `not null` — så de to dokumenter
modsagde hinanden, og spec'en var den, en læser ville tro på. Vilkåret står nu i
§12 sammen med de øvrige, der er sådan med vilje.

## 16. august 2026 — `G127`: browseren er repoets skriftgengiver, når et billede bygges i hånden

**Beslutning:** billeder, der skal bære tekst i repoets egen skrift, bygges ved
at fotografere en HTML-side med Chromiums egen kommandolinje — ikke ved at male
glyffer i Node. `site/img/og-image.png` er den første, og opskriften er
`scripts/og-image-site.html` plus `scripts/build-og-image-site.mjs`.
**Appens `public/og-image.png` bliver, hvor den er:** ren Node, wordmarket
alene, ingen tekst.

**Begrundelse — fravalget var rigtigt begrundet og forkert afgrænset.**
`build-og-image.mjs`s hoved har siden `I7` sagt, at ordlyden ikke kan males ind,
fordi Barlow kun findes som `.woff2`, og at pakke en woff2 ud kræver Brotli plus
woff2'ens egen glyf-transformation — et bibliotek, projektet ikke har og ikke
skal have. **Det er sandt om Node og blev læst som sandt om repoet.** Siden
`I23` (15. august 2026) tegner `screenshots/capture.mjs` fire PNG'er ved at køre
Chromium direkte, uden en eneste ny afhængighed, og en browser maler med en
woff2 uden videre. Prisen for skriftgengivelse var altså allerede betalt et
andet sted i huset; den lå bare ikke i det værktøj, hovedet kiggede i.

**Hvorfor det ikke ændrer appens billede.** Fravalget havde to ben, og kun det
ene var en pris. Det andet er en designbeslutning: et OG-billede vises ofte som
en miniature på ~120 px højde, hvor en tagline sat ved 1200 px bredde er
ulæselig, mens `og:title` bærer den samme sætning som rigtig tekst — i
modtagerens skriftstørrelse og læsbar af en skærmlæser. Hjemmesidens billede er
en anden situation: det ER lavet med sælgesætningen malet ind, det er den fil,
der ligger live, og spørgsmålet var aldrig, om den skulle se sådan ud, men om
den kunne laves igen.

**Hvorfor en HTML-side og ikke tal i et script.** Opskriften skal kunne læses og
ændres af den, der skifter wordmarket eller sælgesætningen, og et layout udtrykt
som CSS kan åbnes i en browser og ses. `og-image-site.html` er derfor ikke en
skabelon, scriptet fylder ud — den er billedet, og scriptet er kameraet.

**Hvorfor to scripts og ikke ét.** De kræver forskellige ting af maskinen:
appens billede kan bygges hvor som helst, sitets kræver en Chrome. Ét fælles
script ville gøre den nemme halvdel afhængig af den svære.

**Hvad der er accepteret som en pris:** placeringstallene i `og-image-site.html`
(wordmarkets `top: 101px`, sælgesætningens `top: 468px`) er MÅLT på den
håndlavede fil frem for udledt af en centrering. Wordmark-PNG'en bærer sin egen
gennemsigtige luft — ~70 px foroven og forneden ved 72 % — så en centrering ville
give et andet billede end det, der ligger live. Genskabelsen skulle ikke
samtidig være en redesign. Tallene står med den begrundelse ved sig.

---

## 16. august 2026 — `G125`: en historieregel er levende, hvis den nyeste udgave af dens FUNKTION har den

**Beslutning:** `story-eksempler.test.js` afgør ikke længere en regels ordlyd ud
fra den højeste motorfil, der *nævner* reglen, men ud fra den højeste fil, der
*definerer den funktion*, reglen bor i. Findes reglen kun i en ældre udgave af
en funktion, en nyere fil har skrevet om, er den fjernet, og vagten går rød.

**Begrundelse — hullet var beskrevet som permanent, og det var det ikke.**
Vagtens hoved havde regnet prisen ud på det eneste alternativ, nogen havde fået
øje på: `sql/schema.sql`, produktionens øjebliksbillede, op til en uge bagud
(`G124`) og dermed rødt for enhver regel skrevet i dag. Den regnestykke er
rigtigt. Listen var bare ikke udtømmende: et regelafsnit ligger inde i en
`create or replace function`, og gen-definitionen af den funktion er den
oplysning, der mangler — maskinlæsbar, uden schema-dump, uden falsk rød.

**Det forklarer en skelnen, hovedet før kun kunne beskrive i prosa.**
`H2H_PASS` bor i `story_engine.sql` og er ægte, fordi ingen nyere fil
gen-definerer `generate_stories()`; en dagsregel i `story_engine_v2.sql` er død,
fordi `story_engine_v3.sql` skriver `generate_daily_stories()` om. Før var det
noget, en læser måtte vide; nu er det det, vagten måler.

**Rangen og ikke pladsen i listen.** To filer med samme versionstal
(`story_engine_v2.sql` og `story_engine_v2_day.sql`) er ikke hinandens afløsere.
Sammenlignes de på deres plads i en sorteret liste, udnævner alfabetet en
vilkårlig vinder, og resultatet ville være en falsk rød af en ny slags — præcis
den fejl, fravalget oprindeligt blev truffet for at undgå.

**Hvad der stadig IKKE påstås:** at reglen kører i produktionen. Vagten måler
repoet, ikke databasen, så en migrering, der ikke er kørt, ser levende ud her.
Det spørgsmål besvares af `sql/README.md`s statuskolonne, og den grænse er
uændret.

---

## 15. august 2026 — `I25`: dagskortet får Del og Afvis, og stillingen kan deles som billede

**Beslutning:** Story Engine v3's hverdagskort får både en **Del**-knap og et
**Afvis**-kryds, og Stilling-skærmen får en Del-knap, der sender tabellen som
billede. Spec'ens §7 (*"delefunktionen ligger kun her; hverdagskortet har den
ikke længere"*) og §8 (*"ingen friktion, intet at åbne, intet at rydde"*) er
dermed omgjort og rettet i samme ombæring.

**Begrundelse — begge fravalg var rigtige om det, de handlede om, og svarede på
et spørgsmål, produktet ikke stiller.** §7's argument var, at en delefunktion på
hver flade gør ingen af dem til noget særligt; det holder om *udbredelse*. §8's
var, at et kort med 48 timers udløb ikke SKAL ryddes; det holder om
*nødvendighed*. Ingen af dem handlede om det, brugeren faktisk bad om: dagens
facit **er** dét, man sender i en ligachat, og et kort, man er færdig med, vil
man af med nu og ikke om halvandet døgn. Ingen af de to sætninger stod i
spec'ens §2 "Låste beslutninger", så der var ingen låst beslutning at bryde.

**Prisen er betalt frem for undgået — tre steder:**

1. **Påmindelseskortet deles ikke** (`payload.variant = 'no_tips'`). Det siger
   "du mangler at tippe N kampe" *til dig selv* og er det ene dagskort uden en
   modtager. Reglen har sin egen prædikat (`isShareableDayCard`), så
   begrundelsen står ét sted og ikke i en betingelse i JSX.
2. **Ulæst-prikkens tærskel er urørt.** Prikken siger *"værd at afbryde for"*,
   knappen siger *"kan sendes videre"* — to spørgsmål, der ligner hinanden nok
   til at kunne smelte sammen ved et uheld. `stories.test.js` har en påstand,
   hvis eneste formål er, at de ikke gør det.
3. **Mini-stillingen kommer ikke med på dagskortets billede.** Dens navne er
   afgrænset til folk, modtageren deler konkurrence med — en strukturel regel i
   dagsmotoren — og et billede rejser uden for den afgrænsning. Skal en stilling
   deles, er det Stilling-skærmens egen knap, hvor brugeren **vælger** tabellen.

**Stillingens billede bærer kun `#`, navn og point.** Rating, 🎯 og Form kræver
hver deres forklaring, og den står i tabellens fodnote, som ikke kan rejse med
et billede. Er feltet større end ti, vises top-10, en `…`-række og modtagerens
**egen** række: den, der deler, skal kunne se sig selv, også som nr. 17 — samme
greb som dagskortets mini-stilling.

**`standings_shared` er et nyt hændelsesnavn og ikke en `metadata.via` på
`story_shared`.** En `via` skelner mellem KILDER til det samme trin, og det er
netop derfor dagskortets deling ER `story_shared` med `from: 'day_card'` — det
er en delt historie, bare fra en anden flade. En stilling har hverken
`stories`-række, regel eller nyhedsværdi og ville forurene enhver opgørelse over
Story Engine, den blev talt med i. Samme afvejning som `invite_landed` traf.

**Maleren flyttede frem for at blive kopieret.** `drawFrame()` boede i
`RoundStory.jsx`, hvilket var rigtigt, mens der fandtes ét delbart format. Det,
der nu skal holdes ét sted, er ikke koden, men **rammen**: tre skærme, hvis
billeder skal kunne ligge i den samme beskedtråd og se ud som ét produkt. Den
hedder `drawStoryCard()` i `src/lib/shareCanvas.js` ved siden af
`drawStandings()`, mens `share.js` fortsat kun er transporten.

**To fejl blev synlige, første gang en rigtig canvas tegnede resultatet**, og
begge var arvet: brødteksten var `slice(0, 46)` og klippede **midt i et ord**
uden at sige det, og stillingens titel tog kun første ombrudte linje, så
"Kontorets Premier League" blev til "Kontorets Premier" — tavst, i det ene felt
hvor en forkortelse gør mest skade. Begge klipper nu med "…" og ombryder. Det er
grunden til, at billedet blev tegnet i en browser og ikke kun enhedstestet:
påstandene dækkede *beslutningerne* (hvilke rækker, hvem fremhæves), og ingen af
dem kunne se en tekst løbe ud over kanten.

**Kendt kant, skrevet ned frem for bygget væk:** `generate_daily_stories(p_day)`
sletter og gen-indsætter dagens rækker ved en gen-kørsel, og den nye række har
et nyt `id` — så et afvist kort kan genopstå, hvis et resultat rettes bagud på
netop den dag. Kuren ville være en `dismissed`-liste pr. `(user_id, day_key)`,
altså en tabel for en kant.

## 15. august 2026 — `B34`: appen holdes ude af søgeindekset med `noindex`, ikke med `Disallow`

**Beslutning:** `app.leagly.app` får `X-Robots-Tag: noindex, follow` i
`vercel.json` og en `public/robots.txt`, der **tillader alt**. Hverken et
`Disallow` på appens origin eller en cross-domain `canonical` mod `leagly.app`.

**Begrundelse — begge de foreslåede kure ville have kostet noget, rækken ikke
vidste den betalte.** `B34` skrev, at valget stod mellem de to, og at *"valget
mellem de to er rækkens egentlige indhold"*. Det var det også — svaret er bare
en tredje ting.

**`Disallow: /` ville have slukket invitationernes link-preview.** Appens origin
er præcis dén, der leverer previewet for et delt `?liga=`-link (`I7`,
11. august 2026): `middleware.js` genkender `facebookexternalhit`, WhatsApp,
Twitterbot, LinkedInBot m.fl. og omskriver til `api/invite-preview.js`. **De
crawlere respekterer robots.txt.** Et `Disallow` betyder derfor for dem ikke
"skjul for søgemaskinen", men "hold op med at hente siden", og resultatet ville
være en nøgen URL i hver eneste gruppechat — nøjagtig den tilstand, `I7` blev
bygget for at komme ud af. Prisen ville være betalt uden en fejl, en log eller
et symptom på vores side: den eneste, der ser forskellen, er modtageren.

**En cross-domain `canonical` er svagere på begge led.** Den er et *hint*, en
søgemaskine må se bort fra, og dens påstand er "disse to sider er den samme
side" — hvilket en loginskærm og en salgsside ikke er. `noindex` siger præcis
det, vi mener. De to må desuden ikke kombineres; signalerne modsiger hinanden.

**`follow` og ikke `nofollow`:** appen skal ud af indekset, men dens links til
`leagly.app` skal stadig tælle. `nofollow` ville kaste den halvdel væk uden at
vinde noget.

**`public/robots.txt` findes, selvom den intet forbyder.** Uden filen kan
"ingen fil" og "en fil, der tillader alt" ikke skelnes bagefter — og vigtigere:
så er der ikke noget sted, advarslen kan stå. Den er hensigten skrevet ned dér,
hvor den næste, der vil "lukke appen for Google", kigger først. `seo.test.js`
vogter begge halvdele, fordi begge fejl er tavse og peger hver sin vej.

**Det, beslutningen IKKE afgør:** om appens forside en dag skal have sit eget
indhold værd at indeksere. Skulle den få det, er headeren ét sted at fjerne — og
`Disallow` er stadig forkert svar.

## 15. august 2026 — `B34`: sitets footer får ikke et årstal

**Beslutning:** der skrives ikke et copyright-år ind i `site/`s sidefod.

**Begrundelse — rækkens præmis holdt ikke.** `B34` listede "footer-året, som er
hårdkodet" som en af fem småting. Der er ikke noget år: `site/` indeholder
hverken `©` eller et årstal i sidefoden — sidefoden bærer missionssætningen og
to navigationsblokke. Rækken beskrev et problem, der ikke fandtes.

Det nærliggende var at lukke rækken ved at *tilføje* det, den gik ud fra var der.
Men et copyright-år er en dato, der skal vedligeholdes hver 1. januar, og
forkert i tolv måneder, hvis nogen glemmer det — altså præcis den slags
vedligeholdelsesbyrde, rækkens egen bekymring handlede om. En sidefod uden
årstal har ingen af de to problemer.

---

## 15. august 2026 — `G114`: varigheden udledes, den gemmes ikke

**Beslutning:** `admin_job_health()` regner varigheden ud af `started_at` og
`finished_at`. Der tilføjes **ingen kolonne** til `job_runs`, og `recordRun()` i
`api/_shared.js` er urørt.

**Begrundelse — backloggens egen præmis holdt ikke.** Rækken bad om "ét felt,
skrevet af `recordRun`" og begrundede det med, at varigheden var "umulig at
rekonstruere bagud". Begge kolonner har været der siden `#18` (juli 2026), så
varigheden var allerede gemt — den var bare aldrig regnet ud. En kolonne ville
have kostet en tabelmigrering og en ændring i api/, kun gjaldt FREMAD (så de 30
dages historik, `prune_job_runs` holder på, ville stå tomme), og været en tredje
kilde til den samme oplysning, som kunne komme ud af trit med de to, den er
udledt af.

**Median OG maksimum, ikke ét tal.** Én kørsel, der timede ud efter 20 sekunder,
trækker et gennemsnit så meget, at det ikke beskriver nogen kørsel; medianen
beskriver den typiske. Men udslaget må ikke forsvinde — det er dét, der er tæt
på kalderens grænse. De to sammen ER fordelingen, og det var fordelingen, `G109`
manglede.

**En langsom kørsel er ikke en fejlende.** Varigheden hæver ikke jobbets
tilstand til `ustabil`; kortet siger det i en sætning i stedet. Et grønt flueben
på en kørsel, der tog 26 sekunder, er stadig et grønt flueben — jobbet VIRKER,
det er bare sekunder fra at blive klippet over. Det er en diagnose, ikke en dom,
og præcis den skelnen manglede der ord for.

**NULL betyder umålt og aldrig nul.** En kørsel uden `finished_at` har ingen
varighed. Som "0 ms" ville den se ud som den hurtigste kørsel nogensinde — og
den er det modsatte. Samme regel som `G115` traf for fejlraten.

---

## 15. august 2026 — `G124`: anon-vagten mod en migrering er en KØRSEL, ikke et tekst-tjek

**Beslutning:** CI lægger de `sql/*.sql`, en pull request har rørt, oven på
produktionsskemaet i registrets rækkefølge og kører derefter
`sql/checks/anon_routine_reach.sql`. Et statisk tekst-tjek er valgt fra.

**Begrundelse.** Et tekst-tjek — "hver `create function` i `sql/` skal have en
`revoke execute … from public`" — ville have over 30 overtrædelser fra dag ét,
fordi `#56` fejede dem alle på én gang frem for fil for fil. Reglen ville altså
skulle bære en undtagelsesliste, der er længere end reglen selv, og en sådan
liste er det næste sted, der driver. En kørsel svarer i stedet på det, der
faktisk betyder noget: **kan `anon` nå noget bagefter?**

**Og det er den samme fil begge steder.** Kontrollen, der kører mod produktion
hver halve time, er den, der nu også kører i CI — `G84`s regel om, at en regel
skrevet ét sted og målt et andet er to regler.

**Rækkefølgen er registrets.** `sql/README.md`s filoversigt ER kørerækkefølgen,
og to migreringer i samme pull request kan have en afhængighed (`#63` er
meningsløs uden `#61`). En alfabetisk rækkefølge ville fejle på noget, der ikke
er en fejl.

**🔴 RETTET SAMME DAG, og rettelsen er den vigtigste del af beslutningen.** Første udgave sprang trinnet over med et `::notice::`, hvis basis-commit'en var tom eller ikke kunne slås op — altså **tavshed, der ligner ro**, præcis den form `A26` og `G43` er skrevet imod. Vagten ville have været død og grøn ved hver eneste kørsel. De to tilstande er ikke den samme, og kun den ene er lovlig: *ingen forgænger overhovedet* (lutter nuller ved en gren-oprettelse eller et force-push, hvilket pr. konstruktion kun kan ske på et `push`) er der intet at sammenligne med, mens *en basis, vi fik at vide, men ikke kan slå op* betyder, at `fetch-depth` eller ref'en er forkert — og så måler trinnet ingenting og skal være rødt.

**Trinnet skriver desuden sit resultat i jobbets resumé, og det er ikke pynt.** Det blev opdaget, da nogen ville efterprøve, om trinnet havde målt noget på sin allerførste kørsel: `sql`-jobbet producerer over 9.000 loglinjer, sæson-simulatorens NOTICE-udskrift fylder de sidste par tusinde, og GitHubs log-API svarer kun med en hale. Trinnets egne linjer kunne dermed ikke læses bagefter. Resuméet står på kørslens egen side i GitHubs brugerflade, to klik væk. ⚠️ **Det løser problemet for et MENNESKE og ikke for et API-opslag** — første formulering her påstod, at resuméet også står i check-runnets `output`, og det gør det ikke; efterprøvet på kørslen for `#227`, hvor trinnet skrev sin linje, mens `output.summary` var tom. **En vagt, hvis virkning ikke kan aflæses, er en vagt, man må tro på** — og det er den samme fejlklasse som den, trinnet selv findes for at lukke.

**`sql/job_runs.sql` springes over, og undtagelsen er dokumenteret.** Filen kan
ikke lægges oven på et skema, hvor `#65`/`#66` er kørt — returtypen kan ikke
erstattes, og PostgreSQL svarer `42P13`. En fil, der ikke kan køres mod
produktionens skema, kan pr. definition ikke måles af trinnet.

**Hullet var ikke teoretisk.** `G119` (14. august 2026) blev merget grøn med en
glemt `revoke` og først fanget tyve minutter efter kørslen i produktionen. Efter
denne beslutning er reglen dækket alle tre steder, den kan brydes: i dumpet, i
produktionen og i en pull request, hvor rettelsen stadig er gratis.

---

## 15. august 2026 — `G112`: skema-dumpets dato siger "sidst ÆNDRET", ikke "sidst kørt"

**Beslutning:** Skema-eksporten prepender et `GENERERET FIL — REDIGÉR IKKE`-hoved
til `sql/schema.sql` med workflow-navnet og én dato — den, hvor skemaet sidst
ændrede sig. Commit-detektionen sammenligner kroppene og lader hovedet stå, når
kun datoen ville flytte sig.

**Begrundelse.** Advarslen stod i CLAUDE.md og `sql/README.md`, altså to steder,
ingen læser, når de har filen åben. En håndredigering bliver tavst overskrevet
ved næste eksport: ingen fejl, ingen konflikt, bare arbejde, der forsvinder.

**Datoens ordlyd er hele valget.** Et kørselsstempel ville give en diff hver
mandag, også når skemaet stod stille — og på standardgrens-vejen ville det åbne
en pull request med titlen *"skema-drift opdaget"*, hvor det eneste, der drev,
var kalenderen. En alarm, der er falsk hver uge, lærer man at holde op med at
læse. "Sidst ændret" svarer desuden på det, læseren faktisk spørger om: er en
migrering kørt i produktionen efter den dato, er filen bagud.

---

## 15. august 2026 — `G122`: bagstopperen for et tabt resultat hører i live-syncen, ikke i kampprogrammet

**Beslutning:** `sync-live` fejer én gang i timen efter kampe, der er 6–36 timer gamle og stadig står uden endeligt resultat, med et loft på 40 kampe pr. fejning. `sync-matches`' kadence på hver 12. time er **uændret**, og der er ikke oprettet et nyt cron-job.

**Begrundelse — den ene af backloggens to veje var allerede bygget.** Rækken foreslog enten en hyppigere `sync-matches`-kadence eller «en genopfriskning af de seneste dages kampe i selve kampprogram-kaldet». Den anden findes i forvejen: begge providere henter hele sæsonen, og `matchUpsertRow()` skriver score for hver kamp, der er `finished`, ved hver eneste kørsel. Der var altså ikke en manglende genopfriskning at bygge — kun en **latens** på op til 12 timer.

**Hullet er smallere end rækken beskrev, og det flyttede rettelsen.** `sync-live` spørger allerede på kampe uden endeligt resultat med kickoff op til **6 timer** tilbage, så backloggens eget eksempel — en halv times nedetid lige efter kampen — er dækket i dag: jobbet henter kampen igen, så snart det kommer op. Det virkelige hul er kampen, der er **mere end 6 timer** gammel uden resultat. Den falder ud af vinduet og har ingen anden vej ind end næste kampprogram-kørsel.

**Hvorfor `sync-live` og ikke en hyppigere `sync-matches`.** Kampprogram-jobbene er syv, ét pr. turnering, og fem af dem deler football-data.orgs rate limit på 10 kald/minut med seks minutters mellemrum. En hyppigere kadence koster derfor både kald og en omlægning af minuttallene — og reducerer kun vinduet i stedet for at lukke det. `sync-live` kører allerede hvert minut, kender allerede vejen fra kamp til leverandør, og laver for football-data **ét** kald uanset hvor mange kampe der spørges om.

**Hvorfor gatet er et minut i timen og ikke hvert minut.** Den tidlige retur i `sync-live` — «ingen kampe i tidsvinduet» — er hele jobbets forbrugsbegrænsning, og en bagstopper, der punkterer den, er dyrere end det hul, den lukker. En kamp, der **aldrig** kan få et resultat (udsat, med et `kickoff_at` der endnu ikke er skrevet om, eller uden for abonnementet) ville ellers udløse et leverandørkald hvert minut i døgnet rundt. Hver time giver 24 kald i værste fald frem for 1.440 og flytter latensen fra 12 timer til 1 — og det er den rigtige byttehandel: **et tabt resultat er en fejl, der skal rettes samme aften, ikke inden for et minut.**

**Hvorfor der også er en øvre alder.** Ud over 36 timer har `sync-matches` haft tre kørsler til at rette kampen. Er den stadig uden resultat, er den ikke et tabt slutfløjt længere, men et datapunkt, et menneske skal se på — og at blive ved med at spørge er da en udgift uden en modydelse.

**Hvorfor kvitteringen er tre-værdiet.** `staleChecked` mangler, når minuttet ikke var fejeminuttet, og står `0`, når der blev fejet uden fund. Et felt, der altid er der, holder man op med at læse (`A26`); et felt, der kun er der ved fund, kan ikke skelne «fejede, alt var fint» fra «holdt op med at feje» — og præcis dén skelnen er, hvad `A11` og `G43` hver især kostede noget at lære.

---

## 14. august 2026 — `G119`: en migrerings usynlige halvdel skal være en påstand, ikke en note

**Beslutning:** enhver migrering, der `drop`per og gen-opretter en funktion i `public`, skal gentage **både** `grant execute … to <roller>` og `revoke execute … from public` — og den skal have en test, der efterprøver begge retninger, hos migreringen selv.

**Begrundelse.** `#65` gentog kun den ene af de to. Ikke af sjusk, men fordi fælden er asymmetrisk: en glemt `grant` lukker driftskortet for ejeren i samme sekund og bliver rød i den allerførste påstand, mens en glemt `revoke` ikke ændrer noget, nogen kan se. Filen havde endda en kommentar om, at grant'en "ikke er pynt" — opmærksomheden var dér, den bare ikke rakte til den halvdel, der ikke gør ondt.

**Hvorfor en påstand og ikke en skærpet note.** Reglen fandtes allerede, ordret, i `DOCUMENTATION.md` §13 — skrevet 12. august under `G100`, overtrådt 14. august. Det er dokumentationens grænse, og den er værd at skrive ned som en beslutning: **en regel, der kun findes i prosa, bliver overtrådt af den, der skrev den.** Havde svaret været "skriv det tydeligere", ville rækken her være den anden af tre.

**Hvorfor påstanden bor i `sql/tests/job_health_rate.sql` og ikke i den generelle vagt.** CI har i forvejen en vagt over samme regel, `sql/tests/anon_grants_functions.sql`, men den måler `sql/schema.sql` — et øjebliksbillede, der eksporteres om mandagen. Den kan altså ikke se en migrering, der er skrevet i dag. Påstanden skal ligge dér, hvor den kan være rød i en **pull request**, og det er hos den fil, der kan bryde reglen.

**Overvågningen erstatter ikke testen, og testen erstatter ikke overvågningen.** `job-heartbeat.yml`s femte kontrol fandt fejlen i produktionen efter tyve minutter, og det er ikke et nederlag — det er `G100`s formål. Men den finder den EFTER kørslen, og prisen er en rød alarm en aften plus en gen-kørsel. De to lag måler samme regel på hver sin side af udrulningen, og begge skal findes.

**Hvad der bevidst IKKE blev bygget:** en generisk kontrol, der læser alle migreringsfiler og kræver et `revoke` efter hvert `drop function`. Der findes to `drop function` i hele `sql/`, og den anden gen-opretter ingenting. En tekstlæsende vagt over to forekomster ville koste mere at vedligeholde, end den kan fange — og den kan pr. konstruktion kun se filer, ikke databasen, hvilket er præcis den svaghed, `G100` fandtes for at rette. Noteret i backloggens indbakke, hvis en tredje forekomst gør den til et mønster.

---

## 14. august 2026 — `G118`: tips-status bor ét sted, og det er ikke i historien

**Beslutning:** dagskortets fod (næste kamp / manglende tips) fjernes. `DayCard` slutter på mini-stillingen, og tips-status bor alene i sit eget kort på Hjem — deadline-kortet, det grønne "alt ok" eller "intet at tippe lige nu".

**Begrundelse.** De to kort hang på ordret de samme udtryk, så foden var ikke en gentagelse, der *kunne* opstå — den var en gentagelse, der ALTID opstod, i alle tre tilstande. Og den var altid den fattigste af de to: nedtællingen, rundenavnet og de manglende kampes navne står kun på kortet nedenunder.

**Hvorfor det er kortets fod og ikke kortet nedenunder, der forsvinder.** Det oplagte alternativ var at lade dagskortet bære handlingen og skjule tips-kortet, når kortet allerede sagde det — det var trods alt spec'ens oprindelige intention. Det ville koste nedtællingen, rundenavnet og kampnavnene på netop de dage, hvor der ER et dagskort, altså kampdagene. Hjem ville miste sit signaturkort, præcis når det betyder mest.

**Den generelle regel, rækken efterlader:** *et kort, der er valgt for at bære ét øjeblik, må ikke slutte på en opgave.* Dagskortets ene job er dagens historie; opgaven har sit eget kort, og skærmen er ikke i tvivl om, hvor man trykker. Rundestoryen havde aldrig foden, og asymmetrien var det første tegn.

**Spec'en er rettet frem for koden.** `story-engine-v3.md` §8 opregnede foden som en del af kortets indhold, men sætningen hvilede på en forudsætning, der aldrig blev til noget: at dagskortet skulle ERSTATTE deadline-kortet (`DayCard.jsx`: *"står PÅ kortet og ikke i et kort mere"*). Når spec'ens forudsætning ikke holder, er det spec'en, der er forældet — linjen er streget over og begrundelsen skrevet frem, så det fremgår, at noget blev ændret undervejs.

---

## 14. august 2026 — `I23`: manifestets skærmbilleder tages af appen selv, og `id` fryses frem for at sættes

**Beslutning:** `public/manifest.json` får `id: "/"`, `scope: "/"`, `lang: "da"` og fire skærmbilleder. Billederne genereres af `scripts/screenshots/capture.mjs`, som kører den rigtige app mod en attrap-database i en headless Chromium; de committes sammen med koden og tages om i hånden, når skærmene ændrer sig.

**`id` sættes til den værdi, den allerede har.** En PWA's identitet er `id`, og er feltet tomt, udleder browseren den af `start_url`. Det gør `start_url` til en identitet, den ikke burde være: flyttes appen en dag til fx `/app`, ville en installeret genvej høre til en app, der ikke findes mere — uden fejl og uden opdateringer. `"/"` ændrer derfor ingenting i dag og er præcis pointen: den fastholder identiteten, så `start_url` kan flytte sig senere uden at tage identiteten med. **Feltet må aldrig ændres bagefter**, og fordi JSON ikke kan bære en kommentar, står den regel i `manifest.test.js` — som en påstand og ikke som en note.

**`lang: "da"` og ikke `"da-DK"`,** fordi `index.html` siger `<html lang="da">`, og to steder, der siger næsten det samme, er den slags forskel, ingen opdager. Testen måler manifestet MOD html'en frem for mod en konstant, så de kun kan skifte sammen.

**Skærmbillederne tages af appen, ikke af en tegner.** Det oplagte var fire mockups i HTML: hurtigere at lave, og fuldstændig frikoblet fra produktet fem minutter efter. En attrap af en skærm kan vise hvad som helst — også noget, appen ikke kan — og fejlen ville stå på et markedsføringsmateriale uden at kunne fanges af nogen test. Harnessen kan pr. konstruktion kun vise det, appen tegner.

**Snittet ligger på `fetch` og ikke på `src/lib/data.js`.** Byttede vi datalaget, ville skærmbillederne vise en app, hvis datalag ikke findes i produktionen. Alt går gennem ét `fetch` i `src/lib/supabase.js`, så en attrap dér efterlader hver eneste linje ovenover urørt. Prisen er, at attrappen skal kunne det stykke PostgREST, appen bruger — seks operatorer, talt op i koden frem for gættet — og en forespørgsel med noget andet KASTER frem for at svare tomt: et tomt svar bliver til en tom skærm, og en tom skærm i en PNG ser ud som et designvalg.

**Demo-dataene regnes med appens egen `pointsFor()`.** En håndskrevet stilling kunne modsige kampresultaterne på nabobilledet. Undtagelsen er ratingtallene, som er grove med vilje: motoren bor i `sql/rating_core.sql` og kan ikke køre i en browser, og et gæt, der ser ud som en beregning, er værre end et gæt, der er mærket som et.

**Gentagelighed er et krav og ikke en bekvemmelighed:** skal ét billede tages om, må de tre andre ikke skifte med. Derfor fryses uret, og derfor køres browseren med `--force-prefers-reduced-motion` — live-prikkens puls gjorde ellers billedet afhængigt af, hvornår den virtuelle tid løb ud. Valget af netop det flag frem for indsprøjtet CSS er det samme princip som ovenfor: det er en tilstand, appen selv har (`G22`), og som en rigtig bruger kan se.

**Chromium køres på sin egen kommandolinje frem for gennem Playwright.** Fire runtime-afhængigheder er et bevidst valg i dette repo, og et browser-bibliotek for fire PNG'er er ikke en god handel. Prisen er, at maskinen skal have en Chrome — scriptet leder de sædvanlige steder og siger tydeligt fra med `CHROME=<sti>` som udvej. **Vinduets mål aflæses frem for at skrives:** `--window-size` er ikke viewporten, og forskellen er ikke den samme fra browser til browser, så scriptet spørger browseren først og beskærer bagefter til appens egen ramme.

**Den halvdel, der ikke er gratis, er accepteret som en manuel opgave.** Skærmbillederne kan ikke holde sig selv ajour, og ingen test kan se, at et billede viser en forældet skærm. Alternativet — at bygge dem i CI ved hvert deploy — ville betyde en browser i byggeprocessen og et billede, der ændrer sig, uden at nogen har set det. Valget er i stedet en linje i tjeklisten før merge, samme form som `build-og-image.mjs` har haft siden `I7`.

---

## 14. august 2026 — `G117`: live-opslaget får ét udgående kald pr. kørsel, fordi kalderen bestemmer

**Beslutning:** gen-forsøget ved timeout fjernes fra live-opslaget. `LIVE_BUDGET_MS` sænkes fra 40 til 25 sekunder, og `smFetch()` kaldes med `retries: false` fra live-stien. De to sæson-opslag er uændrede og beholder `G48`s 429-gen-forsøg.

**Begrundelse.** cron-job.org afbryder kaldet efter 30 sekunder, og det er maksimum på planen — feltet afviser 60. Den yderste grænse i kæden er dermed også den strammeste, og den er ikke vores at vælge. Ét kald à 20 s plus Supabase er ~22 sekunder og passer; to kald er ~42 og gør ikke. Der er ikke et sted at gemme et gen-forsøg.

**Hvorfor ikke i stedet sænke kald-grænsen, så to kald kan være der.** De kørsler, der LYKKEDES efter `G109`, tog 18-19 sekunder. En grænse under det ville genskabe `G109` — altså gøre langsomme kald til fejlede — for at få plads til et gen-forsøg, hvis eneste værdi er at spare ét minuts forsinkelse. Det er den forkerte handel.

**Hvorfor ikke acceptere, at fejlende kørsler overskrider kalderens vindue.** Fordi det log, cron-job.orgs auto-deaktivering tæller på, så ville vise sin egen afklipning i stedet for vores fejl — og auto-deaktivering er den ene mekanisme, der kan slukke live-syncen helt og tavst.

**Gen-forsøget er jobbet selv.** `sync-live` kører hvert minut. Et gen-forsøg inde i kørslen sparer højst 60 sekunders forsinkelse og fordobler til gengæld belastningen på en leverandør, der allerede er ved at drukne — samme afvejning som `G48` traf for 429.

**`retries: false` og ikke "budgettet udelukker det alligevel".** Det er `G116`s lære, brugt med det samme: et gen-forsøg, der ikke skal findes, skal slås fra ved navn. En betingelse, der tilfældigvis altid er falsk, er ikke en beslutning — den er en fejl, der ser ud som en.

**Den generelle regel, rækken efterlader:** *den yderste grænse i en kæde skal være den løseste, og grænser uden for repoet tæller med.* En indstilling hos en tredjepart er lige så bindende som en konstant i koden og hører skrevet ned samme sted som den — i dette tilfælde i `docs/CRON.md`, som i forvejen er registeret over netop de indstillinger.

---

## 14. august 2026 — `G116`: et tidsbudget må ikke være en usynlig betingelse for det, det skal begrænse

**Beslutning:** gen-forsøget ved timeout i `smFetch()` får `min(perCall, resten af budgettet)` og kræver kun `LIVE_MIN_CALL_MS` tilbage — ikke en hel tidsgrænse. Budgettet (`LIVE_BUDGET_MS`) forbliver 40 sekunder og forbliver loftet.

**Begrundelse.** `G109` tilføjede et gen-forsøg og et budget samme dag og satte budgettet til præcis 2 × tidsgrænsen med kommentaren *"40 s budget er 20 s kald + 20 s gen-forsøg"*. Regnestykket går op på papiret og aldrig i virkeligheden: et timeout bruger hele tidsgrænsen plus den smule, opsætningen koster, så betingelsen *"er der en hel tidsgrænse tilbage?"* var falsk hver eneste gang. Gen-forsøget var død kode fra det øjeblik, det blev skrevet, og det blev opdaget fem timer senere ved at sammenholde kørslernes varighed hos cron-job.org (21,7 s) med, hvad to forsøg ville koste (~41 s).

**Hvorfor ikke bare hæve budgettet til 45 sekunder.** Det ville virke i dag og genskabe fælden ved næste ændring af et af de to tal — koblingen "budget = 2 × grænse" stod ingen steder som en regel, og den næste, der justerer tidsgrænsen, har ingen grund til at kigge på budgettet. **Den rigtige rettelse på en skjult kobling er at fjerne den, ikke at give den mere luft.**

**Prisen er 100 millisekunder af gen-forsøget** (19,9 sekunder mod 20). Mod en leverandør, hvis svartid vandrer omkring grænsen, er det ikke til at måle.

**429-pausen beholder den strenge form**, og det er ikke en inkonsekvens: dér er første kald et hurtigt SVAR, så budgettet er reelt urørt, når spørgsmålet stilles, og `G48`s afvejning er en anden — hellere fejle højlydt end vente en ventetid, Vercel klipper over.

**Den generelle regel, rækken efterlader:** *en test af et tidsbudget skal bruge tid.* `G109`s test kastede sit timeout øjeblikkeligt og var derfor grøn for både den rigtige og den forkerte implementering. Det er samme klasse som `G103`s vagt, der var grøn to gange, før den målte noget — en test, man ikke har set fejle, er ikke set.

---

## 14. august 2026 — `G115`: driftskortet måler nu en fejlrate, ikke kun en fejlserie

**Beslutning:** `admin_job_health()` svarer også fejlraten i **to** vinduer — sidste time og sidste døgn — og et job vises som `ustabil`, når mindst 10 % af mindst fem kørsler i **enten** vinduet fejlede, også når den seneste kørsel lykkedes.

**Begrundelsen er en observation og ikke en teori.** Under `G109` fejlede `sync-live` omtrent to ud af tre minutter i en time, mens Admin → Drift stod på **OK** og **Fejl i træk: 0**. `consecutive_failures` tæller fejl siden seneste vellykkede kørsel og nulstilles derfor af enhver succes; for et job, der kører hvert minut og fejler to ud af tre, er hver tredje kørsel grøn. Tælleren kan altså ikke skelne "virker" fra "virker hver tredje gang", og det er præcis den skelnen, et minut-job kræver.

**Fire valg, og hvert af dem kunne være truffet anderledes:**

**To vinduer og ikke ét — afgjort af data, ikke af design.** Beslutningen blev truffet med ét døgnvindue, og den var forkert. Ejerens opslag i `job_runs` viste bagefter, at `G109` var 25 fejl ud af 37 kørsler på 33 minutter: 68 % af timen, 1,7 % af et døgn. Døgnvinduet ville have kaldt hændelsen sund, altså have fejlet på præcis den sag, det blev bygget til. **Læringen er generel: en målings opløsning skal være finere end det fænomen, den skal se** — og "intens og kort" og "svag og lang" er to fænomener, som ét vindue ikke kan dække. Timen fanger den første, døgnet den anden; ingen af dem begge.

**Et TIDSvindue frem for "de sidste N kørsler."** Databasen kender ingen kadencer — dem kender kun `docs/CRON.md` og `src/lib/ops.js`. 30 kørsler er en halv time for `sync-live` og en halv måned for et kampprogram-job, så et antalsvindue ville betyde noget forskelligt for hvert job og kunne vise en fejl fra to uger siden som "nu".

**Rå tal i svaret, procenten i klienten.** Nævneren er selv oplysningen: "2 af 1.431" og "2 af 2" er samme brøk og to vidt forskellige situationer. Havde funktionen svaret en procent, ville tallet ikke kunne aflæses uden et opslag mere.

**Grænsen på fem kørsler er en beskyttelse af kampprogram-jobbene.** To kørsler i døgnet gør "1 af 2" til 50 %, og et kort, der er gult, hver gang et 12-timers job hikker én gang, lærer man at ignorere — samme afvejning som `B8`s tolerance for `season-not-published` og som heartbeat'ens tre-fejl-grænse. For dem er fejlserien i forvejen hele historien, fordi hver kørsel vejer.

**Raten hæver til `ustabil`, aldrig til `fejler`.** Den sidste tilstand er den, heartbeat-workflowen råber på, og den hører til et job, der er holdt op med at virke. Et job, der fejler halvdelen af tiden, virker — dårligt. Ordet findes allerede og betyder det rigtige.

**Hvad beslutningen IKKE er.** Den gør ikke live-syncen mere robust og forklarer ikke, hvorfor Viborg FF–AGF ikke blev færdigmeldt af de grønne kørsler efter `G109`-deployet. Den gør alene den slags nedetid **synlig**, så næste gang kan afgøres med et blik frem for med et SQL-opslag. Rækken kom netop af, at ejeren gjorde det rigtige — kiggede i Drift — og fik det forkerte svar.

---

## 14. august 2026 — Tier 2 kørt: tre steder, hvor hjemmesiden og appen beskrev det samme produkt forskelligt

**Beslutning (produktejeren):** backloggens Tier 2 er kørt tom. De tre rækker —
`A54` (turneringens navn), `A55` (`is_official=false` mod sitets salg af
turneringen som live-flagskib) og `A56` (beta-mærkatet, der kun fandtes ét af
stederne) — er afgjort samlet, fordi de er den samme fejlklasse: **to flader,
der beskriver det samme produkt forskelligt.** Svarene er derimod ikke ens, og
det er hele pointen med at tage dem sammen.

**`A54` — sitet beholder "Skotske Premiership", `leagues.name` beholder
"Scotland Premiership".** Rækken sagde selv, at spørgsmålet var *præcis* det,
`A49` afgjorde for La Liga/Primera División 13. august, og at svaret dér var
formen. Formen holder: sitet er marketing og møder folk på det danske ord;
`leagues.name` er leverandørens navn, og et navn i en `leagues`-række er **data,
ikke tekst**. Ingen migrering, ingen kodeændring. To ting bekræftede, at det ikke
bare var en genbrugt begrundelse: sitets egen brødtekst skriver i forvejen "den
skotske Premiership" fire steder, altså er det danske ord dét, siden allerede
taler i — og turneringen hedder i virkeligheden hverken det ene eller det andet
(officielt "Scottish Premiership"), så "ét fælles navn" ville have været et
tredje navn og ikke et af de to.

**`A55` — turneringen forfremmes, frem for at sitet tager forbehold.** Her
valgte ejeren den dyre udgang, og begrundelsen er, at forudsætningen for `false`
var udløbet. `is_official = false` blev sat 31. juli med ordene *"en generalprøve
for flere turneringer, ikke en turnering, nogen skal vinde titler i"* — og
generalprøven er overstået: to uger med rigtige kampe, rigtige tips og en
live-sync, og hele maskineriet (scope-dimensionen, per-turnering-stillingerne,
`scopeNote()`) er afprøvet af netop den turnering. Et forbehold i sitets copy
ville have skrevet en midlertidig tilstand ind som et vilkår.

**Prisen er, at forfremmelsen virker BAGUD, og den er accepteret med åbne øjne.**
Stillingerne er views og regnes ved hvert opslag, så skotske tips træder ind i
alle historiske runder og måneder i samme sekund; `recompute_ratings()` er en
fuld genopbygning fra runde nul. Placeringer i tidligere runder kan altså skifte
— også i en runde, hvis Champion allerede er annonceret. Det er ikke en
bivirkning, men konsekvensen af `A17`s regel om, at "officiel" betyder det samme
overalt: en officiel turnering har altid talt med. **To ting følger af det, og de
er skrevet ind i migreringen** (`#64 tournament_scotland_promote.sql`): den skal
køres **mellem to spillerunder** — betingelsen, `#24` skrev om netop denne
turnering, og som holdt i to uger — og den kalder selv `recompute_ratings()`,
så skiftet sker på ét kendt tidspunkt frem for ved den næste tilfældige
målscoring, hvor triggeren ellers ville have fyret den midt i en runde.

**Det, forfremmelsen IKKE gør, er at skrive historikken om:** `stories`, afsendte
notifikationer og milepæle er skrevet ud fra den gamle afgrænsning og bliver
stående. Samme vilkår som den modsatte vej (`DOCUMENTATION.md` §5).

**En fælde blev lukket i samme ombæring, og den var større end selve
beslutningen.** `sql/tournament_scope.sql` (#20) satte `is_official = false` på
`501` som en sidegevinst midt i et script, der definerer to views — og som
derfor **skal** gen-køres, hver gang de views ændrer sig. En helt almindelig
gen-kørsel ville have rullet forfremmelsen tilbage tavst og flyttet både rating
og titler for alle brugere. **Og gen-kørslen er ikke hypotetisk: den er en anbefaling, vi selv har
automatiseret.** `job-heartbeat`-workflowen tjekker, om stillings-viewene har
deres `scope`-kolonne, og dens `rettelse`-felt siger ordret *"Kør
sql/tournament_scope.sql igen (#20 afløser #12)"*. Den fælde ville altså være
blevet stillet af en overvågning, der gjorde præcis sit arbejde. Sætningen er
fjernet frem for rettet: den var en
**starttilstand skrevet som en regel**, og det er `G65`s fejl en gang til —
`is_visible`/`is_official`/`live_enabled` er manuelle valg, og et script, der
sætter dem i forbifarten, kan ikke gen-køres uden at tage valget om igen.

**Sitets copy skulle ikke røres — det var netop dét, valget afgjorde.** "Point,
stilling og rating opdateres i alle turneringer" bliver sandt i samme sekund,
migreringen køres. Og i appen forsvinder `scopeNote()`-linjen af sig selv:
funktionen returnerer `null`, når der ingen uofficielle turneringer er. Spec'en
forudsagde det ordret — *"linjen forsvinder af sig selv, den dag alle synlige
turneringer er officielle"* — så leverancen bekræfter en regel, der blev skrevet
seksten dage før den kunne afprøves.

**`A56` — appen bærer nu også "Beta".** Alternativet var at fjerne mærkatet fra
sitet, og det ville have rullet `A48` tilbage to dage efter, den blev truffet,
uden at dens begrundelse (en fejl på et nyt site læses som sjusk frem for som
beta) var blevet usand i mellemtiden. Mærkatet bor i `src/ui/Wordmark.jsx` og
ikke i de tre kaldesteder, af samme grund som mærket selv gør: **`A48`s
exit-kriterium skal kunne udføres ét sted i appen og ét på sitet** — ikke tre
plus fem. Kriteriet gælder nu begge flader: fjernes mærkatet, fjernes det begge
steder. Størrelsen følger bevidst ikke `size`, fordi headerens plads er talt
(kommentaren ved `<Wordmark size={20} />` regner den ud på en 320 px skærm), og
et mærkat, der voksede med mærket, ville konkurrere med navnet.

**Det, der binder de tre svar sammen:** uenigheden mellem to flader er ikke i sig
selv en fejl. `A54` er to rigtige navne til to forskellige formål; `A55` og `A56`
var to flader, hvor den ene beskrev en verden, den anden var holdt op med at være
i. Spørgsmålet er altså aldrig "siger de det samme?", men "beskriver de begge
noget, der er sandt?".

---

## 14. august 2026 — `G109`: en langsom leverandør må ikke behandles som en fejlende

**Beslutning:** Live-opslaget hos Sportmonks får sin **egen** tidsgrænse pr.
kald (`LIVE_TIMEOUT_MS`, 20 s, mod standardens 10) og **ét** gen-forsøg, når
kaldet løb ud i tid — begge bundet af et samlet tidsbudget for hele opslaget
(`LIVE_BUDGET_MS`, 40 s). Standardgrænsen fra `G19` står uændret for alle andre
udgående kald, herunder de to sæson-opslag hos samme leverandør.

**Anledningen:** `sync-live` fejlede aftenen den 14. august 2026 i omtrent to ud
af tre minutter. Fejlen var hver gang den samme og aldrig et svar fra
leverandøren: `Tidsgrænse: intet svar fra …/fixtures/multi/<id> inden for
10000 ms` — ét fixture-id i adressen og den letteste include-kombination,
endpointet kan få. Der var altså intet i kaldet at optimere.

**Det, der afgjorde diagnosen, var de kørsler, der LYKKEDES.** De tog 7-13
sekunder. Succes og fejl lå i samme interval, bare på hver sin side af 10, og
det er signaturen på en leverandør, hvis svartid vandrer omkring vores loft —
ikke på et nedbrud og ikke på en fejl i koden. Klokken var 20 dansk tid, og
Sportmonks skriver selv, at deres livescore-endpoints er tunge i myldretiden.
**Den generelle regel, der kom ud af det:** en fejlrate, der ikke er 100 %, skal
læses på de grønne kørsler. Er de lige under grænsen, er grænsen fundet.

**Hvorfor grænsen måtte hæves netop dér.** `G19`s 10 sekunder blev valgt for at
afskaffe kald, der **hænger** — dét, der efterlader en kørsel uden en
`job_runs`-række overhovedet. Et kald, der svarer på fjorten sekunder, hænger
ikke; det er langsomt. De to ting havde samme grænse, og derfor kaldte vi et
langsomt svar for en fejl. Grænsen er hævet dér, hvor problemet er, og ikke
overalt: sæson-opslagene kører hver 12. time og har ingen grund til at vente
længere.

**Hvorfor gen-forsøget kun gælder timeouts.** En timeout er en påstand om, at vi
ikke ved, hvad der skete, og den ene ting, der giver mening at gøre ved den, er
at prøve igen. En 403 eller en ECONNREFUSED er derimod et **svar** — og et
gen-forsøg på et svar er bare et kald mere. Skellet bæres af et mærkat på
fejlen selv (`isTimeoutError()` i `api/_shared.js`) og ikke af fejlteksten, som
er skrevet til mennesker og må omskrives. Gen-forsøget er desuden **ikke** et
fald tilbage til en mindre include: en timeout siger intet om, hvad
abonnementet indeholder (samme skel som `G48` trak for 429).

**Hvorfor budgettet ikke kunne udelades — det er beslutningens anden halvdel.**
Et højere kald-loft uden et budget flytter blot afklipningen op til funktionens
`maxDuration` på 60 s, og dér fejler kørslen **uden at efterlade en fejl at
læse**. Det er præcis den tavshed, `G19` blev bygget for at afskaffe, så den må
ikke komme ind ad bagdøren. Regnestykket er 20 s kald + 20 s gen-forsøg for én
klump, med 20 s tilbage til Supabase-opslagene og skrivningen. Budgettet gælder
også `G48`s 429-pause, som ellers kunne lægge op til 30 sekunder oven i et
langsomt kald: kan pausen og kaldet efter den ikke nås, leveres 429'eren videre
som en højlydt fejl frem for som en ventetid, Vercel klipper over.

**Valgt fra:** at dæmpe fejlen (kun melde kørslen rød efter N fejl i træk).
Heartbeat'en råber allerede først ved tre fejl i træk, og en kørsel, der ikke
hentede det, den skulle, ER mislykket — at kalde den grøn ville gøre Admin →
Drift til et ringere instrument for at gøre en aften mindre støjende.

**Prisen, sagt tydeligt:** en dårlig kørsel kan nu bruge op mod 40 sekunder på
at vente i stedet for 10, og en kamp, der slutter i netop det minut, meldes
færdig et minut senere. **Det er også grunden til, at budgettet er 40 og ikke
55:** jobbet kalder hvert minut, så en kørsel skal kunne blive færdig inden for
sit eget minut. Skulle to alligevel overlappe, er skrivningen en idempotent
upsert på `api_fixture_id` — to kørsler, der ser det samme, skriver det samme.

---

## 14. august 2026 — `G106`: et view, ikke en fan-out — kur efter om antallet af kald er bundet

**Beslutning:** Ligaer-fanens medlems- og konkurrencetal tælles i databasen af
viewet `group_counts` ([`#62`](../sql/group_counts.sql)), ikke af `db.count()`
pr. liga og ikke af et synligt loft.

**Rækken var åbnet dagen før med de tre veje skrevet ned**, netop fordi `G101`s
kur ikke kunne kopieres: dér tælles deltagere i ÉN ligas konkurrencer, så
fan-out'en er bundet. Her er nævneren brugerens ligaer **gange to** — ti ligaer
bliver tyve rundture, hvor der i dag er to.

**Hvorfor ikke et synligt loft (`G35`s mønster).** Det var den billigste vej og
den, der lignede husets egen mest. Men `G35` findes til en **liste**, brugeren
kan handle på — *"skal du bruge en kamp længere ude i fremtiden, så opret
konkurrencen som en hel sæson"*. En afkortet **optælling** har ingen handling,
kun en undskyldning på et tal. Mønsteret passede altså ikke, selvom det stod
lige ved siden af.

**Viewet fjerner nævneren frem for at håndtere den.** Aggregeringen sker i
databasen, svaret er én række pr. liga, og det loft, der er tilbage, er antallet
af ligaer — nøjagtig det, `groups`-opslaget ved siden af allerede er bundet af,
og dermed ikke et nyt. Prisen er en migrering, der **skal køres før
frontend-mergen**: et opslag mod et view, der ikke findes, svarer 404, altså en
tom Ligaer-fane. Det er en ægte afhængighed den ene vej, modsat `#57`/`#59`.

**`security_invoker` er bærende og ikke pynt.** Et view kører som standard med
sin ejers rettigheder og ville da svare uden om RLS — altså en offentlig
optælling af enhver ligas størrelse. Med `security_invoker` arver tallene
kalderens egne policies på alle tre tabeller, og følgen er, at migreringen
**ikke ændrer ét tal på skærmen**: samme rækkemængde, bare talt ét sted. Testens
negative kontrol måler netop dét — en fremmed må ikke få en forkert række, hun
må slet ikke få en.

🔴 **Beslutningen fandt en skriveflade, ingen havde bedt om.** Supabases
`alter default privileges` giver `authenticated` ALLE privilegier på hver ny
relation i `public`. For basens øvrige views er det inert, fordi ingen af dem er
auto-opdaterbare — men `group_counts` **er** det, og uden et eksplicit
`revoke … from authenticated` kunne man skrive i `groups` gennem et view, der
findes for at tælle. Det er ikke en eskalering (`security_invoker` lader
`groups_update_admin` gælde), men det er den klasse, `write_surface.sql` findes
for. **Den generelle regel: en default, der har været harmløs i hvert tidligere
tilfælde, er ikke harmløs — den er bare ikke blevet ramt endnu.** Aflæst på
`information_schema.views.is_updatable` og nu en påstand i testen.

**Reglen, der er værd at tage med** (nu i `DOCUMENTATION.md` §13): vælg kur efter,
om antallet af kald er **bundet**. Er det, er `db.count()` billigst; vokser det
med noget, brugeren selv kan forøge, skal aggregeringen ind i databasen.

---

## 14. august 2026 — `G107`: et møde er en runde, begge kunne være med i

**Beslutning:** karriereprofilens indbyrdes opgør bærer deltagerens nulpunkt. En
kamp tæller kun i `h2h` og i `rivals`, hvis den låste **efter begge** meldte sig
til den delte konkurrence — `match_lock_at(…) > greatest(joined_at, joined_at)`,
ordret samme udtryk som `A53`s [`#61`](../sql/competition_join_baseline.sql).
Begge blokke i `sql/career_profile.sql` ændres, og de kan ikke ændres hver for
sig.

**Spørgsmålet var ikke en fejl, men en BETYDNING** — det er derfor rækken stod
som "afklar først, hvad tallet skal betyde" og ikke som en rettelse. Opgøret er
med vilje et andet spørgsmål end konkurrencens stilling: *"hvem af os to har
tippet bedst på det, vi begge har haft adgang til"*, dedupliceret pr. runde på
tværs af delte konkurrencer. Man kunne derfor have svaret, at bredden var
tilsigtet, og lukket rækken med én sætning i spec'en.

**Det blev den ikke, og grunden er ordet "adgang".** Uden nulpunktet spurgte
opgøret slet ikke om adgang — det talte hver kamp, en delt konkurrence dækker,
også dem, der var spillet og låst, længe før den ene overhovedet var med.
`predictions` er én række pr. `(bruger, kamp)` og deles på tværs af
konkurrencer, så tallet kunne hvile på gæt, den ene havde afgivet et **helt
andet sted**. Sætningen på skærmen — *"I jeres fælles konkurrencer har I mødt
hinanden N gange"* — var altså ikke bred, den var **usand**: der var ikke noget
møde. Og følgen var den samme, `A53` blev skrevet af: to steder i produktet med
hvert sit svar på det samme.

**Rækkevidden, og hvad der bevidst IKKE ændres.** Nulpunktet afgrænser
**adgangen**, ikke gættets oprindelse: en kamp, begge kunne tippe i en delt
konkurrence, tæller, uanset hvilken af deres konkurrencer gættet blev afgivet i.
Dedup'en er uændret, og leddet ligger **før** den, så en kamp tæller, hvis den
kvalificerer i mindst én delt konkurrence — den mildeste korrekte form. Titler,
rekorder og basistal røres ikke: de er turnerings-scopede og har slet ingen
konkurrence-dimension at melde sig til (samme afgrænsning som `#61` selv skrev).

**De to blokke er ét stykke arbejde**, og det er den vigtigste sætning her:
spec'ens testcase 41 kræver, at `rivals`-posten om en person og `h2h`-linjen på
den persons profil svarer det samme. Rettes kun den ene, siger produktet to ting
om samme forhold — altså præcis den fejl, rækken skulle lukke. Invarianten er nu
en påstand i `sql/tests/career_profile.sql`, som er funktionens **første**
SQL-test overhovedet.

---

## 14. august 2026 — `G108`: nulpunktet huskes, frem for at framelding spærres

**Beslutning:** en deltagers nulpunkt følger hende. Forlader hun en konkurrence
og melder sig til igen, arves `joined_at` fra første tilmelding
([`#63`](../sql/competition_participant_baseline.sql): en intern hukommelses-tabel
og to triggere). En HELT ny deltager har ingen historik og starter fortsat på 0.

**Det, der skulle afgøres, var ikke om fejlen var reel, men hvilken af to kure
der er billigst i det lange løb.** `A53` nulstiller korrekt for en ny deltager —
men `competition_participants` har ingen historik, rækken slettes ved framelding,
og `joined_at` har `default now()`. Da `comp_participants_delete_own_unlocked`s
gren (a) netop tillader framelding fra en konkurrence, hvor **alle** kampe har
resultat, er alle kampe låst i det øjeblik, man kommer tilbage — og hele sæsonen
tømmes i en stilling, der er endelig.

**Hvorfor ikke bare spærre for framelding.** Det var den anden vej, backloggen
navngav, og den er farligere end den ser ud. Gren (a) findes, for at man kan
forlade en konkurrence, man **har** spillet; og fordi liga-medlemskab og
konkurrencedeltagelse hænger sammen (`ensure_group_membership_for_participant()`),
ville en spærre i praksis låse folk inde i deres egen liga. Den ville altså bytte
en sjælden, grim fejl ud med en hverdagsagtig, grimmere. **En regel, der
forhindrer en almindelig handling for at beskytte en sjælden, er sjældent den
rigtige** — det er samme afvejning som `groups_delete_admin_empty`, bare med
fortegnet vendt.

**Rækkevidden er snæver med vilje, og prisen står nævnt:** reglen bliver "dit
nulpunkt er FØRSTE gang, du meldte dig til denne konkurrence". Det er præcis det,
`#61`s egen tekst allerede siger, den vil beskytte, så `A53` udvides ikke — den
får bare den hukommelse, den forudsatte. **Bagud omskrives intet:** hvem der
allerede har forladt og genindtrådt, efterlod ingen række at huske ud fra.
Verifikation 3 i filen tæller, om der findes nogen; er svaret ikke 0, skal de
sættes i hånden.

🔴 **Beslutningen fandt en fælde, der ikke var en del af rækken.** En
`on delete cascade` er selv en AFTER DELETE-trigger på den refererede tabel, så
forældrerækken er **væk**, når barnets triggere fyrer. En hukommelse, der skriver
en fremmednøgle til forælderen, ville derfor have brækket to af produktets mest
uigenkaldelige handlinger — slet en konkurrence, luk en konto — med `23503`, og
fejlteksten ville have peget på en tabel, ingen havde bedt om noget. Guarden er
samtidig den rigtige semantik: er konkurrencen eller brugeren væk, findes der
ikke noget at komme tilbage til. Fælden står nu i `DOCUMENTATION.md` §13.

---

## 14. august 2026 — `A53`: en deltager starter på 0 i den konkurrence, hun melder sig til

**Beslutning:** et gæt tæller i en konkurrence, hvis kampen **låste efter
deltagerens `joined_at`**. Reglen bor to steder og skal ændres begge steder på
én gang: `wasTippableAt()` i `src/lib/scoring.js` og
`public.match_lock_at(…) > cp.joined_at` i `competition_match_points` og
`award_competition_periods()` ([`#61`](../sql/competition_join_baseline.sql)).

**Beslutningen var ikke, OM princippet gjaldt — det var afgjort i forvejen.**
`filterTippable` materialiserer kun kampe, der stadig kan tippes, når en
konkurrence oprettes, og begrundelsen i `DOCUMENTATION.md` §3 er ordret det
scenarie, en bruger meldte 14. august 2026: *"deltagerne ville ikke stå lige,
for den, der ikke havde tippet kampen andetsteds, kan ikke nå det."* Værnet
sad bare på oprettelsen og havde ingen pendant på tilmeldingen. **Det, der
skulle afgøres, var derfor rækkevidden**, og den koster noget.

**Hvorfor hullet blev lukket frem for beskrevet.** To grunde, og den første
vejer tungest, fordi den rammer noget, der ikke kan trækkes tilbage: **en sen
tilmelding kan gøre allerede udsendte historier forkerte bagud.** Story Engine
fortæller om konkurrencens stilling, og en, der melder sig i sidste runde og
slår alle, omskriver den stilling, kortene beskrev — kortene er sendt, og
milepæle er permanente. Den anden er, at adfærden kunne spekuleres i: meld dig
sent til en turnering, du ved du har tippet godt. Den ene er en fejl i
produktet, den anden er en åbning i spillet.

**Reglen gælder ALLE deltagere, ikke kun dem, der melder sig efter
udrulningen.** Prisen er sagt højt: stillingen beregnes live, så enhver, der
allerede er meldt sent til noget, taber de point ved næste åbning — midt i en
igangværende konkurrence. Alternativet var en fast dato i både JS og SQL, som
skulle stå i dokumentationen for altid og lade det forkerte tal blive stående
sæsonen ud. **En regel med en fødselsdag er en regel, ingen kan læse sig til**,
og tallet, der udløste rækken, ville overleve rettelsen. Migreringens
verifikation 2 viser, hvem der taber point, før man kører den.

**Bagud omskrives intet, og det er ikke det samme som at reglen ikke gælder
bagud.** Skellet er, om tallet beregnes eller er gemt: stillingen beregnes live
og retter sig selv, mens alt frossent står stille — udsendte historier er
rækker i `stories`, kåringer er `on conflict do nothing`, milepæle er
permanente. En kåring, der allerede er faldet på det gamle grundlag, falder
ikke om.

**Rating og Championship er bevidst IKKE omfattet.** De er turnerings-scopede og
har slet ingen konkurrence at melde sig til (§5) — ratingen tæller netop hver
kamp én gang på tværs af alle officielle ligaer, og det er hele dens pointe.
Karriereprofilens indbyrdes opgør (`rival`) er heller ikke rørt: det er et
spørgsmål om to spilleres gæt på delte kampe, ikke om en konkurrences stilling.
Noteret i backloggen frem for taget med.

**To ting tæller MED, og begge er bevidste bagstoppere:** en ukendt
tilmeldingstid (en manglende værdi må aldrig kunne nulstille nogen — `joined_at`
er `not null` i skemaet, så det er en bagstopper og ikke en tilstand, databasen
kan levere) og en kamp uden kendt låsetidspunkt (den kan stadig tippes — samme
svar som RLS-policyens skrivegren).

🔴 **Rækken gjorde to ældre migreringer farlige at gen-køre.**
`#37 story_engine_v2_day.sql` og `#26 competition_awards.sql` bærer begge den
gamle definition og ruller reglen tavst tilbage. Begge står nu i
`sql/README.md`s liste, som dermed er vokset fra ti filer til tolv.

🔴 **Og den fandt en landmine, der først ville være sprunget om en uge.**
`sql/dev/simulate_season.sql` bakker kampene i tid, men lod `joined_at` tage sin
default (`now()`) — så under den nye regel var hver eneste simuleret deltager
"meldt til efter kampene var spillet". Symptomet var ikke en forkert stilling,
men en **tom sæson**: ingen kåringer, ingen historier. Testen er grøn i dag,
fordi `sql/schema.sql` er et øjebliksbillede uden migreringen; den ville være
blevet rød i det sekund, skema-eksporten kørte. Fundet ved at køre alle femten
skema-indlæsende tests fra **den anden side af dumpet** — §13's regel, tredje
gang den betaler sig.

---

## 14. august 2026 — `G103`: hjemmesidens story-eksempler får en vagt, og rækkens egen præmis bliver rettet

**Beslutning:** koblingen mellem `site/index.html`s story-kort og
`sql/story_engine_v3.sql` bevogtes af en test (`story-eksempler.test.js`) frem
for af en note i spec'en. Rækken tilbød de to som ligeværdige; de er de ikke.
En note virker kun for den, der læser spec'en, mens den redigerer SQL'en, og
det er præcis den person, der ikke gør det — samme argument som `G97` traf for
sælgesætningen.

**Men vagten kunne ikke måle det, rækken bad om.** Rækken skrev, at sitets
eksempler ER motorens ægte formuleringer. Det er de ikke ord for ord, og ingen
af de fire er:

* Motoren sætter ikke punktum efter en overskrift. Sitet gør, fordi kortene
  står som sætninger på en salgsside.
* Appen viser overskrift OG brødtekst (`screens/hjem/DayCard.jsx`), mockup'en
  har én linje. Stime-kortet er derfor overskriftens 🔥 sat foran brødtekstens
  ordlyd, og halen ("… efter den 3. august") er klippet af.
* Værdierne er valgt til et skærmbillede: "seks" med bogstaver, hvor motoren
  indsætter et tal.

Alle tre er redaktionelle valg, ikke drift. **En ordret sammenligning ville
derfor være en vagt mod noget, ingen har lovet** — og den ville tvinge sitet til
at skrive dårligere for at holde en test grøn. Vagten måler i stedet **ordene
mellem værdierne**: sitet markerer sine variable med `<span class="story-var">`,
hvert kort siger med `data-story-rule`, hvilken regel det citerer, og alt
derimellem skal stå i dén regels strenge.

**Markeringen bor i sitet og ikke i testen, og det er den samme beslutning som
`G97`s.** Vagten skriver ikke én kopi af ordlyden — gjorde den det, ville hun
selv blive det næste sted, der kan drive. Prisen er seks usynlige spans og fire
attributter i en håndskrevet HTML-fil; gevinsten er, at ordlyden må ændres frit,
så længe begge sider ændres.

**To ting gjorde den grøn, før den målte noget**, og begge blev fundet ved at
ødelægge SQL'en med vilje frem for ved at læse testen igennem:

1. **Ordlyden står også i en `--`-kommentar.** Duellens formulering forklares ti
   linjer over skabelonen (`G89`, hvorfor teksten kom i datid), så en søgning i
   hele filen finder en formulering, motoren ikke længere bruger. Vagten læser
   nu kun `'…'`-strenge.
2. **Ordlyden står også i en anden regel.** "Du sluttede dagen" bruges både af
   duellen og af regel 45 ("… som nr. 3 af 8"), så et omskrevet duel-kort kunne
   finde sine ord et andet sted i motoren. Derfor `data-story-rule`, og derfor
   ledes der kun i kortets egen regel.

**Læren er den generelle:** en vagt, der aldrig er set fejle, er ikke en vagt,
man har set. Begge huller ville have gjort filen til dekoration — grøn, kørt i
CI, og blind for præcis det, den blev bygget til.

---

## 14. august 2026 — `G101`: deltagerantallet tælles i databasen, og den idiomatiske vej fravælges, fordi den ikke kan prøves af

**Beslutning:** liga-siden tæller deltagere med `db.count()`, ét opslag pr.
konkurrence, kørt samtidig med det opslag, der i forvejen spørger om brugeren
selv. **PostgRESTs indlejrede `competitions?select=*,competition_participants(count)`
er fravalgt**, selvom den ville være ét kald frem for otte.

**Grunden til at gøre noget var ikke den, rækken angav.** Rækken bar `A43`s
måling — 2,2 ms for en liga med otte konkurrencer — og konkluderede selv, at
ombygningen ikke løste noget akut. Målingen står ved magt; den målte bare det
forkerte. Prisen ved at hente én række pr. deltager er ikke tiden, det er
**loftet:** PostgREST leverer højst 1000 rækker pr. svar og siger ikke, at den
klipper, så tallet på konkurrence-kortet ville en dag være for lavt uden en fejl
nogen steder. Det er den fælde, der kostede "· 0 kampe" i Opret → Sæson
(`DOCUMENTATION.md` §13, 1. august 2026), og reglen derfra — *tæl i databasen,
ikke i browseren* — havde bare ét sted tilbage, hvor den ikke var fulgt.

**Fravalget af den indlejrede optælling er et vilkår og ikke en smagssag.**
`A43`s runbog foreslog i sin tid ét `select competition_id, count(*) … group by`,
og den forespørgsel findes ikke som et almindeligt PostgREST-opslag: den kræver
enten aggregat-funktioner på en indlejret ressource eller et nyt databaseobjekt.
Repoet bruger **ingen** indlejrede selects i dag, så formen ville være ny — og
den kunne ikke afprøves: arbejdsmiljøets netværkspolitik afviser Supabase, så
end ikke et tomt svar kunne bekræfte, at syntaksen accepteres af projektet.
Det er `A32`s snit en gang til, bare på en syntaks frem for på et tal.

**Afvejningen er derfor asymmetrisk.** Gætter man rigtigt, spares syv kald på en
side, der ikke er langsom. Gætter man forkert, svarer PostgREST 400, og **hele
liga-siden fejler** — en fungerende side sat på spil for en optimering, rækken
selv kalder ikke-akut. `db.count()` er husets egen form, den bruges allerede af
`countMatchesPerLeague()` til nøjagtig samme opgave, og den er dækket af tests.

**Et view med tallene blev også fravalgt**, men på pris frem for på risiko: det
ville være en migrering, der skal køres i hånden i produktionen, plus grants og
en test — uforholdsmæssigt for et tal på et kort.

**Rækken fandt sin egen tvilling:** `loadMyGroups()` tæller ligaens medlemmer og
konkurrencer på præcis samme måde, tolv linjer længere oppe i samme fil. Den er
**ikke** rettet med, fordi kuren ikke er den samme — nævneren dér er brugerens
ligaer gange to, så fan-out'en ville blive tyve kald for ti ligaer. Den står som
`G106` med de tre veje skrevet ned.

---

## 14. august 2026 — `A52`: Vercel Web Analytics fravælges i appen, og hjemmesiden måles serverside

**Beslutning (produktejeren):** appen får **ikke** Vercel Web Analytics, og
hjemmesiden måles på **Vercels egne servertal** (Observability → Edge Requests)
frem for på et script. Begge dele er fravalg, og de har hver sin begrundelse.

**Appen: privatlivspolitikken var allerede skrevet, og den lover det modsatte.**
Pakken blev installeret og `<Analytics />` monteret i `src/main.jsx` (PR #206,
merget og udrullet samme dag) — den virkede, tallene kom frem i Vercels panel.
Men `src/lib/legal.js` har en sektion, der hedder **"Hvad vi ikke gemmer"**, og
tre af dens linjer holdt ikke længere:

* *"Der er ingen sporing ud over appens egen."*
* *"Ingen Google Analytics, ingen Facebook-pixel, ingen reklamenetværk, ingen
  tredjeparts-værktøjer…"*
* *"Ingen IP-adresse og ingen browser-oplysninger i vores brugslog."* — Vercel
  Web Analytics registrerer sti, henvisning, land, browser, OS og enhed.

To af politikkens linjer overlevede og er værd at notere, fordi de er dem, folk
plejer at falde over: **cookie-linjen holdt** (Vercel Web Analytics er
cookieløs), og **"intet hentet fra andres servere" holdt også** — scriptet
serveres i produktion fra `/_vercel/insights/script.js` på eget domæne, og
`va.vercel-scripts.com` bruges kun i udvikling (læst i pakkens `getScriptSrc`).
Det var altså ikke en teknisk hindring, der lukkede spørgsmålet.

**Det, der lukkede det, er rækkefølgen mellem de to dokumenter.** Appen har
sit eget måle-lag (`analytics_events`, `DOCUMENTATION.md` §21), som er bygget
til produktforbedring og beskrevet i politikken. Vercel-tallene ville lægge
besøgstal oven i det og til gengæld kræve, at et juridisk dokument blev
omskrevet for at passe til et værktøj, ingen havde bedt om. **En
privatlivspolitik er et løfte, ikke en beskrivelse, der løbende rettes til
efter, hvad der er blevet installeret.** Prisen for fravalget er, at der ikke
findes et besøgstal for appen — det er accepteret, fordi appen kræver login, så
"besøgende" og "brugere" er næsten samme tal, og det tal kendes allerede.

**Hjemmesiden: `script-src 'none'` er billigere at beholde end at bryde.**
`I25` (13. august 2026) fastslog, at sitets fravalg af JavaScript var intakt,
fordi burgermenuen kunne laves i ren CSS, og `site/vercel.json` gjorde fravalget
til en header. Vercel Web Analytics ville have kostet præcis ét direktivs
lempelse — `script-src 'none'` → `'self'`, ikke mere, da både script og beacon
er samme origin. **Men `'self'` er ikke en lille lempelse på et site uden JS:**
den flytter garantien fra "browseren nægter at køre script" til "vi har for
øjeblikket ingen scripts", og forskellen er hele pointen med at have skrevet
direktivet. Til gengæld giver **Observability → Edge Requests** requesttal med
henvisning, user agent og region **uden kodeændring og uden CSP-ændring**;
det er med på Hobby-planen. Kendte begrænsninger: opdelingen **pr. rute** er
bag Observability Plus (Pro), og Hobby har et loft på 50.000 hændelser/måned,
hvor hver HTML-, CSS-, font- og favicon-hentning tæller med — så tallet er
requests og ikke sidevisninger. **Det er groft nok til at svare på "vokser
trafikken", og det er dét, spørgsmålet var.**

---

## 13. august 2026 — Hjemmesiden gøres udrulningsklar: fire spørgsmål lukket på én gang

**Beslutning (produktejeren):** `I8`s resterende arbejde **i repoet** er udført,
og fire åbne rækker om hjemmesiden er afgjort samlet — `A48`, `A49`, `B33` og
`I25`. Ingen af dem ventede på en udløser uden for repoet; de ventede på et
valg. Tilbage af `I8` står to ting, som ikke kan skrives i en fil:
ejer-godkendelse af copy og trin 2 i [`DOMAENE.md`](./DOMAENE.md).

**`A48` — sitet bærer et "Beta"-mærkat, i headeren.** Rækken spurgte, hvornår
mærkatet måtte *fjernes* — men det fandtes ikke i `site/`, så spørgsmålet
forudsatte en tilføjelse, der aldrig var sket. Mærkatet står nu ved siden af
ordmærket på alle fem sider. **Exit-kriteriet er en del af beslutningen og ikke
en ny række:** det fjernes, når sitet har stået publiceret i en måned uden en
fundet fejl i copy eller flow. Prisen ved at have det er, at en besøgende får
sin forventning sat lavere, end produktet fortjener; prisen ved at undvære det
er, at en fejl på et nyt site læses som sjusk frem for som beta.

**`A49` — sitet beholder "La Liga", appen beholder "Primera División".** Rækken
skrev, at *"uanset hvad skal de to sige det samme"*. **Det er den forudsætning,
der falder** — ikke navnet. Sitet er marketing og skal møde folk på det ord, de
kender og søger på; appen viser turneringens officielle navn, som det står hos
leverandøren, og et navn i `leagues.name` er data, ikke tekst. En migrering for
at få dem til at rime ville røre rigtige rækker for at rette en forskel, ingen
bruger oplever som en fejl.

**`B33` — clean URLs slås IKKE til.** Rækken var betinget (*"hvis
site-Vercel-projektet får clean URLs slået til"*), og en betinget række uden
nogen, der har tænkt sig at trykke på betingelsen, står i Tier 6 for evigt.
Betingelsen er derfor afgjort til nej og skrevet ind som `"cleanUrls": false` i
`site/vercel.json`, så indstillingen er en linje i repoet frem for en klikbar
switch i et dashboard. **Begrundelsen er udkastets egen arbejdsform:** sitet har
intet build-step, og det læses korrektur på ved at åbne `site/index.html` i en
browser (`file://`). Clean URLs ville gøre hvert internt link til enten en
redirect eller et link, der kun virker i produktion — og canonical, `sitemap.xml`
og 20+ interne links skulle skiftes for at vinde en kosmetisk URL.

**`I25` — burgeren koster ingen JavaScript.** Rækken oplyste selv sin pris:
*"en burger-menu (koster den ene JS-afhængighed, `I8` har bevidst fravalgt)"*.
**Den pris var forkert.** En skjult checkbox plus en `<label>` gør præcis det
samme i ren CSS (`.nav-check:checked ~ .site-nav`), og fravalget "ingen JS
overhovedet" er dermed intakt. Det, rækken beskrev som en afvejning mellem to
onder, var et valg uden pris. Navigationen foldes bag burgeren under 700px —
ikke 880px, som rækken gættede på: målt i Chromium står de fem punkter på én
linje helt ned til 701px, og først derunder wrapper de. **En sticky header, der
wrapper, æder 159px af en 390px-skærm**; med burgeren er den 69px.

**Dertil to ting, ingen række bad om, men som udrulningen kræver:**

1. **`site/vercel.json`** med `Content-Security-Policy`, `X-Content-Type-Options`
   og `Referrer-Policy`, plus cache-headere til `fonts/` og `img/`. CSP'en er
   `script-src 'none'` — den **håndhæver** sitets egen regel om ingen JS, i
   stedet for at lade den være en sætning i en spec. `style-src` må have
   `'unsafe-inline'`, fordi siderne bærer 29 `style=`-attributter; med
   `script-src 'none'` er den tilladelse nær-harmløs. **Appens `vercel.json`
   røres ikke** — to origins deler ikke headere, hvilket er hele grunden til, at
   `I10`s beslutning ikke rørte CSP'en.
2. **Den vandrette scroll under 340px er væk.** `.phone` havde `width: 300px`,
   og en fast bredde gør grid-sporets min-content 300px, så containeren blev
   skubbet 4px ud. `width: min(300px, 100%)`. Fundet ved verifikationen, ikke
   af en række — udkastets egen verifikation målte 1280px og 390px, og fejlen
   lå imellem 320px og 340px.

**Copy'en er godkendt senere samme dag.** Afsnittet sluttede oprindeligt med, at
det ene, der ikke blev besluttet, var om copy'en var god nok at publicere — `I8`s
punkt 1, som kun ejeren kunne afgøre, foran siderne. Det skete: ejeren gennemgik
alle fem sider i et klikbart preview og godkendte uden rettelser. **`I8` har
dermed ét åbent punkt tilbage, og det ligger uden for repoet:** trin 2 i
[`DOMAENE.md`](./DOMAENE.md) — Vercel-projektet og DNS.

## 13. august 2026 — Backloggens tiers bærer rækker i tabeller, og reglen har fået en vagt

**Beslutning (produktejeren):** hvert punkt i `BACKLOG.md`s prioriterede
rækkefølge står som en **række i en tabel** under sit tier — også i Tier 1–5,
som hidtil kun var prosa. Et tier har præcis to lovlige tilstande: ordet `Tomt.`
eller en tabel. **Når indbakken tømmes, får hvert punkt en række**, ikke en
omtale i en sætning.

**Det er ikke en ny regel, og dét er hele pointen.** Den blev truffet
8. august 2026 med ordene *"Tier 1–5 viser nu deres rækker i stedet for referater
af, hvad der engang stod i dem"*. Fem dage senere bar **Tier 2 og Tier 5 begge et
referat** (*"Tomt. `G99` er leveret 12. august 2026 — se Log"*), og Tier 5's to
åbne punkter — `G101` og `G103` — stod inde i en sætning frem for som rækker.
Ingen af overtrædelserne så forkerte ud; de så ud som hjælpsomme noter. Det er
netop derfor, de overlevede hver eneste gennemlæsning.

**Hvorfor formen betyder noget.** Et punkt i prosa kan hverken tælles, skimmes
eller flyttes til et andet tier, uden at nogen omskriver et afsnit — og
backloggens ene løfte er, at den kan skimmes på et halvt minut. Referatet er
værre endnu: det er historik under en overskrift, der skal bære **tilstand**, og
historikken har allerede ét sted (filens Log, plus `DECISIONS.md` og
`CHANGELOG.md`, som er de to filer, der har lov at vokse).

**Vagten er `docs/backlog.test.js`, og den måler to ting med én påstand.**
Antallet i *"Alle N åbne punkter"* skal være lig antallet af tabelrækker i
tiers. Det er ikke en pedantisk optælling, men **den måde en formatfejl bliver
synlig på**: et punkt skrevet som prosa forsvinder fra tællingen og får tallet
til at stemme forkert. Dertil to billigere påstande — et tier er `Tomt.` eller
en tabel, og et tomt tier bærer ingen ID'er efter ordet `Tomt.` (præcis den
form, der blev fanget). **Alle tre er set fejle på de mutationer, de findes
for**, før de blev grønne.

**Det, vagten IKKE måler**, er sagt højt i dens hoved: om prioriteringen er
rigtig, om en række hører til i sit tier, og om teksten er god. Det kan kun et
menneske. Samme snit som `saelgesaetning.test.js` (`G97`), der vogter, at fem
filer siger det samme — ikke at sætningen er en god sætning.

## 13. august 2026 — `A47` lukkes: de to kendte `.vercel.app`-adresser ER listen

**Beslutning (produktejeren):** redirectet i `vercel.json` bliver stående med de
to regler, det har. Listen af aliasser aflæses **ikke** i Vercel → Domains, og
rækken lukkes uden den aflæsning.

**Hvorfor spørgsmålet kunne afgøres frem for aflæses.** Tre ting peger samme vej:

- **De to er Vercels standardsæt.** `prediction-champ.vercel.app` og
  `prediction-champ-predictor-champ.vercel.app` er præcis de to aliasser, et
  team-projekt får tildelt af sig selv — projektnavnet og projektnavnet plus
  team-slug. En tredje ville skulle være tilføjet i hånden.
- **Projektet er aldrig omdøbt.** Et navneskifte er den anden måde, et gammelt
  alias opstår på, og `B21` droppede netop Vercel-omdøbningen 12. august 2026
  (`I10`) — begrundelsen var, at den ville knække hvert link til den gamle
  adresse. Beslutningen om ikke at omdøbe er dermed også grunden til, at listen
  ikke kan være vokset bag om nogen.
- **Rækkens egen risiko var sat for højt.** Den skrev, at et link til en overset
  alias "ville knække". Det ville det ikke: en `.vercel.app`-adresse serverer
  **samme deployment** — det er hele grunden til, at redirectet i trin 6 skulle
  skrives i hånden, jf. `docs/mail/templates.test.js`' kommentar om, at Vercels
  gamle URL ikke redirigerer af sig selv. Prisen ved en overset alias er derfor,
  at brugeren bliver stående på en ikke-kanonisk origin — mærkbart for en
  installeret PWA og for kanonikaliteten, men ikke et brud.

**Prisen er kendt og accepteret.** Skulle der findes en tredje adresse, som nogen
faktisk deler links fra, viser den sig ved, at en bruger bliver på den gamle
origin — og rettelsen er da én regel mere i `vercel.json`, altså samme arbejde
som i dag, bare senere. Det er billigere end at holde et tier åbent på en
aflæsning, hvis mest sandsynlige svar er "de to, du allerede kender".

**Det, der IKKE blev valgt, og hvorfor.** Et JS-bagstop i appen — redirigér fra
ethvert `.vercel.app`-værtsnavn ved boot — ville dække også de ukendte. Det blev
fravalgt, fordi det lægger et andet mekanisme-lag ved siden af edge-redirectet
uden en vagt, der holder de to i takt, og fordi det skulle gates på et
produktions-build for ikke at ramme previews (og dermed staging). To mekanismer
for ét problem er dyrere end den tredje regel, der måske aldrig skal skrives.

## 13. august 2026 — `A46`: cron-registerets `<app>` udfyldes fra jobbenes egne kørsler, ikke fra cron-job.org

**Beslutning:** værtsnavnet, hvert cron-job kalder ind på, skrives i
`job_runs.detail` og aflæses i Admin → Drift. `docs/CRON.md`s pladsholder
`<app>` udfyldes derfra — **ikke** ved at åbne de ni jobs i cron-job.org.

**Begrundelse — det er `A11`s fejlklasse en gang til.** Rækken var skrevet som en
aflæsning uden for repoet, og det var den samme fejlslutning, `CRON.md` allerede
har skrevet ned om kolonnen "Hemmelighed sendes som": *"kolonnen stod med `?` i
en måned, fordi svaret lå i en brugerflade uden for repoet. Det gjorde det aldrig
— det lå i jobbenes egne kørsler, som bare ikke gemte det."* `req.headers` har
altid båret værtsnavnet; det blev kasseret, præcis som `isAuthorized()`s `via`
blev det før 1. august.

**Hvorfor spørgsmålet blev aktuelt nu.** Domæneflytningen (`I10`) gjorde `<app>`
tvetydig: den kan være den gamle `.vercel.app`-adresse eller `app.leagly.app`.
`/api/` er **med vilje** undtaget fra redirectet (`DOMAENE.md` trin 6), så et job
på den gamle adresse svarer fortsat 200 — forskellen kan altså ikke ses udefra,
og det er dét, der gør den værd at gemme frem for at gætte.

**Det er ikke en vej uden om `A32`.** Beslutningen fra 10. august står ved magt:
aflæsninger i produktion er ejerens arbejde. Det, der er ændret, er
**bestillingen** — fra "åbn ni jobs i en tredjeparts brugerflade og skriv ni
URL'er af" til "kig på Seneste resumé i Admin → Drift", altså ét skærmbillede i
appen, ejeren i forvejen har. Det er nøjagtig den disciplin, `A32` udpegede som
det, der arbejdes på i stedet.

**Prisen er ventetid, ikke arbejde.** Svaret findes først, når hvert af de ni
jobs har kørt én gang efter udrulningen; langsomste skema er hver 12. time.
Rækken er derfor flyttet til Tier 6 med den kørsel som udløser.

## 13. august 2026 — `A45` lukkes: diagnosen droppes, fordi kuren er billigere end svaret

**Beslutning:** det efterprøves **ikke**, om `recovery.html`s kommentarhoved blev
pastet ind i Supabase 9. august 2026. I stedet indsættes skabelonens brødtekst
én gang mere, og spørgsmålet lukkes.

**Begrundelse — svaret ville ikke ændre handlingen.** Rækken bad om en aflæsning
("vis original" på en modtaget nulstillingsmail) og beskrev to udfald: er
hovedet med, tilføjes en linje i `MAIL.md`s trin 4; er det ikke, lukkes rækken
uændret. Men linjen i trin 4 er rigtig **uanset** udfaldet — trinnet skal sige
det, `OPRETTELSE.md`s trin 6 allerede sagde — og den ene handling, der faktisk
retter noget, er den samme begge veje: paste brødteksten igen. En diagnose, hvis
to udfald fører til samme arbejde, er ikke en beslutning; den er et spørgsmål,
nogen fandt interessant.

**Det, der var en rigtig fejl, er rettet.** `confirm-signup.html` fik advarslen
*"INDSÆT IKKE DETTE KOMMENTARHOVED I SUPABASE"* den 12. august 2026 sammen med
`OPRETTELSE.md`s trin 6, mens `recovery.html` og `MAIL.md`s trin 4 ikke fik den
— to skabeloner med samme risiko og kun den ene med en advarsel. Asymmetrien er
væk, og `docs/mail/templates.test.js` kræver nu advarslen af **enhver** skabelon
plus at brødteksten faktisk begynder ved `<table role="presentation">`, som
advarslen henviser til. En ny skabelon arver dermed advarslen frem for hullet.

**Det, der ikke kan repareres, er accepteret.** Er hovedet sendt med siden
9. august, har de nulstillingsmails, der er sendt, båret interne noter i deres
kilde. Der er ingen vej til at kalde en sendt mail tilbage, og modtagerne er
appens egne brugere. Prisen er betalt; det, der kan gøres, er at stoppe den
fremadrettet, og det gør en frisk indsættelse.

> ✅ **Efterskrift samme dag: kuren er kørt, og den er efterprøvet.** Ejeren
> indsatte brødteksten på ny i Supabase og sendte derefter en nulstillingsmail
> til sig selv. I "vis original" begynder `text/html`-delen direkte på
> `<table role="presentation">` — ingen `<!--`, altså ingen interne noter i
> kilden.
>
> **Beslutningen står ved magt, og rækkefølgen er grunden.** Mailen blev sendt
> EFTER indsættelsen, så den måler den nuværende skabelon og ikke den, der stod
> der 9.–13. august 2026. Det bagudrettede spørgsmål er derfor stadig ubesvaret
> — nøjagtig som beslutningen lagde op til, og det er ikke en mangel: havde
> aflæsningen ligget først, ville den have kostet et ekstra led uden at ændre
> handlingen. **Det er værd at holde fast i, fordi det er let at læse forkert
> bagefter:** en grøn aflæsning efter en rettelse beviser rettelsen, ikke
> fraværet af fejlen før den.
>
> **Samme aflæsning bestod et bevis, den ikke var sendt ud efter:**
> `redirect_to=https://app.leagly.app/` i linkets query er `I10`s bevis 4
> ([`DOMAENE.md`](./DOMAENE.md)), som indtil da stod som udestående i trin 8.

## 13. august 2026 — `B30`: sælgesætningen siger nu "fodboldkampe", og turneringsnavnene holdes UDEN for den

**Beslutning:** sælgesætningen er omformuleret fra *"Gæt resultater mod dine
venner. Opret en liga, tip ugens kampe, og se hvem der er bedst."* til:

> Gæt resultaterne af ugens fodboldkampe mod dine venner. Opret en liga, tip
> kampene, og se hvem der er bedst.

De konkrete turneringsnavne — "Superligaen, Premier League og fem andre
turneringer" — står **ikke** i den, men i hjemmesidens hero-underlinje og i
forsidens turnerings-sektion.

**Begrundelse.** Det gamle udkast til hjemmesiden ville skrive turneringsnavnene
ind i selve `description`, og det er dér, valget ligger. Tre grunde til at lade
være:

1. **Sætningen står fem steder, og de fem har ikke samme levetid.** Ordlyden
   skal kunne stå på login-skærmen, i et link-preview og i README'en — steder,
   hvor en liste over turneringer enten er forkert i morgen (Champions League er
   endnu ikke oprettet hos leverandøren, `B28`/`B32`) eller bare irrelevant.
   `leagues`-tabellen er sandheden om, hvilke turneringer der findes; en
   marketingsætning, der gentager den, er en kopi mere at holde i trit.
2. **Længden.** `site/index.html`s `description` er ankeret plus *", Gratis,
   uden odds og uden betting."* og lander på 144 tegn — under de ~155, en
   søgemaskine viser. Med turneringsnavnene i ville den blive klippet midt i
   det, der skulle sælge.
3. **Fodbold-eksplicitheden, som var hele formålet, opnås af ét ord.**
   "fodboldkampe" gør, hvad "resultater" ikke gjorde: siger hvad produktet
   handler om, uden at binde sætningen til et bestemt udvalg af ligaer.

**Det, der ikke blev ændret:** `og:title` (*"Leagly — gæt resultater mod dine
venner"*) er stadig ikke fodbold-eksplicit. Den er en **anden** dublet med sin
egen påstand i vagten og sine egne to aftagere, og den blev holdt uden for
rækken frem for at blive taget med i forbifarten. Noteret i backloggens
indbakke.

## 13. august 2026 — `G97`: vagten over sælgesætningen tæller nu fem filer, ikke syv

**Beslutning:** hverken `src/screens/Auth.test.jsx` eller
`saelgesaetning.test.js`' eget kommentarhoved må bære en kopi af ordlyden.
Testen læser den fra ankeret (`index.html`s `<meta name="description">`);
kommentaren beskriver sætningen i stedet for at citere den.

**Begrundelse.** `B30` var den første omformulering, siden vagten blev bygget
(`G97`, 12. august 2026), og den afslørede to kopier, vagten ikke selv talte:

- **`Auth.test.jsx` påstod tre gange, at skærmen indeholder `"Gæt resultater mod
  dine venner"`** — en hårdkodet delstreng, som gik rødt i samme øjeblik
  sætningen blev omformuleret. Den fejl er *ufarlig* (en rød test er en fejl,
  der råber), men den er også præcis det sjette sted, vagtens eget hoved
  advarede mod. Den læser nu ankeret og påstår det, testen faktisk handler om:
  **hvilken** af skærmens to tekster der vises — ikke hvad der står i dem.
- **Vagtens kommentarhoved citerede ordlyden ordret** for at forklare, hvorfor
  dubletten ikke kan fjernes. En kommentar, der citerer teksten, er lige så
  meget en kopi som en kodelinje — den bliver bare forkert, uden at nogen test
  kan opdage det, og den ville have været forkert fra denne leverance og frem.

**Følgen er, at fem er det rigtige tal igen**, og at en fremtidig omformulering
kun skal ramme de fem filer, vagten navngiver.

## 13. august 2026 — `I10`: redirectet af de gamle adresser undtager `/api/`

**Beslutning:** `vercel.json`s redirect fra de to gamle `.vercel.app`-værtsnavne
til `app.leagly.app` står som `/:sti((?!api/).*)` og ikke som runbogens
oprindelige `/(.*)`. `/api/` bliver ved med at svare på de gamle adresser, indtil
nogen aktivt flytter det.

**Begrundelse.** Redirectet findes for MENNESKER, der åbner et delt
`?liga=`/`?join=`-link. `/api/` har to aftagere, som ingen af dem er det:

- **De ni cron-jobs** kalder `https://<app>/api/…` med `x-sync-secret`
  ([`CRON.md`](./CRON.md)). At de overlever et 308 til et nyt værtsnavn kræver,
  at cron-job.org både følger redirectet **og** gensender headeren. Ingen af de
  to antagelser er efterprøvet, og symptomet, hvis en af dem er forkert, er, at
  live-resultater bare holder op med at komme — en tavs fejl på det ene job, der
  kører hvert minut.
- **Allerede installerede PWA'er** på den gamle origin ville få deres
  `/api/`-kald flyttet fra samme origin til på tværs af origins, altså CORS på
  kald, der aldrig har haft brug for det.

**Alternativet var at flytte cron-jobbene samtidig**, og det er præcis den slags
"to ting på én gang", `I10`s egen rækkefølgeadvarsel handler om: hvert af de ni
jobs skal rettes i et dashboard uden for repoet, og en fejl i et af dem opdages
først ved en manglende synkronisering. Undtagelsen gør flytningen **valgfri**
frem for samtidig, og prisen er lav: `/api/` er ingens delte link, så der er
ingen kanonikalitet at flytte med.

**Det, der IKKE blev valgt, og hvorfor det er værd at vide:** undtagelsen er
ikke gratis for altid. Så længe den står, svarer appen på to origins for
`/api/`. Det er acceptabelt, fordi de begge er den samme funktion i det samme
Vercel-projekt — det er ét deploy, ikke to kopier. Fjernes den, skal alle ni
jobs være flyttet først, og [`DOMAENE.md`](./DOMAENE.md)s "Når noget ændrer sig"
bærer rækkefølgen.

**Reglen kan ikke efterprøves før produktion.** `has` er betinget af
produktionsværtsnavnet, så den fyrer pr. konstruktion aldrig på et
preview-deploy, og CI kører ikke Vercels router (`DOCUMENTATION.md` §13). Derfor
har runbogen fået et bevis mere (3b: `/api/sync-live` på den gamle adresse må
**ikke** svare 308), som skal køres i samme åndedrag som bevis 1 — de to fejler
hver sin vej, og den ene kan se rigtig ud, mens den anden er gået galt.

---

## 12. august 2026 — `A43`: `profiles` smalnes på KOLONNER, deltagerlisten på RÆKKER

**Beslutning:** `authenticated` mister tabel-bred SELECT på `public.profiles` og
får den igen på nøjagtig `id`, `display_name` og `anonymized_at`. `read
profiles`-policyen er **urørt**. `competition_participants` får derimod en ægte
rækkepolicy — din egen række, eller en række i en konkurrence, du kan se — og
reglen for det sidste bor i `is_competition_visible(cid)`, som
`competitions_select_involved` nu også kalder. To migreringer med et deploy
imellem: `#59 read_scope_functions.sql` (additiv) og `#60 read_scope_narrow.sql`
(indsnævrende).

**Begrundelse:** rækken foreslog `A40`s vej for begge tabeller — afgræns til de
brugere, læseren deler en liga med. For den ene er det rigtigt, for den anden er
det forkert, og forskellen er ikke en smagssag:

- **`profiles` publicerer sit ene interessante felt med vilje.** Rating-fanen,
  Månedsligaen og Championship (`scope='ALL'`) viser hver eneste brugers
  visningsnavn til enhver indlogget. En rækkepolicy ville tømme
  `loadMonthlyBoard`/`loadRoundBoard`/`loadSeasonBoard` OG skjule netop det felt.
  Det, der ikke er publiceret, er resten af rækken — `is_admin`, `last_seen_at`,
  `created_at`, `display_name_changed_at` — og dét kan kun lukkes med
  kolonne-privilegier, fordi **en policy afgrænser rækken og ikke kolonnen**.
  Værktøjet fandtes allerede i repoet i modsat retning (`#51`, `B29`).
- **`competition_participants` publicerer ingenting.** Man ser kun deltagerne i
  konkurrencer, man selv er med i — men kunne hente hele det sociale netværk med
  ét kald. Klienten opfører sig allerede, som om policyen var stram: hvert
  læsekald er filtreret på `competition_id`/`user_id`, og `compIds` kommer fra
  brugerens egne medlemskaber og ligaer. Derfor kostede rækkepolicyen ingen
  klientændring.

**Hvorfor reglen flyttes ind i en funktion, og ikke skrives to gange:** en
deltagerpolicy, der slår op i `competitions`, peger tilbage på en
konkurrence-policy, der slår op i `competition_participants`. PostgreSQL svarer
`42P17 infinite recursion` — og fejlen rammer **også `select * from
competitions`**, så den slukker for hele konkurrencelaget og ligner ikke sin
årsag. Én `security definer`-funktion bryder cyklussen; at BEGGE policies kalder
den, gør reglen til ét sted frem for to. Efterprøvet mod PostgreSQL 16.13 og
målt som negativ kontrol i `sql/tests/read_scope.sql`.

**Den følge, beslutningen ikke forudså, og som er værd at kende næste gang:**
en RLS-policy, der LÆSER en kolonne, holder op med at filtrere og begynder at
fejle, når kolonnen lukkes. Tre policies slog op i `profiles.is_admin`, og
`select count(*) from job_runs` som en ADMINISTRATOR svarede `42501` — Admin →
Drift brækket for alle. Reglen bor nu i `is_platform_admin()`. Den generelle
form: **kolonne-privilegier rammer også policies, ikke kun kaldesteder**, og
kaldesteder er det eneste, en gennemlæsning af klienten kan finde. Det var
efterprøvningen fra begge sider af skema-dumpet (§13), der fandt den.

**Prisen, sagt højt:** `loadGroupDetail` henter deltagere for alle konkurrencer i
alle brugerens ligaer, altså ét funktionskald pr. række i den varme sti. Den
skal aflæses i staging, før policyen låses — det er trin 5 i
[`UDRULNING-A43.md`](./UDRULNING-A43.md), og det er en måling og ikke et
flueben. Bliver den mærkbar, er svaret at hente deltagerantallet ét sted fra, og
ikke at rulle policyen tilbage.

**Udløseren var sprunget, ikke ventende.** Rækken delte udløser med `B26` — "når
linket deles åbent" — og `B26` blev kørt tidligere samme dag. Et bot-værn hæver
prisen på en fremmed konto; det fjerner den ikke. `A43` skulle afgøres FØR
åbningen, og blev det ikke, hvilket er værd at skrive ned: to rækker med samme
udløser skal enten køres sammen eller have hver sin.

**Hvad beslutningen IKKE dækker:** listen af visningsnavne er stadig offentlig
for enhver med en konto, fordi den globale rating publicerer den. Det er `A44` i
backloggen — en produktbeslutning om, hvad tavlen skal VISE, ikke en adgangsregel.

---

## 12. august 2026 — `B26` køres, før dens udløser springer

**Beslutning:** bot-værn og e-mailbekræftelse er slået til i produktionen, selv
om `B26`s udløser — at linket deles åbent — ikke er indtruffet. Begge halvdele
er efterprøvet med runbogens ni beviser, og rækken er lukket.

**Begrundelse.** Rækken havde ventet på udløseren siden den blev skrevet, og
argumentet for at vente var reelt: prisen er ét ekstra trin i onboardingen, og
den betales af de enogtyve brugere, der allerede er der, uden at nogen af dem
får noget til gengæld. Det, der vendte afvejningen, var **10. augusts første
kørsel**. Den viste, at rækken ikke er "to klik", men en runbog med en
rækkefølge, der kan lukke adgangen for alle — og en runbog, der aldrig er kørt
igennem, er ikke en plan, men en formodning. At køre den på en rolig dag med
enogtyve kendte brugere er billigere end at køre den første gang samtidig med,
at linket deles åbent og fremmede står i døren. **Udløseren beskyttede mod
onboarding-friktion; den beskyttede ikke mod at stå med en uafprøvet runbog på
det værst tænkelige tidspunkt.**

**Prisen er betalt og kendt:** nye brugere skal igennem et bot-tjek og en
bekræftelses-mail. For eksisterende brugere er der ingen ændring — bot-værnet
kræver en kvittering, klienten allerede sender, og bekræftelsen afvises pr.
bruger på deres eget `email_confirmed_at`, hvor nul konti stod ubekræftede.

**Det, beslutningen IKKE dækker.** `A43` delte udløser med `B26` og er stadig
åben: `profiles` og `competition_participants` kan læses af enhver indlogget
bruger. Et bot-værn hæver prisen på en fremmed konto uden at fjerne den, så
denne beslutning flytter ikke `A43` — den efterlader den som den sidste række,
der venter på den åbne deling, og **den bør afgøres før, ikke efter.**

**Kan revideres, hvis** onboarding-frafaldet stiger mærkbart. Begge knapper
ruller tilbage øjeblikkeligt og uden en deploy; det ene, der ikke ruller
tilbage, er konti oprettet i mellemtiden, som ikke nåede at bekræfte.

---

## 12. august 2026 — Den indsnævrende halvdel køres, og den udvidende bliver en landmine (`G98`)

**Beslutning:** `#55`s `or created_by = auth.uid()` er fjernet fra `groups`'
SELECT-policy ([`#58 groups_select_member_narrow.sql`](../sql/groups_select_member_narrow.sql)).
Reglen er igen *"du kan se en liga, hvis du er medlem"* — punktum. Den gældende
udgave står to steder, `#53` og `#58`, mens `#55` er markeret som en fil, der
**ikke må gen-køres**.

**Fordi prisen ikke længere købte noget.** Leddet blev hasteudrullet 11. august
2026 og havde en kendt pris: en opretter, der havde forladt sin egen liga, kunne
blive ved med at læse den og dens `invite_code`. Den pris var rigtig at betale
dengang — alternativet var en app, hvor ingen kunne oprette en liga. `G95`
(`create_group()`, `#57`) flyttede oprettelsen ind i én transaktion skrevet som
ejer, og fra det øjeblik var leddet gratis at undvære. **En accepteret afvigelse
skal genbesøges, når dens begrundelse forsvinder** — ellers bliver den til en
regel, ingen kan huske at spørge om.

**Udløseren var et deploy og ikke en anden migrering.** Det er samme todelte form
som `A40` (10. august), bare med halvdelene byttet om i tid: den additive
(`#57`) kunne køres når som helst, den indsnævrende (`#58`) først når den gamle
klient var ude af luften. Beviset var ikke et argument, men en afprøvning —
ejeren oprettede en liga i produktionen efter deployet.

**Den udvidende halvdel er nu en landmine, og det er den eneste af de ti, hvor
"kør den nyere bagefter" ikke altid er svaret.** `#55` gør præcis det, `#58`
fjerner, så en gen-kørsel ruller `G98` tavst tilbage. Men skulle en gammel klient
mod forventning være i luften igen, er `#55` netop tilbagerulningen. Derfor står
den som en advarsel med to retninger frem for som en slettet fil.

**Fundet undervejs, og det er den egentlige lære:** `sql/tests/create_group.sql`s
negative kontrol hentede en ligas id med et opslag i `groups` som den indloggede
bruger. Den linje ville være blevet et **tavst no-op** i samme sekund
skema-eksporten kørte efter `#58`: opslaget giver nul rækker, `insert … select`
skriver nul rækker, testens spærre fyrer aldrig — og kontrollen ville have været
grøn uden at måle noget. Det er tredje gang samme fælde stilles (`G94`,
`invite_lookup.sql`, og nu her), og reglen fra `DOCUMENTATION.md` §13 gælder
bredere end først skrevet: **en test må ikke læse sin egen før-tilstand af et
snapshot — heller ikke indirekte, gennem et opslag, en policy kan lukke.**
Begge tests er derfor kørt fra begge sider af dumpet, sammen med de tolv andre
skema-indlæsende tests.

## 12. august 2026 — `G96`s regel måles mod produktionen og ikke mod dumpet (`G100`)

**Beslutning:** reglen fra `G96` — hver ny funktion i `public` skal selv bære sin
`revoke execute … from public` — får en kontrol i `sql/checks/`
([`anon_routine_reach.sql`](../sql/checks/anon_routine_reach.sql)) med en test og
et CI-trin, **og den køres af `job-heartbeat.yml` mod produktion hver halve
time.**

**Fordi en vagt, der måler et øjebliksbillede, ikke vogter en levende
database.** `sql/tests/anon_grants_functions.sql` er rigtig og bliver rød ved den
første funktion, der glemmer sin revoke — men den måler `sql/schema.sql`.
Migreringerne køres i hånden i SQL-editoren, og skema-eksporten er en ugentlig
mandagskørsel plus en manuel knap, så afstanden mellem "funktionen findes i
produktionen" og "en påstand kan se den" var op til en uge. Reglen er menneskelig
af nødvendighed (PostgreSQLs PUBLIC-default kan ikke lukkes ved kilden), og en
menneskelig regel med en uges detektionsforsinkelse er i praksis ikke håndhævet.

**Heartbeat-trinnet er en del af beslutningen og ikke en tilføjelse.** Rækken
foreskrev "en fil, en test og et CI-trin", men et CI-trin efterprøver KONTROLLEN
og ikke produktionen — havde leverancen stoppet der, ville rækkens egen
problembeskrivelse have stået uændret. **Det er samtidig den ene kontrol, der kan
stå i en Actions-log uden at støde `A32`:** udlæsningen er funktions- og
rollenavne, ikke en eneste tabelrække. `league_admin_coverage` skriver liganavne
og hører derfor stadig hjemme hos ejeren.

**Kontrollen melder BEGGE retninger, og den anden var ikke i rækken.** For meget
er en rutine, en fremmed kan kalde uden login. For lidt er `username_available()`
eller `invite_preview()` lukket for `anon`, altså oprettelsen af en konto eller
invitationens etiket, der er død uden login — det er `#56`s trin 2 og 5 byttet
om, og det ville være grønt i hver eneste anden kontrol, vi har. En kontrol, der
kun kan melde "for meget", vogter kun den halve regel.

**Kontrollen er BREDERE end migreringen, og det er et valg.** Den filtrerer ikke
på `prokind`, fordi `revoke … on all functions in schema public` **ikke dækker
procedurer** — hverken `from anon` eller `from public`, mens
`alter default privileges … on functions` dækker dem. Efterprøvet mod PostgreSQL
16.13. En procedure i `public` ville altså være åben for `anon` fra sit første
sekund, og `#56`s trin 2 kan ikke lukke den. **En kontrol, der deler
migreringens blinde vinkel, kan ikke se den** — det er den generelle regel, og
den er grunden til, at kontrollen ikke bare er testens påstand flyttet.

**Og `#56` blev IKKE lavet om i samme ombæring.** Der findes nul procedurer i
`public` i dag, så filen er ikke forkert; den er smallere, end dens ordlyd lyder,
og det står nu i dens hoved. Skrives den første procedure, bliver kontrollen rød,
og dét er tidspunktet at gøre trin 2 til `all routines`. At ændre en allerede
kørt migrering for et tilfælde, der ikke findes, ville koste en kørsel i
produktion for at lukke ingenting — og udløseren er nu selv automatiseret, hvilket
er præcis den betingelse, Tier 6 stiller.

---

## 12. august 2026 — Hver ny funktion i `public` skal selv lukke PUBLIC ude (`G96`)

**Beslutning:** en migrering, der opretter en funktion i `public`, skal skrive
`revoke execute on function … from public;` FØR sin `grant execute … to
<roller>;`. Reglen håndhæves af `sql/tests/anon_grants_functions.sql`, som måler
hele skemaet og kræver, at `anon` kan kalde nøjagtig to funktioner:
`username_available()` og `invite_preview()`.

**Fordi den ellers ikke KAN håndhæves.** `G50` og `G58` lukkede `anon` ude af
tabeller og sekvenser ved at fjerne Supabases default privileges — kilden var én
regel, og den kunne slukkes ét sted. Funktioner opfører sig anderledes:
PostgreSQL giver som **indbygget** default EXECUTE til PUBLIC på hver ny
funktion (`acldefault('f', ejer)` = `{=X/ejer,ejer=X/ejer}`), og PUBLIC er enhver
rolle, også `anon`. Den post kan ikke fjernes med `ALTER DEFAULT PRIVILEGES`:
`pg_default_acl` gemmer kun TILLÆGGET til den indbyggede default, de to flettes
ved oprettelsen, og fletningen kan kun lægge til. En revoke af PUBLIC efterlader
en tom post, rækken slettes, og den indbyggede default gælder igen.
**Efterprøvet mod PostgreSQL 16.13** — først som en linje i migreringen, der så
ud til at virke og ikke gjorde noget, derefter isoleret i fire forsøg.

**Alternativet blev valgt fra på pris og på risiko.** En event trigger på
`ddl_command_end` ville kunne lukke hver ny funktion automatisk, men den kræver
superbruger (som `postgres` ikke er i Supabase), den ville køre ved HVER DDL i
databasen, og en fejl i den ville stoppe migreringer frem for at stoppe et hul.
For en række, hvis hele indhold er "der er ingen fejl i dag, men vagten er
enkeltlags", er det den forkerte vægtskål.

**Prisen ved den valgte vej er, at reglen er menneskelig og ikke maskinel** — og
det er derfor vagten er en påstand om HELE skemaet frem for om den enkelte
migrering. Den kan ikke forhindre, at linjen glemmes; den kan kun sikre, at det
opdages i den næste CI-kørsel frem for af en fremmed. Konventionen fandtes i
forvejen i de fleste migreringer (`#31`, `#36`, `#42`, `#46`, `#52`, `#54`); det,
der manglede, var, at den var et krav.

**Det, beslutningen IKKE ændrer:** vagten `if auth.uid() is null then raise
'forbidden'` bliver stående i hver funktion, og `sql/tests/invite_preview.sql`
bliver ved med at måle den som adfærd. Pointen med `G96` var netop at gøre den
til en dobbeltsikring — ikke at erstatte den med en anden enkeltsikring.

---

## 12. august 2026 — Appen flytter med på domænet: `leagly.app` til hjemmesiden, `app.leagly.app` til appen (`I10`)

**Beslutning:** `leagly.app` peger på hjemmesiden (`site/`), og appen får
`app.leagly.app` som produktionsdomæne. Begge bliver liggende på Vercel.
Vercel-projektet **omdøbes ikke** — de gamle `*.vercel.app`-adresser bliver
stående og redirigeres permanent til det nye subdomæne.

**Fordi `I10` kun stillede to muligheder, og ingen af dem satte appen på
domænet.** Rækken spurgte "eget domæne eller en sti på Vercel-projektet", men
begge svar handlede om HJEMMESIDEN; appens adresse var overladt til `B21`, som
løste den ved at omdøbe Vercel-projektet — altså til endnu en `.vercel.app`.
Nettoresultatet ville have været, at produktet hedder Leagly overalt undtagen i
den adresse, en bruger faktisk deler: invitationslinks bygges af
`window.location.origin` (`GroupScreen.jsx:87`, `BoardScreen.jsx:126`), så det er
APPENS adresse og ikke hjemmesidens, der vandrer rundt i folks beskeder.

**Subdomæne frem for én adresse til begge.** Appen er en SPA på roden, så
hjemmesiden kunne kun ligge på `leagly.app/` ved at blive vundet tilbage fra
appen med en rewrite — og hasterettelsen samme dag viste præcis, hvor skrøbelig
den konstruktion er: en rewrite på en sti, hvor der ligger en fil, fyrer aldrig.
To origins holder de to ting adskilt, så et deploy af `site/` pr. konstruktion
ikke kan vælte appen. Det er samme hensyn, som allerede holder mappen uden for
Vite-buildet.

**Omdøbningen af Vercel-projektet er droppet, ikke udskudt.** Den var hele
`B21`s risiko: Vercel frigiver det gamle projektnavn, adressen dør, og intet
redirigerer af sig selv. Med et custom domain er projektnavnet kun synligt i
ejerens eget dashboard, og de gamle adresser kan i stedet blive stående som
`permanent: true`-redirects i `vercel.json` — så hvert allerede delt
`?liga=`/`?join=`-link overlever med sin kode i behold (Vercel bevarer stien og
query-strengen). GitHub-repoets navn er en separat og harmløs sag; GitHub
redirigerer selv.

**Prisen er kendt og er argumentet for at køre rækken NU:** en installeret PWA
er bundet til sin origin, så de testere, der har installeret fra `.vercel.app`,
skal installere igen og logge ind på ny. Det er billigt, mens feltet er
vennegruppen, og dyrt efter `I8`s publicering.

**Det, beslutningen IKKE ændrer:** appens CSP (`font-src 'self'`) kan blive
stående — `site/` er selvbærende med egne fontkopier og nul eksterne requests,
og to origins deler ikke headere. `og:`-adressen stempler sig selv om, fordi
`vite.config.js` læser `VERCEL_PROJECT_PRODUCTION_URL`. Det, der derimod SKAL
med i samme ombæring — Site URL, Redirect URLs, Turnstile-værtsnavnet og de 23
links — står i [`DOMAENE.md`](./DOMAENE.md).

---

## 11. august 2026 — Invitationens ETIKET må læses uden login (`A41`)

**Beslutning:** `invite_preview()` (migrering `#54`) er `security definer` og
åben for `anon`. Den svarer med ligaens eller konkurrencens NAVN og et
MEDLEMSANTAL — og intet andet. Ingen id'er, ingen `invite_code` retur, ingen
medlemsliste, intet opretternavn.

**Fordi modtageren ellers skal oprette en konto for at få at vide, hvad de er
inviteret til.** `invite_lookup()` kræver `auth.uid()`, hvilket er rigtigt for et
opslag, der fører til en tilmelding — men det betød, at en helt ny bruger, der
trykkede på et invitationslink, landede på en generisk login-formular uden en
antydning af hvorfor. Det samme hul har en anden ende: en crawler er pr.
definition ikke logget ind, så et delt link kunne ikke vise andet end appens
forside, uanset hvilken liga det pegede på.

**Snittet er ETIKET vs. ADGANG,** og det er dét, der gør beslutningen forsvarlig
en måned efter `A40`, som gjorde koden til hemmeligheden igen:

- `invite_preview()` er en billedtekst til en kode, kalderen allerede har.
- `invite_lookup()` er opslaget og kræver login.
- `accept_invite()` er adgangen og kræver login **og** koden.

`A40`s hul var, at et ID var nok til at melde sig ind. Det er ikke dét, der
åbnes her.

**Prisen er regnet ud og ikke viftet væk.** Koden er 8 hextegn (≈ 4,3 mia.
muligheder) og kolonnen er `unique`, så et gæt er ét indeksopslag. Med nogle
hundrede levende koder kræver ét træf i størrelsesordenen millioner af kald, og
præmien er et liganavn. Træf og forbier ligner desuden hinanden i form og
svartid.

**Tilbagevejen er designet ind nu:** viser der sig misbrug, fjernes
`grant ... to anon`, og begge aftagere føres gennem `api/invite-preview.js`, hvor
en hastighedsgrænse kan bo. Det koster én linje i SQL og én funktionskrop i
`src/lib/data/invites.js` — hvilket er præcis derfor klientens kald ligger samlet
ét sted.

**Ikke valgt: en længere invitationskode.** Koden tastes i hånden ("Har du en
kode?"), så dens længde er et brugsvalg og ikke en sikkerhedsknap.

---

## 11. august 2026 — Kun crawlere får det dynamiske link-preview

**Beslutning:** omskrivningen kræver BÅDE en invitationskode i adressen og en
`user-agent`, der matcher en liste over sociale crawlere. *(Rettelse 12. august
2026: den lå først i `vercel.json`s `rewrites` og virkede aldrig — de ligger
efter filsystem-opslaget, og `/` er en fil. Den bor nu i `middleware.js`, som
kører før. Selve beslutningen — at kun crawlere omskrives — står uændret.)* Alle
andre — inklusive Googlebot — får den uændrede statiske app.

**Fordi alternativet gør en fejl i previewet til en fejl i invitationen.** Lod vi
alle `?liga=`-kald gå gennem serverfunktionen, ville hver eneste rigtige bruger
få en cold start foran appens første maling, funktionen skulle kende og levere
hele appen, og et nedbrud dér ville ramme præcis det link, der skal give det
bedste førstehåndsindtryk.

**Med portvagten er "fejl åben" en egenskab ved opsætningen** frem for et løfte,
koden skal holde: et menneske kan pr. konstruktion ikke ende i funktionen.

**Prisen er, at en crawler, der ikke står på listen, får de statiske tags.** Det
er en gulvbrædde og ikke et hul — det er nøjagtig dét, alle fik før `I7`.
Googlebot udelades bevidst: en søgemaskine skal se det samme som brugeren.

---

## 11. august 2026 — `B20` trækkes ikke ind i `I7`

**Beslutning:** `I7` rører invitationsflowet uden skemaændring. Afsenderens navn
kommer kun i den TEKST, afsenderen selv sender.

**Fordi de to attributioner ikke er den samme ting.** Afsenderens eget navn er
kendt i delings-øjeblikket og dermed sandt pr. konstruktion. En attribution,
MODTAGEREN kan læse — og som en milepæl kan tælle — kræver én kode pr. bruger,
altså `invite_links` + `invited_by`, hvilket er `B20` og en anden leverance.

**Fravalget koster ét sted, og det er værd at kende:** teksten i det dynamiske
link-preview kan ikke sige "Nikolaj har inviteret dig", fordi modtagersiden ikke
ved, hvem der delte linket. Den siger derfor "Kom med i ligaen X — 7 spillere
gætter allerede resultater", hvilket er sandt uanset afsender. `B20` skal
bagefter kun tilføje ét felt i svaret fra `invite_preview()`.

**`B20`s egen begrundelse er uændret:** attribution kan kun registreres fremad,
så ventetid koster.

---

## 10. august 2026 — En migrering, der skal følges ad med en udrulning, deles i to

**Beslutning:** `A40`s migrering er delt i `#52` (funktionerne, additiv) og
`#53` (policyerne, indsnævrende), og rækkefølgen er #52 → udrul → #53.

**Fordi den oprindelige instruks ikke kunne følges.** Første udgave var én fil
med *"kør sammen med frontend-mergen"*. Supabase betjenes i hånden, Vercel
deployer af sig selv, og de to kan ikke ramme samme sekund — så instruksen var i
praksis "vælg selv, hvilken vej invitationerne skal være i stykker". SQL først:
den gamle klient slår ligaen op i en tabel, der lige er blevet lukket.
Frontend først: den nye klient kalder funktioner, der ikke findes endnu.

**Delingen fjerner vinduet frem for at gøre det kort.** Efter #52 virker BEGGE
udgaver af klienten, fordi filen kun tilføjer. Udrulningen kan derfor tage den
tid, den tager, og #53 køres, når det passer. Prisen er, at hullet står åbent
mellem de to trin — men det har stået åbent, siden liga-laget blev bygget, og
det er en anden pris end en invitation, ingen kan tage imod.

**Mellemtilstanden er målt og ikke lovet.** Tre påstande (a–c) i
`sql/tests/invite_lookup.sql` siger, at #52 ikke rører en eneste policy, at den
gamle klients opslag stadig virker, og at den nye klients kald allerede gør.
Uden dem ville "sikker at køre før udrulningen" være en kommentar, nogen skrev.
Efterprøvet med to mutationer: en policy sneget ind i #52 fanges af (a), og
`is_group_creator()` fjernet fra #52 gør #53 ukørbar.

**Den generelle regel er værd at have:** en migrering, der skal følges ad med en
udrulning, deles i en additiv og en indsnævrende halvdel. Det er samme form som
`B26`s ufravigelige rækkefølge (nøgle udrullet FØR værnet slås til) — dér blev
prisen betalt kontant, fordi trinnet blev sprunget over, og hele adgangen lukkede
kortvarigt for alle.

## 10. august 2026 — `A40` bygget: invitationskoden er hemmeligheden igen

**Beslutning:** en liga og en konkurrence kan kun ses og tilmeldes af den, der
allerede er med — eller af den, der fremviser invitationskoden. `A40` blev
åbnet og lukket samme dag.

**Hvorfor den ikke ventede på sin udløser.** Rækken havde `B26` (åben
oprettelse) som trigger og stod FORAN den. Havde vi ventet, ville rettelsen
skulle laves i samme uge, som fremmede konti blev mulige — altså på det
tidspunkt, hvor en fejl i join-flowet ville ramme rigtige nye brugere frem for de
enogtyve, der allerede er inde. **Rækkefølgen var selve pointen med rækken**, og
den peger på at bygge nu.

**Rettelsen er en flytning og ikke en policy-linje.** Klienten slog ligaen op på
koden med et almindeligt tabelopslag, FØR man var medlem, og det kunne kun lade
sig gøre, fordi hver liga var læsbar for enhver. Opslaget (`invite_lookup()`) og
tilmeldingen (`accept_invite()`) er nu `security definer`-funktioner. Smalnes
policyerne uden den flytning, lukkes ikke et hul men hele join-flowet — og det
ville blive opdaget af den næste bruger frem for af os.

**Tilmeldingen er ÉN funktion og ikke to**, fordi `A8`-reglen (en konkurrence i
en liga melder ind i begge) ellers ville skulle kendes af hvert kaldssted. Det
var præcis dét, der lod `MainApp`s og `LigaerTab`s veje divergere engang (`A7`).
Reglen bor nu i databasen.

**To fund, som kun testen kunne give.** Begge er værd at have skrevet ned, fordi
de begge stammer fra at have troet noget forkert om mekanikken:

1. **Hele oprettelsen af en liga var brudt af rettelsen.** Insert-policyens
   `exists (select 1 from groups …)` er selv underlagt den NYE læsepolicy, og en
   opretter er ikke medlem i det sekund, hun skriver sin egen admin-række. Uden
   `is_group_creator()` som `security definer` kunne ingen oprette en liga
   overhovedet — altså en rettelse, der lukkede et hul og hele produktet på én
   gang. Fanget af påstand 10b, som findes udelukkende for at måle, at flowet
   stadig virker.
2. **Invarianten afviser ikke, den udfylder.**
   `ensure_group_membership_for_participant()` er en BEFORE INSERT-trigger med
   `on conflict do nothing`, ikke en vagt, der siger nej. Migreringens første
   kommentar påstod det modsatte og begrundede rækkefølgen liga-før-konkurrence
   med en mekanik, der ikke findes. Fundet af en mutation, der fjernede
   indmeldingen og **ikke** fik testen til at fejle. Linjen bliver stående, men
   af den rigtige grund: triggeren fyrer kun, når der faktisk indsættes en
   deltager-række, så `A8`s halve tilstand — allerede deltager, mangler
   medlemskab — kun kan repareres af funktionen selv.

**Det, der IKKE er smalnet, og hvorfor.** `competition_participants` og
`profiles` er stadig læsbare for enhver indlogget bruger. Stillinger går på
tværs af konkurrencer og skal kunne slå navne op; en smalning dér er et andet
spørgsmål med en anden pris, og den er noteret i backloggens indbakke frem for
foldet ind her.

## 10. august 2026 — Revisionen efter `B29`: fladen er dækket, og svaret er skrevet som en kontrol

**Beslutning:** `B29`s fejlklasse — en policy afgrænser rækken, ikke kolonnen —
er efterprøvet på hele skemaet. `profiles` var det eneste sted, det gjorde en
forskel, og revisionen er lagt ned som `sql/tests/write_surface.sql` frem for som
et svar i en changelog.

**Hvad der blev målt.** 29 objekter har `grant all` til `authenticated`. For
hvert enkelt: er der en skrive-policy, og hvad tillader den? Svaret deler sig
rent i to. Ti tabeller (`ratings`, `rating_history`, `milestones`,
`competition_awards`, `teams`, `seasons`, `leagues`, `job_runs`,
`notification_log`, `user_activity_days`) har RLS uden en eneste skrive-policy,
så grant'en er inert — RLS afviser alt. Resten har policies, der er scopet til
`auth.uid()`, `created_by`, `is_admin` eller `is_group_admin`, og ingen af dem
efterlader en kolonne, der kan skrives, og som betyder noget.

**Den fælde, der kostede en runde, er selve grunden til, at kontrollen måler
rækkeantal.** Første måling meldte fem huller: rating sat til 9999, et hold
omdøbt, et resultat skrevet uden admin. Alle fem var falske. **RLS uden en policy
skjuler bare rækkerne**, så en fjendtlig `update` rammer nul rækker og svarer
`UPDATE 0` — ingen fejl, ingen ændring. Måler man på fravær af en fejl, ser fem
værn ud som fem huller. Kontrollen skelner derfor mellem `afvist`, `nul` og
`tilladt`, og den skelnen er hele forskellen på et svar og et gæt.

**Hvorfor en test og ikke et notat.** Et svar fra en bestemt dag er ikke en
kontrol — det er præcis den forskel, `B2` blev lukket på 2. august, og
`ambiguousTeams` findes af samme grund. Næste `grant`, næste policy eller næste
kolonne kan flytte fladen, og den slags viser sig ikke som en fejl, men som
noget, der pludselig virker. Fortegnelsen står nu i en påstand, så en ny
permissiv policy skal VÆLGES ind — RLS er et OR mellem permissive policies, så
en tilføjelse kan kun gøre fladen større.

**Én påstand er svagere, end den ser ud, og det står i filen.** Påstand 3
(`profiles`' kolonneliste) måler migreringens resultat og ikke produktionens
tilstand, fordi testen selv indlæser `username_change.sql` — en udvidelse lagt
ind før den, rulles tilbage af testens egen opsætning. Årsagen er, at
`sql/schema.sql` endnu er ældre end migreringen; **når skema-eksporten er kørt,
skal `\ir`-linjen fjernes**, og påstanden begynder da at måle produktionen. Det
er `G94`s udløbsdato den anden vej rundt: dér blev en test rød, da migreringen
nåede frem, her bliver en påstand først skarp.

## 10. august 2026 — `A40`: en liga kan læses og tilmeldes af enhver indlogget bruger

**Beslutning: ingen — rækken åbnes, den lukkes ikke.** Fundet står som `A40` med
`B26`s udløser, og det er med vilje ikke rettet i samme ombæring som `B29`.

**Fordi det er en anden fejlklasse, og forskellen er værd at holde fast i.**
`B29`s hul var en KOLONNE, ingen policy kunne beskytte — der fandtes ingen måde
at udtrykke reglen på, og rettelsen var derfor ren teknik uden et produktvalg i
sig. `A40` er det modsatte: `groups_select_all` er `using (true)`, og policyen
gør præcis, hvad der står i den. Spørgsmålet er, om det ER den rigtige regel, og
det er et produktspørgsmål: skal en liga kunne findes af nogen, der ikke er
inviteret?

**Bredden har en grund, og den skal med i svaret.** Klienten slår ligaen op på
`invite_code` med et almindeligt tabelopslag, og opslaget sker FØR man er
medlem — den brede læsning er prisen for, at join-flowet er et opslag og ikke en
funktion. Rettelsen er derfor ikke en policy-linje, men en flytning: koden slås
op i en `security definer`-funktion, der svarer med ÉN liga, hvorefter policyen
kan smalnes. **Den kan ikke laves halvt** — smalnes policyen uden funktionen, kan
ingen længere tage imod en invitation.

**Rækkefølgen er selv en del af beslutningen:** `A40` står FORAN `B26` i tieret.
`B26` er det, der gør fremmede konti mulige; `A40` er det, de derefter kan gøre.
Prisen i dag er nul — 21 brugere, alle inviterede — og bliver reel i samme
sekund den anden række køres.

## 10. august 2026 — Brugernavnet kan skiftes — og retten til at skrive sin egen profil bliver smal først (`B29`)

**Beslutning:** en bruger kan skifte sit brugernavn fra sin egen karriereprofil.
Skiftet er ubegrænset i antal, men stemples (`profiles.display_name_changed_at`),
og gamle historie-kort omskrives **ikke**.

**Rækkefølgen i leverancen er selv beslutningen, og den er den vigtigste linje
her.** Spørgsmålet "hvordan må en bruger skrive sit eget navn?" havde allerede et
svar i skemaet, og det var for bredt: `grant all on public.profiles to
authenticated` plus policyen `update own profile using (auth.uid() = id)`. En
policy afgrænser **rækken**, ikke **kolonnen** — det kan kun kolonne-privilegier
— så enhver indlogget bruger kunne sende `PATCH /rest/v1/profiles?id=eq.<sit
eget> {"is_admin": true}` og blive administrator. `is_admin` er den ENE
betingelse i admin-vagten i `admin_user_stats()`, `admin_feedback()`,
`admin_client_errors()`, `admin_job_health()` og `admin_anonymize_account()`.
Efterprøvet mod `sql/schema.sql` i en PostgreSQL 16: sætningen svarede `UPDATE 1`
som rollen `authenticated`.

Hullet er ældre end `B29` og har intet med brugernavne at gøre — men det er
`B29`, der finder det, fordi rækken tvinger nogen til at spørge, hvilken
rettighed skærmen egentlig bygger på. **Rettelsen kommer derfor i samme
migrering og før funktionen:** `authenticated` har nu UPDATE på præcis `id` og
`display_name`. En bred rettighed, produktet er begyndt at BRUGE, er sværere at
tage tilbage end en, ingen har bygget på endnu.

**`id` skal med, og det er ikke et skøn.** PostgREST's upsert
(`resolution=merge-duplicates`, brugt af `sikrProfil()` og `App.jsx`) bliver til
`insert … on conflict (id) do update set id = excluded.id, display_name = …`, og
PostgreSQL kræver UPDATE-privilegiet på hver kolonne i `set`-listen — også når
konflikt-grenen aldrig tages. Uden `id` fejler oprettelsen af enhver ny profil.
Rettigheden er ufarlig, fordi policyens `auth.uid() = id` også bruges som WITH
CHECK: rækken kan ikke flyttes til en anden bruger.

**Navnet trimmes nu ved hver skrivning, og det lukker et hul, ingen ledte
efter.** Unikhedsindekset står på `lower(display_name)`, mens
`username_available()` sammenligner med `lower(trim(name))`. Et gemt navn med et
mellemrum til sidst svarede derfor "ledigt" på det trimmede navn og kunne
indsættes ved siden af det — to brugere, der ser ud til at hedde det samme, uden
at nogen garanti var brudt et sted, man kunne pege på. Trimmes værdien i en
trigger, måler alle tre regler det samme navn.

**Gamle historier omskrives ikke, og det er et valg og ikke en forglemmelse.**
`stories` gemmer navnet som tekst i overskrift, brødtekst og payload. En historie
er skrevet en bestemt dag; at rette den bagud ville ændre, hvad der stod, dengang
den blev læst. Prisen betales ét sted mere: karriereprofilens rival-tæller joiner
`payload->>'rival'` på `display_name`, så tælleren nulstilles for en rival, der
skifter navn. `sql/career_profile.sql` sagde allerede før denne beslutning, at
tallet er en FARVE og aldrig en rangering — netop derfor er prisen til at betale.
Dialogen siger det højt til brugeren frem for at skjule det.

**Ingen karantæne, men et tidsstempel.** En grænse på "ét skift pr. 30 dage"
ville være en regel opfundet før det første misbrug. Stemplet er det, en sådan
regel skal bruge, hvis den nogensinde bliver nødvendig — og det kan ikke udledes
bagudrettet, hvis det ikke gemmes fra i dag.

## 10. august 2026 — `A26` lukkes med en liste over godkendte holdpar

**Beslutning:** `ambiguousTeams` filtreres mod en liste over **godkendte** par
(`GODKENDTE_HOLDPAR` i `api/sync-matches.js`), så feltet igen kun melder det, der
ikke er set på. `Dundee`/`Dundee United` er listens første og indtil videre eneste
række.

**Hvorfor listen og ikke den anden vej.** Alternativet var at acceptere, at
feltet læses med et kendt par i baghovedet. Det koster kontrollens
troværdighed: `ambiguousTeams` er bygget på egenskaben *"kun til stede, når der
ER noget at kigge på"*, og et felt, der altid er der, holder man op med at
læse — netop den dag turnering #8 tilføjer et par, ingen har set før. En liste,
der skal vedligeholdes pr. turnering, er en pris, der betales, når en turnering
tilføjes; den anden pris betales hver gang nogen åbner Admin → Drift.

**`ambiguousTeamNames()` returnerer nu `{ nye, kendte }` og ikke én liste**, og
den anden halvdel er ikke pynt. Uden den ville filteret være usynligt: en forkert
linje i listen kunne sluge et ægte fund i tavshed, og en linje, hvis to klubber
ikke længere er i turneringen, ville blive stående for evigt. `ambiguousKnown` er
derfor et TAL i kørslens resumé — det er ikke noget at handle på, men det er
kvitteringen for, at godkendelsen stadig bider.

**Nøglen er de normaliserede navne, og en tilføjelse til et navn lader
godkendelsen bortfalde.** Kasse, mellemrum og tegnsætning må ikke kunne udløbe en
afgørelse. Men skifter et hold navn ("Dundee" → "Dundee FC"), er det præcis den
situation, hvor den fuzzy match kan begynde at ramme forkert — og så skal fejlen
pege mod alarmen, ikke mod tavshed.

## 10. august 2026 — `A36` lukkes: den lukkede konto bliver ved med at forlade ligaen

**Beslutning (produktejeren):** `A36` lukkes uden ændring. Reglen fra 7. august
2026 står — en lukket konto forlader de ligaer, hvor den ikke har en deltagelse
tilbage, og bliver stående som pseudonym, hvor der er spillet historik.

**Hvorfor rækken overhovedet stod tilbage.** `A36` og `A37` blev afgjort sammen
7. august, fordi de havde modsatrettede rettelser, og adfærden blev bygget samme
dag. Det, der ikke blev ryddet op, var **spørgsmålet**: `sql/checks/league_admin_coverage.sql`
skrev stadig, at `A36` var åben, og at kolonnerne `lukkede`/`opretter_lukket`
fandtes for at kunne besvare den. Kommentaren beskrev altså en verden fra før den
beslutning, filen selv står i. Den er rettet, og kolonnerne er beholdt: de
forklarer stadig et tal, de bare ikke længere afventer et svar på.

## 10. august 2026 — `A32` lukkes: aflæsninger i produktion er ejerens arbejde (`A32`)

**Beslutning (produktejeren):** der bygges **ingen** vej til at køre read-only
opslag i produktion uden ejeren. Det er ejeren, der afgør, hvad der køres.

**Hvorfor ikke.** Den nærliggende mekanik var en GitHub Actions-workflow med
`SUPABASE_DB_URL`, som `schema-export.yml` allerede har. Den ville lægge
produktionstal — deltagertal, hændelser, i værste fald pseudonymer — i
Actions-logs, altså et sted, hvor brugerdata ikke har været før, og som ikke kan
gøres usynligt bagefter. Spørgsmålet var aldrig en oprydning, men en beslutning
om, hvor brugerdata må stå, og svaret er, at de bliver i databasen.

**Prisen er kendt og accepteret:** et tier kan blive blokeret af, at ejeren ikke
har kørt et opslag endnu, og `B19` viste, at ventetid kan gøre den ventende
opgave større. Det er billigere end den anden vej. **Det, der arbejdes på i
stedet, er at gøre en bestilling billig** — ét paste, ét svar, som 5. august — og
den disciplin har allerede et sted at bo: `sql/checks/` installerer intet i
produktionen og kan køres af ejeren på et minut.

## 10. august 2026 — `A5` lukkes: emojis bliver i historie-kortene

**Beslutning (produktejeren):** emojis bliver, som de er — kun i højdepunkt-tieret,
ikke på de dæmpede kort. Spørgsmålet er lukket og genåbnes ikke af den første
deling.

**Hvorfor det ikke længere skal vente på data.** Rækken ventede på et signal, der
ikke kan opstå: aflæsningen 5. august 2026 viste 280 historier, 21 af 21 brugere
dækket og **0 delinger**, og del-knappen er præcis det, højdepunkt-tieret har og
det dæmpede ikke. Nævneren manglede desuden helt — det dæmpede tier har seks
historier, fordi det per design kun genereres til brugere, der ellers ville stå
uden kort. Et spørgsmål, hvis udløser er en hændelse, der aldrig er indtruffet på
tre måneder, er ikke en åben beslutning; det er en beslutning, ingen har truffet.

**Emojien er allerede et signal og ikke pynt** (v1.1, juli 2026): den findes kun
på højdepunkterne, så et kort med emoji betyder noget andet end et uden. Den
skelnen er selve grunden til, at spørgsmålet blev snævret ind, og den taber
produktet, hvis emojien fjernes. Skulle det nogensinde vise sig, at
højdepunkt-kortene virker mindre klassiske end ønsket, er det en tone-beslutning
om hele Story Engine og ikke en A/B-test af et tegn.

## 10. august 2026 — `A27` lukkes: `competitions.rules` bliver stående

**Beslutning (produktejeren):** kolonnen droppes **ikke**. Den bliver stående, i
tilfælde af at pointvariation pr. konkurrence bliver aktuelt senere.

**Hvorfor det er det rigtige svar på et produktspørgsmål.** Kolonnen har ingen
læsere overhovedet efter `G3` (3. august 2026) — hverken i klienten eller i SQL,
hvor `pc_points()` altid har hardkodet 3/1. Men et `drop column` er
uigenkaldeligt, og spørgsmålet bagved er, om point nogensinde skal kunne variere
pr. konkurrence. Ejeren holder den dør åben. Prisen ved at lade kolonnen stå er
lav og løbende (plads i hver konkurrence-række); prisen ved at fjerne den forkert
er, at en fremtidig pointvariation skal bygge sit skema forfra.

**Det, der er lukket, er ikke kolonnen men spørgsmålet.** Vilkåret står nu i
`DOCUMENTATION.md` §12 frem for som en åben række: `competitions.rules` er
historik uden læsere, og den næste, der finder den, skal kunne se, at det er
bevidst — ellers begynder eftersøgningen efter en konfigurerbarhed, som ikke
findes, forfra. Beslutningen revideres, hvis pointvariation faktisk bygges; da er
kolonnen den halve implementering og ikke støj.

## 10. august 2026 — En tilfældig kupon fordeler jævnt på de valgte turneringer, ikke proportionalt med deres størrelse

**Beslutning:** `pickRandomFromRounds` fordeler kampene **jævnt** på de valgte
turneringer i hver runde, i samme round-robin som periodens loft
(`drawAcrossLeagues`). Otte kampe fra Superligaen + La Liga bliver 4/4.

**Hvad der var galt.** Hele rundens kampe blev blandet i én bunke, og de første
`count` blev taget. En bunke afspejler turneringernes **størrelse**: La Liga har
10 kampe i en runde, Superligaen 6, så otte kampe gav i snit 3/5 og i praksis
nemt 2/6. At vælge to turneringer i chip-rækken er en udtalelse om, at begge
skal være med — ikke en anmodning om at blive vejet efter, hvor mange hold de
har.

**Hvorfor jævnt og ikke proportionalt.** Proportionalt er præcis dét, den gamle
adfærd var, bare uden garantien: den store turnering fylder mest. Med syv
turneringer valgt og otte kampe ville proportional fordeling betyde, at flere
turneringer slet ikke kom med — et valg, brugeren havde truffet, uden virkning.
Jævnt er den eneste fordeling, hvor hver valgt turnering er repræsenteret, så
længe den har kampe i runden.

**Hvorfor round-robin og ikke en kvote.** Samme begrundelse som `pickPerRound`
allerede havde: har en turnering færre kampe end sin andel, bliver den sprunget
over i næste omgang, og de øvrige fylder pladsen. 1 + 10 kampe med et loft på 6
giver 1/5 frem for 3/3 med et hul. Reglen findes nu ét sted i stedet for at være
implementeret to gange med kun den ene dokumenteret.

**Turneringernes rækkefølge blandes også.** Går kampantallet ikke op, får nogen
den ekstra. Over Quick Leagues seks runder må det ikke være den samme hver gang;
målt over 2000 kørsler falder den 993/1007.

**Fordelingen gælder pr. runde, ikke samlet.** En konkurrence over seks runder
balancerer hver uge for sig — ellers ville en runde uden kampe i den ene
turnering skulle kompenseres i en anden, og reglen ville afhænge af rækkefølgen,
runderne blev behandlet i.

---

## 10. august 2026 — 0-punkts-reglen flyttes fra runde-niveau til kamp-niveau, og runde-reglen slettes

**Beslutning:** en ny konkurrence materialiserer de kampe, der **stadig kan
tippes** (`filterTippable`), i stedet for "alt fra og med den første
ikke-færdigspillede runde" (`filterFromNextUnfinishedRound`). Den gamle regel er
**fjernet**, ikke sat ved siden af. Gælder `full_season`, `team` og `time_range`.

**Hvorfor den gamle regel var forkert.** Den holdt sit løfte for hele runder og
brød det inde i én. En konkurrence oprettet onsdag fik tirsdagens allerede
spillede kamp med, fordi runden ikke var færdig — og da `predictions` er **én
række pr. bruger pr. kamp, delt på tværs af alle konkurrencer**, havde den, der
havde tippet den i en anden konkurrence, point fra første sekund, mens den, der
ikke havde, ikke kunne nå det. Det er præcis den ulighed, reglen blev skrevet
for at forhindre; den var bare formuleret et niveau for højt.

**Hvorfor den gamle slettes frem for at suppleres.** Kamp-reglen *indeholder*
runde-reglen: en færdigspillet runde består kun af spillede kampe, og en spillet
kamp er låst. To regler, hvor den ene er en svagere udgave af den anden, er ikke
to sikkerhedsnet — det er et sted, hvor en senere læser skal gætte, hvilken der
gælder.

**"Låst" og ikke "har resultat".** En kamp, der er fløjtet i gang, kan heller
ikke tippes, og en kamp, ingen i konkurrencen kan gætte på, hører ikke til i den.
Det er samme svar, opret-flowets fire andre stier giver, så hele oprettelsen nu
bruger ét begreb for "kan denne kamp stadig komme med". En kamp uden kendt
kickoff er ikke låst og kommer med — samme vej at tage fejl som RLS-policyens
skrivegren.

**Prisen er kendt: konkurrencen kan starte midt i en runde.** En sæson oprettet
onsdag har søndagskampen med, men ikke tirsdagens, så dens første runde er
mindre end de følgende. Det er den rigtige pris: alternativet — at springe hele
runden over — ville udskyde starten i op til en uge for at undgå en skævhed, der
kun findes i én runde af otteogtredive. For de typer, hvor den første runde
**er** konkurrencen, findes valget i stedet som startrunde-chippen (se
beslutningen nedenfor).

**Efterfyldningen beholder sin egen, strengere RUNDE-regel** (`api/_backfill.js`
regel 3: en runde, der er gået i gang, vokser aldrig). Den er ikke inkonsistent
med denne beslutning, den løser et andet problem: ved en efterfyldning findes
deltagerne allerede, har tippet og set stillingen, så en ny kamp midt i en
igangværende runde ville flytte noget, nogen har set. Ved oprettelsen findes
hverken deltagere eller stilling.

**Opslagene henter nu `kickoff_at` og `kickoff_tbd`.** Uden dem er filteret
blindt uden at fejle — en kamp, der sparkes i gang om ti minutter, har intet
resultat og ville se frit tipbar ud. Derfor er kolonnerne pinnet af en egen test.

---

## 10. august 2026 — Startrunden er et valg, og kampantallet er ikke en konsekvens af den

**Beslutning:** opret-flowet spørger, om konkurrencen skal begynde i
**indeværende** eller en **ny runde** (standard: indeværende), og feltet "Kampe
pr. runde" er ikke længere klippet til antallet i nærmeste runde. Loftet er
teknisk (`MAX_MATCHES_PER_ROUND` = 50); udbuddet er oplysning.

**Hvorfor valget skal findes.** Puljen blev hentet fra `nu` og frem, så
startrunden var en konsekvens af, hvornår man trykkede. Det er ikke en neutral
default: en Quick League oprettet mandag aften har en førsteplads afgjort af én
kamp, og seks runders konkurrence bliver dermed afgjort af den runde, der havde
mindst indhold. Ingen på skærmen sagde det.

**Hvorfor nævneren, og ikke bare valget.** "1 i nærmeste runde" er et sandt tal,
der ikke kan bruges: det siger, hvad der er tilbage, aldrig hvorfor der kun er
én. Samme fejlklasse som `G35`, hvor turneringer med nul kampe så ud som
turneringer uden problemer. Derfor står "5 af 6 kampe … er allerede i gang eller
spillet" ved siden af valget — og derfor er der et nyt opslag
(`loadCurrentRoundMatches`), for nævneren findes ikke i puljen af kommende
kampe.

**"Spillet" = låst, ikke "har resultat".** For den, der skal beslutte, om en
runde er værd at starte i, er en kamp i gang lige så tabt som en, der er fløjtet
af — begge kan ikke tippes. Tælleren bruger derfor `isLocked`, samme svar som
Tip-skærmen giver, frem for at skelne mellem to tilstande, brugeren ikke kan
handle forskelligt på.

**Hvorfor loftet var forkert.** `max` = nærmeste rundes størrelse gjorde ét
tilfældigt tidspunkt til reglen for **alle** runder i en flerrunde-konkurrence.
Turneringerne går i gang forskudt — én kamp tilbage i indeværende runde siger
intet om de fyrre, der venter i runden efter. `pickRandomFromRounds` klipper i
forvejen pr. runde, så et for højt tal har altid betydet "så mange som muligt";
loftet beskyttede mod ingenting og spærrede for noget rigtigt.

**Hvorfor perioden får samme valg, men ikke samme mekanik.** Custom/periode er
defineret af sine datoer. Valget sætter derfor **startdatoen** og aflæses af
den, i stedet for at være sin egen state — to kontroller, der begge kunne
bestemme starten, ville kunne stå og modsige hinanden. Af samme grund er
"Indeværende runde" ikke slukket for perioden, når rundens kampe er spillet:
perioden løber over uger, så "start i dag" er stadig et lovligt valg. På de
tilfældige typer ER startrunden konkurrencens første (eller eneste) runde, og
dér slukkes chippen.

**Standarden er indeværende runde.** Man vil som regel i gang nu, og valget er
først et problem, når det er usynligt. Med nævneren på skærmen er det synligt.

**Udvidet samme dag til Sæson og Favorithold.** Spørgsmålet, der afgjorde
omfanget, tilbød kun de fire korte typer, og de to sæson-typer blev derfor
udeladt uden at være fravalgt. De har det samme vilkår — opretter man søndag
aften, består første runde af de kampe, der tilfældigvis var tilbage — og selv
om en hel sæson ikke afgøres af sin første runde, er det et vilkår, man skal
kunne vælge frem for at arve. Mekanikken er en tredje af slagsen: deres kampe
findes af en REGEL på skriverens side, så valget rejser med som
`spec.startRound` frem for at filtrere en pulje i klienten. `time_range` er
fortsat undtaget, fordi dens svar ligger i startdatoen — pinnet af en test, så
feltet ikke kan komme til at smitte af.

---

## 10. august 2026 — `B26`s kode leveres før konfigurationen, og værnet slås til med en nøgle

**Beslutning:** klientsiden af `B26` bygges og merges nu, mens begge knapper i
Supabase bliver stående på "fra". Bot-værnet aktiveres af, at
`VITE_TURNSTILE_SITE_KEY` sættes i Vercel — ikke af en udrulning — og den nøgle
skal sættes **før** Bot Protection slås til i Supabase.

**Hvorfor ikke bare vente, til rækken skal køres.** Fordi rækkefølgen ikke er
symmetrisk, og den forkerte er dyr. Appen taler REST direkte med GoTrue (ingen
SDK, se `src/lib/supabase.js`), og GoTrue kræver kvitteringen i
`gotrue_meta_security.captcha_token` på **tre** endpoints, ikke ét: signup,
password-grant og recover. Slås Bot Protection til, mens klienten intet sender,
svarer serveren `captcha protection: request disallowed (not-provided)` på dem
alle — altså login og glemt-adgangskode for alle eksisterende brugere, ikke
bare oprettelsen af nye konti. Den fejl opdages først, når nogen prøver at logge
ind, og den rettes ikke af at trykke knappen tilbage, hvis den, der trykkede,
ikke er den, der opdager det. Med koden på plads først er den forkerte
rækkefølge stadig mulig, men den er nu skrevet ned tre steder (`.env.example`,
`DOCUMENTATION.md` §9, `MAIL.md`) i stedet for at være en fælde, ingen kendte.

**Hvorfor en nøgle og ikke et flag.** Et separat `VITE_TURNSTILE_ENABLED` ville
være to ting at holde enige om, og de kan blive uenige. Site key'en er den ene
oplysning, værnet ikke kan fungere uden, så den er også det ærligste udtryk for
"er det slået til". Uden den tegnes ingen widget, hentes intet script og sendes
intet ekstra felt — kaldene ser ud præcis som før, hvilket en test håndhæver.

**Knappen deaktiveres bevidst IKKE, mens kvitteringen mangler.** Det er den pæne
løsning lige indtil den dag, Cloudflares script er blokeret af en
annonceblokering eller en firewall — og så er login lukket uden en fejl at læse.
I stedet sendes forsøget, GoTrue afviser, og `daAuthError` oversætter afvisningen
til dansk. En fejl, man kan handle på, slår en knap, der aldrig bliver aktiv.

**Rækken hed "begge dele er Supabase-konfiguration, ikke kode". Det var forkert,
og det er værd at skrive ned hvorfor.** Påstanden er sand for et projekt, der
bruger `supabase-js` — biblioteket har en `captchaToken`-option, og
bekræftelsesflowet håndteres af `detectSessionInUrl`. Dette projekt har bevidst
ingen SDK (fire runtime-afhængigheder, se `DOCUMENTATION.md` §1), og dermed
arver det heller ikke SDK'ens færdige halvdel af en leverandørfunktion. Det er
den generelle lære: **et estimat, der er lånt fra leverandørens dokumentation,
antager leverandørens klient.** Samme fælde vil gælde næste gang en Supabase-
feature beskrives som "slå den til".

**Navnekollisionen efter en bekræftelses-mail løses med et suffiks, ikke med en
ny skærm.** Var navnet ledigt ved oprettelsen og taget, når mailen læses,
skriver `sikrProfil()` `Anna2`, `Anna3` … frem for at afvise. Alternativet var
at bede om et nyt navn på det værst tænkelige tidspunkt, på en skærm der ikke
findes. Et navn med et 2-tal er til at leve med; en konto, der ikke kan bruges,
er ikke. At navnet derefter ikke kan ændres er en reel mangel og ligger i
backloggens indbakke.

---

## 9. august 2026 — Egen afsender til auth-mails: Resend, ikke Outlook (`B25`)

**Beslutning:** appens to auth-mails sendes fra `noreply@leagly.app` gennem
**Resend**. `kontakt@leagly.app` er en separat, allerede eksisterende Microsoft
365-postkasse. Opskrift og register: [`MAIL.md`](./MAIL.md).

`B25` blev erklæret besluttet i august 2026 uden nogensinde at nå denne fil.
Backloggens egen regel siger, at en truffet beslutning flyttes hertil — det
rettes her, samtidig med at den leveres.

**Hvorfor ikke Outlooks egen SMTP, når Microsoft 365 alligevel er der.** Det var
det oplagte spørgsmål, og svaret er ikke smag. Microsoft slår SMTP AUTH med
basic auth **fra som standard for eksisterende lejere ved udgangen af december
2026** og har varslet den endelige fjernelse i anden halvdel af 2027. En
opsætning bygget på den ville altså holde op med at virke af sig selv om godt
fire måneder — og symptomet ville være **tavshed**, ikke en fejlmeddelelse:
mails, der ikke kommer frem, til brugere, der i forvejen ikke kan logge ind. Det
er nøjagtig den fejlklasse, `A9`, `G92` og dagskort-kontrollen alle handler om.
Dertil: 30 mails/minut, ingen leveringslog, og transaktionsmails, der blander sig
med en personpostkasses omdømme. Prisen ved i stedet at vælge Resend er én linje
i privatlivspolitikken.

**Hvorfor `noreply@` og `kontakt@` er to forskellige problemer.** Det er den
skelnen, hele opsætningen hviler på. `legal.js` lover, at kontaktadressen
*"virker også, hvis du ikke kan logge ind"* — altså at den kan **modtage**.
Resend kan kun sende. En løsning, der blandede de to, ville enten give en
afsender, ingen kan svare på, eller en postkasse, der sender transaktionsmails.
De har hver sin leverandør, og `noreply@` oprettes bevidst **ikke** som
postkasse: at svar bouncer er den rigtige adfærd.

**Hvorfor de to kan dele ét domæne.** Resends MX og SPF ligger under
`send.leagly.app`, og dens DKIM ligger på roden under sin egen selector
(`resend._domainkey`), som Microsofts to (`selector1`/`selector2`) ikke hedder.
Den eneste fælles post er DMARC.

> **Rettet 9. august 2026, samme dag.** Denne beslutning blev skrevet med
> "alt, hvad Resend har brug for, ligger under `send.leagly.app` — MX, SPF og
> DKIM", udledt af Resends dokumentation, fordi egress-proxyen blokerer
> `resend.com` fra arbejdsmaskinen. Panelet viser noget andet: DKIM ligger på
> roden. **Konklusionen holder — der er stadig ingen kollision — men
> begrundelsen var gættet, og gættet var forkert.** Sætningen står rettet frem
> for omskrevet, fordi forskellen mellem "aflæst" og "set" er hele pointen med,
> at runbogen mærkede tallene som antagelser. Det er ikke en tilfældighed, man kan læne sig på uden at
skrive den ned: den nærliggende fejl er at lægge Resends SPF som en **anden**
TXT-post på roden ved siden af Microsofts, og to SPF-poster på samme navn er
`permerror` — hvorefter *begge* afsendere fejler på én gang. Advarslen står i
`MAIL.md` med 🛑, fordi den vælter mere, end den ser ud til.

**DMARC bør blive på relaxed alignment.** Med DKIM på roden signerer Resend som
`leagly.app` og aligner direkte, mens SPF kun aligner relaxed (Return-Path er
`send.leagly.app`). DMARC kræver kun, at én af de to aligner, så den består
begge veje — strict ville altså ikke vælte noget her. *(Denne post påstod
oprindeligt det modsatte, af samme grund som ovenfor: den byggede på, at DKIM
signerede med `d=send.leagly.app`.)* Relaxed er stadig det rigtige valg, fordi
det er standarden og fordi strict gør opsætningen skrøbelig over for næste
afsender — men det er en anbefaling, ikke et krav, og forskellen er værd at
holde ren.

**Skabelonerne bor i repoet.** `docs/mail/recovery.html` og
`confirm-signup.html`, pastet ind i Supabase — samme mønster som
`sql/`-migreringerne: teksten findes ét sted og kan ses i en diff. Supabase har
ingen import, så prisen er, at en ændring i repoet ikke er udrullet, før nogen
har pastet den ind igen; det står i runbogen. `confirm-signup.html` bruges først
ved `B26`, men skrives nu, så dén række bliver ét klik frem for at have en
skjult tekstopgave i sig.

**Leverancen var ikke færdig, da den blev merget** — selve opsætningen ligger
uden for repoet, og registeret i `MAIL.md` startede med `?` i hver `Sidst
verificeret`-celle. **Den er det nu:** alle fire kontroller bestod samme dag,
inklusive den tredje, som er den eneste, der ikke kan snydes — at linket faktisk
åbner nulstillingsskærmen.

At skellet blev holdt, viste sig at være det værd. Kørslen fandt **tre** ting,
dokumentationen havde gættet eller sprunget over: DKIM-postens placering (gættet
forkert), GoDaddys konflikt ved håndindtastning, og at emnelinjen er et separat
felt, som bliver stående på Supabases engelske standard. Ingen af dem kunne være
fundet fra repoet.

---

## 9. august 2026 — `competition_matches` læses af enhver, der er logget ind (`G94`)

**Beslutning:** læsepolicyen på `competition_matches` er
`auth.role() = 'authenticated'` — samme regel som `competitions`,
`competition_participants`, `matches`, `leagues` og `seasons`. Migrering:
`sql/competition_matches_read.sql` (#50).

**Hvad der stod før.** `using (exists (select 1 from competition_participants cp
where cp.competition_id = cp.competition_id and cp.user_id = auth.uid()))`.
Sammenligningen er en tautologi, så betingelsen reducerede til "deltager du et
eller andet sted". Policyen fandtes ikke i nogen migrering — den var lavet i
hånden i Supabase og levede kun i den genererede `schema.sql`, hvilket er anden
halvdel af, hvorfor den kunne stå i så lang tid: der var ingen fil at læse den i
og ingen diff at se den i.

**Hvorfor rettelsen ikke er den nærliggende.** Skrives tautologien om til det
åbenlyst tilsigtede — `cp.competition_id = competition_matches.competition_id` —
bliver reglen STRAMMERE end i dag, og ligasiden går i stykker for alle:
`GroupScreen` tegner et kort for hver af ligaens konkurrencer, også dem man ikke
selv er med i, og henter status til dem alle. Scoper man til egne konkurrencer,
bliver netop de kort tomme for enhver. **Den "rigtige" rettelse ville altså have
gjort skaden større**, og det er værd at holde fast i: en typo i en betingelse
betyder ikke, at det, der stod, var det, man ville have.

**Hvorfor `authenticated` er svaret og ikke en opgivelse.** Tabellen er en ren
`(competition_id, match_id)`-kobling mellem to tabeller, der i forvejen er
læsbare for enhver, der er logget ind. Der er ingen personoplysning at beskytte,
og enhver kunne udlede koblingen i dag. Det, der lukkes, er en uenighed mellem
seks policies, hvor de fem sagde det samme. **Skal konkurrence-strukturen en dag
være mindre offentlig — `I12`s offentlige ligaside er det første sted,
spørgsmålet ville blive stillet — er det de seks policies samlet, der skal
strammes.** Én af dem alene skjuler ingenting og ligner en beslutning, der er
truffet.

**Hvad det retter for en bruger.** Tautologien var for stram i den ene ende: en
bruger med nul deltagelser fik nul rækker, og `competition_status` er en
`security_invoker`-view oven på tabellen, så den blev tom for samme bruger.
Aflæst mod produktionsskemaet: deltager 1/1, nyinviteret ligamedlem 0/0.
Symptomet lå dermed på onboardingens egen skærm — den, der lige har taget imod
en invitation, så hver af ligaens konkurrencer som "0 kampe".

**Testen kræver af sig selv at se fejlen først.** `sql/tests/competition_matches_read.sql`
måler nybegynderens 0/0 FØR migreringen læses og fejler, hvis fixturen ikke
viser fejlen. Uden det kunne påstanden bestå på en harmløs fixture — samme krav
som `G92`s negative kontrol. Påstanden om reglen sammenligner desuden med
naboernes `qual` frem for med en streng, testen selv har skrevet, så de seks
holdes ens af testen og ikke af hukommelsen.

---

## 9. august 2026 — En test mod et miniskema er en test af noget andet (`G91`)

**Beslutning:** `sql/tests/liga_admin.sql` og `sql/tests/account_anonymization.sql`
kører fra i dag mod **produktionsskemaet** (`sql/tests/_schema.mjs`) og ikke mod
hvert sit håndskrevne miniskema. Og `account_anonymization.sql`s test **peges om**
på den funktion, produktionen faktisk kører, frem for at blive slettet.

**Hvorfor det andet valg overhovedet var et valg.** Testen indlæste kun
`sql/account_anonymization.sql` og prøvede dermed #31's selvstændige
`anonymize_my_account()` — en funktionskrop, ingen kører: produktionen kører #42's
skal om `_anonymize_account()`. De to udveje var at slette filen og folde dens
unikke påstande ind i `liga_admin.sql`s test, eller at pege den om. Valget faldt på
det sidste, fordi de otte påstande *ikke* findes i den anden fil — pseudonymets
form og længde, brugssporet ryddet tabel for tabel, at spillet står uændret, at
ligaen overlever, at vennen er urørt, at to lukkede konti ikke kolliderer — og
fordi de to filer stiller hvert sit spørgsmål: "hvad sker der med MIN konto" mod
"hvad må en administrator". At folde dem sammen ville have sparet en fixture og
kostet to læsbare filer.

**Hvorfor det første valg ikke bare var oprydning.** Miniskemaet havde ikke kun
syntetiske fremmednøgler. Det havde gjort én påstand **direkte forkert**:
"liga-admin kan ikke fjerne sig selv fra en konkurrence" blev målt i et skema, hvor
`comp_participants_delete_own_unlocked` ikke fandtes. RLS er et OR mellem
permissive policies, konkurrencen i fixturen var færdigspillet, og i produktionen
kan hun. Testen beviste altså ikke en regel, men fraværet af en anden fil — og det
er den generelle lære, der er værd at tage med: **en påstand om, at noget er
FORBUDT, kan ikke stilles mod et delvist policy-sæt.** En påstand om, at noget er
tilladt, kan; det er derfor miniskemaer holdt så længe.

**Selvudelukkelsen kan ikke måles, og det er nu skrevet ned.** `user_id <>
auth.uid()` i admin-policyen overlevede sin mutation: egen-frameldingen siger nej
netop når den lukkede selv har tippet i konkurrencen, og så siger admin-policyens
"ingen tips"-led allerede nej. Leddet er et værn, ikke en regel, nogen kan læne sig
på — det står i testens hoved frem for at blive fjernet, fordi et værn, der er
gratis, er billigere end en fremtidig policy, der glemmer det.

**To utestede led faldt ud undervejs** og fik hver sin nye påstand:
`coalesce(cs.concluded, false)` i liga-policyen havde aldrig mødt en konkurrence
uden kampe, og `is_group_admin(id)` i samme policy var aldrig blevet prøvet af et
almindeligt medlem. Begge slap igennem mutationstesten, indtil fixturen fik dem —
og ingen af dem kunne være fundet uden det rigtige skema, fordi
`competition_status` er en `security_invoker`-view, hvis synlighed afhænger af
`competition_matches`' egen læsepolicy.

**Prisen** er en fixture, der skal overholde rigtige fremmednøgler, og et
`disable trigger all` på `matches` i begge filer. **Gevinsten** er, at de policies
og funktioner, testene måler, er dem, der ligger i produktionen — sammen med alle
de andre, de konkurrerer med.

---

## 9. august 2026 — Fuldstændighedsreglen hører i motoren, ikke hos kalderne (`G92`)

**Beslutning:** kravet "hele kampdagen skal være færdigspillet" håndhæves som en
tidlig udgang **inde i `generate_daily_stories()`** — efter sidste-dag-udgangen
og før dens `delete` — og ikke ved at hver kalder spørger `match_day_complete()`
først. Bagstopperens dagsløkke får **ikke** betingelsen kopieret ind i sin
`where`-klausul.

**Hvorfor det overhovedet skulle besluttes.** Reglen fandtes allerede, men lå ét
sted: matches-triggeren. `generate_stories_catchup()` omgår triggeren pr.
definition og filtrerede kun pr. kamp, så én færdigspillet kamp kvalificerede
hele dagen — og "Dagens facit" blev udgivet midt på kampdagen med tal beregnet
på en halv dag. Meldt af en bruger 9. august.

**I motoren og ikke hos kalderne, fordi der er fem kaldere.** Triggeren,
bagstopperen, `story_engine_v2_backfill.sql`, `story_engine_v2_measure.sql` og
manuelle kald. Fire spurgte selv. Den femte gjorde ikke, og det kunne ikke ses
noget sted — hverken i en test, i kontrollen eller i `job_runs`. En regel, hver
kalder skal huske, er den regel, den næste kalder glemmer; det er præcis, hvad
der skete her. Prisen ved at flytte den er et kald, der returnerer på to
`exists` mod indekserede prædikater, før motoren rører en temporær tabel.

**Og derfor IKKE også i løkkens `where`.** Det ville gøre reglen til to regler,
som skal holdes ens — nøjagtig den tilstand, der lod fejlen opstå, bare med et
sted mere at drive fra. **Prisen er reel og accepteret:** en ufuldstændig dag
kvalificerer sig stadig og får et kald, der returnerer straks, så løkken ikke er
selvafsluttende for en dag, der aldrig bliver færdig (`A39`s globale
afgrænsning). Det er samme afvejning, `G90` allerede traf for runde-løkken, og
svaret er det samme: **loftet på 20 gør prisen endelig frem for ubegrænset**,
ældste først, så et rigtigt hul aldrig sulter bag en blokeret dag. En ægte
terminering ville kræve, at et forsøg blev husket — altså en tabel eller en
kolonne — og det er en større pris end den, der betales her.

**Kontrollen fik den modsatte påstand, og rækkefølgen i `case`-udtrykket er
selv en beslutning.** `day_card_coverage` ledte kun efter et manglende kort.
Den melder nu også `KORT PÅ EN DAG, DER SPILLES`, og den tilstand står **først**,
fordi de to fejl ikke vejer det samme: et manglende kort er et udeblevet svar,
et for tidligt kort er et forkert svar, brugeren allerede har læst. Afgrænset
med `news_value is not null` (v3-æraen, samme skel som `stories_day_slot_uniq`),
så kortene fra før rettelsen ikke holder alarmen rød for evigt — en alarm, der
ikke kan blive grøn, bliver ignoreret.

**`A39` er ikke afgjort af dette.** Om `match_day_complete()` skal blive ved med
at være global — én kamp uden resultat i én turnering blokerer alle dagskort —
er et andet spørgsmål, og rettelsen her tager ikke stilling til det. Den gør
kun, at reglen, uanset hvordan den en dag lyder, håndhæves ét sted.

## 8. august 2026 (nat) — En opdigtet tid genkendes på, at den flytter sig (`G85`)

**Beslutning:** football-data.orgs opdigtede klokkeslæt for Premier League,
Primera División og Serie A markeres af **kandidat B** — sammenlign med den
forrige synkronisering — og markøren er en **ny, display-only kolonne**
(`matches.kickoff_uncertain`), ikke `kickoff_tbd`. Læringen generaliseres fra
kampen til turneringen med `G84`s eget gulv på tre.

Tre valg, tre begrundelser.

**B og ikke A, fordi A skulle bære en risiko, der ikke findes — og selv ville
skabe en.** Backlogrækken sagde, at "låsen sættes efter et tidspunkt,
leverandøren har fundet på". Det passer ikke: `public.match_lock_at()` og
`lockAtOf()` regner låsen ved HVER læsning ud fra rækkens nuværende
`kickoff_at`, og syncen kører hver 12. time, så en rettet tid retter låsen af
sig selv. Skaden er displayet af fjerne kampe, ikke tipsvinduet. Dermed falder
argumentet for kandidat A's hastværk væk — og tilbage står dens pris: en tabel
over pladsholderværdier ville være kalibrerede tal uden data at kalibrere på
(`A35`), og værre endnu, **efterårspladsholderen ER turneringens typiske
anspilstid**. A ville markere ægte kampe på netop de klokkeslæt, de rigtigt
spilles på. B bygger derimod på en kendsgerning om vores egne rækker: en tid,
der flytter sig, var ikke fastsat.

**En ny kolonne og ikke `kickoff_tbd`, fordi det flag gør tre ting og kun den
ene er ønsket.** Det skjuler klokkeslættet (ønsket), rykker låsen fra kickoff−1t
til midnat på spilledagen — 16 timer strengere — (ikke ønsket) og fjerner
deadline-påmindelsen helt (ikke ønsket). At genbruge det ville have kostet
brugerne tipstid for at rette en visning. Den nye markør rører hverken
`match_lock_at()`, en eneste RLS-policy eller `analytics_match_locks`, og
migreringen **kan** derfor ikke flytte en lås. Prisen er en kolonne mere og et
begreb mere at holde adskilt fra det gamle; det er sagt højt i begge filhoveder
og prøvet af som påstand 8 i `sql/tests/kickoff_uncertain.sql`.

**Gulvet er tre, og det er `G84`s og ikke et nyt tal.** Uden generaliseringen
kan B kun svare bagudrettet om den enkelte kamp, og det hjælper ingen bruger.
Med den er spørgsmålet, hvornår en flytning er et regime frem for en
omberammelse — og dét er præcis det spørgsmål, `G84` allerede har svaret på med
et gulv på tre og en begrundelse, der holder her: én kamp, der flytter sig, er
normalt (en tv-flytning), mens pladsholder-regimet flytter en hel måned ad
gangen. **Et genbrugt tal er bedre end et nyt ukalibreret.** Grupperingen sker
på UTC-klokkeslæt, fordi vi ikke gemmer en tidszone pr. turnering; prisen er, at
sommertidsskiftet deler efterårspladsholderen i to værdier, der læres hver for
sig, og det er den sikre retning at fejle i.

**Det, der bevidst IKKE blev rettet:** `kickoffTbdOf()` i
`api/_providers/footballdata.js`. Funktionen er ufuldstændig, ikke forkert —
Bundesligas markør er aflæst og ren — og der findes ikke et felt hos de tre
andre turneringer at læse tiden af. Rettelsen hører derfor et lag længere inde.

**Kendt underdækning, som ikke lukkes med et gæt:** Premier Leagues december
bærer to distinkte klokkeslæt, som læres hver for sig. Aflæsningen siger
udtrykkeligt, at årsagen til det split ikke er efterprøvet.

---

## 8. august 2026 (aften) — En kopi uden en vagt mod originalen er ikke en kilde (`G86`)

**Beslutning:** en JS-konstant, der spejler noget, motoren ejer i SQL, må kun
blive stående, hvis den har **både** en aftager i appen **og** en test, der
læser SQL-filen og fejler ved drift. Har den ingen aftager, slettes den. Har den
en aftager, men ingen vagt, er den en fejl, der venter.

**Begrundelse.** `src/lib/stories.js` bar elleve exports uden en eneste aftager,
og tolv tests, der så ud som invarianter: "ingen to regler deler prioritet",
"kun DAY_RESULT ligger i det dæmpede dagstier", "den svage variant kan ikke
fortrænge rundens vinder". De påstod alle sammen noget om en **kopi**, og en
kopi kan være internt konsistent, mens originalen er drevet fra den — testen om
`RULES` ville stå grøn dagen efter, at to regler i `sql/story_engine.sql` fik
samme tal. Det er tredje form af samme fejl på to dage: `G78`s scoringstal,
formiddagens tekstskabeloner, og nu katalogerne.

**Modsætningen er selve reglen.** `STORY_RULES` i `src/lib/analytics.js` er også
et regelkatalog i JS og bliver — fordi Analytics per definition ikke kan vise en
regel, der aldrig har udløst (RPC'en ser kun rækker, der findes), og fordi
`analytics.test.js` LÆSER `sql/story_engine*.sql` og fejler, når motoren udvides
uden at listen følger med. Den kopi har en grund til at findes og en vagt mod
originalen. De slettede havde ingen af delene.

**Der blev bevidst IKKE skrevet nye tests som erstatning.** De fire ting, de
tolv dækkede, påstås allerede mod den rigtige motor i
`sql/tests/story_engine_daily.sql` (påstand 11b, 2d og 14) og i
`analytics.test.js`. En ny JS-test for resten ville have været den samme
illusion ét sted længere nede — og det, der IKKE længere er vogtet, er sagt højt
i testfilen frem for at blive antaget dækket.

**Prisen er sagt højt:** prioritetstallene kan nu kun læses i SQL'en. Det er
hensigten — det er dér, de virker — men en læser, der før kunne slå stigen op i
`RULES`, skal nu åbne `sql/story_engine.sql`. `DOCUMENTATION.md` §17 er rettet,
så den peger på den rigtige kilde; den påstod indtil i dag det modsatte.

---

## 8. august 2026 (eftermiddag) — Mini-stillingens form, og at et kort kun må have én kilde til sin tekst (`G88`, `G86`)

**Beslutning 1 — vinduet er tre rækker OMKRING modtageren, klemt mod enderne.**
Spec §8 sagde "over/dig/under". Det er fravalgt: nr. 1 har ingen over sig, så
formen ville give føreren to rækker og den midterste tre — mindst indhold til
den, der har præsteret mest. Vinduet klemmes i stedet, så nr. 1 ser 1-2-3 og den
sidste ser de tre nederste.

**Beslutning 2 — placeringen er `rnk`, udsnittet er en total orden.** De to tal
er forskellige og skal være det: `rnk` deles ved pointlighed, så to spillere på
tredjepladsen begge står som nr. 3 (det er den rigtige oplysning), mens
udvælgelsen af de tre rækker sker på `(rnk, user_id)`, fordi et vindue skåret på
et tal, der kan deles, ikke er deterministisk. Acceptkriterie 7 kræver, at to
gen-kørsler giver samme kort — også samme tre navne.

**Beslutning 3 — mini-stillingen daterer sig selv.** *"Stillingen efter kampdag
03.08"* står over rækkerne. Rækkerne er et snapshot fra den dag, kortet lever i
48 timer, og STILLING-fanen er live pr. kamp, så de KAN modsige hinanden. Det er
nøjagtig `A38`s fejltype i lille format, og løsningen er den samme: kortet
påstår ikke noget om nuet, det fortæller, hvad der gjaldt den dag. Alternativet
— at lade mini'en være live — er ikke muligt uden at lade komponenten hente
stillingen selv, og dét ville flytte designreglen om, hvem en historie må nævne,
ud i en komponent, hvor den kan glemmes.

**Beslutning 4 — milepæls-kort har ingen mini.** `apply_milestone_stories()`
sætter kortets `competition_id` til milepælens, som kan være en anden end den,
kortet blev skrevet for. Enten måtte kapringen genberegne stillingen, eller også
måtte mini'en væk. Den fjernes, fordi et milepæls-kort er en engangsbedrift og
ikke en stillingsopdatering — og fordi de to veje til et `MILESTONE`-kort
(motoren og cron) skal give byte-samme række. Motoren udelader den, kapringen
fjerner den.

**Beslutning 5 — `renderStory()` slettes frem for at blive taget i brug.** Den
lovede en fallback-rendering fra payload, og valget stod mellem at gøre løftet
sandt (lade frontenden rendere fra payload) eller fjerne det. Fjernet, af samme
grund som `G78` dagen før: **motoren skriver færdig `headline`/`body` på rækken,
så en klient-side rendering ville være en anden kilde til samme tekst.** Prisen
ved at lade den stå var ikke en fejl, men at hver tekstrettelse skulle laves to
steder, hvoraf kun det ene kunne ses af en bruger — `A38` betalte den regning.

**Grænsen, der IKKE flyttes: `renderFrame()` bliver.** Den ligner `renderStory`
og er det modsatte. SQL'en bygger `payload.frames` som rene **data**, og teksten
skrives kun i JS — der er ingen kopi at holde i sync. Reglen er derfor ikke
"tekst hører til i SQL", men **"en tekst må kun have én kilde"**, og de to
funktioner er hver sin lovlige side af den.

---

## 8. august 2026 — Backloggen bærer kun den seneste log, og tier-overskrifterne bærer deres rækker

**Beslutning:** `docs/BACKLOG.md` har ét historik-afsnit, **Log**, i bunden af
filen, og det bærer **kun den nyeste kørsel**. Skrives en ny, slettes den
forrige. Ingen indbakke og ingen tier-overskrift bærer sin egen historik længere;
står der noget under en overskrift, er det tilstand. Tier 1–5 viser nu deres
rækker i stedet for referater af, hvad der engang stod i dem.

**Begrundelse — det var tredje eksemplar, ikke sidste.** Filen var vokset til 780
linjer, hvoraf omkring 300 var referater af leverede rækker: syv
indbakke-rydninger, fjorten daterede afsnit under Prioriteret rækkefølge og en
kørselshistorik under hver af de fem øverste tiers. Ti stikprøver (`G2`, `G7`,
`G58`, `G63`, `G65`, `G67`, `G71`, `G73`, `G74`, `G84`) blev slået op i
`DECISIONS.md` og `CHANGELOG.md` før sletningen, og alle ti stod begge steder —
med begrundelsen i den ene og leverancen i den anden, altså fyldigere end
referatet. Backloggens egen regel om at **slette frem for at strege ud** gjaldt
allerede rækkerne; den gjaldt bare ikke teksten om rækkerne, og derfor voksede
den ene fil, der er skrevet til ikke at vokse.

**Hvorfor kun én og ikke tre eller fem.** Formålet med at beholde noget er, at
den næste session kan se, hvad der lige er sket, uden at læse hele listen. Det
formål er opfyldt af den seneste; nummer to og frem tjener kun genlæsning, og
genlæsning er præcis det, arkivfilerne findes til. Grænsen skal desuden være
mekanisk — "de sidste par" er ingen grænse, og det var sådan, de syv opstod.

**Prisen er sagt højt:** tværgående mønstre, der blev formuleret i et referat og
ikke andre steder, forsvinder ved næste rydning. Modtrækket er, at en lære, der
er værd at beholde, hører til i `DECISIONS.md` — dér kan den revideres, fordi
den står med sin begrundelse. En lære, ingen gad flytte, var ikke værd at
beholde.

---

## 8. august 2026 — `pg_safeupdate` gjorde "jeg prøvede det i hånden" til et misvisende bevis

**Fundet:** Story Engine v3's dagsmotor indeholdt én `update` uden `where`
(`update _sd_scored set news_value = …`). Supabase indlæser `pg_safeupdate` via
`session_preload_libraries` på rollen **`authenticator`**, som PostgREST
forbinder med, og den afviser sådan en sætning. SQL-editoren forbinder som
`postgres` og indlæser den ikke.

**Beslutning:** sætningen fjernes frem for at få en `where`. `where true` er ikke
en pålidelig rettelse — en konstant-sand qual kan planlæggeren folde væk, og så
står sætningen igen uden qual. `news_value` beregnes i en ydre `select`, hvor
leddene allerede findes. Fejlklassen bevogtes fremover af vagt 2 i
`sql/migration_syntax.test.js`; `sql/dev/` er undtaget, og undtagelsen vender
modsat vagt 1's, fordi editoren er det ene sted, udvidelsen ikke findes.

**Begrundelsen er værd at læse, fordi den retter en slutning, der stod i denne
log dagen før.** Rækken nedenfor konkluderede, at den kaldende rolle var
irrelevant, "fordi hele kæden er `security definer` som `postgres`". Det er
sandt om *rollen* og forkert om *sessionen*: `session_preload_libraries` hører
til forbindelsen og gælder uanset, hvem funktionen kører som. Præcis den
fejlslutning gjorde, at det manuelle kald — som lykkedes med 20 rækker — blev
læst som en afkræftelse af, at der var en fejl, mens det i virkeligheden var
selve symptomet: **funktionen virkede kun der, hvor udvidelsen ikke var.**

**Det generelle:** en afhængighed, der kun findes i den ene af to veje ind i
databasen, gør "jeg prøvede det i hånden, og det virkede" til et misvisende
bevis. Det kostede fire afkræftede hypoteser og en tidsmåling, der alle så
rigtige ud. Sporet fra rækken nedenfor løste det på **første** kørsel — hvilket
er den efterprøvning, den rettelse ikke kunne få, da den blev truffet.

## 7. august 2026 (nat) — En historie skal enten være uafhængig af nuet eller trække sig, når nuet er løbet fra den (`A38`)

**Beslutning:** rundestoryen afløses ikke længere kun af et nyere dagskort. Den
trækker sig også, så snart den runde, Hjem viser som indeværende, er **strengt
senere** end storyens og har mindst ét resultat. Samtidig bærer kortet sin runde
i overskriftslinjen (`Rundens historie · 28.07 – 03.08`), og de tre regler, der
hævdede en *tilstand*, er sat i datid.

**Begrundelse — to ure, ikke ét.** Rundestoryens overskrifter er udsagn om en
**stilling**, og en stilling er live pr. kamp: `computeCompetitionState`
medregner en runde, så snart ÉN kamp har resultat. Afløseren — dagskortet —
skrives derimod først, når **hele kampdagen** er færdigspillet, og
komplethedsprædikatet er globalt over alle turneringer. Mellem de to øjeblikke
stod Hjem med et kort, STILLING-skærmen modsagde. Meldt af en bruger 7. august
2026: kortet sagde *"Du er nu foran Lis04 i Superliga Grundspil"*, mens Lis04 lå
over vedkommende i tabellen.

**Hvorfor begge greb og ikke ét.** Datidsformuleringen alene ville gøre
påstanden sand for evigt, men den ville stadig stå side om side med en tabel,
der siger noget andet. Tilbagetrækningen alene ville løse det tilfælde, men lade
kortet være usandt i de timer, hvor kampen spilles. Datelinen er det billigste af
de tre og det eneste, der virker **bagudrettet**: den udledes af `round_key` i
frontenden, så rækker, der allerede står i databasen, får deres dato med. Derfor
blev der ikke kørt backfill — `story_engine_backfill.sql` nulstiller
`dismissed_at` og ville genoplive kort, brugerne aktivt har afvist.

**Den accepterede upræcished er valgt, ikke overset:** reglen ser på brugerens
runde på tværs af alle konkurrencer, så et resultat i én turnering trækker også
et kort om en anden. En præcis regel ville kræve et opslag pr.
`story.competition_id` — et ekstra kald og en ny kodesti for nogle timers
gevinst. **Prisen ved beslutningen er, at top-slottet på Hjem kan stå tomt**,
indtil dagskortet lander. Ingen historie er bedre end en forkert.

## 7. august 2026 (nat) — Guarden om story-genereringen skal efterlade et spor, ikke kun beskytte

**Beslutning:** matches-triggeren skriver én `job_runs`-række (`job =
'story-engine'`) pr. kørsel af historie-porten, med hver berørt dag og runde,
om dagen var komplet, hvor mange kort der blev skrevet, og `sqlerrm` ved fejl.
Skrivningen ligger **uden for** exception-guarden. Dertil kontrollen
`sql/checks/day_card_coverage.sql`.

**Begrundelse.** Undersøgelsen af rapporten ovenfor afdækkede noget større end
selve kortet: v3's dagsmotor havde på det tidspunkt **aldrig skrevet en eneste
række i produktion**, og det kunne ikke aflæses nogen steder. Fire hypoteser blev
afkræftet undervejs — udrulningstidspunkt (produktionsdumpet fra 19:35 dansk
indeholdt allerede funktionen), en fejl i motoren (håndkaldet skrev 20 rækker),
`statement_timeout` (hele triggersætningen måler 141 ms) og kaldende rolle (hele
kæden er `security definer` som `postgres`) — og årsagen kunne på det tidspunkt **ikke
fastslås** (den blev fundet dagen efter — se rækken ovenfor), fordi beviserne ikke fandtes: `matches.updated_at` vedligeholdes ikke
af syncen, og de rækker, der eventuelt blev skrevet og rullet tilbage, er væk.

Det er selve konklusionen. Symptomet på en fejlet generering er **stilhed**, og
stilhed er uskelnelig fra en rolig uge. Det er samme fejltype som `A9` (juli
2026), hvor motoren aldrig havde genereret én eneste historie; dengang blev
guarden skærpet fra `notice` til `warning`, men en advarsel i Postgres-loggen er
i praksis lige så usynlig. **Derfor rettes ikke en formodet årsag, men
observerbarheden** — og de øvrige rettelser i leverancen (bagstopperen dækker nu
også i går og i dag; den tidlige udgang i dagsmotoren står før dens `delete`) er
alle valgt, fordi de virker uanset årsagen.

**Placeringen uden for guarden er ikke en detalje:** `begin … exception … end` er
en subtransaktion, så en insert indenfor ville blive rullet tilbage sammen med
alt andet, netop når der var noget at fortælle.

---

## 7. august 2026 — Ratingens bagstopper er en KONTROL, ikke et job (`G83`)

**Beslutning:** `recompute_derived()` sættes **ikke** på et skema. I stedet kører
`sql/checks/rating_freshness.sql` hver halve time i job-heartbeat'en og siger,
når genberegningen er nødvendig.

Rækken hed "ratingen har ingen bagstopper i cron", og det nærliggende var at
lægge et femte kald ind i notifikations-jobbet ved siden af de fire, der allerede
er der. Det er fravalgt af to grunde. **Prisen er asymmetrisk:**
`recompute_ratings()` sletter og genopbygger hele `rating_history` fra runde nul
— den er dyr hver gang, mens de fire andre kald koster ingenting, når der intet
er at gøre. Og **det ville skjule spørgsmålet:** en genberegning hvert kvarter
retter tilstanden uden nogensinde at fortælle, at den var forkert, så vejene uden
om triggeren (gendannelsen, et sent tip, et skiftet `is_official`) ville forblive
usynlige. En kontrol koster ét opslag og efterlader et spor.

**Afvejningen er sagt højt:** en kontrol retter ikke noget af sig selv, så der går
op til en halv time, før nogen får besked, plus den tid det tager at køre ét kald.
Til gengæld er alarmen selv oplysningen — og fejlteksten bærer rettelsen med, så
afstanden fra alarm til handling er ét copy-paste.

**Generaliseringen er værd at holde fast i:** når en tilstand kan blive forkert
ad veje, vi ikke kender, er en kontrol bedre end en gentagelse. Gentagelsen
skjuler både fejlen og dens årsag; kontrollen finder dem begge.

## 7. august 2026 — Friskhedsmålingen på `schema.sql` RAPPORTERER, den afviser ikke (`G79`)

**Beslutning:** docs-SQL-kørslen måler, om `sql/schema.sql` dækker det,
migreringerne i `sql/` opretter, og skriver svaret øverst — men en manglende
eksport gør **ikke** kørslen rød af sig selv.

Det oplagte var at fejle: eksporten ER bagud, og det er en fejl, nogen skal rette.
Men eksporten kører mandage og manuelt, så enhver PR, der tilføjer en SQL-fil, er
lovligt forud for den. En gate ville gøre hver eneste migrerings-PR rød på noget,
der ikke er en fejl — og en farve, der altid lyser på det samme, holder folk op
med at læse den. Nøjagtig samme argument som `G2`s: et loft, der kun kan vokse,
er ikke et loft.

**Det, rækken faktisk bad om, var ikke en gate, men en SKELNEN:** en rød blok
skulle kunne kendes fra en manglende eksport. Det kræver, at kørslen siger, hvad
den ved — og den grønne linje ("eksporten dækker alle N objekter") bærer lige så
meget som den røde, fordi den fjerner dumpet som mulig forklaring.

Prisen er, at en stille bagud-eksport kan ligge længe. Den er acceptabel, fordi
den eneste skade er en fejl, der er sværere at læse — og netop dén skade er nu
lukket.

## 7. august 2026 — `G78` lukket UDEN den migrering, rækken forudsagde

**Beslutning:** v3's scoringstal fjernes fra `src/lib/stories.js` uden at tilføje
en kolonne til `stories` og uden at røre en eksisterende række.

Rækken stod i Tier 6 som "kræver en migrering af eksisterende rækker", og
forudsætningen var rigtig så langt: frontenden skal kunne afgøre
ulæst-markeringen uden at kende publiceringstærsklen, og det oplagte svar er en
boolean på rækken, skrevet af motoren og backfillet.

**Eftersynet viste, at svaret allerede står på rækken.** `generate_daily_stories()`
har præcis to udgange for et dagskort — vinderen over tærsklen med sin egen regels
prioritet (110–160), og det dæmpede `DAY_RESULT` på 180 — og dagens facit kan
aldrig nå tærsklen ved egen kraft (8 + 12 + 20 = 40 < 45, spec §5). `priority < 180`
betyder derfor det samme som `news_value >= 45`. At læse prioriteten er ikke en
genvej: SQL-filen udpeger selv prioriteten som frontendens grænseflade og nævner
`isDailyQuiet()` som en af dens tre aftagere.

**Valget koster en invariant, og den er gjort eksplicit** frem for underforstået:
påstand 14 i `sql/tests/story_engine_daily.sql` kræver `priority < 180` ⟺
`news_value >= tærsklen` for hvert v3-dagskort, og at fixturen har kort i begge
lejre, så påstanden ikke kan blive tom. Får motoren en tredje udgang, bliver det
opdaget dér.

**Den generelle lære:** en backlog-række er en hypotese om en løsning, ikke kun om
et problem. `G78`s problem var rigtigt beskrevet; dens foreslåede pris var
gætværk, og gætværket blev dyrere end svaret. Samme form som `G74`, der blev
leveret på det modsatte svar af det, rækken lagde op til.

## 7. august 2026 — En lukket konto overdrager sin liga og forlader den (`A36` + `A37`)

**Beslutning (produktejeren):** ved kontolukning **overdrages administratorrollen
til det ældste levende medlem**, og den lukkede konto **forlader ligaen**. Er der
ingen medlemmer tilbage at overdrage til, **bliver ligaen bare stående**.

De to spørgsmål er afgjort sammen, fordi de har samme udløser og modsatrettede
rettelser: `A36` (skal pseudonymet forlade medlemslisten?) ville alene have gjort
`A37` sværere at opdage, fordi den fjerner det eneste synlige spor af, hvorfor en
liga er frossen. Overdragelsen fjerner grunden til at have sporet.

**Hvorfor overdragelse frem for de tre andre muligheder.** Rækken havde fire:
overdrag, tillad forfremmelse, lad en platform-admin gribe ind, eller accepter
vilkåret. Forfremmelse er en UI-funktion, der bevidst er udskudt fra liga-lagets
v1 og stadig ikke er efterspurgt; en platform-admin-indgang løser det for os og
ikke for brugerne; og at acceptere vilkåret var ikke længere gratis, da
aflæsningen viste, at fire rigtige ligaer med 5–9 medlemmer hver har præcis én
levende administrator. Overdragelsen er den eneste, der virker **uden at nogen
skal opdage problemet først** — og det er hele pointen, for symptomet (en knap,
der ikke virker) opstår måneder efter årsagen.

**"Ældste" er `group_members.joined_at`, ikke `profiles.created_at`.** Det er den
aflæsning, der giver mening i et fællesskab: den, der har været med i ligaen
længst, er den, de andre kender — ikke den, der tilfældigvis oprettede sin konto
først. `user_id` bryder uafgjort, så resultatet ikke afhænger af rækkefølgen på
disken.

**Frameldingen har invarianten som grænse, og det var ikke et valg.**
`group_membership_invariant.sql` kræver deltager ⇒ medlem, så medlemskabet kan
kun fjernes i de ligaer, hvor der ikke er en deltagelse tilbage. `A25` har lige
fjernet dem, der ikke var begyndt; det, der står tilbage, er spillet historik, og
dér **bliver** pseudonymet på listen. Det er samme skel som resten af funktionen:
alt, der er sket, bevares. Bliver medlemskabet stående, degraderes rollen til
`member` — en konto, der ikke kan logge ind, er ikke en administrator, og
`league_admin_coverage` ville ellers tælle den som en.

**Den tomme liga bliver stående, og det er en beslutning og ikke en mangel.** En
liga uden medlemmer er usynlig — den vises kun for sine medlemmer — og koster
ingenting. Alternativet ville være at slette den, altså at fjerne data på en
formodning om, at ingen kommer tilbage.

**Rækkefølgen i koden er selv en regel:** overdrag FØR framelding. Overdragelsen
bruger den lukkede kontos egen `role = 'admin'` til at finde de ligaer, der skal
have en ny administrator; bytter man om, er oplysningen væk, og ligaen fryser
præcis som `A37` beskriver. En mutationstest låser det.

## 7. august 2026 — "Read-only" er to spørgsmål: rører den data, og efterlader den noget?

**Beslutning (`A37`):** forespørgslen, der aflæser, om en liga står uden en
levende administrator, flyttes fra `sql/dev/` til `sql/checks/` og skrives som en
**temporær view** — samme form som `kickoff_coverage.sql` (`G84`). Den er nu det
eneste af dagens to opslag, der må køres mod produktionen.

**Begrundelsen er, at det første udkast var forkert på en måde, der ikke lyste
op.** Filen blev kaldt read-only, og målt på data var den det: to `stable`
funktioner, ingen `insert`, ingen `update`. Men den installerede et skema og to
funktioner, som ville blive stående, til nogen huskede at droppe dem — og en
`create function` uden et eksplicit `revoke` får `execute` til `PUBLIC` som
default. At ingen rolle kan nå den, skyldes her, at ingen har `usage` på skemaet;
altså en default, ikke en beslutning. Det er samme klasse som `G50`/`G58`, hvor
pointen netop var, at bredden skal være en **regel** og ikke en liste over ting,
der tilfældigvis ikke er ramt.

**Reglen, der kommer ud af det, er kort nok til at huske:** *rører den data* og
*efterlader den noget* er to spørgsmål, og "read-only" besvarer kun det første.
Alt, der køres mod produktionen, skal svare nej til begge — og `sql/checks/`
er den form, der garanterer det andet.

**Det er ikke en ny model, det er den, der lige var skrevet ned.** `G84`s
leverance (5. august) sluttede med sætningen om, at en temporær view installerer
intet i produktionen og alligevel kan efterprøves i CI, og at modellen var værd
at genbruge næste gang en kontrol skulle skrives. Næste gang kom to dage senere,
og modellen blev ikke brugt, før nogen spurgte. **En model, der kun står i en
changelog, er ikke en model** — derfor står vilkåret nu i `sql/README.md`s
mappetabel, hvor man læser det, før man vælger mappe.

## 7. august 2026 — En uigenkaldelig funktion prøves af mod `schema.sql`, ikke mod staging

**Beslutning (`G76`):** den første kørsel af `anonymize_my_account()` blev lagt i
en lokal PostgreSQL med `sql/schema.sql` kørt ind — ikke i staging, som rækken
selv foreskrev — og rækken blev derefter **delt i to** frem for lukket.

**Begrundelsen er, at rækken beskrev ét miljø og to opgaver.** Det, der bar
risikoen, var en uigenkaldelig SQL-funktion, som aldrig havde rørt andet end et
håndskrevet minischema i CI. Til dét spørgsmål er `sql/schema.sql` ikke en
erstatning for produktionsskemaet — den **er** produktionsskemaet, den ligger i
repoet, og den kan køres på et minut. Staging tilføjer ikke ét gram troværdighed
til det svar; den tilføjer noget helt andet, nemlig knappen i Profil,
`api/delete-account.js` og soft-sletningen i `auth.users`. **Den halvdel kan SQL
ikke nå, og den er derfor stadig Tier 1.**

Det er samme indsigt som `G74` traf 5. august, bare brugt et nyt sted: dér blev
`schema.sql` svaret på "kan docs' SQL-blokke tjekkes uden produktionsadgang?", og
her er den svaret på "kan en migreringsfunktion prøves af uden en database?". **Den
generelle regel er værd at skrive ned:** et spørgsmål om SKEMA kan besvares i
repoet; et spørgsmål om MILJØ kan ikke. En række, der blander de to, er to rækker.

**Prisen, sagt højt:** en lokal kørsel har ingen rigtige data, så den kan ikke
finde det, der kun gælder for produktionens rækker. Den kan kun efterprøve
reglerne. Det var også præcis det, der skulle efterprøves her — men det er ikke
et argument, der holder for enhver række i tieret, og `A32` er stadig det åbne
spørgsmål om aflæsninger, der KRÆVER de rigtige tal.

## 7. august 2026 — `A36` og `A37` er to rækker, ikke én

**Beslutning:** fundet fra prøvekørslen — at en liga, hvis eneste administrator
lukker sin konto, aldrig kan administreres igen — fik sit eget ID (`A37`) frem
for at blive foldet ind i `A36`, som handler om den samme hændelse.

**Begrundelsen er backloggens egen sammenlægningsregel, og den er den eneste, der
er brugt:** to punkter lægges sammen, når de deler **rettelse** — ikke når de
deler årsag. Det er samme afgørelse som `G81`/`G84` blev truffet på tidligere
samme dag. Her deler de to endda mere end en årsag: de ses i det samme kig på den
samme medlemsliste. Men rettelserne er modsatrettede. `A36` overvejer at **fjerne**
den lukkede konto fra ligaen; gøres det, mister en frossen liga også det eneste
synlige spor af, hvorfor den er frossen, og `A37` bliver sværere at opdage frem
for lettere.

**Rækkefølgen er derfor selv en beslutning:** `A36` afgøres efter `A37` og ikke
før. Et pseudonym på en liste er kosmetik; en liga, ingen kan administrere, er
ikke — og den billige rettelse må ikke lukke døren for den dyre.

## 7. august 2026 — En overvågnings-forespørgsel bor i en fil, ikke i en workflow

**Beslutning (`G84`):** kontrollen af, om kampene har klokkeslæt, skrives som en
**temporær view** i den nye mappe `sql/checks/` — ikke som en heredoc i
`job-heartbeat.yml`, sådan som workflowens to eksisterende kontroller er.

**Begrundelsen er, at denne kontrol kan tage fejl på en måde, de to andre ikke
kan.** "Har `monthly_standings` `security_invoker`?" er et ja/nej-opslag i
`information_schema`; skrives det forkert, fejler det højlydt. "Er alle en
turnerings kampe uden klokkeslæt?" er en påstand om, hvad der er et normalt
datamønster — og skrives DEN forkert, er resultatet en kontrol, der er tavs på
nøjagtig samme måde, hvad enten den virker eller ej. En kontrol udløser per
definition næsten aldrig; tavshed er dens normaltilstand og kan derfor ikke
skelnes fra, at den er død.

Derfor skal den kunne testes, og derfor må reglen kun findes ét sted. En
temporær view løser begge dele på én gang: den installerer intet i produktionen
(ingen migrering, ingen kørsel hos ejeren, intet der kan drive fra repoet), og
den samme fil kan læses af heartbeat'en mod produktionsdatabasen og af
`sql/tests/kickoff_coverage.sql` mod en tom engangsdatabase. Prisen er et krav
om en **session**-forbindelse, som `SUPABASE_DB_URL` allerede opfylder, fordi
skema-eksporten bruger den til `pg_dump`.

**Fravalgt:** en `security definer`-funktion i skemaet (kræver en migrering,
altså en kørsel hos ejeren for hver rettelse af kontrollen — se `A32` om den kø)
og en heredoc som de to andre (kan ikke testes uden at duplikere forespørgslen,
hvilket er `G78`s fejltype).

**Selve tærsklen er den anden halvdel af beslutningen: 100 % og ikke en andel.**
En andel kræver et kalibreret tal, og der findes ingen data at kalibrere det på.
100 % er udledt af fejlen selv — en forkert aflæsning af leverandørens markør
rammer alt eller intet inden for én turnering — mens en terminsliste, hvor de
fleste kampe endnu ikke har fået tid, er fuldstændig normal. Et gulv på tre
kampe holder en enkelt omberammelse ude. Bliver det alligevel for følsomt en
dag, er rettelsen én linje; men en kontrol, der ofte er rød uden grund, lærer
man at holde op med at læse, og så er den værre end ingen.

## 7. august 2026 — Ét øjeblik om dagen: motoren vælger frem for at udgive

**Beslutning:** Story Engine v3 (spec:
[`features/story-engine-v3.md`](./features/story-engine-v3.md)). Fem dele:

1. **Højst ét `period = 'day'`-kort pr. bruger pr. dag**, på tværs af alle
   ligaer og konkurrencer. `DAILY_MAX_CARDS` 2 → 1, håndhævet af et unikt indeks
   på `(user_id, day_key)` frem for af koden.
2. **Karrusellen udgår.** Hjem viser dagens ene kort; `CAROUSEL_LIMIT` og
   `sortCarousel()` fjernes. Kort udløber efter 48 timer.
3. **Valget sker på en nyhedsværdi-score**, ikke på fast prioritet:
   grundvægt + størrelse (0–30) + nærhed til brugeren (0–20). Publiceringstærskel
   **45**; under tærsklen udgives det dæmpede `DAY_RESULT`-kort uden
   ulæst-markering.
4. **Rundens sidste dag udgiver kun rundekortet**, nu som tap-through med 4
   frames (+ en betinget frame 5). Dags-motoren springes over den dag.
5. **Milepæle får aldrig eget kort.** De deltager i scoringen med grundvægt 100
   og kaprer dermed dagens slot, og de får en betinget frame 5 i rundestoryen med
   deep-link til karriereprofilen.

Uændret: køretidspunktet, `match_day`/`round_key_of_date`, bagstopperen
`generate_stories_catchup`, triggerens to porte, prioritetsbåndet 110–189, den
periode-afgrænsede delete (v2 §8) og hele milepælskataloget med dets guards.

**Begrundelse:** v2's egen måling er anklageskriftet. `A33` noterede, at
`DAY_RESULT` alene står for 123 af 280 historier (44 %) — og det er ikke en
skævhed i regelsættet, det følger af konstruktionen: reglen har den laveste
prioritet, udløses næsten altid, og v2 §3 beskriver den selv som *"ankeret;
optager reelt altid plads 1"*. Med to kort om dagen betyder det, at det første,
brugeren møder, per design er det mest forudsigelige. Oveni giver en uge med fem
kampdage op til ti kort plus milepæle i et felt, hvis loft (`CAROUSEL_LIMIT =
10`) dermed var ugens normaltilstand og ikke en sjælden kant.

Et øjeblik, der deles med ni andre, er ikke et øjeblik. Feature'ens målsætning
har hele vejen været, at brugeren skal kunne genfortælle dagens historie — og ti
kort kan ingen genfortælle. Fejlen var ikke, at der genereres for ofte (daglig
generering fastholdes uændret), men at motoren udgav alt, den fandt, i stedet
for at vælge.

**Hvorfor scoring frem for strammere prioriteter:** en prioritetsstige rangerer
regeltyper, ikke begivenheder. Den kan ikke skelne en overhaling på fire pladser
fra en på én, og den kan slet ikke se, om hovedpersonen er brugerens nærmeste
rival eller en fremmed i den mindste liga. Nærhedsleddet er hele grunden til, at
en andens aften kan blive brugerens historie, og det kan kun beregnes pr. bruger
— derfor er slottet `(user_id, day_key)`-unikt og ikke `(competition_id, day_key)`.

**Hvorfor tærskel frem for altid at udgive en historie:** et ulæst-signal, der
lyser hver dag, er ikke et signal, det er en baggrundsfarve. Det dæmpede kort
findes allerede som kortudgave i v2 §9, så prisen for at holde signalet sjældent
er nul nyt UI. **Tallet 45 er dog udledt af grundvægtene og ikke af data** — det
er v3's svageste tal og er derfor skrevet ud som en åben beslutning (`A35`) med
en målbar udløser frem for at blive låst her.

**Hvorfor milepæle beholder en plads på Hjem:** `milepaele-v1.md` §8 sagde det
allerede — uden den plads ville de fleste aldrig opdage, at de havde opnået
noget, og karriereprofilen er ikke et sted, folk går hen for at tjekke, om der er
sket noget. Det, der var galt i v2, var ikke at milepæle blev vist, men at de
lagde sig **oven i** dagens historie. Ét slot fjerner den mulighed uden at
fjerne visningen: uanset hvor mange milepæle der udløses samme dag, kan der kun
vises én, og resten ligger på profilen. Kalibreringen strammes tilsvarende — en
aktiv bruger må ramme en milepæl ca. hver anden uge, ellers konkurrerer
milepælene med sig selv om slottet.

**Prisen, der accepteres:** de historier, der taber slottet, vises aldrig. Med
v2's karrusel kunne en bruger i tre ligaer i princippet følge alle sine
konkurrencer dagligt; det kan de ikke længere. Det er en bevidst ombytning af
dækning mod hukommelse, og den kan aflæses: falder `story_viewed` pr. bruger
ikke, mens andelen af dage med ulæst-markering falder, er ombytningen lykkedes.

## 6. august 2026 — Et loft pr. runde gør perioden til et frosset udvalg

**Beslutning:** Custom-perioden kan vælge flere turneringer og få et loft på
antal kampe pr. runde. Sættes et loft, skrives konkurrencen som `custom` med
udpegede kampe i stedet for `time_range` — altså **frossen ved oprettelsen**.
Uden loft er formen uændret, og perioden vokser som hidtil. Loftet fordeles
jævnt på de valgte turneringer ved en round robin, hvor den ekstra plads ved
ulige deling går til den turnering, der spiller først i runden.

**Begrundelse:** `time_range` er en voksende regel — `api/_backfill.js` føjer
kampe til, efterhånden som de skemalægges, og det er hele periodens løfte over
for en sæson, hvis slutspil først offentliggøres senere. Et loft sat ved
oprettelsen ville blive brudt **tavst** ved næste efterfyldning: brugeren beder
om ti kampe pr. runde og ender med fjorten uden at få det at vide. Et tal, som
brugeren har valgt, må ikke stille og roligt holde op med at passe.

Efterfyldningen kan ikke selv håndhæve loftet. Den kører **pr. sæson** — den
kaldes fra syncen med én sæsons kampe — og kan derfor ikke se, hvor mange kampe
konkurrencen allerede har fra de ØVRIGE valgte turneringer i samme runde. Et
loft på tværs af turneringer ville kræve, at efterfyldningen så hele runden på
én gang, altså en ombygning af den sti, der holder rigtige konkurrencer ajour.
Prisen for det står ikke mål med gevinsten ved en valgfri kupon-afgrænsning.

**Prisen er sagt højt i brugerfladen** frem for at ligge i en note: teksten
under felterne skifter mellem "også dem, der skemalægges senere" og "kampene
vælges nu". De to løfter udelukker hinanden, og begge er sande — hver for sin
indstilling.

**Hvorfor round robin og ikke kvoter:** en kvoteudregning skal have en regel for,
hvad der sker, når en turnering har færre kampe end sin andel, og enhver sådan
regel er et nyt hjørne at teste. Round robin har svaret indbygget — en tom kø
springes over — og giver 4/3/3 ved ti kampe på tre turneringer, men 1/5/4 når
den ene kun har én kamp. Det var også præcis den betingelse, ønsket blev stillet
med: er der færre end ti i runden, er det bare dem, der er.

## 6. august 2026 — Man kan ikke vinde uden at have tippet

**Beslutning:** En spiller uden ét eneste tip kan hverken kåres som vinder eller
vinde en tiebreak. To ændringer i `src/lib/standings.js`, som begge følger af
samme sætning: `goalErrorOf()` giver en række med `matches === 0` den værst
mulige målafvigelse i stedet for den bedste, og `leaders()` svarer tomt, når
førstepladsen står på nul tippede kampe.

**Begrundelse:** Stillingen har én række pr. **deltager** og ikke pr. tipper —
og det skal den blive ved med, for man skal kunne se, hvem der er med. Men
dermed er "0 point" tvetydigt: det betyder både "tippede og ramte forbi" og
"deltog aldrig". Hele fejlen ligger i, at stigen behandlede de to ens.

Det synlige udslag var en afsluttet konkurrence, hvor ingen havde tippet, og
hvor alle tre deltagere fik en pokal. Det usynlige var værre: målafvigelsen er
stigens sidste trin, hvor mindst vinder, og `avgGoalError(0, 0) = 0` er den
bedst mulige værdi. Den, der ikke havde tippet, slog altså den, der havde
tippet tyve kampe og ramt skævt. **Man vandt tiebreakeren ved at lade være med
at deltage** — det modsatte af `A2` ("Månedschampionshippet må gerne belønne
deltagelse"), som er hele grunden til, at trinnet er et gennemsnit og ikke en
sum.

**Hvorfor `Number.MAX_VALUE` og ikke `Infinity`:** to spillere uden tips skal
være **ægte lige** og dele placering. `Infinity - Infinity` er `NaN`, og en
`NaN` i en komparator gør sorteringen udefineret frem for delt.

**Hvorfor det er nok at se på førstepladsen i `leaders()`:** efter den første
ændring kan en spiller uden tips aldrig komme foran en, der har tippet. Er nr. 1
på nul kampe, har ingen tippet.

**Databasen var aldrig ramt, og det afgrænser beslutningen.** Kåringerne
(`award_competition_periods()`) og milepælene (`_ms_final`) bygger deres vindere
på `predictions join matches` og `competition_match_points`, hvor en spiller
uden tips slet ikke findes. Der er ikke uddelt en eneste kåring eller permanent
milepæl på det forkerte grundlag. Rettelsen hører derfor i klienten alene — og
stigen i SQL (`sql/standings_tiebreakers.sql`) skal **ikke** følge med, fordi
dens views ikke indeholder rækker med nul kampe. Det er den ene gang, hvor JS og
SQL med vilje ikke er ens, og grunden er, at de ikke får de samme rækker ind.

## 6. august 2026 — Sæson-simulationen i staging får sin EGEN turnering

**Beslutning:** Testdata til staging fremstilles af
[`sql/dev/simulate_season.sql`](../sql/dev/simulate_season.sql), som opretter en
syntetisk turnering ("SIM-ligaen") med egne hold og et fuldt
dobbeltturneringsprogram — frem for at skrive tips og resultater på de rigtige
turneringers kampe. Simulationens kampe bærer `api_fixture_id`-præfikset `sim:`,
ligaen har intet `api_league_id`, og `live_enabled` er slået fra.

**Begrundelse:** Den nærliggende vej — taste resultater på Superligaens kampe i
staging — er ikke bare besværlig, den er **ustabil**. `toRow()` i
`api/sync-matches.js` skriver `home_score: null`, når leverandøren ikke melder
kampen færdig, og upserten kører på `api_fixture_id`. Ét tryk på "Hent nu"
sletter dermed hver eneste håndtastede score i sæsonen, og det sker tavst — man
opdager det, næste gang en stilling er tom. Det er præcis den risiko, der
udløste opgaven.

Med en turnering, ingen leverandør kender, findes fælden ikke: der er intet
`api_fixture_id`, en upsert kan ramme, og intet liga-id at hente fra. De
rigtige turneringer kan synkroniseres frit ved siden af.

**Prisen er, at simulationen ikke tester leverandør-stien** — hverken
holdmatchning, paginering eller `kickoff_tbd`. Det er accepteret, fordi den sti
allerede har tests og et dry-run, mens dét, den ikke kan levere, er en sæsons
historik.

**Den anden beslutning i samme fil: tips trækkes fra samme model som
resultaterne, ikke fra resultatet.** Et hold har en styrke, styrkerne giver et
forventet antal mål, resultatet er en Poisson-trækning derfra, og tippet er den
samme beregning set gennem brugerens `noise`. Alternativet — "lad tippet ramme
i X % af tilfældene" — kræver, at resultatet findes, **før** tippet kan skrives,
og så kan en runde ikke tippes, før den er spillet. Med to trækninger fra samme
model er rækkefølgen ligegyldig, og forskellen mellem brugerne opstår af sig
selv.

**Det kostede en måling at få rigtigt.** Første udgave trak også tippet fra
Poisson-fordelingen, og så forsvandt forskellen mellem personaerne: 43 % mod
35 % rigtige udfald, altså trækningens støj og ikke brugerens dygtighed. Et
menneske tipper det, det **forventer** (2-1), mens en kamp er tilfældig — den
asymmetri er hele grunden til, at ingen rammer eksakt særlig ofte. Målt på
20.000 kampe giver de tre personaer nu 0,62 / 0,54 / 0,47 point pr. kamp.

## 6. august 2026 — "Tid ikke fastlagt" aflæses af tidsfeltet, ikke af leverandørens status

**Beslutning:** `kickoffTbd` udledes hos **begge** leverandører af den samme
markør — midnat-pladsholderen i tidsfeltet (`isMidnightPlaceholder()` i
`api/_providers/kickoff.js`). football-data.orgs `SCHEDULED` vs `TIMED` bruges
**ikke længere** til noget; den rå status bæres fortsat med i `liveState` og er
dermed en diagnose i forhåndsvisningen (`&dryRun=true`), ikke en regel.
Sportmonks beholder sin egen state `TBA` oveni, fordi den betyder noget, den
anden markør ikke dækker: hverken dato eller tid er bekræftet.

**Begrundelse:** Beslutningen fra 2. august gav hver leverandør sin egen markør
med den rigtige begrundelse — *formen er fælles, kilden er det ikke* — men den
ene af de to markører var **uprøvet**, og det stod skrevet i beslutningen selv:
egress-politikken blokerer begge leverandørers API og docs fra
udviklingsmiljøet, så Sportmonks-markøren blev sluttet af de **gemte data**,
mens football-data.orgs blev sluttet af **dokumentationen**. Den, der kunne
efterprøves, holdt. Den anden gjorde ikke: alle fem football-data-turneringer
mistede deres klokkeslæt i appen, fordi en turnering kan blive stående i
`SCHEDULED` længe efter, at tiderne er sendt.

**Beviset kom fra rækkefølgen, ikke fra tiderne.** Kampene uden klokkeslæt
sorterede ind **mellem** Superligaens 16.00 og 18.00 samme dag — og sorteringen
er `byKickoffThenTeams`, altså på `kickoff_at` selv. En midnats-pladsholder
ville have ligget først på dagen. Værdien var der hele tiden; det var kun
visningen, der skjulte den. Det er den generelle vej ud af et symptom som dette:
en visning, der udelader et felt, kan stadig **sortere** på det.

**Prisen er kendt og den samme som Sportmonks' i forvejen:** en falsk positiv
for en kamp, der faktisk starter 00:00 UTC (02.00 dansk sommertid). Ingen af de
dækkede turneringer spiller på det tidspunkt. Til gengæld er der nu ét sted at
tage højde for den, i stedet for to. **Hvad der stadig ikke vides:** hvordan
football-data.org faktisk markerer en kamp, hvis tid ikke er fastsat — at det er
midnat UTC, er en antagelse på linje med den, der lige blev afkræftet, og den er
noteret som sådan i backloggens indbakke. Forskellen er, at den nu fejler i den
**ufarlige** retning: en tid, der ikke findes, vises som en tid, mod tidligere en
tid, der findes, der ikke blev vist.

## 5. august 2026 — `A25`: en lukket konto meldes af det, der ikke er begyndt

**Beslutning:** `_anonymize_account()` (`sql/liga_admin.sql`) sletter den lukkede
kontos `competition_participants`-rækker i de konkurrencer, hvor **ingen kamp er
låst eller spillet** — og kun når mindst én **anden** deltager bliver tilbage.
Alt andet er uændret: en konkurrence, der er begyndt, beholder deltageren, også
hvis vedkommende aldrig nåede at tippe i den. Tips, rating, ratinghistorik,
kåringer og ligamedlemskab røres ikke.

**Begrundelsen er `A30`s skel, skåret på konkurrencen frem for på listen.** `B4`
valgte at bevare alt, fordi deltagelsen er *vennernes* fælles historik: fjernede
vi rækken, ville en afsluttet konkurrence pludselig have haft én deltager færre,
og en delt sejr kunne blive udelt. Den begrundelse holder for alt, der er
spillet — men i en konkurrence, hvor ingen kamp er låst endnu, findes der ingen
historik at beskytte. Dér er pseudonymet ikke et spor af noget, der er sket, men
en deltager, der **aldrig kommer til at spille**: deltagerantallet er forkert
fremadrettet, og navnet står på listen hele sæsonen for alle de andre. Det er
samme prøve, `A30` bestod for de globale lister — er der historik, bliver
rækken; er der ikke, er pseudonymet bare en fremmed, der fylder en plads.

**"Ikke begyndt" måles på konkurrencen og ikke på brugerens tips.** Den
nærliggende genvej var at genbruge `comp_participants_delete_own_unlocked`s
betingelse ("ingen tips på låste kampe"), men den er brugerens egen og for løs
her: en deltager uden tips i en igangværende konkurrence står stadig i en
stilling, de andre har set, og den må ikke kunne skrives om bagfra. Prøven er
derfor konkurrencens egen — er én af dens kampe låst eller spillet, er den
begyndt. En konkurrence uden kampe overhovedet er ikke begyndt.

**Den anden betingelse er lige så vigtig som den første.** Er den lukkede den
eneste deltager, frameldes de ikke: der er ingen, pseudonymet generer, og
frameldingen ville efterlade en konkurrence uden deltagere — en ny slags rod i
stedet for den gamle. Betingelsen falder sammen med selve motivet, som er, at
*de andre* ser et navn, der aldrig kommer til at spille.

**Tippene røres ikke, og det er ikke en udeladelse.** `predictions` er global pr.
kamp — ét tip gælder i alle de konkurrencer, kampen indgår i — så en sletning
kunne flytte tal i en konkurrence, personen stadig ER med i. Samme skelnen som
`liga_admin.sql`s to første policies er skåret efter.

**Beslutningen er truffet FØR sin egen udløser, og det er selve pointen.**
Rækken ventede på "den første rigtige kontolukning" (talt 5. august 2026: 0 af
24). Den udløser kan ikke bruges: lukningen er uigenkaldelig og sker én gang pr.
person, så i det øjeblik udløseren springer, ER prisen betalt — pseudonymet står
i konkurrencen, og det eneste, der kan rette det bagefter, er håndarbejde i
produktionsdatabasen på en brugers rækker. En udløser, der først kan aflæses,
når skaden er sket, er ikke en udløser, men en udskydelse. Prisen ved at afgøre
den nu er, at spørgsmålet er besvaret hypotetisk; prisen ved at vente var, at
den første bruger, der bad om at forsvinde, fik det forkerte svar.

**Den kendte følgevirkning er, at anonymiseringen bliver en tand dyrere at køre
første gang** — `G76` (funktionen har aldrig kørt i produktion) er dermed lidt
vigtigere end i går, ikke mindre. Reglen er til gengæld den eneste af
anonymiseringens handlinger, der har en *negativ* kontrol i test: `sql/tests/liga_admin.sql`
afsnit 12 har fire konkurrencer, hvoraf de tre skal blive stående.

## 5. august 2026 — `A11`: `?secret=`-fallbacken er fjernet

**Beslutning:** `isAuthorized()` i `api/_shared.js` accepterer kun `SYNC_SECRET`
i headeren `x-sync-secret`. Query-parameteren `?secret=` er slettet, og med den
`[A11]`-advarslen, der var dens kvittering. Et cron-job, der sender
hemmeligheden på nogen anden måde, får 401.

**Begrundelse:** fallbacken lagde hemmeligheden i request-logs, og alle var
enige om, at den skulle væk. Det, der manglede, var ikke en afvejning, men et
tal: rammer man forkert, svarer jobbene 401, og syncen står stille. Beslutningen
blev derfor gjort aflæselig i august 2026 ved at gemme `authVia` i
`job_runs.detail`, og opslaget er kørt 5. august 2026 over fjorten dage:

* `header` for **alle ni jobs** — `sync-live`, `send-notifications` og syv
  `sync-matches:<leagueId>`, altså præcis de syv turneringer i registret. Ingen
  manglede, hvilket var den eneste måde at læse tabellen forkert på.
* **Nul rækker med `query`.**
* `admin-token` tre gange: mennesker, der trykkede "Hent nu".
* `(ukendt)` kun med sidste kørsel 1. august kl. 20:23–21:17 — altså i selve
  udrulningsminuttet for feltet, og ikke én efter. Rækkerne kunne i princippet
  have skjult en `query`-kørsel, men de er alle fra før feltet fandtes.

**Vinduet er 14 dage og ikke `CRON.md`s oprindelige 7**, fordi det langsomste
skema er hver 12. time, og et job, der mangler i svaret, ikke må kunne forveksles
med et job, der kalder rigtigt.

**Det, beslutningen efterlader, er større end fallbacken.** Kolonnen
"Hemmelighed sendes som" i `CRON.md` havde stået med `?` i en måned med
begrundelsen, at svaret lå i cron-job.orgs brugerflade og ikke kunne nås fra
repoet. Det passede ikke: svaret lå i jobbenes egne kørsler, de gemte det bare
ikke. Mønstret — gem den værdi, koden allerede har i hånden, og et
hukommelsesspørgsmål bliver til et opslag — er dét, der er værd at genbruge.
`authVia` skrives fortsat, fordi det nu skiller en planlagt kørsel fra et
manuelt "Hent nu".

**Pris:** et cron-job, der aldrig blev flyttet, ville nu stå stille frem for at
køre med en advarsel. Accepteret, fordi opslaget viser, at der ikke findes et
sådant job — og fordi en tavs, usikker sti er dyrere end en højlydt afvist.

---

## August 2026 — Hvornår er en konkurrence slut, og hvem må rydde op bagefter

**Fire beslutninger, én leverance.** De hang sammen, fordi de alle fire handler om
det samme øjeblik: konkurrencen er ovre, og nogen skal gøre noget ved det.

### `A28` — "afsluttet" er databasens svar, ikke klientens

**Beslutning:** `computeCompetitionState` regner ikke længere selv. Den læser
`competition_status.concluded`, og viewet har fået en sæson-gate: nye kolonner
`seasons.ends_at`/`seasons.is_finished`, sat af sync, med en manuel markering i
Admin → Drift og en 30-dages ventil for sæsoner uden metadata.

**Begrundelsen er, at spørgsmålet havde to svar, og det svageste sad i UI'et.**
`competition_status` fandtes allerede — bygget til milepælene — og dens
kommentar sagde præcis det rigtige: for en konkurrence, der kan vokse, er "alle
mine kampe har resultat" ikke nok. Klienten kendte ikke viewet og havde sin egen
udgave af reglen uden den betingelse. Det er nøjagtig samme fejlklasse som `A7`
(to veje ind i en konkurrence, kun den ene huskede ligaen) og `K3` (to steder
svarede forskelligt på hvad et "møde" er): en sandhed, der bor to steder, driver
fra hinanden — og her var den allerede drevet, uden at nogen havde bemærket det,
fordi de to kun er uenige i en periode på nogle uger om året.

**Prisen for uenigheden var permanent.** Sportmonks modellerer Superligaen som ÉN
sæson med flere stages, og slutspillet skemalægges først til foråret. Mellem
sidste grundspilsrunde og udgivelsen af slutspillet var klientens regel trivielt
sand: pokal, vinder og — værst — de fire konkurrence-milepæle, som udtrykkeligt
*ikke kan trækkes tilbage*. Det er samme form som `COMP_COMEBACK`-fejlen dagen
før: en betingelse, der er trivielt opfyldt i den mindst mulige verden.

**Viewet havde selv resten af hullet.** `seasons_done` krævede, at alle sæsonens
kampe var scoret — men en kamp, der ikke er offentliggjort, findes slet ikke i
`matches`, så `bool_and` var sandt af den forkerte grund. Derfor kunne det ikke
løses ved at pege klienten på viewet alene; sæsonen skulle kunne sige noget om
sig selv, som ikke stod at læse i dens kampe.

**30-dages ventilen er en indrømmelse, og den står som sådan i migreringen.** Den
er den karensperiode, der blev fravalgt som primær mekanisme, netop fordi den
altid kommer for sent. Uden den ville hver eneste eksisterende sæson — alle har
`ends_at = null` på udrulningsdagen — aldrig blive færdig, og milepæle og
kåringer ville stoppe i tavshed. Det ville have været den modsatte version af den
samme fejl: en betingelse, der er trivielt **falsk**. Ventilen rammer kun det
tilfælde, hvor vi intet ved, og 30 dage er længere end enhver pause inde i en
sæson.

**Retningen på uvisheden er valgt bevidst:** en konkurrence, der ikke bliver
afsluttet, kan rettes. En milepæl, der er uddelt, kan ikke.

### `A29` — en administrator må fjerne det urørte, aldrig det brugte

**Beslutning:** liga-admin kan fjerne en deltager uden ét eneste tip, slette en
konkurrence ingen af deltagerne har tippet i, og slette en liga uden **aktive**
konkurrencer. Global admin kan lukke en anden konto. Alt håndhæves af RLS.

**Begrundelsen er, at liga-lagets v1 havde ret i sin udskydelse.** Spec §8 skrev
medlems-administration fra med ordene "lille brugerbase af venner" — og en
admin-knap, der kan slette andres historik, er den dyreste slags fejlklik. Det
argument holder stadig. Reglen ovenfor er den, der lukker behovet uden at
genåbne risikoen: ingen tips ⇒ ingen stilling at omskrive, intet point at tage
fra nogen, ingen kåring at omgøre. Den kan siges højt i en vennegruppe, og den
kan håndhæves af databasen frem for at bo i en knap.

**Den gamle liga-sletningsregel var i praksis "aldrig".** Den krævede nul
konkurrencer, og en vennegruppe, der har spillet en sæson færdig, har per
definition en konkurrence liggende — som kun dens egen opretter kunne fjerne.
Den nye regel tør være løsere, netop fordi den ikke er destruktiv:
`competitions.group_id` er `on delete set null`, så konkurrencerne bliver
liga-løse med stilling, tips og kåringer i behold. Der er intet at fortryde,
fordi der ikke forsvinder noget.

**Testen fandt en fejl, policyen ikke kunne læses til.** Første udgave spurgte
"findes der et tip på en af konkurrencens kampe". Men `predictions` er global pr.
kamp — ét tip gælder i alle de konkurrencer, kampen indgår i — så betingelsen var
sand for enhver konkurrence med en kamp fra en officiel turnering, og admin-vejen
ville aldrig kunne bruges. De to formuleringer ser ens ud; forskellen viser sig
kun, når en udenforstående tilfældigvis har tippet den samme kamp. Spørgsmålet
stilles nu om konkurrencens egne **deltagere**.

**`anonymize_my_account()` beholder sine nul parametre.** Den egenskab er
adgangsgarantien — "der findes ikke et bruger-id at forfalske" — og den er
uændret. Kroppen er delt ud i en ikke-grantet `_anonymize_account(uuid)`, som
begge indgange kalder, så den dag anonymiseringen skal rydde en tabel mere, kan
de to ikke komme til at gøre forskellige ting.

### `A30` — lukkede konti skjules globalt og bliver i det private

**Beslutning:** rating, måneds-, runde- og sæsonchampionship filtrerer
`anonymized_at` fra. `computeCompetitionState` og karriereprofilen røres ikke.
Filtreringen sker i klienten, ikke i viewene.

**Begrundelsen er, at de to steder ikke beskytter det samme.** I en privat
konkurrence er deltagelsen vennernes fælles historik: fjernede vi rækken, ville
en afsluttet konkurrence pludselig have haft én deltager færre, og en delt sejr
kunne blive udelt. Det er ordret den grund, `sql/account_anonymization.sql` valgte
anonymisering frem for sletning. På en global rangliste findes den historik
ikke — dér er pseudonymet bare en fremmed, der fylder en plads, og den, der bad
om at forsvinde, står stadig på en offentlig liste.

**Klienten og ikke viewene**, fordi `monthly_standings`, `round_standings` og
`season_standings` deles med rating-motoren og er dækket af den frosne reference
i `sql/tests/rating_equivalence.sql`. En lukket konto må ikke kunne flytte tal,
der allerede er beregnet. Vi ændrer hvad der **vises**, ikke hvad der er
**regnet** — og filtreringen sker før `assignRanks`, så placeringerne lukker sig
om hullet i stedet for at efterlade et spring.

### `A31` — arkivering gælder også konkurrencer i en liga

**Beslutning:** spærren i `MainApp` (`_hidden = c.group_id ? false : …`) er
fjernet, og liga-siden har fået Arkivér/Gendan, en Afsluttede-sektion og et
sammenklappet arkiv. Konkurrence-kortet er udskilt og deles af begge skærme.

**Spærrens begrundelse var reel, men midlertidig.** Den blev sat i juli 2026,
fordi et forældet `hidden`-flag kunne skjule en konkurrence på Hjem/Tip, mens
liga-siden viste den som "Med" — og brugeren havde ingen Gendan-knap at rette det
med, *fordi liga-siden ikke havde nogen*. Knappen findes nu, og dermed findes
tilstanden ikke. Det er værd at bemærke som mønster: begrundelsen pegede hele
tiden på det, der manglede, frem for på at arkivering var forkert dér.

**Arkivér og Frameld er bevidst begge til stede**, fordi de betyder to
forskellige ting: arkivering rydder MIN visning og lader stillingen stå,
framelding fjerner mig fra konkurrencen. Kun den første kan fortrydes.

**Kortet blev delt, fordi det var den forkerte vej rundt.** Liga-laget ER stedet,
konkurrencer bor, og alligevel var det kun overgangslaget ("Øvrige konkurrencer"),
der viste pokal, vinder og status. Liga-siden viste navn, mode og deltagerantal.

**Sidegevinsten var ydelse, ikke kun udseende.** Ligaer-fanen kaldte
`computeCompetitionState` — appens tungeste loader, seks kald — én gang pr.
konkurrence alene for at skrive "afsluttet" og "12/34 spillet" på et kort.
Belastningen voksede lineært med antallet af konkurrencer, altså netop for de
mest aktive brugere. Nu henter `loadCompetitionStatuses` status til alle kort med
fire opslag i alt, og den tunge loader køres kun for de afsluttede, hvor
vinderens navn faktisk skal bruges.

---

## August 2026 — Milepæle flyttes ud af matches-triggeren (v2.1)

**Beslutning:** `award_milestones()` kaldes kun af notifikations-jobbet, ikke længere fra matches-triggeren.

**Begrundelsen er en måling, ikke en fornemmelse.** Produktionsmålingen kort efter udrulningen gav 23 ms for dagsmotoren og så betryggende ud — men databasen indeholdt 18 spillede kampe. Tallet var uden informationsværdi, fordi den tunge del af beregningen er kumulativ og vokser hele sæsonen. Spørgsmålet kunne besvares uden at vente ni måneder: et skaleringsforsøg med en syntetisk fuld sæson (1800 kampe, 40 spillere, 116× produktionens datamængde) i `sql/tests/story_engine_scale.sql`.

**Forsøget flyttede mistanken.** Den regel, jeg havde udpeget som risikoen — `STREAK_STATUS` med sin fulde historik-scanning — kostede 2,5 ms. Dagsmotoren landede på ~320 ms mod ratingens ~145, altså rigeligt inden for det, triggeren allerede betaler ved hver resultatændring. Det dyre var `award_milestones()`: ~1.087 ms, hvoraf `COMP_COMEBACK` alene stod for 726, fordi rang-genopbygningen var korreleret pr. vinder-række. Rangene bygges nu én gang for alle afsluttede konkurrencer, og funktionen faldt til ~500 ms.

**Men 500 ms er stadig for meget dér.** Hele trigger-sætningen lå på ~1,07 s — inde i den sætning, `api/sync-live.js` bruger til at afslutte en kamp — for et kald, der næsten altid ikke uddeler noget (andet kald koster det samme som første). Uden milepælene er sætningen ~570 ms.

**Prisen for at flytte er lille og kendt:** en milepæl vises op til én cron-kørsel senere (15–30 min) frem for med det samme. Kortet ligger i karusellen resten af runden, så ingen går glip af det. Prisen for at blive var et halvt sekund oven på hver eneste rundeafslutning. Den oprindelige begrundelse — "brugeren kigger på sit kort i samme øjeblik" — var en nice-to-have, ikke et krav.

**Den generelle lære, som er værd at tage med videre:** en måling på for lidt data er ikke et svagt svar, det er et *misvisende* svar — den bekræftede en hypotese, der var forkert, og pegede væk fra det, der faktisk kostede. Når et system skal holde over en sæson, kan spørgsmålet stilles med syntetiske data på en time i stedet for at vente på virkeligheden.

---

## August 2026 — Milepæle skilles fra historier (Story Engine v2)

**Beslutning:** en milepæl er en **engangs-bedrift** i sin egen tabel, ikke et filtreret udsnit af `stories`. Og Story Engine taler nu også dagligt, ikke kun ved rundens slut.

**Begrundelsen for adskillelsen.** De to ting ligner hinanden på skærmen, men de er modsatte af natur: en historie er *hvad der skete i denne runde* — flygtig, gentagende — mens en milepæl er *noget du har opnået én gang og altid har opnået*. Så længe milepæle blot var `stories` med `priority < 90`, arvede arkivet historiernes gentagelse: motoren gemmer alle udløste kandidater hver runde, så "Kun 3 point op til føringen" landede i minde-listen hver uge. Problemet var ikke tærsklen — det var, at de to begreber delte tabel.

**Hvorfor ikke bare hæve prioritetsgrænsen.** Det var det oplagte, billige svar, og det ville have virket i en uge. Men enhver ny regel skulle så placeres i forhold til en grænse, der betød to ting på én gang (hvilket kort vises på Hjem, og hvad er værd at huske), og de to spørgsmål har forskellige svar: "du vandt runden" er ugens vigtigste kort, men det er ikke en livstidsbedrift. Grænsen ville være blevet et kompromis, ingen af siderne var tjent med.

**Hvorfor daglige kort ikke bryder "forsiden fortæller én ting".** Produktbogens kapitel 6 er stadig bindende, og karusellen er svaret: man ser ét kort ad gangen, det vigtigste ligger først, og loftet er to kort om dagen. Alternativet — en lodret stak — ville have gjort forsiden længere og udvandet det vigtigste kort. Samme princip som v1.1's: *tærsklen afgør, om historien findes; prioriteten afgør, om den vises.*

**Prioritetsbåndet 110–189 frem for en parallel stige.** Karriereprofilen filtrerede allerede på `priority < 90`, så båndet udelukker dagskort fra arkivet **uden en kodeændring**, og en forespørgsel, der glemmer periode-filteret, degraderer sikkert. En parallel 10–100-stige ville have oversvømmet minde-listen ved første udrulning — netop den fejl, leverancen retter.

**Ingen push (bekræfter A24).** Daglige kort er den slags indhold, der frister til en daglig notifikation. Prisen ville være push-tilladelsen, som er den ene, produktet ikke kan få tilbage — og deadline-påmindelsen, produktets eneste aktive fastholdelses-værktøj, ryger med.

**"5/10 venner via dit link" blev ikke bygget, og det er en beslutning og ikke en udeladelse.** Attributionen findes ikke: invitationskoden er pr. liga, ikke pr. bruger, og den eneste kilde, der kunne gætte på et svar, er `analytics_events` — som i sin egen header er erklæret lossy by design og forbudt til noget, en bruger kan bestride. En permanent bedrift er per definition noget, en bruger vil bestride. Valget stod mellem en milepæl, der kunne være forkert, og en anden, der er sand: `LEAGUE_GREW_5/10` tæller, hvor mange der kom med i en liga, man har oprettet. Den hedder derfor noget andet, frem for at låne det forkerte navn.

**Milepæle er uigenkaldelige.** `recompute_ratings()` er en fuld genopbygning, så en rettet kamp kan sænke en peak under en tærskel, der allerede er uddelt. Rækken bliver — samme frosne semantik som `competition_awards` (A22) og som en afsendt push. Prisen er, at tabellen før eller siden rummer en række, de nuværende data ikke længere begrunder; alternativet (en milepæl, der kan forsvinde igen) ville gøre hele begrebet værdiløst.


---

*De fem rækker fra 3. august 2026 om `B4` og backloggens Tier 2–5 er ført hertil
5. august 2026 (`G67`). De stod indtil da kun i ROADMAP'ens "Nyeste
beslutninger", altså ikke i det arkiv, `CLAUDE.md` sender én til for at vide,
hvorfor noget blev som det blev — og prisen ved det er ikke et opslag mere, men
at man tror, beslutningen aldrig blev truffet, og genåbner den. Datoen i
kolonnen er beslutningens, ikke nedskrivningens.*

*`G67` lukkede kun de fem, den selv navngav. **Resten er ført hertil 5. august
2026 (`G70`), og ROADMAP'ens beslutningslog er dermed tom** — den havde 46
rækker, og de er nu fordelt frem for kopieret, så hver beslutning står præcis ét
sted. Fordelingen var arbejdet, ikke flytningen, og den fulgte én regel: en
række hører hertil, hvis dens begrundelse svarer på et spørgsmål, der **kunne
have været besvaret anderledes** — der er et fravalg eller en accepteret pris i
den. Forklarer begrundelsen kun, hvordan en leverance blev udført, hører rækken
i [`CHANGELOG.md`](./CHANGELOG.md) og ingen andre steder.*

*Regnskabet, sagt højt, fordi en udvælgelse uden det ikke kan efterprøves: **22
rækker stod her i forvejen**, fire var A28–A31, som allerede har hvert sit
prosaafsnit ovenfor, **18 er ført hertil**, og **6 blev efterladt som rene
leverancer** — forhåndsvisningen af notifikations-outboxen (1. august),
`G20`/`G23`/`G24`s synlige fejl, `G9`–`G10` (som rækken selv kalder
"regressioner, ikke designvalg"), `scopeNote()` på Championship, `B2`s kode og
opdelingen af de tre største frontend-filer (30. juli). Alle seks er efterprøvet
til stede i `CHANGELOG.md`, før rækken blev slettet.*

| Dato | Beslutning | Begrundelse |
|---|---|---|
| 6. august 2026 | **`B18` er leveret: staging er et selvstændigt Supabase-projekt med SYNTETISKE data, kun bundet til Vercels Preview-miljø — og bevidst UDEN Supabases GitHub-integration.** Skemaet kommer fra `sql/schema.sql`, turneringerne fra de fire `tournament_*.sql`, brugerne fra almindelig oprettelse i appen. Runbog: [`STAGING.md`](./STAGING.md). | **Syntetiske data frem for en kopi:** `data-backup.yml` dumper også `auth.users`, så en kopi var teknisk gratis — men den ville flytte rigtige personers e-mail og tips til et projekt med andre adgangsregler, og det lover privatlivspolitikken ikke. Prisen er, at staging ikke kan svare på spørgsmål om produktionens datamængde; det er `sql/tests/story_engine_scale.sql`s opgave i forvejen. **Kun Preview:** produktionens variabler røres ikke, og leverandør-tokens er de eneste, der deles mellem miljøerne — de er læseadgang til en tredjeparts kampprogram, så isolationen ligger i databasen, ikke i tokenet. **Ingen GitHub-integration:** Supabases branching forudsætter CLI-migreringer i `supabase/migrations` — en lineær historik, hver fil kørt én gang — og `sql/` er det modsatte med vilje: idempotente filer med en kørerækkefølge og ni "må ikke gen-køres blindt". At koble den på ville være at skrive migreringsmodellen om, ikke at forbinde et repo. Dertil kræver branching et betalt plan. **Prisen ved status quo, som nu er væk:** en preview-test skrev i brugernes rigtige data, og det eneste værn var en advarsel i §11, som et menneske skulle huske. |
| 5. august 2026 | **Tier 2 og Tier 5: en visningsrate skal have en nævner, den kan holde — og et dokuments SQL skal tjekkes mod det RIGTIGE skema.** `G73` (`admin_analytics_stories` tæller `viewable` og bruger den som nævner under både visnings- og afvisningsraten), `G71` (`LOKALE_NØGLER` bundet til privatlivspolitikken med en oversættelsestabel), `G74` (hver ` ```sql `-blok i `docs/` bygges om til et `prepare` mod `sql/schema.sql` i CI) og `G70` (ROADMAP'ens beslutningslog fordelt frem for kopieret). `G1` skrumpede til `MainApp` alene og er flyttet til Tier 6 med `A23` som udløser. | **`G73` er valget om at lade to tal stå ved siden af hinanden frem for at rette det ene.** `generated` er sandt — kortet BLEV genereret — og skulle blive ved med at være det; det, der løj, var raten. Alternativet var at afgrænse `generated` selv, og det ville have skjult, hvor stor en del af motorens produktion der aldrig kunne nå en skærm. Forskellen mellem de to tal ER oplysningen, og derfor er "Vis-bar" en synlig kolonne. **Nævneren deles af visnings- OG afvisningsraten**, fordi `dismissed_at` kun kan sættes fra karusellen: havde de to hver sin nævner, kunne summen af rater overstige det mulige. Prisen er, at `viewable` afhænger af en definition (skrevet før midnat dansk tid på tirsdagen efter rundenøglen) frem for af en observation — men den definition er præcis karusellens egen regel, læst baglæns. **`G74` blev leveret på det MODSATTE svar af det, rækken lagde op til**, og det er dens vigtigste indhold: rækken spurgte, om blokkene kunne tjekkes uden produktionsskemaet, fordi et `prepare` mod et tomt skema fejler på ukendte tabeller. Men `B12`s `42803` opstår i **parse-analysen** — et syntakstjek ville have sagt god for netop den forespørgsel, rækken blev skrevet for. Skemaet er altså ikke en omkostning, der skal undgås, men forudsætningen; og det ligger i repoet. **Markøren er opt-out og ikke opt-in**: en ny forespørgsel skal være dækket, fordi nogen skrev den, ikke fordi nogen huskede en markør — prisen er, at et uddrag kræver en bevidst håndbevægelse, og det er den rigtige vej at betale. Accepteret bagside: tjekket arver `schema.sql`s forbehold om kun at være sandt efter en eksport, og en manglende eksport ligner en fejl i blokken. **`G70`s regel er filens egen fremover:** en række hører her, hvis dens begrundelse svarer på et spørgsmål, der kunne have været besvaret anderledes; forklarer den kun, hvordan noget blev udført, hører den i `CHANGELOG.md`. **`G1`s sidste fil blev ikke delt**, og det er også et valg: `MainApp` ER navigations-tilstandsmaskinen, en router omskriver den alligevel, og en opdeling nu skulle laves om. |
| 5. august 2026 | **`rnk` i `rating_history` rangerer nu på `score desc, exacts desc` — den frosne rating-reference er opdateret for anden gang nogensinde.** Dertil `G60` (deadline-dedupnøglen bruger dansk dato) og `G2`, som er **lukket som et nej**: de syv `set-state-in-effect`-advarsler bliver stående, loftet bliver på 7, og vilkåret står i `DOCUMENTATION.md` §12. `G1` skrumpede — `MainApp`s invitations-flows er udskilt til `src/lib/data/invites.js` med elleve tests. | **Beslutningen er ikke rettelsen, men at tallene må flytte sig.** `rnk` er en gemt værdi, og `sql/tests/_reference_recompute.sql` er skrevet, så det ikke kan ske ved et uheld — så længe referencen står urørt, kan ingen optimering ændre et resultat uden at testen fanger det. At opdatere den ER derfor beslutningen (`CLAUDE.md`), og den træffes her med åbne øjne: historiske `rnk`-værdier ændrer sig ved næste fulde genberegning. **Hvorfor det er værd at betale:** to tal fra samme beregning var uenige. Det parvise Elo-opgør skiller allerede to spillere med lige rundescore på antallet af præcise resultater — den ene fik et større ratingskridt — mens `rnk` gemte dem som delte, og karriereprofilen og Story Engine viser de to tal ved siden af hinanden. Prisen er lille, fordi tilfældet kræver præcis lige score, og fordi `rnk` ikke bærer nogen titel: titlerne kommer fra stillings-viewene med deres egen, fulde stige. **Dobbeltheden fra `A17` gentager sig og er skrevet ind i referencens hoved:** når begge sider har tiebreaket, kan ækvivalenstesten ikke længere bevise, at det virker, så beviset skal være en egen sektion med en konstrueret fixture. Den er efterprøvet i BEGGE retninger mod PostgreSQL 16.13 — med tiebreaket består den, uden fejler den med den besked, den er skrevet til. **`G2` er det andet nej på to dage, og begge gange faldt rækken på sin egen præmis.** Backloggen sagde ét mønster og en ventende arkitekturbeslutning; virkeligheden var tre data-hentninger og fire helt andre ting, så et data-bibliotek — det, beslutningen handlede om — ville have fjernet tre af syv. Når den store beslutning ikke kan løse problemet, er den ikke det næste skridt. De fire tilbageværende kan tages enkeltvis, men ingen af dem er en fejl, og skærmene har ingen interaktionstests; fælden i `CreateCompetitionScreen` (`setGroupId("")` er også signalet for "jeg opretter en ny liga") står nu i §12, så den næste ikke falder i den. **`G1`s snit er valgt med `A23` for øje:** `src/lib/data/invites.js` svarer HVAD en kode peger på (`already`/`confirm`/`notfound`), mens `MainApp` oversætter til `setTab`/`setScreen`. Navigationen — dét, en router ville ændre — bliver liggende, så udskillelsen kunne laves nu i stedet for at vente på `A23`; og de flows, `A23`s egen begrundelse kalder utestede, er nu dækket. |
| 5. august 2026 | **Tier 4: `anon`s oprydning får en AFLÆSNING frem for endnu en migrering — og karriereprofilens udløser får samme afgrænsning som sit indhold.** `G58`, `G59`, `G62`, `G63` og `G66`. Ny migrering #43 (`anon_grants_finish.sql`) lukker sekvenserne; `tournament_scope.sql`/`standings_tiebreakers.sql` granter ikke længere `anon`; job-heartbeat'en har tre nye kontroller; `round_standings`-opslaget i notifikationerne pagineres; `career_profile.sql`s tre globale komplethedsjoin er afgrænset til officielle turneringer; `username_constraints.sql` rummer nu hele §6-løftet; og `isAuthorized()`s auth-opslag har en tidsgrænse. To nye SQL-tests i CI. | **Det bærende valg er, at `G58` blev besvaret med en kontrol og ikke kun med en revoke.** Rækkens egen pointe var, at bredden er en **regel** og ikke en liste — men det gælder også for oprydningen: en migrering lukker tilstanden på kørselsdagen, mens en kontrol bliver ved med at spørge. Heartbeat'en ser nu tabeller, sekvenser og selve kilden hver halve time, så klassen er selv-opdagende frem for at kræve en skema-eksport og et menneske. **Kontrollen for kilden er afgrænset til objekttype `r` og `S`, og dét er ikke en detalje:** `anon` SKAL beholde sine funktions-defaults, ellers kan ingen oprette en konto — #34 siger det eksplicit — og en kontrol, der er rød for noget rigtigt, lærer man at ignorere hurtigere end man lærer at læse den. **Afgrænsningen blev fundet ved at KØRE migreringen mod PostgreSQL 16.13, ikke ved at læse den.** Første udgave af kontrollen var rød med det samme, af den forkerte grund. **`G58`(a) var mindre farlig end rækken lød, og det er værd at have skrevet ned:** `ALTER DEFAULT PRIVILEGES FOR ROLE x` gælder kun objekter, der oprettes **af** rolle x. Alt, vi selv opretter i SQL-editoren, ejes af `postgres` — hvis defaults #34 lukkede — så `supabase_admin`s efterladte regel rammer kun det, Supabase selv måtte oprette i `public`. Den kan formentlig ikke lukkes fra editoren, og forbeholdet står derfor i migreringens hoved frem for som en `notice`, ingen læser. Det, der reelt stod tilbage, var **sekvenserne**, og det var en ren dækningsfejl: ordet "tables" stod tre steder i #34s formulering. **`G62` er samme fejlklasse som `G9`/`G10`, og det er den eneste af de fem, en bruger kan mærke:** udløseren (er runden/måneden færdig?) og indholdet (pointene) havde forskellig afgrænsning, så én uspillet kamp i en uofficiel turnering kunne tilbageholde en global titel, brugeren havde vundet et helt andet sted. Titlen forsvandt ikke — den blev aldrig vist, og der var intet sted at aflæse symptomet. Mønstret fandtes hele tiden i `titles.by_tournament` (K2). **Verificeret med en negativ kontrol:** 0 rundesejre/0 månedstitler før, 1/1 efter, på samme data. Uden den kunne et grønt resultat ikke skelnes fra en test, der aldrig ramte fejlen — samme krav som `A21`s negative kontrol. **`G63`s hul var ikke en manglende garanti, men en garanti, der kun fandtes i en EKSPORT.** `schema.sql` er et genereret øjebliksbillede, ikke versionering, og `sql/`-scripterne er den dokumenterede vej til at bygge skemaet op igen. Testen er derfor skrevet som netop den vej: tom database, kør scriptet, spørg om §6-løftet gælder. **`G59` fik ingen ny mekanik**, fordi den ikke manglede en — `sbAll()` fandtes, opslaget brugte den bare ikke. Det er hele fejlens karakter: den nås af datamængde og ikke af en kodeændring, så der er ingen dag, hvor den begynder at være forkert. |
| 5. august 2026 | **Tier 2 kørt anden gang: `G69`, `G65`, `G61` og `G67`.** Privatlivspolitikken nævner nu `pc_pwa_onboarded`; Scotland-skabelonen sætter `provider`, `live_enabled` og `is_official` eksplicit; `KIND_LABEL` kender alle fem beskedtyper; og de fem beslutninger fra 3. august (Tier 2–5 + `B4`) er ført til [`DECISIONS.md`](./DECISIONS.md). Ingen SQL skal køres — `sql/tournament_scotland_premiership.sql` er en skabelon-rettelse, og produktionsrækken har allerede de værdier, den nu sætter. | **`LEGAL_OPDATERET` blev IKKE flyttet, og det er rækkens ene egentlige valg.** Dokumentet lover selv kun at opdatere datoen, når "vi ændrer noget væsentligt" — og `pc_pwa_onboarded` har ligget på enheden hele tiden; det, der ændrede sig, er, at politikken nu siger det. En dato, der rykker ved hver tekstrettelse, holder op med at kunne bruges til at se, hvornår behandlingen sidst blev en anden. Begrundelsen står ved konstanten, så spørgsmålet ikke skal stilles forfra. **`G65` viste sig at være en anden fejl end den, rækken beskrev:** `provider` og `live_enabled` manglede uden at gøre skade, fordi deres defaults tilfældigvis ER Sportmonks' rigtige værdier — men `is_official` defaulter til `true`, så skabelonen ville have gjort en ny turnering officiel i samme sekund, den blev indsat, og dermed ændret hvad en titel betyder. Det er samme retning som `A19`s argument, bare med en skabelon i stedet for en beslutning. Gen-kørslen sætter kun `provider`, fordi `is_visible`/`is_official`/`live_enabled` er manuelle valg (`A19`s forfremmelse er én update), og en uskyldig gen-kørsel ikke må rulle dem tilbage. **`G67`s "Tier 2–5" var et undertal:** `DECISIONS.md` mangler omkring tredive rækker fra denne log. De fem, rækken navngav, er ført over; resten er noteret i backloggens indbakke, fordi udvælgelsen er et spørgsmål — hvad er en beslutning, og hvad er en leverance? — og ikke en kopiering. **`G61`s fallback er bevaret som det, den er tænkt som:** en ukendt type vises stadig med sit præfiks, så en ny beskedtype kan ses, før nogen husker etiketten. Det, der var galt, var at overgangen var blevet tilstanden i to måneder; testen opremser nu alle fem, så den næste type ikke kan blive stående lige så længe. |
| 4. august 2026 | **Produktet hedder Leagly. A1 (juli 2026) er dermed ophævet.** Navneskiftet er gennemført i ét hug: app, PWA-manifest, ikoner, push-tekster, delings- og invitationstekster, vilkår og privatlivspolitik, hjemmesiden, SQL-filhoveder, backup-filnavnet og al dokumentation — historikken medregnet, så kun ét navn figurerer. **Samtidig fik Championship-fanens tre konkurrencer nye titler: Rundens, Månedens og Sæsonens Champion**, og strukturen bag dem hedder nu runde-, måneds- og sæsonchampionship. `C.gold` er rettet fra `#F0B429` til logoets `#F2C14E`, og krone-ikonet er afløst af pokalen fra logoet (`src/ui/Wordmark.jsx`). **Endnu ikke skiftet: GitHub-repoet, Vercel-projektet og dermed `prediction-champ.vercel.app`** — de 25 links på hjemmesiden peger stadig derhen, med vilje, så de bliver ved med at virke. | **Navnet var ikke længere ledigt:** en lignende app bruger det, og det er den slags, der kun bliver dyrere at udskyde — A1s eget argument, med omvendt fortegn. **"Ugens Champion" var det oprindelige ønske og blev fravalgt undervejs:** konkurrencen kører på spillerunde (`round_key`), ikke kalenderuge, og ordet *Ugens* var allerede optaget to gange — af den lokale kåring "Ugens bedste" og af oprettelsestypen "Ugens kupon". Tre forskellige "Ugens …" i samme app ville have gjort netop det, to-niveau-navnereglen findes for at undgå. Derfor **Rundens** Champion. **Ordet *liga* blev frigivet i samme ombæring:** "rundeliga" og "månedsliga" brugte det om noget helt andet end brugernes egne ligaer (liga-laget, `?liga=`-koderne), så de hedder nu runde- og månedschampionship — ensartet med sæsonchampionshippet, der allerede hed det. **To-niveau-reglen (`turnering-2.md` §3.6) er bevaret uændret:** kun den samlede stilling bærer titlen, per-turnering hedder stadig "… bedste i {turnering}", og sæsonen er stadig undtagelsen. Kun ordene er nye. **Guldet blev rettet i tokenet frem for i mærket:** to guldnuancer ved siden af hinanden i den samme header læses som en fejl, ikke som to farver. **Pokalen er tegnet som SVG frem for hentet som PNG** — den skal kunne stå skarpt fra 19 til 48 px, den følger `C.gold`, og "L"-et er skåret ud (`fill-rule="evenodd"`) i stedet for malet i baggrundsfarven, så mærket kan flyttes til en anden baggrund uden at gå i stykker. Formen er efterprøvet mod `public/leagly-icon-512.png`: 97,9 % pixel-overlap, resten er kantudjævning. |
| 3. august 2026 | **`G7` lukkes som "nej": der kommer ingen trigger, der håndhæver leverandør-præfikset på `teams.api_team_id`.** Præfikset `fd:` er fortsat det eneste, der holder de to leverandørers id-rum fra hinanden, og databasen håndhæver det ikke. Vilkåret er skrevet ind i `DOCUMENTATION.md` §12. | **Fejlen, en trigger skulle fange, retter sig selv.** Glemmer syncen præfikset på et hold, skriver den `57` inde i sin egen turnering, hvor ingen constraint kan se det — men næste kørsel finder rækken på navn og PATCHer id'et på plads. På kampe var hullet lukket i forvejen af `matches_api_fixture_id_unique`, og `sql/api_id_uniqueness.sql` (2. august) lukkede den fejlklasse, der IKKE retter sig selv: to samtidige kørsler, der indsætter det samme hold. **Prisen for en trigger er permanent, fejlen er midlertidig.** En check-constraint kan ikke læse en anden tabel, så håndhævelsen krævede enten en trigger på hver skrivning i `teams` eller en kopi af `leagues.provider` ned på rækken — altså en denormalisering, der selv kan komme ud af trit. At betale på hver eneste skrivning for en fejl, der forsvinder ved næste kørsel, er den forkerte vej rundt. **Det, der gør "nej" forsvarligt, er ikke fraværet af risiko, men at risikoen kan SES:** `ambiguousTeamNames()` melder i hver kørsel de holdpar, navnematchen ikke kan skelne, og et hold med et forkert id ville dukke op som en dublet dér — i Admin → Drift, hvor det bliver læst. Beslutningen revideres, hvis en tredje leverandør kommer til: så er der ikke længere ét præfiks at glemme, men to at forveksle. |
| 3. august 2026 | **Lokale flag, der beskriver en bruger, bærer bruger-id'et i *værdien* — ikke i nøglenavnet. Og gamle flag uden ejer ignoreres frem for at blive migreret.** Nøglerne og adgangen samles i `src/lib/localFlags.js`; alle seks bruger-flag er omfattet, mens `pc_session` forbliver enheds-global. | **Nøglenavnet har tre andre aftagere:** `LOKALE_NØGLER` rydder på eksakte navne, guard-testen i `data/account.test.js` opremser dem, og privatlivspolitikken (`src/lib/legal.js`) nævner dem. Et suffiks på nøglen ville bryde alle tre; et suffiks på værdien rører ingen af dem. **Migrering af gamle flag til "den, der logger ind først" er fravalgt,** fordi den ville gen-indføre netop den fejl, rettelsen findes for: en bruger, der opretter en ny konto lige efter et log ud, ville arve den forriges "færdig med introduktionen". Prisen — at eksisterende brugere ser PWA-modalen, liga-forslaget og push-kortet én gang mere — betales én gang og er mindre end at have en fejl, der genopstår. **Nulstilling ved log ud var det oplagte alternativ og er forkert:** et log ud efterlader typisk den samme person, som ikke skal se introduktionen igen — det er *den nye konto*, ikke den nye session, der er en ny bruger. |
| 3. august 2026 | **Tier 5: fejltelemetrien bliver en tabel i vores egen database, ikke en ekstern tjeneste — og `B16`s heartbeat efterprøver migreringernes VIRKNING frem for at føre liste over kørte filer.** `public.client_errors` (migrering #36) læses gennem en admin-gatet RPC uden et eneste select-grant; source maps udgives; `predictions.updated_at` flytter sig ved en rettelse (#35). Lint-loftet faldt 14 → 7, og `G2`/`G1` blev bevidst ikke presset længere ned. | **Fejltelemetrien er valgt til at ligne resten af huset frem for at ligne branchen**, og de tre grunde vejer i denne rækkefølge: `B4` gav appen en privatlivspolitik dagen før, og en ekstern fejltjeneste ville være en ny databehandler, der modtager stakspor fra en app, hvor brugernes data ER indholdet; Analytics v1 traf allerede samme valg ("kun Postgres"), og to måle-lag med hver sin leverandør ville betyde to steder at rydde op, når en konto lukkes; og appen har fire runtime-deps, hvor en fejl-SDK typisk er større end alt, appen selv sender. **Prisen er kendt og accepteret** — ingen gruppering, ingen søgning, ingen alarm — fordi ÉN fejlrække er en nyhed ved otte brugere, og fordi det er billigere at tilføje en tjeneste senere end at fjerne en igen. **De to grænser er ikke en optimering, de er selve funktionen:** en boundary, der remountes, eller en `unhandledrejection` i en timer, gentager sig i tusindvis, og den, der skal læse rækkerne, ville se ét problem frem for de fem forskellige, der findes — derfor dedup på (kind + besked + første stak-linje) og et loft pr. sideliv. **`B16` skiftede spørgsmål, og det er dens egentlige beslutning:** en tjekliste over kørte FILER er en påstand, ingen kan efterprøve, mens "står `security_invoker` på viewet, og nævner `round_key` `Europe/Copenhagen`?" er en aflæsning af virkeligheden. Kontrollerne blev valideret mod en kopi af produktionsskemaet FØR migreringerne (5 ok / 3 MANGLER) — en kontrol, der ikke kan sige nej, er ikke en kontrol. **`G13` var ikke en fejl men en beslutning:** vil vi vide, om nogen har *tippet*, eller om nogen har været *aktiv*? Fire læsere ville det sidste, og en gen-skrivning af den samme score tæller bevidst ikke med — det er en indlæsning, ikke en handling. **`G2` og `G1` blev bevidst efterladt halvt:** de billige lint-mønstre er brugt op, og det tilbageværende er ét mønster ("hent data i en effekt og sæt state"), som kræver en beslutning om et data-bibliotek, projektet har fravalgt — mens `MainApp` er entangleret med `A23`s navigationsspørgsmål. At skrive dét ned er mere værd end at dele en fil for at få tallet ned. |
| 3. august 2026 | **Tier 4: `anon`s bredde var en REGEL og ikke en liste, og datoen skal regnes i dansk tid på begge sider af ledningen.** `round_key()` aflæser datoen i `Europe/Copenhagen` (migrering #33), klienten regner i `APP_TZ`, holdnavne foldes ned mod grundbogstavet, `npm run dev` kaster uden Supabase-variabler, og `anon` mister sine tabel-privilegier **sammen med kilden til dem** (migrering #34). To nye SQL-tests i CI. | **`G50` viste sig at være et andet problem, end rækken beskrev — og det er den vigtigste halvdel at have i hånden senere.** Spørgsmålet var, om `grant all` til `anon` var bevidst; svaret står i skema-eksporten og er nej: grantsene kommer fra Supabases default privileges for `public` og gælder derfor **hver eneste tabel, nogen opretter**. En oprydning, der kun fjernede de 22 eksisterende, ville være rullet tilbage af den næste migrering, og derfor er halvdelen af arbejdet at lukke kilden. Migreringen lukker intet kendt hul — `anon` bruges kun til ét kald før login, og RLS stod alene — den giver dybde, hvor der før kun var ét lag. *(Den anden halvdel af kilden overlevede og blev `G58`: `supabase_admin`s defaults stod tilbage, og view-filerne re-granter ved en gen-kørsel.)* **`G11` og `G32` kunne ikke leveres hver for sig**, fordi de er to halvdele af den samme uenighed: `round_key()` var markeret `IMMUTABLE`, men brugte `ts::date`, som læser sessionens tidszone, og en genereret kolonne *kræver* immutabilitet — så Postgres tog markeringen for pålydende, og under UTC lå rundegrænsen mandag kl. 02 dansk. En rettelse af den ene flytter blot problemet. **Zonen blev dansk og ikke enhedens**, fordi runder, deadlines og stillinger alle er danske: en app, hvor kun visningen rejser med, ville vise en kamp på en anden dag, end den tælles i. Prisen er valgt: en bruger i Californien ser kampens danske tid. **`G52`s foldning følger af NFD frem for af en smag** — når "ä" allerede er blevet "a", skal "ae" folde samme sted hen; "ue" er bevidst IKKE med, fordi det er to almindelige bogstaver i de sprog, klubnavnene står på, og prisen (en udskrevet tysk umlaut forbliver to hold) står i en test frem for at være uskrevet. **`G4` handlede aldrig om adgang, men om tavshed:** nøglen er offentlig og RLS gælder, men et halvfærdigt tip lavet under udvikling er lige så virkeligt for de rigtige brugere. Fallbacken er bevaret i produktions-buildet, hvor den er rigtig. |
| 3. august 2026 | **Tier 3: en kåring skal have én pålidelig SKRIVER, før den kan få en historie og en besked — og reglerne LÆSER kåringen, de regner den ikke.** Story Engine v1.2 (`AWARD_WEEK` 65, `AWARD_MONTH` 15), to nye push-typer (lokal kåring + ny turnering), og deling fra karriereprofilens milepæle. Notifikations-jobbet kalder `award_competition_periods()` som `service_role` ved hver kørsel. | **Det, der bandt `B10` og `B11` sammen, var ikke temaet, men en manglende skriver.** Kåringen blev skrevet lazy af den klient, der tilfældigvis åbnede boardet, og en historie-regel oven på den ville have været et kort, der nogle gange kom og nogle gange ikke — afhængigt af, om et menneske havde kigget først. Jobbet kører hvert 15.–30. minut og er den pålidelige skriver, `A22`s guard allerede tillod. **Reglerne læser tabellen frem for at regne:** kåringen er frossen ved sit eget kriterie og kan slås op på boardet, så to flader, der hver for sig udregner "hvem vandt", er præcis den fejlklasse, tiebreaker-stigen findes for at undgå — én kilde pr. påstand. **Regel 70's guard er en produktbeslutning og ikke en optimering:** "du vandt runden i X" og "du er Ugens bedste i X" er det samme øjeblik med to navne, og brugeren får ét kort pr. runde — to formuleringer betyder, at den svageste kan vinde, og at milepæls-arkivet får dubletter. **Månedskortet kunne ikke genbruge regel 10's timing:** den globale månedstitel fyrer i den sidste runde med kampe i måneden, men en lokal månedskåring skrives først, når kalendermåneden er forbi (ellers kunne efterfyldningen lægge en udsat kamp ind i en kåret måned). **`B9`s to betingelser er bredde-betalingen:** det er den eneste beskedtype uden en modtager-regel, så `is_visible` + "har mindst én kamp" er alt, der står mellem beskeden og en push om et navn uden kampprogram — og en irrelevant push koster den ene tilladelse, produktet ikke kan få tilbage. **`I5`s række var forkert skrevet:** kortene KUNNE deles siden v1.1, arkivet kunne ikke — rettelsen landede derfor et sted, ingen havde peget på. |
| 3. august 2026 | **Tier 2: otte punkter, hvis fællesnævner ikke er størrelsen, men at hver af dem beskrev en verden, der ikke findes.** Point er konstanten `POINTS` og ikke et argument (`G3`); liganavnets regel findes ét sted (`G53`); "Ny konkurrence" er ikke længere gated på at have en liga (`G54`); efterfyldningens regel 3 læser låsen og ikke kickoffet (`G55`); syncens upsert-række er en testbar ren funktion (`G56`); fem håndrullede folde er én `Collapsible` (`G57`); `font-src 'self'` står i `vercel.json` (`B15`); og `G5` er afgjort af en frisk skema-eksport. | **Kode, der lyver, koster mere end kode, der mangler** — en betingelse fra en tidligere ordning koster den næste læser tid hver gang, og et argument, der aldrig kan have en anden værdi, får en gennemgang til at lede efter en konfigurerbarhed, der ikke er der. **To af dem var samme fejl, halvt rettet før:** `G54`s knap blev flyttet i juli netop med begrundelsen "usynlig for præcis den bruger, der havde brug for den", men betingelsen fulgte med over — og `G53`s inline-kopi var skrevet for at undgå en rå databasefejl, men kendte kun den ene af de to grænser, den skulle vogte. **`G3` rørte ved en beslutning og ikke kun ved kode:** klienten holder op med at SKRIVE `competitions.rules`, fordi kolonnens default er præcis den værdi, den sendte — så længe den sendte feltet, så det ud som et valg, den traf, og svaret på "hvad nu hvis det var en anden værdi?" var "ingenting". **Kolonnen er bevidst ikke droppet:** om point skal kunne variere pr. konkurrence er et produktspørgsmål og ikke en oprydning, og et `drop column` er uigenkaldeligt — det blev `A27`. **`G57` deler semantik, ikke layout:** knappen, `aria-expanded`, etiketten og panelet bor nu ét sted, mens chevronens PLACERING blev hos kalderen, fordi et to-linjers kort har sin pil ved tælleren og ikke i midten; tabelrækken i Liga-diagnosen fik semantikken lagt i en rigtig knap i første celle, fordi en `<tr>` ikke selv kan være en knap. **`G5` blev afgjort af en aflæsning og ikke af en holdning**, og svaret var hverken "advarslen er forældet" eller "advarslen er rigtig": alle 25 funktionskroppe i produktion har CRLF, så advarslen i `rating_core.sql` var sand om databasen og usand om filen, den stod i. Den slags kan kun findes ved at spørge det system, teksten handler om — kroppene er hentet ordret tilbage, og `.gitattributes` holder dem der. |
| 3. august 2026 | **`B4`: appen siger, hvad den gemmer — og en konto lukkes ved ANONYMISERING, ikke ved sletning.** Privatlivspolitik og brugervilkår ligger som DATA i `src/lib/legal.js` og vises af én komponent uden token og callbacks; skrifterne selv-hostes; samtykke og 13-årsgrænse står under opret-knappen; `anonymize_my_account()` har nul parametre. To pladsholdere (`[NAVN]`, `[KONTAKT-E-MAIL]`) står tilbage med vilje. | **Selv-hostningen er porten, ikke en optimering:** `@import`en mod Google sendte hver besøgendes IP dertil allerede på login-skærmen — altså FØR nogen kunne acceptere noget. En politik kan beskrive en videregivelse, men ikke gøre den rimelig, når der ikke findes et samtykke at give. **Teksten er data og ikke JSX**, fordi `src/lib/` er uden React (husets regel), fordi en datastruktur kan efterprøves uden at rendre noget, og fordi de to dokumenter skal kunne vises fra login-skærmen, hvor hverken session eller `MainApp` findes — dét er kontrakten, der bærer resten. **Anonymisering er ikke den billige løsning, den er den eneste rigtige:** en rigtig sletning ville have kaskaderet brugerens LIGAER væk sammen med alle de andre medlemmers medlemskab (`groups.created_by`) og været blokeret helt for enhver, der havde oprettet en konkurrence (`competitions.created_by` uden `on delete`-regel). Tips, rating og kåringer bevares under et pseudonym, fordi de er **vennernes** stillinger og ikke kun den lukkedes egne — en slettet spiller ville give huller i konkurrencer, andre har spillet færdig. **Nul parametre ER adgangsgarantien:** der findes ikke et bruger-id at forfalske. **Vedligeholdelsesreglen er den, der gør politikken til andet end papir:** en ny tabel med persondata, en ny tredjepart eller en ny `localStorage`-nøgle skal have en linje i SAMME ombæring, fordi en politik, der er forældet, er værre end ingen — den er en påstand, der ikke passer. *(Reglen blev brudt én gang og rettet med `G69` i august 2026: `pc_pwa_onboarded` manglede sin linje.)* |
| 3. august 2026 | **`I8` har fået et første udkast: fem statiske HTML-sider i `site/`, uden for build og deploy — intet publiceret.** Flersidet (I8's oprindelige sidekort, med kontakt foldet ind i om-siden), appens visuelle identitet, håndbyggede telefon-mockups, fontene kopieret til `site/fonts/`. Rækken i backloggen består med det, der udestår: godkendelse, kontakt-mail, domæne, publicering. Spec: [`features/hjemmeside-v1.md`](./features/hjemmeside-v1.md). | **Ét formål styrer alle fem sider: opret eller join en liga** — produktbogens første centrale erkendelse ("ligaen er produktets centrum") gjort til tragt, så hver sektion ender i det samme CTA mod appen. **Copy er minet fra produktbogen og appens egne tekster** (taglinen fra `Auth.jsx`, reglerne fra `HowItWorksScreen.jsx`, PWA-trinene fra `InstallGuide.jsx`), så sitet ikke kan love noget, appen ikke holder — og "Hvad vi ikke er" (ikke betting, ikke socialt medie, ikke statistikværktøj) står som sektion, fordi ærligheden ER differentiatoren ved nul opfundne brugertal. **Statisk og selvbærende frem for i Vite-buildet:** udkastet skal kunne ses lokalt og senere flyttes til eget domæne (`I10`) uden at røre appens build, deploy eller CSP — derfor også fontkopien frem for en relativ sti ud af mappen, som ville knække ved flytningen. **Mockups i HTML/CSS frem for screenshots**, fordi der ingen skærmbillede-assets findes, og fordi håndbyggede mockups forældes mindre grimt end billeder af en UI, der stadig ændrer sig. **Prisen er kendt:** header/footer er duplikeret i fem filer (intet build-step), og ingen JS betyder ingen hamburger-menu — begge accepteret for et udkast og noteret i spec'en. |
| 3. august 2026 | **Indbakken ryddet: femten linjer fra dokumentations-gennemgangen blev til fjorten rækker** — `A27`, `B17`–`B18`, `G58`–`G68`. `B17` (gen-kør anonymiseringsmigreringen) er sat øverst i Tier 1, og Tier 2 og 4 er ikke længere tomme. | **To linjer blev slået sammen, fordi de deler tilstand og rettelse.** `#34`s efterladte `supabase_admin`-default-privileges og de `grant select … to anon`, der står nederst i `tournament_scope.sql`/`standings_tiebreakers.sql`, fører begge til, at `anon` har adgang igen — den ene ad reglen for nye tabeller, den anden ad en helt almindelig gen-kørsel. `G50` lukkede kun den ene halvt, og det var netop `G50`s egen pointe, at bredden var en REGEL og ikke en liste. **Rangeringen fulgte én ny skelnen:** et punkt, hvor status quo bryder et løfte, slår et punkt, hvor status quo blot mangler en forbedring. Det gælder kun `B17` — privatlivspolitikken siger, at fejlrapporter mister forbindelsen til en lukket konto, mens produktionen lader `client_errors.user_id` stå — og det er derfor, en kørsel på ét minut står over fem aflæsninger, der har ventet i uger. **At Tier 2 og 4 blev tømt om formiddagen og fyldt igen om aftenen er ikke et tilbageskridt.** De fjorten fandtes hele tiden; de stod bare ingen steder. Fællesnævneren er en KILDE og ikke en fejltype: ingen af dem kom fra en bruger eller en fejlet kørsel, men af at læse dokumentationen op mod koden. Det er en billigere måde at finde `G59` — `G51`s fejl et nyt sted — end at vente på, at en runde igen melder et forkert deltagerantal. **Tomme tiers bliver stående som overskrift**, af samme grund som sidst: det er billigere at se, at kategorien findes og er tom, end at genopdage, at den skulle have været der. |
| 3. august 2026 | **En konkurrence kan ikke længere oprettes uden en liga — og ligaen oprettes inde i opret-flowet.** "Ingen liga" er fjernet fra opret-skærmens dropdown; har man ingen liga, står et navnefelt + "Opret liga" dér, hvor dropdownen ellers ville stå, og har man en, ligger "+ Opret ny liga…" som sidste punkt. Guarden står i `createCompetition`, ikke kun i skærmen. **Samtidig:** invitationskoden vises i klartekst under begge Invitér-knapper, og indtastede koder sænkes til små bogstaver. | **Reglen fandtes allerede — den gjaldt bare kun for guiden.** Onboarding-spec §6 kalder den liga-løse konkurrence "ufravigelig regel: aldrig", men den frie opret-skærm havde valget stående i en dropdown, så kontrollen (`count(*) where group_id is null`) målte brugernes valg og ikke appens regel. **Guarden ligger i skriveren og ikke i skærmen**, fordi det er den ene skrivning, guiden og skærmen deler; A7 kostede præcis dét, da to veje ind havde hver sin kopi. **Den kan ikke være et `not null`:** `on delete set null` gør en konkurrence liga-løs, når ligaen slettes, og de gamle rækker fra før liga-laget skal blive ved med at virke — reglen gælder oprettelsen, ikke rækkens levetid. **Ligaen oprettes i flowet frem for på Ligaer-fanen**, fordi man gerne må begynde med konkurrencen: en omvej ville kaste alt det halvvalgte (kampe, hold, navn) væk og dermed koste netop den nye bruger, reglen skal hjælpe. **Koden var den anden halvdel af en invitation, der kun havde én:** "Deltag med kode"-feltet har hele tiden taget imod den rå kode, men koden stod ingen steder i appen — man kunne joine med noget, man ikke kunne få fat i uden selv at klippe det ud af et link. Koden vises præcis som gemt (opslaget er `eq.`, og et pænere versal-format ville producere en ubrugelig kode), og af samme grund sænkes indtastningen: otte hex-tegn kan ikke indeholde et stort bogstav, så iOS-tastaturets automatik lavede en gyldig kode om til "Ingen liga eller konkurrence fundet". |
| 3. august 2026 | **"Sådan virker det" er inddelt i fem emner, der folder ud, og alt er foldet ved åbning.** De ni sektioner er samlet i **Begreberne**, **Point og stilling**, **Under kampene**, **Din udvikling** og **Installér som app**; de gamle sektionstitler lever videre som underoverskrifter inde i emnet. Ingen tekst omskrevet. Flere emner må være åbne samtidig, og "Sig til" + versionsstemplet står uden for foldningen. Kun frontend: `HowItWorksScreen.jsx` + ny test. | **Det er bevidst den modsatte afvejning af Tip-skærmen (juli 2026), hvor "intet er gemt bag et tap" var hele pointen — og forskellen er skærmens art.** Tip er en **handlings**-skærm, man bruger hver uge og skal overskue i ét blik; et tap dér er en omkostning på hver eneste runde. Sådan virker det er en **opslags**-skærm, man åbner med ét konkret spørgsmål ("hvornår låser mine tips?") og lukker igen — og dér er ét tryk til det rigtige svar billigere end fem skærmhøjders scroll forbi otte forkerte. Foldet fylder skærmen nu ét viewport mod fem-seks før. **Flere åbne ad gangen frem for klassisk harmonika:** et tryk må ikke lukke noget, man var i gang med at læse, og point + tiebreak skal kunne holdes op mod hinanden. **Ingen teaser-linje under de lukkede emner** — emnetitlen skal bære vejvisningen alene, ellers er inddelingen forkert, og en undertekst ville skjule det. **Feedback-kortet og versionsstemplet blev holdt uden for foldningen**, fordi begge findes til den bruger, der er gået i stå: en vej til udvikleren, man først skal gætte sig til placeringen af, er den samme mangel som `B14` lukkede. **Fravalgt:** to niveauer (emne → sektion) kostede to tryk til hvert svar og er svær at ramme på en telefon, og emne-chips uden fold kunne aldrig vise to emner samtidig. |
| 2. august 2026 | **`A15` lukket: Sportmonks' gratis-plan er 3.000 kald i timen *pr. entitet*. Kontosiden havde ret om tallet, dokumentationen om enheden.** Aflæst i Admin → Drift på en `sync-matches`-kørsel for Scotland Premiership: `rateLimit: { entity: "Fixture", remaining: 2996, resetsInSeconds: 3600 }`. Kørslen hentede 198 kampe à 50 pr. side = fire kald, og 2996 + 4 = 3000. **Enheden er dermed afgjort af `requested_entity`s blotte tilstedeværelse** — grænsen har et entitetsnavn, altså er den pr. entitet, som `DOCUMENTATION.md` §8 og `live-resultater-v1.md` sagde. **Tallet 180 var forkert** og er rettet begge steder. `sync-live` bruger samme endpoint-familie (`fixtures/multi/…`) og tegner derfor efter alt at dømme på samme `Fixture`-pulje; skulle den vise sig at have sin egen, er der kun *mere* luft. | **Spørgsmålet ventede på en aflæsning, ikke på en afvejning** — og aflæsningen kom fra leverandørens eget regnskab i stedet for fra dens support, netop som `A15`s sidste opdatering forudsagde. **Gaten var "en `sync-live`-kørsel på en kampdag", og den er bevidst ikke afventet:** `rate_limit` beskriver kontoens forbrug og ikke jobbets, så et hvilket som helst svar besvarer spørgsmålet om tal og enhed. Kampdags-gaten handlede om *hvor tæt på grænsen vi er*, og det spørgsmål er nu regnestykke frem for aflæsning: 60 kald/time i værste live-time plus fire kald pr. `sync-matches`-kørsel for hver af de to Sportmonks-turneringer er 68 af 3.000, altså **under 3 %** i den dyreste time et døgn overhovedet kan have. **Loftet er udledt og ikke aflæst** — Sportmonks sender kun `remaining` — men de to uafhængige kilder peger på samme tal, og 180 kan udelukkes direkte: så mange kald er der aldrig gjort i vinduet, og `remaining` ville i så fald være negativ. **Det ændrer intet i driften**, og det er selve pointen: begge de bestridte tal lå så langt over forbruget, at uenigheden aldrig kunne aflæses på appens opførsel — kun i dokumentationen, hvor den til gengæld gjorde ethvert fremtidigt kaldbudget uberegneligt. |
| 2. august 2026 | **`G49`: sikkerhedskopien er vores egen, krypteret, daglig — og den prøves ved hver kørsel.** Supabase-planen er **Free**, som hverken giver automatiske backups eller PITR; det var spørgsmålet, backloggen bad om at få stillet først, og svaret er derfor "ingenting". `.github/workflows/data-backup.yml` tager dagligt et fuldt dump (skema + data, `public` + `auth`, custom-format), krypterer det med gpg/AES256 og lægger det som et 90-dages Actions-artefakt. Kadencen ER tabsgrænsen: op til 24 timer kan gå tabt, og det er skrevet som vilkår i `DOCUMENTATION.md` §12. Runbog: [`RESTORE.md`](./RESTORE.md). | **Tre valg kunne have været det modsatte.** *Hvorfor `auth` er med:* fem fremmednøgler i `public` peger på `auth.users`, så et dump uden brugerrækkerne ikke bare mangler login — det kan ikke indlæses. Prisen er, at kopien indeholder e-mails og password-hashes, hvilket er selve grunden til krypteringen. *Hvorfor krypteret og ikke bare privat:* repoet er offentligt, og artefakter derfra kan hentes af enhver. At gøre repoet privat ville **ikke** fjerne krypteringen (artefakter kan læses af alle med adgang), men ville gøre Actions-minutter og lagring betalte — `job-heartbeat.yml` alene bruger ~1.460 af de 2.000 gratis minutter/md, fordi hvert job rundes op til et helt minut × 48 kørsler i døgnet. Krypteringen er tre linjer; den anden vej er en månedlig regning og en svækket overvågning. *Hvorfor gendannelsestesten er en del af hver kørsel og ikke en årlig øvelse:* en sikkerhedskopi, der aldrig er prøvet gendannet, er en formodning — og en formodning opdages netop den dag, den ikke må briste. Prøven koster ~1 minut i en service-container og afgøres på nul `pg_restore`-fejllinjer OG rækketal, der holder — begge dele, fordi `pg_restore` fortsætter efter en fejl, og en fejlfri gendannelse stadig kan have indlæst for lidt. Kriteriet er bevidst et **vindue** og ikke ét tal: produktionen tælles før og efter dumpet, og det gendannede tal skal ligge imellem. `sync-live` skriver hvert minut, så streng lighed ville gøre jobbet rødt af noget helt rigtigt — og et job, der ofte er rødt uden grund, lærer én at holde op med at kigge. **Ikke valgt: Pro-planen med PITR (25 $/md + tilkøb).** Den ville lukke 24-timers-hullet, men ikke det tilfælde, kopien først og fremmest findes til — at man mister adgangen til leverandøren. En kopi hos den leverandør, hvis konto man kan miste, dækker ikke tabet af kontoen. |
| 2. august 2026 | **`B2` lukket: turnering #2 er verificeret i drift, og verifikationen efterlader to permanente kontroller frem for en huskeliste.** 198 af 198 kampe uden stille trunkering, `ambiguousTeams` melder ét par (`Dundee` / `Dundee United`, en ægte navnelighed), fasenavnene er fastholdt i en test, og ejeren har kørt testcases 2–6. Drejebogen [`features/turnering-2.md`](./features/turnering-2.md) er dermed færdig, og rækken er slettet af backloggen. | **To af de fire verifikationspunkter blev aldrig krydset af — de blev lavet om til kode**, og det er det, der gør turnering #3 billigere end #2: et engangs-tjek, som et menneske skal huske på det rigtige tidspunkt, er ikke en kontrol, mens `ambiguousTeams` i hver kørsel og `STAGE_LABELS`-testen i CI begge er. **Kampantallet kunne efterprøves uden leverandøren:** 12 hold × 33 runder ÷ 2 = 198, og de manglende 30 kampe er `2nd Phase`, som først skemalægges sent — netop det, §3.5 forudsagde. **Det ene par, kontrollen melder, er ikke en fejl**, og det kan aflæses af meldingen selv: står begge navne i listen, findes begge klubber som hver sin række. Prisen er, at feltet nu altid er der for Scotland — noteret i indbakken, fordi et felt, der altid er der, holder man op med at læse. |
| 2. august 2026 | **"Tid ikke fastlagt" er blevet en egenskab ved kampen: ny kolonne `matches.kickoff_tbd`, sat af providerlaget ud fra hver leverandørs EGEN markør.** football-data.org's `SCHEDULED` vs `TIMED` genvindes ved siden af statussen; Sportmonks bruger state `TBA` plus midnat-pladsholderen i `starting_at`. Er flaget sat, viser appen ingen tid, og kampen låser ved **midnat på spilledagen** i stedet for 1 time før et kickoff, der ikke findes. Låseudtrykket, som stod 1:1 i fem policies, er samlet i `public.match_lock_at()`. Migrering: [`sql/matches_kickoff_tbd.sql`](../sql/matches_kickoff_tbd.sql) (#28). | **Symptomet var seks Superliga-kampe kl. 02.00 om natten med lås kl. 01.00** — midnat UTC, som leverandøren sender, når kun datoen er kendt, vist i dansk sommertid. Det afgørende valg var **ikke** at gætte på tidsstemplet: en midnat-heuristik ville have virket for Superligaen og tavst svigtet de fem football-data-turneringer, hvor markøren er `status` og **ikke kan rekonstrueres fra `utcDate`**. Derfor en kolonne frem for en regel i frontenden — informationen findes kun ét sted i kæden, og går den tabt i oversættelsen, er den væk for altid. **Låsen er strammet med vilje:** kender vi kun datoen, kan kampen ligge hvor som helst på dagen, og enhver lås senere end midnat ville kunne ligge efter et fløjt; det er også stabilt hen over sommer-/vintertid, hvor de gamle 01.00 blot var et tilfælde af UTC+2. **Migreringen ændrer intet ved kørsel** (kolonnen får `default false`, så udtrykket er bogstaveligt det gamle, indtil syncen har sat flaget) og behøver derfor ikke køres mellem to runder, sådan som #25 gjorde. **Én ting kunne ikke aflæses herfra:** egress-politikken blokerer begge leverandørers API og docs, så Sportmonks-markøren er sluttet af de gemte data — værdien vises som 02.00, og koden skriver `starting_at` ordret — og dækket af *begge* markører frem for én antaget. |
| 2. august 2026 | **`B14` leveret: brugerne har en vej til udvikleren.** Kortet "Sig til" nederst i Sådan virker det, tabellen `public.feedback` med insert-only RLS, og Admin → Feedback bag `admin_feedback()`/`admin_feedback_set_handled()`. Meldingen bærer version, skærm og browser af sig selv, og de tre står synligt i formularen, før der sendes. Migrering: `sql/feedback.sql`, som skal køres FØR frontend-mergen. | **Placeringen er valgt efter, hvor man ER, ikke hvor det hører logisk hjemme.** Profil er det oplagte sted for "mine ting", men det er også det sted, ingen er, når noget går galt; Sådan virker det er ét tryk fra ⓘ i toppen af enhver skærm og er i forvejen dér, man går hen, når man ikke forstår noget. At kortet står nabo til versionsstemplet er ikke tilfældigt: stemplet svarer på *hvilken version så du?*, kortet er stedet, spørgsmålet kan stilles. **En tabel frem for en `mailto:`** — genvejen koster nul kode, men åbner brugerens egen mailklient (på iOS ofte ingen) og efterlader ingen liste at arbejde ud fra. **De to afvigelser fra `analytics_events`' mønster er begge bevidste:** skrivningen er ikke fire-and-forget, fordi en hændelse er noget *vi* vil vide, mens en melding er noget *brugeren* vil have sagt — et fejlet skriv skal siges højt, ellers skrives beskeden ikke igen; og `user_id` er `on delete set null` frem for cascade, fordi en fejlmelding er sand efter kontoen er slettet, og den fejl, den beskriver, findes stadig. **Kontekst-felterne er en videregivelse og behandles som en:** de står i formularen, før der trykkes, ikke i en politik. **To fejl blev fanget af SQL-testen og ikke af gennemlæsningen** — `not null` + `on delete set null` udelukker hinanden (kontosletning ville have fejlet), og `admin_feedback()`s OUT-parameter `id` kolliderer med `profiles.id` i admin-vagten, hvilket først viser sig ved kald. Det sidste er værd at huske: `admin_job_health()`-mønstret kan kopieres direkte ind i en fejl. |
| 2. august 2026 | **`G7` halveret: unique-constraints på leverandør-id'erne — men med et andet omfang end rækken bad om, og med den anden halvdel omskrevet til et valg.** `leagues (provider, api_league_id)`, `seasons (league_id, api_season_id)`, `teams (league_id, api_team_id)` (`sql/api_id_uniqueness.sql`). Ingen kodeændring. | **Rækken var formuleret globalt pr. kolonne, og to af de tre ville have fejlet på produktionsdata.** Arsenal findes som to rækker med samme `fd:57` (Premier League og Champions League), fordi `teams` er scopet til `league_id`; og alle fem football-data-turneringer deler `api_season_id = '2026'`, fordi sæson-id'et dér er et **årstal**. En global unique ville have gjort Champions League usynkroniserbar — det er derfor, testen er skrevet for de LOVLIGE gentagelser frem for for dubletterne. **Det, constraints faktisk lukker, er en anden fejlklasse end den, `G7` beskrev:** to samtidige kørsler (cron'en og "Hent nu") læser begge holdlisten, ser begge det samme hold mangle og indsætter det begge to. Efter migreringen fejler den ene kørsel — og **det er den ønskede udgang**: en fejlet kørsel står rødt i Admin → Drift og forsvinder ved næste interval, mens en dublet bliver stående, til nogen opdager den. `api/sync-matches.js` er bevidst **ikke** lavet om til et upsert med `on_conflict`: det ville have krævet, at migreringen var kørt FØR deployet, ellers ville PostgREST afvise hver eneste sync. Den rækkefølgeafhængighed er dyrere end den fejl, den fjerner — og migreringerne køres i hånden med ubestemt forsinkelse. **Præfiks-halvdelen er ikke lukket, men omskrevet:** glemmer syncen `fd:` på et hold, sker det inde i én turnering, hvor ingen constraint kan se det — men fejlen retter sig selv ved næste kørsel (navne-opslaget finder rækken og PATCHer id'et), og på kampe var hullet lukket i forvejen af `matches_api_fixture_id_unique`. Det, der ville lukke resten, er en trigger, der holder id'ets form op mod ligaens `provider`, fordi en check-constraint ikke kan læse en anden tabel. Spørgsmålet er nu: er en permanent trigger prisen værd for en fejl, der er midlertidig? |
| august 2026 | **A24: Push sendes kun mellem 08 og 22 dansk tid — som en tavshed, ikke som en kø.** Rammer notifikations-jobbet natten, stopper det FØR beskederne udregnes og reserverer intet i `notification_log`; kl. 08 udregnes de forfra og lander som én besked med samme nøgle. Vinduet er **globalt** (ét tal i koden, `Europe/Copenhagen`), ikke en indstilling pr. bruger. `&force=true` findes til fejlfinding. Teknisk sandhed: `DOCUMENTATION.md` §16. | **Hvorfor et vindue overhovedet:** en push kl. 03 vækker folk, og prisen er ikke en irriteret bruger, men den ene tilladelse produktet ikke kan få tilbage — slår man notifikationer fra, ryger deadline-påmindelsen med, og den er ifølge push-effekt-målingen (Analytics) produktets eneste aktive fastholdelses-værktøj. **Hvorfor tavshed frem for en kø:** en kø skulle bygges, persisteres og selv holdes fri for dubletter — og den findes allerede. Outboxen udregnes forfra hver kørsel, så "udskyd til kl. 08" og "lad være med at sende nu" giver det samme resultat for `result:` og `newcomp:`, hvis nøgler er stabile. Det billigste korrekte er derfor ingenting. **Afgørende detalje:** stoppet SKAL ligge før claim-trinnet. En besked, der claimes og derefter ikke sendes, er permanent tabt — det er den samme egenskab, der gør dedup'en kapløbssikker. **Hvorfor deadline-påmindelsen bortfalder frem for at blive udskudt:** dens indhold er en nedtælling. Udskudt ville den sige "låser om 2 timer" om en kamp, der låste i nat. En besked, der er blevet usand undervejs, må ikke leveres — den koster mere tillid end den, der aldrig kom. Prisen er kendt: kampe, der låser mellem 22 og 11, får ingen påmindelse. **Hvorfor globalt frem for pr. bruger:** en indstilling kræver kolonne, UI og et sted at forklare den, og brugerne er én vennegruppe i én tidszone — samme forudsætning som `da-DK` overalt og intet sprogvalg. Vinduet kan gøres personligt senere uden at ændre mekanikken; det omvendte (fjerne en indstilling, folk har rørt) kan ikke. **Hvorfor fast dansk tidszone:** Vercel kører UTC, så en hårdkodet UTC-grænse ville se rigtig ud i vintertid og være en time forkert hele sommeren. |
| august 2026 | **`G14`–`G16` lukket: de tre 🔴-sikkerhedshuller fra august-gennemgangen er tættet i én migrering (`sql/security_hardening.sql`).** `matches` må kun skrives af en admin eller `service_role`; `recompute_ratings()` er `service_role`-only med den nye wrapper `admin_recompute_ratings()`; `monthly_standings` har fået `security_invoker = on`. Ingen tal og intet, brugerne ser, ændrer sig — kun hvem der må skrive og læse. | Alle tre var udnyttelige med den `publishable`-nøgle, der ligger i den udsendte bundle: enhver med en konto kunne sætte resultatet på en vilkårlig kamp, og enhver **uden** konto kunne både udløse en fuld rating-genberegning og læse per-bruger månedspoint. **Vejvalgene:** `is_admin` frem for `service_role`-only på `matches`, fordi Admin-skærmen skriver med brugerens eget token — policyen håndhæver nu i databasen, hvad brugerfladen allerede antog. Og en wrapper frem for en guard inde i `recompute_ratings()`, fordi motorens krop er frosset af ækvivalenstesten; et adgangsproblem skal ikke koste en ændring i en funktion, hvis tal er under test. `sql/tests/security_hardening.sql` kører nu i CI og efterprøver begge retninger. |
| 1. august 2026 | **A22: Opret-flowet er galleri-først, og lokale kåringer er en persisteret tabel med en lazy SECURITY DEFINER-writer** (lukker `I4`, `I13`, `I14`; forbereder `I15`). Opret-skærmen viser konkurrence-typerne som seks kort (Ugens kupon, Quick Pick, Quick League, Favorithold, Sæson, Custom) og derefter kun den valgte types felter. Ingen ny mode i databasen: Quick League er `random` + `mode_params.rounds`, Favorithold-multi er `team` + `mode_params.team_ids`/`tournaments`, Periode er `time_range` under Custom-kortet. Kåringerne ("Ugens/Månedens bedste" — bevidst IKKE de globale titler) er en opt-in (`mode_params.awards`), skrives i `competition_awards` af RPC'en `award_competition_periods()` trigget ved board-åbning, og er frosne (`on conflict do nothing`). Fuld spec: [`features/opret-flow-v2.md`](./features/opret-flow-v2.md). | **Galleri frem for wizard/én skærm:** de simple typer (Ugens kupon) skal kunne oprettes med to tryk, og typenavnet bærer selv forklaringen — en wizard giver alle typer de samme klik, én skærm forbliver tæt pakket med 12+ turneringer. Rækkefølgen kort → langt ER I14's "varighed før turnering". **Persisteret kåring frem for virtuel visning:** brugerens eget valg — persistering åbner for Story-kort, push og karriere-meritter (B10/B11) uden migrering, fordi `stats`-jsonb'en og `service_role`-adgangen er med fra dag ét. **Lazy RPC frem for cron eller hook i `send-notifications`:** klienten kan kun TRIGGE (SECURITY DEFINER beregner fra grunddata, ingen skrive-policies), boardet er v1's eneste visningsflade (latensen er usynlig), ingen cron-job.org-opsætning/CRON.md-række/`job_runs`-udvidelse — og `send-notifications`' rundedetektion er global og bærer `G9`/`G10`, så en hook dér ville bygge på et kodested, backloggen vil skrive om. **Opt-in i `mode_params`, ikke `rules`:** `rules` er døende (`G3` — `pc_points()` hardkoder 3/1), et nyt levende flag dér ville kollidere med oprydningen. **Accepteret pris:** kåringer er frosne (et senere rettet resultat omgør dem ikke — samme egenskab som en sendt push-besked), og en kamp uden resultat blokerer sin rundes kåring i dén konkurrence. |
| 1. august 2026 | **`B1` lukket ved at FJERNE det rullende gætte-vindue (`rules.openDaysBefore`) — ikke ved at vælge en scoping.** Spørgsmålet var, om vinduet skulle åbne pr. turnering eller pr. kalenderuge. Svaret blev, at det ikke skal åbne overhovedet. | Vinduets formål var *"så tipper alle med nogenlunde samme viden"* — men den garanti bæres siden `A21` af per-kamp-låsen, som gælder alle konkurrencer, også dem ingen har valgt (Rundechampionship, Månedschampionship, Championship). Vinduet var kun en visningsregel i frontenden; `openDaysBefore` har aldrig haft RLS-håndhævelse, så det beskyttede intet, som låsen ikke allerede beskytter. **Til gengæld kostede det:** scopet `(season_id, round_key)` gav med syv turneringer op til syv åbningstidspunkter i ét rundekort — Champions Leagues midtugekampe åbnede systematisk 3–4 dage før weekendligaernes i samme kalenderuge, og én `full_season` på to turneringer åbnede i to bidder uden at UI'et kunne forklare hvorfor. Kalenderuge-scoping ville have fjernet forskydningen, men mod at ankeret blev sat af den turnering, der tilfældigvis spillede først: én CL-kamp tirsdag ville give Superligaen 10 dages vindue i stedet for 7. Begge veje var værre end ingen. **Accepteret pris:** en `full_season`-konkurrence er nu tipbar for hele sæsonen fra dag ét. **Ingen SQL** — vinduet var frontend-only. `roundStartKey`/`buildRoundStartMap` er slettet af `scoring.js`; `api/backfill.js` regel 3 og `analytics_round_locks` beholder deres `(season_id, round_key)`-scoping, som er en anden regel med sin egen begrundelse. |
| 1. august 2026 | **`B1` / trin 5 er leveret: den globale tirsdag–mandag-runde findes, og har gjort det hele tiden. Det var dokumentationen, der var forældet, ikke koden.** Rækken påstod, at *"appen regner i dag pr. turneringsrunde"*, og planlagde en "ombygning til kalenderuger". Ingen af delene var sande. `B1` slettes ikke, men **skrumper** til den ene rest, der faktisk er tilbage: det rullende gætte-vindue er stadig scopet `(season_id, round_key)`, så to turneringer i samme kalenderuge åbner hver for sig. Rettet i `BACKLOG.md` (`B1`, `B2`s gate, `I15`s afhængighed), `ROADMAP.md` (trin 5 → ✅, begge "kendte afvigelser" lukket), `PRODUCT_BOOK.md` kapitel 4–5 (forbeholdene fjernet) og `DOCUMENTATION.md` §16 (deadline-påmindelsen beskrevet som runde-baseret, hvilket `A21` overhalede samme dag). Ingen kode, ingen SQL, ingen migrering. | **Fejlen var, at præmissen aldrig blev efterprøvet.** `round_key(ts)` regner `(dow - 2 + 7) % 7` og trækker fra — rundens tirsdag, altid — og `matches.round_key` er `GENERATED ALWAYS ... STORED` oven på den. Der findes intet turneringsrunde-begreb at bygge om **fra**: `api/sync-matches.js` importerer `stage_name` og aldrig et rundenummer fra leverandøren. Sætningen "med Superligaen alene reelt er det samme" var derfor sand af den forkerte grund, og den var netop grunden til, at ingen kiggede efter. **Det, der reelt manglede, var tvær-turnerings-aggregeringen — og den kom stykkevis, hvilket er hele forklaringen på, at ingen så den lande.** Rating (`rating_core.sql`: `group by m.round_key, p.user_id`) og Story Engine har altid kørt på `round_key` alene; Hjem-fanen samlede allerede på tværs af alle brugerens konkurrencer med dedup på match-id; `scope = 'ALL'` i rundechampionship og månedschampionship kom med `tournament_scope.sql` 31. juli 2026 — den sidste brik, leveret som en sidegevinst ved turnering #2 frem for som trin 5. En leverance fordelt over tre datoer og tre andre ID'er fik aldrig sin egen afkrydsning. **Ventetiden var alligevel ikke spildt.** Rækkens egen betingelse — "udskydes, til flere turneringer er i drift, først dér adskiller den sig" — var det rigtige instinkt: med én turnering kunne påstanden hverken be- eller afkræftes. Med syv i drift kunne den *efterprøves*, og svaret blev "allerede gjort" frem for "nu skal den bygges". **Backloggen havde selv opdaget det og blev ikke troet:** `I15`s punkt (2) skrev sort på hvidt, at *"`round_key` **er** allerede tirsdag–mandag"*, mens `B1` fire rækker længere oppe påstod det modsatte. To rækker i samme fil modsagde hinanden i en uge. Det er værd at holde fast i som mønster: en intern modsigelse i backloggen er et signal, ikke en skønhedsfejl. **Hvorfor gætte-vinduet bevidst står tilbage frem for at blive rettet med:** det er den eneste tilbageværende brug af runden som *tidsenhed* (`DOCUMENTATION.md` §3), og `A21` valgte få timer forinden eksplicit at lade det være runde-baseret, da låsen blev per kamp — så en runde stadig åbner samlet i stedet for at dryppe ind. At gøre vinduet globalt i samme ombæring ville træffe den beslutning som en fodnote til en dokumentationsrettelse. Spørgsmålet er ægte og står nu alene i `B1`: skal en Premier League-runde åbne uafhængigt af Superliga-runden i samme uge, eller skal vinduet følge kalenderugen som alt andet? |
| 1. august 2026 | **A21: låsen følger KAMPEN. En kamp låser 1 time før sit eget kickoff — ikke længere 1 time før rundens første.** Juli-beslutningen nedenfor (rundebaseret tipslås) er dermed rullet tilbage, og `A16` er besvaret om igen på et bedre grundlag. Migrering: `sql/predictions_match_lock.sql`, som afløser `predictions_round_lock_policies.sql` (#4) og `predictions_write_lock.sql` (#14) — begge må aldrig gen-køres derefter. Frontenden: `isLocked(match)` uden map; `buildRoundLockMap`/`roundLockKey` er erstattet af `buildRoundStartMap`/`roundStartKey`, som **kun** betjener det rullende gætte-vindue (det forbliver runde-baseret, så en runde åbner samlet). Analytics er delt i `analytics_match_locks` (låsen) og `analytics_round_locks` (rundens start). `mixesTournaments` er slettet. | **Rettelse først: `A16`s begrundelse var forkert.** Den sagde, at en konkurrence-scopet lås ikke er udtrykbar, og evaluerede aggregering over *alle* konkurrencer, en kamp indgår i — dér er `min` et hul (enhver kan flytte alles deadline med en `custom`-konkurrence). Men den rigtige aggregering er over **brugerens egne** konkurrencer, og den har ikke hullet, fordi deltagelse er frivillig. Reglen ville være sikker: kan nogen se dit gæt, deler I en låst konkurrence, hvis lås per definition er ≥ din. **Konkurrence-låsen blev alligevel fravalgt — af en grund, der holder bedre end den forkerte:** deadlinen ville afhænge af, *hvem du er*. To spillere i samme Rundechampionship ville have forskellig frist på samme kamp, og Rundechampionship, Månedschampionship og Championship er netop de konkurrencer, ingen har valgt. Dertil ville den kræve en RLS-policy, der joiner `competition_participants` × `competition_matches` på produktets travleste tabel, hvor ingen af dem har indeks på henholdsvis `user_id` og `match_id`. **Per kamp beholder den egenskab, der bærer løftet:** deadlinen er en egenskab ved KAMPEN, ens for alle. "Alle tipper på samme vidensgrundlag" omformuleres dermed fra pr. runde til pr. kamp — stadig en ægte regel, bare en snævrere, i stedet for at forsvinde. **Der er intet kopierings-hul, og det er værd at sige eksplicit,** fordi juli-teksten lyder som om der er: andres gæt for en kamp bliver først synlige, når kampen låser, og der kan ingen længere rette sit eget. Det, der gives op, er smallere: den, der tipper søndag, kender fredagens resultater og sin egen stilling. Med `round_wins` som tiebreaker og en Rundechampionship er det en reel fordel ved at tippe sent — accepteret med åbne øjne. **Juli-beslutningen var forebyggende, ikke udløst af en fejl:** dens formuleringer er konjunktiv ("kunne se", "kunne justere"), og der findes hverken brugerrapport eller fejlfindings-post. Den kostede til gengæld to efterspil — blindgyden i åbningsvinduet og et reelt skrive-hul, der stod åbent i op til en uge. **Tre steder blev ikke bare oversat mekanisk.** (1) `api/backfill.js`' regel 3 beholder sin runde-betingelse: en per-kamp-oversættelse ville have gjort den løsere end sin egen begrundelse, så den står nu som en selvstændig, strengere efterfyldnings-regel ("en runde, der er gået i gang, vokser aldrig"). (2) Deadline-påmindelsen samles pr. bruger pr. dag; den gamle kode sprang en hel runde over, så snart ÉN kamp havde resultat, hvilket per kamp er direkte forkert. (3) `deadline_miss` beholder runden som enhed, nu fordi *spørgsmålet* har den, ikke fordi låsen sad dér. **Prisen i UI'et blev nul, ikke som frygtet.** Bekymringen var, at nedtællingen måtte tilbage på hver kamprække og rulle en målt −31 % højdegevinst tilbage. Men lås = kickoff − 1 time, og rækkens tid-kolonne viser allerede kickoff — deadlinen er dermed aflæselig af det, der står i forvejen. **Verificeret mod PostgreSQL 16.13** med produktionsskemaet indlæst, inkl. en **negativ kontrol**: under de gamle rundelås-policies blev den sene kamp i en delvist låst runde afvist, under de nye accepteres den. Samme kørsel fangede, at `create or replace view` ikke kan omdøbe en kolonne — scriptet ville have fejlet i Supabase uden den. **`sql/schema.sql` er dermed bagud**, indtil skema-eksporten er kørt. |
| 1. august 2026 | **A16 lukket: låsen følger turneringen, ikke konkurrencen — den forbliver scopet på `(season_id, round_key)`.** En konkurrence, der blander to turneringer i samme viste runde, får fortsat én deadline pr. turnering, og andres gæt bliver synlige turnering for turnering. Ingen SQL, ingen ændring af `isLocked`/`roundLockKey`/`lockedRoundsOf`: `predictions_round_lock_policies.sql` og `predictions_write_lock.sql` scoper allerede med `m2.season_id is not distinct from m.season_id`, og beslutningen bekræfter dem. Leveringen er derfor **tydeliggørelse**: opret-skærmen siger nu, når en konkurrence kan blande flere turneringer (ny ren funktion `mixesTournaments` i `scoring.js`, så udløseren kan testes uden at rendere skærmen), reglen er skrevet ud i `DOCUMENTATION.md` §3 med §7 som henvisning, og invarianten er pinnet af tests i `scoring.test.js`. Dermed falder den sidste gate på `I14`. | **Ja-svaret er ikke udtrykbart — det er hele afgørelsen.** `predictions` er **én række pr. bruger pr. kamp, delt på tværs af alle konkurrencer** (det er samme designbeslutning, `filterFromNextUnfinishedRound` findes for). En konkurrence-scopet lås kræver, at den samme række har to låsetider afhængigt af, hvilken konkurrence man kigger igennem — og RLS ser ingen konkurrence, kun rækken. Aggregerer man i stedet over de konkurrencer, en kamp indgår i, åbner **begge** retninger et hul: `min` ⇒ enhver bruger kan oprette en `custom`-konkurrence med én tidlig kamp og dermed flytte **alles** skrive-deadline for resten af runden; `max` ⇒ man kan rette sit gæt, efter en anden konkurrence har afsløret de samme gæt. Der er ikke en tredje retning. **Præcedensen findes og forklarer, hvorfor tricket ikke kan genbruges:** det rullende vindue (`openDaysBefore`) ramte nøjagtig samme delte-række-problem og blev løst med "gælder kun, hvis **alle** konkurrencer en kamp indgår i har det sat". Den løsning virker, fordi vinduets default er den strenge — "ikke sat" betyder "åben", så den mest restriktive part vinder gratis. Låsen har ingen tilsvarende sikker default: dens to yderpunkter er "for tidligt" og "for sent", og begge er forkerte. **Vejen udenom ville være at flytte `predictions` til `(bruger, kamp, konkurrence)`** — en migrering, der rører rating, alle tre stillings-views, Championship og karriereprofilen, for at fjerne en ekstra deadline-linje i et rundehoved. Prisen står ikke mål med gevinsten, og den delte række er samtidig det, der gør, at et tip afgivet ét sted tæller alle steder — en egenskab produktet er bygget på, ikke en tilfældighed. **Udløseren var allerede indtruffet, bare et andet sted end forventet.** A16's `Afgøres` sagde "når `B2` (Scotland) er i drift, og en konkurrence rent faktisk blander to turneringer i samme runde", og backlog-indbakken noterede samtidig, at `mode_params.tournaments` aldrig er skrevet i produktion. Begge pegede på multi-turnerings-`full_season` som den vej, scenariet ville komme ad. Men `random` trækker allerede i dag på tværs af **alle** ligaer (`randomLeagueIds || leagues.map((l) => l.id)`, derefter `min(round_key)`), og `custom` har samme egenskab — så med syv turneringer kan en tilfældig kupon blande to ligaer i samme `round_key` nu, uden Scotland og uden at feltet nogensinde er brugt. Betingelsen var opfyldt, før nogen nåede at se efter; det er værd at vide ved en senere revision, at beslutningen blev truffet på en situation, der fandtes, og ikke på en, der var forudsagt. **Det, spørgsmålet faktisk pegede på, var allerede løst** — `mixedTiming` giver rundehovedet "Næste lås om …" og hver række sin egen deadline, og `lockedRoundsOf` beskærer hver runde til sine låste kampe, så et gæt aldrig kan ses før sin deadline. Manglen var, at valget kunne træffes uden at kende vilkåret; derfor er advarslen sat på opret-skærmen frem for at ændre noget nedenstrøms. **En "samlet visning" kun i UI'et er forkastet:** den ville skjule gæt i konkurrence X, som den samme bruger kan se i konkurrence Y, og beskytter derfor intet — den koster information uden at købe noget. |
| 1. august 2026 | **`G51` lukket: brede opslag i `api/` pagineres, og runde-opslaget har grænser i begge ender.** `sbAll()` i `api/_shared.js` henter sider, indtil en side kommer **tom** hjem — ikke indtil en side er kortere end bestilt: projektets `db-max-rows` kan ikke aflæses fra repoet, så "kortere end bestilt" ville være sandt for hver fuld side, hvis loftet var lavere end sidestørrelsen. `order` er påkrævet, fordi flere tabeller har sammensat primærnøgle og ingen `id`-kolonne at gætte på. Runde-opslaget har desuden fået `round_key=lte.<dagens danske dato>`. Ren `api/`-ændring: ingen SQL, ingen migrering, intet i frontenden. | En tavs afkortning er ikke en fejl, men et forkert facit: PostgREST svarer 200 med en kortere liste, og `sb()` kaster kun ved ikke-2xx. Den kostede en **falsk** notifikation til rigtige brugere — "Runden er slut" midt i en runde — og den kom af datamængden, ikke af en kodeændring, så den ville have ramt igen med en anden runde. Grænsen og pagineringen gør ikke det samme: den ene fjerner rækker, svaret aldrig skulle have båret, den anden gør klassen af fejl umulig. Prisen er ét ekstra kald pr. opslag i et job, der kører hvert 15.-30. minut. |
| 1. august 2026 | **`B8` lukket: Champions League fejlede ikke — sæsonen fandtes bare ikke endnu.** Diagnosen svarede `season-not-published`: football-data.orgs aktuelle CL-sæson er 2025, og 2026/2027 er ikke oprettet, fordi ligafasen ikke er lodtrukket. `api_season_id = '2026'` er rigtig og røres ikke. To rettelser fulgte af selve fejlsøgningen: diagnosen kører nu **også når sæsonopslaget fejler** (den var bygget til 200-med-tom-liste, mens leverandøren svarede 404), og `season-not-published` tælles som en **gennemført** kørsel med nul kampe frem for en fejlet. Dertil `.vercelignore`, som holder testfilerne ude af deployet. | **Det, der gjorde `B8` svær, var ikke svaret — det var, at intet sted bar det.** Nul kampe så ens ud, uanset årsag, og de to årsager har modsat konklusion: den ene retter sig selv, den anden gør ikke. **Første forsøg ramte ved siden af**, fordi det var bygget på en *antaget* tomhed: `?season=2026` svarede 404, ikke 200 med en tom liste, så diagnosen kastede forbi sin egen kode. Lærepengen er generel: en diagnose, der kun dækker den udgang, man har forestillet sig, er en formodning med kode omkring sig. **Tolerancen er den anden halvdel.** CL ville stå rød ved hver kørsel i seks uger frem til lodtrækningen, og et job, der altid er rødt, lærer én at holde op med at kigge — hvorefter den *næste* røde række også er usynlig. Kun `season-not-published` slipper igennem; `season-unknown` forbliver rød, fordi den ikke retter sig selv, og reglen er trukket ud som `seasonFetchVerdict()` med sin egen test, fordi en tolerance, der skrider, gør en død turnering grøn. **Og den dyreste omvej hørte slet ikke til i koden:** rettelsens eget deploy var fejlet tavst på Vercels 12-funktioners loft (en ny testfil under `api/` blev den 13.), så det samme 404-svar blev aflæst tre gange som kodens resultat, mens det kom fra en version, der var to merges gammel. `main` og produktion er ikke det samme, og et **ordret uændret** symptom efter en merge er ikke et resultat — det er den regel, `DOCUMENTATION.md` §13 nu bærer. |
| 1. august 2026 | **En tom sæson skal kunne forklare sig selv: `sync-matches` spørger datakilden hvorfor, når nul kampe kom hjem, og lægger svaret i `emptySeason` i kørslens detalje** (`B8`, halvt lukket). Ny **valgfri** metode i providerkontrakten, `describeEmptySeason()`, implementeret på football-data.org (`/competitions/<kode>`) og bevidst ikke på Sportmonks. Fem koder: `season-empty`, `season-not-published`, `season-unknown` (**den eneste, der kræver handling**), `undetermined`, `lookup-failed`. Ingen SQL, ingen migrering, ingen ændring i frontenden — Admin → Drift viser i forvejen detaljen som rå JSON. Spec-tilføjelse: [`features/flere-datakilder-v1.md`](./features/flere-datakilder-v1.md) §7.1. | **Problemet var ikke, at CL hentede nul kampe — det var, at nul ikke betød noget bestemt.** `?season=<år>` svarer 200 med tom liste både når sæsonen findes uden offentliggjort program (CL før lodtrækningen, som retter sig selv) og når `api_season_id` peger på et år, leverandøren ikke kender (som ikke gør). Backloggen bar den forskel som prosa og et *"aflæs den i Admin → Drift"*, men det, der stod dér, kunne ikke besvare spørgsmålet — så `B8` kunne blive stående vilkårligt længe uden at nogen opdagede, hvilken af de to det var. **Diagnosen er lagt i providermodulet og ikke i syncen**, fordi tvetydigheden er leverandørens: Sportmonks har et rigtigt sæson-id og fejler hårdt på et forkert, så den har intet at forklare — derfor valgfri metode frem for en, alle skal implementere. **Kaldet sker kun ved nul kampe** (højst ét ekstra pr. kørsel, og kun mens turneringen alligevel ikke leverer noget) og **kan aldrig vælte kørslen**: en tom sæson *er* en gyldig kørsel, og en fejlende diagnose må ikke gøre den til en fejlet — derfor `lookup-failed` som en femte kode frem for et kast. **Selve svaret er ikke aflæst herfra**: egress-politikken i udviklingsmiljøet blokerer `api.football-data.org`, så koden gør spørgsmålet automatisk frem for at foregribe svaret. Fanger samme klasse fejl i enhver fremtidig turnering, ikke kun i CL — hvilket er hele grunden til, at det blev kode og ikke ét manuelt opslag. |
| 1. august 2026 | **Kortrækkefølgen i opret-galleriet er ikke længere neutral varighed, men en anbefaling: Sæson er produktets standardvalg og står øverst med mærket "Anbefalet".** Rækkefølgen er vendt til langt → kort (Sæson · Favorithold · Quick League · Quick Pick · Ugens kupon · Custom), og hvert kort har fået et ikon og en varigheds-mærkat over en omskrevet beskrivelse. Ren frontend, ingen SQL, ingen ændring af oversættelsen til de fem modes. Spec-rettelsen er markeret i [`features/opret-flow-v2.md`](./features/opret-flow-v2.md) §2. | A22 stillede kortene kort → langt og kaldte selv rækkefølgen "varighedsspørgsmålet" — en neutral akse. Men listen ER en anbefaling, uanset om den er ment som en: det øverste kort får flest valg. Sæson er den type, produktet vil have flest i (den eneste, der binder en liga sammen en hel sæson, og allerede dén, onboarding-guiden opretter), så aksen er vendt frem for fjernet — varighed er stadig en ærlig sortering, den peger bare nu det rigtige sted hen. **Favorithold nummer to** frem for Quick League: Sæson og Favorithold er de eneste to, der løber sæsonen ud OG vokser af sig selv (efterfyldnings-regel 1), så Favorithold er det nærmeste alternativ under det anbefalede — "hele sæsonen, bare ikke alle kampe". **Mærkaten** findes, fordi typerne adskiller sig på to akser (hvilke kampe · hvor længe), og de gamle beskrivelser var varianter af hinanden, så begge skulle udledes af prosaen — det var netop den klage, ændringen kom af. Ny regel i praksis: `liga` er vennegruppen, også i marketing-nær korttekst ("en lille liga over nogle uger" er skrevet væk fra Quick League). |
| 31. juli 2026 | **A20 lukket: en sæson-konkurrence efterfyldes med kampe, der skemalægges senere — og fase-afgrænsning er fjernet for at gøre reglen entydig.** `api/backfill.js` føjer nye kampe til eksisterende konkurrencer efter kamp-upserten i `sync-matches`. Tre regler: kun de regel-baserede modes (`full_season`, `team`, `time_range`) — `custom`/`random` er håndplukkede lister og må aldrig vokse; en konkurrence med `mode_params.stages` står urørt; og **en låst runde vokser aldrig**. Samtidig er fase-vælgeren fjernet fra oprettelsen: `mode_params.stages` skrives ikke længere, men **læses** som mærkat af regel to. Opret-skærmen viser nu kampantal pr. turnering, og en turnering med nul kampe kan ikke vælges. | **Beslutningen fra juli var rigtig og holdt op med at være det.** "Creation-time filter, ikke live-auto-tilknytning" blev truffet, da produktet havde én turnering, hvis kampprogram var kendt fra sæsonstart; prisen blev dengang formuleret som "playoff-konkurrencen oprettes til foråret". Med syv turneringer er prisen en anden: Champions Leagues knockout trækkes undervejs, og indtil da har turneringen nul kampe — en "hel sæson · Champions League" oprettet i dag ville blive oprettet tom og forblive tom. Forudsætningen var ændret, ikke argumentet. **Hvorfor faserne røg med:** stage var den eneste tvetydige dimension i en efterfyldning (`team` er hold + sæson, `time_range` er datoer — begge entydige). Et gemt tomt stage-filter betød "alt", men var skrevet på et tidspunkt, hvor "alt" kunne være mindre, end det er nu. Tvetydigheden kunne have været løst med en regel alene, så fjernelsen er **ikke** teknisk nødvendig — den er valgt på enkelhed: en fase-afgrænset konkurrence og en ny konkurrence er det samme, og liga-lagets "konkurrencer er kapitler i ligaens historie" er den bedre mekanik. Dertil siger §12, at fasenavne ikke er fælles på tværs af turneringer, så vælgeren viste med syv turneringer op til syv forskellige ordforråd i samme formular. **Hvorfor det gamle felt beholdes:** det gør overgangen gratis. Findes `stages`, er rækken afgrænset i hånden under den gamle ordning og efterfyldes ikke — så gamle og nye rækker behandles af *samme* regel, uden en overgangsklausul eller en dato at huske. Feltet skifter rolle fra filter til mærkat. **Hvorfor låsereglen er strengere end nødvendig:** en kamp tilføjes kun, hvis dens runde endnu ikke er låst. Så kan en efterfyldning aldrig udbetale point for et tip, der allerede er afgivet — netop den fejl, `filterFromNextUnfinishedRound` blev bygget for at forhindre ved oprettelsen. **Prisen er accepteret — og målt til nul.** Man kan ikke længere oprette "kun Superligaens grundspil" som konkurrence; det skal være `custom`, `time_range` eller en ny konkurrence, når slutspillet er trukket. Eksisterende konkurrencer er upåvirkede, fordi deres kampe forlængst er materialiseret. **Opslaget er kørt i produktion samme dag** (`select … where mode_params ? 'stages' or mode_params ? 'tournaments'`) og gav **nul rækker**: ingen har nogensinde oprettet en fase-afgrænset konkurrence, så fjernelsen tog intet fra nogen. Forskellen betyder noget for en senere revision — en pris, der er *målt*, kan diskuteres på et andet grundlag end en, der blev anslået. Samme opslag viste, at `mode_params.tournaments` også er tomt: multi-turnerings-konkurrencen er leveret (juli 2026), men aldrig taget i brug, hvilket er noteret i backloggens indbakke frem for behandlet her. |
| 31. juli 2026 | **A19: de fem football-data.org-turneringer er synlige OG officielle fra dag ét. Scotland Premiership forbliver den ene uofficielle — indtil den igangværende spillerunde er slut.** `sql/tournament_footballdata_promote.sql`. | **Forfremmelsen er gratis lige nu, og bliver dyrere for hver dag.** `is_official` styrer Championship (som summerer point på tværs af officielle turneringer) og ratingen (`recompute_ratings()` tæller kun officielle — A17). Begge regner ud fra **tips**, ikke ud fra kampe. De fem turneringer har endnu ingen konkurrencer og dermed ingen tips, så forfremmelsen flytter ikke ét eksisterende tal — den ændrer kun, hvad der tælles fra og med den første konkurrence, nogen opretter. Ventede vi til efter den første konkurrence, ville forfremmelsen derimod ændre en kåring, folk allerede havde tippet mod. **Derfor står Scotland stille:** dens runde er i gang, og den har tips. Den forfremmes, når runden er talt op — det er præcis samme argument, bare med modsat fortegn. **Fravigelsen fra §10's tommelfingerregel er bevidst:** "nye turneringer bør begynde som `is_official = false` og forfremmes bevidst" beskytter mod at ændre titlernes betydning under en løbende konkurrence. Her er der ingen. Reglen er fulgt i ånden, ikke i bogstaven. **Champions League er forfremmet uden at have hentet en eneste kamp** (`B8`). Det er ufarligt af samme grund — ingen kampe, ingen tips, intet at tælle — men det er værd at vide, at rækkefølgen blev sådan. |
| 31. juli 2026 | **A18: to datakilder side om side frem for et Sportmonks-abonnement. Premier League, Champions League, Bundesliga, Serie A og Primera División hentes fra football-data.org — gratis.** `leagues.provider` afgør, hvem der spørges; leverandørspecifik kode bor i `api/providers/`, og resten af syncen er fælles. Spec: `docs/features/flere-datakilder-v1.md`. | **A10 spurgte forkert.** Den behandlede "hvilken plan hos Sportmonks" som hele spørgsmålet og konkluderede rigtigt, at PL kostede €29/md og CL €29/md oveni. Men leverandøren var aldrig selv blevet valgt — den var en antagelse skrevet ind i URL'er og feltnavne. football-data.orgs gratis-plan rummer 12 turneringer, heriblandt alle fem, og mangler kun Superligaen, som Sportmonks netop har. Planerne er komplementære, ikke konkurrerende, og tilsammen koster de nul. **A10's konklusion står ved magt** — den er bare ikke længere den eneste vej til PL og CL. **Prisen er livescore, ikke point:** gratis-planen har forsinkede resultater og intet spilleminut, så de fem turneringer får ingen live-kort. Point kommer altid fra det endelige resultat og er upåvirkede. Vilkåret ligger i data (`leagues.live_enabled`) og ikke i kode, netop fordi det er abonnementet og ikke arkitekturen, der bestemmer det: tegnes €12/md-planen, er hele opgraderingen én `update`. **Kaldloftet var aldrig problemet:** 10 kald/minut lyder stramt, men football-data.org returnerer hele sæsonens kampprogram i ét kald, hvor Sportmonks skal pagineres. Værste minut bruger 6 af 10. **Prisen betales i kode, ikke i kroner:** ét abstraktionslag mere at holde ved lige, og et id-præfiks (`fd:`), fordi `matches.api_fixture_id` er globalt unik og begge leverandører bruger almindelige heltal. Det var billigere end ~430 kr./md for en app uden indtægter. |
| 31. juli 2026 | **A17 lukket: ratingen tæller kun officielle turneringer — og `ratings.scope` forbliver bevidst ubrugt.** `recompute_ratings()` (`sql/rating_core.sql`) joiner nu `seasons`/`leagues` i `_rs` og kræver `is_official`. Dermed betyder `is_official` det samme overalt: en turnering tæller enten alle officielle steder (titler **og** rating) eller ingen — din egen konkurrence tæller den altid. Den frosne reference i `sql/tests/_reference_recompute.sql` er opdateret i samme ombæring, hvilket **er** beslutningen om, at tallene må flytte sig; til gengæld har `rating_equivalence.sql` fået en selvstændig sektion, der tilføjer en uofficiel turnering efter sammenligningen og kræver, at intet rykker sig. App-teksten er rettet fire steder (`scopeNote`, `RatingTab` ×2, `HjemTab`). **Per-turnering-rating (`ratings.scope`) er afvist, ikke udskudt.** | **A2's argument kunne ikke genbruges, og det er hele grunden til, at spørgsmålet var sit eget.** A2 havde brug for `is_official`, fordi en **titel er permanent**: "Månedens Champion ×5" skal betyde det samme i 2027 som i 2026. Rating har ikke den egenskab — `recompute_ratings()` indleder med at slette `ratings`/`rating_history` og bygge alt op fra runde nul, så tallet altid er "hvor du står nu i forhold til det nuværende felt". Der er intet arkiv at beskytte, og en mekanisk kopiering af A2 ville have været en beslutning truffet på et argument, der ikke gælder. **Bredde var heller aldrig problemet:** rundescoren er `pts / n`, et gennemsnit, så den, der tipper 12 kampe, havde intet forspring på den, der tipper 6 — den skævhed, A2 rettede i stillingerne, fandtes ikke i ratingen. **Det, der faktisk stod tilbage, var to ting.** Statistisk: to spillere blev sammenlignet på delvist forskellige kampsæt i samme runde, og er den ene turnering lettere at forudsige end den anden (Scottish Premiership er ekstremt toptung), følger rating med. Det er en systematisk skævhed, men lille og først målbar efter nogle runder. Sprogligt — og det blev udslagsgivende: status quo krævede en ledsætning, hver gang det skulle forklares. Sætningen på Championship-fanen måtte lyde *"giver point i din konkurrence **og i din rating**, men tæller ikke med her"*. **At den ledsætning var nødvendig, var i sig selv argumentet:** et produkt, hvor "officiel" betyder to forskellige ting afhængigt af hvilken skærm man står på, samler den slags gæld hurtigere, end den betaler den af. Nu er reglen én sætning. **Prisen er kendt og accepteret:** en spiller, hvis tips alle ligger i uofficielle turneringer, får ingen rating-række overhovedet. Brugerfladen håndterede det allerede pænt (stillinger viser "–", Hjem skjuler feltet), og Rating-fanens "Hvorfor står jeg her ikke?"-kort — som ellers ville have været direkte forkert for netop den bruger — nævner nu turneringen ved navn. Botemidlet er at forfremme turneringen. **Per-turnering-rating er afvist frem for udskudt,** fordi den kræver en vælger på produktets mest citerede tal hvert eneste sted det vises, og med én officiel turnering ville hver per-turnering-Elo have to-tre spillere at være relativ til: støj, ikke en måling. Verificeret mod PostgreSQL 16.13 — inkl. en **negativ kontrol**, hvor filteret blev fjernet igen, og testen fejlede som den skulle (uden den beviser en grøn test ingenting). |
| 31. juli 2026 | **A10 lukket: gratis-planen rækker til turnering #2 — den er bare ikke Premier League. Turnering #2 bliver Scotland Premiership, og der betales ikke noget.** Kontoens plan er verificeret (Football Free Plan, 31. juli 2026): **4 turneringer** — Denmark Superliga `271`, Superliga Play-offs `1659`, **Scotland Premiership `501`** og Premiership Play-Offs `513` — plus 3.000 API-kald. Scotland Premiership er dermed en rigtig turnering med rigtige kampe, som hele `B2` kan bygges og QA'es mod uden en krone: samme sæsonrytme som Superligaen (weekendrunder, aug.–maj), egne holdnavne til at afprøve den fuzzy holdmatch, og egne fasenavne til `STAGE_LABELS`. Tændes med `is_visible = false`, indtil §3.2 er verificeret; derefter er det et frit valg, om den skal være synlig for brugerne. **Premier League koster stadig penge** — Starter **€29/md** (5 selvvalgte turneringer) er det eneste relevante niveau; Growth €99 og Pro €249 er irrelevante ved et behov på 2–3 turneringer. **Champions League er et add-on** (Euro Club Tournaments, +€29/md) uden for de 5 valg og tages som en selvstændig beslutning, ikke som en fodnote til PL; internationale turneringer (€129) er fravalgt. Abonnementet tegnes først, når nogen reelt vil tippe Premier League ved en sæsonstart. | **Den oprindelige antagelse var forkert, og det billigste svar lå i planen hele tiden:** A10 spurgte, om gratis-planen rakte til turnering #2, og gik ud fra, at turnering #2 var Premier League. Planen indeholder en anden liga i forvejen — og for det, `B2` skal bevise (at appen kan håndtere *flere* turneringer: dobbelt-tælling, turneringsvælger, stage-navne, holdmatch, `round_key` på tværs), er det turnerings-**antallet**, der er variablen, ikke hvilken turnering det er. **Derfor koden før pengene:** et abonnement tegnet nu ville betale for måneder brugt på at debugge §3.2, og udgiften er privat — appen er gratis for brugerne (produktbogens vision), så der er ingen indtægt at modregne ~215 kr./md i. "Roadmappen nævner Premier League" er ikke i sig selv en grund til at afholde den; efterspørgsel er. **Rate limit er aldrig det, vi ville betale for:** `sync-live` bruger maks. 60 kald/time på kampdage og nul resten af tiden (den tomme-vindue-tidlig-retur i `api/sync-live.js`), og `sync-matches` ~4 kald pr. kørsel pr. turnering hver 6. time — langt under selv den mest konservative læsning af gratis-planens loft. **Sidegevinst ved netop Scotland:** `B1` (den globale tirsdag–mandag-runde) kan først testes, når to turneringer spiller i samme kalenderuge med hver sin turneringsrunde — det gør en skotsk sæson lige så godt som en engelsk. |
| 31. juli 2026 | **K2 lukket: per-turnering-titler tælles med, men vises adskilt.** Ny gren `titles.by_tournament` i `career_profile()` (ét objekt pr. officiel turnering med dens månedstitler og rundesejre) + en egen sektion på karriereskærmen med dæmpede badges og sin egen `InfoDot`. De samlede grene (`monthly`/`season`/`round_wins`) er uændret **kun** de samlede. Per-turnering-**rating** (`ratings.scope`) forbliver ubesluttet. | K2 spurgte, om profilen skulle deles pr. turnering, og v1-svaret var nej — *"ellers bygges en vælger uden indhold"*. Med to niveauer i Championship har vælgeren indhold, og spørgsmålet blev til et andet: hvad tæller som en **titel**? Svaret er begge dele, men ikke i samme bunke. **Adskillelsen er hele pointen:** blandede man dem, ville "Månedens Champion ×5" betyde noget andet efter turnering #3 end før — et karrieretal, hvis betydning skifter, når produktet vokser, kan ikke sammenlignes med sig selv, og karriereprofilen er netop bygget på, at tal holder over tid. Turneringer uden sejre udelades, så en ny turnering ikke giver enhver profil en tom overskrift, og komplethedsjoinene er pr. turnering, så en manglende skotsk kamp ikke kan holde Superligaens månedstitel tilbage. Verificeret mod PostgreSQL 16.13. |
| 31. juli 2026 | **Turnering #2 tændes synlig med det samme — A10's `is_visible = false` er fraveget.** Drejebogen foreskrev, at Scotland Premiership skulle ligge skjult, til §3.2 var verificeret; ved leveringen af `B2` tændes den i stedet synlig fra første række i `leagues`. | Brugerskaren er lille, og alle ved, at der stadig testes — så prisen ved at tage fejl i åbent land er lav, mens prisen ved at vente er, at generalprøven kun kan køres af én person med databaseadgang. Fravigelsen står som en beslutning og ikke som et stilfærdigt ændret tal i et script, fordi §3.4 og A10 fortsat siger `false`: den gamle formulering er streget over i drejebogen frem for slettet. To ting gjorde det forsvarligt: rundechampionshippet tæller nu kun synlige turneringer (så synligheden kan slås fra igen uden at holde runder kunstigt åbne), og turneringsvælgeren forvælger den *ældste* turnering, så Superligaen bliver stående forrest. |
| 31. juli 2026 | **Det ubyggede er samlet i `docs/BACKLOG.md` — og lukkede rækker slettes derfra i stedet for at streges ud.** Fire tabeller (åbne beslutninger, ubygget, teknisk gæld, ideer) plus en fri indbakke øverst. ID-serien `A#` fortsætter uændret; `B#`/`G#`/`I#` er nye. | Det leverede havde tre gode hjem, det ubyggede havde syv dårlige — og rå ideer havde ingen. Beviset for, at det kostede, stod allerede i `DOCUMENTATION.md` §12: afsnittet beskrev en fil-opdeling som "næste naturlige oprydning", tre uger efter den var leveret, og pegede på `A12`, som var lukket og fjernet. En to-do, der bor syv steder, opdateres ét sted. **Sletningsreglen er det, der adskiller filen fra resten af dokumentationen,** hvor konventionen er at strege ud og bevare: her findes arkivet allerede andetsteds (`DECISIONS.md`, `CHANGELOG.md`), så bevaring ville kun gøre den eneste liste, der skal kunne skimmes, ulæselig. Forkastede ideer er undtagelsen — de arkiveres ingen steder, og uden en linje bliver den samme idé foreslået igen. **Indbakken er det, der afgør, om filen bliver brugt:** en idé, der kræver et ID, en begrundelse og en tabelrække, bliver ikke skrevet ned. |
| 30. juli 2026 | **Dokumentationen er gjort navigerbar frem for kortere.** `DOCUMENTATION.md` har fået markdown-overskrifter og en indholdsfortegnelse; changeloggen og arkivet af trufne beslutninger er flyttet til egne filer; `CLAUDE.md` er en rutetabel fra opgave til afsnit. | Problemet var struktur, ikke mængde: filen havde **nul** overskrifter, så de 21 afsnit kunne hverken navigeres eller læses i uddrag — man måtte tage alle ~46k tokens for at finde ét afsnit. Udgangspunktet for en feature-session gik fra ~87k til ~16k tokens. Intet indhold er slettet; en omskrivning ville have sparet mere, men er den eneste variant, hvor detaljer kan gå tabt, og dokumentationens værdi her ligger netop i begrundelserne. |
| 30. juli 2026 | **Ratingberegningen er optimeret, ikke gjort inkrementel — og fundet var et andet, end alle troede.** Én linje ændret: den logistiske forventningsværdi regnes i `double precision` i stedet for `numeric`. Fuld genberegning af en sæson: 19,8 s → 0,1 s (~175×). | Planen sagde "mål først, optimér målrettet", og målingen vendte antagelsen på hovedet. `DOCUMENTATION.md` §12 pegede på alle-mod-alle-selvjoinet ("sortér + histogram") — men det producerede 930 rækker på 0,6 ms. Hele omkostningen lå i `power(10, numeric)`: vilkårlig-præcisions-potens, ~110 µs pr. kald, 930 kald pr. runde. Ved 150 spillere tog en genberegning knap **otte minutter**, synkront i triggeren på `matches` — altså inde i den sætning, `sync-live` bruger til at færdigmelde en kamp. Det var en tikkende bombe, ikke en teoretisk bekymring. To andre kandidater blev målt og forkastet: indeks på `predictions(match_id)` (inden for støjen) og på temp-tabellen `_rs` (gjorde det langsommere). Inkrementel beregning er dermed ikke længere nødvendig ved realistiske størrelser. |
| 30. juli 2026 | **Ratingberegningen har nu en ækvivalenstest, der kører i CI mod en rigtig PostgreSQL.** `sql/tests/rating_equivalence.sql` sammenligner med en **frosset** kopi af algoritmen fra før optimeringen. | Rating var det eneste store domæne uden nogen test, og optimeringen flyttede tal (om end i 13. decimal). Uden en test er "resultatet er det samme" en påstand. Testen er verificeret følsom: en K-faktor ændret fra 24 til 25 og en drift på 0,00001 fanges begge. Den frosne reference må kun opdateres, hvis algoritmen ændres meningsfuldt — og den opdatering er så selve beslutningen om, at tallene må flytte sig. |
| 30. juli 2026 | **Efterladte databaseobjekter fjernet: `trg_recompute_ratings()`, `leagues.country`, `seasons.end_date`** (`sql/cleanup_orphans.sql`). `standings_views.sql` er omdøbt til `.superseded.sql`, så filnavnet selv advarer. | Alle tre har nul referencer i app-kode, migreringer og skema. **`matches.status` blev bevidst IKKE fjernet**, selvom den skrives 6 steder og læses 0: adfærden er dokumenteret i afsnit 8, og de fleste skrivninger bevarer bare værdien under en upsert, så en fjernelse ville røre live-syncens skrive-sti. Gevinsten er én ubrugt kolonne; prisen er en irreversibel ændring i den mest kritiske kode i projektet. Filen dokumenterer også fire objekter, der *ligner* forældreløse ved en grep, men bruges af RLS-policies, views og genererede kolonner — så næste oprydning ikke skal opdage det forfra. |
| 30. juli 2026 | **Overvågning af de planlagte jobs i to lag: `job_runs` + Admin → Drift for det, der skete, og en heartbeat-workflow for det, der IKKE skete.** | Jobbene fejlede tavst. Alarmen ligger uden for appen med vilje: planen foreslog push til admins, men den kanal deler skæbne med det, den overvåger — er Supabase eller Vercel nede, dør push-vejen af samme årsag som jobbet. GitHub Actions er uafhængig og notificerer allerede repoets ejer. Et auto-deaktiveret cron-job skriver ingen rækker, så tavshed skal måles på hvor længe siden jobbet meldte sig, ikke på en fejl. |
| 30. juli 2026 | **A11 afgøres på data, ikke på hukommelse.** `isAuthorized()` i `api/_shared.js` returnerer nu `{ ok, via }` og logger `[A11]`-advarsel i Vercels logs, hver gang hemmeligheden kommer som `?secret=`. Fremgangsmåden står i `docs/CRON.md`. | A11 kunne kun lukkes, når "alle cron-jobs er bekræftet flyttet" — men jobbene bor i cron-job.orgs brugerflade, så der fandtes ingen kilde at bekræfte det mod. Instrumenteringen gør spørgsmålet aflæseligt: ingen `[A11]`-linjer over en periode, der dækker alle skemaer, betyder at fallbacken kan fjernes uden at noget svarer 401. Uret begynder at løbe ved næste deploy. |
| 30. juli 2026 | **`docs/CRON.md` er registeret over planlagte jobs.** | Jobbene kører på cron-job.org uden for repoet, og opsætningen fandtes udelukkende i den konto's brugerflade plus spredt prosa. Den kunne hverken gennemgås, diffes eller gendannes. Registeret erstatter ikke cron-job.org — det er den liste, man holder kontoen op imod, og den kommende overvågning skal måles mod. |
| 30. juli 2026 | **Rating-kernen har fået en migreringsfil (`sql/rating_core.sql`).** Funktionskroppene er klippet ordret ud af `schema.sql`, inkl. deres CRLF. | Elo-implementeringen fandtes kun inde i det genererede øjebliksbillede; `rating_trigger_optimization.sql` henviser til et "oprindeligt rating-script", der aldrig har ligget i repoet. Uden versioneret kilde er der intet at ændre i, når beregningen skal gøres inkrementel. Ordret kopi frem for omskrivning, så filen beviseligt er en no-op mod produktionen — og CRLF bevaret, fordi en normalisering ville ændre `prosrc` og give en stor, indholdsløs diff ved næste skema-eksport. |
| 30. juli 2026 | **CI kører lint + test + build ved hver pull request** (`.github/workflows/ci.yml`). ESLint er tilføjet med hooks-reglerne og et loft på antal advarsler; de 26 nuværende advarsler er alle React-Compiler-regler (`static-components`, `set-state-in-effect`, `purity`, `immutability`), som står som advarsel frem for fejl. | Indtil nu hvilede merge-sikkerheden på, at et menneske huskede at køre `npm test` plus en 20-punkts manuel tjekliste. Advarsel frem for fejl, fordi hvert af de 26 fund kræver en gennemtænkt omskrivning, ikke en rettelse — de hører til fil-opdelingen. Loftet betyder, at tallet kan falde, men aldrig vokse ubemærket, så gælden er synlig i stedet for tavs. |
| 30. juli 2026 | **Prettier er opsat, men håndhæves ikke i CI.** `npm run format` findes; `format:check` er bevidst ikke et CI-trin. | En fuld gennemformatering ville omskrive ~6.700 linjer ved `printWidth: 140` og ~14.000 ved standard 80 — på tværs af alle 46 filer, altså det meste af kodebasen. Koden lægger bevidst hele `useEffect`-kroppe på én linje, og det udvider Prettier uanset bredde. Prisen er hele repoets `git blame`; gevinsten er konsistens i en kodebase med én forfatter og en i forvejen ensartet håndstil. Beslutningen om at tage den store omskrivning er udskudt, ikke truffet. |
| 30. juli 2026 | **`eslint-plugin-react-refresh` er fravalgt.** | Dens eneste regel (`only-export-components`) forbyder at eksportere andet end komponenter fra en skærmfil — men projektets testopsætning er bevidst uden jsdom og tester i stedet *eksporterede rene hjælpefunktioner* fra skærmfilerne (`ProfileScreen.test.jsx`, `ChampionshipTab.test.jsx`, `PredictionsScreen.test.jsx`). Reglen ville straffe præcis det, der gør skærmene testbare. |
| 30. juli 2026 | **Tragten udledes af rigtige tabeller, ikke af hændelsesloggen — og har to forskellige tal for "frafald" (A13 lukket).** `admin_analytics_funnel` læser `profiles`/`group_members`/`competition_participants`/`predictions`. Trin-tællingen viser, hvem der nåede hvert trin overhovedet; "hvor står de nu" er en ægte partition. Opdelingen selvstarter/inviteret afgøres af den FØRSTE liga, brugeren kom med i. | `account_created`, `league_joined` og `prediction_saved` findes i kataloget, men loggen er fire-and-forget: en tragt, der undervurderer sit eget første trin, er værre end ingen tragt — og dette er netop et tal, nogen vil bestride. De to visninger findes, fordi trinnene IKKE er strengt indlejrede: en konkurrence kan være liga-løs, så en bruger kan nå "konkurrence" uden nogensinde at have haft en liga, og at læse stall-tallene som trin-tal ville dobbelttælle. En bruger uden liga regnes som selvstarter, fordi A8-invarianten indmelder i ligaen i samme øjeblik, en invitation accepteres — ingen liga betyder derfor, at der aldrig blev accepteret en invitation. Tid til første tip er mærket som en ØVRE grænse: `predictions` har ingen `created_at`, kun `updated_at`, som flytter sig når et tip rettes. |
| 30. juli 2026 | **Push-effekten mærkes som korrelation og et loft, ikke som et estimat af effekten.** | De, der åbner notifikationer, er de engagerede i forvejen, så forskellen mellem de to grupper indeholder både pushets virkning og et udvalgsbias, der ikke kan skilles ad uden et eksperiment. Et push, der aldrig blev åbnet, kan desuden godt have virket — beskeden er synlig på låseskærmen, uden at linket trykkes. Tallet er stadig værd at have: det er første gang, produktets eneste aktive fastholdelses-værktøj kan vurderes på andet end om beskeden blev trykket på. Varsel før rundelås er med, fordi cron-tidspunktet er den eneste knap, der reelt kan drejes på. |
| 30. juli 2026 | **Story Engines regelkatalog bor i JS (`STORY_RULES`) med en drift-test, der læser `sql/story_engine.sql`.** Genereret/afvist (rigtige rækker) holdes adskilt fra vist/delt (hændelseslog) i svaret. | RPC'en kan per definition kun se regler, der HAR udløst — og det interessante spørgsmål er netop, hvilke der aldrig har. En regel, der aldrig udløser, er den dyreste slags død kode: den ser ud til at virke. Prisen for at duplikere katalogen er drift, og den betales af en test, der trækker regelnavnene ud af SQL-filen og fejler, hvis listerne ikke er ens. *(Skærpet august 2026: testen pegede på ét filnavn, så da v2 lagde dagsmotoren i en ny fil, blev den grøn på en udvidelse, den skulle have fanget — de syv dagsregler stod som UKENDT i tabellen. Den læser nu `sql/`-mappen. En drift-test, der hårdkoder sin egen kilde, har den samme fejl som den, den skal fange.)* De to kilder holdes adskilt, fordi deres pålidelighed er forskellig: en visningsrate under 100 % kan lige så godt være tabt logning som en historie, ingen så — mens `dismissed_at` er brugerens eneste AKTIVE afvisning og findes pr. række uden gulv-forbehold. |
| 30. juli 2026 | **A12 lukket ved at fjerne det, spørgsmålet handlede om: Liga Health Score (0-100) er væk.** Erstattet af **Liga-diagnose** — de målte signaler står hver for sig, og én navngiven tilstand pr. liga vælges af 12 regler oppefra og ned med en handling ved siden af. Nyt signal **bredde** (medlemmer der faktisk tipper ÷ medlemmer). Story views indgår ikke længere i bedømmelsen. | Scoren var **for bred**: de fire første rigtige ligaer fik 75/77/77/88 — alle grønne, alle "SUND". En metrik, der ikke kan skelne ligaer fra hinanden, kan heller ikke pege på den, der trænger til hjælp, og "77" er ikke en handling. Faktorerne overlappede desuden (aktive medlemmer, andel aktive og retention måler alle tre "kommer medlemmerne her"), så tre af fem vægte trak i samme streng, og deltagelse vejede reelt mindre end de 35 %, tallet lovede. Og vægte kan ikke kalibreres på fire ligaer — A12 spurgte hvornår, det rigtige svar var at fjerne behovet. Bredde er det, den gamle score manglede helt: "andel aktive medlemmer" målte, om folk *åbnede appen*, ikke om de *spillede*, så en liga hvor én tipper alt og fire kigger på, kunne score som en hvor alle fem tipper. Story views var 10 % af scoren — vægt til den nyeste og svageste instrumentering, den ikke havde fortjent. |
| 30. juli 2026 | **Diagnose-reglerne bor i JS (`LEAGUE_THRESHOLDS`/`diagnoseLeague` i `src/lib/analytics.js`), ikke i SQL.** RPC'en måler; klienten fortolker. | Samme valg som Onboarding v1's udledte tilstand. Reglerne er produktjudgement, der skal tunes ofte, og i JS kan de unit-testes — ingen CI kører SQL, så en tærskel i en `create or replace`-funktion kan kun efterprøves i hånden i Supabase. En ny tærskel kræver nu ikke længere en kørsel i produktion. Rækkefølgen er selve designet: **årsag før symptom** — en liga uden aktiv konkurrence skal høre "opret en konkurrence", ikke "for få tipper", som den ikke kan gøre noget ved. "For ny" står først, fordi en liga oprettet i går ellers ville blive stemplet "Død" — netop den fejl, den gamle scores null-sikre renormalisering fandtes for at undgå. |
| 30. juli 2026 | **Måle-ordbog: hvert nøgletal i Analytics forklarer hvad der måles, hvordan, fra hvilken kilde og hvad tallet IKKE kan bruges til** (`src/lib/analyticsMetrics.js`, 27 metrikker bag en ⓘ). | Et internt dashboard er kun værd at handle på, hvis man kan se, hvad et tal er. "Deadline Miss Rate: 12 %" kan betyde mindst tre forskellige ting, og forskellen afgør, om tallet er alarmerende eller ligegyldigt. Svarene fandtes allerede — men kun i SQL-kommentarerne, altså præcis dét sted, den der læser dashboardet, ikke kigger. Grænsen fra karriereprofilen gælder uændret: etiketten bærer omfanget ("seneste 7 dage", "alt tid"), ⓘ'en uddyber. Forbeholdet er det vigtigste felt: hændelses- og push-tallene er **gulve**, ikke facitter, fordi logningen er fire-and-forget og `notification_log` claimes før afsendelsen. |
| 30. juli 2026 | **Fire døde felter i Analytics taget i brug frem for slettet; to vinduesfejl og ét falsk 0 % rettet.** | Samme slags fund som karriereprofilens to døde felter (juli 2026): `completion_by_month`, `avg_seconds_multi`, `avg_events` og alle deadline-detaljetallene blev hentet ved hvert kald uden nogensinde at blive vist. De var ikke overflødige — de var netop de ærlige nuancer, spec'en havde bedt om ("så tallet kan læses ærligt"), og manglede kun en plads på skærmen. Vinduet: dag-granulære felter talte `today - p_days` (31 dage), mens tidsstempel-felter i samme svar talte 30, og en liga-kolonne hårdkodede 30 dage, selv når admin valgte 7 — et tal, der ikke holder sit eget løfte om sit omfang. Og completion-søjlerne tegnede en uge uden låste runder som 0 %, som ikke kan skelnes fra en uge, hvor ingen tippede — nøjagtig den falskhed, retention-sektionen omhyggeligt gråtoner væk. |
| Juli 2026 | **Analytics v1: kun Postgres (intet Google Analytics), ingen ny chart-dependency, udledte KPI'er (intet nyt cron), samlet levering — plus to navngivningsvalg fundet under implementeringen: event-kolonnen hedder `group_id` (ikke `league_id`, som allerede betyder en Sportmonks-turnering i dette skema), og `story_generated`/`push_sent` logges ikke som events, fordi de allerede findes bedre i `public.stories`/`public.notification_log`.** North Star-metrikken (Prediction Completion Rate) beregnes altid direkte fra `predictions`/`matches` via `analytics_completion_facts` — ALDRIG fra hændelsesloggen (`analytics_events`), som er fire-and-forget og derfor lossy by design. Deadline Miss Rate (og det udeladte `prediction_locked`-event) beregnes tilsvarende fra `analytics_round_locks`, en aggregeret omskrivning af den eksisterende rundelås — filen rører ALDRIG selve lock-policyerne. ~~Liga Health Score (0-100) er en v1-heuristik med fem navngivne, tunbare vægte (completion 35 %, retention 20 %, aktivitet 20 %, medlemmer 15 %, story views 10 %) og null-sikker renormalisering, så en ny liga uden nok historik scorer `null` ("For ny") i stedet for et misvisende 0.~~ **Rullet tilbage 30. juli 2026** — scoren er fjernet og erstattet af Liga-diagnose, se rækken øverst. Spec: [`features/analytics-v1.md`](./features/analytics-v1.md). | GA er bygget til marketing-tragte, ikke til domæne-KPI'er der kræver joins mod liga-/konkurrencedata — og ville sende brugerdata til en tredjepart for et rent internt formål uden modsvarende gevinst. Et nyt chart-bibliotek ville være appens første nogensinde (kun `lucide-react`+`web-push` i dag) for et dashboard, de eksisterende håndrullede `StatTile`/`MiniBars` allerede kan vise. Et nyt cron-job for `prediction_locked` ville lægge ny, tidskritisk logik tæt på den kritiske rundelås for information, der allerede kan udledes korrekt af eksisterende data. `group_id` frem for `league_id` er den samme disciplin, liga-laget (juli 2026) indførte: to ord, der betyder to forskellige ting, må aldrig genbruge samme kolonnenavn. |
| Juli 2026 | **Onboarding-tilstand udledes af data — ingen SQL-migrering.** `deriveOnboarding` læser ligaer, konkurrencer og ét `predictions`-opslag; `localStorage` bruges kun til det, der ikke kan udledes (sprunget over, kort skjult, færdig). | Migreringer køres i hånden i Supabase, så en ny kolonne koster et manuelt trin i produktion. Vigtigere: en udledt tilstand kan ikke drive fra virkeligheden — melder en bruger sig ud af sin sidste liga, siger checklisten det af sig selv, hvor et gemt flag ville lyve. Verificeret først, at RLS altid lader en bruger læse sine egne tips (også ulåste), så proben er sikker. |
| Juli 2026 | **Kold start = liga og konkurrence i ÉT trin.** Guiden opretter begge dele i én bekræftelse og lander brugeren på Tip. | En ny bruger skal ikke forstå forholdet mellem liga og konkurrence, *før* de har prøvet det. Alternativet — konkurrence først, liga senere — ville producere liga-løse konkurrencer, netop den overgangstilstand liga-laget handlede om at komme væk fra. Rækkefølgen `createGroup` → deltager-insert er bindende: A8-triggeren indsætter med `on conflict do nothing`, så omvendt ville opretteren ende som `member` i stedet for `admin`. |
| Juli 2026 | **`createCompetition` og `joinByInviteCode` udtrukket til `data.js`, før guiden blev bygget.** | To kopier af den samme skrivning er præcis, hvad A7 kostede, da kun den ene huskede liga-medlemskabet. Logikken flyttede derfor, *før* der kom et tredje kaldested. Udtrækket lukkede samtidig en latent fejl: `LigaerTab` tjekkede ikke eksisterende deltagelse, så gen-indsættelse af en kode kastede en rå PK-konflikt ud — deep-link-vejen tjekkede. |
| Juli 2026 | **PWA-installationsmodalen flyttet fra første login til efter første tip.** | Den lå som det allerførste, en ny bruger mødte: en opfordring til at installere en app, de endnu ikke vidste hvad var. Nu rammer den, når de har en grund til at beholde den. `pc_pwa_onboarded` er uændret, så eksisterende brugere ikke får den igen. |
| Juli 2026 | **Opret-konkurrence defaulter nu til brugerens første liga i stedet for "Ingen liga".** Adfærdsændring for eksisterende brugere; "Ingen liga" findes stadig som et bevidst valg. | En konkurrence oprettet uden at røre feltet blev tavst liga-løs: ingen medlemsliste, intet permanent invite-link, og intet der består, når sæsonen slutter. Standardvalget skal være det, produktet er bygget på. Kontrol efter udrulning: `select count(*) from competitions where group_id is null and created_at > <udrulning>` skal være 0. |
| Juli 2026 | **Story Engine må kun nævne folk, man deler konkurrence med (bugfix + ny designregel).** Brugerrapport med skærmbilleder: "min viser 2 point op til Bang i Superliga Grundspil, men Bang er ikke med i den". `generate_stories` byggede konkurrencens stilling (`_se_rp`) af `competition_matches → matches → predictions` **uden** join til `competition_participants` — og `predictions` er global pr. `(bruger, kamp)`. Enhver, der havde tippet den samme kamp i en anden konkurrence, indgik derfor i denne konkurrences stilling; to konkurrencer på samme turnering deler alle deres kampe, så det var reglen, ikke undtagelsen. **Fejlen er fra v1**, men var usynlig, indtil v1.1's `CLOSING_IN` begyndte at nævne føreren ved navn. Konsekvenserne var større end symptomet: en fremmed kunne stå som rundens vinder i en konkurrence, vedkommende ikke deltager i (og modtage historien), rangnumre kunne overstige `league_size` ("nr. 9 af 8"), og alle afstande blev målt mod en stilling, brugeren ikke kan se noget sted i appen. Rettet med ét join i `_se_rp`. **Ny ufravigelig designregel:** en historie må kun nævne personer, modtageren deler konkurrence med — sikret strukturelt, ved at alle fire navngivende regler (21, 40, 45, 60) henter personen fra `_se_*`-tabellerne. Verificeret mod PostgreSQL 16: symptomet reproduceret og fjernet, plus en regressionskørsel med to fremmede i en parallel konkurrence, der tipper alt præcist — dækning fortsat 8 af 8 pr. runde, ingen fremmed nævnt eller ramt, ingen rang over `league_size`, backfill fortsat idempotent. Engangsopsætning: gen-kør `sql/story_engine.sql` og derefter `sql/story_engine_backfill.sql`. Spec: [`features/story-engine-v1.md`](./features/story-engine-v1.md) afsnit 11. | **Hvorfor det er en datamodel-fejl og ikke en tekstfejl:** `predictions` har ingen konkurrence-dimension, så "hvem er med i denne konkurrence" *skal* komme fra `competition_participants`. Appens egen stilling (`computeCompetitionState`) har altid gjort det rigtige — det var kun Story Engine, der udledte deltagerkredsen af, hvem der tilfældigvis havde tippet kampen. Det er samme klasse af fejl som i tiebreaker-leverancen: to steder i produktet svarede forskelligt på samme spørgsmål, og det ene sted var det, brugeren kunne se. **Hvorfor reglen skrives ned frem for bare at rette fejlen:** brugerens formulering er et produktkrav, ikke en fejlrapport — "hvis brugere nævnes skal det kun være dem jeg er i lokale ligaer og konkurrencer med". En regel, der kun findes som et join, bliver glemt af den næste regel, nogen tilføjer; en regel, der står i spec'en med en anvisning ("navnet skal komme fra `_se_*`"), kan følges. **Hvorfor backfill skal køres igen:** de historier, der allerede var genereret, er beregnet på den forkerte stilling — de bliver ikke rigtige af, at funktionen nu er det. |
| Juli 2026 | **Story Engine v1.1: A3 og A4 lukket — flere historier, og et dæmpet kort når intet andet er i spil.** Brugerrapport efter den første runde, motoren rent faktisk kørte: "efter første runde har stort set ingen fået en story". Reproduceret mod en rigtig PostgreSQL 16 med produktionsskemaet og 8 spillere over 3 runder: **1 af 8** fik et kort i premiereugen — og teksten var den forkerte "🏆 Du overtog førstepladsen", fordi regel 20 udløses på `coalesce(før-placering, 999) > 1`, når der ingen "før" er. Årsagen er strukturel: reglerne 20/21/40/50/60 læser alle på stillingen **før** runden (findes ikke i en konkurrences første runde), 30 kræver ≥5 runder, og 10 kræver et månedsskifte — tilbage stod kun rundens vinder og ≥3 præcise. **Tre svar:** (1) **tre nye regler**, hvoraf to virker uden historik — 22 `PODIUM_ENTER` (ind i top 3; comeback måler bevægelse og misser 4.→3.), 45 `CLOSING_IN` (1–3 point op til føringen, afstanden ikke vokset) og 55 `PERSONAL_BEST` (egen runderekord, sammenligner kun brugeren med brugeren selv). (2) **A4: tærskler sænket med dynamisk prioritet** — comeback ≥3→≥2 pladser (og ≥5→≥4 deltagere), stime ≥3→≥2 sejre, præcise ≥3→≥2; men den svage variant får prioritet 75/85, altså **under** rundens vinder (70). (3) **A3: dæmpet tier** — 90 `SEASON_OPENER` (premiereugen) og 100 `QUIET_ROUND`, som **kun** genereres for brugere, der ellers ville stå helt uden en række. Renderes uden guldkant, uden emoji og uden Del-knap; nævner kun placeringen i tabellens øverste halvdel. Regel 20 kræver nu, at konkurrencen har en runde før denne, og de laterale "hvem fører"-opslag er gjort deterministiske (delt føring kunne ellers nævne hver sin rival ved to gen-kørsler). Karriereprofilens milepæle henter kun `priority < 90`. **Verificeret mod PostgreSQL 16:** dækning 1/6/5 → **8/8/8** af 8 brugere over tre runder, 13 af 14 regler udløst, md5-identiske rækker ved gen-kørsel (idempotens), præcis én `latest_story` pr. `(user_id, round_key)`, ingen bruger med både dæmpet og rigtigt kort, og historier skabt ad **triggerstien**. 15 nye tests (140 i alt). Engangsopsætning: gen-kør `sql/story_engine.sql` ("Run without RLS"); triggeren er uændret. Spec: [`features/story-engine-v1.md`](./features/story-engine-v1.md) afsnit 10. | **Princippet, der bærer hele leverancen:** *tærsklen afgør, om historien findes; prioriteten afgør, om den vises.* Bare at sænke tærsklerne ville have løst dækningen ved at fortynde de store øjeblikke — "2. sejr i træk mod Jimmy" ville have fortrængt "du vandt runden". Med en svag variant på prioritet 75 stiger dækningen, uden at noget stort nogensinde taber til noget lille. **Hvorfor A3 lukkes modsat v1-udkastet:** produktbogens kapitel 6 beder faktisk Story Engine om at turde sige *"Status quo."* — v1 læste det som "intet kort", men de rigtige data viste, at "intet kort" i praksis betød *intet kort for næsten alle*, og en motor, ingen kan se, er ikke stilhed som funktion, den er fravær. Det dæmpede kort siger status quo **og** ser stille ud; forskellen på de to tiers er kodet i renderingen, ikke kun i teksten, så et stille kort aldrig kan forveksles med en sejr. **Hvorfor tonereglen er kodet, ikke beskrevet:** et kort, der genereres til *alle*, rammer også bunden af tabellen — derfor nævnes placeringen kun i øverste halvdel, og designreglen "historier driller, men ydmyger aldrig" er dækket af en enhedstest frem for en hensigt. **Hvorfor milepælene filtreres:** dæmpede kort er per definition ikke minder; kom de med i karriereprofilen, blev arkivet en rundelog med de ægte øjeblikke gemt inde i. |
| Juli 2026 | **Rundelåsen håndhæves nu også for SKRIVNING — og dokumentation, app-tekst og kode er bragt i overensstemmelse.** En gennemgang af al dokumentation, al SQL og al brugervendt tekst mod koden. **Vigtigst:** `sql/predictions_round_lock_policies.sql` lagde låsen på SELECT og DELETE og bad i sin egen slutkommentar om to trin i hånden bagefter — drop den gamle SELECT-policy, og læg samme regel på INSERT/UPDATE. Ingen af dem var udført, så `"insert own predictions"`/`"update own predictions"` krævede kun `user_id = auth.uid()`: for skrivninger fandtes låsen kun i frontenden, og et tip kunne stadig POST'es/PATCH'es via PostgREST efter runden var låst. Ny `sql/predictions_write_lock.sql`. **Kodefejl, hvor koden modsagde sin egen dokumenterede regel:** Ligaer-kortets "din plads" var listeindeks og ikke `rank` (to ægte lige spillere blev vist som 2. og 3.), vinderen var `rows[0]` (delt titel nævnte kun den ene), Hjem viste "Alt ok — alle tips er inde", når der bare ikke var noget *tipbart* (en bruger med nul tips fik grønt kort), tilstandene `noMatches`/`error` gav slet intet kort, og runde-overlayet skrev "+0" hvor `PointsPill` skriver "0". **Tekst rettet 9 steder** (framelding, rullende vindue, `Slut`-mærket, NY/`*`, bøjningsfejl i Superliga-teksten, admin-tomtilstand, Tip-tomtilstand, rivaltallet, træfsikkerhed). **Konsistens:** én fælles `modeLabel` (navnene stod fire steder i tre varianter), ensartet "adgangskode" og "Deltag". 10 nye tests (125 i alt). Engangsopsætning: kør `sql/predictions_write_lock.sql` ("Run without RLS"). | **Låsen er produktets kerneløfte** — "alle tipper på samme vidensgrundlag" — og A8 havde lige demonstreret, at en regel, der kun findes i klienten, ikke er en regel. At det gamle script selv havde skrevet de manglende trin ned og de alligevel ikke blev udført, er argumentet for at skrive migreringen frem for at notere hullet igen. **Hvorfor teksten ikke altid var den forkerte part:** gennemgangen skulle sikre, at tekst matcher kode, men i fem tilfælde var det koden, der brød en regel, dokumentationen allerede beskrev — fx "placeringen er rækkens `rank`, ALDRIG listeindekset". Så var rettelsen af koden den ærlige, ikke at skrive teksten om efter fejlen. **Hvorfor dokumentationen var drevet så langt:** `CLAUDE.md` krævede kun opdatering af ROADMAP ved levering, ikke af den relevante spec i `docs/features/` — derfor stod tre specs og beskrev adfærd, der var rullet tilbage eller udvidet. Kravet er tilføjet. |
| Juli 2026 | **Brugerflade-leverancer #38–#53 ført ind i changeloggen (backfill).** Profil-ikon i topbjælken (#38), kompaktering af Hjem + Championship (#40–#42), kompaktering af Tip-skærmen inkl. blød grøn til +1 (#44), stillingstabeller inden for én telefonbredde (#45/#46), navne-klik → karriere overalt + K1 udvidet (#47), hele stillingsrækken som tryk-flade (#48), andres tips fra rundens lås (#49), forudsigelses-overlayet tilpasset telefonbredde (#50), rating-teksten rettet til faktisk adfærd (#51), låst runde som tabel (#52) og fire-trins tiebreaker med delt placering (#53). | Indholdet stod i DOCUMENTATION.md's afsnit, men ingen af dem fik en changelog-post, så filens egen historik sprang fra #37 til #54. En changelog, der mangler ti leverancer, kan ikke bruges til at svare på "hvornår ændrede den adfærd sig". |
| Juli 2026 | **A8 flyttet fra klienten til databasen: ingen kan være deltager i en liga-konkurrence uden at være liga-medlem.** Brugerkrav efter A7: "der bør ikke være nogen, der kun er medlem af en konkurrence — det bør være fixet i databasen." Kortlægningen fandt tre veje til den forældreløse tilstand, ikke én: (1) eksisterende rækker fra før A7-rettelsen, (2) alle indsættelses-stier (også `CreateCompetitionScreen`, som indsætter opretteren direkte), og (3) **"forlad liga"**, som kun slettede `group_members`-rækken og dermed skabte forældreløse deltagere *efter* at alt var gået rigtigt til. Ny `sql/group_membership_invariant.sql`: backfill + `before insert`-trigger, der auto-indmelder (`security definer`), + DELETE-policy, der blokerer liga-exit, mens man deltager i ligaens konkurrencer. **Undervejs afdækkedes en fejl i den eksisterende framelding-spærre:** `comp_participants_delete_own_unlocked` blokerede, hvis man havde tips på låste kampe — men en spillet kamp bliver aldrig uspillet, så spærren var permanent, ikke "midt i et forløb" som dens egen begrundelse sagde. Sammen med den nye liga-spærre ville enhver, der havde spillet én runde, være låst til ligaen for evigt, og da admin-fjernelse af andre medlemmer bevidst ikke er bygget, var der ingen vej ud. Policyen tillader nu framelding, når alle konkurrencens kampe har resultat. Verificeret mod en rigtig PostgreSQL 16 under ægte RLS. Engangsopsætning: kør scriptet ("Run without RLS"). | **Hvorfor databasen og ikke klienten:** en regel, der kun findes i frontenden, skal huskes af hver ny kaldesti — og A7 viste præcis den fejl, hvor to veje ind i samme konkurrence opførte sig forskelligt. Klienten gør det stadig eksplicit, så bekræftelsen kan sige det til brugeren; triggeren er sikkerhedsnettet, ikke forklaringen. **Auto-indmelding frem for afvisning,** fordi A8 siger, at deltagelse i en liga-konkurrence *er* liga-medlemskab: én handling, ikke en betingelse — så kan ingen kaldesti glemme rækkefølgen. **Blokering frem for automatisk framelding ved liga-exit:** en automatisk framelding ville enten omgå historik-beskyttelsen eller lykkes kun delvist og dermed genskabe den forældreløse tilstand; en blokering bevarer begge regler og kan forklares i én sætning. Nettoreglen er nu forklarlig: mens en konkurrence kører, er man bundet til ligaen; når dens kampe er spillet, kan man melde sig ud af begge. |
| 31. juli 2026 | **A2 afløst: Championship kårer nu på to niveauer — samlet og pr. turnering.** `round_standings` og `monthly_standings` får en `scope`-dimension: `'ALL'` = alle **officielle** turneringer samlet og bærer titlen **"Rundens/Månedens Champion"**; `<league_id>` = én stilling pr. turnering med kåringen **"Rundens/Månedens bedste i X"**. Ny kolonne **`leagues.is_official`** (adskilt fra `is_visible`, med check-constraint `is_official ⇒ is_visible`) afgør, hvad der overhovedet fodrer Championship. Scotland Premiership sat `is_official = false`. Per-turnering-kåringer tæller som karrieretitler, men **vises adskilt** (K2, ikke bygget endnu). Migrering: `sql/tournament_scope.sql`. | **A2 blev truffet om en situation, der ikke fandtes endnu.** Spørgsmålet blev stillet i juli 2026, da der var én turnering, og svaret ("månedschampionshippet må gerne belønne deltagelse; ratingen dækker præcision") kunne hverken efterprøves eller mærkes. Da turnering #2 kom i drift, viste konsekvensen sig: stillingerne joiner kun `predictions ↔ matches`, så de summerer alt, brugeren har tippet — og hvad man tipper afgøres af, hvilke **frivillige** konkurrencer man er med i. To brugere måles dermed på forskellige kampmængder (~12 kampe og et loft på 36 point mod ~6 og 18), og **de eneste konkurrencer, ingen selv har valgt, blev afgjort af valg truffet andre steder.** Produktbogen trækker selv i to retninger her: *"alle ugens kampe samles i én fælles spillerunde"* over for *"Leagly tvinger ingen til at deltage… hvert medlem vælger selv, hvilke konkurrencer"* (begge kapitel 4). To niveauer honorerer begge: det samlede belønner stadig bredde — men nu som en **udtalt regel med et navn** frem for en skjult skævhed — og per-turnering-stillingen er den, hvor alle ér målt på de samme kampe. **Navnet bærer rangordenen:** kun det samlede hedder "Champion", så hierarkiet ikke kræver en forklaring. **`is_official` frem for at lade synlighed afgøre det:** en turnering skal kunne være tipbar uden at ændre, hvad en titel betyder — ellers ændrer enhver ny turnering kåringernes værdi i samme øjeblik, den tændes. **Fravalgt:** point pr. kamp (snit) som kåring — det ville duplikere ratingen og gøre "point" til et decimaltal; og at lade Championship være én turnering alene — det ville gøre alle andre turneringer til andenrangs for altid. Verificeret mod PostgreSQL 16.13. |
| Juli 2026 | **A7 lukket: konkurrence-invite-links udfases IKKE — de bliver, og man kan nu invitere direkte til både en konkurrence og en liga.** Det oprindelige spørgsmål ("hvornår udfases de helt?") er dermed besvaret med "aldrig": de to link-typer inviterer til hver sin ting og er begge nødvendige. **Stedet afgør:** Invitér-knappen på en konkurrences side deler altid konkurrence-linket (`?join=`), knappen på liga-siden altid liga-linket (`?liga=`). Knapperne fandtes i forvejen begge steder, men konkurrence-sidens knap **erstattede stiltiende konkurrence-linket med liga-linket**, når konkurrencen lå i en liga (`BoardScreen.jsx`) — så man kunne slet ikke invitere til én bestemt liga-konkurrence. Substitutionen er fjernet. **Undervejs blev A8 fundet uimplementeret på deep-link-stien:** A8 (juli 2026) siger, at join via konkurrence-link melder én ind i både konkurrence og liga, men `MainApp.confirmJoin` indsatte kun en `competition_participants`-række, og INSERT-policyen `"join competition"` kræver kun `user_id = auth.uid()`. Den indsatte kode i `LigaerTab.joinByCode` gjorde det rigtige (`if (comp.group_id) await joinGroup(...)`) — kun link-stien manglede det. Rettet, med liga-medlemskabet først, så en fejl ikke efterlader en halv tilstand; bekræftelses-modalen siger nu højt, at man også bliver liga-medlem. Modalen kaldte desuden konkurrencen "ligaen" (arvet fra før liga-lagets ordbog) — rettet til "konkurrencen". | Fejlen var latent præcis så længe, linket var skjult: en deltager uden liga-medlemskab ville stå i konkurrencens stilling, men mangle på ligaens medlemsliste og ikke kunne åbne ligaen. At vise linket uden at lukke hullet ville have gjort en usynlig inkonsistens synlig for brugerne. **Hvorfor "stedet afgør" frem for et valg ved tryk:** knappen på en side gør det, siden handler om — intet ekstra trin, intet nyt UI, og ingen ekstra bredde i en række, hvor bredde har været problemet fem gange (#45, #46, #50, #52). Konkurrence-linket er samtidig det stærkeste af de to, fordi det melder ind i begge; liga-linket bevarer den mulighed at invitere til fællesskabet uden at skubbe nogen ind i én bestemt konkurrence. |
| Juli 2026 | ~~**A1 lukket: navnevalget er afgjort.**~~ **OPHÆVET 4. august 2026 — se øverst i loggen.** Arbejdstitlen "Prediction Hub" blev droppet til fordel for det navn, appen bar dengang, og `docs/PRODUCT_BOOK.md` blev omskrevet (46 forekomster), så bog og app sagde det samme. Afvigelsen under "Kendte afvigelser" blev lukket. *(Hele loggen er skrevet om til **Leagly** ved navneskiftet; det navn, A1 valgte, står derfor ikke længere nogen steder.)* | Appen, PWA-manifestet, delingsteksterne og alt, brugerne allerede havde på hjemskærmen, sagde ét navn — bogen var det eneste sted, "Hub" stod tilbage. **Begrundelsen var, at prisen ved at skifte navn stiger med hver ny bruger (domæne, ikoner, push), og at der ikke var nogen grund til at betale den.** Den holdt lige indtil grunden dukkede op udefra: navnet viste sig at være i brug af en lignende app. Regnestykket var rigtigt — det var kun forudsætningen om, at valget var vores alene, der ikke var det. |
| Juli 2026 | **A9 lukket: Story Engine rettet og tændt for alvor.** Diagnosen holdt — og der var **to** fejl, ikke én. `matches.round_key` er en genereret `date`-kolonne, mens både `generate_stories(p_round_key text)` og matches-triggerens eget rundeopslag sammenlignede den med `text`. Triggeren fejlede **først** (`m.round_key = v_round` i `rating_trigger_optimization.sql`), altså før `generate_stories` overhovedet blev kaldt; at rette funktionen alene ville derfor ikke have hjulpet. Begge er rettet ved at give hver side dens rigtige type frem for at strø casts: `generate_stories` konverterer parameteren én gang til `v_round date` og bruger den mod date-kolonnerne (`matches`, `round_standings`, `_se_rp`, `_se_pair`), mens `p_round_key` bruges mod `stories`/`rating_history`, som er `text`; triggerens temp-tabel og loop-variabel er nu `date` med eksplicit `::text` ved kaldet. Guardens `raise notice` er hævet til `raise warning`. **Verificeret mod en rigtig PostgreSQL 16** med produktionsskemaet indlæst (`sql/schema.sql` + `sql/standings_tiebreakers.sql`) og et 6-spillers datasæt over 4 runder: gammel kode → 0 historier + `NOTICE: … operator does not exist: date = text`; ny kode → historier genereret ad **triggerstien** (ROUND_WON, LEAD_TAKEN/LOST, STREAK, H2H_PASS, SHARP, MONTH_CHAMP), idempotent ved gentagen kørsel, og præcis én `latest_story` pr. `(user_id, round_key)`. Engangsopsætning: gen-kør **begge** scripts i Supabase ("Run without RLS"). | Symptomet var usynligt by design: et tomt historie-kort kan ikke skelnes fra en stille uge, og "stilhed er også en funktion" gjorde tavsheden til forventet adfærd. Derfor er `warning` frem for `notice` en del af rettelsen — guarden skal fortsat beskytte resultat-lagring og rating mod en historik-fejl, men fejlen må ikke igen forsvinde sporløst (`notice` når ikke Postgres-loggen som standard; `warning` gør). At give kolonnerne deres rigtige type frem for at caste ved hvert kaldested betyder, at næste tilføjede regel ikke kan genindføre fejlen ét sted, man glemte. **Konsekvens, som var hele grunden til at holde den ude af tiebreaker-leverancen:** historie-kortet begynder nu at dukke op på Hjem for alle brugere, med A4-tærsklerne (comeback ≥3, stime ≥3) stadig ukalibrerede — det er nu, kalibreringen kan begynde, fordi der endelig kommer data. |
| Juli 2026 | **Tiebreaker-stigen udvidet til fire trin og samlet ét sted; ægte lighed vises som delt placering og delt titel.** Brugerspørgsmål: "hvordan afgøres stillingen, hvis nogen står lige?" Undersøgelsen fandt tre problemer bag ét: (1) den **lovede** tiebreak var kun halvt implementeret — `DOCUMENTATION.md` og "Sådan virker det" lovede "flest præcise, dernæst flest korrekte udfald", men kun konkurrence-stillingen havde trin 2; rundechampionship, månedschampionship og sæsonchampionship stoppede ved `exact_count`, fordi deres views ikke havde kolonnen; (2) der var **ingen endelig, deterministisk nøgle** — efter point + præcise faldt rækkefølgen tilbage på Postgres' vilkårlige rækkefølge, så to lige spillere kunne bytte plads mellem to genindlæsninger; (3) placeringen var **listeindeks** (`i + 1`) alle syv steder, så to reelt lige spillere blev vist som "3." og "4." — mens Story Engine og karriereprofilen brugte ægte `rank()` med delte placeringer, så tabellen og historien kunne sige to forskellige ting om samme runde. **Ny stige, ens overalt:** point → flest præcise → flest korrekte udfald → **flest rundesejre** → **mindst målafvigelse pr. tippet kamp**. Derefter er spillerne ægte lige: delt placering (to delte 2'ere ⇒ næste er nr. 4) og delt titel ("delt Månedens Champion"); `user_id` sorteres til sidst som skjult, stabil nøgle, der aldrig afgør noget. Stigen bor ét sted (`src/lib/standings.js`) og spejles i SQL (`sql/standings_tiebreakers.sql` + gen-kørsel af `story_engine.sql`/`career_profile.sql`). | **Rækkefølgen er et valg:** målafvigelsen er så finkornet, at den ville afgøre stort set alt og gøre rundesejre til død kompleksitet — derfor ligger rundesejre før. Rundesejre er samtidig det mest forklarlige kriterium ("flest gode uger"). **Målafvigelsen er et gennemsnit, ikke en sum:** en sum ville straffe den, der tipper flest kampe, hvilket strider mod A2 ("månedschampionshippet må gerne belønne deltagelse"); gennemsnittet normaliserer deltagelsesomfang som ratingen allerede gør. Der afrundes til 4 decimaler, så SQL og JS er enige om, hvornår to tal er lige. **Delt frem for skjult brud:** en afgørelse, brugeren ikke kan forklare, er værre end en delt titel — og en delt titel er i sig selv en historie. **Fravalgt:** head-to-head (i et tippespil betyder "indbyrdes" reelt "hvem fik flest point i de runder, begge deltog i" — næsten samme tal som totalen; head-to-head bliver i Story Engine, regel 40/60) og rating som tiebreak (lader en præstation uden for konkurrencen afgøre konkurrencen). Verificeret mod en rigtig Postgres med produktionsskemaet indlæst: viewenes tal, delte rundesejre, `null`-sæson og idempotens — og JS gav de samme tal på samme datasæt. |
| Juli 2026 | **Tip-skærmens låste runde gjort til en tabel (opfølgning på #44).** Brugeren meldte skærmen fortsat for rodet på den igangværende runde, og pegede på to ting: (1) de tre talgrupper (`1-1` eget gæt · `1-0` facit · `0` point) stod uden overskrifter, så man skulle kende koden for at læse rækken, og (2) alle seks kampe fik en linje 2, fordi "Alles gæt" og "Slut" altid boede dér. Rammen for løsningen var brugerens egen: **intet måtte gemmes bag et tryk** — gevinsten skulle komme af omarrangering. Tre alternativer blev tegnet som mockup (tabel / `gæt → facit`-udtryk / maksimal tæthed med ugedag i tidskolonnen); **tabellen blev valgt.** Leveret: ét kolonnehoved (`Gæt · Facit · P`) pr. låst runde, én linje pr. kamp i et fast grid, tilstanden (`Slut` / prik + minut / `Pause`) flyttet ind i tid-kolonnen, **hele rækken gjort til tryk-fladen** for alles gæt (rigtig `<button>`, ~340 × 42 px, guldfarvet chevron som tegn, `.tiprow`-hover/active i `theme.js`) og forklaringslinjen "Tryk på en kamp for at se alles gæt" ÉN gang i rundehovedet — samme greb som under stillingstabellen i `BoardScreen`. Holdnavnene sat i `font.display` (Barlow Condensed, ~25 % smallere) med en `useLayoutEffect`-måler, der falder 15 → 13,5 → 12,5 px og først derefter ombryder; **aldrig trunkering.** Åben runde er urørt (den skal rumme indtastningsfelter). Kortets højde for en 6-kamps runde: **694 → 478 px (−31 %)**. `MatchRow`/`RoundHeader`/`TeamNames` er nu navngivne eksporter og har fået skærmens første test (`PredictionsScreen.test.jsx`, 8 cases). | Brugerrapport: "jeg synes stadig tipsskærmen er for rodet på den igangværende runde." #44 fjernede højde, men lod tvetydigheden stå: tre nøgne tal ved siden af hinanden er ikke enklere, fordi de fylder mindre. Kolonneoverskrifter er den billigste måde at gøre et tal entydigt på, og de taler samme sprog som stillingstabellerne. **Bredden blev målt, ikke skønnet** (fjerde gang bredde er problemet, jf. #45/#46/#50): den rigtige komponent blev renderet i Chromium ved 320/360/375/390/430 px. Undervejs viste den første måling langt flere ombrydninger end mockup'en — årsagen var, at containerens browser ikke kan nå Google Fonts, så der blev målt mod en ~25 % bredere fallback-skrift. Med den ægte skrift indlejret: **fra 375 px og opefter står alle kampe på én linje**, også `Lyngby Boldklub – FC Nordsjælland`; ved 360 px ombryder de to længste par. Lærdommen er skrevet ind i DOCUMENTATION: en bredde-måling uden den rigtige skrift er ugyldig. |
| Juli 2026 | **Forudsigelses-overlayet tilpasset telefonbredde.** `UserRoundPredictions` var en flex-række med fire faste kolonner **plus ordet "facit" inde i hver række** — tilsammen 331 px indhold, hvilket kræver vandret scroll på 320 og 360 px viewports (målt i Chromium; ved 390 px og derover passede det, hvilket er grunden til, at det ikke var opdaget før). Rækken er nu et grid (`predCols`) med holdnavnet som eneste elastiske kolonne (`minWidth: 0` + ellipsis) og faste 38+38+36 px til Gæt/Facit/Point. Ordet "facit" er flyttet ud som **kolonne-labels øverst**, der flugter med tallene — det sparer ~38 px og gør de to tal-kolonner tydeligere end det indskudte ord gjorde. Kortets `maxWidth` følger nu appens telefonramme (430 i stedet for 460), `overflowX` er låst, og spillernavnet i hovedet trunkeres. Målt efter rettelsen: passer ved 320/360/390/430 px uden vandret scroll. | Brugerrapport: "når jeg åbner fylder det mere end en side i bredden, så jeg skal scrolle." Tredje gang i træk, at netop bredde er problemet (jf. #45/#46) — derfor blev rettelsen denne gang **målt** i en rigtig browser før levering, ved at rendere komponenten med `react-dom/server` og læse `scrollWidth` mod `clientWidth` ved fire telefonbredder, frem for at skønnes ud fra koden. |
| Juli 2026 | **Stillingens drill-in til andres tips gjort tilgængelig igen (opfølgning).** To fejl gjorde "se en spillers tips runde for runde" utilgængelig i `BoardScreen`. (1) **For lille tryk-flade:** klikket lå på pointtallet, som sidder i en 46 px-kolonne med 3 px lodret padding — ca. 30×22 px mod de ~44 px, en finger kræver — og `cursor: pointer` er usynligt på touch. Hele rækken er nu tryk-fladen; navnet ligger ovenpå og stopper propagationen (`PlayerName`), så det stadig fører til karrieren. Layoutet er urørt, hvilket er vigtigt for en tabel, der to gange er rettet til for at holde sig inden for én skærmbredde. (2) **Forkert betingelse:** en runde kunne kun åbnes, hvis *hver eneste* kamp i den havde et resultat. Brugeren bekræftede, at der ikke fandtes én eneste færdigspillet runde — så drill-in'et var utilgængeligt overalt, uden at noget forklarede hvorfor. **Ny regel (besluttet efter brugerønske): tips vises fra rundens LÅS**, dvs. 1 time før rundens tidligste kickoff — fra det tidspunkt kan ingen rette sit gæt, så der er intet at beskytte, og det er præcis samme regel, som "Alles gæt" på Tip-skærmen allerede brugte (`canExpand = locked`). Et resultat er ikke længere et krav: en låst, endnu ikke spillet kamp viser gættet med "–" som facit og ingen point. Reglen bor nu i `scoring.js` som `lockedRoundsOf(rounds)` med egne tests — den beskærer hver runde til dens låste kampe, fordi låsen er scopet på `(season_id, round_key)`, og en runde kan rumme to turneringer med hver sin låsetid; et gæt kan derfor aldrig ses før dets egen deadline. Forklaringslinjen under tabellen siger nu altid, hvad der kan trykkes på — også før første lås. | Brugerrapport: "det virker ikke at kunne trykke på point for at se andres gæt" — to gange, også efter første rettelse, og derefter "der er ingen færdigspillede runder, men man skal kunne se så snart en runde låser". Begge årsager er den samme slags fejl: en affordance, der teknisk virker, men i praksis ikke kan nås, og som fejler tavst i stedet for at forklare sig. Låsen er desuden den rigtige grænse — den er i forvejen produktets definition af "nu er tipsene endelige". |
| Juli 2026 | **Brugernavne er nu vejen til karrieren — overalt (bugfix + K1 udvidet).** Karriereskærmen kunne allerede vise andres profiler, men `openProfile` blev kun sendt til `HjemTab` og `RatingTab`: navne i liga-medlemslisten, konkurrence-stillingen, Championship-tabellerne og "Alles gæt" var ren tekst, så en bruger ikke kunne nå karrieren for folk, de deler liga med. Alle navne er nu klikbare via én fælles komponent `PlayerName` (`ui/components.jsx`) — samme udseende, tastaturadgang som rigtig `<button>`, "(dig)"-suffiks og `stopPropagation` for de navne, der bor i klikbare kort. Dækker Hjem ("Hej *navn*"), Rating, konkurrence-stillingen + "Point pr. runde"-overskrifterne, Championship (top 5, fuld stilling og de tre kåringer), liga-medlemslisten, "Alles gæt", vinderen på et afsluttet konkurrence-kort og navnet i runde-tips-overlayet. **I `BoardScreen` er navnets klik flyttet:** navnet er personen (→ karriere), mens **hele rækken** åbner spillerens tips runde for runde (som før også nåeligt fra "Point pr. runde"-cellerne). Rækken blev valgt efter en brugerrapport om, at det første forsøg — kun pointtallet — ikke kunne rammes: pillen sidder i en 46 px-kolonne med 3 px lodret padding, altså ca. 30×22 px mod de ~44 px en finger kræver, og `cursor: pointer` er usynligt på touch. Rækken er et stort mål uden layout-ændring og genbruger mønsteret fra `LigaerTab`/`GroupScreen`, hvor hele kortet er tryk-fladen; `PlayerName`s `stopPropagation` er netop til det tilfælde. **K1 udvidet:** `career_profile` kræver nu kun, at man er logget ind — den gamle delt-liga/konkurrence-gate afviste folk, man reelt konkurrerer med (på Championship er alle automatisk med), og beskyttede intet, der ikke allerede stod offentligt på Rating-/Championship-fanerne. Milepæle og rivaler er uændret private (kun egen profil). Engangsopsætningen (`sql/career_profile.sql` kørt igen med "Run without RLS") er gennemført i produktion. | Brugerrapport: "Jeg kan ikke se andres karrierer, selvom jeg er i liga/konkurrencer med dem — et tryk på et brugernavn skal åbne karrieren." Ét navn = ét sted at trykke er både det, brugeren beder om, og det, spec'ens afsnit 3 lagde op til; at samle det i én komponent gør, at et navn ikke kan opføre sig forskelligt fra skærm til skærm. |
| Juli 2026 | **BoardScreens "Stilling"-tabel tilpasset telefonbredde (opfølgning).** Den forrige rettelse dækkede kun `ChampionshipTab.jsx`, men brugerens skærmbillede viste, at det faktisk var konkurrence-siden `BoardScreen.jsx` ("Stilling" nået via Ligaer → en konkurrence), der stadig krævede vandret scroll — den har sin egen tabel med 6 kolonner (#, Spiller, Rating, 🎯, Form, Point) og var ikke rettet. Samme løsning anvendt her: `table-layout: fixed` med `colgroup` (smalle faste bredder til #, Rating, 🎯, Form, Point; Spiller får resten og trunkeres med ellipsis). "Point pr. runde"-tabellen længere nede (én kolonne pr. spiller) er bevidst urørt — den har reelt brug for vandret scroll ved mange deltagere. | Brugerrapport med skærmbillede efter forrige "løsning": stillingstabellen fyldte stadig mere end en skærmbredde. Root cause var, at fejlrapporten pegede på en anden skærm end den først rettede. |
| Juli 2026 | **Championship-stillingstabellen tilpasset telefonbredde.** `StandingsTable` (Rundechampionship/Månedschampionship/Sæsonchampionship i `ChampionshipTab.jsx`) brugte tabellens standard-padding (8px pr. celle) på alle 5 kolonner uden fast layout, så bredden let overskred telefonens 430px og krævede vandret scroll. Tabellen har nu `table-layout: fixed` med en `colgroup` (#, Rating, 🎯 og Point som smalle faste kolonner; Spiller får den resterende plads), strammet padding på de smalle kolonner, og spillernavnet trunkeres med ellipsis i stedet for at presse tabellen bredere. Kun `ChampionshipTab.jsx`; `BoardScreen`s liga-tabeller er urørt. | Brugerrapport: stillingstabellen under konkurrencer fyldte mere end en skærmbredde og krævede scroll til siden. Et fast kolonnelayout med trunkering løser det uden datatab — lange navne forkortes visuelt, men er stadig fuldt tilgængelige i "Vis hele stillingen"-modalen (samme komponent). |
| Juli 2026 | **Live-resultater v1 leveret.** Under en kamp vises den nuværende stilling med rødt, pulserende **LIVE**-mærke + spilleminut (i stedet for blot "I gang"); færdigspillede kampe markeres **Slut**. Live-scoren bor i **separate kolonner** (`matches.live_*`, `sql/live_scores.sql`) og rører aldrig `home_score`/`away_score` — derfor opdateres point, stillinger, rating og Story Engine først ved slutfløjt, og ingen eksisterende view, trigger eller RLS-policy skulle ændres. Ny serverfunktion `api/sync-live.js`: ÉT cron-job hvert minut for alle ligaer, slår først op i vores egen database og springer Sportmonks-kaldet helt over, når ingen kampe er i vinduet. Den færdigmelder også kampe, så stillinger/rating opdaterer inden for et minut efter slutfløjt (før: op til 15 min). Spec: [`features/live-resultater-v1.md`](./features/live-resultater-v1.md). Engangsopsætning: kør `sql/live_scores.sql` ("Run without RLS") + opret cron-jobbet. | Brugerønske: "i gang" fortalte ikke, hvad der skete, og sendte folk ud af appen i netop de 90 minutter, hvor deres tip er på spil. Modkravet — at tabellerne først må bevæge sig ved slutfløjt — er produktprincippet: point er en afgørelse, ikke et øjebliksbillede. Separate kolonner gør det rigtige til standarden i stedet for at kræve, at hvert eneste opgørelsessted husker at filtrere live fra. Minut-intervallet er forsvarligt på gratis-planen, fordi funktionen kun kalder Sportmonks, når der faktisk er kampe i gang. |
| Juli 2026 | **Tip-skærmen kompakteret.** Samme information, ~45 % lavere: (1) **rundehoved** med rundens tilstand på én dæmpet linje (`N af M tippet · Låser om X`, `Låst`, `Åbner …`, `Spillet · N point`) — deadline/lås står nu ét sted i stedet for identisk på hver kamprække, fordi låsen i forvejen er runde-baseret (`(season_id, round_key)`); (2) **dag-overskrifter** i runden, så rækken kun viser klokkeslæt frem for fuld dato; (3) **to-linjers kamprække** (ofte én) — mærke-linjen renderes kun, når der faktisk er et mærke, "Låst" pr. række udgår (de deaktiverede felter er signalet), "undervejs" og ordet "point" udgår, og eget gæt vises som tal i stedet for to deaktiverede felter, når der ikke kan rettes mere; (4) **filtre vises kun, når der er noget at vælge** (eller et filter er sat) og er nu grønne chips, der viser det aktive valg. Deadline vises nu altid (før forsvandt strengen >24 t ude — forsvarligt dengang den stod 10 gange, men ikke når den står ét sted). To ting rettet undervejs: `roundIndex` er nu klampet (skift til et filter med færre runder crashede skærmen i den render, der lå før den korrigerende effekt), og "Alles gæt" er nu en rigtig `<button>` med `aria-expanded` i stedet for et `<span onClick>` uden tastaturadgang. `PointsPill` er flyttet fra `HjemTab` til `ui/components.jsx` og deles nu. Kun frontend (`PredictionsScreen.jsx`, `ui/components.jsx`, `HjemTab.jsx`); `RoundPager` er urørt, da `AdminScreen` bruger den. **Polish oven på (samme leverance):** (a) eget tip, facit og pointpille ligger nu i samme flexrække som holdnavnene, så tallene flugter med den kamp de hører til i stedet for at centreres ned over mærke-linjen; (b) **+1 er gået fra guld til blød grøn** (`C.greenSoft` = `#7fd48a`, nyt token), så pointfarverne matcher appens egen beskrivelse i "Sådan virker det" → Pointsystem — hexen var hardkodet to steder og bor nu kun i `theme.js`. Facit-boksen følger samme nuance (præcist hit = fuld grøn + guldkant, korrekt udfald = blød grøn), så hver færdigspillet række har ÉN grøn. Slår også igennem på Hjem's runde-oversigt og i "Alles gæt"-panelet, hvilket er hensigten: +1 betyder det samme alle steder. | Brugerønske: "Tip-skærmen er for rodet … de rigtige ting er med, men den fylder for meget." En runde med 6 kampe fyldte ~870 px (~1,4 telefon-viewport) og skulle altid scrolles. Ingen information er fjernet og intet er gemt bag et tap — højden gik til luft, gentaget dato og en deadline, der stod på hver række, selvom den gælder hele runden. *Simplicity Wins*: kompleksitet er en omkostning. |
| Juli 2026 | **Hjem + Championship kompakteret.** Hjem: rating (kun tal + bevægelse ▲/▼) flyttet op ved siden af brugernavnet og gjort tappbar til karriereprofilen; det separate rating-kort (stort tal, formkurve, "Nr. X af Y") fjernet — placering udeladt for at spare plads. "Indeværende runde"-kortet er nu foldbart: foldet som standard (viser kun X/Y spillet + akkumulerede point), folder ud til den fulde kamp-for-kamp-visning med en "Åbn tip"-knap. Championship: de tre kort (Rundechampionship, Månedschampionship, Sæsonchampionship) viser nu top 5 i **samme tabel-format som liga** (`BoardScreen`) — rigtig `<table>` med kolonner #, Spiller, Rating, 🎯, Point — så 🎯 er én kolonne-header i stedet for at stå på hver række. "Vis hele stillingen" åbner en modal med paginering (maks. 20 pr. side). Kun frontend (`HjemTab.jsx`, `ChampionshipTab.jsx`); rating hentes via eksisterende `loadRatingMap`. | Brugerønske: fanerne var for pladskrævende og `× 🎯` på hver række var forvirrende. Genbruger liga-tabellens format og eksisterende loaders — ingen datamodel- eller SQL-ændring. |
| Juli 2026 | **Karriereprofil v1 leveret.** Ét DB-RPC (`career_profile`, `security definer`, mønster som `admin_user_stats()`) samler hoved, titler (afsluttede måneder/runder), ratingkurve og basistal (samme 3/1-udtryk som stillings-views'ene, F2) — gated på K1-relationen (egen profil, eller delt liga/konkurrence). Milepæle + rivaler er private (kun egen profil): milepæle læses client-side via RLS på `stories`, rivaler kun med i RPC-svaret for egen profil. Ny drill-in-skærm `ProfileScreen.jsx`, nået via rating-snapshot på Hjem og navne-klik i Rating-ranglisten. | Roadmappens trin 4 og MVP-kravet "Grundlæggende karriere og head-to-head". Følger "Stories over Statistics" (fortælling frem for tabel, basistal diskret nederst, driller aldrig). Ingen nye tabeller — alt afledt af eksisterende data, læsning samlet i DB (PostgreSQL som kilde til sandhed). K1: rivalisering kræver publikum, historier er personlige. |
| Juli 2026 | Karriereprofilens forudsætninger afgjort, og **karriereprofilen bygges før turnering #2**. **F2:** pointsystemet fastfryses som 3-1-0 overalt — `rules`-feltet erklæres historisk, alle opgørelser (views, `pc_points`, frontend) er altid 3/1. **K1:** en profil kan ses af alle, man deler en liga eller konkurrence med; milepæle fra `stories` forbliver private. Spec: [`features/karriereprofil-v1.md`](./features/karriereprofil-v1.md). | 3-1-0 er i forvejen besluttet som fast for alle (juli 2026) — at lade DB læse `rules` ville være SQL-arbejde uden aktuel brugerværdi. Profil-synlighed følger produktbogen: rivalisering kræver et publikum, men historier er personlige. Karriereprofilen er roadmappens trin 4 og det, brugerne kan mærke; turnering #2 kan desuden være begrænset af Sportmonks' gratis-plan. |
| Juli 2026 | ~~**A2 lukket:** Månedschampionshippet tæller **samlede point** — også når flere turneringer er i drift (tiebreak uændret: flest præcise).~~ **AFLØST 31. juli 2026 — se øverst i tabellen.** | Månedschampionshippet må gerne belønne deltagelse; præcision på tværs af deltagelsesomfang dækkes allerede af ratingen (gennemsnit pr. kamp). Ingen kodeændring. *(Rækken er bevaret, fordi denne fil er arkivet: beslutningen var ikke forkert, den var truffet om en situation, der endnu ikke fandtes.)* |
| Juli 2026 | Skema-eksport automatiseret og leveret: `sql/schema.sql` er nu i repoet — en **genereret** fuld-skema-eksport (`public`, kun skema, uden ejer-info, med grants) via `pg_dump --schema=public --schema-only --no-owner`. GitHub Action (`.github/workflows/schema-export.yml`) kører eksporten på en runner med DB-adgang, kører verifikationstjeklisten og committer ved ændring — **manuelt + ugentligt** (mandag 06:00 UTC) som sikkerhedsnet mod skema-drift. Guide (Vej 1 `pg_dump` / Vej 2 `supabase db dump` / Vej 3 workflow) i `sql/README.md`. DB-strengen ligger i repo-secret `SUPABASE_DB_URL` (roteret). | Ét versioneret øjebliksbillede af produktionsskemaet, der kan læses/diffes/genskabes uden at lække ejer-roller eller data. Skemaændringer køres manuelt i Supabase, så en tidsstyret kørsel fanger drift i git automatisk. `--no-owner` fjerner ejerskab; grants beholdes bevidst (ikke `--no-privileges`), fordi de er en del af skemaets sikkerhedskontrakt (RLS-roller). Workflowen kunne ikke køres fra web-sandkassen (kun HTTPS ud, port 5432 blokeret) — derfor GitHub-runner. |
| Juli 2026 | "Statistik for brugere" bygges som **karriereprofil i fortællende form** (spec: [`features/karriereprofil-v1.md`](./features/karriereprofil-v1.md)) — titler, milepæle (genbrug af `stories`-arkivet) og ratingkurve frem for en statistikside; "flere ligaer" præciseret som **turnering #2** (drejebog: [`features/turnering-2.md`](./features/turnering-2.md)) — fællesskabs-ligaerne er allerede live. | I tråd med "Stories over Statistics" og den tidligere beslutning om head-to-head som story-regler. Forudsætning F1 (skema-eksport) er siden lukket (`sql/schema.sql` + ugentligt workflow); karriereprofilen kræver fortsat afklaring af pointkilden (F2 — views hardkoder 3/1, frontenden læser `rules`). |
| Juli 2026 | `full_season`-konkurrencer kan spænde over flere turneringer på én gang (multivalg af turneringer + stages pr. turnering). Én turnering = uændret bundet form; flere = liga-løs (`league_id`/`season_id` = `null`, turneringer i `mode_params.tournaments`), kampe materialiseret pr. turnering i `competition_matches`. | Forbereder turnering nr. 2 (Premier League m.fl.): brugeren kan lave fx "Superliga grundspil + Premier League" i én konkurrence. Genbruger den liga-løse infrastruktur fra `custom`/`random`, så læse-stier (stilling/tips) er uændrede. Berører A2 (månedschampionship-scoring) og punkt 5 (global runde), som stadig afventer, at turnering nr. 2 er i drift. |
| Juli 2026 | Pointsystem forenklet til 3–1–0 uden minuspoint. | Simulering viste, at minuspoint forvirrede og lod en "tip altid uafgjort"-strategi konkurrere. |
| Juli 2026 | ~~Rundebaseret tipslås (hele runden låses ved tidligste kickoff −1 t) i stedet for pr. kamp.~~ **Rullet tilbage 1. august 2026 — se `A21` øverst.** | Lukker muligheden for at justere sene tips efter tidlige resultater. Rækken er streget over frem for slettet, fordi begrundelsen stadig er gyldig som *pris*: det er præcis den skævhed, `A21` genåbner med vilje. |
| Juli 2026 | Rating beregnes som gennemsnitspoint pr. kamp; Månedschampionship som samlede point. | Rating skal være fair på tværs af deltagelsesomfang; Månedschampionship må gerne belønne deltagelse (revurderes i A2). |
| Juli 2026 | Stack fastholdes som Vite + React + JavaScript (ikke Next.js/TypeScript/Tailwind). | Migrering ville koste uger uden brugerværdi. Teknologien må ikke definere produktet. |
| Juli 2026 | Head-to-head bygges som Story Engine-regler, ikke som statistikside. **Delvist rettet (K4, 30. juli 2026):** se sidste række i denne log — ét enkelt narrativt cross-profile H2H-punkt er tilføjet som afgrænset undtagelse. | Billigere, og i tråd med "Stories over Statistics". |
| Juli 2026 | Push-notifikationer: kun to beskedtyper (deadline-påmindelse og runde-resultat), dedupleret via `notification_log`. | "Få, relevante notifikationer" — hellere to beskeder, der altid rammer, end ti, der støjer. |
| Juli 2026 | Notifikations-dedup gjort kapløbssikker: hver besked reserveres (`claim`) i `notification_log` med `resolution=ignore-duplicates` FØR afsendelse, og kun de rækker, kaldet selv indsatte, sendes (tidligere: læs log → send → skriv log, som to samtidige kørsler kunne løbe forbi). | Bruger rapporterede to ens notifikationer på samme tid. Årsag: check-derefter-send-dedup uden atomicitet — flere/overlappende cron-kald til `/api/send-notifications` læste begge en tom log og sendte hver sin kopi. Claim-før-send gør indsættelsen til den atomare lås. Husk: kun ÉT cron-job for notifikations-funktionen (den dækker alle ligaer på én gang). |
| Juli 2026 | Stillinger beregnes i DB-views (`round_standings`, `season_standings`) frem for i browseren. | PostgreSQL som kilde til sandhed; skalerer med flere brugere og kampe. |
| Juli 2026 | `SYNC_SECRET` sendes til serverfunktionerne via headeren `x-sync-secret` (query-string `?secret=` bevaret som fallback). | Hemmeligheden skal ikke ende i request-logs. Verificeret: kald uden header giver 401, cron-jobs med header giver 200. **Senere (teknisk gæld):** fjern `?secret=`-fallbacken helt, så kun headeren accepteres — først når alle cron-jobs (ét sync-job pr. liga + notifikations-jobbet) er bekræftet flyttet til headeren, ellers fejler de med 401. |
| Juli 2026 | Story Engine v1: udvælgelsen pr. bruger pr. runde er deterministisk — `priority asc`, dernæst største liga (snapshottet `league_size desc`), dernæst `competition_id`/`id` som garanteret unik tiebreak. Ligastørrelse aflæses IKKE live. | Fler-liga-brugere udløser flere kandidater; visningen skal altid give præcis én, reproducerbar historie, der ikke driver, når medlemskab ændres. Detaljer i [`features/story-engine-v1.md`](./features/story-engine-v1.md) afsnit 6. |
| Juli 2026 | Liga-lagets DB-enhed hedder `groups`/`group_members` (UI: "liga"); eksisterende konkurrencer migreres blødt (`group_id = null` → opretteren flytter selv, deltagere følger med som medlemmer). | Ordet "liga" kolliderer med `leagues` (fodboldturneringer) i skemaet. Automatisk gruppering kan gætte forkert og flytte medlemskaber uden samtykke. Detaljer i [`features/liga-laget-v1.md`](./features/liga-laget-v1.md) afsnit 2 og 6. |
| Juli 2026 | UI-ordbog: **"Turnering"** = fodboldliga (Sportmonks), **"Liga"** = fællesskabet, **"Konkurrence"** = tippekonkurrence. Al UI-tekst om fodboldligaer omdøbes til "turnering" i liga-lagets fase 2; DB-navne (`leagues` m.fl.) uændrede. | Ét ord pr. begreb — "liga" må kun betyde fællesskabet, ellers genopstår tvetydigheden i brugerfladen. Spec: [`features/liga-laget-v1.md`](./features/liga-laget-v1.md) afsnit 2. |
| Juli 2026 | Liga-laget A6: alle medlemmer må oprette konkurrencer i en liga (ikke kun liga-admin). | Bogen gør admin til vært, ikke gatekeeper; mindst friktion i små vennegrupper. Kan strammes senere uden datamodel-ændring. |
| Juli 2026 | Liga-laget A8: ingen gæste-deltagelse — deltagelse i en liga-konkurrence kræver liga-medlemskab (join via konkurrence-link melder én ind i begge). | Én regel, ingen kant-tilfælde. |
| Juli 2026 | Liga-laget v1 bygget (alle 3 faser: DB-fundament, liga-UI, blød migrering). | Faserne er tæt koblede, og `move_competition_to_group` hører naturligt til på liga-siden — leveret samlet. |
| Juli 2026 | Liga-laget v1 live i produktion (`sql/groups.sql` kørt); Hjem's "Dine placeringer" grupperer nu konkurrence-placeringer pr. liga (liga-løse under "Øvrige"). | Sidste polish oven på liga-laget: placeringerne læses nu i fællesskabets struktur, matcher liga-lagets datamodel. |
| Juli 2026 | Story-kortet placeres som eget kort **direkte under Hjem's tips-status** (ikke øverst, ikke i samme slot), vises **altid** (også ved rødt "mangler tips") og er guld-fremhævet. Erstatter tidligere "deadline slår historie"-udkast. | Bruger vil både mødes af "hvad skal jeg gøre" (tips øverst) og "hvad skete der" (historie lige under). Separat, altid-synligt kort matcher "Stories over Statistics"; deadline beholder toppen. |
| Juli 2026 | Sportmonks-stages (grundspil / mesterskabsspil / nedrykningsspil / playoff) gemmes pr. kamp (`matches.stage_name`, `sql/matches_stage.sql`) og kan bruges til at scope en sæson-baseret konkurrence til bestemte stages ved oprettelse; stage-navn vises som badge i tip-visningen. Den forkerte skjulte "Superliga Playoff"-liga er fjernet. | Superligaen er én Sportmonks-sæson med flere stages (ikke separate ligaer) — alle stages synkroniseres i samme kald. Lader en vennegruppe fx lave en ren mesterskabsspil-konkurrence. |
| Juli 2026 | Hjem-fanen gjort liga-bevidst (bugfix). To fejl fjernede al info fra Hjem for et liga-medlem, selvom liga-siden viste medlemskabet: (1) `_hidden`-filteret (arkivering) gjaldt også konkurrencer i en liga — et forældet `hidden`-flag (typisk sat mens konkurrencen var liga-løs, siden flyttet ind via `move_competition_to_group`) skjulte den på Hjem/Tip, mens liga-siden viste "Med"; nu er `hidden` kun aktivt for liga-løse konkurrencer (`MainApp.loadCompetitions`: `_hidden = c.group_id ? false : hidden`). (2) Tom-tilstanden "Du er ikke med i nogen ligaer endnu" udløstes udelukkende af manglende (synlige) konkurrencer og ignorerede liga-medlemskab; `HjemTab` henter nu `loadMyGroups` og viser i stedet "Du er med i ligaen X, men har ikke tilmeldt dig en konkurrence endnu → Åbn ligaen og deltag" for et liga-medlem uden aktiv konkurrence. | Arkivering er en affordance for liga-løse konkurrencer (kun der findes Arkivér/Gendan); et liga-medlem må aldrig få at vide, at det ikke er med i nogen liga. Symptom rapporteret med skærmbilleder: "Med" i ligaen, men "ikke med i nogen ligaer" på Hjem. |
| Juli 2026 | Stage-konkurrencer bruger **creation-time filter** (materialiseres i `competition_matches` ved oprettelse), ikke live-auto-tilknytning. En playoff-konkurrence oprettes, når Sportmonks har skemalagt kampene (foråret). | Følger den eksisterende membership-model (samme begrænsning som `full_season` i dag); undgår at koble sync til `competition_matches`. Live-udfyld kan tilføjes senere uden datamodel-ændring. |
| Juli 2026 | Story Engine flyttet ud af skyggetilstand — historie-kortet er nu live for alle brugere. Skyggetilstanden var udelukkende en frontend-gate (`HjemTab` hentede kun `latest_story` for `is_admin`); genereringen (`generate_stories`) og RLS'en var altid pr. bruger. Gaten er fjernet, så alle henter deres egen seneste historie. | Skyggetilstanden havde tjent sit formål (tone verificeret med friske øjne). A4-tærskler kalibreres videre på live-data uden at holde funktionen skjult for brugerne. |
| Juli 2026 | Rating genberegnes fortsat løbende (efter hver afgjort kamp), IKKE først når runden er slut. Modellen er uændret ét Elo-skridt pr. runde; det er kun teksten, der er rettet, så produktbog, DOCUMENTATION og UI beskriver den faktiske adfærd. | Rapporteret som en uoverensstemmelse: bogen lovede "ikke én pr. kamp — én", men tallet rykkede efter hver kamp. `recompute_ratings()` sletter og genopbygger hele historikken, så den igangværende runde stadig kun giver ét skridt — det er et foreløbigt bud, der lander på den endelige værdi ved rundens sidste kamp. Den løbende feedback under ugen er en fordel, som det ville koste mere at fjerne end at forklare. **Alternativet, hvis prioriteringen senere vendes:** en komplethedsspærre i `_rs` (kun `round_key`s uden manglende resultater), samme mønster som `generate_stories` bruger i `sql/schema.sql:568-573` — prisen er, at rating står helt stille indtil mandag. |
| 30. juli 2026 | **Karriereprofil udvidet: ét cross-profile H2H-narrativ, "bedste nogensinde"-rekorder og liga/konkurrence-fodaftryk — delvis, afgrænset undtagelse fra "H2H bor i Story Engine, ikke en sammenligningsside".** `career_profile()` (`sql/career_profile.sql`) får tre nye jsonb-nøgler: `h2h` (kun ved fremmed profil + delt konkurrence — ét narrativt punkt, aldrig en tabel), `records` (bedste rating nogensinde, bedste rundeplacering, længste stime af rundesejre i træk — genbruger samme `rank()`-stige som `titles.round_wins`, ingen parallel pointberegning), og `footprint` (antal ligaer/konkurrencer fra `group_members`/`competition_participants`, uanset arkiveringsstatus). Alle tre er synlige på tværs af profiler, samme niveau som hoved/titler/kurve/basistal (K1) — kun milepæle og rivaler forbliver private. Milepælslisten (`ProfileScreen.jsx`) får desuden et vist-som-standard-loft (20) med "Vis alle N"-udvidelse — rent frontend, ingen SQL-ændring, ingen ny historieregel (Story Engines dækning var allerede fuld — verificeret mod `RULES` i `src/lib/stories.js`). **Spec-rettelse:** [`features/karriereprofil-v1.md`](./features/karriereprofil-v1.md) §2 og §8 (K4) annoterer undtagelsen uden at slette "Ikke i v1"-linjen eller testcase 4/5. | H2H forbliver ikke en sammenligningsside — kun én sætning, kun synlig for viewer selv. Besluttet at vise den uanset om viewer fører eller taber: tallene er allerede offentlige for delte konkurrencedeltagere via stillingerne, og `LEAD_LOST` gør allerede det samme for den tabende part i Story Engine. Rekorder og fodaftryk introducerer ingen ny privat information — afledt af data der allerede er offentlig (kurve, titler, stillinger) eller strukturelt neutral (medlemskabstal). "Konkurrencer vundet" bevidst udeladt: `season_standings` er sæson-bred, ikke per konkurrence, og produktet kører kun én sæson — umodent koncept indtil turnering #2. |
| 30. juli 2026 | **K4 rettet efter live test, to fund.** (1) `records`-nøglens `streaks`-CTE fejlede for **alle** brugere ("column won does not exist" — Postgres): en indre subquery projicerede kun `round_key` + den udregnede `grp`, mens den ydre `where won` refererede en kolonne, subqueryen aldrig eksponerede. `career_profile()` kastede derfor en fejl for enhver profil, og karriereprofilen viste kun "Kunne ikke hente profilen lige nu." Rettet ved at eksponere `won` fra den indre subquery. (2) H2H-`meetings` talte det samme fysiske møde flere gange, hvis to brugere delte **mere end én** konkurrence, der dækkede den samme runde (fx en rundebaseret + en full-season-konkurrence for samme turnering) — `rp`-CTE'en grupperede på `(competition_id, round_key, user_id)`, men `predictions` er ét tip pr. bruger pr. **kamp**, ikke pr. konkurrence, så samme runde blev talt én gang pr. delt konkurrence. Bruger med to delte konkurrencer og kun én spillet runde så "I har mødt hinanden 2 gange". Rettet ved at deduplikere kampe (`distinct` på `match_id`) på tværs af delte konkurrencer, før der aggregeres pr. runde ([`features/karriereprofil-v1.md`](./features/karriereprofil-v1.md) testcase 13, rettet). **Desuden:** "Rekorder"-overskriften fik en `InfoDot`, der forklarer, at rekorderne gælder på tværs af *alle* brugerens konkurrencer/ligaer — brugerfeedback pegede på, at det uden forklaringen kunne læses som knyttet til én bestemt konkurrence, ligesom Milepælene lige under. | Begge SQL-fund kom fra reel brug (live test), ikke fra en gennemgang på forhånd — et påmindelse om, at `plpgsql`-funktioner med indlejrede subqueries ikke fanges af `npm test` (ren JS-suite) og bør afprøves i Supabase efter hver migrering, ikke kun læses. Et "møde" skal opleves som én kalenderrunde af brugeren, ikke som ét konkurrence-runde-par — det matcher bedre den intuition, brugerens spørgsmål ("hvordan kan vi have mødt hinanden 2 gange, når der kun er spillet én runde?") viste. |
| 30. juli 2026 | **Et tal på karriereskærmen skal navngive sit eget omfang i den sætning, det står i — en `InfoDot` må uddybe, men aldrig alene bære det, der skal til for at læse tallet rigtigt.** Brugerspørgsmål til Rekorder: *"det skal være tydeligere hvilke konkurrencer der er tale om — jeg går ud fra at det er de globale konkurrencer og rating?"* Antagelsen var **rigtig**. Karriereskærmen viser to omfang: Titler, Rekorder og basistal er globale (Championship + global rating), Milepæle er konkurrence-nære. Fire ændringer: hver Rekorder-linje navngiver kilden ("Din bedste placering i **Championships rundechampionship**", "din højeste **globale** rating"); hver sektion får en **synlig** scope-linje; H2H-sætningen indledes "I jeres fælles konkurrencer …"; og InfoDot'en er omskrevet, så den er præcis. Nyt afledt felt `records.best_round_rank_field` gør "4. plads" til "4. plads af 31 spillere" — men **udelades** ved `rank >= field`, så der aldrig står "8. plads af 8". `best_rating_round` vises nu (blev hidtil hentet uden at blive brugt). Visningsreglerne er flyttet til de rene funktioner `recordFacts`/`h2hSentence` (12 nye tests, 218 i alt). Ingen ændring i beregning, pointkilde (F2) eller synlighed (K1). Engangsopsætning: gen-kør `sql/career_profile.sql`. Spec: [`features/karriereprofil-v1.md`](./features/karriereprofil-v1.md) afsnit 10. | **Hvorfor det ikke var nok at rette InfoDot-teksten:** en tidligere rettelse satte netop en `InfoDot` på "Rekorder" — og fejlede på to måder på én gang. Den var **skjult bag et klik**, hvor problemet er en forkert *førstelæsning*: en tvivl, brugeren ikke ved de har, får dem ikke til at åbne en hjælpetekst. Og den var **upræcis** — "på tværs af alle dine konkurrencer og ligaer" læses som en opgørelse *pr. egen konkurrence*, mens `best_round_rank` er rangen mod **samtlige brugere** med point i runden. At brugeren gættede rigtigt er ikke et forsvar for visningen: det er en bruger, der gør arbejdet, skærmen skulle have gjort. **Hvorfor feltstørrelsen er en del af svaret og ikke bare pynt:** "4. plads" er tavs om, hvor stor kredsen var, og var netop derfor læsbar som en egen konkurrence — "af 31 spillere" *viser* det globale omfang i stedet for at forklare det. Den må så til gengæld aldrig kunne afsløre en sidsteplads, hvilket er hele grunden til `rank >= field`-guarden: samme ufravigelige regel som resten af profilen, hvor bundplaceringer ikke findes. |
| 30. juli 2026 | **Fem forbedringer af karrierestatistikken, leveret samlet: sæsontitel, "din bedste runde nogensinde", korrekte udfald i basistallene, toppunkt ringet ind i ratingkurven og akser på kurven.** (1) `titles.season` — Championship har **tre** kåringer (runde, måned, sæson), men karrieren registrerede kun to, så den største aldrig ville stå nogen steder, når sæsonen sluttede; samme regler som månedstitlen (kun afsluttede sæsoner, `rank()` så delt titel tælles for begge, fuld tiebreaker-stige), badget står først. (2) `records.best_round_points` — flest point i én afsluttet runde, med præcise og rundeetiket; sammenligner kun brugeren med brugeren selv, så den kan vises uanset placering. (3) `base.outcome_count` blev hentet uden at blive vist. (4) Toppunktet ringes ind (◎) ud fra `records.best_rating_round`, med fallback til kurvens eget maksimum. (5) Kurven fik akser: y som neutralt interval ("Skala 1200–1240"), x som første/sidste rundeetiket. **Verificeret mod en rigtig PostgreSQL 16.13** med produktionsskemaet og håndregnet facit. 9 nye tests (227 i alt). Engangsopsætning: gen-kør `sql/career_profile.sql`; frontenden er bagudkompatibel med den gamle funktion. Spec: [`features/karriereprofil-v1.md`](./features/karriereprofil-v1.md) afsnit 11. | **Hvorfor de fem og ikke andre:** alle ligger inden for det, skærmen allerede handler om, og ingen af dem gør profilen til den statistikside, spec'ens afsnit 1 siger nej til. To af dem var **døde felter** — `base.outcome_count` og `records.best_rating_round` blev hentet fra databasen uden nogensinde at blive vist, hvilket er den billigste slags forbedring, der findes: dataen var der, kun visningen manglede. Uden `outcome_count` var cirka halvdelen af pointene usynlige: 14 point kunne ikke stemme med 4 præcise, medmindre brugeren selv regnede resten ud. **Hvad verificeringen fangede, som en gennemgang ikke gjorde:** en spiller, hvis eneste runde gav nul point, ville have fået "din bedste runde nogensinde: 0 point". Fejlen fandtes kun, fordi funktionen blev kørt på rigtige data i en rigtig Postgres — deraf `> 0`-guarden, og deraf også valget "Skala 1200–1240" frem for "din laveste rating": begge er den samme regel om, at profilen aldrig driller (afsnit 1, punkt 3), anvendt på to nye steder. **Hvorfor sæsontitlen var et hul og ikke en ny idé:** karrieren er stedet, der "nulstilles aldrig", og en afsluttet sæson er den største ting, der kan ske i Championship. At den ikke efterlod et spor, var en mangel i det leverede, ikke en udvidelse af omfanget. |
| 30. juli 2026 | **K3 lukket: rivaler rangeres på jævnbyrdighed fra faktiske møder, ikke på antal historier — og `rating_history.rnk` er afvist som kilde.** Rivaler blev rangeret på antal `H2H_PASS`/`STREAK`-historier, mens teksten sagde "Din tætteste rival". Optællingen målte ikke tæthed, men hvor **dramatisk** forholdet havde været: på et testdatasæt gav den gamle metode én rival — den modstander, ejeren slår **4-0** — mens den mest jævnbyrdige (2-2) var usynlig. Ny rangering: `abs(sejre − nederlag)` asc, flest møder som tiebreak, `rival_id` som deterministisk sidste nøgle, maks. 3, kun ved `meetings >= v_rival_min_meetings` (navngivet, tunbar, pt. 2). Møde-definitionen er lånt **1:1 fra `h2h`** — én runde hvor begge har tippet i en delt konkurrence, dedupliceret pr. kamp, hver side med de kampe den selv har tippet. Historierne beholdes som **farve** (`stories`-feltet), aldrig som rangering. Sidegevinst: posten bærer nu `user_id`, så rivalnavnet er en tryk-flade som alle andre navne i appen. **Verificeret mod PostgreSQL 16.13** på et datasæt bygget til at bryde fire ting (jævnbyrdig foran ensidig ved lige mange møder · dedup over to delte konkurrencer med samme kampe · ét møde udelades · fremmede i en ikke-delt konkurrence optræder ikke), plus symmetri, privathed, invarians mod `h2h` og idempotens. 5 nye tests (232 i alt). Engangsopsætning: gen-kør `sql/career_profile.sql`. Spec: [`features/karriereprofil-v1.md`](./features/karriereprofil-v1.md) afsnit 12. | **Hvorfor K3's egen foreslåede udvej blev afvist:** K3 nævnte placerings-nabo-analyse på `rating_history.rnk` som alternativet. Men `rnk` er den **globale** ratingplacering, så den kunne udpege folk, man ikke deler konkurrence med — direkte i strid med den ufravigelige designregel fra juli 2026 ("en historie må kun nævne personer, modtageren deler konkurrence med"). Beslutningen fra juli gjorde altså K3's eget udkast ugyldigt, uden at nogen havde skrevet det ned. Den valgte beregning starter i `competition_participants` og kan derfor *per konstruktion* ikke nævne en fremmed — verificeret med to spillere, der har tippet præcis de samme kampe i en konkurrence uden profilens ejer. **Hvorfor møde-definitionen skulle lånes og ikke opfindes:** `rivals` og `h2h` svarer på samme spørgsmål set fra hver sin side, og to steder i produktet må ikke svare forskelligt — den lektion kostede både tiebreaker- og Story Engine-leverancen. Invarianten er nu verificeret eksplicit, ikke bare tilstræbt. **Hvorfor volumen ikke måtte være metrikken:** rangeret efter antal møder får man ikke rivaler, men den ældste medspiller i den største konkurrence. En rival er nogen, man veksler slag med. **Ikke målt endnu:** beregningen er gået fra ét par til alle delte deltagere × runder i samme RPC — trivielt på nuværende brugerbase, men bør times på produktionsvolumen frem for antages. |
| 30. juli 2026 | **Forklarende tekst på karriereskærmen hører i `InfoDot`, ikke som brødtekst på siden — og hver sektion med tal skal have sin egen.** Delvis tilbagerulning af scope-leverancen tidligere samme dag, efter brugerfeedback: *"jeg vil gerne have den beskrivende tekst flyttet ind under Informations feltet … Det skal ikke stå på forsiden."* Fjernet: scope-linjerne under Titler, Rekorder, Milepæle og Rivaler, underteksten på H2H-kortet og "Hele karrieren"-linjen over basistallene (`scopeNote`-stilen findes ikke længere). Tilføjet: `InfoDot` på **hver** sektion med tal — nye på Titler, Milepæle, H2H og basistallene, mens Rekorder og Rivaler har fået scope-linjens indhold ind i deres eksisterende. På de to kort uden overskrift (H2H, basistal) står ikonet inline **efter** indholdet. Beholdt: at tallene navngiver deres eget omfang i selve sætningen, samt ratingkurvens legende og akseetiketter. Ren præsentationsændring — ingen SQL, ingen ændret logik, 232 tests fortsat grønne. Spec: [`features/karriereprofil-v1.md`](./features/karriereprofil-v1.md) afsnit 13. | **Hvorfor den forrige begrundelse ikke var forkert, men vejede forkert:** argumentet for den synlige linje var, at en bruger, der ikke *ved*, de har misforstået noget, aldrig åbner en hjælpetekst — og det er sandt. Men prisen for et ekstra afsnit betales af **alle** på **hver** visning, mens gevinsten kun tilfalder den, der læser forkert den første gang. Med alle sektioner på plads blev det fem forklarende afsnit på én skærm, og så er balancen tippet. **Hvad der faktisk løste problemet, og som er beholdt:** at tallet navngiver sit eget omfang i selve sætningen ("i Championships rundechampionship", "globale rating", "af 31 spillere"). Det virker på førstelæsningen uden at koste en linje — det var altid den bærende del af rettelsen, og brødteksten var det, der kunne undværes. **Hvorfor ratingkurvens legende ikke er flyttet med:** en legende afkoder symboler, brugeren ser på *imens* (● dæmpet = foreløbig, ◎ = toppunkt), og den kan ikke lægges et klik væk uden at gøre grafen ulæselig. Aksevisning er ikke prosa. **Lektionen, der er værd at holde fast i:** to runder blev brugt på at flytte den samme oplysning ind og ud af siden. Reglen står derfor nu som en anvisning frem for en betragtning — ny sektion med tal ⇒ ny `InfoDot`, ikke ny brødtekst — så næste sektion ikke starter forfra. |
