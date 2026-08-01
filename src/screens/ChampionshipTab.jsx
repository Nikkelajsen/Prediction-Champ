// Championship-fanen: de officielle konkurrencer, hvor alle er med automatisk.
// Rundeliga, månedsliga og sæsonchampionship — hver med sin kåring.
import { useState, useEffect, useMemo } from "react";
import { Crown, ChevronLeft, ChevronRight } from "lucide-react";
import { currentMonthKey, loadMonthlyBoard, loadMonthsAvailable, loadRatingMap, loadRoundsAvailable, loadRoundBoard, loadSeasonBoard, monthName } from "../lib/data.js";
import { roundLabel } from "../lib/scoring.js";
import { joinNames, leaders } from "../lib/standings.js";
import { C, font, muted, pagerBtn, thStyle } from "../ui/theme.js";
import { Card, Eyebrow, H, InfoDot, Modal, PlayerName } from "../ui/components.jsx";

// Kolonne-forklaringen under stillingerne. Hele tiebreaker-stigen står i InfoDot'en
// og på "Sådan virker det" — her nævnes kun det, tabellen faktisk viser, og først
// når der rent faktisk ér en delt placering at forklare.
const TIEBREAK_HINT = (rows) =>
  "🎯 = præcise resultater" + (rows.some((r) => r.shared) ? " · ens placering = delt" : "");

// Stilling i samme format som liga (BoardScreen): en rigtig tabel med kolonne-
// overskrifter, så 🎯 (præcise resultater) er en kolonne-header i stedet for at
// stå på hver række. Placeringen kommer fra rækkens `rank` (ægte, delt placering
// sat af assignRanks) — ikke fra listeindekset, som ville vise to lige spillere
// som "3." og "4.".
export function StandingsTable({ rows, userId, isComplete, ratingMap, openProfile }) {
  return (
    <table style={{ tableLayout: "fixed", width: "100%" }}>
      <colgroup>
        <col style={{ width: 26 }} />
        <col />
        <col style={{ width: 50 }} />
        <col style={{ width: 30 }} />
        <col style={{ width: 52 }} />
      </colgroup>
      <thead><tr className="rowline">
        <th style={{ ...thStyle, padding: "8px 2px" }}>#</th>
        <th style={{ ...thStyle, padding: "8px 4px" }}>Spiller</th>
        <th style={{ ...thStyle, textAlign: "center", padding: "8px 2px" }} title="Prediction Champ Rating">Rating</th>
        <th style={{ ...thStyle, textAlign: "center", padding: "8px 2px" }} title="Antal præcise resultater">🎯</th>
        <th style={{ ...thStyle, textAlign: "right", padding: "8px 2px" }}>Point</th>
      </tr></thead>
      <tbody>
        {rows.map((r) => {
          const you = r.userId === userId;
          const rt = ratingMap?.get(r.userId);
          const top = r.rank === 1;
          return (
            <tr key={r.userId} className="rowline" style={{ background: you ? "rgba(34,197,94,0.06)" : "transparent" }}>
              <td style={{ color: top ? C.gold : C.muted, fontWeight: 700, whiteSpace: "nowrap", fontFamily: font.display, padding: "8px 2px" }}>
                {top && isComplete ? "🏆" : r.rank}
              </td>
              <td style={{ color: C.text, fontWeight: you ? 700 : 600, padding: "8px 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <PlayerName userId={r.userId} name={r.player} you={you} onOpenProfile={openProfile} truncate />
              </td>
              <td style={{ textAlign: "center", whiteSpace: "nowrap", padding: "8px 2px" }}>
                {rt
                  ? <span style={{ color: C.gold, fontWeight: 700, fontSize: 13 }}>{rt.rating}{rt.provisional ? <span style={{ color: C.muted, fontWeight: 400 }} title="Foreløbig">*</span> : ""}</span>
                  : <span style={{ color: C.muted, fontSize: 13 }}>–</span>}
              </td>
              <td style={{ textAlign: "center", color: C.text, fontSize: 13, padding: "8px 2px" }}>{r.exactCount}</td>
              <td style={{ textAlign: "right", padding: "8px 2px" }}>
                <span style={{ background: top ? "rgba(240,180,41,0.15)" : C.surface2, color: top ? C.gold : C.text, fontSize: 15, fontWeight: 700, borderRadius: 999, padding: "3px 8px" }}>{r.total}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Fuld stilling i modal med paginering (maks. 20 pr. side).
function FullStandingsModal({ title, rows, userId, isComplete, ratingMap, onClose, openProfile }) {
  const [page, setPage] = useState(0);
  const perPage = 20;
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const start = page * perPage;
  const slice = rows.slice(start, start + perPage);
  return (
    <Modal title={title} onClose={onClose}>
      <StandingsTable rows={slice} userId={userId} isComplete={isComplete} ratingMap={ratingMap} openProfile={openProfile} />
      {pages > 1 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
          <button style={pagerBtn(page > 0)} disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronLeft size={16} /></button>
          <span style={{ color: C.muted, fontSize: 12 }}>Side {page + 1} af {pages}</span>
          <button style={pagerBtn(page < pages - 1)} disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}><ChevronRight size={16} /></button>
        </div>
      )}
      <p style={{ ...muted, marginTop: 10, marginBottom: 0, fontSize: 11 }}>{TIEBREAK_HINT(rows)}</p>
    </Modal>
  );
}

// Kåringen øverst på hvert kort. Titlen kan deles: er to spillere ægte lige hele
// tiebreaker-stigen ned, er de begge champ — så nævner banneret dem begge frem for
// at lade en skjult nøgle udpege en vinder, tabellen ikke kan forklare.
export function Champions({ rows, title, isComplete, openProfile }) {
  const top = leaders(rows);
  if (!top.length) return null;
  const shared = top.length > 1;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, background: "rgba(240,180,41,0.1)",
      border: `1px solid rgba(240,180,41,0.35)`, borderRadius: 10, padding: "8px 12px", marginBottom: 10,
    }}>
      <Crown size={16} color={C.gold} />
      <span style={{ fontSize: 13 }}>
        {top.map((r, i) => (
          <span key={r.userId}>
            {i > 0 && (i === top.length - 1 ? " og " : ", ")}
            <b><PlayerName userId={r.userId} name={r.player} onOpenProfile={openProfile} /></b>
          </span>
        ))}
        {" "}
        {isComplete
          ? (shared ? `er delt ${title}` : `er ${title}`)
          : (shared ? "deler føringen lige nu" : "fører lige nu")}
      </span>
    </div>
  );
}

// Kort-visning: top 5 i tabel-format + link til fuld stilling, når der er flere.
function Standings({ rows, userId, isComplete, ratingMap, title, onOpenFull, openProfile }) {
  return (
    <>
      <StandingsTable rows={rows.slice(0, 5)} userId={userId} isComplete={isComplete} ratingMap={ratingMap} openProfile={openProfile} />
      {rows.length > 5 && (
        <p style={{ ...muted, marginTop: 8, marginBottom: 0, cursor: "pointer", textDecoration: "underline" }}
          onClick={() => onOpenFull({ title, rows, isComplete })}>
          Vis hele stillingen ({rows.length}) →
        </p>
      )}
      <div style={{ color: C.muted, fontSize: 11, marginTop: 8 }}>{TIEBREAK_HINT(rows)}</div>
    </>
  );
}

// Hvilken turnering skal sæsonchampionshippet vise, når der er mere end én?
//
// Erstatter det gamle `/superliga/i`-regex — den eneste reelle hardkodning i
// UI'et (drejebogen `docs/features/turnering-2.md` §3.2). Rækkefølgen er:
// brugerens eget valg, hvis turneringen stadig findes → ellers den turnering
// appen startede med.
//
// `created_at` frem for navn er et bevidst valg: `leagues` kommer sorteret på
// navn, og alfabetet ville gøre "Scotland Premiership" til forvalg foran
// "Superligaen" i det øjeblik turnering #2 blev synlig. Den ældste turnering er
// den, appen blev bygget om — det er et stabilt svar, som ingen skal huske at
// vedligeholde i en kolonne.
export function pickSeasonLeague(leagues, savedId) {
  const list = leagues || [];
  if (!list.length) return null;
  return list.find((l) => l.id === savedId)
    || list.slice().sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""))[0];
}

// Brugerens valg i sæsonvælgeren. localStorage kan være utilgængelig (privat
// browsing, blokerede cookies), så begge veje er pakket ind — samme greb som
// LigaerTab's nudge.
const SEASON_LEAGUE_KEY = "pc_season_league";
function readSeasonLeagueId() {
  try { return localStorage.getItem(SEASON_LEAGUE_KEY); } catch { return null; }
}
function writeSeasonLeagueId(id) {
  try { localStorage.setItem(SEASON_LEAGUE_KEY, id); } catch { /* utilgængelig — spring over */ }
}

// Championship har to niveauer, og navnet bærer forskellen: kun den SAMLEDE
// stilling hedder "Prediction Champ". En turneringsstilling er "Månedens bedste
// i Superligaen" — rangordenen ligger dermed i sproget og kræver ingen
// forklaring i UI'et. (Sæsonchampionshippet er en bevidst undtagelse: det er
// turneringsbundet af natur og har ingen samlet modpart at forveksles med.)
export function boardTitle(kind, league) {
  const what = kind === "round" ? "Rundens" : "Månedens";
  return league ? `${what} bedste i ${league.name}` : `${what} Prediction Champ`;
}

// Scope-værdien, loaderne og DB-viewene bruger: 'ALL' = alle officielle
// turneringer samlet, ellers turneringens id.
const ALL_SCOPE = "ALL";

// Kortets overskriftsrække: titel til venstre, filtre til højre.
//
// Rækken var en `space-between`-flex UDEN ombrydning, og det holdt kun, så længe
// der var ét filter. Med turnering #2 kom turneringsvælgeren til, og to selects
// ved siden af en tre-linjers titel kunne ikke være der: appen er maks. 430 px
// bred (`phone` i theme.js), en `<select>` er så bred som sin bredeste option
// ("Scotland Premiership"), og en flex-item krymper aldrig under sit indhold,
// når `min-width` står på `auto`. Filtrene skød derfor ud over kortets højre
// kant på telefonen.
//
// To greb, i den rækkefølge de træder i kraft: rækken BRYDER, så filtrene falder
// ned på deres egen linje under titlen, når de ikke kan være ved siden af den —
// og først når selv den linje er for smal, må hver select krympe (`minWidth: 0`)
// frem for at stikke ud. Højrestillingen bevares gennem begge trin, så filtrene
// står samme sted, uanset om de deler linje med titlen.
//
// `flex: "1 1 60%"` er det, der gør bruddet betinget frem for fast: titlen beder
// om 60 % af bredden, så en smal ledsager — fremdrifts-tælleren "12/306 spillet"
// — stadig får plads ved siden af den, mens to dropdowns ikke kan presses ind på
// de sidste 40 % og derfor falder ned.
//
// Titlen er `display: block`, ikke flex, så ⓘ'en flyder med som et ord efter det
// sidste ord frem for at blive skubbet ud i højre kant af en linje, teksten ikke
// selv fylder. Prisen er, at den kan brydes NED alene — "Rundens Prediction
// Champ" fylder præcis én linje på en iPhone, og så stod ⓘ'en for sig selv på
// den næste. Derfor er sidste ord og ikonet bundet sammen i én `nowrap`-enhed:
// de flytter linje sammen. Titlen tages som tekst og ikonet som `info` netop for
// at gøre den binding mulig — en færdig JSX-titel kan man ikke finde sidste ord i.
export function CardHead({ title, info, children }) {
  const words = String(title).split(" ");
  const last = words.pop();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <div style={{
        fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase",
        lineHeight: 1.15, flex: "1 1 60%", minWidth: 0,
      }}>
        {words.length > 0 && `${words.join(" ")} `}
        <span style={{ whiteSpace: "nowrap" }}>{last}{info && <>{" "}{info}</>}</span>
      </div>
      {children && (
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: 6, flex: "0 1 auto", minWidth: 0, marginLeft: "auto" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// Fælles udseende for kortenes filter-dropdowns. `minWidth: 0` er det, der
// tillader den sidste krympning; `maxWidth: "100%"` holder en enkelt lang
// turnering inde på sin egen linje frem for at lade den skubbe linjen bredere.
const filterSelect = { padding: "4px 8px", fontSize: 12, minWidth: 0, maxWidth: "100%" };

// Hvorfor en turnering kan udelades. Hører hjemme i en InfoDot og ikke på
// kortet: begrundelsen er A2's egen — et tal, hvis betydning skifter, når
// produktet vokser, kan ikke sammenlignes med sig selv.
const WHY_NOT_ALL = "En turnering kan tippes, uden at den afgør titler. "
  + "Det er derfor en titel betyder det samme, før og efter en ny turnering er kommet til.";

// En turnering kan være synlig og tipbar uden at fodre Championship
// (`leagues.is_visible = true`, `is_official = false` — se sql/tournament_scope.sql).
// Den udelades derfor af stillingerne, og indtil nu blev den udeladt *tavst*:
// vælgeren og "To niveauer"-forklaringen er begge gated på mere end én officiel
// turnering, så med præcis én officiel og én uofficiel viste fanen ingen af
// delene. En bruger, der havde tippet den uofficielle turnering, så sine point
// tælle i konkurrencen og i ratingen — og forsvinde her, uden ét ord om hvorfor.
//
// Sætningen navngiver derfor begge sider, og den siger, hvor pointene så bliver
// af: en udeladelse, der ikke gør det, ligner et tab. Reglen er den fra 30.
// juli — et tal skal navngive sit eget omfang i den sætning, det står i, og en
// InfoDot må uddybe, men aldrig alene bære det, der skal til for at læse tallet
// rigtigt. Uden officielle turneringer er der ingen stilling at forklare.
//
// A17 (31. juli 2026) gjorde sætningen KORTERE: ratingen filtrerer nu også på
// `is_official`, så en uofficiel turnering tæller ét sted i stedet for to. Den
// første udgave måtte skrive "…og i din rating, men tæller ikke med her", altså
// en ledsætning om, at "officiel" betød noget forskelligt på to skærme. At den
// ledsætning var nødvendig, var i sig selv et af argumenterne for A17.
export function scopeNote(official, unofficial) {
  if (!official?.length || !unofficial?.length) return null;
  return `Championship afgøres af ${joinNames(official.map((l) => l.name))}. `
    + `${joinNames(unofficial.map((l) => l.name))} kan tippes og giver point i din konkurrence, `
    + `men tæller hverken i Championship eller i rating.`;
}

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

  const [seasonLeagueId, setSeasonLeagueId] = useState(readSeasonLeagueId);
  const seasonLeague = useMemo(() => pickSeasonLeague(officialLeagues, seasonLeagueId), [officialLeagues, seasonLeagueId]);

  const [roundScope, setRoundScope] = useState(ALL_SCOPE);
  const [monthScope, setMonthScope] = useState(ALL_SCOPE);
  const roundLeague = officialLeagues.find((l) => l.id === roundScope) || null;
  const monthLeague = officialLeagues.find((l) => l.id === monthScope) || null;

  useEffect(() => {
    loadRatingMap(token).then(setRatingMap).catch(() => setRatingMap(new Map()));
  }, [token]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setRows(null);
      const ms = await loadMonthsAvailable(token, monthScope);
      const list = ms.length ? ms : [currentMonthKey()];
      setMonths(list);
      const chosen = list.includes(month) ? month : list[0];
      setMonth(chosen);
      setRows(await loadMonthlyBoard(token, chosen, monthScope));
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
      const rs = await loadRoundsAvailable(token, roundScope);
      if (cancelled) return;
      setRounds(rs);
      if (rs.length) {
        setRoundKey(rs[0]);
        const b = await loadRoundBoard(token, rs[0], roundScope);
        if (!cancelled) setRoundBoard(b);
      } else {
        setRoundBoard({ rows: [], totalMatches: 0, playedMatches: 0, isComplete: false });
      }
    })();
    return () => { cancelled = true; };
  }, [token, roundScope]);

  async function changeMonth(m) {
    setMonth(m); setRows(null);
    setRows(await loadMonthlyBoard(token, m, monthScope));
  }

  async function changeRound(k) {
    setRoundKey(k); setRoundBoard(null);
    setRoundBoard(await loadRoundBoard(token, k, roundScope));
  }

  function changeSeasonLeague(id) {
    setSeasonLeagueId(id);
    writeSeasonLeagueId(id);
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

      {/* Rundeliga — Rundens Prediction Champ */}
      <Card>
        <CardHead title={boardTitle("round", roundLeague)} info={
          <InfoDot title={boardTitle("round", roundLeague)}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>Dine samlede point for én enkelt spillerunde. Alle er automatisk med. Ved pointlighed afgør flest præcise resultater, så flest korrekte udfald, og til sidst hvem der var tættest på — er to helt lige, deles titlen. Vælg en runde i dropdownen.</div>
              {officialLeagues.length > 1 && (
                <div><b>To niveauer:</b> "Alle turneringer" samler ugens kampe på tværs og kårer <b>Rundens Prediction Champ</b> — den store titel. Vælger du én turnering, ser du stillingen for netop den, hvor alle er målt på de samme kampe; dens vinder er "Rundens bedste i turneringen".</div>
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
              title={`Rundeliga${roundLeague ? ` · ${roundLeague.name}` : ""} · runde ${roundKey ? roundLabel(roundKey) : ""}`} onOpenFull={setFull} openProfile={openProfile} />
          </>
        )}
        {/* Står uden for stillingen med vilje: den tomme stilling ("Ingen point i
            denne runde endnu") er præcis den, en bruger med kun uofficielle tips
            ser — og dermed den, der har mest brug for sætningen. Ved et valgt
            scope navngiver overskriften allerede turneringen. */}
        {note && roundScope === ALL_SCOPE && <p style={{ ...muted, margin: "10px 0 0", fontSize: 11 }}>{note}</p>}
      </Card>

      {/* Månedsliga */}
      <Card>
        <CardHead title={boardTitle("month", monthLeague)} info={
          <InfoDot title={boardTitle("month", monthLeague)}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>Dine samlede point for alle månedens kampe (hver kamp tælles én gang). Ved pointlighed afgør flest præcise resultater, så flest korrekte udfald, så flest rundesejre, og til sidst hvem der var tættest på — er to helt lige, deles titlen. Alle er automatisk med, og stillingen nulstilles den 1. i hver måned.</div>
              {officialLeagues.length > 1 && (
                <div><b>To niveauer:</b> "Alle turneringer" samler månedens kampe på tværs og kårer <b>Månedens Prediction Champ</b> — den store titel. Vælger du én turnering, ser du stillingen for netop den, hvor alle er målt på de samme kampe.</div>
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
            title={`Månedsliga${monthLeague ? ` · ${monthLeague.name}` : ""} · ${monthName(month)}`} onOpenFull={setFull} openProfile={openProfile} />
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
        <CardHead title="Sæsonens Prediction Champ" info={
          <InfoDot title="Sæsonens Prediction Champ">Dine samlede point for alle kampe i {seasonLeague?.name || "turneringen"} i hele sæsonen. Én sæsonstilling pr. turnering i Championship — er der flere, vælges de i dropdownen. Alle er automatisk med. Ved pointlighed afgør flest præcise resultater, så flest korrekte udfald, så flest rundesejre, og til sidst hvem der var tættest på. Sæsonens bedste kåres som Sæsonens Prediction Champ — er to helt lige, deles titlen.
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
        {season === undefined && <p style={{ ...muted, margin: 0 }}>Sæsonens Prediction Champ er ikke tilgængelig endnu.</p>}
        {season && season.rows && season.rows.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen point i sæsonen endnu — stillingen fyldes, når kampene spilles.</p>}

        {season && season.rows && season.rows.length > 0 && (
          <>
            <Champions rows={season.rows} title="Sæsonens Prediction Champ" isComplete={season.isComplete} openProfile={openProfile} />
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
