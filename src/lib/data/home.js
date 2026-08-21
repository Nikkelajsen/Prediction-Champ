// Hjem-fanens tre sammensatte opslag — næste deadline med manglende tips,
// live-oversigten over den igangværende runde og "Dine placeringer" — plus den
// dato/tid-formattering, kun de bruger.

import { db } from "../supabase.js";
import { APP_TZ, byKickoffThenTeams, currentRoundIndex, groupIntoRounds, lockAtOf, liveInfo, nextRoundTips, pointsFor, roundLabel } from "../scoring.js";
import { computeCompetitionState } from "./competitionState.js";
import { loadMonthlyBoard } from "./standings.js";
import { selectIn } from "./chunked.js";
import { TEAM_SELECT, teamLabelMap } from "../teams.js";

// ---------- Hjem: næste deadline + manglende tips på tværs af brugerens konkurrencer ----------
async function computeHomeTips(token, userId, competitions) {
  const compIds = competitions.map((c) => c.id);
  if (!compIds.length) return { hasComps: false };
  const cms = await selectIn(token, "competition_matches", "competition_id", compIds, "&select=competition_id,match_id");
  const ids = [...new Set(cms.map((c) => c.match_id))];
  if (!ids.length) return { hasComps: true, noMatches: true };
  const ms = await selectIn(token, "matches", "id", ids, "&select=*&order=kickoff_at", { sortBy: "kickoff_at" });
  const teamIds = [...new Set(ms.flatMap((m) => [m.home_team_id, m.away_team_id]).filter(Boolean))];
  const teams = await selectIn(token, "teams", "id", teamIds, `&select=${TEAM_SELECT}`);
  // Kort holdnavn, hvor der er ét (`B39`). Deadline-kortets tre navne står på én
  // linje, og rundelisten nedenfor TRUNKERER med ellipse — Hjem er dermed det
  // sted, hvor et langt navn koster information, ikke bare højde.
  const teamName = teamLabelMap(teams);
  const preds = await selectIn(token, "predictions", "match_id", ids, `&user_id=eq.${userId}&select=match_id,pred_home,pred_away`);
  const predByMatch = new Map(preds.map((p) => [p.match_id, p]));

  const now = Date.now();
  const played = (m) => m.home_score !== null && m.home_score !== undefined;
  // Deler kampene tidsstempel — en hel runde gør det, når tiderne ikke er
  // fastlagt endnu — afgør holdnavnet rækkefølgen. Ellers ville BÅDE "næste
  // kamp" og de tre navne på deadline-kortet være et vilkårligt udvalg, der
  // kunne skifte fra indlæsning til indlæsning.
  const byTime = byKickoffThenTeams((id) => teamName.get(id));

  // Fælles hale til de to "der er intet at gøre lige nu"-tilstande: nærmeste
  // kommende kamp + dens runde, så kortets knap kan åbne Tip landet det rigtige
  // sted (samme sted som "Tip nu" ved manglende tips).
  const nextUp = (extra) => {
    const future = ms.filter((m) => !played(m) && m.kickoff_at && new Date(m.kickoff_at).getTime() > now)
      .sort(byTime);
    // nextOpenTbd følger med nextOpen: uden den ville kortet vise et opdigtet
    // klokkeslæt for en kamp, hvis tid endnu ikke er fastlagt.
    return {
      hasComps: true, ...extra,
      nextOpen: future[0]?.kickoff_at || null,
      nextOpenTbd: !!future[0]?.kickoff_tbd,
      roundKey: future[0]?.round_key || null,
    };
  };
  // "Alle tips er inde" er en påstand om BRUGERENS tips og må kun bruges, når vi
  // faktisk har set, at rundens tipbare kampe er tippet.
  const allOk = () => nextUp({ allTipped: true });
  // "Intet at tippe lige nu" er noget andet: der er ingen tipbare kampe overhovedet
  // (alle kampe er låst eller spillet). Før returnerede begge tilfælde allTipped,
  // så en bruger med NUL tips fik at vide, at alle tips var inde.
  const nothingToTip = () => nextUp({ nothingToTip: true });

  // "Næste runde" og "er den tippet?" er ÉN regel, og den bor i
  // `nextRoundTips` (src/lib/scoring.js) sammen med det grønne flueben på
  // konkurrence-kortene. Den udgave, der stod her, var den oprindelige — den
  // blev flyttet, ikke ændret.
  const next = nextRoundTips(ms, predByMatch);
  if (!next) return nothingToTip();
  if (next.allTipped) return allOk();
  const roundUntipped = next.untipped.slice().sort(byTime);

  // Kortets deadline er den FØRSTE af de utippede kampes egne låse — det er den, der
  // løber ud først, og dermed den, brugeren skal nå. Efter A21 er det ikke længere
  // én fælles rundelås, men de utippede kampe i runden ligger typisk tæt.
  const deadline = Math.min(...roundUntipped.map((m) => lockAtOf(m)).filter((t) => t !== null));
  const names = roundUntipped.slice(0, 3).map((m) => `${teamName.get(m.home_team_id) || "?"} – ${teamName.get(m.away_team_id) || "?"}`);
  return { hasComps: true, allTipped: false, roundKey: next.roundKey, roundLabelText: roundLabel(next.roundKey), deadline, missingCount: roundUntipped.length, names };
}

// ---------- Hjem: live-oversigt over indeværende runde ----------
// Samler brugerens konkurrence-kampe, grupperer i runder og vælger den runde der
// spilles nu (eller nærmeste kommende, via currentRoundIndex). Returnerer rundens
// kampe med resultat + brugerens eget tip + point, så Hjem kan vise en oversigt der
// opdaterer løbende, efterhånden som resultater tikker ind (sync). Hver kamp tælles
// én gang (dedup på match-id), da predictions deles på tværs af konkurrencer.
async function computeCurrentRound(token, userId, competitions) {
  const compIds = competitions.map((c) => c.id);
  if (!compIds.length) return null;
  // `competition_id` kommer med i SAMME kald (G87, 8. august 2026). Det er ikke
  // en ekstra forespørgsel, men en kolonne, der blev hentet og smidt væk: uden
  // den kan vi kun kende brugerens GLOBALE indeværende runde, og rundestoryens
  // afløsning har brug for konkurrencens egen.
  const cms = await selectIn(token, "competition_matches", "competition_id", compIds, "&select=competition_id,match_id");
  const ids = [...new Set(cms.map((c) => c.match_id))];
  if (!ids.length) return null;
  const ms = await selectIn(token, "matches", "id", ids, "&select=*&order=kickoff_at", { sortBy: "kickoff_at" });
  if (!ms.length) return null;
  const rounds = groupIntoRounds(ms);
  const round = rounds[currentRoundIndex(rounds)];
  if (!round || !round.matches.length) return null;

  const teamIds = [...new Set(round.matches.flatMap((m) => [m.home_team_id, m.away_team_id]).filter(Boolean))];
  const teams = await selectIn(token, "teams", "id", teamIds, `&select=${TEAM_SELECT}`);
  const teamName = teamLabelMap(teams);
  // Sorteringen sker HER og ikke i groupIntoRounds ovenfor: holdnavnene slås op
  // ud fra rundens kampe, så de findes først, når runden er valgt. Uden den ville
  // en runde med ens tidsstempler ligge i vilkårlig orden på Hjem.
  round.matches.sort(byKickoffThenTeams((id) => teamName.get(id)));
  const roundMatchIds = round.matches.map((m) => m.id);
  const preds = await selectIn(token, "predictions", "match_id", roundMatchIds, `&user_id=eq.${userId}&select=match_id,pred_home,pred_away`);
  const predByMatch = new Map(preds.map((p) => [p.match_id, p]));

  let myPoints = 0, playedCount = 0;
  const matches = round.matches.map((m) => {
    const played = m.home_score != null && m.away_score != null;
    const pred = predByMatch.get(m.id) || null;
    const points = played ? pointsFor(pred, m) : null;
    if (played) { playedCount++; if (points != null) myPoints += points; }
    // Live-stilling (live_*-kolonnerne, skrevet af api/sync-live.js hvert minut).
    // Den tæller ikke point — kun det endelige resultat gør. inProgress er fallback:
    // kickoff er passeret, men vi har ingen live-data (fx uden for datakildens plan, eller en liga uden live_enabled).
    const live = liveInfo(m);
    const inProgress = !played && !live && m.kickoff_at && new Date(m.kickoff_at).getTime() <= Date.now();
    return {
      id: m.id,
      home: teamName.get(m.home_team_id) || "?",
      away: teamName.get(m.away_team_id) || "?",
      homeScore: m.home_score, awayScore: m.away_score,
      kickoff: m.kickoff_at, played, live, inProgress, pred, points,
    };
  });
  // Konkurrencens EGEN indeværende runde (G87). Regnet af `ms` og `cms`, som
  // begge allerede er hentet — ingen netværkskald, kun den gruppering, der før
  // kun blev lavet én gang for alle konkurrencer under ét.
  //
  // `playedCount` tælles inden for konkurrencens egen runde og ikke globalt:
  // det er præcis dét tal, `roundStorySuperseded` spørger om ("har den nye
  // runde fortalt noget endnu?"), og globalt kunne det være sandt for én
  // turnering og falsk for den, kortet handler om.
  const byMatch = new Map(ms.map((m) => [m.id, m]));
  const byCompetition = new Map();
  for (const cid of compIds) {
    const egne = cms.filter((c) => c.competition_id === cid)
      .map((c) => byMatch.get(c.match_id)).filter(Boolean);
    if (!egne.length) continue;
    const r = groupIntoRounds(egne);
    const cur = r[currentRoundIndex(r)];
    if (!cur || !cur.matches.length) continue;
    byCompetition.set(cid, {
      roundKey: cur.key,
      playedCount: cur.matches.filter((m) => m.home_score != null && m.away_score != null).length,
    });
  }

  return {
    roundKey: round.key, roundLabelText: round.label, byCompetition,
    matches, myPoints, playedCount, totalCount: round.matches.length,
    // antal kampe der spilles LIGE NU — bruges til LIVE-mærket på det foldede kort
    liveCount: matches.filter((m) => m.live).length,
    isComplete: playedCount === round.matches.length,
  };
}

// ---------- Hjem: "Dine placeringer" ----------
// Månedschampionshippet øverst, dernæst én række pr. konkurrence, brugeren
// står i. Rækkefølgen på listen bevares (månedschampionship først, dernæst
// konkurrencer i input-orden), fordi den ER visningens rækkefølge.
//
// Udskilt fra `HjemTab.jsx` (G1, august 2026). Snittet er det samme som i
// `invites.js`: funktionen svarer med RÆKKER — etiket, placering, hvor man
// lander ved tryk — og skærmen tegner dem. Gevinsten er ikke linjetallet, men
// at reglerne kan efterprøves: placeringen er rækkens ægte `rank` (delt ved
// lighed) og ikke dens plads i listen, en konkurrence, hvis stilling fejler,
// SPRINGES OVER frem for at vælte hele listen, og et skjult (`_hidden`)
// konkurrence-kort må aldrig give en række.
//
// Private konkurrencers stilling findes ikke i standings-views'ene (de er
// globale pr. runde/sæson), så `computeCompetitionState` er stadig nødvendig —
// derfor ét kald pr. konkurrence, alle parallelt.
async function loadHomePlacements(token, userId, competitions, monthKey) {
  const comps = competitions.filter((x) => !x._hidden);
  // liga-navne til gruppering af konkurrence-placeringer (liga-laget)
  const groupIds = [...new Set(comps.map((c) => c.group_id).filter(Boolean))];

  const [monthly, compStates, groupRows] = await Promise.all([
    loadMonthlyBoard(token, monthKey),
    Promise.all(comps.map((c) => computeCompetitionState(token, c.id).catch(() => null))),
    groupIds.length
      ? db.select(token, "groups", `id=in.(${groupIds.join(",")})&select=id,name`).catch(() => [])
      : Promise.resolve([]),
  ]);

  const groupNameById = new Map(groupRows.map((g) => [g.id, g.name]));
  const list = [];
  const mine = monthly.find((r) => r.userId === userId);
  if (mine) list.push({ label: "Månedschampionship · " + monthName(monthKey), pos: `${mine.rank}.`, shared: mine.shared, tab: "championship" });
  comps.forEach((c, i) => {
    const state = compStates[i];
    if (!state) return; // fejlede — spring over
    const row = state.rows.find((r) => r.userId === userId);
    if (row) list.push({
      label: c.name, pos: `${row.rank}.`, shared: row.shared, compId: c.id,
      groupId: c.group_id || null,
      groupName: c.group_id ? (groupNameById.get(c.group_id) || "Liga") : null,
    });
  });
  return list;
}

// ---------- Hjem: rating-snapshot ----------
// Ét objekt til kortet øverst, flettet af to opslag: tallene fra
// `loadRatingSnapshot()` (rating, ægte placering, antal, provisorisk) og
// formkurven fra `loadRatingHistory()`. Står brugeren ikke på ranglisten,
// svares `{ none: true }` — det er en gyldig tilstand og ikke en fejl.
//
// FLETNINGEN ER SKILT FRA OPSLAGENE MED VILJE: `rank` og `total` regnes nu i
// databasen (`G139`, 21. august 2026) frem for ved at tælle en hentet liste, og
// den regning har sine egne påstande i `data/standings.test.js`. Her står kun
// det, der kan gå galt uden et netværk — at en manglende formkurve ikke må
// vælte kortet.
function ratingSnapshot(snap, hist, userId) {
  if (!snap || snap.none) return { none: true };
  const h = hist.get(userId) || {};
  return { ...snap, move: h.move || 0, form: h.form || [] };
}

// ---------- dato/tid-formattering til Hjem ----------
// Dagens dato i Hjems hoved — i DANSK tid (G32). En bruger, der åbner appen
// klokken 23 lokalt et andet sted i verden, skal se den dag, rundens deadlines
// hører til, og ikke sin egen.
function daFullDate(d = new Date()) {
  const s = d.toLocaleDateString("da-DK", { timeZone: APP_TZ, weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function fmtCountdown(ts) {
  let s = Math.max(0, Math.floor((ts - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} d ${h} t`;
  if (h > 0) return `${h} t ${m} min`;
  return `${m} min`;
}

// Månedsnøgle ("2026-08") → "August 2026". Forankres på middag UTC den 1. og
// ikke på midnat lokalt: en enhed øst for Danmark ville ellers få et tidspunkt,
// der er dansk den SIDSTE i forrige måned — og så ville månedschampionshippet stå med
// den forkerte måned i overskriften (G32).
function monthName(monthKey) {
  const [y, m] = monthKey.split("-");
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1, 12));
  const s = d.toLocaleDateString("da-DK", { timeZone: APP_TZ, month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export { computeHomeTips, computeCurrentRound, loadHomePlacements, ratingSnapshot, daFullDate, fmtCountdown, monthName };
