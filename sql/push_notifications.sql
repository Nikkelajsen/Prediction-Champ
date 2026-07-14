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
-- key-format: 'deadline:<round_key>:<dato>' eller 'result:<round_key>'.
-- Ingen policies: kun serverfunktionen (service role) læser/skriver.
create table if not exists public.notification_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.notification_log enable row level security;
