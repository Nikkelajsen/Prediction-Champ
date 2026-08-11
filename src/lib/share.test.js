import { describe, it, expect, vi, afterEach } from "vitest";
import { shareText, storyShareText, inviteShareText } from "./share.js";

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
    expect(share).toHaveBeenCalledWith({ title: "Leagly", text: "hej" });
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

// Invitationens ordlyd (I7).
//
// Den lå i to udgaver — én pr. skærm — og de var drevet fra hinanden:
// konkurrence-invitationen kunne sige "Nikolaj har inviteret dig", liga-
// invitationen kun det upersonlige "Du er inviteret til". Det er dét, testene
// her holder på: at de to nu er den SAMME sætning med et andet mål i midten.
describe("inviteShareText", () => {
  const link = "https://leagly.app/?liga=abc12345";

  it("navngiver afsenderen, når navnet kendes", () => {
    const t = inviteShareText({ inviterName: "Nikolaj", mål: 'ligaen "Vennerne"', link });
    expect(t).toContain('Nikolaj har inviteret dig til ligaen "Vennerne" på Leagly');
    expect(t).toContain(link);
  });

  // En bruger uden valgt visningsnavn må ikke blive til "undefined har
  // inviteret dig" — den upersonlige form er stadig en god invitation.
  it.each([undefined, null, ""])("falder tilbage til den upersonlige form (%s)", (navn) => {
    const t = inviteShareText({ inviterName: navn, mål: 'ligaen "Vennerne"', link });
    expect(t).toContain('Du er inviteret til ligaen "Vennerne" på Leagly');
    expect(t).not.toContain("undefined");
    expect(t).not.toContain("null");
  });

  // Kernen i I7-rettelsen: de to skærme skal skrive det samme, bortset fra
  // hvad man inviteres TIL. Går de fra hinanden igen, fejler denne.
  it("skriver liga og konkurrence ens bortset fra målet", () => {
    const liga = inviteShareText({ inviterName: "Nikolaj", mål: 'ligaen "Vennerne"', link });
    const komp = inviteShareText({ inviterName: "Nikolaj", mål: 'konkurrencen "EM-kuponen"', link });
    expect(liga.replace('ligaen "Vennerne"', "X")).toBe(komp.replace('konkurrencen "EM-kuponen"', "X"));
  });

  it("slutter med linket, så det ikke drukner i teksten", () => {
    expect(inviteShareText({ mål: 'ligaen "V"', link }).endsWith(link)).toBe(true);
  });
});
