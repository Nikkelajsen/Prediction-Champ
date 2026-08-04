// Luk min konto (B4).
//
// Kaldet går til appens EGET endpoint på Vercel og ikke til Supabase, fordi
// halvdelen af arbejdet kræver service-nøglen: e-mailen ligger i `auth.users`,
// som hverken brugeren selv eller en RPC må røre. Derfor almindelig `fetch` og
// ikke `restFetch` — samme valg som previewNotifications() i lib/ops.js.
//
// Fejl svælges ALDRIG her. Det her er den mest uigenkaldelige handling i
// appen, og en bruger, der tror, deres konto er lukket, mens den ikke er det,
// er værre stillet end en, der får en fejl at se.

// Den ene halve tilstand, serveren kan ende i: data er anonymiseret, men selve
// kontoen er stadig åben. Den skal siges præcist — brugeren skal vide, at
// deres oplysninger ER væk, og at det kun er lukningen, der mangler. Begge
// serverens trin er idempotente, så et nyt forsøg er ufarligt.
const KUN_ANONYMISERET =
  "Dine oplysninger er fjernet, men selve kontoen kunne ikke lukkes. " +
  "Prøv igen om lidt — dine data bliver ikke berørt en gang til.";

async function deleteMyAccount(token) {
  let res;
  try {
    res = await fetch("/api/delete-account", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error("Kunne ikke nå serveren. Tjek forbindelsen og prøv igen.");
  }

  const data = await res.json().catch(() => null);
  if (res.ok && data?.ok) return true;
  if (data?.kode === "kun_anonymiseret") throw new Error(KUN_ANONYMISERET);
  throw new Error(data?.error || "Kontoen kunne ikke lukkes. Prøv igen.");
}

// ---------- administratorens vej: luk en ANDEN konto ----------
//
// Samme forløb, samme halve tilstand, andet endpoint — og med en parameter,
// hvor den egne vej bevidst ingen har. Vagten sidder i databasen
// (`admin_anonymize_account`, sql/liga_admin.sql), ikke her: klienten kan kun
// spørge.
async function closeUserAccount(token, userId) {
  let res;
  try {
    res = await fetch(`/api/admin-close-account?userId=${encodeURIComponent(userId)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error("Kunne ikke nå serveren. Tjek forbindelsen og prøv igen.");
  }

  const data = await res.json().catch(() => null);
  if (res.ok && data?.ok) return true;
  if (data?.kode === "kun_anonymiseret") throw new Error(KUN_ANONYMISERET);
  throw new Error(data?.error || "Kontoen kunne ikke lukkes. Prøv igen.");
}

export { deleteMyAccount, closeUserAccount, KUN_ANONYMISERET };
