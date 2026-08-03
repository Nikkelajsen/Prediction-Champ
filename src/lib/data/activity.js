// Aktivitets-sporing, brugerstatistik og Story Engines seneste historie.
// Samlet her, fordi de alle er små, uafhængige opslag knyttet til én bruger.

import { db, restFetch } from "../supabase.js";
import { readUserFlag, writeUserFlag, PING_KEY } from "../localFlags.js";

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

// Afvis en historie (sætter dismissed_at). Best-effort.
async function dismissStory(token, id) {
  try {
    await db.update(token, "stories", `id=eq.${id}`, { dismissed_at: new Date().toISOString() });
  } catch { /* best-effort */ }
}

export { touchActivity, loadUserStats, loadLatestStory, dismissStory };
