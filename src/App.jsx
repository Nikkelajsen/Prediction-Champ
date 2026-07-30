// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { auth, clearSession, db, loadSession, saveSession } from "./lib/supabase.js";
import { touchActivity } from "./lib/data.js";
import { logEvent } from "./lib/analytics.js";
import { disablePush } from "./lib/push.js";
import { C, globalCss, muted, wrapOuter } from "./ui/theme.js";
import { AuthScreen, ResetPasswordScreen } from "./screens/Auth.jsx";
import MainApp from "./screens/MainApp.jsx";

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [booting, setBooting] = useState(true);
  const [recoveryToken, setRecoveryToken] = useState(null);
  const [pendingJoinCode, setPendingJoinCode] = useState(null);
  const [pendingLigaCode, setPendingLigaCode] = useState(null);
  const [pendingPushOpen, setPendingPushOpen] = useState(null); // { kind, roundKey } fra ?pn=/?rk=

  // `source` skelner mellem tre veje ind i completeAuth, som IKKE må logges
  // ens: "signup" (ny konto), "signin" (almindeligt login) og "restore" (den
  // stille gen-optagelse af en gemt session ved app-boot). Uden skellet ville
  // login fyre ved hver eneste app-genstart, hvilket ville ødelægge metrikken.
  async function completeAuth({ access_token, refresh_token, user }, chosenUsername, source = "restore") {
    try {
      if (chosenUsername) {
        const rows = await db.upsert(access_token, "profiles", [{ id: user.id, display_name: chosenUsername }], "id");
        setProfile(rows[0]);
      } else {
        const rows = await db.select(access_token, "profiles", `id=eq.${user.id}&select=*`);
        setProfile(rows[0] || null);
      }
    } catch (e) {
      const rows = await db.select(access_token, "profiles", `id=eq.${user.id}&select=*`);
      setProfile(rows[0] || null);
    }
    setSession({ access_token, refresh_token, user });
    saveSession({ refresh_token, user });
    touchActivity(access_token); // best-effort aktivitets-ping (throttlet, fejler stille)
    if (source === "signup") { logEvent(access_token, "account_created"); logEvent(access_token, "login"); }
    else if (source === "signin") { logEvent(access_token, "login"); }
  }

  function handleLogout() {
    logEvent(session?.access_token, "logout");
    // afmeld enhedens push-abonnement, så en delt enhed ikke får den forrige brugers beskeder
    disablePush(session?.access_token).catch(() => {});
    setSession(null); setProfile(null); clearSession();
  }

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hash.get("type") === "recovery" && hash.get("access_token")) {
      setRecoveryToken(hash.get("access_token"));
      setBooting(false);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const join = params.get("join");
    if (join) setPendingJoinCode(join);
    const liga = params.get("liga");
    if (liga) setPendingLigaCode(liga);
    const pn = params.get("pn");
    if (pn) setPendingPushOpen({ kind: pn, roundKey: params.get("rk") || null });

    (async () => {
      const saved = loadSession();
      if (saved?.refresh_token) {
        try {
          const res = await auth.refresh(saved.refresh_token);
          await completeAuth(res, null);
        } catch (e) {
          clearSession();
        }
      }
      setBooting(false);
    })();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!session?.refresh_token) return;
    const id = setInterval(async () => {
      try {
        const res = await auth.refresh(session.refresh_token);
        setSession((s) => ({ ...s, access_token: res.access_token, refresh_token: res.refresh_token }));
        saveSession({ refresh_token: res.refresh_token, user: session.user });
      } catch (e) { /* ignorer */ }
    }, 45 * 60 * 1000);
    return () => clearInterval(id);
  }, [session?.refresh_token]); // eslint-disable-line

  // push_opened: virker uanset om ?pn= ankom før eller efter login (session
  // kan mangle, når linket først åbnes). Fyrer så snart en token findes, og
  // rydder query-strengen så et refresh ikke logger den samme åbning igen.
  useEffect(() => {
    if (!session?.access_token || !pendingPushOpen) return;
    logEvent(session.access_token, "push_opened", {
      metadata: { kind: pendingPushOpen.kind, round_key: pendingPushOpen.roundKey },
    });
    setPendingPushOpen(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("pn"); url.searchParams.delete("rk");
    window.history.replaceState({}, "", url);
  }, [session?.access_token, pendingPushOpen]);

  if (recoveryToken) {
    return (
      <>
        <style>{globalCss}</style>
        <ResetPasswordScreen accessToken={recoveryToken} onDone={() => {
          window.location.hash = "";
          setRecoveryToken(null);
        }} />
      </>
    );
  }

  if (booting) {
    return (
      <div style={wrapOuter}>
        <style>{globalCss}</style>
        <div style={{ display: "flex", gap: 10, color: C.muted, alignItems: "center", paddingTop: 60 }}>
          <Loader2 className="spin" size={20} />Henter …
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{globalCss}</style>
      {!session ? (
        <AuthScreen onAuthed={completeAuth} booting={false} />
      ) : (
        <MainApp session={session} profile={profile} onLogout={handleLogout}
          pendingJoinCode={pendingJoinCode} clearPendingJoinCode={() => setPendingJoinCode(null)}
          pendingLigaCode={pendingLigaCode} clearPendingLigaCode={() => setPendingLigaCode(null)} />
      )}
    </>
  );
}
