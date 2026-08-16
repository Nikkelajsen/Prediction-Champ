// Sektion 3: aktive brugere pr. runde — den løbende udvikling (B38).
//
// HVORFOR EN SEKTION FOR SIG. "Produktets sundhed" svarer på, hvordan det står
// til LIGE NU, i et vindue på 7/30/90 dage. Den kan ikke svare på, om det går
// op eller ned, og de to søjlerækker, den har, er ISO-uger (mandag) og ikke
// runder (tirsdag, dansk tid). Serien her er produktets egen enhed: én søjle
// pr. spillerunde, ældst til venstre. Derfor har sektionen også sin EGEN
// vælger — panelets dagsvælger ville skære midt igennem en runde.
//
// TO MÅLINGER VED SIDEN AF HINANDEN, og forskellen er hele pointen:
//   · SPILLEDE  — havde en deadline i runden og afgav mindst ét tip.
//   · KOM FORBI — havde appen åben i rundens uge.
// Den anden er den svage; gabet mellem dem er "de kigger, men spiller ikke".
// Samme skelnen som active_groups vs. groups_with_active_member.
import { useState } from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { loadAnalyticsRounds, roundActivityRows, roundActivitySummary, ROUND_WINDOWS } from "../../lib/analytics.js";

import { C, chip, font, muted } from "../../ui/theme.js";
import { StatTile, StatGroup, MiniBars } from "../../ui/components.jsx";
import { M, Section, SubHead, useSection, dayLabel, dtFmt } from "./shared.jsx";

// Rundens navn på skærmen er dens startdato — samme nøgle som Championship
// og notifikationerne bruger, så en runde kan slås op på tværs af flader.
const roundLabel = (key) => dayLabel(key);

// "1 færdig runde" mod "2 færdige runder". Et tal med en forkert bøjning
// læses som en tastefejl og trækker tvivl over selve tallet.
const roundCount = (n) => (n === 1 ? "1 færdig runde" : `${n} færdige runder`);

// Besøgstallene har tre tilstande, ikke to: et tal, et ægte nul, og UMÅLT.
// Kun den sidste må blive til "—", og `!value` ville slå et ægte nul sammen
// med den — altså gøre "ingen kom forbi" til "vi ved det ikke".
const maalt = (v) => v !== null && v !== undefined;

function RoundsSection({ token }) {
  const [rounds, setRounds] = useState(ROUND_WINDOWS[0]);
  const { data, loading, err } = useSection(() => loadAnalyticsRounds(token, rounds), token, [token, rounds]);
  const list = roundActivityRows(data);
  const sum = roundActivitySummary(list);
  const th = { textAlign: "right", color: C.muted, fontSize: 11, fontWeight: 600, padding: "0 4px 6px" };
  const td = { ...th, padding: "6px 4px", color: C.text, fontWeight: 400 };

  return (
    <Section title="Aktive brugere pr. runde"
      subtitle="Én søjle pr. spillerunde, ældst til venstre. Sektionen har sin egen vælger — panelets dagsvindue gælder den ikke."
      loading={loading} err={err}>
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {ROUND_WINDOWS.map((n) => (
              <button key={n} style={chip(rounds === n)} onClick={() => setRounds(n)}>{n} runder</button>
            ))}
          </div>

          {list.length === 0 ? (
            <p style={{ ...muted, margin: 0 }}>Ingen spillede runder endnu.</p>
          ) : (
            <>
              {/* Overskriftstallet er den seneste FÆRDIGE runde. En runde i gang
                  har delvise tal og ville altid ligne et fald. */}
              <div style={{ background: "rgba(240,180,41,0.08)", border: `1px solid ${C.gold}`, borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ color: C.muted, fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
                  Aktive i seneste færdige runde <M id="round_players" />
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontFamily: font.display, fontWeight: 700, fontSize: 34, color: C.gold, lineHeight: 1.1 }}>
                    {sum.latest ? sum.latest.players : "—"}
                  </div>
                  {sum.delta !== null && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 13, fontWeight: 600, color: sum.delta < 0 ? C.red : C.green }}>
                      {sum.delta < 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                      {sum.delta > 0 ? "+" : ""}{sum.delta}
                      <span style={{ color: C.muted, fontWeight: 400, marginLeft: 4 }}>mod forrige runde ({sum.prev.players})</span>
                      <M id="round_trend" />
                    </span>
                  )}
                </div>
                <div style={{ color: C.muted, fontSize: 12 }}>
                  {sum.latest
                    ? `Runden fra ${roundLabel(sum.latest.round_key)} · ${sum.latest.players} af ${sum.latest.exposed} med en deadline spillede${sum.latest.play_rate === null ? "" : ` (${sum.latest.play_rate} %)`}`
                    : "Ingen runde er færdig endnu — alle rundens kampe skal være låst."}
                  {sum.avg_players !== null && ` · gennemsnit ${sum.avg_players} over ${roundCount(sum.closed_rounds)}`}
                </div>
                {sum.open && (
                  <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>
                    Runden fra {roundLabel(sum.open.round_key)} er <b>i gang</b> ({sum.open.locked_count} af {sum.open.match_count} kampe låst)
                    og tæller hverken i tallet eller i retningen — den er med i serien som en stiplet søjle.
                  </div>
                )}
              </div>

              <StatGroup title={`De viste ${list.length} runder`}>
                {/* `visitors` kan være null (en uge før aktivitetssporingen
                    fandtes) — da skal feltet vise "—" og ikke et 0, der ville
                    betyde "ingen kom forbi". */}
                <StatTile label="Kom forbi, seneste færdige runde"
                  value={maalt(sum.latest?.visitors) ? sum.latest.visitors : "—"}
                  hint={sum.avg_visitors === null
                    ? "besøg er ikke målt for de viste runder"
                    : `gennemsnit ${sum.avg_visitors} over ${roundCount(sum.measured_visitor_rounds)} med målte besøg`}
                  info={<M id="round_visitors" />} />
                {/* Gabet får sit eget felt, fordi det er det tal, der let
                    forveksles med en misset deadline — og de to er ikke det
                    samme: en besøgende behøver slet ikke at have haft en. */}
                <StatTile label="Kiggede uden at spille"
                  value={maalt(sum.latest?.idle_visitors) ? sum.latest.idle_visitors : "—"}
                  hint={maalt(sum.latest?.idle_visitors)
                    ? `af de ${sum.latest.visitors}, der kom forbi i runden`
                    : "kræver et målt besøgstal"}
                  info={<M id="round_idle_visitors" />} />
                <StatTile label="Nye spillere i alt" value={sum.new_players}
                  hint="brugere med deres allerførste tip" info={<M id="round_new_players" />} />
                <StatTile label="Deltagelse, seneste færdige runde"
                  value={sum.latest && sum.latest.play_rate !== null ? `${sum.latest.play_rate} %` : "—"}
                  hint={sum.latest ? `${sum.latest.missed} med en deadline tippede intet` : undefined}
                  info={<M id="round_participation" />} />
              </StatGroup>

              <div>
                <SubHead>Spillede runden <M id="round_players" /></SubHead>
                <MiniBars
                  data={list.map((r) => ({ key: r.round_key, value: r.players, partial: r.is_open }))}
                  color={C.gold} formatLabel={roundLabel} />
              </div>
              <div>
                <SubHead>Deltagelse pr. runde <M id="round_participation" /></SubHead>
                {/* `play_rate` og ikke `play_rate ?? 0`: en runde uden én eneste
                    eksponeret bruger har ingen måling og skal gråtones, ikke
                    tegnes som 0 %. Samme regel som completion rate pr. uge. */}
                <MiniBars
                  data={list.map((r) => ({ key: r.round_key, value: r.play_rate, partial: r.is_open }))}
                  color={C.green} formatLabel={roundLabel} suffix=" %" />
              </div>
              <div>
                <SubHead>Kom forbi (var i appen) <M id="round_visitors" /></SubHead>
                {/* Den svagere måling, tegnet under de to stærke, så gabet kan
                    aflæses ved at sammenligne søjlehøjderne. `visitors` og ikke
                    `visitors ?? 0`: en uge før aktivitetssporingen fandtes er
                    UMÅLT og gråtones — et 0 ville betyde "ingen kom forbi". */}
                <MiniBars
                  data={list.map((r) => ({ key: r.round_key, value: r.visitors, partial: r.is_open }))}
                  color={C.muted} formatLabel={roundLabel} />
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: "left" }}>Runde</th>
                      <th style={th}>Spillede</th>
                      <th style={th}>Nye</th>
                      <th style={th}>Havde deadline</th>
                      <th style={th}>Deltagelse</th>
                      <th style={th}>Tips</th>
                      <th style={th}>Kom forbi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.round_key} className="rowline" style={{ opacity: r.is_open ? 0.6 : 1 }}>
                        <td style={{ padding: "6px 4px", color: C.text }}>
                          {roundLabel(r.round_key)}
                          {r.is_open && <span style={{ color: C.gold, fontSize: 10, marginLeft: 6 }}>I GANG</span>}
                        </td>
                        <td style={td}>
                          {r.players}
                          {r.delta !== null && r.delta !== 0 && (
                            <span style={{ color: r.delta < 0 ? C.red : C.green, marginLeft: 4 }}>
                              {r.delta > 0 ? "+" : ""}{r.delta}
                            </span>
                          )}
                        </td>
                        <td style={{ ...td, color: C.muted }}>{r.new_players || ""}</td>
                        <td style={{ ...td, color: C.muted }}>{r.exposed}</td>
                        <td style={{ ...td, color: C.muted }}>{r.play_rate === null ? "–" : `${r.play_rate} %`}</td>
                        <td style={{ ...td, color: C.muted }}>{r.tips}</td>
                        {/* Tom celle = UMÅLT. En 0'er her ville betyde "ingen kom
                            forbi", og det er ikke det samme som "vi målte ikke". */}
                        <td style={{ ...td, color: C.muted }} title={r.visitors === null ? "Aktivitetssporingen dækker ikke denne uge" : undefined}>
                          {r.visitors === null ? "–" : r.visitors}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p style={{ ...muted, margin: 0, fontSize: 11 }}>
                En <b>runde</b> går fra tirsdag til mandag, dansk tid (<code>round_key</code>) — den samme enhed som
                Championship kårer og notifikationerne taler om, og altså ikke den ISO-uge, completion rate bruger.
                <b> Spillede</b> = havde mindst én låst kamp i en konkurrence og afgav mindst ét tip;
                <b> kom forbi</b> = havde blot appen åben i rundens uge. Gabet mellem de to er dem, der kiggede uden at spille.
                <b> "Kom forbi" kan være større end "havde deadline"</b>, og det er ikke en fejl: en besøgende behøver hverken
                at være med i en konkurrence eller at have en låst kamp i runden. Gabet er derfor ikke det samme som en
                misset deadline — det tal står som <b>Missede runder</b> i Produktets sundhed.
                <b> Nye</b> tælles på brugerens allerførste tip nogensinde, ikke på det første i vinduet.
                {data.activity_since
                  ? ` Besøgstal findes først fra ${dtFmt(data.activity_since)}; runder før den dato viser "–" og ikke 0.`
                  : " Besøgstal er ikke målt endnu, så kolonnen står tom."}
                {data.rounds_available > list.length && ` Der findes ${data.rounds_available} spillede runder i alt.`}
              </p>
            </>
          )}
        </div>
      )}
    </Section>
  );
}

export { RoundsSection };
