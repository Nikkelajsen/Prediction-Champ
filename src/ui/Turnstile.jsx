// Turnstile-widgeten som React-komponent (B26).
//
// Komponenten er en TOM SKAL, når `VITE_TURNSTILE_SITE_KEY` ikke er sat: den
// returnerer null, henter intet script og kalder aldrig `onToken`. Auth-skærmen
// kan derfor montere den ubetinget og slipper for at kende til flaget.
//
// Kvitteringen er ENGANGS. Cloudflare udsteder en token pr. løst udfordring, og
// GoTrue bruger den op ved første kald — et mislykket login efterfulgt af et
// nyt forsøg med SAMME token afvises derfor, selv om brugeren gjorde alt
// rigtigt. Derfor `nulstil`: Auth-skærmen tæller én op efter hvert forsøg, og
// widgeten henter en frisk udfordring.
import { useEffect, useRef } from "react";
import { loadTurnstile, turnstileAktiv, turnstileSiteKey } from "../lib/turnstile.js";
import { C } from "./theme.js";

function Turnstile({ onToken, nulstil = 0, handling }) {
  const boksRef = useRef(null);
  const widgetRef = useRef(null);
  // `onToken` gemmes i en ref og ikke i afhængighedslisten. Auth-skærmen
  // sender en ny funktion ved hver render (den lukker om `setCaptchaToken`),
  // og lå den i listen, ville widgeten blive revet ned og tegnet op igen for
  // hvert tastetryk i e-mail-feltet — med en ny udfordring hver gang.
  //
  // Opdateringen sker i en effekt og ikke under render: en ref skrevet under
  // render er en sideeffekt i en funktion, der skal kunne køres to gange
  // (`react-hooks/refs`). Effekten uden afhængighedsliste kører efter hver
  // render, hvilket er præcis kontrakten "ref'en peger altid på den nyeste".
  const onTokenRef = useRef(onToken);
  useEffect(() => { onTokenRef.current = onToken; });

  useEffect(() => {
    if (!turnstileAktiv()) return;
    let stoppet = false;

    loadTurnstile()
      .then((turnstile) => {
        if (stoppet || !boksRef.current || widgetRef.current !== null) return;
        widgetRef.current = turnstile.render(boksRef.current, {
          sitekey: turnstileSiteKey(),
          // Appen er dansk og mørk. Sætter vi dem ikke, arver widgeten
          // browserens sprog og et lyst tema midt i en mørk boks.
          language: "da",
          theme: "dark",
          action: handling,
          callback: (token) => onTokenRef.current?.(token),
          // Udløber (~5 min) og fejler skal begge føre til det samme: den
          // token, skærmen tror den har, findes ikke mere. En tom streng
          // betyder "ingen kvittering" hele vejen igennem.
          "expired-callback": () => onTokenRef.current?.(""),
          "error-callback": () => onTokenRef.current?.(""),
        });
      })
      .catch(() => {
        // Scriptet kunne ikke hentes. Skærmen må IKKE låse: brugeren sender
        // uden kvittering, og GoTrue svarer med en fejl, `daAuthError`
        // oversætter. Alternativet — en knap, der aldrig bliver aktiv — ville
        // lukke login for enhver med en annonceblokering.
        onTokenRef.current?.("");
      });

    return () => {
      stoppet = true;
      if (widgetRef.current !== null) {
        window.turnstile?.remove?.(widgetRef.current);
        widgetRef.current = null;
      }
    };
  }, [handling]);

  useEffect(() => {
    // `nulstil` starter på 0 og tælles op EFTER hvert forsøg, så den første
    // kørsel her er en no-op og ikke en genstart af en widget, der lige er
    // tegnet.
    if (!nulstil || widgetRef.current === null) return;
    window.turnstile?.reset?.(widgetRef.current);
    onTokenRef.current?.("");
  }, [nulstil]);

  if (!turnstileAktiv()) return null;

  return (
    <div
      ref={boksRef}
      // `minHeight` holder pladsen, mens scriptet hentes, så knappen ikke
      // hopper nedad, i det sekund widgeten dukker op. 65 px er Cloudflares
      // egen højde for den kompakte visning.
      style={{ minHeight: 65, margin: "10px 0" }}
      aria-label="Bot-tjek"
    />
  );
}

// Teksten under widgeten, når kvitteringen mangler. Egen eksport, fordi den er
// den ene ting, der skal kunne ses på et skærmbillede — selve widgeten tegnes
// af Cloudflare og findes ikke i vores DOM.
function TurnstileVenter({ vises }) {
  if (!vises) return null;
  return (
    <p style={{ color: C.muted, fontSize: 12, margin: "0 0 8px" }}>
      Bekræfter, at du ikke er en robot …
    </p>
  );
}

export { Turnstile, TurnstileVenter };
