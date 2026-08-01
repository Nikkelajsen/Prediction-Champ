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
// De tre regler, der gør efterfyldningen sikker
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
//    dens RUNDE endnu ikke har haft sin første kickoff (minus en time). Så kan
//    en efterfyldning aldrig give point for et tip, der allerede er afgivet —
//    den fejl, `filterFromNextUnfinishedRound` findes for at forhindre ved
//    oprettelsen.
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

// Tidligste kickoff pr. runde over HELE sæsonen — det er den, regel 3 regnes af.
// Kampe uden kickoff springes over; en runde uden kendte kickoffs får ingen
// entry og regnes som endnu ikke gået i gang (samme valg som buildRoundStartMap
// i frontenden).
function earliestByRound(matches) {
  const map = new Map();
  for (const m of matches) {
    if (!m.kickoff_at) continue;
    const t = Date.parse(m.kickoff_at);
    if (Number.isNaN(t)) continue;
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
    return !!p.team_id && (m.home_team_id === p.team_id || m.away_team_id === p.team_id);
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
export function matchesToBackfill({ competition, matches, existingIds, nowMs, lockLeadMs = LOCK_LEAD_MS }) {
  if (!BACKFILLABLE_MODES.includes(competition.mode)) return [];
  if (competition.mode_params?.stages) return []; // afgrænset i hånden — regel 2
  const earliest = earliestByRound(matches);
  const have = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  return matches
    .filter((m) => !have.has(m.id))
    .filter((m) => m.home_score === null || m.home_score === undefined)
    .filter((m) => {
      const first = earliest.get(m.round_key);
      return first === undefined || nowMs < first - lockLeadMs; // regel 3
    })
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
    const comps = await sb(`/rest/v1/competitions?mode=in.(${modes})&select=id,mode,mode_params,season_id`);
    const relevant = (comps || []).filter((c) => coversSeason(c, seasonId));
    if (!relevant.length) return { added: 0, competitions: 0 };

    const matches = await sb(`/rest/v1/matches?season_id=eq.${seasonId}&select=id,round_key,kickoff_at,home_score,home_team_id,away_team_id`);
    if (!matches?.length) return { added: 0, competitions: 0 };

    const ids = relevant.map((c) => c.id).join(",");
    const links = await sb(`/rest/v1/competition_matches?competition_id=in.(${ids})&select=competition_id,match_id`);
    const byComp = new Map();
    for (const l of links || []) {
      if (!byComp.has(l.competition_id)) byComp.set(l.competition_id, new Set());
      byComp.get(l.competition_id).add(l.match_id);
    }

    const rows = [];
    let touched = 0;
    for (const c of relevant) {
      const missing = matchesToBackfill({
        competition: c,
        matches,
        existingIds: byComp.get(c.id) || new Set(),
        nowMs: now,
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
