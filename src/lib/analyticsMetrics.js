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
    how: "Afgivne tips ÷ mulige tips. Et muligt tip er én kamp i én konkurrence, brugeren deltager i, i en runde der allerede er låst — og kun runder, der låste EFTER brugeren meldte sig til konkurrencen. Hvert (bruger, kamp)-par tælles én gang, også når kampen indgår i flere konkurrencer.",
    source: "predictions + matches via viewet analytics_completion_facts. ALDRIG fra hændelsesloggen, som er fire-and-forget og lossy by design.",
    caveat: "Delvis udfyldning tæller forholdsmæssigt: 3 af 5 tippede kampe er 60 %, ikke 0. Ulåste runder indgår ikke — man kan ikke have misset en deadline, der ikke er indtruffet.",
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
    how: "Distinkte grupper med mindst ét tip opdateret inden for vinduet, talt via konkurrencernes kampe. Hint-tallet 'med mindst én aktiv' er den svagere version (et medlem har åbnet appen).",
    source: "predictions → competition_matches → competitions.group_id.",
    caveat: "Gabet mellem de to tal er selv interessant: ligaer hvor folk kigger forbi, men ingen spiller.",
  },
  active_competitions: {
    title: "Aktive konkurrencer",
    what: "Konkurrencer med tipaktivitet i perioden — og hvor mange der stadig har runder foran sig.",
    how: "Aktiv = mindst ét tip opdateret i vinduet. 'I gang' = konkurrencen har mindst én endnu ulåst runde.",
    source: "predictions + competition_matches for aktiv; analytics_round_locks for 'i gang'.",
    caveat: "De to tal er bevidst forskellige: en konkurrence kan have masser af historik uden en eneste runde tilbage, og en helt ny kan have runder foran sig uden aktivitet endnu.",
  },
  deadline_miss_rate: {
    title: "Deadline Miss Rate",
    what: "Hvor stor en del af brugerne, der lod en hel runde gå, uden at afgive ét eneste tip.",
    how: "Enheden er RUNDEN, ikke kampen. En bruger missede runde R, hvis de havde mindst ét muligt tip i R og afgav NUL af dem. Headline-tallet er missede brugere ÷ aktive brugere i perioden.",
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
    what: "Den samme North Star-metrik, delt op på den uge, rundens lås faldt i.",
    how: "Pr. uge: afgivne ÷ mulige tips, hvor ugen bestemmes af rundens låsetidspunkt (ikke af hvornår tippet blev skrevet).",
    source: "analytics_completion_facts, seneste ~12 uger.",
    caveat: "En uge helt uden låste runder har ingen søjle og vises som tom — aldrig som 0 %, som ikke kunne skelnes fra en uge, hvor ingen tippede.",
  },
  completion_by_month: {
    title: "Completion rate pr. måned",
    what: "Samme metrik som ugesøjlerne, men aggregeret pr. kalendermåned — nok datapunkter til at se en sæsonrytme.",
    how: "Pr. måned: afgivne ÷ mulige tips, måneden bestemt af rundens låsetidspunkt. Seneste 6 måneder.",
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
  league_views: {
    title: "Liga Views",
    what: "Åbninger af liga-fanen i alt, og hvor mange af dem der var på én bestemt liga.",
    how: "opened_league-hændelser. Dem med en liga sat er drill-in på en enkelt liga; resten er listen over alle ligaer.",
    source: "analytics_events (event_name = 'opened_league').",
    caveat: "Samme gulv-forbehold som alle andre hændelsestal.",
  },
  push_open_rate: {
    title: "Push Notification Open Rate",
    what: "Hvor stor en del af de sendte push-beskeder, der førte til, at appen blev åbnet fra beskeden.",
    how: "Åbninger ÷ sendte. 'Sendt' tælles i notification_log, 'åbnet' er push_opened-hændelser, som udløses af ?pn=/?rk= i push-linket. Splittet på type via nøglens præfiks (deadline/resultat).",
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
    how: "Runder med mindst ét tip fra et medlem ÷ runder, der låste i perioden.",
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
    how: "'I gang' betyder mindst én endnu ulåst runde. En konkurrence, hvis sæson er slut, tæller med i totalen, men ikke som i gang.",
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
