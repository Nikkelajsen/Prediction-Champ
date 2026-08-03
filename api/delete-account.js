// Server-side funktion (kører på Vercel, ikke i browseren).
// LUK MIN KONTO (B4): anonymiserer brugerens data og lukker selve kontoen.
//
// Kald med: POST /api/delete-account med `Authorization: Bearer <bruger-JWT>`.
//
// ---------------------------------------------------------------------------
// HVORFOR ET ENDPOINT OG IKKE BARE EN RPC
//
// Anonymiseringen af `public` klarer databasen selv
// (`anonymize_my_account()`, sql/account_anonymization.sql). Men e-mailen
// ligger i `auth.users`, uden for `public`, og den kan hverken en RPC eller
// brugeren selv fjerne: GoTrues egen `PUT /auth/v1/user` sender en
// bekræftelses-mail til den NYE adresse og skifter først, når linket følges —
// altså ubrugelig, når hele pointen er at komme af med adressen.
//
// Kun `service_role` mod GoTrues admin-API kan lukke kontoen, og nøglen findes
// kun her på serveren.
//
// ---------------------------------------------------------------------------
// AUTORISATIONEN ER EN ANDEN END DE TRE ANDRE ENDPOINTS
//
// `isAuthorized()` i _shared.js er bygget til cron-maskiner og admin-knapper:
// en delt hemmelighed eller et admin-login. Her er kalderen et helt almindeligt
// menneske, der handler på egne vegne. Derfor det egne, snævrere forløb
// nedenfor — og derfor er der **ingen parameter**: bruger-id'et udledes ene og
// alene af den token, kalderen sender. Body læses aldrig. Der findes altså
// intet felt, man kunne pege på en anden konto med.
//
// RÆKKEFØLGEN ER IKKE TIL FORHANDLING. RPC'en skal køre FØR kontoen lukkes,
// fordi den har brug for en levende `auth.uid()`.
//
// Miljøvariabler: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { fetchWithTimeout } from "./_shared.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Kun POST" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    // Navnene i logs, ikke i svaret (G38): et 500-svar må ikke være gratis
    // rekognoscering for en uautentificeret kaldende.
    console.error("delete-account: SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY mangler");
    return res.status(500).json({ ok: false, error: "Serveren er ikke sat rigtigt op" });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, error: "Du skal være logget ind" });
  }
  const userToken = authHeader.slice(7);

  try {
    // 1) Hvem er du? Id'et kommer HERFRA og intet andet sted.
    const userRes = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${userToken}` },
    });
    if (!userRes.ok) {
      return res.status(401).json({ ok: false, error: "Din session er udløbet. Log ind igen." });
    }
    const user = await userRes.json();
    if (!user?.id) {
      return res.status(401).json({ ok: false, error: "Din session er udløbet. Log ind igen." });
    }

    // 2) Anonymisér med BRUGERENS egen token, ikke med service-nøglen.
    //    Så er det stadig funktionens `auth.uid()`-vagt, der bestemmer hvem der
    //    ryddes — service-nøglen bruges aldrig til at ændre data i `public`.
    const rpcRes = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/anonymize_my_account`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!rpcRes.ok) {
      const tekst = await rpcRes.text();
      console.error("delete-account: anonymiseringen fejlede", rpcRes.status, tekst);
      return res.status(500).json({ ok: false, error: "Kontoen kunne ikke lukkes. Prøv igen." });
    }

    // 3) Luk selve kontoen. `should_soft_delete` beholder rækken i auth.users —
    //    en HÅRD sletning ville kaskadere gennem profiles og tage tips, rating,
    //    kåringer OG brugerens ligaer med sig, altså præcis det, trin 2 lige har
    //    bevaret med vilje.
    const delRes = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
      method: "DELETE",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ should_soft_delete: true }),
    });
    if (!delRes.ok) {
      // DEN ENE HALVE TILSTAND, der kan opstå: data er anonymiseret, men
      // kontoen er stadig åben. Sig det præcist frem for en generisk fejl —
      // brugeren skal vide, at deres data ER væk, og at det kun er lukningen,
      // der mangler. Begge trin er idempotente, så et nyt forsøg er ufarligt.
      console.error("delete-account: kontoen kunne ikke lukkes", delRes.status, await delRes.text());
      return res.status(500).json({ ok: false, kode: "kun_anonymiseret" });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("delete-account:", e);
    return res.status(500).json({ ok: false, error: "Kontoen kunne ikke lukkes. Prøv igen." });
  }
}
