// Ligaer-fanen (liga-laget). Øverst: brugerens ligaer (fællesskaber). Nedenunder:
// "Øvrige konkurrencer" — liga-løse konkurrencer, der virker som før (overgangslag).
// Spec: docs/features/liga-laget-v1.md.
import { useState, useEffect } from "react";
import { Trophy, ChevronRight, Plus, Archive, Trash2, Users, Info } from "lucide-react";
import { db } from "../lib/supabase.js";
import { computeCompetitionState, loadMyGroups, createGroup, joinByInviteCode } from "../lib/data.js";
import { leaders } from "../lib/standings.js";
import { modeLabel } from "../lib/scoring.js";
import { C, btnGhost, btnGold, btnGreen, font } from "../ui/theme.js";
import { Card, Eyebrow, H, InfoDot, PlayerName } from "../ui/components.jsx";

const NUDGE_KEY = "pc_liga_nudge_dismissed";

function LigaerTab({ token, userId, competitions, openBoard, openCreate, openGroup, reload, openProfile }) {
  const [groups, setGroups] = useState(null);
  const [statusMap, setStatusMap] = useState({});
  const [showArchived, setShowArchived] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinErr, setJoinErr] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [nudgeGone, setNudgeGone] = useState(() => { try { return !!localStorage.getItem(NUDGE_KEY); } catch (e) { return false; } });

  async function reloadGroups() {
    try { setGroups(await loadMyGroups(token, userId)); } catch (e) { setGroups([]); }
  }
  useEffect(() => { reloadGroups(); }, [token, userId]); // eslint-disable-line

  // liga-løse konkurrencer (dem med gruppetilhør vises på liga-siden i stedet)
  const loose = competitions.filter((c) => !c.group_id);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(loose.map(async (c) => {
        try {
          const state = await computeCompetitionState(token, c.id, c.rules || { exact: 3, outcome: 1 });
          // Placeringen er rækkens ÆGTE rang (sat af assignRanks i computeCompetitionState),
          // ikke listeindekset: to spillere, der står ægte lige, er begge nr. 2 — ikke 2 og 3.
          const me = state.rows.find((r) => r.userId === userId);
          // Vinderen kan være delt. `leaders` giver alle på 1. pladsen, som Championship-
          // fanens kåring allerede gør — en skjult nøgle må ikke udpege én af to lige.
          const winners = state.isComplete ? leaders(state.rows) : [];
          return [c.id, { isComplete: state.isComplete, playedMatches: state.playedMatches, totalMatches: state.totalMatches, participants: state.rows.length, myPos: me ? me.rank : null, myShared: !!me?.shared, winners }];
        } catch (e) { return [c.id, null]; }
      }));
      if (!cancelled) setStatusMap(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [competitions]); // eslint-disable-line

  async function setArchived(compId, hidden) {
    await db.update(token, "competition_participants", `competition_id=eq.${compId}&user_id=eq.${userId}`, { hidden });
    await reload();
  }
  async function deleteCompetition(comp) {
    if (!window.confirm(`Slet "${comp.name}" for ALLE deltagere? Dette kan ikke fortrydes.`)) return;
    await db.del(token, "competitions", `id=eq.${comp.id}`);
    await reload();
  }

  async function createNewGroup() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    // Samme grænse som check-constrainten på groups.name (sql/groups.sql): 2-40 tegn.
    // Uden tjekket her lækkede databasens rå fejltekst ud i catch-blokken nedenfor.
    if (trimmed.length < 2) { setJoinErr("Ligaens navn skal være mindst 2 tegn."); return; }
    setCreating(true); setJoinErr("");
    try {
      const g = await createGroup(token, userId, newName);
      setNewName("");
      await reloadGroups();
      openGroup(g.id);
    } catch (e) { setJoinErr(e.message || "Kunne ikke oprette ligaen."); } finally { setCreating(false); }
  }

  // Samlet join: prøv liga-kode først, dernæst konkurrence-kode (bagudkompatibelt).
  // Selve opslaget og skrivningen bor i `joinByInviteCode` (data.js), så denne vej
  // og deep-link-vejen (?join=/?liga=) ikke kan divergere igen — jf. A7.
  async function joinByCode() {
    if (!inviteCode.trim()) return;
    setBusy(true); setJoinErr("");
    try {
      const res = await joinByInviteCode(token, userId, inviteCode);
      if (res.kind === "none") { setJoinErr("Ingen liga eller konkurrence fundet med den kode."); setBusy(false); return; }
      setInviteCode("");
      if (res.kind === "group") { await reloadGroups(); openGroup(res.group.id); return; }
      await reload();
      if (res.competition.group_id) { await reloadGroups(); openGroup(res.competition.group_id); }
    } catch (e) { setJoinErr(e.message || "Kunne ikke bruge koden lige nu. Prøv igen om lidt."); } finally { setBusy(false); }
  }

  const visible = loose.filter((c) => !c._hidden);
  const archived = loose.filter((c) => c._hidden);
  const active = visible.filter((c) => !statusMap[c.id]?.isComplete);
  const completed = visible.filter((c) => statusMap[c.id]?.isComplete);
  const canNudge = !nudgeGone && groups && groups.length === 0 && loose.some((c) => c.created_by === userId);
  function dismissNudge() { try { localStorage.setItem(NUDGE_KEY, "1"); } catch (e) {} setNudgeGone(true); }

  const LeagueCard = ({ c, isArchived }) => {
    const s = statusMap[c.id];
    return (
      <Card onClick={() => openBoard(c.id)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
              {s?.isComplete && <Trophy size={13} color={C.gold} />}
              <span>{c.name}</span>
            </div>
            <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
              {modeLabel(c.mode)}{s?.participants != null ? ` · ${s.participants} deltager${s.participants === 1 ? "" : "e"}` : ""}
              {s && !s.isComplete && s.totalMatches > 0 ? ` · ${s.playedMatches}/${s.totalMatches} spillet` : ""}
            </div>
            {s?.isComplete && s.winners?.length > 0 && (
              <div style={{ color: C.gold, fontSize: 12, fontWeight: 700, marginTop: 3 }}>
                🏆 {s.winners.map((w, i) => (
                  <span key={w.userId}>
                    {i > 0 && (i === s.winners.length - 1 ? " og " : ", ")}
                    <PlayerName userId={w.userId} name={w.player} onOpenProfile={openProfile} />
                  </span>
                ))} ({s.winners[0].total} point{s.winners.length > 1 ? " — delt" : ""})
              </div>
            )}
          </div>
          <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 8 }}>
            {s?.myPos != null && (
              <div>
                <div style={{ fontFamily: font.display, fontSize: 24, fontWeight: 700, color: s.myPos === 1 ? C.gold : C.text }}>{s.myPos}.</div>
                <div style={{ color: C.muted, fontSize: 11 }}>{s.myShared ? "delt plads" : "din plads"}</div>
              </div>
            )}
            <ChevronRight size={18} color={C.muted} />
          </div>
        </div>
        {(s?.isComplete || isArchived || c.created_by === userId) && (
          <div style={{ marginTop: 8, display: "flex", gap: 14, alignItems: "center" }}>
            {(s?.isComplete || isArchived) && (
              <span onClick={(e) => { e.stopPropagation(); setArchived(c.id, !isArchived); }}
                style={{ color: C.muted, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
                {isArchived ? "Gendan" : "Arkivér"}
              </span>
            )}
            {c.created_by === userId && (
              <span onClick={(e) => { e.stopPropagation(); deleteCompetition(c); }}
                style={{ color: C.red, fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Trash2 size={12} /> Slet
              </span>
            )}
          </div>
        )}
      </Card>
    );
  };

  const GroupCard = ({ g }) => (
    <Card onClick={() => openGroup(g.id)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", gap: 6 }}>
            <Users size={14} color={C.gold} /><span>{g.name}</span>
          </div>
          <div style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
            {g.memberCount} medlem{g.memberCount === 1 ? "" : "mer"} · {g.compCount} konkurrence{g.compCount === 1 ? "" : "r"}
          </div>
        </div>
        <ChevronRight size={18} color={C.muted} />
      </div>
    </Card>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <Eyebrow>Dine ligaer <InfoDot title="Ligaer">En liga er dit permanente fællesskab — en vennegruppe, et kontor, en familie. Konkurrencer lever inde i ligaen, og hvert medlem vælger selv, hvilke det er med i. Del ét invite-link, så alle er med.</InfoDot></Eyebrow>
        <H>Ligaer</H>
      </div>

      {/* Opret liga */}
      <Card>
        <Eyebrow>Opret en liga</Eyebrow>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="field" style={{ flex: 1 }} placeholder="Navn på liga (2–40 tegn)…" value={newName} maxLength={40}
            onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createNewGroup()} />
          <button style={{ ...btnGreen, width: "auto", padding: "8px 14px", opacity: creating || !newName.trim() ? 0.5 : 1 }}
            disabled={creating || !newName.trim()} onClick={createNewGroup}><Plus size={15} /> Opret</button>
        </div>
      </Card>

      {/* Join med kode (liga eller konkurrence) */}
      <Card>
        <Eyebrow>Deltag med kode</Eyebrow>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="field" style={{ flex: 1 }} placeholder="Invitationskode…" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && joinByCode()} />
          <button style={{ ...btnGold, opacity: busy || !inviteCode ? 0.5 : 1 }} onClick={joinByCode} disabled={busy || !inviteCode}>Deltag</button>
        </div>
        {joinErr && <p style={{ color: C.red, fontSize: 13, margin: "8px 0 0" }}>{joinErr}</p>}
      </Card>

      {/* Ligaer */}
      {groups && groups.length > 0 && groups.map((g) => <GroupCard key={g.id} g={g} />)}
      {groups && groups.length === 0 && loose.length === 0 && (
        <Card style={{ borderStyle: "dashed", background: "transparent" }}>
          <div style={{ color: C.muted, fontSize: 13, textAlign: "center" }}>
            Ingen ligaer endnu — opret en ovenfor, eller deltag med en kode.
          </div>
        </Card>
      )}

      {/* Øvrige konkurrencer (liga-løse) */}
      {loose.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 4 }}>
            <Eyebrow>Øvrige konkurrencer <InfoDot title="Øvrige konkurrencer">Konkurrencer uden liga. De virker som hidtil. Saml dem i en liga for at få ét fælles sted med medlemmer og invite-link — opret en liga og flyt dem ind på liga-siden.</InfoDot></Eyebrow>
            <button style={btnGhost} onClick={() => openCreate(null)}><Plus size={14} /> Ny</button>
          </div>

          {canNudge && (
            <Card style={{ borderColor: C.gold, background: "linear-gradient(135deg, #14212F 0%, #221E14 100%)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Info size={15} color={C.gold} />
                  <div style={{ fontFamily: font.display, fontSize: 17, fontWeight: 700, textTransform: "uppercase" }}>Saml dine konkurrencer i en liga</div>
                </div>
                <span onClick={dismissNudge} style={{ color: C.muted, fontSize: 12, cursor: "pointer" }}>Skjul</span>
              </div>
              <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
                Opret en liga ovenfor, åbn den, og flyt dine konkurrencer ind — så samles medlemmer, historik og ét invite-link ét sted.
              </div>
            </Card>
          )}

          {active.map((c) => <LeagueCard key={c.id} c={c} />)}
          {completed.length > 0 && (
            <>
              <Eyebrow>Afsluttede</Eyebrow>
              {completed.map((c) => <LeagueCard key={c.id} c={c} />)}
            </>
          )}
          {archived.length > 0 && (
            <>
              <div onClick={() => setShowArchived(!showArchived)} style={{ display: "flex", alignItems: "center", gap: 6, color: C.muted, fontSize: 13, padding: "4px 2px", cursor: "pointer" }}>
                <Archive size={14} /> Arkiverede ({archived.length}) <ChevronRight size={14} style={{ transform: showArchived ? "rotate(90deg)" : "none" }} />
              </div>
              {showArchived && archived.map((c) => <LeagueCard key={c.id} c={c} isArchived />)}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default LigaerTab;
