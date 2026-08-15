import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

// Vagt mod DØDE HENVISNINGER og ANTALSDRIFT i dokumentationen (G111).
//
// ---------------------------------------------------------------------------
// HVORFOR DEN FINDES
//
// Klassen er MÅLT og ikke formodet. Konsistensgennemgangen 14. august 2026
// rettede ~60 uoverensstemmelser i `docs/`, og de to største fundklasser var
// **antalsdrift** (et tal i prosa, ingen opdaterer) og **døde fil:linje-ankre**.
// Begge er usynlige ved læsning — teksten ser rigtig ud — og begge kommer igen,
// fordi de opstår af helt almindelige flytninger: en fil omdøbes, en migrering
// kommer til, en spec flyttes.
//
// `G21`s princip er den halve kur: et tal, ingen opdaterer i samme ombæring,
// hører ikke hjemme i prosa. Den anden halvdel er en maskine, der kan se resten,
// og det er denne fil. Samme form og samme placering som `docs/backlog.test.js`
// (`G105`) og `saelgesaetning.test.js` (`G97`): en test, der læser filerne, og
// som ikke bærer sin egen kopi af det, den måler.
//
// ---------------------------------------------------------------------------
// HVORFOR PRÆCIS DISSE TRE PÅSTANDE
//
// Rækken er bevidst afgrænset til det MÅLBARE. Om en tekst er *sand*, kan kun
// et menneske afgøre; om en sti *findes*, kan en test. De tre nedenfor er dem,
// der kan stilles uden at gætte:
//
//   1. **Hver fil i `sql/` står i `sql/README.md`.** Registeret er dét, en
//      gendannelse læses af (`docs/RESTORE.md`), og en migrering, der ikke står
//      i det, findes i praksis ikke. Numrene er stabile navne (`#56` slås op
//      dér), så en fil uden en række kan ikke omtales.
//   2. **Hver sti i CLAUDE.md's rutetabel findes.** Rutetabellen er den ENESTE
//      indgang, en session har til dokumentationen, og en død sti dér koster den
//      næste læser et opslag, der ikke svarer.
//   3. **Hver dokumentfil i `docs/` er routet fra CLAUDE.md.** Den modsatte
//      retning af 2: en fil, ingen rute peger på, bliver ikke læst — og bliver
//      derfor heller ikke opdateret, hvilket er præcis den tilstand, drift
//      opstår i.
//
// **Påstand 1 og 2 er samme fejl set fra hver sin ende, og det er med vilje.**
// En omdøbning bryder den ene; en tilføjelse bryder den anden.
//
// ---------------------------------------------------------------------------
// HVORFOR "MINDST ÉT STED" OG IKKE "PRÆCIS ÉT STED"
//
// Rækken skrev "routet ét sted fra". Det viste sig at være en strammere regel,
// end virkeligheden tåler: `docs/BACKLOG.md`, `docs/DOMAENE.md` og
// `docs/STAGING.md` står hver TO gange i rutetabellen, fordi de svarer på to
// forskellige spørgsmål ("en idé du vil have gemt" og "noget der ikke er
// besluttet endnu" er ikke det samme opslag). En vagt, der forbød det, ville
// tvinge tabellen til at være dårligere som opslagsværk for at være pænere som
// indeks. Påstanden er derfor "mindst ét sted", og dét er også den, der fanger
// fejlen: en fil, INGEN rute peger på, er den, der forsvinder.
//
// ---------------------------------------------------------------------------
// HVAD DEN IKKE PÅSTÅR
//
// Ikke at en henvisning er RELEVANT, at et afsnitsnummer (`§13`) findes, eller
// at en beskrivelse passer til filen. Og ikke at LINJENUMRE holder: `fil:linje`
// var den anden store fundklasse, men et linjenummer, der er rykket tre linjer,
// peger stadig på noget — kun mennesket kan se, at det er det forkerte noget.
// Filen måler eksistens, ikke sandhed.

const HER = dirname(fileURLToPath(import.meta.url));
const ROD = join(HER, "..");
const læs = (f) => readFileSync(join(ROD, f), "utf8");

const CLAUDE = læs("CLAUDE.md");
const SQL_README = læs("sql/README.md");

// Alle filer under en mappe, som repo-relative stier med `/`.
function filer(mappe) {
  const ud = [];
  for (const navn of readdirSync(join(ROD, mappe))) {
    const sti = posix.join(mappe, navn);
    if (statSync(join(ROD, sti)).isDirectory()) ud.push(...filer(sti));
    else ud.push(sti);
  }
  return ud.sort();
}

// En tabelrække er en linje, der begynder med `|` og hverken er hovedet eller
// skillelinjen. Samme aflæsning som `docs/backlog.test.js` — markdown-tabeller
// er den ene struktur, begge filer måler.
const tabelrækker = (tekst) =>
  tekst
    .split("\n")
    .filter((l) => l.startsWith("|") && !l.startsWith("|---") && !/^\|\s*(#|Mappe|Fil|Skal du røre)\s*\|/.test(l));

// ---------------------------------------------------------------------------
// Hvad tæller som en STI i en backtick?
//
// Rutetabellen indeholder også ID'er (`G70`), migreringsnumre (`#56`),
// kommandoer (`npm run dev`) og ét DOMÆNE (`leagly.app`). Ingen af dem er filer,
// og en vagt, der kaldte dem det, ville være rød fra første kørsel.
//
// Skellet er endelsen og ikke formen: `leagly.app` og `sql/schema.sql` ser ens
// ud for en regex over tegn. Listen er derfor de endelser, repoet faktisk har,
// plus mapper (afsluttende `/`). Kommer en ny filtype til, skal den skrives her
// — og dét er billigere end at gætte, hvad der er en sti.
const ENDELSER = /\.(md|js|jsx|mjs|sql|ya?ml|json|html|css|txt|png)$/;
const erSti = (t) => t.endsWith("/") || ENDELSER.test(t);

function stierIRækker(rækker) {
  const ud = new Set();
  for (const række of rækker) {
    for (const m of række.matchAll(/`([^`]+)`/g)) {
      const t = m[1].trim();
      if (!/^[\w./-]+$/.test(t)) continue;   // mellemrum, §, · o.l. er ikke stier
      if (erSti(t)) ud.add(t);
    }
  }
  return [...ud].sort();
}

// CLAUDE.md's rutetabel: filens FØRSTE tabel, altså den, "Hvor står hvad"
// indleder. Prosaen nedenunder ("Ved produktbeslutninger og nye features læses
// desuden …") er ikke tabellen og måles ikke af påstand 2 — men den tæller som
// en rute i påstand 3, hvor spørgsmålet er, om filen overhovedet kan findes.
const RUTETABEL = tabelrækker(
  CLAUDE.slice(CLAUDE.indexOf("## Hvor står hvad"), CLAUDE.indexOf("## Når noget leveres")),
);

const RUTESTIER = stierIRækker(RUTETABEL);

// Filoversigten i `sql/README.md` — den nummererede tabel plus `—`-rækkerne
// (engangskørsler og ad hoc-værktøjer, som ikke har et migreringsnummer).
const SQL_FILTABEL = SQL_README.slice(SQL_README.indexOf("## Filoversigt og kørerækkefølge"));

// Migreringerne (`sql/*.sql`) og undermappernes filer holdes adskilt, fordi de
// måles mod hver sin påstand. `posix.dirname` og ikke et `includes("/")`: den
// første udgave af denne fil spurgte, om stien indeholdt en skråstreg — hvilket
// den ALTID gør, når den er repo-relativ — så listen blev tom, og påstanden var
// TRIVIEL SAND. Den fejl er præcis den klasse, filen findes for at fange, og den
// blev kun opdaget, fordi vagten blev prøvet af med en mutation. Derfor har
// begge lister nu en påstand om deres eget antal.
const MIGRERINGER = filer("sql").filter((f) => posix.dirname(f) === "sql" && f.endsWith(".sql"));
const UNDERMAPPE_FILER = filer("sql").filter((f) => posix.dirname(f) !== "sql");

describe("dokumentationens henvisninger (G111)", () => {
  // Vagten må ikke stå og bevogte ingenting. Omdøbes en overskrift, ville hver
  // påstand nedenfor blive triviel sand over en tom liste — samme selvkontrol
  // som `saelgesaetning.test.js` og `docs/backlog.test.js` bærer.
  it("finder de tre kilder, den måler", () => {
    expect(RUTETABEL.length, "CLAUDE.md's afsnit 'Hvor står hvad' blev ikke fundet").toBeGreaterThan(20);
    expect(RUTESTIER.length, "ingen stier læst ud af rutetabellen").toBeGreaterThan(20);
    expect(
      SQL_FILTABEL.length,
      "sql/README.md's afsnit 'Filoversigt og kørerækkefølge' blev ikke fundet",
    ).toBeGreaterThan(1000);
    expect(filer("docs").length, "ingen filer i docs/").toBeGreaterThan(10);
    // De to lister, påstand 1 måler. Uden dem kan en filtreringsfejl gøre begge
    // påstande triviel sande over en tom liste — hvilket den gjorde i filens
    // første udgave, se kommentaren ved listerne.
    expect(MIGRERINGER.length, "ingen migreringer læst ud af sql/").toBeGreaterThan(50);
    expect(UNDERMAPPE_FILER.length, "ingen filer læst ud af sql/-undermapperne").toBeGreaterThan(20);
  });

  // ---- Påstand 1 ----------------------------------------------------------
  // Migreringerne måles mod FILOVERSIGTEN og ikke mod hele README'en: en fil,
  // der kun er nævnt i en advarsel højere oppe, har ikke en række at slå op i,
  // og nummeret er dét, en commit-besked og en runbog taler i.
  it("hver migrering i sql/ har en række i sql/README.md's filoversigt", () => {
    const savnede = MIGRERINGER.map((f) => f.slice("sql/".length)).filter(
      (navn) => !SQL_FILTABEL.includes(`[\`${navn}\`](./${navn})`),
    );
    expect(savnede, `filer uden en række i filoversigten: ${savnede.join(", ")}`).toEqual([]);
  });

  // Undermapperne har ikke numre og står i prosa, så kravet er svagere: filen
  // skal være NÆVNT. Det er stadig nok til at fange den fejl, der findes — en
  // ny test eller kontrol, som ingen kan se er der.
  it("hver fil i sql/-undermapperne er nævnt i sql/README.md", () => {
    const savnede = UNDERMAPPE_FILER.map((f) => f.slice(f.lastIndexOf("/") + 1)).filter(
      (navn) => !SQL_README.includes(navn),
    );
    expect(savnede, `filer, sql/README.md ikke nævner: ${savnede.join(", ")}`).toEqual([]);
  });

  // ---- Påstand 2 ----------------------------------------------------------
  // Den døde henvisning, set fra rutetabellen. En sti, der er omdøbt eller
  // slettet, koster den næste session et opslag, der ikke svarer — og fejlen er
  // tavs, fordi tabellen stadig ser rigtig ud.
  it("hver sti i CLAUDE.md's rutetabel findes på disken", () => {
    const døde = RUTESTIER.filter((p) => !existsSync(join(ROD, p)));
    expect(døde, `stier i rutetabellen, der ikke findes: ${døde.join(", ")}`).toEqual([]);
  });

  // ---- Påstand 3 ----------------------------------------------------------
  // Den modsatte retning: en fil, ingen rute peger på. `*.test.js` er undtaget,
  // fordi de er KODE og ikke dokumentation — de køres af `npm test` og hører til
  // ved den fil, de vogter, ikke i et indeks over, hvad man skal læse.
  //
  // En fil er routet, hvis CLAUDE.md nævner enten dens egen sti eller den
  // MAPPE, den ligger i. Mapperuten er ikke en slækkelse, men den form, tabellen
  // faktisk bruger: `docs/reviews/` og `docs/features/` routes som mapper, fordi
  // indholdet vokser, og en række pr. fil ville være det næste sted, der driver.
  it("hver dokumentfil i docs/ er routet fra CLAUDE.md", () => {
    const uroutede = filer("docs")
      .filter((f) => !f.endsWith(".test.js"))
      .filter((f) => !CLAUDE.includes(f) && !CLAUDE.includes(`${posix.dirname(f)}/`));
    expect(uroutede, `filer i docs/, ingen rute i CLAUDE.md peger på: ${uroutede.join(", ")}`).toEqual([]);
  });
});
