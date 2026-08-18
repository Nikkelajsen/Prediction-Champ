// Skift af brugernavn (B29) — knappen og dialogen.
//
// Boede først på ens egen karriereprofil ("en handling hører hjemme ved den
// oplysning, den ændrer" — der fandtes bevidst ingen indstillingsskærm).
// Kommentaren her forudsagde dengang: "bliver der nogensinde en, er dette den
// første beboer" — og det blev den (B40, august 2026), da Indstillinger kom
// til med notifikations-kontakten som anledning. Filen ligger fortsat i
// profile/ af hensyn til git-historikken; kun kaldstedet flyttede.
import { useState, useId } from "react";
import { Loader2, Pencil } from "lucide-react";
import { C, btnGhost, fieldFull, muted } from "../../ui/theme.js";
import { Modal } from "../../ui/components.jsx";
import { changeDisplayName } from "../../lib/data.js";

// Samme grænse som ved oprettelsen og som `profiles_display_name_len`. Står som
// et tal her, fordi `maxLength` på feltet skal have det — reglen selv håndhæves
// af databasen og af `changeDisplayName()`.
const NAVN_MAX = 20;

function ChangeName({ token, userId, currentName, onChanged }) {
  const [åben, setÅben] = useState(false);
  const [navn, setNavn] = useState(currentName || "");
  const [arbejder, setArbejder] = useState(false);
  const [fejl, setFejl] = useState("");
  const feltId = useId();

  function åbn() {
    setNavn(currentName || "");
    setFejl("");
    setÅben(true);
  }

  async function gem() {
    setArbejder(true);
    setFejl("");
    try {
      const række = await changeDisplayName(token, userId, navn);
      // Den skrevne række og ikke det, brugeren tastede: databasen trimmer selv
      // (`profiles_name_guard`), så det er dens svar, der er sandheden om,
      // hvad navnet nu er.
      onChanged?.(række);
      setÅben(false);
    } catch (e) {
      setFejl(String(e?.message ?? e));
    } finally {
      setArbejder(false);
    }
  }

  const rent = navn.trim();
  const uændret = rent === (currentName || "").trim();

  return (
    <>
      <button type="button" onClick={åbn} aria-label="Skift brugernavn"
        style={{ ...btnGhost, padding: "4px 10px", fontSize: 12, marginTop: 10 }}>
        <Pencil size={12} /> Skift brugernavn
      </button>

      {åben && (
        <Modal title="Skift brugernavn" onClose={() => setÅben(false)}>
          <p style={{ margin: "0 0 10px" }}>
            Navnet vises for alle, du spiller med — i stillinger, ligaer og på din karriere.
          </p>
          {/* Prisen sagt højt og ikke skjult i en hjælpetekst: historie-kort
              gemmer navnet som tekst, dengang de blev skrevet, og de bliver ikke
              omskrevet. Det er en historie fra en bestemt dag. */}
          <p style={{ ...muted, fontSize: 13, lineHeight: 1.5, margin: "0 0 12px" }}>
            Dine point, din rating og dine titler følger med. Gamle historie-kort
            bliver ved med at nævne det navn, du havde, da de blev skrevet.
          </p>

          <label className="srOnly" htmlFor={feltId}>Nyt brugernavn</label>
          <input id={feltId} className="field" style={fieldFull} value={navn}
            onChange={(e) => setNavn(e.target.value)} maxLength={NAVN_MAX}
            placeholder="Nyt brugernavn" autoComplete="off"
            onKeyDown={(e) => { if (e.key === "Enter" && !uændret && rent.length >= 2) gem(); }} />

          {fejl && <p style={{ color: C.red, fontSize: 13, margin: "0 0 10px" }}>{fejl}</p>}

          <button type="button" disabled={arbejder || uændret || rent.length < 2}
            onClick={gem}
            style={{ ...btnGhost, width: "100%", justifyContent: "center", marginTop: 4 }}>
            {arbejder ? <Loader2 size={14} className="spin" /> : <Pencil size={14} />} Gem navnet
          </button>
        </Modal>
      )}
    </>
  );
}

export default ChangeName;
