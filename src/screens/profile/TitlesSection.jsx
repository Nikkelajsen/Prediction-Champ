// Karriereprofilens to titel-sektioner: de SAMLEDE titler fra Championship og
// titlerne pr. turnering (`K2`).
//
// De to følges ad i én fil, fordi adskillelsen mellem dem ER pointen: kun det
// samlede niveau bærer ordet "Champion", og de to badge-stilarter — guld og
// dæmpet — udtrykker rangordenen visuelt. Ligger de i hver sin fil, kan den ene
// stil ændre sig uden den anden, og forskellen holder op med at betyde noget.
//
// Ren flytning ud af `ProfileScreen.jsx` (G1, august 2026).
import { C, font } from "../../ui/theme.js";
import { Eyebrow, InfoDot } from "../../ui/components.jsx";

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


function TitlesSection({ hasTitles, seasonTitles, monthly, roundWins, hasTournamentTitles, byTournament }) {
  if (!hasTitles && !hasTournamentTitles) return null;
  return (
    <>
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
    </>
  );
}

export default TitlesSection;
