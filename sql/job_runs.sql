-- Overvågning af de planlagte jobs: én række pr. kørsel af api/sync-matches,
-- api/sync-live og api/send-notifications.
--
-- HVORFOR
-- Jobbene fejlede indtil nu tavst. Der fandtes ingen tabel over kørsler, intet
-- status-endpoint og ingen alarm — den eneste overvågning var cron-job.orgs
-- egen fejlnotifikation plus et manuelt kig på Vercels invocation-forbrug. En
-- kørsel, der svarede 200 men ikke nåede at gøre sit arbejde (fx den stille
-- trunkering ved paginering), var helt usynlig.
--
-- HVAD DEN IKKE KAN
-- Et job, cron-job.org har auto-deaktiveret, skriver INGEN rækker. Tavshed
-- ligner ro. Derfor er denne tabel kun den halve historie — den anden halvdel
-- er .github/workflows/job-heartbeat.yml, der slår alarm, når et job i
-- docs/CRON.md holder op med at melde sig.
--
-- Idempotent — kan køres igen når som helst.

create table if not exists public.job_runs (
  id bigint generated always as identity primary key,
  job text not null,                       -- "sync-matches" | "sync-live" | "send-notifications"
  started_at timestamp with time zone not null default now(),
  finished_at timestamp with time zone,
  ok boolean,                              -- null = kørslen nåede aldrig at afslutte
  detail jsonb,                            -- jobbets eget resumé (antal synkede, sendte, o.l.)
  error text
);

-- Opslagene er altid "seneste kørsler for ét job" eller "seneste kørsler i det
-- hele taget", så begge veje har et indeks.
create index if not exists job_runs_job_started_idx on public.job_runs (job, started_at desc);
create index if not exists job_runs_started_idx on public.job_runs (started_at desc);

alter table public.job_runs enable row level security;

-- Kun admins må læse driftsdata. Skrivningen sker med service-nøglen fra
-- api/, som går uden om RLS — der er derfor bevidst INGEN insert-policy.
drop policy if exists job_runs_read_admin on public.job_runs;
create policy job_runs_read_admin on public.job_runs
  for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin));

-- ---------- oprydning ----------
-- Uden en grænse vokser tabellen for evigt: sync-live alene giver 1.440 rækker
-- i døgnet. 30 dage er rigeligt til at se et mønster — og var rigeligt til at
-- afgøre A11, som blev besvaret på under et døgns historik (2. august 2026).

create or replace function public.prune_job_runs(keep_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare removed integer;
begin
  delete from public.job_runs where started_at < now() - (keep_days || ' days')::interval;
  get diagnostics removed = row_count;
  return removed;
end;
$fn$;

-- ---------- helbred pr. job ----------
-- Ét opslag, der svarer på de to spørgsmål, overvågningen stiller: hvornår
-- meldte jobbet sig sidst, og hvor mange gange er det fejlet i træk siden da?
--
-- Fejlserien tælles ved at finde den seneste VELLYKKEDE kørsel og tælle
-- kørslerne efter den. Det er mere robust end en tæller i en kolonne, som
-- kan komme ud af trit, hvis en kørsel dør uden at skrive færdig.

create or replace function public.admin_job_health()
returns table (
  job text,
  last_run_at timestamp with time zone,
  last_ok_at timestamp with time zone,
  consecutive_failures integer,
  last_error text,
  last_detail jsonb
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'forbidden';
  end if;

  return query
  with seneste_ok as (
    select r.job, max(r.started_at) as ok_at
    from public.job_runs r
    where r.ok
    group by r.job
  ),
  seneste as (
    select distinct on (r.job) r.job, r.started_at, r.error, r.detail
    from public.job_runs r
    order by r.job, r.started_at desc
  )
  select
    s.job,
    s.started_at,
    o.ok_at,
    (select count(*)::integer
       from public.job_runs f
      where f.job = s.job
        and f.ok is distinct from true
        and (o.ok_at is null or f.started_at > o.ok_at)),
    s.error,
    s.detail
  from seneste s
  left join seneste_ok o on o.job = s.job
  order by s.job;
end;
$fn$;

grant execute on function public.admin_job_health() to authenticated;
grant execute on function public.prune_job_runs(integer) to service_role;
