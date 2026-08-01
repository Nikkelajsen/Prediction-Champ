// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { auth, clearSession, db, loadSession, saveSession } from "./lib/supabase.js";
import { touchActivity } from "./lib/data.js";
import { logEvent } from "./lib/analytics.js";
import { disablePush } from "./lib/push.js";
import { registerServiceWorker } from "./lib/pwa.js";
import { C, globalCss, wrapOuter } from "./ui/theme.js";
import { AuthScreen, ResetPasswordScreen } from "./screens/Auth.jsx";
import MainApp from "./screens/MainApp.jsx";

// Hvor ofte tokenen fornys, mens fanen er fremme — og hvor gammel den skal
// være, før en vækning udløser en fornyelse. Vækningsgrænsen er lavere end
// intervallet med vilje: kommer man tilbage efter 20 minutter, er tokenen ikke
// udløbet endnu, men den næste timer-kørsel kan ligge langt ude i fremtiden,
// fordi timeren stod stille imens.
const REFRESH_MS = 45 * 60 * 1000;
const STALE_MS = 10 * 60 * 1000;

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
    } catch {
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

  // Service workeren registreres ved OPSTART og ikke først, når nogen slår
  // notifikationer til (G27). En registreret service worker er en betingelse
  // for, at browseren overhovedet betragter appen som installerbar — så indtil
  // nu var installations-prompten låst bag en helt anden beslutning.
  //
  // Registreringen cacher intet (se src/lib/pwa.js og public/sw.js) og kan ikke
  // vælte opstarten: fejler den, mister man push og prompten, ikke appen.
  useEffect(() => { registerServiceWorker(); }, []);

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
        } catch {
          clearSession();
        }
      }
      setBooting(false);
    })();
  }, []);  

  // ---- token-fornyelse (G26) ----
  //
  // Fornyelsen hang indtil august 2026 udelukkende på et `setInterval` på 45
  // minutter, og det er præcis den mekanisme, mobile browsere suspenderer, når
  // appen går i baggrunden. En bruger, der lagde telefonen fra sig under en
  // kampdag og vendte tilbage et par timer senere, havde derfor en død
  // access-token — og fordi ingen kaldte 401 ved navn, så det ud som TOMME
  // SKÆRME frem for som en udløbet session. To ting mangler derfor:
  //
  //   1. et vækning-tidspunkt. `visibilitychange` fyrer, når fanen bliver
  //      synlig igen, og er det ene sted, hvor vi med sikkerhed ved, at
  //      timeren kan have stået stille. Vi fornyer kun, hvis der reelt er gået
  //      tid (STALE_MS), så et fanevip frem og tilbage ikke bliver til et kald.
  //   2. et svar på en fornyelse, der ikke KAN lykkes. En 4xx fra
  //      auth-endpointet betyder, at refresh-tokenen er udløbet eller trukket
  //      tilbage — der er ingen vej tilbage derfra, og at blive siddende med en
  //      død session er værre end at se login-skærmen. En fejl UDEN status er
  //      derimod et netværkshul: den skal ikke logge nogen ud. Det er dét,
  //      `err.status` fra restError() er til for.
  // `0` og ikke Date.now(): en `useRef` initialiseres under render, og
  // `Date.now()` dér er uren (react-hooks/purity) — samme regel som
  // mergeJobHealth i ops.js følger. Værdien sættes i effekten nedenfor, som er
  // det rigtige sted at aflæse "nu".
  const lastRefreshAt = useRef(0);
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!session?.refresh_token) return;
    let stopped = false;
    // Sessionen er frisk i det øjeblik, denne effekt kører: enten er den lige
    // hentet ved login, eller også er tokenen netop fornyet (effekten hænger på
    // refresh_token). Uret starter derfor her og ikke under render.
    lastRefreshAt.current = Date.now();

    async function refreshNow() {
      // Vagt mod to samtidige fornyelser: intervallet og vækningen kan ramme
      // samme sekund, og Supabase roterer refresh-tokenen ved hvert kald, så
      // det andet kald ville bruge en token, det første lige har brugt op.
      if (refreshingRef.current || stopped) return;
      refreshingRef.current = true;
      try {
        const res = await auth.refresh(session.refresh_token);
        if (stopped) return;
        lastRefreshAt.current = Date.now();
        setSession((s) => ({ ...s, access_token: res.access_token, refresh_token: res.refresh_token }));
        saveSession({ refresh_token: res.refresh_token, user: session.user });
      } catch (e) {
        // Kun en afvisning fra serveren er endelig. Alt andet (offline, timeout)
        // prøver vi igen ved næste interval eller næste vækning.
        if (!stopped && e?.status >= 400 && e?.status < 500) {
          clearSession();
          setSession(null);
          setProfile(null);
        }
      } finally {
        refreshingRef.current = false;
      }
    }

    const id = setInterval(refreshNow, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefreshAt.current < STALE_MS) return;
      refreshNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
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
