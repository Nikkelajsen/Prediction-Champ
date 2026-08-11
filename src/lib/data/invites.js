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
//
// ---------------------------------------------------------------------------
// A40 (10. august 2026): opslaget er ét kald, og KODEN følger med tilbage
//
// De to funktioner slog før direkte op i `competitions`/`groups` og hentede
// derefter inviterens og ligaens navn i hvert sit ekstra kald. Det kunne kun
// lade sig gøre, fordi begge tabeller var læsbare for enhver indlogget bruger —
// hullet, `A40` lukkede. `invite_lookup()` svarer nu på alt i ét kald.
//
// **`code` returneres med i `confirm`-svaret**, og det er ikke bekvemmelighed:
// tilmeldingen kræver koden, ikke et id. Uden den ville `MainApp` skulle gemme
// den ved siden af resultatet, og så er der to steder, der skal huske det
// samme.
// ---------------------------------------------------------------------------
// I7 (august 2026): modtageren skal kunne se, hvad de er inviteret til, FØR de
// opretter en konto
//
// De to funktioner ovenfor kræver begge en session, fordi de fører til en
// tilmelding. `loadInvitePreview()` nedenfor gør ikke: den henter ETIKETTEN —
// et navn og et antal — og er åben for `anon`. Det er den, login-skærmen bruger,
// og den er grunden til, at en helt ny bruger ikke længere lander på en
// generisk formular uden at vide hvorfor.
import { inviteLookup, invitePreview, acceptInvite } from "./groups.js";

// Hvad peger en konkurrence-invitationskode på?
//
//   already  — du er allerede deltager. Ingen bekræftelse; gå til stillingen.
//   confirm  — vis bekræftelsen med inviterens og ligaens navn.
//   notfound — koden findes ikke.
//
// Kaster ved netværks-/serverfejl. Kalderen skelner: en ukendt kode er brugerens
// tastefejl, en fejl er vores.
export async function resolveCompetitionInvite(token, code) {
  const svar = await inviteLookup(token, code);
  if (svar?.kind !== "competition") return { kind: "notfound" };
  const competition = svar.competition;

  if (svar.already) {
    // Allerede deltager — men medlemskabet af ligaen kan mangle. Det er den
    // halve tilstand, A8-hullet efterlod: med i stillingen, men usynlig på
    // medlemslisten og uden adgang til ligaens side. At trykke på
    // invitationslinket igen er den naturlige måde at forsøge at rette det på,
    // så det skal faktisk rette det. `acceptInvite` er idempotent og retter
    // netop dét — og den er den ENESTE, der kan: triggeren, der ellers holder
    // invarianten, fyrer kun, når der indsættes en ny deltager-række.
    try { await acceptInvite(token, code); }
    catch { /* deltagelsen er intakt — bloker ikke navigationen */ }
    return { kind: "already", competition, code };
  }

  // De to navne er PYNT på bekræftelsen. De kom før fra to ekstra opslag, der
  // hver især måtte fejle uden at vælte dialogen; nu kommer de med i selve
  // svaret, og `?? ""` er den samme tolerance — et manglende navn viser
  // bekræftelsen uden det frem for slet ikke.
  return {
    kind: "confirm",
    competition,
    inviterName: svar.inviter_name ?? "",
    groupName: svar.group_name ?? "",
    code,
  };
}

// Samme tre svar for en LIGA-invitationskode (`?liga=`).
//
// Enklere end konkurrence-vejen, fordi der ikke er en anden tilmelding at sikre
// undervejs: en liga er det yderste niveau. `already` betyder her bare "du er
// medlem" — gå til ligaens side.
export async function resolveLeagueInvite(token, code) {
  const svar = await inviteLookup(token, code);
  if (svar?.kind !== "group") return { kind: "notfound" };
  return svar.already
    ? { kind: "already", group: svar.group }
    : { kind: "confirm", group: svar.group, code };
}

// Hvad hedder det, koden peger på? Uden login (I7).
//
// Kaster ALDRIG — og det er en anden kontrakt end de to ovenfor med vilje. De
// bliver kaldt, fordi brugeren har trykket på noget, og en fejl dér skal ses.
// Denne kaldes for at pynte på login-skærmen: en fejl, en ukendt kode eller et
// langsomt net skal give den skærm, der stod der før, ikke en fejlbesked oven i
// en oprettelse. `null` er derfor et fuldgyldigt svar og ikke en undtagelse.
export async function loadInvitePreview(code) {
  try {
    const svar = await invitePreview(code);
    return svar?.kind === "group" || svar?.kind === "competition" ? svar : null;
  } catch {
    return null;
  }
}

// Previewet oversat til de to linjer, login-skærmen viser.
//
// REN FUNKTION, og det er ikke tilfældigt: testopsætningen er uden jsdom, så
// alt, der kun kan nås gennem en render, kan ikke efterprøves. Ligger ordlyden
// her frem for inde i JSX'en, er den dækket — og `AuthScreen` skal kun kunne
// tegne to strenge, den får udleveret.
//
// Samme snit som resten af modulet: her svares HVAD der skal stå, ikke hvordan
// det ser ud.
export function invitationsPitch(preview) {
  if (!preview) return null;

  const antal = Number(preview.member_count) || 0;
  // "5 spillere er allerede med" er både en oplysning og et argument. Ved nul
  // udelades den helt frem for at skrive "0 spillere er allerede med", som ville
  // være en grund til at lade være.
  const medlemmer = antal > 0
    ? `${antal} ${antal === 1 ? "spiller er" : "spillere er"} allerede med.`
    : "";

  if (preview.kind === "group" && preview.name) {
    return {
      overskrift: `Du er inviteret til ligaen "${preview.name}".`,
      detalje: `${medlemmer} Opret en konto for at være med.`.trim(),
    };
  }
  if (preview.kind === "competition" && preview.name) {
    return {
      // Ligaen nævnes, fordi man også meldes ind i DEN (`A8`) — modtageren skal
      // kunne se begge dele, de siger ja til.
      overskrift: preview.group_name
        ? `Du er inviteret til konkurrencen "${preview.name}" i ligaen "${preview.group_name}".`
        : `Du er inviteret til konkurrencen "${preview.name}".`,
      detalje: `${medlemmer} Opret en konto for at være med.`.trim(),
    };
  }
  return null;
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
