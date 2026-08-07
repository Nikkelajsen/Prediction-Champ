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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { UDDRAG, blokkeITekst, énSætning, planlæg, tilPG16, findBlokke, løfter, fjernelser, iDumpet, friskhed, friskhedsLinjer } from "./docs_sql.mjs";

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

// ---------------------------------------------------------------------------
// G79: er eksporten på højde med migreringerne?
//
// Grunden til, at denne del testes lige så nidkært som afvisningerne ovenfor,
// er den samme: den udløser næsten aldrig. En måling, man ikke har set slå ud,
// er en formodning — G84's lære, stillet mod et Node-script i stedet for en
// SQL-kontrol.
// ---------------------------------------------------------------------------

describe("løfter — hvad en migrering siger, skemaet indeholder", () => {
  it("finder tabel, kolonne og funktion", () => {
    const l = løfter(
      `create table if not exists public.foo (id uuid);
       alter table public.stories add column if not exists news_value int;
       create or replace function public.bar(p int) returns void language sql as $fn$ select 1 $fn$;`,
      "x.sql",
    );
    expect(l.map((x) => `${x.slags}:${x.navn}`)).toEqual(["tabel:foo", "kolonne:stories.news_value", "funktion:bar"]);
  });

  // DEN VIGTIGSTE AFGRÆNSNING. Motorernes mellemregninger (`_sd_scored`,
  // `_rs`) oprettes som temporære tabeller INDE i en plpgsql-krop. Uden at
  // fjerne kroppene ville hver eneste af dem stå som "en tabel, produktionen
  // burde have" — og målingen ville være rød hver eneste gang.
  it("ser ikke tabeller, der oprettes inde i en funktionskrop", () => {
    const l = løfter(
      `create or replace function public.motor() returns void language plpgsql as $fn$
       begin
         create temporary table _sd_scored as select 1;
         create table if not exists opfundet (id int);
       end $fn$;`,
      "x.sql",
    );
    expect(l.filter((x) => x.slags === "tabel")).toHaveLength(0);
  });

  it("ser bort fra en udkommenteret sætning", () => {
    expect(løfter("-- create table public.spøgelse (id int);\n", "x.sql")).toHaveLength(0);
  });

  it("trækker det fra, en migrering selv fjerner igen", () => {
    const f = fjernelser("alter table public.leagues drop column if exists country; drop function if exists public.gammel();");
    expect(f.has("leagues.country")).toBe(true);
    expect(f.has("gammel")).toBe(true);
  });
});

describe("iDumpet — opslaget i schema.sql", () => {
  const dump = [
    "CREATE TABLE public.stories (",
    "    id uuid NOT NULL,",
    "    news_value integer",
    ");",
    "CREATE FUNCTION public.recompute_ratings() RETURNS void",
    "    LANGUAGE plpgsql",
  ].join("\n");

  it("genkender tabel, kolonne og funktion", () => {
    expect(iDumpet(dump, { slags: "tabel", navn: "stories" })).toBe(true);
    expect(iDumpet(dump, { slags: "kolonne", navn: "stories.news_value" })).toBe(true);
    expect(iDumpet(dump, { slags: "funktion", navn: "recompute_ratings" })).toBe(true);
  });

  it("melder det manglende", () => {
    expect(iDumpet(dump, { slags: "tabel", navn: "feedback" })).toBe(false);
    expect(iDumpet(dump, { slags: "kolonne", navn: "stories.newsworthy" })).toBe(false);
    expect(iDumpet(dump, { slags: "funktion", navn: "findes_ikke" })).toBe(false);
  });

  // Én manglende tabel må give ÉN linje og ikke én pr. kolonne. Rapporten skal
  // kunne læses under pres, og tyve linjer om samme sag er ikke en rapport.
  it("melder ikke kolonnerne i en tabel, der selv mangler", () => {
    expect(iDumpet(dump, { slags: "kolonne", navn: "feedback.body" })).toBe(true);
  });
});

// Repoet selv — men BEVIDST uden at kræve, at eksporten er ajour.
//
// Det er fristende at skrive `expect(f.mangler).toEqual([])` her, og det ville
// være forkert. En migrering, der lige er skrevet, er LOVLIGT forud for
// eksporten: den kører mandage og manuelt, så enhver PR, der tilføjer en
// SQL-fil, ville blive rød på noget, der ikke er en fejl — og en farve, der
// altid lyser på det samme, holder folk op med at læse. Målingen er en
// OPLYSNING øverst i psql-kørslen, ikke en gate; se hovedet af docs_sql.mjs.
//
// Denne test vogter derfor målingens MASKINERI mod repoets rigtige filer: at
// den finder noget at måle, og at hvert svar peger på en fil, der findes.
describe("friskhedsmålingen mod repoets egne filer", () => {
  const SKEMA = fileURLToPath(new URL("../schema.sql", import.meta.url));

  it("finder migreringernes objekter og kan slå dem op i dumpet", () => {
    const f = friskhed(readFileSync(SKEMA, "utf8"));
    expect(f.tjekket).toBeGreaterThan(50);
    // Langt de fleste skal findes. Er over en tiendedel væk, er det ikke en
    // eftersakkende eksport — så er udtrækket eller opslaget gået i stykker.
    expect(f.mangler.length).toBeLessThan(f.tjekket / 10);
    for (const m of f.mangler) {
      expect(["tabel", "kolonne", "funktion"]).toContain(m.slags);
      expect(m.fil).toMatch(/\.sql$/);
    }
  });
});

describe("friskhedslinjerne i kørslen", () => {
  // Den grønne linje er ikke pynt: den er selve G79. Uden den kan læseren af
  // en rød blok ikke vide, om dumpet var gammelt, og skal gætte.
  it("siger på den grønne kørsel, at en fejl ligger i blokken", () => {
    const t = friskhedsLinjer({ tjekket: 73, mangler: [] }).join("\n");
    expect(t).toMatch(/73 objekter/);
    expect(t).toMatch(/fejl i BLOKKEN/);
    expect(t).not.toMatch(/\\warn/);
  });

  it("skriver de manglende objekter på stderr med fil og fejlkoder", () => {
    const t = friskhedsLinjer({
      tjekket: 73,
      mangler: [{ slags: "kolonne", navn: "stories.newsworthy", fil: "story_engine_v3_newsworthy.sql" }],
    }).join("\n");
    expect(t).toMatch(/\\warn/);
    expect(t).toMatch(/BAGUD/);
    expect(t).toMatch(/stories\.newsworthy/);
    expect(t).toMatch(/story_engine_v3_newsworthy\.sql/);
    expect(t).toMatch(/42703/);
    expect(t).toMatch(/skema-eksport/);
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
