import { describe, it, expect, vi, afterEach } from "vitest";
import { roundStatus } from "./roundStatus.js";

// Rundens statuslinje havde ingen dækning, før den blev udskilt af PredictionsScreen —
// og det var netop dén, per-kamp-låsen (A21) ændrede mest. Testene her er skrevet mod
// de fem tilstande, ikke mod ordlyden, men de citerer teksten, fordi den ER kontrakten:
// linjen er brugerens eneste kilde til, hvornår noget låser.

const m = (id, kickoff_at, home_score = null, away_score = null) =>
  ({ id, season_id: "s1", round_key: "2026-07-13", kickoff_at, home_score, away_score });
const tip = (h, a) => ({ pred_home: h, pred_away: a });

describe("roundStatus", () => {
  afterEach(() => vi.useRealTimers());

  it("giver null uden kampe", () => {
    expect(roundStatus({ matches: [] })).toBeNull();
    expect(roundStatus({ matches: null })).toBeNull();
  });

  it("færdigspillet runde viser point og skjuler Slut-mærket på rækkerne", () => {
    vi.useFakeTimers({ now: new Date("2026-07-20T12:00:00Z") });
    const ms = [m("a", "2026-07-15T17:00:00Z", 2, 1), m("b", "2026-07-16T17:00:00Z", 0, 0)];
    const out = roundStatus({ matches: ms, preds: { a: tip(2, 1), b: tip(1, 0) } });
    expect(out.status).toBe("Spillet · 3 point"); // præcist hit + forkert udfald
    expect(out.showFinal).toBe(false);
  });

  // Kernen i A21: en tidligere kamps lås må ikke gøre runden "Låst".
  it("delvist låst runde tæller kun de kampe, der stadig kan tippes", () => {
    vi.useFakeTimers({ now: new Date("2026-07-15T16:30:00Z") }); // kamp a låste 16:00
    const ms = [m("a", "2026-07-15T17:00:00Z"), m("b", "2026-07-18T14:00:00Z"), m("c", "2026-07-19T14:00:00Z")];
    const out = roundStatus({ matches: ms, preds: { b: tip(1, 0) } });
    expect(out.status).toContain("1 af 2 tippet"); // a er låst og tælles ikke med
    expect(out.status).toContain("Næste lås");
  });

  it("siger \"Låser\" i ental, når præcis én kamp er tilbage at tippe", () => {
    vi.useFakeTimers({ now: new Date("2026-07-18T12:00:00Z") });
    const ms = [m("a", "2026-07-15T17:00:00Z", 1, 0), m("b", "2026-07-18T14:00:00Z")];
    const out = roundStatus({ matches: ms });
    expect(out.status).toContain("0 af 1 tippet");
    expect(out.status).toContain("Låser om 1 t 0 min");
    expect(out.status).not.toContain("Næste lås");
  });

  it("nedtællingen peger på den FØRSTE lås, der løber ud", () => {
    vi.useFakeTimers({ now: new Date("2026-07-18T12:00:00Z") });
    // b låser 13:00, c låser 13:00 dagen efter — hovedet skal vise b's
    const ms = [m("c", "2026-07-19T14:00:00Z"), m("b", "2026-07-18T14:00:00Z")];
    expect(roundStatus({ matches: ms }).status).toContain("Næste lås om 1 t 0 min");
  });

  it("er \"Låst\", når ingen kamp kan tippes — og siger hvor mange der nåede at komme ind", () => {
    vi.useFakeTimers({ now: new Date("2026-07-18T13:30:00Z") });
    const ms = [m("a", "2026-07-15T17:00:00Z", 2, 0), m("b", "2026-07-18T14:00:00Z")];
    const out = roundStatus({ matches: ms, preds: { a: tip(2, 0) } });
    expect(out.status).toBe("Låst · 1 af 2 tippet · 1/2 spillet");
  });

  // Det rullende gætte-vindue er fjernet (B1), så en kamp langt ude i fremtiden
  // er tipbar med det samme og tælles med i hovedet frem for at vente på en åbning.
  it("tæller en kamp langt ude i fremtiden med som tipbar", () => {
    vi.useFakeTimers({ now: new Date("2026-07-01T12:00:00Z") });
    const ms = [m("a", "2026-07-15T17:00:00Z"), m("b", "2026-07-25T14:00:00Z")];
    const out = roundStatus({ matches: ms });
    expect(out.status).toContain("0 af 2 tippet");
    expect(out.status).not.toContain("Åbner");
  });

  it("en kamp uden kendt kickoff tælles som tipbar, men bærer ingen deadline", () => {
    vi.useFakeTimers({ now: new Date("2026-07-14T12:00:00Z") });
    const out = roundStatus({ matches: [m("a", null)] });
    expect(out.status).toBe("0 af 1 tippet"); // ingen "Låser om …" at hænge på
  });
});
