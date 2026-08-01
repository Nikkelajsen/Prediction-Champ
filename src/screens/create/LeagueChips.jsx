// Turneringsfilter med "null betyder alle" — fælles for Quick Pick/League og
// Custom-håndpluk. Før galleriet (I14) lå tre kopier af denne chip-række inline
// i opret-skærmen med hver sin state-form; nu er reglen ét sted: mindst én
// turnering skal være valgt, så et klik, der ville fjerne den sidste, ignoreres.
import { chip } from "../../ui/theme.js";

function LeagueChips({ leagues, selectedIds, onChange }) {
  if (leagues.length <= 1) return null;
  const base = selectedIds || leagues.map((l) => l.id);
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {leagues.map((l) => {
        const sel = base.includes(l.id);
        return (
          <button key={l.id} type="button" aria-pressed={sel} style={chip(sel)}
            onClick={() => {
              const next = sel ? base.filter((x) => x !== l.id) : [...base, l.id];
              onChange(next.length ? next : base);
            }}>
            {sel ? "✓ " : ""}{l.name}
          </button>
        );
      })}
    </div>
  );
}

export default LeagueChips;
