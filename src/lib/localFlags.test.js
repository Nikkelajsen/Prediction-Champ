// Tests for de bruger-bundne flag.
//
// Det, der testes, er ejerskabet. Flagene lå før som rene "1"-værdier på
// enheden, og konsekvensen var ikke kosmetisk: `pc_onboarding_v1_complete` fra
// en tidligere konto slukkede BÅDE onboarding-guiden og "Kom godt i gang"-
// kortet for den næste bruger på samme telefon, som derfor mødte en helt tom
// Hjem-skærm. Testene her holder på, at et flag kun gælder den, der satte det.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readFlag, writeFlag, removeFlag, readUserFlag, writeUserFlag,
  readPendingInvite, writePendingInvite, clearPendingInvite,
  LOKALE_NØGLER, COMPLETE_KEY, SESSION_KEY, PENDING_INVITE_KEY, PENDING_INVITE_TTL_MS,
} from "./localFlags.js";

// Node-miljøet har ingen localStorage — den stubbes, så vi tester vores egen
// logik og ikke browserens.
function stubStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  return map;
}

beforeEach(() => { stubStorage(); });
afterEach(() => { delete globalThis.localStorage; });

describe("readUserFlag / writeUserFlag", () => {
  it("læser sin egen værdi tilbage", () => {
    writeUserFlag(COMPLETE_KEY, "user-a", "1");
    expect(readUserFlag(COMPLETE_KEY, "user-a")).toBe("1");
  });

  it("bevarer en værdi, der ikke bare er ja/nej", () => {
    writeUserFlag("pc_season_league", "user-a", "liga-42");
    expect(readUserFlag("pc_season_league", "user-a")).toBe("liga-42");
  });

  // Kernen i fejlen: en ANDEN brugers flag må ikke kunne læses.
  it("ser ikke en anden brugers flag", () => {
    writeUserFlag(COMPLETE_KEY, "user-a", "1");
    expect(readUserFlag(COMPLETE_KEY, "user-b")).toBe(null);
  });

  // Et flag fra før opdelingen tilhører ingen. Det ignoreres frem for at blive
  // tildelt den, der tilfældigvis logger ind først — netop dén migrering ville
  // gen-indføre fejlen for en, der opretter en ny konto efter et log ud.
  it("ignorerer et gammelt flag uden ejer", () => {
    writeFlag(COMPLETE_KEY, "1");
    expect(readUserFlag(COMPLETE_KEY, "user-a")).toBe(null);
  });

  it("skriver ikke uden en ejer at skrive det for", () => {
    writeUserFlag(COMPLETE_KEY, null, "1");
    expect(readFlag(COMPLETE_KEY)).toBe(null);
  });

  it("giver null for et flag, der aldrig er sat", () => {
    expect(readUserFlag(COMPLETE_KEY, "user-a")).toBe(null);
  });

  it("kan overskrives af sin egen ejer", () => {
    writeUserFlag(COMPLETE_KEY, "user-a", "1");
    writeUserFlag(COMPLETE_KEY, "user-a", "2");
    expect(readUserFlag(COMPLETE_KEY, "user-a")).toBe("2");
  });
});

describe("når localStorage er utilgængelig", () => {
  // Privat browsing og blokerede cookies. Intet af det her må kunne vælte en
  // skærm — en manglende hukommelse betyder bare, at appen spørger igen.
  beforeEach(() => { delete globalThis.localStorage; });

  it("fejler stille i begge retninger", () => {
    expect(() => writeUserFlag(COMPLETE_KEY, "user-a", "1")).not.toThrow();
    expect(readUserFlag(COMPLETE_KEY, "user-a")).toBe(null);
    expect(() => removeFlag(COMPLETE_KEY)).not.toThrow();
    expect(readFlag(COMPLETE_KEY)).toBe(null);
  });
});

describe("LOKALE_NØGLER", () => {
  // Samme vagt som før flytningen: står en nøgle ikke på listen, bliver den
  // ikke ryddet ved kontolukning og følger den næste bruger på enheden.
  it("dækker hver pc_-nøgle, appen skriver", () => {
    for (const n of [
      "pc_session", "pc_last_ping", "pc_onboarding_v1_flow", "pc_onboarding_v1_card",
      "pc_onboarding_v1_complete", "pc_push_dismissed", "pc_liga_nudge_dismissed",
      "pc_season_league", "pc_pwa_onboarded",
    ]) {
      expect(LOKALE_NØGLER).toContain(n);
    }
  });

  it("holder sessionen enheds-global — den ER brugeren", () => {
    expect(SESSION_KEY).toBe("pc_session");
  });
});

// Den ventende invitation (I7).
//
// Nøglen findes, fordi `?liga=`-koden indtil august 2026 kun lå i React-state:
// den dag `B26` slår e-mailbekræftelse til, forlader den nye bruger siden og
// kommer tilbage uden koden. Testene her holder på de tre ting, der gør
// mekanismen til en forsikring frem for en kø, der vokser: den kan læses igen,
// den udløber, og alt andet end det, vi selv skrev, kasseres.
describe("den ventende invitation", () => {
  const NU = 1_755_000_000_000;

  it("kan læses igen — det er hele pointen", () => {
    writePendingInvite("liga", "abc12345", NU);
    expect(readPendingInvite(NU + 1000)).toEqual({ param: "liga", code: "abc12345" });
  });

  it("skelner de to link-typer", () => {
    writePendingInvite("join", "deadbeef", NU);
    expect(readPendingInvite(NU)).toEqual({ param: "join", code: "deadbeef" });
  });

  it("er der ikke, når intet er gemt", () => {
    expect(readPendingInvite(NU)).toBeNull();
  });

  // Et døgn: en mail, der kommer sent, plus en nats søvn. Længere ville betyde,
  // at en invitation, nogen aldrig tog imod, kunne dukke op uger senere som en
  // dialog, de ikke havde bedt om.
  it("udløber efter et døgn", () => {
    writePendingInvite("liga", "abc12345", NU);
    expect(readPendingInvite(NU + PENDING_INVITE_TTL_MS - 1)).not.toBeNull();
    expect(readPendingInvite(NU + PENDING_INVITE_TTL_MS)).toBeNull();
  });

  // Og den RYDDER undervejs. En invitation, der ikke kan bruges, skal ikke
  // blive liggende og blive prøvet igen ved hver eneste opstart.
  it("rydder den udløbne værdi frem for at lade den ligge", () => {
    writePendingInvite("liga", "abc12345", NU);
    readPendingInvite(NU + PENDING_INVITE_TTL_MS);
    expect(readFlag(PENDING_INVITE_KEY)).toBeNull();
  });

  // Et tidsstempel FREM i tiden er et flyttet ur, ikke en frisk invitation —
  // og en værdi, der aldrig udløber, er værre end ingen.
  it("kasserer et tidsstempel fra fremtiden", () => {
    writePendingInvite("liga", "abc12345", NU + 60_000);
    expect(readPendingInvite(NU)).toBeNull();
  });

  it.each([
    ["vrøvl", "en værdi, vi ikke selv har skrevet"],
    ["liga:abc12345", "et manglende tidsstempel"],
    ["andet:abc12345:1755000000000", "en parameter, appen ikke kender"],
    [`liga::${NU}`, "en tom kode"],
  ])("kasserer %s (%s)", (værdi) => {
    writeFlag(PENDING_INVITE_KEY, værdi);
    expect(readPendingInvite(NU)).toBeNull();
  });

  it("kan ryddes, når invitationen er indløst", () => {
    writePendingInvite("liga", "abc12345", NU);
    clearPendingInvite();
    expect(readPendingInvite(NU)).toBeNull();
  });

  // Enheds-global og ikke bruger-mærket: der er pr. definition ingen bruger
  // endnu. Det er hele situationen, nøglen findes for.
  it("er enheds-global — der er ingen konto at mærke den med endnu", () => {
    writePendingInvite("liga", "abc12345", NU);
    expect(readFlag(PENDING_INVITE_KEY)).not.toContain("@");
  });
});
