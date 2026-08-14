// Én konkurrences fulde tilstand: deltagere, kampe, forudsigelser, stilling og
// runde-status. Den tungeste enkelt-loader i appen og den, alle drill-ins
// bygger på.

import { db } from "../supabase.js";
import { groupIntoRounds, POINTS, pointsFor, wasTippableAt } from "../scoring.js";
import { assignRanks, avgGoalError, compareStandings, sortStandings } from "../standings.js";
import { roundRow, without } from "./_shared.js";
import { selectIn } from "./chunked.js";

// Henter deltagere + kampe + forudsigelser for én konkurrence og beregner
// stilling + status.
//
// `signal` er valgfri (G25). Loaderen er SEKS kald efter hinanden, og det er
// derfor netop den, hvor annullering betyder noget: skifter man konkurrence
// midtvejs, fortsætter den gamle indlæsning ellers hele vejen igennem — og et
// sent svar kan overskrive et nyere. Signalet sendes til hvert enkelt kald, så
// kæden brydes ved det FØRSTE kald efter afbrydelsen frem for at løbe færdig.
async function computeCompetitionState(token, competitionId, { signal } = {}) {
  const o = { signal };
  // `joined_at` med (`A53`): den er deltagerens NULPUNKT — se filtreringen af
  // `preds` nedenfor. Uden feltet kan stillingen ikke skelne et gæt, der blev
  // afgivet i denne konkurrences levetid, fra et, der kom med udefra.
  const participants = await db.select(token, "competition_participants", `competition_id=eq.${competitionId}&select=user_id,joined_at`, o);
  const userIds = participants.map((p) => p.user_id);
  // `id,display_name` og ikke `*` (A43). Stillingen bruger præcis de to felter,
  // og siden kolonne-grants'ene (#60) er `select=*` på `profiles` et `42501`.
  // Læsningen var den bredeste i appen — hele profilrækken om hver deltager i
  // hver konkurrence, man åbnede — og den eneste, der ikke havde en grund.
  const profiles = await selectIn(token, "profiles", "id", userIds, "&select=id,display_name", o);
  const cms = await db.select(token, "competition_matches", `competition_id=eq.${competitionId}&select=match_id`, o);
  const matchIds = cms.map((c) => c.match_id);
  const ms = await selectIn(token, "matches", "id", matchIds, "&select=*", o);
  const preds = await selectIn(token, "predictions", "match_id", matchIds, "&select=*", o);

  const teamIds = [...new Set(ms.flatMap((m) => [m.home_team_id, m.away_team_id]).filter(Boolean))];
  const teams = await selectIn(token, "teams", "id", teamIds, "&select=id,name", o);
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  ms.forEach((m) => { m._home = teamName.get(m.home_team_id); m._away = teamName.get(m.away_team_id); });

  const rounds = groupIntoRounds(ms);

  // Hver deltager starter på 0 i den konkurrence, hun melder sig til (`A53`).
  //
  // `predictions` er én række pr. `(bruger, kamp)` og deles på tværs af
  // konkurrencer, så uden dette filter tæller et gæt afgivet i en ANDEN liga med
  // fra det sekund, man melder sig til — på kampe, ingen af de øvrige deltagere
  // kan nå at gætte på. Det var det, `filterTippable` allerede beskyttede en ny
  // KONKURRENCE mod; her er den samme regel for en ny DELTAGER.
  //
  // Filteret ligger på `predsByKey` og ikke på pointudregningen alene, og det er
  // med vilje: kortet ER stillingens datagrundlag — rundetabellen, formen,
  // ▲/▼-pilene OG rundemodalen med "spillerens tips runde for runde" læser alle
  // det samme kort. Ét filter her er derfor det ene sted, hvor tallene i
  // tabellen og gættene i modalen ikke kan komme til at sige hver sit.
  //
  // Et gæt, der ikke tæller HER, er ikke slettet: det står stadig på Tip-fanen
  // og i den konkurrence, det blev afgivet i.
  const joinedAt = new Map(participants.map((p) => [p.user_id, Date.parse(p.joined_at)]));
  const matchById = new Map(ms.map((m) => [m.id, m]));
  const counting = preds.filter((pr) => {
    const m = matchById.get(pr.match_id);
    // `joinedAt.get()` er undefined for en ikke-deltager (predictions hentes pr.
    // KAMP og kender ingen konkurrence). `wasTippableAt` svarer da "tæl med" —
    // rækken slås aldrig op, fordi stillingens rækker bygges af deltagerne.
    return m ? wasTippableAt(m, joinedAt.get(pr.user_id)) : false;
  });
  const predsByKey = new Map(counting.map((pr) => [`${pr.match_id}:${pr.user_id}`, pr]));

  const playedRounds = rounds.filter((r) => r.matches.some((m) => m.home_score !== null && m.home_score !== undefined));
  const playedKeys = playedRounds.map((r) => r.key);
  const lastKey = playedKeys[playedKeys.length - 1];

  // Alt hvad tiebreaker-stigen har brug for, opgjort i én gennemgang pr. spiller.
  // `perRoundStats` bruges bagefter til rundesejre og til stillingen FØR seneste runde.
  const rows = profiles.map((p) => {
    let total = 0;
    let exactCount = 0;
    let outcomeCount = 0;
    let goalError = 0;
    let matches = 0;
    const perRound = {};
    const perRoundStats = {};
    for (const round of rounds) {
      const rs = { total: 0, exact: 0, outcome: 0, goalError: 0, matches: 0 };
      let rPlayed = false;
      for (const m of round.matches) {
        const pred = predsByKey.get(`${m.id}:${p.id}`);
        const pts = pointsFor(pred, m);
        if (pts !== null) {
          rs.total += pts; rs.matches++; rPlayed = true;
          rs.goalError += Math.abs(pred.pred_home - m.home_score) + Math.abs(pred.pred_away - m.away_score);
          if (pred.pred_home === m.home_score && pred.pred_away === m.away_score) rs.exact++;
          else if (pts === POINTS.outcome) rs.outcome++;
        }
      }
      if (rPlayed) { perRound[round.key] = rs.total; perRoundStats[round.key] = rs; }
      total += rs.total; exactCount += rs.exact; outcomeCount += rs.outcome;
      goalError += rs.goalError; matches += rs.matches;
    }
    const form3 = playedKeys.slice(-3).reduce((s, k) => s + (perRound[k] ?? 0), 0);
    return {
      userId: p.id, player: p.display_name, total, perRound, perRoundStats,
      exactCount, outcomeCount, matches, goalError,
      avgGoalError: avgGoalError(goalError, matches), form3,
    };
  });

  // Rundesejre: nr. 1 i den enkelte runde efter samme stige uden rundesejr-trinnet.
  // En delt rundesejr tæller for alle — samme regel som Story Engines rundevinder.
  rows.forEach((r) => { r.roundWins = 0; r.wonRounds = new Set(); });
  for (const key of playedKeys) {
    const inRound = rows
      .filter((r) => r.perRoundStats[key])
      .map((r) => ({ row: r, ...roundRow(r.perRoundStats[key]) }));
    if (!inRound.length) continue;
    const best = inRound.slice().sort(compareStandings)[0];
    inRound.forEach((c) => {
      if (compareStandings(c, best) === 0) { c.row.roundWins++; c.row.wonRounds.add(key); }
    });
  }

  const ranked = assignRanks(sortStandings(rows));

  // ▲/▼: sammenlign med stillingen FØR seneste spillede runde — med hele stigen,
  // så pilen ikke påstår en bevægelse, der kun skyldes en manglende tiebreak.
  if (playedKeys.length >= 2) {
    const prev = assignRanks(sortStandings(ranked.map((r) => without(r, lastKey))));
    const prevRank = new Map(prev.map((r) => [r.userId, r.rank]));
    ranked.forEach((r) => { r.rankDelta = (prevRank.get(r.userId) ?? r.rank) - r.rank; });
  }

  const totalMatches = ms.length;
  const playedMatches = ms.filter((m) => m.home_score !== null && m.home_score !== undefined).length;

  // "Afsluttet" er DATABASENS svar og ikke klientens.
  //
  // Her stod `playedMatches === totalMatches`, og det er forkert for enhver
  // konkurrence, der stadig kan vokse: en sæson med flere stages (Superligaens
  // slutspil, CL's knockout) får kampene skemalagt undervejs og efterfyldt af
  // `api/_backfill.js`. Mellem sidste grundspilsrunde og udgivelsen af næste
  // stage var betingelsen trivielt sand — og konkurrencen blev erklæret slut
  // med pokal og vinder midt i sin egen sæson.
  //
  // `public.competition_status.concluded` (sql/season_end.sql) kender forskellen
  // og er samme svar, milepælene og kåringerne bruger. To svar på ét spørgsmål
  // var selve fejlen, så klienten stiller ikke sit eget længere.
  //
  // Fejler opslaget, falder vi tilbage til den gamle regel: et kort uden status
  // er værre end et kort med en lidt for optimistisk status, og fremdriften
  // (`playedMatches`/`totalMatches`) er sand uanset hvad.
  let isComplete = totalMatches > 0 && playedMatches === totalMatches;
  try {
    const st = await db.select(token, "competition_status", `competition_id=eq.${competitionId}&select=concluded`, o);
    if (st.length) isComplete = !!st[0].concluded;
  } catch { /* behold fallbacken */ }

  return { userId: undefined, rows: ranked, rounds: playedRounds, allRounds: rounds, predsByKey, totalMatches, playedMatches, isComplete };
}

export { computeCompetitionState };
