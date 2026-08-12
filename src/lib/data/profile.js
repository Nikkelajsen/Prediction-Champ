// Profilrækken, som den ser ud FØR appen har en profil at vise (B26).
//
// Indtil e-mailbekræftelse blev muligt, var oprettelsen ét sammenhængende
// skridt: `signUp` svarede med en session, og App.jsx skrev straks `profiles`
// med det brugernavn, personen lige havde valgt. Med bekræftelse slået til
// falder de to skridt fra hinanden — signup svarer UDEN session, og der findes
// derfor hverken token eller tidspunkt til at skrive rækken.
//
// Det er ikke en kosmetisk mangel. En bruger uden profilrække er navnløs i hver
// eneste stilling (`nameById` i data/standings.js slår op på `profiles`), og
// appen har ingen skærm, hvor et brugernavn kan vælges bagefter — kontoen ville
// være en blindgyde. Derfor gemmes ønsket som brugermetadata ved signup, og
// rækken skrives her ved første login, der faktisk har en token.
import { db, auth, restFetch } from "../supabase.js";

// ---------- to opslag, der ikke længere kan være tabelopslag (A43) ----------
//
// `authenticated` må siden `#60` læse NØJAGTIG tre kolonner i `profiles`:
// `id`, `display_name` og `anonymized_at`. Det er de tre, produktet publicerer
// i hver stilling; resten (`is_admin`, `last_seen_at`, `created_at`,
// `display_name_changed_at`) fulgte indtil da med i ethvert REST-kald, selvom
// ingen skærm viser dem om ANDRE.
//
// To skærme viser dem alligevel — om sig selv og om alle — og de går derfor
// gennem hver sin `security definer`-funktion i stedet:
//
//   · `hentEgenProfil()`   → hele ens EGEN række. `MainApp.jsx` afgør
//     admin-fanen på `profile.is_admin`, så et smalt `select=` ville slukke
//     fanen for administratoren selv. Ens egen `is_admin` er ikke det, rækken
//     beskytter — det er andres.
//   · `hentAlleProfiler()` → Admin → Brugere. Vagten er `is_admin` i databasen
//     (`admin_profiles()`, sql/read_scope_functions.sql), ikke her: klienten
//     kan kun spørge. Sorteringen ligger også dér, fordi `order=created_at`
//     efter `#60` er et `42501` — ORDER BY kræver læse-privilegiet.
async function hentEgenProfil(token) {
  return restFetch(`/rest/v1/rpc/my_profile`, { method: "POST", token, body: {} });
}

async function hentAlleProfiler(token) {
  return restFetch(`/rest/v1/rpc/admin_profiles`, { method: "POST", token, body: {} });
}

// Databasen håndhæver 2–20 tegn (`profiles_display_name_len`) og unikhed på
// små bogstaver (`profiles_display_name_lower_idx`). Begge dele gælder også
// den række, der skrives her — se sql/username_constraints.sql.
const NAVN_MAX = 20;

// Navnet var ledigt, da mailen blev sendt. Ligger den ulæst et døgn, kan en
// anden nå at tage det, og så afviser unique-indekset skrivningen.
//
// Alternativet til et suffiks ville være at afvise login og bede om et nyt navn
// — altså en skærm, der ikke findes, på det værst tænkelige tidspunkt. Et navn
// med et 2-tal er til at leve med; en konto, der ikke kan bruges, er ikke.
// Forslagene er afkortet, så suffikset ikke skubber navnet over de 20 tegn.
function navneforslag(ønsket, antal = 5) {
  const rent = String(ønsket || "").trim().slice(0, NAVN_MAX);
  if (!rent) return [];
  const liste = [rent];
  for (let n = 2; n <= antal; n++) {
    const hale = String(n);
    liste.push(`${rent.slice(0, NAVN_MAX - hale.length)}${hale}`);
  }
  return liste;
}

// Hent brugerens profil — og skriv den først, hvis den mangler og brugeren bad
// om et navn ved oprettelsen. Returnerer rækken eller null.
//
// Rækkefølgen er "læs, og skriv kun hvis der intet er": et almindeligt login
// må ikke kunne overskrive et navn, og metadataen fra oprettelsen bliver
// liggende på auth-brugeren for evigt.
async function sikrProfil(token, user) {
  const egen = await hentEgenProfil(token);
  if (egen) return egen;

  for (const navn of navneforslag(user?.user_metadata?.display_name)) {
    try {
      // `select=id` og ikke hele rækken: `return=representation` er en
      // `returning`-klausul, og den kræver læse-privilegiet på hver kolonne,
      // den giver tilbage (A43). Rækken hentes bagefter gennem funktionen, som
      // er den eneste vej til `is_admin`.
      const skrevet = await db.upsert(token, "profiles", [{ id: user.id, display_name: navn }], "id", "id");
      if (skrevet[0]) return await hentEgenProfil(token);
    } catch {
      // Navnet blev taget, mens mailen lå ulæst — prøv det næste forslag.
      // Alt andet end en navnekonflikt (offline, RLS) fejler også her, og
      // svaret er det samme: appen viser login-skærmen igen ved næste boot,
      // og forsøget gentages. Det er billigere end at skelne på fejltekst.
    }
  }
  return null;
}

// Skift af brugernavn (B29).
//
// Indtil nu blev `display_name` skrevet én gang — ved oprettelsen eller af
// `sikrProfil()` ovenfor — og aldrig rørt igen. Manglen har været der hele
// tiden og blev SYNLIG med `B26`: skrives profilrækken først ved første login
// efter en bekræftelse, kan navnet være taget imens, og `sikrProfil()` vælger da
// `Anna2` frem for at efterlade kontoen navnløs. Det valg er bevidst — en konto,
// der kan bruges, slår et pænt navn — men prisen er, at der SKAL findes en vej
// tilbage til det navn, man ville have haft.
//
// Rækkefølgen er "spørg, skriv, oversæt", og hvert led har en grund:
//
//   1. Længden tjekkes her, fordi databasens svar på et for kort navn er
//      `23514` og en engelsk constraint-tekst. Brugeren skal have at vide, hvad
//      der er galt, uden et rundturskald.
//   2. `username_available()` er det samme opslag, oprettelsen bruger, og giver
//      den venlige besked FØR skrivningen. Den er en høflighed og ikke en
//      garanti: mellem opslag og skrivning kan navnet nås af en anden.
//   3. Derfor oversættes 409 alligevel. Unikhedsindekset er den egentlige
//      garanti, og det er dét, der skal kunne ses af brugeren.
//
// Skrivningen sender KUN `display_name`. Det er ikke en tilfældighed: siden
// `sql/username_change.sql` har `authenticated` udelukkende UPDATE på `id` og
// `display_name`, og en PATCH med et felt mere ville blive afvist af
// databasen — hvilket er hele meningen med den rettighed.
//
// **Og svaret beder kun om de to samme kolonner** (A43). `db.update` sender
// `return=representation`, altså en `returning`-klausul, og den kræver
// LÆSE-privilegiet på hver kolonne, den giver tilbage — som siden `#60` er de
// tre, `authenticated` har. Uden `select=` ville et navneskift fejle med
// `permission denied for table profiles`, selvom skrivningen var lovlig.
//
// Følgen er, at funktionen svarer med en DELVIS række og ikke med hele
// profilen. Det er `App.jsx`, der skal kende den forskel: den fletter svaret
// ind i den profil, den allerede har, frem for at erstatte den — ellers ville
// en administrator, der skifter navn, miste sin admin-fane, til appen blev
// genstartet.
async function changeDisplayName(token, userId, ønsket) {
  const navn = String(ønsket || "").trim();
  if (navn.length < 2 || navn.length > NAVN_MAX) {
    throw new Error(`Brugernavnet skal være 2–${NAVN_MAX} tegn`);
  }

  if (!(await auth.checkUsername(navn))) {
    throw new Error("Brugernavnet er allerede taget. Vælg et andet.");
  }

  try {
    const rows = await db.update(token, "profiles", `id=eq.${userId}&select=id,display_name`, { display_name: navn });
    // Nul rækker tilbage betyder, at RLS ikke fandt rækken at skrive — ikke at
    // skrivningen lykkedes tomt. Uden dette led ville en fejl i policyen se ud
    // som en succes, og navnet ville "skifte" i brugerfladen og ikke i basen.
    if (!rows[0]) throw new Error("Kunne ikke skifte brugernavn. Prøv igen.");
    return rows[0];
  } catch (e) {
    const tekst = String(e?.message ?? e);
    if (/duplicate key|23505/i.test(tekst)) {
      throw new Error("Brugernavnet blev taget af en anden. Vælg et andet.", { cause: e });
    }
    if (/23514|display_name_len/i.test(tekst)) {
      throw new Error(`Brugernavnet skal være 2–${NAVN_MAX} tegn`, { cause: e });
    }
    throw e;
  }
}

export { navneforslag, sikrProfil, changeDisplayName, hentEgenProfil, hentAlleProfiler };
