// Tests for api/sync-live.js.
//
// Handleren selv kræver en database og et request-objekt og testes ikke her.
// Det, der testes, er den ene REGEL, der afgør, hvornår jobbet fejer efter tabte
// resultater (G122) — samme mønster som `seasonFetchVerdict()` i sync-matches:
// reglen trækkes ud som ren funktion, netop fordi den skal være svær at ændre
// ved et uheld.
//
// Hvorfor netop den er værd at fastholde: efterfejningen er den eneste del af
// jobbet, der kan lave et leverandørkald på et minut, hvor der ellers ikke var
// noget at lave. Den tidlige retur i handleren er hele jobbets
// forbrugsbegrænsning, og forsvinder gatet her — bliver `null` til "altid feje"
// — går kadencen fra 24 ekstra kald i døgnet til 1.440, uden at nogen test
// bliver rød og uden at noget i appen ser anderledes ud.
import { describe, it, expect } from "vitest";
import { staleWindow } from "./sync-live.js";

// Fejeminuttet er 41 (se begrundelsen i sync-live.js: 00, 05, 11, 15, 17, 23 og
// 29 er optaget af kampprogram-jobbene). Testene skriver det ikke af som en
// konstant, men bruger `sweepMinute`, hvor tallet selv er det, der prøves — så
// en ændring af minuttet ikke kræver en rettelse her.
const kl = (t) => new Date(`2026-08-15T${t}:00Z`).getTime();

const TIME = 60 * 1000;
const HOUR = 60 * TIME;

describe("staleWindow", () => {
  it("fejer ikke på et almindeligt minut", () => {
    // 59 minutter ud af 60 skal jobbet opføre sig præcis som før: intet ekstra
    // opslag, ingen mulighed for et ekstra leverandørkald.
    expect(staleWindow(kl("20:42"), { sweepMinute: 41 })).toBe(null);
    expect(staleWindow(kl("20:00"), { sweepMinute: 41 })).toBe(null);
  });

  it("fejer på fejeminuttet", () => {
    expect(staleWindow(kl("20:41"), { sweepMinute: 41 })).not.toBe(null);
  });

  it("fejer én gang i timen, hele døgnet rundt", () => {
    // Tælleren er hele værnet mod, at bagstopperen bliver jobbets dyreste del.
    // Den er talt op frem for ræsonneret om, fordi det er ANTALLET, prisen
    // følger — 24 kald i døgnet og ikke 1.440.
    let sweeps = 0;
    for (let i = 0; i < 24 * 60; i++) {
      if (staleWindow(kl("00:00") + i * TIME, { sweepMinute: 41 })) sweeps++;
    }
    expect(sweeps).toBe(24);
  });

  it("støder op til live-vinduet uden overlap", () => {
    // `to` skal være NØJAGTIG live-vinduets bagkant (6 timer), så en kamp høres
    // af præcis ét af de to opslag. Ligger de over hinanden, hentes kampen to
    // gange; ligger der luft imellem, findes der en alder, hvor ingen af dem
    // ser den — og det er præcis det hul, G122 handlede om.
    const now = kl("20:41");
    const w = staleWindow(now, { sweepMinute: 41 });
    expect(new Date(w.to).getTime()).toBe(now - 6 * HOUR);
  });

  it("har en øvre alder, så en kamp ikke fejes i det uendelige", () => {
    // Uden loftet ville en kamp, der ALDRIG kan få et resultat — udsat, eller
    // uden for abonnementet — koste et leverandørkald hver time for evigt.
    const now = kl("20:41");
    const w = staleWindow(now, { sweepMinute: 41 });
    expect(new Date(w.from).getTime()).toBe(now - 36 * HOUR);
    expect(new Date(w.from).getTime()).toBeLessThan(new Date(w.to).getTime());
  });
});
