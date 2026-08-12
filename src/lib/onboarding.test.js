import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase.js", () => ({ db: { select: vi.fn(), insert: vi.fn() }, restFetch: vi.fn() }));
import { db, restFetch } from "./supabase.js";
import { deriveOnboarding, loadHasPrediction, defaultLeagueName, validateGroupName, createStarterLeague } from "./onboarding.js";

beforeEach(() => { db.select.mockReset(); db.insert.mockReset(); restFetch.mockReset(); });

const solo = (n = 1) => ({ id: "g1", name: "Vennerne", memberCount: n });
const comp = { id: "c1", name: "Superligaen", group_id: "g1" };

describe("deriveOnboarding", () => {
  it("en helt kold bruger står på første trin og er ikke færdig", () => {
    const s = deriveOnboarding({ groups: [], competitions: [], hasPrediction: false });
    expect(s.nextStepId).toBe("liga");
    expect(s.complete).toBe(false);
    expect(s.doneCount).toBe(0);
    expect(s.steps.map((x) => x.done)).toEqual([false, false, false, false]);
  });

  it("liga uden konkurrence peger på konkurrence-trinnet", () => {
    const s = deriveOnboarding({ groups: [solo()], competitions: [], hasPrediction: false });
    expect(s.hasGroup).toBe(true);
    expect(s.nextStepId).toBe("konkurrence");
  });

  it("konkurrence uden tip peger på tip-trinnet", () => {
    const s = deriveOnboarding({ groups: [solo()], competitions: [comp], hasPrediction: false });
    expect(s.nextStepId).toBe("tip");
  });

  it("et tip afgivet alene er IKKE en gennemført onboarding — invitér mangler", () => {
    // North Star er aktive ligaer; en liga med ét medlem er en død liga.
    const s = deriveOnboarding({ groups: [solo(1)], competitions: [comp], hasPrediction: true });
    expect(s.hasCompanions).toBe(false);
    expect(s.nextStepId).toBe("invitér");
    expect(s.complete).toBe(false);
    expect(s.doneCount).toBe(3);
  });

  it("er færdig, når ligaen har mere end ét medlem og der er tippet", () => {
    const s = deriveOnboarding({ groups: [solo(2)], competitions: [comp], hasPrediction: true });
    expect(s.complete).toBe(true);
    expect(s.nextStepId).toBeNull();
    expect(s.doneCount).toBe(4);
  });

  it("kun liga-løse konkurrencer tæller IKKE som en liga", () => {
    // Konkurrencen lever uden for liga-strukturen og forsvinder med sæsonen —
    // trinnet er derfor uafsluttet, med et hint der siger hvorfor.
    const s = deriveOnboarding({ groups: [], competitions: [{ id: "c9", group_id: null }], hasPrediction: true });
    const liga = s.steps.find((x) => x.id === "liga");
    expect(liga.done).toBe(false);
    expect(liga.hint).toContain("uden for en liga");
    expect(s.nextStepId).toBe("liga");
  });

  it("tåler at blive kaldt uden argumenter", () => {
    expect(deriveOnboarding().complete).toBe(false);
    expect(deriveOnboarding().nextStepId).toBe("liga");
  });
});

describe("defaultLeagueName", () => {
  it("bøjer ejefald efter dansk regel", () => {
    expect(defaultLeagueName("Nikolaj")).toBe("Nikolajs liga");
    expect(defaultLeagueName("Lars")).toBe("Lars' liga");
    expect(defaultLeagueName("Max")).toBe("Max' liga");
  });

  it("falder tilbage, når der ikke er et navn — aldrig 'undefineds liga'", () => {
    // profile kan være null (App.jsx's completeAuth-catch).
    expect(defaultLeagueName(null)).toBe("Min liga");
    expect(defaultLeagueName("")).toBe("Min liga");
    expect(defaultLeagueName("   ")).toBe("Min liga");
  });

  it("holder sig altid inden for groups.name-constrainten (2-40 tegn)", () => {
    const longest = "A".repeat(20); // brugernavne er maks 20 tegn
    for (const n of [null, "Bo", "Lars", longest]) {
      const name = defaultLeagueName(n);
      expect(name.length).toBeGreaterThanOrEqual(2);
      expect(name.length).toBeLessThanOrEqual(40);
    }
  });
});

describe("validateGroupName", () => {
  it("afviser for korte og for lange navne, godtager resten", () => {
    expect(validateGroupName("A")).toContain("mindst 2 tegn");
    expect(validateGroupName("  ")).toContain("mindst 2 tegn");
    expect(validateGroupName("A".repeat(41))).toContain("højst være 40 tegn");
    expect(validateGroupName("Vennerne")).toBeNull();
  });
});

describe("loadHasPrediction", () => {
  it("spørger kun efter én række — vi skal vide om, ikke hvor mange", async () => {
    db.select.mockResolvedValueOnce([{ match_id: "m1" }]);
    expect(await loadHasPrediction("token", "u1")).toBe(true);
    expect(db.select).toHaveBeenCalledWith("token", "predictions", "user_id=eq.u1&select=match_id&limit=1");

    db.select.mockResolvedValueOnce([]);
    expect(await loadHasPrediction("token", "u1")).toBe(false);
  });
});

describe("createStarterLeague", () => {
  // Ligaen skrives af RPC'en `create_group()` siden `G95` og ikke længere med et
  // `db.insert` i "groups" — begge rækker (ligaen og opretterens admin-række)
  // bor nu i ét statement på serveren. Attrappen svarer derfor på RPC'en, og
  // `group_members` optræder ikke længere i `db.insert`-loggen. Det er ikke en
  // svækkelse af testene nedenfor: den rækkefølge, de vogter, er den mellem
  // LIGAEN og deltager-rækken, og den kan stadig aflæses.
  //
  // `calls` samler begge slags kald i den rækkefølge, de sker, så påstanden om
  // rækkefølge kan stilles på tværs af de to kaldeveje.
  let calls;
  function setup({ seasons = [{ id: "S1" }], matches = [{ id: "m1", round_key: "2026-08-11", home_score: null, stage_name: null }] } = {}) {
    calls = [];
    db.select.mockImplementation(async (token, table) => (table === "seasons" ? seasons : matches));
    restFetch.mockImplementation(async (path, opts) => {
      if (!path.endsWith("/rpc/create_group")) return undefined; // logEvent m.fl.
      calls.push("create_group");
      return { id: "g1", name: opts.body.p_name, invite_code: "abc12345" };
    });
    db.insert.mockImplementation(async (token, table, rows) => {
      calls.push(table);
      if (table === "competitions") return [{ id: "c1", ...rows[0] }];
      return undefined;
    });
  }

  it("opretter liga og konkurrence, og konkurrencen hører til ligaen", async () => {
    setup();
    const res = await createStarterLeague("token", "u1", {
      groupName: "Nikolajs liga", competitionName: "Superligaen", leagueId: "L1",
    });

    expect(res.group.id).toBe("g1");
    expect(res.matchCount).toBe(1);
    // Den ufravigelige regel: onboarding efterlader aldrig en liga-løs konkurrence.
    const compRow = db.insert.mock.calls.find((c) => c[1] === "competitions")[2][0];
    expect(compRow.group_id).toBe("g1");
  });

  it("skriver ligaen (med admin-rækken) FØR deltager-rækken (ellers kolliderer A8-triggeren)", async () => {
    setup({ matches: [] });

    await createStarterLeague("token", "u1", { groupName: "X", competitionName: "Y", leagueId: "L1" });

    // `create_group()` skriver admin-rækken inde i sig selv, så dens plads i
    // rækkefølgen ER admin-rækkens plads. Sker den efter deltager-rækken, når
    // A8-triggeren at lave en `member`-række først, og admin-insertet kolliderer
    // med den — nu inde i en funktion, hvor hele oprettelsen så ruller tilbage.
    expect(calls.indexOf("create_group")).toBeLessThan(calls.indexOf("competition_participants"));
    expect(calls[0]).toBe("create_group");
  });

  it("en tom sæson giver matchCount 0 — ligaen står stadig", async () => {
    // Færdigspillet sæson: filterTippable giver et tomt sæt.
    setup({ matches: [{ id: "m1", round_key: "2026-05-01", home_score: 2, stage_name: null }] });
    const res = await createStarterLeague("token", "u1", { groupName: "X", competitionName: "Y", leagueId: "L1" });
    expect(res.matchCount).toBe(0);
    expect(res.competition.id).toBe("c1");
  });

  it("fejler konkurrencen, følger ligaen med fejlen — så brugeren kan sendes derhen", async () => {
    setup({ seasons: [] });

    await expect(createStarterLeague("token", "u1", { groupName: "X", competitionName: "Y", leagueId: "L1" }))
      .rejects.toMatchObject({ group: { id: "g1" } });
  });
});
