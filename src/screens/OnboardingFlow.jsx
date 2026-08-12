// Det guidede flow — de første to minutter.
// Spec: docs/features/onboarding-v1.md.
//
// Vises kun for en bruger, der hverken har en liga eller en konkurrence, og
// aldrig oven på et invitations-link: en invitation ER en bedre onboarding end
// nogen guide, så den vej får lov at gå først.
//
// Fuldskærms-overlay frem for en `screen` i MainApp, fordi bundnavigationen
// ikke må stå aktiv under en first-run-oplevelse — der er endnu ikke noget at
// navigere til.
import { useState, useEffect } from "react";
import { Loader2, Users, Trophy, Ticket } from "lucide-react";
import { defaultLeagueName, validateGroupName, createStarterLeague, loadStarterTournaments } from "../lib/onboarding.js";
import { joinByInviteCode, createGroup } from "../lib/data.js";
import { C, btnGhost, btnGreen, chip, font, muted } from "../ui/theme.js";
import { Card } from "../ui/components.jsx";
import { Wordmark } from "../ui/Wordmark.jsx";

// Ordbogen ved første kontakt. De tre ord ligner hinanden og forveksles let, så
// de forklares dér, hvor de først møder brugeren — ikke bag et ⓘ-ikon.
const GLOSSARY = [
  { icon: Trophy, word: "Turnering", text: "Den rigtige fodboldturnering, fx Superligaen. Kampene kommer derfra." },
  { icon: Users, word: "Liga", text: "Dit fællesskab — vennerne, kontoret, familien. Det er her, du bliver." },
  { icon: Ticket, word: "Konkurrence", text: "Det I dyster i inde i ligaen. En hel sæson, eller bare næste weekend." },
];

function Shell({ children, onSkip, skipLabel = "Spring over" }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1100, background: C.bg,
      display: "flex", justifyContent: "center", overflowY: "auto",
      fontFamily: font.body, color: C.text,
    }}>
      <div style={{ width: "100%", maxWidth: 430, padding: "28px 18px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Wordmark size={15} />
        </div>
        {children}
        {/* "Spring over" er synlig hele vejen. Guiden er et tilbud, ikke en dør,
            der låser: springer man over, tager "Kom godt i gang"-checklisten på
            Hjem over og peger på næste trin. Guiden selv åbner ikke igen — se
            hvorfor i onboarding-spec §13. */}
        <button onClick={onSkip} style={{
          background: "none", border: "none", color: C.muted, fontSize: 13,
          fontFamily: font.body, cursor: "pointer", padding: "6px 0", marginTop: -4,
        }}>
          {skipLabel}
        </button>
      </div>
    </div>
  );
}

function Heading({ eyebrow, children }) {
  return (
    <div>
      {eyebrow && <div style={{ fontFamily: font.display, textTransform: "uppercase", letterSpacing: "0.12em", fontSize: 12, color: C.muted, marginBottom: 6 }}>{eyebrow}</div>}
      <div style={{ fontFamily: font.display, textTransform: "uppercase", fontWeight: 700, fontSize: 28, lineHeight: 1.1 }}>{children}</div>
    </div>
  );
}

function OnboardingFlow({ token, userId, profile, leagues, onJoined, onCreated, onSkip }) {
  const [step, setStep] = useState("velkommen"); // velkommen | invite | opret
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [code, setCode] = useState("");
  const [groupName, setGroupName] = useState(() => defaultLeagueName(profile?.display_name));
  const [tournaments, setTournaments] = useState(null); // null = henter
  const [pickedId, setPickedId] = useState("");
  const [compName, setCompName] = useState("");

  // Turneringerne hentes, når brugeren vælger "jeg starter selv" — ikke før.
  // En inviteret bruger skal ikke betale for et opslag, de aldrig bruger.
  useEffect(() => {
    if (step !== "opret" || tournaments !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await loadStarterTournaments(token, leagues);
        if (cancelled) return;
        setTournaments(list);
        // Foretræk en turnering, der faktisk har kampe tilbage at tippe.
        const best = list.find((t) => t.hasUpcoming) || list[0];
        if (best) { setPickedId(best.id); setCompName(best.name); }
      } catch { if (!cancelled) setTournaments([]); }
    })();
    return () => { cancelled = true; };
  }, [step]); // eslint-disable-line

  const picked = (tournaments || []).find((t) => t.id === pickedId) || null;

  async function submitCode() {
    if (!code.trim()) return;
    setBusy(true); setErr("");
    try {
      const res = await joinByInviteCode(token, userId, code);
      if (res.kind === "none") {
        setErr("Ingen liga eller konkurrence fundet med den kode. Tjek linket, eller bed om et nyt.");
        return;
      }
      await onJoined(res);
    } catch (e) {
      setErr(e.message || "Kunne ikke bruge koden lige nu. Prøv igen om lidt.");
    } finally { setBusy(false); }
  }

  async function submitCreate() {
    const nameErr = validateGroupName(groupName);
    if (nameErr) { setErr(nameErr); return; }
    setBusy(true); setErr("");
    try {
      // Ingen turnering med et kampprogram: opret ligaen alene frem for at
      // spærre brugeren ude. Fællesskabet er det, der består — konkurrencen kan
      // laves fra liga-siden, så snart kampene er lagt ind.
      if (!picked) {
        const group = await createGroup(token, groupName.trim());
        await onCreated({ group, competition: null, matchCount: 0 });
        return;
      }
      const res = await createStarterLeague(token, userId, {
        groupName: groupName.trim(),
        competitionName: (compName.trim() || picked.name),
        leagueId: picked.id,
      });
      await onCreated(res);
    } catch (e) {
      // Ligaen kan være oprettet, selvom konkurrencen fejlede — sig det, i stedet
      // for at lade brugeren tro, at intet skete, og oprette den samme liga igen.
      if (e.group) await onCreated({ group: e.group, competition: null, matchCount: 0, error: e.message });
      else setErr(e.message || "Kunne ikke oprette lige nu. Prøv igen om lidt.");
    } finally { setBusy(false); }
  }

  if (step === "velkommen") {
    return (
      <Shell onSkip={onSkip}>
        <Heading eyebrow="Velkommen">
          Hej {profile?.display_name || "der"}
        </Heading>
        <Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {GLOSSARY.map(({ icon: Icon, word, text }) => (
              <div key={word} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <Icon size={16} color={C.gold} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{word}</div>
                  <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.45 }}>{text}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card style={{ borderColor: C.green, background: "linear-gradient(135deg, #14212F 0%, #14302A 100%)" }}>
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            Du gætter resultatet af hver kamp.{" "}
            <b style={{ color: C.green }}>+3</b> for det præcise resultat,{" "}
            <b style={{ color: C.greenSoft }}>+1</b> for den rigtige vinder. Aldrig minuspoint.
          </div>
        </Card>
        <button style={btnGreen} onClick={() => setStep("invite")}>Kom i gang</button>
      </Shell>
    );
  }

  if (step === "invite") {
    return (
      <Shell onSkip={onSkip}>
        <Heading eyebrow="Trin 1 af 2">Er du inviteret?</Heading>
        <Card>
          <p style={{ ...muted, marginTop: 0 }}>
            Har du fået et link eller en kode af en ven, er du med i deres liga på ét tryk.
            Du kan indsætte hele linket.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="field" style={{ flex: 1, minWidth: 0 }} placeholder="Indsæt link eller kode…"
              value={code} autoCapitalize="none" autoCorrect="off" spellCheck={false}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitCode()} />
            <button style={{ ...btnGreen, width: "auto", padding: "8px 16px", opacity: busy || !code.trim() ? 0.5 : 1 }}
              disabled={busy || !code.trim()} onClick={submitCode}>
              {busy ? <Loader2 size={15} className="spin" /> : "Deltag"}
            </button>
          </div>
          {err && <p style={{ color: C.red, fontSize: 13, margin: "10px 0 0" }}>{err}</p>}
        </Card>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.muted, fontSize: 12 }}>
          <span style={{ flex: 1, height: 1, background: C.line }} /> eller <span style={{ flex: 1, height: 1, background: C.line }} />
        </div>
        <button style={{ ...btnGhost, justifyContent: "center" }} onClick={() => { setErr(""); setStep("opret"); }}>Jeg starter selv</button>
      </Shell>
    );
  }

  // step === "opret"
  const loading = tournaments === null;
  const noTournaments = !loading && tournaments.length === 0;
  // Sæsonen kan være spillet færdig. Så oprettes ligaen og konkurrencen stadig —
  // men vi lover ikke et tip, der ikke findes.
  const noMatches = !!picked && !picked.hasUpcoming;

  return (
    <Shell onSkip={onSkip}>
      <Heading eyebrow="Trin 2 af 2">Opret din liga</Heading>
      <Card>
        <p style={{ ...muted, marginTop: 0 }}>
          Vi opretter din liga og den første konkurrence i den — så du kan tippe med det samme.
          Dine venner inviterer du bagefter.
        </p>

        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ color: C.muted, fontSize: 12, display: "block", marginBottom: 4 }}>Ligaens navn</span>
          <input className="field" style={{ width: "100%" }} maxLength={40} value={groupName}
            onChange={(e) => setGroupName(e.target.value)} />
        </label>

        {loading && <p style={{ ...muted, margin: 0 }}>Henter turneringer…</p>}

        {noTournaments && (
          <p style={{ ...muted, margin: 0 }}>
            Der er ingen turneringer med et kampprogram lige nu. Vi opretter din liga —
            konkurrencen laver du, så snart kampene er lagt ind.
          </p>
        )}

        {!loading && tournaments.length > 0 && (
          <>
            {/* Én turnering er ikke et valg — så vises den som en linje, ikke som en vælger. */}
            {tournaments.length === 1 ? (
              <div style={{ color: C.muted, fontSize: 13, marginBottom: 12 }}>
                Turnering: <b style={{ color: C.text }}>{tournaments[0].name}</b>
              </div>
            ) : (
              <div style={{ marginBottom: 12 }}>
                <span style={{ color: C.muted, fontSize: 12, display: "block", marginBottom: 6 }}>Turnering</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {tournaments.map((t) => (
                    <button key={t.id} type="button" style={chip(t.id === pickedId)}
                      onClick={() => { setPickedId(t.id); setCompName(t.name); }}>
                      {t.id === pickedId ? "✓ " : ""}{t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label style={{ display: "block" }}>
              <span style={{ color: C.muted, fontSize: 12, display: "block", marginBottom: 4 }}>Konkurrencens navn</span>
              <input className="field" style={{ width: "100%" }} value={compName}
                onChange={(e) => setCompName(e.target.value)} />
            </label>

            {noMatches && (
              <p style={{ ...muted, margin: "10px 0 0" }}>
                {picked.name} har ingen kampe tilbage i denne sæson. Konkurrencen står klar —
                den fyldes, så snart næste kampprogram er lagt.
              </p>
            )}
          </>
        )}

        {err && <p style={{ color: C.red, fontSize: 13, margin: "10px 0 0" }}>{err}</p>}
      </Card>

      <button style={{ ...btnGreen, opacity: busy || loading || !groupName.trim() ? 0.5 : 1 }}
        disabled={busy || loading || !groupName.trim()} onClick={submitCreate}>
        {busy ? "Opretter…" : noTournaments || noMatches ? "Opret liga" : "Opret og tip"}
      </button>
      <button style={{ ...btnGhost, justifyContent: "center" }} onClick={() => { setErr(""); setStep("invite"); }}>Tilbage</button>
    </Shell>
  );
}

export default OnboardingFlow;
export { GLOSSARY };
