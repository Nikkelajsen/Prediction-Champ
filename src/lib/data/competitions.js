// Oprettelse af konkurrencer (alle fem modes) og de to veje ind i en
// eksisterende: invitationskode og flytning til en liga.

import { db, restFetch } from "../supabase.js";
import { filterByStages, filterFromNextUnfinishedRound } from "../scoring.js";
import { logEvent } from "../analytics.js";
import { loadGroupByCode, joinGroup, joinCompetition } from "./groups.js";

// ---------- oprettelse af konkurrence ----------

// Et ægte DELMÆNGDE-valg af stages. Dækker valget alle stages (eller er der kun
// én), filtreres der ikke — så kampe uden stage_name fra ældre sync ikke tavst
// droppes. Reglen er den samme for `full_season` pr. turnering og for team/
// time_range, og bor derfor ét sted.
function isStageSubset(available, selected) {
  return (available || []).length > 1 && (selected || []).length > 0 && selected.length < available.length;
}

// Opret en konkurrence: konkurrence-rækken + opretteren som deltager + de kampe,
// konkurrencen omfatter.
//
// Logikken bor HER og ikke i opret-skærmen, fordi den nu har to kaldesteder
// (opret-skærmen og onboarding-guiden). Præcis dét — to veje ind i den samme
// skrivning, hver med sin kopi — var det, A7 kostede, da kun den ene huskede
// ligaen. Skærmen beholder sin UI-state og bygger blot `spec`.
//
// `spec`:
//   name                  påkrævet
//   groupId               liga-tilhør (null = liga-løs)
//   mode                  full_season | team | time_range | custom | random
//   tournaments           full_season: [{ leagueId, seasonId, availableStages, selectedStages }]
//   leagueId, seasonId    team | time_range
//   teamId                team
//   startDate, endDate    time_range
//   availableStages,
//   selectedStages        team | time_range
//   matchIds              custom | random: de eksplicit valgte kampe
//   randomCount           random: gemmes i mode_params
//   openDaysBefore        rullende gætte-vindue (0 = fra)
//
// Returnerer `matchCount`, så kalderen kan se, at en konkurrence blev tom —
// fx en sæson, der er spillet færdig (`filterFromNextUnfinishedRound` giver da
// et tomt sæt). Guiden bruger det til ikke at love et tip, der ikke findes.
async function createCompetition(token, userId, spec) {
  const {
    name, groupId = null, mode = "full_season",
    tournaments = [], leagueId = null, seasonId = null,
    teamId = null, startDate = null, endDate = null,
    availableStages = [], selectedStages = [],
    matchIds = [], randomCount = null, openDaysBefore = 0,
  } = spec;

  const rules = { exact: 3, outcome: 1, ...(openDaysBefore ? { openDaysBefore } : {}) };
  const base = { name, group_id: groupId || null, rules, created_by: userId };

  // Full sæson kan spænde over flere turneringer på én gang (fx Superliga +
  // Premier League). Kampene materialiseres pr. turnering — med den turnerings
  // egne stage-valg — så læse-stierne (stilling, tips) virker uændret via
  // competition_matches.
  if (mode === "full_season") {
    const sel = tournaments.filter((t) => t && t.leagueId && t.seasonId);
    if (!sel.length) throw new Error("Vælg mindst én turnering");
    const multi = sel.length > 1;
    const picked = [];
    const ids = [];
    for (const t of sel) {
      const subset = isStageSubset(t.availableStages, t.selectedStages);
      let ms = await db.select(token, "matches", `season_id=eq.${t.seasonId}&select=id,round_key,home_score,stage_name`);
      ms = filterByStages(ms, subset ? t.selectedStages : []);
      ms = filterFromNextUnfinishedRound(ms);
      for (const m of ms) ids.push(m.id);
      picked.push({ league_id: t.leagueId, season_id: t.seasonId, ...(subset ? { stages: t.selectedStages } : {}) });
    }
    const only = picked[0];
    // Én turnering: bevar den bundne form (league_id/season_id sat, evt. stages).
    // Flere: liga-løs som custom/random (null), turneringerne gemt i mode_params.
    const [competition] = await db.insert(token, "competitions", [{
      ...base,
      league_id: multi ? null : only.league_id,
      season_id: multi ? null : only.season_id,
      mode: "full_season",
      mode_params: multi ? { tournaments: picked } : (only.stages ? { stages: only.stages } : {}),
    }]);
    await db.insert(token, "competition_participants", [{ competition_id: competition.id, user_id: userId }]);
    if (ids.length) {
      await db.insert(token, "competition_matches", ids.map((id) => ({ competition_id: competition.id, match_id: id })));
    }
    logEvent(token, "competition_created", { competitionId: competition.id, groupId, metadata: { mode: "full_season", match_count: ids.length } });
    return { competition, matchCount: ids.length };
  }

  const crossLeague = mode === "custom" || mode === "random";
  // Sæson-baserede modes kan ikke oprettes uden en sæson. Før returnerede
  // skærmen tavst her, så knappen bare holdt op med at virke; nu siges det højt.
  if (!crossLeague && (!leagueId || !seasonId)) throw new Error("Ingen turnering med et kampprogram — vælg en anden turnering.");
  if (crossLeague && !matchIds.length) throw new Error(mode === "custom" ? "Vælg mindst én kamp" : "Ingen kommende kampe i de valgte turneringer");

  const subset = !crossLeague && isStageSubset(availableStages, selectedStages);
  const [competition] = await db.insert(token, "competitions", [{
    ...base,
    league_id: crossLeague ? null : leagueId,
    season_id: crossLeague ? null : seasonId,
    mode,
    mode_params: {
      ...(mode === "team" ? { team_id: teamId }
        : mode === "time_range" ? { start_date: startDate, end_date: endDate }
        : mode === "random" ? { count: Number(randomCount) || 6 } : {}),
      ...(subset ? { stages: selectedStages } : {}),
    },
  }]);
  await db.insert(token, "competition_participants", [{ competition_id: competition.id, user_id: userId }]);

  if (crossLeague) {
    await db.insert(token, "competition_matches", matchIds.map((id) => ({ competition_id: competition.id, match_id: id })));
    logEvent(token, "competition_created", { competitionId: competition.id, groupId, metadata: { mode, match_count: matchIds.length } });
    return { competition, matchCount: matchIds.length };
  }

  let query = `season_id=eq.${seasonId}&select=id,round_key,home_score,stage_name`;
  if (mode === "team" && teamId) query += `&or=(home_team_id.eq.${teamId},away_team_id.eq.${teamId})`;
  if (mode === "time_range" && startDate && endDate) query += `&kickoff_at=gte.${startDate}&kickoff_at=lte.${endDate}T23:59:59`;
  let matched = await db.select(token, "matches", query);
  matched = filterByStages(matched, subset ? selectedStages : []);
  matched = filterFromNextUnfinishedRound(matched);
  if (matched.length) {
    await db.insert(token, "competition_matches", matched.map((m) => ({ competition_id: competition.id, match_id: m.id })));
  }
  logEvent(token, "competition_created", { competitionId: competition.id, groupId, metadata: { mode, match_count: matched.length } });
  return { competition, matchCount: matched.length };
}

// ---------- deltag med invitationskode ----------

// Ny brugere indsætter det, de fik i beskedtråden — hele linket, ikke en
// renskrevet kode. Træk koden ud af `?liga=`/`?join=`, og lad alt andet passere
// som en rå kode.
function inviteCodeFrom(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/[?&](?:liga|join)=([^&#\s]+)/i);
  return m ? decodeURIComponent(m[1]) : s;
}

// Deltag ud fra én kode, der kan være enten en liga- eller en konkurrence-kode
// (bagudkompatibelt: begge invite-links er permanente, jf. A7).
//
// Idempotent: er man allerede deltager, skrives der ingen dublet — men
// liga-medlemskabet forsøges stadig, fordi netop dét er A8-halvtilstanden
// (deltager uden liga-medlemskab), og at bruge invitationen igen er den
// naturlige måde at forsøge at rette den på.
async function joinByInviteCode(token, userId, rawCode) {
  const code = inviteCodeFrom(rawCode);
  if (!code) return { kind: "none" };

  const group = await loadGroupByCode(token, code);
  if (group) {
    await joinGroup(token, userId, group.id);
    logEvent(token, "league_invite_accepted", { groupId: group.id, metadata: { via: "code" } });
    return { kind: "group", group };
  }

  const found = await db.select(token, "competitions", `invite_code=eq.${code}&select=*`);
  if (!found.length) return { kind: "none" };
  const competition = found[0];

  const already = await db.select(token, "competition_participants", `competition_id=eq.${competition.id}&user_id=eq.${userId}&select=competition_id`);
  if (already.length) {
    if (competition.group_id) {
      try { await joinGroup(token, userId, competition.group_id); }
      catch { /* deltagelsen er intakt — bloker ikke navigationen */ }
      logEvent(token, "league_invite_accepted", { groupId: competition.group_id, competitionId: competition.id, metadata: { via: "code" } });
    }
    return { kind: "competition", competition, alreadyJoined: true };
  }

  await joinCompetition(token, userId, competition.id, competition.group_id);
  if (competition.group_id) {
    logEvent(token, "league_invite_accepted", { groupId: competition.group_id, competitionId: competition.id, metadata: { via: "code" } });
  }
  return { kind: "competition", competition, alreadyJoined: false };
}

// Flyt en egen liga-løs konkurrence ind i en liga (blød migrering). RPC'en gør
// konkurrencens deltagere til liga-medlemmer (security definer, guard i SQL).
async function moveCompetitionToGroup(token, compId, groupId) {
  return restFetch(`/rest/v1/rpc/move_competition_to_group`, {
    method: "POST", token, body: { p_comp_id: compId, p_group_id: groupId },
  });
}

export { isStageSubset, createCompetition, inviteCodeFrom, joinByInviteCode, moveCompetitionToGroup };
