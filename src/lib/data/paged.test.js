import { describe, it, expect, vi, beforeEach } from "vitest";

// `db` mockes, så sideinddelingen kan måles på de forespørgsler, den bygger.
vi.mock("../supabase.js", () => ({ db: { select: vi.fn() }, restFetch: vi.fn() }));

import { db } from "../supabase.js";
import { selectAll, SIDE, MAX_SIDER } from "./paged.js";

// En attrap-PostgREST med det ENE træk, hjælperen findes for: et tavst loft.
// Den svarer aldrig med mere end `loft` rækker og siger ikke, at der var mere —
// præcis som Supabase. `rækker` er tabellen; `limit`/`offset` læses af svaret.
function installér(rækker, loft = 1000) {
  db.select.mockImplementation(async (_t, _tabel, query) => {
    const f = Object.fromEntries(query.split("&").map((d) => [d.slice(0, d.indexOf("=")), d.slice(d.indexOf("=") + 1)]));
    const fra = Number(f.offset || 0);
    const antal = Math.min(Number(f.limit || loft), loft);
    return rækker.slice(fra, fra + antal);
  });
}
const rækker = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));

beforeEach(() => { db.select.mockReset(); });

describe("selectAll", () => {
  // Egenskaben, lagdelingen hviler på (samme som `selectIn`): den FØRSTE
  // forespørgsel er ordret den, kaldsstedet skrev, med `limit`/`offset` sat
  // bagpå — og den går gennem `db.select`, så hver test, der mocker
  // `supabase.js`, stadig fanger kaldet.
  it("bygger den forespørgsel, kaldsstedet skrev, med side og plads bagpå", async () => {
    installér(rækker(12));
    const ud = await selectAll("tok", "ratings", "scope=eq.ALL&select=id&order=id.asc");
    expect(ud).toHaveLength(12);
    expect(db.select).toHaveBeenNthCalledWith(1, "tok", "ratings",
      `scope=eq.ALL&select=id&order=id.asc&limit=${SIDE}&offset=0`, {});
    // Og den anden er den tomme side, der beviser, at 12 var alt.
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  // SELVE FEJLEN. En liste over serverens loft kom hjem afkortet — uden en fejl,
  // uden en advarsel og uden et felt i svaret, der sagde, at der var mere.
  it("henter hele listen, også når den er længere end serverens loft", async () => {
    installér(rækker(2350));
    const ud = await selectAll("tok", "ratings", "scope=eq.ALL&select=id&order=id.asc");
    expect(ud).toHaveLength(2350);
    expect(ud.map((r) => r.id)).toEqual(rækker(2350).map((r) => r.id)); // hverken tabt eller talt dobbelt
  });

  // Modprøven: uden hjælperen ville den samme attrap svare 1000 og se rigtig ud.
  it("modprøve: ét enkelt db.select på samme tabel havde givet 1000 og ingen fejl", async () => {
    installér(rækker(2350));
    const ét = await db.select("tok", "ratings", "scope=eq.ALL&select=id&order=id.asc");
    expect(ét).toHaveLength(1000);
  });

  // DEN REGEL, `sbAll` I `api/_shared.js` ER SKREVET FOR (`G51`), OG SOM DENNE
  // ARVER: der stoppes ved en TOM side og ikke ved en kort side. Er projektets
  // `db-max-rows` mindre end sidestørrelsen, er "kortere end bestilt" sandt for
  // hver eneste fulde side — og en kur, der stoppede dér, ville være den samme
  // tavse afkortning en gang til. Loftet kan ikke aflæses fra repoet.
  it("henter det hele, også når serverens loft er MINDRE end sidestørrelsen", async () => {
    installér(rækker(1700), 300); // et projekt med db-max-rows = 300
    expect(await selectAll("tok", "ratings", "select=id&order=id.asc")).toHaveLength(1700);
  });

  // Følgen af den samme regel: `offset` er, hvor langt vi FAKTISK er nået, og
  // ikke sidetallet gange sidestørrelsen. Ellers ville et lavere loft springe
  // rækker over ved hver side.
  it("rykker offset frem efter de rækker, der kom hjem", async () => {
    installér(rækker(700), 300);
    await selectAll("tok", "ratings", "select=id&order=id.asc");
    expect(db.select.mock.calls.map(([, , q]) => q.match(/offset=(\d+)/)[1])).toEqual([
      "0",
      "300",
      "600",
      "700",
    ]);
  });

  // Den tomme side er prisen, og den er bevidst: den er beviset på, at der ikke
  // var mere. Uden den skulle vi gætte på et loft, vi ikke kan se.
  it("spørger én gang til efter en fuld side og stopper på det tomme svar", async () => {
    installér(rækker(SIDE));
    const ud = await selectAll("tok", "ratings", "select=id&order=id.asc");
    expect(ud).toHaveLength(SIDE);
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it("giver en tom liste uden rækker", async () => {
    installér([]);
    expect(await selectAll("tok", "ratings", "select=id&order=id.asc")).toEqual([]);
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  // `order=` er kravet, hele sideinddelingen hviler på: uden en total orden må
  // databasen selv vælge rækkefølgen, og så kan en række komme med på to sider,
  // mens en anden slipper forbi begge. Det ville være nøjagtig den fejl,
  // hjælperen fjerner — derfor en fejl i test og ikke hos en bruger.
  it("nægter at læse sidevis uden et order=", async () => {
    installér(rækker(10));
    await expect(selectAll("tok", "ratings", "scope=eq.ALL&select=id")).rejects.toThrow(/order=/);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("lader sig ikke narre af et 'order' inde i et feltnavn", async () => {
    installér(rækker(3));
    await expect(selectAll("tok", "t", "select=reorder=1")).rejects.toThrow(/order=/);
  });

  // Et bevidst afgrænset opslag hører til på `db.select`. Blandingen er
  // meningsløs: hjælperen sætter selv limit/offset på hver side.
  it("nægter en forespørgsel, der har sit eget limit eller offset", async () => {
    installér(rækker(10));
    await expect(selectAll("tok", "t", "select=id&order=id.asc&limit=5")).rejects.toThrow(/limit/);
    await expect(selectAll("tok", "t", "select=id&order=id.asc&offset=5")).rejects.toThrow(/limit/);
  });

  it("sender signalet med, så et skift af skærm kan afbryde læsningen", async () => {
    installér(rækker(3));
    const signal = new AbortController().signal;
    await selectAll("tok", "t", "select=id&order=id.asc", { signal });
    expect(db.select.mock.calls[0][3]).toEqual({ signal });
  });

  // Nødstoppet: en server, der ignorerer `offset`, ville ellers give en løkke,
  // der aldrig slutter. Den skal ende som en fejl, nogen kan læse.
  it("stopper og kaster frem for at hente i det uendelige", async () => {
    db.select.mockImplementation(async () => rækker(10)); // ignorerer offset
    await expect(selectAll("tok", "ratings", "select=id&order=id.asc")).rejects.toThrow(/ratings/);
    expect(db.select).toHaveBeenCalledTimes(MAX_SIDER);
  });
});
