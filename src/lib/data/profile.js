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
import { db } from "../supabase.js";

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
  const rows = await db.select(token, "profiles", `id=eq.${user.id}&select=*`);
  if (rows[0]) return rows[0];

  for (const navn of navneforslag(user?.user_metadata?.display_name)) {
    try {
      const skrevet = await db.upsert(token, "profiles", [{ id: user.id, display_name: navn }], "id");
      if (skrevet[0]) return skrevet[0];
    } catch {
      // Navnet blev taget, mens mailen lå ulæst — prøv det næste forslag.
      // Alt andet end en navnekonflikt (offline, RLS) fejler også her, og
      // svaret er det samme: appen viser login-skærmen igen ved næste boot,
      // og forsøget gentages. Det er billigere end at skelne på fejltekst.
    }
  }
  return null;
}

export { navneforslag, sikrProfil };
