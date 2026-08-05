// Opt-in-kortet til push på Hjem. Ren flytning ud af `HjemTab.jsx`
// (G1, august 2026).
import { Bell, X } from "lucide-react";
import { C, btnGreen, font, iconBtn } from "../../ui/theme.js";
import { Card } from "../../ui/components.jsx";

// Opt-in-kort til push-notifikationer. Vises kun hvor det giver mening:
// browseren understøtter push, brugeren har ikke sagt nej, og er ikke tilmeldt
// endnu. Tilgængeligheden afgøres af `usePushOptIn`, som "Kom godt i gang"-
// checklisten bruger det samme — så de to aldrig kan spørge om det samme
// samtidig eller være uenige om, hvornår spørgsmålet giver mening.
function PushOptInCard({ push }) {
  if (!push.available) return null;

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Bell size={15} color={C.gold} />
          <div style={{ fontFamily: font.display, fontSize: 18, fontWeight: 700, textTransform: "uppercase" }}>Få besked før deadline</div>
        </div>
        <button style={iconBtn} aria-label="Skjul" onClick={push.dismiss}><X size={16} /></button>
      </div>
      <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
        Vi minder dig om at tippe, inden kampene låser — og fortæller, hvordan runden gik.
      </div>
      {push.error && <div style={{ color: C.red, fontSize: 13, marginTop: 8 }}>{push.error}</div>}
      <button style={{ ...btnGreen, marginTop: 12, opacity: push.busy ? 0.6 : 1 }} disabled={push.busy} onClick={push.enable}>
        {push.busy ? "Slår til …" : "Slå notifikationer til"}
      </button>
    </Card>
  );
}

export default PushOptInCard;
