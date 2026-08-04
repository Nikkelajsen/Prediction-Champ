// Server-side funktion (kører på Vercel, ikke i browseren).
// ADMIN LUKKER EN ANDEN BRUGERS KONTO: anonymiserer og lukker selve kontoen.
//
// Kald med: POST /api/admin-close-account?userId=<uuid>
//           Authorization: Bearer <admin-JWT>
//
// ---------------------------------------------------------------------------
// FORHOLDET TIL api/delete-account.js
//
// Den funktion er brugerens egen vej ud og har derfor INGEN parameter — id'et
// udledes af tokenet, og der findes intet felt at pege på en anden konto med.
// Denne funktion er dens spejlbillede: den HAR en parameter, og hele forskellen
// ligger derfor i, hvem der må sende den.
//
// Vagten er `public.admin_anonymize_account()` (sql/liga_admin.sql), som kaldes
// med ADMINENS EGET token. Den afviser en ikke-admin, en admin, der peger på sig
// selv, og en admin, der peger på en anden admin. Tjekket herunder er altså det
// ANDET af to — det findes for at give et ærligt 403 frem for en rå database-
// fejltekst, ikke for at være den, der beskytter noget.
//
// ---------------------------------------------------------------------------
// HVORFOR IKKE isAuthorized()
//
// `isAuthorized()` i _shared.js accepterer også den DELTE cron-hemmelighed. Den
// er bygget til jobs, der henter kampe — ikke til at lukke menneskers konti. En
// hemmelighed, der ligger i cron-job.org, må ikke kunne bruges her, så
// autorisationen står for sig selv nedenfor, som i delete-account.js.
//
// RÆKKEFØLGEN ER IKKE TIL FORHANDLING: RPC'en skal køre FØR kontoen lukkes.
// Begge trin er idempotente, så et nyt forsøg efter en halv fejl er ufarligt.
//
// Miljøvariabler: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { fetchWithTimeout } from "./_shared.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Kun POST" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    // Navnene i logs, ikke i svaret (G38): et 500-svar må ikke være gratis
    // rekognoscering for en uautentificeret kaldende.
    console.error("admin-close-account: SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY mangler");
    return res.status(500).json({ ok: false, error: "Serveren er ikke sat rigtigt op" });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, error: "Du skal være logget ind" });
  }
  const adminToken = authHeader.slice(7);

  const targetId = req.query?.userId;
  if (!targetId || !UUID.test(String(targetId))) {
    return res.status(400).json({ ok: false, error: "Ugyldigt bruger-id" });
  }

  try {
    // 1) Hvem kalder? Svaret bruges kun til at afvise tidligt og til logs —
    //    databasen laver sit eget tjek i trin 2.
    const userRes = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${adminToken}` },
    });
    if (!userRes.ok) {
      return res.status(401).json({ ok: false, error: "Din session er udløbet. Log ind igen." });
    }
    const caller = await userRes.json();
    if (!caller?.id) {
      return res.status(401).json({ ok: false, error: "Din session er udløbet. Log ind igen." });
    }

    // 2) Anonymisér med ADMINENS token, ikke med service-nøglen. Så er det
    //    stadig funktionens egen `is_admin`-vagt, der bestemmer — service-nøglen
    //    bruges aldrig til at ændre data i `public`.
    const rpcRes = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/admin_anonymize_account`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_user_id: targetId }),
    });
    if (!rpcRes.ok) {
      const tekst = await rpcRes.text();
      console.error("admin-close-account: anonymiseringen fejlede", rpcRes.status, tekst);
      // Funktionens egne afvisninger er skrevet til at blive læst af et
      // menneske ("En administrator kan ikke lukkes herfra"), så de sendes
      // videre. `forbidden` er den ene, der ikke er — den er et rent nej.
      const besked = tekst.includes("forbidden") ? "Du har ikke adgang til det her." : null;
      return res.status(besked ? 403 : 500).json({
        ok: false,
        error: besked || læsPostgrestFejl(tekst) || "Kontoen kunne ikke lukkes. Prøv igen.",
      });
    }

    // 3) Luk selve kontoen. `should_soft_delete` beholder rækken i auth.users —
    //    en HÅRD sletning ville kaskadere gennem profiles og tage tips, rating,
    //    kåringer OG brugerens ligaer med sig, altså præcis det, trin 2 lige har
    //    bevaret med vilje.
    const delRes = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/admin/users/${targetId}`, {
      method: "DELETE",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ should_soft_delete: true }),
    });
    if (!delRes.ok) {
      // Den ene halve tilstand, der kan opstå: data er anonymiseret, men
      // kontoen er stadig åben. Sig det præcist frem for en generisk fejl.
      console.error("admin-close-account: kontoen kunne ikke lukkes", delRes.status, await delRes.text());
      return res.status(500).json({ ok: false, kode: "kun_anonymiseret" });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("admin-close-account:", e);
    return res.status(500).json({ ok: false, error: "Kontoen kunne ikke lukkes. Prøv igen." });
  }
}

// PostgREST pakker en `raise exception` ind i JSON med feltet `message`. Vi vil
// have menneskesætningen ud, ikke hele konvolutten — og aldrig kaste, hvis
// svaret mod forventning ikke er JSON.
function læsPostgrestFejl(tekst) {
  try {
    const m = JSON.parse(tekst)?.message;
    return typeof m === "string" && m.length < 200 ? m : null;
  } catch { return null; }
}
