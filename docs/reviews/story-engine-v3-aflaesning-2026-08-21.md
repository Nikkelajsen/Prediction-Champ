# Story Engine v3 aflæst i produktion — `A33` besvaret, `A35` ikke endnu

*21. august 2026. Ejeren kørte [`sql/story_engine_v3_measure.sql`](../../sql/story_engine_v3_measure.sql);
tallene nedenfor er dens svar, uændret. Regnestykket bag dem står i
[`story-engine-v3-scorerum-2026-08-21.md`](./story-engine-v3-scorerum-2026-08-21.md).*

**Grundlaget:** 100 bruger-dage · 25 brugere · 4 kampdage · 7. – 16. august 2026 ·
50 vis-bare kort · 168 visninger fordelt på 12 brugere.

---

## 1. Nævneren er 65 og ikke 100

**35 af de 100 bruger-dage er tips-påmindelser** — brugeren havde ikke ét eneste
scoret tip den dag, så der fandtes ingen kandidater at vælge imellem. De hører
ikke til i en måling af, hvor bredt motoren *vælger*; de siger noget om
engagement, ikke om regler.

Motorens reelle valgmængde er derfor **65 bruger-dage**. Hele resten af dette
dokument regner på dem, når der står "valgt regel".

## 2. `A33` — variationen er der, men den er skæv

| valgt regel | af 65 reelle valg | af alle 100 | news_value |
|---|---|---|---|
| `DAY_TOP` | **43,1 %** (28) | 28 % | 45–75 (snit 60,5) |
| `CONTRARIAN` | **26,2 %** (17) | 17 % | 36–70 (snit 56,4) |
| `DAY_RESULT` | **12,3 %** (8) | 43 % *(heraf 35 uden tips)* | 0–28 (snit 5,2) |
| `DUEL` | 7,7 % (5) | 5 % | 50–56 |
| `COLLECTIVE_MISS` | 6,2 % (4) | 4 % | 44–44 |
| `MILESTONE` | 3,1 % (2) | 2 % | 120 |
| `SO_CLOSE` | 1,5 % (1) | 1 % | 38 |
| `STREAK_STATUS` | **0 %** | 0 % | — |

**Svaret på rækkens spørgsmål er nej.** v2's tal, rækken blev skrevet på, var
`DAY_RESULT` 44 % af alle historier. På den reelle valgmængde er dagens facit nu
**12,3 %** — v3 gjorde præcis det, den satte sig for: `DAY_RESULT` gik fra anker
til fald-tilbage. Syv af otte dagsregler har udløst, så bredden er reel og ikke
en tabel-effekt.

**Men det, brugerne faktisk møder, er to regler.** Af de 168 visninger:

| set regel | visninger | andel | brugere |
|---|---|---|---|
| `DAY_TOP` | 85 | 50,6 % | 8 |
| `CONTRARIAN` | 61 | 36,3 % | 5 |
| `DAY_RESULT` | 10 | 6,0 % | 3 |
| `COLLECTIVE_MISS` | 9 | 5,4 % | 3 |
| `DUEL` | 2 | 1,2 % | 2 |
| `MILESTONE` | 1 | 0,6 % | 1 |

`DAY_TOP` + `CONTRARIAN` er **86,9 %** af alt, nogen har set. Gentagelsen fra
kampdag til kampdag er 36,0 %.

Det er ikke rækkens bekymring, men dens spejlbillede: bekymringen var *"dagens
facit hver anden gang"*, og virkeligheden er *"dagens højeste eller kontrarianen
næsten altid"*. **Årsagen er den samme mekanik som i v2** — de to har de højeste
grundvægte efter `MILESTONE` (34 og 32), og de er to af de tre regler, der
fan-outer, så de producerer flere kandidater pr. dag end nogen anden. Anker-
problemet er ikke fjernet; det er flyttet opad. Det er ført videre som `A58`.

## 3. `A35` — udløseren er ikke opfyldt, og det er reelt

**Fire kampdage af de ti, rækken kræver.** De to uger er gået (14 dage siden
første kort), men de to halvdele af udløseren løber ikke i samme takt:
kampdagene kommer ~2–3 om ugen, så ti er 3–4 uger ude i fremtiden. Med fire dage
kan man ikke skelne en regel, der udløser ofte, fra en, der tilfældigvis
udløste — og hele spørgsmålet er en fordeling.

Det, tallene alligevel siger, er værd at have med, når rækken tages op:

**Tærsklen er et svagt instrument, og nu er det målt.**

| tærskel | andel ulæst |
|---|---|
| 38 | 56,0 % |
| 41 | 54,0 % |
| 44 | 54,0 % |
| **45** | **50,0 %** |
| 48 | 48,0 % |
| 51 | 46,0 % |
| 53 | 40,0 % |
| 55 | 40,0 % |

Hele spændet fra 38 til 55 flytter andelen 16 point. Grunden ses i fordelingen:
**35 kort ligger på 0 og 40 kort ligger på 54+**, altså 75 af 100 uden for
enhver tærskels rækkevidde i det spænd. Tærsklen kan kun nogensinde afgøre 25 %
af bruger-dagene. Det er scorerum-aflæsningens forudsigelse, nu som tal.

**Og den nuværende andel ser kun rigtig ud på grund af nævneren.** 50,0 % af
alle bruger-dage har ulæst-markering — midt i målet på 40–60 %. På motorens egen
valgmængde er tallet **76,9 %**, altså over rækkens egen "over 70 % ⇒ tærsklen
er for lav". Forskellen ER de 35 tips-påmindelser. Bliver brugerne mere aktive,
skrumper den halvdel af nævneren, der trækker tallet ned, og den lever tal
bevæger sig mod 76,9 % uden at nogen har rørt en tærskel. **En tærskel, der ser
rigtig ud, fordi en tredjedel af bruger-dagene er tomme, er ikke kalibreret —
den er heldig.**

## 4. Scorerummet holdt mod virkeligheden

Hver strukturel forudsigelse fra
[scorerum-aflæsningen](./story-engine-v3-scorerum-2026-08-21.md) kan efterprøves
på tallene, og alle holdt:

| forudsigelse | målt |
|---|---|
| `COLLECTIVE_MISS` lander på præcis 44 i det tilfælde, den er skrevet til | 4 kort, **min = max = 44** |
| `DAY_RESULT` kan aldrig nå 45 (loft 40) | max **28** — nåede ikke engang sit eget loft |
| `SO_CLOSE`s gulv er 38 | 1 kort, **38** |
| `CONTRARIAN`s laveste fan-out-gulv er 36 (32 + 0 + 4) | min **36** |
| `MILESTONE` scorer fast 120 | 2 kort, **120–120** |
| Ingen personlig kandidat lander mellem 45 og 47 | 2 kort i båndet — begge fan-out |

At `DAY_RESULT`s otte rigtige kort alle står på 28 (= 8 + 0 + 20) betyder, at
deres `over_pts` var nul hver gang: den bruger, der får dagens facit, ligger på
eller under dagens gennemsnit. Fald-tilbagen rammer altså dem, dagen ikke gik
godt for — hvilket er den rigtige adfærd for et dæmpet kort.

## 5. To fund, rækkerne ikke bad om

**Halvdelen af kortene var aldrig det nyeste.** 50 af 100 v3-dagskort har et
vindue på nul minutter: et kort med en større `day_key` fandtes for den samme
bruger allerede i det øjeblik, de blev skrevet. `loadDayCard` henter altid den
nyeste `day_key`, så de kunne pr. konstruktion ikke nås. Det er `G73`s klasse en
gang til — produktionen tæller som skrevet, og halvdelen kunne aldrig ses.
Ført videre som `G142`.

**`STREAK_STATUS` har aldrig VUNDET** — og bemærk ordet. Tabellen i afsnit 2
grupperer på `winner_rule`, og en taber efterlader intet spor: `runner_up_value`
gemmer et tal, ikke en regel. "Har aldrig udløst" og "har aldrig vundet" ser
ens ud herfra.

Det blev ført videre som `G143` og **besvaret samme dag**: reglen virker —
motoren er kørt mod en fixture med en levende stime, og kortet blev skrevet til
både hovedpersonen og en fan-out-modtager. Men den er **systematisk domineret**.
`STREAK_STATUS` har `competition_id = null`, så `_sd_mag`-joinet (flytning +
over gennemsnittet) rammer ingen række, og den får kun stime-bonussen som
størrelsesbidrag: 48–60. `DAY_TOP` (34), `CONTRARIAN` (32) og `DUEL` (30) får
den samme bonus plus flytning og over-snit oven i en højere grundvægt og slår
den derfor altid — målt til 72 mod 60. Med `DAY_TOP` + `CONTRARIAN` som 69 % af
sejrene kan stimen kun vinde på en dag, hvor ingen af de tre udløste.
Se [`DECISIONS.md`](../DECISIONS.md); fundet er ført ind i `A58`.

## 6. Forbehold

- **Fire kampdage.** Fordelingerne i afsnit 2 hviler på 65 valg fordelt på fire
  dage og 25 brugere. Nok til at aflive v2's `DAY_RESULT`-dominans, som er en
  strukturel påstand; ikke nok til at sige, at 43 % `DAY_TOP` er niveauet.
- **Visninger er et gulv.** `analytics_events` skrives fire-and-forget under RLS,
  og 168 visninger på 50 vis-bare kort betyder gen-visninger, ikke 168 kort. De
  må bruges til *hvilke* regler folk møder, aldrig som en rate.
- **Vinduet er en model af `loadDayCard`, ikke en observation.** Det tager ikke
  højde for, at et afvist nyere kort ville lade et ældre komme frem. Tallet i
  afsnit 5 er derfor et loft over problemet, ikke en eksakt optælling.
- **Ingen aktiv bruger endnu** i aflæsningens forstand (mindst fem kampdage), så
  medianen pr. bruger og ensformigheds-målet står tomme. Begge udfyldes af sig
  selv, når `A35`s udløser indtræffer.
