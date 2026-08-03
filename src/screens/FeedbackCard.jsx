// "Send os en melding" (B14): brugerens ene vej til udvikleren.
//
// HVOR DEN BOR OG HVORFOR. Kortet ligger nederst i "Sådan virker det" ved siden
// af versionsstemplet — den skærm er ét tryk væk fra ⓘ i toppen af ENHVER
// skærm, og den er i forvejen det sted, man går hen, når man ikke forstår
// noget. Profil var det oplagte alternativ, men det er også det sted, ingen er,
// når noget går galt.
//
// Formularen er en rigtig `<form>` af samme grund som Auth.jsx (G28): Enter
// sender, feltet har et navn, en skærmlæser kan læse, og knappen er en knap.
import { useState, useId } from "react";
import { Loader2, MessageSquarePlus, Check } from "lucide-react";
import { C, btnGhost, btnGold, chip, font, muted } from "../ui/theme.js";
import { Card, Modal } from "../ui/components.jsx";
import { KINDS, MESSAGE_MAX, sendFeedback } from "../lib/data/feedback.js";

function FeedbackForm({ token, screen, onDone }) {
  const [kind, setKind] = useState("problem");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const feltId = useId();

  async function submit(e) {
    e.preventDefault();
    setSending(true);
    setErr("");
    try {
      await sendFeedback(token, { kind, message, screen });
      onDone();
    } catch (e2) {
      // Ikke tavs, modsat analytics: brugeren venter på et svar, og en
      // melding, de tror er sendt, skrives ikke igen.
      setErr(String(e2?.message ?? e2) || "Beskeden kunne ikke sendes.");
    } finally {
      setSending(false);
    }
  }

  const tilbage = MESSAGE_MAX - message.length;

  return (
    <form onSubmit={submit}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {KINDS.map((k) => (
          // aria-pressed frem for radioknapper: chip-rækken er samme mønster
          // som resten af appen, og en skærmlæser skal stadig kunne høre,
          // hvilken der er valgt.
          <button key={k.key} type="button" aria-pressed={kind === k.key}
            style={chip(kind === k.key)} onClick={() => setKind(k.key)}>
            {k.label}
          </button>
        ))}
      </div>

      <label className="srOnly" htmlFor={feltId}>Din melding</label>
      <textarea id={feltId} className="field" rows={5} maxLength={MESSAGE_MAX}
        value={message} onChange={(e) => setMessage(e.target.value)}
        placeholder="Hvad skete der? Hvad havde du forventet?"
        style={{ width: "100%", display: "block", resize: "vertical", fontFamily: font.body }} />

      {/* Hvad der følger med. Står FØR knappen og ikke i en politik, ingen
          læser: sender man noget videre om en bruger, skal de kunne se det i
          det øjeblik, de trykker. */}
      <p style={{ ...muted, fontSize: 11, margin: "8px 0 0", lineHeight: 1.5 }}>
        Vi sender automatisk appens version, hvilken skærm du var på, og hvilken
        browser du bruger — ellers kan de fleste fejl ikke findes igen. Intet
        andet følger med.
      </p>

      {err && <p style={{ color: C.red, fontSize: 13, margin: "10px 0 0" }}>{err}</p>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 12 }}>
        <span style={{ ...muted, fontSize: 11 }}>{tilbage} tegn tilbage</span>
        <button type="submit" style={btnGold} disabled={sending || message.trim().length < 4}>
          {sending ? <Loader2 size={15} className="spin" /> : <MessageSquarePlus size={15} />} Send
        </button>
      </div>
    </form>
  );
}

function FeedbackCard({ token, screen = "how" }) {
  const [open, setOpen] = useState(false);
  const [sendt, setSendt] = useState(false);

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 60%", minWidth: 0 }}>
          <div style={{ fontFamily: font.display, fontSize: 18, fontWeight: 700, textTransform: "uppercase" }}>
            Sig til
          </div>
          <p style={{ ...muted, margin: "4px 0 0", fontSize: 13, lineHeight: 1.5 }}>
            Virker noget ikke, eller mangler du noget? Skriv det her — det er den
            eneste måde, vi hører det på.
          </p>
        </div>
        <button type="button" style={btnGhost} onClick={() => { setSendt(false); setOpen(true); }}>
          <MessageSquarePlus size={14} /> Skriv til os
        </button>
      </div>

      {/* Kvitteringen bliver STÅENDE på kortet efter dialogen lukkes. En
          bekræftelse, der forsvinder sammen med det, den bekræfter, er ikke en
          bekræftelse — det var netop dét, der gjorde et fejlet gem på
          tip-skærmen umuligt at skelne fra et gennemført (G24). */}
      {sendt && (
        <p style={{ color: C.green, fontSize: 13, margin: "12px 0 0", display: "flex", alignItems: "center", gap: 6 }}>
          <Check size={15} /> Tak — beskeden er sendt. Vi svarer ikke på hver enkelt, men vi læser dem alle.
        </p>
      )}

      {open && (
        <Modal title="Skriv til os" onClose={() => setOpen(false)}>
          <FeedbackForm token={token} screen={screen}
            onDone={() => { setOpen(false); setSendt(true); }} />
        </Modal>
      )}
    </Card>
  );
}

export default FeedbackCard;
export { FeedbackForm };
