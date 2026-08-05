// Admin → Brugere: listen over profiler og den globale admins mulighed for at
// lukke en konto (`A29`). Ren flytning ud af `AdminScreen.jsx` (G1, august
// 2026) — men den af de fire, hvor samlingen betyder mest: lukningen er
// uigenkaldelig, og bekræftelsesmodalen er hele værnet.
import { useState, useEffect } from "react";
import { Loader2, UserX } from "lucide-react";
import { db } from "../../lib/supabase.js";
import { closeUserAccount } from "../../lib/data/account.js";
import { C, btnGhost, muted } from "../../ui/theme.js";
import { Card, Modal } from "../../ui/components.jsx";

function UsersPanel({ token }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [pending, setPending] = useState(null); // brugeren, der afventer bekræftelse
  const [busy, setBusy] = useState(false);

  async function load() {
    setErr("");
    try {
      setRows(await db.select(token, "profiles", "select=id,display_name,created_at,last_seen_at,is_admin,anonymized_at&order=created_at.desc"));
    } catch (e) { setErr(e.message || "Kunne ikke hente brugerne"); setRows([]); }
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  async function confirmClose() {
    if (!pending) return;
    setBusy(true); setErr("");
    try { await closeUserAccount(token, pending.id); setPending(null); await load(); }
    catch (e) { setPending(null); setErr(e.message || "Kontoen kunne ikke lukkes."); }
    finally { setBusy(false); }
  }

  if (!rows) return <p style={{ ...muted, display: "flex", gap: 8, alignItems: "center" }}><Loader2 size={14} className="spin" /> Henter brugere …</p>;

  const dato = (iso) => (iso ? new Date(iso).toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
  const needle = q.trim().toLowerCase();
  const list = needle ? rows.filter((r) => r.display_name.toLowerCase().includes(needle)) : rows;
  const lukkede = rows.filter((r) => r.anonymized_at).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {err && <p role="alert" style={{ color: C.red, fontSize: 13, margin: 0 }}>{err}</p>}
      <input className="field" placeholder="Søg efter navn …" value={q} onChange={(e) => setQ(e.target.value)} />
      <p style={{ ...muted, margin: 0 }}>
        {rows.length} konti, heraf {lukkede} lukket{lukkede === 1 ? "" : "e"}.
      </p>
      <Card>
        {list.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>Ingen brugere matcher søgningen.</div>}
        {list.map((u, i) => (
          <div key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 0", borderTop: i ? `1px solid ${C.line}` : "none" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: u.anonymized_at ? C.muted : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {u.display_name}
              </div>
              <div style={{ color: C.muted, fontSize: 11 }}>
                Oprettet {dato(u.created_at)} · sidst set {dato(u.last_seen_at)}
              </div>
            </div>
            {/* Tre tilstande, tre forskellige ting at sige. En administrator kan
                hverken lukkes herfra eller af sig selv — samme grænse som
                funktionens egen vagt, så knappen ikke lover noget, RLS afviser. */}
            {u.anonymized_at ? (
              <span style={{ color: C.muted, fontSize: 11, whiteSpace: "nowrap" }}>Lukket {dato(u.anonymized_at)}</span>
            ) : u.is_admin ? (
              <span style={{ color: C.gold, fontSize: 11, whiteSpace: "nowrap" }}>Admin</span>
            ) : (
              <button type="button" onClick={() => setPending(u)}
                style={{ background: "none", border: "none", padding: 0, color: C.red, fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                <UserX size={12} /> Luk konto
              </button>
            )}
          </div>
        ))}
      </Card>

      {pending && (
        <Modal title="Luk kontoen?" onClose={() => (busy ? null : setPending(null))}>
          <p style={{ margin: "0 0 4px" }}>
            <b>{pending.display_name}</b> bliver til et pseudonym og kan ikke logge ind igen.
          </p>
          {/* Præcis den samme opdeling, brugeren selv får at se i
              privatlivspolitikken — en administrator skal ikke tro, handlingen
              gør mere eller mindre end den gør. */}
          <p style={{ color: C.muted, fontSize: 13, margin: "8px 0 0" }}>
            Navn, brugslog, historie-kort og push-abonnementer fjernes. Tips, point, rating og kåringer <b>bliver</b> — de er andres stillinger regnet ud fra dem, og en sletning ville give vennernes historik huller.
          </p>
          <p style={{ color: C.muted, fontSize: 13, margin: "8px 0 0" }}>Det kan ikke fortrydes.</p>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button style={btnGhost} onClick={() => setPending(null)} disabled={busy}>Fortryd</button>
            <button style={{ ...btnGhost, borderColor: C.red, color: C.red }} onClick={confirmClose} disabled={busy}>
              {busy ? "Lukker …" : "Luk kontoen"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default UsersPanel;
