import { describe, it, expect } from "vitest";
import {
  BASE_JOBS,
  expectedJobs,
  mergeJobHealth,
  summarizeOutbox,
  STATE_LABEL,
  fmtSince,
  fmtRate,
  fmtVarighed,
  RATE_MIN_RUNS,
  RATE_THRESHOLD,
  CALLER_WINDOW_MS,
  SLOW_RATIO,
} from "./ops.js";

const NU = new Date("2026-08-01T12:00:00Z").getTime();
const forSiden = (ms) => new Date(NU - ms).toISOString();
const MIN = 60 * 1000;
const TIME = 60 * MIN;

const raek = (job, over = {}) => ({
  job,
  last_run_at: forSiden(MIN),
  last_ok_at: forSiden(MIN),
  consecutive_failures: 0,
  last_error: null,
  last_detail: null,
  ...over,
});

// To turneringer, så det, G44 handlede om, faktisk kan gå galt i testen: med
// kun én kunne en sund aldrig skjule en fejlende.
const LIGAER = [
  { id: "11111111-1111-1111-1111-111111111111", name: "Superliga" },
  { id: "22222222-2222-2222-2222-222222222222", name: "Scotland Premiership" },
];
const SUPERLIGA_JOB = "sync-matches:11111111-1111-1111-1111-111111111111";
const SKOTLAND_JOB = "sync-matches:22222222-2222-2222-2222-222222222222";

describe("expectedJobs", () => {
  it("giver ét kampprogram-job pr. turnering oven i de faste", () => {
    const ud = expectedJobs(LIGAER);
    expect(ud).toHaveLength(BASE_JOBS.length + LIGAER.length);
    expect(ud.map((j) => j.job)).toContain(SUPERLIGA_JOB);
    expect(ud.find((j) => j.job === SKOTLAND_JOB).label).toContain("Scotland Premiership");
  });

  // Listen udledes af data og skrives ikke ned: en ny turnering skal blive
  // forventet uden at nogen husker at rette en konstant. Det var netop dét,
  // der manglede, da syv turneringer delte ét jobnavn.
  it("udvider sig selv, når der kommer en turnering til", () => {
    const foer = expectedJobs(LIGAER).length;
    expect(expectedJobs([...LIGAER, { id: "33333333-3333-3333-3333-333333333333", name: "Serie A" }]))
      .toHaveLength(foer + 1);
  });

  it("tåler ingen turneringer", () => {
    expect(expectedJobs([]).map((j) => j.job)).toEqual(BASE_JOBS.map((j) => j.job));
    expect(expectedJobs(undefined)).toHaveLength(BASE_JOBS.length);
  });
});

describe("mergeJobHealth", () => {
  // Kernen i det hele: fletningen går ud fra forventningen, ikke fra rækkerne.
  // Et job, der aldrig har meldt sig — fordi cron-job.org har deaktiveret det —
  // har ingen række, og ville forsvinde fra listen, hvis vi gik ud fra data.
  it("viser et job uden nogen kørsler i stedet for at udelade det", () => {
    const forventet = expectedJobs(LIGAER);
    const out = mergeJobHealth([], { leagues: LIGAER, now: NU });
    expect(out).toHaveLength(forventet.length);
    expect(out.map((j) => j.job).sort()).toEqual(forventet.map((j) => j.job).sort());
    expect(out.every((j) => j.state === "ukendt")).toBe(true);
    expect(out[0].silentFor).toBeNull();
  });

  // G44's kerne. Før rettelsen skrev alle turneringer den SAMME jobrække, så
  // den seneste kørsel vandt: en turnering, der fejlede hver gang, stod grøn,
  // fordi naboen lige havde kørt godt.
  it("holder to turneringers kampprogram-jobs adskilt", () => {
    const out = mergeJobHealth(
      [raek(SUPERLIGA_JOB), raek(SKOTLAND_JOB, { consecutive_failures: 4 })],
      { leagues: LIGAER, now: NU }
    );
    expect(out.find((j) => j.job === SUPERLIGA_JOB).state).toBe("ok");
    expect(out.find((j) => j.job === SKOTLAND_JOB).state).toBe("fejler");
  });

  // Kortet skal kunne læses uden at slå en UUID op.
  it("navngiver kampprogram-jobbet med turneringen", () => {
    const j = mergeJobHealth([], { leagues: LIGAER, now: NU }).find((x) => x.job === SKOTLAND_JOB);
    expect(j.label).toBe("Kampprogram · Scotland Premiership");
    expect(j.kadence).toBe("hver 12. time");
  });

  it("kalder et friskt job uden fejl for ok", () => {
    const j = mergeJobHealth([raek("sync-live")], { now: NU }).find((x) => x.job === "sync-live");
    expect(j.state).toBe("ok");
    expect(j.silentFor).toBe(MIN);
    expect(j.okSilentFor).toBe(MIN);
  });

  it("kalder et job tavst, når der er gået længere end dets grænse", () => {
    // sync-live forventes hvert minut; grænsen er 30 min.
    const j = mergeJobHealth([raek("sync-live", { last_run_at: forSiden(31 * MIN) })], { now: NU }).find(
      (x) => x.job === "sync-live"
    );
    expect(j.state).toBe("tavs");
  });

  // Grænserne er forskellige pr. job, og det er hele pointen: 20 minutters
  // stilhed er alarm for live-syncen og fuldstændig normalt for kampprogrammet.
  it("bruger hvert jobs egen tålmodighed", () => {
    const rows = [
      raek("sync-live", { last_run_at: forSiden(45 * MIN) }),
      raek(SUPERLIGA_JOB, { last_run_at: forSiden(45 * MIN) }),
    ];
    const out = mergeJobHealth(rows, { leagues: LIGAER, now: NU });
    expect(out.find((j) => j.job === "sync-live").state).toBe("tavs");
    expect(out.find((j) => j.job === SUPERLIGA_JOB).state).toBe("ok");
  });

  // Alarmgrænsen skal være løsere end det skema, den overvåger. Den var
  // 14 timer mod et 12-timers interval (G6) og gav dermed to timers luft —
  // et enkelt sprunget interval ville have larmet.
  it("tåler et sprunget kampprogram-interval, men ikke to", () => {
    const stille = (t) => mergeJobHealth([raek(SUPERLIGA_JOB, { last_run_at: forSiden(t) })], {
      leagues: LIGAER, now: NU,
    }).find((j) => j.job === SUPERLIGA_JOB).state;
    expect(stille(25 * TIME)).toBe("ok");
    expect(stille(27 * TIME)).toBe("tavs");
  });

  // ---- fejlraten i to vinduer (G115) ----
  //
  // Hele grunden til, at rækkerne findes: 14. august 2026 fejlede sync-live
  // 25 gange ud af 37 kørsler på 33 minutter, og fordi hver tredje lykkedes,
  // stod fejlserien på nul og kortet på OK. Testen gengiver netop den situation.
  const rate = (over) =>
    mergeJobHealth([raek("sync-live", { consecutive_failures: 0, ...over })], { now: NU })
      .find((j) => j.job === "sync-live");

  // Den vigtigste test i filen, og den er skrevet EFTER at data blev læst:
  // første udgave havde kun døgnvinduet og ville have kaldt G109 for `ok`.
  // Tallene er de faktiske fra job_runs, ikke opfundne.
  it("fanger G109 — 25 fejl af 37 kørsler på en halv time", () => {
    const j = rate({ hour_runs: 37, hour_failures: 25, day_runs: 1440, day_failures: 25 });
    expect(j.failures).toBe(0);
    expect(j.state).toBe("ustabil");
    expect(j.hour.rate).toBeCloseTo(25 / 37, 5);
    // … og præcis dét, det gamle døgnvindue ville have svaret alene.
    expect(j.day.rate).toBeLessThan(RATE_THRESHOLD);
  });

  // Den anden form, og grunden til at døgnvinduet ikke bare kan fjernes:
  // send-notifications kører for sjældent til, at timen nogensinde bedømmes.
  it("fanger en langsom blødning, timevinduet er for lille til at se", () => {
    const j = mergeJobHealth(
      [raek("send-notifications", { hour_runs: 3, hour_failures: 1, day_runs: 72, day_failures: 15 })],
      { now: NU }
    ).find((x) => x.job === "send-notifications");
    expect(j.hour.rate).toBeNull();
    expect(j.state).toBe("ustabil");
  });

  it("lader en enkelt hikke i en time være ok", () => {
    const j = rate({ hour_runs: 60, hour_failures: 1, day_runs: 1440, day_failures: 3 });
    expect(j.state).toBe("ok");
    expect(j.unstableRate).toBe(false);
  });

  it("bedømmer ikke en rate, der er regnet på for få kørsler", () => {
    // 1 af 2 er 50 % og betyder ingenting — det er dét, kampprogram-jobbene
    // ville blive målt på, hvis grænsen ikke fandtes.
    const faa = rate({
      hour_runs: RATE_MIN_RUNS - 1, hour_failures: RATE_MIN_RUNS - 1,
      day_runs: RATE_MIN_RUNS - 1, day_failures: RATE_MIN_RUNS - 1,
    });
    expect(faa.hour.rate).toBeNull();
    expect(faa.day.rate).toBeNull();
    expect(faa.state).toBe("ok");
    // … men tallene bæres videre, så kortet kan vise "4 af 4" uden en procent.
    expect(faa.hour.failures).toBe(RATE_MIN_RUNS - 1);

    // Nøjagtig på grænsen regnes den.
    const nok = rate({ hour_runs: RATE_MIN_RUNS, hour_failures: RATE_MIN_RUNS });
    expect(nok.hour.rate).toBe(1);
    expect(nok.state).toBe("ustabil");
  });

  it("rammer grænsen præcist", () => {
    const p = (f) => rate({ hour_runs: 100, hour_failures: f }).unstableRate;
    expect(p(100 * RATE_THRESHOLD)).toBe(true);
    expect(p(100 * RATE_THRESHOLD - 1)).toBe(false);
  });

  // Vigtigst af alle: koden deployes automatisk, migreringen køres i hånden.
  // I vinduet derimellem er raten UMÅLT, og en umålt rate må hverken vises
  // eller bedømmes — den må slet ikke kunne forveksles med nul.
  it("opfører sig som før, hvis migreringen ikke er kørt endnu", () => {
    const j = mergeJobHealth([raek("sync-live")], { now: NU }).find((x) => x.job === "sync-live");
    expect(j.hour).toEqual({ runs: null, failures: null, rate: null });
    expect(j.day).toEqual({ runs: null, failures: null, rate: null });
    expect(j.unstableRate).toBe(false);
    expect(j.state).toBe("ok");
  });

  // Et job, hvis seneste kørsel er ældre end vinduet, har målt NUL kørsler.
  // Det er et tal og ikke en manglende måling — men det må ikke give en
  // division med nul eller en rate på 0 %, der ligner "ingen fejl".
  it("tåler et job uden kørsler i vinduet", () => {
    const j = rate({ hour_runs: 0, hour_failures: 0, day_runs: 0, day_failures: 0 });
    expect(j.hour.runs).toBe(0);
    expect(j.hour.rate).toBeNull();
    expect(j.state).toBe("ok");
  });

  // ---- varigheden, som udfaldet ikke kan se (G114) ----
  //
  // Rækkens egen anledning: `G109`s GRØNNE kørsler tog 7-13 sekunder mod en
  // grænse på 10, og det tal fandtes kun hos cron-job.org. Et grønt flueben på
  // en kørsel, der tog 26 sekunder, og et på en, der tog 2, er det samme
  // flueben — forskellen er, at den første er sekunder fra at blive klippet
  // over.

  it("bærer varighederne videre fra opslaget", () => {
    const j = rate({
      last_duration_ms: 12_400, hour_p50_ms: 11_800, hour_max_ms: 13_100,
      day_p50_ms: 2_100, day_max_ms: 13_100,
    });
    expect(j.lastMs).toBe(12_400);
    expect(j.hourMs).toEqual({ p50: 11_800, max: 13_100 });
    expect(j.dayMs).toEqual({ p50: 2_100, max: 13_100 });
  });

  // Samme regel som raten, og den er vigtigere her: koden deployes automatisk,
  // migreringen (`#66`) køres i hånden. En umålt varighed må ikke kunne
  // forveksles med en hurtig kørsel — det er hele forskellen på "vi ved det
  // ikke" og "alt er fint".
  it("lader varigheden være UMÅLT, når migreringen ikke er kørt endnu", () => {
    const j = mergeJobHealth([raek("sync-live")], { now: NU }).find((x) => x.job === "sync-live");
    expect(j.lastMs).toBeNull();
    expect(j.hourMs).toEqual({ p50: null, max: null });
    expect(j.dayMs).toEqual({ p50: null, max: null });
    expect(j.nearCallerLimit).toBe(false);
  });

  // En kørsel, der aldrig afsluttede, har `finished_at is null` og dermed ingen
  // varighed. Migreringen sender null, og null skal blive null hele vejen —
  // ikke 0 ms, som ville stå som den hurtigste kørsel nogensinde.
  it("gør ikke en afbrudt kørsel til den hurtigste", () => {
    const j = rate({ last_duration_ms: null, hour_p50_ms: 9_000, hour_max_ms: 9_500 });
    expect(j.lastMs).toBeNull();
    expect(j.hourMs.p50).toBe(9_000);
  });

  // Grænsen er KALDERENS: cron-job.org afbryder efter 30 sekunder for alle ni
  // jobs. Målt på MAKSIMUM og ikke på medianen — én kørsel på 26 sekunder er
  // advarslen, uanset at de øvrige 59 tog to.
  it("advarer, når den længste kørsel nærmer sig kalderens vindue", () => {
    const grænse = CALLER_WINDOW_MS * SLOW_RATIO;
    expect(rate({ hour_p50_ms: 2_000, hour_max_ms: grænse }).nearCallerLimit).toBe(true);
    expect(rate({ hour_p50_ms: 2_000, hour_max_ms: grænse - 1 }).nearCallerLimit).toBe(false);
    // Døgnvinduet tæller også: et job med for få kørsler i timen ville ellers
    // aldrig kunne udløse den (`send-notifications` kører 2-4 gange i timen).
    expect(rate({ day_max_ms: grænse }).nearCallerLimit).toBe(true);
  });

  // En LANGSOM kørsel er ikke en fejlende. Tilstanden bliver derfor ikke
  // `ustabil` af varigheden alene — kortet siger det i en sætning i stedet,
  // fordi det er en diagnose og ikke en dom.
  it("lader varigheden være en diagnose og ikke en tilstand", () => {
    const j = rate({ hour_runs: 60, hour_failures: 0, hour_max_ms: CALLER_WINDOW_MS });
    expect(j.nearCallerLimit).toBe(true);
    expect(j.state).toBe("ok");
  });

  // Raten må gøre et job ustabilt, men ikke fejlende: `fejler` er den
  // tilstand, heartbeat-workflowen råber på, og et job, der fejler halvdelen
  // af tiden, virker stadig.
  it("lader raten hæve til ustabil, men aldrig til fejler eller tavs", () => {
    expect(rate({ hour_runs: 100, hour_failures: 99 }).state).toBe("ustabil");
    const stille = mergeJobHealth(
      [raek("sync-live", { last_run_at: forSiden(2 * TIME), hour_runs: 100, hour_failures: 99 })],
      { now: NU }
    ).find((j) => j.job === "sync-live");
    expect(stille.state).toBe("tavs");
  });

  it("skelner mellem ustabil og fejlende ud fra fejlserien", () => {
    const to = mergeJobHealth([raek("sync-live", { consecutive_failures: 2 })], { now: NU });
    expect(to.find((j) => j.job === "sync-live").state).toBe("ustabil");

    const tre = mergeJobHealth([raek("sync-live", { consecutive_failures: 3 })], { now: NU });
    expect(tre.find((j) => j.job === "sync-live").state).toBe("fejler");
  });

  // Tavshed vejer tungere end fejl: et job, der er holdt op med at melde sig,
  // er et større problem end et, der stadig kører og fejler.
  it("lader tavshed vinde over fejlserien", () => {
    const j = mergeJobHealth(
      [raek("sync-live", { last_run_at: forSiden(2 * TIME), consecutive_failures: 5 })],
      { now: NU }
    ).find((x) => x.job === "sync-live");
    expect(j.state).toBe("tavs");
  });

  it("håndterer et job, der har kørt men aldrig med succes", () => {
    const j = mergeJobHealth(
      [raek("sync-live", { last_ok_at: null, consecutive_failures: 7 })],
      { now: NU }
    ).find((x) => x.job === "sync-live");
    expect(j.state).toBe("fejler");
    expect(j.lastOkAt).toBeNull();
    expect(j.okSilentFor).toBeNull();
  });

  it("tåler et manglende svar", () => {
    expect(() => mergeJobHealth(null, { leagues: LIGAER, now: NU })).not.toThrow();
    expect(mergeJobHealth(null, { leagues: LIGAER, now: NU })).toHaveLength(expectedJobs(LIGAER).length);
  });

  // En række uden forventning smides ikke væk. Den opstår, når et cron-job
  // peger på en liga, der ikke findes — og lige efter G44 også som de gamle
  // `sync-matches`-rækker fra dengang alle turneringer delte ét navn.
  it("viser et job, der har meldt sig uden at være forventet", () => {
    const out = mergeJobHealth([raek("sync-matches")], { leagues: LIGAER, now: NU });
    expect(out).toHaveLength(expectedJobs(LIGAER).length + 1);
    const fremmed = out.find((j) => j.job === "sync-matches");
    expect(fremmed.unexpected).toBe(true);
    expect(fremmed.state).toBe("ok");
  });

  // Uden en forventet kadence findes der ingen grænse at måle tavshed mod.
  // At gætte en ville være at opfinde en forventning, ingen har udtrykt.
  it("kalder aldrig et uventet job tavst, men melder dets fejl", () => {
    const gammelt = mergeJobHealth([raek("sync-matches", { last_run_at: forSiden(300 * TIME) })], {
      leagues: LIGAER, now: NU,
    }).find((j) => j.job === "sync-matches");
    expect(gammelt.state).toBe("ok");

    const daarligt = mergeJobHealth([raek("sync-matches", { consecutive_failures: 3 })], {
      leagues: LIGAER, now: NU,
    }).find((j) => j.job === "sync-matches");
    expect(daarligt.state).toBe("fejler");
  });

  it("fører fejltekst og resumé med videre", () => {
    const j = mergeJobHealth(
      [raek("sync-live", { last_error: "boom", last_detail: { written: 4 } })],
      { now: NU }
    ).find((x) => x.job === "sync-live");
    expect(j.lastError).toBe("boom");
    expect(j.lastDetail).toEqual({ written: 4 });
  });

  it("har en etiket til hver tilstand", () => {
    const states = new Set(
      [[], [raek("sync-live")], [raek("sync-live", { consecutive_failures: 4 })]].flatMap((rows) =>
        mergeJobHealth(rows, { now: NU }).map((j) => j.state)
      )
    );
    for (const s of states) expect(STATE_LABEL[s]).toBeTruthy();
    expect(Object.keys(STATE_LABEL).sort()).toEqual(
      ["fejler", "ok", "tavs", "ukendt", "ustabil"].sort()
    );
  });
});

describe("fmtSince", () => {
  it("skriver tiden i den største enhed, der giver mening", () => {
    expect(fmtSince(30 * 1000)).toBe("lige nu");
    expect(fmtSince(5 * MIN)).toBe("5 min siden");
    expect(fmtSince(3 * TIME)).toBe("3 t siden");
    expect(fmtSince(50 * TIME)).toBe("2 d siden");
  });

  it("viser en tankestreg, når der intet er at vise", () => {
    expect(fmtSince(null)).toBe("—");
    expect(fmtSince(undefined)).toBe("—");
  });
});

describe("fmtRate", () => {
  it("skriver hele procenter over ti og ét ciffer under", () => {
    expect(fmtRate(2 / 3)).toBe("67 %");
    expect(fmtRate(0.1)).toBe("10 %");
    expect(fmtRate(0.034)).toBe("3.4 %");
  });

  // Det ene tal, der ikke må rundes væk: en rate, der er lille men ikke nul,
  // ville som "0 %" ligne "ingen fejl".
  it("runder aldrig en rate, der ikke er nul, ned til nul", () => {
    expect(fmtRate(0.0007)).not.toBe("0 %");
    expect(fmtRate(0)).toBe("0 %");
  });

  it("viser en tankestreg, når raten ikke er målt", () => {
    expect(fmtRate(null)).toBe("—");
    expect(fmtRate(undefined)).toBe("—");
  });
});

describe("fmtVarighed", () => {
  it("skriver millisekunder under et sekund og sekunder over", () => {
    expect(fmtVarighed(320)).toBe("320 ms");
    expect(fmtVarighed(999)).toBe("999 ms");
    // 12.431 ms siger ingenting; 12,4 s siger, hvor tæt på grænsen kørslen var.
    expect(fmtVarighed(12_431)).toBe("12,4 s");
    expect(fmtVarighed(2_000)).toBe("2,0 s");
  });

  // Komma og ikke punktum: resten af appen er dansk, og et punktum i et tal
  // læses som en tusindtalsseparator.
  it("bruger dansk decimalkomma", () => {
    expect(fmtVarighed(7_650)).toBe("7,7 s");
    expect(fmtVarighed(7_650)).not.toContain(".");
  });

  it("viser en tankestreg, når varigheden ikke er målt", () => {
    expect(fmtVarighed(null)).toBe("—");
    expect(fmtVarighed(undefined)).toBe("—");
    // En kørsel uden `finished_at` kan give NaN gennem en gammel klient.
    // "—" er det rigtige svar; "NaN s" ville se ud som en måling.
    expect(fmtVarighed(Number.NaN)).toBe("—");
  });
});

// Grupperingen er det eneste i forhåndsvisningen, der ikke er ren visning:
// outboxen er (besked × bruger), så uden den er en runde med 18 tippere 18
// næsten ens rækker — og modtagerantallet, som selv var det forkerte tal i
// G51, ville aldrig blive vist som et tal.
describe("summarizeOutbox", () => {
  const besked = (key, userId, over = {}) => ({
    key,
    userId,
    title: "Runden er slut ⚽",
    body: "Runden 28.07 – 03.08: du fik 1 point og blev nr. 2 af 18.",
    ...over,
  });

  it("samler den samme besked til flere brugere til én række med et antal", () => {
    const ud = summarizeOutbox([
      besked("result:2026-07-28", "u1"),
      besked("result:2026-07-28", "u2"),
      besked("result:2026-07-28", "u3"),
    ]);
    expect(ud).toHaveLength(1);
    expect(ud[0].recipients).toBe(3);
    expect(ud[0].key).toBe("result:2026-07-28");
  });

  // Alle FEM beskedtyper er med med vilje: `award:` og `newleague:` blev
  // leveret i Tier 3 uden en etiket og stod på maskinsprog, indtil G61 (august
  // 2026). Testen er det, der gør, at den næste type ikke kan gøre det samme
  // uendeligt — den skal listes her for at blive nævnt.
  it("holder forskellige nøgler adskilt og oversætter alle fem typer", () => {
    const ud = summarizeOutbox([
      besked("result:2026-07-28", "u1"),
      besked("deadline:2026-08-01", "u1", { title: "Kampe låser snart ⏰" }),
      besked("newcomp:abc", "u2", { title: "Ny konkurrence i Test 🎯" }),
      besked("award:abc:round:2026-07-28", "u2", { title: "Du er Ugens bedste 🏅" }),
      besked("newleague:def", "u3", { title: "Ny turnering i Leagly ⚽" }),
    ]);
    expect(ud.map((r) => r.kindLabel)).toEqual([
      "Runde-resultat",
      "Deadline-påmindelse",
      "Ny konkurrence",
      "Lokal kåring",
      "Ny turnering",
    ]);
    expect(ud.every((r) => r.recipients === 1)).toBe(true);
  });

  // En ny beskedtype skal kunne SES her, før nogen husker at opdatere
  // KIND_LABEL. Skjulte vi den ukendte, ville forhåndsvisningen lyve om,
  // hvad der venter — og det er præcis den slags tavshed, kortet findes for.
  it("viser en ukendt beskedtype med sit præfiks frem for at skjule den", () => {
    const ud = summarizeOutbox([besked("streak:2026-08-01", "u1")]);
    expect(ud).toHaveLength(1);
    expect(ud[0].kindLabel).toBe("streak");
  });

  it("tåler en tom eller manglende liste", () => {
    expect(summarizeOutbox([])).toEqual([]);
    expect(summarizeOutbox(undefined)).toEqual([]);
    expect(summarizeOutbox(null)).toEqual([]);
  });

  it("bevarer titel og tekst, så rækken kan læses som beskeden", () => {
    const ud = summarizeOutbox([besked("result:2026-07-28", "u1")]);
    expect(ud[0].title).toBe("Runden er slut ⚽");
    expect(ud[0].body).toContain("nr. 2 af 18");
  });
});
