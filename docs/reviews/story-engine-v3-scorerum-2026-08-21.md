# Story Engine v3's scorerum — hvad tærsklen 45 kan og ikke kan

*21. august 2026. Aflæsning af `sql/story_engine_v3.sql`, ikke af produktionen.*

Baggrund: `A35` spørger, om publiceringstærsklen på 45 er den rigtige, og `A33`
spørger, om dagsmotorens variation er tyndere, end regelantallet lover. De to har
ventet på hver sin udløser og er blevet skrevet som to spørgsmål. **Det er de
ikke.** Regner man motorens scorerum efter — altså de tal, den overhovedet KAN
producere — falder de sammen til ét.

Dette dokument er den halvdel, der kan besvares uden produktionsdata. Den anden
halvdel er bestilt som ét opslag i
[`sql/story_engine_v3_measure.sql`](../../sql/story_engine_v3_measure.sql).

---

## 1. Regnestykket

En kandidat scorer `grundvægt + størrelse + nærhed` (spec §4):

| led | spænd | hvor |
|---|---|---|
| grundvægt | 8–100, fast pr. regel | `_sd_cand`-indsættelserne |
| størrelse | 0–30 (`DAY_RESULT`: 0–12, `MILESTONE`: 0) | `_sd_mag` + stimen, klippet i `_sd_scored` |
| nærhed | 20 hovedperson · 14 rival · 8 samme konkurrence · 4 ellers | `_sd_prox` |

Størrelsen er `min(30, flytning + over-snit + stime)`, hvor flytning er
`min(18, 6 × pladser)`, over-snit er `min(12, 3 × point over dagens gennemsnit)`
og stimen er `min(12, 2 × (længde − 5))`.

## 2. Hovedpersonens gulve og lofter

For den, historien handler om, er nærheden altid 20. Så:

| regel | grundvægt | gulv (størrelse 0) | loft | binder tærsklen 45? |
|---|---|---|---|---|
| `DAY_RESULT` | 8 | 28 | **40** | nej — kan ALDRIG udgive |
| `SO_CLOSE` | 18 | 38 | 68 | **ja** — kræver 7 størrelsespoint |
| `COLLECTIVE_MISS` | 24 | **44** | 74 | **ja** — kræver 1 størrelsespoint |
| `STREAK_STATUS` | 28 | 48 | 78 | nej — udgiver ALTID |
| `DUEL` | 30 | 50 | 80 | nej — udgiver ALTID |
| `CONTRARIAN` | 32 | 52 | 82 | nej — udgiver ALTID |
| `DAY_TOP` | 34 | 54 | 84 | nej — udgiver ALTID |
| `MILESTONE` | 100 | 120 | 120 | nej — udgiver ALTID |

**Tærsklen ligger i hullet.** 45 sidder mellem `DAY_RESULT`s loft (40) og de fire
øverste reglers gulv (48). For hovedpersonen er den derfor ikke en tærskel, men
et NAVN til reglen *"udgiv, når noget andet end dagens facit udløste"*. Fem af
otte regler er afgjort af deres grundvægt alene; kun to afgøres af tallet.

At `DAY_RESULT` aldrig kan nå over er tilsigtet og står i motorens egen kommentar
— med hele størrelsesloftet ville dagens facit nå 58 og kunne udgive sig selv som
dagens historie, og så fandtes fald-tilbagen ikke. `COLLECTIVE_MISS`' 44 er lige
så bevidst: *"en fælles fiasko alene er dagens facit, men sammen med bevægelse i
tabellen bliver den en historie."*

Bemærk kanten i det: `COLLECTIVE_MISS` udløser, når ingen ramte kampen. Ramte
ingen, ligger man sjældent over dagens gennemsnit, og rykkede man ikke i
tabellen, er størrelsen nul. Reglen lander altså formentlig på præcis 44 netop i
det tilfælde, den er skrevet til. Om det sker i praksis, er et af de tal,
opslaget henter hjem.

## 3. Tredjepersonens gulve

Tre regler fan-outer (`CONTRARIAN`, `DAY_TOP`, `STREAK_STATUS` — de tre med en
`headline3`). For en modtager, der ikke er hovedpersonen, er størrelsen stadig
hovedpersonens, men nærheden falder:

| regel | rival (14) | samme konkurrence (8) | ellers (4) |
|---|---|---|---|
| `CONTRARIAN` (32) | 46 ✓ | 40 — kræver 5 | 36 — kræver 9 |
| `DAY_TOP` (34) | 48 ✓ | 42 — kræver 3 | 38 — kræver 7 |
| `STREAK_STATUS` (28) | 42 — kræver 3 | 36 — kræver 9 | 32 — kræver 13 |

**Her binder tærsklen.** Fem af ni kombinationer afgøres af tallet 45. Det er
altså i fan-out-laget — de kort, en bruger får om ANDRE — at tærsklen faktisk
arbejder, og det er dér, en justering ville få virkning.

## 4. Hvad det betyder for `A35`

Spørgsmålet *"er 45 den rigtige?"* kan ikke besvares som et spørgsmål om 45.
Håndtaget er grovkornet og ujævnt:

- **41–44** ændrer kun `COLLECTIVE_MISS` og de smalleste `SO_CLOSE`.
- **45–47** er identisk med 45 for hovedpersonen (ingen personlig kandidat
  lander dér), men skærer i fan-out-laget.
- **49** slår `STREAK_STATUS` ud af hovedpersonens altid-liste.
- **51** slår også `DUEL` ud. **53** også `CONTRARIAN`. **55** også `DAY_TOP`.

Ligger den målte andel uden for 40–60 %, er svaret derfor sjældent "flyt
tærsklen fem point". Det er enten "flyt den forbi et gulv" — en stor, synlig
ændring, hvor en hel regel holder op med at være nyhed — eller "flyt
grundvægten" for netop den regel, der fylder for meget. Grundvægtene er den
ærligere skrue, fordi de siger noget om reglen; tærsklen siger kun noget om,
hvor stregen tilfældigvis blev sat.

Det er også derfor, opslaget måler andelen ved otte forskellige tærskler frem
for kun ved 45: er spændet mellem 38 og 55 smalt, er tærsklen ikke problemet.

## 5. Hvad det betyder for `A33`

`A33` spørger, om de øvrige seks dagsregler faktisk varierer. Efter afsnit 2 er
det **det samme spørgsmål** som `A35`: andelen af kampdage med ulæst-markering
ER andelen af kampdage, hvor en anden regel end `DAY_RESULT` vandt. Falder
`A35`s tal under målet, er årsagen pr. konstruktion, at de seks regler ikke
udløser — ikke at tærsklen er for høj.

v2's tal, rækken blev skrevet på, var `DAY_RESULT` 123 af 280 (44 %). De er
**ikke sammenlignelige** med v3's: i v2 var `DAY_RESULT` laveste prioritet og
udløste altid, så de 44 % var en konstruktionsfølge. v3 fjernede årsagen ved at
gøre den til fald-tilbage. Den nye fordeling skal derfor læses forfra, og
opslagets sammenligningstal står kun med som en påmindelse om, hvad der blev
ændret.

Opslaget måler variationen tre steder, fordi "ensformig" kan betyde tre ting:
fordelingen over VALGTE regler (motorens bredde), gentagelsen fra kampdag til
kampdag (den oplevede bredde) og andelen af en brugers kort, der bærer hendes
hyppigste regel (den samlede oplevelse over tid).

## 6. Efterprøvet mod produktionen samme dag

Aflæsningen blev kørt 21. august 2026, og **hver forudsigelse i afsnit 2 og 3
holdt**: `COLLECTIVE_MISS` stod på præcis 44 i alle fire forekomster,
`DAY_RESULT` nåede aldrig over 28, `SO_CLOSE`s ene kort stod på gulvet 38, og
`CONTRARIAN`s laveste var 36 — fan-out-gulvet for en modtager, der hverken er
hovedpersonen eller en rival. Tærsklens svaghed blev også målt: hele spændet fra
38 til 55 flytter andelen 16 point, fordi 75 af 100 kort ligger uden for enhver
tærskels rækkevidde. Tallene og det, de afgjorde, står i
[`story-engine-v3-aflaesning-2026-08-21.md`](./story-engine-v3-aflaesning-2026-08-21.md).

## 7. Hvad dette dokument IKKE svarer på

Alt det, der kræver rækker. Om reglerne udløser, hvor ofte, for hvem, og om
nogen har set kortene. Scorerummet siger, hvad motoren KAN; kun produktionen
siger, hvad den GØR — og den blev spurgt samme dag; se afsnit 6.
