import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../supabase.js", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), del: vi.fn() },
  restFetch: vi.fn(),
}));
import { db, restFetch } from "../supabase.js";
import { createGroup } from "./groups.js";

// Klientsiden af `G95`. Serversiden — at de to rækker faktisk skrives i ét
// statement, og at en fejl ruller begge tilbage — måles af
// `sql/tests/create_group.sql`; det kan kun en rigtig PostgreSQL svare på.
//
// Det, DENNE fil vogter, er den anden halvdel: at klienten holder op med at
// skrive de to rækker selv. Fejlen ville ikke ligne noget — to `db.insert` ved
// siden af et RPC-kald ville stadig oprette en liga, der virker — og vinduet
// ville være tilbage uden at nogen opdagede det.

beforeEach(() => {
  db.insert.mockReset();
  restFetch.mockReset();
  restFetch.mockImplementation(async (path) =>
    (path.includes("/rpc/create_group") ? { id: "g1", name: "Vennerne", invite_code: "abc12345" } : undefined));
});

const skrivninger = () => restFetch.mock.calls.map(([path]) => path);

describe("createGroup (G95)", () => {
  it("kalder create_group() med det trimmede navn og svarer med hele rækken", async () => {
    const g = await createGroup("token", "  Vennerne  ");

    const kald = restFetch.mock.calls.find(([p]) => p.includes("/rpc/create_group"));
    expect(kald, "create_group() blev ikke kaldt").toBeTruthy();
    expect(kald[1].body).toEqual({ p_name: "Vennerne" });
    expect(kald[1].token).toBe("token");
    // Hele rækken, `invite_code` inklusive: liga-siden viser koden umiddelbart
    // efter oprettelsen, og et svar uden den ville koste en ekstra rundtur.
    expect(g).toMatchObject({ id: "g1", invite_code: "abc12345" });
  });

  // DEN VIGTIGSTE PÅSTAND. Vinduet var to `db.insert` efter hinanden — to
  // PostgREST-kald, altså to transaktioner — og det er dét, der ikke må komme
  // igen. Måles negativt: klienten må ikke røre `groups` eller `group_members`.
  it("skriver hverken i groups eller group_members — det gør serveren", async () => {
    await createGroup("token", "Vennerne");

    expect(db.insert).not.toHaveBeenCalled();
    expect(skrivninger().filter((p) => /\/rest\/v1\/(groups|group_members)\b/.test(p))).toEqual([]);
    expect(skrivninger().filter((p) => p.includes("/rpc/create_group"))).toHaveLength(1);
  });

  it("logger league_created med ligaens id", async () => {
    await createGroup("token", "Vennerne");

    const hændelse = restFetch.mock.calls.find(([p]) => p.includes("/analytics_events"));
    expect(hændelse, "league_created blev ikke logget").toBeTruthy();
    expect(JSON.stringify(hændelse[1].body)).toContain("league_created");
    expect(JSON.stringify(hændelse[1].body)).toContain("g1");
  });

  // Navnet trimmes to steder, og det er med vilje: databasens check-constraint
  // (2–40 tegn) er den, der gælder, men et navn på kun mellemrum skal møde den
  // som tomt og ikke som fire tegn. `create_group()` btrim'er selv af samme
  // grund — ingen af de to må stole på den anden.
  it("sender ikke et navn af bare mellemrum videre som fire tegn", async () => {
    await createGroup("token", "    ");
    const kald = restFetch.mock.calls.find(([p]) => p.includes("/rpc/create_group"));
    expect(kald[1].body).toEqual({ p_name: "" });
  });
});
