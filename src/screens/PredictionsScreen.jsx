// Tip-skærmen: rundepager, låst runde som tabel, åben runde med score-input.
//
// Filen var 705 linjer og udpeget som teknisk gæld i DOCUMENTATION.md afsnit 12.
// Rækken, rundehovedet og tids-hjælperne ligger nu i predictions/ — det, der er
// tilbage her, er skærmens egen tilstand og sammensætning.
//
// Re-eksporterne nederst er bevidste: den eksisterende komponent-test importerer
// MatchRow herfra, og resten af appen skal ikke kende til den nye mappe.
import { useState, useEffect, useMemo, useRef } from "react";
import { db } from "../lib/supabase.js";
import { logEvent } from "../lib/analytics.js";
import { currentRoundIndex, groupIntoRounds, isLocked, isPlayed, liveInfo } from "../lib/scoring.js";
import { C, btnGhost, chip, font, muted, thStyle } from "../ui/theme.js";
import { BackBar, Card, EmptyCompetitions, H } from "../ui/components.jsx";
import { groupIntoDays } from "./predictions/time.js";
import { roundStatus } from "./predictions/roundStatus.js";
import { RoundHeader } from "./predictions/RoundHeader.jsx";
import { MatchRow, TeamNames, ROW_COLS, ROW_GAP } from "./predictions/MatchRow.jsx";
import { selectIn } from "../lib/data/chunked.js";

// errIds bærer BESKEDEN og ikke bare `true`: efter G24 kan en række fejle på to
// måder, og "Kunne ikke slette" på et fejlet gem ville pege brugeren det forkerte
// sted hen. Rækken viser det, der står her — den kender ikke de to tilfælde.
const ERR_SAVE = "Kunne ikke gemme — prøv igen";
const ERR_DELETE = "Kunne ikke slette";

function PredictionsScreen({ token, userId, competitions, leagues = [], initialFilter, initialRoundKey, onBack, openProfile, onCreate, goTab }) {
  const [compFilter, setCompFilter] = useState(initialFilter || "all");
  const [leagueFilter, setLeagueFilter] = useState("all");
  const [seasonLeague, setSeasonLeague] = useState({}); // season_id -> league_id
  const [allMatches, setAllMatches] = useState([]);
  const [preds, setPreds] = useState({});
  const [allPreds, setAllPreds] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [teamsById, setTeamsById] = useState({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0); // "Prøv igen" — genudløser indlæsnings-effekten
  const [roundIndex, setRoundIndex] = useState(0);
  const [savedIds, setSavedIds] = useState({});
  const [errIds, setErrIds] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [, setTick] = useState(0);
  const startedRef = useRef(new Set()); // matchIds hvor prediction_started allerede er logget denne sideliv
  const comp = compFilter !== "all" ? competitions.find((c) => c.id === compFilter) : null;

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  // G23: otte sekventielle await uden try/catch betød, at ét kast lod
  // setLoading(false) uden for rækkevidde — skærmen blev stående i "Henter kampe…"
  // for evigt, uden fejl og uden vej ud. Mønstret her er ProfileScreen.jsx'
  // (try/catch/finally + cancelled-guard), som allerede er repoets svar på det.
  useEffect(() => {
    const compIds = compFilter === "all" ? competitions.map((c) => c.id) : [compFilter];
    if (!compIds.length) { setAllMatches([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError("");
      setExpandedId(null);
      try {
        const cms = await selectIn(token, "competition_matches", "competition_id", compIds, "&select=competition_id,match_id");
        const ids = [...new Set(cms.map((c) => c.match_id))];
        if (!ids.length) { setAllMatches([]); setTeamsById({}); return; }
        const ms = await selectIn(token, "matches", "id", ids, "&select=*&order=kickoff_at", { sortBy: "kickoff_at" });
        setAllMatches(ms);
        // season_id -> league_id, så Tips kan filtreres på liga (matchens egen liga,
        // uafhængigt af konkurrencens league_id — virker også for custom/random-kuponer).
        const seasonIds = [...new Set(ms.map((m) => m.season_id).filter(Boolean))];
        if (seasonIds.length) {
          const seasons = await selectIn(token, "seasons", "id", seasonIds, "&select=id,league_id");
          setSeasonLeague(Object.fromEntries(seasons.map((s) => [s.id, s.league_id])));
        } else { setSeasonLeague({}); }
        const teamIds = [...new Set(ms.flatMap((m) => [m.home_team_id, m.away_team_id]))];
        if (teamIds.length) {
          // Tip-rækkerne er det ene sted, pladsen er trang, og derfor det ene
          // sted, det korte holdnavn vises (B39): `short_name` er leverandørens
          // eget visningsnavn ("Santander", "Espanyol") og findes kun for
          // football-data-ligaerne — alle andre falder tilbage på det fulde navn,
          // og det gør resten af appen med vilje også. `select=*` og ikke en
          // kolonneliste, så skærmen tåler, at #72 endnu ikke er kørt.
          const tms = await selectIn(token, "teams", "id", teamIds, "&select=*");
          setTeamsById(Object.fromEntries(tms.map((t) => [t.id, t.short_name || t.name])));
        }
        const ap = await selectIn(token, "predictions", "match_id", ids, "&select=*");
        setAllPreds(ap);
        setPreds(Object.fromEntries(ap.filter((p) => p.user_id === userId).map((p) => [p.match_id, p])));
        const parts = await selectIn(token, "competition_participants", "competition_id", compIds, "&select=user_id");
        const partIds = [...new Set(parts.map((p) => p.user_id))];
        const profs = await selectIn(token, "profiles", "id", partIds, "&select=id,display_name");
        setParticipants(profs);
        const rds = groupIntoRounds(ms);
        // Land på den ønskede runde (fra "Tip nu"/"Se tips" på Hjem), ellers den nærmeste runde.
        const targetIdx = initialRoundKey ? rds.findIndex((r) => r.key === initialRoundKey) : -1;
        setRoundIndex(targetIdx >= 0 ? targetIdx : currentRoundIndex(rds));
      } catch {
        // Delvist hentet data ryddes: står kampene tilbage uden tips eller hold,
        // ligner skærmen en tom runde frem for en fejlet indlæsning.
        if (!cancelled) { setAllMatches([]); setLoadError("Kunne ikke hente kampene lige nu."); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [compFilter, competitions, reloadKey]); // eslint-disable-line

  // Ligaer der optræder i de hentede kampe (til liga-dropdownen).
  const leagueOptions = useMemo(() => {
    const ids = [...new Set(allMatches.map((m) => seasonLeague[m.season_id]).filter(Boolean))];
    return ids.map((id) => ({ id, name: leagues.find((l) => l.id === id)?.name || "Turnering" }));
  }, [allMatches, seasonLeague, leagues]);
  // Kampe filtreret på valgt liga (matchens egen liga via season_id).
  const filteredMatches = useMemo(
    () => leagueFilter === "all" ? allMatches : allMatches.filter((m) => seasonLeague[m.season_id] === leagueFilter),
    [allMatches, leagueFilter, seasonLeague]
  );
  const rounds = useMemo(() => groupIntoRounds(filteredMatches), [filteredMatches]);
  // Klamp indekset: skifter man til et filter med færre runder, renderes der ÉN gang
  // med det gamle roundIndex, før effekten nedenfor retter det (effekter kører efter
  // render) — uden klampen er round undefined og skærmen crasher.
  const safeIndex = Math.min(roundIndex, Math.max(0, rounds.length - 1));
  const round = rounds[safeIndex];

  // Skift af liga-filter: spring til den nærmeste runde i det filtrerede sæt.
  useEffect(() => {
    setRoundIndex(currentRoundIndex(rounds));
  }, [leagueFilter]); // eslint-disable-line

  // Reager på en ny ønsket runde (fx et nyt "Se tips"/"Tip nu"-klik fra Hjem, hvor
  // kampene ikke genindlæses fordi konkurrence-filteret er uændret).
  // appliedRoundKey sikrer, at vi kun springer ÉN gang pr. ønsket runde — ellers ville
  // live-genindlæsningen nedenfor (som laver et nyt rounds-array hvert minut) hive
  // brugeren tilbage til startrunden, hver gang live-stillingen tikker.
  const appliedRoundKey = useRef(null);
  useEffect(() => {
    if (!initialRoundKey || !rounds.length) return;
    if (appliedRoundKey.current === initialRoundKey) return;
    const idx = rounds.findIndex((r) => r.key === initialRoundKey);
    if (idx >= 0) { setRoundIndex(idx); appliedRoundKey.current = initialRoundKey; }
  }, [initialRoundKey, rounds]);

  // Live-opdatering: så længe mindst én hentet kamp er i gang (eller kunne være det —
  // kickoff passeret uden endeligt resultat), genhentes kampene hvert minut, så
  // live-stillingen tikker med uden at brugeren skal genindlæse. Er ingen kampe i
  // vinduet, kører der ingen polling.
  useEffect(() => {
    const inLiveWindow = allMatches.some((m) => {
      if (m.home_score !== null && m.home_score !== undefined) return false;
      if (m.live_state != null) return true;
      if (!m.kickoff_at) return false;
      const since = Date.now() - new Date(m.kickoff_at).getTime();
      return since >= 0 && since < 6 * 3600 * 1000;
    });
    if (!inLiveWindow) return;
    let cancelled = false;
    const id = setTimeout(async () => {
      const ids = allMatches.map((m) => m.id);
      if (!ids.length) return;
      try {
        const ms = await selectIn(token, "matches", "id", ids, "&select=*&order=kickoff_at", { sortBy: "kickoff_at" });
        if (!cancelled) setAllMatches(ms);
      } catch { /* prøver igen om et minut */ }
    }, 60000);
    return () => { cancelled = true; clearTimeout(id); };
  }, [allMatches, token]);

  async function save(matchId, field, val) {
    const cur = preds[matchId] || { pred_home: null, pred_away: null };
    const next = { ...cur, [field]: val };
    setPreds({ ...preds, [matchId]: next });
    if (next.pred_home === null || next.pred_away === null) {
      // Tippet er ryddet. Var der et gemt (fuldstændigt) tip, skal det slettes i databasen —
      // ellers dukker det op igen næste gang appen åbnes (kun lokal state blev tømt).
      const wasSaved = cur.pred_home !== null && cur.pred_home !== undefined
        && cur.pred_away !== null && cur.pred_away !== undefined;
      if (wasSaved) {
        try {
          const deleted = await db.del(token, "predictions", `user_id=eq.${userId}&match_id=eq.${matchId}`);
          // Med Prefer: return=representation svarer PostgREST med de faktisk slettede
          // rækker. Tom liste = intet blev slettet (RLS-policyen mangler/blokerer), selvom
          // rækken findes — gør det synligt i stedet for at fejle lydløst.
          if (Array.isArray(deleted) && deleted.length === 0) {
            setErrIds((s) => ({ ...s, [matchId]: ERR_DELETE }));
          } else {
            setErrIds((s) => { const c = { ...s }; delete c[matchId]; return c; });
            setAllPreds((ap) => ap.filter((p) => !(p.user_id === userId && p.match_id === matchId)));
          }
        } catch { setErrIds((s) => ({ ...s, [matchId]: ERR_DELETE })); }
      }
      return;
    }
    // Var tippet allerede komplet FØR dette gem (begge felter havde en værdi)?
    // Afgør om gemningen tæller som en opdatering eller det tip, der først nu
    // gør slottet "afgivet" (prediction_submitted — den handling, der reelt
    // tæller mod North Star-metrikken, som dog altid beregnes direkte fra
    // predictions-tabellen, ikke fra denne hændelseslog).
    const wasComplete = cur.pred_home !== null && cur.pred_home !== undefined
      && cur.pred_away !== null && cur.pred_away !== undefined;
    try {
      await db.upsert(token, "predictions", [{ user_id: userId, match_id: matchId, pred_home: next.pred_home, pred_away: next.pred_away }], "user_id,match_id");
      setErrIds((s) => { const c = { ...s }; delete c[matchId]; return c; });
      setSavedIds((s) => ({ ...s, [matchId]: true }));
      setTimeout(() => setSavedIds((s) => { const c = { ...s }; delete c[matchId]; return c; }), 2000);

      if (!startedRef.current.has(matchId)) {
        startedRef.current.add(matchId);
        logEvent(token, "prediction_started", { competitionId: comp?.id || null, metadata: { match_id: matchId } });
      }
      const meta = { match_id: matchId, round_key: allMatches.find((m) => m.id === matchId)?.round_key || null, comp_filter: compFilter };
      logEvent(token, "prediction_saved", { competitionId: comp?.id || null, metadata: meta });
      logEvent(token, wasComplete ? "prediction_updated" : "prediction_submitted", { competitionId: comp?.id || null, metadata: meta });
    } catch {
      // G24: her stod tidligere en tom catch med noten "næste forsøg overskriver".
      // Det var sandt om DATAEN og forkert om brugeren: den eneste kvittering, et
      // gem har, er ✓'et, så et fejlet gem så præcis ud som et gem, man ikke havde
      // set kvitteringen på endnu. Det er appens kernehandling, og den eneste med
      // en deadline — tvivlen kan ikke opklares efter kampen.
      //
      // Kun logEvent-kaldene ovenfor ligger også i try'en, og de kan ikke kaste
      // (analytics.js:42-51 fanger selv), så denne gren betyder ét: upserten fejlede.
      setErrIds((s) => ({ ...s, [matchId]: ERR_SAVE }));
    }
  }

  // Rundens ÉNE statuslinje. Logikken bor i predictions/roundStatus.js, så den kan
  // testes uden at rendere skærmen — den var utestet, netop mens per-kamp-låsen (A21)
  // ændrede den mest.
  const roundInfo = round ? roundStatus({ matches: round.matches, preds }) : null;

  // teamsById er med i afhængighederne, fordi holdnavnene AFGØR rækkefølgen, når
  // kampene deler tidsstempel. De hentes efter kampene, så uden den ville listen
  // beholde den orden, den fik i det ene render, hvor navnene endnu ikke fandtes.
  const days = useMemo(
    () => (round ? groupIntoDays(round.matches, (id) => teamsById[id]) : []),
    [round, teamsById]
  );

  // Forklaringslinjen hører til de LÅSTE kampe: først dér kan man se andres gæt
  // (canExpand = locked). Efter A21 er en runde typisk delvist låst i dagevis, så
  // linjen står, så snart ÉN kamp er låst — den peger på de rækker, der kan foldes ud.
  const anyLocked = !!round && round.matches.some((m) => isLocked(m));
  const canSeeOthers = anyLocked && participants.length > 1;

  // Filtre vises kun, når der reelt er noget at vælge imellem — ELLER når et filter
  // faktisk ER sat (Tip kan åbnes filtreret fra stillingen, jf. BoardScreen). Ellers
  // ville skærmen være filtreret uden at vise det, og uden vej ud af filteret igen.
  const showLeagueFilter = leagueOptions.length > 1 || leagueFilter !== "all";
  const showCompFilter = competitions.length > 1 || compFilter !== "all";
  // Et aktivt filter bliver grønt og viser navnet (samme chip-sprog som resten af appen),
  // så det aktive valg er synligt uden at fylde en linje i rundehovedet.
  const filterStyle = (active) => ({ ...chip(active), fontSize: 13, padding: "6px 10px", maxWidth: "100%" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {onBack ? <BackBar title="Tip" onBack={onBack} /> : <div style={{ marginBottom: 16 }}><H>Tip</H></div>}
      {!competitions.length ? (
        <EmptyCompetitions onCreate={onCreate ? () => onCreate(null) : undefined}
          onJoin={goTab ? () => goTab("ligaer") : undefined} />
      ) : (
        <>
          {(showLeagueFilter || showCompFilter) && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {showLeagueFilter && (
                <select aria-label="Filtrér på turnering" style={filterStyle(leagueFilter !== "all")}
                  value={leagueFilter} onChange={(e) => setLeagueFilter(e.target.value)}>
                  <option value="all">Alle turneringer</option>
                  {leagueOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              )}
              {showCompFilter && (
                <select aria-label="Filtrér på konkurrence" style={filterStyle(compFilter !== "all")}
                  value={compFilter} onChange={(e) => setCompFilter(e.target.value)}>
                  <option value="all">Alle konkurrencer</option>
                  {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </div>
          )}

          {loading && <p style={muted}>Henter kampe…</p>}
          {/* Fejlen har forrang for "ingen kampe": uden den ville en fejlet
              indlæsning se ud som en tom konkurrence — samme skærm, modsat årsag,
              og kun den ene har en handling. */}
          {!loading && loadError && (
            <Card style={{ borderColor: C.red }}>
              <div style={{ color: C.red, fontSize: 13, marginBottom: 10 }}>{loadError}</div>
              <button type="button" style={btnGhost} onClick={() => setReloadKey((k) => k + 1)}>Prøv igen</button>
            </Card>
          )}
          {/* Nævn kun filteret, hvis der FINDES et filter at skrue på — ellers får
              brugeren skylden for et valg, skærmen ikke engang viser. */}
          {!loading && !loadError && rounds.length === 0 && (
            <p style={muted}>
              {leagueFilter !== "all" || compFilter !== "all"
                ? "Ingen kampe i det valgte filter endnu."
                : "Ingen kampe i dine konkurrencer endnu."}
            </p>
          )}
          {!loading && rounds.length > 0 && (
            <Card style={{ padding: "14px 14px 8px" }}>
              <RoundHeader rounds={rounds} index={safeIndex} setIndex={setRoundIndex} status={roundInfo?.status}
                hint={canSeeOthers ? "Tryk på en kamp for at se alles gæt" : null} />
              {days.map((day, di) => (
                <div key={day.key}>
                  <div style={{
                    fontFamily: font.display, textTransform: "uppercase", letterSpacing: "0.08em",
                    fontSize: 11, color: C.muted, marginTop: di === 0 ? 0 : 12, marginBottom: 2,
                  }}>
                    {day.label}
                  </div>
                  {/* Kolonnehovedet hører til de LÅSTE rækker — kun de har facit og point at
                      stille op i kolonner; en åben række er ren indtastning. Før stod det ÉN
                      gang for hele runden, hvilket forudsatte, at runden var enten låst eller
                      åben. Efter A21 er en runde blandet i dagevis, så hovedet hører til
                      DAGEN: 1-times-vinduet er kort nok til, at en kampdag i praksis er enten
                      forbi eller fremme, og hovedet står da præcis over de rækker, det gælder. */}
                  {day.matches.some((m) => isLocked(m)) && (
                    <div style={{
                      display: "grid", gridTemplateColumns: ROW_COLS, gap: ROW_GAP, alignItems: "center",
                      padding: "2px 0 4px", borderBottom: `1px solid ${C.line}`,
                    }}>
                      <span /><span />
                      {["Gæt", "Facit", "P"].map((h) => (
                        <span key={h} style={{ ...thStyle, textAlign: "center", fontSize: 11 }}>{h}</span>
                      ))}
                      <span />
                    </div>
                  )}
                  {day.matches.map((m, mi) => {
                    const locked = isLocked(m);
                    return (
                      <MatchRow
                        key={m.id}
                        m={m}
                        pred={preds[m.id] || { pred_home: null, pred_away: null }}
                        homeName={teamsById[m.home_team_id]}
                        awayName={teamsById[m.away_team_id]}
                        locked={locked}
                        played={isPlayed(m)}
                        live={liveInfo(m)}
                        showFinal={roundInfo?.showFinal !== false}
                        saved={!!savedIds[m.id]}
                        err={errIds[m.id] || null}
                        onSave={save}
                        expanded={expandedId === m.id}
                        onToggleExpanded={() => setExpandedId(expandedId === m.id ? null : m.id)}
                        participants={participants}
                        matchPreds={locked ? allPreds.filter((p) => p.match_id === m.id) : []}
                        userId={userId}
                        openProfile={openProfile}
                        last={di === days.length - 1 && mi === day.matches.length - 1}
                      />
                    );
                  })}
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

export default PredictionsScreen;
// Navngivne eksporter til test/måling: rækken og rundehovedet skal kunne renderes
// isoleret i en rigtig browser, fordi bredde-fejl tre gange er sluppet igennem, når
// de blev skønnet ud fra koden i stedet for målt (jf. beslutningsloggen).
// De peger nu videre til predictions/, men fladen er den samme som før opdelingen.
export { MatchRow, RoundHeader, TeamNames, ROW_COLS, ROW_GAP };
