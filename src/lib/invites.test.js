import { describe, it, expect, vi, beforeEach } from "vitest";

// groups-modulet mockes, så de to invitations-flows kan testes uden netværk. Det
// er hele grunden til, at logikken blev flyttet ud af MainApp (G1):
// testopsætningen er bevidst uden jsdom, så alt, der kun kan nås gennem en
// render, kunne kun efterprøves i hånden — og `A23` står åben netop med den
// begrundelse, at ingen test dækker de to flows.
//
// ---------------------------------------------------------------------------
// A40 (10. august 2026): testene måler nu ét kald i stedet for fire
//
// Flowene slog før direkte op i `competitions`/`groups` og hentede derefter
// inviterens og ligaens navn i hvert sit ekstra kald — og den mockede
// tabel-attrap herunder var en tro kopi af netop dét. Det kunne kun lade sig
// gøre, fordi begge tabeller var læsbare for enhver indlogget bruger, hvilket
// var hullet. Opslaget er nu `invite_lookup()`, og testene beskriver derfor
// dens svar frem for en rækkefølge af tabelopslag.
//
// **Påstandene er de samme.** Det er værd at hæfte sig ved: hvert eneste
// `it()` herunder stod her før omskrivningen og siger det samme om produktets
// adfærd. Kun det, de kalder, har flyttet sig.
vi.mock("./data/groups.js", () => ({ inviteLookup: vi.fn(), invitePreview: vi.fn(), acceptInvite: vi.fn() }));

import { inviteLookup, invitePreview, acceptInvite } from "./data/groups.js";
import { resolveCompetitionInvite, resolveLeagueInvite, loadInvitePreview, invitationsPitch } from "./data/invites.js";

beforeEach(() => {
  inviteLookup.mockReset();
  acceptInvite.mockReset();
  acceptInvite.mockResolvedValue({ kind: "competition", joined: false });
});

const COMP = { id: "c1", name: "Vennerne", group_id: "g1", created_by: "u9" };
const GROUP = { id: "g1", name: "Padel Legends" };

describe("resolveCompetitionInvite", () => {
  it("melder notfound for en kode, ingen konkurrence har", async () => {
    inviteLookup.mockResolvedValue({ kind: "none" });
    expect(await resolveCompetitionInvite("t", "XXXX")).toEqual({ kind: "notfound" });
  });

  // En liga-kode er ikke en konkurrence-kode. Den gamle udgave nåede samme svar
  // ved at slå op i en tabel, der ikke havde koden; nu skelner `kind`.
  it("melder notfound, når koden peger på en LIGA", async () => {
    inviteLookup.mockResolvedValue({ kind: "group", group: GROUP });
    expect(await resolveCompetitionInvite("t", "ABCD")).toEqual({ kind: "notfound" });
  });

  it("giver 'confirm' med inviterens og ligaens navn, når man ikke er deltager", async () => {
    inviteLookup.mockResolvedValue({
      kind: "competition", competition: COMP, already: false,
      inviter_name: "Anna", group_name: "Padel Legends",
    });
    const res = await resolveCompetitionInvite("t", "ABCD");
    expect(res.kind).toBe("confirm");
    expect(res.competition).toEqual(COMP);
    expect(res.inviterName).toBe("Anna");
    expect(res.groupName).toBe("Padel Legends");
    // Bekræftelsen er en LÆSNING — der må ikke være meldt nogen ind endnu.
    expect(acceptInvite).not.toHaveBeenCalled();
  });

  // Koden følger med tilbage, fordi tilmeldingen kræver den og ikke et id
  // (A40). Uden den ville MainApp skulle gemme den ved siden af resultatet.
  it("bærer koden med i 'confirm', så bekræftelsen kan tilmelde", async () => {
    inviteLookup.mockResolvedValue({ kind: "competition", competition: COMP, already: false });
    expect((await resolveCompetitionInvite("t", "ABCD")).code).toBe("ABCD");
  });

  // De to navne er pynt på bekræftelsen. Mangler de, skal bekræftelsen stadig
  // komme — ellers koster et tomt felt brugeren invitationen.
  it("viser bekræftelsen uden navne, når svaret ikke bærer dem", async () => {
    inviteLookup.mockResolvedValue({
      kind: "competition", competition: COMP, already: false,
      inviter_name: null, group_name: null,
    });
    const res = await resolveCompetitionInvite("t", "ABCD");
    expect(res.kind).toBe("confirm");
    expect(res.inviterName).toBe("");
    expect(res.groupName).toBe("");
  });

  // A8: en deltager UDEN liga-medlemskab er den halve tilstand, hullet
  // efterlod. At trykke på linket igen skal RETTE det, ikke bare navigere.
  it("reparerer liga-medlemskabet, når man allerede er deltager", async () => {
    inviteLookup.mockResolvedValue({ kind: "competition", competition: COMP, already: true });
    const res = await resolveCompetitionInvite("t", "ABCD");
    expect(res).toEqual({ kind: "already", competition: COMP, code: "ABCD" });
    expect(acceptInvite).toHaveBeenCalledWith("t", "ABCD");
  });

  it("navigerer stadig, selvom reparationen af liga-medlemskabet fejler", async () => {
    inviteLookup.mockResolvedValue({ kind: "competition", competition: COMP, already: true });
    acceptInvite.mockRejectedValue(new Error("nede"));
    expect((await resolveCompetitionInvite("t", "ABCD")).kind).toBe("already");
  });

  it("rører ikke ligaer for en liga-løs konkurrence", async () => {
    inviteLookup.mockResolvedValue({
      kind: "competition", competition: { ...COMP, group_id: null }, already: false,
      inviter_name: "Anna", group_name: null,
    });
    const res = await resolveCompetitionInvite("t", "ABCD");
    expect(res.groupName).toBe("");
    expect(acceptInvite).not.toHaveBeenCalled();
  });

  // Skellet, kalderen hænger på: en ukendt kode er brugerens tastefejl og får
  // sin egen besked, mens en fejl er vores og skal boble op.
  it("kaster ved serverfejl frem for at melde notfound", async () => {
    inviteLookup.mockRejectedValue(new Error("500"));
    await expect(resolveCompetitionInvite("t", "ABCD")).rejects.toThrow();
  });
});

describe("resolveLeagueInvite", () => {
  it("melder notfound for en ukendt kode", async () => {
    inviteLookup.mockResolvedValue({ kind: "none" });
    expect(await resolveLeagueInvite("t", "XXXX")).toEqual({ kind: "notfound" });
  });

  it("melder notfound, når koden peger på en KONKURRENCE", async () => {
    inviteLookup.mockResolvedValue({ kind: "competition", competition: COMP });
    expect(await resolveLeagueInvite("t", "ABCD")).toEqual({ kind: "notfound" });
  });

  it("giver 'already' for et eksisterende medlem", async () => {
    inviteLookup.mockResolvedValue({ kind: "group", group: GROUP, already: true });
    expect(await resolveLeagueInvite("t", "ABCD")).toEqual({ kind: "already", group: GROUP });
  });

  it("giver 'confirm' for en ny bruger", async () => {
    inviteLookup.mockResolvedValue({ kind: "group", group: GROUP, already: false });
    expect(await resolveLeagueInvite("t", "ABCD")).toEqual({ kind: "confirm", group: GROUP, code: "ABCD" });
    // Liga-vejen melder ALDRIG ind uden bekræftelse — modsat konkurrence-vejens
    // reparation, som kun sker for en, der allerede ER deltager.
    expect(acceptInvite).not.toHaveBeenCalled();
  });

  it("kaster ved serverfejl", async () => {
    inviteLookup.mockRejectedValue(new Error("500"));
    await expect(resolveLeagueInvite("t", "ABCD")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// I7: etiketten, læst UDEN login
//
// De to flows ovenfor kræver en session, fordi de fører til en tilmelding.
// `loadInvitePreview` gør ikke — den er dét, der gør, at en helt ny bruger kan
// se, hvad de er inviteret til, før de opretter en konto. Kontrakten er en
// ANDEN og strengere: den må aldrig kaste, fordi et fejlet opslag her ikke er
// en fejl, brugeren skal se, men blot en login-skærm uden pynt.
describe("loadInvitePreview", () => {
  beforeEach(() => { invitePreview.mockReset(); });

  it("giver previewet videre for en liga", async () => {
    invitePreview.mockResolvedValue({ kind: "group", name: "Vennerne", member_count: 6 });
    expect(await loadInvitePreview("abc12345")).toEqual({ kind: "group", name: "Vennerne", member_count: 6 });
  });

  it("giver null for en ukendt kode", async () => {
    invitePreview.mockResolvedValue({ kind: "none" });
    expect(await loadInvitePreview("findesikke")).toBeNull();
  });

  // Den vigtigste: et net, der fejler, må ikke vælte oprettelsen.
  it("kaster aldrig — en fejl bliver til null", async () => {
    invitePreview.mockRejectedValue(new Error("netværk"));
    await expect(loadInvitePreview("abc12345")).resolves.toBeNull();
  });

  it("kasserer et svar, der ikke ligner et preview", async () => {
    invitePreview.mockResolvedValue(null);
    expect(await loadInvitePreview("abc12345")).toBeNull();
  });
});

// Ordlyden på login-skærmen. Den bor i en REN funktion netop for at kunne
// testes: testopsætningen er uden jsdom, så alt, der kun kan nås gennem en
// render, kunne ellers kun efterprøves i hånden.
describe("invitationsPitch", () => {
  it("navngiver ligaen og tæller dem, der allerede er med", () => {
    const p = invitationsPitch({ kind: "group", name: "Vennerne", member_count: 6 });
    expect(p.overskrift).toBe('Du er inviteret til ligaen "Vennerne".');
    expect(p.detalje).toBe("6 spillere er allerede med. Opret en konto for at være med.");
  });

  it("bøjer ental rigtigt", () => {
    expect(invitationsPitch({ kind: "group", name: "V", member_count: 1 }).detalje)
      .toBe("1 spiller er allerede med. Opret en konto for at være med.");
  });

  // "0 spillere er allerede med" ville være en grund til at lade være.
  it("udelader medlemstallet, når det er nul", () => {
    expect(invitationsPitch({ kind: "group", name: "V", member_count: 0 }).detalje)
      .toBe("Opret en konto for at være med.");
  });

  // Ligaen nævnes, fordi man også meldes ind i DEN (A8) — modtageren skal kunne
  // se begge dele, de siger ja til.
  it("nævner ligaen bag en konkurrence-invitation", () => {
    expect(invitationsPitch({ kind: "competition", name: "EM-kuponen", group_name: "Vennerne", member_count: 3 }).overskrift)
      .toBe('Du er inviteret til konkurrencen "EM-kuponen" i ligaen "Vennerne".');
  });

  it("udelader ligaen, når konkurrencen er ligaløs", () => {
    expect(invitationsPitch({ kind: "competition", name: "EM-kuponen", member_count: 3 }).overskrift)
      .toBe('Du er inviteret til konkurrencen "EM-kuponen".');
  });

  // Intet preview er et fuldgyldigt udfald: skærmen viser da den generelle
  // sælgetekst, altså præcis som før I7.
  it.each([null, undefined, { kind: "none" }, { kind: "group" }])("giver null for %s", (input) => {
    expect(invitationsPitch(input)).toBeNull();
  });
});
