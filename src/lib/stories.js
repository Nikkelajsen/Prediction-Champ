// Story Engine — ren regel-logik (prioritering, udvælgelse, tekst-rendering).
//
// Selve genereringen sker i databasen (sql/story_engine.sql, generate_stories),
// som gemmer færdig headline+body. Dette modul spejler prioriterings-/udvælgelses-
// reglen og tekst-skabelonerne, så logikken kan enhedstestes (vitest, jf.
// docs/features/story-engine-v1.md afsnit 9) og genbruges i frontend (fallback-
// rendering fra payload). Skabelonerne SKAL holdes i sync med SQL'ens tekster.
//
// v1.1 (juli 2026): tre nye regler (PODIUM_ENTER, CLOSING_IN, PERSONAL_BEST),
// sænkede tærskler med svag prioritet (SOFT_PRIORITY) og et dæmpet tier
// (SEASON_OPENER, QUIET_ROUND), der kun genereres, når intet andet udløses.
//
// v1.2 (august 2026): to regler for de LOKALE kåringer (AWARD_WEEK,
// AWARD_MONTH). De læser `competition_awards` i SQL'en frem for at regne noget
// om, så et kort aldrig kan modsige den kåring, boardet viser.
//
// v3 (august 2026): motoren VÆLGER frem for at udgive. Ét kort pr. bruger pr.
// dag, valgt på en nyhedsværdi-score (scoreDailyCandidates/pickDay nedenfor),
// og rundekortet er blevet en tap-through-story med frames (renderFrame).

import { renderMilestone } from "./milestones.js";

// Prioritetsstige (lavere tal = vigtigere). Én kilde til sandhed for regel-metadata.
// Værdien her er reglens STÆRKE prioritet; tre regler har også en svag variant,
// se SOFT_PRIORITY og priorityFor() nedenfor.
export const RULES = {
  MONTH_CHAMP: 10,
  // Lokal månedstitel: større end alt, hvad én runde kan producere, mindre end
  // den globale månedstitel.
  AWARD_MONTH: 15,
  LEAD_TAKEN: 20,
  LEAD_LOST: 21,
  PODIUM_ENTER: 22,
  RATING_HIGH: 30,
  H2H_PASS: 40,
  CLOSING_IN: 45,
  COMEBACK: 50,
  PERSONAL_BEST: 55,
  STREAK: 60,
  // Lokal ugetitel. Ligger LIGE over rundens vinder, fordi det er det samme
  // øjeblik set fra konkurrencens eget navnesystem — og når den findes, springer
  // ROUND_WON over (se sql/story_engine.sql regel 70).
  AWARD_WEEK: 65,
  ROUND_WON: 70,
  SHARP: 80,
  // Dæmpet tier (≥ QUIET_TIER_MIN): genereres KUN for brugere, der ellers ville
  // stå helt uden historie i runden. Renderes uden guld, uden emoji og uden Del.
  SEASON_OPENER: 90,
  QUIET_ROUND: 100,
};

// ---------------------------------------------------------------------------
// v2 (august 2026) — DAGLIGE historier.
//
// Reglerne ovenfor hører til RUNDEN og udløses, når rundens sidste resultat er
// inde. Reglerne herunder hører til DAGEN og udløses, når dagens sidste kamp er
// færdigspillet. Kortene akkumulerer gennem runden i karusellen på Hjem, og på
// rundens sidste dag lægger runde-kortet sig øverst.
//
// BÅNDET 110–189 ER VALGT MED VILJE og ikke som en parallel 10–100-stige:
//   1) karriereprofilens milepæle filtrerede på `priority < QUIET_TIER_MIN`, så
//      dagskort udelukkes AUTOMATISK fra arkivet. En parallel stige ville have
//      oversvømmet minde-listen med "Dagens facit: 4 point" — netop den fejl,
//      v2 er sat i verden for at rette.
//   2) en forespørgsel, der glemmer at filtrere på periode, men sorterer på
//      prioritet, sætter stadig runde-kort først. Sikker degradering.
//   3) isQuiet() beholder sin betydning for latest_story, som nu er runde-only.
// v3 (august 2026): MILESTONE er kommet til som dagbåndets top, og DAY_RESULT
// er flyttet fra 110 til 180 — det reserverede dæmpede tier er taget i brug.
// Med grundvægt 8 kan dagens facit aldrig nå publiceringstærsklen ved egen
// kraft (8 + 12 + 20 = 40 < 45), så den udgives KUN som fald-tilbage, og et
// fald-tilbage skal se dæmpet ud.
export const DAILY_RULES = {
  MILESTONE: 110,
  CONTRARIAN: 120,
  COLLECTIVE_MISS: 125,
  DAY_TOP: 130,
  STREAK_STATUS: 140,
  DUEL: 150,
  SO_CLOSE: 160,
  DAY_RESULT: 180,
};

// Båndets grænser. 180–189 er det dæmpede dagstier.
export const DAILY_TIER_MIN = 110;
export const DAILY_QUIET_MIN = 180;
export function isDaily(priority) {
  return (priority ?? 0) >= DAILY_TIER_MIN;
}
// Dæmpet dagskort: mindre overskrift, ingen emoji, ingen ulæst-markering.
export function isDailyQuiet(priority) {
  return (priority ?? 0) >= DAILY_QUIET_MIN;
}

// Højst så mange dagskort pr. bruger pr. dag. ÉT — på tværs af alle
// konkurrencer. I v2 var tallet 2 og loftet "pr. regel, derefter i alt"; nu er
// der kun ét slot, og det håndhæves af et unikt indeks på (user_id, day_key) i
// databasen frem for af koden her. Konstanten står tilbage som den værdi,
// frontenden regner med at møde.
export const DAILY_MAX_CARDS = 1;

// ---------------------------------------------------------------------------
// v3 · NYHEDSVÆRDI (spec docs/features/story-engine-v3.md §4)
//
//   nyhedsværdi = grundvægt + størrelse + nærhed
//
// ALLE TAL HERUNDER STÅR OGSÅ I sql/story_engine_v3.sql OG SKAL VÆRE ENS.
// Det er en værre fejltype end de dobbelt-vedligeholdte tekster: en afvigelse i
// en grundvægt eller et nærhedsled giver ikke en fejl og ikke en forkert
// formulering, men et ANDET kort — uden log, uden at nogen opdager det.
// sql/tests/story_engine_daily.sql påstår de præcise news_value-tal netop
// derfor. Backloggens G78 er opgaven med at fjerne dobbeltheden helt.
export const BASE_WEIGHTS = {
  MILESTONE: 100,       // vinder altid; kaprer dagens slot
  DAY_TOP: 34,          // dagens højeste i konkurrencen
  CONTRARIAN: 32,       // den eneste, der ramte
  DUEL: 30,             // nærmeste rival flyttede sig
  STREAK_STATUS: 28,    // stimen lever eller brød
  COLLECTIVE_MISS: 24,  // ingen ramte
  SO_CLOSE: 18,         // ≥2 nærmisser
  DAY_RESULT: 8,        // ankeret — kan aldrig alene nå tærsklen
};

// Størrelse (0–30): tre bidrag med hver sit loft, summen loftet ved 30.
// Størrelsen hører til HÆNDELSEN og dermed til hovedpersonen — ikke til
// modtageren.
export const SIZE_CAPS = { move: 18, over: 12, streak: 12, total: 30 };
export const SIZE_RATES = { move: 6, over: 3, streak: 2, streakFrom: 5 };

// Nærhed (0–20): det bidrag, der gør en fremmeds aften til brugerens historie.
// Beregnes PR. MODTAGER — samme kamp giver forskellige kort til forskellige
// brugere, og det er meningen.
export const PROXIMITY = { self: 20, rival: 14, biggest: 8, other: 4 };

// Publiceringstærsklen. Vinder ≥ 45 udgives som dagens historie med
// ulæst-markering; herunder udgives et dæmpet DAY_RESULT uden.
//
// TALLET ER ET KVALIFICERET GÆT OG SKAL MÅLES, IKKE TROS (spec §5). Målet er,
// at 40–60 % af kampdagene får ulæst-markering for en aktiv bruger. Over 70 %
// er tærsklen for lav, og v3 har genskabt v2's problem i ny indpakning; under
// 25 % er Hjem stille igen. Backloggens A35.
export const PUBLISH_THRESHOLD = 45;

// Svage varianter (v1.1). Tærsklen for tre regler er sænket, så de udløses oftere,
// men den svage udgave får et højere prioritetstal og kan derfor kun vises, når der
// ikke er noget bedre. Princippet: **tærsklen afgør, om historien findes;
// prioriteten afgør, om den vises.** 75 ligger under rundens vinder (70), så
// "2. sejr i træk mod Jimmy" aldrig fortrænger "du vandt runden".
export const SOFT_PRIORITY = { COMEBACK: 75, STREAK: 75, SHARP: 85 };

// Grænsen mellem højdepunkt og dæmpet tier. Bruges af frontenden (kort-stil) og af
// karriereprofilens milepæle, som kun må vise rigtige historier.
export const QUIET_TIER_MIN = 90;
export function isQuiet(priority) {
  return (priority ?? 0) >= QUIET_TIER_MIN;
}

// Tærskler (spec afsnit 3). Kalibreret på live-data juli 2026 (beslutning A4):
// comeback 3→2 pladser og 5→4 deltagere, stime 3→2 runder, præcise 3→2 — alle med
// en svag variant, jf. SOFT_PRIORITY. `*Strong` er grænsen for den stærke prioritet.
export const THRESHOLDS = {
  comebackPlaces: 2, comebackStrongPlaces: 3, comebackMinPlayers: 4,
  streakRounds: 2, streakStrongRounds: 3,
  sharpExact: 2, sharpStrongExact: 3,
  podiumMinPlayers: 6, closingInMaxGap: 3,
};

// Prioriteten for en udløst regel. Spejler `case`-udtrykkene i sql/story_engine.sql:
// `strength` er antallet, der afgør styrken (rykkede pladser / sejre i træk / præcise).
export function priorityFor(rule, strength) {
  switch (rule) {
    case "COMEBACK": return strength >= THRESHOLDS.comebackStrongPlaces ? RULES.COMEBACK : SOFT_PRIORITY.COMEBACK;
    case "STREAK": return strength >= THRESHOLDS.streakStrongRounds ? RULES.STREAK : SOFT_PRIORITY.STREAK;
    case "SHARP": return strength >= THRESHOLDS.sharpStrongExact ? RULES.SHARP : SOFT_PRIORITY.SHARP;
    default: return RULES[rule] ?? DAILY_RULES[rule] ?? null;
  }
}

// Størrelsesbidraget for én kandidat (0–30). Spejler _sd_mag + stimeleddet i
// sql/story_engine_v3.sql. `moved` er ABSOLUT: et fald er lige så meget drama
// som en fremgang — tonen ligger i teksten, ikke i scoringen.
//
// MILESTONE får bevidst nul. En milepæl er en engangsbedrift; dens vægt er, at
// den er sket, ikke hvor mange pladser man tilfældigvis rykkede samme dag.
// Uden det ville motoren og cron-kapringen score samme kort forskelligt.
export function sizeOf(cand = {}) {
  if (cand.rule === "MILESTONE") return 0;
  const over = Math.min(SIZE_CAPS.over, SIZE_RATES.over * Math.max(0, Math.floor(cand.overAvg ?? 0)));
  // DAY_RESULT får KUN afstanden til dagens gennemsnit — ikke placeringsændring
  // og ikke stime. Det er spec §5's regnestykke, og det er et krav, ikke en
  // detalje: "8 + 12 + 20 = 40 ... kommer derfor aldrig over tærsklen ved egen
  // kraft. Det er tilsigtet: dagens facit er en oplysning, ikke en historie."
  //
  // Fik den hele størrelsesloftet, kunne den nå 58 og udgive sig selv som
  // dagens historie — og så ville hele det dæmpede fald-tilbage være
  // meningsløst, for der ville aldrig være en dag under tærsklen.
  if (cand.rule === "DAY_RESULT") return over;
  const move = Math.min(SIZE_CAPS.move, SIZE_RATES.move * Math.abs(cand.moved ?? 0));
  const streak = Math.min(
    SIZE_CAPS.streak,
    SIZE_RATES.streak * Math.max(0, (cand.streak ?? 0) - SIZE_RATES.streakFrom),
  );
  return Math.min(SIZE_CAPS.total, move + over + streak);
}

// Nærheden mellem en kandidats hovedperson og én modtager (0–20).
// `rel` er relationen, SQL'en allerede har afgjort: "self" | "rival" |
// "biggest" | "other".
export function proximityOf(rel) {
  return PROXIMITY[rel] ?? PROXIMITY.other;
}

// Nyhedsværdien for hver kandidat. Kandidaterne bærer selv deres relation til
// modtageren (`rel`), fordi den kun kan afgøres af stillingen, som SQL'en har.
export function scoreDailyCandidates(candidates) {
  return (candidates || []).map((c) => ({
    ...c,
    news_value: (BASE_WEIGHTS[c.rule] ?? 0) + sizeOf(c) + proximityOf(c.rel),
  }));
}

// Dagens ENE kort. Højeste nyhedsværdi vinder.
//
// Afgørelse ved lige score (spec §4): højeste grundvægt → største konkurrence →
// laveste rule alfabetisk. De sidste led er ikke i spec'en, men er nødvendige
// for at to gen-kørsler giver SAMME kort (acceptkriterie 7) — uden dem er to
// kandidater fra samme regel i samme konkurrence uadskillelige, og databasen
// vælger frit. Rækkefølgen SKAL være den samme som `_sd_rank`'s ORDER BY i
// sql/story_engine_v3.sql.
//
// Returnerer null ved ingen kandidater. Bemærk at der IKKE filtreres på
// tærsklen her: den afgør, om vinderen udgives som historie eller erstattes af
// det dæmpede fald-tilbage, og det valg træffes i SQL'en, som har DAY_RESULT-
// kandidaten ved hånden.
export function pickDay(scored) {
  if (!scored || !scored.length) return null;
  return scored.slice().sort((a, b) =>
    (b.news_value ?? 0) - (a.news_value ?? 0) ||
    (BASE_WEIGHTS[b.rule] ?? 0) - (BASE_WEIGHTS[a.rule] ?? 0) ||
    (b.league_size ?? -1) - (a.league_size ?? -1) ||
    String(a.rule).localeCompare(String(b.rule)) ||
    String(a.competition_id ?? "").localeCompare(String(b.competition_id ?? "")) ||
    String(a.headline ?? "").localeCompare(String(b.headline ?? "")),
  )[0];
}

// Er kortet nået over tærsklen? Kun da fortjener det en ulæst-markering.
// Et badge, der lyser hver dag, er ikke et signal, det er en baggrundsfarve.
export function isNewsworthy(story) {
  if (!story) return false;
  return (story.news_value ?? 0) >= PUBLISH_THRESHOLD && !isDailyQuiet(story.priority);
}

// Udløb: et kort ældre end dette vises ikke, selvom rækken bliver stående.
// Uden det er "dagens historie" en løgn på en tirsdag efter en stille weekend.
export const DAY_CARD_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export function isFresh(story, now = Date.now()) {
  if (!story?.created_at) return false;
  const t = Date.parse(story.created_at);
  return Number.isFinite(t) && now - t < DAY_CARD_MAX_AGE_MS;
}

// Deterministisk udvælgelse: præcis én historie pr. bruger pr. runde.
// Laveste priority; ved lighed største liga (league_size); dernæst competition_id
// (garanteret unik tiebreak). Spejler latest_story-viewets ORDER BY. Returnerer
// null hvis der ingen kandidater er (= stilhed → intet kort).
export function pickStory(candidates) {
  if (!candidates || !candidates.length) return null;
  const ranked = candidates.slice().sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const as = a.league_size ?? -1, bs = b.league_size ?? -1; // null sidst (nulls last)
    if (as !== bs) return bs - as;
    return String(a.competition_id ?? "").localeCompare(String(b.competition_id ?? ""));
  });
  return ranked[0];
}

// Rendering fra payload → { headline, body }. Skabelonerne matcher SQL'ens tekster.
// {label} = rundens dato-interval (fx "21.07 – 27.07"); leveres i payload som `label`.
export function renderStory(rule, payload = {}) {
  const p = payload;
  const L = p.label || "";
  switch (rule) {
    case "MONTH_CHAMP":
      return {
        headline: `👑 Du er ${p.shared ? "delt " : ""}Månedens Champion — ${p.month}`,
        body: `${p.points} point — flest af alle i ${p.month}${p.shared ? " (delt)" : ""}.` +
          (p.gap != null && p.gap > 0 ? ` Nr. 2 var ${p.gap} point efter.` : ""),
      };
    case "AWARD_WEEK":
      return {
        headline: `🏅 Du er ${p.shared ? "delt " : ""}Ugens bedste i ${p.league}`,
        body: `${p.points} point — flest af alle i ${p.league} i runden ${L}` +
          (!p.shared ? "."
            : p.others > 1 ? ` (delt med ${p.others} andre).`
            : " (delt med 1 anden)."),
      };
    case "AWARD_MONTH":
      return {
        headline: `👑 Du er ${p.shared ? "delt " : ""}Månedens bedste i ${p.league} — ${p.month}`,
        body: `${p.points} point — flest af alle i ${p.league} i ${p.month}` +
          (!p.shared ? "."
            : p.others > 1 ? ` (delt med ${p.others} andre).`
            : " (delt med 1 anden)."),
      };
    case "LEAD_TAKEN":
      return {
        headline: `🏆 Du overtog førstepladsen i ${p.league}`,
        body: `Efter runden ${L} fører du ${p.league}. Forspring til nr. 2: ${p.gap} point.`,
      };
    case "LEAD_LOST":
      return {
        headline: `⚡ ${p.rival} vippede dig af førstepladsen i ${p.league}`,
        body: `Du førte ${p.league}, men ${p.rival} gik forbi i runden ${L}. Afstand op: ${p.gap} point.`,
      };
    case "RATING_HIGH":
      return {
        headline: `📈 Ny personlig ratingrekord: ${p.rating}`,
        body: `Din runde ${L} sendte dig forbi din hidtidige rekord på ${p.old}. Du er nu nr. ${p.rank} af ${p.total} på ranglisten.`,
      };
    case "H2H_PASS":
      return {
        headline: `🔄 Du er nu foran ${p.rival} i ${p.league}`,
        body: `Efter runden ${L} fører du jeres duel i ${p.league} med ${p.gap} point.`,
      };
    case "COMEBACK":
      return {
        headline: `🚀 Fra nr. ${p.from} til nr. ${p.to} i ${p.league}`,
        body: `Du rykkede ${p.from - p.to} pladser frem i runden ${L}. Toppen er nu ${p.gap} point væk.`,
      };
    case "STREAK":
      return {
        headline: `🔥 ${p.n}. sejr i træk mod ${p.rival} i ${p.league}`,
        body: `Du slog ${p.rival} igen i runden ${L} — ${p.mine} mod ${p.deres} point.`,
      };
    case "ROUND_WON":
      return {
        headline: `🥇 Du vandt runden ${L} i ${p.league}`,
        body: `${p.points} point — flest af alle i ${p.league}` +
          (!p.shared ? "."
            : p.others > 1 ? ` (delt med ${p.others} andre).`
            : " (delt med 1 anden)."),
      };
    case "SHARP":
      return {
        headline: `🎯 ${p.n} præcise resultater i runden`,
        body: `Du ramte ${p.n} kampe præcist i runden ${L} — ${p.points} point i alt.`,
      };
    case "PODIUM_ENTER":
      return {
        headline: `🏅 Du er inde i top 3 i ${p.league}`,
        body: `Efter runden ${L} ligger du nr. ${p.rank} af ${p.total} i ${p.league}. Toppen er ${p.gap} point væk.`,
      };
    case "CLOSING_IN":
      return {
        headline: `👀 Kun ${p.gap} point op til føringen i ${p.league}`,
        body: `Efter runden ${L} er der ${p.gap} point op til ${p.rival} i ${p.league}.`,
      };
    case "PERSONAL_BEST":
      return {
        headline: `📊 Din bedste runde hidtil: ${p.points} point`,
        body: `Runden ${L} er din stærkeste i ${p.league} — din forrige rekord var ${p.old} point.`,
      };
    // --- v2 · dagens kort (110–189). `p.day` er dagens etiket ("03.03"), lagt
    // i payload af generate_daily_stories; `p.label` er rundens interval og
    // bruges ikke her — et dagskort taler om én dag.
    // v3: DAY_RESULT er dagens dæmpede fald-tilbage og har derfor mistet sin
    // emoji — emoji er højdepunktets signal, og et facit er ikke et højdepunkt.
    // `variant: "no_tips"` er kortet til den, der slet ikke havde tips med:
    // acceptkriterie 8 forbyder udtrykkeligt at give hende et drama-kort om
    // andre, så hun får dagens omfang og en fremadrettet slutning.
    case "DAY_RESULT": {
      if (p.variant === "no_tips") {
        return {
          headline: "Ingen tips i dag",
          body: `Der blev spillet ${p.matches}${p.matches === 1 ? " kamp" : " kampe"}` +
            ` i ${p.league}, men du havde ingen tips med. Husk at tippe, inden næste kamp låser.`,
        };
      }
      // Tonereglen: placeringen nævnes KUN i den øverste halvdel af tabellen.
      // Nederst står afstanden op til toppen — aldrig "du er nr. 9 af 10".
      const moved = p.moved || 0;
      const place =
        moved > 0 ? ` Du rykkede fra nr. ${p.rank + moved} til nr. ${p.rank}.`
        : p.rank * 2 <= p.total ? ` Du ligger nr. ${p.rank} af ${p.total}.`
        : p.gap > 0 ? ` Toppen er ${p.gap} point væk.`
        : "";
      return {
        headline: `Dagens facit: ${p.points} point`,
        body: `${p.matches}${p.matches === 1 ? " kamp" : " kampe"} i ${p.league}` +
          (p.exact > 0 ? ` — ${p.exact}${p.exact === 1 ? " præcis." : " præcise."}` : ".") + place,
      };
    }
    // v3 · TREDJEPERSON. Tre regler fan-outer til modtagere, der ikke er
    // hovedpersonen (`payload.third`), fordi nærhedsleddet i scoringen kun
    // giver mening, hvis en fremmeds aften kan blive din historie. Navnet i
    // `p.subject` er altid en, modtageren deler konkurrence med — fan-outen
    // sker gennem competition_participants og kan strukturelt ikke nå andre.
    case "CONTRARIAN":
      if (p.third) {
        return {
          headline: p.draw
            ? `🧠 ${p.subject} var den eneste, der troede på uafgjort i ${p.home}–${p.away}`
            : `🧠 ${p.subject} var den eneste, der troede på ${p.team}`,
          body: `I ${p.league} tippede ${p.others}${p.others === 1 ? " anden" : " andre"} imod.` +
            ` Det endte ${p.home} ${p.score} ${p.away} — ${p.points} point til ${p.subject}.`,
        };
      }
      return {
        headline: p.draw
          ? `🧠 Du var den eneste, der troede på uafgjort i ${p.home}–${p.away}`
          : `🧠 Du var den eneste, der troede på ${p.team}`,
        body: `I ${p.league} havde ${p.others}${p.others === 1 ? " anden" : " andre"} tippet imod.` +
          ` Det endte ${p.home} ${p.score} ${p.away} — ${p.points} point til dig.`,
      };
    case "COLLECTIVE_MISS":
      return {
        headline: `🙈 Ingen ramte ${p.home}–${p.away}`,
        body: `${p.n} tippede kampen i ${p.league}. Den endte ${p.score} — og ingen havde den.`,
      };
    case "DAY_TOP": {
      const tail = !p.shared ? "."
        : p.others > 1 ? ` (delt med ${p.others} andre).`
        : " (delt med 1 anden).";
      const body = `${p.points} point — flest af alle i ${p.league} den ${p.day}${tail}`;
      return p.third
        ? { headline: `🔝 ${p.subject} fik dagens højeste i ${p.league}`, body }
        : { headline: `🔝 Du fik dagens højeste i ${p.league}`, body };
    }
    case "STREAK_STATUS":
      // Den brudte stime slutter fremadrettet — "driller, ydmyger aldrig".
      // Tredjepersons-varianten dropper den opmuntring: "en ny begynder i
      // morgen" er noget, man siger til sig selv, ikke om en anden.
      if (p.third) {
        return p.alive
          ? {
              headline: `🔥 ${p.subject} har ${p.n} kampe i træk med point`,
              body: `${p.subject} har fået point i ${p.n} kampe i træk. Stimen lever efter den ${p.day}.`,
            }
          : {
              headline: `💤 ${p.subject}s stime stoppede ved ${p.n}`,
              body: `Efter ${p.n} kampe i træk med point brød ${p.subject}s stime den ${p.day}.`,
            };
      }
      return p.alive
        ? {
            headline: `🔥 ${p.n} kampe i træk med point`,
            body: `Du har fået point i ${p.n} kampe i træk. Stimen lever efter den ${p.day}.`,
          }
        : {
            headline: `💤 Din stime stoppede ved ${p.n}`,
            body: `Efter ${p.n} kampe i træk med point brød stimen den ${p.day}. En ny begynder i morgen.`,
          };
    case "DUEL":
      return p.above
        ? {
            headline: `⚔️ Kun ${p.gap} point op til ${p.rival}`,
            body: `Efter den ${p.day} er der ${p.gap} point op til ${p.rival} i ${p.league}.`,
          }
        : {
            headline: `⚔️ ${p.rival} er ${p.gap} point efter dig`,
            body: `Du fører ${p.league} med ${p.gap} point ned til ${p.rival} efter den ${p.day}.`,
          };
    case "SO_CLOSE":
      return {
        headline: `😤 Ét mål fra ${p.n} eksakte`,
        body: `${p.n} af dine tips i ${p.league} den ${p.day} ramte målscoren på ét mål nær.`,
      };
    // --- Dæmpet tier: ingen emoji (emoji = højdepunkt), tekst altid fremadrettet.
    // Placeringen nævnes KUN i den øverste halvdel af tabellen; i den nederste står
    // afstanden op til toppen i stedet ("driller, men ydmyger aldrig").
    case "SEASON_OPENER":
      return {
        headline: `Første runde i ${p.league} er i hus`,
        body: p.rank * 2 <= p.total
          ? `${p.points} point — du starter som nr. ${p.rank} af ${p.total}.` +
            (p.gap > 0 ? ` Toppen er ${p.gap} point væk.` : "")
          : `${p.points} point i den første runde. Toppen er ${p.gap} point væk — der er lang vej endnu.`,
      };
    case "QUIET_ROUND":
      return {
        headline: `Din runde: ${p.points} point`,
        body: p.rank === 1
          ? `Du fører fortsat ${p.league} efter runden ${L}.`
          : p.rank * 2 <= p.total
            ? `Du holder nr. ${p.rank} af ${p.total} i ${p.league} — ${p.gap} point op til toppen.`
            : `${p.gap} point op til toppen i ${p.league}. Næste runde er en ny chance.`,
      };
    // v3 · Milepælen kaprer dagens slot og har derfor sin egen regel her — men
    // ikke sin egen tekst. Kataloget bor i src/lib/milestones.js, og
    // milestones-tabellen gemmer kun nøgle + payload, så en formulering kan
    // rettes uden en migrering. SQL'ens headline/body er kun et faldback for en
    // klient, der er ældre end nøglen.
    case "MILESTONE": {
      const m = renderMilestone(p.milestone_key, p.milestone_payload || {});
      return { headline: `${m.icon} ${m.title}`, body: m.body };
    }
    default:
      return { headline: "", body: "" };
  }
}

// ---------------------------------------------------------------------------
// v3 · RUNDESTORYENS FRAMES
//
// Rundens sidste dag udgiver kun rundekortet, og det er til gengæld den ene
// gang om ugen, tap-through er sit besvær værd. Frames bygges i SQL
// (build_round_frames) og gemmes i payload.frames; teksten bor KUN her.
//
// Frame 1 og 3 skal kunne stå alene som delt billede uden kontekst — det er de
// to, folk sender videre. Derfor er deres overskrifter hele sætninger.
//
// En frame, der mangler sine data (ingen ratingrække, ingen tips i runden),
// returnerer null og springes over af visningen frem for at vise tomme felter.
export function renderFrame(frame = {}) {
  const f = frame;
  switch (f.frame) {
    case "ROUND_SUM":
      return {
        eyebrow: `Din runde ${f.label || ""}`.trim(),
        headline: `${f.points ?? 0} point`,
        body: [
          f.exact > 0 ? `${f.exact}${f.exact === 1 ? " præcist resultat" : " præcise resultater"}` : null,
          f.percentile != null ? `Bedre end ${f.percentile} % af feltet` : null,
          f.rank != null && f.total != null ? `Nr. ${f.rank} af ${f.total}` : null,
        ].filter(Boolean).join(" · "),
      };
    case "BEST_WORST": {
      if (!f.best) return null;
      const line = (t) => `${t.home}–${t.away}: du tippede ${t.guess}, det endte ${t.score}`;
      return {
        eyebrow: "Kampen der afgjorde det",
        headline: `${line(f.best)} — ${f.best.points} point`,
        // Den værste nævnes uden bebrejdelse: kampen, ikke tippet, er emnet.
        body: f.worst ? `Den anden vej: ${line(f.worst)}.` : "",
      };
    }
    case "RATING": {
      if (f.rating == null) return null;
      const d = Number(f.delta ?? 0);
      const sign = d > 0 ? "+" : "";
      return {
        eyebrow: "Rating",
        headline: `${Math.round(Number(f.rating))} (${sign}${Math.round(d)})`,
        body: [
          f.rank != null ? `Nr. ${f.rank} på ranglisten` : null,
          f.moved ? (f.moved > 0 ? `${f.moved} pladser frem` : `${Math.abs(f.moved)} pladser tilbage`) : null,
        ].filter(Boolean).join(" · "),
      };
    }
    case "CHAMPION": {
      if (!f.winner) return null;
      return {
        eyebrow: "Rundens Champion",
        headline: `${f.shared ? "Delt: " : ""}${f.winner} — ${f.winner_points} point`,
        body: f.month_rank != null
          ? `I Månedsligaen ligger du nr. ${f.month_rank} af ${f.month_total} med ${f.month_points} point.`
          : "",
      };
    }
    case "MILESTONE": {
      const m = renderMilestone(f.milestone_key, f.milestone_payload || {});
      return { eyebrow: "Ny milepæl", headline: `${m.icon} ${m.title}`, body: m.body };
    }
    default:
      return null;
  }
}

// Frames, der faktisk kan vises. En rundestory med kun to brugbare frames er
// stadig en story — den har bare færre sider.
export function usableFrames(payload) {
  return (payload?.frames || [])
    .map((f) => ({ raw: f, view: renderFrame(f) }))
    .filter((x) => x.view);
}
