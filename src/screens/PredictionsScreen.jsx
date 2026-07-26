// Auto-genereret modul — udtrukket fra den tidligere monolitiske App.jsx.
import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Check, ChevronLeft, ChevronRight, ChevronUp, Users } from "lucide-react";
import { db } from "../lib/supabase.js";
import { currentRoundIndex, formatKickoff, groupIntoRounds, isLocked, isPlayed, liveInfo, pointsFor, buildRoundLockMap, roundLockKey, LOCK_LEAD_MS, stageBadgeLabel } from "../lib/scoring.js";
import { C, chip, font, muted, pagerBtn, thStyle } from "../ui/theme.js";
import { BackBar, Card, FinalBadge, H, PlayerName, PointsPill, ScoreInput } from "../ui/components.jsx";

// ---------- tid: datoen står i dagens overskrift, rækken viser kun klokkeslæt ----------
function hhmm(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });
}
function dayKey(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
// Dag-overskrift, fx "lør 25. jul" (uppercase sættes i style). Danske korte navne
// ender på punktum ("lør." / "jul."), som bliver støjende i en versal overskrift.
function dayLabel(iso) {
  const d = new Date(iso);
  const wd = d.toLocaleDateString("da-DK", { weekday: "short" }).replace(/\.$/, "");
  const dm = d.toLocaleDateString("da-DK", { day: "numeric", month: "short" }).replace(/\.$/, "");
  return `${wd} ${dm}`;
}
// Gruppér rundens kampe pr. kampdag, så datoen står ÉN gang i stedet for på hver
// række. Kampene er allerede sorteret på kickoff (groupIntoRounds); kampe uden
// kickoff samles i en sidste bucket.
function groupIntoDays(matches) {
  const days = [];
  const byKey = new Map();
  for (const m of matches) {
    const key = dayKey(m.kickoff_at) || "?";
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { key, label: m.kickoff_at ? dayLabel(m.kickoff_at) : "Tid ikke fastlagt", matches: [] };
      byKey.set(key, bucket);
      days.push(bucket);
    }
    bucket.matches.push(m);
  }
  return days.sort((a, b) => (a.key === "?" ? 1 : b.key === "?" ? -1 : 0));
}
// "3 t 12 min" / "12 min"
function fmtLeft(ms) {
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return hours > 0 ? `${hours} t ${mins} min` : `${mins} min`;
}
// Deadline-tekst: relativ nedtælling tæt på, absolut tid når der er mere end et døgn
// til. Vises ALTID — før blev strengen skjult >24 t ude, hvilket var forsvarligt
// dengang den stod på hver række, men nu står den ét sted, og så er tavshed bare
// manglende information.
function lockLabel(deadlineMs, prefix = "Låser") {
  const msLeft = deadlineMs - Date.now();
  if (msLeft <= 0) return null;
  return msLeft <= 24 * 3600 * 1000
    ? `${prefix} om ${fmtLeft(msLeft)}`
    : `${prefix} ${formatKickoff(new Date(deadlineMs).toISOString())}`;
}

// Rundehoved: rundelabel + pager på én linje, og rundens status (deadline, lås,
// tippet-tæller, point) på én dæmpet linje under. Deadline hører til runden — ikke
// til hver enkelt kamp — så den står KUN her.
// (Bevidst ikke den delte RoundPager: den bruges uændret af AdminScreen.)
function RoundHeader({ rounds, index, setIndex, status, hint }) {
  const round = rounds[index];
  const canPrev = index > 0;
  const canNext = index < rounds.length - 1;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          flex: 1, minWidth: 0, fontFamily: font.display, textTransform: "uppercase",
          fontWeight: 700, fontSize: 18, lineHeight: 1.1, color: C.text,
        }}>
          Runde {round.label}
        </div>
        <span style={{ color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>{index + 1}/{rounds.length}</span>
        <button style={{ ...pagerBtn(canPrev), padding: "4px 8px" }} disabled={!canPrev}
          aria-label="Forrige runde" onClick={() => setIndex(index - 1)}><ChevronLeft size={16} /></button>
        <button style={{ ...pagerBtn(canNext), padding: "4px 8px" }} disabled={!canNext}
          aria-label="Næste runde" onClick={() => setIndex(index + 1)}><ChevronRight size={16} /></button>
      </div>
      {status && <div style={{ color: C.muted, fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>{status}</div>}
      {/* Forklaringslinjen står ÉT sted for hele runden i stedet for en "Alles gæt"-knap
          på hver eneste række. Samme greb som under stillingstabellen i BoardScreen:
          sig hvad der kan trykkes på, frem for at håbe rækken selv afslører det. */}
      {hint && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.muted, fontSize: 11.5, marginTop: 5, lineHeight: 1.3 }}>
          <Users size={13} style={{ flexShrink: 0 }} />
          {hint}
        </div>
      )}
    </div>
  );
}

const scoreChip = (extra) => ({
  fontSize: 14, fontWeight: 700, padding: "4px 9px", borderRadius: 8,
  whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace", ...extra,
});

// ---------- den låste rækkes kolonner ----------
// Tid/status · holdnavn (elastisk) · gæt · facit · point · chevron. Bredderne er
// målt til det, tallene faktisk fylder — hvert sparet pixel går til holdnavnet,
// som er det eneste, der kan blive for langt. Overskrifterne (GÆT/FACIT/P) står
// én gang øverst i runden, så de tre tal ikke længere skal gættes fra hukommelsen.
const ROW_COLS = "36px minmax(0,1fr) 25px 38px 26px 14px";
const ROW_GAP = 4;
const rowGrid = {
  display: "grid", gridTemplateColumns: ROW_COLS, gap: ROW_GAP,
  alignItems: "center", minHeight: 42, width: "calc(100% + 12px)",
  padding: "8px 6px", margin: "0 -6px", borderRadius: 8, textAlign: "left",
};
const cellCenter = { textAlign: "center", fontSize: 13, fontFamily: "ui-monospace, monospace" };

// Holdnavnene sættes i appens condensed display-skrift: den fylder ~25 % mindre end
// brødskriften, hvilket er præcis det, der får kampen til at rummes på ÉN linje.
// Passer navnet alligevel ikke, falder skriften ét trin ad gangen — og først når
// trinene er brugt op, ombrydes der. Der trunkeres aldrig: et afkortet holdnavn er
// skjult information (samme regel som før kompakteringen).
const NAME_STEPS = [15, 13.5, 12.5];
function TeamNames({ home, away }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.whiteSpace = "nowrap";
      let i = 0;
      for (; i < NAME_STEPS.length; i++) {
        el.style.fontSize = `${NAME_STEPS[i]}px`;
        if (el.scrollWidth <= el.clientWidth + 0.5) break;
      }
      el.style.whiteSpace = i < NAME_STEPS.length ? "nowrap" : "normal";
    };
    fit();
    // Kun bredde-ændringer må udløse en ny måling: fit() ændrer selv højden, så et
    // ubetinget kald her ville løbe i ring.
    let lastW = -1;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w === lastW) return;
      lastW = w;
      fit();
    });
    ro.observe(el);
    // Skriften hentes asynkront; uden dette måles fallback-skriftens bredde, som er
    // bredere — så en række ville ombryde unødigt indtil næste render.
    if (document.fonts?.ready) document.fonts.ready.then(fit).catch(() => {});
    return () => ro.disconnect();
  });
  return (
    <span ref={ref} style={{
      fontFamily: font.display, fontWeight: 600, color: C.text,
      // Marginen (ikke padding) gør selve boksen smallere, så måleren ovenfor regner
      // luften med og navnet aldrig lander klods op ad gæt-tallet.
      minWidth: 0, overflow: "hidden", lineHeight: 1.2, marginRight: 4,
    }}>
      {home} – {away}
    </span>
  );
}

// Én kamp på to linjer (én, hvis der intet mærke er at vise): klokkeslæt + hold til
// venstre, tip-felter og resultat til højre. Ligger bevidst på MODUL-niveau: defineret
// inde i PredictionsScreen ville komponenten få ny type ved hver render, så React
// unmountede rækken hvert minut (live-tikket) og et fokuseret scorefelt mistede fokus
// midt i indtastningen.
function MatchRow({
  m, pred, rules, homeName, awayName, locked, played, live, notOpenUntil, openLabel, countdown,
  showFinal, saved, err, onSave, expanded, onToggleExpanded, participants, matchPreds, userId, last, openProfile,
}) {
  const hasPred = pred.pred_home !== null && pred.pred_away !== null;
  const pts = played ? pointsFor(pred, m, rules) : null;
  const exact = played && hasPred && pred.pred_home === m.home_score && pred.pred_away === m.away_score;
  const correctOutcome = played && pts !== null && pts > 0;
  const stage = stageBadgeLabel(m.stage_name);
  const canExpand = locked && participants.length > 1;
  // Anden linje vises nu kun til det, der IKKE kan bo i en kolonne: stage-mærket,
  // rækkens egen deadline (kun ved flere turneringer i samme runde) og slettefejl.
  // "Slut", "Live" og "Alles gæt" er flyttet ind i rækken selv.
  const hasMeta = !!(stage || countdown || openLabel || err);

  // Tid/status-kolonnen bærer kampens tilstand: en færdigspillet kamps kickoff er
  // lav værdi, når facit står i samme række, og et spilleminut er lige så tydeligt
  // her som i en badge på en linje for sig.
  const status = played && showFinal ? <FinalBadge />
    : live && live.label === "Pause" ? <span style={{ color: C.red, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>Pause</span>
    : live ? (
      <span style={{ color: C.red, fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3, whiteSpace: "nowrap" }}>
        <span className="livedot" style={{ width: 6, height: 6, borderRadius: "50%", background: C.red, flexShrink: 0 }} />
        {live.label}
      </span>
    ) : <span style={{ color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>{played ? "" : hhmm(m.kickoff_at) || "–"}</span>;

  // Den låste række: seks kolonner, én linje. Hele rækken er tryk-fladen for
  // "alles gæt" — en låst række har ingen indtastningsfelter at komme i vejen for,
  // og et 14 px chevron ville være alt for lille et mål for en finger (jf. den
  // samme fejl i stillingens drill-in). Chevronet er kun det synlige tegn.
  const lockedCells = (
    <>
      {status}
      <TeamNames home={homeName} away={awayName} />
      <span style={{ ...cellCenter, color: C.muted }}>{hasPred ? `${pred.pred_home}-${pred.pred_away}` : "–"}</span>
      <span style={{ textAlign: "center" }}>
        {played ? (
          // Facit følger samme nuance som pointpillen (og "Sådan virker det"):
          // præcist hit = fuld grøn + guldkant, korrekt udfald = blød grøn,
          // forkert = rød. Så har hele rækken ÉN farve, der siger hvor godt det gik.
          <span style={scoreChip({
            fontSize: 13, padding: "3px 5px",
            background: !hasPred ? C.surface2 : exact ? "rgba(34,197,94,0.18)" : correctOutcome ? "rgba(127,212,138,0.12)" : "rgba(239,91,91,0.18)",
            color: !hasPred ? C.muted : exact ? C.green : correctOutcome ? C.greenSoft : C.red,
            border: exact ? `2px solid ${C.gold}` : "1px solid transparent",
          })}>{m.home_score}-{m.away_score}</span>
        ) : live ? (
          // Live: nuværende stilling i neutral (rød-kantet) ramme — bevidst UDEN
          // point/farvekodning, for point afgøres først ved slutfløjt.
          <span style={scoreChip({
            fontSize: 13, padding: "3px 5px",
            background: "rgba(239,91,91,0.10)", color: C.text, border: `1px solid ${C.red}`,
          })}>{live.homeScore}-{live.awayScore}</span>
        ) : null}
      </span>
      <span style={{ textAlign: "center" }}>{played && hasPred && <PointsPill pts={pts} />}</span>
      <span style={{ color: C.gold, display: "inline-flex", justifyContent: "flex-end" }}>
        {canExpand && (expanded ? <ChevronUp size={14} /> : <ChevronRight size={14} />)}
      </span>
    </>
  );

  return (
    <div style={{ borderBottom: last ? "none" : `1px solid ${C.line}` }}>
      {locked ? (
        canExpand ? (
          <button type="button" className="tiprow" onClick={onToggleExpanded} aria-expanded={expanded}
            aria-label={expanded ? "Skjul alles gæt" : `Vis alles gæt for ${homeName} mod ${awayName}`}
            style={{ ...rowGrid, background: "none", border: "none", cursor: "pointer", fontFamily: font.body, color: C.text }}>
            {lockedCells}
          </button>
        ) : (
          <div style={rowGrid}>{lockedCells}</div>
        )
      ) : (
        /* Åben runde: rækken skal rumme to indtastningsfelter, så den beholder sin
           flex-form. Kolonne-hovedet vises kun for låste runder, hvor der er noget
           at stille op i kolonner. */
        <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40, padding: "7px 0" }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>{hhmm(m.kickoff_at) || "–"}</span>
            {/* Ombryder frem for at trunkere: et afkortet holdnavn er skjult information. */}
            <span style={{ color: C.text, fontWeight: 600, fontSize: 14, lineHeight: 1.25, minWidth: 0 }}>
              {homeName} – {awayName}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <ScoreInput value={pred.pred_home} onChange={(v) => onSave(m.id, "pred_home", v)} disabled={!!notOpenUntil} />
            <span style={{ color: C.muted, fontSize: 12 }}>-</span>
            <ScoreInput value={pred.pred_away} onChange={(v) => onSave(m.id, "pred_away", v)} disabled={!!notOpenUntil} />
            {/* Fast slot, så felterne ikke hopper når ✓ kommer og går. */}
            <span style={{ width: 16, display: "inline-flex", justifyContent: "center" }}>
              {saved && <Check size={15} style={{ color: C.green }} />}
            </span>
          </div>
        </div>
      )}

      {/* Linje 2: kun det, der ikke kan bo i en kolonne. Renderes derfor sjældent. */}
      {hasMeta && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
          {stage && (
            <span style={{ background: C.surface2, color: C.gold, fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 999, whiteSpace: "nowrap" }}>
              {stage}
            </span>
          )}
          {/* Kun ved flere lås-grupper i samme runde (flere turneringer): så gælder
              rundehovedets tid ikke alle kampe, og rækken må selv sige det. */}
          {countdown && <span style={{ color: C.gold, fontSize: 11 }}>{countdown}</span>}
          {openLabel && <span style={{ color: C.muted, fontSize: 11 }}>{openLabel}</span>}
          {err && <span style={{ fontSize: 11, color: C.red }}>Kunne ikke slette</span>}
        </div>
      )}

      {expanded && (
        <div style={{ margin: "2px 0 8px", padding: "8px 10px", background: C.surface2, borderRadius: 10 }}>
          {participants.map((p) => {
            const pp = matchPreds.find((x) => x.user_id === p.id);
            const ppts = played && pp ? pointsFor(pp, m, rules) : null;
            return (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", fontSize: 12 }}>
                <span style={{ color: p.id === userId ? C.gold : C.text, fontWeight: p.id === userId ? 700 : 400, flex: 1, minWidth: 0 }}>
                  <PlayerName userId={p.id} name={p.display_name} onOpenProfile={openProfile} truncate />
                </span>
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ color: C.text, fontFamily: "ui-monospace, monospace" }}>{pp ? `${pp.pred_home}-${pp.pred_away}` : "–"}</span>
                  {ppts !== null && <PointsPill pts={ppts} />}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PredictionsScreen({ token, userId, competitions, leagues = [], initialFilter, initialRoundKey, onBack, openProfile }) {
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
        const ms = await db.select(token, "matches", `id=in.(${ids.join(",")})&select=*&order=kickoff_at`);
        if (!cancelled) setAllMatches(ms);
      } catch (e) { /* prøver igen om et minut */ }
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

  // ---------- rundens ÉNE statuslinje ----------
  // Deadline, lås og "åbner" er runde-egenskaber (låsen er nøglet på season_id+round_key),
  // så de hører ét sted hen. Før stod den identiske nedtælling på hver eneste kamprække.
  const roundInfo = (() => {
    if (!round) return null;
    const ms = round.matches;

    // Lås-grupper i den viste runde. groupIntoRounds grupperer på round_key alene,
    // mens låsen er (season_id, round_key) — med flere turneringer i samme kalenderuge
    // kan én vist runde derfor have flere deadlines. Er de forskellige, viser hovedet
    // den tidligste, og rækkerne får deres egen tid tilbage (mixedTiming).
    const deadlines = [...new Set(ms.map(roundLockKey))]
      .map((k) => roundLockMap.get(k))
      .filter((t) => t != null)
      .map((t) => t - LOCK_LEAD_MS);
    const deadline = deadlines.length ? Math.min(...deadlines) : null;
    const opens = ms.map((m) => opensAt(m));
    const mixedTiming = new Set(deadlines).size > 1
      || (opens.some(Boolean) && opens.some((o) => !o));

    const parts = [];
    const hasPred = (m) => {
      const p = preds[m.id];
      return !!(p && p.pred_home != null && p.pred_away != null);
    };
    const playedCount = ms.filter(isPlayed).length;
    const allPlayed = ms.length > 0 && playedCount === ms.length;
    // "Slut" på hver række er ren gentagelse, når hele runden er spillet og hver række
    // har sit facit-chip; i en blandet runde er mærket derimod den hurtige adskiller.
    const showFinal = !allPlayed;

    if (allPlayed) {
      const pts = ms.reduce((sum, m) => sum + (pointsFor(preds[m.id], m, rules) ?? 0), 0);
      parts.push(`Spillet · ${pts} point`);
      return { status: parts.join(" · "), mixedTiming, showFinal };
    }

    const notOpenAtAll = ms.length > 0 && opens.every(Boolean);
    if (notOpenAtAll) {
      const openTime = Math.min(...opens.map((o) => o.getTime()));
      parts.push(`Åbner ${formatKickoff(new Date(openTime).toISOString())}`);
      return { status: parts.join(" · "), mixedTiming, showFinal };
    }

    const tippable = ms.filter((m, i) => !isPlayed(m) && !isLocked(m, roundLockMap) && !opens[i]);
    if (!tippable.length) {
      // Runden er låst (eller helt uden tipbare kampe): vis hvad der nåede at komme ind.
      parts.push(`Låst · ${ms.filter(hasPred).length} af ${ms.length} tippet`);
      if (playedCount) parts.push(`${playedCount}/${ms.length} spillet`);
      return { status: parts.join(" · "), mixedTiming, showFinal };
    }

    parts.push(`${tippable.filter(hasPred).length} af ${tippable.length} tippet`);
    if (deadline != null) {
      // Har runden flere lås-grupper, gælder tiden ikke alle kampe — sig "Næste lås",
      // og lad hver række bære sin egen tid (mixedTiming nedenfor).
      const lockText = lockLabel(deadline, mixedTiming ? "Næste lås" : "Låser");
      if (lockText) parts.push(lockText);
    }
    return { status: parts.join(" · "), mixedTiming, showFinal };
  })();

  const days = useMemo(() => (round ? groupIntoDays(round.matches) : []), [round]);

  // Kolonne-hovedet og forklaringslinjen hører til den LÅSTE runde: først dér findes
  // der et facit og et point at stille op i kolonner, og først dér kan man se andres
  // gæt (canExpand = locked). En åben runde er ren indtastning og får hverken.
  const anyLocked = !!round && round.matches.some((m) => isLocked(m, roundLockMap));
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
        <p style={muted}>Opret eller deltag i en konkurrence først.</p>
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
          {/* Nævn kun filteret, hvis der FINDES et filter at skrue på — ellers får
              brugeren skylden for et valg, skærmen ikke engang viser. */}
          {!loading && rounds.length === 0 && (
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
              {anyLocked && (
                <div style={{
                  display: "grid", gridTemplateColumns: ROW_COLS, gap: ROW_GAP, alignItems: "center",
                  padding: "2px 0 6px", borderBottom: `1px solid ${C.line}`,
                }}>
                  <span /><span />
                  {["Gæt", "Facit", "P"].map((h) => (
                    <span key={h} style={{ ...thStyle, textAlign: "center", fontSize: 11 }}>{h}</span>
                  ))}
                  <span />
                </div>
              )}
              {days.map((day, di) => (
                <div key={day.key}>
                  <div style={{
                    fontFamily: font.display, textTransform: "uppercase", letterSpacing: "0.08em",
                    fontSize: 11, color: C.muted, marginTop: di === 0 ? 0 : 12, marginBottom: 2,
                  }}>
                    {day.label}
                  </div>
                  {day.matches.map((m, mi) => {
                    const locked = isLocked(m, roundLockMap);
                    const notOpenUntil = !locked ? opensAt(m) : null;
                    // Nedtælling pr. række KUN når runden har flere forskellige deadlines
                    // (flere turneringer i samme kalenderuge) — ellers står tiden én gang
                    // i rundehovedet. I det tilfælde får HVER række sin egen tid, også når
                    // der er mere end et døgn til, så ingen række er tavs om sin deadline.
                    let countdown = null;
                    if (roundInfo?.mixedTiming && !locked && !notOpenUntil) {
                      const earliest = roundLockMap.get(roundLockKey(m));
                      if (earliest != null) countdown = lockLabel(earliest - LOCK_LEAD_MS);
                    }
                    return (
                      <MatchRow
                        key={m.id}
                        m={m}
                        pred={preds[m.id] || { pred_home: null, pred_away: null }}
                        rules={rules}
                        homeName={teamsById[m.home_team_id]}
                        awayName={teamsById[m.away_team_id]}
                        locked={locked}
                        played={isPlayed(m)}
                        live={liveInfo(m)}
                        notOpenUntil={notOpenUntil}
                        openLabel={roundInfo?.mixedTiming && notOpenUntil ? `Åbner ${formatKickoff(notOpenUntil.toISOString())}` : null}
                        countdown={countdown}
                        showFinal={roundInfo?.showFinal !== false}
                        saved={!!savedIds[m.id]}
                        err={!!errIds[m.id]}
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
export { MatchRow, RoundHeader, TeamNames, ROW_COLS, ROW_GAP };
