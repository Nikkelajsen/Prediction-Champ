// Stilling for én konkurrence: tabellen, point pr. runde, kåringer og
// invitationslinket. Drill-in fra Hjem og Ligaer.
import { useState, useEffect } from "react";
import { Trophy, Copy, Check, ClipboardList, Share2 } from "lucide-react";
import { lockedRoundsOf, roundLabel } from "../lib/scoring.js";
import { leaders } from "../lib/standings.js";
import { computeCompetitionState, loadRatingMap, ensureCompetitionAwards, loadCompetitionAwards, monthName } from "../lib/data.js";
import { isAborted } from "../lib/supabase.js";
import { logEvent } from "../lib/analytics.js";
import { shareText, shareImage, inviteShareText } from "../lib/share.js";
import { drawStandings, standingsHeight, standingsShareText } from "../lib/shareCanvas.js";
import { C, btnGhost, btnGold, font, iconBtn, muted, thStyle } from "../ui/theme.js";
import { BackBar, Card, EmptyCompetitions, InviteCode, PlayerName, UserRoundPredictions } from "../ui/components.jsx";

// Én kåringslinje pr. periode: "🏅 Ugens bedste · 12/08 – 18/08: Nikolaj (14
// point)". Delt førsteplads er flere rækker med samme period_key — de samles
// her til "A og B (14 point — delt)", samme mønster som konkurrencevinderne på
// Ligaer-fanen. Modulniveau-komponent (ikke inline i BoardScreen) af hensyn
// til React Compilers static-components-regel.
function AwardLines({ title, rows, labelOf, nameOf, openProfile }) {
  const periods = [];
  const idx = new Map();
  for (const r of rows) {
    if (!idx.has(r.period_key)) { idx.set(r.period_key, periods.length); periods.push({ key: r.period_key, winners: [] }); }
    periods[idx.get(r.period_key)].winners.push(r);
  }
  return periods.map((p) => (
    <div key={p.key} style={{ padding: "3px 0", fontSize: 13, lineHeight: 1.5 }}>
      <span style={{ color: C.gold, fontWeight: 700 }}>🏅 {title}</span>
      <span style={{ color: C.muted, fontSize: 12 }}> · {labelOf(p.key)}: </span>
      <span style={{ color: C.text, fontWeight: 600 }}>
        {p.winners.map((w, i) => (
          <span key={w.user_id}>
            {i > 0 && (i === p.winners.length - 1 ? " og " : ", ")}
            <PlayerName userId={w.user_id} name={nameOf(w.user_id)} onOpenProfile={openProfile} />
          </span>
        ))}
      </span>
      <span style={{ color: C.muted, fontSize: 12 }}> ({p.winners[0].points} point{p.winners[0].shared ? " — delt" : ""})</span>
    </div>
  ));
}

// Hvilken konkurrence VISER skærmen? (G107)
//
// Den bedt om og den viste er ikke nødvendigvis den samme: kalderen kan pege på
// en konkurrence, listen ikke indeholder — fx en, man netop har meldt sig til, før
// MainApp har hentet sin liste igen, eller en arkiveret, åbnet fra liga-siden.
//
// Uden dette opslag betalte skærmen prisen TO gange for det samme:
//   * indlæsningen faldt igennem sin egen `if (!comp) return`-guard, så
//     `state` blev stående som null og stillings-kortet stod HELT tomt — ingen
//     "Beregner…", ingen fejl, ingen "Ingen deltagere endnu";
//   * og et `<select>`, hvis `value` ikke matcher nogen `<option>`, viser
//     browserens FØRSTE valgmulighed. Vælgeren udpegede altså en helt anden
//     konkurrence end den, brugeren havde bedt om — i praksis en fra en anden
//     liga.
//
// Reglen er derfor: vælgeren og tabellen skal altid være enige. Kan den ønskede
// ikke findes, falder vi tilbage til den første i listen — en anden konkurrence
// vist ÆRLIGT er bedre end den rigtige lovet og ingen leveret.
function effectiveCompId(requestedId, competitions) {
  if (competitions.some((c) => c.id === requestedId)) return requestedId;
  return competitions[0]?.id ?? null;
}

function BoardScreen({ token, userId, competitions, initialCompId, inviterName, onBack, goToPredictions, openProfile, onCreate, goTab }) {
  // Det ØNSKEDE bor i state, det VISTE udledes ved hver render: listen kan
  // ændre sig under skærmen (MainApp henter den igen), og et afledt opslag
  // følger med af sig selv, hvor en synkroniserende effekt ville nå at tegne
  // ét render med den gamle uenighed.
  const [requestedCompId, setRequestedCompId] = useState(initialCompId || competitions[0]?.id || null);
  const selectedCompId = effectiveCompId(requestedCompId, competitions);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0); // "Prøv igen" — genudløser indlæsnings-effekten
  const [copied, setCopied] = useState(false);
  const [showAllRounds, setShowAllRounds] = useState(false);
  const [viewUser, setViewUser] = useState(null);
  const [awards, setAwards] = useState(null);
  const comp = competitions.find((c) => c.id === selectedCompId);
  const awardsEnabled = comp?.mode_params?.awards === true;
  // Hvem der fører — ét opslag, så pokalen, guldfarven og liga-sidens kort
  // svarer det samme. Tom, når ingen har tippet: se `leaders()`.
  const winnerIds = new Set(leaders(state?.rows || []).map((r) => r.userId));

  // G23: computeCompetitionState lå uden for try'en (kun ratings-kaldet var
  // beskyttet), så et kast dér lod setLoading(false) uden for rækkevidde og
  // efterlod stillingen i en evig "Henter stilling …". Ratings beholder sin egen
  // catch: de er valgfri pynt på rækkerne, og en manglende rating må ikke
  // fejlmelde en stilling, der ellers er hentet fint.
  useEffect(() => {
    if (!selectedCompId || !comp) return;
    let cancelled = false;
    // Selve kaldene annulleres, ikke kun deres resultat (G25). `cancelled`-
    // guarden alene forhindrer, at et sent svar lander i state — men kæden på
    // seks opslag løb færdig alligevel, og skiftede man hurtigt mellem
    // konkurrencer, kørte flere kæder oven i hinanden mod den samme forbindelse.
    const ctrl = new AbortController();
    (async () => {
      setLoading(true);
      setLoadError("");
      setShowAllRounds(false);
      try {
        const result = await computeCompetitionState(token, selectedCompId, { signal: ctrl.signal });
        try {
          const ratingMap = await loadRatingMap(token);
          result.rows.forEach((row) => {
            const rt = ratingMap.get(row.userId);
            if (rt) { row.rating = rt.rating; row.provisional = rt.provisional; }
          });
        } catch { /* ratings optional */ }
        if (!cancelled) setState(result);
      } catch (e) {
        // En afbrudt indlæsning er ikke en fejl, brugeren skal se: de bad selv
        // om at komme videre. Uden dette skel ville hvert skift af konkurrence
        // kunne efterlade "Kunne ikke hente stillingen" på den skærm, man netop
        // kom TIL — altså en fejltekst om noget, der aldrig gik galt.
        if (!cancelled && !isAborted(e)) { setState(null); setLoadError("Kunne ikke hente stillingen lige nu."); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; ctrl.abort(); };
  }, [selectedCompId, comp, reloadKey]); // eslint-disable-line

  // Lokale kåringer (I13): trig databasens writer og hent resultatet. Lazy med
  // vilje — boardet er v1's eneste visningsflade, så "første åbning efter en
  // færdig runde" er præcis tidligt nok. Begge kald er ufarlige at gentage.
  // Rækkerne gemmes med deres konkurrence-id i stedet for at blive nulstillet
  // synkront ved skift: render-betingelsen sammenligner id'et, så en anden
  // konkurrences kåringer aldrig vises, heller ikke i et mellem-render.
  useEffect(() => {
    if (!selectedCompId || !awardsEnabled) return;
    let cancelled = false;
    (async () => {
      await ensureCompetitionAwards(token, selectedCompId);
      try {
        const data = await loadCompetitionAwards(token, selectedCompId);
        if (!cancelled) setAwards({ compId: selectedCompId, ...data });
      } catch { /* sektionen udelades */ }
    })();
    return () => { cancelled = true; };
  }, [selectedCompId, awardsEnabled]); // eslint-disable-line

  async function shareInvite() {
    if (!comp) return;
    // Stedet afgør, hvad man inviterer til (A7, juli 2026): konkurrence-siden
    // deler ALTID konkurrence-linket, liga-siden altid liga-linket. Tidligere
    // erstattede denne knap stiltiende konkurrence-linket med liga-linket for
    // liga-konkurrencer, så man slet ikke kunne invitere til én bestemt
    // konkurrence. Ligger konkurrencen i en liga, melder ?join= modtageren ind
    // i BEGGE (A8) — det sker i MainApp.confirmJoin.
    const link = `${window.location.origin}${window.location.pathname}?join=${comp.invite_code}`;
    // Selve ordlyden bor i src/lib/share.js (I7). Den stod her indtil august
    // 2026 og i en anden udgave i GroupScreen — to toner for den samme handling.
    const text = inviteShareText({ inviterName, mål: `konkurrencen "${comp.name}"`, link });
    try {
      if (await shareText(text) === "clipboard") {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
      // Kataloget har intet selvstændigt "konkurrence-invite-sendt"-navn —
      // genbruger league_invite_sent med `via` som diskriminator, så
      // invite-tragten (*_invite_sent → league_invite_accepted) kan følges
      // ende-til-ende for begge link-typer.
      logEvent(token, "league_invite_sent", { competitionId: comp.id, groupId: comp.group_id || null, metadata: { via: "competition_link" } });
    } catch { /* bruger annullerede deling — ignorér */ }
  }

  // Del stillingen som BILLEDE (august 2026). Det er en anden handling end
  // Invitér, som deler et LINK: her er hele pointen, at modtageren skal kunne se
  // tallene uden at åbne noget — en tabel i en gruppechat er en påstand, ikke en
  // invitation. Derfor bærer delingen heller ikke invite-koden; den bor to
  // knapper væk og har sin egen tragt at måles i.
  //
  // KUN #, NAVN OG POINT kommer med. Rating, 🎯 og Form kræver hver deres
  // forklaring — den står i tabellens fodnote og kan ikke rejse med et billede.
  async function shareStandings() {
    if (!comp || !state?.rows?.length) return;
    const meIndex = state.rows.findIndex((r) => r.userId === userId);
    const view = {
      title: comp.name,
      subtitle: state.isComplete ? "Afsluttet" : `${state.playedMatches}/${state.totalMatches} spillet`,
      rows: state.rows,
      meIndex: meIndex < 0 ? null : meIndex,
    };
    try {
      await shareImage((ctx, w, h) => drawStandings(view, ctx, w, h), {
        // Billedteksten siger, HVAD der deles — ikke tabellen igen. Uden den
        // fulgte hele stillingen med som en punktliste under et billede af den
        // samme stilling. Konkurrencens navn står med, fordi det er den ene
        // oplysning, en modtager i en gruppechat kan mangle.
        caption: `Stillingen · ${comp.name}`,
        // Kun hvis billedet ikke kan sendes: da er teksten hele beskeden.
        text: standingsShareText(view),
        height: standingsHeight(view),
      });
      logEvent(token, "standings_shared", {
        competitionId: comp.id, groupId: comp.group_id || null,
        metadata: { rows: state.rows.length, complete: !!state.isComplete },
      });
    } catch { /* bruger annullerede deling — ignorér */ }
  }

  if (!competitions.length) {
    return (
      <div>
        <BackBar title="Stilling" onBack={onBack} />
        <EmptyCompetitions onCreate={onCreate ? () => onCreate(null) : undefined}
          onJoin={goTab ? () => goTab("ligaer") : undefined} />
      </div>
    );
  }

  const roundsDesc = state?.rounds ? state.rounds.slice().reverse() : [];
  const shownRounds = showAllRounds ? roundsDesc : roundsDesc.slice(0, 3);
  // En spillers tips vises, så snart kampen er LÅST — fra låsen (1 time før kampens
  // eget kickoff, A21) kan ingen rette sit gæt, så der er intet at beskytte. Samme
  // regel som "Alles gæt" på Tip-skærmen (`canExpand = locked`).
  // Kravet var før, at hele runden var færdigspillet, hvilket gjorde drill-in'et
  // utilgængeligt i en sæson uden en eneste helt afsluttet runde — et tryk gjorde
  // ingenting, uden at noget forklarede hvorfor.
  // Kun de låste kampe sendes videre, så et gæt aldrig kan ses før deadline. Efter
  // A21 vokser en runde her LØBENDE: den dukker op, når dens første kamp låser, og
  // får flere kampe, efterhånden som resten låser.
  const lockedRounds = lockedRoundsOf(state?.allRounds || []);
  const hasLocked = lockedRounds.length > 0;
  const openUser = (uid, playerName, initialKey = null) => { if (hasLocked) setViewUser({ userId: uid, playerName, initialKey }); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BackBar title="Stilling" onBack={onBack} />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select className="field" style={{ flex: 1, minWidth: 160 }} value={selectedCompId || ""} onChange={(e) => setRequestedCompId(e.target.value)}>
          {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button style={btnGold} onClick={shareInvite}>
          {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Kopieret!" : "Invitér"}
        </button>
        <button style={btnGhost} onClick={() => goToPredictions(selectedCompId)}><ClipboardList size={15} /> Tip</button>
      </div>
      {/* Samme kode, som Invitér-knappen lægger i linket — her i en form, der
          kan læses op eller skrives af. Stedet afgør stadig (A7): her er det
          konkurrencens kode, på liga-siden ligaens. */}
      <InviteCode code={comp?.invite_code} label="Konkurrence-kode" />

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase" }}>Stilling</div>
          {/* Del sidder HER og ikke i handlingsrækken øverst. To grunde: den
              række har allerede en vælger og to knapper og ombryder på en
              telefon — og knappen hører til TABELLEN, ikke til valget af
              konkurrence. Den vises kun, når der er en tabel at dele. */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {!loading && state?.rows?.length > 0 && (
              <button style={iconBtn} aria-label="Del stillingen" title="Del stillingen" onClick={shareStandings}>
                <Share2 size={16} />
              </button>
            )}
            {state?.isComplete
              ? <span style={{ background: "rgba(240,180,41,0.15)", color: C.gold, fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 4 }}><Trophy size={12} />Afsluttet</span>
              : state && state.totalMatches > 0 && <span style={{ color: C.muted, fontSize: 12 }}>{state.playedMatches}/{state.totalMatches} spillet</span>}
          </div>
        </div>
        {loading && <p style={{ ...muted, margin: 0 }}>Beregner…</p>}
        {/* Fejlen står inde i stillings-kortet frem for at erstatte hele skærmen:
            invitér-knappen og konkurrencevælgeren ovenfor virker fint, og en
            fejlet beregning må ikke tage dem med sig. */}
        {!loading && loadError && (
          <div>
            <div style={{ color: C.red, fontSize: 13, marginBottom: 10 }}>{loadError}</div>
            <button type="button" style={btnGhost} onClick={() => setReloadKey((k) => k + 1)}>Prøv igen</button>
          </div>
        )}
        {!loading && state && state.rows.length > 0 && (
          <table style={{ tableLayout: "fixed", width: "100%" }}>
            <colgroup>
              <col style={{ width: 40 }} />
              <col />
              <col style={{ width: 46 }} />
              <col style={{ width: 26 }} />
              <col style={{ width: 30 }} />
              <col style={{ width: 46 }} />
            </colgroup>
            <thead><tr className="rowline">
              <th style={{ ...thStyle, padding: "8px 2px" }}>#</th>
              <th style={{ ...thStyle, padding: "8px 4px" }}>Spiller</th>
              <th style={{ ...thStyle, textAlign: "center", padding: "8px 2px" }} title="Leagly Rating">Rating</th>
              <th style={{ ...thStyle, textAlign: "center", padding: "8px 2px" }} title="Antal præcise resultater">🎯</th>
              <th style={{ ...thStyle, textAlign: "center", padding: "8px 2px" }} title="Point i de seneste 3 runder">Form</th>
              <th style={{ ...thStyle, textAlign: "right", padding: "8px 2px" }}>Point</th>
            </tr></thead>
            <tbody>
              {/* Førstepladsen hentes af `leaders()` og ikke af `rank === 1`.
                  Forskellen viser sig i præcis ét tilfælde, og det er ikke et
                  hjørne: har INGEN tippet, er alle deltagere ægte lige på 0
                  point og får hver sin pokal. `leaders()` svarer da med en tom
                  liste — samme svar som kortet på liga-siden, der altid har
                  spurgt den vej. */}
              {state.rows.map((r) => (
                // Hele rækken er tryk-fladen til spillerens tips runde for runde.
                // Et enkelt tal er et for lille mål på en telefon, og cursor:pointer
                // er usynligt på touch. Navnet ligger ovenpå og stopper propagationen
                // (PlayerName), så det stadig fører til karrieren.
                <tr key={r.player} className="rowline"
                  onClick={hasLocked ? () => openUser(r.userId, r.player) : undefined}
                  title={hasLocked ? `Se ${r.player}s tips runde for runde` : undefined}
                  style={{
                    background: r.userId === userId ? "rgba(34,197,94,0.06)" : "transparent",
                    cursor: hasLocked ? "pointer" : "default",
                  }}>
                  <td style={{ color: winnerIds.has(r.userId) ? C.gold : C.muted, fontWeight: 700, whiteSpace: "nowrap", fontFamily: font.display, padding: "8px 2px" }}>
                    {winnerIds.has(r.userId) && state.isComplete ? "🏆" : r.rank}
                    {r.rankDelta !== undefined && r.rankDelta !== 0 && (
                      <span style={{ fontSize: 11, marginLeft: 4, color: r.rankDelta > 0 ? C.green : C.red }}>
                        {r.rankDelta > 0 ? `▲${r.rankDelta}` : `▼${Math.abs(r.rankDelta)}`}
                      </span>
                    )}
                  </td>
                  <td style={{ color: C.text, fontWeight: r.userId === userId ? 700 : 600, padding: "8px 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <PlayerName userId={r.userId} name={r.player} onOpenProfile={openProfile} truncate />
                  </td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap", padding: "8px 2px" }}>
                    {r.rating != null
                      ? <span style={{ color: C.gold, fontWeight: 700, fontSize: 13 }}>{r.rating}{r.provisional ? <span style={{ color: C.muted, fontWeight: 400 }} title="Foreløbig">*</span> : ""}</span>
                      : <span style={{ color: C.muted, fontSize: 13 }}>–</span>}
                  </td>
                  <td style={{ textAlign: "center", color: C.text, fontSize: 13, padding: "8px 2px" }}>{r.exactCount}</td>
                  <td style={{ textAlign: "center", color: C.muted, fontSize: 13, padding: "8px 2px" }}>{r.form3}</td>
                  <td style={{ textAlign: "right", padding: "8px 2px" }}>
                    <span style={{ background: winnerIds.has(r.userId) ? "rgba(240,180,41,0.15)" : C.surface2, color: winnerIds.has(r.userId) ? C.gold : C.text, fontSize: 15, fontWeight: 700, borderRadius: 999, padding: "3px 8px" }}>{r.total}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && state && state.rows.length > 0 && (
          <p style={{ ...muted, marginTop: 8, marginBottom: 0, fontSize: 11 }}>
            🎯 = præcise resultater · Form = point seneste 3 runder · ▲▼ = ændring efter seneste runde
            {state.rows.some((r) => r.shared) && " · ens placering = delt"}
            {hasLocked
              ? " · tryk på en række for spillerens tips runde for runde, på navnet for karrieren"
              : " · tryk på et navn for karrieren — spillernes tips kan ses, når kampen låser (1 time før kampstart)"}
          </p>
        )}
        {!loading && state && state.rows.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen deltagere endnu.</p>}
      </Card>

      {/* Lokale kåringer (I13) — kun for konkurrencer, der har tilvalgt dem.
          Ordvalget er bevidst IKKE de globale titler: "Ugens/Månedens bedste"
          er konkurrencens egne, "rundevinder"/"månedsmester" er Championships. */}
      {awardsEnabled && awards && awards.compId === selectedCompId && (
        <Card>
          <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Kåringer</div>
          {awards.rounds.length === 0 && awards.months.length === 0 ? (
            <p style={{ ...muted, margin: 0 }}>
              Ugens og Månedens bedste kåres her, når en runde eller kalendermåned er færdigspillet.
            </p>
          ) : (
            <>
              <AwardLines title="Månedens bedste" rows={awards.months} labelOf={monthName}
                nameOf={(uid) => state?.rows.find((r) => r.userId === uid)?.player || "Tidligere deltager"}
                openProfile={openProfile} />
              <AwardLines title="Ugens bedste" rows={awards.rounds} labelOf={roundLabel}
                nameOf={(uid) => state?.rows.find((r) => r.userId === uid)?.player || "Tidligere deltager"}
                openProfile={openProfile} />
            </>
          )}
        </Card>
      )}

      {!loading && state && roundsDesc.length > 0 && (
        <Card>
          <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>Point pr. runde</div>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr className="rowline">
                <th style={thStyle}>Runde</th>
                {state.rows.map((row) => (
                  <th key={row.player} style={{ ...thStyle, textAlign: "center", whiteSpace: "nowrap" }}>
                    <PlayerName userId={row.userId} name={row.player} onOpenProfile={openProfile} />
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {shownRounds.map((r) => {
                  const best = Math.max(...state.rows.map((x) => x.perRound[r.key] ?? -Infinity));
                  return (
                    <tr key={r.key} className="rowline">
                      <td style={{ color: C.text, fontSize: 13, whiteSpace: "nowrap" }}>{r.label}</td>
                      {state.rows.map((row) => {
                        const v = row.perRound[r.key];
                        const isBest = v !== undefined && v === best && v > 0;
                        const clickable = v !== undefined && lockedRounds.some((cr) => cr.key === r.key);
                        return (
                          <td key={row.player} style={{ textAlign: "center", color: isBest ? C.gold : C.text, fontWeight: isBest ? 700 : 400 }}>
                            {clickable
                              ? <span onClick={() => openUser(row.userId, row.player, r.key)} style={{ cursor: "pointer", textDecoration: "underline", textDecorationColor: C.line }}>{v}</span>
                              : (v ?? "–")}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {roundsDesc.length > 3 && (
            <p style={{ ...muted, marginTop: 10, marginBottom: 0, cursor: "pointer", textDecoration: "underline" }}
              onClick={() => setShowAllRounds(!showAllRounds)}>
              {showAllRounds ? "Vis kun de 3 seneste" : `Vis alle ${roundsDesc.length} runder`}
            </p>
          )}
        </Card>
      )}

      {viewUser && state && (
        <UserRoundPredictions playerName={viewUser.playerName} userId={viewUser.userId}
          lockedRounds={lockedRounds} predsByKey={state.predsByKey} initialKey={viewUser.initialKey}
          onClose={() => setViewUser(null)} onOpenProfile={openProfile} />
      )}
    </div>
  );
}

export { effectiveCompId };
export default BoardScreen;
