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
ROADMAP — `A11` er fx også navnet på en logadvarsel i `api/_shared.js`.
`B#` ubygget · `G#` teknisk gæld · `I#` ideer. Spec-lokale ID'er (`K2`, `F1`)
beholder deres eget navn og linker til spec'en.
**Næste ledige: `A40` · `B30` · `G95` · `I20`.**

**Historikken står nederst og kun i ét eksemplar.** Rydninger af indbakken og
kørsler af et tier hører til i [Log](#log--seneste-kørsel) i bunden af filen, og
den bærer **kun den seneste**. Ældre kørsler slettes, når en ny skrives — de er
allerede arkiveret i `DECISIONS.md` og `CHANGELOG.md`, som er de to filer, der
har lov at vokse. Ingen tier-overskrift og ingen indbakke bærer sin egen
kørselshistorik; står der noget under en overskrift her, er det tilstand og ikke
et referat.

**Rækkefølgen står i [Prioriteret rækkefølge](#prioriteret-rækkefølge) nedenfor**
— tabellerne længere nede er opslagsværker sorteret efter ID, ikke efter, hvad
der skal laves først.

---

## 📥 Indbakke

Skriv én linje. Intet ID, ingen begrundelse, ingen formatering — det er hele
pointen. Ryddes ved næste session: hvert punkt får et ID og en række nedenfor,
eller en linje i "Forkastede ideer".

- Custom kan stadig få låste kampe med: håndplukkens kampliste viser dem med afkrydsningsfelt, og periodens loft-gren (`pickPerRound`) tager dem med — de tre `random`-typer er rettet 10. august 2026 (`filterTippable`), men puljen filtreres stadig på `kickoff_at >= nu`, og låsen falder en time før kickoff

---

## Prioriteret rækkefølge

Alle 32 åbne punkter i den rækkefølge, de bør tages — ikke efter ID og ikke efter
størrelse. **Hvert punkt står præcis ét sted.** Tabellerne længere nede er
opslagsværket (hvad er `G32`?); denne er svaret på "hvad nu?".

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

Tomt. Fællesnævneren er, at adgangen ikke findes i den maskine, arbejdet laves i
— Supabase eller cron-job.org, ikke repoet. `A32` er spørgsmålet om, hvorvidt
tieret skal have en anden betjening end ejeren.

### Tier 2 — Billige rettelser, hvor koden lyver

Tomt.

### Tier 3 — Brugerværdi oven på noget, der allerede findes

Tomt.

### Tier 4 — Datarisiko med en lunte

Tomt.

### Tier 5 — Robusthed og vedligehold

Tomt.

### Tier 6 — Venter på en udløser

Står ikke her, fordi de er små, men fordi rækkefølgen ikke er vores at vælge.
Røres kun, når udløseren i deres `Afgøres`-felt indtræffer.

| # | Hvad | Udløser |
|---|---|---|
| `A26` | `ambiguousTeams`: godkendte par eller accepteret støj | Turnering #3. |
| `B28` | Gentag CL's kickoff-aflæsning i `docs/reviews/football-data-kickoff-aflaesning-2026-08-07.md` | Champions Leagues ligafase er lodtrukket hos football-data.org, så sæsonen 2026 findes hos leverandøren. |
| `A39` | Skal et dagskort kunne udgives, mens en anden turnering mangler et resultat? | **Når `day_card_coverage` melder en blokeret dag, nogen savnede.** `match_day_complete()` er global: én kamp uden resultat i én turnering blokerer alle dagskort, også for de konkurrencer, der intet har med turneringen at gøre. Prisen er dokumenteret som bevidst — den globale kampdag er produktets ene tvær-turneringsbegreb — men den blev betalt synligt under `A38`s undersøgelse. |
| `B26` | E-mailbekræftelse + bot-værn (Turnstile) på signup | **Når linket deles åbent** (hjemmesiden publiceres eller invitationer går uden for det kontrollerede felt). **DELVIST KØRT 10. august 2026 og rullet tilbage — begynd med registeret i [`OPRETTELSE.md`](./OPRETTELSE.md), ikke forfra.** Tilstand: trin 1–3 ✅ (widget oprettet, `VITE_TURNSTILE_SITE_KEY` sat i Vercel **og udrullet**, widgeten tegnes på login-skærmen), Bot Protection **fra**, Confirm email **fra**. Tilbage: trin 4–8. Ét ubevist punkt spærrer trin 4 — at widgetens værtsnavn accepteres; en widget tegnes også på et forkert domæne og fejler først derefter. |
| `B29` | Brugernavnet kan ikke ændres efter oprettelsen | **Når nogen beder om det** — eller når `B26`s navnekollision giver en bruger et navn med et 2-tal. Der findes ingen skærm til det: `display_name` skrives ved oprettelsen (eller af `sikrProfil()` ved første login efter en bekræftelse) og røres aldrig igen. Kollisionen er ikke teoretisk — den er den bevidst valgte adfærd, når et navn bliver taget, mens bekræftelses-mailen ligger ulæst (se `DECISIONS.md` 10. august 2026), og prisen for det valg er præcis denne række. |
| `A34` | Supabase Free → Pro? | **Når Usage-siden viser egress nær 5 GB/md, eller når fremmede udgør flertallet af de aktive** — de to falder formentlig sammen omkring 200–500 ugentligt aktive. |
| `A33` | Er dagsmotorens variation tyndere, end regelantallet lover? | **Når vis-bare dagskort har visninger.** `G73` (5. august 2026) rettede MÅLINGEN og ikke synligheden: de 197 efterfyldte dagskort kan stadig ikke vises, de tælles bare ikke længere i nævneren. Fremadrettede dagskort skrives inde i deres egen runde og ER vis-bare, så udløseren kan nu aflæses direkte — vis-bar > 0 og vist > 0 for dagsreglerne i Analytics. `DAY_RESULT` alene er 123 af 280 historier (44 %). |
| `A35` | Er Story Engine v3's publiceringstærskel på 45 den rigtige? | **To uger med v3 i drift og mindst ti kampdage.** Bygget 7. august 2026, så uret er startet. Måles på `stories.news_value`, som gemmes på alle rækker — også de dæmpede — netop for at kunne svare bagudrettet. Mål: 40–60 % af kampdagene med ulæst-markering. |
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
værdi. **Én undtagelse fra "ingen af dem er besluttet":** `B21` er besluttet i
princippet — produktet hedder Leagly, og repoet gør ikke — og venter kun på
`I10`, fordi det er den samme flytning. *(Den anden undtagelse var `B25`, som
stod øverst her indtil 9. august 2026, hvor den blev leveret — se
[`MAIL.md`](./MAIL.md).)*

| # | Hvad | Bemærkning |
|---|---|---|
| `I8` | Professionel hjemmeside | **Første udkast leveret i `site/` (3. august 2026, [`features/hjemmeside-v1.md`](./features/hjemmeside-v1.md)) — ikke publiceret.** Tilbage står ejer-godkendelse af copy, kontakt-mail, domæne og publicering. Gater fortsat `I9` og `I10`, men de har nu noget konkret at hænge på. |
| `I10` | Domænet peget på hjemmesiden | **Skrumpet 9. august 2026 med `B25`.** Domænet er `leagly.app`, og e-mail-halvdelen er lukket: `kontakt@leagly.app` findes, står i `legal.js` og på `om.html`, og `noreply@leagly.app` sender appens auth-mails. Tilbage står kun det, `B25` ikke rørte — at pege selve HJEMMESIDEN på domænet, inkl. CSP-headerne. Det er samme flytning som `B21`. |
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
| A34 | **Hvornår skiftes Supabase Free ud med Pro?** | Free-planens tre lofter bider i denne rækkefølge: **egress (5 GB/md)** først — appen er REST-fetch-tung, så et sted mellem 200 og 500 ugentligt aktive nærmer forbruget sig loftet; **database (500 MB)** langt senere (tips-rækker er små; `analytics_events` var den hurtigst voksende tabel og har siden `G77`, 7. august 2026, et loft på 18 måneder, så væksten er nu bundet frem for åben); og **backup-vilkåret** er kvalitativt: 24 timers datatab (afsnit 22) er valgt til venner, og når fremmede udgør flertallet, er Pro's backups prisen værd. Aflæses på Supabase-dashboardets Usage-side — én gang om måneden, ikke oftere. Vercel Hobby er IKKE samme spørgsmål: dens tunge trafik skalerer med turneringer, ikke brugere, og skiftet dér udløses af kommercialisering (vilkårene), ikke af brugertal. | Egress nær loftet, eller fremmede i flertal blandt de aktive. |
| A35 | **Er publiceringstærsklen på 45 den rigtige?** | Story Engine v3 udgiver dagens kort med ulæst-markering, når nyhedsværdien når 45, og som dæmpet `DAY_RESULT` under. Tallet er udledt af grundvægtene (max for `DAY_RESULT` alene er 40), ikke af data — samme slags kvalificerede gæt som v1's A4-tærskler var, og de blev kalibreret på live-data. `story_score_distribution` logger vinderregel, `news_value` og runner-up, så fordelingen kan aflæses uden ny instrumentering. | **Efter to uger med v3 i drift og mindst ti kampdage.** Målet er 40–60 % af kampdagene med ulæst-markering for en aktiv bruger. Over 70 % ⇒ tærsklen er for lav, og v3 har genskabt v2's problem i ny indpakning. Under 25 % ⇒ Hjem er stille igen, og v2's oprindelige problem er tilbage. |
| A33 | **Er dagsmotorens variation tyndere, end regelantallet lover?** | Story Engine v2 lagde syv dagsregler til, men `DAY_RESULT` alene står for 123 af 280 historier (44 %), og de næste to (`DUEL` 35, `COLLECTIVE_MISS` 19) er tilsammen mindre end halvdelen af den. En motor, der er markedsført på bredde og leverer det samme kort hver anden gang, er en anden oplevelse end tabellen antyder. **Spørgsmålet kan ikke stilles endnu:** ingen af de 197 dagskort er nogensinde blevet vist (`G73`), så der findes ingen, der har oplevet ensformigheden. Måske er 44 % helt rigtigt — "dagens facit" er også den mest almindelige ting at fortælle om en kampdag. **Delvist håndteret af v3 (7. august 2026):** `DAY_RESULT`s 44 % var en konstruktionsfølge — laveste prioritet, udløses altid — og v3 fjerner årsagen ved at give den grundvægt 8, hvilket gør den til fald-tilbage frem for anker. Spørgsmålet om, hvorvidt de øvrige seks regler faktisk varierer, er **ikke** besvaret og skal aflæses på ny fordeling. | Når dagskort faktisk bliver set, altså efter `G73`. |
| A5 | **Emojis i historie-kort: til eller fra?** | Gør kortet skimbart på mobil, men mindre klassisk. **v1-default: emojis til.** **Delvist besvaret (v1.1, juli 2026):** emoji er nu et *signal* — den findes kun i højdepunkt-tieret, mens dæmpede kort er uden. Spørgsmålet er dermed reduceret til, om højdepunkterne skal beholde deres. **Datamanglen er lukket (30. juli 2026):** Analytics-fanens sektion "Story Engine-regler" viser genereret/vist/delt/afvist pr. regel, så spørgsmålet kan afgøres på tal frem for fornemmelse. **Sidste forudsætning er væk (31. juli 2026):** `story_engine.sql` er gen-kørt i produktion (den tidligere `B3`), så v1.1's 14 regler genererer nu rigtige kort. Uret på "et par runder" starter her. | **Regelstatistikken er aflæst 5. august 2026, og den kan ikke afgøre spørgsmålet.** 280 historier, 21 af 21 brugere dækket — men **0 delinger** og kun 2 afvisninger i alt. Del-knappen er præcis det, højdepunkt-tieret har og det dæmpede ikke, så uden en eneste deling findes signalet ikke. Sammenligningen mangler desuden en nævner: det dæmpede tier har kun **6** historier (`Premiereugen` 3, `Stille runde` 3), fordi det per design kun genereres til brugere, der ellers ville stå uden kort. **Uret starter forfra ved den første deling** — ikke ved den næste runde. |
| A14 | **Skal hele kodebasen gennemformateres med Prettier?** | `npm run format` findes, men `format:check` er bevidst ikke et CI-trin. En fuld gennemformatering ville omskrive ~6.700 linjer ved `printWidth: 140` (~14.000 ved standard 80) på tværs af ~126 filer (86 uden testfiler; genmålt august 2026). Prisen er hele repoets `git blame`; gevinsten er konsistens i en kodebase med én forfatter og en i forvejen ensartet håndstil. Beslutningen er **udskudt, ikke truffet** — se [`DECISIONS.md`](./DECISIONS.md), 30. juli 2026. | Næste gang der alligevel røres bredt i frontenden — ellers aldrig. |
| A23 | **Skal appen have en router?** | Navigation er i dag to `useState` i `MainApp.jsx` (`tab` + `screen`), og deep links læses ved boot og strippes straks via `history.replaceState` (`App.jsx:104`, `MainApp.jsx:215,239`). Følgen er ingen tilbage-knap, ingen browser-historik og ingen delbare URL'er til interne skærme — mærkbart for en PWA, hvor telefonens tilbage-gestus forventes at virke. Men det er et arkitekturvalg, ikke en fejl: afhængighedsfattigheden er bevidst (fire runtime-deps, ingen router, `docs/reviews/2026-08-app-review.md` §7), og en router omskriver hele navigations-tilstandsmaskinen inkl. begge deep-link-join-flows, som ingen test dækker. | Når tilbage-knappen enten koster brugere (kan aflæses i analytics) eller en feature kræver ægte delbare interne URL'er — `I12`s offentlige ligaside er den første, der ville. |
| A27 | **Skal `competitions.rules` droppes?** | Efter `G3` (3. august 2026) har kolonnen **ingen læsere overhovedet** — hverken i klienten, som holdt op med at skrive den, eller i SQL, hvor `pc_points()` altid har hardkodet 3/1. Den står altså tilbage som ren historik i hver eneste konkurrence-række. Men et `drop column` er uigenkaldeligt, og spørgsmålet bagved er et **produktspørgsmål og ikke en oprydning**: skal point nogensinde kunne variere pr. konkurrence? Siges ja, er kolonnen den halve implementering af noget, der skal bruges igen; siges nej, er den støj, der får den næste læser til at lede efter en konfigurerbarhed, som ikke findes — præcis den omkostning, `G3` blev kørt for at fjerne. Prisen ved at lade den stå er lav og løbende; prisen ved at fjerne den forkert er, at en fremtidig pointvariation skal bygge sit skema forfra. | Når produktet svarer på, om point skal kunne variere pr. konkurrence — ikke før. Indtil da koster kolonnen kun plads. |
| A26 | **`ambiguousTeams`: godkendte par eller accepteret støj?** | Feltet i sync-resuméet er bygget på egenskaben *"kun til stede, når der ER noget at kigge på"* — og den holder ikke længere for Scotland: `Dundee` ligger inde i `Dundee United`, begge klubber bliver i Premiership, og feltet er derfor permanent tændt med et par, der allerede er afgjort som en ægte navnelighed (2. august 2026, [`features/turnering-2.md`](./features/turnering-2.md)). Et felt, der altid er der, holder man op med at læse — og så er kontrollen reelt væk, netop når turnering #8 tilføjer et par, ingen har set før. To veje: en liste over **godkendte** par (`Dundee`/`Dundee United`), så feltet igen kun melder det nye, eller en accept af, at dette ene felt læses med et kendt par i baghovedet. Den første koster en liste, der skal vedligeholdes pr. turnering; den anden koster kontrollens troværdighed. | Ved turnering #3 — det er dér, det viser sig, om det ene par er en undtagelse eller et mønster. |
| A39 | **Skal et dagskort kunne udgives, mens en anden turnering mangler et resultat?** | `match_day_complete()` er global: den kræver, at ALLE kampe på dagen har resultat, uanset turnering og uanset konkurrence. Én udsat eller uindberettet kamp i én turnering blokerer derfor dagskortet for hver eneste bruger, også dem, hvis konkurrencer slet ikke rører den turnering. **Prisen er bevidst og dokumenteret** — den globale kampdag er produktets ene tvær-turneringsbegreb, og et kort pr. konkurrence ville skulle vælge, hvilken dag der er *dagen* — men den blev betalt synligt under `A38`s undersøgelse, hvor det tog tid at afgøre, om stilheden var en fejl eller en ventende kamp. **To veje:** afgrænse fuldførtheden til de kampe, modtagerens egne konkurrencer dækker (kortet bliver personligt og kan skrives på forskellige tidspunkter for forskellige brugere), eller beholde den globale dag og gøre blokeringen aflæselig, så stilheden kan skelnes fra en fejl. Den første koster determinismen i acceptkriterie 7; den anden koster ingenting og løser heller ikke noget. | **Når `sql/checks/day_card_coverage.sql` melder en blokeret dag, nogen faktisk savnede.** Kontrollen findes siden `A38` og er dermed selve udløseren — indtil den melder noget, er problemet teoretisk. |

## Ubygget

| # | Hvad | Hvorfor / hvad den venter på | Omfang |
|---|---|---|---|
| B21 | **Omdøb GitHub-repoet og Vercel-projektet, og ret hjemmesidens links** | Navneskiftet 4. august 2026 gik gennem app, manifest, ikoner, tekster og dokumentation, men stoppede ved projektnavnene — **med vilje**, fordi et skifte af Vercel-projektet ændrer `.vercel.app`-adressen og dermed knækker hvert link, der peger på den. Prisen ved status quo er, at produktet hedder Leagly overalt undtagen i den adresse, en ny bruger faktisk taster ind: 23 CTA'er i `site/` (4+5+6+4+4) plus README'ens live-link peger på `prediction-champ.vercel.app`. **Rækkefølgen er bindende og er hele grunden til, at rækken står lige efter `I10`:** vælges et rigtigt domæne, skal linkene alligevel skiftes, og gøres omdøbningen først, skiftes de to gange. Vercels gamle URL redirigerer ikke af sig selv, så et delt link fra før skiftet dør — det er kun ufarligt, så længe hjemmesiden ikke er publiceret. `docs/RESTORE.md`s omtale skal IKKE rettes: den navngiver backup-filer, der faktisk hedder det gamle. | Lille (men mange steder) |
| B26 | **E-mailbekræftelse + Turnstile på signup** | I det kontrollerede felt er ubekræftede konti harmløse; offentligt kan hvem som helst oprette konti med hvem som helsts e-mail — både en spam-vektor og et lille GDPR-problem (adresser opbevares, som ingen har verificeret er deres). **Klientsiden er bygget 10. august 2026**, og rækken er nu ægte konfiguration: bekræftelse slås til under Auth, Turnstile under Auth → Attack Protection. **Rækkefølgen er ufravigelig:** `VITE_TURNSTILE_SITE_KEY` i Vercel FØRST, Bot Protection bagefter — omvendt afviser GoTrue også login og glemt-adgangskode for eksisterende brugere, altså hele adgangen og ikke kun nye konti. Prisen er ét ekstra trin i onboardingen — derfor først ved åben deling, ikke før. **Runbog og TILSTAND: [`OPRETTELSE.md`](./OPRETTELSE.md)s register.** Rækken blev delvist kørt 10. august 2026 og rullet tilbage: trin 1–3 er bestået og nøglen er udrullet, begge knapper i Supabase står på fra, og trin 4–8 mangler. Første kørsel kostede en kortvarig lukning af adgangen for alle, fordi trin 3 blev sprunget over — hændelsen står nederst i runbogen. *(Her stod "begge dele er Supabase-konfiguration, ikke kode". Det holdt for bekræftelsen og ikke for værnet; se `DECISIONS.md` 10. august 2026.)* | Lille (konfiguration) |
| B20 | **Personlige invite-links** (`invite_links` + `invited_by` på `group_members`/`competition_participants`) | Attributionen "hvem inviterede hvem" findes ikke i skemaet: `groups.invite_code` er én kode pr. liga og ikke pr. bruger, og ingen af medlemstabellerne gemmer afsenderen. Det er derfor, milepælen **"5/10 venner tilmeldt via dit link" ikke kunne bygges** — `milestones` tæller i stedet `LEAGUE_GREW_5/10`, altså hvor mange der kom med i en liga, man har oprettet, hvilket er en anden bedrift. Begrundelsen står ved koden begge steder (`sql/milestones.sql`, `src/lib/milestones.js`) og peger på denne række. **Ventetid er ikke gratis her, og det er rækkens vigtigste egenskab:** attribution kan kun registreres fremad, så en bedrift bygget på den kan først tælle fra udrulningsdagen — de brugere, der allerede er inviteret, tælles aldrig. Gater desuden `I6` (ambassadørprogram), som ikke kan måle noget uden. | Mellem |
| B28 | **Gentag CL's kickoff-aflæsning, når ligafasen er lodtrukket** | Champions League var den ene af fem turneringer, [`docs/reviews/football-data-kickoff-aflaesning-2026-08-07.md`](./reviews/football-data-kickoff-aflaesning-2026-08-07.md) ikke kunne dække — leverandøren havde pr. 1. august 2026 endnu ikke oprettet sæsonen 2026, fordi ligafasen ikke var lodtrukket (`B8`, lukket 1. august 2026). De fire aflæste turneringer delte sig i to: kun Bundesliga sender en ren midnats-pladsholder (`status: SCHEDULED` + `00:00`), de tre andre sender et opdigtet klokkeslæt for hver ufastsat kamp uden nogen markør at skelne på. Om CL ligner Bundesliga eller de tre andre, afgør om `kickoff_uncertain`s mønstergenkendelse (`G84`/`G85`) også dækker turneringen — og er kun kendt, når svaret aflæses. | Lille (samme PowerShell-opslag, gentaget) |
| B29 | **Skift af brugernavn** | `display_name` sættes ved oprettelsen og kan aldrig ændres — hverken af brugeren eller fra Admin. Manglen har været der hele tiden og blev SYNLIG med `B26`: skrives profilrækken først ved første login efter en bekræftelse, kan navnet være taget imens, og `sikrProfil()` vælger da `Anna2` frem for at efterlade kontoen uden navn. Det valg er bevidst (`DECISIONS.md`, 10. august 2026) og gør denne række til dets pris. Kræver et felt på profilen, `username_available()`-tjekket der allerede findes, og en tanke om, hvad der sker med navnet i historier og stillinger, som gemmer det som tekst — `stories` og karriereprofilens payload joiner IKKE altid på id. | Lille-mellem (feltet er småt; det gemte navn i payloads er det, der skal tænkes over) |
| B12 | **Mål, om "Anbefalet" på Sæson-kortet flytter fordelingen** | Mærket blev sat på i `A22` netop for at flytte, hvilken mode nye brugere vælger, men effekten er aldrig aflæst — og et anbefalings-mærke, der ikke virker, er værre end ingen, fordi det bruger den plads, der skulle guide. `competition_created` bærer allerede `metadata.mode`, så før/efter kan opgøres uden ny instrumentering. Samme opslag svarer på `I15`s åbne spørgsmål om, hvorvidt Ugens kupon-kortet bruges. Forespørgslen står i [`features/analytics-v1.md`](./features/analytics-v1.md) §5F sammen med de tre forbehold, svaret skal læses med (lille datamængde, lossy hændelseslog, og at kort-rækkefølgen blev vendt samme dag som mærkatet kom på). **Rækken har stået siden august 2026 med teksten "tilbage står at køre den" — og da den blev kørt 5. august 2026, kunne den ikke:** vinduet partitionerede på `(e.created_at < m.fra)`, som hverken står i `group by` eller er aggregeret, så PostgreSQL afviste den med `42803`. Perioden udledes nu i en CTE, efterprøvet mod PostgreSQL 16.13. **Anden kørsel samme dag afslørede, at kilden var forkert valgt:** hændelsesloggen svarede med tre oprettelser i alt, alle `random` — plausibelt nok ved ~20 testbrugere, men ubrugeligt, fordi `analytics_events` først findes fra 30. juli 2026, så "før mærkatet" var to døgn og ikke appens historik. `competitions.mode` + `created_at` bærer samme oplysning som **rigtige rækker over hele historikken**, og spec'ens §5F er byttet om, så tabellen er den primære kilde og hændelsen kontrollen. **Opslaget er kørt 5. august 2026, og svaret er "ikke endnu":** hele appens historik rummer **syv** konkurrencer — 6 før mærkatet (`time_range` 2, `random` 2, `full_season` 2) og **1** efter (`random`). Med n=1 i den ene periode kan ingen fordeling måles, hvilket er præcis rækkens eget første forbehold. Rækken er derfor flyttet til Tier 6 med en udløser, der kan aflæses med samme opslag: **tosifret `antal` i `efter`-perioden.** Det, der er leveret, er ikke svaret, men at spørgsmålet nu kan stilles — forespørgslen kunne hverken køre eller pege på den rigtige kilde, da rækken blev skrevet. | Lille (opslag) |

## Teknisk gæld

| # | Gæld | Hvorfor den betyder noget | Omfang |
|---|---|---|---|
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
| I10 | **Domænet peget på hjemmesiden** | **Halvt leveret 9. august 2026 (`B25`).** Rækken havde to halvdele, og e-mail-halvdelen er væk: domænet er `leagly.app`, `kontakt@leagly.app` er skrevet ind i `src/lib/legal.js` og `site/om.html`, og pladsholderne `[NAVN]`/`[KONTAKT-E-MAIL]` er udfyldt — de tre aftagere, rækken talte, er dermed nul. Tilbage står den anden halvdel: hjemmesiden selv ligger fortsat på `prediction-champ.vercel.app`, og beslutningen om eget domæne kontra en sti på Vercel-projektet afgør også, om appens CSP-headere skal justeres ([`features/hjemmeside-v1.md`](./features/hjemmeside-v1.md)). Det er samme flytning som `B21` og hører sammen med den. | Afhænger af I8 |
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
| 8. august 2026 | **Skrive feltets størrelse i dagskortets mini-stilling** — "3. Cecilie" siger ikke, om det er af 4 eller af 40, og `league_size` står allerede på rækken. | **Tallet er bevidst skjult for præcis de brugere, mini'en ville vise det til.** `DAY_RESULT`s brødtekst skriver "Du ligger nr. 3 af 8" **kun når `a.rnk * 2 <= sz.n`** — altså i den øverste halvdel; nederst siger den i stedet "Toppen er N point væk". Det er designreglen *"historier driller, men ydmyger aldrig"* fra v1, håndhævet i `sql/story_engine_v3.sql`. En mini-stilling vises til alle, så en nævner dér ville sige "nr. 7 af 8" til den, motoren netop har valgt ikke at sige det til — og for den øverste halvdel ville den gentage en oplysning, der står to linjer højere oppe. Placeringen selv er i øvrigt allerede synlig i mini'en; det er kun nævneren, der mangler, og det er den, reglen handler om. Skal noget laves om, er det brødtekstens regel og ikke mini'en — og dét er en anden diskussion end den, linjen rejste. |
| 4. august 2026 | **Give `manifest.json` et `short_name`, der er kortere end `name`** — i dag er begge "Leagly". | `short_name` findes for at have et alternativ, når `name` er for langt til pladsen under et ikon. "Leagly" er seks tegn og bliver ikke afkortet nogen steder, så et kortere alternativ ville ikke være en forbedring, men et **andet navn** for det samme produkt — og navneskiftet 4. august 2026 blev netop kørt i ét hug for at sikre, at kun ét navn figurerer. To identiske værdier er det rigtige svar her og skal ikke læses som et udfyldningsfelt, nogen glemte. Bliver navnet nogensinde længere, opstår spørgsmålet af sig selv. |

---

## Log — seneste kørsel

**Kun den nyeste står her.** Skriver du en ny, sletter du den forrige — arkivet
er `DECISIONS.md` (hvorfor) og `CHANGELOG.md` (hvad), som begge er skrevet til
at vokse. Denne fil er ikke. Formålet med afsnittet er ét: at den næste session
kan se, hvad der lige er sket, uden at læse hele listen.

### 10. august 2026 — `B26` delvist kørt og rullet tilbage. Start i runbogens register

**Listen er 31 → 32.** `B29` er ny (brugernavnet kan ikke ændres); indbakken er
tom. `B26` er hverken lukket eller urørt — den er **halvvejs**, og det er dagens
vigtigste tilstand at kende, før nogen tager en ny branch.

**Sådan står produktionen nu:** trin 1–3 i [`OPRETTELSE.md`](./OPRETTELSE.md) er
bestået — Turnstile-widgeten findes, `VITE_TURNSTILE_SITE_KEY` er sat i Vercel
**og udrullet** (widgeten tegnes på login-skærmen), men **Bot Protection og
Confirm email står begge på FRA** efter et rollback. Trin 4–8 mangler.
**Begynd i registeret øverst i runbogen, ikke forfra.**

**Ét ubevist punkt spærrer trin 4:** at widgetens værtsnavn accepteres. En
Turnstile-widget tegnes også på et forkert domæne og fejler først bagefter, så
"boksen er der" er ikke beviset. Kig efter, at den kvitterer.

**Klientsiden blev bygget samme dag** og lukkede tre huller, `B26`s egen
beskrivelse ikke kendte: kvitteringen manglede i `gotrue_meta_security` på alle
tre auth-endpoints, brugernavnet blev tabt mellem oprettelse og bekræftelse, og
`readUrlIntent()` læste kun `type=recovery`, så bekræftelses-mailens knap ville
være ignoreret. Alle tre er leveret og merget.

**Første kørsel kostede en kortvarig lukning af adgangen for alle**, fordi
trin 3 blev sprunget over: Bot Protection blev slået til, før nøglen var
udrullet, og en `VITE_`-variabel virker først efter en NY deploy. Rullet
tilbage samme dag. Hændelsen står nederst i runbogen.

**Den dyreste opdagelse var en fejl, ingen ledte efter:** `restError()` læste
kun `message`, men GoTrue svarer `msg`, og `res.statusText` er tom over HTTP/2.
Hver eneste auth-fejl var derfor uden tekst, og **`AUTH_FEJL`s tre
oversættelser har aldrig virket i produktionen** — de så rigtige ud i koden
siden `G28`. To helt forskellige fejl viste den samme intetsigende sætning
under kørslen. Rettet med `fejltekst()` og otte tests.

**Én rigtig bruger blev ramt og reddet:** oprettet 08:04 mens bekræftelsen var
slået til, nåede ikke linket inden for den time det gælder, bekræftet i hånden
— og ved hans første login skrev `sikrProfil()` hans brugernavn på plads fra
`raw_user_meta_data`. Altså præcis det hul, klientsiden blev bygget for at
lukke, efterprøvet på en rigtig konto frem for i en test.

**Én påstand fra formiddagen var forkert og er rettet:** runbogen sagde, at
previews ikke kan logge ind, mens værnet er slået til, "indtil staging-projektet
(`B18`) findes". `B18` blev leveret 6. august 2026 — preview peger på sit eget
Supabase-projekt, og Bot Protection gælder pr. projekt. Nøglen sættes derfor
kun i Production.

---

*Levende dokument. Fravalgt scope for allerede leverede features står i den
enkelte spec under "Bevidst ikke med i v1" — det er en historisk
scope-beslutning, ikke en to-do. Bliver et af de punkter en reel kandidat, får
det en `B`-række her.*
