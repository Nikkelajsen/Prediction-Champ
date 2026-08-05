// Test af udtrækkeren bag SQL-tjekket på docs/ (G74).
//
// Den kører i Vitest og ikke i psql, fordi den ikke handler om SQL: den vogter
// de to afvisninger, der ellers aldrig ville blive kørt før den dag, nogen
// skrev en blok forkert — og en afvisning, der aldrig er kørt, er den samme
// slags ubeviste kodesti som `G72` og `G76`.
//
// Selve påstanden om, at blokkene ER gyldig SQL, kan kun stilles af en rigtig
// PostgreSQL og bor derfor i CI's `sql`-job.

import { describe, it, expect } from "vitest";
import { UDDRAG, blokkeITekst, énSætning, planlæg, tilPG16, findBlokke } from "./docs_sql.mjs";

describe("udtrækket af blokke", () => {
  it("finder sprog-hegnet og bærer fil og linjenummer med", () => {
    const b = blokkeITekst("tekst\n\n```sql\nselect 1;\n```\n", "docs/x.md");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ fil: "docs/x.md", linje: 3, markør: "", sql: "select 1;" });
  });

  // Blokke inde i en nummereret liste er indrykket. Uden at trække indrykket
  // fra ville hver linje bære listens mellemrum med ind i `prepare`.
  it("trækker hegnets indryk fra kroppen", () => {
    const b = blokkeITekst("1. sådan:\n\n   ```sql\n   select 1;\n   ```\n", "docs/x.md");
    expect(b[0].sql).toBe("select 1;");
  });

  it("ser bort fra blokke i andre sprog", () => {
    expect(blokkeITekst("```js\nconst a = 1;\n```\n", "docs/x.md")).toHaveLength(0);
  });

  it("kaster på et hegn, der aldrig lukkes", () => {
    expect(() => blokkeITekst("```sql\nselect 1;\n", "docs/x.md")).toThrow(/lukkes aldrig/);
  });
});

describe("énSætning", () => {
  it("accepterer én sætning med og uden afsluttende semikolon", () => {
    expect(énSætning("select 1")).toBe(true);
    expect(énSætning("select 1;\n")).toBe(true);
  });

  it("afviser to sætninger", () => {
    expect(énSætning("select 1; select 2;")).toBe(false);
  });

  // Et semikolon i en kommentar eller en streng afslutter ingenting. Uden
  // udrensningen ville en helt gyldig forespørgsel blive afvist.
  it("tæller ikke semikolon i kommentarer og strenge", () => {
    expect(énSætning("-- husk; virkelig\nselect 'a;b' as x;")).toBe(true);
    expect(énSætning("/* a; b */ select 1;")).toBe(true);
  });
});

describe("planlæg", () => {
  const blok = (markør, sql = "select 1;") => ({ fil: "docs/x.md", linje: 1, markør, sql });

  it("tjekker en umarkeret blok og springer et uddrag over", () => {
    const { tjekkes, uddrag } = planlæg([blok(""), blok(UDDRAG)]);
    expect(tjekkes).toHaveLength(1);
    expect(uddrag).toHaveLength(1);
  });

  // Markøren er opt-OUT, så en stavefejl må ikke tavst blive til "tjekkes
  // ikke". Den skal fejle højlydt og nævne sit eget navn.
  it("afviser en ukendt markør frem for at gætte", () => {
    expect(() => planlæg([blok("skip")])).toThrow(/ukendt markør/);
    expect(() => planlæg([blok("Uddrag")])).toThrow(/ukendt markør/);
  });

  it("afviser en tjekket blok med flere sætninger og peger på linjen", () => {
    expect(() => planlæg([blok("", "select 1; select 2;")])).toThrow(/docs\/x\.md:1/);
  });

  it("lader et uddrag have lige så mange sætninger, det vil", () => {
    expect(() => planlæg([blok(UDDRAG, "create table a(); create table b();")])).not.toThrow();
  });
});

describe("dumpet gøres læsbart for PostgreSQL 16", () => {
  it("fjerner psql 17's \\restrict og PG17's transaction_timeout", () => {
    const ud = tilPG16("\\restrict abc\nSET transaction_timeout = 0;\nSET lock_timeout = 0;\n\\unrestrict abc");
    expect(ud.trim()).toBe("SET lock_timeout = 0;");
  });

  it("fjerner MAINTAIN uden at røre de øvrige privilegier", () => {
    expect(tilPG16("GRANT SELECT,MAINTAIN,UPDATE ON TABLE public.matches TO authenticated;"))
      .toBe("GRANT SELECT,UPDATE ON TABLE public.matches TO authenticated;");
    expect(tilPG16("GRANT MAINTAIN,UPDATE ON TABLE t TO r;")).toBe("GRANT UPDATE ON TABLE t TO r;");
  });
});

// Selve repoet, ikke en fixture: hvis nogen skriver en blok, der ikke kan
// tjekkes, fejler dette allerede i `npm test` — uden at vente på psql.
describe("docs/ som den ser ud nu", () => {
  it("har kun lovlige markører og hele sætninger", () => {
    const { tjekkes, uddrag } = planlæg(findBlokke());
    expect(tjekkes.length).toBeGreaterThan(0);
    expect(tjekkes.length + uddrag.length).toBe(findBlokke().length);
  });
});
