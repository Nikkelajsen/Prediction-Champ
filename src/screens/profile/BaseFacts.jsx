// Basistallene nederst på karriereprofilen — point, præcise, korrekte udfald,
// andel og antal tippede kampe.
//
// Kortet har bevidst ingen overskrift (spec afsnit 2: tallene skal være
// sekundære), så forklaringen hænger på en InfoDot i selve rækken.
// Ren flytning ud af `ProfileScreen.jsx` (G1, august 2026).
import { C } from "../../ui/theme.js";
import { Card, InfoDot } from "../../ui/components.jsx";

// Karriere-brede tal: ALLE tippede kampe, uanset hvilken konkurrence de blev
// tippet i (et tip er globalt pr. kamp).
function BaseFacts({ base, hitRate }) {
  return (
    <Card style={{ padding: 12, background: "transparent", borderStyle: "dashed" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 18px", color: C.muted, fontSize: 12 }}>
        <span><b style={{ color: C.text }}>{base.total_points}</b> point</span>
        <span>🎯 <b style={{ color: C.text }}>{base.exact_count}</b> præcise</span>
        {/* De korrekte udfald (+1) blev hentet i `base` uden nogensinde at blive
            vist, så cirka halvdelen af pointene var usynlige: 14 point kunne
            ikke stemme med 4 præcise, uden at man selv regnede resten ud. */}
        <span><b style={{ color: C.text }}>{base.outcome_count}</b> korrekte udfald</span>
        {/* hitRate = exact_count / matches — altså andelen af PRÆCISE resultater.
            "Træfsikkerhed" læses som "hvor ofte havde jeg ret", hvor et korrekt
            udfald (+1) uretfærdigt talte som en fejl. */}
        <span><b style={{ color: C.text }}>{hitRate}%</b> præcise pr. kamp</span>
        <span><b style={{ color: C.text }}>{base.matches}</b> tippede kampe</span>
        {/* Tallene først, forklaringen sidst — ikonet må ikke stå foran det,
            det handler om. */}
        <InfoDot title="Basistal">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>Tallene dækker <b>hele din karriere</b> — alle kampe du har tippet, uanset hvilken konkurrence de blev tippet i. Du tipper kun én gang pr. kamp, og tippet tæller alle de steder, kampen er med.</div>
            <div><b>Point</b> er 3 for et præcist resultat og 1 for et korrekt udfald. Derfor kan pointsummen ikke regnes ud af de præcise alene — de korrekte udfald står med.</div>
            <div><b>Præcise pr. kamp</b> er andelen af dine tips, der ramte resultatet helt. Et korrekt udfald tæller ikke med her, selvom det gav point.</div>
            <div>Tallene bruger samme regnestykke som Championship-fanen, så de altid stemmer med stillingerne.</div>
          </div>
        </InfoDot>
      </div>
    </Card>
  );
}

export default BaseFacts;
