// Ligaer-fanen (liga-laget). Øverst: brugerens ligaer (fællesskaber). Nedenunder:
// "Øvrige konkurrencer" — liga-løse konkurrencer, der virker som før (overgangslag).
// Spec: docs/features/liga-laget-v1.md.
import { useState, useEffect } from "react";
import { Trophy, ChevronRight, Plus, Archive, Trash2, Users, Info } from "lucide-react";
import { db } from "../lib/supabase.js";
import { computeCompetitionState, loadMyGroups, loadGroupByCode, createGroup, joinGroup } from "../lib/data.js";
import { C, btnGhost, btnGold, btnGreen, font } from "../ui/theme.js";
import { Card, Eyebrow, H, InfoDot } from "../ui/components.jsx";

const NUDGE_KEY = "pc_liga_nudge_dismissed";

function LigaerTab({ token, userId, competitions, openBoard, openCreate, openGroup, reload }) {
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
          const myIdx = state.rows.findIndex((r) => r.userId === userId);
          const winner = state.isComplete && state.rows.length ? state.rows[0] : null;
          return [c.id, { isComplete: state.isComplete, playedMatches: state.playedMatches, totalMatches: state.totalMatches, participants: state.rows.length, myPos: myIdx >= 0 ? myIdx + 1 : null, winner }];
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
    if (!newName.trim()) return;
    setCreating(true); setJoinErr("");
    try {
      const g = await createGroup(token, userId, newName);
      setNewName("");
      await reloadGroups();
      openGroup(g.id);
    } catch (e) { setJoinErr(e.message || "Kunne ikke oprette ligaen."); } finally { setCreating(false); }
  }

  // Samlet join: prøv liga-kode først, dernæst konkurrence-kode (bagudkompatibelt).
  async function joinByCode() {
    const code = inviteCode.trim();
    if (!code) return;
    setBusy(true); setJoinErr("");
    try {
      const g = await loadGroupByCode(token, code);
      if (g) {
        await joinGroup(token, userId, g.id);
        setInviteCode("");
        await reloadGroups();
        openGroup(g.id);
        return;
      }
      // konkurrence-kode (gammelt flow) — meld også ind i ligaen, hvis konkurrencen har en
      const found = await db.select(token, "competitions", `invite_code=eq.${code}&select=*`);
      if (!found.length) { setJoinErr("Ingen liga eller konkurrence fundet med den kode"); setBusy(false); return; }
      const comp = found[0];
      if (comp.group_id) await joinGroup(token, userId, comp.group_id);
      await db.insert(token, "competition_participants", [{ competition_id: comp.id, user_id: userId }]);
      setInviteCode("");
      await reload();
      if (comp.group_id) { await reloadGroups(); openGroup(comp.group_id); }
    } catch (e) { setJoinErr(e.message); } finally { setBusy(false); }
  }

  const modeLabel = (m) => m === "full_season" ? "Hel sæson" : m === "team" ? "Enkelt hold" : m === "time_range" ? "Datointerval" : m === "custom" ? "Håndplukket" : "Tilfældig kupon";

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
            {s?.isComplete && s.winner && (
              <div style={{ color: C.gold, fontSize: 12, fontWeight: 700, marginTop: 3 }}>🏆 {s.winner.player} ({s.winner.total} point)</div>
            )}
          </div>
          <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 8 }}>
            {s?.myPos != null && (
              <div>
                <div style={{ fontFamily: font.display, fontSize: 24, fontWeight: 700, color: s.myPos === 1 ? C.gold : C.text }}>{s.myPos}.</div>
                <div style={{ color: C.muted, fontSize: 11 }}>din plads</div>
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
          <input className="field" style={{ flex: 1 }} placeholder="Navn på liga…" value={newName} maxLength={40}
            onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createNewGroup()} />
          <button style={{ ...btnGreen, width: "auto", padding: "8px 14px", opacity: creating || !newName.trim() ? 0.5 : 1 }}
            disabled={creating || !newName.trim()} onClick={createNewGroup}><Plus size={15} /> Opret</button>
        </div>
      </Card>

      {/* Join med kode (liga eller konkurrence) */}
      <Card>
        <Eyebrow>Join med kode</Eyebrow>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="field" style={{ flex: 1 }} placeholder="Invitationskode…" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && joinByCode()} />
          <button style={{ ...btnGold, opacity: busy || !inviteCode ? 0.5 : 1 }} onClick={joinByCode} disabled={busy || !inviteCode}>Join</button>
        </div>
        {joinErr && <p style={{ color: C.red, fontSize: 13, margin: "8px 0 0" }}>{joinErr}</p>}
      </Card>

      {/* Ligaer */}
      {groups && groups.length > 0 && groups.map((g) => <GroupCard key={g.id} g={g} />)}
      {groups && groups.length === 0 && loose.length === 0 && (
        <Card style={{ borderStyle: "dashed", background: "transparent" }}>
          <div style={{ color: C.muted, fontSize: 13, textAlign: "center" }}>
            Ingen ligaer endnu — opret en ovenfor, eller join med en kode.
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
