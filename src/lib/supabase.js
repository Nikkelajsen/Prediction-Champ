// REST-klienten mod Supabase. Ingen SDK — kun `fetch` plus de få helpers,
// resten af appen har brug for: db-opslag, auth-endpoints og den gemte session.
// ---------- Supabase config ----------
// Produktionsværdierne er hårdkodede fallbacks (offentlig publishable-nøgle,
// beskyttet af RLS — by design). Sæt VITE_SUPABASE_URL/VITE_SUPABASE_KEY
// (fx i Vercels Preview-miljø eller .env.local) for at pege på en
// staging-database i stedet — se .env.example og DOCUMENTATION.md afsnit 9.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://qfcjbpvttburccdyfnkx.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || "sb_publishable_Et9Dahm8LOhZk6cS1XRqhA_9RuNmnvC";

// ---------- tiny REST helpers (no SDK needed) ----------
// Fejlen bærer sin HTTP-status videre (G26).
//
// Uden den er en udløbet session ikke til at skelne fra et tomt datasæt eller
// et netværkshul: kalderen får en tekst og intet andet. Med `status` kan
// App.jsx skelne "din adgang er udløbet" (4xx fra auth-endpointet, log ud) fra
// "vi kunne ikke nå serveren" (ingen status, prøv igen senere) — og de to skal
// ikke føre til det samme.
//
// Egenskaben tilføjes på et almindeligt Error frem for en ny fejlklasse: alle
// eksisterende `catch`-blokke læser `e.message` og er uændrede.
async function restError(res) {
  let msg = res.statusText;
  try { msg = (await res.json()).message || msg; } catch { /* ikke JSON */ }
  const err = new Error(msg);
  err.status = res.status;
  return err;
}

// Blev kaldet afbrudt, fordi kalderen navigerede væk? (G25)
//
// Skal kunne skelnes fra en rigtig fejl: en afbrudt indlæsning er ikke noget,
// brugeren skal se en fejltekst om — de bad selv om at komme videre. Uden det
// skel ville hvert skift af konkurrence kunne efterlade "Kunne ikke hente
// stillingen" på den skærm, man netop kom TIL.
function isAborted(e) {
  return e?.name === "AbortError";
}

async function restFetch(path, { method = "GET", body, token, prefer, signal } = {}) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${token || SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok) throw await restError(res);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
// Antal rækker UDEN at hente dem.
//
// PostgREST har et loft på, hvor mange rækker ét svar må indeholde (Supabase:
// 1000), og loftet er tavst — svaret er bare kortere. Tæller man ved at hente
// rækkerne og måle listen, tæller man derfor loftet frem for tabellen, så snart
// der er mere end 1000 rækker at tælle. `count=exact` lader databasen tælle og
// svarer i Content-Range ("0-0/1760"), som er upåvirket af loftet.
async function restCount(path, { token, signal } = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: "GET",
    signal,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token || SUPABASE_KEY}`,
      "Content-Type": "application/json",
      // limit=0 i selve forespørgslen: vi vil have tallet, ikke rækkerne.
      Prefer: "count=exact",
    },
  });
  if (!res.ok) throw await restError(res);
  const total = Number((res.headers.get("content-range") || "").split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}
// `opts` er valgfrit og bagudkompatibelt: alle eksisterende kaldsteder er
// uændrede, og de, der VIL kunne annullere, sender `{ signal }` med (G25).
// Skrivende kald tager den bevidst ikke — en afbrudt POST kan have nået
// serveren, og "vi ved ikke, om den blev skrevet" er værre end at vente.
const db = {
  select: (token, table, query = "", opts = {}) => restFetch(`/rest/v1/${table}?${query}`, { token, ...opts }),
  count: (token, table, query = "", opts = {}) => restCount(`/rest/v1/${table}?${query}${query ? "&" : ""}limit=0`, { token, ...opts }),
  insert: (token, table, rows) =>
    restFetch(`/rest/v1/${table}`, { method: "POST", token, body: rows, prefer: "return=representation" }),
  upsert: (token, table, rows, onConflict) =>
    restFetch(`/rest/v1/${table}${onConflict ? `?on_conflict=${onConflict}` : ""}`, {
      method: "POST", token, body: rows, prefer: "resolution=merge-duplicates,return=representation",
    }),
  update: (token, table, query, patch) =>
    restFetch(`/rest/v1/${table}?${query}`, { method: "PATCH", token, body: patch, prefer: "return=representation" }),
  del: (token, table, query) =>
    restFetch(`/rest/v1/${table}?${query}`, { method: "DELETE", token, prefer: "return=representation" }),
};
const auth = {
  signUp: (email, password) =>
    restFetch(`/auth/v1/signup`, { method: "POST", body: { email, password } }),
  signIn: (email, password) =>
    restFetch(`/auth/v1/token?grant_type=password`, { method: "POST", body: { email, password } }),
  refresh: (refresh_token) =>
    restFetch(`/auth/v1/token?grant_type=refresh_token`, { method: "POST", body: { refresh_token } }),
  recover: (email) =>
    restFetch(`/auth/v1/recover`, { method: "POST", body: { email } }),
  updatePassword: (accessToken, password) =>
    restFetch(`/auth/v1/user`, { method: "PUT", token: accessToken, body: { password } }),
  checkUsername: (name) =>
    restFetch(`/rest/v1/rpc/username_available`, { method: "POST", body: { name } }),
};
const SESSION_KEY = "pc_session";
function saveSession(session) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
}
function loadSession() {
  try { const raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

export { restError, isAborted, restFetch, restCount, db, auth, saveSession, loadSession, clearSession };
