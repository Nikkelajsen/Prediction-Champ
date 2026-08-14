// Liga-laget: grupper, medlemskab og ind-/udmeldelse af de konkurrencer, der
// hører til dem.

import { db, restFetch } from "../supabase.js";
import { logEvent } from "../analytics.js";
import { selectIn } from "./chunked.js";

// ---------- Liga-laget: permanente fællesskaber (grupper) ----------
// NB navngivning (docs/features/liga-laget-v1.md afsnit 2): DB-enheden `groups`
// hedder en "liga" i UI; `leagues` (fodbold) hedder en "turnering".

// Mine ligaer + medlemstal + antal konkurrencer i hver (til Ligaer-fanens kort).
//
// BEGGE TAL TÆLLES I DATABASEN, IKKE I BROWSEREN (G106, 14. august 2026).
//
// Her stod to opslag, der hentede én række pr. medlem og én pr. konkurrence på
// tværs af ALLE brugerens ligaer, kun for at tælle listerne op. PostgREST
// leverer højst 1000 rækker pr. svar og siger ikke, at den klipper, så en
// bruger, hvis ligaer tilsammen nåede loftet, ville have set for lave tal uden
// en fejl noget sted — samme tavse afkortning som "· 0 kampe" i Opret → Sæson
// (DOCUMENTATION.md §13) og som `G101` nedenfor.
//
// `G101`s kur — `db.count()` pr. konkurrence — kunne ikke kopieres hertil:
// nævneren er brugerens ligaer GANGE TO, så ti ligaer ville blive tyve
// rundture, hvor der her er to. Svaret er derfor viewet `group_counts`
// (`#62 group_counts.sql`), som aggregerer i databasen og svarer én række pr.
// liga. `security_invoker` gør, at RLS'en på `groups`, `group_members` og
// `competitions` er kalderens egen — tallene er dermed ORDRET de samme rækker,
// klienten selv talte før, og det loft, der er tilbage, er antallet af ligaer:
// nøjagtig det, `groups`-opslaget ved siden af allerede er bundet af.
async function loadMyGroups(token, userId) {
  const mem = await db.select(token, "group_members", `user_id=eq.${userId}&select=group_id,role`);
  if (!mem.length) return [];
  const ids = mem.map((m) => m.group_id);
  const roleById = new Map(mem.map((m) => [m.group_id, m.role]));
  const [groups, counts] = await Promise.all([
    db.select(token, "groups", `id=in.(${ids.join(",")})&select=*&order=created_at`),
    db.select(token, "group_counts", `group_id=in.(${ids.join(",")})&select=group_id,member_count,competition_count`),
  ]);
  const countById = new Map(counts.map((c) => [c.group_id, c]));
  return groups.map((g) => ({
    ...g, role: roleById.get(g.id),
    memberCount: countById.get(g.id)?.member_count || 0,
    compCount: countById.get(g.id)?.competition_count || 0,
  }));
}

// Fuld liga-side: gruppe, medlemmer, ligaens konkurrencer + egen deltagelse.
async function loadGroupDetail(token, userId, groupId) {
  const groups = await db.select(token, "groups", `id=eq.${groupId}&select=*`);
  if (!groups.length) return null;
  const group = groups[0];
  const members = await db.select(token, "group_members", `group_id=eq.${groupId}&select=user_id,role,joined_at&order=joined_at`);
  const ids = members.map((m) => m.user_id);
  const profiles = ids.length ? await db.select(token, "profiles", `id=in.(${ids.join(",")})&select=id,display_name`) : [];
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));
  const memberList = members.map((m) => ({ userId: m.user_id, name: nameById.get(m.user_id) || "—", role: m.role, joinedAt: m.joined_at }));
  const myRole = members.find((m) => m.user_id === userId)?.role || null;

  const comps = await db.select(token, "competitions", `group_id=eq.${groupId}&select=*&order=created_at.desc`);
  const compIds = comps.map((c) => c.id);
  // To opslag om den SAMME tabel, og de spørger om hver sit: det ene om MIG
  // (deltager jeg, og har jeg arkiveret?), det andet om ANTALLET pr.
  // konkurrence. De køres samtidig, så fan-out'en nedenfor koster én rundtur og
  // ikke to. `hidden` følger med i det første: arkivering er personlig og bor på
  // deltager-rækken, så liga-siden kan først sortere arkiverede fra, når den
  // kender flaget.
  //
  // ANTALLET TÆLLES I DATABASEN, IKKE I BROWSEREN (G101, 14. august 2026).
  //
  // Her stod ét opslag, der hentede én række pr. deltager på tværs af ALLE
  // ligaens konkurrencer og talte listen op i klienten — kun for at skrive
  // "N deltager" på hvert kort. `A43`s måling (12. august 2026) viste prisen
  // lav, 2,2 ms for en liga med otte konkurrencer, så rækken var ikke en
  // hastighedssag. Det, der gør den værd at rette, er en anden pris end tid:
  // PostgREST leverer højst 1000 rækker pr. svar og siger
  // ikke, at den klipper, så en liga, hvis deltager-rækker tilsammen når loftet,
  // ville have vist for lave tal uden en fejl nogen steder. Præcis den fælde
  // kostede "· 0 kampe" i Opret → Sæson 1. august 2026 (DOCUMENTATION.md §13),
  // og svaret er det samme som dengang: `db.count()` (`count=exact` + `limit=0`)
  // lader databasen tælle, ét opslag pr. konkurrence, kørt samtidig — samme form
  // som `countMatchesPerLeague()` i `data/createSources.js`.
  //
  // `loadMyGroups()` ovenfor tæller også i databasen siden `G106` (14. august
  // 2026), men ad en anden vej: dér er nævneren brugerens ligaer GANGE TO, så
  // den samme fan-out ville blive tyve kald for ti ligaer, og svaret blev
  // viewet `group_counts`. Fælden er den samme, kuren er det ikke — og hvilken
  // af de to der passer, afgøres af, om antallet af kald er bundet.
  const [myParts, partEntries] = await Promise.all([
    compIds.length ? db.select(token, "competition_participants", `user_id=eq.${userId}&competition_id=in.(${compIds.join(",")})&select=competition_id,hidden`) : [],
    Promise.all(compIds.map(async (id) => [id, await db.count(token, "competition_participants", `competition_id=eq.${id}`)])),
  ]);
  const joinedSet = new Set(myParts.map((p) => p.competition_id));
  const hiddenSet = new Set(myParts.filter((p) => p.hidden).map((p) => p.competition_id));
  const partCount = Object.fromEntries(partEntries);
  const competitions = comps.map((c) => ({
    ...c, joined: joinedSet.has(c.id), hidden: hiddenSet.has(c.id), participantCount: partCount[c.id] || 0,
  }));

  return { group, members: memberList, isMember: myRole !== null, myRole, competitions };
}

// Arkivér/gendan for MIG. Flaget bor på min egen deltager-række, så det aldrig
// kan komme til at gælde for andre — arkivering er en oprydning i eget billede,
// ikke en handling mod fællesskabet.
async function setCompetitionHidden(token, userId, compId, hidden) {
  await db.update(token, "competition_participants", `competition_id=eq.${compId}&user_id=eq.${userId}`, { hidden });
}

// Ligaens konkurrence-deltagere med ét felt mere, end listen af navne: har
// vedkommende overhovedet tippet i konkurrencen?
//
// Det felt er hele grunden til, at loaderen findes. Liga-admin må kun fjerne den
// URØRTE deltager (sql/liga_admin.sql), og uden `tipped` ville UI'et enten
// tilbyde en handling, RLS afviser, eller skjule den for nogen, der godt kunne
// fjernes. Spørgsmålet stilles pr. DELTAGER og ikke pr. kamp: tips er globale,
// så "kampen er tippet" siger intet om, hvem der er med her.
async function loadCompetitionParticipants(token, compId) {
  const parts = await db.select(token, "competition_participants", `competition_id=eq.${compId}&select=user_id`);
  if (!parts.length) return [];
  const ids = parts.map((p) => p.user_id);
  const [profiles, links] = await Promise.all([
    db.select(token, "profiles", `id=in.(${ids.join(",")})&select=id,display_name`),
    db.select(token, "competition_matches", `competition_id=eq.${compId}&select=match_id`),
  ]);
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));
  const matchIds = links.map((l) => l.match_id);
  const preds = matchIds.length
    ? await selectIn(token, "predictions", "match_id", matchIds, `&user_id=in.(${ids.join(",")})&select=user_id`)
    : [];
  const tippers = new Set(preds.map((p) => p.user_id));
  return parts.map((p) => ({ userId: p.user_id, name: nameById.get(p.user_id) || "—", tipped: tippers.has(p.user_id) }));
}

// Liga-admin fjerner en deltager. RLS afgør, om det er tilladt (kun en deltager
// uden ét eneste tip), så et afvist forsøg kommer tilbage som nul rækker og ikke
// som en fejl — samme mønster som `leaveCompetition` og `leaveGroup`.
async function removeParticipant(token, compId, userId) {
  const res = await db.del(token, "competition_participants", `competition_id=eq.${compId}&user_id=eq.${userId}`);
  return Array.isArray(res) ? res.length > 0 : true;
}

// Slet en konkurrence. To policies kan give lov: opretteren altid, liga-admin
// kun hvis ingen af deltagerne har tippet. Klienten kender ikke forskellen og
// skal ikke gøre det — den spørger, og RLS svarer.
async function deleteCompetition(token, compId) {
  const res = await db.del(token, "competitions", `id=eq.${compId}`);
  return Array.isArray(res) ? res.length > 0 : true;
}

// Hvad peger en invitationskode på? (A40)
//
// Var indtil 10. august 2026 et almindeligt tabelopslag —
// `groups?invite_code=eq.<kode>` — og det kunne kun lade sig gøre, fordi HVER
// liga var læsbar for hver eneste indlogget bruger. Prisen var, at koderne
// kunne høstes af enhver, og at et liga-id var nok til at melde sig ind.
//
// Opslaget bor nu i `invite_lookup()`, som er `security definer` og derfor kan
// se den ene liga, koden peger på, uden at tabellen er åben. Den svarer på
// BEGGE slags koder i ét kald og bærer ligaens og inviterens navn med, så
// bekræftelsen ikke skal hente dem hver for sig.
//
// **Den skriver intet.** Tilmeldingen er `acceptInvite()` nedenfor.
async function inviteLookup(token, code) {
  return restFetch(`/rest/v1/rpc/invite_lookup`, {
    method: "POST", token, body: { p_code: String(code || "").trim() },
  });
}

// Invitationens ETIKET — uden login (I7).
//
// Søskende til `inviteLookup()` ovenfor, og forskellen er hele pointen:
// `invite_lookup()` svarer med id'er og fører til en tilmelding, og kræver
// derfor en session. `invite_preview()` svarer kun med et NAVN og et ANTAL og er
// åben for `anon` — så modtageren af et link kan se, hvad de er inviteret til,
// FØR de opretter en konto. Afvejningen mod `A40` står i `sql/invite_preview.sql`.
//
// **Ingen token**, og det er ikke en forglemmelse: kaldet sker på login-skærmen.
// `restFetch` falder allerede tilbage til anon-nøglen som bearer, så der er
// ingen ny kaldevej at bygge.
async function invitePreview(code) {
  return restFetch(`/rest/v1/rpc/invite_preview`, {
    method: "POST", body: { p_code: String(code || "").trim() },
  });
}

// Veksl koden til adgang (A40) — den eneste vej ind i en liga eller konkurrence,
// man ikke i forvejen er med i.
//
// Melder ind i BEGGE, når koden peger på en konkurrence i en liga; det er
// `A8`-reglen, og den bor nu ét sted frem for i hvert kaldssted. Idempotent:
// `joined` siger, om der faktisk skete noget, så en hændelse ikke logges to
// gange, når nogen trykker på linket igen.
async function acceptInvite(token, code) {
  return restFetch(`/rest/v1/rpc/accept_invite`, {
    method: "POST", token, body: { p_code: String(code || "").trim() },
  });
}

// Opret liga: gruppen + opretteren som admin-medlem — i ÉT kald (G95).
//
// Stod indtil 12. august 2026 som to `db.insert` efter hinanden, og to
// PostgREST-kald er to transaktioner. Fejlede det andet — netværk, RLS, en
// lukket fane — stod ligaen tilbage UDEN medlemmer: usynlig i enhver oversigt
// (`loadMyGroups` læser `group_members`), umulig at forlade og umulig at slette
// gennem UI'et. Nul forekomster i produktion, men vinduet lukkede ikke af sig
// selv.
//
// `create_group()` er `security definer` og skriver begge rækker i samme
// statement, så en fejl undervejs ruller dem begge tilbage. Den tager ÉT
// argument: hvem opretteren er, afgør databasen med `auth.uid()`, og det er
// derfor `userId` ikke længere er en parameter — samme bevægelse som
// `acceptInvite()` gjorde med `A40`.
//
// Svaret er hele `groups`-rækken, `invite_code` inklusive, altså præcis det
// klienten fik af PostgREST før.
async function createGroup(token, name) {
  const g = await restFetch(`/rest/v1/rpc/create_group`, {
    method: "POST", token, body: { p_name: String(name || "").trim() },
  });
  logEvent(token, "league_created", { groupId: g.id });
  return g;
}

// *(`joinGroup(token, userId, groupId)` stod her indtil 10. august 2026 og er
// væk med `A40`. Den meldte ind på et liga-ID alene, og dét var præcis hullet:
// policyen krævede kun `user_id = auth.uid()`, så ethvert id var nok. Vejen ind
// går nu gennem `acceptInvite()`, som kræver koden — og `group_members`'
// insert-policy tillader kun opretterens egen admin-række.)*

// Forlad en liga (fjern egen medlemsrække). RLS blokerer, hvis man stadig deltager
// i en af ligaens konkurrencer — ellers ville man stå tilbage som deltager uden
// liga-medlemskab, den forældreløse tilstand invarianten forbyder
// (sql/group_membership_invariant.sql). Returnerer false ved blokering, så UI kan
// forklare hvorfor, i stedet for tavst at navigere brugeren væk fra en liga, de
// stadig er medlem af. Samme mønster som leaveCompetition.
async function leaveGroup(token, userId, groupId) {
  const res = await db.del(token, "group_members", `group_id=eq.${groupId}&user_id=eq.${userId}`);
  return Array.isArray(res) ? res.length > 0 : true;
}

// Slet en liga (RLS: kun admin, og kun hvis ingen af ligaens konkurrencer er
// AKTIVE — sql/liga_admin.sql). Konkurrencerne følger ikke med: `group_id` er
// `on delete set null`, så de bliver liga-løse med stilling og tips i behold.
// Returnerer true hvis slettet.
async function deleteGroup(token, groupId) {
  const res = await db.del(token, "groups", `id=eq.${groupId}`);
  return Array.isArray(res) ? res.length > 0 : true;
}

// Deltag i en konkurrence (tilmelding pr. konkurrence).
// Deltag i en konkurrence. Hører den til en liga, meldes man samtidig ind i ligaen
// (A8: ingen gæste-deltagelse) — liga-medlemskabet FØRST, så en fejl undervejs ikke
// efterlader en deltager uden liga: usynlig på medlemslisten og uden adgang til
// ligaens side. `joinGroup` er idempotent, så det er gratis at kalde for et
// eksisterende medlem (fx når man melder sig til fra liga-siden).
//
// Reglen bor HER, fordi de to veje ind i en konkurrence — deep-link (?join=) og
// indsat invitationskode — havde hver sin kopi, og kun den ene huskede ligaen
// (A7, juli 2026).
// "Deltag"-knappen på ligasiden: et medlem melder sig til en af ligaens
// konkurrencer. Den ENE tilmelding, der ikke går gennem en invitationskode — og
// den er tilladt, fordi RLS kræver, at man i forvejen er medlem af ligaen
// (eller har oprettet konkurrencen).
//
// Kaldet til `joinGroup` er væk med `A40`: denne sti bruges kun af en, der
// allerede ER medlem, og for en liga-løs konkurrence sørger triggeren
// `ensure_group_membership_for_participant` for resten. `groupId` bliver stående
// som parameter, fordi hændelsen bæres videre med den.
async function joinCompetition(token, userId, compId, groupId = null) {
  await db.insert(token, "competition_participants", [{ competition_id: compId, user_id: userId }]);
  logEvent(token, "competition_joined", { competitionId: compId, groupId });
}

// Framelding: slet egen deltager-række. RLS blokerer, hvis man har tips på låste
// kampe (returnerer da ingen rækker) — vi returnerer false, så UI kan forklare hvorfor.
async function leaveCompetition(token, userId, compId) {
  const res = await db.del(token, "competition_participants", `competition_id=eq.${compId}&user_id=eq.${userId}`);
  return Array.isArray(res) ? res.length > 0 : true;
}

export {
  loadMyGroups, loadGroupDetail, inviteLookup, invitePreview, acceptInvite, createGroup, leaveGroup, deleteGroup,
  joinCompetition, leaveCompetition, setCompetitionHidden, loadCompetitionParticipants,
  removeParticipant, deleteCompetition,
};
