import { describe, it, expect } from "vitest";
import {
  PRIVATLIV, VILKAAR, DOKUMENTER, findDokument,
  LEGAL_OPDATERET, MINDSTEALDER, DATAANSVARLIG, KONTAKT_EMAIL,
} from "./legal.js";

const alle = [PRIVATLIV, VILKAAR];

// Alle strenge i et dokument, fladet ud. Bruges af emnetjekket nedenfor.
function tekstAf(doc) {
  return doc.afsnit
    .flatMap((a) => [a.titel, ...a.tekst.flatMap((t) => (typeof t === "string" ? [t] : t.punkter))])
    .join("\n");
}

describe("strukturen", () => {
  it.each(alle.map((d) => [d.id, d]))("%s har titel, id og afsnit", (_id, doc) => {
    expect(doc.titel).toBeTruthy();
    expect(doc.id).toBeTruthy();
    expect(doc.afsnit.length).toBeGreaterThanOrEqual(5);
  });

  // Et tomt afsnit ville rendre som en overskrift uden indhold — det ligner en
  // fejl i visningen, ikke en manglende sætning.
  it.each(alle.map((d) => [d.id, d]))("%s har ikke-tomme afsnit hele vejen", (_id, doc) => {
    for (const a of doc.afsnit) {
      expect(a.titel.trim().length).toBeGreaterThan(0);
      expect(a.tekst.length).toBeGreaterThan(0);
      for (const t of a.tekst) {
        if (typeof t === "string") {
          expect(t.trim().length).toBeGreaterThan(0);
        } else {
          expect(t.punkter.length).toBeGreaterThan(0);
          for (const p of t.punkter) expect(p.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("har kun de to former for tekst, komponenten kan tegne", () => {
    for (const doc of alle) {
      for (const a of doc.afsnit) {
        for (const t of a.tekst) {
          const gyldig = typeof t === "string" || Array.isArray(t?.punkter);
          expect(gyldig).toBe(true);
        }
      }
    }
  });
});

describe("indholdet dækker det, appen faktisk gør", () => {
  // Emnetjekket er den eneste mekaniske forbindelse mellem teksten og
  // virkeligheden. Det kan ikke bevise, at politikken er FULDSTÆNDIG — men det
  // fanger den hyppigste form for forfald: at et helt emne bliver væk under en
  // omskrivning. Vedligeholdelsesreglen står i legal.js og DOCUMENTATION.md §24.
  const skalNævnes = [
    "Supabase", "Vercel", "GitHub", "Irland", "Dublin",
    "Sportmonks", "football-data.org",
    "cookies", "Datatilsynet", "sikkerhedskopi", "push",
    "brugernavn", "rating", "feedback",
  ];

  it.each(skalNævnes)("privatlivspolitikken nævner %s", (ord) => {
    expect(tekstAf(PRIVATLIV)).toContain(ord);
  });

  // Den vigtigste enkeltsætning: der ER ingen cookies, og fraværet skal siges
  // frem for bare at være sandt. Ellers antager en læser det modsatte.
  it("siger eksplicit, at der ikke bruges cookies", () => {
    expect(tekstAf(PRIVATLIV)).toContain("Ingen cookies");
  });

  // Fonten blev selv-hostet netop for at kunne skrive denne sætning. Ruller
  // nogen @import tilbage, står politikken og lyver — theme.test.js fanger
  // koden, denne fanger påstanden.
  it("lover, at intet indhold hentes fra andres servere under brug", () => {
    expect(tekstAf(PRIVATLIV)).toContain("hentet fra andres servere");
  });

  it("nævner aldersgrænsen i begge dokumenter", () => {
    for (const doc of alle) expect(tekstAf(doc)).toContain(`${MINDSTEALDER} år`);
  });

  it("siger i vilkårene, at et døgns data kan gå tabt", () => {
    expect(tekstAf(VILKAAR)).toContain("et døgns data");
  });
});

describe("pladsholderne", () => {
  // Teksten må ikke gå live med [NAVN] i. Testen kan ikke fange det, når
  // pladsholderen ÉR udfyldt — den fastholder kun, at de to står ét sted og
  // ikke drysser rundt i dokumentet. Det egentlige værn er tjeklisten i
  // docs/features/privatliv-og-vilkaar-v1.md.
  it("står kun i kontakt- og rettigheds-afsnittene", () => {
    const medPladsholder = PRIVATLIV.afsnit.filter((a) =>
      JSON.stringify(a).includes(DATAANSVARLIG) || JSON.stringify(a).includes(KONTAKT_EMAIL)
    );
    expect(medPladsholder.map((a) => a.titel)).toEqual(["Hvem står bag", "Dine rettigheder"]);
  });

  it("optræder slet ikke i vilkårene", () => {
    const t = tekstAf(VILKAAR);
    expect(t).not.toContain(DATAANSVARLIG);
    expect(t).not.toContain(KONTAKT_EMAIL);
  });
});

describe("formalia", () => {
  it("har én opdateringsdato på ISO-form for begge dokumenter", () => {
    expect(LEGAL_OPDATERET).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const doc of alle) expect(tekstAf(doc)).toContain(LEGAL_OPDATERET);
  });

  it("bruger ingen usikre links", () => {
    for (const doc of alle) expect(tekstAf(doc)).not.toContain("http://");
  });

  it("slår begge dokumenter op og giver null for et ukendt id", () => {
    expect(findDokument("privatliv")).toBe(PRIVATLIV);
    expect(findDokument("vilkaar")).toBe(VILKAAR);
    expect(findDokument("noget-andet")).toBeNull();
    expect(Object.keys(DOKUMENTER)).toEqual(["privatliv", "vilkaar"]);
  });
});
