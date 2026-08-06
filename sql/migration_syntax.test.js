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
