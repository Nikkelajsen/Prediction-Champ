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
import { seasonFetchVerdict, ambiguousTeamNames, GODKENDTE_HOLDPAR, normalizeTeamName, matchUpsertRow, planTeamWrites, readSeasonMeta } from "./sync-matches.js";

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
    expect(ambiguousTeamNames(hold("Celtic", "Aberdeen", "Hibernian"))).toEqual({ nye: [], kendte: [] });
  });

  // Den ægte skotske fælde: findByName() falder tilbage til en delstrengs-match,
  // så et nyt "Rangers" kan blive knyttet til "Queen's Park Rangers"' række.
  it("fanger et navn, der ligger inde i et andet", () => {
    const ud = ambiguousTeamNames(hold("Rangers", "Queen's Park Rangers"));
    expect(ud.nye).toHaveLength(1);
    expect(ud.nye[0].teams).toEqual(["Rangers", "Queen's Park Rangers"]);
  });

  // To rækker for samme klub — det, dubletkontrollen hed i drejebogen.
  it("fanger to rækker, der normaliserer til det samme", () => {
    const ud = ambiguousTeamNames(hold("Celtic FC", "Celtic F.C."));
    expect(ud.nye).toHaveLength(1);
    expect(ud.nye[0].why).toBe("identiske navne");
  });

  it("tåler tomme og manglende navne", () => {
    expect(ambiguousTeamNames([])).toEqual({ nye: [], kendte: [] });
    expect(ambiguousTeamNames(undefined)).toEqual({ nye: [], kendte: [] });
    expect(ambiguousTeamNames([{ name: null }, { name: "" }, { name: "Celtic" }])).toEqual({ nye: [], kendte: [] });
  });

  // A26: det par, der gjorde feltet permanent tændt for Scotland. Det skal ud af
  // alarmen — og med i kvitteringen, så filteret ikke er usynligt.
  it("flytter et godkendt par fra nye til kendte", () => {
    const ud = ambiguousTeamNames(hold("Dundee", "Dundee United", "Celtic"));
    expect(ud.nye).toEqual([]);
    expect(ud.kendte).toHaveLength(1);
    expect(ud.kendte[0].teams).toEqual(["Dundee", "Dundee United"]);
  });

  // Godkendelsen er hele grunden til, at den næste tvetydighed kan ses. Melder
  // kørslen både et godkendt og et nyt par, må kun det nye stå i alarmen.
  it("melder stadig et nyt par i samme turnering som et godkendt", () => {
    const ud = ambiguousTeamNames(hold("Dundee", "Dundee United", "Rangers", "Queen's Park Rangers"));
    expect(ud.nye).toHaveLength(1);
    expect(ud.nye[0].teams).toEqual(["Rangers", "Queen's Park Rangers"]);
    expect(ud.kendte).toHaveLength(1);
  });

  // Nøglen er de NORMALISEREDE navne, så kasse, mellemrum og tegnsætning ikke
  // kan lade godkendelsen udløbe ved et kosmetisk skift hos leverandøren.
  it("holder godkendelsen på tværs af kasse og tegnsætning", () => {
    const ud = ambiguousTeamNames(hold("  DUNDEE  ", "Dundee-United"));
    expect(ud.nye).toEqual([]);
    expect(ud.kendte).toHaveLength(1);
  });

  // Men et TILFØJET ord er ikke kosmetik, og godkendelsen bortfalder — med
  // vilje. Fejlretningen peger da mod alarmen og ikke mod tavshed: et hold, der
  // skifter navn, er præcis den situation, hvor den fuzzy match kan begynde at
  // ramme forkert, og listen skal opdateres i hånden, når det er set efter.
  it("lader godkendelsen bortfalde, når et navn får et ord mere", () => {
    const ud = ambiguousTeamNames(hold("Dundee", "Dundee United FC"));
    expect(ud.nye).toHaveLength(1);
    expect(ud.kendte).toEqual([]);
  });

  // En godkendelse gælder ét PAR og ikke et navn: et tredje hold, der ligner
  // det ene af dem, er ikke afgjort af noget.
  it("godkender ikke et nyt par, bare fordi det ene navn står på listen", () => {
    const ud = ambiguousTeamNames(hold("Dundee", "Dundee Athletic"));
    expect(ud.nye).toHaveLength(1);
    expect(ud.kendte).toEqual([]);
  });
});

// Listen er den ene ting i kontrollen, et menneske vedligeholder, så den skal
// kunne læses af den, der tilføjer turnering #8: to navne, en begrundelse og en
// dato. En række uden dem er en godkendelse, ingen kan efterprøve.
describe("GODKENDTE_HOLDPAR", () => {
  it("har to navne, en begrundelse og en dato på hver række", () => {
    for (const par of GODKENDTE_HOLDPAR) {
      expect(par.teams).toHaveLength(2);
      expect(par.teams.every((n) => typeof n === "string" && n.trim())).toBe(true);
      expect(par.why).toBeTruthy();
      expect(par.godkendt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  // Et par, der ikke er tvetydigt, hører ikke til på en liste over godkendte
  // tvetydigheder — så er det enten en tastefejl eller en regel, der har flyttet
  // sig under listen.
  it("indeholder kun par, kontrollen faktisk ville melde", () => {
    for (const par of GODKENDTE_HOLDPAR) {
      const ud = ambiguousTeamNames(par.teams.map((name) => ({ name })));
      expect([...ud.nye, ...ud.kendte]).toHaveLength(1);
    }
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

// Samme snit som matchUpsertRow, den anden skrivning: hvilke hold oprettes,
// og hvilke rækker patches. Udskilt sammen med B39, hvor `short_name` kom til —
// og hvor guarden `harShortName` er dét, der holder syncen oppe i vinduet
// mellem deploy og `#72 teams_short_name.sql`.
describe("planTeamWrites", () => {
  const LIGA = "L1";
  const rk = (over = {}) => ({ id: "T1", name: "Real Racing Club de Santander", api_team_id: "fd:87", short_name: null, ...over });
  const pt = (entries) => new Map(entries);

  it("matcher uændret: id først, så normaliseret navn — og opretter resten", () => {
    const teams = [rk(), rk({ id: "T2", name: "Valencia CF", api_team_id: null })];
    const { newTeams, patches, globalIdToOurId } = planTeamWrites({
      teams, leagueId: LIGA, harShortName: false,
      providerTeams: pt([
        ["fd:87", { name: "Racing Santander", shortName: "Santander" }],   // via api_team_id
        ["fd:95", { name: "Valencia CF", shortName: "Valencia" }],         // via navn → id-link patches
        ["fd:81", { name: "FC Barcelona", shortName: "Barça" }],           // ny
      ]),
    });
    expect(globalIdToOurId.get("fd:87")).toBe("T1");
    expect(globalIdToOurId.get("fd:95")).toBe("T2");
    expect(patches.get("T2")).toEqual({ api_team_id: "fd:95" });
    expect(newTeams).toEqual([{ league_id: LIGA, name: "FC Barcelona", api_team_id: "fd:81" }]);
  });

  // Guardens hele pointe: før #72 er kørt, må INGEN skrivning nævne kolonnen —
  // hverken en insert eller en patch — ellers svarer PostgREST 400, og syncen
  // er nede, til migreringen er kørt.
  it("nævner aldrig short_name, når kolonnen ikke findes", () => {
    const { newTeams, patches } = planTeamWrites({
      teams: [rk()], leagueId: LIGA, harShortName: false,
      providerTeams: pt([
        ["fd:87", { name: "Real Racing Club de Santander", shortName: "Santander" }],
        ["fd:81", { name: "FC Barcelona", shortName: "Barça" }],
      ]),
    });
    expect(newTeams.every((t) => !("short_name" in t))).toBe(true);
    expect(patches.size).toBe(0);
  });

  it("patcher det korte navn på en eksisterende række — men kun når det afviger", () => {
    const teams = [rk(), rk({ id: "T2", name: "Valencia CF", api_team_id: "fd:95", short_name: "Valencia" })];
    const { patches } = planTeamWrites({
      teams, leagueId: LIGA, harShortName: true,
      providerTeams: pt([
        ["fd:87", { name: "Real Racing Club de Santander", shortName: "Santander" }],
        ["fd:95", { name: "Valencia CF", shortName: "Valencia" }],   // allerede rigtig → intet
      ]),
    });
    expect(patches.get("T1")).toEqual({ short_name: "Santander" });
    expect(patches.has("T2")).toBe(false);
  });

  // Sportmonks sender null (badge-formatet er ikke et visningsnavn), og en
  // leverandør, der HOLDER OP med at sende feltet, må ikke slette det, vi har.
  it("nulstiller aldrig et gemt kort navn", () => {
    const teams = [rk({ short_name: "Santander" })];
    const { patches } = planTeamWrites({
      teams, leagueId: LIGA, harShortName: true,
      providerTeams: pt([["fd:87", { name: "Real Racing Club de Santander", shortName: null }]]),
    });
    expect(patches.size).toBe(0);
  });

  it("lægger id-link og kort navn i ÉN patch, når begge mangler", () => {
    const teams = [rk({ api_team_id: null })];
    const { patches } = planTeamWrites({
      teams, leagueId: LIGA, harShortName: true,
      providerTeams: pt([["fd:87", { name: "Real Racing Club de Santander", shortName: "Santander" }]]),
    });
    expect(patches.get("T1")).toEqual({ api_team_id: "fd:87", short_name: "Santander" });
  });

  // PostgREST kræver ens nøgler i en bulk-insert, så feltet skal med på HVER ny
  // række — som null, når leverandøren intet kort navn har.
  it("giver nye rækker ens nøgler: short_name er med, også som null", () => {
    const { newTeams } = planTeamWrites({
      teams: [], leagueId: LIGA, harShortName: true,
      providerTeams: pt([
        ["fd:81", { name: "FC Barcelona", shortName: "Barça" }],
        ["293", { name: "FC København", shortName: null }],
      ]),
    });
    expect(newTeams).toEqual([
      { league_id: LIGA, name: "FC Barcelona", api_team_id: "fd:81", short_name: "Barça" },
      { league_id: LIGA, name: "FC København", api_team_id: "293", short_name: null },
    ]);
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
