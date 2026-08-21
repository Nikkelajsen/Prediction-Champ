// Sidevis læsning — lister, der er længere end ét PostgREST-svar må bære.
//
// ---------------------------------------------------------------------------
// HVORFOR DEN FINDES (`G145`, 21. august 2026)
//
// Supabase klipper hvert svar ved projektets `db-max-rows` (1000 som standard)
// og **siger det ikke**: svaret er 200 med en kortere liste. `db.select` kaster
// kun ved ikke-2xx og kan derfor ikke se forskel på "det var alt" og "her er de
// første 1000". Et afkortet svar er ikke en fejl — det er et forkert facit.
//
// Skaden er derfor aldrig en skærm, der går i stykker. Den er en skærm, der
// viser for lidt og ser rigtig ud imens: en runde, der mangler i vælgeren, et
// ratingtal, der mangler ved et navn, en spiller under nr. 1000, der ikke kan
// finde sig selv på ranglisten.
//
// ---------------------------------------------------------------------------
// SVARET FANDTES ALLEREDE — PÅ SERVERSIDEN
//
// `sbAll()` i `api/_shared.js` er den samme funktion for jobbene, skrevet efter
// `G51` (en falsk "runden er slut"-notifikation, `DOCUMENTATION.md` §13).
// **Denne er dens tvilling i klienten, og reglerne er ordret de samme** — de to
// transportlag er forskellige (`sb()` med service-nøglen mod `db.select` med
// brugerens token), men fælden er én, og så skal svaret også være ét.
//
// De to ting, der ikke er til forhandling, er derfor arvet uændret:
//
//   * **`order=` er PÅKRÆVET.** PostgRESTs rækkefølge er udefineret uden den, så
//     to sider ville både tabe og gentage rækker. Der findes ingen brugbar
//     standard at gætte på, og kalderen skal slutte sin `order=` med en entydig
//     nøgle (`user_id.asc`, `id.asc`) — det kan ikke ses herfra.
//   * **Der stoppes ved en TOM side og ikke ved en kort side.** Er projektets
//     `db-max-rows` mindre end `pageSize`, ville "kortere end bestilt" være
//     sandt for hver eneste FULDE side — og så havde vi bygget den samme tavse
//     afkortning igen, nu inde i kuren. Loftet kan ikke aflæses fra repoet, så
//     det må ikke antages. Af samme grund er `offset` antallet af rækker, vi
//     har fået, og ikke sidetallet gange sidestørrelsen: klipper serveren
//     siderne kortere, end vi bad om, rykker vi stadig præcis så langt frem,
//     som vi kom.
//
// Prisen er ét ekstra kald pr. opslag — den tomme side, der beviser, at der
// ikke var mere. Alternativet var at læse totalen af `Content-Range`
// (`count=exact`) på første side, men det kræver adgang til svarets HEADERE og
// dermed sin egen transport uden om `db.select`. Det ville koste den
// lagdeling, `chunked.js` hviler på — at hver test, der mocker `supabase.js`,
// stadig fanger kaldet — for at spare en rundtur på et kald, der i forvejen
// tegner en hel skærm.
//
// ---------------------------------------------------------------------------
// KUREN HAR TRE FORMER, OG DENNE ER DEN TREDJE
//
//   1. **`db.count()`** — når det, der skal bruges, er et TAL. Databasen
//      tæller, og `Content-Range` er upåvirket af rækkeloftet (`G106`, `G139`).
//   2. **Et afgrænset opslag** — når kaldet kun har brug for bestemte rækker:
//      `user_id=eq.…`, `selectIn(…)` eller et bevidst `limit=`.
//   3. **`selectAll()`** — når hele listen SKAL med, og længden er uden for
//      vores kontrol, fordi den vokser med brugere, runder eller kampe.
import { db } from "../supabase.js";

const SIDE = 1000;
// Nødstop. 100 sider er 100.000 rækker — langt over alt, en skærm i denne app
// har at gøre med. Det kastes med vilje: at give det halve resultat tilbage her
// ville være præcis den tavse afkortning, funktionen findes for at forhindre.
const MAX_SIDER = 100;

async function selectAll(token, table, query, { signal, pageSize = SIDE, maxPages = MAX_SIDER } = {}) {
  // Sorteringen står i `query` og ikke i et eget argument, fordi kaldsstederne
  // bygger én forespørgselsstreng ligesom til `db.select` — men kravet er det
  // samme som `sbAll`s, og det tjekkes her frem for at blive husket.
  if (!/(^|&)order=/.test(query)) {
    throw new Error(`selectAll("${table}"): forespørgslen mangler order=. Sidevis læsning uden én stabil sortering taber og gentager rækker — slut med en entydig nøgle, fx user_id.asc.`);
  }
  if (/(^|&)(limit|offset)=/.test(query)) {
    throw new Error(`selectAll("${table}"): forespørgslen har sit eget limit/offset. Et bevidst afgrænset opslag hører til på db.select.`);
  }

  const ud = [];
  for (let side = 0; side < maxPages; side++) {
    const rows = await db.select(token, table, `${query}&limit=${pageSize}&offset=${ud.length}`, signal ? { signal } : {});
    if (!rows?.length) return ud;
    ud.push(...rows);
  }
  throw new Error(`selectAll("${table}"): over ${maxPages * pageSize} rækker — opslaget skal afgrænses frem for at hente videre.`);
}

export { selectAll, SIDE, MAX_SIDER };
