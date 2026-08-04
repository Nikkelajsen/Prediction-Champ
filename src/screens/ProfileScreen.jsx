// Karriereprofil v1 — brugerens karriere som fortælling (titler → milepæle →
// ratingkurve → rivaler), med rå basistal diskret nederst. Spec:
// docs/features/karriereprofil-v1.md. Drill-in-skærm (som BoardScreen).
// Karriereskærmen blander bevidst TO omfang: Titler, Rekorder og basistallene er
// globale (Championship + global rating — alle brugere er med), mens Milepælene er
// øjeblikke fra brugerens egne konkurrencer. En bruger læste derfor "8. plads" som
// en placering i én af sine egne konkurrencer.
//
// Omfanget forklares på ÉN måde: en InfoDot pr. sektion. Et mellemtrin havde
// desuden en synlig brødtekstlinje under hver overskrift, men den løsning blev
// afvist af brugeren — fem forklarende afsnit gjorde siden tungere at skimme end
// den tvivl, de skulle fjerne, var værd. Skærmen bærer derfor kun de tal, der
// navngiver deres eget omfang i selve sætningen ("i Championships rundechampionship",
// "globale rating"), og forklaringen ligger ét klik væk. Ny sektion med tal ⇒ ny
// InfoDot, ikke ny brødtekst.
//
// Skærmen er delt op 3. august 2026 (G1): de rene regler bor i profile/facts.js
// og ratingkurven i profile/Sparkline.jsx. Tilbage her står dét, en skærm er —
// hent profilen, og sæt sektionerne sammen. Flytningen er ren.
import { useState, useEffect } from "react";
import { Loader2, Share2 } from "lucide-react";
import { loadCareerProfile, loadCareerMilestones, monthName } from "../lib/data.js";
import { logEvent } from "../lib/analytics.js";
import { shareText, storyShareText } from "../lib/share.js";
import { groupMilestones } from "../lib/milestones.js";
import { C, font, iconBtn } from "../ui/theme.js";
import { BackBar, Card, Eyebrow, InfoDot, Move, PlayerName } from "../ui/components.jsx";
import { Sparkline } from "./profile/Sparkline.jsx";
import { h2hSentence, recordFacts, rivalTally } from "./profile/facts.js";

const MILESTONE_PAGE = 20;

function ProfileScreen({ token, viewerUserId, profileUserId, onBack, openProfile }) {
  const isOwn = profileUserId === viewerUserId;
  const [data, setData] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [milestoneExpanded, setMilestoneExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(""); setMilestoneExpanded(false);
      try {
        const [profile, ms] = await Promise.all([
          loadCareerProfile(token, profileUserId),
          loadCareerMilestones(token, profileUserId, isOwn),
        ]);
        if (cancelled) return;
        setData(profile); setMilestones(ms);
      } catch (e) {
        if (cancelled) return;
        const msg = String(e?.message || e).toLowerCase();
        setError(msg.includes("not found")
          ? "Profilen findes ikke længere."
          : "Kunne ikke hente profilen lige nu. Prøv igen om lidt.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, profileUserId, isOwn]);

  if (loading) {
    return (
      <div>
        <BackBar title="Karriere" onBack={onBack} />
        <div style={{ display: "flex", gap: 10, color: C.muted, alignItems: "center", paddingTop: 20 }}>
          <Loader2 className="spin" size={18} />Henter profil …
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <BackBar title="Karriere" onBack={onBack} />
        <Card><span style={{ color: C.muted, fontSize: 14, lineHeight: 1.5 }}>{error}</span></Card>
      </div>
    );
  }

  const head = data?.head || {};
  const titles = data?.titles || { monthly: [], season: [], round_wins: 0 };
  const monthly = titles.monthly || [];
  const seasonTitles = titles.season || [];
  const roundWins = titles.round_wins || 0;
  // Per-turnering-titler (K2). Grenen mangler, indtil career_profile.sql er
  // gen-kørt i produktion — en tom liste giver samme udfald som "ingen vundet",
  // altså ingen sektion, ikke en fejl.
  const byTournament = titles.by_tournament || [];
  const curve = data?.curve || [];
  const base = data?.base || { total_points: 0, exact_count: 0, outcome_count: 0, matches: 0 };
  const rivals = data?.rivals || [];
  const records = data?.records || {};
  const footprint = data?.footprint || { leagues: 0, competitions: 0 };

  const memberSince = head.created_at ? monthName(String(head.created_at).slice(0, 7)) : null;
  const hitRate = base.matches > 0 ? Math.round((base.exact_count / base.matches) * 100) : 0;

  const rec = recordFacts(records, head.rating);
  const hasRecords = rec.hasAny;

  // Milepælene grupperes i de fire familier (Konkurrence, Rating, Streaks &
  // præcision, Fællesskab) frem for at stå som én kronologisk liste. Med et
  // katalog på ~30 engangs-bedrifter er kronologien ikke længere den nyttige
  // akse: man vil se, hvad man har opnået — og hvad der mangler i den familie,
  // man er tættest på. Tomme familier udelades helt.
  const milestoneGroups = groupMilestones(milestones);
  const visibleMilestones = milestoneExpanded ? milestoneGroups : milestoneGroups.map((g) => ({
    ...g, items: g.items.slice(0, MILESTONE_PAGE), hidden: Math.max(0, g.items.length - MILESTONE_PAGE),
  }));
  const hiddenCount = visibleMilestones.reduce((n, g) => n + (g.hidden || 0), 0);

  // Milepælen deles med samme tekst som historie-kortet (`storyShareText`), så
  // en milepæl, der er delt to gange med et halvt år imellem, ser ens ud.
  // Hændelsen bærer nøglen som `rule` — det er den, A5 skal bruge for at kunne
  // se, HVILKE korttyper der bliver delt.
  async function shareMilestone(m) {
    try {
      await shareText(storyShareText(m));
      logEvent(token, "story_shared", { metadata: { rule: m.key, from: "milestone" } });
    } catch { /* bruger annullerede — ignorér */ }
  }

  const hasTitles = monthly.length > 0 || seasonTitles.length > 0 || roundWins > 0;
  const hasTournamentTitles = byTournament.length > 0;
  const hasMilestones = isOwn && milestones.length > 0;
  const hasCurve = curve.length >= 2;
  const hasH2H = !isOwn && !!data?.h2h;
  // "Karriere lige begyndt": ingen titler, ingen milepæle, rekorder, H2H og for lidt kurve.
  const isEmpty = !hasTitles && !hasTournamentTitles && !hasMilestones && !hasCurve && !hasRecords && !hasH2H;

  const badge = {
    display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(240,180,41,0.12)",
    border: `1px solid ${C.gold}`, color: C.gold, borderRadius: 999,
    padding: "6px 12px", fontSize: 13, fontWeight: 700, fontFamily: font.body,
  };
  // Per-turnering-titler bærer samme form, men uden guld: rangordenen mellem de
  // to niveauer skal kunne ses, ikke læses. Samme greb som Story Engines
  // dæmpede tier, hvor et stille kort tegnes uden guld og uden emoji-vægt.
  const subBadge = {
    ...badge, background: C.surface2, border: `1px solid ${C.line}`,
    color: C.text, fontWeight: 600, fontSize: 12, padding: "5px 10px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BackBar title="Karriere" onBack={onBack} />

      {/* Hoved */}
      <Card>
        <Eyebrow>{isOwn ? "Din karriere" : "Karriere"} <InfoDot title="Karriere">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>Din karriere <b>nulstilles aldrig</b> — den følger dig på tværs af sæsoner, ligaer og turneringer.</div>
            <div>Her samles rating over tid, titler fra Championship, dine milepæle og dine tætteste rivaler.</div>
            <div>Du kan åbne alle andres karriere ved at trykke på deres navn — hvor som helst i appen.</div>
          </div>
        </InfoDot></Eyebrow>
        <div style={{ fontFamily: font.display, textTransform: "uppercase", fontWeight: 700, fontSize: 28, lineHeight: 1.1 }}>
          {head.display_name || "—"}{isOwn ? <span style={{ color: C.muted, fontSize: 16 }}> (dig)</span> : ""}
        </div>
        {memberSince && <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Medlem siden {memberSince}</div>}
        {(footprint.leagues > 0 || footprint.competitions > 0) && (
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>
            Har spillet i {footprint.leagues} {footprint.leagues === 1 ? "liga" : "ligaer"} og{" "}
            {footprint.competitions} {footprint.competitions === 1 ? "konkurrence" : "konkurrencer"}
          </div>
        )}
        {head.rating != null && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 12 }}>
            <span style={{ color: C.muted, fontSize: 12, fontFamily: font.display, textTransform: "uppercase", letterSpacing: "0.08em" }}>Rating</span>
            <span style={{ fontFamily: font.display, fontSize: 34, fontWeight: 700 }}>
              {head.rating}
              {head.provisional && <span style={{
                marginLeft: 8, fontSize: 11, color: C.gold, border: `1px solid ${C.gold}`,
                borderRadius: 4, padding: "1px 5px", verticalAlign: "middle",
              }}>NY</span>}
            </span>
            <Move d={head.move || 0} />
          </div>
        )}
      </Card>

      {/* H2H (kun fremmed profil, delt konkurrence) */}
      {hasH2H && (
        <Card>
          <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6 }}>
            {h2hSentence(data.h2h, head.display_name)}{" "}
            <InfoDot title="Jeres indbyrdes opgør">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div>Tallene dækker <b>kun</b> kampe fra konkurrencer, I begge er med i — ikke hele Championship, og ikke alt hvad I hver især har tippet.</div>
                <div>Et <b>møde</b> er én runde. Deler I flere konkurrencer, der dækker de samme kampe, tæller runden stadig kun én gang.</div>
                <div>Kun du kan se denne linje.</div>
              </div>
            </InfoDot>
          </div>
        </Card>
      )}

      {isEmpty && (
        <Card>
          <span style={{ color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
            {isOwn
              ? "Din karriere er lige begyndt — den første runde skriver det første kapitel."
              : "Karrieren er lige begyndt — den første runde skriver det første kapitel."}
          </span>
        </Card>
      )}

      {/* Titler — globalt omfang, ligesom Rekorder nedenfor */}
      {hasTitles && (
        <div>
          <Eyebrow>Titler · Championship <InfoDot title="Titler">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>Titler kommer fra <b>Championships</b> sæson-, måneds- og rundechampionship, hvor <b>alle brugere</b> automatisk er med.</div>
              <div>De kommer altså <b>ikke</b> fra dine egne konkurrencer — dem du selv opretter og inviterer til.</div>
              <div>En titel gives kun for en <b>afsluttet</b> sæson, måned eller runde. Er to spillere helt lige, deles titlen.</div>
            </div>
          </InfoDot></Eyebrow>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {/* Sæsontitlen står FØRST: Championship har tre kåringer, og sæsonen
                er den største af dem. Den manglede helt, så en afsluttet sæson
                efterlod intet spor i karrieren. */}
            {seasonTitles.map((t) => (
              <span key={t.season_id} style={badge} title={`${t.points} point`}>
                🏆 Sæsonens Champion — {t.season_name}
              </span>
            ))}
            {monthly.map((t) => (
              <span key={t.month} style={badge} title={`${t.points} point`}>
                👑 Månedens Champion — {t.month_name}
              </span>
            ))}
            {roundWins > 0 && (
              <span style={badge} title="Runder vundet i Championships rundechampionship">
                🥇 {roundWins} {roundWins === 1 ? "rundesejr" : "rundesejre"} i rundechampionshippet
              </span>
            )}
          </div>
        </div>
      )}

      {/* Per-turnering-titler (K2) — ADSKILT fra de samlede med vilje.
          Championship kårer på to niveauer, og kun det samlede bærer ordet
          "Champion". Blandede man dem, ville et karrieretal skifte
          betydning, hver gang en turnering kom til: "Månedens Champion
          ×5" skal betyde det samme før og efter turnering #3. Derfor egen
          overskrift, egen InfoDot og dæmpede badges — de er titler, men mindre
          titler, og rangordenen skal kunne ses uden at læse noget. */}
      {hasTournamentTitles && (
        <div>
          <Eyebrow>Titler pr. turnering <InfoDot title="Titler pr. turnering">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>Championship kårer på <b>to niveauer</b>. Titlerne ovenfor er de <b>samlede</b> — på tværs af alle officielle turneringer — og kun de kaldes <b>Champion</b>.</div>
              <div>Her står sejrene i <b>én enkelt turnering</b>, hvor alle er målt på de samme kampe. De tæller som titler, men de er ikke det samme som en samlet titel.</div>
              <div>En turnering vises kun, hvis du har vundet noget i den.</div>
            </div>
          </InfoDot></Eyebrow>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {byTournament.map((t) => (
              <div key={t.league_id}>
                <div style={{ color: C.muted, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{t.league_name}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {(t.monthly || []).map((m) => (
                    <span key={m.month} style={subBadge} title={`${m.points} point`}>
                      👑 Månedens bedste — {m.month_name}
                    </span>
                  ))}
                  {t.round_wins > 0 && (
                    <span style={subBadge} title={`Runder vundet i ${t.league_name}`}>
                      🥇 {t.round_wins} {t.round_wins === 1 ? "rundesejr" : "rundesejre"}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rekorder ("bedste nogensinde") — GLOBALT omfang: Championship + global
          rating, ikke brugerens egne konkurrencer. Omfanget forklares i InfoDot'en
          og navngives i hver enkelt linje ("i Championships rundechampionship", "globale
          rating"); der står bevidst INGEN forklarende brødtekst på selve siden. */}
      {hasRecords && (
        <div>
          <Eyebrow>Rekorder · Championship <InfoDot title="Rekorder">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>Rekorderne gælder <b>Championship</b> og din <b>globale rating</b> — de to steder, hvor <b>alle brugere</b> automatisk er med. Altså <b>ikke</b> dine egne konkurrencer.</div>
              <div>Rundeplacering og stime måles i <b>Championships rundechampionship</b>, altså mod samtlige brugere med point i runden — ikke mod deltagerne i én af dine egne konkurrencer.</div>
              <div>Ratingen er den samme, du ser på <b>Rating-fanen</b> (én global rating på tværs af alle konkurrencer og turneringer).</div>
              <div><b>Milepælene</b> nedenfor er derimod konkrete øjeblikke, de fleste i en navngiven konkurrence.</div>
            </div>
          </InfoDot></Eyebrow>
          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14, color: C.text, lineHeight: 1.6 }}>
              {/* Rækkefølgen går fra det mest konkrete til det mest abstrakte:
                  én runde → placering → stime → det lange ratingtal. */}
              {rec.bestRoundPoints != null && (
                <div>Din bedste runde nogensinde: <b style={{ color: C.gold }}>{rec.bestRoundPoints} point</b>
                  {rec.bestRoundExact > 0 ? `, heraf ${rec.bestRoundExact} 🎯 præcise` : ""}
                  {rec.bestRoundRound ? <span style={{ color: C.muted }}> — runden {rec.bestRoundRound}</span> : null}.</div>
              )}
              {rec.rank != null && (
                <div>Din bedste placering i <b>Championships rundechampionship</b>:{" "}
                  <b style={{ color: C.gold }}>{rec.rank}. plads</b>
                  {rec.rankField != null ? ` af ${rec.rankField} spillere` : ""}
                  {rec.rankCount > 1 ? ` (${rec.rankCount} gange)` : ""}.</div>
              )}
              {rec.streak > 0 && (
                <div>Din længste stime af rundesejre i <b>Championships rundechampionship</b>:{" "}
                  <b style={{ color: C.gold }}>{rec.streak} runder</b> i træk.</div>
              )}
              {rec.bestRating != null && (
                <div>
                  {rec.bestRatingIsCurrent
                    ? <>Du er på din <b style={{ color: C.gold }}>højeste globale rating nogensinde</b> lige nu: {rec.bestRating}.</>
                    : <>Din højeste globale rating nogensinde: <b style={{ color: C.gold }}>{rec.bestRating}</b>
                        {rec.bestRatingRound ? <span style={{ color: C.muted }}> — sat efter runden {rec.bestRatingRound}</span> : null}.</>}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Milepæle (kun egen profil) — engangs-bedrifter, grupperet i fire
          familier. Indtil august 2026 var dette en kronologisk liste over
          story-arkivet, hvilket gjorde den til en rundelog: Story Engine gemmer
          ALLE udløste kandidater hver runde, så "Kun 3 point op til føringen"
          landede her hver uge. Milepæle har nu deres egen tabel og et katalog,
          hvor hver bedrift opnås én gang. */}
      {hasMilestones && (
        <div>
          <Eyebrow>Milepæle <InfoDot title="Milepæle">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>Milepæle er <b>bedrifter, du opnår én gang</b> — at vinde en konkurrence, at nå en ratinggrænse, at afgive 100 tips. De forsvinder aldrig igen.</div>
              <div>Det er dermed et andet omfang end <b>Rekorder</b> ovenfor, som viser dine bedste tal lige nu og godt kan blive overgået.</div>
              <div>De skrives automatisk, når du opnår dem. Er du tæt på den næste, dukker den op af sig selv.</div>
              <div>Kun du kan se dine milepæle.</div>
            </div>
          </InfoDot></Eyebrow>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {visibleMilestones.map((g) => (
              <div key={g.key}>
                <div style={{ color: C.muted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>
                  {g.label}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {g.items.map((m) => (
                    <Card key={m.id} style={{ padding: 12 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <div style={{ fontSize: 18, lineHeight: 1.2, flexShrink: 0 }} aria-hidden="true">{m.icon}</div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{m.headline}</div>
                          {m.body && <div style={{ color: C.muted, fontSize: 13, marginTop: 3, lineHeight: 1.45 }}>{m.body}</div>}
                        </div>
                        {/* Del (I5). Kortet på Hjem forsvinder, når runden er
                            forbi — og det er typisk EFTER en uge, man har lyst
                            til at vise en bedrift frem. Samme tekst og samme
                            `story_shared`-hændelse som kortet, så tallet i
                            Analytics fortsat måler "et højdepunkt blev delt". */}
                        <button type="button" onClick={() => shareMilestone(m)}
                          aria-label={`Del milepælen: ${m.headline}`}
                          style={{ ...iconBtn, flexShrink: 0, color: C.gold }}>
                          <Share2 size={15} />
                        </button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {!milestoneExpanded && hiddenCount > 0 && (
            <p style={{ color: C.muted, fontSize: 13, marginTop: 8, marginBottom: 0, cursor: "pointer", textDecoration: "underline" }}
               onClick={() => setMilestoneExpanded(true)}>
              Vis alle {milestones.length} milepæle
            </p>
          )}
        </div>
      )}

      {/* Ratingkurve */}
      {hasCurve && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, textTransform: "uppercase" }}>Ratingkurve</div>
            <span style={{ color: C.muted, fontSize: 12 }}>{curve.length} runder</span>
          </div>
          <Sparkline curve={curve} peakRoundKey={records.best_rating_round} />
          <p style={{ color: C.muted, fontSize: 11, marginTop: 8, marginBottom: 0 }}>
            Rating efter hver runde — den nyeste prik kan stadig flytte sig, indtil runden er slut. ● grå/stiplet = foreløbig periode (under 5 runder). ◎ = højeste rating nogensinde.
          </p>
        </Card>
      )}

      {/* Rivaler (kun egen profil). "Tætteste" er nu en påstand, tallene faktisk
          bakker op: rangeringen er mindst forskel mellem sejre og nederlag blandt
          rigtige møder, ikke antal historier (K3 lukket — se career_profile.sql).
          Navnet er tryk-flade som alle andre navne i appen: rivalen kommer med
          user_id, hvilket den gamle stories-optælling ikke kunne levere. */}
      {isOwn && rivals.length > 0 && (
        <div>
          <Eyebrow>Rivaler <InfoDot title="Rivaler">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>Dine rivaler er dem, du har de <b>mest jævnbyrdige</b> opgør med — mindst forskel mellem sejre og nederlag.</div>
              <div>Et <b>møde</b> er én runde, hvor I begge har tippet i en konkurrence, I deler. Deler I flere konkurrencer, tæller runden stadig kun én gang.</div>
              <div>Kun kampe fra <b>de konkurrencer, du deler med dem</b>, tælles med — runde for runde.</div>
              <div>Kun du kan se dine rivaler.</div>
            </div>
          </InfoDot></Eyebrow>
          <Card>
            <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6 }}>
              {/* Punktum efter navnet frem for tankestreg: rivalTally har selv en
                  tankestreg inde i sig, og to i samme sætning læses tungt. */}
              Din tætteste rival:{" "}
              <b style={{ color: C.gold }}>
                <PlayerName userId={rivals[0].user_id} name={rivals[0].rival} onOpenProfile={openProfile} />
              </b>. {rivalTally(rivals[0])}
              {rivals[0].stories > 0 && (
                <span style={{ color: C.muted }}>
                  {" "}{rivals[0].stories} {rivals[0].stories === 1 ? "historie" : "historier"} handler om jeres opgør.
                </span>
              )}
            </div>
            {rivals.length > 1 && (
              <div style={{ color: C.muted, fontSize: 13, marginTop: 8 }}>
                Andre rivaler:{" "}
                {rivals.slice(1).map((r, i) => (
                  <span key={r.user_id || r.rival}>
                    {i > 0 && " · "}
                    <PlayerName userId={r.user_id} name={r.rival} onOpenProfile={openProfile} />
                    {" "}({r.wins}-{r.losses} af {r.meetings})
                  </span>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Basistal (diskret, nederst) — karriere-brede: ALLE tippede kampe,
          uanset hvilken konkurrence de blev tippet i (et tip er globalt pr.
          kamp). Kortet har bevidst ingen overskrift (spec afsnit 2: tallene skal
          være sekundære), så forklaringen hænger på en InfoDot i selve rækken
          frem for på en overskrift, der ville gøre sektionen tungere. */}
      <Card style={{ padding: 12, background: "transparent", borderStyle: "dashed" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 18px", color: C.muted, fontSize: 12 }}>
          <span><b style={{ color: C.text }}>{base.total_points}</b> point</span>
          <span>🎯 <b style={{ color: C.text }}>{base.exact_count}</b> præcise</span>
          {/* De korrekte udfald (+1) blev hentet i `base` uden nogensinde at blive
              vist, så cirka halvdelen af pointene var usynlige: 14 point kunne
              ikke stemme med 4 præcise, uden at man selv regnede resten ud. */}
          <span><b style={{ color: C.text }}>{base.outcome_count}</b> korrekte udfald</span>
          {/* hitRate = exact_count / matches — altså andelen af PRÆCISE resultater.
              "Træfsikkerhed" læses som "hvor ofte havde jeg ret", hvor et korrekt
              udfald (+1) uretfærdigt talte som en fejl. */}
          <span><b style={{ color: C.text }}>{hitRate}%</b> præcise pr. kamp</span>
          <span><b style={{ color: C.text }}>{base.matches}</b> tippede kampe</span>
          {/* Tallene først, forklaringen sidst — ikonet må ikke stå foran det,
              det handler om. */}
          <InfoDot title="Basistal">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>Tallene dækker <b>hele din karriere</b> — alle kampe du har tippet, uanset hvilken konkurrence de blev tippet i. Du tipper kun én gang pr. kamp, og tippet tæller alle de steder, kampen er med.</div>
              <div><b>Point</b> er 3 for et præcist resultat og 1 for et korrekt udfald. Derfor kan pointsummen ikke regnes ud af de præcise alene — de korrekte udfald står med.</div>
              <div><b>Præcise pr. kamp</b> er andelen af dine tips, der ramte resultatet helt. Et korrekt udfald tæller ikke med her, selvom det gav point.</div>
              <div>Tallene bruger samme regnestykke som Championship-fanen, så de altid stemmer med stillingerne.</div>
            </div>
          </InfoDot>
        </div>
      </Card>
    </div>
  );
}

export default ProfileScreen;
