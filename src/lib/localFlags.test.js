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
  LOKALE_NØGLER, COMPLETE_KEY, SESSION_KEY,
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
