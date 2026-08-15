import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Vagt over hjemmesidens story-eksempler (G103, udvidet med G110).
//
// ---------------------------------------------------------------------------
// HVAD KOBLINGEN ER
//
// Sitets story-citater er ikke opdigtede: de er skrevet af efter motorens egne
// ord i `sql/story_engine*.sql`. Site-opdateringen 13. august 2026 gjorde det
// med vilje — de opdigtede citater ("Du har slået Anders fem runder i træk")
// lovede noget, appen ikke sagde — men ærligheden skabte samtidig en kobling,
// ingen holdt øje med: omformuleres en skabelon i SQL'en, følger sitet ikke med,
// og salget citerer en motor, der siger noget andet. Nøjagtig samme tavse drift,
// som `saelgesaetning.test.js` (`G97`) blev bygget for at forhindre.
//
// Filen er derfor søskende til den, og svaret er det samme: teksten flyttes
// ikke, den måles. Sitet ligger uden for Vite-buildet og kan pr. konstruktion
// ikke importere noget, og SQL'en er ikke et modul, nogen kan hente en streng
// fra.
//
// ---------------------------------------------------------------------------
// G110: VAGTEN KENDTE KUN SIN FØRSTE FIL — I BEGGE ENDER
//
// Første udgave læste `site/index.html` og `sql/story_engine_v3.sql`, altså ét
// filnavn i hver ende. Begge var den fil, fejlen tilfældigvis blev fundet på, og
// begge er `G97`s fælde igen: **en vagt, der hårdkoder sin egen kilde, beskytter
// kun det, den allerede kendte.**
//
// Rækken (`G110`) beskrev den ene ende. Den anden blev fundet, da den første
// blev lukket, og den er den mere lærerige af de to:
//
//   · **Aftagersiden.** `site/funktioner.html` bærer også et story-citat ("Du
//     gik forbi Anders"), og det stod ubevogtet. Kuren er at læse MAPPEN.
//   · **Kildesiden.** Netop dét citat findes slet ikke i `story_engine_v3.sql`.
//     Det er `H2H_PASS` — en RUNDE-regel, som stadig bor i `story_engine.sql`,
//     fordi v3 afløste dagsmotoren og runderammerne, ikke runde-reglerne. En
//     vagt, der kun læste v3, ville altså have kaldt en ÆGTE formulering
//     opdigtet, i samme sekund den fik siden at se.
//
// Kilden er derfor `sql/story_engine*.sql`, og en regels afsnit hentes i den
// HØJESTE version, der definerer den: `DUEL` findes kun i v3, `H2H_PASS` kun i
// v1, og `CONTRARIAN` i begge — dér vinder v3, fordi den er den, der kører. En
// `story_engine_v4.sql` samles op af sig selv.
//
// ---------------------------------------------------------------------------
// HVORFOR DER IKKE MÅLES ORDRET
//
// **Rækkens præmis holdt ikke helt.** Den sagde, at sitets eksempler ER motorens
// ægte formuleringer, og ingen af dem er det ord for ord:
//
//   · Motoren sætter ikke punktum efter en overskrift. Sitet gør, fordi kortene
//     står som sætninger på en salgsside.
//   · Appen viser overskrift OG brødtekst (`screens/hjem/DayCard.jsx`); mockup'en
//     har én linje. Stime-kortet er derfor overskriftens 🔥 sat foran brødtekstens
//     ordlyd, og halen ("… efter den 3. august") er klippet af.
//   · Værdierne er valgt til et skærmbillede: "seks" står med bogstaver, hvor
//     motoren indsætter et tal.
//   · Et citat inde i en brødtekst har hverken emoji eller hale — `funktioner.html`
//     citerer `H2H_PASS` som "Du gik forbi Anders" midt i en sætning.
//
// Alle fire er redaktionelle valg, ikke drift, og en ordret sammenligning ville
// forbyde dem. Det, der KAN drive — og som er hele rækkens bekymring — er ordene
// imellem værdierne. Dem holder vagten fast:
//
//   1. Begynder linjen med et TEGN uden bogstaver (⚔️/🔥/🧠), er det kortets
//      regel-signatur, og den skal stå FØRST i en streng, reglen skriver.
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
//     Derfor bærer hvert citat på sitet `data-story-rule`, og der ledes kun i
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
// Udtrækkeren tæller derfor dybde frem for at lede efter det første sluttag:
// `<span class="story-text">` med et `story-var`-span indeni er lovlig markup,
// og et citat inde i en brødtekst kan ikke være et `<p>`. Uden dybdetællingen
// ville det citat blive klippet ved sin egen første variabel.
//
// ---------------------------------------------------------------------------
// HVAD DEN IKKE PÅSTÅR
//
// Ikke at eksemplerne er REPRÆSENTATIVE — hvilke af motorens regler et
// salgsbillede skal vise, er en produktbeslutning. Og ikke at værdierne er
// realistiske. Kun at hvert ord, sitet har lånt, stadig står i den regel, kortet
// siger, det kommer fra.
//
// Og den påstår ikke, at reglen stadig KØRER. Fjernes en regel af en ny
// motorversion, bliver dens afsnit i den gamle fil stående, og vagten ville
// finde ordene dér. Det ville kræve `sql/schema.sql` — produktionens
// øjebliksbillede — som kilde, og den er op til en uge bagud (`G124`), altså
// rød for enhver regel skrevet i dag. Prisen er valgt bevidst: en falsk rød ved
// hver ny regel er dyrere end en manglende rød ved en fjernet.

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

// ---------------------------------------------------------------------------
// Kilden: motoren, som den ser ud i repoet
//
// Mappen læses, ikke et filnavn (`G110`). Rangen er versionstallet i filnavnet,
// og den bruges til ét formål: når to versioner definerer den samme regel, er
// det den nyeste, der kører.
const MOTOR_FILER = readdirSync(join(ROD, "sql"))
  .filter((f) => /^story_engine.*\.sql$/.test(f))
  .map((f) => ({
    fil: `sql/${f}`,
    rang: Number((f.match(/_v(\d+)/) || [])[1] ?? 1),
    tekst: læs(`sql/${f}`),
  }))
  .sort((a, b) => a.rang - b.rang || a.fil.localeCompare(b.fil));

// Motorens STRENGE — ikke dens kommentarer.
//
// Scanneren er ikke en SQL-parser og skal ikke være det. Den kan to ting:
// springe `--`-kommentarer over og læse en `'…'`-streng med `''` som escapet
// apostrof. Filerne har hverken blokkommentarer eller `E'…'`-strenge (efterprøvet
// 15. august 2026), og skulle de få det, fejler vagten synligt frem for tavst:
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

// Én regels afsnit: fra sektionshovedet over den til det næste, i den HØJESTE
// motorversion, der nævner reglen. Hovederne er filernes egen inddeling
// (`-- ======== 150 · Duel …`), og regelnavnet står som sin egen streng præcis
// ét sted pr. fil, nemlig i den `insert`, der skriver kortet.
function regelAfsnit(regel) {
  for (const motor of [...MOTOR_FILER].reverse()) {
    const i = motor.tekst.indexOf(`'${regel}'`);
    if (i === -1) continue;
    const hoveder = [...motor.tekst.matchAll(/^[ \t]*-- ={4,}/gm)].map((m) => m.index);
    const start = Math.max(0, ...hoveder.filter((h) => h < i));
    const slut = Math.min(motor.tekst.length, ...hoveder.filter((h) => h > i));
    return { fil: motor.fil, tekst: motor.tekst.slice(start, slut) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Aftageren: hvert citat på hjemmesiden
//
// Mappen læses, ikke ét filnavn. Underkataloger springes over med vilje —
// `site/css`, `site/img` og `site/fonts` indeholder ingen HTML, og en
// rekursiv gennemgang ville kun gøre vagten langsommere.
const SITE_FILER = readdirSync(join(ROD, "site"))
  .filter((f) => f.endsWith(".html"))
  .sort();

// Ét citat = ét element med klassen `story-text`, dybde-afgrænset.
//
// Ikke en regex til sluttagget: et `story-var`-span INDE i et `story-text`-span
// ville lukke det ved den første variabel, og så ville halvdelen af citatet
// aldrig blive målt. Scanneren tæller derfor åbne og lukkede tags af samme navn.
function udtrækCitater(html) {
  const ud = [];
  const start = /<([a-z]+)\b([^>]*\bclass="story-text"[^>]*)>/g;
  let m;
  while ((m = start.exec(html)) !== null) {
    const [hele, tag, attributter] = m;
    const åbn = new RegExp(`<${tag}\\b`, "g");
    const luk = new RegExp(`</${tag}\\s*>`, "g");
    let i = m.index + hele.length;
    let dybde = 1;
    while (dybde > 0 && i < html.length) {
      åbn.lastIndex = i;
      luk.lastIndex = i;
      const a = åbn.exec(html);
      const l = luk.exec(html);
      if (!l) break;                               // uafsluttet markup
      if (a && a.index < l.index) { dybde++; i = a.index + a[0].length; continue; }
      dybde--;
      i = l.index + (dybde === 0 ? 0 : l[0].length);
    }
    ud.push({ attributter, indhold: html.slice(m.index + hele.length, i) });
    start.lastIndex = i;
  }
  return ud;
}

// Ét kort: reglen, fragmenterne mellem de markerede værdier, og reglens strenge.
function læsKort(fil, citat) {
  const regel = (citat.attributter.match(/data-story-rule="([^"]+)"/) || [])[1] || null;
  const stykker = afkod(citat.indhold).split(/<span class="story-var">[\s\S]*?<\/span>/g);
  const [først = "", ...resten] = stykker;
  const mellemrum = først.indexOf(" ");
  // Kun et indledende tegn UDEN bogstaver er en regel-signatur. "Du gik forbi"
  // begynder med et almindeligt ord, og dét skal måles som ordlyd — ikke som en
  // emoji, der skal indlede en streng.
  const muligtPræfiks = mellemrum === -1 ? først : først.slice(0, mellemrum);
  const erEmoji = muligtPræfiks !== "" && !harBogstav(muligtPræfiks);
  const afsnit = regel ? regelAfsnit(regel) : null;
  return {
    fil,
    regel,
    tekst: afkod(citat.indhold).replace(/<[^>]+>/g, "").trim(),
    præfiks: erEmoji ? muligtPræfiks : null,
    fragmenter: [erEmoji ? først.slice(mellemrum) : først, ...resten],
    variable: (citat.indhold.match(/<span class="story-var">/g) || []).length,
    kilde: afsnit?.fil ?? null,
    strenge: afsnit ? sqlStrenge(afsnit.tekst) : [],
  };
}

const KORT = SITE_FILER.flatMap((fil) =>
  udtrækCitater(læs(`site/${fil}`)).map((c) => læsKort(fil, c)),
);

describe("hjemmesidens story-eksempler er motorens ordlyd (G103, G110)", () => {
  // Vagten må ikke stå og bevogte ingenting. Forsvinder klassenavnet fra sitet,
  // eller omdøbes SQL-filerne, ville hver påstand nedenfor blive triviel sand
  // over en tom liste, og filen ville blive ved med at være grøn uden at måle
  // noget. Efter `G110` gælder det også MAPPERNE: findes der ingen HTML-filer i
  // `site/` og ingen motorfiler i `sql/`, er der intet at måle.
  it("der findes story-eksempler at måle, og en motor at måle dem mod", () => {
    expect(SITE_FILER.length, "ingen .html-filer i site/").toBeGreaterThan(0);
    expect(MOTOR_FILER.length, "ingen sql/story_engine*.sql").toBeGreaterThan(0);
    expect(KORT.length, 'ingen class="story-text" i site/').toBeGreaterThanOrEqual(3);
    expect(
      new Set(KORT.map((k) => k.fil)).size,
      "kun én side i site/ bærer story-citater — er en side blevet umarkeret?",
    ).toBeGreaterThanOrEqual(2);
    // Summen og ikke fil for fil: `story_engine_backfill.sql` er en efterfyldning
    // og bærer ingen skabeloner, så et krav pr. fil ville måle mappens indhold
    // frem for scannerens virkning. Den påstand, der betyder noget — at DENNE
    // regels afsnit har strenge — stilles pr. kort nedenfor.
    expect(
      MOTOR_FILER.reduce((n, m) => n + sqlStrenge(m.tekst).length, 0),
      "ingen strenge læst ud af sql/story_engine*.sql",
    ).toBeGreaterThan(50);
    // Uden markerede værdier falder fragment-opdelingen sammen til hele linjen,
    // og vagten ville måle sitets punktum frem for motorens ord.
    expect(KORT.some((k) => k.variable > 0), 'ingen <span class="story-var"> — se filens hoved').toBe(true);
  });

  it.each(KORT.map((k) => [`${k.fil}: ${k.tekst}`, k]))("»%s« bruger sin egen regels ord", (_, kort) => {
    // Kortet skal sige, hvilken regel det illustrerer, og reglen skal findes.
    // Ellers er der intet afsnit at måle imod, og alt nedenfor bliver tomt sandt.
    expect(kort.regel, `${kort.fil}: citatet mangler data-story-rule — se filens hoved`).not.toBeNull();
    expect(
      kort.strenge.length,
      `reglen »${kort.regel}« har intet afsnit i nogen sql/story_engine*.sql`,
    ).toBeGreaterThan(0);

    // Emojien er ikke pynt: den er kortets regel-signatur (⚔️ duel, 🔥 stime,
    // 🧠 kontrarian), og den skal stå FØRST i en af reglens strenge — ikke blot
    // findes et sted i den. Det er forskellen på den emoji, en overskrift
    // begynder med, og en, der tilfældigvis står midt i en brødtekst. Et citat
    // uden emoji (inde i en brødtekst) har ingen signatur at måle.
    if (kort.præfiks !== null) {
      expect(
        kort.strenge.some((s) => s.startsWith(kort.præfiks)),
        `»${kort.præfiks}« indleder ingen af ${kort.regel}s strenge i ${kort.kilde}`,
      ).toBe(true);
    }

    // Et fragment skal stå inde i ÉN streng. At lede i strengene hver for sig
    // frem for i deres sammenkædning er med vilje: ellers kunne to skabeloner,
    // der ved et tilfælde ender og begynder rigtigt, tilsammen "indeholde" en
    // formulering, motoren aldrig skriver.
    for (const råt of kort.fragmenter) {
      const frag = trim(råt);
      if (!harBogstav(frag)) continue; // "–", "." og mellemrum er sitets egne
      expect(
        kort.strenge.some((s) => s.includes(frag)),
        `»${frag}« står ikke ordret i ${kort.regel} (${kort.kilde}) — enten er skabelonen ændret uden sitet, eller også er sitet skrevet frit`,
      ).toBe(true);
    }
  });
});
