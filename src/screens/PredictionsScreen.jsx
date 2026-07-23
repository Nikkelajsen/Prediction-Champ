// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState, useEffect, useMemo } from "react";
import { Check } from "lucide-react";
import { db } from "../lib/supabase.js";
import { currentRoundIndex, formatKickoff, groupIntoRounds, isLocked, outcome, pointsFor, buildRoundLockMap, roundLockKey, LOCK_LEAD_MS } from "../lib/scoring.js";
import { C, muted } from "../ui/theme.js";
import { BackBar, Card, H, RoundPager, ScoreInput } from "../ui/components.jsx";

function PredictionsScreen({ token, userId, competitions, leagues = [], initialFilter, initialRoundKey, onBack }) {
  const [compFilter, setCompFilter] = useState(initialFilter || "all");
  const [leagueFilter, setLeagueFilter] = useState("all");
  const [seasonLeague, setSeasonLeague] = useState({}); // season_id -> league_id
  const [allMatches, setAllMatches] = useState([]);
  const [preds, setPreds] = useState({});
  const [allPreds, setAllPreds] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [teamsById, setTeamsById] = useState({});
  const [loading, setLoading] = useState(false);
  const [roundIndex, setRoundIndex] = useState(0);
  const [savedIds, setSavedIds] = useState({});
  const [errIds, setErrIds] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [matchComps, setMatchComps] = useState({});
  const [, setTick] = useState(0);
  const comp = compFilter !== "all" ? competitions.find((c) => c.id === compFilter) : null;
  const rules = comp?.rules || { exact: 3, outcome: 1 };

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const compIds = compFilter === "all" ? competitions.map((c) => c.id) : [compFilter];
    if (!compIds.length) { setAllMatches([]); return; }
    (async () => {
      setLoading(true);
      setExpandedId(null);
      const cms = await db.select(token, "competition_matches", `competition_id=in.(${compIds.join(",")})&select=competition_id,match_id`);
      const ids = [...new Set(cms.map((c) => c.match_id))];
      const mcMap = {};
      for (const c of cms) (mcMap[c.match_id] ||= []).push(c.competition_id);
      setMatchComps(mcMap);
      if (!ids.length) { setAllMatches([]); setTeamsById({}); setLoading(false); return; }
      const ms = await db.select(token, "matches", `id=in.(${ids.join(",")})&select=*&order=kickoff_at`);
      setAllMatches(ms);
      // season_id -> league_id, så Tips kan filtreres på liga (matchens egen liga,
      // uafhængigt af konkurrencens league_id — virker også for custom/random-kuponer).
      const seasonIds = [...new Set(ms.map((m) => m.season_id).filter(Boolean))];
      if (seasonIds.length) {
        const seasons = await db.select(token, "seasons", `id=in.(${seasonIds.join(",")})&select=id,league_id`);
        setSeasonLeague(Object.fromEntries(seasons.map((s) => [s.id, s.league_id])));
      } else { setSeasonLeague({}); }
      const teamIds = [...new Set(ms.flatMap((m) => [m.home_team_id, m.away_team_id]))];
      if (teamIds.length) {
        const tms = await db.select(token, "teams", `id=in.(${teamIds.join(",")})&select=id,name`);
        setTeamsById(Object.fromEntries(tms.map((t) => [t.id, t.name])));
      }
      const ap = await db.select(token, "predictions", `match_id=in.(${ids.join(",")})&select=*`);
      setAllPreds(ap);
      setPreds(Object.fromEntries(ap.filter((p) => p.user_id === userId).map((p) => [p.match_id, p])));
      const parts = await db.select(token, "competition_participants", `competition_id=in.(${compIds.join(",")})&select=user_id`);
      const partIds = [...new Set(parts.map((p) => p.user_id))];
      const profs = partIds.length ? await db.select(token, "profiles", `id=in.(${partIds.join(",")})&select=id,display_name`) : [];
      setParticipants(profs);
      const rds = groupIntoRounds(ms);
      // Land på den ønskede runde (fra "Tip nu"/"Se tips" på Hjem), ellers den nærmeste runde.
      const targetIdx = initialRoundKey ? rds.findIndex((r) => r.key === initialRoundKey) : -1;
      setRoundIndex(targetIdx >= 0 ? targetIdx : currentRoundIndex(rds));
      setLoading(false);
    })();
  }, [compFilter, competitions]); // eslint-disable-line

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
  const roundLockMap = useMemo(() => buildRoundLockMap(filteredMatches), [filteredMatches]);
  const round = rounds[roundIndex];

  // Skift af liga-filter: spring til den nærmeste runde i det filtrerede sæt.
  useEffect(() => {
    setRoundIndex(currentRoundIndex(rounds));
  }, [leagueFilter]); // eslint-disable-line

  // Reager på en ny ønsket runde (fx et nyt "Se tips"/"Tip nu"-klik fra Hjem, hvor
  // kampene ikke genindlæses fordi konkurrence-filteret er uændret).
  useEffect(() => {
    if (!initialRoundKey || !rounds.length) return;
    const idx = rounds.findIndex((r) => r.key === initialRoundKey);
    if (idx >= 0) setRoundIndex(idx);
  }, [initialRoundKey, rounds]);

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
            setErrIds((s) => ({ ...s, [matchId]: true }));
          } else {
            setErrIds((s) => { const c = { ...s }; delete c[matchId]; return c; });
            setAllPreds((ap) => ap.filter((p) => !(p.user_id === userId && p.match_id === matchId)));
          }
        } catch (e) { setErrIds((s) => ({ ...s, [matchId]: true })); }
      }
      return;
    }
    try {
      await db.upsert(token, "predictions", [{ user_id: userId, match_id: matchId, pred_home: next.pred_home, pred_away: next.pred_away }], "user_id,match_id");
      setSavedIds((s) => ({ ...s, [matchId]: true }));
      setTimeout(() => setSavedIds((s) => { const c = { ...s }; delete c[matchId]; return c; }), 2000);
    } catch (e) { /* næste forsøg overskriver */ }
  }

  function lockCountdown(m) {
    const earliest = roundLockMap.get(roundLockKey(m));
    if (earliest == null) return null;
    const msLeft = earliest - LOCK_LEAD_MS - Date.now();
    if (msLeft <= 0 || msLeft > 24 * 3600 * 1000) return null;
    const hours = Math.floor(msLeft / 3600000);
    const mins = Math.floor((msLeft % 3600000) / 60000);
    return hours > 0 ? `Låser om ${hours} t ${mins} min` : `Låser om ${mins} min`;
  }
  function opensAt(m) {
    const compIds = matchComps[m.id] || [];
    const comps = compIds.map((id) => competitions.find((c) => c.id === id)).filter(Boolean);
    if (!comps.length) return null;
    const windows = comps.map((c) => c.rules?.openDaysBefore || 0);
    if (windows.some((w) => !w)) return null;
    const maxDays = Math.max(...windows);
    // Åbning er runde-baseret ligesom låsningen: vinduet regnes fra rundens
    // TIDLIGSTE kickoff, ikke kampens eget. Ellers kunne en kamp åbne EFTER
    // runden er låst (blindgyde: "Åbner…" → "Låst" uden at kunne tippes).
    const roundStart = roundLockMap.get(roundLockKey(m)) ?? new Date(m.kickoff_at).getTime();
    const openTime = roundStart - maxDays * 24 * 3600 * 1000;
    return Date.now() < openTime ? new Date(openTime) : null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {onBack ? <BackBar title="Tip" onBack={onBack} /> : <div style={{ marginBottom: 16 }}><H>Tip</H></div>}
      {!competitions.length ? (
        <p style={muted}>Opret eller join en konkurrence først.</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select className="field" style={{ flex: 1, minWidth: 140 }} value={leagueFilter} onChange={(e) => setLeagueFilter(e.target.value)}>
              <option value="all">Alle turneringer</option>
              {leagueOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select className="field" style={{ flex: 1, minWidth: 140 }} value={compFilter} onChange={(e) => setCompFilter(e.target.value)}>
              <option value="all">Alle konkurrencer</option>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {loading && <p style={muted}>Henter kampe…</p>}
          {!loading && rounds.length === 0 && <p style={muted}>Ingen kampe i det valgte filter endnu.</p>}
          {!loading && rounds.length > 0 && (
            <Card>
              <RoundPager rounds={rounds} index={roundIndex} setIndex={setRoundIndex} />
              <div style={{ display: "flex", flexDirection: "column" }}>
                {round.matches.map((m) => {
                  const pred = preds[m.id] || { pred_home: null, pred_away: null };
                  const locked = isLocked(m, roundLockMap);
                  const played = m.home_score !== null && m.home_score !== undefined;
                  const hasPred = pred.pred_home !== null && pred.pred_away !== null;
                  const pts = played ? pointsFor(pred, m, rules) : null;
                  const exact = played && hasPred && pred.pred_home === m.home_score && pred.pred_away === m.away_score;
                  const correctOutcome = played && pts !== null && pts > 0;
                  const countdown = !locked ? lockCountdown(m) : null;
                  const notOpenUntil = !locked ? opensAt(m) : null;
                  const expanded = expandedId === m.id;
                  const matchPreds = locked ? allPreds.filter((p) => p.match_id === m.id) : [];

                  return (
                    <div key={m.id} style={{ padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
                      <div style={{ color: C.text, fontWeight: 600 }}>{teamsById[m.home_team_id]} - {teamsById[m.away_team_id]}</div>
                      <div style={{ color: C.muted, fontSize: 12, marginTop: 2, marginBottom: 10 }}>
                        {formatKickoff(m.kickoff_at)}
                        {!played && locked && <span style={{ color: C.red, marginLeft: 8 }}>· Låst</span>}
                        {countdown && !notOpenUntil && <span style={{ color: C.gold, marginLeft: 8 }}>· {countdown}</span>}
                        {notOpenUntil && <span style={{ color: C.muted, marginLeft: 8 }}>· Åbner {formatKickoff(notOpenUntil.toISOString())}</span>}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <ScoreInput value={pred.pred_home} onChange={(v) => save(m.id, "pred_home", v)} disabled={locked || !!notOpenUntil} />
                          <span style={{ color: C.muted }}>-</span>
                          <ScoreInput value={pred.pred_away} onChange={(v) => save(m.id, "pred_away", v)} disabled={locked || !!notOpenUntil} />
                          {savedIds[m.id] && <Check size={16} style={{ color: C.green }} />}
                          {errIds[m.id] && <span style={{ fontSize: 11, color: C.red }}>Kunne ikke slette</span>}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {played && (
                            <>
                              <span style={{
                                background: !hasPred ? C.surface2 : correctOutcome ? "rgba(34,197,94,0.18)" : "rgba(239,91,91,0.18)",
                                color: !hasPred ? C.muted : correctOutcome ? C.green : C.red,
                                border: exact ? `2px solid ${C.gold}` : "1px solid transparent",
                                fontSize: 15, fontWeight: 700, padding: "6px 12px", whiteSpace: "nowrap", borderRadius: 8,
                              }}>{m.home_score} - {m.away_score}</span>
                              {hasPred && <span style={{ fontSize: 12, color: C.muted, whiteSpace: "nowrap" }}>{pts > 0 ? `+${pts}` : pts} point</span>}
                            </>
                          )}
                          {locked && participants.length > 1 && (
                            <span onClick={() => setExpandedId(expanded ? null : m.id)}
                              style={{ fontSize: 12, color: C.gold, cursor: "pointer", whiteSpace: "nowrap", textDecoration: "underline" }}>
                              {expanded ? "Skjul gæt" : "Alles gæt"}
                            </span>
                          )}
                        </div>
                      </div>
                      {expanded && (
                        <div style={{ marginTop: 10, padding: "10px 12px", background: C.surface2, borderRadius: 10 }}>
                          {participants.map((p) => {
                            const pp = matchPreds.find((x) => x.user_id === p.id);
                            const ppts = played && pp ? pointsFor(pp, m, rules) : null;
                            return (
                              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 13 }}>
                                <span style={{ color: p.id === userId ? C.gold : C.text, fontWeight: p.id === userId ? 700 : 400 }}>{p.display_name}</span>
                                <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
                                  <span style={{ color: C.text, fontFamily: "ui-monospace, monospace" }}>{pp ? `${pp.pred_home} - ${pp.pred_away}` : "–"}</span>
                                  {ppts !== null && (
                                    <span style={{ color: ppts > 0 ? C.green : ppts < 0 ? C.red : C.muted, minWidth: 28, textAlign: "right" }}>{ppts > 0 ? `+${ppts}` : ppts}</span>
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

export default PredictionsScreen;
