// Oprettelse af konkurrencer (alle fem modes) og de to veje ind i en
// eksisterende: invitationskode og flytning til en liga.

import { db, restFetch } from "../supabase.js";
import { filterFromNextUnfinishedRound } from "../scoring.js";
import { logEvent } from "../analytics.js";
import { loadGroupByCode, joinGroup, joinCompetition } from "./groups.js";

// ---------- oprettelse af konkurrence ----------

// Fase-afgrænsning (grundspil/slutspil) findes IKKE længere ved oprettelsen.
// En sæson-baseret konkurrence dækker hele sæsonen — også de kampe, der først
// skemalægges senere, og som efterfyldes af `api/sync-matches.js`. Vil man have
// et enkelt slutspil for sig, er det en NY konkurrence; det er liga-lagets egen
// model ("konkurrencer er kapitler i ligaens historie") og ikke et filter.
//
// `mode_params.stages` skrives derfor aldrig mere, men feltet læses stadig af
// efterfyldningen som et MÆRKAT: findes det, er konkurrencen afgrænset i hånden
// under den gamle ordning og må aldrig vokse. Derfor står de gamle rækker
// urørte uden en overgangsregel.

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
//   groupId               liga-tilhør — PÅKRÆVET (se guarden nedenfor)
//   mode                  full_season | team | time_range | custom | random
//   tournaments           full_season: [{ leagueId, seasonId }]
//   leagueId, seasonId    team (legacy-form) | time_range
//   teamId                team (legacy-form: ét hold i én turnering)
//   teams                 team: [{ leagueId, seasonId, teamId }] — kan spænde
//                         over flere turneringer (I14: Favorithold)
//   startDate, endDate    time_range
//   matchIds              custom | random: de eksplicit valgte kampe
//   randomCount           random: gemmes i mode_params
//   rounds                random: antal runder (Quick League) — gemmes i
//                         mode_params, men KUN når > 1, så gamle rækkers form
//                         er uændret og `modeLabel` kan skelne på feltet
//   awards                kårings-tilvalget (I13/A22): true ⇒ mode_params.awards
//
// Returnerer `matchCount`, så kalderen kan se, at en konkurrence blev tom —
// fx en sæson, der er spillet færdig (`filterFromNextUnfinishedRound` giver da
// et tomt sæt). Guiden bruger det til ikke at love et tip, der ikke findes.
async function createCompetition(token, userId, spec) {
  const {
    name, groupId = null, mode = "full_season",
    tournaments = [], leagueId = null, seasonId = null,
    teamId = null, teams = null, startDate = null, endDate = null,
    matchIds = [], randomCount = null, rounds = null, awards = false,
  } = spec;

  // En NY konkurrence skal høre til en liga (august 2026).
  //
  // Liga-løs var indtil nu et lovligt valg ("Ingen liga" i opret-skærmen), og
  // det er den tilstand, hele liga-laget handlede om at komme væk fra: ingen
  // medlemsliste, intet permanent invite-link, og intet der består, når
  // sæsonen slutter. Onboarding-guiden har altid oprettet ligaen først; den
  // frie opret-skærm var det ene sted, man kunne ende uden.
  //
  // Reglen står HER og ikke kun i skærmen, fordi det er den ene skrivning,
  // begge kaldesteder går igennem — præcis dét, A7 kostede, da de to veje ind
  // havde hver sin kopi. Den kan derimod IKKE være et `not null` i databasen:
  // `competitions.group_id` er `on delete set null`, så en slettet liga gør
  // sine konkurrencer liga-løse, og de gamle liga-løse rækker fra før
  // liga-laget skal blive ved med at virke (§18, blød migrering). Reglen
  // gælder oprettelsen, ikke rækkens levetid.
  if (!groupId) throw new Error("Vælg eller opret den liga, konkurrencen skal høre til.");

  // Faste pointregler. Feltet er historisk konfigurerbart, men `pc_points()`
  // hardkoder 3/1 (F2, juli 2026), og det rullende gætte-vindue — den eneste
  // reelle variation, der nogensinde blev skrevet her — er fjernet igen (B1).
  const rules = { exact: 3, outcome: 1 };
  const base = { name, group_id: groupId || null, rules, created_by: userId };
  // Kårings-tilvalget spredes ind i mode_params i ALLE grene — men kun når det
  // er valgt, så en konkurrence uden tilvalg har præcis samme rækkeform som før.
  const awardsParams = awards ? { awards: true } : {};

  // Full sæson kan spænde over flere turneringer på én gang (fx Superliga +
  // Premier League). Kampene materialiseres pr. turnering, så læse-stierne
  // (stilling, tips) virker uændret via competition_matches.
  if (mode === "full_season") {
    const sel = tournaments.filter((t) => t && t.leagueId && t.seasonId);
    if (!sel.length) throw new Error("Vælg mindst én turnering");
    const multi = sel.length > 1;
    const picked = [];
    const ids = [];
    for (const t of sel) {
      let ms = await db.select(token, "matches", `season_id=eq.${t.seasonId}&select=id,round_key,home_score`);
      ms = filterFromNextUnfinishedRound(ms);
      for (const m of ms) ids.push(m.id);
      picked.push({ league_id: t.leagueId, season_id: t.seasonId });
    }
    const only = picked[0];
    // Én turnering: bevar den bundne form (league_id/season_id sat).
    // Flere: liga-løs som custom/random (null), turneringerne gemt i mode_params.
    const [competition] = await db.insert(token, "competitions", [{
      ...base,
      league_id: multi ? null : only.league_id,
      season_id: multi ? null : only.season_id,
      mode: "full_season",
      mode_params: multi ? { tournaments: picked, ...awardsParams } : { ...awardsParams },
    }]);
    await db.insert(token, "competition_participants", [{ competition_id: competition.id, user_id: userId }]);
    if (ids.length) {
      await db.insert(token, "competition_matches", ids.map((id) => ({ competition_id: competition.id, match_id: id })));
    }
    logEvent(token, "competition_created", { competitionId: competition.id, groupId, metadata: { mode: "full_season", match_count: ids.length } });
    return { competition, matchCount: ids.length };
  }

  // Favorithold (I14): flere hold, evt. på tværs af turneringer. Kun den NYE
  // spec-form (`teams`-listen) rammer denne gren — den gamle (`teamId`) går
  // uændret gennem den generiske sti nedenfor, så eksisterende kaldere og
  // rækkeformer er urørte. Ét hold i listen giver præcis legacy-formen (bundet
  // league_id/season_id, `mode_params.team_id`); flere gør konkurrencen
  // turneringsløs som full_season-multi og skriver BÅDE `team_ids` og
  // `tournaments` — den sidste, fordi efterfyldningens `coversSeason()`
  // (api/_backfill.js) afgør sæsondækning på netop dén nøgle.
  if (mode === "team" && Array.isArray(teams) && teams.length) {
    const sel = teams.filter((t) => t && t.leagueId && t.seasonId && t.teamId);
    if (!sel.length) throw new Error("Vælg mindst ét hold");
    const single = sel.length === 1;
    // Hold grupperes pr. sæson: to hold i samme turnering er ét opslag, og et
    // opgør mellem to valgte hold kommer naturligt kun med én gang.
    const bySeason = new Map();
    for (const t of sel) {
      const e = bySeason.get(t.seasonId) || { leagueId: t.leagueId, teamIds: [] };
      if (!e.teamIds.includes(t.teamId)) e.teamIds.push(t.teamId);
      bySeason.set(t.seasonId, e);
    }
    const ids = [];
    for (const [sid, e] of bySeason) {
      let ms = await db.select(token, "matches",
        `season_id=eq.${sid}&select=id,round_key,home_score&or=(home_team_id.in.(${e.teamIds.join(",")}),away_team_id.in.(${e.teamIds.join(",")}))`);
      ms = filterFromNextUnfinishedRound(ms);
      for (const m of ms) ids.push(m.id);
    }
    const [competition] = await db.insert(token, "competitions", [{
      ...base,
      league_id: single ? sel[0].leagueId : null,
      season_id: single ? sel[0].seasonId : null,
      mode: "team",
      mode_params: single
        ? { team_id: sel[0].teamId, ...awardsParams }
        : {
            team_ids: sel.map((t) => t.teamId),
            tournaments: [...bySeason].map(([sid, e]) => ({ league_id: e.leagueId, season_id: sid })),
            ...awardsParams,
          },
    }]);
    await db.insert(token, "competition_participants", [{ competition_id: competition.id, user_id: userId }]);
    if (ids.length) {
      await db.insert(token, "competition_matches", ids.map((id) => ({ competition_id: competition.id, match_id: id })));
    }
    logEvent(token, "competition_created", { competitionId: competition.id, groupId, metadata: { mode: "team", match_count: ids.length } });
    return { competition, matchCount: ids.length };
  }

  const crossLeague = mode === "custom" || mode === "random";
  // Sæson-baserede modes kan ikke oprettes uden en sæson. Før returnerede
  // skærmen tavst her, så knappen bare holdt op med at virke; nu siges det højt.
  if (!crossLeague && (!leagueId || !seasonId)) throw new Error("Ingen turnering med et kampprogram — vælg en anden turnering.");
  if (crossLeague && !matchIds.length) throw new Error(mode === "custom" ? "Vælg mindst én kamp" : "Ingen kommende kampe i de valgte turneringer");

  const [competition] = await db.insert(token, "competitions", [{
    ...base,
    league_id: crossLeague ? null : leagueId,
    season_id: crossLeague ? null : seasonId,
    mode,
    mode_params:
      mode === "team" ? { team_id: teamId, ...awardsParams }
      : mode === "time_range" ? { start_date: startDate, end_date: endDate, ...awardsParams }
      // `rounds` skrives kun når > 1 (Quick League), så gamle Quick Pick-rækker
      // og nye har samme form — og `modeLabel` kan skelne alene på feltet.
      : mode === "random" ? { count: Number(randomCount) || 6, ...(Number(rounds) > 1 ? { rounds: Number(rounds) } : {}), ...awardsParams }
      : { ...awardsParams },
  }]);
  await db.insert(token, "competition_participants", [{ competition_id: competition.id, user_id: userId }]);

  if (crossLeague) {
    await db.insert(token, "competition_matches", matchIds.map((id) => ({ competition_id: competition.id, match_id: id })));
    logEvent(token, "competition_created", { competitionId: competition.id, groupId, metadata: { mode, match_count: matchIds.length } });
    return { competition, matchCount: matchIds.length };
  }

  let query = `season_id=eq.${seasonId}&select=id,round_key,home_score`;
  if (mode === "team" && teamId) query += `&or=(home_team_id.eq.${teamId},away_team_id.eq.${teamId})`;
  if (mode === "time_range" && startDate && endDate) query += `&kickoff_at=gte.${startDate}&kickoff_at=lte.${endDate}T23:59:59`;
  let matched = await db.select(token, "matches", query);
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
//
// Koden sænkes til små bogstaver, fordi begge koder ER små bogstaver: de
// genereres som `substr(md5(...), 1, 8)`, altså otte hex-tegn, og opslaget er
// `eq.` (case-sensitivt). En kode, der er tastet af — eller som iOS har
// forsynet med et stort forbogstav i tastaturets automatik — ramte derfor nul
// rækker og gav "Ingen liga eller konkurrence fundet med den kode", selv om
// koden var rigtig. Ingen gyldig kode kan indeholde et stort bogstav, så
// sænkningen kan ikke ramme forbi.
function inviteCodeFrom(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/[?&](?:liga|join)=([^&#\s]+)/i);
  return (m ? decodeURIComponent(m[1]) : s).toLowerCase();
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

export { createCompetition, inviteCodeFrom, joinByInviteCode, moveCompetitionToGroup };
