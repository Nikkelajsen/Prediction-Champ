import { describe, it, expect } from "vitest";
// renderToStaticMarkup frem for jsdom: aflæsningen er ren markup over
// summarizeOutbox, og projektet har bevidst intet komponent-testbibliotek
// (jf. ui/components.test.jsx og GetStartedCard.test.jsx).
//
// Testene rammer OutboxPreview og ikke PreviewCard, fordi resultatet i den
// sidste først findes efter et klik. Det er også grunden til, at de to er
// skilt ad: knappen er tilstand, aflæsningen er tekst — og det er teksten,
// der bærer værdien.
import { renderToStaticMarkup } from "react-dom/server";
import { OutboxPreview } from "./OpsPanel.jsx";

const render = (res) => renderToStaticMarkup(<OutboxPreview res={res} />);

const TOM = { note: "Intet er sendt eller logget — dette er kun en forhåndsvisning.", wouldSend: [] };

const besked = (key, userId, over = {}) => ({
  key,
  userId,
  title: "Runden er slut ⚽",
  body: "Runden 28.07 – 03.08: du fik 1 point og blev nr. 2 af 18.",
  ...over,
});

describe("OutboxPreview", () => {
  // Kernen. En tom liste betyder "intet NYT", fordi wouldSend er filtreret mod
  // notification_log — en allerede sendt besked er usynlig her. Uden
  // forbeholdet læses tomheden som "der er intet at sende", og det er en anden
  // påstand. Forsvinder denne sætning, er kortet aktivt vildledende.
  it("tager forbehold for dedup'en, når der intet venter", () => {
    const html = render(TOM);
    expect(html).toContain("Ingen beskeder venter");
    expect(html).toContain("notification_log");
    expect(html).toContain("intet nyt");
  });

  it("gengiver endpointets egen note frem for at skrive sin egen", () => {
    const html = render({ ...TOM, note: "Bemærk: klokken er uden for sendevinduet (8–22 dansk tid)." });
    expect(html).toContain("uden for sendevinduet");
  });

  it("viser beskeden som den lyder, med type og antal modtagere", () => {
    const html = render({
      note: "n",
      wouldSend: [besked("result:2026-07-28", "u1"), besked("result:2026-07-28", "u2")],
    });
    expect(html).toContain("Runde-resultat");
    expect(html).toContain("2 modtagere");
    expect(html).toContain("nr. 2 af 18");
    expect(html).toContain("result:2026-07-28");
    expect(html).not.toContain("Ingen beskeder venter");
  });

  it("bøjer modtager i ental ved én", () => {
    const html = render({ note: "n", wouldSend: [besked("newcomp:abc", "u1", { title: "Ny konkurrence i Test 🎯" })] });
    expect(html).toContain("1 modtager<");
    expect(html).toContain("Ny konkurrence");
  });
});
