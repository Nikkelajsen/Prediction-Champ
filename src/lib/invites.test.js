import { describe, it, expect, vi, beforeEach } from "vitest";

// db og groups-modulet mockes, så de to invitations-flows kan testes uden
// netværk. Det er hele grunden til, at logikken blev flyttet ud af MainApp
// (G1): testopsætningen er bevidst uden jsdom, så alt, der kun kan nås gennem
// en render, kunne kun efterprøves i hånden — og `A23` står åben netop med den
// begrundelse, at ingen test dækker de to flows.
vi.mock("./supabase.js", () => ({ db: { select: vi.fn(), del: vi.fn(), insert: vi.fn() }, restFetch: vi.fn() }));
vi.mock("./data/groups.js", () => ({ loadGroupByCode: vi.fn(), joinGroup: vi.fn() }));

import { db } from "./supabase.js";
import { loadGroupByCode, joinGroup } from "./data/groups.js";
import { resolveCompetitionInvite, resolveLeagueInvite } from "./data/invites.js";

function mockTables(tables) {
  db.select.mockImplementation(async (token, table, query) => {
    if (!(table in tables)) throw new Error(`uventet tabel i test: ${table}`);
    const rows = tables[table];
    return typeof rows === "function" ? rows(query) : rows;
  });
}

beforeEach(() => {
  db.select.mockReset();
  loadGroupByCode.mockReset();
  joinGroup.mockReset();
});

const COMP = { id: "c1", name: "Vennerne", group_id: "g1", created_by: "u9" };

describe("resolveCompetitionInvite", () => {
  it("melder notfound for en kode, ingen konkurrence har", async () => {
    mockTables({ competitions: [] });
    expect(await resolveCompetitionInvite("t", "u1", "XXXX")).toEqual({ kind: "notfound" });
  });

  it("giver 'confirm' med inviterens og ligaens navn, når man ikke er deltager", async () => {
    mockTables({
      competitions: [COMP],
      competition_participants: [],
      profiles: [{ display_name: "Anna" }],
      groups: [{ name: "Padel Legends" }],
    });
    const res = await resolveCompetitionInvite("t", "u1", "ABCD");
    expect(res.kind).toBe("confirm");
    expect(res.competition).toEqual(COMP);
    expect(res.inviterName).toBe("Anna");
    expect(res.groupName).toBe("Padel Legends");
    // Bekræftelsen er en LÆSNING — der må ikke være meldt nogen ind endnu.
    expect(joinGroup).not.toHaveBeenCalled();
  });

  // De to navne er pynt på bekræftelsen. Fejler opslaget, skal bekræftelsen
  // stadig komme — ellers koster et fladt profil-opslag brugeren invitationen.
  it("viser bekræftelsen uden navne, hvis opslagene af dem fejler", async () => {
    db.select.mockImplementation(async (token, table) => {
      if (table === "competitions") return [COMP];
      if (table === "competition_participants") return [];
      throw new Error("nede");
    });
    const res = await resolveCompetitionInvite("t", "u1", "ABCD");
    expect(res.kind).toBe("confirm");
    expect(res.inviterName).toBe("");
    expect(res.groupName).toBe("");
  });

  // A8: en deltager UDEN liga-medlemskab er den halve tilstand, hullet
  // efterlod. At trykke på linket igen skal RETTE det, ikke bare navigere.
  it("reparerer liga-medlemskabet, når man allerede er deltager", async () => {
    mockTables({ competitions: [COMP], competition_participants: [{ competition_id: "c1" }] });
    const res = await resolveCompetitionInvite("t", "u1", "ABCD");
    expect(res).toEqual({ kind: "already", competition: COMP });
    expect(joinGroup).toHaveBeenCalledWith("t", "u1", "g1");
  });

  it("navigerer stadig, selvom reparationen af liga-medlemskabet fejler", async () => {
    mockTables({ competitions: [COMP], competition_participants: [{ competition_id: "c1" }] });
    joinGroup.mockRejectedValue(new Error("nede"));
    expect((await resolveCompetitionInvite("t", "u1", "ABCD")).kind).toBe("already");
  });

  it("rører ikke ligaer for en liga-løs konkurrence", async () => {
    mockTables({
      competitions: [{ ...COMP, group_id: null }],
      competition_participants: [],
      profiles: [{ display_name: "Anna" }],
    });
    const res = await resolveCompetitionInvite("t", "u1", "ABCD");
    expect(res.groupName).toBe("");
    expect(joinGroup).not.toHaveBeenCalled();
  });

  // Skellet, kalderen hænger på: en ukendt kode er brugerens tastefejl og får
  // sin egen besked, mens en fejl er vores og skal boble op.
  it("kaster ved serverfejl frem for at melde notfound", async () => {
    db.select.mockRejectedValue(new Error("500"));
    await expect(resolveCompetitionInvite("t", "u1", "ABCD")).rejects.toThrow();
  });
});

describe("resolveLeagueInvite", () => {
  const GROUP = { id: "g1", name: "Padel Legends" };

  it("melder notfound for en ukendt kode", async () => {
    loadGroupByCode.mockResolvedValue(null);
    expect(await resolveLeagueInvite("t", "u1", "XXXX")).toEqual({ kind: "notfound" });
  });

  it("giver 'already' for et eksisterende medlem", async () => {
    loadGroupByCode.mockResolvedValue(GROUP);
    mockTables({ group_members: [{ user_id: "u1" }] });
    expect(await resolveLeagueInvite("t", "u1", "ABCD")).toEqual({ kind: "already", group: GROUP });
  });

  it("giver 'confirm' for en ny bruger", async () => {
    loadGroupByCode.mockResolvedValue(GROUP);
    mockTables({ group_members: [] });
    expect(await resolveLeagueInvite("t", "u1", "ABCD")).toEqual({ kind: "confirm", group: GROUP });
    // Liga-vejen melder ALDRIG ind uden bekræftelse — modsat konkurrence-vejens
    // reparation, som kun sker for en, der allerede ER deltager.
    expect(joinGroup).not.toHaveBeenCalled();
  });

  it("kaster ved serverfejl", async () => {
    loadGroupByCode.mockRejectedValue(new Error("500"));
    await expect(resolveLeagueInvite("t", "u1", "ABCD")).rejects.toThrow();
  });
});
