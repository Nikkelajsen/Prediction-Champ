// Hjem-fanen: dagens overblik. Deadline-kort, rating-snapshot, rundens
// live-oversigt, dine placeringer, rundens historie og opt-in til notifikationer.
import { useState, useEffect } from "react";
import { Bell, ChevronRight, Clock, Check, X, Share2, RefreshCw } from "lucide-react";
import { APP_TZ, formatKickoff } from "../lib/scoring.js";
import { db } from "../lib/supabase.js";
import { computeCompetitionState, computeCurrentRound, computeHomeTips, currentMonthKey, daFullDate, dismissStory, fmtCountdown, loadLatestStory, loadMonthlyBoard, loadRatingBoard, loadRatingHistory, monthName } from "../lib/data.js";
import { logEvent, logEventOnce } from "../lib/analytics.js";
import { isQuiet } from "../lib/stories.js";
import { shareText, storyShareText } from "../lib/share.js";
import { readUserFlag, writeUserFlag, CARD_KEY } from "../lib/localFlags.js";
import { C, btnGhost, btnGreen, font, iconBtn } from "../ui/theme.js";
import { usePushOptIn } from "../ui/usePushOptIn.js";
import { Card, Collapsible, Eyebrow, FoldChevron, H, InfoDot, LiveBadge, Move, PlayerName, PointsPill } from "../ui/components.jsx";
import GetStartedCard from "./GetStartedCard.jsx";

// Opt-in-kort til push-notifikationer. Vises kun hvor det giver mening:
// browseren understøtter push, brugeren har ikke sagt nej, og er ikke tilmeldt
// endnu. Tilgængeligheden afgøres af `usePushOptIn`, som "Kom godt i gang"-
// checklisten bruger det samme — så de to aldrig kan spørge om det samme
// samtidig eller være uenige om, hvornår spørgsmålet giver mening.
function PushOptInCard({ push }) {
  if (!push.available) return null;

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Bell size={15} color={C.gold} />
          <div style={{ fontFamily: font.display, fontSize: 18, fontWeight: 700, textTransform: "uppercase" }}>Få besked før deadline</div>
        </div>
        <button style={iconBtn} aria-label="Skjul" onClick={push.dismiss}><X size={16} /></button>
      </div>
      <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
        Vi minder dig om at tippe, inden kampene låser — og fortæller, hvordan runden gik.
      </div>
      {push.error && <div style={{ color: C.red, fontSize: 13, marginTop: 8 }}>{push.error}</div>}
      <button style={{ ...btnGreen, marginTop: 12, opacity: push.busy ? 0.6 : 1 }} disabled={push.busy} onClick={push.enable}>
        {push.busy ? "Slår til …" : "Slå notifikationer til"}
      </button>
    </Card>
  );
}

// Historie-kort (Story Engine v1.1). Vises direkte under tips-status, live for alle.
// Afvis sætter dismissed_at og skjuler kortet.
//
// TO UDGAVER, styret af prioriteten (`isQuiet`, jf. src/lib/stories.js):
//  · Højdepunkt (prioritet < 90): guld-kant, ravgul gradient, emoji i headline og
//    en Del-knap — ugens højdepunkt, noget man sender i gruppens beskedtråd.
//  · Dæmpet (prioritet ≥ 90): almindeligt kort, mindre headline, ingen emoji og
//    INGEN Del-knap. Det er den stille runde, produktbogens kapitel 6 beder om
//    ("status quo") — den skal kunne ses uden at ligne en sejr, og der er intet
//    at prale af. Genereres kun, når brugeren ellers ville stå helt uden kort.
function StoryCard({ story, onDismiss, token, groupId }) {
  const quiet = isQuiet(story.priority);
  async function share() {
    try {
      await shareText(storyShareText(story));
      logEvent(token, "story_shared", { competitionId: story.competition_id || null, groupId, metadata: { rule: story.rule } });
    } catch { /* bruger annullerede — ignorér */ }
  }
  return (
    <Card style={quiet ? undefined : { borderColor: C.gold, background: "linear-gradient(135deg, #14212F 0%, #221E14 100%)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Eyebrow>{quiet ? "Runden kort" : "Rundens historie"}</Eyebrow>
        <button style={iconBtn} aria-label="Afvis" onClick={onDismiss}><X size={16} /></button>
      </div>
      <div style={{ fontFamily: font.display, fontSize: quiet ? 17 : 20, fontWeight: 700, lineHeight: 1.15 }}>{story.headline}</div>
      <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.5, marginTop: 6 }}>{story.body}</div>
      {!quiet && (
        <button style={{ ...btnGhost, marginTop: 12, borderColor: C.gold, color: C.gold }} onClick={share}><Share2 size={14} /> Del</button>
      )}
    </Card>
  );
}

// kompakt kickoff til runde-oversigten (fx "man. 12.05. 14.00")
function shortKick(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const day = d.toLocaleDateString("da-DK", { timeZone: APP_TZ, weekday: "short", day: "2-digit", month: "2-digit" });
  const t = d.toLocaleTimeString("da-DK", { timeZone: APP_TZ, hour: "2-digit", minute: "2-digit" });
  return `${day} ${t}`;
}

// "Dine placeringer": månedschampionship (global) øverst, dernæst konkurrencer grupperet
// pr. liga (liga-laget). Har brugeren ingen ligaer, vises konkurrencerne fladt som før.
function Placements({ placements, goTab, openBoard }) {
  const monthlyRows = placements.filter((r) => r.tab);
  const compRows = placements.filter((r) => r.compId);
  const hasGroups = compRows.some((r) => r.groupId);

  // Rigtige knapper og ikke klikbare `<div>`s (G22): rækkerne er appens
  // primære vej videre fra Hjem, og de var tastatur-uopnåelige og uden rolle
  // for en skærmlæser. `width: 100%` + `textAlign: left` beholder udseendet.
  const Row = ({ r, top }) => (
    <button type="button" onClick={() => (r.tab ? goTab(r.tab) : openBoard(r.compId))} style={{
      display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
      background: "none", border: "none", textAlign: "left", font: "inherit", color: "inherit",
      padding: "10px 0", borderTop: top ? `1px solid ${C.line}` : "none", cursor: "pointer",
    }}>
      <span style={{ fontSize: 14 }}>{r.label}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        {/* "delt" siges kun her, hvor der er plads til ord — tabellerne nøjes med tallet */}
        {r.shared && <span style={{ fontSize: 11, color: C.muted }}>delt</span>}
        <span style={{ fontFamily: font.display, fontSize: 18, fontWeight: 700, color: r.pos === "1." ? C.gold : C.text }}>{r.pos}</span>
        <ChevronRight size={15} color={C.muted} />
      </span>
    </button>
  );
  const SubHead = ({ children }) => (
    <div style={{ fontFamily: font.display, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 11, color: C.muted, margin: "12px 0 2px" }}>{children}</div>
  );

  if (!hasGroups) {
    return <>{[...monthlyRows, ...compRows].map((r, i) => <Row key={r.compId || r.tab} r={r} top={i > 0} />)}</>;
  }

  // grupper konkurrence-rækker pr. liga (første-optrædende rækkefølge); liga-løse sidst
  const order = [];
  const byKey = new Map();
  for (const r of compRows) {
    const key = r.groupId || "__loose__";
    if (!byKey.has(key)) { byKey.set(key, { key, name: r.groupId ? r.groupName : "Øvrige", rows: [] }); order.push(key); }
    byKey.get(key).rows.push(r);
  }
  const groups = order.map((k) => byKey.get(k)).sort((a, b) => (a.key === "__loose__" ? 1 : 0) - (b.key === "__loose__" ? 1 : 0));

  return (
    <>
      {monthlyRows.map((r, i) => <Row key={r.tab} r={r} top={i > 0} />)}
      {groups.map((g) => (
        <div key={g.key}>
          <SubHead>{g.name}</SubHead>
          {g.rows.map((r, i) => <Row key={r.compId} r={r} top={i > 0} />)}
        </div>
      ))}
    </>
  );
}

function HjemTab({ token, userId, profile, competitions, goTab, openPredictions, openBoard, openGroup, openProfile, onboarding }) {
  const [tips, setTips] = useState(null);
  const [round, setRound] = useState(null); // live-oversigt over indeværende runde
  const [roundOpen, setRoundOpen] = useState(false); // foldet som standard: viser kun X/Y + point
  const [snapshot, setSnapshot] = useState(null); // { rating, move, form, rank, total }
  const [placements, setPlacements] = useState(null); // [{ label, pos, gold, onClick }]
  const [story, setStory] = useState(null); // Story Engine — seneste historie (live for alle)
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

  // Historie-kort: hentes for alle brugere (Story Engine er live, jf. ROADMAP juli 2026).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await loadLatestStory(token);
      if (!cancelled) setStory(s);
    })();
    return () => { cancelled = true; };
  }, [token]);

  // story_viewed: logges højst én gang pr. historie pr. sideliv (logEventOnce),
  // ellers ville et faneskift frem og tilbage til Hjem tælle den samme visning
  // flere gange. groupId udledes af historiens konkurrence (allerede i props),
  // så Liga Health kan attribuere story-views til den rigtige liga.
  const storyGroupId = story ? (competitions.find((c) => c.id === story.competition_id)?.group_id || null) : null;
  useEffect(() => {
    if (!story) return;
    logEventOnce(token, "story_viewed", story.id, {
      competitionId: story.competition_id || null, groupId: storyGroupId,
      metadata: { rule: story.rule, priority: story.priority, quiet: isQuiet(story.priority) },
    });
  }, [story, storyGroupId, token]);

  async function onDismissStory() {
    const s = story;
    setStory(null);
    if (s?.id) await dismissStory(token, s.id);
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
        const me = board.find((r) => r.userId === userId);
        if (!cancelled) {
          if (me) {
            const h = hist.get(userId) || {};
            // rank er ranglistens ægte placering (delt ved samme rating), ikke listeindekset
            setSnapshot({ rating: me.rating, move: h.move || 0, form: h.form || [], rank: me.rank, total: board.length, provisional: me.provisional });
          } else {
            setSnapshot({ none: true });
          }
        }
      } catch { if (!cancelled) setSnapshot({ none: true }); }

      // placeringer: månedschampionship + hver privat konkurrence.
      // Hentes parallelt (månedschampionship + alle konkurrencer på én gang); rækkefølgen
      // på listen bevares (månedschampionship først, dernæst konkurrencer i input-orden).
      // Bemærk: private konkurrencers stilling findes ikke i standings-views'ene
      // (de er globale pr. runde/sæson), så computeCompetitionState er stadig nødvendig.
      try {
        const comps = competitions.filter((x) => !x._hidden);
        // liga-navne til gruppering af konkurrence-placeringer (liga-laget)
        const groupIds = [...new Set(comps.map((c) => c.group_id).filter(Boolean))];
        const [monthly, compStates, groupRows] = await Promise.all([
          loadMonthlyBoard(token, currentMonthKey()),
          Promise.all(comps.map((c) =>
            computeCompetitionState(token, c.id).catch(() => null)
          )),
          groupIds.length ? db.select(token, "groups", `id=in.(${groupIds.join(",")})&select=id,name`).catch(() => []) : Promise.resolve([]),
        ]);
        const groupNameById = new Map(groupRows.map((g) => [g.id, g.name]));
        const list = [];
        // Placeringen er rækkens ægte rank (delt ved lighed) — ikke dens plads i listen.
        const mine = monthly.find((r) => r.userId === userId);
        if (mine) list.push({ label: "Månedschampionship · " + monthName(currentMonthKey()), pos: `${mine.rank}.`, shared: mine.shared, tab: "championship" });
        comps.forEach((c, i) => {
          const state = compStates[i];
          if (!state) return; // fejlede — spring over
          const row = state.rows.find((r) => r.userId === userId);
          if (row) list.push({ label: c.name, pos: `${row.rank}.`, shared: row.shared, compId: c.id, groupId: c.group_id || null, groupName: c.group_id ? (groupNameById.get(c.group_id) || "Liga") : null });
        });
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
        <Card>
          <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase" }}>Intet at tippe lige nu</div>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
            {tips.nextOpen ? `Næste kamp: ${formatKickoff(tips.nextOpen, tips.nextOpenTbd)}` : "Der er ingen kommende kampe i dine konkurrencer."}
          </div>
          {tips.roundKey && (
            <button style={{ ...btnGhost, marginTop: 12 }} onClick={() => openPredictions("all", tips.roundKey)}>Se runden</button>
          )}
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
        <Card style={{ borderColor: C.green, background: "linear-gradient(135deg, #14212F 0%, #14302A 100%)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Check size={16} color={C.green} />
            <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase", color: C.green }}>Alt ok — alle tips er inde</div>
          </div>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
            {tips.nextOpen ? `Næste kamp: ${formatKickoff(tips.nextOpen, tips.nextOpenTbd)}` : "Vi giver besked, når næste runde åbner."}
          </div>
          {tips.roundKey && (
            <button style={{ ...btnGhost, marginTop: 12, borderColor: C.green, color: C.green }} onClick={() => openPredictions("all", tips.roundKey)}>Se tips</button>
          )}
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

      {/* Rundens historie (Story Engine) — direkte under tips-status, altid synlig */}
      {story && <StoryCard story={story} onDismiss={onDismissStory} token={token} groupId={storyGroupId} />}

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
