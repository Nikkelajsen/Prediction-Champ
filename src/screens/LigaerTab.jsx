// Ligaer-fanen (liga-laget). Øverst: brugerens ligaer (fællesskaber). Nedenunder:
// "Øvrige konkurrencer" — liga-løse konkurrencer, der virker som før (overgangslag).
// Spec: docs/features/liga-laget-v1.md.
import { useState, useEffect, useCallback } from "react";
import { ChevronRight, Plus, Archive, Trash2, Users, Info } from "lucide-react";
import { computeCompetitionState, loadCompetitionStatuses, loadMyGroups, createGroup, joinByInviteCode, setCompetitionHidden, deleteCompetition } from "../lib/data.js";
import { leaders } from "../lib/standings.js";
import { C, btnGhost, btnGold, btnGreen, font } from "../ui/theme.js";
import { Card, Collapsible, Eyebrow, H, InfoDot, Modal } from "../ui/components.jsx";
import { readUserFlag, writeUserFlag, readSeenCompletions, markCompletionSeen, NUDGE_KEY } from "../lib/localFlags.js";
import { validateGroupName } from "../lib/onboarding.js";
import CompetitionCard, { cardAction } from "./liga/CompetitionCard.jsx";

function LigaerTab({ token, userId, competitions, openBoard, openCreate, openGroup, reload, openProfile }) {
  const [groups, setGroups] = useState(null);
  const [statusMap, setStatusMap] = useState({});
  const [showArchived, setShowArchived] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinErr, setJoinErr] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  // I4: har man ligaer, foldes opret/deltag sammen til én kompakt knap-række,
  // og panelet her styrer, hvilket af de to inputfelter der er foldet ud.
  const [openPanel, setOpenPanel] = useState(null); // null | "create" | "join"
  const [pendingDelete, setPendingDelete] = useState(null); // konkurrencen, der afventer bekræftelse (G31)
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState(""); // fejl fra arkivér/gendan/slet
  const [nudgeGone, setNudgeGone] = useState(() => !!readUserFlag(NUDGE_KEY, userId));
  const [seenDone, setSeenDone] = useState(() => readSeenCompletions(userId));

  async function reloadGroups() {
    try { setGroups(await loadMyGroups(token, userId)); } catch { setGroups([]); }
  }
  useEffect(() => { reloadGroups(); }, [token, userId]); // eslint-disable-line

  // liga-løse konkurrencer (dem med gruppetilhør vises på liga-siden i stedet)
  const loose = competitions.filter((c) => !c.group_id);

  // To trin, og delingen er hele pointen.
  //
  // FØR: `computeCompetitionState` — appens tungeste loader, seks kald — blev
  // kørt én gang PR. KONKURRENCE, alene for at kunne skrive "afsluttet" og
  // "12/34 spillet" på et kort. Belastningen voksede lineært med antallet af
  // konkurrencer, altså netop for de mest aktive brugere.
  //
  // NU: status til alle kortene på én gang (fire opslag i alt), og den tunge
  // loader kun for de AFSLUTTEDE — der, hvor vinderens navn faktisk skal bruges.
  useEffect(() => {
    let cancelled = false;
    const ids = loose.map((c) => c.id);
    (async () => {
      let statuses = {};
      try { statuses = await loadCompetitionStatuses(token, userId, ids); } catch { /* tomt kort frem for intet kort */ }
      if (cancelled) return;
      setStatusMap(statuses);

      const doneIds = ids.filter((id) => statuses[id]?.concluded);
      if (!doneIds.length) return;
      const details = await Promise.all(doneIds.map(async (id) => {
        try {
          const state = await computeCompetitionState(token, id);
          // Placeringen er rækkens ÆGTE rang (sat af assignRanks i computeCompetitionState),
          // ikke listeindekset: to spillere, der står ægte lige, er begge nr. 2 — ikke 2 og 3.
          const me = state.rows.find((r) => r.userId === userId);
          // Vinderen kan være delt. `leaders` giver alle på 1. pladsen, som Championship-
          // fanens kåring allerede gør — en skjult nøgle må ikke udpege én af to lige.
          return [id, { winners: leaders(state.rows), participants: state.rows.length, myPos: me ? me.rank : null, myShared: !!me?.shared }];
        } catch { return [id, null]; }
      }));
      if (cancelled) return;
      setStatusMap((prev) => {
        const next = { ...prev };
        for (const [id, extra] of details) if (extra) next[id] = { ...next[id], ...extra };
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [competitions]); // eslint-disable-line

  // Fejringen er set. Skrives til enheden, så den ikke kører igen ved næste
  // åbning — og kun første gang, jf. `markCompletionSeen`.
  const markSeen = useCallback((compId) => {
    setSeenDone(markCompletionSeen(userId, compId));
  }, [userId]);

  // Arkivering og sletning meldte ikke fejl (G31, august 2026): fejlede kaldet,
  // blev rækken bare stående, som om intet var sket — og brugeren havde ingen
  // måde at se forskel på "det virkede ikke" og "jeg trykkede ved siden af".
  // Fejlen vises nu ét sted øverst i fanen, fordi den hører til handlingen og
  // ikke til det kort, der stadig står der.
  async function setArchived(compId, hidden) {
    setActionError("");
    try {
      await setCompetitionHidden(token, userId, compId, hidden);
      await reload();
    } catch {
      setActionError(hidden ? "Kunne ikke arkivere konkurrencen lige nu." : "Kunne ikke gendanne konkurrencen lige nu.");
    }
  }

  // Bekræftelsen bruger appens egen Modal frem for `window.confirm`.
  //
  // Den native dialog brød det visuelle sprog netop dét ene sted, hvor
  // handlingen er UOPRETTELIG — og den er samtidig den eneste dialog i appen,
  // der ikke kan skrives i to linjer, så konsekvensen ("for ALLE deltagere")
  // stod som én lang sætning i en systemboks. `Modal` fandtes allerede.
  async function confirmDelete() {
    const comp = pendingDelete;
    if (!comp) return;
    setDeleting(true);
    setActionError("");
    try {
      await deleteCompetition(token, comp.id);
      setPendingDelete(null);
      await reload();
    } catch {
      setPendingDelete(null);
      setActionError(`Kunne ikke slette "${comp.name}" lige nu. Prøv igen om lidt.`);
    } finally {
      setDeleting(false);
    }
  }

  async function createNewGroup() {
    // Reglen er `validateGroupName` (lib/onboarding.js) og ingen andre steder
    // (G53, august 2026). Her stod en håndrullet kopi, der kun kendte den ene
    // af de to grænser: 41 tegn slap forbi og blev til databasens rå fejltekst
    // i catch-blokken nedenfor — altså præcis dét, kopien var skrevet for at
    // undgå. Guiden og opret-skærmen kaldte den fælles regel i forvejen, så
    // rettelsen var at slette den tredje udgave, ikke at rette den.
    const problem = validateGroupName(newName);
    if (problem) { setJoinErr(problem); return; }
    setCreating(true); setJoinErr("");
    try {
      const g = await createGroup(token, userId, newName);
      setNewName("");
      await reloadGroups();
      openGroup(g.id);
    } catch (e) { setJoinErr(e.message || "Kunne ikke oprette ligaen."); } finally { setCreating(false); }
  }

  // Samlet join: prøv liga-kode først, dernæst konkurrence-kode (bagudkompatibelt).
  // Selve opslaget og skrivningen bor i `joinByInviteCode` (data/competitions.js), så denne vej
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
  const active = visible.filter((c) => !statusMap[c.id]?.concluded);
  const completed = visible.filter((c) => statusMap[c.id]?.concluded);
  const canNudge = !nudgeGone && groups && groups.length === 0 && loose.some((c) => c.created_by === userId);
  function dismissNudge() { writeUserFlag(NUDGE_KEY, userId, "1"); setNudgeGone(true); }

  const LeagueCard = ({ c, isArchived }) => {
    const s = statusMap[c.id];
    const canArchive = s?.concluded || isArchived;
    return (
      <CompetitionCard
        c={c} status={s} winners={s?.winners || []}
        myPos={s?.myPos ?? null} myShared={!!s?.myShared}
        meta={s?.participants != null ? `${s.participants} deltager${s.participants === 1 ? "" : "e"}` : null}
        // Arkiverede kort fejrer ikke: man har set afslutningen, hvis man selv
        // har lagt den væk.
        celebrate={!!s?.concluded && !isArchived && !seenDone.has(c.id)}
        onCelebrated={markSeen}
        onOpen={() => openBoard(c.id)}
        onOpenProfile={openProfile}
      >
        {canArchive && (
          <button type="button" style={cardAction()}
            onClick={(e) => { e.stopPropagation(); setArchived(c.id, !isArchived); }}>
            {isArchived ? "Gendan" : "Arkivér"}
          </button>
        )}
        {c.created_by === userId && (
          <button type="button" style={cardAction("danger")}
            onClick={(e) => { e.stopPropagation(); setPendingDelete(c); }}>
            <Trash2 size={12} /> Slet
          </button>
        )}
      </CompetitionCard>
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
      {/* Fejl fra arkivér/gendan/slet. Står øverst og ikke ved kortet: kortet
          er der stadig — det er netop pointen — så beskeden hører til
          handlingen. role="alert" læses op af en skærmlæser (G31). */}
      {actionError && (
        <p role="alert" style={{ color: C.red, fontSize: 13, margin: 0 }}>{actionError}</p>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <Eyebrow>Dine ligaer <InfoDot title="Ligaer">En liga er dit permanente fællesskab — en vennegruppe, et kontor, en familie. Konkurrencer lever inde i ligaen, og hvert medlem vælger selv, hvilke det er med i. Del ét invite-link, så alle er med.</InfoDot></Eyebrow>
          <H>Ligaer</H>
        </div>
        {/* Knappen lå før inde i "Øvrige konkurrencer"-blokken, som kun renderes,
            når man HAR liga-løse konkurrencer. En bruger uden nogen havde dermed
            slet ingen vej til at oprette en — præcis den bruger, der havde brug
            for den. Ligger nu fast øverst.
            Den samme fejl overlevede halvt i betingelsen `groups.length > 0`
            (G54, august 2026): den stammede fra dengang en konkurrence kunne
            være liga-løs, hvor det gav mening at kræve en liga først. I dag ER
            ligaen et krav (`createCompetition` kaster uden `groupId`), og
            opret-skærmen kan oprette den to felter fra "Opret" — så betingelsen
            skjulte kernehandlingen for netop den nye bruger, den engang
            beskyttede. Vises nu også, mens ligalisten hentes: `openCreate(null)`
            er en gyldig start, og en knap, der popper op et sekund senere, er
            sin egen slags forvirring. */}
        <button style={btnGhost} onClick={() => openCreate(groups?.length === 1 ? groups[0].id : null)}>
          <Plus size={14} /> Ny konkurrence
        </button>
      </div>

      {/* Opret liga + deltag med kode (I4). To tilstande med hver sin målgruppe:
          uden ligaer ER de to felter opgaven og vises fuldt — med ligaer er de
          sekundære og foldes sammen til én kompakt knap-række, så ligalisten
          rykker op som det første, man ser. Spejlbilledet af "Ny konkurrence"-
          rettelsen ovenfor: vis tingene for dem, der har brug for dem. */}
      {groups && groups.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btnGhost} aria-expanded={openPanel === "create"}
              onClick={() => setOpenPanel(openPanel === "create" ? null : "create")}>
              <Plus size={14} /> Opret liga
            </button>
            <button style={btnGhost} aria-expanded={openPanel === "join"}
              onClick={() => setOpenPanel(openPanel === "join" ? null : "join")}>
              Deltag med kode
            </button>
          </div>
          {openPanel === "create" && (
            <Card>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="field" style={{ flex: 1 }} placeholder="Navn på liga (2–40 tegn)…" value={newName} maxLength={40} autoFocus
                  onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createNewGroup()} />
                <button style={{ ...btnGreen, width: "auto", padding: "8px 14px", opacity: creating || !newName.trim() ? 0.5 : 1 }}
                  disabled={creating || !newName.trim()} onClick={createNewGroup}><Plus size={15} /> Opret</button>
              </div>
              {joinErr && <p style={{ color: C.red, fontSize: 13, margin: "8px 0 0" }}>{joinErr}</p>}
            </Card>
          )}
          {openPanel === "join" && (
            <Card>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="field" style={{ flex: 1 }} placeholder="Invitationskode…" value={inviteCode} autoFocus
                  autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  onChange={(e) => setInviteCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && joinByCode()} />
                <button style={{ ...btnGold, opacity: busy || !inviteCode ? 0.5 : 1 }} onClick={joinByCode} disabled={busy || !inviteCode}>Deltag</button>
              </div>
              {joinErr && <p style={{ color: C.red, fontSize: 13, margin: "8px 0 0" }}>{joinErr}</p>}
            </Card>
          )}
        </div>
      ) : (<>
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
            <input className="field" style={{ flex: 1 }} placeholder="Invitationskode…" value={inviteCode}
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              onChange={(e) => setInviteCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && joinByCode()} />
            <button style={{ ...btnGold, opacity: busy || !inviteCode ? 0.5 : 1 }} onClick={joinByCode} disabled={busy || !inviteCode}>Deltag</button>
          </div>
          {joinErr && <p style={{ color: C.red, fontSize: 13, margin: "8px 0 0" }}>{joinErr}</p>}
        </Card>
      </>)}

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
            <Collapsible
              open={showArchived} onToggle={() => setShowArchived(!showArchived)}
              label="arkiverede konkurrencer" grow={false}
              style={{ color: C.muted, fontSize: 13, padding: "4px 2px", justifyContent: "flex-start", gap: 6 }}
              header={<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Archive size={14} /> Arkiverede ({archived.length})
              </span>}
            >
              {archived.map((c) => <LeagueCard key={c.id} c={c} isArchived />)}
            </Collapsible>
          )}
        </>
      )}

      {/* Bekræftelse før en uoprettelig handling (G31). Appens egen dialog frem
          for window.confirm: den native boks brød det visuelle sprog netop dét
          sted, hvor konsekvensen er størst — og kunne ikke rumme, at sletningen
          gælder ALLE deltagere, som andet end en lang sætning. */}
      {pendingDelete && (
        <Modal title="Slet konkurrencen?" onClose={() => (deleting ? null : setPendingDelete(null))}>
          <p style={{ margin: "0 0 4px" }}>
            <b>{pendingDelete.name}</b> slettes for <b>alle deltagere</b>, ikke kun for dig.
          </p>
          <p style={{ color: C.muted, fontSize: 13, margin: "8px 0 0" }}>
            Tips, point og stillinger følger med. Det kan ikke fortrydes.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button style={btnGhost} onClick={() => setPendingDelete(null)} disabled={deleting}>Fortryd</button>
            <button style={{ ...btnGhost, borderColor: C.red, color: C.red }} onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Sletter …" : "Slet konkurrencen"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default LigaerTab;
