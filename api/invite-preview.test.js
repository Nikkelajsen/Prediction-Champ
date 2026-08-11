import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "./invite-preview.js";

// Link-previewet pr. invitation (I7).
//
// Funktionen har to regler, der ikke må brydes, og de er præcis dem, en
// gennemlæsning ikke kan holde fast i over tid:
//
//   1. **Koden ekkoes aldrig** — hverken i teksten, i `og:url` eller i en
//      fejlbesked. Et svar, der bar den, ville lægge invitationskoden i enhver
//      mellemliggende cache.
//   2. **Alt fejler åbent** — en manglende konfiguration, et dødt opslag eller
//      en ukendt kode giver 200 med de GENERELLE tags. En crawler prøver ikke
//      igen, så et 500 her ville være et link uden preview for altid.
//
// Dertil escapingen: et liganavn er brugerskrevet tekst, der lander i en
// attributværdi.

const ORIGINAL_FETCH = globalThis.fetch;
const KODE = "abc12345";

function svarObjekt() {
  const ud = { headers: {} };
  return {
    ud,
    setHeader(k, v) { ud.headers[k] = v; return this; },
    status(k) { ud.status = k; return this; },
    send(b) { ud.body = b; return this; },
  };
}

const req = (over = {}) => ({ method: "GET", headers: { host: "leagly.app" }, query: {}, ...over });

// Ét svar fra PostgREST-RPC'en.
function mockRpc(body, ok = true) {
  globalThis.fetch = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }));
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-nøgle";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

async function kør(over = {}) {
  const res = svarObjekt();
  await handler(req(over), res);
  return res.ud;
}

describe("previewet for en rigtig kode", () => {
  it("skriver ligaens navn og antallet af spillere", async () => {
    mockRpc({ kind: "group", name: "Vennerne", member_count: 7 });
    const ud = await kør({ query: { liga: KODE } });
    expect(ud.status).toBe(200);
    expect(ud.body).toContain('og:title" content="Kom med i ligaen &quot;Vennerne&quot; på Leagly"');
    expect(ud.body).toContain("7 spillere gætter allerede resultater");
  });

  it("bøjer ental rigtigt", async () => {
    mockRpc({ kind: "group", name: "V", member_count: 1 });
    expect((await kør({ query: { liga: KODE } })).body).toContain("1 spiller gætter allerede");
  });

  it("nævner ligaen bag en konkurrence — man meldes ind i begge (A8)", async () => {
    mockRpc({ kind: "competition", name: "EM-kuponen", group_name: "Vennerne", member_count: 3 });
    const ud = await kør({ query: { join: KODE } });
    expect(ud.body).toContain("Kom med i konkurrencen &quot;EM-kuponen&quot;");
    expect(ud.body).toContain("hører til ligaen &quot;Vennerne&quot;");
  });

  it("sender crawler-svaret uden for søgeindekset og med en cache", async () => {
    mockRpc({ kind: "group", name: "V", member_count: 2 });
    const ud = await kør({ query: { liga: KODE } });
    expect(ud.headers["X-Robots-Tag"]).toBe("noindex");
    expect(ud.headers["Cache-Control"]).toContain("s-maxage=600");
    expect(ud.headers["Content-Type"]).toContain("text/html");
  });

  // `og:image` skal være absolut — en crawler har intet dokument at gøre en
  // relativ sti relativ til. Adressen tages fra kaldet, så previewet virker på
  // både produktions- og preview-domænet.
  it("gør billedets adresse absolut ud fra værten", async () => {
    mockRpc({ kind: "group", name: "V", member_count: 2 });
    const ud = await kør({ query: { liga: KODE }, headers: { host: "leagly.app" } });
    expect(ud.body).toContain('og:image" content="https://leagly.app/og-image.png"');
  });
});

describe("koden ekkoes aldrig", () => {
  it.each([
    ["et træf", { kind: "group", name: "Vennerne", member_count: 7 }],
    ["en ukendt kode", { kind: "none" }],
  ])("hverken ved %s", async (_navn, svar) => {
    mockRpc(svar);
    const ud = await kør({ query: { liga: KODE } });
    expect(ud.body).not.toContain(KODE);
  });

  it("heller ikke i og:url, som peger på forsiden", async () => {
    mockRpc({ kind: "group", name: "V", member_count: 1 });
    expect((await kør({ query: { liga: KODE } })).body).toContain('og:url" content="https://leagly.app/"');
  });
});

describe("alt fejler åbent", () => {
  const generelt = (ud) => {
    expect(ud.status).toBe(200);
    expect(ud.body).toContain("Leagly — gæt resultater mod dine venner");
  };

  it("uden en kode i adressen", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("må ikke kaldes"); });
    generelt(await kør());
  });

  it("når koden ikke ligner en kode — uden overhovedet at slå op", async () => {
    const f = vi.fn();
    globalThis.fetch = f;
    generelt(await kør({ query: { liga: "../../etc/passwd" } }));
    expect(f).not.toHaveBeenCalled();
  });

  it("når opslaget svarer med en fejl", async () => {
    mockRpc({}, false);
    generelt(await kør({ query: { liga: KODE } }));
  });

  it("når opslaget slet ikke svarer", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("timeout"); });
    generelt(await kør({ query: { liga: KODE } }));
  });

  it("når serveren ikke er sat op", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    globalThis.fetch = vi.fn(async () => { throw new Error("må ikke kaldes"); });
    generelt(await kør({ query: { liga: KODE } }));
  });

  it("når koden er ukendt", async () => {
    mockRpc({ kind: "none" });
    generelt(await kør({ query: { liga: KODE } }));
  });
});

describe("liganavnet er brugerskrevet tekst", () => {
  // Uden escaping kunne en liga ved navn `" />` lukke vores attribut og skrive
  // sine egne tags i dokumentet.
  it("kan ikke bryde ud af en attribut", async () => {
    mockRpc({ kind: "group", name: '"><meta property="og:title" content="kapret', member_count: 1 });
    const body = (await kør({ query: { liga: KODE } })).body;
    expect(body).not.toContain('"><meta');
    expect(body).toContain("&quot;&gt;&lt;meta");
  });
});

describe("metoden", () => {
  it("afviser alt andet end GET og HEAD", async () => {
    const ud = await kør({ method: "POST" });
    expect(ud.status).toBe(405);
  });
});
