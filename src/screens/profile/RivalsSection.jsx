// "Rivaler" på karriereprofilen — de mest jævnbyrdige opgør, rangeret på
// forskellen mellem sejre og nederlag (`K3`).
//
// Ren flytning ud af `ProfileScreen.jsx` (G1, august 2026).
import { C } from "../../ui/theme.js";
import { Card, Eyebrow, InfoDot, PlayerName } from "../../ui/components.jsx";
import { rivalTally } from "./facts.js";

function RivalsSection({ isOwn, rivals, openProfile }) {
  if (!isOwn || !rivals.length) return null;
  return (
    <>
      {/* Rivaler (kun egen profil). "Tætteste" er nu en påstand, tallene faktisk
          bakker op: rangeringen er mindst forskel mellem sejre og nederlag blandt
          rigtige møder, ikke antal historier (K3 lukket — se career_profile.sql).
          Navnet er tryk-flade som alle andre navne i appen: rivalen kommer med
          user_id, hvilket den gamle stories-optælling ikke kunne levere. */}
      {isOwn && rivals.length > 0 && (
        <div>
          <Eyebrow>Rivaler <InfoDot title="Rivaler">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>Dine rivaler er dem, du har de <b>mest jævnbyrdige</b> opgør med — mindst forskel mellem sejre og nederlag.</div>
              <div>Et <b>møde</b> er én runde, hvor I begge har tippet i en konkurrence, I deler. Deler I flere konkurrencer, tæller runden stadig kun én gang.</div>
              <div>Kun kampe fra <b>de konkurrencer, du deler med dem</b>, tælles med — runde for runde.</div>
              <div>Kun du kan se dine rivaler.</div>
            </div>
          </InfoDot></Eyebrow>
          <Card>
            <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6 }}>
              {/* Punktum efter navnet frem for tankestreg: rivalTally har selv en
                  tankestreg inde i sig, og to i samme sætning læses tungt. */}
              Din tætteste rival:{" "}
              <b style={{ color: C.gold }}>
                <PlayerName userId={rivals[0].user_id} name={rivals[0].rival} onOpenProfile={openProfile} />
              </b>. {rivalTally(rivals[0])}
              {rivals[0].stories > 0 && (
                <span style={{ color: C.muted }}>
                  {" "}{rivals[0].stories} {rivals[0].stories === 1 ? "historie" : "historier"} handler om jeres opgør.
                </span>
              )}
            </div>
            {rivals.length > 1 && (
              <div style={{ color: C.muted, fontSize: 13, marginTop: 8 }}>
                Andre rivaler:{" "}
                {rivals.slice(1).map((r, i) => (
                  <span key={r.user_id || r.rival}>
                    {i > 0 && " · "}
                    <PlayerName userId={r.user_id} name={r.rival} onOpenProfile={openProfile} />
                    {" "}({r.wins}-{r.losses} af {r.meetings})
                  </span>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

export default RivalsSection;
