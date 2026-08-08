# Story Engine v3 — ét øjeblik om dagen (august 2026)

> **LEVERET 7. august 2026.** Afsnit 1–12 nedenfor er udkastet, som det så ud
> før implementeringen, og det er bevaret med vilje. **§13 er tilføjet efter
> leveringen og beskriver, hvor den byggede motor afviger fra udkastet** — læs
> den, før du bruger et tal herfra. Tre steder holdt udkastet ikke mødet med en
> database, og ét af dem er et regnestykke i §5, som er forkert som skrevet.

Bygger videre på `story-engine-v1.md` (runde-motoren, tonen, de 16 runde-regler) og `story-engine-v2.md` (dags-motoren, den danske dag, bagstopperen, prioritetsbåndet). Denne fil beskriver **kun det, v3 ændrer**, og v3 ændrer næsten udelukkende *udvælgelse og visning* — ikke hvornår motoren kører.

## 1. Problemet

v2 løste tavsheden mellem to mandage og skabte en ny slags støj i stedet. Regnestykket for en aktiv bruger i en uge med kampe fem dage:

| Kilde | Kort |
|---|---|
| Dags-motoren, `DAILY_MAX_CARDS = 2` | op til 10 |
| Runde-motorens konkluderende kort | 1 |
| Nyopnåede milepæle, forrest, kan ikke afvises | 0–3 |

`CAROUSEL_LIMIT = 10` var ikke et loft, der sjældent blev ramt. Det var ugens normaltilstand.

To ting følger af det, og de er begge blevet observeret:

1. **Karrusellen blev en indbakke.** Et vandret felt med ti kort er noget, man rydder eller ignorerer — ikke noget, man læser. `DAY_RESULT` optager per konstruktion plads 1 hver eneste dag (§3 i v2: *"ankeret; optager reelt altid plads 1"*), så det første, man møder, er også det mest forudsigelige.
2. **Ingen enkelt historie kunne huskes.** Et øjeblik, der deles med ni andre, er ikke et øjeblik. Målsætningen for feature'en har hele vejen været, at brugeren skal kunne genfortælle dagens historie i en gruppechat. Ti kort kan ingen genfortælle.

Diagnosen er ikke, at der genereres for ofte. Daglig generering fastholdes uændret. Diagnosen er, at motoren **udgiver alt, den finder**, i stedet for at vælge.

## 2. Låste beslutninger

1. Der genereres fortsat en historie hver dag, hvor dagens sidste kamp er færdigspillet. Ingen kampe ⇒ intet. Uændret fra v2.
2. **Højst ét kort pr. bruger pr. dag**, på tværs af alle ligaer og konkurrencer. `DAILY_MAX_CARDS` går fra 2 til 1, og loftet er ikke længere "pr. regel, derefter i alt" — der er kun ét slot.
3. **Hverdage handler om dramaet mellem spillerne.** Rundens sidste dag handler om **brugerens egen præstation**.
4. Milepæle får **aldrig** deres eget kort i køen, men kan kapre dagens ene slot (§6).

## 3. Modellen

| | v2 | v3 |
|---|---|---|
| Kort pr. dag pr. bruger | ≤ 2 | **1** |
| Kort på Hjem | karrusel, ≤ 10, akkumulerer gennem runden | **ét kort** — dagens; det forrige er væk |
| Valg mellem kandidater | fast prioritet, laveste tal vinder | **nyhedsværdi-score**, højeste vinder |
| Rundens sidste dag | dagskort **og** rundekort | **kun** rundekortet |
| Milepæl | eget guldkort forrest | kaprer dagens slot, eller frame 5 i rundestoryen |
| Format | ét kort pr. historie | hverdag = ét kort · runde = tap-through, 4–5 frames |

Runde-motoren, dags-motorens køretidspunkt, `match_day`, `round_key_of_date`, bagstopperen `generate_stories_catchup` og triggerens to porte er **uændrede**. v3 rører ikke §5, §6 og §7 i v2.

## 4. Udvælgelsen: nyhedsværdi

Reglerne fra v2 bevares som **kandidatgeneratorer**. Det, der er nyt, er at hver kandidat får en score, og at kun vinderen udgives.

```
nyhedsværdi = grundvægt + størrelse + nærhed
```

### Grundvægt

| Regel | Grundvægt | Bemærkning |
|---|---|---|
| `MILESTONE` | 100 | vinder altid; se §6 |
| `DAY_TOP` | 34 | dagens højeste i konkurrencen |
| `CONTRARIAN` | 32 | den eneste, der ramte |
| `DUEL` | 30 | nærmeste rival flyttede sig |
| `STREAK_STATUS` | 28 | stimen lever eller brød |
| `COLLECTIVE_MISS` | 24 | ingen ramte |
| `SO_CLOSE` | 18 | ≥2 nærmisser |
| `DAY_RESULT` | 8 | ankeret — kan aldrig alene nå tærsklen |

Alle v2-tærskler (≥4 tippede, ≥3 deltagere, `is distinct from` på duel-afstanden, ≥2 nærmisser) er **bevaret uændret**. De afgør, om en kandidat overhovedet dannes; scoren afgør, hvilken der udgives. Uden dem ville scoringen bare rangordne støj.

### Størrelse (0–30)

Tre bidrag, summen loftes ved 30:

| Bidrag | Beregning | Max |
|---|---|---|
| Placeringsændring | 6 pr. plads | 18 |
| Afstand til dagens gennemsnit i konkurrencen | 3 pr. point over | 12 |
| Stimelængde ud over 5 | 2 pr. runde | 12 |

### Nærhed (0–20)

Det bidrag, der gør en fremmeds aften til brugerens historie:

| Relation | Point |
|---|---|
| Brugeren er hovedpersonen | 20 |
| Hovedpersonen er brugerens nærmeste rival (afstand ≤ 3) | 14 |
| Hovedpersonen er i brugerens største liga | 8 |
| Alt andet | 4 |

**Nærhed beregnes pr. bruger, ikke pr. hændelse.** Samme kamp giver derfor forskellige kort til forskellige brugere, og det er meningen. Det er også grunden til, at slottet er `(user_id, day_key)`-unikt og ikke `(competition_id, day_key)`.

### Afgørelse ved lige score

1. Højeste grundvægt.
2. Derefter kandidaten fra den største konkurrence (flest deltagere).
3. Derefter laveste `rule`-nøgle alfabetisk — deterministisk, så en gen-kørsel giver samme kort.

## 5. Tærsklen og det dæmpede fald-tilbage

**Publiceringstærskel: 45.**

- Vinder ≥ 45 ⇒ kortet udgives som **dagens historie** med ulæst-markering.
- Vinder < 45 ⇒ kortet udgives som **dæmpet** `DAY_RESULT` uden ulæst-markering: dagens facit, ingen påstand om at der skete noget.

Det dæmpede kort findes allerede som kortudgave i v2 (§9, *"dæmpet — mindre overskrift, uden emoji, uden Del"*), så v3 tilføjer ingen ny visning her. Pointen er, at **ulæst-signalet bliver sjældent nok til at betyde noget**. Et badge, der lyser hver dag, er ikke et signal, det er en baggrundsfarve.

`DAY_RESULT` med grundvægt 8 kan maksimalt nå 8 + 12 + 20 = 40 og kommer derfor aldrig over tærsklen ved egen kraft. Det er tilsigtet: dagens facit er en oplysning, ikke en historie.

**Tærsklen 45 er et kvalificeret gæt og skal måles, ikke tros.** Kør den i to uger med logning af scorefordelingen (§10) og juster, så andelen af dage med ulæst-markering lander på **40–60 %** for en aktiv bruger. Lander den over 70 %, er tærsklen for lav, og v3 har genskabt v2's problem i ny indpakning.

## 6. Milepæle

Bekymringen, der udløste dette afsnit, er reel: hvis milepæle kun bor på karriereprofilen, går ingen ind og opdager dem. `milepaele-v1.md` §8 sagde det allerede — *"uden den plads ville de fleste aldrig opdage, at de havde opnået noget"*. v3 fjerner ikke den plads. Den fjerner kun muligheden for, at milepæle **lægger sig oven i** dagens historie.

Tre regler:

1. **En milepæl kaprer dagens slot.** Den deltager i scoringen som enhver anden kandidat, med grundvægt 100, og vinder derfor altid. Er der flere samme dag, vises den med højeste `key`-tier, og resten ligger på karriereprofilen uden nogensinde at have været på Hjem. Ét slot ⇒ mængden kan ikke eksplodere, uanset hvor mange der udløses samtidigt.
2. **Rundestoryen får en betinget frame 5**, når der er opnået mindst én milepæl i den runde: *"Ny milepæl: …"* med knappen **Se din karriere**. Det er stedets eneste deep-link til karriereprofilen, og det er placeret dér, hvor brugeren netop har fået noget at være stolt af.
3. **Milepæle kan fortsat ikke afvises**, og de er stadig permanente. `on conflict do nothing` på `(user_id, key)` er uændret.

Kataloget og alle guards i `milepaele-v1.md` §3–§4 er uændrede. Tommelfingerreglen for fremtidige tilføjelser strammes: **en aktiv bruger må ramme en milepæl ca. hver anden uge.** Rammer de oftere, konkurrerer milepælene med sig selv om det ene slot, og de sjældne drukner i de hyppige. Det er den eneste kalibrering, der er kommet til.

**Skriveren er stadig cron alene** (`api/send-notifications.js`, `milepaele-v1.md` §7). Konsekvensen for v3 er ny og skal håndteres: milepælen kan blive uddelt **efter** at dagens kort er udgivet. Se §8.

## 7. Rundestoryen

Rundens sidste dag udgiver **kun** rundekortet. Dags-motoren springes over for den dag — ikke fordi den ville fejle, men fordi to kort samme dag er præcis det, v3 afskaffer.

Rundestoryen er den ene om ugen, hvor tap-through er sit besvær værd:

| Frame | Indhold |
|---|---|
| 1 | Din runde: point, antal præcise, percentil i feltet |
| 2 | Kampen der afgjorde det: dit bedste og dit værste tip |
| 3 | Rating: ny værdi, ændring, placeringsspring |
| 4 | Rundens vinder + status i Månedsligaen |
| 5 | *Betinget:* ny milepæl + **Se din karriere** |

Frame 1 og 3 skal kunne stå alene som delbart billede uden kontekst — det er de to, folk sender videre. Delefunktionen ligger kun her; hverdagskortet har den ikke længere.

## 8. Frontend

**Hverdag: ét kort på Hjem, ingen tap-through.** Kortet sidder øverst på Hjem, over Aktive konkurrencer. Ingen friktion, intet at åbne, intet at rydde. Indholdet er overskrift + brødtekst + mini-stilling med brugerens række fremhævet + næste kamp og evt. manglende tips.

**Runde: tap-through story** med ulæst-prik og delbart billede. Det sjældne format bliver dermed faktisk sjældent, og det er dét, der gør det til en begivenhed.

Konkrete ændringer i koden:

- `DAILY_MAX_CARDS` 2 → 1.
- `CAROUSEL_LIMIT` og `sortCarousel()` udgår. `StoryCarousel.jsx` bliver til et enkelt kort (`DayCard`) plus en `RoundStory`-visning med frames. Behold `story_viewed`-logningen ved synlighed — den regel er stadig rigtig og bliver mere præcis, når der kun er ét kort.
- `pickDailyStories()` erstattes af `scoreDailyCandidates()` + `pickDay()`. Scoringen skal ligge i `src/lib/stories.js` **og** i SQL'en, med samme talværdier — samme dobbelt-vedligehold som v1 og v2, og samme risiko (§11).

  > ⚠️ **RULLET TILBAGE 7. august 2026 (`G78`).** Dobbeltheden blev bygget som beskrevet og fjernet igen tre uger senere. To ting viste sig ved eftersyn, og begge peger samme vej:
  >
  > 1. **JS-siden var død kode.** Hverken `scoreDailyCandidates()`, `pickDay()`, `sizeOf()` eller `proximityOf()` blev kaldt af appen — motoren kører i databasen, og frontenden læser den færdige række. Deres eneste aftagere var deres egne enhedstests, altså tal, der blev holdt i trit med SQL'en for at holde en test grøn, som beviste, at de var i trit med SQL'en.
  > 2. **Migreringen, backloggen forudsagde, var ikke nødvendig.** `G78` stod som "kræver en migrering af eksisterende rækker", fordi frontenden skulle kunne afgøre ulæst-markeringen uden at kende tærsklen. Det kan den allerede: motoren har præcis to udgange, og `priority < 180` betyder det samme som `news_value >= 45`. `isNewsworthy()` læser derfor prioriteten, og der blev hverken tilføjet en kolonne eller rørt en eksisterende række.
  >
  > Tallene bor nu kun i `sql/story_engine_v3.sql`, og invarianten mellem prioritet og tærskel er låst af påstand 14 i `sql/tests/story_engine_daily.sql`.
- **Udløb: 48 timer.** Et kort ældre end 48 timer vises ikke, selvom rækken bliver stående. Uden det er "dagens historie" en løgn på en tirsdag efter en stille weekend.
- **Sen milepæl:** når cron uddeler en milepæl for en dag, hvis kort allerede er udgivet, **erstattes** kortet i stedet for at der lægges et til (upsert på `(user_id, day_key)`), forudsat kortet er under 48 timer gammelt. Er det ældre, ryger milepælen på karriereprofilen uden at have været på Hjem, og frame 5 i den kommende rundestory fanger den alligevel.

## 9. Datamodel og migrering

Ingen ny tabel. Ændringerne i `stories`:

| Ændring | Begrundelse |
|---|---|
| `unique index on stories(user_id, day_key) where period = 'day'` | håndhæver ét slot i databasen frem for i applikationskoden |
| Ny kolonne `news_value int` | gør tærskeljusteringen målbar bagudrettet, og gør et forkert valg debuggbart |
| Prioritetsbåndet 110–189 **bevares** | `loadCareerMilestones` og `isQuiet()` afhænger af det; v2 §4 gælder uændret |

**Delete-scopingen fra v2 §8 er uændret og lige så farlig som før.** `generate_stories` sletter kun `period = 'round'`, `generate_daily_stories` kun `period = 'day' and day_key = p_day`. `sql/tests/story_engine_daily.sql` skal udvides med v3-tilfældet: en gen-kørsel af dagsmotoren må ikke kunne producere to rækker for samme `(user_id, day_key)`.

**Anbefaling, ikke krav:** flyt hverdagskortets tekst fra SQL til `src/lib/stories.js` og gem kun `rule` + `payload` i tabellen — præcis den model, `milepaele-v1.md` §8 allerede bruger med succes. Det fjerner den dobbelt-vedligeholdte tekst, som v1 og v2 begge har på listen over kendte begrænsninger. Det er en migrering af eksisterende rækker og hører derfor til efter, at v3's udvælgelse er valideret i drift.

Migreringsrækkefølge:

1. `sql/story_engine_v3.sql` — scoring, unikt indeks, `news_value`, dags-motoren skifter til ét slot.
2. Frontend: ét kort + rundestory.
3. `sql/story_engine_v3_cleanup.sql` — behold historiske rækker; de er analysedata, og karriereprofilen filtrerer dem allerede fra på prioritetsbåndet.

## 10. Analytics

Tilføjes til eventtaksonomien (`analytics-v1.md`):

| Event | Metadata | Spørgsmål det besvarer |
|---|---|---|
| `story_score_distribution` | `day_key`, `winner_rule`, `news_value`, `runner_up_value` | er tærsklen 45 rigtig? |
| `story_frame_viewed` | `story_id`, `frame`, `total_frames` | hvor mange når frame 4 i rundestoryen? |
| `milestone_cta_clicked` | `milestone_key` | virker frame 5 som indgang til karriereprofilen? |

Det tredje event er det, der afgør, om §6 løser den bekymring, der udløste den. Ser vi ikke et målbart løft i besøg på karriereprofilen inden for 24 timer efter en rundestory med frame 5, virker mekanismen ikke, og så skal milepæle have en anden indgang — ikke flere kort.

## 11. Acceptkriterier

1. En bruger med tre aktive konkurrencer får **højst ét** `period = 'day'`-kort pr. dag. Håndhævet af det unikke indeks, ikke kun af koden.
2. På rundens sidste dag findes der **ingen** `period = 'day'`-række for den dag.
3. En dag, hvor højeste nyhedsværdi er under 45, giver et dæmpet `DAY_RESULT`-kort uden ulæst-markering.
4. En dag uden kampe giver intet kort. Uændret fra v2 og fortsat testet.
5. En milepæl uddelt samme dag erstatter dagens kort — der findes efterfølgende stadig kun én række.
6. En milepæl uddelt i løbet af runden giver frame 5 i rundestoryen, og præcis én frame uanset antal milepæle.
7. To gen-kørsler af `generate_daily_stories` for samme dag giver **samme** kort (deterministisk afgørelse ved lige score).
8. En bruger uden tips på en kampdag får det dæmpede kort med tips-påmindelse, ikke et drama-kort om andre.
9. Karriereprofilens milepælsliste er uændret af hele v3. Regressionstest på `loadCareerMilestones`.
10. Skaleringsforsøget (`sql/tests/story_engine_scale.sql`) køres igen med referencen `recompute_ratings()`. Scoringen tilføjer én pas over kandidatsættet; forholdet til referencen må ikke stige.

## 12. Kendte begrænsninger og åbne spørgsmål

- **Tærsklen 45 er ukalibreret.** Den er valgt ud fra grundvægtene, ikke ud fra data. §5 beskriver, hvordan den justeres. Indtil målingen findes, er dette v3's svageste tal.
- **Størrelsesbidraget favoriserer store konkurrencer.** "3 point pr. point over dagens gennemsnit" har større spredning i en liga med 20 deltagere end i en med 4. Det er formentlig rigtigt — der *sker* mere i en stor liga — men det betyder, at en bruger i tre små ligaer oftere lander under tærsklen.
- **Nærhed pr. bruger koster en beregning mere.** Kandidatsættet er fælles, scoringen er ikke. Ved fuld sæson skal det holdes op mod de ~320 ms, v2's dagsmotor målte.
- **Teksten står stadig to steder**, indtil anbefalingen i §9 gennemføres. v3 tilføjer scoring til den liste over ting, der skal spejles præcist mellem SQL og JS — nu også talværdier, hvor en afvigelse ikke giver en fejl, men et *andet kort*. Det er en værre fejltype end en tekstafvigelse, fordi den er tavs.
- **Åbent:** skal de gamle dagskort være tilgængelige et sted, når karrusellen forsvinder? En "Historik"-fane på karriereprofilen er billig at bygge, men den genindfører muligvis netop den log, `milepaele-v1.md` skilte sig af med. Anbefalingen er at **vente**, til nogen spørger efter dem.


## 13. Rettelser efter levering (7. august 2026)

Udkastet ovenfor er ikke redigeret; her står, hvad der faktisk blev bygget, og
hvorfor det afviger. Fire punkter — de tre første er afvigelser, det fjerde er
arbejde, udkastet forudsatte uden at beskrive.

### 13.1 Ét-slot-indekset måtte have et led mere (§9)

Spec'en skriver `unique index on stories(user_id, day_key) where period = 'day'`.
Det kan ikke oprettes: de historiske v2-rækker har op til **to** rækker pr.
(bruger, dag), og §9 beder i samme åndedrag om at **beholde** dem som
analysedata. De to krav udelukker hinanden med det snævre prædikat.

Bygget som (`uddrag`, fordi `prepare`-tjekket i `sql/tests/docs_sql.mjs` kun
accepterer DML — en `create index` kan ikke forberedes):

```sql uddrag
create unique index stories_day_slot_uniq on public.stories (user_id, day_key)
  where period = 'day' and news_value is not null;
```

`news_value` sættes af hver eneste v3-skrivning og er dermed æra-markør:
invarianten er DB-håndhævet for alt, v3 producerer, mens v2-rækkerne bliver
stående urørt. Prædikatet er blivende sandt og ikke en dato-litteral — en dato
ville gøre CI-testens fixture (marts 2026) blind for netop det indeks, den skal
bevise. **Restrisikoen:** en fremtidig skriver, der indsætter en day-række uden
`news_value`, smutter uden om nettet. Testen påstår begge retninger, så
ændres prædikatet, fejler den og tvinger en beslutning.

### 13.2 `DAY_RESULT` får kun ét størrelsesbidrag — ellers holder §5 ikke

§5 påstår: *"`DAY_RESULT` med grundvægt 8 kan maksimalt nå 8 + 12 + 20 = 40 og
kommer derfor aldrig over tærsklen ved egen kraft."* Regnestykket forudsætter
tavst, at dagens facit kun kan få **afstands**-bidraget (max 12) — ikke
placeringsændring og ikke stime. Med hele størrelsesloftet (30) når den
8 + 30 + 20 = **58** og kan udgive sig selv som dagens historie, og så findes der
aldrig en dag under tærsklen at falde tilbage til. Hele det dæmpede
fald-tilbage ville være død kode.

Bygget efter §5's tal og ikke efter §4's tabel: `DAY_RESULT` får kun
afstandsleddet. **En enhedstest fandt det, ikke en gennemlæsning** — påstanden
`news_value < 45` var skrevet direkte fra spec'en og blev rød.

### 13.3 `MILESTONE` scorer fast 120

Milepæle får **intet** størrelsesbidrag. Ikke af æstetiske grunde: kortet kan
skrives to steder — af `generate_daily_stories` (som kender dagens
placeringsændringer) og af `apply_milestone_stories` (som ikke gør) — og de to
skal give byte-samme række, ellers falder determinismen i acceptkriterie 7.
100 (grundvægt) + 0 + 20 (nærhed) = 120, begge steder. Det er også konceptuelt
rigtigt: en engangsbedrifts vægt er, at den er sket, ikke hvor mange pladser man
tilfældigvis rykkede samme dag.

**Tilknytningsdagen** (hvilken dag en milepæl kaprer) er
`max(match_day) <= match_day(achieved_at)` — milepælens egen kampdag, eller den
seneste før. Formlen står **ordret ens** i de to funktioner, og det er dét, der
gør, at en gen-kørsel af dagsmotoren genskaber en kapring, den lige har slettet.
Ændres den ene uden den anden, går sene milepæle tabt ved næste
resultatrettelse, og det sker tavst.

### 13.4 Fan-out: nærheden krævede tredjepersons-tekster

§4 siger, at nærhed beregnes pr. bruger, og giver 14/8/4 for kandidater, hvor
brugeren **ikke** er hovedpersonen. Det forudsætter, at en kandidat kan nå en
sådan modtager — men i v2 var enhver historie "dig"-centreret, så det var nyt
arbejde. Bygget som:

| Regel | Modtagere |
|---|---|
| `DAY_RESULT`, `SO_CLOSE`, `DUEL`, `MILESTONE`, `COLLECTIVE_MISS` | kun hovedpersonen |
| `CONTRARIAN`, `DAY_TOP`, `STREAK_STATUS` | hovedpersonen + alle, der deler konkurrence med hen |

De tre fan-out-regler har derfor hver en **tredjepersons-tekstvariant**, som
skal spejles i `renderStory` som alt andet. Fan-out sker kun gennem
`competition_participants`, så designreglen om, hvem en historie må nævne, er
strukturel og ikke en betingelse, nogen kan glemme.

**Hård regel, som §11's acceptkriterie 8 kræver, men §4 ikke nævner:** en bruger
uden ét eneste scoret tip på en kampdag fjernes fra kandidatsættet helt. Uden
den kunne et fan-out-kort (34 + 20 = 54) lande hos en, der slet ikke var med.

**Observation til `A35`:** på en dag med én stor hændelse i en lille konkurrence
får hele feltet det samme fan-out-kort, fordi hovedpersonens størrelse indgår i
alles score. Det er spec-konformt, men det er værd at holde øje med, når
tærsklen kalibreres — det er den ene måde, v3 kan genskabe v2's "alle ser det
samme" i ny indpakning.

### 13.5 Ydelse: to rettelser, acceptkriterie 10 opfyldt

Første udgave gjorde runde-motoren **11× langsommere** (77 → 886 ms på en
syntetisk fuld sæson), fordi frames slog bedste/værste tip og månedsstillingen
op med laterals — Postgres sorterede hele tabellen forfra for hver bruger. Med
`distinct on`-præaggregering: 38 ms. Dagsmotorens temp-tabeller er desuden
indekseret, fordi v3 slår op i dem **pr. modtager**, hvor v2 kun scannede dem
sekventielt pr. regel.

Målt: dagsmotor 266 ms mod referencen `recompute_ratings()` 118 ms = **2,26**,
mod v2's 2,28. Forholdet steg ikke, som acceptkriterie 10 kræver. Værste
trigger-sætning 229 ms mod 1 s-grænsen.

`sql/tests/story_engine_scale.sql` måler nu en **sen, men ikke sidste** kampdag:
efter v3 returnerer motoren straks på rundens sidste dag, så den gamle måling
ville have vist 0,1 ms og påstået, at dagsmotoren er gratis.


### 13.6 Rundestoryen udløber ikke efter 48 timer (rettet efter drift)

§8 skriver udløbet på 48 timer i frontend-afsnittet, og den første udgave lagde
det på **begge** formater. Det var for stramt: rundekortet forsvandt så ~2 døgn
efter runden sluttede, hvor det i v2 levede hele runden igennem, og på en stille
uge stod Hjem helt uden historie i flere dage. §8's egen begrundelse handler
udtrykkeligt om dagskortet — *"uden det er 'dagens historie' en løgn på en
tirsdag efter en stille weekend"* — og gælder ikke ugens konklusion.

Bygget: **rundestoryen lever, indtil den nye runde har noget at fortælle.**
Afløsningen kræver ingen ny mekanik, fordi visningsreglen allerede gør det —
`roundIsNewer` viser rundekortet, medmindre der findes et nyere dagskort, og et
nyere dagskort er per konstruktion fra den nye runde: matches-triggeren kører
dagsmotoren før runde-motoren, så den gamle rundes dagskort er altid ældre end
rundekortet.

> ⚠️ **Rettet igen 7. august 2026 (nat) — afsnittet ovenfor er ikke længere
> sandt.** *"Afløsningen kræver ingen ny mekanik"* var påstanden, og den holdt
> ikke en uge. Se **§13.7** nedenfor.

`ROUND_STORY_MAX_AGE_MS` (14 dage) er derfor ikke den normale afløser, men et
værn mod **sæsonpausen**: uden det ville den sidste runde før en pause stå på
Hjem i månedsvis, fordi der aldrig kom et nyere dagskort. Fjorten dage = den
følgende runde plus slæk til en runde, der sluttede sent.

### 13.7 Afløsningen krævede alligevel ny mekanik (rettet efter brugerrapport)

§13.6 skrev, at *"afløsningen kræver ingen ny mekanik"*. Den påstand holdt seks
dage. En bruger meldte 7. august 2026 rundestoryen for 28.07 – 03.08 stående på
Hjem med overskriften **"Du er nu foran Lis04 i Superliga Grundspil"**, mens
STILLING viste Lis04 over vedkommende.

**Fejlen i ræsonnementet er præcis lokaliserbar.** Et nyere dagskort *er* per
konstruktion fra den nye runde — det er sandt. Men et dagskort skrives først, når
**hele kampdagen** er færdigspillet (`match_day_complete`, og prædikatet er
globalt over alle turneringer), mens stillingen flytter sig ved **hvert enkelt
slutfløjt**: `computeCompetitionState` medregner en runde, så snart ÉN kamp har
resultat. §13.6 målte "har den nye runde noget at fortælle?" på det forkerte ur.
Hullet er ikke minutter — bagstopperen ventede dengang to døgn på en blokeret
dag.

**Bygget, tre greb:**

1. `roundStorySuperseded(story, round)` i `src/lib/stories.js`: kortet trækker
   sig, når `round.roundKey` er **strengt** senere end `story.round_key` og
   `round.playedCount > 0`. Data findes allerede på skærmen (`computeCurrentRound`,
   genindlæst hvert minut), så der kommer ingen nye kald. `round` initialiseres
   til `undefined` frem for `null`, så kortet kan holdes tilbage, mens svaret er
   *ukendt*, men ikke når det er *"ingen"* — ellers blinker kortet ind og ud, og
   `story_viewed` logges for en visning, brugeren aldrig fik.
2. Øjenbrynet bærer runden: `Rundens historie · 28.07 – 03.08`, udledt af
   `round_key` med det eksisterende `roundLabel()`. Virker på rækker, der
   allerede står i databasen.
3. Tre regler sat i datid, fordi de hævdede en *tilstand* og ikke en
   *begivenhed*: 22 `Du gik ind i top 3`, 40 `Du gik forbi X`, 45 `Du sluttede
   runden N point fra toppen`. De øvrige tretten overskrifter beskrev allerede
   afsluttede begivenheder. Brødteksterne var forankrede hele tiden — de
   indleder alle med "Efter runden …" — og det var netop asymmetrien: man læser
   overskriften først, og den er det eneste, der kommer med på et delt billede.

**Prisen, sagt højt:** top-slottet på Hjem kan stå tomt fra den nye rundes første
resultat, til dagskortet lander. Ingen historie er bedre end en forkert.
**Accepteret upræcished:** reglen ser på brugerens runde på tværs af alle
konkurrencer, så et resultat i én turnering trækker også et kort om en anden.

**Ingen backfill.** Datelinen dækker de eksisterende rækker uden at røre dem, og
`story_engine_backfill.sql` nulstiller `dismissed_at` — den ville genoplive kort,
brugerne aktivt har afvist.

### 13.8 Dagsmotoren havde aldrig kørt i produktion — og årsagen blev aldrig fundet

Undersøgelsen af §13.7 afdækkede noget større: `select day_key, count(*) from
stories where period = 'day' and news_value is not null group by 1` svarede
**ingen rækker**. Dagsmotoren havde ikke skrevet én eneste række, siden v3 blev
rullet ud.

**Fire hypoteser blev afkræftet, i rækkefølge:**

| Hypotese | Hvordan den døde |
|---|---|
| v3 blev udrullet efter kampens slutfløjt | `sql/schema.sql` er et `pg_dump` fra produktion; eksporten fra 19:35 dansk — under kampen — indeholdt allerede funktionen, **kodelinje-identisk** med repoets |
| Fejl i funktionen eller i dagens data | Håndkaldt skrev `generate_daily_stories('2026-08-07')` **20 rækker** |
| Dagen var ikke komplet, eller kampe var flyttet | Kun én kamp den dag, `finished`, og ingen kampe flyttet |
| `statement_timeout` i PostgREST-stien | Hele triggersætningen måler **141 ms** (rating 23 ms, dagsmotor 75 ms). Rollen er desuden irrelevant: hele kæden er `security definer` som `postgres` |

**Årsagen kunne ikke fastslås, og kan formentlig aldrig blive det.**
`matches.updated_at` vedligeholdes ikke af syncen, så det kan ikke rekonstrueres,
hvilke kampe der lå på dagen kl. 20:56; og rækker, der eventuelt blev skrevet og
rullet tilbage af guardens subtransaktion, findes ikke længere.

**Det er selve konklusionen.** Symptomet på en fejlet generering er **stilhed**,
og stilhed er uskelnelig fra en rolig uge. Derfor blev der ikke rettet en
formodet årsag, men observerbarheden — og de to øvrige rettelser blev valgt,
fordi de virker uanset årsagen:

- **Sporet.** Triggeren skriver `job = 'story-engine'` i `job_runs` med hver
  berørt dag og runde, om dagen var komplet, antal kort og `sqlerrm`. **Uden for
  guarden**, fordi `begin … exception … end` er en subtransaktion; indenfor ville
  rækken blive rullet tilbage netop når der var noget at fortælle. Med sin egen
  guard, fordi et fejlende spor ikke må vælte det, det sporer. Kontrollen
  `sql/checks/day_card_coverage.sql` aflæser resultatet.
- **Bagstopperen dækker nu i går og i dag.** Dagsløkken i
  `generate_stories_catchup()` har mistet sit grace-vindue: dagen er sin egen
  afgrænsning, fordi `match_day_complete` kræver alle resultater. To nye
  betingelser gør løkken selvafsluttende — rundens sidste kampdag og dage uden
  konkurrence-kampe kan **aldrig** få et kort og ville ellers blive forsøgt igen
  48–96 gange i døgnet for evigt og æde loftet på 20. Runde-løkken beholder sit
  vindue.
- **Rækkefølgen i `generate_daily_stories`.** Den tidlige udgang står nu **før**
  `delete`. Stod den efter, ville et gen-kald for en dag, der er *blevet* rundens
  sidste kampdag, tømme dagen og skrive intet tilbage.
