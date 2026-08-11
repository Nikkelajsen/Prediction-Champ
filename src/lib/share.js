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
async function shareText(text, { title = "Leagly" } = {}) {
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

// Teksten på en invitation — liga såvel som konkurrence (I7).
//
// HVORFOR DEN BOR HER. De to skærme skrev hver sin udgave, og de var drevet fra
// hinanden: `BoardScreen` kunne sige "Nikolaj har inviteret dig til …", mens
// `GroupScreen` skrev det upersonlige "Du er inviteret til ligaen …" — samme
// handling, to toner, og ingen kunne se forskellen uden at åbne begge filer.
// Ét sted er derfor ikke en oprydning, men selve rettelsen.
//
// `målet` er hele frasen ("ligaen \"Vennerne\"", "konkurrencen \"EM-kuponen\"")
// og ikke bare navnet: sætningen skal kunne bøjes forskelligt for de to, og en
// helper, der selv satte artiklen på, ville skulle kende forskellen.
//
// `inviterName` er afsenderens EGET navn, aflæst i det øjeblik der trykkes Del.
// Det er derfor sandt pr. konstruktion — modsat en attribution, der skulle
// udledes på modtagersiden, hvilket først bliver muligt med `B20` (én kode pr.
// liga i dag, altså ingen afsender at slå op). Mangler navnet, falder teksten
// tilbage til den upersonlige form frem for at skrive "undefined har inviteret".
function inviteShareText({ inviterName, mål, link }) {
  const intro = inviterName
    ? `${inviterName} har inviteret dig til ${mål} på Leagly ⚽`
    : `Du er inviteret til ${mål} på Leagly ⚽`;
  return `${intro}\nGæt resultater, saml point og se hvem der er bedst. Tryk her for at være med:\n${link}`;
}

// Deling som BILLEDE — rundestoryens frame 1 og 3 (Story Engine v3 §7).
//
// `draw` får et canvas og tegner rammen; helperen står for resten. To ting
// gøres bevidst forsigtigt, fordi delefunktioner fejler forskelligt på hver
// platform:
//
//   1. `canShare({files})` spørges FØR billedet tegnes. iOS Safari har
//      navigator.share, men afviser filer i nogle sammenhænge, og et afvist
//      share efter en tung canvas-tegning er både langsomt og synligt.
//   2. Alt, der ikke er filedeling, falder tilbage på `shareText`. Et billede,
//      der ikke kan sendes, må aldrig betyde, at knappen ikke gør noget.
//
// Kaster videre som shareText: en bruger, der annullerer arket, er ikke en fejl,
// og det er kaldstedet, der ved, om der skal siges noget.
async function shareImage(draw, { text = "", title = "Leagly", width = 1080, height = 1080 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx || typeof canvas.toBlob !== "function") return shareText(text, { title });

  const probe = new File([new Blob([""], { type: "image/png" })], "p.png", { type: "image/png" });
  if (!navigator.share || !navigator.canShare?.({ files: [probe] })) {
    return shareText(text, { title });
  }

  draw(ctx, width, height);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  if (!blob) return shareText(text, { title });

  await navigator.share({ title, text, files: [new File([blob], "leagly.png", { type: "image/png" })] });
  return "share";
}

export { shareText, shareImage, storyShareText, inviteShareText };
