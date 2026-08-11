import { describe, it, expect } from "vitest";
import {
  PRIVATLIV, VILKAAR, DOKUMENTER, findDokument,
  LEGAL_OPDATERET, MINDSTEALDER, DATAANSVARLIG, KONTAKT_EMAIL,
} from "./legal.js";
import {
  LOKALE_NØGLER,
  SESSION_KEY, PING_KEY, FLOW_KEY, CARD_KEY, COMPLETE_KEY,
  PUSH_DISMISS_KEY, NUDGE_KEY, SEASON_LEAGUE_KEY, PWA_ONBOARDED_KEY, COMP_DONE_KEY,
  STORY_SEEN_KEY, PENDING_INVITE_KEY,
} from "./localFlags.js";

const alle = [PRIVATLIV, VILKAAR];

// Alle strenge i et dokument, fladet ud. Bruges af emnetjekket nedenfor.
function tekstAf(doc) {
  return doc.afsnit
    .flatMap((a) => [a.titel, ...a.tekst.flatMap((t) => (typeof t === "string" ? [t] : t.punkter))])
    .join("\n");
}

// Ét afsnit for sig. Forskellen på dette og `tekstAf` er hele pointen i
// nøgletjekket nedenfor: en sætning, der er flyttet til et andet afsnit,
// beskriver ikke længere det, der ligger på enheden.
function afsnitTekst(doc, titel) {
  const a = doc.afsnit.find((x) => x.titel === titel);
  if (!a) throw new Error(`Afsnittet "${titel}" findes ikke i ${doc.id}`);
  return a.tekst.flatMap((t) => (typeof t === "string" ? [t] : t.punkter)).join("\n");
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

// ---------------------------------------------------------------------------
// G71: hver localStorage-nøgle har en sætning i politikken — og omvendt.
//
// `G69` slap igennem præcis her: `pc_pwa_onboarded` blev ryddet af
// `clearAllLocalState()` og opremset i guard-testen i data/account.test.js,
// men manglede sin linje i politikken. To af nøglernes tre aftagere havde en
// test; den tredje — teksten til brugeren — havde ingen.
//
// DERFOR EN OVERSÆTTELSESTABEL OG IKKE ET NAVNE-MATCH. Politikken skal kunne
// læses af et menneske og nævner derfor ingen nøgler ved navn; den siger "om du
// har lukket kortet om notifikationer". Et naivt `toContain(nøglenavn)` kan
// aldrig komme til at virke, og den næste, der prøver, ville opgive. Prisen for
// tabellen er, at en ny nøgle kræver to linjer i stedet for én — og det er
// netop den anden linje, hele testen findes for at kræve.
//
// Sætningerne er UDDRAG og ikke hele punkter: et punkt dækker flere nøgler
// (introduktionen, checklisten, notifikations-kortet og liga-forslaget står i
// samme sætning), og et uddrag kan pege på sin egen del af det.
const NØGLENS_LØFTE = {
  [SESSION_KEY]: "en fornyelses-nøgle og din e-mail",
  [PING_KEY]: "sidst registrerede dig som aktiv",
  // Flow og complete er to nøgler om samme ting for brugeren: er du igennem
  // introduktionen. De deler derfor sætning med vilje.
  [FLOW_KEY]: "færdig med introduktionen",
  [COMPLETE_KEY]: "færdig med introduktionen",
  [CARD_KEY]: "skjult checklisten Kom godt i gang",
  [PUSH_DISMISS_KEY]: "lukket kortet om notifikationer",
  [NUDGE_KEY]: "lukket forslaget om at oprette en liga",
  [SEASON_LEAGUE_KEY]: "turnering du sidst kiggede på i Championship",
  [PWA_ONBOARDED_KEY]: "lægge appen på din hjemmeskærm",
  [COMP_DONE_KEY]: "konkurrencer du allerede har set slutte",
  [STORY_SEEN_KEY]: "historier du allerede har set",
  [PENDING_INVITE_KEY]: "invitation du var på vej ind ad",
};

describe("de lokale nøgler er dækket af politikken (G71)", () => {
  const afsnit = afsnitTekst(PRIVATLIV, "Hvad der ligger på din egen enhed");

  it("hver nøgle i LOKALE_NØGLER har et løfte i tabellen", () => {
    for (const nøgle of LOKALE_NØGLER) {
      expect(NØGLENS_LØFTE[nøgle], `${nøgle} mangler en linje i NØGLENS_LØFTE`).toBeTruthy();
    }
  });

  // Den anden retning. En nøgle, der fjernes fra koden, efterlader ellers en
  // sætning om noget, appen ikke længere gemmer — også en politik, der ikke
  // passer, bare den anden vej.
  it("tabellen kender ingen nøgle, appen ikke længere skriver", () => {
    for (const nøgle of Object.keys(NØGLENS_LØFTE)) {
      expect(LOKALE_NØGLER, `${nøgle} står i tabellen, men ikke i LOKALE_NØGLER`).toContain(nøgle);
    }
  });

  it.each(Object.entries(NØGLENS_LØFTE))(
    "%s beskrives i afsnittet om enheden", (_nøgle, løfte) => {
      expect(afsnit).toContain(løfte);
    });

  // Afsnittet må ikke stå tomt tilbage, hvis nogen omskriver det til én
  // sætning: hvert punkt skal fortsat bære mindst ét af løfterne, ellers er
  // der kommet en beskrivelse ind, som ingen nøgle svarer til.
  it("hvert punkt om enheden dækker mindst én rigtig nøgle", () => {
    const punkter = PRIVATLIV.afsnit
      .find((a) => a.titel === "Hvad der ligger på din egen enhed")
      .tekst.flatMap((t) => (typeof t === "string" ? [] : t.punkter));
    const løfter = Object.values(NØGLENS_LØFTE);
    for (const p of punkter) {
      expect(løfter.some((l) => p.includes(l)), `Punktet "${p}" svarer ikke til nogen nøgle`).toBe(true);
    }
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
