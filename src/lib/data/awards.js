// Lokale kåringer (I13/A22): "Ugens bedste" og "Månedens bedste" i én
// konkurrence. Skriveren er databasens egen SECURITY DEFINER-funktion
// (sql/competition_awards.sql) — klienten TRIGGER den kun og kan hverken
// forfalske eller omgøre en kåring. Ingen cron: kaldet sker ved board-åbning,
// og boardet er v1's eneste visningsflade, så latensen er usynlig.

import { db, restFetch } from "../supabase.js";

// Fire-and-forget: kåringen er berigelse, og boardet må aldrig fejle på den.
// Fejler kaldet (fx før migreringen er kørt), viser boardet blot ingen/gamle
// kåringer — RPC'en er idempotent, så næste åbning samler op.
async function ensureCompetitionAwards(token, competitionId) {
  try {
    await restFetch(`/rest/v1/rpc/award_competition_periods`, {
      method: "POST", token, body: { p_comp_id: competitionId },
    });
  } catch { /* bevidst tavs — se ovenfor */ }
}

// RLS afgør synligheden (kun konkurrencens deltagere ser rækkerne), så der er
// intet filter ud over konkurrencen her. Nyeste periode først.
async function loadCompetitionAwards(token, competitionId) {
  const rows = await db.select(token, "competition_awards",
    `competition_id=eq.${competitionId}&select=*&order=period_key.desc`);
  return {
    rounds: rows.filter((r) => r.period_type === "round"),
    months: rows.filter((r) => r.period_type === "month"),
  };
}

export { ensureCompetitionAwards, loadCompetitionAwards };
