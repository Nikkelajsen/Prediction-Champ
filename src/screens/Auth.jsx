// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState } from "react";
import { Crown, Loader2 } from "lucide-react";
import { auth } from "../lib/supabase.js";
import { C, btnGreen, fieldFull, font, muted, wrapOuter } from "../ui/theme.js";
import { Card } from "../ui/components.jsx";

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

  async function submit() {
    setError("");
    if (password.length < 6) { setError("Adgangskoden skal være mindst 6 tegn"); return; }
    if (password !== confirm) { setError("Adgangskoderne er ikke ens"); return; }
    setLoading(true);
    try {
      await auth.updatePassword(accessToken, password);
      setDone(true);
    } catch (e) {
      setError(e.message || "Noget gik galt");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <p style={muted}>Vælg et nyt kodeord til din konto.</p>
      {done ? (
        <>
          <p style={{ color: C.green, fontSize: 14 }}>Kodeord opdateret! Du kan nu logge ind.</p>
          <button style={btnGreen} onClick={onDone}>Til login</button>
        </>
      ) : (
        <>
          <input className="field" style={fieldFull} type="password" placeholder="Nyt kodeord" value={password} onChange={(e) => setPassword(e.target.value)} />
          <input className="field" style={fieldFull} type="password" placeholder="Gentag kodeord" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {error && <p style={{ color: C.red, fontSize: 13 }}>{error}</p>}
          <button style={btnGreen} onClick={submit} disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : "Gem nyt kodeord"}
          </button>
        </>
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

  async function submit() {
    setError(""); setInfo(""); setLoading(true);
    try {
      if (mode === "signup") {
        const uname = username.trim();
        if (!uname) { setError("Vælg et brugernavn"); setLoading(false); return; }
        if (uname.length < 2 || uname.length > 20) { setError("Brugernavnet skal være 2–20 tegn"); setLoading(false); return; }
        const available = await auth.checkUsername(uname);
        if (!available) { setError("Brugernavnet er allerede taget. Vælg et andet."); setLoading(false); return; }
        const res = await auth.signUp(email, password);
        if (res.access_token) { await onAuthed(res, uname); return; }
        setInfo("Konto oprettet. Tjek om der kræves e-mail-bekræftelse i Supabase-projektet, log derefter ind.");
        setMode("signin");
      } else if (mode === "forgot") {
        await auth.recover(email);
        setInfo("Hvis e-mailen findes, er der sendt et link til at nulstille kodeordet.");
      } else {
        const res = await auth.signIn(email, password);
        await onAuthed(res);
      }
    } catch (e) {
      setError(e.message || "Noget gik galt");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <p style={muted}>{mode === "signin" ? "Log ind" : mode === "signup" ? "Opret konto" : "Nulstil kodeord"}</p>
      {mode === "signup" && (
        <input className="field" style={fieldFull} maxLength={20} placeholder="Brugernavn (vises for andre)" value={username} onChange={(e) => setUsername(e.target.value)} />
      )}
      <input className="field" style={fieldFull} placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
      {mode !== "forgot" && (
        <input className="field" style={fieldFull} type="password" placeholder="Adgangskode" value={password} onChange={(e) => setPassword(e.target.value)} />
      )}
      {error && <p style={{ color: C.red, fontSize: 13 }}>{error}</p>}
      {info && <p style={{ color: C.green, fontSize: 13 }}>{info}</p>}
      <button style={btnGreen} onClick={submit} disabled={loading || booting}>
        {loading || booting ? <Loader2 size={16} className="spin" /> : mode === "signin" ? "Log ind" : mode === "signup" ? "Opret konto" : "Send nulstillingslink"}
      </button>
      {mode === "signin" && (
        <p style={{ ...muted, marginTop: 12, textAlign: "center", cursor: "pointer" }}
          onClick={() => { setMode("forgot"); setError(""); setInfo(""); }}>
          Glemt kodeord?
        </p>
      )}
      <p style={{ ...muted, marginTop: 6, marginBottom: 0, textAlign: "center", cursor: "pointer" }}
        onClick={() => { setMode(mode === "signup" ? "signin" : mode === "forgot" ? "signin" : "signup"); setError(""); setInfo(""); }}>
        {mode === "signup" ? "Har du allerede en konto? Log ind" : mode === "forgot" ? "Tilbage til login" : "Ny bruger? Opret konto"}
      </p>
    </AuthShell>
  );
}

export { AuthScreen, ResetPasswordScreen };
