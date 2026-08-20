# Aflæsning: sender football-data.org et brugbart kort holdnavn? (`B39`)

**Bestilt 20. august 2026 og aflæst af ejeren samme dag** — svaret står i
[Svar](#svar-aflæst-20-august-2026-af-ejeren) nederst. Dokumentet blev skrevet
som bestillingen: opslaget nedenfor køres af ejeren med `FOOTBALLDATA_TOKEN`,
og svaret skrives ind i dette dokument, som derefter er aflæsningen — hvilket
er sket. Formen er den samme som
[kickoff-aflæsningen](./football-data-kickoff-aflaesning-2026-08-07.md), men
opslaget er et andet: kickoff-opslaget udtrækker `utcDate`/`status` og kan ikke
svare på ét af de tre spørgsmål her.

Hvorfor et kald og ikke en migrering: `shortName` og `tla` står i
dokumentationen, men er aldrig set i et svar — og en uprøvet
dokumentationslæsning var netop fejlen 2. august 2026 (`kickoff_tbd` sat af en
`status`-markør, der ikke fandtes i praksis; fire døgn). Baggrund og
konsekvenser står i `B39` i [`BACKLOG.md`](../BACKLOG.md).

---

## De fire spørgsmål, svaret skal kunne besvare

1. **Findes `shortName` for HVERT hold?** Ét hul er nok til, at visningen skal
   have en faldback pr. hold og ikke pr. turnering.
2. **Er feltet nogensinde tomt** (`""` frem for udeladt)? Samme følge som 1,
   men usynlig for et rent "findes feltet"-tjek.
3. **Er det faktisk pænere?** Det, der let glemmes: `shortName` for
   "FC Barcelona" er formentlig "Barcelona" — et tabt præfiks, ikke et kortere
   navn. Gevinsten, rækken kom af, er de LANGE spanske navne ("Real Racing Club
   de Santander", "RCD Espanyol de Barcelona"), så det er dem, øjet skal på.
   Opslaget sorterer efter navnelængde, længste først, netop derfor.
4. **Kolliderer to `shortName` inden for samme turnering?** Billigt at spørge
   med, dyrt at opdage bagefter: `teams.name` forbliver nøgle (kolonnen er
   additiv, se `B39`), men to hold, der VISES ens, er sin egen fejl.

## Sådan køres den

PowerShell, med `$FD` sat til `FOOTBALLDATA_TOKEN`. Loftet er 10 kald/minut —
scriptet laver højst fem og venter for en sikkerheds skyld mellem dem.

Opslaget rammer med vilje **samme endpoint, syncen henter**
(`/competitions/{kode}/matches`, `api/_providers/footballdata.js` læser
`homeTeam`/`awayTeam` derfra) og ikke `/competitions/{kode}/teams`: kolonnen
skal udfyldes af det svar, syncen faktisk får, og de to endpoints er ikke
efterprøvet at være ens. `ConvertFrom-Json` er ufarlig her — advarslen i
kickoff-aflæsningen gjaldt datoer, og der læses kun strenge.

`CL` må gerne fejle: ligafasen var pr. 13. august 2026 endnu ikke lodtrukket
(`B28`/`B32`), og uden den har leverandøren ikke sæsonen 2026. Fejler kaldet,
er dét svaret for CL — skriv det ind som sådan.

> **Rettelse efter bestilling, samme dag.** Første udgave af opslaget satte
> `$FD = $env:FOOTBALLDATA_TOKEN`, og ejerens kørsel fejlede på alle fem
> turneringer med *"Objektreferencen er ikke indstillet til en forekomst af et
> objekt"*. Årsagen var ikke kaldet, men tokenen: miljøvariablen findes i
> Vercel og ikke på ejerens maskine, så `$FD` var tom — og Windows PowerShell
> 5.1's `Invoke-WebRequest` svarer med netop dén intetsigende fejl, når en
> header-værdi er `$null`. Opslaget spørger nu om tokenen og nægter at køre
> med en tom, så fejlen ikke kan komme igen i den forklædning.

```powershell
$FD = Read-Host "FOOTBALLDATA_TOKEN (kopiér værdien fra Vercel -> Settings -> Environment Variables)"
if (-not $FD) { throw "Tom token - kald ikke API'et uden: PS 5.1 fejler ellers med en intetsigende 'Objektreference'-fejl." }
foreach ($kode in "PD","PL","SA","BL1","CL") {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri "https://api.football-data.org/v4/competitions/$kode/matches?season=2026" -Headers @{ "X-Auth-Token" = $FD }
  } catch {
    "`n=== $kode — kaldet fejlede: $($_.Exception.Message) ==="
    continue
  }
  $m = ($resp.Content | ConvertFrom-Json).matches
  $hold = @{}
  foreach ($t in (@($m.homeTeam) + @($m.awayTeam))) {
    if ($t -and $t.id -and $t.name) { $hold["$($t.id)"] = $t }
  }
  $rk        = $hold.Values | Sort-Object { $_.name.Length } -Descending
  $tomme     = @($rk | Where-Object { -not $_.shortName })
  $identiske = @($rk | Where-Object { $_.shortName -eq $_.name })
  "`n=== $kode — $($m.Count) kampe, $($hold.Count) hold · $($tomme.Count) uden shortName · $($identiske.Count) identiske med name ==="
  $rk | ForEach-Object {
    $mark = if (-not $_.shortName) { "TOM" } elseif ($_.shortName -eq $_.name) { "=" } else { "" }
    "{0,-38} | {1,-24} | {2,-3} | {3}" -f $_.name, $_.shortName, $_.tla, $mark
  }
  $dubletter = $rk | Where-Object { $_.shortName } | Group-Object shortName | Where-Object { $_.Count -gt 1 }
  if ($dubletter) { "DUBLET-shortName: " + (($dubletter | ForEach-Object { $_.Name }) -join ", ") }
  Start-Sleep -Seconds 7
}
```

Rimelighedstjek som i kickoff-aflæsningen: kampantallet skal stemme med
turneringens størrelse (380 = 20 hold × 38 runder, 306 = 18 × 34), og
holdantallet med 20 hhv. 18 — ellers har udtrækket ikke fanget hele
terminslisten, og hullerne i svaret kan være udtrækkets egne.

## Sådan læses svaret

- **Spørgsmål 1 og 2** står i hver turnerings overskriftslinje (`N uden
  shortName`) og som `TOM` i sidste kolonne. Nul er det svar, der gør
  visningsvalget simpelt.
- **Spørgsmål 3** er et menneskesvar: læs de øverste rækker (de længste navne —
  de spanske klubber, rækken kom af) og afgør, om `shortName` er et brugbart
  visningsnavn eller bare navnet uden præfiks. `= `-mærket viser, hvor feltet
  ingenting vinder.
- **Spørgsmål 4** står som `DUBLET-shortName`-linjen, eller mangler, hvis der
  ingen er.

## Hvad hvert udfald afgør

| Udfald | Følge for `B39` |
|---|---|
| `shortName` findes for hvert hold, aldrig tom, og er pænere for de lange navne | `B39` bygges som beskrevet: additiv kolonne, `name` forbliver nøgle. Rækken flytter fra Tier 1 til Tier 3. |
| Feltet findes, men har huller eller tomme værdier | Stadig byggelig, men visningen skal falde tilbage pr. hold (`coalesce`), og det skal siges i rækken, FØR der bygges. |
| Feltet er ikke pænere for netop de spanske klubber | Rækken lukker uden byggeri — gevinsten var dem, og et felt, der kun forkorter "FC Barcelona", løser ikke det meldte problem. |
| Dubletter inden for en turnering | Ikke i sig selv en stopper (`name` er nøglen), men de ramte hold skal vises med `name` — og det valg skal med i bygningen. |

Uanset udfald gælder: Superligaen og Scotland Premiership kommer fra Sportmonks,
hvis `short_code` er tre bogstaver ("FCK") — et badge-format, ikke et
visningsnavn — så de to turneringer viser `name` under alle omstændigheder, og
skærmene skal kunne det fra dag ét.

---

## Svar (aflæst 20. august 2026 af ejeren)

Kørt med den rettede udgave af opslaget. Rimelighedstjekkene stemmer i alle
fire turneringer — 380 kampe og 20 hold i PD/PL/SA, 306 kampe og 18 hold i
BL1 — så udtrækket har fanget hele terminslisten hver gang.

| Turnering | Kampe | Hold | Uden `shortName` | Identiske med `name` | Dubletter |
|---|---|---|---|---|---|
| Primera División (`PD`) | 380 | 20 | 0 | 1 (Sevilla FC) | ingen |
| Premier League (`PL`) | 380 | 20 | 0 | 0 | ingen |
| Serie A (`SA`) | 380 | 20 | 0 | 2 (Venezia FC, Como 1907) | ingen |
| Bundesliga (`BL1`) | 306 | 18 | 0 | 2 (RB Leipzig, 1. FC Köln) | ingen |
| Champions League (`CL`) | — | — | — | — | **404: sæsonen 2026 findes fortsat ikke** |

**Spørgsmål 1 og 2: feltet findes for hvert af de 78 hold og er aldrig tomt.**
Visningen behøver derfor ingen faldback pr. hold — og de fem "identiske" er
ufarlige, for dér er feltet og faldbacken den samme streng.

**Spørgsmål 3: ja, og netop for de navne, rækken kom af.** "Real Racing Club de
Santander" → "Santander", "RCD Espanyol de Barcelona" → "Espanyol",
"Real Sociedad de Fútbol" → "Real Sociedad", "Club Atlético de Madrid" →
"Atleti". Bestillingens bekymring — at `shortName` bare ville være navnet uden
præfiks ("FC Barcelona" → "Barcelona") — viste sig forkert i den interessante
retning: leverandøren sender **kælenavne**, ikke afkortninger — "Barça",
"Atleti", "M'gladbach", "HSV", "Inter". Det er de navne, en fodboldlæser selv
siger, men det er en **tone** og ikke kun en længde, og det skal siges højt, når
skærm-valget træffes. Den ene skævhed på 78 navne: PL's "Brighton & Hove Albion
FC" bliver "Brighton Hove" (mistet "&"; "Brighton" ville være det naturlige).
Den ændrer ikke svaret.

**Spørgsmål 4: ingen dubletter i nogen turnering.**

**Udfaldet er tabellens første række:** `B39` bygges som beskrevet — additiv
kolonne, `teams.name` forbliver nøgle, Superligaen og Scotland viser fortsat
`name` — og rækken er flyttet fra Tier 1 til Tier 3 i
[`BACKLOG.md`](../BACKLOG.md). CL-kaldets 404 er samtidig en gratis
gen-aflæsning af `B28`s udløser: sæsonen 2026 findes stadig ikke hos
leverandøren pr. 20. august 2026, så den række venter rigtigt.
