// App-skallen: navigation mellem de fem faner og drill-in-skærmene, plus den
// fælles indlæsning af ligaer og konkurrencer, alle faner bygger på.
import { useState, useEffect, useMemo, useRef, lazy, Suspense } from "react";
import { Home, ClipboardList, Users, Trophy, TrendingUp, Loader2, LogOut, Info, Settings, X, User } from "lucide-react";
import { db } from "../lib/supabase.js";
import { joinGroup, joinCompetition, resolveCompetitionInvite, resolveLeagueInvite, stripInviteParam } from "../lib/data.js";
import { logEvent } from "../lib/analytics.js";
import { deriveOnboarding, loadOnboardingSignals } from "../lib/onboarding.js";
import { readUserFlag, writeUserFlag, COMPLETE_KEY, FLOW_KEY, PWA_ONBOARDED_KEY } from "../lib/localFlags.js";
import { C, btnGhost, btnGreen, font, iconBtn, muted, phone, wrapOuter } from "../ui/theme.js";
import { Modal } from "../ui/components.jsx";
import { Wordmark } from "../ui/Wordmark.jsx";
import { ErrorBoundary, ScreenFallback } from "../ui/ErrorBoundary.jsx";
import { setTelemetryScreen } from "../lib/telemetry.js";
import HjemTab from "./HjemTab.jsx";
import LigaerTab from "./LigaerTab.jsx";
import GroupScreen from "./GroupScreen.jsx";
import ChampionshipTab from "./ChampionshipTab.jsx";
import RatingTab from "./RatingTab.jsx";
import BoardScreen from "./BoardScreen.jsx";
import PredictionsScreen from "./PredictionsScreen.jsx";
import CreateCompetitionScreen from "./CreateCompetitionScreen.jsx";
import ProfileScreen from "./ProfileScreen.jsx";
import HowItWorksScreen from "./HowItWorksScreen.jsx";
import LegalScreen from "./LegalScreen.jsx";
import OnboardingFlow from "./OnboardingFlow.jsx";
import InstallGuide, { isStandalone } from "./InstallGuide.jsx";

// Admin hentes FØRST når den åbnes (G34, august 2026).
//
// Den er kun relevant for én bruger, men lå i den samme chunk som alt andet —
// så hver eneste førstegangsbruger hentede admin-fladen, Analytics-dashboardet
// og deres tabeller, før den første skærm kunne tegnes. `React.lazy` om netop
// dette træ er den største enkeltgevinst, der ikke kræver, at noget deles op.
//
// Kun Admin er delt ud, ikke fanerne: de fem faner er dét, appen ER, og at
// hente dem enkeltvis ville bytte én ventetid ud med fem.
const AdminScreen = lazy(() => import("./AdminScreen.jsx"));

function MainApp({ session, profile, onProfileChanged, onLogout, pendingJoinCode, clearPendingJoinCode, pendingLigaCode, clearPendingLigaCode }) {
  const token = session.access_token;
  const userId = session.user.id;
  const isAdmin = !!profile?.is_admin;

  const [tab, setTab] = useState("hjem");
  const [screen, setScreen] = useState(null); // null | {type, ...params}
  // Hvor står brugeren? Bruges kun af fejltelemetrien (G42): en fejlrapport
  // uden skærmnavn kræver, at nogen gætter ud fra stakken, og en minificeret
  // stak er netop det, der er svært at læse. `tab:screen` er samme nøgle, som
  // nulstiller error boundaryen længere nede — den beskriver dermed præcis det
  // sted, en fejl hører til.
  useEffect(() => { setTelemetryScreen(`${tab}:${screen?.type ?? ""}`); }, [tab, screen?.type]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(""); // fejl fra opstarts-indlæsningen (G23)
  const [leagues, setLeagues] = useState([]);
  const [competitions, setCompetitions] = useState([]);
  const [joinError, setJoinError] = useState(""); // fejl fra invite-join-deeplink (?join=kode)
  const [pendingJoin, setPendingJoin] = useState(null); // { competition, inviterName } — bekræftelse før join
  const [pendingGroupJoin, setPendingGroupJoin] = useState(null); // { group } — bekræftelse før liga-join
  const [showInstall, setShowInstall] = useState(false); // "føj til hjemmeskærm"-vejledning (efter første tip)
  // Onboarding-tilstand. `null` betyder "skal ikke bruges" — enten fordi den
  // endnu ikke er hentet, eller fordi brugeren for længst er færdig (se nedenfor).
  const [onboarding, setOnboarding] = useState(null);
  // Tilstanden bor HER og ikke i HjemTab, fordi tre ting skal bruge den: kortet
  // på Hjem, gaten for det guidede flow og gaten for installations-modalen.
  // Er brugeren først færdig, huskes det lokalt, og proben køres aldrig igen —
  // så en etableret bruger betaler ingen ekstra netværkskald ved hver opstart.
  //
  // Flaget er bundet til BRUGEREN og ikke til enheden (src/lib/localFlags.js).
  // Var det ikke det, ville en ny konto på en brugt telefon arve "færdig" fra
  // den forrige, proben blev sprunget over, `onboarding` blev stående som
  // `null` — og så udeblev BÅDE guiden og checklisten. Resultatet var en
  // Hjem-skærm med kun brugerens eget navn på og ingen vej videre.
  const onboardingDone = useRef(readUserFlag(COMPLETE_KEY, userId) === "1");
  const [showFlow, setShowFlow] = useState(false);
  const flowOpened = useRef(false); // guiden åbner højst én gang pr. session

  // `comps` sendes med fra kalderen, når konkurrencerne lige er hentet: state er
  // endnu ikke opdateret på det tidspunkt, og en forældet liste ville få
  // checklisten til at hakke ét trin bagud.
  async function refreshOnboarding(comps) {
    if (onboardingDone.current) return;
    try {
      const signals = await loadOnboardingSignals(token, userId);
      const state = deriveOnboarding({ ...signals, competitions: comps || competitions });
      if (state.complete) { onboardingDone.current = true; writeUserFlag(COMPLETE_KEY, userId, "1"); }
      setOnboarding(state);
    } catch { /* onboarding må aldrig blokere appen — kortet udebliver bare */ }
  }

  async function loadLeagues() {
    const ls = await db.select(token, "leagues", "select=*&order=name");
    setLeagues(ls);
    return ls;
  }

  async function loadCompetitions() {
    const myComps = await db.select(token, "competition_participants", `user_id=eq.${userId}&select=competition_id,hidden`);
    if (myComps.length) {
      const hiddenMap = Object.fromEntries(myComps.map((c) => [c.competition_id, !!c.hidden]));
      const ids = myComps.map((c) => c.competition_id).join(",");
      const comps = await db.select(token, "competitions", `id=in.(${ids})&select=*`);
      // Arkivering (`hidden`) gælder ALLE konkurrencer, man deltager i — også dem
      // i en liga (august 2026).
      //
      // Her stod `c.group_id ? false : …`, som tvang flaget til falsk for enhver
      // liga-konkurrence. Begrundelsen var reel, men midlertidig: et forældet
      // flag (sat mens konkurrencen var liga-løs og siden flyttet ind i en liga)
      // kunne skjule den på Hjem/Tip, mens liga-siden stadig viste den som "Med"
      // — og brugeren havde ingen Gendan-knap at rette det med, fordi liga-siden
      // ikke havde nogen. Nu har den det, og dermed er der ikke længere en
      // tilstand, man ikke kan komme ud af.
      //
      // Arkivér og Frameld er to forskellige ting, og det er derfor begge findes:
      // arkivering rydder MIN visning og lader stillingen stå, framelding fjerner
      // mig fra konkurrencen. Kun den første kan fortrydes.
      const merged = comps.map((c) => ({ ...c, _hidden: hiddenMap[c.id] || false }));
      setCompetitions(merged);
      return merged;
    }
    setCompetitions([]);
    return [];
  }

  // G23: uden try/catch her låste ét fejlet kald hele appen i "Henter data …" —
  // det er root-loaderen, så der er ingen anden skærm at komme videre til, og med
  // G20's manglende boundary var der heller intet, der kunne fange det.
  //
  // refreshOnboarding ligger UDEN FOR try'en med vilje: den har sin egen catch
  // (den må aldrig blokere appen), og en fejlende onboarding-probe skal ikke
  // kunne fejlmelde en opstart, hvor ligaer og konkurrencer kom fint ind.
  async function loadAll() {
    setLoading(true);
    setLoadError("");
    let comps;
    try {
      await loadLeagues();
      comps = await loadCompetitions();
    } catch {
      setLoadError("Kunne ikke hente dine data lige nu. Tjek forbindelsen og prøv igen.");
      return;
    } finally {
      setLoading(false);
    }
    await refreshOnboarding(comps);
  }

  useEffect(() => { loadAll(); }, []); // eslint-disable-line

  // Guiden åbnes for en bruger, der hverken har en liga eller en konkurrence.
  //
  // Gaten hænger på `hasCompetition` og ikke kun på deep-link-state: en inviteret
  // bruger kan INDSÆTTE en kode i stedet for at klikke et link, og ville ellers
  // ryge i selvstarter-flowet. Effekten gen-evalueres (frem for kun at køre ved
  // mount), fordi pendingJoinCode ryddes asynkront — var koden ugyldig, sættes
  // joinError, brugeren lukker banneret, og FØRST derefter åbner guiden. Så er
  // de også reelt en kold selvstarter.
  useEffect(() => {
    if (flowOpened.current || loading) return;
    if (readUserFlag(FLOW_KEY, userId)) return;
    if (pendingJoinCode || pendingLigaCode || pendingJoin || pendingGroupJoin || joinError) return;
    if (!onboarding || onboarding.hasCompetition || onboarding.hasGroup) return;
    flowOpened.current = true;
    setShowFlow(true);
  }, [loading, onboarding, pendingJoinCode, pendingLigaCode, pendingJoin, pendingGroupJoin, joinError, userId]);

  function closeFlow(mark) {
    writeUserFlag(FLOW_KEY, userId, mark);
    setShowFlow(false);
  }

  // Guiden endte i en invitation — samme landing som deep-link-vejen giver.
  async function onFlowJoined(res) {
    const comps = await loadCompetitions();
    await refreshOnboarding(comps);
    closeFlow("done");
    setTab("ligaer");
    if (res.kind === "group") setScreen({ type: "group", groupId: res.group.id });
    else setScreen({ type: "predictions", compFilter: res.competition.id });
  }

  // Guiden oprettede liga (og som regel en konkurrence). Er der kampe at tippe,
  // landes der direkte på Tip — ellers på ligaens side, hvor der faktisk er
  // noget at gøre. Vi lover aldrig et tip, der ikke findes.
  async function onFlowCreated({ group, competition, matchCount }) {
    const comps = await loadCompetitions();
    await refreshOnboarding(comps);
    closeFlow("done");
    setTab("hjem");
    if (competition && matchCount > 0) setScreen({ type: "predictions", compFilter: competition.id });
    else setScreen({ type: "group", groupId: group.id });
  }

  // "Føj til hjemmeskærm" vises FØRST, når brugeren har afgivet sit første tip.
  // Før lå den som det allerførste, en ny bruger mødte — en installations-
  // opfordring til en app, de endnu ikke vidste hvad var. Nu rammer den, når de
  // har en grund til at beholde den. Modalen må aldrig lægge sig oven på det
  // guidede flow eller en invitations-bekræftelse.
  useEffect(() => {
    if (readUserFlag(PWA_ONBOARDED_KEY, userId)) return;
    if (isStandalone()) return;
    if (pendingJoinCode || pendingLigaCode || pendingJoin || pendingGroupJoin || showFlow) return;
    // onboardingDone: en etableret bruger (som aldrig prober) har for længst tippet.
    if (!onboarding?.hasPrediction && !onboardingDone.current) return;
    setShowInstall(true);
  }, [onboarding, pendingJoinCode, pendingLigaCode, pendingJoin, pendingGroupJoin, showFlow, userId]);
  function dismissInstall() {
    writeUserFlag(PWA_ONBOARDED_KEY, userId, "1");
    setShowInstall(false);
  }

  // Selve opslaget bor i src/lib/data/invites.js (G1) og svarer HVAD koden peger
  // på; her oversættes svaret til navigation. Snittet er valgt, så `A23` (router)
  // kun skal røre denne halvdel — og så flowene kan unit-testes, hvilket var
  // netop den omkostning, `A23` stod og bar.
  useEffect(() => {
    if (!pendingJoinCode) return;
    (async () => {
      setJoinError("");
      try {
        const res = await resolveCompetitionInvite(token, userId, pendingJoinCode);
        if (res.kind === "already") {
          await loadCompetitions();
          setTab("ligaer");
          setScreen({ type: "board", compId: res.competition.id });
        } else if (res.kind === "confirm") {
          setPendingJoin(res);
        } else {
          setJoinError("Ingen konkurrence fundet med invitationskoden — tjek linket, eller bed opretteren om et nyt.");
        }
      } catch {
        setJoinError("Kunne ikke tilmelde dig konkurrencen lige nu. Prøv igen om lidt.");
      }
      clearPendingJoinCode();
      stripInviteParam("join");
    })();
  }, [pendingJoinCode]); // eslint-disable-line

  // Liga-invite via deep-link (?liga=kode): bekræft før join (samme mønster som ?join=).
  useEffect(() => {
    if (!pendingLigaCode) return;
    (async () => {
      setJoinError("");
      try {
        const res = await resolveLeagueInvite(token, userId, pendingLigaCode);
        if (res.kind === "already") { setTab("ligaer"); setScreen({ type: "group", groupId: res.group.id }); }
        else if (res.kind === "confirm") setPendingGroupJoin(res);
        else setJoinError("Ingen liga fundet med invitationskoden — tjek linket, eller bed opretteren om et nyt.");
      } catch {
        setJoinError("Kunne ikke tilmelde dig ligaen lige nu. Prøv igen om lidt.");
      }
      clearPendingLigaCode();
      stripInviteParam("liga");
    })();
  }, [pendingLigaCode]); // eslint-disable-line

  async function confirmGroupJoin() {
    if (!pendingGroupJoin) return;
    const g = pendingGroupJoin.group;
    try {
      await joinGroup(token, userId, g.id);
      logEvent(token, "league_invite_accepted", { groupId: g.id, metadata: { via: "link" } });
      await refreshOnboarding();
      setPendingGroupJoin(null);
      setTab("ligaer");
      setScreen({ type: "group", groupId: g.id });
    } catch {
      setPendingGroupJoin(null);
      setJoinError("Kunne ikke tilmelde dig ligaen lige nu. Prøv igen om lidt.");
    }
  }

  async function confirmJoin() {
    if (!pendingJoin) return;
    const comp = pendingJoin.competition;
    try {
      // A8: ligger konkurrencen i en liga, melder join én ind i BEGGE. Reglen bor
      // i joinCompetition, så denne sti og LigaerTabs indsatte-kode-sti ikke kan
      // divergere igen (det var netop, hvad der var sket — se A7).
      await joinCompetition(token, userId, comp.id, comp.group_id);
      const comps = await loadCompetitions();
      await refreshOnboarding(comps);
      setPendingJoin(null);
      setTab("ligaer");
      setScreen({ type: "predictions", compFilter: comp.id });
    } catch {
      setPendingJoin(null);
      setJoinError("Kunne ikke tilmelde dig konkurrencen lige nu. Prøv igen om lidt.");
    }
  }

  // De to filtrerede lister er `useMemo` og ikke bare `filter` (G33).
  //
  // Grunden er ikke selve filtreringen — den koster ingenting på 10 rækker — men
  // at listerne sendes ned i fire skærmes AFHÆNGIGHEDSLISTER. Et nyt array-objekt
  // ved hver render invaliderer deres effekter, så HjemTab hentede sine seks kald
  // pr. konkurrence forfra, hver gang MainApp gentegnede af en helt anden grund
  // (et lukket join-banner, en opdateret onboarding-tilstand). Belastningen voksede
  // dermed lineært med antallet af konkurrencer — netop for de mest aktive brugere.
  // Minut-intervallet i HjemTab blev rykket ned og startet forfra ved samme
  // lejlighed, så "hvert minut" i praksis var "oftere".
  const visibleLeagues = useMemo(() => leagues.filter((l) => l.is_visible !== false), [leagues]);
  const visibleCompetitions = useMemo(() => competitions.filter((c) => !c._hidden), [competitions]);

  // Ny skærm ⇒ start øverst (G30).
  //
  // Uden dette arvede en ny skærm den forriges scroll-position — der er kun ÉN
  // scroll-container i hele appen, og navigation er `useState` og ikke ruter
  // (`A23`), så browserens egen scroll-gendannelse har intet at arbejde med.
  // Åbnede man en konkurrence fra bunden af Hjem, startede stillingen langt nede
  // i sit eget indhold og så tom eller forkert ud, indtil man selv scrollede op.
  //
  // Accepteret pris: at gå TILBAGE til en fane starter også øverst. At huske
  // positionen ville kræve, at indholdet havde samme højde ved tilbagekomsten,
  // og det har det ikke — skærmene henter asynkront, så en gendannet position
  // ville lande et vilkårligt sted. Øverst er det ene sted, der altid er rigtigt.
  const scrollRef = useRef(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [tab, screen]);

  // navigations-hjælpere
  // At vende tilbage til Hjem er præcis det øjeblik, hvor et netop afgivet tip
  // skal kunne ses på checklisten — derfor gen-hentes tilstanden dér, og kun
  // så længe onboardingen er uafsluttet.
  // Navigation logges HER, ét sted, i stedet for i hver fane/skærm for sig —
  // goTab/open* er allerede den entydige indgang til enhver navigation.
  const goTab = (t) => {
    setScreen(null); setTab(t);
    if (t === "hjem") logEvent(token, "opened_home");
    else if (t === "tip") logEvent(token, "opened_tip", { metadata: { view: "all" } });
    else if (t === "ligaer") logEvent(token, "opened_league", { metadata: { view: "list" } });
    else if (t === "championship") logEvent(token, "opened_championship");
    else if (t === "rating") logEvent(token, "opened_rating");
    if (t === "hjem" && !onboardingDone.current) refreshOnboarding();
  };
  const openBoard = (compId) => {
    const comp = competitions.find((c) => c.id === compId);
    logEvent(token, "opened_standings", { competitionId: compId, groupId: comp?.group_id || null });
    logEvent(token, "competition_opened", { competitionId: compId, groupId: comp?.group_id || null });
    setScreen({ type: "board", compId });
  };
  const openPredictions = (compFilter = "all", roundKey = null) => {
    const comp = compFilter !== "all" ? competitions.find((c) => c.id === compFilter) : null;
    logEvent(token, "opened_tip", { competitionId: comp?.id || null, groupId: comp?.group_id || null, metadata: { round_key: roundKey } });
    if (comp) logEvent(token, "competition_opened", { competitionId: comp.id, groupId: comp.group_id || null });
    setScreen({ type: "predictions", compFilter, roundKey });
  };
  const openCreate = (groupId = null) => setScreen({ type: "create", groupId });
  const openGroup = (groupId) => {
    logEvent(token, "opened_league", { groupId, metadata: { view: "detail" } });
    setScreen({ type: "group", groupId });
  };
  const openProfile = (profileUserId) => {
    logEvent(token, "opened_career", { metadata: { own: profileUserId === userId } });
    setScreen({ type: "profile", profileUserId });
  };
  const openAdmin = () => setScreen({ type: "admin" });
  const openHow = () => setScreen({ type: "how" });
  const openLegal = (doc = "privatliv") => setScreen({ type: "legal", doc });

  const tabs = [
    { id: "hjem", label: "Hjem", icon: Home },
    { id: "tip", label: "Tip", icon: ClipboardList },
    { id: "ligaer", label: "Ligaer", icon: Users },
    { id: "championship", label: "Championship", icon: Trophy },
    { id: "rating", label: "Rating", icon: TrendingUp },
  ];

  let body;
  if (loading) {
    body = (
      <div style={{ display: "flex", gap: 10, color: C.muted, alignItems: "center", paddingTop: 40 }}>
        <Loader2 className="spin" size={20} />Henter data …
      </div>
    );
  } else if (loadError) {
    // App-skallen (header og bundnavigation) bliver stående: fejlen er i dataene,
    // ikke i appen, og en bruger, der kan se sin egen app, forstår "prøv igen"
    // anderledes end en, der ser en tom side.
    body = (
      <div style={{ paddingTop: 40 }}>
        <p style={{ color: C.red, fontSize: 14, lineHeight: 1.6, margin: "0 0 14px" }}>{loadError}</p>
        <button type="button" style={btnGhost} onClick={loadAll}>Prøv igen</button>
      </div>
    );
  } else if (screen?.type === "board") {
    body = <BoardScreen token={token} userId={userId} competitions={visibleCompetitions}
      initialCompId={screen.compId} inviterName={profile?.display_name} onBack={() => setScreen(null)}
      goToPredictions={openPredictions} openProfile={openProfile} onCreate={openCreate} goTab={goTab} />;
  } else if (screen?.type === "predictions") {
    body = <PredictionsScreen token={token} userId={userId} competitions={visibleCompetitions}
      leagues={visibleLeagues} initialFilter={screen.compFilter} initialRoundKey={screen.roundKey}
      onBack={() => setScreen(null)} openProfile={openProfile} onCreate={openCreate} goTab={goTab} />;
  } else if (screen?.type === "group") {
    body = <GroupScreen token={token} userId={userId} groupId={screen.groupId}
      myCompetitions={competitions} onBack={() => setScreen(null)} openBoard={openBoard}
      openCreate={openCreate} reloadGroups={async () => { await loadCompetitions(); }} openProfile={openProfile} />;
  } else if (screen?.type === "create") {
    body = <CreateCompetitionScreen token={token} userId={userId} leagues={visibleLeagues}
      initialGroupId={screen.groupId} onBack={() => setScreen(null)}
      onCreated={async () => { await loadCompetitions(); }} openBoard={openBoard} />;
  } else if (screen?.type === "admin") {
    body = (
      // Samme spinder som opstarts-indlæsningen, så en ventetid ser ens ud,
      // uanset hvad der hentes.
      <Suspense fallback={
        <div style={{ display: "flex", gap: 10, color: C.muted, alignItems: "center", paddingTop: 40 }}>
          <Loader2 className="spin" size={20} />Henter admin …
        </div>
      }>
        <AdminScreen token={token} leagues={leagues} reloadLeagues={loadLeagues} onBack={() => setScreen(null)} />
      </Suspense>
    );
  } else if (screen?.type === "profile") {
    body = <ProfileScreen token={token} viewerUserId={userId} profileUserId={screen.profileUserId}
      onBack={() => setScreen(null)} openProfile={openProfile} onProfileChanged={onProfileChanged} />;
  } else if (screen?.type === "how") {
    body = <HowItWorksScreen onBack={() => setScreen(null)} token={token} openLegal={openLegal} />;
  } else if (screen?.type === "legal") {
    // Tilbage fører til "Sådan virker det" og ikke til `null` som de øvrige
    // grene: man kom DERFRA, og der findes ingen fane at lande på. Uden det
    // ville et tryk på tilbage smide brugeren ud på Hjem.
    body = <LegalScreen doc={screen.doc} onBack={() => setScreen({ type: "how" })}
      token={token} onLogout={onLogout} />;
  } else if (tab === "hjem") {
    body = <HjemTab token={token} userId={userId} profile={profile} competitions={visibleCompetitions}
      goTab={goTab} openPredictions={openPredictions} openBoard={openBoard} openGroup={openGroup} openProfile={openProfile}
      onboarding={onboarding} />;
  } else if (tab === "tip") {
    body = <PredictionsScreen token={token} userId={userId} competitions={visibleCompetitions}
      leagues={visibleLeagues} initialFilter="all" openProfile={openProfile} onCreate={openCreate} goTab={goTab} />;
  } else if (tab === "ligaer") {
    body = <LigaerTab token={token} userId={userId} competitions={competitions}
      openBoard={openBoard} openCreate={openCreate} openGroup={openGroup} reload={loadAll} openProfile={openProfile} />;
  } else if (tab === "championship") {
    body = <ChampionshipTab token={token} userId={userId} leagues={visibleLeagues} openProfile={openProfile} />;
  } else if (tab === "rating") {
    body = <RatingTab token={token} userId={userId} openProfile={openProfile} openPredictions={openPredictions} hasCompetitions={competitions.length > 0} leagues={visibleLeagues} />;
  }

  return (
    <div style={wrapOuter}>
      <div style={phone}>
        {/* Top brand bar
            Den øverste inset er ikke valgfri, når index.html har både
            viewport-fit=cover og apple-mobile-web-app-status-bar-style=
            black-translucent: uret og batteriet tegnes da OVEN PÅ appen, og
            uden pladsen ville brandbaren ligge under dem (G29). */}
        <div style={{
          padding: "14px 18px 10px", display: "flex", alignItems: "center", gap: 8,
          borderBottom: `1px solid ${C.line}`,
          paddingTop: "calc(14px + env(safe-area-inset-top, 0px))",
        }}>
          {/* 20 og ikke 15: bredden er ikke det, der binder — på en 320 px skærm
              med admin-knappen fylder mærket 98 px og knapperne 107, så der er
              stadig ~80 px luft. Det, der binder, er hierarkiet: sidens egen
              overskrift er 30 (`H` i HjemTab), og mærket skal blive ved med at
              være chrome frem for indhold. Over ~22 vejer "LEAGLY" lige så tungt
              som "HEJ <navn>", og så konkurrerer brandbaren med siden.
              Ikonerne følger med fra 18 til 20 — ellers ser højresiden krympet
              ud ved siden af et større mærke. Log ud står 1 px under de andre
              som før: glyffen fylder mere af sit felt. */}
          <Wordmark size={20} />
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => openProfile(userId)} aria-label="Min karriereprofil" style={iconBtn}><User size={20} /></button>
            <button onClick={openHow} aria-label="Sådan virker det" style={iconBtn}><Info size={20} /></button>
            {isAdmin && <button onClick={openAdmin} aria-label="Admin" style={iconBtn}><Settings size={20} /></button>}
            <button onClick={onLogout} aria-label="Log ud" style={iconBtn}><LogOut size={19} /></button>
          </div>
        </div>

        {/* Content
            Bundpolstringen skal vokse med den samme inset som bundnavigationen
            nedenfor — ellers ville de sidste 34 px indhold gemme sig bag en nav,
            der netop er blevet højere (G29). */}
        <div ref={scrollRef} style={{
          flex: 1, padding: "18px 18px 96px", overflowY: "auto",
          paddingBottom: "calc(96px + env(safe-area-inset-bottom, 0px))",
        }}>
          {joinError && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 14,
              padding: "12px 14px", borderRadius: 12,
              border: `1px solid ${C.red}`, background: "rgba(239,68,68,0.10)",
            }}>
              <span style={{ color: C.red, fontSize: 13, flex: 1 }}>{joinError}</span>
              <button onClick={() => setJoinError("")} aria-label="Luk" style={iconBtn}><X size={16} /></button>
            </div>
          )}
          {/* Boundary om ÉN skærm, ikke om roden (indbakken, august 2026).
              Den leverede boundary sidder om app-roden (`main.jsx`) og kan kun
              tilbyde en genindlæsning: et render-kast i én fane tog hele appen
              med sig, inklusive den navigation, brugeren skulle bruge for at
              komme videre. Her lever skallen og bundnavigationen videre.

              `key` er nulstillingen. En boundary, der først har fanget, bliver
              siddende i fejltilstand — den har ingen måde at vide, om årsagen er
              væk. Skifter nøglen, monterer React en ny instans, og skærmen
              prøver forfra. Derfor beder teksten netop om at navigere: det ER
              nulstillingen, ikke et forslag om at prøve lykken igen. */}
          <ErrorBoundary key={`${tab}:${screen?.type ?? ""}`} fallback={<ScreenFallback />}>
            {body}
          </ErrorBoundary>
        </div>

        {/* Bottom nav
            `env(safe-area-inset-bottom)` som POLSTRING og ikke som `bottom`:
            baggrunden skal nå helt ned bag home-indikatoren, mens knapperne
            holder sig over den. Skubbede vi hele baren op i stedet, ville der
            stå en stribe app-baggrund under den (G29). */}
        <div style={{
          position: "fixed", bottom: 0, width: "100%", maxWidth: 430,
          background: "rgba(12,22,34,0.96)", backdropFilter: "blur(8px)",
          borderTop: `1px solid ${C.line}`, display: "flex",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}>
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id && !screen;
            return (
              <button key={t.id} onClick={() => goTab(t.id)} style={{
                flex: 1, background: "none", border: "none", cursor: "pointer",
                padding: "10px 0 14px", display: "flex", flexDirection: "column",
                alignItems: "center", gap: 3,
                color: active ? C.green : C.muted, fontFamily: font.body,
              }}>
                <Icon size={21} strokeWidth={active ? 2.4 : 1.8} />
                <span style={{ fontSize: 10.5, fontWeight: active ? 700 : 500 }}>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {pendingJoin && (
        <Modal title="Deltag i konkurrencen?" onClose={() => setPendingJoin(null)}>
          <p style={{ margin: "0 0 4px" }}>
            {pendingJoin.inviterName ? <><b>{pendingJoin.inviterName}</b> har inviteret dig til </> : "Du er inviteret til "}
            konkurrencen <b>{pendingJoin.competition.name}</b>. Vil du være med?
          </p>
          {pendingJoin.groupName && (
            <p style={{ ...muted, margin: "8px 0 0" }}>
              Konkurrencen hører til ligaen <b>{pendingJoin.groupName}</b> — du bliver samtidig medlem af ligaen.
            </p>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button style={{ ...btnGreen, flex: 1, width: "auto" }} onClick={confirmJoin}>Ja, deltag</button>
            <button style={{ ...btnGhost, flex: 1, justifyContent: "center" }} onClick={() => setPendingJoin(null)}>Annullér</button>
          </div>
        </Modal>
      )}

      {pendingGroupJoin && (
        <Modal title="Deltag i ligaen?" onClose={() => setPendingGroupJoin(null)}>
          <p style={{ margin: "0 0 4px" }}>
            Du er inviteret til ligaen <b>{pendingGroupJoin.group.name}</b>. Vil du være med?
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button style={{ ...btnGreen, flex: 1, width: "auto" }} onClick={confirmGroupJoin}>Ja, deltag</button>
            <button style={{ ...btnGhost, flex: 1, justifyContent: "center" }} onClick={() => setPendingGroupJoin(null)}>Annullér</button>
          </div>
        </Modal>
      )}

      {showFlow && (
        <OnboardingFlow token={token} userId={userId} profile={profile} leagues={visibleLeagues}
          onJoined={onFlowJoined} onCreated={onFlowCreated} onSkip={() => closeFlow("skipped")} />
      )}

      {showInstall && !pendingJoin && !pendingGroupJoin && !showFlow && (
        <Modal title="Føj til hjemmeskærm" onClose={dismissInstall}>
          <InstallGuide />
          <button style={{ ...btnGreen, marginTop: 16 }} onClick={dismissInstall}>Forstået</button>
        </Modal>
      )}
    </div>
  );
}

export default MainApp;
