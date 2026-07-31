import { describe, it, expect } from "vitest";
import { JOBS, mergeJobHealth, STATE_LABEL, fmtSince } from "./ops.js";

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
