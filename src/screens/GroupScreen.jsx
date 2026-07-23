// Liga-siden (liga-laget). Fællesskabets side: konkurrencer med til-/framelding,
// medlemsliste, ét delbart invite-link, opret konkurrence og flyt egne konkurrencer
// ind i ligaen. Spec: docs/features/liga-laget-v1.md.
import { useState, useEffect, useCallback } from "react";
import { ChevronRight, Copy, Check, Plus, Crown, LogOut, Loader2, MoveRight } from "lucide-react";
import { loadGroupDetail, joinCompetition, leaveCompetition, leaveGroup, deleteGroup, moveCompetitionToGroup } from "../lib/data.js";
import { C, btnGhost, btnGold, btnGreen, font, muted } from "../ui/theme.js";
import { BackBar, Card, Eyebrow } from "../ui/components.jsx";

const modeLabel = (m) => m === "full_season" ? "Hel sæson" : m === "team" ? "Enkelt hold" : m === "time_range" ? "Datointerval" : m === "custom" ? "Håndplukket" : "Tilfældig kupon";

function GroupScreen({ token, userId, groupId, myCompetitions, onBack, openBoard, openCreate, reloadGroups }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState(null); // konkurrence-id under til-/framelding
  const [note, setNote] = useState("");       // fejl/info-besked
  const [leaving, setLeaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await loadGroupDetail(token, userId, groupId);
      setDetail(d);
    } catch (e) { setDetail(null); }
    setLoading(false);
  }, [token, userId, groupId]);

  useEffect(() => { load(); }, [load]);

  async function shareInvite() {
    if (!detail) return;
    const link = `${window.location.origin}${window.location.pathname}?liga=${detail.group.invite_code}`;
    const text = `Du er inviteret til ligaen "${detail.group.name}" på Prediction Champ ⚽\nGæt resultater, saml point og se hvem der er bedst. Tryk her for at være med:\n${link}`;
    try {
      if (navigator.share) await navigator.share({ title: "Prediction Champ", text });
      else { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    } catch (e) { /* annulleret — ignorér */ }
  }

  async function onJoin(compId) {
    setBusyId(compId); setNote("");
    try { await joinCompetition(token, userId, compId); await load(); }
    catch (e) { setNote(e.message || "Kunne ikke deltage — prøv igen."); }
    finally { setBusyId(null); }
  }
  async function onLeave(compId) {
    setBusyId(compId); setNote("");
    try {
      const ok = await leaveCompetition(token, userId, compId);
      if (!ok) { setNote("Du kan ikke framelde dig en konkurrence, hvor du allerede har tips på låste kampe."); }
      await load();
    } catch (e) { setNote(e.message || "Kunne ikke framelde — prøv igen."); }
    finally { setBusyId(null); }
  }
  async function onMove(compId) {
    setBusyId(compId); setNote("");
    try { await moveCompetitionToGroup(token, compId, groupId); await load(); await reloadGroups?.(); }
    catch (e) { setNote(e.message || "Kunne ikke flytte konkurrencen."); }
    finally { setBusyId(null); }
  }
  async function onLeaveGroup() {
    if (!window.confirm(`Forlad ligaen "${detail.group.name}"? Dine tips og historik bevares.`)) return;
    setLeaving(true);
    try { await leaveGroup(token, userId, groupId); await reloadGroups?.(); onBack(); }
    catch (e) { setNote(e.message || "Kunne ikke forlade ligaen."); setLeaving(false); }
  }
  async function onDeleteGroup() {
    if (!window.confirm(`Slet ligaen "${detail.group.name}"? Dette kan ikke fortrydes.`)) return;
    setLeaving(true);
    try {
      const ok = await deleteGroup(token, groupId);
      if (!ok) { setNote("Ligaen kan kun slettes, når den ingen konkurrencer har."); setLeaving(false); return; }
      await reloadGroups?.(); onBack();
    } catch (e) { setNote(e.message || "Kunne ikke slette ligaen."); setLeaving(false); }
  }

  if (loading) {
    return (<div><BackBar title="Liga" onBack={onBack} /><div style={{ display: "flex", gap: 10, color: C.muted, alignItems: "center" }}><Loader2 className="spin" size={18} />Henter …</div></div>);
  }
  if (!detail) {
    return (<div><BackBar title="Liga" onBack={onBack} /><p style={muted}>Kunne ikke hente ligaen.</p></div>);
  }

  const { group, members, myRole, competitions } = detail;
  const isAdmin = myRole === "admin";
  // egne liga-løse konkurrencer, der kan flyttes hertil (opretteren + endnu uden liga)
  const movable = (myCompetitions || []).filter((c) => !c.group_id && c.created_by === userId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BackBar title="Liga" onBack={onBack} />

      {/* Liga-hoved */}
      <div>
        <Eyebrow>Liga · {members.length} medlem{members.length === 1 ? "" : "mer"}</Eyebrow>
        <div style={{ fontFamily: font.display, textTransform: "uppercase", fontWeight: 700, fontSize: 26, lineHeight: 1.1 }}>{group.name}</div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={btnGold} onClick={shareInvite}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Kopieret!" : "Invitér"}</button>
        <button style={btnGhost} onClick={() => openCreate(groupId)}><Plus size={15} /> Opret konkurrence</button>
      </div>

      {note && <Card style={{ borderColor: C.red }}><span style={{ color: C.red, fontSize: 13 }}>{note}</span></Card>}

      {/* Konkurrencer i ligaen */}
      <div>
        <Eyebrow>Konkurrencer</Eyebrow>
        {competitions.length === 0 && (
          <Card style={{ borderStyle: "dashed", background: "transparent" }}>
            <div style={{ color: C.muted, fontSize: 13, textAlign: "center" }}>
              Ingen konkurrencer endnu. Opret den første med knappen ovenfor.
            </div>
          </Card>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {competitions.map((c) => (
            <Card key={c.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div style={{ minWidth: 0, flex: 1, cursor: c.joined ? "pointer" : "default" }} onClick={() => c.joined && openBoard(c.id)}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{c.name}</div>
                  <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                    {modeLabel(c.mode)} · {c.participantCount} deltager{c.participantCount === 1 ? "" : "e"}
                  </div>
                </div>
                {c.joined ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.green, fontSize: 12, fontWeight: 700 }}><Check size={13} /> Med</span>
                    <ChevronRight size={16} color={C.muted} onClick={() => openBoard(c.id)} style={{ cursor: "pointer" }} />
                  </div>
                ) : (
                  <button style={{ ...btnGreen, width: "auto", padding: "8px 14px", opacity: busyId === c.id ? 0.6 : 1 }}
                    disabled={busyId === c.id} onClick={() => onJoin(c.id)}>
                    {busyId === c.id ? "…" : "Deltag"}
                  </button>
                )}
              </div>
              {c.joined && (
                <div style={{ marginTop: 8 }}>
                  <span onClick={() => onLeave(c.id)} style={{ color: C.muted, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
                    Framelding
                  </span>
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>

      {/* Flyt en egen konkurrence ind i ligaen (blød migrering) */}
      {movable.length > 0 && (
        <div>
          <Eyebrow>Flyt en konkurrence hertil</Eyebrow>
          <Card>
            <div style={{ color: C.muted, fontSize: 12, marginBottom: 8 }}>
              Dine konkurrencer uden liga. Flyttes de hertil, bliver deltagerne medlemmer af ligaen.
            </div>
            {movable.map((c, i) => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: i ? `1px solid ${C.line}` : "none" }}>
                <span style={{ fontSize: 14, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                <button style={{ ...btnGhost, opacity: busyId === c.id ? 0.6 : 1 }} disabled={busyId === c.id} onClick={() => onMove(c.id)}>
                  <MoveRight size={14} /> {busyId === c.id ? "Flytter…" : "Flyt hertil"}
                </button>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* Medlemmer */}
      <div>
        <Eyebrow>Medlemmer</Eyebrow>
        <Card>
          {members.map((m, i) => (
            <div key={m.userId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: i ? `1px solid ${C.line}` : "none" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: m.userId === userId ? 700 : 500 }}>
                {m.role === "admin" && <Crown size={13} color={C.gold} />}
                {m.name}{m.userId === userId ? " (dig)" : ""}
              </span>
              <span style={{ color: C.muted, fontSize: 12 }}>{m.role === "admin" ? "Admin" : "Medlem"}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* Forlad / slet */}
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 4 }}>
        <span onClick={leaving ? undefined : onLeaveGroup} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: C.muted, fontSize: 13, cursor: leaving ? "default" : "pointer" }}>
          <LogOut size={13} /> Forlad ligaen
        </span>
        {isAdmin && competitions.length === 0 && (
          <span onClick={leaving ? undefined : onDeleteGroup} style={{ color: C.red, fontSize: 13, cursor: leaving ? "default" : "pointer" }}>
            Slet ligaen
          </span>
        )}
      </div>
    </div>
  );
}

export default GroupScreen;
