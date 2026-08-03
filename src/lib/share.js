// Deling ét sted.
//
// Mønstret lå håndrullet fire steder (HjemTabs historie-kort, BoardScreens og
// GroupScreens invitationer og — fra august 2026 — karriereprofilens milepæle)
// med samme try/catch og samme fallback. Det er ikke meget kode, men det er
// kode, hvor en forskel er usynlig indtil den dag, én af dem holder op med at
// virke på én browser.
//
// Funktionen SIGER, hvilken vej der blev brugt, i stedet for at vise noget
// selv: `navigator.share` åbner systemets egen deleark, som er kvitteringen i
// sig selv, mens en kopiering til udklipsholderen ikke efterlader noget spor —
// dér skal kaldstedet vise sit "Kopieret!". Uden returværdien ville helperen
// enten skulle eje den besked (og dermed layoutet) eller efterlade
// kaldsstederne i tvivl om, hvad der skete.
//
// Den fanger IKKE fejl. En bruger, der annullerer systemets deleark, giver et
// afvist promise, og det er kaldstedet, der ved, om det er værd at sige noget
// om — for alle fire er svaret nej.
async function shareText(text, { title = "Prediction Champ" } = {}) {
  if (navigator.share) {
    await navigator.share({ title, text });
    return "share";
  }
  await navigator.clipboard.writeText(text);
  return "clipboard";
}

// Teksten for et historie-kort eller en milepæl. Ét sted, fordi de to viser den
// samme række (`stories`) på hver sin skærm: kortet mens runden er ny,
// milepælen når den er blevet et minde.
function storyShareText(story) {
  return [story.headline, story.body].filter(Boolean).join("\n");
}

export { shareText, storyShareText };
