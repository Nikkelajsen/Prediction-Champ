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
// blokken, og derfor står den her.
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

const ROD = fileURLToPath(new URL("../../", import.meta.url));
const DOCS = join(ROD, "docs");
const SKEMA = join(ROD, "sql", "schema.sql");

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

// ---------- 3. Skemaet, læst af en PG16-klient ----------

// `sql/schema.sql` er dumpet af pg_dump 17 fra en PG17-server. Tre ting i den
// findes ikke i PostgreSQL 16, som CI's service-container og runnerens psql
// kører. Alle tre er ren emballage — ingen af dem ændrer, hvilke tabeller,
// kolonner eller typer skemaet definerer, og det er dét, tjekket bruger det
// til. De fjernes her, hvor grunden kan stå ved siden af, frem for i en sed i
// en YAML-fil.
//
//   · `\restrict` / `\unrestrict` — psql-META-kommandoer, nye i psql 17.5.
//     En psql 16 svarer "invalid command" og stopper på ON_ERROR_STOP.
//   · `SET transaction_timeout` — GUC'en er ny i PG17.
//   · `MAINTAIN` — privilegiet er nyt i PG17 og optræder i ét grant på
//     public.matches. Kun rettigheder, ikke struktur.
//
// Bliver CI'ens Postgres nogensinde 17, kan hele funktionen ryge — men så skal
// runnerens psql-klient også være 17, og det er den, der bestemmer over
// `\restrict`.
function tilPG16(dump) {
  return dump
    .split("\n")
    .filter((l) => !/^\\(un)?restrict\b/.test(l))
    .filter((l) => !/^SET transaction_timeout\b/.test(l))
    .map((l) => l.replace(/\bMAINTAIN,/, "").replace(/,MAINTAIN\b/, ""))
    .join("\n");
}

// Rollerne og auth-skemaet, som Supabase leverer, og som dumpet forudsætter.
// Samme stubs som de øvrige tests i sql/tests/ bruger.
const PRELUDE = `
\\set ON_ERROR_STOP on
\\timing off

do $prelude$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role','supabase_admin'] loop
    if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I', r); end if;
  end loop;
end $prelude$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $fn$ select nullif(current_setting('test.uid', true), '')::uuid $fn$;
create or replace function auth.role() returns text language sql stable as
  $fn$ select coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $fn$;
create table if not exists auth.users (
  id uuid primary key, email text, encrypted_password text,
  raw_user_meta_data jsonb, created_at timestamptz
);

-- Dumpet indeholder selv \`create schema public\`.
drop schema if exists public cascade;
`;

// ---------- 4. Skriv kørslen ----------

function kørsel({ tjekkes, uddrag }, skema) {
  const ud = [PRELUDE, tilPG16(skema), "\nset search_path = public;\n"];

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
    process.stdout.write(kørsel(planlæg(findBlokke()), readFileSync(SKEMA, "utf8")));
  } catch (e) {
    process.stderr.write(`docs_sql: ${e.message}\n`);
    process.exit(1);
  }
}

export { UDDRAG, blokkeITekst, énSætning, planlæg, tilPG16, kørsel, findBlokke };
