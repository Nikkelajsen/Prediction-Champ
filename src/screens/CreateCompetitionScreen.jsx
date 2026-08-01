// Opret-flowet, galleri-først (I14/A22): trin 1 er "Hvad vil I spille?" som
// kort, trin 2 er KUN den valgte types egne felter plus de fælles (navn, liga,
// kårings-tilvalg). Før var det én flad formular, hvor fire af fem typer
// gemte sig bag en "Flere valg"-fold — designet til én turnering, ikke syv.
//
// Skærmen er en tynd container: typekataloget og spec-bygningen bor i
// lib/createTypes.js (rent og testbart), felterne pr. type i screens/create/,
// og selve skrivningen i data.js — så onboarding-guiden og denne skærm ikke
// kan divergere.
import { useState, useEffect, useMemo, useRef } from "react";
import { db } from "../lib/supabase.js";
import { loadMyGroups, createCompetition } from "../lib/data.js";
import { ChevronLeft } from "lucide-react";
import { groupIntoRounds } from "../lib/scoring.js";
import { createTypeById, pickRandomFromRounds, weeklyCouponName, buildSpec } from "../lib/createTypes.js";
import { C, btnGhost, btnGreen, font } from "../ui/theme.js";
import { BackBar, Card } from "../ui/components.jsx";
import TypeGallery, { ICONS } from "./create/TypeGallery.jsx";
import SeasonFields from "./create/SeasonFields.jsx";
import TeamFields from "./create/TeamFields.jsx";
import RandomFields from "./create/RandomFields.jsx";
import CustomFields from "./create/CustomFields.jsx";

function CreateCompetitionScreen({ token, userId, leagues, initialGroupId = null, onBack, onCreated, openBoard }) {
  const [typeId, setTypeId] = useState(null); // null = galleriet
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState(initialGroupId || "");
  const [name, setName] = useState("");
  const [awards, setAwards] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // nyeste sæson pr. turnering — fælles grundlag for alle typer
  const [seasonByLeague, setSeasonByLeague] = useState({});
  // Sæson: antal kampe pr. turnering + valgte turneringer
  const [countByLeague, setCountByLeague] = useState({});
  const [fsLeagueIds, setFsLeagueIds] = useState([]);
  // Favorithold: alle hold grupperet pr. turnering + de valgte
  const [teamsByLeague, setTeamsByLeague] = useState(null);
  const [teamSel, setTeamSel] = useState([]);
  // Quick Pick / Quick League / Ugens kupon
  const [randomCount, setRandomCount] = useState(6);
  const [roundsCount, setRoundsCount] = useState(6);
  const [randomLeagueIds, setRandomLeagueIds] = useState(null);
  // Custom: håndpluk eller periode
  const [method, setMethod] = useState("pick");
  const [pickLeagueIds, setPickLeagueIds] = useState(null);
  const [pickedIds, setPickedIds] = useState([]);
  const [periodLeagueId, setPeriodLeagueId] = useState(leagues[0]?.id || "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // kommende kampe (puljen for random-typerne og håndplukket)
  const [upcoming, setUpcoming] = useState([]);
  const [upcomingTeams, setUpcomingTeams] = useState({});

  const type = createTypeById(typeId);
  const TypeIcon = ICONS[typeId] || null;

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

  // Nyeste sæson pr. turnering hentes ÉN gang — Sæson-chippene, holdvalget,
  // perioden og kamp-puljen bruger alle det samme opslag.
  useEffect(() => {
    (async () => {
      const leagueIds = leagues.map((l) => l.id);
      if (!leagueIds.length) return;
      const seasons = await db.select(token, "seasons", `league_id=in.(${leagueIds.join(",")})&select=id,league_id&order=start_date.desc`);
      const newest = {};
      for (const s of seasons) if (!newest[s.league_id]) newest[s.league_id] = s;
      setSeasonByLeague(newest);
    })();
  }, [token, leagues]);

  // Sæson: KAMPANTAL for alle turneringer.
  //
  // Antallet er ikke pynt. En konkurrence materialiserer sine kampe én gang ved
  // oprettelsen, så en turnering uden kampe giver en konkurrence, der er tom for
  // altid. Champions League har netop nu en sæsonrække og nul kampe, og indtil
  // dette tal blev vist, var det eneste tegn på det en konkurrence, der aldrig
  // fik noget at tippe på. Tallet gør den frosne liste synlig præcis dér, hvor
  // nogen kan nå at reagere på den.
  useEffect(() => {
    if (typeId !== "season") return;
    const seasonIds = Object.values(seasonByLeague).map((s) => s.id);
    if (!seasonIds.length) return;
    (async () => {
      const seasonToLeague = Object.fromEntries(Object.values(seasonByLeague).map((s) => [s.id, s.league_id]));
      const rows = await db.select(token, "matches", `season_id=in.(${seasonIds.join(",")})&select=season_id`);
      const counts = {};
      for (const l of leagues) counts[l.id] = 0;
      for (const r of rows) {
        const lid = seasonToLeague[r.season_id];
        if (lid) counts[lid] = (counts[lid] || 0) + 1;
      }
      setCountByLeague(counts);
      // Forvalget må ikke lande på en tom turnering: den ville se valgt ud og
      // samtidig være det ene valg, der ikke kan bruges.
      setFsLeagueIds((prev) => {
        if (prev.length) return prev;
        const first = leagues.find((l) => counts[l.id] > 0);
        return first ? [first.id] : [];
      });
    })();
  }, [typeId, seasonByLeague, leagues]); // eslint-disable-line

  function toggleFsLeague(lid) {
    // Kun et KENDT nul blokerer. `undefined` betyder "antallet er ikke hentet
    // endnu" — og dér skal knappen opføre sig, som den ser ud (aktiv), ellers
    // ville et hurtigt klik tavst intet gøre.
    if (countByLeague[lid] === 0) return;
    setFsLeagueIds((prev) => (prev.includes(lid) ? prev.filter((x) => x !== lid) : [...prev, lid]));
  }

  // Favorithold: alle synlige turneringers hold i ét opslag (~20 pr. turnering).
  useEffect(() => {
    if (typeId !== "team" || teamsByLeague !== null) return;
    (async () => {
      const leagueIds = leagues.map((l) => l.id);
      if (!leagueIds.length) return;
      const tms = await db.select(token, "teams", `league_id=in.(${leagueIds.join(",")})&select=id,league_id,name&order=name`);
      const byLeague = {};
      for (const t of tms) (byLeague[t.league_id] ||= []).push(t);
      setTeamsByLeague(byLeague);
    })();
  }, [typeId, leagues]); // eslint-disable-line

  function addTeam(teamId) {
    const all = Object.values(teamsByLeague || {}).flat();
    const team = all.find((t) => t.id === teamId);
    const season = team && seasonByLeague[team.league_id];
    if (!team || !season) return;
    setTeamSel((prev) => (prev.some((t) => t.teamId === teamId) ? prev
      : [...prev, { teamId: team.id, leagueId: team.league_id, seasonId: season.id, name: team.name }]));
  }

  // Puljen af kommende kampe. Quick League skal kunne se flere runder frem, så
  // dens opslag går 11 uger ud (maks. 10 runder + margen) med et højere loft —
  // det gamle `limit=300` fra nærmeste runde og frem rakte kun til én runde
  // ad gangen med 7+ turneringer.
  useEffect(() => {
    if (!type || (type.mode !== "random" && typeId !== "custom")) return;
    const seasonIds = Object.values(seasonByLeague).map((s) => s.id);
    if (!seasonIds.length) return;
    (async () => {
      const seasonToLeague = Object.fromEntries(Object.values(seasonByLeague).map((s) => [s.id, s.league_id]));
      const leagueNames = Object.fromEntries(leagues.map((l) => [l.id, l.name]));
      const nowIso = new Date().toISOString();
      const horizon = typeId === "quick_league"
        ? `&kickoff_at=lte.${new Date(Date.now() + 11 * 7 * 24 * 3600 * 1000).toISOString()}&limit=1000`
        : "&limit=300";
      const ms = await db.select(token, "matches", `season_id=in.(${seasonIds.join(",")})&kickoff_at=gte.${nowIso}&select=*&order=kickoff_at${horizon}`);
      const teamIds = [...new Set(ms.flatMap((m) => [m.home_team_id, m.away_team_id]))];
      const tms = teamIds.length ? await db.select(token, "teams", `id=in.(${teamIds.join(",")})&select=id,name`) : [];
      setUpcomingTeams(Object.fromEntries(tms.map((t) => [t.id, t.name])));
      setUpcoming(ms.map((m) => ({ ...m, _leagueId: seasonToLeague[m.season_id], _leagueName: leagueNames[seasonToLeague[m.season_id]] })));
      setPickedIds([]);
    })();
  }, [typeId, seasonByLeague, leagues]); // eslint-disable-line

  const upcomingRounds = useMemo(() => {
    const allowed = pickLeagueIds || leagues.map((l) => l.id);
    return groupIntoRounds(upcoming.filter((m) => allowed.includes(m._leagueId)));
  }, [upcoming, pickLeagueIds, leagues]);
  const randomPool = useMemo(() => {
    const allowed = randomLeagueIds || leagues.map((l) => l.id);
    return upcoming.filter((m) => allowed.includes(m._leagueId));
  }, [upcoming, randomLeagueIds, leagues]);
  const randomRounds = useMemo(() => groupIntoRounds(randomPool), [randomPool]);

  // Ugens kupon er det ENE kort, der forudfylder navnet — det genererede navn
  // ("Ugens kupon 12/08 – 18/08") er selve featuren. Alle andre kort starter
  // tomt (B6): et foreslået navn blev bare beholdt frem for at blive sigende.
  const nameTouched = useRef(false);
  useEffect(() => {
    if (nameTouched.current || typeId !== "weekly_coupon" || !randomRounds.length) return;
    setName(weeklyCouponName(randomRounds[0].key));
  }, [typeId, randomRounds]);

  function pickType(id) {
    const t = createTypeById(id);
    setTypeId(id);
    setErr("");
    if (t.mode === "random") {
      setRandomCount(t.presets.count);
      setRoundsCount(t.presets.rounds > 1 ? t.presets.rounds : 6);
      if (t.presets.allLeagues) setRandomLeagueIds(null);
    }
    if (!nameTouched.current) setName("");
  }

  // Skærmen samler kun sin UI-state; formen bygges i lib/createTypes.js og
  // skrives i data.js, så guiden og denne skærm ikke kan divergere.
  function specFromState() {
    const shared = { typeId, name, groupId, awards: !!(type?.multiRound && awards) };
    if (typeId === "season") {
      return buildSpec({
        ...shared,
        tournaments: fsLeagueIds
          .filter((id) => seasonByLeague[id] && countByLeague[id] !== 0)
          .map((lid) => ({ leagueId: lid, seasonId: seasonByLeague[lid].id })),
      });
    }
    if (typeId === "team") return buildSpec({ ...shared, teams: teamSel });
    if (typeId === "custom") {
      if (method === "period") {
        return buildSpec({
          ...shared, method,
          leagueId: periodLeagueId, seasonId: seasonByLeague[periodLeagueId]?.id || null,
          startDate, endDate,
        });
      }
      return buildSpec({ ...shared, method, matchIds: pickedIds });
    }
    const rounds = typeId === "quick_league" ? roundsCount : 1;
    return buildSpec({
      ...shared,
      matchIds: pickRandomFromRounds(randomPool, { count: randomCount, rounds }),
      randomCount, rounds,
    });
  }

  const canSubmit = !!name && (
    typeId === "season" ? fsLeagueIds.some((id) => countByLeague[id] !== 0)
    : typeId === "team" ? teamSel.length > 0
    : typeId === "custom" ? (method === "period" ? !!(periodLeagueId && startDate && endDate) : pickedIds.length > 0)
    : randomPool.length > 0
  );

  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setErr("");
    try {
      const { competition } = await createCompetition(token, userId, specFromState());
      await onCreated();
      openBoard(competition.id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BackBar title="Opret konkurrence" onBack={typeId ? () => setTypeId(null) : onBack} />
      <Card>
        {!typeId && <TypeGallery onPick={pickType} />}
        {typeId && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              {/* Samme ikon som på kortet — kontinuitet fra galleriet. Hverken
                  "Anbefalet" eller varigheds-mærkaten gentages her: begge dele
                  hjalp med at VÆLGE, og valget er truffet. */}
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", minWidth: 0 }}>
                {TypeIcon && <TypeIcon size={18} color={C.muted} style={{ flexShrink: 0, marginTop: 3 }} />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: font.display, textTransform: "uppercase", fontWeight: 700, fontSize: 18 }}>{type.title}</div>
                  <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.4 }}>{type.subtitle}</div>
                </div>
              </div>
              <button type="button" style={{ ...btnGhost, flexShrink: 0 }} onClick={() => setTypeId(null)}>
                <ChevronLeft size={14} /> Skift type
              </button>
            </div>

            {typeId === "season" && (
              <SeasonFields leagues={leagues} fsLeagueIds={fsLeagueIds} countByLeague={countByLeague} onToggle={toggleFsLeague} />
            )}
            {typeId === "team" && (
              <TeamFields leagues={leagues} teamsByLeague={teamsByLeague} seasonByLeague={seasonByLeague}
                selected={teamSel} onAdd={addTeam} onRemove={(tid) => setTeamSel((prev) => prev.filter((t) => t.teamId !== tid))} />
            )}
            {(typeId === "quick_pick" || typeId === "quick_league") && (
              <RandomFields isQuickLeague={typeId === "quick_league"}
                count={randomCount} onCount={setRandomCount}
                rounds={roundsCount} onRounds={setRoundsCount}
                leagues={leagues} leagueIds={randomLeagueIds} onLeagueIds={setRandomLeagueIds}
                poolRounds={randomRounds} />
            )}
            {typeId === "weekly_coupon" && (
              <span style={{ color: C.muted, fontSize: 12.5, lineHeight: 1.45 }}>
                {randomRounds.length
                  ? `${Math.min(8, randomRounds[0].matches.length)} tilfældige kampe fra runden ${randomRounds[0].label} — på tværs af alle turneringer.`
                  : "Henter den kommende runde…"}
              </span>
            )}
            {typeId === "custom" && (
              <CustomFields method={method} onMethod={setMethod}
                leagues={leagues} pickLeagueIds={pickLeagueIds} onPickLeagueIds={setPickLeagueIds}
                upcomingRounds={upcomingRounds} upcomingTeams={upcomingTeams} pickedIds={pickedIds} onPickedIds={setPickedIds}
                periodLeagueId={periodLeagueId} onPeriodLeagueId={setPeriodLeagueId}
                startDate={startDate} endDate={endDate} onStartDate={setStartDate} onEndDate={setEndDate} />
            )}

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ color: C.muted, fontSize: 12 }}>Navn</span>
              <input className="field" placeholder={`Navn på ${type.title.toLowerCase()}-konkurrencen…`} value={name}
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

            {/* Kårings-tilvalget (I13) vises kun for typer over flere runder: i en
                én-rundes konkurrence ER vinderen ugens bedste. Navnene er med
                vilje IKKE de globale titler (rundevinder/månedsmester). */}
            {type.multiRound && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={awards} onChange={(e) => setAwards(e.target.checked)} />
                <span style={{ fontSize: 13 }}>
                  Kår <b>Ugens bedste</b> og <b>Månedens bedste</b> undervejs
                </span>
              </label>
            )}

            {err && <p style={{ color: C.red, fontSize: 13, margin: 0 }}>{err}</p>}
            <button style={{ ...btnGreen, opacity: busy || !canSubmit ? 0.5 : 1 }} onClick={submit} disabled={busy || !canSubmit}>
              {busy ? "Opretter…" : "Opret konkurrence"}
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}

export default CreateCompetitionScreen;
