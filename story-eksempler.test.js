import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Vagt over hjemmesidens story-eksempler (G103).
//
// ---------------------------------------------------------------------------
// HVAD KOBLINGEN ER
//
// Sitets telefon-mockups viser fire story-kort, og deres tekst er ikke opdigtet:
// den er skrevet af efter motorens egne ord i `sql/story_engine_v3.sql`.
// Site-opdateringen 13. august 2026 gjorde det med vilje — de opdigtede citater
// ("Du har slået Anders fem runder i træk") lovede noget, appen ikke sagde — men
// ærligheden skabte samtidig en kobling, ingen holdt øje med: omformuleres en
// skabelon i SQL'en, følger sitet ikke med, og salget citerer en motor, der
// siger noget andet. Nøjagtig samme tavse drift, som `saelgesaetning.test.js`
// (`G97`) blev bygget for at forhindre.
//
// Filen er derfor søskende til den, og svaret er det samme: teksten flyttes
// ikke, den måles. Sitet ligger uden for Vite-buildet og kan pr. konstruktion
// ikke importere noget, og SQL'en er ikke et modul, nogen kan hente en streng
// fra.
//
// ---------------------------------------------------------------------------
// HVORFOR DER IKKE MÅLES ORDRET
//
// **Rækkens præmis holdt ikke helt.** Den sagde, at sitets eksempler ER motorens
// ægte formuleringer, og ingen af de fire er det ord for ord:
//
//   · Motoren sætter ikke punktum efter en overskrift. Sitet gør, fordi kortene
//     står som sætninger på en salgsside.
//   · Appen viser overskrift OG brødtekst (`screens/hjem/DayCard.jsx`); mockup'en
//     har én linje. Stime-kortet er derfor overskriftens 🔥 sat foran brødtekstens
//     ordlyd, og halen ("… efter den 3. august") er klippet af.
//   · Værdierne er valgt til et skærmbillede: "seks" står med bogstaver, hvor
//     motoren indsætter et tal.
//
// Alle tre er redaktionelle valg, ikke drift, og en ordret sammenligning ville
// forbyde dem. Det, der KAN drive — og som er hele rækkens bekymring — er ordene
// imellem værdierne. Dem holder vagten fast:
//
//   1. Linjens første tegn (⚔️/🔥/🧠) skal stå FØRST i en streng, reglen skriver.
//   2. Hvert stykke tekst mellem to `<span class="story-var">` skal stå ORDRET i
//      en af den samme regels strenge.
//
// Punktummer og bindestreger måles ikke: et fragment uden bogstaver springes
// over, og et fragments yderste tegnsætning trimmes væk. Vagten måler ordlyd,
// ikke sitets egen interpunktion.
//
// ---------------------------------------------------------------------------
// TO TING, DER SKULLE PRØVES AF, FØR DEN MÅLTE NOGET
//
// Begge blev fundet ved at ødelægge SQL'en med vilje og se, om testen blev rød.
// Den var grøn begge gange, og det er værd at vide, hvorfor:
//
//   · **Kommentarer tæller ikke.** Duellens ordlyd står også i en `--`-kommentar
//     ti linjer over skabelonen, hvor `G89` forklarer, hvorfor teksten kom i
//     datid. En søgning i hele filen finder derfor en formulering, motoren ikke
//     længere bruger. Vagten læser kun `'…'`-strenge.
//   · **Regelen skal være den rigtige.** "Du sluttede dagen" står ikke kun i
//     duellen, men også i regel 45's brødtekst ("… som nr. 3 af 8"), så et
//     omskrevet duel-kort kunne stadig finde sine ord et andet sted i motoren.
//     Derfor bærer hvert kort på sitet `data-story-rule`, og der ledes kun i
//     dén regels afsnit.
//
// ---------------------------------------------------------------------------
// HVORFOR SITET MARKERER SINE VARIABLE
//
// `<span class="story-var">` er det eneste, testen ikke kan udlede selv. Uden
// markeringen ville "seks" og "Nikolaj" være ord som alle andre, og vagten
// skulle enten gætte (hvert stort bogstav er et navn) eller bære sin egen kopi
// af ordlyden — og dermed blive endnu et sted, der kan drive, hvilket er præcis
// det, `saelgesaetning.test.js` afviste at være. Spannet har ingen CSS og
// ændrer intet i browseren; det siger kun, hvor motorens ord holder op.
//
// ---------------------------------------------------------------------------
// HVAD DEN IKKE PÅSTÅR
//
// Ikke at eksemplerne er REPRÆSENTATIVE — hvilke af motorens regler et
// salgsbillede skal vise, er en produktbeslutning. Og ikke at værdierne er
// realistiske. Kun at hvert ord, sitet har lånt, stadig står i den regel, kortet
// siger, det kommer fra.

const ROD = dirname(fileURLToPath(import.meta.url));
const læs = (f) => readFileSync(join(ROD, f), "utf8");

// Samme fem entiteter som `saelgesaetning.test.js` afkoder, og af samme grund:
// `&amp;` i HTML og `&` i en SQL-streng er den samme tekst for en læser.
function afkod(s) {
  return String(s)
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

// Yderste tegnsætning og mellemrum væk. Sitet afslutter sine kort med punktum,
// og motoren sætter først sit efter en dato, sitet ikke viser — den forskel er
// redaktionel og må ikke koste en fejlende test. Interpunktion INDE i et
// fragment ("… i træk. Stimen lever") bliver stående og måles.
const trim = (s) => String(s).replace(/^[\s.,;:!?—–-]+|[\s.,;:!?—–-]+$/gu, "");

const harBogstav = (s) => /\p{L}/u.test(s);

const SQL = læs("sql/story_engine_v3.sql");
const SITE = læs("site/index.html");

// Én regels afsnit: fra sektionshovedet over den til det næste. Hovederne er
// filens egen inddeling (`-- ======== 150 · Duel …`), og regelnavnet står som
// sin egen streng præcis ét sted, nemlig i den `insert`, der skriver kortet.
function regelAfsnit(regel) {
  const i = SQL.indexOf(`'${regel}'`);
  if (i === -1) return null;
  const hoveder = [...SQL.matchAll(/^[ \t]*-- ={4,}/gm)].map((m) => m.index);
  const start = Math.max(0, ...hoveder.filter((h) => h < i));
  const slut = Math.min(SQL.length, ...hoveder.filter((h) => h > i));
  return SQL.slice(start, slut);
}

// Motorens STRENGE — ikke dens kommentarer.
//
// Scanneren er ikke en SQL-parser og skal ikke være det. Den kan to ting:
// springe `--`-kommentarer over og læse en `'…'`-streng med `''` som escapet
// apostrof. Filen har hverken blokkommentarer eller `E'…'`-strenge (efterprøvet
// 14. august 2026), og skulle den få det, fejler vagten synligt frem for tavst:
// et fragment, den ikke kan finde, er en rød test og ikke en grøn.
function sqlStrenge(sql) {
  const ud = [];
  for (let i = 0; i < sql.length;) {
    if (sql[i] === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl + 1;
    } else if (sql[i] === "'") {
      let s = "";
      let j = i + 1;
      for (; j < sql.length && sql[j] !== "'"; j++) s += sql[j];
      while (sql[j] === "'" && sql[j + 1] === "'") {      // '' = én apostrof
        s += "'";
        for (j += 2; j < sql.length && sql[j] !== "'"; j++) s += sql[j];
      }
      ud.push(s);
      i = j + 1;
    } else i++;
  }
  return ud;
}

// Ét kort = ét `.story-text`-afsnit. Fragmenterne er teksten mellem de markerede
// værdier; første fragment deles i sit indledende tegn (emojien) og resten.
const KORT = [...SITE.matchAll(/<p class="story-text"([^>]*)>([\s\S]*?)<\/p>/g)].map((m) => {
  const regel = (m[1].match(/data-story-rule="([^"]+)"/) || [])[1] || null;
  const stykker = afkod(m[2]).split(/<span class="story-var">[\s\S]*?<\/span>/g);
  const [først = "", ...resten] = stykker;
  const mellemrum = først.indexOf(" ");
  const afsnit = regel ? regelAfsnit(regel) : null;
  return {
    regel,
    tekst: afkod(m[2]).replace(/<[^>]+>/g, ""),
    præfiks: mellemrum === -1 ? først : først.slice(0, mellemrum),
    fragmenter: [mellemrum === -1 ? "" : først.slice(mellemrum), ...resten],
    variable: (m[2].match(/<span class="story-var">/g) || []).length,
    strenge: afsnit ? sqlStrenge(afsnit) : [],
  };
});

describe("hjemmesidens story-eksempler er motorens ordlyd (G103)", () => {
  // Vagten må ikke stå og bevogte ingenting. Forsvinder klassenavnet fra sitet,
  // eller omdøbes SQL-filen, ville hver påstand nedenfor blive triviel sand over
  // en tom liste, og filen ville blive ved med at være grøn uden at måle noget.
  it("der findes story-eksempler at måle, og en motor at måle dem mod", () => {
    expect(KORT.length, "ingen <p class=\"story-text\"> i site/index.html").toBeGreaterThanOrEqual(3);
    expect(sqlStrenge(SQL).length, "ingen strenge læst ud af sql/story_engine_v3.sql").toBeGreaterThan(50);
    // Uden markerede værdier falder fragment-opdelingen sammen til hele linjen,
    // og vagten ville måle sitets punktum frem for motorens ord.
    expect(KORT.some((k) => k.variable > 0), "ingen <span class=\"story-var\"> — se filens hoved").toBe(true);
  });

  it.each(KORT.map((k) => [k.tekst, k]))("»%s« bruger sin egen regels ord", (_, kort) => {
    // Kortet skal sige, hvilken regel det illustrerer, og reglen skal findes.
    // Ellers er der intet afsnit at måle imod, og alt nedenfor bliver tomt sandt.
    expect(kort.regel, "kortet mangler data-story-rule — se filens hoved").not.toBeNull();
    expect(
      kort.strenge.length,
      `reglen »${kort.regel}« har intet afsnit i sql/story_engine_v3.sql`,
    ).toBeGreaterThan(0);

    // Emojien er ikke pynt: den er kortets regel-signatur (⚔️ duel, 🔥 stime,
    // 🧠 kontrarian), og den skal stå FØRST i en af reglens strenge — ikke blot
    // findes et sted i den. Det er forskellen på den emoji, en overskrift
    // begynder med, og en, der tilfældigvis står midt i en brødtekst.
    expect(
      kort.strenge.some((s) => s.startsWith(kort.præfiks)),
      `»${kort.præfiks}« indleder ingen af ${kort.regel}s strenge`,
    ).toBe(true);

    // Et fragment skal stå inde i ÉN streng. At lede i strengene hver for sig
    // frem for i deres sammenkædning er med vilje: ellers kunne to skabeloner,
    // der ved et tilfælde ender og begynder rigtigt, tilsammen "indeholde" en
    // formulering, motoren aldrig skriver.
    for (const råt of kort.fragmenter) {
      const frag = trim(råt);
      if (!harBogstav(frag)) continue; // "–", "." og mellemrum er sitets egne
      expect(
        kort.strenge.some((s) => s.includes(frag)),
        `»${frag}« står ikke ordret i ${kort.regel} — enten er skabelonen ændret uden sitet, eller også er sitet skrevet frit`,
      ).toBe(true);
    }
  });
});
