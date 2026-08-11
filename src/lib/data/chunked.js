// Portionsvis `in.(…)` — id-lister, der ikke kan være i én URL.
//
// ---------------------------------------------------------------------------
// HVORFOR DEN FINDES (11. august 2026)
//
// PostgREST tager id-lister i selve URL'en, og en URL har et loft: Supabases
// edge afviser en forespørgsel et sted omkring 8–16 KB. Et UUID fylder 37 tegn
// med sit komma, så listen knækker mellem 200 og 400 id'er.
//
// **Det er ikke en teoretisk grænse.** En staging-bruger med en simuleret sæson
// og en konkurrence på 32 runder havde 778 kampe — altså en URL på ~29 KB — og
// BÅDE Hjem og Tip svarede med en fejl. Vælgeren "Alle konkurrencer" fejlede,
// mens ét enkelt valg virkede, fordi listen da var kort nok.
//
// **Symptomet peger alle andre steder hen end på årsagen**, og det er derfor
// reglen skal være strukturel og ikke en huskeregel: skærmen siger "Kunne ikke
// hente kampene lige nu", og alt ser ud til at handle om rettigheder eller om
// den konkurrence, man lige har valgt. Fejlen er, at listen blev for lang.
//
// ---------------------------------------------------------------------------
// HVORFOR OVEN PÅ `db.select` OG IKKE VED SIDEN AF
//
// Funktionen kalder `db.select` frem for `restFetch`. Det er ikke en tilfældig
// lagdeling: hver test, der i forvejen mocker `supabase.js`, fanger dermed
// stadig kaldet, og en kort liste giver **ordret den samme forespørgsel som
// før**. Havde den sin egen transport, skulle syv testfiler have en ny mock, og
// hver konverteret kaldssted skulle skrives om i sin test — altså en stor
// ændring for at rette en lille fejl.
//
// ---------------------------------------------------------------------------
// LOFTET
//
// 100 id'er pr. kald: 100 × 37 = 3.700 tegn plus resten af forespørgslen, altså
// under halvdelen af det snævreste kendte loft. Prisen er én ekstra rundtur pr.
// 100 id'er — for de 778 kampe otte kald i stedet for ét, som browseren
// alligevel afvikler efter hinanden på den samme forbindelse.
//
// Tallet er sat med luft med vilje. Et loft, der lige akkurat går fri, er ikke
// et loft; det er den næste fejl, når nogen tilføjer et felt til `select=`.
import { db } from "../supabase.js";

const LOFT = 100;

// `tail` skal begynde med `&` (fx `&select=*`). `sortBy` er nødvendig, hvis
// kaldet havde et `order=`: hver portion kommer sorteret hjem, men de sættes
// sammen efter hinanden, så rækkefølgen skal genskabes på tværs af portionerne.
// Uden den ville en runde-inddeling se rigtig ud for de første 100 kampe og
// derefter begynde forfra — en fejl, der ligner data og ikke kode.
async function selectIn(token, table, column, ids, tail = "", { signal, sortBy } = {}) {
  const unikke = [...new Set(ids)].filter((v) => v !== null && v !== undefined && v !== "");
  // Tom liste giver INTET kald. `in.()` er ugyldig syntaks og svarer 400 — det
  // var i forvejen et hul, hvert kaldssted måtte huske at gardere sig mod.
  if (!unikke.length) return [];

  const ud = [];
  for (let i = 0; i < unikke.length; i += LOFT) {
    const del = unikke.slice(i, i + LOFT);
    const rows = await db.select(token, table, `${column}=in.(${del.join(",")})${tail}`, signal ? { signal } : {});
    ud.push(...rows);
  }

  if (sortBy && ud.length) {
    // Null sidst: en kamp uden fastsat klokkeslæt hører til efter dem, der har
    // et — samme rækkefølge som PostgREST' `order=` giver med `nulls last`.
    ud.sort((a, b) => {
      const x = a?.[sortBy], y = b?.[sortBy];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return x < y ? -1 : 1;
    });
  }
  return ud;
}

export { selectIn, LOFT };
