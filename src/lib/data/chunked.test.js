import { describe, it, expect, vi, beforeEach } from "vitest";

// `db` mockes, så portionsdelingen kan måles på de forespørgsler, den bygger.
vi.mock("../supabase.js", () => ({ db: { select: vi.fn(), del: vi.fn(), insert: vi.fn() }, restFetch: vi.fn() }));

import { db } from "../supabase.js";
import { selectIn, LOFT } from "./chunked.js";

beforeEach(() => { db.select.mockReset(); db.select.mockResolvedValue([]); });

const uuider = (n) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

describe("selectIn", () => {
  // Egenskaben, hele lagdelingen hviler på: en kort liste giver ÉN forespørgsel,
  // ordret den samme som før hjælperen fandtes. Uden den ville hver eneste test
  // af et konverteret kaldssted skulle skrives om.
  it("bygger præcis den samme forespørgsel som før, når listen er kort", async () => {
    const ids = uuider(3);
    await selectIn("tok", "matches", "id", ids, "&select=*&order=kickoff_at");
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.select).toHaveBeenCalledWith("tok", "matches",
      `id=in.(${ids.join(",")})&select=*&order=kickoff_at`, {});
  });

  // Selve fejlen: 778 kampe blev til en URL på ~29 KB, og Supabases edge afviste
  // den. Hjem og Tip svarede "Kunne ikke hente …", mens ét enkelt valg i
  // konkurrence-vælgeren virkede, fordi listen da var kort.
  it("deler en lang liste op, så ingen URL bliver for lang", async () => {
    const ids = uuider(778);
    await selectIn("tok", "matches", "id", ids, "&select=*");
    expect(db.select).toHaveBeenCalledTimes(Math.ceil(778 / LOFT));
    for (const [, , query] of db.select.mock.calls) {
      // 37 tegn pr. UUID med komma. Loftet er sat med luft, så en tilføjelse til
      // `select=` ikke er den næste fejl.
      expect(query.length).toBeLessThan(4200);
    }
  });

  it("sender hvert id præcis én gang, fordelt over portionerne", async () => {
    const ids = uuider(250);
    await selectIn("tok", "matches", "id", ids, "&select=*");
    const sendte = db.select.mock.calls
      .flatMap(([, , q]) => q.slice(q.indexOf("(") + 1, q.indexOf(")")).split(","));
    expect(sendte).toHaveLength(250);
    expect(new Set(sendte).size).toBe(250);
  });

  it("samler rækkerne fra alle portionerne", async () => {
    db.select.mockImplementation(async (t, tabel, q) => {
      const n = q.slice(q.indexOf("(") + 1, q.indexOf(")")).split(",").length;
      return Array.from({ length: n }, (_, i) => ({ i }));
    });
    const ud = await selectIn("tok", "matches", "id", uuider(250), "&select=*");
    expect(ud).toHaveLength(250);
  });

  it("fjerner dubletter, før den tæller portioner", async () => {
    const ids = [...uuider(120), ...uuider(120)];
    await selectIn("tok", "matches", "id", ids, "&select=*");
    expect(db.select).toHaveBeenCalledTimes(2); // 120 unikke, ikke 240
  });

  // `in.()` er ugyldig syntaks og svarer 400. Det var i forvejen et hul, hvert
  // kaldssted måtte huske at gardere sig mod — nu kan det ikke glemmes.
  it("kalder slet ikke serveren for en tom liste", async () => {
    expect(await selectIn("tok", "matches", "id", [], "&select=*")).toEqual([]);
    expect(await selectIn("tok", "matches", "id", [null, undefined, ""], "&select=*")).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("springer tomme id'er over i en ellers gyldig liste", async () => {
    await selectIn("tok", "matches", "id", ["a", null, "b", undefined, ""], "&select=*");
    expect(db.select).toHaveBeenCalledWith("tok", "matches", "id=in.(a,b)&select=*", {});
  });

  // DEN SUBTILE. Hver portion kommer sorteret hjem, men de sættes sammen efter
  // hinanden — så uden `sortBy` ville rækkefølgen være rigtig for de første 100
  // kampe og derefter begynde forfra. Runde-inddelingen ville se ud som data,
  // der var noget galt med, ikke som en fejl i koden.
  it("gensorterer på tværs af portionerne, når kaldet havde et order=", async () => {
    const ids = uuider(150);
    db.select.mockImplementation(async (t, tabel, q) => {
      const del = q.slice(q.indexOf("(") + 1, q.indexOf(")")).split(",");
      // Anden portion er TIDLIGERE end første — præcis det, et globalt `order=`
      // ville have rettet, og som sammensætningen ellers taber.
      const base = del.length === 100 ? "2026-05-01" : "2026-01-01";
      return del.map((_, i) => ({ kickoff_at: `${base}T00:${String(i).padStart(2, "0")}:00Z` }));
    });
    const ud = await selectIn("tok", "matches", "id", ids, "&select=*&order=kickoff_at", { sortBy: "kickoff_at" });
    expect(ud).toHaveLength(150);
    const tider = ud.map((m) => m.kickoff_at);
    expect([...tider].sort()).toEqual(tider);
  });

  it("lægger rækker uden værdi sidst, som order= med nulls last", async () => {
    db.select.mockResolvedValue([
      { kickoff_at: null }, { kickoff_at: "2026-01-02" }, { kickoff_at: "2026-01-01" },
    ]);
    const ud = await selectIn("tok", "matches", "id", ["a"], "&select=*", { sortBy: "kickoff_at" });
    expect(ud.map((m) => m.kickoff_at)).toEqual(["2026-01-01", "2026-01-02", null]);
  });

  // `signal` skal nå igennem: uden den kan en skærm, brugeren har forladt, ikke
  // afbrydes, og `G25`s afbrydelses-håndtering ville stille holde op med at virke
  // netop for de opslag, der tager længst tid.
  it("fører afbrydelses-signalet videre til hver portion", async () => {
    const signal = { aborted: false };
    await selectIn("tok", "matches", "id", uuider(150), "&select=*", { signal });
    expect(db.select).toHaveBeenCalledTimes(2);
    for (const [, , , opts] of db.select.mock.calls) expect(opts).toEqual({ signal });
  });
});
