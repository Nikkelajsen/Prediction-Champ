// Milepæls-katalog — ren tekst- og metadata-logik. Ingen netværkskald, ingen React.
//
// FORSKELLEN PÅ EN MILEPÆL OG EN HISTORIE er hele grunden til, at denne fil
// findes ved siden af src/lib/stories.js:
//   historie = hvad der skete i denne runde/dag. Flygtig, gentager sig,
//              forsvinder fra Hjem igen.
//   milepæl  = noget du har opnået ÉN gang og altid har opnået. Permanent.
//
// Indtil august 2026 var de det samme: karriereprofilen kaldte alle
// `stories`-rækker med `priority < 90` for milepæle, og da Story Engine gemmer
// alle udløste kandidater hver runde, blev arkivet en rundelog. Milepælene bor
// nu i deres egen tabel (sql/milestones.sql).
//
// TEKSTEN BOR KUN HER. Modsat historierne — hvor SQL'en gemmer færdig
// headline/body, og denne mappe spejler skabelonerne — gemmer milestones-
// tabellen kun `key` + `payload`. Der er derfor ingen skabelon at holde i sync,
// og en formulering kan rettes uden en migrering.

// Familierne i den rækkefølge, karriereprofilen viser dem.
export const MILESTONE_FAMILIES = [
  { key: "competition", label: "Konkurrence" },
  { key: "rating", label: "Rating" },
  { key: "precision", label: "Streaks & præcision" },
  { key: "community", label: "Fællesskab" },
];

// Hjælper til de tierede familier, så en tærskel kun står ét sted: tallene
// listes, og både nøgle, titel og tekst udledes af dem.
const tiers = (prefix, family, icon, nums, title, body) =>
  Object.fromEntries(nums.map((n) => [
    `${prefix}${n}`, { family, icon, title: title(n), body: (p) => body(p, n) },
  ]));

// Kataloget. `body` er en funktion af payload — den er ALTID defensiv over for
// manglende felter, fordi payload skrives af SQL'en og en gammel række kan
// mangle et felt, en nyere formulering gerne vil bruge.
export const MILESTONES = {
  // ---------- Konkurrence ----------
  COMP_FIRST_WIN: {
    family: "competition", icon: "🏆", title: "Første sejr i en konkurrence",
    body: (p) => (p.league ? `Du vandt ${p.league}.` : "Du vandt din første konkurrence."),
  },
  COMP_WIN_BIG_8: {
    family: "competition", icon: "🥇", title: "Sejr i en stor konkurrence",
    body: (p) => `Du vandt ${p.league || "en konkurrence"} med ${p.total || 8} deltagere.`,
  },
  COMP_PODIUM: {
    family: "competition", icon: "🏅", title: "På podiet",
    body: (p) => `Du sluttede nr. ${p.rank || 3} i ${p.league || "en konkurrence"}.`,
  },
  COMP_COMEBACK: {
    family: "competition", icon: "🚀", title: "Comeback",
    body: (p) => `Du vandt ${p.league || "en konkurrence"} uden at have ført undervejs.`,
  },
  // Nøglen deler navn med story-reglen MONTH_CHAMP, men de bor i hver sit
  // navnerum (stories.rule vs. milestones.key) og betyder det samme øjeblik:
  // historien fortalte det, da det skete, milepælen husker det bagefter.
  MONTH_CHAMP: {
    family: "competition", icon: "👑", title: "Månedens Champion",
    body: (p) => `${p.shared ? "Delt vinder" : "Vinder"} af månedschampionshippet` +
      (p.month ? ` i ${p.month}.` : "."),
  },
  SEASON_CHAMP: {
    family: "competition", icon: "👑", title: "Sæsonens Champion",
    body: (p) => `${p.shared ? "Delt vinder" : "Vinder"} af sæsonchampionshippet.`,
  },

  // ---------- Rating ----------
  RATING_ESTABLISHED: {
    family: "rating", icon: "📈", title: "Etableret",
    body: () => "Du har gennemført de fem provisoriske runder — din rating tæller nu fuldt.",
  },
  ...tiers("RATING_", "rating", "📈", [1100, 1200, 1300, 1400],
    (n) => `Rating ${n}`,
    (p, n) => `Din rating nåede ${p.peak || n}.`),
  LEADERBOARD_TOP10: {
    family: "rating", icon: "🔟", title: "Top 10 på ranglisten",
    body: (p) => `Du var nr. ${p.rank || 10} af ${p.total || "alle"} på den globale rangliste.`,
  },
  LEADERBOARD_TOP3: {
    family: "rating", icon: "🥉", title: "Top 3 på ranglisten",
    body: (p) => `Du var nr. ${p.rank || 3} af ${p.total || "alle"} på den globale rangliste.`,
  },
  LEADERBOARD_NO1: {
    family: "rating", icon: "👑", title: "Nr. 1 på ranglisten",
    body: (p) => `Du stod øverst på den globale rangliste blandt ${p.total || "alle"} spillere.`,
  },

  // ---------- Streaks & præcision ----------
  ...tiers("POINTS_STREAK_", "precision", "🔥", [5, 10, 20],
    (n) => `${n} kampe i træk med point`,
    (p, n) => `Din længste stime er ${p.streak || n} kampe med point i træk.`),
  ...tiers("ROUNDS_COMPLETE_", "precision", "✅", [10, 30, 100],
    (n) => `Aldrig glemt · ${n} runder`,
    (p, n) => `${p.rounds || n} runder i træk med alle tips afgivet.`),
  PERFECT_ROUND: {
    family: "precision", icon: "🎯", title: "Perfekt runde",
    body: (p) => `Alle ${p.matches || "dine"} udfald korrekte i én runde.`,
  },
  PERFECT_ROUND_EXACT: {
    family: "precision", icon: "💎", title: "Perfekt runde — alle præcise",
    body: (p) => `Alle ${p.matches || "dine"} resultater ramt præcist i én runde.`,
  },
  ...tiers("TIPS_", "precision", "📝", [100, 500, 1000],
    (n) => `${n} tips afgivet`,
    (p, n) => `Du har afgivet ${p.tips || n} tips.`),
  ...tiers("EXACT_", "precision", "🎯", [50, 250],
    (n) => `${n} præcise resultater`,
    (p, n) => `Du har ramt ${p.exact || n} resultater helt præcist.`),

  // ---------- Fællesskab ----------
  FIRST_LEAGUE_CREATED: {
    family: "community", icon: "🏟️", title: "Du oprettede din første liga",
    body: (p) => (p.league ? `${p.league} blev til, fordi du startede den.` : "Du startede din første liga."),
  },
  FIRST_COMPETITION_CREATED: {
    family: "community", icon: "🎲", title: "Du oprettede din første konkurrence",
    body: (p) => (p.competition ? `${p.competition} blev til, fordi du startede den.`
      : "Du startede din første konkurrence."),
  },
  // HVORFOR IKKE "5/10 venner tilmeldt via dit link": den attribution findes
  // ikke i skemaet — `groups.invite_code` er én kode pr. liga og ikke pr.
  // bruger, og hverken `group_members` eller `competition_participants` gemmer,
  // hvem der inviterede. Se sql/milestones.sql for den fulde begrundelse og
  // backloggens B20 for den feature, der ville lukke den.
  // Dette er en ANDEN bedrift, og den hedder derfor noget andet.
  LEAGUE_GREW_5: {
    family: "community", icon: "🤝", title: "5 med i din liga",
    body: (p) => `${p.members || 5} andre er kommet med i en liga, du har oprettet.`,
  },
  LEAGUE_GREW_10: {
    family: "community", icon: "🤝", title: "10 med i din liga",
    body: (p) => `${p.members || 10} andre er kommet med i en liga, du har oprettet.`,
  },
  SEASONS_2: {
    family: "community", icon: "📅", title: "To sæsoner med",
    body: () => "Du har spillet med i to sæsoner.",
  },
  SEASONS_3: {
    family: "community", icon: "📅", title: "Tre sæsoner med",
    body: () => "Du har spillet med i tre sæsoner.",
  },
};

// Render en milepæl til { icon, title, body }. En ukendt nøgle — fx en, der er
// uddelt af en nyere SQL-version end den kode, brugeren har hentet — falder
// tilbage på nøglen selv frem for at kaste. Et arkiv må ikke kunne vælte
// karriereprofilen.
export function renderMilestone(key, payload = {}) {
  const def = MILESTONES[key];
  if (!def) return { icon: "•", title: key, body: "" };
  let body;
  try { body = def.body ? def.body(payload || {}) : ""; } catch { body = ""; }
  return { icon: def.icon, title: def.title, body };
}

export function familyOf(key) {
  return MILESTONES[key]?.family || "other";
}

// Rækkefølgen på milepælene i karusellen på Hjem — nyeste DAG først, og inden
// for dagen den mest interessante.
//
// Hvorfor dagen og ikke tidsstemplet: `achieved_at` er `now()` i det øjeblik,
// `award_milestones()` kører, og den funktion er en BATCH-genberegning, der
// kaldes lazy fra klienten. Flere milepæle får derfor rutinemæssigt det samme
// tidsstempel — ned til mikrosekundet ved den første kørsel for en bruger, som
// uddeler hele historikken på én gang. Da havde `order by achieved_at desc`
// intet at sortere på, og databasen valgte frit hvilke tre der kom med. Målt i
// et gennemspillet testmiljø: 15 milepæle, ÉT distinkt tidsstempel — og de tre,
// der blev vist, var "Du oprettede din første liga", "… første konkurrence" og
// en sæsonstatistik, mens en sæsontitel lå længere nede i den samme bunke.
//
// Rangordenen er `MILESTONE_FAMILIES`' egen og ikke en ny opfindelse:
// konkurrence → rating → præcision → fællesskab. Karriereprofilen grupperer
// allerede efter den, så de to flader er enige om, hvad der vejer tungest —
// hvad man har PRÆSTERET slår, hvad man har sat op. `tier` bruges kun INDEN FOR
// en familie: skalaen er familie-relativ (`TIPS_100` har tier 100, mens
// `COMP_FIRST_WIN` har 1), så den kan ikke sammenlignes på tværs.
const FAMILY_RANK = new Map(MILESTONE_FAMILIES.map((f, i) => [f.key, i]));

export function compareMilestones(a, b) {
  const day = (m) => String(m.achieved_at || m.achievedAt || "").slice(0, 10);
  const rank = (m) => FAMILY_RANK.get(m.family || familyOf(m.key)) ?? FAMILY_RANK.size;
  return (
    day(b).localeCompare(day(a)) ||
    rank(a) - rank(b) ||
    (b.tier ?? 0) - (a.tier ?? 0) ||
    String(a.key || "").localeCompare(String(b.key || ""))
  );
}

// Grupperet til karriereprofilen: familierne i fast rækkefølge, og inden for
// hver familie nyeste først. Familier uden rækker udelades helt.
export function groupMilestones(rows) {
  const byFamily = new Map(MILESTONE_FAMILIES.map((f) => [f.key, []]));
  for (const m of rows || []) {
    const fam = m.family || familyOf(m.key);
    if (!byFamily.has(fam)) byFamily.set(fam, []);
    byFamily.get(fam).push(m);
  }
  return MILESTONE_FAMILIES
    .map((f) => ({
      ...f,
      items: (byFamily.get(f.key) || []).slice().sort(
        (a, b) => String(b.achievedAt || "").localeCompare(String(a.achievedAt || ""))
      ),
    }))
    .filter((f) => f.items.length > 0);
}
