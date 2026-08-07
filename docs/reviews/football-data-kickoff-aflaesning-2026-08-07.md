# Aflæsning: hvad sender football-data.org, når klokkeslættet ikke er fastsat?

**7. august 2026. Svar på `G81`.** Fire af fem turneringer aflæst direkte mod
`api.football-data.org/v4` med `FOOTBALLDATA_TOKEN`, uden om appen. Rå
tekstudtræk af `utcDate` (ikke `ConvertFrom-Json`, som ville have vist tiderne i
lokal tid og gjort `T00:00:00Z` til `02:00`).

Kampantallene stemmer med turneringernes størrelse — 380 = 20 hold × 38 runder,
306 = 18 × 34 — så udtrækket har fanget hele terminslisten hver gang.

---

## Svaret i én sætning

**Midnats-pladsholderen findes, men kun i Bundesliga.** De tre andre aflæste
turneringer sender et opdigtet klokkeslæt for hver eneste kamp uden fastsat tid,
og `status` står `SCHEDULED` for alle 380 kampe i hver af dem — også for dem med
rigtige tider. Der er intet felt i svaret, der skiller de to slags ad.

| Turnering | Kampe | `status`-markør | Midnat | Kan `kickoff_tbd` sættes? |
|---|---|---|---|---|
| Bundesliga (`BL1`) | 306 | Ja — `TIMED` vs. `SCHEDULED` | Ja | **Ja**, koden virker |
| Premier League (`PL`) | 380 | Nej — alt `SCHEDULED` | Nej, 0 kampe | **Nej** |
| Primera División (`PD`) | 380 | Nej — alt `SCHEDULED` | Nej, 0 kampe | **Nej** |
| Serie A (`SA`) | 380 | Nej — alt `SCHEDULED` | Nej, 0 kampe | **Nej** |
| Champions League (`CL`) | — | **ikke aflæst** | — | ukendt |

`CL` er ikke aflæst, fordi leverandøren pr. 1. august 2026 endnu ikke havde
oprettet sæsonen 2026 (`B8` — deres aktuelle var 2025, ligafasen er ikke
lodtrukket). Aflæsningen skal gentages, når terminslisten findes.

---

## Bundesliga — begge markører, rene

`TIMED` for hver kamp med et rigtigt klokkeslæt, `SCHEDULED` + `00:00` for
resten. De to markører er indbyrdes konsistente: der findes ikke én kamp med
midnat og `TIMED`, eller med rigtig tid og `SCHEDULED`.

| Måned | Klokkeslæt (UTC) | Antal | `status` |
|---|---|---|---|
| 2026-08 | 13:30 / 15:30 / 16:30 / 18:30 | 6 / 1 / 1 / 1 | `TIMED` |
| 2026-09 | 13:30 / 15:30 / 16:30 / 17:30 / 18:30 | 17 / 3 / 3 / 1 / 3 | `TIMED` |
| 2026-10 til 2027-05 | 00:00 | 36 / 27 / 27 / 45 / 36 / 36 / 36 / 18 | `SCHEDULED` |
| 2027-05 | 13:30 | 9 | `TIMED` |

**Den sidste række er vigtig og var ved at koste os en fejlslutning.** Ni kampe
i maj 2027 på samme klokkeslæt er Bundesligaens sidste spillerunde, hvor alle
kampe spilles samtidig — og de er `TIMED`, altså ægte. En overvejet heuristik
("en runde, hvor alle kampe deler ét klokkeslæt, er en pladsholder") ville have
markeret hver eneste Bundesliga-sæsonafslutning som "tid ikke fastlagt". Den
blev forkastet på netop denne linje.

---

## Primera División — ingen markør

380 kampe, alle `SCHEDULED`, nul med midnat.

| Måned | Klokkeslæt (UTC) | Antal |
|---|---|---|
| 2026-08 | 15:00 / 17:00 / 17:30 / 19:00 / 19:30 | 5 / 3 / 6 / 7 / 9 |
| 2026-09 | 15:00 | 40 |
| 2026-10 | 15:00 / 16:00 | 20 / 10 |
| 2026-11 | 16:00 | 40 |
| 2026-12 | 16:00 | 30 |
| 2027-01 til 2027-05 | 12:00 | 50 / 40 / 30 / 40 / 50 |

Kun august har spredte, indbyrdes forskellige tider. Fra september og frem har
hver måned præcis én værdi.

---

## Serie A — ingen markør

380 kampe, alle `SCHEDULED`, nul med midnat.

| Måned | Klokkeslæt (UTC) | Antal |
|---|---|---|
| 2026-08 | 16:30 / 18:45 | 10 / 10 |
| 2026-09 | 10:30 / 13:00 / 16:00 / 18:45 | 2 / 10 / 7 / 11 |
| 2026-10 | 16:30 / 17:30 | 20 / 20 |
| 2026-11 | 17:30 | 40 |
| 2026-12 | 17:30 | 30 |
| 2027-01 til 2027-05 | 12:00 | 60 / 40 / 30 / 40 / 50 |

---

## Premier League — ingen markør

380 kampe, alle `SCHEDULED`, nul med midnat.

| Måned | Klokkeslæt (UTC) | Antal |
|---|---|---|
| 2026-08 | 11:30 / 13:00 / 14:00 / 15:30 / 16:30 / 19:00 | 2 / 5 / 5 / 2 / 2 / 4 |
| 2026-09 | 11:30 / 13:00 / 14:00 / 15:30 / 16:30 / 19:00 | 2 / 3 / 15 / 3 / 3 / 4 |
| 2026-10 | 14:00 / 15:00 | 30 / 10 |
| 2026-11 | 15:00 | 30 |
| 2026-12 | 15:00 / 20:00 | 40 / 20 |
| 2027-01 til 2027-05 | 12:00 | 50 / 40 / 30 / 30 / 50 |

December har to værdier. Om det er juledagene, som lægges tidligt af
tv-hensyn, er **ikke aflæst** — det er et gæt og skal efterprøves, før det
bruges til noget.

---

## Pladsholderen er lokal om efteråret og UTC-fast om foråret

Oktober-splittet i alle tre turneringer falder på sommertidsskiftet, og de to
UTC-værdier er **samme lokale klokkeslæt**:

| Turnering | UTC før / efter | Lokalt |
|---|---|---|
| Primera División | 15:00 / 16:00 | 17:00 i Madrid |
| Serie A | 16:30 / 17:30 | 18:30 i Rom |
| Premier League | 14:00 / 15:00 | 15:00 i London |

Efterårspladsholderen er altså turneringens eget typiske anspilstidspunkt,
udtrykt lokalt. Fra januar skifter alle tre til 12:00 UTC — samme UTC-værdi på
tværs af tre tidszoner, altså tre forskellige lokale klokkeslæt.

**Hvorfor de to regimer er forskellige, er ikke aflæst.** En nærliggende
læsning er, at efteråret bærer turneringernes egne foreløbige rundetider, mens
12:00 er leverandørens standardværdi, når der slet intet er. Den læsning er
ikke efterprøvet og må ikke bruges som grundlag for kode — det var præcis den
slags dokumentationslæsning, der fejlede 2. august.

---

## Fire formodninger prøvet af, ingen overlevede

Værdien af aflæsningen er lige så meget, hvad der ikke skal bygges:

1. **`status` som markør.** Afkræftet allerede 6. august på én runde, nu
   bekræftet på tre hele terminslister: `SCHEDULED` dækker både fastsatte og
   ikke-fastsatte tider hos PD, SA og PL.
2. **Midnat som universel markør.** Nul forekomster i 1.140 kampe fordelt på
   tre turneringer. Sand kun for BL1.
3. **Formen på en runde** (alle kampe samme klokkeslæt ⇒ pladsholder). Falder
   på Bundesligaens sidste spillerunde, som er ægte.
4. **`lastUpdated` pr. kamp.** Alle 306 BL1-kampe bærer `2026-08-07` — datoen
   for aflæsningen selv. Feltet er stemplet ved import og siger intet om, hvornår
   en tid blev fastsat. Prøvet på både måneds- og dagsopløsning.

Formodning 3 og 4 blev forkastet, før de blev skrevet. Det er hele grunden til,
at aflæsningen kom før designet.

---

## Det, der er tilbage at vælge imellem

Ingen af de to er besluttet her — det hører til i `G85`.

**A. Genkend pladsholderværdierne.** Kræver en tabel over hver turnerings
efterårs- og forårspladsholder og en beslutning om, hvad der sker, når
leverandøren ændrer dem. Det er kalibrerede tal uden data at kalibrere på —
samme indvending som `A35`.

**B. Sammenlign med den forrige synkronisering.** Vi kører hver 12. time og
gemmer allerede `kickoff_at`. En tid, der ændrer sig mellem to kørsler, var ikke
fastsat. Ingen tærskel, ingen antagelse om leverandøren — men svaret kommer
først bagudrettet, og det koster en kolonne til den forrige værdi.

---

## Sådan gentages aflæsningen

PowerShell, med `$FD` sat til `FOOTBALLDATA_TOKEN`. Skift `PL` ud med `PD`,
`SA`, `BL1` eller `CL`. Loftet er 10 kald/minut.

```powershell
$resp  = Invoke-WebRequest -UseBasicParsing -Uri "https://api.football-data.org/v4/competitions/PL/matches?season=2026" -Headers @{ "X-Auth-Token" = $FD }
$raw   = $resp.Content
$tider = [regex]::Matches($raw, '"utcDate":"([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
$m     = ($raw | ConvertFrom-Json).matches
$tider.Count
0..($m.Count-1) | ForEach-Object { "{0}  {1}  {2}" -f $tider[$_].Substring(0,7), $tider[$_].Substring(11,5), $m[$_].status } | Group-Object | Sort-Object Name | Format-Table Count, Name -AutoSize
```

`$tider` udtrækkes med regex og ikke fra `$m`, fordi Windows PowerShell 5.1
konverterer ISO-datoer til `DateTime` og viser dem i lokal tid — en rå
`T00:00:00Z` ville stå som `02:00` og føre til den modsatte konklusion.
