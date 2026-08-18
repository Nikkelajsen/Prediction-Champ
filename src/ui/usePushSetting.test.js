import { describe, it, expect } from "vitest";
import { derivePushStatus } from "./usePushSetting.js";

// Prioriteringen er den samme, som enablePush() fejler i: understøttelse →
// hjemmeskærm → tilladelse → abonnement. Testene her fryser den rækkefølge.
describe("derivePushStatus", () => {
  const base = { supported: true, needsInstall: false, permission: "granted", hasSubscription: false };

  it("uden browser-understøttelse er alt andet ligegyldigt", () => {
    expect(derivePushStatus({ ...base, supported: false, hasSubscription: true })).toBe("unsupported");
  });

  it("iOS uden hjemmeskærms-installation vinder over tilladelsen", () => {
    expect(derivePushStatus({ ...base, needsInstall: true, permission: "denied" })).toBe("needs-install");
  });

  it("blokeret tilladelse låser kontakten, uanset abonnement", () => {
    expect(derivePushStatus({ ...base, permission: "denied", hasSubscription: true })).toBe("denied");
  });

  it("et eksisterende abonnement er en tændt kontakt", () => {
    expect(derivePushStatus({ ...base, hasSubscription: true })).toBe("on");
  });

  it("understøttet, tilladt, intet abonnement — slukket kontakt", () => {
    expect(derivePushStatus(base)).toBe("off");
  });

  it("en endnu ikke stillet tilladelse er også bare slukket", () => {
    expect(derivePushStatus({ ...base, permission: "default" })).toBe("off");
  });
});
