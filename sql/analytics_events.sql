-- Leagly — Analytics v1: hændelseslog (skrive-siden)
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
-- Spec: docs/features/analytics-v1.md
--
-- Formål: ét internt hændelseskatalog til produktforbedring (ikke marketing),
-- der besvarer: bruger folk appen hver uge? glemmer de at tippe? hvilke ligaer
-- er mest aktive? hvilke funktioner bruges faktisk? hvor mister vi brugere?
-- Læse-siden (views + aggregerede RPC'er til admin-dashboardet) ligger i
-- sql/analytics_dashboard.sql — bevidst en SEPARAT fil, fordi den forventes
-- gen-kørt jævnligt (Health Score-vægte tunes over tid, som Story Engines
-- tærskler blev det i v1.1), mens denne fil rammer produktionsdata og ikke
-- skal gen-køres uden grund.
--
-- Navngivning (vigtigt — læs før du redigerer): kolonnen hedder `group_id`,
-- IKKE `league_id`. I dette skema betyder "liga" i UI'et `public.groups`
-- (fællesskabet, liga-laget), mens `league_id` allerede betyder en Sportmonks-
-- fodboldturnering (`public.leagues`). At kalde denne kolonne `league_id` og
-- pege den på `groups` ville genindføre den tvetydighed, liga-laget (juli
-- 2026) fjernede fra resten af skemaet.
--
-- Bevidst UDELADT af kataloget (udledte, ikke logget — se docs/features/analytics-v1.md §3):
--   prediction_locked  — beregnes fra predictions/matches/rundelåsen (analytics_dashboard.sql)
--   story_generated    — findes allerede som én række pr. historie i public.stories
--   push_sent          — findes allerede som én række pr. besked i public.notification_log
-- At logge dem ville enten kræve at redigere generate_stories() i
-- sql/story_engine.sql for ingen ny information, eller duplikere notification_log.
--
-- Ydelseskontrakt: klienten skriver ALTID fire-and-forget (aldrig awaited på en
-- måde der blokerer UI, alle fejl svælges stille — se src/lib/analytics.js).
-- Denne tabel er derfor lossy by design og må ALDRIG bruges til noget en bruger
-- kan bestride; North Star-KPI'en (Prediction Completion Rate) beregnes altid
-- direkte fra public.predictions, ikke fra denne log.

create table if not exists public.analytics_events (
  id             uuid primary key default gen_random_uuid(),
  event_name     text not null,
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  group_id       uuid references public.groups(id) on delete set null,
  competition_id uuid references public.competitions(id) on delete set null,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

-- user_id: klienten sender ALDRIG denne kolonne — defaulten ejer den, så den
-- hverken kan forfalskes eller glemmes i et kaldested. on delete cascade:
-- sletter en bruger sin konto, forsvinder også dens spor (samme regel som
-- user_activity_days/push_subscriptions/notification_log).
--
-- group_id/competition_id: on delete SET NULL (modsat user_id). Slettes en
-- liga eller konkurrence, er "der var 400 story-views i juli" stadig sandt
-- som aggregat — kun attributionen til den nu-slettede række mistes.

-- ---------- Hændelseskatalog (check-constraint) ----------
-- RLS tillader enhver autentificeret bruger at indsætte frit (se nedenfor), så
-- ordforrådet skal håndhæves et sted, ellers rådner det stille (tastefejl, et
-- omdøbt event i det ene af to kaldesteder). Idempotent drop+add: en gen-kørsel
-- validerer automatisk eksisterende rækker mod den (evt. nye) liste og fejler
-- højlydt, hvis et navn er fjernet, mens rækker stadig bruger det.
--
-- "opened_story" er reserveret men IKKE udsendt i v1 — der findes endnu ingen
-- selvstændig story-drilldown (kortet lever inline på Hjem; story_viewed er
-- dens impression). At reservere navnet nu koster intet og undgår en
-- constraint-migrering den dag en detaljevisning tilføjes.
alter table public.analytics_events drop constraint if exists analytics_events_name_check;
alter table public.analytics_events add constraint analytics_events_name_check
  check (event_name in (
    -- Account
    'account_created', 'login', 'logout',
    -- Liga
    'league_created', 'league_joined', 'league_invite_sent', 'league_invite_accepted',
    -- Konkurrence
    'competition_created', 'competition_joined', 'competition_opened',
    -- Tip
    'prediction_started', 'prediction_saved', 'prediction_updated', 'prediction_submitted',
    -- Navigation
    'opened_home', 'opened_tip', 'opened_league', 'opened_standings', 'opened_rating',
    'opened_career', 'opened_story', 'opened_championship',
    -- Story Engine
    'story_viewed', 'story_shared',
    -- Story Engine v3: nyhedsværdien, rundestoryens frames og milepæls-CTA'en.
    -- `story_score_distribution` er ekkoet af det SETE og dermed lossy som alt
    -- andet her; den tabsfri fordeling, tærsklen skal kalibreres på (A35), bor i
    -- stories.news_value og aflæses i SQL.
    'story_score_distribution', 'story_frame_viewed', 'milestone_cta_clicked',
    -- Notifikationer
    'push_opened'
  ));

-- ---------- Indekser ----------
-- Hver er bundet til en konkret forespørgsel, admin_analytics_dashboard.sql
-- faktisk kører — ikke tilføjet spekulativt.
create index if not exists analytics_events_name_time_idx
  on public.analytics_events (event_name, created_at desc);

create index if not exists analytics_events_user_time_idx
  on public.analytics_events (user_id, created_at);

-- Partial: kun den mindretal af rækker, der reelt har en liga (story_viewed på
-- en konkurrence i en liga m.fl.), skal scannes for Liga Health-aggregeringen.
create index if not exists analytics_events_group_time_idx
  on public.analytics_events (group_id, created_at desc)
  where group_id is not null;

-- Bevidst INGEN indeks på competition_id alene: ingen dashboard-sektion
-- grupperer på konkurrence for sig (North Star pr. konkurrence læses fra
-- analytics_completion_facts/predictions, ikke fra event-loggen). Tilføj kun,
-- hvis en fremtidig sektion faktisk får brug for det.

-- ---------- RLS ----------
alter table public.analytics_events enable row level security;

-- Kun INSERT, kun egne rækker. INGEN select/update/delete-policy til
-- almindelige brugere — hændelsesstrømmen er internt data, kun læsbar via de
-- admin-gatede RPC'er i sql/analytics_dashboard.sql. Derfor skal klientens
-- insert bruge `Prefer: return=minimal`: `return=representation` kræver
-- SELECT-ret, som ingen policy her giver.
drop policy if exists analytics_events_insert_own on public.analytics_events;
create policy analytics_events_insert_own on public.analytics_events
  for insert
  to authenticated
  with check (user_id = auth.uid());

revoke all on public.analytics_events from anon;
grant insert on public.analytics_events to authenticated;

-- ---------- Oprydning ----------
-- **RETTET 7. august 2026 (`G77`).** Her stod, at rydningen var manuel — "kør i
-- hånden med jævne mellemrum (fx en gang om året)" — og at der bevidst ikke
-- fandtes noget planlagt job. Første halvdel var det samme som `docs/CRON.md`
-- skrev om `prune_job_runs()` før `G43`: en rydning, ingen udførte.
--
-- Rydningen bor nu i `sql/analytics_retention.sql` som
-- `prune_analytics_events(18)` og kaldes af `.github/workflows/job-heartbeat.yml`
-- ved siden af `prune_job_runs(30)` og `prune_client_errors(90)`. Arkitekturvalg
-- #3 er uændret: der er **intet nyt planlagt job** — kun ét udsagn mere i et,
-- der kører i forvejen.

-- ---------- Verifikation efter kørsel ----------
-- 1) Tabellen findes, har præcis én policy, og en almindelig bruger kan
--    hverken læse andres rækker eller sine egne via SELECT:
--      select policyname, cmd from pg_policies where tablename = 'analytics_events';
--      -- forventet: 1 række, cmd = INSERT
-- 2) Som en almindelig (ikke-admin) bruger:
--      select count(*) from public.analytics_events;  -- forventet: fejler eller giver 0 rækker
