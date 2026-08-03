// Privatlivspolitik og brugervilkår (B4).
//
// TEKSTEN ER DATA, IKKE JSX. Tre grunde: `src/lib/` er uden React (husets
// regel), en datastruktur kan efterprøves uden at rendre noget, og de to
// dokumenter skal kunne vises både inde i login-skærmen — hvor `MainApp` og
// dermed hele skærm-maskineriet ikke findes — og som en almindelig skærm.
//
// Ingen markdown: det ville koste en femte runtime-afhængighed i en kodebase,
// der bevidst har fire. Ingen inline-HTML: al styling bor i komponenten, så
// strukturen kan holdes dum nok til at en test kan gå den igennem.
//
// ⚠️ VEDLIGEHOLDELSESREGLEN, som er hele forskellen på en politik og et stykke
// papir: **en ny tabel med persondata, en ny tredjepart eller en ny
// localStorage-nøgle skal have en linje her i SAMME ombæring.** En politik,
// der er forældet, er værre end ingen — den er en påstand, der ikke passer.
// Reglen står også i DOCUMENTATION.md §24.

// Pladsholdere. Må KUN stå i kontakt-afsnittet, og en test håndhæver det.
// Teksten må ikke offentliggøres, før de er udfyldt.
const DATAANSVARLIG = "[NAVN]";
const KONTAKT_EMAIL = "[KONTAKT-E-MAIL]";

// Én dato for begge dokumenter. To ville uvægerligt komme ud af trit.
const LEGAL_OPDATERET = "2026-08-03";

const MINDSTEALDER = 13;

const PRIVATLIV = {
  id: "privatliv",
  titel: "Privatlivspolitik",
  afsnit: [
    {
      titel: "Hvem står bag",
      tekst: [
        `Prediction Champ drives af ${DATAANSVARLIG} som et privat fritidsprojekt. Det er mig, der er dataansvarlig for de oplysninger, appen behandler.`,
        `Vil du have indsigt i dine data, rettet noget eller slettet din konto, så skriv til ${KONTAKT_EMAIL}. Det er den samme adresse uanset hvad du skriver om, og den virker også, hvis du ikke kan logge ind.`,
      ],
    },
    {
      titel: "Aldersgrænse",
      tekst: [
        `Du skal være mindst ${MINDSTEALDER} år for at oprette en konto. Det er den alder, hvor man i Danmark selv kan give samtykke til, at en tjeneste behandler ens oplysninger.`,
      ],
    },
    {
      titel: "Hvad vi gemmer om dig",
      tekst: [
        "Alt herunder gemmes, fordi appen ikke kan fungere uden det — ikke for at blive solgt, analyseret på tværs af tjenester eller brugt til reklame.",
        {
          punkter: [
            "Din konto: e-mail og din adgangskode i krypteret form. De ligger hos Supabase, som leverer login.",
            "Din profil: brugernavn, hvornår du oprettede kontoen, og hvornår du sidst var aktiv. Brugernavnet er synligt for alle andre brugere.",
            "Dit spil: dine tips, dine point, din rating og hele ratinghistorikken runde for runde, dine kåringer, hvilke ligaer og konkurrencer du er med i, og de historie-kort, appen laver om dig. Et historie-kort kan nævne andre spilleres brugernavne, og dit kan optræde i deres.",
            "Din brug af appen: en log over hvad du åbner og gemmer — 25 forskellige typer hændelser, hver med et tidspunkt og nogle få detaljer som hvilken konkurrence-type du oprettede. Dertil hvilke dage du har været aktiv.",
            "Notifikationer: hvilke enheder du har slået push til på, og hvilke beskeder der er sendt til dig, så den samme besked ikke sendes to gange.",
            "Feedback: den tekst du selv skriver, plus appens version, hvilken skærm du stod på, og hvilken browser du bruger. De tre sidste står synligt i formularen, før du sender.",
          ],
        },
      ],
    },
    {
      titel: "Hvad vi ikke gemmer",
      tekst: [
        "Der er ingen sporing ud over appens egen. Konkret betyder det:",
        {
          punkter: [
            "Ingen cookies. Overhovedet — heller ikke til login.",
            "Ingen Google Analytics, ingen Facebook-pixel, ingen reklamenetværk, ingen tredjeparts-værktøjer til fejlrapportering.",
            "Ingen IP-adresse og ingen browser-oplysninger i vores brugslog. Den eneste gang din browser-streng gemmes, er når du selv sender en feedback-melding.",
            "Ingen betalingsoplysninger. Appen er gratis og har ingen betalingsfunktion.",
            "Ingen skrifttyper eller andet indhold hentet fra andres servere, mens du bruger appen.",
          ],
        },
      ],
    },
    {
      titel: "Hvad der ligger på din egen enhed",
      tekst: [
        "Appen bruger ikke cookies, men gemmer en håndfuld ting lokalt i browseren, så du slipper for at logge ind og få de samme tips igen hver gang:",
        {
          punkter: [
            "Din session: en fornyelses-nøgle og din e-mail, så du forbliver logget ind. Den fjernes, når du logger ud.",
            "Hvornår appen sidst registrerede dig som aktiv, så den ikke gør det oftere end en gang i timen.",
            "Om du er færdig med introduktionen, om du har lukket kortet om notifikationer, og om du har lukket forslaget om at oprette en liga.",
            "Hvilken turnering du sidst kiggede på i Championship.",
          ],
        },
        "Alt på nær sessionen er mærket med din konto. Deler du enhed med andre, ser de derfor deres egen introduktion og deres egne valg — ikke dine.",
        "Rydder du din browsers data, forsvinder alt det — du bliver logget ud og ser introduktionen igen, men dine tips og din rating ligger i databasen og er upåvirkede.",
      ],
    },
    {
      titel: "Hvem vi deler med",
      tekst: [
        "Appen er bygget på nogle få tjenester, som derfor uundgåeligt behandler data på vores vegne:",
        {
          punkter: [
            "Supabase leverer database og login. Alle data ligger i Irland (regionen eu-west-1).",
            "Vercel leverer selve appen og de baggrundsjob, der henter kampe. Serverne står i Dublin.",
            "Push-tjenesterne hos Google, Apple og Mozilla leverer notifikationer til din telefon. De kan se, at der sendes en besked til din enhed og hvornår — selve indholdet er krypteret undervejs.",
            "GitHub opbevarer den daglige, krypterede sikkerhedskopi af databasen i 90 dage.",
          ],
        },
        "Sportmonks og football-data.org leverer kampprogrammer og resultater. De modtager ingenting om dig — data går kun den ene vej, ind i appen.",
        "Vi sælger ikke data, deler dem ikke med annoncører og bruger dem ikke til at profilere dig.",
      ],
    },
    {
      titel: "Hvor længe vi gemmer",
      tekst: [
        "Så længe du har en konto. Vælger du at lukke den, sker der følgende med det samme:",
        {
          punkter: [
            "Din e-mail fjernes, og du kan ikke længere logge ind.",
            "Dit brugernavn erstattes af et pseudonym som “Slettet 3f8a1c2d”.",
            "Din brugslog, dine aktive dage, dine push-abonnementer, din notifikationslog og dine historie-kort slettes.",
            "Dine feedback-meldinger bliver stående, men uden forbindelse til dig.",
          ],
        },
        "Dine tips, point, rating og kåringer bliver stående under pseudonymet. Det er ikke en udeladelse: de er grundlaget for dine venners stillinger og historik, og en slettet spiller ville give huller i konkurrencer, andre har spillet færdig. Din plads i en gammel stilling står altså tilbage — bare uden dit navn.",
        "Nogle spor kan vi ikke nå med det samme, og det skal du kende:",
        {
          punkter: [
            "Den daglige sikkerhedskopi indeholder din gamle e-mail og opbevares i 90 dage, hvorefter den udløber af sig selv.",
            "Supabase og Vercel har deres egne sikkerhedskopier og serverlogs med tekniske oplysninger som IP-adresser. De styres af leverandørerne og deres frister.",
            "Notifikationer, der allerede er landet på andres telefoner, kan ikke kaldes tilbage.",
            "Navne på ligaer og konkurrencer, du selv har oprettet, bliver stående, fordi andre bruger dem.",
          ],
        },
      ],
    },
    {
      titel: "Dine rettigheder",
      tekst: [
        "Du har ret til at få indsigt i, hvad vi har om dig, at få rettet noget forkert, at få slettet dine oplysninger, at gøre indsigelse mod behandlingen og at få dine data udleveret i et læsbart format.",
        `Alle fem veje går gennem ${KONTAKT_EMAIL}. Du får svar hurtigst muligt og senest inden for en måned.`,
        "Er du uenig i, hvordan vi behandler dine oplysninger, kan du klage til Datatilsynet.",
      ],
    },
    {
      titel: "Ændringer",
      tekst: [
        `Denne politik blev senest opdateret ${LEGAL_OPDATERET}. Ændrer vi noget væsentligt, opdaterer vi datoen her — og ved ændringer, der betyder noget for dig, siger vi det i appen.`,
      ],
    },
  ],
};

const VILKAAR = {
  id: "vilkaar",
  titel: "Brugervilkår",
  afsnit: [
    {
      titel: "Hvad Prediction Champ er",
      tekst: [
        "En gratis tjeneste, hvor du gætter resultater i fodboldkampe mod dine venner. Den drives som et privat fritidsprojekt uden kommercielt formål.",
        "Du kan ikke spille om penge gennem tjenesten, og der er ingen præmier ud over æren.",
      ],
    },
    {
      titel: "Din konto",
      tekst: [
        `Du skal være mindst ${MINDSTEALDER} år. Kontoen er personlig — du opretter én, og du deler ikke dit login med andre.`,
        "Dit brugernavn er synligt for alle andre brugere. Vælg derfor ikke noget, du ikke vil have står i en stilling ved siden af dine venners navne, og skriv ikke andres personoplysninger i det.",
        "Det samme gælder navne på ligaer og konkurrencer, du opretter, og den tekst du sender gennem feedback-knappen.",
      ],
    },
    {
      titel: "God opførsel",
      tekst: [
        "En liga er et lukket fællesskab mellem mennesker, der kender hinanden. Chikane, trusler, ulovligt indhold og forsøg på at snyde andre hører ikke hjemme der.",
        "Forsøg heller ikke at omgå tjenestens regler teknisk — for eksempel ved at ændre tips efter en kamp er låst, oprette konti for andre eller belaste systemet med automatiske kald.",
        "Vi kan lukke en konto, der bruges i strid med disse vilkår. Sker det, får du besked på den e-mail, kontoen er oprettet med.",
      ],
    },
    {
      titel: "Kampdata og point",
      tekst: [
        "Kampprogrammer, resultater og livescore kommer fra eksterne leverandører. De kan være forsinkede, ufuldstændige eller forkerte, og point beregnes ud fra dem, som de er.",
        "Viser det sig, at et resultat var forkert, retter vi det og genberegner. Point og placeringer kan derfor ændre sig, efter du har set dem første gang.",
        "En kamp låser en time før sit eget kickoff. Efter det kan tippet ikke ændres — heller ikke hvis kampen udskydes.",
      ],
    },
    {
      titel: "Ingen garanti",
      tekst: [
        "Tjenesten leveres, som den er. Der er ingen garanti for oppetid, for at notifikationer når frem, eller for at data ikke går tabt.",
        "Der tages sikkerhedskopi én gang i døgnet. Går noget galt, kan op til et døgns data derfor forsvinde — herunder tips, du har afgivet siden sidste kopi.",
        "Vi er ikke ansvarlige for tab, der følger af brug af tjenesten, i det omfang dansk ret tillader det.",
      ],
    },
    {
      titel: "Lukning af din konto",
      tekst: [
        "Du kan til enhver tid lukke din konto inde i appen under “Sådan virker det”. Hvad der sker med dine data, står i privatlivspolitikken.",
        "Handlingen kan ikke fortrydes, og der er ingen måde at få kontoen tilbage bagefter.",
        "Vi kan også vælge at lukke hele tjenesten ned. Sker det, varsler vi det i rimelig tid, så du kan nå at hente det, du vil beholde.",
      ],
    },
    {
      titel: "Ændringer og lovvalg",
      tekst: [
        `Vilkårene blev senest opdateret ${LEGAL_OPDATERET}. Ændrer vi dem væsentligt, siger vi det i appen, før ændringen træder i kraft.`,
        "Dansk ret gælder for brugen af tjenesten.",
      ],
    },
  ],
};

const DOKUMENTER = { privatliv: PRIVATLIV, vilkaar: VILKAAR };

// Slår et dokument op på id. Et ukendt id giver `null` frem for at kaste, så en
// tastefejl i et kaldsted koster teksten og ikke hele skærmen — men kalderen
// SKAL håndtere null, og LegalScreen gør det synligt.
function findDokument(id) {
  return DOKUMENTER[id] ?? null;
}

export { PRIVATLIV, VILKAAR, DOKUMENTER, findDokument, LEGAL_OPDATERET, MINDSTEALDER, DATAANSVARLIG, KONTAKT_EMAIL };
