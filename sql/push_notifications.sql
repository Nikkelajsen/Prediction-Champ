-- Push-notifikationer: tabeller til Web Push-abonnementer og udsendelses-log.
-- Idempotent — kan køres igen når som helst (kør med "Run without RLS",
-- scriptet sætter selv RLS på, jf. DOCUMENTATION.md afsnit 14).

-- Én række pr. browser/enhed, der har slået notifikationer til.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_own" on public.push_subscriptions;
create policy "push_subscriptions_own"
  on public.push_subscriptions
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

-- Log over sendte beskeder, så samme besked aldrig sendes to gange.
--
-- KEY-FORMAT (rettet august 2026, G12 — beskrivelsen her var forkert):
--   'deadline:<dato>'          maks. én påmindelse pr. bruger pr. DAG
--   'result:<round_key>'       rundens resultat, én pr. runde
--   'newcomp:<competition_id>' ny konkurrence i din liga (B5)
--
-- Deadline-nøglen stod her som 'deadline:<round_key>:<dato>', hvilket koden
-- aldrig har skrevet. Nøglen ER dedup-garantien, så en forkert beskrivelse af
-- den er en fælde for enhver, der regner baglæns fra kommentaren: man ville tro,
-- der kunne sendes én påmindelse pr. runde pr. dag, og med `A21`s per-kamp-lås
-- er en runde i gang i dagevis. Den kanoniske kilde er
-- api/send-notifications.js; analytics_dashboard.sql beskriver den korrekt.
--
-- Ingen policies: kun serverfunktionen (service role) læser/skriver.
create table if not exists public.notification_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.notification_log enable row level security;
