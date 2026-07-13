-- Prediction Champ — Brugerstatistik & aktivitets-sporing
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS"
-- (scriptet sætter selv RLS på de tabeller, der skal have det).
--
-- Tilføjer:
--   * tidsstempler på profiles (created_at + last_seen_at)
--   * tabellen user_activity_days (én række pr. bruger pr. aktiv dag)
--   * touch_activity()   — kaldes ved app-start, registrerer dagens aktivitet
--   * admin_user_stats()  — aggregeret statistik, kun for admins
--
-- Kan køres igen når som helst (fx efter skemaændringer).

-- ---------- 1. Tidsstempler på profiles ----------
alter table public.profiles add column if not exists created_at  timestamptz;
alter table public.profiles add column if not exists last_seen_at timestamptz;

-- Backfill created_at fra auth.users (SQL-editoren kører som owner og kan læse auth-skemaet).
update public.profiles p
set    created_at = u.created_at
from   auth.users u
where  p.id = u.id
  and  p.created_at is null;

-- Nye profiler får automatisk created_at fremover.
alter table public.profiles alter column created_at set default now();

-- ---------- 2. Aktive dage (én række pr. bruger pr. dag) ----------
-- Holder besøgsfrekvens uden ubegrænset vækst: maks. én række pr. bruger pr. dag.
create table if not exists public.user_activity_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null default (now() at time zone 'utc')::date,
  primary key (user_id, day)
);

-- RLS slået til UDEN policies -> ingen direkte adgang via publishable/authenticated.
-- Data læses/skrives kun via security definer-funktionerne nedenfor.
alter table public.user_activity_days enable row level security;

-- ---------- 3. touch_activity(): registrér at brugeren er inde ----------
create or replace function public.touch_activity()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  update public.profiles
    set last_seen_at = now()
    where id = auth.uid();

  insert into public.user_activity_days (user_id, day)
  values (auth.uid(), (now() at time zone 'utc')::date)
  on conflict (user_id, day) do nothing;
end;
$$;

grant execute on function public.touch_activity() to authenticated;

-- ---------- 4. admin_user_stats(): aggregeret statistik (kun admins) ----------
create or replace function public.admin_user_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today  date := (now() at time zone 'utc')::date;
  result jsonb;
begin
  -- Kun admins må se statistik om alle brugere.
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    -- Brugere
    'total',   (select count(*) from public.profiles),
    'new_7d',  (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
    'new_30d', (select count(*) from public.profiles where created_at >= now() - interval '30 days'),

    -- Aktivitet
    'dau', (select count(distinct user_id) from public.user_activity_days where day = today),
    'wau', (select count(distinct user_id) from public.user_activity_days where day >= today - 6),
    'mau', (select count(distinct user_id) from public.user_activity_days where day >= today - 29),
    'avg_active_days_30d', (
      select coalesce(round(avg(c)::numeric, 1), 0)
      from (select count(*) c from public.user_activity_days where day >= today - 29 group by user_id) t
    ),

    -- Engagement
    'has_predicted',   (select count(distinct user_id) from public.predictions),
    'never_predicted', (select count(*) from public.profiles p
                        where not exists (select 1 from public.predictions pr where pr.user_id = p.id)),
    'avg_predictions', (
      select coalesce(round(avg(c)::numeric, 1), 0)
      from (select count(*) c from public.predictions group by user_id) t
    ),
    'in_private_league', (select count(distinct user_id) from public.competition_participants),

    -- Frafald
    'inactive_30d', (select count(*) from public.profiles p
                     where not exists (
                       select 1 from public.user_activity_days d
                       where d.user_id = p.id and d.day >= today - 29
                     )),

    -- Kurver
    'signups_by_week', (
      select coalesce(jsonb_agg(jsonb_build_object('week', wk, 'count', c) order by wk), '[]'::jsonb)
      from (
        select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') wk, count(*) c
        from public.profiles
        where created_at is not null and created_at >= now() - interval '84 days'
        group by 1
      ) w
    ),
    'active_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'), 'count', c) order by day), '[]'::jsonb)
      from (
        select day, count(distinct user_id) c
        from public.user_activity_days
        where day >= today - 29
        group by day
      ) d
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.admin_user_stats() to authenticated;
