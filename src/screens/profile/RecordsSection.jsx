// "Rekorder · Championship" på karriereprofilen — bedste runde, bedste
// placering, længste stime og højeste rating nogensinde.
//
// Sektionens omfang er GLOBALT (Championship + global rating) og navngives i
// hver enkelt sætning; forklaringen bor i InfoDot'en og ikke som brødtekst.
// Ren flytning ud af `ProfileScreen.jsx` (G1, august 2026).
import { C } from "../../ui/theme.js";
import { Card, Eyebrow, InfoDot } from "../../ui/components.jsx";

function RecordsSection({ hasRecords, rec }) {
  if (!hasRecords) return null;
  return (
    <>
      {/* Rekorder ("bedste nogensinde") — GLOBALT omfang: Championship + global
          rating, ikke brugerens egne konkurrencer. Omfanget forklares i InfoDot'en
          og navngives i hver enkelt linje ("i Championships rundechampionship", "globale
          rating"); der står bevidst INGEN forklarende brødtekst på selve siden. */}
      {hasRecords && (
        <div>
          <Eyebrow>Rekorder · Championship <InfoDot title="Rekorder">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>Rekorderne gælder <b>Championship</b> og din <b>globale rating</b> — de to steder, hvor <b>alle brugere</b> automatisk er med. Altså <b>ikke</b> dine egne konkurrencer.</div>
              <div>Rundeplacering og stime måles i <b>Championships rundechampionship</b>, altså mod samtlige brugere med point i runden — ikke mod deltagerne i én af dine egne konkurrencer.</div>
              <div>Ratingen er den samme, du ser på <b>Rating-fanen</b> (én global rating på tværs af alle konkurrencer og turneringer).</div>
              <div><b>Milepælene</b> nedenfor er derimod konkrete øjeblikke, de fleste i en navngiven konkurrence.</div>
            </div>
          </InfoDot></Eyebrow>
          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14, color: C.text, lineHeight: 1.6 }}>
              {/* Rækkefølgen går fra det mest konkrete til det mest abstrakte:
                  én runde → placering → stime → det lange ratingtal. */}
              {rec.bestRoundPoints != null && (
                <div>Din bedste runde nogensinde: <b style={{ color: C.gold }}>{rec.bestRoundPoints} point</b>
                  {rec.bestRoundExact > 0 ? `, heraf ${rec.bestRoundExact} 🎯 præcise` : ""}
                  {rec.bestRoundRound ? <span style={{ color: C.muted }}> — runden {rec.bestRoundRound}</span> : null}.</div>
              )}
              {rec.rank != null && (
                <div>Din bedste placering i <b>Championships rundechampionship</b>:{" "}
                  <b style={{ color: C.gold }}>{rec.rank}. plads</b>
                  {rec.rankField != null ? ` af ${rec.rankField} spillere` : ""}
                  {rec.rankCount > 1 ? ` (${rec.rankCount} gange)` : ""}.</div>
              )}
              {rec.streak > 0 && (
                <div>Din længste stime af rundesejre i <b>Championships rundechampionship</b>:{" "}
                  <b style={{ color: C.gold }}>{rec.streak} runder</b> i træk.</div>
              )}
              {rec.bestRating != null && (
                <div>
                  {rec.bestRatingIsCurrent
                    ? <>Du er på din <b style={{ color: C.gold }}>højeste globale rating nogensinde</b> lige nu: {rec.bestRating}.</>
                    : <>Din højeste globale rating nogensinde: <b style={{ color: C.gold }}>{rec.bestRating}</b>
                        {rec.bestRatingRound ? <span style={{ color: C.muted }}> — sat efter runden {rec.bestRatingRound}</span> : null}.</>}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

export default RecordsSection;
