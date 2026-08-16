// Måle-ordbogen for Admin → Analytics. Spec: docs/features/analytics-v1.md
//
// HVORFOR DEN FINDES. Et internt dashboard er kun værd at handle på, hvis man
// kan se, hvad et tal ER, og hvordan det er regnet ud. "Deadline Miss Rate:
// 12 %" kan betyde mindst tre forskellige ting, og indtil nu stod svaret kun i
// SQL-kommentarerne — altså det ene sted, den der læser dashboardet, ikke
// kigger. Hvert nøgletal på skærmen har nu en ⓘ, der åbner de fire linjer
// herunder.
//
// FIRE FELTER, ALTID I SAMME RÆKKEFØLGE:
//   what   — hvad tallet er, i én sætning uden formel.
//   how    — hvordan det regnes ud, inkl. hvad der tælles med og hvad ikke.
//   source — hvilke tabeller/views tallet kommer fra, så det kan efterprøves
//            i Supabase SQL-editoren uden at læse RPC'en igennem.
//   caveat — hvad tallet IKKE kan bruges til. Valgfrit, men medtaget hver
//            gang der findes en kendt faldgrube.
//
// GRÆNSEN MOD SELVE SKÆRMEN (regel fra ROADMAP, 30. juli 2026): et tal skal
// navngive sit eget omfang i den sætning, det står i. En ⓘ må UDDYBE, men
// aldrig alene bære det, der skal til for at læse tallet rigtigt — derfor
// bliver etiketter og hints ved med at sige "seneste 7 dage", "alt tid" osv.,
// også når forklaringen findes her.

const METRICS = {
  // ---------- Produktets sundhed ----------
  completion_rate: {
    title: "Prediction Completion Rate (North Star)",
    what: "Hvor stor en del af de tips, brugerne faktisk KUNNE have afgivet, de rent faktisk afgav.",
    how: "Afgivne tips ÷ mulige tips. Et muligt tip er én kamp i én konkurrence, brugeren deltager i, som allerede er låst — og kun kampe, der låste EFTER brugeren meldte sig til konkurrencen. Hvert (bruger, kamp)-par tælles én gang, også når kampen indgår i flere konkurrencer.",
    source: "predictions + matches via viewet analytics_completion_facts. ALDRIG fra hændelsesloggen, som er fire-and-forget og lossy by design.",
    caveat: "Delvis udfyldning tæller forholdsmæssigt: 3 af 5 tippede kampe er 60 %, ikke 0. Ulåste kampe indgår ikke — man kan ikke have misset en deadline, der ikke er indtruffet. Enheden skiftede fra runde til kamp 1. august 2026 (A21), så en serie hen over den dato sammenligner to definitioner.",
  },
  completion_trend: {
    title: "Retning mod forrige vindue",
    what: "Forskellen i procentpoint mellem deltagelsen i det valgte vindue og det lige så lange vindue før det.",
    how: "Completion rate (vinduet) − completion rate (de foregående lige så mange dage). Regnet på nøjagtig samme måde i begge vinduer.",
    source: "analytics_completion_facts, filtreret på to på hinanden følgende perioder.",
    caveat: "Vises ikke, hvis det foregående vindue havde under 5 mulige tips — så ville en enkelt kamp kunne se ud som et fald.",
  },
  active_users: {
    title: "Aktive brugere",
    what: "Antal forskellige brugere, der har haft appen åben i perioden.",
    how: "Distinkte user_id i user_activity_days, som skrives af touchActivity(), når appen bruges. Én dag pr. bruger pr. dag — ikke antal besøg.",
    source: "user_activity_days (samme kilde som DAU/WAU/MAU i Admin → Statistik).",
    caveat: "Måler tilstedeværelse, ikke deltagelse. En bruger, der åbner appen hver dag uden nogensinde at tippe, tæller fuldt med her.",
  },
  active_groups: {
    title: "Aktive ligaer",
    what: "Ligaer, hvor nogen faktisk har TIPPET for nylig — ikke blot åbnet appen.",
    how: "Distinkte grupper med mindst ét tip AFGIVET inden for vinduet, talt via konkurrencernes kampe. Hint-tallet 'med mindst én aktiv' er den svagere version (et medlem har åbnet appen).",
    source: "predictions → competition_matches → competitions.group_id.",
    caveat: "Gabet mellem de to tal er selv interessant: ligaer hvor folk kigger forbi, men ingen spiller. Målt på `predictions.updated_at`, som siden `G13` (3. august 2026) også flytter sig, når et tip RETTES — tallet er derfor 'afgivet eller rettet', altså aktivitet. Indtil da talte det kun afgivne tips, så en liga, hvor alle kun rettede gamle tips, så død ud; tal fra før den dato er tilsvarende en anelse for lave. En gen-skrivning af den SAMME score tæller ikke med."
  },
  active_competitions: {
    title: "Aktive konkurrencer",
    what: "Konkurrencer med tipaktivitet i perioden — og hvor mange der stadig har runder foran sig.",
    how: "Aktiv = mindst ét tip AFGIVET i vinduet. 'I gang' = konkurrencen har mindst én runde, der endnu ikke er gået i gang.",
    source: "predictions + competition_matches for aktiv; analytics_round_locks for 'i gang'.",
    caveat: "De to tal er bevidst forskellige: en konkurrence kan have masser af historik uden en eneste runde tilbage, og en helt ny kan have runder foran sig uden aktivitet endnu. Som ovenfor tæller `updated_at` siden `G13` både afgivne og rettede tips — men ikke en gen-skrivning af den samme score."
  },
  deadline_miss_rate: {
    title: "Deadline Miss Rate",
    what: "Hvor stor en del af brugerne, der lod en hel runde gå, uden at afgive ét eneste tip.",
    how: "Enheden er RUNDEN, ikke kampen. En bruger missede runde R, hvis de havde mindst ét muligt tip i R og afgav NUL af dem. Headline-tallet er missede brugere ÷ aktive brugere i perioden. Runden var før valgt, fordi låsen sad dér; efter A21 låser hver kamp for sig, og enheden er nu valgt, fordi spørgsmålet har den — \"sad en bruger en spillerunde over?\".",
    source: "analytics_completion_facts grupperet pr. (bruger, sæson, runde) + user_activity_days som nævner.",
    caveat: "Er ikke det modsatte af Completion Rate: 3 af 5 tippede kampe er IKKE en miss. Det andet tal ('af dem der havde en deadline') findes, fordi headline-raten ellers falder kunstigt, efterhånden som brugerbasen vokser med folk uden konkurrencer.",
  },
  rounds_completed: {
    title: "Gennemførte spillerunder",
    what: "Runder, hvor alle kampe har fået et resultat — og som mindst én konkurrence rent faktisk bruger.",
    how: "Runder pr. (sæson, runde-nøgle), hvor antal kampe med resultat er lig antal kampe i alt, og hvor mindst én konkurrence indeholder en af rundens kampe.",
    source: "analytics_round_locks + competition_matches.",
    caveat: "Dette tal er ALT TID og følger ikke vinduesvælgeren. Søjlerne nedenunder er derimod pr. uge.",
  },
  completion_by_week: {
    title: "Completion rate pr. uge",
    what: "Den samme North Star-metrik, delt op på den uge, kampens lås faldt i.",
    how: "Pr. uge: afgivne ÷ mulige tips, hvor ugen bestemmes af kampens låsetidspunkt (ikke af hvornår tippet blev skrevet).",
    source: "analytics_completion_facts, seneste ~12 uger.",
    caveat: "En uge helt uden låste kampe har ingen søjle og vises som tom — aldrig som 0 %, som ikke kunne skelnes fra en uge, hvor ingen tippede.",
  },
  completion_by_month: {
    title: "Completion rate pr. måned",
    what: "Samme metrik som ugesøjlerne, men aggregeret pr. kalendermåned — nok datapunkter til at se en sæsonrytme.",
    how: "Pr. måned: afgivne ÷ mulige tips, måneden bestemt af kampens låsetidspunkt. Seneste 6 måneder.",
    source: "analytics_completion_facts.",
    caveat: "En indeværende måned er ufuldstændig og skal ikke sammenlignes direkte med de afsluttede.",
  },
  rounds_completed_by_week: {
    title: "Gennemførte runder pr. uge",
    what: "Hvor mange runder der blev færdigspillet i hver af de seneste 12 uger.",
    how: "Runder med resultat på alle kampe, placeret i ugen for rundens første kickoff.",
    source: "analytics_round_locks + competition_matches.",
    caveat: "Følger turneringskalenderen. Landsholdspauser giver ægte nul-uger, ikke et datahul.",
  },

  // ---------- Engagement ----------
  event_views: {
    title: "Visninger pr. funktion",
    what: "Hvor mange gange en skærm eller et element blev åbnet, og hvor mange forskellige brugere der gjorde det.",
    how: "Optælling af hændelser i hændelsesloggen. Navigations-hændelser (opened_*) throttles 20 sekunder pr. bruger og destination, så hurtige faneskift ikke tælles flere gange. Story-visninger tælles én gang pr. historie pr. sideliv.",
    source: "analytics_events, skrevet fire-and-forget fra klienten.",
    caveat: "Hændelsesloggen er lossy by design: en blokeret eller fejlet skrivning svælges stille. Tallene er derfor et GULV. Brug dem til at sammenligne funktioner med hinanden, aldrig som et facit — og aldrig til noget, en bruger kan bestride.",
  },
  invite_funnel: {
    title: "Invitationstragten",
    what: "Hvor mange invitationer der blev sendt, hvor mange der blev åbnet af en modtager med en konto, og hvor mange der endte som en tilmelding.",
    how: "Tre hændelser i vinduet: league_invite_sent (nogen trykkede Del — begge link-typer, adskilt af metadata.via), invite_landed (koden blev slået op for en indlogget modtager, uanset udfald) og league_invite_accepted (modtageren sagde ja i bekræftelsen eller indsatte koden i hånden). Læs FORHOLDET mellem dem: frafald mellem sendt og landet peger på linket, mellem landet og accepteret på bekræftelsen.",
    source: "analytics_events, aggregeret af admin_analytics_engagement.",
    caveat: "De tre tal tæller IKKE de samme ting, og en rate mellem dem er derfor kun en indikation. 'Sendt' tæller DELINGER, ikke modtagere — én deling i en gruppechat kan nå ti mennesker, og ét link kan åbnes af mange, så 'landet' kan sagtens overstige 'sendt'. 'Landet' er desuden et gulv med en systematisk blind vinkel: en modtager, der åbner linket og aldrig opretter en konto, kan slet ikke tælles (analytics_events.user_id er not null default auth.uid()) — altså netop det frafald, man helst ville se. Og som alt andet her er loggen fire-and-forget og lossy by design. Serien starter forfra 11. august 2026, hvor invite_landed blev til.",
  },
  league_views: {
    title: "Liga Views",
    what: "Åbninger af liga-fanen i alt, og hvor mange af dem der var på én bestemt liga.",
    how: "opened_league-hændelser. Dem med en liga sat er drill-in på en enkelt liga; resten er listen over alle ligaer.",
    source: "analytics_events (event_name = 'opened_league').",
    caveat: "Samme gulv-forbehold som alle andre hændelsestal.",
  },
  share_surfaces: {
    title: "Deling",
    what: "Hvor mange delinger der sendes, og fra hvilken af de fire flader: rundekortet, dagskortet, milepælen og stillingen.",
    how: "Totalerne er hændelsesnavne: `story_shared` for de tre historie-flader, `standings_shared` for stillingen. Opdelingen af de tre kan kun laves i SQL, fordi den står i `metadata.from` — 'day_card', 'milestone' eller 'frame:ROUND_SUM'/'frame:RATING' for rundekortets to delbare felter. Rækker helt uden `from` er rundekort fra før v3 gav det frames og tælles som rundekort.",
    source: "analytics_events (story_shared + standings_shared).",
    caveat: "Samme gulv-forbehold som alle andre hændelsestal — en tabt logning ligner en deling, der ikke skete. Bemærk to ting mere. **En deling tælles pr. TRYK, ikke pr. modtager:** én deling i en gruppechat kan nå ti mennesker. Og **rundekortet tæller pr. felt** — deler man to felter af samme tap-through-story, er det to delinger, hvilket er meningen (det er to forskellige billeder), men det gør fladen mindre sammenlignelig med dagskortet, hvor der kun er ét at dele. Står der 'ikke målt endnu', er `sql/analytics_dashboard.sql` ikke gen-kørt — det er ikke det samme som nul.",
  },
  push_open_rate: {
    title: "Push Notification Open Rate",
    what: "Hvor stor en del af de sendte push-beskeder, der førte til, at appen blev åbnet fra beskeden.",
    how: "Åbninger ÷ sendte. 'Sendt' tælles i notification_log, 'åbnet' er push_opened-hændelser, som udløses af ?pn= i push-linket. Splittet på type via nøglens præfiks (deadline/result/newcomp).",
    source: "notification_log (sendt) + analytics_events (åbnet).",
    caveat: "Raten er et GULV i begge ender: notification_log claimes FØR selve afsendelsen, så en fejlet levering tæller stadig som sendt, og en åbning, hvis logning fejler, tæller ikke. Sammenlign typer med hinanden frem for at læse niveauet absolut.",
  },
  session_time: {
    title: "Sessionstid",
    what: "Hvor længe et sammenhængende besøg varer, målt fra første til sidste hændelse.",
    how: "Hændelser pr. bruger deles i sessioner ved 30 minutters inaktivitet. Varighed = sidste minus første hændelse i sessionen.",
    source: "analytics_events.",
    caveat: "En session med kun ÉN hændelse måler 0 sekunder. Gennemsnittet er derfor en nedre grænse — 'flere hændelser'-tallet og medianen står ved siden af, så tallet kan læses ærligt.",
  },

  // ---------- Liga-diagnose ----------
  league_state: {
    title: "Tilstand",
    what: "Ét navngivet problem pr. liga — det mest presserende, der passer.",
    how: "Reglerne evalueres oppefra og ned, og den første, der passer, vinder: for ny → død → ingen konkurrence → dvale → ét medlem → intet at måle på → ingen tipper → bæres af én → kun en del tipper → deltagelsen falder → lav deltagelse → sund. Årsag før symptom: mangler ligaen en konkurrence, får den DEN besked, ikke 'for få tipper'.",
    source: "Udledt i klienten (diagnoseLeague i src/lib/analytics.js) af de målte signaler fra admin_analytics_league_health.",
    caveat: "Afløser den gamle Health Score (0-100), som var for bred: de fire første rigtige ligaer fik 75/77/77/88 og var alle grønne, og et tal kunne aldrig sige HVAD der var galt. Tærsklerne er stadig et velbegrundet gæt — men de er nu synlige, navngivne og hver især testbare frem for gemt i en vægtet sum.",
  },
  league_breadth: {
    title: "Bredde",
    what: "Hvor stor en del af ligaens medlemmer der overhovedet tippede i perioden.",
    how: "Antal medlemmer med mindst ét afgivet tip ÷ antal medlemmer i ligaen.",
    source: "analytics_completion_facts + group_members.",
    caveat: "Dette er signalet, den gamle score manglede. 'Andel aktive medlemmer' måler, om folk ÅBNER appen; bredde måler, om de SPILLER. En liga hvor én tipper alt og fire kigger på, kunne få samme score som en, hvor alle fem tipper.",
  },
  league_pulse: {
    title: "Puls",
    what: "Hvor mange af ligaens runder der rent faktisk blev spillet.",
    how: "Runder med mindst ét tip fra et medlem ÷ runder, hvor mindst én kamp låste i perioden.",
    source: "analytics_completion_facts.",
    caveat: "Uafhængig af bredde: en liga kan have puls 100 % (nogen tipper hver runde) og bredde 20 % (det er altid den samme).",
  },
  league_completion: {
    title: "Deltagelse (liga)",
    what: "North Star-metrikken beregnet for netop denne ligas konkurrencer.",
    how: "Præcis samme regel som den globale Completion Rate — afgivne ÷ mulige tips — men kun for kampe i ligaens konkurrencer.",
    source: "analytics_completion_facts filtreret på ligaens group_id.",
    caveat: "Måler flittighed blandt dem, der er med, ikke hvor mange der er med. Læs den altid sammen med Bredde.",
  },
  league_concentration: {
    title: "Koncentration",
    what: "Den mest aktive tippers andel af alle ligaens afgivne tips.",
    how: "Største antal tips fra ét enkelt medlem ÷ ligaens tips i alt i perioden.",
    source: "analytics_completion_facts.",
    caveat: "Høj koncentration er kun et problem sammen med lav bredde. I en liga med to lige aktive medlemmer er 50 % helt sundt.",
  },
  league_activity: {
    title: "Aktive medlemmer",
    what: "Medlemmer, der har haft appen åben i perioden — uanset om de tippede.",
    how: "Medlemmer med mindst én aktivitetsdag i vinduet ÷ antal medlemmer. Følger vinduesvælgeren.",
    source: "group_members + user_activity_days.",
    caveat: "Tilstedeværelse, ikke deltagelse. Er dette tal højt, mens Bredde er lav, kommer folk forbi uden at spille — et helt andet problem end at de er væk.",
  },
  league_retention: {
    title: "Fastholdelse (liga)",
    what: "Hvor stor en del af ligaens ældre medlemmer der stadig kommer.",
    how: "Blandt medlemmer, der har været med i mindst 28 dage: andelen med mindst én aktivitetsdag inden for de seneste 14 dage.",
    source: "group_members.joined_at + user_activity_days.",
    caveat: "Vises ikke for ligaer uden medlemmer, der er gamle nok — der står '—', ikke 0 %. En ny liga er ikke en liga med dårlig fastholdelse.",
  },
  league_last_activity: {
    title: "Seneste aktivitet",
    what: "Sidste livstegn fra ligaen, uanset hvilken slags.",
    how: "Det seneste af tre: et medlems aktivitetsdag, et tip i en af ligaens konkurrencer, eller en hændelse med ligaen sat.",
    source: "user_activity_days, predictions, analytics_events.",
    caveat: "Aktivitetsdage har kun dato, ikke klokkeslæt, så tidspunktet kan være op til et døgn for tidligt.",
  },
  league_competitions: {
    title: "Konkurrencer",
    what: "Hvor mange konkurrencer ligaen har, og hvor mange af dem der stadig har runder foran sig.",
    how: "'I gang' betyder mindst én runde, der endnu ikke er gået i gang. En konkurrence, hvis sæson er slut, tæller med i totalen, men ikke som i gang.",
    source: "competitions + competition_matches + analytics_round_locks.",
    caveat: "Nul i gang er en strukturel mangel, ikke et engagementsproblem — der er bogstavelig talt intet at tippe på.",
  },
  league_story_views: {
    title: "Story views (liga)",
    what: "Hvor mange gange et historie-kort blev vist til et medlem i ligaens sammenhæng.",
    how: "story_viewed-hændelser med ligaen sat, i perioden. Én pr. historie pr. sideliv.",
    source: "analytics_events.",
    caveat: "Den nyeste og svageste instrumentering på siden. Den indgår bevidst IKKE i diagnosen — den var 10 % af den gamle score, hvilket gav en ny instrumentering vægt, den ikke havde fortjent.",
  },

  push_effect: {
    title: "Push-effekt",
    what: "Om de, der åbnede deadline-påmindelsen, rent faktisk tippede oftere end de, der ikke åbnede den.",
    how: "Enheden er (bruger, runde): én modtaget deadline-påmindelse for én runde. For hver af dem: åbnede brugeren beskeden, og afgav de mindst ét tip i netop dén runde? Tippede-andelen beregnes for de to grupper hver for sig, og forskellen vises i procentpoint.",
    source: "notification_log (modtagere) + analytics_events (åbninger) + analytics_completion_facts (tips — altså fra predictions, ikke fra hændelsesloggen).",
    caveat: "KORRELATION, IKKE ÅRSAG. De, der åbner notifikationer, er de engagerede i forvejen — forskellen er derfor et LOFT over pushets reelle effekt, ikke et estimat af den. Et push, der aldrig blev åbnet, kan desuden godt have virket: beskeden er synlig på låseskærmen, uden at linket bliver trykket.",
  },
  push_lead_time: {
    title: "Varsel før første lås",
    what: "Hvor lang tid før deadline beskeden blev sendt — og om det gjorde en forskel for, om folk tippede.",
    how: "Tiden fra beskeden blev sendt til den første lås, brugeren stadig kunne nå (kampens kickoff minus én time), lagt i intervaller. For hvert interval: andelen af modtagerne, der nåede at tippe.",
    source: "notification_log.sent_at + analytics_match_locks.lock_at + analytics_completion_facts.",
    caveat: "Det er den eneste knap, der reelt kan drejes på (cron-tidspunktet), men intervallerne er ikke sammenlignelige uden videre: kampe med tidligt kickoff får systematisk kortere varsel. 'Ukendt' dækker beskeder, hvor ingen lås kunne findes efter afsendelsen. SERIEN STARTER FORFRA 1. august 2026: beskeden samles nu pr. bruger pr. dag, og de gamle logrækker har et nøgleformat, der bevidst udelades frem for at blive fejltolket.",
  },

  // ---------- Tragt for nye brugere ----------
  funnel: {
    title: "Tragt for nye brugere",
    what: "Hvor mange af de nyoprettede brugere der nåede hvert af de fire trin: konto → liga → konkurrence → første tip.",
    how: "Kohorten er brugere oprettet i perioden. For hver bruger findes tidligste liga-medlemskab, tidligste konkurrence-deltagelse og tidligste tip. Alt udledes af rigtige tabeller — IKKE af hændelsesloggen, som er lossy og ville undervurdere trinnene.",
    source: "profiles, group_members, competition_participants, predictions.",
    caveat: "Trinnene er ikke strengt indlejrede: en konkurrence kan være liga-løs, så en bruger kan nå 'konkurrence' uden nogensinde at have en liga. Brug derfor 'hvor står de nu' nedenunder til at læse frafaldet — dén opdeling tæller hver bruger præcis ét sted.",
  },
  funnel_path: {
    title: "Selvstarter eller inviteret",
    what: "Hvilken vej brugeren kom ind ad — og dermed hvilken af de to onboarding-oplevelser tallene gælder.",
    how: "Afgøres af den FØRSTE liga, brugeren kom med i: oprettede de den selv (selvstarter) eller trådte de ind i en andens (inviteret)? En bruger helt uden liga regnes som selvstarter, fordi en accepteret invitation altid giver liga-medlemskab med det samme (A8-invarianten) — ingen liga betyder derfor, at der aldrig blev accepteret en invitation.",
    source: "group_members + groups.created_by.",
    caveat: "Dette er den vigtigste opdeling på siden: Onboarding v1 blev bygget på, at selvstarteren faldt igennem, mens den inviterede klarede sig fint. Forskellen mellem de to kolonner er, om den antagelse holder.",
  },
  funnel_stalled: {
    title: "Hvor står de nu",
    what: "Hvor langt hver bruger i kohorten er nået — og dermed hvor mange der sidder fast hvilket sted.",
    how: "Hver bruger placeres i præcis én af fire kasser efter det længste, de har nået: uden liga / liga men ingen konkurrence / konkurrence men intet tip / hele vejen. Kasserne summer altid til kohorten.",
    source: "Samme fire tabeller som tragten.",
    caveat: "Dette er et øjebliksbillede, ikke en endelig skæbne — en bruger fra i går, der endnu ikke har tippet, tæller som fastlåst. Læs derfor hellere de ældre kohorter, når du vil vurdere, om et trin er en reel forhindring.",
  },
  funnel_time: {
    title: "Tid til trinnet",
    what: "Mediantiden fra kontoen blev oprettet, til brugeren nåede trinnet.",
    how: "Median (ikke gennemsnit, som ét ekstremt tilfælde ville trække skævt) af tiden fra oprettelse til trinnets tidsstempel, kun blandt dem der NÅEDE trinnet.",
    source: "profiles.created_at sammenholdt med de tre trin-tidsstempler.",
    caveat: "Tid til første tip er en ØVRE grænse: `predictions` har ingen created_at, kun updated_at, som flytter sig når et tip rettes. Retter en bruger sit allerførste tip en uge senere, ser det ud som om, de ventede en uge. Antallet der nåede trinnet er upåvirket — kun tiden kan være for høj. Forbeholdet var indtil `G13` (3. august 2026) forkert i sin egen præmis: feltet flyttede sig slet ikke ved en rettelse. Nu gør det, og advarslen er blevet sand.",
  },

  // ---------- Story Engine ----------
  story_rules: {
    title: "Story Engine pr. regel",
    what: "Hvilke af motorens regler der faktisk udløser, og hvordan folk reagerer på dem.",
    how: "Genererede historier og afvisninger tælles pr. regel i stories-tabellen. Visninger og delinger kommer fra hændelsesloggen, hvor regelnavnet følger med i metadata. Procenterne regner på VIS-BAR og ikke på genereret — se den måling.",
    source: "public.stories (genereret, vis-bar, afvist) + analytics_events (vist, delt).",
    caveat: "De to kilder har forskellig pålidelighed: genereret og afvist er RIGTIGE rækker og præcise, mens vist og delt er fire-and-forget og derfor et GULV. En lav visningsrate kan lige så godt være tabt logning som en historie, ingen så. Sammenlign regler med hinanden, ikke med et ideal.",
  },
  story_viewable: {
    title: "Kunne vises",
    what: "De genererede historier, der overhovedet kunne nå en skærm — og dermed nævneren under alle procenterne i tabellen.",
    how: "Karusellen på Hjem henter kun kort fra den NUVÆRENDE runde (`round_key = <nuværende>`). Et kort tæller derfor som vis-bart, hvis det blev skrevet, før dets egen runde var forbi — altså før midnat dansk tid på tirsdagen efter rundenøglen.",
    source: "public.stories: created_at sammenholdt med round_key + 7 dage.",
    caveat: "Målingen kom af `G73` (august 2026), hvor 197 af 280 historier var efterfyldte dagskort med nul visninger: med `genereret` som nævner målte visningsraten efterfyldningen og ikke brugerne. To ting gør et kort ikke-vis-bart, og kun den ene er en engangsudgift — v2's efterfyldning af historikken, og et runde-kort hvis runde først blev spillet færdig efter den var forbi (en udsat kamp). Den anden kan ske igen.",
  },
  story_never: {
    title: "Regler der aldrig udløser",
    what: "Regler i motorens katalog, som ikke har genereret en eneste historie — hverken i perioden eller nogensinde.",
    how: "Katalogen med de 23 regler — 16 fra runde-motoren og 7 fra dags-motoren (v2) — holdes i klienten (`STORY_RULES`) og sammenholdes med, hvad databasen faktisk indeholder. En regel, der har udløst før, men ikke i perioden, markeres 'Stille' i stedet — det er to forskellige ting.",
    source: "src/lib/analytics.js sammenholdt med public.stories. En test læser alle sql/story_engine*.sql og fejler, hvis katalogen driver fra motoren.",
    caveat: "En regel, der aldrig udløser, er den dyreste slags død kode: den ser ud til at virke. Men en tærskel kan også bare være for stram — se `docs/features/story-engine-v1.md` afsnit 10 før du fjerner noget.",
  },
  story_coverage: {
    title: "Dækning",
    what: "Hvor stor en del af de brugere, der havde en afsluttet runde, som fik mindst én historie.",
    how: "Brugere med mindst én genereret historie i perioden ÷ brugere med mindst ét muligt tip på en låst kamp i samme periode.",
    source: "public.stories + analytics_completion_facts.",
    caveat: "Det er dette tal, v1.1-leverancen blev målt på (1 af 8 → 8 af 8 brugere i premiereugen) — nu permanent i stedet for en engangsmåling. Under 100 % betyder, at nogen fik en runde uden en eneste historie.",
  },

  // ---------- Retention ----------
  user_retention: {
    title: "Bruger-retention",
    what: "Hvor stor en del af brugerne der stadig er der i uge N efter, de oprettede sig.",
    how: "Pr. milepæl N: andelen af brugere, der har mindst én aktivitetsdag i ugen fra N til N+1 efter oprettelsen. Kun brugere, der er gamle nok til at have nået milepælen, tæller med.",
    source: "profiles.created_at + user_activity_days.",
    caveat: "Aktivitetsdata findes først fra den dato, der står nederst i sektionen. En milepæl, hvis vindue åbner før dén dato, vises som 'Ingen data endnu' — ALDRIG som 0 %, som ikke kunne skelnes fra ægte frafald.",
  },
  league_retention_agg: {
    title: "Liga-retention",
    what: "Hvor stor en del af ligaerne der stadig viser livstegn i uge N efter oprettelsen.",
    how: "En liga er i live ved milepæl N, hvis et nuværende medlem enten har en aktivitetsdag eller afgav et tip i ugen fra N til N+1 efter ligaens oprettelse.",
    source: "groups.created_at + group_members + user_activity_days + predictions.",
    caveat: "Medlemskab vurderes som det ser ud NU, ikke som dengang: medlemmer, der siden har forladt ligaen, indgår ikke. Bevidst tilnærmelse — billigere end at rekonstruere historisk medlemskab, og godt nok til et livstegn.",
  },
  user_cohorts: {
    title: "Kohorter pr. tilmeldingsuge",
    what: "Samme bruger-retention, men delt op efter hvilken uge brugerne oprettede sig i.",
    how: "Seneste 12 ugentlige kohorter × de fem milepæle. Hver celle er den kohortes retention ved den milepæl.",
    source: "profiles.created_at + user_activity_days.",
    caveat: "En celle uden målbart data er gråtonet med '–'. Små kohorter svinger voldsomt: én bruger i en uge giver enten 0 % eller 100 %.",
  },
};

// Slå en metrik op. Ukendt id giver null frem for at kaste — en tastefejl i et
// id må koste ⓘ'en, aldrig hele sektionen.
function metricInfo(id) {
  return METRICS[id] || null;
}

export { METRICS, metricInfo };
