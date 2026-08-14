// Point, runder og låsning: de rene funktioner, hele appen regner med.
// Ingen netværkskald og ingen React — kun input ind, tal ud, hvilket er
// grunden til, at det er den tungest testede fil i src/.

// ---------- appens tidszone ----------
// HELE appen regner og viser i dansk tid — også når telefonen står et andet
// sted (G32, august 2026).
//
// Det er ikke et sprogvalg, det er en konsistensbeslutning. Runden er defineret
// i databasen af `round_key()`, som efter `G11` aflæser datoen i
// `Europe/Copenhagen`; låsen for en kamp uden fastlagt tid er "midnat på
// spilledagen" i `public.match_lock_at()`, også dansk. Regnede klienten i
// enhedens zone, ville de to sider være uenige om, hvilken DAG en kamp ligger
// på og hvornår den låser — identisk for en dansk bruger, forkert for en
// rejsende, og umuligt at opdage for den, der bygger det.
//
// Prisen er kendt og valgt: en bruger i Californien ser kampens danske
// klokkeslæt og ikke sit eget. Det er den rigtige vej at tage fejl for et
// produkt, hvis runder, deadlines og stillinger alle er danske — og for en
// vennegruppe, der taler sammen om "søndagskampen".
const APP_TZ = "Europe/Copenhagen";

// Zonens forskydning fra UTC på et givet tidspunkt (ms). Aflæses via Intl frem
// for hårdkodet, fordi Danmark skifter mellem +1 og +2 to gange om året.
function zoneOffsetMs(ms) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: APP_TZ, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
}

// Midnat på DEN DANSKE dag, tidspunktet ligger på (ms). To gennemløb: først
// aflæses dagen, som spilleren ser den, derefter korrigeres gættet (UTC-midnat
// på den dato) med zonens forskydning. Ét gennemløb ville ramme dagen før i
// timerne omkring midnat. Samme regel som `public.match_lock_at()` i SQL og
// `matchLockAtMs()` i api/_backfill.js — tre steder, fordi hverken klienten,
// api/ eller databasen kan importere fra hinanden, men ÉN regel.
function zonedMidnightMs(ms) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  return utcMidnight - zoneOffsetMs(utcMidnight - zoneOffsetMs(utcMidnight));
}

// Den danske kalenderdato (ÅÅÅÅ-MM-DD) for et tidspunkt. Bruges som nøgle, hvor
// to kampe skal ligge på samme dag — og hvor "samme dag" skal betyde det samme
// for alle, uanset hvor telefonen står.
function zonedDateKey(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(t));
}

// ---------- scoring helpers ----------
// Simpelt, straffrit pointsystem:
//   +3 korrekt resultat · +1 korrekt udfald · 0 forkert gæt
//
// Tallene er FASTE og har aldrig været andet (F2, juli 2026): `pc_points()` i
// databasen hardkoder 3/1 og er den kilde, rating, alle tre stillings-views og
// kåringerne regner efter. Indtil G3 (august 2026) tog denne funktion et
// `rules`-argument, som seks skærme hentede fra `competitions.rules` og sendte
// videre — et argument, der aldrig kunne have en anden værdi, men som fik
// enhver læser til at tro, at point var noget, en konkurrence kunne vælge.
// Konstanten står her, fordi de steder, der FARVELÆGGER efter point, skal
// kunne spørge om det samme tal som det, der blev givet.
const POINTS = { exact: 3, outcome: 1 };
function outcome(h, a) { return h === a ? "X" : h > a ? "1" : "2"; }
function pointsFor(pred, actual) {
  if (!pred
    || actual.home_score == null || actual.away_score == null
    || pred.pred_home == null || pred.pred_away == null) return null;

  if (pred.pred_home === actual.home_score && pred.pred_away === actual.away_score) return POINTS.exact;
  if (outcome(pred.pred_home, pred.pred_away) === outcome(actual.home_score, actual.away_score)) return POINTS.outcome;
  return 0;
}
// Rundens dato-interval, fx "04.08 – 10.08".
//
// Nøglen er en ren dato, så den skal forankres på et klokkeslæt for at kunne
// formatteres. **Middag UTC og ikke middag lokalt** (G32): en enhed langt vest
// for Danmark ville ellers parse "T12:00:00" i sin egen zone og få et
// tidspunkt, der er dansk NÆSTE dag — så rundens etiket ville stå en dag
// forkert netop dér, hvor den skulle berolige. Middag ligger langt nok fra
// begge døgnskift til, at ingen zone kan flytte datoen.
function roundLabel(key) {
  const start = new Date(key + "T12:00:00Z");
  const end = new Date(start.getTime() + 6 * 86400000);
  const fmt = (x) => x.toLocaleDateString("da-DK", { timeZone: APP_TZ, day: "2-digit", month: "2-digit" });
  return `${fmt(start)} – ${fmt(end)}`;
}
// Rundenøglen for en dansk kalenderdato: rul tilbage til rundens tirsdag.
// Fjerde og sidste spejling af `public.round_key()` (SQL), `round_key_of_date()`
// (SQL) og `matchLockAtMs()`-familien — samme grund som de andre: klienten,
// api/ og databasen kan ikke importere fra hinanden, men reglen er én.
//
// Datoen parses som UTC-middag af samme grund som `roundLabel` ovenfor: en enhed
// vest for Danmark ville ellers kunne lande en dag forkert.
function roundKeyOfDate(dateKey) {
  if (!dateKey) return "";
  const d = new Date(dateKey + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return "";
  const diff = (d.getUTCDay() - 2 + 7) % 7;   // 0=søn … 2=tir
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

// Rundenøglen for runden EFTER en given runde. Runder er ugentlige og forankret
// på tirsdagen, så det er nøglen plus syv dage — samme regning som SQL'ens
// `s.round_key::date + 7`. Nøglen er allerede en tirsdag, så der er intet at
// rulle tilbage til, og datoen kan lægges sammen i UTC uden zonefælden:
// `roundKeyOfDate` har allerede oversat til dansk kalender.
function nextRoundKey(key) {
  if (!key) return "";
  const d = new Date(key + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

// Rundenøglen lige NU. Karusellen på Hjem skal filtrere på denne og ALDRIG på
// `max(round_key)` fra tabellen: i en ny rundes første dage findes der endnu
// ingen rækker, og et max ville derfor vise den forrige runde i stedet for en
// tom karrusel — stik imod løftet om, at en ny runde starter forfra.
function currentRoundKey(now = new Date()) {
  return roundKeyOfDate(zonedDateKey(now.toISOString()));
}

// Kampenes rækkefølge: kickoff først, derefter holdnavn.
//
// Kickoff alene er ikke en TOTAL orden. En hel runde kan dele tidsstempel — det
// sker hver gang klokkeslættet ikke er fastlagt endnu (`kickoff_tbd`, hvor alle
// kampe bærer datoens pladsholder), og ellers hver gang to kampe spilles
// samtidig. `order=kickoff_at` i PostgREST efterlader den rest udefineret, så de
// samtidige kampe kunne bytte plads mellem to indlæsninger af samme skærm.
//
// `teamNameOf` er en opslagsfunktion (id → navn), fordi navnene bor i `teams` og
// ikke på kampen; uden den falder sammenligningen tilbage på hold-ID'et, som er
// vilkårligt, men stabilt. Sorteringen er dansk (`"da"`), så æ/ø/å lander efter
// z og ikke midt i alfabetet.
function byKickoffThenTeams(teamNameOf) {
  const name = (id) => (teamNameOf ? teamNameOf(id) : null) || id || "";
  return (a, b) =>
    (a.kickoff_at || "").localeCompare(b.kickoff_at || "") ||
    name(a.home_team_id).localeCompare(name(b.home_team_id), "da") ||
    name(a.away_team_id).localeCompare(name(b.away_team_id), "da");
}
function groupIntoRounds(matches, teamNameOf) {
  const map = {};
  for (const m of matches) { (map[m.round_key] ||= []).push(m); }
  const cmp = byKickoffThenTeams(teamNameOf);
  return Object.keys(map).sort().map((key) => ({
    key, label: roundLabel(key),
    matches: map[key].slice().sort(cmp),
  }));
}
// `filterFromNextUnfinishedRound` stod her indtil august 2026. Den er erstattet
// af `filterTippable` længere nede — se begrundelsen dér: runde-reglen holdt sit
// løfte for hele runder og brød det inde i én.

// indeks for den runde, der indeholder i dag — eller den nærmeste kommende
//
// "I dag" er den DANSKE dato (G32). Før var det UTC-datoen, hvilket er den
// samme for en dansk bruger i 22-23 af døgnets timer og forkert i resten —
// mellem midnat og 02.00 dansk tid pegede skærmen på gårsdagens runde.
function currentRoundIndex(rounds) {
  if (!rounds.length) return 0;
  const today = zonedDateKey(new Date().toISOString());
  for (let i = 0; i < rounds.length; i++) {
    const end = new Date(new Date(rounds[i].key + "T12:00:00Z").getTime() + 6 * 86400000);
    if (zonedDateKey(end.toISOString()) >= today) return i;
  }
  return rounds.length - 1;
}
// ---------- stages (grundspil / mesterskabsspil / nedrykningsspil) ----------
// Sportmonks leverer stage-navne på engelsk; vi oversætter til dansk i UI'et.
// Navnene her er dem, syncen faktisk har leveret. En ny turnerings fasenavne
// tilføjes, når man har SET dem — et gæt er værre end fallbacken nedenfor, som
// viser det rå navn pænt.
//
// Navngivningen er ikke fælles på tværs af turneringer, og heller ikke på tværs
// af sæsoner i samme turnering (verificeret hos Sportmonks 31. juli 2026):
// Superligaen deler sig i "Championship Round"/"Relegation Round", mens Scotland
// Premiership kalder det "1st Phase"/"2nd Phase" i 2026/2027 — men brugte
// "Regular Season" + "2nd Phase" i 2025/2026. Derfor er både `Regular Season` og
// `1st Phase` grundspil, og der er ét fælles ord for det skotske slutspil:
// Sportmonks giver ikke top-6 og bund-6 hver sin stage, som DBU gør, så en
// opdeling i mesterskabs-/nedrykningsspil ville påstå noget, dataene ikke siger.
//
// Fra 2026 kommer fem turneringer fra en ANDEN datakilde (football-data.org),
// og den skriver sine faser i VERSALER med understreg: "REGULAR_SEASON",
// "LAST_16". Det er ikke to konkurrerende konventioner, der skal forenes — det
// er to leverandørers rå navne, og tabellen her er netop stedet, hvor rå navne
// bliver til danske. De står adskilt nedenfor, så det er til at se, hvor et nyt
// navn hører hjemme, når det dukker op.
//
// Champions League' ligafase mapper til "Grundspil" med vilje: badge-reglen
// nedenfor skjuler netop det ord, og en badge på hver eneste ligafase-kamp er
// præcis den støj, reglen findes for. Knockout-runderne beholder deres badge,
// og det er dem, der siger noget.
const STAGE_LABELS = {
  // Sportmonks (Superliga, Scotland Premiership)
  "Regular Season": "Grundspil",
  "1st Phase": "Grundspil",
  "2nd Phase": "Slutspil",
  "Championship Round": "Mesterskabsspil",
  "Relegation Round": "Nedrykningsspil",
  "Conference League Play-offs – Final": "Conference League-playoff",
  // football-data.org (Premier League, Champions League, Bundesliga, Serie A, Primera División)
  REGULAR_SEASON: "Grundspil",
  LEAGUE_STAGE: "Grundspil",
  GROUP_STAGE: "Grundspil",
  PLAYOFFS: "Playoff",
  PLAYOFF_ROUND: "Playoff",
  PRELIMINARY_ROUND: "Kvalifikation",
  FIRST_QUALIFYING_ROUND: "1. kvalifikationsrunde",
  SECOND_QUALIFYING_ROUND: "2. kvalifikationsrunde",
  THIRD_QUALIFYING_ROUND: "3. kvalifikationsrunde",
  LAST_32: "1/16-finale",
  LAST_16: "Ottendedelsfinale",
  QUARTER_FINALS: "Kvartfinale",
  SEMI_FINALS: "Semifinale",
  THIRD_PLACE: "Bronzekamp",
  FINAL: "Finale",
};
// Kamp-badge: skjul grundspil — stage er kun interessant, når sæsonen er delt.
// Reglen ser på det DANSKE ord og ikke på det engelske navn: grundspil hedder
// noget forskelligt i hver turnering ("Regular Season", "1st Phase" …), og en
// badge på hver eneste kamp i grundspillet er præcis den støj, reglen findes for.
function stageBadgeLabel(name) {
  if (!name) return null;
  const label = STAGE_LABELS[name] || name;
  return label === "Grundspil" ? null : label;
}

// ---------- konkurrence-modes ----------
// ÉN kilde til sandhed for, hvad en mode hedder på dansk. Navnene stod før fire
// steder i tre forskellige varianter (samme konkurrence hed "Enkelt hold" på
// Ligaer-kortet, "Et hold" i opret-dropdownen og "Et hold" i admin-statistikken).
// Kanoniske navne = dem brugeren møder først, i opret-flowet.
// Ordforrådet fulgte I14-gennemgangen (august 2026): "Hel sæson" → "Sæson",
// "Et hold" → "Favorithold", "Tilfældig kupon" → "Quick Pick" osv. Nøglerne
// (mode-værdierne i databasen) er uændrede — kun det, brugeren ser, er nyt.
const MODE_LABELS = {
  full_season: "Sæson",
  team: "Favorithold",
  time_range: "Periode",
  custom: "Custom",
  random: "Quick Pick",
};
// MODE_HINTS lå her indtil august 2026 (G36): én linje pr. mode om, hvad valget
// BETYDER. Den blev aldrig læst af nogen — opret-galleriet (`A22`) fik sine egne
// beskrivelser i `createTypes.js`, hvor de hører til, fordi galleriet viser
// TYPER og ikke modes, og de to er ikke det samme (`random` er både Quick Pick,
// Quick League og Ugens kupon). Konstanten blev stående som en eksport uden
// forbruger og lovede dermed en fælles kilde, der ikke fandtes.
// Ukendt mode vises råt frem for tomt — så en ny mode aldrig forsvinder i UI'et.
// `random` over flere runder er sit eget produkt-navn (Quick League), men samme
// mode i databasen — forskellen bor i mode_params.rounds, så etiketten skal
// have params med, hvor rækken har dem. Uden params falder den tilbage til
// "Quick Pick", hvilket kun rammer aggregeringer uden mode_params (admin).
function modeLabel(mode, modeParams) {
  if (mode === "random" && Number(modeParams?.rounds) > 1) return "Quick League";
  return MODE_LABELS[mode] || mode;
}

// `tbd` udelader klokkeslættet: er kampens tid ikke fastlagt, bærer kickoff_at
// kun en dato, og et påhæftet "kl. 02.00" ville være opdigtet. Datoen står
// stadig — den ER kendt.
//
// `uncertain` (G85) er den svagere af de to og gør noget andet: klokkeslættet
// BLIVER stående, fordi det er brugbart at planlægge efter, og får i stedet
// sagt højt, at leverandøren ikke har bekræftet det. Er begge sat, vinder
// `tbd` — "der er ingen tid" gør spørgsmålet om bekræftelse ligegyldigt.
//
// Formuleringen er den lange her og et `~` på tip-skærmen (screens/predictions/
// time.js). Det er ikke to begreber, men to pladsbudgetter: denne funktion
// bruges i Admin → Kampe, Admin → Resultater og kampvælgeren, hvor der er en
// hel kolonne at skrive i, mens tid-kolonnen på tip-skærmen er ~40 px bred og
// bærer sin forklaring i dagsoverskriften i stedet.
function formatKickoff(iso, tbd = false, uncertain = false) {
  if (!iso) return "";
  const d = new Date(iso);
  const date = d.toLocaleDateString("da-DK", { timeZone: APP_TZ, weekday: "short", day: "2-digit", month: "2-digit" });
  if (tbd) return date;
  const tid = date + " kl. " + d.toLocaleTimeString("da-DK", { timeZone: APP_TZ, hour: "2-digit", minute: "2-digit" });
  return uncertain ? tid + " (ikke bekræftet)" : tid;
}
const LOCK_LEAD_MS = 60 * 60 * 1000; // 1 time før kampens eget kickoff

// ---------- rundens lås ----------
// Klienten har ikke længere brug for rundens START. Den blev kun brugt af det
// rullende gætte-vindue (`rules.openDaysBefore`), som er fjernet igen (B1, august
// 2026) — og `roundStartKey`/`buildRoundStartMap` røg med. Runden er stadig et
// rigtigt begreb (tidsenhed for point, rating og stillinger), men den er ikke
// længere et TIDSPUNKT her: både lås og åbning følger kampen. Rundens første
// kickoff findes fortsat serverside, hvor det stadig betyder noget —
// `api/_backfill.js` regel 3 og `analytics_round_locks`.

// Låsetidspunktet for én kamp (ms), eller null hvis kickoff ikke er kendt.
//
// Er klokkeslættet ikke fastlagt (kickoff_tbd), er "1 time før kickoff"
// meningsløst — der er intet kickoff at regne fra, kun en dato. Låsen bliver da
// MIDNAT PÅ SPILLEDAGEN. Det er det eneste tidspunkt, der holder, når kampen kan
// ligge hvor som helst på dagen: enhver senere lås ville kunne ligge efter et
// fløjt. Det er strengere end 1-times reglen, og med vilje — den anden vej ville
// koste tips, ikke bare præcision.
function lockAtOf(m) {
  if (!m?.kickoff_at) return null;
  const t = new Date(m.kickoff_at).getTime();
  if (Number.isNaN(t)) return null;
  if (!m.kickoff_tbd) return t - LOCK_LEAD_MS;
  // Midnat i DANSK tid — samme som `public.match_lock_at()`, som er den, der
  // faktisk håndhæver låsen i RLS. Indtil G32 stod her enhedens midnat, så en
  // rejsende bruger kunne se en kamp som åben, mens databasen afviste tippet
  // (eller omvendt) — de to var enige for en dansk bruger og kun for den.
  return zonedMidnightMs(t);
}

// En kamp er låst hvis den har fået resultat, ELLER hvis vi er inden for 1 time
// af sit EGET kickoff (A21, 1. august 2026 — afsnit 3). Låsen var før scopet på
// (season_id, round_key), så rundens tidligste kickoff låste hele runden;
// fredagens kamp låste dermed søndagens. Nu er deadlinen en egenskab ved kampen,
// ens for alle — samme regel som RLS i sql/predictions_match_lock.sql.
//
// En kamp uden kendt kickoff er ikke låst; det spejler policyens skrivegren.
function isLocked(match) {
  if (match.home_score !== null && match.home_score !== undefined) return true;
  const lockAt = lockAtOf(match);
  if (lockAt === null) return false;
  return Date.now() >= lockAt;
}

// Kun de kampe, der stadig kan tippes.
//
// Reglen bor her, fordi den nu har fire kaldere: opret-flowets pulje, dens
// håndpluk-kontrol, dens periode-loft og selve materialiseringen af en ny
// konkurrence (`data/competitions.js`).
//
// Det sidste var indtil august 2026 en RUNDE-regel, `filterFromNextUnfinishedRound`:
// find den første runde, hvor ikke alle kampe har resultat, og tag alt fra og
// med den. Den holdt sit løfte for hele runder og brød det inde i én. En
// konkurrence oprettet MIDT i en runde fik rundens allerede spillede kampe med,
// og da `predictions` deles på tværs af konkurrencer, stod deltagerne dermed
// ikke lige: den, der havde tippet kampen i en anden konkurrence, havde point
// fra første sekund, og den, der ikke havde, kunne ikke nå at gætte. Præcis den
// fejl, reglen var skrevet for at forhindre — bare et niveau længere nede.
//
// Kamp-reglen INDEHOLDER runde-reglen: en færdigspillet runde består kun af
// spillede kampe, og en spillet kamp er låst. Den er samtidig strengere det ene
// sted, det betyder noget, og derfor er runde-reglen fjernet frem for at stå
// ved siden af.
//
// Låst og ikke "har resultat": en kamp, der er fløjtet i gang, kan heller ikke
// tippes, og en kamp, ingen kan gætte på, hører ikke til i en ny konkurrence.
// En kamp uden kendt kickoff er ikke låst og kommer med — samme svar som
// RLS-policyens skrivegren.
//
// Efterfyldningen (`api/_backfill.js`) beholder sin egen, strengere RUNDE-regel.
// Den løser et andet problem: dér findes deltagerne allerede, har tippet og set
// stillingen, så en ny kamp midt i en igangværende runde ville flytte noget,
// nogen har set. Ved oprettelsen findes hverken deltagere eller stilling.
function filterTippable(matches) {
  return (matches || []).filter((m) => !isLocked(m));
}

// Kunne kampen stadig tippes på et GIVET tidspunkt? (`A53`)
//
// Søsterregel til `filterTippable` ovenfor, og den findes af nøjagtig samme
// grund — bare på den anden akse. `filterTippable` beskytter en ny KONKURRENCE
// mod at starte med point på tavlen. Denne beskytter en ny DELTAGER mod at
// møde op med dem.
//
// Problemet er ét og det samme: `predictions` er én række pr. `(bruger, kamp)`
// og deles på tværs af konkurrencer. Melder man sig til en konkurrence, der er
// halvvejs, tæller ens gæt fra en ANDEN liga med fra første sekund — på kampe,
// de øvrige deltagere ikke kan nå at gætte på. Værnet fandtes kun ved
// oprettelsen; dette er den halvdel, der manglede. Uden den kan man spekulere i
// at melde sig sent til en turnering, man ved man har tippet godt.
//
// `atMs` er deltagerens `joined_at`. To ting tæller MED, og begge er bevidste:
// en ukendt tilmeldingstid (så en manglende værdi aldrig kan nulstille nogen)
// og en kamp uden kendt låsetidspunkt (den kan stadig tippes — samme svar som
// RLS-policyens skrivegren).
//
// Reglen står ordret i SQL som `public.match_lock_at(...) > cp.joined_at`
// (`#61 competition_join_baseline.sql`), fordi Story Engine og kåringerne
// beregner den samme stilling. **De to skal ændres sammen** — to steder, der
// svarer forskelligt på ét spørgsmål, er præcis den fejl, Story Engine har
// kostet før (juli 2026, `DECISIONS.md`).
function wasTippableAt(match, atMs) {
  if (!Number.isFinite(atMs)) return true;
  const lockAt = lockAtOf(match);
  if (lockAt === null) return true;
  return atMs < lockAt;
}

// Startrunde: skal konkurrencen begynde i den runde, der allerede er i gang,
// eller vente på den næste?
//
// Valget fandtes ikke før august 2026 — startrunden var en konsekvens af,
// hvornår man trykkede Opret. Reglen er en ren filtrering, netop fordi det er
// alt, den skal være: `pickRandomFromRounds` tager de `rounds` FØRSTE
// rundenøgler, den finder, så fjernes indeværende runde, rykker hele Quick
// Leagues vindue med. For Sæson og Favorithold er der ikke noget vindue at
// rykke — dér er det simpelthen den runde, kampene tælles fra.
//
// Reglen bor her hos `filterTippable` og ikke i opret-flowets typekatalog,
// fordi de to nu bruges af det samme sæt kaldere: skærmens pulje OG
// materialiseringen i `data/competitions.js`. Rundenøglen er en runde-regel,
// ikke et gallerikort.
//
// Uden rundenøgle filtreres der ikke: et gæt ville være værre end intet.
function filterFromRoundStart(matches, { start, currentKey } = {}) {
  if (start !== "next" || !currentKey) return matches || [];
  return (matches || []).filter((m) => m.round_key > currentKey);
}

// De runder, hvor andres tips må vises — nemlig fra låsen, hvor ingen længere
// kan rette sit gæt. Hver runde beskæres til sine LÅSTE kampe, så et gæt aldrig
// kan ses før deadline. Med per-kamp-låsen er en delvist låst runde reglen frem
// for undtagelsen: en runde står typisk halvt beskåret i dagevis, mens dens
// senere kampe stadig kan tippes.
// Et resultat er ikke et krav — en låst, endnu ikke spillet kamp viser gættet
// uden facit. Samme regel som "Alles gæt" på Tip-skærmen.
function lockedRoundsOf(rounds) {
  return rounds
    .map((r) => ({ ...r, matches: r.matches.filter((m) => isLocked(m)) }))
    .filter((r) => r.matches.length > 0);
}

// ---------- næste runde: hvad mangler jeg at tippe? ----------
//
// "Næste runde" er den TIDLIGSTE runde, der stadig har kampe, man kan tippe —
// og status vises KUN for den. Er den fuldt tippet, er alt ok, også selvom
// senere runder mangler tips: de bliver "næste runde" i tur, efterhånden som
// runderne spilles.
//
// Reglen bor her og ikke i sin kalder, fordi den nu har to (Hjem-fanens
// deadline-kort og det grønne flueben på konkurrence-kortene). Det er samme
// spørgsmål stillet to steder, og to kopier ville kunne blive uenige om, hvad
// "alle tips er inde" betyder — præcis den slags skævhed, `modeLabel` og
// `validateGroupName` også blev samlet for at fjerne.
//
// `predByMatch` er en Map fra match_id til brugerens tip (eller mangel på
// samme). Returnerer null, når der intet er at tippe: ingen runde er "næste",
// og en kalder må ikke kunne forveksle det med "alt er tippet".
function nextRoundTips(matches, predByMatch) {
  // Tipbar = ikke spillet, ikke låst, og med et kendt kickoff. Det rullende
  // gætte-vindue er væk (B1), så en kamp kan tippes fra den findes til den låser.
  const tippable = matches.filter((m) => !isPlayed(m) && !isLocked(m) && m.kickoff_at);
  if (!tippable.length) return null;
  const roundKey = tippable.reduce((min, m) => (m.round_key < min ? m.round_key : min), tippable[0].round_key);
  const inRound = tippable.filter((m) => m.round_key === roundKey);
  const untipped = inRound.filter((m) => {
    const p = predByMatch.get(m.id);
    return !(p && p.pred_home != null && p.pred_away != null);
  });
  return { roundKey, matches: inRound, untipped, allTipped: untipped.length === 0 };
}

// ---------- live-resultater ----------
// Live-stillingen bor i SEPARATE kolonner (live_*) og tæller ALDRIG point: en kamp
// er først "spillet", når home_score er sat. Derfor kan stillinger, rating og point
// aldrig bevæge sig midt i en kamp — de venter på slutfløjt. Se sql/live_scores.sql.
//
// Kampens tre tilstande i UI'et:
//   færdigspillet → isPlayed(m) === true (resultat + point)
//   i gang        → liveInfo(m) !== null (nuværende stilling + LIVE-mærke)
//   kommende      → ingen af delene (kickoff-tidspunkt)
const LIVE_BREAK_STATES = ["HT", "BREAK", "EXTRA_TIME_BREAK", "PEN_BREAK"];

function isPlayed(m) { return !!m && m.home_score !== null && m.home_score !== undefined; }

// Returnerer null hvis kampen ikke er i gang. Et endeligt resultat slår altid live,
// så en kamp aldrig kan "gå tilbage" til live efter at være meldt færdig.
function liveInfo(m) {
  if (!m || isPlayed(m) || m.live_state == null) return null;
  const paused = LIVE_BREAK_STATES.includes(m.live_state);
  return {
    homeScore: m.live_home_score ?? 0,
    awayScore: m.live_away_score ?? 0,
    state: m.live_state,
    minute: paused ? null : (m.live_minute ?? null),
    // kort label ved siden af LIVE-mærket: spilleminut, eller "Pause" i pauserne
    label: paused ? "Pause" : (m.live_minute != null ? `${m.live_minute}′` : "Live"),
  };
}

export { APP_TZ, outcome, POINTS, pointsFor, roundLabel, zonedDateKey, roundKeyOfDate, nextRoundKey, currentRoundKey, byKickoffThenTeams, groupIntoRounds, currentRoundIndex, formatKickoff, isLocked, filterTippable, wasTippableAt, filterFromRoundStart, lockAtOf, lockedRoundsOf, nextRoundTips, STAGE_LABELS, stageBadgeLabel, isPlayed, liveInfo, MODE_LABELS, modeLabel };
