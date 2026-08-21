// Efterfyldning af konkurrencer med kampe, der først er blevet skemalagt efter
// oprettelsen (beslutning A20).
//
// ---------------------------------------------------------------------------
// Hvorfor den findes
//
// En konkurrence materialiserer sine kampe ÉN gang, ved oprettelsen, i
// competition_matches. Det var uproblematisk, da produktet havde én turnering,
// hvis kampprogram var kendt fra sæsonstart. Med syv turneringer holder den
// forudsætning ikke: Champions Leagues knockout trækkes undervejs, og
// Superligaens slutspil skemalægges til foråret. Uden efterfyldning stopper en
// "hel sæson"-konkurrence midt i sæsonen — og gør det tavst.
//
// ---------------------------------------------------------------------------
// De fire regler, der gør efterfyldningen sikker
//
// 1. KUN REGEL-BASEREDE MODES. `full_season`, `team` og `time_range` er
//    defineret af en regel, der kan genudregnes. `custom` og `random` er
//    håndplukkede lister — de må aldrig vokse, for så ville en kupon ændre sig
//    under fødderne på dem, der har valgt den.
//
// 2. `mode_params.stages` ER ET MÆRKAT. Fase-afgrænsning kan ikke længere
//    vælges ved oprettelsen, men gamle konkurrencer har feltet. Findes det, er
//    konkurrencen afgrænset i hånden under den gamle ordning, og den står urørt.
//    Derfor er der ingen overgangsregel og ingen dato at huske: dataene selv
//    siger, hvilke rækker der må vokse.
//
// 3. EN RUNDE, DER ER GÅET I GANG, VOKSER ALDRIG. En kamp må kun tilføjes, hvis
//    ingen kamp i dens RUNDE er låst endnu — altså før rundens tidligste
//    låsetidspunkt, som for langt de fleste kampe er kickoff minus en time og
//    for en kamp uden fastlagt klokkeslæt er midnat på spilledagen (G55). Så kan
//    en efterfyldning aldrig give point for et tip, der allerede er afgivet —
//    den fejl, `filterTippable` findes for at forhindre ved oprettelsen (den
//    afløste runde-reglen `filterFromNextUnfinishedRound` i august 2026).
//
//    Reglen var før den samme som tipslåsen, men er det IKKE længere. Efter A21
//    (1. august 2026) låser hver kamp for sig, og en mekanisk oversættelse
//    hertil ville have gjort reglen løsere end sin egen begrundelse: en ny kamp
//    kunne da lande midt i en runde, hvis tidlige kampe var spillet, mens
//    deltagerne allerede havde tippet og set stillingen. Runde-betingelsen står
//    derfor tilbage som en selvstændig, strengere efterfyldnings-regel.
//    Rundestarten regnes ud fra HELE sæsonens kampe og ikke kun konkurrencens
//    egne — ellers kunne en konkurrence uden fredagskampen vokse, efter runden
//    reelt var i gang.
//
//    OG UD FRA ALLE KONKURRENCENS TURNERINGER, ikke kun den, der synkroniseres
//    (G8, august 2026). En runde er en KALENDERUGE (`round_key()` er rundens
//    tirsdag, sql/rating_core.sql) og hører derfor ikke til én turnering: en
//    konkurrence over Superligaen OG Premier League har begge ligaers kampe i
//    samme runde. Kaldet er stadig pr. sæson — sync-matches synkroniserer én
//    turnering ad gangen — så for en flerturnerings-konkurrence hentes de
//    ØVRIGE turneringers kampe med alene for at regne rundens start. Uden det
//    var reglen sand pr. turnering og falsk pr. konkurrence: Superligaens
//    fredagskamp kunne have sat runden i gang, mens efterfyldningen så en
//    urørt Premier League-runde og lagde en ny kamp ind under deltagerne.
//    Præcis samme sætning som afsnittet ovenfor, ét niveau højere oppe — og
//    den kunne ikke ses før, fordi ingen konkurrence har haft mere end én
//    turnering (`G8`).
//
// 4. EN KONKURRENCE VOKSER ALDRIG BAGUD FORBI SIN EGEN STARTRUNDE. Valgte
//    opretteren "start ved næste runde", står den første tilladte rundenøgle i
//    `mode_params.from_round` (`G148`, august 2026), og en kamp i en tidligere
//    runde tilføjes aldrig — heller ikke selv om regel 3 ville tillade den.
//
//    De to regler ligner hinanden og løser hver sit. Regel 3 spærrer for en
//    runde, TIDEN har sat i gang; denne spærrer for en runde, OPRETTEREN har
//    valgt fra. Netop dét fravalg gøres, mens runden stadig er åben — det er
//    hele grunden til, at chippen findes — så regel 3 kan pr. definition ikke
//    dække det: i det vindue, hvor fravalget betyder noget, siger regel 3 ja.
//    Uden feltet kunne efterfyldningen ikke se forskel på en runde, ingen
//    havde valgt, og en runde, nogen havde valgt fra.
//
//    Rækker fra før feltet har det ikke, og de opfører sig som hidtil: ingen
//    overgangsregel, samme form som `stages`-mærkatet i regel 2.

import { sbAll } from "./_shared.js";

// Én time før rundens start — samme margen som tipslåsen (LOCK_LEAD_MS i
// src/lib/scoring.js), men målt på runden og ikke på kampen, jf. regel 3.
export const LOCK_LEAD_MS = 60 * 60 * 1000;

export const BACKFILLABLE_MODES = ["full_season", "team", "time_range"];

// Dækker konkurrencen denne sæson? Enten bundet (én turnering) eller nævnt i
// mode_params.tournaments (flere turneringer ⇒ league_id/season_id er null).
export function coversSeason(competition, seasonId) {
  if (competition.season_id === seasonId) return true;
  const list = competition.mode_params?.tournaments;
  return Array.isArray(list) && list.some((t) => t?.season_id === seasonId);
}

// Tidszonen er FAST og dansk, ikke serverens (Vercel kører UTC) — samme
// forudsætning som `public.match_lock_at()` i SQL og som sendevinduet i
// send-notifications.js: brugerne er én vennegruppe i én tidszone.
const TZ = "Europe/Copenhagen";

// Zonens forskydning fra UTC på et givet tidspunkt, i ms. Aflæst via Intl frem
// for hårdkodet, fordi Danmark skifter mellem +1 og +2 to gange om året.
function zoneOffsetMs(ms) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
}

// Midnat på spilledagen, dansk tid — som ms. To gennemløb: først aflæses DAGEN,
// som spilleren ser den, og derefter korrigeres gættet (UTC-midnat på den dato)
// med zonens forskydning. Ét gennemløb ville være forkert i timerne omkring
// midnat, hvor UTC-datoen og den danske dato er forskellige.
function zonedMidnightMs(ms) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  return utcMidnight - zoneOffsetMs(utcMidnight - zoneOffsetMs(utcMidnight));
}

// Låsetidspunktet for én kamp (ms), eller null hvis kickoff ikke er kendt.
//
// Dette er den fælles regel, oversat til api/ (som ikke importerer fra src/):
// `lockAtOf()` i src/lib/scoring.js og `public.match_lock_at()` i SQL siger
// præcis det samme. Indtil G55 (august 2026) kendte efterfyldningen kun den ene
// halvdel: den regnede altid `kickoff_at − 1 time` og vidste ikke, at en kamp
// uden fastlagt klokkeslæt bærer en PLADSHOLDER i det felt. En TBD-kamps
// pladsholder er typisk midnat — men midnat i leverandørens zone, ikke i vores
// — så rundestarten kunne lande på den forkerte side af den lås, både klienten
// og databasen håndhæver for den samme kamp. Afvigelsen er timer, og regel 3
// måler i dage, så den har aldrig gjort skade; men den var det sidste sted, hvor
// låsen blev regnet i hånden i stedet for at følge reglen.
export function matchLockAtMs(m, lockLeadMs = LOCK_LEAD_MS) {
  if (!m?.kickoff_at) return null;
  const t = Date.parse(m.kickoff_at);
  if (Number.isNaN(t)) return null;
  return m.kickoff_tbd ? zonedMidnightMs(t) : t - lockLeadMs;
}

// Tidligste LÅS pr. runde over HELE sæsonen — det er den, regel 3 regnes af.
// Kampe uden kickoff springes over; en runde uden kendte kickoffs får ingen
// entry og regnes som endnu ikke gået i gang.
//
// Rundens start bor efter B1 (august 2026) KUN her og i `analytics_round_locks`:
// frontendens udgave (`buildRoundStartMap`) forsvandt sammen med det rullende
// gætte-vindue, som var dens eneste bruger. Regel 3 er en anden regel med sin
// egen begrundelse og beholder sin runde-grain — men IKKE en scoping pr.
// turnering: kaldet henter stadig kandidaterne for én `season_id` ad gangen,
// mens rundens start regnes over hele konkurrencens univers (G8).
function earliestLockByRound(matches, lockLeadMs) {
  const map = new Map();
  for (const m of matches) {
    const t = matchLockAtMs(m, lockLeadMs);
    if (t === null) continue;
    const cur = map.get(m.round_key);
    if (cur === undefined || t < cur) map.set(m.round_key, t);
  }
  return map;
}

// Hører kampen til konkurrencens regel?
function matchesRule(competition, m) {
  const p = competition.mode_params || {};
  if (competition.mode === "full_season") return true;
  if (competition.mode === "team") {
    // Favorithold kan have flere hold (`team_ids`, I14); ét hold skriver stadig
    // legacy-nøglen `team_id`. Begge former skal efterfyldes.
    const ids = Array.isArray(p.team_ids) ? p.team_ids : p.team_id ? [p.team_id] : [];
    return ids.includes(m.home_team_id) || ids.includes(m.away_team_id);
  }
  if (competition.mode === "time_range") {
    if (!p.start_date || !p.end_date || !m.kickoff_at) return false;
    const day = m.kickoff_at.slice(0, 10);
    return day >= p.start_date && day <= p.end_date;
  }
  return false;
}

// Hvilke kamp-id'er mangler denne konkurrence?
//
// `matches` er ALLE sæsonens kampe (ikke kun konkurrencens) — nødvendigt, fordi
// låsen regnes pr. runde over hele sæsonen. `existingIds` er de kampe,
// konkurrencen allerede har.
//
// `otherSeasonMatches` er kampene fra konkurrencens ØVRIGE turneringer og tæller
// KUN med i rundens start (regel 3), aldrig som kandidater — kandidaterne kommer
// fra `matches`, fordi det er den sæson, kaldet gælder. Tom for en konkurrence
// med én turnering, som er hver eneste af dem, der findes i dag (`G8`).
export function matchesToBackfill({ competition, matches, existingIds, nowMs, lockLeadMs = LOCK_LEAD_MS, otherSeasonMatches = [] }) {
  if (!BACKFILLABLE_MODES.includes(competition.mode)) return [];
  if (competition.mode_params?.stages) return []; // afgrænset i hånden — regel 2
  const earliest = earliestLockByRound(otherSeasonMatches.length ? matches.concat(otherSeasonMatches) : matches, lockLeadMs);
  const have = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  return matches
    .filter((m) => !have.has(m.id))
    .filter((m) => m.home_score === null || m.home_score === undefined)
    .filter((m) => {
      const first = earliest.get(m.round_key);
      return first === undefined || nowMs < first; // regel 3: runden må vokse, indtil dens første kamp låser
    })
    // Regel 4: startrunden er en bund, konkurrencen aldrig vokser under. Nøglen
    // er en 'YYYY-MM-DD'-tekst, og sammenligningen sker som tekst — samme form
    // som `time_range`s datoer nedenfor.
    .filter((m) => !competition.mode_params?.from_round || m.round_key >= competition.mode_params.from_round)
    .filter((m) => matchesRule(competition, m))
    .map((m) => m.id);
}

// Kør efterfyldningen for én sæson. Returnerer antal tilføjede rækker.
//
// Kaster ALDRIG videre: en sync, der har hentet kampene korrekt, må ikke ende
// som en fejlet kørsel, fordi efterfyldningen gik galt. Fejlen logges og tælles
// i stedet med i jobbets detail-felt, så den er aflæselig i Admin → Drift.
export async function backfillCompetitionMatches(sb, seasonId, { now = Date.now() } = {}) {
  try {
    const modes = BACKFILLABLE_MODES.join(",");
    // Alle opslagene pagineres (G51): Supabase klipper tavst ved db-max-rows,
    // og `links` skalerer som konkurrencer × sæsonens kampe — tre "hel sæson"-
    // konkurrencer i samme turnering er over 1000 rækker. En afkortet
    // `links`-liste ville få allerede tilknyttede kampe til at se manglende ud;
    // `on_conflict` gør genindsættelsen harmløs, men `added` ville lyve.
    const comps = await sbAll(sb, `/rest/v1/competitions?mode=in.(${modes})&select=id,mode,mode_params,season_id`, {
      order: "id.asc",
    });
    const relevant = (comps || []).filter((c) => coversSeason(c, seasonId));
    if (!relevant.length) return { added: 0, competitions: 0 };

    const matches = await sbAll(
      sb,
      `/rest/v1/matches?season_id=eq.${seasonId}&select=id,round_key,kickoff_at,kickoff_tbd,home_score,home_team_id,away_team_id`,
      { order: "id.asc" }
    );
    if (!matches?.length) return { added: 0, competitions: 0 };

    const ids = relevant.map((c) => c.id).join(",");
    const links = await sbAll(
      sb,
      `/rest/v1/competition_matches?competition_id=in.(${ids})&select=competition_id,match_id`,
      { order: "competition_id.asc,match_id.asc" }
    );
    const byComp = new Map();
    for (const l of links || []) {
      if (!byComp.has(l.competition_id)) byComp.set(l.competition_id, new Set());
      byComp.get(l.competition_id).add(l.match_id);
    }

    // Regel 3 måler på runden, og en runde er en kalenderuge på tværs af
    // turneringer — så en flerturnerings-konkurrence skal have sine ØVRIGE
    // turneringers kampe med, før rundens start kan afgøres (G8). De hentes i
    // ÉT opslag for alle de sæsoner, de relevante konkurrencer nævner, og kun
    // med de felter, låsen og grupperingen kræver: rækkerne er ikke kandidater.
    //
    // Opslaget udgår helt, når ingen relevant konkurrence har mere end én
    // turnering — altså i dag hver eneste kørsel, fordi `mode_params.tournaments`
    // aldrig er blevet skrevet i produktion (`G8`). Den dag den første oprettes,
    // koster efterfyldningen ét opslag mere pr. sæson-sync.
    const extraSeasonIds = new Set();
    for (const c of relevant) {
      for (const t of c.mode_params?.tournaments || []) {
        if (t?.season_id && t.season_id !== seasonId) extraSeasonIds.add(t.season_id);
      }
    }
    const otherBySeason = new Map();
    if (extraSeasonIds.size) {
      const others = await sbAll(
        sb,
        `/rest/v1/matches?season_id=in.(${[...extraSeasonIds].join(",")})&select=id,season_id,round_key,kickoff_at,kickoff_tbd`,
        { order: "id.asc" }
      );
      for (const m of others || []) {
        if (!otherBySeason.has(m.season_id)) otherBySeason.set(m.season_id, []);
        otherBySeason.get(m.season_id).push(m);
      }
    }

    const rows = [];
    let touched = 0;
    for (const c of relevant) {
      const otherSeasonMatches = extraSeasonIds.size
        ? (c.mode_params?.tournaments || [])
            .filter((t) => t?.season_id && t.season_id !== seasonId)
            .flatMap((t) => otherBySeason.get(t.season_id) || [])
        : [];
      const missing = matchesToBackfill({
        competition: c,
        matches,
        existingIds: byComp.get(c.id) || new Set(),
        nowMs: now,
        otherSeasonMatches,
      });
      if (missing.length) touched++;
      for (const matchId of missing) rows.push({ competition_id: c.id, match_id: matchId });
    }
    if (!rows.length) return { added: 0, competitions: 0 };

    // on_conflict: to sync-jobs kan i teorien overlappe, og PK'en er
    // (competition_id, match_id) — så en dublet er et no-op frem for en 409.
    await sb(`/rest/v1/competition_matches?on_conflict=competition_id,match_id`, {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=minimal",
      body: JSON.stringify(rows),
    });
    return { added: rows.length, competitions: touched };
  } catch (e) {
    console.warn("[A20] efterfyldning fejlede:", e.message);
    return { added: 0, competitions: 0, error: e.message };
  }
}
