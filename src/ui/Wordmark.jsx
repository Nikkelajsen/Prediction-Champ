// Leagly-mærket: pokalen og navnet. Ét sted, fordi det stod tre gange i forvejen
// (headeren, login og onboarding) med hver sin ikonstørrelse — og fordi et logo,
// der findes i tre udgaver, får tre udgaver af næste rettelse.
import { C, font } from "./theme.js";

// Pokalen fra `public/leagly-icon-512.png`, tegnet som SVG frem for hentet som
// billede: den skal kunne stå på 19 px i en header og på 48 px i en tom tilstand
// uden at blive blød, den følger C.gold (så farven kun findes ét sted), og den
// koster ingen netværkshentning i første maling.
//
// Koordinaterne er MÅLT i ikonfilens eget 512-rum, så de kan efterprøves mod
// den: motivet fylder x 123–388, y 130–381 og er symmetrisk om x = 255,5.
// viewBox'en er strammet ind om motivet, så mærket fylder sin plads som et
// lucide-ikon gør — med 512-viewBox'en ville pokalen kun være halvt så høj som
// den tekst, den står ved siden af.
//
// "L"-et er et HUL, ikke en påmalet form. Derfor ligger det i samme path som
// skålen med `fillRule="evenodd"`, og baggrunden skinner igennem præcis som i
// filen. Males det i stedet med C.bg, holder det kun så længe mærket står på
// netop den baggrund.
function TrophyMark({ size = 19, title }) {
  return (
    <svg
      viewBox="108 108 295 295" width={size} height={size}
      role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}
      focusable="false" style={{ display: "block", flexShrink: 0 }}
    >
      <g fill={C.gold}>
        {/* Kant og skål i én form — i filen er der ingen fuge mellem dem. */}
        <path
          fillRule="evenodd"
          d="M167 130 L344 130 L344 142
             C344 180 333 215 321 236
             C308 262 289 286 256 286
             C223 286 204 262 190 236
             C178 215 167 180 167 142 Z
             M234 167 L256 167 L256 212 L286 212 L286 234 L234 234 Z"
        />
        {/* Hankene er åbne buer og tegnes derfor som streger, ikke som fyld.
            Kontrolpunkterne er FITTET mod ikonfilen, ikke skønnet: hele mærket
            rammer 97,9 % pixel-overlap med `leagly-maskable-512.png`, og resten
            er kantudjævning. Den højre er den venstre spejlet om x = 255,5
            (altså 511 − x), så de to aldrig kan komme ud af trit. */}
        <path
          fill="none" stroke={C.gold} strokeWidth="20" strokeLinecap="round"
          d="M168 148 C142 158 135 169 133 187 C130 208 150 238 183 245"
        />
        <path
          fill="none" stroke={C.gold} strokeWidth="20" strokeLinecap="round"
          d="M343 148 C369 158 376 169 378 187 C381 208 361 238 328 245"
        />
        {/* Stilk og fod. */}
        <path d="M242 286 L269 286 L266 340 L245 340 Z" />
        <path d="M225 339 L286 339 L307 382 L204 382 Z" />
      </g>
    </svg>
  );
}

// Beta-mærkatet (`A56`, 14. august 2026). Hjemmesiden har båret det ved siden af
// ordmærket på alle fem sider siden `A48` (13. august 2026), og appen bar det
// ikke — så en bruger, der kom fra sitet, mødte to forskellige løfter om, hvor
// færdigt produktet er. Det er den samme fejlklasse som navnet og
// officiel-status: to flader, der beskriver det samme produkt forskelligt.
//
// Det bor HER og ikke i de tre kaldesteder, af samme grund som mærket selv gør:
// `A48`s exit-kriterium (sitet har stået publiceret en måned uden en fundet fejl
// i copy eller flow) skal kunne udføres ét sted i appen og ét sted på sitet —
// ikke tre plus fem. Formen er sitets `.beta-tag` oversat til appens tokens:
// guld, kant i egen farve, pilleform.
//
// Størrelsen følger IKKE `size`. Mærkatet er en oplysning om produktet og ikke
// en del af logoet, så det skal se ens ud i headeren (20) og på login (16); et
// mærkat, der voksede med mærket, ville konkurrere med navnet i headeren, hvor
// pladsen i forvejen er talt (se kommentaren ved `<Wordmark size={20} />` i
// `MainApp.jsx`).
function BetaTag() {
  return (
    <span
      style={{
        fontFamily: font.display, fontWeight: 700, fontSize: 10,
        letterSpacing: "0.1em", color: C.gold,
        border: "1px solid currentColor", borderRadius: 999,
        padding: "1px 7px", lineHeight: 1.5, whiteSpace: "nowrap",
      }}
    >
      Beta
    </span>
  );
}

// Navnet er tofarvet som i logofilen: "Leag" i guld, "ly" i tekstfarven.
// Versaler og letter-spacing er dem, headeren brugte i forvejen — kun navnet og
// ikonet skifter, så resten af typografien står, som den stod.
function Wordmark({ size = 15 }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <TrophyMark size={size + 4} />
      <span
        style={{
          fontFamily: font.display, fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.1em", fontSize: size, color: C.text,
        }}
      >
        <span style={{ color: C.gold }}>Leag</span>ly
      </span>
      <BetaTag />
    </span>
  );
}

export { Wordmark, TrophyMark };
