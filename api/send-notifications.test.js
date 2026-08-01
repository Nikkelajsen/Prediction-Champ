// Første tests for api/. Vitest kører uden konfigurationsfil, så
// default-include (**/*.test.js) samler filen op — der skal intet sættes op.
//
// Dækker de to invarianter, G9 og G10 brød: runde-resultat-notifikationen skal
// afgrænse BEGGE sine sider til de officielle turneringer, ellers er udløseren
// og indholdet uenige om, hvilke kampe runden består af.
//
// Plus modtager-reglen for "ny konkurrence i din liga" (B5), som er den eneste
// notifikation, hvor et forkert modtagerfelt er *synligt* forkert: den beder om
// en handling, og en besked til en, der allerede deltager, er en selvmodsigelse.
//
// Plus sendevinduet (A24). Det er den ene regel her, der er umulig at afprøve i
// drift: fejler den, opdages det ved, at nogen bliver vækket kl. 03.
import { describe, it, expect } from "vitest";
import { finishedRoundKeys, officialSeasonIds, newCompetitionMessages, hourInZone, dateInZone, withinSendWindow } from "./send-notifications.js";

const kamp = (round_key, home_score, away_score) => ({ id: `${round_key}-${home_score}-${away_score}`, round_key, home_score, away_score });

describe("finishedRoundKeys", () => {
  it("melder en runde færdig, når hver kamp har begge scorer", () => {
    expect(finishedRoundKeys([kamp("2026-08-04", 2, 1), kamp("2026-08-04", 0, 0)])).toEqual(["2026-08-04"]);
  });

  // G10's kerne: ÉN uspillet kamp holder hele runden tilbage. Det er korrekt
  // adfærd — fejlen var, at listen indeholdt kampe fra turneringer, stillingen
  // ikke dækker. Afgrænsningen sker i kaldet, invarianten her er "alle eller ingen".
  it("melder ikke en runde færdig, når én kamp mangler resultat", () => {
    expect(finishedRoundKeys([kamp("2026-08-04", 2, 1), kamp("2026-08-04", null, null)])).toEqual([]);
  });

  // Et 0-0 er et resultat: null-tjekket skal være på null og ikke på falsy,
  // ellers ville hver målløs kamp holde sin runde åben for evigt.
  it("behandler 0-0 som et resultat", () => {
    expect(finishedRoundKeys([kamp("2026-08-04", 0, 0)])).toEqual(["2026-08-04"]);
  });

  it("melder ikke en runde færdig, når kun den ene scorer er sat", () => {
    expect(finishedRoundKeys([kamp("2026-08-04", 3, null)])).toEqual([]);
    expect(finishedRoundKeys([kamp("2026-08-04", null, 3)])).toEqual([]);
  });

  it("afgør hver runde for sig", () => {
    const ud = finishedRoundKeys([
      kamp("2026-07-28", 1, 1),
      kamp("2026-08-04", 2, 0),
      kamp("2026-08-04", null, null),
    ]);
    expect(ud).toEqual(["2026-07-28"]);
  });

  it("giver ingen runder for en tom liste", () => {
    expect(finishedRoundKeys([])).toEqual([]);
  });
});

describe("officialSeasonIds", () => {
  // Stub-sb: returnerer svar pr. sti og husker, hvad der blev spurgt om.
  const stubSb = (svar) => {
    const kald = [];
    const sb = async (path) => {
      kald.push(path);
      const nøgle = Object.keys(svar).find((k) => path.startsWith(k));
      return nøgle ? svar[nøgle] : [];
    };
    return { sb, kald };
  };

  it("slår sæsoner op under de officielle turneringer", async () => {
    const { sb, kald } = stubSb({
      "/rest/v1/leagues": [{ id: "liga-1" }, { id: "liga-2" }],
      "/rest/v1/seasons": [{ id: "sæson-a" }, { id: "sæson-b" }],
    });
    expect(await officialSeasonIds(sb)).toEqual(["sæson-a", "sæson-b"]);
    expect(kald[0]).toContain("is_official=is.true");
    expect(kald[1]).toContain("league_id=in.(liga-1,liga-2)");
  });

  // Uden denne guard ville sæson-opslaget blive `in.()`, som PostgREST afviser
  // med 400 — og sb() kaster ved alt andet end 2xx, så hele kørslen ville vælte.
  it("springer sæson-opslaget over, når ingen turnering er officiel", async () => {
    const { sb, kald } = stubSb({ "/rest/v1/leagues": [] });
    expect(await officialSeasonIds(sb)).toEqual([]);
    expect(kald).toHaveLength(1);
  });
});

describe("newCompetitionMessages", () => {
  const OPRETTET = "2026-08-01T10:00:00+00:00";
  const basis = () => ({
    competitions: [{
      id: "komp-1", name: "Efterår 2026", group_id: "liga-1",
      created_by: "anna", created_at: OPRETTET, invite_code: "abc123",
    }],
    groups: [{ id: "liga-1", name: "Kontoret" }],
    members: [
      { group_id: "liga-1", user_id: "anna", joined_at: "2026-07-01T00:00:00+00:00" },
      { group_id: "liga-1", user_id: "bo", joined_at: "2026-07-01T00:00:00+00:00" },
    ],
    participants: [{ competition_id: "komp-1", user_id: "anna" }],
    creators: [{ id: "anna", display_name: "Anna" }],
  });
  const alle = () => true;

  it("inviterer det medlem, der ikke deltager endnu", () => {
    const beskeder = newCompetitionMessages(basis(), alle);
    expect(beskeder).toHaveLength(1);
    expect(beskeder[0]).toMatchObject({
      userId: "bo",
      key: "newcomp:komp-1",
      kind: "newcomp",
      joinCode: "abc123",
    });
    expect(beskeder[0].title).toBe("Ny konkurrence i Kontoret 🎯");
    expect(beskeder[0].body).toContain("Anna");
    expect(beskeder[0].body).toContain("Efterår 2026");
  });

  // Opretteren er allerede deltager, så deltager-filtret ville fange dem alligevel.
  // Testen holder BEGGE spærrer i live: fjernes den ene, skal den anden vise sig.
  it("skriver aldrig til opretteren", () => {
    const data = basis();
    data.participants = []; // ingen deltagerrækker overhovedet
    expect(newCompetitionMessages(data, alle).map((b) => b.userId)).toEqual(["bo"]);
  });

  it("springer den over, der allerede deltager", () => {
    const data = basis();
    data.participants.push({ competition_id: "komp-1", user_id: "bo" });
    expect(newCompetitionMessages(data, alle)).toEqual([]);
  });

  // Den vigtigste af de fire spærrer: konkurrencen stod på liga-siden, da de kom
  // ind, så "ny konkurrence" ville være direkte usandt.
  it("springer den over, der meldte sig ind i ligaen efter oprettelsen", () => {
    const data = basis();
    data.members[1].joined_at = "2026-08-01T11:00:00+00:00";
    expect(newCompetitionMessages(data, alle)).toEqual([]);
  });

  it("tager et medlem med, der meldte sig ind i samme minut som oprettelsen", () => {
    const data = basis();
    data.members[1].joined_at = OPRETTET;
    expect(newCompetitionMessages(data, alle)).toHaveLength(1);
  });

  it("skriver kun til brugere med en tilmeldt enhed", () => {
    expect(newCompetitionMessages(basis(), (uid) => uid !== "bo")).toEqual([]);
  });

  // group_id sættes til null, når en liga slettes, men rækken kan være læst før.
  // Uden navnet har beskeden hverken en sætning eller en medlemsliste.
  it("springer en konkurrence over, hvis ligaen ikke findes", () => {
    const data = basis();
    data.groups = [];
    expect(newCompetitionMessages(data, alle)).toEqual([]);
  });

  it("klarer sig uden opretterens navn", () => {
    const data = basis();
    data.creators = [];
    expect(newCompetitionMessages(data, alle)[0].body).toBe('"Efterår 2026" er åbnet. Tryk for at være med.');
  });

  it("holder ligaerne adskilt", () => {
    const data = basis();
    data.groups.push({ id: "liga-2", name: "Vennerne" });
    data.members.push({ group_id: "liga-2", user_id: "carl", joined_at: "2026-07-01T00:00:00+00:00" });
    expect(newCompetitionMessages(data, alle).map((b) => b.userId)).toEqual(["bo"]);
  });

  it("giver ingen beskeder, når intet er oprettet", () => {
    expect(newCompetitionMessages({ competitions: [], groups: [], members: [], participants: [], creators: [] }, alle)).toEqual([]);
  });
});

// Sendevinduet (A24). Testene bruger UTC-tidsstempler og lader funktionen om at
// oversætte — det er præcis den oversættelse, der er let at tage fejl af, og som
// en test med lokale datoer ville skjule ved at være grøn i én tidszone.
describe("hourInZone", () => {
  // Sommertid: Danmark er UTC+2. 21:00 UTC er 23:00 dansk — altså om natten,
  // selvom serverens eget klokkeslæt ligger inde i vinduet.
  it("oversætter til dansk sommertid (UTC+2)", () => {
    expect(hourInZone(new Date("2026-08-01T21:00:00Z"))).toBe(23);
    expect(hourInZone(new Date("2026-08-01T06:00:00Z"))).toBe(8);
  });

  // Vintertid: UTC+1. Samme UTC-klokkeslæt giver et andet dansk — grunden til,
  // at grænsen ikke må hårdkodes i UTC.
  it("oversætter til dansk vintertid (UTC+1)", () => {
    expect(hourInZone(new Date("2026-12-01T21:00:00Z"))).toBe(22);
    expect(hourInZone(new Date("2026-12-01T07:00:00Z"))).toBe(8);
  });

  // h23-hjørnet: uden hourCycle giver midnat "24" i flere ICU-versioner, og 24
  // ligger uden for ethvert vindue, man ville skrive i hånden.
  it("giver 0 ved midnat, ikke 24", () => {
    expect(hourInZone(new Date("2026-08-01T22:00:00Z"))).toBe(0);
  });
});

// Den øvre grænse på round_key, som G51 manglede. Grænsen er en DATO, og
// serverens egen (UTC) er en anden end brugerens i timerne efter midnat dansk.
describe("dateInZone", () => {
  it("giver den danske dato, også når UTC stadig er i går", () => {
    expect(dateInZone(new Date("2026-08-01T22:30:00Z"))).toBe("2026-08-02"); // 00:30 dansk
    expect(dateInZone(new Date("2026-08-01T21:30:00Z"))).toBe("2026-08-01"); // 23:30 dansk
  });

  it("giver ÅÅÅÅ-MM-DD, som round_key sammenlignes på", () => {
    expect(dateInZone(new Date("2026-01-05T12:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dateInZone(new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
  });
});

describe("withinSendWindow", () => {
  it("sender midt på dagen", () => {
    expect(withinSendWindow(new Date("2026-08-01T12:00:00Z"))).toBe(true); // 14 dansk
  });

  it("åbner kl. 08 og lukker kl. 22", () => {
    expect(withinSendWindow(new Date("2026-08-01T06:00:00Z"))).toBe(true);  // 08:00 — inde
    expect(withinSendWindow(new Date("2026-08-01T05:59:00Z"))).toBe(false); // 07:59 — ude
    expect(withinSendWindow(new Date("2026-08-01T19:59:00Z"))).toBe(true);  // 21:59 — inde
    expect(withinSendWindow(new Date("2026-08-01T20:00:00Z"))).toBe(false); // 22:00 — ude
  });

  it("tier hele natten", () => {
    expect(withinSendWindow(new Date("2026-08-01T21:00:00Z"))).toBe(false); // 23 dansk
    expect(withinSendWindow(new Date("2026-08-01T23:00:00Z"))).toBe(false); // 01 dansk
    expect(withinSendWindow(new Date("2026-08-02T02:00:00Z"))).toBe(false); // 04 dansk
  });

  // Sommer/vinter afgør, om 21:00 UTC er inde eller ude. Faldt zonen væk, ville
  // begge give det samme svar — og det ene af dem ville være forkert et halvt år.
  it("følger sommertidsskiftet", () => {
    expect(withinSendWindow(new Date("2026-08-01T21:00:00Z"))).toBe(false); // 23 dansk
    expect(withinSendWindow(new Date("2026-12-01T20:30:00Z"))).toBe(true);  // 21:30 dansk
  });

  // Et vindue over midnat må ikke tavst betyde "aldrig" — den fælde er hele
  // grunden til, at sammenligningen har to grene.
  it("understøtter et vindue, der krydser midnat", () => {
    const natten = { start: 22, end: 8 };
    expect(withinSendWindow(new Date("2026-08-01T21:00:00Z"), natten)).toBe(true);  // 23 dansk
    expect(withinSendWindow(new Date("2026-08-01T12:00:00Z"), natten)).toBe(false); // 14 dansk
  });
});
