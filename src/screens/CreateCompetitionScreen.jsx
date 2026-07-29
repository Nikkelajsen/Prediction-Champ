// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState, useEffect, useMemo, useRef } from "react";
import { db } from "../lib/supabase.js";
import { loadMyGroups, createCompetition } from "../lib/data.js";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatKickoff, groupIntoRounds, MODE_LABELS, MODE_HINTS, stageOptionLabel } from "../lib/scoring.js";
import { C, btnGhost, btnGreen, chip, muted } from "../ui/theme.js";
import { BackBar, Card, H } from "../ui/components.jsx";

function CreateCompetitionScreen({ token, userId, leagues, initialGroupId = null, onBack, onCreated, openBoard }) {
  const [createLeagueId, setCreateLeagueId] = useState(leagues[0]?.id || "");
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState(initialGroupId || "");
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
  const [advanced, setAdvanced] = useState(false); // "Flere valg" — foldet ind som standard
  const [availableStages, setAvailableStages] = useState([]);
  const [selectedStages, setSelectedStages] = useState([]);
  // Full sæson kan spænde over flere turneringer på én gang (fx Superliga + Premier League).
  const [seasonByLeague, setSeasonByLeague] = useState({}); // league_id -> nyeste sæson
  const [stagesByLeague, setStagesByLeague] = useState({}); // league_id -> [stage-navne]
  const [fsLeagueIds, setFsLeagueIds] = useState([]);       // valgte turneringer
  const [fsStages, setFsStages] = useState({});             // league_id -> valgte stages

  useEffect(() => { if (!createLeagueId && leagues.length) setCreateLeagueId(leagues[0].id); }, [leagues]); // eslint-disable-line
  useEffect(() => { (async () => { try { setGroups(await loadMyGroups(token, userId)); } catch (e) { setGroups([]); } })(); }, [token, userId]); // eslint-disable-line

  // Liga defaulter til brugerens FØRSTE liga, ikke til "Ingen liga".
  //
  // Før var tom-værdien defaulten, så en konkurrence oprettet uden at røre
  // feltet blev liga-løs: ingen medlemsliste, intet permanent invite-link, og
  // intet der består, når sæsonen slutter. Det er overgangstilstanden, hele
  // liga-laget handlede om at komme væk fra — den skal ikke være standardvalget.
  useEffect(() => {
    if (!groupId && !initialGroupId && groups.length) setGroupId(groups[0].id);
  }, [groups]); // eslint-disable-line

  // Navnet forudfyldes fra turneringen, så feltet kan accepteres uden at tænke.
  // `nameTouched` sikrer, at forudfyldningen aldrig overskriver indtastet tekst.
  const nameTouched = useRef(false);
  useEffect(() => {
    if (nameTouched.current || mode !== "full_season") return;
    const first = leagues.find((l) => l.id === fsLeagueIds[0]);
    if (first) setName(first.name);
  }, [fsLeagueIds, leagues]); // eslint-disable-line

  useEffect(() => {
    if (!createLeagueId) return;
    (async () => {
      const seasons = await db.select(token, "seasons", `league_id=eq.${createLeagueId}&select=*&order=start_date.desc&limit=1`);
      const season = seasons[0] || null;
      setCreateSeason(season);
      const tms = await db.select(token, "teams", `league_id=eq.${createLeagueId}&select=*&order=name`);
      setCreateTeams(tms);
      setTeamId("");
      // udled hvilke stages der faktisk har kampe i sæsonen (fx grundspil, mesterskabsspil, nedrykningsspil)
      if (season) {
        const rows = await db.select(token, "matches", `season_id=eq.${season.id}&select=stage_name`);
        const stages = [...new Set(rows.map((r) => r.stage_name).filter(Boolean))];
        setAvailableStages(stages);
        setSelectedStages(stages);
      } else {
        setAvailableStages([]);
        setSelectedStages([]);
      }
    })();
  }, [createLeagueId]); // eslint-disable-line

  // Full sæson: indlæs nyeste sæson + tilgængelige stages for ALLE turneringer,
  // så hver kan vælges (og stage-scopes) enkeltvis og flere kan kombineres.
  useEffect(() => {
    if (mode !== "full_season") return;
    (async () => {
      const leagueIds = leagues.map((l) => l.id);
      if (!leagueIds.length) return;
      const seasons = await db.select(token, "seasons", `league_id=in.(${leagueIds.join(",")})&select=id,league_id&order=start_date.desc`);
      const newestByLeague = {};
      for (const s of seasons) if (!newestByLeague[s.league_id]) newestByLeague[s.league_id] = s;
      setSeasonByLeague(newestByLeague);
      const seasonIds = Object.values(newestByLeague).map((s) => s.id);
      const seasonToLeague = Object.fromEntries(Object.values(newestByLeague).map((s) => [s.id, s.league_id]));
      const rows = seasonIds.length ? await db.select(token, "matches", `season_id=in.(${seasonIds.join(",")})&select=season_id,stage_name`) : [];
      const bySet = {};
      for (const r of rows) {
        if (!r.stage_name) continue;
        const lid = seasonToLeague[r.season_id];
        (bySet[lid] ||= new Set()).add(r.stage_name);
      }
      const stagesObj = {};
      for (const lid of leagueIds) stagesObj[lid] = bySet[lid] ? [...bySet[lid]] : [];
      setStagesByLeague(stagesObj);
      setFsLeagueIds((prev) => (prev.length ? prev : (leagues[0] ? [leagues[0].id] : [])));
      setFsStages(stagesObj); // standard: alle stages valgt pr. turnering
    })();
  }, [mode, leagues]); // eslint-disable-line

  function toggleFsLeague(lid) {
    setFsLeagueIds((prev) => (prev.includes(lid) ? prev.filter((x) => x !== lid) : [...prev, lid]));
  }
  function toggleFsStage(lid, stage) {
    setFsStages((prev) => {
      const cur = prev[lid] ?? (stagesByLeague[lid] || []);
      const next = cur.includes(stage) ? cur.filter((x) => x !== stage) : [...cur, stage];
      return { ...prev, [lid]: next.length ? next : cur };
    });
  }

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

  // Den tilfældige udvælgelse bliver HER: den trækker fra `upcoming`, som er
  // skærmens egen UI-state. Skriveren i data.js får de færdige kamp-id'er.
  function pickRandomMatchIds() {
    const allowedLeagues = randomLeagueIds || leagues.map((l) => l.id);
    const pool = upcoming.filter((m) => allowedLeagues.includes(m._leagueId));
    if (!pool.length) return [];
    const firstRound = pool.reduce((min, m) => (m.round_key < min ? m.round_key : min), pool[0].round_key);
    const roundPool = pool.filter((m) => m.round_key === firstRound);
    const shuffled = roundPool.slice().sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.max(1, Number(randomCount) || 6)).map((m) => m.id);
  }

  // Skærmen bygger kun `spec` ud fra sin UI-state; selve skrivningen bor i
  // data.js, så onboarding-guiden og denne skærm ikke kan divergere.
  function buildSpec() {
    const shared = { name, groupId, mode, openDaysBefore: rollingWindow ? 7 : 0 };
    if (mode === "full_season") {
      return {
        ...shared,
        tournaments: fsLeagueIds.filter((id) => seasonByLeague[id]).map((lid) => ({
          leagueId: lid,
          seasonId: seasonByLeague[lid].id,
          availableStages: stagesByLeague[lid] || [],
          selectedStages: fsStages[lid] ?? (stagesByLeague[lid] || []),
        })),
      };
    }
    if (mode === "custom") return { ...shared, matchIds: pickedIds };
    if (mode === "random") return { ...shared, matchIds: pickRandomMatchIds(), randomCount };
    return {
      ...shared,
      leagueId: createLeagueId,
      seasonId: createSeason?.id || null,
      teamId, startDate, endDate,
      availableStages, selectedStages,
    };
  }

  async function submit() {
    if (!name) return;
    setBusy(true); setErr("");
    try {
      const { competition } = await createCompetition(token, userId, buildSpec());
      await onCreated();
      openBoard(competition.id);
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
      <BackBar title="Opret konkurrence" onBack={onBack} />
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ color: C.muted, fontSize: 12 }}>Navn</span>
            <input className="field" placeholder="Navn på konkurrence…" value={name}
              onChange={(e) => { nameTouched.current = true; setName(e.target.value); }} />
          </label>

          {/* Liga er en del af hurtig-stien og må ALDRIG være skjult: uden den
              ville en konkurrence oprettet på to felter tavst blive liga-løs. */}
          {groups.length > 0 ? (
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ color: C.muted, fontSize: 12 }}>Liga</span>
              <select className="field" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                <option value="">Ingen liga</option>
              </select>
            </label>
          ) : (
            <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.45 }}>
              Du har ingen liga endnu, så konkurrencen bliver <b>liga-løs</b>. Opret en liga på
              Ligaer-fanen for at samle medlemmer, historik og ét fælles invite-link.
            </div>
          )}

          {/* Ikke en <label>: der er ingen enkelt formularkontrol at mærke, og
              label-teksten ville smitte af på hver chips tilgængelige navn, så
              en skærmlæser (og enhver test) ville høre "Turnering Superligaen
              Premier League" på den første knap. */}
          {mode === "full_season" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ color: C.muted, fontSize: 12 }}>Turnering{fsLeagueIds.length > 1 ? "er — flere valgt" : ""}</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {leagues.map((l) => {
                  const sel = fsLeagueIds.includes(l.id);
                  return (
                    <button key={l.id} type="button" aria-pressed={sel} onClick={() => toggleFsLeague(l.id)} style={chip(sel)}>
                      {sel ? "✓ " : ""}{l.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Alt herunder er "Flere valg". Hurtig-stien er navn + liga + turnering:
              en ny bruger mødte før ti valg på én gang — modes, stages og et
              rullende vindue — uden at vide, hvad nogen af dem betød. Intet er
              fjernet; det er kun foldet ind, indtil man beder om det. */}
          <button type="button" onClick={() => setAdvanced((v) => !v)} style={{
            ...btnGhost, alignSelf: "flex-start", marginTop: 2,
          }}>
            {advanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Flere valg
          </button>

          {advanced && (<>
          {/* Navnene kommer fra MODE_LABELS (scoring.js), så opret-skærmen, Ligaer-kortet,
              liga-siden og admin-statistikken altid kalder den samme mode det samme. */}
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ color: C.muted, fontSize: 12 }}>Hvilke kampe?</span>
            <select className="field" value={mode} onChange={(e) => setMode(e.target.value)}>
              {Object.entries(MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <span style={{ color: C.muted, fontSize: 11.5, lineHeight: 1.4 }}>{MODE_HINTS[mode]}</span>
          </label>

          {mode === "full_season" && (
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {fsLeagueIds.map((lid) => {
                const avail = stagesByLeague[lid] || [];
                if (avail.length <= 1) return null;
                const league = leagues.find((l) => l.id === lid);
                const sel = fsStages[lid] ?? avail;
                return (
                  <div key={lid} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ color: C.muted, fontSize: 11 }}>{league?.name} — grundspil / slutspil</span>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {avail.map((s) => {
                        const on = sel.includes(s);
                        return (
                          <button key={s} type="button" onClick={() => toggleFsStage(lid, s)} style={chip(on)}>
                            {on ? "✓ " : ""}{stageOptionLabel(s)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </label>
          )}
          {(mode === "team" || mode === "time_range") && leagues.length > 1 && (
            <select className="field" value={createLeagueId} onChange={(e) => setCreateLeagueId(e.target.value)}>
              {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          {(mode === "team" || mode === "time_range") && availableStages.length > 1 && (
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ color: C.muted, fontSize: 12 }}>Stages (grundspil / slutspil)</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {availableStages.map((s) => {
                  const sel = selectedStages.includes(s);
                  return (
                    <button key={s} type="button" onClick={() => {
                      const next = sel ? selectedStages.filter((x) => x !== s) : [...selectedStages, s];
                      setSelectedStages(next.length ? next : selectedStages);
                    }} style={chip(sel)}>{sel ? "✓ " : ""}{stageOptionLabel(s)}</button>
                  );
                })}
              </div>
            </label>
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
            Rullende gætte-vindue — runden kan først tippes 7 dage før rundens første kamp
          </label>
          </>)}

          {err && <p style={{ color: C.red, fontSize: 13, margin: 0 }}>{err}</p>}
          <button style={{ ...btnGreen, opacity: busy || !name ? 0.5 : 1 }} onClick={submit} disabled={busy || !name}>
            {busy ? "Opretter…" : "Opret konkurrence"}
          </button>
        </div>
      </Card>
    </div>
  );
}

export default CreateCompetitionScreen;
