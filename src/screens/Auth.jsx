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
import { Loader2 } from "lucide-react";
import { auth } from "../lib/supabase.js";
import { invitationsPitch } from "../lib/data.js";
import { turnstileAktiv } from "../lib/turnstile.js";
import { C, btnGreen, fieldFull, muted, wrapOuter } from "../ui/theme.js";
import { Card } from "../ui/components.jsx";
import { Turnstile, TurnstileVenter } from "../ui/Turnstile.jsx";
import { Wordmark } from "../ui/Wordmark.jsx";
import { findDokument, MINDSTEALDER } from "../lib/legal.js";
import LegalDocument from "./LegalDocument.jsx";

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

// Inline-link i en sætning. LinkButton kan ikke bruges: den er `width: 100%`
// og lægger sig som sin egen blok, hvilket river sætningen fra hinanden.
// `type="button"` er stadig ikke til forhandling, selvom linjen ligger uden
// for formularen — reglen er billigere at holde ubetinget end at vurdere.
function TekstLink({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} style={{
      background: "none", border: "none", padding: 0, font: "inherit",
      color: C.green, textDecoration: "underline", cursor: "pointer",
    }}>
      {children}
    </button>
  );
}

// Jura-linjen (B4). Én komponent, to former, så teksten ikke står to steder.
//
// Den vises i ALLE tilstande og ikke kun ved oprettelse: dokumenterne skal
// kunne læses UDEN at oprette en konto, og login-skærmen er det eneste sted, en
// ikke-indlogget person overhovedet kan komme til dem. Ved oprettelse bærer den
// desuden selve samtykket — et link er ikke nok, når man skal acceptere noget.
function JuraLinje({ mode, onÅbn }) {
  const stil = { ...muted, fontSize: 11, lineHeight: 1.5, textAlign: "center", margin: "14px 0 0" };
  if (mode === "signup") {
    return (
      <p style={stil}>
        Ved at oprette en konto accepterer du{" "}
        <TekstLink onClick={() => onÅbn("vilkaar")}>brugervilkårene</TekstLink> og{" "}
        <TekstLink onClick={() => onÅbn("privatliv")}>privatlivspolitikken</TekstLink>.
        {" "}Du skal være mindst {MINDSTEALDER} år.
      </p>
    );
  }
  return (
    <p style={stil}>
      <TekstLink onClick={() => onÅbn("privatliv")}>Privatlivspolitik</TekstLink>
      {" · "}
      <TekstLink onClick={() => onÅbn("vilkaar")}>Brugervilkår</TekstLink>
    </p>
  );
}

// GoTrues fejl kommer på engelsk i en ellers dansk app. De tre nedenfor er dem,
// en bruger realistisk rammer; alt andet vises som det kommer, fordi en tavs
// omskrivning af en ukendt fejl ville gøre fejlsøgning sværere end den engelske
// tekst gør det for brugeren.
//
// Den fjerde er bot-værnets (`B26`) og hører her af en anden grund end de tre
// første: den rammer en bruger, der intet har gjort forkert. Er Turnstile-
// scriptet blokeret af en annonceblokering — eller er kvitteringen udløbet,
// mens formularen stod åben — svarer GoTrue "captcha protection: request
// disallowed", og uden en oversættelse ville en helt almindelig person møde en
// engelsk sætning om captchas på den skærm, de skal igennem for at komme ind.
const AUTH_FEJL = [
  [/invalid login credentials/i, "Forkert e-mail eller adgangskode."],
  [/user already registered/i, "Der findes allerede en konto med den e-mail. Log ind i stedet."],
  [/password should be at least/i, "Adgangskoden er for kort — den skal være mindst 6 tegn."],
  [/unable to validate email|invalid format/i, "E-mailen ser ikke rigtig ud."],
  [/captcha/i, "Bot-tjekket kunne ikke gennemføres. Prøv igen — hjælper det ikke, så genindlæs siden."],
  // Femte linje, tilføjet 10. august 2026 efter `B26`s første kørsel. Den ramte
  // en rigtig bruger: han oprettede sig, mens bekræftelsen var slået til, nåede
  // ikke at følge linket inden for den time, det gælder, og fik derefter
  // "Noget gik galt" — en tekst, der hverken siger, hvad der er galt, eller
  // hvad man gør ved det. Hans konto FANDTES; den manglede ét klik.
  [/email not confirmed/i, "Din e-mail er ikke bekræftet endnu. Følg linket i bekræftelses-mailen — kig også i spam."],
];

export function daAuthError(besked) {
  const tekst = String(besked || "");
  for (const [m, da] of AUTH_FEJL) if (m.test(tekst)) return da;
  return tekst || "Noget gik galt";
}

// `bred` bruges kun af jura-visningen: en politik i en 320 px kolonne er
// ulæselig. Default er uændret, så de tre login-tilstande og
// ResetPasswordScreen ser præcis ud som før.
//
// `invitation` (I7) er previewet af den kode, adressen bar — hentet uden login,
// fordi `invite_preview()` er åben for `anon`. Den ERSTATTER den generelle
// sælgetekst, og det er hele forskellen mellem "en login-side" og "en
// invitation": indtil august 2026 landede en helt ny bruger, der trykkede på et
// invitationslink, på en formular uden en antydning af, hvorfor de var der.
//
// Udebliver previewet — ukendt kode, langsomt net, en fejl — står den generelle
// tekst der stadig. Det er derfor `invitationsPitch` returnerer `null` frem for
// at kaste: der er ingen fejltilstand at vise, kun to gode skærme.
function AuthShell({ children, bred, invitation }) {
  const pitch = invitationsPitch(invitation);
  return (
    <div style={{ ...wrapOuter, alignItems: "flex-start" }}>
      <div style={{ width: "100%", maxWidth: 430, padding: "60px 18px", display: "flex", justifyContent: "center" }}>
        <Card style={{ width: bred ? "100%" : 320 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Wordmark size={16} />
          </div>
          {/* Hvad er det her? — besvaret FØR der bedes om en e-mail. */}
          {pitch ? (
            <div style={{ margin: "0 0 14px" }}>
              <p style={{ color: C.text, fontSize: 14, lineHeight: 1.45, margin: "0 0 4px", fontWeight: 600 }}>
                {pitch.overskrift}
              </p>
              <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.45, margin: 0 }}>{pitch.detalje}</p>
            </div>
          ) : (
            <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.45, margin: "0 0 14px" }}>
              Gæt resultater mod dine venner. Opret en liga, tip ugens kampe, og se hvem der er bedst.
            </p>
          )}
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

function AuthScreen({ onAuthed, booting, invitation, harInvitation }) {
  // Med en invitation i hånden starter skærmen på OPRET og ikke på LOG IND
  // (I7). Den, der trykker på et invitationslink, har som regel ingen konto —
  // og "Har du allerede en konto? Log ind" står lige under knappen.
  //
  // Valget hænger på `harInvitation` og IKKE på `invitation`: previewet hentes
  // asynkront og er `null` ved den første render, mens KODEN står i adressen fra
  // begyndelsen. Og det skal netop være en startværdi frem for en effekt, der
  // retter tilstanden bagefter — en effekt ville kunne flytte en bruger, der
  // allerede havde trykket "Log ind", tilbage til oprettelsen, i det sekund
  // opslaget svarede.
  const [mode, setMode] = useState(harInvitation ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  // Jura-visningen er en EGEN tilstand og ikke en fjerde `mode`. `mode` styrer
  // fem ting, og tre af dem er kæder, hvis fallback er "forgot" — en fjerde
  // værdi ville give overskriften "Nulstil adgangskode", knapteksten "Send
  // nulstillingslink", og værst: submit()'s else-gren kalder auth.signIn(), så
  // et Enter-tryk på en politik-side ville forsøge et login.
  const [jura, setJura] = useState(null); // null | "privatliv" | "vilkaar"
  // Bot-værnet (`B26`). Begge er døde værdier, når `VITE_TURNSTILE_SITE_KEY`
  // ikke er sat: widgeten tegner intet og kalder aldrig `setCaptchaToken`, og
  // `medCaptcha()` i supabase.js udelader feltet, når tokenen er tom.
  //
  // `captchaNonce` er tælleren, der beder om en FRISK udfordring. Kvitteringen
  // er engangs og bruges op af det kald, den blev sendt med — også når kaldet
  // fejler. Uden en nulstilling ville anden forsøg på en forkert adgangskode
  // blive afvist af captcha'en i stedet, altså med en fejl om noget helt andet
  // end det, brugeren rettede.
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaNonce, setCaptchaNonce] = useState(0);

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
        // `displayName` sendes med som brugermetadata, så navnet overlever en
        // bekræftelses-mail (B26): svarer signup uden session, findes der
        // ingen token at skrive `profiles` med, og valget ville ellers være
        // tabt, når brugeren kom tilbage fra mailen.
        const res = await auth.signUp(email, password, { captchaToken, displayName: uname });
        if (res.access_token) { await onAuthed(res, uname, "signup"); return; }
        setInfo("Konto oprettet. Har du fået en bekræftelses-mail, skal du følge linket i den — log derefter ind.");
        setMode("signin");
      } else if (mode === "forgot") {
        await auth.recover(email, captchaToken);
        setInfo("Hvis e-mailen findes, er der sendt et link til at nulstille adgangskoden.");
      } else {
        const res = await auth.signIn(email, password, captchaToken);
        await onAuthed(res, undefined, "signin");
      }
    } catch (e2) {
      setError(daAuthError(e2.message));
    } finally {
      setLoading(false);
      // Efter HVERT forsøg, også et vellykket, der ikke navigerede væk
      // (oprettelse med bekræftelse slået til): kvitteringen er brugt op.
      setCaptchaToken("");
      setCaptchaNonce((n) => n + 1);
    }
  }

  const skift = (næste) => { setMode(næste); setError(""); setInfo(""); };

  // Kun formularen afmonteres — `email`, `password`, `username` og `mode` bor i
  // AuthScreen og overlever. Man kommer derfor tilbage til præcis den
  // oprettelse, man forlod, uden at skulle skrive noget igen. Det er hele
  // argumentet for et tidligt return frem for en ny værdi i `mode`.
  if (jura) {
    return (
      <AuthShell bred invitation={invitation}>
        <LegalDocument doc={findDokument(jura)} />
        <LinkButton style={{ marginTop: 12 }} onClick={() => setJura(null)}>Tilbage</LinkButton>
      </AuthShell>
    );
  }

  return (
    <AuthShell invitation={invitation}>
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
        {/* Bot-værnet (`B26`) står i ALLE tre tilstande, fordi Supabases Bot
            Protection gør det samme: knappen dækker signup, login OG
            nulstilling under ét. Et værn kun på oprettelsen ville lade
            adgangskode-gætteriet stå åbent — og ville sende login af sted uden
            den kvittering, GoTrue så kræver.

            Komponenten tegner intet uden en nøgle, så indtil knappen i
            Supabase trykkes, ser skærmen ud præcis som før. */}
        <Turnstile onToken={setCaptchaToken} nulstil={captchaNonce} handling="auth" />
        <TurnstileVenter vises={turnstileAktiv() && !captchaToken} />
        {/* Knappen deaktiveres IKKE, mens kvitteringen mangler. Det ville være
            den pæne løsning lige indtil den dag, scriptet er blokeret — og så
            ville login være lukket uden en fejl at læse. I stedet sendes
            forsøget, og GoTrues afvisning oversættes af `daAuthError`. */}
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
      <JuraLinje mode={mode} onÅbn={setJura} />
    </AuthShell>
  );
}

export { AuthScreen, ResetPasswordScreen, JuraLinje };
