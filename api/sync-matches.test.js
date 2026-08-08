// Tests for api/sync-matches.js.
//
// Handleren selv kræver en database og et request-objekt og testes ikke her.
// Det, der testes, er den ene REGEL, der afgør, om en fejlet sæsonhentning
// tæller som en fejlet kørsel — samme mønster som `finishedRoundKeys()` i
// send-notifications: reglen trækkes ud som ren funktion, netop fordi den skal
// være svær at ændre ved et uheld.
//
// Hvorfor den er værd at fastholde: en for bred tolerance gør en forkert
// api_season_id usynlig (jobbet står grønt, mens turneringen aldrig henter en
// eneste kamp), og en for smal gør Champions League rød i seks uger for noget
// forventeligt. Begge fejl ender samme sted — at ingen kigger på driftsloggen.
import { describe, it, expect } from "vitest";
import { seasonFetchVerdict, ambiguousTeamNames, normalizeTeamName, matchUpsertRow, readSeasonMeta, refreshKickoffUncertain } from "./sync-matches.js";

const fejl = new Error("football-data.org: 404 {\"message\":\"The resource you are looking for does not exist.\"}");

describe("seasonFetchVerdict", () => {
  it("tolererer en sæson, leverandøren endnu ikke har oprettet", () => {
    // Champions League indtil lodtrækningen. Retter sig selv.
    const v = seasonFetchVerdict(fejl, {
      code: "season-not-published",
      message: "football-data.org har endnu ikke oprettet sæsonen 2026 (aktuel sæson er 2025).",
    });
    expect(v.tolerated).toBe(true);
  });

  it("tolererer IKKE et forkert api_season_id", () => {
    // Den, der ikke retter sig selv, skal blive ved med at være rød.
    const v = seasonFetchVerdict(fejl, {
      code: "season-unknown",
      message: "Sæsonen 2019 kendes ikke af football-data.org. Ret api_season_id på sæson-rækken.",
    });
    expect(v.tolerated).toBe(false);
    expect(v.message).toMatch(/api_season_id/);
  });

  it.each(["season-empty", "undetermined", "lookup-failed"])(
    "tolererer ikke '%s' — kun den ene kode slipper igennem",
    (code) => {
      expect(seasonFetchVerdict(fejl, { code, message: "…" }).tolerated).toBe(false);
    }
  );

  it("bærer den rå fejl videre, når der ingen diagnose er", () => {
    // Sportmonks har ingen describeEmptySeason. Fejlen må ikke forsvinde.
    const v = seasonFetchVerdict(fejl, null);
    expect(v.tolerated).toBe(false);
    expect(v.message).toBe(fejl.message);
    expect(v.message).not.toMatch(/—/);
  });

  it("sætter diagnosen EFTER den rå fejl, så begge kan læses", () => {
    // Rækkefølgen er ikke ligegyldig: statuskoden er det, man søger efter i
    // logs, og forklaringen er det, man handler på.
    const v = seasonFetchVerdict(fejl, { code: "season-unknown", message: "Ret api_season_id." });
    expect(v.message).toBe(`${fejl.message} — Ret api_season_id.`);
  });
});

// Holdnavne, den fuzzy match ikke kan skelne.
//
// `B2` bad om, at Scotland Premiership' hold blev kontrolleret for dubletter
// efter første sync, og indbakken bad om den samme kontrol for Champions League
// efter lodtrækningen. Begge er engangs-tjek, et menneske skal huske på det
// rigtige tidspunkt — her er de i stedet en permanent del af hver kørsel.
describe("ambiguousTeamNames", () => {
  const hold = (...navne) => navne.map((name) => ({ name }));

  it("finder ingenting i en liga med entydige navne", () => {
    expect(ambiguousTeamNames(hold("Celtic", "Aberdeen", "Hibernian"))).toEqual([]);
  });

  // Den ægte skotske fælde: findByName() falder tilbage til en delstrengs-match,
  // så et nyt "Rangers" kan blive knyttet til "Queen's Park Rangers"' række.
  it("fanger et navn, der ligger inde i et andet", () => {
    const ud = ambiguousTeamNames(hold("Rangers", "Queen's Park Rangers"));
    expect(ud).toHaveLength(1);
    expect(ud[0].teams).toEqual(["Rangers", "Queen's Park Rangers"]);
  });

  // To rækker for samme klub — det, dubletkontrollen hed i drejebogen.
  it("fanger to rækker, der normaliserer til det samme", () => {
    const ud = ambiguousTeamNames(hold("Celtic FC", "Celtic F.C."));
    expect(ud).toHaveLength(1);
    expect(ud[0].why).toBe("identiske navne");
  });

  it("tåler tomme og manglende navne", () => {
    expect(ambiguousTeamNames([])).toEqual([]);
    expect(ambiguousTeamNames(undefined)).toEqual([]);
    expect(ambiguousTeamNames([{ name: null }, { name: "" }, { name: "Celtic" }])).toEqual([]);
  });
});

describe("normalizeTeamName", () => {
  // Skal være ORD for ord den samme som findByName()'s egen normalisering —
  // en kontrol, der normaliserer anderledes end det, den kontrollerer, ville
  // melde noget andet end det, der faktisk sker.
  it("fjerner accenter, tegn og store bogstaver", () => {
    expect(normalizeTeamName("Atlético  Madrid!")).toBe("atleticomadrid");
    expect(normalizeTeamName("Queen's Park Rangers")).toBe("queensparkrangers");
    expect(normalizeTeamName(null)).toBe("");
  });

  // G52 (august 2026): før foldede NFD kun accenter, mens ø, æ og å overlevede
  // og derefter blev SLETTET af tegn-filteret — "FC København" blev
  // `fckbenhavn`, "FC Kobenhavn" blev `fckobenhavn`, og de to skrivemåder var
  // dermed to forskellige hold. Alle tre former skal nu ramme samme nøgle.
  it("folder ø, æ og å ned til grundbogstavet — også når de er skrevet ud", () => {
    expect(normalizeTeamName("FC København")).toBe("fckobenhavn");
    expect(normalizeTeamName("FC Kobenhavn")).toBe("fckobenhavn");
    expect(normalizeTeamName("FC Koebenhavn")).toBe("fckobenhavn");
    expect(normalizeTeamName("Brøndby")).toBe(normalizeTeamName("Brondby"));
    expect(normalizeTeamName("Århus")).toBe(normalizeTeamName("Aarhus"));
  });

  // Retningen følger af NFD, som har foldet "ä" til "a" hele tiden — så den
  // udskrevne form skal folde det samme sted hen.
  it("behandler den udskrevne ä som NFD behandler selve ä'et", () => {
    expect(normalizeTeamName("Häcken")).toBe("hacken");
    expect(normalizeTeamName("Haecken")).toBe("hacken");
    expect(normalizeTeamName("Hacken")).toBe("hacken");
  });

  // Den bevidste GRÆNSE: "ue" foldes ikke, fordi det er to almindelige bogstaver
  // i de sprog, klubnavnene står på — "Queen's Park" ville ellers blive til en
  // nøgle, der ikke ligner sit hold. Prisen er, at den udskrevne tyske umlaut
  // står tilbage som to hold, og det skal stå skrevet frem for at blive
  // genopdaget som en dublet.
  it("folder IKKE 'ue' — og det koster den udskrevne tyske umlaut", () => {
    expect(normalizeTeamName("Queen's Park Rangers")).toBe("queensparkrangers");
    expect(normalizeTeamName("Bayern München")).toBe("bayernmunchen");
    expect(normalizeTeamName("Bayern Muenchen")).not.toBe(normalizeTeamName("Bayern München"));
  });

  // Foldningen må ikke koste den kontrol, den er nabo til: delstrengs-fælden
  // ("Rangers" inde i "Queen's Park Rangers") skal stadig kunne ses.
  it("ændrer ikke, hvad delstrengs-kontrollen kan se", () => {
    const nøgler = ["Queen's Park Rangers", "Rangers"].map(normalizeTeamName);
    expect(nøgler[0]).toContain(nøgler[1]);
  });
});

// G56 (august 2026): der fandtes ingen test på, hvad syncen faktisk SKRIVER.
// De tre andre describe-blokke dækker regler, der afgør, om noget skrives —
// ikke hvad rækken indeholder, når den gør. Det er dét, `matchUpsertRow` er
// trukket ud for: feltet `kickoff_tbd` beregnes i providerne og forbruges tre
// helt andre steder (klientens `lockAtOf`, RLS-policyerne og efterfyldningens
// regel 3), og hele den kæde hviler på, at værdien kommer med i skrivningen.
describe("matchUpsertRow", () => {
  const IDS = { seasonId: "S1", homeTeamId: "H", awayTeamId: "A" };
  const fx = (over = {}) => ({
    globalId: "fd:1", kickoffAt: "2026-08-18T00:00:00Z", kickoffTbd: false,
    stageName: "REGULAR_SEASON", status: "scheduled", score: { home: null, away: null }, ...over,
  });

  it("bærer kickoff_tbd med over i rækken", () => {
    expect(matchUpsertRow(fx({ kickoffTbd: true }), IDS).kickoff_tbd).toBe(true);
    expect(matchUpsertRow(fx(), IDS).kickoff_tbd).toBe(false);
  });

  // Providerne må gerne udelade feltet (en tredje leverandør, en ældre
  // normalize) — kolonnen er `not null`, så rækken skal bære en boolean og
  // ikke en undefined, der ville blive til databasens default ad omveje.
  it("gør et manglende flag til false frem for undefined", () => {
    const row = matchUpsertRow(fx({ kickoffTbd: undefined }), IDS);
    expect(row.kickoff_tbd).toBe(false);
    expect("kickoff_tbd" in row).toBe(true);
  });

  it("skriver kun score for en færdigspillet kamp", () => {
    const live = matchUpsertRow(fx({ status: "live", score: { home: 1, away: 0 } }), IDS);
    expect(live).toMatchObject({ home_score: null, away_score: null, status: "scheduled" });
    const done = matchUpsertRow(fx({ status: "finished", score: { home: 2, away: 1 } }), IDS);
    expect(done).toMatchObject({ home_score: 2, away_score: 1, status: "finished" });
  });

  it("tager id'erne fra kalderen og resten fra den normaliserede kamp", () => {
    expect(matchUpsertRow(fx(), IDS)).toEqual({
      season_id: "S1", home_team_id: "H", away_team_id: "A",
      kickoff_at: "2026-08-18T00:00:00Z", kickoff_tbd: false,
      home_score: null, away_score: null, status: "scheduled",
      stage_name: "REGULAR_SEASON", api_fixture_id: "fd:1",
    });
  });
});

// Sæson-metadataene må ALDRIG kunne vælte en kørsel, der hentede kampene
// rigtigt: uden svar falder competition_status blot tilbage på sin 30-dages
// ventil, og det er en dårligere status — ikke en fejlet sync.
describe("readSeasonMeta", () => {
  it("giver leverandørens svar videre", async () => {
    const provider = { key: "x", fetchSeasonMeta: async () => ({ endsAt: "2027-05-24", finished: false }) };
    await expect(readSeasonMeta(provider, {})).resolves.toEqual({ endsAt: "2027-05-24", finished: false });
  });

  it("svarer null, når leverandøren ikke har metoden", async () => {
    await expect(readSeasonMeta({ key: "x" }, {})).resolves.toBeNull();
  });

  it("svarer null i stedet for at kaste, når opslaget fejler", async () => {
    const provider = { key: "x", fetchSeasonMeta: async () => { throw new Error("429"); } };
    await expect(readSeasonMeta(provider, {})).resolves.toBeNull();
  });
});

// G85. Reglen selv bor i SQL og er dækket af sql/tests/kickoff_uncertain.sql;
// det, der prøves her, er de to ting, JS-siden er ansvarlig for — at kaldet
// rammer den rigtige funktion med den rigtige parameter, og at et svar, der
// fejler, ikke kan vælte en kørsel, hvor kampene ellers kom rigtigt hjem.
//
// Den anden halvdel er den vigtige. Markeringen rører KUN visningen, så en
// undtagelse herfra ville koste hele synkroniseringen for at redde et
// klokkeslæt, ingen mister et tip på.
describe("refreshKickoffUncertain", () => {
  it("kalder funktionen med sæsonens id og giver tallet videre", async () => {
    const kald = [];
    const sb = async (path, opts) => { kald.push({ path, opts }); return 3; };
    await expect(refreshKickoffUncertain(sb, "s-1")).resolves.toEqual({ marked: 3 });
    expect(kald).toHaveLength(1);
    expect(kald[0].path).toBe("/rest/v1/rpc/refresh_kickoff_uncertain");
    expect(kald[0].opts.method).toBe("POST");
    expect(JSON.parse(kald[0].opts.body)).toEqual({ p_season_id: "s-1" });
  });

  it("bærer fejlen ud i stedet for at kaste", async () => {
    const sb = async () => { throw new Error("Supabase /rest/v1/rpc/...: 404 not found"); };
    const r = await refreshKickoffUncertain(sb, "s-1");
    expect(r.marked).toBe(0);
    expect(r.error).toContain("404");
  });

  it("tæller nul, når funktionen svarer noget, der ikke er et tal", async () => {
    // Sådan ser det ud, hvis migreringen ikke er kørt i produktion endnu og
    // PostgREST svarer tomt: nul markerede, ingen fejl, kørslen går videre.
    const sb = async () => null;
    await expect(refreshKickoffUncertain(sb, "s-1")).resolves.toEqual({ marked: 0 });
  });
});
