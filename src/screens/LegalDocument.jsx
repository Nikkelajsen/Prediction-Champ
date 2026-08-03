// Visningen af et juridisk dokument (B4). Ren tekst, ingen tilstand.
//
// Komponenten tager hverken `token` eller callbacks og rører intet netværk —
// og dét er ikke tilfældigt, det er hele kontrakten. Den skal kunne vises to
// steder med vidt forskellige forudsætninger: inde i login-skærmen, hvor der
// hverken findes en session eller `MainApp`s skærm-maskineri, og som en
// almindelig skærm for en indlogget bruger.
//
// `Section`-mønstret er kopieret fra HowItWorksScreen frem for flyttet ud i en
// delt komponent: originalen er tre linjer og har ingen anden bruger, så en
// fælles abstraktion ville koste mere at læse, end den sparer at skrive.
import { C, font, muted } from "../ui/theme.js";
import { Card } from "../ui/components.jsx";

function Afsnit({ titel, tekst }) {
  return (
    <Card>
      <div style={{
        fontFamily: font.display, fontSize: 18, fontWeight: 700,
        textTransform: "uppercase", marginBottom: 6,
      }}>
        {titel}
      </div>
      <div style={{ color: C.text, fontSize: 14, lineHeight: 1.55, display: "flex", flexDirection: "column", gap: 8 }}>
        {tekst.map((t, i) =>
          typeof t === "string" ? (
            <p key={i} style={{ margin: 0 }}>{t}</p>
          ) : (
            <ul key={i} style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
              {t.punkter.map((p, j) => <li key={j}>{p}</li>)}
            </ul>
          )
        )}
      </div>
    </Card>
  );
}

function LegalDocument({ doc }) {
  // Et ukendt id er en tastefejl i et kaldsted, ikke noget brugeren har gjort.
  // Den skal derfor ses — en tom skærm ville ligne en indlæsning, der aldrig
  // blev færdig, og ingen ville lede efter årsagen i en propværdi.
  if (!doc) {
    return (
      <Card>
        <p style={{ ...muted, margin: 0, fontSize: 13 }}>
          Dokumentet kunne ikke findes. Gå tilbage og prøv igen.
        </p>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {doc.afsnit.map((a) => <Afsnit key={a.titel} titel={a.titel} tekst={a.tekst} />)}
    </div>
  );
}

export default LegalDocument;
export { Afsnit };
