// `fetch`-attrappen, der lader den rigtige app køre uden en database (I23).
//
// ---------------------------------------------------------------------------
// HVORFOR SNITTET LIGGER PÅ `fetch`
//
// Alt, appen henter, går gennem `restFetch()` i `src/lib/supabase.js` og videre
// til ét `fetch` mod `${SUPABASE_URL}${sti}`. Det er ét sted, og det er det
// DYBESTE sted: gribes kaldet her, er hver eneste linje ovenover — loaderne,
// skærmene, komponenterne, CSS'en — den kode, der ligger i produktionen. Havde
// vi i stedet byttet `src/lib/data.js` ud, ville skærmbillederne vise en app,
// hvis datalag ikke findes.
//
// Prisen er, at attrappen skal kunne det stykke PostgREST, appen bruger. Det er
// mindre, end det lyder: seks operatorer (`eq`, `in`, `is`, `not.is`, `gte`,
// `lte`/`lt`), `select`, `order`, `limit` og `offset`. Listen er ikke gættet — den er
// talt op i `src/` med `grep`, og en forespørgsel, der bruger noget andet,
// KASTER nedenfor frem for at svare tomt. Et tomt svar ville blive til en tom
// skærm, og en tom skærm i en PNG ser ud som et designvalg.
//
// ---------------------------------------------------------------------------
// URET STÅR STILLE
//
// `Date` erstattes af en proxy, der svarer `NU` (se `demo-db.js`) på ethvert
// spørgsmål om "nu". Uden den ville låse, live-mærker, nedtællinger og "hvilken
// runde er vi i" flytte sig med kalenderen, og det samme script ville give et
// nyt billede hver dag. Konstruktøren med argumenter er urørt — `new
// Date(m.kickoff_at)` skal stadig virke.
import { COMPLETE_KEY, NUDGE_KEY, PUSH_DISMISS_KEY, PWA_ONBOARDED_KEY, SESSION_KEY, writeFlag, writeUserFlag } from "../../src/lib/localFlags.js";
import { NU, SESSION, tabeller, rpc } from "./demo-db.js";

// ---------------------------------------------------------------------------
// Uret
function frysUret() {
  const Rigtig = Date;
  window.Date = new Proxy(Rigtig, {
    construct: (mål, args) => (args.length ? new mål(...args) : new mål(NU)),
    apply: () => new Rigtig(NU).toString(),
    get: (mål, felt) => (felt === "now" ? () => NU : Reflect.get(mål, felt)),
  });
}

// ---------------------------------------------------------------------------
// Forespørgslen
//
// PostgREST'ens filtre står som almindelige query-parametre: `user_id=eq.<id>`,
// `id=in.(a,b,c)`, `home_score=not.is.null`. `select`, `order`, `limit` og
// `offset` er reserverede navne og er derfor ikke filtre.
const RESERVEREDE = new Set(["select", "order", "limit", "offset", "on_conflict"]);

function sammenlign(værdi, tekst) {
  // Rækkernes værdier er rigtige typer (tal, boolean, null), mens filteret er en
  // streng fra en URL. Sammenligningen sker derfor på tekstform — det er præcis
  // det, PostgREST selv gør, når den parser URL'en.
  if (værdi === null || værdi === undefined) return tekst === "null";
  return String(værdi) === tekst;
}

function opfylder(række, felt, udtryk) {
  const [op, ...rest] = udtryk.split(".");
  const værdi = rest.join(".");
  switch (op) {
    case "eq": return sammenlign(række[felt], værdi);
    case "neq": return !sammenlign(række[felt], værdi);
    case "is": return værdi === "null" ? række[felt] === null || række[felt] === undefined : String(række[felt]) === værdi;
    case "not": {
      // Kun `not.is.null` bruges i appen, og kun den forstås her.
      if (rest[0] !== "is") throw new Error(`ukendt filter: ${felt}=${udtryk}`);
      return !opfylder(række, felt, rest.join("."));
    }
    case "in": {
      const liste = værdi.replace(/^\(|\)$/g, "").split(",").filter(Boolean);
      return liste.some((v) => sammenlign(række[felt], v));
    }
    case "gte": return række[felt] >= værdi;
    case "gt": return række[felt] > værdi;
    case "lte": return række[felt] <= værdi;
    case "lt": return række[felt] < værdi;
    default: throw new Error(`ukendt filter: ${felt}=${udtryk}`);
  }
}

function sortér(rækker, order) {
  if (!order) return rækker;
  const nøgler = order.split(",").map((del) => {
    const [felt, ...flag] = del.split(".");
    return { felt, ned: flag.includes("desc") };
  });
  return rækker.slice().sort((a, b) => {
    for (const { felt, ned } of nøgler) {
      const x = a[felt], y = b[felt];
      if (x === y) continue;
      // null sidst, uanset retning — samme som PostgREST's standard for `desc`.
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      if (r !== 0) return ned ? -r : r;
    }
    return 0;
  });
}

function projicér(rækker, select) {
  if (!select || select === "*") return rækker;
  const felter = select.split(",").map((f) => f.trim()).filter((f) => f && f !== "*");
  if (!felter.length) return rækker;
  return rækker.map((r) => Object.fromEntries(felter.map((f) => [f, r[f]])));
}

function slåOp(tabel, søgning) {
  const rå = tabeller[tabel];
  if (!rå) throw new Error(`demo-db mangler tabellen "${tabel}"`);
  const params = new URLSearchParams(søgning);
  let rækker = rå;
  for (const [felt, udtryk] of params) {
    if (RESERVEREDE.has(felt)) continue;
    rækker = rækker.filter((r) => opfylder(r, felt, udtryk));
  }
  rækker = sortér(rækker, params.get("order"));
  const antal = rækker.length;
  // `offset` FØR `limit`, og begge som PostgREST: appen læser sidevis siden
  // `G145`, og en attrap, der ignorerede `offset`, ville svare med den samme
  // første side igen og igen — altså dubletter, hvor serveren giver næste side.
  // Demo-databasen er lille nok til at rummes i én side i dag, og det er netop
  // derfor, det skal stå her: fejlen ville først vise sig den dag, datasættet
  // voksede.
  const offset = Number(params.get("offset"));
  if (Number.isFinite(offset) && params.get("offset") !== null) rækker = rækker.slice(offset);
  const limit = Number(params.get("limit"));
  if (Number.isFinite(limit) && params.get("limit") !== null) rækker = rækker.slice(0, limit);
  return { rækker: projicér(rækker, params.get("select")), antal };
}

// ---------------------------------------------------------------------------
// Svaret
function json(krop, { status = 200, headers = {} } = {}) {
  return new Response(krop === null ? "" : JSON.stringify(krop), {
    status: krop === null ? 204 : status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function svar(url, init) {
  const sti = url.pathname;
  const søgning = url.search.replace(/^\?/, "");

  // Token-fornyelsen ved opstart: appen har en gemt session og beder om en frisk
  // access-token, før den overhovedet tegner noget.
  if (sti.startsWith("/auth/v1/token")) return json(SESSION);
  if (sti === "/auth/v1/user") return json(SESSION.user);

  if (sti.startsWith("/rest/v1/rpc/")) {
    const navn = sti.slice("/rest/v1/rpc/".length);
    const svarer = rpc[navn];
    // Ukendte RPC'er svarer null frem for at kaste: de er alle valgfri
    // (kåringer, karriereprofil, statistik), og appen tåler et tomt svar fra
    // dem. En manglende TABEL er en anden sag og kaster — den ville betyde, at
    // en skærm ikke kan tegnes færdig.
    return json(svarer ? svarer(init?.body ? JSON.parse(init.body) : {}) : null);
  }

  if (sti.startsWith("/rest/v1/")) {
    const tabel = sti.slice("/rest/v1/".length);
    // Skrivninger kvitteres tomt. Skærmbillederne trykker ikke på noget, der
    // gemmer, men `analytics_events` skrives ved hver visning, og et 404 dér
    // ville fylde konsollen med støj, ingen skal bruge.
    if (init?.method && init.method !== "GET") return json([], { status: 201 });
    const { rækker, antal } = slåOp(tabel, søgning);
    return json(rækker, { headers: { "Content-Range": `0-${Math.max(0, rækker.length - 1)}/${antal}` } });
  }

  return new Response("ikke fundet", { status: 404 });
}

// ---------------------------------------------------------------------------
function installér() {
  frysUret();
  writeFlag(SESSION_KEY, JSON.stringify({ refresh_token: SESSION.refresh_token, user: SESSION.user }));
  // Modalerne for en NY bruger — "Føj til hjemmeskærm", onboarding-checklisten,
  // opt-in til notifikationer, liga-forslaget — ville lægge sig hen over
  // skærmbilledet. De sættes som set.
  //
  // Flagene skrives med appens egne funktioner og ikke med `setItem` og en
  // håndskrevet værdi: ejerskabet står i VÆRDIEN (`1@<bruger-id>`), og den form
  // hører til i `localFlags.js`. En kopi her ville tie, den dag formen ændrer
  // sig — modalen ville bare stå på skærmbilledet igen.
  for (const nøgle of [PWA_ONBOARDED_KEY, COMPLETE_KEY, PUSH_DISMISS_KEY, NUDGE_KEY]) {
    writeUserFlag(nøgle, SESSION.user.id, "1");
  }

  const rigtigFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const adresse = typeof input === "string" ? input : input.url;
    const url = new URL(adresse, window.location.origin);
    // Alt, der ikke er databasen, går videre til den rigtige `fetch` — Vites
    // egen HMR-kanal og modulhentningen skal ikke gennem attrappen.
    if (!url.pathname.startsWith("/rest/v1/") && !url.pathname.startsWith("/auth/v1/")) {
      return rigtigFetch(input, init);
    }
    return svar(url, typeof input === "string" ? init : input);
  };
}

export { installér };
