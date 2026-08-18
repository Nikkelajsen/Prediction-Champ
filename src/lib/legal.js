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
//
// For localStorage-nøglerne er reglen siden `G71` (august 2026) maskinel:
// `NØGLENS_LØFTE` i legal.test.js oversætter hvert navn i `LOKALE_NØGLER` til
// den sætning, der beskriver det — og fejler i begge retninger. De to andre
// dele af reglen (en ny tabel, en ny tredjepart) står stadig kun her.

// Udfyldt 9. august 2026 med `B25`. De stod som `[NAVN]` og `[KONTAKT-E-MAIL]`
// fra august 2026, fordi hverken domænet eller postkassen fandtes endnu — og
// tjeklisten i DOCUMENTATION.md §11 sagde, at teksten ikke måtte regnes som
// offentliggjort før. Nu findes begge dele.
//
// En test håndhæver stadig, at de kun står i kontakt- og rettigheds-afsnittene.
// Den kan pr. konstruktion ikke se, om de ER udfyldt — men det kan
// docs/mail/templates.test.js, som kræver, at skabelonerne nævner den samme
// adresse, og som fejler på en pladsholder med kantede parenteser.
const DATAANSVARLIG = "Nikolaj Aarslev Rasmussen";
const KONTAKT_EMAIL = "kontakt@leagly.app";

// Én dato for begge dokumenter. To ville uvægerligt komme ud af trit.
//
// Datoen flytter sig ved en ÆNDRING af behandlingen, ikke ved en rettelse af
// teksten: dokumentet lover selv kun at opdatere den, når "vi ændrer noget
// væsentligt". Da `pc_pwa_onboarded` fik sin manglende linje (`G69`, august
// 2026), stod den derfor stille — flaget har ligget på enheden hele tiden, og
// en dato, der rykker ved hver tekstrettelse, holder op med at kunne bruges til
// at se, hvornår behandlingen sidst blev en anden.
// Flyttet 5. august 2026 (`A25`): en lukket konto meldes nu af de konkurrencer,
// der ikke er begyndt. Det er en ændring af, hvad der SKER med data ved en
// lukning, og altså præcis det, datoen findes for at markere.
// Flyttet igen 7. august 2026 (`G77`): brugsloggen slettes nu efter 18 måneder.
// Ændringen er til brugerens fordel, og det gør den ikke mindre væsentlig —
// hvor længe noget gemmes, er en af de få ting, en politik faktisk lover.
// Flyttet igen 9. august 2026 (`B25`): to databehandlere kom til — Resend, som
// sender login-mailene, og Microsoft, som bærer kontakt-postkassen. En ny
// modtager af persondata er den mest oplagte af alle "væsentlige ændringer".
const LEGAL_OPDATERET = "2026-08-09";

const MINDSTEALDER = 13;

const PRIVATLIV = {
  id: "privatliv",
  titel: "Privatlivspolitik",
  afsnit: [
    {
      titel: "Hvem står bag",
      tekst: [
        `Leagly drives af ${DATAANSVARLIG} som et privat fritidsprojekt. Det er mig, der er dataansvarlig for de oplysninger, appen behandler.`,
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
            "Fejlrapporter: går appen i stå, gemmer vi den tekniske fejlbesked sammen med appens version, hvilken skærm du stod på, adressen i browseren og hvilken browser du bruger. Det sker automatisk og indeholder ikke dine tips — det er kun det, der skal til for at finde fejlen og rette den.",
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
            "Ingen IP-adresse og ingen browser-oplysninger i vores brugslog. Din browser-streng gemmes to steder og kun dér: når du selv sender en feedback-melding, og hvis appen går i stå og sender en fejlrapport.",
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
            "Om du er færdig med introduktionen, om du har skjult checklisten Kom godt i gang, om du har lukket kortet om notifikationer eller slået dem fra under Indstillinger, og om du har lukket forslaget om at oprette en liga.",
            "Om du har set vejledningen til at lægge appen på din hjemmeskærm, så den kun vises én gang.",
            "Hvilken turnering du sidst kiggede på i Championship.",
            "Hvilke af dine konkurrencer du allerede har set slutte, så fejringen af en afsluttet konkurrence kun vises én gang.",
            "Hvilke af dine historier du allerede har set, så markeringen af en ulæst historie kun vises, indtil du har set den.",
            "Hvilken invitation du var på vej ind ad, hvis du åbnede et invitationslink uden at være logget ind — så den ikke går tabt, mens du opretter en konto. Den slettes, når du er kommet med, og senest efter et døgn.",
          ],
        },
        "Alt på nær sessionen og den ventende invitation er mærket med din konto. Deler du enhed med andre, ser de derfor deres egen introduktion og deres egne valg — ikke dine. De to undtagelser kan ikke mærkes: de findes netop i det øjeblik, hvor der endnu ikke er nogen konto at mærke dem med.",
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
            "Resend sender de to mails, login kræver: bekræftelse af din e-mail og nulstilling af adgangskode. De ser din e-mailadresse og mailens indhold — ikke andet om dig. Serverne står i Irland, som hos Supabase.",
            "Microsoft leverer den postkasse, kontakt-adressen peger på. Skriver du til os, ligger din henvendelse dér.",
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
        "Så længe du har en konto — med én undtagelse: din brugslog (hvad du åbner og gemmer) slettes automatisk, når den er 18 måneder gammel. Det sker af sig selv, uanset om du lukker kontoen eller ej.",
        "Vælger du at lukke kontoen, sker der følgende med det samme:",
        {
          punkter: [
            "Din e-mail fjernes, og du kan ikke længere logge ind.",
            "Dit brugernavn erstattes af et pseudonym som “Slettet 3f8a1c2d”.",
            "Din brugslog, dine aktive dage, dine push-abonnementer, din notifikationslog og dine historie-kort slettes.",
            "Dine feedback-meldinger og eventuelle fejlrapporter bliver stående, men uden forbindelse til dig.",
            "Er du med i en konkurrence, hvor ingen kamp er begyndt, bliver du meldt af den. Der er ingen stilling at efterlade et hul i, og du ville ellers stå på deltagerlisten hele sæsonen uden at kunne spille med.",
          ],
        },
        "Dine tips, point, rating og kåringer bliver stående under pseudonymet. Det er ikke en udeladelse: de er grundlaget for dine venners stillinger og historik, og en slettet spiller ville give huller i konkurrencer, andre har spillet færdig. Din plads i en gammel stilling står altså tilbage — bare uden dit navn. Det samme gælder en konkurrence, der er i gang: dér bliver du stående, også hvis du ikke nåede at tippe.",
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
      titel: "Hvad Leagly er",
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
