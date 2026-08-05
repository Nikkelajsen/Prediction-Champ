// Invitationer via deep-link: hvad koden PEGER PÅ, og hvad der skal ske.
//
// ---------------------------------------------------------------------------
// Hvorfor den findes (G1, august 2026)
//
// De to opslag lå som ~100 linjer inde i to `useEffect` i `MainApp.jsx` — appens
// største fil og den, hvor navigations-tilstandsmaskinen bor. Det gjorde dem
// **utestbare**: repoets testopsætning er bevidst uden jsdom, så alt, der kun
// kan nås gennem en render, kan kun efterprøves i hånden.
//
// Det var ikke en teoretisk mangel. `A23` (skal appen have en router?) står
// åben netop med den begrundelse, at *"en router omskriver hele
// navigations-tilstandsmaskinen inkl. begge deep-link-join-flows, som ingen
// test dækker"*. Udskillelsen er derfor ikke en oprydning ved siden af `A23` —
// den fjerner en af dens omkostninger.
//
// ---------------------------------------------------------------------------
// SNITTET: modulet svarer HVAD der blev fundet, ikke HVOR man skal hen
//
// Funktionerne returnerer et resultat-objekt (`kind`), og `MainApp` oversætter
// det til `setTab`/`setScreen`. Det er med vilje, og det er hele grunden til, at
// udskillelsen kan laves nu frem for sammen med `A23`: navigationen — dét, en
// router ville ændre — bliver liggende, mens dataarbejdet flytter ud. Lægger
// man `setScreen` herind, har man bygget den samme entangling igen, bare i en
// ny fil.
//
// `kind` er en lukket mængde: "already" · "confirm" · "notfound". Kalderen SKAL
// dække alle tre — et manglende tilfælde er en bruger, der trykker på et link
// og intet ser ske.
import { db } from "../supabase.js";
import { loadGroupByCode, joinGroup } from "./groups.js";

// Hvad peger en konkurrence-invitationskode på?
//
//   already  — du er allerede deltager. Ingen bekræftelse; gå til stillingen.
//   confirm  — vis bekræftelsen med inviterens og ligaens navn.
//   notfound — koden findes ikke.
//
// Kaster ved netværks-/serverfejl. Kalderen skelner: en ukendt kode er brugerens
// tastefejl, en fejl er vores.
export async function resolveCompetitionInvite(token, userId, code) {
  const found = await db.select(token, "competitions", `invite_code=eq.${code}&select=*`);
  if (!found.length) return { kind: "notfound" };
  const competition = found[0];

  const already = await db.select(
    token, "competition_participants",
    `competition_id=eq.${competition.id}&user_id=eq.${userId}&select=competition_id`
  );

  if (already.length) {
    // Allerede deltager — men sikr liga-medlemskabet først. En deltager UDEN
    // liga-medlemskab er netop den halve tilstand, A8-hullet efterlod: med i
    // stillingen, men usynlig på medlemslisten og uden adgang til ligaens side.
    // At trykke på invitationslinket igen er den naturlige måde at forsøge at
    // rette det på, så det skal faktisk rette det. joinGroup er idempotent.
    if (competition.group_id) {
      try { await joinGroup(token, userId, competition.group_id); }
      catch { /* deltagelsen er intakt — bloker ikke navigationen */ }
    }
    return { kind: "already", competition };
  }

  // De to navne er PYNT på bekræftelsen og må ikke kunne vælte den: fejler
  // opslaget, vises bekræftelsen uden navnet frem for slet ikke.
  let inviterName = "";
  if (competition.created_by) {
    try {
      const prof = await db.select(token, "profiles", `id=eq.${competition.created_by}&select=display_name`);
      inviterName = prof[0]?.display_name || "";
    } catch { /* inviter-navn er valgfrit */ }
  }

  // Ligger konkurrencen i en liga, melder join én ind i BEGGE (A8) — ligaens
  // navn hentes, så bekræftelsen kan sige det højt i stedet for at gøre det bag
  // om ryggen på brugeren.
  let groupName = "";
  if (competition.group_id) {
    try {
      const g = await db.select(token, "groups", `id=eq.${competition.group_id}&select=name`);
      groupName = g[0]?.name || "";
    } catch { /* liga-navn er valgfrit */ }
  }

  return { kind: "confirm", competition, inviterName, groupName };
}

// Samme tre svar for en LIGA-invitationskode (`?liga=`).
//
// Enklere end konkurrence-vejen, fordi der ikke er en anden tilmelding at sikre
// undervejs: en liga er det yderste niveau. `already` betyder her bare "du er
// medlem" — gå til ligaens side.
export async function resolveLeagueInvite(token, userId, code) {
  const group = await loadGroupByCode(token, code);
  if (!group) return { kind: "notfound" };

  const already = await db.select(
    token, "group_members",
    `group_id=eq.${group.id}&user_id=eq.${userId}&select=user_id`
  );
  return already.length ? { kind: "already", group } : { kind: "confirm", group };
}

// Fjerner en invitations-parameter fra adresselinjen, så et genindlæst vindue
// ikke kører det samme flow igen.
//
// Bor her og ikke i MainApp, fordi de to kaldsteder ellers ville skrive den
// samme fire-linjers URL-manipulation hver for sig — og fordi `?join=` og
// `?liga=` skal behandles ens. Den rører `window` og er derfor den ene funktion
// i modulet, der ikke kan unit-testes; det er også den eneste, hvor der intet er
// at tage fejl af.
export function stripInviteParam(param) {
  const url = new URL(window.location.href);
  url.searchParams.delete(param);
  window.history.replaceState({}, "", url.toString());
}
