// Drift: aflæsning af de planlagte jobs' helbred (Admin → Drift).
//
// Egen fil frem for endnu en funktion i data.js (761 linjer, noteret som
// teknisk gæld i DOCUMENTATION.md afsnit 12) — samme valg som analytics.js
// traf, af samme grund.
//
// Registeret over hvilke jobs der SKAL findes, står i docs/CRON.md. Denne fil
// viser kun, hvad de faktisk har meldt.
import { restFetch } from "./supabase.js";
import { apiFetch } from "./api.js";

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

// Sæsonerne og deres slutning (sql/season_end.sql). Samme admin-gatede form.
//
// Aflæsningen hører til i Drift og ikke i Statistik, fordi den svarer på et
// DRIFTS-spørgsmål: hænger en sæson, fordi datakilden ikke fortæller, at den er
// slut? En sæson, hvor alt er spillet, men `is_finished` er falsk og `ends_at`
// tom, er præcis den, der venter på 30-dages ventilen — og den eneste, nogen
// skal røre i hånden.
const loadSeasons = (token) =>
  restFetch(`/rest/v1/rpc/admin_seasons`, { method: "POST", token, body: {} });

const setSeasonFinished = (token, seasonId, finished) =>
  restFetch(`/rest/v1/rpc/admin_set_season_finished`, {
    method: "POST", token, body: { p_season_id: seasonId, p_finished: finished },
  });

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
// apiFetch() og ikke `fetch` direkte (G80): på `npm run dev` svarede stien
// index.html med status 200, og forhåndsvisningen stod tom uden at sige hvorfor
// — en tom udbakke og et manglende endpoint så ens ud.
async function previewNotifications(token) {
  const { res, data } = await apiFetch(`/api/send-notifications?dryRun=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(data?.error || `Forhåndsvisningen fejlede (${res.status})`);
  return data;
}

// Alle fem beskedtyper i api/send-notifications.js. Listen skal holdes i trit
// med `kind`-feltet dér — en type, der mangler her, vises med sit rå
// nøgle-præfiks (se summarizeOutbox nedenfor).
const KIND_LABEL = {
  deadline: "Deadline-påmindelse",
  result: "Runde-resultat",
  newcomp: "Ny konkurrence",
  award: "Lokal kåring",
  newleague: "Ny turnering",
};

// Outboxen er (besked × bruger), så en runde med 18 tippere er 18 næsten ens
// rækker. Grupperingen pr. nøgle er derfor ikke pynt: den gør listen læselig,
// og antallet af modtagere er selv det interessante tal — det var præcis dét,
// der var forkert, da G51 meldte en igangværende runde færdig ("nr. 2 af 18").
//
// Beskedtypen udledes af nøglens præfiks (`result:`, `deadline:`, `newcomp:`,
// `award:`, `newleague:`), fordi wouldSend ikke bærer `kind` med — endpointet
// returnerer bevidst kun de fire felter, et menneske skal læse. En ukendt type
// vises med sit præfiks frem for at blive skjult: en ny beskedtype skal kunne
// ses her, før nogen husker at opdatere KIND_LABEL.
//
// Fallbacken er altså en OVERGANG og ikke en tilstand (G61, august 2026):
// `award:` og `newleague:` stod på maskinsprog fra Tier 3 til nu, og en
// forhåndsvisning, hvor to ud af fem rækker er rå nøgler, er sværere at læse
// for den, der skal afgøre, om en besked skal sendes.
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

// ---- fejlRATEN, som fejlSERIEN ikke kan se (G115) ----
//
// `consecutive_failures` nulstilles af enhver succes. For et job, der kører
// hvert minut og fejler to ud af tre, er den seneste kørsel grøn hver tredje
// gang — og så står tælleren på nul, mens jobbet reelt er nede. Det var
// tilstanden 14. august 2026 under `G109`: Drift stod på **OK, 0 fejl i træk**
// i en time, hvor live-syncen fejlede omtrent 2/3 af sine kørsler.
//
// `admin_job_health()` måler derfor også to vinduer, og oversættelsen fra tal
// til tilstand ligger her, hvor de øvrige regler bor.
//
// TO VINDUER, FORDI ÉT IKKE RÆKKER. Første udgave havde kun døgnet, og
// **den ville ikke have fanget `G109`**: hændelsen varede 33 minutter med 25
// fejl ud af 37 kørsler — 68 % i vinduet, men 1,7 % af et døgn. En nedetid på
// en kampaften er INTENS OG KORT, og et døgn fortynder præcis den form til
// usynlighed. Rettet 14. august 2026, efter at kørslerne blev læst.
//
//   1 time    Den intense og korte. Et minut-job har ~60 kørsler i timen, så
//             raten er skarp og altid aktuel. `G109` ville have stået på 42 %.
//   24 timer  Den langsomme blødning. `send-notifications` kører 2-4 gange i
//             timen — for få til, at timevinduet nogensinde bedømmes — men
//             48-96 gange i døgnet. Et job, der stille fejler hver femte gang
//             hele dagen, når sjældent tre fejl i træk og ville ellers være
//             usynligt begge veje.
//
// GRÆNSEN ER ET VALG, og begge tal er valgt af samme grund: et kort, der ofte
// er gult uden grund, lærer én at holde op med at kigge (samme afvejning som
// alarmgrænsen i job-heartbeat.yml).
//
//   MIN_RUNS   Under fem kørsler i vinduet er en "rate" ikke et tal, det er en
//              anekdote — 1 af 2 er 50 %. Kampprogram-jobbene kører to gange i
//              døgnet og bliver dermed ALDRIG bedømt på deres rate; for dem er
//              fejlserien i forvejen hele historien, fordi hver kørsel vejer.
//   THRESHOLD  `sync-live` har ~60 kørsler i timen, så en enkelt hikke er
//              1,7 %. 10 % er seks tabte minutter i træk-værdi — langt over
//              støj, og langt under de 68 %, `G109` var.
const RATE_MIN_RUNS = 5;
const RATE_THRESHOLD = 0.1;

// Én rate ud af (fejl, kørsler). `null` betyder UMÅLT og aldrig nul:
//
//   * feltet mangler   → migreringen er ikke kørt endnu (koden deployes
//     automatisk, SQL'en køres i hånden). Samme valg som `select=*` i
//     api/sync-live.js.
//   * for få kørsler   → en brøk med en nævner under fem er ikke en rate.
//
// De to tilfælde er forskellige for LÆSEREN — det ene skal vises som "0 af 3",
// det andet slet ikke — så `runs` bæres videre ved siden af raten.
function raten(runs, failures) {
  if (runs == null || failures == null) return { runs: null, failures: null, rate: null };
  return {
    runs: Number(runs),
    failures: Number(failures),
    rate: Number(runs) >= RATE_MIN_RUNS ? Number(failures) / Number(runs) : null,
  };
}

// ---- varigheden, som udfaldet ikke kan se (G114) ----
//
// Dét, der afgjorde `G109`, var ikke fejlbeskeden, men at de GRØNNE kørsler tog
// 7-13 sekunder mod en grænse på 10. Det tal fandtes kun i cron-job.orgs egen
// liste: Drift viste tidspunkt, udfald, rate og resumé, men ikke varighed — og
// en kørsel, der lykkes på 19 sekunder, og en, der lykkes på 2, er det samme
// grønne flueben.
//
// GRÆNSEN ER KALDERENS OG IKKE VORES. cron-job.org afbryder efter 30 sekunder
// for alle ni jobs, og det tal er maksimum på planen. Det er derfor den ene
// grænse, der kan skrives ét sted og gælde dem alle — modsat kadencen, som er
// forskellig pr. job. Den står også i `api/_shared.js` (live-opslagets budget
// er udledt af den) og i `docs/CRON.md`.
//
// 80 % er valgt som `RATE_THRESHOLD` blev det: et kort, der ofte er gult uden
// grund, lærer én at holde op med at kigge. 24 sekunder er ikke en hikke — det
// er seks sekunder fra at blive klippet over, og en kørsel, der klippes over,
// når hverken at skrive sin `job_runs`-række eller at rydde op.
const CALLER_WINDOW_MS = 30_000;
const SLOW_RATIO = 0.8;

// Ét vindues varigheder. `null` betyder UMÅLT og aldrig nul — samme regel som
// `raten()`, og af to grunde her:
//
//   * feltet mangler        → migreringen (`#66 job_run_duration.sql`) er ikke
//     kørt endnu. Koden deployes automatisk, SQL'en køres i hånden.
//   * kørslen afsluttede ikke → `finished_at` er null, så der ER ingen varighed.
//     Havde vi vist den som 0 ms, ville en afbrudt kørsel se ud som den
//     hurtigste, der nogensinde er kørt.
function varigheder(p50, max) {
  const tal = (v) => (v == null ? null : Number(v));
  return { p50: tal(p50), max: tal(max) };
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

    const hour = raten(r?.hour_runs, r?.hour_failures);
    const day = raten(r?.day_runs, r?.day_failures);
    // Den tilstand, kortet ikke kunne vise: jobbet fejler jævnligt, men den
    // seneste kørsel lykkedes, så fejlserien er nul. ENTEN-ELLER og ikke
    // begge: vinduerne findes netop, fordi de fanger hver sin form, så et krav
    // om at begge slår ud ville gøre dem til det korteste af de to.
    const unstableRate = [hour.rate, day.rate].some((x) => x !== null && x >= RATE_THRESHOLD);

    // Varigheden (G114). Målt på MAKSIMUM og ikke på medianen: spørgsmålet er
    // ikke, om jobbet plejer at være hurtigt, men om nogen kørsel er kommet tæt
    // på kalderens vindue. Én kørsel på 26 sekunder er advarslen; at de øvrige
    // 59 tog 2 sekunder gør den ikke mindre.
    const hourMs = varigheder(r?.hour_p50_ms, r?.hour_max_ms);
    const dayMs = varigheder(r?.day_p50_ms, r?.day_max_ms);
    const lastMs = r?.last_duration_ms == null ? null : Number(r.last_duration_ms);
    const slowMs = [hourMs.max, dayMs.max].filter((x) => x !== null);
    const nearCallerLimit = slowMs.some((x) => x >= CALLER_WINDOW_MS * SLOW_RATIO);

    let state;
    if (lastRunAt === null) state = "ukendt";
    // Et uventet job har ingen forventet kadence, så tavshed kan ikke måles —
    // kun fejl. At give det en gættet grænse ville være at opfinde en
    // forventning, ingen har udtrykt.
    else if (s.stilhedMs && silentFor > s.stilhedMs) state = "tavs";
    else if (failures >= 3) state = "fejler";
    // Raten kan gøre et job ustabilt, men ikke fejlende: `fejler` er den
    // tilstand, heartbeat-workflowen råber på, og den hører til et job, der er
    // holdt op med at virke. Et job, der fejler halvdelen af tiden, VIRKER —
    // dårligt, og det er præcis, hvad ordet "ustabil" siger.
    else if (failures > 0 || unstableRate) state = "ustabil";
    else state = "ok";

    const lastOkAt = r?.last_ok_at ? new Date(r.last_ok_at).getTime() : null;

    return {
      ...s,
      state,
      lastRunAt,
      silentFor,
      failures,
      lastOkAt,
      hour,
      day,
      unstableRate,
      lastMs,
      hourMs,
      dayMs,
      // En LANGSOM kørsel er ikke en fejlende, og tilstanden er derfor
      // uændret: `state` bliver ikke `ustabil` af varigheden alene. Kortet
      // siger det i en sætning i stedet, fordi det er en diagnose og ikke en
      // dom — det er nøjagtig den skelnen, `G109` manglede ord for.
      nearCallerLimit,
      // Regnes ud her og ikke i komponenten: `Date.now()` under render er
      // uren og giver et tal, der skifter ved hver gentegning. Alt, der
      // afhænger af "nu", hører hjemme i denne fletning, som får `now` ind.
      okSilentFor: lastOkAt === null ? null : now - lastOkAt,
      lastError: r?.last_error ?? null,
      lastDetail: r?.last_detail ?? null,
      // Værtsnavnet kørslen kaldte ind på (A46). Det HAR ligget i detaljen
      // siden 13. august 2026, men kun som en linje i det rå JSON bag
      // "Seneste resumé" — ni jobs betød ni udfoldninger og ni gennemlæsninger
      // for at læse ét felt. Løftet ud som sit eget signal, så registerets
      // `<app>` kan udfyldes ved at rulle ned ad siden én gang.
      //
      // Feltet bliver stående, når A46 er lukket: det er ikke en engangs-
      // aflæsning, men den ene måde at se, at et job er sat op mod en anden
      // adresse, end man tror — `/api/` er med vilje undtaget fra redirectet
      // (docs/DOMAENE.md trin 6), så et fejlpeget job svarer 200 og tier.
      lastHost: r?.last_detail?.host ?? null,
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

// Fejlraten som procent. Rundes til ét ciffer under 10 %, så en rate lige
// omkring støjgrænsen ikke vises som "0 %" — det ville være det ene tal, der
// ligner "ingen fejl".
function fmtRate(rate) {
  if (rate === null || rate === undefined) return "—";
  const pct = rate * 100;
  return `${pct < 10 ? Math.round(pct * 10) / 10 : Math.round(pct)} %`;
}

// En varighed, læst af et menneske. Millisekunder under et sekund, ellers
// sekunder med ét decimal — 12,4 s siger noget, 12.431 ms gør ikke. Komma og
// ikke punktum: resten af appen er dansk, og et punktum i et tal læses som en
// tusindtalsseparator.
function fmtVarighed(ms) {
  if (ms === null || ms === undefined) return "—";
  const n = Number(ms);
  if (!Number.isFinite(n)) return "—";
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(Math.round(n / 100) / 10).toFixed(1).replace(".", ",")} s`;
}

function fmtSince(ms) {
  if (ms === null || ms === undefined) return "—";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "lige nu";
  if (min < 60) return `${min} min siden`;
  const t = Math.floor(min / 60);
  if (t < 24) return `${t} t siden`;
  return `${Math.floor(t / 24)} d siden`;
}

export { BASE_JOBS, expectedJobs, loadJobHealth, loadClientErrors, loadSeasons, setSeasonFinished, mergeJobHealth, previewNotifications, summarizeOutbox, STATE_LABEL, fmtSince, fmtRate, fmtVarighed, RATE_MIN_RUNS, RATE_THRESHOLD, CALLER_WINDOW_MS, SLOW_RATIO };
