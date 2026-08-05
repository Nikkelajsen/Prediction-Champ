// Skærmen om privatliv og vilkår (B4), for en indlogget bruger.
//
// De to dokumenter deler skærm og skiftes med en chip-række frem for at være to
// skærme: de henviser til hinanden hele vejen igennem ("hvad der sker med dine
// data, står i privatlivspolitikken"), og et skift, der kræver en tur tilbage,
// gør den henvisning til en blindgyde.
//
// Selve teksten kommer fra src/lib/legal.js og tegnes af LegalDocument, som
// også bruges inde i login-skærmen. Denne fil er kun rammen omkring den — plus
// vejen ud af produktet, som hører hjemme netop her og ingen andre steder: det
// er den eneste skærm, hvor beskrivelsen af, hvad en lukning gør, står lige
// ovenfor knappen, der gør det.
import { useState, useId } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { C, btnGhost, chip, fieldFull, muted } from "../ui/theme.js";
import { BackBar, Card, Modal } from "../ui/components.jsx";
import { DOKUMENTER, findDokument, LEGAL_OPDATERET } from "../lib/legal.js";
import { deleteMyAccount } from "../lib/data/account.js";
import { clearAllLocalState } from "../lib/supabase.js";
import LegalDocument from "./LegalDocument.jsx";

// Ordet, der skal skrives. Bekræftelsen er ikke en formalitet: handlingen kan
// ikke fortrydes, og en knap, der lukker en konto ved ét fejltryk, er farlig på
// en telefon i en lomme.
const BEKRÆFT_ORD = "LUK";

function SletKontoKort({ token, onLogout }) {
  const [åben, setÅben] = useState(false);
  const [ord, setOrd] = useState("");
  const [arbejder, setArbejder] = useState(false);
  const [fejl, setFejl] = useState("");
  const feltId = useId();

  async function luk() {
    setArbejder(true);
    setFejl("");
    try {
      await deleteMyAccount(token);
      // Ryd ALT lokalt, ikke kun sessionen: der er ingen at huske noget for
      // bagefter, og de øvrige nøgler ville følge den næste bruger på samme
      // telefon.
      clearAllLocalState();
      onLogout();
    } catch (e) {
      setFejl(String(e?.message ?? e));
    } finally {
      setArbejder(false);
    }
  }

  return (
    <Card style={{ borderColor: C.red }}>
      <div style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>Luk min konto</div>
      <p style={{ ...muted, fontSize: 13, lineHeight: 1.5, margin: "6px 0 10px" }}>
        Din e-mail fjernes, dit navn erstattes af et pseudonym, og du kan ikke
        logge ind igen. Dine tips og din rating bliver stående under pseudonymet,
        fordi de er grundlaget for dine venners stillinger.
      </p>
      <button type="button" style={{ ...btnGhost, color: C.red, borderColor: C.red }}
        onClick={() => { setOrd(""); setFejl(""); setÅben(true); }}>
        <Trash2 size={14} /> Luk min konto
      </button>

      {åben && (
        <Modal title="Luk din konto?" onClose={() => setÅben(false)}>
          <p style={{ margin: "0 0 10px" }}>Det kan ikke fortrydes. Når du bekræfter:</p>
          <ul style={{ margin: "0 0 12px", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
            <li>din e-mail fjernes, og du kan ikke logge ind igen</li>
            <li>dit brugernavn erstattes af et pseudonym</li>
            <li>din brugslog, dine notifikationer og dine historie-kort slettes</li>
            <li>dine tips, point, rating og kåringer bliver stående under pseudonymet</li>
            <li>er du med i en konkurrence, der ikke er begyndt, meldes du af den</li>
            <li>ligaer og konkurrencer, du har oprettet, bliver stående for de andre</li>
          </ul>
          <label className="srOnly" htmlFor={feltId}>Skriv {BEKRÆFT_ORD} for at bekræfte</label>
          <input id={feltId} className="field" style={fieldFull} value={ord}
            onChange={(e) => setOrd(e.target.value)} placeholder={`Skriv ${BEKRÆFT_ORD} for at bekræfte`}
            autoComplete="off" autoCapitalize="characters" />

          {fejl && <p style={{ color: C.red, fontSize: 13, margin: "0 0 10px" }}>{fejl}</p>}

          <button type="button" disabled={ord.trim().toUpperCase() !== BEKRÆFT_ORD || arbejder}
            onClick={luk}
            style={{ ...btnGhost, width: "100%", justifyContent: "center", color: C.red, borderColor: C.red }}>
            {arbejder ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} Luk kontoen endeligt
          </button>
        </Modal>
      )}
    </Card>
  );
}

function LegalScreen({ doc = "privatliv", onBack, token, onLogout }) {
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

      {/* Kortet står under BEGGE dokumenter og ikke kun under politikken:
          vilkårenes afsnit om lukning henviser til privatlivspolitikken, og
          handlingen skal kunne nås fra det sted, man læste om den. */}
      {token && onLogout && <SletKontoKort token={token} onLogout={onLogout} />}

      <p style={{ ...muted, fontSize: 11, textAlign: "center", margin: "2px 0 0" }}>
        Senest opdateret {LEGAL_OPDATERET}
      </p>
    </div>
  );
}

export default LegalScreen;
export { SletKontoKort, BEKRÆFT_ORD };
