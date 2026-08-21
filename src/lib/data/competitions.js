// Oprettelse af konkurrencer (alle fem modes) og de to veje ind i en
// eksisterende: invitationskode og flytning til en liga.

import { db, restFetch } from "../supabase.js";
import { filterTippable, filterFromRoundStart, currentRoundKey, nextRoundKey } from "../scoring.js";
import { logEvent } from "../analytics.js";
import { inviteLookup, acceptInvite } from "./groups.js";

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
//   startRound            full_season | team: "current" (standard) eller "next" —
//                         skal konkurrencen begynde i den runde, der er i gang,
//                         eller vente på den næste? `time_range` har sit eget
//                         svar i startdatoen, og `custom`/`random` er allerede
//                         filtreret i klienten, når de når hertil. "next" gemmes
//                         som `mode_params.from_round` (G148), fordi
//                         efterfyldningen ellers lægger den fravalgte runde
//                         tilbage — se `fromRoundParams()`
//
// Returnerer `matchCount`, så kalderen kan se, at en konkurrence blev tom —
// fx en sæson, der er spillet færdig (`filterTippable` giver da et tomt sæt).
// Guiden bruger det til ikke at love et tip, der ikke findes.
//
// Kampene, der materialiseres, er dem, der STADIG KAN TIPPES (`filterTippable`,
// scoring.js). Det var indtil august 2026 en runde-regel, og den brød sit eget
// løfte inde i en runde: en konkurrence oprettet midt i en runde fik rundens
// allerede spillede kampe med, og da `predictions` deles på tværs af
// konkurrencer, havde den, der havde tippet dem andetsteds, point fra første
// sekund. Se begrundelsen ved funktionen.
// De kampe, en ny konkurrence må starte med: dem der stadig kan tippes, og —
// hvis brugeren har valgt at vente på en ny runde — kun dem fra og med den.
//
// Startrunde-valget findes for Sæson og Favorithold af samme grund som for de
// tilfældige typer: opretter man søndag aften, er indeværende runde næsten
// forbi, og konkurrencens første runde bliver de kampe, der tilfældigvis var
// tilbage. For en hel sæson er det ikke afgørende for udfaldet, men det er
// stadig et vilkår, man skal kunne vælge frem for at arve.
//
// `time_range` går IKKE gennem den: perioden er defineret af sine datoer, og
// startrunde-valget dér sætter startdatoen. To kontroller om samme ting ville
// kunne modsige hinanden.
function startingMatches(ms, startRound) {
  return filterFromRoundStart(filterTippable(ms), { start: startRound, currentKey: currentRoundKey() });
}

// Startrunde-valget skal STÅ I RÆKKEN, når det fravælger noget (`G148`).
//
// Valget var indtil nu kun et filter i oprettelsen, og rækken bar ingen spor af
// det. Efterfyldningen (`api/_backfill.js`) kender kun `mode` og `mode_params`
// og kunne derfor ikke se, at indeværende runde var valgt fra — den lagde
// rundens kampe tilbage ved næste sync, så længe runden endnu ikke var låst.
// Og det er præcis den situation, chippen findes til: man vælger "næste runde",
// FORDI indeværende stadig er åben. Fejlen ramte altså valget hver gang, det
// blev brugt efter hensigten, og den var tavs — konkurrencen fik bare flere
// kampe, end den blev oprettet med.
//
// Feltet er den FØRSTE TILLADTE rundenøgle og ikke den fravalgte, så
// efterfyldningen kan sammenligne med `>=`. Nøglen er en 'YYYY-MM-DD'-tekst
// (rundens tirsdag), og sammenligningen sker som tekst — samme form som
// periodens datoer i `mode_params`.
//
// Det skrives KUN ved "next", af samme grund som `rounds` kun skrives ved > 1:
// en konkurrence uden fravalg har præcis samme rækkeform som før. Ved "current"
// er der heller intet at beskytte — det, `filterTippable` skar væk, var LÅSTE
// kampe, og en låst kamp betyder, at runden er gået i gang, hvilket regel 3
// allerede spærrer for.
function fromRoundParams(startRound) {
  return startRound === "next" ? { from_round: nextRoundKey(currentRoundKey()) } : {};
}

// Skrivningen: konkurrencen, opretteren som deltager og kampene i ÉN sætning.
//
// `create_competition()` (`#73 create_competition.sql`, G133) er en `security
// definer`-RPC efter `create_group()`s mønster (`#57`). Indtil august 2026 var
// det tre adskilte PostgREST-kald — tre transaktioner — og fejlede nummer to
// eller tre, stod der en konkurrence uden deltager eller uden kampe: synlig i
// klienten, tom i stillingen, og ingen kontrol ledte efter den. Nu ruller alt
// tilbage sammen. Funktionen sætter selv `created_by` (`auth.uid()`); der er
// med vilje intet bruger-id at sende med. Udvælgelsen af kampene bliver HER —
// RPC'en tager de færdige værdier og udfører kun skrivningen.
async function insertCompetition(token, { name, groupId, leagueId = null, seasonId = null, mode, modeParams = {}, matchIds = [] }) {
  return restFetch(`/rest/v1/rpc/create_competition`, {
    method: "POST", token,
    body: {
      p_name: name, p_group_id: groupId || null,
      p_league_id: leagueId, p_season_id: seasonId,
      p_mode: mode, p_mode_params: modeParams, p_match_ids: matchIds,
    },
  });
}

async function createCompetition(token, userId, spec) {
  const {
    name, groupId = null, mode = "full_season",
    tournaments = [], leagueId = null, seasonId = null,
    teamId = null, teams = null, startDate = null, endDate = null,
    matchIds = [], randomCount = null, rounds = null, awards = false,
    startRound = "current",
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

  // `rules` skrives IKKE længere (G3, august 2026). Kolonnen er `not null` med
  // defaulten `{"exact": 3, "outcome": 1}`, så rækken får præcis den samme
  // værdi som før — den kommer bare fra databasen, som er det eneste sted, der
  // nogensinde har afgjort point (`pc_points()` hardkoder 3/1, F2). Så længe
  // klienten sendte feltet, så det ud som et valg, den traf: der stod en
  // pointregel i opret-kaldet, og en læser kunne med rette spørge, hvad der
  // ville ske, hvis den var en anden. Svaret var "ingenting", og det er den
  // slags sætning, koden ikke skal have brug for.
  //
  // `userId` sendes heller ikke længere med i skrivningen (G133): RPC'en sætter
  // `created_by` og deltagerrækken af `auth.uid()`, som tokenet allerede bærer.
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
      let ms = await db.select(token, "matches", `season_id=eq.${t.seasonId}&select=id,round_key,home_score,kickoff_at,kickoff_tbd`);
      ms = startingMatches(ms, startRound);
      for (const m of ms) ids.push(m.id);
      picked.push({ league_id: t.leagueId, season_id: t.seasonId });
    }
    const only = picked[0];
    // Én turnering: bevar den bundne form (league_id/season_id sat).
    // Flere: liga-løs som custom/random (null), turneringerne gemt i mode_params.
    const competition = await insertCompetition(token, {
      name, groupId,
      leagueId: multi ? null : only.league_id,
      seasonId: multi ? null : only.season_id,
      mode: "full_season",
      modeParams: multi
        ? { tournaments: picked, ...fromRoundParams(startRound), ...awardsParams }
        : { ...fromRoundParams(startRound), ...awardsParams },
      matchIds: ids,
    });
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
        `season_id=eq.${sid}&select=id,round_key,home_score,kickoff_at,kickoff_tbd&or=(home_team_id.in.(${e.teamIds.join(",")}),away_team_id.in.(${e.teamIds.join(",")}))`);
      ms = startingMatches(ms, startRound);
      for (const m of ms) ids.push(m.id);
    }
    const competition = await insertCompetition(token, {
      name, groupId,
      leagueId: single ? sel[0].leagueId : null,
      seasonId: single ? sel[0].seasonId : null,
      mode: "team",
      modeParams: single
        ? { team_id: sel[0].teamId, ...fromRoundParams(startRound), ...awardsParams }
        : {
            team_ids: sel.map((t) => t.teamId),
            tournaments: [...bySeason].map(([sid, e]) => ({ league_id: e.leagueId, season_id: sid })),
            ...fromRoundParams(startRound),
            ...awardsParams,
          },
      matchIds: ids,
    });
    logEvent(token, "competition_created", { competitionId: competition.id, groupId, metadata: { mode: "team", match_count: ids.length } });
    return { competition, matchCount: ids.length };
  }

  // Periode over FLERE turneringer (august 2026). Samme form som full_season-
  // multi: liga-løs række med turneringerne i `mode_params.tournaments`, og
  // kampene materialiseret pr. turnering, så læse-stierne er uændrede.
  //
  // Efterfyldningen kan i forvejen finde den: `coversSeason()` i
  // api/_backfill.js kigger på `tournaments`, og `matchesRule()` for
  // `time_range` afgør kun på datoerne — den kalder ikke ligaen ind, fordi
  // efterfyldningen allerede er afgrænset til sæsonen. Der er derfor ingen
  // ændring på serversiden.
  //
  // ÉN turnering går bevidst IKKE denne vej: den beholder den bundne form
  // (`league_id`/`season_id` sat, ingen `tournaments`-nøgle), så rækkerne ser
  // ud som hidtil, og ingen eksisterende konkurrence skifter form.
  if (mode === "time_range" && Array.isArray(tournaments) && tournaments.length > 1) {
    const sel = tournaments.filter((t) => t && t.leagueId && t.seasonId);
    if (!sel.length) throw new Error("Vælg mindst én turnering");
    if (!startDate || !endDate) throw new Error("Vælg en start- og slutdato");
    const ids = [];
    const picked = [];
    for (const t of sel) {
      let ms = await db.select(token, "matches",
        `season_id=eq.${t.seasonId}&select=id,round_key,home_score,kickoff_at,kickoff_tbd` +
        `&kickoff_at=gte.${startDate}&kickoff_at=lte.${endDate}T23:59:59`);
      ms = filterTippable(ms);
      for (const m of ms) ids.push(m.id);
      picked.push({ league_id: t.leagueId, season_id: t.seasonId });
    }
    const competition = await insertCompetition(token, {
      name, groupId,
      mode: "time_range",
      modeParams: { start_date: startDate, end_date: endDate, tournaments: picked, ...awardsParams },
      matchIds: ids,
    });
    logEvent(token, "competition_created", { competitionId: competition.id, groupId, metadata: { mode: "time_range", match_count: ids.length, tournaments: picked.length } });
    return { competition, matchCount: ids.length };
  }

  const crossLeague = mode === "custom" || mode === "random";
  // Sæson-baserede modes kan ikke oprettes uden en sæson. Før returnerede
  // skærmen tavst her, så knappen bare holdt op med at virke; nu siges det højt.
  if (!crossLeague && (!leagueId || !seasonId)) throw new Error("Ingen turnering med et kampprogram — vælg en anden turnering.");
  if (crossLeague && !matchIds.length) throw new Error(mode === "custom" ? "Vælg mindst én kamp" : "Ingen kommende kampe i de valgte turneringer");

  const modeParams =
    mode === "team" ? { team_id: teamId, ...fromRoundParams(startRound), ...awardsParams }
    : mode === "time_range" ? { start_date: startDate, end_date: endDate, ...awardsParams }
    // `rounds` skrives kun når > 1 (Quick League), så gamle Quick Pick-rækker
    // og nye har samme form — og `modeLabel` kan skelne alene på feltet.
    : mode === "random" ? { count: Number(randomCount) || 6, ...(Number(rounds) > 1 ? { rounds: Number(rounds) } : {}), ...awardsParams }
    : { ...awardsParams };

  if (crossLeague) {
    const competition = await insertCompetition(token, { name, groupId, mode, modeParams, matchIds });
    logEvent(token, "competition_created", { competitionId: competition.id, groupId, metadata: { mode, match_count: matchIds.length } });
    return { competition, matchCount: matchIds.length };
  }

  // Kampene findes FØR skrivningen (G133): udvælgelsen afhænger ikke af
  // konkurrence-rækken, og RPC'en skal have hele listen i samme kald.
  let query = `season_id=eq.${seasonId}&select=id,round_key,home_score,kickoff_at,kickoff_tbd`;
  if (mode === "team" && teamId) query += `&or=(home_team_id.eq.${teamId},away_team_id.eq.${teamId})`;
  if (mode === "time_range" && startDate && endDate) query += `&kickoff_at=gte.${startDate}&kickoff_at=lte.${endDate}T23:59:59`;
  let matched = await db.select(token, "matches", query);
  // Den generiske sti bærer to modes: `team` i legacy-formen (ét hold) og
  // `time_range` med én turnering. Kun den første har et startrunde-valg —
  // periodens ligger i dens datoer.
  matched = mode === "team" ? startingMatches(matched, startRound) : filterTippable(matched);
  const competition = await insertCompetition(token, {
    name, groupId, leagueId, seasonId, mode, modeParams,
    matchIds: matched.map((m) => m.id),
  });
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

  // Ét opslag svarer på begge slags koder (A40), og én tilmelding udfører
  // begge indmeldinger. Rækkefølgen liga-før-konkurrence bor nu i
  // `accept_invite()` frem for i dette kaldssted — det var netop dét, der lod
  // denne sti og MainApps divergere engang (A7).
  const svar = await inviteLookup(token, code);
  if (svar?.kind === "none" || !svar?.kind) return { kind: "none" };

  const resultat = await acceptInvite(token, code);

  if (svar.kind === "group") {
    // `joined` og ikke `already`: hændelsen skal kun logges, når medlemskabet
    // faktisk blev skrevet. Den gamle `joinGroup` skelnede på samme måde.
    if (resultat?.joined) logEvent(token, "league_joined", { groupId: svar.group.id });
    logEvent(token, "league_invite_accepted", { groupId: svar.group.id, metadata: { via: "code" } });
    return { kind: "group", group: svar.group };
  }

  const competition = svar.competition;
  if (resultat?.joined) {
    logEvent(token, "competition_joined", { competitionId: competition.id, groupId: competition.group_id });
  }
  if (competition.group_id) {
    logEvent(token, "league_invite_accepted", { groupId: competition.group_id, competitionId: competition.id, metadata: { via: "code" } });
  }
  return { kind: "competition", competition, alreadyJoined: !!svar.already };
}

// Flyt en egen liga-løs konkurrence ind i en liga (blød migrering). RPC'en gør
// konkurrencens deltagere til liga-medlemmer (security definer, guard i SQL).
async function moveCompetitionToGroup(token, compId, groupId) {
  return restFetch(`/rest/v1/rpc/move_competition_to_group`, {
    method: "POST", token, body: { p_comp_id: compId, p_group_id: groupId },
  });
}

export { createCompetition, inviteCodeFrom, joinByInviteCode, moveCompetitionToGroup };
