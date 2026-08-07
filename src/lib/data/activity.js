// Aktivitets-sporing, brugerstatistik og Story Engines seneste historie.
// Samlet her, fordi de alle er små, uafhængige opslag knyttet til én bruger.

import { db, restFetch } from "../supabase.js";
import { readUserFlag, writeUserFlag, PING_KEY } from "../localFlags.js";
import { compareMilestones } from "../milestones.js";

// ---------- Aktivitets-sporing + brugerstatistik ----------
// touchActivity: letvægts-"ping" ved app-start. RPC'en registrerer, at brugeren har
// været inde i dag (last_seen_at + user_activity_days). Throttlet til maks. 1×/time via
// localStorage, så gentagne genstarter/refresh ikke spammer. Fejl ignoreres stille —
// sporing må aldrig blokere appen.
//
// Throttlen er pr. BRUGER: var tidsstemplet enhedens, kunne den ene bruger på en
// delt telefon spærre den andens ping, og dagen ville mangle i statistikken for
// en, der faktisk var inde.
async function touchActivity(token, userId) {
  try {
    const last = Number(readUserFlag(PING_KEY, userId) || 0);
    if (Date.now() - last < 60 * 60 * 1000) return; // maks. 1 ping pr. time
    await restFetch(`/rest/v1/rpc/touch_activity`, { method: "POST", token, body: {} });
    writeUserFlag(PING_KEY, userId, String(Date.now()));
  } catch { /* ignorer — sporing er best-effort */ }
}

// loadUserStats: henter aggregeret brugerstatistik. RPC'en er admin-kun (security
// definer med is_admin-guard) og returnerer alle nøgletal + kurver i ét kald.
async function loadUserStats(token) {
  return restFetch(`/rest/v1/rpc/admin_user_stats`, { method: "POST", token, body: {} });
}

// ---------- Story Engine: seneste historie til Hjem ----------
// Læser latest_story-viewet (RLS: kun egne rækker) for den seneste runde. Er den
// seneste historie afvist, returneres null (så en afvist historie ikke afslører en
// ældre runde). Degraderer stille til null, hvis viewet endnu ikke findes (skygge/L3).
async function loadLatestStory(token) {
  try {
    const rows = await db.select(token, "latest_story", `order=round_key.desc&limit=1`);
    if (!rows || !rows.length) return null;
    const s = rows[0];
    if (s.dismissed_at) return null;
    return s;
  } catch { return null; }
}

// ---------- Story Engine v2: rundens karrusel ----------
// Alle kort i den AKTUELLE runde, nyeste dag først. Kortene akkumulerer gennem
// runden (0–2 pr. kampdag), og rundens afsluttende kort — som ikke har nogen
// dag — lægger sig øverst via `nullsfirst`.
//
// `roundKey` SKAL være den klient-beregnede nuværende runde (currentRoundKey i
// src/lib/scoring.js) og ikke `max(round_key)` fra tabellen. Forskellen er
// synlig hver tirsdag: i en ny rundes første dage findes der endnu ingen
// rækker, og et max ville derfor vise den forrige uges kort i stedet for den
// tomme karrusel, en ny runde skal starte med.
//
// Afviste kort filtreres væk her (modsat latest_story, hvor frontenden gjorde
// det): karusellen viser en LISTE, så et afvist kort kan bare udelades uden at
// afsløre noget ældre.
async function loadRoundCarousel(token, roundKey, limit = 10) {
  if (!roundKey) return [];
  try {
    const rows = await db.select(token, "stories",
      `round_key=eq.${roundKey}&dismissed_at=is.null` +
      `&select=id,round_key,day_key,period,competition_id,rule,priority,league_size,payload,headline,body` +
      `&order=day_key.desc.nullsfirst,priority.asc&limit=${limit}`);
    return rows || [];
  } catch { return []; }
}

// Milepæle opnået siden et tidspunkt — til karusellen på Hjem, hvor en nyopnået
// milepæl lægger sig forrest som guldkort. Uden den ville en milepæl kun kunne
// opdages ved at åbne karriereprofilen, og så ville de fleste aldrig se, at de
// havde opnået noget. Teksten renderes af klienten (src/lib/milestones.js).
// Rækkefølgen afgøres i JS og ikke af `order=` — se `compareMilestones`.
// Databasen kan sortere på `achieved_at`, men ikke på familie-rangordenen, og
// det er netop den, der skal afgøre, når flere milepæle deler dag (hvilket de
// rutinemæssigt gør: `award_milestones()` er en batch-genberegning). Derfor
// hentes der bredere end de tre, der vises, og de tre vælges her.
const MILESTONE_FETCH = 12;

async function loadRecentMilestones(token, sinceDateKey, limit = 3) {
  if (!sinceDateKey) return [];
  try {
    const rows = await db.select(token, "milestones",
      `achieved_at=gte.${sinceDateKey}&select=key,family,tier,competition_id,payload,achieved_at` +
      `&order=achieved_at.desc&limit=${MILESTONE_FETCH}`);
    return (rows || []).slice().sort(compareMilestones).slice(0, limit);
  } catch { return []; }
}

// Afvis en historie (sætter dismissed_at). Best-effort.
async function dismissStory(token, id) {
  try {
    await db.update(token, "stories", `id=eq.${id}`, { dismissed_at: new Date().toISOString() });
  } catch { /* best-effort */ }
}

export { touchActivity, loadUserStats, loadLatestStory, loadRoundCarousel, loadRecentMilestones, dismissStory };
