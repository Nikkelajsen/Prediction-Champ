-- =============================================================================
-- SIMULERING AF EN HEL SÆSON — KUN STAGING
-- =============================================================================
--
-- Formålet: få tre testbrugere gennem en hel sæson med tips, resultater,
-- stillinger, rating, historier og kåringer — uden at taste noget, og uden at
-- en synkronisering kan tørre resultaterne væk igen.
--
-- ---------------------------------------------------------------------------
-- DEN VIGTIGE IDÉ: SIMULATIONEN FÅR SIN EGEN TURNERING
--
-- Det nærliggende ville være at taste resultater ind på Superligaens rigtige
-- kampe. Det kan man ikke stole på: `api/sync-matches.js` skriver
-- `home_score: null`, når leverandøren ikke melder kampen færdig
-- (`toRow()`, jf. DOCUMENTATION.md §8), og et enkelt tryk på "Hent nu" ville
-- dermed slette hvert eneste håndtastede resultat i den sæson. Det er præcis
-- den fælde, denne fil findes for at komme udenom.
--
-- Simulationen opretter derfor sin EGEN turnering — "SIM-ligaen" — med egne
-- hold og et komplet dobbeltturneringsprogram. Ingen leverandør kender den:
--
--   · `matches.api_fixture_id` er `sim:<runde>:<nr>`, og hverken Sportmonks
--     eller football-data.org sender nogensinde et id med det præfiks, så
--     `on_conflict=api_fixture_id`-upserten kan ikke ramme en sim-kamp.
--   · `leagues.api_league_id` er null, så "Hent nu" for SIM-ligaen ikke kan
--     hente noget — og ligaen har alligevel ingen grund til at blive trykket på.
--   · `leagues.live_enabled = false`, så `api/sync-live.js` aldrig skriver
--     live-felter for den (den skriver kun ENDELIGE resultater, og kun for
--     kampe, der stadig mangler et — sim-kampe har deres).
--
-- Resultatet er en sæson, der bliver stående, uanset hvor mange gange du
-- synkroniserer de rigtige turneringer ved siden af.
--
-- ---------------------------------------------------------------------------
-- SÅDAN KØRER DU DEN
--
-- 1. Supabase → SQL Editor (STAGING-projektet!) → indsæt HELE denne fil →
--    "Run without RLS". Det opretter kun skemaet `sim` og dets funktioner —
--    intet data ændres af selve filen.
--
-- 2. Lås simulationen op (én gang pr. database):
--
--       select sim.arm('JA - DETTE ER STAGING');
--
-- 3. Byg og spil sæsonen:
--
--       select sim.setup();       -- 12 hold, 22 runder, 132 kampe, alle brugere med
--       select sim.season();      -- tips + spiller alle runder frem til i dag
--       select * from sim.status();
--
-- 4. Vil du se sæsonen skride frem én uge ad gangen (historier, kåringer,
--    rating-udvikling — dét, der kun opstår, når runderne afgøres i takt):
--
--       select sim.advance(1);    -- tipper og spiller næste runde
--
--    Eller spil den HELT færdig, også de runder der ligger fremme, og lad
--    konkurrencen blive afsluttet med pokal og podie:
--
--       select sim.tip();
--       select sim.play('2030-01-01');
--
--    Sæsonen meldes færdig af sig selv, når sidste kamp er spillet. Det er ikke
--    en detalje: `competition_status` kræver, at SÆSONEN siger, den er slut —
--    "alle kampe har resultat" er ikke nok for en konkurrence, der kan vokse.
--    `sim.status()`s række "Afsluttet" siger, hvad der mangler.
--
-- 5. Fortryd alt igen — sporløst:
--
--       select sim.teardown();
--
-- ---------------------------------------------------------------------------
-- SIKKERHEDEN, OG HVAD DEN IKKE ER
--
-- `sim.arm()` er to låse: en sætning, der skal skrives ordret, og et loft over
-- antallet af brugere i `auth.users` (standard 10). Den ANDEN er en heuristik,
-- ikke et bevis — der findes ingen SQL-værdi, der siger "dette er staging".
-- Kontrollen fra `docs/STAGING.md` trin 2 gælder derfor stadig og tager to
-- sekunder:
--
--       select count(*) from auth.users;   -- staging: dine testbrugere. Produktion: flere.
--
-- Til gengæld er skadesradius lille med vilje: alt, simulationen skriver,
-- hænger i SIM-ligaen og fjernes fuldstændigt af `sim.teardown()`. Ingen
-- funktion i filen rører en række, der ikke er dens egen.
--
-- ---------------------------------------------------------------------------
-- DET, DEN IKKE GØR
--
-- · Den opretter ingen brugere. Brugere skal komme gennem appen, så
--   `profiles`-rækken bliver skrevet (`docs/STAGING.md` trin 4). Simulationen
--   bruger de brugere, der findes.
-- · Den rører ikke de rigtige turneringer, deres kampe eller deres resultater.
-- · Den er ikke en migrering. Kør den ALDRIG i produktion — der er intet i
--   den, produktionen skal bruge.
--
-- Idempotent: filen kan køres igen når som helst (alt er `create or replace` /
-- `if not exists`), og en gen-kørsel nulstiller hverken data eller `sim.arm()`.
-- =============================================================================

create schema if not exists sim;

comment on schema sim is
  'Sæson-simulering til STAGING (sql/dev/simulate_season.sql). Hører ikke til i produktion.';

-- Alle funktioner droppes, før de oprettes igen. `create or replace` kan ikke
-- ændre en signatur: får en funktion en ny parameter, står den GAMLE udgave
-- tilbage ved siden af den nye, og næste kald fejler med
-- `function sim.teardown() is not unique`. Det ramte under udviklingen af
-- filen, og det er den slags, der ligner en fejl i databasen frem for i
-- rækkefølgen. Tabellerne (`sim.env`, personaer, styrker) rører blokken ikke,
-- så en gen-kørsel hverken låser simulationen eller sletter data.
do $drop$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'sim'
  loop
    execute 'drop function ' || f.sig;
  end loop;
end;
$drop$;


-- ---------------------------------------------------------------------------
-- 1. Låsen
-- ---------------------------------------------------------------------------
-- Én række, eller ingen. Findes rækken, er simulationen låst op i netop denne
-- database — og det er en handling, et menneske har udført med en sætning, der
-- ikke kan tastes i vanvare.

create table if not exists sim.env (
  only_row  boolean primary key default true,
  armed_at  timestamptz not null default now(),
  seed      double precision not null default 0.4242,
  constraint sim_env_one_row check (only_row)
);

create or replace function sim.arm(p_confirm text, p_max_users int default 10)
returns text
language plpgsql
as $fn$
declare
  v_users int;
begin
  if p_confirm is distinct from 'JA - DETTE ER STAGING' then
    raise exception
      'Simulationen er låst. Kald sim.arm(''JA - DETTE ER STAGING'') — og kun i staging.';
  end if;

  select count(*) into v_users from auth.users;
  if v_users > p_max_users then
    raise exception
      'Databasen har % brugere (loftet er %). Det ligner ikke staging. Er du sikker, så hæv loftet eksplicit: sim.arm(''JA - DETTE ER STAGING'', %).',
      v_users, p_max_users, v_users;
  end if;

  insert into sim.env (only_row) values (true) on conflict (only_row) do nothing;
  return format('Simulationen er låst op (%s brugere i databasen).', v_users);
end;
$fn$;

create or replace function sim.disarm()
returns text
language sql
as $fn$
  delete from sim.env;
  select 'Simulationen er låst igen. Data er urørt — brug sim.teardown() for at fjerne den.'::text;
$fn$;

create or replace function sim.require_armed()
returns void
language plpgsql
as $fn$
begin
  if not exists (select 1 from sim.env) then
    raise exception
      'Simulationen er låst. Kald sim.arm(''JA - DETTE ER STAGING'') først — og læs hovedet af sql/dev/simulate_season.sql.';
  end if;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 2. Modellen bag tallene
-- ---------------------------------------------------------------------------
-- Både resultater og tips trækkes fra den SAMME generator: hvert hold har en
-- styrke, styrkerne giver et forventet antal mål, og målene trækkes derfra.
-- Forskellen mellem et resultat og et tip er alene, hvor godt brugeren kender
-- styrkerne (`noise`).
--
-- Det er valgt frem for det oplagte — "lad tippet ramme resultatet i X % af
-- tilfældene" — af én grund: dér skal resultatet findes, FØR tippet kan
-- skrives, og så kan tips ikke afgives før en runde spilles. Med to trækninger
-- fra samme model er rækkefølgen ligegyldig, og forskellen mellem brugerne
-- opstår af sig selv: den skarpe rammer flere udfald end den kaotiske, uden at
-- nogen har fået resultatet at vide.

create table if not exists sim.team_strength (
  team_id   uuid primary key,
  strength  double precision not null
);

create table if not exists sim.persona (
  user_id        uuid primary key,
  label          text not null,
  -- Hvor meget brugerens opfattelse af holdene afviger fra virkeligheden.
  -- 0 = ser styrkerne præcis som de er; 0,85 = gætter nærmest i blinde.
  -- Målt på 20.000 kampe giver de tre standardværdier 0,62 / 0,54 / 0,47
  -- point pr. kamp — altså ca. 82 / 71 / 62 point over en 132-kamps sæson,
  -- før participation trækker de to sidste yderligere ned.
  noise          double precision not null,
  -- Hvor stor en andel af kampene brugeren overhovedet tipper på. Under 1
  -- efterlader huller — og huller er den tilstand, halvdelen af appens
  -- skærme skal kunne tåle (manglende tip, delvis runde, "ikke tippet").
  participation  double precision not null
);

-- Knuths algoritme. Loftet på 8 mål er ikke fodbold, det er en bremse: uden
-- det kan en høj lambda i teorien løbe længe.
create or replace function sim.poisson(p_lambda double precision)
returns int
language plpgsql
as $fn$
declare
  v_limit double precision := exp(-greatest(p_lambda, 0.01));
  v_p     double precision := 1;
  v_k     int := 0;
begin
  loop
    v_p := v_p * random();
    exit when v_p <= v_limit or v_k >= 8;
    v_k := v_k + 1;
  end loop;
  return v_k;
end;
$fn$;

-- Et TIP: det forventede antal mål, rundet af, med en usikkerhed der vokser
-- med personaens noise. Se den lange begrundelse i sim.tip() for, hvorfor et
-- tip ikke må trækkes fra samme Poisson som resultatet.
create or replace function sim.tipped_goals(p_lambda double precision, p_noise double precision)
returns int
language sql
as $fn$
  select greatest(0, least(5,
    round(p_lambda + (random() * 2 - 1) * (0.70 + 1.5 * p_noise))::int
  ));
$fn$;

-- Forventede mål for hjemme/ude ud fra to styrker. Hjemmebanefordelen er
-- bagt ind i den første.
create or replace function sim.lambdas(p_home double precision, p_away double precision)
returns double precision[]
language sql
immutable
as $fn$
  select array[
    least(4.5, greatest(0.15, 1.35 * power(p_home / p_away, 0.9) * 1.15)),
    least(4.5, greatest(0.15, 1.15 * power(p_away / p_home, 0.9)))
  ];
$fn$;


-- Lader resten af transaktionen se ud som service_role over for `auth.role()`.
-- Kun `is_local => true`: værdien forsvinder, når transaktionen slutter, og en
-- sætning kørt bagefter i samme editor-fane har den ikke.
create or replace function sim.act_as_service_role()
returns void
language sql
as $fn$
  select set_config('request.jwt.claim.role', 'service_role', true),
         set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select null::void;
$fn$;


-- ---------------------------------------------------------------------------
-- 3. Opslag: simulationens egne rækker
-- ---------------------------------------------------------------------------
-- Ét sted afgør, hvad der er simulationens. Alt andet i filen spørger her, så
-- ingen funktion kan komme til at røre en rigtig turnering.

create or replace function sim.league_id()
returns uuid
language sql
stable
as $fn$
  select id from public.leagues where name = 'SIM-ligaen';
$fn$;

create or replace function sim.season_id()
returns uuid
language sql
stable
as $fn$
  select s.id from public.seasons s where s.league_id = sim.league_id() order by s.created_at limit 1;
$fn$;

create or replace function sim.competition_id()
returns uuid
language sql
stable
as $fn$
  select c.id from public.competitions c where c.season_id = sim.season_id() order by c.created_at limit 1;
$fn$;


-- ---------------------------------------------------------------------------
-- 4. sim.setup() — turnering, kampprogram, liga og konkurrence
-- ---------------------------------------------------------------------------
-- p_teams          antal hold (lige tal). 12 hold = 22 runder = 132 kampe.
-- p_played_rounds  hvor mange runder der skal ligge BAG i dag. Resten ligger
--                  fremme og kan tippes i appen som en almindelig sæson.
--                  ØNSKE, ikke løfte: sæsonen må ikke starte før 1. juli
--                  (fodboldsæsonens skillelinje, se nedenfor), så køres filen
--                  tidligt på sæsonen, bliver tallet mindre — og svaret siger
--                  hvor meget. Vil du have en sæson, der ER spillet færdig,
--                  så brug `sim.play('2030-01-01')` frem for et højt tal her.
-- p_users          brugere, der skal deltage. Null = alle profiler i databasen.
-- p_seed           trækningens frø. Samme frø + samme kald = samme sæson.
--
-- Kampprogrammet er en rigtig dobbeltturnering (cirkelmetoden): hvert hold
-- møder hvert andet hold to gange, én gang hjemme og én gang ude, og spiller
-- præcis én kamp pr. runde. Runden lægges fre–man inden for ÉN tirsdag-mandag-
-- uge, så `matches.round_key` (den genererede kolonne) grupperer den, som
-- appen forventer.

create or replace function sim.setup(
  p_teams          int default 12,
  p_played_rounds  int default 10,
  p_users          uuid[] default null,
  p_seed           double precision default 0.4242,
  p_season_name    text default null
)
returns text
language plpgsql
as $fn$
declare
  v_names text[] := array[
    'Bramslev BK', 'FC Vindmøllen', 'Nørrehavn IF', 'Skovlund FC', 'AC Tørresnor',
    'Havbakken BK', 'FC Grønnegade', 'Østerlund IF', 'Klitmøller FC', 'AC Rugmark',
    'Sønderhøj BK', 'FC Fyrtårnet', 'Vesterå IF', 'Bøgeskov FC', 'AC Malmhøj',
    'Nordkær BK', 'FC Stenbroen', 'Egelund IF', 'Tangmose FC', 'AC Kirkeby'
  ];
  v_slots  int[]  := array[3, 4, 4, 5, 5, 6];                       -- dage efter tirsdag: fre, lør, lør, søn, søn, man
  v_times  time[] := array['19:00', '15:00', '17:30', '14:00', '16:30', '19:00']::time[];

  v_league uuid;
  v_season uuid;
  v_group  uuid;
  v_comp   uuid;
  v_ids    uuid[];
  v_users  uuid[];
  v_owner  uuid;

  v_rounds   int;
  v_first_tue date;
  v_today       date;
  v_this_tue    date;
  v_season_start date;   -- 1. juli i indeværende fodboldsæson
  v_earliest_tue date;
  v_played      int;
  v_kick      timestamptz;
  v_slot      int;
  r int; i int; a int; b int; h int; aw int;
  v_matches int := 0;
begin
  perform sim.require_armed();

  if p_teams % 2 <> 0 or p_teams < 4 or p_teams > array_length(v_names, 1) then
    raise exception 'p_teams skal være et lige tal mellem 4 og %.', array_length(v_names, 1);
  end if;

  if sim.league_id() is not null then
    raise exception 'SIM-ligaen findes allerede. Kør sim.teardown() først, hvis du vil bygge en ny sæson.';
  end if;

  -- Brugerne. Lukkede konti (B4) springes over — de har et pseudonym og skal
  -- ikke stilles op på en resultatliste.
  v_users := coalesce(
    p_users,
    (select array_agg(id order by created_at) from public.profiles where anonymized_at is null)
  );
  if v_users is null or array_length(v_users, 1) is null then
    raise exception 'Ingen brugere at simulere. Opret testbrugerne gennem appen først (docs/STAGING.md trin 4).';
  end if;
  v_owner := v_users[1];

  perform setseed(p_seed);
  update sim.env set seed = p_seed;

  v_rounds := (p_teams - 1) * 2;
  v_today  := (now() at time zone 'Europe/Copenhagen')::date;
  v_this_tue := date_trunc('week', v_today)::date + 1;
  -- Tirsdagen i indeværende uge, minus én uge pr. runde, der skal være spillet.
  v_first_tue := v_this_tue - (p_played_rounds * 7);

  -- SÆSONEN MÅ IKKE KRYDSE 1. JULI, og det er ikke pedanteri.
  --
  -- `award_milestones()` tæller FODBOLDSÆSONER og ikke rækker i `seasons`:
  -- sæsonåret udledes af kampens danske kickoff, hvor juli er skillelinjen
  -- (`sql/milestones.sql`). En sæson, der løber fra maj til oktober, ligger
  -- derfor i TO sæsonår — og med fem tips i hver halvdel udløser den
  -- "To sæsoner med", selv om der kun er spillet én.
  --
  -- Milepælen har ret; kalenderen havde ikke. Med standardopsætningen (10
  -- runder bagud, kørt en dag i august) startede sæsonen i slutningen af maj,
  -- og 30 af 132 kampe landede i det forrige sæsonår. Fundet 7. august 2026 af
  -- en bruger, der undrede sig over et mærke, der ikke passede.
  --
  -- Starten klippes derfor til den første tirsdag i indeværende fodboldsæson.
  -- Det KOSTER runder bagud, når filen køres tidligt på sæsonen — og det er
  -- det rigtige: en rigtig sæson har heller ikke spillet ti runder i august.
  -- Sig det højt i svaret frem for at lade tallet skride i stilhed.
  v_season_start := make_date(
    (case when extract(month from v_today) >= 7 then extract(year from v_today)
          else extract(year from v_today) - 1 end)::int, 7, 1);
  -- Første tirsdag på eller efter 1. juli (0 = søndag, 2 = tirsdag).
  v_earliest_tue := v_season_start + ((2 - extract(dow from v_season_start)::int + 7) % 7);
  if v_first_tue < v_earliest_tue then
    v_first_tue := v_earliest_tue;
  end if;

  -- Hvor mange runder der FAKTISK ligger bag, efter klippet.
  v_played := greatest(0, least(v_rounds, ((v_this_tue - v_first_tue) / 7)));

  -- ---------- liga ----------
  -- `is_official` er sat: kun officielle turneringer tæller i Leagly Rating og
  -- i championshippene (sql/tournament_scope.sql), og det er netop dem,
  -- simulationen skal kunne vise. `live_enabled = false` holder sync-live væk.
  insert into public.leagues (name, api_league_id, provider, live_enabled, is_visible, is_official)
  values ('SIM-ligaen', null, 'sportmonks', false, true, true)
  returning id into v_league;

  insert into public.seasons (league_id, name, api_season_id, start_date, ends_at, is_finished)
  values (
    v_league,
    coalesce(p_season_name, to_char(v_first_tue, 'YYYY') || '/' || to_char(v_first_tue + 300, 'YY') || ' SIM'),
    null,
    v_first_tue + 3,
    v_first_tue + ((v_rounds - 1) * 7) + 6,
    false
  )
  returning id into v_season;

  -- ---------- hold ----------
  for i in 1 .. p_teams loop
    insert into public.teams (league_id, name, api_team_id)
    values (v_league, v_names[i], 'sim:' || i);
  end loop;

  select array_agg(t.id order by t.api_team_id) into v_ids
  from public.teams t where t.league_id = v_league;

  -- Styrkerne fordeles jævnt fra 0,75 til 1,65 og blandes, så tabellen ikke
  -- ender alfabetisk sorteret efter styrke.
  insert into sim.team_strength (team_id, strength)
  select t.id, 0.75 + 0.9 * ((row_number() over (order by random()) - 1)::double precision / (p_teams - 1))
  from public.teams t where t.league_id = v_league;

  -- ---------- personaer ----------
  -- Tre profiler, der gentager sig, hvis der er flere brugere: den skarpe, den
  -- gennemsnitlige og den kaotiske. Participation under 1 er lige så vigtig
  -- som noget andet i filen — den producerer de manglende tips, appen skal
  -- kunne vise.
  for i in 1 .. array_length(v_users, 1) loop
    insert into sim.persona (user_id, label, noise, participation)
    select v_users[i],
           (array['skarp', 'gennemsnitlig', 'kaotisk'])[((i - 1) % 3) + 1],
           (array[0.10, 0.40, 0.85])[((i - 1) % 3) + 1],
           (array[1.00, 0.92, 0.78])[((i - 1) % 3) + 1]
    on conflict (user_id) do update
      set label = excluded.label, noise = excluded.noise, participation = excluded.participation;
  end loop;

  -- ---------- kampprogram (cirkelmetoden) ----------
  for r in 0 .. p_teams - 2 loop
    for i in 0 .. (p_teams / 2) - 1 loop
      if i = 0 then
        a := p_teams - 1;
        b := r;
      else
        a := (r + i) % (p_teams - 1);
        b := (r - i + p_teams - 1) % (p_teams - 1);
      end if;

      -- Skiftevis hjemmebane, så ingen får hele forårets kampe ude.
      if (r + i) % 2 = 0 then h := a; aw := b; else h := b; aw := a; end if;

      v_slot := (i % 6) + 1;
      v_kick := ((v_first_tue + (r * 7) + v_slots[v_slot])::timestamp + v_times[v_slot])
                at time zone 'Europe/Copenhagen';

      insert into public.matches
        (season_id, home_team_id, away_team_id, kickoff_at, status, api_fixture_id, stage_name)
      values
        (v_season, v_ids[h + 1], v_ids[aw + 1], v_kick, 'scheduled',
         'sim:' || lpad((r + 1)::text, 2, '0') || ':' || (i + 1), 'Grundspil');

      -- Returkampen, én halvsæson senere, med byttet hjemmebane.
      v_kick := ((v_first_tue + ((r + p_teams - 1) * 7) + v_slots[v_slot])::timestamp + v_times[v_slot])
                at time zone 'Europe/Copenhagen';

      insert into public.matches
        (season_id, home_team_id, away_team_id, kickoff_at, status, api_fixture_id, stage_name)
      values
        (v_season, v_ids[aw + 1], v_ids[h + 1], v_kick, 'scheduled',
         'sim:' || lpad((r + p_teams)::text, 2, '0') || ':' || (i + 1), 'Grundspil');

      v_matches := v_matches + 2;
    end loop;
  end loop;

  -- ---------- liga (fællesskabet) og konkurrence ----------
  insert into public.groups (name, created_by) values ('SIM-ligaen', v_owner) returning id into v_group;
  insert into public.group_members (group_id, user_id, role) values (v_group, v_owner, 'admin')
    on conflict do nothing;

  -- `awards: true` slår de lokale kåringer til (A22) — ellers ville en
  -- gennemspillet sæson mangle netop den halvdel af historikken.
  insert into public.competitions (name, league_id, season_id, mode, mode_params, group_id, created_by)
  values ('SIM-sæsonen', v_league, v_season, 'full_season', '{"awards": true}'::jsonb, v_group, v_owner)
  returning id into v_comp;

  -- Triggeren competition_participants_ensure_group melder dem ind i ligaen.
  insert into public.competition_participants (competition_id, user_id)
  select v_comp, u from unnest(v_users) u
  on conflict do nothing;

  insert into public.competition_matches (competition_id, match_id)
  select v_comp, m.id from public.matches m where m.season_id = v_season;

  return format(
    'SIM-ligaen oprettet: %s hold, %s runder, %s kampe (%s → %s). %s deltagere. %s runder ligger bag i dag%s. Næste skridt: select sim.season();',
    p_teams, v_rounds, v_matches, v_first_tue + 3, v_first_tue + ((v_rounds - 1) * 7) + 6,
    array_length(v_users, 1), v_played,
    case when v_played < p_played_rounds
      then format(' (du bad om %s — sæsonen er klippet til fodboldsæsonens start %s, så den ikke krydser 1. juli og tælles som to sæsoner)',
                  p_played_rounds, v_first_tue)
      else '' end
  );
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 5. sim.tip() — tips
-- ---------------------------------------------------------------------------
-- Skriver KUN tips, der mangler (`on conflict do nothing`). Dine egne tips
-- afgivet i appen bliver derfor stående, uanset hvor mange gange du kalder.
--
-- p_until  seneste kickoff, der tippes på. Null = hele sæsonen.

create or replace function sim.tip(p_until timestamptz default null)
returns int
language plpgsql
as $fn$
declare
  v_season uuid := sim.season_id();
  v_before int;
  m record;
  p record;
  v_sh double precision;
  v_sa double precision;
  v_lam double precision[];
begin
  perform sim.require_armed();
  if v_season is null then
    raise exception 'Ingen SIM-sæson. Kør sim.setup() først.';
  end if;

  -- Eget frø, så tips-trækningen ikke løber i takt med resultat-trækningen.
  perform setseed(((((select seed from sim.env) * 7 + 0.13)::numeric % 1))::double precision);

  -- Tælles som en forskel og ikke som antal forsøg: `do nothing` betyder, at
  -- brugeren allerede HAR tippet — fx i appen — og det er ikke et nyt tip.
  select count(*) into v_before
  from public.predictions p2 join public.matches m2 on m2.id = p2.match_id
  where m2.season_id = v_season;

  for m in
    select mt.id, mt.kickoff_at, mt.home_team_id, mt.away_team_id,
           sh.strength as s_home, sa.strength as s_away
    from public.matches mt
    join sim.team_strength sh on sh.team_id = mt.home_team_id
    join sim.team_strength sa on sa.team_id = mt.away_team_id
    where mt.season_id = v_season
      and (p_until is null or mt.kickoff_at <= p_until)
    order by mt.kickoff_at, mt.id
  loop
    for p in select * from sim.persona order by user_id loop
      continue when random() > p.participation;

      -- Brugerens opfattelse af de to hold: den rigtige styrke ganget med en
      -- fejl, der vokser med personaens noise.
      v_sh := m.s_home * exp(p.noise * (random() * 2 - 1) * 2.0);
      v_sa := m.s_away * exp(p.noise * (random() * 2 - 1) * 2.0);
      v_lam := sim.lambdas(v_sh, v_sa);

      -- Tippet trækkes IKKE som resultatet. Et resultat er en Poisson-trækning
      -- — kampe er tilfældige — mens et menneske tipper det, det FORVENTER, og
      -- lander derfor tæt på middelværdien: 2-1 til det stærke hjemmehold, ikke
      -- 4-0. Netop dén forskel er grunden til, at ingen rammer eksakt særlig
      -- ofte, uanset hvor godt de kender holdene.
      --
      -- Trak vi tippet fra samme Poisson som resultatet, ville trækningens egen
      -- støj overdøve personaen fuldstændig, og den skarpe ville ramme lige så
      -- sjældent som den kaotiske. Målt: 43 % mod 35 % udfald — altså ingen
      -- forskel, der kan ses i en tabel.

      -- updated_at bagdateres til dagene før kampen. Feltet er analytics'
      -- aktivitetsmål (G13), og et tip afgivet "nu" på en kamp fra marts ville
      -- gøre hele tragten forkert. Triggeren rører kun UPDATE, så en INSERT
      -- med værdi bliver stående.
      insert into public.predictions (user_id, match_id, pred_home, pred_away, updated_at)
      values (
        p.user_id, m.id,
        sim.tipped_goals(v_lam[1], p.noise),
        sim.tipped_goals(v_lam[2], p.noise),
        m.kickoff_at - make_interval(hours => (12 + floor(random() * 108))::int)
      )
      on conflict (user_id, match_id) do nothing;
    end loop;
  end loop;

  return (
    select count(*)::int - v_before
    from public.predictions p2 join public.matches m2 on m2.id = p2.match_id
    where m2.season_id = v_season
  );
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 6. sim.play() — resultater
-- ---------------------------------------------------------------------------
-- Afgør runderne ÉN AD GANGEN, og det er med vilje: statement-triggeren på
-- `matches` kalder både `recompute_ratings()` og `generate_stories()`, og
-- sidstnævnte skriver kort for den runde, der lige blev ændret. Afgjorde vi
-- hele sæsonen i én update, ville stillingen og ratingen ende det rigtige
-- sted, men historikken — rundevindere, historier, kåringer — ville bestå af
-- ét eneste øjeblik.
--
-- p_until  seneste kickoff, der afgøres. Standard: nu.

create or replace function sim.play(p_until timestamptz default now())
returns int
language plpgsql
as $fn$
declare
  v_season uuid := sim.season_id();
  v_total  int  := 0;
  v_round  date;
  v_rows   int;
begin
  perform sim.require_armed();
  if v_season is null then
    raise exception 'Ingen SIM-sæson. Kør sim.setup() først.';
  end if;

  perform setseed(((((select seed from sim.env) * 13 + 0.37)::numeric % 1))::double precision);

  loop
    select min(m.round_key) into v_round
    from public.matches m
    where m.season_id = v_season
      and m.home_score is null
      and m.kickoff_at <= p_until;

    exit when v_round is null;

    with lam as (
      select m.id,
             sim.lambdas(sh.strength, sa.strength) as l
      from public.matches m
      join sim.team_strength sh on sh.team_id = m.home_team_id
      join sim.team_strength sa on sa.team_id = m.away_team_id
      where m.season_id = v_season
        and m.round_key = v_round
        and m.home_score is null
        and m.kickoff_at <= p_until
    ), drawn as (
      select id, sim.poisson(l[1]) as h, sim.poisson(l[2]) as a from lam
    )
    update public.matches m
       set home_score = d.h,
           away_score = d.a,
           status     = 'finished',
           updated_at = greatest(m.kickoff_at + interval '105 minutes', now() - interval '1 minute')
      from drawn d
     where m.id = d.id;

    get diagnostics v_rows = row_count;
    -- Ingen rækker betyder, at runden ikke kunne afgøres — uden denne udgang
    -- ville løkken vælge den samme runde igen og køre for evigt.
    exit when v_rows = 0;
    v_total := v_total + v_rows;

    -- Rundens milepæle, dateret til rundens sidste dag kl. 22 dansk tid — altså
    -- kort efter at søndagens sidste kamp er fløjtet af. Se sim.award_milestones_at().
    perform sim.award_milestones_at(((v_round + 6)::timestamp + time '22:00') at time zone 'Europe/Copenhagen');
  end loop;

  -- Kåringerne skrives normalt lazy, når nogen åbner konkurrencens board
  -- (A22). Her tvinges de frem, så en gennemspillet sæson faktisk HAR sine
  -- ugers og måneders vindere.
  --
  -- Guarden i `award_competition_periods()` kræver `auth.role() =
  -- 'service_role'` eller en deltager i `auth.uid()`. Ingen af de to funktioner
  -- kender en session i SQL-editoren — de læser JWT'ens claims fra en GUC, og
  -- den er tom. Derfor sættes claims'ene her, `is_local => true`, så de gælder
  -- denne ene transaktion og ikke et minut længere. Begge former sættes:
  -- Supabase har haft `request.jwt.claim.<felt>` og `request.jwt.claims`
  -- (hele objektet) på skift, og hvilken af dem `auth.role()` læser, afhænger
  -- af projektets alder.
  perform sim.act_as_service_role();
  begin
    perform public.award_competition_periods(sim.competition_id());
  exception when others then
    raise notice 'Kåringerne kunne ikke skrives (%). Åbn konkurrencen i appen — så skrives de af sig selv.', sqlerrm;
  end;

  -- Er der ikke flere kampe tilbage, meldes SÆSONEN færdig — og det er ikke
  -- pyntning, det er det skridt, der afgør, om konkurrencen kan afsluttes.
  --
  -- `competition_status` (sql/season_end.sql) kræver mere end "alle kampe har
  -- resultat" for en konkurrence, der kan vokse: sæsonen skal selv sige, at den
  -- er slut — via `is_finished`, via `ends_at < current_date`, eller via
  -- 30-dages-ventilen. Reglen findes for at lukke Superliga-hullet, hvor
  -- slutspillet først skemalægges til foråret, så sæsonen SER færdig ud imens.
  --
  -- Simulationen har præcis samme hul: med standardopsætningen ligger `ends_at`
  -- i fremtiden, så en gennemspillet sæson stod som 132/132 spillet og alligevel
  -- ikke afsluttet — for evigt. (Fundet 6. august 2026 af den første, der spillede
  -- en sæson færdig i staging og spurgte hvorfor pokalen udeblev.)
  --
  -- Her er simulationen selv datakilden, så den gør dét, `fetchSeasonMeta()` i
  -- syncen gør: sætter flaget og trækker `ends_at` tilbage til den sidste kamp,
  -- der faktisk blev spillet. Kun ÉN vej — at åbne en sæson igen er en bevidst
  -- handling, jf. samme fil, og den bor i `sim.finish_season(false)`.
  if not exists (
    select 1 from public.matches
    where season_id = v_season and home_score is null
  ) then
    perform sim.finish_season(true);
  end if;

  -- Sidste kald, og det er ikke overflødigt: milepælene for en AFSLUTTET
  -- konkurrence (pokal, podie) læser `competition_status`, som først blev sand
  -- lige ovenfor. Dateres til den sidste kamp, der er spillet — ikke til nu,
  -- for i simulationens tidsregning er det dér, sæsonen sluttede.
  perform sim.award_milestones_at(coalesce(
    (select max(kickoff_at) + interval '105 minutes'
     from public.matches where season_id = v_season and home_score is not null),
    now()
  ));

  return v_total;
end;
$fn$;


-- Milepæle, dateret til det øjeblik, de blev opnået.
--
-- `award_milestones()` er en BATCH-genberegning: den ser på alt, brugeren har
-- gjort, og indsætter det, der mangler — med `achieved_at` = `now()`. Kaldes den
-- én gang til sidst, får en hel sæsons bedrifter derfor ét og samme tidsstempel,
-- og alt, der sorterer på det, får ingenting at sortere efter. Målt: 15
-- milepæle, ét distinkt tidsstempel — og karusellen på Hjem viste da tre
-- vilkårlige af dem, hvoraf de to var "Du oprettede din første liga/konkurrence".
--
-- Derfor kaldes den ÉN GANG PR. RUNDE, og de rækker, kaldet lige har lagt ind,
-- dateres til rundens sidste søndag aften. Så ligner testdataene en sæson, der
-- er levet igennem, frem for en, der blev regnet ud på ét sekund.
create or replace function sim.award_milestones_at(p_when timestamptz)
returns int
language plpgsql
as $fn$
declare
  -- `now()` og IKKE `clock_timestamp()`, og det er hele finten.
  --
  -- `milestones.achieved_at` har `default now()`, og `now()` er TRANSAKTIONENS
  -- starttidspunkt — ikke urets. Hele `select sim.play(...)` er én transaktion,
  -- så hver eneste række, `award_milestones()` indsætter undervejs, får samme
  -- værdi: transaktionens start. Et mærke sat med `clock_timestamp()` ligger
  -- DERFOR EFTER de rækker, det skulle fange, og `where achieved_at >= v_mark`
  -- rammer nul rækker — tavst. (Ramt her, og symptomet var, at alle 15
  -- milepæle stadig delte én dato efter en runde-for-runde-kørsel.)
  v_mark timestamptz := now();
  v_rows int := 0;
begin
  begin
    perform public.award_milestones();
    -- Lighed og ikke `>=`: en tidligere rundes rækker er allerede dateret VÆK
    -- fra `now()`, så de går fri — og en runde, der ligger i FREMTIDEN (spiller
    -- man hele sæsonen med `sim.play('2030-01-01')`, slutter de sidste runder
    -- efter i dag), ville med `>=` blive fanget igen og omdateret ved næste
    -- gennemløb.
    update public.milestones
       set achieved_at = p_when
     where achieved_at = v_mark;
    get diagnostics v_rows = row_count;
  exception when others then
    raise notice 'Mærkerne kunne ikke skrives (%).', sqlerrm;
  end;
  return v_rows;
end;
$fn$;


-- Sæsonens slutning. `sim.play()` sætter den selv, når sidste kamp er spillet;
-- denne findes for den anden retning og for at kunne fremkalde tilstanden
-- "sæsonen er slut, men kampene er ikke spillet færdige" i hånden.
--
-- Modsvarer `admin_set_season_finished()` i produktet (Admin → Drift), som af
-- samme grund tillader begge veje: en sæson lukket ved en fejl skal kunne åbnes
-- igen, og en fejl, der kun kan rettes i databasekonsollen, bliver ikke rettet.
create or replace function sim.finish_season(p_finished boolean default true)
returns text
language plpgsql
as $fn$
declare
  v_season uuid := sim.season_id();
  v_last   date;
begin
  perform sim.require_armed();
  if v_season is null then
    raise exception 'Ingen SIM-sæson. Kør sim.setup() først.';
  end if;

  -- Slutdatoen sættes efter de kampe, der FINDES, og ikke efter den plan,
  -- sæsonen blev oprettet med. De to er kun ens, når hele sæsonen er spillet.
  select max((kickoff_at at time zone 'Europe/Copenhagen')::date) into v_last
  from public.matches where season_id = v_season;

  update public.seasons
     set is_finished = p_finished,
         ends_at     = case when p_finished then v_last else ends_at end
   where id = v_season;

  return case
    when p_finished then format('SIM-sæsonen er meldt færdig (ends_at = %s). Konkurrencen kan nu afsluttes.', v_last)
    else 'SIM-sæsonen er åbnet igen (is_finished = false).'
  end;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 7. sim.advance() / sim.season() — de to måder at bruge det på
-- ---------------------------------------------------------------------------
-- sim.advance(n): tipper og afgør de næste n runder, uanset hvad klokken er.
-- Det er "lad der gå en uge"-knappen — brug den, når det er FORLØBET, du vil
-- se: en rating, der bevæger sig, historier der afløser hinanden, en
-- rundevinder pr. uge.

create or replace function sim.advance(p_rounds int default 1)
returns text
language plpgsql
as $fn$
declare
  v_season uuid := sim.season_id();
  v_round  date;
  v_last   timestamptz;
  v_played int := 0;
  v_tips   int := 0;
  i int;
begin
  perform sim.require_armed();
  if v_season is null then
    raise exception 'Ingen SIM-sæson. Kør sim.setup() først.';
  end if;

  for i in 1 .. p_rounds loop
    select min(m.round_key) into v_round
    from public.matches m where m.season_id = v_season and m.home_score is null;
    exit when v_round is null;

    select max(m.kickoff_at) into v_last
    from public.matches m where m.season_id = v_season and m.round_key = v_round;

    -- Tips først, resultater bagefter — samme rækkefølge som virkeligheden,
    -- selv om modellen ikke kræver det.
    v_tips   := v_tips + sim.tip(v_last);
    v_played := v_played + sim.play(v_last);
  end loop;

  return format('%s runder afgjort (%s kampe), %s tips skrevet.', p_rounds, v_played, v_tips);
end;
$fn$;

-- sim.season(): hele sæsonen frem til i dag, runde for runde. Brugerne har
-- tippet p_tip_ahead runder frem, så de kommende runder ikke er tomme — men
-- resten af sæsonen står åben, så du selv kan tippe i appen.

create or replace function sim.season(p_tip_ahead int default 1)
returns text
language plpgsql
as $fn$
declare
  v_season uuid := sim.season_id();
  v_cut    timestamptz;
  v_tips   int;
  v_played int;
begin
  perform sim.require_armed();
  if v_season is null then
    raise exception 'Ingen SIM-sæson. Kør sim.setup() først.';
  end if;

  -- Grænsen for, hvor langt frem der er tippet. `round_key` er rundens
  -- tirsdag, og runden slutter mandagen efter — så tirsdagen efter DEN sidste
  -- runde, der skal tippes, er en ren og eksakt grænse.
  select min(m.round_key) + ((p_tip_ahead + 1) * 7) into v_cut
  from public.matches m
  where m.season_id = v_season and m.kickoff_at > now();

  v_tips   := sim.tip(coalesce(v_cut, now()));
  v_played := sim.play(now());

  return format('%s tips skrevet, %s kampe afgjort. select * from sim.status();', v_tips, v_played);
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 8. sim.status() — hvad står der nu
-- ---------------------------------------------------------------------------

create or replace function sim.status()
returns table (nøgletal text, værdi text)
language sql
as $fn$
  with s as (select sim.season_id() as season_id, sim.competition_id() as comp_id),
  rows as (
    select 1 as ord, 'Sæson'::text as k, coalesce((select name from public.seasons where id = (select season_id from s)), '— ingen, kør sim.setup()')::text as v
    union all
    select 2, 'Kampe i alt', (select count(*)::text from public.matches where season_id = (select season_id from s))
    union all
    select 3, 'Heraf afgjort', (select count(*)::text from public.matches where season_id = (select season_id from s) and home_score is not null)
    union all
    select 4, 'Runder afgjort', (select count(distinct round_key)::text from public.matches where season_id = (select season_id from s) and home_score is not null)
    union all
    select 5, 'Tips', (select count(*)::text from public.predictions p join public.matches m on m.id = p.match_id where m.season_id = (select season_id from s))
    union all
    select 6, 'Deltagere', (select count(*)::text from public.competition_participants where competition_id = (select comp_id from s))
    union all
    select 7, 'Kåringer', (select count(*)::text from public.competition_awards where competition_id = (select comp_id from s))
    union all
    select 8, 'Historier', (select count(*)::text from public.stories where competition_id = (select comp_id from s))
    union all
    -- Den række, der besvarer "hvorfor er konkurrencen ikke færdig?". Begge
    -- halvdele skal være sande, og det er sjældent den første, der mangler.
    select 9, 'Afsluttet', (
      select case
        when cs.concluded then 'ja'
        -- Rækkefølgen på de to råd er ikke tilfældig: mangler der kampe, er det
        -- dem, der skal spilles, og sæson-flaget følger så af sig selv.
        when cs.scored_matches < cs.matches then
          format('nej — %s af %s kampe spillet. Kør sim.advance(n) eller sim.play(''2030-01-01'')',
                 cs.scored_matches, cs.matches)
        else
          'nej — alle kampe er spillet, men sæsonen står som i gang. Kør sim.finish_season()'
      end
      from public.competition_status cs where cs.competition_id = (select comp_id from s)
    )
    union all
    -- Stillingen sorteret som appen sorterer den (sql/standings_tiebreakers.sql):
    -- point, så eksakte, så mållinjen.
    select 10 + row_number() over (order by st.total_points desc, st.exact_count desc, st.avg_goal_error),
           'Stilling · ' || pr.display_name,
           format('%s point på %s kampe (%s eksakte, %s rundesejre) · rating %s',
                  st.total_points, st.matches, st.exact_count, st.round_wins,
                  coalesce(round(r.rating)::text, '—'))
    from public.season_standings st
    join public.profiles pr on pr.id = st.user_id
    left join public.ratings r on r.user_id = st.user_id and r.scope = 'ALL'
    where st.season_id = (select season_id from s)
  )
  select k, v from rows order by ord;
$fn$;


-- ---------------------------------------------------------------------------
-- 9. sim.teardown() — sporløst væk
-- ---------------------------------------------------------------------------
-- Rækkefølgen er ikke fri: `competitions` peger på liga og sæson UDEN cascade,
-- og `matches` peger på `teams` uden cascade. Konkurrencen først, kampene før
-- holdene, ligaen til sidst. Alt andet (tips, competition_matches, deltagere,
-- kåringer, historier) hænger i cascades og følger med af sig selv.

create or replace function sim.teardown(p_reset_derived boolean default true)
returns text
language plpgsql
as $fn$
declare
  v_league uuid := sim.league_id();
  v_season uuid := sim.season_id();
  v_comp   uuid := sim.competition_id();
  v_group  uuid;
  v_matches int := 0;
  v_keys    text[];
begin
  perform sim.require_armed();
  if v_league is null then
    return 'Der er ingen SIM-liga at fjerne.';
  end if;

  select group_id into v_group from public.competitions where id = v_comp;
  select count(*) into v_matches from public.matches where season_id = v_season;
  -- `stories.round_key` er TEXT, mens `matches.round_key` er DATE — de to
  -- typer er §17's egen fælde. Nøglerne samles derfor som tekst, og BÅDE
  -- rundens tirsdag og kampdagen kommer med: dagskortene (`period = 'day'`)
  -- bruger match_day som nøgle.
  select array_agg(distinct k) into v_keys from (
    select round_key::text as k from public.matches where season_id = v_season
    union
    select match_day::text  from public.matches where season_id = v_season
  ) x;

  delete from public.competitions where id = v_comp;
  delete from public.matches where season_id = v_season;   -- triggeren regner rating om
  delete from sim.team_strength where team_id in (select id from public.teams where league_id = v_league);
  delete from public.teams where league_id = v_league;
  delete from public.seasons where league_id = v_league;
  delete from public.leagues where id = v_league;
  delete from public.groups where id = v_group;
  delete from sim.persona;

  -- To slags AFLEDTE rækker overlever kaskaderne, fordi de ikke peger på
  -- konkurrencen: historier uden `competition_id` (rating- og månedskortene)
  -- og mærker. Begge er beregnede — de kan slettes og regnes om, og gør man
  -- ikke det, står der kort og mærker tilbage om en sæson, der ikke findes.
  --
  -- `p_reset_derived => false` springer det over. Det eneste, gen-beregningen
  -- koster, er mærkernes "opnået"-tidsstempel, som bliver nyt.
  if p_reset_derived then
    delete from public.stories where competition_id is null and round_key = any (v_keys);
    delete from public.milestones;
    begin
      perform public.award_milestones();
    exception when others then
      raise notice 'Mærkerne kunne ikke regnes om (%).', sqlerrm;
    end;
  end if;

  return format('SIM-ligaen fjernet (%s kampe, alle tips og afledte rækker). Rating er regnet om.', v_matches);
end;
$fn$;

-- Genstart uden at skulle huske to kald.
create or replace function sim.reset(
  p_teams int default 12,
  p_played_rounds int default 10,
  p_users uuid[] default null,
  p_seed double precision default 0.4242
)
returns text
language plpgsql
as $fn$
begin
  perform sim.require_armed();
  perform sim.teardown();
  return sim.setup(p_teams, p_played_rounds, p_users, p_seed);
end;
$fn$;
