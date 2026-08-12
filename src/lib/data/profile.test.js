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
import { navneforslag, sikrProfil, changeDisplayName } from "./profile.js";

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
      // `?? []` og ikke `?? null`: en tabel-læsning svarer med en liste. En
      // `returns jsonb`-funktion svarer med sin værdi, og `null` er et gyldigt
      // svar dér — derfor sendes `rows: null` uændret igennem.
      text: async () => JSON.stringify(næste?.rows === undefined ? [] : næste.rows),
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
  // 🔴 **Opslaget er ikke længere et tabelopslag** (A43). `authenticated` må
  // siden `#60` læse tre kolonner i `profiles`, og `is_admin` er ikke en af
  // dem — så egen række hentes gennem `my_profile()`, som er `security
  // definer`. Stubben svarer derfor med et OBJEKT og ikke med en liste; det er
  // formen, PostgREST giver en `returns jsonb`-funktion.
  const egen = (row) => ({ rows: row });

  // Det almindelige tilfælde efter denne ændring: hver eneste app-opstart.
  // Findes rækken, må funktionen ikke skrive — et login må aldrig kunne
  // overskrive et navn med den metadata, oprettelsen efterlod for et år siden.
  it("rører ikke en profil, der allerede findes", async () => {
    const kald = stub(egen({ id: "u1", display_name: "Anna", is_admin: true }));
    expect(await sikrProfil("tok", bruger("Noget Andet"))).toMatchObject({ display_name: "Anna" });
    expect(kald).toHaveLength(1);
    expect(kald[0].url).toContain("/rest/v1/rpc/my_profile");
  });

  // `is_admin` følger med, og det er hele grunden til, at funktionen findes:
  // `MainApp.jsx` afgør admin-fanen på feltet, og et smalt `select=` ville
  // slukke fanen for administratoren selv.
  it("giver hele ens egen række tilbage, is_admin inklusive", async () => {
    stub(egen({ id: "u1", display_name: "Anna", is_admin: true }));
    expect(await sikrProfil("tok", bruger(null))).toMatchObject({ is_admin: true });
  });

  // Selve `B26`-tilfældet: kontoen blev oprettet, mailen bekræftet, og først
  // NU findes der en token, rækken kan skrives med.
  //
  // Tre kald og ikke to (A43): opslag, skrivning, og et opslag mere. Det
  // sidste er ikke spild — skrivningens eget svar må kun bede om `id`, fordi
  // `return=representation` er en `returning`-klausul, og den kræver
  // læse-privilegiet på hver kolonne, den giver tilbage.
  it("skriver rækken af det navn, oprettelsen gemte som metadata", async () => {
    const kald = stub(egen(null), { rows: [{ id: "u1" }] }, egen({ id: "u1", display_name: "Anna" }));
    expect(await sikrProfil("tok", bruger("Anna"))).toMatchObject({ display_name: "Anna" });
    expect(kald).toHaveLength(3);
    expect(kald[1].body).toEqual([{ id: "u1", display_name: "Anna" }]);
    // Præcis den linje, der ellers ville fejle med 42501 i produktionen.
    expect(kald[1].url).toContain("select=id");
    expect(kald[2].url).toContain("/rest/v1/rpc/my_profile");
  });

  it("prøver det næste forslag, når navnet blev taget imens", async () => {
    const kald = stub(egen(null), { konflikt: true }, { rows: [{ id: "u1" }] }, egen({ id: "u1", display_name: "Anna2" }));
    expect(await sikrProfil("tok", bruger("Anna"))).toMatchObject({ display_name: "Anna2" });
    expect(kald[1].body).toEqual([{ id: "u1", display_name: "Anna" }]);
    expect(kald[2].body).toEqual([{ id: "u1", display_name: "Anna2" }]);
  });

  // En konto oprettet FØR denne ændring har ingen metadata. Den må ikke få et
  // gættet navn, og den må slet ikke vælte opstarten — den skal bare svare
  // null, præcis som opslaget gjorde før.
  it("gætter ikke et navn, når oprettelsen ikke gemte et", async () => {
    const kald = stub(egen(null));
    expect(await sikrProfil("tok", bruger(null))).toBeNull();
    expect(kald).toHaveLength(1);
  });

  // Fem konflikter i træk er urealistisk, men grænsen skal være der: uden den
  // ville en vedvarende fejl (offline, RLS) blive til en uendelig løkke inde i
  // app-opstarten.
  it("giver op efter fem forsøg frem for at prøve i det uendelige", async () => {
    const kald = stub(egen(null), ...Array.from({ length: 5 }, () => ({ konflikt: true })));
    expect(await sikrProfil("tok", bruger("Anna"))).toBeNull();
    expect(kald).toHaveLength(6); // ét opslag + fem forsøg
  });
});

// Skift af brugernavn (B29). `sikrProfil` ovenfor er grunden til, at den findes:
// et navn, der blev til `Anna2`, mens bekræftelses-mailen lå ulæst, skal kunne
// rettes bagefter.
describe("changeDisplayName", () => {
  // `username_available` svarer `true`/`false` som en bar JSON-værdi, ikke en
  // række — derfor `rows` og ikke `{rows: [...]}` i stubben nedenfor.
  const ledigt = { rows: true };
  const taget = { rows: false };

  it("skriver kun display_name, og kun på egen række", async () => {
    const kald = stub(ledigt, { rows: [{ id: "u1", display_name: "Annabel" }] });
    expect(await changeDisplayName("tok", "u1", "Annabel")).toMatchObject({ display_name: "Annabel" });
    expect(kald[0].url).toContain("/rest/v1/rpc/username_available");
    expect(kald[1].url).toContain("/rest/v1/profiles?id=eq.u1");
    // Præcis ét felt. Siden `sql/username_change.sql` har `authenticated` kun
    // UPDATE på `id` og `display_name`, og et felt mere ville blive afvist af
    // databasen frem for stille ignoreret.
    expect(kald[1].body).toEqual({ display_name: "Annabel" });
  });

  it("trimmer navnet, før det sendes", async () => {
    const kald = stub(ledigt, { rows: [{ id: "u1", display_name: "Annabel" }] });
    await changeDisplayName("tok", "u1", "  Annabel  ");
    expect(kald[0].body).toEqual({ name: "Annabel" });
    expect(kald[1].body).toEqual({ display_name: "Annabel" });
  });

  // Længden tjekkes FØR nettet: databasens svar er `23514` og en engelsk
  // constraint-tekst, og en bruger, der lige har tastet ét bogstav, skal ikke
  // vente på et rundturskald for at få det at vide.
  it("afviser for korte og for lange navne uden at kalde serveren", async () => {
    const kald = stub();
    await expect(changeDisplayName("tok", "u1", "A")).rejects.toThrow("2–20 tegn");
    await expect(changeDisplayName("tok", "u1", "a".repeat(21))).rejects.toThrow("2–20 tegn");
    expect(kald).toHaveLength(0);
  });

  it("siger til, når navnet er taget — uden at skrive", async () => {
    const kald = stub(taget);
    await expect(changeDisplayName("tok", "u1", "Bo")).rejects.toThrow("allerede taget");
    expect(kald).toHaveLength(1);
  });

  // Opslaget er en høflighed, ikke en garanti: mellem "ledigt" og skrivningen
  // kan en anden nå navnet. Unikhedsindekset er det, der faktisk holder, og dets
  // 409 skal kunne læses af et menneske.
  it("oversætter unikhedsfejlen, når navnet blev taget imellem de to kald", async () => {
    stub(ledigt, { konflikt: true });
    await expect(changeDisplayName("tok", "u1", "Bo")).rejects.toThrow("taget af en anden");
  });

  // Nul rækker tilbage betyder, at RLS ikke fandt rækken. Uden dette led ville
  // en fejl i policyen se ud som en succes, og navnet ville skifte i
  // brugerfladen og ikke i basen.
  it("regner et tomt svar som en fejl og ikke som en succes", async () => {
    stub(ledigt, { rows: [] });
    await expect(changeDisplayName("tok", "u1", "Annabel")).rejects.toThrow("Kunne ikke skifte");
  });
});
