// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { C, font, muted } from "../ui/theme.js";
import { BackBar, Card } from "../ui/components.jsx";

function HowItWorksScreen({ onBack }) {
  const Section = ({ title, children }) => (
    <Card>
      <div style={{ fontFamily: font.display, fontSize: 18, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>{title}</div>
      <div style={{ color: C.text, fontSize: 14, lineHeight: 1.55 }}>{children}</div>
    </Card>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BackBar title="Sådan virker det" onBack={onBack} />
      <Section title="Pointsystem">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div><span style={{ color: C.green, fontWeight: 700 }}>+3</span> for præcist resultat (fx gættet 2-1, endte 2-1).</div>
          <div><span style={{ color: "#7fd48a", fontWeight: 700 }}>+1</span> for korrekt udfald (rigtig vinder/uafgjort, forkert resultat).</div>
          <div><span style={{ color: C.muted, fontWeight: 700 }}>0</span> ellers. Ingen minuspoint — du kan aldrig gå i minus.</div>
        </div>
      </Section>
      <Section title="Tiebreak">
        Ved pointlighed afgør flest <b>præcise resultater</b> først, dernæst flest <b>korrekte udfald</b>.
      </Section>
      <Section title="Rating">
        Parvis multiplayer-Elo. Alle starter på <b>1000</b>. Du stiger, hvis du rammer bedre end de andre i runden, og falder, hvis du rammer dårligere — det tæller ekstra at slå spillere med høj rating. Beregnes én gang pr. runde ud fra dine gennemsnitspoint pr. kamp. De første 5 runder er foreløbige (<b>NY</b>-badge).
      </Section>
      <Section title="Månedsliga & Championship">
        <b>Championship</b> er officielle konkurrencer, hvor alle automatisk er med. <b>Månedsligaen</b> samler dine samlede point for månedens kampe (tiebreak: flest præcise). Månedens bedste kåres som <b>Månedens Prediction Champ</b>, og stillingen nulstilles den 1.
      </Section>
      <Section title="Tips-synlighed">
        Du kan først se andres tips, når runden er låst — ingen kan se dine tips inden da. Alle kampe i en runde låses samtidig, 1 time før rundens første kamp. Så tipper alle på samme grundlag og ingen kan spekulere i resultater undervejs.
      </Section>
      <Section title="Rullende gætte-vindue">
        Nogle ligaer bruger et rullende vindue: en runde kan først tippes et bestemt antal dage før rundens første kamp (typisk 7). Så tipper alle med nogenlunde samme viden. Det vælges, når konkurrencen oprettes.
      </Section>
    </div>
  );
}

export default HowItWorksScreen;
