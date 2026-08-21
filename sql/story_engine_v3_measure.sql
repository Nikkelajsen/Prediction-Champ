-- AFLÆSNING af Story Engine v3's dagsmotor. Ad hoc-værktøj, ikke en migrering.
--
-- Den svarer på DE TO BACKLOG-RÆKKER, der har ventet på den samme udløser:
--
--   `A35`  Er publiceringstærsklen på 45 den rigtige?
--   `A33`  Er dagsmotorens variation tyndere, end regelantallet lover?
--
-- DE ER ÉT OPSLAG OG IKKE TO, og det er ikke en sammenlægning for nemheds
-- skyld. Regn scorerummet efter: en kandidat scorer `grundvægt + størrelse +
-- nærhed`, og for HOVEDPERSONEN er nærheden altid 20. Grundvægtene er 8
-- (`DAY_RESULT`), 18 (`SO_CLOSE`), 24 (`COLLECTIVE_MISS`), 28
-- (`STREAK_STATUS`), 30 (`DUEL`), 32 (`CONTRARIAN`), 34 (`DAY_TOP`) og 100
-- (`MILESTONE`). Med nul størrelsesbidrag bliver personlige gulve derfor 28,
-- 38, 44, 48, 50, 52, 54 og 120 — og tærsklen 45 ligger i hullet mellem
-- `DAY_RESULT`s LOFT (8 + 12 + 20 = 40) og de fire øverste reglers GULV.
--
-- Følgen er, at tærsklen for hovedpersonen næsten ikke er en tærskel: fire af
-- de syv dagsregler udgiver ALTID, `DAY_RESULT` udgiver ALDRIG, og kun to —
-- `SO_CLOSE` (skal have 7 størrelsespoint) og `COLLECTIVE_MISS` (skal have 1) —
-- afgøres faktisk af tallet. Andelen af kampdage med ulæst-markering er dermed
-- ikke styret af tærsklen, men af **hvor ofte en anden regel end dagens facit
-- udløser** — hvilket er præcis `A33`s spørgsmål. Ét datasæt, to svar.
--
-- Det gør også `A35`s håndtag kendt på forhånd: bevæger tærsklen sig inden for
-- 41–44, ændrer den KUN `COLLECTIVE_MISS` og de smalleste `SO_CLOSE`; skal den
-- flytte andelen mærkbart, skal den forbi et gulv (45 → 49 slår
-- `STREAK_STATUS` ud, 45 → 51 også `DUEL`). Grundvægtene er den grovere og
-- ærligere skrue. Regnestykket står i
-- `docs/reviews/story-engine-v3-scorerum-2026-08-21.md`.
--
-- ---------------------------------------------------------------------------
-- HVAD DEN LÆSER, OG HVORFOR DEN LÆSER TO KILDER
--
-- `stories.news_value` er TABSFRI: motoren gemmer dagens højeste kandidatscore
-- på hver eneste v3-række, også de dæmpede, netop for at kunne svare
-- bagudrettet (`sql/story_engine_v3.sql`). Det er den, `A35` afgøres på.
--
-- `analytics_events.story_score_distribution` er ekkoet af det SETE og er
-- fire-and-forget under RLS — altså et GULV, aldrig et loft. Den findes her af
-- én grund: `A33`s udløser er ikke "har motoren produceret", men "har nogen
-- oplevet ensformigheden". Uden visninger er fordelingen nedenfor et svar på et
-- spørgsmål, ingen har stillet endnu.
--
-- `news_value is not null` skiller v3-æraen fra v2 — samme æra-skel som det
-- unikke indeks `stories_day_slot_uniq` og som `sql/checks/day_card_coverage.sql`.
-- v2's 197 efterfyldte dagskort er stadig i tabellen som analysedata (#48), og
-- de ville ellers regne med i hver eneste procentdel her.
--
-- ---------------------------------------------------------------------------
-- VIS-BAR ER REGNET FOR v3 OG IKKE LÅNT FRA ANALYTICS
--
-- Analytics-tavlens `viewable` (`created_at < round_key + 7 dage`) er
-- KARUSELLENS begreb fra v2. v3 har ingen karrusel: `loadDayCard` henter den
-- NYESTE `day_key` og viser den kun, hvis rækken er under 48 timer gammel
-- (`DAY_CARD_MAX_AGE_MS`). Et v3-dagskorts vindue er derfor fra `created_at` og
-- frem til det TIDLIGSTE af (a) 48 timer og (b) det øjeblik, et kort med en
-- nyere `day_key` blev skrevet til samme bruger. Er vinduet nul minutter, kunne
-- kortet aldrig nå en skærm — og et sådant kort hører hverken til i en
-- visningsrate eller i en fordeling over det, brugerne har oplevet.
--
-- ---------------------------------------------------------------------------
-- SIKKERHED: FILEN ER READ-ONLY
--
-- Ingen `insert`, `update`, `delete` eller `drop` mod `public`. Alt, den
-- skriver, er temporære tabeller, som lever i den session, der læser filen —
-- samme form som `sql/checks/`, og af samme grund: der installeres INTET i
-- produktionen. Den er dermed også trygt gen-kørbar.
--
-- Modsat `sql/story_engine_v2_measure.sql`, som gen-genererede dagskort for at
-- måle TID, rører denne fil ikke motoren. Den måler dens produkt.
--
-- ---------------------------------------------------------------------------
-- SÅDAN KØRES DEN
--
-- Supabases SQL-editor, "Run without RLS": indsæt HELE filen og kør. Svaret
-- kommer som ÉN tabel til sidst — `raise notice` ville give "Success. No rows
-- returned", altså en kørsel, der så vellykket ud og intet fortalte.
--
-- Fra terminal virker den samme fil:
--   psql "$SUPABASE_DB_URL" -f sql/story_engine_v3_measure.sql
--
-- Handlingsgrænserne står i sidste blok, og filen regner selv dommen ud.
--
-- ---------------------------------------------------------------------------
-- KØRT FØRSTE GANG 21. AUGUST 2026 — HVAD DEN AFGJORDE, OG HVAD DEN IKKE KUNNE
--
-- 100 bruger-dage · 25 brugere · 4 kampdage · 50 vis-bare · 168 visninger.
-- Tallene og det, de afgjorde, står i
-- `docs/reviews/story-engine-v3-aflaesning-2026-08-21.md`.
--
-- **`A33` blev besvaret og er lukket.** Nævneren var det halve arbejde: rå gav
-- aflæsningen `DAY_RESULT` 43 af 100, men 35 af dem er tips-påmindelser uden
-- kandidater at vælge imellem. På den reelle valgmængde (65) er dagens facit
-- 12,3 % mod v2's 44 %. **Læs derfor ALTID række 20 og 21 sammen, og række 61+
-- mod række 14** — et forhold har to led, og det er nævneren, der overrasker.
--
-- **`A35` kunne IKKE besvares:** fire kampdage af de ti. Udløserens to halvdele
-- løber ikke i samme takt — de to uger var gået for længst, mens kampdage med
-- dagskort kommer ~2–3 om ugen. **Filen skal køres igen**, og den svarer da også
-- på `A58` (er `DAY_TOP` + `CONTRARIAN` = 87 % af det sete den rigtige
-- fordeling?), som kom af den første kørsel.
-- ===========================================================================

drop table if exists _maal;
create temporary table _maal (ord int, blok text, maal text, vaerdi text, dom text);

-- ---------------------------------------------------------------------------
-- Grundlaget: v3-æraens dagskort, ét pr. (bruger, kampdag)
-- ---------------------------------------------------------------------------
-- `winner_rule` er den regel, motoren VALGTE; `rule` er den, brugeren SÅ. De to
-- er forskellige præcis når vinderen lå under tærsklen og blev dæmpet til
-- dagens facit — og forskellen er hele `A35`s emne, så begge skal med.
drop table if exists _kort;
create temporary table _kort as
select
  s.id,
  s.user_id,
  s.day_key,
  s.rule,
  s.priority,
  s.news_value,
  s.created_at,
  s.dismissed_at,
  coalesce(s.payload ->> 'winner_rule', s.rule)                     as winner_rule,
  coalesce((s.payload ->> 'runner_up_value')::int, 0)               as runner_up,
  -- Tips-påmindelsen er ikke et valg mellem kandidater: brugeren havde intet
  -- scoret tip, så der var ingen kandidater at vælge imellem. Den tælles for
  -- sig, fordi den ellers ville trykke tærskel-andelen ned uden at sige noget
  -- om tærsklen.
  coalesce(s.payload ->> 'variant', '') = 'no_tips'                 as no_tips,
  coalesce((s.payload ->> 'third')::boolean, false)                 as third
from public.stories s
where s.period = 'day'
  and s.news_value is not null;
create index on _kort (user_id, day_key);

-- Vinduet, kortet faktisk kunne nås i. Se hovedet.
drop table if exists _vindue;
create temporary table _vindue as
select
  k.id,
  k.user_id,
  greatest(0, extract(epoch from
     least(k.created_at + interval '48 hours',
           coalesce(min(n.created_at), 'infinity'::timestamptz))
     - k.created_at) / 60)::int                                     as vindue_min
from _kort k
-- Ingen betingelse på `n.created_at`, og det er ikke en forglemmelse.
-- `loadDayCard` henter den NYESTE `day_key` uanset hvornår rækkerne blev
-- skrevet, så et kort holder op med at være det nyeste i samme sekund, en
-- række med en større `day_key` findes — også når de to blev skrevet i samme
-- sætning, som bagstopperens dagsløkke gør det. `greatest(0, …)` fanger den
-- omvendte rækkefølge: en resultatrettelse, der skriver en GAMMEL dag om,
-- efter en nyere allerede stod, gav et kort, ingen kunne nå.
left join _kort n
  on n.user_id = k.user_id
 and n.day_key > k.day_key
group by k.id, k.user_id, k.created_at;

-- Det SETE. Eventet skrives kun af `DayCard.jsx` og er derfor dagskortenes
-- eget spor. Datofiltret er et værn mod en metadata-nøgle, der en dag skifter
-- form: en fejlet cast ville stoppe hele aflæsningen midt i.
drop table if exists _vist;
create temporary table _vist as
select
  e.user_id,
  (e.metadata ->> 'day_key')::date                                  as day_key,
  coalesce(e.metadata ->> 'winner_rule', '(ukendt)')                as winner_rule,
  e.created_at
from public.analytics_events e
where e.event_name = 'story_score_distribution'
  and e.metadata ->> 'day_key' ~ '^\d{4}-\d{2}-\d{2}$';

-- ===========================================================================
-- BLOK 0 · Grundlag og udløser
-- ===========================================================================
insert into _maal values
  (10, '0 · Grundlag', 'v3-æraens kampdage (første → sidste)',
   coalesce((select min(day_key)::text || ' → ' || max(day_key)::text from _kort),
            '— ingen v3-rækker —'),
   ''),

  (11, '0 · Grundlag', 'dage siden første v3-dagskort',
   coalesce((select (current_date - min(day_key))::text from _kort), '—'),
   case when (select current_date - min(day_key) from _kort) >= 14
        then 'to uger: OPFYLDT' else 'to uger: IKKE OPFYLDT' end),

  (12, '0 · Grundlag', 'kampdage med v3-dagskort',
   (select count(distinct day_key)::text from _kort),
   case when (select count(distinct day_key) from _kort) >= 10
        then 'ti kampdage: OPFYLDT' else 'ti kampdage: IKKE OPFYLDT' end),

  (13, '0 · Grundlag', 'bruger-dage i alt',
   (select count(*)::text from _kort), ''),

  (14, '0 · Grundlag', 'heraf tips-påmindelser (ingen kandidater at vælge imellem)',
   (select (count(*) filter (where no_tips))::text from _kort), ''),

  (15, '0 · Grundlag', 'heraf tredjepersons-kort (fan-out)',
   (select (count(*) filter (where third))::text from _kort), ''),

  (16, '0 · Grundlag', 'brugere med mindst ét v3-dagskort',
   (select count(distinct user_id)::text from _kort), ''),

  (17, '0 · Grundlag', 'kort med et vindue > 0 minutter (vis-bare)',
   (select (count(*) filter (where vindue_min > 0))::text from _vindue),
   case when (select count(*) filter (where vindue_min > 0) from _vindue) > 0
        then 'A33 halvdel 1: OPFYLDT' else 'A33 halvdel 1: IKKE OPFYLDT' end),

  (18, '0 · Grundlag', 'dagskort, der faktisk er SET (story_score_distribution)',
   (select count(*)::text from _vist),
   case when (select count(*) from _vist) > 0
        then 'A33 halvdel 2: OPFYLDT' else 'A33 halvdel 2: IKKE OPFYLDT — spørgsmålet kan ikke stilles endnu' end),

  (19, '0 · Grundlag', 'brugere, der har set mindst ét dagskort',
   (select count(distinct user_id)::text from _vist), '');

-- ===========================================================================
-- BLOK 1 · A35 · tærsklen 45
-- ===========================================================================
-- Målet (backloggen, spec §5): 40–60 % af kampdagene med ulæst-markering for en
-- aktiv bruger. Over 70 % ⇒ tærsklen er for lav. Under 25 % ⇒ Hjem er stille.
insert into _maal values
  (20, '1 · A35 · tærsklen', 'andel af bruger-dage med ulæst-markering (alle kort)',
   coalesce((select round(100.0 * count(*) filter (where news_value >= 45)
                         / nullif(count(*), 0), 1)::text || ' %' from _kort), '—'),
   coalesce((select case
       when count(*) = 0 then 'intet grundlag'
       when 100.0 * count(*) filter (where news_value >= 45) / count(*) > 70
         then 'OVER 70 % ⇒ tærsklen er for lav'
       when 100.0 * count(*) filter (where news_value >= 45) / count(*) < 25
         then 'UNDER 25 % ⇒ Hjem er stille igen'
       when 100.0 * count(*) filter (where news_value >= 45) / count(*) between 40 and 60
         then 'i målet 40–60 % ⇒ 45 holder'
       else 'uden for målet, men inden for handlingsgrænserne'
     end from _kort), '—')),

  -- RÆKKE 21 BÆRER SAMME DOM SOM RÆKKE 20, og det er ikke pynt. Aflæsningen
  -- 21. august 2026 gav 50,0 % på række 20 (midt i målet) og 76,9 % her (over
  -- "for lav") — samme datasæt, to nævnere, to modsatte domme. Forskellen ER
  -- tips-påmindelserne, og de skrumper, hvis brugerne bliver mere aktive. Uden
  -- dommen på begge linjer skal den forskel opdages på ny hver gang.
  (21, '1 · A35 · tærsklen', 'samme, uden tips-påmindelser (motorens egen valgmængde)',
   coalesce((select round(100.0 * count(*) filter (where news_value >= 45)
                         / nullif(count(*), 0), 1)::text || ' %'
             from _kort where not no_tips), '—'),
   coalesce((select case
       when count(*) = 0 then 'intet grundlag'
       when 100.0 * count(*) filter (where news_value >= 45) / count(*) > 70
         then 'OVER 70 % ⇒ tærsklen er for lav, når brugeren FAKTISK tipper'
       when 100.0 * count(*) filter (where news_value >= 45) / count(*) < 25
         then 'UNDER 25 % ⇒ Hjem er stille igen'
       when 100.0 * count(*) filter (where news_value >= 45) / count(*) between 40 and 60
         then 'i målet 40–60 %'
       else 'uden for målet, men inden for handlingsgrænserne'
     end from _kort where not no_tips), '—')),

  (22, '1 · A35 · tærsklen', 'aktive brugere (mindst 5 kampdage — færre kan ikke måle en andel)',
   (select count(*)::text from (
      select user_id from _kort group by user_id having count(*) >= 5) a), ''),

  (23, '1 · A35 · tærsklen', 'median-andel pr. aktiv bruger',
   coalesce((select round(percentile_cont(0.5) within group (order by a.pct)::numeric, 1)::text || ' %'
             from (select 100.0 * count(*) filter (where news_value >= 45) / count(*) as pct
                     from _kort group by user_id having count(*) >= 5) a), '—'),
   coalesce((select case
       when count(*) = 0 then 'ingen aktive brugere endnu'
       when percentile_cont(0.5) within group (order by a.pct) > 70 then 'OVER 70 % ⇒ for lav'
       when percentile_cont(0.5) within group (order by a.pct) < 25 then 'UNDER 25 % ⇒ for høj'
       when percentile_cont(0.5) within group (order by a.pct) between 40 and 60 then 'i målet ⇒ 45 holder'
       else 'uden for målet, men inden for handlingsgrænserne'
     end
     from (select 100.0 * count(*) filter (where news_value >= 45) / count(*) as pct
             from _kort group by user_id having count(*) >= 5) a), '—'));

-- Aktive brugere fordelt på handlingsgrænsernes bånd. En median kan skjule, at
-- halvdelen får et badge hver dag og den anden halvdel aldrig.
insert into _maal
select 24 + b.i, '1 · A35 · tærsklen',
       'aktive brugere i båndet ' || b.navn,
       count(a.pct)::text,
       case when b.navn = '40–60 % (målet)' then '← målet' else '' end
from (values (0, '< 25 %', -1::numeric, 25::numeric),
             (1, '25–40 %', 25, 40),
             (2, '40–60 % (målet)', 40, 60),
             (3, '60–70 %', 60, 70),
             (4, '> 70 %', 70, 101)) b(i, navn, lo, hi)
left join (
  select 100.0 * count(*) filter (where news_value >= 45) / count(*) as pct
  from _kort group by user_id having count(*) >= 5
) a on a.pct >= b.lo and a.pct < b.hi
group by b.i, b.navn;

-- Modspillet: hvad ville andelen være ved en anden tærskel? Tallene viser
-- direkte, hvor lidt håndtaget rykker mellem gulvene — se hovedet.
insert into _maal
select 30 + t.i, '1 · A35 · tærsklen',
       'modspil: andel ulæst ved tærskel ' || t.v,
       coalesce(round(100.0 * count(*) filter (where k.news_value >= t.v)
                      / nullif(count(k.id), 0), 1)::text || ' %', '—'),
       t.note
from (values (1, 38, 'SO_CLOSE-gulvet'),
             (2, 41, ''),
             (3, 44, 'COLLECTIVE_MISS-gulvet'),
             (4, 45, '← den nuværende'),
             (5, 48, 'STREAK_STATUS-gulvet'),
             (6, 51, 'over DUEL-gulvet'),
             (7, 53, 'over CONTRARIAN-gulvet'),
             (8, 55, 'over DAY_TOP-gulvet')) t(i, v, note)
left join _kort k on true
group by t.i, t.v, t.note;

-- Fordelingen, tærsklen skæres i. Båndene er valgt efter grundvægtenes gulve og
-- ikke efter runde tal: det er dér, en flytning ville få virkning.
insert into _maal
select 40 + b.i, '1 · A35 · tærsklen',
       'fordeling: news_value ' || b.navn,
       count(k.id)::text ||
         coalesce(' · ' || round(100.0 * count(k.id) / nullif((select count(*) from _kort), 0), 1)::text || ' %', ''),
       b.note
from (values (0, '0 (ingen kandidat)', 0, 1, 'tips-påmindelse'),
             (1, '1–27', 1, 28, ''),
             (2, '28–40', 28, 41, 'DAY_RESULTs eget spænd'),
             (3, '41–44', 41, 45, 'lige under tærsklen'),
             (4, '45–47', 45, 48, 'kun SO_CLOSE og COLLECTIVE_MISS kan lande her'),
             (5, '48–53', 48, 54, ''),
             (6, '54–119', 54, 120, ''),
             (7, '120 (milepæl)', 120, 1000, '')) b(i, navn, lo, hi, note)
left join _kort k on k.news_value >= b.lo and k.news_value < b.hi
group by b.i, b.navn, b.note;

insert into _maal values
  (49, '1 · A35 · tærsklen', 'dage hvor OGSÅ toeren nåede 45 (motoren havde et reelt valg)',
   coalesce((select (count(*) filter (where runner_up >= 45))::text || ' af ' || count(*)::text
             from _kort where not no_tips), '—'),
   'lavt tal ⇒ vinderen står alene, og tærsklen afgør alt');

-- ===========================================================================
-- BLOK 2 · A33 · variationen
-- ===========================================================================
-- v2's tal til sammenligning: DAY_RESULT var 123 af 280 historier (44 %), og de
-- næste to (DUEL 35, COLLECTIVE_MISS 19) var tilsammen mindre end halvdelen.
insert into _maal
select 60 + (row_number() over (order by count(*) desc, k.winner_rule))::int,
       '2 · A33 · variationen',
       'VALGT regel: ' || k.winner_rule,
       count(*)::text || ' · ' ||
         round(100.0 * count(*) / (select count(*) from _kort), 1)::text || ' % · news_value ' ||
         min(k.news_value)::text || '–' || max(k.news_value)::text ||
         ' (snit ' || round(avg(k.news_value), 1)::text || ')',
       case when k.winner_rule = 'DAY_RESULT' then 'v2 til sammenligning: 44 %' else '' end
from _kort k
group by k.winner_rule;

-- Regler, der ALDRIG har udløst i v3-æraen. Listen er de otte dagsregler i
-- `sql/story_engine_v3.sql` — den er skrevet af, fordi et opslag pr. definition
-- kun kan se de regler, der HAR udløst, og det interessante er de andre.
-- Kommer der en niende dagsregel, skal den tilføjes her.
insert into _maal
select 79, '2 · A33 · variationen', 'dagsregler, der ALDRIG har udløst i v3-æraen',
       coalesce(string_agg(r.navn, ', ' order by r.navn), 'ingen — alle otte har udløst'),
       (select count(distinct winner_rule)::text || ' af 8 regler har udløst' from _kort)
from (values ('DAY_RESULT'), ('SO_CLOSE'), ('COLLECTIVE_MISS'), ('STREAK_STATUS'),
             ('DUEL'), ('CONTRARIAN'), ('DAY_TOP'), ('MILESTONE')) r(navn)
where not exists (select 1 from _kort k where k.winner_rule = r.navn);

insert into _maal values
  (80, '2 · A33 · variationen', 'kort, hvor det VISTE blev dagens facit, men vinderen var en anden',
   coalesce((select (count(*) filter (where rule = 'DAY_RESULT' and winner_rule <> 'DAY_RESULT'))::text
             from _kort), '—'),
   'dæmpede kort — motoren fandt en historie, tærsklen holdt den tilbage'),

  (81, '2 · A33 · variationen', 'gentagelse: samme VISTE regel som brugerens foregående kampdag',
   coalesce((select round(100.0 * count(*) filter (where rule = forrige)
                          / nullif(count(*) filter (where forrige is not null), 0), 1)::text || ' %'
             from (select rule, lag(rule) over (partition by user_id order by day_key) as forrige
                     from _kort) s), '—'),
   'højt tal ⇒ "det samme kort hver anden gang" — rækkens egen formulering'),

  (82, '2 · A33 · variationen', 'ensformighed: andel af en aktiv brugers kort, der bærer hendes hyppigste regel',
   coalesce((select round(avg(100.0 * m.top / m.n), 1)::text || ' %'
             from (select x.user_id, sum(x.c) as n, max(x.c) as top
                     from (select user_id, rule, count(*) as c from _kort group by 1, 2) x
                    group by x.user_id) m
             where m.n >= 5), '—'),
   '100 % = én regel hver gang; 1/antal regler = jævnt fordelt');

-- Det SETE pr. regel. `_vist` er et gulv (fire-and-forget under RLS), så den må
-- ikke stilles op som en rate mod produktionen — kun som "har nogen set den".
insert into _maal
select 90 + (row_number() over (order by count(*) desc, v.winner_rule))::int,
       '2 · A33 · variationen',
       'SET regel: ' || v.winner_rule,
       count(*)::text || ' visninger · ' || count(distinct v.user_id)::text || ' brugere',
       ''
from _vist v
group by v.winner_rule;

-- ===========================================================================
-- BLOK 3 · G143 · stimen, der aldrig vandt
-- ===========================================================================
-- `STREAK_STATUS` er den eneste af de otte dagsregler uden en eneste SEJR i
-- v3-æraen. Blok 2's tabel kan ikke skelne "har aldrig udløst" fra "har aldrig
-- vundet": den grupperer på `winner_rule`, og en taber efterlader intet spor —
-- `runner_up_value` gemmer et TAL, ikke en regel.
--
-- DET ER AFGJORT I REPOET, AT REGLEN VIRKER (21. august 2026). Motoren er kørt
-- mod en fixture med en levende stime, og kortet blev skrevet — til både
-- hovedpersonen og en fan-out-modtager. Reglen er altså ikke død kode.
--
-- DET, DER IKKE KAN AFGØRES I REPOET, er hvor tit den har HAFT anledningen. Og
-- den er snæver af to grunde:
--   · stimen skal slutte på præcis den dag, der får et kort, og
--   · reglen er STRUKTURELT DOMINERET. `STREAK_STATUS` har `competition_id =
--     null`, så `_sd_mag`-joinet (flytning + over gennemsnittet) rammer ingen
--     række, og den får KUN stime-bonussen som størrelsesbidrag. `DAY_TOP` (34),
--     `CONTRARIAN` (32) og `DUEL` (30) får den samme bonus PLUS flytning og
--     over-snit, og deres grundvægt er højere. De slår den derfor ALTID, når de
--     udløser for samme bruger samme dag — målt til 72 mod 60 i en fixture.
-- Med `DAY_TOP` + `CONTRARIAN` som 69 % af alle sejre kan stimen kun vinde på
-- en dag, hvor ingen af de tre udløste.
--
-- Denne blok måler netop den forskel: fandtes stimen, og hvad fik brugeren i
-- stedet? Den regner stimerne med motorens EGEN definition (`_sd_streak`), bare
-- uden `ended_day = p_day`, så alle stimer i historikken kommer med.
drop table if exists _stime;
create temporary table _stime as
with hist as (
  select pr.user_id, m.kickoff_at, m.match_day, m.id as match_id,
         (public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) >= 1) as hit
  from public.predictions pr
  join public.matches m on m.id = pr.match_id
  join public.seasons s on s.id = m.season_id
  join public.leagues l on l.id = s.league_id and l.is_official
  where m.home_score is not null and m.away_score is not null
    and pr.pred_home is not null and pr.pred_away is not null
),
grp as (
  select *,
    row_number() over (partition by user_id order by kickoff_at, match_id)
    - row_number() over (partition by user_id, hit order by kickoff_at, match_id) as g
  from hist
),
runs as (
  select user_id, hit, g, count(*)::int as len,
         max(match_day) as ended_day,
         max(kickoff_at) as run_last
  from grp group by user_id, hit, g
)
select r.user_id, r.len, r.ended_day, r.run_last,
       -- Hvad stimen VILLE have scoret for hovedpersonen: 28 + stime-bonus + 20.
       (28 + least(12, 2 * greatest(0, r.len - 5)) + 20)::int          as stime_score,
       -- Den næste scorede kamp efter stimen — den, der brød den.
       (select min(h.match_day) from hist h
         where h.user_id = r.user_id and h.kickoff_at > r.run_last)    as brudt_dag,
       -- Hvad brugeren faktisk fik den dag, stimen sluttede.
       (select st.rule from public.stories st
         where st.period = 'day' and st.user_id = r.user_id
           and st.day_key = r.ended_day and st.news_value is not null) as fik_regel,
       (select st.news_value from public.stories st
         where st.period = 'day' and st.user_id = r.user_id
           and st.day_key = r.ended_day and st.news_value is not null) as fik_score
from runs r
where r.hit and r.len >= 5;

insert into _maal values
  (100, '3 · G143 · stimen', 'femer-stimer i hele historikken',
   (select count(*)::text from _stime),
   case when (select count(*) from _stime) = 0
        then 'NUL ⇒ reglen er uafprøvet og ikke død — samme svar som G72'
        else 'reglen har haft anledninger; se nedenfor hvad der vandt i stedet' end),

  (101, '3 · G143 · stimen', 'brugere med mindst én femer-stime',
   (select count(distinct user_id)::text from _stime), ''),

  (102, '3 · G143 · stimen', 'længste stime',
   coalesce((select max(len)::text || ' kampe' from _stime), '—'), ''),

  (103, '3 · G143 · stimen', 'stimer, der sluttede på en dag med et v3-dagskort',
   (select (count(*) filter (where fik_regel is not null))::text from _stime),
   'DET er de dage, reglen var kandidat på'),

  (104, '3 · G143 · stimen', 'heraf: kortet blev STREAK_STATUS (reglen vandt)',
   (select (count(*) filter (where fik_regel = 'STREAK_STATUS'))::text from _stime), ''),

  (105, '3 · G143 · stimen', 'heraf: en anden regel vandt, selv om stimen var kandidat',
   (select (count(*) filter (where fik_regel is not null and fik_regel <> 'STREAK_STATUS'))::text
      from _stime),
   'højt tal ⇒ reglen er ikke uden anledning, den er domineret'),

  (106, '3 · G143 · stimen', 'største afstand op til vinderen på sådan en dag',
   coalesce((select (max(fik_score - stime_score))::text || ' point'
             from _stime where fik_regel is not null and fik_regel <> 'STREAK_STATUS'), '—'),
   'stimens egen score er 28 + stime-bonus + 20, altså 48–60'),

  (107, '3 · G143 · stimen', 'stimer, der brød en SENERE dag (💤-grenens blinde vinkel)',
   (select (count(*) filter (where brudt_dag is not null and brudt_dag > ended_day))::text
      from _stime),
   'de her fik ALDRIG et "stimen stoppede"-kort — se G144'),

  (108, '3 · G143 · stimen', 'stimer, der brød SAMME dag (💤-grenen kan se dem)',
   (select (count(*) filter (where brudt_dag = ended_day))::text from _stime), '');

-- ===========================================================================
-- BLOK 4 · Dommen
-- ===========================================================================
insert into _maal values
  (200, '4 · Dom', 'A33 kan besvares',
   case when (select count(*) from _vist) = 0
        then 'NEJ — ingen dagskort er set endnu'
        else 'JA — ' || (select count(*) from _vist)::text || ' visninger fordelt på ' ||
             (select count(distinct winner_rule) from _vist)::text || ' regler' end,
   'udløseren er "vis-bar > 0 OG vist > 0"'),

  (201, '4 · Dom', 'A35 kan besvares',
   case when (select count(distinct day_key) from _kort) < 10
             or (select current_date - min(day_key) from _kort) < 14
        then 'NEJ — udløseren (to uger OG ti kampdage) er ikke opfyldt'
        else 'JA' end,
   'grundlaget er stories.news_value og er tabsfrit'),

  (203, '4 · Dom', 'G143 · hvorfor stimen aldrig vandt',
   case when (select count(*) from _stime) = 0
          then 'ingen femer-stime i historikken — uden anledning'
        when (select count(*) filter (where fik_regel is not null) from _stime) = 0
          then 'stimer findes, men ingen sluttede på en dag med et kort'
        when (select count(*) filter (where fik_regel is not null and fik_regel <> 'STREAK_STATUS') from _stime) > 0
          then 'DOMINERET — den var kandidat og tabte'
        else 'reglen har vundet' end,
   'reglen ER afprøvet og virker; se blok 3'),

  (202, '4 · Dom', 'Håndtagets rækkevidde',
   coalesce((select 'fra ' || round(100.0 * count(*) filter (where news_value >= 38)
                                    / nullif(count(*), 0), 1)::text ||
                    ' % (tærskel 38) til ' ||
                    round(100.0 * count(*) filter (where news_value >= 55)
                          / nullif(count(*), 0), 1)::text || ' % (tærskel 55)'
             from _kort), '—'),
   'er spændet smalt, er det grundvægtene og ikke tærsklen, der skal flyttes');

-- ===========================================================================
select ord, blok, maal, vaerdi, dom from _maal order by ord;
