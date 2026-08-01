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
    return this.state.failed ? <Fallback /> : this.props.children;
  }
}

export { ErrorBoundary, Fallback };
export default ErrorBoundary;
