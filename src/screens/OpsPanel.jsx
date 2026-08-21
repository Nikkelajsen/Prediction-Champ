// Admin → Drift: hvordan har de planlagte jobs det?
//
// Egen fil frem for endnu en sektion i AdminScreen.jsx (307 linjer, noteret
// som teknisk gæld i DOCUMENTATION.md afsnit 12) — samme valg som
// AnalyticsPanel.jsx traf.
//
// Panelet svarer på ét spørgsmål: kører jobbene? Registeret over hvilke jobs
// der SKAL findes, står i docs/CRON.md, og tavshedsgrænserne er de samme som i
// .github/workflows/job-heartbeat.yml. Denne skærm er den hurtige aflæsning;
// heartbeat-workflowen er den, der råber, når ingen kigger.
import { useState, useEffect } from "react";
import { RefreshCw, Loader2, Eye, Bug, CalendarCheck } from "lucide-react";
import { C, btnGhost, muted } from "../ui/theme.js";
import { Card, H, StateChip, SignalRow } from "../ui/components.jsx";
import {
  loadClientErrors,
  loadJobHealth,
  loadSeasons,
  setSeasonFinished,
  mergeJobHealth,
  previewNotifications,
  summarizeOutbox,
  STATE_LABEL,
  fmtSince,
  fmtRate,
  fmtVarighed,
} from "../lib/ops.js";

// Tonen følger StateChips regel: ORDET er signalet, farven er kun ekstra.
// "Ingen kørsler" får bevidst ingen tone — "vi ved det ikke" må ikke kunne
// forveksles med "det er fint".
const TONE = { ok: "green", ustabil: "gold", fejler: "red", tavs: "red", ukendt: null };

// Ét vindues fejlrate. Tier helt, når vinduet er tomt eller umålt — se
// `raten()` i ops.js for forskellen på de to.
function RateRow({ label, v }) {
  if (!v?.runs) return null;
  return (
    <SignalRow
      label={label}
      value={`${v.failures} af ${v.runs}`}
      detail={v.rate === null ? undefined : fmtRate(v.rate)}
    />
  );
}

// Én varighedsrække (G114). Tager enten ét tal (`ms`, den seneste kørsel) eller
// et vindues median/maksimum (`v`). Tier helt, når værdien er umålt — se
// `varigheder()` i ops.js for de to grunde, den kan være det.
function DurationRow({ label, ms, v }) {
  const midt = ms !== undefined ? ms : v?.p50;
  if (midt === null || midt === undefined) return null;
  return (
    <SignalRow
      label={label}
      value={fmtVarighed(midt)}
      detail={v?.max === null || v?.max === undefined ? undefined : `max ${fmtVarighed(v.max)}`}
    />
  );
}

function JobCard({ j }) {
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <div style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>{j.label}</div>
          <div style={{ ...muted, fontSize: 11 }}>
            {j.job} · forventet {j.kadence}
          </div>
        </div>
        <StateChip label={STATE_LABEL[j.state]} tone={TONE[j.state]} />
      </div>

      <div style={{ marginTop: 8 }}>
        <SignalRow label="Sidste kørsel" value={fmtSince(j.silentFor)} />
        <SignalRow label="Sidste vellykkede" value={j.lastOkAt ? fmtSince(j.okSilentFor) : "aldrig"} />
        <SignalRow
          label="Fejl i træk"
          value={j.failures}
          detail={j.failures >= 3 ? "→ heartbeat slår alarm" : undefined}
        />
        {/* Fejlraten i to vinduer (G115). Rå tal FØR procenten, fordi nævneren
            selv er oplysningen: "2 af 1.431" og "2 af 2" er samme brøk og to
            helt forskellige situationer. Procenten står som detalje og kun,
            når der er kørsler nok til, at den betyder noget.

            En række vises slet ikke, hvis vinduet er tomt eller feltet mangler
            — så er raten UMÅLT, og en umålt rate må ikke vises som nul. Timen
            er tom for et 12-timers job, og det er ikke en oplysning. */}
        <RateRow label="Fejl (1 t)" v={j.hour} />
        <RateRow label="Fejl (24 t)" v={j.day} />
        {/* Varigheden (G114). Medianen som værdi, maksimum som detalje: den
            første siger, hvad der er NORMALT, den anden hvor tæt på kanten den
            værste kørsel var. `G109` ville have stået med ~10 s og ~13 s, og
            de to tal er hele historien.

            En række vises slet ikke, når varigheden er umålt — feltet mangler
            (migreringen er ikke kørt) eller kørslerne afsluttede aldrig. En
            umålt varighed må ikke kunne forveksles med en hurtig. */}
        <DurationRow label="Varighed (seneste)" ms={j.lastMs} />
        <DurationRow label="Varighed (1 t)" v={j.hourMs} />
        <DurationRow label="Varighed (24 t)" v={j.dayMs} />
        {/* Hvilken adresse jobbet faktisk kalder ind på (A46). Står nederst,
            fordi det er en OPSÆTNING og ikke et helbredssignal: de fem rækker
            ovenfor skifter fra kørsel til kørsel, denne kun når nogen retter
            jobbet i cron-job.org.

            Rækken vises slet ikke, når værtsnavnet mangler — kørslen er da
            skrevet af kode fra før 13. august 2026, og en manglende måling må
            ikke kunne forveksles med en adresse. */}
        {j.lastHost && <SignalRow label="Kaldt på" value={j.lastHost} />}
      </div>

      {/* Den diagnose, `G109` manglede ord for: jobbet VIRKER, men er ved at
          løbe tør for tid hos den, der kalder det. Ikke en tilstand og ikke en
          farve på chippen — et grønt flueben på en kørsel, der tog 26 sekunder,
          er stadig et grønt flueben, og det er præcis dét, sætningen siger. */}
      {j.nearCallerLimit && (
        <p style={{ color: C.gold, fontSize: 11, marginTop: 8, marginBottom: 0 }}>
          Den længste kørsel tog {fmtVarighed(Math.max(j.hourMs?.max ?? 0, j.dayMs?.max ?? 0))} — tæt på
          cron-job.orgs vindue på 30 sekunder. Kørslerne lykkes, men en, der klippes over, når
          hverken at skrive sin række eller at rydde op. Se <code>docs/CRON.md</code>.
        </p>
      )}

      {/* Den ene sætning, kortet manglede 14. august 2026. Uden den ligner et
          job med "0 fejl i træk" et sundt job — også når det fejler to ud af
          tre kørsler, hvilket er præcis, hvad `sync-live` gjorde. */}
      {j.unstableRate && j.failures === 0 && (
        <p style={{ color: C.gold, fontSize: 11, marginTop: 8, marginBottom: 0 }}>
          Jobbet fejler {fmtRate(j.hour.rate ?? j.day.rate)} af sine kørsler
          {j.hour.rate === null ? " i døgnet" : " den sidste time"}, men den seneste lykkedes —
          derfor står "Fejl i træk" på nul. En fejlrate kan ikke ses i en fejlserie.
        </p>
      )}

      {j.state === "ukendt" && (
        <p style={{ ...muted, fontSize: 11, marginTop: 8, marginBottom: 0 }}>
          Jobbet har aldrig meldt sig. Enten er <code>sql/job_runs.sql</code> ikke kørt endnu, eller
          også findes jobbet ikke i cron-job.org — se <code>docs/CRON.md</code>.
        </p>
      )}

      {j.unexpected && (
        <p style={{ ...muted, fontSize: 11, marginTop: 8, marginBottom: 0 }}>
          Jobbet har meldt sig, men svarer ikke til nogen turnering. Enten peger et cron-job på en
          liga, der ikke findes, eller også er det en gammel række fra dengang alle turneringer
          skrev samme jobnavn — de sidste forsvinder af sig selv, når <code>job_runs</code> ryddes.
          Tavshed kan ikke måles her, fordi der ingen forventet kadence er.
        </p>
      )}

      {j.state === "tavs" && (
        <p style={{ color: C.red, fontSize: 11, marginTop: 8, marginBottom: 0 }}>
          Jobbet har ikke meldt sig længe nok til, at noget er galt. Tjek først, om cron-job.org har
          deaktiveret det efter gentagne fejl — et deaktiveret job skriver ingenting og ligner ro.
        </p>
      )}

      {j.lastError && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ ...muted, fontSize: 11, cursor: "pointer" }}>Seneste fejl</summary>
          {/* Ingen fontFamily: en <pre> er monospace i forvejen, og det er
              det rigtige for rå fejltekst og JSON — tegnene skal kunne
              skelnes, og kolonnerne skal stå. Her stod `...font`, hvilket
              satte CSS-egenskaben `display` til et skriftnavn (`font` er
              {display, body}, ikke et style-objekt). Browseren ignorerede
              det, så visningen er uændret; kun løftet om at gøre noget er
              væk. */}
          <pre
            style={{
              fontSize: 10,
              color: C.muted,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: "6px 0 0",
              maxHeight: 160,
              overflowY: "auto",
            }}
          >
            {j.lastError}
          </pre>
        </details>
      )}

      {j.lastDetail && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ ...muted, fontSize: 11, cursor: "pointer" }}>Seneste resumé</summary>
          {/* Samme valg som ovenfor. */}
          <pre
            style={{
              fontSize: 10,
              color: C.muted,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: "6px 0 0",
            }}
          >
            {JSON.stringify(j.lastDetail, null, 2)}
          </pre>
        </details>
      )}
    </Card>
  );
}

// Forhåndsvisning af notifikations-outboxen (?dryRun=true).
//
// Kortet er en LÆSNING og ikke en handling: der sendes intet, reserveres intet
// i notification_log og skrives ingen række i job_runs. Derfor den dæmpede
// knap — den skal ikke kunne forveksles med de knapper, der ændrer noget.
//
// Det er også den eneste vej til en forhåndsvisning uden SYNC_SECRET. Behovet
// blev fundet under G51 (august 2026), hvor den falske runde-besked skulle
// efterprøves, og den eneste vej var at hente hemmeligheden i Vercel og kalde
// endpointet i hånden.
function PreviewCard({ token }) {
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");

  async function run() {
    setLoading(true);
    setErr("");
    setRes(null);
    try {
      setRes(await previewNotifications(token));
    } catch (e) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 60%", minWidth: 0 }}>
          <div style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>Forhåndsvis notifikationer</div>
          <div style={{ ...muted, fontSize: 11 }}>
            Viser hvad næste kørsel ville sende. Sender intet, reserverer intet.
          </div>
        </div>
        <button style={btnGhost} onClick={run} disabled={loading}>
          {loading ? <Loader2 size={14} className="spin" /> : <Eye size={14} />} Vis hvad der venter
        </button>
      </div>

      {err && <p style={{ color: C.red, fontSize: 12, margin: "10px 0 0" }}>{err}</p>}

      {res && <OutboxPreview res={res} />}
    </Card>
  );
}

// Selve aflæsningen, skilt fra knappen så den kan afprøves uden et klik.
// Delingen er ikke kosmetisk: hele værdien af kortet ligger i de to
// formuleringer nedenfor, og den ene af dem er kontraintuitiv.
function OutboxPreview({ res }) {
  const rows = summarizeOutbox(res.wouldSend);
  return (
    <div style={{ marginTop: 10 }}>
      {/* Noten kommer fra endpointet og skrives ikke om her — den er også
          stedet, hvor "klokken er uden for sendevinduet" bliver sagt, og den
          formulering skal kun findes ét sted. */}
      <p style={{ ...muted, fontSize: 11, margin: 0 }}>{res.note}</p>

      {rows.length === 0 ? (
        // Forbeholdet er hele grunden til, at tomheden kan læses forkert:
        // wouldSend er filtreret mod notification_log, så en allerede sendt
        // besked er usynlig her. Uden sætningen ville "ingen beskeder venter"
        // se ud som "der er ikke noget at sende" — to forskellige ting.
        <p style={{ ...muted, fontSize: 12, margin: "8px 0 0" }}>
          Ingen beskeder venter. Bemærk: listen er filtreret mod <code>notification_log</code>, så
          tom betyder <em>intet nyt</em> — ikke, at der intet findes.
        </p>
      ) : (
        <div style={{ marginTop: 8 }}>
          {rows.map((r) => (
            <div key={r.key} style={{ borderTop: `1px solid ${C.surface2}`, padding: "8px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span style={{ color: C.gold, fontSize: 11, fontWeight: 700 }}>{r.kindLabel}</span>
                <span style={{ ...muted, fontSize: 11 }}>
                  {r.recipients} {r.recipients === 1 ? "modtager" : "modtagere"}
                </span>
              </div>
              <div style={{ color: C.text, fontSize: 13, fontWeight: 600, marginTop: 2 }}>{r.title}</div>
              <div style={{ ...muted, fontSize: 12 }}>{r.body}</div>
              <code style={{ ...muted, fontSize: 10 }}>{r.key}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// `leagues` kommer ind som prop og hentes ikke her: AdminScreen har dem i
// forvejen (Kampe- og Resultat-panelerne bruger dem), og de er selve den
// forventning, listen fletter mod — ét kampprogram-job pr. turnering (G44).
// Frontendens fejlrapporter (G42). Ét kort med de nyeste; tomt er den normale
// tilstand og siges derfor højt — en tom liste her betyder "ingen crash", ikke
// "vi måler ikke".
//
// Beskeden og stakken står i en <pre>, fordi et stakspor er kolonneopdelt tekst
// og bliver ulæseligt, når det ombrydes. Kortet henter først ved åbning, som
// forhåndsvisningen ovenfor: en admin, der kigger på jobbene, skal ikke betale
// for et opslag, de ikke bad om.
function ErrorsCard({ token }) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true); setErr("");
    try {
      setRows(await loadClientErrors(token, 50));
    } catch (e) {
      setErr(
        String(e?.message ?? e).includes("admin_client_errors")
          ? "Kunne ikke læse fejlrapporter. Er sql/client_errors.sql kørt i Supabase?"
          : String(e?.message ?? e)
      );
    } finally { setLoading(false); }
  }

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Bug size={15} color={C.muted} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>Fejl i appen</span>
        </div>
        <button style={btnGhost} onClick={load} disabled={loading}>
          {loading ? <Loader2 size={14} /> : <RefreshCw size={14} />} {rows ? "Opdatér" : "Hent"}
        </button>
      </div>
      <p style={{ ...muted, fontSize: 12, margin: "8px 0 0" }}>
        Crash i brugernes browsere, som de selv aldrig ville melde. Hver række bærer skærm,
        version og browser. Samme fejl rapporteres kun én gang pr. sideliv, og højst ti pr.
        bruger pr. sideliv — listen er derfor forskellige problemer, ikke gentagelser.
      </p>
      {err && <p style={{ color: C.red, fontSize: 12, margin: "8px 0 0" }}>{err}</p>}
      {rows && rows.length === 0 && (
        <p style={{ ...muted, fontSize: 12, margin: "8px 0 0" }}>
          Ingen fejl rapporteret. Det er den forventede tilstand — listen er tom, fordi der
          ikke er sket noget, ikke fordi der ikke måles.
        </p>
      )}
      {rows && rows.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {rows.map((r) => (
            <div key={r.id} style={{ background: C.surface2, borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span style={{ color: C.red, fontSize: 13, fontWeight: 600, minWidth: 0 }}>{r.message}</span>
                <span style={{ ...muted, fontSize: 11, whiteSpace: "nowrap" }}>
                  {new Date(r.created_at).toLocaleString("da-DK")}
                </span>
              </div>
              <div style={{ ...muted, fontSize: 11, marginTop: 3 }}>
                {r.kind} · {r.screen || "ukendt skærm"} · v{r.app_version || "?"}
                {r.display_name ? ` · ${r.display_name}` : ""}
              </div>
              {(r.stack || r.component_stack) && (
                <pre style={{ margin: "6px 0 0", fontSize: 10, color: C.muted, overflowX: "auto" }}>
                  {r.stack || r.component_stack}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// Sæsonernes slutning — bagstopperen for sæson-gaten (sql/season_end.sql).
//
// Gaten holder en konkurrence åben, indtil sæsonen selv siger, at den er slut.
// Datakilden svarer normalt: Sportmonks har et `finished`-felt,
// football-data.org går videre til næste sæson. Men gør den det ikke, er der
// ingen anden vej end at vente på 30-dages ventilen — og det er dét, denne
// tabel og dens ene knap findes for.
//
// Kortet er derfor ikke en oversigt over sæsoner. Det er et sted at se, om
// NOGET HÆNGER: en sæson med nul uspillede kampe, ingen slutdato og et flag,
// der stadig er falsk, er den ene, nogen skal røre.
function SeasonsCard({ token }) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true); setErr("");
    try {
      setRows(await loadSeasons(token));
    } catch (e) {
      setErr(
        String(e?.message ?? e).includes("admin_seasons")
          ? "Kunne ikke læse sæsonerne. Er sql/season_end.sql kørt i Supabase?"
          : String(e?.message ?? e)
      );
    } finally { setLoading(false); }
  }

  async function toggle(row) {
    setBusyId(row.season_id); setErr("");
    try { await setSeasonFinished(token, row.season_id, !row.is_finished); await load(); }
    catch (e) { setErr(String(e?.message ?? e)); }
    finally { setBusyId(null); }
  }

  const dato = (v) => (v ? String(v).slice(0, 10) : "—");

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <CalendarCheck size={15} color={C.muted} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>Sæsonernes slutning</span>
        </div>
        <button style={btnGhost} onClick={load} disabled={loading}>
          {loading ? <Loader2 size={14} /> : <RefreshCw size={14} />} {rows ? "Opdatér" : "Hent"}
        </button>
      </div>
      <p style={{ ...muted, fontSize: 12, margin: "8px 0 0" }}>
        En konkurrence meldes først færdig, når dens sæson er det — ellers ville en sæson med
        flere stages afslutte den, hver gang grundspillet sluttede. Sync sætter flaget, når
        datakilden siger det. Gør den ikke, kan det sættes her.
      </p>
      {err && <p role="alert" style={{ color: C.red, fontSize: 12, margin: "8px 0 0" }}>{err}</p>}
      {rows && rows.length === 0 && (
        <p style={{ ...muted, fontSize: 12, margin: "8px 0 0" }}>Ingen sæsoner endnu.</p>
      )}
      {rows && rows.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {rows.map((r) => {
            // "Venter" = alt er spillet, men intet siger, at sæsonen er slut.
            // Det er den eneste tilstand, der kræver et menneske.
            const venter = !r.is_finished && !r.ends_at && r.matches > 0 && r.unplayed === 0;
            return (
              <div key={r.season_id} style={{ background: C.surface2, borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{r.league_name} · {r.season_name}</span>
                  <StateChip label={r.is_finished ? "Slut" : venter ? "Venter" : "I gang"}
                    tone={r.is_finished ? "green" : venter ? "gold" : null} />
                </div>
                <div style={{ ...muted, fontSize: 11, marginTop: 3 }}>
                  Slutdato {dato(r.ends_at)} · sidste kamp {dato(r.last_kickoff)} · {r.unplayed} af {r.matches} uspillet
                </div>
                <button style={{ ...btnGhost, marginTop: 6, opacity: busyId === r.season_id ? 0.6 : 1 }}
                  disabled={busyId === r.season_id} onClick={() => toggle(r)}>
                  {r.is_finished ? "Åbn sæsonen igen" : "Markér som slut"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function OpsPanel({ token, leagues }) {
  const [jobs, setJobs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    setErr("");
    try {
      setJobs(mergeJobHealth(await loadJobHealth(token), { leagues }));
    } catch (e) {
      // Den hyppigste årsag lige efter levering er, at migreringen ikke er kørt
      // endnu — så sig det frem for at vise en rå PostgREST-fejl.
      setErr(
        String(e?.message ?? e).includes("admin_job_health")
          ? "Kunne ikke læse driftsdata. Er sql/job_runs.sql kørt i Supabase?"
          : String(e?.message ?? e)
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Hent-ved-montering. Reglerne nedenfor slås fra med vilje og med navn —
    // modsat de 25 bare `// eslint-disable-line` andre steder i src/, som
    // slår ALT fra på deres linje og er selvstændig gæld:
    //   set-state-in-effect: at hente data i en effekt og sætte state er
    //     præcis det mønster, resten af skærmene bruger. At undgå den regel
    //     kræver et data-bibliotek, projektet bevidst ikke har.
    //   exhaustive-deps: `load` genskabes ved hver render og ville få
    //     effekten til at løbe i ring, hvis den stod i afhængighederne.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // `leagues` er med, fordi den forventede jobliste udledes af den: kommer
    // turneringerne først efter montering, ville listen ellers blive stående
    // uden sine kampprogram-jobs — altså præcis den tomhed, G44 ville væk fra.
  }, [token, leagues]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <H>Planlagte jobs</H>
        <button style={btnGhost} onClick={load} disabled={loading}>
          {loading ? <Loader2 size={14} /> : <RefreshCw size={14} />} Opdatér
        </button>
      </div>

      <p style={{ ...muted, fontSize: 12, margin: 0 }}>
        Jobbene kører på cron-job.org uden for appen. Registeret over dem står i{" "}
        <code>docs/CRON.md</code>. Et job, der er blevet deaktiveret, skriver ingen rækker — derfor
        vises "Tavs" ud fra hvor længe siden det sidst meldte sig, ikke ud fra en fejl.
      </p>

      {err && <p style={{ color: C.red, fontSize: 12, margin: 0 }}>{err}</p>}
      {loading && !jobs && <p style={{ ...muted, margin: 0 }}>Henter …</p>}

      {jobs && jobs.map((j) => <JobCard key={j.job} j={j} />)}

      <PreviewCard token={token} />
      <SeasonsCard token={token} />
      <ErrorsCard token={token} />
    </div>
  );
}

export default OpsPanel;
export { PreviewCard, OutboxPreview, ErrorsCard, SeasonsCard };
