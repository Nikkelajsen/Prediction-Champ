// G74: SQL-blokkene i docs/ er påstande, indtil nogen kører dem.
//
// HVORFOR DEN FINDES. `B12`s §5F-forespørgsel stod fra august 2026 med teksten
// "forespørgslen er skrevet, tilbage står at køre den" — og da den blev kørt 5.
// august, afviste PostgreSQL den med `42803`. Backloggen havde imens
// prioriteret rækken som "et opslag, vi allerede har svaret på". En blok i et
// dokument koster ingenting at skrive og ser rigtig ud i al den tid, ingen
// prøver den.
//
// HVORFOR IKKE BARE ET SYNTAKSTJEK. Det ville ikke have fanget `B12`.
// `42803` (`grouping_error`) opstår i parse-ANALYSEN, ikke i parseren: den
// kræver, at serveren kender `competitions` og dens kolonner. Et tjek mod et
// TOMT skema ville have svaret "ukendt tabel" på hver eneste blok og dermed
// hverken kunne skelne en god fra en dårlig. Rækken stillede spørgsmålet som
// "kan blokkene tjekkes UDEN produktionsskemaet" — svaret er nej, og det
// behøver de heller ikke: `sql/schema.sql` ER skemaet, og det ligger i repoet.
//
// PRISEN, sagt højt. Tjekket arver `schema.sql`s ene forbehold (sql/README.md):
// filen er et GENERERET øjebliksbillede og kun sand, når eksporten er kørt efter
// seneste migrering. Skriver nogen en blok mod en kolonne, der er tilføjet af en
// migrering, der endnu ikke er eksporteret, fejler tjekket. Det er den rigtige
// fejl at få — den siger, at eksporten mangler — men den ser ud som en fejl i
// blokken.
//
// PRISEN ER NU EN MÅLING og ikke længere kun en advarsel i dette hoved (G79).
// `friskhed()` nedenfor spørger migreringerne i sql/, hvilke tabeller, kolonner
// og funktioner de opretter, og slår hver enkelt op i dumpet. Svaret skrives
// ØVERST i kørslen, før den første blok, så en rød blok kan skelnes fra en
// manglende eksport ved at læse ét sted:
//
//   · dækker eksporten alt, migreringerne opretter, er en fejl herunder en fejl
//     i BLOKKEN — dumpet kan ikke forklare den;
//   · mangler eksporten noget, står navnene og deres migreringsfil på stderr,
//     og en `42703`/`42P01` herunder skal læses som "kør skema-eksporten".
//
// Målingen FÆLDER IKKE kørslen af sig selv. En migrering, der lige er skrevet,
// er lovligt forud for eksporten (den kører mandage og manuelt), og et rødt CI
// på hver eneste migrerings-PR ville lære folk at se bort fra netop den farve.
// Den siger noget, den afviser ikke.
//
// HVORDAN. `prepare` uden `execute`: serveren parser og analyserer sætningen
// mod det rigtige skema uden at røre en eneste række. Det er også derfor et
// `update` i et dokument er ufarligt at tjekke — den bliver aldrig udført.
//
// Scriptet SKRIVER hele kørslen (skema + tjek) til stdout, så CI-trinnet er ét
// psql-kald. Al viden om, hvordan et PG17-dump læses af en PG16-klient, bor
// dermed her og ikke i en YAML-fil.
//
// Kør lokalt:
//   node sql/tests/docs_sql.mjs > /tmp/docs_sql.gen.sql
//   psql -d docssql -v ON_ERROR_STOP=1 -f /tmp/docs_sql.gen.sql
//
// De rene dele er eksporteret og dækket af docs_sql.test.mjs. Det er ikke
// pedanteri: to af stierne her er afvisninger (ukendt markør, flere sætninger),
// og en afvisning, der aldrig er kørt, er præcis den slags kode, `G72` og `G76`
// er rækker om.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
// Skemaet bygges af _schema.mjs, som sæson-simulatorens test (G82) også bruger.
// Reglerne for at læse et PG17-dump med en PG16-klient bor derfor ét sted.
import { SKEMA, skemaKørsel, tilPG16 } from "./_schema.mjs";

const ROD = fileURLToPath(new URL("../../", import.meta.url));
const DOCS = join(ROD, "docs");

// Den ENESTE lovlige måde at slippe uden om tjekket. Et uddrag er en blok, der
// ikke er en hel sætning — et skema-udkast, en `join`-linje, en `delete` med en
// plpgsql-variabel i. Markøren er et ord i info-strengen:
//
//     ```sql uddrag
//
// GitHub farvelægger stadig efter det første ord, så visningen er uændret.
// Valget er OPT-OUT og ikke opt-in med vilje: en ny forespørgsel skal være
// dækket, fordi nogen skrev den, ikke fordi nogen huskede en markør. Et uddrag
// koster til gengæld en bevidst håndbevægelse — og bliver talt op nedenfor, så
// et voksende antal er synligt frem for stille.
const UDDRAG = "uddrag";

// ---------- 1. Find blokkene ----------

function markdownFiler(dir) {
  const ud = [];
  for (const navn of readdirSync(dir).sort()) {
    const sti = join(dir, navn);
    if (statSync(sti).isDirectory()) ud.push(...markdownFiler(sti));
    else if (navn.endsWith(".md")) ud.push(sti);
  }
  return ud;
}

// Blokkene i én markdown-tekst. Hegnet kan være indrykket
// (docs/features/flere-datakilder-v1.md har blokke inde i en nummereret liste),
// så indrykningen fanges og trækkes fra hver linje — ellers ville SQL'en bære
// listens indryk med ind i `prepare`.
function blokkeITekst(tekst, fil) {
  const linjer = tekst.split("\n");
  const ud = [];
  for (let i = 0; i < linjer.length; i++) {
    const start = /^(\s*)```sql(.*)$/.exec(linjer[i]);
    if (!start) continue;
    const [, indryk, rest] = start;
    const krop = [];
    let j = i + 1;
    for (; j < linjer.length && !/^\s*```\s*$/.test(linjer[j]); j++) {
      krop.push(linjer[j].startsWith(indryk) ? linjer[j].slice(indryk.length) : linjer[j].trimStart());
    }
    if (j >= linjer.length) throw new Error(`${fil}:${i + 1}: SQL-blokken lukkes aldrig.`);
    ud.push({ fil, linje: i + 1, markør: rest.trim(), sql: krop.join("\n") });
    i = j;
  }
  return ud;
}

// ---------- 2. Afvis det, der ikke kan tjekkes som ÉN sætning ----------

// Kommentarer og strenge ud, så `;` kun tælles dér, hvor den afslutter en
// sætning. Grov, men den skal kun kunne skelne "én sætning" fra "flere".
function udenStøj(sql) {
  return sql
    .replace(/\$\$[\s\S]*?\$\$/g, "''")   // dollar-citerede kroppe
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/'(?:[^']|'')*'/g, "''");
}

function énSætning(sql) {
  return !udenStøj(sql).trim().replace(/;\s*$/, "").includes(";");
}

// Deler blokkene i dem, der tjekkes, og dem, der springes over — og kaster på
// alt, der hverken er det ene eller det andet.
function planlæg(blokke) {
  const ukendt = blokke.filter((b) => b.markør && b.markør !== UDDRAG);
  if (ukendt.length) {
    throw new Error(
      `ukendt markør på SQL-blok: ${ukendt.map((b) => `${b.fil}:${b.linje} ("${b.markør}")`).join(", ")}`
      + `\n  Lovligt: \`\`\`sql (tjekkes) eller \`\`\`sql ${UDDRAG} (springes over).`);
  }
  const tjekkes = blokke.filter((b) => b.markør !== UDDRAG);
  const uddrag = blokke.filter((b) => b.markør === UDDRAG);

  const flere = tjekkes.filter((b) => !énSætning(b.sql));
  if (flere.length) {
    throw new Error(
      `en tjekket blok skal være ÉN sætning: ${flere.map((b) => `${b.fil}:${b.linje}`).join(", ")}`
      + `\n  Del blokken op, eller markér den \`\`\`sql ${UDDRAG}, hvis den ikke er en færdig sætning.`);
  }
  return { tjekkes, uddrag };
}

// ---------- 2b. Er eksporten på højde med migreringerne? (G79) ----------

// Filer i sql/ som IKKE er migreringer mod produktionsskemaet, og som derfor
// ikke må tælle med, når dumpet holdes op mod dem.
//   · schema.sql          — dumpet selv.
//   · *.superseded.sql    — bevidst afløst; dens objekter behøver ikke findes.
// Undermapperne (dev/, tests/, checks/) læses ikke: `readdirSync` uden rekursion
// rammer kun sql/ selv, og det er præcis de filer, ejeren kører i Supabase.
const IKKE_MIGRERING = (navn) => navn === "schema.sql" || navn.endsWith(".superseded.sql");

// Kroppe, kommentarer og strenge ud, før der ledes efter `create`/`alter`.
// Dollar-citerede kroppe er den vigtige af de tre: hver eneste `create
// temporary table _sd_scored` inde i en plpgsql-funktion ville ellers blive
// læst som en tabel, produktionen burde have.
function udenKroppe(sql) {
  return sql
    .replace(/\$([a-zA-Z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/'(?:[^']|'')*'/g, "''");
}

// Hvad en migrering LOVER, at produktionsskemaet indeholder. Tre slags, valgt
// fordi de er dem, en docs-blok kan navngive og fejle på: en tabel (`42P01`),
// en kolonne (`42703`) og en funktion (`42883`).
//
// `temp`/`temporary` udelades: motorernes mellemregninger er ikke skema.
function løfter(sql, fil) {
  const ud = [];
  const tekst = udenKroppe(sql);

  for (const m of tekst.matchAll(/\bcreate\s+(?:or\s+replace\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
    ud.push({ slags: "tabel", navn: m[1].toLowerCase(), fil });
  }
  for (const m of tekst.matchAll(/\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) {
    ud.push({ slags: "kolonne", navn: `${m[1].toLowerCase()}.${m[2].toLowerCase()}`, fil });
  }
  for (const m of tekst.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi)) {
    ud.push({ slags: "funktion", navn: m[1].toLowerCase(), fil });
  }
  return ud;
}

// Og hvad en migrering tager væk igen. `cleanup_orphans.sql` fjerner kolonner,
// andre filer afløser en funktion med en anden signatur — uden dette ville de
// stå som "mangler i eksporten" for evigt.
//
// Der ses bevidst bort fra RÆKKEFØLGEN mellem filerne: et navn, der både
// oprettes og droppes et sted i sql/, tælles ikke med. Det er den forsigtige
// retning — en oprydning kan skjule et hul, men et hul, der er lukket igen,
// kan ikke larme.
function fjernelser(sql) {
  const ud = new Set();
  const tekst = udenKroppe(sql);
  for (const m of tekst.matchAll(/\bdrop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) ud.add(m[1].toLowerCase());
  for (const m of tekst.matchAll(/\bdrop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) ud.add(m[1].toLowerCase());
  for (const m of tekst.matchAll(/\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s+drop\s+column\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) {
    ud.add(`${m[1].toLowerCase()}.${m[2].toLowerCase()}`);
  }
  return ud;
}

// Findes løftet i dumpet? pg_dump skriver hvert objekt på sin egen kanoniske
// form, så opslagene er bogstavelige og ikke heuristiske.
function iDumpet(dump, løfte) {
  if (løfte.slags === "tabel") {
    return new RegExp(`^CREATE TABLE public\\.${løfte.navn} \\(`, "mi").test(dump);
  }
  if (løfte.slags === "funktion") {
    return new RegExp(`^CREATE (OR REPLACE )?FUNCTION public\\.${løfte.navn}\\(`, "mi").test(dump);
  }
  const [tabel, kolonne] = løfte.navn.split(".");
  const blok = new RegExp(`^CREATE TABLE public\\.${tabel} \\(([\\s\\S]*?)^\\);`, "mi").exec(dump);
  // Mangler selve tabellen, er det tabellen der rapporteres — ikke hver af dens
  // kolonner. Ellers ville én manglende eksport give tyve linjer om samme sag.
  if (!blok) return true;
  return new RegExp(`^\\s+${kolonne}\\s`, "mi").test(blok[1]);
}

// Alle migreringers løfter, holdt op mod dumpet. Returnerer BÅDE tallet, der
// blev tjekket, og det, der manglede — en grøn kørsel skal kunne sige, hvor
// meget den faktisk så på.
function friskhed(dump, mappe = join(ROD, "sql")) {
  const filer = readdirSync(mappe).sort().filter((n) => n.endsWith(".sql") && !IKKE_MIGRERING(n));
  const alle = [];
  const fjernet = new Set();
  for (const navn of filer) {
    const sql = readFileSync(join(mappe, navn), "utf8");
    alle.push(...løfter(sql, navn));
    for (const n of fjernelser(sql)) fjernet.add(n);
  }
  const set = new Map();
  for (const l of alle) {
    if (fjernet.has(l.navn) || fjernet.has(l.navn.split(".")[0])) continue;
    if (!set.has(`${l.slags}:${l.navn}`)) set.set(`${l.slags}:${l.navn}`, l);
  }
  const løfteliste = [...set.values()];
  return { tjekket: løfteliste.length, mangler: løfteliste.filter((l) => !iDumpet(dump, l)) };
}

// ---------- 4. Skriv kørslen ----------

// psql-sikker enkeltcitatstreng: `\echo`/`\warn` tager resten af linjen, så
// kun citatet og nylinjen skal væk.
function citat(s) {
  return `'${String(s).replace(/'/g, "''").replace(/[\r\n]+/g, " ")}'`;
}

// Friskheds-dommen, skrevet FØR den første blok (G79). Den grønne udgave er
// lige så vigtig som den røde: siger kørslen "eksporten dækker alle 214
// objekter", er en fejl længere nede en fejl i blokken, og så skal ingen bruge
// tid på at overveje, om dumpet var gammelt.
function friskhedsLinjer({ tjekket, mangler }) {
  if (!mangler.length) {
    return [
      `\\echo 'Eksporten er på højde med migreringerne: alle ${tjekket} objekter i sql/*.sql findes i schema.sql.'`,
      `\\echo 'En fejl herunder er derfor en fejl i BLOKKEN — dumpet kan ikke forklare den.'`,
    ];
  }
  // `\warn` og ikke `\echo`: linjerne skal stå på stderr, samme sted som psql
  // selv skriver den fejl, de forklarer.
  const ud = [
    `\\warn '================================================================'`,
    `\\warn 'ADVARSEL: sql/schema.sql er BAGUD i forhold til migreringerne.'`,
    `\\warn '${mangler.length} af ${tjekket} objekter i sql/*.sql findes ikke i dumpet:'`,
  ];
  for (const m of mangler) ud.push(`\\warn ${citat(`   - ${m.slags} ${m.navn}  (${m.fil})`)}`);
  ud.push(
    `\\warn 'Fejler en blok herunder med 42P01/42703/42883, er DET forklaringen:'`,
    `\\warn 'blokken er skrevet mod skemaet, dumpet er ikke. Kør skema-eksporten'`,
    `\\warn '(.github/workflows/schema-export.yml) og prøv igen, før du retter blokken.'`,
    `\\warn '================================================================'`,
  );
  return ud;
}

function kørsel({ tjekkes, uddrag }, skema, frisk = { tjekket: 0, mangler: [] }) {
  const ud = [skemaKørsel(skema)];

  ud.push(...friskhedsLinjer(frisk), "");

  // De sprungne står FØRST og med navn. En grænse, der ikke siges højt, læses
  // som "alt er dækket" — og det er netop den læsning, `B12` faldt for.
  ud.push(`\\echo '${tjekkes.length} SQL-blokke i docs/ tjekkes mod schema.sql.'`);
  ud.push(`\\echo '${uddrag.length} er markeret "${UDDRAG}" og springes over:'`);
  for (const b of uddrag) ud.push(`\\echo '   - ${b.fil}:${b.linje}'`);
  ud.push("");

  tjekkes.forEach((b, n) => {
    const navn = `docblok_${n + 1}`;
    ud.push(`\\echo '=> ${b.fil}:${b.linje}'`);
    ud.push(`prepare ${navn} as`);
    ud.push(b.sql.trim().replace(/;\s*$/, ""));
    ud.push(";");
    ud.push(`deallocate ${navn};`);
    ud.push("");
  });

  ud.push(`\\echo 'Alle ${tjekkes.length} blokke blev accepteret af PostgreSQL.'`);
  return ud.join("\n");
}

function findBlokke() {
  const blokke = markdownFiler(DOCS)
    .flatMap((sti) => blokkeITekst(readFileSync(sti, "utf8"), relative(ROD, sti)));
  if (!blokke.length) throw new Error("fandt ingen ```sql-blokke i docs/ — er stien flyttet?");
  return blokke;
}

// Kun når scriptet KØRES. Testen importerer de rene dele uden at skrive noget.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const skema = readFileSync(SKEMA, "utf8");
    process.stdout.write(kørsel(planlæg(findBlokke()), skema, friskhed(skema)));
  } catch (e) {
    process.stderr.write(`docs_sql: ${e.message}\n`);
    process.exit(1);
  }
}

export { UDDRAG, blokkeITekst, énSætning, planlæg, tilPG16, kørsel, findBlokke, løfter, fjernelser, iDumpet, friskhed, friskhedsLinjer };
