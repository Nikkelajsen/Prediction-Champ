// Tests for dagskortets to nye handlinger (august 2026).
//
// renderToStaticMarkup som resten af skærmtestene: effekter kører ikke, så
// kortet tegner sig uden at røre analytics eller localStorage.
//
// HVORFOR HER OG IKKE I HjemTab.test.jsx. `HjemTab` henter dagskortet i en
// effekt, og effekter kører ikke under statisk render — kortet ville altid være
// `null`, og testen ville måle ingenting. Reglerne bor på kortet, så det er
// kortet, der prøves.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DayCard from "./DayCard.jsx";

const story = (over = {}) => ({
  id: "s1",
  rule: "CONTRARIAN",
  priority: 120,
  news_value: 62,
  day_key: "2026-08-15",
  headline: "Du var den eneste, der troede på uafgjort",
  body: "Fire andre tippede imod.",
  created_at: new Date().toISOString(),
  payload: { day: "15/8" },
  ...over,
});

const render = (over = {}) =>
  renderToStaticMarkup(
    <DayCard token="tok" competitions={[]} seen={false} onSeen={() => {}}
      onDismiss={() => {}} {...over} story={over.story ?? story()} />
  );

describe("dagskortets Del og Afvis", () => {
  it("har begge knapper med navne, en skærmlæser kan bruge", () => {
    const html = render();
    expect(html).toContain('aria-label="Del"');
    expect(html).toContain('aria-label="Afvis"');
  });

  // Påmindelseskortet siger "du mangler at tippe" TIL DIG SELV. En Del-knap på
  // det ville være den eneste af sin slags uden en modtager.
  it("deler ikke påmindelseskortet", () => {
    const html = render({ story: story({ payload: { day: "15/8", variant: "no_tips" } }) });
    expect(html).not.toContain('aria-label="Del"');
    expect(html).toContain('aria-label="Afvis"');
  });

  // Afvis vises kun, når kalderen faktisk kan håndtere den. Uden greben ville
  // et kryds, der ikke gør noget, være værre end intet kryds.
  it("viser ikke Afvis uden en handler", () => {
    expect(render({ onDismiss: undefined })).not.toContain('aria-label="Afvis"');
  });

  // Del-knappen må IKKE flytte ulæst-prikkens tærskel: at et kort kan sendes
  // videre er ikke det samme som, at det er værd at afbryde for. Det dæmpede
  // kort har derfor knap, men ingen prik.
  it("giver det dæmpede kort en Del-knap uden at give det en ulæst-prik", () => {
    const html = render({ story: story({ priority: 180, rule: "DAY_RESULT" }) });
    expect(html).toContain('aria-label="Del"');
    expect(html).not.toContain('aria-label="Ulæst"');
  });
});
