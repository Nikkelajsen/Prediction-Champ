import { describe, it, expect } from "vitest";
import { JOBS, mergeJobHealth, summarizeOutbox, STATE_LABEL, fmtSince } from "./ops.js";

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

describe("mergeJobHealth", () => {
  // Kernen i det hele: fletningen går ud fra JOBS, ikke fra rækkerne. Et job,
  // der aldrig har meldt sig — fordi cron-job.org har deaktiveret det — har
  // ingen række, og ville forsvinde fra listen, hvis vi gik ud fra data.
  it("viser et job uden nogen kørsler i stedet for at udelade det", () => {
    const out = mergeJobHealth([], NU);
    expect(out).toHaveLength(JOBS.length);
    expect(out.map((j) => j.job).sort()).toEqual(JOBS.map((j) => j.job).sort());
    expect(out.every((j) => j.state === "ukendt")).toBe(true);
    expect(out[0].silentFor).toBeNull();
  });

  it("kalder et friskt job uden fejl for ok", () => {
    const j = mergeJobHealth([raek("sync-live")], NU).find((x) => x.job === "sync-live");
    expect(j.state).toBe("ok");
    expect(j.silentFor).toBe(MIN);
    expect(j.okSilentFor).toBe(MIN);
  });

  it("kalder et job tavst, når der er gået længere end dets grænse", () => {
    // sync-live forventes hvert minut; grænsen er 30 min.
    const j = mergeJobHealth([raek("sync-live", { last_run_at: forSiden(31 * MIN) })], NU).find(
      (x) => x.job === "sync-live"
    );
    expect(j.state).toBe("tavs");
  });

  // Grænserne er forskellige pr. job, og det er hele pointen: 20 minutters
  // stilhed er alarm for live-syncen og fuldstændig normalt for kampprogrammet.
  it("bruger hvert jobs egen tålmodighed", () => {
    const rows = [
      raek("sync-live", { last_run_at: forSiden(45 * MIN) }),
      raek("sync-matches", { last_run_at: forSiden(45 * MIN) }),
    ];
    const out = mergeJobHealth(rows, NU);
    expect(out.find((j) => j.job === "sync-live").state).toBe("tavs");
    expect(out.find((j) => j.job === "sync-matches").state).toBe("ok");
  });

  it("skelner mellem ustabil og fejlende ud fra fejlserien", () => {
    const to = mergeJobHealth([raek("sync-live", { consecutive_failures: 2 })], NU);
    expect(to.find((j) => j.job === "sync-live").state).toBe("ustabil");

    const tre = mergeJobHealth([raek("sync-live", { consecutive_failures: 3 })], NU);
    expect(tre.find((j) => j.job === "sync-live").state).toBe("fejler");
  });

  // Tavshed vejer tungere end fejl: et job, der er holdt op med at melde sig,
  // er et større problem end et, der stadig kører og fejler.
  it("lader tavshed vinde over fejlserien", () => {
    const j = mergeJobHealth(
      [raek("sync-live", { last_run_at: forSiden(2 * TIME), consecutive_failures: 5 })],
      NU
    ).find((x) => x.job === "sync-live");
    expect(j.state).toBe("tavs");
  });

  it("håndterer et job, der har kørt men aldrig med succes", () => {
    const j = mergeJobHealth(
      [raek("sync-live", { last_ok_at: null, consecutive_failures: 7 })],
      NU
    ).find((x) => x.job === "sync-live");
    expect(j.state).toBe("fejler");
    expect(j.lastOkAt).toBeNull();
    expect(j.okSilentFor).toBeNull();
  });

  it("tåler null og ukendte jobs i svaret", () => {
    expect(() => mergeJobHealth(null, NU)).not.toThrow();
    const out = mergeJobHealth([raek("et-job-vi-ikke-kender")], NU);
    expect(out).toHaveLength(JOBS.length);
    expect(out.every((j) => j.state === "ukendt")).toBe(true);
  });

  it("fører fejltekst og resumé med videre", () => {
    const j = mergeJobHealth(
      [raek("sync-live", { last_error: "boom", last_detail: { written: 4 } })],
      NU
    ).find((x) => x.job === "sync-live");
    expect(j.lastError).toBe("boom");
    expect(j.lastDetail).toEqual({ written: 4 });
  });

  it("har en etiket til hver tilstand", () => {
    const states = new Set(
      [[], [raek("sync-live")], [raek("sync-live", { consecutive_failures: 4 })]].flatMap((rows) =>
        mergeJobHealth(rows, NU).map((j) => j.state)
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

  it("holder forskellige nøgler adskilt og oversætter typen", () => {
    const ud = summarizeOutbox([
      besked("result:2026-07-28", "u1"),
      besked("deadline:2026-08-01", "u1", { title: "Kampe låser snart ⏰" }),
      besked("newcomp:abc", "u2", { title: "Ny konkurrence i Test 🎯" }),
    ]);
    expect(ud.map((r) => r.kindLabel)).toEqual([
      "Runde-resultat",
      "Deadline-påmindelse",
      "Ny konkurrence",
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
