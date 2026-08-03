// Onboarding v1 — hvor langt er en ny bruger nået?
// Spec: docs/features/onboarding-v1.md.
//
// Tilstanden UDLEDES af rigtige data (har man en liga? en konkurrence? et tip?
// er man mere end én i ligaen?) frem for at blive gemt i en kolonne. To grunde:
// migreringer køres i hånden i Supabase (sql/README.md), så en ny kolonne koster
// et manuelt trin i produktion — og en udledt tilstand kan ikke drive fra
// virkeligheden. Melder en bruger sig ud af sin sidste liga, er de reelt tilbage
// ved start, og checklisten siger det af sig selv.
//
// localStorage bruges KUN til de valg, der ikke kan udledes: har brugeren
// sprunget guiden over, og har de skjult kortet. Nøglerne og de bruger-bundne
// læse/skrive-helpers bor i src/lib/localFlags.js — flagene skal bære et
// bruger-id, ellers arver den næste konto på samme telefon svarene.
import { db } from "./supabase.js";
import { loadMyGroups, createGroup, createCompetition } from "./data.js";

// ---------- den rene tilstandsmaskine ----------

// Trinnene i den rækkefølge, en ny bruger møder dem. `hint` er den ene linje,
// kortet viser under et uafsluttet trin.
//
// "Invitér en ven" er med med vilje: produktets North Star er sunde, aktive
// ligaer (produktbogen kap. 3), og en liga med ét medlem er en død liga. Et
// tip afgivet alene er ikke en gennemført onboarding.
function deriveOnboarding({ groups = [], competitions = [], hasPrediction = false } = {}) {
  const hasGroup = groups.length > 0;
  const hasCompetition = competitions.length > 0;
  // Mindst én liga skal have selskab. memberCount kommer gratis med loadMyGroups.
  const hasCompanions = groups.some((g) => (g.memberCount || 0) > 1);

  const steps = [
    {
      id: "liga",
      done: hasGroup,
      label: "Opret eller deltag i en liga",
      // En bruger med kun liga-løse konkurrencer er IKKE færdig med dette trin:
      // konkurrencen lever uden for liga-strukturen og forsvinder med sæsonen.
      hint: hasCompetition
        ? "Dine konkurrencer ligger uden for en liga. Saml dem ét sted, så historik og invite-link består."
        : "En liga er dit faste fællesskab — vennerne, kontoret, familien.",
    },
    { id: "konkurrence", done: hasCompetition, label: "Kom med i en konkurrence", hint: "Konkurrencen er det, I dyster i — en hel sæson eller bare næste weekend." },
    { id: "tip", done: hasPrediction, label: "Afgiv dit første tip", hint: "+3 for det præcise resultat, +1 for den rigtige vinder." },
    { id: "invitér", done: hasCompanions, label: "Invitér en ven", hint: "Det er først en konkurrence, når I er flere." },
  ];

  const next = steps.find((s) => !s.done);
  return {
    groups, competitions,
    hasGroup, hasCompetition, hasPrediction, hasCompanions,
    steps,
    doneCount: steps.filter((s) => s.done).length,
    nextStepId: next ? next.id : null,
    complete: !next,
  };
}

// ---------- proben ----------

// Ét let kald: findes der overhovedet ét tip? RLS lader altid en bruger læse
// sine EGNE predictions (også ulåste), så limit=1 er nok — vi skal ikke vide
// hvor mange, kun om der er nogen.
async function loadHasPrediction(token, userId) {
  const rows = await db.select(token, "predictions", `user_id=eq.${userId}&select=match_id&limit=1`);
  return rows.length > 0;
}

// Hent de signaler, deriveOnboarding ikke kan få fra MainApps egen state.
// `competitions` har MainApp allerede — den koster ingenting og sendes ind.
async function loadOnboardingSignals(token, userId) {
  const [groups, hasPrediction] = await Promise.all([
    loadMyGroups(token, userId).catch(() => []),
    loadHasPrediction(token, userId).catch(() => false),
  ]);
  return { groups, hasPrediction };
}

// ---------- navne ----------

// Ligaens navn er forudfyldt, så guidens knap kan trykkes uden at tænke.
// `profile` kan være null (App.jsx's completeAuth-catch), så fallbacken er ikke
// pynt: uden den ville feltet sige "undefineds liga".
function defaultLeagueName(displayName) {
  const n = String(displayName || "").trim();
  if (!n) return "Min liga";
  const owner = /[sxzSXZ]$/.test(n) ? `${n}'` : `${n}s`;
  const name = `${owner} liga`;
  // groups.name er begrænset til 2-40 tegn (sql/groups.sql). Et langt brugernavn
  // må ikke kunne oprette et navn, databasen afviser.
  return name.length <= 40 ? name : "Min liga";
}

// Samme grænse som check-constrainten på groups.name. Valideringen bor her, så
// den rå Postgres-fejl ikke kan lække fra et nyt kaldested — det skete for
// LigaerTab, før den fik sit eget tjek.
function validateGroupName(name) {
  const trimmed = String(name || "").trim();
  if (trimmed.length < 2) return "Ligaens navn skal være mindst 2 tegn.";
  if (trimmed.length > 40) return "Ligaens navn må højst være 40 tegn.";
  return null;
}

// ---------- turneringer, man kan starte på ----------

// Hvilke turneringer kan der overhovedet oprettes en konkurrence på — og har de
// kampe tilbage at tippe?
//
// Guiden skal kunne vælge rigtigt UDEN at gætte på navne: turneringen findes
// via data (nyeste sæson med kampe uden resultat), ikke via et regex på "Superliga".
// Uden `hasUpcoming` kunne guiden love et tip på en sæson, der er spillet
// færdig — `filterFromNextUnfinishedRound` ville da give en helt tom konkurrence.
async function loadStarterTournaments(token, leagues) {
  const ids = (leagues || []).map((l) => l.id);
  if (!ids.length) return [];

  const seasons = await db.select(token, "seasons", `league_id=in.(${ids.join(",")})&select=id,league_id&order=start_date.desc`);
  const newest = {};
  for (const s of seasons) if (!newest[s.league_id]) newest[s.league_id] = s;
  const seasonIds = Object.values(newest).map((s) => s.id);
  if (!seasonIds.length) return [];

  const rows = await db.select(token, "matches", `season_id=in.(${seasonIds.join(",")})&home_score=is.null&select=season_id`);
  const withUpcoming = new Set(rows.map((r) => r.season_id));

  return leagues
    .filter((l) => newest[l.id])
    .map((l) => ({ id: l.id, name: l.name, seasonId: newest[l.id].id, hasUpcoming: withUpcoming.has(newest[l.id].id) }));
}

// ---------- ét-tryks start ----------

// Opret liga OG den første konkurrence i den, i én handling.
//
// Begge dele på én gang, fordi en ny bruger ikke skal forstå forholdet mellem
// liga og konkurrence, FØR de har prøvet det — og fordi onboarding aldrig må
// efterlade en liga-løs konkurrence: uden liga er der ingen medlemsliste,
// intet permanent invite-link, og intet der består, når sæsonen slutter.
//
// Rækkefølgen er bindende: createGroup skriver opretteren som `admin`, og
// FØRST derefter indsættes deltager-rækken. Omvendt ville A8-triggeren
// (sql/group_membership_invariant.sql) nå at lave en `member`-række først, og
// admin-insertet ville kollidere med den.
//
// Delvis fejl rulles IKKE tilbage: lykkes ligaen men ikke konkurrencen, er en
// tom liga et brugbart resultat (den kan bruges, inviteres til og slettes af
// sin admin), mens en oprydning kunne slette noget, brugeren allerede har set.
// Kalderen får ligaen med i fejlen og kan sende brugeren derhen.
async function createStarterLeague(token, userId, { groupName, competitionName, leagueId }) {
  const group = await createGroup(token, userId, groupName);
  try {
    const seasons = await db.select(token, "seasons", `league_id=eq.${leagueId}&select=id&order=start_date.desc&limit=1`);
    const season = seasons[0];
    if (!season) throw new Error("Turneringen har ingen sæson endnu.");
    const { competition, matchCount } = await createCompetition(token, userId, {
      name: competitionName,
      groupId: group.id,
      mode: "full_season",
      tournaments: [{ leagueId, seasonId: season.id, availableStages: [], selectedStages: [] }],
    });
    return { group, competition, matchCount };
  } catch (e) {
    // Ligaen står — sig det, så brugeren ikke tror, intet skete.
    e.group = group;
    throw e;
  }
}

export {
  deriveOnboarding, loadOnboardingSignals, loadHasPrediction,
  defaultLeagueName, validateGroupName, createStarterLeague, loadStarterTournaments,
};
