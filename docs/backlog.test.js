import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Vagt over backloggens FORM, ikke dens indhold.
//
// HVORFOR DEN FINDES. Reglen — hvert punkt står som en RÆKKE under sit tier,
// aldrig flettet ind i prosa — blev truffet 8. august 2026 og stod i
// DECISIONS.md: "Tier 1–5 viser nu deres rækker i stedet for referater af, hvad
// der engang stod i dem." Fem dage senere bar Tier 2 og Tier 5 begge et referat
// ("Tomt. `G99` er leveret 12. august …"), og Tier 5's to ÅBNE punkter stod
// inde i en sætning frem for som rækker.
//
// Det er samme stille drift, som `saelgesaetning.test.js` (G97) blev bygget
// imod: en regel, der kun findes som en sætning i et dokument, holder præcis så
// længe, som den næste, der redigerer, husker den. Forskellen på den regel og
// denne er, at ingen af overtrædelserne så forkerte ud — de så ud som en
// hjælpsom note.
//
// DEN MÅLER TO TING MED ÉN PÅSTAND, og det er med vilje. Et punkt, der er
// skrevet som prosa i stedet for som en række, viser sig som et TAL, der ikke
// stemmer: linjen "Alle N åbne punkter" tæller punkter, tabellerne bærer dem, og
// de to skal være det samme. Derfor er antallet ikke en separat kontrol, men
// selve måden formatfejlen bliver synlig på.
//
// DEN MÅLER IKKE, om prioriteringen er rigtig, om en række hører til i sit tier,
// eller om teksten er god. Det kan kun et menneske, og det er backloggens egen
// opgave — se "Prioriteret rækkefølge" i filen.

const BACKLOG = join(dirname(fileURLToPath(import.meta.url)), "BACKLOG.md");
const tekst = readFileSync(BACKLOG, "utf8");

// Afsnittet med tiers slutter, hvor opslagsværket begynder. Tabellerne dernede
// er sorteret efter ID og er IKKE prioriteringen — de må ikke tælles med.
const PRIORITERING = tekst.slice(
  tekst.indexOf("## Prioriteret rækkefølge"),
  tekst.indexOf("## Åbne beslutninger")
);

// Indbakken, fra sin egen overskrift til den næste.
const INDBAKKE = tekst.slice(
  tekst.indexOf("## 📥 Indbakke"),
  tekst.indexOf("## Prioriteret rækkefølge")
);

// Ét afsnit pr. "### Tier N — …", klippet ved den næste overskrift.
function tierAfsnit(kilde) {
  const stykker = kilde.split(/^### /m).slice(1);
  return stykker.map((s) => {
    const linjeskift = s.indexOf("\n");
    return { titel: s.slice(0, linjeskift).trim(), krop: s.slice(linjeskift + 1) };
  });
}

// En tabelrække er en linje, der begynder med `| ` og hverken er hovedet
// (`| # |`) eller skillelinjen (`|---`).
const erTabelrække = (l) =>
  l.startsWith("|") && !l.startsWith("|---") && !/^\|\s*#\s*\|/.test(l);

const tabelrækker = (krop) => krop.split("\n").filter(erTabelrække);

const ID = /`[ABGI]\d+`/;

const TIERS = tierAfsnit(PRIORITERING);

describe("backloggens prioriterede rækkefølge", () => {
  it("har de syv tiers (vagten må ikke stå og bevogte ingenting)", () => {
    expect(TIERS).toHaveLength(7);
    TIERS.forEach((t, i) => expect(t.titel).toMatch(new RegExp(`^Tier ${i + 1} —`)));
  });

  // Den centrale påstand. To lovlige tilstande og ikke tre: enten er tieret
  // tomt, eller også bærer det en tabel. Et tier med hverken det ene eller det
  // andet er præcis det, reglen forbyder — punkter beskrevet i en sætning.
  it.each(TIERS.map((t) => [t.titel, t]))("%s er enten Tomt. eller en tabel", (_, tier) => {
    const tomt = /^Tomt\.$/m.test(tier.krop);
    const rækker = tabelrækker(tier.krop);
    expect(
      tomt || rækker.length > 0,
      "tieret har hverken 'Tomt.' eller en tabel — står punkterne i prosa?"
    ).toBe(true);
    // Og ikke begge dele: et tomt tier med en tabel er en selvmodsigelse.
    expect(tomt && rækker.length > 0, "tieret siger både 'Tomt.' og har rækker").toBe(false);
  });

  // Et tomt tier må ikke bære et referat af, hvad der engang lå i det.
  // Historikken har ét sted — filens Log-afsnit — og det er dét, der gør, at
  // listen kan skimmes på et halvt minut. "Tomt. `G99` er leveret 12. august"
  // er den præcise form, der blev fanget 13. august 2026.
  it.each(TIERS.map((t) => [t.titel, t]))("%s bærer intet referat efter Tomt.", (_, tier) => {
    const i = tier.krop.indexOf("Tomt.");
    if (i === -1) return; // ikke et tomt tier — dækket af påstanden ovenfor
    const efter = tier.krop.slice(i + "Tomt.".length);
    expect(
      efter.match(ID),
      `der står ID'er efter 'Tomt.' — historik hører i Log, ikke under en tier-overskrift`
    ).toBeNull();
  });

  // Tallet og formatet er den samme påstand: et punkt skrevet som prosa i
  // stedet for som en række får tallet til at stemme forkert. Derfor er dette
  // ikke en pedantisk optælling, men den måde formatfejlen bliver synlig på.
  it("tæller lige så mange tabelrækker, som indledningen lover", () => {
    const lovet = PRIORITERING.match(/Alle (\d+) åbne punkter/);
    expect(lovet, "indledningens 'Alle N åbne punkter' mangler").not.toBeNull();

    const faktiske = TIERS.reduce((n, t) => n + tabelrækker(t.krop).length, 0);
    expect(
      faktiske,
      `indledningen lover ${lovet[1]} punkter, tiers indeholder ${faktiske} rækker`
    ).toBe(Number(lovet[1]));
  });

  // Samme regel, det andet sted den gælder. Filen skriver den om BÅDE tiers og
  // indbakken — "ingen tier-overskrift og ingen indbakke bærer sin egen
  // kørselshistorik" — men vagten målte kun tiers, og 14. august 2026 stod der
  // femten linjers referat af syv rydninger under indbakken: hvilke rå linjer
  // der blev til hvilke ID'er, og hvad der blev leveret samme dag.
  //
  // ID'erne er dét, der afslører den. En indbakke rummer pr. definition linjer
  // UDEN ID — det er hele pointen med at skrive i den — så et ID under
  // overskriften er altid et referat af noget, der allerede har fået sit sted i
  // en tabel. Derfor kan reglen måles uden at måle sproget.
  it("indbakken bærer ingen kørselshistorik", () => {
    expect(INDBAKKE.length, "'## 📥 Indbakke' blev ikke fundet").toBeGreaterThan(20);
    expect(
      INDBAKKE.match(ID),
      "der står ID'er i indbakken — historik hører i Log, ikke under indbakkens overskrift"
    ).toBeNull();
  });

  // Hver række begynder med sit ID i første kolonne. Uden det kan et punkt ikke
  // slås op i opslagsværket længere nede, og "hvert punkt står præcis ét sted"
  // bliver til to steder, der ikke kan kobles.
  it.each(TIERS.map((t) => [t.titel, t]))("%s har et ID i hver rækkes første kolonne", (_, tier) => {
    for (const række of tabelrækker(tier.krop)) {
      expect(række.split("|")[1]?.trim(), `rækken mangler sit ID: ${række.slice(0, 60)}…`).toMatch(
        /^`[ABGI]\d+`$/
      );
    }
  });
});
