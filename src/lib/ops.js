// Drift: aflæsning af de planlagte jobs' helbred (Admin → Drift).
//
// Egen fil frem for endnu en funktion i data.js (761 linjer, noteret som
// teknisk gæld i DOCUMENTATION.md afsnit 12) — samme valg som analytics.js
// traf, af samme grund.
//
// Registeret over hvilke jobs der SKAL findes, står i docs/CRON.md. Denne fil
// viser kun, hvad de faktisk har meldt.
import { restFetch } from "./supabase.js";

// Forventet kadence pr. job. Skal holdes i trit med docs/CRON.md og med
// tavshedsgrænserne i .github/workflows/job-heartbeat.yml — de tre steder
// beskriver det samme og skal ændres sammen.
//
// Kadencen for kampsynkroniseringen er **hver 12. time** (G6, august 2026).
// Tallet stod før fire forskellige steder med fire forskellige værdier ("hver
// 6. time" her og i heartbeat'en, "hver 12. time" i registeret, "hvert 10.-15.
// minut" i DOCUMENTATION.md §8, "pt. hver time" i ROADMAP.md). Registeret vandt,
// fordi det er det ene af de fire, der beskriver, hvad der faktisk er sat op i
// cron-job.org — og alarmgrænsen var samtidig strammere end det skema, den skulle
// overvåge: 14 timer mod et 12-timers interval gav to timers luft.
const BASE_JOBS = [
  { job: "sync-live", label: "Live-resultater", kadence: "hvert minut", stilhedMs: 30 * 60 * 1000 },
  {
    job: "send-notifications",
    label: "Push-notifikationer",
    kadence: "hver 15.–30. minut",
    stilhedMs: 3 * 60 * 60 * 1000,
  },
];

const SYNC_MATCHES_KADENCE = "hver 12. time";
// To hele intervaller plus to timers luft, så ét sprunget interval ikke larmer.
const SYNC_MATCHES_SILENCE_MS = 26 * 60 * 60 * 1000;

// Den forventede jobliste: de to faste plus ét kampprogram-job pr. turnering.
//
// Listen UDLEDES af `leagues` og er ikke skrevet ned (G44). Det er hele
// forskellen: skrevet ned ville den forældes, hver gang en turnering kom til —
// og syv turneringer delte indtil august 2026 én række i driftsloggen, så én
// sund turnering skjulte en permanent fejlende. Præcis den fejlklasse var `B8`,
// og den blev kun fundet, fordi nogen kiggede manuelt.
//
// Nøglen er liga-UUID'en, samme værdi som api/_shared.js' syncMatchesJob()
// skriver. Menneskenavnet kommer fra samme række, så de to ikke kan drive.
function expectedJobs(leagues) {
  return [
    ...BASE_JOBS,
    ...(leagues || []).map((l) => ({
      job: `sync-matches:${l.id}`,
      label: `Kampprogram · ${l.name}`,
      kadence: SYNC_MATCHES_KADENCE,
      stilhedMs: SYNC_MATCHES_SILENCE_MS,
    })),
  ];
}

const loadJobHealth = (token) =>
  restFetch(`/rest/v1/rpc/admin_job_health`, { method: "POST", token, body: {} });

// Frontendens fejlrapporter (G42). Samme form som ovenfor: admin-gatet RPC,
// som kaster, hvis kalderen ikke er admin — adgangen står i funktionen og ikke
// i en policy-betingelse.
const loadClientErrors = (token, maxRows = 50) =>
  restFetch(`/rest/v1/rpc/admin_client_errors`, { method: "POST", token, body: { max_rows: maxRows } });

// Forhåndsvisning af, hvad notifikations-jobbet ville sende lige nu.
//
// Adgangen er admin-brugerens eget token — `isAuthorized()` i api/_shared.js
// accepterer et admin-JWT ved siden af cron-hemmeligheden, og det er samme vej
// som "Hent nu" i Admin → Kampe. Det er hele grunden til, at knappen hører
// hjemme her: SYNC_SECRET findes kun i Vercels miljøvariabler, så uden denne
// vej kræver en forhåndsvisning, at man henter hemmeligheden og kalder
// endpointet i hånden. Access-tokenen ligger i appens hukommelse og ikke i
// localStorage (App.jsx gemmer kun refresh_token), så konsollen er heller ikke
// en genvej.
//
// Plain `fetch` og ikke `restFetch`: endpointet er appens eget, ikke Supabases.
// Kaldet sender intet, reserverer intet i notification_log og skriver ingen
// række i job_runs — se api/send-notifications.js.
async function previewNotifications(token) {
  const res = await fetch(`/api/send-notifications?dryRun=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Forhåndsvisningen fejlede (${res.status})`);
  return data;
}

const KIND_LABEL = {
  deadline: "Deadline-påmindelse",
  result: "Runde-resultat",
  newcomp: "Ny konkurrence",
};

// Outboxen er (besked × bruger), så en runde med 18 tippere er 18 næsten ens
// rækker. Grupperingen pr. nøgle er derfor ikke pynt: den gør listen læselig,
// og antallet af modtagere er selv det interessante tal — det var præcis dét,
// der var forkert, da G51 meldte en igangværende runde færdig ("nr. 2 af 18").
//
// Beskedtypen udledes af nøglens præfiks (`result:`, `deadline:`, `newcomp:`),
// fordi wouldSend ikke bærer `kind` med — endpointet returnerer bevidst kun de
// fire felter, et menneske skal læse. En ukendt type vises med sit præfiks
// frem for at blive skjult: en ny beskedtype skal kunne ses her, før nogen
// husker at opdatere denne fil.
function summarizeOutbox(wouldSend) {
  const byKey = new Map();
  for (const m of wouldSend || []) {
    const kind = String(m.key ?? "").split(":")[0];
    const found = byKey.get(m.key);
    if (found) { found.recipients++; continue; }
    byKey.set(m.key, {
      key: m.key,
      kind,
      kindLabel: KIND_LABEL[kind] || kind || "Ukendt type",
      title: m.title,
      body: m.body,
      recipients: 1,
    });
  }
  return [...byKey.values()];
}

// Fletter det forventede (expectedJobs) med det målte (rækker fra
// admin_job_health).
//
// Fletningen går ud fra det FORVENTEDE og ikke fra rækkerne, og det er hele
// pointen: et job, der ALDRIG har meldt sig — fordi cron-job.org har
// deaktiveret det, eller fordi det aldrig blev oprettet — har ingen række at
// vise. Gik vi ud fra rækkerne, ville det simpelthen mangle på listen og ligne,
// at alt var i orden.
//
// Men rækker UDEN en forventning smides heller ikke væk (`unexpected: true`).
// De opstår på tre måder, og alle tre er værd at se: et cron-job, der peger på
// en liga, som ikke findes; en turnering, der er slettet, mens jobbet kører
// videre; og — lige efter G44 — de gamle `sync-matches`-rækker fra dengang alle
// turneringer delte ét navn. De aldrer selv ud med prune_job_runs().
function mergeJobHealth(rows, { leagues = [], now = Date.now() } = {}) {
  const byJob = new Map((rows || []).map((r) => [r.job, r]));
  const spec = expectedJobs(leagues);
  const kendte = new Set(spec.map((s) => s.job));

  const flet = (s, r) => {
    const lastRunAt = r?.last_run_at ? new Date(r.last_run_at).getTime() : null;
    const failures = Number(r?.consecutive_failures ?? 0);
    const silentFor = lastRunAt === null ? null : now - lastRunAt;

    let state;
    if (lastRunAt === null) state = "ukendt";
    // Et uventet job har ingen forventet kadence, så tavshed kan ikke måles —
    // kun fejl. At give det en gættet grænse ville være at opfinde en
    // forventning, ingen har udtrykt.
    else if (s.stilhedMs && silentFor > s.stilhedMs) state = "tavs";
    else if (failures >= 3) state = "fejler";
    else if (failures > 0) state = "ustabil";
    else state = "ok";

    const lastOkAt = r?.last_ok_at ? new Date(r.last_ok_at).getTime() : null;

    return {
      ...s,
      state,
      lastRunAt,
      silentFor,
      failures,
      lastOkAt,
      // Regnes ud her og ikke i komponenten: `Date.now()` under render er
      // uren og giver et tal, der skifter ved hver gentegning. Alt, der
      // afhænger af "nu", hører hjemme i denne fletning, som får `now` ind.
      okSilentFor: lastOkAt === null ? null : now - lastOkAt,
      lastError: r?.last_error ?? null,
      lastDetail: r?.last_detail ?? null,
    };
  };

  return [
    ...spec.map((s) => flet(s, byJob.get(s.job))),
    ...(rows || [])
      .filter((r) => !kendte.has(r.job))
      .map((r) => flet({ job: r.job, label: r.job, kadence: "ukendt", stilhedMs: null, unexpected: true }, r)),
  ];
}

// Tilstandene i den rækkefølge, de skal påkalde sig opmærksomhed.
const STATE_LABEL = {
  tavs: "Tavs",
  fejler: "Fejler",
  ustabil: "Ustabil",
  ukendt: "Ingen kørsler",
  ok: "OK",
};

function fmtSince(ms) {
  if (ms === null || ms === undefined) return "—";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "lige nu";
  if (min < 60) return `${min} min siden`;
  const t = Math.floor(min / 60);
  if (t < 24) return `${t} t siden`;
  return `${Math.floor(t / 24)} d siden`;
}

export { BASE_JOBS, expectedJobs, loadJobHealth, loadClientErrors, mergeJobHealth, previewNotifications, summarizeOutbox, STATE_LABEL, fmtSince };
