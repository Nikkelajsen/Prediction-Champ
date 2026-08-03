import { describe, it, expect } from "vitest";
// renderToStaticMarkup frem for jsdom: projektet har bevidst intet
// komponent-testbibliotek (jf. OpsPanel.test.jsx og ui/components.test.jsx).
// Testene rammer FeedbackRow og ikke FeedbackPanel, fordi rækkerne i den
// sidste først findes efter et kald — og det er rækken, der bærer værdien.
import { renderToStaticMarkup } from "react-dom/server";
import { FeedbackRow } from "./FeedbackPanel.jsx";

const render = (row, over = {}) =>
  renderToStaticMarkup(<FeedbackRow row={row} onToggle={() => {}} busy={false} {...over} />);

const raekke = (over = {}) => ({
  id: "f1",
  user_id: "u1",
  display_name: "Anna",
  kind: "problem",
  message: "Push virker ikke på min iPhone",
  context: { version: "a1b2c3d", screen: "how", userAgent: "Mozilla/5.0 (iPhone …)" },
  created_at: "2026-08-01T10:00:00Z",
  handled_at: null,
  ...over,
});

describe("FeedbackRow", () => {
  it("viser meldingen, afsenderen og typen", () => {
    const html = render(raekke());
    expect(html).toContain("Push virker ikke");
    expect(html).toContain("Anna");
    expect(html).toContain("Noget virker ikke");
  });

  // Versionen er halvdelen af grunden til, at meldingen kan følges op. Ligger
  // den kun inde i den foldede JSON, skal panelet åbnes række for række for at
  // se, om to meldinger kommer fra samme deploy.
  it("viser version og skærm uden at man skal folde detaljerne ud", () => {
    const html = render(raekke());
    expect(html).toContain("a1b2c3d");
    expect(html).toContain("skærm: how");
  });

  // En slettet konto efterlader rækken (on delete set null i sql/feedback.sql).
  // Uden sætningen ville feltet stå tomt og ligne en fejl i visningen.
  it("siger 'Slettet konto', når afsenderen er væk", () => {
    const html = render(raekke({ user_id: null, display_name: null }));
    expect(html).toContain("Slettet konto");
  });

  // Findes brugeren, men mangler navnet, er det en ANDEN situation — og de to
  // må ikke skrives ens.
  it("skelner en navnløs bruger fra en slettet konto", () => {
    const html = render(raekke({ display_name: null }));
    expect(html).toContain("Ukendt bruger");
    expect(html).not.toContain("Slettet konto");
  });

  it("tilbyder at fortryde en markering, der allerede er sat", () => {
    const html = render(raekke({ handled_at: "2026-08-02T09:00:00Z" }));
    expect(html).toContain("Markér som ubehandlet");
    expect(html).not.toContain("Markér som behandlet");
  });

  it("tilbyder at markere en ubehandlet melding", () => {
    expect(render(raekke())).toContain("Markér som behandlet");
  });

  // En ukendt type skal kunne SES frem for at blive skjult: kommer der en
  // fjerde til i migreringen, skal panelet vise den, før nogen husker at
  // opdatere KINDS. Samme regel som summarizeOutbox i lib/ops.js.
  it("viser en ukendt type med sin egen nøgle", () => {
    expect(render(raekke({ kind: "ros" }))).toContain("ros");
  });
});
