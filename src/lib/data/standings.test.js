import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../supabase.js", () => ({
  db: { select: vi.fn(), count: vi.fn() },
}));
import { db } from "../supabase.js";
import { loadRatingBoard, loadRatingSnapshot, loadRatingMap, loadRatingHistory } from "./standings.js";

// `G139`: Hjem hentede HELE den globale ratingtabel — hver brugers rating og
// hvert profilnavn — for at vise fire tal i ét kort. Kaldet voksede med
// brugerbasen og ramte to lofter: `A34`s egress-budget og PostgREST' tavse
// grænse på 1000 rækker, hvor svaret bare bliver kortere.
//
// HVORFOR DENNE FIL ER EN ÆKVIVALENSTEST OG IKKE EN LISTE AF PÅSTANDE.
// Rettelsen flytter en udregning fra klienten til databasen, og en sådan
// flytning har præcis én farlig fejlmåde: et tal, der er *næsten* rigtigt.
// Hjem linker til ranglisten, så "nr. 4 af 25" på kortet og "4." på listen skal
// være det samme tal — ellers lyver den ene om den anden, uden at nogen af dem
// ser forkerte ud hver for sig. Derfor drives BEGGE veje af den samme fixture,
// og påstanden er, at de svarer ens.
//
// De to fælder, fixturen er bygget for:
//   1. **Delt placering afgøres på den VISTE (afrundede) rating.** To brugere på
//      1500,4 og 1500,0 viser begge 1500 og deler placering. En optælling med
//      `rating=gt.<min rå rating>` ville sige, at naboen er foran mig.
//   2. **Lukkede konti tæller ikke.** De filtreres fra de globale lister i
//      klienten, så en optælling i databasen ser en række, ranglisten ikke viser.

// ---------------------------------------------------------------------------
// En attrap-PostgREST, der kan så meget af filtersproget, som kaldene bruger.
// Den er med vilje dum: den kender `eq.`, `in.(…)`, `gte.` og `not.is.null` og
// intet andet, så et kald, der begynder at bruge noget femte, fejler synligt
// frem for at få et forkert svar.
//
// **Den kan ét træk mere siden `G145`: det tavse rækkeloft.** Et `db.select`
// svarer aldrig med mere end `LOFT` rækker og siger ikke, at der var mere —
// præcis som Supabase. `db.count` tæller derimod hele mængden, som
// `Content-Range` gør. Uden det træk kunne fixturen ikke skelne en kur fra en
// fejl: begge dele ville se rigtige ud på fem rækker.
// ---------------------------------------------------------------------------
const LOFT = 1000;
function parseFiltre(query) {
  const ud = {};
  for (const del of query.split("&").filter(Boolean)) {
    const i = del.indexOf("=");
    ud[del.slice(0, i)] = del.slice(i + 1);
  }
  return ud;
}
const idListe = (v) => v.slice("in.(".length, -1).split(",");

function passer(række, kolonne, udtryk) {
  const v = række[kolonne];
  if (udtryk.startsWith("eq.")) return String(v) === udtryk.slice(3);
  if (udtryk.startsWith("in.(")) return idListe(udtryk).includes(String(v));
  if (udtryk.startsWith("gte.")) return Number(v) >= Number(udtryk.slice(4));
  if (udtryk === "not.is.null") return v !== null && v !== undefined;
  if (udtryk === "is.null") return v === null || v === undefined;
  throw new Error(`attrappen kender ikke filteret "${kolonne}=${udtryk}"`);
}

// `order=` som PostgREST forstår det: `kolonne.asc,kolonne.desc,…`. Sorteringen
// skal være TOTAL og ikke omtrentlig — sidevis læsning hviler på, at to
// forespørgsler ser den samme rækkefølge.
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
      const tal = Number(x), tal2 = Number(y);
      const forskel = Number.isFinite(tal) && Number.isFinite(tal2) ? tal - tal2 : (x < y ? -1 : 1);
      if (forskel) return tegn * (forskel < 0 ? -1 : 1);
    }
    return 0;
  });
}

function installér({ ratings, profiles, rating_history = [] }) {
  const tabeller = { ratings, profiles, rating_history };
  const filtrér = (tabel, query) => {
    const f = parseFiltre(query);
    let rows = tabeller[tabel];
    if (!rows) throw new Error(`attrappen kender ikke tabellen "${tabel}"`);
    for (const [kolonne, udtryk] of Object.entries(f)) {
      if (kolonne === "select" || kolonne === "order" || kolonne === "limit" || kolonne === "offset") continue;
      rows = rows.filter((r) => passer(r, kolonne, udtryk));
    }
    return sortér(rows, f.order);
  };
  // Loftet ligger her og ikke i `filtrér`, fordi det er en egenskab ved SVARET
  // og ikke ved forespørgslen: `db.count` ser hele mængden.
  db.select.mockImplementation(async (_t, tabel, query) => {
    const f = parseFiltre(query);
    const fra = Number(f.offset || 0);
    const antal = Math.min(Number(f.limit || LOFT), LOFT);
    return filtrér(tabel, query).slice(fra, fra + antal).map((r) => ({ ...r }));
  });
  db.count.mockImplementation(async (_t, tabel, query) => filtrér(tabel, query).length);
}

// Fixturen. `mig` og `nabo` viser begge 1500 og deler dermed placering; `lukket`
// står foran os begge, men er en lukket konto og tæller hverken i placeringen
// eller i antallet.
const RATINGS = [
  { user_id: "top", scope: "ALL", rating: 1620.0, rounds_played: 9, provisional: false },
  { user_id: "lukket", scope: "ALL", rating: 1580.0, rounds_played: 9, provisional: false },
  { user_id: "nabo", scope: "ALL", rating: 1500.4, rounds_played: 9, provisional: false },
  { user_id: "mig", scope: "ALL", rating: 1500.0, rounds_played: 7, provisional: true },
  { user_id: "bund", scope: "ALL", rating: 1400.0, rounds_played: 9, provisional: false },
];
const PROFILES = [
  { id: "top", display_name: "Top", anonymized_at: null },
  { id: "lukket", display_name: "Slettet a1b2c3d4", anonymized_at: "2026-08-01T00:00:00Z" },
  { id: "nabo", display_name: "Nabo", anonymized_at: null },
  { id: "mig", display_name: "Mig", anonymized_at: null },
  { id: "bund", display_name: "Bund", anonymized_at: null },
];

beforeEach(() => {
  db.select.mockReset();
  db.count.mockReset();
  installér({ ratings: RATINGS, profiles: PROFILES });
});

describe("loadRatingSnapshot (G139)", () => {
  // DEN BÆRENDE PÅSTAND. Ranglisten er facit, fordi det er den, brugeren
  // klikker sig videre til.
  it("giver præcis samme placering og antal som ranglisten", async () => {
    const board = await loadRatingBoard("t");
    const mig = board.find((r) => r.userId === "mig");
    const snap = await loadRatingSnapshot("t", "mig");

    expect(snap).toEqual({
      rating: mig.rating, rank: mig.rank, total: board.length, provisional: mig.provisional,
    });
    // Og at fixturen faktisk stiller de to fælder op: `nabo` viser samme tal og
    // deler 2. pladsen med mig, og `lukket` — som ellers stod foran os begge —
    // er hverken i placeringen eller i de fire rækker.
    expect(mig.rank).toBe(2);
    expect(board.length).toBe(4);
  });

  // Fælde 1 isoleret: naboen på 1500,4 viser 1500 ligesom mig og er IKKE foran.
  // Et `gt.<rå rating>` ville give 4. plads her.
  it("deler placering på den viste rating og ikke på den rå", async () => {
    const snap = await loadRatingSnapshot("t", "mig");
    const optælling = db.count.mock.calls.find(([, , q]) => q.includes("rating=gte."));
    expect(optælling[2]).toContain("rating=gte.1500.5");
    expect(snap.rank).toBe(2);
  });

  // Fælde 2 isoleret: uden fratrækket ville `lukket` give både en placering og
  // et antal mere, end ranglisten viser.
  it("tæller ikke lukkede konti med — hverken foran mig eller i alt", async () => {
    const uden = await loadRatingSnapshot("t", "mig");
    installér({ ratings: RATINGS, profiles: PROFILES.map((p) => ({ ...p, anonymized_at: null })) });
    const med = await loadRatingSnapshot("t", "mig");
    expect(med.rank).toBe(uden.rank + 1);
    expect(med.total).toBe(uden.total + 1);
  });

  // DEN NEGATIVE PÅSTAND, og den er hele rækkens anledning: kortet må ikke
  // hente ratingtabellen for at læse fire tal ud af den. Hvert `ratings`-opslag
  // skal være afgrænset til bestemte brugere; antallene kommer fra `db.count`.
  it("henter ikke ranglisten — hvert opslag er afgrænset, tallene tælles i databasen", async () => {
    await loadRatingSnapshot("t", "mig");
    const bredde = db.select.mock.calls
      .filter(([, tabel]) => tabel === "ratings")
      .filter(([, , q]) => !q.includes("user_id=eq.") && !q.includes("user_id=in.("));
    expect(bredde, `et uafgrænset ratings-opslag: ${JSON.stringify(bredde)}`).toHaveLength(0);
    expect(db.count).toHaveBeenCalledTimes(2);
  });

  // "Ikke på ranglisten endnu" er en gyldig tilstand og ikke en fejl — og den
  // må ikke koste optællingerne.
  it("svarer { none: true } uden en ratingrække, og tæller ikke bagefter", async () => {
    const snap = await loadRatingSnapshot("t", "ukendt");
    expect(snap).toEqual({ none: true });
    expect(db.count).not.toHaveBeenCalled();
  });
});

describe("loadRatingMap (G139)", () => {
  it("afgrænser til de brugere, der skal have et tal", async () => {
    const map = await loadRatingMap("t", ["mig", "nabo"]);
    expect([...map.keys()].sort()).toEqual(["mig", "nabo"]);
    expect(map.get("nabo").rating).toBe(1500); // afrundet som på listerne
  });

  // Uden en liste er kaldet ordret som før: Championship-fanen sender ingen,
  // fordi dens egne lister er globale.
  it("henter hele tabellen, når der ikke sendes en liste", async () => {
    const map = await loadRatingMap("t");
    expect(map.size).toBe(RATINGS.length);
  });

  // En tom liste må ikke blive til `in.()` — det er ugyldig syntaks og et 400.
  it("laver ingen forespørgsel for en tom liste", async () => {
    const map = await loadRatingMap("t", []);
    expect(map.size).toBe(0);
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe("loadRatingHistory (G139)", () => {
  it("afgrænser til én bruger, når der sendes et id", async () => {
    await loadRatingHistory("t", "mig");
    expect(db.select.mock.calls[0][2]).toContain("user_id=eq.mig");
  });

  it("henter alle brugere uden et id — Rating-fanen viser en formkurve pr. række", async () => {
    await loadRatingHistory("t");
    expect(db.select.mock.calls[0][2]).not.toContain("user_id=eq.");
  });
});

// ---------------------------------------------------------------------------
// `G145` — det tavse rækkeloft
//
// `G139` flyttede Hjems fire tal ned i databasen, men LISTERNE blev stående:
// ranglisten, ratingkortet og formkurven læste stadig hele tabeller i ét
// `db.select`. Loftet på 1000 rækker er tavst — svaret bliver bare kortere — så
// en app med tusind ratede brugere ville have vist en rangliste, der stopper
// midt i sig selv, en placering regnet på den afkortede liste og en formkurve
// af de FORKERTE runder, uden en fejl noget sted.
//
// Fixturen herunder er den samme som ovenfor, bare stor nok til at krydse
// loftet. Påstanden er den samme: Hjem og ranglisten skal sige det samme tal —
// nu også for en spiller, der står under nr. 1000.
// ---------------------------------------------------------------------------
const STORE_RATINGS = Array.from({ length: 2400 }, (_, i) => ({
  user_id: `u${String(i).padStart(4, "0")}`,
  scope: "ALL",
  rating: 3000 - i, // entydige, hele tal: placeringen er indeks + 1
  rounds_played: 9,
  provisional: false,
}));
const LUKKEDE_INDEKS = [100, 700, 1300];
const STORE_PROFILES = STORE_RATINGS.map((r, i) => ({
  id: r.user_id,
  display_name: `Spiller ${i}`,
  anonymized_at: LUKKEDE_INDEKS.includes(i) ? "2026-08-01T00:00:00Z" : null,
}));

describe("G145: lister længere end serverens loft", () => {
  beforeEach(() => { installér({ ratings: STORE_RATINGS, profiles: STORE_PROFILES }); });

  // Modprøven først, så det står fast, at fixturen faktisk stiller fælden op:
  // ét `db.select` på den samme attrap giver 1000 rækker og ingen fejl.
  it("modprøve: ét enkelt opslag ville have givet 1000 rækker og set rigtigt ud", async () => {
    const ét = await db.select("t", "ratings", "scope=eq.ALL&select=user_id&order=rating.desc,user_id.asc");
    expect(ét).toHaveLength(1000);
    expect(STORE_RATINGS.length).toBeGreaterThan(1000);
  });

  it("ranglisten bærer hver eneste spiller — også dem under nr. 1000", async () => {
    const board = await loadRatingBoard("t");
    expect(board).toHaveLength(STORE_RATINGS.length - LUKKEDE_INDEKS.length);
    expect(board[board.length - 1].userId).toBe("u2399");
    // Placeringerne lukker sig om de lukkede konti hele vejen ned.
    expect(board[board.length - 1].rank).toBe(board.length);
  });

  // DEN BÆRENDE PÅSTAND, nu hvor listen er for lang til ét svar: kortet på Hjem
  // og ranglisten skal give det samme for en spiller langt nede.
  it("Hjem og ranglisten giver samme placering og antal for en spiller under nr. 1000", async () => {
    const board = await loadRatingBoard("t");
    const mig = board.find((r) => r.userId === "u1500");
    const snap = await loadRatingSnapshot("t", "u1500");
    expect(snap.rank).toBeGreaterThan(1000); // fixturen krydser loftet
    expect(snap).toEqual({ rating: mig.rating, rank: mig.rank, total: board.length, provisional: mig.provisional });
  });

  // Lukkede konti trækkes fra i BEGGE ender af en liste, der er hentet sidevis.
  it("trækker de lukkede konti fra, uanset hvilken side de lå på", async () => {
    const board = await loadRatingBoard("t");
    expect(board.some((r) => LUKKEDE_INDEKS.map((i) => STORE_RATINGS[i].user_id).includes(r.userId))).toBe(false);
    const snap = await loadRatingSnapshot("t", "u2399");
    expect(snap.total).toBe(board.length);
  });

  it("ratingtallene ved navnene mangler ikke for de sidste brugere", async () => {
    const map = await loadRatingMap("t");
    expect(map.size).toBe(STORE_RATINGS.length);
    expect(map.get("u2399").rating).toBe(3000 - 2399);
  });

  // Formkurven er den nærmeste af alle: `rating_history` er én række pr. bruger
  // PR. RUNDE og sorteres stigende, så en afkortning ville ramme netop de
  // SENESTE runder — dem, prikkerne og bevægelsen er lavet af.
  it("formkurven er af de nyeste runder og ikke af dem, der lå først i tabellen", async () => {
    const historik = [];
    for (const runde of ["2026-07-07", "2026-07-14", "2026-07-21"]) {
      for (const r of STORE_RATINGS) {
        historik.push({ user_id: r.user_id, scope: "ALL", round_key: runde, delta: runde === "2026-07-21" ? 9 : -9 });
      }
    }
    installér({ ratings: STORE_RATINGS, profiles: STORE_PROFILES, rating_history: historik });
    const hist = await loadRatingHistory("t");
    expect(hist.size).toBe(STORE_RATINGS.length);
    // Sidste runde gav +9 til alle: bevægelsen skal være den, og den sidste
    // prik skal være grøn. Med ét afkortet svar ville de tre nyeste runder for
    // alle andre end de første ~333 brugere slet ikke være kommet med.
    const min = hist.get("u2399");
    expect(min.move).toBe(9);
    expect(min.form).toEqual([0, 0, 2]);
  });
});

// ---------------------------------------------------------------------------
// Den strukturelle vagt. Påstandene ovenfor holder de kald, der FINDES, men
// et nyt `db.select` i filen ville komme ind uden en test — og fejlen er tavs,
// så ingen ville opdage den. Reglen er derfor på filen og ikke på kaldet:
// enten er læsningen bevidst afgrænset (`limit=`), eller også går den gennem
// `selectAll`/`selectIn`, der selv holder styr på længden.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";

describe("G145: ingen ubegrænsede opslag i standings.js", () => {
  it("hvert db.select i filen er bevidst afgrænset med limit=", () => {
    const kilde = readFileSync(new URL("./standings.js", import.meta.url), "utf8");
    const kald = [...kilde.matchAll(/db\.select\(([^;]*?)\);/gs)].map((m) => m[1]);
    expect(kald.length).toBeGreaterThan(0); // regexen skal stadig finde noget
    for (const k of kald) {
      expect(k, `et db.select uden limit=: ${k.trim()}`).toContain("limit=");
    }
  });
});
