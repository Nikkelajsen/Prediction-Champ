// Liga-siden (liga-laget). Fællesskabets side: konkurrencer med til-/framelding,
// medlemsliste, ét delbart invite-link, opret konkurrence og flyt egne konkurrencer
// ind i ligaen. Spec: docs/features/liga-laget-v1.md.
import { useState, useEffect, useCallback } from "react";
import { Archive, Check, Copy, Crown, Loader2, LogOut, MoveRight, Plus, Trash2, UserMinus } from "lucide-react";
import {
  computeCompetitionState, deleteCompetition, deleteGroup, joinCompetition, leaveCompetition, leaveGroup,
  loadCompetitionParticipants, loadCompetitionStatuses, loadGroupDetail, moveCompetitionToGroup,
  removeParticipant, setCompetitionHidden,
} from "../lib/data.js";
import { leaders } from "../lib/standings.js";
import { logEvent } from "../lib/analytics.js";
import { shareText } from "../lib/share.js";
import { C, btnGhost, btnGold, btnGreen, font, muted } from "../ui/theme.js";
import { BackBar, Card, Collapsible, Eyebrow, InviteCode, Modal, PlayerName } from "../ui/components.jsx";
import { readSeenCompletions, markCompletionSeen } from "../lib/localFlags.js";
import CompetitionCard, { cardAction } from "./liga/CompetitionCard.jsx";

function GroupScreen({ token, userId, groupId, myCompetitions, onBack, openBoard, openCreate, reloadGroups, openProfile }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState(null); // konkurrence-id under til-/framelding
  const [note, setNote] = useState("");       // fejl/info-besked
  const [leaving, setLeaving] = useState(false);
  const [statusMap, setStatusMap] = useState({});
  const [showArchived, setShowArchived] = useState(false);
  const [seenDone, setSeenDone] = useState(() => readSeenCompletions(userId));
  const [pendingDelete, setPendingDelete] = useState(null); // konkurrencen, der afventer bekræftelse
  const [pendingGroupDelete, setPendingGroupDelete] = useState(false);
  const [roster, setRoster] = useState({}); // compId → deltagerliste (kun liga-admin, kun når foldet ud)

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await loadGroupDetail(token, userId, groupId);
      setDetail(d);
    } catch { setDetail(null); }
    setLoading(false);
  }, [token, userId, groupId]);

  useEffect(() => { load(); }, [load]);

  // Status til alle ligaens konkurrencer på én gang, og først derefter den tunge
  // stillings-loader til de AFSLUTTEDE — der, hvor vinderens navn skal bruges.
  // Samme deling som på Ligaer-fanen; se src/lib/data/competitionStatus.js.
  const compIds = (detail?.competitions || []).map((c) => c.id).join(",");
  useEffect(() => {
    if (!detail) return undefined;
    let cancelled = false;
    const ids = detail.competitions.map((c) => c.id);
    (async () => {
      let statuses = {};
      try { statuses = await loadCompetitionStatuses(token, userId, ids); } catch { /* tomt kort frem for intet kort */ }
      if (cancelled) return;
      setStatusMap(statuses);

      // Kun konkurrencer, man selv er med i: stillingen kan først læses af en
      // deltager, og et kort med "Deltag"-knap har ingen vinderlinje at vise.
      const doneIds = detail.competitions.filter((c) => c.joined && statuses[c.id]?.concluded).map((c) => c.id);
      if (!doneIds.length) return;
      const details = await Promise.all(doneIds.map(async (id) => {
        try {
          const state = await computeCompetitionState(token, id);
          const me = state.rows.find((r) => r.userId === userId);
          // Delt sejr giver flere vindere — `leaders` er den samme regel som
          // Championship-fanens kåring.
          return [id, { winners: leaders(state.rows), myPos: me ? me.rank : null, myShared: !!me?.shared }];
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
  }, [token, userId, compIds]); // eslint-disable-line

  const markSeen = useCallback((compId) => {
    setSeenDone(markCompletionSeen(userId, compId));
  }, [userId]);

  async function shareInvite() {
    if (!detail) return;
    const link = `${window.location.origin}${window.location.pathname}?liga=${detail.group.invite_code}`;
    const text = `Du er inviteret til ligaen "${detail.group.name}" på Leagly ⚽\nGæt resultater, saml point og se hvem der er bedst. Tryk her for at være med:\n${link}`;
    try {
      if (await shareText(text) === "clipboard") { setCopied(true); setTimeout(() => setCopied(false), 2000); }
      logEvent(token, "league_invite_sent", { groupId: detail.group.id, metadata: { via: "liga_link" } });
    } catch { /* annulleret — ignorér */ }
  }

  async function onJoin(compId) {
    setBusyId(compId); setNote("");
    // groupId med: idempotent for et eksisterende medlem, men gør kaldet ens
    // alle steder, så ingen sti kan glemme liga-medlemskabet (A8).
    try { await joinCompetition(token, userId, compId, groupId); await load(); }
    catch (e) { setNote(e.message || "Kunne ikke deltage — prøv igen."); }
    finally { setBusyId(null); }
  }
  async function onLeave(compId) {
    setBusyId(compId); setNote("");
    try {
      const ok = await leaveCompetition(token, userId, compId);
      // To grene i RLS-policyen (sql/group_membership_invariant.sql): framelding er
      // tilladt, når ALLE konkurrencens kampe har resultat — ellers spærrer tips på
      // låste kampe. Beskeden skal sige begge dele, ellers ligner spærren permanent.
      if (!ok) { setNote("Du kan ikke framelde dig midt i en konkurrence, hvor du har tips på låste kampe. Når alle konkurrencens kampe er spillet, kan du frameldes."); }
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

  // Arkivering er PERSONLIG (`competition_participants.hidden`) og gælder kun
  // dem, man selv deltager i — ellers findes rækken, flaget bor på, ikke.
  async function onArchive(compId, hidden) {
    setNote("");
    try { await setCompetitionHidden(token, userId, compId, hidden); await load(); }
    catch { setNote(hidden ? "Kunne ikke arkivere konkurrencen lige nu." : "Kunne ikke gendanne konkurrencen lige nu."); }
  }

  // Deltagerlisten hentes først, når en liga-admin folder den ud: den koster tre
  // opslag pr. konkurrence, og de fleste besøg på liga-siden handler om noget
  // andet. Andet klik folder sammen igen.
  async function toggleRoster(compId) {
    if (roster[compId]) { setRoster((r) => ({ ...r, [compId]: null })); return; }
    setBusyId(compId); setNote("");
    try {
      const people = await loadCompetitionParticipants(token, compId);
      setRoster((r) => ({ ...r, [compId]: people }));
    } catch { setNote("Kunne ikke hente deltagerne lige nu."); }
    finally { setBusyId(null); }
  }

  async function onRemoveParticipant(compId, targetId) {
    setNote("");
    try {
      const ok = await removeParticipant(token, compId, targetId);
      // RLS er dommeren. Er den uenig, har vedkommende nået at tippe, siden
      // listen blev hentet — og så skal beskeden sige netop det.
      if (!ok) { setNote("Deltageren kunne ikke fjernes — der er tips i konkurrencen nu."); }
      setRoster((r) => ({ ...r, [compId]: (r[compId] || []).filter((p) => p.userId !== targetId) }));
      await load();
    } catch (e) { setNote(e.message || "Kunne ikke fjerne deltageren."); }
  }

  async function confirmDeleteCompetition() {
    const comp = pendingDelete;
    if (!comp) return;
    setBusyId(comp.id); setNote("");
    try {
      const ok = await deleteCompetition(token, comp.id);
      setPendingDelete(null);
      if (!ok) { setNote(`"${comp.name}" kunne ikke slettes — der er tips i den nu.`); }
      await load(); await reloadGroups?.();
    } catch {
      setPendingDelete(null);
      setNote(`Kunne ikke slette "${comp.name}" lige nu. Prøv igen om lidt.`);
    } finally { setBusyId(null); }
  }

  async function onLeaveGroup() {
    if (!window.confirm(`Forlad ligaen "${detail.group.name}"? Dine tips og historik bevares.`)) return;
    setLeaving(true);
    try {
      const ok = await leaveGroup(token, userId, groupId);
      if (!ok) {
        // RLS blokerede: man deltager stadig i mindst én af ligaens konkurrencer.
        // Uden denne besked ville brugeren blive sendt tilbage og tro, de var ude.
        setNote("Du deltager stadig i en af ligaens konkurrencer. Frameld dig dem først — så kan du forlade ligaen.");
        setLeaving(false);
        await load();
        return;
      }
      await reloadGroups?.();
      onBack();
    } catch (e) { setNote(e.message || "Kunne ikke forlade ligaen."); setLeaving(false); }
  }

  async function confirmDeleteGroup() {
    setLeaving(true); setNote("");
    try {
      const ok = await deleteGroup(token, groupId);
      setPendingGroupDelete(false);
      if (!ok) { setNote("Ligaen kan kun slettes, når ingen af dens konkurrencer er i gang."); setLeaving(false); await load(); return; }
      await reloadGroups?.(); onBack();
    } catch (e) { setPendingGroupDelete(false); setNote(e.message || "Kunne ikke slette ligaen."); setLeaving(false); }
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

  // Tre bunker, samme opdeling som Ligaer-fanen. Arkivering er personlig, så en
  // konkurrence, man ikke deltager i, kan aldrig ligge i arkivet.
  const visible = competitions.filter((c) => !c.hidden);
  const archived = competitions.filter((c) => c.hidden);
  const active = visible.filter((c) => !statusMap[c.id]?.concluded);
  const completed = visible.filter((c) => statusMap[c.id]?.concluded);
  // Ligaen kan først slettes, når intet er i gang. Knappen skjules i modsat
  // fald frem for at fejle bagefter — RLS siger det samme, men et nej efter et
  // klik er en dårligere måde at få det at vide på.
  const allConcluded = competitions.length > 0 && competitions.every((c) => statusMap[c.id]?.concluded);

  const CompCard = ({ c }) => {
    const s = statusMap[c.id];
    const done = !!s?.concluded;
    const people = roster[c.id];
    return (
      <CompetitionCard
        c={c} status={s}
        winners={c.joined ? (s?.winners || []) : []}
        myPos={c.joined ? (s?.myPos ?? null) : null} myShared={!!s?.myShared}
        meta={`${c.participantCount} deltager${c.participantCount === 1 ? "" : "e"}`}
        celebrate={done && c.joined && !c.hidden && !seenDone.has(c.id)}
        onCelebrated={markSeen}
        onOpen={c.joined ? () => openBoard(c.id) : undefined}
        onOpenProfile={openProfile}
        right={c.joined ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.green, fontSize: 12, fontWeight: 700 }}>
            <Check size={13} /> Med
          </span>
        ) : (
          <button style={{ ...btnGreen, width: "auto", padding: "8px 14px", opacity: busyId === c.id ? 0.6 : 1 }}
            disabled={busyId === c.id} onClick={(e) => { e.stopPropagation(); onJoin(c.id); }}>
            {busyId === c.id ? "…" : "Deltag"}
          </button>
        )}
      >
        {c.joined && (
          <button type="button" style={cardAction()} onClick={(e) => { e.stopPropagation(); onLeave(c.id); }}>
            Frameld dig
          </button>
        )}
        {c.joined && (done || c.hidden) && (
          <button type="button" style={cardAction()} onClick={(e) => { e.stopPropagation(); onArchive(c.id, !c.hidden); }}>
            {c.hidden ? "Gendan" : "Arkivér"}
          </button>
        )}
        {isAdmin && (
          <button type="button" style={cardAction()} aria-expanded={!!people}
            onClick={(e) => { e.stopPropagation(); toggleRoster(c.id); }}>
            Deltagere
          </button>
        )}
        {isAdmin && (
          <button type="button" style={cardAction("danger")}
            onClick={(e) => { e.stopPropagation(); setPendingDelete(c); }}>
            <Trash2 size={12} /> Slet
          </button>
        )}
        {people && (
          <div style={{ width: "100%", borderTop: `1px solid ${C.line}`, marginTop: 4, paddingTop: 6 }}
            onClick={(e) => e.stopPropagation()}>
            {people.length === 0 && <div style={{ color: C.muted, fontSize: 12 }}>Ingen deltagere endnu.</div>}
            {people.map((p) => (
              <div key={p.userId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
                <span style={{ fontSize: 13 }}>
                  <PlayerName userId={p.userId} name={p.name} you={p.userId === userId} onOpenProfile={openProfile} />
                </span>
                {/* Kun den urørte kan fjernes — samme grænse som RLS. En, der har
                    tippet, har en stilling, og den er ikke administratorens at
                    slette. Teksten siger hvorfor, så knappens fravær ikke ligner
                    en fejl. */}
                {p.tipped || p.userId === userId ? (
                  <span style={{ color: C.muted, fontSize: 11 }}>{p.userId === userId ? "dig" : "har tippet"}</span>
                ) : (
                  <button type="button" style={cardAction("danger")} onClick={() => onRemoveParticipant(c.id, p.userId)}>
                    <UserMinus size={12} /> Fjern
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </CompetitionCard>
    );
  };

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
      {/* Linket er den nemme vej; koden er den, der kan siges højt. Den passer
          i "Deltag med kode"-feltet på Ligaer-fanen. */}
      <InviteCode code={group.invite_code} label="Liga-kode" />

      {note && <Card style={{ borderColor: C.red }}><span role="alert" style={{ color: C.red, fontSize: 13 }}>{note}</span></Card>}

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
          {active.map((c) => <CompCard key={c.id} c={c} />)}
          {completed.length > 0 && (
            <>
              <Eyebrow>Afsluttede</Eyebrow>
              {completed.map((c) => <CompCard key={c.id} c={c} />)}
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
              {archived.map((c) => <CompCard key={c.id} c={c} />)}
            </Collapsible>
          )}
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
                <PlayerName userId={m.userId} name={m.name} you={m.userId === userId} onOpenProfile={openProfile} />
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
        {isAdmin && (competitions.length === 0 || allConcluded) && (
          <span onClick={leaving ? undefined : () => setPendingGroupDelete(true)} style={{ color: C.red, fontSize: 13, cursor: leaving ? "default" : "pointer" }}>
            Slet ligaen
          </span>
        )}
      </div>

      {/* Bekræftelse før en uoprettelig handling. Appens egen dialog frem for
          window.confirm: konsekvensen skal kunne stå i to linjer. */}
      {pendingDelete && (
        <Modal title="Slet konkurrencen?" onClose={() => (busyId ? null : setPendingDelete(null))}>
          <p style={{ margin: "0 0 4px" }}>
            <b>{pendingDelete.name}</b> slettes for <b>alle i ligaen</b>, ikke kun for dig.
          </p>
          <p style={{ color: C.muted, fontSize: 13, margin: "8px 0 0" }}>
            Som liga-admin kan du kun slette en konkurrence, ingen af deltagerne har tippet i. Har nogen tippet, er stillingen deres — så bliver konkurrencen stående.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button style={btnGhost} onClick={() => setPendingDelete(null)} disabled={!!busyId}>Fortryd</button>
            <button style={{ ...btnGhost, borderColor: C.red, color: C.red }} onClick={confirmDeleteCompetition} disabled={!!busyId}>
              {busyId ? "Sletter …" : "Slet konkurrencen"}
            </button>
          </div>
        </Modal>
      )}

      {pendingGroupDelete && (
        <Modal title="Slet ligaen?" onClose={() => (leaving ? null : setPendingGroupDelete(false))}>
          <p style={{ margin: "0 0 4px" }}>
            <b>{group.name}</b> lukkes for alle medlemmer.
          </p>
          <p style={{ color: C.muted, fontSize: 13, margin: "8px 0 0" }}>
            {competitions.length > 0
              ? "Ligaens konkurrencer slettes ikke — de flytter ud af ligaen og står videre under “Øvrige konkurrencer” med stilling, tips og kåringer i behold."
              : "Ligaen er tom, så der er intet at flytte."}
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button style={btnGhost} onClick={() => setPendingGroupDelete(false)} disabled={leaving}>Fortryd</button>
            <button style={{ ...btnGhost, borderColor: C.red, color: C.red }} onClick={confirmDeleteGroup} disabled={leaving}>
              {leaving ? "Sletter …" : "Slet ligaen"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default GroupScreen;
