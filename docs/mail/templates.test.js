import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { KONTAKT_EMAIL } from "../../src/lib/legal.js";

// Vagt over mailskabelonerne (B25).
//
// Skabelonerne pastes ind i Supabase → Auth → Email Templates og køres derfor
// aldrig af noget i dette repo. Det er præcis den slags fil, der kan stå forkert
// i månedsvis: den ser rigtig ud, den fejler ingen build, og den eneste, der
// opdager fejlen, er en bruger, som ikke kan komme ind på sin konto.
//
// Samme placering og samme begrundelse som `sql/migration_syntax.test.js`, der
// vogter migreringerne mod psql-kommandoer: filen bor ved siden af det, den
// vogter, og opsamles af Vitests default-mønster.
//
// Den efterprøver IKKE, at mailen ser pæn ud — det kan kun et menneske med en
// indbakke, og det er trin i "Bevis, at det virker" i docs/MAIL.md. Den
// efterprøver de fire ting, der gør en mail ubrugelig uden at ligne det.

const MAIL_DIR = dirname(fileURLToPath(import.meta.url));
const skabeloner = readdirSync(MAIL_DIR).filter((f) => f.endsWith(".html"));

const læs = (f) => readFileSync(join(MAIL_DIR, f), "utf8");

describe("mailskabelonerne i docs/mail/", () => {
  it("findes (vagten må ikke stå og bevogte ingenting)", () => {
    expect(skabeloner).toEqual(["confirm-signup.html", "recovery.html"]);
  });

  // Uden linket er mailen et stykke pynt. Supabase erstatter variablen ved
  // afsendelse; skrives den forkert, sendes teksten `{{ .ConfirmationURL }}`
  // ordret ud til brugeren.
  it.each(skabeloner)("%s bruger Supabases {{ .ConfirmationURL }}", (f) => {
    expect(læs(f)).toContain("{{ .ConfirmationURL }}");
  });

  // DEN VIGTIGSTE PÅSTAND. Appens adresse flytter fra
  // `prediction-champ.vercel.app` til `app.leagly.app` (`I10`, runbog i
  // docs/DOMAENE.md), og Vercels gamle URL redirigerer ikke af sig selv — det
  // redirect, `vercel.json` har fået, er skrevet i hånden netop derfor. En
  // hardkodet adresse i en skabelon ville dø ved flytningen — og dø TAVST, for
  // skabelonen ligger uden for både build og testflade. Linket skal komme fra
  // Supabases Site URL, altså fra variablen. Derfor forbyder påstanden nedenfor
  // BEGGE adresser: den nye er lige så forkert at hardkode som den gamle.
  it.each(skabeloner)("%s hardkoder ingen app-adresse", (f) => {
    const html = læs(f);
    expect(html).not.toMatch(/vercel\.app/);
    expect(html).not.toMatch(/https?:\/\/[^{\s"']*leagly\.app/);
  });

  // Ingen fjernindhold: dels ryger mails med billeder oftere i spam, dels ville
  // et sporingspixel være præcis det tredjeparts-værktøj, legal.js lover at
  // holde sig fra. `mailto:` og Supabase-variabler er de eneste lovlige links.
  it.each(skabeloner)("%s henter intet udefra", (f) => {
    const html = læs(f);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/http:\/\//);
    const links = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    const ulovlige = links.filter((h) => !h.startsWith("mailto:") && !h.startsWith("{{"));
    expect(ulovlige).toEqual([]);
  });

  // EMNET ER DEN HALVDEL, DER BLEV GLEMT. Supabase har et separat `Subject`-felt
  // over brødteksten, og den første leverede mail (9. august 2026) kom frem med
  // dansk brødtekst under Supabases engelske standard, "Reset your password".
  // Skabelonen bar kun det halve af teksten — og den halvdel, den ikke bar, er
  // den, brugeren ser først i sin indbakke.
  //
  // Påstanden er billig og fangede den samme fejl på `confirm-signup`, mens den
  // endnu ikke var i brug. **Den er i brug fra 12. august 2026**, hvor `B26`
  // slog bekræftelsen til, og emnet er aflæst dansk på en modtaget mail — men
  // påstanden bliver netop derfor stående: nu ville et engelsk emne ramme en
  // fremmed direkte, i stedet for at vente på nogen.
  it.each(skabeloner)("%s deklarerer sit emne", (f) => {
    const emne = læs(f).match(/^\s*EMNE:\s*(.+)$/m);
    expect(emne, "skabelonen mangler en EMNE-linje i hovedet").not.toBeNull();
    expect(emne[1].trim().length).toBeGreaterThan(0);
  });

  // Kontaktadressen står to steder — her og i privatlivspolitikken — og de skal
  // være den samme. Skifter den ene, skal den anden med; ellers henviser en mail
  // til en adresse, ingen læser. Påstanden er også vagten mod, at skabelonen
  // slipper igennem med en pladsholder.
  it.each(skabeloner)("%s nævner samme kontaktadresse som legal.js", (f) => {
    expect(KONTAKT_EMAIL).not.toMatch(/[[\]]/);
    expect(læs(f)).toContain(KONTAKT_EMAIL);
  });
});
