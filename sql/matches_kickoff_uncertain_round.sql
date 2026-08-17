-- Leagly — "ikke bekræftet" skal ikke ramme bekræftede kampe (G135, august 2026)
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- ============================================================================
-- PROBLEMET
-- ============================================================================
-- `matches_kickoff_uncertain.sql` (#49, `G85`) markerer en kamp, hvis dens
-- UTC-klokkeslæt er et, turneringen har LÆRT at mistro — altså et klokkeslæt,
-- mindst tre af sæsonens kampe har flyttet sig VÆK fra. Reglen spørger kun om
-- klokkeslættet. Den spørger aldrig, om den enkelte kamp er bekræftet.
--
-- 17. august 2026 blev det aflæst på skærmen af en bruger:
--
--   Premier League, lør. 22. august (runden lå FIRE DAGE ude)
--     13.30 dansk = 11:30 UTC   bekræftet
--     16.00 dansk = 14:00 UTC   markeret "~ tid ikke bekræftet"   ← 3 kampe
--     18.30 dansk = 16:30 UTC   bekræftet
--
--   Primera División, lør. 22.–søn. 23. august
--     17.00 dansk = 15:00 UTC   markeret "(ikke bekræftet)"       ← 2 kampe
--     19.30 / 21.00 / 21.30     bekræftet
--
-- I London-tid er PL-lørdagen 12.30 / **15.00** / 17.30 — den kanoniske engelske
-- lørdag, hvor 15.00 er blackout-slottet. Det er ligaens mest brugte og mindst
-- flyttede klokkeslæt, og det er præcis dét, appen kaldte ubekræftet.
--
-- ============================================================================
-- HVORFOR DET SKETE — OG HVORFOR DET IKKE ER EN OVERRASKELSE
-- ============================================================================
-- `docs/reviews/football-data-kickoff-aflaesning-2026-08-07.md` forkastede
-- kandidat A (en TABEL over pladsholder-klokkeslæt) med netop denne indvending:
--
--   "Efterårspladsholderen ER turneringens typiske anspilstid, så en tabel over
--    pladsholderværdier ville markere ægte kampe på netop de klokkeslæt, de
--    rigtigt spilles på."
--
-- Kandidat B blev valgt for at undgå det. Men B markerer OGSÅ på klokkeslæt —
-- den *lærer* bare tabellen i stedet for at hardkode den, og arver dermed
-- kollisionen uændret. **B undgik A's kalibreringsproblem, ikke A's
-- kollisionsproblem.** Det er den ene sætning, der er værd at tage med videre.
--
-- To ting gør det værre end en almindelig falsk positiv:
--
--   · Læringen fornys hele efteråret. Hver uge flytter tv-valgene tre kampe væk
--     fra 14:00 UTC, og gulvet på tre er dermed opfyldt igen og igen.
--   · Markeringen rydder aldrig sig selv HER. Den falder først bort, når
--     kampens EGEN tid flytter sig (eller den spilles) — og en ægte
--     lørdag-15.00-kamp flytter sig aldrig. Netop de kampe, der er mest sikre,
--     bærer markøren permanent frem til kampstart.
--
-- Testen fangede det ikke, fordi den PÅSTOD adfærden: påstand 3 i
-- `sql/tests/kickoff_uncertain.sql` siger udtrykkeligt, at kampe, der "ALDRIG
-- har flyttet sig", markeres. Fixturet lå i december/januar, hvor det er
-- rigtigt. Der fandtes ingen påstand om en runde med spredte klokkeslæt.
--
-- ============================================================================
-- RETTELSEN — DOMINANS I RUNDEN
-- ============================================================================
-- Trin 1 (observationen) og trin 2 (de indlærte klokkeslæt) er UÆNDREDE. Det er
-- kun trin 3, markeringen, der bliver kræsen, og triggeren
-- `matches_remember_previous_kickoff` røres slet ikke af denne fil.
--
-- Et pladsholder-regime tildeler ét klokkeslæt til en HEL runde ad gangen:
-- aflæsningen fandt PL november = 15:00 ×40, PD november = 16:00 ×40, SA
-- november = 17:30 ×40. En runde, tv-stationerne har været igennem, har derimod
-- spredte slots — 12.30/15.00/17.30 er netop det, skærmbilledet viser. Et
-- indlært klokkeslæt markerer derfor kun, hvis det bærer **mere end halvdelen**
-- af rundens ikke-spillede kampe.
--
-- HVORFOR DEN NEGATIVE FORM ER SIKKER, NÅR DEN POSITIVE BLEV FORKASTET.
-- Aflæsningen forkastede "alle kampe samme klokkeslæt ⇒ pladsholder" som
-- POSITIV regel, fordi Bundesligaens sidste spillerunde er ægte OG ensartet.
-- Reglen her er den negative form — "spredte klokkeslæt ⇒ ikke en pladsholder" —
-- og den kan kun FJERNE markeringer. Den kan altså kun fejle i retning af en
-- falsk negativ, hvilket er den billige fejl: en umarkeret pladsholder er dét,
-- appen viste i månedsvis før `G85`. Bundesligaens sidste spillerunde kan
-- stadig markeres, hvis 15.30-slottet en dag bliver lært — det er den kendte
-- underdækning, og den tages i visningen (se nedenfor), ikke her.
--
-- HVORFOR "MERE END HALVDELEN" OG IKKE "ALLE". PL's december bærer to distinkte
-- pladsholdere (15:00 ×40 og 20:00 ×20), og et krav om fuld ensartethed ville
-- tabe dem begge. Med dominans markeres 15:00-delen stadig. Det er ikke et
-- kalibreret tal — det er flertal, den eneste tærskel man kan sætte uden data at
-- kalibrere på (`A35`).
--
-- HVORFOR RUNDEN OG IKKE KAMPDAGEN. `round_key` er den enhed, appen selv
-- grupperer efter (tirsdag–mandag, dansk tid) og den, brugeren ser på
-- Tip-skærmen. Kampdagen ville dele en lør+søn-runde i to halve, som hver er
-- lettere at dominere — altså den forkerte retning at fejle i.
--
-- ============================================================================
-- HORISONTEN LIGGER I VISNINGEN OG IKKE HER — OG DET ER EN BESLUTNING
-- ============================================================================
-- Dominansen kan stadig ramme en ægte runde, hvor alle kampe spilles samtidig
-- (sidste spillerunde). Værnet mod det er en horisont på ti dage, men den er
-- lagt i `src/lib/scoring.js` og ikke i denne funktion. Grunden er `G84`s
-- kontrol:
--
--   `sql/checks/kickoff_coverage.sql` alarmerer, når ALLE en turnerings kampe
--   inden for TI DAGE bærer `kickoff_uncertain`. Lå horisonten i SQL, kunne
--   ingen kamp i det vindue længere være markeret, og grenen ville blive stum
--   kode — en kontrol, der ikke kan lyse, er værre end ingen kontrol, fordi den
--   ligner dækning.
--
-- Med horisonten i visningen beholder kolonnen én ren betydning ("det indlærte
-- klokkeslæt dominerer runden"), kontrollen beholder sin følsomhed over for
-- præcis den fejl, `G85` blev bygget for — et pladsholder-regime, der overlever
-- ind i tipsvinduet — og brugeren ser alligevel ikke markøren på en nær kamp.
-- Markøren har været DISPLAY-ONLY siden `#49`, så en visnings-side horisont er
-- den samme slags regel ét lag længere ude.
--
-- ============================================================================
-- ADFÆRDSÆNDRING VED KØRSEL
-- ============================================================================
-- 🟢 Markeringer FJERNES, ingen tilføjes. Filen indsnævrer en betingelse og kan
-- pr. konstruktion ikke gøre `kickoff_uncertain` sand for en række, hvor den var
-- falsk. Første kald efter kørslen rydder de falske positive og returnerer
-- antallet — det tal er den forventede kvittering og ikke en fejl.
--
-- 🟢 Stadig DISPLAY-ONLY. Filen rører hverken `match_lock_at()`,
-- `match_locked()`, en eneste RLS-policy eller `analytics_match_locks` — samme
-- sikkerhedsargument som `#49`, og det er stadig en påstand i testen.
--
-- 🟢 SIGNATUREN ER UÆNDRET, så `api/sync-matches.js` røres ikke. Det er også
-- derfor filen kan nøjes med `create or replace`: et nyt argument ville have
-- gjort funktionen til en overload af `#49`s, og PostgREST ville da afvise
-- syncens kald med "could not choose a candidate function".

create or replace function public.refresh_kickoff_uncertain(p_season_id uuid)
  returns integer
  language plpgsql
as $fn$
declare
  v_n integer;
begin
  -- `drop` først: funktionen kan kaldes to gange i samme transaktion (to sæsoner
  -- i samme turnering), og `on commit drop` rydder først ved commit. Samme
  -- mønster som `_se_changed_rounds` i rating_trigger_optimization.sql.
  drop table if exists _ku_maal;
  create temporary table _ku_maal on commit drop as
  with laert as (
    -- Trin 2, UÆNDRET fra `#49`. `having count(*) >= 3` er gulvet, og
    -- `group by` på klokkeslættet er det, der gør, at tre flytninger fra TRE
    -- FORSKELLIGE klokkeslæt ikke lærer noget.
    select (m.kickoff_prev_at at time zone 'UTC')::time as tid
      from public.matches m
     where m.season_id = p_season_id
       and m.kickoff_prev_at is not null
     group by 1
    having count(*) >= 3
  ),
  runde as (
    -- NYT i `G135`. Rundens sammensætning: hvor mange ikke-spillede kampe ligger
    -- på hvert klokkeslæt, og hvor mange har runden i alt.
    --
    -- `sum(count(*)) over (partition by …)` er en vinduesfunktion oven på
    -- aggregatet — den kører EFTER `group by` og giver rundens total med på hver
    -- klokkeslæt-række, uden et ekstra opslag i samme tabel.
    --
    -- Kun ikke-spillede kampe tælles, i begge led. En spillet kamps klokkeslæt
    -- er bekræftet af, at kampen fandt sted, og at lade den tynde nævneren ud
    -- ville gøre en runde sværere at dominere, efterhånden som den blev spillet
    -- — altså få markøren til at flakke undervejs i en runde.
    select m.round_key,
           (m.kickoff_at at time zone 'UTC')::time      as tid,
           count(*)                                     as paa_tiden,
           sum(count(*)) over (partition by m.round_key) as i_runden
      from public.matches m
     where m.season_id = p_season_id
       and m.home_score is null
     group by m.round_key, 2
  ),
  beregnet as (
    -- Trin 3. Bemærk at udtrykket også siger `false` — en kamp, hvis tid er
    -- blevet rettet, eller som er blevet spillet, mister sin markør her.
    --
    -- `home_score is null` ALENE, uden `away_score`. Hele appen læser netop den
    -- ene kolonne som "kampen er spillet" (api/sync-matches.js, `_rs` i
    -- rating_core.sql, G84's kontrol), og en ekstra betingelse, der aldrig kan
    -- være uenig med den, er en gren, ingen test kan nå — `G84`s egen lære.
    select m.id,
           m.home_score is null
             and exists (
               select 1
                 from laert l
                 join runde r
                   on r.round_key = m.round_key
                  and r.tid       = l.tid
                where l.tid = (m.kickoff_at at time zone 'UTC')::time
                  -- Dominansen: strengt mere end halvdelen af rundens
                  -- ikke-spillede kampe. Ganget frem frem for divideret, så
                  -- tærsklen ikke afgøres i flydende tal.
                  and r.paa_tiden * 2 > r.i_runden
             ) as vaerdi
      from public.matches m
     where m.season_id = p_season_id
  )
  select b.id, b.vaerdi
    from beregnet b
    join public.matches m on m.id = b.id
   where m.kickoff_uncertain is distinct from b.vaerdi;

  -- HVORFOR DEN TÆLLER FØR DEN SKRIVER (uændret fra `#49`). `matches` bærer tre
  -- statement-level triggere, som kalder `recompute_ratings_if_scores_changed()`
  -- — og en UPDATE, der rammer nul rækker, udløser dem alligevel. Den almindelige
  -- tilstand er, at intet skal skifte. `A38` gjorde det dyrt at være ligeglad
  -- med, hvad der hænger på den tabel.
  select count(*)::int into v_n from _ku_maal;
  if v_n = 0 then
    return 0;
  end if;

  update public.matches m
     set kickoff_uncertain = t.vaerdi
    from _ku_maal t
   where m.id = t.id;

  return v_n;
end;
$fn$;

-- Gentaget fra `#49`, fordi en `create or replace` af en funktion, der ER blevet
-- droppet og gen-skabt undervejs, ellers ville stå med Supabases default
-- privileges. Kun jobbet må kalde den: den skriver i `matches`, og en almindelig
-- bruger har ingen grund til at kunne udløse en skrivning på en hel sæson.
revoke all on function public.refresh_kickoff_uncertain(uuid) from public;
revoke all on function public.refresh_kickoff_uncertain(uuid) from anon, authenticated;
grant execute on function public.refresh_kickoff_uncertain(uuid) to service_role;

comment on column public.matches.kickoff_uncertain is
  'Klokkeslættet i kickoff_at er sandsynligvis leverandørens gæt — datoen er kendt. Sættes kun, når det indlærte klokkeslæt bærer over halvdelen af rundens ikke-spillede kampe (G135). DISPLAY-ONLY: låsen og påmindelserne er upåvirkede, modsat kickoff_tbd. Visningen lægger desuden en horisont på ti dage oven i (src/lib/scoring.js).';

-- ============================================================================
-- Verifikation — kør efter scriptet
-- ============================================================================
-- 1) Signaturen er stadig ét argument. To rækker her betyder, at der er opstået
--    en overload, og at PostgREST vil afvise syncens kald:
--
--    select pg_get_function_identity_arguments(oid)
--    from pg_proc where proname = 'refresh_kickoff_uncertain';
--
-- 2) Hvad ryddes? Kør FØR jobbet næste gang — listen er de falske positive,
--    rettelsen fjerner ved næste kørsel:
--
--    select l.name, m.kickoff_at at time zone 'Europe/Copenhagen' as dansk_tid
--    from public.matches m
--    join public.seasons s on s.id = m.season_id
--    join public.leagues l on l.id = s.league_id
--    where m.kickoff_uncertain and m.kickoff_at < now() + interval '10 days'
--    order by m.kickoff_at;
--
-- 3) Ingen lås har flyttet sig. Tallene skal være de samme før og efter denne
--    fil — det er hele pointen med en display-only markør:
--
--    select count(*) filter (where is_locked) as laaste, count(*) as i_alt
--    from public.analytics_match_locks;
--
-- 4) Efter et par kørsler: hvad står tilbage som markeret, og ligger det
--    langt nok ude til at være troværdigt?
--
--    select l.name, m.round_key, count(*)
--    from public.matches m
--    join public.seasons s on s.id = m.season_id
--    join public.leagues l on l.id = s.league_id
--    where m.kickoff_uncertain group by 1, 2 order by 2, 1;
