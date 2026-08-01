// Login, kontooprettelse og nulstilling af adgangskode.
//
// SKÆRMEN ER EN RIGTIG `<form>` (G28, august 2026), og det er ikke kosmetik.
// Den var indtil da løse `<input>`s med en `onClick`-knap, hvilket kostede fire
// ting på præcis den skærm, hver eneste nye bruger møder først:
//   * Enter sendte ikke formularen — man skulle ramme knappen;
//   * uden `type="email"` fik telefoner et almindeligt tastatur uden @;
//   * uden `autoComplete` hverken udfyldte ELLER GEMTE adgangskode-managere,
//     så en ny bruger fik ingen hjælp til at huske den kode, de lige valgte;
//   * uden `<label>` havde felterne intet navn for en skærmlæser — en
//     placeholder forsvinder, så snart der skrives i feltet.
//
// Etiketterne er `.srOnly` og ikke synlige: placeholderne bærer allerede
// designet, og to synlige etiketter oven på hinanden ville være støj. Reglen er
// "et felt SKAL have et navn", ikke "et navn skal kunne ses".
import { useState } from "react";
import { Crown, Loader2 } from "lucide-react";
import { auth } from "../lib/supabase.js";
import { C, btnGreen, fieldFull, font, muted, wrapOuter } from "../ui/theme.js";
import { Card } from "../ui/components.jsx";

// Et felt med et navn, en skærmlæser kan læse. Etiketten er skjult (`.srOnly`),
// fordi placeholderen bærer det synlige design — men den FINDES, hvilket
// placeholderen ikke gør, så snart brugeren begynder at skrive.
function Field({ id, label, ...rest }) {
  return (
    <>
      <label className="srOnly" htmlFor={id}>{label}</label>
      <input id={id} className="field" style={fieldFull} placeholder={label} {...rest} />
    </>
  );
}

// Tekstlinks, der skifter tilstand ("Glemt adgangskode?", "Ny bruger?").
//
// Var `<p onClick>`: usynlige for tastaturet og uden rolle for en skærmlæser.
// En rigtig knap uden knap-udseende — `type="button"` er ikke til forhandling
// inde i en `<form>`, hvor standarden er `submit`.
function LinkButton({ onClick, children, style }) {
  return (
    <button type="button" onClick={onClick} style={{
      ...muted, background: "none", border: "none", padding: "4px 0", width: "100%",
      textAlign: "center", cursor: "pointer", fontSize: 13, ...style,
    }}>
      {children}
    </button>
  );
}

// GoTrues fejl kommer på engelsk i en ellers dansk app. De tre nedenfor er dem,
// en bruger realistisk rammer; alt andet vises som det kommer, fordi en tavs
// omskrivning af en ukendt fejl ville gøre fejlsøgning sværere end den engelske
// tekst gør det for brugeren.
const AUTH_FEJL = [
  [/invalid login credentials/i, "Forkert e-mail eller adgangskode."],
  [/user already registered/i, "Der findes allerede en konto med den e-mail. Log ind i stedet."],
  [/password should be at least/i, "Adgangskoden er for kort — den skal være mindst 6 tegn."],
  [/unable to validate email|invalid format/i, "E-mailen ser ikke rigtig ud."],
];

export function daAuthError(besked) {
  const tekst = String(besked || "");
  for (const [m, da] of AUTH_FEJL) if (m.test(tekst)) return da;
  return tekst || "Noget gik galt";
}

function AuthShell({ children }) {
  return (
    <div style={{ ...wrapOuter, alignItems: "flex-start" }}>
      <div style={{ width: "100%", maxWidth: 430, padding: "60px 18px", display: "flex", justifyContent: "center" }}>
        <Card style={{ width: 320 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Crown size={18} color={C.gold} />
            <span style={{ fontFamily: font.display, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 16 }}>
              Prediction Champ
            </span>
          </div>
          {/* Hvad er det her? — besvaret FØR der bedes om en e-mail. */}
          <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.45, margin: "0 0 14px" }}>
            Gæt resultater mod dine venner. Opret en liga, tip ugens kampe, og se hvem der er bedst.
          </p>
          {children}
        </Card>
      </div>
    </div>
  );
}

function ResetPasswordScreen({ accessToken, onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e) {
    e?.preventDefault?.();
    setError("");
    if (password.length < 6) { setError("Adgangskoden skal være mindst 6 tegn"); return; }
    if (password !== confirm) { setError("Adgangskoderne er ikke ens"); return; }
    setLoading(true);
    try {
      await auth.updatePassword(accessToken, password);
      setDone(true);
    } catch (e2) {
      setError(daAuthError(e2.message));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <p style={muted}>Vælg en ny adgangskode til din konto.</p>
      {done ? (
        <>
          <p style={{ color: C.green, fontSize: 14 }}>Adgangskoden er opdateret! Du kan nu logge ind.</p>
          <button style={btnGreen} onClick={onDone}>Til login</button>
        </>
      ) : (
        <form onSubmit={submit}>
          <Field id="nyt-kodeord" label="Ny adgangskode" type="password" autoComplete="new-password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
          <Field id="gentag-kodeord" label="Gentag adgangskode" type="password" autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {/* role="alert" gør, at en skærmlæser LÆSER fejlen op, når den dukker
              op. Uden den ville den bare stå der — set af den, der kan se. */}
          {error && <p role="alert" style={{ color: C.red, fontSize: 13 }}>{error}</p>}
          <button type="submit" style={btnGreen} disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : "Gem ny adgangskode"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

function AuthScreen({ onAuthed, booting }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e?.preventDefault?.();
    setError(""); setInfo(""); setLoading(true);
    try {
      if (mode === "signup") {
        const uname = username.trim();
        if (!uname) { setError("Vælg et brugernavn"); setLoading(false); return; }
        if (uname.length < 2 || uname.length > 20) { setError("Brugernavnet skal være 2–20 tegn"); setLoading(false); return; }
        // Længden tjekkes HER og ikke kun af serveren. GoTrue afviser først
        // efter et rundturskald, og svaret er engelsk — en bruger, der lige har
        // valgt en for kort kode, skal ikke vente på et netværkskald for at få
        // det at vide. Grænsen er GoTrues egen standard.
        if (password.length < 6) { setError("Adgangskoden skal være mindst 6 tegn"); setLoading(false); return; }
        const available = await auth.checkUsername(uname);
        if (!available) { setError("Brugernavnet er allerede taget. Vælg et andet."); setLoading(false); return; }
        const res = await auth.signUp(email, password);
        if (res.access_token) { await onAuthed(res, uname, "signup"); return; }
        setInfo("Konto oprettet. Har du fået en bekræftelses-mail, skal du følge linket i den — log derefter ind.");
        setMode("signin");
      } else if (mode === "forgot") {
        await auth.recover(email);
        setInfo("Hvis e-mailen findes, er der sendt et link til at nulstille adgangskoden.");
      } else {
        const res = await auth.signIn(email, password);
        await onAuthed(res, undefined, "signin");
      }
    } catch (e2) {
      setError(daAuthError(e2.message));
    } finally {
      setLoading(false);
    }
  }

  const skift = (næste) => { setMode(næste); setError(""); setInfo(""); };

  return (
    <AuthShell>
      <p style={muted}>{mode === "signin" ? "Log ind" : mode === "signup" ? "Opret konto" : "Nulstil adgangskode"}</p>
      <form onSubmit={submit}>
        {mode === "signup" && (
          <Field id="brugernavn" label="Brugernavn (vises for andre)" maxLength={20}
            autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        )}
        {/* `type="email"` giver telefonen et tastatur med @ og punktum. */}
        <Field id="email" label="E-mail" type="email" autoComplete="email" inputMode="email"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        {mode !== "forgot" && (
          // `new-password` ved oprettelse og `current-password` ved login er
          // det, der afgør, om adgangskode-manageren TILBYDER at gemme koden
          // eller udfylder den kendte. Samme felt, to forskellige kontrakter.
          <Field id="kodeord" label="Adgangskode" type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
        {error && <p role="alert" style={{ color: C.red, fontSize: 13 }}>{error}</p>}
        {/* Bekræftelser er ikke fejl, så `status` frem for `alert`: den læses op,
            når skærmlæseren har tid, i stedet for at afbryde. */}
        {info && <p role="status" style={{ color: C.green, fontSize: 13 }}>{info}</p>}
        <button type="submit" style={btnGreen} disabled={loading || booting}>
          {loading || booting ? <Loader2 size={16} className="spin" /> : mode === "signin" ? "Log ind" : mode === "signup" ? "Opret konto" : "Send nulstillingslink"}
        </button>
      </form>
      {mode === "signin" && (
        <LinkButton style={{ marginTop: 12 }} onClick={() => skift("forgot")}>Glemt adgangskode?</LinkButton>
      )}
      <LinkButton style={{ marginTop: 2 }} onClick={() => skift(mode === "signup" || mode === "forgot" ? "signin" : "signup")}>
        {mode === "signup" ? "Har du allerede en konto? Log ind" : mode === "forgot" ? "Tilbage til login" : "Ny bruger? Opret konto"}
      </LinkButton>
    </AuthShell>
  );
}

export { AuthScreen, ResetPasswordScreen };
