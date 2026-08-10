// Brugernavnets vej gennem en bekræftelses-mail (B26).
//
// Testene her vogter et hul, der IKKE findes i dag, og som opstår i det sekund
// nogen slår "Confirm email" til i Supabase: signup svarer da uden session, og
// den `profiles`-række, App.jsx plejede at skrive med det samme, kan ikke
// skrives. Uden `sikrProfil` ville brugeren komme tilbage fra mailen, logge
// ind, og være navnløs i hver eneste stilling — uden en skærm at vælge navn på.
//
// Hullet kan ikke ses i produktionen, før knappen trykkes, og det er netop
// derfor det skal stå her: det er den slags, der ellers først opdages af den
// første rigtige bruger efter en konfigurationsændring.
import { describe, it, expect, vi, afterEach } from "vitest";
import { navneforslag, sikrProfil } from "./profile.js";

const ORIGINAL = globalThis.fetch;
afterEach(() => { globalThis.fetch = ORIGINAL; vi.restoreAllMocks(); });

// PostgREST-svar i den rækkefølge, de bliver bedt om. `rows` giver 200 med en
// krop; `konflikt` giver den 409, unique-indekset på lower(display_name)
// svarer med, når to brugere vil hedde det samme.
function stub(...svar) {
  const kald = [];
  globalThis.fetch = vi.fn(async (url, opts) => {
    kald.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
    const næste = svar.shift();
    if (næste?.konflikt) {
      return {
        ok: false, status: 409, statusText: "Conflict",
        headers: { get: () => null },
        json: async () => ({ message: "duplicate key value violates unique constraint" }),
      };
    }
    return {
      ok: true, status: 200, statusText: "OK",
      headers: { get: () => null },
      text: async () => JSON.stringify(næste?.rows ?? []),
    };
  });
  return kald;
}

const bruger = (navn) => ({ id: "u1", user_metadata: navn ? { display_name: navn } : {} });

describe("navneforslag", () => {
  it("foreslår det ønskede navn først", () => {
    expect(navneforslag("Anna")[0]).toBe("Anna");
  });

  // Navnet var ledigt, da mailen blev sendt. Ligger den ulæst et døgn, kan en
  // anden nå at tage det — og kontoen skal stadig kunne bruges bagefter.
  it("giver nummererede alternativer, når navnet er taget", () => {
    expect(navneforslag("Anna")).toEqual(["Anna", "Anna2", "Anna3", "Anna4", "Anna5"]);
  });

  // `profiles_display_name_len` håndhæver 2–20 tegn. Et suffiks, der skubber
  // navnet over grænsen, ville få databasen til at afvise ALLE fem forslag —
  // altså præcis den blindgyde, forslagene findes for at undgå.
  it("holder sig inden for de 20 tegn, databasen tillader", () => {
    const langt = "abcdefghijklmnopqrst"; // 20 tegn
    for (const navn of navneforslag(langt)) expect(navn.length).toBeLessThanOrEqual(20);
    expect(navneforslag(langt)[1]).toBe("abcdefghijklmnopqrs2");
  });

  it("trimmer og afkorter det ønskede navn, før der tælles", () => {
    expect(navneforslag("  Anna  ")[0]).toBe("Anna");
    expect(navneforslag("abcdefghijklmnopqrstuvwxyz")[0]).toBe("abcdefghijklmnopqrst");
  });

  it("foreslår intet, når der intet er ønsket", () => {
    expect(navneforslag("")).toEqual([]);
    expect(navneforslag(undefined)).toEqual([]);
  });
});

describe("sikrProfil", () => {
  // Det almindelige tilfælde efter denne ændring: hver eneste app-opstart.
  // Findes rækken, må funktionen ikke skrive — et login må aldrig kunne
  // overskrive et navn med den metadata, oprettelsen efterlod for et år siden.
  it("rører ikke en profil, der allerede findes", async () => {
    const kald = stub({ rows: [{ id: "u1", display_name: "Anna" }] });
    expect(await sikrProfil("tok", bruger("Noget Andet"))).toMatchObject({ display_name: "Anna" });
    expect(kald).toHaveLength(1);
    expect(kald[0].url).toContain("/rest/v1/profiles?id=eq.u1");
  });

  // Selve `B26`-tilfældet: kontoen blev oprettet, mailen bekræftet, og først
  // NU findes der en token, rækken kan skrives med.
  it("skriver rækken af det navn, oprettelsen gemte som metadata", async () => {
    const kald = stub({ rows: [] }, { rows: [{ id: "u1", display_name: "Anna" }] });
    expect(await sikrProfil("tok", bruger("Anna"))).toMatchObject({ display_name: "Anna" });
    expect(kald).toHaveLength(2);
    expect(kald[1].body).toEqual([{ id: "u1", display_name: "Anna" }]);
  });

  it("prøver det næste forslag, når navnet blev taget imens", async () => {
    const kald = stub({ rows: [] }, { konflikt: true }, { rows: [{ id: "u1", display_name: "Anna2" }] });
    expect(await sikrProfil("tok", bruger("Anna"))).toMatchObject({ display_name: "Anna2" });
    expect(kald[1].body).toEqual([{ id: "u1", display_name: "Anna" }]);
    expect(kald[2].body).toEqual([{ id: "u1", display_name: "Anna2" }]);
  });

  // En konto oprettet FØR denne ændring har ingen metadata. Den må ikke få et
  // gættet navn, og den må slet ikke vælte opstarten — den skal bare svare
  // null, præcis som opslaget gjorde før.
  it("gætter ikke et navn, når oprettelsen ikke gemte et", async () => {
    const kald = stub({ rows: [] });
    expect(await sikrProfil("tok", bruger(null))).toBeNull();
    expect(kald).toHaveLength(1);
  });

  // Fem konflikter i træk er urealistisk, men grænsen skal være der: uden den
  // ville en vedvarende fejl (offline, RLS) blive til en uendelig løkke inde i
  // app-opstarten.
  it("giver op efter fem forsøg frem for at prøve i det uendelige", async () => {
    const kald = stub({ rows: [] }, ...Array.from({ length: 5 }, () => ({ konflikt: true })));
    expect(await sikrProfil("tok", bruger("Anna"))).toBeNull();
    expect(kald).toHaveLength(6); // ét opslag + fem forsøg
  });
});
