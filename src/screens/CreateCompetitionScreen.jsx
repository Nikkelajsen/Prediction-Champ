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
import { loadMyGroups, createCompetition, createGroup } from "../lib/data.js";
import { loadNewestSeasons, countMatchesPerLeague, loadTeamsByLeague, loadUpcomingMatches } from "../lib/data/createSources.js";
import { validateGroupName } from "../lib/onboarding.js";
import { ChevronLeft } from "lucide-react";
import { groupIntoRounds } from "../lib/scoring.js";
import { createTypeById, pickRandomFromRounds, weeklyCouponName, buildSpec } from "../lib/createTypes.js";
import { C, btnGhost, btnGreen, font } from "../ui/theme.js";
import { BackBar, Card } from "../ui/components.jsx";
import TypeGallery, { ICONS } from "./create/TypeGallery.jsx";

// Hvor mange kommende kampe vi henter til valg-listerne.
//
// Tallene er BEVIDST under PostgRESTs loft på 1000 (G35): et loft, der er lig
// med platformens, kan ikke skelnes fra en afkortning. Der hentes altid én
// række mere end vist, så "der er flere" kan siges frem for at ske i stilhed.
const UPCOMING_LIMIT_QUICK = 800;
const UPCOMING_LIMIT_PICK = 300;
import SeasonFields from "./create/SeasonFields.jsx";
import TeamFields from "./create/TeamFields.jsx";
import RandomFields from "./create/RandomFields.jsx";
import CustomFields from "./create/CustomFields.jsx";

function CreateCompetitionScreen({ token, userId, leagues, initialGroupId = null, onBack, onCreated, openBoard }) {
  const [typeId, setTypeId] = useState(null); // null = galleriet
  const [groups, setGroups] = useState(null); // null = ikke hentet endnu
  const [groupId, setGroupId] = useState(initialGroupId || "");
  // Liga oprettet inde i opret-flowet (se liga-blokken nedenfor)
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupErr, setGroupErr] = useState("");
  const [makingGroup, setMakingGroup] = useState(false); // står "Opret ny liga…" valgt i dropdownen?
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
  const [upcomingTruncated, setUpcomingTruncated] = useState(false); // ramte vi loftet? (G35)

  const type = createTypeById(typeId);
  const TypeIcon = ICONS[typeId] || null;

  useEffect(() => { (async () => { try { setGroups(await loadMyGroups(token, userId)); } catch (e) { setGroups([]); } })(); }, [token, userId]); // eslint-disable-line

  // Liga defaulter til brugerens FØRSTE liga.
  //
  // Før var tom-værdien defaulten, så en konkurrence oprettet uden at røre
  // feltet blev liga-løs: ingen medlemsliste, intet permanent invite-link, og
  // intet der består, når sæsonen slutter. Det valg findes ikke længere (se
  // liga-blokken nedenfor) — defaulten står, fordi den også sparer et klik.
  useEffect(() => {
    if (!groupId && !initialGroupId && groups?.length) setGroupId(groups[0].id);
  }, [groups]); // eslint-disable-line

  // Opret ligaen UDEN at forlade opret-flowet.
  //
  // Man må gerne begynde med konkurrencen — det er tit dér, lysten er — men
  // den kan ikke gøres færdig uden en liga. Havde man skullet ud på
  // Ligaer-fanen for at oprette den, ville alt det halvvalgte (kampe, hold,
  // navn) være tabt, og den nye regel ville koste præcis den bruger, den skal
  // hjælpe. Derfor bor liga-oprettelsen her, to felter fra "Opret".
  async function createAndSelectGroup() {
    const problem = validateGroupName(newGroupName);
    if (problem) { setGroupErr(problem); return; }
    setCreatingGroup(true); setGroupErr("");
    try {
      const g = await createGroup(token, userId, newGroupName);
      setGroups((prev) => [...(prev || []), g]);
      setGroupId(g.id);
      setMakingGroup(false);
      setNewGroupName("");
    } catch (e) {
      setGroupErr(e.message || "Kunne ikke oprette ligaen.");
    } finally {
      setCreatingGroup(false);
    }
  }

  // Nyeste sæson pr. turnering hentes ÉN gang — Sæson-chippene, holdvalget,
  // perioden og kamp-puljen bruger alle det samme opslag.
  useEffect(() => {
    (async () => { setSeasonByLeague(await loadNewestSeasons(token, leagues)); })();
  }, [token, leagues]);

  // Sæson: KAMPANTAL for alle turneringer. Opslaget — og hvorfor det tælles
  // pr. turnering frem for i browseren — bor i lib/data/createSources.js.
  useEffect(() => {
    if (typeId !== "season") return;
    if (!Object.keys(seasonByLeague).length) return;
    (async () => {
      const counts = await countMatchesPerLeague(token, leagues, seasonByLeague);
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
    (async () => { setTeamsByLeague(await loadTeamsByLeague(token, leagues)); })();
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
  // ad gangen med 7+ turneringer. Selve opslaget, og hvordan afkortning gøres
  // MÆRKBAR, bor i lib/data/createSources.js.
  useEffect(() => {
    if (!type || (type.mode !== "random" && typeId !== "custom")) return;
    if (!Object.keys(seasonByLeague).length) return;
    (async () => {
      const quick = typeId === "quick_league";
      const { matches, teams, truncated } = await loadUpcomingMatches(token, seasonByLeague, leagues, {
        limit: quick ? UPCOMING_LIMIT_QUICK : UPCOMING_LIMIT_PICK,
        horizonMs: quick ? 11 * 7 * 24 * 3600 * 1000 : null,
      });
      setUpcomingTruncated(truncated);
      setUpcomingTeams(teams);
      setUpcoming(matches);
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

  // Ligaen er et krav på linje med navnet og kampene — knappen er slukket,
  // indtil den er valgt eller oprettet.
  const canSubmit = !!name && !!groupId && (
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
            {/* Loftet siges HØJT (G35). Uden linjen ser listen komplet ud, og en
                bruger, der leder efter en kamp langt ude i fremtiden, ville tro,
                den ikke fandtes — hvilket er den samme fejl som "0 kampe", bare
                med et andet tal. */}
            {upcomingTruncated && (typeId === "custom" || typeId === "quick_pick" || typeId === "quick_league") && (
              <p role="status" style={{ color: C.muted, fontSize: 12, margin: 0 }}>
                Der er flere kampe, end der kan vises her. Listen er skåret ved de førstkommende —
                skal du bruge en kamp længere ude i fremtiden, så opret konkurrencen som en periode eller en hel sæson.
              </p>
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

            {/* Liga er et KRAV, ikke et tilvalg (august 2026). "Ingen liga" var
                før et lovligt punkt i dropdownen, og en konkurrence oprettet
                dér havde hverken medlemsliste, permanent invite-link eller
                noget, der bestod, når sæsonen sluttede. Har man ingen liga,
                oprettes den her — samme skærm, to felter, ingen omvej. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ color: C.muted, fontSize: 12 }}>Liga</span>
              {!groups && <span style={{ color: C.muted, fontSize: 12 }}>Henter dine ligaer…</span>}
              {groups?.length > 0 && (
                <select className="field" aria-label="Liga" value={makingGroup ? "__new" : groupId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setGroupErr("");
                    if (v === "__new") { setMakingGroup(true); setGroupId(""); }
                    else { setMakingGroup(false); setGroupId(v); }
                  }}>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  <option value="__new">+ Opret ny liga…</option>
                </select>
              )}
              {groups && (groups.length === 0 || makingGroup) && (
                <>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input className="field" style={{ flex: 1 }} placeholder="Navn på liga (2–40 tegn)…"
                      value={newGroupName} maxLength={40} aria-label="Navn på liga"
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createAndSelectGroup(); } }} />
                    <button type="button" style={{ ...btnGhost, flexShrink: 0, opacity: creatingGroup || !newGroupName.trim() ? 0.5 : 1 }}
                      disabled={creatingGroup || !newGroupName.trim()} onClick={createAndSelectGroup}>
                      {creatingGroup ? "Opretter…" : "Opret liga"}
                    </button>
                  </div>
                  <span style={{ color: C.muted, fontSize: 12, lineHeight: 1.45 }}>
                    En konkurrence hører altid til en liga — fællesskabet, der bliver stående, når
                    konkurrencen er slut. Ligaen samler medlemmer, historik og ét fælles invite-link.
                  </span>
                </>
              )}
              {groupErr && <p style={{ color: C.red, fontSize: 13, margin: 0 }}>{groupErr}</p>}
            </div>

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
