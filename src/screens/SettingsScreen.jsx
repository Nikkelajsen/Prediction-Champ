// Indstillinger (B40) — tandhjulet i topbaren.
//
// Skærmen findes, fordi push indtil nu kun kunne slås TIL (opt-in-kortet på
// Hjem og checklisten): fravalget krævede logout eller browserens egne
// indstillinger. Kontakten her er begge retninger — og bor på en skærm frem
// for i en dialog, fordi alle topbarens knapper åbner skærme, og en menu med
// ét mønster er nemmere at lære end to.
//
// To kort er nok til ikke at være en mur: notifikationerne og profilen
// ("Skift brugernavn", flyttet hertil fra karriereprofilen — ChangeName.jsx
// forudsagde selv flytningen, dengang skærmen ikke fandtes).
import { Bell } from "lucide-react";
import { C, font } from "../ui/theme.js";
import { BackBar, Card, Eyebrow } from "../ui/components.jsx";
import { usePushSetting } from "../ui/usePushSetting.js";
import ChangeName from "./profile/ChangeName.jsx";

// Hvorfor kontakten er LÅST og ikke bare slukket. Teksterne er vejledninger,
// ikke fejl: browseren ejer de tre tilstande, og appen kan ikke handle sig ud
// af dem — særligt "denied" kan ikke genåbnes programmatisk.
const LÅST_FORKLARING = {
  "needs-install": "Føj først appen til hjemmeskærmen (Del → Føj til hjemmeskærm), så kan notifikationer slås til.",
  denied: "Du har blokeret notifikationer i browseren. Slå dem til i browserens eller telefonens indstillinger for denne side, og prøv igen.",
};

// Husets første switch — lokal, indtil en anden aftager findes. `role="switch"`
// frem for en checkbox: det er en indstilling med øjeblikkelig virkning, ikke
// et valg, der skal gemmes.
function Kontakt({ checked, disabled, busy, onToggle }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label="Push-notifikationer"
      disabled={disabled || busy} onClick={onToggle}
      style={{
        width: 44, height: 26, borderRadius: 13, padding: 0, position: "relative", flexShrink: 0,
        background: checked ? C.green : C.surface2,
        border: `1px solid ${checked ? C.green : C.line}`,
        cursor: disabled || busy ? "default" : "pointer",
        opacity: busy ? 0.6 : disabled ? 0.45 : 1,
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: checked ? 20 : 2, width: 20, height: 20,
        borderRadius: "50%", background: checked ? C.bg : C.muted, transition: "left .15s ease",
      }} />
    </button>
  );
}

function SettingsScreen({ token, userId, profile, onProfileChanged, onBack }) {
  const push = usePushSetting(token, userId);
  const låst = push.status === "needs-install" || push.status === "denied";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BackBar title="Indstillinger" onBack={onBack} />

      <Card>
        <Eyebrow>Notifikationer</Eyebrow>
        {/* `status === null` = proben kører endnu; intet vises, så kontakten
            ikke når at blinke fra slukket til tændt for en tilmeldt bruger —
            samme regel som opt-in-kortet på Hjem. */}
        {push.status === "unsupported" && (
          <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.5 }}>
            Denne browser understøtter ikke notifikationer.
          </div>
        )}
        {push.status && push.status !== "unsupported" && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Bell size={15} color={C.gold} />
                <div style={{ fontFamily: font.display, fontSize: 16, fontWeight: 700, textTransform: "uppercase" }}>
                  Push-notifikationer
                </div>
              </div>
              <Kontakt checked={push.status === "on"} disabled={låst} busy={push.busy}
                onToggle={push.status === "on" ? push.disable : push.enable} />
            </div>
            <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.5, marginTop: 6 }}>
              Beskeder om deadlines, runderesultater og nyheder — gælder kun denne enhed.
            </div>
            {låst && (
              <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.5, marginTop: 8 }}>
                {LÅST_FORKLARING[push.status]}
              </div>
            )}
            {push.error && <div style={{ color: C.red, fontSize: 13, marginTop: 8 }}>{push.error}</div>}
          </>
        )}
      </Card>

      <Card>
        <Eyebrow>Profil</Eyebrow>
        <div style={{ fontSize: 14 }}>
          Brugernavn: <b>{profile?.display_name || "—"}</b>
        </div>
        <ChangeName token={token} userId={userId} currentName={profile?.display_name}
          onChanged={(række) => onProfileChanged?.(række)} />
      </Card>
    </div>
  );
}

export default SettingsScreen;
