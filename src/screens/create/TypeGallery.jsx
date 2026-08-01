// Opret-flowets første skærm (I14): konkurrence-typerne som kort. Rækkefølgen
// kommer fra CREATE_TYPES og er varigheds-spørgsmålet — kort → langt — så det
// første valg samtidig svarer på, hvor længe konkurrencen skal leve.
import { CREATE_TYPES } from "../../lib/createTypes.js";
import { C, font } from "../../ui/theme.js";

function TypeGallery({ onPick }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ color: C.muted, fontSize: 12 }}>Hvad vil I spille?</span>
      {CREATE_TYPES.map((t) => (
        <button key={t.id} type="button" onClick={() => onPick(t.id)}
          style={{
            textAlign: "left", background: C.surface2, border: `1px solid ${C.line}`,
            borderRadius: 12, padding: "12px 14px", cursor: "pointer", color: C.text,
          }}>
          <div style={{ fontFamily: font.display, textTransform: "uppercase", fontWeight: 700, fontSize: 17, letterSpacing: "0.02em" }}>
            {t.title}
          </div>
          <div style={{ color: C.muted, fontSize: 12.5, lineHeight: 1.4, marginTop: 2 }}>{t.subtitle}</div>
        </button>
      ))}
    </div>
  );
}

export default TypeGallery;
