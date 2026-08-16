import { describe, it, expect, vi, afterEach } from "vitest";
import { shareText, shareImage, storyShareText, inviteShareText } from "./share.js";

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

// `caption` mod `text` — de to veje gennem shareImage må ikke sige det samme.
//
// HVORFOR TESTEN FINDES. Indtil 16. august 2026 var der kun ét felt, og det
// blev brugt begge veje: beskeden bar billedet OG hele dets indhold som tekst
// under det. Fejlen kunne ikke ses i koden — den ene linje så rigtig ud — og
// kun i en rigtig beskedtråd. Nu er der to felter, og det, der skal vogtes, er,
// at de hver især havner det RIGTIGE sted.
describe("shareImage · billedtekst mod faldback-tekst", () => {
  const draw = () => {};

  // Suiten kører i Node uden jsdom, så `document` findes ikke. Et attrap-canvas
  // frem for en jsdom-afhængighed: repoets fire runtime-deps er et bevidst valg,
  // og det eneste, testen skal bruge, er de tre metoder shareImage kalder.
  function stubDocument() {
    globalThis.document = {
      createElement: () => ({
        width: 0, height: 0,
        getContext: () => ({}),
        toBlob: (cb) => cb(new Blob([""], { type: "image/png" })),
      }),
    };
  }

  function medFiledeling() {
    stubDocument();
    navigator.canShare = () => true;
    navigator.share = vi.fn().mockResolvedValue(undefined);
    return navigator.share;
  }

  afterEach(() => {
    delete globalThis.document;
    delete navigator.share;
    delete navigator.canShare;
    delete navigator.clipboard;
    vi.restoreAllMocks();
  });

  it("sender KUN billedteksten sammen med billedet", async () => {
    const share = medFiledeling();
    await shareImage(draw, { caption: "Kampdag 15/8", text: "Overskrift\nHele brødteksten." });
    const arg = share.mock.calls[0][0];
    expect(arg.text).toBe("Kampdag 15/8");
    expect(arg.files).toHaveLength(1);
  });

  // Faldbacken er den modsatte: dér er teksten HELE beskeden, og en kort
  // billedtekst ville efterlade modtageren med "Kampdag 15/8" og intet andet.
  it("sender den fulde tekst, når billedet ikke kan deles", async () => {
    stubDocument();
    const writeText = vi.fn().mockResolvedValue(undefined);
    navigator.clipboard = { writeText };
    expect(await shareImage(draw, { caption: "Kampdag 15/8", text: "Overskrift\nHele brødteksten." }))
      .toBe("clipboard");
    expect(writeText).toHaveBeenCalledWith("Overskrift\nHele brødteksten.");
  });

  // Karriereprofilens milepæl deler ren tekst og har ingen billedtekst at give.
  // En kalder uden `caption` skal derfor opføre sig som før ændringen.
  it("falder tilbage på teksten, når kalderen ingen billedtekst har", async () => {
    const share = medFiledeling();
    await shareImage(draw, { text: "Overskrift\nBrødtekst." });
    expect(share.mock.calls[0][0].text).toBe("Overskrift\nBrødtekst.");
  });

  // `?? ` og ikke `|| `: en tom billedtekst er et VALG og må ikke falde tilbage
  // på den fulde tekst, som ville sætte duplikeringen tilbage.
  it("respekterer en bevidst tom billedtekst", async () => {
    const share = medFiledeling();
    await shareImage(draw, { caption: "", text: "Hele historien." });
    expect(share.mock.calls[0][0].text).toBe("");
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
