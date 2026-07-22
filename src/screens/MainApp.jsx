// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState, useEffect } from "react";
import { Home, ClipboardList, Users, Trophy, TrendingUp, Crown, Loader2, LogOut, Info, Settings, X } from "lucide-react";
import { db } from "../lib/supabase.js";
import { C, font, iconBtn, muted, phone, wrapOuter } from "../ui/theme.js";
import HjemTab from "./HjemTab.jsx";
import LigaerTab from "./LigaerTab.jsx";
import ChampionshipTab from "./ChampionshipTab.jsx";
import RatingTab from "./RatingTab.jsx";
import BoardScreen from "./BoardScreen.jsx";
import PredictionsScreen from "./PredictionsScreen.jsx";
import CreateCompetitionScreen from "./CreateCompetitionScreen.jsx";
import AdminScreen from "./AdminScreen.jsx";
import HowItWorksScreen from "./HowItWorksScreen.jsx";

function MainApp({ session, profile, onLogout, pendingJoinCode, clearPendingJoinCode }) {
  const token = session.access_token;
  const userId = session.user.id;
  const isAdmin = !!profile?.is_admin;

  const [tab, setTab] = useState("hjem");
  const [screen, setScreen] = useState(null); // null | {type, ...params}
  const [loading, setLoading] = useState(true);
  const [leagues, setLeagues] = useState([]);
  const [competitions, setCompetitions] = useState([]);
  const [joinError, setJoinError] = useState(""); // fejl fra invite-join-deeplink (?join=kode)

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
      const merged = comps.map((c) => ({ ...c, _hidden: hiddenMap[c.id] || false }));
      setCompetitions(merged);
      return merged;
    }
    setCompetitions([]);
    return [];
  }

  async function loadAll() {
    setLoading(true);
    await loadLeagues();
    await loadCompetitions();
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []); // eslint-disable-line

  useEffect(() => {
    if (!pendingJoinCode) return;
    (async () => {
      setJoinError("");
      try {
        const found = await db.select(token, "competitions", `invite_code=eq.${pendingJoinCode}&select=*`);
        if (found.length) {
          const already = await db.select(token, "competition_participants", `competition_id=eq.${found[0].id}&user_id=eq.${userId}&select=competition_id`);
          if (!already.length) {
            await db.insert(token, "competition_participants", [{ competition_id: found[0].id, user_id: userId }]);
          }
          await loadCompetitions();
          setTab("ligaer");
          setScreen({ type: "predictions", compFilter: found[0].id });
        } else {
          setJoinError("Ingen konkurrence fundet med invitationskoden — tjek linket, eller bed opretteren om et nyt.");
        }
      } catch (e) {
        setJoinError("Kunne ikke tilslutte konkurrencen lige nu. Prøv igen om lidt.");
      }
      clearPendingJoinCode();
      const url = new URL(window.location.href);
      url.searchParams.delete("join");
      window.history.replaceState({}, "", url.toString());
    })();
  }, [pendingJoinCode]); // eslint-disable-line

  const visibleLeagues = leagues.filter((l) => l.is_visible !== false);

  // navigations-hjælpere
  const goTab = (t) => { setScreen(null); setTab(t); };
  const openBoard = (compId) => setScreen({ type: "board", compId });
  const openPredictions = (compFilter = "all", roundKey = null) => setScreen({ type: "predictions", compFilter, roundKey });
  const openCreate = () => setScreen({ type: "create" });
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
      initialCompId={screen.compId} onBack={() => setScreen(null)} goToPredictions={openPredictions} />;
  } else if (screen?.type === "predictions") {
    body = <PredictionsScreen token={token} userId={userId} competitions={competitions.filter((c) => !c._hidden)}
      initialFilter={screen.compFilter} initialRoundKey={screen.roundKey} onBack={() => setScreen(null)} />;
  } else if (screen?.type === "create") {
    body = <CreateCompetitionScreen token={token} userId={userId} leagues={visibleLeagues}
      onBack={() => setScreen(null)} onCreated={async () => { await loadCompetitions(); }} openBoard={openBoard} />;
  } else if (screen?.type === "admin") {
    body = <AdminScreen token={token} leagues={leagues} reloadLeagues={loadLeagues} onBack={() => setScreen(null)} />;
  } else if (screen?.type === "how") {
    body = <HowItWorksScreen onBack={() => setScreen(null)} />;
  } else if (tab === "hjem") {
    body = <HjemTab token={token} userId={userId} profile={profile} competitions={competitions.filter((c) => !c._hidden)}
      goTab={goTab} openPredictions={openPredictions} openBoard={openBoard} />;
  } else if (tab === "tip") {
    body = <PredictionsScreen token={token} userId={userId} competitions={competitions.filter((c) => !c._hidden)}
      initialFilter="all" />;
  } else if (tab === "ligaer") {
    body = <LigaerTab token={token} userId={userId} competitions={competitions}
      openBoard={openBoard} openCreate={openCreate} reload={loadAll} />;
  } else if (tab === "championship") {
    body = <ChampionshipTab token={token} userId={userId} leagues={visibleLeagues} />;
  } else if (tab === "rating") {
    body = <RatingTab token={token} userId={userId} />;
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
    </div>
  );
}

export default MainApp;
