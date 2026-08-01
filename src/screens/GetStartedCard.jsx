// "Kom godt i gang" — checklisten på Hjem.
// Spec: docs/features/onboarding-v1.md.
//
// Det lag, der fanger dem, som sprang guiden over eller blev afbrudt midtvejs.
// Kortet er ikke-blokerende og ligger UNDER deadline-kortet: har man først en
// konkurrence, er næste deadline vigtigere end resten af listen.
//
// Trinnene udledes af rigtige data (src/lib/onboarding.js), så kortet ikke kan
// påstå noget forkert — og forsvinder af sig selv, når alt er klaret.
import { Check, ChevronRight, X } from "lucide-react";
import { C, font, iconBtn } from "../ui/theme.js";
import { Card, Eyebrow } from "../ui/components.jsx";

function StepRow({ step, action, top }) {
  const clickable = !step.done && !!action;
  return (
    <div
      onClick={clickable ? action : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); action(); } } : undefined}
      style={{
        display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0",
        borderTop: top ? `1px solid ${C.line}` : "none",
        cursor: clickable ? "pointer" : "default",
      }}
    >
      {/* Færdig = grønt flueben. Uafsluttet = tom ring, ikke et tal: listen er en
          tilstand man kan se, ikke en rangorden man skal læse. */}
      <span style={{
        flexShrink: 0, marginTop: 1, width: 18, height: 18, borderRadius: "50%",
        border: step.done ? "none" : `1.5px solid ${C.line}`,
        background: step.done ? "rgba(34,197,94,0.16)" : "transparent",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}>
        {step.done && <Check size={12} color={C.green} strokeWidth={3} />}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{
          fontSize: 14, display: "block",
          color: step.done ? C.muted : C.text,
          textDecoration: step.done ? "line-through" : "none",
        }}>
          {step.label}
        </span>
        {/* Kun det uafsluttede trin forklarer sig — ellers bliver kortet en mur. */}
        {!step.done && <span style={{ color: C.muted, fontSize: 12, display: "block", marginTop: 2 }}>{step.hint}</span>}
      </span>
      {clickable && <ChevronRight size={16} color={C.muted} style={{ flexShrink: 0, marginTop: 2 }} />}
    </div>
  );
}

// `actions` er en opslagstabel fra trin-id til handling, så kortet ikke selv
// kender navigationen.
function GetStartedCard({ onboarding, actions = {}, push, onDismiss }) {
  if (!onboarding || onboarding.complete) return null;

  const steps = [...onboarding.steps];
  // Notifikationer er et ekstra trin, ikke et krav: det vises kun, når browseren
  // kan, og brugeren hverken har sagt ja eller nej endnu. Derfor tæller det
  // heller ikke med i "X af Y" — ellers ville tælleren hoppe mellem enheder.
  if (push?.available) {
    steps.push({ id: "push", done: false, label: "Få besked før deadline", hint: "Vi minder dig om at tippe, inden kampene låser." });
  }

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <Eyebrow>Kom godt i gang</Eyebrow>
          <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase", marginTop: -4 }}>
            {onboarding.doneCount} af {onboarding.steps.length} klaret
          </div>
        </div>
        <button style={iconBtn} aria-label="Skjul" onClick={onDismiss}><X size={16} /></button>
      </div>
      <div style={{ marginTop: 6 }}>
        {steps.map((s, i) => (
          <StepRow key={s.id} step={s} top={i > 0}
            action={s.id === "push" ? push?.enable : actions[s.id]} />
        ))}
      </div>
      {push?.available && push.error && (
        <div style={{ color: C.red, fontSize: 13, marginTop: 8 }}>{push.error}</div>
      )}
    </Card>
  );
}

export default GetStartedCard;
export {  };
