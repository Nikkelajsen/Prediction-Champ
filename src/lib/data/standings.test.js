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
// ---------------------------------------------------------------------------
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

function installér({ ratings, profiles }) {
  const tabeller = { ratings, profiles, rating_history: [] };
  const filtrér = (tabel, query) => {
    const f = parseFiltre(query);
    let rows = tabeller[tabel];
    if (!rows) throw new Error(`attrappen kender ikke tabellen "${tabel}"`);
    for (const [kolonne, udtryk] of Object.entries(f)) {
      if (kolonne === "select" || kolonne === "order" || kolonne === "limit") continue;
      rows = rows.filter((r) => passer(r, kolonne, udtryk));
    }
    if (f.order === "rating.desc,user_id.asc") {
      rows = [...rows].sort((a, b) => Number(b.rating) - Number(a.rating) || (a.user_id < b.user_id ? -1 : 1));
    }
    return rows;
  };
  db.select.mockImplementation(async (_t, tabel, query) => filtrér(tabel, query).map((r) => ({ ...r })));
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
