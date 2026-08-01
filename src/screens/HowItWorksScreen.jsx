// "Sådan virker det": reglerne forklaret for brugeren — point, låsning,
// runder, Championship og installation. Bærer også appens versionsnummer.
import { C, font } from "../ui/theme.js";
import { BackBar, Card } from "../ui/components.jsx";
import InstallGuide from "./InstallGuide.jsx";

function HowItWorksScreen({ onBack }) {
  const Section = ({ title, children }) => (
    <Card>
      <div style={{ fontFamily: font.display, fontSize: 18, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>{title}</div>
      <div style={{ color: C.text, fontSize: 14, lineHeight: 1.55 }}>{children}</div>
    </Card>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BackBar title="Sådan virker det" onBack={onBack} />
      <Section title="Liga, turnering & konkurrence">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div><b>Liga</b> = dit permanente fællesskab (venner, kontor, familie). Del ét invite-link, så er alle med.</div>
          <div><b>Konkurrence</b> = en tippekonkurrence inde i ligaen. Du vælger selv, hvilke af ligaens konkurrencer du er med i.</div>
          <div><b>Turnering</b> = den rigtige fodboldturnering (fx Superligaen), som kampene kommer fra.</div>
          <div style={{ marginTop: 6, color: C.muted }}>
            Kort sagt: turneringen leverer kampene, ligaen er menneskene, konkurrencen er dysten.
          </div>
        </div>
      </Section>
      <Section title="Pointsystem">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div><span style={{ color: C.green, fontWeight: 700 }}>+3</span> for præcist resultat (fx gættet 2-1, endte 2-1).</div>
          <div><span style={{ color: C.greenSoft, fontWeight: 700 }}>+1</span> for korrekt udfald (rigtig vinder/uafgjort, forkert resultat).</div>
          <div><span style={{ color: C.muted, fontWeight: 700 }}>0</span> ellers. Ingen minuspoint — du kan aldrig gå i minus.</div>
        </div>
      </Section>
      <Section title="Tiebreak">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div>Står to spillere lige på point, afgøres det i denne rækkefølge:</div>
          <div><b>1.</b> Flest <b>præcise resultater</b>.</div>
          <div><b>2.</b> Flest <b>korrekte udfald</b>.</div>
          <div><b>3.</b> Flest <b>rundesejre</b> — spillerunder, hvor du var nr. 1.</div>
          <div><b>4.</b> <b>Tættest på</b> — den mindste gennemsnitlige afvigelse fra de rigtige resultater.</div>
          <div style={{ marginTop: 4 }}>
            Er alt lige hele vejen ned, er I <b>ægte lige</b>: I deler placeringen (to delte 2'ere betyder, at den næste er nr. 4)
            og en eventuel titel. En enkelt spillerunde har ingen rundesejre at afgøre noget med, så dér springes trin 3 over.
          </div>
        </div>
      </Section>
      <Section title="Rating">
        Parvis multiplayer-Elo. Alle starter på <b>1000</b>. Du stiger, hvis du rammer bedre end de andre i runden, og falder, hvis du rammer dårligere — det tæller ekstra at slå spillere med høj rating. Hver runde giver <b>én</b> ratingændring — ikke én pr. turnering og ikke én pr. kamp — beregnet ud fra dine gennemsnitspoint pr. kamp i runden. Den regnes om, hver gang en af rundens kampe er fløjtet af, så den er foreløbig hen over ugen og står endeligt fast, når rundens sidste kamp er slut. De første 5 runder er foreløbige: det vises som et <b>NY</b>-mærke på Rating og Karriere, og som en lille <b>*</b> efter ratingtallet på Hjem, i Championship og i konkurrencestillingen.
      </Section>
      <Section title="Karriere">
        Din <b>karriere</b> er alt det, du har samlet i produktet — og den <b>nulstilles aldrig</b>. Når en sæson slutter,
        starter du ikke forfra: karrieren følger dig på tværs af sæsoner, ligaer og turneringer. Her står din rating over
        tid, dine titler fra Championship (månedens og rundens), dine milepæle undervejs og dine tætteste rivaler.
        Du åbner din egen fra person-ikonet øverst — og alle andres ved at trykke på deres navn, hvor som helst i appen.
        Milepæle og rivaler er kun dine egne; resten kan alle se.
      </Section>
      <Section title="Live-resultater">
        Mens en kamp spilles, viser vi den <b>nuværende stilling</b> med et rødt <b>LIVE</b>-mærke og spilleminut — den opdateres cirka hvert minut. Er nogle af rundens kampe færdige og andre ikke, markeres de færdige <b>Slut</b>; er hele runden spillet, siger rundehovedet det, og mærket udgår. Live-stillingen giver <b>ingen point</b>: point, stillinger og rating opdateres først, når kampen er fløjtet af. Så kan et sent mål stadig vende dine point, uden at tabellen har lovet noget forkert undervejs.
      </Section>
      <Section title="Championship (officielle konkurrencer)">
        <b>Championship</b> er officielle konkurrencer, hvor alle automatisk er med — ingen tilmelding og ingen invitation.
        Det er ikke det samme som en <b>konkurrence</b>: den opretter du selv i din liga. Dine tips tæller begge steder
        på én gang, så du tipper kun én gang pr. kamp.{" "} <b>Månedsligaen</b> samler dine samlede point for månedens kampe (uafgjort afgøres af tiebreak-stigen ovenfor). Månedens bedste kåres som <b>Månedens Prediction Champ</b> — er to helt lige, deles titlen. Stillingen nulstilles den 1.
      </Section>
      <Section title="Tips-synlighed">
        Hver kamp låser <b>1 time før sit eget kickoff</b>. Først dér kan du se de andres tips på netop den kamp — ingen kan se dine inden da, og ingen kan rette efter. En runde er derfor typisk halvt låst: fredagskampen er afgjort og synlig, mens søndagskampen stadig kan tippes.
      </Section>
      <Section title="Installér som app">
        <InstallGuide />
      </Section>
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
