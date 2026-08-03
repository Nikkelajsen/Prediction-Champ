// Feedback fra brugerne (B14): den ene vej fra en bruger til udvikleren.
//
// Skrivningen er IKKE fire-and-forget, modsat analytics.js. Forskellen er, hvem
// der venter: en hændelse er noget, vi vil vide, mens en melding er noget,
// brugeren vil have sagt. Fejler skrivningen, skal de have det at vide — ellers
// tror de, at beskeden er afsendt, og skriver den ikke igen.
//
// Læsningen er admin-gatet i databasen (sql/feedback.sql), ikke her.

import { restFetch } from "../supabase.js";

const KINDS = [
  { key: "problem", label: "Noget virker ikke" },
  { key: "idea", label: "Forslag" },
  { key: "other", label: "Andet" },
];

// Grænserne skal være de samme som check-constrainten i sql/feedback.sql.
// Klienten fanger dem først, så brugeren får en dansk sætning i stedet for en
// PostgREST-fejl — men constrainten er den, der gælder.
const MESSAGE_MIN = 4;
const MESSAGE_MAX = 2000;

// Det, meldingen bærer med af sig selv.
//
// Uden det er halvdelen af meldingerne ubrugelige: "knappen virker ikke" kan
// ikke følges op uden at vide hvilken skærm og hvilken version. Ingen af de
// tre felter kræver, at brugeren husker noget — og alle tre står i den tekst,
// formularen viser, FØR der sendes. Det er hele grunden til, at listen er kort
// og læselig frem for et dump: den skal kunne stå i en sætning på en telefon.
function collectContext({ screen, view } = {}) {
  return {
    version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "ukendt",
    ...(screen ? { screen } : {}),
    ...(view ? { view } : {}),
    // Browser og styresystem i rå form. Den er lang og grim, men den er også
    // det eneste, der kan afgøre "virker ikke på min iPhone" — og den er
    // netop derfor nævnt eksplicit i formularen.
    userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
  };
}

// Hvorfor `return=minimal`: tabellen har INGEN select-policy, så
// `return=representation` (som db.insert bruger) ville fejle på manglende
// læseret — selv for rækken, man lige har skrevet. Det er ikke en begrænsning
// at komme udenom: ingen skal kunne læse andres meldinger, og klienten har
// ingen brug for rækken tilbage.
async function sendFeedback(token, { kind, message, screen, view }) {
  const tekst = String(message ?? "").trim();
  if (tekst.length < MESSAGE_MIN) throw new Error("Skriv lidt mere, før du sender.");
  if (tekst.length > MESSAGE_MAX) throw new Error(`Beskeden må højst fylde ${MESSAGE_MAX} tegn.`);
  if (!KINDS.some((k) => k.key === kind)) throw new Error("Vælg hvad meldingen handler om.");

  // user_id sendes ALDRIG med: kolonnens default (auth.uid()) ejer den, og
  // RLS-policyen afviser alt andet.
  await restFetch(`/rest/v1/feedback`, {
    method: "POST",
    token,
    prefer: "return=minimal",
    body: [{ kind, message: tekst, context: collectContext({ screen, view }) }],
  });
}

const loadFeedback = (token, { onlyOpen = false } = {}) =>
  restFetch(`/rest/v1/rpc/admin_feedback`, {
    method: "POST", token, body: { only_open: onlyOpen },
  });

const setFeedbackHandled = (token, id, handled) =>
  restFetch(`/rest/v1/rpc/admin_feedback_set_handled`, {
    method: "POST", token, body: { feedback_id: id, handled },
  });

export { KINDS, MESSAGE_MIN, MESSAGE_MAX, collectContext, sendFeedback, loadFeedback, setFeedbackHandled };
