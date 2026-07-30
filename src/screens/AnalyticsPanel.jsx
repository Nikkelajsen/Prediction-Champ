// Analytics v1 — internt dashboard (Admin → Analytics). Spec: docs/features/analytics-v1.md
//
// Fire uafhængige sektioner, hver med egen { data, loading, err } og eget
// useEffect: én langsom eller fejlende sektion blokerer aldrig de tre andre.
// Ingen ny chart-dependency — genbruger de håndrullede StatTile/StatGroup/
// MiniBars fra ui/components.jsx (samme stil som den eksisterende
// "Statistik"-fane, jf. arkitekturvalg #2).
//
// JULI 2026, to ændringer:
//   · Hvert nøgletal har en ⓘ, der siger hvad der måles, hvordan, fra hvilken
//     kilde og hvad tallet IKKE kan bruges til (måle-ordbogen i
//     src/lib/analyticsMetrics.js). Etiketter og hints kan fortsat læses
//     alene — ⓘ'en uddyber, den bærer aldrig forudsætningen.
//   · "Liga Health" (ét sammenvejet 0-100-tal) er afløst af "Liga-diagnose":
//     målte signaler hver for sig plus én navngivet tilstand med en handling.
//     Begrundelsen står i diagnoseLeague() i src/lib/analytics.js.
import { useState, useEffect, Fragment } from "react";
import { Loader2, ArrowUpRight, ArrowDownRight } from "lucide-react";
import {
  loadAnalyticsHealth, loadAnalyticsEngagement, loadAnalyticsLeagueHealth, loadAnalyticsRetention,
  loadAnalyticsFunnel, loadAnalyticsStories,
  diagnoseLeagues, summarizeDiagnoses,
  funnelRow, funnelSteps, biggestDrop, fmtMinutes, FUNNEL_STALLS, storyRuleRows,
} from "../lib/analytics.js";
import { metricInfo } from "../lib/analyticsMetrics.js";
import { C, chip, font, muted } from "../ui/theme.js";
import { Card, InfoDot, StatTile, StatGroup, MiniBars, StateChip, SignalRow, PctGrid } from "../ui/components.jsx";

const dayLabel = (iso) => { const d = new Date(iso); return d.toLocaleDateString("da-DK", { day: "numeric", month: "short" }); };
const weekLabel = (iso) => { const d = new Date(iso); return d.toLocaleDateString("da-DK", { day: "numeric", month: "short" }); };
const monthLabel = (ym) => {
  const [y, m] = String(ym).split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("da-DK", { month: "short", year: "2-digit" });
};
const dtFmt = (iso) => iso ? new Date(iso).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" }) : "Aldrig";
const pctFmt = (v) => (v === null || v === undefined ? "—" : `${v} %`);
function fmtDur(sec) {
  sec = Number(sec) || 0;
  const m = Math.floor(sec / 60); const s = Math.round(sec % 60);
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

// ⓘ for ét id i måle-ordbogen. Ukendt id → ingen ⓘ (metricInfo returnerer
// null), så en tastefejl koster forklaringen, ikke sektionen.
function M({ id }) {
  const m = metricInfo(id);
  if (!m) return null;
  const Row = ({ head, children }) => (
    <p style={{ margin: "0 0 10px" }}>
      <span style={{ color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", display: "block" }}>{head}</span>
      {children}
    </p>
  );
  return (
    <InfoDot title={m.title}>
      <Row head="Hvad måles">{m.what}</Row>
      <Row head="Hvordan">{m.how}</Row>
      <Row head="Kilde">{m.source}</Row>
      {m.caveat && <Row head="Forbehold">{m.caveat}</Row>}
    </InfoDot>
  );
}

// Fælles skal for en sektion: overskrift + loading/fejl/indhold. Fejl i én
// sektion rammer kun dens eget Card.
function Section({ title, subtitle, loading, err, children }) {
  return (
    <Card>
      <div style={{ fontFamily: font.display, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 15, marginBottom: subtitle ? 2 : 12 }}>{title}</div>
      {subtitle && <div style={{ ...muted, fontSize: 12, marginBottom: 12 }}>{subtitle}</div>}
      {loading && <p style={{ ...muted, display: "flex", gap: 8, alignItems: "center", margin: 0 }}><Loader2 size={14} className="spin" /> Henter …</p>}
      {err && <p style={{ color: C.red, fontSize: 13, margin: 0 }}>Fejl: {err}</p>}
      {!loading && !err && children}
    </Card>
  );
}

const SubHead = ({ children }) => (
  <div style={{ fontFamily: font.display, fontWeight: 700, textTransform: "uppercase", fontSize: 13, color: C.muted, marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>{children}</div>
);

// Simpel 2-kolonne-grid uden StatGroup's egen overskrift (bruges hvor
// overskriften allerede står lige ovenover).
const Grid2 = ({ children }) => <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{children}</div>;

function useSection(loader, token, deps) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr("");
      try { const d = await loader(); if (!cancelled) setData(d); }
      catch (e) { if (!cancelled) setErr(e.message || "Kunne ikke hente"); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, loading, err };
}

// ---------- 1. Produktets sundhed ----------
function HealthSection({ token, days }) {
  const { data, loading, err } = useSection(() => loadAnalyticsHealth(token, days), token, [token, days]);
  // Retning frem for niveau: "62 %" kan ikke bære en beslutning, "62 %, ned
  // fra 71 %" kan. Skjules helt, når forrige vindue var for tyndt (RPC'en
  // sender da null) — støj må ikke præsenteres som et fald.
  const prev = data?.completion_rate_prev;
  const nowRate = data?.completion_rate;
  const delta = (prev === null || prev === undefined || nowRate === null || nowRate === undefined)
    ? null : Math.round((nowRate - prev) * 10) / 10;

  return (
    <Section title="Produktets sundhed" subtitle={`Vinduet gælder alle tal undtagen hvor der står "alt tid".`} loading={loading} err={err}>
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* North Star: eget fremhævet kort, den vigtigste tal-fladen på siden */}
          <div style={{ background: "rgba(240,180,41,0.08)", border: `1px solid ${C.gold}`, borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ color: C.muted, fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
              Prediction Completion Rate (North Star) <M id="completion_rate" />
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontFamily: font.display, fontWeight: 700, fontSize: 34, color: C.gold, lineHeight: 1.1 }}>
                {nowRate === null || nowRate === undefined ? "—" : `${nowRate} %`}
              </div>
              {delta !== null && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 13, fontWeight: 600, color: delta < 0 ? C.red : C.green }}>
                  {delta < 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                  {delta > 0 ? "+" : ""}{delta} pp
                  <span style={{ color: C.muted, fontWeight: 400, marginLeft: 4 }}>mod forrige {days} dage ({prev} %)</span>
                  <M id="completion_trend" />
                </span>
              )}
            </div>
            <div style={{ color: C.muted, fontSize: 12 }}>
              {data.completion_done} af {data.completion_slots} mulige tips i vinduet · alt tid {data.completion_rate_all_time === null ? "—" : `${data.completion_rate_all_time} %`}
            </div>
          </div>
          <StatGroup title="Nøgletal">
            <StatTile label="Aktive brugere (7 dage)" value={data.active_users_7d} hint={`${data.active_users_30d} seneste 30 dage`} info={<M id="active_users" />} />
            <StatTile label="Aktive ligaer" value={data.active_groups} hint={`af ${data.groups_total} i alt · ${data.groups_with_active_member} med mindst én aktiv`} info={<M id="active_groups" />} />
            <StatTile label="Aktive konkurrencer" value={data.active_competitions} hint={`${data.live_competitions} i gang · ${data.competitions_total} i alt`} info={<M id="active_competitions" />} />
            <StatTile label="Deadline Miss Rate" value={data.deadline_miss.miss_rate === null ? "—" : `${data.deadline_miss.miss_rate} %`}
              hint={data.deadline_miss.miss_rate_of_exposed === null ? undefined : `${data.deadline_miss.miss_rate_of_exposed} % af de ${data.deadline_miss.users_with_deadline}, der havde en deadline`}
              info={<M id="deadline_miss_rate" />} />
            <StatTile label="Missede runder" value={data.deadline_miss.round_miss_rate === null ? "—" : `${data.deadline_miss.round_miss_rate} %`}
              hint={`${data.deadline_miss.rounds_missed} af ${data.deadline_miss.rounds_with_deadline} bruger-runder uden ét eneste tip`}
              info={<M id="deadline_miss_rate" />} />
            <StatTile label="Gennemførte spillerunder (alt tid)" value={data.rounds_completed} info={<M id="rounds_completed" />} />
          </StatGroup>
          <div>
            <SubHead>Completion rate pr. uge <M id="completion_by_week" /></SubHead>
            {/* pct, ikke `pct ?? 0`: en uge uden låste runder har ingen måling
                og skal gråtones, ikke tegnes som et 0 %, der ikke kan skelnes
                fra en uge, hvor ingen tippede. */}
            <MiniBars data={(data.completion_by_week || []).map((r) => ({ key: r.week, value: r.pct }))} color={C.gold} formatLabel={weekLabel} suffix=" %" />
          </div>
          <div>
            <SubHead>Completion rate pr. måned <M id="completion_by_month" /></SubHead>
            <MiniBars data={(data.completion_by_month || []).map((r) => ({ key: r.month, value: r.pct }))} color={C.gold} formatLabel={monthLabel} suffix=" %" />
          </div>
          <div>
            <SubHead>Gennemførte runder pr. uge <M id="rounds_completed_by_week" /></SubHead>
            <MiniBars data={(data.rounds_completed_by_week || []).map((r) => ({ key: r.week, value: r.count }))} color={C.green} formatLabel={weekLabel} />
          </div>
        </div>
      )}
    </Section>
  );
}

// ---------- 2. Engagement ----------
// Rå event-navne (opened_home) er kodeidentifikatorer, ikke etiketter. De stod
// før direkte i dropdownen; nu oversættes de ét sted, og navnet følger med i
// parentes, så et tal på skærmen stadig kan findes igen i analytics_events.
const SERIES = [
  { id: "opened_home", label: "Hjem" },
  { id: "opened_tip", label: "Tip" },
  { id: "opened_league", label: "Liga" },
  { id: "opened_rating", label: "Rating" },
  { id: "opened_career", label: "Karriere" },
  { id: "opened_standings", label: "Stilling" },
  { id: "opened_championship", label: "Championship" },
  { id: "story_viewed", label: "Historie-kort" },
];
const PUSH_KIND = { deadline: "Deadline-påmindelse", result: "Runde-resultat" };

// Virkede beskeden? Open rate måler, om den blev åbnet — dette måler, om der
// blev tippet bagefter. Løftet er det eneste tal, der siger noget om, hvorvidt
// produktets ene aktive fastholdelses-værktøj gør sit arbejde.
function PushEffect({ effect }) {
  const lift = (effect.opened_rate === null || effect.not_opened_rate === null)
    ? null : Math.round((effect.opened_rate - effect.not_opened_rate) * 10) / 10;
  return (
    <div>
      <SubHead>Virkede deadline-påmindelsen? <M id="push_effect" /></SubHead>
      <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
        <div style={{ fontSize: 13, color: C.text }}>
          {lift === null
            ? "Ikke nok modtagere i vinduet til at sammenligne."
            : <>Af dem der <b>åbnede</b> beskeden, tippede <b>{effect.opened_rate} %</b> i runden. Af dem der <b>ikke</b> åbnede den, tippede <b>{effect.not_opened_rate} %</b>.</>}
        </div>
        {lift !== null && (
          <div style={{ fontSize: 12, color: lift > 0 ? C.green : C.muted, marginTop: 4 }}>
            Forskel: {lift > 0 ? "+" : ""}{lift} procentpoint — et <b>loft</b> over effekten, ikke et estimat: de, der åbner beskeder, er de engagerede i forvejen.
          </div>
        )}
      </div>
      <SignalRow label="Åbnede beskeden" value={effect.opened_rate === null ? "—" : `${effect.opened_rate} %`}
        detail={`${effect.opened_pred} af ${effect.opened_n} tippede`} />
      <SignalRow label="Åbnede den ikke" value={effect.not_opened_rate === null ? "—" : `${effect.not_opened_rate} %`}
        detail={`${effect.not_opened_pred} af ${effect.not_opened_n} tippede`} />
      {(effect.by_lead_time || []).length > 0 && (
        <div style={{ marginTop: 12 }}>
          <SubHead>Varsel før rundelås <M id="push_lead_time" /></SubHead>
          {effect.by_lead_time.map((b) => (
            <SignalRow key={b.bucket} label={b.bucket} value={b.rate === null ? "—" : `${b.rate} %`}
              detail={`${b.predicted} af ${b.n} tippede`} />
          ))}
        </div>
      )}
    </div>
  );
}

function EngagementSection({ token, days }) {
  const { data, loading, err } = useSection(() => loadAnalyticsEngagement(token, days), token, [token, days]);
  const [metric, setMetric] = useState("opened_home");
  const ev = data?.events || {};
  const series = (data?.events_by_day?.[metric] || []).map((r) => ({ key: r.day, value: r.count }));

  return (
    <Section title="Engagement" subtitle="Alle tal her kommer fra hændelsesloggen og er et gulv — se ⓘ." loading={loading} err={err}>
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <StatGroup title="Views">
            <StatTile label="Story Views" value={ev.story_viewed?.count ?? 0} hint={`${ev.story_viewed?.users ?? 0} brugere`} info={<M id="event_views" />} />
            <StatTile label="Karriere Views" value={ev.opened_career?.count ?? 0} hint={`${ev.opened_career?.users ?? 0} brugere`} info={<M id="event_views" />} />
            <StatTile label="Rating Views" value={ev.opened_rating?.count ?? 0} hint={`${ev.opened_rating?.users ?? 0} brugere`} info={<M id="event_views" />} />
            <StatTile label="Liga Views" value={data.league_views_total} hint={`${data.league_views_detail} på en bestemt liga`} info={<M id="league_views" />} />
            <StatTile label="Tip Views" value={ev.opened_tip?.count ?? 0} hint={`${ev.opened_tip?.users ?? 0} brugere`} info={<M id="event_views" />} />
          </StatGroup>
          <StatGroup title="Notifikationer & sessioner">
            <StatTile label="Push Notification Open Rate" value={data.push.open_rate === null ? "—" : `${data.push.open_rate} %`}
              hint={`${data.push.opened} åbnet af ${data.push.sent} sendt`} info={<M id="push_open_rate" />} />
            <StatTile label="Gns. sessionstid" value={fmtDur(data.session.avg_seconds)}
              hint={`median ${fmtDur(data.session.median_seconds)} · ${data.session.sessions} sessioner`} info={<M id="session_time" />} />
            {/* Stod før i svaret uden nogensinde at blive vist. Det ærlige tal
                bag gennemsnittet: sessioner med kun ét event måler 0 sekunder
                og trækker gennemsnittet kunstigt ned. */}
            <StatTile label="Sessionstid, flere hændelser" value={fmtDur(data.session.avg_seconds_multi)}
              hint="gns. for sessioner med mere end én hændelse" info={<M id="session_time" />} />
            <StatTile label="Hændelser pr. session" value={data.session.avg_events} info={<M id="session_time" />} />
          </StatGroup>
          {(data.push.by_kind || []).length > 0 && (
            <div>
              <SubHead>Push pr. type <M id="push_open_rate" /></SubHead>
              <div>
                {data.push.by_kind.map((k) => (
                  <SignalRow key={k.kind} label={PUSH_KIND[k.kind] || k.kind}
                    value={k.pct === null ? "—" : `${k.pct} %`} detail={`${k.opened} af ${k.sent}`} />
                ))}
              </div>
            </div>
          )}
          {data.push.effect && data.push.effect.recipients > 0 && <PushEffect effect={data.push.effect} />}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
              <SubHead>Hændelser pr. dag <M id="event_views" /></SubHead>
              <select className="field" value={metric} onChange={(e) => setMetric(e.target.value)} style={{ fontSize: 12, padding: "4px 8px" }}>
                {SERIES.map((o) => <option key={o.id} value={o.id}>{o.label} ({o.id})</option>)}
              </select>
            </div>
            <MiniBars data={series} color={C.green} formatLabel={dayLabel} />
          </div>
        </div>
      )}
    </Section>
  );
}

// ---------- 3. Liga-diagnose ----------
// Afløser "Liga Health" (juli 2026). Tabellen viser tilstanden og de to
// signaler, der oftest afgør den (bredde og deltagelse); resten ligger i
// drill-in'en, hvor hvert signal har sin egen definition.
function LigaDiagnoseSection({ token, days }) {
  const { data, loading, err } = useSection(() => loadAnalyticsLeagueHealth(token, days), token, [token, days]);
  const [openId, setOpenId] = useState(null);
  const leagues = diagnoseLeagues(data?.leagues, days);
  const sum = summarizeDiagnoses(leagues);
  const th = { textAlign: "left", color: C.muted, fontSize: 12, fontWeight: 600, padding: "0 6px 6px" };

  return (
    <Section title="Liga-diagnose"
      subtitle={leagues.length ? `${sum.akut} kræver handling · ${sum.svag} med svaghedstegn · ${sum.sund} sunde · ${sum.ubedømt} kan ikke bedømmes` : undefined}
      loading={loading} err={err}>
      {leagues.length === 0 && <p style={{ ...muted, margin: 0 }}>Ingen ligaer endnu.</p>}
      {leagues.length > 0 && (
        <table style={{ width: "100%" }}><tbody>
          <tr>
            <th style={th}>Liga</th>
            <th style={th}>Tilstand</th>
            <th style={{ ...th, textAlign: "right" }}>Bredde</th>
            <th style={{ ...th, textAlign: "right" }}>Deltagelse</th>
          </tr>
          {leagues.map((l) => (
            <Fragment key={l.group_id}>
              <tr className="rowline" style={{ cursor: "pointer" }} onClick={() => setOpenId(openId === l.group_id ? null : l.group_id)}>
                <td style={{ fontWeight: 600, padding: "8px 6px" }}>{l.name}</td>
                <td style={{ padding: "8px 6px" }}><StateChip label={l.diagnosis.label} tone={l.diagnosis.tone} /></td>
                <td style={{ textAlign: "right", color: C.muted, fontSize: 13, padding: "8px 6px" }}>{l.predictors}/{l.members}</td>
                <td style={{ textAlign: "right", color: C.muted, fontSize: 13, padding: "8px 6px" }}>{pctFmt(l.completion_rate)}</td>
              </tr>
              {openId === l.group_id && (
                <tr>
                  <td colSpan={4} style={{ padding: "0 6px 14px" }}>
                    {/* Hvorfor + hvad man gør, med ligaens egne tal i sætningen
                        — et tal skal navngive sit eget omfang dér hvor det står. */}
                    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
                      <div style={{ color: C.text, fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}>
                        {l.diagnosis.why} <M id="league_state" />
                      </div>
                      {l.diagnosis.action && <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>{l.diagnosis.action}</div>}
                    </div>
                    <SignalRow label="Bredde" info={<M id="league_breadth" />}
                      value={pctFmt(l.predictor_share)} detail={`${l.predictors} af ${l.members} medlemmer tippede`} />
                    <SignalRow label="Deltagelse" info={<M id="league_completion" />}
                      value={pctFmt(l.completion_rate)} detail={`${l.completion_done} af ${l.completion_slots} mulige tips`} />
                    <SignalRow label="Retning" info={<M id="completion_trend" />}
                      value={l.completion_rate_prev === null || l.completion_rate_prev === undefined || l.completion_rate === null
                        ? "—"
                        : `${l.completion_rate - l.completion_rate_prev > 0 ? "+" : ""}${Math.round((l.completion_rate - l.completion_rate_prev) * 10) / 10} pp`}
                      detail={l.completion_rate_prev === null || l.completion_rate_prev === undefined ? "for lidt data i forrige vindue" : `forrige ${days} dage: ${l.completion_rate_prev} %`} />
                    <SignalRow label="Puls" info={<M id="league_pulse" />}
                      value={pctFmt(l.pulse)} detail={`${l.rounds_played} af ${l.rounds_available} låste runder blev spillet`} />
                    <SignalRow label="Koncentration" info={<M id="league_concentration" />}
                      value={pctFmt(l.top_predictor_share)} detail="den mest aktive tippers andel af ligaens tips" />
                    <SignalRow label="Aktive medlemmer" info={<M id="league_activity" />}
                      value={pctFmt(l.active_share)} detail={`${l.active_members} af ${l.members} åbnede appen i vinduet`} />
                    <SignalRow label="Fastholdelse" info={<M id="league_retention" />}
                      value={pctFmt(l.retention_rate)}
                      detail={l.retention_eligible ? `${l.retention_retained} af ${l.retention_eligible} medlemmer med mindst ${data.retention_min_age_days} dage på bagen` : "ingen medlemmer gamle nok endnu"} />
                    <SignalRow label="Konkurrencer" info={<M id="league_competitions" />}
                      value={`${l.competitions_active} i gang`} detail={`af ${l.competitions_total} i alt`} />
                    <SignalRow label="Story views" info={<M id="league_story_views" />}
                      value={l.story_views} detail="indgår bevidst ikke i diagnosen" />
                    <SignalRow label="Seneste aktivitet" info={<M id="league_last_activity" />}
                      value={dtFmt(l.last_activity_at)}
                      detail={l.days_since_activity === null ? "aldrig" : `for ${l.days_since_activity} ${l.days_since_activity === 1 ? "dag" : "dage"} siden`} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody></table>
      )}
      <p style={{ ...muted, margin: "12px 0 0" }}>
        Én tilstand pr. liga: den første regel, der passer, vinder — årsag før symptom, så en liga uden aktiv
        konkurrence hører dét frem for "for få tipper". Tærsklerne står samlet i <code>LEAGUE_THRESHOLDS</code>
        (<code>src/lib/analytics.js</code>) og kan ændres uden at røre databasen. Klik en række for at se hvert
        signal for sig.
      </p>
    </Section>
  );
}

// ---------- 5. Tragt for nye brugere ----------
// Onboarding v1 blev bygget på påstanden om, at selvstarteren faldt igennem,
// mens den inviterede klarede sig fint. Denne sektion er første gang, den
// påstand kan efterprøves — derfor står de to veje ind side om side, og ikke
// som en samlet total, der ville gemme forskellen.
function FunnelBar({ step, cohort }) {
  const width = cohort > 0 ? Math.max(1, (step.users / cohort) * 100) : 0;
  const bad = step.dropPct !== null && step.dropPct >= 40;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: C.text }}>{step.label}</span>
        <span style={{ color: C.muted }}>
          <b style={{ color: C.text }}>{step.users}</b> · {step.pct} %
          {step.medianMinutes !== null && step.medianMinutes !== undefined && <> · median {fmtMinutes(step.medianMinutes)}</>}
        </span>
      </div>
      <div style={{ height: 10, background: C.surface2, borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${width}%`, height: "100%", background: bad ? C.red : C.green, borderRadius: 999 }} />
      </div>
      {step.dropFromPrev > 0 && (
        <div style={{ fontSize: 11, color: bad ? C.red : C.muted, marginTop: 2 }}>
          −{step.dropFromPrev} her ({step.dropPct} % af dem, der nåede forrige trin)
        </div>
      )}
    </div>
  );
}

function FunnelColumn({ title, row, info }) {
  const steps = funnelSteps(row);
  if (!row || !row.cohort) {
    return (
      <div>
        <SubHead>{title} {info}</SubHead>
        <p style={{ ...muted, margin: 0, fontSize: 12 }}>Ingen nye brugere i vinduet.</p>
      </div>
    );
  }
  return (
    <div>
      <SubHead>{title} {info}</SubHead>
      {steps.map((s) => <FunnelBar key={s.key} step={s} cohort={row.cohort} />)}
    </div>
  );
}

function FunnelSection({ token, days }) {
  const { data, loading, err } = useSection(() => loadAnalyticsFunnel(token, days), token, [token, days]);
  // Vinduet er sandheden for "hvordan går det NU", men en 7-dages kohorte kan
  // være to brugere. Alt-tid står ved siden af som volumen, aldrig i stedet for.
  const [scope, setScope] = useState("window");
  const total = funnelRow(data, scope);
  const steps = funnelSteps(total);
  const worst = biggestDrop(steps);

  return (
    <Section title="Tragt for nye brugere"
      subtitle="Konto → liga → konkurrence → første tip. Udledt af rigtige tabeller, ikke af hændelsesloggen."
      loading={loading} err={err}>
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={chip(scope === "window")} onClick={() => setScope("window")}>Nye i vinduet</button>
            <button style={chip(scope === "all_time")} onClick={() => setScope("all_time")}>Alle brugere</button>
          </div>
          {!total || !total.cohort ? (
            <p style={{ ...muted, margin: 0 }}>Ingen brugere oprettet i perioden — vælg et længere vindue eller "Alle brugere".</p>
          ) : (
            <>
              {worst && (
                <div style={{ background: "rgba(240,180,41,0.08)", border: `1px solid ${C.gold}`, borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ color: C.muted, fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
                    Største frafald <M id="funnel" />
                  </div>
                  <div style={{ fontFamily: font.display, fontWeight: 700, fontSize: 18, color: C.gold, lineHeight: 1.2 }}>
                    {worst.label}
                  </div>
                  <div style={{ color: C.muted, fontSize: 12 }}>
                    {worst.dropFromPrev} af {total.cohort} brugere nåede ikke hertil — {worst.dropPct} % af dem, der klarede forrige trin.
                  </div>
                </div>
              )}
              <FunnelColumn title="Alle nye" row={total} info={<M id="funnel" />} />
              {/* Den opdeling, hele sektionen findes for. */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
                <FunnelColumn title="Selvstartere" row={funnelRow(data, scope, "selvstarter")} info={<M id="funnel_path" />} />
                <FunnelColumn title="Inviterede" row={funnelRow(data, scope, "inviteret")} info={<M id="funnel_path" />} />
              </div>
              <div>
                <SubHead>Hvor står de nu <M id="funnel_stalled" /></SubHead>
                {FUNNEL_STALLS.map((s) => (
                  <SignalRow key={s.key} label={s.label} value={total[s.key] ?? 0}
                    detail={total.cohort ? `${Math.round((1000 * (total[s.key] ?? 0)) / total.cohort) / 10} % af kohorten` : undefined} />
                ))}
                <p style={{ ...muted, margin: "8px 0 0", fontSize: 11 }}>
                  Disse fire tæller hver bruger præcis én gang og summer til kohorten — modsat trinnene ovenfor,
                  som ikke er strengt indlejrede (en liga-løs konkurrence kan nås uden en liga). <M id="funnel_time" />
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </Section>
  );
}

// ---------- 6. Story Engine-regler ----------
function StoriesSection({ token, days }) {
  const { data, loading, err } = useSection(() => loadAnalyticsStories(token, days), token, [token, days]);
  const rows = storyRuleRows(data);
  const never = rows.filter((r) => r.never);
  const coverage = data && data.users_with_rounds
    ? Math.round((1000 * data.users_reached) / data.users_with_rounds) / 10 : null;
  const th = { textAlign: "right", color: C.muted, fontSize: 11, fontWeight: 600, padding: "0 4px 6px" };

  return (
    <Section title="Story Engine-regler"
      subtitle="Hvilke regler udløser, og hvordan reagerer folk på dem."
      loading={loading} err={err}>
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <StatGroup title="Samlet">
            <StatTile label="Historier genereret" value={data.generated_total} hint={`til ${data.users_reached} brugere`} info={<M id="story_rules" />} />
            <StatTile label="Dækning" value={coverage === null ? "—" : `${coverage} %`}
              hint={`${data.users_reached} af ${data.users_with_rounds} med en låst runde`} info={<M id="story_coverage" />} />
          </StatGroup>
          {never.length > 0 && (
            <div style={{ background: "rgba(239,68,68,0.07)", border: `1px solid ${C.red}`, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ color: C.text, fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}>
                {never.length} {never.length === 1 ? "regel har" : "regler har"} aldrig udløst <M id="story_never" />
              </div>
              <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
                {never.map((r) => r.label).join(" · ")} — hverken i vinduet eller nogensinde. Enten er tærsklen for stram, eller reglen virker ikke.
              </div>
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Regel</th>
                  <th style={th}>Genereret</th>
                  <th style={th}>Vist</th>
                  <th style={th}>Delt</th>
                  <th style={th}>Afvist</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rule} className="rowline" style={{ opacity: r.never ? 0.45 : 1 }}>
                    <td style={{ padding: "6px 4px", color: C.text }}>
                      {r.label}
                      {r.never && <span style={{ color: C.red, fontSize: 10, marginLeft: 6 }}>ALDRIG</span>}
                      {r.silent && <span style={{ color: C.muted, fontSize: 10, marginLeft: 6 }}>STILLE</span>}
                      {r.unknown && <span style={{ color: C.gold, fontSize: 10, marginLeft: 6 }}>UKENDT</span>}
                    </td>
                    <td style={{ ...th, padding: "6px 4px", color: C.text }}>{r.generated}</td>
                    <td style={{ ...th, padding: "6px 4px", color: C.muted }}>{r.viewed}{r.view_rate !== null && ` (${r.view_rate} %)`}</td>
                    <td style={{ ...th, padding: "6px 4px", color: C.muted }}>{r.shared}</td>
                    <td style={{ ...th, padding: "6px 4px", color: C.muted }}>{r.dismissed}{r.dismiss_rate !== null && ` (${r.dismiss_rate} %)`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ ...muted, margin: 0, fontSize: 11 }}>
            <b>Genereret</b> og <b>afvist</b> er rigtige rækker i <code>stories</code> og dermed præcise.
            <b> Vist</b> og <b>delt</b> kommer fra hændelsesloggen og er et <b>gulv</b> — en lav visningsrate kan
            lige så godt være tabt logning som en historie, ingen så. Sammenlign regler med hinanden, ikke med et ideal.
            <b> ALDRIG</b> = har aldrig udløst; <b>STILLE</b> = har udløst før, men ikke i vinduet.
          </p>
        </div>
      )}
    </Section>
  );
}

// ---------- 4. Retention ----------
const MILESTONES = [1, 4, 12, 26, 52];

function isMilestoneUnmeasurable(wk, since) {
  if (!since) return true;
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - wk * 7);
  return windowStart < new Date(since);
}

function RetentionSection({ token }) {
  const { data, loading, err } = useSection(() => loadAnalyticsRetention(token), token, [token]);

  if (!data) return <Section title="Retention" loading={loading} err={err} />;

  const since = data.activity_since;
  const milestoneRows = (arr) => {
    const byWeek = Object.fromEntries((arr || []).map((r) => [r.week, r]));
    return MILESTONES.map((wk) => {
      const r = byWeek[wk];
      const disabled = isMilestoneUnmeasurable(wk, since) || !r || r.eligible === 0;
      return { wk, pct: r?.pct ?? null, eligible: r?.eligible ?? 0, retained: r?.retained ?? 0, disabled };
    });
  };
  const userRows = milestoneRows(data.user_retention);
  const leagueRows = milestoneRows(data.league_retention);

  // Kohortematrix: seneste 12 ugentlige tilmeldings-kohorter × 5 milepæle.
  const cohortColumns = MILESTONES.map((wk) => ({ key: wk, label: `U${wk}` }));
  const byCohort = new Map();
  for (const r of data.user_cohorts || []) {
    if (!byCohort.has(r.cohort_week)) byCohort.set(r.cohort_week, { key: r.cohort_week, label: dtFmt(r.cohort_week), cells: {} });
    const disabled = isMilestoneUnmeasurable(r.week, since) || r.eligible === 0;
    byCohort.get(r.cohort_week).cells[r.week] = {
      pct: r.pct, disabled, reason: disabled ? "Ingen data endnu, eller ingen nye brugere i den uge" : undefined,
    };
  }
  const cohortRows = [...byCohort.values()].sort((a, b) => (a.key < b.key ? 1 : -1));

  return (
    <Section title="Retention" subtitle="Uafhængig af vinduesvælgeren — milepælene måles fra hver brugers eller ligas egen oprettelse." loading={loading} err={err}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <SubHead>Brugere <M id="user_retention" /></SubHead>
          <Grid2>
            {userRows.map((r) => (
              <StatTile key={r.wk} label={`Uge ${r.wk}`} value={r.disabled ? "—" : `${r.pct} %`}
                hint={r.disabled ? "Ingen data endnu" : `${r.retained} af ${r.eligible}`} />
            ))}
          </Grid2>
        </div>
        <div>
          <SubHead>Ligaer <M id="league_retention_agg" /></SubHead>
          <Grid2>
            {leagueRows.map((r) => (
              <StatTile key={r.wk} label={`Uge ${r.wk}`} value={r.disabled ? "—" : `${r.pct} %`}
                hint={r.disabled ? "Ingen data endnu" : `${r.retained} af ${r.eligible}`} />
            ))}
          </Grid2>
        </div>
        {cohortRows.length > 0 && (
          <div>
            <SubHead>Seneste kohorter (brugere, pr. tilmeldingsuge) <M id="user_cohorts" /></SubHead>
            <PctGrid columns={cohortColumns} rows={cohortRows} />
          </div>
        )}
        <p style={{ ...muted, margin: 0 }}>
          Aktivitetstal begynder først at samle sig fra {since ? dtFmt(since) : "…"} — en milepæl, hvis vindue åbner før dén dato, vises som "Ingen data endnu", ALDRIG som et forkert 0 %.
        </p>
      </div>
    </Section>
  );
}

// ---------- Top-level panel ----------
function AnalyticsPanel({ token }) {
  const [days, setDays] = useState(30);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {[7, 30, 90].map((d) => (
          <button key={d} style={chip(days === d)} onClick={() => setDays(d)}>{d} dage</button>
        ))}
      </div>
      {/* Rækkefølgen følger brugerens rejse: kommer de ind (tragt), bliver de
          (sundhed/engagement), hvad ser de (Story Engine), hvor bor de
          (liga-diagnose), og bliver de hængende (retention). */}
      <FunnelSection token={token} days={days} />
      <HealthSection token={token} days={days} />
      <EngagementSection token={token} days={days} />
      <StoriesSection token={token} days={days} />
      <LigaDiagnoseSection token={token} days={days} />
      <RetentionSection token={token} />
    </div>
  );
}

export default AnalyticsPanel;
