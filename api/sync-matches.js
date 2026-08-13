// Server-side funktion (kører på Vercel, ikke i browseren).
// Henter kampe + resultater for den angivne liga fra ligaens datakilde,
// og skriver dem ind i Supabase.
//
// Kald med: /api/sync-matches?leagueId=<vores egen liga-uuid>&smSeason=2026/2027
//
// DATAKILDEN ER LIGAENS, IKKE KODENS. leagues.provider afgør, hvem der spørges
// (se api/_providers/index.js). Superligaen og Scotland Premiership kommer fra
// Sportmonks; Premier League, Champions League, Bundesliga, Serie A og Primera
// División fra football-data.org. Alt nedenfor — holdmatchning, upsert,
// job-logning — er fælles og kender ingen leverandørs feltnavne.
//
// Miljøvariabler der skal være sat i Vercel:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SYNC_SECRET
//   SPORTMONKS_TOKEN      (kræves kun af sportmonks-ligaer)
//   FOOTBALLDATA_TOKEN    (kræves kun af footballdata-ligaer)

import { createSb, isAuthorized, createRunLogger, failJob, isUuid, syncMatchesJob } from "./_shared.js";
import { getProvider, providerToken } from "./_providers/index.js";
import { backfillCompetitionMatches } from "./_backfill.js";

// Er en fejlet sæsonhentning en fejlet KØRSEL?
//
// Næsten altid ja. Det ene undtagelsestilfælde er, at leverandøren endnu ikke
// har oprettet sæsonen: Champions League' ligafase lodtrækkes i slutningen af
// august, så `?season=2026` svarer 404 ved hver eneste kørsel indtil da. Et job,
// der står rødt i seks uger for noget forventeligt, er værre end intet job — det
// lærer én at holde op med at kigge, og så er den NÆSTE røde række også usynlig.
// Den kørsel tælles derfor som gennemført med nul kampe, med forklaringen i
// detaljen.
//
// Kun `season-not-published` slipper igennem. `season-unknown` — et forkert
// api_season_id — skal blive ved med at være rød, fordi den ikke retter sig
// selv, og det samme gælder alt, diagnosen ikke kunne afgøre. Præcis den
// skelnen er hele grunden til, at diagnosen findes.
//
// Ren funktion og eksporteret, fordi reglen er værd at fastholde i en test:
// handleren selv kræver en database og et request-objekt.
export function seasonFetchVerdict(fetchError, emptySeason) {
  if (emptySeason?.code === "season-not-published") return { tolerated: true };
  const why = emptySeason?.message ? ` — ${emptySeason.message}` : "";
  return { tolerated: false, message: `${fetchError?.message ?? String(fetchError)}${why}` };
}

// Holdnavne uden accenter, tegn og store bogstaver. Modulniveau, fordi
// ambiguousTeamNames() bruger PRÆCIS samme normalisering som findByName()
// nedenfor — en kontrol, der normaliserer anderledes end det, den kontrollerer,
// ville melde noget andet end det, der faktisk sker.
//
// ÉN REGEL, ÉN RETNING: alt foldes ned mod GRUNDBOGSTAVET (G52, august 2026).
//
// NFD gjorde det halve i forvejen — den splitter en accent fra sit grundbogstav,
// så "Häcken" bliver til "hacken". Men ø, æ og å er selvstændige tegn uden
// grundbogstav, så de overlevede NFD og blev derefter SLETTET af tegn-filteret:
// "FC København" blev `fckbenhavn`, mens "FC Kobenhavn" blev `fckobenhavn`. To
// skrivemåder af samme klub var dermed to forskellige hold — og fordi navnet er
// fald-tilbagen, når leverandørens id ikke kendes, endte det som en DUBLET i
// `teams` frem for som en fejl, nogen kunne se.
//
// Retningen er ikke et smagsvalg; den følger af NFD. Når "ä" allerede er blevet
// til "a", er den eneste konsistente behandling af den udskrevne form ("ae")
// også "a" — ellers ville "Häcken" og "Haecken" stadig være to hold, og vi ville
// have byttet én halv regel ud med en anden. Derfor foldes både bogstaverne
// (ø→o, æ→a, å→a) og de NORDISKE skrevne former (oe→o, ae→a, aa→a) til det samme.
//
// "ue" er bevidst IKKE med, selvom det er den tyske pendant. Forskellen er, hvad
// tegnfølgen betyder i de navne, vi faktisk har: "aa" og "oe" er stort set altid
// en udskrevet å/ø, mens "ue" er to almindelige bogstaver i det sprog, de fleste
// klubnavne står på — "Queen's Park" ville blive til `quensparkrangers`, altså en
// nøgle, der ikke ligner sit eget hold, når den skal læses i Admin → Drift.
// Prisen er kendt og afgrænset: skriver en leverandør "Muenchen" frem for
// "München", er de to stadig to hold. Selve umlauten er dækket af NFD; kun den
// udskrevne form står tilbage, og den er fastholdt i en test frem for at være
// uskrevet.
//
// Prisen for foldningen er en større flade for FALSKE sammenfald — to
// forskellige klubber, hvis navne kun adskiller sig ved præcis de bogstaver. Den
// betales med åbne øjne: `ambiguousTeamNames()` nedenfor melder netop den slags
// sammenfald i hver eneste kørsel, så en over-foldning kan aflæses i Admin →
// Drift. Den manglende foldning kunne kun ses som en dublet, ingen ledte efter.
export function normalizeTeamName(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Rækkefølgen betyder noget: bogstaverne først, så de skrevne former bagefter
    // fanger både "Koebenhavn" og det "oe", ø netop er blevet til.
    .replace(/ø/g, "o").replace(/æ/g, "ae").replace(/å/g, "aa")
    .replace(/oe/g, "o").replace(/ae/g, "a").replace(/aa/g, "a")
    .replace(/[^a-z0-9]/g, "");
}

// Holdpar, som den fuzzy navnematch ikke kan skelne.
//
// HVORFOR DEN FINDES. findByName() falder tilbage til en DELSTRENGS-match, når
// et api_team_id ikke kendes: `normalize(a).includes(normalize(b))`. Den regel
// er ufarlig i en liga med entydige navne og direkte forkert i en, hvor ét navn
// er indeholdt i et andet — "Rangers" ligger inde i "Queen's Park Rangers", så
// et nyt hold kan blive knyttet til et eksisterende holds række. Følgen er ikke
// en fejl nogen ser: kampene lander bare på det forkerte hold.
//
// `B2` bad om, at holdene blev kontrolleret for dubletter, EFTER Scotland
// Premiership var synkroniseret første gang, og indbakken bad om den samme
// kontrol for Champions League efter lodtrækningen. Begge er engangs-tjek, som
// et menneske skal huske på det rigtige tidspunkt. Her er de i stedet en
// permanent del af hver kørsel: parrene lander i `detail` og kan aflæses i
// Admin → Drift, uanset hvornår turneringen får sine hold.
//
// Kontrollen ADVARER og blokerer ikke. En ægte navnelighed (to klubber i samme
// by) er lovlig, og en sync, der nægtede at køre på den, ville være værre end
// den tvetydighed, den advarer om.
//
// GODKENDTE PAR (`A26`, 10. august 2026). Præcis dét — at en ægte navnelighed er
// lovlig — kostede kontrollen dens egen egenskab. `ambiguousTeams` var bygget på
// *"kun til stede, når der ER noget at kigge på"*, og for Scotland Premiership
// var feltet permanent tændt med `Dundee`/`Dundee United`, som blev afgjort som
// en ægte navnelighed 2. august 2026. Et felt, der altid er der, holder man op
// med at læse — og så er kontrollen reelt væk netop den dag, turnering #8
// tilføjer et par, ingen har set før.
//
// Listen nedenfor er derfor de par, der ER set på og afgjort. De filtreres ud af
// `nye`, så feltet igen kun melder det, der ikke er afgjort. Prisen er en liste,
// der skal vedligeholdes pr. turnering — og den betales ét sted: her, med en
// begrundelse og en dato pr. række, så en godkendelse kan efterprøves i stedet
// for at være et navn, nogen engang skrev.
//
// Nøglen er de NORMALISEREDE navne og ikke de skrevne, så kasse, mellemrum og
// tegnsætning ikke kan lade en godkendelse udløbe ved et kosmetisk skift hos
// leverandøren. Et TILFØJET ord ("Dundee" → "Dundee FC") bortfalder derimod, og
// det er med vilje: et hold, der skifter navn, er præcis den situation, hvor den
// fuzzy match kan begynde at ramme forkert. Fejlen peger da mod alarmen frem for
// mod tavshed, og listen rettes i hånden, når parret er set efter igen.
export const GODKENDTE_HOLDPAR = [
  {
    teams: ["Dundee", "Dundee United"],
    why: "to virkelige klubber i samme by, begge i Scotland Premiership",
    godkendt: "2026-08-02",
  },
];

const godkendtNøgle = (a, b) => [a, b].sort().join("|");
const GODKENDTE_NØGLER = new Set(
  GODKENDTE_HOLDPAR.map((p) => godkendtNøgle(normalizeTeamName(p.teams[0]), normalizeTeamName(p.teams[1]))),
);

// Returnerer `{ nye, kendte }` og ikke én liste, fordi de to skal læses
// forskelligt: `nye` er alarmen, `kendte` er kvitteringen for, at filteret
// faktisk bed. Uden den anden ville en forkert linje i listen kunne sluge et
// ægte fund i tavshed — og en linje, hvis to klubber ikke længere er i
// turneringen, ville blive stående for evigt uden at nogen kunne se det. Er
// `kendte` tom for en turnering, der plejede at melde et par, er listen
// forældet, og dét kan aflæses i Admin → Drift på samme kort.
export function ambiguousTeamNames(teams) {
  const rows = (teams || []).map((t) => ({ name: t.name, key: normalizeTeamName(t.name) })).filter((t) => t.key);
  const nye = [], kendte = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      let par = null;
      if (a.key === b.key) par = { teams: [a.name, b.name], why: "identiske navne" };
      else if (a.key.includes(b.key) || b.key.includes(a.key)) par = { teams: [a.name, b.name], why: "det ene navn ligger inde i det andet" };
      if (!par) continue;
      (GODKENDTE_NØGLER.has(godkendtNøgle(a.key, b.key)) ? kendte : nye).push(par);
    }
  }
  return { nye, kendte };
}

// Én normaliseret kamp → én række i `matches`, klar til upserten.
//
// Ligger på modulniveau og ikke inde i løkken, fordi det er den ENESTE måde,
// rækkens form kan testes på (G56, august 2026): handleren kan ikke nås uden et
// HTTP-mock-apparat, filen ikke har, så indtil nu var der ingen test på, at fx
// `kickoff_tbd` overhovedet kom med i skrivningen. Feltet afgør, hvornår kampen
// låser — det beregnes i providerne og bruges af tre andre steder (klientens
// `lockAtOf`, RLS-policyerne og efterfyldningens regel 3) — og alle tre er
// afhængige af, at netop denne linje findes.
//
// `finished` afgør, om score må skrives: hele appen læser "home_score is not
// null" som "kampen er spillet", så en LIVE-stilling i den kolonne ville udløse
// point midt i en kamp.
export function matchUpsertRow(fx, { seasonId, homeTeamId, awayTeamId }) {
  const finished = fx.status === "finished";
  return {
    season_id: seasonId,
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
    kickoff_at: fx.kickoffAt,
    kickoff_tbd: !!fx.kickoffTbd,
    home_score: finished ? fx.score.home : null,
    away_score: finished ? fx.score.away : null,
    status: finished ? "finished" : "scheduled",
    stage_name: fx.stageName,
    api_fixture_id: fx.globalId,
  };
}

// Markér de kampe, hvis klokkeslæt sandsynligvis er leverandørens gæt (G85).
//
// Reglen bor i `public.refresh_kickoff_uncertain()` og ikke her, fordi den er en
// aggregering over hele sæsonens rækker: den lærer turneringens pladsholder-
// klokkeslæt af de tider, der HAR flyttet sig (`matches.kickoff_prev_at`, sat af
// en trigger), og markerer de øvrige kampe på samme klokkeslæt. Hele
// begrundelsen — hvorfor gulvet er tre, hvorfor UTC, og hvorfor markøren ikke er
// `kickoff_tbd` — står i filhovedet i sql/matches_kickoff_uncertain.sql.
//
// KASTER ALDRIG VIDERE, samme regel som readSeasonMeta() og efterfyldningen: en
// sync, der har hentet kampene rigtigt, må ikke fejle på en markering, der kun
// rører visningen. Fejlen bæres i stedet ud i `detail`, så en markering, der
// tavst holder op med at virke, kan ses i Admin → Drift frem for kun i Vercels
// logs.
//
// Tallet er, hvor mange kampes markør der SKIFTEDE — ikke hvor mange der er
// markeret. Nul ved de første kørsler er den forventede tilstand og ikke en
// fejl: reglen kan først svare, når en tid har flyttet sig mellem to kørsler.
export async function refreshKickoffUncertain(sb, seasonId) {
  try {
    const n = await sb(`/rest/v1/rpc/refresh_kickoff_uncertain`, {
      method: "POST",
      body: JSON.stringify({ p_season_id: seasonId }),
    });
    return { marked: Number.isFinite(n) ? n : 0 };
  } catch (e) {
    console.warn(`[ubekræftede klokkeslæt] ${e.message}`);
    return { marked: 0, error: e.message };
  }
}

// Sæsonens slutning fra datakilden — best effort.
//
// Metoden er VALGFRI i provider-kontrakten (api/_providers/index.js), og et
// opslag, der fejler, må ikke gøre en ellers vellykket kørsel til en fejl:
// uden svar falder `competition_status` blot tilbage på sin 30-dages ventil.
// Fejlen logges, så en leverandør, der holder op med at svare, kan ses i
// Vercels logs frem for kun i en gate, der pludselig aldrig åbner.
export async function readSeasonMeta(provider, { apiLeagueId, apiSeasonId, token, meta }) {
  if (typeof provider.fetchSeasonMeta !== "function") return null;
  try {
    return await provider.fetchSeasonMeta({ apiLeagueId, apiSeasonId, token, meta });
  } catch (e) {
    console.warn(`[sæson-meta] ${provider.key}: ${e.message}`);
    return null;
  }
}

export default async function handler(req, res) {
  // Sættes så snart autorisationen er i hus. Ligger uden for try'et, fordi
  // catch'en skal kunne bruge den — en kørsel, der vælter, er netop den, der
  // skal ende i job_runs.
  let run = null;
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SYNC_SECRET = process.env.SYNC_SECRET;

    // Bemærk hvad der IKKE tjekkes her længere: API-nøglen. Med to leverandører
    // ville et krav om SPORTMONKS_TOKEN blokere en football-data-liga, der
    // aldrig bruger den. Nøglen hentes af providerToken() først, når vi ved
    // hvilken datakilde ligaen har — og fejler lige så tydeligt dér.
    // Svaret navngiver IKKE variablerne (G38). Tjekket ligger nødvendigvis FØR
    // autorisationen — uden dem kan vi ikke engang slå kalderen op — så teksten
    // ville ellers kortlægge backendens opsætning for enhver uautentificeret
    // kaldende. Navnene er ikke hemmelige, men de er gratis rekognoscering, og
    // de hører hjemme dér, hvor kun vi kan læse dem: i Vercels logs.
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error("[opsætning] SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY mangler i miljøet.");
      return res.status(500).json({ error: "Serveren er ikke sat rigtigt op." });
    }

    const sb = createSb(SUPABASE_URL, SERVICE_KEY);

    // ---- autorisation: enten en admin-brugers login, eller den delte hemmelige nøgle (til ekstern cron) ----
    // Reglerne bor i api/_shared.js, så de er ens for alle tre job-endpoints.
    const auth = await isAuthorized(req, {
      sb,
      supabaseUrl: SUPABASE_URL,
      serviceKey: SERVICE_KEY,
      syncSecret: SYNC_SECRET,
    });
    if (!auth.ok) {
      return res.status(401).json({ error: "Ikke autoriseret" });
    }

    const leagueId = req.query.leagueId;
    // Ingen hårdkodet fallback. Tidligere stod her `|| "2026/2027"`, hvilket
    // betød, at et job uden &smSeason= tavst ledte efter en sæson, der måske
    // slet ikke var den rigtige for ligaen. Navnet bruges kun, når ligaen
    // endnu ikke har et gemt api_season_id — så fejler vi hellere tydeligt
    // dér end at gætte. (Flagget i docs/features/turnering-2.md §3.2.)
    const seasonNameOverride = req.query.smSeason || null;
    const dryRun = req.query.dryRun === "true";
    run = createRunLogger(sb, "sync-matches", { skip: dryRun });
    // A11: hvilken vej autorisationen kom ind, ned i driftsloggen — se setAuth().
    run.setAuth(auth.via);
    // A46: hvilket værtsnavn jobbet kaldte ind på — se setHost().
    run.setHost(req);
    // Et job uden leagueId er et forkert opsat cron-job, ikke en tilfældig fejl —
    // derfor tælles det som en fejlet kørsel, så det dukker op i fejlserien.
    if (!leagueId) return run.fail(res, 400, { error: "Mangler leagueId query-parameter" }, "Mangler leagueId query-parameter");
    // Formatet tjekkes, FØR værdien interpoleres i en service-role-URL (G18).
    // Et forkert format er altid en fejl — kolonnen er en uuid — så afvisningen
    // koster ingen gyldige kald, og der er dermed intet at escape længere nede.
    if (!isUuid(leagueId)) return run.fail(res, 400, { error: "leagueId er ikke et gyldigt UUID" }, `leagueId er ikke et gyldigt UUID: ${String(leagueId).slice(0, 100)}`);
    // Fra og med her har kørslen en turnering at høre til (G44). Navnet sættes
    // FØR liga-opslaget og ikke efter: peger jobbet på en liga, der ikke findes,
    // er det netop den slags fejl, der skal kunne spores til ét bestemt job —
    // og med det fælles navn ville den have været usynlig bag de seks andre.
    run.rename(syncMatchesJob(leagueId));

    // find ligaen i vores egen database (giver os navn, datakilde + dens liga-id)
    //
    // `select=*` og ikke en kolonneliste med `provider`: koden deployes
    // automatisk ved push, mens sql/multi_provider.sql køres manuelt bagefter.
    // En navngiven kolonne, der endnu ikke findes, får PostgREST til at svare
    // 400 — altså ville syncen være nede i vinduet mellem deploy og migrering.
    // Med `*` mangler feltet bare, og getProvider(undefined) falder tilbage til
    // sportmonks, hvilket er præcis den verden, migreringen endnu ikke har
    // ændret. Tabellen har én række pr. turnering, så bredden koster intet.
    const leagueRows = await sb(`/rest/v1/leagues?id=eq.${leagueId}&select=*`);
    if (!leagueRows.length) throw new Error("Ligaen findes ikke i databasen");
    const dbLeague = leagueRows[0];
    const provider = getProvider(dbLeague.provider);
    if (!dbLeague.api_league_id) throw new Error(`Ligaen '${dbLeague.name}' har intet liga-id (api_league_id) sat hos ${provider.label}`);
    const token = providerToken(provider);
    const apiLeagueId = dbLeague.api_league_id;

    // Leverandørens eget regnskab over forbruget, udfyldt undervejs af
    // provideren og lagt i kørslens resumé nedenfor (A15). Objektet er tomt,
    // hvis datakilden ikke rapporterer noget — kun Sportmonks gør i dag.
    const providerMeta = {};

    const seasons = await sb(`/rest/v1/seasons?league_id=eq.${leagueId}&select=id,name,api_season_id&order=start_date.desc&limit=1`);
    if (!seasons.length) throw new Error("Sæson ikke fundet i databasen for denne liga");
    const seasonId = seasons[0].id;

    const teams = await sb(`/rest/v1/teams?league_id=eq.${leagueId}&select=id,name,api_team_id`);

    const normalize = normalizeTeamName;
    function findByName(providerName) {
      const n = normalize(providerName);
      return teams.find((t) => normalize(t.name) === n)
        || teams.find((t) => normalize(t.name).includes(n) || n.includes(normalize(t.name)));
    }

    // Leverandørens sæson-id: brug det gemte, hvis vi har det — ellers slå det
    // op ud fra sæsonnavnet (fx "2026/2027") og gem det på vores season-række,
    // så fremtidige kørsler (og sæsonskift) ikke afhænger af navne-opslag.
    let apiSeasonId = seasons[0].api_season_id;
    if (!apiSeasonId) {
      const seasonName = seasonNameOverride;
      if (!seasonName) {
        throw new Error(
          `Ligaen '${dbLeague.name}' har intet gemt api_season_id, og der er ikke angivet &smSeason=. ` +
          `Kald med fx &smSeason=2026/2027 én gang — id'et gemmes derefter på sæson-rækken.`
        );
      }
      apiSeasonId = await provider.resolveSeasonId({ apiLeagueId, seasonName, token, meta: providerMeta });
      await sb(`/rest/v1/seasons?id=eq.${seasonId}`, {
        method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ api_season_id: String(apiSeasonId) }),
      });
    }

    // Sæsonopslaget er tvetydigt på TO måder, og begge betyder det samme for
    // den, der kigger: turneringen henter ingen kampe, og man kan ikke se, om
    // det er en fejl. Enten er kampprogrammet ikke offentliggjort endnu, eller
    // også peger api_season_id et sted hen, leverandøren ikke kender — kun den
    // ene retter sig selv. Det var dét, der efterlod `B8` uafgjort.
    //
    // De to udgange ser forskellige ud i HTTP og er lige uigennemsigtige:
    //   · 200 med tom liste → `totalFixtures: 0`, som ikke siger hvorfor
    //   · 404               → "The resource you are looking for does not exist",
    //                         som heller ikke siger hvorfor
    // Første udgave af diagnosen dækkede kun den første — og det var den anden,
    // Champions League faktisk gav. Derfor spørges datakilden i BEGGE tilfælde.
    let fixtures = null;
    let fetchError = null;
    try {
      fixtures = await provider.fetchSeasonFixtures({ apiLeagueId, apiSeasonId, token, meta: providerMeta });
    } catch (e) {
      fetchError = e;
    }

    // Diagnosen må ALDRIG kunne vælte en kørsel, der ellers gik godt: en tom
    // sæson er i sig selv en gyldig kørsel, og et ekstra opslag, der fejler
    // (429, nedetid), skal ikke gøre den til en fejl. Derfor fanges alt og
    // gemmes som tekst.
    let emptySeason = null;
    if ((fetchError || !fixtures.length) && provider.describeEmptySeason) {
      try {
        emptySeason = await provider.describeEmptySeason({ apiLeagueId, apiSeasonId, token });
      } catch (e) {
        emptySeason = { code: "lookup-failed", message: e?.message ?? String(e) };
      }
    }

    if (fetchError) {
      const verdict = seasonFetchVerdict(fetchError, emptySeason);
      if (!verdict.tolerated) throw new Error(verdict.message, { cause: fetchError });
      fixtures = [];
    }

    if (dryRun) {
      const sample = fixtures.slice(0, 15).map((fx) => ({
        kickoff: fx.kickoffAt,
        // Med i forhåndsvisningen, fordi det er her man aflæser, om en runde
        // står uden fastsatte klokkeslæt — og hvilken markør leverandøren brugte.
        kickoffTbd: fx.kickoffTbd,
        state: fx.liveState,
        stage: fx.stageName,
        home: fx.home?.name ?? null,
        away: fx.away?.name ?? null,
        // Samme regel som i det rigtige skriv: en stilling er først et resultat,
        // når kampen er slut. Ellers ville forhåndsvisningen vise noget andet,
        // end kørslen faktisk skriver.
        home_score: fx.status === "finished" ? fx.score.home : null,
        away_score: fx.status === "finished" ? fx.score.away : null,
      }));
      return res.status(200).json({
        dryRun: true,
        note: "Intet er skrevet til databasen — dette er kun en forhåndsvisning.",
        provider: provider.key,
        totalFixtures: fixtures.length,
        ...(emptySeason ? { emptySeason } : {}),
        sample,
      });
    }

    // ---- auto-opdag og opret hold ud fra kampenes deltagere ----
    // Nøglen er holdets GLOBALE id (leverandørpræfikset), fordi det er den
    // værdi, der står i teams.api_team_id.
    const providerTeams = new Map();
    for (const fx of fixtures) {
      for (const t of [fx.home, fx.away]) {
        if (t) providerTeams.set(t.globalId, t.name);
      }
    }

    const newTeams = [];
    const linkUpdates = [];
    const globalIdToOurId = new Map();

    for (const [globalId, name] of providerTeams) {
      const byApiId = teams.find((t) => t.api_team_id === globalId);
      if (byApiId) { globalIdToOurId.set(globalId, byApiId.id); continue; }

      const byName = findByName(name);
      if (byName) {
        globalIdToOurId.set(globalId, byName.id);
        if (byName.api_team_id !== globalId) linkUpdates.push({ id: byName.id, api_team_id: globalId });
        continue;
      }

      newTeams.push({ league_id: leagueId, name, api_team_id: globalId });
    }

    if (newTeams.length) {
      const inserted = await sb(`/rest/v1/teams`, {
        method: "POST", prefer: "return=representation", body: JSON.stringify(newTeams),
      });
      // Nøglen læses som TEKST tilbage. Stod før som Number(row.api_team_id),
      // hvilket kun virkede, fordi Sportmonks-id'er er tal — et præfikset
      // football-data-id ville være blevet til NaN, og hver eneste kamp i
      // turneringen ville have manglet sine hold.
      for (const row of inserted) globalIdToOurId.set(String(row.api_team_id), row.id);
    }
    for (const upd of linkUpdates) {
      await sb(`/rest/v1/teams?id=eq.${upd.id}`, {
        method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ api_team_id: upd.api_team_id }),
      });
    }

    // Kontrollen kører på turneringens FULDE holdliste efter kørslen — de
    // eksisterende plus dem, denne kørsel lige oprettede. Det er den liste,
    // NÆSTE kørsels findByName() vil slå op i, og dermed den, tvetydigheden
    // ville ramme. Se ambiguousTeamNames() ovenfor for hvorfor den findes.
    const tvetydigeHold = ambiguousTeamNames([...teams, ...newTeams]);

    let toUpsert = [];
    const unmatched = new Set();
    let undrawn = 0;

    for (const fx of fixtures) {
      // Kampe uden begge hold. Hos Sportmonks er det en datafejl; i Champions
      // League er det normalt — knockout-kampene findes i kampprogrammet, før
      // lodtrækningen er foretaget, og har da ingen hold endnu. De kommer med,
      // så snart de er trukket, ved næste kørsel.
      if (!fx.home || !fx.away) { undrawn++; continue; }

      const homeTeamId = globalIdToOurId.get(fx.home.globalId);
      const awayTeamId = globalIdToOurId.get(fx.away.globalId);
      if (!homeTeamId || !awayTeamId) {
        unmatched.add(`${fx.home.name} vs ${fx.away.name}`);
        continue;
      }

      toUpsert.push(matchUpsertRow(fx, { seasonId, homeTeamId, awayTeamId }));
    }

    if (toUpsert.length) {
      await sb(`/rest/v1/matches?on_conflict=api_fixture_id`, {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: JSON.stringify(toUpsert),
      });
    }

    // Ubekræftede klokkeslæt (G85). SKAL ligge efter upserten: det er dér,
    // triggeren har set, hvilke tider der flyttede sig i denne kørsel, og det er
    // netop de flytninger, reglen lærer af. Kaldes også når `toUpsert` er tom —
    // en kørsel uden kampe kan stadig have en markering, der skal ryddes, fordi
    // en kamp er blevet spillet siden sidst.
    const uncertain = await refreshKickoffUncertain(sb, seasonId);

    // Sæsonens slutning, som datakilden ser den (`seasons.ends_at`/`is_finished`).
    //
    // Det er dét, der holder `competition_status` fra at erklære en konkurrence
    // slut midt i sin egen sæson: "alle kendte kampe er spillet" er sandt hver
    // gang et grundspil slutter, og næste stage endnu ikke er udgivet. Reglen og
    // dens tre veje står i sql/season_end.sql.
    //
    // Kaster ALDRIG videre — samme regel som efterfyldningen nedenfor. En sync,
    // der har hentet kampene rigtigt, må ikke fejle på et metadata-opslag; uden
    // det falder viewet blot tilbage på sin 30-dages ventil.
    //
    // `is_finished` sættes kun TIL true. At åbne en lukket sæson igen er en
    // beslutning, ikke en bivirkning af en kørsel — den tages i Admin → Drift.
    const seasonMeta = dryRun ? null : await readSeasonMeta(provider, { apiLeagueId, apiSeasonId, token, meta: providerMeta });
    if (seasonMeta && (seasonMeta.endsAt || seasonMeta.finished)) {
      const patch = {};
      if (seasonMeta.endsAt) patch.ends_at = seasonMeta.endsAt;
      if (seasonMeta.finished) patch.is_finished = true;
      try {
        await sb(`/rest/v1/seasons?id=eq.${seasonId}`, {
          method: "PATCH", prefer: "return=minimal", body: JSON.stringify(patch),
        });
      } catch (e) {
        console.warn("[sæson-meta] kunne ikke gemmes:", e.message);
      }
    }

    // Efterfyld eksisterende konkurrencer med de kampe, der er kommet til siden
    // de blev oprettet (A20). Skal ligge EFTER upserten — det er først dér, de
    // nye kampe har fået et id. Reglerne og hvorfor de er, som de er, står i
    // api/_backfill.js; den kaster aldrig, så en fejl her kan ikke vælte en sync,
    // der ellers gik godt.
    const backfill = dryRun ? { added: 0, competitions: 0 } : await backfillCompetitionMatches(sb, seasonId);

    // run.ok og ikke res.json: en vellykket kørsel SKAL skrive sin række i
    // job_runs. Stod her tidligere som et bart res.status(200).json(), hvilket
    // betød, at kun fejlende kørsler blev logget — Admin → Drift kunne aldrig
    // vise en grøn sync-matches-kørsel, og job-heartbeat.yml ville melde
    // "INGEN KOERSLER" for jobbet, uanset hvor fint det kørte. Detaljerne
    // (synced/totalFixtures/teamsCreated/unmatched) er samtidig det, der gør en
    // tavs delvis fejl synlig: en kørsel kan svare 200 og have hentet 0 kampe.
    return run.ok(res, {
      provider: provider.key,
      synced: toUpsert.length,
      totalFixtures: fixtures.length,
      teamsCreated: newTeams.length,
      // Leverandørens eget forbrugstal, når den rapporterer et (A15).
      ...(providerMeta.rateLimit ? { rateLimit: providerMeta.rateLimit } : {}),
      // Kun til stede, når der ER noget at kigge på: et felt, der står tomt ved
      // hver kørsel, holder man op med at læse. Se ambiguousTeamNames().
      // Efter `A26` gælder det igen for Scotland: de par, der ER afgjort, står i
      // GODKENDTE_HOLDPAR og tælles i `ambiguousKnown` frem for at fylde her.
      ...(tvetydigeHold.nye.length ? { ambiguousTeams: tvetydigeHold.nye } : {}),
      // Kvitteringen for filteret — et TAL og ikke en liste, fordi det ikke er
      // noget at handle på. Står det stille, virker godkendelsen; forsvinder det
      // for en turnering, der plejede at have det, er linjen i listen forældet.
      ...(tvetydigeHold.kendte.length ? { ambiguousKnown: tvetydigeHold.kendte.length } : {}),
      // Ikke en fejl, men skal kunne aflæses: står tallet stille hen over en
      // CL-lodtrækning, henter syncen ikke de nye kampe.
      undrawn,
      // Kun til stede, når sæsonen kom tom hjem — og så er det netop det felt,
      // der siger, om tomheden er ufarlig eller en fejlkonfiguration.
      ...(emptySeason ? { emptySeason } : {}),
      // Sæsonens slutning, som den blev aflæst. Hører i detail'en, fordi den
      // afgør, hvornår konkurrencer må meldes færdige — og fordi et felt, der
      // pludselig står tomt, er den eneste måde at se, at leverandøren holdt op
      // med at svare på spørgsmålet.
      ...(seasonMeta ? { season: seasonMeta } : {}),
      // A20: hvor mange kampe der blev føjet til eksisterende konkurrencer.
      // Hører i detail'en af samme grund som de øvrige tal — en efterfyldning,
      // der tavst holder op med at virke, ville ellers først vise sig som en
      // konkurrence, der manglede sit slutspil.
      backfilled: backfill.added,
      backfilledCompetitions: backfill.competitions,
      ...(backfill.error ? { backfillError: backfill.error } : {}),
      // G85: hvor mange kampes "klokkeslættet er ikke bekræftet"-markør der
      // skiftede. Hører i detail'en af samme grund som `backfilled` — reglen
      // rører kun visningen og ville ellers kunne holde op med at virke, uden at
      // nogen kunne se det andre steder end på en forkert tid i appen.
      uncertainMarked: uncertain.marked,
      ...(uncertain.error ? { uncertainError: uncertain.error } : {}),
      unmatched: [...unmatched],
    });
  } catch (e) {
    return failJob(run, res, e, "sync-matches");
  }
}
