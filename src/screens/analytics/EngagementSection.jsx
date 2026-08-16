// Sektion 2: engagement — aktive brugere, serier og push-effekten.
import { useState } from "react";

import { loadAnalyticsEngagement, shareSurfaceRows } from "../../lib/analytics.js";

import { C } from "../../ui/theme.js";
import { StatTile, StatGroup, MiniBars, SignalRow } from "../../ui/components.jsx";
import { M, Section, SubHead, useSection, dayLabel, fmtDur } from "./shared.jsx";

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
// Nøglerne er præfikset i notification_log.key (api/send-notifications.js).
// Splittet i SQL'en er generisk (split_part på ':'), så en ny beskedtype dukker
// op af sig selv her — men uden sin etiket, og står så med sit rå præfiks.
const PUSH_KIND = { deadline: "Deadline-påmindelse", result: "Runde-resultat", newcomp: "Ny konkurrence" };

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
          <SubHead>Varsel før første lås <M id="push_lead_time" /></SubHead>
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
  // `null` = RPC'en er ikke gen-kørt, altså UMÅLT. Må ikke vises som fire nuller.
  const shares = shareSurfaceRows(data);

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
          {/* Invitationstragten (I7). Indtil august 2026 blev sendt og accepteret
              logget, men vistes ingen steder — og trinnet imellem fandtes ikke.
              De tre tal står side om side, fordi det er FORHOLDET mellem dem,
              der er oplysningen: falder folk fra mellem sendt og landet, er det
              linket; mellem landet og accepteret, er det bekræftelsen. */}
          <StatGroup title="Invitationer">
            <StatTile label="Invitationer sendt" value={ev.league_invite_sent?.count ?? 0}
              hint={`${ev.league_invite_sent?.users ?? 0} afsendere`} info={<M id="invite_funnel" />} />
            <StatTile label="Invitationer landet" value={ev.invite_landed?.count ?? 0}
              hint={`${ev.invite_landed?.users ?? 0} modtagere med konto`} info={<M id="invite_funnel" />} />
            <StatTile label="Invitationer accepteret" value={ev.league_invite_accepted?.count ?? 0}
              hint={`${ev.league_invite_accepted?.users ?? 0} nye medlemmer`} info={<M id="invite_funnel" />} />
          </StatGroup>
          {/* Deling (B37). De to totaler kommer fra `events`-optællingen og har
              altid været i svaret — de manglede bare et sted at stå, og et
              måletal, ingen aflæser, ligner "funktionen bruges ikke".
              Opdelingen nedenunder kræver derimod, at RPC'en er gen-kørt. */}
          <StatGroup title="Deling">
            <StatTile label="Historier delt" value={ev.story_shared?.count ?? 0}
              hint={`${ev.story_shared?.users ?? 0} brugere · tre flader`} info={<M id="share_surfaces" />} />
            <StatTile label="Stillinger delt" value={ev.standings_shared?.count ?? 0}
              hint={`${ev.standings_shared?.users ?? 0} brugere`} info={<M id="share_surfaces" />} />
          </StatGroup>
          <div>
            <SubHead>Hvorfra deles der? <M id="share_surfaces" /></SubHead>
            {shares
              ? shares.map((f) => (
                  <SignalRow key={f.id} label={f.label} value={f.count}
                    detail={`${f.hint} · ${f.users} ${f.users === 1 ? "bruger" : "brugere"}`} />
                ))
              : (
                <div style={{ color: C.muted, fontSize: 12 }}>
                  Ikke målt endnu — opdelingen kræver, at <code>sql/analytics_dashboard.sql</code> er
                  gen-kørt. <b>Ikke det samme som nul delinger:</b> totalerne ovenfor tælles uafhængigt
                  af den og er rigtige nu.
                </div>
              )}
          </div>
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

export { EngagementSection };
