// Opret-flowets første skærm (I14): konkurrence-typerne som kort. Rækkefølgen
// kommer fra CREATE_TYPES og er varigheds-spørgsmålet — langt → kort — så det
// øverste kort både er det, produktet anbefaler, og det, der lever længst.
//
// Kortet bærer to akser, fordi det er dem, typerne adskiller sig på: HVILKE
// kampe (beskrivelsen) og HVOR LÆNGE (varigheds-mærkaten). Mærkaten står som
// sin egen linje, så forskellen kan aflæses uden at læse beskrivelsen.
import { CalendarRange, Shuffle, SlidersHorizontal, Star, Swords, Ticket } from "lucide-react";
import { CREATE_TYPES } from "../../lib/createTypes.js";
import { StateChip } from "../../ui/components.jsx";
import { C, font } from "../../ui/theme.js";

// Ikonet hører til her og ikke i createTypes.js: dét er ren data og skal kunne
// unit-testes uden render. Nøglen er korttypens id, ikke mode — to kort deler
// mode `random`, men er visuelt forskellige typer.
const ICONS = {
  season: CalendarRange,
  team: Star,
  quick_league: Swords,
  quick_pick: Shuffle,
  weekly_coupon: Ticket,
  custom: SlidersHorizontal,
};

function TypeGallery({ onPick }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ color: C.muted, fontSize: 12 }}>Hvad vil I spille?</span>
      {CREATE_TYPES.map((t) => {
        const Icon = ICONS[t.id];
        return (
          <button key={t.id} type="button" onClick={() => onPick(t.id)}
            style={{
              display: "flex", gap: 10, alignItems: "flex-start",
              textAlign: "left", background: C.surface2,
              // Guldkanten er det anbefalede korts eneste ekstra fremhævning —
              // en fyldfarve ville låne betydning fra btnGold (en handling).
              border: `1px solid ${t.recommended ? C.gold : C.line}`,
              borderRadius: 12, padding: "12px 14px", cursor: "pointer", color: C.text,
            }}>
            {Icon && <Icon size={18} color={t.recommended ? C.gold : C.muted} style={{ flexShrink: 0, marginTop: 3 }} />}
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontFamily: font.display, textTransform: "uppercase", fontWeight: 700, fontSize: 17, letterSpacing: "0.02em" }}>
                  {t.title}
                </span>
                {t.recommended && <StateChip label="Anbefalet" tone="gold" />}
              </div>
              <div style={{ color: C.muted, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 3 }}>
                {t.duration}
              </div>
              <div style={{ color: C.muted, fontSize: 12.5, lineHeight: 1.4, marginTop: 2 }}>{t.subtitle}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export { ICONS };
export default TypeGallery;
