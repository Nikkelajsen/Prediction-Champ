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
**Næste ledige: `A58` · `B39` · `G130` · `I26`.**

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

- analytics.test.js' liste over ⓘ-id'er, panelet slår op, vedligeholdes i hånden og mangler allerede story_viewable — kan den udledes af JSX'en?

---

## Prioriteret rækkefølge

Alle 32 åbne punkter i den rækkefølge, de bør tages — ikke efter ID og ikke efter
størrelse. **Hvert punkt står præcis ét sted.** Tabellerne længere nede er
opslagsværket (hvad er `G32`?); denne er svaret på "hvad nu?".

**Hvert punkt står som en RÆKKE i en tabel — også i Tier 1–5.** Et tier har
præcis to lovlige tilstande: ordet `Tomt.` eller en tabel. Prosaen under en
tier-overskrift er tierets egen **definition** og aldrig en liste over, hvad der
ligger i det. **Når indbakken tømmes, får hvert punkt en række under sit tier**,
ikke en omtale i en sætning — et punkt, der er flettet ind i prosa, kan hverken
tælles, skimmes eller flyttes til et andet tier, uden at nogen skal omskrive et
afsnit. Tredje kolonne bærer dét, tieret drejer sig om: `Udløser` i Tier 6,
`Bemærkning` i Tier 7, `Note` i resten.

> **Reglen er truffet før og drev væk igen.** Den blev skrevet 8. august 2026
> (*"Tier 1–5 viser nu deres rækker i stedet for referater af, hvad der engang
> stod i dem"*, [`DECISIONS.md`](./DECISIONS.md)), og 13. august bar Tier 2 og
> Tier 5 begge et referat, mens Tier 5's to åbne punkter stod inde i en sætning.
> Den har derfor en vagt nu: `docs/backlog.test.js` kræver, at hvert tier enten
> er `Tomt.` eller har en tabel, og at tallet i linjen ovenfor er lig antallet
> af tabelrækker. **Tallet og formatet vogtes af samme påstand**, fordi et punkt
> i prosa netop viser sig som et tal, der ikke stemmer.

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

Fællesnævneren er, at adgangen ikke findes i den maskine, arbejdet laves i —
Supabase, en modtaget mail, cron-job.org eller Vercel, ikke repoet. **Tieret
har én betjening, og det er afgjort** (`A32`, 10. august 2026): aflæsninger i
produktion er ejerens arbejde, og der bygges ingen vej udenom. Det, der kan
gøres billigere, er bestillingen — `sql/checks/` installerer intet og kan
køres på et minut.

Tomt.

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
| `A46` | Udfyld `<app>` i `CRON.md`s ni kald med det faktiske værtsnavn | **Når hvert af de ni jobs har kørt én gang efter 13. august 2026** — langsomste skema er hver 12. time. Værtsnavnet skrives nu i `job_runs.detail` (`A46`, samme fremgangsmåde som `A11`), så aflæsningen er "Seneste resumé" på hvert jobkort i Admin → Drift og ikke ni jobs i cron-job.org. Opslaget står i [`CRON.md`](./CRON.md). |
| `B28` | Gentag CL's kickoff-aflæsning i `docs/reviews/football-data-kickoff-aflaesning-2026-08-07.md` | Champions Leagues ligafase er lodtrukket hos football-data.org, så sæsonen 2026 findes hos leverandøren. |
| `A39` | Skal et dagskort kunne udgives, mens en anden turnering mangler et resultat? | **Når `day_card_coverage` melder en blokeret dag, nogen savnede.** `match_day_complete()` er global: én kamp uden resultat i én turnering blokerer alle dagskort, også for de konkurrencer, der intet har med turneringen at gøre. Prisen er dokumenteret som bevidst — den globale kampdag er produktets ene tvær-turneringsbegreb — men den blev betalt synligt under `A38`s undersøgelse. |
| `A44` | Skal den globale rating vise fulde visningsnavne til brugere, man ikke deler noget med? | **Udløseren er sprunget** (`B26`, 12. august 2026), men i modsætning til `A43` kan visningen ændres bagefter — prisen ved at vente er kun, at flere navne allerede er hentet. Faldt ud af `A43`: uanset hvor stram policyen på `profiles` bliver, publicerer Rating-fanen og Championship (`scope='ALL'`) hver bruger til enhver indlogget. Det er en produktbeslutning, ikke en adgangsregel — og den skal derfor stilles for sig. |
| `A34` | Supabase Free → Pro? | **Når Usage-siden viser egress nær 5 GB/md, eller når fremmede udgør flertallet af de aktive** — de to falder formentlig sammen omkring 200–500 ugentligt aktive. |
| `A33` | Er dagsmotorens variation tyndere, end regelantallet lover? | **Når vis-bare dagskort har visninger.** `G73` (5. august 2026) rettede MÅLINGEN og ikke synligheden: de 197 efterfyldte dagskort kan stadig ikke vises, de tælles bare ikke længere i nævneren. Fremadrettede dagskort skrives inde i deres egen runde og ER vis-bare, så udløseren kan nu aflæses direkte — vis-bar > 0 og vist > 0 for dagsreglerne i Analytics. `DAY_RESULT` alene er 123 af 280 historier (44 %). |
| `A35` | Er Story Engine v3's publiceringstærskel på 45 den rigtige? | **To uger med v3 i drift og mindst ti kampdage.** Bygget 7. august 2026, så uret er startet. Måles på `stories.news_value`, som gemmes på alle rækker — også de dæmpede — netop for at kunne svare bagudrettet. Mål: 40–60 % af kampdagene med ulæst-markering. |
| `G8` | Multi-turnerings-`full_season` er stadig uafprøvet mod rigtige data | Den første konkurrence med `mode_params.tournaments` — aflæst tom igen 5. august 2026. |
| `A23` | Skal appen have en router? | Når tilbage-knappen koster brugere, eller `I12` kræver delbare interne URL'er. |
| `G1` | `MainApp.jsx` (~582) er den sidste store skærmfil | `A23`. **De fire andre er delt 5. august 2026** — `AdminScreen` 434 → 67, `HjemTab` 672 → 411, `ProfileScreen` 480 → 241, `CreateCompetitionScreen` 444 → 394 — og det, der er tilbage i `MainApp`, **ER** navigations-tilstandsmaskinen plus render-træet, altså præcis `A23`s emne. Rækken er dermed ikke længere et stykke oprydning, men en afventning: en router omskriver det, der er tilbage, og en opdeling først ville skulle laves om. |
| `A14` | Fuld Prettier-gennemformatering | Næste gang der alligevel røres bredt i frontenden — ellers aldrig. |
| `A42` | Skal en rigtig browser have en plads i CI? | **Næste gang en fejl kun kan ses i en browser.** `Modal`-fokusfejlen (11. august 2026) var den første; den blev efterprøvet i en engangs-Chromium, som ikke ligger i repoet. Én forekomst er ikke et mønster — to er. |
| `B12` | Mål, om "Anbefalet" flytter fordelingen | **Når `efter`-perioden har tosifret `antal`** i §5F-opslaget. Kørt 5. august 2026: 6 oprettelser før mærkatet, **1** efter — n=1 kan ikke måle en fordeling. Opslaget er rettet og klar til at gentages. |
| `I15` | Weekly Mix-automatikken | Reel efterspørgsel. **Udløseren er rettet 5. august 2026:** her stod, at `B12`s opslag ville sige, om Ugens kupon-kortet bruges. Det kan det ikke — `mode = 'random'` dækker både galleriets kort og en håndlavet Quick Pick, og de to kan ikke skelnes på `mode_params`. |
| `I19` | "Historik" på karriereprofilen: gamle dagskort | **Når nogen spørger efter dem.** Karrusellen var utilsigtet et arkiv, og v3 fjerner det — men rækkerne bliver i tabellen, så intet er tabt, hvis spørgsmålet kommer. |
| `I20` | QR-kode i invitations-fladen | **Når nogen savner den i situationen, den findes til** — "vi sidder sammen fysisk". Delearket dækker den i dag, og fravalget i `I7` var en pris (en afhængighed eller ~200 linjer egen encoder), ikke en principiel afvisning. |
| `I2` | Diagnose-historik | Kræver et sted at gemme snapshottet — første gang Analytics ville have brug for en tidsserie-tabel. |
| `I3` | Alarm ved tilstandsskifte i en liga | Afhænger af `I2`. |
| `A51` | Skal `og:title` følge sælgesætningen og blive fodbold-eksplicit? | Ejerens beslutning, eller næste gang `og:`-tagsene alligevel røres. **Rammer to filer**, fordi vagten binder dem sammen. |
| `B32` | Fjern CL's "Fra ligafasen"-forbehold på hjemmesidens turneringsliste | Samme udløser som `B28`: CL's ligafase lodtrækkes hos football-data.org. |
| `G123` | En generisk vagt for `drop function` + `revoke` i `sql/` | `G119` (14. august 2026) fravalgte en tekstlæsende kontrol, der kræver et `revoke execute … from public` efter hvert `drop function` i `sql/` — kun to forekomster fandtes, og en vagt over to koster mere at vedligeholde, end den kan fange. **Udløseren er en tredje forekomst:** bliver det tre, er det et mønster. |
| `G129` | Et afvist dagskort kan genopstå | **Når en bruger melder, at et kort, de afviste, er kommet igen.** `generate_daily_stories(p_day)` sletter og gen-indsætter dagens rækker ved en gen-kørsel — fx efter en resultatrettelse på en kampdag, der allerede var gjort færdig — og den nye række har et nyt `id`, som `dismissed_at` ikke fulgte med til. **Kanten er allerede skrevet ned ved koden** (`src/lib/data/activity.js`, `dismissStory`) og er kendt frem for overset; det er dét, der gør den til en udløser-række og ikke til en fejl, der skal rettes nu. Kuren er en `dismissed`-liste pr. `(user_id, day_key)`, altså en tabel for en kant, der kræver, at et resultat rettes bagud på præcis den dag, brugeren afviste. |

### Tier 7 — Udadvendt og ubesluttet

Vækst, ikke fastholdelse. Produktbogens kapitel 3 sætter dem bevidst efter alt
ovenstående, og de står i rækkefølge efter, hvad der gater hvad, ikke efter
værdi. **Én undtagelse fra "ingen af dem er besluttet":** `I10` er AFGJORT
12. august 2026 — `leagly.app` til hjemmesiden, `app.leagly.app` til appen, og
Vercel-projektet omdøbes ikke ([`DECISIONS.md`](./DECISIONS.md), runbog i
[`DOMAENE.md`](./DOMAENE.md)). `B21` er dermed skrumpet til de navne og links,
der følger med, og de to køres stadig samlet, fordi det er den samme flytning.
*(Den anden undtagelse var `B25`, som stod øverst her indtil 9. august 2026,
hvor den blev leveret — se [`MAIL.md`](./MAIL.md).)*

| # | Hvad | Bemærkning |
|---|---|---|
| `I10` | Domænet peget på hjemmesiden OG appen | **Skrumpet 9. august 2026 (`B25`), afgjort 12. august 2026, repoets del skrevet 13. august 2026.** E-mail-halvdelen er lukket, formen er valgt (`leagly.app` → hjemmesiden, `app.leagly.app` → appen, ingen omdøbning af projektet), og **trin 6 + 7 ligger nu som kode: redirect i `vercel.json`, 23 CTA'er + README flyttet, to faldbacks rettet.** ✅ **Trin 1 og 3–7 er kørt 13. august 2026, og `#196` er merget og udrullet.** Bevis 1, 3b og 4 er bestået: den gamle adresse svarer 308 mod `app.leagly.app`, `/api/` gør ikke, og en modtaget nulstillingsmail bærer `redirect_to=https://app.leagly.app/` i kilden. **Tilbage: resten af trin 8** (det gamle `?liga=`-link hele vejen, et login, `og:url`) og `B21`s GitHub-omdøbning. ✅ **Trin 2 er kørt 14. august 2026** — hjemmesidens Vercel-projekt er oprettet, og `leagly.app` er live. ✅ **Bevis 6 og 7 er bestået senere samme dag** (12:51–12:52 UTC): CSP'en fra `site/vercel.json` svarer ord for ord, og `www` svarer 308 mod apex. Tilbage af trin 8 er dermed kun appens egne aflæsninger nævnt ovenfor (`?liga=`-linket, et login, `og:url`). Runbog i [`DOMAENE.md`](./DOMAENE.md). CSP'en skal IKKE røres (to origins deler ikke headere). |
| `B21` | Omdøb GitHub-repoet | **Tekstdelen er leveret 13. august 2026 sammen med `I10`s trin 7** — de 23 CTA'er og README'ens live-link peger nu på `app.leagly.app`, altså netop ikke skiftet to gange. **Vercel-omdøbningen udgik 12. august 2026.** Tilbage er ét skridt: omdøb GitHub-repoet til `Leagly` (GitHub redirigerer selv gamle links og remotes). `docs/RESTORE.md` rettes IKKE — den navngiver backup-filer, der faktisk hedder det gamle. |
| `I9` | SEO | 🔶 **Repoets halvdel er leveret 15. august 2026 sammen med `B34`** — runbog, register, beviser og fejlfinding i [`SEO.md`](./SEO.md), vagt i `seo.test.js`. **Tilbage er kun ejerens fem trin i Search Console** (domæne-ejendom, sitemap, indeksering af forsiden, kontrol af at appen holdes ude, og Bing valgfrit). Rækken bliver i dette tier og ikke i Tier 1: den er *vækst* og ikke en aflæsning, produktet venter på, og produktbogens kapitel 3 sætter vækst efter fastholdelse — også når adgangen tilfældigvis ligger uden for repoet. |
| `I21` | OG-billede med ligaens eget navn | Den dyre udgave af `I17` (leveret 13. august 2026): et billede pr. liga kræver skriftgengivelse på serveren, hvor `I7`s løsning lod `og:title` bære ordlyden og billedet være statisk. |
| `B20` | Personlige invite-links (attribution) | Står nu alene: `I7` gennemgik flowet 11. august 2026 og **blotlagde præcis den mekanik, rækken beskriver** — afsenderens navn kunne kun komme i den tekst, afsenderen selv sender, og det dynamiske link-preview må sige "Kom med i ligaen X" frem for "Nikolaj har inviteret dig", fordi modtagersiden ikke kender afsenderen. `invite_preview()` er formet, så `B20` kun skal tilføje ét felt i svaret. Over `I6`, som ikke kan måle en ambassadør uden den. **Tieret ét sted, hvor ventetid koster:** attributionen kan først tælle fra udrulningsdagen. |
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
| A34 | **Hvornår skiftes Supabase Free ud med Pro?** | Free-planens tre lofter bider i denne rækkefølge: **egress (5 GB/md)** først — appen er REST-fetch-tung, så et sted mellem 200 og 500 ugentligt aktive nærmer forbruget sig loftet; **database (500 MB)** langt senere (tips-rækker er små; `analytics_events` var den hurtigst voksende tabel og har siden `G77`, 7. august 2026, et loft på 18 måneder, så væksten er nu bundet frem for åben); og **backup-vilkåret** er kvalitativt: 24 timers datatab (afsnit 22) er valgt til venner, og når fremmede udgør flertallet, er Pro's backups prisen værd. Aflæses på Supabase-dashboardets Usage-side — én gang om måneden, ikke oftere. Vercel Hobby er IKKE samme spørgsmål: dens tunge trafik skalerer med turneringer, ikke brugere, og skiftet dér udløses af kommercialisering (vilkårene), ikke af brugertal. | Egress nær loftet, eller fremmede i flertal blandt de aktive. |
| A35 | **Er publiceringstærsklen på 45 den rigtige?** | Story Engine v3 udgiver dagens kort med ulæst-markering, når nyhedsværdien når 45, og som dæmpet `DAY_RESULT` under. Tallet er udledt af grundvægtene (max for `DAY_RESULT` alene er 40), ikke af data — samme slags kvalificerede gæt som v1's A4-tærskler var, og de blev kalibreret på live-data. `story_score_distribution` logger vinderregel, `news_value` og runner-up, så fordelingen kan aflæses uden ny instrumentering. | **Efter to uger med v3 i drift og mindst ti kampdage.** Målet er 40–60 % af kampdagene med ulæst-markering for en aktiv bruger. Over 70 % ⇒ tærsklen er for lav, og v3 har genskabt v2's problem i ny indpakning. Under 25 % ⇒ Hjem er stille igen, og v2's oprindelige problem er tilbage. |
| A33 | **Er dagsmotorens variation tyndere, end regelantallet lover?** | Story Engine v2 lagde syv dagsregler til, men `DAY_RESULT` alene står for 123 af 280 historier (44 %), og de næste to (`DUEL` 35, `COLLECTIVE_MISS` 19) er tilsammen mindre end halvdelen af den. En motor, der er markedsført på bredde og leverer det samme kort hver anden gang, er en anden oplevelse end tabellen antyder. **Spørgsmålet kan ikke stilles endnu:** ingen af de 197 dagskort er nogensinde blevet vist (`G73`), så der findes ingen, der har oplevet ensformigheden. Måske er 44 % helt rigtigt — "dagens facit" er også den mest almindelige ting at fortælle om en kampdag. **Delvist håndteret af v3 (7. august 2026):** `DAY_RESULT`s 44 % var en konstruktionsfølge — laveste prioritet, udløses altid — og v3 fjerner årsagen ved at give den grundvægt 8, hvilket gør den til fald-tilbage frem for anker. Spørgsmålet om, hvorvidt de øvrige seks regler faktisk varierer, er **ikke** besvaret og skal aflæses på ny fordeling. | Når dagskort faktisk bliver set, altså efter `G73`. |
| A42 | **Skal en rigtig browser have en plads i CI?** | Testopsætningen er **bevidst uden jsdom** — komponenter renderes med `renderToStaticMarkup`, og logikken lever i rene moduler, der kan efterprøves uden DOM. Valget er begrundet flere steder (`DECISIONS.md` 30. juli 2026, `features/onboarding-v1.md`) og har holdt: det er dét, der har drevet udskillelsen af `data/invites.js`, `data/createSources.js` og `onboarding.js`. **`Modal`-fokusfejlen (11. august 2026) er den første, det ikke rakte til.** Fejlen ramte hvert tekstfelt i hver dialog — man kunne skrive ét tegn, hvorefter fokus sprang til `dialog` — og den kan pr. definition ikke ses uden en browser, fordi den er en fokusflytning og ikke en returværdi. Den blev efterprøvet i en engangs-Chromium (playwright-core, ~40 linjer), som **ikke ligger i repoet**; beviset findes derfor kun i `CHANGELOG.md`, og en regression ville ikke blive fanget. **Prisen ved at sige ja** er en tung devDependency, en browser-download i CI og en ny slags test, som er langsommere og mere flaksende end resten — mod en kodebase med én forfatter og 500+ hurtige tests. **Prisen ved at sige nej** er, at fokus-, scroll- og layoutfejl kun opdages af brugere. Et mellemsvar findes: en enkelt smoke-test bag et separat script, som ikke kører ved hver PR. | **Næste gang en fejl kun kan ses i en rigtig browser.** Én forekomst er et tilfælde; to er en fejlklasse, og først da kan spørgsmålet besvares med data frem for med en formodning. |
| A44 | **Skal den globale rating vise fulde visningsnavne til brugere, man ikke deler noget med?** | **Faldt ud af `A43` 12. august 2026 og er dens ærlige rest.** Rating-fanen og Championship læser `monthly_standings`/`round_standings`/`season_standings` med `scope='ALL'` og viser dermed hver bruger til enhver indlogget. Følgen er, at listen af visningsnavne er offentlig for enhver med en konto **uanset hvor stram policyen på `profiles` bliver** — en RLS-stramning kan ikke ændre det og bør ikke forsøge, fordi den så ville modsige UI'et. Spørgsmålet er derfor ikke, om navnene kan hentes, men om de skal VISES: i det kontrollerede felt er en global tavle med enogtyve kendte navne hele pointen; når fremmede kan oprette konti, er den samme tavle en komplet brugerliste, som ét skærmbillede leverer. **Tre veje:** behold (den globale titel — Månedens Champ, sæsonchampionshippet — giver kun mening, hvis den er global); vis top-N plus egen placering og navngiv resten som `#42` (afgrænser mængden uden at fjerne titlen); eller lad brugeren stå under et navn, der kun gælder uden for egne ligaer (koster en kolonne og en filtrering i hver eneste stilling). **Navnene er selvvalgte og case-insensitivt unikke** (`username_available`), altså allerede pseudonymer — hvilket er argumentet for at lade dem stå. | **Udløseren er sprunget** — `B26` blev kørt 12. august 2026, så oprettelsen er åben for fremmede. Men i modsætning til `A43`, som delte den udløser og blev afgjort samme dag, er denne ikke uigenkaldelig: visningen kan ændres bagefter, og prisen ved at vente er kun, at flere navne allerede er hentet. |
| A14 | **Skal hele kodebasen gennemformateres med Prettier?** | `npm run format` findes, men `format:check` er bevidst ikke et CI-trin. En fuld gennemformatering ville omskrive ~6.700 linjer ved `printWidth: 140` (~14.000 ved standard 80) på tværs af ~126 filer (86 uden testfiler; genmålt august 2026). Prisen er hele repoets `git blame`; gevinsten er konsistens i en kodebase med én forfatter og en i forvejen ensartet håndstil. Beslutningen er **udskudt, ikke truffet** — se [`DECISIONS.md`](./DECISIONS.md), 30. juli 2026. | Næste gang der alligevel røres bredt i frontenden — ellers aldrig. |
| A23 | **Skal appen have en router?** | Navigation er i dag to `useState` i `MainApp.jsx` (`tab` + `screen`), og deep links læses ved boot og strippes straks via `history.replaceState` (`App.jsx:104`, `MainApp.jsx:215,239`). Følgen er ingen tilbage-knap, ingen browser-historik og ingen delbare URL'er til interne skærme — mærkbart for en PWA, hvor telefonens tilbage-gestus forventes at virke. Men det er et arkitekturvalg, ikke en fejl: afhængighedsfattigheden er bevidst (fire runtime-deps, ingen router, `docs/reviews/2026-08-app-review.md` §7), og en router omskriver hele navigations-tilstandsmaskinen inkl. begge deep-link-join-flows, som ingen test dækker. | Når tilbage-knappen enten koster brugere (kan aflæses i analytics) eller en feature kræver ægte delbare interne URL'er — `I12`s offentlige ligaside er den første, der ville. |
| A39 | **Skal et dagskort kunne udgives, mens en anden turnering mangler et resultat?** | `match_day_complete()` er global: den kræver, at ALLE kampe på dagen har resultat, uanset turnering og uanset konkurrence. Én udsat eller uindberettet kamp i én turnering blokerer derfor dagskortet for hver eneste bruger, også dem, hvis konkurrencer slet ikke rører den turnering. **Prisen er bevidst og dokumenteret** — den globale kampdag er produktets ene tvær-turneringsbegreb, og et kort pr. konkurrence ville skulle vælge, hvilken dag der er *dagen* — men den blev betalt synligt under `A38`s undersøgelse, hvor det tog tid at afgøre, om stilheden var en fejl eller en ventende kamp. **To veje:** afgrænse fuldførtheden til de kampe, modtagerens egne konkurrencer dækker (kortet bliver personligt og kan skrives på forskellige tidspunkter for forskellige brugere), eller beholde den globale dag og gøre blokeringen aflæselig, så stilheden kan skelnes fra en fejl. Den første koster determinismen i acceptkriterie 7; den anden koster ingenting og løser heller ikke noget. | **Når `sql/checks/day_card_coverage.sql` melder en blokeret dag, nogen faktisk savnede.** Kontrollen findes siden `A38` og er dermed selve udløseren — indtil den melder noget, er problemet teoretisk. |
| A51 | **Skal `og:title` følge sælgesætningen og blive fodbold-eksplicit?** | `B30` gjorde sælgesætningen fodbold-eksplicit 13. august 2026, men lod OVERSKRIFTEN stå: `index.html`s `og:title` er fortsat *"Leagly — gæt resultater mod dine venner"*. Den blev holdt uden for rækken med vilje frem for taget med i forbifarten — den er en **anden** dublet med sine egne to aftagere (`og:title` i `index.html` og `GENEREL_TITEL` i `api/invite-preview.js`), bundet sammen af vagtens syvende påstand. **Argumentet for at ændre den:** i et delt link er titlen den største tekst, og den siger nu noget mindre præcist end beskrivelsen lige under. **Argumentet imod:** titlen står ALDRIG alene — den vises sammen med `og:description`, som siger "fodboldkampe" to linjer nede, og med `og:image`. En titel, der gentager ordet, bruger sin korte plads på noget, læseren allerede får. Titlen bærer i dag produktnavnet plus én ting produktet gør, hvilket er den opgave, en titel har. **Prisen ved at ændre er to linjer**; prisen ved at lade være er en asymmetri, der kun ses, hvis man læser de to tags efter hinanden. **Hjemmesidens egen `<title>`** (*"Slå dine venner. Uge efter uge."*) er bevidst en tredje ordlyd og måles ikke af vagten — den skal ikke trækkes ind. | **Ejerens beslutning**, eller næste gang `og:`-tagsene alligevel røres. Ingen ekstern udløser. |

## Ubygget

| # | Hvad | Hvorfor / hvad den venter på | Omfang |
|---|---|---|---|
| B21 | **Omdøb GitHub-repoet** | Navneskiftet 4. august 2026 gik gennem app, manifest, ikoner, tekster og dokumentation, men stoppede ved projektnavnene — **med vilje**, fordi et skifte af Vercel-projektet ændrer `.vercel.app`-adressen og dermed knækker hvert link, der peger på den. **`I10`s beslutning 12. august 2026 fjernede rækkens farligste halvdel** (Vercel-projektet omdøbes IKKE), og **tekstdelen er leveret 13. august 2026** som `I10`s trin 7: de 23 CTA'er i `site/` (4+5+6+4+4) og README'ens live-link peger nu på `app.leagly.app`. At de blev flyttet i samme ombæring som redirectet var hele pointen — ellers var de samme 23 links skiftet to gange. **Tilbage er ét skridt uden for repoet:** omdøb GitHub-repoet til `Leagly`; GitHub redirigerer selv gamle links og remotes. `docs/RESTORE.md`s omtale skal IKKE rettes: den navngiver backup-filer, der faktisk hedder det gamle. | Lille — ét dashboard-skridt |
| B20 | **Personlige invite-links** (`invite_links` + `invited_by` på `group_members`/`competition_participants`) | Attributionen "hvem inviterede hvem" findes ikke i skemaet: `groups.invite_code` er én kode pr. liga og ikke pr. bruger, og ingen af medlemstabellerne gemmer afsenderen. Det er derfor, milepælen **"5/10 venner tilmeldt via dit link" ikke kunne bygges** — `milestones` tæller i stedet `LEAGUE_GREW_5/10`, altså hvor mange der kom med i en liga, man har oprettet, hvilket er en anden bedrift. Begrundelsen står ved koden begge steder (`sql/milestones.sql`, `src/lib/milestones.js`) og peger på denne række. **Ventetid er ikke gratis her, og det er rækkens vigtigste egenskab:** attribution kan kun registreres fremad, så en bedrift bygget på den kan først tælle fra udrulningsdagen — de brugere, der allerede er inviteret, tælles aldrig. Gater desuden `I6` (ambassadørprogram), som ikke kan måle noget uden. **`I7` (11. august 2026) rørte flowet uden at trække rækken ind** og er formet, så den kan sættes ind bagefter: `invite_preview()` og `api/invite-preview.js` tager begge en KODE, og en per-bruger-token kan gå ad samme vej. Se `DECISIONS.md` for hvorfor de to attributioner ikke er den samme ting. | Mellem |
| B28 | **Gentag CL's kickoff-aflæsning, når ligafasen er lodtrukket** | Champions League var den ene af fem turneringer, [`docs/reviews/football-data-kickoff-aflaesning-2026-08-07.md`](./reviews/football-data-kickoff-aflaesning-2026-08-07.md) ikke kunne dække — leverandøren havde pr. 1. august 2026 endnu ikke oprettet sæsonen 2026, fordi ligafasen ikke var lodtrukket (`B8`, lukket 1. august 2026). De fire aflæste turneringer delte sig i to: kun Bundesliga sender en ren midnats-pladsholder (`status: SCHEDULED` + `00:00`), de tre andre sender et opdigtet klokkeslæt for hver ufastsat kamp uden nogen markør at skelne på. Om CL ligner Bundesliga eller de tre andre, afgør om `kickoff_uncertain`s mønstergenkendelse (`G84`/`G85`) også dækker turneringen — og er kun kendt, når svaret aflæses. | Lille (samme PowerShell-opslag, gentaget) |
| B12 | **Mål, om "Anbefalet" på Sæson-kortet flytter fordelingen** | Mærket blev sat på i `A22` netop for at flytte, hvilken mode nye brugere vælger, men effekten er aldrig aflæst — og et anbefalings-mærke, der ikke virker, er værre end ingen, fordi det bruger den plads, der skulle guide. `competition_created` bærer allerede `metadata.mode`, så før/efter kan opgøres uden ny instrumentering. Samme opslag svarer på `I15`s åbne spørgsmål om, hvorvidt Ugens kupon-kortet bruges. Forespørgslen står i [`features/analytics-v1.md`](./features/analytics-v1.md) §5F sammen med de tre forbehold, svaret skal læses med (lille datamængde, lossy hændelseslog, og at kort-rækkefølgen blev vendt samme dag som mærkatet kom på). **Rækken har stået siden august 2026 med teksten "tilbage står at køre den" — og da den blev kørt 5. august 2026, kunne den ikke:** vinduet partitionerede på `(e.created_at < m.fra)`, som hverken står i `group by` eller er aggregeret, så PostgreSQL afviste den med `42803`. Perioden udledes nu i en CTE, efterprøvet mod PostgreSQL 16.13. **Anden kørsel samme dag afslørede, at kilden var forkert valgt:** hændelsesloggen svarede med tre oprettelser i alt, alle `random` — plausibelt nok ved ~20 testbrugere, men ubrugeligt, fordi `analytics_events` først findes fra 30. juli 2026, så "før mærkatet" var to døgn og ikke appens historik. `competitions.mode` + `created_at` bærer samme oplysning som **rigtige rækker over hele historikken**, og spec'ens §5F er byttet om, så tabellen er den primære kilde og hændelsen kontrollen. **Opslaget er kørt 5. august 2026, og svaret er "ikke endnu":** hele appens historik rummer **syv** konkurrencer — 6 før mærkatet (`time_range` 2, `random` 2, `full_season` 2) og **1** efter (`random`). Med n=1 i den ene periode kan ingen fordeling måles, hvilket er præcis rækkens eget første forbehold. Rækken er derfor flyttet til Tier 6 med en udløser, der kan aflæses med samme opslag: **tosifret `antal` i `efter`-perioden.** Det, der er leveret, er ikke svaret, men at spørgsmålet nu kan stilles — forespørgslen kunne hverken køre eller pege på den rigtige kilde, da rækken blev skrevet. | Lille (opslag) |
| B32 | **Fjern Champions League's "Fra ligafasen"-forbehold på hjemmesidens turneringsliste** | `site/index.html`s turnerings-sektion (merget 13. august 2026) viser Champions League med mærkatet "Fra ligafasen", fordi ligafasen endnu ikke er lodtrukket (samme forudsætning som `B8`/`B28`). Mærkatet skal fjernes samtidig med, at `B28`s kickoff-aflæsning gentages for CL. | Lille — én linje, samme udløser som `B28` |

## Teknisk gæld

| # | Gæld | Hvorfor den betyder noget | Omfang |
|---|---|---|---|
| G1 | **`MainApp.jsx` (~582 linjer) er den sidste store skærmfil.** | Sidste rest af fil-opdelingen fra 30. juli 2026. **De fire andre er delt 5. august 2026** — `AdminScreen` 434 → 67 (fire paneler i `screens/admin/`), `HjemTab` 672 → 411 (tre kort i `screens/hjem/`), `ProfileScreen` 480 → 241 (fem sektioner i `screens/profile/`) og `CreateCompetitionScreen` 444 → 394. Komponent-flytningerne er rene: intet JSX-element og ingen brugertekst er ændret, kun fordelt. **Det, der var værd at hente, var ikke linjetallet, men de to lib-moduler:** `data/createSources.js` og de to nye funktioner i `data/home.js` lå som `useEffect`-kroppe og kunne kun efterprøves i hånden; de har nu 27 tests, hvoraf tre vogter regler, der fejler TAVST (kampantal pr. turnering, `G35`; kamp-puljens mærkbare afkortning; en fejlende konkurrence springes over frem for at vælte hele Hjem). Samme snit og samme begrundelse som `MainApp`s invitations-flows fik samme dag. **Det, der er tilbage i `MainApp`, ER navigations-tilstandsmaskinen** plus render-træet — altså `A23`s emne — og rækken er derfor flyttet til Tier 6 med `A23` som udløser. | Lille — men gated af `A23` |
| G123 | **Ingen generisk vagt for `drop function` + `revoke` i `sql/`.** | `G119` (14. august 2026) fravalgte en tekstlæsende kontrol, der kræver `revoke execute … from public` efter hvert `drop function` — kun to forekomster fandtes, og en vagt over to koster mere at vedligeholde, end den kan fange. Flyttet til Tier 6: en tredje forekomst gør det til et mønster. | Lille, men ikke før udløseren |
| G129 | **Et afvist dagskort kan genopstå.** `generate_daily_stories(p_day)` sletter og gen-indsætter dagens rækker ved en gen-kørsel; den nye række har et nyt `id`, og `dismissed_at` blev i graven sammen med den gamle. | Udløses kun af en gen-kørsel EFTER at dagen er gjort færdig — i praksis en resultatrettelse bagud på præcis den dag, brugeren afviste. **Kanten er kendt og står allerede skrevet ved koden** (`src/lib/data/activity.js`, `dismissStory`), tilføjet sammen med `I25` 15. august 2026, som var det, der gav dagskortet et Afvis-kryds overhovedet. Rækken findes, fordi begrundelsen ellers kun ville stå ét sted og aldrig blive taget op igen — ikke fordi den skal rettes nu. Kuren er en `dismissed`-liste pr. `(user_id, day_key)`, altså en tabel, en policy og en ekstra læsning i `loadDayCard` for en kant, ingen endnu har meldt. Flyttet til Tier 6 med den første melding som udløser. | Lille—mellem, men ikke før udløseren |
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
| I9 | **SEO for hjemmesiden** | **Repoets halvdel er lukket 15. august 2026** med `B34`: `og:locale` og `og:image:alt` på alle fem sider, `site/404.html`, cache på `/css/`, appens `noindex`-header og `public/robots.txt` — plus [`SEO.md`](./SEO.md), som samler registeret, ejerens trin, seks beviser og fejlfindingen ét sted, og `seo.test.js`, som vogter dem. Tilbage står de fem trin i Search Console, som kræver en Google-konto. | Ejerens tur — repoet er klar |
| I10 | **Domænet peget på hjemmesiden og appen** | **Halvt leveret 9. august 2026 (`B25`), formen afgjort 12. august 2026.** E-mail-halvdelen er væk: `kontakt@leagly.app` står i `src/lib/legal.js` og `site/om.html`, og pladsholderne `[NAVN]`/`[KONTAKT-E-MAIL]` er udfyldt. Den anden halvdel er nu besluttet frem for åben: **`leagly.app` → hjemmesiden, `app.leagly.app` → appen**, begge på Vercel, projektet omdøbes ikke, og de gamle `.vercel.app`-adresser redirigeres permanent. Begrundelsen står i [`DECISIONS.md`](./DECISIONS.md) (kort: invitationslinks bygges af `window.location.origin`, så det er appens adresse, brugerne deler). **CSP'en skal ikke justeres** — to origins deler ikke headere, og `site/` er selvbærende. **Repoets del er skrevet 13. august 2026:** redirect af de to gamle `.vercel.app`-værtsnavne i `vercel.json` (trin 6), `B21`s 23 CTA'er + README (trin 7) og to faldback-adresser i `vite.config.js`/`api/invite-preview.js`. **`/api/` er med vilje undtaget fra redirectet**, så de ni cron-jobs ikke skal flyttes samtidig — begrundelsen står ved reglen i [`DOMAENE.md`](./DOMAENE.md). ✅ **Trin 1 og 3–7 er kørt 13. august 2026:** domænet er oprettet og svarer, Supabases Site URL er flyttet og testet, Turnstile-værtsnavnet er **udvidet** (ikke skiftet), og `#196` er merget og udrullet. **Bevis 1 og 3b er bestået** — den gamle adresse svarer 308 mod `app.leagly.app`, og `/api/sync-live` svarer 401 og ikke 308, med appens egen CSP-header på, altså helt frem til funktionen. **Bevis 4 er bestået 13. august 2026:** en modtaget nulstillingsmail bærer `redirect_to=https://app.leagly.app/` i kilden, og det felt bygger Supabase af Site URL — altså er trin 4 nu bevist og ikke kun meldt. **Tilbage: resten af trin 8**, hvor beviserne afgør, om de øvrige meldte dashboard-trin faktisk virkede — det gamle `?liga=`-link hele vejen, et login på den nye adresse og `og:url`. | Trin 2 er kørt 14. august 2026 (`I8` leveret), og bevis 6 + 7 bestod samme dag — kun trin 8's sidste aflæsninger står tilbage |
| I11 | **LinkedIn-side**, hvis der satses på indtægt via virksomheder | Betinget af en B2B-retning, der ikke er besluttet endnu. | Betinget af B2B-retning |
| I12 | **Offentlig side pr. liga** (fx `predictionhub.app/league/padel-legends`: antal sæsoner, medlemmer, mestre, statistik — ikke tips, kun historik) | Bygger videre på liga-laget (§18) som en delbar, offentlig facade for hver liga. Kræver stillingtagen til, hvad der må vises uden login. | Ny |
| I15 | **Weekly Mix** — automatikken: et job, der opretter ugens kupon af sig selv | **Indholdet er leveret 1. august 2026 (A22):** opret-galleriet har et "Ugens kupon"-kort — `random`, én runde frem, alle turneringer, navnet genereret — så en bruger leverer kuponen manuelt med to tryk. **Tilbage står KUN gentagelsen**, og dens to ubesluttede punkter: (1) **hvem skriver?** — enhver konkurrence skrives i dag af sin egen opretter, og RLS kræver `created_by = auth.uid()`, så et ugentligt job skal køre som `service_role` (mønsteret findes nu: `award_competition_periods()` tillader allerede `service_role`); (2) **"mest interessante kampe"** — der findes hverken odds eller tabelstilling i basen, så et automatisk udvalg bliver heuristik, hvilket støder på kap. 1's *"odds og avanceret analyse må aldrig overskygge det sociale formål"* — den leverede kupon undgår spørgsmålet ved at trække tilfældigt. Weekly Mix ville desuden være et **andet** ugentligt begreb ved siden af den globale spillerunde (som **er** produktets ugentlige tvær-turneringsbegreb) — det er dét, der skal begrundes. | Afventer efterspørgsel. **Målingen, der var betingelsen, viste sig ikke at kunne laves (5. august 2026):** `mode = 'random'` dækker både galleriets Ugens kupon-kort og en håndlavet Quick Pick, og `mode_params` skiller dem ikke — `rounds` skrives kun ved > 1 runde, hvilket begge kan have. Skal kortets brug måles, kræver det en ny hændelse eller et felt, altså instrumentering og ikke et opslag |
| I18 | **i18n-lag: al brugertekst ud af komponenterne** | Flersprogethed er den valgte vej til marked #2 (august 2026: dansk-først er bevidst, flere sprog HVIS dansk lykkes) — men appen har i dag intet tekstlag, så det bliver en ombygning og ikke en oversættelse. Noteret nu af én grund: prisen betales løbende. Hver ny skærm, der hårdkoder sine tekster, gør ombygningen dyrere, og en stille disciplin (nye tekster samles ét sted, når der alligevel røres ved en skærm) er gratis fra i dag. | Betinget af dansk succes |
| I19 | **"Historik" på karriereprofilen: gamle dagskort** | Karrusellen var utilsigtet også et arkiv — man kunne rulle tilbage i ugens kort. v3 fjerner det, og spørgsmålet er, om nogen savner det. Modargumentet er stærkt: en historikliste over dagskort er præcis den rundelog, `milepaele-v1.md` skilte karriereprofilen af med, og rækkerne bliver i tabellen uanset hvad (de filtreres allerede fra på prioritetsbåndet). | **Vent til nogen spørger.** Bygges den præventivt, er den bygget af samme grund som karrusellens loft på 10 — fordi det kunne lade sig gøre. |
| I20 | **QR-kode i invitations-fladen** | Til den ene situation, et link er dårligere end et billede: "vi sidder sammen fysisk". **Fravalgt i `I7` (11. august 2026) på pris, ikke på princip** — den koster enten en ny afhængighed eller ~200 linjer egen encoder, og repoets afhængighedsfattigdom er et bevidst valg (fire runtime-deps). Delearket dækker situationen i dag, bare dårligere: man skal finde modtageren i en kontaktliste frem for at pege et kamera. Står i spec'ens "Bevidst ikke med i v1" med samme begrundelse. | Fravalgt i `I7` — hentes frem, hvis nogen savner den |
| I21 | **OG-billede med ligaens eget navn** | `I7` gav invitationslinket et udseende, men billedet er statisk (`public/og-image.png`, 1200×630) og **`og:title` bærer hele ordlyden** — "Kom med i ligaen X" står som tekst under et generisk billede. Et billede med ligaens navn *i* sig ville være det, der faktisk fylder i en gruppechat. **Prisen er skriftgengivelse på serveren:** en font skal indlejres og et billede tegnes pr. kald, hvilket er en anden slags afhængighed end resten af `api/`, og det skal ske inden for edge-funktionens budget. Hører efter `I17`, som er den billige halvdel af samme idé. | Fravalgt i `I7` — hører til `I17`s runde |

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

### 16. august 2026 (tredivte kørsel) — Tier 5 kørt tom: de to delinger har en aflæsning nu

**Listen er 33 → 32** (`B37` lukket). **Tier 5 er tomt**, og dermed er Tier 1,
2 og 5 alle tømt samme dag; kun Tier 6 (venter på en udløser) og Tier 7
(udadvendt) bærer rækker.

**Halvdelen krævede ingen SQL overhovedet, og det var værd at opdage FØR
migreringen blev skrevet.** `admin_analytics_engagement` har hele tiden svaret
`events` som en generisk optælling pr. hændelsesnavn, så både `standings_shared`
og `story_shared` lå allerede i svaret — de manglede kun et sted at stå. To
tiles i Engagement-sektionen aflæser dem nu, og de virker uden at røre
databasen.

**Opdelingen krævede derimod SQL**, fordi den bor i `metadata.from`:
`admin_analytics_engagement` svarer nu `shares` med fire flader — rundekort
(`frame:ROUND_SUM`/`frame:RATING` OG de historiske rækker helt uden `from`),
dagskort, milepæl og stilling. Ændringen står i `sql/analytics_dashboard.sql`
(#17) og ikke i en ny migrering: filen er registreret som *"sikker og forventet
at blive gen-kørt"*, og en kopi af to lange RPC'er ville være præcis den
landmine, `sql/README.md` advarer mod ved `generate_stories()`.

**Rækken afdækkede en forurening, ingen havde ledt efter.** Karriereprofilens
del-knap skriver milepælsnøglen som `rule`, og `MONTH_CHAMP` er BEVIDST både en
milepælsnøgle og en story-regel (kommentaren står i `src/lib/milestones.js`).
Milepæls-delinger blev derfor talt med i Story Engine-regeltabellens
`Delt`-kolonne. De er nu filtreret fra dér og tælles som deres egen flade.

**Umålt må ikke ligne nul.** Er RPC'en ikke gen-kørt, mangler `shares`, og
panelet skriver "ikke målt endnu" frem for fire nuller — `G115`s regel en gang
til. Vagten er `shareSurfaceRows()` med fire tests, og et tomt vindue svarer
bevidst `{}` og ikke `null`, så "målt til nul" og "umålt" kan skelnes.
