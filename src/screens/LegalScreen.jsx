// Skærmen om privatliv og vilkår (B4), for en indlogget bruger.
//
// De to dokumenter deler skærm og skiftes med en chip-række frem for at være
// to skærme: de henviser til hinanden hele vejen igennem ("hvad der sker med
// dine data, står i privatlivspolitikken"), og et skift, der kræver en tur
// tilbage, gør den henvisning til en blindgyde.
//
// Selve teksten kommer fra src/lib/legal.js og tegnes af LegalDocument, som
// også bruges inde i login-skærmen. Denne fil er kun rammen omkring den.
import { useState } from "react";
import { chip, muted } from "../ui/theme.js";
import { BackBar } from "../ui/components.jsx";
import { DOKUMENTER, findDokument, LEGAL_OPDATERET } from "../lib/legal.js";
import LegalDocument from "./LegalDocument.jsx";

function LegalScreen({ doc = "privatliv", onBack }) {
  const [valgt, setValgt] = useState(doc);
  const dokument = findDokument(valgt);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BackBar title={dokument?.titel ?? "Privatliv og vilkår"} onBack={onBack} />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {Object.values(DOKUMENTER).map((d) => (
          <button key={d.id} type="button" aria-pressed={valgt === d.id}
            style={chip(valgt === d.id)} onClick={() => setValgt(d.id)}>
            {d.titel}
          </button>
        ))}
      </div>

      <LegalDocument doc={dokument} />

      <p style={{ ...muted, fontSize: 11, textAlign: "center", margin: "2px 0 0" }}>
        Senest opdateret {LEGAL_OPDATERET}
      </p>
    </div>
  );
}

export default LegalScreen;
