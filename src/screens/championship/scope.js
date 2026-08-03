// Hvilket OMFANG ser brugeren, og hvad kalder vi det?
//
// Udskilt fra ChampionshipTab.jsx den 3. august 2026 (G1). Ren flytning.
// Samlet her, fordi de besvarer det samme spørgsmål — og fordi de er rene
// funktioner og konstanter, der kan læses og testes uden at rendere en skærm.
import { joinNames } from "../../lib/standings.js";
import { readUserFlag, writeUserFlag, SEASON_LEAGUE_KEY } from "../../lib/localFlags.js";

// Kolonne-forklaringen under stillingerne. Hele tiebreaker-stigen står i InfoDot'en
// og på "Sådan virker det" — her nævnes kun det, tabellen faktisk viser, og først
// når der rent faktisk ér en delt placering at forklare.
const TIEBREAK_HINT = (rows) =>
  "🎯 = præcise resultater" + (rows.some((r) => r.shared) ? " · ens placering = delt" : "");

// UI'et (drejebogen `docs/features/turnering-2.md` §3.2). Rækkefølgen er:
// brugerens eget valg, hvis turneringen stadig findes → ellers den turnering
// appen startede med.
//
// `created_at` frem for navn er et bevidst valg: `leagues` kommer sorteret på
// navn, og alfabetet ville gøre "Scotland Premiership" til forvalg foran
// "Superligaen" i det øjeblik turnering #2 blev synlig. Den ældste turnering er
// den, appen blev bygget om — det er et stabilt svar, som ingen skal huske at
// vedligeholde i en kolonne.
export function pickSeasonLeague(leagues, savedId) {
  const list = leagues || [];
  if (!list.length) return null;
  return list.find((l) => l.id === savedId)
    || list.slice().sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""))[0];
}

// Brugerens valg i sæsonvælgeren — BRUGERENS, ikke telefonens: to personer på
// samme enhed skal ikke arve hinandens filter. Læse/skrive er stille, hvis
// localStorage er utilgængelig (privat browsing, blokerede cookies).
const readSeasonLeagueId = (userId) => readUserFlag(SEASON_LEAGUE_KEY, userId);
const writeSeasonLeagueId = (userId, id) => writeUserFlag(SEASON_LEAGUE_KEY, userId, id);

// Championship har to niveauer, og navnet bærer forskellen: kun den SAMLEDE
// stilling hedder "Prediction Champ". En turneringsstilling er "Månedens bedste
// i Superligaen" — rangordenen ligger dermed i sproget og kræver ingen
// forklaring i UI'et. (Sæsonchampionshippet er en bevidst undtagelse: det er
// turneringsbundet af natur og har ingen samlet modpart at forveksles med.)
export function boardTitle(kind, league) {
  const what = kind === "round" ? "Rundens" : "Månedens";
  return league ? `${what} bedste i ${league.name}` : `${what} Prediction Champ`;
}

// Scope-værdien, loaderne og DB-viewene bruger: 'ALL' = alle officielle
// turneringer samlet, ellers turneringens id.
const ALL_SCOPE = "ALL";

// Fælles udseende for kortenes filter-dropdowns. `minWidth: 0` er det, der
// tillader den sidste krympning; `maxWidth: "100%"` holder en enkelt lang
// turnering inde på sin egen linje frem for at lade den skubbe linjen bredere.
const filterSelect = { padding: "4px 8px", fontSize: 12, minWidth: 0, maxWidth: "100%" };

// Hvorfor en turnering kan udelades. Hører hjemme i en InfoDot og ikke på
// kortet: begrundelsen er A2's egen — et tal, hvis betydning skifter, når
// produktet vokser, kan ikke sammenlignes med sig selv.
const WHY_NOT_ALL = "En turnering kan tippes, uden at den afgør titler. "
  + "Det er derfor en titel betyder det samme, før og efter en ny turnering er kommet til.";

// En turnering kan være synlig og tipbar uden at fodre Championship
// (`leagues.is_visible = true`, `is_official = false` — se sql/tournament_scope.sql).
// Den udelades derfor af stillingerne, og indtil nu blev den udeladt *tavst*:
// vælgeren og "To niveauer"-forklaringen er begge gated på mere end én officiel
// turnering, så med præcis én officiel og én uofficiel viste fanen ingen af
// delene. En bruger, der havde tippet den uofficielle turnering, så sine point
// tælle i konkurrencen og i ratingen — og forsvinde her, uden ét ord om hvorfor.
//
// Sætningen navngiver derfor begge sider, og den siger, hvor pointene så bliver
// af: en udeladelse, der ikke gør det, ligner et tab. Reglen er den fra 30.
// juli — et tal skal navngive sit eget omfang i den sætning, det står i, og en
// InfoDot må uddybe, men aldrig alene bære det, der skal til for at læse tallet
// rigtigt. Uden officielle turneringer er der ingen stilling at forklare.
//
// A17 (31. juli 2026) gjorde sætningen KORTERE: ratingen filtrerer nu også på
// `is_official`, så en uofficiel turnering tæller ét sted i stedet for to. Den
// første udgave måtte skrive "…og i din rating, men tæller ikke med her", altså
// en ledsætning om, at "officiel" betød noget forskelligt på to skærme. At den
// ledsætning var nødvendig, var i sig selv et af argumenterne for A17.
export function scopeNote(official, unofficial) {
  if (!official?.length || !unofficial?.length) return null;
  return `Championship afgøres af ${joinNames(official.map((l) => l.name))}. `
    + `${joinNames(unofficial.map((l) => l.name))} kan tippes og giver point i din konkurrence, `
    + `men tæller hverken i Championship eller i rating.`;
}


export { TIEBREAK_HINT, ALL_SCOPE, filterSelect, WHY_NOT_ALL, readSeasonLeagueId, writeSeasonLeagueId };
