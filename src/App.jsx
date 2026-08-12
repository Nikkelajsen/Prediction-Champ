// Appens rod: session, login-tilstand, token-fornyelse og de deep links, der
// læses ved boot (?join=, ?liga=, ?pn=). Alt andet ligger i MainApp — denne fil
// afgør kun, OM der er en bruger, og holder den bruger logget ind.
import { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { auth, clearSession, db, loadSession, saveSession } from "./lib/supabase.js";
import { hentEgenProfil, loadInvitePreview, sikrProfil, touchActivity } from "./lib/data.js";
import { clearPendingInvite, readPendingInvite, writePendingInvite } from "./lib/localFlags.js";
import { logEvent } from "./lib/analytics.js";
import { disablePush } from "./lib/push.js";
import { registerServiceWorker } from "./lib/pwa.js";
import { installGlobalErrorReporting, setTelemetryToken, telemetryScreen, telemetryToken } from "./lib/telemetry.js";
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

// Hvad adressen bad om, læst ÉN gang.
//
// Deep links (`?join=`, `?liga=`, `?pn=`/`?rk=`) og Supabases recovery-hash er
// begge kun sande ved den allerførste render: de strippes af `replaceState`, så
// snart de er brugt. De hører derfor til som INITIAL tilstand og ikke som en
// effekt, der sætter state umiddelbart efter mount (G2, august 2026) — den
// gamle form gav en ekstra render, hvor appen troede, der ingen invitation var,
// og React Compiler kalder den slags "cascading renders" med rette.
//
// Hash'et bærer TO slags links, og de skal ikke behandles ens. `type=recovery`
// er en nulstilling og fører til ResetPasswordScreen; `type=signup` er
// bekræftelses-mailen (B26) og bærer en FULD session — access- og refresh-token
// — som skal logges ind med det samme. Uden den anden ville en bruger, der
// netop har trykket "Bekræft e-mail", lande på login-skærmen med et ubrugt
// hash i adresselinjen og skulle taste den kode, de valgte for fem minutter
// siden. Selve kontoen ville virke; det er ankomsten, der ville være forkert.
function readUrlIntent() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const type = hash.get("type");
  const recovery = type === "recovery" ? hash.get("access_token") : null;
  const bekræftet = type === "signup" && hash.get("access_token")
    ? { access_token: hash.get("access_token"), refresh_token: hash.get("refresh_token") }
    : null;
  const params = new URLSearchParams(window.location.search);
  const pn = params.get("pn");
  return {
    recoveryToken: recovery || null,
    confirmed: bekræftet,
    join: params.get("join") || null,
    liga: params.get("liga") || null,
    push: pn ? { kind: pn, roundKey: params.get("rk") || null } : null,
  };
}

export default function App() {
  const [urlIntent] = useState(readUrlIntent);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  // Er der en recovery-token, skal appen ikke boote en session op bagved —
  // skærmen er nulstil-adgangskode og intet andet.
  const [booting, setBooting] = useState(!urlIntent.recoveryToken);
  const [recoveryToken, setRecoveryToken] = useState(urlIntent.recoveryToken);
  const [pendingJoinCode, setPendingJoinCode] = useState(urlIntent.join);
  const [pendingLigaCode, setPendingLigaCode] = useState(urlIntent.liga);
  const [pendingPushOpen] = useState(urlIntent.push); // { kind, roundKey } fra ?pn=/?rk=
  // Kom invitationen fra localStorage frem for fra adressen? (I7) Det er dét,
  // der besvarer, om en invitation overlevede omvejen over oprettelsen — og
  // dermed hele grunden til, at den gemmes. Følger med til MainApp, som logger
  // `invite_landed`, når koden er slået op.
  const [inviteFromStorage, setInviteFromStorage] = useState(false);
  // Hvad koden peger på, læst UDEN login (I7). Ren pynt på login-skærmen:
  // udebliver den, ser skærmen ud præcis som før.
  const [invitation, setInvitation] = useState(null);

  // `source` skelner mellem tre veje ind i completeAuth, som IKKE må logges
  // ens: "signup" (ny konto), "signin" (almindeligt login) og "restore" (den
  // stille gen-optagelse af en gemt session ved app-boot). Uden skellet ville
  // login fyre ved hver eneste app-genstart, hvilket ville ødelægge metrikken.
  async function completeAuth({ access_token, refresh_token, user }, chosenUsername, source = "restore") {
    try {
      if (chosenUsername) {
        // `select=id`: `return=representation` er en `returning`-klausul, og den
        // kræver læse-privilegiet på hver kolonne, den giver tilbage (A43).
        // Profilen hentes derfor bagefter gennem `my_profile()`, som er den
        // eneste vej til `is_admin` — det felt, admin-fanen står på.
        await db.upsert(access_token, "profiles", [{ id: user.id, display_name: chosenUsername }], "id", "id");
        setProfile(await hentEgenProfil(access_token));
      } else {
        // `sikrProfil` og ikke et bart opslag (B26): mangler rækken, skrives
        // den af det brugernavn, oprettelsen gemte som metadata. Det er den
        // eneste vej, en konto oprettet MED e-mailbekræftelse nogensinde får
        // et navn — signup svarede uden token, så rækken kunne ikke skrives
        // dengang. Findes rækken, rører funktionen den ikke.
        setProfile(await sikrProfil(access_token, user));
      }
    } catch {
      // Stod som `profiles?select=*` indtil `A43`. Kolonne-grants (#60) gør det
      // opslag til et `42501`, og fald-tilbagen ville dermed være den eneste
      // gren, der ALTID fejlede — netop på den vej, der bruges, når noget
      // andet allerede er gået galt.
      setProfile((await hentEgenProfil(access_token)) || null);
    }
    setSession({ access_token, refresh_token, user });
    saveSession({ refresh_token, user });
    touchActivity(access_token, user.id); // best-effort aktivitets-ping (throttlet pr. bruger, fejler stille)
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

  // Fejltelemetri (G42). To ting, og de skal ske i den rækkefølge:
  //
  //   1. tokenen gøres tilgængelig for dem, der står uden for React-træet —
  //      error boundaryen om roden (main.jsx) og de globale håndterere. Uden
  //      den ville en rapport blive afvist af RLS, som kræver
  //      `user_id = auth.uid()`.
  //   2. `window.onerror` og `unhandledrejection` lyttes på. De fanger dét,
  //      React ikke gør: fejl i event handlers, i timere og afviste promises,
  //      som i denne kodebase ellers kun efterlader en tom skærm.
  //
  // Håndtererne installeres ÉN gang og læser tokenen gennem en funktion frem
  // for at være afhængige af den — ellers ville de skulle af- og påmeldes ved
  // hvert login, og en fejl i mellemrummet ville ingen fange.
  useEffect(() => { setTelemetryToken(session?.access_token || null); }, [session?.access_token]);
  useEffect(() => installGlobalErrorReporting(telemetryToken, telemetryScreen), []);

  useEffect(() => {
    // Adressen er allerede læst (se readUrlIntent ovenfor). Tilbage står den ene
    // ting, der ikke KAN ske under render: at hente sessionen op igen.
    if (urlIntent.recoveryToken) return;

    (async () => {
      // ---- den ventende invitation (I7) ----
      //
      // Bærer adressen en kode, GEMMES den; gør den ikke, hentes en gemt frem.
      // Adressen vinder altid: står man med et friskt link i hånden, er det dét,
      // man mener — også selvom der ligger et ældre og venter.
      //
      // Begge dele sker HER og ikke i `readUrlIntent()`, selvom det er dér,
      // adressen læses. `readUrlIntent` kaldes under render, og både en skrivning
      // til localStorage og et opslag på uret er urene dér — samme regel som
      // `lastRefreshAt` nedenfor følger. En effekt er det rigtige sted at aflæse
      // "nu" og at røre omverdenen.
      if (urlIntent.join || urlIntent.liga) {
        writePendingInvite(urlIntent.join ? "join" : "liga", urlIntent.join || urlIntent.liga);
      } else {
        const gemt = readPendingInvite();
        if (gemt) {
          setInviteFromStorage(true);
          if (gemt.param === "join") setPendingJoinCode(gemt.code);
          else setPendingLigaCode(gemt.code);
        }
      }

      // Bekræftelses-linket (B26) går FORAN den gemte session: den, der lige
      // har trykket "Bekræft e-mail", skal ind på den konto, linket gælder —
      // ikke på en anden, enheden tilfældigvis havde liggende.
      //
      // Hash'et bærer tokens, men ikke brugeren, så `getUser` henter den.
      // Kilden er "signup": det er HER kontoen bliver til noget, der kan
      // bruges, og det er derfor her `account_created` skal tælles.
      if (urlIntent.confirmed?.access_token) {
        try {
          const user = await auth.getUser(urlIntent.confirmed.access_token);
          await completeAuth({ ...urlIntent.confirmed, user }, undefined, "signup");
          // Hash'et ryddes, så et refresh ikke prøver at logge ind igen med en
          // token, der nu er gammel. `search` bevares — et `?join=` fra samme
          // adresse er stadig noget, appen skal handle på.
          window.history.replaceState({}, "", window.location.pathname + window.location.search);
          setBooting(false);
          return;
        } catch {
          // Udløbet eller allerede brugt link. Login-skærmen er det rigtige
          // sted at lande — kontoen er bekræftet, hvis linket blev åbnet før.
        }
      }

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
    // Kun ved mount. `urlIntent` er sat under den første render og kan pr.
    // konstruktion ikke ændre sig — men den kan læses her, så linteren beder
    // om den i listen; en tom liste er den rigtige, og undtagelsen er derfor
    // markeret frem for at lade advarslen stå og larme.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Hvad er jeg inviteret til? — spurgt UDEN login (I7).
  //
  // Kun når der faktisk er nogen at fortælle det til: er man logget ind, viser
  // MainApp allerede bekræftelses-dialogen med de rigtige navne, og et opslag
  // mere ville være et kald for at pynte på en skærm, ingen ser.
  //
  // Svaret er rent pynt, og `loadInvitePreview` kaster aldrig — en ukendt kode,
  // et langsomt net eller en fejl giver `null`, og login-skærmen ser da ud
  // præcis som før `I7`.
  useEffect(() => {
    const kode = pendingJoinCode || pendingLigaCode;
    if (booting || session || !kode) return;
    let stoppet = false;
    (async () => {
      const svar = await loadInvitePreview(kode);
      if (!stoppet) setInvitation(svar);
    })();
    return () => { stoppet = true; };
  }, [booting, session, pendingJoinCode, pendingLigaCode]);

  // push_opened: virker uanset om ?pn= ankom før eller efter login (session
  // kan mangle, når linket først åbnes). Fyrer så snart en token findes, og
  // rydder query-strengen så et refresh ikke logger den samme åbning igen.
  //
  // "Én gang" bæres af en ref og ikke af at nulstille tilstanden (G2): det
  // gjorde den før, og en effekt, der sætter state synkront, tvinger en ekstra
  // render igennem for at fortælle sig selv, at den er færdig. Ref'en siger det
  // samme uden at røre render-træet — og `pendingPushOpen` bliver dermed dét,
  // den beskriver: hvad adressen bad om, ikke hvad vi mangler at gøre ved det.
  const pushLogged = useRef(false);
  useEffect(() => {
    if (!session?.access_token || !pendingPushOpen || pushLogged.current) return;
    pushLogged.current = true;
    logEvent(session.access_token, "push_opened", {
      metadata: { kind: pendingPushOpen.kind, round_key: pendingPushOpen.roundKey },
    });
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
        // `invitation` (I7): uden den er skærmen en formular uden en grund. Med
        // den er den en invitation. Se AuthShell i screens/Auth.jsx.
        // `harInvitation` er kendt med det samme (koden står i adressen);
        // `invitation` kommer, når opslaget svarer. De to er derfor adskilt:
        // den første afgør, om skærmen åbner på Opret, den anden hvad der står.
        <AuthScreen onAuthed={completeAuth} booting={false} invitation={invitation}
          harInvitation={!!(pendingJoinCode || pendingLigaCode)} />
      ) : (
        // `onProfileChanged` findes af én grund (B29): navnet står også i
        // Hjems hilsen og som afsender på et invitationslink, og de læser
        // `profile` herfra. Uden linjen ville et navneskift kun kunne ses på
        // karriereprofilen indtil næste app-start.
        // 🔴 Den FLETTER og erstatter ikke (A43). `changeDisplayName()` svarer
        // siden kolonne-grants'ene (#60) med `id` og `display_name` alene, så
        // en erstatning ville tømme `is_admin` — og administratoren ville miste
        // sin fane ved at skifte navn.
        // `clearPending*` rydder nu BEGGE steder (I7): en invitation, der er
        // slået op, må ikke kunne dukke op igen ved næste opstart, uanset hvad
        // opslaget svarede. Det er dét, der gør localStorage-kopien til en
        // omvej-forsikring frem for en kø, der vokser.
        <MainApp session={session} profile={profile} onProfileChanged={(række) => setProfile((p) => ({ ...p, ...række }))} onLogout={handleLogout}
          inviteFromStorage={inviteFromStorage}
          pendingJoinCode={pendingJoinCode} clearPendingJoinCode={() => { setPendingJoinCode(null); clearPendingInvite(); }}
          pendingLigaCode={pendingLigaCode} clearPendingLigaCode={() => { setPendingLigaCode(null); clearPendingInvite(); }} />
      )}
    </>
  );
}
