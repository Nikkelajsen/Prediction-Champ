// "Sådan virker det": reglerne forklaret for brugeren — begreber, point,
// låsning, rating, Championship og installation. Bærer også versionsnummeret.
//
// Skærmen er inddelt i SEKS emner, der folder ud, og alt er foldet ved åbning
// (jura/Privatliv og vilkår kom til med B4).
// Før var det ni ligeværdige kort i én kolonne, ~5-6 telefonhøjder lang: den
// bruger, der åbner ⓘ med ét konkret spørgsmål ("hvornår låser mine tips?"),
// skulle scrolle forbi otte svar, der ikke var hans. Foldet står hele
// oversigten på ét skærmbillede, og det koster ét tryk at nå svaret.
//
// Det er den modsatte afvejning af Tip-skærmen, hvor intet blev gemt bag et
// tap — og bevidst: Tip er en HANDLINGS-skærm, man bruger hver uge og skal
// kunne overskue i ét blik, mens den her er en OPSLAGS-skærm, man åbner med
// ét spørgsmål. Dér er en menu bedre end en mur.
//
// Flere emner må være åbne samtidig: et tryk skal aldrig lukke noget, man var
// i gang med at læse, og point + tiebreak skal kunne stå ved siden af hinanden.
import { useState } from "react";
import { C, btnGhost, font } from "../ui/theme.js";
import { BackBar, Card, Collapsible, Eyebrow } from "../ui/components.jsx";
import InstallGuide from "./InstallGuide.jsx";
import FeedbackCard from "./FeedbackCard.jsx";

// Emnekortet. Ligger på modulniveau med vilje: defineret inde i skærmens krop
// ville komponenten få ny identitet ved hver render, og et emne, brugeren selv
// har åbnet, ville folde sig sammen af sig selv ved næste render.
//
// Indholdet renderes slet ikke, når emnet er lukket (husets konvention — se
// MatchRow og HjemTab). Det er også dét, der holder InstallGuide, som læser
// `navigator` under render, ude af den foldede skærm.
// Selve folden er `Collapsible` (G57) — knap, aria og panel ét sted. Tilbage
// står det, der er emne-specifikt: kortets ramme og overskriftens typografi.
const Topic = ({ title, open, onToggle, children }) => (
  <Card style={{ padding: 0, overflow: "hidden" }}>
    <Collapsible
      open={open} onToggle={onToggle} label={title} header={title} chevronSize={16}
      style={{
        padding: 16,
        fontFamily: font.display, fontSize: 18, fontWeight: 700, textTransform: "uppercase",
      }}
    >
      <div style={{ padding: "0 16px 16px", color: C.text, fontSize: 14, lineHeight: 1.55, display: "flex", flexDirection: "column", gap: 14 }}>
        {children}
      </div>
    </Collapsible>
  </Card>
);

// Undersektion inde i et emne: de gamle sektionstitler, et niveau nede.
// `Eyebrow` er husets lille overskrift og gør niveauforskellen tydelig uden
// en ny stil. Skillelinjen står over alle undtagen den første i emnet.
const Sub = ({ title, first = false, children }) => (
  <div style={first ? undefined : { borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
    <Eyebrow>{title}</Eyebrow>
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>
  </div>
);

function HowItWorksScreen({ onBack, token, openLegal }) {
  // Nøglet på emne-id frem for ét åbent id, fordi flere må være åbne samtidig.
  // Ingen persistering mellem besøg: skærmen skal møde alle ens.
  const [open, setOpen] = useState({});
  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));
  const topic = (key, title) => ({ title, open: !!open[key], onToggle: () => toggle(key) });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BackBar title="Sådan virker det" onBack={onBack} />

      {/* Rækkefølgen er brugerens vej gennem produktet: hvad hedder tingene →
          hvad giver point → hvad sker der i weekenden → hvad bygger sig op over
          tid → det praktiske. */}
      <Topic {...topic("begreber", "Begreberne")}>
        <Sub title="Liga, turnering & konkurrence" first>
          <div><b>Liga</b> = dit permanente fællesskab (venner, kontor, familie). Del ét invite-link, så er alle med.</div>
          <div><b>Konkurrence</b> = en tippekonkurrence inde i ligaen. Du vælger selv, hvilke af ligaens konkurrencer du er med i.</div>
          <div><b>Turnering</b> = den rigtige fodboldturnering (fx Superligaen), som kampene kommer fra.</div>
          <div style={{ marginTop: 6, color: C.muted }}>
            Kort sagt: turneringen leverer kampene, ligaen er menneskene, konkurrencen er dysten.
          </div>
        </Sub>
        <Sub title="Championship (officielle konkurrencer)">
          <div>
            <b>Championship</b> er officielle konkurrencer, hvor alle automatisk er med — ingen tilmelding og ingen invitation.
            Det er ikke det samme som en <b>konkurrence</b>: den opretter du selv i din liga. Dine tips tæller begge steder
            på én gang, så du tipper kun én gang pr. kamp.{" "} <b>Månedsligaen</b> samler dine samlede point for månedens kampe (uafgjort afgøres af tiebreak-stigen under Point og stilling). Månedens bedste kåres som <b>Månedens Prediction Champ</b> — er to helt lige, deles titlen. Stillingen nulstilles den 1.
          </div>
        </Sub>
      </Topic>

      <Topic {...topic("point", "Point og stilling")}>
        <Sub title="Pointsystem" first>
          <div><span style={{ color: C.green, fontWeight: 700 }}>+3</span> for præcist resultat (fx gættet 2-1, endte 2-1).</div>
          <div><span style={{ color: C.greenSoft, fontWeight: 700 }}>+1</span> for korrekt udfald (rigtig vinder/uafgjort, forkert resultat).</div>
          <div><span style={{ color: C.muted, fontWeight: 700 }}>0</span> ellers. Ingen minuspoint — du kan aldrig gå i minus.</div>
        </Sub>
        <Sub title="Tiebreak">
          <div>Står to spillere lige på point, afgøres det i denne rækkefølge:</div>
          <div><b>1.</b> Flest <b>præcise resultater</b>.</div>
          <div><b>2.</b> Flest <b>korrekte udfald</b>.</div>
          <div><b>3.</b> Flest <b>rundesejre</b> — spillerunder, hvor du var nr. 1.</div>
          <div><b>4.</b> <b>Tættest på</b> — den mindste gennemsnitlige afvigelse fra de rigtige resultater.</div>
          <div style={{ marginTop: 4 }}>
            Er alt lige hele vejen ned, er I <b>ægte lige</b>: I deler placeringen (to delte 2'ere betyder, at den næste er nr. 4)
            og en eventuel titel. En enkelt spillerunde har ingen rundesejre at afgøre noget med, så dér springes trin 3 over.
          </div>
        </Sub>
      </Topic>

      <Topic {...topic("kampe", "Under kampene")}>
        <Sub title="Tips-synlighed" first>
          <div>Hver kamp låser <b>1 time før sit eget kickoff</b>. Først dér kan du se de andres tips på netop den kamp — ingen kan se dine inden da, og ingen kan rette efter. En runde er derfor typisk halvt låst: fredagskampen er afgjort og synlig, mens søndagskampen stadig kan tippes.</div>
        </Sub>
        <Sub title="Live-resultater">
          <div>Mens en kamp spilles, viser vi den <b>nuværende stilling</b> med et rødt <b>LIVE</b>-mærke og spilleminut — den opdateres cirka hvert minut. Er nogle af rundens kampe færdige og andre ikke, markeres de færdige <b>Slut</b>; er hele runden spillet, siger rundehovedet det, og mærket udgår. Live-stillingen giver <b>ingen point</b>: point, stillinger og rating opdateres først, når kampen er fløjtet af. Så kan et sent mål stadig vende dine point, uden at tabellen har lovet noget forkert undervejs.</div>
        </Sub>
      </Topic>

      <Topic {...topic("udvikling", "Din udvikling")}>
        <Sub title="Rating" first>
          <div>Parvis multiplayer-Elo. Alle starter på <b>1000</b>. Du stiger, hvis du rammer bedre end de andre i runden, og falder, hvis du rammer dårligere — det tæller ekstra at slå spillere med høj rating. Hver runde giver <b>én</b> ratingændring — ikke én pr. turnering og ikke én pr. kamp — beregnet ud fra dine gennemsnitspoint pr. kamp i runden. Den regnes om, hver gang en af rundens kampe er fløjtet af, så den er foreløbig hen over ugen og står endeligt fast, når rundens sidste kamp er slut. De første 5 runder er foreløbige: det vises som et <b>NY</b>-mærke på Rating og Karriere, og som en lille <b>*</b> efter ratingtallet på Hjem, i Championship og i konkurrencestillingen.</div>
        </Sub>
        <Sub title="Karriere">
          <div>
            Din <b>karriere</b> er alt det, du har samlet i produktet — og den <b>nulstilles aldrig</b>. Når en sæson slutter,
            starter du ikke forfra: karrieren følger dig på tværs af sæsoner, ligaer og turneringer. Her står din rating over
            tid, dine titler fra Championship (månedens og rundens), dine milepæle undervejs og dine tætteste rivaler.
            Du åbner din egen fra person-ikonet øverst — og alle andres ved at trykke på deres navn, hvor som helst i appen.
            Milepæle og rivaler er kun dine egne; resten kan alle se.
          </div>
        </Sub>
      </Topic>

      <Topic {...topic("install", "Installér som app")}>
        <InstallGuide />
      </Topic>

      {/* Privatliv og vilkår (B4). Et EMNE og ikke et permanent kort som
          feedback nedenfor: forskellen er handling mod opslag. "Sig til" er
          noget, man gør, og skal kunne findes uden at gætte et emne; det her
          er noget, man slår op, og hører derfor hjemme i menuen på lige fod
          med point og rating. Knappen "Luk min konto" bor inde på selve
          teksten — samme sted som beskrivelsen af, hvad lukningen gør. */}
      <Topic {...topic("jura", "Privatliv og vilkår")}>
        <Sub title="Hvad vi gemmer, og hvad du kan forlange" first>
          <div>
            Privatlivspolitikken siger, hvilke oplysninger appen gemmer om dig,
            hvem de deles med, og hvor længe de bliver. Brugervilkårene er
            reglerne for at bruge appen. Vil du lukke din konto, står knappen
            samme sted.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
            <button type="button" style={btnGhost} onClick={() => openLegal("privatliv")}>
              Privatlivspolitik
            </button>
            <button type="button" style={btnGhost} onClick={() => openLegal("vilkaar")}>
              Brugervilkår
            </button>
          </div>
        </Sub>
      </Topic>


      {/* Feedback-kortet (B14) står lige over versionsstemplet, og de to hører
          sammen: stemplet svarer på "hvilken version så du?", kortet er stedet,
          spørgsmålet overhovedet kan stilles. Versionen følger automatisk med
          hver melding, så ingen skal skrive den af. Begge står UDEN FOR
          foldningen: den, der ikke forstod noget, skal kunne sige det uden
          først at gætte, hvilket emne "sig til" gemmer sig under. */}
      <FeedbackCard token={token} />
      {/* Versionsstemplet (G42). Står nederst på den ene side, enhver bruger
          kan finde, og er dermed svaret på det spørgsmål, enhver fejlmelding
          begynder med: HVILKEN version så du? Uden det er "det virkede ikke i
          går" ikke til at koble til et deploy. `__APP_VERSION__` er commit-SHA'en,
          stemplet ind af vite.config.js; lokalt står der "dev". */}
      <p style={{ color: C.muted, fontSize: 11, textAlign: "center", margin: "6px 0 0" }}>
        Version {__APP_VERSION__}
      </p>
    </div>
  );
}

export default HowItWorksScreen;
