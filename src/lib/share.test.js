import { describe, it, expect, vi, afterEach } from "vitest";
import { shareText, storyShareText } from "./share.js";

// Returværdien ER kontrakten: kaldstederne viser "Kopieret!" ved udklipsholder
// og INTET ved systemets deleark, som er sin egen kvittering. Bytter de to om,
// får brugeren enten to kvitteringer eller ingen — og det kan kun ses her,
// fordi begge veje ser identiske ud i koden på kaldstedet.
describe("shareText", () => {
  afterEach(() => {
    delete navigator.share;
    delete navigator.clipboard;
    vi.restoreAllMocks();
  });

  it("bruger systemets deleark, når det findes, og siger det", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    navigator.share = share;
    navigator.clipboard = { writeText: vi.fn() };
    expect(await shareText("hej")).toBe("share");
    expect(share).toHaveBeenCalledWith({ title: "Prediction Champ", text: "hej" });
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("falder tilbage til udklipsholderen og siger det", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    navigator.clipboard = { writeText };
    expect(await shareText("hej")).toBe("clipboard");
    expect(writeText).toHaveBeenCalledWith("hej");
  });

  // En annulleret deling er ikke en fejl, men den er heller ikke helperens at
  // sluge: kaldstedet skal kunne skelne "brugeren fortrød" fra "det lykkedes"
  // — ellers ville en annulleret deling blive logget som en delt historie.
  it("sluger ikke en afvisning", async () => {
    navigator.share = vi.fn().mockRejectedValue(new Error("AbortError"));
    await expect(shareText("hej")).rejects.toThrow();
  });
});

describe("storyShareText", () => {
  it("samler overskrift og brødtekst med ét linjeskift", () => {
    expect(storyShareText({ headline: "🏅 Ugens bedste", body: "14 point." })).toBe("🏅 Ugens bedste\n14 point.");
  });

  // Milepæle og historie-kort deler funktionen, og et kort uden brødtekst må
  // ikke blive til en tekst, der slutter på et tomt linjeskift.
  it("udelader en manglende brødtekst frem for at efterlade en tom linje", () => {
    expect(storyShareText({ headline: "Kun en overskrift" })).toBe("Kun en overskrift");
  });
});
