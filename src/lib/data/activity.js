// Aktivitets-sporing, brugerstatistik og Story Engines seneste historie.
// Samlet her, fordi de alle er små, uafhængige opslag knyttet til én bruger.

import { db, restFetch } from "../supabase.js";
import { readUserFlag, writeUserFlag, PING_KEY } from "../localFlags.js";
import { isFresh } from "../stories.js";

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

// ---------- Story Engine v3: dagens ENE kort ----------
// Erstatter v2's loadRoundCarousel. Der er ikke længere en liste at hente:
// databasen håndhæver ét `period = 'day'`-kort pr. bruger pr. dag (det unikke
// indeks stories_day_slot_uniq), så den nyeste række ER dagens kort.
//
// INGEN roundKey-parameter, og det er en forenkling, ikke en forglemmelse.
// Karusellen skulle bindes til den klient-beregnede runde, fordi den samlede
// kort op gennem ugen og skulle tømmes ved rundeskift. Ét kort, der udløber
// efter 48 timer, har ikke det problem — tirsdagens tomhed opstår af sig selv,
// når mandagens kort bliver for gammelt.
//
// UDLØBET FILTRERES HER OG IKKE I SQL: rækken bliver stående som analysedata
// (det er den, A35's tærskelmåling hviler på), men et kort ældre end 48 timer
// er ikke "dagens historie" og må ikke vises. Uden filteret ville en tirsdag
// efter en stille weekend præsentere fredagens kort som nyt.
async function loadDayCard(token) {
  try {
    const rows = await db.select(token, "stories",
      `period=eq.day&dismissed_at=is.null` +
      `&select=id,round_key,day_key,period,competition_id,rule,priority,league_size,` +
      `news_value,payload,headline,body,created_at` +
      `&order=day_key.desc&limit=1`);
    const s = rows?.[0];
    return s && isFresh(s) ? s : null;
  } catch { return null; }
}

// Afvis en historie (sætter dismissed_at). Best-effort.
//
// Efter v3 kan KUN rundestoryen afvises. Dagskortet har hverken Del eller
// Afvis: det udløber af sig selv efter 48 timer og erstattes hver kampdag, så
// der er intet at rydde — spec §8's "ingen friktion, intet at åbne, intet at
// rydde". Feltet og denne funktion bliver stående, fordi rundekortet bruger dem.
async function dismissStory(token, id) {
  try {
    await db.update(token, "stories", `id=eq.${id}`, { dismissed_at: new Date().toISOString() });
  } catch { /* best-effort */ }
}

export { touchActivity, loadUserStats, loadLatestStory, loadDayCard, dismissStory };
