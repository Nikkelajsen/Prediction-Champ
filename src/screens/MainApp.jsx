// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState, useEffect, useRef } from "react";
import { Home, ClipboardList, Users, Trophy, TrendingUp, Crown, Loader2, LogOut, Info, Settings, X, User } from "lucide-react";
import { db } from "../lib/supabase.js";
import { loadGroupByCode, joinGroup, joinCompetition } from "../lib/data.js";
import { deriveOnboarding, loadOnboardingSignals, readFlag, writeFlag, COMPLETE_KEY, FLOW_KEY } from "../lib/onboarding.js";
import { C, btnGhost, btnGreen, font, iconBtn, muted, phone, wrapOuter } from "../ui/theme.js";
import { Modal } from "../ui/components.jsx";
import HjemTab from "./HjemTab.jsx";
import LigaerTab from "./LigaerTab.jsx";
import GroupScreen from "./GroupScreen.jsx";
import ChampionshipTab from "./ChampionshipTab.jsx";
import RatingTab from "./RatingTab.jsx";
import BoardScreen from "./BoardScreen.jsx";
import PredictionsScreen from "./PredictionsScreen.jsx";
import CreateCompetitionScreen from "./CreateCompetitionScreen.jsx";
import AdminScreen from "./AdminScreen.jsx";
import ProfileScreen from "./ProfileScreen.jsx";
import HowItWorksScreen from "./HowItWorksScreen.jsx";
import OnboardingFlow from "./OnboardingFlow.jsx";
import InstallGuide, { isStandalone } from "./InstallGuide.jsx";

const PWA_ONBOARDED_KEY = "pc_pwa_onboarded";

function MainApp({ session, profile, onLogout, pendingJoinCode, clearPendingJoinCode, pendingLigaCode, clearPendingLigaCode }) {
  const token = session.access_token;
  const userId = session.user.id;
  const isAdmin = !!profile?.is_admin;

  const [tab, setTab] = useState("hjem");
  const [screen, setScreen] = useState(null); // null | {type, ...params}
  const [loading, setLoading] = useState(true);
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
  const onboardingDone = useRef(readFlag(COMPLETE_KEY) === "1");
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
      if (state.complete) { onboardingDone.current = true; writeFlag(COMPLETE_KEY, "1"); }
      setOnboarding(state);
    } catch (e) { /* onboarding må aldrig blokere appen — kortet udebliver bare */ }
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
      // Arkivering (`hidden`) er en affordance for LIGA-LØSE konkurrencer (kun der vises
      // Arkivér/Gendan). En konkurrence, der ligger i en liga, styres via Deltag/Framelding
      // — ikke arkivering. Uden dette kunne et forældet hidden-flag (fx sat mens konkurrencen
      // var liga-løs og siden flyttet ind i en liga via move_competition_to_group) skjule den
      // på Hjem/Tip, selvom liga-siden stadig viser den som "Med" — og brugeren kunne ikke
      // gendanne den, da Gendan-knappen ikke findes for liga-konkurrencer.
      const merged = comps.map((c) => ({ ...c, _hidden: c.group_id ? false : (hiddenMap[c.id] || false) }));
      setCompetitions(merged);
      return merged;
    }
    setCompetitions([]);
    return [];
  }

  async function loadAll() {
    setLoading(true);
    await loadLeagues();
    const comps = await loadCompetitions();
    setLoading(false);
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
    if (readFlag(FLOW_KEY)) return;
    if (pendingJoinCode || pendingLigaCode || pendingJoin || pendingGroupJoin || joinError) return;
    if (!onboarding || onboarding.hasCompetition || onboarding.hasGroup) return;
    flowOpened.current = true;
    setShowFlow(true);
  }, [loading, onboarding, pendingJoinCode, pendingLigaCode, pendingJoin, pendingGroupJoin, joinError]);

  function closeFlow(mark) {
    writeFlag(FLOW_KEY, mark);
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
    if (readFlag(PWA_ONBOARDED_KEY)) return;
    if (isStandalone()) return;
    if (pendingJoinCode || pendingLigaCode || pendingJoin || pendingGroupJoin || showFlow) return;
    // onboardingDone: en etableret bruger (som aldrig prober) har for længst tippet.
    if (!onboarding?.hasPrediction && !onboardingDone.current) return;
    setShowInstall(true);
  }, [onboarding, pendingJoinCode, pendingLigaCode, pendingJoin, pendingGroupJoin, showFlow]);
  function dismissInstall() {
    writeFlag(PWA_ONBOARDED_KEY, "1");
    setShowInstall(false);
  }

  useEffect(() => {
    if (!pendingJoinCode) return;
    (async () => {
      setJoinError("");
      try {
        const found = await db.select(token, "competitions", `invite_code=eq.${pendingJoinCode}&select=*`);
        if (found.length) {
          const comp = found[0];
          const already = await db.select(token, "competition_participants", `competition_id=eq.${comp.id}&user_id=eq.${userId}&select=competition_id`);
          if (already.length) {
            // Allerede deltager — ingen bekræftelse nødvendig, gå direkte til stillingen.
            // Men sikr liga-medlemskabet først: en deltager UDEN liga-medlemskab er
            // netop den halve tilstand, A8-hullet efterlod (deltager i stillingen,
            // men usynlig på medlemslisten og uden adgang til ligaens side). At
            // trykke på invitationslinket igen er den naturlige måde at forsøge at
            // rette det på, så det skal faktisk rette det. joinGroup er idempotent.
            if (comp.group_id) {
              try { await joinGroup(token, userId, comp.group_id); }
              catch (e) { /* deltagelsen er intakt — bloker ikke navigationen */ }
            }
            await loadCompetitions();
            setTab("ligaer");
            setScreen({ type: "board", compId: comp.id });
          } else {
            // vis bekræftelse i stedet for at joine direkte
            let inviterName = "";
            if (comp.created_by) {
              try {
                const prof = await db.select(token, "profiles", `id=eq.${comp.created_by}&select=display_name`);
                inviterName = prof[0]?.display_name || "";
              } catch (e) { /* inviter-navn er valgfrit */ }
            }
            // Ligger konkurrencen i en liga, melder join én ind i BEGGE (A8) —
            // ligaens navn hentes, så bekræftelsen kan sige det højt i stedet
            // for at gøre det bag om ryggen på brugeren.
            let groupName = "";
            if (comp.group_id) {
              try {
                const g = await db.select(token, "groups", `id=eq.${comp.group_id}&select=name`);
                groupName = g[0]?.name || "";
              } catch (e) { /* liga-navn er valgfrit */ }
            }
            setPendingJoin({ competition: comp, inviterName, groupName });
          }
        } else {
          setJoinError("Ingen konkurrence fundet med invitationskoden — tjek linket, eller bed opretteren om et nyt.");
        }
      } catch (e) {
        setJoinError("Kunne ikke tilmelde dig konkurrencen lige nu. Prøv igen om lidt.");
      }
      clearPendingJoinCode();
      const url = new URL(window.location.href);
      url.searchParams.delete("join");
      window.history.replaceState({}, "", url.toString());
    })();
  }, [pendingJoinCode]); // eslint-disable-line

  // Liga-invite via deep-link (?liga=kode): bekræft før join (samme mønster som ?join=).
  useEffect(() => {
    if (!pendingLigaCode) return;
    (async () => {
      setJoinError("");
      try {
        const g = await loadGroupByCode(token, pendingLigaCode);
        if (g) {
          const already = await db.select(token, "group_members", `group_id=eq.${g.id}&user_id=eq.${userId}&select=user_id`);
          if (already.length) { setTab("ligaer"); setScreen({ type: "group", groupId: g.id }); }
          else setPendingGroupJoin({ group: g });
        } else {
          setJoinError("Ingen liga fundet med invitationskoden — tjek linket, eller bed opretteren om et nyt.");
        }
      } catch (e) {
        setJoinError("Kunne ikke tilmelde dig ligaen lige nu. Prøv igen om lidt.");
      }
      clearPendingLigaCode();
      const url = new URL(window.location.href);
      url.searchParams.delete("liga");
      window.history.replaceState({}, "", url.toString());
    })();
  }, [pendingLigaCode]); // eslint-disable-line

  async function confirmGroupJoin() {
    if (!pendingGroupJoin) return;
    const g = pendingGroupJoin.group;
    try {
      await joinGroup(token, userId, g.id);
      await refreshOnboarding();
      setPendingGroupJoin(null);
      setTab("ligaer");
      setScreen({ type: "group", groupId: g.id });
    } catch (e) {
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
    } catch (e) {
      setPendingJoin(null);
      setJoinError("Kunne ikke tilmelde dig konkurrencen lige nu. Prøv igen om lidt.");
    }
  }

  const visibleLeagues = leagues.filter((l) => l.is_visible !== false);

  // navigations-hjælpere
  // At vende tilbage til Hjem er præcis det øjeblik, hvor et netop afgivet tip
  // skal kunne ses på checklisten — derfor gen-hentes tilstanden dér, og kun
  // så længe onboardingen er uafsluttet.
  const goTab = (t) => {
    setScreen(null); setTab(t);
    if (t === "hjem" && !onboardingDone.current) refreshOnboarding();
  };
  const openBoard = (compId) => setScreen({ type: "board", compId });
  const openPredictions = (compFilter = "all", roundKey = null) => setScreen({ type: "predictions", compFilter, roundKey });
  const openCreate = (groupId = null) => setScreen({ type: "create", groupId });
  const openGroup = (groupId) => setScreen({ type: "group", groupId });
  const openProfile = (profileUserId) => setScreen({ type: "profile", profileUserId });
  const openAdmin = () => setScreen({ type: "admin" });
  const openHow = () => setScreen({ type: "how" });

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
  } else if (screen?.type === "board") {
    body = <BoardScreen token={token} userId={userId} competitions={competitions.filter((c) => !c._hidden)}
      initialCompId={screen.compId} inviterName={profile?.display_name} onBack={() => setScreen(null)}
      goToPredictions={openPredictions} openProfile={openProfile} onCreate={openCreate} goTab={goTab} />;
  } else if (screen?.type === "predictions") {
    body = <PredictionsScreen token={token} userId={userId} competitions={competitions.filter((c) => !c._hidden)}
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
    body = <AdminScreen token={token} leagues={leagues} reloadLeagues={loadLeagues} onBack={() => setScreen(null)} />;
  } else if (screen?.type === "profile") {
    body = <ProfileScreen token={token} viewerUserId={userId} profileUserId={screen.profileUserId} onBack={() => setScreen(null)} />;
  } else if (screen?.type === "how") {
    body = <HowItWorksScreen onBack={() => setScreen(null)} />;
  } else if (tab === "hjem") {
    body = <HjemTab token={token} userId={userId} profile={profile} competitions={competitions.filter((c) => !c._hidden)}
      goTab={goTab} openPredictions={openPredictions} openBoard={openBoard} openGroup={openGroup} openProfile={openProfile}
      onboarding={onboarding} />;
  } else if (tab === "tip") {
    body = <PredictionsScreen token={token} userId={userId} competitions={competitions.filter((c) => !c._hidden)}
      leagues={visibleLeagues} initialFilter="all" openProfile={openProfile} onCreate={openCreate} goTab={goTab} />;
  } else if (tab === "ligaer") {
    body = <LigaerTab token={token} userId={userId} competitions={competitions}
      openBoard={openBoard} openCreate={openCreate} openGroup={openGroup} reload={loadAll} openProfile={openProfile} />;
  } else if (tab === "championship") {
    body = <ChampionshipTab token={token} userId={userId} leagues={visibleLeagues} openProfile={openProfile} />;
  } else if (tab === "rating") {
    body = <RatingTab token={token} userId={userId} openProfile={openProfile} openPredictions={openPredictions} hasCompetitions={competitions.length > 0} />;
  }

  return (
    <div style={wrapOuter}>
      <div style={phone}>
        {/* Top brand bar */}
        <div style={{
          padding: "14px 18px 10px", display: "flex", alignItems: "center", gap: 8,
          borderBottom: `1px solid ${C.line}`,
        }}>
          <Crown size={17} color={C.gold} />
          <span style={{
            fontFamily: font.display, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.1em", fontSize: 15,
          }}>
            Prediction Champ
          </span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => openProfile(userId)} aria-label="Min karriereprofil" style={iconBtn}><User size={18} /></button>
            <button onClick={openHow} aria-label="Sådan virker det" style={iconBtn}><Info size={18} /></button>
            {isAdmin && <button onClick={openAdmin} aria-label="Admin" style={iconBtn}><Settings size={18} /></button>}
            <button onClick={onLogout} aria-label="Log ud" style={iconBtn}><LogOut size={17} /></button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: "18px 18px 96px", overflowY: "auto" }}>
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
          {body}
        </div>

        {/* Bottom nav */}
        <div style={{
          position: "fixed", bottom: 0, width: "100%", maxWidth: 430,
          background: "rgba(12,22,34,0.96)", backdropFilter: "blur(8px)",
          borderTop: `1px solid ${C.line}`, display: "flex",
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
