// Karriereprofilen: RPC'en career_profile() og milepælene ved siden af den.

import { db, restFetch } from "../supabase.js";
import { renderMilestone } from "../milestones.js";

// ---------- Karriereprofil ----------
// Ét RPC-kald samler hele profil-læsningen (hoved, titler, ratingkurve, basistal,
// rivaler) i databasen — mønster som loadUserStats. RPC'et er security definer,
// og adgangen kræver kun login (K1 udvidet): alle profiler kan læses, kun rivaler
// (og milepælene nedenfor) er private. Eneste afvisning er 'not found' for et
// ukendt id, som skærmen viser som pæn tekst.
async function loadCareerProfile(token, profileUserId) {
  return restFetch(`/rest/v1/rpc/career_profile`, {
    method: "POST", token, body: { profile_user_id: profileUserId },
  });
}

// Milepæle hentes SEPARAT fra den nye milestones-tabel (RLS: kun egne rækker),
// så de forbliver private — de vises kun på ens egen profil. RLS returnerer
// intet for andres profil, men vi springer kaldet helt over, når det ikke er
// egen profil.
//
// FØR AUGUST 2026 LÆSTE DENNE FUNKTION `stories` med `priority < 90`, og det er
// den ændring, hele leverancen handler om: Story Engine gemmer ALLE udløste
// kandidater hver runde — ikke kun den, der vises — så en bruger i tre
// konkurrencer samlede "Kun 3 point op til føringen", "Din bedste runde hidtil"
// og "2 præcise resultater" op hver eneste uge. Arkivet var en rundelog.
//
// Milepæle er nu engangs-bedrifter med deres eget katalog (src/lib/milestones.js
// + sql/milestones.sql). Teksten renderes af klienten, fordi tabellen kun gemmer
// nøgle og payload — der er derfor ingen skabelon at holde i sync med SQL'en.
async function loadCareerMilestones(token, profileUserId, isOwn) {
  if (!isOwn) return [];
  try {
    const rows = await db.select(token, "milestones",
      `user_id=eq.${profileUserId}&select=key,family,tier,competition_id,payload,achieved_at&order=achieved_at.desc`);
    return (rows || []).map((m) => {
      const r = renderMilestone(m.key, m.payload || {});
      return {
        id: m.key, key: m.key, family: m.family, tier: m.tier,
        competitionId: m.competition_id, achievedAt: m.achieved_at,
        icon: r.icon, headline: r.title, body: r.body,
      };
    });
  } catch { return []; }
}

export { loadCareerProfile, loadCareerMilestones };
