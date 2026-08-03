// Kortoverskriften med plads til filtre.
//
// Udskilt fra ChampionshipTab.jsx den 3. august 2026 (G1). Ren flytning.
import { font } from "../../ui/theme.js";

//
// Titlen er `display: block`, ikke flex, så ⓘ'en flyder med som et ord efter det
// sidste ord frem for at blive skubbet ud i højre kant af en linje, teksten ikke
// selv fylder. Prisen er, at den kan brydes NED alene — "Rundens Prediction
// Champ" fylder præcis én linje på en iPhone, og så stod ⓘ'en for sig selv på
// den næste. Derfor er sidste ord og ikonet bundet sammen i én `nowrap`-enhed:
// de flytter linje sammen. Titlen tages som tekst og ikonet som `info` netop for
// at gøre den binding mulig — en færdig JSX-titel kan man ikke finde sidste ord i.
export function CardHead({ title, info, children }) {
  const words = String(title).split(" ");
  const last = words.pop();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <div style={{
        fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase",
        lineHeight: 1.15, flex: "1 1 60%", minWidth: 0,
      }}>
        {words.length > 0 && `${words.join(" ")} `}
        <span style={{ whiteSpace: "nowrap" }}>{last}{info && <>{" "}{info}</>}</span>
      </div>
      {children && (
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: 6, flex: "0 1 auto", minWidth: 0, marginLeft: "auto" }}>
          {children}
        </div>
      )}
    </div>
  );
}
