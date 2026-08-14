// Hjem-fanen: dagens overblik. Deadline-kort, rating-snapshot, rundens
// live-oversigt, dine placeringer, rundens historie og opt-in til notifikationer.
//
// De tre kort-komponenter, fanen tegner med, bor i `./hjem/` siden `G1`
// (august 2026): opt-in-kortet, karusellen og placeringslisten. Ren flytning —
// de delte hverken state eller hjælpere med fanen, kun fil. Det, der er tilbage
// her, ER fanen: hvad hentes, i hvilken rækkefølge, og hvad tegnes hvornår.
import { useState, useEffect } from "react";
import { ChevronRight, Clock, Check, RefreshCw } from "lucide-react";
import { formatKickoff } from "../lib/scoring.js";
import { computeCurrentRound, computeHomeTips, currentMonthKey, daFullDate, dismissStory, fmtCountdown, loadDayCard, loadHomePlacements, loadLatestStory, loadRatingBoard, loadRatingHistory, ratingSnapshot } from "../lib/data.js";
import { isFresh, roundStorySuperseded, ROUND_STORY_MAX_AGE_MS } from "../lib/stories.js";
import { readUserFlag, writeUserFlag, readSeenStories, markStorySeen, CARD_KEY } from "../lib/localFlags.js";
import { C, btnGhost, btnGreen, font, iconBtn } from "../ui/theme.js";
import { usePushOptIn } from "../ui/usePushOptIn.js";
import { Card, Collapsible, Eyebrow, FoldChevron, H, InfoDot, LiveBadge, Move, PlayerName, PointsPill } from "../ui/components.jsx";
import GetStartedCard from "./GetStartedCard.jsx";
import PushOptInCard from "./hjem/PushOptInCard.jsx";
import DayCard from "./hjem/DayCard.jsx";
import RoundStory from "./hjem/RoundStory.jsx";
import Placements from "./hjem/Placements.jsx";
import { cardTight, shortKick } from "./hjem/shared.js";

function HjemTab({ token, userId, profile, competitions, goTab, openPredictions, openBoard, openGroup, openProfile, onboarding }) {
  const [tips, setTips] = useState(null);
  // `undefined` = ikke hentet endnu · `null` = hentet, men der ER ingen runde
  // (ingen konkurrencer, eller kaldet fejlede). Forskellen er ikke kosmetisk:
  // visningsreglen for rundestoryen nedenfor skal kunne holde kortet tilbage,
  // mens svaret er ukendt — men ikke når svaret er "ingen". Alle andre læsere
  // skriver `round && …`, og `undefined` er falsy, så de er urørte.
  const [round, setRound] = useState(undefined); // live-oversigt over indeværende runde
  const [roundOpen, setRoundOpen] = useState(false); // foldet som standard: viser kun X/Y + point
  const [snapshot, setSnapshot] = useState(null); // { rating, move, form, rank, total }
  const [placements, setPlacements] = useState(null); // [{ label, pos, gold, onClick }]
  // Story Engine v3: ÉT dagskort og én rundestory — ikke en karrusel.
  const [dayCard, setDayCard] = useState(null);
  const [roundStory, setRoundStory] = useState(null);
  const [seenStories, setSeenStories] = useState(() => readSeenStories(userId));
  const [, setTick] = useState(0);
  // Manuel genindlæsning (B13). Tælleren står i afhængighedslisterne for de tre
  // dataeffekter nedenfor, så et klik kører præcis de samme kald som en
  // montering — ingen dobbelt kodesti, der kan komme i utakt med den rigtige.
  const [reloadKey, setReloadKey] = useState(0);
  // Kortet kan skjules permanent; onboarding-tilstanden selv kommer fra MainApp,
  // så Hjem ikke skal hente brugerens ligaer en ekstra gang.
  const [cardHidden, setCardHidden] = useState(() => readUserFlag(CARD_KEY, userId) === "1");
  const push = usePushOptIn(token, userId);
  const showChecklist = !!onboarding && !onboarding.complete && !cardHidden;

  // Dagens kort og rundens story.
  //
  // Der er ingen rundenøgle at beregne længere. Karusellen skulle bindes til
  // den klient-beregnede runde, fordi den samlede kort op gennem ugen og skulle
  // tømmes ved rundeskift; ét kort, der udløber efter 48 timer, har ikke det
  // problem — tirsdagens tomhed opstår af sig selv.
  //
  // Milepæle hentes ikke mere: de får aldrig deres eget kort, men kaprer
  // dagens slot i databasen (grundvægt 100 i scoringen). Karriereprofilen
  // læser stadig milestones-tabellen direkte og er uberørt.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [day, round] = await Promise.all([
        loadDayCard(token),
        loadLatestStory(token),
      ]);
      if (cancelled) return;
      setDayCard(day);
      // Rundestoryen måles mod SIT eget loft (14 dage) og ikke mod dagskortets
      // 48 timer. Den lever, indtil den nye runde har noget at fortælle —
      // afløsningen sker i visningsreglen nedenfor, ikke ved et udløb.
      setRoundStory(round && isFresh(round, Date.now(), ROUND_STORY_MAX_AGE_MS) ? round : null);
    })();
    return () => { cancelled = true; };
  }, [token, reloadKey]);

  // VISNINGSREGLEN: rundestoryen taler, indtil noget nyere har noget at sige —
  // og "noget nyere" er TO ting, ikke én.
  //
  // 1) Et NYERE dagskort. Sammenligningen er på `created_at` og ikke på
  //    `day_key`/`round_key`, fordi det er SKRIVETIDSPUNKTET, der afgør hvad der
  //    er nyest at fortælle: en resultatrettelse i en gammel runde regenererer
  //    begge kort i samme triggersætning, og rundekortet skrives sidst.
  //
  // 2) VIRKELIGHEDEN ALENE — `roundStorySuperseded`. Indtil august 2026 stod der
  //    kun punkt 1 her, med den begrundelse at et nyere dagskort per konstruktion
  //    er fra den nye runde. Den påstand er sand, men den er for SMAL: et dagskort
  //    kræver en færdigspillet kampdag, mens stillingen flytter sig ved hvert
  //    enkelt slutfløjt. I hullet imellem stod rundekortet og påstod noget,
  //    STILLING-skærmen modsagde — rapporteret 7. august 2026, hvor kortet sagde
  //    "du er nu foran Lis04", mens Lis04 lå over brugeren i tabellen.
  //
  // `round !== undefined` er ikke en detalje: `computeCurrentRound` er fire
  // sekventielle kald og lander efter historierne. Uden porten ville kortet blive
  // vist og forsvinde igen et øjeblik senere — og `story_viewed` ville blive
  // logget for en visning, brugeren aldrig reelt fik.
  const roundIsNewer = roundStory
    && round !== undefined
    && !roundStorySuperseded(roundStory, round)
    && (!dayCard || String(roundStory.created_at || "") > String(dayCard.created_at || ""));

  function onSeen(id) {
    if (!id || seenStories.has(id)) return;
    setSeenStories(markStorySeen(userId, id));
  }

  // Kun rundestoryen kan afvises. Dagskortet har hverken Del eller Afvis:
  // det udløber af sig selv og erstattes hver kampdag.
  async function onDismissRound(item) {
    setRoundStory(null);
    if (item?.id) await dismissStory(token, item.id);
  }

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  // Indeværende runde: hentes ved mount og genindlæses hvert minut, så resultater/point
  // opdaterer løbende efterhånden som kampene spilles (results tikker ind via sync).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await computeCurrentRound(token, userId, competitions);
        if (!cancelled) setRound(r);
      } catch { if (!cancelled) setRound(null); }
    };
    load();
    const id = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token, userId, competitions, reloadKey]);  

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // deadline / manglende tips
      try {
        const t = await computeHomeTips(token, userId, competitions);
        if (!cancelled) setTips(t);
      } catch { if (!cancelled) setTips({ hasComps: competitions.length > 0, error: true }); }

      // rating-snapshot
      try {
        const [board, hist] = await Promise.all([loadRatingBoard(token), loadRatingHistory(token)]);
        if (!cancelled) setSnapshot(ratingSnapshot(board, hist, userId));
      } catch { if (!cancelled) setSnapshot({ none: true }); }

      // placeringer: månedschampionship + hver privat konkurrence. Reglerne —
      // ægte rank, spring en fejlende konkurrence over, skjulte kort tæller
      // ikke — bor i lib/data/home.js, hvor de kan efterprøves.
      try {
        const list = await loadHomePlacements(token, userId, competitions, currentMonthKey());
        if (!cancelled) setPlacements(list);
      } catch { if (!cancelled) setPlacements([]); }
    })();
    return () => { cancelled = true; };
  }, [token, userId, competitions, reloadKey]);  

  // "Henter" UDLEDES af, at placeringerne mangler, frem for at være sin egen
  // state med en effekt til at slukke den. Placeringerne er det tungeste kald
  // på skærmen og dermed det, der reelt afgør, hvornår den er frisk igen — og
  // en afledt værdi kan pr. konstruktion ikke komme i utakt med det, den
  // beskriver. Det gælder også den allerførste indlæsning, hvor knappen med
  // rette er optaget.
  const refreshing = placements === null;

  function refreshNow() {
    if (refreshing) return;
    setPlacements(null);
    setReloadKey((k) => k + 1);
  }

  const displayName = profile?.display_name || "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <Eyebrow>
            {daFullDate()}
            {/* Opdater-knappen sidder ved DATOEN og ikke ved rating-tallet.
                Grunden er, hvad den betyder: "hent skærmen igen", ikke "hent min
                rating igen" — og datoen er den ene linje på Hjem, der handler om
                hele siden. Runde-oversigten opdaterer sig selv hvert minut, men
                "Dine placeringer" og rating-snapshottet hentede kun ved
                montering, så en bruger med appen åben hele kampdagen — præcis
                den situation, produktet er bygget til — så forældede tal uden
                anden udvej end at genstarte appen (B13). */}
            <button type="button" onClick={refreshNow} disabled={refreshing}
              aria-label="Opdatér tallene på Hjem"
              style={{
                ...iconBtn, marginLeft: 6, padding: 2, verticalAlign: "middle",
                opacity: refreshing ? 0.5 : 1, cursor: refreshing ? "default" : "pointer",
              }}>
              <RefreshCw size={13} className={refreshing ? "spin" : undefined} />
            </button>
          </Eyebrow>
          {/* Eget navn er samme indgang som alle andre navne i appen → karrieren. */}
          <H size={30}>Hej <PlayerName userId={userId} name={displayName} onOpenProfile={openProfile} /></H>
        </div>
        {/* Rating (kun tal + bevægelse) ved navnet — tappbar til karriereprofil.
            Placering ("Nr. X af Y") udelades bevidst for at spare plads. */}
        {snapshot && !snapshot.none && (
          <div role="button" tabIndex={0} aria-label="Åbn din karriereprofil"
            onClick={() => (openProfile ? openProfile(userId) : goTab("rating"))}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProfile ? openProfile(userId) : goTab("rating"); } }}
            style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", cursor: "pointer", flexShrink: 0 }}>
            <Eyebrow>Rating <InfoDot title="Rating">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div>Din langsigtede dygtighed på tværs af de turneringer, der tæller i Championship. Alle starter på <b>1000</b>.</div>
                <div>Hver spillerunde giver <b>én</b> ratingændring — ikke én pr. kamp og ikke én pr. konkurrence.</div>
                <div>En <b>*</b> betyder foreløbig: de første 5 runder tæller ekstra, mens tallet finder sit leje.</div>
                <div>Championship er dét, man vinder — rating er dét, man <i>er</i>. Tryk på tallet for at åbne din karriere.</div>
              </div>
            </InfoDot></Eyebrow>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontFamily: font.display, fontSize: 26, fontWeight: 700 }}>{snapshot.rating}{snapshot.provisional ? <span style={{ color: C.muted, fontSize: 15 }} title="Foreløbig — under 5 runder">*</span> : ""}</span>
              <Move d={snapshot.move} />
            </div>
          </div>
        )}
      </div>

      {/* Story Engine v3 — ØVERST, over alt andet indhold (spec §8).
          Placeringen er en del af leverancen og ikke en smagssag: i v2 lå
          karusellen under tips-status, hvor den var noget, man scrollede forbi.
          Ét kort, der bærer dagens ene øjeblik, skal være det første, man ser —
          ellers er der ingen grund til at have valgt det så omhyggeligt.

          Kun ét af de to vises. Rundestoryen vinder, når den er nyere: den er
          ugens konklusion, og dagskortet er en enkelt aften. */}
      {roundIsNewer ? (
        <RoundStory story={roundStory} token={token} competitions={competitions}
          seen={seenStories.has(roundStory.id)} onSeen={onSeen}
          onDismiss={onDismissRound} openProfile={openProfile} userId={userId} />
      ) : (
        <DayCard story={dayCard} token={token} competitions={competitions}
          seen={seenStories.has(dayCard?.id)} onSeen={onSeen} />
      )}

      {/* "Kom godt i gang": erstatter de tidligere dashed tom-tilstande. De sagde
          hver især ÉN ting ("du har ingen liga" / "du har ingen konkurrence");
          checklisten viser hele vejen på én gang, så brugeren kan se, hvor de er,
          og hvad der mangler — også efter en afbrydelse. */}
      {showChecklist && (
        <GetStartedCard
          onboarding={onboarding}
          push={push}
          onDismiss={() => { writeUserFlag(CARD_KEY, userId, "1"); setCardHidden(true); }}
          actions={{
            liga: () => goTab("ligaer"),
            konkurrence: () => (onboarding.groups.length === 1 ? openGroup?.(onboarding.groups[0].id) : goTab("ligaer")),
            tip: () => openPredictions("all", tips?.roundKey || null),
            // Invitér-knappen bor på liga-siden — dér, hvor linket deles.
            invitér: () => (onboarding.groups[0] ? openGroup?.(onboarding.groups[0].id) : goTab("ligaer")),
          }}
        />
      )}

      {/* Sidste værn: Hjem må ALDRIG stå tom.
          Alle kortene nedenfor ligger bag `tips.hasComps`, og checklisten var
          derfor det eneste indhold, en bruger uden konkurrencer fik. Den kan
          udeblive ad to veje — brugeren trykker X på den, eller onboarding-
          proben fejler stille (MainApp) — og så stod skærmen bogstaveligt talt
          med dato og navn og intet andet. Ingen fejl at se, ingen vej videre.

          Betingelsen hænger på `competitions` og ikke på `tips`, fordi de siger
          præcis det samme (computeHomeTips returnerer {hasComps:false} på den
          samme tomme liste) — men prop'en er her allerede ved første tegning,
          så kortet ikke blinker ind efter et netværkskald.

          Destinationen er Ligaer og ikke opret-skærmen: en konkurrence kræver
          en liga (guarden bor i createCompetition, siden 3. august), så vejen
          frem går altid gennem at oprette eller vælge en liga først.
          Ligaer-fanen viser
          både "Opret en liga" og "Deltag med kode" for den, der ingen har. */}
      {!showChecklist && competitions.length === 0 && (
        <Card style={{ borderStyle: "dashed", background: "transparent" }}>
          <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase" }}>Kom i gang</div>
          <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.5, marginTop: 4 }}>
            Du er ikke med i en konkurrence endnu. Start med en liga — dit faste
            fællesskab — og opret eller deltag i en konkurrence derinde.
          </div>
          <button style={{ ...btnGreen, marginTop: 12 }} onClick={() => goTab("ligaer")}>Opret eller deltag i en liga</button>
        </Card>
      )}

      {/* Signatur: næste deadline. Kun for den, der HAR konkurrencer — ellers
          lovede kortet at hente en deadline, der ikke findes, og stod side om
          side med "Kom i gang" ovenfor, indtil kaldet kom tilbage. */}
      {tips === null && competitions.length > 0 && <Card><span style={{ color: C.muted, fontSize: 13 }}>Henter din næste deadline…</span></Card>}
      {/* Intet at tippe lige nu — IKKE det samme som "alle tips er inde".
          Alle kampe i brugerens konkurrencer er låst eller spillet. */}
      {tips && tips.hasComps && tips.nothingToTip && (
        <Card style={cardTight}>
          <div style={{ fontFamily: font.display, fontSize: 17, fontWeight: 700, textTransform: "uppercase" }}>Intet at tippe lige nu</div>
          {/* Samme form som det grønne kort ovenfor — de to er gensidigt
              udelukkende tilstande af samme kvittering og skal ikke have hver
              sin højde. */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
            <span style={{ color: C.muted, fontSize: 13, minWidth: 0 }}>
              {tips.nextOpen ? `Næste kamp: ${formatKickoff(tips.nextOpen, tips.nextOpenTbd)}` : "Der er ingen kommende kampe i dine konkurrencer."}
            </span>
            {tips.roundKey && (
              <button style={{ ...btnGhost, padding: "5px 10px", flexShrink: 0 }} onClick={() => openPredictions("all", tips.roundKey)}>Se runden</button>
            )}
          </div>
        </Card>
      )}
      {/* Konkurrencer uden kampe endnu (fx en stage-konkurrence før kampene er udgivet). */}
      {tips && tips.hasComps && tips.noMatches && (
        <Card style={{ borderStyle: "dashed", background: "transparent" }}>
          <div style={{ color: C.muted, fontSize: 14, textAlign: "center" }}>
            Der er ingen kampe i dine konkurrencer endnu. De dukker op, så snart kampprogrammet er lagt.
          </div>
        </Card>
      )}
      {tips && tips.hasComps && tips.error && (
        <Card style={{ borderColor: C.red }}>
          <div style={{ color: C.red, fontSize: 13 }}>
            Kunne ikke hente din næste deadline lige nu. Prøv igen om lidt.
          </div>
        </Card>
      )}
      {tips && tips.hasComps && tips.allTipped && (
        <Card style={{ ...cardTight, borderColor: C.green, background: "linear-gradient(135deg, #14212F 0%, #14302A 100%)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Check size={15} color={C.green} />
            <div style={{ fontFamily: font.display, fontSize: 17, fontWeight: 700, textTransform: "uppercase", color: C.green }}>Alt ok — alle tips er inde</div>
          </div>
          {/* "Se tips" ved siden af næste kamp og ikke under den: kvitteringens
              to oplysninger — hvornår og hvor — hører til på samme linje, og
              linjen havde plads. `flexWrap` er værnet mod en lang dato på en
              smal skærm; så bryder knappen ned, og kortet er stadig lavere end
              det var med knappen på egen række. */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
            <span style={{ color: C.muted, fontSize: 13, minWidth: 0 }}>
              {tips.nextOpen ? `Næste kamp: ${formatKickoff(tips.nextOpen, tips.nextOpenTbd)}` : "Vi giver besked, når næste runde åbner."}
            </span>
            {tips.roundKey && (
              <button style={{ ...btnGhost, padding: "5px 10px", borderColor: C.green, color: C.green, flexShrink: 0 }} onClick={() => openPredictions("all", tips.roundKey)}>Se tips</button>
            )}
          </div>
        </Card>
      )}
      {/* Manglende tips: kun når vi HAR set en tipbar runde med utippede kampe
          (allTipped === false). De øvrige tilstande har hver sit kort ovenfor. */}
      {tips && tips.hasComps && tips.allTipped === false && (
        <Card style={{ borderColor: C.red, background: "linear-gradient(135deg, #14212F 0%, #2E1620 100%)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.red, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            <Clock size={13} /> Deadline om {fmtCountdown(tips.deadline)}
          </div>
          <div style={{ fontFamily: font.display, fontSize: 22, fontWeight: 700, textTransform: "uppercase", marginTop: 4 }}>
            Runde {tips.roundLabelText} · {tips.missingCount} {tips.missingCount === 1 ? "kamp mangler" : "kampe mangler"} tips
          </div>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{tips.names.join(" · ")}</div>
          <button style={{ ...btnGreen, marginTop: 12 }} onClick={() => openPredictions("all", tips.roundKey)}>Tip nu</button>
        </Card>
      )}


      {/* Indeværende runde: live-oversigt der opdaterer løbende.
          Foldet som standard (viser kun X/Y spillet + akkumulerede point);
          et klik på header folder den fulde kamp-for-kamp-visning ud. */}
      {round && round.totalCount > 0 && (
        <Card>
          {/* Folden er `Collapsible` (G57): headeren var en `div role="button"`
              med sin egen `onKeyDown`, altså en knap bygget af dele. Chevronen
              bliver derimod stående i headerens FØRSTE linje ved tælleren —
              placeringen er layout, og et to-linjers kort har ikke sin pil i
              midten til højre. Derfor `chevron={false}` + `FoldChevron`. */}
          <Collapsible
            open={roundOpen} onToggle={() => setRoundOpen((v) => !v)}
            label="rundens kampe" chevron={false}
            style={{ display: "block" }}
            header={<>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <Eyebrow>Indeværende runde</Eyebrow>
                <span style={{ color: C.muted, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {/* Er der kampe i gang, siges det allerede på det FOLDEDE kort */}
                  {round.liveCount > 0 && <LiveBadge text={round.liveCount > 1 ? `${round.liveCount} kampe` : ""} />}
                  {round.playedCount}/{round.totalCount} spillet
                  <FoldChevron open={roundOpen} />
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase" }}>Runde {round.roundLabelText}</span>
                {round.playedCount > 0 && (
                  <span style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, color: C.gold }}>{round.myPoints} p</span>
                )}
              </div>
            </>}
          >
            <>
              <div style={{ marginTop: 6 }}>
                {round.matches.map((m) => (
                  <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.home} – {m.away}</div>
                      <div style={{ color: C.muted, fontSize: 11, marginTop: 1 }}>{m.pred ? `Dit tip: ${m.pred.pred_home}-${m.pred.pred_away}` : "Intet tip"}</div>
                    </div>
                    {/* Tre tilstande: færdigspillet (resultat + point) · i gang (nuværende
                        stilling + LIVE-mærke, ingen point endnu) · kommende (kickoff-tid). */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      {m.played ? (
                        <>
                          <span style={{ fontFamily: font.display, fontSize: 16, fontWeight: 700 }}>{m.homeScore}-{m.awayScore}</span>
                          <PointsPill pts={m.points} />
                        </>
                      ) : m.live ? (
                        <>
                          <span style={{ fontFamily: font.display, fontSize: 16, fontWeight: 700, color: C.red }}>{m.live.homeScore}-{m.live.awayScore}</span>
                          <LiveBadge text={m.live.label} />
                        </>
                      ) : m.inProgress ? (
                        <span style={{ color: C.green, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>I gang</span>
                      ) : (
                        <span style={{ color: C.muted, fontSize: 12 }}>{shortKick(m.kickoff)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <button style={{ ...btnGhost, marginTop: 12 }} onClick={() => openPredictions("all", round.roundKey)}>Åbn tip <ChevronRight size={14} /></button>
            </>
          </Collapsible>
        </Card>
      )}

      {/* Placeringer — konkurrencer grupperet pr. liga (liga-laget) */}
      {placements && placements.length > 0 && (
        <Card>
          <Eyebrow>Dine placeringer <InfoDot title="Dine placeringer">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>Hvor du ligger lige nu — i månedschampionshippet og i hver af dine konkurrencer.</div>
              <div>Konkurrencerne er grupperet under den liga, de hører til. Tryk på en række for at se hele stillingen.</div>
            </div>
          </InfoDot></Eyebrow>
          <Placements placements={placements} goTab={goTab} openBoard={openBoard} />
        </Card>
      )}

      {/* Push-notifikationer: opt-in. Mens checklisten står, er notifikationer et
          trin dér — to kort må ikke bede om det samme på samme skærm. */}
      {!showChecklist && <PushOptInCard push={push} />}
    </div>
  );
}

export default HjemTab;
