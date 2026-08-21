import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase.js", () => ({ db: { select: vi.fn(), insert: vi.fn() }, restFetch: vi.fn() }));
import { db, restFetch } from "./supabase.js";
import { deriveOnboarding, loadHasPrediction, defaultLeagueName, validateGroupName, createStarterLeague, loadStarterTournaments } from "./onboarding.js";

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

// ---------------------------------------------------------------------------
// `G147` — guidens turneringsliste og det tavse rækkeloft.
//
// `loadStarterTournaments` afgjorde, om en turnering har kampe tilbage at
// tippe, ved at hente ÉN RÆKKE PR. USPILLET KAMP og bygge et `Set`. PostgREST
// klipper hvert svar ved projektets `db-max-rows` og siger det ikke (`G145`,
// `data/paged.js`), så en turnering, hvis kampe faldt uden for de første 1000,
// blev præsenteret som en, man ikke kan tippe. Skaden er `G106`s "· 0 kampe"
// en gang til — men i ONBOARDING, altså den skærm, hvor en fejl koster mest.
//
// Attrappen nedenfor er den samme som i `data/standings.test.js`: den klipper
// TAVST ved loftet, for uden det træk ser kur og fejl ens ud på fem rækker.
// ---------------------------------------------------------------------------
const LOFT = 1000;
function felter(query) {
  return Object.fromEntries(query.split("&").filter(Boolean).map((d) => [d.slice(0, d.indexOf("=")), d.slice(d.indexOf("=") + 1)]));
}
function passer(række, kolonne, udtryk) {
  const v = række[kolonne];
  if (udtryk.startsWith("eq.")) return String(v) === udtryk.slice(3);
  if (udtryk.startsWith("in.(")) return udtryk.slice(4, -1).split(",").includes(String(v));
  if (udtryk === "is.null") return v === null || v === undefined;
  if (udtryk === "not.is.null") return v !== null && v !== undefined;
  throw new Error(`attrappen kender ikke filteret "${kolonne}=${udtryk}"`);
}
function sortér(rows, order) {
  if (!order) return rows;
  const nøgler = order.split(",").map((d) => {
    const [kolonne, retning = "asc"] = d.split(".");
    return { kolonne, tegn: retning === "desc" ? -1 : 1 };
  });
  return [...rows].sort((a, b) => {
    for (const { kolonne, tegn } of nøgler) {
      const x = a[kolonne], y = b[kolonne];
      if (x === y) continue;
      return tegn * (x < y ? -1 : 1);
    }
    return 0;
  });
}
// `kald` samler hver forespørgsel, så påstandene om fan-out og form kan stilles.
function installér(tabeller, kald = []) {
  db.select.mockImplementation(async (_t, tabel, query) => {
    kald.push({ tabel, query });
    const rå = tabeller[tabel];
    if (!rå) throw new Error(`attrappen kender ikke tabellen "${tabel}"`);
    const f = felter(query);
    let rows = rå;
    for (const [kolonne, udtryk] of Object.entries(f)) {
      if (["select", "order", "limit", "offset"].includes(kolonne)) continue;
      rows = rows.filter((r) => passer(r, kolonne, udtryk));
    }
    rows = sortér(rows, f.order);
    const fra = Number(f.offset || 0);
    // Loftet ligger PÅ SVARET og ikke på forespørgslen: et bevidst `limit=1`
    // svarer med én række, mens et opslag uden loft svarer med 1000 og tier om,
    // at der var mere. Præcis som Supabase.
    const antal = Math.min(Number(f.limit || LOFT), LOFT);
    return rows.slice(fra, fra + antal).map((r) => ({ ...r }));
  });
  return kald;
}

describe("loadStarterTournaments (G147)", () => {
  const LIGAER = [{ id: "L1", name: "Superligaen" }, { id: "L2", name: "Premier League" }];

  it("vælger den nyeste sæson pr. turnering og siger, om der er kampe tilbage", async () => {
    installér({
      seasons: [
        { id: "s1-gammel", league_id: "L1", start_date: "2025-07-01" },
        { id: "s1", league_id: "L1", start_date: "2026-07-01" },
        { id: "s2", league_id: "L2", start_date: "2026-08-01" },
      ],
      // L1's nyeste sæson har en kamp uden resultat; L2's er spillet færdig.
      matches: [
        { id: "m1", season_id: "s1", home_score: null },
        { id: "m2", season_id: "s2", home_score: 2 },
        { id: "m3", season_id: "s1-gammel", home_score: null },
      ],
    });

    expect(await loadStarterTournaments("token", LIGAER)).toEqual([
      { id: "L1", name: "Superligaen", seasonId: "s1", hasUpcoming: true },
      { id: "L2", name: "Premier League", seasonId: "s2", hasUpcoming: false },
    ]);
  });

  it("spørger én gang pr. turnering, og hvert spørgsmål er afgrænset", async () => {
    // Fan-out'en skal være BUNDET af antallet af turneringer — det samme loft,
    // som sæson-opslaget lige over allerede er bundet af. Vokser den med noget
    // andet, er kuren værre end sygdommen.
    const kald = installér({
      seasons: [{ id: "s1", league_id: "L1", start_date: "2026-07-01" }, { id: "s2", league_id: "L2", start_date: "2026-08-01" }],
      matches: [],
    });

    await loadStarterTournaments("token", LIGAER);

    const kampkald = kald.filter((k) => k.tabel === "matches");
    expect(kampkald).toHaveLength(2);
    for (const k of kampkald) expect(k.query).toMatch(/season_id=eq\.s[12]&home_score=is\.null&select=id&limit=1$/);
  });

  it("🔴 en turnering med kampe bag loftet er stadig tipbar", async () => {
    // 1.900 uspillede kampe — en sæsonstart med fem officielle turneringer er i
    // den størrelsesorden. `s2`'s kampe ligger ALLE efter de første 1000.
    const kampe = [
      ...Array.from({ length: 1400 }, (_, i) => ({ id: `a${String(i).padStart(4, "0")}`, season_id: "s1", home_score: null })),
      ...Array.from({ length: 500 }, (_, i) => ({ id: `b${String(i).padStart(4, "0")}`, season_id: "s2", home_score: null })),
    ];
    installér({
      seasons: [{ id: "s1", league_id: "L1", start_date: "2026-07-01" }, { id: "s2", league_id: "L2", start_date: "2026-08-01" }],
      matches: kampe,
    });

    const liste = await loadStarterTournaments("token", LIGAER);
    expect(liste.map((t) => t.hasUpcoming)).toEqual([true, true]);
  });

  it("modprøve: ét uafgrænset opslag ville have sagt, at L2 ikke kan tippes", async () => {
    // Den gamle vej, skrevet ud: ét kald, én række pr. uspillet kamp, et `Set`.
    // Svaret klippes ved loftet, og `s2` når aldrig med — uden en fejl noget
    // sted. Påstanden er modstykket til den ovenfor og findes, fordi en kur,
    // hvis fejl man ikke kan fremkalde, ikke er efterprøvet.
    const kampe = [
      ...Array.from({ length: 1400 }, (_, i) => ({ id: `a${i}`, season_id: "s1", home_score: null })),
      ...Array.from({ length: 500 }, (_, i) => ({ id: `b${i}`, season_id: "s2", home_score: null })),
    ];
    installér({ matches: kampe });
    const rows = await db.select("token", "matches", "season_id=in.(s1,s2)&home_score=is.null&select=season_id");
    const medKampe = new Set(rows.map((r) => r.season_id));
    expect(rows).toHaveLength(LOFT);
    expect(medKampe.has("s2")).toBe(false);
  });

  it("🔴 en turnering, hvis nyeste sæson ligger bag loftet, forsvinder ikke fra guiden", async () => {
    // Sæsonerne vokser med turneringer GANGE år. `L3`s eneste sæson er den
    // ældste af alle og lander derfor sidst i `start_date.desc` — altså uden
    // for det første svar. Uden sidevis læsning ville turneringen slet ikke
    // kunne vælges i guiden.
    const seasons = [
      ...Array.from({ length: 1100 }, (_, i) => ({ id: `s${String(i).padStart(4, "0")}`, league_id: i % 2 ? "L1" : "L2", start_date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}` })),
      { id: "sL3", league_id: "L3", start_date: "1990-01-01" },
    ];
    installér({ seasons, matches: [{ id: "m1", season_id: "sL3", home_score: null }] });

    const liste = await loadStarterTournaments("token", [...LIGAER, { id: "L3", name: "Serie A" }]);
    expect(liste.map((t) => t.id)).toEqual(["L1", "L2", "L3"]);
    expect(liste.find((t) => t.id === "L3")).toEqual({ id: "L3", name: "Serie A", seasonId: "sL3", hasUpcoming: true });
  });

  it("ingen turneringer ind giver ingen opslag ud", async () => {
    const kald = installér({});
    expect(await loadStarterTournaments("token", [])).toEqual([]);
    expect(await loadStarterTournaments("token", null)).toEqual([]);
    expect(kald).toHaveLength(0);
  });

  it("en turnering uden sæson tages ud af listen", async () => {
    installér({ seasons: [{ id: "s1", league_id: "L1", start_date: "2026-07-01" }], matches: [] });
    const liste = await loadStarterTournaments("token", LIGAER);
    expect(liste.map((t) => t.id)).toEqual(["L1"]);
  });
});

describe("createStarterLeague", () => {
  // BEGGE skrivninger er RPC'er nu: ligaen skrives af `create_group()` (`G95`),
  // og konkurrencen — med deltagerrække og kampe — af `create_competition()`
  // (`G133`). Attrappen svarer derfor på de to RPC'er, og `db.insert` optræder
  // slet ikke længere i flowet. Det er ikke en svækkelse af testene nedenfor:
  // den rækkefølge, de vogter, er den mellem LIGAEN og deltager-rækken, og
  // deltager-rækken bor nu inde i `create_competition()`-kaldet, så dets plads
  // i rækkefølgen ER dens.
  //
  // `calls` samler kaldene i den rækkefølge, de sker, så påstanden om
  // rækkefølge kan stilles.
  let calls;
  function setup({ seasons = [{ id: "S1" }], matches = [{ id: "m1", round_key: "2026-08-11", home_score: null, stage_name: null }] } = {}) {
    calls = [];
    db.select.mockImplementation(async (token, table) => (table === "seasons" ? seasons : matches));
    restFetch.mockImplementation(async (path, opts) => {
      if (path.endsWith("/rpc/create_group")) {
        calls.push("create_group");
        return { id: "g1", name: opts.body.p_name, invite_code: "abc12345" };
      }
      if (path.endsWith("/rpc/create_competition")) {
        calls.push("create_competition");
        return { id: "c1", name: opts.body.p_name, group_id: opts.body.p_group_id };
      }
      return undefined; // logEvent m.fl.
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
    const compKald = restFetch.mock.calls.find((c) => String(c[0]).endsWith("/rpc/create_competition"));
    expect(compKald[1].body.p_group_id).toBe("g1");
  });

  it("skriver ligaen (med admin-rækken) FØR deltager-rækken (ellers kolliderer A8-triggeren)", async () => {
    setup({ matches: [] });

    await createStarterLeague("token", "u1", { groupName: "X", competitionName: "Y", leagueId: "L1" });

    // `create_group()` skriver admin-rækken inde i sig selv, og
    // `create_competition()` skriver deltager-rækken inde i sig selv (G133) —
    // de to kalds rækkefølge ER rækkernes. Kommer deltager-rækken først, når
    // A8-triggeren at lave en `member`-række, og admin-insertet kolliderer med
    // den — inde i en funktion, hvor hele oprettelsen så ruller tilbage.
    expect(calls.indexOf("create_group")).toBeLessThan(calls.indexOf("create_competition"));
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
