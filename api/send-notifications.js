// Server-side funktion (kører på Vercel, ikke i browseren).
// Sender push-notifikationer til tilmeldte brugere:
//   1) Deadline-påmindelse: kampe der mangler tips og låser inden for de næste timer.
//      Låsningen er PER KAMP (A21, som i sql/predictions_match_lock.sql og frontendens
//      isLocked): en kamp låser 1 time før sit eget kickoff. Beskederne samles til én
//      pr. bruger pr. dag, så kadencen er uændret, selvom deadlines nu er mange.
//   2) Runde-resultat: når alle rundens kampe i de OFFICIELLE turneringer er
//      færdigspillede — point + placering, læst fra DB-viewet round_standings med
//      scope = 'ALL' (samme kilde OG samme afgrænsning som Championship-fanen).
//   3) Ny konkurrence i en liga: når et liga-medlem endnu ikke deltager i en
//      konkurrence, der lige er oprettet i deres liga (B5). Beskeden dybdelinker
//      til konkurrencens invitationskode, så trykket lander i den samme
//      bekræftelse som et invitationslink.
//   4) Kåring: "du blev Ugens/Månedens bedste" i en konkurrence (B11) — læst
//      fra competition_awards, som jobbet selv skriver først via
//      award_competition_periods().
//   5) Ny turnering: en ny, synlig turnering med mindst én tipbar kamp (B9) —
//      den eneste beskedtype uden modtager-afgrænsning, se newTournamentMessages().
// notification_log sikrer, at samme besked aldrig sendes to gange.
//
// Kald med: /api/send-notifications  med headeren  x-sync-secret: <SYNC_SECRET>  (ekstern cron)
//   (?secret=<SYNC_SECRET> virker stadig som fallback, men er på vej ud — BACKLOG A11.
//    Brug ikke den form til nye jobs: hemmeligheden havner i request-logs.)
//   valgfrit: &hours=3      hvor tæt på en kamps lås deadline-påmindelsen sendes
//   valgfrit: &dryRun=true  vis hvad der VILLE blive sendt, uden at sende
//   valgfrit: &force=true   send uden for sendevinduet (kun til fejlfinding)
//
// SENDEVINDUE (A24): der sendes kun mellem 08 og 22 dansk tid. Uden for vinduet
// svarer kørslen 200 uden at sende og uden at reservere noget i notification_log
// — se withinSendWindow() nedenfor for hvorfor det er hele mekanikken.
// Offentligt: /api/send-notifications?action=vapidKey  (bruges af frontendens tilmelding)
//
// Miljøvariabler der skal være sat i Vercel:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SYNC_SECRET
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  (generér med: npx web-push generate-vapid-keys)
//   VAPID_SUBJECT (valgfri, mailto:-adresse til push-tjenesterne)

import webpush from "web-push";
import { createSb, sbAll, isAuthorized, createRunLogger, failJob } from "./_shared.js";

const HOUR = 3600 * 1000;
const LOCK_LEAD_MS = HOUR; // en kamp låser 1 time før sit eget kickoff (A21)

// Hvor længe en konkurrence tæller som "ny" (B5). Vinduet gør to ting:
//   * det holder opslaget lille — uden det ville hver kørsel læse hele
//     konkurrence-tabellen og på sigt ramme PostgRESTs 1000-rækkers loft, som
//     sb() ikke pagerer omkring;
//   * det er den eneste grund til, at feature'en ikke udsender hele bagkataloget
//     ved første kørsel efter udrulning. notification_log kan ikke redde os dér:
//     den er tom for en beskedtype, der aldrig er sendt før.
// Jobbet kører hvert 15.-30. minut (docs/CRON.md), så et døgn er rigelig luft
// til et cron-udfald og stadig kort nok til, at beskeden er nyhed, når den lander.
const NEW_COMPETITION_WINDOW_MS = 24 * HOUR;

// Hvor længe en turnering tæller som "ny" (B9). Samme rolle som vinduet ovenfor
// og af samme to grunde — men bredere, fordi en ny turnering er en sjælden
// begivenhed (syv på et år), og fordi den, modsat en konkurrence, ikke er
// oprettet af et menneske, der venter på at nogen opdager den. To døgn giver
// plads til, at turneringen får hentet sine første kampe, før beskeden går ud:
// et link til en turnering uden kampe er en skuffelse, ikke en invitation.
const NEW_TOURNAMENT_WINDOW_MS = 48 * HOUR;

// Hvor langt tilbage en lokal kåring stadig kan udløse en besked (B11).
// Kåringen er allerede FROSSEN i competition_awards, så vinduet handler kun om,
// hvor gammel en nyhed må være: en uge dækker et cron-udfald og et par dages
// forsinkelse på en udsat kamp, uden at en udrulning sender hele bagkataloget.
const AWARD_WINDOW_MS = 7 * 24 * HOUR;

// ---- Sendevindue (A24) ----
// Der sendes kun mellem 08:00 og 22:00 dansk tid. En push om natten vækker folk;
// den er ikke bare irrelevant, den er skadelig for den ene tilladelse, produktet
// ikke kan få tilbage, hvis brugeren slår notifikationer fra.
//
// Tidszonen er FAST og dansk, ikke serverens. Vercel kører UTC, så uden zonen
// ville vinduet flytte sig en time to gange om året — og det er præcis det, en
// hårdkodet UTC-grænse ville se rigtig ud til at gøre i vintertid og forkert ud
// hele sommeren. Brugerne er én vennegruppe i én tidszone (samme forudsætning
// som resten af appen: `da-DK` overalt, ingen sprogvalg).
const SEND_WINDOW = { start: 8, end: 22, timeZone: "Europe/Copenhagen" };

// Timetallet i en given tidszone. `hourCycle: "h23"` er ikke pynt: uden den
// giver hour12:false "24" ved midnat i flere ICU-versioner, og 24 ligger uden
// for ethvert vindue, man ville skrive i hånden.
export function hourInZone(date, timeZone = SEND_WINDOW.timeZone) {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(date)
  );
}

// Datoen (ÅÅÅÅ-MM-DD) i en given tidszone. Bruges som øvre grænse på `round_key`,
// som er en `date` beregnet af `round_key(kickoff_at)` — altså rundens TIRSDAG:
// runderne løber tirsdag til mandag (`round_key()` i sql/rating_core.sql).
// Serverens egen dato ville være UTC og dermed ligge en dag bagud i timerne
// efter midnat dansk tid; samme grund som SEND_WINDOW's faste tidszone.
export function dateInZone(date, timeZone = SEND_WINDOW.timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

// Må der sendes lige nu? Vinduet er inklusivt i starten og eksklusivt i slutningen
// (08:00 er inde, 22:00 er ude), og et vindue, der krydser midnat, understøttes —
// ellers ville `{ start: 22, end: 8 }` tavst betyde "aldrig".
export function withinSendWindow(date, window = SEND_WINDOW) {
  const { start, end, timeZone } = { ...SEND_WINDOW, ...window };
  const h = hourInZone(date, timeZone);
  return start <= end ? h >= start && h < end : h >= start || h < end;
}

function roundLabel(key) {
  const start = new Date(key + "T12:00:00");
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const fmt = (x) => x.toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit" });
  return `${fmt(start)} – ${fmt(end)}`;
}
// Delt placering på rundens stilling. Samme regel som src/lib/standings.js, som er
// den kanoniske kilde — den duplikeres her, fordi api/ ikke importerer fra src/
// (samme grund som roundLabel ovenfor). Rækkerne kommer allerede sorteret fra
// databasen, så det er nok at sammenligne med naboen.
function assignRanks(board) {
  const tied = (a, b) => a.total_points === b.total_points
    && a.exact_count === b.exact_count
    && (a.outcome_count ?? 0) === (b.outcome_count ?? 0)
    && Number(a.avg_goal_error ?? 0) === Number(b.avg_goal_error ?? 0);
  let rank = 0;
  board.forEach((r, i) => {
    const tiedWithPrev = i > 0 && tied(board[i - 1], r);
    if (!tiedWithPrev) rank = i + 1;
    r.rank = rank;
    r.shared = tiedWithPrev;
  });
  for (let i = 0; i < board.length - 1; i++) if (board[i + 1].shared) board[i].shared = true;
  return board;
}
function fmtUntil(ts) {
  let s = Math.max(0, Math.floor((ts - Date.now()) / 1000));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} t ${m} min` : `${m} min`;
}

// Sæsonerne under de OFFICIELLE turneringer — samme afgrænsning som
// round_standings' scope = 'ALL'. `is_official` frem for `is_visible`: en
// turnering kan være tipbar uden at afgøre titler, og check-constraint'en på
// leagues gør officiel til en indsnævring af synlig (sql/tournament_scope.sql).
//
// Den kanoniske kilde er scopeSeasonIds() i src/lib/data/standings.js; den
// duplikeres her af samme grund som assignRanks og roundLabel ovenfor — api/
// importerer bevidst ikke fra src/ (se api/_shared.js).
export async function officialSeasonIds(sb) {
  const leagues = await sb(`/rest/v1/leagues?is_official=is.true&select=id`);
  if (!leagues.length) return [];
  const seasons = await sb(`/rest/v1/seasons?league_id=in.(${leagues.map((l) => l.id).join(",")})&select=id`);
  return seasons.map((s) => s.id);
}

// Den nyeste runde, hvis VINDUE er lukket.
//
// Runderne løber tirsdag til mandag (`round_key()` i sql/rating_core.sql), og
// `round_key` er rundens tirsdag. En runde er derfor forbi, når der er gået syv
// dage fra dens tirsdag — og datoen syv dage tilbage er præcis den nyeste
// round_key, der opfylder det. Regnes i dansk tid af samme grund som
// dateInZone() selv: serverens UTC-dato ligger en dag bagud efter midnat.
export function lastClosedRoundKey(now, timeZone) {
  return dateInZone(new Date(now.getTime() - 7 * 24 * HOUR), timeZone);
}

// De round_key'er, der er FÆRDIGE — hvor runden både er forbi, og hver kamp i
// listen har fået sit resultat. Kaldes med kampe, der allerede er afgrænset til
// de officielle turneringer: en runde må ikke holdes åben af kampe, der ikke
// tæller i den stilling, beskeden rapporterer fra.
//
// HVORFOR DER ER TO BETINGELSER OG IKKE ÉN. "Alle kampe har resultat" er ikke
// et svar på, om runden er slut — det er et svar på, om alt, vi har IMPORTERET,
// er spillet. De to er kun det samme, hvis kamplisten er komplet, og det er den
// ikke nødvendigvis: en kamp uden fastlagt dato findes slet ikke som række (en
// udsat kamp uden nyt tidspunkt, en knockout-kamp før lodtrækningen — se
// `undrawn` i api/sync-matches.js), og en række, der ikke findes, kan ingen
// kontrol af rækker opdage.
//
// `G51` (1. august 2026) lukkede den ENE måde, listen kunne være ufuldstændig
// på — de tavst afkortede svar — og efterlod den anden. Rettelsen der var at
// give opslaget en øvre grænse; rettelsen her er at gøre grænsen til den, der
// også dækker den anden: et lukket rundevindue er den eneste tilstand, hvor
// rundens SAMMENSÆTNING ikke længere kan ændre sig. En kamp kan flyttes frem og
// dermed ud af runden, aldrig tilbage og ind i den.
//
// Prisen er, at "Runden er slut" tidligst afgår tirsdag. For de fleste runder
// er det ingen forskel: den sidste kamp ligger typisk mandag aften, og
// sendevinduet (A24) holder alligevel beskeden tilbage til tirsdag kl. 08. For
// en runde, der er færdigspillet søndag, er beskeden ~2 døgn senere end før.
// Det er valgt bevidst: en besked, der siger "du blev nr. 4 af 18" om en runde,
// der senere viser sig at have 22 tippere, er værre end en besked, der kommer
// tirsdag.
//
// `lastClosed` er PÅKRÆVET og har ingen standardværdi. En, der kunne glemmes,
// ville gøre funktionen tavst usund igen — samme regel som `order` i sbAll().
export function finishedRoundKeys(matches, lastClosed) {
  if (!lastClosed) {
    throw new Error("finishedRoundKeys(): lastClosed mangler — en runde, hvis vindue stadig er åbent, kan ikke meldes færdig");
  }
  const byRound = {};
  for (const m of matches) (byRound[m.round_key] ||= []).push(m);
  return Object.entries(byRound)
    .filter(([roundKey]) => roundKey <= lastClosed)
    .filter(([, list]) => list.length > 0 && list.every((m) => m.home_score != null && m.away_score != null))
    .map(([roundKey]) => roundKey);
}

// Er kørslen lykkedes, når nogle beskeder ikke kunne afleveres? (G45)
//
// Delvist tab er normalt: en enkelt push-tjeneste, der hikker, skal ikke udløse
// alarm. Men reglen var indtil august 2026 `sent === 0`, og den er for løs:
// `failed=40, sent=1` stod grønt i Admin → Drift, så en langsomt døende
// push-kæde (udløbne VAPID-nøgler, en leverandør med problemer) var usynlig,
// indtil den var HELT død. Fejlraten fandtes allerede i funktionen; den manglede
// bare i vurderingen.
//
// Halvdelen er grænsen, fordi det er det punkt, hvor "et hik" ikke længere er en
// troværdig forklaring. Én rød kørsel udløser ikke i sig selv en alarm —
// heartbeat'en råber først ved tre fejl i træk — så tærsklen må gerne være
// følsom nok til at fange en enkelt dårlig kørsel.
//
// Bemærk hvad der IKKE tælles med: 404/410 fra push-tjenesten er afmeldte
// enheder og ryddes op som normal drift, ikke som fejl.
export const PUSH_FAILURE_ALERT_RATIO = 0.5;

export function pushRunVerdict({ sent, failed }, ratio = PUSH_FAILURE_ALERT_RATIO) {
  if (!failed) return { ok: true };
  const attempted = sent + failed;
  if (failed / attempted < ratio) return { ok: true };
  return {
    ok: false,
    reason: sent === 0
      ? `Alle ${failed} afsendelser fejlede.`
      : `${failed} af ${attempted} afsendelser fejlede (${Math.round((failed / attempted) * 100)} %).`,
  };
}

// ---- tidsbudget for afsendelsen (G17) ----
//
// Funktionens samlede loft er `maxDuration` i vercel.json (300 s for netop
// dette endpoint). Budgettet her er MINDRE end det med vilje: når det løber ud,
// skal der stadig være tid til at frigive claims, rydde døde abonnementer og
// skrive `job_runs`-rækken. Et budget lig med loftet ville betyde, at
// oprydningen aldrig nåede at køre — og så havde vi ikke rykket problemet, kun
// flyttet det.
//
// De to tal hænger sammen og skal ændres sammen: hæves `maxDuration`, må dette
// følge med, ellers spilder kørslen tid, den har fået. Det gik den anden vej
// første gang: budgettet stod på 40 s under et antaget loft på 60, mens
// platformens faktiske standard viste sig at være 300 (aflæst på Vercels
// funktions-liste 1. august 2026) — altså var loftet gættet, ikke aflæst.
const SEND_BUDGET_MS = 240_000;
// Pr. afsendelse. Én uansvarlig push-tjeneste må ikke kunne bruge hele
// budgettet alene — med denne grænse koster den højst 10 sekunder.
const PUSH_TIMEOUT_MS = 10_000;
// Hvor mange beskeder der er undervejs på én gang. Loopet var helt sekventielt
// indtil august 2026, så 100 beskeder var 100 rundture efter hinanden. Loftet
// er lavt med vilje: push-tjenesterne er tredjeparts, og formålet er at bruge
// ventetiden — ikke at presse dem.
const SEND_CONCURRENCY = 6;

// Sender så mange beskeder som budgettet tillader, og returnerer dem, der
// ALDRIG blev forsøgt.
//
// Skillet er hele pointen: en besked, der ikke er forsøgt, kan frigives og
// sendes af næste kørsel, mens en, hvis afsendelse fejlede, ikke kan — vi ved
// ikke, om den nåede frem. Funktionen er derfor eksporteret og testet med et
// styret ur; adfærden er umulig at afprøve i drift, fordi den kun viser sig,
// når kørslen er ved at løbe tør for tid.
//
// `send` kaster aldrig (kalderen fanger selv), så et fejlet kald tæller som
// forsøgt og bliver ikke frigivet.
export async function sendWithBudget(messages, { deadlineAt, send, concurrency = SEND_CONCURRENCY, now = () => Date.now() }) {
  let next = 0;
  const skipped = [];
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= messages.length) return;
      // Der brydes ikke ud af løkken: de resterende beskeder skal SAMLES OP,
      // ikke bare forlades. Et `break` her ville efterlade dem claimet og
      // dermed genskabe præcis den fejl, funktionen findes for at fjerne.
      if (now() >= deadlineAt) { skipped.push(messages[i]); continue; }
      await send(messages[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, messages.length)) }, worker));
  return skipped;
}

// Sletter claim-rækkerne for beskeder, der ikke blev forsøgt.
//
// PostgREST har ingen "slet disse par"-form, så filtret bygges som et
// `or=(and(user_id.eq…,key.eq…),…)`. Nøglerne citeres, fordi de indeholder
// koloner (`result:2026-08-04`), som ellers ville blive læst som syntaks.
// Chunkes, fordi en URL har en længdegrænse — og en frigivelse, der fejler på
// en for lang URL, ville tabe præcis de beskeder, den skulle redde.
export async function releaseClaims(sb, messages, chunkSize = 50) {
  let released = 0;
  for (let i = 0; i < messages.length; i += chunkSize) {
    const chunk = messages.slice(i, i + chunkSize);
    const filter = chunk
      .map((m) => `and(user_id.eq.${m.userId},key.eq.${encodeURIComponent(`"${m.key}"`)})`)
      .join(",");
    try {
      await sb(`/rest/v1/notification_log?or=(${filter})`, { method: "DELETE", prefer: "return=minimal" });
      released += chunk.length;
    } catch (e) {
      // Må aldrig vælte kørslen: beskederne er ikke sendt, og en fejlet
      // frigivelse efterlader os præcis dér, hvor vi var før rettelsen — ikke
      // værre. Men den skal kunne ses.
      console.error(`[send-notifications] Kunne ikke frigive ${chunk.length} claims:`, e?.message ?? e);
    }
  }
  return released;
}

// Modtagerne af "ny konkurrence i din liga"-beskeden (B5), udregnet ud fra rå
// rækker, så reglen kan efterprøves uden en database. Én besked pr.
// (konkurrence, medlem) — nøglen `newcomp:<id>` gør den til én besked i alt.
//
// Fire ting udelukker et medlem, og de er ikke alle lige åbenlyse:
//   * opretteren selv — de ved det godt, og de er i forvejen deltager;
//   * den, der allerede deltager. Konkurrencen ER opdaget, og en invitation til
//     noget, man er med i, er støj. Det fanger opretteren igen (auto-tilmeldt),
//     så filtret er en sikkerhedssele, ikke en dublet;
//   * den, der meldte sig ind i ligaen EFTER konkurrencen blev oprettet. For dem
//     er konkurrencen ikke ny — den stod på liga-siden, da de kom ind — og
//     "ny konkurrence" ville være en direkte usand sætning;
//   * den, der ikke har en tilmeldt enhed (afgøres af kalderen via isSubscribed).
export function newCompetitionMessages({ competitions, groups, members, participants, creators }, isSubscribed) {
  const groupName = new Map((groups || []).map((g) => [g.id, g.name]));
  const creatorName = new Map((creators || []).map((p) => [p.id, p.display_name]));
  const membersByGroup = {};
  for (const m of members || []) (membersByGroup[m.group_id] ||= []).push(m);
  const joined = new Set((participants || []).map((p) => `${p.competition_id}:${p.user_id}`));

  const out = [];
  for (const c of competitions || []) {
    const liga = groupName.get(c.group_id);
    // Ligaen kan være slettet, mens konkurrencen stadig lå i vinduet (group_id
    // sættes til null ved sletning, men rækken kan være læst før). Uden navnet
    // har beskeden ingen sætning at sige — og ingen medlemsliste at sende til.
    if (!liga) continue;
    for (const m of membersByGroup[c.group_id] || []) {
      if (m.user_id === c.created_by) continue;
      if (joined.has(`${c.id}:${m.user_id}`)) continue;
      if (m.joined_at && c.created_at && new Date(m.joined_at) > new Date(c.created_at)) continue;
      if (!isSubscribed(m.user_id)) continue;
      const opretter = creatorName.get(c.created_by);
      out.push({
        userId: m.user_id,
        key: `newcomp:${c.id}`,
        title: `Ny konkurrence i ${liga} 🎯`,
        body: opretter
          ? `${opretter} har oprettet "${c.name}". Tryk for at være med.`
          : `"${c.name}" er åbnet. Tryk for at være med.`,
        tag: `newcomp-${c.id}`,
        kind: "newcomp",
        // Invitationskoden er ikke en hemmelighed over for denne modtager: de er
        // medlem af ligaen og kan i forvejen se og deltage i konkurrencen fra
        // liga-siden. Koden bruges her, fordi ?join= allerede har en bekræftelse
        // og en landing — beskeden skal ikke opfinde sin egen (A8: joinet melder
        // ind i begge, hvilket for et medlem er en no-op).
        joinCode: c.invite_code,
      });
    }
  }
  return out;
}

// Modtagerne af "du blev Ugens/Månedens bedste"-beskeden (B11).
//
// Rækken i competition_awards ER beskeden: den er skrevet af
// `award_competition_periods()` ud fra grunddata, den er frossen, og den er
// den samme kåring, boardet og story-kortet viser. Denne funktion oversætter
// den kun til tekst — den afgør ikke, hvem der vandt.
//
// Delt kåring giver én række pr. vinder, alle med `shared = true`; hver af dem
// får sin egen besked, og nøglen bærer både konkurrence og periode, så en
// bruger med kåringer i to konkurrencer i samme uge får to beskeder (det er to
// forskellige fællesskaber) — men aldrig to for den samme.
export function awardMessages({ awards, competitions }, isSubscribed) {
  const compName = new Map((competitions || []).map((c) => [c.id, c.name]));
  const out = [];
  for (const a of awards || []) {
    const navn = compName.get(a.competition_id);
    // Konkurrencen kan være slettet, mens kåringen stadig lå i vinduet
    // (`on delete cascade` fjerner rækken, men vores kopi er læst før). Uden
    // navnet har beskeden ingen sætning at sige.
    if (!navn) continue;
    if (!isSubscribed(a.user_id)) continue;
    const uge = a.period_type === "round";
    const delt = a.shared ? "delt " : "";
    out.push({
      userId: a.user_id,
      key: `award:${a.competition_id}:${a.period_type}:${a.period_key}`,
      title: uge ? `Du er ${delt}Ugens bedste 🏅` : `Du er ${delt}Månedens bedste 👑`,
      body: `${a.points} point — flest af alle i "${navn}"${a.shared ? " (delt)" : ""}.`,
      tag: `award-${a.competition_id}-${a.period_type}`,
      kind: "award",
    });
  }
  return out;
}

// Modtagerne af "ny turnering"-beskeden (B9).
//
// Den eneste af de fem beskedtyper UDEN en modtager-afgrænsning: en ny
// turnering er tilgængelig for alle, så der findes ingen medlemsliste at
// skære efter. Til gengæld er de to andre betingelser hårde:
//   * turneringen skal være SYNLIG. `is_visible = false` er den tilstand, en
//     turnering sættes op i, mens den verificeres (A10/B2) — en besked derfra
//     ville pege på noget, modtageren ikke kan se;
//   * den skal have mindst én kamp, man kan tippe. En turnering uden
//     kampprogram er et navn, ikke en mulighed, og en besked om den ville koste
//     præcis den tilladelse, produktet ikke kan få tilbage.
export function newTournamentMessages({ leagues, playableLeagueIds }, isSubscribed, userIds) {
  const spilbar = new Set(playableLeagueIds || []);
  const out = [];
  for (const l of leagues || []) {
    if (!l.is_visible) continue;
    if (!spilbar.has(l.id)) continue;
    for (const uid of userIds || []) {
      if (!isSubscribed(uid)) continue;
      out.push({
        userId: uid,
        key: `newleague:${l.id}`,
        title: "Ny turnering i Leagly ⚽",
        body: `${l.name} kan nu tippes. Opret en konkurrence, eller vent på at nogen i din liga gør det.`,
        tag: `newleague-${l.id}`,
        kind: "newleague",
      });
    }
  }
  return out;
}

export default async function handler(req, res) {
  // Sættes så snart autorisationen er i hus. Ligger uden for try'et, fordi
  // catch'en skal kunne bruge den — en kørsel, der vælter, er netop den, der
  // skal ende i job_runs.
  let run = null;
  try {
    // Nulpunktet for afsendelsens tidsbudget (G17). Måles fra handlerens start
    // og ikke fra selve send-loopet: opslagene før det bruger også af
    // funktionens `maxDuration`, og det er dét loft, budgettet skal holde sig
    // inden for.
    const startedAt = Date.now();
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SYNC_SECRET = process.env.SYNC_SECRET;
    const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
    const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
    const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:notifications@leagly.invalid";

    // Offentligt endpoint: frontendens tilmelding henter den offentlige VAPID-nøgle her,
    // så nøglen kun findes ét sted (Vercels miljøvariabler).
    if (req.query.action === "vapidKey") {
      if (!VAPID_PUBLIC_KEY) {
        // Offentligt endpoint: samme regel som ovenfor (G38) — navnet i logs,
        // ikke i svaret.
        console.error("[opsætning] VAPID_PUBLIC_KEY mangler i miljøet.");
        return res.status(500).json({ error: "Notifikationer er ikke sat op på serveren endnu." });
      }
      return res.status(200).json({ publicKey: VAPID_PUBLIC_KEY });
    }

    // Svaret navngiver IKKE variablerne (G38). Tjekket ligger nødvendigvis FØR
    // autorisationen — uden dem kan vi ikke engang slå kalderen op — så teksten
    // ville ellers kortlægge backendens opsætning for enhver uautentificeret
    // kaldende. Navnene er ikke hemmelige, men de er gratis rekognoscering, og
    // de hører hjemme dér, hvor kun vi kan læse dem: i Vercels logs.
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error("[opsætning] SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY mangler i miljøet.");
      return res.status(500).json({ error: "Serveren er ikke sat rigtigt op." });
    }
    const sb = createSb(SUPABASE_URL, SERVICE_KEY);

    // ---- autorisation: enten en admin-brugers login, eller den delte hemmelige nøgle (til ekstern cron) ----
    // Reglerne bor i api/_shared.js, så de er ens for alle tre job-endpoints.
    const auth = await isAuthorized(req, {
      sb,
      supabaseUrl: SUPABASE_URL,
      serviceKey: SERVICE_KEY,
      syncSecret: SYNC_SECRET,
    });
    if (!auth.ok) {
      return res.status(401).json({ error: "Ikke autoriseret" });
    }

    // VAPID-tjekket ligger EFTER autorisationen (G38). Modsat Supabase-nøglerne
    // er det muligt her — autorisationen har ikke brug for dem — og så må navnene
    // gerne stå i svaret: den eneste, der kan se det, er en admin eller cron-jobbet,
    // og for dem er det præcise navn hele værdien.
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return res.status(500).json({ error: "VAPID-nøgler mangler i Vercel-projektet (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)" });
    }
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const dryRun = req.query.dryRun === "true";
    const force = req.query.force === "true";
    const horizonHours = Math.min(24, Math.max(1, Number(req.query.hours) || 3));
    run = createRunLogger(sb, "send-notifications", { skip: dryRun });
    // A11: hvilken vej autorisationen kom ind, ned i driftsloggen — se setAuth().
    run.setAuth(auth.via);

    // ---- Sendevindue (A24): ingen push om natten ----
    // Kørslen stopper HER, før der er læst en eneste besked og længe før
    // claim-trinnet. Det er ikke en optimering, det er hele mekanikken:
    //
    //   * Intet reserveres i notification_log, så intet går tabt. Havde vi i
    //     stedet bygget beskederne og sprunget afsendelsen over efter claim'et,
    //     ville de være PERMANENT tabt — claim-rækken forhindrer per design en
    //     senere kørsel i at prøve igen (se claim-trinnet nedenfor).
    //   * Der findes ingen kø, og der skal ikke bygges en. Outboxen udregnes
    //     forfra ved hver kørsel, så en besked, der ikke blev sendt kl. 23, er
    //     stadig sand kl. 08 og udregnes bare igen — nøglerne `result:<runde>`
    //     og `newcomp:<id>` er uændrede, så den lander som ÉN besked kl. 08,
    //     præcis som en udskudt levering ville have gjort. (`newcomp`s
    //     døgn-vindue er med vilje større end vinduets 10 stille timer.)
    //
    // Deadline-påmindelsen opfører sig bevidst ANDERLEDES, og det er den rigtige
    // forskel: den bliver ikke udskudt, den bortfalder. Kl. 08 udregnes en frisk
    // påmindelse for det, der låser derefter. En udskudt natte-påmindelse ville
    // sige "den første låser om 2 timer" om en kamp, der låste for seks timer
    // siden — en besked, der er blevet usand undervejs, skal ikke leveres.
    // Prisen: låser en kamp mellem 22 og 11 (vinduets åbning + horisonten),
    // kommer der ingen påmindelse. Tidlige formiddagskampe er sjældne i de
    // turneringer, appen dækker, og alternativet er at vække alle andre.
    if (!dryRun && !force && !withinSendWindow(new Date())) {
      return run.ok(res, {
        sent: 0,
        note: `Uden for sendevinduet (${SEND_WINDOW.start}–${SEND_WINDOW.end} dansk tid). Intet er reserveret; beskederne udregnes forfra og sendes ved første kørsel efter kl. ${SEND_WINDOW.start}.`,
        window: `${SEND_WINDOW.start}-${SEND_WINDOW.end} ${SEND_WINDOW.timeZone}`,
      });
    }

    // tilmeldte enheder, grupperet pr. bruger — er ingen tilmeldt, er der intet at gøre
    const subs = await sbAll(sb, `/rest/v1/push_subscriptions?select=id,user_id,endpoint,p256dh,auth`, {
      order: "id.asc",
    });
    if (!subs.length) return run.ok(res, { sent: 0, note: "Ingen tilmeldte enheder" });
    const subsByUser = {};
    for (const s of subs) (subsByUser[s.user_id] ||= []).push(s);
    const subscribedUsers = Object.keys(subsByUser);

    // planlagte beskeder: { userId, key, title, body, tag }
    const outbox = [];
    const now = Date.now();

    // ================= 1) Deadline-påmindelser =================
    // Kampe hvis lås (kickoff − 1 time) rammes inden for de næste horizonHours timer,
    // og som brugeren mangler tips på. Kickoff-vinduet nu-7d..nu+8d dækker rigeligt.
    //
    // Grupperingen er PR. BRUGER PR. DAG, ikke pr. runde. Før A21 låste hele runden
    // samtidig, så "runden" var både deadline og besked-enhed. Nu låser hver kamp for
    // sig, og en runde har ikke ét låsetidspunkt at varsle om. To ting fulgte med:
    //   * den gamle kode sprang en hel runde over, så snart ÉN kamp havde resultat
    //     ("resultat ⇒ runden er allerede låst"). Per kamp er det direkte forkert —
    //     resten af runden kan sagtens være utippet og stadig åben, og brugeren ville
    //     aldrig få en påmindelse om den.
    //   * én besked pr. kamp ville være spam (en weekend med ti kampe = ti beskeder).
    // Derfor: én samlet besked pr. bruger pr. dag, som nævner antallet og tiden til den
    // FØRSTE lås. Kadencen er dermed den samme som før — kun enheden er en anden.
    {
      const from = new Date(now - 7 * 24 * HOUR).toISOString();
      const to = new Date(now + 8 * 24 * HOUR).toISOString();
      const ms = await sbAll(
        sb,
        `/rest/v1/matches?kickoff_at=gte.${from}&kickoff_at=lte.${to}&select=id,season_id,round_key,kickoff_at,kickoff_tbd,home_score`,
        { order: "id.asc" }
      );
      const lockingMatches = ms.filter((m) => {
        if (!m.kickoff_at || m.home_score != null) return false;
        // En kamp uden fastlagt klokkeslæt har intet "om en time" at minde om —
        // dens kickoff_at bærer kun en dato, og beskeden ville nævne et tidspunkt,
        // kampen ikke spilles på. Runde-påmindelsen dækker den fortsat.
        if (m.kickoff_tbd) return false;
        const lockAt = new Date(m.kickoff_at).getTime() - LOCK_LEAD_MS;
        return lockAt > now && lockAt <= now + horizonHours * HOUR;
      });

      if (lockingMatches.length) {
        const matchIds = lockingMatches.map((m) => m.id);
        // hvilke brugere er kampene relevante for? (deltagere i konkurrencer, kampene indgår i)
        const cms = await sbAll(
          sb,
          `/rest/v1/competition_matches?match_id=in.(${matchIds.join(",")})&select=competition_id,match_id`,
          { order: "competition_id.asc,match_id.asc" }
        );
        const compIds = [...new Set(cms.map((c) => c.competition_id))];
        const parts = compIds.length
          ? await sbAll(
              sb,
              `/rest/v1/competition_participants?competition_id=in.(${compIds.join(",")})&select=competition_id,user_id`,
              { order: "competition_id.asc,user_id.asc" }
            )
          : [];
        const usersByComp = {};
        for (const p of parts) (usersByComp[p.competition_id] ||= new Set()).add(p.user_id);
        const usersByMatch = {};
        for (const c of cms) {
          for (const uid of usersByComp[c.competition_id] || []) (usersByMatch[c.match_id] ||= new Set()).add(uid);
        }
        // Skalerer som kampe × brugere og er dermed den, der først rammer
        // loftet: en afkortet tip-liste ville give falske "du mangler tips".
        const preds = await sbAll(
          sb,
          `/rest/v1/predictions?match_id=in.(${matchIds.join(",")})&select=user_id,match_id,pred_home,pred_away`,
          { order: "user_id.asc,match_id.asc" }
        );
        const tipped = new Set(preds.filter((p) => p.pred_home != null && p.pred_away != null).map((p) => `${p.match_id}:${p.user_id}`));

        const today = new Date().toISOString().slice(0, 10);
        for (const uid of subscribedUsers) {
          const missing = lockingMatches
            .filter((m) => usersByMatch[m.id]?.has(uid) && !tipped.has(`${m.id}:${uid}`))
            .sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));
          if (!missing.length) continue;
          // Den første lås er den, brugeren skal nå — og den runde, Tip-skærmen
          // skal lande på, når beskeden åbnes.
          const first = missing[0];
          const lockAt = new Date(first.kickoff_at).getTime() - LOCK_LEAD_MS;
          outbox.push({
            userId: uid,
            key: `deadline:${today}`, // maks. én påmindelse pr. bruger pr. dag
            title: missing.length === 1 ? "En kamp låser snart ⏰" : "Kampe låser snart ⏰",
            body: `${missing.length} ${missing.length === 1 ? "kamp mangler" : "kampe mangler"} dine tips — den første låser om ${fmtUntil(lockAt)}.`,
            tag: `deadline-${today}`,
            kind: "deadline",
            roundKey: first.round_key,
          });
        }
      }
    }

    // ================= 2) Runde-resultater =================
    // Runder fra de seneste 14 dage, hvor ALLE kampe har fået resultat: point + placering
    // fra round_standings-viewet (på tværs af de officielle turneringer, præcis som
    // Championship-fanens rundechampionship ved samlet visning).
    //
    // BEGGE sider er afgrænset til de OFFICIELLE turneringer, og de skal følges ad.
    // Beskeden rapporterer fra scope = 'ALL', som kun summerer officielle turneringer
    // (sql/tournament_scope.sql), så:
    //   * kampopslaget afgrænses til deres sæsoner — ellers ville en uspillet kamp i en
    //     turnering, stillingen ikke engang dækker (Skotland er synlig, men ikke
    //     officiel), holde runden åben og notifikationen tilbage for ALLE. Samme regel
    //     som loadRoundBoard/scopeSeasonIds i frontenden, jf. DOCUMENTATION.md §5.
    //   * stillingsopslaget filtrerer på scope = 'ALL' — uden det har viewet én række
    //     pr. (round_key, scope, user_id), så board.length bliver et multiplum af det
    //     rigtige felt og "du blev nr. X af N" lyver om N.
    {
      const seasonIds = await officialSeasonIds(sb);
      // NEDRE grænse: hvor langt tilbage en glemt runde stadig kan indhentes.
      // Tre uger og ikke to, fordi den øvre grænse flyttede en uge tilbage (se
      // nedenfor) — vinduet mellem de to skal blive ved med at være 14 dage
      // bredt, ellers rummer det kun ÉN tirsdag, og et cron-udfald på en uge
      // ville springe en runde over for altid frem for at hente den senere.
      const fromKey = new Date(now - 21 * 24 * HOUR).toISOString().slice(0, 10);
      // ØVRE grænse, og den er lige så nødvendig som den nedre. Uden den bad
      // opslaget om hver eneste kamp fra de seneste uger OG resten af
      // sæsonen — for fem officielle turneringer er det langt over de 1000
      // rækker, Supabase leverer i ét svar, og afkortningen er tavs (G51).
      // Følgen var ikke en manglende besked, men en FORKERT: faldt en rundes
      // uspillede kampe uden for de 1000, så runden færdigspillet ud, og
      // "Runden er slut" afgik midt i en igangværende runde med et
      // stillingsfelt, der kun talte de spillede kampes tippere.
      //
      // Grænsen er ikke bare en optimering: en runde, hvis vindue endnu er
      // åbent, kan pr. definition ikke være færdig, så alt derover er rækker,
      // svaret aldrig skulle have båret. Grænsen gik indtil august 2026 ved
      // dagens dato; den går nu ved den nyeste LUKKEDE runde, hvilket lukker
      // den anden måde, kamplisten kan være ufuldstændig på — se
      // finishedRoundKeys() for hvorfor de to ikke er det samme.
      const toKey = lastClosedRoundKey(new Date(now));
      // Ingen officielle turneringer ⇒ ingen 'ALL'-stilling at melde om.
      const ms = seasonIds.length
        ? await sbAll(
            sb,
            `/rest/v1/matches?season_id=in.(${seasonIds.join(",")})&round_key=gte.${fromKey}&round_key=lte.${toKey}&select=id,round_key,home_score,away_score`,
            { order: "id.asc" }
          )
        : [];

      for (const roundKey of finishedRoundKeys(ms, toKey)) {
        // samme kilde og samme tiebreaker-stige som Championship-fanens rundechampionship
        // (sql/standings_tiebreakers.sql). En runde har ingen rundesejre at bryde
        // lighed med, så stigen er point → præcise → udfald → målafvigelse.
        const board = await sb(`/rest/v1/round_standings?round_key=eq.${roundKey}&scope=eq.ALL&select=user_id,total_points,exact_count,outcome_count,avg_goal_error&order=total_points.desc,exact_count.desc,outcome_count.desc,avg_goal_error.asc,user_id.asc`);
        assignRanks(board);

        for (const r of board) {
          if (!subsByUser[r.user_id]) continue;
          const champ = r.rank === 1;
          const pos = r.shared ? `delt nr. ${r.rank}` : `nr. ${r.rank}`;
          outbox.push({
            userId: r.user_id,
            key: `result:${roundKey}`,
            title: champ
              ? (r.shared ? "Du er delt Rundens Champion! 🏆" : "Du er Rundens Champion! 🏆")
              : "Runden er slut ⚽",
            body: `Runden ${roundLabel(roundKey)}: du fik ${r.total_points} point og blev ${pos} af ${board.length}.`,
            tag: `result-${roundKey}`,
            kind: "result",
            roundKey,
          });
        }
      }
    }

    // ================= 3) Ny konkurrence i en liga (B5) =================
    // Et liga-medlem opdagede før kun en ny konkurrence ved selv at åbne ligaen.
    // Beskeden er dermed den eneste af de fem, der handler om FÆLLESSKABET frem
    // for om kampe eller kåringer — og sammen med "ny turnering" (B9) en af de
    // to, der beder om en handling, brugeren ellers ikke ville vide fandtes.
    //
    // Modsat de to andre sektioner er der ingen kamp- eller stillingsafgrænsning
    // her: en konkurrence i en uofficiel turnering er lige så meget en invitation
    // som en i Superligaen. Reglen selv står i newCompetitionMessages().
    {
      const since = new Date(now - NEW_COMPETITION_WINDOW_MS).toISOString();
      const competitions = await sb(
        `/rest/v1/competitions?group_id=not.is.null&created_at=gte.${since}&select=id,name,group_id,created_by,created_at,invite_code`
      );
      if (competitions.length) {
        const groupIds = [...new Set(competitions.map((c) => c.group_id))];
        const creatorIds = [...new Set(competitions.map((c) => c.created_by).filter(Boolean))];
        const [groups, members, participants, creators] = await Promise.all([
          sb(`/rest/v1/groups?id=in.(${groupIds.join(",")})&select=id,name`),
          sbAll(sb, `/rest/v1/group_members?group_id=in.(${groupIds.join(",")})&select=group_id,user_id,joined_at`, {
            order: "group_id.asc,user_id.asc",
          }),
          sbAll(
            sb,
            `/rest/v1/competition_participants?competition_id=in.(${competitions.map((c) => c.id).join(",")})&select=competition_id,user_id`,
            { order: "competition_id.asc,user_id.asc" }
          ),
          creatorIds.length
            ? sb(`/rest/v1/profiles?id=in.(${creatorIds.join(",")})&select=id,display_name`)
            : Promise.resolve([]),
        ]);
        outbox.push(
          ...newCompetitionMessages(
            { competitions, groups, members, participants, creators },
            (uid) => Boolean(subsByUser[uid])
          )
        );
      }
    }

    // ================= 4) Lokale kåringer (B11) =================
    // To skridt, og rækkefølgen er hele pointen: FØRST skrives kåringerne,
    // DEREFTER læses de. `award_competition_periods()` er lazy og blev indtil nu
    // kun trigget af en klient, der åbnede boardet — så en kåring kunne mangle,
    // til nogen tilfældigvis kiggede. Jobbet her kører som `service_role`, som
    // funktionens guard allerede tillader (A22 skrev den med netop dette for
    // øje), og bliver dermed den pålidelige skriver. Det er også dét, der gør
    // Story Engines regel 65/15 troværdig: kortet kan ikke længere afhænge af,
    // om nogen havde åbnet boardet først.
    //
    // Kaldet er idempotent (`on conflict do nothing`) og returnerer antallet af
    // NYE rækker, så det koster ingenting at kalde det hver kørsel.
    {
      const optIn = await sbAll(
        sb,
        `/rest/v1/competitions?mode_params->>awards=eq.true&select=id,name`,
        { order: "id.asc" }
      );
      if (optIn.length) {
        // Sekventielt og ikke parallelt: funktionen læser og skriver den samme
        // tabel for hver konkurrence, og der er ingen hastighed at vinde — hele
        // pointen er, at kåringerne står der, når outboxen bygges nedenfor.
        // En fejl på én konkurrence må ikke koste de andre deres besked.
        //
        // `dryRun` springer skrivningen over — forhåndsvisningen i Admin → Drift
        // er en LÆSNING, og et kort, der lover "intet sker", må ikke kåre nogen.
        // Prisen er, at en kåring, ingen endnu har udløst, mangler i
        // forhåndsvisningen; det er den rigtige vej at tage fejl.
        for (const c of dryRun ? [] : optIn) {
          try {
            await sb(`/rest/v1/rpc/award_competition_periods`, {
              method: "POST",
              body: JSON.stringify({ p_comp_id: c.id }),
            });
          } catch (e) {
            console.warn(`[B11] kåringer kunne ikke beregnes for ${c.id}:`, e?.message ?? e);
          }
        }
        const since = new Date(now - AWARD_WINDOW_MS).toISOString();
        const awards = await sbAll(
          sb,
          `/rest/v1/competition_awards?competition_id=in.(${optIn.map((c) => c.id).join(",")})&awarded_at=gte.${since}&select=competition_id,period_type,period_key,user_id,points,shared`,
          { order: "competition_id.asc,period_key.asc,user_id.asc" }
        );
        outbox.push(...awardMessages({ awards, competitions: optIn }, (uid) => Boolean(subsByUser[uid])));
      }
    }

    // ================= 5) Ny turnering (B9) =================
    // Modsat de fire andre sektioner har denne ingen modtager-regel — en ny
    // turnering er alles. Prisen for den bredde er, at betingelserne for at
    // sende skal være strammere: turneringen skal være synlig OG have kampe.
    {
      const since = new Date(now - NEW_TOURNAMENT_WINDOW_MS).toISOString();
      const leagues = await sb(
        `/rest/v1/leagues?created_at=gte.${since}&select=id,name,is_visible,created_at`
      );
      if (leagues.length) {
        // "Har den kampe?" besvares på sæsonerne og ikke på turneringen selv:
        // det er kampene, der gør den tipbar, og de kommer først med den første
        // sync-kørsel — typisk timer efter rækken blev oprettet.
        const seasons = await sb(`/rest/v1/seasons?league_id=in.(${leagues.map((l) => l.id).join(",")})&select=id,league_id`);
        const playable = new Set();
        if (seasons.length) {
          const ms = await sb(
            `/rest/v1/matches?season_id=in.(${seasons.map((s) => s.id).join(",")})&home_score=is.null&select=season_id&limit=200`
          );
          const leagueOfSeason = new Map(seasons.map((s) => [s.id, s.league_id]));
          for (const m of ms) playable.add(leagueOfSeason.get(m.season_id));
        }
        outbox.push(
          ...newTournamentMessages(
            { leagues, playableLeagueIds: [...playable] },
            (uid) => Boolean(subsByUser[uid]),
            subscribedUsers
          )
        );
      }
    }

    if (!outbox.length) return run.ok(res, { sent: 0, note: "Intet at sende lige nu" });

    // ---- dedup mod notification_log ----
    // Dette første filter er kun en optimering (spring beskeder over, en tidligere
    // kørsel allerede har sendt). Den EGENTLIGE sikring mod dubletter er "claim"-
    // trinnet nedenfor: vi skriver til notification_log FØR vi sender, og sender kun
    // de rækker, netop denne kørsel selv fik indsat. Ellers taber check-derefter-send
    // et kapløb, hvis to kald til funktionen kører samtidig (fx flere cron-job, der
    // rammer endpointet på samme minut, eller overlappende kørsler): begge læser en
    // tom log, begge sender — og brugeren får to ens notifikationer på samme tid.
    const userIds = [...new Set(outbox.map((o) => o.userId))];
    const keys = [...new Set(outbox.map((o) => o.key))];
    const logged = await sbAll(
      sb,
      `/rest/v1/notification_log?user_id=in.(${userIds.join(",")})&key=in.(${keys.map((k) => encodeURIComponent(`"${k}"`)).join(",")})&select=user_id,key`,
      { order: "user_id.asc,key.asc" }
    );
    const alreadySent = new Set(logged.map((l) => `${l.user_id}:${l.key}`));
    const candidates = outbox.filter((o) => !alreadySent.has(`${o.userId}:${o.key}`));

    if (dryRun) {
      // Forhåndsvisningen ignorerer sendevinduet med vilje — man skal kunne se,
      // hvad der ligger og venter, netop om aftenen. Men den siger det højt, så
      // listen ikke læses som "det her afgår om lidt".
      const iVindue = withinSendWindow(new Date());
      return run.ok(res, {
        dryRun: true,
        note: iVindue
          ? "Intet er sendt eller logget — dette er kun en forhåndsvisning."
          : `Intet er sendt eller logget — dette er kun en forhåndsvisning. Bemærk: klokken er uden for sendevinduet (${SEND_WINDOW.start}–${SEND_WINDOW.end} dansk tid), så en RIGTIG kørsel ville ikke sende noget nu.`,
        withinSendWindow: iVindue,
        wouldSend: candidates.map(({ userId, key, title, body }) => ({ userId, key, title, body })),
      });
    }
    if (!candidates.length) return run.ok(res, { sent: 0, note: "Alt er allerede sendt" });

    // ---- claim: reservér beskederne i notification_log FØR de sendes ----
    // resolution=ignore-duplicates ⇒ rækker, som en anden (samtidig eller tidligere)
    // kørsel allerede har taget, springes over og returneres IKKE. Kun de rækker,
    // dette kald selv indsatte, kommer retur — og kun dem sender vi. Dermed er
    // indsættelsen den atomare lås, der forhindrer to samtidige kørsler i at sende
    // den samme besked hver især.
    const claimed = (await sb(`/rest/v1/notification_log?on_conflict=user_id,key`, {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=representation",
      body: JSON.stringify(candidates.map((o) => ({ user_id: o.userId, key: o.key }))),
    })) || [];
    const claimedSet = new Set(claimed.map((r) => `${r.user_id}:${r.key}`));
    const toSend = candidates.filter((o) => claimedSet.has(`${o.userId}:${o.key}`));
    if (!toSend.length) return run.ok(res, { sent: 0, note: "Alt er allerede sendt (taget af en anden kørsel)" });

    // ---- send + ryd døde abonnementer op ----
    let sent = 0;
    const deadSubIds = new Set();
    // Beskeder, der er "claimet" i notification_log men fejlede ved AFSENDELSE,
    // er permanent tabt: claim-rækken forhindrer, at en senere kørsel prøver
    // igen. Det er prisen for race-sikkerheden (se claim-trinnet ovenfor), og
    // den er bevidst — vi ved ikke, om et halvt afsendt kald nåede frem.
    //
    // Det gjaldt indtil august 2026 OGSÅ de beskeder, der aldrig blev forsøgt
    // (`G17`), og dét var ikke et bevidst valg: rammer funktionen sin
    // vægurs-grænse midt i loopet, bliver den klippet over, og så er hver
    // resterende claimet række tabt for altid — uden at nogen har prøvet at
    // sende den, og uden at `recordRun` nåede at skrive job-rækken. Det er
    // forskellen mellem "vi prøvede og det gik galt" og "vi nåede det ikke",
    // og kun den første er en pris værd at betale. Derfor budgettet nedenfor.
    let failed = 0;
    const failureSamples = [];

    async function sendOne(msg) {
      // ?pn=<kind> lader klienten logge push_opened med kontekst (analytics v1)
      // — der skrives ingen event her server-side, kun URL'en. De to øvrige
      // parametre er landingen: ?rk= peger Tip-skærmen på den rigtige runde,
      // ?join= sender "ny konkurrence"-beskeden ind i den eksisterende
      // invitations-bekræftelse i MainApp. De sættes kun, når beskeden har dem —
      // App.jsx læser dem uafhængigt af hinanden.
      const params = new URLSearchParams({ pn: msg.kind || "" });
      if (msg.roundKey) params.set("rk", msg.roundKey);
      if (msg.joinCode) params.set("join", msg.joinCode);
      const url = `/?${params.toString()}`;
      const payload = JSON.stringify({ title: msg.title, body: msg.body, tag: msg.tag, url });
      for (const s of subsByUser[msg.userId] || []) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            // Uden den venter web-push i princippet for evigt på en push-tjeneste,
            // der hverken svarer eller lukker — samme hul som `G19` lukkede for
            // vores egne fetch-kald, bare i en pakke vi ikke selv skriver.
            { timeout: PUSH_TIMEOUT_MS }
          );
          sent++;
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) {
            deadSubIds.add(s.id); // enheden er afmeldt — normal oprydning, ikke en fejl
          } else {
            // Alt andet (netværksfejl, 5xx fra push-tjenesten) betyder en tabt besked.
            failed++;
            if (failureSamples.length < 5) {
              failureSamples.push(`${e.statusCode ?? "?"}: ${String(e.message ?? e).slice(0, 200)}`);
            }
            console.error(
              `[send-notifications] Besked tabt for bruger ${msg.userId} (${msg.key}):`,
              e.statusCode ?? "",
              e.message ?? e
            );
          }
        }
      }
    }

    const skipped = await sendWithBudget(toSend, {
      deadlineAt: startedAt + SEND_BUDGET_MS,
      send: sendOne,
    });

    // Frigiv de claims, vi ALDRIG nåede at forsøge (G17). De er ikke sendt, så
    // rækken beskytter ikke længere mod en dublet — den forhindrer bare, at
    // beskeden nogensinde bliver sendt. Slettes den, samler næste kørsel den op
    // af sig selv, fordi outboxen udregnes forfra hver gang (samme mekanik som
    // sendevinduet i A24 hviler på).
    //
    // Kun de UFORSØGTE frigives. En besked, hvis afsendelse fejlede, beholder
    // sin række: vi ved ikke, om den nåede frem, og en dublet er værre end en
    // manglende besked.
    let released = 0;
    if (skipped.length) {
      released = await releaseClaims(sb, skipped);
      console.warn(
        `[send-notifications] Tidsbudgettet løb ud: ${skipped.length} beskeder blev ikke forsøgt. ` +
        `${released} claims frigivet, så næste kørsel kan sende dem.`
      );
    }

    if (deadSubIds.size) {
      await sb(`/rest/v1/push_subscriptions?id=in.(${[...deadSubIds].join(",")})`, { method: "DELETE", prefer: "return=minimal" });
    }

    // Er kørslen lykkedes? Reglen bor i pushRunVerdict() ovenfor — den er
    // eksporteret og testet, fordi tærsklen er et produktvalg og ikke en
    // detalje i et svar.
    const detail = {
      sent,
      messages: toSend.length,
      removedSubscriptions: deadSubIds.size,
      failed,
      // Kun til stede når budgettet faktisk løb ud. Tallet er selve signalet om,
      // at kørslen skal deles op eller maxDuration hæves — uden det ville en
      // kronisk overskredet kørsel se ud som en almindelig, lidt lille kørsel.
      ...(skipped.length ? { skipped: skipped.length, releasedClaims: released } : {}),
      ...(failureSamples.length ? { failureSamples } : {}),
    };
    const verdict = pushRunVerdict({ sent, failed });
    if (!verdict.ok) {
      return run.fail(res, 200, detail, `${verdict.reason} ${failureSamples.join(" | ")}`.trim());
    }
    return run.ok(res, detail);
  } catch (e) {
    return failJob(run, res, e, "send-notifications");
  }
}
