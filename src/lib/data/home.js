// Hjem-fanens to sammensatte opslag — næste deadline med manglende tips, og
// live-oversigten over den igangværende runde — plus den dato/tid-formattering,
// kun de to bruger.

import { db } from "../supabase.js";
import { APP_TZ, byKickoffThenTeams, currentRoundIndex, groupIntoRounds, isLocked, lockAtOf, liveInfo, pointsFor, roundLabel } from "../scoring.js";

// ---------- Hjem: næste deadline + manglende tips på tværs af brugerens konkurrencer ----------
async function computeHomeTips(token, userId, competitions) {
  const compIds = competitions.map((c) => c.id);
  if (!compIds.length) return { hasComps: false };
  const cms = await db.select(token, "competition_matches", `competition_id=in.(${compIds.join(",")})&select=competition_id,match_id`);
  const ids = [...new Set(cms.map((c) => c.match_id))];
  if (!ids.length) return { hasComps: true, noMatches: true };
  const ms = await db.select(token, "matches", `id=in.(${ids.join(",")})&select=*&order=kickoff_at`);
  const teamIds = [...new Set(ms.flatMap((m) => [m.home_team_id, m.away_team_id]).filter(Boolean))];
  const teams = teamIds.length ? await db.select(token, "teams", `id=in.(${teamIds.join(",")})&select=id,name`) : [];
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const preds = await db.select(token, "predictions", `match_id=in.(${ids.join(",")})&user_id=eq.${userId}&select=match_id,pred_home,pred_away`);
  const predByMatch = new Map(preds.map((p) => [p.match_id, p]));

  const now = Date.now();
  const played = (m) => m.home_score !== null && m.home_score !== undefined;
  // Deler kampene tidsstempel — en hel runde gør det, når tiderne ikke er
  // fastlagt endnu — afgør holdnavnet rækkefølgen. Ellers ville BÅDE "næste
  // kamp" og de tre navne på deadline-kortet være et vilkårligt udvalg, der
  // kunne skifte fra indlæsning til indlæsning.
  const byTime = byKickoffThenTeams((id) => teamName.get(id));

  // En kamp kan tippes fra det øjeblik, den findes, og indtil den låser: det
  // rullende gætte-vindue er fjernet (B1, august 2026).
  const tippable = ms.filter((m) => !played(m) && !isLocked(m) && m.kickoff_at);
  const isTipped = (m) => { const p = predByMatch.get(m.id); return !!(p && p.pred_home != null && p.pred_away != null); };
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

  // "Næste runde" = den TIDLIGSTE runde, der stadig har kampe man kan tippe. Vi viser
  // KUN status for den runde: er den fuldt tippet, er alt ok (grøn) — også selvom senere
  // runder mangler tips (de bliver "næste runde" i tur, efterhånden som runderne spilles).
  // (Før valgte vi den tidligste UTIPPEDE kamp, så en runde langt ude kunne fejlagtigt
  // vise rødt, selvom de nærmeste runder var tippet.)
  if (!tippable.length) return nothingToTip();
  const nextRoundKey = tippable.reduce((min, m) => (m.round_key < min ? m.round_key : min), tippable[0].round_key);
  const roundUntipped = tippable.filter((m) => m.round_key === nextRoundKey && !isTipped(m))
    .sort(byTime);
  if (!roundUntipped.length) return allOk();

  // Kortets deadline er den FØRSTE af de utippede kampes egne låse — det er den, der
  // løber ud først, og dermed den, brugeren skal nå. Efter A21 er det ikke længere
  // én fælles rundelås, men de utippede kampe i runden ligger typisk tæt.
  const deadline = Math.min(...roundUntipped.map((m) => lockAtOf(m)).filter((t) => t !== null));
  const names = roundUntipped.slice(0, 3).map((m) => `${teamName.get(m.home_team_id) || "?"} – ${teamName.get(m.away_team_id) || "?"}`);
  return { hasComps: true, allTipped: false, roundKey: nextRoundKey, roundLabelText: roundLabel(nextRoundKey), deadline, missingCount: roundUntipped.length, names };
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
  const cms = await db.select(token, "competition_matches", `competition_id=in.(${compIds.join(",")})&select=match_id`);
  const ids = [...new Set(cms.map((c) => c.match_id))];
  if (!ids.length) return null;
  const ms = await db.select(token, "matches", `id=in.(${ids.join(",")})&select=*&order=kickoff_at`);
  if (!ms.length) return null;
  const rounds = groupIntoRounds(ms);
  const round = rounds[currentRoundIndex(rounds)];
  if (!round || !round.matches.length) return null;

  const teamIds = [...new Set(round.matches.flatMap((m) => [m.home_team_id, m.away_team_id]).filter(Boolean))];
  const teams = teamIds.length ? await db.select(token, "teams", `id=in.(${teamIds.join(",")})&select=id,name`) : [];
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  // Sorteringen sker HER og ikke i groupIntoRounds ovenfor: holdnavnene slås op
  // ud fra rundens kampe, så de findes først, når runden er valgt. Uden den ville
  // en runde med ens tidsstempler ligge i vilkårlig orden på Hjem.
  round.matches.sort(byKickoffThenTeams((id) => teamName.get(id)));
  const roundMatchIds = round.matches.map((m) => m.id);
  const preds = await db.select(token, "predictions", `match_id=in.(${roundMatchIds.join(",")})&user_id=eq.${userId}&select=match_id,pred_home,pred_away`);
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
  return {
    roundKey: round.key, roundLabelText: round.label,
    matches, myPoints, playedCount, totalCount: round.matches.length,
    // antal kampe der spilles LIGE NU — bruges til LIVE-mærket på det foldede kort
    liveCount: matches.filter((m) => m.live).length,
    isComplete: playedCount === round.matches.length,
  };
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

export { computeHomeTips, computeCurrentRound, daFullDate, fmtCountdown, monthName };
