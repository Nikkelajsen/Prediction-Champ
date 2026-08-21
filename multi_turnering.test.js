// Sømmen mellem SKRIVEREN og LÆSEREN i en flerturnerings-konkurrence (`G8`).
//
// Formen har to ender, og de bor i hver sin verden: `createCompetition()`
// (`src/lib/data/competitions.js`) SKRIVER `mode_params.tournaments`, og
// efterfyldningen (`api/_backfill.js`) LÆSER den — `api/` importerer med vilje
// ikke fra `src/`, så der er intet delt modul til at holde de to sammen.
//
// Begge ender var dækket af hver sin unit-test, og begge tests skrev rækken i
// hånden. To håndskrevne rækker, der ligner hinanden, er ikke en aftale: dagen
// nogen omdøber `league_id` til `leagueId` i den ene ende, består begge tests
// stadig, og fejlen viser sig først som en konkurrence, der tavst holder op med
// at vokse. Det er præcis dét, `G8` kalder "fejler den, fejler den tavst i et
// hjørne, ingen har haft brug for endnu" — og hjørnet findes stadig, fordi
// `mode_params.tournaments` aldrig er blevet skrevet i produktion.
//
// Testen her skriver derfor rækken med den RIGTIGE skriver og giver den til den
// RIGTIGE læser, uden en håndskrevet række imellem. Den kan ikke erstatte en
// aflæsning i produktion — den kan sikre, at de to ender taler samme sprog.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./src/lib/supabase.js", () => ({
  db: { select: vi.fn(), count: vi.fn(), del: vi.fn(), insert: vi.fn() },
  restFetch: vi.fn(),
}));
import { db, restFetch } from "./src/lib/supabase.js";
import { createCompetition } from "./src/lib/data.js";
import { coversSeason, matchesToBackfill } from "./api/_backfill.js";

const NOW = Date.parse("2026-08-10T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const UGEN = "2026-08-11"; // rundens tirsdag (`round_key()` i sql/rating_core.sql)

// Kampene, skriveren finder ved oprettelsen — én i hver turnering. Uden
// `kickoff_at` er kampen ikke låst (`isLocked`), så begge kommer med.
const VED_OPRETTELSEN = {
  S1: [{ id: "s1-m1", round_key: "2026-08-04", home_score: null }],
  S2: [{ id: "s2-m1", round_key: "2026-08-04", home_score: null }],
};

// Rækken, som `create_competition()` ville have skrevet den: RPC'ens parametre
// ER kolonnerne. Det er den oversættelse, efterfyldningen møder i basen.
function rækkenIBasen() {
  const body = restFetch.mock.calls.find((c) => String(c[0]).endsWith("/rpc/create_competition"))?.[1]?.body;
  return {
    id: "c1",
    mode: body.p_mode,
    mode_params: body.p_mode_params,
    league_id: body.p_league_id,
    season_id: body.p_season_id,
  };
}

async function opretOverToTurneringer(spec = {}) {
  db.select.mockImplementation(async (_token, _table, query) => {
    const sæson = /season_id=eq\.([^&]+)/.exec(query)?.[1];
    return VED_OPRETTELSEN[sæson] || [];
  });
  restFetch.mockImplementation(async (path, { body } = {}) =>
    String(path).endsWith("/rpc/create_competition") ? { id: "c1", ...body } : null);
  await createCompetition("token", "u1", {
    groupId: "g1", name: "To ligaer", mode: "full_season",
    tournaments: [{ leagueId: "L1", seasonId: "S1" }, { leagueId: "L2", seasonId: "S2" }],
    ...spec,
  });
  return rækkenIBasen();
}

describe("flerturnerings-konkurrencen fra skriver til efterfyldning (G8)", () => {
  beforeEach(() => {
    db.select.mockReset();
    restFetch.mockReset();
  });

  it("efterfyldningen genkender rækken på BEGGE turneringer", async () => {
    const række = await opretOverToTurneringer();

    // Turneringsløs — og dermed usynlig for `season_id`-grenen alene.
    expect(række.league_id).toBeNull();
    expect(række.season_id).toBeNull();

    expect(coversSeason(række, "S1")).toBe(true);
    expect(coversSeason(række, "S2")).toBe(true);
    expect(coversSeason(række, "S3")).toBe(false);
  });

  it("efterfyldningen tilføjer den kamp, leverandøren først har skemalagt bagefter", async () => {
    const række = await opretOverToTurneringer();

    // Sæson S2 synkroniseres, og der er kommet en kamp til, konkurrencen ikke
    // har. `existingIds` er dét, oprettelsen skrev for netop dén sæson.
    const nu = matchesToBackfill({
      competition: række,
      matches: [
        ...VED_OPRETTELSEN.S2,
        { id: "s2-ny", round_key: UGEN, kickoff_at: iso(NOW + 7 * 24 * 60 * 60 * 1000), home_score: null },
      ],
      existingIds: ["s2-m1"],
      nowMs: NOW,
    });
    expect(nu).toEqual(["s2-ny"]);
  });

  it("regel 3 måler runden over konkurrencens ANDEN turnering, ikke kun den synkroniserede", async () => {
    const række = await opretOverToTurneringer();

    // Samme runde, men den anden turnerings kamp begynder om en halv time:
    // runden er i gang for konkurrencen, og så vokser den ikke.
    const nu = matchesToBackfill({
      competition: række,
      matches: [{ id: "s2-ny", round_key: UGEN, kickoff_at: iso(NOW + 7 * 24 * 60 * 60 * 1000), home_score: null }],
      existingIds: [],
      nowMs: NOW,
      otherSeasonMatches: [{ id: "s1-ny", round_key: UGEN, kickoff_at: iso(NOW + 30 * 60 * 1000), home_score: null }],
    });
    expect(nu).toEqual([]);
  });

  it("ÉN turnering beholder den bundne form, som efterfyldningen kender fra før", async () => {
    db.select.mockImplementation(async () => VED_OPRETTELSEN.S1);
    restFetch.mockImplementation(async (path, { body } = {}) =>
      String(path).endsWith("/rpc/create_competition") ? { id: "c1", ...body } : null);
    await createCompetition("token", "u1", {
      groupId: "g1", name: "Én liga", mode: "full_season",
      tournaments: [{ leagueId: "L1", seasonId: "S1" }],
    });
    const række = rækkenIBasen();

    expect(række.season_id).toBe("S1");
    expect(række.mode_params.tournaments).toBeUndefined();
    expect(coversSeason(række, "S1")).toBe(true);
  });
});
