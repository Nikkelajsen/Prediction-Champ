// Championship-fanen: de officielle konkurrencer, hvor alle er med automatisk.
// Runde-, måneds- og sæsonchampionship — hver med sin kåring.
//
// Skærmen er delt op 3. august 2026 (G1): stillings- og kårings-visningerne bor
// i championship/StandingsTable.jsx, omfangs-valget og titlerne i
// championship/scope.js, og kortoverskriften i championship/CardHead.jsx.
// Tilbage her står dét, en skærm er: hent data, vælg omfang, sæt kortene
// sammen. Flytningen er ren — ingen linje er ændret undervejs.
import { useState, useEffect, useMemo } from "react";
import { currentMonthKey, loadMonthlyBoard, loadMonthsAvailable, loadRatingMap, loadRoundsAvailable, loadRoundBoard, loadSeasonBoard, monthName } from "../lib/data.js";
import { roundLabel } from "../lib/scoring.js";
import { joinNames } from "../lib/standings.js";
import { C, muted } from "../ui/theme.js";
import { Card, Eyebrow, H, InfoDot } from "../ui/components.jsx";
import { Champions, FullStandingsModal, Standings } from "./championship/StandingsTable.jsx";
import { CardHead } from "./championship/CardHead.jsx";
import {
  ALL_SCOPE, WHY_NOT_ALL, boardTitle, filterSelect, pickSeasonLeague,
  readSeasonLeagueId, scopeNote, writeSeasonLeagueId,
} from "./championship/scope.js";

function ChampionshipTab({ token, userId, leagues = [], openProfile }) {
  const [months, setMonths] = useState([]);
  const [month, setMonth] = useState(currentMonthKey());
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState(null); // null=henter · undefined=ingen liga · objekt=data
  const [rounds, setRounds] = useState([]);
  const [roundKey, setRoundKey] = useState(null);
  const [roundBoard, setRoundBoard] = useState(null);
  const [ratingMap, setRatingMap] = useState(null); // user_id -> { rating, provisional }
  const [full, setFull] = useState(null); // { title, rows, isComplete } — fuld-stilling-modal

  // Kun OFFICIELLE turneringer fodrer Championship (leagues.is_official). En
  // turnering kan være synlig og tipbar uden at afgøre titler — det er et
  // bevidst valg pr. turnering, ikke noget der følger med, når den tændes.
  // Filtreringen sker her og ikke i MainApp, så de øvrige skærme er upåvirkede.
  const officialLeagues = useMemo(() => leagues.filter((l) => l.is_official !== false), [leagues]);
  // Modstykket: de synlige turneringer, der IKKE afgør titler. `leagues` er
  // allerede filtreret på synlighed i MainApp, så en skjult turnering hverken
  // tælles eller nævnes — den findes ikke for brugeren.
  const unofficialLeagues = useMemo(() => leagues.filter((l) => l.is_official === false), [leagues]);
  const note = useMemo(() => scopeNote(officialLeagues, unofficialLeagues), [officialLeagues, unofficialLeagues]);

  const [seasonLeagueId, setSeasonLeagueId] = useState(() => readSeasonLeagueId(userId));
  const seasonLeague = useMemo(() => pickSeasonLeague(officialLeagues, seasonLeagueId), [officialLeagues, seasonLeagueId]);

  const [roundScope, setRoundScope] = useState(ALL_SCOPE);
  const [monthScope, setMonthScope] = useState(ALL_SCOPE);
  const roundLeague = officialLeagues.find((l) => l.id === roundScope) || null;
  const monthLeague = officialLeagues.find((l) => l.id === monthScope) || null;

  useEffect(() => {
    loadRatingMap(token).then(setRatingMap).catch(() => setRatingMap(new Map()));
  }, [token]);

  // Vælgerens liste kommer fra `championship_months` (`#74`). Fejler den, må
  // fanen ikke blive stående i sin spinner: `setLoading(false)` lå før kun på
  // den lykkelige sti, så et hvilket som helst afbrud — en tabt forbindelse
  // eller et view, der endnu ikke er oprettet i Supabase — efterlod skærmen
  // ladende for evigt. Faldet er den indeværende måned, altså præcis det, en
  // tom liste allerede gav.
  useEffect(() => {
    (async () => {
      setLoading(true);
      setRows(null);
      let ms;
      try { ms = await loadMonthsAvailable(token, monthScope); } catch { ms = []; }
      const list = ms.length ? ms : [currentMonthKey()];
      setMonths(list);
      const chosen = list.includes(month) ? month : list[0];
      setMonth(chosen);
      try { setRows(await loadMonthlyBoard(token, chosen, monthScope)); } catch { setRows([]); }
      setLoading(false);
    })();
  }, [monthScope]); // eslint-disable-line

  useEffect(() => {
    if (!seasonLeague) { setSeason(undefined); return; }
    let cancelled = false;
    (async () => {
      setSeason(null);
      try {
        const b = await loadSeasonBoard(token, seasonLeague.id);
        if (!cancelled) setSeason(b || undefined);
      } catch { if (!cancelled) setSeason(undefined); }
    })();
    return () => { cancelled = true; };
  }, [token, seasonLeague]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRoundBoard(null);
      // Samme værn som måneds-effekten ovenfor: en fejlet liste giver en tom
      // vælger og et tomt kort, ikke et kort, der aldrig bliver færdigt.
      let rs;
      try { rs = await loadRoundsAvailable(token, roundScope); } catch { rs = []; }
      if (cancelled) return;
      setRounds(rs);
      if (rs.length) {
        setRoundKey(rs[0]);
        try {
          const b = await loadRoundBoard(token, rs[0], roundScope);
          if (!cancelled) setRoundBoard(b);
        } catch { if (!cancelled) setRoundBoard({ rows: [], totalMatches: 0, playedMatches: 0, isComplete: false }); }
      } else {
        setRoundBoard({ rows: [], totalMatches: 0, playedMatches: 0, isComplete: false });
      }
    })();
    return () => { cancelled = true; };
  }, [token, roundScope]);

  // De to skift har samme værn som effekterne ovenfor og af samme grund: begge
  // sætter først kortet til `null` (spinner) og fylder det derefter. Fejler
  // opslaget, ville spinderen blive stående, indtil brugeren forlod fanen.
  async function changeMonth(m) {
    setMonth(m); setRows(null);
    try { setRows(await loadMonthlyBoard(token, m, monthScope)); } catch { setRows([]); }
  }

  async function changeRound(k) {
    setRoundKey(k); setRoundBoard(null);
    try { setRoundBoard(await loadRoundBoard(token, k, roundScope)); }
    catch { setRoundBoard({ rows: [], totalMatches: 0, playedMatches: 0, isComplete: false }); }
  }

  function changeSeasonLeague(id) {
    setSeasonLeagueId(id);
    writeSeasonLeagueId(userId, id);
  }

  const isPast = month < currentMonthKey();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        {/* Forskellen på Championship og "en konkurrence" er den hyppigste
            forveksling: det ene er noget, man automatisk ER med i, det andet
            noget, man selv opretter. Sig begge dele samme sted. */}
        <Eyebrow>Officielle konkurrencer · alle er med <InfoDot title="Championship">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>Officielle konkurrencer, hvor <b>alle brugere automatisk er med</b> — ingen tilmelding og ingen invitation.</div>
            <div>En <b>konkurrence</b> er noget andet: den opretter du selv i din liga og inviterer dine venner til.</div>
            <div>Dine tips tæller <b>begge steder</b> på én gang — du tipper kun én gang pr. kamp.</div>
          </div>
        </InfoDot></Eyebrow>
        <H>Championship</H>
      </div>

      {/* Rundechampionship — Rundens Champion */}
      <Card>
        <CardHead title={boardTitle("round", roundLeague)} info={
          <InfoDot title={boardTitle("round", roundLeague)}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>Dine samlede point for én enkelt spillerunde. Alle er automatisk med. Ved pointlighed afgør flest præcise resultater, så flest korrekte udfald, og til sidst hvem der var tættest på — er to helt lige, deles titlen. Vælg en runde i dropdownen.</div>
              {officialLeagues.length > 1 && (
                <div><b>To niveauer:</b> "Alle turneringer" samler ugens kampe på tværs og kårer <b>Rundens Champion</b> — den store titel. Vælger du én turnering, ser du stillingen for netop den, hvor alle er målt på de samme kampe; dens vinder er "Rundens bedste i turneringen".</div>
              )}
              {note && <div><b>Hvilke turneringer tæller:</b> {note} {WHY_NOT_ALL}</div>}
            </div>
          </InfoDot>
        }>
          {officialLeagues.length > 1 && (
            <select className="field" value={roundScope} onChange={(e) => setRoundScope(e.target.value)} style={filterSelect}>
              <option value={ALL_SCOPE}>Alle turneringer</option>
              {officialLeagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          {rounds.length > 0 && (
            <select className="field" value={roundKey || ""} onChange={(e) => changeRound(e.target.value)} style={filterSelect}>
              {rounds.map((k) => <option key={k} value={k}>{roundLabel(k)}</option>)}
            </select>
          )}
        </CardHead>

        {roundBoard === null && <p style={{ ...muted, margin: 0 }}>Henter…</p>}
        {roundBoard && rounds.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen spillede runder endnu — stillingen kommer, når en runde er i gang.</p>}
        {roundBoard && rounds.length > 0 && roundBoard.rows.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen point i denne runde endnu.</p>}

        {roundBoard && roundBoard.rows.length > 0 && (
          <>
            <Champions rows={roundBoard.rows} title={boardTitle("round", roundLeague)} isComplete={roundBoard.isComplete} openProfile={openProfile} />
            <Standings rows={roundBoard.rows} userId={userId} isComplete={roundBoard.isComplete} ratingMap={ratingMap}
              title={`Rundechampionship${roundLeague ? ` · ${roundLeague.name}` : ""} · runde ${roundKey ? roundLabel(roundKey) : ""}`} onOpenFull={setFull} openProfile={openProfile} />
          </>
        )}
        {/* Står uden for stillingen med vilje: den tomme stilling ("Ingen point i
            denne runde endnu") er præcis den, en bruger med kun uofficielle tips
            ser — og dermed den, der har mest brug for sætningen. Ved et valgt
            scope navngiver overskriften allerede turneringen. */}
        {note && roundScope === ALL_SCOPE && <p style={{ ...muted, margin: "10px 0 0", fontSize: 11 }}>{note}</p>}
      </Card>

      {/* Månedschampionship */}
      <Card>
        <CardHead title={boardTitle("month", monthLeague)} info={
          <InfoDot title={boardTitle("month", monthLeague)}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>Dine samlede point for alle månedens kampe (hver kamp tælles én gang). Ved pointlighed afgør flest præcise resultater, så flest korrekte udfald, så flest rundesejre, og til sidst hvem der var tættest på — er to helt lige, deles titlen. Alle er automatisk med, og stillingen nulstilles den 1. i hver måned.</div>
              {officialLeagues.length > 1 && (
                <div><b>To niveauer:</b> "Alle turneringer" samler månedens kampe på tværs og kårer <b>Månedens Champion</b> — den store titel. Vælger du én turnering, ser du stillingen for netop den, hvor alle er målt på de samme kampe.</div>
              )}
              {note && <div><b>Hvilke turneringer tæller:</b> {note} {WHY_NOT_ALL}</div>}
            </div>
          </InfoDot>
        }>
          {officialLeagues.length > 1 && (
            <select className="field" value={monthScope} onChange={(e) => setMonthScope(e.target.value)} style={filterSelect}>
              <option value={ALL_SCOPE}>Alle turneringer</option>
              {officialLeagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <select className="field" value={month} onChange={(e) => changeMonth(e.target.value)} style={filterSelect}>
            {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </CardHead>

        {rows && <Champions rows={rows} title={boardTitle("month", monthLeague)} isComplete={isPast} openProfile={openProfile} />}

        {loading && <p style={{ ...muted, margin: 0 }}>Henter…</p>}
        {!loading && rows && rows.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen point i denne måned endnu.</p>}
        {!loading && rows && rows.length > 0 && (
          <Standings rows={rows} userId={userId} isComplete={isPast} ratingMap={ratingMap}
            title={`Månedschampionship${monthLeague ? ` · ${monthLeague.name}` : ""} · ${monthName(month)}`} onOpenFull={setFull} openProfile={openProfile} />
        )}
        {note && monthScope === ALL_SCOPE && <p style={{ ...muted, margin: "10px 0 0", fontSize: 11 }}>{note}</p>}
      </Card>

      {/* Sæsonchampionship (live — samlede point for hele sæsonen) */}
      <Card>
        {/* Turneringsnavnet står i sin egen sætningsdel, så teksten holder uanset
            bøjning — "for alle Superligaen kampe" var resultatet af at sætte
            værdien ind, hvor kun fallbacken ("Superligaens") passede.
            Sidste sætning: uden den ser vælgeren ud til at mangle en
            turnering, brugeren kan se og tippe alle andre steder i appen. */}
        <CardHead title={boardTitle("season")} info={
          <InfoDot title={boardTitle("season")}>Dine samlede point for alle kampe i {seasonLeague?.name || "turneringen"} i hele sæsonen. Én sæsonstilling pr. turnering i Championship — er der flere, vælges de i dropdownen. Alle er automatisk med. Ved pointlighed afgør flest præcise resultater, så flest korrekte udfald, så flest rundesejre, og til sidst hvem der var tættest på. Sæsonens bedste kåres som Sæsonens Champion — er to helt lige, deles titlen.
            {unofficialLeagues.length > 0 && ` ${joinNames(unofficialLeagues.map((l) => l.name))} har ingen sæsonstilling.`}</InfoDot>
        }>
          {/* Vælgeren dukker først op, når der ér mere end én turnering — med kun
              én ville en dropdown med ét valg være støj. Fremdrifts-tælleren
              deler plads med den, så den flytter ned i underlinjen i stedet for
              at forsvinde. */}
          {officialLeagues.length > 1
            ? (
              <select className="field" value={seasonLeague?.id || ""} onChange={(e) => changeSeasonLeague(e.target.value)} style={filterSelect}>
                {officialLeagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )
            : season && season.rows && season.totalMatches > 0 && (
              <span style={{ color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>{season.playedMatches}/{season.totalMatches} spillet</span>
            )}
        </CardHead>
        <div style={{ color: C.muted, fontSize: 12, marginTop: -4, marginBottom: 8 }}>
          {officialLeagues.length > 1 ? "Løber over hele sæsonen" : `${seasonLeague?.name || "Turneringen"} · løber over hele sæsonen`}
          {officialLeagues.length > 1 && season && season.rows && season.totalMatches > 0 && ` · ${season.playedMatches}/${season.totalMatches} spillet`}
        </div>

        {season === null && <p style={{ ...muted, margin: 0 }}>Henter…</p>}
        {season === undefined && <p style={{ ...muted, margin: 0 }}>{boardTitle("season")} er ikke tilgængelig endnu.</p>}
        {season && season.rows && season.rows.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen point i sæsonen endnu — stillingen fyldes, når kampene spilles.</p>}

        {season && season.rows && season.rows.length > 0 && (
          <>
            <Champions rows={season.rows} title={boardTitle("season")} isComplete={season.isComplete} openProfile={openProfile} />
            <Standings rows={season.rows} userId={userId} isComplete={season.isComplete} ratingMap={ratingMap}
              title={`Sæsonchampionship · ${seasonLeague?.name || "Turneringen"}`} onOpenFull={setFull} openProfile={openProfile} />
          </>
        )}
      </Card>

      {/* Plads til flere events */}
      <Card style={{ borderStyle: "dashed", background: "transparent" }}>
        <div style={{ color: C.muted, fontSize: 13, textAlign: "center" }}>
          Her lander fremtidige events — fx en cup-weekend eller tema-runder
        </div>
      </Card>

      {full && (
        <FullStandingsModal title={full.title} rows={full.rows} userId={userId} isComplete={full.isComplete}
          ratingMap={ratingMap} onClose={() => setFull(null)} openProfile={openProfile} />
      )}
    </div>
  );
}

export default ChampionshipTab;
