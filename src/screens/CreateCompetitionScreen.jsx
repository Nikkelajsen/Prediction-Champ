// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState, useEffect, useMemo } from "react";
import { db } from "../lib/supabase.js";
import { filterFromNextUnfinishedRound, formatKickoff, groupIntoRounds, outcome } from "../lib/scoring.js";
import { C, btnGreen, chip, muted } from "../ui/theme.js";
import { BackBar, Card, H } from "../ui/components.jsx";

function CreateCompetitionScreen({ token, userId, leagues, onBack, onCreated, openBoard }) {
  const [createLeagueId, setCreateLeagueId] = useState(leagues[0]?.id || "");
  const [createSeason, setCreateSeason] = useState(null);
  const [createTeams, setCreateTeams] = useState([]);
  const [name, setName] = useState("");
  const [mode, setMode] = useState("full_season");
  const [teamId, setTeamId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [upcoming, setUpcoming] = useState([]);
  const [upcomingTeams, setUpcomingTeams] = useState({});
  const [pickedIds, setPickedIds] = useState([]);
  const [pickLeagueIds, setPickLeagueIds] = useState(null);
  const [randomCount, setRandomCount] = useState(6);
  const [randomLeagueIds, setRandomLeagueIds] = useState(null);
  const [rollingWindow, setRollingWindow] = useState(false);

  useEffect(() => { if (!createLeagueId && leagues.length) setCreateLeagueId(leagues[0].id); }, [leagues]); // eslint-disable-line

  useEffect(() => {
    if (!createLeagueId) return;
    (async () => {
      const seasons = await db.select(token, "seasons", `league_id=eq.${createLeagueId}&select=*&order=start_date.desc&limit=1`);
      setCreateSeason(seasons[0] || null);
      const tms = await db.select(token, "teams", `league_id=eq.${createLeagueId}&select=*&order=name`);
      setCreateTeams(tms);
      setTeamId("");
    })();
  }, [createLeagueId]); // eslint-disable-line

  useEffect(() => {
    if (mode !== "custom" && mode !== "random") return;
    (async () => {
      const leagueIds = leagues.map((l) => l.id);
      if (!leagueIds.length) return;
      const seasons = await db.select(token, "seasons", `league_id=in.(${leagueIds.join(",")})&select=id,league_id&order=start_date.desc`);
      const newestByLeague = {};
      for (const s of seasons) if (!newestByLeague[s.league_id]) newestByLeague[s.league_id] = s;
      const seasonIds = Object.values(newestByLeague).map((s) => s.id);
      if (!seasonIds.length) { setUpcoming([]); return; }
      const seasonToLeague = Object.fromEntries(Object.values(newestByLeague).map((s) => [s.id, s.league_id]));
      const leagueNames = Object.fromEntries(leagues.map((l) => [l.id, l.name]));
      const nowIso = new Date().toISOString();
      const ms = await db.select(token, "matches", `season_id=in.(${seasonIds.join(",")})&kickoff_at=gte.${nowIso}&select=*&order=kickoff_at&limit=300`);
      const teamIds = [...new Set(ms.flatMap((m) => [m.home_team_id, m.away_team_id]))];
      const tms = teamIds.length ? await db.select(token, "teams", `id=in.(${teamIds.join(",")})&select=id,name`) : [];
      setUpcomingTeams(Object.fromEntries(tms.map((t) => [t.id, t.name])));
      setUpcoming(ms.map((m) => ({ ...m, _leagueId: seasonToLeague[m.season_id], _leagueName: leagueNames[seasonToLeague[m.season_id]] })));
      setPickedIds([]);
    })();
  }, [mode, leagues]); // eslint-disable-line

  async function createCompetition() {
    if (!name) return;
    setBusy(true); setErr("");
    try {
      const crossLeague = mode === "custom" || mode === "random";
      if (!crossLeague && (!createLeagueId || !createSeason)) { setBusy(false); return; }

      let matchIds = [];
      if (mode === "custom") {
        matchIds = pickedIds;
        if (!matchIds.length) { setErr("Vælg mindst én kamp"); setBusy(false); return; }
      } else if (mode === "random") {
        const allowedLeagues = randomLeagueIds || leagues.map((l) => l.id);
        const pool = upcoming.filter((m) => allowedLeagues.includes(m._leagueId));
        if (!pool.length) { setErr("Ingen kommende kampe i de valgte ligaer"); setBusy(false); return; }
        const firstRound = pool.reduce((min, m) => (m.round_key < min ? m.round_key : min), pool[0].round_key);
        const roundPool = pool.filter((m) => m.round_key === firstRound);
        const shuffled = roundPool.slice().sort(() => Math.random() - 0.5);
        matchIds = shuffled.slice(0, Math.max(1, Number(randomCount) || 6)).map((m) => m.id);
      }

      const mode_params = mode === "team" ? { team_id: teamId }
        : mode === "time_range" ? { start_date: startDate, end_date: endDate }
        : mode === "random" ? { count: Number(randomCount) || 6 } : {};
      const rules = { exact: 3, outcome: 1, ...(rollingWindow ? { openDaysBefore: 7 } : {}) };
      const [comp] = await db.insert(token, "competitions", [{
        name,
        league_id: crossLeague ? null : createLeagueId,
        season_id: crossLeague ? null : createSeason.id,
        mode, mode_params, rules, created_by: userId,
      }]);
      await db.insert(token, "competition_participants", [{ competition_id: comp.id, user_id: userId }]);

      if (crossLeague) {
        await db.insert(token, "competition_matches", matchIds.map((id) => ({ competition_id: comp.id, match_id: id })));
      } else {
        let query = `season_id=eq.${createSeason.id}&select=id,round_key,home_score`;
        if (mode === "team" && teamId) query += `&or=(home_team_id.eq.${teamId},away_team_id.eq.${teamId})`;
        if (mode === "time_range" && startDate && endDate) query += `&kickoff_at=gte.${startDate}&kickoff_at=lte.${endDate}T23:59:59`;
        let matchedMatches = await db.select(token, "matches", query);
        matchedMatches = filterFromNextUnfinishedRound(matchedMatches);
        if (matchedMatches.length) {
          await db.insert(token, "competition_matches", matchedMatches.map((m) => ({ competition_id: comp.id, match_id: m.id })));
        }
      }
      await onCreated();
      openBoard(comp.id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const pickAllowed = pickLeagueIds || leagues.map((l) => l.id);
  const upcomingRounds = useMemo(
    () => groupIntoRounds(upcoming.filter((m) => pickAllowed.includes(m._leagueId))),
    [upcoming, pickLeagueIds, leagues] // eslint-disable-line
  );
  const randomPool = useMemo(() => {
    const allowed = randomLeagueIds || leagues.map((l) => l.id);
    const pool = upcoming.filter((m) => allowed.includes(m._leagueId));
    if (!pool.length) return [];
    const firstRound = pool.reduce((min, m) => (m.round_key < min ? m.round_key : min), pool[0].round_key);
    return pool.filter((m) => m.round_key === firstRound);
  }, [upcoming, randomLeagueIds, leagues]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BackBar title="Opret liga" onBack={onBack} />
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input className="field" placeholder="Navn på konkurrence…" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="field" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="full_season">Hel sæson</option>
            <option value="team">Et hold</option>
            <option value="time_range">Tidsperiode (fx 3 uger)</option>
            <option value="custom">Håndplukkede kampe</option>
            <option value="random">Tilfældig kupon</option>
          </select>

          {(mode === "full_season" || mode === "team" || mode === "time_range") && leagues.length > 1 && (
            <select className="field" value={createLeagueId} onChange={(e) => setCreateLeagueId(e.target.value)}>
              {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          {mode === "team" && (
            <select className="field" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">Vælg hold…</option>
              {createTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          {mode === "time_range" && (
            <div style={{ display: "flex", gap: 8 }}>
              <input className="field" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <input className="field" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          )}

          {mode === "random" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: C.text, fontSize: 14 }}>Antal kampe:</span>
                <input className="field" type="number" min="1" max={Math.max(1, randomPool.length)} style={{ width: 70 }}
                  value={Math.min(Number(randomCount) || 1, Math.max(1, randomPool.length))}
                  onChange={(e) => setRandomCount(Math.min(Number(e.target.value) || 1, Math.max(1, randomPool.length)))} />
                <span style={{ color: C.muted, fontSize: 12 }}>({randomPool.length} i nærmeste runde)</span>
              </div>
              {leagues.length > 1 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {leagues.map((l) => {
                    const sel = (randomLeagueIds || leagues.map((x) => x.id)).includes(l.id);
                    return (
                      <button key={l.id} type="button" onClick={() => {
                        const base = randomLeagueIds || leagues.map((x) => x.id);
                        const next = sel ? base.filter((x) => x !== l.id) : [...base, l.id];
                        setRandomLeagueIds(next.length ? next : base);
                      }} style={chip(sel)}>{sel ? "✓ " : ""}{l.name}</button>
                    );
                  })}
                </div>
              )}
              <p style={{ ...muted, margin: 0 }}>Trækker tilfældige kampe fra den nærmeste kommende runde.</p>
            </>
          )}

          {mode === "custom" && (
            <>
              {leagues.length > 1 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {leagues.map((l) => {
                    const sel = pickAllowed.includes(l.id);
                    return (
                      <button key={l.id} type="button" onClick={() => {
                        const base = pickLeagueIds || leagues.map((x) => x.id);
                        const next = sel ? base.filter((x) => x !== l.id) : [...base, l.id];
                        setPickLeagueIds(next.length ? next : base);
                      }} style={chip(sel)}>{sel ? "✓ " : ""}{l.name}</button>
                    );
                  })}
                </div>
              )}
              <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${C.line}`, borderRadius: 10, padding: 10 }}>
                {upcomingRounds.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen kommende kampe fundet.</p>}
                {upcomingRounds.map((r) => (
                  <div key={r.key} style={{ marginBottom: 10 }}>
                    <div style={{ color: C.gold, fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Runde {r.label}</div>
                    {r.matches.map((m) => {
                      const checked = pickedIds.includes(m.id);
                      return (
                        <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", fontSize: 13 }}>
                          <input type="checkbox" checked={checked} onChange={() =>
                            setPickedIds(checked ? pickedIds.filter((x) => x !== m.id) : [...pickedIds, m.id])} />
                          <span style={{ color: C.text }}>{upcomingTeams[m.home_team_id]} - {upcomingTeams[m.away_team_id]}</span>
                          <span style={{ color: C.muted, fontSize: 11, marginLeft: "auto", whiteSpace: "nowrap" }}>{m._leagueName} · {formatKickoff(m.kickoff_at)}</span>
                        </label>
                      );
                    })}
                  </div>
                ))}
                {pickedIds.length > 0 && <p style={{ ...muted, marginBottom: 0 }}>{pickedIds.length} kampe valgt</p>}
              </div>
            </>
          )}

          <label style={{ display: "flex", alignItems: "center", gap: 8, color: C.text, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={rollingWindow} onChange={(e) => setRollingWindow(e.target.checked)} />
            Rullende gætte-vindue — kampe kan først tippes 7 dage før kickoff
          </label>

          {err && <p style={{ color: C.red, fontSize: 13, margin: 0 }}>{err}</p>}
          <button style={{ ...btnGreen, opacity: busy || !name ? 0.5 : 1 }} onClick={createCompetition} disabled={busy || !name}>
            {busy ? "Opretter…" : "Opret konkurrence"}
          </button>
        </div>
      </Card>
    </div>
  );
}

export default CreateCompetitionScreen;
