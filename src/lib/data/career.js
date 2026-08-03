// Karriereprofilen: RPC'en career_profile() og milepælene ved siden af den.

import { db, restFetch } from "../supabase.js";
import { QUIET_TIER_MIN } from "../stories.js";

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

// Milepæle hentes SEPARAT via den eksisterende RLS-læsning af stories (kun egne
// rækker), så de forbliver private — de vises kun på ens egen profil. RLS returnerer
// intet for andres profil, men vi springer kaldet helt over når det ikke er egen profil.
// Genbrug af story-arkivets færdige headline/body som kronologisk minde-liste.
//
// KUN højdepunkt-tieret (`priority < QUIET_TIER_MIN`). Story Engine v1.1 gemmer også
// dæmpede kort for stille runder ("Din runde: 4 point"), og de er per definition ikke
// milepæle — kom de med, ville arkivet blive en rundelog med de ægte øjeblikke gemt inde i.
async function loadCareerMilestones(token, profileUserId, isOwn) {
  if (!isOwn) return [];
  try {
    const rows = await db.select(token, "stories",
      `user_id=eq.${profileUserId}&priority=lt.${QUIET_TIER_MIN}&select=id,round_key,rule,headline,body,created_at&order=round_key.desc,priority.asc`);
    return (rows || []).map((s) => ({
      id: s.id, roundKey: s.round_key, rule: s.rule,
      headline: s.headline, body: s.body, createdAt: s.created_at,
    }));
  } catch { return []; }
}

export { loadCareerProfile, loadCareerMilestones };
