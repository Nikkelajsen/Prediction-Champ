// Sikkerhedsnettet om app-roden (G20). Uden den blanker ét render-kast hele
// appen: der er ingen router til at isolere en rute, så et hvidt vindue er
// eneste udfald — og fordi der heller ingen fejltelemetri er (G42), efterlader
// det nul spor hos den, det ramte.
//
// Klassekomponent, fordi det er den ENESTE måde: React udstiller hverken
// getDerivedStateFromError eller componentDidCatch som hooks.
import React from "react";
import { C, font, globalCss, wrapOuter } from "./theme.js";

// Fallbacken må ikke selv kunne kaste. Den læser derfor kun statiske
// theme-objekter — ingen props, ingen data, intet netværk. Og den bærer sin
// egen <style>: globalCss injiceres inde i App (App.jsx:110,122,132), så en
// fejl DÉR ville ellers efterlade fallbacken uden appens skrifttyper.
function Fallback() {
  return (
    <div style={wrapOuter}>
      <style>{globalCss}</style>
      <div style={{ maxWidth: 430, padding: "60px 24px", textAlign: "center" }}>
        <div style={{
          fontFamily: font.display, fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.08em", fontSize: 22, color: C.text, marginBottom: 10,
        }}>
          Noget gik galt
        </div>
        <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.6, margin: "0 0 20px" }}>
          Appen ramte en uventet fejl og kunne ikke tegne skærmen færdig.
          Dine tips er gemt — genindlæs for at komme videre.
        </p>
        {/* Genindlæsning og ikke "prøv igen": en boundary om roden har intet at
            navigere hen til, og den tilstand, der fremkaldte kastet, ligger i
            netop den træ-instans, der lige er revet ned. */}
        <button type="button" onClick={() => window.location.reload()} style={{
          padding: "10px 18px", borderRadius: 10, border: "none", background: C.green,
          color: "#06110A", fontWeight: 700, fontSize: 15, fontFamily: font.body, cursor: "pointer",
        }}>
          Genindlæs appen
        </button>
      </div>
    </div>
  );
}

// Fallback for en boundary om ÉN skærm frem for om roden.
//
// Forskellen er handlingen: her ER der noget at navigere hen til, fordi
// app-skallen og bundnavigationen står uden for boundaryen og lever videre.
// "Genindlæs appen" ville derfor være at foreslå det dyreste af de mulige
// udveje — brugeren kan bare gå et andet sted hen, og skærmen nulstilles af
// sig selv, når de kommer tilbage (se `key` i MainApp).
function ScreenFallback() {
  return (
    <div style={{ paddingTop: 40 }}>
      <p style={{ color: C.red, fontSize: 14, lineHeight: 1.6, margin: "0 0 6px" }}>
        Denne skærm kunne ikke tegnes færdig.
      </p>
      <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, margin: 0 }}>
        Dine tips er gemt. Skift til en anden fane og tilbage — så prøver skærmen forfra.
      </p>
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    // Konsollen er det eneste sted, en fejl kan lande i dag — der er ingen
    // fejltelemetri i frontenden (G42). Når den kommer, er det HER, den kobles på.
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  render() {
    // `fallback` gør komponenten brugbar begge steder: om roden (den fulde
    // side med "Genindlæs") og om én skærm (den lille tekst, der lader
    // navigationen stå). Der findes bevidst INGEN "prøv igen"-knap: den
    // tilstand, der fremkaldte kastet, ligger i netop den træ-instans, der lige
    // er revet ned — nulstillingen sker ved at skifte `key`, altså ved at
    // navigere, hvilket er det, teksten beder om.
    if (!this.state.failed) return this.props.children;
    return this.props.fallback ?? <Fallback />;
  }
}

export { ErrorBoundary, Fallback, ScreenFallback };
export default ErrorBoundary;
