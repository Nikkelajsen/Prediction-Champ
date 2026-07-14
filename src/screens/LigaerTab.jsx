// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState, useEffect } from "react";
import { Trophy, ChevronRight, Plus, Archive, Trash2 } from "lucide-react";
import { db } from "../lib/supabase.js";
import { outcome } from "../lib/scoring.js";
import { computeCompetitionState } from "../lib/data.js";
import { C, btnGhost, btnGold, font, muted } from "../ui/theme.js";
import { Card, Eyebrow, H, InfoDot } from "../ui/components.jsx";

function LigaerTab({ token, userId, competitions, openBoard, openCreate, reload }) {
  const [statusMap, setStatusMap] = useState({});
  const [showArchived, setShowArchived] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinErr, setJoinErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(competitions.map(async (c) => {
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
  async function joinCompetition() {
    setBusy(true); setJoinErr("");
    try {
      const found = await db.select(token, "competitions", `invite_code=eq.${inviteCode.trim()}&select=*`);
      if (!found.length) { setJoinErr("Ingen konkurrence fundet med den kode"); setBusy(false); return; }
      await db.insert(token, "competition_participants", [{ competition_id: found[0].id, user_id: userId }]);
      setInviteCode("");
      await reload();
    } catch (e) { setJoinErr(e.message); } finally { setBusy(false); }
  }

  const modeLabel = (m) => m === "full_season" ? "Hel sæson" : m === "team" ? "Enkelt hold" : m === "time_range" ? "Datointerval" : m === "custom" ? "Håndplukket" : "Tilfældig kupon";

  const visible = competitions.filter((c) => !c._hidden);
  const archived = competitions.filter((c) => c._hidden);
  const active = visible.filter((c) => !statusMap[c.id]?.isComplete);
  const completed = visible.filter((c) => statusMap[c.id]?.isComplete);

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <Eyebrow>Private konkurrencer <InfoDot title="Ligaer">Private konkurrencer, du opretter og inviterer venner til. Klik på en liga for at se stillingen.</InfoDot></Eyebrow>
          <H>Dine ligaer</H>
        </div>
        <button style={btnGhost} onClick={openCreate}><Plus size={15} /> Opret</button>
      </div>

      {/* Join med kode */}
      <Card>
        <Eyebrow>Join med kode</Eyebrow>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="field" style={{ flex: 1 }} placeholder="Invitationskode…" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
          <button style={{ ...btnGold, opacity: busy || !inviteCode ? 0.5 : 1 }} onClick={joinCompetition} disabled={busy || !inviteCode}>Join</button>
        </div>
        {joinErr && <p style={{ color: C.red, fontSize: 13, margin: "8px 0 0" }}>{joinErr}</p>}
      </Card>

      {competitions.length === 0 && (
        <Card style={{ borderStyle: "dashed", background: "transparent" }}>
          <div style={{ color: C.muted, fontSize: 13, textAlign: "center" }}>
            Ingen ligaer endnu — opret en, eller join med en kode ovenfor.
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
            <Archive size={14} /> Arkiverede ligaer ({archived.length}) <ChevronRight size={14} style={{ transform: showArchived ? "rotate(90deg)" : "none" }} />
          </div>
          {showArchived && archived.map((c) => <LeagueCard key={c.id} c={c} isArchived />)}
        </>
      )}
    </div>
  );
}

export default LigaerTab;
