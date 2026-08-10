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
import { loadNewestSeasons, countMatchesPerLeague, loadTeamsByLeague, loadUpcomingMatches, loadCurrentRoundMatches } from "../lib/data/createSources.js";
import { validateGroupName } from "../lib/onboarding.js";
import { ChevronLeft } from "lucide-react";
import { groupIntoRounds, currentRoundKey, nextRoundKey, roundKeyOfDate, roundLabel, zonedDateKey, isLocked, filterTippable, filterFromRoundStart } from "../lib/scoring.js";
import { createTypeById, pickRandomFromRounds, pickPerRound, lockedPicks, weeklyCouponName, buildSpec } from "../lib/createTypes.js";
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
import RoundStartChoice from "./create/RoundStartChoice.jsx";

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
  // null = alle turneringer, samme konvention som LeagueChips bruger overalt.
  const [periodLeagueIds, setPeriodLeagueIds] = useState(null);
  const [perRound, setPerRound] = useState(0); // 0 = alle kampe i runden
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // kommende kampe (puljen for random-typerne og håndplukket)
  const [upcoming, setUpcoming] = useState([]);
  const [upcomingTeams, setUpcomingTeams] = useState({});
  const [upcomingTruncated, setUpcomingTruncated] = useState(false); // ramte vi loftet? (G35)
  // Startrunde: begynder konkurrencen i den runde, der er i gang, eller den
  // næste? Standarden er "current" — man vil som regel i gang med det samme —
  // men valget skal FINDES, fordi en konkurrence oprettet sent i ugen ellers
  // tavst fik en halvspillet runde som sin første.
  const [roundStart, setRoundStart] = useState("current");
  // Indeværende rundes kampe, ALLE af dem. Puljen ovenfor går fra `nu` og frem
  // og kan derfor ikke svare på, hvor mange der allerede er væk — og det er
  // netop nævneren, valget skal træffes på.
  const [currentRoundMatches, setCurrentRoundMatches] = useState([]);

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
  // dens opslag går 12 uger ud (maks. 10 runder + margen, og én runde ekstra
  // siden startrunde-valget kan skubbe vinduet en uge frem) med et højere loft —
  // det gamle `limit=300` fra nærmeste runde og frem rakte kun til én runde
  // ad gangen med 7+ turneringer. Selve opslaget, og hvordan afkortning gøres
  // MÆRKBAR, bor i lib/data/createSources.js.
  //
  // Indeværende rundes kampe hentes i samme ombæring og af samme grund som
  // puljen: de fire typer, der har en startrunde, skal kunne vise, hvor meget af
  // runden der allerede er væk.
  useEffect(() => {
    if (!type || (type.mode !== "random" && typeId !== "custom")) return;
    if (!Object.keys(seasonByLeague).length) return;
    (async () => {
      const quick = typeId === "quick_league";
      const { matches, teams, truncated } = await loadUpcomingMatches(token, seasonByLeague, leagues, {
        limit: quick ? UPCOMING_LIMIT_QUICK : UPCOMING_LIMIT_PICK,
        horizonMs: quick ? 12 * 7 * 24 * 3600 * 1000 : null,
      });
      setUpcomingTruncated(truncated);
      setUpcomingTeams(teams);
      setUpcoming(matches);
      setPickedIds([]);
    })();
  }, [typeId, seasonByLeague, leagues]); // eslint-disable-line

  // Indeværende rundes kampe hentes for ALLE korttyper: alle seks har et
  // startrunde-valg, og nævneren ("5 af 6 kampe er allerede spillet") er det
  // ene tal, puljen af KOMMENDE kampe per definition ikke kan svare på.
  //
  // Eget opslag frem for en gren i puljens effekt: Sæson og Favorithold henter
  // ikke puljen — deres kampe findes af en regel på skriverens side — og skal
  // alligevel kunne vise det samme.
  useEffect(() => {
    if (!typeId || !Object.keys(seasonByLeague).length) return;
    (async () => { setCurrentRoundMatches(await loadCurrentRoundMatches(token, seasonByLeague, leagues)); })();
  }, [typeId, seasonByLeague, leagues]); // eslint-disable-line

  const upcomingRounds = useMemo(() => {
    const allowed = pickLeagueIds || leagues.map((l) => l.id);
    return groupIntoRounds(upcoming.filter((m) => allowed.includes(m._leagueId)));
  }, [upcoming, pickLeagueIds, leagues]);
  // Periodens valgte turneringer — kun dem, der HAR en sæson med kampprogram.
  const periodTournaments = useMemo(() => {
    const allowed = periodLeagueIds || leagues.map((l) => l.id);
    return allowed
      .filter((id) => seasonByLeague[id])
      .map((id) => ({ leagueId: id, seasonId: seasonByLeague[id].id }));
  }, [periodLeagueIds, leagues, seasonByLeague]);

  // Kampene bag et LOFT udpeges i klienten, fordi loftet gør konkurrencen
  // håndplukket (se buildSpec). Uden loft er listen tom og ubrugt: da er det
  // datoerne, der er reglen, og serveren finder selv kampene — også dem, der
  // først skemalægges senere.
  //
  // Puljen er den samme `upcoming`, håndpluk bruger, og den er skåret ved et
  // loft fra nærmeste runde og frem. Advarslen om afkortning står allerede over
  // felterne (`upcomingTruncated`) og gælder derfor også her.
  //
  // Låste kampe skæres fra HER og ikke i visningen, fordi brugeren aldrig har
  // set dem enkeltvis: loftet er en regel ("højst ti pr. runde"), ikke en
  // liste, og en kamp, der ikke kan tippes, hører ikke til i den. Håndpluk er
  // det modsatte og behandles derfor modsat — se kampvælgeren i CustomFields.
  const periodMatchIds = useMemo(() => {
    if (!perRound || !startDate || !endDate) return [];
    const allowed = periodTournaments.map((t) => t.leagueId);
    const pool = filterTippable(upcoming).filter((m) => {
      if (!allowed.includes(m._leagueId) || !m.kickoff_at) return false;
      const day = m.kickoff_at.slice(0, 10);
      return day >= startDate && day <= endDate;
    });
    return pickPerRound(pool, { perRound });
  }, [perRound, startDate, endDate, periodTournaments, upcoming]);

  // ---------- startrunde ----------
  // Rundenøglen lige nu er stabil for hele besøget: den skifter én gang om ugen,
  // og en skærm, der genberegnede den ved hver render, ville kun kunne opdage
  // skiftet ved et tilfælde. Den aflæses derfor én gang.
  const currentKey = useMemo(() => currentRoundKey(), []);

  // Det, valget skal træffes på, for ét sæt turneringer: rundens kampe (hele
  // runden, også de spillede), om der overhovedet er noget tilbage at starte på,
  // og hvilken runde "ny runde" så er. Beregnes pr. type, fordi de tilfældige
  // typer og perioden har hver sit turneringsvalg.
  function startInfoOf(leagueIds) {
    const allowed = leagueIds || leagues.map((l) => l.id);
    const roundMatches = currentRoundMatches.filter((m) => allowed.includes(m._leagueId));
    return {
      roundMatches,
      currentOpen: roundMatches.some((m) => !isLocked(m)),
      nextRound: nextRoundOf(upcoming.filter((m) => allowed.includes(m._leagueId))),
    };
  }
  // Næste runde MED antal — de tilfældige typer og perioden har puljen liggende.
  function nextRoundOf(pool) {
    const r = groupIntoRounds(pool.filter((m) => m.round_key > currentKey))[0];
    return r ? { label: r.label, count: r.matches.length } : null;
  }
  // Næste runde UDEN antal. Sæson og Favorithold henter ikke puljen af kommende
  // kampe — de materialiseres af en regel på serversiden — så etiketten regnes
  // ud af rundenøglen frem for at koste et opslag på op til 800 rækker.
  const nextRoundLabelOnly = { label: roundLabel(nextRoundKey(currentKey)), count: null };
  const randomStart = useMemo(() => startInfoOf(randomLeagueIds), [currentRoundMatches, upcoming, randomLeagueIds, leagues, currentKey]); // eslint-disable-line
  const periodStart = useMemo(() => startInfoOf(periodLeagueIds), [currentRoundMatches, upcoming, periodLeagueIds, leagues, currentKey]); // eslint-disable-line

  // Sæson og Favorithold har hver sit udsnit af indeværende runde: Sæson de
  // valgte turneringers kampe, Favorithold kun de valgte HOLDS kampe — ellers
  // ville nævneren tælle kampe, konkurrencen aldrig kommer til at indeholde.
  const seasonRoundMatches = useMemo(
    () => currentRoundMatches.filter((m) => fsLeagueIds.includes(m._leagueId)),
    [currentRoundMatches, fsLeagueIds]);
  const teamRoundMatches = useMemo(() => {
    const ids = teamSel.map((t) => t.teamId);
    return currentRoundMatches.filter((m) => ids.includes(m.home_team_id) || ids.includes(m.away_team_id));
  }, [currentRoundMatches, teamSel]);

  // Er der intet tilbage i indeværende runde, ER startrunden den næste — uanset
  // hvad chippen står på. Valget klemmes her frem for at blive skrevet tilbage i
  // state: en `setRoundStart` inde i en effekt ville kunne kæmpe med brugerens
  // klik, hver gang turneringsvalget ændrede svaret.
  const effectiveRoundStart = randomStart.currentOpen ? roundStart : "next";
  // Samme klemme for de to sæson-typer, hver med sit udsnit af runden.
  const seasonRoundOpen = seasonRoundMatches.some((m) => !isLocked(m));
  const teamRoundOpen = teamRoundMatches.some((m) => !isLocked(m));
  const seasonRoundStart = seasonRoundOpen ? roundStart : "next";
  const teamRoundStart = teamRoundOpen ? roundStart : "next";

  // Låste kampe ryger ud AF PULJEN og ikke først ved udvælgelsen: gjorde de
  // ikke det, ville tallene ved siden af felterne ("38 kampe pr. runde",
  // "1 kamp kan stadig tippes") tælle kampe, udvælgelsen ikke ville bruge — og
  // to tal, der er uenige om den samme runde, er værre end ét, der er for højt.
  const randomPool = useMemo(() => {
    const allowed = randomLeagueIds || leagues.map((l) => l.id);
    return filterFromRoundStart(filterTippable(upcoming.filter((m) => allowed.includes(m._leagueId))),
      { start: effectiveRoundStart, currentKey });
  }, [upcoming, randomLeagueIds, leagues, effectiveRoundStart, currentKey]);
  const randomRounds = useMemo(() => groupIntoRounds(randomPool), [randomPool]);

  // Perioden har allerede sin startdato, så valget er AFLEDT af den frem for at
  // være sin egen state — ellers ville to kontroller kunne stå og modsige
  // hinanden om, hvornår konkurrencen begynder. Chippen skriver datoen; datoen
  // skriver chippen.
  const periodRoundStart = startDate && roundKeyOfDate(startDate) > currentKey ? "next" : "current";
  function setPeriodRoundStart(v) {
    setStartDate(v === "next" ? nextRoundKey(currentKey) : zonedDateKey(new Date().toISOString()));
  }
  // Standarden er indeværende runde, altså i dag. Datoen sættes i KLIKKET på
  // "Periode" og ikke i en effekt: en effekt, der skriver state, koster en ekstra
  // render (og en advarsel fra `react-hooks/set-state-in-effect`) for noget, der
  // har et præcist tidspunkt i forvejen — brugeren valgte metoden.
  //
  // Det er ikke en forudfyldning, man glemmer at rette (B6): perioden kan ikke
  // oprettes uden datoer alligevel (se `canSubmit`), og datoen er præcis dét,
  // startrunde-valget allerede står og siger.
  function chooseMethod(m) {
    setMethod(m);
    if (m === "period" && !startDate) setStartDate(zonedDateKey(new Date().toISOString()));
  }

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
    // Startrunden er et valg pr. konkurrence, ikke en indstilling, der følger
    // med over i næste korttype — den nulstilles sammen med typens presets.
    setRoundStart("current");
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
        ...shared, startRound: seasonRoundStart,
        tournaments: fsLeagueIds
          .filter((id) => seasonByLeague[id] && countByLeague[id] !== 0)
          .map((lid) => ({ leagueId: lid, seasonId: seasonByLeague[lid].id })),
      });
    }
    if (typeId === "team") return buildSpec({ ...shared, startRound: teamRoundStart, teams: teamSel });
    if (typeId === "custom") {
      if (method === "period") {
        const only = periodTournaments.length === 1 ? periodTournaments[0] : null;
        return buildSpec({
          ...shared, method, perRound,
          tournaments: periodTournaments,
          // Én turnering beholder den bundne form; flere gør konkurrencen
          // turneringsløs. Er der et loft, er `matchIds` det, der tæller.
          leagueId: only?.leagueId || null, seasonId: only?.seasonId || null,
          startDate, endDate,
          matchIds: periodMatchIds,
        });
      }
      return buildSpec({ ...shared, method, matchIds: pickedIds });
    }
    const rounds = typeId === "quick_league" ? roundsCount : 1;
    // Filtreret ÉN GANG TIL her, selv om puljen allerede er det: puljen er et
    // øjebliksbillede fra dengang, felterne blev tegnet, og en skærm, der har
    // stået åben, mens brugeren fandt på et navn, ville ellers kunne trække en
    // kamp, der låste undervejs. Udvælgelsen er det sidste sted, sandheden
    // stadig kan tjekkes.
    return buildSpec({
      ...shared,
      matchIds: pickRandomFromRounds(filterTippable(randomPool), { count: randomCount, rounds }),
      randomCount, rounds,
    });
  }

  // Ligaen er et krav på linje med navnet og kampene — knappen er slukket,
  // indtil den er valgt eller oprettet.
  const canSubmit = !!name && !!groupId && (
    typeId === "season" ? fsLeagueIds.some((id) => countByLeague[id] !== 0)
    : typeId === "team" ? teamSel.length > 0
    : typeId === "custom" ? (method === "period"
        ? !!(periodTournaments.length && startDate && endDate && (!perRound || periodMatchIds.length))
        : pickedIds.length > 0)
    : randomPool.length > 0
  );

  // Håndplukkets sidste kontrol før oprettelsen. Selve spørgsmålet — hvilke af
  // de udpegede kampe er nået at låse — er en ren regel og bor i
  // `lockedPicks` (createTypes.js); her står kun, hvad skærmen gør ved svaret.
  //
  // Vinduet er lille (skærmen skal have stået åben hen over en lås) og præcis
  // derfor værd at lukke: det er den slags, der aldrig ses i en test og rammer
  // en rigtig bruger en søndag aften.
  function stripLockedPicks() {
    if (typeId !== "custom" || method !== "pick" || !pickedIds.length) return false;
    const laaste = new Set(lockedPicks(pickedIds, upcoming));
    if (!laaste.size) return false;
    const tilbage = pickedIds.filter((id) => !laaste.has(id));
    setPickedIds(tilbage);
    const hvorMange = laaste.size === 1 ? "Én af de valgte kampe" : `${laaste.size} af de valgte kampe`;
    // Er der intet tilbage, er "tryk igen" en blindgyde — knappen er slukket af
    // `canSubmit`, og beskeden skal derfor pege på det, der faktisk mangler.
    setErr(`${hvorMange} er låst, mens skærmen stod åben, og er fjernet fra dit valg. `
      + (tilbage.length ? "Tryk Opret igen." : "Vælg mindst én kamp, der ikke er låst."));
    return true;
  }

  async function submit() {
    if (!canSubmit) return;
    if (stripLockedPicks()) return;
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
              <SeasonFields leagues={leagues} fsLeagueIds={fsLeagueIds} countByLeague={countByLeague} onToggle={toggleFsLeague}
                roundStart={seasonRoundStart} onRoundStart={setRoundStart}
                currentRoundMatches={seasonRoundMatches} currentRoundOpen={seasonRoundOpen}
                nextRound={nextRoundLabelOnly} />
            )}
            {typeId === "team" && (
              <TeamFields leagues={leagues} teamsByLeague={teamsByLeague} seasonByLeague={seasonByLeague}
                selected={teamSel} onAdd={addTeam} onRemove={(tid) => setTeamSel((prev) => prev.filter((t) => t.teamId !== tid))}
                roundStart={teamRoundStart} onRoundStart={setRoundStart}
                currentRoundMatches={teamRoundMatches} currentRoundOpen={teamRoundOpen}
                nextRound={nextRoundLabelOnly} />
            )}
            {(typeId === "quick_pick" || typeId === "quick_league") && (
              <RandomFields isQuickLeague={typeId === "quick_league"}
                count={randomCount} onCount={setRandomCount}
                rounds={roundsCount} onRounds={setRoundsCount}
                leagues={leagues} leagueIds={randomLeagueIds} onLeagueIds={setRandomLeagueIds}
                poolRounds={randomRounds}
                roundStart={effectiveRoundStart} onRoundStart={setRoundStart}
                currentRoundMatches={randomStart.roundMatches} currentRoundOpen={randomStart.currentOpen}
                nextRound={randomStart.nextRound} />
            )}
            {typeId === "weekly_coupon" && (
              <>
                {/* Ugens kupon har ellers ingen felter — "klar med to tryk" er
                    hele kortet. Startrunden er den ene undtagelse: kuponen ER
                    én runde, så en halvspillet startrunde er ikke en detalje,
                    den er konkurrencen. */}
                <RoundStartChoice value={effectiveRoundStart} onChange={setRoundStart}
                  roundMatches={randomStart.roundMatches} currentOpen={randomStart.currentOpen}
                  nextRound={randomStart.nextRound} />
                <span style={{ color: C.muted, fontSize: 12.5, lineHeight: 1.45 }}>
                  {randomRounds.length
                    ? `${Math.min(8, randomRounds[0].matches.length)} tilfældige kampe fra runden ${randomRounds[0].label} — fordelt jævnt på tværs af alle turneringer.`
                    : "Henter den kommende runde…"}
                </span>
              </>
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
            {/* `currentRoundOpen` er altid sand for perioden: den løber over
                uger, så "start i dag" er et lovligt valg, også når indeværende
                runde er spillet færdig. For de tilfældige typer slukkes chippen,
                fordi startrunden dér ER konkurrencens første (eller eneste). */}
            {typeId === "custom" && (
              <CustomFields method={method} onMethod={chooseMethod}
                perRound={perRound} onPerRound={setPerRound} periodCount={periodMatchIds.length}
                leagues={leagues} pickLeagueIds={pickLeagueIds} onPickLeagueIds={setPickLeagueIds}
                upcomingRounds={upcomingRounds} upcomingTeams={upcomingTeams} pickedIds={pickedIds} onPickedIds={setPickedIds}
                periodLeagueIds={periodLeagueIds} onPeriodLeagueIds={setPeriodLeagueIds}
                startDate={startDate} endDate={endDate} onStartDate={setStartDate} onEndDate={setEndDate}
                roundStart={periodRoundStart} onRoundStart={setPeriodRoundStart}
                currentRoundMatches={periodStart.roundMatches} nextRound={periodStart.nextRound}
                currentRoundOpen />
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
