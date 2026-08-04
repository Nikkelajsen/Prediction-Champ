// Datakilde: Sportmonks (api.sportmonks.com/v3/football).
//
// Koden her er FLYTTET, ikke nyskrevet: den kommer ordret fra api/sync-matches.js
// (sæsonopslag, paginering, score-udtræk) og api/sync-live.js (multi-opslag,
// state-tolkning, spilleminut). Den eneste tilføjelse er normalize(), som
// oversætter Sportmonks' felter til den fælles form, begge endpoints nu taler.
//
// Nøglen sendes som query-parameter (`&api_token=`), hvilket er Sportmonks' egen
// konvention — modsat football-data.org, der bruger en header.
//
// Miljøvariabel: SPORTMONKS_TOKEN

import { fetchWithTimeout } from "../_shared.js";

const BASE = "https://api.sportmonks.com/v3/football";

// Afslutnings-states. Stod før to steder (sync-matches.js:135 og sync-live.js:34)
// med en kommentar om, at de skulle holdes ens — nu er de ét sted.
const FINISHED_STATES = ["FT", "AET", "FT_PEN"];

// States hvor kampen er i gang (inkl. pauser undervejs).
const LIVE_STATES = new Set([
  "INPLAY_1ST_HALF", "INPLAY_2ND_HALF", "HT", "BREAK",
  "INPLAY_ET", "INPLAY_ET_2ND_HALF", "EXTRA_TIME_BREAK",
  "PEN_BREAK", "INPLAY_PENALTIES", "PENALTIES",
]);

// Sikkerhedsnet mod en uendelig løkke, hvis Sportmonks bliver ved med at sige
// has_more. 60 sider à 50 kampe = 3.000 kampe, altså rigeligt til en hel sæson.
const MAX_PAGES = 60;
// Live-opslaget tager flere kampe i ét kald.
const MAX_IDS_PER_CALL = 40;

// ---- ét gen-forsøg ved 429 (G48) ----
//
// Providermodulet gen-forsøgte indtil august 2026 STRAKS ved enhver 4xx i
// fetchLive — inklusive 429. Et ekstra kald mod en grænse, der lige er ramt,
// gør situationen værre og kan forlænge udelukkelsen; `sync-live` kører hvert
// minut, så det ville ske igen og igen. De øvrige to opslag håndterede slet
// ikke 429.
//
// Ventetiden læses af `Retry-After`, når leverandøren sender den, ellers et
// fast fald tilbage. Loftet er der, fordi en absurd `Retry-After` ellers ville
// bruge hele funktionens budget på at vente — og et kald, der aldrig når at
// blive sendt, er værre end et, der fejler hurtigt.
//
// Mønsteret er lånt fra footballdata.js, som gjorde det rigtigt fra starten,
// og ÉT gen-forsøg er med vilje: to ville sløre, at forbruget reelt er for
// højt. Grænsen selv er nu kendt (`A15`, aflæst 2. august 2026: 3.000 kald i
// timen pr. entitet), men en 429 er stadig den ene besked, der ikke må dæmpes.
const RETRY_AFTER_MAX_S = 30;
const RETRY_AFTER_FALLBACK_S = 5;

function retryAfterMs(res) {
  const raw = Number(res.headers?.get?.("Retry-After"));
  const s = Number.isFinite(raw) && raw > 0 ? Math.min(raw, RETRY_AFTER_MAX_S) : RETRY_AFTER_FALLBACK_S;
  return s * 1000;
}

// Kalder én gang, og præcis én gang mere hvis svaret er 429. Alle tre opslag
// nedenfor går gennem den, så grænsen kun håndteres ét sted.
// `sleep` er injicerbar af samme grund som `fetchImpl`: uden den ville en test
// af gen-forsøget skulle vente i rigtige sekunder.
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function smFetch(url, fetchImpl, sleep = defaultSleep) {
  let res = await fetchImpl(url);
  if (res.status === 429) {
    await (sleep || defaultSleep)(retryAfterMs(res));
    res = await fetchImpl(url);
  }
  return res;
}

// ---- forbruget, som leverandøren selv opgør det (A15) ----
//
// `A15` spørger, hvilket tal der gælder for gratis-planen: dokumentationen og
// `live-resultater-v1.md` siger "180 kald i timen pr. entitet", mens Sportmonks'
// kontoside viser "3.000 API-kald". Spørgsmålet har stået åbent, fordi svaret
// krævede, at nogen skrev til supporten.
//
// Det behøver det ikke: Sportmonks lægger sit eget regnskab i HVERT svar, i et
// `rate_limit`-objekt med `remaining`, `resets_in_seconds` og — afgørende —
// `requested_entity`. Netop det sidste felt afgør uenigheden: er grænsen pr.
// entitet, står entitetens navn der.
//
// Værdien lægges i kørslens resumé og kan dermed aflæses i Admin → Drift.
// Feltet er VALGFRIT: er det der ikke (anden plan, ændret svarformat), skrives
// intet, og alt fungerer som før. En aflæsning, der kræver en ændring i
// leverandørens svar for at fejle stille, er ikke værd at have.
//
// AFLÆST 2. august 2026 — `A15` er lukket. En Scotland-kørsel svarede
// `{ entity: "Fixture", remaining: 2996, resetsInSeconds: 3600 }` efter fire
// kald: enheden er pr. entitet (som dokumentationen sagde), og tallet er 3.000
// i timen (som kontosiden sagde), ikke 180. Loftet står ikke i svaret — det er
// udledt af 2996 + 4. Funktionen bliver stående: den er nu den løbende
// måling af, hvor tæt forbruget ligger på et loft, vi kender.
function readRateLimit(data, meta) {
  const rl = data?.rate_limit;
  if (!meta || !rl) return;
  meta.rateLimit = {
    remaining: rl.remaining ?? null,
    resetsInSeconds: rl.resets_in_seconds ?? null,
    entity: rl.requested_entity ?? null,
  };
}

// Sportmonks returnerer state-navnet i flere felter afhængigt af endpoint/plan.
function stateNames(fx) {
  return [fx.state?.developer_name, fx.state?.state, fx.state?.short_name].filter(Boolean);
}

// "scheduled" dækker også udsat/aflyst. Det er med vilje: begge endpoints
// behandler dem ens (skriv intet resultat, ryd en evt. live-markering), og en
// fjerde status ville være en skelnen uden en konsekvens.
function statusOf(fx) {
  const names = stateNames(fx);
  if (names.some((n) => FINISHED_STATES.includes(n))) return "finished";
  if (names.some((n) => LIVE_STATES.has(n) || /INPLAY/i.test(n))) return "live";
  return "scheduled";
}

// Nuværende stilling. Under en kamp opdaterer Sportmonks "CURRENT"-scoren
// løbende, så samme udtræk virker både live og ved slutfløjt.
function currentScore(fx) {
  const cur = (fx.scores || []).filter((s) => s.description === "CURRENT");
  return {
    home: cur.find((s) => s.score?.participant === "home")?.score?.goals ?? null,
    away: cur.find((s) => s.score?.participant === "away")?.score?.goals ?? null,
  };
}

// Spilleminut fra den periode, der tikker. Null i pauser — og hvis
// include=periods ikke er med i abonnementet, så viser UI'et bare "LIVE".
function liveMinute(fx) {
  const p = (fx.periods || []).find((x) => x.ticking);
  return Number.isFinite(p?.minutes) ? p.minutes : null;
}

// "Tid ikke fastlagt". Sportmonks har ingen status for "dato kendt, klokkeslæt
// ukendt" — det er præcis den tilstand, en Superliga-runde står i, indtil
// TV-tiderne er fastsat nogle uger før. To markører fanger den:
//
//   TBA      leverandørens egen state for en kamp uden bekræftet dato OG tid.
//   midnat   pladsholderen i `starting_at`, når kun datoen er kendt.
//
// Midnat-testen er aflæst, ikke antaget: en kamp gemt med 00:00 UTC vises som
// 02.00 i dansk sommertid, og `starting_at` skrives ordret hele vejen til
// matches.kickoff_at (normalize → sync-matches). Intet led tilføjer midnat, så
// værdien kommer fra leverandøren.
//
// Prisen er en falsk positiv for en kamp, der FAKTISK starter 00:00 UTC (02.00
// dansk sommertid). Ingen af de turneringer, appen dækker, spiller på det
// tidspunkt; kommer en til, er det her, den skal tages højde for.
function kickoffTbdOf(fx) {
  if (stateNames(fx).includes("TBA")) return true;
  const ts = fx.starting_at;
  if (typeof ts !== "string") return false;
  return /[ T]00:00:00/.test(ts);
}

function participant(fx, location) {
  const p = (fx.participants || []).find((x) => x?.meta?.location === location);
  if (!p?.id || !p?.name) return null;
  return { providerId: String(p.id), globalId: String(p.id), name: p.name };
}

// ---------------------------------------------------------------------------
// Den normaliserede form. ALLE providere returnerer præcis denne:
//
//   {
//     providerId  string   leverandørens eget kamp-id
//     globalId    string   værdien i matches.api_fixture_id
//     kickoffAt   string    | null
//     kickoffTbd  boolean            klokkeslættet i kickoffAt er en PLADSHOLDER
//     stageName   string    | null   (rå, engelsk — oversættes i src/lib/scoring.js)
//     home/away   { providerId, globalId, name } | null
//     status      "scheduled" | "live" | "finished"
//     score       { home: number|null, away: number|null }   aktuel stilling
//     liveState   string | null   rå state-navn til matches.live_state
//     liveMinute  number | null
//   }
//
// `kickoffTbd` siger, at DATOEN i kickoffAt er kendt, men klokkeslættet ikke er.
// Hver leverandør udleder det på sin egen måde — formen er fælles, kilden er det
// ikke. Kalderen skal behandle tidsdelen som ukendt, ikke som 00.00.
//
// `score` er den AKTUELLE stilling, ikke nødvendigvis den endelige. Kalderen
// afgør, om den må skrives i home_score/away_score — og det må den kun, når
// status er "finished". Hele appen bruger "home_score is not null" som "kampen
// er spillet", så en live-stilling i den kolonne ville udløse point midt i en kamp.
// ---------------------------------------------------------------------------
function normalize(fx) {
  return {
    providerId: String(fx.id),
    globalId: String(fx.id),
    kickoffAt: fx.starting_at ?? null,
    kickoffTbd: kickoffTbdOf(fx),
    stageName: fx.stage?.name ?? null,
    home: participant(fx, "home"),
    away: participant(fx, "away"),
    status: statusOf(fx),
    score: currentScore(fx),
    liveState: fx.state?.developer_name || fx.state?.state || fx.state?.short_name || null,
    liveMinute: liveMinute(fx),
  };
}

export const sportmonks = {
  key: "sportmonks",
  label: "Sportmonks",
  tokenEnv: "SPORTMONKS_TOKEN",
  supportsLive: true,

  // Bevidst UDEN præfiks. Sportmonks-id'erne står allerede i tusindvis af rækker
  // i matches.api_fixture_id, og et præfiks her ville kræve en datamigrering af
  // hele tabellen for at undgå, at hver eneste kamp blev oprettet på ny.
  // Nye leverandører præfikser i stedet (se footballdata.js).
  toGlobalId: (id) => String(id),
  fromGlobalId: (id) => String(id),

  // Slå sæson-id op ud fra navnet (fx "2026/2027"). Kaldes kun, når
  // seasons.api_season_id er tom — bagefter gemmer kalderen id'et.
  async resolveSeasonId({ apiLeagueId, seasonName, token, fetchImpl = fetchWithTimeout, sleep, meta }) {
    const res = await smFetch(
      `${BASE}/leagues/${apiLeagueId}?include=seasons&api_token=${token}`, fetchImpl, sleep
    );
    if (!res.ok) throw new Error(`Sportmonks (liga): ${res.status} ${await res.text()}`);
    const data = await res.json();
    readRateLimit(data, meta);
    const seasons = data.data?.seasons || [];
    const match = seasons.find((s) => s.name === seasonName);
    if (!match) {
      const available = seasons.map((s) => s.name).join(", ") || "(ingen sæsoner fundet)";
      throw new Error(
        `Kunne ikke finde sæsonen '${seasonName}' hos Sportmonks for liga ${apiLeagueId}. Tilgængelige sæsoner: ${available}`
      );
    }
    return String(match.id);
  },

  // Sæsonens SLUTNING, som datakilden ser den.
  //
  // Findes for at kunne svare på "kan denne sæson stadig få flere kampe?" —
  // spørgsmålet, sql/season_end.sql stiller for ikke at erklære en konkurrence
  // slut midt i sin egen sæson. Sportmonks modellerer Superligaen som ÉN sæson
  // med flere stages, så "alle kendte kampe er spillet" er sandt hver gang et
  // grundspil slutter, og slutspillet endnu ikke er udgivet.
  //
  // Samme endpoint som `resolveSeasonId` — sæsonobjektet bærer både `finished`
  // og `ending_at`, så der er intet at hente et andet sted.
  async fetchSeasonMeta({ apiLeagueId, apiSeasonId, token, fetchImpl = fetchWithTimeout, sleep, meta }) {
    const res = await smFetch(
      `${BASE}/leagues/${apiLeagueId}?include=seasons&api_token=${token}`, fetchImpl, sleep
    );
    if (!res.ok) throw new Error(`Sportmonks (sæson-meta): ${res.status} ${await res.text()}`);
    const data = await res.json();
    readRateLimit(data, meta);
    const s = (data.data?.seasons || []).find((x) => String(x.id) === String(apiSeasonId));
    if (!s) return null;
    return {
      // `ending_at` er en ren dato ("2027-05-24") — skæres alligevel, hvis
      // leverandøren en dag sender et tidsstempel.
      endsAt: s.ending_at ? String(s.ending_at).slice(0, 10) : null,
      // Kun et EGENTLIGT true tæller. Mangler feltet, ved vi det ikke — og
      // "ved ikke" må aldrig blive til "slut".
      finished: s.finished === true,
    };
  },

  // Hele sæsonens kampprogram. Pagineret — ~4 kald for en typisk turnering.
  async fetchSeasonFixtures({ apiSeasonId, token, fetchImpl = fetchWithTimeout, sleep, meta }) {
    const byId = new Map();
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const url =
        `${BASE}/fixtures?filters=fixtureSeasons:${apiSeasonId}` +
        `&include=participants;scores;state;stage&per_page=50&page=${page}&api_token=${token}`;
      const res = await smFetch(url, fetchImpl, sleep);
      if (!res.ok) throw new Error(`Sportmonks (kampe): ${res.status} ${await res.text()}`);
      const data = await res.json();
      readRateLimit(data, meta);
      for (const fx of data.data || []) byId.set(fx.id, fx);
      hasMore = !!data.pagination?.has_more;
      page++;
      // FEJL frem for at bryde stille. Loftet var før 20 sider med et bart
      // `break`, så en stor turnering kunne blive trunkeret uden at nogen
      // opdagede det: svaret var 200, og de manglende kampe fandtes bare ikke.
      if (page > MAX_PAGES && hasMore) {
        throw new Error(
          `Paginering afbrudt: Sportmonks har flere kampe efter side ${MAX_PAGES} for sæson ${apiSeasonId}. ` +
          `Kampprogrammet ville blive ufuldstændigt. Hæv MAX_PAGES i api/_providers/sportmonks.js.`
        );
      }
      if (page > MAX_PAGES) break;
    }
    return [...byId.values()].map(normalize);
  },

  // Netop de angivne kampe, ét kald pr. 40. Returnerer en Map globalId → kamp;
  // kampe uden for abonnementet mangler ganske enkelt i den, og kalderen rydder
  // deres live-markering i stedet for at fejle.
  async fetchLive({ providerIds, token, fetchImpl = fetchWithTimeout, sleep, meta }) {
    const out = new Map();
    for (let i = 0; i < providerIds.length; i += MAX_IDS_PER_CALL) {
      const chunk = providerIds.slice(i, i + MAX_IDS_PER_CALL);
      const endpoint = `${BASE}/fixtures/multi/${chunk.join(",")}`;
      const call = (include) => smFetch(`${endpoint}?include=${include}&api_token=${token}`, fetchImpl, sleep);
      // periods giver spilleminuttet. Er den include ikke med i abonnementet,
      // svarer Sportmonks 4xx — så prøver vi igen uden, og viser kampen live
      // uden minuttal i stedet for at lade hele kørslen fejle.
      //
      // 429 er UNDTAGET fra det fald-tilbage (G48), og det er hele rettelsen:
      // en for høj kaldefrekvens har intet med `periods` at gøre, så et kald
      // uden den ville blot være ET KALD MERE mod en grænse, der lige er ramt.
      // smFetch har allerede ventet og prøvet igen; er svaret stadig 429, skal
      // kørslen fejle højlydt frem for at banke videre hvert minut.
      let r = await call("scores;state;periods");
      if (!r.ok && r.status >= 400 && r.status < 500 && r.status !== 429) r = await call("scores;state");
      if (!r.ok) throw new Error(`Sportmonks (live): ${r.status} ${await r.text()}`);
      const data = await r.json();
      readRateLimit(data, meta);
      const rows = Array.isArray(data.data) ? data.data : data.data ? [data.data] : [];
      for (const fx of rows) out.set(String(fx.id), normalize(fx));
    }
    return out;
  },
};

// Eksporteret til test — mappingen er det, der ikke må flytte sig ved en oprydning.
export const __test = { normalize, statusOf, currentScore, liveMinute, readRateLimit, retryAfterMs, RETRY_AFTER_MAX_S, RETRY_AFTER_FALLBACK_S };
