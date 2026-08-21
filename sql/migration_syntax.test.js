import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Migreringerne i sql/ køres i **Supabases SQL-editor**, som sender ren SQL til
// serveren. Den kender ikke psql's backslash-kommandoer (`\timing`, `\ir`,
// `\set`, `\echo`), og en enkelt af dem stopper hele kørslen med
//   ERROR: 42601: syntax error at or near "\"
// midt i filen — altså efter at noget af den er kørt.
//
// Det skete for `story_engine_v2_backfill.sql` (august 2026), og fejlen kan
// hverken ses ved at læse filen eller fanges af SQL-testene: de køres
// udelukkende gennem psql i CI, hvor kommandoerne er fuldt lovlige. Derfor
// denne vagt, som kører i `verify`-jobbet sammen med resten af enhedstestene.
//
// Undtagelserne er præcis to slags filer:
//   · sql/tests/**  — køres KUN gennem psql og BRUGER `\ir`/`\set` bevidst.
//   · sql/schema.sql — genereret pg_dump-øjebliksbillede (`\restrict`). Den
//     KØRES i hånden, når et miljø bygges op fra bunden (staging, gendannelse)
//     — men den kan ikke rettes, for den er et dump. Prisen betales i stedet
//     ved kørslen: de to `\restrict`-linjer skal fjernes, før den kan pastes i
//     SQL-editoren, og opskriften står i docs/STAGING.md trin 2. Undtagelsen
//     her er altså "kan ikke rettes", ikke "køres aldrig i hånden" — sidstnævnte
//     stod her indtil august 2026 og var forkert.
const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)));
const EXEMPT = new Set(["schema.sql"]);

// `sql/dev/` er ikke migreringer, men værktøjer, der pastes i SQL-editoren
// præcis som en migrering — og rammer derfor præcis samme fælde. De tages med
// i vagten af samme grund, som `sql/tests/**` holdes ude af den: det afgørende
// er ikke, om filen er en migrering, men om den pastes i editoren.
//
// `sql/checks/` er af samme grund IKKE med (G84, august 2026): filerne dér er
// overvågnings-forespørgsler, som køres af `job-heartbeat.yml` og af CI gennem
// psql, aldrig i editoren. De må gerne bruge psql-kommandoer — de gør det bare
// ikke i dag.
const migrations = [
  ...readdirSync(SQL_DIR)
    .filter((f) => f.endsWith(".sql") && !EXEMPT.has(f))
    .sort(),
  ...readdirSync(join(SQL_DIR, "dev"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join("dev", f)),
];

describe("migreringer i sql/ kan køres i Supabase SQL-editoren", () => {
  it("finder migreringsfilerne (vagten må ikke stå og bevogte ingenting)", () => {
    expect(migrations.length).toBeGreaterThan(20);
  });

  it("dækker også sql/dev/, som pastes i editoren på samme måde", () => {
    expect(migrations.some((f) => f.startsWith("dev"))).toBe(true);
  });

  it.each(migrations)("%s indeholder ingen psql-kommandoer", (file) => {
    const offending = readFileSync(join(SQL_DIR, file), "utf8")
      .split("\n")
      .map((line, i) => ({ line: line.trimEnd(), n: i + 1 }))
      // En backslash FØRST på linjen er en psql-meta-kommando. Backslash inde i
      // en streng eller et regulært udtryk er derimod almindelig SQL og går fri.
      .filter(({ line }) => /^\\[a-z]/i.test(line))
      .map(({ line, n }) => `${file}:${n}: ${line}`);

    expect(offending, offending.join("\n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// VAGT 2: UPDATE/DELETE UDEN `where` (august 2026)
//
// Supabase indlæser **pg_safeupdate** via `session_preload_libraries` på rollen
// `authenticator` — altså i enhver session, PostgREST åbner. Den afviser
// `UPDATE`/`DELETE` uden `where` med `UPDATE requires a WHERE clause`.
// SQL-editoren forbinder som `postgres` og indlæser den IKKE.
//
// Det giver den værst tænkelige asymmetri: en sætning uden `where` virker, hver
// gang et menneske kører den i hånden, og fejler hver gang appen udløser den.
// Story Engine v3 blev udrullet med præcis én af dem inde i
// `generate_daily_stories` (`update _sd_scored set news_value = …`), og
// dagslaget skrev derfor aldrig én eneste række i produktion. Fejlen var tavs,
// fordi matches-triggerens exception-guard slugte den, og den overlevede fire
// afkræftede hypoteser, en måling og en manuel kørsel, der alle så rigtige ud.
//
// Vagten er bevidst grov: den ser på sætninger, ikke på om de rent faktisk kan
// nås fra PostgREST. En `where`-løs sætning i en funktion, ingen kalder over
// API'et, er stadig en fælde, der venter på sin første kalder.
//
// `sql/dev/` er UNDTAGET her, og undtagelsen vender præcis modsat vagt 1's.
// Vagt 1 tager dev/ MED, fordi filerne pastes i editoren ligesom en migrering.
// Vagt 2 lader dem gå, af nøjagtig samme grund: editoren er det ene sted,
// pg_safeupdate ikke er indlæst. Simulatorens `delete from sim.persona;` kan
// aldrig nås fra PostgREST — `sql/dev/` er staging-værktøj, der køres i hånden,
// og `sql/tests/simulate_season.sql` beviser i CI, at den kører.
const SQL_ALL = [
  ...migrations.filter((f) => !f.startsWith("dev")),
  ...readdirSync(join(SQL_DIR, "checks"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join("checks", f)),
];

describe("ingen UPDATE/DELETE uden where (pg_safeupdate afviser dem via PostgREST)", () => {
  it.each(SQL_ALL)("%s", (file) => {
    const src = readFileSync(join(SQL_DIR, file), "utf8")
      // Kommentarer ud først, ellers tæller et "-- … where …" som en qual.
      .replace(/--[^\n]*/g, "");

    // Sætninger, ikke linjer: `update x set …\n  where …` er lovlig, og en
    // linjebaseret vagt ville melde den. Semikolon afgrænser, hvilket er groft
    // nok — en semikolon inde i en streng ville give en falsk positiv, og den
    // dag det sker, er svaret at omskrive strengen, ikke at svække vagten.
    const offending = [];
    const re = /\b(update|delete\s+from)\s+[a-z_][a-z0-9_."]*\b[\s\S]*?;/gi;
    for (const m of src.matchAll(re)) {
      const stmt = m[0];
      // `create policy … for update to authenticated using (…)` og
      // `grant update on …` er ikke sætninger — de rammes af regexet, men
      // indeholder aldrig `set`/`from` i sætnings-forstand. Kræv derfor, at en
      // UPDATE har `set` og en DELETE står alene.
      const isUpdate = /^update\b/i.test(stmt);
      if (isUpdate && !/\bset\b/i.test(stmt)) continue;
      if (/\bwhere\b/i.test(stmt)) continue;
      const n = src.slice(0, m.index).split("\n").length;
      offending.push(`${file}:${n}: ${stmt.split("\n")[0].trim()}`);
    }

    expect(offending, offending.join("\n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Vagt 3: dagskortets tekster må ikke stå i nutid (G89, 8. august 2026)
//
// Et dagskort lever i 48 timer, og en stilling er live pr. kamp. En sætning som
// "Du ligger nr. 3 af 8" eller "Kun 2 point op til Bo" er derfor en påstand om
// NUET, der kan være usand, mens kortet stadig står på Hjem. Det er samme
// fejltype, som `A38` rettede for tre af runde-reglerne, og `G89` for dagens.
//
// **VAGTEN LÆSER KILDEN OG IKKE RÆKKERNE, og det er hele grunden til, at den
// findes her og ikke i sql/tests/story_engine_daily.sql.** En SQL-påstand kan
// kun se kort, fixturen faktisk udgiver, og fixturen udgiver tre af de otte
// dagsregler — DAY_RESULT, DAY_TOP og MILESTONE. En sortliste mod `stories`
// var derfor grøn for DUEL, SO_CLOSE, CONTRARIAN, COLLECTIVE_MISS og
// STREAK_STATUS, uanset hvad der stod i deres tekst. Det blev opdaget ved at
// mutere alle fem fraser tilbage til nutid: to blev fanget, tre slap.
//
// Samme mønster som katalogvagten i src/lib/analytics.test.js, som læser
// sql/story_engine*.sql for at fange drift, og af samme grund: filen er kilden.
const NUTIDS_FRASER = [
  " Du ligger nr. ",          // DAY_RESULT, øverste halvdel
  " Toppen er ",              // DAY_RESULT, nederste halvdel
  "'⚔️ Kun '",                // DUEL-overskrift: "Kun N point op til X"
  " er ' || d.gap ||",        // DUEL-overskrift: "X er N point efter dig"
  " er der ' ||",             // DUEL-brødtekst: "Efter den 03.08 er der …"
];

describe("dagskortets tekster står i datid (G89)", () => {
  const DAGSMOTOR = "story_engine_v3.sql";

  it("filen findes (vagten må ikke stå og bevogte ingenting)", () => {
    expect(migrations).toContain(DAGSMOTOR);
  });

  // Fraserne er PRÆCISE og ikke brede med vilje. Første udgave sortlistede
  // " point op til ' ||", som også rammer den nye, LOVLIGE brødtekst
  // ("… var der N point op til X") — en vagt, der fælder rettelsen, bliver
  // slået fra ved første kørsel. Hver frase peger derfor på den nøjagtige
  // gamle formulering.
  it.each(NUTIDS_FRASER)("ingen tekst indeholder %j", (frase) => {
    // Kommentarer ud først. Uden det ville vagten fælde sin egen begrundelse:
    // kommentaren over DUEL citerer de gamle formuleringer ved navn.
    const src = readFileSync(join(SQL_DIR, DAGSMOTOR), "utf8").replace(/--[^\n]*/g, "");
    expect(src, `"${frase}" er en udateret påstand om nuet — se G89`).not.toContain(frase);
  });

  // Og at datid-formen FAKTISK står der. Uden dette ville vagten ovenfor være
  // grøn, hvis nogen slettede sætningerne helt i stedet for at rette dem.
  it("datid-formen er den, der faktisk skrives", () => {
    const src = readFileSync(join(SQL_DIR, DAGSMOTOR), "utf8").replace(/--[^\n]*/g, "");
    for (const frase of [" Du sluttede dagen som nr. ", " Toppen var ", "Du sluttede dagen ' ||", " endte ' || d.gap ||", " var der ' ||"]) {
      expect(src, `datid-formen "${frase}" mangler`).toContain(frase);
    }
  });
});

// ---------------------------------------------------------------------------
// Vagt 4: dagsmotoren skriver det KORTE holdnavn (B39, 21. august 2026)
//
// Samme form og samme begrundelse som vagt 3 ovenfor: reglen står seks steder i
// `story_engine_v3.sql`, og en påstand mod `stories` ville kun kunne se de tre
// af otte regler, fixturen faktisk udgiver. COLLECTIVE_MISS — den ene, hvis
// OVERSKRIFT bærer to holdnavne — er netop en af de fem, den ikke fyrer, så en
// række-påstand ville være grøn, uanset hvad der stod i den.
//
// Vagten er tosidet af samme grund som vagt 3: den forbyder det bare `th.name`
// OG kræver, at `coalesce`-formen faktisk står der. Uden den anden halvdel ville
// et navn, nogen slettede helt, være grønt.
describe("dagskortets holdnavne er de korte (B39)", () => {
  const DAGSMOTOR = "story_engine_v3.sql";
  // De fire steder, `teams` joines ind i en tekst eller en payload. `th`/`ta` er
  // filens egne aliasser for hjemme- og udehold.
  const KORT = "coalesce(nullif(th.short_name, ''), th.name)";
  const KORT_UDE = "coalesce(nullif(ta.short_name, ''), ta.name)";

  const kilde = () => readFileSync(join(SQL_DIR, DAGSMOTOR), "utf8").replace(/--[^\n]*/g, "");

  it.each(["th.name", "ta.name"])("intet bart %s står tilbage", (bart) => {
    const src = kilde();
    // Forekomsterne INDE i coalesce-formen er de lovlige — de tælles ud, så det,
    // der er tilbage, er præcis de bare opslag.
    const alle = src.split(bart).length - 1;
    const lovlige = src.split(`, ${bart})`).length - 1;
    expect(alle - lovlige,
      `${bart} står bart ${alle - lovlige} sted(er) — holdet ville hedde sit fulde navn i en historie (B39)`).toBe(0);
  });

  it("den korte form er den, der faktisk skrives", () => {
    const src = kilde();
    expect(src, `"${KORT}" mangler — vagten ovenfor ville være grøn, hvis navnet blev slettet helt`).toContain(KORT);
    expect(src, `"${KORT_UDE}" mangler`).toContain(KORT_UDE);
  });
});
